/* BIMO — app flow: login → home → BI form → illustration image. */
(function () {
  'use strict';

  var CFG = window.BIMO_CONFIG;
  var LAST_PRODUCT_KEY = 'bimo.lastProduct';

  var state = {
    user: null,
    product: null,
    category: 'All',
    meta: null,     // portal metadata for the selected product
    plan: null,     // current plan selections
    result: null    // last generated BI
  };

  // ---------- helpers ----------
  var $ = function (s, el) { return (el || document).querySelector(s); };
  var $$ = function (s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); };

  function local(key, val) {
    try {
      if (val === undefined) return JSON.parse(localStorage.getItem(key) || 'null');
      localStorage.setItem(key, JSON.stringify(val));
    } catch (e) { return null; }
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function inr(n) {
    if (n == null || isNaN(n)) return '—';
    return '₹' + Math.round(n).toLocaleString('en-IN');
  }

  function inrShort(n) {
    if (n == null || isNaN(n)) return '—';
    var a = Math.abs(n);
    if (a >= 1e7) return '₹' + trim(n / 1e7) + ' Cr';
    if (a >= 1e5) return '₹' + trim(n / 1e5) + ' L';
    return inr(n);
  }

  function trim(x) { return (Math.round(x * 100) / 100).toString(); }

  function cleanName(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }

  function ageFrom(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    if (!m) return null;
    var t = new Date();
    var age = t.getFullYear() - +m[1];
    if (t.getMonth() + 1 < +m[2] || (t.getMonth() + 1 === +m[2] && t.getDate() < +m[3])) age--;
    return age;
  }

  function toast(msg) {
    var t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.hidden = true; }, 2800);
  }

  function bind(key, value) {
    $$('[data-bind="' + key + '"]').forEach(function (el) { el.textContent = value; });
  }

  function show(name) {
    $$('.screen').forEach(function (s) { s.hidden = s.id !== 'screen-' + name; });
    window.scrollTo(0, 0);
  }

  var STATIC_HOST = location.protocol === 'file:' || /\.github\.io$/i.test(location.hostname);
  var NO_SERVER = /\.github\.io$/i.test(location.hostname)
    ? 'This GitHub Pages link can’t log in by itself. BIMO needs its server, which isn’t set up yet (see “Deploy” in the README).'
    : 'BIMO server is not running. Open BIMO from its server address (start it with “npm start”) instead of opening the file directly.';

  // A static copy forwards to the real BIMO server once its address is configured.
  if (STATIC_HOST && CFG.serverUrl) {
    try {
      if (new URL(CFG.serverUrl).origin !== location.origin) { location.replace(CFG.serverUrl); return; }
    } catch (e) { /* bad URL in config — fall through to the normal message */ }
  }

  async function api(path, body) {
    if (STATIC_HOST) throw new Error(NO_SERVER);
    var res;
    try {
      res = await fetch('/api/' + path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        credentials: 'same-origin'
      });
    } catch (e) {
      throw new Error('Cannot reach the BIMO server. Check your internet connection and that the server is running.');
    }
    var data = null;
    try { data = await res.json(); } catch (e) { /* non-JSON reply */ }
    // A plain static host (no BIMO server) answers /api with an HTML or empty error page.
    if (!data) throw new Error(NO_SERVER);
    if (res.status === 401 && path !== 'login') { state.user = null; show('login'); }
    if (!res.ok) {
      var err = new Error(data.error || 'Request failed (' + res.status + ')');
      err.details = data.details || [];
      throw err;
    }
    return data;
  }

  function lookup(method, data) {
    return api('lookup', { productId: state.product.id, method: method, data: data }).then(function (r) { return r.d; });
  }

  // Portal lists come as [{Key, Value}] — normalise to [{key, text}].
  function pairs(d) {
    if (!Array.isArray(d)) return null;
    return d.map(function (x) { return { key: String(x.Key), text: x.Value == null ? '' : String(x.Value) }; });
  }

  // ---------- auth ----------
  $('#login-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    var err = $('#login-error');
    var u = $('#login-user').value.trim();
    var c = $('#login-code').value.trim();
    if (!u || !c) { err.textContent = 'Enter your username and password.'; err.hidden = false; return; }
    var btn = this.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      var r = await api('login', { username: u, code: c });
      state.user = r.user;
      err.hidden = true;
      goHome();
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
    } finally { btn.disabled = false; }
  });

  $('#toggle-pw').addEventListener('click', function () {
    var i = $('#login-code');
    var showing = i.type === 'text';
    i.type = showing ? 'password' : 'text';
    this.textContent = showing ? 'Show' : 'Hide';
  });

  async function logout() {
    try { await api('logout', {}); } catch (e) { /* already logged out */ }
    state.user = null;
    $('#login-form').reset();
    show('login');
  }

  // ---------- home ----------
  function allProducts() {
    var list = [];
    CFG.categories.forEach(function (c) {
      c.products.forEach(function (p) { list.push({ id: p.id, name: cleanName(p.name), featured: p.featured, category: c.name }); });
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
      return (state.category === 'All' || p.category === state.category) && (!q || p.name.toLowerCase().indexOf(q) !== -1);
    });
    items.sort(function (a, b) { return (b.featured ? 1 : 0) - (a.featured ? 1 : 0); });

    $('#product-count').textContent = items.length + ' product' + (items.length === 1 ? '' : 's');
    $('#product-list').innerHTML = items.length ? items.map(function (p) {
      var sel = state.product && state.product.id === p.id;
      return '<li><button class="product' + (sel ? ' selected' : '') + '" role="radio" aria-checked="' + sel + '" data-id="' + p.id + '">' +
        '<span class="radio" aria-hidden="true"></span>' +
        '<span class="product-text"><b>' + esc(p.name) + '</b><small>' + esc(p.category) + '</small></span>' +
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
    local(LAST_PRODUCT_KEY, state.product);
    renderProducts();
  });

  $('#btn-continue').addEventListener('click', function () { if (state.product) openForm(); });

  // ---------- BI form ----------
  var AMOUNTS = [
    { key: 'ap', io: 'AnnualPremium', label: 'Annual premium (₹)' },
    { key: 'mp', io: 'ModalPremium', label: 'Instalment premium (₹)' },
    { key: 'sa', io: 'SA', label: 'Sum assured (₹)' },
    { key: 'mi', io: 'MI', label: 'Monthly income (₹)' },
    { key: 'samf', io: 'SAMF', label: 'Sum assured multiple' }
  ];

  async function openForm() {
    bind('productName', state.product.name);
    $('#bi-form').hidden = true;
    $('#form-error').hidden = true;
    var loading = $('#form-loading');
    loading.className = 'status busy';
    loading.textContent = 'Loading product details…';
    loading.hidden = false;
    show('form');

    try {
      var pid = String(state.product.id);
      var res = await Promise.all([
        lookup('InputOutputFields', { ProdId: pid }),
        lookup('GetPTList', { ProdId: pid }),
        lookup('GetMode', { ProdId: pid }),
        lookup('MasterOptions', { ProdId: pid }),
        lookup('GetDynamicKeywordList', { ProdId: pid })
      ]);
      var io = res[0] || {};
      var kw = res[4] || {};
      var listVals = {};
      ((kw.ListVals && kw.ListVals.Values) || []).forEach(function (v) { listVals[v.Keyword.replace('@', '')] = v.valuePair || {}; });

      state.meta = {
        io: io,
        listVals: listVals,
        dynamic: (kw.Keywords || []).filter(function (k) {
          var name = k.KeywordName.replace('@', '');
          return !k.IsMapped && !/^PR_(EMRID|FLATEXTRAID)$/i.test(name);
        }).map(function (k) {
          return { key: k.KeywordName.replace('@', ''), label: k.FieldCaption, type: String(k.FieldType || '').toUpperCase(), def: k.DefaultValue };
        })
      };
      state.plan = {
        pt: '', ppt: '', mode: '',
        ptList: pairs(res[1]) || [],
        pptList: [],
        modeList: pairs(res[2]) || [],
        options: (pairs(res[3]) || []).map(function (m, i) {
          return { level: i + 1, name: m.text, items: [], value: '', disabled: false, hidden: false, input: null, inputValue: '' };
        }),
        amounts: {},
        dynamic: {}
      };
      state.meta.dynamic.forEach(function (f) {
        var vals = listVals[f.key];
        state.plan.dynamic[f.key] = f.def != null ? String(f.def) : (vals && vals['1'] && /standard age proof/i.test(f.label) ? '1' : '');
      });

      fillGender('gender', listVals.LI_GENDER);
      fillGender('pGender', listVals.PROPOSER_GENDER || listVals.LI_GENDER);

      if (io.PT === 2 && (io.PPT === 1 || io.PPT === 3)) state.plan.pptList = pairs(await lookup('GetPPTList', { ProdId: pid, PT: '0' })) || [];
      if (state.plan.pptList.length === 1) await setPPT(state.plan.pptList[0].key, true);
      await loadOptions(1, 'Default', 0);
      if (state.plan.modeList.length === 1) state.plan.mode = state.plan.modeList[0].key;

      renderPlan();
      loading.hidden = true;
      $('#bi-form').hidden = false;
    } catch (err) {
      loading.className = 'status error';
      loading.textContent = err.message;
    }
  }

  function fillGender(name, vals) {
    vals = vals && Object.keys(vals).length ? vals : { M: 'Male', F: 'Female' };
    var el = $('#bi-form [name="' + name + '"]');
    var cur = el.value;
    el.innerHTML = '<option value="">Select</option>' + Object.keys(vals).map(function (k) {
      return '<option value="' + esc(k) + '">' + esc(vals[k]) + '</option>';
    }).join('');
    if (cur && vals[cur]) el.value = cur;
  }

  // Mirror of the portal's option cascade: each level depends on the levels above, PT and PPT.
  async function loadOptions(from, sender, changeLevel) {
    var p = state.plan;
    for (var lvl = from; lvl <= p.options.length; lvl++) {
      var o = p.options[lvl - 1];
      var parent = p.options.slice(0, lvl - 1).map(function (x) { return (x.value || '-1') + ','; }).join('');
      var d = await lookup('LoadOptions', {
        ProdId: String(state.product.id), Level: String(lvl), ParentId: parent,
        PT: p.pt || '-1', PPT: p.ppt || '-1', Sender: sender, ChangeLevel: String(changeLevel)
      });
      var list = pairs(d);
      if (!list) continue; // "" = unchanged for this trigger
      if (!list.length) {
        o.items = []; o.value = ''; o.disabled = true; o.input = null; o.inputValue = '';
        continue;
      }
      o.items = list;
      o.disabled = false;
      if (!list.some(function (x) { return x.key === o.value; })) {
        o.value = list.length === 1 ? list[0].key : '';
        o.inputValue = '';
        await loadOptionInput(o);
      }
      o.hidden = list.length === 1 && !list[0].text;
    }
    await loadPTValue();
  }

  async function loadOptionInput(o) {
    o.input = null;
    if (!o.value) return;
    var d = await lookup('OptionInputField', { ProdId: String(state.product.id), OptionId: o.value });
    if (d && d.key) o.input = { label: d.key, type: String(d.value || '').toUpperCase() };
  }

  function selectedOptions() {
    return state.plan.options.filter(function (o) { return o.value && !o.disabled; });
  }

  function optionValue(o) {
    if (!o.input) return '';
    if (o.input.type === 'DOB') return o.inputValue ? String(ageFrom(o.inputValue)) : '';
    if (o.input.type === 'CHECKBOX') return o.inputValue ? '1' : '0';
    return o.inputValue;
  }

  // Products where the policy term is derived from other choices.
  async function loadPTValue() {
    if (!state.meta || state.meta.io.PT !== 2) return;
    var sel = selectedOptions();
    var d = await lookup('LoadPTValue', {
      ProdId: String(state.product.id),
      PPT: state.plan.ppt || '-1',
      OptionId: sel.map(function (o) { return o.value + ','; }).join(''),
      OptionValue: sel.map(function (o) { return optionValue(o) + ','; }).join('')
    });
    state.plan.pt = d && d !== 'Insufficient inputs' ? String(d) : '';
  }

  async function setPT(val) {
    var p = state.plan;
    p.pt = val;
    p.ppt = '';
    p.pptList = [];
    var io = state.meta.io;
    if (val && (io.PPT === 1 || io.PPT === 3)) {
      p.pptList = pairs(await lookup('GetPPTList', { ProdId: String(state.product.id), PT: val })) || [];
      if (p.pptList.length === 1) return setPPT(p.pptList[0].key);
    }
    await loadOptions(1, 'PT', 0);
  }

  async function setPPT(val, skipOptions) {
    var p = state.plan;
    p.ppt = val;
    if (val) {
      // Optional refinement — keep the product's full mode list if the portal can't narrow it.
      var modes = pairs(await lookup('GetModePPT', { PT: p.pt || '0', PPT: val }).catch(function () { return null; }));
      if (modes && modes.length) {
        p.modeList = modes;
        if (!modes.some(function (m) { return m.key === p.mode; })) p.mode = modes.length === 1 ? modes[0].key : '';
      }
    }
    if (!skipOptions) await loadOptions(1, 'PT', 0);
  }

  function selectHtml(name, items, value, attrs) {
    return '<select name="' + name + '"' + (attrs || '') + '><option value="">Select</option>' +
      items.map(function (x) {
        return '<option value="' + esc(x.key) + '"' + (x.key === String(value) ? ' selected' : '') + '>' + esc(x.text || x.key) + '</option>';
      }).join('') + '</select>';
  }

  function renderPlan() {
    var io = state.meta.io;
    var p = state.plan;
    var html = [];
    var optionHtml = [];
    var termHtml = [];

    p.options.forEach(function (o, i) {
      if (o.hidden || !o.items.length) return; // not applicable, or waits on the policy term
      optionHtml.push('<label class="field"><span>' + esc(o.name) + '</span>' + selectHtml('opt' + i, o.items, o.value) + '</label>');
      if (o.input) {
        var t = o.input.type;
        var input = t === 'DOB' ? '<input type="date" name="optin' + i + '" value="' + esc(o.inputValue) + '">'
          : t === 'CHECKBOX' ? '<input type="checkbox" name="optin' + i + '"' + (o.inputValue ? ' checked' : '') + '>'
          : '<input type="' + (t === 'STRING' ? 'text' : 'number') + '" inputmode="' + (t === 'STRING' ? 'text' : 'numeric') + '" name="optin' + i + '" value="' + esc(o.inputValue) + '">';
        optionHtml.push('<label class="field' + (t === 'CHECKBOX' ? ' field-check' : '') + '"><span>' + esc(o.input.label) + '</span>' + input + '</label>');
      }
    });

    if (io.PT === 1 || io.PT === 3) termHtml.push('<label class="field"><span>Policy term (years)</span>' + selectHtml('pt', p.ptList, p.pt) + '</label>');
    else if (io.PT === 2) termHtml.push('<label class="field"><span>Policy term (years)</span><input value="' + esc(p.pt || 'Auto') + '" readonly tabindex="-1"></label>');

    if (io.PPT === 1 || io.PPT === 3) termHtml.push('<label class="field"><span>Premium paying term (years)</span>' + selectHtml('ppt', p.pptList, p.ppt, p.pptList.length ? '' : ' disabled') + '</label>');
    else if (io.PPT === 2) termHtml.push('<label class="field"><span>Premium paying term (years)</span><input value="Auto" readonly tabindex="-1"></label>');

    // Where the term is chosen directly, it comes first (options may depend on it); otherwise options decide the term.
    html = io.PT === 2 ? optionHtml.concat(termHtml) : termHtml.concat(optionHtml);

    if (io.Mode !== 0) html.push('<label class="field"><span>Premium mode</span>' + selectHtml('mode', p.modeList, p.mode) + '</label>');

    AMOUNTS.forEach(function (a) {
      var code = io[a.io];
      if (code !== 1 && code !== 3) return;
      var label = a.key === 'ap' && state.product.id === 1056 ? 'Monthly premium (₹)' : a.label;
      html.push('<label class="field"><span>' + label + '</span><input name="amt_' + a.key + '" type="text" inputmode="numeric" value="' + esc(p.amounts[a.key] || '') + '" placeholder="e.g. 1,00,000"></label>');
    });

    state.meta.dynamic.forEach(function (f) {
      var v = p.dynamic[f.key] || '';
      var vals = state.meta.listVals[f.key] || {};
      var input;
      if (f.type === 'LIST') input = selectHtml('dyn_' + f.key, Object.keys(vals).map(function (k) { return { key: k, text: vals[k] }; }), v);
      else if (f.type === 'CHECKBOX') input = '<input type="checkbox" name="dyn_' + f.key + '"' + (v === '1' ? ' checked' : '') + '>';
      else if (f.type === 'DOB') input = '<input type="date" name="dyn_' + f.key + '" value="' + esc(v) + '">';
      else input = '<input type="' + (f.type === 'NUMBER' ? 'number' : 'text') + '" name="dyn_' + f.key + '" value="' + esc(v) + '">';
      html.push('<label class="field' + (f.type === 'CHECKBOX' ? ' field-check' : '') + '"><span>' + esc(f.label) + '</span>' + input + '</label>');
    });

    $('#plan-fields').innerHTML = html.join('');
  }

  // Selections that change other fields go through the portal, then re-render.
  var busy = Promise.resolve();
  $('#plan-fields').addEventListener('change', function (e) {
    var el = e.target;
    var name = el.name || '';
    var p = state.plan;
    var task = null;

    if (/^opt\d+$/.test(name)) {
      var o = p.options[+name.slice(3)];
      o.value = el.value;
      o.inputValue = '';
      task = async function () { await loadOptionInput(o); await loadOptions(o.level + 1, 'Option', o.level); };
    } else if (/^optin\d+$/.test(name)) {
      var oi = p.options[+name.slice(5)];
      oi.inputValue = el.type === 'checkbox' ? (el.checked ? '1' : '') : el.value;
      task = loadPTValue;
    } else if (name === 'pt') {
      task = function () { return setPT(el.value); };
    } else if (name === 'ppt') {
      task = function () { return setPPT(el.value); };
    } else if (name === 'mode') {
      p.mode = el.value;
    } else if (name.indexOf('dyn_') === 0) {
      p.dynamic[name.slice(4)] = el.type === 'checkbox' ? (el.checked ? '1' : '0') : el.value;
    }

    if (task) {
      var fs = $('#plan-fields');
      fs.classList.add('loading');
      busy = busy.then(task).catch(function (err) { showFormError(err.message); }).then(function () {
        renderPlan();
        fs.classList.remove('loading');
      });
    }
  });

  $('#plan-fields').addEventListener('input', function (e) {
    var name = e.target.name || '';
    if (name.indexOf('amt_') === 0) {
      var digits = e.target.value.replace(/[^\d]/g, '');
      state.plan.amounts[name.slice(4)] = digits;
      e.target.value = digits ? Number(digits).toLocaleString('en-IN') : '';
    } else if (name.indexOf('dyn_') === 0 && e.target.type !== 'checkbox') {
      state.plan.dynamic[name.slice(4)] = e.target.value;
    }
  });

  // Any edit dismisses the previous error list.
  $('#bi-form').addEventListener('input', function () { $('#form-error').hidden = true; });

  $('#bi-form').addEventListener('change', function (e) {
    $('#form-error').hidden = true;
    if (e.target.name === 'proposerSame') $('#proposer-fields').hidden = e.target.checked;
    if (e.target.type === 'date') {
      var tag = $('[data-age-for="' + e.target.name + '"]');
      var age = ageFrom(e.target.value);
      if (tag) tag.textContent = age != null ? '· ' + age + ' yrs' : '';
    }
  });

  function showFormError(msg, details) {
    var box = $('#form-error');
    box.innerHTML = '<b>' + esc(msg) + '</b>' + (details && details.length ? '<ul>' + details.map(function (d) { return '<li>' + esc(d) + '</li>'; }).join('') + '</ul>' : '');
    box.hidden = false;
    box.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function collect() {
    var f = $('#bi-form');
    var val = function (n) { return (f.elements[n] && f.elements[n].value || '').trim(); };
    var io = state.meta.io;
    var p = state.plan;
    var errors = [];
    var textOf = function (list, key) { var x = list.find(function (i) { return i.key === key; }); return x ? x.text : ''; };
    var genderText = function (n) { var s = f.elements[n]; return s.selectedIndex > 0 ? s.options[s.selectedIndex].text : ''; };

    if (!val('firstName')) errors.push('Enter the first name.');
    var age = ageFrom(val('dob'));
    if (age == null || age < 0) errors.push('Enter a valid date of birth.');
    if (!val('gender')) errors.push('Select the gender.');

    var proposer = null;
    if (!f.elements.proposerSame.checked) {
      proposer = { firstName: val('pFirstName'), lastName: val('pLastName'), dob: val('pDob'), gender: val('pGender') };
      if (!proposer.firstName || ageFrom(proposer.dob) == null || !proposer.gender) errors.push('Complete the proposer’s name, date of birth and gender.');
    }

    p.options.forEach(function (o) {
      if (!o.disabled && o.items.length && !o.value) errors.push('Select ' + o.name + '.');
      if (o.value && o.input && o.input.type !== 'CHECKBOX' && !o.inputValue) errors.push('Enter ' + o.input.label + '.');
    });
    if ((io.PT === 1 || io.PT === 3) && !p.pt) errors.push('Select the policy term.');
    if ((io.PPT === 1 || io.PPT === 3) && !p.ppt) errors.push('Select the premium paying term.');
    if (io.Mode !== 0 && !p.mode) errors.push('Select the premium mode.');
    AMOUNTS.forEach(function (a) {
      if ((io[a.io] === 1 || io[a.io] === 3) && !p.amounts[a.key]) errors.push('Enter the ' + a.label.replace(/ \(₹\)/, '').toLowerCase() + '.');
    });
    state.meta.dynamic.forEach(function (d) {
      if (d.type === 'LIST' && !p.dynamic[d.key]) errors.push('Select ' + d.label + '.');
    });

    var dynamic = {};
    state.meta.dynamic.forEach(function (d) {
      var v = p.dynamic[d.key];
      var vals = state.meta.listVals[d.key] || {};
      dynamic[d.key] = { value: d.type === 'CHECKBOX' ? (v === '1' ? 1 : 0) : v, text: vals[v] || '', type: d.type };
    });

    return {
      errors: errors,
      input: {
        productId: state.product.id,
        productName: state.product.name,
        firstName: val('firstName'), lastName: val('lastName'), dob: val('dob'),
        gender: val('gender'), genderText: genderText('gender'),
        proposer: proposer,
        pt: p.pt, ppt: p.ppt, ptText: textOf(p.ptList, p.pt) || p.pt, pptText: textOf(p.pptList, p.ppt) || p.ppt,
        mode: p.mode, modeText: textOf(p.modeList, p.mode),
        options: selectedOptions().map(function (o) {
          return { level: o.level, id: o.value, text: textOf(o.items, o.value), value: optionValue(o) };
        }),
        ap: p.amounts.ap || '', mp: p.amounts.mp || '', sa: p.amounts.sa || '', mi: p.amounts.mi || '', samf: p.amounts.samf || '',
        dynamic: dynamic
      }
    };
  }

  $('#bi-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    await busy;
    $('#form-error').hidden = true;
    var c = collect();
    if (c.errors.length) return showFormError('Please complete the form.', c.errors);

    var btn = $('#btn-generate');
    btn.disabled = true;
    btn.classList.add('is-busy');
    btn.textContent = 'Generating BI…';
    try {
      var r = await api('generate', c.input);
      state.result = r;
      goResult();
    } catch (err) {
      showFormError(err.message, err.details);
    } finally {
      btn.disabled = false;
      btn.classList.remove('is-busy');
      btn.textContent = 'Generate BI';
    }
  });

  // ---------- illustration ----------
  function renderIllustration() {
    var s = state.result.summary;
    var today = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    var who = [s.age != null ? s.age + ' yrs' : '', s.gender, s.planOption].filter(Boolean).map(esc).join(' · ');
    var hasScenarios = s.total8 != null || s.total4 != null;
    var guaranteed = s.totalGuaranteed;
    var headline = hasScenarios ? Math.max(s.total8 || 0, s.total4 || 0) : guaranteed;
    var perYear = s.annualPremium;
    var modeNote = s.mode && !/^annual/i.test(s.mode) && s.installmentPremium ? inr(s.installmentPremium) + ' ' + s.mode.replace(/\s*\(.*\)/, '').toLowerCase() : '';

    // What you pay vs. what you get — single measure, labelled bars.
    var bars = [{ label: 'You pay', value: s.totalPremium, cls: 'pay' }];
    if (guaranteed) bars.push({ label: 'Guaranteed', value: guaranteed, cls: 'get' });
    if (s.total4 != null) bars.push({ label: 'At 4% p.a.*', value: s.total4, cls: 'get soft' });
    if (s.total8 != null) bars.push({ label: 'At 8% p.a.*', value: s.total8, cls: 'get' });
    bars = bars.filter(function (b) { return b.value; });
    var max = Math.max.apply(null, bars.map(function (b) { return b.value; }));

    var tiles = [
      { k: 'Total you pay', v: inrShort(s.totalPremium), sub: perYear && s.ppt ? inr(perYear) + ' × ' + s.ppt + ' yrs' : '' },
      { k: 'Life cover', v: inrShort(s.sumAssured), sub: 'From day one' },
      s.incomeYearly ? { k: 'Yearly income', v: inrShort(s.incomeYearly), sub: 'Year ' + s.incomeFrom + '–' + s.incomeTo + ' · guaranteed' } : null,
      s.maturityGuaranteed ? { k: 'Guaranteed maturity', v: inrShort(s.maturityGuaranteed), sub: 'In year ' + s.policyTerm } : null,
      { k: 'Policy term', v: s.policyTerm ? s.policyTerm + ' yrs' : '—', sub: s.ppt ? 'Pay for ' + s.ppt + ' yrs' : '' }
    ].filter(function (t) { return t && t.v && t.v !== '—'; });

    // Journey: pay years → (income years) → maturity.
    var journey = '';
    if (s.policyTerm && s.ppt) {
      var segs = [{ cls: 'pay', from: 1, to: s.ppt, label: 'You pay' }];
      if (s.incomeFrom) {
        if (s.incomeFrom > s.ppt + 1) segs.push({ cls: 'wait', from: s.ppt + 1, to: s.incomeFrom - 1, label: 'Grows' });
        segs.push({ cls: 'get', from: s.incomeFrom, to: s.incomeTo, label: 'Income' });
        if (s.incomeTo < s.policyTerm) segs.push({ cls: 'wait', from: s.incomeTo + 1, to: s.policyTerm, label: 'Covered' });
      } else if (s.policyTerm > s.ppt) {
        segs.push({ cls: 'wait', from: s.ppt + 1, to: s.policyTerm, label: 'Grows' });
      }
      segs = segs.filter(function (x) { return x.to >= x.from; });
      journey = '<div class="illus-section"><div class="illus-label">Your policy journey</div><div class="journey">' +
        segs.map(function (x) {
          var yrs = x.to - x.from + 1;
          return '<div class="seg ' + x.cls + '" style="flex:' + yrs + '"><b>' + x.label + '</b><span>Yr ' + x.from + (yrs > 1 ? '–' + x.to : '') + '</span></div>';
        }).join('') + '</div>' +
        (s.maturityGuaranteed || s.maturity8 ? '<div class="journey-end">Maturity payout at the end of year ' + s.policyTerm + '</div>' : '') +
        '</div>';
    }

    $('#illustration').innerHTML =
      '<div class="illus-head">' +
        '<img src="assets/logo.svg" alt="" class="illus-logo">' +
        '<div class="illus-titles"><span class="illus-kicker">Benefit Illustration</span><b>' + esc(state.product.name) + '</b></div>' +
        '<span class="illus-date">' + today + '</span>' +
      '</div>' +
      '<div class="illus-body">' +
        '<div class="illus-customer"><span>Prepared for</span><b>' + esc(s.customerName || 'Valued Customer') + '</b>' + (who ? '<small>' + who + '</small>' : '') + '</div>' +

        '<div class="illus-hero">' +
          '<div class="hero-col"><span>You invest</span><b>' + inrShort(perYear) + '<small>/year</small></b><em>' + (s.ppt ? 'for ' + s.ppt + ' years' : '') + (modeNote ? '<br>' + esc(modeNote) : '') + '</em></div>' +
          '<div class="hero-arrow" aria-hidden="true">&rarr;</div>' +
          '<div class="hero-col get"><span>' + (hasScenarios ? 'You could receive' : 'You receive') + '</span><b>' + (hasScenarios ? '<small class="pre">up to</small>' : '') + inrShort(headline) + '</b><em>' +
            (hasScenarios ? (guaranteed ? inrShort(guaranteed) + ' guaranteed' : 'at 8% p.a. assumed return*') : 'guaranteed') + '</em></div>' +
        '</div>' +

        (bars.length > 1 ? '<div class="illus-section"><div class="illus-label">What you pay vs. what you get</div><div class="bars">' +
          bars.map(function (b) {
            return '<div class="bar-row"><span class="bar-label">' + b.label + '</span><div class="bar-track"><div class="bar ' + b.cls + '" style="width:' + Math.max(4, b.value / max * 100) + '%"></div></div><b class="bar-val">' + inrShort(b.value) + '</b></div>';
          }).join('') + '</div></div>' : '') +

        '<div class="illus-tiles">' + tiles.map(function (t) {
          return '<div class="tile"><span>' + t.k + '</span><b>' + t.v + '</b><small>' + esc(t.sub) + '</small></div>';
        }).join('') + '</div>' +

        journey +
      '</div>' +
      '<div class="illus-foot">' +
        '<div class="advisor"><span>Your advisor</span><b>' + esc(state.user.name) + '</b><small>' + esc(state.user.tier) + '</small></div>' +
        '<p>' + (hasScenarios ? '*4% and 8% p.a. are assumed rates of return as per IRDAI guidelines; they are not guaranteed and are not the upper or lower limits of what you may get. ' : '') +
        'Totals include survival benefits, cash bonuses and maturity benefit. Premiums exclude GST. Please read the official Benefit Illustration and sales brochure before buying.' +
        (s.uin ? ' UIN: ' + esc(s.uin) + '.' : '') + '</p>' +
      '</div>';
  }

  function goResult() {
    renderIllustration();
    $('#btn-share').hidden = !(navigator.canShare && navigator.share);
    $('#btn-pdf').hidden = !state.result.pdf;
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

  function baseName() {
    var n = (state.result.summary.customerName || 'customer').replace(/[^\w]+/g, '_');
    return 'BI_' + n + '_' + state.product.id;
  }

  function saveBlob(blob, name) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  $('#btn-download').addEventListener('click', async function () {
    var btn = this;
    btn.disabled = true;
    try {
      saveBlob(await toBlob(), baseName() + '.png');
      toast('Illustration saved');
    } catch (err) {
      console.error(err);
      toast('Could not create the image.');
    } finally { btn.disabled = false; }
  });

  $('#btn-share').addEventListener('click', async function () {
    try {
      var file = new File([await toBlob()], baseName() + '.png', { type: 'image/png' });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Benefit Illustration', text: state.product.name });
      } else {
        toast('Sharing images is not supported here — use Download.');
      }
    } catch (err) {
      if (err.name !== 'AbortError') toast('Could not share the image.');
    }
  });

  $('#btn-pdf').addEventListener('click', function () {
    var bin = atob(state.result.pdf);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    saveBlob(new Blob([bytes], { type: 'application/pdf' }), baseName() + '.pdf');
  });

  // ---------- navigation ----------
  document.addEventListener('click', function (e) {
    var a = e.target.closest('[data-action]');
    if (!a) return;
    var act = a.dataset.action;
    if (act === 'logout') logout();
    else if (act === 'home') goHome();
    else if (act === 'form') show('form');
  });

  // ---------- boot ----------
  (async function boot() {
    state.product = local(LAST_PRODUCT_KEY);
    try {
      var r = await api('me');
      state.user = r.user;
      goHome();
    } catch (e) {
      show('login');
      if (/server/i.test(e.message)) {
        var err = $('#login-error');
        err.textContent = e.message;
        err.hidden = false;
      }
    }
  })();

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  }
})();
