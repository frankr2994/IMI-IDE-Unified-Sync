import React, { useState, useEffect } from 'react';
import './App.css'; // Assuming App.css exists for general styling

// Declare global interface for Electron IPC Renderer, assuming preload.js exposes it
declare global {
  interface Window {
    electron: {
      ipcRenderer: {
        invoke: (channel: string, ...args: any[]) => Promise<any>;
      };
    };
  }
}

function App() {
  const [currentTab, setCurrentTab] = useState('Chat'); // Example: 'Chat', 'System', etc.
  const [aiContextPaths, setAiContextPaths] = useState<string[]>([]);
  const [newContextPath, setNewContextPath] = useState<string>('');
  const [chatInput, setChatInput] = useState('');
  const [chatMessages, setChatMessages] = useState<{ sender: string; message: string; fullPrompt?: string }[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Effect to fetch AI context paths on component mount
  useEffect(() => {
    const fetchContextPaths = async () => {
      try {
        const paths = await window.electron.ipcRenderer.invoke('get-ai-context-paths');
        setAiContextPaths(paths);
      } catch (error) {
        console.error('Failed to fetch AI context paths:', error);
      }
    };
    fetchContextPaths();
  }, []);

  const handleAddPath = async () => {
    if (newContextPath.trim() && !aiContextPaths.includes(newContextPath.trim())) {
      const updatedPaths = [...aiContextPaths, newContextPath.trim()];
      setAiContextPaths(updatedPaths);
      await window.electron.ipcRenderer.invoke('save-ai-context-paths', updatedPaths);
      setNewContextPath('');
      // Optional: Add visual feedback for success/failure
    }
  };

  const handleRemovePath = async (pathToRemove: string) => {
    const updatedPaths = aiContextPaths.filter(path => path !== pathToRemove);
    setAiContextPaths(updatedPaths);
    await window.electron.ipcRenderer.invoke('save-ai-context-paths', updatedPaths);
    // Optional: Add visual feedback for success/failure
  };

  const handleSendMessage = async () => {
    if (chatInput.trim() === '') return;

    const userMessage = chatInput.trim();
    setChatMessages(prev => [...prev, { sender: 'User', message: userMessage }]);
    setChatInput('');
    setIsLoading(true);

    try {
      const response = await window.electron.ipcRenderer.invoke('send-ai-request', userMessage);
      setChatMessages(prev => [...prev, { sender: 'Brain AI', message: response.response, fullPrompt: response.fullPrompt }]);
    } catch (error) {
      console.error('Error sending message to AI:', error);
      setChatMessages(prev => [...prev, { sender: 'System', message: `Error: ${error.message}` }]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="App" style={{ display: 'flex', flexDirection: 'column', height: '100vh', fontFamily: 'Arial, sans-serif' }}>
      <header style={{ padding: '10px 20px', borderBottom: '1px solid #eee', backgroundColor: '#f8f8f8' }}>
        <nav>
          <button 
            onClick={() => setCurrentTab('Chat')}
            style={{ padding: '8px 15px', marginRight: '10px', cursor: 'pointer', backgroundColor: currentTab === 'Chat' ? '#007bff' : '#f0f0f0', color: currentTab === 'Chat' ? 'white' : 'black', border: 'none', borderRadius: '4px' }}
          >
            Chat
          </button>
          <button 
            onClick={() => setCurrentTab('System')}
            style={{ padding: '8px 15px', cursor: 'pointer', backgroundColor: currentTab === 'System' ? '#007bff' : '#f0f0f0', color: currentTab === 'System' ? 'white' : 'black', border: 'none', borderRadius: '4px' }}
          >
            System
          </button>
        </nav>
      </header>

      <main style={{ flexGrow: 1, padding: '20px', overflowY: 'auto' }}>
        {currentTab === 'Chat' && (
          <div className="chat-interface" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <div className="messages" style={{ flexGrow: 1, overflowY: 'auto', border: '1px solid #ddd', padding: '10px', borderRadius: '5px', marginBottom: '10px', backgroundColor: '#fff' }}>
              {chatMessages.map((msg, index) => (
                <div key={index} style={{ marginBottom: '10px', padding: '8px', borderRadius: '5px', backgroundColor: msg.sender === 'User' ? '#e0f7fa' : '#f1f8e9', borderLeft: msg.sender === 'User' ? '3px solid #00bcd4' : '3px solid #8bc34a' }}>
                  <strong>{msg.sender}:</strong> {msg.message}
                  {msg.fullPrompt && (
                    <details style={{ marginTop: '5px', fontSize: '0.8em', color: '#555' }}>
                      <summary>View Full Prompt</summary>
                      <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', backgroundColor: '#f0f0f0', padding: '5px', borderRadius: '3px' }}>{msg.fullPrompt}</pre>
                    </details>
                  )}
                </div>
              ))}
              {isLoading && <div style={{ fontStyle: 'italic', color: '#888' }}>Brain AI is thinking...</div>}
            </div>
            <div className="input-area" style={{ display: 'flex' }}>
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyPress={(e) => { if (e.key === 'Enter') handleSendMessage(); }}
                placeholder="Ask the Brain AI..."
                style={{ flexGrow: 1, padding: '10px', border: '1px solid #ddd', borderRadius: '5px', marginRight: '10px' }}
                disabled={isLoading}
              />
              <button 
                onClick={handleSendMessage}
                style={{ padding: '10px 20px', backgroundColor: '#28a745', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer' }}
                disabled={isLoading}
              >
                Send
              </button>
            </div>
          </div>
        )}

        {currentTab === 'System' && (
          <div className="system-tab-content" style={{ maxWidth: '800px', margin: '0 auto' }}>
            <h1 style={{ borderBottom: '1px solid #eee', paddingBottom: '10px', marginBottom: '20px' }}>System Settings</h1>

            <div className="ai-context-configuration" style={{ marginBottom: '30px', padding: '15px', border: '1px solid #ddd', borderRadius: '8px', backgroundColor: '#f9f9f9' }}>
              <h2 style={{ marginTop: '0', color: '#333' }}>AI Context Configuration</h2>
              <p style={{ color: '#555', fontSize: '0.9em' }}>Specify files or directories whose content should be automatically included in the AI's operational context for enhanced understanding.</p>
              <div style={{ display: 'flex', marginBottom: '15px' }}>
                <input
                  type="text"
                  value={newContextPath}
                  onChange={(e) => setNewContextPath(e.target.value)}
                  placeholder="Enter file path (e.g., src/utils/helpers.ts)"
                  style={{ flexGrow: 1, padding: '8px', border: '1px solid #ccc', borderRadius: '4px', marginRight: '10px' }}
                />
                <button 
                  onClick={handleAddPath}
                  style={{ padding: '8px 15px', backgroundColor: '#007bff', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                >
                  Add Path
                </button>
              </div>

              {aiContextPaths.length > 0 ? (
                <ul style={{ listStyle: 'none', padding: '0' }}>
                  {aiContextPaths.map((path, index) => (
                    <li key={index} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px dashed #eee' }}>
                      <span style={{ flexGrow: 1, marginRight: '10px', color: '#333' }}>{path}</span>
                      <button 
                        onClick={() => handleRemovePath(path)}
                        style={{ padding: '5px 10px', fontSize: '0.8em', backgroundColor: '#dc3545', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p style={{ color: '#777', fontStyle: 'italic' }}>No AI context paths configured yet. Add files to provide more context to the AI.</p>
              )}
            </div>

            {/* ... potentially other system settings below ... */}
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
