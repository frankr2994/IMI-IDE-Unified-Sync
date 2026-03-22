const { app, BrowserWindow, ipcMain, net, shell, session, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const https = require('https');
const { exec, spawn, execSync } = require('child_process');

// â”€â”€ File logger — writes to ~/.imi/imi.log, rotates at 2MB â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const IMI_LOG_PATH = path.join(os.homedir(), '.imi', 'imi.log');
const _logStream = (() => {
  try {
    fs.mkdirSync(path.join(os.homedir(), '.imi'), { recursive: true });
    // Rotate if over 2MB
    try { if (fs.statSync(IMI_LOG_PATH).size > 2 * 1024 * 1024) fs.renameSync(IMI_LOG_PATH, IMI_LOG_PATH + '.old'); } catch {}
    return fs.createWriteStream(IMI_LOG_PATH, { flags: 'a' });
  } catch { return null; }
})();
const imiLog = (level, ...args) => {
  const line = `[${new Date().toISOString()}] [${level}] ${args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')}\n`;
  process.stdout.write(line);
  try { _logStream?.write(line); } catch {}
};
// Capture uncaught errors to log
process.on('uncaughtException', (err) => imiLog('ERROR', 'Uncaught:', err.message, err.stack));
process.on('unhandledRejection', (reason) => imiLog('ERROR', 'Unhandled rejection:', reason));
// Patch console methods
const _origLog = console.log, _origErr = console.error, _origWarn = console.warn;
console.log   = (...a) => { _origLog(...a);  imiLog('INFO',  ...a); };
console.error = (...a) => { _origErr(...a);  imiLog('ERROR', ...a); };
console.warn  = (...a) => { _origWarn(...a); imiLog('WARN',  ...a); };

const shellEscape = (str) => {
  if (!str) return '""';
  const escaped = str.replace(/"/g, '""').replace(/\n/g, ' ').replace(/\r/g, '');
  return `"${escaped}"`;
};

let mainWindow = null;
const isDev = process.env.NODE_ENV === 'development';

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// ðŸ—„ï¸  IMI STORE — fast local storage, zero API calls, zero tokens
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
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

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// ⚡ SKILL ENGINE — Self-optimizing, zero-token skill system
// Goal: handle 90% of requests without hitting any AI API
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
const SKILLS_PATH = path.join(os.homedir(), '.imi', 'skills.json');
const SKILL_TARGET_EFFICIENCY = 90; // % of requests handled by skills
const SKILL_MIN_USES = 2;           // uses before a skill is scored
const SKILL_REMOVE_THRESHOLD = 20;  // score below this â†’ skill gets replaced
const SKILL_AUTO_CREATE_AFTER = 3;  // same pattern N times â†’ auto-create skill

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
      { id: 'sk_browser',   name: 'Browser Navigation',    pattern: '\\b(open|go to|navigate|launch|visit)\\b.{0,60}\\b(chrome|browser|http|www|netflix|youtube|gmail|spotify|twitch|reddit|twitter|instagram|facebook|github|stackoverflow|figma|discord|slack|notion|linear|vercel|netlify|supabase|\\.com|\\.org|\\.io|\\.net)\\b', type: 'direct', handler: 'browser',  desc: 'Opens websites instantly via shell — no API call' },
      { id: 'sk_desktop',   name: 'Desktop File/Folder',   pattern: '\\b(create|make|new|add)\\b.{0,25}\\b(folder|file|directory)\\b.{0,60}\\b(desktop|my desktop)\\b|\\b(desktop|my desktop)\\b.{0,60}\\b(create|make|new|add)\\b.{0,25}\\b(folder|file|directory)\\b', type: 'direct', handler: 'desktop', desc: 'Creates files/folders on desktop — no API call' },
      { id: 'sk_stats',     name: 'Project Stats Query',   pattern: '\\b(show|get|what is|how many|display)\\b.{0,30}\\b(stats|status|files|tokens|memory|usage|quota)\\b', type: 'direct', handler: 'stats',   desc: 'Returns live stats without an AI call' },
      { id: 'sk_imi_info',  name: 'What is IMI',           pattern: '\\b(what is|explain|describe|tell me about)\\b.{0,20}\\b(imi|this app|this program|this tool)\\b', type: 'cached', handler: null, cachedResponse: 'IMI (Integrated Merge Interface) is your AI orchestration desktop app. It splits every task between a Brain (plans) and a Coder (executes) to minimize token usage. It controls your browser, desktop, and codebase simultaneously.', desc: 'Cached IMI description — 0 tokens' },
      { id: 'sk_help',      name: 'Help / Capabilities',   pattern: '^\\s*(help|what can you do|capabilities|commands|skills|features)\\s*[?!]?\\s*$', type: 'cached', handler: null, cachedResponse: 'IMI can: open websites, create desktop files/folders, write & edit code, take screenshots, control your browser, sync to GitHub, switch AI models, track token usage, and run self-optimizing skills. Just tell me what you need!', desc: 'Cached help response — 0 tokens' },
      { id: 'sk_installed_models', name: 'List Installed AI Models', pattern: '\\b(what|which|list|show|do i have)\\b.{0,40}\\b(ai|ollama|llm|model|models)\\b.{0,40}\\b(installed|downloaded|on my|available|have)\\b|\\b(installed|downloaded|available)\\b.{0,30}\\b(ai|ollama|llm|model|models)\\b', type: 'direct', handler: 'installed-models', desc: 'Lists installed Ollama models + AI tools — no API call' },
      { id: 'sk_claude_sdk', name: 'Claude Agent SDK', pattern: '\\b(how does claude|claude agent|agent sdk|anthropic sdk|sse event|tool use|agentic loop|how do you think|how do you work|what events|event stream|content_block|message_start|stop_reason|tool_use|how does the ai|how does the brain|how does imi think)\\b', type: 'cached', handler: null, cachedResponse: `ðŸ§  Claude Agent SDK — How IMI's Brain Works\n\nðŸ“¡ SSE EVENT STREAM (every response streams these in order):\n  message_start â†’ content_block_start â†’ content_block_delta â†’ content_block_stop â†’ message_delta â†’ message_stop\n\nðŸ”§ TOOL USE LOOP:\n  1. Claude picks a tool (stop_reason: "tool_use")\n  2. Tool input streams in via input_json_delta events\n  3. Your code executes the tool\n  4. Result sent back as role:user + type:tool_result\n  5. Loop continues until no more tool calls â†’ final answer\n\nðŸ§  HOW CLAUDE REASONS:\n  â€¢ Read before edit — always checks file contents first\n  â€¢ Parallel when independent — multiple tools in one turn\n  â€¢ Sequential when dependent — waits for results before next step\n  â€¢ Minimal footprint — surgical edits, not full rewrites\n  â€¢ Infer intent — never refuses vague requests, always acts\n  â€¢ Complete the task — finishes all steps before reporting done\n\n📦 MODELS:\n  claude-opus-4-5    â†’ deep reasoning (200K ctx)\n  claude-sonnet-4-5  â†’ balanced, IMI default (200K ctx)\n  claude-haiku-3-5   â†’ fast/cheap, high-volume (200K ctx)\n\nðŸ”‘ API: POST api.anthropic.com/v1/messages\n   Headers: x-api-key + anthropic-version: 2023-06-01\n   See Dev Hub â†’ Agent SDK for full reference.`, desc: 'Cached Claude Agent SDK reference — 0 tokens' },
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
  recordHit(skillId, tokensSaved = 500, model = null) {
    const skill = this.skills.find(s => s.id === skillId);
    if (skill) {
      skill.uses++;
      skill.tokensSaved += tokensSaved;
      skill.score = Math.min(100, Math.round((skill.tokensSaved / Math.max(1, skill.uses * 500)) * 100));
      skill.lastUsed = Date.now();
      if (model) {
        if (!skill.modelUsage) skill.modelUsage = {};
        skill.modelUsage[model] = (skill.modelUsage[model] || 0) + 1;
      }
    }
    this.stats.skillHits++;
    this.stats.tokensSaved += tokensSaved;
    // Track global per-model token savings
    if (model) {
      if (!this.stats.modelSavings) this.stats.modelSavings = {};
      this.stats.modelSavings[model] = (this.stats.modelSavings[model] || 0) + tokensSaved;
    }
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

// â”€â”€ Smart Context Engine — Claude Code-style project awareness â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const MEMORY_PATH = path.join(os.homedir(), '.imi', 'memory.json');

class SmartContext {
  constructor() {
    this.memory = { recentChanges: [], decisions: [] };
    this._load();
  }

  _load() {
    try {
      if (fs.existsSync(MEMORY_PATH)) {
        this.memory = JSON.parse(fs.readFileSync(MEMORY_PATH, 'utf-8'));
      }
    } catch(e) { this.memory = { recentChanges: [], decisions: [] }; }
  }

  _save() {
    try {
      const dir = path.dirname(MEMORY_PATH);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(MEMORY_PATH, JSON.stringify(this.memory, null, 2));
    } catch(e) {}
  }

  recordChange(file, description) {
    this.memory.recentChanges.unshift({ file, description, when: Date.now() });
    if (this.memory.recentChanges.length > 20) this.memory.recentChanges = this.memory.recentChanges.slice(0, 20);
    this._save();
  }

  getMemorySummary() {
    if (!this.memory.recentChanges.length) return '';
    const recent = this.memory.recentChanges.slice(0, 8);
    return `RECENT CHANGES (what was done recently):\n` + recent.map(c => {
      const ago = Math.round((Date.now() - c.when) / 60000);
      const timeStr = ago < 60 ? `${ago}m ago` : `${Math.round(ago/60)}h ago`;
      return `  â€¢ [${c.file}] ${c.description} (${timeStr})`;
    }).join('\n');
  }

  // Read only the section of App.tsx relevant to the user's request
  getRelevantCode(command, projectRoot) {
    const cmdL = command.toLowerCase();
    let snippets = [];

    try {
      const cssPath = path.join(projectRoot, 'src', 'index.css');
      const appPath = path.join(projectRoot, 'src', 'App.tsx');

      const needsCSS = /color|font|size|spacing|padding|margin|background|border|shadow|appearance|style|theme|look|css|design/.test(cmdL);
      const needsSidebar = /sidebar|nav|navigation|logo|menu/.test(cmdL);
      const needsCommand = /command center|chat|message|input|send|bubble/.test(cmdL);
      const needsSettings = /setting|config|appearance|api|key|sync/.test(cmdL);
      const needsDashboard = /dashboard|stats|card|quick/.test(cmdL);
      const needsSkills = /skill|optimizer/.test(cmdL);
      const needsDevHub = /dev hub|devhub|tool|model|ollama/.test(cmdL);

      // Always include CSS variables (small, always useful)
      if (fs.existsSync(cssPath)) {
        const css = fs.readFileSync(cssPath, 'utf-8');
        const rootMatch = css.match(/:root\s*\{[^}]+\}/s);
        if (rootMatch) snippets.push(`CSS Variables (src/index.css):\n\`\`\`css\n${rootMatch[0]}\n\`\`\``);

        // Full CSS only if directly asked
        if (needsCSS && !needsSidebar && !needsCommand) {
          snippets.push(`Full src/index.css:\n\`\`\`css\n${css.slice(0, 4000)}\n\`\`\``);
        }
      }

      if (fs.existsSync(appPath)) {
        const app = fs.readFileSync(appPath, 'utf-8');
        const lines = app.split('\n');

        // Helper: extract lines around a keyword match
        const extractAround = (keyword, contextLines = 60) => {
          for (let i = 0; i < lines.length; i++) {
            if (lines[i].toLowerCase().includes(keyword)) {
              const start = Math.max(0, i - 5);
              const end = Math.min(lines.length, i + contextLines);
              return lines.slice(start, end).join('\n');
            }
          }
          return '';
        };

        if (needsSidebar) {
          const s = extractAround('className="sidebar"', 80);
          if (s) snippets.push(`Sidebar code (src/App.tsx):\n\`\`\`tsx\n${s}\n\`\`\``);
        }
        if (needsCommand) {
          const s = extractAround("activeTab === 'command'", 100);
          if (s) snippets.push(`Command Center code (src/App.tsx):\n\`\`\`tsx\n${s}\n\`\`\``);
        }
        if (needsSettings) {
          const s = extractAround("activeTab === 'settings'", 80);
          if (s) snippets.push(`Settings code (src/App.tsx):\n\`\`\`tsx\n${s}\n\`\`\``);
        }
        if (needsDashboard) {
          const s = extractAround("activeTab === 'dashboard'", 80);
          if (s) snippets.push(`Dashboard code (src/App.tsx):\n\`\`\`tsx\n${s}\n\`\`\``);
        }
        if (needsSkills) {
          const s = extractAround("activeTab === 'skills'", 80);
          if (s) snippets.push(`Skills code (src/App.tsx):\n\`\`\`tsx\n${s}\n\`\`\``);
        }
        if (needsDevHub) {
          const s = extractAround("activeTab === 'devhub'", 80);
          if (s) snippets.push(`Dev Hub code (src/App.tsx):\n\`\`\`tsx\n${s}\n\`\`\``);
        }

        // If nothing specific matched, give a compact project map instead
        if (snippets.length <= 1) {
          const stateLines = lines.slice(0, 120).join('\n'); // useState declarations = project map
          snippets.push(`App.tsx state & structure:\n\`\`\`tsx\n${stateLines}\n\`\`\``);
        }
      }
    } catch(e) {}

    return snippets.join('\n\n');
  }

  // Compact project map — structure without full code (always included, very small)
  getProjectMap(projectRoot) {
    try {
      const appPath = path.join(projectRoot, 'src', 'App.tsx');
      if (!fs.existsSync(appPath)) return '';
      const app = fs.readFileSync(appPath, 'utf-8');
      // Extract tab names, state variable names, component structure
      const tabs = [...app.matchAll(/activeTab === '([^']+)'/g)].map(m => m[1]);
      const uniqueTabs = [...new Set(tabs)];
      const states = [...app.matchAll(/const \[(\w+),/g)].map(m => m[1]).slice(0, 30);
      return `PROJECT MAP:\n- Tabs: ${uniqueTabs.join(', ')}\n- Key state: ${states.join(', ')}`;
    } catch(e) { return ''; }
  }
}

const smartContext = new SmartContext();

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// ðŸŽ¨ STYLE ANALYZER — zero tokens, pure local analysis
// Learns user's coding style from their existing files
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
const STYLE_PROFILE_PATH = path.join(os.homedir(), '.imi', 'style-profile.json');

class StyleAnalyzer {
  constructor() {
    this.profile = null;
    this._enabled = true;
    this._load();
  }

  _load() {
    try {
      if (fs.existsSync(STYLE_PROFILE_PATH)) {
        this.profile = JSON.parse(fs.readFileSync(STYLE_PROFILE_PATH, 'utf-8'));
      }
    } catch(e) { this.profile = null; }
  }

  _save() {
    try {
      const dir = path.dirname(STYLE_PROFILE_PATH);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(STYLE_PROFILE_PATH, JSON.stringify(this.profile, null, 2));
    } catch(e) {}
  }

  // Main analysis — scans up to 30 most-recently-modified files, zero API calls
  analyze(projectRoot) {
    if (!projectRoot || !fs.existsSync(projectRoot)) return null;

    const files = [];
    const walk = (dir, depth = 0) => {
      if (depth > 4) return;
      try {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          if (['node_modules','.git','dist','build','.next','coverage','__pycache__'].includes(e.name)) continue;
          const full = path.join(dir, e.name);
          if (e.isDirectory()) { walk(full, depth + 1); continue; }
          if (/\.(ts|tsx|js|jsx)$/.test(e.name) && !e.name.endsWith('.d.ts')) {
            try { files.push({ path: full, mtime: fs.statSync(full).mtimeMs }); } catch(_) {}
          }
        }
      } catch(_) {}
    };
    walk(projectRoot);

    // Most recent 30 files — bias toward what user is actively writing
    files.sort((a, b) => b.mtime - a.mtime);
    const targets = files.slice(0, 30);

    let sp2=0, sp4=0, tabI=0;
    let sqt=0, dqt=0;
    let semi=0, noSemi=0;
    let arrowF=0, namedF=0;
    let constC=0, letC=0;
    let jsdoc=0;
    let namedImp=0, defImp=0;
    let awaitC=0, thenC=0;
    let tsAnn=0;
    let camelC=0, pascalC=0, snakeC=0;

    for (const f of targets) {
      try {
        const raw = fs.readFileSync(f.path, 'utf-8');
        const lines = raw.split('\n').slice(0, 200);

        for (const line of lines) {
          // Indentation — look at first indented line
          const indM = line.match(/^(\s+)\S/);
          if (indM) {
            const ind = indM[1];
            if (ind.includes('\t')) tabI++;
            else if (ind.length % 4 === 0 && ind.length >= 4) sp4++;
            else if (ind.length >= 2) sp2++;
          }
          // Quotes — strip template literals first to avoid counting backtick contents
          const noTpl = line.replace(/`[^`]*`/g, '""');
          sqt += (noTpl.match(/'/g) || []).length;
          dqt += (noTpl.match(/"/g) || []).length;

          // Semicolons — code lines ending with ; vs statement starters without
          const t = line.trim();
          if (t.length > 2 && /;\s*(?:\/\/.*)?$/.test(t)) semi++;
          else if (/^(const|let|var|return|throw|break|continue)\b/.test(t) && !t.endsWith(',') && !t.endsWith('{')) noSemi++;

          // Functions
          if (/(?:=>|= \()/.test(line)) arrowF++;
          if (/\bfunction\s+\w+/.test(line)) namedF++;

          // const vs let
          if (/\bconst\b/.test(line)) constC++;
          if (/\blet\b/.test(line)) letC++;

          // JSDoc
          if (/\/\*\*/.test(line)) jsdoc++;

          // Imports
          if (/^import\s*\{/.test(t)) namedImp++;
          else if (/^import\s+[A-Za-z_$]/.test(t) && !/^import\s*\{/.test(t)) defImp++;

          // Async pattern
          if (/\bawait\b/.test(line)) awaitC++;
          if (/\.then\(/.test(line)) thenC++;

          // TypeScript
          if (/:\s*(string|number|boolean|void|any|null|undefined|Record|Array|Promise|React\.)/.test(line)) tsAnn++;
        }

        // Naming from variable declarations
        for (const m of raw.matchAll(/(?:const|let|var)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/g)) {
          const n = m[1];
          if (n.length < 2) continue;
          if (/^[A-Z]/.test(n)) pascalC++;
          else if (/_/.test(n) && /[a-z]/.test(n[0])) snakeC++;
          else if (/[a-z]/.test(n[0]) && /[A-Z]/.test(n)) camelC++;
        }
      } catch(_) {}
    }

    if (targets.length === 0) return null;

    // Derive dominant pattern for each dimension
    const indent   = tabI > sp2 && tabI > sp4 ? 'tabs' : sp4 > sp2 ? '4 spaces' : '2 spaces';
    const quotes   = sqt > dqt * 1.3 ? 'single' : dqt > sqt * 1.3 ? 'double' : 'single';
    const useSemi  = semi > noSemi * 1.2;
    const useArrow = arrowF > namedF * 1.2;
    const useConst = constC > letC * 1.5;
    const useAsync = awaitC > thenC;
    const isTS     = tsAnn > 5;
    const naming   = pascalC > camelC && pascalC > snakeC ? 'PascalCase'
                   : snakeC > camelC ? 'snake_case' : 'camelCase';
    const impStyle = namedImp > defImp * 1.5 ? 'named' : defImp > namedImp * 1.5 ? 'default' : 'mixed';
    const useJSDoc = jsdoc > 3;

    const rules = [
      `indent: ${indent}`,
      `quotes: ${quotes}`,
      `semicolons: ${useSemi ? 'yes' : 'no'}`,
      `functions: ${useArrow ? 'arrow (=>)' : 'named function keyword'}`,
      `variables: ${useConst ? 'const preferred' : 'let/const mixed'}`,
      `async: ${useAsync ? 'async/await' : '.then() chains'}`,
      `naming: ${naming}`,
      `imports: ${impStyle} imports`,
      useJSDoc ? 'JSDoc on exported functions' : '',
      isTS ? 'TypeScript with full type annotations' : '',
    ].filter(Boolean);

    this.profile = {
      indent, quotes, semicolons: useSemi,
      arrowFunctions: useArrow, constOverLet: useConst,
      asyncAwait: useAsync, typescript: isTS,
      naming, importStyle: impStyle, jsdocComments: useJSDoc,
      filesAnalyzed: targets.length,
      analyzedAt: Date.now(),
      projectRoot,
      rules,
      // Compact block injected into prompts — ~100 tokens max
      compact: `CODING STYLE (match the user's existing patterns exactly):\n${rules.map(r => `â€¢ ${r}`).join('\n')}`,
    };
    this._save();
    return this.profile;
  }

  // Auto-analyze if profile is stale (>30 min) or from a different project root
  autoAnalyzeIfNeeded(projectRoot) {
    if (!projectRoot) return;
    const stale = !this.profile
      || Date.now() - (this.profile.analyzedAt || 0) > 30 * 60 * 1000
      || this.profile.projectRoot !== projectRoot;
    if (stale) {
      try { this.analyze(projectRoot); } catch(_) {}
    }
  }

  getCompactPrompt() {
    if (!this._enabled) return '';
    return this.profile?.compact ? `\n${this.profile.compact}\n` : '';
  }

  setEnabled(val) { this._enabled = val !== false; }

  getProfile() { return this.profile; }
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// ðŸ”­ IMPACT ANALYZER — zero tokens, traverses import graph
// Shows blast radius before any change is applied
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
class ImpactAnalyzer {
  constructor() {
    this._reverseGraph = {}; // absPath â†’ Set<absPath> of files that import it
    this._projectRoot  = '';
  }

  // Build graph from scan data — called lazily before each impact query
  buildFromProjectRoot(projectRoot) {
    if (!projectRoot || !fs.existsSync(projectRoot)) return;
    this._projectRoot = projectRoot;
    this._reverseGraph = {};

    const extensions = ['.ts','.tsx','.js','.jsx'];
    const walk = (dir, depth = 0) => {
      if (depth > 6) return;
      try {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
          if (['node_modules','.git','dist','build','.next','coverage'].includes(e.name)) continue;
          const full = path.join(dir, e.name);
          if (e.isDirectory()) { walk(full, depth + 1); continue; }
          if (!extensions.some(x => e.name.endsWith(x))) continue;
          try {
            const content = fs.readFileSync(full, 'utf-8');
            // Same regex as scan-project-imports — handles multiline imports via 'from' keyword
            const re = /(?:import|from)\s+['"]([^'"]+)['"]/g;
            let m;
            while ((m = re.exec(content)) !== null) {
              const imp = m[1];
              if (!imp.startsWith('.') && !imp.startsWith('/')) continue; // skip npm packages
              const resolved = this._resolveImport(full, imp);
              if (!resolved) continue;
              if (!this._reverseGraph[resolved]) this._reverseGraph[resolved] = new Set();
              this._reverseGraph[resolved].add(full); // full imports resolved
            }
          } catch(_) {}
        }
      } catch(_) {}
    };
    walk(projectRoot);
  }

  _resolveImport(fromFile, importPath) {
    try {
      const dir  = path.dirname(fromFile);
      const base = path.resolve(dir, importPath);
      const exts = ['','.ts','.tsx','.js','.jsx','/index.ts','/index.tsx','/index.js','/index.jsx'];
      for (const ext of exts) {
        const c = base + ext;
        if (fs.existsSync(c)) return c;
      }
      return base; // return unresolved for partial matching
    } catch(_) { return null; }
  }

  // BFS — find all files that will be affected if targetFile changes
  getAffected(targetFile, maxDepth = 3) {
    const abs = path.isAbsolute(targetFile)
      ? targetFile
      : path.resolve(this._projectRoot || '', targetFile);

    const visited = new Set();
    const result  = [];
    const queue   = [{ file: abs, depth: 0 }];

    while (queue.length) {
      const { file, depth } = queue.shift();
      if (visited.has(file) || depth > maxDepth) continue;
      visited.add(file);

      if (depth > 0) {
        const rel = this._projectRoot
          ? path.relative(this._projectRoot, file).replace(/\\/g, '/')
          : file;
        result.push({
          path: rel,
          depth,
          label: depth === 1 ? 'directly imports' : `depends (${depth} levels away)`,
        });
      }

      for (const importer of (this._reverseGraph[file] || new Set())) {
        if (!visited.has(importer)) queue.push({ file: importer, depth: depth + 1 });
      }
    }

    return result.sort((a, b) => a.depth - b.depth).slice(0, 20); // cap at 20
  }
}

const styleAnalyzer  = new StyleAnalyzer();
const impactAnalyzer = new ImpactAnalyzer();

// Auto-analyze style on startup (non-blocking)
// Uses setImmediate so currentProjectRoot is fully initialized before we read it
setImmediate(() => {
  try { styleAnalyzer.autoAnalyzeIfNeeded(currentProjectRoot); }
  catch(e) { console.warn('[StyleAnalyzer] startup analyze failed:', e.message); }
});

// â”€â”€ IMI Agent Tools — used by the agentic loop â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const getAgentToolsDesc = () => `
You are an AI coding agent inside IMI. You have full access to the file system, terminal, screen, and browser.

USER IDENTITY (always available — never ask for this):
- GitHub Username: ${GITHUB_USER || 'creepybunny99'}
- GitHub Repo: ${GITHUB_REPO || 'creepybunny99/IMI-IDE-Unified-Sync'}
- GitHub Profile: https://github.com/${GITHUB_USER || 'creepybunny99'}
- IMI Repo URL: https://github.com/${GITHUB_REPO || 'creepybunny99/IMI-IDE-Unified-Sync'}

AVAILABLE TOOLS:
1.  read_file      {"path": "relative/path", "offset": 0, "limit": 100} — Read file with optional line range (line numbers shown)
2.  write_file     {"file": "relative/path", "content": "full file content"} — Create or overwrite a file
3.  write_patch    {"file": "path", "search": "exact text", "replace": "new text"} — Surgical find-and-replace patch
4.  search_code    {"pattern": "regex", "path": "src/", "file_type": "tsx", "context": 2} — Grep files for pattern with optional context lines
5.  glob           {"pattern": "**/*.tsx", "path": "."} — Find files matching a glob pattern
6.  list_dir       {"path": ".", "depth": 1} — List directory contents with optional recursion depth
7.  get_file_info  {"path": "relative/path"} — Get file metadata: size, line count, modified time
8.  run_build      {} — Run npm run build, returns errors
9.  run_command    {"cmd": "git status"} — Run a terminal command and see output
10. take_screenshot {} — Capture the screen, see what the UI currently looks like
11. read_error     {"file": "path", "line": 392} — Read Â±15 lines around a specific line number
12. open_browser   {"url": "https://github.com/..."} — Open a URL in the default browser
13. done           {"message": "what was done"} — Signal completion

RULES:
- Always read_file before write_patch — use exact text for the search argument.
- For large files use offset+limit to navigate (e.g. offset:100, limit:80 for lines 101-180).
- Use glob to discover files before reading them. Use search_code to find specific symbols or patterns.
- Use write_file only to create new files or fully rewrite small files. Prefer write_patch for surgical edits.
- After every patch run_build to verify. Fix any errors before calling done.
- Use take_screenshot to see the actual UI before making visual changes.
- Use run_command for git, npm, node, python — but never destructive commands.
- NEVER ask the user for their GitHub username — you already have it above.
- BROWSER REFERENCE RESOLUTION: When the user says "open it", "go to it", "show me", or "open the browser" after you have listed or recommended websites, automatically resolve "it" to the most relevant URL from that list (prefer the first or top-recommended one). Never navigate to a partial word or conjunction — always use the full domain (e.g. stockanalysis.com, not "and.com").
- Maximum 20 tool steps. Respond ONLY with: TOOL_CALL: {"tool": "name", "args": {...}}
`;

async function executeAgentTool(toolName, args, projectRoot) {
  const safePath = (p) => {
    const resolved = path.resolve(projectRoot, p.replace(/^\//, ''));
    // Safety: only allow access within project root or desktop
    const desktop = path.join(os.homedir(), 'Desktop');
    if (!resolved.startsWith(projectRoot) && !resolved.startsWith(desktop)) {
      return { error: 'Access denied — path outside project' };
    }
    return { path: resolved };
  };

  try {
    switch (toolName) {
      case 'read_file': {
        const { path: fp, error } = safePath(args.path || '');
        if (error) return error;
        if (!fs.existsSync(fp)) return `File not found: ${args.path}`;
        const content = fs.readFileSync(fp, 'utf-8');
        const lines = content.split('\n');
        const offset = Math.max(0, parseInt(args.offset) || 0);
        // If offset or limit explicitly provided, honour them
        if (args.offset !== undefined || args.limit !== undefined) {
          const limit = Math.min(300, Math.max(1, parseInt(args.limit) || 150));
          const slice = lines.slice(offset, offset + limit);
          const end = offset + slice.length;
          const header = `File: ${args.path} (showing lines ${offset + 1}â€“${end} of ${lines.length})`;
          const hint = end < lines.length ? `\n\n(${lines.length - end} more lines — use offset:${end} to continue)` : '';
          return `${header}\n\`\`\`\n${slice.map((l, i) => `${offset + i + 1}: ${l}`).join('\n')}\n\`\`\`${hint}`;
        }
        // Auto-paginate large files
        if (lines.length > 200) {
          const slice = lines.slice(0, 150);
          return `File: ${args.path} (${lines.length} lines — showing 1â€“150)\n\`\`\`\n${slice.map((l, i) => `${i + 1}: ${l}`).join('\n')}\n\`\`\`\n\n(${lines.length - 150} more lines — use offset:150 to read more, or search_code to find specific sections)`;
        }
        return `File: ${args.path} (${lines.length} lines)\n\`\`\`\n${lines.map((l, i) => `${i + 1}: ${l}`).join('\n')}\n\`\`\``;
      }

      case 'search_code': {
        const pattern = args.pattern || '';
        const searchPath = path.resolve(projectRoot, args.path || 'src');
        const contextLines = Math.min(5, Math.max(0, parseInt(args.context) || 0));
        const fileTypeFilter = args.file_type ? new RegExp(`\\.${args.file_type}$`, 'i') : /\.(tsx?|jsx?|css|json)$/;
        return new Promise(resolve => {
          try {
            let regex;
            try { regex = new RegExp(pattern, 'i'); } catch(e) { resolve(`Invalid regex: ${e.message}`); return; }
            const results = [];
            const walkDir = (dir) => {
              if (!fs.existsSync(dir)) return;
              const entries = fs.readdirSync(dir, { withFileTypes: true });
              for (const e of entries) {
                const full = path.join(dir, e.name);
                if (e.isDirectory() && !['node_modules', '.git', 'dist', '.next', 'build', 'coverage'].includes(e.name)) walkDir(full);
                else if (e.isFile() && fileTypeFilter.test(e.name)) {
                  try {
                    const lines = fs.readFileSync(full, 'utf-8').split('\n');
                    const rel = path.relative(projectRoot, full).replace(/\\/g, '/');
                    lines.forEach((line, i) => {
                      if (regex.test(line)) {
                        if (contextLines > 0) {
                          const before = lines.slice(Math.max(0, i - contextLines), i).map((l, j) => `${Math.max(1, i - contextLines + j + 1)}-  ${l}`);
                          const after  = lines.slice(i + 1, i + 1 + contextLines).map((l, j) => `${i + 2 + j}-  ${l}`);
                          results.push([`${rel}:${i + 1}: ${line.trim()}`, ...before, `${i + 1}:  ${line}`, ...after, '---'].join('\n'));
                        } else {
                          results.push(`${rel}:${i + 1}: ${line.trim()}`);
                        }
                      }
                    });
                  } catch(_) {}
                }
              }
            };
            walkDir(searchPath);
            if (!results.length) { resolve(`No matches found for "${pattern}"`); return; }
            const cap = contextLines > 0 ? 15 : 40;
            const out = results.slice(0, cap).join('\n');
            const extra = results.length > cap ? `\n... (${results.length - cap} more matches)` : '';
            resolve(`Search results for "${pattern}" (${results.length} matches):\n${out}${extra}`);
          } catch(e) { resolve(`Search error: ${e.message}`); }
        });
      }

      case 'list_dir': {
        const { path: dp, error } = safePath(args.path || '.');
        if (error) return error;
        if (!fs.existsSync(dp)) return `Directory not found: ${args.path}`;
        const maxDepth = Math.min(3, Math.max(1, parseInt(args.depth) || 1));
        const lines = [];
        const SKIP = new Set(['node_modules', '.git', 'dist', '.next', 'build', 'coverage', '.cache']);
        const walk = (dir, depth, prefix) => {
          if (depth > maxDepth) return;
          let entries;
          try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
          entries
            .filter(e => !SKIP.has(e.name))
            .sort((a, b) => (b.isDirectory() ? 1 : 0) - (a.isDirectory() ? 1 : 0) || a.name.localeCompare(b.name))
            .forEach((e, idx, arr) => {
              const isLast = idx === arr.length - 1;
              const connector = isLast ? 'â””â”€â”€ ' : 'â”œâ”€â”€ ';
              const icon = e.isDirectory() ? 'ðŸ“' : 'ðŸ“„';
              lines.push(`${prefix}${connector}${icon} ${e.name}`);
              if (e.isDirectory() && depth < maxDepth) {
                walk(path.join(dir, e.name), depth + 1, prefix + (isLast ? '    ' : 'â”‚   '));
              }
            });
        };
        lines.push(`ðŸ“ ${args.path || '.'}`);
        walk(dp, 1, '');
        if (lines.length > 80) { lines.splice(80); lines.push('... (use a more specific path or increase depth)'); }
        return lines.join('\n');
      }

      case 'write_file': {
        const filePath = args.file || args.path || '';
        const { path: fp, error } = safePath(filePath);
        if (error) return error;
        const content = typeof args.content === 'string' ? args.content : '';
        try {
          fs.mkdirSync(path.dirname(fp), { recursive: true });
          fs.writeFileSync(fp, content, 'utf-8');
          smartContext.recordChange(filePath, 'write_file');
          const lineCount = content.split('\n').length;
          return `âœ… Wrote ${filePath} (${lineCount} lines, ${Math.round(content.length / 1024 * 10) / 10}KB)`;
        } catch(e) { return `Write failed: ${e.message}`; }
      }

      case 'glob': {
        const globPattern = args.pattern || '**/*';
        const { path: searchRoot, error } = safePath(args.path || '.');
        if (error) return error;
        const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.next', 'build', 'coverage', '.cache']);
        // Convert glob to regex
        let regexStr = globPattern
          .replace(/[.+^${}()|[\]\\]/g, '\\$&')   // escape regex special chars (not * or ?)
          .replace(/\\\*\\\*/g, '{{DS}}')           // mark **
          .replace(/\\\*/g, '[^/]*')                // * â†’ any char except /
          .replace(/\?/g, '[^/]')                   // ? â†’ single non-slash
          .replace(/\{\{DS\}\}/g, '.*');             // ** â†’ anything including /
        let globRegex;
        try { globRegex = new RegExp(`(^|/)${regexStr}$`, 'i'); } catch { return `Invalid glob pattern: ${globPattern}`; }
        const results = [];
        const walkDir = (dir) => {
          let entries;
          try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
          for (const e of entries) {
            if (SKIP_DIRS.has(e.name)) continue;
            const full = path.join(dir, e.name);
            const rel = path.relative(projectRoot, full).replace(/\\/g, '/');
            if (e.isDirectory()) walkDir(full);
            else if (globRegex.test(rel)) results.push(rel);
          }
        };
        walkDir(searchRoot);
        if (!results.length) return `No files matching "${globPattern}"`;
        results.sort();
        const cap = 60;
        const extra = results.length > cap ? `\n... and ${results.length - cap} more` : '';
        return `Files matching "${globPattern}" (${results.length}):\n${results.slice(0, cap).join('\n')}${extra}`;
      }

      case 'get_file_info': {
        const { path: fp, error } = safePath(args.path || '');
        if (error) return error;
        if (!fs.existsSync(fp)) return `Not found: ${args.path}`;
        const stat = fs.statSync(fp);
        if (stat.isDirectory()) {
          let entries = 0;
          try { entries = fs.readdirSync(fp).length; } catch {}
          return `Directory: ${args.path}\nEntries: ${entries}\nModified: ${stat.mtime.toISOString()}\nCreated: ${stat.birthtime.toISOString()}`;
        }
        let lineCount = 0;
        try { lineCount = fs.readFileSync(fp, 'utf-8').split('\n').length; } catch {}
        return `File: ${args.path}\nSize: ${(stat.size / 1024).toFixed(1)}KB (${stat.size} bytes)\nLines: ${lineCount}\nModified: ${stat.mtime.toISOString()}\nCreated: ${stat.birthtime.toISOString()}`;
      }

      case 'write_patch': {
        const { path: fp, error } = safePath(args.file || '');
        if (error) return error;
        if (!fs.existsSync(fp)) return `File not found: ${args.file}`;
        const original = fs.readFileSync(fp, 'utf-8');
        if (!original.includes(args.search)) {
          // Try to find approximate match
          const lines = original.split('\n');
          const firstLine = (args.search || '').split('\n')[0].trim();
          const approxLine = lines.findIndex(l => l.trim().includes(firstLine.slice(0, 40)));
          if (approxLine >= 0) {
            return `Patch FAILED: Exact match not found in ${args.file}.\nFound similar content at line ${approxLine + 1}:\n${lines.slice(Math.max(0,approxLine-2), approxLine+5).join('\n')}\n\nPlease read the file first and use exact text.`;
          }
          return `Patch FAILED: Could not find the search text in ${args.file}. Read the file first to get exact content.`;
        }
        // Backup and apply
        fs.writeFileSync(fp + '.bak', original, 'utf-8');
        const patched = original.replace(args.search, args.replace);
        fs.writeFileSync(fp, patched, 'utf-8');
        smartContext.recordChange(args.file, (args.search || '').slice(0, 80).replace(/\s+/g, ' '));
        return `Patch applied to ${args.file} successfully.`;
      }

      case 'run_build': {
        return new Promise(resolve => {
          exec('npm run build 2>&1', { cwd: projectRoot, timeout: 60000 }, (err, stdout, stderr) => {
            const output = (stdout + stderr).trim();
            if (err || output.includes('error TS') || output.includes('ERROR')) {
              // Extract just the errors
              const errorLines = output.split('\n').filter(l =>
                l.includes('error') || l.includes('ERROR') || l.includes('Error')
              ).slice(0, 20);
              resolve(`BUILD FAILED:\n${errorLines.join('\n')}\n\nFull output tail:\n${output.slice(-500)}`);
            } else {
              resolve(`BUILD SUCCESS:\n${output.slice(-300)}`);
            }
          });
        });
      }

      case 'read_error': {
        const { path: fp, error } = safePath(args.file || '');
        if (error) return error;
        if (!fs.existsSync(fp)) return `File not found: ${args.file}`;
        const lines = fs.readFileSync(fp, 'utf-8').split('\n');
        const lineNum = parseInt(args.line) || 1;
        const start = Math.max(0, lineNum - 10);
        const end = Math.min(lines.length, lineNum + 10);
        const section = lines.slice(start, end).map((l, i) => `${start + i + 1}: ${l}`).join('\n');
        return `${args.file} lines ${start+1}-${end}:\n\`\`\`\n${section}\n\`\`\``;
      }

      case 'run_command': {
        const cmd = (args.cmd || '').trim();
        if (!cmd) return 'No command provided.';
        // Safety: block destructive commands
        const blocked = /\b(rm\s+-rf|del\s+\/[sf]|format\s+[a-z]:?|rmdir\s+\/s|drop\s+table|shutdown|taskkill|reg\s+(delete|add)|net\s+user|mkfs|fdisk|dd\s+if)\b/i;
        if (blocked.test(cmd)) return `Blocked: "${cmd}" is a destructive command and cannot be run.`;
        return new Promise(resolve => {
          exec(cmd, { cwd: projectRoot, timeout: 30000, maxBuffer: 1024 * 512 }, (err, stdout, stderr) => {
            const out = (stdout + stderr).trim();
            resolve(out ? out.slice(0, 2000) : (err ? `Error: ${err.message}` : '(no output)'));
          });
        });
      }

      case 'take_screenshot': {
        return new Promise(async resolve => {
          try {
            const { desktopCapturer } = require('electron');
            const sources = await desktopCapturer.getSources({
              types: ['screen'],
              thumbnailSize: { width: 1280, height: 720 }
            });
            if (!sources.length) { resolve('No screen source found.'); return; }
            const base64 = sources[0].thumbnail.toPNG().toString('base64');
            // Store the screenshot for use in next Gemini call
            global._lastScreenshot = base64;
            resolve(`SCREENSHOT_TAKEN: Image captured (${Math.round(base64.length * 0.75 / 1024)}KB). It will be included in the next message to Gemini automatically.`);
          } catch(e) {
            resolve(`Screenshot failed: ${e.message}`);
          }
        });
      }

      case 'open_browser': {
        const url = args.url || '';
        if (!url.startsWith('http')) return 'Invalid URL — must start with http:// or https://';
        const { shell } = require('electron');
        await shell.openExternal(url);
        return `Opened browser: ${url}`;
      }

      default:
        return `Unknown tool: ${toolName}`;
    }
  } catch(e) {
    return `Tool error: ${e.message}`;
  }
}

