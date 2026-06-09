#!/usr/bin/env node
// ── Workout Tracker Test Suite ────────────────────────────────────────────────
// Run: node test_tracker.js [path-to-html]
// All tests must pass before any change is made to the tracker.

const vm = require('vm');
const fs = require('fs');
const path = require('path');

const FILE = process.argv[2] || path.join(__dirname, 'workout_tracker.html');
const html = fs.readFileSync(FILE, 'utf8');
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/);

let passed = 0, failed = 0, warnings = 0;

function pass(name) { console.log('  ✓  ' + name); passed++; }
function fail(name, reason) { console.log('  ✗  ' + name + (reason ? ' — ' + reason : '')); failed++; }
function warn(name, reason) { console.log('  ⚠  ' + name + (reason ? ' — ' + reason : '')); warnings++; }

function section(name) { console.log('\n' + name); console.log('─'.repeat(50)); }

// ── Helpers ───────────────────────────────────────────────────────────────────

function countOccurrences(str, sub) {
  let count = 0, pos = 0;
  while ((pos = str.indexOf(sub, pos)) !== -1) { count++; pos++; }
  return count;
}

// Build a sandboxed JS context with browser stubs
function buildSandbox() {
  const storage = {};
  function mockEl() {
    const el = { className:'', textContent:'', innerHTML:'', dataset:{}, style:{}, onclick:null, disabled:false, children:[], value:'' };
    el.appendChild = (c) => { el.children.push(c); return c; };
    el.querySelector = () => mockEl();
    el.querySelectorAll = () => ({ forEach: () => {} });
    el.addEventListener = () => {};
    el.classList = { add:()=>{}, remove:()=>{}, contains:()=>false, toggle:()=>{} };
    el.remove = () => {};
    el.parentNode = { insertBefore:()=>{}, appendChild:()=>{} };
    el.nextElementSibling = null;
    return el;
  }
  // Build sandbox with window pointing to itself BEFORE createContext
  const sandbox = {};
  const doc = { getElementById:()=>mockEl(), querySelector:()=>mockEl(), querySelectorAll:()=>({forEach:()=>{}}), createElement:()=>mockEl(), addEventListener:()=>{} };
  Object.assign(sandbox, {
    localStorage: { getItem:(k)=>storage[k]||null, setItem:(k,v)=>{storage[k]=v;}, removeItem:(k)=>{delete storage[k];} },
    document: doc,
    matchMedia: () => ({ matches: false }),
    alert: () => {}, prompt: () => null,
    clearInterval, setInterval, setTimeout, clearTimeout,
    Date, Math, JSON, parseInt, parseFloat, isNaN,
    Array, Object, String, Number, Promise,
    fetch: async () => ({ ok: false, status: 0, json: async () => ({}) }),
    console,
    navigator: { onLine: true },
    // addEventListener at top level for window.addEventListener calls
    addEventListener: () => {},
    removeEventListener: () => {},
  });
  // window must point to sandbox itself so window.X === sandbox.X
  sandbox.window = sandbox;
  return sandbox;
}

function runInSandbox(js, sandbox) {
  const ctx = vm.createContext(sandbox);
  vm.runInContext(js, ctx);
  return ctx;
}

// ── Section 1: Parse & Structure ─────────────────────────────────────────────
section('1. Parse & Structure');

// 1.1 Script block exists
if (!scriptMatch) { fail('Script block exists'); process.exit(1); }
else pass('Script block exists');

const js = scriptMatch[1];

// 1.2 JS parses without errors
try { new vm.Script(js); pass('JS parses without errors'); }
catch(e) { fail('JS parses without errors', e.message); }

// 1.3 File size reasonable (catches accidental deletions)
const lines = html.split('\n').length;
if (lines < 500) fail('File has reasonable size', `only ${lines} lines - likely truncated`);
else if (lines < 800) warn('File has reasonable size', `${lines} lines - smaller than expected`);
else pass(`File has reasonable size (${lines} lines)`);

