// The PowerPoint deck of Mosaikit, made from docs/presentation/deck.json (one file per language).
import fs from 'node:fs';
import path from 'node:path';
import PptxGenJS from 'pptxgenjs';

const W = 13.333;
const H = 7.5;
const FONT = 'Segoe UI';

const UI = {
  en: { saved: 'Saved', days: 'person-days', scratch: 'From scratch', with: 'With Mosaikit', total: 'Total', saving: 'Saving', cost: 'Cost at', day: 'a day', platform: 'platform work', measured: 'Measured on version', footer: 'Mosaikit' },
  it: { saved: 'Risparmiati', days: 'giorni-persona', scratch: 'Da zero', with: 'Con Mosaikit', total: 'Totale', saving: 'Risparmio', cost: 'Costo a', day: 'al giorno', platform: 'lavoro di piattaforma', measured: 'Misurato sulla versione', footer: 'Mosaikit' },
};

const num = (n, lang) => n.toLocaleString(lang === 'it' ? 'it-IT' : 'en-GB');

/// Checks that every text of the deck has both languages, so a deck is never half translated.
export function checkDeck(deck) {
  const bad = [];
  const walk = (o, where) => {
    if (o && typeof o === 'object') {
      if ('en' in o || 'it' in o) {
        for (const l of ['en', 'it']) if (typeof o[l] !== 'string' || !o[l].trim()) bad.push(`${where}.${l}`);
      } else for (const [k, v] of Object.entries(o)) walk(v, `${where}.${k}`);
    }
  };
  walk(deck.slides, 'slides');
  walk(deck.estimate, 'estimate');
  walk(deck.measured, 'measured');
  if (bad.length) throw new Error(`deck.json: missing text: ${bad.join(', ')}`);
}

