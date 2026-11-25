// Builds a tailored setup guide from an instrument spec.
// Output is a list of sections: { id, title, html }. Step lists carry data-step keys so
// the app can persist checkbox progress per instrument.

import { OPTIONS, NOT_SURE, BRIDGE_KB, TARGET_OVERRIDES, INSTRUMENTS, optionLabel, blankSpec, parseLength, scaleOf, fmtIn } from './data.js';
import { toolRequirements, checkTools } from './tools.js';

// ---------- small helpers ----------

export const esc = s => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const r1 = x => Math.round(x * 10) / 10;
const r2 = x => Math.round(x * 100) / 100;

function inches(mm, digits = 3) {
  return (mm / 25.4).toFixed(digits).replace(/^0/, '');
}
function sixtyFourths(mm) {
  const n = Math.round((mm / 25.4) * 64);
  if (n <= 0) return '';
  let num = n, den = 64;
  while (num % 2 === 0 && den > 2) { num /= 2; den /= 2; }
  return `${num}/${den}"`;
}
// "1.6 mm (0.063" · ≈4/64")"
function mm(x, { frac = false } = {}) {
  const f = frac && sixtyFourths(x) ? ` · ≈${sixtyFourths(x)}` : '';
  return `<span class="meas">${r1(x) === x ? x : r2(x)} mm</span> <span class="imp">(${inches(x)}"${f})</span>`;
}
function mmRange(a, b) {
  return `<span class="meas">${r2(a)}–${r2(b)} mm</span> <span class="imp">(${inches(a)}–${inches(b)}")</span>`;
}

const ul = items => `<ul>${items.filter(Boolean).map(i => `<li>${i}</li>`).join('')}</ul>`;
const callout = (kind, html) => `<div class="callout ${kind}"><span class="callout-label">${{ tip: 'Tip', warn: 'Careful', note: 'Note', info: 'For this guitar' }[kind]}</span><div>${html}</div></div>`;
const table = (head, rows, cls = '') => `<div class="table-wrap"><table class="${cls}"><thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
const sub = t => `<h3>${t}</h3>`;

// Ordered, checkable steps. Each <li> gets a stable key: `${prefix}.${n}`.
function steps(prefix, items) {
  const list = items.filter(Boolean);
  return `<ol class="steps">${list.map((s, i) => `<li data-step="${prefix}.${i + 1}"><button class="check" type="button" aria-label="Mark step ${i + 1} done"></button><div class="step-body">${s}</div></li>`).join('')}</ol>`;
}

function parseGauge(g) {
  const nums = String(g || '').match(/\d+(\.\d+)?/g);
  if (!nums || !nums.length) return null;
  const vals = nums.map(Number).filter(n => n > 0 && n < 200);
  if (!vals.length) return null;
  return { top: Math.min(...vals), bottom: Math.max(...vals) };
}

function radiusInfo(v, custom) {
  if (v === 'other') {
    const n = parseLength(custom);
    return n ? { known: true, inches: n, label: fmtIn(n), gauge: Math.round(n * 4) / 4 } : { known: false, label: 'unknown radius', gauge: null };
  }
  if (!v || v === NOT_SURE) return { known: false, label: 'unknown radius', gauge: null };
  if (v === 'flat') return { known: true, flat: true, label: 'flat', gauge: null };
  if (v.startsWith('c-')) {
    const [, a, b] = v.split('-');
    return { known: true, compound: true, a: +a, b: +b, label: `compound ${a}"–${b}"`, gauge: +b };
  }
  const n = +v;
  return { known: true, inches: n, label: `${n}" (${Math.round(n * 25.4)} mm)`, gauge: n };
}

// ---------- context: everything the sections need, derived once ----------

function buildContext(inst) {
  const s = inst.spec;
  const type = inst.type;
  const override = TARGET_OVERRIDES.find(o => o.match.test(`${inst.make || ''} ${inst.model || ''}`));
  const g = parseGauge(s.gauge);
  const tuning = String(s.tuning || '');
  const lowTuning = /(^|\s)(D standard|Drop C|C standard|B standard|Drop B|Drop A|A standard)/i.test(tuning) && type !== 'bass'
    || (type === 'bass' && /(D standard|Drop C|C standard)/i.test(tuning));
  const ext = s.strings >= 7 && type === 'electric' || s.strings >= 5 && type === 'bass';

  const bridge = s.bridgeType;
  const isTrem = ['trem-vintage', 'trem-2point', 'trem-locking'].includes(bridge);
  const tremSetup = isTrem ? (s.tremSetup || 'floating') : null;
  const kb = BRIDGE_KB.filter(k => (s.bridgeModel || '').toLowerCase().includes(k.match));

  const fbMat = s.fbMaterial;
  let fbFinish = s.fbFinish;
  if (fbFinish === NOT_SURE || !fbFinish) fbFinish = fbMat === 'maple' ? 'finished' : (fbMat === NOT_SURE ? NOT_SURE : 'unfinished');

  const name = inst.nickname || [s.make || inst.make, s.model || inst.model].filter(Boolean).join(' ') || INSTRUMENTS[type].label;
  const imperial = /fender|gibson|music man|martin|taylor|gretsch/i.test(inst.make || '') && !/squier|epiphone|player|mexico/i.test(`${inst.make} ${inst.model}`);
  const imperialKnown = imperial ? true : (inst.make ? false : null);
  const individualSaddles = ['trem-vintage', 'trem-2point', 'hardtail', 'tele-modern', 'headless', 'bass-vintage', 'bass-highmass', 'bass-monorail'].includes(bridge)
    || (bridge === 'wraparound' && /510ub/i.test(s.bridgeModel || ''));

  return {
    inst, s, type, override, g, tuning, lowTuning, ext, bridge, isTrem, tremSetup, kb, fbMat, fbFinish, name, imperial, imperialKnown, individualSaddles,
    isElectric: type === 'electric', isAcoustic: type === 'acoustic', isBass: type === 'bass',
    nylon: type === 'acoustic' && s.stringType === 'nylon',
    fretless: type === 'bass' && s.fretted === 'fretless',
    floating: tremSetup === 'floating',
    locking: bridge === 'trem-locking' || s.nut === 'locking',
    lockingNut: s.nut === 'locking',
    tom: bridge === 'tom-stopbar' || bridge === 'tom-through' || bridge === 'bass-tom',
    radius: radiusInfo(s.radius, s.radiusCustom),
    scaleLen: scaleOf(s),
    active: s.active === 'yes',
    hasBattery: (s.active === 'yes' || (type === 'acoustic' && !['none', NOT_SURE].includes(s.electronics))) && s.battery !== 'none',
    noRod: s.trussAccess === 'none',
    nitro: [s.bodyFinish, s.neckFinish].some(f => f === 'nitro' || f === 'nitro-satin'),
    solidWood: type === 'acoustic' && ['solid', 'all-solid'].includes(s.top),
    multiscale: s.scale === 'multi',
    headless: bridge === 'headless',
    lockingTuners: s.lockingTuners === 'yes',
    stainless: s.fretMaterial === 'stainless',
  };
}

// Short scales run lower tension (strings swing wider, so a little more action); long scales the opposite.
function scaleClass(c) {
  const n = c.scaleLen.inches;
  if (!n) return null;
  if (c.isBass) return n < 33 ? 'short' : n >= 35 ? 'long' : 'standard';
  if (c.isAcoustic && c.nylon) return n < 25 ? 'short' : 'standard';
  return n < 24.9 ? 'short' : n >= 26.4 ? 'long' : 'standard';
}

// ---------- measurement targets ----------

export function computeTargets(c) {
  const { s, type, g } = c;
  const heavy = s.style === 'heavy', light = s.style === 'light';
  let relief, treble, bass, fret = 12, nut, note = '';

  if (type === 'electric') {
    relief = g && g.top >= 11 ? [0.25, 0.35] : [0.20, 0.30];
    if (c.radius.inches && c.radius.inches <= 7.5) relief = [0.25, 0.35];
    treble = 1.6; bass = 2.0;
    if (c.radius.inches && c.radius.inches <= 7.5) treble += 0.2;
    if (c.lowTuning) { bass += 0.2; relief = relief.map(x => x + 0.05); }
    if (s.strings >= 7) bass += 0.2;
    nut = [0.05, 0.10];
  } else if (type === 'acoustic' && c.nylon) {
    relief = [0.10, 0.25]; treble = 3.0; bass = 3.8; nut = [0.10, 0.20];
  } else if (type === 'acoustic') {
    relief = [0.08, 0.15]; treble = 1.8; bass = 2.4; nut = [0.05, 0.13];
    if (s.strings === 12) { treble += 0.2; bass += 0.2; }
  } else {
    relief = c.fretless ? [0.10, 0.25] : [0.25, 0.40];
    treble = c.fretless ? 1.5 : 2.0; bass = c.fretless ? 2.0 : 2.5;
    if (s.strings >= 5) { bass += 0.3; relief = relief.map(x => x + 0.05); }
    if (c.lowTuning) bass += 0.2;
    nut = [0.10, 0.15];
  }
  const sc = scaleClass(c);
  if (sc === 'short') { treble += 0.1; bass += 0.1; note += `The ${r2(c.scaleLen.inches)}" scale runs lower string tension than ${type === 'bass' ? 'a 34"' : 'a 25.5"'} neck, so action is set a touch higher to keep the wider string swing off the frets. `; }
  if (sc === 'long') { relief = relief.map(x => x + 0.05); note += `The longer ${c.multiscale ? 'bass-side ' : ''}scale holds more tension, especially on the low strings; relief allows for that. `; }
  const styleAdj = type === 'bass' ? 0.3 : 0.2;
  if (heavy) { treble += styleAdj; bass += styleAdj; relief = relief.map(x => x + 0.05); }
  if (light) { treble -= styleAdj; bass -= styleAdj; }

  const t = { relief: relief.map(r2), fret, treble: r1(treble), bass: r1(bass), nut, note };
  const ov = c.override;
  const o = ov && ov.targets;
  // Factory targets only apply to the string gauge they were written for.
  if (o && (!ov.whenGaugeTop || (g && g.top === ov.whenGaugeTop))) {
    if (o.relief) t.relief = o.relief;
    if (o.actionFret) t.fret = o.actionFret;
    if (o.actionTreble) t.treble = o.actionTreble;
    if (o.actionBass) t.bass = o.actionBass;
    if (o.note) t.note = o.note + ' ' + note;
  }
  return t;
}

