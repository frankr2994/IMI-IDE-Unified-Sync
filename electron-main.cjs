const { app, BrowserWindow, ipcMain, net, shell, session, dialog } = require('electron');
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

// ══════════════════════════════════════════════════════════════
// 🗄️  IMI STORE — fast local storage, zero API calls, zero tokens
// ══════════════════════════════════════════════════════════════
const IMI_STORE_PATH = path.join(os.homedir(), '.imi', 'store.json');
const MAX_MESSAGES_PER_PROJECT = 100; // LRU cap per project

class ImiStore {
  constructor() {
    this._mem = {};          // in-memory map (fast reads)
    this._dirty = false;
    this._saveTimer = null;
    this._load();
  }

  _load() {
    try {
      if (fs.existsSync(IMI_STORE_PATH)) {
        this._mem = JSON.parse(fs.readFileSync(IMI_STORE_PATH, 'utf-8'));
      }
    } catch(e) { this._mem = {}; }
  }

  // Debounced write — batches saves, no disk thrashing
  _scheduleSave() {
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => {
      try {
        const dir = path.dirname(IMI_STORE_PATH);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(IMI_STORE_PATH, JSON.stringify(this._mem), 'utf-8');
      } catch(e) { console.error('[ImiStore] save error:', e.message); }
    }, 500);
  }

  get(key, fallback = null) {
    return key in this._mem ? this._mem[key] : fallback;
  }

  set(key, value) {
    this._mem[key] = value;
    this._scheduleSave();
  }

  // Append a chat message, keeping only last MAX_MESSAGES_PER_PROJECT
  appendMessage(projectKey, msg) {
    const k = `chat:${projectKey}`;
    if (!this._mem[k]) this._mem[k] = [];
    this._mem[k].push({ ...msg, ts: Date.now() });
    if (this._mem[k].length > MAX_MESSAGES_PER_PROJECT) {
      this._mem[k] = this._mem[k].slice(-MAX_MESSAGES_PER_PROJECT);
    }
    this._scheduleSave();
  }

  getMessages(projectKey) {
    return this._mem[`chat:${projectKey}`] || [];
  }

  clearMessages(projectKey) {
    delete this._mem[`chat:${projectKey}`];
    this._scheduleSave();
  }
}

const imiStore = new ImiStore();

// ══════════════════════════════════════════════════════════════
// ⚡ SKILL ENGINE — Self-optimizing, zero-token skill system
// Goal: handle 90% of requests without hitting any AI API
// ══════════════════════════════════════════════════════════════
const SKILLS_PATH = path.join(os.homedir(), '.imi', 'skills.json');
const SKILL_TARGET_EFFICIENCY = 90; // % of requests handled by skills
const SKILL_MIN_USES = 2;           // uses before a skill is scored
const SKILL_REMOVE_THRESHOLD = 20;  // score below this → skill gets replaced
const SKILL_AUTO_CREATE_AFTER = 3;  // same pattern N times → auto-create skill

class SkillEngine {
  constructor() {
    this.skills = [];
    this.commandHistory = []; // rolling window for pattern detection
    this.stats = { totalRequests: 0, skillHits: 0, tokensSaved: 0 };
    this._load();
    this._ensureDefaults();
    // Self-optimization loop — runs every 5 minutes
    setInterval(() => this._optimize(), 5 * 60 * 1000);
  }

  _load() {
    try {
      if (fs.existsSync(SKILLS_PATH)) {
        const data = JSON.parse(fs.readFileSync(SKILLS_PATH, 'utf-8'));
        this.skills = data.skills || [];
        this.stats = data.stats || this.stats;
      }
    } catch(e) { this.skills = []; }
  }

  _save() {
    try {
      const dir = path.dirname(SKILLS_PATH);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(SKILLS_PATH, JSON.stringify({ skills: this.skills, stats: this.stats }, null, 2));
    } catch(e) {}
  }

  // 5 built-in default skills — always 0 tokens
  _ensureDefaults() {
    const defaults = [
      { id: 'sk_browser',   name: 'Browser Navigation',    pattern: '\\b(open|go to|navigate|launch|visit)\\b.{0,60}\\b(chrome|browser|http|www|netflix|youtube|gmail|spotify|twitch|reddit|twitter|instagram|facebook|\\.com|\\.org|\\.io|\\.net)\\b', type: 'direct', handler: 'browser',  desc: 'Opens websites instantly via shell — no API call' },
      { id: 'sk_desktop',   name: 'Desktop File/Folder',   pattern: '\\b(create|make|new|add)\\b.{0,40}\\b(folder|file|directory)\\b.{0,60}\\b(desktop|my desktop)\\b|\\b(desktop|my desktop)\\b.{0,60}\\b(create|make|new|add)\\b.{0,40}\\b(folder|file|directory)\\b', type: 'direct', handler: 'desktop', desc: 'Creates files/folders on desktop — no API call' },
      { id: 'sk_stats',     name: 'Project Stats Query',   pattern: '\\b(show|get|what is|how many|display)\\b.{0,30}\\b(stats|status|files|tokens|memory|usage|quota)\\b', type: 'direct', handler: 'stats',   desc: 'Returns live stats without an AI call' },
      { id: 'sk_imi_info',  name: 'What is IMI',           pattern: '\\b(what is|explain|describe|tell me about)\\b.{0,20}\\b(imi|this app|this program|this tool)\\b', type: 'cached', handler: null, cachedResponse: 'IMI (Integrated Merge Interface) is your AI orchestration desktop app. It splits every task between a Brain (plans) and a Coder (executes) to minimize token usage. It controls your browser, desktop, and codebase simultaneously.', desc: 'Cached IMI description — 0 tokens' },
      { id: 'sk_help',      name: 'Help / Capabilities',   pattern: '^\\s*(help|what can you do|capabilities|commands|skills|features)\\s*[?!]?\\s*$', type: 'cached', handler: null, cachedResponse: 'IMI can: open websites, create desktop files/folders, write & edit code, take screenshots, control your browser, sync to GitHub, switch AI models, track token usage, and run self-optimizing skills. Just tell me what you need!', desc: 'Cached help response — 0 tokens' },
      { id: 'sk_installed_models', name: 'List Installed AI Models', pattern: '\\b(what|which|list|show|do i have)\\b.{0,40}\\b(ai|ollama|llm|model|models)\\b.{0,40}\\b(installed|downloaded|on my|available|have)\\b|\\b(installed|downloaded|available)\\b.{0,30}\\b(ai|ollama|llm|model|models)\\b', type: 'direct', handler: 'installed-models', desc: 'Lists installed Ollama models + AI tools — no API call' },
    ];
    for (const d of defaults) {
      if (!this.skills.find(s => s.id === d.id)) {
        this.skills.push({ ...d, uses: 0, tokensSaved: 0, score: 100, active: true, created: Date.now(), autoCreated: false });
      }
    }
    this._save();
  }

  // Try to match a command to a skill — returns skill or null
  match(command) {
    const cmd = command.toLowerCase().trim();
    for (const skill of this.skills) {
      if (!skill.active) continue;
      try {
        if (new RegExp(skill.pattern, 'i').test(cmd)) return skill;
      } catch(e) {}
    }
    return null;
  }

