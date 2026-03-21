/**
 * Tagverse Edge — Calendar, declarations, log modal, analytics, share, settings
 */

const STORAGE_KEYS = { dailyResults: 'tagverse_daily_results', declarations: 'tagverse_declarations', theme: 'tagverse_theme', shareTokens: 'tagverse_share_tokens', selectedInstrument: 'tagverse_selected_instrument', mode: 'tagverse_mode', strategies: 'tagverse_strategies', selectedStrategy: 'tagverse_selected_strategy' };

const STRATEGY_DEFAULT_ID = 'default';

const MODES = { BACKTEST: 'backtest', LIVE: 'live' };

// Supabase config: replace with your own values from Supabase project settings.
const SUPABASE_URL = window.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = window.SUPABASE_ANON_KEY || '';

let supabaseClient = null;
let currentUser = null;
let currentMode = MODES.LIVE;
let currentProfile = null;
let lastShareToken = null;
let lastSharePayload = null;

function isSupabaseEnabled() {
  return typeof window.supabase !== 'undefined' && SUPABASE_URL && SUPABASE_ANON_KEY;
}

function initSupabase() {
  if (!isSupabaseEnabled()) return null;
  if (!supabaseClient) {
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      db: { schema: 'public' }
    });
  }
  return supabaseClient;
}

async function fetchCurrentProfile(userId) {
  const supa = initSupabase();
  if (!supa || !userId) return null;
  const { data, error } = await supa.from('profiles').select('*').eq('id', userId).maybeSingle();
  if (error) return null;
  return data;
}

/** Trim, strip leading @, lowercase so "Trader" and "trader" cannot both exist (matches DB uniqueness). */
function normalizeUsername(raw) {
  if (raw == null || typeof raw !== 'string') return '';
  let s = raw.trim();
  if (s.startsWith('@')) s = s.slice(1).trim();
  return s.toLowerCase();
}

function isUniqueViolationError(err) {
  if (!err) return false;
  const code = String(err.code || '');
  if (code === '23505') return true;
  const msg = String(err.message || '');
  return /duplicate key|unique constraint/i.test(msg);
}

function formatPostgrestError(err) {
  if (!err) return '';
  const root = err.cause && typeof err.cause === 'object' ? err.cause : err;
  if (isUniqueViolationError(root)) return 'This username is already taken.';
  if (!('details' in root) && !('hint' in root) && typeof root.message === 'string') return root.message;
  const parts = [root.message, root.details, root.hint].filter(Boolean);
  if (root.code) parts.unshift(`[${root.code}]`);
  return parts.join(' — ');
}

/** Returns true if another profile (not userId) already uses this exact normalized username. */
async function isUsernameTakenByOther(userId, normalized) {
  const supa = initSupabase();
  if (!supa || !userId || !normalized) return false;
  const { data, error } = await supa.from('profiles').select('id').eq('username', normalized).neq('id', userId).maybeSingle();
  if (error) return false;
  return !!data;
}

/** Updates the circular initials avatar on Settings → Profile (preview while typing). */
function updateSettingsAvatarPreview() {
  const el = document.getElementById('settingsAvatarInitials');
  if (!el) return;
  const input = document.getElementById('settingsUsername');
  const raw =
    input && typeof input.value === 'string' ? input.value : (currentProfile && currentProfile.username) || '';
  const u = normalizeUsername(raw);
  if (!u) {
    el.textContent = '?';
    return;
  }
  const parts = u.split(/[\s_-]+/).filter(Boolean);
  let initials = '';
  if (parts.length >= 2) initials = (parts[0][0] + parts[1][0]).toUpperCase();
  else if (u.length >= 2) initials = u.slice(0, 2).toUpperCase();
  else initials = u[0].toUpperCase();
  el.textContent = initials;
}

/**
 * Create/update profile row. Uses upsert(onConflict: id), then update/insert fallbacks for stubborn API issues.
 */
async function upsertProfile(userId, fields) {
  const supa = initSupabase();
  if (!supa || !userId) return { error: new Error('Supabase not available') };
  const payload = { id: userId, ...fields };
  const { id: _rowId, ...updateFields } = payload;

  const tryUpsert = await supa.from('profiles').upsert(payload, { onConflict: 'id' }).select().maybeSingle();
  if (!tryUpsert.error && tryUpsert.data) {
    currentProfile = tryUpsert.data;
    return { data: tryUpsert.data, error: null };
  }

  const tryUpdate = await supa.from('profiles').update(updateFields).eq('id', userId).select().maybeSingle();
  if (!tryUpdate.error && tryUpdate.data) {
    currentProfile = tryUpdate.data;
    return { data: tryUpdate.data, error: null };
  }

  const tryInsert = await supa.from('profiles').insert(payload).select().maybeSingle();
  if (!tryInsert.error && tryInsert.data) {
    currentProfile = tryInsert.data;
    return { data: tryInsert.data, error: null };
  }

  const primary = tryUpsert.error || tryUpdate.error || tryInsert.error;
  const msg = formatPostgrestError(primary) || primary?.message || 'Could not save profile.';
  return {
    data: null,
    error: new Error(msg, primary ? { cause: primary } : undefined)
  };
}

function loadCurrentMode() {
  try {
    const v = localStorage.getItem(STORAGE_KEYS.mode);
    if (v === MODES.BACKTEST || v === MODES.LIVE) return v;
  } catch (_) {}
  return MODES.LIVE;
}

function saveCurrentMode(mode) {
  try {
    localStorage.setItem(STORAGE_KEYS.mode, mode);
  } catch (_) {}
}

const INSTRUMENTS = ['NQ', 'YM', 'GC', 'ES'];
const DEFAULT_INSTRUMENT = 'NQ';

function isFlatShape(obj) {
  if (!obj || typeof obj !== 'object') return false;
  const first = Object.keys(obj)[0];
  return first && /^\d{4}-\d{2}-\d{2}$/.test(first);
}

function loadStrategies() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.strategies);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch (_) {}
  return [{ id: STRATEGY_DEFAULT_ID, name: 'Default' }];
}

function saveStrategies(list) {
  try {
    localStorage.setItem(STORAGE_KEYS.strategies, JSON.stringify(list));
  } catch (_) {}
}

function loadSelectedStrategyId() {
  try {
    const v = localStorage.getItem(STORAGE_KEYS.selectedStrategy);
    const list = loadStrategies();
    if (list.some((s) => s.id === v)) return v;
  } catch (_) {}
  return STRATEGY_DEFAULT_ID;
}

function saveSelectedStrategyId(id) {
  try {
    localStorage.setItem(STORAGE_KEYS.selectedStrategy, id);
  } catch (_) {}
}

function createStrategy(name) {
  const id = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : 's-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9);
  const list = loadStrategies();
  list.push({ id, name: (name || 'Strategy').trim() || 'Strategy' });
  saveStrategies(list);
  saveSelectedStrategyId(id);
  return id;
}

function renameStrategy(id, newName) {
  const trimmed = (newName || '').trim();
  if (!trimmed) return;
  const list = loadStrategies().map((s) => (s.id === id ? { ...s, name: trimmed } : s));
  saveStrategies(list);
  strategies = list;
  if (currentUser && id === STRATEGY_DEFAULT_ID) {
    void persistDefaultStrategyNameToSupabase(trimmed);
  } else if (currentUser && id !== STRATEGY_DEFAULT_ID && /^[0-9a-f-]{36}$/i.test(id)) {
    void updateStrategyNameInSupabase(currentUser.id, id, trimmed);
  }
  renderStrategyPills();
  renderCalendar();
  if (typeof window.renderAnalytics === 'function') window.renderAnalytics();
  if (typeof window.renderCompareStrategies === 'function') window.renderCompareStrategies();
}

function deleteStrategy(id) {
  if (id === STRATEGY_DEFAULT_ID) return;
  const list = loadStrategies().filter((s) => s.id !== id);
  if (list.length === 0) return;
  saveStrategies(list);
  delete dailyResults[id];
  delete declarations[id];
  saveDailyResults(dailyResults);
  saveDeclarations(declarations);
  if (currentUser) deleteStrategyFromSupabase(currentUser.id, id);
  if (selectedStrategyId === id) {
    selectedStrategyId = list[0].id;
    saveSelectedStrategyId(selectedStrategyId);
  }
  strategies = loadStrategies();
  renderStrategyPills();
  renderCalendar();
  if (typeof window.renderAnalytics === 'function') window.renderAnalytics();
  if (typeof window.renderCompareStrategies === 'function') window.renderCompareStrategies();
}

let strategies = loadStrategies();
let selectedStrategyId = loadSelectedStrategyId();

function isLegacyDailyEntry(v) {
  return v && typeof v === 'object' && 'totalR' in v && typeof v.totalR === 'number' && !INSTRUMENTS.some((i) => i in v);
}

function isLegacyDeclarationEntry(v) {
  return v && typeof v === 'object' && 'tradeCountPlanned' in v && 'createdAt' in v && !INSTRUMENTS.some((i) => i in v);
}

function migrateDailyResults(data) {
  let changed = false;
  const out = {};
  for (const dateKey of Object.keys(data)) {
    const v = data[dateKey];
    if (isLegacyDailyEntry(v)) {
      changed = true;
      const entry = { totalR: v.totalR, tradeCount: v.tradeCount };
      if (v.trade_1_r != null) entry.trade_1_r = v.trade_1_r;
      out[dateKey] = { [DEFAULT_INSTRUMENT]: entry };
    } else {
      out[dateKey] = v;
    }
  }
  return changed ? out : data;
}

function migrateDeclarations(data) {
  let changed = false;
  const out = {};
  for (const dateKey of Object.keys(data)) {
    const v = data[dateKey];
    if (isLegacyDeclarationEntry(v)) {
      changed = true;
      out[dateKey] = { [DEFAULT_INSTRUMENT]: { tradeCountPlanned: v.tradeCountPlanned, createdAt: v.createdAt } };
    } else {
      out[dateKey] = v;
    }
  }
  return changed ? out : data;
}

const SAMPLE_DAILY_PL = {
  '2026-03-02': { amount: -622.88, trades: 2 },
  '2026-03-03': { amount: -200.00, trades: 1 },
  '2026-03-04': { amount: 446.30, trades: 1 },
  '2026-03-05': { amount: -350.00, trades: 2 },
  '2026-03-06': { amount: -93.64, trades: 1 },
  '2026-03-07': { amount: -446.30, trades: 1 },
};

function amountToR(amount, trades) {
  if (amount < 0) return -Math.abs(trades);
  if (trades === 1) return 2;
  if (trades === 2) return 1;
  return trades;
}

function getInitialDailyResults() {
  const initial = {};
  Object.keys(SAMPLE_DAILY_PL).forEach((k) => {
    const d = SAMPLE_DAILY_PL[k];
    const totalR = amountToR(d.amount, d.trades);
    const entry = { totalR, tradeCount: d.trades };
    if (d.trades === 1) entry.trade_1_r = totalR;
    initial[k] = { [DEFAULT_INSTRUMENT]: entry };
  });
  return initial;
}