// Pickup starting heights, measured from pole top to string bottom with the string held at the last fret.
const PU = {
  single: { label: 'single-coil', bass: 3.2, treble: 2.4 },
  hum: { label: 'humbucker', bass: 2.4, treble: 1.6 },
  p90: { label: 'P-90', bass: 2.4, treble: 2.0 },
  activeHum: { label: 'active pickup', bass: 2.4, treble: 2.0 },
  P: { label: 'P pickup', bass: 2.8, treble: 2.0 },
  J: { label: 'J pickup', bass: 3.2, treble: 2.4 },
  MM: { label: 'MM humbucker', bass: 3.2, treble: 2.8 },
  soap: { label: 'soapbar humbucker', bass: 3.2, treble: 2.8 },
};

function pickupRows(c) {
  const { s } = c;
  const act = c.active;
  const H = act ? PU.activeHum : PU.hum;
  const S = PU.single;
  const map = {
    SSS: [['Bridge', S], ['Middle', S], ['Neck', S]], HSS: [['Bridge', H], ['Middle', S], ['Neck', S]],
    HSH: [['Bridge', H], ['Middle', S], ['Neck', H]], HH: [['Bridge', H], ['Neck', H]], H: [['Bridge', H]],
    SS: [['Bridge', S], ['Neck', S]], HS: [['Bridge', H], ['Neck', S]], P90: [['Bridge', PU.p90], ['Neck', PU.p90]],
    P: [['P', PU.P]], J: [['Bridge J', PU.J]], PJ: [['Neck P', PU.P], ['Bridge J', PU.J]], JJ: [['Neck J', PU.J], ['Bridge J', PU.J]],
    MM: [['MM', PU.MM]], MMS: [['MM (bridge)', PU.MM], ['Single (neck)', PU.J]], HH_bass: [['Neck', PU.soap], ['Bridge', PU.soap]],
  };
  const key = c.isBass && s.pickups === 'HH' ? 'HH_bass' : s.pickups;
  const rows = map[key];
  if (!rows) return [];
  return rows.map(([pos, p]) => {
    const neck = /neck/i.test(pos) && rows.length > 1 && c.isElectric;
    const add = neck ? 0.4 : 0;
    return { pos, type: p.label, bass: r1(p.bass + add), treble: r1(p.treble + add) };
  });
}

// ---------- sections ----------

function glance(c, t) {
  const { s, type } = c;
  const specRows = [];
  const add = (k, v) => { if (v && v !== NOT_SURE && !String(v).startsWith('Not sure')) specRows.push([k, v]); };
  add('Instrument', INSTRUMENTS[type].label);
  add('Model', [c.inst.make, c.inst.model, s.year].filter(Boolean).map(esc).join(' '));
  add('Strings', `${s.strings}-string${s.gauge ? `, ${esc(s.gauge)}` : ''}${s.tuning ? `, ${esc(s.tuning)}` : ''}${c.isBass && s.bassStringType !== NOT_SURE ? `, ${optionLabel(OPTIONS.bassStringType, s.bassStringType).toLowerCase()}` : ''}${c.nylon ? ', nylon' : ''}`);
  add('Scale length', s.scale === 'other' ? (c.scaleLen.inches ? fmtIn(c.scaleLen.inches) : 'Other (not entered)')
    : s.scale === 'multi' ? (c.scaleLen.multi ? `Multi-scale, ${fmtIn(c.scaleLen.multi[0])} bass side to ${fmtIn(c.scaleLen.multi[1])} treble side` : 'Multi-scale')
    : optionLabel(OPTIONS.scale[type], s.scale));
  if (c.isElectric || c.isBass) {
    add('Bridge', `${optionLabel(c.isBass ? OPTIONS.bridgeBass : OPTIONS.bridgeElectric, s.bridgeType)}${s.bridgeModel ? ` — ${esc(s.bridgeModel)}` : ''}${c.isTrem ? `, ${optionLabel(OPTIONS.tremSetup, s.tremSetup).toLowerCase()}` : ''}`);
  } else {
    add('Bridge', `${optionLabel(OPTIONS.bridgeAcoustic, s.bridgeAcoustic)}; ${optionLabel(OPTIONS.saddle, s.saddle).toLowerCase()} saddle`);
  }
  add('Nut', optionLabel(OPTIONS.nut, s.nut));
  add('Fingerboard', [optionLabel(OPTIONS.fbMaterial, s.fbMaterial), c.fbFinish !== NOT_SURE ? (c.fbFinish === 'finished' ? 'finished' : 'unfinished') : '', c.radius.known ? `${c.radius.label} radius` : ''].filter(x => x && x !== 'Not sure').join(', '));
  add('Frets', c.fretless ? 'Fretless' : [s.frets ? `${s.frets}` : '', s.fretSize !== NOT_SURE ? optionLabel(OPTIONS.fretSize, s.fretSize).toLowerCase() : '', s.fretMaterial !== NOT_SURE ? optionLabel(OPTIONS.fretMaterial, s.fretMaterial).toLowerCase() : ''].filter(Boolean).join(' '));
  add('Neck', [optionLabel(OPTIONS.neckJoint, s.neckJoint), s.trussAccess !== NOT_SURE ? `truss rod ${optionLabel(OPTIONS.trussAccess, s.trussAccess).toLowerCase()}` : '', s.trussTool ? esc(s.trussTool) : ''].filter(x => x && x !== 'Not sure').join(', '));
  if (c.isElectric || c.isBass) add('Pickups', `${optionLabel(c.isBass ? OPTIONS.pickupsBass : OPTIONS.pickupsElectric, s.pickups)}${c.active ? ', active' : ''}${s.pickupNotes ? ` — ${esc(s.pickupNotes)}` : ''}`);
  if (c.isAcoustic) add('Electronics', optionLabel(OPTIONS.electronicsAcoustic, s.electronics));
  if (c.isAcoustic) add('Construction', optionLabel(OPTIONS.top, s.top));
  add('Woods & finishes', [esc(s.bodyWood), s.bodyFinish !== NOT_SURE ? `body ${optionLabel(OPTIONS.finish, s.bodyFinish).toLowerCase()}` : '', s.neckFinish !== NOT_SURE ? `neck ${optionLabel(OPTIONS.finish, s.neckFinish).toLowerCase()}` : ''].filter(Boolean).join('; '));

  const hiName = c.isBass ? (s.strings >= 6 ? 'high C' : 'G') : 'high E';
  const loName = c.isBass ? (s.strings >= 5 ? 'low B' : 'low E') : (s.strings >= 7 ? 'lowest string' : 'low E');
  const targetRows = [];
  if (!c.noRod) targetRows.push(['Neck relief', mmRange(...t.relief), 'Capo at 1st fret, fret at the last fret, gap at the 7th–8th fret']);
  targetRows.push([`Action, ${hiName}`, mm(t.treble, { frac: true }), `Top of ${t.fret}th fret to bottom of string`]);
  targetRows.push([`Action, ${loName}`, mm(t.bass, { frac: true }), `Top of ${t.fret}th fret to bottom of string`]);
  if (!c.lockingNut && s.nut !== 'zero-fret') targetRows.push(['Nut height', `Gap over 1st fret ≈ ${mmRange(...t.nut)}`, 'Fret at the 3rd fret, look at the 1st']);
  if (c.isTrem) targetRows.push(['Tremolo', c.floating ? (c.bridge === 'trem-locking' ? 'Base plate parallel to body' : 'Rear of bridge lifted ≈ ' + mm(1.6, { frac: true }) + ' (or to taste)') : (c.tremSetup === 'decked' ? 'Bridge flat on the body at pitch' : 'Blocked, no movement'), 'Guitar fully in tune, arm untouched']);
  targetRows.push(['Intonation', c.fretless ? 'Stopped note at the 12th marker = 12th harmonic' : 'Fretted 12th = 12th harmonic', 'Tuner reading to 1 cent if possible']);
  pickupRows(c).forEach(p => targetRows.push([`${p.pos} pickup (${p.type})`, `${mm(p.treble, { frac: true })} treble / ${mm(p.bass, { frac: true })} bass`, 'String held at last fret, pole top to string bottom']));

  const intro = `These targets are tailored to a ${esc(s.gauge || 'stock')} set${c.lowTuning ? ' in a lowered tuning' : ''} and a ${s.style || 'medium'} playing style. ${t.note ? esc(t.note) + ' ' : ''}Start here, then tweak to taste and record what you land on in the setup log at the bottom.`;
  return `<p>${intro}</p>
    ${table(['Spec', 'This instrument'], specRows, 'spec')}
    ${table(['Measurement', 'Target', 'How it\'s measured'], targetRows, 'targets')}
    ${c.inst.lib && c.inst.lib.source === 'catalog' ? callout('note', 'Specs started from typical factory values for this model and were checked by you. If anything on the instrument turns out different, fix it in the spec form and the guide updates.') : ''}`;
}