  // Record a skill was used + how many tokens it saved
  recordHit(skillId, tokensSaved = 500) {
    const skill = this.skills.find(s => s.id === skillId);
    if (skill) {
      skill.uses++;
      skill.tokensSaved += tokensSaved;
      skill.score = Math.min(100, Math.round((skill.tokensSaved / Math.max(1, skill.uses * 500)) * 100));
      skill.lastUsed = Date.now();
    }
    this.stats.skillHits++;
    this.stats.tokensSaved += tokensSaved;
    this._save();
  }

  // Record an API call was made (no skill handled it)
  recordMiss(command, tokensUsed = 500) {
    this.stats.totalRequests++;
    this.commandHistory.push({ command: command.toLowerCase().trim(), ts: Date.now(), tokens: tokensUsed });
    if (this.commandHistory.length > 50) this.commandHistory.shift();
    this._checkAutoCreate();
    this._save();
  }

  // Detect repeated patterns and auto-create cached skills
  _checkAutoCreate() {
    const recent = this.commandHistory.slice(-20);
    const wordFreq = {};
    for (const entry of recent) {
      const words = entry.command.replace(/[^a-z0-9 ]/g, '').split(/\s+/).filter(w => w.length > 3);
      for (const w of words) { wordFreq[w] = (wordFreq[w] || 0) + 1; }
    }
    const hotWords = Object.entries(wordFreq).filter(([, count]) => count >= SKILL_AUTO_CREATE_AFTER).map(([w]) => w);
    if (hotWords.length < 2) return;
    const patternId = `sk_auto_${Date.now()}`;
    const alreadyExists = this.skills.some(s => s.autoCreated && hotWords.every(w => s.pattern.includes(w)));
    if (alreadyExists) return;
    const newSkill = {
      id: patternId,
      name: `Auto: ${hotWords.slice(0, 3).join(' ')}`,
      pattern: hotWords.slice(0, 3).map(w => `(?=.*\\b${w}\\b)`).join(''),
      type: 'passthrough', // still calls API but with a compressed prompt
      handler: null,
      cachedResponse: null,
      desc: `Auto-generated from ${SKILL_AUTO_CREATE_AFTER}+ similar requests`,
      uses: 0, tokensSaved: 0, score: 50, active: true,
      created: Date.now(), autoCreated: true
    };
    this.skills.push(newSkill);
    console.log(`[SkillEngine] Auto-created skill: ${newSkill.name}`);
    this._save();
  }

  // Self-optimization: score, remove weak skills, report
  _optimize() {
    let removed = 0;
    this.skills = this.skills.filter(skill => {
      if (skill.autoCreated && skill.uses >= SKILL_MIN_USES && skill.score < SKILL_REMOVE_THRESHOLD) {
        console.log(`[SkillEngine] Removing weak skill: ${skill.name} (score: ${skill.score})`);
        removed++;
        return false;
      }
      return true;
    });
    const efficiency = this.getEfficiency();
    console.log(`[SkillEngine] Optimization pass — efficiency: ${efficiency}% | removed: ${removed} weak skills`);
    if (removed > 0) this._save();
    return { efficiency, removed };
  }

  getEfficiency() {
    if (this.stats.totalRequests === 0) return 0;
    return Math.round((this.stats.skillHits / (this.stats.totalRequests + this.stats.skillHits)) * 100);
  }

  getAll() { return this.skills; }

  addSkill(skill) {
    const id = `sk_custom_${Date.now()}`;
    this.skills.push({ ...skill, id, uses: 0, tokensSaved: 0, score: 100, active: true, created: Date.now(), autoCreated: false });
    this._save();
    return id;
  }

  removeSkill(id) {
    this.skills = this.skills.filter(s => s.id !== id);
    this._save();
  }

  toggleSkill(id) {
    const s = this.skills.find(s => s.id === id);
    if (s) { s.active = !s.active; this._save(); }
  }
}

const skillEngine = new SkillEngine();

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
    // Only start timer if GitHub token is configured
    if (GITHUB_TOKEN && GITHUB_TOKEN.trim()) {
      syncTimer = setInterval(triggerGitSync, SYNC_INTERVAL_MS);
    }
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

// Native folder picker — opens Windows folder browser dialog
ipcMain.handle('browse-folder', async () => {
  try {
    const opts = { title: 'Select Project Folder', defaultPath: currentProjectRoot, properties: ['openDirectory'] };
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, opts)
      : await dialog.showOpenDialog(opts);
    if (!result.canceled && result.filePaths.length > 0) return result.filePaths[0];
  } catch(e) { console.error('[browse-folder]', e.message); }
  return null;
});

// Multi-file/folder selector — lets user pick multiple files or folders at once
ipcMain.handle('browse-multi', async (_e, mode) => {
  try {
    const props = mode === 'files' ? ['openFile', 'multiSelections'] : ['openDirectory', 'multiSelections'];
    const opts = { title: mode === 'files' ? 'Select Files' : 'Select Folders', defaultPath: currentProjectRoot, properties: props };
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, opts)
      : await dialog.showOpenDialog(opts);
    if (!result.canceled) return result.filePaths;
  } catch(e) { console.error('[browse-multi]', e.message); }
  return [];
});

// ── Skill Engine IPC handlers ────────────────────────────────────────────────
ipcMain.handle('skills-get-all',    ()          => ({ skills: skillEngine.getAll(), stats: skillEngine.stats, efficiency: skillEngine.getEfficiency() }));
ipcMain.handle('skills-add',        (_e, skill) => skillEngine.addSkill(skill));
ipcMain.handle('skills-remove',     (_e, id)    => { skillEngine.removeSkill(id); return true; });
ipcMain.handle('skills-toggle',     (_e, id)    => { skillEngine.toggleSkill(id); return true; });
ipcMain.handle('skills-optimize',   ()          => skillEngine._optimize());

