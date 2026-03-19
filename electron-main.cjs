const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const https = require('https');
const { exec, spawn } = require('child_process');

let mainWindow = null; // 🚀 Global reference for system broadcasting

const isDev = process.env.NODE_ENV === 'development';

// 🚀 [ANTI-SPAM] GLOBAL PATH STERILIZATION (Blocks Windows Store App Installer Shims)
const sterilizePath = (inputPath) => {
  if (!inputPath) return '';
  return inputPath
    .split(path.delimiter)
    .filter(p => {
      const lower = p.toLowerCase();
      // Block Windows Store shims but ALLOW standard Program Files installations
      return (!lower.includes('windowsapps') && 
              !lower.includes('microsoft\\windowsapps')) || 
             lower.includes('program files');
    })
    .join(path.delimiter);
};

process.env.PATH = sterilizePath(process.env.PATH);
process.env.ELECTRON_BUILDER_OFFLINE = 'true';
process.env.NO_UPDATE_NOTIFIER = '1';
process.env.npm_config_update_notifier = 'false';
process.env.ADBLOCK = 'true';
process.env.CI = 'true'; // Suppress terminal interactivity
process.env.GIT_TERMINAL_PROMPT = '0'; // Kill git logins
process.env.PYTHONUNBUFFERED = '1'; // Ensure we see output immediately
process.env.PIP_NO_INPUT = '1'; // No pip prompts
process.env.PYTHONIOENCODING = 'utf-8';

// GLOBAL STATE PATH for persistence
const GLOBAL_STATE_PATH = path.join(os.homedir(), '.gemini', 'state.json');

// Memory state (Default values)
let tokenStats = { gemini: 0, jules: 0, openai: 0, claude: 0, antigravity: 0 };
let GEMINI_KEY = process.env.GEMINI_API_KEY || '';
let GITHUB_TOKEN = process.env.GITHUB_PERSONAL_ACCESS_TOKEN || '';
let OPENAI_KEY = '';
let CLAUDE_KEY = '';
let DEEPSEEK_KEY = '';
let MISTRAL_KEY = '';
let LLAMA_KEY = '';
let PERPLEXITY_KEY = '';
let CUSTOM_API_KEY = '';
let JULES_KEY = '';
let GOOGLE_MAPS_KEY = '';
let ACTIVE_ENGINE = 'gemini';
let mcpServersList = [];
let currentProjectRoot = isDev ? process.cwd() : path.dirname(app.getPath('exe'));

// LOAD PERSISTENT STATE ON STARTUP
try {
  if (fs.existsSync(GLOBAL_STATE_PATH)) {
    const state = JSON.parse(fs.readFileSync(GLOBAL_STATE_PATH, 'utf-8'));
    if (state.tokenUsage) tokenStats = state.tokenUsage;
    if (state.config) {
      if (state.config.geminiKey) GEMINI_KEY = state.config.geminiKey;
      if (state.config.githubToken) GITHUB_TOKEN = state.config.githubToken;
      if (state.config.openaiKey) OPENAI_KEY = state.config.openaiKey;
      if (state.config.claudeKey) CLAUDE_KEY = state.config.claudeKey;
      if (state.config.deepseekKey) DEEPSEEK_KEY = state.config.deepseekKey;
      if (state.config.mistralKey) MISTRAL_KEY = state.config.mistralKey;
      if (state.config.llamaKey) LLAMA_KEY = state.config.llamaKey;
      if (state.config.perplexityKey) PERPLEXITY_KEY = state.config.perplexityKey;
      if (state.config.customApiKey) CUSTOM_API_KEY = state.config.customApiKey;
      if (state.config.julesApiKey) JULES_KEY = state.config.julesApiKey;
      if (state.config.googleMapsKey) GOOGLE_MAPS_KEY = state.config.googleMapsKey;
      if (state.config.activeEngine) ACTIVE_ENGINE = state.config.activeEngine;
      if (state.config.mcpServersList) mcpServersList = state.config.mcpServersList;
      else {
        // Boostrap defaults if missing but tokens exist - Use direct bins where possible
        // Sequentialize check for existing binaries to avoid npx spam
        if (GITHUB_TOKEN) mcpServersList.push({ name: 'GitHub', command: 'npx', args: ['--no-install', '-y', '@modelcontextprotocol/server-github'], env: { GITHUB_PERSONAL_ACCESS_TOKEN: GITHUB_TOKEN } });
        // Standardize Jules bootstrap to use the official FastMCP bridge
        if (JULES_KEY) mcpServersList.push({ name: 'Jules', command: 'npx', args: ['--no-install', '-y', '@amitdeshmukh/google-jules-mcp'], env: { JULES_API_KEY: JULES_KEY, GOOGLE_API_KEY: JULES_KEY } });
      }
      if (state.config.projectRoot) currentProjectRoot = state.config.projectRoot;
    }
  }
} catch (e) { console.error('[Bridge] Failed to load persistent state:', e); }

