import { INSTRUMENTS, OPTIONS, TUNINGS, GAUGES, BRIDGE_MODELS, NOT_SURE, blankSpec, parseLength, parseMulti, fmtIn } from './data.js';
import { buildGuide, esc } from './guide.js';
import { TOOL_CATALOG, TOOL_LABEL } from './tools.js';

const app = document.getElementById('app');
const LEGACY_KEY = 'setupbench.instruments.v1'; // first version's browser storage, imported once

// ---------- API ----------
async function api(method, path, body) {
  const res = await fetch(path, {
    method, credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) {
    const err = new Error((data && data.error) || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

// ---------- state ----------
const state = { me: null, instruments: [], loaded: false, library: null };
let draft = null; // instrument being created or edited

const owned = () => (state.me && state.me.toolbox.set ? new Set(state.me.toolbox.tools) : null);
const findInst = id => state.instruments.find(i => i.id === id);

async function saveInst(inst) {
  inst.updated = new Date().toISOString();
  const i = state.instruments.findIndex(x => x.id === inst.id);
  if (i >= 0) state.instruments[i] = inst; else state.instruments.unshift(inst);
  await api('PUT', `/api/instruments/${inst.id}`, inst);
}
// Progress and log edits save in the background, coalesced.
const pendingSaves = new Map();
function saveSoon(inst) {
  clearTimeout(pendingSaves.get(inst.id));
  pendingSaves.set(inst.id, setTimeout(() => saveInst(inst).catch(e => toast(e.message, 'error')), 400));
}

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const today = () => new Date().toISOString().slice(0, 10);

function toast(msg, kind = '') {
  const t = document.createElement('div');
  t.className = `toast ${kind}`; t.textContent = msg; t.setAttribute('role', 'status');
  document.body.appendChild(t);
  setTimeout(() => t.classList.add('show'), 10);
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 3200);
}

// ---------- icons ----------
const ICONS = {
  electric: `<svg viewBox="0 0 120 260" aria-hidden="true"><path class="ink-soft" d="M44 148 C36 128 20 122 22 150 C24 170 14 180 16 205 C18 240 50 252 60 252 C70 252 102 240 104 205 C106 180 96 170 98 150 C100 128 88 126 76 148 Z"/><rect class="ink" x="54" y="22" width="12" height="138" rx="2"/><path class="ink" d="M52 24 L48 2 L72 2 L68 24 Z"/><rect class="ink" x="47" y="168" width="26" height="8" rx="3"/><rect class="ink" x="47" y="190" width="26" height="8" rx="3"/><rect class="ink" x="45" y="214" width="30" height="6" rx="2"/></svg>`,
  acoustic: `<svg viewBox="0 0 120 260" aria-hidden="true"><path class="ink-soft" d="M60 118 C30 118 24 140 30 160 C34 172 34 178 26 192 C14 214 24 254 60 254 C96 254 106 214 94 192 C86 178 86 172 90 160 C96 140 90 118 60 118 Z"/><rect class="ink" x="54" y="22" width="12" height="130" rx="2"/><path class="ink" d="M51 24 L48 2 L72 2 L69 24 Z"/><circle class="hole" cx="60" cy="168" r="13"/><rect class="ink" x="44" y="212" width="32" height="7" rx="3"/></svg>`,
  bass: `<svg viewBox="0 0 120 260" aria-hidden="true"><path class="ink-soft" d="M46 160 C40 132 24 120 24 156 C24 176 16 186 18 210 C20 242 50 254 60 254 C72 254 102 242 104 212 C106 188 98 178 98 160 C98 140 92 138 78 160 Z"/><rect class="ink" x="55" y="16" width="10" height="160" rx="2"/><path class="ink" d="M53 18 L50 0 L70 0 L67 18 Z"/><rect class="ink" x="46" y="186" width="28" height="9" rx="3"/><rect class="ink" x="46" y="206" width="28" height="7" rx="3"/><rect class="ink" x="44" y="226" width="32" height="7" rx="2"/></svg>`,
};
const TOOLBOX_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 9h18v10H3z M8 9V6h8v3 M3 13h18"/></svg>`;

// ---------- form schema ----------
function fieldsFor(type) {
  const isE = type === 'electric', isA = type === 'acoustic', isB = type === 'bass';
  const trem = s => ['trem-vintage', 'trem-2point', 'trem-locking'].includes(s.bridgeType);
  const filt = list => list.filter(o => !o[2] || o[2].includes(type));
  return [
    { group: 'Identify it', key: 'nickname', label: 'Nickname', kind: 'text', placeholder: 'e.g. "Yellow RG" (optional)' },
    { key: 'make', label: 'Make', kind: 'text', placeholder: 'e.g. Ibanez' },
    { key: 'model', label: 'Model', kind: 'text', placeholder: 'e.g. RG550' },
    { key: 'year', label: 'Year', kind: 'text', placeholder: 'optional' },

    { group: 'Strings', key: 'strings', label: 'Number of strings', kind: 'seg', options: OPTIONS.strings[type], num: true },
    { key: 'stringType', label: 'String type', kind: 'seg', options: OPTIONS.stringType, show: () => isA },
    { key: 'bassStringType', label: 'String type', kind: 'select', options: OPTIONS.bassStringType, show: () => isB },
    { key: 'gauge', label: 'String gauge', kind: 'chips', chips: GAUGES[type], placeholder: 'e.g. 10-46', help: 'What\'s on it now, lightest to heaviest.' },
    { key: 'tuning', label: 'Tuning', kind: 'chips', chips: TUNINGS[type], placeholder: 'e.g. E standard' },

    { group: 'Neck & fingerboard', key: 'scale', label: 'Scale length', kind: 'select', options: OPTIONS.scale[type] },
    { key: 'scaleCustom', label: 'Your scale length', kind: 'length', placeholder: 'e.g. 25 or 635 mm', show: s => s.scale === 'other', help: 'Inches or mm — the guide uses it for targets and the intonation check.' },
    { key: 'scaleMulti', label: 'Multi-scale lengths (bass side – treble side)', kind: 'length', multi: true, placeholder: 'e.g. 26.25-25.5', show: s => s.scale === 'multi' },
    { key: 'fretted', label: 'Fretted or fretless', kind: 'seg', options: OPTIONS.fretted, show: () => isB },
    { key: 'fbMaterial', label: 'Fingerboard material', kind: 'select', options: OPTIONS.fbMaterial },
    { key: 'fbFinish', label: 'Fingerboard finish', kind: 'select', options: OPTIONS.fbFinish, help: 'Maple boards are usually finished; rosewood, ebony and most dark woods are bare. This decides whether the board ever gets oiled.' },
    { key: 'radius', label: 'Fingerboard radius', kind: 'select', options: OPTIONS.radius },
    { key: 'radiusCustom', label: 'Your fingerboard radius', kind: 'length', placeholder: 'e.g. 17 or 430 mm', show: s => s.radius === 'other' },
    { key: 'frets', label: 'Number of frets', kind: 'number', show: s => s.fretted !== 'fretless' },
    { key: 'fretSize', label: 'Fret size', kind: 'select', options: OPTIONS.fretSize, show: s => s.fretted !== 'fretless' },
    { key: 'fretMaterial', label: 'Fret material', kind: 'select', options: OPTIONS.fretMaterial, show: s => s.fretted !== 'fretless' },
    { key: 'nut', label: 'Nut', kind: 'select', options: filt(OPTIONS.nut) },
    { key: 'neckJoint', label: 'Neck joint', kind: 'seg', options: OPTIONS.neckJoint },
    { key: 'trussAccess', label: 'Truss rod adjustment', kind: 'select', options: filt(OPTIONS.trussAccess) },
    { key: 'trussTool', label: 'Truss rod tool (if you know it)', kind: 'text', placeholder: 'e.g. 4 mm hex, 5/16" nut driver', show: s => s.trussAccess !== 'none' },

    { group: 'Bridge & hardware', key: 'bridgeType', label: 'Bridge type', kind: 'select', options: OPTIONS.bridgeElectric, show: () => isE },
    { key: 'bridgeType', label: 'Bridge type', kind: 'select', options: OPTIONS.bridgeBass, show: () => isB },
    { key: 'bridgeModel', label: 'Bridge model', kind: 'text', list: 'bridge-models', placeholder: 'e.g. Gotoh 510TS (optional)', show: () => isE || isB, help: 'Known models add model-specific notes to the guide.' },
    { key: 'tremSetup', label: 'Tremolo setup', kind: 'cards', options: OPTIONS.tremSetup, show: s => isE && trem(s) },
    { key: 'springs', label: 'Trem springs', kind: 'number', show: s => isE && trem(s) },
    { key: 'stringLoad', label: 'Strings load', kind: 'seg', options: OPTIONS.stringLoad, show: () => isB },
    { key: 'bridgeAcoustic', label: 'Bridge', kind: 'cards', options: OPTIONS.bridgeAcoustic, show: () => isA },
    { key: 'saddle', label: 'Saddle material', kind: 'select', options: OPTIONS.saddle, show: () => isA },
    { key: 'top', label: 'Construction', kind: 'select', options: OPTIONS.top, show: () => isA, help: 'Solid wood is much more sensitive to humidity.' },
    { key: 'lockingTuners', label: 'Locking tuners', kind: 'seg', options: OPTIONS.yesNo, show: () => isE },

    { group: 'Electronics', key: 'pickups', label: 'Pickup layout', kind: 'select', options: OPTIONS.pickupsElectric, show: () => isE },
    { key: 'pickups', label: 'Pickup layout', kind: 'select', options: OPTIONS.pickupsBass, show: () => isB },
    { key: 'pickupNotes', label: 'Pickup models', kind: 'text', placeholder: 'optional, e.g. DiMarzio Evolution', show: () => isE || isB },
    { key: 'active', label: 'Active electronics', kind: 'seg', options: OPTIONS.yesNo, show: () => isE || isB },
    { key: 'electronics', label: 'Pickup system', kind: 'select', options: OPTIONS.electronicsAcoustic, show: () => isA },
    { key: 'battery', label: 'Battery', kind: 'select', options: OPTIONS.battery, show: s => (isA && !['none', NOT_SURE].includes(s.electronics)) || ((isE || isB) && s.active === 'yes') },

    { group: 'Woods & finishes', key: 'bodyWood', label: 'Body wood', kind: 'text', placeholder: 'e.g. Alder, mahogany, spruce top' },
    { key: 'bodyFinish', label: 'Body finish', kind: 'select', options: OPTIONS.finish },
    { key: 'neckFinish', label: 'Neck finish', kind: 'select', options: OPTIONS.finish, help: 'Feels smooth-but-not-shiny? That\'s satin. Older or high-end Gibsons, Gretsches and Martins are often nitro.' },

    { group: 'How you play', key: 'style', label: 'Playing style', kind: 'cards', options: OPTIONS.style },
    { key: 'climate', label: 'Where it lives', kind: 'cards', options: OPTIONS.climate },
    { key: 'notes', label: 'Notes', kind: 'textarea', placeholder: 'Anything else — mods, quirks, what you\'d like to fix' },
  ];
}
const TOP_KEYS = ['make', 'model', 'nickname'];

// ---------- chrome ----------
function h(html) { app.innerHTML = html; window.scrollTo(0, 0); }

function topbar({ back, title, actions } = {}) {
  const right = actions ?? (state.me ? `<a class="btn small ghost" href="#/tools">${TOOLBOX_ICON}<span class="hide-narrow">My toolbox</span></a>` : '');
  return `<header class="topbar">
    <div class="topbar-inner">
      ${back ? `<a class="btn ghost back" href="${back}" aria-label="Back"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg><span>Back</span></a>` : `<a class="brand" href="#/"><span class="brand-mark">${ICONS.electric}</span> Setup Bench</a>`}
      ${title ? `<div class="topbar-title">${title}</div>` : '<div></div>'}
      <div class="topbar-actions">${right}</div>
    </div>
  </header>`;
}
// Model library: the starter set shipped with the app, plus specs saved on this server (which win on a match).
const libKey = m => `${m.type}:${`${m.make} ${m.model}`.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}`;
async function loadLibrary() {
  const [seed, saved] = await Promise.all([
    fetch('data/models.json').then(r => r.json()).then(d => d.models),
    api('GET', '/api/models'),
  ]);
  const byKey = new Map(seed.map(m => [libKey(m), m]));
  for (const m of saved) {
    const prev = byKey.get(libKey(m));
    // A saved entry replaces the starter one but keeps its search aliases and sheet badge.
    byKey.set(libKey(m), { ...m, aliases: prev ? prev.aliases : [], source: prev && prev.source === 'sheet' ? 'sheet' : 'saved', savedOver: !!prev });
  }
  state.library = [...byKey.values()];
}

async function saveToLibrary(inst) {
  if (!inst.model) return;
  const entry = { type: inst.type, make: inst.make || '', model: inst.model, spec: inst.spec };
  await api('PUT', '/api/models', entry);
  state.library = null; // reload on next use
}

async function loadInstruments() {
  state.instruments = await api('GET', '/api/instruments');
  state.loaded = true;
}

// Move instruments the very first version saved in this browser onto the server.
async function importLegacy() {
  let list = [];
  try { list = JSON.parse(localStorage.getItem(LEGACY_KEY)) || []; } catch { return; }
  const fresh = list.filter(i => i && i.id && i.type && i.spec && !findInst(i.id));
  for (const inst of fresh) await saveInst(inst);
  try { localStorage.removeItem(LEGACY_KEY); } catch { /* ignore */ }
  if (fresh.length) toast(`Moved ${fresh.length} instrument${fresh.length === 1 ? '' : 's'} saved on this device onto the server.`);
}

// ---------- views: home ----------
function viewHome() {
  const list = state.instruments;
  const tb = state.me.toolbox;
  const cards = list.map(inst => {
    const sub = [inst.make, inst.model].filter(Boolean).join(' ');
    const miss = tb.set ? buildGuide(inst, { owned: owned() }).missingTools.length : 0;
    return `<li class="saved">
      <a class="saved-main" href="#/guide/${inst.id}">
        <span class="saved-icon">${ICONS[inst.type]}</span>
        <span class="saved-text"><strong>${esc(inst.nickname || sub || INSTRUMENTS[inst.type].label)}</strong>
        <span class="muted">${esc(inst.nickname && sub ? sub : INSTRUMENTS[inst.type].label)}${inst.spec.gauge ? ` · ${esc(inst.spec.gauge)}` : ''}</span>
        ${miss ? `<span class="chip missing small">${miss} tool${miss === 1 ? '' : 's'} missing</span>` : ''}</span>
      </a>
      <a class="btn small ghost" href="#/edit/${inst.id}">Edit</a>
    </li>`;
  }).join('');

  h(`${topbar()}
  <main class="wrap home">
    <section class="hero">
      <h1>Set up your instrument</h1>
      <p class="lede">Pick what you're working on, choose the model, and get a step-by-step setup guide tailored to that exact guitar or bass.</p>
    </section>
    ${!tb.set ? `<a class="banner" href="#/tools">${TOOLBOX_ICON}<span><strong>Set up your toolbox.</strong> Tick the tools you own and every guide will flag what you're missing.</span><span class="chev">›</span></a>` : ''}
    <div class="instrument-grid">
      ${Object.entries(INSTRUMENTS).map(([k, v]) => `
        <a class="instrument-card" href="#/new/${k}">
          <span class="instrument-art">${ICONS[k]}</span>
          <span class="instrument-label">${v.label}</span>
        </a>`).join('')}
    </div>
    ${list.length ? `<section class="saved-section"><h2>Your instruments</h2><ul class="saved-list">${cards}</ul></section>` : ''}
  </main>`);
}

// ---------- views: toolbox ----------
function viewTools(welcome) {
  const tb = state.me.toolbox;
  const have = new Set(tb.tools);
  const custom = [...tb.custom];
  h(`${topbar({ back: '#/', title: 'My toolbox', actions: '' })}
  <main class="wrap tools-page">
    <h1>My toolbox</h1>
    <p class="lede">${welcome ? 'One last step: tap every tool you own. ' : ''}Each setup guide checks what it needs against this list and warns you about anything missing. Changes save automatically.</p>
    <p class="save-state muted small-text" id="save-state" aria-live="polite">${tb.set ? `${have.size} tools ticked` : 'Nothing ticked yet'}</p>
    ${TOOL_CATALOG.map(cat => `
      <fieldset class="group">
        <legend>${cat.cat}</legend>
        <div class="tool-grid">
          ${cat.items.map(([id, label]) => `<button type="button" class="tool-toggle" data-tool="${id}" aria-pressed="${have.has(id)}"><span class="box" aria-hidden="true"></span><span>${esc(label)}</span></button>`).join('')}
        </div>
      </fieldset>`).join('')}
    <fieldset class="group">
      <legend>Other tools you own</legend>
      <p class="help">Specific brands or anything not listed, for your own reference — e.g. "SHREDNECK TremTool 2", "Ibanez MTZ11 multi-tool".</p>
      <ul class="custom-list" id="custom-list"></ul>
      <form class="custom-add" id="custom-add"><input type="text" id="custom-input" placeholder="Add a tool" autocomplete="off"><button class="btn secondary" type="submit">Add</button></form>
    </fieldset>
    ${welcome ? '<a class="btn primary large block" href="#/">Done</a>' : ''}
  </main>`);

  const stateEl = document.getElementById('save-state');
  let timer;
  const save = () => {
    stateEl.textContent = 'Saving…';
    clearTimeout(timer);
    timer = setTimeout(async () => {
      try {
        state.me.toolbox = await api('PUT', '/api/toolbox', { tools: [...have], custom });
        stateEl.textContent = `Saved · ${have.size} tools ticked`;
      } catch (e) { stateEl.textContent = `Couldn't save: ${e.message}`; }
    }, 350);
  };
  app.querySelectorAll('[data-tool]').forEach(b => b.onclick = () => {
    const id = b.dataset.tool;
    if (have.has(id)) have.delete(id); else have.add(id);
    b.setAttribute('aria-pressed', String(have.has(id)));
    save();
  });
  const listEl = document.getElementById('custom-list');
  const drawCustom = () => {
    listEl.innerHTML = custom.map((t, i) => `<li><span>${esc(t)}</span><button type="button" class="btn small ghost" data-rm="${i}" aria-label="Remove ${esc(t)}">Remove</button></li>`).join('') || '<li class="muted">None yet.</li>';
    listEl.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { custom.splice(+b.dataset.rm, 1); drawCustom(); save(); });
  };
  drawCustom();
  document.getElementById('custom-add').onsubmit = e => {
    e.preventDefault();
    const inp = document.getElementById('custom-input');
    const v = inp.value.trim(); if (!v) return;
    custom.push(v); inp.value = ''; drawCustom(); save();
  };
}

