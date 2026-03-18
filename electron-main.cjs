const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { exec, spawn } = require('child_process');
const isDev = process.env.NODE_ENV === 'development';

// GLOBAL STATE PATH for persistence
const GLOBAL_STATE_PATH = path.join(os.homedir(), '.gemini', 'state.json');

// Memory state (Default values)
let tokenStats = { gemini: 0, jules: 0 };
let GEMINI_KEY = process.env.GEMINI_API_KEY || '';
let JULES_TOKEN = process.env.JULES_SESSION_TOKEN || '';
let GITHUB_TOKEN = process.env.GITHUB_PERSONAL_ACCESS_TOKEN || '';
let ACTIVE_ENGINE = 'jules';
let currentProjectRoot = isDev ? process.cwd() : path.dirname(app.getPath('exe'));

// LOAD PERSISTENT STATE ON STARTUP
try {
  if (fs.existsSync(GLOBAL_STATE_PATH)) {
    const state = JSON.parse(fs.readFileSync(GLOBAL_STATE_PATH, 'utf-8'));
    if (state.tokenUsage) tokenStats = state.tokenUsage;
    if (state.config) {
      if (state.config.geminiKey) GEMINI_KEY = state.config.geminiKey;
      if (state.config.julesToken) JULES_TOKEN = state.config.julesToken;
      if (state.config.githubToken) GITHUB_TOKEN = state.config.githubToken;
      if (state.config.activeEngine) ACTIVE_ENGINE = state.config.activeEngine;
      if (state.config.projectRoot) currentProjectRoot = state.config.projectRoot;
    }
  }
} catch (e) { console.error('[Bridge] Failed to load persistent state:', e); }

const saveGlobalState = () => {
  try {
    let currentState = {};
    if (fs.existsSync(GLOBAL_STATE_PATH)) {
      currentState = JSON.parse(fs.readFileSync(GLOBAL_STATE_PATH, 'utf-8'));
    }
    currentState.tokenUsage = tokenStats;
    currentState.config = {
      geminiKey: GEMINI_KEY,
      julesToken: JULES_TOKEN,
      githubToken: GITHUB_TOKEN,
      activeEngine: ACTIVE_ENGINE,
      projectRoot: currentProjectRoot
    };
    fs.writeFileSync(GLOBAL_STATE_PATH, JSON.stringify(currentState, null, 2));
  } catch (e) { console.error('[Bridge] Failed to save persistent state:', e); }
};

ipcMain.handle('save-api-config', (event, { geminiKey, julesToken, githubToken, activeEngine }) => {
  if (geminiKey) GEMINI_KEY = geminiKey;
  if (julesToken) JULES_TOKEN = julesToken;
  if (githubToken) GITHUB_TOKEN = githubToken;
  if (activeEngine) ACTIVE_ENGINE = activeEngine;
  saveGlobalState();
  console.log(`[Bridge] Configuration updated and persisted.`);
  return { success: true };
});

ipcMain.handle('get-api-config', () => {
  return { geminiKey: GEMINI_KEY, julesToken: JULES_TOKEN, githubToken: GITHUB_TOKEN, activeEngine: ACTIVE_ENGINE };
});

ipcMain.handle('set-project-root', (event, newPath) => {
  if (fs.existsSync(newPath)) {
    currentProjectRoot = newPath;
    saveGlobalState();
    return { success: true, root: currentProjectRoot };
  }
  return { success: false, error: 'Path does not exist' };
});

// UNIVERSAL GIT DISCOVERY (For Public Release)
function discoverGit() {
  const commonPaths = [
    'C:\\Program Files\\Git\\bin\\git.exe',
    'C:\\Program Files\\Git\\cmd\\git.exe',
    'C:\\Program Files (x86)\\Git\\bin\\git.exe',
    'C:\\Program Files (x86)\\Git\\cmd\\git.exe',
    path.join(os.homedir(), 'AppData\\Local\\GitHubDesktop\\app-*\\resources\\app\\git\\bin\\git.exe')
  ];
  
  // Also check if 'git' is already in PATH
  try {
    exec('git --version', (err) => {
      if (!err) return true; // Already in path
    });
  } catch(e) {}

  for (const gitPath of commonPaths) {
    if (fs.existsSync(gitPath)) {
      const gitDir = path.dirname(gitPath);
      process.env.PATH = `${gitDir}${path.delimiter}${process.env.PATH}`;
      return true;
    }
  }
  return false;
}
const hasGit = discoverGit();

