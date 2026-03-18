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
  Gauge
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
  const [tokenUsage, setTokenUsage] = useState({ gemini: 0, jules: 0 });
  const [activeDirector, setActiveDirector] = useState('gemini');
  const [mcpServers, setMcpServers] = useState<any[]>([]);
  const [newServer, setNewServer] = useState({ name: '', command: '', args: '' });
  const [chatInput, setChatInput] = useState('');
  const [mcpSearch, setMcpSearch] = useState('');
  const [availableMCPs] = useState([
    { name: 'Jules Cloud', pkg: '@google/jules', desc: 'Autonomous coding agent' },
    { name: 'Memory', pkg: 'mcp-server-memory', desc: 'Persistent graph memory' },
    { name: 'Filesystem', pkg: '@modelcontextprotocol/server-filesystem', desc: 'Local file access' },
    { name: 'GitHub', pkg: '@modelcontextprotocol/server-github', desc: 'Repo management' },
    { name: 'Google Maps', pkg: '@modelcontextprotocol/server-google-maps', desc: 'Location data' }
  ]);
  const [projectRootInput, setProjectRootInput] = useState('');
  const [geminiKey, setGeminiKey] = useState('');
  const [julesToken, setJulesToken] = useState('');
  const [githubToken, setGithubToken] = useState('');
  const [activeEngine, setActiveEngine] = useState('jules');
  const [gitInstalled, setGitInstalled] = useState(true);
  const [settingsActiveSubTab, setSettingsActiveSubTab] = useState('general');
  const [settingsSearch, setSettingsSearch] = useState('');
  const [lastSnapshot, setLastSnapshot] = useState<any>(null);
  const [snapshotMode, setSnapshotMode] = useState(true);
  
  interface Log { id: number; type: string; msg: string; }
  const [logs, setLogs] = useState<Log[]>([
    { id: 1, type: 'ag', msg: 'Antigravity core loaded. Watching for changes...' },
    { id: 2, type: 'gemini', msg: 'Gemini CLI initialized. Ready for prompt.' },
    { id: 3, type: 'jules', msg: 'Jules connection established. Cloud VM ready.' }
  ]);

  const [messages, setMessages] = useState<any[]>([
    { id: 0, type: 'system', text: 'Unified Sync Hub initialized. All commands are broadcasted to Jules and Gemini CLI.' }
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
    if (mcpData.success) {
      const lines = mcpData.data.split('\n').filter((l: string) => l.includes('●') || l.includes('○'));
      setMcpServers(lines.map((l: string) => ({ 
        name: l.trim(), 
        status: l.includes('●') ? 'online' : 'offline' 
      })));
    }

    const snapshot = await (ipc as any).invoke('load-context-snapshot');
    if (snapshot) setLastSnapshot(snapshot);

    const config = await (ipc as any).invoke('get-api-config');
    if (config) {
      setGeminiKey(config.geminiKey || '');
      setJulesToken(config.julesToken || '');
      setGithubToken(config.githubToken || '');
      setActiveEngine(config.activeEngine || 'jules');
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
    await (ipc as any).invoke('save-api-config', { geminiKey, julesToken, githubToken, activeEngine });
    alert('API Integration & Engine Settings Synced!');
  };

  const connectMCPServer = async () => {
    if (!newServer.name || !newServer.command) return;
    
    // Auto-detect if this is the GitHub MCP and inject the token
    const env: any = {};
    if (newServer.name.toLowerCase().includes('github')) {
      if (!githubToken) {
        alert('Please set your GitHub Personal Access Token in the Settings tab first!');
        setActiveTab('settings');
        return;
      }
      env['GITHUB_PERSONAL_ACCESS_TOKEN'] = githubToken;
    }

    const result = await (ipc as any).invoke('mcp:global-add', { 
      name: newServer.name, 
      command: newServer.command, 
      args: newServer.args.split(' ').filter(a => a),
      env
    });
    if (result.success) {
      setNewServer({ name: '', command: '', args: '' });
      addLog('system', result.msg);
      fetchStats();
    }
  };

  const removeMCPServer = async (name: string) => {
    const cleanName = name.replace(/[●○]/g, '').trim().split(' ')[0];
    const result = await (ipc as any).invoke('mcp:global-remove', cleanName);
    if (result.success) {
      addLog('system', result.msg);
      fetchStats();
    }
  };

  const handleSendMessage = async () => {
    if (!chatInput.trim()) return;
    const newUserMsg = { id: Date.now(), type: 'user', text: chatInput };
    setMessages(prev => [...prev, newUserMsg]);
    setChatInput('');
    setIsSyncing(true);
    addLog('ag', `Broadcasting to ${activeDirector}: ${newUserMsg.text}`);
    
    if (snapshotMode) {
      await (ipc as any).invoke('save-context-snapshot', {
        lastQuery: chatInput,
        activeDirector,
        status: 'Handing over to alternative model'
      });
    }

    const result = await (ipc as any).invoke('execute-command', { command: newUserMsg.text, director: activeDirector });
    const aiResponse = { 
      id: Date.now() + 1, 
      type: 'ai', 
      director: activeDirector,
      text: result.msg || 'Command executed by bridge.',
      isJules: result.isJules,
      sessionId: result.sessionId
    };
    setMessages(prev => [...prev, aiResponse]);
    setIsSyncing(false);
    fetchStats();
  };

  const syncJules = async (sid: string) => {
    addLog('system', `Attempting sync for Jules Session: ${sid}`);
    const result = await (ipc as any).invoke('sync-jules-session', sid);
    if (result.success) {
      alert('SUCCESS: Jules code merged into local workspace.');
      addLog('system', 'Sync successful.');
    } else {
      alert('Sync Failed: ' + result.error);
    }
  };

  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, 2000); 
    
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

    return () => clearInterval(interval);
  }, []);

  const [githubUrl, setGithubUrl] = useState('');
  const [isLinking, setIsLinking] = useState(false);

  const [githubUser, setGithubUser] = useState<any>(null);

  const linkExistingGithub = async () => {
    // 1. Sync token to backend first if provided in the field
    if (githubToken) {
      await (ipc as any).invoke('save-api-config', { geminiKey, julesToken, githubToken, activeEngine });
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
      <div className="title-bar" style={{ display: 'flex', justifyContent: 'flex-end', padding: '10px', background: 'rgba(0,0,0,0.3)', WebkitAppRegion: 'drag' } as any}>
        <div className="window-controls" style={{ display: 'flex', gap: '10px', WebkitAppRegion: 'no-drag' } as any}>
          <button onClick={() => ipc.send('window-minimize')} className="control-btn" style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer' }}><Minus size={14} /></button>
          <button onClick={() => ipc.send('window-maximize')} className="control-btn" style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer' }}><Maximize2 size={14} /></button>
          <button onClick={() => ipc.send('window-close')} className="control-btn close" style={{ background: 'none', border: 'none', color: '#ff6b6b', cursor: 'pointer' }}><X size={14} /></button>
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
            <button onClick={handleExport} disabled={isExporting} className="btn-premium" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              {isExporting ? <RefreshCw size={18} className="spin" /> : <Download size={18} />} Export Hub
            </button>
          </div>
        </header>

        <AnimatePresence mode="wait">
          {activeTab === 'dashboard' && (
            <motion.div key="db" initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -15 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '25px' }}>
                {[
                  { title: 'Antigravity AI', badge: 'LOCAL', color: 'var(--primary)', logs: logs.filter(l=>l.type==='ag'), icon: <Zap /> },
                  { title: 'Google Jules', badge: 'CLOUD', color: '#ff6b6b', logs: logs.filter(l=>l.type==='jules'), icon: <Activity /> },
                  { title: 'Gemini CLI', badge: 'TERMINAL', color: '#00d2ff', logs: logs.filter(l=>l.type==='gemini'), icon: <Terminal /> }
                ].map(agent => (
                  <div key={agent.title} className="glass-card" style={{ padding: '1.5rem', position: 'relative', overflow: 'hidden' }}>
                    <div style={{ position: 'absolute', top: 0, left: 0, width: '4px', height: '100%', background: agent.color }}></div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span className="tool-badge" style={{ background: agent.color + '22', color: agent.color, fontWeight: 800 }}>{agent.badge}</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '0.6rem', fontWeight: 800, color: 'rgba(255,255,255,0.4)' }}>ACTIVE</span>
                        <div className="status-online" style={{ width: '8px', height: '8px', background: '#00ff88', borderRadius: '50%', boxShadow: '0 0 10px #00ff88' }}></div>
                      </div>
                    </div>
                    <h3 style={{ marginTop: '1.5rem', fontSize: '1.4rem', fontWeight: 800 }}>{agent.title}</h3>
                    <div className="terminal-mock" style={{ height: '80px', margin: '15px 0', background: 'rgba(0,0,0,0.4)', borderRadius: '10px', padding: '12px', fontSize: '0.7rem' }}>
                      {agent.logs.length > 0 ? agent.logs.map(l => <div key={l.id} style={{ marginBottom: '4px' }}><span style={{ color: agent.color, fontWeight: 800 }}>▶</span> {l.msg}</div>) : <div style={{ opacity: 0.3 }}>Standby for heartbeat...</div>}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                      <button 
                        className="btn-premium" 
                        style={{ padding: '10px', fontSize: '0.7rem', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--glass-border)' }} 
                        onClick={() => addLog(agent.badge === 'LOCAL' ? 'ag' : agent.badge.toLowerCase(), 'Manual ping heartbeat sent.')}
                      >
                        Ping Node
                      </button>
                      <button 
                        className="btn-premium" 
                        style={{ padding: '10px', fontSize: '0.7rem', background: agent.color + '22', border: `1px solid ${agent.color}44`, color: agent.color }} 
                        onClick={() => alert(`${agent.title} system diagnostics stable. Sync Latency: 4ms`)}
                      >
                        Diagnostic
                      </button>
                    </div>
                  </div>
                ))}
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
                <div style={{ padding: '1.2rem 2rem', background: 'rgba(255,255,255,0.03)', display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--glass-border)' }}>
                  <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                    <div className="spin"><RefreshCw size={14} color="var(--primary)" /></div>
                    <span style={{ fontWeight: 800 }}>ORCHESTRATOR BROADCAST</span>
                  </div>
                  <div className="director-selector" style={{ background: 'rgba(255,255,255,0.05)', padding: '4px', borderRadius: '10px', display: 'flex', gap: '5px' }}>
                    <button 
                      onClick={() => setActiveDirector('gemini')} 
                      className={activeDirector === 'gemini' ? 'active' : ''}
                      style={{ 
                        padding: '6px 15px', borderRadius: '8px', border: 'none', 
                        background: activeDirector === 'gemini' ? 'var(--primary)' : 'transparent',
                        color: '#fff', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 700,
                        transition: 'all 0.3s'
                      }}
                    >
                      Gemini CLI
                    </button>
                    <button 
                      onClick={() => setActiveDirector('antigravity')} 
                      className={activeDirector === 'antigravity' ? 'active' : ''}
                      style={{ 
                        padding: '6px 15px', borderRadius: '8px', border: 'none', 
                        background: activeDirector === 'antigravity' ? 'var(--primary)' : 'transparent',
                        color: '#fff', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 700,
                        transition: 'all 0.3s'
                      }}
                    >
                      AntiGravity
                    </button>
                  </div>
                </div>
                <div style={{ flex: 1, padding: '2rem', overflowY: 'auto' }}>
                  {messages.map(m => (
                    <div key={m.id} style={{ marginBottom: '1.5rem', display: 'flex', gap: '15px', justifyContent: m.type==='user'?'flex-end':'flex-start' }}>
                      {m.type !== 'user' && <div style={{ width: '32px', height: '32px', background: m.type==='system'?'#333':'var(--primary)', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{m.type==='ai'?<Cpu size={16}/>:<Terminal size={16}/>}</div>}
                      <div style={{ 
                        maxWidth: '80%', padding: '12px 18px', borderRadius: '15px', 
                        background: m.type==='user'?'var(--primary)':'rgba(255,255,255,0.05)',
                        border: m.type==='user'?'none':'1px solid var(--glass-border)'
                      }}>
                        {m.type==='ai' && <div style={{ fontSize: '0.7rem', fontWeight: 900, color: 'var(--primary)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '8px' }}>{m.director?m.director.toUpperCase():'SYSTEM'} RESPONSE</div>}
                        <div className="chat-bubble-content" style={{ fontSize: '0.95rem', lineHeight: '1.6' }}>
                          {renderContent(m.text)}
                        </div>
                        {m.isJules && (
                          <button 
                            onClick={() => syncJules(m.sessionId)}
                            className="btn-premium" 
                            style={{ marginTop: '15px', fontSize: '0.75rem', padding: '8px 12px', width: '100%' }}
                          >
                            <RefreshCw size={14} style={{ marginRight: '8px' }} /> Synchronize Code to Local Workspace
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                <div style={{ padding: '1.5rem', borderTop: '1px solid var(--glass-border)' }}>
                    <form onSubmit={e => {e.preventDefault(); handleSendMessage();}} style={{ display: 'flex', gap: '10px' }}>
                      <input value={chatInput} onChange={e => setChatInput(e.target.value)} type="text" placeholder="Send cross-platform command..." className="chat-input" />
                      <button type="submit" className="btn-chat-send"><Send size={18}/></button>
                    </form>
                </div>
              </div>
              <div className="devtools-panel">
                 <div className="devtools-header"><span>Console</span><span>Logs</span><span>System</span></div>
                 <div className="devtools-content" style={{ height: '540px' }}>
                    <div style={{ color: '#00ff88' }}>[Bridge] Initializing socket connection...</div>
                    <div style={{ color: '#00d2ff' }}>[System] {usage.threads} CPU Cores detected.</div>
                    <div style={{ color: '#75beff' }}>[FS] Watching {stats.fileCount} files in {stats.projectRoot}</div>
                    <div style={{ marginTop: '10px', opacity: 0.6 }}>... listening for broadcast events</div>
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
                 <div style={{ display: 'flex', gap: '10px' }}>
                    <input value={newServer.name} onChange={e => setNewServer({...newServer, name: e.target.value})} placeholder="Name" className="chat-input" style={{ width: '150px' }} />
                    <input value={newServer.command} onChange={e => setNewServer({...newServer, command: e.target.value})} placeholder="Command/Pkg" className="chat-input" style={{ width: '200px' }} />
                    <input value={newServer.args} onChange={e => setNewServer({...newServer, args: e.target.value})} placeholder="Args" className="chat-input" style={{ width: '150px' }} />
                    <button onClick={connectMCPServer} className="btn-premium">Link App</button>
                 </div>
               </div>

               <div style={{ marginBottom: '30px' }}>
                 <div style={{ fontWeight: 900, marginBottom: '20px', color: 'var(--primary)', fontSize: '0.85rem', letterSpacing: '0.1em' }}>QUICK-LINK TOOL LIBRARY</div>
                 <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '15px' }}>
                    {[
                      { name: 'Jules Cloud', pkg: '@google/jules', desc: 'Autonomous coding', color: 'linear-gradient(135deg, #ff6b6b 0%, #ee5253 100%)' },
                      { name: 'Memory', pkg: 'mcp-server-memory', desc: 'Persistent graph', color: 'linear-gradient(135deg, #4834d4 0%, #686de0 100%)' },
                      { name: 'Filesystem', pkg: '@modelcontextprotocol/server-filesystem', desc: 'Local file access', color: 'linear-gradient(135deg, #6ab04c 0%, #badc58 100%)' },
                      { name: 'GitHub', pkg: '@modelcontextprotocol/server-github', desc: githubToken ? '✓ Token Ready' : 'Setup Token in Settings', color: 'linear-gradient(135deg, #2f3542 0%, #57606f 100%)' },
                      { name: 'Google Maps', pkg: '@modelcontextprotocol/server-google-maps', desc: 'Location data', color: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)' }
                    ].map(lib => (
                      <button 
                        key={lib.name} 
                        onClick={() => setNewServer({ name: lib.name.split(' ')[0], command: 'npx', args: `-y ${lib.pkg}` })}
                        className="glass-card" 
                        style={{ 
                          padding: '15px', 
                          border: '1px solid var(--glass-border)', 
                          cursor: 'pointer', 
                          textAlign: 'left', 
                          background: 'rgba(255,255,255,0.03)',
                          position: 'relative',
                          overflow: 'hidden'
                        }}
                      >
                        <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '3px', background: lib.color }}></div>
                        <div style={{ fontSize: '0.8rem', fontWeight: 900, color: '#fff', marginBottom: '4px' }}>{lib.name}</div>
                        <div style={{ fontSize: '0.65rem', opacity: 0.7, color: 'var(--text-dim)' }}>{lib.desc}</div>
                        <div style={{ 
                          position: 'absolute', bottom: '-10px', right: '-10px', width: '40px', height: '40px', 
                          background: lib.color, opacity: 0.1, filter: 'blur(15px)', borderRadius: '50%' 
                        }}></div>
                      </button>
                    ))}
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
            <motion.div key="quota" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="glass-card" style={{ padding: '3rem' }}>
               <div style={{ display: 'flex', gap: '40px' }}>
                 <div style={{ flex: 1 }}>
                   <h3 style={{ fontSize: '2rem', fontWeight: 900 }}>Token Quota Overview</h3>
                   <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginTop: '20px' }}>
                      <div className="glass-card" style={{ padding: '20px', border: '1px solid #00d2ff44' }}>
                        <div style={{ color: '#00d2ff', fontWeight: 800 }}>GEMINI CLI USAGE</div>
                        <div style={{ fontSize: '2.5rem', fontWeight: 900 }}>{tokenUsage.gemini.toLocaleString()} <span style={{ fontSize: '1rem', opacity: 0.5 }}>tokens</span></div>
                        <div style={{ fontSize: '0.75rem', opacity: 0.5 }}>Estimated via local bridge telemetry</div>
                      </div>
                      <div className="glass-card" style={{ padding: '20px', border: '1px solid #ff6b6b44' }}>
                        <div style={{ color: '#ff6b6b', fontWeight: 800 }}>JULES CLOUD USAGE</div>
                        <div style={{ fontSize: '2.5rem', fontWeight: 900 }}>{tokenUsage.jules.toLocaleString()} <span style={{ fontSize: '1rem', opacity: 0.5 }}>tokens</span></div>
                        <div style={{ fontSize: '0.75rem', opacity: 0.5 }}>Offloaded to Google Cloud VMs</div>
                      </div>
                   </div>
                   
                   <p style={{ color: 'var(--text-dim)', margin: '25px 0' }}>When your local context hits high pressure, IMI suggests offloading tasks to **Jules** to preserve your local tokens and leverage cloud scalability.</p>
                   
                   <div className="glass-card" style={{ background: 'rgba(0,255,136,0.05)', border: '1px solid #00ff8844', padding: '20px', marginBottom: '20px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <div style={{ fontWeight: 800, fontSize: '1rem' }}>Handover Snapshot Bridge</div>
                          <div style={{ fontSize: '0.8rem', opacity: 0.6 }}>Last Snapshot: {lastSnapshot ? new Date(lastSnapshot.timestamp).toLocaleTimeString() : 'Never'}</div>
                        </div>
                        <button onClick={async () => {
                          const result = await (ipc as any).invoke('save-context-snapshot', { status: 'Manual User Backup', lastQuery: 'Dashboard Ping' });
                          if (result.success) {
                            fetchStats();
                            alert('Resume Snapshot saved to Project Root!');
                          }
                        }} className="btn-premium" style={{ fontSize: '0.8rem', padding: '8px 15px' }}>Force Snapshot</button>
                      </div>
                   </div>
                 </div>
               </div>
            </motion.div>
          )}

          {activeTab === 'settings' && (
            <motion.div key="set" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="glass-card" style={{ padding: '0', display: 'grid', gridTemplateColumns: '240px 1fr', minHeight: '600px', overflow: 'hidden' }}>
              {/* Settings Sub-Sidebar */}
              <aside style={{ background: 'rgba(0,0,0,0.2)', padding: '2rem 1.5rem', borderRight: '1px solid var(--glass-border)' }}>
                <div style={{ marginBottom: '2rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', background: 'rgba(255,255,255,0.05)', padding: '10px 15px', borderRadius: '12px', border: '1px solid var(--glass-border)' }}>
                    <Search size={16} color="var(--text-dim)" />
                    <input 
                      value={settingsSearch} 
                      onChange={e => setSettingsSearch(e.target.value)} 
                      placeholder="Find setting..." 
                      style={{ background: 'none', border: 'none', color: '#fff', fontSize: '0.8rem', outline: 'none', width: '100%' }}
                    />
                  </div>
                </div>

                <nav style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {[
                    { id: 'general', label: 'General', icon: <Settings2 size={18} /> },
                    { id: 'github', label: 'GitHub Sync', icon: <RefreshCw size={18} /> },
                    { id: 'keys', label: 'API & Tokens', icon: <ShieldCheck size={18} /> },
                    { id: 'advanced', label: 'Advanced', icon: <Gauge size={18} /> }
                  ].filter(tab => tab.label.toLowerCase().includes(settingsSearch.toLowerCase())).map(tab => (
                    <button 
                      key={tab.id}
                      onClick={() => setSettingsActiveSubTab(tab.id)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 1rem', borderRadius: '10px', border: 'none',
                        background: settingsActiveSubTab === tab.id ? 'var(--primary)' : 'transparent',
                        color: settingsActiveSubTab === tab.id ? '#fff' : 'rgba(255,255,255,0.5)',
                        cursor: 'pointer', transition: 'all 0.2s', fontWeight: 700, fontSize: '0.85rem', textAlign: 'left'
                      }}
                    >
                      {tab.icon} {tab.label}
                    </button>
                  ))}
                </nav>
              </aside>

              {/* Settings Content Area */}
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

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                        <h4 style={{ fontWeight: 800, fontSize: '0.9rem' }}>Primary Coding Engine</h4>
                        <div className="director-selector" style={{ width: 'fit-content' }}>
                          {['jules', 'gemini', 'custom'].map(id => (
                            <button 
                              key={id} 
                              onClick={async () => {
                                setActiveEngine(id);
                                // Auto-save to backend immediately so refresh doesn't overwrite it
                                await (ipc as any).invoke('save-api-config', { geminiKey, julesToken, githubToken, activeEngine: id });
                              }} 
                              className={activeEngine === id ? 'active' : ''} 
                              style={{ padding: '8px 20px', borderRadius: '8px', border: 'none', background: activeEngine === id ? 'var(--primary)' : 'transparent', color: '#fff', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 700 }}
                            >
                              {id === 'jules' ? 'Jules Cloud' : id === 'gemini' ? 'Gemini CLI' : '3rd Party'}
                            </button>
                          ))}
                        </div>
                      </div>
                    </motion.div>
                  )}

                  {settingsActiveSubTab === 'github' && (
                    <motion.div key="git" initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} style={{ display: 'flex', flexDirection: 'column', gap: '30px' }}>
                      {!gitInstalled && (
                        <div className="glass-card" style={{ background: 'rgba(255,107,107,0.1)', borderColor: '#ff6b6b44', padding: '15px', display: 'flex', alignItems: 'center', gap: '15px' }}>
                          <AlertCircle color="#ff6b6b" />
                          <div style={{ flex: 1 }}>
                            <div style={{ fontWeight: 800, fontSize: '0.9rem', color: '#ff6b6b' }}>Git Not Detected</div>
                            <p style={{ fontSize: '0.7rem', opacity: 0.7 }}>You need Git to sync with GitHub. Please install it to enable the Export Hub.</p>
                          </div>
                          <button onClick={() => (ipc as any).send('open-external', 'https://git-scm.com/download/win')} className="btn-premium" style={{ background: '#ff6b6b', fontSize: '0.7rem', padding: '8px 15px' }}>Download Git</button>
                        </div>
                      )}
                      <div>
                        <h3 style={{ fontSize: '1.5rem', fontWeight: 800, marginBottom: '5px' }}>GitHub Integration</h3>
                        <p style={{ color: 'var(--text-dim)', fontSize: '0.85rem' }}>Connect your identity and sync your code.</p>
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                        <h4 style={{ fontWeight: 800, fontSize: '0.9rem' }}>Account Profile</h4>
                        {githubUser ? (
                          <div className="glass-card" style={{ padding: '15px', display: 'flex', alignItems: 'center', gap: '15px', background: 'rgba(0,255,136,0.05)', borderColor: '#00ff8844' }}>
                            <img src={githubUser.avatar_url} style={{ width: '40px', height: '40px', borderRadius: '50%' }} alt="avatar" />
                            <div><div style={{ fontWeight: 800, fontSize: '0.9rem' }}>{githubUser.name || githubUser.login}</div><div style={{ fontSize: '0.7rem', opacity: 0.6 }}>@{githubUser.login}</div></div>
                            <div style={{ marginLeft: 'auto', background: '#00ff8822', color: '#00ff88', padding: '4px 10px', borderRadius: '100px', fontSize: '0.6rem', fontWeight: 900 }}>CONNECTED</div>
                          </div>
                        ) : (
                          <button onClick={linkExistingGithub} className="btn-premium" style={{ width: 'fit-content', background: '#24292e' }}>Link Existing Account</button>
                        )}
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                        <h4 style={{ fontWeight: 800, fontSize: '0.9rem' }}>Auto-Link Tool</h4>
                        <div style={{ display: 'flex', gap: '10px' }}>
                          <button onClick={openGitHub} className="btn-premium" style={{ background: '#24292e', fontSize: '0.75rem' }}>1. Create Repo</button>
                          <input value={githubUrl} onChange={e => setGithubUrl(e.target.value)} placeholder="GitHub Repo URL..." className="chat-input" style={{ flex: 1 }} />
                          <button onClick={handleAutoLinkGithub} disabled={isLinking} className="btn-premium" style={{ background: '#00ff88', color: '#000', fontSize: '0.75rem' }}>
                            {isLinking ? <RefreshCw size={14} className="spin" /> : '2. Init & Link'}
                          </button>
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

                      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '20px' }}>
                        {[
                          { label: 'Gemini CLI Key', val: geminiKey, set: setGeminiKey, ph: 'Google AI Studio Key...' },
                          { label: 'Jules Session Token', val: julesToken, set: setJulesToken, ph: 'Paste Jules SID...' },
                          { label: 'GitHub PAT', val: githubToken, set: setGithubToken, ph: 'Personal Access Token...' }
                        ].map(key => (
                          <div key={key.label} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            <label style={{ fontSize: '0.75rem', fontWeight: 700, opacity: 0.7 }}>{key.label}</label>
                            <input type="password" value={key.val} onChange={e => key.set(e.target.value)} placeholder={key.ph} className="chat-input" />
                          </div>
                        ))}
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
                        { title: 'Telemetry Broadcast', desc: 'Send usage metrics for optimized sync.' }
                      ].map(item => (
                        <div key={item.title} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.02)', padding: '20px', borderRadius: '15px', border: '1px solid var(--glass-border)' }}>
                          <div>
                            <div style={{ fontWeight: 700, fontSize: '0.95rem' }}>{item.title}</div>
                            <p style={{ fontSize: '0.75rem', opacity: 0.5 }}>{item.desc}</p>
                          </div>
                          <button className="director-btn active" style={{ width: '70px', height: '35px' }}>TRUE</button>
                        </div>
                      ))}
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