function loadDailyResults() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.dailyResults);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (typeof parsed === 'object' && parsed !== null) {
        if (isFlatShape(parsed)) {
          const migrated = migrateDailyResults(parsed);
          const nested = { [STRATEGY_DEFAULT_ID]: migrated };
          saveDailyResults(nested);
          return nested;
        }
        const out = {};
        for (const stratId of Object.keys(parsed)) {
          const inner = parsed[stratId];
          if (typeof inner === 'object' && inner !== null) out[stratId] = migrateDailyResults(inner);
          else out[stratId] = {};
        }
        if (Object.keys(out).length > 0) return out;
      }
    }
  } catch (_) {}
  return { [STRATEGY_DEFAULT_ID]: getInitialDailyResults() };
}

function loadDeclarations() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.declarations);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (typeof parsed === 'object' && parsed !== null) {
        if (isFlatShape(parsed)) {
          const migrated = migrateDeclarations(parsed);
          const nested = { [STRATEGY_DEFAULT_ID]: migrated };
          saveDeclarations(nested);
          return nested;
        }
        const out = {};
        for (const stratId of Object.keys(parsed)) {
          const inner = parsed[stratId];
          if (typeof inner === 'object' && inner !== null) out[stratId] = migrateDeclarations(inner);
          else out[stratId] = {};
        }
        return out;
      }
    }
  } catch (_) {}
  return { [STRATEGY_DEFAULT_ID]: {} };
}

function saveDailyResults(data) {
  try {
    localStorage.setItem(STORAGE_KEYS.dailyResults, JSON.stringify(data));
  } catch (_) {}
}

/** Deep clone for calendar data (JSON-safe). */
function deepCloneData(obj) {
  try {
    return JSON.parse(JSON.stringify(obj));
  } catch (_) {
    return {};
  }
}

/**
 * Cloud-first: start from remote (Supabase). Remote wins on conflicts.
 * Local-only cells (not present in remote) are merged in and uploaded (awaited so writes finish).
 */
async function mergeDailyResultsCloudFirst(remoteResults, localResults, userId) {
  const merged = deepCloneData(remoteResults);
  for (const sid of Object.keys(localResults || {})) {
    const bucket = localResults[sid];
    if (!bucket || typeof bucket !== 'object') continue;
    if (!merged[sid]) merged[sid] = {};
    for (const dateKey of Object.keys(bucket)) {
      const byDate = bucket[dateKey];
      if (!byDate || typeof byDate !== 'object') continue;
      if (!merged[sid][dateKey]) merged[sid][dateKey] = {};
      const normalized = isLegacyDailyEntry(byDate) ? migrateDailyResults({ [dateKey]: byDate }) : { [dateKey]: byDate };
      const byDateNorm = normalized[dateKey];
      if (!byDateNorm || typeof byDateNorm !== 'object') continue;
      for (const inst of Object.keys(byDateNorm)) {
        const entry = byDateNorm[inst];
        if (!entry || typeof entry !== 'object') continue;
        if (!merged[sid][dateKey][inst]) {
          merged[sid][dateKey][inst] = { ...entry };
          if (userId) {
            const { error } = await persistDayResultToSupabase(userId, sid, dateKey, inst, merged[sid][dateKey][inst]);
            if (error) console.error('[Tagverse] merge upload daily_results failed for', dateKey, inst);
          }
        }
      }
    }
  }
  return merged;
}

/**
 * Same as mergeDailyResultsCloudFirst for declarations.
 */
async function mergeDeclarationsCloudFirst(remoteDeclarations, localDeclarations, userId) {
  const merged = deepCloneData(remoteDeclarations);
  for (const sid of Object.keys(localDeclarations || {})) {
    const bucket = localDeclarations[sid];
    if (!bucket || typeof bucket !== 'object') continue;
    if (!merged[sid]) merged[sid] = {};
    for (const dateKey of Object.keys(bucket)) {
      const byDate = bucket[dateKey];
      if (!byDate || typeof byDate !== 'object') continue;
      if (!merged[sid][dateKey]) merged[sid][dateKey] = {};
      const normalized = isLegacyDeclarationEntry(byDate) ? migrateDeclarations({ [dateKey]: byDate }) : { [dateKey]: byDate };
      const byDateNorm = normalized[dateKey];
      if (!byDateNorm || typeof byDateNorm !== 'object') continue;
      for (const inst of Object.keys(byDateNorm)) {
        const entry = byDateNorm[inst];
        if (!entry || typeof entry !== 'object') continue;
        if (!merged[sid][dateKey][inst]) {
          merged[sid][dateKey][inst] = { ...entry };
          if (userId) {
            const { error } = await persistDeclarationToSupabase(userId, sid, dateKey, inst, entry.tradeCountPlanned, entry.createdAt);
            if (error) console.error('[Tagverse] merge upload declarations failed for', dateKey, inst);
          }
        }
      }
    }
  }
  return merged;
}

function saveDeclarations(data) {
  try {
    localStorage.setItem(STORAGE_KEYS.declarations, JSON.stringify(data));
  } catch (_) {}
}

async function fetchDailyResultsFromSupabase(userId) {
  const supa = initSupabase();
  if (!supa) return {};
  const { data: rows, error } = await supa.from('daily_results').select('strategy_id, date_key, instrument, total_r, trade_count, trade_1_r').eq('user_id', userId);
  if (error) {
    console.error('[Tagverse] fetch daily_results failed:', error.message, error);
    return {};
  }
  const out = {};
  (rows || []).forEach((r) => {
    const sid = r.strategy_id || STRATEGY_DEFAULT_ID;
    if (!out[sid]) out[sid] = {};
    if (!out[sid][r.date_key]) out[sid][r.date_key] = {};
    out[sid][r.date_key][r.instrument] = { totalR: r.total_r, tradeCount: r.trade_count };
    if (r.trade_1_r != null) out[sid][r.date_key][r.instrument].trade_1_r = r.trade_1_r;
  });
  return out;
}

async function fetchDeclarationsFromSupabase(userId) {
  const supa = initSupabase();
  if (!supa) return {};
  const { data: rows, error } = await supa.from('declarations').select('strategy_id, date_key, instrument, trade_count_planned, created_at').eq('user_id', userId);
  if (error) {
    console.error('[Tagverse] fetch declarations failed:', error.message, error);
    return {};
  }
  const out = {};
  (rows || []).forEach((r) => {
    const sid = r.strategy_id || STRATEGY_DEFAULT_ID;
    if (!out[sid]) out[sid] = {};
    if (!out[sid][r.date_key]) out[sid][r.date_key] = {};
    out[sid][r.date_key][r.instrument] = { tradeCountPlanned: r.trade_count_planned, createdAt: r.created_at };
  });
  return out;
}

async function fetchStrategiesFromSupabase(userId) {
  const supa = initSupabase();
  if (!supa) return null;
  const { data: rows, error } = await supa.from('strategies').select('id, name').eq('user_id', userId).order('created_at');
  if (error) return null;
  return (rows || []).map((r) => ({ id: r.id, name: r.name }));
}

async function insertStrategyToSupabase(userId, id, name) {
  const supa = initSupabase();
  if (!supa) return;
  if (id === STRATEGY_DEFAULT_ID) return;
  await supa.from('strategies').insert({ id, user_id: userId, name });
}

async function updateStrategyNameInSupabase(userId, id, name) {
  const supa = initSupabase();
  if (!supa) return;
  if (id === STRATEGY_DEFAULT_ID) return;
  const { error } = await supa.from('strategies').update({ name }).eq('id', id).eq('user_id', userId);
  if (error) console.error('[Tagverse] strategy name update failed', error.message);
}

/** Sync renamed "Default" strategy label to Supabase (profiles row or auth metadata fallback). */
async function persistDefaultStrategyNameToSupabase(name) {
  const supa = initSupabase();
  if (!supa || !currentUser) return;
  if (currentProfile) {
    const { error } = await supa.from('profiles').update({ default_strategy_name: name }).eq('id', currentUser.id);
    if (error) console.error('[Tagverse] default_strategy_name update failed', error.message);
    else currentProfile = await fetchCurrentProfile(currentUser.id);
  } else {
    const { error } = await supa.auth.updateUser({ data: { default_strategy_name: name } });
    if (error) console.error('[Tagverse] default_strategy_name (metadata) failed', error.message);
    const { data } = await supa.auth.getSession();
    if (data?.session?.user) currentUser = data.session.user;
  }
}

async function persistDayResultToSupabase(userId, strategyId, dateKey, instrument, entry) {
  const supa = initSupabase();
  if (!supa) return { error: new Error('Supabase not configured') };
  const row = {
    user_id: userId,
    date_key: dateKey,
    instrument,
    total_r: entry.totalR,
    trade_count: entry.tradeCount,
    trade_1_r: entry.trade_1_r ?? null,
    strategy_id: strategyId === STRATEGY_DEFAULT_ID ? null : strategyId
  };
  const { error } = await supa.from('daily_results').upsert(row, { onConflict: 'user_id,date_key,instrument' });
  if (error) console.error('[Tagverse] persist daily_results failed:', error.message, { dateKey, instrument, strategyId });
  return { error };
}

async function persistDeclarationToSupabase(userId, strategyId, dateKey, instrument, tradeCountPlanned, createdAt) {
  const supa = initSupabase();
  if (!supa) return { error: new Error('Supabase not configured') };
  const row = {
    user_id: userId,
    date_key: dateKey,
    instrument,
    trade_count_planned: tradeCountPlanned,
    created_at: createdAt,
    strategy_id: strategyId === STRATEGY_DEFAULT_ID ? null : strategyId
  };
  const { error } = await supa.from('declarations').upsert(row, { onConflict: 'user_id,date_key,instrument' });
  if (error) console.error('[Tagverse] persist declarations failed:', error.message, { dateKey, instrument, strategyId });
  return { error };
}

async function deleteDayResultFromSupabase(userId, strategyId, dateKey, instrument) {
  const supa = initSupabase();
  if (!supa) return;
  let q = supa.from('daily_results').delete().eq('user_id', userId).eq('date_key', dateKey).eq('instrument', instrument);
  if (strategyId !== STRATEGY_DEFAULT_ID) q = q.eq('strategy_id', strategyId);
  await q;
}

async function deleteDeclarationFromSupabase(userId, strategyId, dateKey, instrument) {
  const supa = initSupabase();
  if (!supa) return;
  let q = supa.from('declarations').delete().eq('user_id', userId).eq('date_key', dateKey).eq('instrument', instrument);
  if (strategyId !== STRATEGY_DEFAULT_ID) q = q.eq('strategy_id', strategyId);
  await q;
}

async function deleteStrategyFromSupabase(userId, strategyId) {
  if (!strategyId || strategyId === STRATEGY_DEFAULT_ID || !/^[0-9a-f-]{36}$/i.test(strategyId)) return;
  const supa = initSupabase();
  if (!supa) return;
  await supa.from('daily_results').delete().eq('user_id', userId).eq('strategy_id', strategyId);
  await supa.from('declarations').delete().eq('user_id', userId).eq('strategy_id', strategyId);
  await supa.from('strategies').delete().eq('id', strategyId).eq('user_id', userId);
}

let dailyResults = loadDailyResults();
let declarations = loadDeclarations();

let currentDate = new Date();
let selectedDate = new Date();
let logModalTargetDate = null;

function loadSelectedInstrument() {
  try {
    const v = localStorage.getItem(STORAGE_KEYS.selectedInstrument);
    if (INSTRUMENTS.includes(v)) return v;
  } catch (_) {}
  return DEFAULT_INSTRUMENT;
}