// ---------- views: pick a model from the library ----------
const SOURCE_LABEL = { sheet: 'Your instrument', saved: 'Saved', catalog: 'Common model' };

async function viewModel(type) {
  if (!INSTRUMENTS[type]) return go('#/');
  if (!state.library) await loadLibrary();
  const models = state.library.filter(m => m.type === type);
  const example = { electric: 'Strat, RG550, Les Paul', acoustic: 'APX500II, D-28, 314ce', bass: 'Jazz Bass, StingRay' }[type];
  h(`${topbar({ back: '#/', title: INSTRUMENTS[type].label })}
  <main class="wrap narrow">
    <h1>What's the model?</h1>
    <p class="lede">Search the model library. Pick a match to start from its specs — you'll check every one before the guide is built.</p>
    <div class="field">
      <label for="q">Make or model</label>
      <input id="q" type="search" autocomplete="off" placeholder="e.g. ${esc(example)}">
    </div>
    <div id="results"></div>
    <div class="divider"><span>not listed?</span></div>
    <button class="btn block secondary" id="skip">Enter specs myself</button>
    <p class="help center">Specs you enter are saved to your library, so the model is listed next time.</p>
  </main>`);

  const input = document.getElementById('q');
  const results = document.getElementById('results');
  const norm = t => String(t).toLowerCase().replace(/[^a-z0-9$]+/g, ' ').trim();
  const score = (m, q) => {
    if (!q) return m.source === 'sheet' ? 3 : m.source === 'saved' ? 2 : 1;
    const name = norm(`${m.make} ${m.model}`), words = q.split(' ');
    if (name.includes(q) || m.aliases.some(a => norm(a) === q)) return 10;
    if (words.every(w => name.includes(w) || m.aliases.some(a => norm(a).includes(w)))) return 6;
    if (m.aliases.some(a => q.includes(norm(a)) && norm(a).length > 2)) return 4;
    return 0;
  };
  const row = m => `<li><button class="preset" data-id="${esc(m.id)}"><span class="preset-name"><strong>${esc(m.make)}</strong> ${esc(m.model)}</span><span class="chip src-${m.source}">${SOURCE_LABEL[m.source]}</span><span class="chev">›</span></button></li>`;
  const render = () => {
    const q = norm(input.value);
    const hits = models.map(m => [m, score(m, q)]).filter(x => x[1] > 0)
      .sort((a, b) => b[1] - a[1] || a[0].make.localeCompare(b[0].make) || a[0].model.localeCompare(b[0].model)).map(x => x[0]);
    if (!q) {
      const mine = hits.filter(m => m.source !== 'catalog'), common = hits.filter(m => m.source === 'catalog');
      results.innerHTML = (mine.length ? `<h2 class="list-head">Your instruments &amp; saved models</h2><ul class="preset-list">${mine.map(row).join('')}</ul>` : '')
        + `<h2 class="list-head">Common models</h2><ul class="preset-list">${common.map(row).join('')}</ul>`;
    } else {
      results.innerHTML = hits.length ? `<ul class="preset-list">${hits.slice(0, 25).map(row).join('')}</ul>`
        : `<ul class="preset-list"><li class="empty">Nothing matches “${esc(input.value)}”. Use <strong>Enter specs myself</strong> — we'll keep what you typed as the model.</li></ul>`;
    }
  };
  input.oninput = render; render();

  results.onclick = e => {
    const b = e.target.closest('.preset'); if (!b) return;
    const m = models.find(x => x.id === b.dataset.id);
    draft = { id: null, type, make: m.make, model: m.model, nickname: '', spec: { ...blankSpec(type), ...cleanSpec(type, m.spec) }, log: [], progress: {},
      lib: { source: m.source, note: m.note || '', verify: m.verify || [], savedBy: m.savedBy || null } };
    go('#/specs');
  };
  document.getElementById('skip').onclick = () => {
    // Best guess at make/model from what was typed: first word is usually the brand.
    const typed = input.value.trim().split(/\s+/);
    const make = typed.length > 1 ? typed[0] : '', model = typed.length > 1 ? typed.slice(1).join(' ') : typed.join(' ');
    draft = { id: null, type, make, model, nickname: '', spec: blankSpec(type), log: [], progress: {} };
    go('#/specs');
  };
}