function tools(c, owned) {
  const rows = checkTools(toolRequirements(c), owned);
  const missing = rows.filter(r => r.status === 'missing');
  const chip = r => ({
    have: '<span class="chip have">✓ Have</span>',
    missing: '<span class="chip missing">Missing</span>',
    optional: '<span class="chip optional">Optional</span>',
    unknown: r.required ? '<span class="chip need">Needed</span>' : '<span class="chip optional">Optional</span>',
  })[r.status];
  const summary = !owned
    ? callout('note', 'Add the tools you own in <a href="#/tools">My toolbox</a> and this list will flag anything you\'re missing.')
    : missing.length
      ? callout('warn', `You're missing ${missing.length} required tool${missing.length === 1 ? '' : 's'} for this guitar: ${missing.map(r => `<strong>${esc(r.toolLabel)}</strong>`).join(', ')}. Got one already? Tick it in <a href="#/tools">My toolbox</a>.`)
      : callout('tip', 'Your toolbox covers everything this guitar needs.');
  const sorted = [...rows].sort((a, b) => ({ missing: 0, unknown: 1, have: 2, optional: 3 }[a.status] - { missing: 0, unknown: 1, have: 2, optional: 3 }[b.status]));
  return `<p>Everything this guitar needs for a full setup${c.isElectric || c.isBass ? `. ${c.imperialKnown === true ? 'Your hardware is likely imperial' : c.imperialKnown === false ? 'Your hardware is likely metric' : 'Check whether your hardware is metric or imperial'}; a sloppy key strips screws fast, so test the fit before you turn` : ''}.</p>
    ${summary}
    <div class="table-wrap"><table class="tools"><thead><tr><th>Job</th><th>Tool</th><th></th></tr></thead><tbody>
    ${sorted.map(r => `<tr class="t-${r.status}"><td>${esc(r.job)}</td><td>${esc(r.toolLabel)}${r.note ? `<div class="sub-note">${esc(r.note)}</div>` : ''}</td><td class="chip-cell">${chip(r)}</td></tr>`).join('')}
    </tbody></table></div>`;
}

// Truss rod access helpers
const truss = {
  access(c) {
    switch (c.s.trussAccess) {
      case 'headstock': return 'The adjustment nut is at the headstock' + (/gibson|epiphone|prs/i.test(c.inst.make || '') ? ', under the truss rod cover (two or three small screws)' : ' (remove the cover first if there is one)') + '.';
      case 'heel': return 'The adjustment nut is at the body end of the neck. On many vintage-style guitars you can\'t reach it with the neck on: slack the strings, loosen the neck screws, tilt the neck or remove it, turn the nut, then reassemble and re-check. If there\'s a notch in the pickguard, a screwdriver may reach without removing anything. It\'s slow, so make each adjustment count.';
      case 'spoke': return 'A spoke wheel sits at the body end of the neck. Put a small rod or hex key into a hole in the wheel and push it around a quarter turn at a time — no neck removal needed.';
      case 'soundhole': return 'The adjustment nut is just inside the soundhole, at the end of the neck block. Use a long-arm hex key, and slacken the strings a little so you can get your hand in.';
      default: return 'Not sure where the adjustment is? Check the headstock (often under a small cover) first, then the body end of the neck' + (c.isAcoustic ? ', then inside the soundhole' : '') + '.';
    }
  },
};

function order(c) {
  const { s } = c;
  if (c.isTrem && c.floating) {
    return `<p>A trem block or stepped wedge in the rear cavity holds the bridge level, so during setup the bridge behaves like a hardtail. You set everything once, then let the springs take over at the end, instead of retuning after every change.</p>
    ${steps('order', [
      'Back off both trem claw screws about two full turns each, and count them. Now the strings will overpower the springs.',
      'Fit the block into the rear cavity so the bridge sits at its floating angle (see <a href="#sec-trem">Tremolo balance</a>).',
      `Put fresh strings on, stretch them, and tune to pitch${c.lockingNut ? ' with the locking nut open' : ''}. The bridge rests on the block, so the tuning holds after one pass.`,
      'Set neck relief.',
      c.bridge === 'trem-locking' ? 'Set action at the pivot studs.' : 'Set action — overall height at the pivot studs, then fine-tune at the saddles.',
      !c.lockingNut && s.nut !== 'zero-fret' ? 'Check nut height.' : null,
      'Set intonation.',
      'Set pickup height.',
      'Tighten the claw screws evenly until the block loosens and drops out. The bridge is now floating, at pitch.',
      c.lockingNut ? 'Centre the fine tuners, tune with the machine heads, lock the nut, and fine-tune.' : 'Retune, play hard, use the arm a few times, retune again.',
    ])}
    ${c.lockingNut ? callout('tip', 'Keep the locking nut unlocked until the last step — the fine tuners only have limited travel.') : ''}`;
  }
  if (c.isAcoustic) {
    return `<p>On an acoustic, action is set by the saddle, which you shape rather than turn — so the order matters even more. Do the reversible adjustments first and only take the saddle out once you know exactly how much to change.</p>
    ${steps('order', [
      'Put fresh strings on and tune to pitch. Old strings give false readings.',
      c.noRod ? 'Check neck relief (there\'s no truss rod — this is a reading only).' : 'Set neck relief at the truss rod. Wait a day and re-check if you moved it more than a quarter turn — acoustic necks settle slowly.',
      'Check nut height.',
      'Measure action at the 12th fret and work out how much the saddle needs to change.',
      'Lower or raise the saddle (only if needed).',
      'Check intonation.',
      !['none', NOT_SURE].includes(s.electronics) ? 'Check pickup balance and the battery.' : null,
    ])}
    ${callout('note', 'If relief is right and action is still high with the saddle already low (less than about 2 mm showing above the bridge), the neck angle has changed. That\'s a neck reset — a job for a luthier.')}`;
  }
  return `<p>Each adjustment affects the ones after it, so work in this order and don't skip ahead.</p>
    ${steps('order', [
      `Put fresh strings on${c.isTrem && c.tremSetup === 'decked' ? ', set spring tension so the bridge decks,' : ''} and tune to pitch.`,
      c.noRod ? null : 'Set neck relief.',
      'Set action.',
      !c.lockingNut && s.nut !== 'zero-fret' ? 'Check nut height.' : null,
      'Set intonation.',
      (c.isElectric || c.isBass) ? 'Set pickup height.' : null,
      'Retune, play for a while, and re-check — strings settle over the first day.',
    ])}`;
}

