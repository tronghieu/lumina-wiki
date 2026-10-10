---
title: 'Wiki view story 5: reader pane'
type: 'feature'
created: '2026-10-10'
status: 'done'
route: 'dispatch'
review_loop_iteration: 1
context:
  - '{project-root}/docs/planning-artifacts/architecture/architecture-wiki-view-2026-10-10/ARCHITECTURE-SPINE.md'
  - '{project-root}/docs/specs/spec-wiki-view/viewer-ui.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A reader can pick a page in the graph or the tree, but cannot read it. Page text comes from ingested outside sources, so it must be shown without ever running as markup or script.

**Approach:** Add the reader pane between graph and tree: a header from frontmatter, the body rendered by one pure function on `markdown-it`, and the page's relations as links. Links inside the reader are plain hash links, so Back works with no code. SPEC CAP-8, CAP-9, CAP-10, CAP-11; spine AD-12, AD-14, AD-15.

## Boundaries & Constraints

**Always:**
- `renderPage(body, links, wikilinkPattern)` in `ui/lib/render.mjs` is the only code that turns page text into HTML. Its output is injected at exactly one element in `ReaderPane.jsx`; nothing else in the client sets inner HTML.
- `markdown-it` runs with `html: false` and `linkify: false`. No `<img>` is ever emitted; an image shows its alt text.
- A link leaves the viewer only when its address starts with `http://`, `https://`, or `mailto:`. A web link gets `target="_blank"`, `rel="noopener noreferrer"`, and a visible mark that it leaves the viewer. Every other markdown link is inert text. `ui/lib/links.mjs` holds the one allow-list.
- Rendering work is linear in the size of the page. No page text can stall the browser tab or the server.
- A throw anywhere in rendering shows a notice, never a blank window.
- A wikilink is looked up in the page's `links` map as an own property. An id becomes `<a href="#/...">` built with `idToHash`; `null` or an absent key becomes a marked, inert span. The client resolves nothing itself.
- The reader fetches `/api/page?id=` on each change of the open page, and only then. A reply for a page that is no longer open is dropped.
- After any change under `ui/`, rebuild and commit both generated files.

**Never:**
- No syntax highlighting, math, diagrams, or images. No lint findings in the reader yet (story 7). No filters or search (story 6).
- No click handler that navigates: links are real `href`s.
- No second injection point, and no `dangerouslySetInnerHTML` outside `ReaderPane.jsx`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Open a page | hash names a page | three panes; header shows title, type, dates, and the type's required fields that the page has; body rendered; relations listed | N/A |
| Close the reader | close button | hash emptied; two panes; graph highlight and tree selection cleared | N/A |
| Follow a wikilink | click in the body | target opens in all three panes; Back returns | N/A |
| Hash names no page | `#/nope`, or the server answers 404 | reader shows "page not found"; graph and tree keep working | N/A |
| Page request fails | 500 or network error | reader shows a failure note with a retry | N/A |
| Fast switching | two hash changes before the first reply | only the last page is shown | N/A |
| Raw HTML in the body | `<script>alert(1)</script>`, `<img src=x onerror=alert(1)>` | shown as text | N/A |
| Script and data addresses | `[x](javascript:alert(1))`, `[x](data:text/html,...)`, `[x](vbscript:...)`, `[x](file:///etc/passwd)`, `[x](ms-msdt:...)` | inert text, no `href` | N/A |
| Relative or fragment link | `[x](other.md)`, `[x](#top)`, `[x](/api/wiki)` | inert text | N/A |
| Image | `![diagram](http://evil.example/p.png)` | the text `diagram`; no request leaves the page | N/A |
| HTML comment | `<!-- lumina:index -->` in prose; the same inside inline code, an indented block, or a fence at any nesting; one wrapping a fenced block; one never closed | removed; kept; removed with the block; printed as text | N/A |
| Hostile bulk | 200 KB of `[`, of `[[a|`, or of `<!--` | rendered in well under two seconds | no stall |
| Bad pattern or page shape | a missing or invalid `wikilinkPattern`; a 200 reply that is not a page | wikilinks print as text; the failure note | no blank window |
| Wikilink forms | bare, aliased, inner spaces, broken, URL-shaped | link, link with the alias as text, link, broken span, broken span | N/A |
| Wikilink inside code | fenced or inline code | literal text | N/A |
| Hostile wikilink text | `[[<b>x</b>]]`, alias `"><script>` | escaped text | N/A |
| Table, list, quote, heading, emphasis, plain code block | standard markdown | rendered | N/A |
| Relations | fixture `sources/lora` | grouped by relation type; outbound, inbound, and undirected kept apart; each entry links to a page, opens an `http(s)` address in a new tab, or is plain text for a missing page | N/A |
| Frontmatter values | arrays, numbers, nested objects, a very long string | arrays joined with commas; other values as text; nothing is HTML | N/A |

