// Tool catalog for the account toolbox, and the per-guitar tool requirements the guide checks against it.

export const TOOL_CATALOG = [
  { cat: 'Measuring', items: [
    ['tuner-precise', 'Precise tuner (strobe app or pedal, ±1 cent)'],
    ['tuner-clip', 'Clip-on tuner'],
    ['feeler-gauges', 'Feeler gauges'],
    ['capo', 'Capo'],
    ['straightedge', 'Notched straightedge'],
    ['action-ruler', 'String action gauge or 6" ruler (64ths / 0.5 mm)'],
    ['caliper', 'Digital caliper'],
    ['radius-gauges', 'Understring radius gauges'],
    ['fret-rocker', 'Fret rocker'],
    ['hygrometer', 'Hygrometer'],
  ] },
  { cat: 'Keys & drivers', items: [
    ['hex-metric', 'Metric hex keys (1.5–5 mm)'],
    ['hex-imperial', 'Imperial hex keys (.050"–3/16")'],
    ['long-hex', 'Long-arm hex key (soundhole truss rods)'],
    ['nut-driver-516', '5/16" nut driver / truss rod wrench'],
    ['phillips', 'Phillips screwdrivers (#1 and #2)'],
    ['flat-small', 'Small flat screwdriver'],
  ] },
  { cat: 'Strings', items: [
    ['winder', 'Peg winder'],
    ['cutters', 'Wire / string cutters'],
    ['pin-puller', 'Bridge pin puller'],
    ['nut-lube', 'Nut lubricant or graphite'],
  ] },
  { cat: 'Setup aids', items: [
    ['trem-block', 'Trem setup block or stepped wedge'],
    ['intonation-tool', 'Saddle intonation tool (e.g. Red Bishop Accu-Locator)'],
    ['neck-rest', 'Neck rest / cradle'],
    ['work-mat', 'Work mat'],
    ['sandpaper-flat', 'Sandpaper (220 + 320) and a dead-flat surface'],
    ['saddle-shims', 'Saddle shims or a spare saddle blank'],
  ] },
  { cat: 'Frets', items: [
    ['tape', 'Low-tack painter\'s / masking tape'],
    ['fret-guards', 'Fret guards'],
    ['micromesh', 'Micro-mesh or fret polishing pads'],
  ] },
  { cat: 'Cleaning & care', items: [
    ['microfiber', 'Microfiber cloths'],
    ['naphtha', 'Naphtha (lighter fluid)'],
    ['polish', 'Instrument polish'],
    ['fb-oil', 'Fretboard conditioner / oil'],
    ['contact-cleaner', 'Contact cleaner (e.g. DeoxIT)'],
    ['spare-battery', 'Spare battery'],
    ['humidifier', 'Case or soundhole humidifier'],
  ] },
];

export const TOOL_LABEL = Object.fromEntries(TOOL_CATALOG.flatMap(c => c.items));