// ── ImiStore IPC handlers (no API calls, instant) ────────────────────────────
ipcMain.handle('store-get-messages', (_e, projectKey) => imiStore.getMessages(projectKey || currentProjectRoot));
ipcMain.handle('store-append-message', (_e, projectKey, msg) => { imiStore.appendMessage(projectKey || currentProjectRoot, msg); return true; });
ipcMain.handle('store-clear-messages', (_e, projectKey) => { imiStore.clearMessages(projectKey || currentProjectRoot); return true; });
ipcMain.handle('store-get', (_e, key, fallback) => imiStore.get(key, fallback));
ipcMain.handle('store-set', (_e, key, value) => { imiStore.set(key, value); return true; });

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
  // Only auto-sync if the user has configured a GitHub token — never run silently without it
  if (!GITHUB_TOKEN || !GITHUB_TOKEN.trim()) return;
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
  const cmdLower = command.toLowerCase().trim();

  // ── 🔍 HARDCODED SYSTEM QUERIES — always intercept, no skill file needed ──
  if (/\b(what|which|list|show)\b.{0,50}\b(ai|ollama|llm|model|models)\b.{0,50}\b(installed|have|downloaded|available)\b/i.test(cmdLower)
    || /\b(installed|downloaded)\b.{0,30}\b(ai|ollama|llm|model|models)\b/i.test(cmdLower)) {
    try {
      const ollamaRaw = await new Promise(resolve => exec('ollama list', { timeout: 5000 }, (err, stdout) => resolve(err ? null : stdout.trim())));
      let ollamaSection = '🦙 **Ollama:** Not installed or no models pulled yet.';
      if (ollamaRaw) {
        const lines = String(ollamaRaw).split('\n').slice(1).filter(Boolean);
        ollamaSection = lines.length > 0
          ? `🦙 **Ollama (local models):**\n${lines.map(l => `  • ${l.trim().split(/\s+/).slice(0,2).join('  ')}`).join('\n')}`
          : '🦙 **Ollama:** Installed but no models pulled yet. Use Dev Hub → AI Models to pull one.';
      }
      const aiTools = [
        { name: 'Gemini CLI', cmd: 'gemini --version' },
        { name: 'Claude CLI', cmd: 'claude --version' },
        { name: 'Jules CLI',  cmd: 'jules --version' },
      ];
      const toolChecks = await Promise.all(aiTools.map(t => new Promise(resolve =>
        exec(t.cmd, { timeout: 3000 }, (err, stdout) => resolve(err ? null : { name: t.name, version: stdout.trim().split('\n')[0] }))
      )));
      const installedCLIs = toolChecks.filter(Boolean);
      const cliSection = installedCLIs.length > 0
        ? `🔧 **AI CLI Tools:**\n${installedCLIs.map(t => `  • ${t.name} v${t.version}`).join('\n')}`
        : '🔧 **AI CLI Tools:** None detected.';
      event.sender.send('command-chunk', { messageId, chunk: `⚡ [IMI System]\n\n${ollamaSection}\n\n${cliSection}\n\n💡 Pull more models in **Dev Hub → AI Models**.` });
      event.sender.send('command-end', { messageId, code: 0 });
      return;
    } catch(e) { /* fall through to AI */ }
  }

  // ── ⚡ SKILL ENGINE — check skills FIRST before any API call ──────────────
  const matchedSkill = skillEngine.match(command);
  if (matchedSkill) {
    if (matchedSkill.type === 'cached' && matchedSkill.cachedResponse) {
      // Instant cached response — 0 tokens
      event.sender.send('command-chunk', { messageId, chunk: `⚡ [Skill: ${matchedSkill.name}]\n\n${matchedSkill.cachedResponse}` });
      event.sender.send('command-end', { messageId, code: 0 });
      skillEngine.recordHit(matchedSkill.id, 600);
      return;
    }
    if (matchedSkill.type === 'direct') {
      // Route to existing direct handlers — they record the hit themselves
      if (matchedSkill.handler === 'browser') {
        const cmdL = command.toLowerCase();
        const urlMatch = command.match(/https?:\/\/[^\s]+/i);
        const siteMatch = cmdL.match(/(?:go to|open|visit|navigate to|launch)\s+([a-z0-9.-]+)/i);
        const raw = urlMatch ? urlMatch[0] : siteMatch ? siteMatch[1] : null;
        if (raw) {
          const url = raw.startsWith('http') ? raw : `https://${raw.includes('.') ? raw : raw + '.com'}`;
          shell.openExternal(url);
          event.sender.send('command-chunk', { messageId, chunk: `⚡ [Skill: ${matchedSkill.name}]\n🌐 Opening ${url}` });
          event.sender.send('command-end', { messageId, code: 0 });
          skillEngine.recordHit(matchedSkill.id, 400);
          return;
        }
      }
      if (matchedSkill.handler === 'stats') {
        const reply = `⚡ [Skill: ${matchedSkill.name}]\n📊 Project: ${currentProjectRoot}\n🧠 Brain: ${ACTIVE_BRAIN} | Coder: ${ACTIVE_CODER}\n⚡ Skill efficiency: ${skillEngine.getEfficiency()}% | Tokens saved: ${skillEngine.stats.tokensSaved.toLocaleString()}\n💾 Free RAM: ${(os.freemem()/1024/1024/1024).toFixed(2)}GB`;
        event.sender.send('command-chunk', { messageId, chunk: reply });
        event.sender.send('command-end', { messageId, code: 0 });
        skillEngine.recordHit(matchedSkill.id, 400);
        return;
      }
      if (matchedSkill.handler === 'installed-models') {
        try {
          // Check Ollama models
          const ollamaRaw = await new Promise(resolve => exec('ollama list', { timeout: 5000 }, (err, stdout) => resolve(err ? null : stdout.trim())));
          let ollamaSection = '🦙 **Ollama (local models):** Not installed or no models pulled yet.';
          if (ollamaRaw) {
            const lines = String(ollamaRaw).split('\n').slice(1).filter(Boolean);
            ollamaSection = lines.length > 0
              ? `🦙 **Ollama (local models):**\n${lines.map(l => `  • ${l.trim().split(/\s+/)[0]}`).join('\n')}`
              : '🦙 **Ollama:** Installed but no models pulled yet. Go to Dev Hub → AI Models to pull one.';
          }
          // Check AI CLI tools
          const aiTools = [
            { name: 'Gemini CLI', cmd: 'gemini --version' },
            { name: 'Claude CLI', cmd: 'claude --version' },
            { name: 'Jules CLI',  cmd: 'jules --version' },
          ];
          const toolChecks = await Promise.all(aiTools.map(t => new Promise(resolve =>
            exec(t.cmd, { timeout: 3000 }, (err, stdout) => resolve(err ? null : { name: t.name, version: stdout.trim().split('\n')[0] }))
          )));
          const installedCLIs = toolChecks.filter(Boolean);
          const cliSection = installedCLIs.length > 0
            ? `🔧 **AI CLI Tools:**\n${installedCLIs.map(t => `  • ${t.name} (${t.version})`).join('\n')}`
            : '🔧 **AI CLI Tools:** None detected.';
          const reply = `⚡ [Skill: List Installed AI Models]\n\n${ollamaSection}\n\n${cliSection}\n\n💡 Tip: Pull more local models in **Dev Hub → AI Models**.`;
          event.sender.send('command-chunk', { messageId, chunk: reply });
          event.sender.send('command-end', { messageId, code: 0 });
          skillEngine.recordHit(matchedSkill.id, 600);
          return;
        } catch(e) {
          // Fall through to AI if something goes wrong
        }
      }
      // desktop handler falls through to existing triggerDesktopTask below
    }
    // passthrough: skill matched but still needs API — track as partial hit
    skillEngine.recordHit(matchedSkill.id, 100);
  } else {
    // No skill matched — record miss for pattern analysis + auto-skill creation
    skillEngine.recordMiss(command, 600);
  }
  // ── End skill check — continue to AI ──────────────────────────────────────

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

    // ── Desktop operations ──────────────────────────────────────────────────
    const cmdL = command.toLowerCase();
    const isDesktopOp = /\b(desktop|my desktop)\b/.test(cmdL) && /\b(create|make|new|add|build)\b/.test(cmdL) && /\b(folder|directory|file)\b/.test(cmdL);
    if (isDesktopOp) {
      triggerDesktopTask(event, command, cmdL, messageId);
      return;
    }

    // ── Screen vision — take screenshot + send to Gemini Vision ────────────
    const needsVision = /\b(look at|see|view|check|analyze|read)\b.{0,30}\b(screen|desktop|window|monitor)\b/i.test(command)
      || /\b(screen|desktop|window|monitor)\b.{0,30}\b(look|see|view|check|analyze|read)\b/i.test(command);
    if (needsVision) {
      triggerDesktopVision(event, command, messageId);
      return;
    }

    // ── Browser routing ────────────────────────────────────────────────────
    const isCodeAction = /\b(file|function|component|variable|class|import|export|the app|imi|electron|react|code|script|style|css|json|package)\b/.test(cmdL);

    // Tier 2: full Puppeteer agent — only when real browser automation is needed
    const needsAutomation = !isCodeAction && /\b(screenshot|click|fill|type into|search for|fix.*site|fix.*web|take control|scroll|hover|form|log ?in|sign ?in)\b/.test(cmdL);

    // Tier 1: simple open — instant via shell, zero tokens, zero Puppeteer startup
    const isSimpleOpen = !isCodeAction && !needsAutomation && (
      /\bgo to\b/.test(cmdL) ||
      /https?:\/\//.test(cmdL) ||
      /\b(browser|tab\b|tabs\b|chrome|internet|webpage|website|navigate|browsing)\b/.test(cmdL) ||
      /\b(open|launch|visit)\b/.test(cmdL)
    );

    if (needsAutomation) {
      triggerBrowserAgent(event, command, messageId);
      return;
    }

    if (isSimpleOpen) {
      // Extract explicit URLs first, then resolve bare site names
      const urls = [...command.matchAll(/https?:\/\/[^\s,]+/g)].map(m => m[0]);
      // Words that are browser/UI names, not website names
      const skipWords = /^(chrome|crome|chromium|firefox|edge|safari|browser|browsers|internet|a|an|the|my|up|it|new|tab|tabs|some|and|then|next|also|please|now)$/;
      const siteNames = [...cmdL.matchAll(/(?:go to|open|visit|launch|navigate to)\s+([a-z0-9.-]+)/g)]
        .map(m => m[1].trim())
        .filter(s => !skipWords.test(s))
        .map(s => s.includes('.') ? `https://${s}` : `https://${s}.com`);
      const allUrls = [...new Set([...urls, ...siteNames])];
      if (allUrls.length > 0) {
        allUrls.forEach(u => shell.openExternal(u));
        event.sender.send('command-chunk', { messageId, chunk: allUrls.map(u => `🌐 Opening: ${u}`).join('\n') });
        event.sender.send('command-end', { messageId, code: 0 });
        return;
      }
    }

    const codingKeywords = ['add', 'create', 'file', 'update', 'change', 'chanage', 'look', 'poem', 'build', 'implement', 'fix', 'refactor', 'setup', 'settings', 'better', 'make', 'improve', 'edit'];
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

  // Cleanup output: Strip ANSI codes and filter out diagnostic/stacktrace noise
  const cleanOutput = (str) => {
    // Strip ANSI escape codes
    let clean = str.replace(/\x1B\[[0-9;]*[A-Za-z]|\x1B[()][A-B]|\x1B[>=]|\r/g, '').replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, '');
    // Filter out noisy CLI/MCP diagnostic lines
    const lines = clean.split('\n');
    const filtered = lines.filter(line => {
      const l = line.trim();
      if (!l) return false;
      if (l.startsWith('at ') || l.includes('McpError') || l.includes('[MCP error]') || l.includes('node_modules')) return false;
      if (l.startsWith('Registering notification') || l.includes('Server \'puppeteer\'') || l.includes('listChanged capability')) return false;
      if (l.includes('Scheduling MCP context refresh') || l.includes('Executing MCP context refresh')) return false;
      if (l.includes('MCP context refresh complete') || l.includes('MCP issues detected')) return false;
      if (l.includes('Both GOOGLE_API_KEY and GEMINI_API_KEY are set')) return false;
      return true;
    });
    return filtered.join('\n').trim();
  };

  const child = spawn(`"${binPath}" ${argsString}`, { cwd: currentProjectRoot, shell: true, env: safeEnv });
  let output = '';
  child.stdout.on('data', (d) => {
    const raw = d.toString();
    // Auto-approve Gemini CLI tool prompts autonomously
    if (raw.includes('[y/N]') || raw.includes('Allow this tool call?') || raw.includes('Proceed?')) {
      console.log('[Gemini CLI Logic] Auto-approving tool execution prompt');
      child.stdin.write('y\n');
    }
    
    const clean = cleanOutput(raw);
    if (!clean) return;
    output += clean;
    event.sender.send('command-chunk', { messageId, chunk: clean });
  });
  child.stderr.on('data', (d) => {
    const clean = cleanOutput(d.toString());
    if (clean) console.log(`[Gemini CLI Log]: ${clean}`); // Keep out of UI chat window
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


  // ── JULES CODER ──────────────────────────────────────────────────────────────
  // Jules is cloud/async: submits task → GitHub PR → we poll + pull it back locally
  if (mainWindow) mainWindow.webContents.send('coder-status', 'Implementing');

  // Resolve repo (owner/repo) from git remote
  let repoString = '';
  try {
    const gitUrl = execSync('git config --get remote.origin.url', { cwd: currentProjectRoot }).toString().trim();
    const match = gitUrl.match(/github\.com[:/]([^/]+\/[^.]+?)(\.git)?$/i);
    if (match) repoString = match[1];
  } catch(e) {}

  if (!repoString) {
    event.sender.send('command-chunk', { messageId, chunk: `\n❌ [Jules] Cannot find a GitHub remote for this project.\nMake sure the project is pushed to GitHub and try again.` });
    event.sender.send('command-end', { messageId, code: 1 });
    if (mainWindow) mainWindow.webContents.send('coder-status', 'Idle');
    return;
  }

  if (!GITHUB_TOKEN) {
    event.sender.send('command-chunk', { messageId, chunk: `\n❌ [Jules] GitHub token is missing. Add it in Settings → API Keys.` });
    event.sender.send('command-end', { messageId, code: 1 });
    if (mainWindow) mainWindow.webContents.send('coder-status', 'Idle');
    return;
  }

  // Check Jules CLI is installed
  let julesBin = null;
  for (const name of ['jules', 'jules.cmd', 'jules.exe']) {
    try { julesBin = execSync(`where ${name}`, { timeout: 3000 }).toString().trim().split('\n')[0]; break; } catch(e) {}
  }
  if (!julesBin) {
    event.sender.send('command-chunk', { messageId, chunk: `\n❌ [Jules] Jules CLI not found in PATH.\nInstall it with: npm install -g @google/jules\nOr check https://jules.google.com for setup instructions.` });
    event.sender.send('command-end', { messageId, code: 1 });
    if (mainWindow) mainWindow.webContents.send('coder-status', 'Idle');
    return;
  }

  event.sender.send('command-chunk', { messageId, chunk: `\n🚀 [Jules] Submitting task to GitHub repo: ${repoString}...\n` });

  // Write prompt to temp file (avoids CMD 8192-char limit)
  const julesPromptPath = path.join(os.tmpdir(), `jules_prompt_${Date.now()}.txt`);
  fs.writeFileSync(julesPromptPath, brainPlan.trim(), 'utf-8');

  // Snapshot open PRs BEFORE submission so we can detect the NEW one Jules creates
  const [repoOwner, repoName] = repoString.split('/');
  let prsBefore = [];
  try {
    const prRes = await new Promise((resolve, reject) => {
      const req = net.request({ method: 'GET', protocol: 'https:', hostname: 'api.github.com',
        path: `/repos/${repoOwner}/${repoName}/pulls?state=open&per_page=20` });
      req.setHeader('Authorization', `token ${GITHUB_TOKEN}`);
      req.setHeader('User-Agent', 'IMI-Jules-Bridge/1.0');
      req.setHeader('Accept', 'application/vnd.github.v3+json');
      let raw = '';
      req.on('response', r => { r.on('data', d => raw += d); r.on('end', () => resolve(raw)); });
      req.on('error', reject);
      req.end();
    });
    prsBefore = JSON.parse(prRes).map(p => p.number);
  } catch(e) {}

  const julesEnv = {
    ...process.env,
    JULES_API_KEY: JULES_KEY,
    GOOGLE_API_KEY: JULES_KEY,
    GITHUB_TOKEN: GITHUB_TOKEN,
    GITHUB_PERSONAL_ACCESS_TOKEN: GITHUB_TOKEN
  };

  const child = spawn(julesBin, ['new', '--repo', repoString, '--task', brainPlan.trim().slice(0, 2000)], {
    cwd: currentProjectRoot, shell: false, env: julesEnv
  });

  child.stdout.on('data', d => event.sender.send('command-chunk', { messageId, chunk: d.toString() }));
  child.stderr.on('data', d => {
    const line = d.toString();
    if (line.trim()) event.sender.send('command-chunk', { messageId, chunk: `[Jules] ${line}` });
  });

  child.on('close', async (code) => {
    try { fs.unlinkSync(julesPromptPath); } catch(e) {}

    if (code !== 0) {
      event.sender.send('command-chunk', { messageId, chunk: `\n⚠️ [Jules] Exited with code ${code}. Jules may still be processing in the cloud.` });
    }

    event.sender.send('command-chunk', { messageId, chunk: `\n⏳ [Jules] Task submitted. Polling GitHub for Jules' PR (up to 10 min)...\n` });
    if (mainWindow) mainWindow.webContents.send('coder-status', 'Waiting for Jules PR');

    // Poll GitHub every 30s for up to 10 minutes for a new PR from Jules
    const maxAttempts = 20;
    let attempt = 0;
    let newPR = null;

    const poll = async () => {
      attempt++;
      try {
        const prRes = await new Promise((resolve, reject) => {
          const req = net.request({ method: 'GET', protocol: 'https:', hostname: 'api.github.com',
            path: `/repos/${repoOwner}/${repoName}/pulls?state=open&per_page=20&sort=created&direction=desc` });
          req.setHeader('Authorization', `token ${GITHUB_TOKEN}`);
          req.setHeader('User-Agent', 'IMI-Jules-Bridge/1.0');
          req.setHeader('Accept', 'application/vnd.github.v3+json');
          let raw = '';
          req.on('response', r => { r.on('data', d => raw += d); r.on('end', () => resolve(raw)); });
          req.on('error', reject);
          req.end();
        });
        const prs = JSON.parse(prRes);
        newPR = prs.find(p => !prsBefore.includes(p.number));
      } catch(e) {}

      if (newPR) {
        // Found Jules' PR — pull the branch locally
        event.sender.send('command-chunk', { messageId, chunk: `\n✅ [Jules] PR found: "${newPR.title}" (#${newPR.number})\n🌿 Branch: ${newPR.head.ref}\n⬇️  Pulling changes to your desktop...\n` });
        if (mainWindow) mainWindow.webContents.send('coder-status', 'Pulling Jules Changes');
        try {
          execSync(`git fetch origin ${newPR.head.ref}`, { cwd: currentProjectRoot, timeout: 30000 });
          execSync(`git checkout ${newPR.head.ref}`, { cwd: currentProjectRoot, timeout: 10000 });
          event.sender.send('command-chunk', { messageId, chunk: `✅ [Jules] Branch "${newPR.head.ref}" checked out locally.\nYour files are now updated!\n🔗 PR: ${newPR.html_url}\n` });
        } catch(gitErr) {
          event.sender.send('command-chunk', { messageId, chunk: `⚠️ [Jules] Could not auto-checkout branch: ${gitErr.message}\nManually run: git fetch && git checkout ${newPR.head.ref}\n🔗 PR: ${newPR.html_url}\n` });
        }
        event.sender.send('command-end', { messageId, code: 0 });
        if (mainWindow) mainWindow.webContents.send('coder-status', 'Idle');
        triggerGitSync();
        return;
      }

      if (attempt >= maxAttempts) {
        event.sender.send('command-chunk', { messageId, chunk: `\n⏰ [Jules] Timed out waiting for PR after 10 minutes.\nCheck GitHub manually: https://github.com/${repoString}/pulls\n` });
        event.sender.send('command-end', { messageId, code: 0 });
        if (mainWindow) mainWindow.webContents.send('coder-status', 'Idle');
        return;
      }

      event.sender.send('command-chunk', { messageId, chunk: `⏳ [Jules] Still working... (${attempt}/${maxAttempts}) checking again in 30s\n` });
      setTimeout(poll, 30000);
    };

    // First check after 30s (Jules needs time to start)
    setTimeout(poll, 30000);
  });
}

async function triggerDesktopTask(event, command, cmdL, messageId) {
  // Extract folder name — stop at sentence boundaries (. , then and)
  const folderMatch = command.match(/(?:call(?:ed)?|nam(?:e(?:d)?)?\s+it)\s+["']?([^"'.,\n]+?)["']?\s*(?=[.,]|\bthen\b|\band\b|$)/i)
    || command.match(/folder\s+(?:called?|named?)?\s*["']?([^"'.,\n]+?)["']?\s*(?=[.,]|\bthen\b|\band\b|$)/i);
  const folderName = folderMatch ? folderMatch[1].trim() : 'New Folder';
  const desktopPath = path.join(os.homedir(), 'Desktop', folderName);

  // Step 1: create folder
  try {
    fs.mkdirSync(desktopPath, { recursive: true });
    event.sender.send('command-chunk', { messageId, chunk: `✅ Created folder "${folderName}" on Desktop.\n` });
  } catch(e) {
    event.sender.send('command-chunk', { messageId, chunk: `❌ Folder error: ${e.message}\n` });
    event.sender.send('command-end', { messageId, code: 1 });
    return;
  }

  // Step 2: if command mentions creating a file with code, generate it with Gemini
  const fileRequest = command.match(/(?:make|create|build|put|add)\s+(?:a\s+)?([a-z0-9]+(?:\.[a-z]+)?)\s+file\s+(?:with|containing|that has|inside)?\s*(.+?)(?:\s+and\s+(?:open|launch|run)|\s*$)/i);
  if (!fileRequest && !/\b(html|css|js|file|game|code|script)\b/.test(cmdL)) {
    event.sender.send('command-end', { messageId, code: 0 });
    return;
  }

  // Resolve file extension — reject non-extension words like "new", "simple", "code"
  const validExts = ['html', 'css', 'js', 'ts', 'jsx', 'tsx', 'py', 'json', 'txt', 'md', 'php', 'java', 'cpp', 'c', 'cs'];
  let rawExt = (fileRequest?.[1] || '').toLowerCase().replace(/^\./, '');
  if (!validExts.includes(rawExt)) {
    const typeMatch = cmdL.match(/\b(html|css|javascript|js|typescript|ts|python|py|json|txt|php|jsx|tsx)\b/);
    rawExt = typeMatch ? typeMatch[1].replace('javascript','js').replace('typescript','ts').replace('python','py') : 'html';
  }
  const fileExt = rawExt;
  const fileDesc = fileRequest?.[2] || command;
  const fileName = `${folderName}.${fileExt}`;
  const filePath = path.join(desktopPath, fileName);

  if (!GEMINI_KEY) {
    event.sender.send('command-chunk', { messageId, chunk: '❌ Gemini key missing — cannot generate file content.\n' });
    event.sender.send('command-end', { messageId, code: 1 });
    return;
  }

  event.sender.send('command-chunk', { messageId, chunk: `🧠 Generating ${fileName}...\n` });

  const codePrompt = `Generate a complete, self-contained ${fileExt.toUpperCase()} file for: ${fileDesc}.
Output ONLY the raw file content with no markdown fences, no explanation — just the code.`;

  const req = net.request({ method: 'POST', protocol: 'https:', hostname: 'generativelanguage.googleapis.com',
    path: `/v1beta/models/${BRAIN_MODEL}:generateContent?key=${GEMINI_KEY}` });
  req.setHeader('Content-Type', 'application/json');
  req.write(JSON.stringify({ contents: [{ parts: [{ text: codePrompt }] }],
    generationConfig: { temperature: 0.2, maxOutputTokens: 8192 } }));
  let raw = '';
  req.on('response', res => {
    res.on('data', d => raw += d.toString());
    res.on('end', () => {
      try {
        let code = JSON.parse(raw)?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        code = code.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '').trim();
        fs.writeFileSync(filePath, code, 'utf-8');
        event.sender.send('command-chunk', { messageId, chunk: `✅ Created ${fileName} inside "${folderName}".\n` });
        // Step 3: open the file if requested
        if (/\b(open|launch|run|start|play|show)\b/.test(cmdL)) {
          shell.openExternal(`file:///${filePath.replace(/\\/g, '/')}`);
          event.sender.send('command-chunk', { messageId, chunk: `🚀 Opening ${fileName}...\n` });
        }
      } catch(e) {
        event.sender.send('command-chunk', { messageId, chunk: `❌ File generation error: ${e.message}\n` });
      }
      event.sender.send('command-end', { messageId, code: 0 });
    });
  });
  req.on('error', e => { event.sender.send('command-error', { messageId, error: e.message }); });
  req.end();
}

