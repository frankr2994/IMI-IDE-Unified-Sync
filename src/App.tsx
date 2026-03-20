import React, { useState, useEffect } from 'react';
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
  const [ollamaSearch, setOllamaSearch] = useState('');
  const [hfResults, setHfResults] = useState<any[]>([]);
  const [hfSearching, setHfSearching] = useState(false);
  const [hfError, setHfError] = useState('');
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
    setHfSearching(true); setHfError('');
    try {
      const res = await (ipc as any).invoke('hf-search-models', q);
      setHfResults(res.results || []);
      if (res.error) setHfError(res.error);
    } catch(e: any) { setHfError(e.message); }
    setHfSearching(false);
  };
  const formatNum = (n: number) => n >= 1000000 ? `${(n/1000000).toFixed(1)}M` : n >= 1000 ? `${(n/1000).toFixed(1)}k` : String(n);
  const loadOllamaModels = async () => {
    const res = await (ipc as any).invoke('ollama-list').catch(() => ({ models: [] }));
    setOllamaModels(res.models || []);
  };

  const searchGitHub = async (q: string, sort?: string) => {
    if (!q.trim()) return;
    setGhSearching(true); setGhError('');
    try {
      const res = await (ipc as any).invoke('github-search', q, sort || ghSort);
      setGhResults(res.results || []);
      setGhTotal(res.total || 0);
      if (res.error) setGhError(res.error);
    } catch(e: any) { setGhError(e.message); }
    setGhSearching(false);
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
    setNpmSearching(true); setNpmError('');
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
    if (skillData) { setSkills(skillData.skills || []); setSkillStats(skillData.stats || {}); setSkillEfficiency(skillData.efficiency || 0); }
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
      setGeminiKey(config.geminiKey || '');
      setGithubToken(config.githubToken || '');
      setOpenaiKey(config.openaiKey || '');
      setClaudeKey(config.claudeKey || '');
      setDeepseekKey(config.deepseekKey || '');
      setMistralKey(config.mistralKey || '');
      setLlamaKey(config.llamaKey || '');
      setPerplexityKey(config.perplexityKey || '');
      setCustomApiKey(config.customApiKey || '');
      setCustomApiUrl(config.customApiUrl || '');
      setCustomApiModel(config.customApiModel || '');
      setJulesApiKey(config.julesApiKey || '');
      setGoogleMapsKey(config.googleMapsKey || '');
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
      const lines = mcpData.data.split('\n').filter((l: string) => 
        (l.includes('●') || l.includes('○') || l.includes('✗') || l.includes(':'))
      );
      setMcpServers(lines.map((l: string) => ({ 
        name: l.trim(), 
        status: l.includes('●') ? 'online' : 'offline' 
      })));
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
      setOllamaLog(prev => ({ ...prev, [data.model]: (prev[data.model] || '') + data.chunk }));
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

  const renderContent = (text: string) => {
    if (!text) return null;
    return text.split('\n').map((line, i) => (
      <p key={i} style={{ marginBottom: line.trim() ? '0.5rem' : '1rem' }}>{line}</p>
    ));
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

        <div style={{ marginTop: 'auto' }}>
          <div className="glass-card" style={{ padding: '1.5rem', borderRadius: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', fontWeight: 800, marginBottom: '10px' }}>
              <span>SYSTEM QUOTA</span>
              <span style={{ color: 'var(--primary)' }}>{quota}%</span>
            </div>
            <div className="quota-bar"><div className="quota-fill" style={{ width: `${quota}%` }}></div></div>
            <p style={{ fontSize: '0.65rem', color: 'var(--text-dim)', marginTop: '12px', lineHeight: '1.4' }}>
              Optimized by Jules Recycling Protocol. 
            </p>
          </div>
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
                    <div style={{ fontSize: '1.4rem', fontWeight: 900 }}>{activeDirector.toUpperCase()} ACTIVE</div>
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
                              {m.director?m.director.toUpperCase():'SYSTEM'}
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
                            <span style={{ flex: 1, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {activeDirector === 'antigravity' ? 'AG AI' : activeDirector.toUpperCase()}
                            </span>
                            <ChevronRight size={12} style={{ transform: isDropdownOpen ? 'rotate(-90deg)' : 'rotate(90deg)' }} />
                          </div>
                          <AnimatePresence>
                            {isDropdownOpen && (
                              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }} style={{ position: 'absolute', bottom: 'calc(100% + 15px)', left: 0, width: '180px', background: 'rgba(20, 20, 30, 0.95)', border: '1px solid var(--glass-border)', borderRadius: '12px', zIndex: 100, overflowY: 'auto', maxHeight: '300px' }}>
                                {[
                                  { id: 'gemini', name: 'GEMINI (FAST API)', icon: <Zap size={12} /> },
                                  { id: 'geminicli', name: 'GEMINI CLI (MCP)', icon: <Terminal size={12} /> },
                                  { id: 'jules', name: 'JULES', icon: <Layers size={12} /> },
                                  { id: 'antigravity', name: 'AG AI', icon: <Cpu size={12} /> },
                                  { id: 'chatgpt', name: 'CHATGPT', icon: <MessageSquare size={12} /> },
                                  { id: 'claude', name: 'CLAUDE', icon: <ShieldCheck size={12} /> },
                                  { id: 'mistral', name: 'MISTRAL', icon: <Activity size={12} /> },
                                  { id: 'llama', name: 'LLAMA 3', icon: <Database size={12} /> },
                                  { id: 'perplexity', name: 'PERPLEXITY', icon: <Search size={12} /> },
                                  { id: 'deepseek', name: 'DEEPSEEK', icon: <Terminal size={12} /> },
                                  { id: 'custom', name: 'CUSTOM API', icon: <Wifi size={12} /> }
                                ].map(opt => (
                                  <div key={opt.id} onClick={() => { setActiveDirector(opt.id); setIsDropdownOpen(false); addLog('system', `Brain Engine set to ${opt.name}`); saveConfig({ activeBrain: opt.id }); }} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 15px', color: '#fff', fontSize: '0.65rem', cursor: 'pointer', background: activeDirector === opt.id ? 'rgba(155, 77, 255, 0.1)' : 'transparent' }}>
                                    {opt.icon}
                                    {opt.name}
                                  </div>
                                ))}
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>

                        {/* CODER */}
                        <div style={{ position: 'relative' }}>
                          <div onClick={() => { setIsCoderDropdownOpen(!isCoderDropdownOpen); setIsDropdownOpen(false); }} style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '120px', padding: '0 12px', background: 'rgba(0, 255, 136, 0.05)', borderRight: '1px solid var(--glass-border)', color: '#00ff88', fontWeight: 900, fontSize: '0.6rem', textTransform: 'uppercase', height: '40px', cursor: 'pointer' }}>
                            <div style={{ position: 'absolute', top: '-18px', left: '0px', width: '100%', textAlign: 'center', fontSize: '0.65rem', fontWeight: 900, color: '#00ff88', letterSpacing: '0.1em', textShadow: '0 0 10px rgba(0,255,136,0.5)' }}>CODER</div>
                            {activeEngine === 'jules' ? <Layers size={12} /> : (activeEngine === 'antigravity' ? <Cpu size={12} /> : <Zap size={12} />)}
                            <span style={{ flex: 1 }}>{activeEngine.toUpperCase()}</span>
                            <ChevronRight size={12} style={{ transform: isCoderDropdownOpen ? 'rotate(-90deg)' : 'rotate(90deg)' }} />
                          </div>
                          <AnimatePresence>
                            {isCoderDropdownOpen && (
                              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }} style={{ position: 'absolute', bottom: 'calc(100% + 15px)', left: 0, width: '150px', background: 'rgba(20, 20, 30, 0.95)', border: '1px solid var(--glass-border)', borderRadius: '12px', zIndex: 100, overflow: 'hidden' }}>
                                <div onClick={() => { setActiveEngine('jules'); setIsCoderDropdownOpen(false); addLog('system', 'Execution Node set to JULES'); saveConfig({ activeCoder: 'jules' }); }} style={{ padding: '10px 15px', color: activeEngine === 'jules' ? '#00ff88' : '#fff', fontSize: '0.65rem', cursor: 'pointer', background: activeEngine === 'jules' ? 'rgba(0, 255, 136, 0.1)' : 'transparent', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>JULES</div>
                                <div onClick={() => { setActiveEngine('antigravity'); setIsCoderDropdownOpen(false); addLog('system', 'Execution Node set to ANTIGRAVITY'); saveConfig({ activeCoder: 'antigravity' }); }} style={{ padding: '10px 15px', color: activeEngine === 'antigravity' ? '#00ff88' : '#fff', fontSize: '0.65rem', cursor: 'pointer', background: activeEngine === 'antigravity' ? 'rgba(0, 255, 136, 0.1)' : 'transparent', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>ANTIGRAVITY</div>
                                <div onClick={() => { setActiveEngine('imi-core'); setIsCoderDropdownOpen(false); addLog('system', 'Execution Node set to IMI CORE'); saveConfig({ activeCoder: 'imi-core' }); }} style={{ padding: '10px 15px', color: activeEngine === 'imi-core' ? '#00ff88' : '#fff', fontSize: '0.65rem', cursor: 'pointer', background: activeEngine === 'imi-core' ? 'rgba(0, 255, 136, 0.1)' : 'transparent' }}>IMI CORE</div>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>

                        <input value={chatInput} onChange={e => setChatInput(e.target.value)} type="text" placeholder={`Message...`} style={{ flex: 1, background: 'transparent', border: 'none', padding: '0 15px', color: 'white', fontSize: '0.9rem', outline: 'none', height: '40px' }} />
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
                    <button key={t.id} onClick={() => setMcpHubTab(t.id as any)} style={{ padding: '10px 20px', background: mcpHubTab === t.id ? 'var(--primary)' : 'transparent', border: 'none', borderBottom: mcpHubTab === t.id ? '2px solid var(--primary)' : '2px solid transparent', borderRadius: '8px 8px 0 0', color: mcpHubTab === t.id ? 'white' : 'var(--text-dim)', cursor: 'pointer', fontWeight: 800, fontSize: '0.8rem', marginBottom: '-1px', transition: 'all 0.2s' }}>
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
                    {npmResults.length > 0 && (
                      <button type="button" onClick={() => { setNpmResults([]); setMcpSearch(''); }} style={{ height: '48px', padding: '0 16px', background: 'rgba(255,65,108,0.1)', border: '1px solid rgba(255,65,108,0.3)', borderRadius: '12px', color: '#ff416c', cursor: 'pointer', fontSize: '0.75rem' }}>CLEAR</button>
                    )}
                  </form>
                  {npmError && <p style={{ fontSize: '0.7rem', color: '#ff416c', marginTop: '8px' }}>⚠ {npmError}</p>}
                </div>

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

                {/* Preset MCPs — shown when no live search active */}
                {npmResults.length === 0 && (
                <div style={{ marginBottom: '40px' }}>
                  <div style={{ fontSize: '0.7rem', fontWeight: 900, color: 'var(--primary)', letterSpacing: '0.15em', marginBottom: '20px' }}>FEATURED REGISTRY</div>
                  <div className="tool-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '16px' }}>
                    {availableMCPs.map(lib => {
                      const isLinked = mcpServers.some(s => s.name.toLowerCase().includes(lib.id.toLowerCase()));
                      return (
                        <div key={lib.id} className="glass-card" style={{ padding: '1.25rem', border: isLinked ? `1px solid var(--primary)` : '1px solid var(--glass-border)', background: isLinked ? `rgba(155, 77, 255, 0.05)` : 'rgba(255,255,255,0.02)', position: 'relative', overflow: 'hidden' }}>
                          <div style={{ position: 'absolute', top: 0, left: 0, width: '4px', height: '100%', background: lib.color }}></div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
                            <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: lib.color, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              <Database size={18} />
                            </div>
                            <button
                              onClick={async () => {
                                const cfg = { name: lib.id, command: lib.command, args: lib.args, env: {} as any };
                                if (lib.id === 'Jules' && julesApiKey) cfg.env = { JULES_API_KEY: julesApiKey, GOOGLE_API_KEY: julesApiKey };
                                else if (lib.id === 'GitHub' && githubToken) cfg.env = { GITHUB_PERSONAL_ACCESS_TOKEN: githubToken };
                                else if (lib.id === 'ChatGPT' && openaiKey) cfg.env = { OPENAI_API_KEY: openaiKey };
                                else if (lib.id === 'Claude' && claudeKey) cfg.env = { ANTHROPIC_API_KEY: claudeKey };
                                addLog('system', `Linking ${lib.id}...`);
                                const result = await (ipc as any).invoke('mcp:global-add', cfg);
                                if (result.success) { addLog('system', `${lib.id} linked.`); updateMcpList(); }
                              }}
                              className={isLinked ? 'btn-chat-send' : 'btn-premium'}
                              style={{ width: 'auto', height: '32px', padding: '0 14px', borderRadius: '8px', fontSize: '0.7rem' }}
                            >
                              {isLinked ? <CheckCircle2 size={14} /> : 'LINK'}
                            </button>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                            <h4 style={{ fontWeight: 800, fontSize: '0.95rem' }}>{lib.name}</h4>
                            <span
                              onClick={() => (ipc as any).send('open-external-url', `https://www.npmjs.com/package/${lib.pkg}`)}
                              title={`Open ${lib.pkg} on npm`}
                              style={{ fontSize: '0.6rem', color: '#4facfe', cursor: 'pointer', opacity: 0.7, textDecoration: 'underline' }}
                            >npm ↗</span>
                          </div>
                          <p style={{ fontSize: '0.65rem', color: 'var(--text-dim)', marginBottom: '4px' }}>{lib.desc}</p>
                          <p style={{ fontSize: '0.6rem', color: 'rgba(255,255,255,0.2)', fontFamily: 'monospace' }}>{lib.pkg}</p>
                        </div>
                      );
                    })}
                  </div>
                </div>
                )}

                <div>
                  <div style={{ fontSize: '0.7rem', fontWeight: 900, color: 'rgba(255,255,255,0.4)', letterSpacing: '0.15em', marginBottom: '20px' }}>LINKED SERVICES ({mcpServers.length})</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {mcpServers.map((s, i) => {
                      const pkgName = s.name.split(':')[0].trim();
                      const npmUrl = `https://www.npmjs.com/package/${pkgName}`;
                      return (
                        <div key={i} className="glass-card" style={{ padding: '0.9rem 1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderRadius: '12px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                            <div className={`status-indicator ${s.status === 'online' ? 'status-online' : ''}`}></div>
                            <div>
                              <span style={{ fontWeight: 800, fontSize: '0.85rem' }}>{pkgName}</span>
                              <span
                                onClick={() => (ipc as any).send('open-external-url', npmUrl)}
                                title="Open on npm"
                                style={{ marginLeft: '8px', fontSize: '0.6rem', color: '#4facfe', cursor: 'pointer', opacity: 0.7, textDecoration: 'underline' }}
                              >npm ↗</span>
                            </div>
                          </div>
                          <button
                            onClick={async () => { await (ipc as any).invoke('mcp:global-remove', pkgName); updateMcpList(); }}
                            style={{ background: 'transparent', border: 'none', color: '#ff4b2b', cursor: 'pointer', opacity: 0.6 }}
                          >
                            <X size={18} />
                          </button>
                        </div>
                      );
                    })}
                    {mcpServers.length === 0 && (
                      <div style={{ padding: '3rem', textAlign: 'center', opacity: 0.3 }}>
                        <Database size={48} style={{ marginBottom: '15px' }} />
                        <p>No external registries linked yet.</p>
                      </div>
                    )}
                  </div>
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
                    {ghResults.length > 0 && <button type="button" onClick={() => { setGhResults([]); setGhQuery(''); }} style={{ height: '48px', padding: '0 14px', background: 'rgba(255,65,108,0.1)', border: '1px solid rgba(255,65,108,0.3)', borderRadius: '12px', color: '#ff416c', cursor: 'pointer', fontSize: '0.75rem' }}>CLEAR</button>}
                  </form>

                  {ghError && <p style={{ fontSize: '0.7rem', color: '#ff416c', marginBottom: '12px' }}>⚠ {ghError}{ghError.includes('rate limit') ? ' — Add a GitHub token in Settings to increase the limit.' : ''}</p>}

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
                            <div key={m.name} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 16px', background: 'rgba(0,255,136,0.04)', border: '1px solid rgba(0,255,136,0.2)', borderRadius: '10px' }}>
                              <span style={{ fontSize: '1.2rem' }}>🦙</span>
                              <div style={{ flex: 1 }}>
                                <span style={{ fontWeight: 800, fontSize: '0.85rem' }}>{m.name}</span>
                                <span style={{ marginLeft: '10px', fontSize: '0.65rem', color: 'var(--text-dim)' }}>{m.size} · {m.modified}</span>
                              </div>
                              <span style={{ fontSize: '0.6rem', padding: '2px 8px', background: 'rgba(0,255,136,0.1)', border: '1px solid rgba(0,255,136,0.2)', borderRadius: '4px', color: '#00ff88' }}>Ready</span>
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
                      {hfResults.length > 0 && <button type="button" onClick={() => { setHfResults([]); setOllamaSearch(''); }} style={{ height: '42px', padding: '0 12px', background: 'rgba(255,65,108,0.1)', border: '1px solid rgba(255,65,108,0.3)', borderRadius: '10px', color: '#ff416c', cursor: 'pointer', fontSize: '0.72rem' }}>Clear</button>}
                    </form>
                    {hfError && <p style={{ fontSize: '0.7rem', color: '#ff416c', marginBottom: '10px' }}>⚠ {hfError}</p>}

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
                              <div style={{ display: 'flex', gap: '10px', fontSize: '0.65rem', color: 'var(--text-dim)', marginBottom: '8px' }}>
                                <span>⬇ {formatNum(model.downloads)}</span>
                                <span>❤️ {formatNum(model.likes)}</span>
                                {model.pipeline && <span style={{ padding: '1px 6px', background: 'rgba(79,172,254,0.1)', border: '1px solid rgba(79,172,254,0.2)', borderRadius: '4px', color: '#4facfe' }}>{model.pipeline}</span>}
                              </div>
                              {isPulling && ollamaLog[model.ollamaCmd] && (
                                <div style={{ fontSize: '0.58rem', fontFamily: 'monospace', background: 'rgba(0,0,0,0.5)', padding: '6px', borderRadius: '6px', marginBottom: '8px', maxHeight: '50px', overflowY: 'auto', color: '#00ff88' }}>
                                  {ollamaLog[model.ollamaCmd].split('\n').slice(-3).join('\n')}
                                </div>
                              )}
                              <div style={{ display: 'flex', gap: '6px' }}>
                                <button onClick={() => (ipc as any).send('open-external-url', model.hfUrl)} style={{ flex: 1, height: '28px', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--glass-border)', borderRadius: '7px', color: 'var(--text-dim)', cursor: 'pointer', fontSize: '0.65rem' }}>HF ↗</button>
                                <button onClick={async () => {
                                  if (isInstalled || isPulling) return;
                                  setOllamaPulling(model.ollamaCmd);
                                  setOllamaLog(prev => ({ ...prev, [model.ollamaCmd]: '' }));
                                  await (ipc as any).invoke('ollama-pull', model.ollamaCmd);
                                  setOllamaPulling('');
                                  loadOllamaModels();
                                }} style={{ flex: 2, height: '28px', background: isInstalled ? 'rgba(0,255,136,0.1)' : isPulling ? 'rgba(255,165,0,0.1)' : 'rgba(155,77,255,0.15)', border: `1px solid ${isInstalled ? 'rgba(0,255,136,0.3)' : 'rgba(155,77,255,0.3)'}`, borderRadius: '7px', color: isInstalled ? '#00ff88' : isPulling ? 'orange' : 'var(--primary)', cursor: isInstalled || isPulling ? 'default' : 'pointer', fontSize: '0.65rem', fontWeight: 700 }}>
                                  {isInstalled ? '✅ Installed' : isPulling ? '⬇ Pulling...' : '⬇ Pull'}
                                </button>
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
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                              <span style={{ fontWeight: 800, fontSize: '0.85rem' }}>{model.label}</span>
                              <div style={{ display: 'flex', gap: '3px' }}>
                                {model.tags.map((tag: string) => <span key={tag} style={{ fontSize: '0.5rem', padding: '2px 5px', background: 'rgba(155,77,255,0.1)', border: '1px solid rgba(155,77,255,0.2)', borderRadius: '4px', color: 'var(--primary)' }}>{tag}</span>)}
                              </div>
                            </div>
                            <p style={{ fontSize: '0.65rem', color: 'var(--text-dim)', marginBottom: '10px', lineHeight: 1.4 }}>{model.desc} <span style={{ opacity: 0.5 }}>· {model.size}</span></p>
                            {isPulling && ollamaLog[model.name] && (
                              <div style={{ fontSize: '0.58rem', fontFamily: 'monospace', background: 'rgba(0,0,0,0.5)', padding: '6px', borderRadius: '6px', marginBottom: '8px', maxHeight: '50px', overflowY: 'auto', color: '#00ff88' }}>
                                {ollamaLog[model.name].split('\n').slice(-3).join('\n')}
                              </div>
                            )}
                            <button onClick={async () => {
                              if (isInstalled || isPulling) return;
                              setOllamaPulling(model.name);
                              setOllamaLog(prev => ({ ...prev, [model.name]: '' }));
                              await (ipc as any).invoke('ollama-pull', model.name);
                              setOllamaPulling('');
                              loadOllamaModels();
                            }} style={{ width: '100%', height: '30px', background: isInstalled ? 'rgba(0,255,136,0.1)' : isPulling ? 'rgba(255,165,0,0.1)' : 'rgba(155,77,255,0.15)', border: `1px solid ${isInstalled ? 'rgba(0,255,136,0.3)' : 'rgba(155,77,255,0.3)'}`, borderRadius: '8px', color: isInstalled ? '#00ff88' : isPulling ? 'orange' : 'var(--primary)', cursor: isInstalled || isPulling ? 'default' : 'pointer', fontSize: '0.7rem', fontWeight: 700 }}>
                              {isInstalled ? '✅ Installed' : isPulling ? '⬇ Pulling...' : '⬇ Pull Model'}
                            </button>
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
            <motion.div key="skills" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="glass-card full-height-panel" style={{ padding: '0', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
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
              <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--glass-border)', background: 'rgba(0,0,0,0.1)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                  <span style={{ fontSize: '0.6rem', color: 'var(--text-dim)' }}>Token Efficiency Progress</span>
                  <span style={{ fontSize: '0.6rem', color: skillEfficiency >= 90 ? '#00ff88' : 'var(--primary)' }}>{skillEfficiency}% / 90% goal</span>
                </div>
                <div style={{ height: '6px', background: 'rgba(255,255,255,0.05)', borderRadius: '3px', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${Math.min(100, skillEfficiency)}%`, background: skillEfficiency >= 90 ? 'linear-gradient(90deg,#00ff88,#4facfe)' : 'linear-gradient(90deg,var(--primary),#4facfe)', borderRadius: '3px', transition: 'width 0.5s ease' }} />
                </div>
              </div>

              {/* Skills list */}
              <div style={{ flex: 1, overflowY: 'auto', padding: '15px 20px' }}>
                <div style={{ fontSize: '0.65rem', fontWeight: 900, color: 'var(--text-dim)', letterSpacing: '0.1em', marginBottom: '12px' }}>SKILL LIBRARY</div>
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
                    { id: 'general', label: 'PREFERENCES', icon: <Settings2 size={14}/> },
                    { id: 'apis', label: 'APIs & KEYS', icon: <Key size={14}/> },
                    { id: 'sync', label: 'GITHUB & SYNC', icon: <RefreshCw size={14}/> },
                    { id: 'telemetry', label: 'TELEMETRY', icon: <Gauge size={14}/> },
                    { id: 'automation', label: 'AUTOMATION', icon: <ShieldCheck size={14}/> }
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
                    <motion.div initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                        <div style={{ fontSize: '0.7rem', fontWeight: 900, color: 'var(--primary)', letterSpacing: '0.15em' }}>SECURE CREDENTIALS</div>
                        <div style={{ position: 'relative' }}>
                          <Search size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', opacity: 0.4 }} />
                          <input value={settingsSearch} onChange={e => setSettingsSearch(e.target.value)} placeholder="Search Keys..." className="chat-input" style={{ width: '180px', paddingLeft: '30px', height: '32px', fontSize: '0.7rem' }} />
                        </div>
                      </div>
                      <div style={{ marginBottom: '20px', background: 'rgba(155,77,255,0.07)', border: '1px solid rgba(155,77,255,0.25)', borderRadius: '12px', padding: '14px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <div style={{ fontSize: '0.75rem', fontWeight: 900, color: 'var(--primary)' }}>Need a Gemini API Key?</div>
                          <div style={{ fontSize: '0.65rem', color: 'var(--text-dim)', marginTop: '3px' }}>Free tier available — powers IMI CORE + Brain with no extra software</div>
                        </div>
                        <button
                          onClick={() => (ipc as any).send('open-external-url', 'https://aistudio.google.com/apikey')}
                          className="btn-premium"
                          style={{ width: 'auto', padding: '8px 18px', fontSize: '0.65rem', whiteSpace: 'nowrap' }}
                        >
                          Get Free Key →
                        </button>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '20px' }}>
                        {[
                          { key: 'GEMINI', val: geminiKey, set: setGeminiKey, ph: 'Gemini API Key...' },
                          { key: 'JULES (GitHub)', val: julesApiKey, set: setJulesApiKey, ph: 'GitHub Token for Jules...' },
                          { key: 'GITHUB', val: githubToken, set: setGithubToken, ph: 'GitHub PAT...' },
                          { key: 'OPENAI', val: openaiKey, set: setOpenaiKey, ph: 'OpenAI Key (ChatGPT)...' },
                          { key: 'CLAUDE', val: claudeKey, set: setClaudeKey, ph: 'Claude Key...' },
                          { key: 'DEEPSEEK', val: deepseekKey, set: setDeepseekKey, ph: 'DeepSeek Key...' },
                          { key: 'MISTRAL', val: mistralKey, set: setMistralKey, ph: 'Mistral Key...' },
                          { key: 'PERPLEXITY', val: perplexityKey, set: setPerplexityKey, ph: 'Perplexity Key...' },
                          { key: 'CUSTOM (LLAMA / LOCAL)', val: customApiKey, set: setCustomApiKey, ph: 'Bearer Token (Optional)...' }
                        ].filter(item => item.key.toLowerCase().includes(settingsSearch.toLowerCase())).map(item => (
                          <div key={item.key} style={{ position: 'relative', width: '100%' }}>
                            <div style={{ fontSize: '0.65rem', fontWeight: 900, opacity: 0.6, marginBottom: '8px', letterSpacing: '0.1em' }}>{item.key} KEY</div>
                            <input type="password" value={item.val} onChange={e => item.set(e.target.value)} placeholder={item.ph} className="chat-input" style={{ width: '100%', height: '54px', fontSize: '1rem', paddingLeft: '20px', paddingRight: '45px', borderRadius: '12px' }} />
                            {item.val && <CheckCircle2 size={18} color="#00ffaa" style={{ position: 'absolute', right: '16px', top: '35px' }} />}
                          </div>
                        ))}
                      </div>

                      {/* CUSTOM ENDPOINT CONFIG */}
                      <div style={{ marginTop: '20px', display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: '15px' }}>
                         <div style={{ position: 'relative' }}>
                           <div style={{ fontSize: '0.55rem', fontWeight: 900, opacity: 0.4, marginBottom: '5px' }}>CUSTOM ENDPOINT URL (Llama/Ollama/vLLM)</div>
                           <input type="text" value={customApiUrl} onChange={e => setCustomApiUrl(e.target.value)} placeholder="e.g. http://localhost:11434/v1" className="chat-input" style={{ width: '100%', height: '40px', fontSize: '0.8rem' }} />
                         </div>
                         <div style={{ position: 'relative' }}>
                           <div style={{ fontSize: '0.55rem', fontWeight: 900, opacity: 0.4, marginBottom: '5px' }}>CUSTOM MODEL ID</div>
                           <input type="text" value={customApiModel} onChange={e => setCustomApiModel(e.target.value)} placeholder="e.g. llama3.1" className="chat-input" style={{ width: '100%', height: '40px', fontSize: '0.8rem' }} />
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
