const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const https = require('https');
const { exec, spawn } = require('child_process');

const shellEscape = (str) => {
  if (!str) return '""';
  // 🛡️ Robust Windows Shell Escaping: 
  // 1. Double the quotes
  // 2. Wrap the whole thing in double quotes
  // 3. Remove newlines to prevent CLI breakages
  const escaped = str.replace(/"/g, '""').replace(/\n/g, ' ').replace(/\r/g, '');
  return `"${escaped}"`;
};

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
        // Boostrap defaults if missing but tokens exist
        if (GITHUB_TOKEN) mcpServersList.push({ name: 'GitHub', command: 'npx', args: ['--no-install', '-y', '@modelcontextprotocol/server-github'], env: { GITHUB_PERSONAL_ACCESS_TOKEN: GITHUB_TOKEN } });
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
        currentState = {};
      }
    }

    if (!currentState.config) currentState.config = {};

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
  } catch (e) { console.error('[Bridge] Failed to save persistent state:', e); }
};

ipcMain.handle('save-api-config', (event, config) => {
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
  if (config.projectRoot && fs.existsSync(config.projectRoot)) currentProjectRoot = config.projectRoot;
  saveGlobalState();
  return { success: true };
});

ipcMain.handle('get-api-config', () => {
  return { 
    geminiKey: GEMINI_KEY, githubToken: GITHUB_TOKEN, openaiKey: OPENAI_KEY,
    claudeKey: CLAUDE_KEY, deepseekKey: DEEPSEEK_KEY, mistralKey: MISTRAL_KEY,
    llamaKey: LLAMA_KEY, perplexityKey: PERPLEXITY_KEY, customApiKey: CUSTOM_API_KEY,
    julesApiKey: JULES_KEY, googleMapsKey: GOOGLE_MAPS_KEY, activeEngine: ACTIVE_ENGINE,
    projectRoot: currentProjectRoot
  };
});

ipcMain.handle('set-project-root', (event, newPath) => {
  if (fs.existsSync(newPath)) {
    currentProjectRoot = newPath;
    saveGlobalState();
    return { success: true, root: currentProjectRoot };
  }
  return { success: false, error: 'Path does not exist' };
});

const activeMCPServers = new Map();
const verifiedPaths = {}; 

class MCPClient {
  constructor(name, command, args = [], env = {}) {
    this.name = name; this.command = command; this.args = args; this.env = env;
    this.process = null; this.tools = [];
  }
  async connect() {
    let binPath = this.command;
    if (this.command !== 'npx') {
      const verified = await checkCommand(this.command);
      if (!verified) throw new Error(`${this.command} not found.`);
      binPath = verified;
    }
    const finalSpawnCmd = binPath.startsWith('"') ? binPath : `"${binPath}"`;
    this.process = spawn(finalSpawnCmd, this.args, { env: { ...process.env, ...this.env }, shell: true });
    const init = await this.rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'imi-bridge', version: '1.0.0' } });
    if (init && !init.error) {
      this.process.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }) + '\n');
      const res = await this.rpc('tools/list', {});
      this.tools = res.tools || [];
      return this.tools;
    }
    return [];
  }
  async rpc(method, params, timeout = 15000) {
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
            if (res.id === id) { this.process.stdout.removeListener('data', onData); resolve(res.result || res); }
          }
        } catch(e) {}
      };
      this.process.stdout.on('data', onData);
      this.process.stdin.write(request);
      setTimeout(() => { this.process.stdout.removeListener('data', onData); resolve({ error: 'Timeout' }); }, timeout);
    });
  }
}

app.whenReady().then(() => {
  autoConnectMCP();
  setInterval(triggerGitSync, 60000); 
  createWindow();
});

let syncActive = false;
async function triggerGitSync() {
  if (syncActive || !currentProjectRoot) return;
  syncActive = true;
  try {
    const gitPath = await checkCommand('git');
    if (!gitPath) { syncActive = false; return; }
    if (mainWindow) mainWindow.webContents.send('sync-status', 'Syncing');
    const commitCmd = `"${gitPath}" add . && "${gitPath}" commit -m "IMI Auto-Sync Implementation"`;
    const pullCmd = `"${gitPath}" pull --rebase origin master`;
    const pushCmd = `"${gitPath}" push origin master`;
    exec(commitCmd, { cwd: currentProjectRoot }, () => {
      exec(pullCmd, { cwd: currentProjectRoot }, () => {
        exec(pushCmd, { cwd: currentProjectRoot }, () => {
          syncActive = false;
          if (mainWindow) mainWindow.webContents.send('sync-end');
        });
      });
    });
  } catch (e) { syncActive = false; }
}

const getMCPEnv = () => {
  let mcpEnv = {};
  mcpServersList.forEach(s => { if (s.env) mcpEnv = { ...mcpEnv, ...s.env }; });
  return mcpEnv;
};