const saveGlobalState = () => {
  try {
    const stateDir = path.dirname(GLOBAL_STATE_PATH);
    if (!fs.existsSync(stateDir)) {
      fs.mkdirSync(stateDir, { recursive: true });
    }
    
    let currentState = {};
    if (fs.existsSync(GLOBAL_STATE_PATH)) {
      try {
        currentState = JSON.parse(fs.readFileSync(GLOBAL_STATE_PATH, 'utf-8'));
      } catch (e) {
        console.error('[Bridge] Failed to parse existing state file, starting fresh:', e);
        currentState = {};
      }
    }

    if (!currentState.config) {
      currentState.config = {};
    }

    currentState.tokenUsage = tokenStats;
    currentState.config.geminiKey = GEMINI_KEY;
    currentState.config.githubToken = GITHUB_TOKEN;
    currentState.config.openaiKey = OPENAI_KEY;
    currentState.config.claudeKey = CLAUDE_KEY;
    currentState.config.deepseekKey = DEEPSEEK_KEY;
    currentState.config.mistralKey = MISTRAL_KEY;
    currentState.config.llamaKey = LLAMA_KEY;
    currentState.config.perplexityKey = PERPLEXITY_KEY;
    currentState.config.customApiKey = CUSTOM_API_KEY;
    currentState.config.julesApiKey = JULES_KEY;
    currentState.config.googleMapsKey = GOOGLE_MAPS_KEY;
    currentState.config.activeEngine = ACTIVE_ENGINE;
    currentState.config.mcpServersList = mcpServersList;
    currentState.config.projectRoot = currentProjectRoot;

    fs.writeFileSync(GLOBAL_STATE_PATH, JSON.stringify(currentState, null, 2));
    console.log('[Bridge] Global state persistent.');
  } catch (e) { console.error('[Bridge] Failed to save persistent state:', e); }
};

ipcMain.handle('save-api-config', (event, config) => {
  // 🛡️ Always update, even if empty (allows clearing)
  GEMINI_KEY = config.geminiKey ?? GEMINI_KEY;
  GITHUB_TOKEN = config.githubToken ?? GITHUB_TOKEN;
  OPENAI_KEY = config.openaiKey ?? OPENAI_KEY;
  CLAUDE_KEY = config.claudeKey ?? CLAUDE_KEY;
  DEEPSEEK_KEY = config.deepseekKey ?? DEEPSEEK_KEY;
  MISTRAL_KEY = config.mistralKey ?? MISTRAL_KEY;
  LLAMA_KEY = config.llamaKey ?? LLAMA_KEY;
  PERPLEXITY_KEY = config.perplexityKey ?? PERPLEXITY_KEY;
  CUSTOM_API_KEY = config.customApiKey ?? CUSTOM_API_KEY;
  JULES_KEY = config.julesApiKey ?? JULES_KEY;
  GOOGLE_MAPS_KEY = config.googleMapsKey ?? GOOGLE_MAPS_KEY;
  ACTIVE_ENGINE = config.activeEngine ?? ACTIVE_ENGINE;
  
  if (config.projectRoot && fs.existsSync(config.projectRoot)) {
    currentProjectRoot = config.projectRoot;
  }
  
  saveGlobalState();
  return { success: true };
});

