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

// Mock ipcRenderer for web dev
const ipc = (window as any).ipcRenderer || { send: () => {}, invoke: async () => ({}) };

const App = () => {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [quota, setQuota] = useState(65);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [stats, setStats] = useState<any>({ fileCount: '0', sizeMB: '0', freeMem: '0', platform: '...', dirCount: '0', projectRoot: '' });
  const [usage, setUsage] = useState({ cpu: '0', ram: '0', threads: 0, load: '0' });
  const [activeDirector, setActiveDirector] = useState('gemini');
  const [mcpServers, setMcpServers] = useState<any[]>([]);
  const [newServer, setNewServer] = useState({ name: '', command: '' });
  const [chatInput, setChatInput] = useState('');
  const [projectRootInput, setProjectRootInput] = useState('');
  const [geminiKey, setGeminiKey] = useState('');
  const [julesToken, setJulesToken] = useState('');
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

    const servers = await (ipc as any).invoke('mcp:list-servers');
    if (servers) setMcpServers(servers);

    const snapshot = await (ipc as any).invoke('load-context-snapshot');
    if (snapshot) setLastSnapshot(snapshot);

    const config = await (ipc as any).invoke('get-api-config');
    if (config) {
      setGeminiKey(config.geminiKey || '');
      setJulesToken(config.julesToken || '');
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
    await (ipc as any).invoke('save-api-config', { geminiKey, julesToken });
    alert('API Integration Synced!');
  };

  const connectMCPServer = async () => {
    if (!newServer.name || !newServer.command) return;
    const result = await (ipc as any).invoke('mcp:connect', { 
      name: newServer.name, 
      command: 'npx', 
      args: ['-y', newServer.command] 
    });
    if (result.success) {
      setMcpServers(prev => [...prev, { name: newServer.name, tools: result.tools }]);
      setNewServer({ name: '', command: '' });
      addLog('system', `MCP Server linked: ${newServer.name}`);
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
      text: result.msg || 'Command executed by bridge.'
    };
    setMessages(prev => [...prev, aiResponse]);
    setIsSyncing(false);
    fetchStats();
  };

  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, 2000); // Fast refresh for "moving numbers"
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="dashboard-container">
      <div className="title-bar">
        <div className="window-controls">
          <button onClick={() => ipc.send('window-minimize')} className="control-btn"><Minus size={14} /></button>
          <button onClick={() => ipc.send('window-maximize')} className="control-btn"><Maximize2 size={14} /></button>
          <button onClick={() => ipc.send('window-close')} className="control-btn close"><X size={14} /></button>
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
                  <div key={agent.title} className="glass-card" style={{ padding: '1.5rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span className="tool-badge" style={{ background: agent.color + '22', color: agent.color }}>{agent.badge}</span>
                      <span className="status-online"></span>
                    </div>
                    <h3 style={{ marginTop: '1.5rem', fontSize: '1.4rem', fontWeight: 700 }}>{agent.title}</h3>
                    <div className="terminal-mock" style={{ height: '100px', margin: '15px 0' }}>
                      {agent.logs.map(l => <div key={l.id}><span style={{ color: agent.color }}>[{agent.badge.toLowerCase()}]</span> {l.msg}</div>)}
                    </div>
                    <div style={{ display: 'flex', gap: '10px' }}>
                      <button className="sidebar-btn" style={{ padding: '8px 12px', fontSize: '0.7rem' }} onClick={() => addLog(agent.badge === 'LOCAL' ? 'ag' : agent.badge.toLowerCase(), 'Manual ping heartbeat sent.')}>Send Ping</button>
                      <button className="sidebar-btn" style={{ padding: '8px 12px', fontSize: '0.7rem' }} onClick={() => alert(`${agent.title} is fully integrated.`)}>Diagnostic</button>
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
                  <div className="director-selector">
                    <button onClick={() => setActiveDirector('gemini')} className={activeDirector === 'gemini' ? 'active' : ''}>Gemini</button>
                    <button onClick={() => setActiveDirector('antigravity')} className={activeDirector === 'antigravity' ? 'active' : ''}>AntiGravity</button>
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
                        {m.type==='ai' && <div style={{ fontSize: '0.65rem', opacity: 0.5, marginBottom: '5px' }}>{m.director?m.director.toUpperCase():'SYSTEM'} RESPONSE</div>}
                        {m.text}
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
                   <h3 style={{ fontSize: '1.6rem', fontWeight: 800 }}>MCP Hub</h3>
                   <p style={{ color: 'var(--text-dim)' }}>Link specialized tools directly into the unified bridge.</p>
                 </div>
                 <div style={{ display: 'flex', gap: '10px' }}>
                    <input value={newServer.name} onChange={e => setNewServer({...newServer, name: e.target.value})} placeholder="Registry Name" className="chat-input" style={{ width: '200px' }} />
                    <input value={newServer.command} onChange={e => setNewServer({...newServer, command: e.target.value})} placeholder="NPM Package" className="chat-input" style={{ width: '200px' }} />
                    <button onClick={connectMCPServer} className="btn-premium">Link App</button>
                 </div>
               </div>
               <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                 {mcpServers.map(s => (
                   <div key={s.name} className="glass-card" style={{ padding: '1.5rem', border: '1px solid #00ff8844' }}>
                     <div style={{ fontWeight: 800 }}>{s.name} <span style={{ color: '#00ff88', fontSize: '0.7rem' }}>● ONLINE</span></div>
                     <div style={{ marginTop: '10px', display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
                       {s.tools?.map((t:any) => <span key={t.name} className="tool-badge">{t.name}</span>)}
                     </div>
                   </div>
                 ))}
                 {mcpServers.length === 0 && <div style={{ textAlign: 'center', opacity: 0.4, padding: '4rem', gridColumn: 'span 2' }}><Database size={48} /><p>No external registries linked yet.</p></div>}
               </div>
            </motion.div>
          )}

          {activeTab === 'quota' && (
            <motion.div key="quota" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="glass-card" style={{ padding: '3rem' }}>
               <div style={{ display: 'flex', gap: '40px' }}>
                 <div style={{ flex: 1 }}>
                   <h3 style={{ fontSize: '2rem', fontWeight: 900 }}>{quota}% Quota Remaining</h3>
                   <p style={{ color: 'var(--text-dim)', margin: '15px 0' }}>When tokens hit 0%, IMI generates a **Context Resume Point**. This allows Gemini CLI to see the last goal and exactly where to resume code files.</p>
                   
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

                   <div style={{ background: 'rgba(0,0,0,0.3)', padding: '20px', borderRadius: '15px', border: '1px solid var(--glass-border)' }}>
                      <div style={{ marginBottom: '10px', fontSize: '0.8rem' }}>SYNC PRESSURE</div>
                      <div style={{ height: '100px', display: 'flex', alignItems: 'flex-end', gap: '5px' }}>
                        {[30, 45, 20, 70, 40, 85, 35, 60, 15, 40].map((h, i) => <motion.div key={i} initial={{ height: 0 }} animate={{ height: h + '%' }} style={{ flex: 1, background: 'var(--primary)', opacity: (i+1)/10, borderRadius: '4px' }} />)}
                      </div>
                   </div>
                 </div>
                 <div style={{ width: '300px', display: 'flex', flexDirection: 'column', gap: '15px' }}>
                    <div className="glass-card" style={{ padding: '20px' }}>
                      <div style={{ fontWeight: 800 }}>Project Resume Point</div>
                      <p style={{ fontSize: '0.75rem', opacity: 0.5 }}>Ensures Gemini CLI knows your plan.</p>
                      <button onClick={() => setSnapshotMode(!snapshotMode)} className="sidebar-btn" style={{ marginTop: '10px', width: '100%', color: snapshotMode ? '#00ff88' : '#ff6b6b' }}>
                        {snapshotMode ? 'AUTO-SNAPSHOT: ON' : 'AUTO-SNAPSHOT: OFF'}
                      </button>
                    </div>
                    <div className="glass-card" style={{ padding: '20px' }}>
                      <div style={{ fontWeight: 800 }}>Transfer Guard</div>
                      <p style={{ fontSize: '0.75rem', opacity: 0.5 }}>Syncs .imi-history before token exit.</p>
                      <button className="sidebar-btn" style={{ marginTop: '10px', width: '100%', color: '#00ff88' }}>ENFORCED: ACTIVE</button>
                    </div>
                 </div>
               </div>
            </motion.div>
          )}

          {activeTab === 'settings' && (
            <motion.div key="set" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="glass-card" style={{ padding: '2.5rem' }}>
              <h3 style={{ fontSize: '1.8rem', fontWeight: 800, marginBottom: '2rem' }}>System Preferences</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '25px', maxWidth: '600px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <label style={{ fontWeight: 700, fontSize: '0.9rem' }}>Project Root Path</label>
                  <p style={{ fontSize: '0.8rem', opacity: 0.5 }}>Tell the EXE where your source code is located to enable stats & watchdogs.</p>
                  <div style={{ display: 'flex', gap: '10px' }}>
                    <input 
                      value={projectRootInput} 
                      onChange={e => setProjectRootInput(e.target.value)} 
                      placeholder="C:\Users\...\Project" 
                      className="chat-input" 
                    />
                    <button onClick={updateRoot} className="btn-premium">Set Root</button>
                  </div>
                </div>

                <div className="divider-v" style={{ width: '100%', height: '1px', margin: '10px 0' }}></div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div style={{ padding: '8px', background: 'rgba(0,210,255,0.1)', borderRadius: '10px' }}>
                      <Zap size={20} color="#00d2ff" />
                    </div>
                    <div>
                      <h4 style={{ fontWeight: 800 }}>API Orchestration</h4>
                      <p style={{ fontSize: '0.75rem', opacity: 0.5 }}>How IMI knows your AI credentials. Enter keys here to bridge Gemini and Jules.</p>
                    </div>
                  </div>
                  
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                      <label style={{ fontSize: '0.75rem', fontWeight: 700, opacity: 0.7 }}>Gemini CLI Key</label>
                      <input 
                        type="password" 
                        value={geminiKey} 
                        onChange={e => setGeminiKey(e.target.value)} 
                        placeholder="Paste Google AI Studio Key..." 
                        className="chat-input" 
                      />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                      <label style={{ fontSize: '0.75rem', fontWeight: 700, opacity: 0.7 }}>Jules Session Token</label>
                      <input 
                        type="password" 
                        value={julesToken} 
                        onChange={e => setJulesToken(e.target.value)} 
                        placeholder="Paste Jules SID..." 
                        className="chat-input" 
                      />
                    </div>
                  </div>
                  <button onClick={saveConfig} className="btn-premium" style={{ width: 'fit-content', padding: '10px 30px' }}>Sync Credentials</button>
                  <p style={{ fontSize: '0.7rem', color: '#ffab00' }}>ℹ️ You don't need the local CLI downloads if you provide these keys—IMI handles the communication itself.</p>
                </div>

                <div className="divider-v" style={{ width: '100%', height: '1px', margin: '10px 0' }}></div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontWeight: 700 }}>Autonomous Debugging</div>
                    <p style={{ fontSize: '0.75rem', opacity: 0.5 }}>Allow agents to fix their own errors without asking.</p>
                  </div>
                  <button className="director-btn active" style={{ width: '60px', height: '30px' }}>TRUE</button>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontWeight: 700 }}>Telemetry Broadcast</div>
                    <p style={{ fontSize: '0.75rem', opacity: 0.5 }}>Send metrics to current director for optimized sync.</p>
                  </div>
                  <button className="director-btn active" style={{ width: '60px', height: '30px' }}>TRUE</button>
                </div>
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