async function triggerDesktopVision(event, userCommand, messageId) {
  if (!GEMINI_KEY) { event.sender.send('command-error', { messageId, error: 'Gemini key missing.' }); return; }
  event.sender.send('command-chunk', { messageId, chunk: '📸 Capturing your screen...\n' });
  try {
    const { desktopCapturer } = require('electron');
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1920, height: 1080 } });
    if (!sources.length) { event.sender.send('command-error', { messageId, error: 'No screen source found.' }); return; }
    const dataUrl = sources[0].thumbnail.toDataURL();
    const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
    event.sender.send('command-chunk', { messageId, chunk: '🧠 Sending to Gemini Vision...\n' });
    const req = net.request({ method: 'POST', protocol: 'https:', hostname: 'generativelanguage.googleapis.com',
      path: `/v1beta/models/${BRAIN_MODEL}:generateContent?key=${GEMINI_KEY}` });
    req.setHeader('Content-Type', 'application/json');
    req.write(JSON.stringify({ contents: [{ parts: [
      { text: `You are a desktop assistant for IMI. The user said: "${userCommand}". Look at this screenshot of their desktop and respond. If they want to perform an action (create file, move something, etc.), describe exactly what you see and what should be done. Be concise.` },
      { inlineData: { mimeType: 'image/png', data: base64 } }
    ]}], generationConfig: { temperature: 0.3, maxOutputTokens: 1024 } }));
    let raw = '';
    req.on('response', (res) => {
      res.on('data', d => raw += d.toString());
      res.on('end', () => {
        try {
          const txt = JSON.parse(raw)?.candidates?.[0]?.content?.parts?.[0]?.text || 'No response.';
          event.sender.send('command-chunk', { messageId, chunk: txt });
        } catch(e) { event.sender.send('command-chunk', { messageId, chunk: `Parse error: ${e.message}` }); }
        event.sender.send('command-end', { messageId, code: 0 });
      });
    });
    req.on('error', e => { event.sender.send('command-error', { messageId, error: e.message }); });
    req.end();
  } catch(e) {
    event.sender.send('command-error', { messageId, error: `Screen capture failed: ${e.message}` });
  }
}