// 1.4 No duplicate function definitions
const requiredFns = ['renderAll','buildChip','showMenu','renderTracker','startMySet','doneMySet',
  'tickRest','getTracker','mkSess','mkGrp','mkEx','getWeek','findSess','getAllHist',
  'updateStats','countSets','save','saveLib','renderLib','dropFromLib','saveToLib',
  'openVid','closeVid','renderHist','setupDrop','getWK','getWDates','fmtD','fmtDate',
  'ytId','normN','pad2','fmtHMS','uid'];
requiredFns.forEach(fn => {
  const count = countOccurrences(js, 'function ' + fn + '(');
  if (count === 0) fail('Function exists: ' + fn, 'NOT FOUND');
  else if (count > 1) fail('No duplicate: ' + fn, `found ${count} definitions`);
  else pass('Function exists (no duplicate): ' + fn);
});

// 1.5 No renderAll() calls inside timer setInterval callbacks
// (this was the bug that wiped DOM and broke timers)
const setIntervalBlocks = js.match(/setInterval\(function\(\)\{[^}]+\}/g) || [];
const timerRenderAll = setIntervalBlocks.some(b => b.includes('renderAll()'));
if (timerRenderAll) fail('No renderAll() inside setInterval callbacks');
else pass('No renderAll() inside setInterval callbacks');

// 1.6 No document.getElementById for session bar elements (use body.querySelector instead)
const badIdRefs = ['getElementById(\'sb-start-', 'getElementById(\'sb-end-', 'getElementById(\'sb-time-'];
const hasBadRef = badIdRefs.some(ref => {
  // Allow in function definition but not active usage for session bar
  const idx = js.indexOf(ref);
  if (idx === -1) return false;
  // Check if it's inside initSessBar (legacy function, not called)
  const fnStart = js.lastIndexOf('function initSessBar', idx);
  const fnEnd = js.indexOf('\nfunction ', fnStart + 1);
  return !(fnStart >= 0 && idx > fnStart && (fnEnd === -1 || idx < fnEnd));
});
if (hasBadRef) warn('Session bar uses body.querySelector not document.getElementById', 'may cause timer not working');
else pass('Session bar uses body.querySelector (not document.getElementById)');

// ── Section 2: HTML Structure ─────────────────────────────────────────────────
section('2. HTML Structure');

// 2.1 Required HTML elements
const requiredElements = ['id="days-list"', 'id="wk-label"', 'id="prev-wk"', 'id="next-wk"',
  'id="ws-sess"', 'id="ws-sets"', 'id="ws-grps"', 'id="ws-card"',
  'id="lib-section"', 'id="lib-grid"', 'id="lib-toggle"', 'id="api-banner"',
  'id="lib-name-input"', 'id="lib-save-btn"'];
requiredElements.forEach(el => {
  if (html.includes(el)) pass('HTML element: ' + el);
  else fail('HTML element: ' + el, 'MISSING from HTML');
});

// 2.2 Chart.js loaded
if (html.includes('chart.umd.js')) pass('Chart.js included');
else fail('Chart.js included', 'MISSING');

// ── Section 3: Content Checks ─────────────────────────────────────────────────
section('3. Content & Feature Checks');