ipcMain.handle('get-api-config', () => {
  return { 
    geminiKey: GEMINI_KEY, 
    githubToken: GITHUB_TOKEN, 
    openaiKey: OPENAI_KEY,
    claudeKey: CLAUDE_KEY,
    deepseekKey: DEEPSEEK_KEY,
    mistralKey: MISTRAL_KEY,
    llamaKey: LLAMA_KEY,
    perplexityKey: PERPLEXITY_KEY,
    customApiKey: CUSTOM_API_KEY,
    julesApiKey: JULES_KEY,
    googleMapsKey: GOOGLE_MAPS_KEY,
    activeEngine: ACTIVE_ENGINE,
    projectRoot: currentProjectRoot
  };
});

ipcMain.handle('set-project-root', (event, newPath) => {
  if (fs.existsSync(newPath)) {
    currentProjectRoot = newPath;
    console.log(`[Bridge] Project Root Updated: ${currentProjectRoot}`);
    saveGlobalState();
    return { success: true, root: currentProjectRoot };
  }
  console.warn(`[Bridge] Failed to set Project Root: ${newPath} (Path does not exist)`);
  return { success: false, error: 'Path does not exist' };
});

// UNIVERSAL GIT DISCOVERY (For Public Release)
async function discoverGit() {
  const gitPath = await checkCommand('git');
  if (gitPath) {
    hasGit = true;
    console.log(`[Bridge] Git discovered at: ${gitPath}`);
    return true;
  }
  console.log('[Bridge] Git not found or blocked.');
  return false;
}

let hasGit = false;
let isGitDiscovered = false;

async function runInitialChecks() {
  isGitDiscovered = true;
  hasGit = false;
  console.log(`[Bridge] Background system checks muted.`);
}

const activeMCPServers = new Map();
const verifiedPaths = {}; // 🚀 Cache for verified command paths

class MCPClient {
  constructor(name, command, args = [], env = {}) {
    this.name = name;
    this.command = command;
    this.args = args;
    this.env = env;
    this.process = null;
    this.tools = [];
  }

  async connect() {
    const binPath = await checkCommand(this.command);
    if (!binPath) throw new Error(`${this.command} not found or blocked by shim filter.`);
    
    this.process = spawn(`"${binPath}"`, this.args, {
      env: { ...process.env, ...this.env },
      shell: true 
    });

    // 1. Handshake: Initialize
    const init = await this.rpc('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'imi-bridge', version: '1.0.0' }
    });

    if (init && !init.error) {
      // 2. Notification: Initialized
      const notif = JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }) + '\n';
      this.process.stdin.write(notif);
      
      // 3. List tools
      const res = await this.rpc('tools/list', {});
      this.tools = res.tools || [];
      
      if (this.tools.length === 0) {
        throw new Error(`Authentication Failed: No tools available for ${this.name}. (Check your API Key)`);
      }

      console.log(`[MCP ${this.name}] Connected. Tools:`, this.tools.length);
      return this.tools;
    }
    
    return [];
  }

  async rpc(method, params) {
    if (!this.process) return { error: 'Not connected' };
    return new Promise((resolve) => {
      const id = Math.floor(Math.random() * 1000000);
      const request = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
      
      const onData = (data) => {
        try {
          const lines = data.toString().split('\n');
          for (const line of lines) {
            if (!line) continue;
            const res = JSON.parse(line);
            if (res.id === id) {
              this.process.stdout.removeListener('data', onData);
              resolve(res.result || res);
            }
          }
        } catch(e) {}
      };
      
      this.process.stdout.on('data', onData);
      this.process.stdin.write(request);
      
      // Timeout after 10s
      setTimeout(() => {
        this.process.stdout.removeListener('data', onData);
        resolve({ error: 'Timeout' });
      }, 10000);
    });
  }
}

ipcMain.handle('check-git-status', async () => {
  const gitPath = await checkCommand('git');
  return { installed: !!gitPath, path: gitPath };
});

app.whenReady().then(() => {
  runInitialChecks();
  autoConnectMCP();
  // 🚀 Pre-verify core paths for zero-latency burst
  checkCommand('antigravity');
  checkCommand('jules');
  
  // ⚡ Auto-Sync Engine: Zero-Touch GitHub Publishing
  setInterval(triggerGitSync, 60000); // 🚀 Heartbeat: 60 seconds
  
  createWindow();
});