async function triggerBrowserAgent(event, userCommand, messageId) {
  if (mainWindow) mainWindow.webContents.send('coder-status', 'Browsing');
  event.sender.send('command-chunk', { messageId, chunk: `🌐 [Browser Agent] Launching Gemini with Puppeteer control...\n` });

  let binPath = await checkCommand('gemini');
  if (!binPath && process.platform === 'win32') binPath = await checkCommand('gemini.cmd');
  if (!binPath) binPath = 'gemini';

  const browserPrompt = `You are a browser automation agent with full Chrome control via Puppeteer MCP tools.
Complete this task autonomously: ${userCommand}

Rules:
- When opening MULTIPLE sites, open each one in a NEW TAB using puppeteer_evaluate: window.open('URL', '_blank')
- Only use puppeteer_navigate for the very first URL
- After opening new tabs, use puppeteer_screenshot to confirm each tab loaded
- Use puppeteer_click to click buttons/links
- Use puppeteer_fill to type into forms
- IMPORTANT: When you are done, do NOT close the browser. Leave all tabs open for the user.
- After every puppeteer_navigate or new tab, run this puppeteer_evaluate to inject a visible cursor:
  (function(){if(document.getElementById('imi-cursor'))return;const c=document.createElement('div');c.id='imi-cursor';c.style.cssText='position:fixed;width:22px;height:22px;background:rgba(255,80,0,0.75);border-radius:50%;pointer-events:none;z-index:2147483647;transform:translate(-50%,-50%);transition:left 0.08s,top 0.08s;border:3px solid white;box-shadow:0 0 12px 4px rgba(255,80,0,0.6)';document.body.appendChild(c);document.addEventListener('mousemove',e=>{c.style.left=e.clientX+'px';c.style.top=e.clientY+'px'});})()
- Describe what you are doing at each step`;

  const safeEnv = { ...process.env, ...getMCPEnv(), GEMINI_API_KEY: GEMINI_KEY, PUPPETEER_SLOW_MO: '80' };
  delete safeEnv.ELECTRON_RUN_AS_NODE;

  const stripAnsi = (s) => s.replace(/\x1B\[[0-9;]*[A-Za-z]|\x1B[()][A-B]|\x1B[>=]|\r/g, '').replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, '');

  const child = spawn(`"${binPath}" --yolo -p ${shellEscape(browserPrompt)}`, { cwd: currentProjectRoot, shell: true, env: safeEnv });
  child.stdout.on('data', (d) => {
    const raw = d.toString();
    if (raw.includes('[y/N]') || raw.includes('Allow this tool call?') || raw.includes('Proceed?')) {
      child.stdin.write('y\n');
    }
    const clean = stripAnsi(raw).trim();
    if (clean) event.sender.send('command-chunk', { messageId, chunk: clean + '\n' });
  });
  child.stderr.on('data', (d) => {
    const clean = stripAnsi(d.toString()).trim();
    if (clean) {
      console.log(`[Browser Agent]: ${clean}`);
      // Surface important errors to the UI
      if (clean.includes('Error') || clean.includes('error') || clean.includes('failed') || clean.includes('not found')) {
        event.sender.send('command-chunk', { messageId, chunk: `\n⚠️ ${clean}\n` });
      }
    }
  });
  child.on('close', (code) => {
    if (code !== 0) event.sender.send('command-chunk', { messageId, chunk: `\n[Browser Agent] Exited with code ${code}` });
    event.sender.send('command-end', { messageId, code });
    if (mainWindow) mainWindow.webContents.send('coder-status', 'Idle');
    triggerGitSync();
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({ width: 1400, height: 900, frame: false, transparent: true, webPreferences: { nodeIntegration: true, contextIsolation: false } });
  if (isDev) mainWindow.loadURL('http://127.0.0.1:3333');
  else mainWindow.loadFile(path.join(__dirname, 'dist', 'index.html'));
  // Scale the entire UI up — makes all rem/px values more comfortable on 1080p screens
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.setZoomFactor(1.1);
  });
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
  // Only start auto-sync timer if GitHub token is already saved — user must opt in
  if (GITHUB_TOKEN && GITHUB_TOKEN.trim()) {
    syncTimer = setInterval(triggerGitSync, SYNC_INTERVAL_MS);
  }
});
app.on('window-all-closed', () => { app.quit(); });
app.on('before-quit', () => { process.exit(0); });
ipcMain.on('window-minimize', () => { const win = BrowserWindow.getFocusedWindow(); if (win) win.minimize(); });
ipcMain.on('window-maximize', () => { const win = BrowserWindow.getFocusedWindow(); if (win) { if (win.isMaximized()) win.unmaximize(); else win.maximize(); } });
ipcMain.on('window-close', () => { app.quit(); });
ipcMain.handle('mcp:global-list', () => ({ success: true, data: mcpServersList.map(s => `● ${s.name}`).join('\n') }));
ipcMain.handle('mcp:global-add', (e, c) => { mcpServersList.push(c); saveGlobalState(); return { success: true }; });
ipcMain.handle('mcp:global-remove', (e, n) => { mcpServersList = mcpServersList.filter(s => s.name !== n); saveGlobalState(); return { success: true }; });

