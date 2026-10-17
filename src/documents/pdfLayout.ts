import path from 'path';
import PDFDocument from 'pdfkit';
import { amountInWords } from './amountInWords';
import { LOGO_HEIGHT, LOGO_PATH } from './logo';

// The layout of our documents, after the delivery notes the company has been issuing by hand:
// rules at the top and bottom, the mark with «NUMENOR SYSTEMS», a light title, supplier and
// recipient side by side, a table with a black header, totals with VAT and the sum in words.

const FONTS_DIR = path.join(__dirname, '..', '..', 'assets', 'fonts');
const MARGIN_X = 56;
const MARGIN_TOP = 56;
const MARGIN_BOTTOM = 56;
const INK = '#000000';
const SOFT = '#3a3a3a';
const DOTS = '#9a9a9a';
const BODY_SIZE = 9.5;

type Doc = PDFKit.PDFDocument;

export interface Party {
  title: string; // «Постачальник:», «Отримувач:», «Платник:»
  lines: string[];
}

export interface Row {
  description: string;
  quantity: number;
  price: number;
  sum: number;
}

export interface Totals {
  net: number;
  vatRate: number;
  vat: number;
  total: number;
}

export function createDocument(title: string, author: string): Doc {
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: MARGIN_TOP, bottom: MARGIN_BOTTOM, left: MARGIN_X, right: MARGIN_X },
    info: { Title: title, Author: author, Creator: 'Numenor portal' },
  });
  doc.registerFont('light', path.join(FONTS_DIR, 'Inter_300Light.ttf'));
  doc.registerFont('regular', path.join(FONTS_DIR, 'Inter_400Regular.ttf'));
  doc.registerFont('semibold', path.join(FONTS_DIR, 'Inter_600SemiBold.ttf'));
  doc.registerFont('bold', path.join(FONTS_DIR, 'Inter_700Bold.ttf'));
  doc.font('regular').fontSize(BODY_SIZE).fillColor(INK);
  return doc;
}

const contentWidth = (doc: Doc) => doc.page.width - MARGIN_X * 2;
const right = (doc: Doc) => doc.page.width - MARGIN_X;
const bottomLimit = (doc: Doc) => doc.page.height - MARGIN_BOTTOM;

// «1 266,66 ₴»
export function money(n: number): string {
  const [whole, fraction] = Math.abs(n).toFixed(2).split('.');
  return `${n < 0 ? '−' : ''}${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')},${fraction} ₴`;
}