function stringChange(c) {
  const { s } = c;
  const kbNotes = c.kb.map(k => callout('info', esc(k.note))).join('');
  const tunerSteps = c.lockingTuners
    ? 'Pull the string taut past the locking tuner post, lock it, and tune up — about half to three-quarters of a turn on the post is all it needs.'
    : c.isBass
      ? 'Pull the string past its own tuner to the next post along and cut it there (bend it 90° at the cut point first so the windings can\'t slip). Push the end into the post, wind downward so the string wraps toward the headstock face. Keep the silk wrap off the nut.'
      : 'Leave enough string for 2–3 wraps on the plain strings and 1–2 on the wound ones (about 5–7 cm / 2–3" past the post). Wind downward on the post so each wrap sits below the last.';

  if (c.bridge === 'trem-locking') {
    return `<p>With a block in the rear cavity, you can change all ${s.strings} strings at once. When you tune up, the bridge stops on the block, so the new strings come to pitch in one pass instead of fighting the springs.</p>
    ${kbNotes}
    ${steps('strings', [
      'Tune to pitch. Back off both claw screws about two full turns each, counting the turns.',
      'Slide the block into the gap between the trem block and the butt-end wall of the rear cavity, at the height that holds the base plate parallel to the body.',
      'Set the fine tuners to the middle of their travel.',
      'Loosen the locking-nut clamp bolts. Each pad covers two or three strings; don\'t lose the pads.',
      'Slack each string at the tuner, loosen its string-clamp bolt at the saddle, and pull it out. Leave the clamp blocks in the saddles.',
      'With the strings off, clean the fingerboard if it\'s due (see Cleaning).',
      'Snip the ball end and the twisted wrap off each new string so you have a clean, straight end.',
      'Push the cut end into the saddle until it bottoms out, then tighten the clamp bolt snug — firm, not forced. Overtightening cracks clamp blocks and strips threads.',
      'Run the string over the open nut to the tuner, 2–3 wraps, wound downward on the post.',
      `Tune all ${s.strings} up to pitch. The bridge settles back on the block.`,
      'Stretch each string: pull it gently along its length, retune, repeat about three times.',
      'If you aren\'t doing a full setup, turn the claw screws back in by the turns you counted, evenly, until the block just drops out. Retune.',
      'Lock the nut and finish with the fine tuners.',
    ])}
    ${callout('warn', 'Changing gauge or tuning? Run the full Order of operations — spring tension, relief, action and intonation all move.')}`;
  }

  let anchor = '';
  let intro = '';
  switch (c.bridge) {
    case 'trem-vintage': case 'trem-2point':
      intro = c.floating
        ? 'Change one string at a time so the bridge stays balanced — or, to change them all at once, put the setup block in first (see Tremolo balance).'
        : 'With a decked or blocked bridge you can change one at a time or all at once.';
      anchor = 'Remove the rear cavity cover if you need to see the block. Feed each string through the hole in the back of the trem block, up through the bridge plate and over its saddle.';
      break;
    case 'tom-stopbar':
      intro = 'Change one string at a time. A tune-o-matic and stopbar are held on only by string pressure, so if all strings come off, parts can fall off and saddles can get mixed up.';
      anchor = 'Feed the new string through the stopbar from the back (tail side) so it comes out of the front, over the saddle and toward the nut.';
      break;
    case 'tom-through': case 'hardtail': case 'tele-vintage': case 'tele-modern':
      intro = 'You can change these all at once — the bridge is fixed — but one at a time keeps the neck under even tension.';
      anchor = 'Feed the string from the back of the body through its ferrule, until the ball end seats, then over its saddle.';
      break;
    case 'wraparound':
      intro = 'Change one string at a time so the wraparound stays seated on its studs.';
      anchor = 'Feed the string through the bar from the pickup side toward the tail, then wrap it back over the top of the bar toward the nut.';
      break;
    case 'bigsby':
      intro = 'Change one string at a time — a Bigsby is fiddly, and the bridge may be a floating type held only by string pressure.';
      anchor = 'Bend the last 1 cm of new string near the ball end into a slight hook. Hook the ball end over its pin on the roller bar, and keep light pressure on it (a finger, or a small piece of foam under the string) while you take up slack at the tuner.';
      break;
    case 'evertune':
      intro = 'Strings load into the EverTune module at the back. Keep the manual handy for tensioning each string into its working zone.';
      anchor = 'Feed the string into its module as the EverTune manual shows, then over the saddle.';
      break;
    case 'headless':
      intro = 'On a headless instrument the tuners are on the bridge and the strings anchor at the head piece. Change one string at a time so the neck keeps even tension. Systems differ in which end takes the ball — check the old string as it comes out, and copy it.';
      anchor = 'Slack the string fully with its tuner knob at the bridge, then release it from the head-piece clamp and the bridge. Fit the new string the same way round: seat the anchored end (usually the ball end, or the clamped end on double-ball sets), run it over the nut and saddle, and lock it in the bridge clamp with the tuner wound back near the start of its travel so you have room to tune up. Trim the excess with flush cutters.';
      break;
    case 'bass-vintage': case 'bass-highmass': case 'bass-monorail': case 'bass-tom': case 'other':
      if (c.isBass) {
        intro = 'Change one string at a time to keep even tension on the neck — and so you can copy the old string\'s length and wrap as you go.';
        anchor = s.stringLoad === 'through' ? 'Feed the string from the back of the body through its ferrule, then over the saddle.' : s.stringLoad === 'both' ? 'Load top-load through the back of the bridge plate, or through-body from the back — through-body gives more break angle over the saddles, top-load is easier and slightly slinkier.' : 'Feed the string through the back of the bridge plate, ball end first, and over its saddle.';
      } else {
        intro = 'Change one string at a time unless you know your bridge is fixed in place.';
        anchor = 'Anchor the ball end at the bridge or tailpiece the way the old string came out, then run it over the saddle.';
      }
      break;
  }

  if (c.isAcoustic) {
    if (c.nylon) {
      return `<p>Nylon strings tie on at the bridge and stretch for days. Change one at a time to keep tension on the neck.</p>
      ${steps('strings', [
        'Slack the string fully and untie it from the tie block.',
        'Pass the new string through the tie block hole from the soundhole side, leaving about 5 cm (2") out the back.',
        'Bring the short end back over the top of the tie block and loop it under the long part of the string, then tuck it under itself 2–3 times on the trebles (1–2 on the basses) so it pins against the back edge of the bridge.',
        'Pull the long end to snug the knot. The loop should sit on the back edge of the tie block, not on top of the bridge.',
        'At the slotted headstock, pass the string through the roller hole, loop it under itself once, and wind so the string comes off the top of the roller toward the nut.',
        'Tune up slowly. Retune often — new nylon will need many retunes over 2–3 days. Gentle stretching speeds this up.',
        'Trim the ends once the string has stopped stretching, leaving about 1 cm.',
      ])}`;
    }
    const pinned = s.bridgeAcoustic === 'pinned';
    return `<p>${pinned ? 'Bridge pins hold the ball end against the bridge plate inside the guitar. The pin doesn\'t hold the string — the plate does, so the ball end must be seated.' : 'A pinless bridge takes the strings through the back of the bridge, like an electric hardtail.'} Change one string at a time so the neck stays under even tension.</p>
    ${steps('strings', [
      'Slack the string until it\'s floppy, then unwind it from the tuner.',
      pinned ? 'Lift the bridge pin out with a pin puller. If it\'s stuck, push the string down into the guitar a little to free the ball end, then lift.' : 'Push the old string back through the bridge and pull it out from the rear.',
      'Clean around the bridge and fingerboard while the string is off, if due.',
      pinned ? 'Bend the last 1 cm of new string near the ball end slightly, push the ball end into the hole, and push the pin in with its groove facing the soundhole.' : 'Feed the new string through its hole from the back of the bridge.',
      pinned ? 'Hold the pin down with one thumb and pull the string up gently until you feel the ball end seat against the bridge plate. Then let go of the pin.' : null,
      tunerSteps,
      'Tune to pitch, stretch the string gently along its length, retune; repeat twice.',
      'Trim the end at the post.',
    ])}
    ${pinned ? callout('warn', 'If a pin keeps popping up, the ball end isn\'t seated — it\'s sitting on the pin\'s tip instead of the bridge plate. Slack, push the pin down, and re-seat.') : ''}`;
  }

  return `<p>${intro}</p>
    ${kbNotes}
    ${steps('strings', [
      c.headless ? null : 'Slack the old string until it\'s floppy, then unwind it from the tuner and pull it out.',
      'Clean the fingerboard and under the strings while there\'s room, if due.',
      anchor,
      c.bridge === 'tom-stopbar' && /abr/i.test(s.bridgeModel || '') ? 'Check the saddle retaining wire is still in place before you bring tension back up.' : null,
      c.headless ? null : 'Run the string over its nut slot to the tuner.',
      c.headless ? null : tunerSteps,
      `Tune to pitch${c.headless ? ' with the bridge tuner knob' : ''}. Stretch the string gently along its length, retune, repeat about three times.`,
      c.headless ? null : 'Trim the end close to the post.',
      c.floating && !c.locking ? 'After the last string, retune everything twice. Every change in tension on a floating bridge pulls all the others slightly.' : null,
    ])}
    ${callout('warn', 'Changing gauge or tuning? Run the full Order of operations — ' + (c.isTrem ? 'spring tension, ' : '') + 'relief, action and intonation all move.')}`;
}

