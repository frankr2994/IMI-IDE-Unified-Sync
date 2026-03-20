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

let tokenStats = { gemini: 0, jules: 0, openai: 0, claude: 0, antigravity: 0, 'imi-core': 0 };
let GEMINI_KEY = ''; let GITHUB_TOKEN = ''; let OPENAI_KEY = ''; let CLAUDE_KEY = '';
let DEEPSEEK_KEY = ''; let MISTRAL_KEY = ''; let LLAMA_KEY = ''; let PERPLEXITY_KEY = '';
let CUSTOM_API_KEY = ''; let JULES_KEY = ''; let GOOGLE_MAPS_KEY = '';
let ACTIVE_ENGINE = 'antigravity'; let THEME = 'glass'; let LOG_RETENTION = 15;
let SYNC_INTERVAL_MS = 60000; let syncTimer = null;
// 🧠 Brain AI config
let BRAIN_MODEL = 'gemini-2.5-flash'; let BRAIN_TEMPERATURE = 0.7; let BRAIN_MAX_TOKENS = 8192; let STRATEGY_VERSION = '1.0.1';
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
  if (config.brainModel !== undefined) BRAIN_MODEL = config.brainModel;
  if (config.brainTemperature !== undefined) BRAIN_TEMPERATURE = parseFloat(config.brainTemperature);
  if (config.brainMaxTokens !== undefined) BRAIN_MAX_TOKENS = parseInt(config.brainMaxTokens);
  if (config.strategyVersion !== undefined) STRATEGY_VERSION = config.strategyVersion;
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
  theme: THEME, logRetention: LOG_RETENTION, syncFrequency: SYNC_INTERVAL_MS / 1000,
  brainModel: BRAIN_MODEL, brainTemperature: BRAIN_TEMPERATURE, brainMaxTokens: BRAIN_MAX_TOKENS, strategyVersion: STRATEGY_VERSION
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

  // ════════════════════════════════════════════
  // 🧠 IMI SYSTEM MEMORY — Injected into every Brain request
  // ════════════════════════════════════════════
  const PROJECT_CONTEXT = `You are the Brain inside IMI (Integrated Merge Interface), a powerful AI orchestration desktop app built with Electron + React.
Your role is to be the STRATEGY layer. You analyze requests, plan solutions, and hand off precise implementation specs to the Coder engine.

PROJECT MEMORY:
- App Name: IMI IDE MERGE INTEGRATIONS (version 1.0.4)
- Project Root: ${currentProjectRoot}
- Active Coder Engine: ${ACTIVE_ENGINE}
- Stack: Electron (electron-main.cjs), React + Vite (src/App.tsx), TypeScript
- Architecture: Brain (strategy AI) → Orchestrator (hand-off) → Coder (implementation)
- The Coder engine is Antigravity (an AI coding assistant in the user's IDE)
- Key files: electron-main.cjs (backend/IPC), src/App.tsx (entire UI)
- The app has these tabs: Dashboard, Command Center, Global MCP, System
- IMI syncs to GitHub repo: creepybunny99/IMI-IDE-Unified-Sync

When the user says "IMI" they mean this app. When they say "my settings" they mean the System tab. When they say "make it look better" they mean update the React UI in src/App.tsx.
Always respond as a knowledgeable collaborator who already knows this project inside out.
`;
  const blueprintPrefix = `${PROJECT_CONTEXT}
GLOBAL BLUEPRINT PROTOCOL: The user wants a CODE CHANGE. Refine their request into a precise TECHNICAL SPECIFICATION for use by the Coder agent (Antigravity). Include: which file(s) to edit, what exact changes to make, and the desired outcome. Be surgical and specific. User Request: `;
  const chatPrefix = `${PROJECT_CONTEXT}
User message: `;

  if (director === 'gemini') {
    if (!GEMINI_KEY) { event.sender.send('command-error', { messageId, error: "Gemini Key missing." }); return; }
    const codingKeywords = ['add', 'create', 'file', 'update', 'change', 'chanage', 'look', 'poem', 'story', 'build', 'implement', 'fix', 'refactor', 'setup', 'settings', 'better', 'make', 'improve', 'edit'];
    const isCodingAction = codingKeywords.some(w => command.toLowerCase().includes(w));
    const activePrefix = isCodingAction ? blueprintPrefix : chatPrefix;
    const hostname = 'generativelanguage.googleapis.com';
    // Use user-configured model (from System > Brain Configuration)
    const apiPath = `/v1beta/models/${BRAIN_MODEL}:streamGenerateContent?alt=sse&key=${GEMINI_KEY}`;
    console.log('[IMI Brain] Model:', BRAIN_MODEL, '| Temp:', BRAIN_TEMPERATURE, '| MaxTokens:', BRAIN_MAX_TOKENS);
    const req = net.request({ method: 'POST', protocol: 'https:', hostname, path: apiPath });
    req.setHeader('Content-Type', 'application/json');
    req.write(JSON.stringify({ 
      contents: [{ parts: [{ text: activePrefix + command }] }],
      generationConfig: { temperature: BRAIN_TEMPERATURE, maxOutputTokens: BRAIN_MAX_TOKENS }
    }));
    let fullText = '';
    let buffer = '';
    req.on('response', (res) => {
      console.log('[IMI Brain] HTTP Status:', res.statusCode);
      if (res.statusCode !== 200) {
        // Collect error body for better messages
        let errBody = '';
        res.on('data', d => errBody += d.toString());
        res.on('end', () => {
          try { const j = JSON.parse(errBody); event.sender.send('command-error', { messageId, error: `API Error: ${j.error.message}` }); }
          catch(e) { event.sender.send('command-error', { messageId, error: `API Error: HTTP ${res.statusCode}` }); }
        });
        return;
      }
      res.on('data', (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop(); // keep incomplete line in buffer
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const jsonStr = line.slice(6).trim();
          if (!jsonStr || jsonStr === '[DONE]') continue;
          try {
            const parsed = JSON.parse(jsonStr);
            const text = parsed && parsed.candidates && parsed.candidates[0] && parsed.candidates[0].content && parsed.candidates[0].content.parts && parsed.candidates[0].content.parts[0] && parsed.candidates[0].content.parts[0].text;
            if (text) {
              fullText += text;
              event.sender.send('command-chunk', { messageId, chunk: text });
            }
            if (parsed && parsed.error) {
              event.sender.send('command-error', { messageId, error: `API Error: ${parsed.error.message}` });
            }
          } catch(e) { /* incomplete JSON chunk, skip */ }
        }
      });
      res.on('end', () => {
        if (!fullText) {
          event.sender.send('command-error', { messageId, error: 'No response from Gemini. Check your API key in System settings.' });
        } else {
          tokenStats[director] = (tokenStats[director] || 0) + Math.ceil(fullText.length / 4);
          saveGlobalState();
          event.sender.send('command-end', { messageId, code: 0 });
          if (isCodingAction && payload.engine && payload.engine !== 'gemini') {
            event.sender.send('command-chunk', { messageId, chunk: `\n\n--- ⚙️ IMI ORCHESTRATOR: HANDING OFF TO ${payload.engine.toUpperCase()} ---` });
            setTimeout(() => triggerCoderImplementation(event, payload.engine, fullText, messageId), 1000);
          }
        }
        triggerGitSync();
      });
    });
    req.on('error', (err) => {
      event.sender.send('command-error', { messageId, error: `Network Error: ${err.message}` });
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
    const req = net.request({ method: 'POST', protocol: 'https:', hostname: 'generativelanguage.googleapis.com', path: `/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}` });
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
    // 🚀 [FULL AUTONOMY] Stage 2: Antigravity calls Gemini to implement the plan directly
    // No task file, no human copy-paste. Brain plan → Gemini Coder → files written to disk.
    if (!GEMINI_KEY) { event.sender.send('command-error', { messageId, error: "Gemini key missing for Antigravity Coder." }); return; }

    if (mainWindow) mainWindow.webContents.send('coder-status', 'Implementing');
    event.sender.send('command-chunk', { messageId, chunk: `\n[Antigravity] Engaging autonomous implementation engine...` });

    const coderPrompt = `You are Antigravity, a precision surgical coding agent working on the IMI project.
Project Root: ${currentProjectRoot}
Stack: Electron (electron-main.cjs) + React/Vite (src/App.tsx) + TypeScript

IMPLEMENTATION PLAN FROM BRAIN:
${brainPlan.trim()}

YOUR TASK: Implement the above plan exactly. Output ONLY a valid JSON array with no markdown fences, no explanation, just the raw JSON:
[{ "file": "relative/path/from/project/root", "content": "COMPLETE file content here" }]

Rules:
- Include the COMPLETE file content for each file (not just the changed parts)  
- Use relative paths from the project root
- Only include files that need to change
- Do NOT include node_modules, dist, or binary files`;

    const req2 = net.request({ 
      method: 'POST', protocol: 'https:', 
      hostname: 'generativelanguage.googleapis.com', 
      path: `/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}` 
    });
    req2.setHeader('Content-Type', 'application/json');
    req2.write(JSON.stringify({ 
      contents: [{ parts: [{ text: coderPrompt }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 65536 }
    }));

    let coderRaw = '';
    req2.on('response', (res2) => {
      res2.on('data', (d) => { coderRaw += d.toString(); });
      res2.on('end', () => {
        try {
          const parsed = JSON.parse(coderRaw);
          let content = parsed.candidates?.[0]?.content?.parts?.[0]?.text || '';
          // Strip markdown fences if model added them despite instructions
          content = content.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
          const edits = JSON.parse(content);
          const results = [];
          for (const edit of edits) {
            if (!edit.file || !edit.content) continue;
            const fp = path.join(currentProjectRoot, edit.file);
            // Safety: never write outside project root
            if (!fp.startsWith(currentProjectRoot)) continue;
            fs.mkdirSync(path.dirname(fp), { recursive: true });
            fs.writeFileSync(fp, edit.content, 'utf-8');
            results.push(edit.file);
          }
          const summary = results.length > 0 
            ? `\n\n✅ [Antigravity] Implementation Complete!\nFiles written:\n${results.map(f => `  • ${f}`).join('\n')}`
            : '\n\n⚠️ [Antigravity] No file edits were returned by the coder.';
          event.sender.send('command-chunk', { messageId, chunk: summary });
          tokenStats['antigravity'] = (tokenStats['antigravity'] || 0) + Math.ceil(coderRaw.length / 4);
          saveGlobalState();
        } catch(e) {
          event.sender.send('command-chunk', { messageId, chunk: `\n\n❌ [Antigravity] Failed to parse coder output: ${e.message}\nRaw response saved to .antigravity_task.md for manual review.` });
          fs.writeFileSync(path.join(currentProjectRoot, '.antigravity_task.md'), coderRaw);
        }
        event.sender.send('command-end', { messageId, code: 0 });
        if (mainWindow) mainWindow.webContents.send('coder-status', 'Idle');
        triggerGitSync();
      });
    });
    req2.on('error', (err) => {
      event.sender.send('command-chunk', { messageId, chunk: `\n[Antigravity] Network error: ${err.message}` });
      event.sender.send('command-end', { messageId, code: 1 });
      if (mainWindow) mainWindow.webContents.send('coder-status', 'Idle');
    });
    req2.end();
    return;
  }

  // JULES FALLBACK (High Reliability)
  const child = spawn(`jules new ${shellEscape(prompt)}`, [], { 
    cwd: currentProjectRoot, 
    shell: true, 
    env: { ...process.env, JULES_API_KEY: JULES_KEY, GITHUB_PERSONAL_ACCESS_TOKEN: GITHUB_TOKEN } 
  });
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