// Live npm registry search for MCP packages
ipcMain.handle('npm-search-mcp', async (_e, query) => {
  if (!query || query.trim().length < 2) return { results: [], total: 0 };
  return new Promise((resolve) => {
    const searchTerm = encodeURIComponent(`mcp ${query.trim()}`);
    const req = net.request({
      method: 'GET', protocol: 'https:', hostname: 'registry.npmjs.org',
      path: `/-/v1/search?text=${searchTerm}&size=20&quality=0.6&popularity=0.3&maintenance=0.1`
    });
    req.setHeader('Accept', 'application/json');
    req.setHeader('User-Agent', 'IMI-MCP-Hub/1.0');
    let raw = '';
    req.on('response', res => {
      res.on('data', d => raw += d.toString());
      res.on('end', () => {
        try {
          const data = JSON.parse(raw);
          const results = (data.objects || []).map(obj => ({
            name: obj.package.name,
            description: obj.package.description || 'No description available.',
            version: obj.package.version,
            publisher: obj.package.publisher?.username || 'unknown',
            downloads: Math.round((obj.score?.detail?.popularity || 0) * 1000),
            score: Math.round((obj.score?.final || 0) * 100),
            npmUrl: obj.package.links?.npm || `https://www.npmjs.com/package/${obj.package.name}`,
            repoUrl: obj.package.links?.repository || null,
            keywords: obj.package.keywords || [],
          }));
          resolve({ results, total: data.total || results.length });
        } catch(e) { resolve({ results: [], total: 0, error: e.message }); }
      });
    });
    req.on('error', e => resolve({ results: [], total: 0, error: e.message }));
    req.end();
  });
});
// GitHub repository search
ipcMain.handle('github-search', async (_e, query, sort) => {
  if (!query || query.trim().length < 2) return { results: [], total: 0 };
  return new Promise((resolve) => {
    const q = encodeURIComponent(query.trim());
    const sortBy = sort || 'stars';
    const headers = { 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'IMI-GitHub-Hub/1.0' };
    if (GITHUB_TOKEN) headers['Authorization'] = `token ${GITHUB_TOKEN}`;
    const req = net.request({
      method: 'GET', protocol: 'https:', hostname: 'api.github.com',
      path: `/search/repositories?q=${q}&sort=${sortBy}&order=desc&per_page=24`
    });
    Object.entries(headers).forEach(([k, v]) => req.setHeader(k, v));
    let raw = '';
    req.on('response', res => {
      res.on('data', d => raw += d.toString());
      res.on('end', () => {
        try {
          const data = JSON.parse(raw);
          if (data.message) { resolve({ results: [], total: 0, error: data.message }); return; }
          const results = (data.items || []).map(r => ({
            id: r.id,
            name: r.full_name,
            shortName: r.name,
            owner: r.owner?.login,
            ownerAvatar: r.owner?.avatar_url,
            description: r.description || 'No description.',
            stars: r.stargazers_count,
            forks: r.forks_count,
            language: r.language,
            topics: r.topics || [],
            htmlUrl: r.html_url,
            cloneUrl: r.clone_url,
            updatedAt: r.updated_at,
            license: r.license?.spdx_id || null,
            openIssues: r.open_issues_count,
          }));
          resolve({ results, total: data.total_count || results.length });
        } catch(e) { resolve({ results: [], total: 0, error: e.message }); }
      });
    });
    req.on('error', e => resolve({ results: [], total: 0, error: e.message }));
    req.end();
  });
});

