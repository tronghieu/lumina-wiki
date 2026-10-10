import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { renderPage } from './render.mjs';
import { idToHash } from './hash.mjs';
import { externalHref } from './links.mjs';

const read = (f) => JSON.parse(fs.readFileSync(new URL(`../../test-fixtures/contract/expected/${f}`, import.meta.url), 'utf8'));
const pages = read('pages.json');
const pattern = read('wiki.json').schema.wikilinkPattern;
const render = (body, links = {}) => renderPage(body, links, pattern);

test('raw html is escaped', () => {
  for (const s of [
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    '<a href="javascript:alert(1)">x</a>',
    'hi <b onclick=alert(1)>x</b>',
  ]) {
    const out = render(s);
    assert.doesNotMatch(out, /<(script|img|b)\b/i);
    assert.doesNotMatch(out, /<a href="javascript/i);
    assert.match(out, /&lt;/);
  }
  assert.match(render('<script>alert(1)</script>'), /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test('non-external addresses give no href but keep the text', () => {
  for (const a of [
    'javascript:alert(1)', 'JAVASCRIPT:alert(1)', 'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)', 'file:///etc/passwd', 'ms-msdt:/id', 'obsidian://open?vault=x',
    '//evil.example/x', 'other.md', '#top', '/api/wiki',
  ]) {
    const out = render(`[x](${a})`);
    assert.doesNotMatch(out, /href=/, a);
    assert.doesNotMatch(out, /<script/i, a);
    assert.match(out, /x/, a);
  }
  assert.match(render('[x](other.md)'), /<span class="inert-link">x<\/span>/);
});

test('external links', () => {
  const out = render('[x](https://example.org/a?b=1&c=2 "T")');
  assert.match(out, /href="https:\/\/example\.org\/a\?b=1&amp;c=2"/);
  assert.match(out, /target="_blank"/);
  assert.match(out, /rel="noopener noreferrer"/);
  assert.match(out, /title="T"/);
  assert.match(render('[m](mailto:a@b.c)'), /<a href="mailto:a@b\.c"/);
  assert.match(render('[m](HTTP://example.org)'), /<a href=/);
  const auto = render('<https://example.org>');
  assert.match(auto, /<a href="https:\/\/example\.org"/);
  assert.match(auto, /target="_blank"/);
  assert.match(auto, /rel="noopener noreferrer"/);
  assert.doesNotMatch(render('see https://example.org now'), /<a /);
});

test('single-colon and padded schemes never become links', () => {
  assert.doesNotMatch(render('[x](http:foo)'), /href=/);
  assert.doesNotMatch(render('[x](https:foo)'), /href=/);
  assert.match(render('[x](HTTPS://example.org)'), /<a href=/);
  for (const m of render('[x]( https://example.org)').matchAll(/href="([^"]*)"/g)) {
    assert.match(m[1], /^(?:https?:\/\/|mailto:)/i);
  }
});

test('every emitted href is a wikilink or an allowed address', () => {
  const addrs = [
    'javascript:alert(1)', 'JAVASCRIPT:alert(1)', 'data:text/html,x', 'vbscript:msgbox(1)',
    'file:///etc/passwd', 'ms-msdt:/id', 'obsidian://open?vault=x', '//evil.example/x',
    'other.md', '#top', '/api/wiki', 'http:foo', 'https:foo', ' https://example.org',
    'https://example.org/a?b=1&c=2', 'HTTP://example.org', 'mailto:a@b.c',
  ];
  for (const a of addrs) {
    const out = render(`[x](${a}) [[known]]`, { known: 'concepts/known' });
    for (const m of out.matchAll(/href="([^"]*)"/g)) {
      const href = m[1].replaceAll('&amp;', '&');
      assert.ok(href.startsWith('#/') || externalHref(href) !== null, `${a} -> ${href}`);
    }
  }
});

test('images show alt text only', () => {
  const out = render('![diagram](http://evil.example/p.png "t")');
  assert.match(out, /diagram/);
  assert.doesNotMatch(out, /<img|src=|evil\.example/);
  const inLink = render('[![alt text](http://evil.example/p.png)](https://example.org)');
  assert.match(inLink, /<a [^>]*>alt text<\/a>/);
  assert.doesNotMatch(inLink, /<img|evil/);
  assert.equal(render('![](http://evil.example/p.png)').replace(/<\/?p>|\s/g, ''), '');
});

test('comments are removed outside code only', () => {
  assert.doesNotMatch(render('a <!-- lumina:index --> b'), /lumina|&lt;!--/);
  assert.match(render('a <!-- lumina:index --> b'), /a\s+b/);
  assert.doesNotMatch(render('x\n\n<!--\nline one\nline two\n-->\n\ny'), /line one|--/);
  assert.match(render('```\n<!-- keep -->\n```'), /&lt;!-- keep --&gt;/);
  assert.match(render('~~~\n<!-- keep -->\n~~~'), /&lt;!-- keep --&gt;/);
  assert.match(render('```\nopen\n<!-- keep -->'), /&lt;!-- keep --&gt;/);
});

test('comment edge cases follow the parser', () => {
  const { body, links } = pages.index;
  const out = render(body, links);
  assert.doesNotMatch(out, /&lt;!--/);
  const strings = Object.values(links).filter((v) => typeof v === 'string').length;
  assert.equal((out.match(/class="wikilink"/g) || []).length, strings);
  const two = render('one <!-- a --> two <!-- b --> three');
  assert.match(two, /one\s+two\s+three/);
  assert.doesNotMatch(two, /&lt;!--/);
  assert.doesNotMatch(render('```\ncode\n```\n<!-- gone -->\nafter'), /gone/);
  assert.match(render('use `<!-- keep -->` here'), /<code>&lt;!-- keep --&gt;<\/code>/);
  assert.match(render('    <!-- keep -->'), /<pre><code>&lt;!-- keep --&gt;/);
  assert.match(render('> ```\n> <!-- keep -->\n> ```'), /&lt;!-- keep --&gt;/);
  assert.match(render('- item\n\n  ```\n  <!-- keep -->\n  ```'), /&lt;!-- keep --&gt;/);
  const wrap = render('<!--\n```\nsecret\n```\n-->\n\nafter');
  assert.doesNotMatch(wrap, /secret|<pre|&lt;!--/);
  assert.match(wrap, /after/);
  const open = render('<!-- never closed\n\nstill here');
  assert.match(open, /&lt;!-- never closed/);
  assert.match(open, /still here/);
});

test('images keep escaped alt source', () => {
  const out = render('![<img src=x onerror=alert(1)>](x.png)');
  assert.doesNotMatch(out, /<img/);
  assert.match(out, /&lt;img/);
  assert.match(render('![see [[lora]] here](p.png)', { lora: 'sources/lora' }), /see \[\[lora\]\] here/);
});

test('link title cannot break out of its attribute', () => {
  const out = render('[x](https://example.org "\\"><img src=x onerror=alert(1)>")');
  assert.doesNotMatch(out, /<img/);
  assert.ok(out.includes('title="&quot;&gt;&lt;img'));
});

test('mail and external links', () => {
  const m = render('[m](mailto:a@b.c)');
  assert.ok(m.includes('href="mailto:a@b.c"'));
  assert.doesNotMatch(m, /target=/);
  const x = render('[x](https://example.org)');
  assert.match(x, /class="external"/);
  assert.match(x, /target="_blank"/);
  assert.match(x, /rel="noopener noreferrer"/);
});

test('wikilink edge cases print as text', () => {
  const l = { lora: 'sources/lora' };
  const a = render('[[|x]] and [[lora]] end', l);
  assert.ok(a.includes('[[|x]] and <a class="wikilink"'));
  assert.equal((a.match(/class="wikilink"/g) || []).length, 1);
  for (const s of ['[[ ]]', '[[a|]]']) {
    const out = render(s, l);
    assert.doesNotMatch(out, /wikilink/, s);
    assert.ok(out.includes(s), s);
  }
  const t = render('[[[lora]]]', l);
  for (const m of t.matchAll(/class="wikilink" href="([^"]*)"/g)) assert.equal(m[1], idToHash('sources/lora'));
});

test('a bad wikilink pattern prints wikilinks as text', () => {
  for (const p of [undefined, '', '(', '\\[\\[x\\]\\]']) {
    const out = renderPage('[[lora]] text', { lora: 'sources/lora' }, p);
    assert.equal(typeof out, 'string');
    assert.match(out, /text/);
  }
});

test('hostile input finishes quickly', () => {
  const cases = {
    brackets: '['.repeat(200000),
    openPipes: '[[a|'.repeat(50000),
    openThenLoneClose: '[[a'.repeat(33000) + ']',
    emptyTargets: '[[|'.repeat(33000) + ']]',
    openComments: '<!--'.repeat(50000),
    closedComments: '<!-- x --> '.repeat(18000),
  };
  for (const [name, body] of Object.entries(cases)) {
    const t = performance.now();
    render(body, {});
    const ms = performance.now() - t;
    console.log(`  ${name}: ${ms.toFixed(0)} ms`);
    assert.ok(ms < 1500, `${name} took ${ms} ms`);
  }
});

test('output shape stays inside the allow-list', () => {
  const l = { lora: 'sources/lora', 'a"b': 'x/y' };
  const corpus = [
    '<script>alert(1)</script>', '<img src=x onerror=alert(1)>', '<a href="javascript:alert(1)">x</a>',
    'hi <b onclick=alert(1)>x</b>', '[x](javascript:alert(1))', '[x](JAVASCRIPT:alert(1))',
    '[x](data:text/html,<script>alert(1)</script>)', '[x](vbscript:msgbox(1))', '[x](file:///etc/passwd)',
    '[x](//evil.example/x)', '[x](other.md)', '[x](#top)', '[x](http:foo)', '[x]( https://example.org)',
    '[x](https://example.org/a?b=1&c=2 "T")', '[m](mailto:a@b.c)', '<https://example.org>', '<mailto:a@b.c>',
    '[r]\n\n[r]: javascript:alert(1)', '[r][]\n\n[r]: javascript:alert(1)', '[x](&#x6A;avascript:alert(1))',
    '[x](&#106;avascript&colon;alert(1))', '![diagram](http://evil.example/p.png "t")',
    '![img][r]\n\n[r]: http://evil.example/p.png', '[![alt](http://evil.example/p.png)](https://example.org)',
    '```"><img src=x onerror=alert(1)>\ncode\n```', "```a'b\"c<d>\nx\n```", '~~~ onclick=alert(1)\nx\n~~~',
    '***a **b** c***', '_a *b ~~c~~ d* e_', '| a | b |\n|:--|--:|\n| 1 | 2 |\n| <i>x</i> | `y` |',
    '# H1\n## H2\n### H3\n#### H4\n##### H5\n###### H6', '1. a\n2. b\n\n3) c', '5. five\n6. six', '- [ ] a\n- b\n  - c',
    '> quote\n> > deeper', '---\n\n***', 'line  \nbreak\\\nhard', '[[lora]]', '[[lora|"><img src=x onerror=1>]]',
    '[[<b>x</b>]]', '[[a"b]]', '[[unknown|<script>]]', '`[[lora]]` and <!-- c --> done', '<!-- c -->\n\ntext',
    '[x](https://example.org "\\"><img src=x onerror=alert(1)>")', '[x](<https://exa mple.org>)', '*[HTML]: Hyper Text',
  ];
  assert.ok(corpus.length >= 40);
  const tags = new Set('p a span em strong s code pre blockquote ul ol li h1 h2 h3 h4 h5 h6 hr br table thead tbody tr th td'.split(' '));
  const ok = {
    a: new Set(['class', 'href', 'rel', 'target', 'title']), span: new Set(['class']), code: new Set(['class']),
    ol: new Set(['start']), th: new Set(['style']), td: new Set(['style']),
  };
  for (const body of corpus) {
    const out = render(body, l);
    for (const [, name, attrs] of out.matchAll(/<([a-zA-Z][a-zA-Z0-9]*)((?:\s+[^\s=>]+(?:="[^"]*")?)*)\s*\/?>/g)) {
      assert.ok(tags.has(name), `${name} in ${body}`);
      for (const [, k, v = ''] of attrs.matchAll(/\s+([^\s=>]+)(?:="([^"]*)")?/g)) {
        assert.ok(ok[name]?.has(k), `${name}.${k} in ${body}`);
        assert.ok(!k.startsWith('on'));
        if (k === 'style') assert.match(v, /^text-align:(left|right|center)$/);
        if (k === 'href') {
          const h = v.replaceAll('&amp;', '&');
          assert.ok(h.startsWith('#/') || externalHref(h) !== null, `${h} in ${body}`);
        }
      }
    }
    assert.equal((out.match(/</g) || []).length, (out.match(/<[a-zA-Z/][^<>]*>/g) || []).length, `stray < in ${body}`);
  }
});

test('fixture page wikilinks', () => {
  const { body, links } = pages['sources/lora-2'];
  const out = render(body, links);
  for (const [key, value] of Object.entries(links)) {
    if (typeof value === 'string') {
      assert.ok(out.includes(`<a class="wikilink" href="${idToHash(value)}">`), key);
    }
  }
  assert.ok(out.includes('<span class="wikilink is-broken">nope</span>'));
  assert.ok(out.includes('<span class="wikilink is-broken">https://a.b</span>'));
  assert.doesNotMatch(out, /\[\[/);
  assert.equal((out.match(/is-broken/g) || []).length, 2);
});

test('wikilink details', () => {
  const l = { lora: 'sources/lora', 'sources/lora': 'sources/lora' };
  assert.match(render('[[sources/lora|LoRA paper]]', l), />LoRA paper<\/a>/);
  assert.match(render('[[ lora ]]', l), /<a class="wikilink" href="#\/sources\/lora">lora<\/a>/);
  assert.match(render('[[missing]]', l), /is-broken/);
  assert.match(render('[[a]]', null), /is-broken/);
  assert.match(render('[[a]]', undefined), /is-broken/);
  const bare = Object.create(null);
  bare.a = 'x/y';
  assert.match(render('[[a]]', bare), /href="#\/x\/y"/);
  assert.match(render('[[constructor]] [[__proto__]] [[toString]]', {}), /is-broken.*is-broken.*is-broken/);
  assert.ok(render('[[a]]', { a: 'sources/a b#c' }).includes(`href="${idToHash('sources/a b#c')}"`));
  const x = render('[[<b>x</b>]]', {});
  assert.doesNotMatch(x, /<b>/);
  assert.match(x, /&lt;b&gt;x&lt;\/b&gt;/);
  const y = render('[[lora|"><script>alert(1)</script>]]', l);
  assert.doesNotMatch(y, /<script/);
  assert.match(y, /&quot;&gt;&lt;script&gt;/);
  assert.match(render('`[[lora]]`', l), /<code>\[\[lora\]\]<\/code>/);
  assert.match(render('```\n[[lora]]\n```', l), /<code>\[\[lora\]\]\n<\/code>/);
  assert.equal((render('[[a]] and [[b]]', { a: 'a', b: 'b' }).match(/class="wikilink"/g) || []).length, 2);
});

test('structure', () => {
  assert.match(render('| a | b |\n|---|---|\n| 1 | 2 |'), /<table>/);
  assert.match(render('- one\n- two'), /<ul>/);
  assert.match(render('> quote'), /<blockquote>/);
  assert.match(render('# Title'), /<h1>/);
  assert.match(render('*em* **strong**'), /<em>em<\/em> <strong>strong<\/strong>/);
  assert.match(render('```\ncode\n```'), /<pre><code>code\n<\/code><\/pre>/);
  assert.equal(typeof render(''), 'string');
  assert.equal(typeof render('  \n\t\n'), 'string');
});

test('purity', () => {
  const body = pages['sources/lora-2'].body;
  const a = { lora: 'sources/lora' };
  assert.equal(render(body, a), render(body, a));
  assert.notEqual(render('[[lora]]', { lora: 'x/one' }), render('[[lora]]', { lora: 'x/two' }));
});