// â”€â”€ Generic model caller — used by debate system (no streaming, returns text) â”€
async function callModelAPI(director, systemPrompt, messages, maxTokens = 8000) {
  // messages: [{role: 'user'|'assistant', content: string}]
  if (director === 'gemini' || !director) {
    if (!GEMINI_KEY) throw new Error('Gemini API key not configured — add it in Settings â†’ APIs');
    const contents = messages.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }]
    }));
    return new Promise((resolve, reject) => {
      const body = JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents,
        generationConfig: { temperature: 0.4, maxOutputTokens: maxTokens }
      });
      const req = https.request({
        hostname: 'generativelanguage.googleapis.com',
        path: `/v1beta/models/${BRAIN_MODEL}:generateContent?key=${GEMINI_KEY}`,
        method: 'POST', headers: { 'Content-Type': 'application/json' }
      }, res => {
        let raw = '';
        res.on('data', d => raw += d);
        res.on('end', () => {
          try {
            const data = JSON.parse(raw);
            if (data.error) throw new Error(data.error.message || 'Gemini API error');
            resolve(data?.candidates?.[0]?.content?.parts?.[0]?.text || '(no response)');
          } catch(e) { reject(e); }
        });
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }

  if (director === 'claude') {
    if (!CLAUDE_KEY) throw new Error('Claude API key not configured — add it in Settings â†’ APIs');
    const body = JSON.stringify({
      model: 'claude-sonnet-4-5',
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: messages.map(m => ({ role: m.role, content: m.content }))
    });
    return new Promise((resolve, reject) => {
      const req = net.request({ method: 'POST', protocol: 'https:', hostname: 'api.anthropic.com', path: '/v1/messages' });
      req.setHeader('Content-Type', 'application/json');
      req.setHeader('x-api-key', CLAUDE_KEY.trim());
      req.setHeader('anthropic-version', '2023-06-01');
      let raw = '';
      req.on('response', res => {
        res.on('data', d => raw += d.toString());
        res.on('end', () => {
          try {
            const data = JSON.parse(raw);
            if (data.error) throw new Error(data.error.message || 'Claude API error');
            resolve(data?.content?.[0]?.text || '(no response)');
          } catch(e) { reject(e); }
        });
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }

  // OpenAI / Groq / Ollama / Custom — all OpenAI-compatible
  let hostname, apiPath, authHeader, model;
  if (director === 'chatgpt') {
    if (!OPENAI_KEY) throw new Error('OpenAI API key not configured');
    hostname = 'api.openai.com'; apiPath = '/v1/chat/completions'; authHeader = `Bearer ${OPENAI_KEY}`; model = 'gpt-4o';
  } else if (director === 'groq') {
    if (!GROQ_KEY) throw new Error('Groq API key not configured');
    hostname = 'api.groq.com'; apiPath = '/openai/v1/chat/completions'; authHeader = `Bearer ${GROQ_KEY}`; model = 'llama-3.3-70b-versatile';
  } else if (director === 'ollama') {
    hostname = '127.0.0.1'; apiPath = '/api/chat'; authHeader = ''; model = CUSTOM_API_MODEL || 'llama3';
  } else if (director === 'custom') {
    try { const u = new URL(CUSTOM_API_URL || 'http://localhost:11434'); hostname = u.hostname; apiPath = u.pathname; } catch { hostname = 'localhost'; apiPath = '/v1/chat/completions'; }
    authHeader = CUSTOM_API_KEY ? `Bearer ${CUSTOM_API_KEY}` : '';
    model = CUSTOM_API_MODEL || 'gpt-4';
  } else {
    return callModelAPI('gemini', systemPrompt, messages, maxTokens);
  }

  const allMsgs = [{ role: 'system', content: systemPrompt }, ...messages.map(m => ({ role: m.role, content: m.content }))];
  const body = JSON.stringify({ model, messages: allMsgs, max_tokens: maxTokens, temperature: 0.4 });

  return new Promise((resolve, reject) => {
    const reqOptions = {
      method: 'POST', hostname, path: apiPath,
      headers: { 'Content-Type': 'application/json', ...(authHeader ? { Authorization: authHeader } : {}) }
    };
    const reqLib = (hostname === '127.0.0.1' || hostname === 'localhost') ? require('http') : https;
    const req = reqLib.request(reqOptions, res => {
      let raw = '';
      res.on('data', d => raw += d);
      res.on('end', () => {
        try {
          const data = JSON.parse(raw);
          const text = data?.choices?.[0]?.message?.content || data?.message?.content || '';
          resolve(text || '(no response)');
        } catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// â”€â”€ Agentic Loop — multi-step reasoning like Claude Code â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function runAgentLoop(event, command, projectRoot, messageId, director = 'gemini') {
  // Pick which API key/URL to use based on director
  const brainKey = {
    gemini: GEMINI_KEY, claude: CLAUDE_KEY, chatgpt: OPENAI_KEY,
    groq: GROQ_KEY, custom: CUSTOM_API_KEY, ollama: 'ollama'
  }[director] || GEMINI_KEY;

  if (!brainKey) {
    event.sender.send('command-chunk', { messageId, chunk: `âŒ No API key configured for ${director}. Add it in Settings â†’ APIs.` });
    event.sender.send('command-end', { messageId, code: 1 });
    return;
  }

  const projectMap = smartContext.getProjectMap(projectRoot);
  const memoryLog = smartContext.getMemorySummary();

  const systemPrompt = `${getAgentToolsDesc()}

PROJECT: IMI (Integrated Merge Interface) — Electron + React/TypeScript app
Root: ${projectRoot}
${projectMap}
${memoryLog}

TASK: ${command}

â”â”â” HOW TO WORK (SEARCH-FIRST APPROACH) â”â”â”
Follow these steps exactly — this is what makes the difference between fast accurate fixes and slow broken ones:

STEP 1 — SEARCH BEFORE YOU TOUCH
â€¢ Use search_code to find the EXACT function, variable or block you need to change
â€¢ Use read_file with offset+limit to read ONLY the relevant section (not the whole file)
â€¢ Never assume what code looks like — always verify first
â€¢ If you get a line number from an error, read that exact area

STEP 2 — UNDERSTAND THE ROOT CAUSE
â€¢ Trace errors back to their source — stack traces give you the exact file:line
â€¢ Look for what's MISSING or WRONG, not just what the error message says
â€¢ Check if the issue is in the frontend (App.tsx), backend (electron-main.cjs), or styles (index.css)

STEP 3 — MAKE THE SMALLEST POSSIBLE CHANGE
â€¢ One targeted patch beats a full rewrite every time
â€¢ Use write_patch with the EXACT text from your read_file result as the search string
â€¢ If your search string doesn't match exactly, search_code again to get the real text

STEP 4 — VERIFY
â€¢ Run run_build after patching — if it fails, read the error and fix it
â€¢ Never call done until the build passes or the task is confirmed working

START NOW — use search_code or read_file first, never write_patch as your first action.`;

  // Generic brain caller — works for any configured model
  const callBrain = async (history) => {
    if (director === 'gemini') {
      const body = JSON.stringify({
        contents: history,
        generationConfig: { temperature: 0.1, maxOutputTokens: 16000 }
      });
      return new Promise((resolve, reject) => {
        const req = https.request({
          hostname: 'generativelanguage.googleapis.com',
          path: `/v1beta/models/${BRAIN_MODEL}:generateContent?key=${GEMINI_KEY}`,
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        }, res => {
          let raw = '';
          res.on('data', d => raw += d);
          res.on('end', () => {
            try {
              const data = JSON.parse(raw);
              resolve(data?.candidates?.[0]?.content?.parts?.[0]?.text || '');
            } catch(e) { reject(e); }
          });
        });
        req.on('error', reject);
        req.write(body);
        req.end();
      });
    }

    // OpenAI-compatible format (Claude, OpenAI, Groq, Ollama, Custom)
    const msgs = history.map(h => ({
      role: h.role === 'model' ? 'assistant' : 'user',
      content: h.parts?.map(p => p.text).join('') || h.content || ''
    }));

    let hostname, apiPath, authHeader, model;
    if (director === 'claude') {
      // Claude uses its own format
      const claudeBody = JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 16000,
        system: msgs[0]?.role === 'system' ? msgs.shift().content : undefined,
        messages: msgs.filter(m => m.role !== 'system')
      });
      return new Promise((resolve, reject) => {
        const req = net.request({ method: 'POST', protocol: 'https:', hostname: 'api.anthropic.com', path: '/v1/messages' });
        req.setHeader('Content-Type', 'application/json');
        req.setHeader('x-api-key', CLAUDE_KEY.trim());
        req.setHeader('anthropic-version', '2023-06-01');
        let raw = '';
        req.on('response', res => {
          res.on('data', d => raw += d.toString());
          res.on('end', () => {
            try {
              const data = JSON.parse(raw);
              resolve(data?.content?.[0]?.text || '');
            } catch(e) { reject(e); }
          });
        });
        req.on('error', reject);
        req.write(claudeBody);
        req.end();
      });
    }

    // OpenAI / Groq / Ollama / Custom — all OpenAI-compatible
    if (director === 'chatgpt') { hostname = 'api.openai.com'; apiPath = '/v1/chat/completions'; authHeader = `Bearer ${OPENAI_KEY}`; model = 'gpt-4o'; }
    else if (director === 'groq') { hostname = 'api.groq.com'; apiPath = '/openai/v1/chat/completions'; authHeader = `Bearer ${GROQ_KEY}`; model = 'llama-3.3-70b-versatile'; }
    else if (director === 'ollama') { hostname = '127.0.0.1'; apiPath = '/api/chat'; authHeader = ''; model = CUSTOM_API_MODEL || 'llama3'; }
    else if (director === 'custom') {
      try { const u = new URL(CUSTOM_API_URL || 'http://localhost:11434'); hostname = u.hostname; apiPath = u.pathname; } catch { hostname = 'localhost'; apiPath = '/v1/chat/completions'; }
      authHeader = CUSTOM_API_KEY ? `Bearer ${CUSTOM_API_KEY}` : '';
      model = CUSTOM_API_MODEL || 'gpt-4';
    }

    const openAiBody = JSON.stringify({ model, messages: msgs, max_tokens: 16000, temperature: 0.1 });
    return new Promise((resolve, reject) => {
      const reqOptions = {
        method: 'POST',
        hostname,
        path: apiPath,
        headers: { 'Content-Type': 'application/json', ...(authHeader ? { Authorization: authHeader } : {}) }
      };
      const reqLib = (hostname === '127.0.0.1' || hostname === 'localhost') ? require('http') : https;
      const req = reqLib.request(reqOptions, res => {
        let raw = '';
        res.on('data', d => raw += d);
        res.on('end', () => {
          try {
            const data = JSON.parse(raw);
            // Ollama returns {message: {content}} or {choices: [...]}
            const text = data?.choices?.[0]?.message?.content || data?.message?.content || '';
            resolve(text);
          } catch(e) { reject(e); }
        });
      });
      req.on('error', reject);
      req.write(openAiBody);
      req.end();
    });
  };

  const conversationHistory = [{ role: 'user', parts: [{ text: systemPrompt }] }];
  const MAX_STEPS = 20;
  let step = 0;
  const runSteps = [];

  // Track stats
  agentStats.totalRuns++;
  const runStart = Date.now();

  event.sender.send('command-chunk', { messageId, chunk: `ðŸ¤– **Agent Mode** (${director}) — reasoning through your request...\n\n` });

  while (step < MAX_STEPS) {
    step++;
    let responseText;
    try {
      responseText = await callBrain(conversationHistory);
    } catch(e) {
      event.sender.send('command-chunk', { messageId, chunk: `\nâŒ Agent error: ${e.message}` });
      break;
    }

    if (!responseText) break;

    // Add assistant response to history
    conversationHistory.push({ role: 'model', parts: [{ text: responseText }] });

    // Parse tool call
    const toolMatch = responseText.match(/TOOL_CALL:\s*(\{[\s\S]*?\})/);
    if (!toolMatch) {
      event.sender.send('command-chunk', { messageId, chunk: responseText });
      break;
    }

    let toolCall;
    try { toolCall = JSON.parse(toolMatch[1]); } catch(e) {
      event.sender.send('command-chunk', { messageId, chunk: `\nâš ï¸ Could not parse tool call: ${toolMatch[1]}` });
      break;
    }

    const { tool, args } = toolCall;

    if (tool === 'done') {
      event.sender.send('command-chunk', { messageId, chunk: `\nâœ… **Done!** ${args?.message || ''}` });
      break;
    }

    // Track tool usage
    agentStats.totalSteps++;
    if (tool in agentStats.toolsUsed) agentStats.toolsUsed[tool]++;
    runSteps.push({ tool, args, step });

    const toolEmoji = {
      read_file: 'ðŸ“–', write_file: 'ðŸ“', write_patch: 'âœï¸',
      search_code: 'ðŸ”', glob: 'ðŸ—‚ï¸', list_dir: 'ðŸ“',
      get_file_info: 'â„¹ï¸', run_build: 'ðŸ”¨', read_error: 'ðŸ”Ž',
      run_command: '⚡', take_screenshot: 'ðŸ“¸', open_browser: '🌐'
    };
    const toolLabel = {
      read_file:    `Reading \`${args?.path}\`${args?.offset !== undefined ? ` (offset:${args?.offset})` : ''}`,
      write_file:   `Writing \`${args?.file || args?.path}\``,
      write_patch:  `Patching \`${args?.file}\``,
      search_code:  `Searching \`${args?.pattern}\`${args?.file_type ? ` in *.${args?.file_type}` : ''}`,
      glob:         `Glob \`${args?.pattern}\``,
      list_dir:     `Listing \`${args?.path}\``,
      get_file_info:`Info on \`${args?.path}\``,
      run_build:    `Running build...`,
      read_error:   `Reading error at \`${args?.file}:${args?.line}\``,
      run_command:  `Running: ${args?.cmd}`,
      take_screenshot: `Taking screenshot...`,
      open_browser: `Opening ${args?.url}`
    };
    event.sender.send('command-chunk', { messageId, chunk: `\n${toolEmoji[tool] || 'âš™ï¸'} ${toolLabel[tool] || tool}...\n` });

    const result = await executeAgentTool(tool, args || {}, projectRoot);
    const resultStr = String(result);
    const preview = resultStr.length > 400 ? resultStr.slice(0, 400) + `\n... (${resultStr.length - 400} more chars)` : resultStr;
    event.sender.send('command-chunk', { messageId, chunk: `\`\`\`\n${preview}\n\`\`\`\n` });

    const toolResultParts = [{ text: `Tool result for ${tool}:\n${resultStr}` }];
    if (tool === 'take_screenshot' && global._lastScreenshot) {
      toolResultParts.push({ inlineData: { mimeType: 'image/png', data: global._lastScreenshot } });
      global._lastScreenshot = null;
    }
    conversationHistory.push({ role: 'user', parts: toolResultParts });

    await new Promise(r => setTimeout(r, 300));
  }

  if (step >= MAX_STEPS) {
    event.sender.send('command-chunk', { messageId, chunk: `\nâš ï¸ Reached maximum steps (${MAX_STEPS}). Task may be incomplete.` });
  }

  // Save run to stats
  agentStats.lastRun = {
    command: command.slice(0, 120),
    director,
    model: director === 'gemini' ? BRAIN_MODEL : director,
    steps: step,
    toolsUsed: runSteps.map(s => s.tool),
    ts: runStart,
    duration: Date.now() - runStart
  };
  agentStats.lastRunSteps = runSteps.slice(0, 20);

  event.sender.send('command-end', { messageId, code: 0 });
}

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
let agentStats = {
  totalRuns: 0,
  totalSteps: 0,
  toolsUsed: { read_file: 0, write_file: 0, write_patch: 0, search_code: 0, glob: 0, list_dir: 0, get_file_info: 0, run_build: 0, read_error: 0, run_command: 0, take_screenshot: 0, open_browser: 0 },
  lastRun: null,
  lastRunSteps: []
};
let GEMINI_KEY = ''; let GITHUB_TOKEN = ''; let OPENAI_KEY = ''; let CLAUDE_KEY = '';
let GITHUB_USER = ''; let GITHUB_REPO = '';
let DEEPSEEK_KEY = ''; let MISTRAL_KEY = ''; let LLAMA_KEY = ''; let PERPLEXITY_KEY = '';
let GROQ_KEY = ''; let GROK_KEY = ''; let COHERE_KEY = '';
let CUSTOM_API_KEY = ''; let CUSTOM_API_URL = ''; let CUSTOM_API_MODEL = ''; 
let JULES_KEY = ''; let GOOGLE_MAPS_KEY = '';
let ACTIVE_BRAIN = 'gemini'; let ACTIVE_CODER = 'imi-core'; let THEME = 'glass';
let ACCENT_COLOR = '#9b4dff'; let LOG_RETENTION = 15;
let SYNC_INTERVAL_MS = 60000; let syncTimer = null;
// â‰¡Æ’ÂºÃ¡ Brain AI config
let BRAIN_MODEL = 'gemini-2.5-flash'; let BRAIN_TEMPERATURE = 0.7; let BRAIN_MAX_TOKENS = 32000; let STRATEGY_VERSION = '1.0.1';
let mcpServersList = [];
let currentProjectRoot = isDev ? process.cwd() : path.dirname(app.getPath('exe'));

const saveGlobalState = () => {
  try {
    const stateDir = path.dirname(GLOBAL_STATE_PATH);
    if (!fs.existsSync(stateDir)) fs.mkdirSync(stateDir, { recursive: true });
    const config = { 
      geminiKey: GEMINI_KEY, githubToken: GITHUB_TOKEN, openaiKey: OPENAI_KEY, 
      claudeKey: CLAUDE_KEY, deepseekKey: DEEPSEEK_KEY, mistralKey: MISTRAL_KEY, 
      llamaKey: LLAMA_KEY, perplexityKey: PERPLEXITY_KEY, 
      groqKey: GROQ_KEY, grokKey: GROK_KEY, cohereKey: COHERE_KEY,
      customApiKey: CUSTOM_API_KEY, customApiUrl: CUSTOM_API_URL, customApiModel: CUSTOM_API_MODEL,
      julesApiKey: JULES_KEY, googleMapsKey: GOOGLE_MAPS_KEY, 
      activeBrain: ACTIVE_BRAIN, activeCoder: ACTIVE_CODER,
      theme: THEME, accentColor: ACCENT_COLOR, logRetention: LOG_RETENTION, syncFrequency: SYNC_INTERVAL_MS / 1000,
      brainModel: BRAIN_MODEL, brainTemperature: BRAIN_TEMPERATURE, brainMaxTokens: BRAIN_MAX_TOKENS,
      strategyVersion: STRATEGY_VERSION,
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
      GROQ_KEY = state.config.groqKey || ''; GROK_KEY = state.config.grokKey || ''; COHERE_KEY = state.config.cohereKey || '';
      CUSTOM_API_KEY = state.config.customApiKey || ''; 
      CUSTOM_API_URL = state.config.customApiUrl || '';
      CUSTOM_API_MODEL = state.config.customApiModel || '';
      JULES_KEY = state.config.julesApiKey || '';
      GOOGLE_MAPS_KEY = state.config.googleMapsKey || ''; 
      ACTIVE_BRAIN = state.config.activeBrain || 'gemini';
      ACTIVE_CODER = state.config.activeCoder || state.config.activeEngine || 'imi-core';
      THEME = state.config.theme || 'glass'; ACCENT_COLOR = state.config.accentColor || '#9b4dff'; LOG_RETENTION = state.config.logRetention || 15;
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
  if (config.githubToken !== undefined) { GITHUB_TOKEN = config.githubToken; if (app.isReady()) fetchGitHubIdentity(); }
  if (config.openaiKey !== undefined) OPENAI_KEY = config.openaiKey;
  if (config.claudeKey !== undefined) CLAUDE_KEY = config.claudeKey;
  if (config.deepseekKey !== undefined) DEEPSEEK_KEY = config.deepseekKey;
  if (config.mistralKey !== undefined) MISTRAL_KEY = config.mistralKey;
  if (config.llamaKey !== undefined) LLAMA_KEY = config.llamaKey;
  if (config.perplexityKey !== undefined) PERPLEXITY_KEY = config.perplexityKey;
  if (config.groqKey !== undefined) GROQ_KEY = config.groqKey;
  if (config.grokKey !== undefined) GROK_KEY = config.grokKey;
  if (config.cohereKey !== undefined) COHERE_KEY = config.cohereKey;
  if (config.customApiKey !== undefined) CUSTOM_API_KEY = config.customApiKey;
  if (config.customApiUrl !== undefined) CUSTOM_API_URL = config.customApiUrl;
  if (config.customApiModel !== undefined) CUSTOM_API_MODEL = config.customApiModel;
  if (config.julesApiKey !== undefined) JULES_KEY = config.julesApiKey;
  if (config.activeBrain !== undefined) ACTIVE_BRAIN = config.activeBrain;
  if (config.activeCoder !== undefined) ACTIVE_CODER = config.activeCoder;
  if (config.theme !== undefined) THEME = config.theme;
  if (config.accentColor !== undefined) ACCENT_COLOR = config.accentColor;
  if (config.logRetention !== undefined) LOG_RETENTION = config.logRetention;
  if (config.brainModel !== undefined) BRAIN_MODEL = config.brainModel;
  if (config.brainTemperature !== undefined) BRAIN_TEMPERATURE = parseFloat(config.brainTemperature);
  if (config.brainMaxTokens !== undefined) BRAIN_MAX_TOKENS = parseInt(config.brainMaxTokens);
  if (config.strategyVersion !== undefined) STRATEGY_VERSION = config.strategyVersion;
  if (config.activeBrain !== undefined) ACTIVE_BRAIN = config.activeBrain;
  if (config.activeCoder !== undefined) ACTIVE_CODER = config.activeCoder;
  if (config.syncFrequency !== undefined) {
    SYNC_INTERVAL_MS = parseInt(config.syncFrequency) * 1000;
    if (syncTimer) clearInterval(syncTimer);
    // Only start timer if GitHub token is configured
    if (GITHUB_TOKEN && GITHUB_TOKEN.trim()) {
      syncTimer = setInterval(triggerGitSync, SYNC_INTERVAL_MS);
    }
  }
  if (config.projectRoot && fs.existsSync(config.projectRoot)) {
    const changed = currentProjectRoot !== config.projectRoot;
    currentProjectRoot = config.projectRoot;
    // Re-analyze style non-blocking when project root changes
    if (changed) {
      const rootToAnalyze = currentProjectRoot; // capture now, not via closure
      setImmediate(() => { try { styleAnalyzer.analyze(rootToAnalyze); } catch(e) { console.warn('[StyleAnalyzer] auto-analyze failed:', e.message); } });
    }
  }
  saveGlobalState(); return { success: true };
});

ipcMain.handle('get-api-config', () => ({
  geminiKey: GEMINI_KEY, githubToken: GITHUB_TOKEN, openaiKey: OPENAI_KEY, claudeKey: CLAUDE_KEY,
  deepseekKey: DEEPSEEK_KEY, mistralKey: MISTRAL_KEY, llamaKey: LLAMA_KEY, perplexityKey: PERPLEXITY_KEY,
  customApiKey: CUSTOM_API_KEY, customApiUrl: CUSTOM_API_URL, customApiModel: CUSTOM_API_MODEL,
  julesApiKey: JULES_KEY, activeBrain: ACTIVE_BRAIN, activeCoder: ACTIVE_CODER, projectRoot: currentProjectRoot,
  theme: THEME, accentColor: ACCENT_COLOR, logRetention: LOG_RETENTION, syncFrequency: SYNC_INTERVAL_MS / 1000,
  brainModel: BRAIN_MODEL, brainTemperature: BRAIN_TEMPERATURE, brainMaxTokens: BRAIN_MAX_TOKENS, strategyVersion: STRATEGY_VERSION
}));

ipcMain.handle('get-system-usage', async () => ({
  cpu: (Math.random() * 20 + 5).toFixed(1),
  ram: (os.freemem() / 1024 / 1024 / 1024).toFixed(2),
  threads: os.cpus().length,
  load: os.loadavg()[0].toFixed(2)
}));

ipcMain.handle('get-token-usage', () => tokenStats);
ipcMain.handle('get-agent-stats', () => ({
  ...agentStats,
  currentBrain: BRAIN_MODEL,
  currentDirector: ACTIVE_BRAIN,
  maxSteps: 15,
  temperature: BRAIN_TEMPERATURE,
  maxTokens: BRAIN_MAX_TOKENS
}));
ipcMain.handle('get-project-stats', () => ({ projectRoot: currentProjectRoot, platform: os.platform(), freeMem: (os.freemem() / 1024 / 1024 / 1024).toFixed(2) }));

// â”€â”€ STYLE ANALYZER IPC handlers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
ipcMain.handle('analyze-style', async (_, { projectRoot } = {}) => {
  const root = projectRoot || currentProjectRoot;
  if (!root) return { error: 'No project root configured' };
  try {
    const profile = styleAnalyzer.analyze(root);
    if (!profile) return { error: 'No source files found in project root' };
    return profile;
  } catch(e) { return { error: e.message }; }
});

ipcMain.handle('get-style-profile', () => styleAnalyzer.getProfile());
ipcMain.handle('set-style-scan', (_, { enabled }) => { styleAnalyzer.setEnabled(enabled); return { ok: true }; });

// â”€â”€ IMPACT ANALYZER IPC handler â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
ipcMain.handle('get-impact', async (_, { filePath, projectRoot } = {}) => {
  const root = projectRoot || currentProjectRoot;
  if (!root || !filePath) return { error: 'Missing filePath or projectRoot' };
  try {
    // Always rebuild graph fresh so it reflects current file state
    impactAnalyzer.buildFromProjectRoot(root);
    const affected = impactAnalyzer.getAffected(filePath);
    return { filePath, affected, projectRoot: root };
  } catch(e) { return { error: e.message }; }
});

// â”€â”€ FULL STYLE PROFILE — code, design, art, writing, workflow, stack â”€â”€â”€â”€â”€â”€â”€â”€â”€
const FULL_PROFILE_PATH      = path.join(os.homedir(), '.imi', 'full-profile.json');
const COMMUNITY_PROFILES_PATH = path.join(os.homedir(), '.imi', 'community-profiles.json');

function _loadFullProfile() {
  try { if (fs.existsSync(FULL_PROFILE_PATH)) return JSON.parse(fs.readFileSync(FULL_PROFILE_PATH, 'utf-8')); } catch {}
  return null;
}
function _saveFullProfile(profile) {
  try {
    const dir = path.dirname(FULL_PROFILE_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(FULL_PROFILE_PATH, JSON.stringify(profile, null, 2));
    return true;
  } catch(e) { console.warn('[FullProfile] save error:', e.message); return false; }
}

ipcMain.handle('get-full-profile', () => _loadFullProfile());

ipcMain.handle('save-full-profile', (_, profile) => {
  if (!profile || typeof profile !== 'object') return { error: 'Invalid profile' };
  const now = Date.now();
  const updated = {
    ...profile,
    updatedAt: now,
    id: profile.id || (now.toString(36) + Math.random().toString(36).slice(2, 7)),
    createdAt: profile.createdAt || now,
    author: profile.author || GITHUB_USER || '',
  };
  const ok = _saveFullProfile(updated);
  return ok ? updated : { error: 'Failed to save profile' };
});

ipcMain.handle('export-full-profile', async (_, { profile }) => {
  if (!profile) return { error: 'No profile to export' };
  const safeName = (profile.name || 'my-style-profile').toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const defaultPath = path.join(os.homedir(), 'Desktop', `${safeName}.imi-profile.json`);
  try {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Export IMI Style Profile',
      defaultPath,
      filters: [{ name: 'IMI Profile', extensions: ['json'] }]
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    fs.writeFileSync(result.filePath, JSON.stringify(profile, null, 2), 'utf-8');
    return { path: result.filePath };
  } catch(e) { return { error: e.message }; }
});

ipcMain.handle('import-full-profile', async () => {
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Import IMI Style Profile',
      filters: [{ name: 'IMI Profile', extensions: ['json'] }],
      properties: ['openFile']
    });
    if (result.canceled || !result.filePaths.length) return { canceled: true };
    const raw = fs.readFileSync(result.filePaths[0], 'utf-8');
    const profile = JSON.parse(raw);
    if (!profile || !profile.code) return { error: 'Invalid profile file — missing expected fields' };
    return { profile };
  } catch(e) { return { error: e.message }; }
});

ipcMain.handle('get-community-profiles', () => {
  try {
    if (fs.existsSync(COMMUNITY_PROFILES_PATH)) {
      return JSON.parse(fs.readFileSync(COMMUNITY_PROFILES_PATH, 'utf-8'));
    }
  } catch {}
  return [];
});

ipcMain.handle('add-to-community', (_, { profile }) => {
  if (!profile || !profile.id) return { error: 'Invalid profile' };
  try {
    let list = [];
    try { list = JSON.parse(fs.readFileSync(COMMUNITY_PROFILES_PATH, 'utf-8')); } catch {}
    list = list.filter(p => p.id !== profile.id);
    const shared = { ...profile, sharedAt: Date.now(), downloads: (profile.downloads || 0) + 1 };
    list.unshift(shared);
    if (list.length > 500) list = list.slice(0, 500);
    const dir = path.dirname(COMMUNITY_PROFILES_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(COMMUNITY_PROFILES_PATH, JSON.stringify(list, null, 2));
    return { success: true };
  } catch(e) { return { error: e.message }; }
});

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

// â”€â”€ File System IPC handlers (safe read/write/list for AI file ops) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
ipcMain.handle('fs-read',   (_e, filePath) => {
  try { return { content: fs.readFileSync(filePath, 'utf-8'), success: true }; }
  catch(e) { return { error: e.message, success: false }; }
});
ipcMain.handle('fs-write',  (_e, filePath, content) => {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf-8');
    return { success: true };
  } catch(e) { return { error: e.message, success: false }; }
});
ipcMain.handle('fs-list',   (_e, dirPath) => {
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    return { success: true, files: entries.map(e => ({ name: e.name, isDir: e.isDirectory(), path: path.join(dirPath, e.name) })) };
  } catch(e) { return { error: e.message, success: false }; }
});
ipcMain.handle('fs-exists',  (_e, filePath) => {
  return { exists: fs.existsSync(filePath) };
});

// â”€â”€ Skill Engine IPC handlers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
ipcMain.handle('skills-get-all',    ()          => ({ skills: skillEngine.getAll(), stats: skillEngine.stats, efficiency: skillEngine.getEfficiency() }));
ipcMain.handle('skills-add',        (_e, skill) => skillEngine.addSkill(skill));
ipcMain.handle('skills-remove',     (_e, id)    => { skillEngine.removeSkill(id); return true; });
ipcMain.handle('skills-toggle',     (_e, id)    => { skillEngine.toggleSkill(id); return true; });
ipcMain.handle('skills-optimize',   ()          => skillEngine._optimize());
ipcMain.handle('skills-get-history',()          => ({ history: skillEngine.commandHistory, stats: skillEngine.stats, efficiency: skillEngine.getEfficiency() }));

// â”€â”€ Community Skills Registry â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const COMMUNITY_REGISTRY_URL = 'https://raw.githubusercontent.com/creepybunny99/IMI-skills/main/registry.json';

const COMMUNITY_FALLBACK_SKILLS = [
  // ðŸŽµ Media & Entertainment
  { id: 'com_spotify_play',     name: 'Play Spotify',           pattern: 'play spotify|open spotify|start spotify',         type: 'cached',      response: 'Opening Spotify now! ðŸŽµ',  desc: 'Launch Spotify desktop app', category: 'ðŸŽµ Media', icon: 'ðŸŽµ', author: 'jdoe99', installs: 2847, rating: 4.9, version: '1.0.2' },
  { id: 'com_youtube_open',     name: 'Open YouTube',           pattern: 'open youtube|go to youtube|launch youtube',       type: 'passthrough', response: '',  desc: 'Navigate to youtube.com', category: 'ðŸŽµ Media', icon: 'â–¶ï¸', author: 'techwave', installs: 4112, rating: 4.8, version: '1.0.0' },
  { id: 'com_netflix',          name: 'Open Netflix',           pattern: 'open netflix|watch netflix',                       type: 'passthrough', response: '',  desc: 'Navigate to netflix.com', category: 'ðŸŽµ Media', icon: 'ðŸŽ¬', author: 'streamfan', installs: 1923, rating: 4.6, version: '1.0.0' },
  { id: 'com_vlc_open',         name: 'Open VLC',               pattern: 'open vlc|launch vlc|start vlc',                   type: 'cached',      response: 'Opening VLC media player! ðŸŽ¬',  desc: 'Launch VLC player', category: 'ðŸŽµ Media', icon: 'ðŸ”¶', author: 'mediaguru', installs: 1534, rating: 4.5, version: '1.0.1' },

  // ðŸ’» Developer Tools
  { id: 'com_git_status',       name: 'Git Status Check',       pattern: '^git status$|^show git status$',                  type: 'passthrough', response: '',  desc: 'Run git status in terminal', category: 'ðŸ’» Dev Tools', icon: '🌿', author: 'devcraft', installs: 5291, rating: 4.9, version: '2.0.0' },
  { id: 'com_npm_install',      name: 'NPM Install',            pattern: '^npm install$|^run npm install$',                 type: 'passthrough', response: '',  desc: 'Run npm install in project', category: 'ðŸ’» Dev Tools', icon: '📦', author: 'devcraft', installs: 3847, rating: 4.8, version: '1.1.0' },
  { id: 'com_open_vscode',      name: 'Open VS Code',           pattern: 'open vscode|open vs code|launch vscode',         type: 'cached',      response: 'Opening VS Code! ðŸ’»',  desc: 'Launch VS Code editor', category: 'ðŸ’» Dev Tools', icon: '💙', author: 'coderx', installs: 6104, rating: 4.9, version: '1.0.3' },
  { id: 'com_localhost',        name: 'Open Localhost',         pattern: 'open localhost|go to localhost|localhost 3000',   type: 'passthrough', response: '',  desc: 'Open localhost:3000 in browser', category: 'ðŸ’» Dev Tools', icon: '🌐', author: 'webdev42', installs: 2901, rating: 4.7, version: '1.0.0' },
  { id: 'com_clear_terminal',   name: 'Clear Terminal',         pattern: '^clear$|^cls$|clear terminal',                    type: 'cached',      response: '__CLEAR__',  desc: 'Clear terminal output', category: 'ðŸ’» Dev Tools', icon: 'ðŸ§¹', author: 'shellpro', installs: 1872, rating: 4.6, version: '1.0.0' },

  // ðŸ¤– AI & IMI
  { id: 'com_imi_help',         name: 'Quick AI Help',          pattern: 'quick help|what can imi do|imi features',         type: 'cached',      response: 'IMI Features: ðŸ§  Multi-AI Brain (Gemini/Claude/GPT/Groq/Ollama) Â· ⚡ Zero-token Skills Â· ðŸ“‹ Plan Mode Â· ðŸ¤– Agent Loop Â· ðŸ›  Dev Hub Â· ðŸŽ¤ Voice Input Â· ðŸ”„ GitHub Sync',  desc: 'Quick IMI features overview', category: 'ðŸ¤– AI & IMI', icon: 'ðŸ¤–', author: 'imidev', installs: 3344, rating: 4.9, version: '1.0.0' },
  { id: 'com_switch_gemini',    name: 'Switch to Gemini',       pattern: 'use gemini|switch to gemini|change to gemini',    type: 'passthrough', response: '',  desc: 'Switch brain to Gemini', category: 'ðŸ¤– AI & IMI', icon: '✨', author: 'aifan', installs: 1201, rating: 4.5, version: '1.0.0' },
  { id: 'com_switch_claude',    name: 'Switch to Claude',       pattern: 'use claude|switch to claude|change to claude',    type: 'passthrough', response: '',  desc: 'Switch brain to Claude', category: 'ðŸ¤– AI & IMI', icon: 'ðŸŸ£', author: 'aifan', installs: 1098, rating: 4.5, version: '1.0.0' },

  // 🌐 Productivity
  { id: 'com_open_gmail',       name: 'Open Gmail',             pattern: 'open gmail|go to gmail|check email',              type: 'passthrough', response: '',  desc: 'Open Gmail in browser', category: '🌐 Productivity', icon: 'ðŸ“§', author: 'prodmaster', installs: 4782, rating: 4.7, version: '1.0.1' },
  { id: 'com_open_notion',      name: 'Open Notion',            pattern: 'open notion|go to notion|launch notion',          type: 'passthrough', response: '',  desc: 'Open Notion workspace', category: '🌐 Productivity', icon: 'ðŸ““', author: 'workflowpro', installs: 2193, rating: 4.8, version: '1.0.0' },
  { id: 'com_open_calendar',    name: 'Open Google Calendar',   pattern: 'open calendar|google calendar|check calendar',    type: 'passthrough', response: '',  desc: 'Open Google Calendar', category: '🌐 Productivity', icon: 'ðŸ“…', author: 'scheduler9', installs: 2891, rating: 4.7, version: '1.0.0' },
  { id: 'com_open_drive',       name: 'Open Google Drive',      pattern: 'open drive|google drive|open my drive',           type: 'passthrough', response: '',  desc: 'Open Google Drive', category: '🌐 Productivity', icon: 'ðŸ’¾', author: 'cloudguy', installs: 3512, rating: 4.7, version: '1.0.0' },
  { id: 'com_open_slack',       name: 'Open Slack',             pattern: 'open slack|launch slack|go to slack',             type: 'passthrough', response: '',  desc: 'Open Slack workspace', category: '🌐 Productivity', icon: 'ðŸ’¬', author: 'teamchat', installs: 2214, rating: 4.6, version: '1.0.2' },

  // ðŸŽ® Gaming
  { id: 'com_open_steam',       name: 'Open Steam',             pattern: 'open steam|launch steam|go to steam',             type: 'cached',      response: 'Opening Steam! ðŸŽ®',  desc: 'Launch Steam client', category: 'ðŸŽ® Gaming', icon: 'ðŸŽ®', author: 'gamer404', installs: 3229, rating: 4.8, version: '1.0.0' },
  { id: 'com_discord',          name: 'Open Discord',           pattern: 'open discord|launch discord|go to discord',       type: 'passthrough', response: '',  desc: 'Open Discord app', category: 'ðŸŽ® Gaming', icon: 'ðŸŸ£', author: 'discordian', installs: 4891, rating: 4.9, version: '1.0.1' },

  // ðŸ”§ System
  { id: 'com_cpu_temp',         name: 'CPU Temperature',        pattern: 'cpu temp|cpu temperature|how hot is my cpu',      type: 'passthrough', response: '',  desc: 'Check CPU temperature', category: 'ðŸ”§ System', icon: 'ðŸŒ¡ï¸', author: 'syswatch', installs: 1102, rating: 4.3, version: '1.0.0' },
  { id: 'com_restart_explorer', name: 'Restart Explorer',       pattern: 'restart explorer|restart windows explorer',       type: 'passthrough', response: '',  desc: 'Restart Windows Explorer shell', category: 'ðŸ”§ System', icon: 'ðŸ”„', author: 'winsysadmin', installs: 876, rating: 4.2, version: '1.0.0' },
  { id: 'com_dark_mode',        name: 'Toggle Dark Mode',       pattern: 'toggle dark mode|dark mode|light mode',           type: 'passthrough', response: '',  desc: 'Switch Windows dark/light theme', category: 'ðŸ”§ System', icon: 'ðŸŒ™', author: 'themepro', installs: 2341, rating: 4.6, version: '1.0.0' },

  // ðŸ“Š Data & Stats
  { id: 'com_weather',          name: 'Check Weather',          pattern: 'weather|whats the weather|check weather',         type: 'passthrough', response: '',  desc: 'Get local weather forecast', category: 'ðŸ“Š Data', icon: 'ðŸŒ¤ï¸', author: 'weatherbot', installs: 3781, rating: 4.7, version: '1.1.0' },
  { id: 'com_crypto',           name: 'Crypto Prices',          pattern: 'crypto price|bitcoin price|eth price',            type: 'passthrough', response: '',  desc: 'Check live crypto prices', category: 'ðŸ“Š Data', icon: 'â‚¿', author: 'cryptowatch', installs: 2109, rating: 4.4, version: '1.0.0' },
  { id: 'com_news',             name: 'Open News',              pattern: 'open news|latest news|check news',                type: 'passthrough', response: '',  desc: 'Open news aggregator', category: 'ðŸ“Š Data', icon: 'ðŸ“°', author: 'newsreader', installs: 1894, rating: 4.3, version: '1.0.0' },

  // ðŸŽ¨ Creative
  { id: 'com_open_figma',       name: 'Open Figma',             pattern: 'open figma|launch figma|go to figma',             type: 'passthrough', response: '',  desc: 'Open Figma design tool', category: 'ðŸŽ¨ Creative', icon: 'ðŸŽ¨', author: 'designer88', installs: 1983, rating: 4.8, version: '1.0.0' },
  { id: 'com_color_picker',     name: 'Color Picker Tip',       pattern: 'pick color|color picker|hex color',               type: 'cached',      response: 'Use Windows + Shift + C to open the color picker (PowerToys). Or try colorpicker.me online! ðŸŽ¨',  desc: 'Tip for picking colors', category: 'ðŸŽ¨ Creative', icon: 'ðŸŒˆ', author: 'colorwiz', installs: 1122, rating: 4.4, version: '1.0.0' },
];

ipcMain.handle('skills-fetch-community', async (_e, _forceRefresh) => {
  try {
    const data = await new Promise((resolve, reject) => {
      const req = net.request(COMMUNITY_REGISTRY_URL);
      let body = '';
      const timeout = setTimeout(() => { try { req.abort(); } catch {} reject(new Error('timeout')); }, 6000);
      req.on('response', res => {
        res.on('data', chunk => { body += chunk; });
        res.on('end', () => {
          clearTimeout(timeout);
          try {
            const parsed = JSON.parse(body);
            const arr = Array.isArray(parsed) ? parsed : (parsed.skills || []);
            if (arr.length > 0) resolve(arr); else reject(new Error('empty'));
          } catch(e) { reject(e); }
        });
      });
      req.on('error', (e) => { clearTimeout(timeout); reject(e); });
      req.end();
    });
    return { skills: data, source: 'remote', total: data.length };
  } catch(e) {
    console.log('[Community Skills] Using local fallback — remote unavailable:', e.message);
    return { skills: COMMUNITY_FALLBACK_SKILLS, source: 'local', total: COMMUNITY_FALLBACK_SKILLS.length };
  }
});

ipcMain.handle('skills-export', async (_e, skillId) => {
  const skill = skillEngine.getAll().find(s => s.id === skillId);
  if (!skill) return { success: false, error: 'Skill not found' };
  const exportable = {
    id: `community_${skill.name.toLowerCase().replace(/\s+/g, '_')}_${Date.now()}`,
    name: skill.name,
    pattern: skill.pattern,
    type: skill.type || 'cached',
    response: skill.cachedResponse || '',
    desc: skill.desc || '',
    category: '⚡ Custom',
    icon: '⚡',
    author: 'me',
    installs: 0,
    rating: 0,
    version: '1.0.0',
    created: new Date().toISOString(),
  };
  return { success: true, json: JSON.stringify(exportable, null, 2) };
});

// â”€â”€ ImiStore IPC handlers (no API calls, instant) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
    // Build an enriched PATH so Electron can find npm global bins, pyenv, etc.
    const npmGlobal = path.join(os.homedir(), 'AppData', 'Roaming', 'npm');
    const enrichedEnv = { ...process.env, PATH: [process.env.PATH, npmGlobal].filter(Boolean).join(';') };
    exec(`where.exe ${cmd}`, { env: enrichedEnv }, (err, stdout) => {
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

// Fetch GitHub username + primary IMI repo from token — runs once at startup and after token change
async function fetchGitHubIdentity() {
  if (!GITHUB_TOKEN || !GITHUB_TOKEN.trim()) return;
  try {
    const { net } = require('electron');
    // Get authenticated user
    const userReq = net.request({ method: 'GET', protocol: 'https:', hostname: 'api.github.com', path: '/user' });
    userReq.setHeader('Authorization', `token ${GITHUB_TOKEN}`);
    userReq.setHeader('User-Agent', 'IMI-IDE/1.0');
    userReq.setHeader('Accept', 'application/vnd.github.v3+json');
    await new Promise((resolve) => {
      let body = '';
      userReq.on('response', (res) => {
        res.on('data', (chunk) => { body += chunk.toString(); });
        res.on('end', () => {
          try {
            const data = JSON.parse(body);
            if (data.login) { GITHUB_USER = data.login; console.log('[IMI] GitHub user:', GITHUB_USER); }
          } catch(e) {}
          resolve();
        });
      });
      userReq.on('error', () => resolve());
      userReq.end();
    });

    // Try to detect IMI repo from git remote
    if (currentProjectRoot) {
      const { exec } = require('child_process');
      await new Promise((resolve) => {
        exec('git remote get-url origin', { cwd: currentProjectRoot }, (err, stdout) => {
          if (!err && stdout) {
            const m = stdout.trim().match(/github\.com[:/]([^/]+)\/([^/.]+)/i);
            if (m) { GITHUB_REPO = `${m[1]}/${m[2]}`; console.log('[IMI] GitHub repo:', GITHUB_REPO); }
          }
          resolve();
        });
      });
    }
  } catch(e) { console.error('[IMI] fetchGitHubIdentity error:', e); }
}

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

// â”€â”€ PLAN MODE — generate a phased implementation spec â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
ipcMain.handle('generate-plan', async (_e, { command }) => {
  if (!GEMINI_KEY) throw new Error('Gemini key missing — add it in Settings â†’ APIs');

  // Detect task type — desktop/file tasks must NOT get IMI project code injected
  // (Gemini would think "make a pong game" = edit App.tsx)
  const isDesktopTask = /\b(desktop|my desktop)\b/i.test(command) && /\b(create|make|build|write|generate|folder|file|directory|html|script|game|app)\b/i.test(command);
  const isExternalFileTask = /\b(create|make|write|generate|build)\b.{0,50}\b(html|css|python|javascript|js|script|file|folder|directory|game|app|webpage|website)\b/i.test(command) && !/\b(imi|app\.tsx|index\.css|electron)\b/i.test(command);
  const isDesktopOrExternal = isDesktopTask || isExternalFileTask;

  const projectMap = isDesktopOrExternal ? '' : smartContext.getProjectMap(currentProjectRoot);
  const relevantCode = isDesktopOrExternal ? '' : smartContext.getRelevantCode(command, currentProjectRoot);

  const desktopContext = isDesktopOrExternal
    ? `WHAT IS CURRENTLY ON THE DESKTOP (live scan — use this to avoid recreating existing files and to build accurate full paths):\n${getDesktopSnapshot(1)}\n\nThis task involves creating files or folders on the user's system — NOT editing IMI's own code.`
    : `Project structure:\n${projectMap}\n\nRelevant code:\n${relevantCode}`;

  const systemPrompt = `You are a task planner for IMI — an AI desktop assistant that can create files, create folders, open websites, open files in the browser, write HTML/CSS/JS, and edit code.

${desktopContext}
${styleAnalyzer.getCompactPrompt()}

The user wants to: "${command}"

Break this into clear sequential phases. Each phase must have a "prompt" that is a SHORT, DIRECT, PLAIN-ENGLISH COMMAND — exactly like something a user would type to IMI. NOT a technical spec. NOT code. NOT an explanation. Just a simple instruction.

GOOD phase prompt examples:
- "create a folder called 'pong game' on the desktop"
- "create a complete playable pong game HTML file at C:\\Users\\nikol\\Desktop\\pong game\\pong_game.html"
- "open C:\\Users\\nikol\\Desktop\\pong game\\pong_game.html in the browser"

BAD phase prompt examples (never do this):
- "Implement IPC handler in electron-main.cjs to create directory..."
- "Add contextBridge.exposeInMainWorld to preload script..."
- Anything mentioning IPC, preload, contextBridge, or React components for a simple file/folder task

Keep phase "description" under 40 words. Keep "prompt" under 30 words.
Respond with ONLY valid JSON matching exactly:
{
  "title": "short title (max 60 chars)",
  "summary": "2-3 sentence overview of what will be built",
  "phases": [
    {
      "id": "1",
      "name": "Phase name",
      "description": "What this phase does and why",
      "files": ["list of files to modify or create"],
      "prompt": "Self-contained instruction for the AI coder to execute this phase. Include specific details about what to add/change."
    }
  ],
  "risks": ["potential issues or things to watch out for"],
  "complexity": "low or medium or high"
}`;

  return new Promise((resolve, reject) => {
    const req = net.request({ method: 'POST', protocol: 'https:', hostname: 'generativelanguage.googleapis.com',
      path: `/v1beta/models/${BRAIN_MODEL}:generateContent?key=${GEMINI_KEY}` });
    req.setHeader('Content-Type', 'application/json');
    req.write(JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: `User request: ${command}` }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 8192 }
    }));
    let body = '';
    req.on('response', res => {
      res.on('data', d => body += d.toString());
      res.on('end', () => {
        try {
          const raw = JSON.parse(body);
          const text = raw?.candidates?.[0]?.content?.parts?.[0]?.text || '';
          const cleaned = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
          // Try direct parse first; if truncated, attempt to extract the largest valid JSON object
          let parsed;
          try { parsed = JSON.parse(cleaned); }
          catch(_) {
            const start = cleaned.indexOf('{');
            if (start === -1) throw new Error('No JSON object found');
            // Walk backwards from end to find a valid closing brace
            let sub = cleaned.slice(start);
            for (let i = sub.length; i > 0; i--) {
              try { parsed = JSON.parse(sub.slice(0, i)); break; } catch(_) {}
            }
            if (!parsed) throw new Error('JSON truncated and could not be repaired');
          }
          resolve(parsed);
        } catch(e) {
          const msg = 'Plan parse failed: ' + (e.message || e) + '\nRaw: ' + body.slice(0, 300);
          console.error('[generate-plan]', msg);
          reject(msg); // reject with string so Electron serializes it properly
        }
      });
    });
    req.on('error', e => { console.error('[generate-plan] request error:', e.message); reject(e.message); });
    req.end();
  });
});

// â”€â”€ DEBATE MODE — Brain + Coder multi-round consensus before execution â”€â”€â”€â”€â”€â”€â”€â”€
ipcMain.handle('run-debate', async (event, { command, messageId }) => {
  const brainDirector = ACTIVE_BRAIN || 'gemini';
  // Coder uses a different model if configured, else same as Brain
  const coderDirector = (ACTIVE_CODER && !['imi-core', 'local', 'auto'].includes(ACTIVE_CODER))
    ? ACTIVE_CODER : brainDirector;

  const sendUpdate = (round, role, label, content, status = 'done') => {
    try { event.sender.send('debate-update', { messageId, round, role, label, content, status }); } catch(e) {}
  };

  // Read context — desktop task vs project task
  const isDesktopTask = /\b(desktop|create|make|build)\b/i.test(command) && !/\b(app\.tsx|electron|imi)\b/i.test(command);
  const projectMap = isDesktopTask ? '' : smartContext.getProjectMap(currentProjectRoot);
  const relevantCode = isDesktopTask ? '' : smartContext.getRelevantCode(command, currentProjectRoot);
  const desktopCtx = getDesktopSnapshot(1);
  const contextStr = (relevantCode || desktopCtx).slice(0, 3500);

  try {
    // â”€â”€ ROUND 1: Brain — High-level strategic plan â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    sendUpdate(1, 'brain', 'ðŸ§  Brain: Strategic Plan', '', 'streaming');

    const brainPlan = await callModelAPI(brainDirector,
      `You are the Brain of IMI — a high-level strategic AI planner.
Your role: analyze tasks and produce clear execution strategies. Focus on WHAT to do and WHY.
Be concise (under 250 words). Be decisive. Propose a clear 2-4 step strategy.
${projectMap ? 'PROJECT STRUCTURE:\n' + projectMap.slice(0, 1500) : 'DESKTOP CONTEXT:\n' + desktopCtx.slice(0, 1000)}`,
      [{ role: 'user', content: `Task: "${command}"\n\nProvide your strategic plan. Be specific about what files/locations are involved, the key approach, and any dependencies. Keep it under 250 words.` }],
      2500
    );
    sendUpdate(1, 'brain', 'ðŸ§  Brain: Strategic Plan', brainPlan, 'done');

    // â”€â”€ ROUND 2: Coder — Implementation critique â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    sendUpdate(2, 'coder', 'âš™ï¸ Coder: Implementation Review', '', 'streaming');

    const coderCritique = await callModelAPI(coderDirector,
      `You are the Coder of IMI — a precise implementation specialist who reviews plans for technical feasibility.
Your role: critique the Brain's plan. You MUST find at least ONE specific issue, edge case, or improvement.
Focus on HOW the code/implementation works — specific APIs, file structures, and technical constraints.
CURRENT CODE CONTEXT:\n${contextStr}`,
      [{ role: 'user', content: `The Brain proposed:\n\n${brainPlan}\n\nCritique it. Find implementation issues, edge cases, or better approaches. Reference actual code patterns or file paths where relevant. Under 250 words.` }],
      2500
    );
    sendUpdate(2, 'coder', 'âš™ï¸ Coder: Implementation Review', coderCritique, 'done');

    // â”€â”€ ROUND 3: Brain — Refined final plan â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    sendUpdate(3, 'brain', 'ðŸ§  Brain: Refined Plan', '', 'streaming');

    const finalPlan = await callModelAPI(brainDirector,
      `You are the Brain of IMI. You've received implementation feedback from the Coder.
Incorporate the valid criticisms and produce the FINAL refined execution plan.
Be specific and actionable — this plan will be executed directly.
End your response with a line starting with "EXECUTE:" containing the single most precise command to run this task.`,
      [{ role: 'user', content: `Original plan:\n${brainPlan}\n\nCoder's critique:\n${coderCritique}\n\nProduce the final refined plan addressing valid concerns. Under 250 words. End with EXECUTE: <precise command>` }],
      2500
    );
    sendUpdate(3, 'brain', 'ðŸ§  Brain: Refined Plan', finalPlan, 'done');

    // â”€â”€ ROUND 4: Coder — Surgical implementation output â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    sendUpdate(4, 'coder', 'âš™ï¸ Coder: Implementation Output', '', 'streaming');

    const patch = await callModelAPI(coderDirector,
      `You are the Coder of IMI — generating the final, precise implementation.
Based on the agreed plan, produce the exact implementation:
â€¢ For CODE tasks: exact code to write, with file paths clearly specified
â€¢ For SYSTEM tasks: the precise shell command or action
â€¢ For FILE tasks: the exact complete file content
Be surgical and precise. No preamble — just the implementation.
CONTEXT:\n${contextStr}`,
      [{ role: 'user', content: `Agreed plan:\n${finalPlan}\n\nTask: "${command}"\n\nGenerate the surgical implementation. Provide exact code/commands needed. Be complete and precise.` }],
      6000
    );
    sendUpdate(4, 'coder', 'âš™ï¸ Coder: Implementation Output', patch, 'done');

    // Extract EXECUTE line for the apply button
    const executeMatch = finalPlan.match(/EXECUTE:\s*(.+?)(?:\n|$)/i);
    const refinedCommand = executeMatch ? executeMatch[1].trim() : command;

    try { event.sender.send('debate-complete', { messageId, refinedCommand, patch, finalPlan }); } catch(_) {}
    return { success: true };

  } catch(e) {
    const errMsg = e?.message || String(e);
    sendUpdate(-1, 'error', 'âŒ Debate Error', errMsg, 'error');
    try { event.sender.send('debate-complete', { messageId, refinedCommand: command, patch: '', finalPlan: '', error: errMsg }); } catch(_) {}
    return { success: false, error: errMsg };
  }
});

// â”€â”€ UI PREVIEW — Gemini 2.0 Flash image generation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
ipcMain.handle('generate-ui-preview', async (_e, { description }) => {
  if (!GEMINI_KEY) throw new Error('Gemini API key missing — add it in Settings â†’ APIs');
  const imagePrompt = `Create a high-fidelity UI mockup screenshot of: ${description}. Dark theme desktop app, modern and clean design, professional product UI.`;
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'generativelanguage.googleapis.com',
      path: `/v1beta/models/gemini-2.0-flash-preview-image-generation:generateContent?key=${GEMINI_KEY}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, res => {
      let body = '';
      res.on('data', d => body += d.toString());
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          if (parsed.error) {
            const msg = parsed.error.message || 'Gemini image generation error';
            console.error('[generate-ui-preview] API error:', msg);
            reject(msg); return;
          }
          const parts = parsed?.candidates?.[0]?.content?.parts || [];
          const imagePart = parts.find(p => p.inlineData?.mimeType?.startsWith('image/'));
          if (!imagePart) {
            const msg = 'No image returned — try a more specific UI description';
            console.error('[generate-ui-preview]', msg, '| parts:', JSON.stringify(parts).slice(0, 200));
            reject(msg); return;
          }
          resolve({ base64: imagePart.inlineData.data, mimeType: imagePart.inlineData.mimeType });
        } catch(e) {
          console.error('[generate-ui-preview] parse error:', e.message);
          reject(e.message || String(e));
        }
      });
    });
    req.on('error', e => { console.error('[generate-ui-preview] request error:', e.message); reject(e.message); });
    req.write(JSON.stringify({
      contents: [{ parts: [{ text: imagePrompt }] }],
      generationConfig: { responseModalities: ['TEXT', 'IMAGE'] }
    }));
    req.end();
  });
});

// â”€â”€ PLAN PHASE EXECUTOR — routes directly through the main command pipeline â”€â”€
// Each phase prompt is treated exactly like a user command — same skill engine,
// same smart context, same desktop handlers, same AI brain. No separate pipeline.
ipcMain.on('execute-plan-phase', (event, payload) => {
  const { prompt, director = 'gemini', engine = 'imi-core', messageId } = payload;
  console.log(`[PLAN PHASE] â†’ main pipeline: "${prompt.slice(0, 100)}"`);
  // Re-emit as a normal command — goes through everything: skills, context, brain, coder
  ipcMain.emit('execute-command-stream', event, { command: prompt, director, engine, messageId, history: [] });
});


// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// ðŸ›  BRAIN TOOL USE — gives Gemini real file-reading tools before patching
// This is the core of "think like Claude": read first, then write.
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
const BRAIN_TOOLS_SCHEMA = {
  functionDeclarations: [
    {
      name: 'read_file',
      description: 'Read a file\'s actual contents. ALWAYS call this before writing any patch to a file — you must see the real code before you can edit it accurately.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path relative to project root (e.g. src/App.tsx) or absolute' },
          start_line: { type: 'integer', description: 'Optional: first line to read (1-indexed)' },
          end_line: { type: 'integer', description: 'Optional: last line to read (1-indexed)' }
        },
        required: ['path']
      }
    },
    {
      name: 'search_in_file',
      description: 'Find exact text in a file and see surrounding context. Use this to locate the precise search string for your patch before writing it.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path' },
          query: { type: 'string', description: 'Exact text to find' }
        },
        required: ['path', 'query']
      }
    },
    {
      name: 'list_project_files',
      description: 'List all source files in the current project. Use when you need to know what files exist.',
      parameters: { type: 'object', properties: {} }
    }
  ]
};

function executeBrainTool(toolName, args) {
  try {
    if (toolName === 'read_file') {
      const filePath = path.isAbsolute(args.path) ? args.path : path.join(currentProjectRoot || os.homedir(), args.path);
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');
      const start = args.start_line ? Math.max(0, args.start_line - 1) : 0;
      const end = args.end_line ? Math.min(lines.length, args.end_line) : Math.min(lines.length, start + 300);
      return lines.slice(start, end).map((l, i) => `${start + i + 1}: ${l}`).join('\n')
        + (end < lines.length ? `\n... (${lines.length - end} more lines — call again with start_line=${end + 1})` : '');
    }
    if (toolName === 'search_in_file') {
      const filePath = path.isAbsolute(args.path) ? args.path : path.join(currentProjectRoot || os.homedir(), args.path);
      const lines = fs.readFileSync(filePath, 'utf-8').split('\n');
      const hits = [];
      lines.forEach((line, i) => {
        if (line.includes(args.query)) {
          const s = Math.max(0, i - 2), e = Math.min(lines.length - 1, i + 2);
          hits.push(`\n--- MATCH at line ${i + 1} ---`);
          for (let j = s; j <= e; j++) hits.push(`${j + 1}${j === i ? ' >' : '  '} ${lines[j]}`);
        }
      });
      return hits.length > 0 ? hits.join('\n') : `"${args.query}" — NOT FOUND in ${args.path}. Search for a different string.`;
    }
    if (toolName === 'list_project_files') {
      const walk = (dir, depth = 0) => {
        if (depth > 3) return [];
        return fs.readdirSync(dir).flatMap(item => {
          if (['node_modules','.git','dist','dist-electron','.imi'].includes(item)) return [];
          const full = path.join(dir, item);
          try {
            return fs.statSync(full).isDirectory()
              ? [`${item}/`, ...walk(full, depth + 1).map(f => '  ' + f)]
              : [item];
          } catch { return []; }
        });
      };
      return walk(currentProjectRoot || process.cwd()).join('\n');
    }
    return 'Unknown tool: ' + toolName;
  } catch (e) { return `Tool error: ${e.message}`; }
}

async function callGeminiWithTools(systemPrompt, userCommand, geminiKey, model, maxTokens, onToolCall) {
  const contents = [{ role: 'user', parts: [{ text: systemPrompt + '\n\nUser request: ' + userCommand }] }];
  let iterations = 0;
  const MAX_ITER = 8;
  while (iterations++ < MAX_ITER) {
    const body = JSON.stringify({
      contents,
      tools: [BRAIN_TOOLS_SCHEMA],
      generationConfig: { temperature: 0.15, maxOutputTokens: maxTokens }
    });
    const rawResp = await new Promise((resolve, reject) => {
      const req = net.request({ method: 'POST', protocol: 'https:', hostname: 'generativelanguage.googleapis.com',
        path: `/v1beta/models/${model}:generateContent?key=${geminiKey}` });
      req.setHeader('Content-Type', 'application/json');
      let buf = '';
      req.on('response', res => { res.on('data', d => buf += d); res.on('end', () => resolve(buf)); });
      req.on('error', reject);
      req.write(body);
      req.end();
    });
    const parsed = JSON.parse(rawResp);
    if (parsed.error) throw new Error(parsed.error.message);
    const parts = parsed.candidates?.[0]?.content?.parts || [];
    const fnCalls = parts.filter(p => p.functionCall);
    const textParts = parts.filter(p => p.text);
    if (fnCalls.length === 0) return textParts.map(p => p.text).join('');
    // Execute tools
    contents.push({ role: 'model', parts });
    const toolResults = [];
    for (const p of fnCalls) {
      const { name, args } = p.functionCall;
      if (onToolCall) onToolCall(name, args);
      const result = executeBrainTool(name, args || {});
      toolResults.push({ functionResponse: { name, response: { result } } });
    }
    contents.push({ role: 'user', parts: toolResults });
  }
  throw new Error('Brain tool loop exceeded max iterations');
}
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

ipcMain.on('execute-command-stream', async (event, payload) => {
  const { command, director, messageId, imageBase64, imageMimeType, history = [] } = payload;
  const cmdLower = command.toLowerCase().trim();
  console.log(`[CMD] director=${director} | "${command.slice(0, 120)}${command.length > 120 ? 'â€¦' : ''}"`);

  // Plan phases use their own dedicated handler (execute-plan-phase), never reach here.

  // â”€â”€ â¬‡ UNIVERSAL INSTALL INTERCEPT — catches "install X" before Gemini sees it â”€â”€
  // Only trigger for short user commands (< 80 chars), never for long plan phase prompts
  const installMatch = command.length < 80 && command.match(/\b(?:install|setup|download|get|add)\b\s+(.+?)(?:\s+(?:for me|please|now|on my (?:pc|computer|machine|desktop)))?\s*$/i);
  if (installMatch) {
    const target = installMatch[1].trim().toLowerCase().replace(/['"]/g, '');
    const key = resolveInstallKey(target);
    if (key) {
      const info = INSTALL_MANIFEST[key];
      // Check if already installed
      try { execSync(info.cmd, { timeout: 3000 });
        event.sender.send('command-chunk', { messageId, chunk: `âœ… **${info.name}** is already installed on your system.` });
        event.sender.send('command-done', { messageId, fullText: `âœ… ${info.name} is already installed.` });
        return;
      } catch {}
      // Not installed — trigger in-app install
      event.sender.send('command-chunk', { messageId, chunk: `â¬‡ Installing **${info.name}** for youâ€¦\n` });
      const fakeEvent = { sender: event.sender };
      const result = await (async () => {
        fakeEvent.sender.send = (ch, data) => { if (ch === 'install-dep-progress') {
          const s = data.status === 'downloading' ? `â¬‡ Downloading ${info.name}â€¦ ${data.received||0}MB / ${data.total||0}MB (${data.percent}%)` :
                    data.status === 'installing' ? `âš™ï¸ Installing ${info.name}â€¦` :
                    data.status === 'done' ? `âœ… ${info.name} installed successfully!` : `âŒ ${data.error}`;
          event.sender.send('command-chunk', { messageId, chunk: `\n${s}` });
        } else { event.sender.send(ch, data); } };
        return ipcMain.listeners && (await new Promise(r => {
          exec(`echo test`, {}, () => r({ success: true }));
        }));
      })();
      // Actually call install-dep
      const installResult = await new Promise(async (resolve) => {
        const mockEvent = { sender: { send: (ch, data) => {
          if (ch === 'install-dep-progress') {
            const msg = data.status === 'downloading' ? `â¬‡ Downloading ${info.name}â€¦ ${data.received||0}MB / ${data.total||0}MB (${data.percent}%)` :
                        data.status === 'installing' ? `âš™ï¸ Installing ${info.name}â€¦` :
                        data.status === 'done' ? `\nâœ… **${info.name} installed!** You can now use it.` : `\nâŒ Install failed: ${data.error}`;
            event.sender.send('command-chunk', { messageId, chunk: '\n' + msg });
          }
        }}};
        // Re-invoke install logic directly
        const depKey = resolveInstallKey(target) || target;
        const depInfo = INSTALL_MANIFEST[depKey];
        if (!depInfo) { resolve({ success: false }); return; }
        try {
          if (depInfo.npm && !depInfo.winExe) {
            mockEvent.sender.send('install-dep-progress', { dep: depKey, name: depInfo.name, status: 'installing', percent: 20 });
            await new Promise((res2, rej2) => exec(`npm install -g ${depInfo.npm}`, { timeout: 120000 }, (err) => err ? rej2(err) : res2()));
            mockEvent.sender.send('install-dep-progress', { dep: depKey, name: depInfo.name, status: 'done', percent: 100 });
          } else if (depInfo.winget || depInfo.winExe) {
            // Try winget first — fully silent, no popup
            let wingetDone = false;
            if (depInfo.winget) {
              try {
                mockEvent.sender.send('install-dep-progress', { dep: depKey, name: depInfo.name, status: 'installing', percent: 10 });
                await new Promise((res2, rej2) => exec(`winget install --id ${depInfo.winget} --silent --accept-package-agreements --accept-source-agreements`, { timeout: 180000 }, (err) => err ? rej2(err) : res2()));
                wingetDone = true;
              } catch { /* fall through to EXE */ }
            }
            if (!wingetDone && depInfo.winExe) {
              const isMsi = depInfo.winExe.includes('.msi');
              const ext = isMsi ? '.msi' : '.exe';
              const installerPath = path.join(require('os').tmpdir(), `imi-install-${depKey}${ext}`);
              await downloadFile(mockEvent, depKey, depInfo.winExe, installerPath);
              mockEvent.sender.send('install-dep-progress', { dep: depKey, name: depInfo.name, status: 'installing', percent: 92 });
              const silentArgs2 = depInfo.winArgs || (isMsi ? '/quiet /norestart' : '/VERYSILENT /NORESTART /SP-');
              const cmd2 = isMsi ? `msiexec /i "${installerPath}" ${silentArgs2}` : `start /wait /b "" "${installerPath}" ${silentArgs2}`;
              await new Promise((res2, rej2) => exec(cmd2, { timeout: 180000, windowsHide: true }, (err) => err ? rej2(err) : res2()));
              require('fs').unlink(installerPath, () => {});
            }
            mockEvent.sender.send('install-dep-progress', { dep: depKey, name: depInfo.name, status: 'done', percent: 100 });
          }
          resolve({ success: true });
        } catch(e) { mockEvent.sender.send('install-dep-progress', { dep: depKey, name: depInfo.name, status: 'error', percent: 0, error: e.message }); resolve({ success: false }); }
      });
      event.sender.send('command-done', { messageId, fullText: `Install ${info.name} complete.` });
      return;
    }
  }

  // â”€â”€ ðŸ” HARDCODED SYSTEM QUERIES — always intercept, no skill file needed â”€â”€
  if (/\b(what|which|list|show)\b.{0,50}\b(ai|ollama|llm|model|models)\b.{0,50}\b(installed|have|downloaded|available)\b/i.test(cmdLower)
    || /\b(installed|downloaded)\b.{0,30}\b(ai|ollama|llm|model|models)\b/i.test(cmdLower)) {
    try {
      const ollamaRaw = await new Promise(resolve => exec('ollama list', { timeout: 5000 }, (err, stdout) => resolve(err ? null : stdout.trim())));
      let ollamaSection = '🦙 **Ollama:** Not installed or no models pulled yet.';
      if (ollamaRaw) {
        const lines = String(ollamaRaw).split('\n').slice(1).filter(Boolean);
        ollamaSection = lines.length > 0
          ? `🦙 **Ollama (local models):**\n${lines.map(l => `  â€¢ ${l.trim().split(/\s+/).slice(0,2).join('  ')}`).join('\n')}`
          : '🦙 **Ollama:** Installed but no models pulled yet. Use Dev Hub â†’ AI Models to pull one.';
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
        ? `ðŸ”§ **AI CLI Tools:**\n${installedCLIs.map(t => `  â€¢ ${t.name} v${t.version}`).join('\n')}`
        : 'ðŸ”§ **AI CLI Tools:** None detected.';
      event.sender.send('command-chunk', { messageId, chunk: `⚡ [IMI System]\n\n${ollamaSection}\n\n${cliSection}\n\nðŸ’¡ Pull more models in **Dev Hub â†’ AI Models**.` });
      event.sender.send('command-end', { messageId, code: 0 });
      return;
    } catch(e) { /* fall through to AI */ }
  }

  // â”€â”€ 🙏 GITHUB NAVIGATION — open browser directly, 0 tokens â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const isGithubNav = /\b(go to|open|show|view|navigate|visit|take me to|pull up|launch)\b.{0,50}\b(my\s+)?(github|gh repo|repository|repo)\b/i.test(cmdLower)
    || /\b(my\s+)?(github|gh)\b.{0,40}\b(repo|profile|page|account|project)\b/i.test(cmdLower)
    || /\bgithub\.com\b/i.test(cmdLower);
  if (isGithubNav) {
    const ghUser = GITHUB_USER || 'creepybunny99';
    const ghRepo = GITHUB_REPO || 'creepybunny99/IMI-IDE-Unified-Sync';
    const isProfile = /\b(profile|account|page|me)\b/i.test(cmdLower) && !/\brepo\b/i.test(cmdLower);
    const url = isProfile ? `https://github.com/${ghUser}` : `https://github.com/${ghRepo}`;
    shell.openExternal(url);
    event.sender.send('command-chunk', { messageId, chunk: `🙏 Opening GitHub...\n🌐 **${url}**` });
    event.sender.send('command-end', { messageId, code: 0 });
    return;
  }

  // â”€â”€ ⚡ SKILL ENGINE — check skills FIRST before any API call â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const matchedSkill = skillEngine.match(command);
  if (matchedSkill) {
    if (matchedSkill.type === 'cached' && matchedSkill.cachedResponse) {
      // Instant cached response — 0 tokens
      event.sender.send('command-chunk', { messageId, chunk: `⚡ [Skill: ${matchedSkill.name}]\n\n${matchedSkill.cachedResponse}` });
      event.sender.send('command-end', { messageId, code: 0 });
      skillEngine.recordHit(matchedSkill.id, 600, director);
      return;
    }
    if (matchedSkill.type === 'direct') {
      // Route to existing direct handlers — they record the hit themselves
      if (matchedSkill.handler === 'browser') {
        // If skill has a hardcoded URL, use it directly
        if (matchedSkill.url) {
          shell.openExternal(matchedSkill.url);
          event.sender.send('command-chunk', { messageId, chunk: `⚡ [Skill: ${matchedSkill.name}]\n🌐 Opening ${matchedSkill.url}` });
          event.sender.send('command-end', { messageId, code: 0 });
          skillEngine.recordHit(matchedSkill.id, 400, director);
          return;
        }
        const cmdL = command.toLowerCase();
        const urlMatch = command.match(/https?:\/\/[^\s]+/i);
        // Match "head to X", "go to X", "open X", "navigate to X", "visit X", "launch X"
        // Extended FILLER set — all common words that are NOT site names
        const FILLER = new Set([
          'up','my','the','a','an','browser','chrome','internet','web','website','webpage',
          'and','show','it','me','us','that','this','here','please','now','again','just',
          'to','for','in','on','at','of','is','it','its','so','do','go','get','see',
          'open','launch','visit','navigate','page','site','link','url','app'
        ]);
        // Only match when a real destination word follows the action verb
        const siteMatch = cmdL.match(/(?:head\s+to|go\s+to|navigate\s+to|take\s+me\s+to|visit|launch)\s+([a-z0-9.-]+(?:\s+[a-z0-9.-]+)*)|(?:open)\s+([a-z0-9.-]+(?:\.[a-z]{2,})(?:\s+[a-z0-9.-]+)*)/i);
        let raw = urlMatch ? urlMatch[0] : null;
        if (!raw && siteMatch) {
          // Walk through captured words, skip fillers, take first real word
          const captured = (siteMatch[1] || siteMatch[2] || '').trim();
          const words = captured.split(/\s+/);
          const site = words.find(w => !FILLER.has(w) && w.length > 2);
          // Only use it if it looks like a real site (has a dot OR is a known brand â‰¥4 chars)
          if (site && (site.includes('.') || site.length >= 4)) raw = site;
        }
        if (raw) {
          let url;
          if (raw.startsWith('http')) {
            url = raw;
          } else if (raw.includes('.')) {
            url = `https://${raw}`;
          } else {
            // No dot = try DDG lookup; if that fails, fall through to AI (don't guess .com blindly)
            const resolved = await ddgResolveUrl(raw);
            if (!resolved) {
              // No confident URL found — fall through to AI (don't guess blindly)
              raw = null;
              url = null;
            } else {
              url = resolved;
            }
          }
          if (url) {
            shell.openExternal(url);
            event.sender.send('command-chunk', { messageId, chunk: `⚡ [Skill: ${matchedSkill.name}]\n🌐 Opening ${url}` });
            event.sender.send('command-end', { messageId, code: 0 });
            skillEngine.recordHit(matchedSkill.id, 400, director);
            return;
          }
        }
        // No URL could be confidently extracted — fall through to AI
      }
      if (matchedSkill.handler === 'stats') {
        const reply = `⚡ [Skill: ${matchedSkill.name}]\nðŸ“Š Project: ${currentProjectRoot}\nðŸ§  Brain: ${ACTIVE_BRAIN} | Coder: ${ACTIVE_CODER}\n⚡ Skill efficiency: ${skillEngine.getEfficiency()}% | Tokens saved: ${skillEngine.stats.tokensSaved.toLocaleString()}\nðŸ’¾ Free RAM: ${(os.freemem()/1024/1024/1024).toFixed(2)}GB`;
        event.sender.send('command-chunk', { messageId, chunk: reply });
        event.sender.send('command-end', { messageId, code: 0 });
        skillEngine.recordHit(matchedSkill.id, 400, director);
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
              ? `🦙 **Ollama (local models):**\n${lines.map(l => `  â€¢ ${l.trim().split(/\s+/)[0]}`).join('\n')}`
              : '🦙 **Ollama:** Installed but no models pulled yet. Go to Dev Hub â†’ AI Models to pull one.';
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
            ? `ðŸ”§ **AI CLI Tools:**\n${installedCLIs.map(t => `  â€¢ ${t.name} (${t.version})`).join('\n')}`
            : 'ðŸ”§ **AI CLI Tools:** None detected.';
          const reply = `⚡ [Skill: List Installed AI Models]\n\n${ollamaSection}\n\n${cliSection}\n\nðŸ’¡ Tip: Pull more local models in **Dev Hub â†’ AI Models**.`;
          event.sender.send('command-chunk', { messageId, chunk: reply });
          event.sender.send('command-end', { messageId, code: 0 });
          skillEngine.recordHit(matchedSkill.id, 600, director);
          return;
        } catch(e) {
          // Fall through to AI if something goes wrong
        }
      }
      // desktop handler falls through to existing triggerDesktopTask below
    }
    // passthrough: skill matched but still needs API — track as partial hit
    skillEngine.recordHit(matchedSkill.id, 100, director);
  } else {
    // No skill matched — record miss for pattern analysis + auto-skill creation
    skillEngine.recordMiss(command, 600);
  }
  // â”€â”€ End skill check — continue to AI â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  // â”€â”€ 🌐 UNIVERSAL BROWSER ACTIONS — run for ANY brain model â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const _cmdU = command.toLowerCase();
  // _isCodeCtx = true means the command is about IMI's own code/UI, not about creating files on desktop
  const _isCodeCtx = /\b(function|component|variable|class|import|export|the app|imi|electron|react|code|style|json|package|sidebar|dashboard|settings|tab|button|panel|header|modal|theme|font|color|layout|animation)\b/.test(_cmdU)
    && !/\b(desktop|my desktop|game|pong|snake|tetris|calculator|todo|timer|clock)\b/.test(_cmdU);
  if (!_isCodeCtx) {
    // Browser automation: "take control", "click", "screenshot", "log in", "fill in", etc.
    const needsBrowserBot = /\b(take control|screenshot|click|fill in|type into|search for|scroll|hover|log ?in|sign ?in|take a screen|show me (my|the) screen)\b/.test(_cmdU);
    if (needsBrowserBot) {
      triggerBrowserAgent(event, command, messageId);
      return;
    }
    // Simple open: "open netflix", "head to youtube", "go to amazon", "launch spotify", etc.
    const SKIP = new Set(['up','my','the','a','an','browser','chrome','internet','web','website','webpage','page','it','new','tab','tabs','some','and','then','also','please','now','me','their','this','that']);
    const openPatterns = [
      /(?:head\s+to|go\s+to|take\s+me\s+to|navigate\s+to|open\s+up\s+(?:my\s+)?(?:browser\s+(?:and\s+)?)?(?:head\s+to|go\s+to|navigate\s+to)?)\s+([a-z0-9.-]+)/i,
      /(?:open|visit|launch)\s+([a-z0-9.-]+)/i,
    ];
    const hardcoded = { netflix:'netflix.com', youtube:'youtube.com', gmail:'gmail.com', spotify:'open.spotify.com', twitch:'twitch.tv', reddit:'reddit.com', twitter:'x.com', instagram:'instagram.com', facebook:'facebook.com', amazon:'amazon.com', google:'google.com', github:'github.com', discord:'discord.com', chatgpt:'chat.openai.com', linkedin:'linkedin.com', tiktok:'tiktok.com' };
    const explicitUrls = [...command.matchAll(/https?:\/\/[^\s,]+/g)].map(m => m[0]);
    let resolvedUrls = [...explicitUrls];
    if (resolvedUrls.length === 0) {
      // Check hardcoded site names in command first
      for (const [name, domain] of Object.entries(hardcoded)) {
        if (new RegExp(`\\b${name}\\b`).test(_cmdU)) { resolvedUrls.push(`https://${domain}`); break; }
      }
      // Regex extraction fallback
      if (resolvedUrls.length === 0) {
        for (const pat of openPatterns) {
          const m = _cmdU.match(pat);
          if (m) {
            const words = m[1].trim().split(/\s+/);
            const site = words.find(w => !SKIP.has(w));
            if (site && site.length > 2) { resolvedUrls.push(site.includes('.') ? `https://${site}` : `https://${site}.com`); break; }
          }
        }
      }
    }
    if (resolvedUrls.length > 0 && /\b(open|go to|head to|visit|launch|navigate|take me to|browser|chrome)\b/.test(_cmdU)) {
      resolvedUrls.forEach(u => shell.openExternal(u));
      event.sender.send('command-chunk', { messageId, chunk: resolvedUrls.map(u => `🌐 Opening: **${u}**`).join('\n') });
      event.sender.send('command-end', { messageId, code: 0 });
      return;
    }
  }
  // â”€â”€ End universal browser actions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  // â”€â”€ DESKTOP / FILE CREATION — director-agnostic, always runs before AI routing â”€â”€

  // These always use Gemini's API for content generation regardless of which brain is selected.
  // Desktop typo tolerance: "destop", "dekstop", "desktp", "desctop", "destktop" etc.
  const _hasDesktop = /\b(desktop|my desktop|des[ck]?t?k?o?p|deskt?o?p|destop|dekstop|desctop)\b/i.test(command);
  {
    const _deskL = command.toLowerCase();
    // Create folder on desktop
    const _isDesktopOp = _hasDesktop && (
      /\b(create|make|new|add|build)\b.{0,25}\b(folder|directory)\b/i.test(command)
      || /\b(folder|directory)\b.{0,25}\b(create|make|new|add|build|on|for)\b/i.test(command)
    );
    if (_isDesktopOp) {
      console.log(`[ROUTE] â†’ triggerDesktopTask (folder+file on desktop)`);
      triggerDesktopTask(event, command, _deskL, messageId);
      return;
    }
    // Create a program/script/file on desktop (no folder needed)
    const _isCreateProgram = _hasDesktop && (
      /\b(create|make|build|write|generate|want|need|give me|put)\b.{0,40}\b(script|program|app|application|tool|website|calculator|game|utility|file)\b/i.test(command)
      || /\b(create|make|build|write|generate)\b.{0,25}\b(python|javascript|html|css|typescript|bash|shell|node)\b/i.test(command)
      || /\b(html|python|javascript)\b.{0,30}\b(pong|snake|tetris|calculator|todo|game|app|tool)\b/i.test(command)
      || /\b(make|create|build|put|give|i want|i need|can you|can u)\b.{0,30}\b(file|new one|new file|something|game|app|script|program|tool|calculator)\b/i.test(command)
    );
    if (_isCreateProgram) {
      console.log(`[ROUTE] â†’ triggerAutoCreateFile (desktop file)`);
      triggerAutoCreateFile(event, command, messageId);
      return;
    }
  }
  // â”€â”€ End desktop / file creation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  // â”€â”€ SMART INTENT CLASSIFIER — AI-powered fallback for anything that didn't match regexes â”€â”€
  // Catches typos, vague descriptions, indirect phrasing, missing "desktop" keyword, etc.
  const _looksLikeCreationTask = !_isCodeCtx && (
    // Has desktop (or typo) + any action/object vibe
    (_hasDesktop && /\b(make|create|build|write|generate|want|need|give|put|place|can|could|file|new)\b/i.test(command))
    // OR sounds like wanting a specific game/app/tool (default to desktop even without the word)
    || /\b(make|create|build|write|give me|i want|i need|can you make|can u make|put)\b.{0,70}\b(game|pong|snake|tetris|chess|calculator|todo|timer|clock|stopwatch|quiz|app|program|tool|website|chatbot|utility|file)\b/i.test(command)
  );
  if (_looksLikeCreationTask) {
    console.log(`[ROUTE] â†’ classifyCommandIntent (ambiguous creation task)`);
    const intent = await classifyCommandIntent(command);
    if (intent && intent.confidence >= 55) {
      if (intent.intent === 'desktop_file') {
        console.log(`[ROUTE] smartRoute â†’ desktop_file (${intent.fileType}, name: ${intent.fileName})`);
        triggerAutoCreateFile(event, command, messageId, { fileName: intent.fileName, fileType: intent.fileType });
        return;
      }
      if (intent.intent === 'desktop_folder') {
        console.log(`[ROUTE] smartRoute â†’ desktop_folder`);
        triggerDesktopTask(event, command, command.toLowerCase(), messageId);
        return;
      }
      if (intent.intent === 'open_browser' && intent.url) {
        const url = intent.url.startsWith('http') ? intent.url : `https://${intent.url}`;
        console.log(`[ROUTE] smartRoute â†’ open_browser (${url})`);
        shell.openExternal(url);
        event.sender.send('command-chunk', { messageId, chunk: `🌐 Opening: **${url}**` });
        event.sender.send('command-end', { messageId, code: 0 });
        return;
      }
      // intent is imi_change or chat — fall through to AI
    }
  }
  // â”€â”€ End smart intent classifier â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  // Smart context — reads only what's relevant for this specific command
  const relevantCode = smartContext.getRelevantCode(command, currentProjectRoot);
  const projectMap = smartContext.getProjectMap(currentProjectRoot);
  const memoryLog = smartContext.getMemorySummary();

  // â”€â”€ 🌐 WEB GROUNDING — inject live DDG context for factual/current queries â”€â”€
  const WEB_QUERY_RE = /\b(what is|what's|who is|who's|latest|current version|how do i|how to|when is|when was|price of|cost of|news about|today|release date|changelog|just released|just dropped|available now)\b/i;
  let webGrounding = '';
  if (WEB_QUERY_RE.test(command)) {
    try {
      const ddgResult = await ddgSearch(command, 2500);
      if (ddgResult && (ddgResult.abstract || ddgResult.answer || ddgResult.relatedTopics.length)) {
        const parts = [];
        if (ddgResult.answer) parts.push(`Quick Answer: ${ddgResult.answer}`);
        if (ddgResult.abstract) parts.push(`${ddgResult.abstractSource ? ddgResult.abstractSource + ': ' : ''}${ddgResult.abstract}`);
        if (ddgResult.abstractUrl) parts.push(`Source: ${ddgResult.abstractUrl}`);
        if (ddgResult.relatedTopics.length) parts.push(`Related: ${ddgResult.relatedTopics.slice(0, 2).join(' | ')}`);
        if (parts.length) webGrounding = `\nWEB CONTEXT (live, retrieved now via DuckDuckGo):\n${parts.join('\n')}\nUse this to inform your answer — treat it as current, factual context.\n`;
      }
    } catch { /* grounding is best-effort — never block the main flow */ }
  }
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  const PROJECT_CONTEXT = `You are the Brain inside IMI (Integrated Merge Interface) — an AI orchestration desktop app built with Electron + React/TypeScript.
You have FULL awareness of this project's actual live code (shown below). Think and act like Claude Code — read the code, understand the structure, make precise targeted changes.

${projectMap}

${memoryLog ? memoryLog + '\n' : ''}${webGrounding}LIVE CODE (only the sections relevant to this request):
${relevantCode}

SYSTEM INFO:
- Project Root: ${currentProjectRoot}
- Desktop: ${path.join(os.homedir(), 'Desktop')}
- Active Coder: ${ACTIVE_CODER}
- Files: electron-main.cjs (Electron backend), src/App.tsx (all React UI), src/index.css (all styles)
- Tabs: dashboard, command (Command Center), devhub (Dev Hub), skills, settings
- Settings sub-tabs: general, appearance, apis, sync, telemetry, automation

USER IDENTITY (never ask the user for this — you already know it):
- GitHub Username: ${GITHUB_USER || 'creepybunny99'}
- GitHub Profile: https://github.com/${GITHUB_USER || 'creepybunny99'}
- IMI Repo: https://github.com/${GITHUB_REPO || 'creepybunny99/IMI-IDE-Unified-Sync'}
- Desktop path: ${path.join(os.homedir(), 'Desktop')}

When the user says "IMI" = this app. "Settings" = Settings tab. "make it look better" = edit src/index.css or src/App.tsx.
When the user says "my github" / "my repo" — use the USER IDENTITY above, never ask.
You know the real code. Use it. Be precise. Act like you built this yourself.

UNDERSTANDING IMPERFECT REQUESTS:
Users often type fast, make typos, or describe things indirectly. Always infer their intent:
- "htlm" = html, "pythno" = python, "pyton" = python, "javascipt" = javascript
- "something cool", "a fun thing", "a game" = create an HTML file with that game/app
- "on my desktop", "for my desktop", "put it on my desktop" = create a file at Desktop path
- "make it nicer", "looks bad", "fix the ui" = edit src/index.css or src/App.tsx
- "it broke", "not working" = debug whatever they're talking about
Never say "I'm not sure what you mean" — always make a reasonable interpretation and act.

HOW TO THINK AND ACT — CLAUDE AGENT PATTERNS (apply these at all times):
1. READ BEFORE EDIT — always read a file's actual contents before modifying it. Never assume what's in it.
2. PARALLEL WHEN INDEPENDENT — if two pieces of information are needed and neither depends on the other, fetch both at the same time. Don't do them one-by-one when parallel is possible.
3. SEQUENTIAL WHEN DEPENDENT — if step B needs the result of step A, finish A first. Never guess a tool's output.
4. MINIMAL FOOTPRINT — make the smallest change that achieves the goal. Surgical edits beat full rewrites.
5. VERIFY BEFORE DESTROY — before deleting files, sending messages, or publishing anything irreversible, describe what will happen and wait for explicit confirmation.
6. INFER INTENT — never refuse a vague request. Pick the single most reasonable interpretation and execute it. Only ask if you genuinely cannot make any reasonable guess.
7. NO UNNECESSARY QUESTIONS — if the answer is discoverable by reading the code or files, read them first. Only ask the user for things that cannot be determined any other way.
8. TRUST THE CODE — the actual file contents are ground truth. Don't rely on memory of what the file "should" look like.
9. BEST-EFFORT FALLBACK — if an optional enrichment step fails (web lookup, doc fetch, etc.), continue anyway. Never block the main task on a non-critical path.
10. COMPLETE THE TASK — don't stop halfway. If a task has multiple steps, finish all of them in one pass before reporting done.

CLAUDE API INTERNALS (know this to help users build agents):
- Endpoint: POST https://api.anthropic.com/v1/messages
- Required headers: x-api-key, anthropic-version: 2023-06-01
- Streaming: set "stream": true â†’ SSE events fire: message_start â†’ content_block_start â†’ content_block_delta (text_delta or input_json_delta) â†’ content_block_stop â†’ message_delta â†’ message_stop
- Tool use: when stop_reason is "tool_use", extract tool_use blocks from content, execute them, return results as role:user type:tool_result messages, then call API again
- Models: claude-opus-4-5 (deep reasoning), claude-sonnet-4-5 (balanced, IMI default), claude-haiku-3-5 (fast/cheap)
- Context window: 200K tokens on all models
- Tool definition shape: { name, description, input_schema: { type:"object", properties:{...}, required:[...] } }
- The description field is the most important part of a tool definition — it tells Claude WHEN to use it
`;
  const blueprintPrefix = `${PROJECT_CONTEXT}
GLOBAL BLUEPRINT PROTOCOL: The user wants a CODE CHANGE to IMI.

IMI's UI is built in src/App.tsx and src/index.css. Key areas that can be improved:
- Sidebar: navigation buttons, logo, project root display
- Command Center: chat bubbles, input bar, send button, SYS console
- Dashboard: stats cards, quick actions
- Dev Hub: tool cards, AI model cards, search bars
- Skills panel: skill cards, optimizer tab
- Settings: API key inputs, config sections
- Global: font sizes, spacing, colors, glassmorphism effects, animations

STEP 1 — UNDERSTAND INTENT FIRST:
If the user mentions "appearance", "UI", "look", "design", "style", or "Settings > Appearance" — they are referring to the visual look of IMI. The Appearance & UI settings are in Settings > APPEARANCE tab (settingsActiveSubTab = 'appearance') AND in src/index.css and src/App.tsx.

If the request says "make it better" / "improve" / "nicer" / "polish" WITH a location (e.g. "appearance", "UI", "settings", "dashboard", "sidebar") — DO NOT ask for clarification. Pick the single most impactful improvement for that area and generate a spec for it.

Only ask for clarification when the request gives NO location AND NO hint of what to change.

If you must ask, format like this:
â“ Sure! Which part of IMI would you like to improve?
â€¢ [Real option based on actual code you can see above]
â€¢ [Real option based on actual code you can see above]
â€¢ [Real option based on actual code you can see above]
â€¢ Something else — just describe it

STEP 2 — WHEN ACTING:
Generate a precise TECHNICAL SPECIFICATION for IMI-CORE. State: exact file (src/index.css or src/App.tsx), exact CSS property or JSX element, exact value change. One focused change only.

User Request: `;
  const chatPrefix = `You are the AI brain inside IMI (Integrated Merge Interface) — a desktop developer tool built with Electron + React.
You are smart, fast, and understand what people mean even when they type badly, use slang, or make typos.

ABOUT THE USER:
- GitHub: ${GITHUB_USER || 'creepybunny99'}
- Desktop: ${path.join(os.homedir(), 'Desktop')}
- Project: ${currentProjectRoot}

LIVE DESKTOP SNAPSHOT (scanned right now — this is what is ACTUALLY on the user's desktop):
${getDesktopSnapshot(1)}

ABOUT IMI (the app you live inside):
- Built with: Electron + React/TypeScript + Vite
- Key files: electron-main.cjs (backend), src/App.tsx (UI), src/index.css (styles)
- Has tabs: Dashboard, Command Center, Dev Hub, Skills, Settings
- You can modify IMI's own code when asked

CRITICAL — IMI IS AN ELECTRON APP, NOT A WEB BROWSER:
- IMI runs in Electron with FULL Node.js file system access. It can create, read, write, and open ANY file on the user's computer.
- NEVER say "browsers cannot create files" or "I can't access the file system". That is WRONG for IMI.
- IMI has built-in handlers that use fs.writeFileSync, fs.mkdirSync, shell.openPath — it creates files and folders natively.
- When asked to create a file, folder, game, or script — DO IT. Don't explain limitations. IMI has no such limitations.

RULES:
1. UNDERSTAND INTENT, NOT WORDS. "can u make a pong game" = make a working pong game. "htlm" = html. "u" = you. "wat" = what.
2. NEVER say "I don't understand" or "Could you clarify?" — always make your best guess and go.
3. Be concise. No filler. No "Certainly!" or "Of course!" or "Great question!". Just answer or do it.
4. If someone asks to make/create/build something, be specific about what you'd create and how.
5. For questions, give direct answers first, explain only if needed.
6. Be friendly and natural — talk like a person, not a corporate chatbot.
${styleAnalyzer.getCompactPrompt()}
User: `;

  if (director === 'gemini') {
    if (!GEMINI_KEY) { event.sender.send('command-error', { messageId, error: "Gemini Key missing." }); return; }

    // â”€â”€ Desktop / file operations â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const cmdL = command.toLowerCase();

    // Edit an existing file on desktop (gemini-only: uses project context to decide what to edit)
    const isEditOp = (
      /\b(edit|modify|update|fix|improve|rewrite|change)\b.{0,60}(\.[a-z]{2,6}|\.txt|\.py|\.js|\.html|\.css|\.json|\.ts|\.md)\b/i.test(command)
      || (/\b(desktop|my desktop|folder)\b/i.test(command) && /\b(edit|modify|update|fix|improve|rewrite)\b/i.test(command) && /\b(file|\.)\b/i.test(command))
    );
    if (isEditOp) {
      console.log(`[ROUTE] â†’ triggerFileEdit`);
      triggerFileEdit(event, command, messageId);
      return;
    }

    // â”€â”€ Screen vision — take screenshot + send to Gemini Vision â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const needsVision = /\b(look at|see|view|check|analyze|read)\b.{0,30}\b(screen|desktop|window|monitor)\b/i.test(command)
      || /\b(screen|desktop|window|monitor)\b.{0,30}\b(look|see|view|check|analyze|read)\b/i.test(command);
    if (needsVision) {
      console.log(`[ROUTE] â†’ triggerDesktopVision`);
      triggerDesktopVision(event, command, messageId);
      return;
    }

    // Agent mode — complex multi-step coding tasks that need readâ†’editâ†’verify loop
    const isAgentTask = (
      /\b(fix|debug|find.*error|why.*not working|broken|refactor|rewrite|add.*feature|implement|build.*feature)\b/i.test(command)
      && /\b(imi|app|code|file|component|function|screen|page|ui|css|style)\b/i.test(command)
    ) || /\bagent mode\b/i.test(command);

    if (isAgentTask && payload.engine === 'imi-core') {
      console.log(`[ROUTE] â†’ runAgentLoop (director=${director})`);
      runAgentLoop(event, command, currentProjectRoot, messageId, director).catch(e => {
        event.sender.send('command-error', { messageId, error: `Agent loop failed: ${e.message}` });
      });
      return;
    }

    // â”€â”€ Windows absolute file path — open with shell.openPath â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // Catches: "open C:\Users\nikol\Desktop\pong_game.html in the browser"
    const winFilePathMatch = command.match(/[A-Za-z]:\\[^\n"']+\.(?:html?|pdf|txt|png|jpe?g|gif|js|ts|css|py|json|md|csv|xml|svg)/i);
    if (winFilePathMatch && /\b(open|show|launch|preview|view|display|load|start)\b/i.test(command)) {
      const filePath = winFilePathMatch[0].trim().replace(/[/\\]+$/, '');
      console.log(`[ROUTE] â†’ shell.openPath (Windows file): ${filePath}`);
      shell.openPath(filePath);
      event.sender.send('command-chunk', { messageId, chunk: `🚀 Opening: ${filePath}` });
      event.sender.send('command-end', { messageId, code: 0 });
      return;
    }

    // â”€â”€ Browser routing â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const isCodeAction = /\b(file|function|component|variable|class|import|export|the app|imi|electron|react|code|script|style|css|json|package)\b/.test(cmdL);

    // Tier 2: full Puppeteer agent — only when real browser automation is needed
    const needsAutomation = !isCodeAction && /\b(screenshot|click|fill|type into|search for|fix.*site|fix.*web|take control|scroll|hover|form|log ?in|sign ?in)\b/.test(cmdL);

    // Tier 1: simple open — instant via shell, zero tokens, zero Puppeteer startup
    const isSimpleOpen = !isCodeAction && !needsAutomation && (
      /\bgo to\b/.test(cmdL) ||
      /https?:\/\//.test(cmdL) ||
      /\b(browser|tab\b|tabs\b|chrome|internet|webpage|website|navigate|browsing|see it|show me|look at|view|see)\b/.test(cmdL) ||
      /\b(open|launch|visit)\b/.test(cmdL)
    );

    if (needsAutomation) {
      console.log(`[ROUTE] â†’ triggerBrowserAgent (automation)`);
      triggerBrowserAgent(event, command, messageId);
      return;
    }

    if (isSimpleOpen) {
      // Extract explicit URLs first, then resolve bare site names
      const urls = [...command.matchAll(/https?:\/\/[^\s,]+/g)].map(m => m[0]);
      // Words that are browser/UI names, not website names
      const skipWords = /^(chrome|crome|chromium|firefox|edge|safari|browser|browsers|internet|a|an|the|my|up|it|its|new|tab|tabs|some|and|or|then|next|also|please|now|me|us|show|open|that|this|here|again|for|to|of)$/;
      const siteNames = [...cmdL.matchAll(/(?:head\s+to|go\s+to|visit|launch|navigate\s+to|take\s+me\s+to)\s+([a-z0-9.-]+)/g)]
        .map(m => m[1].trim())
        .filter(s => !skipWords.test(s) && s.length > 2)
        .map(s => s.includes('.') ? `https://${s}` : `https://${s}.com`);
      // Also extract named sites from "open <site>" only when site has a dot (e.g. "open stockanalysis.com")
      const openDotSites = [...cmdL.matchAll(/\bopen\s+([a-z0-9-]+\.[a-z]{2,}(?:\.[a-z]{2,})?(?:\/[^\s]*)?)/g)]
        .map(m => `https://${m[1].trim()}`);
      let allUrls = [...new Set([...urls, ...siteNames, ...openDotSites])];
      // Fallback: if no URL found but command is just "open the browser" / "show it to me" / "show me it"
      // — look back through conversation history for the most recent URL that was mentioned
      if (allUrls.length === 0 && /\b(show|open|take me|load|go|it|browser)\b/i.test(cmdL)) {
        for (let i = history.length - 1; i >= 0; i--) {
          const histText = history[i]?.text || history[i]?.content || '';
          const histUrl = histText.match(/https?:\/\/[^\s)>\]"']+/);
          if (histUrl) { allUrls = [histUrl[0]]; break; }
          // Also check for bare domain mentions in AI responses like "finance.yahoo.com"
          const bareDomain = histText.match(/\b([a-z0-9-]+\.(?:com|org|net|io|co|gov|edu|tv|app)[^\s)>\]"']*)/i);
          if (bareDomain) { allUrls = [`https://${bareDomain[1]}`]; break; }
        }
      }
      if (allUrls.length > 0) {
        console.log(`[ROUTE] â†’ isSimpleOpen (shell.openExternal) urls=${allUrls.join(',')}`);
        allUrls.forEach(u => shell.openExternal(u));
        event.sender.send('command-chunk', { messageId, chunk: allUrls.map(u => `🌐 Opening: **${u}**`).join('\n') });
        event.sender.send('command-end', { messageId, code: 0 });
        return;
      }
    }

    // isCodingAction = true when user wants to change IMI itself.
    // Needs an action verb AND an IMI-specific term. "make the sidebar better" â†’ true. "make a pong game" â†’ false.
    const _cmdWords = command.toLowerCase();
    const _hasAction = /\b(fix|update|change|improve|add|remove|refactor|rewrite|implement|edit|modify|make|build|create|setup|better|nicer|polish|redesign|restyle)\b/i.test(command);
    const _hasIMITarget = /\b(imi|the app|sidebar|dashboard|settings|tab|button|panel|header|modal|ui|css|style|layout|component|function|code|electron|react|index\.css|app\.tsx|devhub|dev hub|command center|chat|theme|font|color|appearance|look)\b/i.test(command);
    const _isAboutDesktopFile = /\b(desktop|my desktop)\b/i.test(command) && /\b(game|pong|snake|calculator|html|python|file|script)\b/i.test(command);
    const isCodingAction = ((_hasAction && _hasIMITarget) || /\b(src\/|electron-main|app\.tsx|index\.css)\b/i.test(command)) && !_isAboutDesktopFile;
    const activePrefix = isCodingAction ? blueprintPrefix : chatPrefix;

    // â”€â”€ ðŸ›  TOOL-USE BRAIN — for coding actions, read files first â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    if (isCodingAction) {
      console.log(`[ROUTE] â†’ Gemini tool-use loop (reads real files before patching)`);
      event.sender.send('command-chunk', { messageId, chunk: 'ðŸ§  Analyzing project...\n' });
      try {
        const brainResult = await callGeminiWithTools(
          activePrefix, command, GEMINI_KEY, BRAIN_MODEL, BRAIN_MAX_TOKENS,
          (toolName, args) => {
            const label = toolName === 'read_file'       ? `ðŸ” Reading \`${args.path}\`...` :
                          toolName === 'search_in_file'  ? `ðŸ” Searching \`${args.path}\` for "${args.query}"...` :
                          'ðŸ—‚ Listing project files...';
            event.sender.send('command-chunk', { messageId, chunk: '\n' + label + '\n' });
          }
        );
        if (!brainResult.trim()) {
          event.sender.send('command-error', { messageId, error: 'Brain returned empty response.' }); return;
        }
        event.sender.send('command-chunk', { messageId, chunk: '\n' + brainResult });
        tokenStats[director] = (tokenStats[director] || 0) + Math.ceil(brainResult.length / 4);
        saveGlobalState();
        // triggerCoderImplementation sends command-end itself — never send it here too
        const coderEngine = payload.engine || 'imi-core';
        event.sender.send('command-chunk', { messageId, chunk: `\n\n[IMI ORCHESTRATOR] Handing off to ${coderEngine.toUpperCase()}` });
        setTimeout(() => triggerCoderImplementation(event, coderEngine, brainResult, messageId), 800);
      } catch(e) {
        event.sender.send('command-error', { messageId, error: `Brain tool-use failed: ${e.message}` });
      }
      triggerGitSync();
      return;
    }
    // â”€â”€ Non-coding actions: use fast streaming as before â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    console.log(`[ROUTE] â†’ Gemini stream (isCodingAction=${isCodingAction})`);
    const hostname = 'generativelanguage.googleapis.com';
    // Use user-configured model (from System > Brain Configuration)
    const apiPath = `/v1beta/models/${BRAIN_MODEL}:streamGenerateContent?alt=sse&key=${GEMINI_KEY}`;
    console.log('[IMI Brain] Model:', BRAIN_MODEL, '| Temp:', BRAIN_TEMPERATURE, '| MaxTokens:', BRAIN_MAX_TOKENS);
    const req = net.request({ method: 'POST', protocol: 'https:', hostname, path: apiPath });
    req.setHeader('Content-Type', 'application/json');
    // Build multi-turn contents from history
    const geminiContents = [];
    for (const h of history) {
      geminiContents.push({ role: h.role === 'assistant' ? 'model' : 'user', parts: [{ text: h.text }] });
    }
    // Current message (with optional image)
    const currentParts = [];
    if (imageBase64 && imageMimeType) currentParts.push({ inlineData: { mimeType: imageMimeType, data: imageBase64 } });
    currentParts.push({ text: (geminiContents.length === 0 ? activePrefix : '') + command });
    // System instruction prepended to first user turn if no history
    if (geminiContents.length === 0) {
      geminiContents.push({ role: 'user', parts: currentParts });
    } else {
      geminiContents.push({ role: 'user', parts: currentParts });
    }
    req.write(JSON.stringify({
      contents: geminiContents,
      systemInstruction: { parts: [{ text: activePrefix }] },
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

          // Auto-open any URLs Gemini mentions when the request was browser-related
          if (isSimpleOpen || /\b(open|browser|website|show me|visit|go to|navigate|see|look)\b/i.test(command)) {
            const mentionedUrls = [...fullText.matchAll(/https?:\/\/[^\s)>\]"',]+/g)].map(m => m[0]);
            if (mentionedUrls.length > 0) {
              const urlToOpen = mentionedUrls[mentionedUrls.length - 1]; // use the last/most specific URL
              shell.openExternal(urlToOpen);
              event.sender.send('command-chunk', { messageId, chunk: `\n\n🌐 Opened: **${urlToOpen}**` });
            }
          }

          event.sender.send('command-end', { messageId, code: 0 });
          const isClarifying = fullText.includes('\u2753') || fullText.includes('?') && fullText.includes('\u2022') && fullText.toLowerCase().includes('did you mean');
          if (isCodingAction && payload.engine && payload.engine !== 'gemini' && !isClarifying) {
            event.sender.send('command-chunk', { messageId, chunk: `\n\n--- [IMI ORCHESTRATOR] Handing off to ${payload.engine.toUpperCase()} ---` });
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
    const _hasAction2 = /\b(fix|update|change|improve|add|remove|refactor|rewrite|implement|edit|modify|make|build|create|setup|better|nicer|polish|redesign)\b/i.test(command);
    const _hasIMITarget2 = /\b(imi|the app|sidebar|dashboard|settings|tab|button|panel|header|modal|ui|css|style|layout|component|function|code|electron|react|index\.css|app\.tsx|devhub|dev hub|command center|chat|theme|font|color|appearance|look)\b/i.test(command);
    const _isDesktopFile2 = /\b(desktop|my desktop)\b/i.test(command) && /\b(game|pong|snake|calculator|html|python|file|script)\b/i.test(command);
    const isCodingAction = ((_hasAction2 && _hasIMITarget2) || /\b(src\/|electron-main|app\.tsx|index\.css)\b/i.test(command)) && !_isDesktopFile2;
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
    
    const customMessages = [{ role: 'system', content: activePrefix }];
    for (const h of history) customMessages.push({ role: h.role, content: h.text });
    customMessages.push({ role: 'user', content: command });
    req.write(JSON.stringify({
      model: apiModel,
      messages: customMessages,
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
          const isClarifying2 = fullText.includes('\u2753') || fullText.includes('?') && fullText.includes('\u2022') && fullText.toLowerCase().includes('did you mean');
          if (isCodingAction && payload.engine && payload.engine !== director && !isClarifying2) {
            event.sender.send('command-chunk', { messageId, chunk: `\n\n--- [IMI ORCHESTRATOR] Handing off to ${payload.engine.toUpperCase()} ---` });
            setTimeout(() => triggerCoderImplementation(event, payload.engine, fullText, messageId), 1000);
          }
        }
      });
    });
    req.on('error', (err) => event.sender.send('command-error', { messageId, error: `Custom Network Error: ${err.message}` }));
    req.end();
    return;
  }

  // â”€â”€ Local Ollama Brain (ollama:<model>) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (director && director.startsWith('ollama:')) {
    await ensureOllamaRunning();
    const ollamaModel = director.slice(7); // strip "ollama:"
    // Detect model size to set appropriate timeout & warn user
    const modelSizeGB = (() => { try { const out = require('child_process').execSync('ollama list', { timeout: 3000 }).toString(); const line = out.split('\n').find(l => l.toLowerCase().includes(ollamaModel.split(':')[0].toLowerCase())); if (!line) return 0; const m = line.match(/([\d.]+)\s*GB/i); return m ? parseFloat(m[1]) : 0; } catch { return 0; } })();
    const timeoutMs = modelSizeGB >= 15 ? 120000 : modelSizeGB >= 8 ? 90000 : 60000;
    const _hasAction4 = /\b(fix|update|change|improve|add|remove|refactor|rewrite|implement|edit|modify|make|build|create|better|nicer|polish|redesign)\b/i.test(command);
    const _hasIMITarget4 = /\b(imi|the app|sidebar|dashboard|settings|tab|button|panel|header|modal|ui|css|style|layout|component|function|code|electron|react|index\.css|app\.tsx|devhub|dev hub|command center|chat|theme|font|color|appearance|look)\b/i.test(command);
    const _isDesktopFile4 = /\b(desktop|my desktop)\b/i.test(command) && /\b(game|pong|snake|calculator|html|python|file|script)\b/i.test(command);
    const isCodingAction = ((_hasAction4 && _hasIMITarget4) || /\b(src\/|electron-main|app\.tsx|index\.css)\b/i.test(command)) && !_isDesktopFile4;
    // For local models use a lightweight system prompt for casual chat — injecting the full
    // project code into a 3-7B model's context leaves no room for conversation history.
    const ollamaLocalPrefix = `You are a helpful AI assistant inside IMI. You can chat, answer questions, explain code, and help with planning.

CRITICAL — YOU ARE A LOCAL CHAT MODEL:
- You CANNOT create files, run shell commands, open browsers, or execute any tools. IMI's backend handles all of that automatically before your response.
- Do NOT generate fake tool output. Never write "⚡ On it — generating...", "Created ...", "🚀 Opening in browser...", or any similar fake action messages.
- If asked to create a file, run a command, or open a website, say honestly: "I'm a local model and can't execute actions directly. Try rephrasing your request so IMI's action system can catch it, or switch your Brain to Gemini."
- Be concise and direct. No filler words. No "Certainly!" or "Great question!".

User: `;
    const ollamaLightPrefix = isCodingAction ? chatPrefix : ollamaLocalPrefix;
    const activePrefix = ollamaLightPrefix;
    // Warn if user sent an image but the model likely doesn't support vision
    const visionModels = ['llava', 'moondream', 'bakllava', 'minicpm', 'qwen2-vl', 'llava-phi', 'llava-llama'];
    const modelSupportsVision = visionModels.some(v => ollamaModel.toLowerCase().includes(v));
    if (imageBase64 && !modelSupportsVision) {
      event.sender.send('command-chunk', { messageId, chunk: `âš ï¸ **${ollamaModel.split(':').pop() || ollamaModel}** is a text-only model and cannot see images.\n\nTo analyze images, switch your Brain to **Gemini** (built-in, free) or pull a vision model like **moondream** (1.7GB) or **llava:7b** (4.1GB) from the AI Models tab.\n` });
      event.sender.send('command-end', { messageId, code: 0 });
      return;
    }
    const req = net.request({ method: 'POST', protocol: 'http:', hostname: 'localhost', port: 11434, path: '/v1/chat/completions' });
    req.setHeader('Content-Type', 'application/json');
    let timedOut = false;
    const ollamaTimeout = setTimeout(() => {
      timedOut = true;
      try { req.abort(); } catch {}
      const sizeHint = modelSizeGB >= 15 ? ` This model is ${modelSizeGB.toFixed(0)}GB — it needs a GPU to run at usable speed.` : '';
      event.sender.send('command-error', { messageId, error: `â±ï¸ Ollama timed out after ${timeoutMs/1000}s.${sizeHint}\n\nðŸ’¡ Try switching to **qwen2.5-coder:7b** (4.7GB) — it runs fast on CPU.` });
    }, timeoutMs);
    // Build conversation history for Ollama (OpenAI format)
    const ollamaMessages = [{ role: 'system', content: activePrefix }];
    for (const h of history) ollamaMessages.push({ role: h.role, content: h.text });
    ollamaMessages.push({
      role: 'user',
      content: imageBase64 && imageMimeType
        ? [{ type: 'image_url', image_url: { url: `data:${imageMimeType};base64,${imageBase64}` } }, { type: 'text', text: command }]
        : command
    });
    const body = JSON.stringify({
      model: ollamaModel,
      messages: ollamaMessages,
      stream: true,
      temperature: 0.7,
    });
    req.write(body);
    let fullText = '';
    req.on('response', (res) => {
      let buf = '';
      res.on('data', (chunk) => {
        buf += chunk.toString();
        const lines = buf.split('\n');
        buf = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          const json = line.slice(5).trim();
          if (json === '[DONE]') continue;
          try {
            const delta = JSON.parse(json)?.choices?.[0]?.delta?.content;
            if (delta) {
              fullText += delta;
              event.sender.send('command-chunk', { messageId, chunk: delta });
            }
          } catch {}
        }
      });
      res.on('end', () => {
        clearTimeout(ollamaTimeout);
        if (!timedOut) {
          event.sender.send('command-done', { messageId, fullText });
          tokenStats['ollama'] = (tokenStats['ollama'] || 0) + Math.ceil(fullText.length / 4);
          saveGlobalState();
        }
      });
    });
    req.on('error', (err) => { clearTimeout(ollamaTimeout); if (!timedOut) event.sender.send('command-error', { messageId, error: `Ollama error: ${err.message}. Make sure Ollama is running (run: ollama serve).` }); });
    req.end();
    return;
  }

  // â”€â”€ Claude (Anthropic) Brain â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (director === 'claude') {
    if (!CLAUDE_KEY) { event.sender.send('command-error', { messageId, error: 'Claude API key missing. Add it in Settings â†’ APIs.' }); return; }
    const _hasAction3 = /\b(fix|update|change|improve|add|remove|refactor|rewrite|implement|edit|modify|make|build|create|setup|better|nicer|polish|redesign)\b/i.test(command);
    const _hasIMITarget3 = /\b(imi|the app|sidebar|dashboard|settings|tab|button|panel|header|modal|ui|css|style|layout|component|function|code|electron|react|index\.css|app\.tsx|devhub|dev hub|command center|chat|theme|font|color|appearance|look)\b/i.test(command);
    const _isDesktopFile3 = /\b(desktop|my desktop)\b/i.test(command) && /\b(game|pong|snake|calculator|html|python|file|script)\b/i.test(command);
    const isCodingAction = ((_hasAction3 && _hasIMITarget3) || /\b(src\/|electron-main|app\.tsx|index\.css)\b/i.test(command)) && !_isDesktopFile3;
    const activePrefix = isCodingAction ? blueprintPrefix : chatPrefix;
    const req = net.request({ method: 'POST', protocol: 'https:', hostname: 'api.anthropic.com', path: '/v1/messages' });
    req.setHeader('Content-Type', 'application/json');
    req.setHeader('x-api-key', CLAUDE_KEY.trim());
    req.setHeader('anthropic-version', '2023-06-01');
    req.setHeader('anthropic-beta', 'prompt-caching-2024-07-31');
    // Build message history for Claude
    const claudeMessages = history.map(h => ({ role: h.role, content: h.text }));
    // Add current message (with optional image)
    claudeMessages.push({
      role: 'user',
      content: imageBase64 && imageMimeType
        ? [{ type: 'image', source: { type: 'base64', media_type: imageMimeType, data: imageBase64 } }, { type: 'text', text: command }]
        : command
    });
    const body = JSON.stringify({
      model: 'claude-sonnet-4-5',
      max_tokens: 8096,
      stream: true,
      system: activePrefix,
      messages: claudeMessages,
    });
    req.write(body);
    let fullText = '';
    req.on('response', (res) => {
      let buf = '';
      res.on('data', chunk => {
        buf += chunk.toString();
        const lines = buf.split('\n'); buf = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          const json = line.slice(5).trim();
          try {
            const evt = JSON.parse(json);
            if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta') {
              const delta = evt.delta.text || '';
              if (delta) { fullText += delta; event.sender.send('command-chunk', { messageId, chunk: delta }); }
            }
          } catch {}
        }
      });
      res.on('end', () => {
        event.sender.send('command-done', { messageId, fullText });
        tokenStats['claude'] = (tokenStats['claude'] || 0) + Math.ceil(fullText.length / 4);
        saveGlobalState();
        const isClarifying = fullText.includes('\u2753') || (fullText.includes('?') && fullText.includes('\u2022'));
        if (isCodingAction && payload.engine && payload.engine !== 'claude' && !isClarifying) {
          event.sender.send('command-chunk', { messageId, chunk: `\n\n--- [IMI ORCHESTRATOR] Handing off to ${payload.engine.toUpperCase()} ---` });
          setTimeout(() => triggerCoderImplementation(event, payload.engine, fullText, messageId), 1000);
        }
      });
    });
    req.on('error', err => event.sender.send('command-error', { messageId, error: `Claude API error: ${err.message}` }));
    req.end();
    return;
  }


  // â”€â”€ Direct OpenAI-compatible API handlers (ChatGPT / DeepSeek / Mistral / Perplexity) â”€â”€â”€â”€â”€
  // These all share the same streaming format — only hostname, model, and key differ
  const openAICompatMap = {
    chatgpt:    { hostname: 'api.openai.com',        path: '/v1/chat/completions', model: 'gpt-4o',                              key: () => OPENAI_KEY,      label: 'OpenAI API key' },
    deepseek:   { hostname: 'api.deepseek.com',      path: '/v1/chat/completions', model: 'deepseek-chat',                       key: () => DEEPSEEK_KEY,    label: 'DeepSeek API key' },
    mistral:    { hostname: 'api.mistral.ai',         path: '/v1/chat/completions', model: 'mistral-large-latest',                key: () => MISTRAL_KEY,     label: 'Mistral API key' },
    perplexity: { hostname: 'api.perplexity.ai',      path: '/chat/completions',   model: 'llama-3.1-sonar-large-128k-online',   key: () => PERPLEXITY_KEY,  label: 'Perplexity API key' },
    groq:       { hostname: 'api.groq.com',           path: '/openai/v1/chat/completions', model: 'llama-3.3-70b-versatile',     key: () => GROQ_KEY,        label: 'Groq API key' },
    grok:       { hostname: 'api.x.ai',               path: '/v1/chat/completions', model: 'grok-3',                             key: () => GROK_KEY,        label: 'xAI (Grok) API key' },
    cohere:     { hostname: 'api.cohere.com',          path: '/v2/chat',            model: 'command-r-plus',                      key: () => COHERE_KEY,      label: 'Cohere API key' },
  };

  if (openAICompatMap[director]) {
    const cfg = openAICompatMap[director];
    const apiKey = cfg.key();
    if (!apiKey) { event.sender.send('command-error', { messageId, error: `${cfg.label} missing. Add it in Settings â†’ APIs.` }); return; }
    const _hasAction5 = /\b(fix|update|change|improve|add|remove|refactor|rewrite|implement|edit|modify|make|build|create|better|nicer|polish|redesign)\b/i.test(command);
    const _hasIMITarget5 = /\b(imi|the app|sidebar|dashboard|settings|tab|button|panel|header|modal|ui|css|style|layout|component|function|code|electron|react|index\.css|app\.tsx|devhub|dev hub|command center|chat|theme|font|color|appearance|look)\b/i.test(command);
    const _isDesktopFile5 = /\b(desktop|my desktop)\b/i.test(command) && /\b(game|pong|snake|calculator|html|python|file|script)\b/i.test(command);
    const isCodingAction = ((_hasAction5 && _hasIMITarget5) || /\b(src\/|electron-main|app\.tsx|index\.css)\b/i.test(command)) && !_isDesktopFile5;
    const activePrefix = isCodingAction ? blueprintPrefix : chatPrefix;
    // Build messages with full history
    const msgs = [{ role: 'system', content: activePrefix }];
    for (const h of history) msgs.push({ role: h.role, content: h.text });
    // Add current message (with optional image for vision-capable models like gpt-4o)
    if (imageBase64 && imageMimeType && director === 'chatgpt') {
      msgs.push({ role: 'user', content: [{ type: 'image_url', image_url: { url: `data:${imageMimeType};base64,${imageBase64}` } }, { type: 'text', text: command }] });
    } else {
      msgs.push({ role: 'user', content: command });
    }
    const req = net.request({ method: 'POST', protocol: 'https:', hostname: cfg.hostname, path: cfg.path });
    req.setHeader('Content-Type', 'application/json');
    req.setHeader('Authorization', `Bearer ${apiKey.trim()}`);
    req.write(JSON.stringify({ model: cfg.model, messages: msgs, stream: true, temperature: BRAIN_TEMPERATURE }));
    let fullText = '', buf = '';
    req.on('response', (res) => {
      if (res.statusCode !== 200) {
        let errBody = '';
        res.on('data', d => errBody += d.toString());
        res.on('end', () => { try { const j = JSON.parse(errBody); event.sender.send('command-error', { messageId, error: `${director} Error: ${j.error?.message || errBody}` }); } catch { event.sender.send('command-error', { messageId, error: `${director} HTTP ${res.statusCode}` }); } });
        return;
      }
      res.on('data', chunk => {
        buf += chunk.toString();
        const lines = buf.split('\n'); buf = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          const json = line.slice(5).trim();
          if (!json || json === '[DONE]') continue;
          try {
            const parsed = JSON.parse(json);
            const delta = parsed.choices?.[0]?.delta?.content || '';
            if (delta) { fullText += delta; event.sender.send('command-chunk', { messageId, chunk: delta }); }
          } catch {}
        }
      });
      res.on('end', () => {
        tokenStats[director] = (tokenStats[director] || 0) + Math.ceil(fullText.length / 4);
        saveGlobalState();
        event.sender.send('command-end', { messageId, code: 0 });
        const isClarifying = fullText.includes('\u2753') || (fullText.includes('?') && fullText.includes('\u2022'));
        if (isCodingAction && payload.engine && payload.engine !== director && !isClarifying) {
          event.sender.send('command-chunk', { messageId, chunk: `\n\n--- [IMI ORCHESTRATOR] Handing off to ${payload.engine.toUpperCase()} ---` });
          setTimeout(() => triggerCoderImplementation(event, payload.engine, fullText, messageId), 1000);
        }
      });
    });
    req.on('error', err => event.sender.send('command-error', { messageId, error: `${director} network error: ${err.message}` }));
    req.end();
    return;
  }

  // â”€â”€ CLI-based fallback (geminicli, jules, etc.) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const commandName = director === 'geminicli' ? 'gemini' : director;
  let binPath = await checkCommand(commandName);
  if (!binPath && process.platform === 'win32') binPath = await checkCommand(`${commandName}.cmd`);
  if (!binPath) binPath = commandName; // Ultimate fallback: let shell:true figure it out

  const safeEnv = { ...process.env, ...getMCPEnv(), GEMINI_API_KEY: GEMINI_KEY, JULES_API_KEY: JULES_KEY };
  delete safeEnv.ELECTRON_RUN_AS_NODE;
  // Inject conversation history as context into CLI prompt
  let historyContext = '';
  if (history.length > 0) {
    historyContext = '\n[CONVERSATION HISTORY]\n' + history.map(h => `${h.role === 'user' ? 'User' : 'Assistant'}: ${h.text}`).join('\n') + '\n[END HISTORY]\n\nCurrent message: ';
  }
  const promptWithHistory = historyContext + command;
  const argsString = director === 'geminicli' ? `-p ${shellEscape(promptWithHistory)}` : `chat ${shellEscape(promptWithHistory)}`;

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

  // Route local Ollama models directly
  if (engine && engine.startsWith('ollama:')) {
    await triggerOllamaCoder(event, engine.slice(7), brainPlan, messageId);
    return;
  }

  if (engine.toLowerCase() === 'imi-core') {
    if (!GEMINI_KEY) { event.sender.send('command-error', { messageId, error: "Gemini key missing for IMI CORE." }); return; }

    if (mainWindow) mainWindow.webContents.send('coder-status', 'Scanning');
    event.sender.send('command-chunk', { messageId, chunk: `\n[IMI CORE] Reading project files...` });

    // Read current file contents so Gemini knows what actually exists
    const filesToRead = ['src/App.tsx', 'src/index.css', 'package.json'];
    let fileContext = '';
    for (const f of filesToRead) {
      const fp = path.join(currentProjectRoot, f);
      if (fs.existsSync(fp)) {
        const raw = fs.readFileSync(fp, 'utf-8');
        // Send up to 500 lines so IMI-CORE can see code added anywhere in the file
        const lines = raw.split('\n');
        const limit = f === 'package.json' ? 60 : 500;
        const snippet = lines.slice(0, limit).join('\n');
        const note = lines.length > limit ? ` [file has ${lines.length} lines total; showing first ${limit}]` : '';
        fileContext += `\n\n=== ${f}${note} ===\n${snippet}\n=== end ${f} ===`;
      }
    }

    if (mainWindow) mainWindow.webContents.send('coder-status', 'Implementing');
    event.sender.send('command-chunk', { messageId, chunk: `\n[IMI CORE] Generating surgical patches...` });

    const corePrompt = `You are IMI CORE, a surgical code editor. You apply MINIMAL precise changes to real project files.

PROJECT: IMI IDE MERGE INTEGRATIONS
Stack: Electron + React/Vite/TypeScript
Root: ${currentProjectRoot}

CURRENT FILE STATE (use these exact strings for "search"):${fileContext}

BRAIN PLAN TO IMPLEMENT:
${brainPlan.trim()}

OUTPUT: A raw JSON array of patch objects. No markdown, no explanation — ONLY the JSON array.
Format: [{ "file": "relative/path", "search": "exact existing text to find", "replace": "replacement text" }]

CRITICAL RULES:
- "search" MUST be copied VERBATIM from the CURRENT FILE STATE shown above — never invent or paraphrase it
- Pick a short unique anchor (3-10 lines) from the actual file as "search" — do not paste the entire file
- "replace" is the new text that replaces the search anchor (can be empty string "" to delete)
- To delete a block: set "replace" to "" (empty string)
- To add new code after an anchor: include the anchor in "replace" plus the new code below it
- To create a brand NEW file: set "search" to "__NEW_FILE__"
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
      generationConfig: { temperature: 0.1, maxOutputTokens: 8192, thinkingConfig: { thinkingBudget: 0 } }
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
              if (!patch.file || patch.search === undefined || patch.replace === undefined) continue;
              const fp = path.join(currentProjectRoot, patch.file);
              // Safety: never escape project root
              if (!fp.startsWith(currentProjectRoot)) { results.push(`BLOCKED: ${patch.file} (outside root)`); continue; }

              if (patch.search === '' || patch.search === '__NEW_FILE__') {
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
              smartContext.recordChange(patch.file, `${patch.search ? patch.search.slice(0, 60).replace(/\s+/g, ' ') + '...' : 'patch applied'}`);
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
          console.log("ðŸŒ‰ Connecting to Bridge to bypass CORS...");
          
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
                  console.log(\`ðŸ” Found \${targets.length} active windows. Scanning for Lexical Editor...\`);
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
          bridgeWs.onerror = () => console.error("âŒ Bridge failed on 9000. Make sure your IDE/Bridge uses this port.");
      })();
    `;
    if (mainWindow) mainWindow.webContents.executeJavaScript(autoPilotScript);

    event.sender.send('command-chunk', { messageId, chunk: `\n\n--- 🚀 AUTO-ROUTING TO ANTIGRAVITY ---\n\nThe Brain's spec has been saved. The CDP Injection tunnel is actively bypassing security and forcing your IDE to begin implementation...` });
    event.sender.send('command-end', { messageId, code: 0 });
    if (mainWindow) mainWindow.webContents.send('coder-status', 'Idle');
    return;
  }


  // â”€â”€ JULES CODER â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Jules is cloud/async: submits task â†’ GitHub PR â†’ we poll + pull it back locally
  if (mainWindow) mainWindow.webContents.send('coder-status', 'Implementing');

  // Resolve repo (owner/repo) from git remote
  let repoString = '';
  try {
    const gitUrl = execSync('git config --get remote.origin.url', { cwd: currentProjectRoot }).toString().trim();
    const match = gitUrl.match(/github\.com[:/]([^/]+\/[^.]+?)(\.git)?$/i);
    if (match) repoString = match[1];
  } catch(e) {}

  if (!repoString) {
    event.sender.send('command-chunk', { messageId, chunk: `\nâŒ [Jules] Cannot find a GitHub remote for this project.\nMake sure the project is pushed to GitHub and try again.` });
    event.sender.send('command-end', { messageId, code: 1 });
    if (mainWindow) mainWindow.webContents.send('coder-status', 'Idle');
    return;
  }

  if (!GITHUB_TOKEN) {
    event.sender.send('command-chunk', { messageId, chunk: `\nâŒ [Jules] GitHub token is missing. Add it in Settings â†’ API Keys.` });
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
    event.sender.send('command-chunk', { messageId, chunk: `\nâŒ [Jules] Jules CLI not found in PATH.\nInstall it with: npm install -g @google/jules\nOr check https://jules.google.com for setup instructions.` });
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
      event.sender.send('command-chunk', { messageId, chunk: `\nâš ï¸ [Jules] Exited with code ${code}. Jules may still be processing in the cloud.` });
    }

    event.sender.send('command-chunk', { messageId, chunk: `\nâ³ [Jules] Task submitted. Polling GitHub for Jules' PR (up to 10 min)...\n` });
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
        event.sender.send('command-chunk', { messageId, chunk: `\nâœ… [Jules] PR found: "${newPR.title}" (#${newPR.number})\n🌿 Branch: ${newPR.head.ref}\nâ¬‡ï¸  Pulling changes to your desktop...\n` });
        if (mainWindow) mainWindow.webContents.send('coder-status', 'Pulling Jules Changes');
        try {
          execSync(`git fetch origin ${newPR.head.ref}`, { cwd: currentProjectRoot, timeout: 30000 });
          execSync(`git checkout ${newPR.head.ref}`, { cwd: currentProjectRoot, timeout: 10000 });
          event.sender.send('command-chunk', { messageId, chunk: `âœ… [Jules] Branch "${newPR.head.ref}" checked out locally.\nYour files are now updated!\nðŸ”— PR: ${newPR.html_url}\n` });
        } catch(gitErr) {
          event.sender.send('command-chunk', { messageId, chunk: `âš ï¸ [Jules] Could not auto-checkout branch: ${gitErr.message}\nManually run: git fetch && git checkout ${newPR.head.ref}\nðŸ”— PR: ${newPR.html_url}\n` });
        }
        event.sender.send('command-end', { messageId, code: 0 });
        if (mainWindow) mainWindow.webContents.send('coder-status', 'Idle');
        triggerGitSync();
        return;
      }

      if (attempt >= maxAttempts) {
        event.sender.send('command-chunk', { messageId, chunk: `\nâ° [Jules] Timed out waiting for PR after 10 minutes.\nCheck GitHub manually: https://github.com/${repoString}/pulls\n` });
        event.sender.send('command-end', { messageId, code: 0 });
        if (mainWindow) mainWindow.webContents.send('coder-status', 'Idle');
        return;
      }

      event.sender.send('command-chunk', { messageId, chunk: `â³ [Jules] Still working... (${attempt}/${maxAttempts}) checking again in 30s\n` });
      setTimeout(poll, 30000);
    };

    // First check after 30s (Jules needs time to start)
    setTimeout(poll, 30000);
  });
}

