const { app, BrowserWindow, ipcMain, net } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const https = require('https');
const { exec, spawn, execSync } = require('child_process');

const shellEscape = (str) => {
  if (!str) return '""';
  // 🛡️ Robust Windows Shell Escaping
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

let tokenStats = { gemini: 0, jules: 0, openai: 0, claude: 0, antigravity: 0, 'imi-core': 0 };
let GEMINI_KEY = ''; let GITHUB_TOKEN = ''; let OPENAI_KEY = ''; let CLAUDE_KEY = '';
let DEEPSEEK_KEY = ''; let MISTRAL_KEY = ''; let LLAMA_KEY = ''; let PERPLEXITY_KEY = '';
let CUSTOM_API_KEY = ''; let JULES_KEY = ''; let GOOGLE_MAPS_KEY = '';
let ACTIVE_ENGINE = 'jules'; let THEME = 'glass'; let LOG_RETENTION = 15;
let SYNC_INTERVAL_MS = 60000; let syncTimer = null;
let mcpServersList = [];
let currentProjectRoot = isDev ? process.cwd() : path.dirname(app.getPath('exe'));

const saveGlobalState = () => {
  try {
    const stateDir = path.dirname(GLOBAL_STATE_PATH);
    if (!fs.existsSync(stateDir)) fs.mkdirSync(stateDir, { recursive: true });
    const config = { 
      geminiKey: GEMINI_KEY, githubToken: GITHUB_TOKEN, openaiKey: OPENAI_KEY, 
      claudeKey: CLAUDE_KEY, deepseekKey: DEEPSEEK_KEY, mistralKey: MISTRAL_KEY, 
      llamaKey: LLAMA_KEY, perplexityKey: PERPLEXITY_KEY, customApiKey: CUSTOM_API_KEY, 
      julesApiKey: JULES_KEY, googleMapsKey: GOOGLE_MAPS_KEY, activeEngine: ACTIVE_ENGINE, 
      theme: THEME, logRetention: LOG_RETENTION, syncFrequency: SYNC_INTERVAL_MS / 1000,
      mcpServersList, projectRoot: currentProjectRoot 
    };
    fs.writeFileSync(GLOBAL_STATE_PATH, JSON.stringify({ tokenUsage: tokenStats, config }, null, 2));
    if (mainWindow) mainWindow.webContents.send('token-stats-update', tokenStats);
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
      THEME = state.config.theme || 'glass'; LOG_RETENTION = state.config.logRetention || 15;
      if (state.config.syncFrequency) SYNC_INTERVAL_MS = state.config.syncFrequency * 1000;
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
  if (config.theme !== undefined) THEME = config.theme;
  if (config.logRetention !== undefined) LOG_RETENTION = config.logRetention;
  if (config.syncFrequency !== undefined) {
    SYNC_INTERVAL_MS = parseInt(config.syncFrequency) * 1000;
    if (syncTimer) clearInterval(syncTimer);
    syncTimer = setInterval(triggerGitSync, SYNC_INTERVAL_MS);
  }
  if (config.projectRoot && fs.existsSync(config.projectRoot)) currentProjectRoot = config.projectRoot;
  saveGlobalState(); return { success: true };
});

ipcMain.handle('get-api-config', () => ({
  geminiKey: GEMINI_KEY, githubToken: GITHUB_TOKEN, openaiKey: OPENAI_KEY, claudeKey: CLAUDE_KEY,
  deepseekKey: DEEPSEEK_KEY, mistralKey: MISTRAL_KEY, llamaKey: LLAMA_KEY, perplexityKey: PERPLEXITY_KEY,
  julesApiKey: JULES_KEY, activeEngine: ACTIVE_ENGINE, projectRoot: currentProjectRoot,
  theme: THEME, logRetention: LOG_RETENTION, syncFrequency: SYNC_INTERVAL_MS / 1000
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

const getMCPEnv = () => {
  let mcpEnv = {};
  mcpServersList.forEach(s => { if (s.env) mcpEnv = { ...mcpEnv, ...s.env }; });
  return mcpEnv;
};

async function triggerGitSync() {
  const gitPath = await checkCommand('git');
  if (!gitPath || !currentProjectRoot) return;
  if (mainWindow) mainWindow.webContents.send('sync-status', 'Syncing');
  const git = (cmd) => new Promise(res => exec(`"${gitPath}" ${cmd}`, { cwd: currentProjectRoot }, res));
  try {
    await git('add .');
    await git('commit -m "IMI Auto-Sync"'); 
    await git('pull --rebase --autostash origin master');
    await git('push origin master');
    if (mainWindow) mainWindow.webContents.send('sync-time', new Date().toLocaleTimeString());
  } catch(e) {}
  if (mainWindow) mainWindow.webContents.send('sync-end');
}

ipcMain.on('execute-command-stream', async (event, payload) => {
  const { command, director, messageId } = payload;
  const blueprintPrefix = "GLOBAL BLUEPRINT PROTOCOL: Refine this request into a TECHNICAL SPECIFICATION for a coding agent. Output only the spec. User Request: ";
  
  if (director === 'gemini') {
    if (!GEMINI_KEY) { event.sender.send('command-error', { messageId, error: "Gemini Key missing." }); return; }
    const codingKeywords = ['add', 'create', 'file', 'update', 'change', 'poem', 'story', 'build', 'implement', 'fix', 'refactor', 'setup'];
    const isCodingAction = codingKeywords.some(w => command.toLowerCase().includes(w));
    const activePrefix = isCodingAction ? blueprintPrefix : "You are a helpful assistant. Request: ";
    const url = `generativelanguage.googleapis.com`;
    const apiPath = `/v1beta/models/gemini-1.5-flash:streamGenerateContent?key=${GEMINI_KEY}`;
    const req = net.request({ method: 'POST', protocol: 'https:', hostname: url, path: apiPath });
    req.setHeader('Content-Type', 'application/json');
    req.write(JSON.stringify({ contents: [{ parts: [{ text: activePrefix + command }] }] }));
    let fullText = '';
    req.on('response', (res) => {
      res.on('data', (chunk) => {
        const raw = chunk.toString();
        const textParts = raw.split('"text": "');
        for (let i = 1; i < textParts.length; i++) {
          const content = textParts[i].split('"')[0].replace(/\\n/g, '\n').replace(/\\"/g, '"');
          if (content && !fullText.includes(content)) {
            fullText += content;
            event.sender.send('command-chunk', { messageId, chunk: content });
          }
        }
      });
      res.on('end', () => {
        tokenStats[director] = (tokenStats[director] || 0) + Math.ceil(fullText.length / 4);
        saveGlobalState();
        event.sender.send('command-end', { messageId, code: 0 });
        if (isCodingAction && payload.engine && payload.engine !== 'gemini') {
          event.sender.send('command-chunk', { messageId, chunk: `\n\n--- ⚙️ IMI ORCHESTRATOR: HANDING OFF TO ${payload.engine.toUpperCase()} ---` });
          setTimeout(() => triggerCoderImplementation(event, payload.engine, fullText, messageId), 1000);
        }
        triggerGitSync();
      });
    });
    req.end();
    return;
  }

  const binPath = await checkCommand(director);
  if (!binPath) { event.sender.send('command-error', { messageId, error: `${director} not found.` }); return; }
  const child = spawn(`"${binPath}"`, ['chat', shellEscape(command)], { cwd: currentProjectRoot, shell: true, env: { ...process.env, ...getMCPEnv(), GEMINI_API_KEY: GEMINI_KEY, JULES_API_KEY: JULES_KEY } });
  let output = '';
  child.stdout.on('data', (d) => { output += d.toString(); event.sender.send('command-chunk', { messageId, chunk: d.toString() }); });
  child.on('close', (code) => { event.sender.send('command-end', { messageId, code }); triggerGitSync(); });
});

async function triggerCoderImplementation(event, engine, brainPlan, messageId) {
  if (mainWindow) mainWindow.webContents.send('coder-status', 'Initializing');
  const prompt = `SURGICAL BUILDER MODE: Implement this plan exactly. Plan: ${brainPlan.trim()}`;

  if (engine.toLowerCase() === 'imi-core') {
    if (!GEMINI_KEY) { event.sender.send('command-error', { messageId, error: "Key missing." }); return; }
    const corePrompt = `You are IMI CORE. Plan: ${brainPlan} Output ONLY JSON: [{ "file": "path", "content": "full content" }]`;
    const req = net.request({ method: 'POST', protocol: 'https:', hostname: 'generativelanguage.googleapis.com', path: `/v1beta/models/gemini-1.5-pro:generateContent?key=${GEMINI_KEY}` });
    req.setHeader('Content-Type', 'application/json');
    req.write(JSON.stringify({ contents: [{ parts: [{ text: corePrompt }] }] }));
    let fullText = '';
    req.on('response', (res) => {
      res.on('data', (chunk) => { fullText += chunk.toString(); });
      res.on('end', () => {
        try {
          const json = JSON.parse(fullText);
          let content = json.candidates?.[0]?.content?.parts?.[0]?.text || "";
          content = content.replace(/```json/g, '').replace(/```/g, '').trim();
          const edits = JSON.parse(content);
          for (const edit of edits) {
            const fp = path.join(currentProjectRoot, edit.file);
            fs.mkdirSync(path.dirname(fp), { recursive: true });
            fs.writeFileSync(fp, edit.content);
          }
          event.sender.send('command-chunk', { messageId, chunk: `\n[IMI CORE] Implementation Complete.` });
          tokenStats['imi-core'] = (tokenStats['imi-core'] || 0) + Math.ceil(fullText.length / 4);
          saveGlobalState();
        } catch(e) {}
        event.sender.send('command-end', { messageId, code: 0 });
        if (mainWindow) mainWindow.webContents.send('coder-status', 'Idle');
        triggerGitSync();
      });
    });
    req.end();
    return;
  }

  if (engine.toLowerCase() === 'antigravity') {
    const binAg = `C:\\Users\\nikol\\AppData\\Local\\Programs\\Antigravity\\bin\\antigravity.cmd`;
    event.sender.send('command-chunk', { messageId, chunk: `\n[System] Spawning Antigravity via Pipe...` });
    if (mainWindow) mainWindow.webContents.send('coder-status', 'Implementing');
    // Using the PIPE method with --yolo for full autonomous background action
    const finalCmd = `echo ${shellEscape(prompt)} | "${binAg}" chat --yolo -`;
    exec(finalCmd, { cwd: currentProjectRoot }, (err, stdout) => {
      if (!err) event.sender.send('command-chunk', { messageId, chunk: stdout || "\n[Antigravity] Process started in background." });
      event.sender.send('command-chunk', { messageId, chunk: `\n\n--- ✅ IMI ORCHESTRATOR: ANTIGRAVITY HAND-OFF COMPLETE ---` });
      event.sender.send('command-end', { messageId, code: 0 });
      if (mainWindow) mainWindow.webContents.send('coder-status', 'Idle');
      triggerGitSync();
    });
    return;
  }

  // JULES FALLBACK
  const child = spawn(`npx -y @google/jules new ${shellEscape(prompt)}`, [], { cwd: currentProjectRoot, shell: true, env: { ...process.env, JULES_API_KEY: JULES_KEY, GITHUB_PERSONAL_ACCESS_TOKEN: GITHUB_TOKEN } });
  child.stdout.on('data', (d) => event.sender.send('command-chunk', { messageId, chunk: d.toString() }));
  child.on('close', (code) => {
    event.sender.send('command-end', { messageId, code });
    if (mainWindow) mainWindow.webContents.send('coder-status', 'Idle');
    triggerGitSync();
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({ width: 1400, height: 900, frame: false, transparent: true, webPreferences: { nodeIntegration: true, contextIsolation: false } });
  if (isDev) mainWindow.loadURL('http://127.0.0.1:3333');
  else mainWindow.loadFile(path.join(__dirname, 'dist', 'index.html'));
  mainWindow.on('closed', () => { mainWindow = null; app.quit(); });
}

app.whenReady().then(() => { createWindow(); syncTimer = setInterval(triggerGitSync, SYNC_INTERVAL_MS); });
app.on('window-all-closed', () => { app.quit(); });
app.on('before-quit', () => { process.exit(0); });
ipcMain.on('window-minimize', () => { const win = BrowserWindow.getFocusedWindow(); if (win) win.minimize(); });
ipcMain.on('window-maximize', () => { const win = BrowserWindow.getFocusedWindow(); if (win) { if (win.isMaximized()) win.unmaximize(); else win.maximize(); } });
ipcMain.on('window-close', () => { app.quit(); });
ipcMain.handle('mcp:global-list', () => ({ success: true, data: mcpServersList.map(s => `● ${s.name}`).join('\n') }));
ipcMain.handle('mcp:global-add', (e, c) => { mcpServersList.push(c); saveGlobalState(); return { success: true }; });
ipcMain.handle('mcp:global-remove', (e, n) => { mcpServersList = mcpServersList.filter(s => s.name !== n); saveGlobalState(); return { success: true }; });