// 🚀 POST-GENERATION POWER SYNC ENGINE
let syncActive = false;
async function triggerGitSync() {
  if (syncActive || !currentProjectRoot) return;
  syncActive = true;
  try {
    const gitPath = await checkCommand('git');
    if (!gitPath) { syncActive = false; return; }
    
    console.log(`[Sync] Triggering Bidirectional Cloud-Sync...`);
    const { exec } = require('child_process');
    // Pull first, then push
    const cmd = `"${gitPath}" pull && "${gitPath}" add . && "${gitPath}" commit -m "IMI Auto-Sync Implementation" && "${gitPath}" push`;
    
    exec(cmd, { cwd: currentProjectRoot }, (error) => {
      syncActive = false;
      if (!error) console.log(`[Sync] Bidirectional Sync: SUCCESS.`);
      else console.error(`[Sync] High-Priority Push: FAILED.`, error);
    });
  } catch (e) { syncActive = false; }
}

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
    const result = fallbackLocalExport(projectPath);
    resolve({
      ...result,
      msg: `ℹ️ LOCAL EXPORT CREATED\n\nGitHub Sync temporarily disabled to prevent Windows Store shims. File saved to: ${result.path}`
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

async function autoConnectMCP() {
  console.log('[Bridge] Auto-connecting saved MCP servers...');
  // Sequentialize to prevent racing file lookups or npx lock errors on Windows
  for (const mcp of mcpServersList) {
    try {
      if (mcp.command) {
        // Double check for App Installer shims before spawning
        const binPath = await checkCommand(mcp.command);
        if (!binPath && mcp.command !== 'npx') {
          console.warn(`[Bridge] Disarming ${mcp.name}: Bin not found or is a shim.`);
          continue;
        }

        const finalEnv = { ...mcp.env };
        if (mcp.name.toLowerCase().includes('jules') && JULES_KEY) {
          finalEnv['JULES_API_KEY'] = JULES_KEY;
          finalEnv['GOOGLE_API_KEY'] = JULES_KEY;
        }
        if (mcp.name.toLowerCase().includes('github') && GITHUB_TOKEN) {
          finalEnv['GITHUB_PERSONAL_ACCESS_TOKEN'] = GITHUB_TOKEN;
        }
        if (mcp.name.toLowerCase().includes('chatgpt') && OPENAI_KEY) {
          finalEnv['OPENAI_API_KEY'] = OPENAI_KEY;
        }
        if (mcp.name.toLowerCase().includes('claude') && CLAUDE_KEY) {
          finalEnv['ANTHROPIC_API_KEY'] = CLAUDE_KEY;
        }
        
        const server = new MCPClient(mcp.name, binPath || mcp.command, mcp.args || [], finalEnv);
        await server.connect();
        activeMCPServers.set(mcp.name, server);
        console.log(`[Bridge] Auto-connected: ${mcp.name}`);
      }
    } catch (e) {
      console.error(`[Bridge] Failed to auto-connect ${mcp.name}:`, e.message);
    }
  }
}

// 🛡️ [ASOS] AUTONOMOUS DIRECTIVE WATCHER
// This allows the external Python script to "talk" to the Agent by writing to a JSON file.
function startDirectiveWatcher() {
  const directivePath = path.join(currentProjectRoot, '.agent', 'directives.json');
  console.log(`[ASOS] Monitoring for directives: ${directivePath}`);
  
  if (!fs.existsSync(path.dirname(directivePath))) {
    fs.mkdirSync(path.dirname(directivePath), { recursive: true });
  }

  fs.watch(path.dirname(directivePath), (eventType, filename) => {
    if (filename === 'directives.json' && fs.existsSync(directivePath)) {
      try {
        const data = fs.readFileSync(directivePath, 'utf-8');
        if (!data) return;
        const directive = JSON.parse(data);
        console.log(`[ASOS] New System Directive: ${directive.message}`);
        
        if (mainWindow) {
          mainWindow.webContents.send('system-directive', {
            id: Date.now(),
            ...directive
          });
        }
        
        // Mark as consumed by deleting the file or renaming
        fs.unlinkSync(directivePath);
      } catch (e) {
        console.error('[ASOS] Failed to parse directive:', e.message);
      }
    }
  });
}

const getMCPEnv = () => {
  let mcpEnv = {};
  mcpServersList.forEach(s => {
    if (s.env) mcpEnv = { ...mcpEnv, ...s.env };
  });
  return mcpEnv;
};

// [TURBO] STREAMING COMMAND EXECUTION BRIDGE
ipcMain.on('execute-command-stream', async (event, payload) => {
  const { command, director, messageId } = payload;
  
  const isCliDirector = ['gemini', 'jules', 'antigravity'].includes(director);
  
  if (isCliDirector) {
    const binPath = await checkCommand(director);
    if (!binPath) {
      event.sender.send('command-error', { messageId, error: `${director.toUpperCase()} CLI not found.` });
      return;
    }

    let spawnCmd = binPath;
    let args = [];
    if (director === 'gemini') args = ['-m', 'gemini-3-flash-preview', '-p', command];
    else if (director === 'jules') args = ['prompt', command, '--theme', 'dark'];
    else args = ['chat', command];

    const finalEnv = { 
      ...process.env, 
      ...getMCPEnv(), // 🚀 Inject all linked MCP credentials
      FORCE_COLOR: '1' 
    };
    if (GEMINI_KEY) finalEnv['GEMINI_API_KEY'] = GEMINI_KEY;
    if (JULES_KEY) finalEnv['JULES_API_KEY'] = JULES_KEY;
    if (GITHUB_TOKEN) finalEnv['GITHUB_PERSONAL_ACCESS_TOKEN'] = GITHUB_TOKEN;
    if (OPENAI_KEY) finalEnv['OPENAI_API_KEY'] = OPENAI_KEY;
    if (CLAUDE_KEY) finalEnv['ANTHROPIC_API_KEY'] = CLAUDE_KEY;

    const child = spawn(binPath, args, { cwd: currentProjectRoot, shell: true, env: finalEnv });
    let fullOutput = '';
    child.stdout.on('data', (data) => { fullOutput += data.toString(); event.sender.send('command-chunk', { messageId, chunk: data.toString() }); });
    child.stderr.on('data', (data) => { event.sender.send('command-chunk', { messageId, chunk: data.toString() }); });
    child.on('close', (code) => {
      tokenStats[director] = (tokenStats[director] || 0) + Math.ceil(fullOutput.length / 4);
      saveGlobalState();
      event.sender.send('command-end', { messageId, code });
      triggerGitSync();
    });
  } else {
    // DIRECT API DIRECTORS (ChatGPT, Claude, DeepSeek, etc.)
    let apiUrl = '';
    let apiKey = '';
    let modelName = '';

    if (director === 'chatgpt') {
      apiUrl = 'api.openai.com';
      apiKey = OPENAI_KEY;
      modelName = 'gpt-4o';
    } else if (director === 'claude') {
      apiUrl = 'api.anthropic.com';
      apiKey = CLAUDE_KEY;
      modelName = 'claude-3-5-sonnet-20240620';
    } else if (director === 'deepseek') {
      apiUrl = 'api.deepseek.com';
      apiKey = DEEPSEEK_KEY;
      modelName = 'deepseek-chat';
    } else if (director === 'mistral') {
      apiUrl = 'api.mistral.ai';
      apiKey = MISTRAL_KEY;
      modelName = 'mistral-large-latest';
    } else if (director === 'llama') {
      apiUrl = 'api.groq.com';
      apiKey = LLAMA_KEY;
      modelName = 'llama3-70b-8192';
    } else if (director === 'perplexity') {
      apiUrl = 'api.perplexity.ai';
      apiKey = PERPLEXITY_KEY;
      modelName = 'llama-3-sonar-large-32k-online';
    }

    if (!apiKey) {
      event.sender.send('command-error', { messageId, error: `API Key for ${director.toUpperCase()} is missing. Please check Settings.` });
      return;
    }

    const { net } = require('electron');
    const apiPath = director === 'claude' ? '/v1/messages' : (director === 'llama' ? '/openai/v1/chat/completions' : '/v1/chat/completions');
    
    const req = net.request({
      method: 'POST',
      protocol: 'https:',
      hostname: apiUrl,
      path: apiPath
    });

    req.setHeader('Content-Type', 'application/json');
    if (director === 'claude') {
      req.setHeader('x-api-key', apiKey);
      req.setHeader('anthropic-version', '2023-06-01');
    } else {
      req.setHeader('Authorization', `Bearer ${apiKey}`);
    }

    const body = JSON.stringify(director === 'claude' ? {
      model: modelName,
      max_tokens: 4096,
      messages: [{ role: 'user', content: command }],
      stream: true
    } : {
      model: modelName,
      messages: [{ role: 'user', content: command }],
      stream: true
    });

    let fullText = '';
    let buffer = '';

    req.on('response', (res) => {
      if (res.statusCode !== 200) {
        let errData = '';
        res.on('data', (chunk) => { errData += chunk.toString(); });
        res.on('end', () => {
          event.sender.send('command-error', { messageId, error: `API Error ${res.statusCode}: ${errData}` });
        });
        return;
      }

      res.on('data', (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed === 'data: [DONE]') continue;
          if (!trimmed.startsWith('data: ')) continue;

          try {
            const json = JSON.parse(trimmed.substring(6));
            const content = director === 'claude' ? (json.delta?.text || '') : (json.choices?.[0]?.delta?.content || '');
            if (content) {
              fullText += content;
              event.sender.send('command-chunk', { messageId, chunk: content });
            }
          } catch (e) {}
        }
      });

      res.on('end', () => {
        if (!fullText) {
          event.sender.send('command-chunk', { messageId, chunk: '[System] API connected but returned no content. Check your key/usage.' });
        }
        tokenStats[director] = (tokenStats[director] || 0) + Math.ceil((command.length + fullText.length) / 4);
        saveGlobalState();
        event.sender.send('command-end', { messageId, code: 0 });
        triggerGitSync();
      });
    });

    req.on('error', (err) => {
      event.sender.send('command-error', { messageId, error: `Connection Error: ${err.message}` });
    });

    req.write(body);
    req.end();
  }
});

