import { useEffect, useRef } from 'react';
import ForceGraph from 'force-graph';
import { NEUTRAL, nodeLabelHtml, linkLabelHtml } from '../lib/graph-model.mjs';
import { urlNodeHref } from '../lib/links.mjs';
import { nodeFill } from '../lib/communities.mjs';
import { STRINGS } from '../lib/strings.mjs';

const idOf = (x) => (typeof x === 'object' ? x.id : x);
const hollow = (n) => n.kind !== 'page';

export function GraphPane({ model, visible, openId, selectedEdge, colorMode = 'type', lintRings = null, onOpen, onSelectEdge, onClearEdge, children }) {
  const canvasRef = useRef(null);
  const graphRef = useRef(null);
  const hoverRef = useRef(null);
  const openRef = useRef(openId);
  const edgeRef = useRef(selectedEdge);
  const visRef = useRef(visible);
  const modeRef = useRef(colorMode);
  const ringsRef = useRef(lintRings);
  const cbRef = useRef({ onOpen, onSelectEdge, onClearEdge });
  cbRef.current = { onOpen, onSelectEdge, onClearEdge };

  // Re-applying the accessors makes the library repaint (autoPause is on); rings, labels and arrows follow the focus too.
  const redraw = () => {
    const g = graphRef.current;
    if (!g) return;
    g.nodeColor(g.nodeColor()).linkColor(g.linkColor()).linkWidth(g.linkWidth())
      .nodeCanvasObject(g.nodeCanvasObject()).linkCanvasObject(g.linkCanvasObject())
      .linkDirectionalArrowLength(g.linkDirectionalArrowLength());
  };

  useEffect(() => {
    const el = canvasRef.current;
    const css = getComputedStyle(document.documentElement);
    const theme = Object.fromEntries(
      ['--bg', '--fg', '--muted', '--error', '--warning', '--info'].map((k) => [k, css.getPropertyValue(k).trim()]),
    );
    const bg = theme['--bg'];
    // The library mutates what it is given, so it gets copies; the model stays pristine.
    const nodes = model.nodes.map((n) => ({ ...n }));
    const links = model.links.map((l) => ({ ...l }));
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const deg = (id) => model.degree.get(id) || 0;

    const focus = () => {
      const h = hoverRef.current;
      if (h !== null) return h;
      const o = openRef.current;
      return byId.has(o) ? o : null;
    };
    // Only relations that survive the filters keep a neighbour bright.
    const lit = (id) => {
      const f = focus();
      return f === null || id === f || visRef.current.neighbors.get(f)?.has(id);
    };
    const touches = (l) => {
      const f = focus();
      return f !== null && (idOf(l.source) === f || idOf(l.target) === f);
    };
    const chosen = (l) => l.key === edgeRef.current;
    const fill = (n) => nodeFill(n, modeRef.current);
    // Only 7-character hex colors take an alpha suffix.
    const fade = (c, on) => (on || !/^#[0-9a-f]{6}$/i.test(c) ? c : c + '33');
    const ring = (n) => (n.kind === 'url' ? NEUTRAL : n.kind === 'missing' ? theme['--error'] : null);

    const g = new ForceGraph(el)
      .width(el.clientWidth).height(el.clientHeight)
      .backgroundColor(bg)
      .graphData({ nodes, links })
      .nodeVisibility((n) => visRef.current.nodeIds.has(n.id))
      .linkVisibility((l) => visRef.current.linkKeys.has(l.key))
      .nodeId('id').nodeRelSize(4).nodeVal('val')
      .cooldownTime(Infinity).d3AlphaMin(0.001)
      .nodeColor((n) => (hollow(n) ? bg : lit(n.id) ? fill(n) : fill(n) + '33'))
      .nodeCanvasObjectMode(() => 'after')
      .nodeCanvasObject((n, ctx, scale) => {
        const r = Math.sqrt(n.val) * 4;
        const stroke = ring(n);
        if (stroke) {
          ctx.beginPath();
          ctx.arc(n.x, n.y, r, 0, 2 * Math.PI);
          ctx.strokeStyle = lit(n.id) ? stroke : stroke + '33';
          ctx.lineWidth = 1.5 / scale;
          ctx.stroke();
        }
        const isOpen = n.id === openRef.current;
        if (isOpen) {
          ctx.beginPath();
          ctx.arc(n.x, n.y, r + 2.5, 0, 2 * Math.PI);
          ctx.strokeStyle = theme['--fg'];
          ctx.lineWidth = 1.5 / scale;
          ctx.stroke();
        }
        const sev = ringsRef.current?.get(n.id);
        if (sev) {
          ctx.beginPath();
          ctx.arc(n.x, n.y, r + 2.5 + (isOpen ? 2.5 : 0), 0, 2 * Math.PI);
          ctx.strokeStyle = fade((theme[`--${sev}`] || fill(n)).trim(), lit(n.id));
          ctx.lineWidth = 1.5 / scale;
          ctx.stroke();
        }
      })
      .linkColor((l) => {
        const src = byId.get(idOf(l.source));
        const c = fill(src);
        return focus() === null && !chosen(l) ? c + '59' : touches(l) || chosen(l) ? c : c + '14';
      })
      .linkWidth((l) => (touches(l) || chosen(l) ? 1.6 : 0.6))
      .linkCurvature('curvature')
      .linkDirectionalArrowLength((l) => (l.directed ? 3 : 0))
      .linkDirectionalArrowRelPos(1)
      .linkLineDash((l) => (l.citation ? [2, 2] : null))
      .linkCanvasObjectMode(() => 'after')
      .linkCanvasObject((l, ctx, scale) => {
        if (scale < 2.5 || l.source === l.target) return;
        if (focus() !== null && !touches(l) && !chosen(l)) return;
        const { source: s, target: t } = l;
        const cp = l.__controlPoints;
        const mx = cp ? 0.25 * s.x + 0.5 * cp[0] + 0.25 * t.x : (s.x + t.x) / 2;
        const my = cp ? 0.25 * s.y + 0.5 * cp[1] + 0.25 * t.y : (s.y + t.y) / 2;
        let a = Math.atan2(t.y - s.y, t.x - s.x);
        if (a > Math.PI / 2 || a < -Math.PI / 2) a += Math.PI;
        ctx.save();
        ctx.translate(mx, my);
        ctx.rotate(a);
        ctx.font = `${12 / scale}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const w = ctx.measureText(l.type).width;
        ctx.fillStyle = bg;
        ctx.fillRect(-w / 2 - 1 / scale, -7 / scale, w + 2 / scale, 14 / scale);
        ctx.fillStyle = theme['--muted'];
        ctx.fillText(l.type, 0, 0);
        ctx.restore();
      })
      // The label builders escape: the library writes these strings as HTML.
      .nodeLabel(nodeLabelHtml)
      .linkLabel(linkLabelHtml)
      .showPointerCursor((o) => !!o && (o.kind ? o.kind === 'page' || (o.kind === 'url' && !!urlNodeHref(o.id)) : !!o.source))
      .onNodeHover((n) => { hoverRef.current = n && visRef.current.nodeIds.has(n.id) ? n.id : null; redraw(); })
      .onNodeClick((n) => {
        if (!visRef.current.nodeIds.has(n.id)) return;
        if (n.kind === 'page') cbRef.current.onOpen(n.id);
        else if (n.kind === 'url') {
          const href = urlNodeHref(n.id);
          if (href) window.open(href, '_blank', 'noopener,noreferrer');
        }
      })
      .onLinkClick((l) => { if (visRef.current.linkKeys.has(l.key)) cbRef.current.onSelectEdge(l.key); })
      .onBackgroundClick(() => cbRef.current.onClearEdge());

    g.d3Force('charge').strength(-200);
    g.d3Force('link').distance(70)
      .strength((l) => 1 / Math.max(1, Math.min(deg(idOf(l.source)), deg(idOf(l.target)))));
    // The first fit must not fight a reader who already panned or zoomed.
    let fitted = false;
    let touched = false;
    const touch = () => { touched = true; };
    el.addEventListener('pointerdown', touch, { passive: true });
    el.addEventListener('wheel', touch, { passive: true });
    // A canvas that loses the pointer without a hover event would keep the old focus.
    const leave = () => { hoverRef.current = null; redraw(); };
    el.addEventListener('pointerleave', leave);
    g.onEngineStop(() => {
      if (fitted) return;
      fitted = true;
      // Fitting to zero or one node zooms absurdly far or does nothing, so fall back to all nodes.
      if (!touched && nodes.length > 1) g.zoomToFit(400, 40, visRef.current.nodeIds.size > 1 ? (n) => visRef.current.nodeIds.has(n.id) : undefined);
    });
    graphRef.current = g;

    const ro = new ResizeObserver(() => g.width(el.clientWidth).height(el.clientHeight));
    ro.observe(el);
    return () => {
      ro.disconnect();
      el.removeEventListener('pointerdown', touch);
      el.removeEventListener('wheel', touch);
      el.removeEventListener('pointerleave', leave);
      graphRef.current = null;
      hoverRef.current = null;
      if (g._destructor) g._destructor();
    };
  }, [model]);

  // Filtering only toggles visibility: the graph and its layout are never rebuilt.
  const firstVisRun = useRef(true);
  useEffect(() => {
    visRef.current = visible;
    const g = graphRef.current;
    if (!g) return;
    g.nodeVisibility(g.nodeVisibility()).linkVisibility(g.linkVisibility());
    redraw();
    // The first run has no layout yet; the engine-stop fit covers it.
    if (firstVisRun.current) { firstVisRun.current = false; return; }
    // Refit only when narrowing left nothing on screen; otherwise the view must not move.
    const el = canvasRef.current;
    const shown = g.graphData().nodes.filter((n) => visible.nodeIds.has(n.id) && n.x !== undefined);
    if (shown.length === 0) return;
    const onScreen = shown.some((n) => {
      const p = g.graph2ScreenCoords(n.x, n.y);
      return p.x >= 0 && p.y >= 0 && p.x <= el.clientWidth && p.y <= el.clientHeight;
    });
    if (onScreen) return;
    if (shown.length === 1) g.centerAt(shown[0].x, shown[0].y, 400);
    else g.zoomToFit(400, 40, (n) => visible.nodeIds.has(n.id));
  }, [visible, model]);

  // openId changes must not rebuild the graph; the ref feeds the accessors.
  useEffect(() => {
    openRef.current = openId;
    redraw();
    const g = graphRef.current;
    const el = canvasRef.current;
    const n = g && g.graphData().nodes.find((x) => x.id === openId);
    if (!n || n.x === undefined) return;
    const p = g.graph2ScreenCoords(n.x, n.y);
    const m = 24;
    if (p.x < m || p.y < m || p.x > el.clientWidth - m || p.y > el.clientHeight - m) g.centerAt(n.x, n.y, 400);
  }, [openId, model]);

  useEffect(() => {
    edgeRef.current = selectedEdge;
    redraw();
  }, [selectedEdge, model]);

  // Color mode and lint rings only repaint: no data reset, no re-heat, no camera move.
  useEffect(() => {
    modeRef.current = colorMode;
    ringsRef.current = lintRings;
    redraw();
  }, [colorMode, lintRings, model]);

  return (
    <section className="pane pane-graph" aria-label={STRINGS.graphLabel}>
      <div className="graph-canvas" ref={canvasRef} />
      {model.nodes.length === 0 && <p className="status graph-empty">{STRINGS.graphEmpty}</p>}
      {children}
    </section>
  );
}