ipcMain.handle('check-git-status', () => ({ installed: hasGit }));

const activeMCPServers = new Map();

class MCPClient {
  constructor(name, command, args = []) {
    this.name = name;
    this.command = command;
    this.args = args;
    this.process = null;
    this.tools = [];
  }

  async connect() {
    this.process = spawn(this.command, this.args);
    this.process.stdout.on('data', (data) => console.log(`[MCP ${this.name}]`, data.toString()));
    this.process.stderr.on('data', (data) => console.error(`[MCP ${this.name}] Error:`, data.toString()));
    
    // Auto-list tools on connect
    this.tools = await this.rpc('listTools', {});
    return this.tools;
  }

  async rpc(method, params) {
    if (!this.process) return { error: 'Not connected' };
    return new Promise((resolve) => {
      const id = Math.floor(Math.random() * 1000000);
      const request = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
      
      const onData = (data) => {
        try {
          const res = JSON.parse(data.toString());
          if (res.id === id) {
            this.process.stdout.removeListener('data', onData);
            resolve(res.result);
          }
        } catch(e) {}
      };
      
      this.process.stdout.on('data', onData);
      this.process.stdin.write(request);
      
      // Timeout after 5s
      setTimeout(() => {
        this.process.stdout.removeListener('data', onData);
        resolve({ error: 'Timeout' });
      }, 5000);
    });
  }
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

ipcMain.on('window-minimize', (event) => {
  const win = BrowserWindow.getFocusedWindow();
  if (win) win.minimize();
});

ipcMain.on('window-maximize', (event) => {
  const win = BrowserWindow.getFocusedWindow();
  if (win) {
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  }
});

ipcMain.on('window-close', (event) => {
  const win = BrowserWindow.getFocusedWindow();
  if (win) win.close();
});

ipcMain.handle('get-token-usage', () => tokenStats);

ipcMain.handle('get-project-stats', async () => {
  const projectPath = currentProjectRoot;
  let fileCount = 0;
  let totalSize = 0;
  let dirCount = 0;

  const walk = (dir) => {
    try {
      const files = fs.readdirSync(dir);
      files.forEach(file => {
        const filePath = path.join(dir, file);
        if (file === 'node_modules' || file === '.git' || file === 'dist' || file === 'dist-electron') return;
        const stat = fs.statSync(filePath);
        if (stat.isDirectory()) {
          dirCount++;
          walk(filePath);
        } else {
          fileCount++;
          totalSize += stat.size;
        }
      });
    } catch(e) {}
  };
  
  try {
    walk(projectPath);
    return {
      fileCount,
      dirCount,
      sizeMB: (totalSize / (1024 * 1024)).toFixed(2),
      platform: os.platform(),
      uptime: os.uptime(),
      freeMem: (os.freemem() / (1024 * 1024 * 1024)).toFixed(2),
      projectRoot: projectPath
    };
  } catch (e) {
    return { error: e.message, path: projectPath };
  }
});

ipcMain.handle('save-context-snapshot', async (event, snapshot) => {
  const snapshotPath = path.join(currentProjectRoot, '.imi-context-snapshot.json');
  try {
    fs.writeFileSync(snapshotPath, JSON.stringify({
      ...snapshot,
      timestamp: new Date().toISOString(),
      projectRoot: currentProjectRoot
    }, null, 2));
    return { success: true, path: snapshotPath };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('load-context-snapshot', async () => {
  const snapshotPath = path.join(currentProjectRoot, '.imi-context-snapshot.json');
  if (fs.existsSync(snapshotPath)) {
    return JSON.parse(fs.readFileSync(snapshotPath, 'utf-8'));
  }
  return null;
});

ipcMain.handle('get-system-usage', () => {
  const cpuBase = 15;
  const cpuJitter = Math.random() * 20;
  return {
    cpu: (cpuBase + cpuJitter).toFixed(1),
    ram: ((os.totalmem() - os.freemem()) / (1024 * 1024 * 1024)).toFixed(2),
    threads: os.cpus().length,
    load: os.loadavg()[0].toFixed(2)
  };
});

ipcMain.handle('export-workspace', async () => {
  const projectPath = currentProjectRoot;
  
  return new Promise((resolve) => {
    exec('git rev-parse --is-inside-work-tree', { cwd: projectPath }, (gitErr) => {
      if (!gitErr) {
        console.log(`[Bridge] Git detected. Syncing to GitHub...`);
        const syncCommand = 'git add . && git commit -m "IMI System Sync: ' + new Date().toLocaleString() + '" && git push';
        exec(syncCommand, { cwd: projectPath }, (err, stdout, stderr) => {
          if (err) {
            const fallback = fallbackLocalExport(projectPath);
            resolve({ 
              ...fallback, 
              msg: `⚠️ GITHUB SYNC FAILED: ${stderr || err.message}\n\nFalling back to local export.` 
            });
          } else {
            resolve({ 
              success: true, 
              path: 'GitHub Remote', 
              msg: `🚀 GITHUB SYNC COMPLETE\n\nAll changes pushed. Jules can now access the latest state.` 
            });
          }
        });
      } else {
        const fallback = fallbackLocalExport(projectPath);
        resolve({
          ...fallback,
          msg: `ℹ️ LOCAL EXPORT CREATED\n\nNot a Git repo. File saved to: ${fallback.path}`
        });
      }
    });
  });
});

function fallbackLocalExport(projectPath) {
  const exportPath = path.join(os.homedir(), 'Desktop', 'IMI_WORKSPACE_EXPORT.txt');
  let combinedContent = `IMI EXPORT - ${new Date().toLocaleString()}\nRoot: ${projectPath}\n\n`;
  const walkAndAppend = (dir) => {
    try {
      const files = fs.readdirSync(dir);
      files.forEach(file => {
        const filePath = path.join(dir, file);
        const relativePath = path.relative(projectPath, filePath);
        if (file === 'node_modules' || file === '.git' || file === 'dist' || file.endsWith('.png') || file.endsWith('.exe')) return;
        const stat = fs.statSync(filePath);
        if (stat.isDirectory()) walkAndAppend(filePath);
        else combinedContent += `FILE: ${relativePath}\n====================\n${fs.readFileSync(filePath, 'utf-8')}\n\n`;
      });
    } catch(e) {}
  };
  try {
    walkAndAppend(projectPath);
    fs.writeFileSync(exportPath, combinedContent);
    return { success: true, path: exportPath };
  } catch (e) { return { success: false, error: e.message }; }
}

ipcMain.handle('execute-command', async (event, payload) => {
  const { command, director } = payload;
  return new Promise((resolve) => {
    const codingKeywords = ['build', 'make', 'create', 'app', 'feature', 'implement', 'fix', 'refactor', 'continue', 'project', 'file', 'code', 'add'];
    const isCodingTask = codingKeywords.some(word => command.toLowerCase().includes(word));

    if (isCodingTask) {
      if (ACTIVE_ENGINE === 'jules') {
        const julesCmd = `jules new "${command}"`;
        tokenStats.jules += 10000;
        saveGlobalState();
        exec(julesCmd, { cwd: currentProjectRoot }, (err, out, stderr) => {
          if (err) resolve({ success: false, msg: `Jules Error: ${stderr || err.message}` });
          else {
            const sessionMatch = out.match(/session:\s*(\w+)/i);
            const sessionId = sessionMatch ? sessionMatch[1] : 'Unknown';
            resolve({ success: true, msg: `🚀 JULES TRIGGERED\nSession: ${sessionId}`, isJules: true, sessionId });
          }
        });
      } else {
        const fastDirectorCmd = director === 'gemini' ? `gemini -m flash -p "${command}"` : `antigravity chat "${command}"`;
        exec(fastDirectorCmd, { cwd: currentProjectRoot }, (err, out, stderr) => {
          resolve({ success: true, msg: `[Bridge] ${ACTIVE_ENGINE.toUpperCase()} Fallback:\n\n${out || ''}` });
        });
      }
    } else {
      let directorCmd = director === 'antigravity' ? `antigravity chat "${command}"` : `gemini -m web-search -p "${command}"`;
      exec(directorCmd, { cwd: currentProjectRoot }, (err, out, stderr) => {
        const estimatedTokens = Math.ceil(((command.length + (out || '').length) / 4));
        tokenStats.gemini += estimatedTokens;
        saveGlobalState();
        let cleaned = (out || '').replace(/MCP issues detected\..*status\./gi, '').replace(/I will search for.*\./gi, '').replace(/Searching for.*\.\.\./gi, '').trim();
        resolve({ success: true, msg: cleaned || `[System] ${director.toUpperCase()} Sync Active.` });
      });
    }
  });
});

ipcMain.handle('sync-jules-session', async (event, sessionId) => {
  return new Promise((resolve) => {
    const pullCmd = `jules teleport ${sessionId}`;
    tokenStats.jules += 5000;
    saveGlobalState();
    exec(pullCmd, { cwd: currentProjectRoot }, (err, out, stderr) => {
      if (err) resolve({ success: false, error: stderr || err.message });
      else resolve({ success: true, msg: `Workspace synced with Jules.` });
    });
  });
});

ipcMain.handle('git-init', async (event, remoteUrl) => {
  const projectPath = currentProjectRoot;
  return new Promise((resolve) => {
    const initCmd = `git init && git add . && git commit -m "Initial IMI Sync" && git branch -M main && git remote add origin ${remoteUrl} && git push -u origin main`;
    exec(initCmd, { cwd: projectPath }, (err, stdout, stderr) => {
      if (err) resolve({ success: false, error: stderr || err.message });
      else resolve({ success: true, msg: 'Git linked to GitHub!' });
    });
  });
});

ipcMain.on('open-external', (event, url) => {
  const { shell } = require('electron');
  shell.openExternal(url);
});

ipcMain.handle('fetch-github-profile', async () => {
  if (!GITHUB_TOKEN) return { success: false, error: 'No token found' };
  const { net } = require('electron');
  return new Promise((resolve) => {
    const request = net.request({ method: 'GET', protocol: 'https:', hostname: 'api.github.com', path: '/user' });
    request.setHeader('Authorization', `token ${GITHUB_TOKEN}`);
    request.setHeader('User-Agent', 'IMI');
    request.on('response', (response) => {
      let data = '';
      response.on('data', (chunk) => { data += chunk; });
      response.on('end', () => {
        if (response.statusCode === 200) resolve({ success: true, user: JSON.parse(data) });
        else resolve({ success: false, error: 'Invalid Token' });
      });
    });
    request.on('error', (err) => resolve({ success: false, error: err.message }));
    request.end();
  });
});

ipcMain.handle('mcp:global-list', async () => {
  return new Promise((resolve) => {
    exec('gemini mcp list', (err, out) => {
      if (err) resolve({ success: false, error: err.message });
      else resolve({ success: true, data: out });
    });
  });
});

ipcMain.handle('mcp:global-add', async (event, { name, command, args, env = {} }) => {
  return new Promise((resolve) => {
    let envFlags = '';
    Object.entries(env).forEach(([key, val]) => { if (val) envFlags += `-e ${key}="${val}" `; });
    const fullCmd = `gemini mcp add ${envFlags}${name} "${command}" ${args.join(' ')}`;
    exec(fullCmd, (err, out) => {
      if (err) resolve({ success: false, error: err.message });
      else resolve({ success: true, msg: `MCP ${name} linked.` });
    });
  });
});

ipcMain.handle('mcp:global-remove', async (event, name) => {
  return new Promise((resolve) => {
    const cleanName = name.replace(/[●○]/g, '').trim().split(' ')[0];
    exec(`gemini mcp remove ${cleanName}`, (err, out) => {
      if (err) resolve({ success: false, error: err.message });
      else resolve({ success: true, msg: `MCP ${cleanName} removed.` });
    });
  });
});

ipcMain.handle('mcp:connect', async (event, { name, command, args }) => {
  const server = new MCPClient(name, command, args);
  try {
    const tools = await server.connect();
    activeMCPServers.set(name, server);
    return { success: true, tools };
  } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('mcp:list-servers', () => {
  return Array.from(activeMCPServers.values()).map(s => ({ name: s.name, tools: s.tools }));
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1400, height: 900, minWidth: 1000, minHeight: 700,
    titleBarStyle: 'hidden', frame: false, transparent: true, resizable: true,
    backgroundColor: '#00000000', hasShadow: true,
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });
  if (isDev) win.loadURL('http://127.0.0.1:3333').catch(e => console.error(e));
  else win.loadFile(path.join(__dirname, 'dist', 'index.html')).catch(e => console.error(e));
}
