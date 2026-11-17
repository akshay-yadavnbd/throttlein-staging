/** GST invoice PDF rendering (pdfkit): layout, tax table, amount in words. Input is the data buildInvoiceData() computes. */
const path = require('path');
const PDFDocument = require('pdfkit');

const LOGO = path.join(__dirname, '..', '..', '..', 'assets', 'throttlein-logo.png');

/* ─────────────── amount in words (Indian numbering) ─────────────── */

const ONES = [
  '',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
  'Thirteen',
  'Fourteen',
  'Fifteen',
  'Sixteen',
  'Seventeen',
  'Eighteen',
  'Nineteen',
];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function belowThousand(n) {
  const out = [];
  if (n >= 100) {
    out.push(`${ONES[Math.floor(n / 100)]} Hundred`);
    n %= 100;
  }
  if (n >= 20) {
    out.push(TENS[Math.floor(n / 10)] + (n % 10 ? ` ${ONES[n % 10]}` : ''));
  } else if (n) out.push(ONES[n]);
  return out.join(' ');
}

function integerWords(n) {
  if (n === 0) return 'Zero';
  const parts = [];
  for (const [size, name] of /** @type {Array<[number, string]>} */ ([
    [1e7, 'Crore'],
    [1e5, 'Lakh'],
    [1e3, 'Thousand'],
  ])) {
    if (n >= size) {
      const chunk = Math.floor(n / size);
      parts.push(`${size === 1e7 ? integerWords(chunk) : belowThousand(chunk)} ${name}`);
      n %= size;
    }
  }
  if (n) parts.push(belowThousand(n));
  return parts.join(' ');
}

/** 1499.5 → "Rupees One Thousand Four Hundred Ninety Nine and Fifty Paise Only" */
function amountInWords(amount) {
  const paise = Math.round(Number(amount) * 100);
  const rupees = Math.floor(paise / 100);
  const rest = paise % 100;
  return `Rupees ${integerWords(rupees)}${rest ? ` and ${belowThousand(rest)} Paise` : ''} Only`;
}

/* ─────────────────────────────── PDF ─────────────────────────────── */