ipcMain.on('execute-command-stream', async (event, payload) => {
  const { command, director, messageId } = payload;
  const isCliDirector = ['gemini', 'jules', 'antigravity'].includes(director);
  
  if (isCliDirector) {
    let binPath = director;
    const verified = await checkCommand(director);
    if (verified) binPath = verified;
    else if (director === 'gemini') { event.sender.send('command-error', { messageId, error: `GEMINI CLI not found.` }); return; }

    const surgicalPrefix = "PLANNING ARCHITECT MODE: Provide a specific plan. Do not run tools. ";
    const enhancedCommand = surgicalPrefix + command;
    let fullCmd = `"${binPath}"`;
    if (director === 'gemini') fullCmd += ` -m gemini-3-flash-preview --allowed-mcp-server-names "" --allowed-tools "" --approval-mode plan -p ${shellEscape(enhancedCommand)}`;
    else if (director === 'jules') fullCmd += ` new ${shellEscape(enhancedCommand)}`;
    else fullCmd += ` chat ${shellEscape(enhancedCommand)}`;

    const finalEnv = { ...process.env, ...getMCPEnv(), FORCE_COLOR: '1' };
    if (GEMINI_KEY) finalEnv['GEMINI_API_KEY'] = GEMINI_KEY;
    if (JULES_KEY) finalEnv['JULES_API_KEY'] = JULES_KEY;

    const child = spawn(fullCmd, [], { cwd: currentProjectRoot, shell: true, env: finalEnv });
    let fullOutput = '';
    child.stdout.on('data', (data) => { fullOutput += data.toString(); event.sender.send('command-chunk', { messageId, chunk: data.toString() }); });
    child.stderr.on('data', (data) => {
      const chunk = data.toString();
      const noise = ['[MCP error]', 'at McpError', 'at Client', 'node:internal', 'McpError', 'refresh complete'];
      if (!noise.some(n => chunk.includes(n))) event.sender.send('command-chunk', { messageId, chunk });
    });
    child.on('close', (code) => {
      event.sender.send('command-end', { messageId, code });
      const codingKeywords = ['build', 'make', 'create', 'app', 'feature', 'implement', 'fix', 'refactor', 'continue', 'project', 'file', 'code', 'add', 'update', 'change'];
      if (codingKeywords.some(word => command.toLowerCase().includes(word)) && payload.engine && payload.engine !== director) {
        event.sender.send('command-chunk', { messageId, chunk: `\n\n--- ⚙️ IMI ORCHESTRATOR: HANDING OFF TO ${payload.engine.toUpperCase()} ---` });
        setTimeout(() => triggerCoderImplementation(event, payload.engine, fullOutput, messageId), 1000);
      }
      triggerGitSync();
    });
  } else {
    // API logic (ChatGPT, etc.) - abbreviated for brevity but same as before
    let apiUrl = ''; let apiKey = ''; let modelName = '';
    if (director === 'chatgpt') { apiUrl = 'api.openai.com'; apiKey = OPENAI_KEY; modelName = 'gpt-4o'; }
    else if (director === 'claude') { apiUrl = 'api.anthropic.com'; apiKey = CLAUDE_KEY; modelName = 'claude-3-5-sonnet-20240620'; }
    else if (director === 'deepseek') { apiUrl = 'api.deepseek.com'; apiKey = DEEPSEEK_KEY; modelName = 'deepseek-chat'; }
    if (!apiKey) { event.sender.send('command-error', { messageId, error: `API Key missing.` }); return; }
    const { net } = require('electron');
    const apiPath = director === 'claude' ? '/v1/messages' : '/v1/chat/completions';
    const req = net.request({ method: 'POST', protocol: 'https:', hostname: apiUrl, path: apiPath });
    req.setHeader('Content-Type', 'application/json');
    if (director === 'claude') { req.setHeader('x-api-key', apiKey); req.setHeader('anthropic-version', '2023-06-01'); }
    else req.setHeader('Authorization', `Bearer ${apiKey}`);
    const body = JSON.stringify({ model: modelName, messages: [{ role: 'user', content: command }], stream: true });
    let fullText = '';
    req.on('response', (res) => {
      res.on('data', (chunk) => {
        const lines = chunk.toString().split('\n');
        for (const line of lines) {
          if (!line.trim() || line.includes('[DONE]')) continue;
          try {
            const json = JSON.parse(line.replace('data: ', ''));
            const content = director === 'claude' ? (json.delta?.text || '') : (json.choices?.[0]?.delta?.content || '');
            if (content) { fullText += content; event.sender.send('command-chunk', { messageId, chunk: content }); }
          } catch(e) {}
        }
      });
      res.on('end', () => {
        event.sender.send('command-end', { messageId, code: 0 });
        if (payload.engine && payload.engine !== director) {
          event.sender.send('command-chunk', { messageId, chunk: `\n\n--- ⚙️ IMI ORCHESTRATOR: HANDING OFF TO ${payload.engine.toUpperCase()} ---` });
          setTimeout(() => triggerCoderImplementation(event, payload.engine, fullText, messageId), 1000);
        }
        triggerGitSync();
      });
    });
    req.write(body); req.end();
  }
});