function tremSection(c) {
  if (!c.isTrem && c.bridge !== 'bigsby') return null;
  const { s } = c;
  if (c.bridge === 'bigsby') {
    return `<p>A Bigsby has its own spring under the arm; there's nothing to balance. Tuning stability comes from the bridge and nut.</p>
    ${ul([
      'Keep the bridge saddles and nut slots lubricated (graphite or a nut lubricant) — the strings slide across both every time you use the arm.',
      'If tuning drifts flat after use, a roller bridge or a nut with smoother slots usually fixes it.',
      'Check the arm spring for wear yearly; it can be replaced in place.',
    ])}`;
  }

  const lock = c.bridge === 'trem-locking';
  const angle = lock ? 'base plate parallel to the body' : 'rear of the bridge plate lifted about 1.6 mm (1/16") off the body';
  const tremKb = c.kb.map(k => callout('info', esc(k.note))).join('');

  if (c.tremSetup === 'blocked') {
    return `<p>A blocked trem behaves like a hardtail. There's no balancing to do — just keep the block snug.</p>
    ${ul(['Leave the springs on and tightened enough to hold the bridge firmly against the block.', 'If you ever unblock it, follow the floating setup: back off the claw, set the angle with a wedge, then bring the claw in until it lifts free.'])}`;
  }
  if (c.tremSetup === 'decked') {
    return `<p>A decked trem rests flat on the body at pitch, so you can dive but not pull up. The goal is enough spring tension that bends and heavy playing never lift the bridge.</p>
    ${tremKb}
    ${steps('trem', [
      'Remove the rear cavity cover.',
      'Tune to pitch and look at the bridge from the side.',
      'If the rear of the bridge lifts off the body, tighten both claw screws evenly, a half turn at a time, retuning between turns, until it sits flat.',
      'Then give each claw screw one more full turn. That keeps it decked when you bend a string.',
      'Play a full-step bend on the G string while holding a low E: if the E goes flat, the bridge is lifting — add another turn.',
    ])}`;
  }

  return `<p>The goal is for the bridge to float with its ${angle} when the guitar is at pitch. A setup block makes this one pass at the claw instead of a tighten–retune–check loop.</p>
    ${tremKb}
    ${steps('trem', [
      'Remove the rear cavity cover (Phillips).',
      'Back both claw screws off about two turns so the strings will overpower the springs.',
      `Fit a block (or stepped wedge) in the rear cavity, between the butt-side face of the trem block and the cavity wall, at the height where the ${angle}. Sight along the side of the body to check.`,
      'Tune to pitch. The bridge should stay seated on the block and the tuning should hold. If it lifts off the block, the springs are still too tight — back the claw off more.',
      'Do any other setup work now, while the bridge is held: relief, action, intonation.',
      'Tighten both claw screws alternately, a quarter turn at a time, keeping the claw square to the cavity. Stop the moment the block goes loose.',
      `Remove the block, retune and check the angle. If it's off, put the block back at the right height and repeat the previous step.`,
    ])}
    ${callout('note', `Springs: ${s.springs ? `you have ${s.springs}. ` : ''}Three springs suit 9s and 10s for most players; heavier strings or lower tunings change the balance — more strings pull means more claw tension, or a fourth spring if the claw runs out of travel. Slack all strings before moving or adding springs.`)}
    ${c.bridge === 'trem-vintage' ? callout('tip', 'Vintage 6-screw bridges pivot more smoothly on two screws: set the outer two screws to the height you want, then raise the inner four slightly so they don\'t touch the plate. It reduces friction and helps the trem return to pitch.') : ''}
    ${c.bridge === 'trem-2point' ? callout('tip', 'On a 2-point trem, turn the pivot studs only with the strings slack (or the block in) — turning them under load wears the knife edges.') : ''}`;
}

function reliefSection(c, t) {
  const { s } = c;
  if (c.noRod) {
    return `<p>This instrument has no truss rod, so relief isn't adjustable. It's still worth measuring so you know where you stand: around ${mmRange(...t.relief)} at the 7th–8th fret is typical for a classical neck.</p>
    ${callout('note', 'If relief is far off, or the neck has visible back-bow, a luthier can correct it with heat pressing or a fret dress.')}`;
  }
  return `<p>Target ${mmRange(...t.relief)} at the 7th–8th fret. ${c.isAcoustic ? 'Acoustic necks need far less relief than electrics.' : ''} Start at the low end and only go up if the low frets buzz.</p>
    ${steps('relief', [
      'Tune to pitch and hold the instrument in playing position — lying it on its back changes the reading.',
      'Clamp a capo at the 1st fret.',
      `Fret the ${c.isBass ? 'lowest' : 'low E'} string at the last fret (or where the neck meets the body).`,
      'Slide a feeler gauge between the bottom of the string and the top of the 7th or 8th fret. The right gauge passes with a light drag.',
      'Repeat on the highest string. A big difference between the two sides points to neck twist — worth a tech\'s look.',
      truss.access(c),
      'Gap too big (too much bow) → turn clockwise to tighten. No gap, or buzz on frets 1–5 (back-bow) → turn counter-clockwise to loosen. "Clockwise" means as you look at the nut from the end you\'re adjusting.',
      'Move no more than an eighth of a turn at a time. Retune, flex the neck gently, wait a few minutes, and measure again.',
    ])}
    ${callout('warn', 'If the rod feels stiff, back it off a little first rather than forcing it tighter. A rod that won\'t turn, or creaks, is a job for a tech. Any rod change moves action — re-check the next section afterward.')}
    ${c.multiscale ? callout('note', `On a multi-scale neck the frets fan, so the 1st fret isn't square to the neck. Put the capo along the 1st fret itself and measure each outer string at its own 7th–8th fret.${c.scaleLen.multi ? ` Expect the ${fmtIn(c.scaleLen.multi[0])} bass side to want slightly more relief than the treble side; set the rod for the bass side and accept a hair less on the treble.` : ''}`) : ''}`;
}

function actionSection(c, t) {
  const { s } = c;
  const hi = c.isBass ? 'highest' : 'high E', lo = c.isBass ? 'lowest' : 'low E';
  const measure = `Measure at the ${t.fret}th fret, top of fret to bottom of string, on the ${hi} and ${lo} strings. Note both.`;
  const radiusStep = c.radius.gauge
    ? `Set the middle strings to follow the fingerboard radius: rest the ${c.radius.gauge}" understring radius gauge under the strings at the bridge pickup and raise or lower each middle saddle until every string just touches it.`
    : 'Set the middle strings so they follow the curve between the two outer strings — look along the strings from the end of the body to check. (A radius gauge makes this exact.)';
  const intro = `Target ${mm(t.treble, { frac: true })} on the ${hi} and ${mm(t.bass, { frac: true })} on the ${lo} string at the ${t.fret}th fret.`;
  const individual = c.individualSaddles;

  if (c.isAcoustic) {
    const shim = c.solidWood ? '' : '';
    return `<p>${intro} On an acoustic the saddle sets action, and every 1 mm you take off the saddle lowers the action at the 12th fret by about 0.5 mm. So remove <strong>twice</strong> the change you want.</p>
    ${steps('action', [
      'Confirm relief is on target and the guitar is in tune with fresh strings.',
      measure,
      `Work out the change: (measured − target) × 2 = how much to take off the bottom of the saddle, for each side. Example: ${c.nylon ? '4.2 mm measured, 3.8 mm target' : '2.9 mm measured, 2.4 mm target'} → ${c.nylon ? '0.8' : '1.0'} mm off that end.`,
      'Slack the strings enough to lift the saddle out' + (s.bridgeAcoustic === 'pinned' ? ' (you can leave them on the pins, just loose)' : '') + '. Note which way it faces — the compensated side matters.',
      'Mark the amount to remove on the side of the saddle with a sharp pencil, from the bottom edge — a sloped line if the two sides need different amounts.',
      'Sand the bottom on 220-grit paper taped to a flat surface, holding the saddle perfectly upright. Check often; finish with 320 so the bottom is dead flat.',
      `Refit the saddle${['piezo', 'blend'].includes(s.electronics) ? ' — the under-saddle pickup needs the bottom perfectly flat and square, or some strings will be quieter than others' : ''}, tune up, and measure. Better to take two passes than one too many.`,
    ])}
    ${callout('tip', 'Too low? A thin shim of bone or hardwood under the saddle raises it back up. Don\'t shim over an under-saddle piezo — replace the saddle instead.')}
    ${callout('note', 'Buzzing only on open strings, with fretted notes clean, is a nut problem, not saddle height.')}`;
  }

  if (c.bridge === 'trem-locking') {
    return `<p>${intro} On a double-locking trem you set this only at the two pivot studs — the saddles follow a fixed radius and have no individual height adjustment.</p>
    ${steps('action', [
      'Confirm the guitar is in tune, relief is set, and the bridge is sitting on the setup block.',
      measure,
      /edge/i.test(s.bridgeModel || '') ? 'Loosen the stud-lock set screw in each pivot stud — always before turning the studs.' : 'If your studs have locking set screws, loosen them first.',
      'Slack all strings a few turns at the tuners (nut unlocked) to take the load off the knife edges. Turning a loaded stud wears them.',
      'Turn the studs: clockwise lowers, counter-clockwise raises. Treble-side stud for the high E, bass-side for the low E. Quarter turns.',
      'Retune and measure again. The block keeps the bridge where it was, so retuning is one pass.',
      'When both sides are on target, re-tighten any stud-lock screws.',
    ])}
    ${callout('note', 'If one middle string is off, or open strings buzz while fretted notes are clean, look at the locking nut height (set with shims) rather than the bridge.')}`;
  }

  if (c.tom) {
    return `<p>${intro} A tune-o-matic sets height at the two thumbwheels; the saddles come pre-radiused to roughly 12". If your board is flatter or rounder than that, the middle strings will sit a little high or low — that's normal within a few tenths of a mm.</p>
    ${steps('action', [
      'Confirm relief is set and the guitar is in tune.',
      measure,
      'Slack the strings a little first — turning a thumbwheel under full tension can lean the posts forward over time.',
      'Turn the bass-side thumbwheel to set the low string and the treble-side thumbwheel to set the high string. Quarter turns.',
      'Retune and measure. Repeat until both sides are on target.',
      c.bridge === 'tom-stopbar' || c.bridge === 'bass-tom' ? 'Check the stopbar: strings should clear the back edge of the bridge. If any string touches it, raise the stopbar a little. Lower = more break angle and firmer feel.' : null,
    ])}
    ${callout('tip', 'If a middle string is much higher or lower than its neighbours, its saddle slot may be too shallow or too deep. A tech can file or replace the saddle.')}`;
  }

  if (c.bridge === 'wraparound' && !individual) {
    return `<p>${intro} A plain wraparound sets height at its two studs only.</p>
    ${steps('action', ['Confirm relief is set and the guitar is in tune.', measure, 'Slack the strings a little, then turn the bass-side stud for the low string and the treble-side stud for the high string.', 'Retune and measure. Repeat until both are on target.'])}`;
  }

  if (c.bridge === 'tele-vintage') {
    return `<p>${intro} Each of the three barrel saddles carries two strings and has two height screws, so you can tilt each barrel slightly to match the radius.</p>
    ${steps('action', ['Confirm relief is set and the guitar is in tune.', measure, 'Set the low E/A barrel and the B/high E barrel first, using the height screw under each string.', radiusStep, 'Retune and measure. Check that no barrel rocks — both screws should touch the plate.'])}`;
  }

  if (c.bridge === 'bigsby' || c.bridge === 'evertune' || c.bridge === 'other') {
    return `<p>${intro} Set height at whatever your bridge offers — thumbwheels or studs for overall height, individual saddle screws if it has them.</p>
    ${steps('action', ['Confirm relief is set and the guitar is in tune.', measure, 'Adjust overall bridge height for the two outer strings first, slacking the strings slightly before turning studs or thumbwheels.', radiusStep, 'Retune and measure again.'])}`;
  }

  // individual saddles (Strat/hardtail/Tele 6/bass/2-point/vintage)
  const studs = c.bridge === 'trem-2point';
  return `<p>${intro} Every saddle has its own height screws, so you set the two outer strings, then fit the rest to the fingerboard radius.</p>
    ${steps('action', [
      'Confirm relief is set and the guitar is in tune' + (c.floating ? ', with the bridge on the setup block' : '') + '.',
      measure,
      studs ? 'Set overall bridge height at the two pivot studs first if the saddles are near the end of their travel (strings slack or block in). Otherwise leave the studs alone.' : null,
      `Raise or lower the ${lo} saddle with its two height screws (keep them even so the saddle doesn't tilt), then the ${hi} saddle.`,
      radiusStep,
      'Retune and measure. Check every saddle sits level and the screws aren\'t sticking up into your palm.',
    ])}
    ${c.radius.compound ? callout('note', `Your board is ${c.radius.label}. Match the saddles to the larger radius (${c.radius.b}") — that's the curve where the strings leave the board.`) : ''}`;
}

function nutSection(c, t) {
  const { s } = c;
  if (c.lockingNut) {
    return `<p>A locking nut sets height with shims underneath it. If open strings buzz but fretted notes are clean, add a shim; if the first few frets feel stiff and play sharp, a thinner shim helps. Most players never touch it.</p>`;
  }
  if (s.nut === 'zero-fret') return `<p>A zero fret sets open-string height just like any other fret, so the nut only guides spacing. Nothing to adjust.</p>`;
  return `<p>A nut that's too high makes the first few frets stiff and sharp; one that's too low buzzes on open strings. Check it, but leave slot filing to a tech unless you have proper nut files.</p>
    ${steps('nut', [
      'Fret each string at the 3rd fret.',
      `Look at the gap between the string and the top of the 1st fret. It should be tiny — about ${mmRange(...t.nut)}, a sheet of paper or less.`,
      'No gap at all, or the string touching the 1st fret → slot is too low (open-string buzz). A tech can fill and re-cut, or replace the nut.',
      'A big gap → slot is too high. A tech can lower it with nut files in a few minutes.',
    ])}
    ${callout('tip', `At every string change, rub a little graphite (soft pencil) or nut lubricant into the slots — ${c.isTrem || c.bridge === 'bigsby' ? 'it\'s the biggest single fix for a trem that won\'t return to pitch' : 'it stops pinging and sticking as you tune'}.`)}`;
}

// Where the saddles should roughly sit for this scale — catches a wrong scale entry, or a saddle at the end of its travel.
function scaleCheck(c) {
  const L = c.scaleLen;
  if (!L.inches) return '';
  const comp = c.isBass ? [[3, 5], [6, 10]] : [[1.5, 3], [3, 6]];
  const std6 = !c.isBass && c.s.strings === 6;
  const hi = std6 ? 'high E' : 'highest string', lo = std6 ? 'low E' : 'lowest string';
  const one = (len, label) => `${label ? `<strong>${label[0].toUpperCase() + label.slice(1)}:</strong> nut` : 'Nut'} to the middle of the 12th fret should measure <span class="meas">${r1(len * 25.4 / 2)} mm</span> <span class="imp">(${r2(len / 2)}")</span>, half of ${fmtIn(len)}.`;
  const lines = L.multi ? [one(L.multi[0], `${lo} side`), one(L.multi[1], `${hi} side`)] : [one(L.inches)];
  return callout('info', `<strong>Scale check.</strong> ${lines.join(' ')} The saddles sit a little past the full scale length — typically ${comp[0][0]}–${comp[0][1]} mm on the ${hi} and ${comp[1][0]}–${comp[1][1]} mm on the ${lo}, measured from the nut. If a saddle is way off that, or out of travel, recheck the scale length you entered before blaming the bridge.`);
}