// Clone a GitHub repo to local project folder
ipcMain.handle('github-clone', async (_e, cloneUrl, folderName) => {
  try {
    const dest = path.join(currentProjectRoot, folderName || path.basename(cloneUrl, '.git'));
    if (fs.existsSync(dest)) return { success: false, error: `Folder "${folderName}" already exists.` };
    execSync(`git clone ${cloneUrl} "${dest}"`, { cwd: currentProjectRoot, timeout: 60000 });
    return { success: true, path: dest };
  } catch(e) { return { success: false, error: e.message }; }
});

// ── Installed Tools checker ──────────────────────────────────────────────────
const TOOLS_MANIFEST = [
  { id: 'node',      label: 'Node.js',       cmd: 'node --version',        installUrl: 'https://nodejs.org', category: 'runtime',  icon: '🟢', desc: 'JavaScript runtime — required for IMI' },
  { id: 'npm',       label: 'npm',           cmd: 'npm --version',         installUrl: 'https://nodejs.org', category: 'runtime',  icon: '📦', desc: 'Node package manager' },
  { id: 'npx',       label: 'npx',           cmd: 'npx --version',         installUrl: 'https://nodejs.org', category: 'runtime',  icon: '⚡', desc: 'Run npm packages without installing' },
  { id: 'git',       label: 'Git',           cmd: 'git --version',         installUrl: 'https://git-scm.com', category: 'dev',     icon: '🌿', desc: 'Version control — required for sync' },
  { id: 'python',    label: 'Python',        cmd: 'python --version',      installUrl: 'https://python.org', category: 'runtime',  icon: '🐍', desc: 'Python runtime' },
  { id: 'gemini',    label: 'Gemini CLI',    cmd: 'gemini --version',      installUrl: 'https://github.com/google-gemini/gemini-cli', category: 'ai', icon: '✨', desc: 'Google Gemini CLI — powers the Brain' },
  { id: 'jules',     label: 'Jules CLI',     cmd: 'jules --version',       installUrl: 'https://jules.google.com', category: 'ai',  icon: '🤖', desc: 'Google Jules coding agent' },
  { id: 'ollama',    label: 'Ollama',        cmd: 'ollama --version',      installUrl: 'https://ollama.com', category: 'ai',       icon: '🦙', desc: 'Run AI models locally — zero API cost' },
  { id: 'docker',    label: 'Docker',        cmd: 'docker --version',      installUrl: 'https://docker.com', category: 'dev',      icon: '🐳', desc: 'Container runtime for MCP servers' },
  { id: 'code',      label: 'VS Code',       cmd: 'code --version',        installUrl: 'https://code.visualstudio.com', category: 'editor', icon: '💙', desc: 'Visual Studio Code editor' },
  { id: 'gh',        label: 'GitHub CLI',    cmd: 'gh --version',          installUrl: 'https://cli.github.com', category: 'dev',   icon: '🐙', desc: 'GitHub CLI — manage repos from terminal' },
  { id: 'bun',       label: 'Bun',           cmd: 'bun --version',         installUrl: 'https://bun.sh', category: 'runtime',      icon: '🧅', desc: 'Fast JS runtime & package manager' },
];

