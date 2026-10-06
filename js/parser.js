/* BI PDF parser — pulls the customer-facing figures out of a Benefit Illustration PDF. */
(function () {
  'use strict';

  if (window.pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
  }

  // Read a PDF file into lines; each line is an array of text cells, left to right.
  async function extractLines(file) {
    var data = new Uint8Array(await file.arrayBuffer());
    var pdf = await pdfjsLib.getDocument({ data: data }).promise;
    var lines = [];

    for (var p = 1; p <= pdf.numPages; p++) {
      var page = await pdf.getPage(p);
      var content = await page.getTextContent();
      var rows = [];

      content.items.forEach(function (it) {
        var text = (it.str || '').replace(/\s+/g, ' ');
        if (!text.trim()) return;
        var x = it.transform[4];
        var y = it.transform[5];
        var h = Math.abs(it.transform[3]) || it.height || 8;
        var row = rows.find(function (r) { return Math.abs(r.y - y) <= Math.max(2, h * 0.35); });
        if (!row) { row = { y: y, h: h, items: [] }; rows.push(row); }
        row.items.push({ x: x, w: it.width || text.length * h * 0.5, text: text, h: h });
      });

      rows.sort(function (a, b) { return b.y - a.y; });
      rows.forEach(function (r) {
        r.items.sort(function (a, b) { return a.x - b.x; });
        // Merge items that sit close together into one cell.
        var cells = [];
        var last = null;
        r.items.forEach(function (it) {
          if (last && it.x - (last.x + last.w) < Math.max(3, it.h * 0.6)) {
            last.text += (/\s$/.test(last.text) || /^\s/.test(it.text) ? '' : ' ') + it.text;
            last.w = it.x + it.w - last.x;
          } else {
            last = { x: it.x, w: it.w, text: it.text, h: it.h };
            cells.push(last);
          }
        });
        var texts = cells.map(function (c) { return c.text.trim(); }).filter(Boolean);
        if (texts.length) lines.push({ page: p, cells: texts, text: texts.join(' ') });
      });
    }
    return lines;
  }

  function toNumber(s) {
    if (s == null) return null;
    var m = String(s).replace(/,/g, '').match(/-?\d+(\.\d+)?/);
    return m ? parseFloat(m[0]) : null;
  }

  // Split "Label : Value" text into label and value.
  function splitColon(cell) {
    var i = cell.search(/[:\-–]\s/);
    if (i === -1) i = cell.indexOf(':');
    if (i === -1) return null;
    return { label: cell.slice(0, i).trim(), value: cell.slice(i + 1).replace(/^[\s:\-–]+/, '').trim() };
  }

  // Find the value next to a label: same cell after a colon, the next cell, or the next line.
  function findValue(lines, patterns, opts) {
    opts = opts || {};
    var isValid = opts.numeric
      ? function (v) { return v && toNumber(v) !== null; }
      : function (v) { return v && /[A-Za-z0-9]/.test(v) && !/^[:\-–]$/.test(v); };

    for (var pi = 0; pi < patterns.length; pi++) {
      var re = patterns[pi];
      for (var li = 0; li < lines.length; li++) {
        var cells = lines[li].cells;
        for (var ci = 0; ci < cells.length; ci++) {
          var cell = cells[ci];
          if (!re.test(cell)) continue;
          if (opts.exclude && opts.exclude.test(cell)) continue;

          var sc = splitColon(cell);
          if (sc && re.test(sc.label) && isValid(sc.value)) return sc.value;

          // Value might be the rest of the cell after the label text.
          var rest = cell.replace(re, '').replace(/^[\s:\-–()]+/, '').trim();
          if (opts.numeric && rest && /^(rs\.?|₹|inr)?\s*[\d,]+(\.\d+)?/i.test(rest)) return rest;

          for (var nj = ci + 1; nj < cells.length; nj++) {
            var v = cells[nj].replace(/^[:\-–\s]+/, '').trim();
            if (isValid(v)) return v;
          }
          var next = lines[li + 1];
          if (next && next.cells.length <= 2 && isValid(next.cells[0])) return next.cells[0];
        }
      }
    }
    return null;
  }

  var FIELDS = {
    customerName: { patterns: [/name of (the )?life assured/i, /life assured('s)? name/i, /name of (the )?(policy ?holder|proposer)/i, /^name$/i, /^customer name/i] },
    age: { numeric: true, patterns: [/age of (the )?life assured/i, /life assured('s)? age/i, /entry age/i, /^age\b/i] },
    gender: { patterns: [/gender of (the )?life assured/i, /^gender/i, /^sex\b/i] },
    planOption: { patterns: [/plan option/i, /benefit option/i, /^option\b/i, /^variant/i] },
    policyTerm: { numeric: true, patterns: [/policy term/i], exclude: /premium/i },
    ppt: { numeric: true, patterns: [/premium pay(ing|ment) term/i, /\bppt\b/i] },
    mode: { patterns: [/mode of (premium )?payment/i, /premium (payment )?mode/i, /payment frequency/i, /^mode\b/i] },
    installmentPremium: { numeric: true, patterns: [/instal+ment premium/i, /modal premium/i] },
    annualPremium: { numeric: true, patterns: [/annuali[sz]ed premium/i, /annual premium/i] },
    sumAssured: { numeric: true, patterns: [/sum assured on death/i, /death benefit/i, /basic sum assured/i, /sum assured/i], exclude: /maturity/i },
    maturityBenefit: { numeric: true, patterns: [/maturity benefit/i, /sum assured on maturity/i, /guaranteed maturity/i] },
    incomeBenefit: { numeric: true, patterns: [/guaranteed (annual )?income/i, /annual income/i, /income benefit/i, /survival benefit/i] },
    incomePeriod: { numeric: true, patterns: [/income (benefit )?period/i, /payout period/i] }
  };

  var MODE_FACTORS = { annual: 1, yearly: 1, 'half-yearly': 2, 'half yearly': 2, semi: 2, quarterly: 4, monthly: 12 };

  // Year-wise benefit table: find rows that start with a policy year followed by numbers.
  function parseTable(lines) {
    var headerIdx = lines.findIndex(function (l) { return /policy\s*year/i.test(l.text); });
    if (headerIdx === -1) return null;
    var rows = [];
    for (var i = headerIdx + 1; i < lines.length; i++) {
      var cells = lines[i].cells;
      var year = /^\d{1,3}$/.test(cells[0]) ? parseInt(cells[0], 10) : NaN;
      var nums = cells.map(toNumber);
      if (!isNaN(year) && nums.filter(function (n) { return n !== null; }).length >= 3) {
        if (rows.length && year !== rows[rows.length - 1].year + 1) {
          if (year <= rows[rows.length - 1].year) break; // second table started
        }
        rows.push({ year: year, values: nums.slice(1) });
      }
    }
    return rows.length >= 3 ? rows : null;
  }

  function parseLines(lines) {
    var r = {};
    Object.keys(FIELDS).forEach(function (k) {
      var f = FIELDS[k];
      var raw = findValue(lines, f.patterns, f);
      r[k] = raw == null ? null : (f.numeric ? toNumber(raw) : raw.replace(/\s+/g, ' ').trim());
    });

    // Normalise
    if (r.gender) r.gender = /^f/i.test(r.gender) ? 'Female' : /^m/i.test(r.gender) ? 'Male' : r.gender;
    if (r.customerName) r.customerName = r.customerName.replace(/^(mr|mrs|ms|miss)\.?\s+/i, '').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
    if (r.mode) {
      var mk = Object.keys(MODE_FACTORS).find(function (k) { return r.mode.toLowerCase().indexOf(k) !== -1; });
      r.mode = mk ? ({ 1: 'Annual', 2: 'Half-Yearly', 4: 'Quarterly', 12: 'Monthly' })[MODE_FACTORS[mk]] : r.mode;
    }
    if (!r.annualPremium && r.installmentPremium && r.mode) {
      r.annualPremium = r.installmentPremium * (MODE_FACTORS[r.mode.toLowerCase()] || 1);
    }

    var table = parseTable(lines);
    if (table) {
      r.table = table;
      if (!r.policyTerm) r.policyTerm = table[table.length - 1].year;
    }
    r.rawText = lines.map(function (l) { return l.cells.join(' | '); }).join('\n');
    return r;
  }

  async function parsePdf(file) {
    if (!window.pdfjsLib) throw new Error('PDF reader failed to load.');
    var lines = await extractLines(file);
    if (!lines.length) throw new Error('No readable text in this PDF (it may be a scanned image).');
    return parseLines(lines);
  }

  window.BIParser = { parsePdf: parsePdf, parseLines: parseLines, toNumber: toNumber };
})();
