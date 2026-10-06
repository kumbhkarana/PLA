'use strict';
/* Client for the SUD Life Sales Illustration portal (si.sudlife.in). One PortalSession per logged-in agent. */

const crypto = require('crypto');
const biParser = require('./biParser');

const BASE = 'https://si.sudlife.in/Salesillustration/';

// The portal encrypts the validation payload with this fixed key/IV in its own page script.
const AES_KEY = Buffer.from('MySecretKey123456789012345678901');
const AES_IV = Buffer.from('0000000000000000');

// Read-only lookup methods the app may call directly to build its form.
const LOOKUPS = new Set([
  'InputOutputFields', 'GetPTList', 'GetPPTList', 'GetMode', 'GetModePPT', 'MasterOptions',
  'LoadOptions', 'OptionInputField', 'GetDynamicKeywordList', 'LoadPTValue'
]);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

class PortalError extends Error {
  constructor(message, details, status) {
    super(message);
    this.details = details || [];
    this.status = status || null;
  }
}

// "1991-03-15" → "15 Mar 1991" (the portal's date format)
function portalDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  if (!m) throw new PortalError('Enter a valid date of birth.');
  return `${m[3]} ${MONTHS[+m[2] - 1]} ${m[1]}`;
}

// Age last birthday, as the portal calculates it.
function ageFrom(iso, today = new Date()) {
  const [y, mo, d] = iso.split('-').map(Number);
  let age = today.getFullYear() - y;
  if (today.getMonth() + 1 < mo || (today.getMonth() + 1 === mo && today.getDate() < d)) age--;
  return age;
}

function encrypt(plain) {
  const c = crypto.createCipheriv('aes-256-cbc', AES_KEY, AES_IV);
  return Buffer.concat([c.update(plain, 'utf8'), c.final()]).toString('base64');
}

class PortalSession {
  constructor() {
    this.cookies = new Map();
    this.productId = null;
  }

  cookieHeader() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  storeCookies(res) {
    const list = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
    list.forEach((c) => {
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      if (i > 0) this.cookies.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
    });
  }