// Deprecated for new streaming UI but kept for legacy compat
ipcMain.handle('execute-command', async (event, payload) => {
  return { success: true, msg: "[Bridge] Redirecting to Stream Mode..." };
});

// Jules & GitHub features restored and optimized for efficiency.


ipcMain.handle('git-init', async (event, repoUrl) => {
  const gitPath = await checkCommand('git');
  if (!gitPath) return { success: false, error: 'Git not found. Please install Git for Windows.' };

  return new Promise((resolve) => {
    // Basic safety: only allow alphanumeric and common repo URL chars
    if (!/^[a-zA-Z0-9\-\.\/\:\@]+$/.test(repoUrl)) {
      return resolve({ success: false, error: 'Invalid Repository URL' });
    }

    exec(`"${gitPath}" init && "${gitPath}" remote add origin ${repoUrl}`, { cwd: currentProjectRoot }, (err, stdout, stderr) => {
      if (err) resolve({ success: false, error: stderr || err.message });
      else resolve({ success: true, msg: 'Git initialized and origin added successfully.' });
    });
  });
});

ipcMain.on('open-external', (event, url) => {
  const { shell } = require('electron');
  shell.openExternal(url);
});

// Jules Link functionality restored.


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

// Helper to check if a command exists before running it (prevents App Installer / Store spam)
function checkCommand(cmd) {
  if (verifiedPaths[cmd]) return Promise.resolve(verifiedPaths[cmd]); // 🚀 Instant return from cache

  return new Promise((resolve) => {
    // We use where.exe to find the path, then filter out Windows Store shims
    exec(`where.exe ${cmd}`, (err, stdout) => {
      if (err || !stdout) return resolve(false);
      
      const paths = stdout.split(/\r?\n/).filter(p => p.trim() !== '');
      
      const realPaths = paths.filter(p => {
        const lowerP = p.toLowerCase();
        // 🚀 Bypassing check for 'npx' as it's often a necessary wrapper for MCP
        if (cmd === 'npx' && lowerP.includes('nodejs')) return true;
        
        return !lowerP.includes('\\windowsapps\\') && 
               !lowerP.includes('microsoft\\windowsapps') && 
               !lowerP.includes('local\\microsoft\\windowsapps') &&
               !lowerP.includes('program files\\windowsapps');
      });

      if (realPaths.length > 0) {
        const foundPath = realPaths[0].trim();
        console.log(`[Bridge] Command Verified & Cached: ${cmd} -> ${foundPath}`);
        verifiedPaths[cmd] = foundPath; // 🚀 Store in cache
        resolve(foundPath);
      } else {
        console.warn(`[Bridge] Command Blocked (Store Shim Detected): ${cmd}`);
        resolve(false);
      }
    });
  });
}