function saveSelectedInstrument(instrument) {
  try {
    localStorage.setItem(STORAGE_KEYS.selectedInstrument, instrument);
  } catch (_) {}
}

let selectedInstrument = loadSelectedInstrument();

/** Persist all in-memory calendar/auth prefs to localStorage (e.g. when offline user taps Save locally). */
function flushAllLocalDataToStorage() {
  try {
    saveDailyResults(dailyResults);
    saveDeclarations(declarations);
    saveStrategies(strategies);
    saveSelectedStrategyId(selectedStrategyId);
    saveSelectedInstrument(selectedInstrument);
    saveCurrentMode(currentMode);
  } catch (e) {
    console.error('[Tagverse] flush local storage failed', e);
  }
}

function formatDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatR(r) {
  if (r === 0) return '-';
  if (r < 0) return `${r}R`;
  return r === 1 ? '1R' : `+${r}R`;
}

function getWeekRange(year, month, weekNum) {
  const first = new Date(year, month, 1);
  const firstDay = first.getDay();
  let start = 1 - firstDay + (weekNum - 1) * 7;
  let end = start + 6;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  start = Math.max(1, start);
  end = Math.min(daysInMonth, end);
  return { start, end };
}

function isWeekday(date) {
  const d = date.getDay();
  return d >= 1 && d <= 5;
}

function getDayResult(dateKey, instrument) {
  const bucket = dailyResults[selectedStrategyId];
  if (!bucket) return null;
  const byDate = bucket[dateKey];
  if (!byDate) return null;
  if (isLegacyDailyEntry(byDate)) {
    const migrated = migrateDailyResults({ [dateKey]: byDate });
    if (!dailyResults[selectedStrategyId]) dailyResults[selectedStrategyId] = {};
    dailyResults[selectedStrategyId][dateKey] = migrated[dateKey];
    saveDailyResults(dailyResults);
    return dailyResults[selectedStrategyId][dateKey][instrument] || null;
  }
  return byDate[instrument] || null;
}

/** Total R for a single day for the selected strategy (all instruments). Used for monthly P/L. */
function getDayTotalRForStrategy(strategyId, dateKey) {
  const bucket = dailyResults[strategyId];
  if (!bucket || typeof bucket !== 'object') return 0;
  const byDate = bucket[dateKey];
  if (!byDate || typeof byDate !== 'object') return 0;
  if (isLegacyDailyEntry(byDate)) return typeof byDate.totalR === 'number' ? byDate.totalR : 0;
  let total = 0;
  for (const inst of Object.keys(byDate)) {
    const entry = byDate[inst];
    if (entry && typeof entry.totalR === 'number') total += entry.totalR;
  }
  return total;
}

function computeWeeklyPl(year, month, weekNum, instrument) {
  const inst = instrument ?? selectedInstrument;
  const { start, end } = getWeekRange(year, month, weekNum);
  let totalR = 0;
  for (let day = start; day <= end; day++) {
    const date = new Date(year, month, day);
    if (!isWeekday(date)) continue;
    const key = formatDateKey(date);
    const data = getDayResult(key, inst);
    if (data) totalR += data.totalR;
  }
  return { totalR };
}

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function getDeclaration(dateKey, instrument) {
  const bucket = declarations[selectedStrategyId];
  if (!bucket) return null;
  const byDate = bucket[dateKey];
  if (!byDate) return null;
  if (isLegacyDeclarationEntry(byDate)) {
    const migrated = migrateDeclarations({ [dateKey]: byDate });
    if (!declarations[selectedStrategyId]) declarations[selectedStrategyId] = {};
    declarations[selectedStrategyId][dateKey] = migrated[dateKey];
    saveDeclarations(declarations);
    return declarations[selectedStrategyId][dateKey][instrument] || null;
  }
  return byDate[instrument] || null;
}

function formatDeclarationTime(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

function setDeclaration(dateKey, instrument, tradeCountPlanned) {
  const inst = instrument ?? selectedInstrument;
  const createdAt = new Date().toISOString();
  if (!declarations[selectedStrategyId]) declarations[selectedStrategyId] = {};
  const bucket = declarations[selectedStrategyId];
  const existing = bucket[dateKey];
  const byInstrument = typeof existing === 'object' && existing !== null && !isLegacyDeclarationEntry(existing) ? { ...existing } : {};
  byInstrument[inst] = { tradeCountPlanned, createdAt };
  bucket[dateKey] = byInstrument;
  saveDeclarations(declarations);
  if (currentUser) {
    void persistDeclarationToSupabase(currentUser.id, selectedStrategyId, dateKey, inst, tradeCountPlanned, createdAt).then(({ error }) => {
      if (error) console.error('[Tagverse] Declaration not synced to cloud (saved locally).', error.message);
    });
  }
}

function setDayResult(dateKey, instrument, totalR, tradeCount) {
  const inst = instrument ?? selectedInstrument;
  const entry = { totalR, tradeCount };
  if (tradeCount === 1) entry.trade_1_r = totalR;
  if (!dailyResults[selectedStrategyId]) dailyResults[selectedStrategyId] = {};
  const bucket = dailyResults[selectedStrategyId];
  const existing = bucket[dateKey];
  const byInstrument = typeof existing === 'object' && existing !== null && !isLegacyDailyEntry(existing) ? { ...existing } : {};
  byInstrument[inst] = entry;
  bucket[dateKey] = byInstrument;
  saveDailyResults(dailyResults);
  if (currentUser) {
    void persistDayResultToSupabase(currentUser.id, selectedStrategyId, dateKey, inst, entry).then(({ error }) => {
      if (error) console.error('[Tagverse] Trade not synced to cloud (saved locally).', error.message);
    });
  }
}

function clearDayLog(dateKey, instrument) {
  const inst = instrument ?? selectedInstrument;
  const bucketDr = dailyResults[selectedStrategyId];
  if (bucketDr) {
    const byDate = bucketDr[dateKey];
    if (byDate && typeof byDate === 'object' && !isLegacyDailyEntry(byDate)) {
      delete byDate[inst];
      if (Object.keys(byDate).length === 0) delete bucketDr[dateKey];
      saveDailyResults(dailyResults);
      if (currentUser) deleteDayResultFromSupabase(currentUser.id, selectedStrategyId, dateKey, inst);
    } else if (byDate) {
      delete bucketDr[dateKey];
      saveDailyResults(dailyResults);
      if (currentUser) deleteDayResultFromSupabase(currentUser.id, selectedStrategyId, dateKey, inst);
    }
  }
  const bucketDc = declarations[selectedStrategyId];
  if (bucketDc) {
    const declByDate = bucketDc[dateKey];
    if (declByDate && typeof declByDate === 'object' && !isLegacyDeclarationEntry(declByDate)) {
      delete declByDate[inst];
      if (Object.keys(declByDate).length === 0) delete bucketDc[dateKey];
      saveDeclarations(declarations);
      if (currentUser) deleteDeclarationFromSupabase(currentUser.id, selectedStrategyId, dateKey, inst);
    } else if (declByDate) {
      delete bucketDc[dateKey];
      saveDeclarations(declarations);
      if (currentUser) deleteDeclarationFromSupabase(currentUser.id, selectedStrategyId, dateKey, inst);
    }
  }
}

function computeDisciplineStreak(instrument) {
  const inst = instrument ?? selectedInstrument;
  const todayKey = formatDateKey(new Date());
  let streak = 0;
  const check = new Date();
  for (let i = 0; i < 365; i++) {
    const key = formatDateKey(check);
    if (!isWeekday(check)) {
      check.setDate(check.getDate() - 1);
      continue;
    }
    const decl = getDeclaration(key, inst);
    const result = getDayResult(key, inst);
    const declared = decl && (decl.tradeCountPlanned === 1 || decl.tradeCountPlanned === 2);
    const logged = result && result.tradeCount >= 1 && result.tradeCount <= 2;
    if (declared && logged) streak++;
    else break;
    check.setDate(check.getDate() - 1);
  }
  return streak;
}

function computeDisciplineScore(instrument) {
  const inst = instrument ?? selectedInstrument;
  const now = new Date();
  let declared = 0;
  let compliant = 0;
  for (let i = 0; i < 30; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    if (!isWeekday(d)) continue;
    const key = formatDateKey(d);
    const decl = getDeclaration(key, inst);
    const result = getDayResult(key, inst);
    if (decl && (decl.tradeCountPlanned === 1 || decl.tradeCountPlanned === 2)) declared++;
    if (result && result.tradeCount >= 1 && result.tradeCount <= 2) compliant++;
  }
  if (declared === 0) return null;
  return Math.round((compliant / declared) * 100);
}

/** Build snapshot token + payload for share/community; updates localStorage tokens and lastShareToken / lastSharePayload. */
function buildSnapshotTokenForPeriod(periodVal) {
  const key = periodVal === 'week' || periodVal === 'today' ? periodVal : 'month';
  const results = getResultsInRange(key);
  const totalR = results.reduce((s, r) => s + r.totalR, 0);
  const streak = computeDisciplineStreak();
  const score = computeDisciplineScore();
  const payload = {
    period: periodVal,
    totalR,
    streak,
    score: score != null ? score : null,
    daysLogged: results.length,
    greenDays: results.filter((r) => r.totalR > 0).length
  };
  const token = btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
  let tokens = {};
  try {
    tokens = JSON.parse(localStorage.getItem(STORAGE_KEYS.shareTokens) || '{}');
  } catch (_) {}
  tokens[token] = { createdAt: Date.now(), payload };
  try {
    localStorage.setItem(STORAGE_KEYS.shareTokens, JSON.stringify(tokens));
  } catch (_) {}
  lastShareToken = token;
  lastSharePayload = payload;
  return { token, payload };
}

function updateAuthUI() {
  const statusEl = document.getElementById('authStatus');
  const loginButton = document.getElementById('loginButton');
  const logoutButton = document.getElementById('logoutButton');
  const accountMeta = document.getElementById('settingsAccountMeta');
  if (!statusEl || !loginButton || !logoutButton) {
    syncHeaderBio();
    return;
  }
  if (currentUser) {
    const email = currentUser.email || '';
    const uname = currentProfile && currentProfile.username ? String(currentProfile.username).trim() : '';
    if (uname) {
      statusEl.textContent = 'Welcome ' + uname;
    } else {
      statusEl.textContent = email ? 'Welcome — ' + email : 'Welcome';
    }
    loginButton.hidden = true;
    logoutButton.hidden = false;
    if (accountMeta) {
      if (uname) {
        accountMeta.textContent = 'Signed in as ' + email + '. Your handle is @' + uname + '. Your data is synced to the cloud.';
      } else {
        accountMeta.textContent =
          'Signed in as ' + email + '. Choose a unique username below — it can’t be used by anyone else. Your data is synced to the cloud.';
      }
    }
  } else {
    statusEl.textContent = 'Not signed in';
    loginButton.hidden = false;
    logoutButton.hidden = true;
    if (accountMeta) accountMeta.textContent = 'Sign in with email to sync your data.';
  }
  syncHeaderBio();
}

/** Max length for bio in Settings (stored in Supabase). */
const SETTINGS_BIO_MAX_LENGTH = 120;
/** Max characters shown in the header before ellipsis + tooltip with full text. */
const HEADER_BIO_DISPLAY_MAX = 90;

function formatHeaderBioSnippet(bio) {
  const s = String(bio || '').trim();
  if (!s) return '';
  if (s.length <= HEADER_BIO_DISPLAY_MAX) return s;
  return s.slice(0, HEADER_BIO_DISPLAY_MAX).trimEnd() + '…';
}

/** Header: show profile bio under “Welcome …” when signed in and bio is non-empty. */
function syncHeaderBio() {
  const el = document.getElementById('authHeaderBio');
  if (!el) return;
  if (!currentUser) {
    el.hidden = true;
    el.textContent = '';
    el.removeAttribute('title');
    return;
  }
  const bio = currentProfile && currentProfile.bio != null ? String(currentProfile.bio).trim() : '';
  if (!bio) {
    el.hidden = true;
    el.textContent = '';
    el.removeAttribute('title');
    return;
  }
  el.hidden = false;
  const display = formatHeaderBioSnippet(bio);
  el.textContent = display;
  if (display.endsWith('…')) {
    el.title = bio;
  } else {
    el.removeAttribute('title');
  }
}

function showScreen(screenId) {
  document.querySelectorAll('.screen').forEach((el) => {
    const isTarget = el.id === 'screen-' + screenId;
    el.classList.toggle('active', isTarget);
    el.hidden = !isTarget;
  });
  document.querySelectorAll('.nav-tab').forEach((tab) => {
    const isActive = tab.dataset.screen === screenId;
    tab.classList.toggle('active', isActive);
    tab.setAttribute('aria-current', isActive ? 'page' : null);
  });
  if (screenId === 'calendar') renderCalendar();
  if (screenId === 'analytics' && typeof window.renderAnalytics === 'function') window.renderAnalytics();
  if (screenId === 'community' && typeof window.renderCommunityFeed === 'function') window.renderCommunityFeed();
}

function renderCalendar() {
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDay = new Date(year, month, 1).getDay();

  document.getElementById('monthYear').textContent =
    currentDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });

  // Compute monthly P/L from selected strategy: sum all instruments for each weekday (uses strategy bucket directly)
  let monthlyTotalR = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(year, month, d);
    if (!isWeekday(date)) continue;
    monthlyTotalR += getDayTotalRForStrategy(selectedStrategyId, formatDateKey(date));
  }

  const grid = document.getElementById('calendarGrid');
  if (!grid) return;
  grid.innerHTML =
    '<div class="day-header">Su</div><div class="day-header">Mo</div><div class="day-header">Tu</div><div class="day-header">We</div><div class="day-header">Th</div><div class="day-header">Fr</div><div class="day-header">Sa</div>';

  const totalCells = firstDay + daysInMonth;
  const rows = Math.ceil(totalCells / 7);

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < 6; col++) {
      const cellIndex = row * 7 + col;
      const dayNum = cellIndex - firstDay + 1;
      const isEmpty = dayNum < 1 || dayNum > daysInMonth;
      const cell = document.createElement('div');
      cell.className = 'calendar-cell';
      if (isEmpty) {
        cell.classList.add('empty');
        if (dayNum > daysInMonth) {
          const nextMonthDay = dayNum - daysInMonth;
          cell.innerHTML = `<span class="date-num">${nextMonthDay}</span>`;
        } else {
          cell.innerHTML = '<span class="date-num"></span>';
        }
      } else {
        const date = new Date(year, month, dayNum);
        const key = formatDateKey(date);
        const weekday = isWeekday(date);
        const data = weekday ? getDayResult(key, selectedInstrument) : null;
        const selected = isSameDay(date, selectedDate);
        if (selected) cell.classList.add('selected');
        if (!weekday) cell.classList.add('weekend');
        if (data) {
          cell.classList.add(data.totalR >= 0 ? 'profit' : 'loss');
          cell.innerHTML = `
            <span class="date-num">${dayNum}</span>
            <span class="pl-amount">${formatR(data.totalR)}</span>
          `;
        } else {
          cell.innerHTML = `<span class="date-num">${dayNum}</span>`;
        }
        cell.dataset.date = key;
        cell.addEventListener('click', () => {
          selectedDate = new Date(date);
          if (weekday) openLogModal(date);
          else renderCalendar();
        });
      }
      grid.appendChild(cell);
    }

    const weekNum = row + 1;
    const weekData = computeWeeklyPl(year, month, weekNum, selectedInstrument);
    const weekCell = document.createElement('div');
    weekCell.className = 'week-cell';
    if (weekData.totalR !== 0) {
      weekCell.classList.add(weekData.totalR > 0 ? 'profit' : 'loss');
      weekCell.innerHTML = `
        <span class="week-label">Week ${weekNum}</span>
        <span class="pl-amount">${formatR(weekData.totalR)}</span>
      `;
    } else {
      weekCell.classList.add('empty-week');
      weekCell.innerHTML = `
        <span class="week-label">Week ${weekNum}</span>
        <span class="pl-amount">-</span>
      `;
    }
    grid.appendChild(weekCell);
  }

  const monthlyEl = document.getElementById('monthlyPlValue');
  if (monthlyEl) {
    monthlyEl.textContent = formatR(monthlyTotalR);
    monthlyEl.className = 'pl-value ' + (monthlyTotalR === 0 ? 'neutral' : monthlyTotalR > 0 ? 'profit' : 'loss');
  }
}