</frozen-after-approval>

## Code Map

- `src/viewer/ui/App.jsx` -- root: loads `/api/wiki`, reads the hash, holds the reducer, renders `GraphPane` and `TreePane`. Today it turns an unknown hash id into `null` for both panes; the reader needs the raw id too.
- `src/viewer/ui/lib/hash.mjs` -- `idToHash`, `hashToId`. `lib/escape.mjs` -- `escapeHtml`. `lib/strings.mjs` -- `STRINGS`.
- `src/viewer/test-fixtures/contract/expected/pages.json` -- three `/api/page` bodies; `sources/lora-2` holds every wikilink form. `wiki.json` -- `schema.entityTypes[].required`, nodes, edges.
- `/api/page` body: `{id, type, title, frontmatter, body, links}`; `links` maps a wikilink target as written to a page id or `null`. `schema.wikilinkPattern` is the engine's regex source; capture group 1 is the target, and an alias follows a `|`.
- `markdown-it` 15: `md.renderer.rules.image`, `link_open`, `link_close` can be replaced; `md.inline.ruler.before('link', name, fn)` adds an inline rule; code spans and fences never reach inline rules; its default `validateLink` already refuses `javascript:`, `vbscript:`, `file:`, and non-image `data:`.
- `src/viewer/app/viewer.css` -- `.app.has-reader` already defines three columns; `.pane-reader` exists.

## Tasks & Acceptance

**Execution:**
- [x] `ui/lib/render.mjs` -- `renderPage(body, links, wikilinkPattern)` as bounded above.
- [x] `ui/lib/render.test.mjs` -- every renderer row of the matrix; the fixture page `sources/lora-2` rendered with its own `links`.
- [x] `ui/lib/relations.mjs` -- `relationsOf(wiki, id)` -> groups `{type, direction: 'out' | 'in' | 'both', items: [{id, kind, title, confidence}]}`, sorted by type, then `out`, `in`, `both`; items by title, then id. `headerFields(page, entityTypes)` -> `[{key, text}]` for `created`, `updated`, and the type's required keys present in the frontmatter.
- [x] `ui/lib/relations.test.mjs` -- on the fixture, for `sources/lora`, `concepts/rank` (self-loops), and `index`.
- [x] `ui/lib/strings.mjs` -- reader strings.
- [x] `ui/panes/ReaderPane.jsx` -- props `{id, wiki, onClose}`; fetches the page; header, body, relations; the not-found and failure states.
- [x] `ui/App.jsx` -- pass the raw hash id to the reader; add `has-reader` while a page is open.
- [x] `app/viewer.css` -- reader typography, header, relations, broken and inert links.
- [x] `app/viewer.js`, `app/THIRD-PARTY-NOTICES.md` -- rebuild.

**Acceptance Criteria:**
- Given the fixture in a browser, when `sources/lora-2` is opened, then its links navigate inside the viewer, `[[nope]]` is visibly broken and not clickable, and Back returns to the previous page.
- Given a page whose body holds `<script>` and an image, then no script runs and the browser makes no request other than to the viewer itself.
- Given `npm run test:viewer` and `npm run ci:viewer-bundle`, then both pass.

## Implementation Notes

- Checked in Chrome on the contract fixture: three panes with the header fields, body, and relations of `sources/lora-2`; wikilinks navigate and Back returns; `[[nope]]` and the URL-shaped link are marked broken; the `index` page shows its list without the marker comments; `#/nope` shows "Page not found" with graph and tree intact; closing returns to two panes; a reload keeps the open page.
- Hostile bulk input now renders in 2 to 230 ms where it took 5 to 14 s; the server's link scan takes 1 to 3 ms where it took 76 s.
- Bundle: 525,512 bytes, 40 packages.
- The reducer and strings already carry the view settings that story 6 wires up; they are inert here.

## Spec Change Log