function intonationSection(c) {
  return intonationSteps(c) + scaleCheck(c);
}

function intonationSteps(c) {
  const { s } = c;
  const rule = `${c.fretless ? 'Stopped note at the 12th fret marker' : 'Fretted 12th'} flat → move the saddle toward the neck. Sharp → move it away from the neck.`;
  const base = `<p>Intonation is right when each string's ${c.fretless ? 'stopped note at the 12th fret marker' : 'fretted 12th-fret note'} reads exactly the same as its 12th-fret harmonic. Do it last, with fresh strings, after relief and action — both change it.</p>`;

  if (c.isAcoustic) {
    return `${base}<p>On an acoustic the saddle is fixed, so this is a check, not an adjustment.</p>
    ${steps('inton', [
      'Tune each string and compare the 12th harmonic with the fretted 12th note, fretting lightly.',
      'Within 2–3 cents on every string is normal.',
      'If every string is sharp, the action is probably too high (pressing down stretches the string). Lower the saddle first.',
      'If one string is consistently off by more than about 5 cents, the saddle needs re-compensating — a tech can shape the saddle crown for that string or fit a compensated saddle.',
    ])}`;
  }

  if (c.bridge === 'trem-locking') {
    return `${base}
    ${steps('inton', [
      'Fresh strings on, relief and action set, nut unlocked, bridge on the setup block.',
      'Tune the string to pitch. Compare the 12th harmonic with the fretted 12th note.',
      rule,
      'With an intonation tool (e.g. Accu-Locator): mount it on the saddle, take up the slack, loosen the saddle lock screw, turn the knob to move the saddle, retune, re-check, then lock the screw while the tool still holds it.',
      'Without a tool: slack the string, loosen the saddle lock screw, nudge the saddle a millimetre or two in the right direction, lock it, retune, check. Repeat — it takes a few tries.',
      'Work through every string, then tighten the claw until the block drops out (see Tremolo balance).',
    ])}
    ${/edge/i.test(s.bridgeModel || '') ? callout('info', 'Each Edge saddle lock screw has two holes in the base plate. If a saddle runs out of travel toward the tail (common on wound strings with heavier gauges), slack the string and move its screw to the rear hole.') : ''}`;
  }

  if (c.bridge === 'tele-vintage') {
    return `${base}<p>Three barrels share six strings, so you can't perfect every string. Compensated (angled) barrels get much closer.</p>
    ${steps('inton', [
      'Check both strings on a barrel. Set the barrel so the worse string is close and the other is a little the opposite way — split the difference.',
      rule,
      'Turn the intonation screw at the back of the bridge plate a little, retune, re-check.',
      'If you play mostly chords around the first five frets, favour the G and B strings; that\'s where a Tele\'s compromise is most audible.',
    ])}`;
  }

  if (c.bridge === 'wraparound' && !/510ub/i.test(s.bridgeModel || '')) {
    return `${base}<p>A one-piece wraparound intonates as a whole bar — the compensation is cast or cut into it. The two small screws on its ends (if fitted) set the bass and treble sides.</p>
    ${steps('inton', ['Check the low E and high E.', 'Turn the matching end screw to move that side of the bar: flat → toward the neck, sharp → away.', 'Check the middle strings; they follow the bar\'s built-in compensation. A few cents out on the G or B is normal.'])}`;
  }

  const tool = c.tom ? 'small flat screwdriver' : 'screwdriver or hex key on the intonation screw';
  return `${base}
    ${steps('inton', [
      'Fresh strings, relief and action set, guitar tuned' + (c.floating ? ', bridge on the setup block' : '') + '.',
      'Compare the 12th harmonic with the fretted 12th note on one string, fretting lightly.',
      rule,
      `Slack the string slightly, then turn the ${tool} to move the saddle${c.isBass ? ' — bass saddles may need to move several millimetres' : ' — a quarter turn is a lot'}.`,
      'Retune and re-check. Repeat until they match within a cent or two.',
      'Work through every string.',
    ])}
    ${c.tom ? callout('tip', 'If a tune-o-matic saddle runs out of travel, it can be flipped around in the bridge (or the whole bridge turned) for more room in the direction you need. Most bridges face the intonation screws toward the pickups.') : ''}
    ${c.fretless ? callout('note', 'On a fretless bass, intonation sets where the notes fall relative to the fret lines or side markers. Use a light, precise finger placement on the marker line when checking.') : ''}`;
}