// Which truss-rod tool this guitar takes, as a list of acceptable catalog ids.
function trussNeed(c) {
  const t = (c.s.trussTool || '').toLowerCase();
  if (/5\/16/.test(t)) return ['nut-driver-516'];
  if (/\d\s*mm/.test(t)) return c.s.trussAccess === 'soundhole' ? ['long-hex', 'hex-metric'] : ['hex-metric'];
  if (/["”]|\d\/\d/.test(t)) return ['hex-imperial'];
  switch (c.s.trussAccess) {
    case 'soundhole': return ['long-hex'];
    case 'spoke': return ['hex-metric', 'hex-imperial'];
  }
  if (/gibson|epiphone/i.test(c.inst.make || '')) return ['nut-driver-516'];
  if (c.imperialKnown === true) return ['hex-imperial'];
  if (c.imperialKnown === false) return ['hex-metric'];
  return ['hex-metric', 'hex-imperial'];
}

// Rows: { job, need: [ids, any one satisfies], required, note, alt? (label when nothing in catalog fits) }
export function toolRequirements(c) {
  const { s } = c;
  const rows = [];
  const add = (job, need, required, note = '') => rows.push({ job, need, required, note });
  const hex = c.imperialKnown === true ? ['hex-imperial'] : c.imperialKnown === false ? ['hex-metric'] : ['hex-metric', 'hex-imperial'];

  add('Tuning and intonation', ['tuner-precise'], true, 'A clip-on is fine for tuning, not for setting intonation');
  add('String winding', ['winder'], false, 'Saves a lot of cranking');
  add('Cutting strings', ['cutters'], true, c.locking ? 'You\'ll also clip ball ends at every string change' : '');
  if (!c.noRod) {
    add('Measuring neck relief', ['feeler-gauges', 'straightedge'], true, 'Feeler gauges with a capo, or a notched straightedge on its own');
    add('Holding strings down for relief', ['capo', 'straightedge'], false, 'Not needed with a notched straightedge');
    add('Truss rod', trussNeed(c), true, s.trussTool ? `Yours: ${s.trussTool}` : 'Seat it fully before turning');
  }
  add('Measuring action', ['action-ruler', 'caliper'], true, '');
  if (c.isElectric || c.isBass) add('Bridge and saddle adjustments', hex, true, c.imperialKnown == null ? 'Not sure if your hardware is metric or imperial — either set, test the fit first' : `${c.imperialKnown ? 'Imperial' : 'Metric'} hardware is most likely`);
  add('Covers, pickguard, pickup height', ['phillips'], true, '');
  if (c.tom) add('Tune-o-matic intonation', ['flat-small'], true, '');
  if (c.individualSaddles && c.radius.gauge) add('Matching saddles to the fingerboard', ['radius-gauges'], false, `${c.radius.gauge}" gauge${c.radius.compound ? ' (the larger radius)' : ''}; you can eyeball it without one`);
  if (c.isTrem && c.floating) add('Holding the bridge level during setup', ['trem-block'], c.bridge === 'trem-locking', c.bridge === 'trem-locking' ? 'Turns a double-locking setup from a retune loop into one pass' : 'Optional but makes setup much faster');
  if (c.bridge === 'trem-locking') add('Intonation under tension', ['intonation-tool'], false, 'The slack-and-guess method works too');
  if (c.isAcoustic && s.bridgeAcoustic === 'pinned') add('Removing bridge pins', ['pin-puller', 'winder'], true, 'Most peg winders have a pin-puller notch');
  if (c.isAcoustic) add('Lowering the saddle (only if needed)', ['sandpaper-flat'], false, '');
  if (c.isAcoustic) add('Raising the saddle (only if needed)', ['saddle-shims'], false, '');
  add('Supporting the neck', ['neck-rest'], false, 'A rolled towel works in a pinch');
  add('Nut slots', ['nut-lube'], c.isTrem || c.bridge === 'bigsby', c.isTrem || c.bridge === 'bigsby' ? 'Key to a trem returning to pitch' : 'Stops pinging as you tune');
  add('Cleaning', ['microfiber'], true, '');
  add('Sticky grime', ['naphtha'], false, '');
  if (c.fbFinish === 'unfinished' && c.fbMat !== 'richlite') add('Conditioning the fingerboard', ['fb-oil'], true, 'The board is bare wood');
  if (!c.fretless) {
    add('Masking for fret work', ['tape', 'fret-guards'], false, '');
    add('Fret polishing', ['micromesh'], false, c.stainless ? 'Stainless frets rarely need it' : 'Every 3–4 string changes');
    add('Finding high frets', ['fret-rocker'], false, 'Only when chasing buzz');
  }
  add('Scratchy pots or switch', ['contact-cleaner'], false, '');
  if (c.hasBattery) add('Electronics battery', ['spare-battery'], true, s.battery && s.battery !== 'unsure' && s.battery !== 'none' ? `${s.battery.toUpperCase()}` : '');
  add('Humidity', c.isAcoustic && c.solidWood ? ['hygrometer'] : ['hygrometer'], c.isAcoustic, '');
  if (c.isAcoustic) add('Humidifying in dry seasons', ['humidifier'], c.solidWood && s.climate !== 'stable', c.solidWood ? 'Solid wood can crack in a dry winter' : '');
  return rows;
}

// owned: Set of catalog ids, or null when the user hasn't set up a toolbox.
export function checkTools(rows, owned) {
  return rows.map(r => {
    const have = owned ? r.need.filter(id => owned.has(id)) : [];
    const status = !owned ? 'unknown' : have.length ? 'have' : r.required ? 'missing' : 'optional';
    const toolLabel = have.length ? TOOL_LABEL[have[0]] : r.need.map(id => TOOL_LABEL[id]).join(' or ');
    return { ...r, status, toolLabel };
  });
}