- **2026-10-10, review pass 1.** HTML comments are now dropped by two `markdown-it` rules instead of a line scanner that re-implemented fence tracking and was wrong inside inline code, nested fences, and wrapping comments. The wikilink rule and the server's link scan gained a constant-time pre-filter, because the engine's pattern is quadratic on text such as a long run of `[`. Web links are marked as leaving the viewer. An error boundary and shape checks replace a blank window. The address rule was tightened to `http://` and `https://`. Patched in place. KEEP: one render function, one injection point, links as real `href`s, relations from the wiki snapshot.

## Review Triage Log

| # | Finding | Verdict | Route | Evidence |
|---|---|---|---|---|
| 1 | Wikilink rule quadratic: 80 KB of `[` froze the tab for 6 s | high | patch | measured by two reviewers; pre-filter added, time-bound tests |
| 2 | Server `readPage` link scan quadratic: 400 KB of `[` blocked Node for 76 s | high | patch | same pattern on the server; linear scan with the engine pattern as judge |
| 3 | Comment stripping quadratic on unclosed `<!--` | medium | bad_spec | replaced by parser rules |
| 4 | Comments deleted inside inline code, indented code, nested fences; a comment wrapping a fence leaked | medium | bad_spec | same root cause: a line scanner re-implementing block structure |
| 5 | Image alt escaping pinned by no test | high | patch | mutant survived and produced a live `<img onerror>`; test added |
| 6 | Link title escaping pinned by no test | high | patch | mutant survived with an attribute breakout; test added |
| 7 | Comment tests used one comment and never a closed fence | medium | patch | greedy-regex mutant emptied the index page; fixture `index` rendered in a test |
| 8 | Sticky flag unpinned | low | patch | test with a stray `[[` before a real link |
| 9 | Output not pinned to an allow-list of tags and attributes | medium | patch | 300,000 fuzzed inputs stayed inside it; one test now asserts it |
| 10 | "One injection point" had no guard | medium | patch | `injection.test.mjs` scans the client source |
| 11 | A throw in the reader blanked the viewer | medium | patch | error boundary; shape checks; guarded pattern |
| 12 | Page request had no time limit | low | patch | 15 s limit |
| 13 | Web links in the body looked like wikilinks | medium | patch | class `external` and a mark |
| 14 | `mailto:` links opened a blank tab | low | patch | no `target` on mail links |
| 15 | Aliased wikilink inside a table cell splits or breaks | low | defer | the engine's pattern and lint treat the escaped form as a different target; fixing it here would break AD-5 |
| 16 | Wikilink target absent from `links` when a stray `[[` shifts the server's match | low | reject | needs a second resolver in the client, against AD-5 |
| 17 | Wikilink inside a link label cancels the outer link | low | reject | nothing unsafe; rare; a fix means patching the library's label parser |
| 18 | `[[ ]]` rendered an empty span; alt text lost wikilink words | low | patch | printed as text; alt from the raw source |
| 19 | Header rows for `null`, `''`, and blank strings; relation order unpinned | low | patch | blank test widened; literal expectations; collator order |
| 20 | Truncation could split a surrogate pair | low | patch | cut one unit earlier |
| 21 | Relations stay as loaded when the wiki changes on disk | false | reject | AD-12: the graph data is loaded once; a reload refreshes it |
| 22 | Close button scrolled away; no focus styles; no labels or live regions; focus lost after navigation | low | patch | sticky button, outlines, labels, focus moved to the pane |
| 23 | Interface text in CSS and literals | low | patch | strings module |
| 24 | Two tests rebuilt the answer with the code's own expression | low | patch | literals from the fixture |
| 25 | Fetch lifecycle and pane wiring have no automated check | medium | defer | no browser test framework is allowed; two manual checks added above |
| 26 | Written rule said `http:`; code requires `http://` | low | patch | rule text corrected here and in AD-14 |

## Design Notes

AD-14 said any link with a scheme is external. Wiki text is untrusted, and a custom scheme can start a program on the reader's machine, so the allow-list is `http`, `https`, `mailto`. AD-14 is amended with this story.

## Verification

**Commands:**
- `npm run test:viewer` -- expected: all pass
- `npm run build:viewer && npm run ci:viewer-bundle` -- expected: pass after the generated files are staged

**Manual checks (if no CLI):**
- In a browser on the fixture: open `sources/lora-2`, follow a link, go Back, close the reader; open `#/nope`.
- With the network throttled, switch pages fast: only the last one shows.
- Stop the server, open a page, see the failure note; start the server, press the retry button.
