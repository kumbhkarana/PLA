/* BIMO — app flow: login → home → generate BI → illustration. */
(function () {
  'use strict';

  var CFG = window.BIMO_CONFIG;
  var SESSION_KEY = 'bimo.session';
  var DRAFT_KEY = 'bimo.draft';

  var state = {
    user: null,
    product: null,
    category: 'All',
    data: {}
  };

  // ---------- helpers ----------
  var $ = function (s, el) { return (el || document).querySelector(s); };
  var $$ = function (s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); };

  function store(kind, key, val) {
    try {
      var s = kind === 'local' ? localStorage : sessionStorage;
      if (val === undefined) return JSON.parse(s.getItem(key) || 'null');
      if (val === null) s.removeItem(key); else s.setItem(key, JSON.stringify(val));
    } catch (e) { return null; }
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function num(v) {
    if (v === '' || v == null) return null;
    var n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^\d.\-]/g, ''));
    return isFinite(n) ? n : null;
  }

  function inr(n) {
    if (n == null) return '—';
    return '₹' + Math.round(n).toLocaleString('en-IN');
  }

  function inrShort(n) {
    if (n == null) return '—';
    var a = Math.abs(n);
    if (a >= 1e7) return '₹' + trim(n / 1e7) + ' Cr';
    if (a >= 1e5) return '₹' + trim(n / 1e5) + ' L';
    return inr(n);
  }

  function trim(x) { return (Math.round(x * 100) / 100).toString(); }

  function toast(msg) {
    var t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.hidden = true; }, 2600);
  }

  function bind(key, value) {
    $$('[data-bind="' + key + '"]').forEach(function (el) { el.textContent = value; });
  }

  function show(name) {
    $$('.screen').forEach(function (s) { s.hidden = s.id !== 'screen-' + name; });
    window.scrollTo(0, 0);
  }

  // ---------- auth ----------
  function login(username, code) {
    var u = CFG.users.find(function (x) {
      return x.username.toLowerCase() === username.trim().toLowerCase() && x.code === code.trim();
    });
    if (!u) return false;
    state.user = { name: u.name, tier: u.tier, username: u.username };
    store('session', SESSION_KEY, state.user);
    return true;
  }

  function logout() {
    store('session', SESSION_KEY, null);
    state.user = null;
    state.product = null;
    $('#login-form').reset();
    show('login');
  }

  $('#login-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var err = $('#login-error');
    var u = $('#login-user').value;
    var c = $('#login-code').value;
    if (!u.trim() || !c.trim()) { err.textContent = 'Enter your username and password.'; err.hidden = false; return; }
    if (!login(u, c)) { err.textContent = 'Incorrect username or password.'; err.hidden = false; return; }
    err.hidden = true;
    goHome();
  });

  $('#toggle-pw').addEventListener('click', function () {
    var i = $('#login-code');
    var showing = i.type === 'text';
    i.type = showing ? 'password' : 'text';
    this.textContent = showing ? 'Show' : 'Hide';
  });

  // ---------- home ----------
  function allProducts() {
    var list = [];
    CFG.categories.forEach(function (c) {
      c.products.forEach(function (p) { list.push({ id: p.id, name: p.name, featured: p.featured, category: c.name }); });
    });
    return list;
  }

  function goHome() {
    bind('agentName', state.user.name);
    bind('agentTier', state.user.tier);
    renderChips();
    renderProducts();
    show('home');
  }

  function renderChips() {
    var cats = ['All'].concat(CFG.categories.map(function (c) { return c.name; }));
    $('#category-chips').innerHTML = cats.map(function (c) {
      return '<button class="chip' + (c === state.category ? ' active' : '') + '" role="tab" data-cat="' + esc(c) + '">' +
        esc(c.replace(/ Plans?$| Products$/, '')) + '</button>';
    }).join('');
  }

  function renderProducts() {
    var q = $('#product-search').value.trim().toLowerCase();
    var items = allProducts().filter(function (p) {
      return (state.category === 'All' || p.category === state.category) &&
        (!q || p.name.toLowerCase().indexOf(q) !== -1);
    });
    items.sort(function (a, b) { return (b.featured ? 1 : 0) - (a.featured ? 1 : 0); });

    $('#product-count').textContent = items.length + ' product' + (items.length === 1 ? '' : 's');
    $('#product-list').innerHTML = items.length ? items.map(function (p) {
      var sel = state.product && state.product.id === p.id;
      return '<li><button class="product' + (sel ? ' selected' : '') + '" role="radio" aria-checked="' + sel + '" data-id="' + p.id + '">' +
        '<span class="radio" aria-hidden="true"></span>' +
        '<span class="product-text"><b>' + esc(p.name.replace(/\s+/g, ' ')) + '</b><small>' + esc(p.category) + '</small></span>' +
        (p.featured ? '<span class="tag">Popular</span>' : '') +
        '</button></li>';
    }).join('') : '<li class="empty">No products match “' + esc(q) + '”.</li>';

    $('#btn-continue').disabled = !state.product;
  }

  $('#category-chips').addEventListener('click', function (e) {
    var b = e.target.closest('.chip');
    if (!b) return;
    state.category = b.dataset.cat;
    renderChips();
    renderProducts();
  });

  $('#product-search').addEventListener('input', renderProducts);

  $('#product-list').addEventListener('click', function (e) {
    var b = e.target.closest('.product');
    if (!b) return;
    var id = parseInt(b.dataset.id, 10);
    state.product = allProducts().find(function (p) { return p.id === id; });
    renderProducts();
  });

  function openPortal() {
    // 'noopener' as a feature makes window.open return null, so detach the opener manually.
    var w = window.open(CFG.portal.inputUrl(state.product.id), '_blank');
    if (w) w.opener = null;
    else toast('Allow pop-ups to open the BI portal.');
  }

  $('#btn-continue').addEventListener('click', function () {
    if (!state.product) return;
    openPortal();
    bind('productName', state.product.name.replace(/\s+/g, ' '));
    $('#parse-status').hidden = true;
    show('generate');
  });

  $('#btn-open-portal').addEventListener('click', openPortal);

  // ---------- upload + parse ----------
  function setStatus(msg, kind) {
    var s = $('#parse-status');
    s.textContent = msg;
    s.className = 'status' + (kind ? ' ' + kind : '');
    s.hidden = false;
  }

  async function handleFile(file) {
    if (!file) return;
    if (!/pdf$/i.test(file.type) && !/\.pdf$/i.test(file.name)) { setStatus('Please choose a PDF file.', 'error'); return; }
    setStatus('Reading ' + file.name + '…', 'busy');
    try {
      var parsed = await window.BIParser.parsePdf(file);
      state.data = fromParsed(parsed);
      window.__bimoLastParse = parsed; // handy for debugging new BI formats
      goResult();
    } catch (err) {
      console.error(err);
      setStatus('Could not read this PDF: ' + err.message + ' You can enter the figures manually.', 'error');
    }
  }

  $('#bi-file').addEventListener('change', function () { handleFile(this.files[0]); this.value = ''; });

  var dz = $('#dropzone');
  ['dragenter', 'dragover'].forEach(function (ev) {
    dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.add('over'); });
  });
  ['dragleave', 'drop'].forEach(function (ev) {
    dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.remove('over'); });
  });
  dz.addEventListener('drop', function (e) { handleFile(e.dataTransfer.files[0]); });

  // ---------- illustration data ----------
  var FIELDS = [
    { key: 'customerName', label: 'Customer name', type: 'text' },
    { key: 'age', label: 'Age', type: 'number' },
    { key: 'gender', label: 'Gender', type: 'select', options: ['', 'Male', 'Female', 'Other'] },
    { key: 'planOption', label: 'Plan option', type: 'text' },
    { key: 'policyTerm', label: 'Policy term (years)', type: 'number' },
    { key: 'ppt', label: 'Premium paying term (years)', type: 'number' },
    { key: 'mode', label: 'Premium mode', type: 'select', options: ['', 'Annual', 'Half-Yearly', 'Quarterly', 'Monthly'] },
    { key: 'annualPremium', label: 'Annual premium (₹)', type: 'number' },
    { key: 'sumAssured', label: 'Life cover (₹)', type: 'number' },
    { key: 'incomeBenefit', label: 'Yearly income (₹)', type: 'number' },
    { key: 'incomeStart', label: 'Income starts in year', type: 'number' },
    { key: 'incomePeriod', label: 'Income for (years)', type: 'number' },
    { key: 'maturityBenefit', label: 'Maturity / lump sum (₹)', type: 'number' },
    { key: 'totalBenefit', label: 'Total benefits (₹)', type: 'number', hint: 'auto' }
  ];

  function fromParsed(p) {
    var d = {};
    FIELDS.forEach(function (f) { d[f.key] = p[f.key] == null ? '' : p[f.key]; });
    d.productName = state.product ? state.product.name.replace(/\s+/g, ' ') : '';
    return d;
  }

  // Derived numbers shown on the card.
  function compute(d) {
    var pt = num(d.policyTerm);
    var ppt = num(d.ppt);
    var ap = num(d.annualPremium);
    var inc = num(d.incomeBenefit);
    var start = num(d.incomeStart) || (ppt ? ppt + 1 : null);
    var period = num(d.incomePeriod) || (inc && pt && start ? Math.max(pt - start + 1, 0) : null);
    var mat = num(d.maturityBenefit);
    var totalPaid = ap && ppt ? ap * ppt : null;
    var totalIncome = inc && period ? inc * period : null;
    var autoTotal = (totalIncome || 0) + (mat || 0) || null;
    var total = num(d.totalBenefit) || autoTotal;
    return {
      pt: pt, ppt: ppt, ap: ap, inc: inc, start: start, period: period, mat: mat,
      cover: num(d.sumAssured), totalPaid: totalPaid, total: total, autoTotal: autoTotal,
      multiple: total && totalPaid ? total / totalPaid : null
    };
  }

  function renderIllustration() {
    var d = state.data;
    var c = compute(d);
    var today = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    var who = [d.age ? d.age + ' yrs' : '', d.gender, d.planOption].filter(Boolean).map(esc).join(' · ');

    // Journey bar: pay phase, waiting phase, income phase.
    var journey = '';
    if (c.pt && c.ppt) {
      var incEnd = c.inc && c.start && c.period ? Math.min(c.start + c.period - 1, c.pt) : null;
      var segs = [{ cls: 'pay', from: 1, to: c.ppt, label: 'You pay' }];
      if (incEnd) {
        if (c.start > c.ppt + 1) segs.push({ cls: 'wait', from: c.ppt + 1, to: c.start - 1, label: 'Grows' });
        segs.push({ cls: 'get', from: c.start, to: incEnd, label: 'You receive' });
        if (incEnd < c.pt) segs.push({ cls: 'wait', from: incEnd + 1, to: c.pt, label: 'Covered' });
      } else if (c.pt > c.ppt) {
        segs.push({ cls: 'wait', from: c.ppt + 1, to: c.pt, label: 'Grows' });
      }
      journey = '<div class="illus-section"><div class="illus-label">Your policy journey</div><div class="journey">' +
        segs.map(function (s) {
          var yrs = s.to - s.from + 1;
          return '<div class="seg ' + s.cls + '" style="flex:' + Math.max(yrs, 1) + '"><b>' + s.label + '</b><span>Yr ' + s.from + (yrs > 1 ? '–' + s.to : '') + '</span></div>';
        }).join('') +
        '</div>' + (c.mat ? '<div class="journey-end">+ ' + inrShort(c.mat) + ' at the end of year ' + c.pt + '</div>' : '') + '</div>';
    }

    var tiles = [
      { k: 'Total you pay', v: inrShort(c.totalPaid), s: c.ap && c.ppt ? inr(c.ap) + ' × ' + c.ppt + ' yrs' : '' },
      { k: 'Life cover', v: inrShort(c.cover), s: 'From day one' },
      { k: 'Yearly income', v: c.inc ? inrShort(c.inc) : null, s: c.period ? 'for ' + c.period + ' years' : '' },
      { k: 'Maturity benefit', v: c.mat ? inrShort(c.mat) : null, s: c.pt ? 'in year ' + c.pt : '' },
      { k: 'Policy term', v: c.pt ? c.pt + ' yrs' : null, s: c.ppt ? 'Pay for ' + c.ppt + ' yrs' : '' }
    ].filter(function (t) { return t.v && t.v !== '—'; });

    $('#illustration').innerHTML =
      '<div class="illus-head">' +
        '<img src="assets/logo.svg" alt="" class="illus-logo">' +
        '<div class="illus-titles"><span class="illus-kicker">Benefit Illustration</span><b>' + esc(d.productName || 'Plan summary') + '</b></div>' +
        '<span class="illus-date">' + today + '</span>' +
      '</div>' +
      '<div class="illus-body">' +
        '<div class="illus-customer"><span>Prepared for</span><b>' + esc(d.customerName || 'Valued Customer') + '</b>' + (who ? '<small>' + who + '</small>' : '') + '</div>' +

        '<div class="illus-hero">' +
          '<div class="hero-col"><span>You invest</span><b>' + (c.ap ? inrShort(c.ap) : '—') + '<small>/year</small></b><em>' + (c.ppt ? 'for ' + c.ppt + ' years' : '') + '</em></div>' +
          '<div class="hero-arrow" aria-hidden="true">&rarr;</div>' +
          '<div class="hero-col get"><span>You receive</span><b>' + inrShort(c.total) + '</b><em>' + (c.multiple ? trim(c.multiple) + '× your premiums' : 'total benefits') + '</em></div>' +
        '</div>' +

        '<div class="illus-tiles">' + tiles.map(function (t) {
          return '<div class="tile"><span>' + t.k + '</span><b>' + t.v + '</b><small>' + esc(t.s) + '</small></div>';
        }).join('') + '</div>' +

        journey +
      '</div>' +
      '<div class="illus-foot">' +
        '<div class="advisor"><span>Your advisor</span><b>' + esc(state.user.name) + '</b><small>' + esc(state.user.tier) + '</small></div>' +
        '<p>Figures are taken from the official Benefit Illustration and are indicative. Benefits are subject to policy terms and timely payment of premiums. Please read the full BI and sales brochure before buying.</p>' +
      '</div>';

    var filled = FIELDS.filter(function (f) { return state.data[f.key] !== '' && state.data[f.key] != null; }).length;
    $('#filled-note').textContent = '(' + filled + '/' + FIELDS.length + ' found)';
    store('local', DRAFT_KEY, { data: state.data, product: state.product });
  }

  // Placeholder showing the value BIMO will use when a field is left blank.
  function autoHint(key, c) {
    if (key === 'totalBenefit' && c.autoTotal) return 'Auto: ' + Math.round(c.autoTotal);
    if (key === 'incomeStart' && c.ppt) return 'Auto: ' + (c.ppt + 1);
    if (key === 'incomePeriod' && c.period) return 'Auto: ' + c.period;
    return '';
  }

  function refreshHints() {
    var c = compute(state.data);
    ['totalBenefit', 'incomeStart', 'incomePeriod'].forEach(function (k) {
      var el = $('#details-form [name="' + k + '"]');
      if (el) el.placeholder = autoHint(k, c);
    });
  }

  function renderForm() {
    var c = compute(state.data);
    $('#details-form').innerHTML = FIELDS.map(function (f) {
      var v = state.data[f.key] == null ? '' : state.data[f.key];
      var ph = autoHint(f.key, c);
      var input = f.type === 'select'
        ? '<select name="' + f.key + '">' + f.options.map(function (o) {
            return '<option' + (String(o) === String(v) ? ' selected' : '') + ' value="' + esc(o) + '">' + (o || '—') + '</option>';
          }).join('') + (v && f.options.indexOf(v) === -1 ? '<option selected>' + esc(v) + '</option>' : '') + '</select>'
        : '<input name="' + f.key + '" type="text"' +
          (f.type === 'number' ? ' inputmode="decimal"' : '') + ' value="' + esc(v) + '" placeholder="' + esc(ph) + '">';
      return '<label class="field' + (v === '' ? ' missing' : '') + '"><span>' + f.label + '</span>' + input + '</label>';
    }).join('');
  }

  $('#details-form').addEventListener('input', function (e) {
    var el = e.target;
    if (!el.name) return;
    var f = FIELDS.find(function (x) { return x.key === el.name; });
    state.data[el.name] = f.type === 'number' ? (num(el.value) == null ? '' : num(el.value)) : el.value;
    el.closest('.field').classList.toggle('missing', el.value === '');
    renderIllustration();
    refreshHints();
  });
  $('#details-form').addEventListener('submit', function (e) { e.preventDefault(); });

  function goResult() {
    renderForm();
    renderIllustration();
    var c = compute(state.data);
    $('#editor').open = !(c.ap && c.total);
    $('#btn-share').hidden = !(navigator.canShare && navigator.share);
    show('result');
  }

  // ---------- export ----------
  async function toBlob() {
    var el = $('#illustration');
    el.classList.add('exporting');
    try {
      var canvas = await html2canvas(el, { scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false });
      return await new Promise(function (res) { canvas.toBlob(res, 'image/png'); });
    } finally {
      el.classList.remove('exporting');
    }
  }

  function fileName() {
    var n = (state.data.customerName || 'customer').replace(/[^\w]+/g, '_');
    return 'BI_' + n + '_' + (state.product ? state.product.id : 'plan') + '.png';
  }

  $('#btn-download').addEventListener('click', async function () {
    this.disabled = true;
    try {
      var blob = await toBlob();
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = fileName();
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
      toast('Illustration saved');
    } catch (err) {
      console.error(err);
      toast('Could not create the image.');
    } finally { this.disabled = false; }
  });

  $('#btn-share').addEventListener('click', async function () {
    try {
      var blob = await toBlob();
      var file = new File([blob], fileName(), { type: 'image/png' });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Benefit Illustration', text: state.data.productName });
      } else {
        toast('Sharing images is not supported here — use Download.');
      }
    } catch (err) {
      if (err.name !== 'AbortError') toast('Could not share the image.');
    }
  });

  // ---------- navigation ----------
  document.addEventListener('click', function (e) {
    var a = e.target.closest('[data-action]');
    if (!a) return;
    var act = a.dataset.action;
    if (act === 'logout') logout();
    else if (act === 'home') goHome();
    else if (act === 'generate') show('generate');
    else if (act === 'manual') { state.data = fromParsed({}); goResult(); $('#editor').open = true; }
  });

  // ---------- boot ----------
  state.user = store('session', SESSION_KEY);
  if (state.user) {
    var draft = store('local', DRAFT_KEY);
    if (draft && draft.product) state.product = draft.product;
    goHome();
  } else {
    show('login');
  }

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  }
})();
