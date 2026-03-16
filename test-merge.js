/**
 * Test: merge logic preserves local data on "refresh" (remote empty or partial).
 * Run: node test-merge.js
 */

const STRATEGY_DEFAULT_ID = 'default';

// In-memory localStorage mock
const store = {};
const localStorage = {
  getItem(key) {
    return store[key] !== undefined ? store[key] : null;
  },
  setItem(key, value) {
    store[key] = String(value);
  },
};

// Replicate merge logic from applyAuthState (daily results only for brevity)
function mergeDailyResults(localResults, remoteResults) {
  const dailyResults = { ...localResults };
  for (const sid of Object.keys(remoteResults)) {
    const remoteBucket = remoteResults[sid];
    if (!remoteBucket || typeof remoteBucket !== 'object') continue;
    if (!dailyResults[sid]) dailyResults[sid] = {};
    for (const dateKey of Object.keys(remoteBucket)) {
      const remoteByDate = remoteBucket[dateKey];
      if (!remoteByDate || typeof remoteByDate !== 'object') continue;
      if (!dailyResults[sid][dateKey]) dailyResults[sid][dateKey] = {};
      for (const inst of Object.keys(remoteByDate)) {
        const entry = remoteByDate[inst];
        if (entry && typeof entry === 'object') dailyResults[sid][dateKey][inst] = entry;
      }
    }
  }
  return dailyResults;
}

function countEntries(data) {
  let n = 0;
  for (const sid of Object.keys(data)) {
    const b = data[sid];
    if (b && typeof b === 'object')
      for (const d of Object.keys(b)) {
        const byInst = b[d];
        if (byInst && typeof byInst === 'object') n += Object.keys(byInst).length;
      }
  }
  return n;
}

let passed = 0;
let failed = 0;

function ok(cond, msg) {
  if (cond) {
    passed++;
    console.log('  OK: ' + msg);
  } else {
    failed++;
    console.log('  FAIL: ' + msg);
  }
}

// Local March data (e.g. Default strategy, a few days)
const localWithMarch = {
  [STRATEGY_DEFAULT_ID]: {
    '2026-03-02': { NQ: { totalR: -1, tradeCount: 1, trade_1_r: -1 } },
    '2026-03-03': { NQ: { totalR: 1, tradeCount: 2 } },
    '2026-03-04': { NQ: { totalR: 2, tradeCount: 1, trade_1_r: 2 } },
  },
};

console.log('Test 1: Remote empty → local March preserved');
const merged1 = mergeDailyResults(localWithMarch, {});
ok(countEntries(merged1) === 3, 'merged has 3 entries');
ok(merged1[STRATEGY_DEFAULT_ID]['2026-03-02'].NQ.totalR === -1, 'March 2 data intact');
passed && failed === 0 && console.log('');

console.log('Test 2: Remote has one strategy with one row → local + remote both present');
const remotePartial = {
  [STRATEGY_DEFAULT_ID]: {
    '2026-03-10': { NQ: { totalR: 1, tradeCount: 1, trade_1_r: 1 } },
  },
};
const merged2 = mergeDailyResults(localWithMarch, remotePartial);
ok(countEntries(merged2) === 4, 'merged has 4 entries (3 local + 1 remote)');
ok(merged2[STRATEGY_DEFAULT_ID]['2026-03-02'].NQ.totalR === -1, 'March 2 local intact');
ok(merged2[STRATEGY_DEFAULT_ID]['2026-03-10'].NQ.totalR === 1, 'March 10 from remote');
passed && failed === 0 && console.log('');

console.log('Test 3: Remote overwrites same date/instrument (remote wins)');
const remoteOverwrite = {
  [STRATEGY_DEFAULT_ID]: {
    '2026-03-02': { NQ: { totalR: 2, tradeCount: 2 } },
  },
};
const merged3 = mergeDailyResults(localWithMarch, remoteOverwrite);
ok(merged3[STRATEGY_DEFAULT_ID]['2026-03-02'].NQ.totalR === 2, 'March 2 updated from remote');
ok(merged3[STRATEGY_DEFAULT_ID]['2026-03-03'].NQ.totalR === 1, 'March 3 unchanged');
passed && failed === 0 && console.log('');

console.log('Test 4: Second strategy (25pts) in local only → preserved when remote empty');
const localTwoStrategies = {
  [STRATEGY_DEFAULT_ID]: {
    '2026-03-02': { NQ: { totalR: -1, tradeCount: 1 } },
    '2026-03-05': { NQ: { totalR: -1, tradeCount: 1 } },
  },
  '25pts-uuid': {
    '2026-03-05': { NQ: { totalR: -1, tradeCount: 1 } },
  },
};
const merged4 = mergeDailyResults(JSON.parse(JSON.stringify(localTwoStrategies)), {});
ok(countEntries(merged4) === 3, 'merged has 3 entries (Default: 2, 25pts: 1)');
ok(merged4['25pts-uuid'] && merged4['25pts-uuid']['2026-03-05'].NQ.totalR === -1, '25pts March 5 intact');
passed && failed === 0 && console.log('');

console.log('---');
console.log('Result: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed > 0 ? 1 : 0);
