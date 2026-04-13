/**
 * Proforma-style billing document HTML for invoice / receipt PDFs (html2pdf).
 */

const HEADER_BLUE = '#5B9BD5';

const ones = [
  '', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen',
];
const tens = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

function convertBelowThousand(num) {
  if (!num) return '';
  if (num < 20) return ones[num];
  const t = Math.floor(num / 10);
  const o = num % 10;
  return tens[t] + (o ? ` ${ones[o]}` : '');
}

function convertHundreds(num) {
  if (!num) return '';
  if (num < 100) return convertBelowThousand(num);
  const h = Math.floor(num / 100);
  const rest = num % 100;
  return `${ones[h]} hundred${rest ? ` ${convertBelowThousand(rest)}` : ''}`;
}

export function rupeesToWordsINR(amount) {
  const n = Math.round(Number(amount) * 100) / 100;
  let rupees = Math.floor(n);
  const paise = Math.round((n - rupees) * 100);

  if (rupees === 0 && paise === 0) return 'ZERO RUPEES ONLY';

  const parts = [];
  const crores = Math.floor(rupees / 10000000);
  rupees %= 10000000;
  const lakhs = Math.floor(rupees / 100000);
  rupees %= 100000;
  const thousands = Math.floor(rupees / 1000);
  rupees %= 1000;

  if (crores) parts.push(`${convertHundreds(crores)} crore`);
  if (lakhs) parts.push(`${convertHundreds(lakhs)} lakh`);
  if (thousands) parts.push(`${convertHundreds(thousands)} thousand`);
  if (rupees) parts.push(convertHundreds(rupees));

  let words = `${parts.join(' ').replace(/\s+/g, ' ').trim()} rupees`;
  if (paise > 0) words += ` and ${convertHundreds(paise)} paise`;
  words += ' only';
  return words.toUpperCase();
}

export function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function formatDateDDMMYYYY(dateString) {
  if (!dateString) return 'N/A';
  const d = new Date(dateString);
  if (Number.isNaN(d.getTime())) return 'N/A';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function formatMoneyINR(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  return new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value));
}

/**
 * @param {object} opts
 * @param {string} opts.logoUrl - resolved asset URL for img src
 * @param {'invoice'|'receipt'} opts.kind
 * @param {object} opts.transaction - payment row
 * @param {number} opts.amountRupees - amount in rupees (not paise)
 * @param {object} opts.company - { name, lines: string[] }
 * @param {object} opts.customer - { name, lines: string[] }
 */
