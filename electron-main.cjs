const { app, BrowserWindow, ipcMain, net, shell, session } = require('electron');
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
let CUSTOM_API_KEY = ''; let CUSTOM_API_URL = ''; let CUSTOM_API_MODEL = ''; 
let JULES_KEY = ''; let GOOGLE_MAPS_KEY = '';
let ACTIVE_BRAIN = 'gemini'; let ACTIVE_CODER = 'imi-core'; let THEME = 'glass'; let LOG_RETENTION = 15;
let SYNC_INTERVAL_MS = 60000; let syncTimer = null;
// ≡ƒºá Brain AI config
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
      customApiUrl: CUSTOM_API_URL, customApiModel: CUSTOM_API_MODEL,
      julesApiKey: JULES_KEY, googleMapsKey: GOOGLE_MAPS_KEY, 
      activeBrain: ACTIVE_BRAIN, activeCoder: ACTIVE_CODER,
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
      CUSTOM_API_KEY = state.config.customApiKey || ''; 
      CUSTOM_API_URL = state.config.customApiUrl || '';
      CUSTOM_API_MODEL = state.config.customApiModel || '';
      JULES_KEY = state.config.julesApiKey || '';
      GOOGLE_MAPS_KEY = state.config.googleMapsKey || ''; 
      ACTIVE_BRAIN = state.config.activeBrain || 'gemini';
      ACTIVE_CODER = state.config.activeCoder || state.config.activeEngine || 'imi-core';
      THEME = state.config.theme || 'glass'; LOG_RETENTION = state.config.logRetention || 15;
      if (state.config.syncFrequency) SYNC_INTERVAL_MS = state.config.syncFrequency * 1000;
      // Clean up duplicates if any
      const rawMCPs = state.config.mcpServersList || [];
      mcpServersList = Array.from(new Set(rawMCPs.map(s => s.name)))
        .map(name => rawMCPs.find(s => s.name === name));
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
  if (config.customApiKey !== undefined) CUSTOM_API_KEY = config.customApiKey;
  if (config.customApiUrl !== undefined) CUSTOM_API_URL = config.customApiUrl;
  if (config.customApiModel !== undefined) CUSTOM_API_MODEL = config.customApiModel;
  if (config.julesApiKey !== undefined) JULES_KEY = config.julesApiKey;
  if (config.activeBrain !== undefined) ACTIVE_BRAIN = config.activeBrain;
  if (config.activeCoder !== undefined) ACTIVE_CODER = config.activeCoder;
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
  customApiKey: CUSTOM_API_KEY, customApiUrl: CUSTOM_API_URL, customApiModel: CUSTOM_API_MODEL,
  julesApiKey: JULES_KEY, activeBrain: ACTIVE_BRAIN, activeCoder: ACTIVE_CODER, projectRoot: currentProjectRoot,
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

  // ΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉ
  // ≡ƒºá IMI SYSTEM MEMORY ΓÇö Injected into every Brain request
  // ΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉ
  const PROJECT_CONTEXT = `You are the Brain inside IMI (Integrated Merge Interface), a powerful AI orchestration desktop app built with Electron + React.
Your primary role is the STRATEGY layer (analyzing requests and planning solutions for the Coder engine), BUT you are also a highly capable general assistant. You happily and naturally answer general questions, search the web, give weather updates, write stories, or chat about any random topic the user desires. Never refuse a request just because it's not about IMI.

PROJECT MEMORY:
- App Name: IMI IDE MERGE INTEGRATIONS (version 1.0.4)
- Project Root: ${currentProjectRoot}
- Active Coder Engine: ${ACTIVE_CODER}
- Stack: Electron (electron-main.cjs), React + Vite (src/App.tsx), TypeScript
- Architecture: Brain (strategy AI) ΓåÆ Orchestrator (hand-off) ΓåÆ Coder (implementation)
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
      tools: [{ googleSearch: {} }],
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
            event.sender.send('command-chunk', { messageId, chunk: `\n\n--- ΓÜÖ∩╕Å IMI ORCHESTRATOR: HANDING OFF TO ${payload.engine.toUpperCase()} ---` });
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
  } else if (director === 'custom' || director === 'llama') {
    const codingKeywords = ['add', 'create', 'file', 'update', 'change', 'chanage', 'look', 'poem', 'story', 'build', 'implement', 'fix', 'refactor', 'setup', 'settings', 'better', 'make', 'improve', 'edit'];
    const isCodingAction = codingKeywords.some(w => command.toLowerCase().includes(w));
    const activePrefix = isCodingAction ? blueprintPrefix : chatPrefix;

    if (!CUSTOM_API_URL) { event.sender.send('command-error', { messageId, error: "Custom Endpoint URL missing in Settings." }); return; }
    
    // Parse URL (e.g. http://localhost:11434/v1/chat/completions)
    let apiUrl = CUSTOM_API_URL;
    if (!apiUrl.endsWith('/chat/completions')) apiUrl += apiUrl.endsWith('/') ? 'chat/completions' : '/chat/completions';
    
    const urlObj = new URL(apiUrl);
    const apiModel = CUSTOM_API_MODEL || 'llama3';

    console.log('[IMI Custom Brain] Routing to:', apiUrl, '| Model:', apiModel);
    
    const req = net.request({ method: 'POST', protocol: urlObj.protocol, hostname: urlObj.hostname, port: urlObj.port, path: urlObj.pathname + urlObj.search });
    req.setHeader('Content-Type', 'application/json');
    if (CUSTOM_API_KEY) req.setHeader('Authorization', `Bearer ${CUSTOM_API_KEY}`);
    
    req.write(JSON.stringify({ 
      model: apiModel,
      messages: [{ role: 'system', content: activePrefix }, { role: 'user', content: command }],
      stream: true,
      temperature: BRAIN_TEMPERATURE
    }));

    let fullText = '';
    let buffer = '';

    req.on('response', (res) => {
      if (res.statusCode !== 200) {
        let errBody = '';
        res.on('data', d => errBody += d.toString());
        res.on('end', () => event.sender.send('command-error', { messageId, error: `Custom API HTTP ${res.statusCode}: ${errBody}` }));
        return;
      }
      res.on('data', (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop(); // keep incomplete
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const jsonStr = line.slice(6).trim();
          if (!jsonStr || jsonStr === '[DONE]') continue;
          try {
            const parsed = JSON.parse(jsonStr);
            const text = parsed.choices?.[0]?.delta?.content || '';
            if (text) {
               fullText += text;
               event.sender.send('command-chunk', { messageId, chunk: text });
            }
          } catch(e) {}
        }
      });
      res.on('end', () => {
        if (!fullText) event.sender.send('command-error', { messageId, error: 'No output from Custom API.' });
        else {
          tokenStats['imi-core'] = (tokenStats['imi-core'] || 0) + Math.ceil(fullText.length / 4);
          event.sender.send('command-end', { messageId, code: 0 });
          if (isCodingAction && payload.engine && payload.engine !== director) {
            event.sender.send('command-chunk', { messageId, chunk: `\n\n--- ΓÜÖ∩╕Å IMI ORCHESTRATOR: HANDING OFF TO ${payload.engine.toUpperCase()} ---` });
            setTimeout(() => triggerCoderImplementation(event, payload.engine, fullText, messageId), 1000);
          }
        }
      });
    });
    req.on('error', (err) => event.sender.send('command-error', { messageId, error: `Custom Network Error: ${err.message}` }));
    req.end();
    return;
  }

  const commandName = director === 'geminicli' ? 'gemini' : director;
  let binPath = await checkCommand(commandName);
  if (!binPath && process.platform === 'win32') binPath = await checkCommand(`${commandName}.cmd`);
  if (!binPath) binPath = commandName; // Ultimate fallback: let shell:true figure it out

  const safeEnv = { ...process.env, ...getMCPEnv(), GEMINI_API_KEY: GEMINI_KEY, JULES_API_KEY: JULES_KEY };
  delete safeEnv.ELECTRON_RUN_AS_NODE;
  
  const argsString = director === 'geminicli' ? `-p ${shellEscape(command)}` : `chat ${shellEscape(command)}`;
  // Strip ANSI/VT100 escape codes that Gemini CLI emits for its spinner/colours
  const stripAnsi = (str) => str.replace(/\x1B\[[0-9;]*[A-Za-z]|\x1B[()][A-B]|\x1B[>=]|\r/g, '').replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, '');
  const child = spawn(`"${binPath}" ${argsString}`, { cwd: currentProjectRoot, shell: true, env: safeEnv });
  let output = '';
  child.stdout.on('data', (d) => {
    const clean = stripAnsi(d.toString());
    if (!clean.trim()) return; // skip blank / spinner-only frames
    output += clean;
    event.sender.send('command-chunk', { messageId, chunk: clean });
  });
  child.stderr.on('data', (d) => {
    const clean = stripAnsi(d.toString());
    if (clean.trim()) event.sender.send('command-chunk', { messageId, chunk: `\n[CLI] ${clean}` });
  });
  child.on('close', (code) => { event.sender.send('command-end', { messageId, code }); triggerGitSync(); });
});

async function triggerCoderImplementation(event, engine, brainPlan, messageId) {
  if (mainWindow) mainWindow.webContents.send('coder-status', 'Initializing');
  const prompt = `SURGICAL BUILDER MODE: Implement this plan exactly. Plan: ${brainPlan.trim()}`;

  if (engine.toLowerCase() === 'imi-core') {
    if (!GEMINI_KEY) { event.sender.send('command-error', { messageId, error: "Gemini key missing for IMI CORE." }); return; }

    if (mainWindow) mainWindow.webContents.send('coder-status', 'Scanning');
    event.sender.send('command-chunk', { messageId, chunk: `\n[IMI CORE] Reading project files...` });

    // Read current file contents so Gemini knows what actually exists
    const filesToRead = ['electron-main.cjs', 'src/App.tsx', 'src/index.css', 'package.json'];
    let fileContext = '';
    for (const f of filesToRead) {
      const fp = path.join(currentProjectRoot, f);
      if (fs.existsSync(fp)) {
        const raw = fs.readFileSync(fp, 'utf-8');
        // Send first 150 lines per file to stay within token budget  
        const snippet = raw.split('\n').slice(0, 150).join('\n');
        fileContext += `\n\n=== ${f} (first 150 lines) ===\n${snippet}\n=== end ${f} ===`;
      }
    }

    if (mainWindow) mainWindow.webContents.send('coder-status', 'Implementing');
    event.sender.send('command-chunk', { messageId, chunk: `\n[IMI CORE] Generating surgical patches...` });

    const corePrompt = `You are IMI CORE, a surgical code editor. You apply MINIMAL precise changes to fix real project files.