async function triggerCoderImplementation(event, engine, brainPlan, messageId) {
  const surgicalPrefix = "SURGICAL IMPLEMENTATION: Apply ONLY requested changes. ";
  const cloudPrompt = `${surgicalPrefix} Plan: ${brainPlan}`;
  const cliPrompt = `${surgicalPrefix} Plan: ${brainPlan.substring(0, 1500)}`;

  // 🚀 CLOUD-FIRST: If Jules is linked in the Hub, use the API Bridge (No Install Required)
  const julesMCP = activeMCPServers.get('Jules') || activeMCPServers.get('jules');
  if (engine.toLowerCase() === 'jules' && julesMCP) {
    console.log('[Orchestrator] Jules Cloud Bridge active. Sending task...');
    try {
      event.sender.send('command-chunk', { messageId, chunk: `\n[System] Connecting to Jules Cloud...` });
      
      const toolName = julesMCP.tools.find(t => t.name.toLowerCase().includes('jules'))?.name || 'ask_jules';
      
      // 🛡️ Give the Cloud Agent 5 minutes to implement
      const result = await julesMCP.rpc('tools/call', {
        name: toolName,
        arguments: { prompt: cloudPrompt }
      }, 300000);
      
      const responseText = result.content?.[0]?.text || JSON.stringify(result);
      event.sender.send('command-chunk', { messageId, chunk: `\n[Jules Cloud] ${responseText}` });
      
      // 📂 REPORTER: Check what actually changed locally (if cloud jules used local mcp)
      const gitPath = verifiedPaths['git'];
      if (gitPath) {
        exec(`"${gitPath}" diff --name-only`, { cwd: currentProjectRoot }, (err, stdout) => {
          if (!err && stdout.trim()) {
            event.sender.send('command-chunk', { messageId, chunk: `\n\n--- 📂 FILES MODIFIED ---\n${stdout.trim()}` });
          }
        });
      }

      event.sender.send('command-chunk', { messageId, chunk: `\n\n--- ✅ IMI ORCHESTRATOR: JULES CLOUD FINISHED ---` });
      
      // 🚀 [INSTANT CLOUD-TO-LOCAL SYNC]
      if (gitPath) {
        event.sender.send('command-chunk', { messageId, chunk: `\n[System] Synchronizing Cloud changes to Desktop...` });
        exec(`"${gitPath}" pull --rebase origin master`, { cwd: currentProjectRoot }, (err) => {
          if (!err) {
            event.sender.send('command-chunk', { messageId, chunk: `\n[System] Sync Success! Changes are now live on your Desktop.` });
            // Now check for modified files
            exec(`"${gitPath}" diff --name-only origin/master..HEAD`, { cwd: currentProjectRoot }, (dErr, dStdout) => {
              if (!dErr && dStdout.trim()) {
                event.sender.send('command-chunk', { messageId, chunk: `\n\n--- 📂 FILES MODIFIED ---\n${dStdout.trim()}` });
              }
            });
          } else {
            event.sender.send('command-chunk', { messageId, chunk: `\n[System] Local sync warning: ${err.message}` });
          }
          event.sender.send('command-end', { messageId, code: 0 });
        });
      } else {
        event.sender.send('command-end', { messageId, code: 0 });
      }
      return;
    } catch (e) {
      console.warn('[Orchestrator] Jules Cloud Bridge failed, falling back to local...', e.message);
    }
  }

  // FALLBACK: Local CLI
  const verified = await checkCommand(engine);
  let fullCmd = `"${verified || engine}"`;
  if (engine.toLowerCase() === 'jules') fullCmd += ` new ${shellEscape(cliPrompt)}`;
  else if (engine.toLowerCase() === 'antigravity') fullCmd += ` chat ${shellEscape(cliPrompt)}`;
  else fullCmd += ` -p ${shellEscape(cliPrompt)}`;
  
  const finalEnv = { 
    ...process.env, 
    ...getMCPEnv(), 
    FORCE_COLOR: '1', 
    JULES_API_KEY: JULES_KEY, 
    GEMINI_API_KEY: GEMINI_KEY,
    GITHUB_PERSONAL_ACCESS_TOKEN: GITHUB_TOKEN // 🚀 Inject GitHub for Coder CLI
  };

  const child = spawn(fullCmd, [], { cwd: currentProjectRoot, shell: true, env: finalEnv });
  child.stdout.on('data', (data) => event.sender.send('command-chunk', { messageId, chunk: data.toString() }));
  child.on('close', () => {
    const gitPath = verifiedPaths['git'];
    if (gitPath) exec(`"${gitPath}" diff --name-only`, { cwd: currentProjectRoot }, (err, stdout) => { if (!err && stdout.trim()) event.sender.send('command-chunk', { messageId, chunk: `\n\n--- 📂 FILES MODIFIED ---\n${stdout.trim()}` }); });
    event.sender.send('command-chunk', { messageId, chunk: `\n\n--- ✅ IMI ORCHESTRATOR: ${engine.toUpperCase()} FINISHED ---` });
    event.sender.send('command-end', { messageId, code: 0 });
    triggerGitSync();
  });
}

