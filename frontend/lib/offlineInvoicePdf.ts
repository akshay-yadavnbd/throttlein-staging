/**
 * Save a rendered DOM element (the offline-sale invoice sheet) as an A4
 * PDF download.
 *
 * The browser renders the element to a canvas (html-to-image, which
 * handles Tailwind v4's oklch colours); the canvas is encoded as JPEG and
 * wrapped in a minimal hand-written PDF — one image, drawn on as many A4
 * pages as it needs. No PDF library: the format for "one JPEG on a few
 * pages" is small, and it keeps the dependency to html-to-image alone.
 *
 * html-to-image is loaded on demand, so it doesn't weigh down the
 * offline-sales page until someone downloads an invoice.
 */

const MM = 72 / 25.4; // PDF points per millimetre
const PAGE_W = 210 * MM; // A4
const PAGE_H = 297 * MM;
const MARGIN = 10 * MM;

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const num = (n: number) => (Math.round(n * 100) / 100).toString();

/** Build a PDF that shows one JPEG (pxW × pxH) across A4 pages. */
export function buildJpegPdf(jpeg: Uint8Array, pxW: number, pxH: number): Uint8Array {
  const enc = new TextEncoder();
  const imgW = PAGE_W - MARGIN * 2;
  const imgH = (pxH * imgW) / pxW;
  const usableH = PAGE_H - MARGIN * 2;
  const pageCount = Math.max(1, Math.ceil(imgH / usableH - 0.001));

  // Object numbers: 1 catalog, 2 pages, 3 image, then (page, content) pairs.
  const pageObj = (i: number) => 4 + i * 2;
  const contentObj = (i: number) => 5 + i * 2;

  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (part: string | Uint8Array) => {
    const bytes = typeof part === 'string' ? enc.encode(part) : part;
    chunks.push(bytes);
    length += bytes.length;
  };
  const obj = (n: number, body: string | (string | Uint8Array)[]) => {
    offsets[n] = length;
    push(`${n} 0 obj\n`);
    for (const p of Array.isArray(body) ? body : [body]) push(p);
    push('\nendobj\n');
  };

  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(
    2,
    `<< /Type /Pages /Count ${pageCount} /Kids [${Array.from(
      { length: pageCount },
      (_, i) => `${pageObj(i)} 0 R`,
    ).join(' ')}] >>`,
  );
  obj(3, [
    `<< /Type /XObject /Subtype /Image /Width ${pxW} /Height ${pxH} /ColorSpace /DeviceRGB ` +
      `/BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`,
    jpeg,
    '\nendstream',
  ]);

  for (let i = 0; i < pageCount; i++) {
    // Page i shows the slice of the image starting i × usableH from its top;
    // the clip rectangle keeps the margins clean.
    const y = PAGE_H - MARGIN + i * usableH - imgH;
    const content =
      `q ${num(MARGIN)} ${num(MARGIN)} ${num(imgW)} ${num(usableH)} re W n ` +
      `${num(imgW)} 0 0 ${num(imgH)} ${num(MARGIN)} ${num(y)} cm /Im0 Do Q`;
    obj(
      pageObj(i),
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(PAGE_W)} ${num(PAGE_H)}] ` +
        `/Resources << /XObject << /Im0 3 0 R >> >> /Contents ${contentObj(i)} 0 R >>`,
    );
    obj(contentObj(i), `<< /Length ${enc.encode(content).length} >>\nstream\n${content}\nendstream`);
  }

  const total = 4 + pageCount * 2; // objects 0 … total-1
  const xrefAt = length;
  let xref = `xref\n0 ${total}\n0000000000 65535 f \n`;
  for (let n = 1; n < total; n++) xref += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`;
  push(xref);
  push(`trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`);

  const out = new Uint8Array(length);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

export async function saveElementAsPdf(node: HTMLElement, filename: string): Promise<void> {
  const { toCanvas } = await import('html-to-image');
  const canvas = await toCanvas(node, { pixelRatio: 2, backgroundColor: '#ffffff', cacheBust: true });
  // JPEG keeps the file small; the sheet is text on white, so 0.92 stays crisp.
  const jpeg = dataUrlToBytes(canvas.toDataURL('image/jpeg', 0.92));
  const pdf = buildJpegPdf(jpeg, canvas.width, canvas.height);

  const url = URL.createObjectURL(new Blob([pdf as BlobPart], { type: 'application/pdf' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.toLowerCase().endsWith('.pdf') ? filename : `${filename}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