PROJECT: IMI IDE MERGE INTEGRATIONS
Stack: Electron + React/Vite/TypeScript
Root: ${currentProjectRoot}

CURRENT FILE STATE:${fileContext}

BRAIN PLAN TO IMPLEMENT:
${brainPlan.trim()}

OUTPUT: A raw JSON array of patch objects. No markdown, no explanation — ONLY the JSON.
Format: [{ "file": "relative/path", "search": "exact existing text to find", "replace": "replacement text" }]

RULES:
- "search" must be verbatim text that exists right now in the file shown above
- To create a NEW file from scratch, set "search" to exactly "" (empty string)
- Only change lines needed for the plan — do NOT rewrite whole files
- Multiple patches allowed, one per logical change
- If no code change is needed (e.g. plan is just analysis), return []`;

    const coreReq = net.request({
      method: 'POST', protocol: 'https:',
      hostname: 'generativelanguage.googleapis.com',
      path: `/v1beta/models/${BRAIN_MODEL}:generateContent?key=${GEMINI_KEY}`
    });
    coreReq.setHeader('Content-Type', 'application/json');
    coreReq.write(JSON.stringify({
      contents: [{ parts: [{ text: corePrompt }] }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 8192 }
    }));

    let coreRaw = '';
    coreReq.on('response', (res) => {
      res.on('data', (d) => { coreRaw += d.toString(); });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(coreRaw);
          let txt = parsed.candidates?.[0]?.content?.parts?.[0]?.text || '';
          txt = txt.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
          
          const patches = JSON.parse(txt);
          if (!Array.isArray(patches) || patches.length === 0) {
            event.sender.send('command-chunk', { messageId, chunk: `\n\n[IMI CORE] No code changes needed for this request.` });
          } else {
            const results = [];
            for (const patch of patches) {
              if (!patch.file || !patch.search || patch.replace === undefined) continue;
              const fp = path.join(currentProjectRoot, patch.file);
              // Safety: never escape project root
              if (!fp.startsWith(currentProjectRoot)) { results.push(`BLOCKED: ${patch.file} (outside root)`); continue; }
              
              if (patch.search === "") {
                const dir = path.dirname(fp);
                if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
                fs.writeFileSync(fp, patch.replace, 'utf-8');
                results.push(`CREATED: ${patch.file}`);
                continue;
              }

              if (!fs.existsSync(fp)) { results.push(`SKIPPED: ${patch.file} (not found, use search="" to create)`); continue; }
              const original = fs.readFileSync(fp, 'utf-8');
              if (!original.includes(patch.search)) {
                results.push(`SKIPPED: ${patch.file} (search text not found in file)`);
                continue;
              }
              const patched = original.replace(patch.search, patch.replace);
              fs.writeFileSync(fp, patched, 'utf-8');
              results.push(`OK: ${patch.file}`);
            }
            const report = results.map(r => `  ${r}`).join('\n');
            event.sender.send('command-chunk', { messageId, chunk: `\n\n[IMI CORE] Done:\n${report}` });
          }
          tokenStats['imi-core'] = (tokenStats['imi-core'] || 0) + Math.ceil(coreRaw.length / 4);
          saveGlobalState();
        } catch (e) {
          event.sender.send('command-chunk', { messageId, chunk: `\n\n[IMI CORE] Parse error: ${e.message}\nRaw output saved to .imi_core_output.txt` });
          fs.writeFileSync(path.join(currentProjectRoot, '.imi_core_output.txt'), coreRaw, 'utf-8');
        }
        event.sender.send('command-end', { messageId, code: 0 });
        if (mainWindow) mainWindow.webContents.send('coder-status', 'Idle');
        triggerGitSync();
      });
    });
    coreReq.on('error', (err) => {
      event.sender.send('command-chunk', { messageId, chunk: `\n[IMI CORE] Network error: ${err.message}` });
      event.sender.send('command-end', { messageId, code: 1 });
      if (mainWindow) mainWindow.webContents.send('coder-status', 'Idle');
    });
    coreReq.end();
    return;
  }


  if (engine.toLowerCase() === 'antigravity') {
    // [SAFE MODE] Display Brain spec in chat + save task file.
    // Autonomous file-writing is disabled — Gemini rewrites entire files which is destructive.
    // The spec is shown in chat so the human (Antigravity in the IDE) can implement it safely.
    if (mainWindow) mainWindow.webContents.send('coder-status', 'Ready');
    const taskPath = path.join(currentProjectRoot, '.antigravity_task.md');
    const taskContent = `# IMI Orchestration Task\n_Generated: ${new Date().toISOString()}_\n\n${brainPlan.trim()}\n\n---\n_Status: Awaiting implementation_`;
    fs.writeFileSync(taskPath, taskContent, 'utf-8');
    
    // Inject the Auto-Discovery script to automatically click 'Send' in Antigravity
    const autoPilotScript = `
      (async function() {
          console.log("🌉 Connecting to Bridge to bypass CORS...");
          
          let bridgeId = "874C4DBBEE53686E7B3E7D40F12362CC";
          try {
             // Try to Auto-Discover the dynamic Bridge ID so the user doesn't have to keep fixing it
             const r = await fetch("http://127.0.0.1:9000/json/list").catch(e=>null);
             if (r) {
                const j = await r.json();
                if (j && j.length > 0 && j[0].id) bridgeId = j[0].id;
             }
          } catch(err) {}

          const bridgeWs = new WebSocket(\`ws://127.0.0.1:9000/devtools/page/\${bridgeId}\`);
      
          bridgeWs.onopen = () => bridgeWs.send(JSON.stringify({ id: 1, method: "Target.getTargets" }));
          bridgeWs.onmessage = (event) => {
              const data = JSON.parse(event.data);
              if (data.id === 1 && data.result?.targetInfos) {
                  const targets = data.result.targetInfos.filter(t => t.type === 'page' || t.type === 'iframe');
                  console.log(\`🔍 Found \${targets.length} active windows. Scanning for Lexical Editor...\`);
                  bridgeWs.close();
      
                  targets.forEach(target => {
                      const ws = new WebSocket(\`ws://127.0.0.1:9000/devtools/page/\${target.targetId}\`);
                      ws.onopen = () => {
                          ws.send(JSON.stringify({
                              id: 2, method: "Runtime.evaluate",
                              params: {
                                  expression: \`(function() {
                                      const editor = document.querySelector('[data-lexical-editor="true"]');
                                      const sendBtn = document.querySelector('button[data-tooltip-id="input-send-button-send-tooltip"]');
                                      if (editor) {
                                          editor.focus();
                                          document.execCommand('insertText', false, 'execute the task file based on the spec');
                                          if (sendBtn) {
                                              sendBtn.disabled = false;
                                              sendBtn.classList.remove('opacity-50');
                                              setTimeout(() => sendBtn.click(), 50); 
                                              return true;
                                          }
                                      } return false;
                                  })()\`,
                                  userGesture: true
                              }
                          }));
                      };
                      ws.onmessage = () => ws.close();
                      ws.onerror = () => {};
                  });
              }
          };
          bridgeWs.onerror = () => console.error("❌ Bridge failed on 9000. Make sure your IDE/Bridge uses this port.");
      })();
    `;
    if (mainWindow) mainWindow.webContents.executeJavaScript(autoPilotScript);

    event.sender.send('command-chunk', { messageId, chunk: `\n\n--- 🚀 AUTO-ROUTING TO ANTIGRAVITY ---\n\nThe Brain's spec has been saved. The CDP Injection tunnel is actively bypassing security and forcing your IDE to begin implementation...` });
    event.sender.send('command-end', { messageId, code: 0 });
    if (mainWindow) mainWindow.webContents.send('coder-status', 'Idle');
    return;
  }


  // JULES FALLBACK (High Reliability)
  if (mainWindow) mainWindow.webContents.send('coder-status', 'Implementing');
  event.sender.send('command-chunk', { messageId, chunk: `\n[Jules] Launching Jules asynchronous session...` });
  
  // Create a temporary file to hold the prompt to securely bypass Windows CMD 8192-char limit
  const julesPromptPath = path.join(os.tmpdir(), `jules_prompt_${Date.now()}.txt`);
  fs.writeFileSync(julesPromptPath, prompt, 'utf-8');

  let repoString = 'creepybunny99/IMI-IDE-Unified-Sync';
  try {
    const gitUrl = execSync('git config --get remote.origin.url', { cwd: currentProjectRoot }).toString().trim();
    if (gitUrl) {
       const match = gitUrl.match(/github\.com[:/]([^/]+\/[^.]+)(\.git)?$/i);
       if (match) repoString = match[1];
    }
  } catch(e) {}

  const child = spawn(`type "${julesPromptPath}" | jules new --repo ${repoString}`, [], { 
    cwd: currentProjectRoot, 
    shell: true, 
    env: { 
      ...process.env, 
      JULES_API_KEY: JULES_KEY, 
      GOOGLE_API_KEY: JULES_KEY, // Jules frequently requires GOOGLE_API_KEY mapping
      GITHUB_PERSONAL_ACCESS_TOKEN: GITHUB_TOKEN 
    } 
  });
  
  child.stdout.on('data', (d) => event.sender.send('command-chunk', { messageId, chunk: d.toString() }));
  child.stderr.on('data', (d) => event.sender.send('command-chunk', { messageId, chunk: `\n[Sys] ${d.toString()}` }));
  child.on('close', (code) => {
    try { fs.unlinkSync(julesPromptPath); } catch(e) {}
    event.sender.send('command-chunk', { messageId, chunk: `\n[Jules] Process exited with code ${code}.` });
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

app.whenReady().then(() => { 
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    if (permission === 'media') {
      callback(true);
    } else {
      callback(false);
    }
  });
  createWindow(); 
  syncTimer = setInterval(triggerGitSync, SYNC_INTERVAL_MS); 
});
app.on('window-all-closed', () => { app.quit(); });
app.on('before-quit', () => { process.exit(0); });
ipcMain.on('window-minimize', () => { const win = BrowserWindow.getFocusedWindow(); if (win) win.minimize(); });
ipcMain.on('window-maximize', () => { const win = BrowserWindow.getFocusedWindow(); if (win) { if (win.isMaximized()) win.unmaximize(); else win.maximize(); } });
ipcMain.on('window-close', () => { app.quit(); });
ipcMain.handle('mcp:global-list', () => ({ success: true, data: mcpServersList.map(s => `● ${s.name}`).join('\n') }));
ipcMain.handle('mcp:global-add', (e, c) => { mcpServersList.push(c); saveGlobalState(); return { success: true }; });
ipcMain.handle('mcp:global-remove', (e, n) => { mcpServersList = mcpServersList.filter(s => s.name !== n); saveGlobalState(); return { success: true }; });
ipcMain.handle('transcribe-audio', async (e, base64Audio) => {
  if (!GEMINI_KEY) return { success: false, error: "API Key missing." };
  try {
    const postData = JSON.stringify({
      contents: [{
        parts: [
          { text: "Transcribe the following audio exactly. Return ONLY the transcribed text, nothing else. Do not use quotes or markdown." },
          { inlineData: { mimeType: "audio/webm", data: base64Audio } }
        ]
      }],
      generationConfig: { temperature: 0.1 }
    });

    return new Promise((resolve) => {
      const req = net.request({
        method: 'POST', protocol: 'https:',
        hostname: 'generativelanguage.googleapis.com',
        path: `/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`
      });
      req.setHeader('Content-Type', 'application/json');
      req.write(postData);
      
      let body = '';
      req.on('response', (res) => {
        res.on('data', d => body += d.toString());
        res.on('end', () => {
          try {
            const json = JSON.parse(body);
            let text = json.candidates?.[0]?.content?.parts?.[0]?.text || '';
            resolve({ success: true, text: text.trim() });
          } catch(err) {
            resolve({ success: false, error: "Failed to parse API response" });
          }
        });
      });
      req.on('error', err => resolve({ success: false, error: err.message }));
      req.end();
    });
  } catch (err) {
    return { success: false, error: err.message };
  }
});
ipcMain.on('open-external-url', (e, url) => { shell.openExternal(url); });



