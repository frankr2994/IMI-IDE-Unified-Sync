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
  Mic
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
  const [mcpSearch, setMcpSearch] = useState('');
  const [availableMCPs] = useState([
    { id: 'Jules', name: 'Jules Agent', pkg: '@amitdeshmukh/google-jules-mcp', desc: 'Recycling implementation engine', color: 'linear-gradient(135deg, #ff416c 0%, #ff4b2b 100%)', command: 'npx', args: ['-y', '@amitdeshmukh/google-jules-mcp'] },
    { id: 'GitHub', name: 'GitHub Sync', pkg: '@modelcontextprotocol/server-github', desc: 'Bidirectional cloud repository access', color: 'linear-gradient(135deg, #24292e 0%, #171a1d 100%)', command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'] },
    { id: 'ChatGPT', name: 'ChatGPT API', pkg: '@modelcontextprotocol/server-openai', desc: 'OpenAI context bridge', color: 'linear-gradient(135deg, #10a37f 0%, #0cebeb 100%)', command: 'npx', args: ['-y', '@modelcontextprotocol/server-openai'] },
    { id: 'Claude', name: 'Claude API', pkg: '@modelcontextprotocol/server-anthropic-chat', desc: 'Anthropic reasoning layer', color: 'linear-gradient(135deg, #da7756 0%, #f093fb 100%)', command: 'npx', args: ['-y', '@modelcontextprotocol/server-anthropic-chat'] },
    { id: 'Filesystem', name: 'Filesystem', pkg: '@modelcontextprotocol/server-filesystem', desc: 'Local directory monitoring', color: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)', command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem'] },
    { id: 'Memory', name: 'Memory', pkg: 'mcp-server-memory', desc: 'Persistent knowledge graph', color: 'linear-gradient(135deg, #9b4dff 0%, #64748b 100%)', command: 'npx', args: ['-y', 'mcp-server-memory'] }
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
  const [snapshotFrequency, setSnapshotFrequency] = useState(5);
  const [brainTemperature, setBrainTemperature] = useState(0.7);
  const [brainMaxTokens, setBrainMaxTokens] = useState(2048);
  const [brainModel, setBrainModel] = useState('gemini-2.5-flash');
  const [strategyVersion, setStrategyVersion] = useState('1.0.1');
  
  interface Log { id: number; type: string; msg: string; }
  const [logs, setLogs] = useState<Log[]>([
    { id: 1, type: 'ag', msg: 'Antigravity core loaded. Watching for changes...' },
    { id: 2, type: 'gemini', msg: 'Gemini Strategy Protocol: Enhancement roadmap generated.' },
    { id: 3, type: 'jules', msg: 'Jules Implementation Engine: Hand-off received. Implementing Settings UI expansion...' }
  ]);

  const [messages, setMessages] = useState<any[]>([]);

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

  const saveConfig = async () => {
    setIsSaving(true);
    await (ipc as any).invoke('save-api-config', { 
      geminiKey, githubToken, 
      openaiKey, claudeKey, deepseekKey, mistralKey, llamaKey, perplexityKey, customApiKey, julesApiKey, googleMapsKey, 
      activeEngine, activeDirector,
      projectRoot: projectRootInput,
      theme,
      logRetention,
      syncFrequency,
      brainTemperature,
      brainMaxTokens,
      brainModel,
      strategyVersion
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

  const handleMicClick = () => {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
      alert("Voice input is not supported in this environment yet.");
      return;
    }
    const SpeechRec = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const recognition = new SpeechRec();
    recognition.continuous = false;
    recognition.interimResults = true;

    recognition.onstart = () => setIsListening(true);
    recognition.onresult = (e: any) => {
      let finalTranscript = '';
      for (let i = e.resultIndex; i < e.results.length; ++i) {
        if (e.results[i].isFinal) {
          finalTranscript += e.results[i][0].transcript;
        }
      }
      if (finalTranscript) {
         setChatInput(prev => prev ? `${prev} ${finalTranscript}` : finalTranscript);
      }
    };
    recognition.onerror = () => setIsListening(false);
    recognition.onend = () => setIsListening(false);
    
    recognition.start();
  };

  const handleSendMessage = async () => {
    if (!chatInput.trim()) return;
    const messageId = Date.now();
    const newUserMsg = { id: messageId, type: 'user', text: chatInput };
    setMessages(prev => [...prev, newUserMsg]);
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
      setMessages(prev => prev.map(m => 
        m.id === data.messageId ? { ...m, isStreaming: false } : m
      ));
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
          <button onClick={() => setActiveTab('tools')} className={`sidebar-btn ${activeTab === 'tools' ? 'active' : ''}`}><Layers size={18}/> Global MCP</button>
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
            <motion.div key="cc" initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: '25px', height: '600px' }}>
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
                            {activeDirector === 'jules' && <Layers size={12} />}
                            {activeDirector === 'antigravity' && <Cpu size={12} />}
                            {activeDirector === 'chatgpt' && <MessageSquare size={12} />}
                            {activeDirector === 'claude' && <ShieldCheck size={12} />}
                            {activeDirector === 'mistral' && <Activity size={12} />}
                            {activeDirector === 'llama' && <Database size={12} />}
                            {activeDirector === 'perplexity' && <Search size={12} />}
                            {activeDirector === 'deepseek' && <Terminal size={12} />}
                            <span style={{ flex: 1, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {activeDirector === 'antigravity' ? 'AG AI' : activeDirector.toUpperCase()}
                            </span>
                            <ChevronRight size={12} style={{ transform: isDropdownOpen ? 'rotate(-90deg)' : 'rotate(90deg)' }} />
                          </div>
                          <AnimatePresence>
                            {isDropdownOpen && (
                              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }} style={{ position: 'absolute', bottom: 'calc(100% + 15px)', left: 0, width: '180px', background: 'rgba(20, 20, 30, 0.95)', border: '1px solid var(--glass-border)', borderRadius: '12px', zIndex: 100, overflowY: 'auto', maxHeight: '300px' }}>
                                {[
                                  { id: 'gemini', name: 'GEMINI', icon: <Zap size={12} /> },
                                  { id: 'jules', name: 'JULES', icon: <Layers size={12} /> },
                                  { id: 'antigravity', name: 'AG AI', icon: <Cpu size={12} /> },
                                  { id: 'chatgpt', name: 'CHATGPT', icon: <MessageSquare size={12} /> },
                                  { id: 'claude', name: 'CLAUDE', icon: <ShieldCheck size={12} /> },
                                  { id: 'mistral', name: 'MISTRAL', icon: <Activity size={12} /> },
                                  { id: 'llama', name: 'LLAMA 3', icon: <Database size={12} /> },
                                  { id: 'perplexity', name: 'PERPLEXITY', icon: <Search size={12} /> },
                                  { id: 'deepseek', name: 'DEEPSEEK', icon: <Terminal size={12} /> }
                                ].map(opt => (
                                  <div key={opt.id} onClick={() => { setActiveDirector(opt.id); setIsDropdownOpen(false); }} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 15px', color: '#fff', fontSize: '0.65rem', cursor: 'pointer', background: activeDirector === opt.id ? 'rgba(155, 77, 255, 0.1)' : 'transparent' }}>
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
                                <div onClick={() => { setActiveEngine('jules'); setIsCoderDropdownOpen(false); }} style={{ padding: '10px 15px', color: activeEngine === 'jules' ? '#00ff88' : '#fff', fontSize: '0.65rem', cursor: 'pointer', background: activeEngine === 'jules' ? 'rgba(0, 255, 136, 0.1)' : 'transparent', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>JULES</div>
                                <div onClick={() => { setActiveEngine('antigravity'); setIsCoderDropdownOpen(false); }} style={{ padding: '10px 15px', color: activeEngine === 'antigravity' ? '#00ff88' : '#fff', fontSize: '0.65rem', cursor: 'pointer', background: activeEngine === 'antigravity' ? 'rgba(0, 255, 136, 0.1)' : 'transparent', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>ANTIGRAVITY</div>
                                <div onClick={() => { setActiveEngine('imi-core'); setIsCoderDropdownOpen(false); }} style={{ padding: '10px 15px', color: activeEngine === 'imi-core' ? '#00ff88' : '#fff', fontSize: '0.65rem', cursor: 'pointer', background: activeEngine === 'imi-core' ? 'rgba(0, 255, 136, 0.1)' : 'transparent' }}>IMI CORE</div>
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
            <motion.div key="tools" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="glass-card" style={{ padding: '2rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '30px', alignItems: 'flex-end' }}>
                  <div>
                    <h3 style={{ fontSize: '1.8rem', fontWeight: 900 }}>Global MCP Hub</h3>
                    <p style={{ color: 'var(--text-dim)' }}>Link specialized tools into the IMI ecosystem.</p>
                  </div>
                  <div style={{ position: 'relative' }}>
                    <Search size={18} style={{ position: 'absolute', left: '15px', top: '50%', transform: 'translateY(-50%)', opacity: 0.4 }} />
                    <input 
                      value={mcpSearch} 
                      onChange={e => setMcpSearch(e.target.value)} 
                      placeholder="Search Registry..." 
                      className="chat-input" 
                      style={{ width: '300px', paddingLeft: '45px', height: '45px', fontSize: '0.85rem' }} 
                    />
                  </div>
                </div>

                <div style={{ marginBottom: '40px' }}>
                  <div style={{ fontSize: '0.7rem', fontWeight: 900, color: 'var(--primary)', letterSpacing: '0.15em', marginBottom: '20px' }}>AVAILABLE REGISTRY</div>
                  <div className="tool-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '20px' }}>
                    {availableMCPs.filter(lib => 
                      lib.name.toLowerCase().includes(mcpSearch.toLowerCase()) || 
                      lib.desc.toLowerCase().includes(mcpSearch.toLowerCase())
                    ).map(lib => {
                      const isLinked = mcpServers.some(s => s.name.toLowerCase().includes(lib.id.toLowerCase()));
                      return (
                        <div key={lib.id} className="glass-card" style={{ 
                          padding: '1.5rem', 
                          border: isLinked ? `1px solid var(--primary)` : '1px solid var(--glass-border)',
                          background: isLinked ? `rgba(155, 77, 255, 0.05)` : 'rgba(255,255,255,0.02)',
                          position: 'relative',
                          overflow: 'hidden'
                        }}>
                          <div style={{ position: 'absolute', top: 0, left: 0, width: '4px', height: '100%', background: lib.color }}></div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '15px' }}>
                            <div style={{ width: '40px', height: '40px', borderRadius: '10px', background: lib.color, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              {lib.id === 'GitHub' ? <RefreshCw size={20} /> : <Database size={20} />}
                            </div>
                            <button 
                              onClick={async () => {
                                const newServerConfig = { 
                                  name: lib.id, 
                                  command: lib.command, 
                                  args: lib.args, 
                                  env: {} as any 
                                };
                                // Auto-inject keys if they exist
                                if (lib.id === 'Jules' && julesApiKey) newServerConfig.env = { JULES_API_KEY: julesApiKey, GOOGLE_API_KEY: julesApiKey };
                                else if (lib.id === 'GitHub' && githubToken) newServerConfig.env = { GITHUB_PERSONAL_ACCESS_TOKEN: githubToken };
                                else if (lib.id === 'ChatGPT' && openaiKey) newServerConfig.env = { OPENAI_API_KEY: openaiKey };
                                else if (lib.id === 'Claude' && claudeKey) newServerConfig.env = { ANTHROPIC_API_KEY: claudeKey };

                                addLog('system', `Linking ${lib.id}...`);
                                const result = await (ipc as any).invoke('mcp:global-add', newServerConfig);
                                if (result.success) {
                                  addLog('system', `${lib.id} integration successful.`);
                                  updateMcpList();
                                }
                              }} 
                              className={isLinked ? "btn-chat-send" : "btn-premium"}
                              style={{ width: 'auto', height: '35px', padding: '0 15px', borderRadius: '8px', fontSize: '0.7rem' }}
                            >
                              {isLinked ? <CheckCircle2 size={16} /> : 'LINK'}
                            </button>
                          </div>
                          <h4 style={{ fontWeight: 800, fontSize: '1rem', marginBottom: '5px' }}>{lib.name}</h4>
                          <p style={{ fontSize: '0.75rem', color: 'var(--text-dim)', lineHeight: '1.4' }}>{lib.desc}</p>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <div style={{ fontSize: '0.7rem', fontWeight: 900, color: 'rgba(255,255,255,0.4)', letterSpacing: '0.15em', marginBottom: '20px' }}>LINKED SERVICES ({mcpServers.length})</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {mcpServers.map((s, i) => (
                      <div key={i} className="glass-card" style={{ padding: '1rem 1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderRadius: '15px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                          <div className={`status-indicator ${s.status === 'online' ? 'status-online' : ''}`}></div>
                          <span style={{ fontWeight: 800, fontSize: '0.9rem' }}>{s.name}</span>
                        </div>
                        <button 
                          onClick={async () => {
                            const name = s.name.split(':')[0].trim();
                            await (ipc as any).invoke('mcp:global-remove', name);
                            updateMcpList();
                          }}
                          style={{ background: 'transparent', border: 'none', color: '#ff4b2b', cursor: 'pointer', opacity: 0.6 }}
                        >
                          <X size={18} />
                        </button>
                      </div>
                    ))}
                    {mcpServers.length === 0 && (
                      <div style={{ padding: '3rem', textAlign: 'center', opacity: 0.3 }}>
                        <Database size={48} style={{ marginBottom: '15px' }} />
                        <p>No external registries linked yet.</p>
                      </div>
                    )}
                  </div>
                </div>
            </motion.div>
          )}

          {activeTab === 'settings' && (
            <motion.div key="settings" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="glass-card" style={{ padding: '0', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
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
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }}>
                        {[
                          { key: 'GEMINI', val: geminiKey, set: setGeminiKey, ph: 'Gemini API Key...' },
                          { key: 'JULES', val: julesApiKey, set: setJulesApiKey, ph: 'Jules AI Token...' },
                          { key: 'GITHUB', val: githubToken, set: setGithubToken, ph: 'GitHub PAT...' },
                          { key: 'OPENAI', val: openaiKey, set: setOpenaiKey, ph: 'OpenAI Key (ChatGPT)...' },
                          { key: 'CLAUDE', val: claudeKey, set: setClaudeKey, ph: 'Claude Key...' },
                          { key: 'DEEPSEEK', val: deepseekKey, set: setDeepseekKey, ph: 'DeepSeek Key...' },
                          { key: 'MISTRAL', val: mistralKey, set: setMistralKey, ph: 'Mistral Key...' },
                          { key: 'LLAMA', val: llamaKey, set: setLlamaKey, ph: 'Llama 3 (API)...' },
                          { key: 'PERPLEXITY', val: perplexityKey, set: setPerplexityKey, ph: 'Perplexity Key...' }
                        ].filter(item => item.key.toLowerCase().includes(settingsSearch.toLowerCase())).map(item => (
                          <div key={item.key} style={{ position: 'relative' }}>
                            <div style={{ fontSize: '0.55rem', fontWeight: 900, opacity: 0.4, marginBottom: '5px' }}>{item.key}</div>
                            <input type="password" value={item.val} onChange={e => item.set(e.target.value)} placeholder={item.ph} className="chat-input" style={{ width: '100%', height: '40px', fontSize: '0.8rem' }} />
                            {item.val && <CheckCircle2 size={12} color="#00ffaa" style={{ position: 'absolute', right: '12px', top: '28px' }} />}
                          </div>
                        ))}
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
