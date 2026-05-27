import './app.css';

const primaryNodes = [
  { label: 'AI', className: 'node node-ai', style: { top: '18%', left: '46%' } },
  { label: 'Ethics', className: 'node node-ethics', style: { top: '34%', left: '29%' } },
  { label: 'Education', className: 'node node-education', style: { top: '32%', left: '61%' } },
  { label: 'Privacy', className: 'node node-privacy', style: { top: '61%', left: '31%' } },
  { label: 'Healthcare', className: 'node node-healthcare', style: { top: '63%', left: '63%' } },
  { label: 'Employment', className: 'node node-employment', style: { top: '72%', left: '46%' } },
];

const navItems = ['Home', 'Graph', 'Chat', 'Nodes', 'Media', 'Settings'];

function App() {
  return (
    <main className="app-shell">
      <aside className="sidebar" aria-label="Workspace navigation">
        <div className="brand">
          <span className="brand-mark">L</span>
          <span>Lumina Wiki</span>
        </div>
        <button className="new-chat-button" type="button">New Chat</button>
        <nav className="nav-list">
          {navItems.map((item) => (
            <button className={item === 'Graph' ? 'nav-item active' : 'nav-item'} key={item} type="button">
              <span className="nav-dot" />
              {item}
            </button>
          ))}
        </nav>
        <section className="sidebar-section">
          <h2>Recent Chats</h2>
          {['AI Social Impact', 'Climate Change', 'Quantum Computing', 'Personal Notes'].map((item) => (
            <button className="sidebar-link" key={item} type="button">{item}</button>
          ))}
        </section>
        <section className="sidebar-section">
          <h2>Favorite Nodes</h2>
          {['AI', 'Social Impact', 'Ethics', 'Education'].map((item) => (
            <button className="sidebar-link" key={item} type="button">{item}</button>
          ))}
        </section>
        <div className="workspace-card">
          <div className="avatar">LH</div>
          <div>
            <strong>tronghieu</strong>
            <span>Local Workspace</span>
          </div>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="breadcrumb">Graph / AI Social Impact</p>
            <h1>AI Social Impact <span>12 nodes</span></h1>
          </div>
          <div className="toolbar">
            <button type="button">Add node</button>
            <button type="button">Filters</button>
            <input aria-label="Search nodes" placeholder="Search nodes..." />
          </div>
        </header>

        <div className="graph-canvas" aria-label="Graph preview">
          <div className="edge edge-vertical" />
          <div className="edge edge-horizontal" />
          <div className="edge edge-diagonal-left" />
          <div className="edge edge-diagonal-right" />
          <div className="central-node">AI Social Impact</div>
          {primaryNodes.map((node) => (
            <div className={node.className} key={node.label} style={node.style}>{node.label}</div>
          ))}
          <div className="mini-map" aria-hidden="true">
            <div />
            <span />
          </div>
          <div className="zoom-controls">
            <button type="button">-</button>
            <span>100%</span>
            <button type="button">+</button>
          </div>
        </div>
      </section>

      <aside className="inspector" aria-label="Node inspector">
        <header className="inspector-header">
          <div className="brand-mark small">L</div>
          <h2>AI Social Impact</h2>
        </header>
        <nav className="tabs">
          {['Details', 'Chat', 'Linked (12)', 'Media'].map((tab) => (
            <button className={tab === 'Chat' ? 'active' : ''} key={tab} type="button">{tab}</button>
          ))}
        </nav>
        <section className="chat-card">
          <div className="chat-question">What are the key areas of AI's social impact?</div>
          <div className="chat-answer">
            <p>AI social impact touches ethics, education, healthcare, employment, and privacy.</p>
            <ul>
              <li>Ethics: bias, fairness, transparency.</li>
              <li>Education: personalization and access.</li>
              <li>Privacy: data security and consent.</li>
            </ul>
          </div>
        </section>
        <div className="prompt-box">
          <input aria-label="Ask about graph" placeholder="Ask anything about this graph..." />
          <button type="button">Send</button>
        </div>
      </aside>
    </main>
  );
}

export default App;
