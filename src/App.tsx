import { useState } from 'react';
import reactLogo from './assets/react.svg';
import electronLogo from './assets/electron.svg';
import viteLogo from '/vite.svg';
import './App.css';

interface CodeChangeSpec {
  file: string;
  changes: string; // The exact code changes to be made (can be multi-line)
  outcome: string; // The desired result/reason for the change
}

function App() {
  const [count, setCount] = useState(0);
  const [activeTab, setActiveTab] = useState('Dashboard');

  const [latestCodeChangeSpec, setLatestCodeChangeSpec] = useState<CodeChangeSpec | null>(null);

  // This function would be invoked by an ipcRenderer.on listener
  // when electron-main.cjs sends a CODE_CHANGE_SPEC event.
  // For testing, a temporary button or a setTimeout can trigger it.
  const receiveBrainCodeChange = (spec: CodeChangeSpec) => {
    setLatestCodeChangeSpec(spec);
    setActiveTab('Command Center'); // Automatically switch to Command Center
  };

  // Example of a temporary test button (can be removed later)
  const mockBrainOutput = () => {
    receiveBrainCodeChange({
      file: 'src/App.tsx',
      changes: `// New import for styling
import './App.css';

// ... inside Command Center tab content
<div className="brain-strategy-output">
  <h3>Brain's Proposed Code Change</h3>
  {/* ... content */}
</div>`,
      outcome: 'Improved presentation of AI output in Command Center.'
    });
  };

  return (
    <div className="container">
      <div className="sidebar">
        <div className="logo-section">
          <a href="https://electron.atom.io" target="_blank">
            <img src={electronLogo} className="logo electron" alt="Electron logo" />
          </a>
          <a href="https://vitejs.dev" target="_blank">
            <img src={viteLogo} className="logo" alt="Vite logo" />
          </a>
          <a href="https://react.dev" target="_blank">
            <img src={reactLogo} className="logo react" alt="React logo" />
          </a>
        </div>
        <nav className="tabs">
          <button className={activeTab === 'Dashboard' ? 'active' : ''} onClick={() => setActiveTab('Dashboard')}>
            Dashboard
          </button>
          <button className={activeTab === 'Command Center' ? 'active' : ''} onClick={() => setActiveTab('Command Center')}>
            Command Center
          </button>
          <button className={activeTab === 'Settings' ? 'active' : ''} onClick={() => setActiveTab('Settings')}>
            Settings
          </button>
        </nav>
      </div>

      <div className="main-content">
        <div className="tab-content">
          {activeTab === 'Dashboard' && (
            <div className="dashboard-content">
              <h1>IMI Dashboard</h1>
              <p>Click on the Vite and React logos to learn more</p>
              <div className="card">
                <button onClick={() => setCount((count) => count + 1)}>
                  count is {count}
                </button>
              </div>
              <p className="read-the-docs">
                Edit <code>src/App.tsx</code> and save to test HMR
              </p>
            </div>
          )}

          {activeTab === 'Command Center' && (
            <div className="command-center-content">
              <h2>Command Center</h2>
              {/* Temporary button to test the display, remove after IPC is hooked up */}
              <button onClick={mockBrainOutput} style={{ marginBottom: '20px' }}>
                Show Mock Brain Output
              </button>

              {latestCodeChangeSpec && (
                <div className="brain-strategy-output">
                  <h3>Brain's Proposed Code Change</h3>
                  <p><strong>File:</strong> <code>{latestCodeChangeSpec.file}</code></p>
                  <h4>Exact Changes to Make:</h4>
                  <pre className="code-block">{latestCodeChangeSpec.changes}</pre>
                  <h4>Desired Outcome:</h4>
                  <p>{latestCodeChangeSpec.outcome}</p>
                  {/* Placeholder for future actions like "Send to Coder" or "Apply" */}
                  {/* <button className="action-button">Send to Coder</button> */}
                </div>
              )}
              <p>This is where strategic commands and AI outputs will be displayed.</p>
            </div>
          )}

          {activeTab === 'Settings' && (
            <div className="settings-content">
              <h2>Settings</h2>
              <p>Configure IMI settings here.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