// «07.09.2026», in UTC like the stored dates.
export function day(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`;
}

function rule(doc: Doc, y: number): void {
  doc.save().moveTo(MARGIN_X, y).lineTo(right(doc), y).lineWidth(1.6).strokeColor(INK).stroke().restore();
}

// Rule, mark and name, the title and the lines under it (date, references). Returns the y below.
export function drawHeader(doc: Doc, companyName: string, title: string, subtitleLines: string[]): number {
  let y = MARGIN_TOP;
  rule(doc, y);
  y += 16;

  const markHeight = 20;
  const scale = markHeight / LOGO_HEIGHT;
  doc.save().translate(MARGIN_X, y).scale(scale).path(LOGO_PATH).fill(INK).restore();
  doc.font('bold').fontSize(12.5).fillColor(INK).text(companyName.toUpperCase(), MARGIN_X + 30, y + 3, { lineBreak: false });
  y += markHeight + 14;

  doc.font('light').fontSize(19).text(title, MARGIN_X, y, { width: contentWidth(doc) });
  y = doc.y + 2;
  doc.font('regular').fontSize(9);
  for (const line of subtitleLines) {
    doc.text(line, MARGIN_X, y, { width: contentWidth(doc) });
    y = doc.y + 1;
  }
  return y + 14;
}

// Supplier and recipient requisites in two columns. Returns the y below the taller one.
export function drawParties(doc: Doc, left: Party, rightParty: Party, top: number): number {
  const gap = 24;
  const columnWidth = (contentWidth(doc) - gap) / 2;
  let bottom = top;
  [left, rightParty].forEach((party, i) => {
    const x = MARGIN_X + 6 + i * (columnWidth + gap);
    const width = columnWidth - 6;
    doc.font('regular').fontSize(BODY_SIZE).fillColor(SOFT).text(party.title, x, top, { width });
    doc.fillColor(INK);
    for (const line of party.lines.filter(Boolean)) doc.text(line, x, doc.y + 0.5, { width, lineGap: 0.5 });
    bottom = Math.max(bottom, doc.y);
  });
  return bottom + 34;
}

interface Column {
  title: string;
  width: number;
  align: 'left' | 'right';
}

function columns(doc: Doc): Column[] {
  const w = contentWidth(doc);
  return [
    { title: 'Опис', width: w * 0.45, align: 'left' },
    { title: 'Кількість', width: w * 0.17, align: 'right' },
    { title: 'Ціна', width: w * 0.19, align: 'right' },
    { title: 'Сума', width: w * 0.19, align: 'right' },
  ];
}

const PAD_X = 6;
const PAD_Y = 6;

function dotted(doc: Doc, x1: number, y1: number, x2: number, y2: number): void {
  doc.save().moveTo(x1, y1).lineTo(x2, y2).lineWidth(0.6).dash(1, { space: 1.6 }).strokeColor(DOTS).stroke().undash().restore();
}

function drawTableHeader(doc: Doc, y: number): number {
  const cols = columns(doc);
  const height = 20;
  doc.save().rect(MARGIN_X, y, contentWidth(doc), height).fill(INK).restore();
  let x = MARGIN_X;
  for (const c of cols) {
    doc.font('semibold').fontSize(BODY_SIZE).fillColor('#ffffff').text(c.title, x + PAD_X, y + 5.5, { width: c.width - PAD_X * 2, lineBreak: false });
    x += c.width;
  }
  doc.fillColor(INK);
  return y + height;
}

// One table row; cells are text (already formatted). Separators are dotted like the paper form.
function drawRow(doc: Doc, y: number, cells: string[], opts: { fonts?: string[]; boxLast?: boolean } = {}): number {
  const cols = columns(doc);
  doc.fontSize(BODY_SIZE);
  const heights = cells.map((text, i) => {
    doc.font(opts.fonts?.[i] ?? 'regular');
    return text ? doc.heightOfString(text, { width: cols[i].width - PAD_X * 2 }) : 0;
  });
  const height = Math.max(...heights, 11) + PAD_Y * 2;

  let x = MARGIN_X;
  cells.forEach((text, i) => {
    const c = cols[i];
    if (text) {
      doc.font(opts.fonts?.[i] ?? 'regular').fillColor(INK).text(text, x + PAD_X, y + PAD_Y, { width: c.width - PAD_X * 2, align: c.align });
    }
    if (i > 0) dotted(doc, x, y, x, y + height);
    x += c.width;
  });
  if (opts.boxLast) {
    const lastX = MARGIN_X + cols.slice(0, -1).reduce((sum, c) => sum + c.width, 0);
    doc.save().rect(lastX, y, cols[cols.length - 1].width, height).lineWidth(1.2).strokeColor(INK).stroke().restore();
  }
  dotted(doc, MARGIN_X, y + height, right(doc), y + height);
  return y + height;
}

// The items with Сума / ПДВ / Всього under them. Starts a new page (repeating the header row)
// when the items don't fit. Returns the y below the table.
export function drawItems(doc: Doc, rows: Row[], totals: Totals, top: number): number {
  let y = drawTableHeader(doc, top);
  for (const r of rows) {
    if (y + 40 > bottomLimit(doc) - 160) {
      doc.addPage();
      y = drawTableHeader(doc, MARGIN_TOP);
    }
    y = drawRow(doc, y, [r.description, String(r.quantity), money(r.price), money(r.sum)]);
  }
  if (y > bottomLimit(doc) - 220) {
    doc.addPage();
    y = MARGIN_TOP;
  }
  y = drawRow(doc, y, ['', '', 'Сума', money(totals.net)]);
  y = totals.vatRate
    ? drawRow(doc, y, ['', 'ПДВ', `${totals.vatRate.toFixed(2).replace('.', ',')}%`, money(totals.vat)])
    : drawRow(doc, y, ['', 'Без ПДВ', '', '—']);
  y = drawRow(doc, y, ['', '', 'Всього', money(totals.total)], { boxLast: true });
  return y + 22;
}

// «Всього на суму» in words (and the VAT), the issuer's signature on the right and, on delivery
// notes, the receiver's lines. Ends with the bottom rule.
export function drawFooter(doc: Doc, totals: Totals, issuer: string | undefined, top: number, withReceiver: boolean): void {
  const half = contentWidth(doc) / 2;
  let y = top;
  doc.font('bold').fontSize(BODY_SIZE + 0.5).fillColor(INK).text('Всього на суму:', MARGIN_X, y, { width: half - 10 });
  doc.font('regular').fontSize(BODY_SIZE + 0.5).text(amountInWords(totals.total), MARGIN_X, doc.y, { width: half - 10 });
  if (totals.vatRate) doc.text(`ПДВ: ${amountInWords(totals.vat)}`, MARGIN_X, doc.y, { width: half - 10 });
  else doc.text('Без ПДВ', MARGIN_X, doc.y, { width: half - 10 });
  let leftBottom = doc.y;

  signatureLine(doc, 'Виписав:', issuer ?? '', MARGIN_X + half + 10, right(doc), top + 16);

  if (withReceiver) {
    leftBottom += 24;
    signatureLine(doc, 'Отримано:', '', MARGIN_X, MARGIN_X + half - 40, leftBottom);
    leftBottom += 30;
    signatureLine(doc, 'ПІБ:', '', MARGIN_X, MARGIN_X + half - 40, leftBottom);
    leftBottom += 12;
  }
  y = Math.max(leftBottom, top + 30) + 22;
  rule(doc, y);
}

// «Виписав: ____________ Полтавський Д.О.» between x1 and x2: label, a line to sign on, the name.
function signatureLine(doc: Doc, label: string, name: string, x1: number, x2: number, y: number): void {
  doc.font('regular').fontSize(BODY_SIZE).fillColor(INK);
  const labelWidth = doc.widthOfString(label);
  const nameWidth = name ? doc.widthOfString(name) : 0;
  doc.text(label, x1, y, { lineBreak: false });
  if (name) doc.text(name, x2 - nameWidth, y, { lineBreak: false });
  const lineY = y + BODY_SIZE + 1;
  const start = x1 + labelWidth + 6;
  const end = name ? x2 - nameWidth - 6 : x2;
  doc.save().moveTo(start, lineY).lineTo(end, lineY).lineWidth(0.6).strokeColor(INK).stroke().restore();
}

export function toBuffer(doc: Doc): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}
