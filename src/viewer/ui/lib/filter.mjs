import { foldWords } from './search.mjs';
import { legendOf } from './graph-model.mjs';
import { parseFilter, resolveValues } from './query.mjs';

const CONFIDENCES = ['high', 'medium', 'low'];

// Bucket names are what a reader types after "type:", "rel:", "conf:".
export function nodeBucket(node) {
  if (node.kind === 'url' || node.kind === 'missing') return node.kind;
  return node.type === null ? 'other' : node.type;
}

export function relationBucket(type, relationTypes) {
  return relationTypes.some((r) => r.name === type) ? type : 'other';
}

export function confidenceBucket(confidence) {
  return CONFIDENCES.includes(confidence) ? confidence : 'none';
}

// Offers only buckets the loaded wiki holds, so a suggestion never leads to an empty graph.
export function vocabulary(model, wiki) {
  const rels = new Set(model.links.map((l) => relationBucket(l.type, wiki.schema.relationTypes)));
  const confs = new Set(model.links.map((l) => confidenceBucket(l.confidence)));
  return {
    type: legendOf(model, wiki.schema.entityTypes).map((e) => e.key.replace(/^type:/, '')),
    rel: [...wiki.schema.relationTypes.map((r) => r.name), 'other'].filter((r) => rels.has(r)),
    conf: [...CONFIDENCES, 'none'].filter((c) => confs.has(c)),
  };
}

// One decision point for every pane: which nodes and links the current filter leaves on screen.
export function visibleSets(model, wiki, settings, openId) {
  const q = parseFilter(settings.filter ?? '');
  const showOrphans = settings.showOrphans !== false;
  const hops = settings.hops > 0 ? settings.hops : null;
  const open = model.nodes.some((n) => n.id === openId) ? openId : null;
  // Each typed value is resolved once against the buckets the wiki holds, so exact names beat prefixes.
  const vocab = vocabulary(model, wiki);
  const inc = {};
  const exc = {};
  for (const k of ['type', 'rel', 'conf']) {
    inc[k] = resolveValues(q.include[k], vocab[k]);
    exc[k] = resolveValues(q.exclude[k], vocab[k]);
  }
  const allows = (kind, bucket) => (q.include[kind].length === 0 || inc[kind].has(bucket)) && !exc[kind].has(bucket);
  const words = q.words.map(foldWords).filter(Boolean);

  const passed = new Set(model.nodes.filter((n) => {
    const slug = foldWords(n.id.split('/').pop());
    const title = foldWords(n.title ?? '');
    return allows('type', nodeBucket(n)) && words.every((w) => title.includes(w) || slug.includes(w));
  }).map((n) => n.id));
  const endOk = (id) => passed.has(id) || id === open;
  const passing = model.links.filter((l) => allows('rel', relationBucket(l.type, wiki.schema.relationTypes))
    && allows('conf', confidenceBucket(l.confidence)) && endOk(l.source) && endOk(l.target));

  let ids = new Set(passed);
  if (!showOrphans) {
    const touched = new Set(passing.flatMap((l) => [l.source, l.target]));
    ids = new Set([...ids].filter((id) => touched.has(id)));
  }
  if (hops !== null && open !== null) {
    const adj = new Map();
    for (const l of passing) {
      for (const [a, b] of [[l.source, l.target], [l.target, l.source]]) {
        if (!adj.has(a)) adj.set(a, []);
        adj.get(a).push(b);
      }
    }
    const seen = new Set([open]);
    let frontier = [open];
    for (let h = 0; h < hops; h++) {
      frontier = frontier.flatMap((id) => adj.get(id) || []).filter((id) => !seen.has(id) && seen.add(id));
    }
    ids = new Set([...ids].filter((id) => seen.has(id)));
  }
  const matchCount = ids.size;
  if (open !== null) ids.add(open);

  const kept = passing.filter((l) => ids.has(l.source) && ids.has(l.target));
  const neighbors = new Map([...ids].map((id) => [id, new Set()]));
  for (const l of kept) {
    if (l.source === l.target) continue;
    neighbors.get(l.source).add(l.target);
    neighbors.get(l.target).add(l.source);
  }
  return { nodeIds: ids, linkKeys: new Set(kept.map((l) => l.key)), neighbors, open, matchCount };
}

// A selected relation is shown only while the filter leaves it on screen.
export function selectedLink(model, visible, key) {
  if (key === null || key === undefined || !visible.linkKeys.has(key)) return null;
  return model.links.find((l) => l.key === key) ?? null;
}