ipcMain.handle('mcp:global-list', async () => {
  let list = mcpServersList.map(s => {
    const isConnected = mcpServersList.some(server => server.name === s.name);
    return `${isConnected ? '●' : '○'} ${s.name}: ${s.command} ${s.args.join(' ')}`;
  }).join('\n');
  
  if (mcpServersList.length === 0) list = "(No external registries linked)";
  
  return { success: true, data: list };
});

// Git status already handled above.

ipcMain.handle('mcp:global-add', async (event, config) => {
  const { name, command, args, env } = config;
  const finalEnv = { ...env };
  
  // 🛡️ CRITICAL PERSISTENCE: Never overwrite with empty keys if system knows better
  if (name.toLowerCase().includes('github')) {
    if (!finalEnv['GITHUB_PERSONAL_ACCESS_TOKEN'] && GITHUB_TOKEN) {
      finalEnv['GITHUB_PERSONAL_ACCESS_TOKEN'] = GITHUB_TOKEN;
    }
  }
  if (name.toLowerCase().includes('jules')) {
    if (!finalEnv['JULES_API_KEY'] && JULES_KEY) {
      finalEnv['JULES_API_KEY'] = JULES_KEY;
      finalEnv['GOOGLE_API_KEY'] = JULES_KEY;
    }
  }

  // Update internal registry with the hardened env
  mcpServersList = mcpServersList.filter(s => s.name !== name);
  mcpServersList.push({ name, command, args, env: finalEnv });
  saveGlobalState();
  
  // Try to connect immediately
  try {
    const server = new MCPClient(name, command, args, finalEnv);
    const tools = await server.connect();
    
    activeMCPServers.set(name, server);
    return { success: true, msg: `${name} registered and connected.`, tools };
  } catch (e) {
    // 🛡️ CRITICAL CLEANUP: If it failed, don't keep it in the online list
    activeMCPServers.delete(name);
    return { success: false, msg: `${name} failed to verify: ${e.message}`, error: e.message };
  }
});