ipcMain.handle('check-tools', async () => {
  const execAsync = (cmd) => new Promise(resolve => {
    exec(cmd, { timeout: 4000 }, (err, stdout) => {
      if (err) resolve(null);
      else resolve(stdout.trim().split('\n')[0].replace(/^v/, ''));
    });
  });
  const results = await Promise.all(TOOLS_MANIFEST.map(async tool => {
    const version = await execAsync(tool.cmd);
    return { ...tool, installed: !!version, version: version || null };
  }));
  return results;
});

ipcMain.handle('open-install-url', (_e, url) => { shell.openExternal(url); });

// ── Ollama AI Models ──────────────────────────────────────────────────────────
ipcMain.handle('ollama-list', async () => {
  try {
    const raw = await new Promise((resolve, reject) => exec('ollama list', { timeout: 5000 }, (err, stdout) => err ? reject(err) : resolve(stdout.trim())));
    const lines = String(raw).split('\n').slice(1).filter(Boolean);
    return { success: true, models: lines.map(l => {
      const parts = l.trim().split(/\s+/);
      return { name: parts[0], id: parts[1] || '', size: parts[2] || '', modified: parts.slice(3).join(' ') || '' };
    })};
  } catch(e) { return { success: false, models: [], error: e.message }; }
});

const ollamaPullProcesses = new Map(); // modelName → child process

ipcMain.handle('ollama-pull', async (event, modelName) => {
  return new Promise((resolve) => {
    const child = spawn('ollama', ['pull', modelName], { shell: true });
    ollamaPullProcesses.set(modelName, child);
    let out = '';
    child.stdout.on('data', d => { out += d.toString(); event.sender.send('ollama-pull-progress', { model: modelName, chunk: d.toString() }); });
    child.stderr.on('data', d => { out += d.toString(); event.sender.send('ollama-pull-progress', { model: modelName, chunk: d.toString() }); });
    child.on('close', code => {
      ollamaPullProcesses.delete(modelName);
      resolve({ success: code === 0, cancelled: code !== 0, output: out });
    });
  });
});

ipcMain.handle('ollama-pull-cancel', (_e, modelName) => {
  const child = ollamaPullProcesses.get(modelName);
  if (child) {
    child.kill('SIGTERM');
    ollamaPullProcesses.delete(modelName);
    return { success: true };
  }
  return { success: false, error: 'No active pull found' };
});

ipcMain.handle('ollama-delete', async (_e, modelName) => {
  try { execSync(`ollama rm ${modelName}`, { timeout: 10000 }); return { success: true }; }
  catch(e) { return { success: false, error: e.message }; }
});

// HuggingFace model search — Ollama can pull any GGUF model from HF
ipcMain.handle('hf-search-models', async (_e, query) => {
  if (!query || query.trim().length < 1) return { results: [], total: 0 };
  return new Promise((resolve) => {
    const q = encodeURIComponent(query.trim());
    const req = net.request({
      method: 'GET', protocol: 'https:', hostname: 'huggingface.co',
      path: `/api/models?search=${q}&filter=gguf&sort=downloads&direction=-1&limit=24&full=false`
    });
    req.setHeader('Accept', 'application/json');
    req.setHeader('User-Agent', 'IMI-DevHub/1.0');
    let raw = '';
    req.on('response', res => {
      res.on('data', d => raw += d.toString());
      res.on('end', () => {
        try {
          const models = JSON.parse(raw);
          const results = (Array.isArray(models) ? models : []).map(m => ({
            id: m.modelId || m.id,
            name: m.modelId || m.id,
            author: (m.modelId || m.id || '').split('/')[0],
            downloads: m.downloads || 0,
            likes: m.likes || 0,
            tags: m.tags || [],
            pipeline: m.pipeline_tag || 'text-generation',
            updatedAt: m.lastModified || m.createdAt,
            hfUrl: `https://huggingface.co/${m.modelId || m.id}`,
            ollamaCmd: `hf.co/${m.modelId || m.id}`,
          }));
          resolve({ results, total: results.length });
        } catch(e) { resolve({ results: [], total: 0, error: e.message }); }
      });
    });
    req.on('error', e => resolve({ results: [], total: 0, error: e.message }));
    req.end();
  });
});

ipcMain.handle('ollama-running', async () => {
  try {
    const raw = execSync('ollama ps', { timeout: 4000 }).toString().trim();
    const lines = raw.split('\n').slice(1).filter(Boolean);
    return { success: true, models: lines.map(l => l.split(/\s+/)[0]) };
  } catch(e) { return { success: true, models: [] }; }
});

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