// Keep only known keys with values the form understands.
function cleanSpec(type, spec) {
  const out = {};
  const blank = blankSpec(type);
  for (const [k, v] of Object.entries(spec || {})) {
    if (!(k in blank)) continue;
    if (v === null || v === '') continue;
    out[k] = v;
  }
  return out;
}

// ---------- views: spec form ----------
function viewSpecs(existingId) {
  if (existingId) {
    const inst = findInst(existingId);
    if (!inst) return go('#/');
    draft = JSON.parse(JSON.stringify(inst));
  }
  if (!draft) return go('#/');
  const d = draft;
  const type = d.type;
  const fields = fieldsFor(type);
  const getV = k => TOP_KEYS.includes(k) ? d[k] : d.spec[k];
  const setV = (k, v) => { if (TOP_KEYS.includes(k)) d[k] = v; else d.spec[k] = v; };
  // Library fields marked as estimates stay flagged until the user touches them.
  const unchecked = new Set(!existingId && d.lib ? d.lib.verify : []);

  let groupOpen = false;
  const parts = [];
  fields.forEach((f, idx) => {
    if (f.group) {
      if (groupOpen) parts.push('</div></fieldset>');
      parts.push(`<fieldset class="group"><legend>${f.group}</legend><div class="group-grid">`);
      groupOpen = true;
    }
    parts.push(renderField(f, idx, getV(f.key), unchecked.has(f.key)));
  });
  if (groupOpen) parts.push('</div></fieldset>');

  const L = d.lib;
  const origin = L && ({ sheet: 'Filled from your Instrument Info sheet', saved: `Filled from your library${L.savedBy ? ` (saved by ${esc(L.savedBy)})` : ''}`, catalog: 'Filled with typical factory specs' })[L.source];
  const libCard = L && !existingId ? `
    <section class="lib-card">
      <h2>${origin} for the ${esc([d.make, d.model].filter(Boolean).join(' '))}</h2>
      <p>${L.source === 'catalog' ? 'Specs change by year and region, so check each one against your instrument. ' : ''}${esc(L.note || '')}</p>
      ${unchecked.size ? `<p class="check-count"><span class="chip verify">Check</span> ${unchecked.size} field${unchecked.size === 1 ? ' is an estimate or varies' : 's are estimates or vary'} between versions. They're marked below.</p>` : ''}
    </section>` : '';

  h(`${topbar({ back: existingId ? `#/guide/${existingId}` : `#/new/${type}`, title: existingId ? 'Edit specs' : 'Specs' })}
  <main class="wrap form-wrap">
    <h1>${existingId ? 'Edit specs' : 'Check the specs'}</h1>
    ${libCard || `<p class="lede">${existingId ? 'Changes update the guide straight away.' : 'Fill in what you know. Anything left on “Not sure” gets general guidance that covers the common cases.'}</p>`}
    <form id="spec-form" novalidate>
      ${parts.join('')}
      <datalist id="bridge-models">${BRIDGE_MODELS.map(m => `<option value="${esc(m)}">`).join('')}</datalist>
      <div class="form-actions">
        ${existingId ? `<button type="button" class="btn danger ghost" id="delete">Delete</button>` : '<span></span>'}
        <button type="submit" class="btn primary large">${existingId ? 'Save & view guide' : 'Generate setup guide'}</button>
      </div>
    </form>
  </main>`);

  const form = document.getElementById('spec-form');
  const markChecked = wrap => {
    wrap.classList.remove('uncertain');
    const b = wrap.querySelector('.chip.verify'); if (b) b.remove();
  };
  const refreshVisibility = () => {
    fields.forEach((f, idx) => {
      const el = form.querySelector(`[data-field="${idx}"]`);
      if (el) el.hidden = !(!f.show || f.show(d.spec, type));
    });
    form.querySelectorAll('fieldset.group').forEach(fs => { fs.hidden = ![...fs.querySelectorAll('[data-field]')].some(x => !x.hidden); });
  };
  form.addEventListener('input', e => {
    const el = e.target.closest('[data-key]'); if (!el) return;
    const wrap = el.closest('[data-field]');
    const f = fields[+wrap.dataset.field];
    let v = el.value;
    if (f.kind === 'number') v = v === '' ? '' : Number(v);
    setV(f.key, v);
    markChecked(wrap);
    if (f.kind === 'chips') syncPressed(wrap, v);
    if (f.kind === 'length') wrap.querySelector('[data-parsed]').textContent = lengthPreview(f, v);
    if (f.key === 'fbMaterial' && d.spec.fbFinish === NOT_SURE && v !== NOT_SURE) {
      d.spec.fbFinish = v === 'maple' ? 'finished' : 'unfinished';
      const sel = form.querySelector('[data-key="fbFinish"]'); if (sel) sel.value = d.spec.fbFinish;
    }
    refreshVisibility();
  });
  // A focused-and-left select also counts as "checked" — the user looked at it.
  form.addEventListener('change', e => { const w = e.target.closest('[data-field]'); if (w) markChecked(w); });
  form.addEventListener('click', e => {
    const opt = e.target.closest('[data-opt]');
    if (!opt) return;
    const wrap = opt.closest('[data-field]');
    const f = fields[+wrap.dataset.field];
    let v = opt.dataset.opt;
    if (f.num) v = Number(v);
    if (f.kind === 'chips') wrap.querySelector('input').value = v;
    setV(f.key, v);
    syncPressed(wrap, v);
    markChecked(wrap);
    refreshVisibility();
  });
  form.onsubmit = async e => {
    e.preventDefault();
    const btn = form.querySelector('button[type=submit]'); btn.disabled = true;
    if (!d.id) d.id = uid();
    try {
      await saveInst(d);
      saveToLibrary(d).catch(() => toast('Saved, but couldn\'t add it to the model library.', 'error'));
      const id = d.id; draft = null;
      go(`#/guide/${id}`);
    } catch (ex) { toast(ex.message, 'error'); btn.disabled = false; }
  };
  const del = document.getElementById('delete');
  if (del) del.onclick = async () => {
    if (!confirm('Delete this instrument and its setup log?')) return;
    await api('DELETE', `/api/instruments/${d.id}`);
    state.instruments = state.instruments.filter(i => i.id !== d.id);
    draft = null; go('#/');
  };
  refreshVisibility();
}

