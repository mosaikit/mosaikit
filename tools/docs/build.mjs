// PDF manuals and the PowerPoint deck of Mosaikit, made from the Markdown of docs/ and from docs/presentation/deck.json.
// node build.mjs manuals|deck|all [--out <folder>] [--lang en,it] [--version <x.y.z>]
// The browser is the one of Playwright (set DOCS_BROWSER to the path of a Chromium to use another).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { marked } from 'marked';
import { chromium } from 'playwright-core';
import { buildDeck, checkDeck } from './deck.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const cfg = JSON.parse(fs.readFileSync(path.join(here, 'manuals.json'), 'utf8'));

const args = process.argv.slice(2);
const what = args.find((a, i) => !a.startsWith('--') && !(args[i - 1] ?? '').startsWith('--')) ?? 'all';
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};
const out = path.resolve(opt('out', path.join(root, 'dist', 'docs')));
const langs = opt('lang', 'en,it').split(',');

function workspaceVersion() {
  const t = fs.readFileSync(path.join(root, 'Cargo.toml'), 'utf8');
  return /\[workspace\.package\][\s\S]*?\nversion\s*=\s*"([^"]+)"/.exec(t)?.[1] ?? 'dev';
}

const slug = (s) =>
  s
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .trim()
    .replace(/\s+/g, '-');
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// A source is `path.md` or `path.md#Heading` (only the H2 section of that heading).
function readSource(src) {
  const [file, heading] = src.split('#');
  let text = fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');
  if (heading) {
    const lines = text.split('\n');
    const start = lines.findIndex((l) => l.trim() === `## ${heading}`);
    if (start < 0) throw new Error(`${file}: no section "${heading}"`);
    let end = lines.findIndex((l, i) => i > start && /^## /.test(l));
    if (end < 0) end = lines.length;
    text = `# ${heading}\n\n` + lines.slice(start + 1, end).join('\n');
  }
  return { file, text };
}

const docId = (src) => slug(src.replace(/\.md/g, '').replace(/[\\/#]/g, '-'));

function render(src, ids) {
  const { file, text } = readSource(src);
  const id = docId(src);
  const dir = path.posix.dirname(file);
  const renderer = new marked.Renderer();
  renderer.heading = function ({ tokens, depth }) {
    const inner = this.parser.parseInline(tokens);
    const plain = tokens.map((t) => t.raw ?? t.text ?? '').join('');
    const hid = depth === 1 ? id : `${id}--${slug(plain)}`;
    return `<h${depth} id="${hid}">${inner}</h${depth}>\n`;
  };
  renderer.link = function ({ href, tokens }) {
    const inner = this.parser.parseInline(tokens);
    if (/^https?:|^mailto:/.test(href)) return `<a href="${href}">${inner}</a>`;
    if (href.startsWith('#')) return `<a href="#${id}--${href.slice(1)}">${inner}</a>`;
    const [p, frag] = href.split('#');
    const target = path.posix.normalize(path.posix.join(dir, p));
    const hit = ids.get(target);
    if (hit) return `<a href="#${frag ? `${hit}--${frag}` : hit}">${inner}</a>`;
    return `<a href="${cfg.repo}${target}${frag ? `#${frag}` : ''}">${inner}</a>`;
  };
  renderer.html = ({ text: raw }) => esc(raw);
  return `<section class="doc" id="doc-${id}">${marked.parse(text, { renderer, gfm: true })}</section>`;
}

const CSS = `
@page { size: A4; margin: 22mm 18mm 20mm; }
* { box-sizing: border-box; }
body { font: 10.5pt/1.5 "Segoe UI", "Helvetica Neue", Arial, sans-serif; color: #1b2333; margin: 0; }
.cover { page-break-after: always; height: 240mm; display: flex; flex-direction: column; justify-content: center; }
.cover img { width: 70mm; margin-bottom: 26mm; }
.cover h1 { font-size: 30pt; line-height: 1.1; margin: 0 0 8mm; color: #8b1a2b; border: 0; }
.cover p { font-size: 13pt; color: #55607a; margin: 0 0 4mm; max-width: 140mm; }
.cover .meta { margin-top: 24mm; font-size: 10pt; color: #55607a; }
.toc { page-break-after: always; }
.toc h2 { border: 0; font-size: 18pt; margin-top: 0; }
.toc ul { list-style: none; padding: 0; margin: 0; }
.toc li { margin: 2px 0; }
.toc li.d1 { margin-top: 9px; font-weight: 600; }
.toc li.d2 { padding-left: 14px; font-size: 9.5pt; }
.toc a { color: inherit; text-decoration: none; }
section.doc { page-break-before: always; }
h1 { font-size: 22pt; color: #8b1a2b; border-bottom: 2px solid #e8b94a; padding-bottom: 4px; margin: 0 0 10px; }
h2 { font-size: 15pt; margin: 22px 0 6px; border-bottom: 1px solid #d5dbe6; padding-bottom: 2px; break-after: avoid; }
h3 { font-size: 12pt; margin: 16px 0 4px; break-after: avoid; }
h4 { font-size: 10.5pt; margin: 12px 0 2px; break-after: avoid; }
p, li { orphans: 3; widows: 3; }
a { color: #1f56c4; text-decoration: none; }
code { font: 9pt Consolas, "Cascadia Mono", monospace; background: #f1f3f8; padding: 0 3px; border-radius: 3px; }
pre { background: #f1f3f8; border: 1px solid #d5dbe6; border-radius: 4px; padding: 8px 10px; white-space: pre-wrap; word-break: break-word; break-inside: avoid; }
pre code { background: none; padding: 0; font-size: 8.8pt; }
table { border-collapse: collapse; width: 100%; margin: 8px 0; font-size: 9.2pt; }
th, td { border: 1px solid #d5dbe6; padding: 4px 7px; vertical-align: top; text-align: left; }
th { background: #f1f3f8; }
tr { break-inside: avoid; }
blockquote { margin: 8px 0; padding: 2px 12px; border-left: 3px solid #e8b94a; color: #3b465f; background: #fbf7ec; }
img { max-width: 100%; }
`;

let browserPromise;
const browser = () => (browserPromise ??= chromium.launch({ executablePath: process.env.DOCS_BROWSER || undefined }));

async function manual(m, lang, ver, date) {
  const sources = m.sources[lang];
  if (!sources) return null;
  const ids = new Map(sources.map((s) => [s.split('#')[0], docId(s)]));
  const body = sources.map((s) => render(s, ids)).join('\n');
  const toc = [...body.matchAll(/<h([12]) id="([^"]+)">(.*?)<\/h\1>/g)]
    .map(([, d, id, t]) => `<li class="d${d}"><a href="#${id}">${t.replace(/<[^>]+>/g, '')}</a></li>`)
    .join('\n');
  const logo = fs.readFileSync(path.join(root, cfg.logo));
  const L = lang === 'it' ? { v: 'Versione', c: 'Indice', d: 'Generato il' } : { v: 'Version', c: 'Contents', d: 'Generated on' };
  const html = `<!doctype html><html lang="${lang}"><meta charset="utf-8"><title>${esc(m.title[lang])}</title><style>${CSS}</style>
<div class="cover"><img src="data:image/svg+xml;base64,${logo.toString('base64')}" alt="Mosaikit">
<h1>${esc(m.title[lang].replace(/^Mosaikit — /, ''))}</h1><p>${esc(m.subtitle[lang])}</p>
<p class="meta">${L.v} ${ver} · ${L.d} ${date}<br>https://mosaikit.github.io/ · MPL 2.0</p></div>
<div class="toc"><h2>${L.c}</h2><ul>${toc}</ul></div>${body}</html>`;
  const page = await (await browser()).newPage();
  await page.setContent(html, { waitUntil: 'load' });
  fs.mkdirSync(out, { recursive: true });
  const file = path.join(out, `mosaikit-${m.id}-${ver}-${lang}.pdf`);
  await page.pdf({
    path: file,
    format: 'A4',
    printBackground: true,
    displayHeaderFooter: true,
    outline: true,
    tagged: true,
    margin: { top: '22mm', bottom: '20mm', left: '18mm', right: '18mm' },
    headerTemplate: '<span></span>',
    footerTemplate: `<div style="font:8px Arial;color:#777;width:100%;padding:0 18mm;display:flex;justify-content:space-between"><span>${esc(m.title[lang])} · ${ver}</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`,
  });
  await page.close();
  return file;
}

const ver = opt('version', workspaceVersion());
if (what === 'check') {
  // fast: every source of the manuals exists (and its section), every text of the deck has both languages
  for (const m of cfg.manuals) for (const srcs of Object.values(m.sources)) for (const s of srcs) readSource(s);
  checkDeck(JSON.parse(fs.readFileSync(path.join(root, 'docs', 'presentation', 'deck.json'), 'utf8')));
  console.log('documents: sources and deck are consistent');
  process.exit(0);
}
const date = new Date().toISOString().slice(0, 10);
const made = [];
if (what === 'manuals' || what === 'all') {
  for (const m of cfg.manuals) {
    for (const lang of langs) {
      const f = await manual(m, lang, ver, date);
      if (f) made.push(f);
    }
  }
  if (browserPromise) await (await browserPromise).close();
}
if (what === 'deck' || what === 'all') {
  for (const lang of langs) made.push(await buildDeck({ root, out, lang, version: ver }));
}
for (const f of made) console.log(`${path.relative(root, f)}  ${(fs.statSync(f).size / 1024).toFixed(0)} KB`);