function pickupSection(c) {
  if (c.isAcoustic) {
    const e = c.s.electronics;
    if (e === 'none') return null;
    return `<p>${optionLabel(OPTIONS.electronicsAcoustic, e)}${c.s.battery && c.s.battery !== 'none' && c.s.battery !== NOT_SURE ? `, ${optionLabel(OPTIONS.battery, c.s.battery)} battery` : ''}.</p>
    ${ul([
      ['piezo', 'blend'].includes(e) ? 'An under-saddle piezo hears every string through the saddle bottom. If one string is louder or quieter, the saddle bottom or the slot isn\'t flat — re-flatten it on sandpaper on glass.' : null,
      e === 'magnetic' ? 'Most soundhole pickups have adjustable poles or a height adjustment. Balance any loud string by lowering its pole.' : null,
      e === 'contact' ? 'A body sensor needs no adjustment — balance problems usually come from the strings, not the pickup.' : null,
      'Unplug the cable when you\'re not playing — the jack usually switches the preamp on and wastes the battery.',
      'Change the battery when the sound gets thin, distorted or crackly, not only when it dies.',
    ])}`;
  }
  const rows = pickupRows(c);
  if (!rows.length) return `<p>Measure from the top of each pole piece to the bottom of the string, with the string held at the last fret. Start a little lower than you think, then raise each pickup until it's loud and clear but not warbly.</p>`;
  const single = rows.some(r => /single|J pickup/.test(r.type));
  return `<p>Measure each pickup from the top of the pole piece to the bottom of the string, with the string held down at the last fret. These are starting points — set the bridge pickup first, then balance the others to it by ear.</p>
    ${table(['Pickup', 'Treble side', 'Bass side'], rows.map(r => [`${esc(r.pos)} (${r.type})`, mm(r.treble, { frac: true }), mm(r.bass, { frac: true })]))}
    ${steps('pickups', [
      'Hold the highest string at the last fret and measure under it; turn the treble-side height screw to set it. Repeat on the bass side with the lowest string.',
      'Set the other pickups the same way, then switch between them at full volume. Raise or lower until each one sounds about as loud as the bridge.',
      `Play the ${c.isBass ? 'lowest' : 'low E'} string around the top frets on each pickup. A warbling, out-of-tune sustain means that pickup's magnet is too close — lower it.`,
      'If one string jumps out, trim it with its pole screw (where fitted) rather than tilting the whole pickup.',
    ])}
    ${single && c.isElectric ? callout('note', 'Single-coils with strong alnico magnets pull on the strings more than humbuckers. Keep them on the low side — especially the neck pickup.') : ''}
    ${c.active ? callout('note', 'Active pickups have weak magnets and a preamp doing the work, so string pull isn\'t an issue — set them by output and tone instead.') : ''}
    ${c.hasBattery ? callout('tip', 'Active electronics: unplug the cable when you\'re done — the output jack switches the battery on. Change it once a year or when the tone gets thin or fuzzy.') : ''}`;
}

const FINISH = {
  'gloss-poly': { name: 'gloss poly', polish: 'Yes', naphtha: 'Yes, for sticky grime', swirl: 'Yes, by hand', scuff: 'No', oil: 'No' },
  'satin-poly': { name: 'satin poly', polish: 'No — burnishes satin to gloss', naphtha: 'Yes', swirl: 'No', scuff: 'Only to restore a shiny spot', oil: 'No' },
  nitro: { name: 'nitro', polish: 'Nitro-safe, silicone-free only', naphtha: 'Sparingly', swirl: 'Gently, by hand', scuff: 'No', oil: 'No' },
  'nitro-satin': { name: 'satin / aged nitro', polish: 'No', naphtha: 'Sparingly', swirl: 'No', scuff: 'No', oil: 'No' },
  oil: { name: 'oil finish', polish: 'No', naphtha: 'Sparingly', swirl: 'No', scuff: 'Fine pad, with the grain, before re-oiling', oil: 'Re-oil with the same finish (e.g. Tru-Oil) when it looks dry' },
  [NOT_SURE]: { name: 'unknown finish', polish: 'Test in a hidden spot', naphtha: 'Test in a hidden spot', swirl: 'No', scuff: 'No', oil: 'No' },
};

function cleaningSection(c) {
  const { s } = c;
  const body = FINISH[s.bodyFinish] || FINISH[NOT_SURE];
  const neck = FINISH[s.neckFinish] || FINISH[NOT_SURE];
  const fbF = c.fbFinish === 'finished';
  const fbU = c.fbFinish === 'unfinished';
  const fb = fbF
    ? { polish: 'Light use, wipe fully dry', naphtha: 'Yes', swirl: 'No', scuff: 'No', oil: 'No — it can\'t soak in and leaves a film' }
    : c.fbMat === 'richlite'
      ? { polish: 'No', naphtha: 'Yes', swirl: 'No', scuff: 'No', oil: 'Not needed — it\'s synthetic' }
      : fbU
        ? { polish: 'No', naphtha: 'Yes', swirl: 'No', scuff: 'No', oil: `Yes, sparingly, ${s.climate === 'big' ? '2–3' : '1–2'}× a year` }
        : { polish: 'No', naphtha: 'Yes', swirl: 'No', scuff: 'No', oil: 'Only if you\'re sure it\'s unfinished' };

  const rows = [
    ['Dry or barely damp microfiber', 'Yes', 'Yes', 'Yes'],
    ['Instrument polish', body.polish, neck.polish, fb.polish],
    ['Naphtha (lighter fluid) on a cloth', body.naphtha, neck.naphtha, fb.naphtha],
    ['Swirl remover / fine polish compound', body.swirl, neck.swirl, fb.swirl],
    ['Gray synthetic scuff pad', body.scuff, neck.scuff, fb.scuff],
    ['Fretboard oil / conditioner', 'No', neck.oil === 'No' ? 'No' : neck.oil, fb.oil],
    ['Alcohol, acetone, ammonia, household cleaners', 'No', 'No', 'No'],
  ];
  const fbName = `${optionLabel(OPTIONS.fbMaterial, s.fbMaterial)}${fbF ? ', finished' : fbU ? ', unfinished' : ''}`;

  const fbNotes = fbF ? ul([
    'Clean with the strings off: wipe with a barely damp microfiber; naphtha on the cloth for heavier grime.',
    'Clear the dark lines where the board meets each fret with a wooden toothpick or plastic pick — never a metal blade, it cuts the finish.',
    'Skip lemon oil and conditioners. A finished board can\'t absorb them.',
    'Watch frets 1–12 for spots where the finish has worn through and the maple is turning gray. Keep them clean and dry; spot-refinishing is a tech job.',
  ]) : c.fbMat === 'richlite' ? ul(['Wipe with a damp cloth; naphtha for grime. Nothing to condition.']) : ul([
    'Clean with the strings off: naphtha or a fretboard cleaner on a cloth, and a soft toothbrush or 0000 synthetic pad for buildup along the frets.',
    `Condition ${s.climate === 'big' ? '2–3 times a year (more in dry winters)' : 'once or twice a year'}: a few drops of fretboard oil on a cloth, rub in, wait a few minutes, wipe off <strong>every</strong> trace. More is not better — excess oil can soften fret-slot glue.`,
    c.fbMat === 'ebony' || c.fbMat === 'macassar' ? 'Ebony is especially prone to shrinking and cracking when dry. Conditioning plus humidity control keeps it stable.' : null,
    c.fbMat === 'roasted-maple' ? 'Roasted maple is usually unfinished and quite stable; it takes oil or fretboard wax sparingly.' : null,
  ]);

  return `<p>Cleaning means caring for the finish, so what you use depends on the finish, not the wood.</p>
    ${table(['Cleaner', `Body (${body.name})`, `Neck back (${neck.name})`, `Fingerboard (${esc(fbName)})`], rows, 'matrix')}
    ${sub('Body')}
    ${ul([
      'After playing, wipe the forearm area, top edge and back with a dry microfiber.',
      body.polish.startsWith('Yes') || body.polish.startsWith('Nitro') ? `At string changes, mist polish on the cloth (not the guitar), wipe, then buff dry.${s.bodyFinish === 'nitro' ? ' Use only silicone-free, nitro-safe polish.' : ''}` : 'Skip polish — it changes the sheen. A barely damp cloth is all it needs.',
      'Sticky residue: a little naphtha on a cloth, then wipe dry.',
      c.nitro ? '<strong>Nitro:</strong> keep it off rubber, vinyl and some foam stand padding — they can react with the finish and leave marks. Let the case warm up to room temperature before opening after cold transport, or the finish can crack (checking).' : null,
      /basswood|alder|poplar/i.test(s.bodyWood || '') ? 'Soft body woods ding easily. Seal any chip that goes through to bare wood with a drop of clear nail polish or thin CA so moisture can\'t get in.' : null,
    ])}
    ${sub('Neck back')}
    ${ul([
      'Wipe with a dry or barely damp cloth after playing.',
      s.neckFinish === 'satin-poly' || s.neckFinish === 'nitro-satin' ? 'Satin feels fast because it\'s flat. Polish and compounds make it shiny and sticky. If a shiny patch develops, rub it lightly with a gray scuff pad, with the grain, masking the fingerboard edges first.' : null,
      s.neckFinish === 'oil' ? 'An oil-finished neck is barely sealed. Wipe it down after every session and re-oil when it feels dry or rough.' : null,
      'Never steel wool — the fibres end up on the pickups.',
    ])}
    ${sub('Fingerboard')}
    ${c.fretless ? '<p>On a fretless board, roundwound strings slowly groove bare wood. Flatwounds are much kinder; epoxy-coated boards resist it.</p>' : ''}
    ${fbNotes}`;
}

function fretSection(c) {
  const { s } = c;
  if (c.fretless) {
    return `<p>No frets to dress — but the board itself is the playing surface.</p>
    ${ul([
      'Look along the board with a straightedge yearly. String grooves (from roundwounds) show as buzz or "dead" notes in one spot.',
      'Light grooves can be sanded out and the board re-oiled or re-coated; that\'s a tech job on an epoxy-coated board.',
      'Keep relief low and even — fretless basses are more sensitive to neck shape than fretted ones.',
    ])}`;
  }
  const mat = s.fretMaterial;
  const lead = mat === 'stainless'
    ? 'Stainless frets barely wear and stay shiny for years. Polish only when they feel draggy; level only if a fret is truly high. Expect it to wear out files and abrasives faster.'
    : mat === 'evo'
      ? 'EVO gold frets wear slower than nickel and are hypoallergenic. Polish every several string changes.'
      : 'Nickel-silver frets wear faster than stainless. Keep them polished and take off as little as possible when leveling.';
  const sizeNote = ['vintage', 'medium'].includes(s.fretSize) ? ' Your frets are on the smaller side, so there\'s less material to level — a full level may only be possible once or twice before a refret.' : ['jumbo', 'extra-jumbo'].includes(s.fretSize) ? ' Tall frets give you more material for future leveling.' : '';
  const refin = c.fbFinish === 'finished' ? ' Refretting a finished maple board means refinishing the board too, so look after these frets.' : '';
  return `<p>${lead}${sizeNote}${refin}</p>
    ${table(['Symptom', 'Job', 'DIY level'], [
      ['Dull or scratchy frets, bends feel draggy', 'Polish', `Easy — every ${mat === 'stainless' ? 'year or so' : '3–4 string changes'}`],
      ['Sharp fret ends along the board edge, mostly in winter', 'Humidify first, then fret-end dressing', 'Moderate'],
      ['Buzz on specific frets with relief and action on spec', 'Find high frets with a fret rocker, then spot-level or level', 'Advanced — consider a tech the first time'],
      ['Visible grooves under the strings', 'Level, crown, polish (or partial refret)', 'Advanced'],
    ])}
    ${sub('Routine polish')}
    ${steps('frets', [
      'Strings off. Cover the pickups with masking tape' + (c.isAcoustic ? ' (or the soundhole)' : '') + ' — filings and polish grit stick to magnets.',
      `Mask the board between every fret with low-tack tape, or use a slotted fret guard.${c.fbFinish === 'finished' ? ' Scratches in the clear board finish show for good.' : ''}`,
      `Polish each fret along its length with micro-mesh (coarse to fine) or a fine synthetic pad, following the ${c.radius.known ? c.radius.label : 'board'} radius so the edges get done too.`,
      'Peel the tape, clean the board (see Cleaning), restring.',
    ])}
    ${callout('tip', 'Sharp fret ends in winter usually mean the board has shrunk from dry air. Try two weeks at 45–50% humidity first — they often settle back before any filing.')}`;
}

function hardwareSection(c) {
  const { s } = c;
  const items = [];
  if (c.bridge === 'trem-locking' || c.bridge === 'trem-2point') items.push(`<strong>Knife edges & studs:</strong> at each string change, look for burrs or a rounded knife edge, and put a tiny dab of graphite or nut lubricant in the stud notches.`);
  if (c.bridge === 'trem-vintage') items.push('<strong>Pivot screws:</strong> a little graphite or light grease where the plate meets the screws keeps the trem smooth.');
  if (c.bridge === 'trem-locking') items.push('<strong>Fine tuners:</strong> keep them away from either end of their travel. A drop of light oil on the threads if they feel gritty.');
  if (c.lockingNut) items.push('<strong>Locking nut:</strong> wipe grime from under the pads. Bolts just snug — overtightening flattens strings and strips threads.');
  if (c.tom) items.push('<strong>Tune-o-matic:</strong> check the posts aren\'t leaning toward the neck (a sign of adjusting under tension). Keep saddle screws free of grime so they don\'t rattle.');
  if (c.bridge === 'bigsby') items.push('<strong>Bigsby:</strong> lubricate the roller bar pivots lightly; replace the spring if the arm feels soft or uneven.');
  if (c.isTrem) items.push('<strong>Arm:</strong> if it\'s floppy or won\'t stay put, replace the bushing or tension spring/collar — they\'re cheap.');
  if (c.isAcoustic && s.bridgeAcoustic === 'pinned') items.push('<strong>Bridge & pins:</strong> look for the bridge lifting at its back edge (a business card slides under it) — stop and see a luthier if so. Replace cracked pins.');
  if (c.isAcoustic) items.push('<strong>Top & bracing:</strong> a sunken area behind the bridge or a bulge in front of it means the top is moving — usually humidity, sometimes a loose brace. Worth a luthier\'s look.');
  items.push(c.lockingTuners ? '<strong>Locking tuners:</strong> don\'t overtighten the locking thumbwheel. A drop of light oil on the gear yearly if they feel stiff.' : '<strong>Tuners:</strong> most modern tuners are sealed and need nothing. The small screw on each button sets how stiffly it turns. Snug the bushing nuts yearly — finger-tight plus a quarter turn.');
  items.push('<strong>Strap buttons:</strong> wiggle-test them yearly. A loose one can be fixed with a toothpick and wood glue in the hole.');
  if (c.isElectric || c.isBass || !['none', NOT_SURE].includes(s.electronics)) items.push('<strong>Electronics:</strong> if a pot is scratchy or the switch crackles, spray contact cleaner in and work the control. Keep the output jack nut tight.');
  if (c.hasBattery) items.push(`<strong>Battery (${optionLabel(OPTIONS.battery, s.battery)}):</strong> unplug when not playing; replace yearly or at the first sign of thin or crackly sound.`);
  return `<p>Most hardware problems show up first as tuning that won't hold. A few minutes at each string change prevents them.</p>${ul(items)}`;
}

