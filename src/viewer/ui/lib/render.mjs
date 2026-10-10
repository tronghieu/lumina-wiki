// The only code that turns untrusted page text into HTML. Raw HTML is off, no image element is emitted,
// and only http://, https://, and mailto: addresses leave. Comments are dropped by parser rules, so code keeps its own.
import MarkdownIt from 'markdown-it';
import { idToHash } from './hash.mjs';
import { escapeHtml } from './escape.mjs';
import { externalHref } from './links.mjs';

const WEB = /^https?:\/\//i;

// One cached scan per source string. A repeat opener never rescans, so hostile input stays linear.
function nextClose(env, src, from) {
  const c = env.close;
  if (c && c.src === src && from >= c.from && (c.at === -1 || from <= c.at)) return c.at;
  const at = src.indexOf('-->', from);
  env.close = { src, from, at };
  return at;
}

function commentRules(md) {
  // A comment that ends its line is dropped as a block, even while a paragraph or quote is open.
  md.block.ruler.before('paragraph', 'comment', (state, start, end, silent) => {
    if (state.sCount[start] - state.blkIndent > 3) return false;
    const pos = state.bMarks[start] + state.tShift[start];
    if (!state.src.startsWith('<!--', pos)) return false;
    const at = nextClose(state.env, state.src, pos + 4);
    if (at < 0 || at + 3 > state.eMarks[end - 1]) return false;
    let line = start;
    while (state.eMarks[line] < at + 3) line++;
    if (state.src.slice(at + 3, state.eMarks[line]).trim()) return false;
    if (!silent) state.line = line + 1;
    return true;
  }, { alt: ['paragraph', 'reference', 'blockquote'] });
  // After backticks, so a code span keeps its comment. Without a close, the opener prints as escaped text.
  md.inline.ruler.after('backticks', 'comment', (state, silent) => {
    if (!state.src.startsWith('<!--', state.pos)) return false;
    const at = nextClose(state.env, state.src, state.pos + 4);
    if (at < 0 || at + 3 > state.posMax) return false;
    state.pos = at + 3;
    return true;
  });
}

// Refuses cheaply what the pattern would refuse slowly: repeated `[[` with no usable close made it quadratic.
function wikilinkRule(md, re, known) {
  md.inline.ruler.before('link', 'wikilink', (state, silent) => {
    const { src, pos, env } = state;
    if (src.charCodeAt(pos) !== 0x5b || src.charCodeAt(pos + 1) !== 0x5b) return false;
    let c = env.wl;
    if (!c || c.src !== src) c = env.wl = { src, close: 0, pipe: 0 };
    if (c.close !== -1 && c.close < pos + 2) c.close = src.indexOf(']', pos + 2);
    if (c.pipe !== -1 && c.pipe < pos + 2) c.pipe = src.indexOf('|', pos + 2);
    const { close, pipe } = c;
    if (close < 0 || src[close + 1] !== ']' || close === pos + 2 || src[pos + 2] === '|' || pipe === close - 1) return false;
    re.lastIndex = pos;
    const m = re.exec(src);
    const target = m && typeof m[1] === 'string' ? m[1].trim() : '';
    if (!target) return false;
    if (!silent) {
      const bar = m[0].indexOf('|');
      const alias = bar < 0 ? '' : m[0].slice(bar + 1, -2).trim();
      const token = state.push('wikilink', '', 0);
      token.meta = {
        text: alias || target,
        id: Object.hasOwn(known, target) && typeof known[target] === 'string' ? known[target] : null,
      };
    }
    state.pos += m[0].length;
    return true;
  });
  md.renderer.rules.wikilink = (tokens, i) => {
    const { text, id } = tokens[i].meta;
    return id === null
      ? `<span class="wikilink is-broken">${escapeHtml(text)}</span>`
      : `<a class="wikilink" href="${escapeHtml(idToHash(id))}">${escapeHtml(text)}</a>`;
  };
}

export function renderPage(body, links, wikilinkPattern) {
  const md = new MarkdownIt({ html: false, linkify: false });
  commentRules(md);
  try {
    wikilinkRule(md, new RegExp(wikilinkPattern, 'y'), links ?? {});
  } catch {
    // A bad pattern from the server must not break the page: wikilinks print as text.
  }

  // The alt source, escaped, so no image element or request exists and a wikilink inside keeps its words.
  md.renderer.rules.image = (tokens, i) => escapeHtml(tokens[i].content);

  md.renderer.rules.link_open = (tokens, i, options, env) => {
    const href = tokens[i].attrGet('href') || '';
    const external = externalHref(href) !== null;
    (env.linkStack ||= []).push(external);
    if (!external) return '<span class="inert-link">';
    const title = tokens[i].attrGet('title');
    const t = title ? ` title="${escapeHtml(title)}"` : '';
    // A new tab for mailto: would leave an empty tab behind.
    const web = WEB.test(href) ? ' class="external" target="_blank" rel="noopener noreferrer"' : '';
    return `<a href="${escapeHtml(href)}"${t}${web}>`;
  };
  md.renderer.rules.link_close = (tokens, i, options, env) => (env.linkStack.pop() ? '</a>' : '</span>');

  return md.render(String(body ?? ''), {});
}