function selectDate(date) {
  selectedDate = new Date(date);
  renderCalendar();
}

function prevMonth() {
  currentDate.setMonth(currentDate.getMonth() - 1);
  renderCalendar();
}

function nextMonth() {
  currentDate.setMonth(currentDate.getMonth() + 1);
  renderCalendar();
}

function goToday() {
  const now = new Date();
  currentDate = new Date(now.getFullYear(), now.getMonth(), 1);
  selectedDate = new Date(now);
  renderCalendar();
}

function isPastDate(date) {
  const d = new Date(date);
  const t = new Date();
  d.setHours(0, 0, 0, 0);
  t.setHours(0, 0, 0, 0);
  return d.getTime() < t.getTime();
}

function openLogModal(date) {
  logModalTargetDate = new Date(date);
  const key = formatDateKey(logModalTargetDate);
  const modal = document.getElementById('logModal');
  const title = document.getElementById('logModalTitle');
  const outcomeSection = document.getElementById('logModalOutcome');
  const comparisonLine = document.getElementById('logModalComparison');
  const past = isPastDate(logModalTargetDate);
  title.textContent = logModalTargetDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const instrumentLabel = document.getElementById('logModalInstrument');
  if (instrumentLabel) instrumentLabel.textContent = 'Logging for ' + selectedInstrument;
  if (outcomeSection) outcomeSection.hidden = false;
  comparisonLine.hidden = true;
  comparisonLine.textContent = '';
  modal.hidden = false;
}

function closeLogModal() {
  if (window._logModalCloseTimeout) {
    clearTimeout(window._logModalCloseTimeout);
    window._logModalCloseTimeout = null;
  }
  document.getElementById('logModal').hidden = true;
  logModalTargetDate = null;
  renderCalendar();
}

function saveDeclarationFromModal(tradeCountPlanned) {
  if (!logModalTargetDate) return;
  const key = formatDateKey(logModalTargetDate);
  setDeclaration(key, selectedInstrument, tradeCountPlanned);
  renderCalendar();
}

function saveOutcomeFromModal(r) {
  if (!logModalTargetDate) return;
  const key = formatDateKey(logModalTargetDate);
  const totalR = Number(r);
  const tradeCount = totalR === 2 || totalR === -2 ? (totalR === 2 ? 1 : 2) : (totalR === 1 ? 2 : 1);
  setDayResult(key, selectedInstrument, totalR, tradeCount);
  const comparisonEl = document.getElementById('logModalComparison');
  if (comparisonEl) {
    comparisonEl.hidden = false;
    comparisonEl.textContent = 'Logged ' + tradeCount + ' trade' + (tradeCount === 1 ? '' : 's') + '.';
    comparisonEl.classList.remove('comparison-mismatch');
    window._logModalCloseTimeout = setTimeout(closeLogModal, 1800);
  } else {
    closeLogModal();
  }
}