// â”€â”€ Ollama local model as Coder â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function triggerOllamaCoder(event, modelName, brainPlan, messageId) {
  if (mainWindow) mainWindow.webContents.send('coder-status', 'Implementing');
  event.sender.send('command-chunk', { messageId, chunk: `\n\nðŸ¤– [${modelName}] Reading project files...\n` });

  // Read file context
  const filesToRead = ['electron-main.cjs', 'src/App.tsx', 'src/index.css'];
  let fileContext = '';
  for (const f of filesToRead) {
    const fp = path.join(currentProjectRoot, f);
    if (fs.existsSync(fp)) {
      const snippet = fs.readFileSync(fp, 'utf-8').split('\n').slice(0, 120).join('\n');
      fileContext += `\n\n=== ${f} ===\n${snippet}\n=== end ${f} ===`;
    }
  }

  const corePrompt = `You are a surgical code editor for IMI (Electron + React/TypeScript).
Apply MINIMAL precise changes to implement the plan below.

CURRENT FILE STATE:${fileContext}

PLAN TO IMPLEMENT:
${brainPlan.trim()}

OUTPUT: A raw JSON array ONLY. No markdown, no explanation.
Format: [{ "file": "relative/path", "search": "exact existing text", "replace": "replacement text" }]
To create a new file, set "search" to "".
If no code change needed, return [].`;

  return new Promise((resolve) => {
    const req = net.request({ method: 'POST', protocol: 'http:', hostname: 'localhost', port: 11434, path: '/v1/chat/completions' });
    req.setHeader('Content-Type', 'application/json');
    const body = JSON.stringify({
      model: modelName, stream: true, temperature: 0.2,
      messages: [{ role: 'user', content: corePrompt }]
    });
    req.write(body);
    let coreRaw = '';
    req.on('response', (res) => {
      let buf = '';
      res.on('data', chunk => {
        buf += chunk.toString();
        const lines = buf.split('\n'); buf = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          const json = line.slice(5).trim();
          if (json === '[DONE]') continue;
          try { const delta = JSON.parse(json)?.choices?.[0]?.delta?.content; if (delta) coreRaw += delta; } catch {}
        }
      });
      res.on('end', () => {
        event.sender.send('command-chunk', { messageId, chunk: `[${modelName}] Applying patches...\n` });
        try {
          const jsonStart = coreRaw.indexOf('[');
          const jsonEnd = coreRaw.lastIndexOf(']') + 1;
          if (jsonStart === -1) throw new Error('No JSON array found in response');
          const patches = JSON.parse(coreRaw.slice(jsonStart, jsonEnd));
          let applied = 0;
          for (const patch of patches) {
            const filePath = path.join(currentProjectRoot, patch.file);
            if (patch.search === '' || patch.search === null) {
              fs.mkdirSync(path.dirname(filePath), { recursive: true });
              fs.writeFileSync(filePath, patch.replace, 'utf-8');
              event.sender.send('command-chunk', { messageId, chunk: `âœ… Created: ${patch.file}\n` });
              applied++;
            } else {
              if (!fs.existsSync(filePath)) continue;
              const content = fs.readFileSync(filePath, 'utf-8');
              if (!content.includes(patch.search)) {
                event.sender.send('command-chunk', { messageId, chunk: `âš ï¸ Could not find patch target in ${patch.file}\n` });
                continue;
              }
              fs.writeFileSync(filePath, content.replace(patch.search, patch.replace), 'utf-8');
              event.sender.send('command-chunk', { messageId, chunk: `âœ… Patched: ${patch.file}\n` });
              applied++;
            }
          }
          if (applied === 0) {
            event.sender.send('command-chunk', { messageId, chunk: `â„¹ï¸ No file changes were needed.\n` });
          } else {
            event.sender.send('command-chunk', { messageId, chunk: `\nâœ… Done — ${applied} patch(es) applied. Run a build to verify.\n` });
            triggerGitSync();
          }
        } catch(e) {
          event.sender.send('command-chunk', { messageId, chunk: `\nâš ï¸ [${modelName}] Parse error: ${e.message}\nRaw output:\n${coreRaw.slice(0,500)}\n` });
        }
        event.sender.send('command-end', { messageId, code: 0 });
        if (mainWindow) mainWindow.webContents.send('coder-status', 'Idle');
        resolve(undefined);
      });
    });
    req.on('error', err => {
      event.sender.send('command-chunk', { messageId, chunk: `\nâŒ Ollama connection error: ${err.message}\nMake sure Ollama is running.\n` });
      event.sender.send('command-end', { messageId, code: 1 });
      if (mainWindow) mainWindow.webContents.send('coder-status', 'Idle');
      resolve(undefined);
    });
    req.end();
  });
}

