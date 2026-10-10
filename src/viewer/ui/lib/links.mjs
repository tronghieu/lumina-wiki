// Wiki text is untrusted. Only these schemes may leave the viewer.
const EXTERNAL = /^(?:https?:\/\/|mailto:)/i;
const WEB = /^https?:\/\//i;

export function externalHref(address) {
  return typeof address === 'string' && EXTERNAL.test(address) ? address : null;
}

export function urlNodeHref(nodeId) {
  if (typeof nodeId !== 'string' || !nodeId.startsWith('url:')) return null;
  const address = nodeId.slice(4);
  return WEB.test(address) ? externalHref(address) : null;
}
