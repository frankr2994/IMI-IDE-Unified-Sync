import React, { useState, useEffect } from 'react';
import './App.css';
import { 
  Zap, 
  Cpu, 
  Terminal as TerminalIcon, 
  Activity, 
  ShieldCheck, 
  Layers, 
  ChevronRight, 
  Download,
  AlertCircle,
  MessageSquare,
  Send,
  Terminal,
  RefreshCw,
  X,
  Minus,
  Maximize2,
  Settings,
  Database,
  Search,
  CheckCircle2,
  Settings2,
  Gauge,
  Key,
  Palette,
  Clock,
  History,
  Mic,
  Wifi
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

// Robust IPC Renderer detection for Electron with NodeIntegration
let ipc: any = { send: () => {}, invoke: async () => ({}) };
if (typeof window !== 'undefined') {
  if ((window as any).require) {
    try {
      ipc = (window as any).require('electron').ipcRenderer;
    } catch (e) {
      console.warn('Could not load ipcRenderer:', e);
    }
  } else if ((window as any).ipcRenderer) {
    ipc = (window as any).ipcRenderer;
  }
}

const App = () => {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [quota, setQuota] = useState(65);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState('Idle');
  const [coderStatus, setCoderStatus] = useState('Idle');
  const [lastSyncTime, setLastSyncTime] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [stats, setStats] = useState<any>({ fileCount: '0', sizeMB: '0', freeMem: '0', platform: '...', dirCount: '0', projectRoot: '' });
  const [usage, setUsage] = useState({ cpu: '0', ram: '0', threads: 0, load: '0' });
  const [tokenUsage, setTokenUsage] = useState<any>({});
  
  // Brain & Coder Pickers State
  const [activeDirector, setActiveDirector] = useState('gemini');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [activeEngine, setActiveEngine] = useState('imi-core'); // Default: works without extra installs
  const [isCoderDropdownOpen, setIsCoderDropdownOpen] = useState(false);
  
  const [mcpServers, setMcpServers] = useState<any[]>([]);
  const [linkedServicesExpanded, setLinkedServicesExpanded] = useState(false);
  const [newServer, setNewServer] = useState({ name: '', command: '', args: '', env: {} });
  const [chatInput, setChatInput] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [mediaRecorder, setMediaRecorder] = useState<any>(null);
  const [mcpSearch, setMcpSearch] = useState('');
  const [npmResults, setNpmResults] = useState<any[]>([]);
  const [npmSearching, setNpmSearching] = useState(false);
  const [npmTotal, setNpmTotal] = useState(0);
  const [npmError, setNpmError] = useState('');
  const [mcpHubTab, setMcpHubTab] = useState<'mcp'|'github'|'tools'|'ai'>('mcp');
  const [ghQuery, setGhQuery] = useState('');
  const [ghResults, setGhResults] = useState<any[]>([]);
  const [ghSearching, setGhSearching] = useState(false);
  const [ghTotal, setGhTotal] = useState(0);
  const [ghError, setGhError] = useState('');
  const [ghSort, setGhSort] = useState('stars');
  const [ghUrlPreview, setGhUrlPreview] = useState<any>(null);
  const [cloningRepo, setCloningRepo] = useState('');

  // 🛠 Installed Tools
  const [toolsList, setToolsList] = useState<any[]>([]);
  const [toolsLoading, setToolsLoading] = useState(false);
  const loadTools = async () => {
    setToolsLoading(true);
    const res = await (ipc as any).invoke('check-tools').catch(() => []);
    setToolsList(res || []);
    setToolsLoading(false);
  };

  // 🤖 Ollama AI Models
  const [ollamaModels, setOllamaModels] = useState<any[]>([]);
  const [ollamaPulling, setOllamaPulling] = useState('');
  const [ollamaLog, setOllamaLog] = useState<Record<string,string>>({});
  const [ollamaPullProgress, setOllamaPullProgress] = useState<Record<string, { percent: number; downloaded: string; total: string; timeLeft: string; status: string }>>({});
  const [ollamaSearch, setOllamaSearch] = useState('');

  // Parse raw ollama pull output into structured progress
  const parseOllamaProgress = (raw: string) => {
    // Match: "pulling abc123...  45% ▕████▏  1.8 GB/4.1 GB  45 seconds remaining"
    const progressMatch = raw.match(/(\d+)%.*?([\d.]+\s*\w+)\/([\d.]+\s*\w+)(?:.*?([\d]+\s+\w+(?:\s+\w+)?\s*remaining))?/);
    if (progressMatch) {
      return {
        percent: parseInt(progressMatch[1]),
        downloaded: progressMatch[2]?.trim() || '',
        total: progressMatch[3]?.trim() || '',
        timeLeft: progressMatch[4]?.trim() || '',
        status: 'pulling',
      };
    }
    if (/verifying/i.test(raw))  return { percent: 99, downloaded: '', total: '', timeLeft: '', status: 'Verifying…' };
    if (/writing/i.test(raw))    return { percent: 99, downloaded: '', total: '', timeLeft: '', status: 'Writing manifest…' };
    if (/success/i.test(raw))    return { percent: 100, downloaded: '', total: '', timeLeft: '', status: 'Complete!' };
    if (/pulling manifest/i.test(raw)) return { percent: 0, downloaded: '', total: '', timeLeft: '', status: 'Fetching manifest…' };
    return null;
  };
  const [hfResults, setHfResults] = useState<any[]>([]);
  const [hfSearching, setHfSearching] = useState(false);
  const [hfError, setHfError] = useState('');
  const [hfUrlPreview, setHfUrlPreview] = useState<any>(null);
  const [npmUrlPreview, setNpmUrlPreview] = useState<any>(null);
  const OLLAMA_FEATURED = [
    { name: 'llama3.2',       label: 'Llama 3.2 3B',    size: '2GB',    desc: 'Meta\'s latest — fast, capable, great for chat & code', tags: ['chat','code'] },
    { name: 'mistral',        label: 'Mistral 7B',       size: '4.1GB',  desc: 'Fast French model, excellent for code',                 tags: ['code','chat'] },
    { name: 'deepseek-r1',    label: 'DeepSeek R1 7B',   size: '4.7GB',  desc: 'Strong reasoning — rivals GPT-4o on benchmarks',        tags: ['reasoning','code'] },
    { name: 'qwen2.5-coder',  label: 'Qwen 2.5 Coder',  size: '4.7GB',  desc: '#1 ranked open coding model from Alibaba',              tags: ['code'] },
    { name: 'gemma2',         label: 'Gemma 2 9B',       size: '5.5GB',  desc: 'Google\'s efficient open model',                        tags: ['chat'] },
    { name: 'phi3',           label: 'Phi-3 Mini',       size: '2.2GB',  desc: 'Microsoft\'s tiny but punchy model',                    tags: ['chat','fast'] },
    { name: 'llava',          label: 'LLaVA Vision',     size: '4.5GB',  desc: 'See and describe images — multimodal',                  tags: ['vision'] },
    { name: 'nomic-embed-text', label: 'Nomic Embed',    size: '274MB',  desc: 'Text embeddings for semantic search & RAG',             tags: ['embeddings'] },
  ];
  const searchHF = async (q: string) => {
    if (!q.trim()) return;
    setHfSearching(true); setHfError(''); setHfUrlPreview(null);
    // Detect HuggingFace URL — fetch model directly
    if (/huggingface\.co\//i.test(q.trim())) {
      try {
        const res = await (ipc as any).invoke('hf-fetch-model', q.trim());
        if (res.error) setHfError(res.error);
        else setHfUrlPreview(res);
      } catch(e: any) { setHfError(e.message); }
      setHfSearching(false); return;
    }
    try {
      const res = await (ipc as any).invoke('hf-search-models', q);
      const results = res.results || [];
      setHfResults(results);
      if (res.error) setHfError(res.error);
      // Batch-fetch real sizes in background, update cards as they arrive
      if (results.length > 0) {
        const ids = results.map((r: any) => r.id);
        (ipc as any).invoke('hf-batch-sizes', ids).then((sizes: any[]) => {
          if (!sizes?.length) return;
          const sizeMap: Record<string, any> = {};
          sizes.forEach(s => { sizeMap[s.id] = s; });
          setHfResults(prev => prev.map(r => sizeMap[r.id] ? { ...r, sizeLabel: sizeMap[r.id].sizeLabel, ggufCount: sizeMap[r.id].ggufCount } : r));
        }).catch(() => {});
      }
    } catch(e: any) {
      const msg = e.message || '';
      if (msg.includes('No handler registered')) {
        setHfError('⚠️ Restart the app to activate new features.');
      } else { setHfError(msg); }
    }
    setHfSearching(false);
  };
  const formatNum = (n: number) => n >= 1000000 ? `${(n/1000000).toFixed(1)}M` : n >= 1000 ? `${(n/1000).toFixed(1)}k` : String(n);
  const loadOllamaModels = async () => {
    const res = await (ipc as any).invoke('ollama-list').catch(() => ({ models: [] }));
    const models = res.models || [];
    // Tag each model with canRun based on VRAM + free RAM
    try {
      const hw = await (ipc as any).invoke('get-hardware-info');
      const vramGB = hw.vramMB / 1024;
      const freeRamGB = hw.freeRamMB / 1024;
      models.forEach((m: any) => {
        const sizeGB = parseFloat(m.size);
        const isGB = m.size?.toUpperCase().includes('GB');
        const modelGB = isGB ? sizeGB : sizeGB / 1024;
        m.canRun = modelGB <= vramGB || modelGB <= freeRamGB;
        m.tooLarge = !m.canRun;
        m.vramGB = vramGB;
      });
    } catch { models.forEach((m: any) => { m.canRun = true; m.tooLarge = false; }); }
    setOllamaModels(models);
  };

  // Pre-pull hardware check — returns true if safe to proceed, false if blocked
  const checkHardwareBeforePull = async (sizeLabel: string): Promise<boolean> => {
    if (!sizeLabel) return true;
    // Parse size from label like "4.7GB", "22 GB", "899 MB – 49.8 GB (28 files)"
    const maxMatch = sizeLabel.replace(/,/g, '').match(/(\d+\.?\d*)\s*GB/gi);
    if (!maxMatch) return true;
    const sizes = maxMatch.map(s => parseFloat(s));
    const maxSizeGB = Math.max(...sizes);
    if (maxSizeGB < 5) return true; // small model, always fine
    try {
      const hw = await (ipc as any).invoke('get-hardware-info');
      const vramGB = hw.vramMB / 1024;
      const freeRamGB = hw.freeRamMB / 1024;
      if (maxSizeGB > vramGB && maxSizeGB > freeRamGB) {
        const msg = `⚠️ Not enough memory to run this model!\n\n` +
          `📦 Model size: ${maxSizeGB.toFixed(1)} GB\n` +
          `🎮 Your GPU VRAM: ${vramGB.toFixed(1)} GB (${hw.gpuName})\n` +
          `💾 Free RAM: ${freeRamGB.toFixed(1)} GB\n\n` +
          `This model won't fit in your GPU or RAM — it will fail to load after downloading.\n\n` +
          `✅ Recommended: pick a model under ${Math.floor(vramGB)}GB (like qwen2.5-coder:7b at 4.7GB).\n\nDownload anyway?`;
        return window.confirm(msg);
      }
      if (maxSizeGB > vramGB) {
        const msg = `⚠️ This model is larger than your GPU VRAM\n\n` +
          `📦 Model size: ${maxSizeGB.toFixed(1)} GB\n` +
          `🎮 Your GPU VRAM: ${vramGB.toFixed(1)} GB (${hw.gpuName})\n\n` +
          `It will run on CPU RAM instead, which is much slower.\n` +
          `For best speed, pick a model under ${Math.floor(vramGB)}GB.\n\nDownload anyway?`;
        return window.confirm(msg);
      }
    } catch {}
    return true;
  };

  const searchGitHub = async (q: string, sort?: string) => {
    if (!q.trim()) return;
    setGhSearching(true); setGhError(''); setGhUrlPreview(null); setGhResults([]);
    // Detect GitHub URL — fetch directly instead of searching
    if (/^https?:\/\/(www\.)?github\.com\//i.test(q.trim())) {
      try {
        const res = await (ipc as any).invoke('github-fetch-url', q.trim());
        if (res.error) setGhError(res.error);
        else setGhUrlPreview(res);
      } catch(e: any) { setGhError(e.message); }
      setGhSearching(false); return;
    }
    try {
      const res = await (ipc as any).invoke('github-search', q, sort || ghSort);
      setGhResults(res.results || []);
      setGhTotal(res.total || 0);
      if (res.error) setGhError(res.error);
    } catch(e: any) { setGhError(e.message); }
    setGhSearching(false);
  };

  // Shorten raw Ollama model names for display
  const shortModelName = (raw: string) => {
    let s = raw.replace(/^hf\.co\/[^/]+\//i, '').replace(/:latest$/i, '').replace(/-GGUF$/i, '');
    // e.g. "Qwen3.5-35B-A3B" → "Qwen 3.5 35B"
    s = s.replace(/([A-Za-z])(\d)/g, '$1 $2').replace(/(\d)([A-Za-z])/g, '$1 $2').replace(/-/g, ' ').replace(/\s+/g, ' ').trim();
    return s.length > 22 ? s.slice(0, 20) + '…' : s;
  };

  const formatStars = (n: number) => n >= 1000 ? `${(n/1000).toFixed(1)}k` : String(n);
  const timeAgo = (iso: string) => {
    const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
    if (d === 0) return 'today'; if (d === 1) return 'yesterday';
    if (d < 30) return `${d}d ago`; if (d < 365) return `${Math.floor(d/30)}mo ago`;
    return `${Math.floor(d/365)}yr ago`;
  };
  const langColor: Record<string,string> = { TypeScript:'#3178c6', JavaScript:'#f1e05a', Python:'#3572A5', Go:'#00ADD8', Rust:'#dea584', Java:'#b07219', 'C++':'#f34b7d', C:'#555555', Ruby:'#701516', Shell:'#89e051' };

  const searchNpm = async (q: string) => {
    if (!q.trim()) { setNpmResults([]); setNpmTotal(0); return; }
    setNpmSearching(true); setNpmError(''); setNpmUrlPreview(null);
    // Detect npm URL
    if (/npmjs\.com\/package\//i.test(q.trim())) {
      try {
        const res = await (ipc as any).invoke('npm-fetch-package', q.trim());
        if (res.error) setNpmError(res.error);
        else setNpmUrlPreview(res);
      } catch(e: any) { setNpmError(e.message); }
      setNpmSearching(false); return;
    }
    // Detect GitHub URL — reuse existing handler
    if (/^https?:\/\/(www\.)?github\.com\//i.test(q.trim())) {
      try {
        const res = await (ipc as any).invoke('github-fetch-url', q.trim());
        if (res.error) setNpmError(res.error);
        else setNpmUrlPreview({ ...res, fromGitHub: true });
      } catch(e: any) { setNpmError(e.message); }
      setNpmSearching(false); return;
    }
    try {
      const res = await (ipc as any).invoke('npm-search-mcp', q);
      setNpmResults(res.results || []);
      setNpmTotal(res.total || 0);
      if (res.error) setNpmError(res.error);
    } catch(e: any) { setNpmError(e.message); }
    setNpmSearching(false);
  };

  const [availableMCPs] = useState([
    { id: 'Jules', name: 'Jules Agent', pkg: '@amitdeshmukh/google-jules-mcp', desc: 'Recycling implementation engine', color: 'linear-gradient(135deg, #ff416c 0%, #ff4b2b 100%)', command: 'npx', args: ['-y', '@amitdeshmukh/google-jules-mcp'] },
    { id: 'GitHub', name: 'GitHub Sync', pkg: '@modelcontextprotocol/server-github', desc: 'Bidirectional cloud repository access', color: 'linear-gradient(135deg, #24292e 0%, #171a1d 100%)', command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'] },
    { id: 'ChatGPT', name: 'ChatGPT API', pkg: '@modelcontextprotocol/server-openai', desc: 'OpenAI context bridge', color: 'linear-gradient(135deg, #10a37f 0%, #0cebeb 100%)', command: 'npx', args: ['-y', '@modelcontextprotocol/server-openai'] },
    { id: 'Claude', name: 'Claude API', pkg: '@modelcontextprotocol/server-anthropic-chat', desc: 'Anthropic reasoning layer', color: 'linear-gradient(135deg, #da7756 0%, #f093fb 100%)', command: 'npx', args: ['-y', '@modelcontextprotocol/server-anthropic-chat'] },
    { id: 'Filesystem', name: 'Filesystem', pkg: '@modelcontextprotocol/server-filesystem', desc: 'Local directory monitoring', color: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)', command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem'] },
    { id: 'Memory', name: 'Memory', pkg: 'mcp-server-memory', desc: 'Persistent knowledge graph', color: 'linear-gradient(135deg, #9b4dff 0%, #64748b 100%)', command: 'npx', args: ['-y', 'mcp-server-memory'] },
    { id: 'Puppeteer Browser', name: 'Puppeteer Browser', pkg: '@modelcontextprotocol/server-puppeteer', desc: 'Chrome control — navigate, screenshot, click, fill & evaluate JS via MCP', color: 'linear-gradient(135deg, #4facfe 0%, #9b4dff 100%)', command: 'npx', args: ['-y', '@modelcontextprotocol/server-puppeteer'] }
  ]);
  const [projectRootInput, setProjectRootInput] = useState('');
  const [geminiKey, setGeminiKey] = useState('');
  const [githubToken, setGithubToken] = useState('');
  const [openaiKey, setOpenaiKey] = useState('');
  const [claudeKey, setClaudeKey] = useState('');
  const [deepseekKey, setDeepseekKey] = useState('');
  const [mistralKey, setMistralKey] = useState('');
  const [llamaKey, setLlamaKey] = useState('');
  const [perplexityKey, setPerplexityKey] = useState('');
  const [customApiKey, setCustomApiKey] = useState('');
  const [customApiUrl, setCustomApiUrl] = useState('');
  const [customApiModel, setCustomApiModel] = useState('');
  const [julesApiKey, setJulesApiKey] = useState('');
  const [googleMapsKey, setGoogleMapsKey] = useState('');
  const [gitInstalled, setGitInstalled] = useState(true);
  const [settingsActiveSubTab, setSettingsActiveSubTab] = useState('general');
  const [addServiceExpanded, setAddServiceExpanded] = useState(false);
  const [settingsSearch, setSettingsSearch] = useState('');
  const [lastSnapshot, setLastSnapshot] = useState<any>(null);
  const [snapshotMode, setSnapshotMode] = useState(true);
  const [theme, setTheme] = useState('glass');
  const [logRetention, setLogRetention] = useState(15);
  const [syncFrequency, setSyncFrequency] = useState('60'); // Default 60s
  const [debugMode, setDebugMode] = useState(false);
  // 🤖 Puppeteer Browser Control state
  // ⚡ Skill Engine state
  const [skills, setSkills] = useState<any[]>([]);
  const [skillStats, setSkillStats] = useState<any>({ totalRequests: 0, skillHits: 0, tokensSaved: 0 });
  const [skillEfficiency, setSkillEfficiency] = useState(0);
  const [newSkillName, setNewSkillName] = useState('');
  const [newSkillPattern, setNewSkillPattern] = useState('');
  const [newSkillResponse, setNewSkillResponse] = useState('');
  const [skillLibSearch, setSkillLibSearch] = useState('');
  const [skillsSubTab, setSkillsSubTab] = useState<'mine'|'library'|'optimizer'>('mine');
  const [installedSkillIds, setInstalledSkillIds] = useState<Set<string>>(new Set());
  const [optimizerHistory, setOptimizerHistory] = useState<any[]>([]);
  const [optimizerLastResult, setOptimizerLastResult] = useState<{ efficiency: number; removed: number } | null>(null);
  const [optimizerRunning, setOptimizerRunning] = useState(false);
  const [optimizerLastRun, setOptimizerLastRun] = useState<number | null>(null);

  const SKILL_LIBRARY = [
    // 🌐 Web — General
    { id: 'lib_spotify',      name: 'Open Spotify',         pattern: 'open spotify',              response: '', category: '🌐 Web', desc: 'Opens Spotify in browser', icon: '🎵', type: 'browser' },
    { id: 'lib_youtube',      name: 'Open YouTube',         pattern: 'open youtube',              response: '', category: '🌐 Web', desc: 'Opens YouTube in browser', icon: '▶️', type: 'browser' },
    { id: 'lib_gmail',        name: 'Open Gmail',           pattern: 'open gmail',                response: '', category: '🌐 Web', desc: 'Opens Gmail', icon: '📧', type: 'browser' },
    { id: 'lib_netflix',      name: 'Open Netflix',         pattern: 'open netflix',              response: '', category: '🌐 Web', desc: 'Opens Netflix', icon: '🎬', type: 'browser' },
    { id: 'lib_twitter',      name: 'Open Twitter/X',       pattern: 'open twitter',              response: '', category: '🌐 Web', desc: 'Opens Twitter/X', icon: '🐦', type: 'browser' },
    { id: 'lib_reddit',       name: 'Open Reddit',          pattern: 'open reddit',               response: '', category: '🌐 Web', desc: 'Opens Reddit', icon: '🤖', type: 'browser' },
    { id: 'lib_instagram',    name: 'Open Instagram',       pattern: 'open instagram',            response: '', category: '🌐 Web', desc: 'Opens Instagram', icon: '📸', type: 'browser' },
    { id: 'lib_tiktok',       name: 'Open TikTok',          pattern: 'open tiktok',               response: '', category: '🌐 Web', desc: 'Opens TikTok', icon: '🎶', type: 'browser' },
    { id: 'lib_linkedin',     name: 'Open LinkedIn',        pattern: 'open linkedin',             response: '', category: '🌐 Web', desc: 'Opens LinkedIn', icon: '💼', type: 'browser' },
    { id: 'lib_discord',      name: 'Open Discord',         pattern: 'open discord',              response: '', category: '🌐 Web', desc: 'Opens Discord', icon: '💬', type: 'browser' },
    { id: 'lib_twitch',       name: 'Open Twitch',          pattern: 'open twitch',               response: '', category: '🌐 Web', desc: 'Opens Twitch', icon: '🟣', type: 'browser' },
    { id: 'lib_gdrive',       name: 'Open Google Drive',    pattern: 'open.*drive',               response: '', category: '🌐 Web', desc: 'Opens Google Drive', icon: '☁️', type: 'browser' },
    { id: 'lib_gdocs',        name: 'Open Google Docs',     pattern: 'open.*docs',                response: '', category: '🌐 Web', desc: 'Opens Google Docs', icon: '📄', type: 'browser' },
    { id: 'lib_gsheets',      name: 'Open Google Sheets',   pattern: 'open.*sheets',              response: '', category: '🌐 Web', desc: 'Opens Google Sheets', icon: '📊', type: 'browser' },
    { id: 'lib_gcal',         name: 'Open Google Calendar', pattern: 'open.*calendar',            response: '', category: '🌐 Web', desc: 'Opens Google Calendar', icon: '📅', type: 'browser' },
    { id: 'lib_maps',         name: 'Open Google Maps',     pattern: 'open.*maps',                response: '', category: '🌐 Web', desc: 'Opens Google Maps', icon: '🗺️', type: 'browser' },
    { id: 'lib_notion',       name: 'Open Notion',          pattern: 'open notion',               response: '', category: '🌐 Web', desc: 'Opens Notion', icon: '🗒️', type: 'browser' },
    { id: 'lib_trello',       name: 'Open Trello',          pattern: 'open trello',               response: '', category: '🌐 Web', desc: 'Opens Trello boards', icon: '📋', type: 'browser' },
    { id: 'lib_slack',        name: 'Open Slack',           pattern: 'open slack',                response: '', category: '🌐 Web', desc: 'Opens Slack', icon: '💬', type: 'browser' },
    { id: 'lib_figma',        name: 'Open Figma',           pattern: 'open figma',                response: '', category: '🌐 Web', desc: 'Opens Figma design tool', icon: '🎨', type: 'browser' },
    { id: 'lib_dropbox',      name: 'Open Dropbox',         pattern: 'open dropbox',              response: '', category: '🌐 Web', desc: 'Opens Dropbox', icon: '📦', type: 'browser' },
    { id: 'lib_weather',      name: 'Check Weather',        pattern: 'weather',                   response: '', category: '🌐 Web', desc: 'Opens weather forecast', icon: '🌤️', type: 'browser' },
    // 🤖 AI Tools
    { id: 'lib_chatgpt',      name: 'Open ChatGPT',         pattern: 'open chatgpt',              response: '', category: '🤖 AI Tools', desc: 'Opens ChatGPT', icon: '🤖', type: 'browser' },
    { id: 'lib_claude',       name: 'Open Claude',          pattern: 'open claude',               response: '', category: '🤖 AI Tools', desc: 'Opens Claude.ai', icon: '🧠', type: 'browser' },
    { id: 'lib_gemini',       name: 'Open Gemini',          pattern: 'open gemini',               response: '', category: '🤖 AI Tools', desc: 'Opens Gemini', icon: '✨', type: 'browser' },
    { id: 'lib_perplexity',   name: 'Open Perplexity',      pattern: 'open perplexity',           response: '', category: '🤖 AI Tools', desc: 'Opens Perplexity AI search', icon: '🔍', type: 'browser' },
    { id: 'lib_midjourney',   name: 'Open Midjourney',      pattern: 'open midjourney',           response: '', category: '🤖 AI Tools', desc: 'Opens Midjourney image gen', icon: '🖼️', type: 'browser' },
    { id: 'lib_huggingface',  name: 'Open Hugging Face',    pattern: 'open hugging.?face',        response: '', category: '🤖 AI Tools', desc: 'Opens HuggingFace model hub', icon: '🤗', type: 'browser' },
    { id: 'lib_replicate',    name: 'Open Replicate',       pattern: 'open replicate',            response: '', category: '🤖 AI Tools', desc: 'Opens Replicate.com', icon: '🔁', type: 'browser' },
    { id: 'lib_groq',         name: 'Open Groq',            pattern: 'open groq',                 response: '', category: '🤖 AI Tools', desc: 'Opens Groq — fastest LLM API', icon: '⚡', type: 'browser' },
    { id: 'lib_ollama_web',   name: 'Open Ollama.com',      pattern: 'open ollama',               response: '', category: '🤖 AI Tools', desc: 'Opens Ollama model library site', icon: '🦙', type: 'browser' },
    { id: 'lib_v0',           name: 'Open v0 by Vercel',    pattern: 'open v0',                   response: '', category: '🤖 AI Tools', desc: 'Opens v0.dev AI UI builder', icon: '🎨', type: 'browser' },
    { id: 'lib_cursor',       name: 'Open Cursor',          pattern: 'open cursor',               response: '', category: '🤖 AI Tools', desc: 'Opens cursor.sh AI editor', icon: '📝', type: 'browser' },
    // 💻 Dev — Git
    { id: 'lib_github',       name: 'Open GitHub',          pattern: 'open github',               response: '', category: '💻 Dev — Git', desc: 'Opens GitHub', icon: '🐙', type: 'browser' },
    { id: 'lib_gitstatus',    name: 'Git Status',           pattern: 'git status',                response: '', category: '💻 Dev — Git', desc: 'Runs git status', icon: '🌿', type: 'passthrough' },
    { id: 'lib_gitpull',      name: 'Git Pull',             pattern: 'git pull',                  response: '', category: '💻 Dev — Git', desc: 'Pulls latest from remote', icon: '⬇️', type: 'passthrough' },
    { id: 'lib_gitpush',      name: 'Git Push',             pattern: 'git push',                  response: '', category: '💻 Dev — Git', desc: 'Pushes to remote', icon: '⬆️', type: 'passthrough' },
    { id: 'lib_gitlog',       name: 'Git Log',              pattern: 'git log',                   response: '', category: '💻 Dev — Git', desc: 'Shows commit history', icon: '📜', type: 'passthrough' },
    { id: 'lib_gitdiff',      name: 'Git Diff',             pattern: 'git diff',                  response: '', category: '💻 Dev — Git', desc: 'Shows unstaged changes', icon: '📝', type: 'passthrough' },
    { id: 'lib_gitbranch',    name: 'Git Branch List',      pattern: 'git branch',                response: '', category: '💻 Dev — Git', desc: 'Lists all branches', icon: '🌲', type: 'passthrough' },
    // 💻 Dev — npm / Node
    { id: 'lib_npm',          name: 'Open npm',             pattern: 'open npm',                  response: '', category: '💻 Dev — npm', desc: 'Opens npmjs.com', icon: '📦', type: 'browser' },
    { id: 'lib_npminstall',   name: 'npm install',          pattern: 'npm install',               response: '', category: '💻 Dev — npm', desc: 'Runs npm install', icon: '⚡', type: 'passthrough' },
    { id: 'lib_npmrun',       name: 'npm run dev',          pattern: 'npm run dev',               response: '', category: '💻 Dev — npm', desc: 'Starts dev server', icon: '🚀', type: 'passthrough' },
    { id: 'lib_npmbuild',     name: 'npm run build',        pattern: 'npm.*build',                response: '', category: '💻 Dev — npm', desc: 'Builds the project', icon: '🏗️', type: 'passthrough' },
    { id: 'lib_npmtest',      name: 'npm test',             pattern: 'npm.*test',                 response: '', category: '💻 Dev — npm', desc: 'Runs test suite', icon: '🧪', type: 'passthrough' },
    { id: 'lib_npmlint',      name: 'npm run lint',         pattern: 'npm.*lint',                 response: '', category: '💻 Dev — npm', desc: 'Runs linter', icon: '🔍', type: 'passthrough' },
    // 💻 Dev — Editors & Deploy
    { id: 'lib_vscode',       name: 'Open VS Code',         pattern: 'open vscode',               response: '', category: '💻 Dev — Tools', desc: 'Launches VS Code', icon: '💙', type: 'passthrough' },
    { id: 'lib_vercel',       name: 'Open Vercel',          pattern: 'open vercel',               response: '', category: '💻 Dev — Tools', desc: 'Opens Vercel dashboard', icon: '▲', type: 'browser' },
    { id: 'lib_netlify',      name: 'Open Netlify',         pattern: 'open netlify',              response: '', category: '💻 Dev — Tools', desc: 'Opens Netlify dashboard', icon: '🟢', type: 'browser' },
    { id: 'lib_supabase',     name: 'Open Supabase',        pattern: 'open supabase',             response: '', category: '💻 Dev — Tools', desc: 'Opens Supabase dashboard', icon: '⚡', type: 'browser' },
    { id: 'lib_planetscale',  name: 'Open PlanetScale',     pattern: 'open planetscale',          response: '', category: '💻 Dev — Tools', desc: 'Opens PlanetScale DB', icon: '🪐', type: 'browser' },
    { id: 'lib_railway',      name: 'Open Railway',         pattern: 'open railway',              response: '', category: '💻 Dev — Tools', desc: 'Opens Railway deploy platform', icon: '🚂', type: 'browser' },
    { id: 'lib_stackover',    name: 'Open Stack Overflow',  pattern: 'open stack.?overflow',      response: '', category: '💻 Dev — Tools', desc: 'Opens Stack Overflow', icon: '📚', type: 'browser' },
    { id: 'lib_mdn',          name: 'Open MDN Docs',        pattern: 'open mdn',                  response: '', category: '💻 Dev — Tools', desc: 'Opens MDN Web Docs', icon: '🦊', type: 'browser' },
    { id: 'lib_dockerhub',    name: 'Open Docker Hub',      pattern: 'open docker.*hub',          response: '', category: '💻 Dev — Tools', desc: 'Opens Docker Hub', icon: '🐳', type: 'browser' },
    // 🎮 Gaming
    { id: 'lib_steam',        name: 'Open Steam',           pattern: 'open steam',                response: '', category: '🎮 Gaming', desc: 'Opens Steam', icon: '🎮', type: 'browser' },
    { id: 'lib_epic',         name: 'Open Epic Games',      pattern: 'open epic',                 response: '', category: '🎮 Gaming', desc: 'Opens Epic Games store', icon: '🎯', type: 'browser' },
    { id: 'lib_roblox',       name: 'Open Roblox',          pattern: 'open roblox',               response: '', category: '🎮 Gaming', desc: 'Opens Roblox', icon: '🧱', type: 'browser' },
    { id: 'lib_minecraft',    name: 'Open Minecraft site',  pattern: 'open minecraft',            response: '', category: '🎮 Gaming', desc: 'Opens Minecraft.net', icon: '⛏️', type: 'browser' },
    // 🛠️ System
    { id: 'lib_sysinfo',      name: 'System Info',          pattern: 'system info',               response: '', category: '🛠️ System', desc: 'Shows OS, RAM, CPU usage', icon: '💻', type: 'passthrough' },
    { id: 'lib_diskspace',    name: 'Disk Space',           pattern: 'disk space',                response: '', category: '🛠️ System', desc: 'Checks available disk space', icon: '💾', type: 'passthrough' },
    { id: 'lib_listfiles',    name: 'List Files',           pattern: 'list.*files',               response: '', category: '🛠️ System', desc: 'Lists files in project root', icon: '📁', type: 'passthrough' },
    { id: 'lib_clearterm',    name: 'Clear Terminal',       pattern: 'clear terminal',            response: '', category: '🛠️ System', desc: 'Clears the terminal', icon: '🧹', type: 'passthrough' },
    // ℹ️ IMI Info (zero-token cached responses)
    { id: 'lib_whatisimi',    name: 'What is IMI?',         pattern: 'what is imi',               response: 'IMI (Integrated Merge Interface) is your AI orchestration hub — it routes tasks between a Brain model (Gemini) and Coder agents to minimize token usage while maximizing output quality.', category: 'ℹ️ IMI Info', desc: 'Explains IMI — zero API tokens', icon: '🧩', type: 'cached' },
    { id: 'lib_helpme',       name: 'What can you do?',     pattern: 'what can you do',           response: 'I can: open websites, create files on your desktop, write & deploy code, search GitHub/npm, pull AI models via Ollama, manage skills, sync with GitHub, and orchestrate multi-AI tasks. Just ask!', category: 'ℹ️ IMI Info', desc: 'Lists capabilities — zero tokens', icon: '❓', type: 'cached' },
    { id: 'lib_version',      name: 'IMI Version',          pattern: 'imi version',               response: 'IMI v1.0.4 — Integrated Merge Interface. Brain: Gemini 2.5 Pro. Skills Engine: active. Dev Hub: active.', category: 'ℹ️ IMI Info', desc: 'Returns version — zero tokens', icon: '🏷️', type: 'cached' },
    { id: 'lib_howtokens',    name: 'How does token saving work?', pattern: 'how.*token',        response: 'The Skill Engine intercepts your request BEFORE sending it to any AI. If a skill pattern matches, it handles the request directly — saving ~400-600 tokens per hit. Goal: 90% of routine requests handled by skills.', category: 'ℹ️ IMI Info', desc: 'Explains token saving — zero API call', icon: '💡', type: 'cached' },
    { id: 'lib_howskills',    name: 'How do skills work?',  pattern: 'how.*skills.*work',         response: 'Skills are fast pattern matchers. When you type a command, IMI checks skills first. If a skill matches: instant response, zero tokens. If no match: sent to the Brain (Gemini). Auto-creation kicks in when you repeat similar commands 3+ times.', category: 'ℹ️ IMI Info', desc: 'Explains Skill Engine — zero tokens', icon: '⚡', type: 'cached' },
  ];

  const [puppeteerStatus, setPuppeteerStatus] = useState<'idle'|'launching'|'ready'|'error'>('idle');
  const [puppeteerUrl, setPuppeteerUrl] = useState('https://google.com');
  const [puppeteerLog, setPuppeteerLog] = useState<string[]>([]);
  const [puppeteerSelector, setPuppeteerSelector] = useState('');
  const [puppeteerScript, setPuppeteerScript] = useState('document.title');
  const [puppeteerScreenshot, setPuppeteerScreenshot] = useState<string | null>(null);

  const pLog = (msg: string) => setPuppeteerLog(prev => [...prev.slice(-29), `[${new Date().toLocaleTimeString()}] ${msg}`]);

  const launchBrowser = async () => {
    setPuppeteerStatus('launching');
    pLog('🚀 Launching Puppeteer MCP server...');
    const result = await (ipc as any).invoke('puppeteer:launch');
    if (result.success) { setPuppeteerStatus('ready'); pLog('✅ ' + result.message); }
    else { setPuppeteerStatus('error'); pLog('❌ ' + result.error); }
  };

  const puppeteerAction = async (action: string, params: any) => {
    pLog(`⚡ ${action}: ${JSON.stringify(params)}`);
    const result = await (ipc as any).invoke('puppeteer:action', { action, params });
    if (result.success) {
      pLog(`✅ Done.`);
      if (action === 'screenshot' && result.data && result.data.content) {
        const imgContent = result.data.content?.find((c: any) => c.type === 'image');
        if (imgContent) setPuppeteerScreenshot(`data:image/png;base64,${imgContent.data}`);
      }
    } else { pLog('❌ ' + result.error); }
  };

  const stopBrowser = async () => {
    await (ipc as any).invoke('puppeteer:stop');
    setPuppeteerStatus('idle');
    pLog('🛑 Browser stopped.');
  };
  const [snapshotFrequency, setSnapshotFrequency] = useState(5);
  const [brainTemperature, setBrainTemperature] = useState(0.7);
  const [brainMaxTokens, setBrainMaxTokens] = useState(2048);
  const [brainModel, setBrainModel] = useState('gemini-2.5-flash');
  const [strategyVersion, setStrategyVersion] = useState('1.0.1');
  
  interface Log { id: number; type: string; msg: string; }
  const [logs, setLogs] = useState<Log[]>([
    { id: 1, type: 'ag', msg: 'Core Orchestration System initialized.' },
    { id: 2, type: 'system', msg: 'System telemetry active and streaming.' }
  ]);

  const [messages, setMessages] = useState<any[]>([]);
  const [storeProjectKey, setStoreProjectKey] = useState<string>('default');

  const addLog = (type: string, msg: string) => {
    setLogs(prev => {
      if (prev.length > 0 && prev[prev.length - 1].msg === msg) return prev;
      return [...prev.slice(-(logRetention - 1)), { id: Date.now(), type, msg }];
    });
  };

  const fetchStats = async () => {
    const liveStats = await (ipc as any).invoke('get-project-stats');
    if (liveStats && !liveStats.error) setStats(liveStats);
    
    const sysUsage = await (ipc as any).invoke('get-system-usage');
    if (sysUsage) setUsage(sysUsage);

    const tokens = await (ipc as any).invoke('get-token-usage');
    if (tokens) setTokenUsage(tokens);

    const mcpData = await (ipc as any).invoke('mcp:global-list');
    if (mcpData.success && mcpData.data) {
      const lines = mcpData.data.split('\n').filter((l: string) => 
        (l.includes('●') || l.includes('○') || l.includes('✗') || l.includes(':')) &&
        !l.includes('automated checks disabled')
        );
      setMcpServers(lines.map((l: string) => ({ 
        name: l.trim(), 
        status: l.includes('●') ? 'online' : 'offline' 
      })));
    }

    const snapshot = await (ipc as any).invoke('load-context-snapshot');
    if (snapshot) setLastSnapshot(snapshot);

    // Load skill engine data
    const skillData = await (ipc as any).invoke('skills-get-all').catch(() => null);
    if (skillData) {
      const loaded = skillData.skills || [];
      setSkills(loaded);
      setSkillStats(skillData.stats || {});
      setSkillEfficiency(skillData.efficiency || 0);
      setInstalledSkillIds(new Set(loaded.map((s: any) => s.id)));
    }
  };

  // Load persisted chat history from ImiStore (instant, no API calls)
  const loadChatHistory = async (projectKey?: string) => {
    try {
      const key = projectKey || storeProjectKey;
      const saved = await (ipc as any).invoke('store-get-messages', key);
      if (saved && saved.length > 0) {
        setMessages(saved.map((m: any) => ({ ...m, isStreaming: false })));
      }
    } catch(e) {}
  };

  const loadConfig = async () => {
    const config = await (ipc as any).invoke('get-api-config');
    if (config) {
      setGeminiKey((config.geminiKey || '').trim());
      setGithubToken((config.githubToken || '').trim());
      setOpenaiKey((config.openaiKey || '').trim());
      setClaudeKey((config.claudeKey || '').trim());
      setDeepseekKey((config.deepseekKey || '').trim());
      setMistralKey((config.mistralKey || '').trim());
      setLlamaKey((config.llamaKey || '').trim());
      setPerplexityKey((config.perplexityKey || '').trim());
      setCustomApiKey((config.customApiKey || '').trim());
      setCustomApiUrl((config.customApiUrl || '').trim());
      setCustomApiModel((config.customApiModel || '').trim());
      setJulesApiKey((config.julesApiKey || '').trim());
      setGoogleMapsKey((config.googleMapsKey || '').trim());
      setProjectRootInput(config.projectRoot || '');
      if (config.theme) setTheme(config.theme);
      if (config.logRetention) setLogRetention(config.logRetention);
      if (config.syncFrequency) setSyncFrequency(config.syncFrequency);
      if (config.brainTemperature !== undefined) setBrainTemperature(config.brainTemperature);
      if (config.brainMaxTokens !== undefined) setBrainMaxTokens(config.brainMaxTokens);
      if (config.brainModel) setBrainModel(config.brainModel);
      if (config.strategyVersion) setStrategyVersion(config.strategyVersion);
      if (config.activeBrain) setActiveDirector(config.activeBrain);
      if (config.activeCoder) setActiveEngine(config.activeCoder);
      // Set project key for storage scoping, then load history
      const projKey = config.projectRoot || 'default';
      setStoreProjectKey(projKey);
      loadChatHistory(projKey);
    }
  };

  const handleExport = async () => {
    setIsExporting(true);
    addLog('system', 'Initiating Workspace Export... scanning files.');
    try {
      const result = await (ipc as any).invoke('export-workspace');
      if (result && result.success) {
        addLog('system', `Export complete: ${result.path}`);
        alert(`Workspace exported successfully to:\n${result.path}`);
      }
    } catch(e) {}
    setIsExporting(false);
  };

  const updateMcpList = async () => {
    const mcpData = await (ipc as any).invoke('mcp:global-list');
    if (mcpData.success && mcpData.data) {
      const lines = mcpData.data.split('\n').filter((l: string) => l.trim().length > 0);
      setMcpServers(lines.map((l: string) => ({
        // Strip bullet prefix (● / ○ / ✗) so delete calls match stored names exactly
        name: l.trim().replace(/^[●○✗]\s*/, ''),
        status: l.includes('●') ? 'online' : 'offline'
      })));
    } else if (mcpData.success && !mcpData.data) {
      setMcpServers([]);
    }
  };

  const updateRoot = async () => {
    const result = await (ipc as any).invoke('set-project-root', projectRootInput);
    if (result.success) {
      // Auto-save config when root is updated to ensure persistence
      await saveConfig();
      alert('Project Root Updated & Saved!');
      fetchStats();
    } else {
      alert('Error: ' + result.error);
    }
  };

  const saveConfig = async (overrides: any = {}) => {
    setIsSaving(true);
    await (ipc as any).invoke('save-api-config', { 
      geminiKey, githubToken, 
      openaiKey, claudeKey, deepseekKey, mistralKey, llamaKey, perplexityKey,
      customApiKey, customApiUrl, customApiModel, julesApiKey, googleMapsKey, 
      activeBrain: activeDirector,
      activeCoder: activeEngine,
      projectRoot: projectRootInput,
      theme,
      logRetention,
      syncFrequency,
      brainTemperature,
      brainMaxTokens,
      brainModel,
      strategyVersion,
      ...overrides
    });
    setTimeout(() => setIsSaving(false), 2000);
  };
  const connectMCPServer = async () => {
    if (!newServer.name || !newServer.command) return;
    const { name, command, args, env } = newServer;
    addLog('system', `Linking ${name}...`);
    await (ipc as any).invoke('mcp:global-remove', name);
    const finalArgs = typeof args === 'string' ? args.split(' ').filter(a => a) : args;
    const result = await (ipc as any).invoke('mcp:global-add', { name, command, args: finalArgs, env });
    if (result.success) {
      addLog('system', `${name} is now linked and synced!`);
      await updateMcpList();
      setNewServer({ name: '', command: '', args: '', env: {} });
      fetchStats();
    } else {
      alert('Link Failed: ' + result.error);
    }
  };

  const handleMicClick = async () => {
    if (isListening && mediaRecorder) {
      mediaRecorder.stop();
      setIsListening(false);
      setMediaRecorder(null);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      const audioChunks: BlobPart[] = [];
      
      let isSpeaking = false;
      let silenceStart = Date.now();
      let hasFinished = false;

      // VAD (Voice Activity Detection) Pipeline
      const audioContext = new AudioContext();
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.minDecibels = -70;
      analyser.fftSize = 256;
      source.connect(analyser);
      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      const checkInterval = setInterval(() => {
        if (hasFinished) return;
        analyser.getByteFrequencyData(dataArray);
        const average = dataArray.reduce((acc, val) => acc + val, 0) / dataArray.length;
        
        if (average > 15) { // User is currently speaking
           isSpeaking = true;
           silenceStart = Date.now();
        } else if (isSpeaking) {
           // User was speaking, now there is silence
           if (Date.now() - silenceStart > 1800) { // 1.8 seconds of silence
             hasFinished = true;
             clearInterval(checkInterval);
             try { audioContext.close(); } catch(e){}
             if (recorder.state === 'recording') recorder.stop();
           }
        }
      }, 100);

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunks.push(e.data);
      };

      recorder.onstop = async () => {
        hasFinished = true;
        clearInterval(checkInterval);
        try { audioContext.close(); } catch(e){}
        stream.getTracks().forEach(track => track.stop());
        setIsListening(false);
        const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
        
        const reader = new FileReader();
        reader.readAsDataURL(audioBlob);
        reader.onloadend = async () => {
          const base64Audio = (reader.result as string).split(',')[1];
          setChatInput(prev => (prev ? prev + ' ' : '') + '[Transcribing...]');
          try {
            const result = await (ipc as any).invoke('transcribe-audio', base64Audio);
            setChatInput(prev => prev.replace('[Transcribing...]', '').trim() + (result.success ? ' ' + result.text : ''));
            if (!result.success) alert('Transcription error: ' + result.error);
          } catch(e) {
            setChatInput(prev => prev.replace('[Transcribing...]', '').trim());
            alert('Audio transcription failed.');
          }
        };
      };

      recorder.start();
      setMediaRecorder(recorder);
      setIsListening(true);
    } catch (e) {
      console.error('Mic error:', e);
      alert('Could not access microphone. Check your permissions.');
      setIsListening(false);
    }
  };

  const handleSendMessage = async () => {
    if (!chatInput.trim()) return;
    const messageId = Date.now();
    const newUserMsg = { id: messageId, type: 'user', text: chatInput };
    setMessages(prev => [...prev, newUserMsg]);
    // Persist user message immediately
    (ipc as any).invoke('store-append-message', storeProjectKey, newUserMsg).catch(() => {});
    setChatInput('');
    setIsSyncing(true);
    
    const aiId = messageId + 1;
    const aiResponse = { 
      id: aiId, 
      type: 'ai', 
      director: activeDirector,
      text: '',
      isStreaming: true
    };
    setMessages(prev => [...prev, aiResponse]);

    addLog('ag', `Broadcasting Stream: ${activeDirector} (Brain) -> ${activeEngine} (Coder)`);
    
    if (snapshotMode) {
      await (ipc as any).invoke('save-context-snapshot', {
        lastQuery: newUserMsg.text,
        activeDirector,
        activeEngine,
        status: 'Handing over to implementation engine'
      });
    }

    (ipc as any).send('execute-command-stream', { 
      command: newUserMsg.text, 
      director: activeDirector,
      engine: activeEngine,
      messageId: aiId
    });
  };

  useEffect(() => {
    loadConfig();
    fetchStats();
    setTimeout(loadTools, 2000); // defer tool scan — avoids blocking main process during startup paint
    setTimeout(loadOllamaModels, 1500); // load installed models so Coder dropdown is populated on startup
    // 🚀 [BALANCED PERF]
    const statsInterval = setInterval(fetchStats, 60000); // Heavy disk scan: 1 min
    const telemetryInterval = setInterval(async () => {
      const sysUsage = await (ipc as any).invoke('get-system-usage');
      if (sysUsage) {
        setUsage(sysUsage);
        setQuota(parseFloat(sysUsage.cpu));
      }
    }, 3000); // Light CPU telemetry: 3 seconds
    
    const onChunk = (event: any, data: any) => {
      setMessages(prev => prev.map(m => 
        m.id === data.messageId ? { ...m, text: m.text + data.chunk } : m
      ));
    };
    
    const onEnd = (event: any, data: any) => {
      setMessages(prev => {
        const updated = prev.map(m =>
          m.id === data.messageId ? { ...m, isStreaming: false } : m
        );
        // Persist completed AI message to store
        const finished = updated.find(m => m.id === data.messageId);
        if (finished) {
          (ipc as any).invoke('store-append-message', storeProjectKey, finished).catch(() => {});
        }
        return updated;
      });
      setIsSyncing(false);
      fetchStats();
    };

    const onError = (event: any, data: any) => {
      setMessages(prev => prev.map(m => 
        m.id === data.messageId ? { ...m, text: m.text + '\n[ERROR] ' + data.error, isStreaming: false } : m
      ));
      setIsSyncing(false);
    };

    ipc.on('command-chunk', onChunk);
    ipc.on('command-end', onEnd);
    ipc.on('command-error', onError);
    ipc.on('ollama-pull-progress', (_: any, data: any) => {
      // Keep raw log for debugging
      setOllamaLog(prev => ({ ...prev, [data.model]: (prev[data.model] || '') + data.chunk }));
      // Parse into structured progress for the UI
      const lines = ((data.chunk as string) || '').split('\n');
      for (const line of lines.reverse()) {
        const parsed = parseOllamaProgress(line);
        if (parsed) {
          setOllamaPullProgress(prev => ({ ...prev, [data.model]: parsed }));
          break;
        }
      }
    });

    ipc.on('sync-status', (_: any, status: string) => {
      setSyncStatus(status);
      addLog('system', `Sync: ${status}`);
    });

    ipc.on('sync-end', () => {
      setSyncStatus('Idle');
    });

    ipc.on('sync-time', (_: any, time: string) => {
      setLastSyncTime(time);
    });

    ipc.on('coder-status', (_: any, status: string) => {
      setCoderStatus(status);
      if (status !== 'Idle') addLog('system', `Coder: ${status}`);
    });

    return () => {
      clearInterval(statsInterval);
      clearInterval(telemetryInterval);
      ipc.removeAllListeners('command-chunk');
      ipc.removeAllListeners('command-end');
      ipc.removeAllListeners('command-error');
      ipc.removeAllListeners('sync-status');
      ipc.removeAllListeners('sync-end');
      ipc.removeAllListeners('coder-status');
    };
  }, []);

  useEffect(() => {
    document.body.className = theme === 'glass' ? '' : `theme-${theme}`;
  }, [theme]);

  // Auto-refresh installed models whenever AI Models tab is opened
  useEffect(() => {
    if (activeTab === 'tools' && mcpHubTab === 'ai') {
      loadOllamaModels();
    }
  }, [activeTab, mcpHubTab]);

  const renderContent = (text: string) => {
    if (!text) return null;

    // Detect clarification response — starts with ❓ and has bullet options (•)
    const isClarification = text.includes('❓') && text.includes('•');
    if (isClarification) {
      const lines = text.split('\n');
      const headerLines: string[] = [];
      const options: string[] = [];
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('•')) {
          options.push(trimmed.replace(/^•\s*/, ''));
        } else if (trimmed) {
          headerLines.push(trimmed);
        }
      }
      return (
        <div>
          {headerLines.map((l, i) => (
            <p key={i} style={{ marginBottom: '0.6rem', color: 'white', fontWeight: i === 0 ? 700 : 400 }}>{l}</p>
          ))}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '12px' }}>
            {options.map((opt, i) => (
              <button
                key={i}
                onPointerDown={e => {
                  e.preventDefault();
                  setChatInput(opt);
                  setTimeout(() => {
                    const el = document.querySelector('input[data-main]') as HTMLInputElement;
                    if (el) el.focus();
                  }, 50);
                }}
                style={{
                  textAlign: 'left', padding: '10px 14px', background: 'rgba(155,77,255,0.1)',
                  border: '1px solid rgba(155,77,255,0.3)', borderRadius: '10px',
                  color: 'white', cursor: 'pointer', fontSize: '0.82rem', fontWeight: 500,
                  transition: 'all 0.15s', display: 'flex', alignItems: 'center', gap: '8px'
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(155,77,255,0.22)'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(155,77,255,0.6)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(155,77,255,0.1)'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(155,77,255,0.3)'; }}
              >
                <span style={{ fontSize: '0.7rem', opacity: 0.5, flexShrink: 0 }}>→</span>
                {opt}
              </button>
            ))}
          </div>
        </div>
      );
    }

    // ── Rich markdown-style rendering ──────────────────────────────────────
    const renderInline = (raw: string): React.ReactNode[] => {
      // Split on `code`, **bold**, and →
      const parts = raw.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
      return parts.map((part, j) => {
        if (part.startsWith('`') && part.endsWith('`')) {
          return <code key={j} style={{ background: 'rgba(0,255,136,0.1)', color: '#00ff88', padding: '1px 6px', borderRadius: '4px', fontSize: '0.82em', fontFamily: 'monospace' }}>{part.slice(1,-1)}</code>;
        }
        if (part.startsWith('**') && part.endsWith('**')) {
          return <strong key={j} style={{ color: 'white', fontWeight: 800 }}>{part.slice(2,-2)}</strong>;
        }
        // Highlight → arrows
        return <span key={j}>{part.split('→').map((seg, k, arr) => k < arr.length - 1 ? [seg, <span key={k} style={{ color: 'var(--primary)', fontWeight: 700, margin: '0 3px' }}>→</span>] : seg)}</span>;
      });
    };

    const lines = text.split('\n');
    const nodes: React.ReactNode[] = [];
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      const trimmed = line.trim();

      // Blank line → spacer
      if (!trimmed) { nodes.push(<div key={i} style={{ height: '0.5rem' }} />); i++; continue; }

      // ## Heading or line ending with : (section header)
      if (/^#{1,3}\s/.test(trimmed) || /^[A-Z][^a-z\n]{2,}:$/.test(trimmed)) {
        const label = trimmed.replace(/^#{1,3}\s+/, '').replace(/:$/, '');
        nodes.push(<div key={i} style={{ fontWeight: 900, fontSize: '0.82rem', color: 'var(--primary)', letterSpacing: '0.05em', marginTop: '0.9rem', marginBottom: '0.3rem', borderBottom: '1px solid rgba(155,77,255,0.2)', paddingBottom: '3px' }}>{label}</div>);
        i++; continue;
      }

      // Bold header pattern: **Title** or "Title:" at start of line
      if (/^\*\*[^*]+\*\*[:.]?$/.test(trimmed) || /^[A-Z][A-Za-z0-9 ]{2,40}:$/.test(trimmed)) {
        const label = trimmed.replace(/^\*\*|\*\*$/g, '').replace(/:$/, '');
        nodes.push(<div key={i} style={{ fontWeight: 800, fontSize: '0.83rem', color: 'white', marginTop: '0.8rem', marginBottom: '0.25rem' }}>{label}</div>);
        i++; continue;
      }

      // Bullet: - or * or • → render as dot
      if (/^[-*•]\s+/.test(trimmed)) {
        const content = trimmed.replace(/^[-*•]\s+/, '');
        nodes.push(
          <div key={i} style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', marginBottom: '4px' }}>
            <span style={{ color: 'var(--primary)', flexShrink: 0, marginTop: '1px', fontSize: '1em' }}>•</span>
            <span style={{ lineHeight: 1.55, color: 'rgba(255,255,255,0.82)' }}>{renderInline(content)}</span>
          </div>
        );
        i++; continue;
      }

      // Numbered list: 1. 2. etc
      if (/^\d+\.\s+/.test(trimmed)) {
        const num = trimmed.match(/^(\d+)\./)?.[1];
        const content = trimmed.replace(/^\d+\.\s+/, '');
        nodes.push(
          <div key={i} style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', marginBottom: '4px' }}>
            <span style={{ color: 'var(--primary)', flexShrink: 0, fontWeight: 700, minWidth: '16px', textAlign: 'right' }}>{num}.</span>
            <span style={{ lineHeight: 1.55, color: 'rgba(255,255,255,0.82)' }}>{renderInline(content)}</span>
          </div>
        );
        i++; continue;
      }

      // Normal paragraph
      nodes.push(<p key={i} style={{ marginBottom: '0.45rem', lineHeight: 1.6, color: 'rgba(255,255,255,0.85)' }}>{renderInline(trimmed)}</p>);
      i++;
    }
    return <div>{nodes}</div>;
  };

  return (
    <div className="dashboard-container">
      <div className="title-bar">
        <div className="window-controls">
          <button onClick={() => (ipc as any).send('window-minimize')} className="control-btn"><Minus size={14}/></button>
          <button onClick={() => (ipc as any).send('window-maximize')} className="control-btn"><Maximize2 size={14}/></button>
          <button onClick={() => (ipc as any).send('window-close')} className="control-btn close"><X size={14}/></button>
        </div>
      </div>
      <div className="sidebar">
        <div style={{ display: 'flex', alignItems: 'center', gap: '15px', marginBottom: '1rem' }}>
          <div style={{ 
            width: '45px', height: '45px', background: 'var(--primary)', 
            borderRadius: '12px', display: 'flex', alignItems: 'center', 
            justifyContent: 'center', boxShadow: '0 0 20px var(--primary-glow)' 
          }}>
            <Zap size={24} color="#fff" />
          </div>
          <h1 style={{ fontSize: '1.4rem', fontWeight: 900, letterSpacing: '-0.02em' }}>IMI <span style={{ color: 'var(--primary)' }}>SYNC</span></h1>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <button onClick={() => setActiveTab('dashboard')} className={`sidebar-btn ${activeTab === 'dashboard' ? 'active' : ''}`}><Activity size={18}/> Dashboard</button>
          <button onClick={() => setActiveTab('command center')} className={`sidebar-btn ${activeTab === 'command center' ? 'active' : ''}`}><TerminalIcon size={18}/> Command Center</button>
          <button onClick={() => setActiveTab('tools')} className={`sidebar-btn ${activeTab === 'tools' ? 'active' : ''}`}><Layers size={18}/> Dev Hub</button>
          <button onClick={() => setActiveTab('skills')} className={`sidebar-btn ${activeTab === 'skills' ? 'active' : ''}`}><Zap size={18}/> Skills</button>
          <button onClick={() => setActiveTab('settings')} className={`sidebar-btn ${activeTab === 'settings' ? 'active' : ''}`}><Settings size={18}/> System</button>
        </div>

        <div style={{ marginTop: 'auto', paddingTop: '1rem', borderTop: '1px solid var(--glass-border)' }}>
          {/* Active project root */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
            <Database size={12} style={{ color: 'var(--text-dim)', flexShrink: 0 }} />
            <span style={{ fontSize: '0.6rem', fontWeight: 900, color: 'var(--text-dim)', letterSpacing: '0.1em' }}>PROJECT ROOT</span>
          </div>
          <div
            title={stats.projectRoot || 'Not set'}
            onClick={() => setActiveTab('settings')}
            style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.5)', wordBreak: 'break-all', lineHeight: 1.4, cursor: 'pointer', padding: '6px 8px', background: 'rgba(255,255,255,0.03)', borderRadius: '8px', border: '1px solid var(--glass-border)' }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = 'white'}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.5)'}
          >
            {stats.projectRoot
              ? '📁 ' + stats.projectRoot.split(/[\\/]/).slice(-2).join('/')
              : '📁 Click to set folder'}
          </div>
          <div style={{ fontSize: '0.55rem', color: 'rgba(255,255,255,0.2)', marginTop: '8px', textAlign: 'center' }}>IMI v1.0.4</div>
        </div>
      </div>

      <div className="main-content">
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '3rem' }}>
          <div>
            <h2 className="title-gradient" style={{ fontSize: '2.2rem' }}>Unified Orchestration</h2>
            <p style={{ color: 'var(--text-dim)', fontSize: '1rem' }}>Managing Antigravity + Jules + Gemini Fleet</p>
          </div>
          <div style={{ display: 'flex', gap: '15px', alignItems: 'center' }}>
            <div className="glass-card" style={{ padding: '10px 20px', display: 'flex', alignItems: 'center', gap: '10px', borderRadius: '15px' }}>
              <div className="status-indicator status-online"></div>
              <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#00ff88' }}>SAFE MODE: ACTIVE</span>
            </div>
          </div>
        </header>

        <AnimatePresence mode="wait">
          {activeTab === 'dashboard' && (
            <motion.div key="db" initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -15 }}>
              
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '25px', marginBottom: '40px' }}>
                 <div className="glass-card" style={{ padding: '20px', border: '1px solid var(--glass-border)', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Zap size={16} color="#4facfe" />
                        <span style={{ fontWeight: 900, fontSize: '0.75rem', letterSpacing: '0.1em', opacity: 0.6 }}>BRAIN</span>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: '0.65rem', fontWeight: 900, color: '#4facfe' }}>{(tokenUsage[activeDirector] || 0).toLocaleString()} USED</div>
                        <div style={{ fontSize: '0.5rem', fontWeight: 800, color: 'var(--text-dim)', letterSpacing: '0.05em', marginTop: '2px' }}>UNLIMITED QUOTA</div>
                      </div>
                    </div>
                    <div style={{ fontSize: '1.4rem', fontWeight: 900 }}>{activeDirector.startsWith('ollama:') ? shortModelName(activeDirector.slice(7)) : activeDirector.toUpperCase()} ACTIVE</div>
                 </div>
                 <div className="glass-card" style={{ padding: '20px', border: '1px solid var(--glass-border)', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Cpu size={16} color="#00ff88" />
                        <span style={{ fontWeight: 900, fontSize: '0.75rem', letterSpacing: '0.1em', opacity: 0.6 }}>CODER</span>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: '0.65rem', fontWeight: 900, color: '#00ff88' }}>{(tokenUsage[activeEngine] || 0).toLocaleString()} USED</div>
                        <div style={{ fontSize: '0.5rem', fontWeight: 800, color: 'var(--text-dim)', letterSpacing: '0.05em', marginTop: '2px' }}>UNLIMITED QUOTA</div>
                      </div>
                    </div>
                    <div style={{ fontSize: '1.4rem', fontWeight: 900 }}>{activeEngine.toUpperCase()} CORE</div>
                 </div>
                 <div className="glass-card" style={{ padding: '20px', border: '1px solid var(--glass-border)', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <RefreshCw size={18} color="var(--primary)" />
                      <span style={{ fontWeight: 900, fontSize: '0.75rem', letterSpacing: '0.1em', opacity: 0.6 }}>CLOUD BRIDGE</span>
                    </div>
                    <div style={{ fontSize: '1.4rem', fontWeight: 900 }}>SYNCHRONIZED</div>
                 </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(300px, 1fr) 350px', gap: '25px', marginBottom: '40px' }}>
                  <div className="glass-card" style={{ padding: '2rem', position: 'relative', overflow: 'hidden', minHeight: '350px' }}>
                     <div style={{ position: 'absolute', top: 0, left: 0, width: '6px', height: '100%', background: activeEngine === 'jules' ? '#ff416c' : '#00ff88' }}></div>
                     <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                          <div style={{ fontSize: '0.75rem', fontWeight: 900, color: 'rgba(255,255,255,0.4)', letterSpacing: '0.1em' }}>MASTER ENGINE OVERSIGHT</div>
                          <h3 style={{ fontSize: '2.4rem', fontWeight: 900, marginTop: '5px' }}>{activeEngine.toUpperCase()} CORE</h3>
                        </div>
                        <div className="glass-card" style={{ padding: '10px 15px', display: 'flex', alignItems: 'center', gap: '8px', border: '1px solid #00ff8844' }}>
                          <div style={{ width: '10px', height: '10px', background: '#00ff88', borderRadius: '50%', boxShadow: '0 0 10px #00ff88' }}></div>
                          <span style={{ fontSize: '0.8rem', fontWeight: 800 }}>LIVE SYNCED</span>
                        </div>
                     </div>
                     <div style={{ marginTop: '30px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '25px' }}>
                        <div>
                           <div style={{ opacity: 0.5, fontSize: '0.7rem', fontWeight: 700, marginBottom: '10px' }}>ACTIVE SESSIONS</div>
                           <div style={{ fontSize: '1.2rem', fontWeight: 800 }}>{activeEngine === 'jules' ? 'Cloud Context Enabled' : 'Local Heartbeat Active'}</div>
                        </div>
                        <div>
                           <div style={{ opacity: 0.5, fontSize: '0.7rem', fontWeight: 700, marginBottom: '10px' }}>SYNC LATENCY</div>
                           <div style={{ fontSize: '1.2rem', fontWeight: 800 }}>{activeEngine === 'jules' ? '450ms' : '1ms'}</div>
                        </div>
                     </div>
                  </div>

                  <div className="glass-card" style={{ padding: '2rem', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                     <div>
                        <div style={{ fontSize: '0.75rem', fontWeight: 900, color: 'rgba(255,255,255,0.4)', letterSpacing: '0.1em' }}>RESOURCE TELEMETRY</div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '20px' }}>
                           <div style={{ fontWeight: 800, fontSize: '0.9rem' }}>CPU THRESHOLD</div>
                           <div style={{ color: '#00d2ff', fontWeight: 900 }}>{usage.cpu}%</div>
                        </div>
                        <div className="quota-bar" style={{ height: '8px', marginTop: '10px' }}><div className="quota-fill" style={{ width: `${usage.cpu}%`, background: 'linear-gradient(90deg, #4facfe 0%, #00f2fe 100%)' }}></div></div>
                     </div>
                     <button onClick={fetchStats} className="btn-premium" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', padding: '12px' }}>
                        <RefreshCw size={14} /> RE-SCAN
                     </button>
                  </div>
              </div>
            </motion.div>
          )}

          {activeTab === 'command center' && (
            <motion.div key="cc" className="full-height-panel" initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} style={{ display: 'grid', gridTemplateColumns: '1fr clamp(280px, 25vw, 400px)', gap: 'clamp(12px, 1.5vw, 25px)', height: 'calc(100vh - clamp(3rem, 5vw, 6rem))' }}>
              <div className="glass-card chat-interface" style={{ display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden' }}>
                <div style={{ padding: '1rem 2rem', background: 'rgba(255,255,255,0.03)', display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--glass-border)', alignItems: 'center' }}>
                  <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                    <div className="spin"><RefreshCw size={14} color="var(--primary)" /></div>
                    <span style={{ fontWeight: 800, fontSize: '0.8rem', letterSpacing: '0.05em' }}>ORCHESTRATOR BROADCAST</span>
                  </div>
                  
                  {/* Last Sync Indicator */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'rgba(0,255,136,0.05)', padding: '5px 12px', borderRadius: '8px', border: '1px solid rgba(0,255,136,0.1)' }}>
                    <ShieldCheck size={12} color="#00ff88" />
                    <span style={{ fontSize: '0.6rem', fontWeight: 900, color: '#00ff88', letterSpacing: '0.05em' }}>
                      LAST GITHUB PULSE: {lastSyncTime || 'PENDING'}
                    </span>
                  </div>
                </div>
                <div style={{ flex: 1, padding: '2rem', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '15px' }}>
                  {messages.map(m => (
                    <div key={m.id} style={{ display: 'flex', gap: '12px', justifyContent: m.type==='user'?'flex-end':'flex-start', flexDirection: 'row', alignItems: 'flex-start' }}>
                      {m.type !== 'user' && <div style={{ width: '28px', height: '28px', background: m.type==='system'?'#333':'var(--primary)', borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: '4px' }}>{m.type==='ai'?<Cpu size={14}/>:<Terminal size={14}/>}</div>}
                      <div style={{ 
                        maxWidth: '85%', padding: '10px 16px', borderRadius: '12px', 
                        background: m.type==='user'?'var(--primary)':'rgba(255,255,255,0.05)',
                        border: m.type==='user'?'none':'1px solid var(--glass-border)',
                        boxShadow: m.type==='user'?'0 4px 15px var(--primary-glow)':'none'
                      }}>
                        {m.type==='ai' && (
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                            <div style={{ fontSize: '0.65rem', fontWeight: 900, color: 'var(--primary)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                              {m.director ? (m.director.startsWith('ollama:') ? shortModelName(m.director.slice(7)).toUpperCase() : m.director.toUpperCase()) : 'SYSTEM'}
                            </div>
                            {m.isStreaming && <div className="pulse-slow" style={{ background: 'rgba(0,255,136,0.1)', color: '#00ff88', fontSize: '0.55rem', padding: '1px 6px', borderRadius: '4px', fontWeight: 800 }}>● LIVE</div>}
                          </div>
                        )}
                        <div className="chat-bubble-content" style={{ fontSize: '0.9rem', lineHeight: '1.5' }}>
                          {renderContent(m.text)}
                        </div>
                        {m.isStreaming && (
                          <div style={{ marginTop: '15px', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '10px' }}>
                            <div style={{ fontSize: '0.6rem', fontWeight: 900, marginBottom: '5px', opacity: 0.6, letterSpacing: '0.05em', color: 'var(--primary)' }}>RECEIVING DATA STREAM...</div>
                            <div className="quota-bar" style={{ height: '4px', margin: 0, background: 'rgba(255,255,255,0.05)', overflow: 'hidden' }}>
                              <motion.div 
                                initial={{ x: '-100%' }}
                                animate={{ x: '100%' }}
                                transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
                                className="quota-fill" 
                                style={{ width: '50%', background: 'var(--primary)', boxShadow: '0 0 15px var(--primary)' }} 
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                <div style={{ padding: '1rem', borderTop: '1px solid var(--glass-border)', background: 'rgba(0,0,0,0.2)' }}>
                    <form onSubmit={e => {e.preventDefault(); handleSendMessage();}} style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      <div style={{ flex: 1, display: 'flex', alignItems: 'center', background: 'rgba(0,0,0,0.3)', border: '1px solid var(--glass-border)', borderRadius: '12px', overflow: 'visible' }}>
                        
                        {/* BRAIN */}
                        <div style={{ position: 'relative' }}>
                          <div onClick={() => { setIsDropdownOpen(!isDropdownOpen); setIsCoderDropdownOpen(false); }} style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '120px', padding: '0 12px', background: 'rgba(155, 77, 255, 0.1)', borderRight: '1px solid var(--glass-border)', color: 'var(--primary)', fontWeight: 900, fontSize: '0.6rem', textTransform: 'uppercase', height: '40px', cursor: 'pointer' }}>
                            <div style={{ position: 'absolute', top: '-18px', left: '0px', width: '100%', textAlign: 'center', fontSize: '0.65rem', fontWeight: 900, color: 'var(--primary)', letterSpacing: '0.1em', textShadow: '0 0 10px var(--primary-glow)' }}>BRAIN</div>
                            {activeDirector === 'gemini' && <Zap size={12} />}
                            {activeDirector === 'geminicli' && <Terminal size={12} />}
                            {activeDirector === 'jules' && <Layers size={12} />}
                            {activeDirector === 'antigravity' && <Cpu size={12} />}
                            {activeDirector === 'chatgpt' && <MessageSquare size={12} />}
                            {activeDirector === 'claude' && <ShieldCheck size={12} />}
                            {activeDirector === 'mistral' && <Activity size={12} />}
                            {activeDirector === 'llama' && <Database size={12} />}
                            {activeDirector === 'perplexity' && <Search size={12} />}
                            {activeDirector === 'deepseek' && <Terminal size={12} />}
                            {activeDirector === 'custom' && <Wifi size={12} />}
                            {activeDirector.startsWith('ollama:') && <Database size={12} style={{ color: '#00ff88' }} />}
                            <span style={{ flex: 1, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {activeDirector.startsWith('ollama:') ? shortModelName(activeDirector.slice(7)) : activeDirector === 'antigravity' ? 'AG AI' : activeDirector.toUpperCase()}
                            </span>
                            <ChevronRight size={12} style={{ transform: isDropdownOpen ? 'rotate(-90deg)' : 'rotate(90deg)' }} />
                          </div>
                          <AnimatePresence>
                            {isDropdownOpen && (
                              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }} style={{ position: 'absolute', bottom: 'calc(100% + 15px)', left: 0, width: '200px', background: 'rgba(20, 20, 30, 0.98)', border: '1px solid var(--glass-border)', borderRadius: '12px', zIndex: 100, overflowY: 'auto', maxHeight: '320px' }}>
                                <div style={{ padding: '8px 14px 6px', fontSize: '0.55rem', fontWeight: 900, color: 'var(--text-dim)', letterSpacing: '0.12em', borderBottom: '1px solid var(--glass-border)' }}>BRAIN MODEL</div>
                                {[
                                  // Always shown — Gemini API just needs the key in settings
                                  { id: 'gemini',     name: 'Gemini API',  icon: <Zap size={12}/>,           always: true },
                                  // Only show if API key is saved and non-empty
                                  { id: 'chatgpt',    name: 'ChatGPT',     icon: <MessageSquare size={12}/>, always: false, key: openaiKey?.trim() },
                                  { id: 'claude',     name: 'Claude',      icon: <ShieldCheck size={12}/>,   always: false, key: claudeKey?.trim() },
                                  { id: 'mistral',    name: 'Mistral',     icon: <Activity size={12}/>,      always: false, key: mistralKey?.trim() },
                                  { id: 'llama',      name: 'Llama 3',     icon: <Database size={12}/>,      always: false, key: llamaKey?.trim() },
                                  { id: 'perplexity', name: 'Perplexity',  icon: <Search size={12}/>,        always: false, key: perplexityKey?.trim() },
                                  { id: 'deepseek',   name: 'DeepSeek',    icon: <Terminal size={12}/>,      always: false, key: deepseekKey?.trim() },
                                  { id: 'jules',      name: 'Jules',       icon: <Layers size={12}/>,        always: false, key: (julesApiKey || githubToken)?.trim() },
                                  { id: 'custom',     name: 'Custom API',  icon: <Wifi size={12}/>,          always: false, key: (customApiKey?.trim() && customApiUrl?.trim()) ? 'set' : '' },
                                ].filter(opt => opt.always || (opt.key && opt.key.length > 0))
                                 .map(opt => (
                                  <div key={opt.id} onClick={() => { setActiveDirector(opt.id); setIsDropdownOpen(false); addLog('system', `Brain set to ${opt.name}`); saveConfig({ activeBrain: opt.id }); }}
                                    style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 14px', color: activeDirector === opt.id ? 'var(--primary)' : '#fff', fontSize: '0.72rem', cursor: 'pointer', background: activeDirector === opt.id ? 'rgba(155,77,255,0.12)' : 'transparent', fontWeight: activeDirector === opt.id ? 900 : 400 }}
                                    onMouseEnter={e => { if (activeDirector !== opt.id) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.05)'; }}
                                    onMouseLeave={e => { if (activeDirector !== opt.id) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                                  >
                                    {opt.icon}
                                    {opt.name}
                                    {activeDirector === opt.id && <span style={{ marginLeft: 'auto', fontSize: '0.5rem', color: 'var(--primary)' }}>●</span>}
                                  </div>
                                ))}
                                {/* Local Ollama models as Brain */}
                                {ollamaModels.length > 0 && <>
                                  <div style={{ padding: '5px 14px 3px', fontSize: '0.5rem', fontWeight: 900, color: '#00ff88', letterSpacing: '0.12em', borderTop: '1px solid var(--glass-border)', opacity: 0.7 }}>LOCAL MODELS</div>
                                  {ollamaModels.map(m => {
                                    const id = `ollama:${m.name}`;
                                    const label = shortModelName(m.name);
                                    return (
                                      <div key={id}
                                        onClick={() => { if (m.tooLarge) { alert(`⚠️ "${label}" is too large for your GPU (${m.vramGB?.toFixed(0)}GB VRAM).\n\nThis model won't respond. Delete it and pull a smaller one like qwen2.5-coder:7b.`); return; } setActiveDirector(id); setIsDropdownOpen(false); addLog('system', `Brain set to ${label} (local)`); saveConfig({ activeBrain: id }); }}
                                        style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 14px', color: m.tooLarge ? '#ff416c' : activeDirector === id ? '#00ff88' : '#fff', fontSize: '0.72rem', cursor: m.tooLarge ? 'not-allowed' : 'pointer', background: activeDirector === id ? 'rgba(0,255,136,0.1)' : 'transparent', opacity: m.tooLarge ? 0.7 : 1, fontWeight: activeDirector === id ? 900 : 400 }}
                                        onMouseEnter={e => { if (activeDirector !== id && !m.tooLarge) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.05)'; }}
                                        onMouseLeave={e => { if (activeDirector !== id) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                                      >
                                        <Database size={12} style={{ color: m.tooLarge ? '#ff416c' : '#00ff88', flexShrink: 0 }} />
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                          <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</div>
                                          <div style={{ fontSize: '0.55rem', display: 'flex', gap: '6px', alignItems: 'center' }}>
                                            <span style={{ color: m.tooLarge ? '#ff416c' : 'var(--text-dim)' }}>Local · {m.size}</span>
                                            <span style={{ color: m.tooLarge ? '#ff416c' : '#00ff88', fontWeight: 900 }}>{m.tooLarge ? "⚠️ Can't Run" : '✅ Ready'}</span>
                                          </div>
                                        </div>
                                        {activeDirector === id && !m.tooLarge && <span style={{ fontSize: '0.5rem', color: '#00ff88' }}>●</span>}
                                      </div>
                                    );
                                  })}
                                </>}
                                <div style={{ padding: '8px 14px', fontSize: '0.58rem', color: 'var(--text-dim)', borderTop: '1px solid var(--glass-border)', cursor: 'pointer' }}
                                  onClick={() => { setIsDropdownOpen(false); setActiveTab('settings'); setSettingsActiveSubTab('apis'); }}>
                                  + Add model keys in Settings →
                                </div>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>

                        {/* CODER */}
                        <div style={{ position: 'relative' }}>
                          <div onClick={() => { setIsCoderDropdownOpen(!isCoderDropdownOpen); setIsDropdownOpen(false); }} style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '120px', padding: '0 12px', background: 'rgba(0, 255, 136, 0.05)', borderRight: '1px solid var(--glass-border)', color: '#00ff88', fontWeight: 900, fontSize: '0.6rem', textTransform: 'uppercase', height: '40px', cursor: 'pointer' }}>
                            <div style={{ position: 'absolute', top: '-18px', left: '0px', width: '100%', textAlign: 'center', fontSize: '0.65rem', fontWeight: 900, color: '#00ff88', letterSpacing: '0.1em', textShadow: '0 0 10px rgba(0,255,136,0.5)' }}>CODER</div>
                            {activeEngine === 'jules' ? <Layers size={12} /> : (activeEngine === 'antigravity' ? <Cpu size={12} /> : <Zap size={12} />)}
                            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{activeEngine.startsWith('ollama:') ? shortModelName(activeEngine.slice(7)) : activeEngine.toUpperCase()}</span>
                            <ChevronRight size={12} style={{ transform: isCoderDropdownOpen ? 'rotate(-90deg)' : 'rotate(90deg)' }} />
                          </div>
                          <AnimatePresence>
                            {isCoderDropdownOpen && (
                              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }} style={{ position: 'absolute', bottom: 'calc(100% + 15px)', left: 0, width: '200px', background: 'rgba(20, 20, 30, 0.98)', border: '1px solid var(--glass-border)', borderRadius: '12px', zIndex: 100, overflow: 'hidden' }}>
                                <div style={{ padding: '8px 14px 6px', fontSize: '0.55rem', fontWeight: 900, color: 'var(--text-dim)', letterSpacing: '0.12em', borderBottom: '1px solid var(--glass-border)' }}>CODER ENGINE</div>
                                {([
                                  // Always available
                                  { id: 'imi-core', name: 'IMI Core',    desc: 'Built-in · no setup',   icon: <Zap size={12}/>,    always: true,  key: '' },
                                  // Only show if configured
                                  { id: 'jules',    name: 'Jules',       desc: 'GitHub PR-based agent', icon: <Layers size={12}/>, always: false, key: julesApiKey || githubToken },
                                  { id: 'antigravity', name: 'AG AI',   desc: 'Antigravity engine',    icon: <Cpu size={12}/>,    always: false, key: customApiKey },
                                  // Ollama local models — show if any are installed
                                  ...ollamaModels.slice(0, 5).map(m => ({
                                    id: `ollama:${m.name}`,
                                    name: shortModelName(m.name),
                                    desc: m.tooLarge ? `⚠️ Can't Run · Too large for your GPU` : `✅ Ready · ${m.size}`,
                                    icon: <Database size={12}/>,
                                    always: true, key: '',
                                    tooLarge: m.tooLarge,
                                    vramGB: m.vramGB,
                                  })),
                                ] as { id: string; name: string; desc: string; icon: React.ReactNode; always: boolean; key: string; tooLarge?: boolean; vramGB?: number }[])
                                .filter(opt => opt.always || (opt.key && opt.key.trim()))
                                 .map(opt => (
                                  <div key={opt.id}
                                    onClick={() => { if (opt.tooLarge) { alert(`⚠️ "${opt.name}" can't run on your GPU (${opt.vramGB?.toFixed(0)}GB VRAM).\n\nDelete it in Dev Hub → AI Models and pull a smaller model.`); return; } setActiveEngine(opt.id); setIsCoderDropdownOpen(false); addLog('system', `Coder set to ${opt.name}`); saveConfig({ activeCoder: opt.id }); }}
                                    style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 14px', color: opt.tooLarge ? '#ff416c' : activeEngine === opt.id ? '#00ff88' : '#fff', fontSize: '0.72rem', cursor: opt.tooLarge ? 'not-allowed' : 'pointer', background: activeEngine === opt.id ? 'rgba(0,255,136,0.1)' : 'transparent', fontWeight: activeEngine === opt.id ? 900 : 400, opacity: opt.tooLarge ? 0.7 : 1 }}
                                    onMouseEnter={e => { if (activeEngine !== opt.id && !opt.tooLarge) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.05)'; }}
                                    onMouseLeave={e => { if (activeEngine !== opt.id) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                                  >
                                    {opt.icon}
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                      <div>{opt.name}</div>
                                      {opt.desc && <div style={{ fontSize: '0.58rem', color: opt.tooLarge ? '#ff416c' : 'var(--text-dim)', marginTop: '1px' }}>{opt.desc}</div>}
                                    </div>
                                    {activeEngine === opt.id && !opt.tooLarge && <span style={{ fontSize: '0.5rem', color: '#00ff88' }}>●</span>}
                                  </div>
                                ))}
                                {ollamaModels.length === 0 && (
                                  <div style={{ padding: '8px 14px', fontSize: '0.58rem', color: 'var(--text-dim)', borderTop: '1px solid var(--glass-border)', cursor: 'pointer' }}
                                    onClick={() => { setIsCoderDropdownOpen(false); setActiveTab('devhub'); setMcpHubTab('ai'); }}>
                                    + Pull local models in Dev Hub →
                                  </div>
                                )}
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>

                        <input data-main value={chatInput} onChange={e => setChatInput(e.target.value)} type="text" placeholder={`Message...`} style={{ flex: 1, background: 'transparent', border: 'none', padding: '0 15px', color: 'white', fontSize: '0.9rem', outline: 'none', height: '40px' }} />
                        <div onClick={handleMicClick} style={{ cursor: 'pointer', padding: '0 10px', display: 'flex', alignItems: 'center', opacity: isListening ? 1 : 0.6, color: isListening ? '#ff416c' : '#ffffff' }}>
                           <Mic size={16} className={isListening ? 'pulse-anim' : ''} />
                        </div>
                      </div>
                      <button type="submit" className="btn-chat-send" style={{ width: '40px', height: '40px' }}><Send size={16}/></button>
                      <button type="button" title="Clear chat history" onClick={async () => { setMessages([]); await (ipc as any).invoke('store-clear-messages', storeProjectKey); }} style={{ width: '40px', height: '40px', background: 'rgba(255,65,108,0.15)', border: '1px solid rgba(255,65,108,0.3)', borderRadius: '10px', color: '#ff416c', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><X size={14}/></button>
                    </form>
                </div>
              </div>

              <div className="devtools-panel">
                 <div className="devtools-header" style={{ padding: '10px 15px', background: 'rgba(255,255,255,0.02)', borderBottom: '1px solid var(--glass-border)', display: 'flex', justifyContent: 'space-between', fontSize: '0.65rem', fontWeight: 900, color: 'var(--text-dim)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span>SYS CONSOLE</span>
                      {syncStatus !== 'Idle' && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '5px', color: 'var(--primary)' }}>
                          <RefreshCw size={10} className="spin" />
                          <span style={{ fontSize: '0.55rem' }}>GIT: {syncStatus.toUpperCase()}</span>
                        </div>
                      )}
                    </div>
                    <span style={{ color: '#00ff88' }}>● BRIDGE ACTIVE</span>
                 </div>

                 {coderStatus !== 'Idle' && (
                   <div style={{ padding: '15px', background: 'rgba(0,255,136,0.05)', borderBottom: '1px solid rgba(0,255,136,0.1)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                        <span style={{ fontSize: '0.6rem', fontWeight: 900, color: '#00ff88', letterSpacing: '0.1em' }}>CODER ACTIVE</span>
                        <span style={{ fontSize: '0.55rem', fontWeight: 800, color: '#00ff88', opacity: 0.8 }}>{coderStatus.toUpperCase()}...</span>
                      </div>
                      <div className="quota-bar" style={{ height: '3px', background: 'rgba(0,255,136,0.1)', margin: 0 }}>
                        <motion.div 
                          initial={{ width: '0%' }}
                          animate={{ width: '100%' }}
                          transition={{ duration: 20, ease: "linear" }}
                          style={{ height: '100%', background: '#00ff88', boxShadow: '0 0 10px rgba(0,255,136,0.5)' }}
                        />
                      </div>
                   </div>
                 )}

                 <div className="devtools-content" style={{ height: coderStatus !== 'Idle' ? '465px' : '515px', padding: '15px', overflowY: 'auto', fontSize: '0.75rem', fontFamily: 'monospace', transition: 'height 0.3s' }}>
                    {logs.map(l => (
                      <div key={l.id} style={{ marginBottom: '6px', color: l.type === 'ag' ? '#00ff88' : (l.type === 'gemini' ? '#4facfe' : '#ffffff88') }}>
                        <span style={{ opacity: 0.4 }}>[{new Date(l.id).toLocaleTimeString()}]</span> {l.msg}
                      </div>
                    ))}
                 </div>
              </div>
            </motion.div>
          )}

          {activeTab === 'tools' && (
            <motion.div key="tools" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="glass-card full-height-panel" style={{ padding: '2rem', overflowY: 'auto' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '20px', alignItems: 'flex-end' }}>
                  <div>
                    <h3 style={{ fontSize: '1.6rem', fontWeight: 900 }}>Dev Hub</h3>
                    <p style={{ color: 'var(--text-dim)', fontSize: '0.8rem' }}>Find and connect any tool from npm or GitHub.</p>
                  </div>
                </div>

                {/* Sub-tabs */}
                <div style={{ display: 'flex', gap: '8px', marginBottom: '24px', borderBottom: '1px solid var(--glass-border)', paddingBottom: '0' }}>
                  {[
                    { id: 'mcp',    label: '📦 MCP Registry',      sub: 'npm packages' },
                    { id: 'github', label: '🐙 GitHub Libraries',  sub: 'repos & tools' },
                    { id: 'tools',  label: '🛠 Installed Tools',    sub: 'system check' },
                    { id: 'ai',     label: '🤖 AI Models',         sub: 'run locally' },
                  ].map(t => (
                    <button key={t.id} onClick={() => { setMcpHubTab(t.id as any); if (t.id === 'ai') loadOllamaModels(); }} style={{ padding: '10px 20px', background: mcpHubTab === t.id ? 'var(--primary)' : 'transparent', border: 'none', borderBottom: mcpHubTab === t.id ? '2px solid var(--primary)' : '2px solid transparent', borderRadius: '8px 8px 0 0', color: mcpHubTab === t.id ? 'white' : 'var(--text-dim)', cursor: 'pointer', fontWeight: 800, fontSize: '0.8rem', marginBottom: '-1px', transition: 'all 0.2s' }}>
                      {t.label} <span style={{ opacity: 0.6, fontSize: '0.65rem', marginLeft: '4px' }}>{t.sub}</span>
                    </button>
                  ))}
                </div>

                {mcpHubTab === 'mcp' && <>
                {/* Live npm search bar */}
                <div style={{ marginBottom: '24px' }}>
                  <form onSubmit={e => { e.preventDefault(); searchNpm(mcpSearch); }} style={{ display: 'flex', gap: '10px' }}>
                    <div style={{ position: 'relative', flex: 1 }}>
                      <Search size={16} style={{ position: 'absolute', left: '15px', top: '50%', transform: 'translateY(-50%)', opacity: 0.4 }} />
                      <input
                        value={mcpSearch}
                        onChange={e => setMcpSearch(e.target.value)}
                        placeholder="Search any MCP… e.g. 'postgres', 'slack', 'linear', 'stripe'"
                        className="chat-input"
                        style={{ width: '100%', paddingLeft: '45px', height: '48px', fontSize: '0.9rem' }}
                      />
                    </div>
                    <button type="submit" className="btn-premium" style={{ height: '48px', padding: '0 28px', fontSize: '0.75rem', whiteSpace: 'nowrap' }}>
                      {npmSearching ? '⏳ SEARCHING...' : '🔍 SEARCH NPM'}
                    </button>
                    {(npmResults.length > 0 || npmUrlPreview) && (
                      <button type="button" onClick={() => { setNpmResults([]); setMcpSearch(''); setNpmUrlPreview(null); }} style={{ height: '48px', padding: '0 16px', background: 'rgba(255,65,108,0.1)', border: '1px solid rgba(255,65,108,0.3)', borderRadius: '12px', color: '#ff416c', cursor: 'pointer', fontSize: '0.75rem' }}>CLEAR</button>
                    )}
                  </form>
                  {npmError && <p style={{ fontSize: '0.7rem', color: '#ff416c', marginTop: '8px' }}>⚠ {npmError}</p>}
                </div>

                {/* npm / GitHub URL Preview */}
                {npmUrlPreview && (() => {
                  const { type, data } = npmUrlPreview;
                  if (type === 'npm') return (
                    <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(79,172,254,0.35)', borderRadius: '16px', padding: '20px', marginBottom: '20px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
                        <span style={{ fontSize: '0.6rem', fontWeight: 900, padding: '3px 10px', borderRadius: '6px', background: 'rgba(204,0,0,0.2)', color: '#cc0000', letterSpacing: '0.1em' }}>📦 NPM PACKAGE</span>
                        <span style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>v{data.version}</span>
                        {data.license && <span style={{ fontSize: '0.6rem', color: 'var(--text-dim)', opacity: 0.6 }}>📜 {data.license}</span>}
                      </div>
                      <div style={{ fontSize: '1rem', fontWeight: 800, marginBottom: '8px' }}>{data.name}</div>
                      {data.description && <p style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.55)', lineHeight: 1.6, marginBottom: '12px' }}>{data.description}</p>}
                      {data.author && <div style={{ fontSize: '0.68rem', color: 'var(--text-dim)', marginBottom: '10px' }}>👤 {data.author}</div>}
                      {data.keywords?.length > 0 && <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '12px' }}>{data.keywords.slice(0,6).map((k: string) => <span key={k} style={{ fontSize: '0.55rem', padding: '2px 7px', background: 'rgba(79,172,254,0.08)', border: '1px solid rgba(79,172,254,0.2)', borderRadius: '4px', color: '#4facfe' }}>{k}</span>)}</div>}
                      {data.readme && <p style={{ fontSize: '0.68rem', color: 'rgba(255,255,255,0.35)', lineHeight: 1.5, marginBottom: '14px', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' as any, overflow: 'hidden' }}>{data.readme}</p>}
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button onClick={() => (ipc as any).send('open-external-url', data.npmUrl)} style={{ height: '34px', padding: '0 16px', background: 'rgba(204,0,0,0.12)', border: '1px solid rgba(204,0,0,0.35)', borderRadius: '8px', color: '#cc0000', cursor: 'pointer', fontSize: '0.7rem', fontWeight: 700 }}>📦 View on npm</button>
                        {data.repoUrl && <button onClick={() => (ipc as any).send('open-external-url', data.repoUrl)} style={{ height: '34px', padding: '0 16px', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--glass-border)', borderRadius: '8px', color: 'white', cursor: 'pointer', fontSize: '0.7rem', fontWeight: 700 }}>🐙 GitHub Repo</button>}
                        <button onClick={() => { setNpmUrlPreview(null); setMcpSearch(''); }} style={{ height: '34px', padding: '0 14px', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--glass-border)', borderRadius: '8px', color: 'var(--text-dim)', cursor: 'pointer', fontSize: '0.7rem' }}>✕ Close</button>
                      </div>
                    </div>
                  );
                  // GitHub result shown in MCP tab
                  if (type === 'repo' || type === 'pr' || type === 'issue') {
                    const stateColor = data.state === 'open' ? '#3fb950' : data.merged ? '#a371f7' : '#f85149';
                    const stateLabel = data.merged ? '✅ Merged' : data.draft ? '🔲 Draft' : data.state === 'open' ? '🟢 Open' : '🔴 Closed';
                    const tAgo = (iso: string) => { const d = Math.floor((Date.now() - new Date(iso).getTime())/86400000); return d===0?'today':d===1?'yesterday':`${d}d ago`; };
                    return (
                      <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(155,77,255,0.35)', borderRadius: '16px', padding: '20px', marginBottom: '20px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
                          <span style={{ fontSize: '0.6rem', fontWeight: 900, padding: '3px 10px', borderRadius: '6px', background: type==='pr'?'rgba(163,113,247,0.2)':type==='issue'?'rgba(248,81,73,0.2)':'rgba(79,172,254,0.2)', color: type==='pr'?'#a371f7':type==='issue'?'#f85149':'#4facfe', letterSpacing: '0.1em', textTransform: 'uppercase' }}>{type==='pr'?'⎇ Pull Request':type==='issue'?'🐞 Issue':'📦 Repository'}</span>
                          <span style={{ fontSize: '0.7rem', color: 'var(--text-dim)', fontWeight: 700 }}>{data.repoName||data.name}</span>
                          {(type==='pr'||type==='issue') && <span style={{ marginLeft:'auto', fontSize:'0.7rem', fontWeight:800, color: stateColor }}>{stateLabel}</span>}
                        </div>
                        <div style={{ fontSize: '1rem', fontWeight: 800, marginBottom: '10px' }}>{(type==='pr'||type==='issue')?`#${data.number} — ${data.title}`:data.description||data.name}</div>
                        {data.author && <div style={{ display:'flex', alignItems:'center', gap:'8px', marginBottom:'12px' }}>{data.authorAvatar&&<img src={data.authorAvatar} alt="" style={{ width:'20px', height:'20px', borderRadius:'50%' }}/>}<span style={{ fontSize:'0.7rem', color:'var(--text-dim)' }}>by <b style={{color:'white'}}>{data.author}</b> · {tAgo(data.createdAt)}</span></div>}
                        <div style={{ display:'flex', gap:'8px' }}>
                          <button onClick={() => (ipc as any).send('open-external-url', data.htmlUrl||`https://github.com/${data.name}`)} style={{ height:'34px', padding:'0 16px', background:'rgba(155,77,255,0.15)', border:'1px solid rgba(155,77,255,0.4)', borderRadius:'8px', color:'var(--primary)', cursor:'pointer', fontSize:'0.7rem', fontWeight:700 }}>🐙 Open on GitHub</button>
                          <button onClick={() => { setNpmUrlPreview(null); setMcpSearch(''); }} style={{ height:'34px', padding:'0 14px', background:'rgba(255,255,255,0.03)', border:'1px solid var(--glass-border)', borderRadius:'8px', color:'var(--text-dim)', cursor:'pointer', fontSize:'0.7rem' }}>✕ Close</button>
                        </div>
                      </div>
                    );
                  }
                  return null;
                })()}

                {/* npm Live Results */}
                {npmResults.length > 0 && (
                  <div style={{ marginBottom: '32px' }}>
                    <div style={{ fontSize: '0.7rem', fontWeight: 900, color: 'var(--primary)', letterSpacing: '0.15em', marginBottom: '14px' }}>
                      NPM RESULTS — {npmTotal} packages found
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      {npmResults.map(pkg => {
                        const isLinked = mcpServers.some(s => s.name.toLowerCase().includes(pkg.name.toLowerCase()));
                        return (
                          <div key={pkg.name} style={{ display: 'flex', alignItems: 'center', gap: '16px', padding: '14px 18px', background: isLinked ? 'rgba(155,77,255,0.06)' : 'rgba(255,255,255,0.02)', border: `1px solid ${isLinked ? 'rgba(155,77,255,0.3)' : 'var(--glass-border)'}`, borderRadius: '14px' }}>
                            <div style={{ width: '38px', height: '38px', borderRadius: '10px', background: 'linear-gradient(135deg,#9b4dff,#4facfe)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                              <Database size={18} />
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                <span style={{ fontWeight: 800, fontSize: '0.85rem' }}>{pkg.name}</span>
                                <span style={{ fontSize: '0.6rem', padding: '2px 7px', background: 'rgba(79,172,254,0.1)', border: '1px solid rgba(79,172,254,0.2)', borderRadius: '4px', color: '#4facfe' }}>v{pkg.version}</span>
                                <span style={{ fontSize: '0.6rem', color: 'var(--text-dim)' }}>by {pkg.publisher}</span>
                                {pkg.score > 60 && <span style={{ fontSize: '0.55rem', padding: '2px 6px', background: 'rgba(0,255,136,0.1)', border: '1px solid rgba(0,255,136,0.2)', borderRadius: '4px', color: '#00ff88' }}>★ {pkg.score}%</span>}
                              </div>
                              <p style={{ fontSize: '0.75rem', color: 'var(--text-dim)', marginTop: '3px', lineHeight: 1.4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pkg.description}</p>
                            </div>
                            <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
                              {pkg.npmUrl && (
                                <button onClick={() => (ipc as any).send('open-external-url', pkg.npmUrl)} style={{ height: '32px', padding: '0 12px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--glass-border)', borderRadius: '8px', color: 'var(--text-dim)', cursor: 'pointer', fontSize: '0.65rem' }}>NPM ↗</button>
                              )}
                              <button
                                onClick={async () => {
                                  const cfg = { name: pkg.name, command: 'npx', args: ['-y', pkg.name], env: {} };
                                  addLog('system', `Adding ${pkg.name}...`);
                                  const result = await (ipc as any).invoke('mcp:global-add', cfg);
                                  if (result.success) { addLog('system', `${pkg.name} added!`); updateMcpList(); }
                                }}
                                className={isLinked ? 'btn-chat-send' : 'btn-premium'}
                                style={{ height: '32px', padding: '0 16px', borderRadius: '8px', fontSize: '0.7rem' }}
                              >
                                {isLinked ? <CheckCircle2 size={14} /> : '+ ADD'}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Empty search state — prompt to search, no pre-populated cards */}
                {npmResults.length === 0 && !npmSearching && (
                  <div style={{ padding: '48px 20px', textAlign: 'center', opacity: 0.5 }}>
                    <div style={{ fontSize: '2.5rem', marginBottom: '14px' }}>📦</div>
                    <div style={{ fontSize: '0.9rem', fontWeight: 700, color: 'white', marginBottom: '8px' }}>Search the npm registry</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', lineHeight: 1.6 }}>
                      Type anything above — e.g. <code style={{ color: '#4facfe' }}>puppeteer</code>, <code style={{ color: '#4facfe' }}>postgres</code>, <code style={{ color: '#4facfe' }}>slack</code>, <code style={{ color: '#4facfe' }}>filesystem</code><br/>
                      Packages you add will appear in Linked Services below.
                    </div>
                  </div>
                )}
                {npmSearching && (
                  <div style={{ padding: '40px', textAlign: 'center', opacity: 0.5, fontSize: '0.8rem' }}>⏳ Searching npm…</div>
                )}

                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                    <span style={{ fontSize: '0.68rem', fontWeight: 900, color: 'rgba(255,255,255,0.35)', letterSpacing: '0.15em' }}>LINKED SERVICES ({mcpServers.length})</span>
                    {mcpServers.length > 4 && (
                      <button onClick={() => setLinkedServicesExpanded(p => !p)} style={{ background: 'none', border: 'none', color: 'var(--primary)', fontSize: '0.6rem', fontWeight: 900, cursor: 'pointer' }}>
                        {linkedServicesExpanded ? '▲ less' : `▼ +${mcpServers.length - 4} more`}
                      </button>
                    )}
                  </div>

                  {mcpServers.length === 0 ? (
                    <div style={{ padding: '1.2rem', textAlign: 'center', opacity: 0.3, fontSize: '0.75rem' }}>No services linked yet.</div>
                  ) : (
                    /* Compact pill-chip list */
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                      {(linkedServicesExpanded ? mcpServers : mcpServers.slice(0, 4)).map((s, i) => {
                        const pkgName = s.name.trim();
                        const npmUrl = `https://www.npmjs.com/package/${pkgName}`;
                        // Shorten long scoped names: @modelcontextprotocol/server-github → server-github
                        const shortName = pkgName.includes('/') ? pkgName.split('/').pop()! : pkgName;
                        return (
                          <div key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '4px 6px 4px 10px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '20px', maxWidth: '220px' }}>
                            <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: s.status === 'online' ? '#00ffaa' : 'rgba(255,255,255,0.2)', flexShrink: 0 }} />
                            <span title={pkgName} style={{ fontSize: '0.72rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer', color: '#ccc' }}
                              onClick={() => (ipc as any).send('open-external-url', npmUrl)}>
                              {shortName}
                            </span>
                            <button
                              title={`Remove ${pkgName}`}
                              onPointerDown={async (e) => { e.preventDefault(); e.stopPropagation(); await (ipc as any).invoke('mcp:global-remove', pkgName); updateMcpList(); }}
                              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '16px', height: '16px', borderRadius: '50%', background: 'rgba(255,65,108,0.2)', border: '1px solid rgba(255,65,108,0.35)', color: '#ff416c', cursor: 'pointer', flexShrink: 0, fontSize: '9px', fontWeight: 900, lineHeight: 1 }}
                              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,65,108,0.5)'; (e.currentTarget as HTMLElement).style.transform = 'scale(1.2)'; }}
                              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,65,108,0.2)'; (e.currentTarget as HTMLElement).style.transform = 'scale(1)'; }}
                            >✕</button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                </>}

                {/* ── GitHub Libraries Tab ── */}
                {mcpHubTab === 'github' && (
                <div>
                  {/* Search bar */}
                  <form onSubmit={e => { e.preventDefault(); searchGitHub(ghQuery); }} style={{ display: 'flex', gap: '10px', marginBottom: '16px' }}>
                    <div style={{ position: 'relative', flex: 1 }}>
                      <Search size={16} style={{ position: 'absolute', left: '15px', top: '50%', transform: 'translateY(-50%)', opacity: 0.4 }} />
                      <input value={ghQuery} onChange={e => setGhQuery(e.target.value)} placeholder="Search GitHub… e.g. 'mcp server', 'ai agent', 'electron app'" className="chat-input" style={{ width: '100%', paddingLeft: '45px', height: '48px', fontSize: '0.9rem' }} />
                    </div>
                    <select value={ghSort} onChange={e => setGhSort(e.target.value)} style={{ height: '48px', padding: '0 14px', background: 'rgba(0,0,0,0.4)', border: '1px solid var(--glass-border)', borderRadius: '12px', color: 'white', fontSize: '0.8rem', cursor: 'pointer' }}>
                      <option value="stars">⭐ Most Stars</option>
                      <option value="updated">🕐 Recently Updated</option>
                      <option value="forks">🍴 Most Forks</option>
                      <option value="help-wanted-issues">🙋 Help Wanted</option>
                    </select>
                    <button type="submit" className="btn-premium" style={{ height: '48px', padding: '0 24px', fontSize: '0.75rem', whiteSpace: 'nowrap' }}>
                      {ghSearching ? '⏳ SEARCHING...' : '🔍 SEARCH GITHUB'}
                    </button>
                    {(ghResults.length > 0 || ghUrlPreview) && <button type="button" onClick={() => { setGhResults([]); setGhQuery(''); setGhUrlPreview(null); }} style={{ height: '48px', padding: '0 14px', background: 'rgba(255,65,108,0.1)', border: '1px solid rgba(255,65,108,0.3)', borderRadius: '12px', color: '#ff416c', cursor: 'pointer', fontSize: '0.75rem' }}>CLEAR</button>}
                  </form>

                  {ghError && <p style={{ fontSize: '0.7rem', color: '#ff416c', marginBottom: '12px' }}>⚠ {ghError}{ghError.includes('rate limit') ? ' — Add a GitHub token in Settings to increase the limit.' : ''}</p>}

                  {/* ── GitHub URL Preview Card ── */}
                  {ghUrlPreview && (() => {
                    const { type, data } = ghUrlPreview;
                    const stateColor = data.state === 'open' ? '#3fb950' : data.merged ? '#a371f7' : '#f85149';
                    const stateLabel = data.merged ? '✅ Merged' : data.draft ? '🔲 Draft' : data.state === 'open' ? '🟢 Open' : '🔴 Closed';
                    const timeAgoStr = (iso: string) => { const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000); return d === 0 ? 'today' : d === 1 ? 'yesterday' : `${d}d ago`; };
                    return (
                      <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(155,77,255,0.35)', borderRadius: '16px', padding: '20px', marginBottom: '20px' }}>
                        {/* Type badge + repo name */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
                          <span style={{ fontSize: '0.6rem', fontWeight: 900, padding: '3px 10px', borderRadius: '6px', background: type === 'pr' ? 'rgba(163,113,247,0.2)' : type === 'issue' ? 'rgba(248,81,73,0.2)' : 'rgba(79,172,254,0.2)', color: type === 'pr' ? '#a371f7' : type === 'issue' ? '#f85149' : '#4facfe', letterSpacing: '0.1em', textTransform: 'uppercase' }}>{type === 'pr' ? '⎇ Pull Request' : type === 'issue' ? '🐞 Issue' : '📦 Repository'}</span>
                          <span style={{ fontSize: '0.7rem', color: 'var(--text-dim)', fontWeight: 700 }}>{data.repoName || data.name}</span>
                          {(type === 'pr' || type === 'issue') && <span style={{ marginLeft: 'auto', fontSize: '0.7rem', fontWeight: 800, color: stateColor }}>{stateLabel}</span>}
                        </div>
                        {/* Title */}
                        <div style={{ fontSize: '1rem', fontWeight: 800, marginBottom: '10px', lineHeight: 1.4 }}>
                          {(type === 'pr' || type === 'issue') ? `#${data.number} — ${data.title}` : data.description || data.name}
                        </div>
                        {/* Author + date */}
                        {data.author && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                            {data.authorAvatar && <img src={data.authorAvatar} alt="" style={{ width: '20px', height: '20px', borderRadius: '50%' }} />}
                            <span style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>by <b style={{ color: 'white' }}>{data.author}</b> · opened {timeAgoStr(data.createdAt)}{data.updatedAt !== data.createdAt ? ` · updated ${timeAgoStr(data.updatedAt)}` : ''}</span>
                          </div>
                        )}
                        {/* Labels */}
                        {data.labels?.length > 0 && (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', marginBottom: '12px' }}>
                            {data.labels.map((l: any) => <span key={l.name} style={{ fontSize: '0.6rem', padding: '2px 8px', borderRadius: '12px', background: `#${l.color}22`, border: `1px solid #${l.color}55`, color: `#${l.color}` }}>{l.name}</span>)}
                          </div>
                        )}
                        {/* PR stats */}
                        {type === 'pr' && (
                          <div style={{ display: 'flex', gap: '18px', fontSize: '0.68rem', color: 'var(--text-dim)', marginBottom: '12px', flexWrap: 'wrap' }}>
                            {data.additions != null && <span style={{ color: '#3fb950' }}>+{data.additions?.toLocaleString()}</span>}
                            {data.deletions != null && <span style={{ color: '#f85149' }}>−{data.deletions?.toLocaleString()}</span>}
                            {data.changedFiles != null && <span>📄 {data.changedFiles} files</span>}
                            {data.commits != null && <span>📦 {data.commits} commits</span>}
                            {data.comments != null && <span>💬 {data.comments} comments</span>}
                            {data.baseBranch && <span>⎇ {data.headBranch} → {data.baseBranch}</span>}
                          </div>
                        )}
                        {/* Repo stats */}
                        {type === 'repo' && (
                          <div style={{ display: 'flex', gap: '18px', fontSize: '0.68rem', color: 'var(--text-dim)', marginBottom: '12px', flexWrap: 'wrap' }}>
                            <span>⭐ {data.stars?.toLocaleString()}</span>
                            <span>🍴 {data.forks?.toLocaleString()}</span>
                            {data.language && <span>💻 {data.language}</span>}
                            {data.openIssues != null && <span>🐞 {data.openIssues} issues</span>}
                            {data.license && <span>📜 {data.license}</span>}
                          </div>
                        )}
                        {/* Body preview */}
                        {data.body && <p style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.5)', lineHeight: 1.6, marginBottom: '14px', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' as any, overflow: 'hidden' }}>{data.body}</p>}
                        {/* Actions */}
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <button onClick={() => (ipc as any).send('open-external-url', data.htmlUrl)} style={{ height: '34px', padding: '0 16px', background: 'rgba(155,77,255,0.15)', border: '1px solid rgba(155,77,255,0.4)', borderRadius: '8px', color: 'var(--primary)', cursor: 'pointer', fontSize: '0.7rem', fontWeight: 700 }}>🐙 Open on GitHub</button>
                          {type === 'repo' && <button onClick={async () => { const r = await (ipc as any).invoke('github-clone', data.cloneUrl, data.name?.split('/')[1]); if (r.success) alert(`Cloned to:\n${r.path}`); else alert(`Clone failed: ${r.error}`); }} style={{ height: '34px', padding: '0 16px', background: 'rgba(79,172,254,0.1)', border: '1px solid rgba(79,172,254,0.3)', borderRadius: '8px', color: '#4facfe', cursor: 'pointer', fontSize: '0.7rem', fontWeight: 700 }}>⬇ Clone Repo</button>}
                          <button onClick={() => { setGhUrlPreview(null); setGhQuery(''); }} style={{ height: '34px', padding: '0 14px', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--glass-border)', borderRadius: '8px', color: 'var(--text-dim)', cursor: 'pointer', fontSize: '0.7rem' }}>✕ Close</button>
                        </div>
                      </div>
                    );
                  })()}

                  {ghResults.length > 0 && (
                    <div>
                      <div style={{ fontSize: '0.65rem', fontWeight: 900, color: 'var(--primary)', letterSpacing: '0.15em', marginBottom: '14px' }}>
                        {ghTotal.toLocaleString()} REPOSITORIES FOUND
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '12px' }}>
                        {ghResults.map(repo => (
                          <div key={repo.id} style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid var(--glass-border)', borderRadius: '14px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '10px', transition: 'border-color 0.2s' }}
                            onMouseEnter={e => (e.currentTarget.style.borderColor = 'rgba(155,77,255,0.4)') }
                            onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--glass-border)') }>
                            {/* Header */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                              <img src={repo.ownerAvatar} alt="" style={{ width: '28px', height: '28px', borderRadius: '50%', flexShrink: 0 }} onError={e => { (e.target as any).style.display='none'; }} />
                              <div style={{ minWidth: 0 }}>
                                <div style={{ fontWeight: 800, fontSize: '0.85rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={repo.name}>{repo.name}</div>
                                <div style={{ fontSize: '0.6rem', color: 'var(--text-dim)' }}>updated {timeAgo(repo.updatedAt)}</div>
                              </div>
                            </div>
                            {/* Description */}
                            <p style={{ fontSize: '0.72rem', color: 'var(--text-dim)', lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as any, overflow: 'hidden' }}>{repo.description}</p>
                            {/* Topics */}
                            {repo.topics.length > 0 && (
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                                {repo.topics.slice(0, 4).map((t: string) => (
                                  <span key={t} style={{ fontSize: '0.55rem', padding: '2px 7px', background: 'rgba(79,172,254,0.08)', border: '1px solid rgba(79,172,254,0.2)', borderRadius: '4px', color: '#4facfe' }}>{t}</span>
                                ))}
                              </div>
                            )}
                            {/* Stats row */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: '14px', fontSize: '0.65rem', color: 'var(--text-dim)' }}>
                              <span>⭐ {formatStars(repo.stars)}</span>
                              <span>🍴 {formatStars(repo.forks)}</span>
                              {repo.language && <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><span style={{ width: '8px', height: '8px', borderRadius: '50%', background: langColor[repo.language] || '#888', flexShrink: 0 }}></span>{repo.language}</span>}
                              {repo.license && <span style={{ opacity: 0.6 }}>{repo.license}</span>}
                            </div>
                            {/* Action buttons */}
                            <div style={{ display: 'flex', gap: '8px', marginTop: '2px' }}>
                              <button onClick={() => (ipc as any).send('open-external-url', repo.htmlUrl)} style={{ flex: 1, height: '32px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--glass-border)', borderRadius: '8px', color: 'white', cursor: 'pointer', fontSize: '0.7rem', fontWeight: 700 }}>
                                🐙 View on GitHub
                              </button>
                              <button
                                onClick={async () => {
                                  if (cloningRepo) return;
                                  setCloningRepo(repo.id);
                                  addLog('system', `Cloning ${repo.shortName}...`);
                                  const result = await (ipc as any).invoke('github-clone', repo.cloneUrl, repo.shortName);
                                  if (result.success) {
                                    addLog('system', `✅ Cloned to ${result.path}`);
                                    alert(`Cloned to:\n${result.path}`);
                                  } else {
                                    addLog('system', `❌ Clone failed: ${result.error}`);
                                    alert(`Clone failed: ${result.error}`);
                                  }
                                  setCloningRepo('');
                                }}
                                style={{ height: '32px', padding: '0 14px', background: cloningRepo === repo.id ? 'rgba(155,77,255,0.3)' : 'rgba(155,77,255,0.1)', border: '1px solid rgba(155,77,255,0.3)', borderRadius: '8px', color: 'var(--primary)', cursor: cloningRepo ? 'wait' : 'pointer', fontSize: '0.7rem', fontWeight: 700, whiteSpace: 'nowrap' }}>
                                {cloningRepo === repo.id ? '⏳' : '⬇ Clone'}
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {ghResults.length === 0 && !ghSearching && (
                    <div style={{ padding: '4rem', textAlign: 'center', opacity: 0.3 }}>
                      <div style={{ fontSize: '3rem', marginBottom: '12px' }}>🐙</div>
                      <p style={{ fontWeight: 700, marginBottom: '6px' }}>Search GitHub Repositories</p>
                      <p style={{ fontSize: '0.75rem' }}>Find MCP servers, AI tools, libraries — anything on GitHub.</p>
                    </div>
                  )}
                </div>
                )}

                {/* ── Installed Tools Tab ── */}
                {mcpHubTab === 'tools' && (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                    <p style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>Live check of every tool IMI depends on.</p>
                    <button onClick={loadTools} className="btn-premium" style={{ height: '36px', padding: '0 18px', fontSize: '0.7rem' }}>
                      {toolsLoading ? '⏳ Checking...' : '🔄 Refresh'}
                    </button>
                  </div>
                  {toolsList.length === 0 && !toolsLoading && (
                    <div style={{ textAlign: 'center', padding: '4rem', opacity: 0.4 }}>
                      <div style={{ fontSize: '3rem', marginBottom: '12px' }}>🛠</div>
                      <p style={{ fontWeight: 700 }}>Click Refresh to scan your system</p>
                    </div>
                  )}
                  {['runtime','ai','dev','editor'].map(cat => {
                    const items = toolsList.filter(t => t.category === cat);
                    if (!items.length) return null;
                    const catLabel: Record<string,string> = { runtime:'⚙️ Runtimes', ai:'🤖 AI Tools', dev:'🔧 Dev Tools', editor:'✏️ Editors' };
                    return (
                      <div key={cat} style={{ marginBottom: '24px' }}>
                        <div style={{ fontSize: '0.65rem', fontWeight: 900, color: 'var(--primary)', letterSpacing: '0.12em', marginBottom: '10px' }}>{catLabel[cat]}</div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '10px' }}>
                          {items.map(tool => (
                            <div key={tool.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 16px', background: tool.installed ? 'rgba(0,255,136,0.04)' : 'rgba(255,65,108,0.04)', border: `1px solid ${tool.installed ? 'rgba(0,255,136,0.2)' : 'rgba(255,65,108,0.2)'}`, borderRadius: '12px' }}>
                              <span style={{ fontSize: '1.4rem' }}>{tool.icon}</span>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                  <span style={{ fontWeight: 800, fontSize: '0.85rem' }}>{tool.label}</span>
                                  {tool.installed
                                    ? <span style={{ fontSize: '0.6rem', padding: '2px 7px', background: 'rgba(0,255,136,0.1)', border: '1px solid rgba(0,255,136,0.25)', borderRadius: '4px', color: '#00ff88' }}>v{tool.version}</span>
                                    : <span style={{ fontSize: '0.6rem', padding: '2px 7px', background: 'rgba(255,65,108,0.1)', border: '1px solid rgba(255,65,108,0.25)', borderRadius: '4px', color: '#ff416c' }}>Not installed</span>
                                  }
                                </div>
                                <p style={{ fontSize: '0.65rem', color: 'var(--text-dim)', marginTop: '2px' }}>{tool.desc}</p>
                              </div>
                              {!tool.installed && (
                                <button onClick={() => (ipc as any).send('open-external-url', tool.installUrl)} style={{ flexShrink: 0, height: '28px', padding: '0 12px', background: 'rgba(155,77,255,0.15)', border: '1px solid rgba(155,77,255,0.3)', borderRadius: '7px', color: 'var(--primary)', cursor: 'pointer', fontSize: '0.65rem', fontWeight: 700 }}>Install ↗</button>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
                )}

                {/* ── AI Models Tab ── */}
                {mcpHubTab === 'ai' && (
                <div>
                  {/* Installed models */}
                  <div style={{ marginBottom: '28px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                      <div style={{ fontSize: '0.65rem', fontWeight: 900, color: 'var(--primary)', letterSpacing: '0.12em' }}>INSTALLED MODELS</div>
                      <button onClick={loadOllamaModels} style={{ height: '28px', padding: '0 12px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--glass-border)', borderRadius: '7px', color: 'white', cursor: 'pointer', fontSize: '0.65rem' }}>🔄 Refresh</button>
                    </div>
                    {ollamaModels.length === 0
                      ? <div style={{ padding: '1.5rem', background: 'rgba(255,65,108,0.04)', border: '1px solid rgba(255,65,108,0.15)', borderRadius: '12px', fontSize: '0.75rem', color: 'var(--text-dim)' }}>
                          No models installed yet. Pull one from the library below. <span style={{ color: '#ff416c' }}>Ollama must be installed first.</span>
                        </div>
                      : <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          {ollamaModels.map(m => (
                            <div key={m.name} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 16px', background: m.tooLarge ? 'rgba(255,65,108,0.04)' : 'rgba(0,255,136,0.04)', border: `1px solid ${m.tooLarge ? 'rgba(255,65,108,0.25)' : 'rgba(0,255,136,0.2)'}`, borderRadius: '10px' }}>
                              <span style={{ fontSize: '1.2rem' }}>{m.tooLarge ? '⚠️' : '🦙'}</span>
                              <div style={{ flex: 1 }}>
                                <span style={{ fontWeight: 800, fontSize: '0.85rem' }}>{m.name}</span>
                                <span style={{ marginLeft: '10px', fontSize: '0.65rem', color: 'var(--text-dim)' }}>{m.size} · {m.modified}</span>
                                {m.tooLarge && <div style={{ fontSize: '0.62rem', color: '#ff416c', marginTop: '2px', fontWeight: 700 }}>⚠️ Too large for your GPU ({m.vramGB?.toFixed(0)}GB VRAM) — won't run. Delete and pull a smaller model.</div>}
                              </div>
                              <span style={{ fontSize: '0.6rem', padding: '2px 8px', background: m.tooLarge ? 'rgba(255,65,108,0.12)' : 'rgba(0,255,136,0.1)', border: `1px solid ${m.tooLarge ? 'rgba(255,65,108,0.3)' : 'rgba(0,255,136,0.2)'}`, borderRadius: '4px', color: m.tooLarge ? '#ff416c' : '#00ff88', fontWeight: 800 }}>{m.tooLarge ? "Can't Run" : 'Ready'}</span>
                              <button onClick={async () => { if(confirm(`Delete ${m.name}?`)) { await (ipc as any).invoke('ollama-delete', m.name); loadOllamaModels(); } }} style={{ background: 'transparent', border: 'none', color: '#ff416c', cursor: 'pointer', opacity: 0.6, fontSize: '1rem' }}>✕</button>
                            </div>
                          ))}
                        </div>
                    }
                  </div>

                  {/* Live HuggingFace search */}
                  <div style={{ marginBottom: '24px' }}>
                    <div style={{ fontSize: '0.65rem', fontWeight: 900, color: 'var(--primary)', letterSpacing: '0.12em', marginBottom: '10px' }}>
                      🤗 SEARCH HUGGINGFACE LIBRARY <span style={{ fontWeight: 400, color: 'var(--text-dim)', textTransform: 'none', letterSpacing: 0 }}>— thousands of GGUF models, all Ollama-compatible</span>
                    </div>
                    <form onSubmit={e => { e.preventDefault(); searchHF(ollamaSearch); }} style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
                      <div style={{ position: 'relative', flex: 1 }}>
                        <Search size={14} style={{ position: 'absolute', left: '13px', top: '50%', transform: 'translateY(-50%)', opacity: 0.4 }} />
                        <input value={ollamaSearch} onChange={e => setOllamaSearch(e.target.value)} placeholder="Search any model… 'llama', 'mistral', 'coder', 'vision'…" style={{ width: '100%', height: '42px', paddingLeft: '38px', background: 'rgba(0,0,0,0.3)', border: '1px solid var(--glass-border)', borderRadius: '10px', color: 'white', fontSize: '0.82rem', outline: 'none' }} />
                      </div>
                      <button type="submit" className="btn-premium" style={{ height: '42px', padding: '0 20px', fontSize: '0.72rem', whiteSpace: 'nowrap' }}>{hfSearching ? '⏳' : '🔍 Search'}</button>
                      {(hfResults.length > 0 || hfUrlPreview) && <button type="button" onClick={() => { setHfResults([]); setOllamaSearch(''); setHfUrlPreview(null); }} style={{ height: '42px', padding: '0 12px', background: 'rgba(255,65,108,0.1)', border: '1px solid rgba(255,65,108,0.3)', borderRadius: '10px', color: '#ff416c', cursor: 'pointer', fontSize: '0.72rem' }}>Clear</button>}
                    </form>
                    {hfError && <p style={{ fontSize: '0.7rem', color: '#ff416c', marginBottom: '10px' }}>⚠ {hfError}</p>}

                    {/* HuggingFace URL Preview */}
                    {hfUrlPreview && (() => {
                      const { data } = hfUrlPreview;
                      const isPulling = ollamaPulling === data.ollamaCmd;
                      const isInstalled = ollamaModels.some(m => m.name.includes((data.name||'').split('/').pop()||''));
                      return (
                        <div style={{ background: isInstalled ? 'rgba(0,255,136,0.04)' : 'rgba(255,255,255,0.03)', border: `1px solid ${isInstalled ? 'rgba(0,255,136,0.3)' : 'rgba(255,170,0,0.35)'}`, borderRadius: '16px', padding: '20px', marginBottom: '16px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
                            <span style={{ fontSize: '0.6rem', fontWeight: 900, padding: '3px 10px', borderRadius: '6px', background: 'rgba(255,170,0,0.15)', color: '#ffaa00', letterSpacing: '0.1em' }}>🤗 HUGGINGFACE MODEL</span>
                            {isInstalled && <span style={{ fontSize: '0.6rem', color: '#00ff88', fontWeight: 700 }}>✅ Installed</span>}
                            {data.sizeLabel && <span style={{ marginLeft: 'auto', fontSize: '0.68rem', color: 'var(--text-dim)' }}>💾 {data.sizeLabel}{data.ggufCount > 1 ? ` (${data.ggufCount} files)` : ''}</span>}
                          </div>
                          <div style={{ fontSize: '1rem', fontWeight: 800, marginBottom: '8px', wordBreak: 'break-word' }}>{data.name}</div>
                          <div style={{ display: 'flex', gap: '14px', fontSize: '0.68rem', color: 'var(--text-dim)', marginBottom: '12px', flexWrap: 'wrap' }}>
                            <span>⬇ {formatNum(data.downloads)}</span>
                            <span>❤️ {formatNum(data.likes)}</span>
                            <span style={{ padding: '1px 8px', background: 'rgba(155,77,255,0.12)', border: '1px solid rgba(155,77,255,0.25)', borderRadius: '4px', color: 'var(--primary)', fontSize: '0.6rem' }}>{data.pipeline}</span>
                          </div>
                          {data.tags?.length > 0 && <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '12px' }}>{data.tags.slice(0,6).map((t: string) => <span key={t} style={{ fontSize: '0.55rem', padding: '2px 7px', background: 'rgba(79,172,254,0.08)', border: '1px solid rgba(79,172,254,0.2)', borderRadius: '4px', color: '#4facfe' }}>{t}</span>)}</div>}
                          <div style={{ display: 'flex', gap: '8px' }}>
                            <button onClick={() => (ipc as any).send('open-external-url', data.hfUrl)} style={{ height: '34px', padding: '0 14px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--glass-border)', borderRadius: '8px', color: 'white', cursor: 'pointer', fontSize: '0.7rem', fontWeight: 700 }}>🤗 HF ↗</button>
                            <button disabled={isPulling || isInstalled} onClick={async () => { if (isPulling || isInstalled) return; const ok = await checkHardwareBeforePull(data.sizeLabel || ''); if (!ok) return; setOllamaPulling(data.ollamaCmd); const r = await (ipc as any).invoke('ollama-pull', data.ollamaCmd); setOllamaPulling(''); if (r.success) { loadOllamaModels(); } }} style={{ flex: 1, height: '34px', background: isInstalled ? 'rgba(0,255,136,0.1)' : isPulling ? 'rgba(155,77,255,0.2)' : 'rgba(155,77,255,0.15)', border: `1px solid ${isInstalled ? 'rgba(0,255,136,0.3)' : 'rgba(155,77,255,0.4)'}`, borderRadius: '8px', color: isInstalled ? '#00ff88' : 'var(--primary)', cursor: isInstalled ? 'default' : 'pointer', fontSize: '0.7rem', fontWeight: 700 }}>{isInstalled ? '✅ Installed' : isPulling ? '⏳ Pulling…' : '⬇ Pull Model'}</button>
                            <button onClick={() => { setHfUrlPreview(null); setOllamaSearch(''); }} style={{ height: '34px', padding: '0 14px', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--glass-border)', borderRadius: '8px', color: 'var(--text-dim)', cursor: 'pointer', fontSize: '0.7rem' }}>✕</button>
                          </div>
                        </div>
                      );
                    })()}

                    {/* HF live results */}
                    {hfResults.length > 0 && (
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '10px', marginBottom: '12px' }}>
                        {hfResults.map(model => {
                          const isPulling = ollamaPulling === model.ollamaCmd;
                          const isInstalled = ollamaModels.some(m => m.name.includes(model.name.split('/').pop() || ''));
                          return (
                            <div key={model.id} style={{ padding: '14px 16px', background: isInstalled ? 'rgba(0,255,136,0.04)' : 'rgba(255,255,255,0.02)', border: `1px solid ${isInstalled ? 'rgba(0,255,136,0.25)' : 'var(--glass-border)'}`, borderRadius: '12px' }}>
                              <div style={{ marginBottom: '5px' }}>
                                <span style={{ fontWeight: 800, fontSize: '0.82rem', wordBreak: 'break-word' }}>{model.name}</span>
                              </div>
                              <div style={{ display: 'flex', gap: '10px', fontSize: '0.65rem', color: 'var(--text-dim)', marginBottom: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                                <span>⬇ {formatNum(model.downloads)}</span>
                                <span>❤️ {formatNum(model.likes)}</span>
                                {model.sizeLabel && (
                                  <span style={{ padding: '1px 7px', background: 'rgba(0,255,136,0.08)', border: '1px solid rgba(0,255,136,0.25)', borderRadius: '4px', color: '#00ff88', fontWeight: 700 }}>
                                    💾 {model.sizeLabel}{model.ggufCount > 1 ? ` (${model.ggufCount} files)` : ''}
                                  </span>
                                )}
                                {model.pipeline && <span style={{ padding: '1px 6px', background: 'rgba(79,172,254,0.1)', border: '1px solid rgba(79,172,254,0.2)', borderRadius: '4px', color: '#4facfe' }}>{model.pipeline}</span>}
                              </div>
                              {isPulling && (() => {
                                const p = ollamaPullProgress[model.ollamaCmd];
                                const pct = p?.percent ?? 0;
                                return (
                                  <div style={{ marginBottom: '8px' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '5px' }}>
                                      <span style={{ fontSize: '0.65rem', color: '#00ff88', fontWeight: 700 }}>{p?.status === 'Complete!' ? '✅ Done!' : p?.status || 'Connecting…'}</span>
                                      <span style={{ fontSize: '0.7rem', fontWeight: 900, color: 'white' }}>{pct}%</span>
                                    </div>
                                    <div style={{ height: '6px', background: 'rgba(255,255,255,0.08)', borderRadius: '4px', overflow: 'hidden' }}>
                                      <div style={{ height: '100%', width: `${pct}%`, background: pct === 100 ? '#00ff88' : 'linear-gradient(90deg,#9b4dff,#4facfe)', borderRadius: '4px', transition: 'width 0.4s ease' }} />
                                    </div>
                                    {p?.downloaded && p?.total && (
                                      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '4px' }}>
                                        <span style={{ fontSize: '0.6rem', color: 'var(--text-dim)' }}>{p.downloaded} / {p.total}</span>
                                        {p.timeLeft && <span style={{ fontSize: '0.6rem', color: '#ffa500' }}>⏱ {p.timeLeft}</span>}
                                      </div>
                                    )}
                                  </div>
                                );
                              })()}
                              <div style={{ display: 'flex', gap: '6px' }}>
                                <button onClick={() => (ipc as any).send('open-external-url', model.hfUrl)} style={{ flex: 1, height: '28px', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--glass-border)', borderRadius: '7px', color: 'var(--text-dim)', cursor: 'pointer', fontSize: '0.65rem' }}>HF ↗</button>
                                {isPulling ? (
                                  <button onClick={async () => {
                                    await (ipc as any).invoke('ollama-pull-cancel', model.ollamaCmd);
                                    setOllamaPulling('');
                                    setOllamaLog(prev => ({ ...prev, [model.ollamaCmd]: 'Cancelled.' }));
                                  }} style={{ flex: 2, height: '28px', background: 'rgba(255,65,108,0.15)', border: '1px solid rgba(255,65,108,0.4)', borderRadius: '7px', color: '#ff416c', cursor: 'pointer', fontSize: '0.65rem', fontWeight: 700 }}>
                                    ✕ Cancel
                                  </button>
                                ) : (
                                  <button onClick={async () => {
                                    if (isInstalled) return;
                                    const ok = await checkHardwareBeforePull(model.sizeLabel || '');
                                    if (!ok) return;
                                    setOllamaPulling(model.ollamaCmd);
                                    setOllamaLog(prev => ({ ...prev, [model.ollamaCmd]: '' }));
                                    await (ipc as any).invoke('ollama-pull', model.ollamaCmd);
                                    setOllamaPulling('');
                                    loadOllamaModels();
                                  }} style={{ flex: 2, height: '28px', background: isInstalled ? 'rgba(0,255,136,0.1)' : 'rgba(155,77,255,0.15)', border: `1px solid ${isInstalled ? 'rgba(0,255,136,0.3)' : 'rgba(155,77,255,0.3)'}`, borderRadius: '7px', color: isInstalled ? '#00ff88' : 'var(--primary)', cursor: isInstalled ? 'default' : 'pointer', fontSize: '0.65rem', fontWeight: 700 }}>
                                    {isInstalled ? '✅ Installed' : '⬇ Pull'}
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Featured models — shown when no search active */}
                  {hfResults.length === 0 && (
                  <div>
                    <div style={{ fontSize: '0.65rem', fontWeight: 900, color: 'var(--text-dim)', letterSpacing: '0.12em', marginBottom: '10px' }}>⭐ FEATURED MODELS</div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '10px' }}>
                      {OLLAMA_FEATURED.map(model => {
                        const isInstalled = ollamaModels.some(m => m.name.startsWith(model.name));
                        const isPulling = ollamaPulling === model.name;
                        return (
                          <div key={model.name} style={{ padding: '14px 16px', background: isInstalled ? 'rgba(0,255,136,0.04)' : 'rgba(255,255,255,0.02)', border: `1px solid ${isInstalled ? 'rgba(0,255,136,0.25)' : 'var(--glass-border)'}`, borderRadius: '12px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                              <span style={{ fontWeight: 800, fontSize: '0.85rem' }}>{model.label}</span>
                              <span style={{ fontSize: '0.68rem', fontWeight: 700, padding: '2px 8px', background: 'rgba(255,170,0,0.12)', border: '1px solid rgba(255,170,0,0.3)', borderRadius: '6px', color: '#ffaa00', whiteSpace: 'nowrap' }}>💾 {model.size}</span>
                            </div>
                            <div style={{ display: 'flex', gap: '3px', marginBottom: '7px' }}>
                              {model.tags.map((tag: string) => <span key={tag} style={{ fontSize: '0.5rem', padding: '2px 5px', background: 'rgba(155,77,255,0.1)', border: '1px solid rgba(155,77,255,0.2)', borderRadius: '4px', color: 'var(--primary)' }}>{tag}</span>)}
                            </div>
                            <p style={{ fontSize: '0.65rem', color: 'var(--text-dim)', marginBottom: '10px', lineHeight: 1.4 }}>{model.desc}</p>
                            {isPulling && (() => {
                              const p = ollamaPullProgress[model.name];
                              const pct = p?.percent ?? 0;
                              return (
                                <div style={{ marginBottom: '10px' }}>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '5px' }}>
                                    <span style={{ fontSize: '0.65rem', color: '#00ff88', fontWeight: 700 }}>{p?.status === 'Complete!' ? '✅ Done!' : p?.status || 'Connecting…'}</span>
                                    <span style={{ fontSize: '0.75rem', fontWeight: 900, color: 'white' }}>{pct}%</span>
                                  </div>
                                  <div style={{ height: '8px', background: 'rgba(255,255,255,0.08)', borderRadius: '4px', overflow: 'hidden' }}>
                                    <div style={{ height: '100%', width: `${pct}%`, background: pct === 100 ? '#00ff88' : 'linear-gradient(90deg,#9b4dff,#4facfe)', borderRadius: '4px', transition: 'width 0.4s ease', boxShadow: pct > 0 ? '0 0 8px rgba(155,77,255,0.5)' : 'none' }} />
                                  </div>
                                  {p?.downloaded && p?.total ? (
                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '5px' }}>
                                      <span style={{ fontSize: '0.62rem', color: 'var(--text-dim)' }}>{p.downloaded} / {p.total}</span>
                                      {p.timeLeft && <span style={{ fontSize: '0.62rem', color: '#ffa500', fontWeight: 700 }}>⏱ {p.timeLeft}</span>}
                                    </div>
                                  ) : (
                                    <div style={{ fontSize: '0.62rem', color: 'var(--text-dim)', marginTop: '4px' }}>Waiting for progress…</div>
                                  )}
                                </div>
                              );
                            })()}
                            {isPulling ? (
                              <button onClick={async () => {
                                await (ipc as any).invoke('ollama-pull-cancel', model.name);
                                setOllamaPulling('');
                                setOllamaLog(prev => ({ ...prev, [model.name]: 'Cancelled.' }));
                              }} style={{ width: '100%', height: '30px', background: 'rgba(255,65,108,0.15)', border: '1px solid rgba(255,65,108,0.4)', borderRadius: '8px', color: '#ff416c', cursor: 'pointer', fontSize: '0.7rem', fontWeight: 700 }}>
                                ✕ Cancel Download
                              </button>
                            ) : (
                              <button onClick={async () => {
                                if (isInstalled) return;
                                const ok = await checkHardwareBeforePull(model.size || '');
                                if (!ok) return;
                                setOllamaPulling(model.name);
                                setOllamaLog(prev => ({ ...prev, [model.name]: '' }));
                                await (ipc as any).invoke('ollama-pull', model.name);
                                setOllamaPulling('');
                                loadOllamaModels();
                              }} style={{ width: '100%', height: '30px', background: isInstalled ? 'rgba(0,255,136,0.1)' : 'rgba(155,77,255,0.15)', border: `1px solid ${isInstalled ? 'rgba(0,255,136,0.3)' : 'rgba(155,77,255,0.3)'}`, borderRadius: '8px', color: isInstalled ? '#00ff88' : 'var(--primary)', cursor: isInstalled ? 'default' : 'pointer', fontSize: '0.7rem', fontWeight: 700 }}>
                                {isInstalled ? '✅ Installed' : '⬇ Pull Model'}
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  )}
                </div>
                )}

            </motion.div>
          )}

          {activeTab === 'skills' && (
            <motion.div key="skills" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="glass-card full-height-panel skills-panel" style={{ padding: '0', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              {/* Header */}
              <div style={{ padding: '20px 25px', borderBottom: '1px solid var(--glass-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: '0.75rem', fontWeight: 900, color: 'var(--primary)', letterSpacing: '0.15em' }}>⚡ SKILL ENGINE</div>
                  <div style={{ fontSize: '0.65rem', color: 'var(--text-dim)', marginTop: '4px' }}>Self-optimizing zero-token request handler · Goal: 90% efficiency</div>
                </div>
                <button onClick={async () => { const r = await (ipc as any).invoke('skills-optimize'); alert(`Optimization complete\nEfficiency: ${skillEfficiency}%\nRemoved: ${r.removed} weak skills`); fetchStats(); }} className="btn-premium" style={{ padding: '8px 16px', fontSize: '0.65rem' }}>🔄 OPTIMIZE NOW</button>
              </div>

              {/* Stats Bar */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '1px', background: 'var(--glass-border)', borderBottom: '1px solid var(--glass-border)' }}>
                {[
                  { label: 'EFFICIENCY', value: `${skillEfficiency}%`, color: skillEfficiency >= 90 ? '#00ff88' : skillEfficiency >= 50 ? '#ffa500' : '#ff416c', goal: '90%' },
                  { label: 'SKILL HITS', value: skillStats.skillHits?.toLocaleString() || '0', color: '#4facfe', goal: 'requests handled' },
                  { label: 'TOKENS SAVED', value: skillStats.tokensSaved?.toLocaleString() || '0', color: '#9b4dff', goal: 'est. saved' },
                  { label: 'ACTIVE SKILLS', value: skills.filter(s => s.active).length, color: '#00ff88', goal: `${skills.length} total` },
                ].map(s => (
                  <div key={s.label} style={{ padding: '15px 20px', background: 'rgba(0,0,0,0.2)' }}>
                    <div style={{ fontSize: '0.55rem', fontWeight: 900, color: 'var(--text-dim)', letterSpacing: '0.1em', marginBottom: '6px' }}>{s.label}</div>
                    <div style={{ fontSize: '1.4rem', fontWeight: 900, color: s.color }}>{s.value}</div>
                    <div style={{ fontSize: '0.55rem', color: 'var(--text-dim)', marginTop: '2px' }}>goal: {s.goal}</div>
                  </div>
                ))}
              </div>

              {/* Efficiency bar */}
              <div style={{ padding: '10px 20px', borderBottom: '1px solid var(--glass-border)', background: 'rgba(0,0,0,0.1)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
                  <span style={{ fontSize: '0.6rem', color: 'var(--text-dim)' }}>Token Efficiency Progress</span>
                  <span style={{ fontSize: '0.6rem', color: skillEfficiency >= 90 ? '#00ff88' : 'var(--primary)' }}>{skillEfficiency}% / 90% goal</span>
                </div>
                <div style={{ height: '5px', background: 'rgba(255,255,255,0.05)', borderRadius: '3px', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${Math.min(100, skillEfficiency)}%`, background: skillEfficiency >= 90 ? 'linear-gradient(90deg,#00ff88,#4facfe)' : 'linear-gradient(90deg,var(--primary),#4facfe)', borderRadius: '3px', transition: 'width 0.5s ease' }} />
                </div>
              </div>

              {/* Sub-tab switcher */}
              <div style={{ display: 'flex', gap: '0', borderBottom: '1px solid var(--glass-border)', background: 'rgba(0,0,0,0.15)' }}>
                {[
                  { id: 'mine' as const,      label: '⚡ MY SKILLS',    badge: String(skills.length) },
                  { id: 'library' as const,   label: '📚 LIBRARY',      badge: String(SKILL_LIBRARY.length) },
                  { id: 'optimizer' as const, label: '🧠 OPTIMIZER',    badge: `${skillEfficiency}%` },
                ].map(tab => (
                  <button key={tab.id} onClick={async () => {
                    setSkillsSubTab(tab.id);
                    if (tab.id === 'optimizer') {
                      const h = await (ipc as any).invoke('skills-get-history');
                      if (h) { setOptimizerHistory(h.history || []); setSkillEfficiency(h.efficiency || 0); }
                    }
                  }} style={{ flex: 1, padding: '12px 10px', background: 'none', border: 'none', borderBottom: skillsSubTab === tab.id ? '2px solid var(--primary)' : '2px solid transparent', color: skillsSubTab === tab.id ? 'var(--primary)' : 'var(--text-dim)', fontSize: '0.6rem', fontWeight: 900, letterSpacing: '0.08em', cursor: 'pointer', transition: 'all 0.2s' }}>
                    {tab.label} <span style={{ opacity: 0.5, marginLeft: '3px' }}>{tab.badge}</span>
                  </button>
                ))}
              </div>

              {/* MY SKILLS tab */}
              {skillsSubTab === 'mine' && (
                <div style={{ flex: 1, overflowY: 'auto', padding: '15px 20px' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {skills.map(skill => (
                      <div key={skill.id} style={{ background: skill.active ? 'rgba(155,77,255,0.06)' : 'rgba(255,255,255,0.02)', border: `1px solid ${skill.active ? 'rgba(155,77,255,0.2)' : 'rgba(255,255,255,0.06)'}`, borderRadius: '10px', padding: '12px 15px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                            <span style={{ fontSize: '0.7rem', fontWeight: 900, color: skill.active ? 'white' : 'var(--text-dim)' }}>{skill.name}</span>
                            {skill.autoCreated && <span style={{ fontSize: '0.5rem', padding: '2px 6px', background: 'rgba(0,255,136,0.1)', border: '1px solid rgba(0,255,136,0.3)', borderRadius: '4px', color: '#00ff88' }}>AUTO</span>}
                            <span style={{ fontSize: '0.5rem', padding: '2px 6px', background: 'rgba(79,172,254,0.1)', border: '1px solid rgba(79,172,254,0.2)', borderRadius: '4px', color: '#4facfe' }}>{skill.type}</span>
                          </div>
                          <div style={{ fontSize: '0.6rem', color: 'var(--text-dim)', marginBottom: '6px' }}>{skill.desc}</div>
                          <div style={{ display: 'flex', gap: '15px' }}>
                            <span style={{ fontSize: '0.55rem', color: 'var(--text-dim)' }}>Uses: <b style={{ color: 'white' }}>{skill.uses}</b></span>
                            <span style={{ fontSize: '0.55rem', color: 'var(--text-dim)' }}>Saved: <b style={{ color: '#9b4dff' }}>{skill.tokensSaved?.toLocaleString()} tkns</b></span>
                            <span style={{ fontSize: '0.55rem', color: 'var(--text-dim)' }}>Score: <b style={{ color: skill.score >= 70 ? '#00ff88' : skill.score >= 40 ? '#ffa500' : '#ff416c' }}>{skill.score}%</b></span>
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                          <button onClick={async () => { await (ipc as any).invoke('skills-toggle', skill.id); fetchStats(); }} style={{ padding: '4px 10px', fontSize: '0.55rem', fontWeight: 900, background: skill.active ? 'rgba(0,255,136,0.1)' : 'rgba(255,255,255,0.05)', border: `1px solid ${skill.active ? 'rgba(0,255,136,0.3)' : 'rgba(255,255,255,0.1)'}`, borderRadius: '6px', color: skill.active ? '#00ff88' : 'var(--text-dim)', cursor: 'pointer' }}>{skill.active ? 'ON' : 'OFF'}</button>
                          {!['sk_browser','sk_desktop','sk_stats','sk_imi_info','sk_help'].includes(skill.id) && (
                            <button onClick={async () => { if (confirm(`Remove skill "${skill.name}"?`)) { await (ipc as any).invoke('skills-remove', skill.id); fetchStats(); } }} style={{ padding: '4px 10px', fontSize: '0.55rem', fontWeight: 900, background: 'rgba(255,65,108,0.1)', border: '1px solid rgba(255,65,108,0.2)', borderRadius: '6px', color: '#ff416c', cursor: 'pointer' }}>✕</button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Add custom skill */}
                  <div style={{ marginTop: '20px', padding: '15px', background: 'rgba(155,77,255,0.04)', border: '1px solid rgba(155,77,255,0.15)', borderRadius: '10px' }}>
                    <div style={{ fontSize: '0.65rem', fontWeight: 900, color: 'var(--primary)', letterSpacing: '0.1em', marginBottom: '12px' }}>+ CREATE CUSTOM SKILL</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <input value={newSkillName} onChange={e => setNewSkillName(e.target.value)} placeholder="Skill name (e.g. Open Spotify)" className="chat-input" style={{ fontSize: '0.75rem' }} />
                      <input value={newSkillPattern} onChange={e => setNewSkillPattern(e.target.value)} placeholder="Trigger pattern (e.g. open spotify)" className="chat-input" style={{ fontSize: '0.75rem' }} />
                      <input value={newSkillResponse} onChange={e => setNewSkillResponse(e.target.value)} placeholder="Cached response (leave blank for passthrough)" className="chat-input" style={{ fontSize: '0.75rem' }} />
                      <button onClick={async () => {
                        if (!newSkillName || !newSkillPattern) return;
                        await (ipc as any).invoke('skills-add', { name: newSkillName, pattern: newSkillPattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), type: newSkillResponse ? 'cached' : 'passthrough', cachedResponse: newSkillResponse || null, desc: 'Custom user skill' });
                        setNewSkillName(''); setNewSkillPattern(''); setNewSkillResponse('');
                        fetchStats();
                      }} className="btn-premium" style={{ padding: '8px 20px', fontSize: '0.65rem' }}>ADD SKILL</button>
                    </div>
                  </div>
                </div>
              )}

              {/* SKILL LIBRARY tab */}
              {skillsSubTab === 'library' && (
                <div style={{ flex: 1, overflowY: 'auto', padding: '15px 20px' }}>
                  {/* Search bar */}
                  <div style={{ position: 'relative', marginBottom: '16px' }}>
                    <Search size={13} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-dim)', pointerEvents: 'none' }} />
                    <input
                      value={skillLibSearch}
                      onChange={e => setSkillLibSearch(e.target.value)}
                      placeholder="Search 67 skills... (e.g. spotify, git, ai, deploy)"
                      className="chat-input"
                      style={{ paddingLeft: '34px', fontSize: '0.75rem', width: '100%' }}
                    />
                    {skillLibSearch && (
                      <button onClick={() => setSkillLibSearch('')} style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', padding: '4px', fontSize: '0.8rem' }}>✕</button>
                    )}
                  </div>

                  {/* No search + no category selected → show category browser */}
                  {!skillLibSearch.trim() && (
                    <>
                      <div style={{ fontSize: '0.6rem', fontWeight: 900, color: 'var(--text-dim)', letterSpacing: '0.12em', marginBottom: '12px' }}>BROWSE BY CATEGORY</div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '10px', marginBottom: '24px' }}>
                        {[...new Set(SKILL_LIBRARY.map(s => s.category))].map(cat => {
                          const catSkills = SKILL_LIBRARY.filter(s => s.category === cat);
                          const installedCount = catSkills.filter(s => installedSkillIds.has(s.id)).length;
                          const catIcon = catSkills[0]?.icon || '⚡';
                          return (
                            <button key={cat} onClick={() => setSkillLibSearch(cat.replace(/^[^\s]+\s/, ''))} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', padding: '14px 16px', cursor: 'pointer', textAlign: 'left', transition: 'all 0.2s' }}
                              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(155,77,255,0.08)'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(155,77,255,0.25)'; }}
                              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.03)'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.08)'; }}
                            >
                              <div style={{ fontSize: '1.4rem', marginBottom: '8px' }}>{cat.split(' ')[0]}</div>
                              <div style={{ fontSize: '0.65rem', fontWeight: 900, color: 'white', marginBottom: '4px' }}>{cat.replace(/^[^\s]+\s/, '')}</div>
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                <span style={{ fontSize: '0.55rem', color: 'var(--text-dim)' }}>{catSkills.length} skills</span>
                                {installedCount > 0 && <span style={{ fontSize: '0.5rem', padding: '1px 6px', background: 'rgba(0,255,136,0.1)', border: '1px solid rgba(0,255,136,0.2)', borderRadius: '4px', color: '#00ff88' }}>{installedCount} added</span>}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </>
                  )}

                  {/* Search results OR category drill-down */}
                  {(() => {
                    const q = skillLibSearch.trim().toLowerCase();
                    if (!q) return null;
                    const filtered = SKILL_LIBRARY.filter(s =>
                      s.name.toLowerCase().includes(q) ||
                      s.desc.toLowerCase().includes(q) ||
                      s.pattern.toLowerCase().includes(q) ||
                      s.category.toLowerCase().includes(q)
                    );
                    if (filtered.length === 0) return (
                      <div style={{ textAlign: 'center', padding: '40px 20px' }}>
                        <div style={{ fontSize: '2rem', marginBottom: '12px' }}>🔍</div>
                        <div style={{ fontSize: '0.75rem', color: 'white', marginBottom: '6px' }}>No skills found for "{skillLibSearch}"</div>
                        <div style={{ fontSize: '0.65rem', color: 'var(--text-dim)' }}>Try: web, git, ai, deploy, gaming, system</div>
                      </div>
                    );
                    return (
                      <>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                          <div style={{ fontSize: '0.6rem', fontWeight: 900, color: 'var(--text-dim)', letterSpacing: '0.12em' }}>{filtered.length} RESULT{filtered.length !== 1 ? 'S' : ''}</div>
                          <button onClick={() => setSkillLibSearch('')} style={{ fontSize: '0.55rem', color: 'var(--primary)', background: 'none', border: 'none', cursor: 'pointer' }}>← Back to categories</button>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '8px' }}>
                          {filtered.map(skill => {
                            const installed = installedSkillIds.has(skill.id);
                            return (
                              <div key={skill.id} style={{ background: installed ? 'rgba(0,255,136,0.04)' : 'rgba(255,255,255,0.02)', border: `1px solid ${installed ? 'rgba(0,255,136,0.2)' : 'rgba(255,255,255,0.07)'}`, borderRadius: '10px', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                                  <span style={{ fontSize: '1.2rem', flexShrink: 0 }}>{skill.icon}</span>
                                  <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontSize: '0.68rem', fontWeight: 900, color: 'white', marginBottom: '2px' }}>{skill.name}</div>
                                    <div style={{ fontSize: '0.57rem', color: 'var(--text-dim)', marginBottom: '2px' }}>{skill.desc}</div>
                                    <div style={{ fontSize: '0.5rem', color: 'rgba(155,77,255,0.6)' }}>{skill.category}</div>
                                  </div>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                                  <code style={{ fontSize: '0.54rem', background: 'rgba(255,255,255,0.05)', padding: '2px 7px', borderRadius: '4px', color: '#4facfe', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>"{skill.pattern}"</code>
                                  {installed ? (
                                    <span style={{ fontSize: '0.55rem', padding: '3px 10px', background: 'rgba(0,255,136,0.1)', border: '1px solid rgba(0,255,136,0.3)', borderRadius: '6px', color: '#00ff88', whiteSpace: 'nowrap', flexShrink: 0 }}>✓ Added</span>
                                  ) : (
                                    <button onClick={async () => {
                                      await (ipc as any).invoke('skills-add', { id: skill.id, name: skill.name, pattern: skill.pattern, type: skill.response ? 'cached' : 'passthrough', cachedResponse: skill.response || null, desc: skill.desc });
                                      fetchStats();
                                    }} style={{ fontSize: '0.55rem', padding: '3px 10px', background: 'rgba(155,77,255,0.15)', border: '1px solid rgba(155,77,255,0.3)', borderRadius: '6px', color: 'var(--primary)', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0, fontWeight: 900 }}>+ Add</button>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </>
                    );
                  })()}
                </div>
              )}

              {/* ── OPTIMIZER TAB ── */}
              {skillsSubTab === 'optimizer' && (
                <div style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>

                  {/* Efficiency Gauge */}
                  <div style={{ background: 'rgba(155,77,255,0.06)', border: '1px solid rgba(155,77,255,0.2)', borderRadius: '14px', padding: '20px', marginBottom: '16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                      <div>
                        <div style={{ fontSize: '0.6rem', fontWeight: 900, color: 'var(--text-dim)', letterSpacing: '0.12em', marginBottom: '4px' }}>EFFICIENCY GOAL</div>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
                          <span style={{ fontSize: '2.4rem', fontWeight: 900, color: skillEfficiency >= 90 ? '#00ff88' : skillEfficiency >= 60 ? '#ffa500' : 'var(--primary)' }}>{skillEfficiency}%</span>
                          <span style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>/ 90% target</span>
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: '0.55rem', color: 'var(--text-dim)', marginBottom: '2px' }}>Skills intercepting AI calls</div>
                        <div style={{ fontSize: '0.7rem', fontWeight: 700, color: skillEfficiency >= 90 ? '#00ff88' : '#ffa500' }}>
                          {skillEfficiency >= 90 ? '🎯 Goal Reached!' : skillEfficiency >= 60 ? '📈 Getting there…' : '🚀 Keep adding skills'}
                        </div>
                      </div>
                    </div>
                    {/* Progress bar */}
                    <div style={{ height: '10px', background: 'rgba(255,255,255,0.07)', borderRadius: '5px', overflow: 'hidden', position: 'relative' }}>
                      <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: `${Math.min(100, skillEfficiency)}%`, background: skillEfficiency >= 90 ? 'linear-gradient(90deg,#00ff88,#4facfe)' : 'linear-gradient(90deg,var(--primary),#4facfe)', borderRadius: '5px', transition: 'width 0.6s ease' }} />
                      {/* 90% goal marker */}
                      <div style={{ position: 'absolute', left: '90%', top: 0, height: '100%', width: '2px', background: 'rgba(255,255,255,0.4)' }} />
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '4px' }}>
                      <span style={{ fontSize: '0.5rem', color: 'var(--text-dim)' }}>0%</span>
                      <span style={{ fontSize: '0.5rem', color: 'rgba(255,255,255,0.4)' }}>◀ 90% goal</span>
                      <span style={{ fontSize: '0.5rem', color: 'var(--text-dim)' }}>100%</span>
                    </div>
                  </div>

                  {/* Stats Row */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px', marginBottom: '16px' }}>
                    {[
                      { label: 'INTERCEPTED', value: skillStats.skillHits || 0, color: '#00ff88', icon: '⚡', desc: 'Handled by skills' },
                      { label: 'AI CALLS',    value: skillStats.totalRequests || 0, color: '#4facfe', icon: '🧠', desc: 'Sent to AI model' },
                      { label: 'TOKENS SAVED',value: (skillStats.tokensSaved || 0).toLocaleString(), color: 'var(--primary)', icon: '💰', desc: 'Not billed' },
                    ].map(s => (
                      <div key={s.label} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '10px', padding: '14px 12px', textAlign: 'center' }}>
                        <div style={{ fontSize: '1.2rem', marginBottom: '4px' }}>{s.icon}</div>
                        <div style={{ fontSize: '1.1rem', fontWeight: 900, color: s.color }}>{s.value}</div>
                        <div style={{ fontSize: '0.5rem', fontWeight: 900, color: 'var(--text-dim)', letterSpacing: '0.1em', marginTop: '3px' }}>{s.label}</div>
                        <div style={{ fontSize: '0.5rem', color: 'rgba(255,255,255,0.25)', marginTop: '2px' }}>{s.desc}</div>
                      </div>
                    ))}
                  </div>

                  {/* The Loop */}
                  <div style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '12px', padding: '16px', marginBottom: '16px' }}>
                    <div style={{ fontSize: '0.6rem', fontWeight: 900, color: 'var(--text-dim)', letterSpacing: '0.12em', marginBottom: '12px' }}>THE OPTIMIZATION LOOP</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap' }}>
                      {[
                        { step: '1', label: 'Deploy Skills', color: '#9b4dff' },
                        { step: '→', label: '', color: 'var(--text-dim)' },
                        { step: '2', label: 'Intercept Queries', color: '#4facfe' },
                        { step: '→', label: '', color: 'var(--text-dim)' },
                        { step: '3', label: 'Measure Performance', color: '#ffa500' },
                        { step: '→', label: '', color: 'var(--text-dim)' },
                        { step: '4', label: 'Auto-Optimize', color: '#00ff88' },
                        { step: '→', label: '', color: 'var(--text-dim)' },
                        { step: '5', label: 'Repeat', color: '#9b4dff' },
                      ].map((item, i) => item.step === '→' ? (
                        <span key={i} style={{ color: 'var(--text-dim)', fontSize: '0.8rem' }}>→</span>
                      ) : (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '5px 10px', background: `${item.color}18`, border: `1px solid ${item.color}40`, borderRadius: '20px' }}>
                          <span style={{ fontSize: '0.55rem', fontWeight: 900, color: item.color, background: `${item.color}25`, borderRadius: '50%', width: '14px', height: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{item.step}</span>
                          <span style={{ fontSize: '0.55rem', fontWeight: 700, color: 'white' }}>{item.label}</span>
                        </div>
                      ))}
                    </div>
                    <div style={{ fontSize: '0.55rem', color: 'var(--text-dim)', marginTop: '10px' }}>
                      ⏱ Auto-runs every <b style={{ color: 'white' }}>5 minutes</b> · Removes skills scoring below 20% · Creates skills from repeated patterns
                    </div>
                  </div>

                  {/* Run Optimizer + Last Result */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
                    <button
                      onClick={async () => {
                        setOptimizerRunning(true);
                        const result = await (ipc as any).invoke('skills-optimize');
                        const h = await (ipc as any).invoke('skills-get-history');
                        if (result) setOptimizerLastResult(result);
                        if (h) { setOptimizerHistory(h.history || []); setSkillEfficiency(h.efficiency || 0); }
                        setOptimizerLastRun(Date.now());
                        setOptimizerRunning(false);
                        fetchStats();
                      }}
                      disabled={optimizerRunning}
                      className="btn-premium"
                      style={{ padding: '10px 20px', fontSize: '0.65rem', opacity: optimizerRunning ? 0.6 : 1 }}
                    >
                      {optimizerRunning ? '⏳ Running…' : '▶ Run Optimizer Now'}
                    </button>
                    {optimizerLastRun && (
                      <span style={{ fontSize: '0.55rem', color: 'var(--text-dim)' }}>
                        Last run: {Math.round((Date.now() - optimizerLastRun) / 1000)}s ago
                      </span>
                    )}
                  </div>

                  {/* Last optimization result */}
                  {optimizerLastResult && (
                    <div style={{ padding: '12px 14px', background: 'rgba(0,255,136,0.05)', border: '1px solid rgba(0,255,136,0.2)', borderRadius: '10px', marginBottom: '16px', fontSize: '0.65rem' }}>
                      <span style={{ color: '#00ff88', fontWeight: 900 }}>✓ Optimization complete</span>
                      <span style={{ color: 'var(--text-dim)', marginLeft: '10px' }}>
                        Efficiency: <b style={{ color: 'white' }}>{optimizerLastResult.efficiency}%</b>
                        {optimizerLastResult.removed > 0 && <span style={{ marginLeft: '8px', color: '#ff416c' }}>· Removed {optimizerLastResult.removed} weak skill{optimizerLastResult.removed !== 1 ? 's' : ''}</span>}
                        {optimizerLastResult.removed === 0 && <span style={{ marginLeft: '8px', color: 'var(--text-dim)' }}>· No weak skills found</span>}
                      </span>
                    </div>
                  )}

                  {/* Miss Log — learning from AI calls */}
                  <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '12px', padding: '16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                      <div style={{ fontSize: '0.6rem', fontWeight: 900, color: 'var(--text-dim)', letterSpacing: '0.12em' }}>LEARNING FROM AI CALLS</div>
                      <span style={{ fontSize: '0.5rem', color: 'var(--text-dim)' }}>Last {optimizerHistory.length} queries that fell through to AI</span>
                    </div>
                    {optimizerHistory.length === 0 ? (
                      <div style={{ fontSize: '0.65rem', color: 'var(--text-dim)', textAlign: 'center', padding: '20px' }}>
                        No history yet — start using the Command Center and the engine will learn your patterns
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', maxHeight: '220px', overflowY: 'auto' }}>
                        {[...optimizerHistory].reverse().map((entry: any, i) => (
                          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '6px 10px', background: 'rgba(255,255,255,0.02)', borderRadius: '7px', fontSize: '0.6rem' }}>
                            <span style={{ color: 'var(--text-dim)', flexShrink: 0 }}>{new Date(entry.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                            <span style={{ flex: 1, color: 'rgba(255,255,255,0.7)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>"{entry.command}"</span>
                            <span style={{ fontSize: '0.5rem', padding: '1px 7px', background: 'rgba(255,165,0,0.1)', border: '1px solid rgba(255,165,0,0.2)', borderRadius: '4px', color: '#ffa500', flexShrink: 0 }}>→ AI</span>
                          </div>
                        ))}
                      </div>
                    )}
                    <div style={{ marginTop: '10px', fontSize: '0.55rem', color: 'var(--text-dim)', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '10px' }}>
                      💡 When the same pattern appears <b style={{ color: 'white' }}>3+ times</b>, the engine automatically creates a skill to intercept it — reducing future AI calls to zero.
                    </div>
                  </div>

                </div>
              )}

            </motion.div>
          )}

          {activeTab === 'settings' && (
            <motion.div key="settings" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="glass-card full-height-panel" style={{ padding: '0', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                <div style={{ padding: '2rem 2rem 1rem 2rem' }}>
                  <h3 style={{ fontSize: '1.8rem', fontWeight: 900 }}>System Configuration</h3>
                  <p style={{ color: 'var(--text-dim)', fontSize: '0.9rem' }}>Manage your workspace, credentials, and AI fleet.</p>
                </div>

                {/* Sub-Navigation */}
                <div style={{ display: 'flex', gap: '20px', padding: '0 2rem', borderBottom: '1px solid var(--glass-border)', background: 'rgba(255,255,255,0.02)' }}>
                  {[
                    { id: 'general',    label: 'PREFERENCES',   icon: <Settings2 size={14}/> },
                    { id: 'appearance', label: 'APPEARANCE',    icon: <Palette size={14}/> },
                    { id: 'apis',       label: 'APIs & KEYS',   icon: <Key size={14}/> },
                    { id: 'sync',       label: 'GITHUB & SYNC', icon: <RefreshCw size={14}/> },
                    { id: 'telemetry',  label: 'TELEMETRY',     icon: <Gauge size={14}/> },
                    { id: 'automation', label: 'AUTOMATION',    icon: <ShieldCheck size={14}/> }
                  ].map(tab => (
                    <button 
                      key={tab.id}
                      onClick={() => setSettingsActiveSubTab(tab.id)}
                      style={{ 
                        padding: '15px 5px', background: 'none', border: 'none', 
                        color: settingsActiveSubTab === tab.id ? 'var(--primary)' : 'var(--text-dim)',
                        fontSize: '0.65rem', fontWeight: 900, letterSpacing: '0.1em', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', gap: '8px',
                        borderBottom: settingsActiveSubTab === tab.id ? '2px solid var(--primary)' : '2px solid transparent',
                        transition: 'all 0.2s'
                      }}
                    >
                      {tab.icon} {tab.label}
                    </button>
                  ))}
                </div>

                <div style={{ padding: '2rem', height: '450px', overflowY: 'auto' }}>
                  
                  {/* CATEGORY: GENERAL PREFERENCES */}
                  {settingsActiveSubTab === 'general' && (
                    <motion.div initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }}>
                      <div style={{ marginBottom: '30px', background: 'rgba(255,255,255,0.02)', padding: '20px', borderRadius: '15px', border: '1px solid var(--glass-border)' }}>
                        <div style={{ fontSize: '0.7rem', fontWeight: 900, color: 'var(--primary)', letterSpacing: '0.15em', marginBottom: '15px' }}>PROJECT WORKSPACE</div>
                        <div style={{ display: 'flex', gap: '10px' }}>
                          <input value={projectRootInput} onChange={e => setProjectRootInput(e.target.value)} placeholder="C:\Users\...\MyProject" className="chat-input" style={{ flex: 1 }} />
                          <button onClick={async () => {
                            const picked = await (ipc as any).invoke('browse-folder');
                            if (picked) setProjectRootInput(picked);
                          }} className="btn-premium" style={{ width: 'auto', padding: '0 18px', background: 'rgba(155,77,255,0.15)' }}>📁 BROWSE</button>
                          <button onClick={updateRoot} className="btn-premium" style={{ width: 'auto', padding: '0 25px' }}>UPDATE ROOT</button>
                        </div>
                        <p style={{ fontSize: '0.65rem', color: 'var(--text-dim)', marginTop: '10px' }}>Current: {stats.projectRoot}</p>
                      </div>

                      <div style={{ background: 'rgba(255,255,255,0.02)', padding: '20px', borderRadius: '15px', border: '1px solid var(--glass-border)' }}>
                        <div style={{ fontSize: '0.7rem', fontWeight: 900, color: 'var(--primary)', letterSpacing: '0.15em', marginBottom: '20px' }}>APPEARANCE & UI</div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '30px' }}>
                          <div>
                            <div style={{ fontSize: '0.65rem', fontWeight: 900, opacity: 0.5, marginBottom: '12px' }}>THEME SELECTOR</div>
                            <div style={{ display: 'flex', gap: '10px' }}>
                              {['glass', 'dark', 'neon'].map(t => (
                                <button key={t} onClick={() => { setTheme(t); saveConfig(); }} style={{ flex: 1, padding: '8px', borderRadius: '8px', border: '1px solid var(--glass-border)', background: theme === t ? 'var(--primary)' : 'rgba(255,255,255,0.05)', color: '#fff', fontWeight: 800, fontSize: '0.65rem', cursor: 'pointer', textTransform: 'uppercase' }}>{t}</button>
                              ))}
                            </div>
                          </div>
                          <div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
                              <div style={{ fontSize: '0.65rem', fontWeight: 900, opacity: 0.5 }}>LOG RETENTION</div>
                              <div style={{ fontSize: '0.7rem', fontWeight: 900, color: 'var(--primary)' }}>{logRetention} LOGS</div>
                            </div>
                            <input type="range" min="5" max="50" value={logRetention} onChange={e => setLogRetention(parseInt(e.target.value))} onMouseUp={() => saveConfig()} style={{ width: '100%', accentColor: 'var(--primary)' }} />
                          </div>
                        </div>
                      </div>
                      {/* AI BRAIN CONFIGURATION */}
                      <div style={{ background: 'rgba(155,77,255,0.05)', padding: '20px', borderRadius: '15px', border: '1px solid rgba(155,77,255,0.2)', marginTop: '20px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                          <div style={{ fontSize: '0.7rem', fontWeight: 900, color: 'var(--primary)', letterSpacing: '0.15em' }}>🧠 BRAIN CONFIGURATION</div>
                          <div style={{ fontSize: '0.6rem', background: 'rgba(155,77,255,0.15)', color: 'var(--primary)', padding: '3px 10px', borderRadius: '6px', fontWeight: 800 }}>STRATEGY v{strategyVersion}</div>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '20px' }}>
                          <div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                              <div style={{ fontSize: '0.6rem', fontWeight: 900, opacity: 0.5 }}>TEMPERATURE</div>
                              <div style={{ fontSize: '0.7rem', fontWeight: 900, color: 'var(--primary)' }}>{brainTemperature.toFixed(1)}</div>
                            </div>
                            <input type="range" min="0" max="2" step="0.1" value={brainTemperature}
                              onChange={e => setBrainTemperature(parseFloat(e.target.value))}
                              onMouseUp={() => saveConfig()}
                              style={{ width: '100%', accentColor: 'var(--primary)' }} />
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.55rem', opacity: 0.4, marginTop: '4px' }}>
                              <span>Precise</span><span>Creative</span>
                            </div>
                          </div>
                          <div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                              <div style={{ fontSize: '0.6rem', fontWeight: 900, opacity: 0.5 }}>MAX TOKENS</div>
                              <div style={{ fontSize: '0.7rem', fontWeight: 900, color: 'var(--primary)' }}>{brainMaxTokens.toLocaleString()}</div>
                            </div>
                            <input type="range" min="256" max="8192" step="256" value={brainMaxTokens}
                              onChange={e => setBrainMaxTokens(parseInt(e.target.value))}
                              onMouseUp={() => saveConfig()}
                              style={{ width: '100%', accentColor: 'var(--primary)' }} />
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.55rem', opacity: 0.4, marginTop: '4px' }}>
                              <span>Short</span><span>Deep</span>
                            </div>
                          </div>
                          <div>
                            <div style={{ fontSize: '0.6rem', fontWeight: 900, opacity: 0.5, marginBottom: '8px' }}>BRAIN MODEL</div>
                            <select value={brainModel} onChange={e => { setBrainModel(e.target.value); saveConfig(); }}
                              className="chat-input" style={{ height: '40px', fontSize: '0.7rem', color: 'white', padding: '0 10px', width: '100%' }}>
                              <option value="gemini-2.5-flash">Gemini 2.5 Flash ⚡</option>
                              <option value="gemini-2.5-pro">Gemini 2.5 Pro 🧠</option>
                              <option value="gemini-2.0-flash">Gemini 2.0 Flash</option>
                              <option value="gemini-2.0-flash-lite">Gemini 2.0 Flash-Lite</option>
                            </select>
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  )}

                  {/* CATEGORY: APIs & KEYS */}
                  {settingsActiveSubTab === 'apis' && (
                    <motion.div initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} style={{ display: 'flex', flexDirection: 'column', gap: '28px' }}>

                      {/* Hero banner */}
                      <div style={{ background: 'linear-gradient(135deg, rgba(155,77,255,0.12), rgba(79,172,254,0.08))', border: '1px solid rgba(155,77,255,0.3)', borderRadius: '16px', padding: '18px 22px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <div style={{ fontSize: '0.9rem', fontWeight: 900, color: 'white', marginBottom: '4px' }}>🔑 API Keys & Credentials</div>
                          <div style={{ fontSize: '0.72rem', color: 'var(--text-dim)', lineHeight: 1.5 }}>Keys are stored locally on your machine — never sent to any server.<br/>Add only the services you want to use. IMI works out of the box with just Gemini.</div>
                        </div>
                        <button onClick={() => (ipc as any).send('open-external-url', 'https://aistudio.google.com/apikey')} className="btn-premium" style={{ width: 'auto', padding: '10px 20px', fontSize: '0.72rem', whiteSpace: 'nowrap', flexShrink: 0, marginLeft: '20px' }}>
                          Get Free Gemini Key →
                        </button>
                      </div>

                      {/* AI MODELS group */}
                      {(() => {
                        const allAiServices = [
                          { emoji: '✨', name: 'Gemini', desc: 'Google · Free tier · Powers IMI Core', val: geminiKey, set: setGeminiKey, ph: 'AIza…', link: 'https://aistudio.google.com/apikey', badge: 'RECOMMENDED', core: true,  saveKey: 'geminiKey' },
                          { emoji: '🤖', name: 'ChatGPT', desc: 'OpenAI GPT-4o & o1 series', val: openaiKey, set: setOpenaiKey, ph: 'sk-…', link: 'https://platform.openai.com/api-keys', core: false, saveKey: 'openaiKey' },
                          { emoji: '🧠', name: 'Claude', desc: 'Anthropic · Claude 3.5 Sonnet', val: claudeKey, set: setClaudeKey, ph: 'sk-ant-…', link: 'https://console.anthropic.com/settings/keys', core: false, saveKey: 'claudeKey' },
                          { emoji: '🔥', name: 'DeepSeek', desc: 'DeepSeek R1 · Cost-effective', val: deepseekKey, set: setDeepseekKey, ph: 'sk-…', link: 'https://platform.deepseek.com/api_keys', core: false, saveKey: 'deepseekKey' },
                          { emoji: '🌊', name: 'Mistral', desc: 'Mistral Large & Mixtral', val: mistralKey, set: setMistralKey, ph: 'API key…', link: 'https://console.mistral.ai/api-keys/', core: false, saveKey: 'mistralKey' },
                          { emoji: '🔍', name: 'Perplexity', desc: 'Web-search augmented AI', val: perplexityKey, set: setPerplexityKey, ph: 'pplx-…', link: 'https://www.perplexity.ai/settings/api', core: false, saveKey: 'perplexityKey' },
                        ];
                        const activeServices = allAiServices.filter(s => s.core || s.val);
                        const inactiveServices = allAiServices.filter(s => !s.core && !s.val);
                        const renderCard = (item: typeof allAiServices[0]) => (
                          <div key={item.name} style={{ background: item.val ? 'rgba(0,255,136,0.04)' : 'rgba(255,255,255,0.03)', border: `1px solid ${item.val ? 'rgba(0,255,136,0.2)' : 'rgba(255,255,255,0.08)'}`, borderRadius: '14px', padding: '16px', transition: 'border-color 0.2s' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span style={{ fontSize: '1.3rem' }}>{item.emoji}</span>
                                <div>
                                  <div style={{ fontSize: '0.82rem', fontWeight: 900, color: 'white', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                    {item.name}
                                    {(item as any).badge && <span style={{ fontSize: '0.52rem', background: 'rgba(155,77,255,0.25)', color: 'var(--primary)', padding: '2px 6px', borderRadius: '4px', fontWeight: 900, letterSpacing: '0.08em' }}>{(item as any).badge}</span>}
                                  </div>
                                  <div style={{ fontSize: '0.65rem', color: 'var(--text-dim)', marginTop: '1px' }}>{item.desc}</div>
                                </div>
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                  {item.val
                                    ? <>
                                        <span style={{ fontSize: '0.6rem', background: 'rgba(0,255,136,0.15)', color: '#00ff88', padding: '3px 8px', borderRadius: '6px', fontWeight: 900 }}>✓ Connected</span>
                                        {!item.core && <button onPointerDown={e => { e.preventDefault(); item.set(''); saveConfig({ [(item as any).saveKey]: '' }); }} style={{ fontSize: '0.6rem', background: 'rgba(255,65,108,0.1)', border: '1px solid rgba(255,65,108,0.3)', color: '#ff416c', padding: '3px 7px', borderRadius: '6px', cursor: 'pointer', fontWeight: 700 }} title="Remove key">×</button>}
                                      </>
                                    : <button onClick={() => (ipc as any).send('open-external-url', item.link)} style={{ fontSize: '0.6rem', background: 'none', border: '1px solid rgba(255,255,255,0.2)', color: 'var(--text-dim)', padding: '3px 8px', borderRadius: '6px', cursor: 'pointer', whiteSpace: 'nowrap' }}>Get Key →</button>
                                  }
                                </div>
                              </div>
                            </div>
                            <div style={{ position: 'relative' }}>
                              <input type="password" value={item.val} onChange={e => item.set(e.target.value)} onBlur={() => saveConfig()} placeholder={item.ph} className="chat-input" style={{ width: '100%', height: '42px', fontSize: '0.85rem', paddingLeft: '14px', paddingRight: item.val ? '38px' : '14px', borderRadius: '10px', boxSizing: 'border-box' }} />
                              {item.val && <CheckCircle2 size={16} color="#00ffaa" style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />}
                            </div>
                          </div>
                        );
                        return (
                          <div>
                            <div style={{ fontSize: '0.65rem', fontWeight: 900, letterSpacing: '0.12em', color: 'var(--primary)', opacity: 0.8, marginBottom: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <span>🤖</span> AI MODELS
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                              {activeServices.map(renderCard)}
                            </div>
                            {inactiveServices.length > 0 && (
                              <div style={{ marginTop: '12px' }}>
                                <button
                                  onClick={() => setAddServiceExpanded(p => !p)}
                                  style={{ width: '100%', padding: '10px 16px', background: 'rgba(155,77,255,0.06)', border: '1px dashed rgba(155,77,255,0.3)', borderRadius: '10px', color: 'rgba(155,77,255,0.9)', cursor: 'pointer', fontSize: '0.72rem', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', transition: 'all 0.2s' }}
                                >
                                  {addServiceExpanded ? '▲ Hide' : '+ Add a service'} {!addServiceExpanded && `· ${inactiveServices.length} available`}
                                </button>
                                {addServiceExpanded && (
                                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginTop: '12px' }}>
                                    {inactiveServices.map(renderCard)}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })()}

                      {/* DEV TOOLS group */}
                      <div>
                        <div style={{ fontSize: '0.65rem', fontWeight: 900, letterSpacing: '0.12em', color: 'var(--primary)', opacity: 0.8, marginBottom: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span>🔧</span> DEV TOOLS
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
                          {[
                            { emoji: '🐙', name: 'GitHub', desc: 'Personal Access Token · enables sync & Jules', val: githubToken, set: setGithubToken, ph: 'ghp_…', link: 'https://github.com/settings/tokens', saveKey: 'githubToken' },
                            { emoji: '🤝', name: 'Jules AI', desc: 'GitHub-based AI coding agent', val: julesApiKey, set: setJulesApiKey, ph: 'Jules key or GitHub token…', link: 'https://jules.google.com', saveKey: 'julesApiKey' },
                          ].map(item => (
                            <div key={item.name} style={{ background: item.val ? 'rgba(0,255,136,0.04)' : 'rgba(255,255,255,0.03)', border: `1px solid ${item.val ? 'rgba(0,255,136,0.2)' : 'rgba(255,255,255,0.08)'}`, borderRadius: '14px', padding: '16px', transition: 'border-color 0.2s' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                  <span style={{ fontSize: '1.3rem' }}>{item.emoji}</span>
                                  <div>
                                    <div style={{ fontSize: '0.82rem', fontWeight: 900, color: 'white' }}>{item.name}</div>
                                    <div style={{ fontSize: '0.65rem', color: 'var(--text-dim)', marginTop: '1px' }}>{item.desc}</div>
                                  </div>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                                  {item.val
                                    ? <>
                                        <span style={{ fontSize: '0.6rem', background: 'rgba(0,255,136,0.15)', color: '#00ff88', padding: '3px 8px', borderRadius: '6px', fontWeight: 900 }}>✓ Connected</span>
                                        <button onPointerDown={e => { e.preventDefault(); item.set(''); saveConfig({ [(item as any).saveKey]: '' }); }} style={{ fontSize: '0.6rem', background: 'rgba(255,65,108,0.1)', border: '1px solid rgba(255,65,108,0.3)', color: '#ff416c', padding: '3px 7px', borderRadius: '6px', cursor: 'pointer', fontWeight: 700 }} title="Remove key">×</button>
                                      </>
                                    : <button onClick={() => (ipc as any).send('open-external-url', item.link)} style={{ fontSize: '0.6rem', background: 'none', border: '1px solid rgba(255,255,255,0.2)', color: 'var(--text-dim)', padding: '3px 8px', borderRadius: '6px', cursor: 'pointer', whiteSpace: 'nowrap' }}>Get Token →</button>
                                  }
                                </div>
                              </div>
                              <div style={{ position: 'relative' }}>
                                <input type="password" value={item.val} onChange={e => item.set(e.target.value)} onBlur={() => saveConfig()} placeholder={item.ph} className="chat-input" style={{ width: '100%', height: '42px', fontSize: '0.85rem', paddingLeft: '14px', paddingRight: item.val ? '38px' : '14px', borderRadius: '10px', boxSizing: 'border-box' }} />
                                {item.val && <CheckCircle2 size={16} color="#00ffaa" style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* CUSTOM / LOCAL group */}
                      <div>
                        <div style={{ fontSize: '0.65rem', fontWeight: 900, letterSpacing: '0.12em', color: 'var(--primary)', opacity: 0.8, marginBottom: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span>⚙️</span> CUSTOM / LOCAL MODEL
                        </div>
                        <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '14px', padding: '18px' }}>
                          <div style={{ fontSize: '0.72rem', color: 'var(--text-dim)', marginBottom: '16px', lineHeight: 1.5 }}>
                            Connect any OpenAI-compatible endpoint — Ollama, vLLM, LM Studio, or a self-hosted model.
                          </div>
                          <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: '12px', marginBottom: '12px' }}>
                            <div>
                              <div style={{ fontSize: '0.65rem', fontWeight: 900, opacity: 0.5, marginBottom: '6px', letterSpacing: '0.08em' }}>ENDPOINT URL</div>
                              <input type="text" value={customApiUrl} onChange={e => setCustomApiUrl(e.target.value)} onBlur={() => saveConfig()} placeholder="http://localhost:11434/v1" className="chat-input" style={{ width: '100%', height: '42px', fontSize: '0.82rem', boxSizing: 'border-box' }} />
                            </div>
                            <div>
                              <div style={{ fontSize: '0.65rem', fontWeight: 900, opacity: 0.5, marginBottom: '6px', letterSpacing: '0.08em' }}>MODEL ID</div>
                              <input type="text" value={customApiModel} onChange={e => setCustomApiModel(e.target.value)} onBlur={() => saveConfig()} placeholder="llama3.1" className="chat-input" style={{ width: '100%', height: '42px', fontSize: '0.82rem', boxSizing: 'border-box' }} />
                            </div>
                          </div>
                          <div>
                            <div style={{ fontSize: '0.65rem', fontWeight: 900, opacity: 0.5, marginBottom: '6px', letterSpacing: '0.08em' }}>BEARER TOKEN <span style={{ opacity: 0.5, fontWeight: 400 }}>(optional)</span></div>
                            <div style={{ position: 'relative' }}>
                              <input type="password" value={customApiKey} onChange={e => setCustomApiKey(e.target.value)} onBlur={() => saveConfig()} placeholder="Bearer token if required…" className="chat-input" style={{ width: '100%', height: '42px', fontSize: '0.82rem', paddingRight: customApiKey ? '38px' : '14px', boxSizing: 'border-box' }} />
                              {customApiKey && <CheckCircle2 size={16} color="#00ffaa" style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />}
                            </div>
                          </div>
                        </div>
                      </div>

                    </motion.div>
                  )}

                  {/* CATEGORY: GITHUB & SYNC */}
                  {settingsActiveSubTab === 'sync' && (
                    <motion.div initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }}>
                      <div className="glass-card" style={{ padding: '20px', border: '1px solid var(--glass-border)' }}>
                        <div style={{ fontSize: '0.7rem', fontWeight: 900, color: 'var(--primary)', letterSpacing: '0.15em', marginBottom: '20px' }}>CLOUD SYNC ENGINE</div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '30px' }}>
                          <div>
                            <div style={{ fontSize: '0.65rem', fontWeight: 900, opacity: 0.5, marginBottom: '12px' }}>SYNC FREQUENCY</div>
                            <select 
                              value={syncFrequency} 
                              onChange={(e) => { setSyncFrequency(e.target.value); setIsSaving(true); setTimeout(() => saveConfig(), 100); }}
                              className="chat-input" 
                              style={{ height: '45px', fontSize: '0.85rem', color: 'white', padding: '0 15px' }}
                            >
                              <option value="60">Every 60 Seconds</option>
                              <option value="300">Every 5 Minutes</option>
                              <option value="600">Every 10 Minutes</option>
                            </select>
                          </div>
                          <div>
                            <div style={{ fontSize: '0.65rem', fontWeight: 900, opacity: 0.5, marginBottom: '12px' }}>CONFLICT STRATEGY</div>
                            <select className="chat-input" style={{ height: '45px', fontSize: '0.85rem', color: 'white', padding: '0 15px' }}>
                              <option value="rebase">Auto-Rebase (Clean)</option>
                              <option value="stash">Stash & Pull (Safe)</option>
                            </select>
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  )}

                  {/* CATEGORY: APPEARANCE & UI */}
                  {settingsActiveSubTab === 'appearance' && (
                    <motion.div initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

                        {/* Accent Color */}
                        <div className="glass-card" style={{ padding: '20px', border: '1px solid var(--glass-border)' }}>
                          <div style={{ fontSize: '0.75rem', fontWeight: 900, color: 'var(--primary)', letterSpacing: '0.12em', marginBottom: '16px' }}>ACCENT COLOR</div>
                          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                            {[
                              { name: 'Purple',  value: '#9b4dff' },
                              { name: 'Blue',    value: '#4facfe' },
                              { name: 'Cyan',    value: '#00f2ff' },
                              { name: 'Green',   value: '#00ff88' },
                              { name: 'Pink',    value: '#f857a6' },
                              { name: 'Orange',  value: '#ffa500' },
                              { name: 'Red',     value: '#ff416c' },
                            ].map(c => (
                              <button key={c.value} onPointerDown={e => {
                                e.preventDefault();
                                document.documentElement.style.setProperty('--primary', c.value);
                                document.documentElement.style.setProperty('--primary-glow', c.value + '99');
                              }} style={{ width: '36px', height: '36px', background: c.value, borderRadius: '50%', border: '3px solid rgba(255,255,255,0.15)', cursor: 'pointer', flexShrink: 0, transition: 'transform 0.15s' }}
                                title={c.name}
                                onMouseEnter={e => (e.currentTarget as HTMLElement).style.transform = 'scale(1.2)'}
                                onMouseLeave={e => (e.currentTarget as HTMLElement).style.transform = 'scale(1)'}
                              />
                            ))}
                          </div>
                        </div>

                        {/* Font Size */}
                        <div className="glass-card" style={{ padding: '20px', border: '1px solid var(--glass-border)' }}>
                          <div style={{ fontSize: '0.75rem', fontWeight: 900, color: 'var(--primary)', letterSpacing: '0.12em', marginBottom: '16px' }}>FONT SIZE</div>
                          <div style={{ display: 'flex', gap: '10px' }}>
                            {[
                              { label: 'Small',   size: '14px', zoom: 0.9 },
                              { label: 'Normal',  size: '16px', zoom: 1.0 },
                              { label: 'Large',   size: '18px', zoom: 1.1 },
                              { label: 'X-Large', size: '20px', zoom: 1.2 },
                            ].map(opt => (
                              <button key={opt.label} onPointerDown={e => {
                                e.preventDefault();
                                document.documentElement.style.fontSize = opt.size;
                                (window as any).electronAPI?.setZoom?.(opt.zoom);
                              }} style={{ flex: 1, padding: '10px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '10px', color: 'white', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 700 }}>
                                {opt.label}
                                <div style={{ fontSize: '0.6rem', opacity: 0.5, marginTop: '3px' }}>{opt.size}</div>
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Sidebar Width */}
                        <div className="glass-card" style={{ padding: '20px', border: '1px solid var(--glass-border)' }}>
                          <div style={{ fontSize: '0.75rem', fontWeight: 900, color: 'var(--primary)', letterSpacing: '0.12em', marginBottom: '16px' }}>SIDEBAR WIDTH</div>
                          <div style={{ display: 'flex', gap: '10px' }}>
                            {[
                              { label: 'Compact', width: '220px' },
                              { label: 'Normal',  width: '260px' },
                              { label: 'Wide',    width: '300px' },
                            ].map(opt => (
                              <button key={opt.label} onPointerDown={e => {
                                e.preventDefault();
                                const el = document.querySelector('.dashboard-container') as HTMLElement;
                                if (el) el.style.gridTemplateColumns = `${opt.width} 1fr`;
                              }} style={{ flex: 1, padding: '10px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '10px', color: 'white', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 700 }}>
                                {opt.label}
                                <div style={{ fontSize: '0.6rem', opacity: 0.5, marginTop: '3px' }}>{opt.width}</div>
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Glass Effect */}
                        <div className="glass-card" style={{ padding: '20px', border: '1px solid var(--glass-border)' }}>
                          <div style={{ fontSize: '0.75rem', fontWeight: 900, color: 'var(--primary)', letterSpacing: '0.12em', marginBottom: '16px' }}>GLASS CARD STYLE</div>
                          <div style={{ display: 'flex', gap: '10px' }}>
                            {[
                              { label: 'Subtle',  bg: 'rgba(255,255,255,0.03)', border: 'rgba(255,255,255,0.08)' },
                              { label: 'Normal',  bg: 'rgba(255,255,255,0.05)', border: 'rgba(255,255,255,0.12)' },
                              { label: 'Strong',  bg: 'rgba(255,255,255,0.09)', border: 'rgba(255,255,255,0.22)' },
                            ].map(opt => (
                              <button key={opt.label} onPointerDown={e => {
                                e.preventDefault();
                                document.documentElement.style.setProperty('--card-bg', opt.bg);
                                document.documentElement.style.setProperty('--glass-border', opt.border);
                              }} style={{ flex: 1, padding: '10px', background: opt.bg, border: `1px solid ${opt.border}`, borderRadius: '10px', color: 'white', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 700 }}>
                                {opt.label}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div style={{ fontSize: '0.65rem', color: 'var(--text-dim)', padding: '8px 12px', background: 'rgba(155,77,255,0.06)', borderRadius: '8px', border: '1px solid rgba(155,77,255,0.15)' }}>
                          💡 Changes apply instantly. Reload the app to reset to defaults.
                        </div>
                      </div>
                    </motion.div>
                  )}

                  {/* CATEGORY: TELEMETRY */}
                  {settingsActiveSubTab === 'telemetry' && (
                    <motion.div initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }}>
                      <div className="glass-card" style={{ padding: '20px', border: '1px solid var(--glass-border)' }}>
                        <div style={{ fontSize: '0.7rem', fontWeight: 900, color: 'var(--primary)', letterSpacing: '0.15em', marginBottom: '20px' }}>SYSTEM MONITORING</div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontSize: '0.8rem', fontWeight: 700 }}>Real-time CPU Tracking</span>
                            <div style={{ width: '40px', height: '20px', background: 'var(--primary)', borderRadius: '10px', position: 'relative' }}><div style={{ width: '16px', height: '16px', background: '#fff', borderRadius: '50%', position: 'absolute', right: '2px', top: '2px' }}></div></div>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontSize: '0.8rem', fontWeight: 700 }}>API Token Usage Monitor</span>
                            <div style={{ width: '40px', height: '20px', background: 'var(--primary)', borderRadius: '10px', position: 'relative' }}><div style={{ width: '16px', height: '16px', background: '#fff', borderRadius: '50%', position: 'absolute', right: '2px', top: '2px' }}></div></div>
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  )}

                  {/* CATEGORY: AUTOMATION */}
                  {settingsActiveSubTab === 'automation' && (
                    <motion.div initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }}>
                      <div className="glass-card" style={{ padding: '20px', border: '1px solid var(--glass-border)' }}>
                        <div style={{ fontSize: '0.7rem', fontWeight: 900, color: 'var(--primary)', letterSpacing: '0.15em', marginBottom: '20px' }}>AGENT ORCHESTRATION</div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div>
                              <div style={{ fontSize: '0.8rem', fontWeight: 700 }}>Autonomous Hand-off</div>
                              <div style={{ fontSize: '0.6rem', opacity: 0.5 }}>Allow Brain to trigger Coder automatically</div>
                            </div>
                            <div style={{ width: '40px', height: '20px', background: 'var(--primary)', borderRadius: '10px', position: 'relative' }}><div style={{ width: '16px', height: '16px', background: '#fff', borderRadius: '50%', position: 'absolute', right: '2px', top: '2px' }}></div></div>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div>
                              <div style={{ fontSize: '0.8rem', fontWeight: 700 }}>Direct GitHub Commits</div>
                              <div style={{ fontSize: '0.6rem', opacity: 0.5 }}>Let Coder push directly to main branch</div>
                            </div>
                            <div style={{ width: '40px', height: '20px', background: '#333', borderRadius: '10px', position: 'relative' }}><div style={{ width: '16px', height: '16px', background: '#fff', borderRadius: '50%', position: 'absolute', left: '2px', top: '2px' }}></div></div>
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  )}

                </div>

                <div style={{ padding: '1.5rem 2rem', borderTop: '1px solid var(--glass-border)', background: 'rgba(0,0,0,0.2)' }}>
                  <button 
                    onClick={saveConfig} 
                    className="btn-premium" 
                    style={{ width: '100%', background: isSaving ? '#00ffaa' : undefined, color: isSaving ? '#000' : undefined }}
                  >
                    {isSaving ? (
                      <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px' }}>
                        <ShieldCheck size={18} /> SETTINGS SYNCHRONIZED
                      </span>
                    ) : 'SAVE ALL CONFIGURATIONS'}
                  </button>
                </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};

export default App;