document.addEventListener('DOMContentLoaded', () => {
  currentMode = loadCurrentMode();

  async function applyAuthState() {
    if (currentUser) {
      // Cloud-first: Supabase is source of truth; remote wins on conflicts.
      // Local-only rows (e.g. another device not yet synced) are merged in and uploaded.
      const localResults = loadDailyResults();
      const localDeclarations = loadDeclarations();
      const remoteResults = await fetchDailyResultsFromSupabase(currentUser.id);
      const remoteDeclarations = await fetchDeclarationsFromSupabase(currentUser.id);
      dailyResults = await mergeDailyResultsCloudFirst(remoteResults, localResults, currentUser.id);
      declarations = await mergeDeclarationsCloudFirst(remoteDeclarations, localDeclarations, currentUser.id);
      saveDailyResults(dailyResults);
      saveDeclarations(declarations);

      const remoteStrategies = await fetchStrategiesFromSupabase(currentUser.id);
      const remoteList = Array.isArray(remoteStrategies) ? remoteStrategies : [];
      currentProfile = await fetchCurrentProfile(currentUser.id);
      const localStrategies = loadStrategies();
      const localDefault = localStrategies.find((s) => s.id === STRATEGY_DEFAULT_ID);
      const defaultName =
        (currentProfile?.default_strategy_name && String(currentProfile.default_strategy_name).trim()) ||
        (currentUser?.user_metadata?.default_strategy_name && String(currentUser.user_metadata.default_strategy_name).trim()) ||
        localDefault?.name ||
        'Default';

      if (remoteList.length > 0) {
        const hasDefaultRemote = remoteList.some((s) => s.id === STRATEGY_DEFAULT_ID || s.name === 'Default');
        const base = hasDefaultRemote ? remoteList : [{ id: STRATEGY_DEFAULT_ID, name: defaultName }, ...remoteList];
        const remoteIds = new Set(base.map((s) => s.id));
        strategies = base.map((s) => {
          if (s.id === STRATEGY_DEFAULT_ID) return { ...s, name: defaultName };
          return { ...s };
        });
        for (const ls of localStrategies) {
          if (!remoteIds.has(ls.id)) strategies.push(ls);
        }
      } else {
        strategies = localStrategies.length
          ? localStrategies.map((s) => (s.id === STRATEGY_DEFAULT_ID ? { ...s, name: defaultName } : s))
          : [{ id: STRATEGY_DEFAULT_ID, name: defaultName }];
      }

      saveStrategies(strategies);

      const supaSync = initSupabase();
      if (supaSync && currentUser) {
        const seedIds = new Set(remoteList.map((r) => r.id));
        for (const s of strategies) {
          if (s.id === STRATEGY_DEFAULT_ID || !/^[0-9a-f-]{36}$/i.test(s.id)) continue;
          if (!seedIds.has(s.id)) {
            const { error } = await supaSync.from('strategies').upsert(
              { id: s.id, user_id: currentUser.id, name: s.name },
              { onConflict: 'id' }
            );
            if (error) console.error('[Tagverse] sync local-only strategy', s.id, error.message);
          }
        }
      }
    } else {
      dailyResults = loadDailyResults();
      declarations = loadDeclarations();
      strategies = loadStrategies();
      currentProfile = null;
    }
    selectedStrategyId = loadSelectedStrategyId();
    if (!strategies.some((s) => s.id === selectedStrategyId)) selectedStrategyId = strategies[0]?.id || STRATEGY_DEFAULT_ID;
    saveSelectedStrategyId(selectedStrategyId);
    updateAuthUI();
    hydrateProfileSettings();
    if (typeof window.renderStrategyPills === 'function') window.renderStrategyPills();
    renderCalendar();
    if (typeof window.renderAnalytics === 'function') window.renderAnalytics();
  }

  window.__tagverseRefreshFromCloud = () => applyAuthState();

  /**
   * Offline UI uses navigator.onLine only. (A previous Supabase /auth/v1/health probe caused
   * false positives — banner stuck on — when fetch failed for CORS/adblock/timing reasons.)
   */
  function refreshOfflineBanner() {
    const banner = document.getElementById('offlineBanner');
    if (!banner) return;
    const navOnline = typeof navigator === 'undefined' || navigator.onLine;
    if (!navOnline) {
      banner.hidden = false;
      document.body.classList.add('has-offline-banner');
    } else {
      banner.hidden = true;
      document.body.classList.remove('has-offline-banner');
    }
  }

  window.addEventListener('online', () => {
    refreshOfflineBanner();
    if (currentUser) applyAuthState();
  });
  window.addEventListener('offline', refreshOfflineBanner);

  window.setInterval(() => {
    if (document.visibilityState === 'visible') refreshOfflineBanner();
  }, 3000);

  const offlineSaveBtn = document.getElementById('offlineSaveBtn');
  if (offlineSaveBtn) {
    offlineSaveBtn.addEventListener('click', () => {
      flushAllLocalDataToStorage();
      const old = offlineSaveBtn.textContent;
      offlineSaveBtn.textContent = 'Saved on this device';
      offlineSaveBtn.disabled = true;
      window.setTimeout(() => {
        offlineSaveBtn.textContent = old;
        offlineSaveBtn.disabled = false;
      }, 2800);
    });
  }

  refreshOfflineBanner();

  const supa = initSupabase();
  if (supa) {
    supa.auth.getSession().then(({ data }) => {
      currentUser = data.session ? data.session.user : null;
      applyAuthState();
    });
    supa.auth.onAuthStateChange((_event, session) => {
      currentUser = session ? session.user : null;
      applyAuthState();
    });
  }

  let lastCloudRefreshAt = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshOfflineBanner();
    if (document.visibilityState !== 'visible' || !currentUser) return;
    const now = Date.now();
    if (now - lastCloudRefreshAt < 4000) return;
    lastCloudRefreshAt = now;
    applyAuthState();
  });
  window.addEventListener('pageshow', (e) => {
    if (e.persisted && currentUser) applyAuthState();
  });

  document.querySelectorAll('.nav-tab').forEach((tab) => {
    tab.addEventListener('click', () => showScreen(tab.dataset.screen));
  });

  let pendingDeleteStrategyId = null;
  let pendingRenameStrategyId = null;

  function openDeleteStrategyModal(id, name) {
    pendingDeleteStrategyId = id;
    const msg = document.getElementById('deleteStrategyModalMessage');
    if (msg) msg.textContent = `If you delete "${name}", you will lose all its data (results and declarations). This cannot be undone.`;
    const modal = document.getElementById('deleteStrategyModal');
    if (modal) modal.hidden = false;
  }

  function closeDeleteStrategyModal() {
    pendingDeleteStrategyId = null;
    const modal = document.getElementById('deleteStrategyModal');
    if (modal) modal.hidden = true;
  }

  function openRenameStrategyModal(id, name) {
    pendingRenameStrategyId = id;
    const modal = document.getElementById('renameStrategyModal');
    const subtitle = document.getElementById('renameStrategySubtitle');
    const input = document.getElementById('renameStrategyInput');
    if (subtitle) subtitle.textContent = name;
    if (input) {
      input.value = name;
      input.focus();
      input.select();
    }
    if (modal) modal.hidden = false;
  }

  function closeRenameStrategyModal() {
    pendingRenameStrategyId = null;
    const modal = document.getElementById('renameStrategyModal');
    if (modal) modal.hidden = true;
  }

  function renderStrategyPills() {
    strategies = loadStrategies();
    const container = document.getElementById('strategyPills');
    if (!container) return;
    container.innerHTML = '';
    strategies.forEach((s) => {
      const wrap = document.createElement('div');
      wrap.className = 'strategy-pill-wrap';

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'strategy-pill' + (s.id === selectedStrategyId ? ' selected' : '');
      btn.textContent = s.name;
      btn.dataset.strategyId = s.id;
      btn.setAttribute('aria-pressed', s.id === selectedStrategyId ? 'true' : 'false');
      btn.addEventListener('click', () => {
        selectedStrategyId = s.id;
        saveSelectedStrategyId(selectedStrategyId);
        container.querySelectorAll('.strategy-pill').forEach((p) => {
          p.classList.toggle('selected', p.dataset.strategyId === selectedStrategyId);
          p.setAttribute('aria-pressed', p.dataset.strategyId === selectedStrategyId ? 'true' : 'false');
        });
        renderCalendar();
        if (typeof window.renderAnalytics === 'function') window.renderAnalytics();
        if (typeof window.renderCompareStrategies === 'function') window.renderCompareStrategies();
      });
      wrap.appendChild(btn);

      const renameBtn = document.createElement('button');
      renameBtn.type = 'button';
      renameBtn.className = 'strategy-pill-rename';
      renameBtn.setAttribute('aria-label', 'Rename strategy ' + s.name);
      renameBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openRenameStrategyModal(s.id, s.name);
      });
      wrap.appendChild(renameBtn);

      if (s.id !== STRATEGY_DEFAULT_ID) {
        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'strategy-pill-remove';
        removeBtn.setAttribute('aria-label', 'Delete strategy ' + s.name);
        removeBtn.textContent = '×';
        removeBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          openDeleteStrategyModal(s.id, s.name);
        });
        wrap.appendChild(removeBtn);
      }

      container.appendChild(wrap);
    });
  }
  window.renderStrategyPills = renderStrategyPills;

  document.getElementById('deleteStrategyModalBackdrop')?.addEventListener('click', closeDeleteStrategyModal);
  document.getElementById('deleteStrategyModalNo')?.addEventListener('click', closeDeleteStrategyModal);
  document.getElementById('deleteStrategyModalYes')?.addEventListener('click', () => {
    if (pendingDeleteStrategyId) {
      deleteStrategy(pendingDeleteStrategyId);
      closeDeleteStrategyModal();
    }
  });

  document.getElementById('renameStrategyModalBackdrop')?.addEventListener('click', closeRenameStrategyModal);
  document.getElementById('renameStrategyCancel')?.addEventListener('click', closeRenameStrategyModal);
  document.getElementById('renameStrategySave')?.addEventListener('click', () => {
    if (!pendingRenameStrategyId) return;
    const input = document.getElementById('renameStrategyInput');
    if (!input) return;
    const value = input.value.trim();
    if (!value) return;
    renameStrategy(pendingRenameStrategyId, value);
    closeRenameStrategyModal();
  });

  document.getElementById('addStrategyBtn')?.addEventListener('click', () => {
    const name = prompt('Strategy name', '');
    if (name == null || !name.trim()) return;
    const id = createStrategy(name.trim());
    if (currentUser && id !== STRATEGY_DEFAULT_ID && /^[0-9a-f-]{36}$/i.test(id)) insertStrategyToSupabase(currentUser.id, id, name.trim());
    strategies = loadStrategies();
    selectedStrategyId = id;
    saveSelectedStrategyId(id);
    renderStrategyPills();
    renderCalendar();
    if (typeof window.renderAnalytics === 'function') window.renderAnalytics();
    if (typeof window.renderCompareStrategies === 'function') window.renderCompareStrategies();
  });

  const loginButton = document.getElementById('loginButton');
  const logoutButton = document.getElementById('logoutButton');
  const authModal = document.getElementById('authModal');
  const authModalBackdrop = document.getElementById('authModalBackdrop');
  const authEmail = document.getElementById('authEmail');
  const authPassword = document.getElementById('authPassword');
  const authPasswordToggle = document.getElementById('authPasswordToggle');
  const authPasswordConfirm = document.getElementById('authPasswordConfirm');
  const authPasswordConfirmToggle = document.getElementById('authPasswordConfirmToggle');
  const authPasswordConfirmWrap = document.getElementById('authPasswordConfirmWrap');
  const authModalMessage = document.getElementById('authModalMessage');
  const authModalTitle = document.getElementById('authModalTitle');
  const authModalSubtitle = document.getElementById('authModalSubtitle');
  const authModalSubmit = document.getElementById('authModalSubmit');
  const authModalCancel = document.getElementById('authModalCancel');
  const authModalSwitchMode = document.getElementById('authModalSwitchMode');
  const settingsUsernameInput = document.getElementById('settingsUsername');
  const settingsBioInput = document.getElementById('settingsBio');
  const settingsSaveProfileBtn = document.getElementById('settingsSaveProfile');
  const settingsProfileMessage = document.getElementById('settingsProfileMessage');
  const settingsCurrentPassword = document.getElementById('settingsCurrentPassword');
  const settingsNewPassword = document.getElementById('settingsNewPassword');
  const settingsConfirmPassword = document.getElementById('settingsConfirmPassword');
  const settingsChangePasswordBtn = document.getElementById('settingsChangePassword');
  const settingsPasswordMessage = document.getElementById('settingsPasswordMessage');

  if (loginButton) loginButton.textContent = 'Sign in with email';

  let authModalMode = 'signin';

  function syncPasswordToggleUi(input, button) {
    if (!input || !button) return;
    const eye = button.querySelector('.auth-password-icon-eye');
    const eyeOff = button.querySelector('.auth-password-icon-eye-off');
    const visible = input.type === 'text';
    button.setAttribute('aria-pressed', visible ? 'true' : 'false');
    button.setAttribute('aria-label', visible ? 'Hide password' : 'Show password');
    if (eye) eye.hidden = visible;
    if (eyeOff) eyeOff.hidden = !visible;
  }

  function wireAuthPasswordToggle(input, button) {
    if (!input || !button) return;
    button.addEventListener('click', (e) => {
      e.preventDefault();
      input.type = input.type === 'password' ? 'text' : 'password';
      syncPasswordToggleUi(input, button);
    });
  }

  function resetAuthPasswordToggles() {
    if (authPassword) authPassword.type = 'password';
    if (authPasswordConfirm) authPasswordConfirm.type = 'password';
    syncPasswordToggleUi(authPassword, authPasswordToggle);
    syncPasswordToggleUi(authPasswordConfirm, authPasswordConfirmToggle);
  }

  wireAuthPasswordToggle(authPassword, authPasswordToggle);
  wireAuthPasswordToggle(authPasswordConfirm, authPasswordConfirmToggle);

  function setAuthModalMode(mode) {
    authModalMode = mode;
    if (authModalTitle) authModalTitle.textContent = mode === 'signup' ? 'Sign up' : 'Sign in';
    if (authModalSubtitle) authModalSubtitle.textContent = mode === 'signup' ? 'Create an account with your email and a password.' : 'Enter your email and password.';
    if (authModalSubmit) authModalSubmit.textContent = mode === 'signup' ? 'Sign up' : 'Sign in';
    if (authModalSwitchMode) authModalSwitchMode.textContent = mode === 'signup' ? 'Already have an account? Sign in' : 'Create an account';
    if (authPasswordConfirmWrap) authPasswordConfirmWrap.hidden = mode !== 'signup';
    if (authPassword) authPassword.placeholder = mode === 'signup' ? 'Min 6 characters' : '••••••••';
    if (authPassword) authPassword.autocomplete = mode === 'signup' ? 'new-password' : 'current-password';
  }

  function openAuthModal() {
    const supaClient = initSupabase();
    if (!supaClient) {
      alert('Supabase anon key is missing. In index.html set window.SUPABASE_ANON_KEY to your key from Supabase Dashboard → Settings → API → anon public, then redeploy.');
      return;
    }
    if (authModal) {
      authModal.hidden = false;
      authModalMode = 'signin';
      setAuthModalMode('signin');
      if (authEmail) authEmail.value = '';
      if (authPassword) authPassword.value = '';
      if (authPasswordConfirm) authPasswordConfirm.value = '';
      resetAuthPasswordToggles();
      if (authModalMessage) { authModalMessage.hidden = true; authModalMessage.textContent = ''; }
      authEmail?.focus();
    }
  }

  function closeAuthModal() {
    if (authModal) authModal.hidden = true;
    if (authPassword) authPassword.value = '';
    if (authPasswordConfirm) authPasswordConfirm.value = '';
    resetAuthPasswordToggles();
  }

  if (loginButton) loginButton.addEventListener('click', openAuthModal);
  if (authModalBackdrop) authModalBackdrop.addEventListener('click', closeAuthModal);
  if (authModalCancel) authModalCancel.addEventListener('click', closeAuthModal);

  if (authModalSwitchMode) {
    authModalSwitchMode.addEventListener('click', () => {
      const next = authModalMode === 'signin' ? 'signup' : 'signin';
      setAuthModalMode(next);
      if (authModalMessage) { authModalMessage.hidden = true; authModalMessage.textContent = ''; }
    });
  }

  function onAuthModalKeydown(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      authModalSubmit?.click();
    }
  }
  authEmail?.addEventListener('keydown', onAuthModalKeydown);
  authPassword?.addEventListener('keydown', onAuthModalKeydown);
  authPasswordConfirm?.addEventListener('keydown', onAuthModalKeydown);

  if (authModalSubmit) {
    authModalSubmit.addEventListener('click', async () => {
      const email = authEmail?.value?.trim();
      const password = authPassword?.value ?? '';
      if (!email) {
        if (authModalMessage) { authModalMessage.textContent = 'Please enter your email.'; authModalMessage.hidden = false; }
        return;
      }
      if (!password) {
        if (authModalMessage) { authModalMessage.textContent = 'Please enter your password.'; authModalMessage.hidden = false; }
        return;
      }
      if (authModalMode === 'signup') {
        const confirmVal = authPasswordConfirm?.value ?? '';
        if (password !== confirmVal) {
          if (authModalMessage) { authModalMessage.textContent = 'Passwords do not match.'; authModalMessage.hidden = false; }
          return;
        }
        if (password.length < 6) {
          if (authModalMessage) { authModalMessage.textContent = 'Password must be at least 6 characters.'; authModalMessage.hidden = false; }
          return;
        }
      }
      const supaClient = initSupabase();
      if (!supaClient) return;
      authModalSubmit.disabled = true;
      if (authModalMessage) { authModalMessage.hidden = true; authModalMessage.textContent = ''; }

      if (authModalMode === 'signin') {
        const { error } = await supaClient.auth.signInWithPassword({ email, password });
        authModalSubmit.disabled = false;
        if (error) {
          if (authModalMessage) { authModalMessage.textContent = error.message; authModalMessage.hidden = false; }
          return;
        }
        closeAuthModal();
        return;
      }

      const { data, error } = await supaClient.auth.signUp({ email, password });
      authModalSubmit.disabled = false;
      if (error) {
        if (authModalMessage) { authModalMessage.textContent = error.message; authModalMessage.hidden = false; }
        return;
      }
      if (data.session) {
        closeAuthModal();
        return;
      }
      if (authModalMessage) {
        authModalMessage.textContent = 'Account created. Sign in below with your email and password.';
        authModalMessage.hidden = false;
      }
      setAuthModalMode('signin');
      if (authPassword) authPassword.value = '';
      if (authPasswordConfirm) authPasswordConfirm.value = '';
      authPassword?.focus();
    });
  }

  if (logoutButton) {
    logoutButton.addEventListener('click', async () => {
      const supaClient = initSupabase();
      if (!supaClient) return;
      await supaClient.auth.signOut();
    });
  }

  if (settingsSaveProfileBtn) {
    settingsSaveProfileBtn.addEventListener('click', async () => {
      if (!currentUser) {
        if (settingsProfileMessage) settingsProfileMessage.textContent = 'Sign in to save your profile.';
        return;
      }
      const usernameRaw = (settingsUsernameInput?.value || '').trim();
      const username = normalizeUsername(usernameRaw);
      let bio = (settingsBioInput?.value || '').trim();
      if (bio.length > SETTINGS_BIO_MAX_LENGTH) bio = bio.slice(0, SETTINGS_BIO_MAX_LENGTH);
      if (settingsBioInput) settingsBioInput.value = bio;
      if (!username) {
        if (settingsProfileMessage) settingsProfileMessage.textContent = 'Username cannot be empty.';
        return;
      }
      if (await isUsernameTakenByOther(currentUser.id, username)) {
        if (settingsProfileMessage) settingsProfileMessage.textContent = 'This username is already taken.';
        return;
      }
      settingsSaveProfileBtn.disabled = true;
      if (settingsProfileMessage) settingsProfileMessage.textContent = '';
      if (settingsUsernameInput) settingsUsernameInput.value = username;
      const profilePayload = { username, bio: bio || null };
      if (currentProfile?.default_strategy_name != null && currentProfile.default_strategy_name !== '') {
        profilePayload.default_strategy_name = currentProfile.default_strategy_name;
      }
      const { error } = await upsertProfile(currentUser.id, profilePayload);
      settingsSaveProfileBtn.disabled = false;
      if (error) {
        settingsProfileMessage.textContent = formatPostgrestError(error) || error.message || 'Could not save profile.';
        return;
      }
      if (settingsProfileMessage) settingsProfileMessage.textContent = 'Profile updated.';
      updateAuthUI();
      updateSettingsAvatarPreview();
      syncSettingsBioCharCount();
    });
  }

  if (settingsChangePasswordBtn) {
    settingsChangePasswordBtn.addEventListener('click', async () => {
      if (!currentUser) {
        if (settingsPasswordMessage) settingsPasswordMessage.textContent = 'Sign in to change your password.';
        return;
      }
      const current = settingsCurrentPassword?.value || '';
      const next = settingsNewPassword?.value || '';
      const confirm = settingsConfirmPassword?.value || '';
      if (!current || !next || !confirm) {
        if (settingsPasswordMessage) settingsPasswordMessage.textContent = 'Fill in all password fields.';
        return;
      }
      if (next !== confirm) {
        if (settingsPasswordMessage) settingsPasswordMessage.textContent = 'New passwords do not match.';
        return;
      }
      if (next.length < 6) {
        if (settingsPasswordMessage) settingsPasswordMessage.textContent = 'New password must be at least 6 characters.';
        return;
      }
      const supaClient = initSupabase();
      if (!supaClient) return;
      settingsChangePasswordBtn.disabled = true;
      if (settingsPasswordMessage) settingsPasswordMessage.textContent = '';
      const { data: signInData, error: signInError } = await supaClient.auth.signInWithPassword({
        email: currentUser.email,
        password: current
      });
      if (signInError || !signInData.session) {
        settingsChangePasswordBtn.disabled = false;
        if (settingsPasswordMessage) settingsPasswordMessage.textContent = 'Current password is incorrect.';
        return;
      }
      const { error } = await supaClient.auth.updateUser({ password: next });
      settingsChangePasswordBtn.disabled = false;
      if (error) {
        if (settingsPasswordMessage) settingsPasswordMessage.textContent = error.message || 'Could not change password.';
        return;
      }
      if (settingsPasswordMessage) settingsPasswordMessage.textContent = 'Password changed.';
      if (settingsCurrentPassword) settingsCurrentPassword.value = '';
      if (settingsNewPassword) settingsNewPassword.value = '';
      if (settingsConfirmPassword) settingsConfirmPassword.value = '';
    });
  }

  function syncSettingsBioCharCount() {
    const countEl = document.getElementById('settingsBioCount');
    if (!countEl || !settingsBioInput) return;
    countEl.textContent = String((settingsBioInput.value || '').length);
  }

  function hydrateProfileSettings() {
    if (!settingsUsernameInput || !settingsBioInput) return;
    if (!currentUser) {
      settingsUsernameInput.value = '';
      settingsBioInput.value = '';
      if (settingsProfileMessage) settingsProfileMessage.textContent = 'Sign in to edit your profile.';
      updateSettingsAvatarPreview();
      syncSettingsBioCharCount();
      return;
    }
    settingsUsernameInput.value = currentProfile?.username || '';
    let bioVal = currentProfile?.bio != null ? String(currentProfile.bio) : '';
    if (bioVal.length > SETTINGS_BIO_MAX_LENGTH) bioVal = bioVal.slice(0, SETTINGS_BIO_MAX_LENGTH);
    settingsBioInput.value = bioVal;
    if (settingsProfileMessage) settingsProfileMessage.textContent = '';
    updateSettingsAvatarPreview();
    syncSettingsBioCharCount();
  }

  settingsUsernameInput?.addEventListener('input', () => updateSettingsAvatarPreview());
  settingsBioInput?.addEventListener('input', syncSettingsBioCharCount);

  document.querySelectorAll('.settings-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.settingsTab;
      if (!target) return;
      document.querySelectorAll('.settings-tab').forEach((t) => {
        const on = t.dataset.settingsTab === target;
        t.classList.toggle('active', on);
        t.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      document.querySelectorAll('.settings-panel').forEach((panel) => {
        const show = panel.dataset.settingsPanel === target;
        panel.hidden = !show;
        panel.classList.toggle('is-active', show);
      });
    });
  });

  document.querySelectorAll('.instrument-pill').forEach((pill) => {
    pill.addEventListener('click', () => {
      const inst = pill.dataset.instrument;
      if (!INSTRUMENTS.includes(inst)) return;
      selectedInstrument = inst;
      saveSelectedInstrument(selectedInstrument);
      renderCalendar();
      if (typeof window.renderAnalytics === 'function') window.renderAnalytics();
    });
  });

  document.getElementById('logTodayBtn')?.addEventListener('click', () => {
    const today = new Date();
    selectedDate = new Date(today);
    if (isWeekday(today)) openLogModal(today);
  });

  document.getElementById('logModal')?.querySelector('.log-modal-backdrop')?.addEventListener('click', closeLogModal);
  document.getElementById('logModalCancel')?.addEventListener('click', closeLogModal);
  document.getElementById('logModalClear')?.addEventListener('click', () => {
    if (logModalTargetDate) {
      clearDayLog(formatDateKey(logModalTargetDate), selectedInstrument);
      closeLogModal();
    }
  });

  const declareOpts = document.querySelectorAll('#logModalDeclare .log-option[data-value]');
  declareOpts.forEach((btn) => {
    btn.addEventListener('click', () => saveDeclarationFromModal(Number(btn.dataset.value)));
  });
  const outcomeOpts = document.querySelectorAll('.r-option[data-r]');
  outcomeOpts.forEach((btn) => {
    btn.addEventListener('click', () => saveOutcomeFromModal(btn.dataset.r));
  });

  document.getElementById('prevMonth')?.addEventListener('click', prevMonth);
  document.getElementById('nextMonth')?.addEventListener('click', nextMonth);
  document.getElementById('todayBtn')?.addEventListener('click', goToday);

  const monthYear = document.getElementById('monthYear');
  if (monthYear) {
    monthYear.addEventListener('click', (e) => {
      e.stopPropagation();
      if (document.getElementById('monthPicker').hidden) openMonthPicker();
      else closeMonthPicker();
    });
    monthYear.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (document.getElementById('monthPicker').hidden) openMonthPicker();
        else closeMonthPicker();
      }
    });
  }
  document.getElementById('monthPickerToday')?.addEventListener('click', (e) => {
    e.stopPropagation();
    goToday();
    closeMonthPicker();
  });

  function getMonthPickerEl() {
    return document.getElementById('monthPicker');
  }
  function onCloseMonthPicker(e) {
    const el = getMonthPickerEl();
    const trigger = document.getElementById('monthYear');
    if (e.type === 'keydown' && e.key === 'Escape') {
      if (el) el.hidden = true;
      document.removeEventListener('keydown', onCloseMonthPicker);
      return;
    }
    if (e.type === 'click' && el && trigger && !el.contains(e.target) && !trigger.contains(e.target)) {
      el.hidden = true;
      document.removeEventListener('click', onCloseMonthPicker);
    }
  }
  function openMonthPicker() {
    const el = getMonthPickerEl();
    if (!el) return;
    el.hidden = false;
    renderMonthPickerContent();
    document.addEventListener('click', onCloseMonthPicker);
    document.addEventListener('keydown', onCloseMonthPicker);
  }
  function closeMonthPicker() {
    const el = getMonthPickerEl();
    if (el) el.hidden = true;
  }
  window.closeMonthPicker = closeMonthPicker;

  function renderMonthPickerContent() {
    const currentYear = currentDate.getFullYear();
    const currentMonth = currentDate.getMonth();
    const yearStart = currentYear - 4;
    const yearEnd = currentYear + 4;
    document.getElementById('monthPickerTitle').textContent =
      currentDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    const bodyEl = document.getElementById('monthPickerBody');
    bodyEl.innerHTML = '';
    for (let y = yearStart; y <= yearEnd; y++) {
      const row = document.createElement('div');
      row.className = 'month-picker-row';
      const yearDiv = document.createElement('div');
      yearDiv.className = 'month-picker-year' + (y === currentYear ? ' selected' : '');
      yearDiv.textContent = y;
      yearDiv.addEventListener('click', () => {
        currentDate = new Date(y, currentDate.getMonth(), 1);
        renderMonthPickerContent();
        renderCalendar();
      });
      row.appendChild(yearDiv);
      const monthsDiv = document.createElement('div');
      monthsDiv.className = 'month-picker-months';
      for (let m = 0; m < 12; m++) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'month-picker-month' + (y === currentYear && m === currentMonth ? ' selected' : '');
        btn.textContent = m + 1;
        btn.addEventListener('click', () => {
          currentDate = new Date(y, m, 1);
          closeMonthPicker();
          renderCalendar();
        });
        monthsDiv.appendChild(btn);
      }
      row.appendChild(monthsDiv);
      bodyEl.appendChild(row);
    }
  }
  window.renderMonthPickerContent = renderMonthPickerContent;

  const period = document.querySelectorAll('.period-btn');
  let analyticsPeriod = 'month';
  let analyticsCustomStart = null;
  let analyticsCustomEnd = null;
  const analyticsCustomRangeEl = document.getElementById('analyticsCustomRange');
  const analyticsStartInput = document.getElementById('analyticsStartDate');
  const analyticsEndInput = document.getElementById('analyticsEndDate');
  const analyticsApplyBtn = document.getElementById('analyticsApplyRange');

  period.forEach((btn) => {
    btn.addEventListener('click', () => {
      analyticsPeriod = btn.dataset.period || 'month';
      period.forEach((b) => b.classList.toggle('active', b === btn));
      if (analyticsCustomRangeEl) {
        analyticsCustomRangeEl.hidden = analyticsPeriod !== 'custom';
      }
      renderAnalytics();
    });
  });

  if (analyticsApplyBtn) {
    analyticsApplyBtn.addEventListener('click', () => {
      if (!analyticsStartInput || !analyticsEndInput) return;
      const startVal = analyticsStartInput.value;
      const endVal = analyticsEndInput.value;
      if (!startVal || !endVal) return;
      const start = new Date(startVal);
      const end = new Date(endVal);
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return;
      analyticsCustomStart = start;
      analyticsCustomEnd = end;
      analyticsPeriod = 'custom';
      period.forEach((b) => b.classList.toggle('active', b.dataset.period === 'custom'));
      if (analyticsCustomRangeEl) analyticsCustomRangeEl.hidden = false;
      renderAnalytics();
    });
  }

  function getResultsInRange(periodKey, instrument, strategyId) {
    const inst = instrument ?? selectedInstrument;
    const sid = strategyId ?? selectedStrategyId;
    const bucket = dailyResults[sid] || {};
    const end = new Date();
    const results = [];
    let start;
    if (periodKey === 'today') {
      start = new Date(end.getFullYear(), end.getMonth(), end.getDate());
    } else if (periodKey === 'week') {
      start = new Date(end.getFullYear(), end.getMonth(), end.getDate());
      const dayOfWeek = start.getDay();
      const daysToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
      start.setDate(start.getDate() + daysToMonday);
    } else {
      start = new Date(end.getFullYear(), end.getMonth(), 1);
    }
    const cur = new Date(start);
    const endCopy = new Date(end.getFullYear(), end.getMonth(), end.getDate());
    while (cur <= endCopy) {
      if (isWeekday(cur)) {
        const key = formatDateKey(cur);
        const byDate = bucket[key];
        const data = byDate && typeof byDate === 'object' && !isLegacyDailyEntry(byDate) ? byDate[inst] : null;
        if (data) results.push({ key, ...data });
      }
      cur.setDate(cur.getDate() + 1);
    }
    return results;
  }

  function getResultsInCustomRange(startDate, endDate, instrument, strategyId) {
    if (!startDate || !endDate) return [];
    const inst = instrument ?? selectedInstrument;
    const sid = strategyId ?? selectedStrategyId;
    const bucket = dailyResults[sid] || {};
    const results = [];
    const cur = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
    const end = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
    while (cur <= end) {
      if (isWeekday(cur)) {
        const key = formatDateKey(cur);
        const byDate = bucket[key];
        const data = byDate && typeof byDate === 'object' && !isLegacyDailyEntry(byDate) ? byDate[inst] : null;
        if (data) results.push({ key, ...data });
      }
      cur.setDate(cur.getDate() + 1);
    }
    return results;
  }

  function getResultsForLatestMonth(instrument) {
    const inst = instrument ?? selectedInstrument;
    const bucket = dailyResults[selectedStrategyId] || {};
    const keys = Object.keys(bucket).filter((k) => getDayResult(k, inst));
    if (keys.length === 0) return [];
    keys.sort();
    const latest = keys[keys.length - 1];
    const [y, m] = latest.split('-').map(Number);
    const start = new Date(y, m - 1, 1);
    const end = new Date(y, m, 0);
    const results = [];
    const cur = new Date(start);
    while (cur <= end) {
      if (isWeekday(cur)) {
        const key = formatDateKey(cur);
        const data = getDayResult(key, inst);
        if (data) results.push({ key, ...data });
      }
      cur.setDate(cur.getDate() + 1);
    }
    return results;
  }

  function computeMetricsFromResults(results) {
    const totalR = results.reduce((s, r) => s + r.totalR, 0);
    const greenDays = results.filter((r) => r.totalR > 0).length;
    const winRate = results.length ? (greenDays / results.length * 100) : 0;
    let runningTotal = 0, peak = 0, maxDrawdown = 0;
    results.forEach((r) => {
      runningTotal += r.totalR;
      if (runningTotal > peak) peak = runningTotal;
      const drawdown = peak - runningTotal;
      if (drawdown > maxDrawdown) maxDrawdown = drawdown;
    });
    let winningStreak = 0, losingStreak = 0, curWin = 0, curLose = 0;
    results.forEach((r) => {
      if (r.totalR > 0) { curWin++; curLose = 0; if (curWin > winningStreak) winningStreak = curWin; }
      else if (r.totalR < 0) { curLose++; curWin = 0; if (curLose > losingStreak) losingStreak = curLose; }
      else { curWin = 0; curLose = 0; }
    });
    return { totalR, winRate, maxDrawdown, winningStreak, losingStreak };
  }

  function renderAnalytics() {
    let results = [];
    if (analyticsPeriod === 'custom' && analyticsCustomStart && analyticsCustomEnd) {
      results = getResultsInCustomRange(analyticsCustomStart, analyticsCustomEnd);
    } else {
      const key = analyticsPeriod === 'today' || analyticsPeriod === 'week' || analyticsPeriod === 'month' ? analyticsPeriod : 'month';
      results = getResultsInRange(key);
    }
    const m = computeMetricsFromResults(results);
    const set = (id, text) => {
      const el = document.getElementById(id);
      if (el) el.textContent = text;
    };
    const fallbackEl = document.getElementById('analyticsFallbackNote');
    if (fallbackEl) {
      fallbackEl.hidden = true;
      fallbackEl.textContent = '';
    }
    // Strategy label
    const list = loadStrategies();
    const currentStrategy = list.find((s) => s.id === selectedStrategyId) || list[0];
    set('metricStrategyName', currentStrategy ? currentStrategy.name : '—');

    set('metricWinRate', results.length ? m.winRate.toFixed(1) + '%' : '—');
    set('metricMaxDrawdown', results.length ? (m.maxDrawdown > 0 ? '-' : '') + m.maxDrawdown + 'R' : '—');
    set('metricWinningStreak', results.length ? String(m.winningStreak) : '—');
    set('metricLosingStreak', results.length ? String(m.losingStreak) : '—');
    set('metricTotalR', results.length ? formatR(m.totalR) : '—');

    const summaryEl = document.getElementById('analyticsSummaryText');
    const coachEl = document.getElementById('analyticsCoachText');

    if (!results.length) {
      if (fallbackEl) {
        fallbackEl.hidden = false;
        fallbackEl.textContent = 'No trades logged in this period yet. Log at least one day of results to unlock analytics.';
      }
      if (summaryEl) {
        summaryEl.textContent = '';
      }
      if (coachEl) {
        coachEl.textContent = 'Discipline is your edge. Log your results so the maths can guide you.';
      }
      if (typeof window.renderCompareStrategies === 'function') window.renderCompareStrategies();
      return;
    }

    const greenDays = results.filter((r) => r.totalR > 0).length;
    const redDays = results.filter((r) => r.totalR < 0).length;
    const totalDays = results.length;

    if (summaryEl) {
      summaryEl.textContent = `${greenDays} green day${greenDays === 1 ? '' : 's'}, ${redDays} red day${redDays === 1 ? '' : 's'} out of ${totalDays}.`;
    }

    if (coachEl) {
      let message = '';
      const absTotalR = Math.abs(m.totalR);

      if (m.losingStreak >= 3 || redDays > greenDays) {
        message = 'Discipline is heavy for an hour. Regret is heavy for a lifetime. Choose your weights.';
      } else if (m.maxDrawdown > Math.max(5, absTotalR)) {
        message = 'Trust the maths — your drawdown is outweighing your gains. Cut losses quickly and keep risk per trade consistent.';
      } else if (m.winRate >= 55 && m.totalR < 5) {
        message = 'Think horizontally — your win rate is solid; focus on letting winners run and scaling size gradually so the maths work in your favour.';
      } else if (m.totalR >= 5 && m.winRate >= 55 && m.maxDrawdown <= 3) {
        message = 'Trust the maths — your numbers this period show an edge. Keep the same discipline; don’t change what’s working.';
      } else {
        message = 'Think horizontally — compare win rate and drawdown together. Steady progress beats big swings.';
      }

      coachEl.textContent = message;
    }

    if (typeof window.renderCompareStrategies === 'function') window.renderCompareStrategies();
  }
  window.renderAnalytics = renderAnalytics;

  let compareCheckedIds = new Set();
  function renderCompareStrategies() {
    const list = loadStrategies();
    const checkboxesEl = document.getElementById('compareStrategyCheckboxes');
    const tableEl = document.getElementById('compareStrategyTable');
    if (!checkboxesEl || !tableEl) return;
    checkboxesEl.innerHTML = '';
    list.forEach((s) => {
      const label = document.createElement('label');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.dataset.strategyId = s.id;
      if (compareCheckedIds.has(s.id)) cb.checked = true;
      cb.addEventListener('change', () => {
        if (cb.checked) compareCheckedIds.add(s.id); else compareCheckedIds.delete(s.id);
        renderCompareTable();
      });
      label.appendChild(cb);
      label.appendChild(document.createTextNode(s.name));
      checkboxesEl.appendChild(label);
    });

    function renderCompareTable() {
      compareCheckedIds = new Set(Array.from(checkboxesEl.querySelectorAll('input:checked')).map((c) => c.dataset.strategyId));
      const checked = Array.from(compareCheckedIds);
      if (checked.length < 2) {
        tableEl.hidden = true;
        tableEl.innerHTML = '';
        return;
      }
      const rows = checked.map((sid) => {
        let results = [];
        if (analyticsPeriod === 'custom' && analyticsCustomStart && analyticsCustomEnd) {
          results = getResultsInCustomRange(analyticsCustomStart, analyticsCustomEnd, undefined, sid);
        } else {
          const key = analyticsPeriod === 'today' || analyticsPeriod === 'week' || analyticsPeriod === 'month' ? analyticsPeriod : 'month';
          results = getResultsInRange(key, undefined, sid);
        }
        const m = computeMetricsFromResults(results);
        const name = list.find((s) => s.id === sid)?.name || sid;
        return { name, ...m };
      });
      tableEl.innerHTML = '<table><thead><tr><th>Strategy</th><th>Win rate</th><th>Max DD</th><th>Win streak</th><th>Lose streak</th><th>Total R</th></tr></thead><tbody>' +
        rows.map((r) => '<tr><td>' + r.name + '</td><td>' + (r.winRate != null ? r.winRate.toFixed(1) + '%' : '—') + '</td><td>' + (r.maxDrawdown > 0 ? '-' : '') + r.maxDrawdown + 'R</td><td>' + r.winningStreak + '</td><td>' + r.losingStreak + '</td><td>' + formatR(r.totalR) + '</td></tr>').join('') + '</tbody></table>';
      tableEl.hidden = false;
    }
    renderCompareTable();
  }
  window.renderCompareStrategies = renderCompareStrategies;

  const sharePostCommunityBtn = document.getElementById('sharePostCommunityBtn');
  const shareCommunityMessage = document.getElementById('shareCommunityMessage');

  document.getElementById('shareGenerateBtn')?.addEventListener('click', () => {
    const periodVal = document.getElementById('sharePeriod')?.value || 'month';
    const { token } = buildSnapshotTokenForPeriod(periodVal);
    const base = window.location.origin + window.location.pathname.replace(/index\.html?$/, '');
    const link = (base.endsWith('/') ? base : base + '/') + 'share.html?t=' + encodeURIComponent(token);
    const linkBox = document.getElementById('shareLinkBox');
    const input = document.getElementById('shareLinkInput');
    if (input) input.value = link;
    if (linkBox) linkBox.hidden = false;

    if (sharePostCommunityBtn) sharePostCommunityBtn.hidden = false;
    if (shareCommunityMessage) shareCommunityMessage.textContent = '';
  });

  document.getElementById('shareCopyBtn')?.addEventListener('click', () => {
    const input = document.getElementById('shareLinkInput');
    if (input) {
      input.select();
      document.execCommand('copy');
    }
  });

  const communityFeedEl = document.getElementById('communityFeed');
  const communitySortSelect = document.getElementById('communitySortSelect');
  const communityNewPostBtn = document.getElementById('communityNewPostBtn');
  const communityPostMessage = document.getElementById('communityPostMessage');

  async function postSnapshotToCommunity() {
    if (!currentUser) {
      if (typeof openAuthModal === 'function') openAuthModal();
      if (communityPostMessage) communityPostMessage.textContent = 'Sign in to post to the community.';
      if (shareCommunityMessage) shareCommunityMessage.textContent = 'Sign in to post to the community.';
      return;
    }
    if (!lastShareToken) buildSnapshotTokenForPeriod('month');
    if (!lastShareToken) {
      if (communityPostMessage) communityPostMessage.textContent = 'Could not build snapshot.';
      if (shareCommunityMessage) shareCommunityMessage.textContent = 'Could not build snapshot.';
      return;
    }
    const defaultTitle = `Snapshot: ${lastSharePayload?.period || 'recent performance'}`;
    const title = (prompt('Post title', defaultTitle) || '').trim();
    if (!title) return;
    const description = (prompt('Description (optional)', '') || '').trim();
    const supa = initSupabase();
    if (!supa) return;
    if (sharePostCommunityBtn) sharePostCommunityBtn.disabled = true;
    if (communityPostMessage) communityPostMessage.textContent = '';
    if (shareCommunityMessage) shareCommunityMessage.textContent = '';
    const { error } = await supa.from('shared_calendars').insert({
      user_id: currentUser.id,
      title,
      description: description || null,
      snapshot_token: lastShareToken,
      topic: 'general',
      is_public: true
    });
    if (sharePostCommunityBtn) sharePostCommunityBtn.disabled = false;
    if (error) {
      const err = error.message || 'Could not post to community.';
      if (communityPostMessage) communityPostMessage.textContent = err;
      if (shareCommunityMessage) shareCommunityMessage.textContent = err;
      return;
    }
    if (communityPostMessage) communityPostMessage.textContent = 'Posted to community.';
    if (shareCommunityMessage) shareCommunityMessage.textContent = 'Posted to community.';
    if (typeof window.renderCommunityFeed === 'function') window.renderCommunityFeed();
  }

  async function fetchCommunityFeed(sortKey) {
    const supa = initSupabase();
    if (!supa) return [];
    let query = supa
      .from('shared_calendars')
      .select('id, title, description, topic, created_at, snapshot_token, profiles!inner(username, avatar_url)')
      .eq('is_public', true);
    if (sortKey === 'most_commented') {
      query = query.order('created_at', { ascending: false }); // Placeholder: real implementation could join comment counts
    } else {
      query = query.order('created_at', { ascending: false });
    }
    const { data, error } = await query.limit(20);
    if (error) return [];
    return data || [];
  }

  function renderCommunityFeedSkeleton() {
    if (!communityFeedEl) return;
    communityFeedEl.innerHTML = '<p class="community-empty-note">Loading community posts…</p>';
  }

  function renderCommunityFeedEmpty() {
    if (!communityFeedEl) return;
    communityFeedEl.innerHTML = '<p class="community-empty-note">When traders share their calendars, they will show up here.</p>';
  }

  function renderCommunityFeedFromRows(rows) {
    if (!communityFeedEl) return;
    if (!rows.length) {
      renderCommunityFeedEmpty();
      return;
    }
    communityFeedEl.innerHTML = '';
    rows.forEach((row) => {
      const card = document.createElement('article');
      card.className = 'community-post-card';
      const username = row.profiles?.username || 'Trader';
      const createdAt = row.created_at ? new Date(row.created_at) : null;
      const timeLabel = createdAt ? createdAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
      const initials = username.replace('@', '').split(/\s|_/).filter(Boolean).map((p) => p[0].toUpperCase()).slice(0, 2).join('') || 'TV';
      card.innerHTML = `
        <header class="community-post-header">
          <div class="community-post-author">
            <div class="community-avatar">${initials}</div>
            <div class="community-post-meta">
              <div class="community-post-author-line">
                <span class="community-username">@${username.replace(/^@/, '')}</span>
                <span class="community-tag">${row.topic || 'general'}</span>
              </div>
              <span class="community-post-time">${timeLabel}</span>
            </div>
          </div>
        </header>
        <div class="community-post-body">
          <h3 class="community-post-title">${row.title}</h3>
          <p class="community-post-description">${row.description || ''}</p>
        </div>
        <div class="community-post-stats">
          <span>Snapshot period: ${row.snapshot_token ? 'shared' : '—'}</span>
        </div>
        <footer class="community-post-footer">
          <button type="button" class="community-post-link" data-post-id="${row.id}">View snapshot</button>
          <div class="community-post-footer-meta">
            <span>Comments coming soon</span>
          </div>
        </footer>
      `;
      communityFeedEl.appendChild(card);
    });
  }

  async function renderCommunityFeed() {
    const sortKey = communitySortSelect?.value || 'newest';
    renderCommunityFeedSkeleton();
    const rows = await fetchCommunityFeed(sortKey);
    renderCommunityFeedFromRows(rows);
  }
  window.renderCommunityFeed = renderCommunityFeed;

  if (communitySortSelect) {
    communitySortSelect.addEventListener('change', () => {
      renderCommunityFeed();
    });
  }

  if (communityNewPostBtn) {
    communityNewPostBtn.addEventListener('click', () => {
      postSnapshotToCommunity();
    });
  }

  if (sharePostCommunityBtn) {
    sharePostCommunityBtn.addEventListener('click', () => {
      postSnapshotToCommunity();
    });
  }

  const themeSelect = document.getElementById('settingsTheme');
  if (themeSelect) {
    const saved = localStorage.getItem(STORAGE_KEYS.theme) || 'dark';
    themeSelect.value = saved;
    document.documentElement.classList.toggle('theme-light', saved === 'light');
    themeSelect.addEventListener('change', () => {
      const v = themeSelect.value;
      localStorage.setItem(STORAGE_KEYS.theme, v);
      document.documentElement.classList.toggle('theme-light', v === 'light');
    });
  }

  currentDate = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
  selectedDate = new Date();
  if (!supa && typeof window.renderStrategyPills === 'function') window.renderStrategyPills();
  showScreen('calendar');
  if (typeof window.renderCommunityFeed === 'function') window.renderCommunityFeed();
});
