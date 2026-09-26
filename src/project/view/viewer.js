/**
 * Lumina project graph view (CAP-12, graph-view.md). Browser-only, plain
 * script (not a module -- ES module scripts are blocked by CORS on
 * `file://`). Reads `window.__LUMINA_VIEW_DATA__` (inlined by `view.mjs`)
 * and drives the vendored global `ForceGraph`. No network, no build step.
 */
(function () {
  'use strict';

  var DATA = window.__LUMINA_VIEW_DATA__ || { nodes: [], edges: [], findings: [], freshness: { docs: [], summary: {} } };
  var nodes = DATA.nodes || [];
  var findings = DATA.findings || [];
  var freshness = DATA.freshness || { docs: [], summary: {} };

  // An edge whose endpoint isn't a real node (a data inconsistency the
  // engine should never produce, but the page must not crash on) would make
  // `neighborsOf[e.to].push` throw below and blank the whole page -- drop it
  // up front instead.
  var nodeIds = {};
  nodes.forEach(function (n) { nodeIds[n.id] = true; });
  var edges = (DATA.edges || []).filter(function (e) {
    return Object.prototype.hasOwnProperty.call(nodeIds, e.from) && Object.prototype.hasOwnProperty.call(nodeIds, e.to);
  });

  var appEl = document.getElementById('app');
  var canvasEl = document.getElementById('graph-canvas');

  if (nodes.length === 0) {
    document.getElementById('empty-message').hidden = false;
    canvasEl.hidden = true;
    document.getElementById('panel').hidden = true;
    return;
  }

  // -------------------------------------------------------------------------
  // Derived indices, computed once from the (already sorted) input data.
  // -------------------------------------------------------------------------

  var META_TYPES = ['Decision', 'Requirement', 'Rule', 'Capability', 'Process', 'Structure', 'Concept', 'Actor', 'Issue', 'Evidence', 'Document'];
  var PALETTE = {
    Decision: '#e07a5f', Requirement: '#3d9970', Rule: '#b565d8',
    Capability: '#3b6fe0', Process: '#e0b83b', Structure: '#4fb3bf',
    Concept: '#8a8a8a', Actor: '#d84f8f', Issue: '#d1373f',
    Evidence: '#5c8ce0', Document: '#7a7a7a', Unknown: '#555b66',
  };
  var NODE_REL_SIZE = 4;
  var LINK_LABEL_ZOOM_THRESHOLD = 2.5;

  var degree = Object.create(null);
  var neighborsOf = Object.create(null);
  nodes.forEach(function (n) { degree[n.id] = 0; neighborsOf[n.id] = []; });
  edges.forEach(function (e) {
    degree[e.from] = (degree[e.from] || 0) + 1;
    degree[e.to] = (degree[e.to] || 0) + 1;
    neighborsOf[e.from].push(e.to);
    neighborsOf[e.to].push(e.from);
  });

  var findingsByFile = Object.create(null);
  findings.forEach(function (f) {
    if (!findingsByFile[f.file]) findingsByFile[f.file] = [];
    findingsByFile[f.file].push(f);
  });

  var docStateByPath = Object.create(null);
  (freshness.docs || []).forEach(function (d) { docStateByPath[d.path] = d.state; });

  function metaTypeOf(n) { return n.metaType || 'Unknown'; }
  function colorFor(n) { return PALETTE[metaTypeOf(n)] || PALETTE.Unknown; }
  function nodeFile(n) { return (n.at && n.at.file) || null; }
  function nodeFolder(n) {
    var f = nodeFile(n);
    if (!f) return '(none)';
    var i = f.lastIndexOf('/');
    return i === -1 ? '(root)' : f.slice(0, i);
  }
  // Findings and staleness are per-*document*, not per-node: `at.file` on a
  // concept/id/frag node is (for concept/id) the file of whatever doc first
  // *cites* it, or (for frag) the doc it lives inside -- attaching findings
  // by that file would make a concept inherit a citing doc's problems, or a
  // fragment double up on its parent doc's ring. Only a `doc:` node's own
  // file is its own.
  function docPathOf(n) { return n.kind === 'doc' ? nodeFile(n) : null; }
  function nodeFindings(n) {
    var f = docPathOf(n);
    return (f && findingsByFile[f]) || [];
  }
  function nodeIsStale(n) {
    var f = docPathOf(n);
    return !!f && docStateByPath[f] === 'stale';
  }
  function nodeWorstSeverity(n) {
    var fs = nodeFindings(n);
    if (fs.some(function (f) { return f.severity === 'error'; })) return 'error';
    if (fs.some(function (f) { return f.severity === 'warning'; })) return 'warning';
    return fs.length ? 'info' : null;
  }
  function nodeRadius(n) { return Math.sqrt(1 + (degree[n.id] || 0)) * NODE_REL_SIZE; }
  function fade(hex) { return /^#[0-9a-fA-F]{6}$/.test(hex) ? hex + '33' : hex; }
  function idOf(x) { return x && typeof x === 'object' ? x.id : x; }
  function getCss(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

  // force-graph's own tooltip (float-tooltip, bundled in the vendored UMD)
  // inserts a `nodeLabel`/`linkLabel` string via innerHTML, and the page's
  // CSP allows inline script -- an unescaped label built from doc content
  // (a status value, a path) could carry a live `<img onerror=...>`. Escape
  // every string handed to those two accessors.
  var HTML_ESCAPES = {
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  };
  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, function (c) { return HTML_ESCAPES[c]; }); }

  // -------------------------------------------------------------------------
  // Editor link (spec: root = location.pathname at view time, minus the
  // trailing "/_lumina/graph/view.html"; a Windows drive path loses its
  // leading slash).
  // -------------------------------------------------------------------------

  function computeRoot() {
    var VIEW_SUFFIX = '/_lumina/graph/view.html';
    var p = decodeURIComponent(location.pathname);
    if (p.slice(-VIEW_SUFFIX.length) !== VIEW_SUFFIX) {
      // Opened from somewhere other than the path the engine writes to
      // (a copy, a different mount, a server route): there is no reliable
      // absolute root, so editor links must not guess a wrong one.
      return null;
    }
    var root = p.slice(0, -VIEW_SUFFIX.length);
    // Strip exactly one leading slash, always: a Unix root arrives as
    // "/Users/..." and a Windows drive root arrives as "/C:/...". Either
    // way `vscodeLink` supplies the one separator slash after "file", so an
    // un-stripped root would double it (a real bug this once was: Chrome's
    // `location.pathname` for a Windows drive letter keeps that leading
    // slash exactly like the Unix case does).
    return root.replace(/^\//, '');
  }
  var ROOT = computeRoot();

  // Percent-encode every character of an absolute path except `/` (the
  // path separator) and `:` (a Windows drive letter, or this function's own
  // caller appending ":<line>") -- `#`, `?`, `%`, and spaces would otherwise
  // truncate or corrupt the vscode:// URI. `Array.from` (not `.split('')`)
  // so a surrogate pair (an astral character in a path) is encoded as one
  // unit instead of two lone, invalid surrogates.
  function encodePathForUri(p) {
    return Array.from(String(p)).map(function (ch) {
      return (ch === '/' || ch === ':') ? ch : encodeURIComponent(ch);
    }).join('');
  }
  function vscodeLink(file, line) {
    if (ROOT === null || !file) return null;
    var abs = ROOT + '/' + file;
    return 'vscode://file/' + encodePathForUri(abs) + (line ? ':' + line : '');
  }

  // -------------------------------------------------------------------------
  // Theme (light/dark via prefers-color-scheme -- cached, not re-read every
  // frame; refreshed only when the OS scheme changes).
  // -------------------------------------------------------------------------

  var theme = {};
  function refreshTheme() {
    theme.bg = getCss('--bg');
    theme.link = getCss('--link');
    theme.accent = getCss('--accent');
    theme.error = getCss('--error');
    theme.warning = getCss('--warning');
    theme.info = getCss('--info');
    theme.stale = getCss('--stale');
    if (Graph) Graph.backgroundColor(theme.bg);
    redraw();
  }

  // -------------------------------------------------------------------------
  // Hover highlight (spec: hover highlights the node + neighbors, fades the
  // rest) and search (highlights matches, no fade of links).
  // -------------------------------------------------------------------------

  var hoverNode = null;
  var hoverSet = null;
  var searchMatches = null;

  function nodeColorAccessor(n) {
    var base = colorFor(n);
    if (hoverSet) return hoverSet.has(n.id) ? base : fade(base);
    if (searchMatches) return searchMatches.has(n.id) ? base : fade(base);
    return base;
  }
  function linkIsHoverActive(l) {
    return !!hoverNode && (idOf(l.source) === hoverNode.id || idOf(l.target) === hoverNode.id);
  }
  function linkColorAccessor(l) {
    if (!hoverNode) return theme.link;
    return linkIsHoverActive(l) ? theme.accent : fade(theme.link);
  }
  function linkWidthAccessor(l) {
    return linkIsHoverActive(l) ? 2.2 : 1;
  }

  // -------------------------------------------------------------------------
  // Selection / local-hop graph and the other settings-panel filters.
  // -------------------------------------------------------------------------

  var selectedNodeId = null;
  var visibleSet = new Set(nodes.map(function (n) { return n.id; }));

  function bfs(startId, hops) {
    var visited = new Set([startId]);
    var frontier = [startId];
    for (var d = 0; d < hops && frontier.length; d++) {
      var next = [];
      frontier.forEach(function (id) {
        (neighborsOf[id] || []).forEach(function (nb) {
          if (!visited.has(nb)) { visited.add(nb); next.push(nb); }
        });
      });
      frontier = next;
    }
    return visited;
  }

  function computeVisible() {
    var checked = Object.create(null);
    document.querySelectorAll('#filter-meta-types input[type=checkbox]').forEach(function (cb) {
      checked[cb.value] = cb.checked;
    });
    var statusFilter = document.getElementById('filter-status').value;
    var folderFilter = document.getElementById('filter-folder').value;
    var hideOrphans = document.getElementById('filter-orphans').checked;
    var hopsRaw = document.getElementById('local-hops').value;
    var hops = hopsRaw === '' ? null : Math.max(0, parseInt(hopsRaw, 10) || 0);
    var localSet = hops !== null && selectedNodeId ? bfs(selectedNodeId, hops) : null;

    var visible = new Set();
    nodes.forEach(function (n) {
      if (checked[metaTypeOf(n)] === false) return;
      if (statusFilter && n.status !== statusFilter) return;
      if (folderFilter && nodeFolder(n) !== folderFilter) return;
      if (hideOrphans && !degree[n.id]) return;
      if (localSet && !localSet.has(n.id)) return;
      visible.add(n.id);
    });
    return visible;
  }

  function refreshFilters() {
    visibleSet = computeVisible();
    redraw();
  }

  // -------------------------------------------------------------------------
  // force-graph setup.
  // -------------------------------------------------------------------------

  var Graph = ForceGraph()(canvasEl)
    // force-graph's own hover/click hit-testing runs only inside its
    // per-frame render tick, and `autoPauseRedraw` (default true) stops
    // that tick once the simulation cools down (~15s after load, per its
    // own default `cooldownTime`) -- without this, clicking a node would
    // silently do nothing once a viewer has sat open for a while.
    .autoPauseRedraw(false)
    .graphData({
      nodes: nodes.map(function (n) { return Object.assign({}, n); }),
      links: edges.map(function (e) {
        return { source: e.from, target: e.to, relation: e.relation, evidence: e.evidence };
      }),
    })
    .nodeId('id')
    .nodeRelSize(NODE_REL_SIZE)
    .nodeVal(function (n) { return 1 + (degree[n.id] || 0); })
    .nodeColor(nodeColorAccessor)
    .nodeLabel(function (n) { return escapeHtml(n.id + (n.metaType ? ' (' + n.metaType + ')' : '') + (n.status ? ' [' + n.status + ']' : '')); })
    .nodeVisibility(function (n) { return visibleSet.has(n.id); })
    .nodeCanvasObjectMode(function () { return 'after'; })
    .nodeCanvasObject(function (node, ctx) {
      var sev = nodeWorstSeverity(node);
      var stale = nodeIsStale(node);
      if (!sev && !stale) return;
      ctx.beginPath();
      ctx.arc(node.x, node.y, nodeRadius(node) + 2.5, 0, 2 * Math.PI);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = sev === 'error' ? theme.error
        : sev === 'warning' ? theme.warning
          : sev === 'info' ? theme.info
            : theme.stale;
      ctx.stroke();
    })
    .linkColor(linkColorAccessor)
    .linkWidth(linkWidthAccessor)
    .linkVisibility(function (l) { return visibleSet.has(idOf(l.source)) && visibleSet.has(idOf(l.target)); })
    .linkDirectionalArrowLength(5)
    .linkDirectionalArrowRelPos(1)
    .linkLabel(function (l) { return escapeHtml(l.relation); })
    .linkCanvasObjectMode(function () { return 'after'; })
    .linkCanvasObject(function (link, ctx, globalScale) {
      // Always-on relation labels are unreadable in a dense, zoomed-out
      // graph -- draw them on the canvas only once zoomed in past this
      // threshold (the hover tooltip from `linkLabel` still works at any
      // zoom level).
      if (globalScale < LINK_LABEL_ZOOM_THRESHOLD) return;
      var start = link.source;
      var end = link.target;
      if (!start || typeof start !== 'object' || !end || typeof end !== 'object') return;
      var label = link.relation;
      if (!label) return;

      var fontSize = 12 / globalScale; // constant *screen* size regardless of zoom
      var midX = (start.x + end.x) / 2;
      var midY = (start.y + end.y) / 2;
      var angle = Math.atan2(end.y - start.y, end.x - start.x);
      if (angle > Math.PI / 2 || angle < -Math.PI / 2) angle += Math.PI; // keep text upright

      ctx.save();
      ctx.translate(midX, midY);
      ctx.rotate(angle);
      ctx.font = fontSize + 'px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      var textWidth = ctx.measureText(label).width;
      ctx.fillStyle = theme.bg;
      ctx.fillRect(-textWidth / 2 - 2, -fontSize / 2 - 1, textWidth + 4, fontSize + 2);
      ctx.fillStyle = theme.link;
      ctx.fillText(label, 0, 0);
      ctx.restore();
    })
    .onNodeHover(function (node) {
      hoverNode = node || null;
      hoverSet = hoverNode ? new Set([hoverNode.id].concat(neighborsOf[hoverNode.id] || [])) : null;
      redraw();
    })
    .onNodeClick(function (node) {
      selectedNodeId = node.id;
      refreshFilters();
      showDetail(node);
    })
    .onBackgroundClick(function () {
      document.getElementById('detail').hidden = true;
    });

  function redraw() {
    Graph
      .nodeColor(Graph.nodeColor())
      .linkColor(Graph.linkColor())
      .linkWidth(Graph.linkWidth())
      .nodeVisibility(Graph.nodeVisibility())
      .linkVisibility(Graph.linkVisibility());
  }

  refreshTheme();
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', refreshTheme);

  window.addEventListener('resize', function () {
    Graph.width(canvasEl.clientWidth).height(canvasEl.clientHeight);
  });

  // -------------------------------------------------------------------------
  // Force sliders (center, repel/charge, link strength, link distance).
  // -------------------------------------------------------------------------

  function applyForces() {
    var center = parseFloat(document.getElementById('force-center').value);
    var charge = parseFloat(document.getElementById('force-charge').value);
    var linkStrength = parseFloat(document.getElementById('force-link-strength').value);
    var linkDistance = parseFloat(document.getElementById('force-link-distance').value);
    var centerForce = Graph.d3Force('center');
    if (centerForce && centerForce.strength) centerForce.strength(center);
    var chargeForce = Graph.d3Force('charge');
    if (chargeForce && chargeForce.strength) chargeForce.strength(charge);
    var linkForce = Graph.d3Force('link');
    if (linkForce) {
      if (linkForce.strength) linkForce.strength(linkStrength);
      if (linkForce.distance) linkForce.distance(linkDistance);
    }
    Graph.d3ReheatSimulation();
  }
  ['force-center', 'force-charge', 'force-link-strength', 'force-link-distance'].forEach(function (id) {
    document.getElementById(id).addEventListener('input', applyForces);
  });
  applyForces();

  // -------------------------------------------------------------------------
  // Settings panel: meta-type / status / folder / orphan filters.
  // -------------------------------------------------------------------------

  function buildMetaTypeFilters() {
    var present = new Set(nodes.map(metaTypeOf));
    var container = document.getElementById('filter-meta-types');
    META_TYPES.concat(['Unknown']).forEach(function (mt) {
      if (!present.has(mt)) return;
      var label = document.createElement('label');
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = true;
      cb.value = mt;
      cb.addEventListener('change', refreshFilters);
      var sw = document.createElement('span');
      sw.className = 'legend-swatch';
      sw.style.background = PALETTE[mt] || PALETTE.Unknown;
      label.appendChild(cb);
      label.appendChild(sw);
      label.appendChild(document.createTextNode(mt));
      container.appendChild(label);
    });
  }

  function buildSelectOptions(selectId, values) {
    var select = document.getElementById(selectId);
    values.forEach(function (v) {
      var opt = document.createElement('option');
      opt.value = v;
      opt.textContent = v;
      select.appendChild(opt);
    });
    select.addEventListener('change', refreshFilters);
  }

  function buildLegend() {
    var present = new Set(nodes.map(metaTypeOf));
    var legend = document.getElementById('legend');
    META_TYPES.concat(['Unknown']).forEach(function (mt) {
      if (!present.has(mt)) return;
      var row = document.createElement('div');
      row.className = 'legend-row';
      var sw = document.createElement('span');
      sw.className = 'legend-swatch';
      sw.style.background = PALETTE[mt] || PALETTE.Unknown;
      row.appendChild(sw);
      row.appendChild(document.createTextNode(mt));
      legend.appendChild(row);
    });

    var divider = document.createElement('div');
    divider.className = 'legend-divider';
    legend.appendChild(divider);
    [
      ['Error finding', theme.error],
      ['Warning finding', theme.warning],
      ['Info finding', theme.info],
      ['Stale doc', theme.stale],
    ].forEach(function (entry) {
      var row = document.createElement('div');
      row.className = 'legend-row';
      var ring = document.createElement('span');
      ring.className = 'legend-ring';
      ring.style.borderColor = entry[1];
      row.appendChild(ring);
      row.appendChild(document.createTextNode(entry[0]));
      legend.appendChild(row);
    });
  }

  // -------------------------------------------------------------------------
  // Summary panel: totals `nodeFindings`/`nodeIsStale` can't show (a finding
  // whose `file` matches no `doc:` node, e.g. P16 on
  // `_lumina/config/project.yaml`, is never attached to any node), plus the
  // overall error/warning/info and stale/changed counts.
  // -------------------------------------------------------------------------

  function buildSummary() {
    var docFiles = new Set(nodes.filter(function (n) { return n.kind === 'doc'; }).map(nodeFile));
    var counts = { error: 0, warning: 0, info: 0 };
    var orphanFindings = [];
    findings.forEach(function (f) {
      if (Object.prototype.hasOwnProperty.call(counts, f.severity)) counts[f.severity] += 1;
      if (!docFiles.has(f.file)) orphanFindings.push(f);
    });
    var fs = freshness.summary || {};

    var el = document.getElementById('summary');
    addRow(el, 'Findings', counts.error + ' error, ' + counts.warning + ' warning, ' + counts.info + ' info');
    addRow(el, 'Freshness', (fs.stale || 0) + ' stale, ' + (fs.changed || 0) + ' changed');

    if (orphanFindings.length) {
      var h = document.createElement('div');
      h.className = 'row label';
      h.textContent = 'Findings with no node';
      el.appendChild(h);
      var ul = document.createElement('ul');
      orphanFindings.forEach(function (f) {
        var li = document.createElement('li');
        li.className = 'finding-' + f.severity;
        li.textContent = '[' + f.id + '] ' + f.message + ' (' + f.file + ':' + f.line + ')';
        ul.appendChild(li);
      });
      el.appendChild(ul);
    }
  }

  buildMetaTypeFilters();
  buildSelectOptions('filter-status', Array.from(new Set(nodes.map(function (n) { return n.status; }).filter(Boolean))).sort());
  buildSelectOptions('filter-folder', Array.from(new Set(nodes.map(nodeFolder))).sort());
  buildLegend();
  buildSummary();
  document.getElementById('filter-orphans').addEventListener('change', refreshFilters);
  document.getElementById('local-hops').addEventListener('input', refreshFilters);
  document.getElementById('local-clear').addEventListener('click', function () {
    document.getElementById('local-hops').value = '';
    selectedNodeId = null;
    refreshFilters();
  });
  refreshFilters();

  // -------------------------------------------------------------------------
  // Search: highlights matches (id or source quote substring) and pans to
  // them; does not hide non-matches (that is the settings-panel filters' job).
  // -------------------------------------------------------------------------

  document.getElementById('search-input').addEventListener('input', function (e) {
    var q = e.target.value.trim().toLowerCase();
    if (!q) {
      searchMatches = null;
    } else {
      // Restricted to `visibleSet`: a match hidden by the settings-panel
      // filters must not be highlighted or zoomed to -- the user can't see
      // it either way, and `zoomToFit` would otherwise frame empty space.
      searchMatches = new Set(nodes.filter(function (n) {
        if (!visibleSet.has(n.id)) return false;
        return n.id.toLowerCase().indexOf(q) !== -1
          || (n.at && n.at.quote && n.at.quote.toLowerCase().indexOf(q) !== -1);
      }).map(function (n) { return n.id; }));
      if (searchMatches.size) Graph.zoomToFit(400, 60, function (n) { return searchMatches.has(n.id); });
    }
    redraw();
  });

  // -------------------------------------------------------------------------
  // Detail panel.
  // -------------------------------------------------------------------------

  function addRow(body, label, value) {
    var row = document.createElement('div');
    row.className = 'row';
    var lbl = document.createElement('span');
    lbl.className = 'label';
    lbl.textContent = label + ':';
    row.appendChild(lbl);
    row.appendChild(document.createTextNode(' ' + value));
    body.appendChild(row);
  }

  function addEvidenceList(parent, evidence) {
    if (!evidence || !evidence.length) return;
    var ul = document.createElement('ul');
    ul.className = 'evidence-list';
    evidence.forEach(function (ev) {
      var li = document.createElement('li');
      li.appendChild(document.createTextNode('“' + ev.quote + '” — '));
      var link = vscodeLink(ev.file, ev.line);
      if (link) {
        var a = document.createElement('a');
        a.href = link;
        a.textContent = ev.file + ':' + ev.line;
        li.appendChild(a);
      } else {
        li.appendChild(document.createTextNode(ev.file + ':' + ev.line));
      }
      ul.appendChild(li);
    });
    parent.appendChild(ul);
  }

  function addEdgeList(body, label, list, otherIdOf) {
    if (!list.length) return;
    var h = document.createElement('div');
    h.className = 'row label';
    h.textContent = label;
    body.appendChild(h);
    var ul = document.createElement('ul');
    list.forEach(function (e) {
      var li = document.createElement('li');
      li.appendChild(document.createTextNode(e.relation + ' → ' + otherIdOf(e)));
      addEvidenceList(li, e.evidence);
      ul.appendChild(li);
    });
    body.appendChild(ul);
  }

  function showDetail(node) {
    var body = document.getElementById('detail-body');
    body.textContent = '';

    var h3 = document.createElement('h3');
    h3.textContent = node.id;
    body.appendChild(h3);

    addRow(body, 'Kind', node.kind);
    if (node.metaType) addRow(body, 'Meta-type', node.metaType);
    if (node.type) addRow(body, 'Type', node.type);
    if (node.status) addRow(body, 'Status', node.status);
    if (nodeIsStale(node)) addRow(body, 'Freshness', 'stale');

    var file = nodeFile(node);
    if (file) addRow(body, 'Source', file + ':' + (node.at.line || 1));
    if (node.at && node.at.quote) {
      var bq = document.createElement('blockquote');
      bq.textContent = node.at.quote;
      body.appendChild(bq);
    }
    var link = file ? vscodeLink(file, node.at && node.at.line) : null;
    if (link) {
      var row = document.createElement('div');
      row.className = 'row';
      var a = document.createElement('a');
      a.href = link;
      a.textContent = 'Open in editor';
      row.appendChild(a);
      body.appendChild(row);
    }

    var fs = nodeFindings(node);
    if (fs.length) {
      var fh = document.createElement('div');
      fh.className = 'row label';
      fh.textContent = 'Findings';
      body.appendChild(fh);
      var ul = document.createElement('ul');
      fs.forEach(function (f) {
        var li = document.createElement('li');
        li.className = 'finding-' + f.severity;
        li.textContent = '[' + f.id + '] ' + f.message + ' (' + f.file + ':' + f.line + ')';
        ul.appendChild(li);
      });
      body.appendChild(ul);
    }

    addEdgeList(body, 'Outgoing', edges.filter(function (e) { return e.from === node.id; }), function (e) { return e.to; });
    addEdgeList(body, 'Incoming', edges.filter(function (e) { return e.to === node.id; }), function (e) { return e.from; });

    document.getElementById('detail').hidden = false;
  }

  document.getElementById('detail-close').addEventListener('click', function () {
    document.getElementById('detail').hidden = true;
  });
})();