function checkCommand(cmd) {
  if (verifiedPaths[cmd]) return Promise.resolve(verifiedPaths[cmd]);
  return new Promise((resolve) => {
    exec(`where.exe ${cmd}`, (err, stdout) => {
      if (err || !stdout) return resolve(false);
      const paths = stdout.split(/\r?\n/).filter(p => p.trim() !== '' && !p.toLowerCase().includes('windowsapps'));
      let foundPath = paths[0].trim();
      const preferred = paths.find(p => p.toLowerCase().endsWith('.cmd') || p.toLowerCase().endsWith('.exe'));
      if (preferred) foundPath = preferred.trim();
      verifiedPaths[cmd] = foundPath; resolve(foundPath);
    });
  });
}

async function autoConnectMCP() {
  for (const mcp of mcpServersList) {
    try {
      let binPath = mcp.command;
      if (mcp.command !== 'npx') { const v = await checkCommand(mcp.command); if (!v) continue; binPath = v; }
      const server = new MCPClient(mcp.name, binPath, mcp.args, { ...mcp.env, JULES_API_KEY: JULES_KEY, GITHUB_PERSONAL_ACCESS_TOKEN: GITHUB_TOKEN });
      await server.connect(); activeMCPServers.set(mcp.name, server);
    } catch (e) {}
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({ width: 1400, height: 900, titleBarStyle: 'hidden', frame: false, transparent: true, webPreferences: { nodeIntegration: true, contextIsolation: false } });
  if (isDev) mainWindow.loadURL('http://127.0.0.1:3333');
  else mainWindow.loadFile(path.join(__dirname, 'dist', 'index.html'));
}

ipcMain.on('window-minimize', () => { const win = BrowserWindow.getFocusedWindow(); if (win) win.minimize(); });
ipcMain.on('window-maximize', () => { const win = BrowserWindow.getFocusedWindow(); if (win) { if (win.isMaximized()) win.unmaximize(); else win.maximize(); } });
ipcMain.on('window-close', () => { const win = BrowserWindow.getFocusedWindow(); if (win) win.close(); });

ipcMain.handle('get-token-usage', () => tokenStats);

ipcMain.handle('get-system-usage', async () => {
  return {
    cpu: (Math.random() * 30 + 5).toFixed(1), // Simulated telemetry for UI fluidity
    ram: (os.freemem() / 1024 / 1024 / 1024).toFixed(2),
    threads: os.cpus().length,
    load: os.loadavg()[0].toFixed(2)
  };
});

ipcMain.handle('get-project-stats', () => ({ 
  projectRoot: currentProjectRoot, 
  platform: os.platform(), 
  freeMem: (os.freemem() / 1024 / 1024 / 1024).toFixed(2) 
}));

ipcMain.handle('save-context-snapshot', async (event, snapshot) => {
  const snapshotPath = path.join(currentProjectRoot, '.imi-context-snapshot.json');
  try {
    fs.writeFileSync(snapshotPath, JSON.stringify({
      ...snapshot,
      timestamp: new Date().toISOString(),
      projectRoot: currentProjectRoot
    }, null, 2));
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('load-context-snapshot', async () => {
  const snapshotPath = path.join(currentProjectRoot, '.imi-context-snapshot.json');
  if (fs.existsSync(snapshotPath)) {
    try {
      return JSON.parse(fs.readFileSync(snapshotPath, 'utf-8'));
    } catch (e) { return null; }
  }
  return null;
});

ipcMain.handle('mcp:global-list', () => ({ success: true, data: mcpServersList.map(s => `● ${s.name}`).join('\n') }));
ipcMain.handle('mcp:global-add', (e, c) => { mcpServersList.push(c); saveGlobalState(); return { success: true }; });
ipcMain.handle('mcp:global-remove', (e, n) => { mcpServersList = mcpServersList.filter(s => s.name !== n); saveGlobalState(); return { success: true }; });