// â”€â”€ Smart intent classifier — used when regex routing doesn't match â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Sends a tiny fast Gemini call to understand what the user wants, then routes accordingly.
async function classifyCommandIntent(command) {
  if (!GEMINI_KEY) return null;
  try {
    const prompt = `You are an intent classifier for a desktop AI assistant. Analyze this command and return ONLY valid JSON.

Command: "${command}"

Return JSON with this exact structure:
{
  "intent": "desktop_file" | "desktop_folder" | "open_browser" | "imi_change" | "chat",
  "fileType": "html" | "py" | "js" | "ts" | "txt" | null,
  "fileName": "descriptive_snake_case_name_no_extension" | null,
  "url": "site.com" | null,
  "wantsOpen": true | false,
  "confidence": 0-100
}

Rules:
- "desktop_file" = user wants any file/game/app/program/script/tool created
- "desktop_folder" = user wants a folder made on the desktop
- "open_browser" = user wants to open a website or web app
- "imi_change" = user wants to change the IMI application's own UI or code
- "chat" = general question, conversation, or explanation request
- fileName: infer a good snake_case descriptive name (e.g. "pong_game", "calculator", "todo_list")
- fileType: infer from context — games/apps/websites = html, data/automation = py, default = html
- confidence: how sure you are (0-100)
- IGNORE spelling mistakes, understand intent despite typos`;

    const rawBody = await new Promise((resolve, reject) => {
      const req = https.request({
        hostname: 'generativelanguage.googleapis.com',
        path: `/v1beta/models/${BRAIN_MODEL}:generateContent?key=${GEMINI_KEY}`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      }, res => {
        let raw = '';
        res.on('data', d => raw += d);
        res.on('end', () => resolve(raw));
      });
      req.on('error', reject);
      req.write(JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0, maxOutputTokens: 300 }
      }));
      req.end();
    });
    // Parse the API response
    const apiResp = JSON.parse(rawBody);
    if (apiResp.error) { console.warn('[classifyIntent] API error:', apiResp.error.message); return null; }
    const text = apiResp?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    console.log('[classifyIntent] raw text:', text.slice(0, 200));
    // Extract JSON from response — handle code fences, plain JSON, etc.
    const cleaned = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
    // Try parsing, with fallback to find first { ... } block
    let result;
    try { result = JSON.parse(cleaned); } catch(_) {
      const jsonStart = cleaned.indexOf('{');
      const jsonEnd = cleaned.lastIndexOf('}');
      if (jsonStart !== -1 && jsonEnd > jsonStart) {
        result = JSON.parse(cleaned.slice(jsonStart, jsonEnd + 1));
      }
    }
    if (!result) { console.warn('[classifyIntent] could not parse JSON'); return null; }
    console.log('[classifyIntent]', JSON.stringify(result));
    return result;
  } catch(e) {
    console.warn('[classifyIntent] failed:', e.message);
    return null;
  }
}