function lengthPreview(f, v) {
  if (!String(v ?? '').trim()) return '';
  if (f.multi) { const p = parseMulti(v); return p ? `✓ ${fmtIn(p[0])} to ${fmtIn(p[1])}` : 'Enter two lengths, like 26.25-25.5'; }
  const n = parseLength(v);
  return n ? `✓ ${fmtIn(n)}` : 'Enter a number in inches or mm, like 25 or 635 mm';
}

function syncPressed(wrap, v) {
  wrap.querySelectorAll('[data-opt]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.opt === String(v))));
}

function renderField(f, idx, value, uncertain) {
  const id = `f-${idx}`;
  const help = f.help ? `<p class="help">${f.help}</p>` : '';
  const wide = ['cards', 'chips', 'textarea'].includes(f.kind) ? ' wide' : '';
  const v = value ?? '';
  let control = '';
  switch (f.kind) {
    case 'text':
      control = `<input id="${id}" data-key="${f.key}" type="text" value="${esc(v)}" placeholder="${esc(f.placeholder || '')}" ${f.list ? `list="${f.list}"` : ''} autocomplete="off">`;
      break;
    case 'number':
      control = `<input id="${id}" data-key="${f.key}" type="number" inputmode="numeric" min="0" max="36" value="${esc(v)}">`;
      break;
    case 'length':
      control = `<input id="${id}" data-key="${f.key}" type="text" inputmode="decimal" value="${esc(v)}" placeholder="${esc(f.placeholder || '')}" autocomplete="off"><p class="help parsed" data-parsed>${lengthPreview(f, v)}</p>`;
      break;
    case 'textarea':
      control = `<textarea id="${id}" data-key="${f.key}" rows="3" placeholder="${esc(f.placeholder || '')}">${esc(v)}</textarea>`;
      break;
    case 'select':
      control = `<div class="select"><select id="${id}" data-key="${f.key}">${f.options.map(o => `<option value="${esc(o[0])}" ${String(o[0]) === String(v) ? 'selected' : ''}>${esc(o[1])}</option>`).join('')}</select></div>`;
      break;
    case 'seg': case 'cards':
      control = `<div class="${f.kind}" role="group" aria-labelledby="${id}-l">${f.options.map(o => `<button type="button" data-opt="${esc(o[0])}" aria-pressed="${String(o[0]) === String(v)}">${esc(o[1])}</button>`).join('')}</div>`;
      break;
    case 'chips':
      control = `<input id="${id}" data-key="${f.key}" type="text" value="${esc(v)}" placeholder="${esc(f.placeholder || '')}" autocomplete="off">
        <div class="chips">${f.chips.map(c => `<button type="button" data-opt="${esc(c)}" aria-pressed="${c === v}">${esc(c)}</button>`).join('')}</div>`;
      break;
  }
  const labelFor = ['seg', 'cards'].includes(f.kind) ? '' : `for="${id}"`;
  return `<div class="field${wide}${uncertain ? ' uncertain' : ''}" data-field="${idx}"><label id="${id}-l" ${labelFor}>${f.label}${uncertain ? ' <span class="chip verify">Check</span>' : ''}</label>${control}${help}</div>`;
}

// ---------- views: guide ----------
function viewGuide(id) {
  const inst = findInst(id);
  if (!inst) return go('#/');
  const g = buildGuide(inst, { owned: owned() });
  const subtitle = [inst.make, inst.model, inst.spec.year].filter(Boolean).join(' ');
  const done = Object.values(inst.progress || {}).filter(Boolean).length;
  const miss = g.missingTools;

  h(`${topbar({ back: '#/', actions: `<a class="btn small ghost" href="#/edit/${id}">Edit specs</a><button class="btn small ghost" id="print">Print</button>` })}
  <main class="guide-layout">
    <nav class="toc" aria-label="Sections">
      <div class="toc-inner">${g.sections.map(s => `<a href="#sec-${s.id}" data-sec="${s.id}">${s.title}${s.id === 'tools' && miss.length ? ` <span class="dot" aria-label="${miss.length} missing"></span>` : ''}</a>`).join('')}</div>
    </nav>
    <article class="guide">
      <header class="guide-head">
        <span class="guide-icon">${ICONS[inst.type]}</span>
        <div>
          <p class="eyebrow">${INSTRUMENTS[inst.type].label} setup guide</p>
          <h1>${esc(g.name)}</h1>
          ${subtitle && inst.nickname ? `<p class="muted">${esc(subtitle)}</p>` : ''}
          <p class="muted small-text progress-line"><span id="done-count">${done}</span> <span id="done-word">${done === 1 ? 'step' : 'steps'}</span> checked off · <button class="linklike" id="reset">Clear checkmarks</button></p>
        </div>
      </header>
      ${miss.length ? `<a class="banner warn" href="#sec-tools" data-jump="tools"><span class="banner-icon" aria-hidden="true">!</span><span><strong>You're missing ${miss.length} tool${miss.length === 1 ? '' : 's'} this guide needs:</strong> ${miss.map(m => esc(m.toolLabel)).join(', ')}.</span><span class="chev">›</span></a>` : ''}
      ${g.sections.map(s => `<section class="gsec" id="sec-${s.id}"><h2>${s.title}</h2>${s.html}</section>`).join('')}
    </article>
  </main>`);

  const progress = inst.progress || (inst.progress = {});
  document.querySelectorAll('[data-step]').forEach(li => { if (progress[li.dataset.step]) li.classList.add('done'); });
  const countEl = document.getElementById('done-count');
  const setCount = n => { countEl.textContent = n; document.getElementById('done-word').textContent = n === 1 ? 'step' : 'steps'; };
  app.querySelector('.guide').addEventListener('click', e => {
    const btn = e.target.closest('.check'); if (!btn) return;
    const li = btn.closest('[data-step]');
    const on = !li.classList.contains('done');
    li.classList.toggle('done', on);
    if (on) progress[li.dataset.step] = true; else delete progress[li.dataset.step];
    setCount(Object.keys(progress).length);
    saveSoon(inst);
  });
  document.getElementById('reset').onclick = () => {
    Object.keys(progress).forEach(k => delete progress[k]);
    document.querySelectorAll('[data-step].done').forEach(li => li.classList.remove('done'));
    setCount(0); saveSoon(inst);
  };
  document.getElementById('print').onclick = () => window.print();

  // In-page jumps scroll without touching the hash route.
  const jump = sec => document.getElementById(`sec-${sec}`).scrollIntoView({ behavior: 'smooth', block: 'start' });
  app.querySelector('.guide-layout').addEventListener('click', e => {
    const a = e.target.closest('a[data-sec], a[data-jump], .guide a[href^="#sec-"]'); if (!a) return;
    e.preventDefault();
    jump(a.dataset.sec || a.dataset.jump || a.getAttribute('href').slice(5));
  });

  // Highlight the section under the top third of the screen.
  const links = new Map([...document.querySelectorAll('.toc a')].map(a => [a.dataset.sec, a]));
  const secs = [...document.querySelectorAll('.gsec')];
  let current = null, ticking = false;
  const update = () => {
    ticking = false;
    if (!document.body.contains(secs[0])) { window.removeEventListener('scroll', onScroll); return; }
    const line = window.innerHeight * 0.3;
    let active = secs[0];
    for (const s of secs) { if (s.getBoundingClientRect().top <= line) active = s; else break; }
    if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) active = secs[secs.length - 1];
    if (active === current) return;
    current = active;
    links.forEach(l => l.classList.remove('active'));
    const l = links.get(active.id.slice(4));
    if (l) { l.classList.add('active'); l.scrollIntoView({ block: 'nearest', inline: 'center' }); }
  };
  const onScroll = () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } };
  window.addEventListener('scroll', onScroll, { passive: true });
  update();

  renderLog(inst, g);
}

function renderLog(inst, g) {
  const host = document.querySelector('[data-log]');
  if (!host) return;
  const t = g.targets;
  const log = inst.log || (inst.log = []);
  const hasRelief = inst.spec.trussAccess !== 'none';
  const draw = () => {
    host.innerHTML = `<p>Record what you actually set each time, newest first, so the next setup starts from your numbers instead of the factory's. Targets for reference: ${hasRelief ? `relief ${t.relief[0]}–${t.relief[1]} mm, ` : ''}action ${t.treble} / ${t.bass} mm at the ${t.fret}th.</p>
    <form class="log-form" id="log-form">
      <div class="field"><label for="lg-date">Date</label><input id="lg-date" type="date" value="${today()}"></div>
      <div class="field"><label for="lg-strings">Strings</label><input id="lg-strings" type="text" value="${esc(inst.spec.gauge || '')}"></div>
      ${hasRelief ? '<div class="field"><label for="lg-relief">Relief (mm)</label><input id="lg-relief" type="text" inputmode="decimal" placeholder="0.25"></div>' : ''}
      <div class="field"><label for="lg-hi">Action, high (mm)</label><input id="lg-hi" type="text" inputmode="decimal" placeholder="${t.treble}"></div>
      <div class="field"><label for="lg-lo">Action, low (mm)</label><input id="lg-lo" type="text" inputmode="decimal" placeholder="${t.bass}"></div>
      <div class="field wide"><label for="lg-notes">Notes</label><input id="lg-notes" type="text" placeholder="e.g. 1/8 turn tighter on the rod, raised bridge pickup"></div>
      <button class="btn primary" type="submit">Add entry</button>
    </form>
    ${log.length ? `<div class="table-wrap"><table class="log"><thead><tr><th>Date</th><th>Strings</th>${hasRelief ? '<th>Relief</th>' : ''}<th>Action hi / lo</th><th>Notes</th><th></th></tr></thead><tbody>
      ${log.map((r, i) => `<tr><td>${esc(r.date)}</td><td>${esc(r.strings)}</td>${hasRelief ? `<td>${esc(r.relief)}</td>` : ''}<td>${esc(r.hi)} / ${esc(r.lo)}</td><td>${esc(r.notes)}</td><td><button class="btn small ghost" data-del="${i}" aria-label="Delete entry">✕</button></td></tr>`).join('')}
    </tbody></table></div>` : '<p class="muted">No entries yet.</p>'}`;
    host.querySelector('#log-form').onsubmit = e => {
      e.preventDefault();
      const val = sel => (host.querySelector(sel) || {}).value || '';
      log.unshift({ date: val('#lg-date'), strings: val('#lg-strings'), relief: val('#lg-relief'), hi: val('#lg-hi'), lo: val('#lg-lo'), notes: val('#lg-notes') });
      saveSoon(inst); draw();
    };
    host.querySelectorAll('[data-del]').forEach(b => b.onclick = () => {
      if (!confirm('Delete this log entry?')) return;
      log.splice(+b.dataset.del, 1); saveSoon(inst); draw();
    });
  };
  draw();
}

// ---------- router ----------
function go(hash) { if (location.hash === hash) route(); else location.hash = hash; }

async function route() {
  const raw = location.hash.replace(/^#\/?/, '');
  if (raw.startsWith('sec-')) return; // in-page anchor
  const [path, query] = raw.split('?');
  const [a, b] = path.split('/');

  if (!state.me) {
    try { state.me = await api('GET', '/api/me'); }
    catch (e) {
      return h(`${topbar({ actions: '' })}<main class="wrap narrow"><h1>Can't reach the server</h1><p class="lede">${esc(e.message)}. Make sure <code>server.py</code> is running on your computer, then reload.</p></main>`);
    }
  }
  if (!state.loaded) { await loadInstruments(); await importLegacy(); }
  if (a === 'tools') return viewTools(query === 'welcome');
  if (a === 'new' && b) return viewModel(b);
  if (a === 'specs') return viewSpecs();
  if (a === 'edit' && b) return viewSpecs(b);
  if (a === 'guide' && b) return viewGuide(b);
  return viewHome();
}

window.addEventListener('hashchange', route);
route();
