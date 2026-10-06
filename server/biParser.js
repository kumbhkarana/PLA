'use strict';
/* Turns the BI HTML returned by the SUD Life portal into structured data and a customer summary. */

const ENTITIES = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'", rsquo: '’', lsquo: '‘', ndash: '–', mdash: '—', rupee: '₹' };

function decode(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ENTITIES[e.toLowerCase()] !== undefined ? ENTITIES[e.toLowerCase()] : m;
  });
}

function text(html) {
  return decode(html.replace(/<br\s*\/?>/gi, ' ').replace(/<\/p>/gi, ' ').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
}

function toNumber(s) {
  if (s == null) return null;
  const t = String(s).replace(/,/g, '').trim();
  return /^-?\d+(\.\d+)?$/.test(t) ? parseFloat(t) : null;
}

// Split HTML into innermost tables (nested tables are flattened by taking leaf tables only).
function leafTables(html) {
  const out = [];
  const re = /<table\b[^>]*>((?:(?!<table\b)[\s\S])*?)<\/table>/gi;
  let m;
  while ((m = re.exec(html))) out.push(m[1]);
  return out;
}

// Build a 2-D grid from a table, honouring rowspan/colspan. Each cell: { text, header, origin }.
function grid(tableHtml) {
  const rows = [];
  const trRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  const cellRe = /<(t[hd])\b([^>]*)>([\s\S]*?)<\/t[hd]>/gi;
  let tr;
  let r = 0;
  while ((tr = trRe.exec(tableHtml))) {
    rows[r] = rows[r] || [];
    let c = 0;
    let cm;
    cellRe.lastIndex = 0;
    while ((cm = cellRe.exec(tr[1]))) {
      while (rows[r][c]) c++;
      const attrs = cm[2];
      const rs = parseInt((attrs.match(/rowspan\s*=\s*"?(\d+)/i) || [])[1] || '1', 10);
      const cs = parseInt((attrs.match(/colspan\s*=\s*"?(\d+)/i) || [])[1] || '1', 10);
      const cell = { text: text(cm[3]), header: cm[1].toLowerCase() === 'th', id: r + ':' + c };
      for (let i = 0; i < rs; i++) {
        rows[r + i] = rows[r + i] || [];
        for (let j = 0; j < cs; j++) rows[r + i][c + j] = cell;
      }
      c += cs;
    }
    r++;
  }
  return rows.filter(Boolean);
}

function uniqueCells(row) {
  const seen = new Set();
  return row.filter((c) => c && !seen.has(c.id) && seen.add(c.id));
}

// Label/value pairs from the summary tables ("Policy Term: | 20", "Policy Option | Goal Plus | Bonus Type | ...").
function keyValues(tables) {
  const info = {};
  tables.forEach((t) => {
    if (/policy\s*year/i.test(t)) return; // the benefit table is parsed separately
    grid(t).forEach((row) => {
      const cells = uniqueCells(row).map((c) => c.text).filter(Boolean);
      if (cells.length < 2 || cells.length > 6 || cells.every((c) => toNumber(c) !== null)) return;
      for (let i = 0; i + 1 < cells.length; i += 2) {
        const k = cells[i].replace(/[:\s]+$/, '');
        if (!k || toNumber(k) !== null || k.length > 80) continue;
        if (!(k in info)) info[k] = cells[i + 1];
      }
    });
  });
  return info;
}

// The year-wise benefit table: header rows give column labels, data rows start with the policy year.
function benefitTable(tables) {
  for (const t of tables) {
    const g = grid(t);
    const headerIdx = g.findIndex((row) => row.some((c) => c && /policy\s*year/i.test(c.text)));
    if (headerIdx === -1) continue;

    const dataRows = [];
    let lastHeader = headerIdx;
    g.forEach((row, i) => {
      if (i <= headerIdx) return;
      const first = row[0] && row[0].text;
      const isYear = /^\d{1,3}$/.test(first || '') && !row[0].header;
      const numeric = row.filter((c) => c && toNumber(c.text) !== null).length;
      if (isYear && numeric >= 3) dataRows.push(row);
      else if (!dataRows.length) lastHeader = i;
    });
    if (dataRows.length < 2) continue;

    const width = Math.max(...dataRows.map((r) => r.length));
    const columns = [];
    for (let c = 0; c < width; c++) {
      const parts = [];
      for (let r = headerIdx; r <= lastHeader; r++) {
        const cell = g[r] && g[r][c];
        if (!cell || !cell.text || /^\d+[a-z]?$/i.test(cell.text)) continue; // skip "1 2 3 … 10a" index rows
        if (parts[parts.length - 1] !== cell.text) parts.push(cell.text);
      }
      columns.push(parts.join(' › '));
    }
    const rows = dataRows.map((r) => r.slice(0, width).map((c) => (c ? toNumber(c.text) : null)));
    return { columns, rows };
  }
  return null;
}

function parse(html) {
  const tables = leafTables(html);
  return { info: keyValues(tables), table: benefitTable(tables) };
}

// ---------- customer summary ----------
function findCol(columns, test) {
  return columns.findIndex((c) => test(c.toLowerCase()));
}

function colValues(table, idx) {
  return idx === -1 ? [] : table.rows.map((r) => r[idx] || 0);
}

function infoValue(info, re) {
  const k = Object.keys(info).find((x) => re.test(x));
  return k ? info[k] : null;
}

function summarize(parsed) {
  const info = parsed.info;
  const t = parsed.table;
  const s = {
    customerName: infoValue(info, /name of (the )?life assured/i) || infoValue(info, /name of prospect/i),
    age: toNumber(infoValue(info, /^age/i)),
    policyTerm: toNumber(infoValue(info, /^policy term/i)),
    ppt: toNumber(infoValue(info, /premium pay(ing|ment) term/i)),
    mode: infoValue(info, /mode of payment/i),
    installmentPremium: toNumber(infoValue(info, /instal+ment premium/i)),
    planOption: infoValue(info, /^(policy|plan|benefit) option/i),
    uin: infoValue(info, /unique identification/i),
    tagLine: infoValue(info, /tag line/i),
    sumAssured: toNumber(infoValue(info, /^sum assured( on death)?( rs\.?)?$/i)),
    maturityGuaranteed: toNumber(infoValue(info, /sum assured (at|on) maturity/i))
  };
  if (!t) return s;

  const cols = t.columns;
  const last = t.rows[t.rows.length - 1];
  const isG = (c) => /^guaranteed/.test(c) && !/non\s*-?\s*guaranteed/.test(c);

  const iPrem = findCol(cols, (c) => /annuali[sz]ed premium|annual premium/.test(c));
  const iSurv = findCol(cols, (c) => isG(c) && /survival|income|payout/.test(c));
  const iDeath = findCol(cols, (c) => isG(c) && /death/.test(c));
  const iMat = findCol(cols, (c) => isG(c) && /maturity/.test(c));
  const iMat4 = findCol(cols, (c) => /total/.test(c) && /maturity/.test(c) && /4\s*%/.test(c));
  const iMat8 = findCol(cols, (c) => /total/.test(c) && /maturity/.test(c) && /8\s*%/.test(c));
  const iCash4 = findCol(cols, (c) => /4\s*%/.test(c) && /cash bonus/.test(c));
  const iCash8 = findCol(cols, (c) => /8\s*%/.test(c) && /cash bonus/.test(c));

  const prem = colValues(t, iPrem);
  const surv = colValues(t, iSurv);
  const sum = (a) => a.reduce((x, y) => x + (y || 0), 0);

  s.years = t.rows.map((r) => r[0]);
  s.premiums = prem;
  s.totalPremium = sum(prem) || null;
  s.annualPremium = prem.find((v) => v > 0) || null;
  if (!s.ppt) s.ppt = prem.filter((v) => v > 0).length || null;
  if (!s.policyTerm) s.policyTerm = last[0];
  if (iDeath !== -1) s.sumAssured = t.rows[0][iDeath] || s.sumAssured;

  // Guaranteed regular income (survival benefits).
  const paid = surv.map((v, i) => ({ v, y: t.rows[i][0] })).filter((x) => x.v > 0);
  if (paid.length) {
    const freq = {};
    paid.forEach((x) => { freq[x.v] = (freq[x.v] || 0) + 1; });
    s.incomeYearly = +Object.keys(freq).sort((a, b) => freq[b] - freq[a])[0];
    s.incomeFrom = paid[0].y;
    s.incomeTo = paid[paid.length - 1].y;
    s.incomeTotal = sum(surv);
  }

  const matG = iMat !== -1 ? last[iMat] : null;
  if (matG) s.maturityGuaranteed = matG;
  const cash4 = sum(colValues(t, iCash4));
  const cash8 = sum(colValues(t, iCash8));
  if (iMat4 !== -1) s.maturity4 = last[iMat4];
  if (iMat8 !== -1) s.maturity8 = last[iMat8];

  // Total receivable over the policy: income + cash bonuses + maturity.
  s.totalGuaranteed = (s.incomeTotal || 0) + (s.maturityGuaranteed || 0) || null;
  if (s.maturity4 != null) s.total4 = (s.incomeTotal || 0) + cash4 + s.maturity4;
  if (s.maturity8 != null) s.total8 = (s.incomeTotal || 0) + cash8 + s.maturity8;
  return s;
}

module.exports = { parse, summarize };