export async function buildDeck({ root, out, lang, version }) {
  const deck = JSON.parse(fs.readFileSync(path.join(root, 'docs', 'presentation', 'deck.json'), 'utf8'));
  checkDeck(deck);
  const B = deck.brand;
  const t = (o) => (typeof o === 'string' ? o : o[lang]);
  const L = UI[lang];
  const date = new Date().toISOString().slice(0, 10);
  const logo = path.join(root, 'docs', 'logo', 'mosaikit-A-tessera-giallorossa-orizzontale-positivo.png');
  const logoNeg = path.join(root, 'docs', 'logo', 'mosaikit-A-tessera-giallorossa-orizzontale-negativo.png');

  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.title = `Mosaikit ${version}`;
  pptx.company = 'Mosaikit';
  pptx.lang = lang === 'it' ? 'it-IT' : 'en-GB';

  let n = 0;
  const base = (title) => {
    const s = pptx.addSlide();
    n += 1;
    s.background = { color: 'FFFFFF' };
    s.addShape('rect', { x: 0, y: 0, w: 0.18, h: H, fill: { color: B.red }, line: { color: B.red } });
    if (title) s.addText(t(title), { x: 0.7, y: 0.4, w: W - 1.4, h: 0.9, fontFace: FONT, fontSize: 30, bold: true, color: B.red, valign: 'middle' });
    if (title) s.addShape('line', { x: 0.7, y: 1.35, w: 1.4, h: 0, line: { color: B.gold, width: 3 } });
    s.addText(`${L.footer} ${version}`, { x: 0.7, y: H - 0.5, w: 5, h: 0.3, fontFace: FONT, fontSize: 10, color: B.muted });
    s.addText(String(n), { x: W - 1.2, y: H - 0.5, w: 0.6, h: 0.3, fontFace: FONT, fontSize: 10, color: B.muted, align: 'right' });
    return s;
  };

  const card = (s, x, y, w, h, head, text, accent = B.gold) => {
    s.addShape('roundRect', { x, y, w, h, rectRadius: 0.08, fill: { color: B.soft }, line: { color: B.line, width: 0.75 } });
    s.addShape('rect', { x: x + 0.01, y: y + 0.18, w: 0.07, h: 0.5, fill: { color: accent }, line: { color: accent } });
    s.addText(head, { x: x + 0.22, y: y + 0.12, w: w - 0.4, h: 0.5, fontFace: FONT, fontSize: 16, bold: true, color: B.ink, valign: 'middle' });
    s.addText(text, { x: x + 0.22, y: y + 0.65, w: w - 0.4, h: h - 0.75, fontFace: FONT, fontSize: 14, color: B.muted, valign: 'top' });
  };

  for (const sl of deck.slides) {
    if (sl.kind === 'title') {
      const s = pptx.addSlide();
      n += 1;
      s.background = { color: B.red };
      s.addShape('rect', { x: 0, y: H - 0.35, w: W, h: 0.35, fill: { color: B.gold }, line: { color: B.gold } });
      s.addImage({ path: logoNeg, x: 0.8, y: 0.7, w: 3.4, h: 3.4 * (400 / 1394) });
      s.addText(t(sl.title), { x: 0.8, y: 2.3, w: W - 1.6, h: 2, fontFace: FONT, fontSize: 46, bold: true, color: 'FFFFFF', valign: 'middle' });
      s.addText(t(sl.text), { x: 0.8, y: 4.4, w: W - 1.6, h: 0.9, fontFace: FONT, fontSize: 22, color: 'F3DDE0', valign: 'top' });
      s.addText(`${version} · ${date} · https://mosaikit.github.io/`, { x: 0.8, y: 5.9, w: W - 1.6, h: 0.4, fontFace: FONT, fontSize: 13, color: 'F3DDE0' });
    } else if (sl.kind === 'bullets') {
      const s = base(sl.title);
      s.addText(
        sl.items.map((i) => ({ text: t(i), options: { bullet: { code: '25A0' }, breakLine: true, paraSpaceAfter: 24 } })),
        { x: 0.9, y: 1.8, w: W - 1.8, h: H - 2.9, fontFace: FONT, fontSize: 24, color: B.ink, valign: 'top' },
      );
    } else if (sl.kind === 'columns') {
      const s = base(sl.title);
      const cw = (W - 1.4 - 0.5 * (sl.columns.length - 1)) / sl.columns.length;
      sl.columns.forEach((c, i) => {
        const x = 0.7 + i * (cw + 0.5);
        s.addShape('roundRect', { x, y: 1.9, w: cw, h: 4.4, rectRadius: 0.08, fill: { color: i === 0 ? B.red : B.soft }, line: { color: i === 0 ? B.red : B.line } });
        s.addText(t(c.h), { x: x + 0.3, y: 2.1, w: cw - 0.6, h: 0.8, fontFace: FONT, fontSize: 26, bold: true, color: i === 0 ? 'FFFFFF' : B.red, valign: 'middle' });
        s.addText(t(c.t), { x: x + 0.3, y: 3.0, w: cw - 0.6, h: 3.1, fontFace: FONT, fontSize: 17, color: i === 0 ? 'FBEFF1' : B.ink, valign: 'top' });
      });
    } else if (sl.kind === 'cards') {
      const s = base(sl.title);
      const cols = sl.cards.length > 6 ? 3 : sl.cards.length > 4 ? 3 : 2;
      const rows = Math.ceil(sl.cards.length / cols);
      const gap = 0.3;
      const cw = (W - 1.4 - gap * (cols - 1)) / cols;
      const ch = (H - 2.5 - gap * (rows - 1)) / rows;
      sl.cards.forEach((c, i) => card(s, 0.7 + (i % cols) * (cw + gap), 1.75 + Math.floor(i / cols) * (ch + gap), cw, ch, t(c.h), t(c.t)));
    } else if (sl.kind === 'steps') {
      const s = base(sl.title);
      const k = sl.steps.length;
      const gap = 0.25;
      const cw = (W - 1.4 - gap * (k - 1)) / k;
      sl.steps.forEach((st, i) => {
        const x = 0.7 + i * (cw + gap);
        s.addShape('ellipse', { x: x + 0.05, y: 1.9, w: 0.62, h: 0.62, fill: { color: B.red }, line: { color: B.red } });
        s.addText(String(i + 1), { x: x + 0.05, y: 1.9, w: 0.62, h: 0.62, fontFace: FONT, fontSize: 20, bold: true, color: 'FFFFFF', align: 'center', valign: 'middle' });
        if (i < k - 1) s.addShape('line', { x: x + 0.75, y: 2.21, w: cw + gap - 0.85, h: 0, line: { color: B.gold, width: 2 } });
        s.addText(t(st.h), { x, y: 2.75, w: cw, h: 0.8, fontFace: FONT, fontSize: 18, bold: true, color: B.ink, valign: 'top' });
        s.addText(t(st.t), { x, y: 3.55, w: cw, h: 2.8, fontFace: FONT, fontSize: 14, color: B.muted, valign: 'top' });
      });
    } else if (sl.kind === 'kpis') {
      const s = base(sl.title);
      const items = deck.measured.items;
      const gap = 0.3;
      const cw = (W - 1.4 - gap * 2) / 3;
      const ch = 2.15;
      items.forEach((it, i) => {
        const x = 0.7 + (i % 3) * (cw + gap);
        const y = 1.8 + Math.floor(i / 3) * (ch + gap);
        s.addShape('roundRect', { x, y, w: cw, h: ch, rectRadius: 0.08, fill: { color: B.soft }, line: { color: B.line } });
        s.addShape('rect', { x, y, w: cw, h: 0.07, fill: { color: B.gold }, line: { color: B.gold } });
        s.addText([{ text: it.v, options: { fontSize: 46, bold: true, color: B.red } }, { text: ` ${it.u}`, options: { fontSize: 20, color: B.muted } }], { x: x + 0.25, y: y + 0.2, w: cw - 0.5, h: 0.95, fontFace: FONT, valign: 'middle' });
        s.addText(t(it.t), { x: x + 0.25, y: y + 1.2, w: cw - 0.5, h: 0.85, fontFace: FONT, fontSize: 14, color: B.muted, valign: 'top' });
      });
      s.addText(`${L.measured} ${deck.measured.version}: ${t(deck.measured.where)}.`, { x: 0.7, y: H - 0.95, w: W - 1.4, h: 0.35, fontFace: FONT, fontSize: 11, italic: true, color: B.muted });
    } else if (sl.kind === 'savings') {
      const s = base(sl.title);
      const e = deck.estimate;
      const total = e.rows.reduce((a, r) => a + r.scratch, 0);
      const saved = total - e.withMosaikit.days;
      const pct = Math.round((saved / total) * 100);
      const head = (x) => ({ text: x, options: { bold: true, color: 'FFFFFF', fill: { color: B.red }, fontFace: FONT, fontSize: 11 } });
      const cell = (x, o = {}) => ({ text: x, options: { fontFace: FONT, fontSize: 10.5, color: B.ink, ...o } });
      const rows = [
        [head(''), head(L.scratch), head(L.with)],
        ...e.rows.map((r) => [cell(t(r.what)), cell(`${r.scratch}`, { align: 'right' }), cell('0', { align: 'right' })]),
        [cell(t(e.withMosaikit.what), { italic: true }), cell('0', { align: 'right' }), cell(`${e.withMosaikit.days}`, { align: 'right' })],
        [cell(`${L.total} (${L.days})`, { bold: true, fill: { color: B.soft } }), cell(num(total, lang), { bold: true, align: 'right', fill: { color: B.soft } }), cell(num(e.withMosaikit.days, lang), { bold: true, align: 'right', fill: { color: B.soft } })],
      ];
      s.addTable(rows, { x: 0.7, y: 1.6, w: 8.2, colW: [5.6, 1.3, 1.3], rowH: 0.34, border: { type: 'solid', color: B.line, pt: 0.5 }, valign: 'middle' });
      s.addShape('roundRect', { x: 9.3, y: 1.6, w: 3.35, h: 4.45, rectRadius: 0.08, fill: { color: B.red }, line: { color: B.red } });
      s.addText(L.saving, { x: 9.5, y: 1.75, w: 3, h: 0.4, fontFace: FONT, fontSize: 14, color: 'F3DDE0' });
      s.addText(`${pct}%`, { x: 9.5, y: 2.15, w: 3, h: 1.0, fontFace: FONT, fontSize: 58, bold: true, color: 'FFFFFF' });
      s.addText(`${num(saved, lang)} ${L.days}`, { x: 9.5, y: 3.2, w: 3, h: 0.5, fontFace: FONT, fontSize: 18, bold: true, color: B.gold });
      s.addText(`≈ ${num(saved * e.dayRate, lang)} ${e.currency}`, { x: 9.5, y: 3.75, w: 3, h: 0.5, fontFace: FONT, fontSize: 20, bold: true, color: 'FFFFFF' });
      s.addText(`${L.cost} ${num(e.dayRate, lang)} ${e.currency} ${L.day}; ${L.platform}.`, { x: 9.5, y: 4.3, w: 3, h: 0.7, fontFace: FONT, fontSize: 11, color: 'F3DDE0', valign: 'top' });
      s.addText(t(e.note), { x: 0.7, y: H - 1.0, w: W - 1.4, h: 0.55, fontFace: FONT, fontSize: 10.5, italic: true, color: B.muted, valign: 'top' });
    } else if (sl.kind === 'closing') {
      const s = pptx.addSlide();
      n += 1;
      s.background = { color: B.red };
      s.addShape('rect', { x: 0, y: H - 0.35, w: W, h: 0.35, fill: { color: B.gold }, line: { color: B.gold } });
      s.addText(t(sl.title), { x: 0.8, y: 1.8, w: W - 1.6, h: 1.4, fontFace: FONT, fontSize: 54, bold: true, color: 'FFFFFF' });
      s.addText(t(sl.text), { x: 0.8, y: 3.3, w: W - 1.6, h: 0.9, fontFace: FONT, fontSize: 24, color: 'F3DDE0' });
      s.addText(sl.link, { x: 0.8, y: 4.6, w: W - 1.6, h: 0.6, fontFace: FONT, fontSize: 24, bold: true, color: B.gold, hyperlink: { url: sl.link } });
      s.addImage({ path: logo, x: W - 4.2, y: 0.5, w: 3.4, h: 3.4 * (400 / 1394) });
    } else throw new Error(`deck.json: unknown slide kind ${sl.kind}`);
  }

  fs.mkdirSync(out, { recursive: true });
  const file = path.join(out, `mosaikit-presentation-${version}-${lang}.pptx`);
  await pptx.writeFile({ fileName: file });
  return file;
}
