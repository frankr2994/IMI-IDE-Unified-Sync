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
  History
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
  const [isExporting, setIsExporting] = useState(false);
  const [stats, setStats] = useState<any>({ fileCount: '0', sizeMB: '0', freeMem: '0', platform: '...', dirCount: '0', projectRoot: '' });
  const [usage, setUsage] = useState({ cpu: '0', ram: '0', threads: 0, load: '0' });
  const [tokenUsage, setTokenUsage] = useState({ gemini: 0 });
  const [activeDirector, setActiveDirector] = useState('gemini');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [mcpServers, setMcpServers] = useState<any[]>([]);
  const [newServer, setNewServer] = useState({ name: '', command: '', args: '', env: {} });
  const [chatInput, setChatInput] = useState('');
  const [mcpSearch, setMcpSearch] = useState('');
  const [availableMCPs] = useState([
    { name: 'Memory', pkg: 'mcp-server-memory', desc: 'Persistent graph memory' },
    { name: 'Filesystem', pkg: '@modelcontextprotocol/server-filesystem', desc: 'Local file access' },
    { name: 'Google Maps', pkg: '@modelcontextprotocol/server-google-maps', desc: 'Location data' }
  ]);
  const [projectRootInput, setProjectRootInput] = useState('');
  const [geminiKey, setGeminiKey] = useState('');
  const [githubToken, setGithubToken] = useState('');
  const [openaiKey, setOpenaiKey] = useState('');
  const [claudeKey, setClaudeKey] = useState('');
  const [customApiKey, setCustomApiKey] = useState('');
  const [julesApiKey, setJulesApiKey] = useState('');
  const [googleMapsKey, setGoogleMapsKey] = useState('');
  const [activeEngine, setActiveEngine] = useState('gemini');
  const [gitInstalled, setGitInstalled] = useState(true);
  const [settingsActiveSubTab, setSettingsActiveSubTab] = useState('general');
  const [settingsSearch, setSettingsSearch] = useState('');
  const [lastSnapshot, setLastSnapshot] = useState<any>(null);
  const [snapshotMode, setSnapshotMode] = useState(true);
  const [theme, setTheme] = useState('glass');
  const [logRetention, setLogRetention] = useState(10);
  const [snapshotFrequency, setSnapshotFrequency] = useState(5);
  
  interface Log { id: number; type: string; msg: string; }
  const [logs, setLogs] = useState<Log[]>([
    { id: 1, type: 'ag', msg: 'Antigravity core loaded. Watching for changes...' },
    { id: 2, type: 'gemini', msg: 'Gemini Strategy Protocol: Enhancement roadmap generated.' },
    { id: 3, type: 'jules', msg: 'Jules Implementation Engine: Hand-off received. Implementing Settings UI expansion...' }
  ]);

  const [messages, setMessages] = useState<any[]>([
    { id: 0, type: 'system', text: 'Unified Sync Hub initialized. All commands are broadcasted to Gemini CLI.' }
  ]);

  const addLog = (type: string, msg: string) => {
    setLogs(prev => [...prev.slice(-4), { id: Date.now(), type, msg }]);
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
      // Capture any line that looks like a server entry (starts with ●, ○, or ✗)
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
      setCustomApiKey(config.customApiKey || '');
      setJulesApiKey(config.julesApiKey || '');
      setActiveEngine(config.activeEngine || 'gemini');
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
      alert('Project Root Updated!');
      fetchStats();
    } else {
      alert('Error: ' + result.error);
    }
  };

  const saveConfig = async () => {
    await (ipc as any).invoke('save-api-config', { 
      geminiKey, githubToken, 
      openaiKey, claudeKey, customApiKey, julesApiKey, googleMapsKey, activeEngine 
    });
    // Silent background sync for premium UX
  };

  const connectMCPServer = async () => {
    if (!newServer.name || !newServer.command) return;

    const { name, command, args, env } = newServer;

    addLog('system', `Linking ${name}...`);

    // 1. Remove if already exists to prevent duplication issues
    await (ipc as any).invoke('mcp:global-remove', name);
    
    // 2. Add the new one
    // Ensure args is passed as an array to the bridge
    const finalArgs = typeof args === 'string' ? args.split(' ').filter(a => a) : args;

    const result = await (ipc as any).invoke('mcp:global-add', { 
      name, 
      command, 
      args: finalArgs,
      env 
    });

    if (result.success) {
      addLog('system', `${name} is now linked and synced!`);
      await updateMcpList();
      setNewServer({ name: '', command: '', args: '', env: {} });
      fetchStats();
    } else {
      alert('Link Failed: ' + result.error);
    }
  };

  const removeMCPServer = async (name: string) => {
    // Correctly strip symbols AND the separator colon for zero-entropy matching
    const cleanName = name.replace(/[●○]/g, '').trim().split(':')[0].trim();
    const result = await (ipc as any).invoke('mcp:global-remove', cleanName);
    if (result.success) {
      addLog('system', result.msg);
      await updateMcpList(); // 🚀 Refresh UI immediately
    }
  };

  const handleSendMessage = async () => {
    if (!chatInput.trim()) return;
    const messageId = Date.now();
    const newUserMsg = { id: messageId, type: 'user', text: chatInput };
    setMessages(prev => [...prev, newUserMsg]);
    setChatInput('');
    setIsSyncing(true);
    
    // Create initial streaming AI response placeholder
    const aiId = messageId + 1;
    const aiResponse = { 
      id: aiId, 
      type: 'ai', 
      director: activeDirector,
      text: '',
      isStreaming: true
    };
    setMessages(prev => [...prev, aiResponse]);

    addLog('ag', `Broadcasting Stream to ${activeDirector}: ${newUserMsg.text}`);
    
    if (snapshotMode) {
      await (ipc as any).invoke('save-context-snapshot', {
        lastQuery: chatInput,
        activeDirector,
        status: 'Handing over to alternative model'
      });
    }

    // Call the streaming backend
    (ipc as any).send('execute-command-stream', { 
      command: newUserMsg.text, 
      director: activeDirector,
      messageId: aiId
    });
  };

  // syncJules functionality removed.


  useEffect(() => {
    fetchStats();
    loadConfig();
    
    // Auto-refresh disabled to prevent App Installer spam on Windows.
    // fetchStats will now only run on load or manual trigger.
    
    // COMMAND STREAMING LISTENERS
    const handleChunk = (_: any, { messageId, chunk }: any) => {
      setMessages(prev => prev.map(m => 
        m.id === messageId ? { ...m, text: m.text + chunk } : m
      ));
    };

    const handleEnd = (_: any, { messageId }: any) => {
      setMessages(prev => prev.map(m => 
        m.id === messageId ? { ...m, isStreaming: false } : m
      ));
      setIsSyncing(false);
      fetchStats();
    };

    const handleError = (_: any, { messageId, error }: any) => {
      setMessages(prev => prev.map(m => 
        m.id === messageId ? { ...m, text: m.text + '\n[Bridge Error]: ' + error, isStreaming: false } : m
      ));
      setIsSyncing(false);
    };

    const handleDirective = (_: any, directive: any) => {
      const systemMsg = {
        id: Date.now(),
        type: 'system',
        text: `🚀 [ASOS DIRECTIVE]: ${directive.message}\n\nURGENCY: ${directive.urgency.toUpperCase()}\nRECOMMENDED ACTION: ${directive.action}`,
        isAlert: true
      };
      setMessages(prev => [...prev, systemMsg]);
      addLog('system', `ASOS Optimizer: ${directive.message}`);
    };

    if (ipc.on) {
      ipc.on('command-chunk', handleChunk);
      ipc.on('command-end', handleEnd);
      ipc.on('command-error', handleError);
      ipc.on('system-directive', handleDirective);
    }
    
    // Check Git and auto-fetch profile if token exists
    const initApp = async () => {
      const gitStatus = await (ipc as any).invoke('check-git-status');
      setGitInstalled(gitStatus.installed);

      const config = await (ipc as any).invoke('get-api-config');
      if (config.githubToken) {
        const result = await (ipc as any).invoke('fetch-github-profile');
        if (result.success) setGithubUser(result.user);
      }
    };
    initApp();

    return () => {
      if (ipc.removeAllListeners) {
        ipc.removeAllListeners('command-chunk');
        ipc.removeAllListeners('command-end');
        ipc.removeAllListeners('command-error');
      }
    };
  }, []); // LOCKDOWN: No automatic refetch on tab change.

  const [githubUrl, setGithubUrl] = useState('');
  const [isLinking, setIsLinking] = useState(false);

  const [githubUser, setGithubUser] = useState<any>(null);

  const linkExistingGithub = async () => {
    // 1. Sync token to backend first if provided in the field
    if (githubToken) {
      await (ipc as any).invoke('save-api-config', { geminiKey, githubToken, activeEngine });
    }

    const result = await (ipc as any).invoke('fetch-github-profile');
    if (result.success) {
      setGithubUser(result.user);
    } else {
      alert('Error: ' + result.error + '. Please paste your GitHub Token in the API Orchestration section below first!');
    }
  };

  const handleAutoLinkGithub = async () => {
    if (!githubUrl) return alert('Please enter your new GitHub Repo URL first.');
    setIsLinking(true);
    const result = await (ipc as any).invoke('git-init', githubUrl);
    if (result.success) alert(result.msg);
    else alert('Git Error: ' + result.error);
    setIsLinking(false);
  };

  const openGitHub = () => {
    (ipc as any).send('open-external', 'https://github.com/new');
  };

  const renderContent = (text: string) => {
    if (!text) return null;
    return text.split('\n').map((line, idx) => {
      // Basic bolding: **word** -> <strong>word</strong>
      const processed = line.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
      
      if (line.trim().startsWith('* ') || line.trim().startsWith('- ')) {
        const content = processed.trim().substring(2);
        return <li key={idx} dangerouslySetInnerHTML={{ __html: content }} style={{ marginBottom: '5px', listStyleType: 'disc', marginLeft: '20px' }} />;
      }
      return <p key={idx} dangerouslySetInnerHTML={{ __html: processed }} style={{ marginBottom: '10px' }} />;
    });
  };

  return (
    <div className="dashboard-container">
      <div className="title-bar">
        <div className="window-controls">
          <button onClick={() => ipc.send('window-minimize')} className="control-btn"><Minus size={16} /></button>
          <button onClick={() => ipc.send('window-maximize')} className="control-btn"><Maximize2 size={16} /></button>
          <button onClick={() => ipc.send('window-close')} className="control-btn close"><X size={16} /></button>
        </div>
      </div>

      <aside className="sidebar">
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ padding: '10px', background: 'var(--primary)', borderRadius: '12px' }}>
            <Zap size={24} color="#fff" />
          </div>
          <h1 className="title-gradient" style={{ fontSize: '1.2rem', fontWeight: 900 }}>IMI INTEGRATIONS</h1>
        </div>

        <nav style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '30px' }}>
          {[
            { id: 'dashboard', icon: <Layers size={20} />, label: 'Dashboard' },
            { id: 'command center', icon: <MessageSquare size={20} />, label: 'Command Center' },
            { id: 'tools', icon: <Cpu size={20} />, label: 'Tools Hub' },
            { id: 'quota', icon: <ShieldCheck size={20} />, label: 'Quota System' },
            { id: 'settings', icon: <Settings size={20} />, label: 'Settings' }
          ].map(tab => (
            <button 
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={activeTab === tab.id ? 'sidebar-btn active' : 'sidebar-btn'}
              style={{
                display: 'flex', alignItems: 'center', gap: '15px',
                padding: '14px 1.2rem', borderRadius: '12px', border: 'none',
                background: activeTab === tab.id ? 'rgba(138,43,226,0.15)' : 'transparent',
                color: activeTab === tab.id ? '#fff' : 'rgba(255,255,255,0.4)',
                cursor: 'pointer', transition: 'all 0.3s', textAlign: 'left', fontWeight: 600
              }}
            >
              {tab.icon} {tab.label}
            </button>
          ))}
        </nav>

        <div style={{ marginTop: 'auto', padding: '1.5rem', background: 'rgba(0,0,0,0.2)', borderRadius: '15px', border: '1px solid var(--glass-border)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'rgba(255,255,255,0.4)', marginBottom: '8px' }}>
            <span>Project Vitality</span>
            <span style={{ color: '#00ff88' }}>{usage.cpu}% CPU</span>
          </div>
          <div className="quota-bar"><div className="quota-fill" style={{ width: `${usage.cpu}%` }}></div></div>
        </div>
      </aside>

      <main className="main-content">
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2.5rem' }}>
          <div>
            <h2 style={{ fontSize: '2.2rem', fontWeight: 800, letterSpacing: '-1px' }}>
              {activeTab === 'dashboard' && 'System Overview'}
              {activeTab === 'command center' && 'Global Command Center'}
              {activeTab === 'tools' && 'MCP Tool Registries'}
              {activeTab === 'quota' && 'Token Quota Management'}
              {activeTab === 'settings' && 'System Configuration'}
            </h2>
            <p style={{ color: 'var(--text-dim)', marginTop: '8px' }}>
              Connected Storage: <span style={{ color: 'var(--primary)', fontWeight: 600 }}>{stats.projectRoot || 'Searching for root...'}</span>
            </p>
          </div>
          <div style={{ display: 'flex', gap: '15px' }}>
            <div className="glass-card" style={{ padding: '10px 20px', display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{ width: '8px', height: '8px', background: '#00ff88', borderRadius: '50%', boxShadow: '0 0 10px #00ff88' }}></div>
              <span style={{ fontSize: '0.8rem', fontWeight: 700 }}>REPOS SYNCED</span>
            </div>
            <div className="glass-card" style={{ padding: '10px 20px', display: 'flex', alignItems: 'center', gap: '10px', border: '1px solid #00ff8844' }}>
              <ShieldCheck size={16} color="#00ff88" />
              <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#00ff88' }}>SAFE MODE: ACTIVE</span>
            </div>
            <button onClick={handleExport} disabled={isExporting} className="btn-premium" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              {isExporting ? <RefreshCw size={18} className="spin" /> : <Download size={18} />} Export Hub
            </button>
          </div>
        </header>

        <AnimatePresence mode="wait">
          {activeTab === 'dashboard' && (
            <motion.div key="db" initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -15 }}>
                {/* 🚀 ELITE MODEL ROUTING HUB */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '25px', marginBottom: '40px' }}>
                   {/* ROLE 1: THE VOICE (Strategy & Planning) */}
                   <div className="glass-card" style={{ padding: '20px', border: '1px solid var(--glass-border)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
                        <div style={{ fontWeight: 900, fontSize: '0.75rem', letterSpacing: '0.1em', color: '#4facfe' }}>ACTIVE VOICE (STRATEGY)</div>
                        <div style={{ fontSize: '0.6rem', opacity: 0.5 }}>WHO YOU TALK TO</div>
                      </div>
                      <div style={{ display: 'flex', gap: '10px' }}>
                        {[
                          { id: 'gemini', name: 'Gemini', color: '#4facfe' },
                          { id: 'chatgpt', name: 'ChatGPT', color: '#10a37f', linked: mcpServers.some(s => s.name.toLowerCase().includes('chatgpt')) },
                          { id: 'claude', name: 'Claude', color: '#da7756', linked: mcpServers.some(s => s.name.toLowerCase().includes('claude')) }
                        ].map(m => (
                          <button 
                            key={m.id}
                            onClick={() => { setActiveDirector(m.id); saveConfig(); }}
                            style={{ 
                              flex: 1, padding: '10px', borderRadius: '10px', border: '1px solid var(--glass-border)',
                              background: activeDirector === m.id ? m.color : 'rgba(255,255,255,0.02)',
                              color: activeDirector === m.id ? '#fff' : 'rgba(255,255,255,0.4)',
                              fontWeight: 800, fontSize: '0.75rem', cursor: 'pointer',
                              boxShadow: activeDirector === m.id ? `0 0 15px ${m.color}66` : 'none',
                              opacity: (m.id === 'gemini' || m.linked) ? 1 : 0.3, transition: 'all 0.3s'
                            }}
                          >
                            {m.name}
                          </button>
                        ))}
                      </div>
                   </div>

                   {/* ROLE 2: THE AGENCY (Implementation) */}
                   <div className="glass-card" style={{ padding: '20px', border: '1px solid var(--glass-border)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
                        <div style={{ fontWeight: 900, fontSize: '0.75rem', letterSpacing: '0.1em', color: '#00ff88' }}>ACTIVE AGENCY (CODE)</div>
                        <div style={{ fontSize: '0.6rem', opacity: 0.5 }}>WHO WRITES THE CODE</div>
                      </div>
                      <div style={{ display: 'flex', gap: '10px' }}>
                        {[
                          { id: 'jules', name: 'Jules', color: '#ff416c', disabled: !julesApiKey },
                          { id: 'antigravity', name: 'AG AI', color: '#00ff88' }
                        ].map(m => (
                          <button 
                            key={m.id}
                            disabled={m.disabled}
                            onClick={() => { setActiveEngine(m.id); saveConfig(); }}
                            style={{ 
                              flex: 1, padding: '10px', borderRadius: '10px', border: '1px solid var(--glass-border)',
                              background: activeEngine === m.id ? m.color : 'rgba(255,255,255,0.02)',
                              color: activeEngine === m.id ? '#fff' : 'rgba(255,255,255,0.4)',
                              fontWeight: 800, fontSize: '0.75rem', cursor: m.disabled ? 'not-allowed' : 'pointer',
                              boxShadow: activeEngine === m.id ? `0 0 15px ${m.color}66` : 'none',
                              opacity: m.disabled ? 0.3 : 1, transition: 'all 0.3s'
                            }}
                          >
                            {m.name}
                          </button>
                        ))}
                      </div>
                   </div>
                </div>
              {/* 🛡️ INTELLIGENCE OVERSIGHT: THE DYNAMIC DASHBOARD */}
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(300px, 1fr) 350px', gap: '25px', marginBottom: '40px' }}>
                  {/* LEFT: PRIMARY AGENT DYNAMICS */}
                  <div className="glass-card" style={{ padding: '2rem', position: 'relative', overflow: 'hidden', minHeight: '350px' }}>
                     {/* Contextual Glow based on active agent */}
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
                           <p style={{ fontSize: '0.8rem', opacity: 0.4, marginTop: '8px' }}>
                             {activeEngine === 'jules' ? 'Offloading heavy analysis to Google Cloud.' : 'Running neural operations on local silicon.'}
                           </p>
                        </div>
                        <div>
                           <div style={{ opacity: 0.5, fontSize: '0.7rem', fontWeight: 700, marginBottom: '10px' }}>SYNC LATENCY</div>
                           <div style={{ fontSize: '1.2rem', fontWeight: 800 }}>{activeEngine === 'jules' ? '450ms (Round-Trip)' : '1ms (Direct Node)'}</div>
                           <p style={{ fontSize: '0.8rem', opacity: 0.4, marginTop: '8px' }}>
                             {activeEngine === 'jules' ? 'Authenticated via Jules API Security.' : 'Bypassing cloud layers for maximum speed.'}
                           </p>
                        </div>
                     </div>

                     <div className="terminal-mock" style={{ marginTop: '30px', background: 'rgba(0,0,0,0.4)', borderRadius: '12px', padding: '20px', fontSize: '0.85rem' }}>
                        <span style={{ color: activeEngine === 'jules' ? '#ff416c' : '#00ff88', fontWeight: 900 }}>[SYS] RECOVERY POINT: </span>
                        <span style={{ opacity: 0.6 }}>{lastSnapshot ? new Date(lastSnapshot.timestamp).toLocaleString() : 'No snapshot created yet.'}</span>
                        <div style={{ marginTop: '10px', height: '60px', overflow: 'hidden', opacity: 0.4, fontSize: '0.75rem', fontFamily: 'monospace' }}>
                           {logs.filter(l => l.type === (activeEngine === 'jules' ? 'jules' : 'ag')).slice(-3).map(l => (
                             <div key={l.id}>{new Date().toLocaleTimeString()} {' > '} {l.msg}</div>
                           ))}
                        </div>
                     </div>
                  </div>

                  {/* RIGHT: REAL-TIME TELEMETRY (Merged Gauge) */}
                  <div className="glass-card" style={{ padding: '2rem', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                     <div>
                        <div style={{ fontSize: '0.75rem', fontWeight: 900, color: 'rgba(255,255,255,0.4)', letterSpacing: '0.1em' }}>RESOURCE TELEMETRY</div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '20px' }}>
                           <div style={{ fontWeight: 800, fontSize: '0.9rem' }}>CPU THRESHOLD</div>
                           <div style={{ color: '#00d2ff', fontWeight: 900 }}>{usage.cpu}%</div>
                        </div>
                        <div className="quota-bar" style={{ height: '8px', marginTop: '10px' }}><div className="quota-fill" style={{ width: `${usage.cpu}%`, background: 'linear-gradient(90deg, #4facfe 0%, #00f2fe 100%)' }}></div></div>
                        
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '25px' }}>
                           <div style={{ fontWeight: 800, fontSize: '0.9rem' }}>MEMORY SATURATION</div>
                           <div style={{ color: '#00ff88', fontWeight: 900 }}>{(parseFloat(usage.ram) / 64 * 100).toFixed(1)}%</div>
                        </div>
                        <div className="quota-bar" style={{ height: '8px', marginTop: '10px' }}><div className="quota-fill" style={{ width: `${(parseFloat(usage.ram) / 64 * 100)}%`, background: 'linear-gradient(90deg, #0cebeb 0%, #20e2d7 100%)' }}></div></div>
                     </div>

                     <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }}>
                        <button onClick={fetchStats} className="btn-premium" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', padding: '12px' }}>
                           <RefreshCw size={14} /> RE-SCAN
                        </button>
                        <button onClick={() => alert('Full System Diagnostic: ALL NODES ONLINE.')} className="btn-premium" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid var(--glass-border)', padding: '12px' }}>
                           DIAGNOSTIC
                        </button>
                     </div>
                  </div>
              </div>

              <div className="glass-card" style={{ marginTop: '25px', padding: '2rem', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '20px' }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ color: 'var(--text-dim)', fontSize: '0.8rem', textTransform: 'uppercase' }}>CPU LOAD</div>
                  <div style={{ fontSize: '1.8rem', fontWeight: 900, color: Number(usage.cpu) > 50 ? '#ffab00' : '#fff' }}>{usage.cpu}%</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ color: 'var(--text-dim)', fontSize: '0.8rem', textTransform: 'uppercase' }}>MEMORY USE</div>
                  <div style={{ fontSize: '1.8rem', fontWeight: 900 }}>{usage.ram} GB</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ color: 'var(--text-dim)', fontSize: '0.8rem', textTransform: 'uppercase' }}>THREADS</div>
                  <div style={{ fontSize: '1.8rem', fontWeight: 900 }}>{usage.threads}</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ color: 'var(--text-dim)', fontSize: '0.8rem', textTransform: 'uppercase' }}>IO LOAD</div>
                  <div style={{ fontSize: '1.8rem', fontWeight: 900 }}>{usage.load}</div>
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === 'command center' && (
            <motion.div key="cc" initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: '25px', height: '600px' }}>
              <div className="glass-card chat-interface" style={{ display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden' }}>
                <div style={{ padding: '1rem 2rem', background: 'rgba(255,255,255,0.03)', display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--glass-border)' }}>
                  <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                    <div className="spin"><RefreshCw size={14} color="var(--primary)" /></div>
                    <span style={{ fontWeight: 800, fontSize: '0.8rem', letterSpacing: '0.05em' }}>ORCHESTRATOR BROADCAST</span>
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
                            {m.isStreaming && (
                              <div className="pulse-slow" style={{ background: 'rgba(0,255,136,0.1)', color: '#00ff88', fontSize: '0.55rem', padding: '1px 6px', borderRadius: '4px', fontWeight: 800 }}>
                                ● LIVE
                              </div>
                            )}
                          </div>
                        )}
                        <div className="chat-bubble-content" style={{ fontSize: '0.9rem', lineHeight: '1.5' }}>
                          {renderContent(m.text)}
                          {m.isStreaming && <span className="cursor-blink">|</span>}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <div style={{ padding: '1rem', borderTop: '1px solid var(--glass-border)', background: 'rgba(0,0,0,0.2)' }}>
                    <form onSubmit={e => {e.preventDefault(); handleSendMessage();}} style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      <div style={{ 
                        flex: 1, display: 'flex', alignItems: 'center', background: 'rgba(0,0,0,0.3)', 
                        border: '1px solid var(--glass-border)', borderRadius: '12px', overflow: 'visible',
                        transition: 'all 0.3s'
                      }} className="chat-input-container">
                        <div style={{ position: 'relative' }}>
                          <div 
                            onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                            style={{ 
                              display: 'flex', alignItems: 'center', gap: '8px',
                              width: '130px', padding: '0 15px', background: 'rgba(155, 77, 255, 0.1)', 
                              borderRight: '1px solid var(--glass-border)', borderTopLeftRadius: '12px', borderBottomLeftRadius: '12px',
                              color: 'var(--primary)', fontWeight: 900, fontSize: '0.65rem', 
                              textTransform: 'uppercase', letterSpacing: '0.1em', height: '40px',
                              cursor: 'pointer', outline: 'none'
                            }}
                          >
                            {activeDirector === 'gemini' && <Zap size={14} />}
                            {activeDirector === 'jules' && <Layers size={14} />}
                            {activeDirector === 'antigravity' && <Cpu size={14} />}
                            <span style={{ flex: 1, textAlign: 'left' }}>
                              {activeDirector === 'antigravity' ? 'AG AI' : activeDirector}
                            </span>
                            <ChevronRight size={14} style={{ transform: isDropdownOpen ? 'rotate(-90deg)' : 'rotate(90deg)', transition: 'transform 0.2s' }} />
                          </div>
                          
                          <AnimatePresence>
                            {isDropdownOpen && (
                              <motion.div 
                                initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }}
                                style={{ 
                                  position: 'absolute', bottom: 'calc(100% + 5px)', left: 0, width: '150px',
                                  background: 'rgba(20, 20, 30, 0.95)', backdropFilter: 'blur(20px)',
                                  border: '1px solid var(--glass-border)', borderRadius: '12px',
                                  boxShadow: '0 -10px 40px rgba(0,0,0,0.5)', overflow: 'hidden', zIndex: 100
                                }}
                              >
                                {[
                                  { id: 'gemini', name: 'GEMINI', icon: <Zap size={14} /> },
                                  { id: 'jules', name: 'JULES', icon: <Layers size={14} /> },
                                  { id: 'antigravity', name: 'AG AI', icon: <Cpu size={14} /> }
                                ].map(opt => (
                                  <div 
                                    key={opt.id}
                                    onClick={() => { setActiveDirector(opt.id); setIsDropdownOpen(false); }}
                                    style={{ 
                                      display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 15px',
                                      color: activeDirector === opt.id ? 'var(--primary)' : 'rgba(255,255,255,0.6)',
                                      fontWeight: 800, fontSize: '0.65rem', letterSpacing: '0.1em', cursor: 'pointer',
                                      background: activeDirector === opt.id ? 'rgba(155, 77, 255, 0.1)' : 'transparent',
                                      borderBottom: '1px solid rgba(255,255,255,0.05)'
                                    }}
                                  >
                                    {opt.icon}
                                    {opt.name}
                                  </div>
                                ))}
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                        <input 
                          value={chatInput} 
                          onChange={e => setChatInput(e.target.value)} 
                          type="text" 
                          placeholder={`Message...`} 
                          style={{ 
                            flex: 1, background: 'transparent', border: 'none', padding: '0 15px', 
                            color: 'white', fontSize: '0.9rem', outline: 'none', height: '40px' 
                          }} 
                        />
                      </div>
                      <button type="submit" className="btn-chat-send" style={{ width: '40px', height: '40px' }}><Send size={16}/></button>
                    </form>
                </div>
              </div>
              
              <div className="devtools-panel">
                 <div className="devtools-header" style={{ padding: '10px 15px', background: 'rgba(255,255,255,0.02)', borderBottom: '1px solid var(--glass-border)', display: 'flex', justifyContent: 'space-between', fontSize: '0.65rem', fontWeight: 900, color: 'var(--text-dim)' }}>
                    <span>SYS CONSOLE</span>
                    <span style={{ color: '#00ff88' }}>● BRIDGE ACTIVE</span>
                 </div>
                 <div className="devtools-content" style={{ height: '515px', padding: '15px', overflowY: 'auto', fontSize: '0.75rem', fontFamily: 'monospace' }}>
                    {logs.slice(-15).map(l => (
                      <div key={l.id} style={{ marginBottom: '6px', color: l.type === 'ag' ? '#00ff88' : (l.type === 'gemini' ? '#4facfe' : '#ffffff88') }}>
                        <span style={{ opacity: 0.4 }}>[{new Date(l.id).toLocaleTimeString()}]</span> {l.msg}
                      </div>
                    ))}
                    {logs.length === 0 && <div style={{ color: '#ffffff44' }}>Waiting for system events...</div>}
                    <div className="cursor-blink" style={{ display: 'inline-block', width: '8px', height: '14px', background: 'var(--primary)', marginLeft: '5px' }}></div>
                 </div>
              </div>
            </motion.div>
          )}

          {activeTab === 'tools' && (
            <motion.div key="tools" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="glass-card" style={{ padding: '2rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '30px' }}>
                  <div>
                    <h3 style={{ fontSize: '1.6rem', fontWeight: 800 }}>Global MCP Hub</h3>
                    <p style={{ color: 'var(--text-dim)' }}>Link specialized tools into the Gemini CLI ecosystem.</p>
                  </div>
                  <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-end' }}>
                    {newServer.name.toLowerCase().includes('github') && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                        <label style={{ fontSize: '0.65rem', fontWeight: 900, color: 'var(--secondary)', textTransform: 'uppercase' }}>GitHub PAT</label>
                        <input type="password" value={githubToken} onChange={e => { setGithubToken(e.target.value); saveConfig(); }} placeholder="Paste GitHub Token..." className="chat-input" style={{ width: '220px', borderColor: githubToken ? 'var(--secondary)' : '#ff6b6b' }} />
                      </div>
                    )}
                    {(newServer.name.toLowerCase().includes('jules')) && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                        <label style={{ fontSize: '0.65rem', fontWeight: 900, color: '#ff416c', textTransform: 'uppercase' }}>Jules API Key</label>
                        <input type="password" value={julesApiKey} onChange={e => { setJulesApiKey(e.target.value); saveConfig(); }} placeholder="Paste Jules Key..." className="chat-input" style={{ width: '220px', borderColor: julesApiKey ? '#ff416c' : '#ff6b6b' }} />
                      </div>
                    )}
                    {newServer.name.toLowerCase().includes('chatgpt') && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                        <label style={{ fontSize: '0.65rem', fontWeight: 900, color: '#10a37f', textTransform: 'uppercase' }}>OpenAI (GPT) Key</label>
                        <input type="password" value={openaiKey} onChange={e => { setOpenaiKey(e.target.value); saveConfig(); }} placeholder="sk-..." className="chat-input" style={{ width: '220px', borderColor: openaiKey ? '#10a37f' : '#ff6b6b' }} />
                      </div>
                    )}
                    {newServer.name.toLowerCase().includes('claude') && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                        <label style={{ fontSize: '0.65rem', fontWeight: 900, color: '#da7756', textTransform: 'uppercase' }}>Claude (Anthropic) Key</label>
                        <input type="password" value={claudeKey} onChange={e => { setClaudeKey(e.target.value); saveConfig(); }} placeholder="sk-ant-..." className="chat-input" style={{ width: '220px', borderColor: claudeKey ? '#da7756' : '#ff6b6b' }} />
                      </div>
                    )}
                    {newServer.name.toLowerCase().includes('google') && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                        <label style={{ fontSize: '0.65rem', fontWeight: 900, color: '#f093fb', textTransform: 'uppercase' }}>Google Maps Key</label>
                        <input type="password" value={googleMapsKey} onChange={e => { setGoogleMapsKey(e.target.value); saveConfig(); }} placeholder="Paste Maps API Key..." className="chat-input" style={{ width: '220px', borderColor: googleMapsKey ? '#f093fb' : '#ff6b6b' }} />
                      </div>
                    )}
                    {newServer.name && <button onClick={connectMCPServer} className="btn-premium" style={{ height: '45px', padding: '0 30px' }}>LINK {newServer.name.toUpperCase()}</button>}

                 </div>
               </div>

               <div style={{ marginBottom: '30px' }}>
                 <div style={{ fontWeight: 900, marginBottom: '20px', color: 'var(--primary)', fontSize: '0.85rem', letterSpacing: '0.1em' }}>QUICK-LINK TOOL LIBRARY</div>
                 <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '15px' }}>
                    {[
                      { id: 'Jules', name: 'Jules Agent', pkg: '@amitdeshmukh/google-jules-mcp', key: !!julesApiKey, color: 'linear-gradient(135deg, #ff416c 0%, #ff4b2b 100%)', command: '', args: '' },
                      { id: 'ChatGPT', name: 'ChatGPT API', pkg: '@modelcontextprotocol/server-openai', key: !!openaiKey, color: 'linear-gradient(135deg, #10a37f 0%, #0cebeb 100%)', command: '', args: '' },
                      { id: 'Claude', name: 'Claude API', pkg: '@modelcontextprotocol/server-anthropic-chat', key: !!claudeKey, color: 'linear-gradient(135deg, #da7756 0%, #f093fb 100%)', command: '', args: '' },
                      { id: 'GitHub', name: 'GitHub Sync', pkg: '@modelcontextprotocol/server-github', key: !!githubToken, color: 'linear-gradient(135deg, #24292e 0%, #171a1d 100%)', command: '', args: '' },
                      { id: 'Memory', name: 'Memory', pkg: 'mcp-server-memory', key: true, color: 'linear-gradient(135deg, #4834d4 0%, #686de0 100%)', command: '', args: '' },
                      { id: 'Filesystem', name: 'Filesystem', pkg: '@modelcontextprotocol/server-filesystem', key: true, color: 'linear-gradient(135deg, #6ab04c 0%, #badc58 100%)', command: '', args: '' },
                      { id: 'Google', name: 'Google Maps', pkg: '@modelcontextprotocol/server-google-maps', key: true, color: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)', command: '', args: '' }
                    ].map(lib => {
                      const isLinked = mcpServers.some(s => {
                        const cleanBase = s.name.replace(/[●○]/g, '').trim();
                        const registeredName = cleanBase.split(':')[0].trim().toLowerCase();
                        return registeredName === lib.id.toLowerCase() && s.status === 'online';
                      });
                      const statusColor = isLinked ? '#00ff88' : '#ff6b6b';
                      const statusLabel = isLinked ? 'LINKED' : 'UNLINKED';
                      
                      return (
                        <button 
                          key={lib.name} 
                          onClick={() => {
                            const newServerConfig: any = {
                              name: lib.id,
                              command: 'npx',
                              args: `--no-install -y ${lib.pkg}`
                            };

                            if (lib.id === 'Jules' && julesApiKey) {
                              newServerConfig.env = { JULES_API_KEY: julesApiKey, GOOGLE_API_KEY: julesApiKey };
                            } else if (lib.id === 'ChatGPT' && openaiKey) {
                              newServerConfig.env = { OPENAI_API_KEY: openaiKey };
                            } else if (lib.id === 'Claude' && claudeKey) {
                              newServerConfig.env = { ANTHROPIC_API_KEY: claudeKey };
                            } else if (lib.id === 'GitHub' && githubToken) {
                              newServerConfig.env = { GITHUB_PERSONAL_ACCESS_TOKEN: githubToken };
                            } else if (lib.id === 'Google' && googleMapsKey) {
                              newServerConfig.env = { GOOGLE_MAPS_API_KEY: googleMapsKey };
                            }
                            
                            setNewServer(newServerConfig);
                          }}
                          className="glass-card" 
                          style={{ 
                            padding: '15px', 
                            border: `1px solid ${statusColor}a0`, 
                            cursor: 'pointer', 
                            textAlign: 'left', 
                            background: isLinked ? `rgba(0,255,136,0.15)` : `rgba(255,107,107,0.05)`,
                            boxShadow: isLinked ? `0 0 25px rgba(0,255,136,0.2)` : 'none',
                            position: 'relative',
                            overflow: 'hidden',
                            transition: 'all 0.3s'
                          }}
                        >
                          <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '3px', background: statusColor, opacity: 1 }}></div>
                          <div style={{ fontSize: '0.8rem', fontWeight: 900, color: '#fff', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '5px' }}>
                            {lib.name} {isLinked && <CheckCircle2 size={12} color="#00ff88" />}
                          </div>
                          <div style={{ 
                            fontSize: '0.7rem', 
                            fontWeight: 900,
                            letterSpacing: '0.05em',
                            color: statusColor 
                          }}>
                            {statusLabel}
                          </div>
                        </button>
                      );
                    })}
                 </div>
               </div>

               <div style={{ borderTop: '1px solid var(--glass-border)', paddingTop: '30px' }}>
                 <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                    <div style={{ fontWeight: 800 }}>Linked Registries</div>
                    <input 
                      value={mcpSearch} 
                      onChange={e => setMcpSearch(e.target.value)} 
                      placeholder="Search linked servers..." 
                      className="chat-input" 
                      style={{ width: '250px', fontSize: '0.75rem', padding: '8px 15px' }} 
                    />
                 </div>
                 <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                   {mcpServers.filter(s => s.name.toLowerCase().includes(mcpSearch.toLowerCase())).map(s => (
                     <div key={s.name} className="glass-card" style={{ padding: '1.5rem', border: '1px solid #00ff8844', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                       <div>
                         <div style={{ fontWeight: 800 }}>{s.name}</div>
                         <div style={{ fontSize: '0.7rem', color: s.status === 'online' ? '#00ff88' : '#ff6b6b' }}>
                           ● {s.status.toUpperCase()}
                         </div>
                       </div>
                       <button 
                         onClick={() => removeMCPServer(s.name)}
                         style={{ background: 'rgba(255,107,107,0.1)', color: '#ff6b6b', border: 'none', padding: '5px 10px', borderRadius: '5px', cursor: 'pointer', fontSize: '0.7rem' }}
                       >
                         Remove
                       </button>
                     </div>
                   ))}
                   {mcpServers.length === 0 && <div style={{ textAlign: 'center', opacity: 0.4, padding: '4rem', gridColumn: 'span 2' }}><Database size={48} /><p>No external registries linked yet.</p></div>}
                  </div>
                </div>
            </motion.div>
          )}

          {activeTab === 'quota' && (
            <motion.div key="quota" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} style={{ padding: '0 1rem' }}>
                <div style={{ marginBottom: '40px' }}>
                  <h3 style={{ fontSize: '2.4rem', fontWeight: 900, letterSpacing: '-1.5px' }}>Fleet Telemetry</h3>
                  <p style={{ color: 'var(--text-dim)', fontSize: '1rem', marginTop: '10px' }}>Real-time token utilization across all linked AI systems.</p>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '25px', marginBottom: '40px' }}>
                  {[
                    { id: 'gemini', name: 'Gemini Master', color: '#4facfe', val: (tokenUsage as any).gemini || 0 },
                    { id: 'openai', name: 'GPT-4 Strategy', color: '#10a37f', val: (tokenUsage as any).openai || 0 },
                    { id: 'claude', name: 'Claude Analysis', color: '#da7756', val: (tokenUsage as any).claude || 0 },
                    { id: 'jules', name: 'Jules Agent', color: '#ff416c', val: (tokenUsage as any).jules || 0 }
                  ].map(m => (
                    <div key={m.id} className="glass-card" style={{ padding: '25px', position: 'relative', overflow: 'hidden' }}>
                       <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '4px', background: m.color, opacity: 0.6 }}></div>
                       <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                         <div style={{ fontSize: '0.7rem', fontWeight: 900, color: m.color, letterSpacing: '0.1em' }}>CLOUD OVERSIGHT</div>
                         <div style={{ width: '8px', height: '8px', background: m.val > 0 ? '#00ff88' : 'rgba(255,255,255,0.1)', borderRadius: '50%' }}></div>
                       </div>
                       <h4 style={{ fontSize: '1.2rem', fontWeight: 800, marginTop: '15px' }}>{m.name}</h4>
                       <div style={{ fontSize: '1.8rem', fontWeight: 900, marginTop: '5px' }}>{m.val.toLocaleString()} <span style={{ fontSize: '0.8rem', opacity: 0.4 }}>TOKENS</span></div>
                       <div className="quota-bar" style={{ marginTop: '20px', height: '6px' }}><div className="quota-fill" style={{ width: `${Math.min(100, (m.val / 100000) * 100)}%`, background: m.color }}></div></div>
                       <p style={{ fontSize: '0.65rem', opacity: 0.4, marginTop: '8px' }}>Active Bridge Tunnel: STABLE</p>
                    </div>
                  ))}
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '30px' }}>
                   <div className="glass-card" style={{ padding: '30px', border: '1px solid #00ff8844' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                        <Zap size={32} color="#00ff88" />
                        <div>
                          <div style={{ fontWeight: 900, fontSize: '0.75rem', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase' }}>Silicon Pressure</div>
                          <h4 style={{ fontSize: '1.5rem', fontWeight: 800 }}>Antigravity AI (Local)</h4>
                        </div>
                      </div>
                      <div style={{ background: 'rgba(0,0,0,0.2)', padding: '20px', borderRadius: '15px', marginTop: '30px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
                           <span style={{ fontWeight: 800, fontSize: '0.85rem' }}>COMPUTE LOAD</span>
                           <span style={{ fontWeight: 900, color: '#00ff88' }}>{usage.cpu}%</span>
                        </div>
                        <div className="quota-bar"><div className="quota-fill" style={{ width: `${usage.cpu}%` }}></div></div>
                        <p style={{ fontSize: '0.7rem', opacity: 0.4, marginTop: '15px' }}>Local bridge has calculated {(tokenUsage as any).antigravity || 0} implementation tokens.</p>
                      </div>
                   </div>

                   <div className="glass-card" style={{ padding: '30px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                        <Database size={32} color="#00d2ff" />
                        <div>
                          <div style={{ fontWeight: 900, fontSize: '0.75rem', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase' }}>Global Resilience</div>
                          <h4 style={{ fontSize: '1.5rem', fontWeight: 800 }}>Resume Snapshot Bridge</h4>
                        </div>
                      </div>
                      <p style={{ fontSize: '0.85rem', color: 'var(--text-dim)', margin: '25px 0' }}>When cloud quotas hit high pressure, IMI automatically triggers a snapshot for hand-off to alternative systems.</p>
                      <div style={{ display: 'flex', gap: '15px' }}>
                         <button onClick={async () => {
                           const result = await (ipc as any).invoke('save-context-snapshot', { status: 'Manual User Backup', lastQuery: 'Dashboard Ping' });
                           if (result.success) { fetchStats(); alert('Resume Snapshot saved to Project Root!'); }
                         }} className="btn-premium" style={{ flex: 1, height: '50px' }}>Save Point</button>
                         <button onClick={fetchStats} className="btn-premium" style={{ background: 'rgba(255,255,255,0.05)', flex: 1, border: '1px solid var(--glass-border)', height: '50px' }}>Sync Fleet</button>
                      </div>
                   </div>
                </div>
            </motion.div>
          )}

          {activeTab === 'settings' && (
            <motion.div key="set" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="glass-card" style={{ padding: '0', display: 'grid', gridTemplateColumns: '240px 1fr', minHeight: '600px', overflow: 'hidden' }}>
              <aside style={{ background: 'rgba(0,0,0,0.2)', padding: '2rem 1.5rem', borderRight: '1px solid var(--glass-border)' }}>
                <div style={{ marginBottom: '2rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', background: 'rgba(255,255,255,0.05)', padding: '10px 15px', borderRadius: '12px', border: '1px solid var(--glass-border)' }}>
                    <Search size={16} color="var(--text-dim)" />
                    <input value={settingsSearch} onChange={e => setSettingsSearch(e.target.value)} placeholder="Find setting..." style={{ background: 'none', border: 'none', color: '#fff', fontSize: '0.8rem', outline: 'none', width: '100%' }} />
                  </div>
                </div>
                <nav style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {[
                    { id: 'general', label: 'General', icon: <Settings2 size={18} /> },
                    { id: 'interface', label: 'Interface', icon: <Palette size={18} /> },
                    { id: 'keys', label: 'API & Tokens', icon: <Key size={18} /> },
                    { id: 'advanced', label: 'Advanced', icon: <Gauge size={18} /> }
                  ].filter(tab => tab.label.toLowerCase().includes(settingsSearch.toLowerCase())).map(tab => (
                    <button key={tab.id} onClick={() => setSettingsActiveSubTab(tab.id as any)} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 1rem', borderRadius: '10px', border: 'none', background: settingsActiveSubTab === tab.id ? 'var(--primary)' : 'transparent', color: settingsActiveSubTab === tab.id ? '#fff' : 'rgba(255,255,255,0.5)', cursor: 'pointer', transition: 'all 0.2s', fontWeight: 700, fontSize: '0.85rem', textAlign: 'left' }}>
                      {tab.icon} {tab.label}
                    </button>
                  ))}
                </nav>
              </aside>

              <div style={{ padding: '3rem', overflowY: 'auto' }}>
                <AnimatePresence mode="wait">
                  {settingsActiveSubTab === 'general' && (
                    <motion.div key="gen" initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} style={{ display: 'flex', flexDirection: 'column', gap: '30px' }}>
                      <div>
                        <h3 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '5px' }}>General Preferences</h3>
                        <p style={{ color: 'var(--text-dim)', fontSize: '0.85rem' }}>Core project and workspace configurations.</p>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        <label style={{ fontWeight: 700, fontSize: '0.9rem' }}>Project Root Path</label>
                        <div style={{ display: 'flex', gap: '10px' }}>
                          <input value={projectRootInput} onChange={e => setProjectRootInput(e.target.value)} placeholder="C:\Users\...\Project" className="chat-input" />
                          <button onClick={updateRoot} className="btn-premium">Set Root</button>
                        </div>
                      </div>
                      <div className="divider-v" style={{ width: '100%', height: '1px' }}></div>
                      <div style={{ background: 'rgba(0,255,136,0.1)', padding: '15px', borderRadius: '10px', border: '1px solid #00ff8844' }}>
                        <p style={{ fontSize: '0.8rem', color: '#00ff88' }}>✓ GitHub & Git features are active and safe. Command shims are blocked to prevent popups.</p>
                      </div>
                    </motion.div>
                  )}

                  {settingsActiveSubTab === 'interface' && (
                    <motion.div key="int" initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} style={{ display: 'flex', flexDirection: 'column', gap: '25px' }}>
                      <div>
                        <h3 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '5px' }}>Visual Experience</h3>
                        <p style={{ color: 'var(--text-dim)', fontSize: '0.85rem' }}>Personalize your IMI workspace aesthetics.</p>
                      </div>
                      <div className="glass-card" style={{ padding: '25px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
                         <div style={{ fontWeight: 800, fontSize: '0.9rem' }}>Theme Selection</div>
                         <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '15px' }}>
                            {[
                              { id: 'glass', name: 'Glassmorphism', color: 'linear-gradient(135deg, rgba(255,255,255,0.1) 0%, rgba(255,255,255,0.05) 100%)' },
                              { id: 'dark', name: 'Deep Dark', color: '#090909' },
                              { id: 'neon', name: 'Neon Cyber', color: 'linear-gradient(135deg, #00ff8822 0%, #4facfe22 100%)' }
                            ].map(t => (
                              <button key={t.id} onClick={() => setTheme(t.id)} style={{ padding: '15px', borderRadius: '12px', border: theme === t.id ? '2px solid var(--primary)' : '1px solid var(--glass-border)', background: t.color, cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }}>
                                 <div style={{ fontSize: '0.75rem', fontWeight: 900, color: theme === t.id ? '#fff' : 'rgba(255,255,255,0.4)' }}>{t.name.toUpperCase()}</div>
                              </button>
                            ))}
                         </div>
                      </div>
                    </motion.div>
                  )}

                  {settingsActiveSubTab === 'keys' && (
                    <motion.div key="keys" initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} style={{ display: 'flex', flexDirection: 'column', gap: '25px' }}>
                      <div>
                        <h3 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '5px' }}>API & Tokens</h3>
                        <p style={{ color: 'var(--text-dim)', fontSize: '0.85rem' }}>Manage credentials for AI engines and GitHub.</p>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '25px' }}>
                        <div style={{ background: 'rgba(255,255,255,0.02)', padding: '20px', borderRadius: '15px', border: '1px solid var(--glass-border)' }}>
                          <h4 style={{ fontWeight: 800, fontSize: '0.9rem', color: 'var(--primary)', marginBottom: '15px' }}>Core AI Engines</h4>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }}>
                            {[
                              { label: 'Gemini CLI Key', val: geminiKey, set: setGeminiKey, ph: 'Google AI Studio Key...' },
                              { label: 'Jules AI Token', val: julesApiKey, set: setJulesApiKey, ph: 'Jules/Google API Key...' },
                              { label: 'GitHub PAT', val: githubToken, set: setGithubToken, ph: 'Personal Access Token...' }
                            ].map(key => (
                              <div key={key.label} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                <label style={{ fontSize: '0.75rem', fontWeight: 900, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase' }}>{key.label}</label>
                                <input type="password" value={key.val} onChange={e => key.set(e.target.value)} placeholder={key.ph} className="chat-input" style={{ fontSize: '0.85rem' }} />
                              </div>
                            ))}
                          </div>
                        </div>
                        <div style={{ background: 'rgba(255,255,255,0.02)', padding: '20px', borderRadius: '15px', border: '1px solid var(--glass-border)' }}>
                          <h4 style={{ fontWeight: 800, fontSize: '0.9rem', color: 'var(--secondary)', marginBottom: '15px' }}>Extended API Connections</h4>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }}>
                            {[
                              { label: 'OpenAI (GPT) Key', val: openaiKey, set: setOpenaiKey, ph: 'sk-...' },
                              { label: 'Anthropic (Claude) Key', val: claudeKey, set: setClaudeKey, ph: 'sk-ant-...' },
                              { label: 'Google Maps Key', val: googleMapsKey, set: setGoogleMapsKey, ph: 'Google Cloud Key...' },
                              { label: 'Custom Variable', val: customApiKey, set: setCustomApiKey, ph: 'VAR_NAME=value' }
                            ].map(key => (
                              <div key={key.label} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                <label style={{ fontSize: '0.75rem', fontWeight: 700, opacity: 0.7 }}>{key.label}</label>
                                <input type="password" value={key.val} onChange={e => key.set(e.target.value)} placeholder={key.ph} className="chat-input" />
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                      <button onClick={saveConfig} className="btn-premium" style={{ width: 'fit-content', padding: '12px 40px' }}>Save All Credentials</button>
                    </motion.div>
                  )}

                  {settingsActiveSubTab === 'advanced' && (
                    <motion.div key="adv" initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} style={{ display: 'flex', flexDirection: 'column', gap: '25px' }}>
                      <div>
                        <h3 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '5px' }}>Advanced Automation</h3>
                         <p style={{ color: 'var(--text-dim)', fontSize: '0.85rem' }}>Fine-tune agent behavior and reporting.</p>
                      </div>
                      {[
                        { title: 'Autonomous Debugging', desc: 'Allow agents to fix errors automatically.' },
                        { title: 'Telemetry Broadcast', desc: 'Send usage metrics for optimized sync.' },
                        { title: 'System Safety Filter', desc: 'Enable AI-driven safety guardrails for terminal commands.' }
                      ].map(item => (
                        <div key={item.title} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.02)', padding: '20px', borderRadius: '15px', border: '1px solid var(--glass-border)' }}>
                          <div>
                            <div style={{ fontWeight: 700, fontSize: '0.95rem' }}>{item.title}</div>
                            <p style={{ fontSize: '0.75rem', opacity: 0.5 }}>{item.desc}</p>
                          </div>
                          <button className="director-btn active" style={{ width: '70px', height: '35px' }}>TRUE</button>
                        </div>
                      ))}
                      <div className="divider-v" style={{ margin: '10px 0' }}></div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                         <div className="glass-card" style={{ padding: '20px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '15px' }}>
                               <History size={16} color="var(--primary)" />
                               <span style={{ fontWeight: 800, fontSize: '0.85rem' }}>Log Retention</span>
                            </div>
                            <input type="range" min="1" max="100" value={logRetention} onChange={e => setLogRetention(parseInt(e.target.value))} style={{ width: '100%' }} />
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '5px', fontSize: '0.7rem', opacity: 0.5 }}>
                               <span>1 Row</span>
                               <span>{logRetention} Rows</span>
                               <span>100 Rows</span>
                            </div>
                         </div>
                         <div className="glass-card" style={{ padding: '20px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '15px' }}>
                               <Clock size={16} color="var(--secondary)" />
                               <span style={{ fontWeight: 800, fontSize: '0.85rem' }}>Snapshot Freq</span>
                            </div>
                            <input type="range" min="1" max="60" value={snapshotFrequency} onChange={e => setSnapshotFrequency(parseInt(e.target.value))} style={{ width: '100%' }} />
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '5px', fontSize: '0.7rem', opacity: 0.5 }}>
                               <span>1 Min</span>
                               <span>{snapshotFrequency} Mins</span>
                               <span>60 Mins</span>
                            </div>
                         </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <footer style={{ marginTop: 'auto', borderTop: '1px solid var(--glass-border)', paddingTop: '1.5rem', display: 'flex', justifyContent: 'space-between', color: 'rgba(255,255,255,0.3)', fontSize: '0.8rem' }}>
          <div>© 2026 IMI Systems - INTEGRATED MODEL INTELLIGENCE v1.0.4</div>
          <div style={{ display: 'flex', gap: '25px', alignItems: 'center' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}><CheckCircle2 size={12} color="#00ff88"/> CORE SYSTEM STABLE</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}><RefreshCw size={12} color="var(--primary)"/> BRIDGE: ACTIVE</span>
          </div>
        </footer>
      </main>
    </div>
  );
};

export default App;
