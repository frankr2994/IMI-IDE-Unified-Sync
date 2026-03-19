const { app, BrowserWindow, ipcMain, net } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const https = require('https');
const { exec, spawn, execSync } = require('child_process');

const shellEscape = (str) => {
  if (!str) return '""';
  const escaped = str.replace(/"/g, '""').replace(/\n/g, ' ').replace(/\r/g, '');
  return `"${escaped}"`;
};

let mainWindow = null;
const isDev = process.env.NODE_ENV === 'development';

const sterilizePath = (inputPath) => {
  if (!inputPath) return '';
  return inputPath.split(path.delimiter).filter(p => {
    const lower = p.toLowerCase();
    return (!lower.includes('windowsapps') && !lower.includes('microsoft\\windowsapps')) || lower.includes('program files');
  }).join(path.delimiter);
};

process.env.PATH = sterilizePath(process.env.PATH);
const GLOBAL_STATE_PATH = path.join(os.homedir(), '.gemini', 'state.json');

let tokenStats = { gemini: 0, jules: 0, openai: 0, claude: 0, antigravity: 0 };
let GEMINI_KEY = ''; let GITHUB_TOKEN = ''; let OPENAI_KEY = ''; let CLAUDE_KEY = '';
let DEEPSEEK_KEY = ''; let MISTRAL_KEY = ''; let LLAMA_KEY = ''; let PERPLEXITY_KEY = '';
let CUSTOM_API_KEY = ''; let JULES_KEY = ''; let GOOGLE_MAPS_KEY = '';
let ACTIVE_ENGINE = 'jules';
let mcpServersList = [];
let currentProjectRoot = isDev ? process.cwd() : path.dirname(app.getPath('exe'));

const saveGlobalState = () => {
  try {
    const stateDir = path.dirname(GLOBAL_STATE_PATH);
    if (!fs.existsSync(stateDir)) fs.mkdirSync(stateDir, { recursive: true });
    const config = { geminiKey: GEMINI_KEY, githubToken: GITHUB_TOKEN, openaiKey: OPENAI_KEY, claudeKey: CLAUDE_KEY, deepseekKey: DEEPSEEK_KEY, mistralKey: MISTRAL_KEY, llamaKey: LLAMA_KEY, perplexityKey: PERPLEXITY_KEY, customApiKey: CUSTOM_API_KEY, julesApiKey: JULES_KEY, googleMapsKey: GOOGLE_MAPS_KEY, activeEngine: ACTIVE_ENGINE, mcpServersList, projectRoot: currentProjectRoot };
    fs.writeFileSync(GLOBAL_STATE_PATH, JSON.stringify({ tokenUsage: tokenStats, config }, null, 2));
  } catch (e) { console.error('[Bridge] Save Error:', e); }
};

try {
  if (fs.existsSync(GLOBAL_STATE_PATH)) {
    const state = JSON.parse(fs.readFileSync(GLOBAL_STATE_PATH, 'utf-8'));
    if (state.tokenUsage) tokenStats = state.tokenUsage;
    if (state.config) {
      GEMINI_KEY = state.config.geminiKey || ''; GITHUB_TOKEN = state.config.githubToken || '';
      OPENAI_KEY = state.config.openaiKey || ''; CLAUDE_KEY = state.config.claudeKey || '';
      DEEPSEEK_KEY = state.config.deepseekKey || ''; MISTRAL_KEY = state.config.mistralKey || '';
      LLAMA_KEY = state.config.llamaKey || ''; PERPLEXITY_KEY = state.config.perplexityKey || '';
      CUSTOM_API_KEY = state.config.customApiKey || ''; JULES_KEY = state.config.julesApiKey || '';
      GOOGLE_MAPS_KEY = state.config.googleMapsKey || ''; ACTIVE_ENGINE = state.config.activeEngine || 'jules';
      mcpServersList = state.config.mcpServersList || [];
      if (state.config.projectRoot && fs.existsSync(state.config.projectRoot)) currentProjectRoot = state.config.projectRoot;
    }
  }
} catch (e) { console.error('[Bridge] Load Error:', e); }

ipcMain.handle('save-api-config', (e, config) => {
  if (config.geminiKey !== undefined) GEMINI_KEY = config.geminiKey;
  if (config.githubToken !== undefined) GITHUB_TOKEN = config.githubToken;
  if (config.openaiKey !== undefined) OPENAI_KEY = config.openaiKey;
  if (config.claudeKey !== undefined) CLAUDE_KEY = config.claudeKey;
  if (config.deepseekKey !== undefined) DEEPSEEK_KEY = config.deepseekKey;
  if (config.mistralKey !== undefined) MISTRAL_KEY = config.mistralKey;
  if (config.llamaKey !== undefined) LLAMA_KEY = config.llamaKey;
  if (config.perplexityKey !== undefined) PERPLEXITY_KEY = config.perplexityKey;
  if (config.julesApiKey !== undefined) JULES_KEY = config.julesApiKey;
  if (config.projectRoot && fs.existsSync(config.projectRoot)) currentProjectRoot = config.projectRoot;
  saveGlobalState(); return { success: true };
});

ipcMain.handle('get-api-config', () => ({
  geminiKey: GEMINI_KEY, githubToken: GITHUB_TOKEN, openaiKey: OPENAI_KEY, claudeKey: CLAUDE_KEY,
  deepseekKey: DEEPSEEK_KEY, mistralKey: MISTRAL_KEY, llamaKey: LLAMA_KEY, perplexityKey: PERPLEXITY_KEY,
  julesApiKey: JULES_KEY, activeEngine: ACTIVE_ENGINE, projectRoot: currentProjectRoot
}));

ipcMain.handle('get-system-usage', async () => ({
  cpu: (Math.random() * 20 + 5).toFixed(1),
  ram: (os.freemem() / 1024 / 1024 / 1024).toFixed(2),
  threads: os.cpus().length,
  load: os.loadavg()[0].toFixed(2)
}));

ipcMain.handle('get-token-usage', () => tokenStats);
ipcMain.handle('get-project-stats', () => ({ projectRoot: currentProjectRoot, platform: os.platform(), freeMem: (os.freemem() / 1024 / 1024 / 1024).toFixed(2) }));

ipcMain.handle('save-context-snapshot', async (event, snapshot) => {
  const snapshotPath = path.join(currentProjectRoot, '.imi-context-snapshot.json');
  try {
    fs.writeFileSync(snapshotPath, JSON.stringify({ ...snapshot, timestamp: new Date().toISOString(), projectRoot: currentProjectRoot }, null, 2));
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('load-context-snapshot', async () => {
  const snapshotPath = path.join(currentProjectRoot, '.imi-context-snapshot.json');
  if (fs.existsSync(snapshotPath)) {
    try { return JSON.parse(fs.readFileSync(snapshotPath, 'utf-8')); } catch (e) { return null; }
  }
  return null;
});

const verifiedPaths = {};
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

async function triggerGitSync() {
  const gitPath = await checkCommand('git');
  if (!gitPath || !currentProjectRoot) return;
  if (mainWindow) mainWindow.webContents.send('sync-status', 'Syncing');
  const cmd = `"${gitPath}" add . && "${gitPath}" commit -m "IMI Auto-Sync" && "${gitPath}" pull --rebase origin master && "${gitPath}" push origin master`;
  exec(cmd, { cwd: currentProjectRoot }, () => { if (mainWindow) mainWindow.webContents.send('sync-end'); });
}

const getMCPEnv = () => {
  let mcpEnv = {};
  mcpServersList.forEach(s => { if (s.env) mcpEnv = { ...mcpEnv, ...s.env }; });
  return mcpEnv;
};

ipcMain.on('execute-command-stream', async (event, payload) => {
  const { command, director, messageId } = payload;
  if (['gemini', 'jules', 'antigravity'].includes(director)) {
    const binPath = await checkCommand(director);
    if (!binPath) { event.sender.send('command-error', { messageId, error: `${director} not found.` }); return; }
    const prefix = "FAST ARCHITECT MODE: Provide a concise surgical plan. Solve folder conflicts by adding .txt. ";
    let fullCmd = `"${binPath}"`;
    if (director === 'gemini') fullCmd += ` -m gemini-3-flash-preview -p ${shellEscape(prefix + command)}`;
    else if (director === 'jules') fullCmd += ` new ${shellEscape(prefix + command)}`;
    else fullCmd += ` chat ${shellEscape(prefix + command)}`;
    const finalEnv = { ...process.env, ...getMCPEnv(), GEMINI_API_KEY: GEMINI_KEY, JULES_API_KEY: JULES_KEY, FORCE_COLOR: '1' };
    const child = spawn(fullCmd, [], { cwd: currentProjectRoot, shell: true, env: finalEnv });
    let output = '';
    child.stdout.on('data', (d) => { output += d.toString(); event.sender.send('command-chunk', { messageId, chunk: d.toString() }); });
    child.on('close', (code) => {
      event.sender.send('command-end', { messageId, code });
      if (['add', 'create', 'file', 'update', 'change', 'poem', 'story'].some(w => command.toLowerCase().includes(w)) && payload.engine && payload.engine !== director) {
        event.sender.send('command-chunk', { messageId, chunk: `\n\n--- ⚙️ IMI ORCHESTRATOR: HANDING OFF TO ${payload.engine.toUpperCase()} ---` });
        setTimeout(() => triggerCoderImplementation(event, payload.engine, output, messageId), 1000);
      }
      triggerGitSync();
    });
  }
});

async function triggerCoderImplementation(event, engine, brainPlan, messageId) {
  const binPath = await checkCommand('gemini');
  const prompt = `CRITICAL: You are in EXECUTION MODE. Use 'write_file' to implement this plan immediately. Plan: ${brainPlan.trim()}`;
  const fullCmd = `"${binPath}" -m gemini-3-flash-preview --approval-mode yolo -p ${shellEscape(prompt)}`;
  const finalEnv = { ...process.env, ...getMCPEnv(), GEMINI_API_KEY: GEMINI_KEY, FORCE_COLOR: '1' };
  const child = spawn(fullCmd, [], { cwd: currentProjectRoot, shell: true, env: finalEnv });
  child.stdout.on('data', (d) => event.sender.send('command-chunk', { messageId, chunk: d.toString() }));
  child.stderr.on('data', (d) => {
    const chunk = d.toString();
    const noise = ['[MCP error]', 'at McpError', 'at Client', 'node:internal'];
    if (!noise.some(n => chunk.includes(n))) event.sender.send('command-chunk', { messageId, chunk });
  });
  child.on('close', (code) => {
    const gitPath = verifiedPaths['git'];
    if (gitPath) exec(`"${gitPath}" diff --name-only HEAD~1`, { cwd: currentProjectRoot }, (err, stdout) => { if (!err && stdout.trim()) event.sender.send('command-chunk', { messageId, chunk: `\n\n--- 📂 FILES MODIFIED ---\n${stdout.trim()}` }); });
    event.sender.send('command-chunk', { messageId, chunk: `\n\n--- ✅ IMI ORCHESTRATOR: FINISHED ---` });
    event.sender.send('command-end', { messageId, code });
    triggerGitSync();
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({ width: 1400, height: 900, frame: false, transparent: true, webPreferences: { nodeIntegration: true, contextIsolation: false } });
  if (isDev) mainWindow.loadURL('http://127.0.0.1:3333');
  else mainWindow.loadFile(path.join(__dirname, 'dist', 'index.html'));
}

app.whenReady().then(() => { createWindow(); setInterval(triggerGitSync, 60000); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
ipcMain.on('window-minimize', () => { const win = BrowserWindow.getFocusedWindow(); if (win) win.minimize(); });
ipcMain.on('window-maximize', () => { const win = BrowserWindow.getFocusedWindow(); if (win) { if (win.isMaximized()) win.unmaximize(); else win.maximize(); } });
ipcMain.on('window-close', () => { const win = BrowserWindow.getFocusedWindow(); if (win) win.close(); });
ipcMain.handle('mcp:global-list', () => ({ success: true, data: mcpServersList.map(s => `● ${s.name}`).join('\n') }));
ipcMain.handle('mcp:global-add', (e, c) => { mcpServersList.push(c); saveGlobalState(); return { success: true }; });
ipcMain.handle('mcp:global-remove', (e, n) => { mcpServersList = mcpServersList.filter(s => s.name !== n); saveGlobalState(); return { success: true }; });