function humiditySection(c) {
  const { s } = c;
  const target = c.isAcoustic ? '45–55%' : '40–55%';
  const climate = s.climate === 'big' ? 'Your climate swings a lot, so this matters year-round.' : s.climate === 'moderate' ? 'Moderate climates still dry out with winter heating.' : 'A stable room is ideal — keep it that way and check now and then.';
  return `<p>Keep it at ${target} relative humidity. ${climate}</p>
    ${c.isAcoustic ? callout(c.solidWood ? 'warn' : 'note', c.solidWood
      ? 'A solid-wood acoustic can crack in a single dry winter. Keep it in its case with a soundhole or case humidifier from autumn to spring, and check a hygrometer in the case weekly.'
      : 'Laminate tops are far more forgiving than solid wood, but the neck and fingerboard still move. A case humidifier in winter is cheap insurance.') : ''}
    ${table(['Sign', 'Usually means', 'Do'], [
      ['Sharp fret ends, action dropped, buzzing, top sunken', 'Too dry', 'Humidify for a week or two before adjusting anything'],
      ['Action rose, top bulging behind the bridge, sluggish sound', 'Too humid', 'Dehydrate (case with silica packs or a dehumidified room)'],
      ['Relief changed between seasons', 'Normal wood movement', 'Small truss rod tweak at spring and autumn'],
    ])}`;
}

function scheduleSection(c) {
  const { s } = c;
  const rows = [
    ['After playing', `Wipe strings, fingerboard and body; case it${c.isAcoustic && c.solidWood ? ' (with humidifier in winter)' : ''}`],
    ['Every string change', [
      'Clean the board', c.fbFinish === 'unfinished' && c.fbMat !== 'richlite' ? '' : null, 'lube the nut slots',
      c.isTrem && ['trem-locking', 'trem-2point'].includes(c.bridge) ? 'lube the knife edges' : null,
      c.isTrem ? 'check the trem angle' : null, c.noRod ? null : 'check relief', 'spot-check intonation',
    ].filter(Boolean).join(', ')],
    ['Every 3–4 string changes', c.fretless ? 'Look along the board for string grooves' : `Fret polish${c.stainless ? ' (stainless: only if draggy)' : ''} with board masked and pickups covered`],
    ['Spring & autumn', `Re-check relief and action; feel for sharp fret ends in winter${c.isAcoustic ? '; start/stop the humidifier' : ''}`],
  ];
  if (c.fbFinish === 'unfinished' && c.fbMat !== 'richlite') rows.push([s.climate === 'big' ? '2–3× a year' : '1–2× a year', 'Condition the fingerboard']);
  rows.push(['Gauge or tuning change', `${c.isTrem ? 'Spring tension, ' : ''}relief, action, intonation — full sequence`]);
  rows.push(['Yearly', `Full setup in order; contact-clean pots and switch; ${c.hasBattery ? 'replace the battery; ' : ''}check strap buttons, jack and all hardware screws${c.isTrem ? '; inspect knife edges and arm bushing' : ''}${c.isAcoustic ? '; check the bridge isn\'t lifting' : ''}`]);
  rows.push(['When buzz or wear shows', c.fretless ? 'Board resurfacing (a tech)' : 'Fret rocker check, then spot-level or level-crown-polish (or a tech)']);
  return `<p>Most of the work rides along with string changes; a full setup once a year and quick checks at the season changes cover the rest.</p>${table(['When', 'What to do'], rows)}`;
}

function sourcesSection(c) {
  const make = c.inst.make ? esc(c.inst.make) : 'your maker';
  return `<p>These targets are widely used starting points drawn from manufacturer setup guides (Fender, Gibson, Ibanez, Martin, Taylor and others), pickup makers' height recommendations (DiMarzio, Seymour Duncan, Fender) and standard luthier practice. Where ${make}'s own published spec for your model differs, use theirs.</p>
    ${callout('note', 'This guide is a starting point. Anything involving cracks, a lifting bridge, a stuck truss rod, or major fret work is worth a qualified tech\'s eye.')}`;
}

// ---------- assemble ----------

// owned: Set of tool ids from the account toolbox, or null if it hasn't been set up.
export function buildGuide(inst, { owned = null } = {}) {
  // Fill gaps so older or partial specs still produce a full guide.
  inst = { ...inst, spec: { ...blankSpec(inst.type), ...inst.spec } };
  const c = buildContext(inst);
  const t = computeTargets(c);
  const sections = [
    { id: 'glance', title: 'At a glance', html: glance(c, t) },
    { id: 'tools', title: 'Tools & supplies', html: tools(c, owned) },
    { id: 'order', title: 'Order of operations', html: order(c) },
    { id: 'strings', title: 'String change', html: stringChange(c) },
    { id: 'trem', title: c.bridge === 'bigsby' ? 'Bigsby care' : 'Tremolo balance', html: tremSection(c) },
    { id: 'relief', title: 'Neck relief', html: reliefSection(c, t) },
    { id: 'action', title: 'String height (action)', html: actionSection(c, t) },
    { id: 'nut', title: 'Nut', html: nutSection(c, t) },
    { id: 'inton', title: 'Intonation', html: intonationSection(c) },
    { id: 'pickups', title: c.isAcoustic ? 'Electronics' : 'Pickup height', html: pickupSection(c) },
    { id: 'cleaning', title: 'Cleaning by surface', html: cleaningSection(c) },
    { id: 'frets', title: c.fretless ? 'Fingerboard care' : 'Fret care', html: fretSection(c) },
    { id: 'hardware', title: 'Hardware care', html: hardwareSection(c) },
    { id: 'humidity', title: 'Humidity', html: humiditySection(c) },
    { id: 'schedule', title: 'Maintenance schedule', html: scheduleSection(c) },
    { id: 'log', title: 'Setup log', html: '<div data-log></div>' },
    { id: 'sources', title: 'About these numbers', html: sourcesSection(c) },
  ].filter(sec => sec.html);
  const missingTools = owned ? checkTools(toolRequirements(c), owned).filter(r => r.status === 'missing') : [];
  return { name: c.name, sections, targets: t, context: c, missingTools };
}