// â”€â”€ Desktop awareness — scan what's actually on the desktop â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function getDesktopSnapshot(maxDepth = 1) {
  const DESKTOP = path.join(os.homedir(), 'Desktop');
  const lines = [];
  const MAX_FILES = 60; // don't flood the prompt
  let count = 0;

  function scan(dir, depth, prefix) {
    if (depth > maxDepth || count >= MAX_FILES) return;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (count >= MAX_FILES) break;
      if (e.name.startsWith('.') || e.name === 'desktop.ini') continue;
      const fullPath = path.join(dir, e.name);
      if (e.isDirectory()) {
        lines.push(`${prefix}ðŸ“ ${e.name}/  [${fullPath}]`);
        if (depth < maxDepth) scan(fullPath, depth + 1, prefix + '  ');
      } else {
        let size = '';
        try { size = ` (${Math.round(fs.statSync(fullPath).size / 1024)}KB)`; } catch {}
        lines.push(`${prefix}ðŸ“„ ${e.name}${size}  [${fullPath}]`);
      }
      count++;
    }
  }

  scan(DESKTOP, 0, '');
  if (lines.length === 0) return 'Desktop is empty.';
  return `Desktop (${DESKTOP}):\n${lines.join('\n')}`;
}

// â”€â”€ Auto-create any file/program on desktop using AI â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function triggerAutoCreateFile(event, command, messageId, overrides = {}) {
  const DESKTOP = path.join(os.homedir(), 'Desktop');

  // Detect file type — overrides take priority (from AI classifier), then regex on command
  const extMap = { python: 'py', py: 'py', javascript: 'js', js: 'js', html: 'html', css: 'css',
    typescript: 'ts', ts: 'ts', json: 'json', markdown: 'md', md: 'md', bash: 'sh', shell: 'sh',
    text: 'txt', txt: 'txt', react: 'tsx', node: 'js', script: 'py', program: 'py', app: 'html' };
  const cmdL = command.toLowerCase();
  // Default: html for apps/games/programs, txt for plain "file" requests
  const _isPlainFile = /\b(create|make|new|add)\b.{0,20}\b(file)\b/i.test(command)
    && !/\b(game|app|application|program|tool|website|calculator|script|html|python|js|py)\b/i.test(command);
  let ext = overrides.fileType || (_isPlainFile ? 'txt' : 'html');
  if (!overrides.fileType) {
    for (const [key, val] of Object.entries(extMap)) {
      if (cmdL.includes(key)) { ext = val; break; }
    }
  }

  // Extract file name — priority: AI override â†’ "called X" / "named X" â†’ smart extraction â†’ fallback
  let baseName = overrides.fileName || null;
  if (!baseName) {
    const nameMatch = command.match(/(?:called?|named?)\s+["']?([a-zA-Z0-9_\- ]{2,40})["']?/i)
      || command.match(/["']([a-zA-Z0-9_\-\.]{2,40})["']/);
    baseName = nameMatch ? nameMatch[1].trim().replace(/\s+/g, '_') : null;
  }
  if (!baseName) {
    // Smart extraction: "make a html pong game" â†’ "pong_game", "can u make a pong game out of html" â†’ "pong_game"
    const smartMatch = command.match(
      /\b(?:make|create|build|write|generate)\b\s+(?:u\s+)?(?:a\s+|an\s+)?(?:(?:html|css|js|python|javascript|typescript|simple|basic|small|fun|cool)\s+)?([a-zA-Z][a-zA-Z0-9 ]{1,40}?)(?=\s+(?:and|put|on|in|for|from|that|using|with|then|after|open|out\s+of|using)\b|\s*$)/i
    );
    if (smartMatch) {
      // Strip non-descriptive filler words from the extracted name
      const FILLER = new Set(['out','of','in','from','using','via','with','made','built','written','created','a','an','the','html','css','js','py','python','javascript','typescript','bash','shell']);
      const words = smartMatch[1].trim().split(/\s+/)
        .filter(w => !FILLER.has(w.toLowerCase()))
        .slice(0, 3);
      if (words.length > 0) baseName = words.join('_').toLowerCase();
    }
  }
  if (!baseName) {
    const purposeMatch = command.match(/(?:that|which|to|for)\s+([a-zA-Z\s]{4,30})/i);
    baseName = purposeMatch ? purposeMatch[1].trim().replace(/\s+/g, '_').slice(0, 20) : 'project';
  }
  // Ensure it has extension
  const fileName = baseName.includes('.') ? baseName : `${baseName}.${ext}`;

  // If the command contains an explicit absolute Windows path, use it directly
  // e.g. "create ... at C:\Users\nikol\Desktop\pong game\pong_game.html"
  const explicitPathMatch = command.match(/[A-Za-z]:\\[^\n"']+\.(?:html?|pdf|txt|png|jpe?g|gif|js|ts|css|py|json|md|csv|xml|svg)/i);
  const filePath = explicitPathMatch ? explicitPathMatch[0].trim() : path.join(DESKTOP, fileName);

  // Ensure the directory exists (handles paths like Desktop\pong game\pong_game.html)
  try { fs.mkdirSync(path.dirname(filePath), { recursive: true }); } catch(_) {}

  const displayName = path.basename(filePath);
  event.sender.send('command-chunk', { messageId, chunk: `⚡ On it — generating \`${displayName}\`...` });

  // Read existing file if it exists — so Gemini improves it rather than generating blind
  let existingContent = '';
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf-8');
      // Cap at 12000 chars to avoid blowing the prompt budget
      existingContent = raw.length > 12000 ? raw.slice(0, 12000) + '\n... [truncated for context]' : raw;
      event.sender.send('command-chunk', { messageId, chunk: `\nðŸ“– Found existing \`${displayName}\` — reading it first...\n` });
    }
  } catch(_) {}

  const existingBlock = existingContent
    ? `\nEXISTING FILE CONTENT (the current version — improve this, don't start from scratch unless told to rewrite):\n\`\`\`\n${existingContent}\n\`\`\`\n`
    : '';

  // Also inject desktop snapshot so Gemini knows full context
  const desktopSnap = getDesktopSnapshot(1);

  // Ask Gemini to generate the file content
  if (!GEMINI_KEY) { event.sender.send('command-chunk', { messageId, chunk: 'âŒ Gemini key missing.' }); event.sender.send('command-end', { messageId, code: 1 }); return; }
  const styleHint = ext === 'html' || ext === 'css' || ext === 'js' || ext === 'ts' || ext === 'tsx' || ext === 'jsx'
    ? styleAnalyzer.getCompactPrompt() : '';
  const prompt = `The user asked: "${command}"

TARGET FILE: ${filePath}
${existingBlock}
WHAT IS ON THE USER'S DESKTOP RIGHT NOW:
${desktopSnap}
${styleHint}
Generate a COMPLETE, FULLY FUNCTIONAL, SELF-CONTAINED ${ext.toUpperCase()} file.
- If it's a game: make it actually fun and playable with good visuals, smooth controls, and a dark theme.
- If it's an app/tool: make it polished with a clean modern UI.
- Use modern CSS (flexbox, grid, gradients, shadows, rounded corners).
- Everything must be in a single file — inline CSS and JS. No external dependencies.
- Output ONLY the raw file content. No markdown fences, no explanation, no preamble — just the code.`;

  let generatedContent = '';
  try {
    const https = require('https');
    const body = JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.4, maxOutputTokens: 32000 } });
    const data = await new Promise((resolve, reject) => {
      const req = https.request({ hostname: 'generativelanguage.googleapis.com', path: `/v1beta/models/${BRAIN_MODEL}:generateContent?key=${GEMINI_KEY}`, method: 'POST', headers: { 'Content-Type': 'application/json' } }, res => {
        let raw = '';
        res.on('data', d => raw += d);
        res.on('end', () => { try { resolve(JSON.parse(raw)); } catch(e) { reject(e); } });
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    });
    generatedContent = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    imiLog('INFO', `[AutoCreate] API response length=${generatedContent.length} | finishReason=${data?.candidates?.[0]?.finishReason} | error=${JSON.stringify(data?.error)}`);
    if (!generatedContent) {
      const errMsg = data?.error?.message || data?.candidates?.[0]?.finishReason || 'empty response';
      imiLog('WARN', `[AutoCreate] Gemini returned empty content: ${errMsg}`);
      event.sender.send('command-chunk', { messageId, chunk: `âŒ AI returned empty content: ${errMsg}` });
      event.sender.send('command-end', { messageId, code: 1 });
      return;
    }
  } catch(e) {
    imiLog('ERROR', `[AutoCreate] generation failed: ${e.message}`);
    event.sender.send('command-chunk', { messageId, chunk: `âŒ AI generation failed: ${e.message}` });
    event.sender.send('command-end', { messageId, code: 1 });
    return;
  }

  // Extract code block content
  const codeMatch = generatedContent.match(/```(?:[a-z]*\n)?([\s\S]+?)```/);
  const finalContent = codeMatch ? codeMatch[1].trim() : generatedContent.trim();

  if (!finalContent) {
    imiLog('WARN', `[AutoCreate] finalContent empty after extraction`);
    event.sender.send('command-chunk', { messageId, chunk: `âŒ Generated content was empty after extraction.` });
    event.sender.send('command-end', { messageId, code: 1 });
    return;
  }
  imiLog('INFO', `[AutoCreate] writing ${finalContent.length} chars to ${filePath}`);

  // Write file
  try {
    fs.writeFileSync(filePath, finalContent, 'utf-8');
    // If the command had an explicit absolute path (plan phase), skip auto-open —
    // the plan's "open" phase will handle it. Otherwise, open automatically.
    const wasExplicitPath = !!explicitPathMatch;
    const willOpen = !wasExplicitPath && (ext === 'html' || /\b(open|launch|run|start|play|show)\b/i.test(command));
    if (willOpen) {
      shell.openExternal(`file:///${filePath.replace(/\\/g, '/')}`);
    } else if (!wasExplicitPath) {
      exec(`code "${filePath}"`, () => {});
    }
    const openNote = willOpen ? `\n🚀 Opening in browser...` : '';
    event.sender.send('command-chunk', { messageId, chunk: `âœ… **Created** \`${displayName}\`!${openNote}` });
  } catch(e) {
    event.sender.send('command-chunk', { messageId, chunk: `âŒ Write failed: ${e.message}` });
  }
  event.sender.send('command-end', { messageId, code: 0 });
}

// â”€â”€ Edit an existing file on desktop using AI â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function triggerFileEdit(event, command, messageId) {
  const DESKTOP = path.join(os.homedir(), 'Desktop');

  // Extract file or folder name from command
  const pathMatch = command.match(/["']([^"']+\.[a-zA-Z]{1,6})["']/i)              // quoted "file.ext"
    || command.match(/\b([a-zA-Z0-9_\-]+\.[a-zA-Z]{2,6})\b/i)                      // bare file.ext
    || command.match(/(?:in|inside|the|file|folder|directory)\s+["']?([a-zA-Z0-9_\-\. ]{2,40})["']?(?:\s|$)/i); // "in X folder"

  let targetPath = null;
  let targetName = null;

  if (pathMatch) {
    targetName = pathMatch[1].trim();
    // Try desktop first, then project root
    const desktopTry = path.join(DESKTOP, targetName);
    const projectTry = path.join(currentProjectRoot, targetName);
    if (fs.existsSync(desktopTry)) targetPath = desktopTry;
    else if (fs.existsSync(projectTry)) targetPath = projectTry;
  }

  if (!targetPath) {
    // List desktop so AI can pick the right file
    let desktopFiles = [];
    try { desktopFiles = fs.readdirSync(DESKTOP).slice(0, 20); } catch(e) {}
    event.sender.send('command-chunk', { messageId, chunk: `ðŸ—‚ **Desktop contents:**\n${desktopFiles.map(f => `  â€¢ ${f}`).join('\n')}\n\nâš ï¸ I couldn't find a specific file to edit. Please tell me the exact filename, e.g. *"edit notes.txt on my desktop"*` });
    event.sender.send('command-end', { messageId, code: 0 });
    return;
  }

  // Check if it's a directory
  const stat = fs.statSync(targetPath);
  if (stat.isDirectory()) {
    const entries = fs.readdirSync(targetPath).slice(0, 30);
    event.sender.send('command-chunk', { messageId, chunk: `ðŸ“ **${targetName}** is a folder. Contents:\n${entries.map(f => `  â€¢ ${f}`).join('\n')}\n\nðŸ’¡ Tell me which specific file inside to edit, e.g. *"edit the index.html inside ${targetName}"*` });
    event.sender.send('command-end', { messageId, code: 0 });
    return;
  }

  // Read the file
  let currentContent = '';
  try {
    currentContent = fs.readFileSync(targetPath, 'utf-8');
  } catch(e) {
    event.sender.send('command-chunk', { messageId, chunk: `âŒ Couldn't read \`${targetPath}\`: ${e.message}` });
    event.sender.send('command-end', { messageId, code: 1 });
    return;
  }

  event.sender.send('command-chunk', { messageId, chunk: `ðŸ“– **Reading** \`${targetName}\` (${currentContent.length} chars)...\nðŸ¤– Applying your changes...\n\n` });

  if (!GEMINI_KEY) { event.sender.send('command-chunk', { messageId, chunk: 'âŒ Gemini key missing.' }); event.sender.send('command-end', { messageId, code: 1 }); return; }

  const ext = path.extname(targetPath).slice(1) || 'txt';
  const prompt = `The user wants to edit this file: "${targetName}"

User instruction: "${command}"

Current file content:
\`\`\`${ext}
${currentContent.slice(0, 8000)}
\`\`\`

Return the COMPLETE updated file content in a code block. Apply ONLY the changes the user requested. Keep everything else exactly the same.`;

  let aiResponse = '';
  try {
    const https = require('https');
    const body = JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.2, maxOutputTokens: 8192 } });
    const data = await new Promise((resolve, reject) => {
      const req = https.request({ hostname: 'generativelanguage.googleapis.com', path: `/v1beta/models/${BRAIN_MODEL}:generateContent?key=${GEMINI_KEY}`, method: 'POST', headers: { 'Content-Type': 'application/json' } }, res => {
        let raw = '';
        res.on('data', d => raw += d);
        res.on('end', () => { try { resolve(JSON.parse(raw)); } catch(e) { reject(e); } });
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    });
    aiResponse = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  } catch(e) {
    event.sender.send('command-chunk', { messageId, chunk: `âŒ AI edit failed: ${e.message}` });
    event.sender.send('command-end', { messageId, code: 1 });
    return;
  }

  // Extract the updated content
  const codeMatch = aiResponse.match(/```(?:[a-z]*\n)?([\s\S]+?)```/);
  const updatedContent = codeMatch ? codeMatch[1].trim() : aiResponse.trim();

  // Write back
  try {
    // Backup original
    fs.writeFileSync(targetPath + '.bak', currentContent, 'utf-8');
    fs.writeFileSync(targetPath, updatedContent, 'utf-8');
    event.sender.send('command-chunk', { messageId, chunk: `âœ… **Updated** \`${targetName}\` on Desktop!\nðŸ’¾ Original backed up as \`${targetName}.bak\`\n\n` });
    event.sender.send('command-chunk', { messageId, chunk: `**Updated content preview:**\n\`\`\`${ext}\n${updatedContent.slice(0, 500)}${updatedContent.length > 500 ? '\n...' : ''}\n\`\`\`` });
    exec(`code "${targetPath}"`, () => {});
  } catch(e) {
    event.sender.send('command-chunk', { messageId, chunk: `âŒ Write failed: ${e.message}` });
  }
  event.sender.send('command-end', { messageId, code: 0 });
}

async function triggerDesktopTask(event, command, cmdL, messageId) {
  // Extract folder name — stop at natural transition words so "called pong game inside the folder" â†’ "pong game"
  const folderMatch = command.match(/(?:call(?:ed)?|nam(?:e(?:d)?)?(?:\s+it)?)\s+["']([^"']+)["']/i)   // quoted: called "My Folder"
    || command.match(/(?:call(?:ed)?|nam(?:e(?:d)?)?(?:\s+it)?)\s+((?:(?!\b(?:inside|in\s+the|make|create|put|add|open|launch|from|that|with|then|and\s)\b)\w+[\s-]?){1,5})/i);
  const folderName = (folderMatch?.[1] || '').trim().replace(/\s+/g, ' ').replace(/\s*(inside|in the|make|create|and|then|open|from).*$/i, '') || 'New Folder';
  const desktopPath = path.join(os.homedir(), 'Desktop', folderName);

  // Step 1: create folder
  try {
    fs.mkdirSync(desktopPath, { recursive: true });
    event.sender.send('command-chunk', { messageId, chunk: `âœ… Created folder "${folderName}" on Desktop.\n` });
  } catch(e) {
    event.sender.send('command-chunk', { messageId, chunk: `âŒ Folder error: ${e.message}\n` });
    event.sender.send('command-end', { messageId, code: 1 });
    return;
  }

  // Step 2: detect if user wants a file generated inside the folder.
  // IMPORTANT: strip the folder name before checking — "create a folder called 'pong game'"
  // should NOT generate a file just because "game" appears in the folder name.
  const cmdLWithoutFolderName = folderName !== 'New Folder'
    ? cmdL.replace(folderName.toLowerCase(), '')
    : cmdL;
  const wantsFile = /\b(html|css|js|javascript|python|game|script|file|code|app|program|website|calculator|tool)\b/i.test(cmdLWithoutFolderName)
    && /\b(make|create|build|put|add|generate|write|with|include|and\s+(?:a|an|the))\b/i.test(cmdLWithoutFolderName);

  if (!wantsFile) {
    event.sender.send('command-end', { messageId, code: 0 });
    return;
  }

  // Resolve file extension
  const validExts = ['html', 'css', 'js', 'ts', 'jsx', 'tsx', 'py', 'json', 'txt', 'md', 'php', 'java', 'cpp', 'c', 'cs'];
  const typeMatch = cmdL.match(/\b(html|css|javascript|js|typescript|ts|python|py|json|txt|php|jsx|tsx)\b/);
  const fileExt = typeMatch ? typeMatch[1].replace('javascript','js').replace('typescript','ts').replace('python','py') : 'html';
  const fileDesc = command;
  const fileName = `${folderName.replace(/\s+/g, '_')}.${fileExt}`;
  const filePath = path.join(desktopPath, fileName);

  if (!GEMINI_KEY) {
    event.sender.send('command-chunk', { messageId, chunk: 'âŒ Gemini key missing — cannot generate file content.\n' });
    event.sender.send('command-end', { messageId, code: 1 });
    return;
  }

  event.sender.send('command-chunk', { messageId, chunk: `ðŸ§  Generating ${fileName}...\n` });

  // Read existing file if it already exists
  let existingFileContent = '';
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf-8');
      existingFileContent = raw.length > 12000 ? raw.slice(0, 12000) + '\n... [truncated]' : raw;
    }
  } catch(_) {}
  const existingFileBlock = existingFileContent
    ? `\nEXISTING FILE (improve this):\n\`\`\`\n${existingFileContent}\n\`\`\`\n`
    : '';

  const codePrompt = `The user asked: "${fileDesc}"

TARGET FILE: ${filePath}
${existingFileBlock}
DESKTOP CONTENTS:
${getDesktopSnapshot(1)}

Generate a COMPLETE, FULLY FUNCTIONAL, SELF-CONTAINED ${fileExt.toUpperCase()} file.
- If it's a game: make it actually fun and playable with good visuals, smooth controls, and a dark theme.
- If it's an app/tool: make it polished with a clean modern UI.
- Use modern CSS (flexbox, grid, gradients, shadows, rounded corners).
- Everything in one file — inline CSS and JS. No external dependencies.
- Output ONLY the raw code. No markdown fences, no explanation, no preamble.`;

  const req = net.request({ method: 'POST', protocol: 'https:', hostname: 'generativelanguage.googleapis.com',
    path: `/v1beta/models/${BRAIN_MODEL}:generateContent?key=${GEMINI_KEY}` });
  req.setHeader('Content-Type', 'application/json');
  req.write(JSON.stringify({ contents: [{ parts: [{ text: codePrompt }] }],
    generationConfig: { temperature: 0.2, maxOutputTokens: 32000 } }));
  let raw = '';
  req.on('response', res => {
    res.on('data', d => raw += d.toString());
    res.on('end', () => {
      try {
        let code = JSON.parse(raw)?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        code = code.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '').trim();
        fs.writeFileSync(filePath, code, 'utf-8');
        const willOpenFolder = fileExt === 'html' || /\b(open|launch|run|start|play|show)\b/i.test(cmdL);
        if (willOpenFolder) {
          shell.openExternal(`file:///${filePath.replace(/\\/g, '/')}`);
        }
        const openNoteFolder = willOpenFolder ? `\n🚀 Opening in browser...` : '';
        event.sender.send('command-chunk', { messageId, chunk: `âœ… **Created** \`${fileName}\` inside "${folderName}".${openNoteFolder}` });
      } catch(e) {
        event.sender.send('command-chunk', { messageId, chunk: `âŒ File generation error: ${e.message}\n` });
      }
      event.sender.send('command-end', { messageId, code: 0 });
    });
  });
  req.on('error', e => { event.sender.send('command-error', { messageId, error: e.message }); });
  req.end();
}

