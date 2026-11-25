// Option lists live in data/options.json, shared with tools/build_models.py so the model library uses the same values.
// Every select carries a "Not sure" choice; the guide falls back to general advice for it.

const shared = await (await fetch(new URL('../data/options.json', import.meta.url))).json();

export const { NOT_SURE, INSTRUMENTS, OPTIONS, TUNINGS, GAUGES, BRIDGE_MODELS } = shared;

// Bridge-model specific notes, matched by case-insensitive substring of the bridge model field.
// Only facts we're confident in; everything else falls back to the bridge-type text.
export const BRIDGE_KB = [
  { match: 'edge', note: 'Ibanez Edge family: stud-lock set screws must be loosened before turning the pivot studs, saddle lock screws can be moved to a second hole for more intonation travel, and the springs are held by a Block Lock plate on many models. Use metric keys and seat them fully before turning.' },
  { match: 'floyd rose', note: 'Floyd Rose: saddles are clamped to a fixed-radius base plate, so action is set only at the two pivot studs. Keep the fine tuners mid-travel when you lock the nut. The Original uses hardened steel saddles and block; the 1000 and Special share the geometry with lighter parts.' },
  { match: 'gotoh 510ts', note: 'Gotoh 510TS: a 2-point tremolo with steel block and individual height-adjustable saddles. Set overall height and float at the two studs, then fine-tune string height at the saddles.' },
  { match: 'gotoh 510ub', note: 'Gotoh 510UB: a wraparound with individually adjustable saddles, so unlike a plain wraparound you can intonate and set height string by string. Overall height is set at the two studs.' },
  { match: 'gotoh ge1996t', note: 'Gotoh GE1996T: a Floyd-style double-locking tremolo. Follow the double-locking procedure below.' },
  { match: 'abr-1', note: 'Gibson ABR-1: the narrow, vintage tune-o-matic. It sits on threaded posts screwed straight into the body, and the saddles are held by a retaining wire — keep the wire in place when you change strings, or saddles can fall out.' },
  { match: 'nashville', note: 'Gibson Nashville: the wider tune-o-matic on posts with threaded inserts. Thumbwheels set height; saddles intonate with a flat screwdriver.' },
  { match: 'bigsby', note: 'Bigsby: strings hook on a pin on the roller bar. Bend the last bit of string near the ball end so it stays on the pin while you bring it up to pitch.' },
  { match: 'evertune', note: 'EverTune: every string has a spring module. Strings must be tuned into the module\'s working zone ("zone 2") with the EverTune key, and intonation and action interact with that. Keep the manufacturer\'s manual handy — the steps below cover the parts common to every guitar.' },
  { match: 'kahler', note: 'Kahler: a cam-based tremolo; string tension is balanced by springs inside the unit rather than in a rear cavity. Follow Kahler\'s instructions for spring tension.' },
  { match: 'badass', note: 'Badass II: a high-mass bass bridge with grooved saddles that are traditionally notched (filed) for string spacing. Don\'t file new slots yourself unless you\'re sure — the saddle position is hard to undo.' },
  { match: 'hipshot', note: 'Hipshot: precision-machined bridge with individually adjustable saddles. Hex keys are usually imperial on US-made Hipshot hardware.' },
];

// Factory targets that differ from the computed defaults, matched against make + model.
// Only applied when the strings match the gauge the targets were written for.
export const TARGET_OVERRIDES = [
  {
    match: /ibanez.*rg\s?550/i, whenGaugeTop: 10,
    targets: { relief: [0.3, 0.5], actionFret: 14, actionTreble: 1.7, actionBass: 2.3, note: 'Ibanez factory spec for 10-gauge strings, measured at the 14th fret.' },
  },
];

// Blank spec for each type, used when no library model is chosen.
export function blankSpec(type) {
  const common = {
    strings: INSTRUMENTS[type].defaultStrings, scale: NOT_SURE, radius: NOT_SURE, frets: type === 'acoustic' ? 20 : 22,
    fretSize: NOT_SURE, fretMaterial: 'nickel', fbMaterial: NOT_SURE, fbFinish: NOT_SURE, nut: NOT_SURE, neckJoint: NOT_SURE,
    year: '', scaleCustom: '', scaleMulti: '', radiusCustom: '',
    trussAccess: NOT_SURE, trussTool: '', gauge: '', tuning: TUNINGS[type][0], bodyWood: '', bodyFinish: NOT_SURE, neckFinish: NOT_SURE,
    style: 'medium', climate: 'big', notes: '',
  };
  if (type === 'electric') Object.assign(common, { bridgeType: 'tom-stopbar', bridgeModel: '', tremSetup: 'floating', springs: 3, lockingTuners: 'no', pickups: 'HH', pickupNotes: '', active: 'no', battery: 'none' });
  if (type === 'acoustic') Object.assign(common, { stringType: 'steel', top: NOT_SURE, bridgeAcoustic: 'pinned', saddle: NOT_SURE, electronics: 'none', battery: 'none' });
  if (type === 'bass') Object.assign(common, { bridgeType: 'bass-vintage', bridgeModel: '', stringLoad: 'top', fretted: 'fretted', pickups: 'PJ', pickupNotes: '', active: 'no', battery: 'none', bassStringType: 'round' });
  return common;
}

export function optionLabel(list, value) {
  const hit = list.find(o => String(o[0]) === String(value));
  return hit ? hit[1] : value;
}

// Parse a typed length into inches: "25", '25"', "25.5 in", "635mm", "635 mm". Bare numbers over 100 are taken as mm.
export function parseLength(text) {
  const m = String(text ?? '').trim().toLowerCase().match(/^(\d+(?:[.,]\d+)?)\s*(mm|cm|in|inch|inches|"|”)?$/);
  if (!m) return null;
  let n = parseFloat(m[1].replace(',', '.'));
  const unit = m[2] || (n > 100 ? 'mm' : 'in');
  if (unit === 'mm') n /= 25.4;
  else if (unit === 'cm') n /= 2.54;
  return n > 0 && n < 80 ? Math.round(n * 1000) / 1000 : null;
}

// Multi-scale pair, e.g. "26.25-25.5" or "667-648 mm" → [bass, treble] in inches.
export function parseMulti(text) {
  const parts = String(text ?? '').toLowerCase().replace(/(mm|in|")/g, ' $1').split(/\s*(?:-|–|to|\/)\s*/).filter(Boolean);
  if (parts.length < 2) return null;
  const unit = /mm/.test(text) ? ' mm' : '';
  const a = parseLength(parts[0].replace(/\s*(mm|in|")\s*$/, '') + unit), b = parseLength(parts[1].replace(/\s*(mm|in|")\s*$/, '') + unit);
  return a && b ? [Math.max(a, b), Math.min(a, b)] : null;
}

// Scale length in inches (or [bass, treble] for multi-scale), from the select or the custom fields.
export function scaleOf(spec) {
  if (spec.scale === 'other') return { inches: parseLength(spec.scaleCustom) };
  if (spec.scale === 'multi') { const p = parseMulti(spec.scaleMulti); return { multi: p, inches: p ? (p[0] + p[1]) / 2 : null }; }
  const n = parseFloat(spec.scale);
  return { inches: Number.isFinite(n) ? n : null };
}

export const fmtIn = n => `${Math.round(n * 1000) / 1000}" (${Math.round(n * 25.4)} mm)`;
