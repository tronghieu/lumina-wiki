import { useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import ForceGraph from 'force-graph';
import MarkdownIt from 'markdown-it';

const md = new MarkdownIt({ html: false, linkify: false });

// Placeholder body: later stories replace App.
function App() {
  const graphRef = useRef(null);
  useEffect(() => {
    const el = graphRef.current;
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
    const graph = new ForceGraph(el).width(el.clientWidth).height(el.clientHeight).backgroundColor(bg).graphData({ nodes: [], links: [] });
    return () => graph._destructor?.();
  }, []);
  return (
    <div className="app">
      <div className="pane pane-graph" ref={graphRef} />
      <aside className="pane pane-tree">
        <p className="status">{md.renderInline('Loading wiki...')}</p>
      </aside>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