const contentChecks = [
  // Legs routine
  ['Legs routine: Foam roll quads', 'Foam roll quads'],
  ['Legs routine: Tempo back squat', 'Tempo back squat'],
  ['Legs routine: Romanian deadlift tempo', 'Romanian deadlift tempo'],
  ['Legs routine: Elevated pigeon pose', 'Elevated pigeon pose'],
  ['Legs routine: YouTube - tempo squat', 'mmb618X9Ieg'],
  ['Legs routine: YouTube - RDL', 'Q5vwsJFwhyg'],
  // Set tracker UI
  ['Set tracker: Start set button', 't-start-btn'],
  ['Set tracker: Done button', 't-done-btn'],
  ['Set tracker: Rest ring', 't-ring-fill'],
  ['Set tracker: Reps input in active state', 'ti-reps-'],
  ['Set tracker: Kg input in active state', 'ti-kg-'],
  ['Set tracker: Per-set log', 't-set-log'],
  ['Set tracker: Pip dots', 't-pip'],
  // Session bar
  ['Session bar: HTML structure', 'sess-bar'],
  ['Session bar: Start button', 'sb-start'],
  ['Session bar: End button', 'sb-end'],
  ['Session bar: Time display', 'sb-time'],
  ['Session bar: body.querySelector wiring', "body.querySelector('#sb-start-"],
  // Library
  ['Library: Drop handler', 'dropFromLib'],
  ['Library: Save to lib', 'saveToLib'],
  ['Library: lib: drag prefix', "'lib:'"],
  // History
  ['History: Chart rendering', 'new Chart('],
  ['History: getAllHist loop', 'getAllHist'],
  // Completed tracking
  ['Session completed flag', 'lSess.completed'],
  ['Completed in updateStats', 's.completed'],
  // Version check (prevents stale localStorage)
  ['localStorage version check', "wt_v'"],
  // Export / Import
  ['Export: exportData function', 'exportData'],
  ['Export: importData function', 'importData'],
  ['Export: export button', 'export-btn'],
  ['Export: import input', 'import-input'],
  ['Export: creates JSON blob', 'application/json'],
  ['Export: filename with date', 'workout_data_'],
  // Reps stepper
  ['Reps stepper: minus button', 'reps-dec'],
  ['Reps stepper: plus button', 'reps-inc'],
  // Superset flow
  ['Superset: peers tracking', 'supersetPeers'],
  ['Superset: flow in doneMySet', 'supersetIdx'],
];

contentChecks.forEach(([name, needle]) => {
  if (html.includes(needle)) pass(needle === name ? name : name);
  else fail(name, `"${needle}" not found`);
});

// ── Section 4: Runtime Behaviour ──────────────────────────────────────────────
section('4. Runtime Behaviour');

let ctx;
try {
  const sandbox = buildSandbox();
  ctx = runInSandbox(js, sandbox);
  pass('JS executes in sandbox without throwing');
} catch(e) {
  fail('JS executes in sandbox without throwing', e.message);
  ctx = null;
}