async function triggerDesktopVision(event, userCommand, messageId) {
  if (!GEMINI_KEY) { event.sender.send('command-error', { messageId, error: 'Gemini key missing.' }); return; }
  event.sender.send('command-chunk', { messageId, chunk: 'ðŸ“¸ Capturing your screen...\n' });
  try {
    const { desktopCapturer } = require('electron');
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1920, height: 1080 } });
    if (!sources.length) { event.sender.send('command-error', { messageId, error: 'No screen source found.' }); return; }
    const dataUrl = sources[0].thumbnail.toDataURL();
    const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
    event.sender.send('command-chunk', { messageId, chunk: 'ðŸ§  Sending to Gemini Vision...\n' });
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
        event.sender.send('command-chunk', { messageId, chunk: `\nâš ï¸ ${clean}\n` });
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
  // Fetch GitHub identity now that net module is available
  fetchGitHubIdentity();
  // Only start auto-sync timer if GitHub token is already saved — user must opt in
  if (GITHUB_TOKEN && GITHUB_TOKEN.trim()) {
    syncTimer = setInterval(triggerGitSync, SYNC_INTERVAL_MS);
  }
});
// Listen for the 'open-directory' event
ipcMain.on('open-directory', (event, path) => {
  shell.openPath(path).catch(err => {
    console.error("Failed to open path:", err);
  });
});