const money = (n) => `Rs. ${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const plain = (n) => Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (d) =>
  d
    ? new Date(d).toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        timeZone: 'Asia/Kolkata',
      })
    : '';

const INK = '#141414';
const MUTED = '#5c5c5c';
const RULE = '#d9d9d9';
const TINT = '#f4f4f4';

/** @returns {Promise<Buffer>} */
function renderPdf(inv) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 40,
      info: {
        Title: `${inv.title === 'TAX INVOICE' ? 'Tax invoice' : 'Bill of supply'} ${inv.number}`,
        Author: inv.seller.name || 'Throttlein',
      },
    });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const left = doc.page.margins.left;
    const width = doc.page.width - left - doc.page.margins.right;
    const right = left + width;
    const bottom = doc.page.height - doc.page.margins.bottom;

    /* Header: logo left, title + invoice facts right. */
    try {
      doc.image(LOGO, left, 40, { width: 150 });
    } catch {
      doc.font('Helvetica-Bold').fontSize(20).fillColor(INK).text('THROTTLEIN', left, 44);
    }
    doc.font('Helvetica-Bold').fontSize(16).fillColor(INK).text(inv.title, left, 40, { width, align: 'right' });
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor(MUTED)
      .text('Original for recipient', left, 60, { width, align: 'right' });

    let y = 92;
    doc.moveTo(left, y).lineTo(right, y).lineWidth(1).strokeColor(INK).stroke();
    y += 12;

    const facts = [
      ['Invoice no.', inv.number],
      ['Invoice date', fmtDate(inv.date)],
      ['Order no.', inv.orderNumber],
      ['Order date', fmtDate(inv.orderDate)],
      ['Payment', inv.payment],
      ['Place of supply', inv.placeOfSupply],
    ];
    const colW = width / 3;
    facts.forEach(([label, value], i) => {
      const x = left + (i % 3) * colW;
      const fy = y + Math.floor(i / 3) * 26;
      doc
        .font('Helvetica')
        .fontSize(7.5)
        .fillColor(MUTED)
        .text(label.toUpperCase(), x, fy, { width: colW - 8 });
      doc
        .font('Helvetica-Bold')
        .fontSize(9.5)
        .fillColor(INK)
        .text(value || '-', x, fy + 10, { width: colW - 8 });
    });
    y += 58;

    /* Parties. */
    const half = (width - 20) / 2;
    const party = (x, heading, lines) => {
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor(MUTED).text(heading, x, y, { width: half });
      let py = y + 12;
      lines.filter(Boolean).forEach(([text, bold], i) => {
        doc
          .font(bold ? 'Helvetica-Bold' : 'Helvetica')
          .fontSize(i === 0 ? 10.5 : 8.5)
          .fillColor(INK);
        doc.text(text, x, py, { width: half });
        py = doc.y + 2;
      });
      return py;
    };
    const sellerEnd = party(left, 'SOLD BY', [
      [inv.seller.name, true],
      inv.seller.address && [inv.seller.address],
      inv.seller.state && [`State: ${inv.seller.state}`],
      [inv.registered ? `GSTIN: ${inv.seller.gstin}` : 'Not registered under GST'],
    ]);
    const buyerEnd = party(left + half + 20, 'BILL TO / SHIP TO', [
      [inv.customer.name, true],
      inv.customer.address && [inv.customer.address],
    ]);
    y = Math.max(sellerEnd, buyerEnd) + 14;

    /* Line items. */
    /** @type {Array<[string, number, string]>} */
    const cols = inv.registered
      ? [
          ['#', 18, 'left'],
          ['Item', 150, 'left'],
          ['HSN', 50, 'left'],
          ['Qty', 24, 'right'],
          ['Unit price', 58, 'right'],
          ['Taxable value', 68, 'right'],
          ['GST', 82, 'right'],
          ['Total', 65, 'right'],
        ]
      : [
          ['#', 18, 'left'],
          ['Item', 255, 'left'],
          ['HSN', 50, 'left'],
          ['Qty', 30, 'right'],
          ['Unit price', 80, 'right'],
          ['Total', 82, 'right'],
        ];
    const headerRow = () => {
      doc.font('Helvetica-Bold').fontSize(7.5);
      const heights = cols.map(([label, w]) => doc.heightOfString(label.toUpperCase(), { width: w - 8 }));
      const bandH = Math.max(...heights) + 12;
      doc.rect(left, y, width, bandH).fill(TINT);
      let x = left;
      cols.forEach(([label, w, align], i) => {
        doc.fillColor(INK).text(label.toUpperCase(), x + 4, y + (bandH - heights[i]) / 2, { width: w - 8, align });
        x += w;
      });
      y += bandH + 6;
    };
    headerRow();

    inv.rows.forEach((r, i) => {
      const itemW = cols[1][1] - 8;
      doc.font('Helvetica-Bold').fontSize(8.5);
      const nameH = doc.heightOfString(r.description, { width: itemW });
      doc.font('Helvetica').fontSize(7.5);
      const detailH = r.detail ? doc.heightOfString(r.detail, { width: itemW }) + 2 : 0;
      const gstText = inv.intra
        ? `CGST ${r.rate / 2}%  ${plain(r.cgst)}\nSGST ${r.rate / 2}%  ${plain(r.sgst)}`
        : `IGST ${r.rate}%  ${plain(r.igst)}`;
      const rowH = Math.max(nameH + detailH, inv.registered ? 20 : 10) + 10;
      if (y + rowH > bottom - 170) {
        doc.addPage();
        y = doc.page.margins.top;
        headerRow();
      }

      const cells = inv.registered
        ? [
            String(i + 1),
            null,
            r.hsn || '-',
            String(r.qty),
            plain(r.unitPrice),
            plain(r.taxable),
            gstText,
            plain(r.gross),
          ]
        : [String(i + 1), null, r.hsn || '-', String(r.qty), plain(r.unitPrice), plain(r.gross)];
      let x = left;
      cols.forEach(([, w, align], c) => {
        if (c === 1) {
          doc
            .font('Helvetica-Bold')
            .fontSize(8.5)
            .fillColor(INK)
            .text(r.description, x + 4, y, { width: itemW });
          if (r.detail)
            doc
              .font('Helvetica')
              .fontSize(7.5)
              .fillColor(MUTED)
              .text(r.detail, x + 4, y + nameH + 2, { width: itemW });
        } else {
          const small = inv.registered && c === 6; // the two-line GST breakdown
          doc
            .font('Helvetica')
            .fontSize(small ? 7.5 : 8.5)
            .fillColor(INK)
            .text(cells[c], x + 4, y, { width: w - 8, align, lineGap: small ? 1 : 0 });
        }
        x += w;
      });
      y += rowH;
      doc
        .moveTo(left, y - 5)
        .lineTo(right, y - 5)
        .lineWidth(0.5)
        .strokeColor(RULE)
        .stroke();
    });

    /* Totals. */
    y += 6;
    const labelX = left + width - 250;
    const totalLine = (label, value, bold) => {
      doc
        .font(bold ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(bold ? 11 : 9)
        .fillColor(INK);
      doc.text(label, labelX, y, { width: 150 });
      doc.text(value, labelX + 150, y, { width: 100, align: 'right' });
      y += bold ? 18 : 14;
    };
    if (inv.registered) {
      totalLine('Taxable value', money(inv.totals.taxable));
      if (inv.intra) {
        totalLine('CGST', money(inv.totals.cgst));
        totalLine('SGST', money(inv.totals.sgst));
      } else {
        totalLine('IGST', money(inv.totals.igst));
      }
    }
    doc.moveTo(labelX, y).lineTo(right, y).lineWidth(1).strokeColor(INK).stroke();
    y += 6;
    totalLine(inv.registered ? 'Total (incl. GST)' : 'Total', money(inv.totals.gross), true);
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor(MUTED)
      .text(amountInWords(inv.totals.gross), left, y + 2, { width });
    y = doc.y + 16;

    /* Declarations + signature. */
    const notes = inv.registered
      ? ['Prices are inclusive of GST. Tax is not payable on reverse charge basis.']
      : ['The seller is not registered under GST, so no GST is charged on this supply.'];
    notes.push(
      `Sold via the Throttlein marketplace. For help with this order write to ${inv.supportEmail}, quoting ${inv.orderNumber}.`,
    );
    doc.font('Helvetica').fontSize(8).fillColor(MUTED);
    for (const n of notes) {
      doc.text(n, left, y, { width: width - 200 });
      y = doc.y + 4;
    }

    const sigY = Math.max(y + 10, doc.y + 10);
    doc
      .font('Helvetica-Bold')
      .fontSize(8.5)
      .fillColor(INK)
      .text(`For ${inv.seller.name}`, right - 190, sigY, { width: 190, align: 'right' });
    doc
      .font('Helvetica')
      .fontSize(7.5)
      .fillColor(MUTED)
      .text('Authorised signatory', right - 190, sigY + 30, { width: 190, align: 'right' })
      .text('Computer-generated document; no signature required.', right - 190, sigY + 41, {
        width: 190,
        align: 'right',
      });

    doc.end();
  });
}

module.exports = { amountInWords, renderPdf };