  async request(path, init = {}) {
    const res = await fetch(BASE + path, {
      ...init,
      redirect: 'manual',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Mobile Safari/537.36',
        Accept: init.method === 'POST' ? 'application/json, text/javascript, */*; q=0.01' : 'text/html,*/*',
        Cookie: this.cookieHeader(),
        ...(init.headers || {})
      },
      signal: AbortSignal.timeout(45000)
    });
    this.storeCookies(res);
    return res;
  }

  // Open the product page so the portal session is set up for this product.
  async start(productId) {
    const id = String(parseInt(productId, 10));
    if (this.productId === id) return;
    let res;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt) await new Promise((r) => setTimeout(r, 1500)); // the portal's bot filter sometimes rejects a burst
      res = await this.request(`Input.aspx?ProductId=${id}`);
      await res.arrayBuffer();
      if (res.ok) break;
    }
    if (!res.ok) throw new PortalError(`BI portal is unavailable (HTTP ${res.status}). Please try again.`);
    this.productId = id;
  }

  async call(method, data) {
    const res = await this.request(`Input.aspx/${method}`, {
      method: 'POST',
      body: JSON.stringify(data),
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'X-Requested-With': 'XMLHttpRequest',
        Origin: 'https://si.sudlife.in',
        Referer: `${BASE}Input.aspx?ProductId=${this.productId || ''}`
      }
    });
    const body = await res.text();
    if (!res.ok) throw new PortalError(`BI portal error in ${method} (HTTP ${res.status}).`, [], res.status);
    let d;
    try { d = JSON.parse(body).d; } catch (e) { throw new PortalError(`Unexpected reply from BI portal (${method}).`); }
    if (typeof d === 'string' && d !== '') {
      try { return JSON.parse(d); } catch (e) { return d; }
    }
    return d;
  }

  async lookup(productId, method, data) {
    if (!LOOKUPS.has(method)) throw new PortalError('Unknown lookup.');
    await this.start(productId);
    return this.withFreshSession(productId, () => this.call(method, data || {}));
  }

  // If the portal rejects a call (e.g. its session expired), reopen the product page and try once more.
  async withFreshSession(productId, fn) {
    try {
      return await fn();
    } catch (err) {
      if (!(err instanceof PortalError) || (err.status !== 401 && err.status !== 403)) throw err;
      this.productId = null;
      this.cookies.clear();
      await this.start(productId);
      return fn();
    }
  }

  /*
   * Validate inputs and generate the BI.
   * input: { productId, productName, firstName, lastName, dob, gender, genderText,
   *          proposer: null | { firstName, lastName, dob, gender },
   *          pt, ppt, ptText, pptText, mode, modeText,
   *          options: [{ id, text, value }], ap, mp, sa, mi, samf,
   *          dynamic: { KEY: { value, text, type } } }
   */
  async generate(input) {
    const productId = String(parseInt(input.productId, 10));
    await this.start(productId);

    const name = `${input.firstName || ''} ${input.lastName || ''}`.trim();
    if (!name) throw new PortalError('Enter the life assured name.');
    const dob = portalDate(input.dob);
    const age = ageFrom(input.dob);
    const p = input.proposer;
    const pDob = p ? portalDate(p.dob) : dob;
    const pAge = p ? ageFrom(p.dob) : age;
    const pGender = p ? p.gender : input.gender;
    const pName = p ? `${p.firstName || ''} ${p.lastName || ''}`.trim() : name;

    const opts = (input.options || []).filter((o) => o && o.id !== '' && o.id != null);
    const optionIds = opts.map((o) => o.id + ',').join('');
    const optionValues = opts.map((o) => (o.value == null ? '' : o.value) + ',').join('');
    const num = (v) => (v === '' || v == null ? '0' : String(v).replace(/,/g, ''));

    // Dynamic product-specific fields (age proof, etc.); DOB fields are sent as ages.
    const dyn = {};
    Object.entries(input.dynamic || {}).forEach(([k, f]) => {
      dyn[k] = f.type === 'DOB' && f.value ? String(ageFrom(f.value)) : f.value;
    });

    // 1. Validate (encrypted, as the portal page does).
    const arr = [
      ['@LI_ENTRY_AGE', age], ['@LI_DOB', dob], ['@LI_GENDER', input.gender], ['@INPUT_MODE', input.mode],
      ['@PR_ID', productId], ['@OPTIONS', optionIds], ['@OptionValues', optionValues],
      ['@PR_PT', input.pt || 0], ['@PR_PPT', input.ppt || 0],
      ['@PROPOSER_AGE', pAge], ['@PROPOSER_GENDER', pGender], ['@PROPOSER_DOB', pDob], ['@SameProposer', !p],
      ['@PR_ANNPREM', num(input.ap)], ['@PR_MonthlyIncome', num(input.mi)], ['@PR_SA', num(input.sa)],
      ['@PR_SAMF', num(input.samf)], ['@PR_ModalPrem', num(input.mp)], ['@FUNDSTRATEGYID', undefined]
    ].map(([key, value]) => ({ key, value }));
    Object.entries(dyn).forEach(([k, v]) => arr.push({ key: '@' + k, value: v }));

    const v = await this.withFreshSession(productId, () => this.call('validate', { Param: encrypt(JSON.stringify(arr)) }));
    if (!v || typeof v !== 'object') throw new PortalError('BI portal did not validate the inputs.');
    if (v.FailedCount > 0) {
      const msgs = [v.GeneralError, v.EntryAge, v.MaturityAge, v.Premium, v.SumAssured, v.MIError, v.SAMFError, v.RiderMessage]
        .concat(v.OptionError || [], v.ErrorMessage || [])
        .filter(Boolean)
        .flatMap((m) => String(m).split(/<br\s*\/?>/i))
        .map((m) => m.replace(/<[^>]+>/g, '').trim())
        .filter(Boolean);
      throw new PortalError('Please check the inputs.', [...new Set(msgs)]);
    }

    // 2. Generate the BI with the portal-calculated premium and sum assured.
    const pt = input.pt || v.PT || 0;
    const ppt = input.ppt || v.PPT || 0;
    const bi = {
      LI_NAME: name, LI_ENTRY_AGE: age, LI_GENDER: input.gender, LI_DOB: dob, DISPLAY_LI_GENDER: input.genderText || input.gender,
      PR_ID: productId, PR_NAME: input.productName || '', PR_PT: String(pt), PR_PPT: String(ppt),
      DISPLAY_PR_PT: input.ptText || String(pt), DISPLAY_PR_PPT: input.pptText || String(ppt),
      INPUT_MODE: String(input.mode), DISPLAY_INPUT_MODE: input.modeText || '',
      OPTIONS: optionIds, OPTIONVALUES: optionValues,
      PR_SA: String(Number(v.SA) || num(input.sa)), PR_MODALPREM: String(Math.round(Number(v.ModalPremium) || 0)),
      PR_ANNPREM: String(v.AnnualPremium != null ? v.AnnualPremium : num(input.ap)), PR_MI: String(Number(v.MonthlyIncome) || 0),
      PR_SAMF: String(Number(v.SAMF) || 0), MODE_DISC: String(Number(v.ModeDisc) || 1), MODE_FREQ: String(Number(v.ModeFreq) || 1),
      GeneratedFrom: 'Web SIS',
      PROPOSER_NAME: pName, PROPOSER_AGE: pAge, PROPOSER_GENDER: pGender, PROPOSER_DOB: pDob,
      AGEMASTERID: String(v.AgeMasterId || '')
    };
    opts.forEach((o, i) => { if (o.text) bi[`DISPLAY_PR_OPTION_${o.level || i + 1}`] = o.text; });
    Object.entries(input.dynamic || {}).forEach(([k, f]) => {
      bi[k] = dyn[k];
      if (f.text) bi['DISPLAY_' + k] = f.text;
    });

    const out = await this.call('GenerateBIPDF', { Param: JSON.stringify(bi) });
    if (!out || typeof out !== 'object') throw new PortalError('BI portal did not return an illustration.');
    if (out.ValidationStatus && out.ValidationStatus.FailedCount > 0) {
      throw new PortalError('Please check the inputs.', [String(out.ValidationStatus.GeneralError || '').replace(/<[^>]+>/g, ' ').trim()].filter(Boolean));
    }
    if (!out.htmlstring) throw new PortalError('BI portal returned an empty illustration.');

    const parsed = biParser.parse(out.htmlstring);
    const summary = biParser.summarize(parsed);
    summary.annualPremium = summary.annualPremium || Number(v.AnnualPremium) || null;
    summary.installmentPremium = summary.installmentPremium || Math.round(Number(v.ModalPremium)) || null;
    summary.gst = Number(v.Tax) || 0;
    summary.sumAssured = summary.sumAssured || Number(v.SA) || null;
    summary.gender = input.genderText || null;

    return {
      summary,
      table: parsed.table,
      pdf: Array.isArray(out.bytes) && out.bytes.length ? Buffer.from(out.bytes).toString('base64') : null
    };
  }
}

module.exports = { PortalSession, PortalError, ageFrom, portalDate };