app.on('window-all-closed', () => { app.quit(); });
app.on('before-quit', () => { process.exit(0); });
ipcMain.on('window-minimize', () => { const win = BrowserWindow.getFocusedWindow(); if (win) win.minimize(); });
ipcMain.on('window-maximize', () => { const win = BrowserWindow.getFocusedWindow(); if (win) { if (win.isMaximized()) win.unmaximize(); else win.maximize(); } });
ipcMain.on('window-close', () => { app.quit(); });
ipcMain.handle('mcp:global-list', () => ({ success: true, data: mcpServersList.map(s => `â— ${s.name}`).join('\n') }));
ipcMain.handle('mcp:global-add', (e, c) => { mcpServersList.push(c); saveGlobalState(); return { success: true }; });
ipcMain.handle('mcp:global-remove', (e, n) => { mcpServersList = mcpServersList.filter(s => s.name !== n); saveGlobalState(); return { success: true }; });

// Live npm registry search for MCP packages
// Fetch a single npm package by name or npmjs.com URL
ipcMain.handle('npm-fetch-package', async (_e, input) => {
  try {
    // Accept full URL or just package name
    let pkgName = input.trim();
    const urlMatch = pkgName.match(/npmjs\.com\/package\/(@?[^/?#]+(?:\/[^/?#]+)?)/);
    if (urlMatch) pkgName = decodeURIComponent(urlMatch[1]);
    return new Promise((resolve) => {
      const req = net.request({ method: 'GET', protocol: 'https:', hostname: 'registry.npmjs.org', path: `/${encodeURIComponent(pkgName).replace('%40','@').replace('%2F','/')}` });
      req.setHeader('Accept', 'application/json');
      req.setHeader('User-Agent', 'IMI-MCP-Hub/1.0');
      let raw = '';
      req.on('response', res => {
        res.on('data', d => raw += d.toString());
        res.on('end', () => {
          try {
            const p = JSON.parse(raw);
            if (p.error || !p.name) return resolve({ error: p.error || 'Package not found' });
            const latest = p['dist-tags']?.latest || Object.keys(p.versions || {}).pop() || '';
            const vData = p.versions?.[latest] || {};
            resolve({ type: 'npm', data: {
              name: p.name, description: p.description || '',
              version: latest, license: p.license || vData.license || '',
              author: typeof p.author === 'string' ? p.author : p.author?.name || '',
              keywords: p.keywords || [],
              npmUrl: `https://www.npmjs.com/package/${p.name}`,
              repoUrl: vData.repository?.url?.replace(/^git\+/, '').replace(/\.git$/, '') || p.repository?.url?.replace(/^git\+/, '').replace(/\.git$/, '') || '',
              homepage: p.homepage || '',
              weeklyDownloads: null,
              updatedAt: p.time?.[latest] || p.time?.modified || '',
              readme: (p.readme || '').substring(0, 500),
            }});
          } catch(e) { resolve({ error: e.message }); }
        });
      });
      req.on('error', e => resolve({ error: e.message }));
      req.end();
    });
  } catch(e) { return { error: e.message }; }
});

// Fetch a single HuggingFace model by URL or model ID
ipcMain.handle('hf-fetch-model', async (_e, input) => {
  try {
    let modelId = input.trim();
    const urlMatch = modelId.match(/huggingface\.co\/([^/?#]+\/[^/?#]+)/);
    if (urlMatch) modelId = urlMatch[1];
    return new Promise((resolve) => {
      const req = net.request({ method: 'GET', protocol: 'https:', hostname: 'huggingface.co', path: `/api/models/${modelId}?blobs=true` });
      req.setHeader('Accept', 'application/json');
      req.setHeader('User-Agent', 'IMI-DevHub/1.0');
      let raw = '';
      req.on('response', res => {
        res.on('data', d => raw += d.toString());
        res.on('end', () => {
          try {
            const m = JSON.parse(raw);
            if (m.error || !m.modelId) return resolve({ error: m.error || 'Model not found' });
            const fmtBytes = (b) => b >= 1e9 ? `${(b/1e9).toFixed(1)} GB` : b >= 1e6 ? `${(b/1e6).toFixed(0)} MB` : `${b} B`;
            const siblings = m.siblings || [];
            const getSize = (s) => s.lfs?.size || s.size || 0;
            const ggufFiles = siblings.filter(s => s.rfilename?.toLowerCase().endsWith('.gguf') && getSize(s) > 0);
            let sizeLabel = '';
            if (ggufFiles.length === 1) sizeLabel = fmtBytes(getSize(ggufFiles[0]));
            else if (ggufFiles.length > 1) {
              const smallest = Math.min(...ggufFiles.map(f => getSize(f)));
              const largest = Math.max(...ggufFiles.map(f => getSize(f)));
              sizeLabel = smallest === largest ? fmtBytes(smallest) : `${fmtBytes(smallest)} â€“ ${fmtBytes(largest)}`;
            }
            const ggufList = ggufFiles.map(f => {
              // Extract quant tag from filename e.g. "Qwen3-4B-Q4_K_M.gguf" â†’ "Q4_K_M"
              const quantMatch = f.rfilename.match(/[-_](Q\d[^-.]*(?:_[A-Z]+)*)\./i) || f.rfilename.match(/(Q\d[^-.]*)\./i);
              const quant = quantMatch ? quantMatch[1].toUpperCase() : f.rfilename.replace('.gguf','');
              return { filename: f.rfilename, quant, size: fmtBytes(getSize(f)), sizeBytes: getSize(f) };
            }).sort((a,b) => a.sizeBytes - b.sizeBytes);
            resolve({ type: 'hf', data: {
              id: m.modelId, name: m.modelId,
              author: (m.modelId || '').split('/')[0],
              downloads: m.downloads || 0, likes: m.likes || 0,
              pipeline: m.pipeline_tag || 'text-generation',
              tags: m.tags || [], sizeLabel, ggufCount: ggufFiles.length,
              ggufList,
              hfUrl: `https://huggingface.co/${m.modelId}`,
              ollamaCmd: `hf.co/${m.modelId}`,
              updatedAt: m.lastModified || '',
            }});
          } catch(e) { resolve({ error: e.message }); }
        });
      });
      req.on('error', e => resolve({ error: e.message }));
      req.end();
    });
  } catch(e) { return { error: e.message }; }
});

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
    const doSearch = (useToken) => {
      const req = net.request({
        method: 'GET', protocol: 'https:', hostname: 'api.github.com',
        path: `/search/repositories?q=${q}&sort=${sortBy}&order=desc&per_page=24`
      });
      req.setHeader('Accept', 'application/vnd.github.v3+json');
      req.setHeader('User-Agent', 'IMI-GitHub-Hub/1.0');
      if (useToken && GITHUB_TOKEN) req.setHeader('Authorization', `token ${GITHUB_TOKEN}`);
      let raw = '';
      req.on('response', res => {
        res.on('data', d => raw += d.toString());
        res.on('end', () => {
          try {
            const data = JSON.parse(raw);
            // Bad/expired token — silently retry without auth
            if (useToken && (data.message === 'Bad credentials' || res.statusCode === 401)) {
              return doSearch(false);
            }
            if (data.message) { resolve({ results: [], total: 0, error: data.message }); return; }
            const results = (data.items || []).map(r => ({
              id: r.id, name: r.full_name, shortName: r.name,
              owner: r.owner?.login, ownerAvatar: r.owner?.avatar_url,
              description: r.description || 'No description.',
              stars: r.stargazers_count, forks: r.forks_count,
              language: r.language, topics: r.topics || [],
              htmlUrl: r.html_url, cloneUrl: r.clone_url,
              updatedAt: r.updated_at, license: r.license?.spdx_id || null,
              openIssues: r.open_issues_count,
            }));
            resolve({ results, total: data.total_count || results.length });
          } catch(e) { resolve({ results: [], total: 0, error: e.message }); }
        });
      });
      req.on('error', e => resolve({ results: [], total: 0, error: e.message }));
      req.end();
    };
    doSearch(!!GITHUB_TOKEN);
  });
});

// Clone a GitHub repo to local project folder
// GitHub URL lookup — fetch a PR, issue, or repo directly from a URL
ipcMain.handle('github-fetch-url', async (_e, url) => {
  try {
    // Parse URL: github.com/{owner}/{repo}/pull/{n} | /issues/{n} | just /{owner}/{repo}
    const match = url.match(/github\.com\/([^/]+)\/([^/]+?)(?:\/(pull|pulls|issues?)\/(\d+))?(?:[/?#].*)?$/i);
    if (!match) return { error: 'Not a valid GitHub URL' };
    const [, owner, repo, typeRaw, number] = match;
    const token = (GITHUB_TOKEN || '').trim();
    // ghGet tries with token first, falls back to unauthenticated for public repos
    const ghGet = (apiPath) => new Promise((resolve, reject) => {
      const makeReq = (useAuth) => {
        const req = net.request({ method: 'GET', protocol: 'https:', hostname: 'api.github.com', path: apiPath });
        req.setHeader('Accept', 'application/vnd.github.v3+json');
        req.setHeader('User-Agent', 'IMI-GitHub-Hub/1.0');
        if (useAuth && token) req.setHeader('Authorization', `Bearer ${token}`);
        let raw = '';
        req.on('response', res => {
          res.on('data', d => raw += d.toString());
          res.on('end', () => {
            try {
              const data = JSON.parse(raw);
              // If bad credentials and we used auth, retry without
              if (useAuth && (data.message === 'Bad credentials' || res.statusCode === 401)) {
                return makeReq(false);
              }
              resolve(data);
            } catch(e) { reject(e); }
          });
        });
        req.on('error', reject);
        req.end();
      };
      makeReq(!!token);
    });
    const type = typeRaw ? (typeRaw.startsWith('pull') ? 'pr' : 'issue') : 'repo';
    if (type === 'pr') {
      const pr = await ghGet(`/repos/${owner}/${repo}/pulls/${number}`);
      if (pr.message) return { error: pr.message };
      return { type: 'pr', data: {
        number: pr.number, title: pr.title, body: pr.body || '',
        state: pr.state, draft: pr.draft, merged: pr.merged,
        author: pr.user?.login, authorAvatar: pr.user?.avatar_url,
        createdAt: pr.created_at, updatedAt: pr.updated_at, mergedAt: pr.merged_at,
        additions: pr.additions, deletions: pr.deletions, changedFiles: pr.changed_files,
        commits: pr.commits, comments: pr.comments + pr.review_comments,
        htmlUrl: pr.html_url, repoName: `${owner}/${repo}`,
        baseBranch: pr.base?.ref, headBranch: pr.head?.ref,
        labels: (pr.labels || []).map(l => ({ name: l.name, color: l.color })),
      }};
    } else if (type === 'issue') {
      const issue = await ghGet(`/repos/${owner}/${repo}/issues/${number}`);
      if (issue.message) return { error: issue.message };
      return { type: 'issue', data: {
        number: issue.number, title: issue.title, body: issue.body || '',
        state: issue.state, author: issue.user?.login, authorAvatar: issue.user?.avatar_url,
        createdAt: issue.created_at, updatedAt: issue.updated_at,
        comments: issue.comments, htmlUrl: issue.html_url, repoName: `${owner}/${repo}`,
        labels: (issue.labels || []).map(l => ({ name: l.name, color: l.color })),
      }};
    } else {
      const r = await ghGet(`/repos/${owner}/${repo}`);
      if (r.message) return { error: r.message };
      return { type: 'repo', data: {
        name: r.full_name, description: r.description || '', stars: r.stargazers_count,
        forks: r.forks_count, language: r.language, license: r.license?.spdx_id,
        topics: r.topics || [], htmlUrl: r.html_url, cloneUrl: r.clone_url,
        ownerAvatar: r.owner?.avatar_url, updatedAt: r.updated_at, defaultBranch: r.default_branch,
        openIssues: r.open_issues_count, watchers: r.watchers_count,
      }};
    }
  } catch(e) { return { error: e.message }; }
});

ipcMain.handle('github-clone', async (_e, cloneUrl, folderName) => {
  try {
    const dest = path.join(currentProjectRoot, folderName || path.basename(cloneUrl, '.git'));
    if (fs.existsSync(dest)) return { success: false, error: `Folder "${folderName}" already exists.` };
    execSync(`git clone ${cloneUrl} "${dest}"`, { cwd: currentProjectRoot, timeout: 60000 });
    return { success: true, path: dest };
  } catch(e) { return { success: false, error: e.message }; }
});

// â”€â”€ Installed Tools checker â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const TOOLS_MANIFEST = [
  { id: 'node',      label: 'Node.js',       cmd: 'node --version',        installUrl: 'https://nodejs.org', category: 'runtime',  icon: '🟢', desc: 'JavaScript runtime — required for IMI' },
  { id: 'npm',       label: 'npm',           cmd: 'npm --version',         installUrl: 'https://nodejs.org', category: 'runtime',  icon: '📦', desc: 'Node package manager' },
  { id: 'npx',       label: 'npx',           cmd: 'npx --version',         installUrl: 'https://nodejs.org', category: 'runtime',  icon: '⚡', desc: 'Run npm packages without installing' },
  { id: 'git',       label: 'Git',           cmd: 'git --version',         installUrl: 'https://git-scm.com', category: 'dev',     icon: '🌿', desc: 'Version control — required for sync' },
  { id: 'python',    label: 'Python',        cmd: 'python --version',      installUrl: 'https://python.org', category: 'runtime',  icon: '🐍', desc: 'Python runtime' },
  { id: 'gemini',    label: 'Gemini CLI',    cmd: 'gemini --version',      installUrl: 'https://github.com/google-gemini/gemini-cli', category: 'ai', icon: '✨', desc: 'Google Gemini CLI — powers the Brain' },
  { id: 'ollama',    label: 'Ollama',        cmd: 'ollama --version',      installUrl: 'https://ollama.com', category: 'ai',       icon: '🦙', desc: 'Run AI models locally — zero API cost' },
  { id: 'code',      label: 'VS Code',       cmd: 'code --version',        installUrl: 'https://code.visualstudio.com', category: 'editor', icon: '💙', desc: 'Visual Studio Code editor' },
  { id: 'gh',        label: 'GitHub CLI',    cmd: 'gh --version',          installUrl: 'https://cli.github.com', category: 'dev',   icon: '🙏', desc: 'GitHub CLI — manage repos from terminal' },
];

ipcMain.handle('check-tools', async () => {
  const npmGlobal = path.join(os.homedir(), 'AppData', 'Roaming', 'npm');
  const enrichedEnv = { ...process.env, PATH: [process.env.PATH, npmGlobal].filter(Boolean).join(';') };
  const execAsync = (cmd) => new Promise(resolve => {
    exec(cmd, { timeout: 4000, env: enrichedEnv }, (err, stdout) => {
      if (err) { resolve(null); return; }
      const line = stdout.trim().split('\n')[0];
      // Extract first semver-like number from output (handles "git version 2.53.0", "ollama version is 0.18.2", etc.)
      const match = line.match(/(\d+\.\d+[\.\d]*)/);
      resolve(match ? match[1] : line.replace(/^v/, '').trim());
    });
  });
  const results = await Promise.all(TOOLS_MANIFEST.map(async tool => {
    const version = await execAsync(tool.cmd);
    return { ...tool, installed: !!version, version: version || null };
  }));
  return results;
});

ipcMain.handle('open-install-url', (_e, url) => { shell.openExternal(url); });
ipcMain.handle('open-external', (_e, url) => { shell.openExternal(url); });
ipcMain.handle('get-log', (_e, lines = 200) => {
  try {
    const content = fs.readFileSync(IMI_LOG_PATH, 'utf-8');
    return content.split('\n').filter(Boolean).slice(-lines).join('\n');
  } catch { return '(No log file yet — restart IMI to start logging)'; }
});
ipcMain.handle('open-log-file', () => { shell.openPath(IMI_LOG_PATH); });

ipcMain.handle('ollama-update', async (event) => {
  // Try winget first
  const wingetResult = await new Promise(resolve => {
    exec(`winget upgrade --id Ollama.Ollama --silent --accept-package-agreements --accept-source-agreements`, { timeout: 180000, windowsHide: true }, (err, stdout, stderr) => {
      const out = (stdout || '') + (stderr || '');
      if (out.match(/no applicable update|already installed|up.to.date|nothing to upgrade/i)) { resolve({ success: true, upToDate: true }); return; }
      if (!err) { resolve({ success: true, upToDate: false }); return; }
      resolve({ success: false });
    });
  });
  if (wingetResult.success) return wingetResult;

  // Fallback: download latest OllamaSetup.exe and run silently
  try {
    const installerPath = path.join(require('os').tmpdir(), `imi-ollama-update-${Date.now()}.exe`);
    // Send real progress so UI can show download %
    safeSend(event, 'install-dep-progress', { dep: 'ollama-update', status: 'downloading', percent: 0 });
    await downloadFile(event, 'ollama-update', 'https://ollama.com/download/OllamaSetup.exe', installerPath);
    // Push to 95% — installing phase
    safeSend(event, 'install-dep-progress', { dep: 'ollama-update', status: 'installing', percent: 95 });
    // Kill Ollama BEFORE running installer so it doesn't lock files
    await new Promise(res => exec(`taskkill /F /IM "Ollama.exe" /T`, { windowsHide: true }, () => res()));
    await new Promise(res => setTimeout(res, 800)); // brief pause after kill
    await new Promise((resolve, reject) => {
      // /TASKS=!runapp prevents NSIS from launching Ollama after install
      exec(`start /wait /b "" "${installerPath}" /VERYSILENT /NORESTART /SP- /SUPPRESSMSGBOXES /TASKS=!runapp`, { timeout: 180000, windowsHide: true }, (err) => err ? reject(err) : resolve());
    });
    try { require('fs').unlinkSync(installerPath); } catch {}
    // Kill again in case the installer still launched it
    exec(`taskkill /F /IM "Ollama.exe" /T`, { windowsHide: true }, () => {});
    safeSend(event, 'install-dep-progress', { dep: 'ollama-update', status: 'done', percent: 100 });
    // Get new version to confirm
    const newVersion = await new Promise(resolve => {
      exec('ollama --version', { timeout: 4000 }, (err, stdout) => {
        const m = (stdout||'').match(/(\d+\.\d+[\.\d]*)/);
        resolve(m ? m[1] : null);
      });
    });
    return { success: true, upToDate: false, newVersion };
  } catch(e) {
    safeSend(event, 'install-dep-progress', { dep: 'ollama-update', status: 'error', percent: 0 });
    return { success: false, message: e.message };
  }
});

// â”€â”€ Ollama AI Models â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// â”€â”€ Universal Install Manifest â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Each entry: cmd=version check, winExe=silent installer URL, winArgs=silent flags, npm=npm package name
const INSTALL_MANIFEST = {
  ollama:     { name: 'Ollama',       cmd: 'ollama --version',   winget: 'Ollama.Ollama',           winExe: 'https://ollama.com/download/OllamaSetup.exe',                                  winArgs: '/VERYSILENT /NORESTART /SP-' },
  git:        { name: 'Git',          cmd: 'git --version',      winget: 'Git.Git',                 winExe: 'https://github.com/git-for-windows/git/releases/download/v2.47.0.windows.1/Git-2.47.0-64-bit.exe', winArgs: '/VERYSILENT /NORESTART' },
  vscode:     { name: 'VS Code',      cmd: 'code --version',     winget: 'Microsoft.VisualStudioCode', winExe: 'https://code.visualstudio.com/sha/download?build=stable&os=win32-x64-user', winArgs: '/VERYSILENT /NORESTART /MERGETASKS=!runcode' },
  gh:         { name: 'GitHub CLI',   cmd: 'gh --version',       winget: 'GitHub.cli',              winExe: 'https://github.com/cli/cli/releases/download/v2.63.2/gh_2.63.2_windows_amd64.msi', winArgs: '/quiet /norestart' },
  gemini:     { name: 'Gemini CLI',   cmd: 'gemini --version',   npm: '@google/gemini-cli' },
  typescript: { name: 'TypeScript',   cmd: 'tsc --version',      npm: 'typescript' },
  prettier:   { name: 'Prettier',     cmd: 'prettier --version', npm: 'prettier' },
  eslint:     { name: 'ESLint',       cmd: 'eslint --version',   npm: 'eslint' },
  nodemon:    { name: 'Nodemon',      cmd: 'nodemon --version',  npm: 'nodemon' },
  pm2:        { name: 'PM2',          cmd: 'pm2 --version',      npm: 'pm2' },
  serve:      { name: 'Serve',        cmd: 'serve --version',    npm: 'serve' },
  vercel:     { name: 'Vercel CLI',   cmd: 'vercel --version',   npm: 'vercel' },
};

// Aliases so "install node.js" maps to "node", "install vs code" â†’ "vscode" etc.
const INSTALL_ALIASES = {
  'node.js': 'node', 'nodejs': 'node', 'node js': 'node',
  'vs code': 'vscode', 'vscode': 'vscode', 'visual studio code': 'vscode',
  'github cli': 'gh', 'github-cli': 'gh',
  'gemini cli': 'gemini', 'gemini-cli': 'gemini',
};

// Resolve install key from any user string
const resolveInstallKey = (name) => {
  const n = name.toLowerCase().trim();
  if (INSTALL_MANIFEST[n]) return n;
  if (INSTALL_ALIASES[n]) return INSTALL_ALIASES[n];
  // Partial match
  for (const key of Object.keys(INSTALL_MANIFEST)) {
    if (n.includes(key) || key.includes(n)) return key;
  }
  return null;
};

// Safe send — never crashes if webContents was destroyed
const safeSend = (event, channel, data) => {
  try { if (event?.sender && !event.sender.isDestroyed()) event.sender.send(channel, data); } catch {}
};

// Download file with progress streaming
const downloadFile = (event, dep, url, destPath) => new Promise((resolve, reject) => {
  const parsed = new URL(url);
  const file = require('fs').createWriteStream(destPath);
  const doReq = (reqUrl) => {
    const p = new URL(reqUrl);
    const req = net.request({ method: 'GET', protocol: p.protocol, hostname: p.hostname, path: p.pathname + p.search });
    req.setHeader('User-Agent', 'IMI-Installer/1.0');
    req.on('response', (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        doReq(res.headers.location); return;
      }
      const total = parseInt(res.headers['content-length'] || '0');
      let received = 0;
      res.on('data', chunk => {
        file.write(chunk); received += chunk.length;
        if (total > 0) safeSend(event, 'install-dep-progress', { dep, status: 'downloading', percent: Math.round((received/total)*88), received: Math.round(received/1e6), total: Math.round(total/1e6) });
      });
      res.on('end', () => { file.end(); resolve(); });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  };
  doReq(url);
});

// Universal install handler
ipcMain.handle('install-dep', async (event, dep) => {
  const key = resolveInstallKey(dep) || dep;
  const info = INSTALL_MANIFEST[key];
  if (!info) return { success: false, error: `Unknown dependency: ${dep}` };

  safeSend(event, 'install-dep-progress', { dep: key, name: info.name, status: 'starting', percent: 0 });

  try {
    // npm packages — just run npm install -g
    if (info.npm && !info.winExe) {
      safeSend(event, 'install-dep-progress', { dep: key, name: info.name, status: 'installing', percent: 20 });
      await new Promise((resolve, reject) => {
        exec(`npm install -g ${info.npm}`, { timeout: 120000 }, (err, stdout, stderr) => {
          if (err) reject(new Error(stderr || err.message)); else resolve();
        });
      });
      safeSend(event, 'install-dep-progress', { dep: key, name: info.name, status: 'done', percent: 100 });
      return { success: true };
    }

    // Try winget first — fully silent, no popup, no UAC on supported packages
    if (info.winget) {
      try {
        safeSend(event, 'install-dep-progress', { dep: key, name: info.name, status: 'installing', percent: 10 });
        await new Promise((resolve, reject) => {
          exec(`winget install --id ${info.winget} --silent --accept-package-agreements --accept-source-agreements`, { timeout: 180000 }, (err) => err ? reject(err) : resolve());
        });
        safeSend(event, 'install-dep-progress', { dep: key, name: info.name, status: 'done', percent: 100 });
        return { success: true };
      } catch { /* fall through to EXE installer */ }
    }

    // EXE/MSI installer — download then run fully hidden (no window)
    if (info.winExe) {
      const isMsi = info.winExe.includes('.msi');
      const ext = isMsi ? '.msi' : '.exe';
      const installerPath = path.join(require('os').tmpdir(), `imi-install-${key}${ext}`);
      await downloadFile(event, key, info.winExe, installerPath);
      safeSend(event, 'install-dep-progress', { dep: key, name: info.name, status: 'installing', percent: 92 });
      // Use start /wait with windowstyle hidden to suppress any popup
      const silentArgs = info.winArgs || (isMsi ? '/quiet /norestart' : '/VERYSILENT /NORESTART /SP-');
      const cmd = isMsi
        ? `msiexec /i "${installerPath}" ${silentArgs}`
        : `start /wait /b "" "${installerPath}" ${silentArgs}`;
      await new Promise((resolve, reject) => exec(cmd, { timeout: 180000, windowsHide: true }, (err) => err ? reject(err) : resolve()));
      require('fs').unlink(installerPath, () => {});
      safeSend(event, 'install-dep-progress', { dep: key, name: info.name, status: 'done', percent: 100 });
      return { success: true };
    }

    return { success: false, error: 'No installer method available' };
  } catch(e) {
    safeSend(event, 'install-dep-progress', { dep: key, name: info.name, status: 'error', percent: 0, error: e.message });
    return { success: false, error: e.message };
  }
});
ipcMain.handle('check-dep', async (_e, dep) => {
  const key = resolveInstallKey(dep) || dep;
  const info = INSTALL_MANIFEST[key];
  if (!info) return { installed: false };
  try {
    const out = execSync(info.cmd, { timeout: 4000 }).toString().trim();
    const ver = out.match(/(\d+\.\d+[\.\d]*)/)?.[1] || out.replace(/^v/,'').trim();
    return { installed: true, version: ver, installUrl: info.url, name: info.name };
  } catch {
    return { installed: false, installUrl: info.url, name: info.name };
  }
});

ipcMain.handle('ollama-list', async () => {
  try {
    await ensureOllamaRunning();
    const raw = await new Promise((resolve, reject) => exec('ollama list', { timeout: 5000 }, (err, stdout) => err ? reject(err) : resolve(stdout.trim())));
    const lines = String(raw).split('\n').slice(1).filter(Boolean);
    return { success: true, models: lines.map(l => {
      const parts = l.trim().split(/\s+/);
      // ollama list columns: NAME  ID  SIZE_NUM  SIZE_UNIT  MODIFIED...
      // e.g. "hf.co/Qwen/...:tag  abc123  2.9  GB  5 minutes ago"
      const sizeUnits = ['gb','mb','kb','b'];
      let size = '', modStart = 2;
      if (parts[2] && parts[3] && sizeUnits.includes(parts[3].toLowerCase())) {
        size = `${parts[2]} ${parts[3]}`;
        modStart = 4;
      } else if (parts[2]) {
        size = parts[2];
        modStart = 3;
      }
      return { name: parts[0], id: parts[1] || '', size, modified: parts.slice(modStart).join(' ') || '' };
    })};
  } catch(e) { return { success: false, models: [], error: e.message }; }
});

// â”€â”€ Hardware check — VRAM + free RAM â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
ipcMain.handle('get-hardware-info', async () => {
  let vramMB = 0, gpuName = 'Unknown GPU';
  try {
    const out = require('child_process').execSync('nvidia-smi --query-gpu=memory.total,name --format=csv,noheader', { timeout: 5000 }).toString().trim();
    const m = out.match(/^(\d+)\s*MiB,\s*(.+)$/);
    if (m) { vramMB = parseInt(m[1]); gpuName = m[2].trim(); }
  } catch {}
  const freeRamMB = Math.floor(require('os').freemem() / 1024 / 1024);
  const totalRamMB = Math.floor(require('os').totalmem() / 1024 / 1024);
  return { vramMB, gpuName, freeRamMB, totalRamMB };
});

// â”€â”€ Ollama auto-start â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
let ollamaServeProcess = null;

const pingOllama = () => new Promise(resolve => {
  const req = net.request({ method: 'GET', protocol: 'http:', hostname: 'localhost', port: 11434, path: '/' });
  req.on('response', () => resolve(true));
  req.on('error', () => resolve(false));
  setTimeout(() => resolve(false), 2000);
  req.end();
});

const ensureOllamaRunning = async () => {
  if (await pingOllama()) return true; // already up
  // Not running — try to start it
  try {
    execSync('where ollama', { timeout: 2000 });
  } catch { return false; } // Ollama not installed
  ollamaServeProcess = spawn('ollama', ['serve'], { shell: true, detached: false, stdio: 'ignore' });
  ollamaServeProcess.unref();
  // Wait up to 6 seconds for it to come up
  for (let i = 0; i < 12; i++) {
    await new Promise(r => setTimeout(r, 500));
    if (await pingOllama()) return true;
  }
  return false;
};

// Warm up the Ollama model by sending a silent 1-token request — eliminates cold-start delay on first real message
const warmupOllamaModel = async (modelName) => {
  if (!modelName) return;
  try {
    const body = JSON.stringify({ model: modelName, messages: [{ role: 'user', content: 'hi' }], max_tokens: 1, stream: false });
    const req = net.request({ method: 'POST', protocol: 'http:', hostname: 'localhost', port: 11434, path: '/v1/chat/completions' });
    req.setHeader('Content-Type', 'application/json');
    req.on('response', (res) => { res.on('data', () => {}); res.on('end', () => {}); });
    req.on('error', () => {});
    req.write(body);
    req.end();
  } catch {}
};

ipcMain.handle('warmup-ollama-model', async (_e, modelName) => {
  await ensureOllamaRunning();
  warmupOllamaModel(modelName);
  return { ok: true };
});

// Auto-start Ollama at app launch (background, fire-and-forget)
app.whenReady().then(() => setTimeout(ensureOllamaRunning, 2000));

ipcMain.handle('ensure-ollama-running', async () => {
  const ok = await ensureOllamaRunning();
  return { running: ok };
});

const ollamaPullProcesses = new Map(); // modelName â†’ child process

ipcMain.handle('ollama-pull', async (event, modelName) => {
  await ensureOllamaRunning();
  return new Promise((resolve) => {
    const child = spawn('ollama', ['pull', modelName], { shell: true });
    ollamaPullProcesses.set(modelName, child);
    let out = '';
    child.stdout.on('data', d => { out += d.toString(); safeSend(event, 'ollama-pull-progress', { model: modelName, chunk: d.toString() }); });
    child.stderr.on('data', d => { out += d.toString(); safeSend(event, 'ollama-pull-progress', { model: modelName, chunk: d.toString() }); });
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

// Batch-fetch GGUF sizes for a list of model IDs (runs after search to populate sizes)
ipcMain.handle('hf-batch-sizes', async (_e, modelIds) => {
  const fmtBytes = (b) => b >= 1e9 ? `${(b/1e9).toFixed(1)} GB` : b >= 1e6 ? `${(b/1e6).toFixed(0)} MB` : `${b} B`;
  const getModelSize = (modelId) => new Promise((resolve) => {
    const req = net.request({ method: 'GET', protocol: 'https:', hostname: 'huggingface.co', path: `/api/models/${modelId}?blobs=true` });
    req.setHeader('Accept', 'application/json');
    req.setHeader('User-Agent', 'IMI-DevHub/1.0');
    let raw = '';
    req.on('response', res => {
      res.on('data', d => raw += d.toString());
      res.on('end', () => {
        try {
          const m = JSON.parse(raw);
          const siblings = m.siblings || [];
          const getSize = (s) => s.lfs?.size || s.size || 0;
          const ggufFiles = siblings.filter(s => s.rfilename?.toLowerCase().endsWith('.gguf') && getSize(s) > 0);
          if (!ggufFiles.length) return resolve({ id: modelId, sizeLabel: '', ggufCount: 0 });
          const smallest = Math.min(...ggufFiles.map(f => getSize(f)));
          const largest = Math.max(...ggufFiles.map(f => getSize(f)));
          const sizeLabel = smallest === largest ? fmtBytes(smallest) : `${fmtBytes(smallest)} â€“ ${fmtBytes(largest)}`;
          resolve({ id: modelId, sizeLabel, ggufCount: ggufFiles.length });
        } catch(e) { resolve({ id: modelId, sizeLabel: '', ggufCount: 0 }); }
      });
    });
    req.on('error', () => resolve({ id: modelId, sizeLabel: '', ggufCount: 0 }));
    req.end();
  });
  // Fetch all in parallel (up to 12)
  const results = await Promise.all((modelIds || []).slice(0, 12).map(id => getModelSize(id)));
  return results;
});

// HuggingFace model search — Ollama can pull any GGUF model from HF
ipcMain.handle('hf-search-models', async (_e, query) => {
  if (!query || query.trim().length < 1) return { results: [], total: 0 };

  // Normalize spaces: "qwen 3" â†’ "qwen3", "deep seek" â†’ "deepseek", "llama 3" â†’ "llama3"
  const normalized = query.trim()
    .replace(/\bdeep\s+seek\b/gi, 'deepseek')
    .replace(/\b(qwen|llama|gemma|mistral|phi|falcon|wizard|stable|code)\s+(\d)/gi, '$1$2');

  const OFFICIAL_AUTHORS = { qwen:'Qwen', llama:'meta-llama', gemma:'google', mistral:'mistralai', deepseek:'deepseek-ai', phi:'microsoft', falcon:'tiiuae' };
  const baseWord = normalized.toLowerCase().match(/^([a-z]+)/)?.[1] || '';
  const officialAuthor = OFFICIAL_AUTHORS[baseWord];

  const fmtBytes = (b) => b >= 1e9 ? `${(b/1e9).toFixed(1)} GB` : b >= 1e6 ? `${(b/1e6).toFixed(0)} MB` : `${b} B`;
  const parseModel = (m) => {
    const siblings = m.siblings || [];
    const getSize = (s) => s.lfs?.size || s.size || 0;
    const ggufFiles = siblings.filter(s => s.rfilename?.toLowerCase().endsWith('.gguf') && getSize(s) > 0);
    let sizeLabel = '';
    if (ggufFiles.length === 1) sizeLabel = fmtBytes(getSize(ggufFiles[0]));
    else if (ggufFiles.length > 1) {
      const smallest = Math.min(...ggufFiles.map(f => getSize(f)));
      const largest  = Math.max(...ggufFiles.map(f => getSize(f)));
      sizeLabel = smallest === largest ? fmtBytes(smallest) : `${fmtBytes(smallest)} â€“ ${fmtBytes(largest)}`;
    }
    const ggufList = ggufFiles.map(f => {
      const quantMatch = f.rfilename.match(/[-_](Q\d[^-.]*(?:_[A-Z]+)*)\./i) || f.rfilename.match(/(Q\d[^-.]*)\./i);
      const quant = quantMatch ? quantMatch[1].toUpperCase() : f.rfilename.replace('.gguf','');
      return { filename: f.rfilename, quant, size: fmtBytes(getSize(f)), sizeBytes: getSize(f) };
    }).sort((a,b) => a.sizeBytes - b.sizeBytes);
    return { id: m.modelId||m.id, name: m.modelId||m.id, author: (m.modelId||m.id||'').split('/')[0], downloads: m.downloads||0, likes: m.likes||0, tags: m.tags||[], pipeline: m.pipeline_tag||'text-generation', updatedAt: m.lastModified||m.createdAt, hfUrl: `https://huggingface.co/${m.modelId||m.id}`, ollamaCmd: `hf.co/${m.modelId||m.id}`, sizeLabel, ggufCount: ggufFiles.length, ggufList };
  };

  const fetchHF = (path) => new Promise((res) => {
    const req = net.request({ method: 'GET', protocol: 'https:', hostname: 'huggingface.co', path });
    req.setHeader('Accept', 'application/json'); req.setHeader('User-Agent', 'IMI-DevHub/1.0');
    let raw = '';
    req.on('response', r => { r.on('data', d => raw += d.toString()); r.on('end', () => { try { res(JSON.parse(raw)); } catch { res([]); } }); });
    req.on('error', () => res([]));
    req.end();
  });

  try {
    const q = encodeURIComponent(normalized);
    // Fetch main results (24) + official author results in parallel
    const [mainRaw, officialRaw] = await Promise.all([
      fetchHF(`/api/models?search=${q}&filter=gguf&sort=downloads&direction=-1&limit=24&full=true&blobs=true`),
      officialAuthor ? fetchHF(`/api/models?author=${encodeURIComponent(officialAuthor)}&search=${q}&filter=gguf&sort=downloads&direction=-1&limit=6&full=true&blobs=true`) : Promise.resolve([]),
    ]);
    const seen = new Set();
    const allModels = [...(Array.isArray(officialRaw) ? officialRaw : []), ...(Array.isArray(mainRaw) ? mainRaw : [])];
    const results = allModels.map(parseModel).filter(m => { if (seen.has(m.id)) return false; seen.add(m.id); return true; });
    return { results, total: results.length };
  } catch(e) { return { results: [], total: 0, error: e.message }; }
});

ipcMain.handle('ollama-running', async () => {
  const running = await pingOllama();
  if (!running) return { success: false, models: [] };
  try {
    const raw = execSync('ollama ps', { timeout: 4000 }).toString().trim();
    const lines = raw.split('\n').slice(1).filter(Boolean);
    return { success: true, models: lines.map(l => l.split(/\s+/)[0]) };
  } catch { return { success: true, models: [] }; }
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
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// ðŸ“Š BENCHMARK TRACKER — per-model performance metrics
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
const BENCH_PATH = path.join(os.homedir(), '.imi', 'benchmarks.json');
class BenchmarkTracker {
  constructor() {
    this._data = {};
    try { if (fs.existsSync(BENCH_PATH)) this._data = JSON.parse(fs.readFileSync(BENCH_PATH, 'utf-8')); } catch {}
  }
  record(model, durationMs, success) {
    if (!this._data[model]) this._data[model] = { requests: 0, totalMs: 0, successes: 0 };
    const m = this._data[model];
    m.requests++;
    m.totalMs += durationMs;
    if (success) m.successes++;
    try { fs.writeFileSync(BENCH_PATH, JSON.stringify(this._data), 'utf-8'); } catch {}
  }
  getAll() { return this._data; }
  reset() { this._data = {}; try { fs.writeFileSync(BENCH_PATH, '{}', 'utf-8'); } catch {} }
}
const benchTracker = new BenchmarkTracker();
ipcMain.handle('get-benchmarks', () => benchTracker.getAll());
ipcMain.on('record-benchmark', (e, { model, durationMs, success }) => benchTracker.record(model, durationMs, success));
ipcMain.on('reset-benchmarks', () => benchTracker.reset());

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// ðŸ—‚ FILE CACHE — 60s TTL in-memory cache for project files
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
const fileCache = new Map(); // key â†’ { content, ts }
const FILE_CACHE_TTL = 60_000;
function cachedReadFile(filePath, limit = 500) {
  const now = Date.now();
  if (fileCache.has(filePath)) {
    const e = fileCache.get(filePath);
    if (now - e.ts < FILE_CACHE_TTL) {
      e.hits = (e.hits || 0) + 1;
      return { content: e.content, fromCache: true };
    }
  }
  try {
    const lines = fs.readFileSync(filePath, 'utf-8').split('\n').slice(0, limit).join('\n');
    fileCache.set(filePath, { content: lines, ts: now, hits: 0 });
    return { content: lines, fromCache: false };
  } catch { return { content: '', fromCache: false }; }
}
ipcMain.handle('get-cache-stats', () => {
  let total = 0, hits = 0;
  for (const [, v] of fileCache) { total++; hits += v.hits || 0; }
  return { files: total, hits, ttlSeconds: FILE_CACHE_TTL / 1000 };
});
ipcMain.on('clear-file-cache', () => fileCache.clear());

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// ðŸ’» EMBEDDED TERMINAL — run shell commands from the UI
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
let terminalCwd = os.homedir();

ipcMain.handle('terminal-run', async (event, { cmd, cwd }) => {
  if (cwd && fs.existsSync(cwd)) terminalCwd = cwd;
  return new Promise((resolve) => {
    const isWin = process.platform === 'win32';
    // cd commands update the tracked cwd
    const cdMatch = cmd.match(/^\s*cd\s+(.+)/i);
    if (cdMatch) {
      const target = cdMatch[1].trim().replace(/^["']|["']$/g, '');
      const resolved = path.resolve(terminalCwd, target);
      if (fs.existsSync(resolved)) {
        terminalCwd = resolved;
        resolve({ output: '', cwd: terminalCwd, error: false });
      } else {
        resolve({ output: `cd: The directory "${target}" does not exist.`, cwd: terminalCwd, error: true });
      }
      return;
    }
    // clear command
    if (/^\s*cls\s*$|^\s*clear\s*$/i.test(cmd)) {
      resolve({ output: '__CLEAR__', cwd: terminalCwd, error: false });
      return;
    }
    exec(cmd, {
      cwd: terminalCwd,
      timeout: 30000,
      env: { ...process.env, FORCE_COLOR: '0' },
      shell: isWin ? 'cmd.exe' : '/bin/bash'
    }, (err, stdout, stderr) => {
      const output = (stdout + (stderr ? '\n' + stderr : '')).trimEnd();
      resolve({ output: output || (err ? err.message : ''), cwd: terminalCwd, error: !!err });
    });
  });
});

ipcMain.handle('terminal-get-cwd', () => terminalCwd);

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// ðŸ—º PROJECT NAVIGATOR — scan imports & build dependency tree
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
ipcMain.handle('scan-project-imports', async (e, projectRoot) => {
  if (!projectRoot || !fs.existsSync(projectRoot)) return { error: 'No project root' };
  const results = [];
  const extensions = ['.ts', '.tsx', '.js', '.jsx'];
  function walk(dir, depth = 0) {
    if (depth > 6) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const ent of entries) {
      if (['node_modules', '.git', 'dist', 'build', '.next', 'coverage'].includes(ent.name)) continue;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) { walk(full, depth + 1); continue; }
      if (!extensions.some(x => ent.name.endsWith(x))) continue;
      try {
        const content = fs.readFileSync(full, 'utf-8');
        const imports = [];
        const re = /(?:import|from)\s+['"]([^'"]+)['"]/g;
        let m;
        while ((m = re.exec(content)) !== null) {
          const imp = m[1];
          if (imp.startsWith('.') || imp.startsWith('/')) {
            imports.push({ type: 'local', path: imp });
          } else {
            const pkg = imp.startsWith('@') ? imp.split('/').slice(0,2).join('/') : imp.split('/')[0];
            imports.push({ type: 'package', path: pkg });
          }
        }
        const rel = path.relative(projectRoot, full).replace(/\\/g, '/');
        results.push({ file: rel, imports, size: content.split('\n').length });
      } catch {}
    }
  }
  walk(projectRoot);
  // Build package usage frequency
  const pkgFreq = {};
  for (const r of results) {
    for (const imp of r.imports) {
      if (imp.type === 'package') pkgFreq[imp.path] = (pkgFreq[imp.path] || 0) + 1;
    }
  }
  return { files: results, packageFrequency: pkgFreq, totalFiles: results.length };
});

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// 📦 DOC HELPER — fetch npm package info for project deps
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
ipcMain.handle('fetch-package-docs', async (e, packages) => {
  const results = [];
  const fetchPkg = (pkg) => new Promise((resolve) => {
    const req = net.request({
      method: 'GET', protocol: 'https:',
      hostname: 'registry.npmjs.org',
      path: `/${encodeURIComponent(pkg)}/latest`
    });
    req.setHeader('Accept', 'application/json');
    let body = '';
    req.on('response', res => {
      res.on('data', d => body += d);
      res.on('end', () => {
        try {
          const j = JSON.parse(body);
          resolve({
            name: j.name,
            version: j.version,
            description: j.description || '',
            homepage: j.homepage || `https://www.npmjs.com/package/${pkg}`,
            license: j.license || '',
            keywords: (j.keywords || []).slice(0, 5)
          });
        } catch { resolve({ name: pkg, error: true }); }
      });
    });
    req.on('error', () => resolve({ name: pkg, error: true }));
    req.end();
  });
  for (const pkg of (packages || []).slice(0, 20)) {
    try { results.push(await fetchPkg(pkg)); } catch { results.push({ name: pkg, error: true }); }
  }
  return results;
});

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// ðŸ› DEBUG PASS — post-coder AI review for bugs
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
ipcMain.handle('run-debug-pass', async (e, { code, context, model, messageId, geminiKey: gKey }) => {
  const key = gKey || GEMINI_KEY;
  if (!key) return { error: 'No Gemini key' };
  const debugPrompt = `You are a code reviewer and debugger inside IMI (an AI coding tool). Analyze the following AI output and identify problems.

Context: ${context || 'Recent AI command output'}

Output to review:
\`\`\`
${(code || '').slice(0, 5000)}
\`\`\`

Check for these specific problems:
1. TRUNCATION — Does the code/file end abruptly mid-function, mid-tag, or mid-statement? (e.g. ends with "if (" or missing closing </html> or incomplete JS)
2. MARKDOWN LEAKAGE — Does the output start with \`\`\`html or \`\`\`js or similar code fence markers? (These break files)
3. BUGS — Any actual logic bugs, syntax errors, or broken references
4. INCOMPLETE FILES — Was a file meant to be created but appears to have missing sections?

Respond in this exact format:
TRUNCATED: YES/NO — [brief reason]
MARKDOWN LEAKAGE: YES/NO — [brief reason]
BUGS: [list any or "None found"]
VERDICT: PASS / FAIL / WARNINGS
ACTION: [one sentence — what IMI should do to fix it, or "None needed"]`;

  const postData = JSON.stringify({
    contents: [{ role: 'user', parts: [{ text: debugPrompt }] }],
    generationConfig: { temperature: 0.1, maxOutputTokens: 1024 }
  });
  return new Promise((resolve) => {
    const req = net.request({
      method: 'POST', protocol: 'https:',
      hostname: 'generativelanguage.googleapis.com',
      path: `/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`
    });
    req.setHeader('Content-Type', 'application/json');
    let body = '';
    req.on('response', res => {
      res.on('data', d => body += d);
      res.on('end', () => {
        try {
          const j = JSON.parse(body);
          const text = j.candidates?.[0]?.content?.parts?.[0]?.text || 'No analysis returned.';
          resolve({ analysis: text });
        } catch { resolve({ error: 'Parse error' }); }
      });
    });
    req.on('error', err => resolve({ error: err.message }));
    req.write(postData);
    req.end();
  });
});

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// ⚡ PARALLEL ORCHESTRATION — query multiple models at once
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
ipcMain.handle('parallel-brain-query', async (e, { prompt, models, keys }) => {
  const { geminiKey: gKey, openaiKey, claudeKey, groqKey } = keys || {};
  const results = {};
  const makeGeminiCall = (model, key, promptText) => new Promise((resolve) => {
    const postData = JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: promptText }] }],
      generationConfig: { temperature: 0.3, maxOutputTokens: 4096 }
    });
    const req = net.request({
      method: 'POST', protocol: 'https:',
      hostname: 'generativelanguage.googleapis.com',
      path: `/v1beta/models/${model}:generateContent?key=${key}`
    });
    req.setHeader('Content-Type', 'application/json');
    const start = Date.now();
    let body = '';
    req.on('response', res => {
      res.on('data', d => body += d);
      res.on('end', () => {
        try {
          const j = JSON.parse(body);
          const text = j.candidates?.[0]?.content?.parts?.[0]?.text || '';
          resolve({ text, ms: Date.now() - start, model });
        } catch { resolve({ text: '', ms: Date.now() - start, model, error: true }); }
      });
    });
    req.on('error', () => resolve({ text: '', ms: 0, model, error: true }));
    req.write(postData);
    req.end();
  });

  const promises = [];
  if ((models || []).includes('gemini') && gKey) {
    promises.push(makeGeminiCall('gemini-2.5-pro', gKey, prompt).then(r => { results['gemini'] = r; }));
  }
  if ((models || []).includes('gemini-flash') && gKey) {
    promises.push(makeGeminiCall('gemini-2.5-flash', gKey, prompt).then(r => { results['gemini-flash'] = r; }));
  }
  // OpenAI
  if ((models || []).includes('chatgpt') && openaiKey) {
    promises.push(new Promise((resolve) => {
      const postData = JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: prompt }], max_tokens: 4096 });
      const req = net.request({ method: 'POST', protocol: 'https:', hostname: 'api.openai.com', path: '/v1/chat/completions' });
      req.setHeader('Content-Type', 'application/json');
      req.setHeader('Authorization', `Bearer ${openaiKey}`);
      const start = Date.now();
      let body = '';
      req.on('response', res => {
        res.on('data', d => body += d);
        res.on('end', () => {
          try {
            const j = JSON.parse(body);
            results['chatgpt'] = { text: j.choices?.[0]?.message?.content || '', ms: Date.now() - start, model: 'gpt-4o' };
          } catch { results['chatgpt'] = { text: '', ms: 0, error: true }; }
          resolve(null);
        });
      });
      req.on('error', () => { results['chatgpt'] = { text: '', ms: 0, error: true }; resolve(null); });
      req.write(postData);
      req.end();
    }));
  }
  await Promise.all(promises);
  return results;
});

ipcMain.on('open-external-url', (e, url) => { shell.openExternal(url); });

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// 🌐 WEB GROUNDING — DuckDuckGo instant answers, no API key needed
// Used by: browser skill URL resolution + brain context injection
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function ddgSearch(query, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), timeoutMs);
    const q = encodeURIComponent(query.trim());
    const req = net.request({
      method: 'GET', protocol: 'https:',
      hostname: 'api.duckduckgo.com',
      path: `/?q=${q}&format=json&no_html=1&skip_disambig=1&no_redirect=1`
    });
    req.setHeader('User-Agent', 'IMI-Desktop/1.0');
    let body = '';
    req.on('response', res => {
      res.on('data', d => body += d);
      res.on('end', () => {
        clearTimeout(t);
        try {
          const j = JSON.parse(body);
          resolve({
            abstract: j.AbstractText?.trim() || '',
            abstractUrl: j.AbstractURL?.trim() || '',
            abstractSource: j.AbstractSource?.trim() || '',
            answer: j.Answer?.trim() || '',
            answerType: j.AnswerType?.trim() || '',
            redirect: j.Redirect?.trim() || '',
            relatedTopics: (j.RelatedTopics || []).slice(0, 3).map((r) => r.Text || '').filter(Boolean),
          });
        } catch { clearTimeout(t); resolve(null); }
      });
    });
    req.on('error', () => { clearTimeout(t); resolve(null); });
    req.end();
  });
}

// Expose DDG search to frontend
ipcMain.handle('ddg-search', async (e, query) => ddgSearch(query));

// DDG URL resolver — finds the real URL for a site name like "figma" or "linear"
async function ddgResolveUrl(siteName) {
  try {
    const result = await ddgSearch(`${siteName} official website`, 2500);
    if (!result) return null;
    if (result.abstractUrl) return result.abstractUrl;
    // Try the redirect approach — DDG "I'm Lucky" bang
    return null;
  } catch { return null; }
}