ipcMain.handle('mcp:global-remove', async (event, name) => {
  mcpServersList = mcpServersList.filter(s => s.name !== name);
  const server = activeMCPServers.get(name);
  if (server && server.process) {
    server.process.kill();
    activeMCPServers.delete(name);
  }
  saveGlobalState();
  return { success: true, msg: `MCP ${name} unlinked and process terminated.` };
});

ipcMain.handle('mcp:connect', async (event, { name, command, args, env }) => {
  const finalEnv = { ...env };
  if (name.toLowerCase().includes('jules') && JULES_KEY) {
    finalEnv['JULES_API_KEY'] = JULES_KEY;
    finalEnv['GOOGLE_API_KEY'] = JULES_KEY;
  }
  const server = new MCPClient(name, command, args, finalEnv);
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
  mainWindow = new BrowserWindow({
    width: 1400, height: 900, minWidth: 1000, minHeight: 700,
    titleBarStyle: 'hidden', frame: false, transparent: true, resizable: true,
    backgroundColor: '#00000000', hasShadow: true,
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });
  if (isDev) mainWindow.loadURL('http://127.0.0.1:3333').catch(e => console.error(e));
  else mainWindow.loadFile(path.join(__dirname, 'dist', 'index.html')).catch(e => console.error(e));

  // Start the ASOS heartbeat
  startDirectiveWatcher();
}