export function buildProformaBillingHtml({
  logoUrl,
  kind,
  transaction,
  amountRupees,
  company,
  customer,
}) {
  const docTitle = kind === 'invoice' ? 'TAX INVOICE' : 'PAYMENT RECEIPT';
  const detailHeader = kind === 'invoice' ? 'INVOICE DETAILS' : 'RECEIPT DETAILS';
  const refLabel = kind === 'invoice' ? 'INVOICE NO' : 'RECEIPT NO';
  const refValue =
    kind === 'invoice'
      ? escapeHtml(`INV-${String(transaction.razorpay_payment_id || transaction.id || '').slice(-12)}`)
      : escapeHtml(transaction.razorpay_payment_id || transaction.id || 'N/A');

  const gstRate = 18;
  const total = Number(amountRupees) || 0;
  const taxable = total > 0 ? total / (1 + gstRate / 100) : 0;
  const gstAmt = total - taxable;
  const subTotal = taxable;
  const discount = 0;
  const shipping = 0;
  const grandTotal = total;
  const qty = 1;

  const planLabel = escapeHtml(transaction.plan_name || 'Subscription Payment');
  const payMethod = escapeHtml(transaction.payment_method || 'N/A');
  const orderId = escapeHtml(transaction.razorpay_order_id || 'N/A');
  const status = escapeHtml(transaction.payment_status || 'N/A');
  const dateStr = formatDateDDMMYYYY(transaction.payment_date);

  const companyName = escapeHtml(company?.name || 'JuriNex');
  const companyLines = (company?.lines || []).map(escapeHtml);
  const customerName = escapeHtml(customer?.name || 'Customer');
  const customerLines = (customer?.lines || []).map(escapeHtml);

  const amountWords = rupeesToWordsINR(grandTotal);
  const totalQty = qty;

  const cell = 'border:1px solid #000;padding:6px 8px;font-size:10px;vertical-align:top;';
  const th = `${cell}font-weight:bold;background:#f0f0f0;text-align:center;`;

  return `
<div style="font-family:Arial,Helvetica,sans-serif;color:#111;font-size:10px;position:relative;padding:20px 24px 28px;box-sizing:border-box;width:100%;max-width:820px;margin:0 auto;background:#fff;">
  <div style="position:absolute;left:50%;top:42%;transform:translate(-50%,-50%);font-size:100px;color:#bbb;opacity:0.12;pointer-events:none;white-space:nowrap;">₹</div>

  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:4px;position:relative;z-index:1;">
    <div style="flex:1;min-width:0;padding-right:12px;">
      <h1 style="margin:0;font-size:24px;font-weight:bold;color:${HEADER_BLUE};letter-spacing:0.5px;">${docTitle}</h1>
      <div style="margin-top:6px;height:2px;background:${HEADER_BLUE};width:82%;max-width:420px;"></div>
    </div>
    <div style="text-align:right;flex-shrink:0;">
      <img src="${logoUrl}" alt="JuriNex" crossorigin="anonymous" style="height:50px;width:auto;max-width:150px;object-fit:contain;display:block;" />
    </div>
  </div>

  <table style="width:100%;border-collapse:collapse;margin-top:18px;position:relative;z-index:1;">
    <tr>
      <td style="width:50%;vertical-align:top;padding:8px 10px 8px 0;">
        <div style="font-weight:bold;margin-bottom:8px;font-size:11px;">YOUR COMPANY NAME</div>
        <div style="font-weight:bold;margin-bottom:4px;">${companyName}</div>
        ${companyLines.map((line) => `<div>${line || '—'}</div>`).join('')}
      </td>
      <td style="width:50%;vertical-align:top;padding:8px 0 8px 10px;border-left:1px solid #ccc;">
        <div style="font-weight:bold;margin-bottom:8px;font-size:11px;">PARTY DETAIL'S</div>
        <div style="margin-bottom:4px;"><strong>CUSTOMER'S NAME:</strong> ${customerName}</div>
        ${customerLines.map((line) => `<div>${line || '—'}</div>`).join('')}
      </td>
    </tr>
  </table>

  <table style="width:100%;border-collapse:collapse;margin-top:14px;position:relative;z-index:1;">
    <tr>
      <td style="width:50%;vertical-align:top;padding:8px 10px 8px 0;">
        <div style="font-weight:bold;margin-bottom:8px;font-size:11px;">${detailHeader}</div>
        <div><strong>${refLabel}:</strong> ${refValue}</div>
        <div><strong>DATE:</strong> ${dateStr}</div>
        <div><strong>ORDER ID:</strong> ${orderId}</div>
        <div><strong>PAYMENT METHOD:</strong> ${payMethod}</div>
        <div><strong>STATUS:</strong> ${status}</div>
        <div><strong>TRANSPORTATION NAME:</strong> —</div>
        <div><strong>E-WAY BILL NO:</strong> —</div>
      </td>
      <td style="width:50%;vertical-align:top;padding:8px 0 8px 10px;border-left:1px solid #ccc;">
        <div style="font-weight:bold;margin-bottom:8px;font-size:11px;">SHIPPING DETAILS</div>
        <div><strong>STREET ADDRESS:</strong> —</div>
        <div><strong>CITY / DIST / STATE / PIN:</strong> —</div>
        <div><strong>PHONE NO:</strong> —</div>
      </td>
    </tr>
  </table>

  <table style="width:100%;border-collapse:collapse;margin-top:16px;position:relative;z-index:1;">
    <thead>
      <tr>
        <th style="${th}text-align:left;">ITEMS</th>
        <th style="${th}">QUANTITY</th>
        <th style="${th}">UNIT</th>
        <th style="${th}">PRICE/UNIT (₹)</th>
        <th style="${th}">GST RATE (%)</th>
        <th style="${th}">GST AMOUNT (₹)</th>
        <th style="${th}">TOTAL AMOUNT (₹)</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td style="${cell}">${planLabel}</td>
        <td style="${cell};text-align:center;">${qty}</td>
        <td style="${cell};text-align:center;">—</td>
        <td style="${cell};text-align:right;">${formatMoneyINR(subTotal)}</td>
        <td style="${cell};text-align:center;">${gstRate}</td>
        <td style="${cell};text-align:right;">${formatMoneyINR(gstAmt)}</td>
        <td style="${cell};text-align:right;font-weight:bold;">${formatMoneyINR(grandTotal)}</td>
      </tr>
    </tbody>
  </table>

  <table style="width:100%;border-collapse:collapse;margin-top:14px;position:relative;z-index:1;">
    <tr>
      <td style="vertical-align:top;padding:6px 8px 0 0;width:55%;">
        <div style="margin-bottom:6px;"><strong>TOTAL QUANTITY :</strong> ${totalQty}</div>
        <div style="line-height:1.35;"><strong>AMOUNT IN WORDS :</strong> <span style="font-weight:bold;">${escapeHtml(amountWords)}</span></div>
      </td>
      <td style="vertical-align:top;width:45%;">
        <table style="width:100%;border-collapse:collapse;font-size:10px;">
          <tr><td style="border:1px solid #000;padding:5px 8px;"><strong>SUB TOTAL</strong></td><td style="border:1px solid #000;padding:5px 8px;text-align:right;">₹ ${formatMoneyINR(subTotal)}</td></tr>
          <tr><td style="border:1px solid #000;padding:5px 8px;"><strong>DISCOUNT</strong></td><td style="border:1px solid #000;padding:5px 8px;text-align:right;">₹ ${formatMoneyINR(discount)}</td></tr>
          <tr><td style="border:1px solid #000;padding:5px 8px;"><strong>SHIPPING CHARGES</strong></td><td style="border:1px solid #000;padding:5px 8px;text-align:right;">₹ ${formatMoneyINR(shipping)}</td></tr>
          <tr><td style="border:1px solid #000;padding:7px 8px;font-size:12px;"><strong>GRAND TOTAL</strong></td><td style="border:1px solid #000;padding:7px 8px;text-align:right;font-size:12px;font-weight:bold;">₹ ${formatMoneyINR(grandTotal)}</td></tr>
        </table>
      </td>
    </tr>
  </table>

  <table style="width:100%;border-collapse:collapse;margin-top:18px;position:relative;z-index:1;">
    <tr>
      <td style="width:50%;vertical-align:top;padding-right:8px;">
        <div style="border:1px solid #000;min-height:72px;padding:8px;">
          <strong>TERMS &amp; CONDITIONS :</strong>
          <div style="margin-top:6px;color:#333;">Payment processed digitally. For billing queries, contact JuriNex support. GST shown is indicative (18% inclusive split).</div>
        </div>
      </td>
      <td style="width:50%;vertical-align:top;padding-left:8px;">
        <div style="border:1px solid #000;min-height:72px;padding:8px;text-align:center;">
          <strong>SEAL &amp; SIGNATURE</strong>
        </div>
      </td>
    </tr>
  </table>

  <p style="text-align:center;font-style:italic;margin:16px 0 10px;color:#333;position:relative;z-index:1;">Thanks for doing business with us. Please visit us again !!!</p>
  <div style="border-top:1px solid #999;padding-top:8px;margin-top:4px;position:relative;z-index:1;">
    <div style="font-size:9px;color:#555;"><strong>DISCLAIMER :</strong> This is a computer generated ${kind === 'invoice' ? 'invoice' : 'receipt'}. The amount shown is digitally calculated.</div>
    <div style="display:flex;justify-content:flex-end;align-items:center;margin-top:8px;gap:8px;">
      <span style="font-size:9px;color:#666;">Powered by</span>
      <img src="${logoUrl}" alt="JuriNex" crossorigin="anonymous" style="height:28px;width:auto;max-width:100px;object-fit:contain;" />
    </div>
  </div>
</div>
`.trim();
}

export function getDefaultCompanyLines() {
  return [
    'Digital legal technology platform',
    'India',
    'support@jurinex.com',
  ];
}

export function getCustomerLinesFromUserInfo(userInfo) {
  if (!userInfo || typeof userInfo !== 'object') return [];
  const lines = [];
  if (userInfo.email) lines.push(`EMAIL: ${userInfo.email}`);
  if (userInfo.phone || userInfo.mobile) lines.push(`PHONE NO: ${userInfo.phone || userInfo.mobile}`);
  return lines;
}