if (ctx) {
  // 4.1 SESS object has all 6 session types
  try {
    const types = Object.keys(ctx.SESS);
    const expected = ['pull','push','legs','upper','circuit','cardio'];
    const missing = expected.filter(t => !types.includes(t));
    if (missing.length) fail('SESS has all 6 session types', 'missing: ' + missing.join(', '));
    else pass('SESS has all 6 session types: ' + types.join(', '));
  } catch(e) { fail('SESS object', e.message); }

  // 4.2 mkSess creates valid objects
  try {
    ['pull','push','legs','upper','circuit','cardio'].forEach(type => {
      const s = ctx.mkSess(type);
      if (!s.id) throw new Error(type + ': no id');
      if (!s.type) throw new Error(type + ': no type');
      if (!Array.isArray(s.groups)) throw new Error(type + ': groups not array');
      if (!s.cardio) throw new Error(type + ': no cardio');
    });
    pass('mkSess creates valid session objects for all types');
  } catch(e) { fail('mkSess creates valid session objects', e.message); }

  // 4.3 Legs session has correct exercises
  try {
    const legs = ctx.mkSess('legs');
    const names = legs.groups.map(g => g.exercises[0].name);
    const expected = ['Foam roll quads','Foam roll IT bands','Couch stretch','Tempo back squat'];
    const missing = expected.filter(n => !names.includes(n));
    if (missing.length) fail('Legs session has correct exercises', 'missing: ' + missing.join(', '));
    else pass('Legs session has correct exercises (' + legs.groups.length + ' groups)');
  } catch(e) { fail('Legs session exercises', e.message); }

  // 4.4 getWeek returns 7 days
  try {
    const wk = ctx.getWK(0);
    const days = ctx.getWeek(wk);
    if (!Array.isArray(days)) throw new Error('not an array');
    if (days.length !== 7) throw new Error('expected 7 days, got ' + days.length);
    pass('getWeek returns 7 days');
  } catch(e) { fail('getWeek returns 7 days', e.message); }

  // 4.5 Default week has correct session types
  try {
    const wk = ctx.getWK(0);
    const days = ctx.getWeek(wk);
    const types = days.map(d => d.map(s => s.type).join(','));
    const expected = ['pull','push','legs','upper','cardio','circuit','cardio'];
    expected.forEach((t, i) => {
      if (!types[i].includes(t)) throw new Error(`Day ${i+1}: expected ${t}, got ${types[i]}`);
    });
    pass('Default week has correct session types: ' + types.join(' | '));
  } catch(e) { fail('Default week session types', e.message); }

  // 4.6 getTracker initialises correctly
  try {
    const T = ctx.getTracker('test-vk-1', 4);
    if (T.state !== 'idle') throw new Error('state should be idle');
    if (T.totalSets !== 4) throw new Error('totalSets should be 4');
    if (T.setsDone !== 0) throw new Error('setsDone should be 0');
    if (!Array.isArray(T.setLog)) throw new Error('setLog should be array');
    pass('getTracker initialises correctly');
  } catch(e) { fail('getTracker initialises', e.message); }

  // 4.7 getTracker updates totalSets if already exists
  try {
    ctx.getTracker('test-vk-2', 3);
    const T = ctx.getTracker('test-vk-2', 5);
    if (T.totalSets !== 5) throw new Error('totalSets should update to 5');
    pass('getTracker updates totalSets on subsequent call');
  } catch(e) { fail('getTracker updates totalSets', e.message); }

  // 4.8 startMySet changes state to active
  try {
    ctx.getTracker('test-vk-3', 3);
    ctx.startMySet('test-vk-3');
    if (ctx.setTrackers['test-vk-3'].state !== 'active') throw new Error('state should be active');
    pass('startMySet sets state to active');
  } catch(e) { fail('startMySet sets state to active', e.message); }

  // 4.9 doneMySet increments setsDone, logs set, changes state to resting
  try {
    ctx.getTracker('test-vk-4', 3);
    ctx.setTrackers['test-vk-4'].curReps = '8';
    ctx.setTrackers['test-vk-4'].curKg = '80';
    ctx.startMySet('test-vk-4');
    ctx.doneMySet('test-vk-4');
    const T = ctx.setTrackers['test-vk-4'];
    if (T.state !== 'resting') throw new Error('state should be resting, got: ' + T.state);
    if (T.setsDone !== 1) throw new Error('setsDone should be 1');
    if (!T.setLog || T.setLog.length !== 1) throw new Error('setLog should have 1 entry');
    if (T.setLog[0].reps !== '8') throw new Error('reps not logged correctly');
    if (T.setLog[0].kg !== '80') throw new Error('kg not logged correctly');
    pass('doneMySet increments setsDone, logs reps/kg, sets state to resting');
  } catch(e) { fail('doneMySet behaviour', e.message); }

  // 4.10 getAllHist returns correct shape
  try {
    const hist = ctx.getAllHist('Squat');
    if (!Array.isArray(hist)) throw new Error('should return array');
    pass('getAllHist returns array');
  } catch(e) { fail('getAllHist returns array', e.message); }

  // 4.11 countSets works
  try {
    const sess = ctx.mkSess('pull');
    sess.groups[0].exercises[0].sets = '4';
    const n = ctx.countSets(sess);
    if (n !== 4) throw new Error('expected 4, got ' + n);
    pass('countSets counts correctly');
  } catch(e) { fail('countSets', e.message); }

  // 4.12 findSess returns correct session
  try {
    const wk = ctx.getWK(0);
    const days = ctx.getWeek(wk);
    const target = days[0][0];
    const found = ctx.findSess(target.id, wk);
    if (!found) throw new Error('session not found');
    if (found.id !== target.id) throw new Error('wrong session returned');
    pass('findSess locates session by id');
  } catch(e) { fail('findSess', e.message); }

  // 4.13 Library functions exist and work
  try {
    const before = ctx.library.length;
    const sess = ctx.mkSess('push');
    ctx.library.push({name:'Test Push',type:'push',groups:sess.groups,notes:'',prs:[]});
    if (ctx.library.length !== before + 1) throw new Error('library not updated');
    pass('Library array is mutable and accessible');
  } catch(e) { fail('Library array', e.message); }

  // 4.14 WEEK_DEF has 7 entries
  try {
    if (!Array.isArray(ctx.WEEK_DEF)) throw new Error('not an array');
    if (ctx.WEEK_DEF.length !== 7) throw new Error('expected 7, got ' + ctx.WEEK_DEF.length);
    pass('WEEK_DEF has 7 entries');
  } catch(e) { fail('WEEK_DEF', e.message); }

  // 4.15 uid() generates unique IDs
  try {
    const ids = new Set();
    for (let i = 0; i < 20; i++) ids.add(ctx.uid());
    if (ids.size !== 20) throw new Error('duplicate IDs generated');
    pass('uid() generates unique IDs (20 checked)');
  } catch(e) { fail('uid() uniqueness', e.message); }

  // 4.16 pad2 works correctly
  try {
    if (ctx.pad2(5) !== '05') throw new Error('pad2(5) should be "05"');
    if (ctx.pad2(12) !== '12') throw new Error('pad2(12) should be "12"');
    if (ctx.pad2(0) !== '00') throw new Error('pad2(0) should be "00"');
    pass('pad2() formats correctly');
  } catch(e) { fail('pad2()', e.message); }

  // 4.17 fmtHMS works
  try {
    if (ctx.fmtHMS(3661000) !== '01:01:01') throw new Error('fmtHMS(3661000) should be 01:01:01');
    if (ctx.fmtHMS(0) !== '00:00:00') throw new Error('fmtHMS(0) should be 00:00:00');
    pass('fmtHMS() formats correctly');
  } catch(e) { fail('fmtHMS()', e.message); }

  // 4.18 ytId extracts correctly
  try {
    const cases = [
      ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
      ['https://youtu.be/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
      ['dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
      ['', null],
      [null, null],
    ];
    cases.forEach(([input, expected]) => {
      const result = ctx.ytId(input);
      if (result !== expected) throw new Error(`ytId("${input}") = "${result}", expected "${expected}"`);
    });
    pass('ytId() extracts YouTube IDs correctly');
  } catch(e) { fail('ytId()', e.message); }

  // 4.19 Session timer state initialises correctly
  try {
    if (!ctx.sessTimers) throw new Error('sessTimers object missing');
    pass('sessTimers object exists');
  } catch(e) { fail('sessTimers object', e.message); }

  // 4.20 RING_C constant
  try {
    if (Math.abs(ctx.RING_C - 314.16) > 0.01) throw new Error('RING_C should be ~314.16, got ' + ctx.RING_C);
    pass('RING_C constant correct (314.16)');
  } catch(e) { fail('RING_C constant', e.message); }

  // 4.21 Export/import functions exist
  try {
    if (typeof ctx.exportData !== 'function') throw new Error('exportData not a function');
    if (typeof ctx.importData !== 'function') throw new Error('importData not a function');
    pass('exportData and importData functions exist');
  } catch(e) { fail('Export/import functions', e.message); }

  // 4.22 Superset tracker initialises with peers
  try {
    var peers = ['test-ss-0', 'test-ss-1'];
    var T0 = ctx.getTracker('test-ss-0', 3, peers);
    var T1 = ctx.getTracker('test-ss-1', 3, peers);
    if (!T0.supersetPeers) throw new Error('supersetPeers not set on T0');
    if (T0.supersetPeers.length !== 2) throw new Error('expected 2 peers');
    pass('Superset tracker initialises with peers list');
  } catch(e) { fail('Superset tracker peers', e.message); }

  // 4.23 Reps stepper: getTracker preserves totalSets
  try {
    var T = ctx.getTracker('reps-test', 5);
    if (T.totalSets !== 5) throw new Error('totalSets should be 5');
    // Update
    ctx.getTracker('reps-test', 8);
    if (ctx.setTrackers['reps-test'].totalSets !== 8) throw new Error('totalSets should update to 8');
    pass('getTracker correctly updates totalSets for reps stepper');
  } catch(e) { fail('getTracker totalSets update', e.message); }
}

// ── Section 5: Regression Guards ─────────────────────────────────────────────
section('5. Regression Guards');

// 5.1 No template literals containing renderAll (timer callback bug)
const templateLiterals = js.match(/`[^`]+`/g) || [];
const tlWithRenderAll = templateLiterals.filter(t => t.includes('renderAll'));
if (tlWithRenderAll.length > 0) warn('No renderAll inside template literals', `found ${tlWithRenderAll.length} occurrences`);
else pass('No renderAll inside template literals');

// 5.2 initSessBar function NOT called from buildChip (stale closure bug)
const buildChipIdx = js.indexOf('function buildChip(');
const buildChipEnd = js.indexOf('\nfunction ', buildChipIdx + 1);
const buildChipBody = buildChipEnd > 0 ? js.slice(buildChipIdx, buildChipEnd) : js.slice(buildChipIdx);
if (buildChipBody.includes('initSessBar(sess.id)')) fail('initSessBar NOT called from buildChip', 'stale closure bug still present');
else pass('initSessBar not called from buildChip (session bar uses body.querySelector)');

// 5.3 body.querySelector used for session bar (not getElementById)
if (html.includes("body.querySelector('#sb-start-")) pass('Session bar wired via body.querySelector');
else fail('Session bar wired via body.querySelector', 'may use getElementById which fails on detached elements');

// 5.4 setLog exists in tracker state
if (js.includes('setLog:[]')) pass('setLog array in tracker state');
else fail('setLog array in tracker state', 'per-set logging may be broken');

// 5.5 Per-set reps/kg inputs in active state
if (js.includes('ti-reps-') && js.includes('ti-kg-')) pass('Per-set reps/kg inputs in active state');
else fail('Per-set reps/kg inputs in active state', 'inputs missing');

// 5.6 Completed session flag saved
if (js.includes('lSess.completed=true') && js.includes('lSess.completedTime')) pass('Session completed flag saved on end');
else fail('Session completed flag saved on end');

// 5.7 Version key prevents stale data
if (js.includes("'wt_v'") && js.includes("wt_d'")) pass("localStorage version check present");
else fail("localStorage version check", 'stale data protection missing');

// 5.8 Legs plan has 9 exercises
try {
  const sandbox = buildSandbox();
  const ctx2 = runInSandbox(js, sandbox);
  const legs = ctx2.mkSess('legs');
  const total = legs.groups.reduce((n, g) => n + g.exercises.length, 0);
  if (total === 9) pass('Legs plan has exactly 9 exercises');
  else fail('Legs plan has exactly 9 exercises', `got ${total}`);
} catch(e) { fail('Legs plan exercise count', e.message); }

// ── Summary ───────────────────────────────────────────────────────────────────
console.log('\n' + '═'.repeat(50));
console.log(`RESULTS: ${passed} passed, ${failed} failed, ${warnings} warnings`);
console.log('═'.repeat(50));
if (failed > 0) {
  console.log('\n❌  TESTS FAILED — do not proceed with changes\n');
  process.exit(1);
} else if (warnings > 0) {
  console.log('\n⚠️   Tests passed with warnings — review before proceeding\n');
  process.exit(0);
} else {
  console.log('\n✅  All tests passed — safe to proceed\n');
  process.exit(0);
}
