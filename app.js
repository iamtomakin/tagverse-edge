/**
 * Tagverse Edge — Calendar, declarations, log modal, analytics, share, settings
 *
 * ---------------------------------------------------------------------------
 * DATA CONTRACT (do not regress — wording matters)
 * ---------------------------------------------------------------------------
 * Supabase = source of truth (Postgres + Auth) for persisted domain data when
 * the user is signed in and the app is online.
 *
 * In-memory state (module-level vars + what the UI reads) = UI state — always
 * derived from the truth above after load/sync, never “because localStorage said so.”
 *
 * localStorage = temporary cache ONLY — never authoritative. It may hydrate the
 * UI before a network round-trip, or hold prefs (theme, journal vocabulary,
 * log R button list, calendar instrument/strategy selection mirrored in profile, etc.), but must not
 * silently become a second master copy.
 * If signed in, reconcile from Supabase; do not treat cache misses/wins as competing truth.
 * ---------------------------------------------------------------------------
 */

const STORAGE_KEYS = { dailyResults: 'tagverse_daily_results', declarations: 'tagverse_declarations', theme: 'tagverse_theme', shareTokens: 'tagverse_share_tokens', selectedInstrument: 'tagverse_selected_instrument', mode: 'tagverse_mode', strategies: 'tagverse_strategies', selectedStrategy: 'tagverse_selected_strategy', journalEntries: 'tagverse_journal_entries', journalOptions: 'tagverse_journal_options', logROptions: 'tagverse_log_r_options' };

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
  renderDailyLogScreen();
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
  renderDailyLogScreen();
  if (typeof window.renderAnalytics === 'function') window.renderAnalytics();
  if (typeof window.renderCompareStrategies === 'function') window.renderCompareStrategies();
  scheduleProfilePreferencesSync();
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
 * Upload local-only calendar cells to Supabase; remote wins when the same key exists.
 * After merge, applyAuthState re-fetches from DB so localStorage matches the server (SSOT).
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
 * Same as mergeDailyResultsCloudFirst for declarations; SSOT enforced by applyAuthState refetch.
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
    const tr = r.total_r;
    const t1 = r.trade_1_r;
    const totalR = typeof tr === 'string' ? parseFloat(tr) : Number(tr);
    const trade1r = t1 == null ? null : typeof t1 === 'string' ? parseFloat(t1) : Number(t1);
    out[sid][r.date_key][r.instrument] = { totalR: Number.isFinite(totalR) ? totalR : 0, tradeCount: r.trade_count };
    if (trade1r != null && Number.isFinite(trade1r)) out[sid][r.date_key][r.instrument].trade_1_r = trade1r;
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

/** Load one strategy row (e.g. profile.calendar_preferences references a UUID missing from merged list). */
async function fetchStrategyByIdFromSupabase(userId, strategyId) {
  const supa = initSupabase();
  if (!supa || !userId || !strategyId || strategyId === STRATEGY_DEFAULT_ID) return null;
  const { data, error } = await supa.from('strategies').select('id, name').eq('user_id', userId).eq('id', strategyId).maybeSingle();
  if (error || !data) return null;
  return { id: data.id, name: data.name };
}

/**
 * Ensures the strategy selected in cloud profile exists in the in-memory list (fixes phone vs desktop mismatch).
 */
async function ensureStrategyInListForUser(userId, strategyIdStr) {
  if (!strategyIdStr || strategyIdStr === STRATEGY_DEFAULT_ID) return;
  if (strategies.some((s) => s.id === strategyIdStr)) return;
  const row = await fetchStrategyByIdFromSupabase(userId, strategyIdStr);
  if (!row) {
    console.warn('[Tagverse] calendar_preferences strategyId not found in strategies table:', strategyIdStr);
    return;
  }
  strategies.push(row);
  saveStrategies(strategies);
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
/** Month shown on Daily Log → Calendar (journal), independent of P/L calendar. */
let journalLogMonth = new Date();
let journalEntryEditId = null;
let journalPickerKind = null;
let journalPickerAnchorEl = null;
let journalDraftEmotions = [];
let journalDraftCategories = [];
/** Debounced sync of journal_options + log_r_options to profiles when signed in. */
let profilePreferencesSyncTimer = null;
let journalImageDraft = { before: null, after: null };
/** Notion-style option editor (rename / color / delete) */
let journalOptionEditKind = null;
let journalOptionEditLabel = null;
let journalOptionEditAnchorEl = null;
const JOURNAL_IMAGE_MAX_BYTES = 2.5 * 1024 * 1024;

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

/** Synced to profiles.calendar_preferences when signed in — keeps phone + desktop on the same P/L view. */
function buildCalendarPreferencesPayload() {
  return { instrument: selectedInstrument, strategyId: selectedStrategyId };
}

/**
 * When signed in, profile.calendar_preferences is SSOT for instrument + strategy (after strategies list is loaded).
 * @returns {{ instrument: string, strategyId: string } | null}
 */
function applyCalendarPreferencesFromProfile(profile, strategiesList) {
  const p = profile?.calendar_preferences;
  if (!p || typeof p !== 'object') return null;
  let inst = null;
  let sid = null;
  if (typeof p.instrument === 'string' && INSTRUMENTS.includes(p.instrument)) inst = p.instrument;
  if (typeof p.strategyId === 'string' && strategiesList.some((s) => s.id === p.strategyId)) sid = p.strategyId;
  if (inst == null && sid == null) return null;
  return {
    instrument: inst != null ? inst : selectedInstrument,
    strategyId: sid != null ? sid : selectedStrategyId
  };
}

/** Persist all in-memory calendar/auth prefs to localStorage (e.g. when offline user taps Save locally). */
function flushAllLocalDataToStorage() {
  try {
    saveDailyResults(dailyResults);
    saveDeclarations(declarations);
    saveStrategies(strategies);
    saveSelectedStrategyId(selectedStrategyId);
    saveSelectedInstrument(selectedInstrument);
    saveCurrentMode(currentMode);
    saveLogROptions(loadLogROptions(), { skipSync: true });
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

/**
 * Format R for UI (calendar, analytics). Supports fractional R when stored as number.
 * Zero is shown as "—" style dash (breakeven).
 */
function formatR(r) {
  const n = Number(r);
  if (!Number.isFinite(n)) return '—';
  if (n === 0) return '-';
  const fmtAbs = (x) => {
    const a = Math.abs(x);
    if (Number.isInteger(a)) return String(a);
    let s = a.toFixed(4).replace(/\.?0+$/, '');
    if (s === '' || s === '-') s = '0';
    return s;
  };
  if (n < 0) return `-${fmtAbs(n)}R`;
  const abs = fmtAbs(n);
  return n === 1 ? '1R' : `+${abs}R`;
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

/** Build snapshot token + payload for share; updates localStorage tokens and lastShareToken / lastSharePayload. */
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
    syncCalendarUserBio();
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
  syncCalendarUserBio();
}

/** Profile bio max length (Settings + calendar footer). */
const MAX_BIO_CHARS = 65;

/** While typing: only cap length — do not trim (so spaces between words work). */
function clampBioInputLength(raw) {
  let s = String(raw || '');
  if (s.length > MAX_BIO_CHARS) s = s.slice(0, MAX_BIO_CHARS);
  return s;
}

/** On save / display from DB: trim ends and cap length. */
function clampBio(raw) {
  let s = String(raw || '').trim();
  if (s.length > MAX_BIO_CHARS) s = s.slice(0, MAX_BIO_CHARS);
  return s;
}

/** Calendar: show bio below the grid when signed in and bio is non-empty. */
function syncCalendarUserBio() {
  const section = document.getElementById('calendarUserBioSection');
  const textEl = document.getElementById('calendarUserBioText');
  if (!section || !textEl) return;
  if (!currentUser) {
    section.hidden = true;
    textEl.textContent = '';
    return;
  }
  const raw = currentProfile && currentProfile.bio != null ? String(currentProfile.bio) : '';
  const bio = clampBio(raw);
  if (!bio) {
    section.hidden = true;
    textEl.textContent = '';
    return;
  }
  section.hidden = false;
  textEl.textContent = bio;
}

/* ---------- Daily Log (Notion-style journal): localStorage ---------- */

function loadJournalEntries() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.journalEntries);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch (_) {
    return [];
  }
}

function saveJournalEntries(entries) {
  try {
    localStorage.setItem(STORAGE_KEYS.journalEntries, JSON.stringify(entries));
  } catch (e) {
    console.error('[Tagverse] save journal entries failed', e);
  }
}

function getJournalEntriesForStrategy(strategyId) {
  return loadJournalEntries().filter((e) => e && e.strategyId === strategyId);
}

const JOURNAL_DEFAULT_CATEGORIES = ['Eval', 'Funded', 'Live'];

/** Default risk levels (single-select). */
const JOURNAL_DEFAULT_RISK_TYPES = ['Low', 'Medium', 'High'];

/**
 * Canonical emotions — order & colors match the Notion-style picker reference.
 * Users may still add custom emotions (grey “custom” pill).
 */
const JOURNAL_CANONICAL_EMOTIONS = [
  'anxious',
  'content',
  'disappointed',
  'furious',
  'guilty',
  'low',
  'neutral',
  'nervous',
  'overwhelmed',
  'proud',
  'positive'
];

const _journalCanonEmoLower = new Set(JOURNAL_CANONICAL_EMOTIONS.map((s) => s.toLowerCase()));

/** Notion database color names (fixed set). */
const JOURNAL_NOTION_PALETTE = ['default', 'gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'];

const CANON_EMOTION_PALETTE = {
  anxious: 'red',
  content: 'blue',
  disappointed: 'purple',
  furious: 'red',
  guilty: 'gray',
  low: 'purple',
  neutral: 'gray',
  nervous: 'purple',
  overwhelmed: 'brown',
  proud: 'blue',
  positive: 'green'
};

const DEFAULT_RISK_PALETTE = { low: 'green', medium: 'orange', high: 'red' };
const DEFAULT_CATEGORY_PALETTE = { eval: 'blue', funded: 'green', live: 'orange' };

function dedupeSorted(arr) {
  return [...new Set((Array.isArray(arr) ? arr : []).map(String))].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

function getDefaultColorKeyForOption(kind, label) {
  const l = String(label || '')
    .trim()
    .toLowerCase();
  if (kind === 'emotion') return CANON_EMOTION_PALETTE[l] || 'default';
  if (kind === 'risk') return DEFAULT_RISK_PALETTE[l] || 'default';
  if (kind === 'category') return DEFAULT_CATEGORY_PALETTE[l] || 'default';
  return 'default';
}

function normalizeColorKey(key) {
  const k = String(key || 'default').toLowerCase();
  return JOURNAL_NOTION_PALETTE.includes(k) ? k : 'default';
}

function seedColorMaps(opts) {
  const ec = opts.emotionColors && typeof opts.emotionColors === 'object' ? { ...opts.emotionColors } : {};
  const rc = opts.riskColors && typeof opts.riskColors === 'object' ? { ...opts.riskColors } : {};
  const cc = opts.categoryColors && typeof opts.categoryColors === 'object' ? { ...opts.categoryColors } : {};
  (opts.emotions || []).forEach((e) => {
    if (ec[e] == null) ec[e] = getDefaultColorKeyForOption('emotion', e);
  });
  (opts.riskTypes || []).forEach((r) => {
    if (rc[r] == null) rc[r] = getDefaultColorKeyForOption('risk', r);
  });
  (opts.categories || []).forEach((c) => {
    if (cc[c] == null) cc[c] = getDefaultColorKeyForOption('category', c);
  });
  return { emotionColors: ec, riskColors: rc, categoryColors: cc };
}

function loadJournalOptions() {
  const emptyBase = () => {
    const base = {
      categories: [...JOURNAL_DEFAULT_CATEGORIES],
      emotions: [...JOURNAL_CANONICAL_EMOTIONS],
      riskTypes: [...JOURNAL_DEFAULT_RISK_TYPES],
      emotionColors: {},
      riskColors: {},
      categoryColors: {}
    };
    const seeded = seedColorMaps(base);
    base.emotionColors = seeded.emotionColors;
    base.riskColors = seeded.riskColors;
    base.categoryColors = seeded.categoryColors;
    return base;
  };
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.journalOptions);
    if (!raw) return emptyBase();
    const o = JSON.parse(raw);
    if (!o || typeof o !== 'object') return emptyBase();
    const categories = Array.isArray(o.categories) ? dedupeSorted(o.categories) : [...JOURNAL_DEFAULT_CATEGORIES];
    const emotions = Array.isArray(o.emotions) ? dedupeSorted(o.emotions) : [...JOURNAL_CANONICAL_EMOTIONS];
    const riskTypes = Array.isArray(o.riskTypes) ? dedupeSorted(o.riskTypes) : [...JOURNAL_DEFAULT_RISK_TYPES];
    const merged = {
      categories,
      emotions,
      riskTypes,
      emotionColors: o.emotionColors && typeof o.emotionColors === 'object' ? o.emotionColors : {},
      riskColors: o.riskColors && typeof o.riskColors === 'object' ? o.riskColors : {},
      categoryColors: o.categoryColors && typeof o.categoryColors === 'object' ? o.categoryColors : {}
    };
    const seeded = seedColorMaps(merged);
    merged.emotionColors = seeded.emotionColors;
    merged.riskColors = seeded.riskColors;
    merged.categoryColors = seeded.categoryColors;
    return merged;
  } catch (_) {
    return emptyBase();
  }
}

function saveJournalOptions(opts, flags) {
  try {
    localStorage.setItem(STORAGE_KEYS.journalOptions, JSON.stringify(opts));
  } catch (e) {
    console.error('[Tagverse] save journal options failed', e);
  }
  if (!flags?.skipSync) {
    scheduleProfilePreferencesSync();
  }
}

/** Default R buttons on the calendar log modal (same as original hard-coded set). */
const DEFAULT_LOG_R_VALUES = [-2, -1, 0, 1, 2, 3, 4, 5];

function roundRKey(n) {
  return Math.round(n * 10000) / 10000;
}

/**
 * Normalize user-defined R list: finite numbers in [-100, 100], deduped, sorted ascending.
 * @returns {number[]}
 */
function normalizeLogROptions(input) {
  if (!Array.isArray(input)) return [...DEFAULT_LOG_R_VALUES];
  const seen = new Set();
  const nums = [];
  for (const x of input) {
    const n = typeof x === 'number' ? x : parseFloat(String(x).trim().replace(/,/g, ''));
    if (!Number.isFinite(n)) continue;
    if (n < -100 || n > 100) continue;
    const r = roundRKey(n);
    const k = String(r);
    if (seen.has(k)) continue;
    seen.add(k);
    nums.push(r);
  }
  nums.sort((a, b) => a - b);
  return nums.length >= 1 ? nums : [...DEFAULT_LOG_R_VALUES];
}

/** Parse comma / space / semicolon separated values from settings. */
function parseLogROptionsFromTextField(raw) {
  const s = String(raw || '').trim();
  if (!s) return [...DEFAULT_LOG_R_VALUES];
  const parts = s.split(/[\s,;]+/).filter(Boolean);
  return normalizeLogROptions(parts.map((p) => parseFloat(p)));
}

function logROptionsFromRemoteProfileOnly(remote) {
  if (remote == null) return null;
  if (Array.isArray(remote)) return normalizeLogROptions(remote.map((x) => (typeof x === 'number' ? x : parseFloat(x))));
  if (typeof remote === 'object' && Array.isArray(remote.values)) {
    return normalizeLogROptions(remote.values.map((x) => (typeof x === 'number' ? x : parseFloat(x))));
  }
  return null;
}

function loadLogROptions() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.logROptions);
    if (!raw) return [...DEFAULT_LOG_R_VALUES];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return normalizeLogROptions(parsed);
  } catch (_) {}
  return [...DEFAULT_LOG_R_VALUES];
}

function saveLogROptions(values, flags) {
  const arr = normalizeLogROptions(Array.isArray(values) ? values : loadLogROptions());
  try {
    localStorage.setItem(STORAGE_KEYS.logROptions, JSON.stringify(arr));
  } catch (e) {
    console.error('[Tagverse] save log R options failed', e);
  }
  if (!flags?.skipSync) {
    scheduleProfilePreferencesSync();
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Button label for log modal (0 stays "0", not "—"). */
function formatLogRButtonLabel(r) {
  const n = Number(r);
  if (!Number.isFinite(n)) return '?';
  if (n === 0) return '0';
  if (n < 0) {
    const abs = Math.abs(n);
    const t = Number.isInteger(n) ? String(abs) : String(roundRKey(abs)).replace(/\.?0+$/, '');
    return `-${t}R`;
  }
  const abs = Math.abs(n);
  const t = Number.isInteger(n) ? String(abs) : String(roundRKey(abs)).replace(/\.?0+$/, '');
  return n === 1 ? '1R' : `+${t}R`;
}

function renderLogModalROptions() {
  const wrap = document.getElementById('logModalROptions');
  if (!wrap) return;
  const vals = loadLogROptions();
  wrap.innerHTML = vals
    .map((r) => {
      const label = formatLogRButtonLabel(r);
      const dr = String(roundRKey(Number(r)));
      return `<button type="button" class="log-option r-option" data-r="${escapeHtml(dr)}">${escapeHtml(label)}</button>`;
    })
    .join('');
}

/**
 * When signed in, profile.journal_options is the source of truth (replaces local vocabulary).
 */
function journalOptionsFromRemoteProfileOnly(remote) {
  if (!remote || typeof remote !== 'object' || Array.isArray(remote)) return null;
  const merged = {
    categories: Array.isArray(remote.categories)
      ? dedupeSorted(remote.categories.map(String).filter(Boolean))
      : [...JOURNAL_DEFAULT_CATEGORIES],
    emotions: Array.isArray(remote.emotions)
      ? dedupeSorted(remote.emotions.map(String).filter(Boolean))
      : [...JOURNAL_CANONICAL_EMOTIONS],
    riskTypes: Array.isArray(remote.riskTypes)
      ? dedupeSorted(remote.riskTypes.map(String).filter(Boolean))
      : [...JOURNAL_DEFAULT_RISK_TYPES],
    emotionColors: remote.emotionColors && typeof remote.emotionColors === 'object' ? { ...remote.emotionColors } : {},
    riskColors: remote.riskColors && typeof remote.riskColors === 'object' ? { ...remote.riskColors } : {},
    categoryColors: remote.categoryColors && typeof remote.categoryColors === 'object' ? { ...remote.categoryColors } : {}
  };
  const seeded = seedColorMaps(merged);
  merged.emotionColors = seeded.emotionColors;
  merged.riskColors = seeded.riskColors;
  merged.categoryColors = seeded.categoryColors;
  return merged;
}

/** Merge local journal vocabulary with remote profile (union lists; remote color keys override). */
function mergeJournalOptionsObjects(local, remote) {
  if (!remote || typeof remote !== 'object' || Array.isArray(remote)) return local;
  const l = local && typeof local === 'object' ? local : loadJournalOptions();
  const rc = Array.isArray(remote.categories) ? remote.categories : [];
  const re = Array.isArray(remote.emotions) ? remote.emotions : [];
  const rr = Array.isArray(remote.riskTypes) ? remote.riskTypes : [];
  return {
    categories: dedupeSorted([...new Set([...(l.categories || []), ...rc])]),
    emotions: dedupeSorted([...new Set([...(l.emotions || []), ...re])]),
    riskTypes: dedupeSorted([...new Set([...(l.riskTypes || []), ...rr])]),
    emotionColors: {
      ...(l.emotionColors && typeof l.emotionColors === 'object' ? l.emotionColors : {}),
      ...(remote.emotionColors && typeof remote.emotionColors === 'object' ? remote.emotionColors : {})
    },
    riskColors: {
      ...(l.riskColors && typeof l.riskColors === 'object' ? l.riskColors : {}),
      ...(remote.riskColors && typeof remote.riskColors === 'object' ? remote.riskColors : {})
    },
    categoryColors: {
      ...(l.categoryColors && typeof l.categoryColors === 'object' ? l.categoryColors : {}),
      ...(remote.categoryColors && typeof remote.categoryColors === 'object' ? remote.categoryColors : {})
    }
  };
}

function scheduleProfilePreferencesSync() {
  if (!currentUser || !isSupabaseEnabled()) return;
  clearTimeout(profilePreferencesSyncTimer);
  profilePreferencesSyncTimer = setTimeout(() => {
    profilePreferencesSyncTimer = null;
    void syncProfilePreferencesToSupabase();
  }, 500);
}

async function syncProfilePreferencesToSupabase() {
  if (!currentUser || !isSupabaseEnabled()) return;
  let profile = currentProfile;
  if (!profile?.username) {
    profile = await fetchCurrentProfile(currentUser.id);
    if (profile) currentProfile = profile;
  }
  if (!profile?.username) return;
  const opts = loadJournalOptions();
  const logR = loadLogROptions();
  const { error } = await upsertProfile(currentUser.id, {
    username: profile.username,
    bio: profile.bio ?? null,
    avatar_url: profile.avatar_url ?? null,
    default_strategy_name: profile.default_strategy_name ?? null,
    journal_options: opts,
    log_r_options: logR,
    calendar_preferences: buildCalendarPreferencesPayload()
  });
  if (error) console.warn('[Tagverse] profile preferences sync failed', error.message || error);
}

/** Remember a user-typed value in the vocabulary for pickers. */
function ensureJournalOption(kind, value) {
  const v = String(value || '').trim();
  if (!v) return;
  const opts = loadJournalOptions();
  if (kind === 'category') {
    if (opts.categories.some((c) => c.toLowerCase() === v.toLowerCase())) return;
    opts.categories = dedupeSorted([...opts.categories, v]);
    if (!opts.categoryColors) opts.categoryColors = {};
    if (opts.categoryColors[v] == null) opts.categoryColors[v] = getDefaultColorKeyForOption('category', v);
  } else if (kind === 'emotion') {
    if (opts.emotions.some((e) => e.toLowerCase() === v.toLowerCase())) return;
    opts.emotions = dedupeSorted([...opts.emotions, v]);
    if (!opts.emotionColors) opts.emotionColors = {};
    if (opts.emotionColors[v] == null) opts.emotionColors[v] = getDefaultColorKeyForOption('emotion', v);
  } else if (kind === 'risk') {
    if (opts.riskTypes.some((r) => r.toLowerCase() === v.toLowerCase())) return;
    opts.riskTypes = dedupeSorted([...opts.riskTypes, v]);
    if (!opts.riskColors) opts.riskColors = {};
    if (opts.riskColors[v] == null) opts.riskColors[v] = getDefaultColorKeyForOption('risk', v);
  } else return;
  saveJournalOptions(opts);
}

function renameJournalOptionInStorage(kind, oldLabel, newLabel) {
  const o = String(oldLabel || '').trim();
  const n = String(newLabel || '').trim();
  if (!o || !n || o === n) return;
  const opts = loadJournalOptions();
  const relabel = (arr) => arr.map((x) => (x === o ? n : x));
  if (kind === 'emotion') {
    opts.emotions = dedupeSorted(relabel(opts.emotions || []));
    if (!opts.emotionColors) opts.emotionColors = {};
    const c = opts.emotionColors[o] || getDefaultColorKeyForOption('emotion', n);
    delete opts.emotionColors[o];
    opts.emotionColors[n] = normalizeColorKey(c);
    journalDraftEmotions = journalDraftEmotions.map((x) => (x === o ? n : x));
  } else if (kind === 'risk') {
    opts.riskTypes = dedupeSorted(relabel(opts.riskTypes || []));
    if (!opts.riskColors) opts.riskColors = {};
    const c = opts.riskColors[o] || getDefaultColorKeyForOption('risk', n);
    delete opts.riskColors[o];
    opts.riskColors[n] = normalizeColorKey(c);
    const h = document.getElementById('journalEntryRisk');
    if (h && h.value === o) {
      h.value = n;
      applyJournalRisk(n);
    }
  } else if (kind === 'category') {
    opts.categories = dedupeSorted(relabel(opts.categories || []));
    if (!opts.categoryColors) opts.categoryColors = {};
    const c = opts.categoryColors[o] || getDefaultColorKeyForOption('category', n);
    delete opts.categoryColors[o];
    opts.categoryColors[n] = normalizeColorKey(c);
    if (journalDraftCategories.some((x) => x.toLowerCase() === o.toLowerCase())) {
      journalDraftCategories = journalDraftCategories.map((x) => (x.toLowerCase() === o.toLowerCase() ? n : x));
      renderJournalCategoryChips();
    }
  } else return;
  saveJournalOptions(opts);
  const entries = loadJournalEntries();
  let changed = false;
  entries.forEach((e) => {
    if (kind === 'category') {
      const cats = normalizeJournalCategories(e);
      if (cats.includes(o)) {
        e.categories = dedupeSorted(cats.map((x) => (x === o ? n : x)));
        delete e.category;
        changed = true;
      }
    }
    if (kind === 'risk' && e.riskType === o) {
      e.riskType = n;
      changed = true;
    }
    if (kind === 'emotion' && Array.isArray(e.emotions) && e.emotions.includes(o)) {
      e.emotions = [...new Set(e.emotions.map((x) => (x === o ? n : x)))];
      changed = true;
    }
  });
  if (changed) saveJournalEntries(entries);
  journalOptionEditLabel = n;
  const inp = document.getElementById('journalOptionEditInput');
  if (inp) inp.value = n;
}

function deleteJournalOptionFromStorage(kind, label) {
  const v = String(label || '').trim();
  if (!v) return;
  const opts = loadJournalOptions();
  if (kind === 'emotion') {
    opts.emotions = (opts.emotions || []).filter((x) => x !== v);
    if (opts.emotionColors) delete opts.emotionColors[v];
    journalDraftEmotions = journalDraftEmotions.filter((x) => x !== v);
  } else if (kind === 'risk') {
    opts.riskTypes = (opts.riskTypes || []).filter((x) => x !== v);
    if (opts.riskColors) delete opts.riskColors[v];
    const h = document.getElementById('journalEntryRisk');
    if (h && h.value === v) applyJournalRisk('');
  } else if (kind === 'category') {
    opts.categories = (opts.categories || []).filter((x) => x !== v);
    if (opts.categoryColors) delete opts.categoryColors[v];
    journalDraftCategories = journalDraftCategories.filter((x) => x.toLowerCase() !== v.toLowerCase());
    renderJournalCategoryChips();
  } else return;
  saveJournalOptions(opts);
  const entries = loadJournalEntries();
  let changed = false;
  entries.forEach((e) => {
    if (kind === 'category') {
      const cats = normalizeJournalCategories(e);
      if (cats.includes(v)) {
        e.categories = cats.filter((x) => x !== v);
        if (e.categories.length === 0) delete e.categories;
        delete e.category;
        changed = true;
      }
    }
    if (kind === 'risk' && e.riskType === v) {
      e.riskType = '';
      changed = true;
    }
    if (kind === 'emotion' && Array.isArray(e.emotions)) {
      const next = e.emotions.filter((x) => x !== v);
      if (next.length !== e.emotions.length) {
        e.emotions = next;
        changed = true;
      }
    }
  });
  if (changed) saveJournalEntries(entries);
}

function setJournalOptionColor(kind, label, colorKey) {
  const k = normalizeColorKey(colorKey);
  const opts = loadJournalOptions();
  if (kind === 'emotion') {
    if (!opts.emotionColors) opts.emotionColors = {};
    opts.emotionColors[label] = k;
  } else if (kind === 'risk') {
    if (!opts.riskColors) opts.riskColors = {};
    opts.riskColors[label] = k;
  } else if (kind === 'category') {
    if (!opts.categoryColors) opts.categoryColors = {};
    opts.categoryColors[label] = k;
  } else return;
  saveJournalOptions(opts);
}

function journalRefreshPillDisplaysInModal() {
  const risk = document.getElementById('journalEntryRisk')?.value || '';
  renderJournalCategoryChips();
  const rd = document.getElementById('journalRiskDisplay');
  if (rd) {
    if (!risk) {
      rd.textContent = 'Select…';
      rd.className = 'journal-prop-placeholder journal-prop-value-pill';
    } else {
      rd.textContent = risk;
      rd.className = journalOptionPillClass('risk', risk) + ' journal-prop-value-pill';
    }
  }
}

function normalizeJournalCategories(e) {
  if (!e || typeof e !== 'object') return [];
  if (Array.isArray(e.categories)) {
    return dedupeSorted(e.categories.map((x) => String(x).trim()).filter(Boolean));
  }
  const c = e.category != null ? String(e.category).trim() : '';
  return c ? [c] : [];
}

function normalizeJournalEntry(e) {
  if (!e || typeof e !== 'object') return e;
  const tags = Array.isArray(e.tags) ? e.tags : [];
  const emotions = Array.isArray(e.emotions) ? e.emotions : [];
  const categories = normalizeJournalCategories(e);
  return {
    ...e,
    title: e.title != null && String(e.title).trim() ? String(e.title).trim() : 'Daily Trade Log',
    categories,
    category: categories[0] != null ? String(categories[0]) : '',
    emotions,
    riskType: e.riskType != null ? String(e.riskType) : '',
    setupBefore: e.setupBefore != null ? String(e.setupBefore) : '',
    setupAfter: e.setupAfter != null ? String(e.setupAfter) : '',
    imageBefore: e.imageBefore != null ? e.imageBefore : null,
    imageAfter: e.imageAfter != null ? e.imageAfter : null,
    note: e.note != null ? String(e.note) : '',
    tags
  };
}

/** Pills for gallery: category, emotions, risk, legacy tags */
function journalEntryDisplayPills(e) {
  const n = normalizeJournalEntry({ ...e });
  const out = [];
  (n.categories || []).forEach((c) => out.push({ text: c, cls: journalOptionPillClass('category', c) }));
  (n.emotions || []).forEach((t) => out.push({ text: t, cls: journalOptionPillClass('emotion', t) }));
  if (n.riskType) out.push({ text: n.riskType, cls: journalOptionPillClass('risk', n.riskType) });
  (n.tags || []).forEach((t) => out.push({ text: t, cls: 'journal-tag-pill ' + journalTagClass(t) }));
  return out;
}

/** Notion palette — colors stored in journalOptions.*Colors or defaults. */
function journalOptionPillClass(kind, label) {
  if (!label) return 'journal-pill journal-palette-default';
  const opts = loadJournalOptions();
  let map = opts.emotionColors;
  if (kind === 'risk') map = opts.riskColors;
  if (kind === 'category') map = opts.categoryColors;
  const colorKey = normalizeColorKey((map && map[label]) || getDefaultColorKeyForOption(kind, label));
  return 'journal-pill journal-palette-' + colorKey;
}

function journalTagClass(tag) {
  const t = String(tag).toLowerCase();
  const palette = ['journal-tag-purple', 'journal-tag-grey', 'journal-tag-red', 'journal-tag-green', 'journal-tag-blue'];
  let h = 0;
  for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
}

function formatJournalDateDisplay(dateKey) {
  if (!dateKey) return '';
  const parts = dateKey.split('-').map(Number);
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) return dateKey;
  const dt = new Date(parts[0], parts[1] - 1, parts[2]);
  return dt.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function renderJournalOverview() {
  const grid = document.getElementById('journalGalleryGrid');
  const empty = document.getElementById('journalEmptyOverview');
  if (!grid) return;
  const entries = getJournalEntriesForStrategy(selectedStrategyId).sort((a, b) => {
    const dk = (b.dateKey || '').localeCompare(a.dateKey || '');
    if (dk !== 0) return dk;
    return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
  });
  grid.innerHTML = '';
  if (empty) empty.hidden = entries.length > 0;
  entries.forEach((e) => {
    const n = normalizeJournalEntry({ ...e });
    const card = document.createElement('article');
    card.className = 'journal-card';
    card.dataset.entryId = e.id;
    const thumb = document.createElement('div');
    thumb.className = 'journal-card-thumb';
    if (n.imageBefore && String(n.imageBefore).startsWith('data:')) {
      thumb.classList.add('journal-card-thumb-has-image');
      const img = document.createElement('img');
      img.className = 'journal-card-thumb-img';
      img.src = n.imageBefore;
      img.alt = '';
      thumb.appendChild(img);
    } else {
      thumb.innerHTML = '<span class="journal-card-thumb-icon" aria-hidden="true">📊</span>';
    }
    const body = document.createElement('div');
    body.className = 'journal-card-body';
    const h = document.createElement('h3');
    h.className = 'journal-card-title';
    h.textContent = n.title || 'Daily Trade Log';
    const tagsWrap = document.createElement('div');
    tagsWrap.className = 'journal-card-tags';
    const pills = journalEntryDisplayPills(e);
    pills.forEach((pill) => {
      const span = document.createElement('span');
      span.className = pill.cls;
      span.textContent = pill.text;
      tagsWrap.appendChild(span);
    });
    const timeEl = document.createElement('time');
    timeEl.className = 'journal-card-date';
    timeEl.dateTime = e.dateKey || '';
    timeEl.textContent = formatJournalDateDisplay(e.dateKey);
    body.appendChild(h);
    body.appendChild(tagsWrap);
    body.appendChild(timeEl);
    card.appendChild(thumb);
    card.appendChild(body);
    card.addEventListener('click', () => openJournalEntryModal(e.id));
    grid.appendChild(card);
  });
  const addCard = document.createElement('button');
  addCard.type = 'button';
  addCard.className = 'journal-card journal-card-new';
  addCard.innerHTML = '<span class="journal-card-new-inner"><span class="journal-card-new-plus">+</span><span>New entry</span></span>';
  addCard.addEventListener('click', () => openJournalEntryModal(null));
  grid.appendChild(addCard);
}

function renderJournalCalendar() {
  const grid = document.getElementById('journalCalGrid');
  const label = document.getElementById('journalCalMonthLabel');
  if (!grid) return;
  const year = journalLogMonth.getFullYear();
  const month = journalLogMonth.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDay = new Date(year, month, 1).getDay();
  const monthKeyPrefix = `${year}-${String(month + 1).padStart(2, '0')}-`;
  if (label) label.textContent = journalLogMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const entries = getJournalEntriesForStrategy(selectedStrategyId);
  const byDay = {};
  entries.forEach((e) => {
    if (!e.dateKey || !e.dateKey.startsWith(monthKeyPrefix)) return;
    const parts = e.dateKey.split('-');
    const day = parseInt(parts[2], 10);
    if (!day || Number.isNaN(day)) return;
    if (!byDay[day]) byDay[day] = [];
    byDay[day].push(e);
  });
  const today = new Date();
  const isTodayNum = (d) =>
    d === today.getDate() && month === today.getMonth() && year === today.getFullYear();
  grid.innerHTML = '';
  const headers = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
  headers.forEach((h) => {
    const el = document.createElement('div');
    el.className = 'journal-cal-day-header';
    el.textContent = h;
    grid.appendChild(el);
  });
  for (let i = 0; i < firstDay; i++) {
    const cell = document.createElement('div');
    cell.className = 'journal-cal-cell journal-cal-cell-empty';
    grid.appendChild(cell);
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const cell = document.createElement('div');
    cell.className = 'journal-cal-cell';
    if (isTodayNum(d)) cell.classList.add('is-today');
    const num = document.createElement('span');
    num.className = 'journal-cal-day-num';
    num.textContent = String(d);
    cell.appendChild(num);
    const list = byDay[d] || [];
    list.forEach((e) => {
      const pill = document.createElement('button');
      pill.type = 'button';
      pill.className = 'journal-cal-entry';
      const t = e.title || 'Untitled';
      pill.textContent = t.length > 24 ? t.slice(0, 22) + '…' : t;
      pill.title = t;
      pill.addEventListener('click', (ev) => {
        ev.stopPropagation();
        openJournalEntryModal(e.id);
      });
      cell.appendChild(pill);
    });
    cell.addEventListener('click', () => {
      const key = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      openJournalEntryModal(null, key);
    });
    grid.appendChild(cell);
  }
}

function switchJournalView(view) {
  const overview = document.getElementById('journalPanelOverview');
  const cal = document.getElementById('journalPanelCalendar');
  const tabO = document.getElementById('journalTabOverview');
  const tabC = document.getElementById('journalTabCalendar');
  if (view === 'calendar') {
    overview?.classList.remove('is-active');
    overview?.setAttribute('hidden', '');
    cal?.classList.add('is-active');
    cal?.removeAttribute('hidden');
    tabO?.classList.remove('active');
    tabO?.setAttribute('aria-selected', 'false');
    tabC?.classList.add('active');
    tabC?.setAttribute('aria-selected', 'true');
    renderJournalCalendar();
  } else {
    cal?.classList.remove('is-active');
    cal?.setAttribute('hidden', '');
    overview?.classList.add('is-active');
    overview?.removeAttribute('hidden');
    tabC?.classList.remove('active');
    tabC?.setAttribute('aria-selected', 'false');
    tabO?.classList.add('active');
    tabO?.setAttribute('aria-selected', 'true');
    renderJournalOverview();
  }
}

function closeJournalOptionEditor() {
  // Persist rename on any close path (outside click, Escape, opening another surface) — blur alone can lose the race.
  commitJournalOptionRename();
  const pop = document.getElementById('journalOptionEditPop');
  if (pop) pop.hidden = true;
  journalOptionEditKind = null;
  journalOptionEditLabel = null;
  journalOptionEditAnchorEl = null;
}

function positionJournalOptionEditor(anchor) {
  const pop = document.getElementById('journalOptionEditPop');
  if (!pop || !anchor) return;
  const r = anchor.getBoundingClientRect();
  const w = Math.min(300, window.innerWidth - 24);
  let left = r.right - w;
  if (left < 8) left = r.left;
  if (left + w > window.innerWidth - 8) left = window.innerWidth - w - 8;
  let top = r.bottom + 6;
  if (top + 360 > window.innerHeight - 8) top = Math.max(8, r.top - 360);
  pop.style.position = 'fixed';
  pop.style.left = left + 'px';
  pop.style.top = top + 'px';
  pop.style.width = w + 'px';
  pop.style.zIndex = '10060';
}

function renderJournalOptionEditColors() {
  const ul = document.getElementById('journalOptionEditColorList');
  if (!ul || !journalOptionEditKind || journalOptionEditLabel == null) return;
  const opts = loadJournalOptions();
  let map = opts.emotionColors;
  if (journalOptionEditKind === 'risk') map = opts.riskColors;
  if (journalOptionEditKind === 'category') map = opts.categoryColors;
  const current = normalizeColorKey((map && map[journalOptionEditLabel]) || getDefaultColorKeyForOption(journalOptionEditKind, journalOptionEditLabel));
  const names = {
    default: 'Default',
    gray: 'Gray',
    brown: 'Brown',
    orange: 'Orange',
    yellow: 'Yellow',
    green: 'Green',
    blue: 'Blue',
    purple: 'Purple',
    pink: 'Pink',
    red: 'Red'
  };
  ul.innerHTML = '';
  JOURNAL_NOTION_PALETTE.forEach((key) => {
    const li = document.createElement('li');
    li.className = 'journal-option-edit-color-row';
    li.setAttribute('role', 'option');
    li.setAttribute('aria-selected', key === current ? 'true' : 'false');
    if (key === current) li.classList.add('is-selected');
    li.dataset.color = key;
    const sw = document.createElement('span');
    sw.className = 'journal-option-edit-swatch journal-palette-swatch-' + key;
    const nm = document.createElement('span');
    nm.className = 'journal-option-edit-color-name';
    nm.textContent = names[key] || key;
    const chk = document.createElement('span');
    chk.className = 'journal-option-edit-check';
    chk.textContent = key === current ? '✓' : '';
    chk.setAttribute('aria-hidden', 'true');
    li.appendChild(sw);
    li.appendChild(nm);
    li.appendChild(chk);
    li.addEventListener('click', () => {
      setJournalOptionColor(journalOptionEditKind, journalOptionEditLabel, key);
      renderJournalOptionEditColors();
      renderJournalPickerList();
      renderJournalEmotionChips();
      journalRefreshPillDisplaysInModal();
      renderJournalOverview();
    });
    ul.appendChild(li);
  });
}

function openJournalOptionEditor(kind, label, anchorEl) {
  closeJournalPickerPop();
  journalOptionEditKind = kind;
  journalOptionEditLabel = label;
  journalOptionEditAnchorEl = anchorEl;
  const pop = document.getElementById('journalOptionEditPop');
  const input = document.getElementById('journalOptionEditInput');
  if (!pop || !input) return;
  input.value = label;
  renderJournalOptionEditColors();
  pop.hidden = false;
  positionJournalOptionEditor(anchorEl || journalPickerAnchorEl);
  setTimeout(() => {
    input.focus();
    input.select();
  }, 0);
}

function commitJournalOptionRename() {
  const input = document.getElementById('journalOptionEditInput');
  if (!input || !journalOptionEditKind || journalOptionEditLabel == null) return;
  const newLabel = input.value.trim();
  const oldLabel = journalOptionEditLabel;
  if (newLabel === oldLabel) return;
  if (!newLabel) {
    input.value = oldLabel;
    return;
  }
  renameJournalOptionInStorage(journalOptionEditKind, oldLabel, newLabel);
  renderJournalOptionEditColors();
  renderJournalPickerList();
  renderJournalEmotionChips();
  journalRefreshPillDisplaysInModal();
  renderJournalOverview();
}

function deleteJournalOptionFromEditor() {
  if (!journalOptionEditKind || journalOptionEditLabel == null) return;
  commitJournalOptionRename();
  if (!journalOptionEditKind || journalOptionEditLabel == null) return;
  deleteJournalOptionFromStorage(journalOptionEditKind, journalOptionEditLabel);
  closeJournalOptionEditor();
  renderJournalPickerList();
  renderJournalEmotionChips();
  journalRefreshPillDisplaysInModal();
  renderJournalOverview();
}

function closeJournalPickerPop() {
  const pop = document.getElementById('journalPickerPop');
  if (pop) pop.hidden = true;
  journalPickerKind = null;
  journalPickerAnchorEl = null;
  document.querySelectorAll('.journal-prop-trigger[aria-expanded="true"]').forEach((b) => b.setAttribute('aria-expanded', 'false'));
}

function positionJournalPicker(anchor) {
  const pop = document.getElementById('journalPickerPop');
  if (!pop || !anchor) return;
  const r = anchor.getBoundingClientRect();
  const w = Math.min(320, window.innerWidth - 24);
  let left = r.left;
  if (left + w > window.innerWidth - 8) left = window.innerWidth - w - 8;
  if (left < 8) left = 8;
  let top = r.bottom + 4;
  const ph = 280;
  if (top + ph > window.innerHeight - 8) top = Math.max(8, r.top - ph - 4);
  pop.style.position = 'fixed';
  pop.style.left = left + 'px';
  pop.style.top = top + 'px';
  pop.style.width = w + 'px';
  pop.style.zIndex = '10050';
}

function journalPickerOptionsForKind() {
  const o = loadJournalOptions();
  if (journalPickerKind === 'category') return o.categories;
  if (journalPickerKind === 'emotion') return o.emotions;
  if (journalPickerKind === 'risk') return o.riskTypes;
  return [];
}

function journalPickerExactMatchExists(qLower) {
  if (!qLower) return true;
  return journalPickerOptionsForKind().some((x) => String(x).toLowerCase() === qLower);
}

/** True when the Create button would be visible (new option name, non-empty). */
function journalPickerCanCreateFromSearch() {
  const searchEl = document.getElementById('journalPickerSearch');
  if (!searchEl || !journalPickerKind) return false;
  const rawQ = String(searchEl.value || '').trim();
  if (!rawQ) return false;
  return !journalPickerExactMatchExists(rawQ.toLowerCase());
}

function renderJournalPickerList() {
  const searchEl = document.getElementById('journalPickerSearch');
  const ul = document.getElementById('journalPickerList');
  const createBtn = document.getElementById('journalPickerCreateBtn');
  if (!ul || !createBtn || !journalPickerKind) return;
  const rawQ = (searchEl && searchEl.value) || '';
  const qLower = rawQ.trim().toLowerCase();
  const all = journalPickerOptionsForKind();
  const filtered = !qLower ? all : all.filter((x) => String(x).toLowerCase().includes(qLower));
  ul.innerHTML = '';
  filtered.forEach((val) => {
    const li = document.createElement('li');
    li.className = 'journal-picker-li';
    li.dataset.value = val;
    if (journalPickerKind === 'emotion' && journalDraftEmotions.includes(val)) li.classList.add('is-selected');
    if (
      journalPickerKind === 'category' &&
      journalDraftCategories.some((x) => x.toLowerCase() === String(val).toLowerCase())
    ) {
      li.classList.add('is-selected');
    }
    const grip = document.createElement('span');
    grip.className = 'journal-picker-grip';
    grip.setAttribute('aria-hidden', 'true');
    grip.textContent = '⋮⋮';
    const label = document.createElement('span');
    if (journalPickerKind === 'emotion') {
      label.className = journalOptionPillClass('emotion', val);
      label.textContent = val;
    } else if (journalPickerKind === 'risk') {
      label.className = journalOptionPillClass('risk', val);
      label.textContent = val;
    } else {
      label.className = journalOptionPillClass('category', val);
      label.textContent = val;
    }
    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'journal-picker-option-edit';
    editBtn.setAttribute('aria-label', 'Edit option');
    editBtn.innerHTML =
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>';
    editBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openJournalOptionEditor(journalPickerKind, val, editBtn);
    });
    li.appendChild(grip);
    li.appendChild(label);
    li.appendChild(editBtn);
    ul.appendChild(li);
  });
  const canCreate = rawQ.trim().length > 0 && !journalPickerExactMatchExists(qLower);
  createBtn.hidden = !canCreate;
  createBtn.textContent = 'Create "' + rawQ.trim() + '"';
}

function toggleJournalCategory(val) {
  const v = String(val || '').trim();
  if (!v) return;
  const idx = journalDraftCategories.findIndex((x) => x.toLowerCase() === v.toLowerCase());
  if (idx >= 0) journalDraftCategories = journalDraftCategories.filter((_, i) => i !== idx);
  else {
    journalDraftCategories.push(v);
    journalDraftCategories = dedupeSorted(journalDraftCategories);
  }
  renderJournalCategoryChips();
}

function renderJournalCategoryChips() {
  const container = document.getElementById('journalCategoryChips');
  if (!container) return;
  container.innerHTML = '';
  journalDraftCategories.forEach((cat) => {
    const wrap = document.createElement('span');
    wrap.className = 'journal-emotion-chip-wrap';
    const pill = document.createElement('span');
    pill.className = journalOptionPillClass('category', cat);
    pill.textContent = cat;
    const rm = document.createElement('button');
    rm.type = 'button';
    rm.className = 'journal-emotion-chip-remove';
    rm.setAttribute('aria-label', 'Remove ' + cat);
    rm.textContent = '×';
    rm.addEventListener('click', (ev) => {
      ev.stopPropagation();
      journalDraftCategories = journalDraftCategories.filter((x) => x !== cat);
      renderJournalCategoryChips();
    });
    wrap.appendChild(pill);
    wrap.appendChild(rm);
    container.appendChild(wrap);
  });
}

function applyJournalRisk(val) {
  const h = document.getElementById('journalEntryRisk');
  if (h) h.value = val || '';
  journalRefreshPillDisplaysInModal();
}

function toggleJournalEmotion(val) {
  if (journalDraftEmotions.includes(val)) journalDraftEmotions = journalDraftEmotions.filter((x) => x !== val);
  else journalDraftEmotions.push(val);
  renderJournalEmotionChips();
}

function renderJournalEmotionChips() {
  const container = document.getElementById('journalEmotionChips');
  if (!container) return;
  container.innerHTML = '';
  journalDraftEmotions.forEach((em) => {
    const wrap = document.createElement('span');
    wrap.className = 'journal-emotion-chip-wrap';
    const pill = document.createElement('span');
    pill.className = journalOptionPillClass('emotion', em);
    pill.textContent = em;
    const rm = document.createElement('button');
    rm.type = 'button';
    rm.className = 'journal-emotion-chip-remove';
    rm.setAttribute('aria-label', 'Remove ' + em);
    rm.textContent = '×';
    rm.addEventListener('click', (ev) => {
      ev.stopPropagation();
      journalDraftEmotions = journalDraftEmotions.filter((x) => x !== em);
      renderJournalEmotionChips();
    });
    wrap.appendChild(pill);
    wrap.appendChild(rm);
    container.appendChild(wrap);
  });
}

function openJournalPicker(kind, anchorEl) {
  document.querySelectorAll('.journal-prop-trigger[aria-expanded="true"]').forEach((b) => b.setAttribute('aria-expanded', 'false'));
  journalPickerKind = kind;
  journalPickerAnchorEl = anchorEl;
  const pop = document.getElementById('journalPickerPop');
  const searchEl = document.getElementById('journalPickerSearch');
  if (!pop || !searchEl || !anchorEl) return;
  searchEl.value = '';
  pop.hidden = false;
  anchorEl.setAttribute('aria-expanded', 'true');
  renderJournalPickerList();
  positionJournalPicker(anchorEl);
  searchEl.focus();
}

function setJournalImageSlot(slot, dataUrl) {
  journalImageDraft[slot] = dataUrl || null;
  const prev = document.getElementById(slot === 'before' ? 'journalImageBeforePreview' : 'journalImageAfterPreview');
  const img = document.getElementById(slot === 'before' ? 'journalImageBeforeImg' : 'journalImageAfterImg');
  const btn = document.getElementById(slot === 'before' ? 'journalImageBeforeBtn' : 'journalImageAfterBtn');
  if (!prev || !img || !btn) return;
  if (dataUrl) {
    prev.hidden = false;
    btn.hidden = true;
    img.src = dataUrl;
  } else {
    prev.hidden = true;
    btn.hidden = false;
    img.removeAttribute('src');
  }
}

function journalReadFileToSlot(slot, file) {
  if (!file || !file.type.startsWith('image/')) return;
  if (file.size > JOURNAL_IMAGE_MAX_BYTES) {
    alert('Image must be under 2.5 MB.');
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    const d = reader.result;
    if (typeof d === 'string') setJournalImageSlot(slot, d);
  };
  reader.readAsDataURL(file);
}

function journalPickerCreateFromSearch() {
  const searchEl = document.getElementById('journalPickerSearch');
  const raw = searchEl && searchEl.value ? searchEl.value.trim() : '';
  if (!raw || !journalPickerKind) return;
  if (journalPickerKind === 'category') {
    ensureJournalOption('category', raw);
    if (!journalDraftCategories.some((x) => x.toLowerCase() === raw.toLowerCase())) journalDraftCategories.push(raw);
    journalDraftCategories = dedupeSorted(journalDraftCategories);
    renderJournalCategoryChips();
    closeJournalPickerPop();
  } else if (journalPickerKind === 'risk') {
    ensureJournalOption('risk', raw);
    applyJournalRisk(raw);
    closeJournalPickerPop();
  } else if (journalPickerKind === 'emotion') {
    ensureJournalOption('emotion', raw);
    if (!journalDraftEmotions.includes(raw)) journalDraftEmotions.push(raw);
    renderJournalEmotionChips();
    closeJournalPickerPop();
  }
}

function openJournalEntryModal(editId, presetDateKey) {
  const modal = document.getElementById('journalEntryModal');
  const dateInput = document.getElementById('journalEntryDate');
  const titleInput = document.getElementById('journalEntryTitle');
  const noteInput = document.getElementById('journalEntryNote');
  const setupBefore = document.getElementById('journalSetupBefore');
  const setupAfter = document.getElementById('journalSetupAfter');
  const editIdInput = document.getElementById('journalEntryEditId');
  const deleteBtn = document.getElementById('journalEntryDeleteBtn');
  const err = document.getElementById('journalEntryModalError');
  if (!modal) return;
  closeJournalPickerPop();
  closeJournalOptionEditor();
  if (err) {
    err.hidden = true;
    err.textContent = '';
  }
  journalEntryEditId = editId || null;
  if (editId) {
    const raw = loadJournalEntries().find((x) => x.id === editId);
    const e = raw ? normalizeJournalEntry(raw) : null;
    if (dateInput) dateInput.value = e?.dateKey || '';
    if (titleInput) titleInput.value = e?.title || 'Daily Trade Log';
    if (noteInput) noteInput.value = e?.note || '';
    if (setupBefore) setupBefore.value = e?.setupBefore || '';
    if (setupAfter) setupAfter.value = e?.setupAfter || '';
    if (editIdInput) editIdInput.value = editId;
    if (deleteBtn) deleteBtn.hidden = false;
    journalDraftCategories = [...normalizeJournalCategories(e)];
    renderJournalCategoryChips();
    applyJournalRisk(e?.riskType || '');
    if (e && (!e.emotions || e.emotions.length === 0) && Array.isArray(e.tags) && e.tags.length > 0) {
      journalDraftEmotions = [...e.tags];
    } else {
      journalDraftEmotions = [...(e?.emotions || [])];
    }
    renderJournalEmotionChips();
    setJournalImageSlot('before', e?.imageBefore || null);
    setJournalImageSlot('after', e?.imageAfter || null);
  } else {
    const dk = presetDateKey || formatDateKey(new Date());
    if (dateInput) dateInput.value = dk;
    if (titleInput) titleInput.value = 'Daily Trade Log';
    if (noteInput) noteInput.value = '';
    if (setupBefore) setupBefore.value = '';
    if (setupAfter) setupAfter.value = '';
    if (editIdInput) editIdInput.value = '';
    if (deleteBtn) deleteBtn.hidden = true;
    journalDraftCategories = [];
    renderJournalCategoryChips();
    applyJournalRisk('');
    journalDraftEmotions = [];
    renderJournalEmotionChips();
    setJournalImageSlot('before', null);
    setJournalImageSlot('after', null);
  }
  modal.hidden = false;
}

function closeJournalEntryModal() {
  const modal = document.getElementById('journalEntryModal');
  closeJournalPickerPop();
  closeJournalOptionEditor();
  if (modal) modal.hidden = true;
  journalEntryEditId = null;
}

function saveJournalEntryFromModal() {
  const dateInput = document.getElementById('journalEntryDate');
  const titleInput = document.getElementById('journalEntryTitle');
  const noteInput = document.getElementById('journalEntryNote');
  const setupBefore = document.getElementById('journalSetupBefore');
  const setupAfter = document.getElementById('journalSetupAfter');
  const editIdInput = document.getElementById('journalEntryEditId');
  const err = document.getElementById('journalEntryModalError');
  const dateKey = dateInput?.value?.trim();
  const title = String(titleInput?.value || '').trim() || 'Daily Trade Log';
  const categories = dedupeSorted([...journalDraftCategories]);
  const riskType = String(document.getElementById('journalEntryRisk')?.value || '').trim();
  const emotions = [...journalDraftEmotions];
  const note = String(noteInput?.value || '').trim();
  const sb = String(setupBefore?.value || '').trim();
  const sa = String(setupAfter?.value || '').trim();
  if (!dateKey) {
    if (err) {
      err.textContent = 'Please pick a date.';
      err.hidden = false;
    }
    return;
  }
  categories.forEach((c) => ensureJournalOption('category', c));
  if (riskType) ensureJournalOption('risk', riskType);
  emotions.forEach((em) => ensureJournalOption('emotion', em));
  let entries = loadJournalEntries();
  const editId = editIdInput?.value || journalEntryEditId;
  const base = {
    dateKey,
    title,
    categories,
    category: categories[0] || '',
    emotions,
    riskType,
    setupBefore: sb,
    setupAfter: sa,
    imageBefore: journalImageDraft.before,
    imageAfter: journalImageDraft.after,
    note,
    strategyId: selectedStrategyId
  };
  if (editId) {
    const idx = entries.findIndex((x) => x.id === editId);
    if (idx >= 0) {
      const prev = entries[idx];
      entries[idx] = {
        ...prev,
        ...base,
        tags: Array.isArray(prev.tags) ? prev.tags : []
      };
    }
  } else {
    const id =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : 'j' + Date.now() + Math.random().toString(36).slice(2);
    entries.push({
      id,
      ...base,
      tags: [],
      createdAt: new Date().toISOString()
    });
  }
  saveJournalEntries(entries);
  closeJournalEntryModal();
  renderDailyLogScreen();
}

function deleteJournalEntryFromModal() {
  const editIdInput = document.getElementById('journalEntryEditId');
  const id = editIdInput?.value || journalEntryEditId;
  if (!id) return;
  const entries = loadJournalEntries().filter((x) => x.id !== id);
  saveJournalEntries(entries);
  closeJournalEntryModal();
  renderDailyLogScreen();
}

function journalPrevMonth() {
  journalLogMonth.setMonth(journalLogMonth.getMonth() - 1);
  renderJournalCalendar();
}

function journalNextMonth() {
  journalLogMonth.setMonth(journalLogMonth.getMonth() + 1);
  renderJournalCalendar();
}

function journalGoToday() {
  const now = new Date();
  journalLogMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  renderJournalCalendar();
}

function renderDailyLogScreen() {
  renderJournalOverview();
  renderJournalCalendar();
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
  if (screenId === 'dailylog') renderDailyLogScreen();
  if (screenId === 'analytics' && typeof window.renderAnalytics === 'function') window.renderAnalytics();
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
          if (data.totalR > 0) cell.classList.add('profit');
          else if (data.totalR < 0) cell.classList.add('loss');
          else cell.classList.add('breakeven');
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
  syncCalendarUserBio();
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
  const modal = document.getElementById('logModal');
  const title = document.getElementById('logModalTitle');
  const outcomeSection = document.getElementById('logModalOutcome');
  const comparisonLine = document.getElementById('logModalComparison');
  title.textContent = logModalTargetDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const instrumentLabel = document.getElementById('logModalInstrument');
  if (instrumentLabel) instrumentLabel.textContent = 'Logging for ' + selectedInstrument;
  if (outcomeSection) outcomeSection.hidden = false;
  renderLogModalROptions();
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

/**
 * Trade count for logging: legacy integer rules for ±1R/±2R only; other outcomes default to 1 trade.
 * Custom fractional R always uses 1 trade.
 */
function tradeCountForOutcome(totalR) {
  const n = Number(totalR);
  if (!Number.isFinite(n)) return 1;
  if (!Number.isInteger(n)) return 1;
  if (n === 2 || n === -2) return n === 2 ? 1 : 2;
  if (n === 1 || n === -1) return n === 1 ? 2 : 1;
  return 1;
}

function saveOutcomeFromModal(r) {
  if (!logModalTargetDate) return;
  const key = formatDateKey(logModalTargetDate);
  const totalR = parseFloat(String(r));
  if (!Number.isFinite(totalR)) return;
  const tradeCount = tradeCountForOutcome(totalR);
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
      // Single source of truth: Supabase. Local-only rows are uploaded first, then cache = DB snapshot.
      const localResults = loadDailyResults();
      const localDeclarations = loadDeclarations();
      const remoteResults = await fetchDailyResultsFromSupabase(currentUser.id);
      const remoteDeclarations = await fetchDeclarationsFromSupabase(currentUser.id);
      dailyResults = await mergeDailyResultsCloudFirst(remoteResults, localResults, currentUser.id);
      declarations = await mergeDeclarationsCloudFirst(remoteDeclarations, localDeclarations, currentUser.id);
      saveDailyResults(dailyResults);
      saveDeclarations(declarations);
      const ssotDr = await fetchDailyResultsFromSupabase(currentUser.id);
      const ssotDec = await fetchDeclarationsFromSupabase(currentUser.id);
      dailyResults = deepCloneData(ssotDr);
      declarations = deepCloneData(ssotDec);
      saveDailyResults(dailyResults);
      saveDeclarations(declarations);

      currentProfile = await fetchCurrentProfile(currentUser.id);
      if (currentProfile?.journal_options != null && typeof currentProfile.journal_options === 'object' && !Array.isArray(currentProfile.journal_options)) {
        const replaced = journalOptionsFromRemoteProfileOnly(currentProfile.journal_options);
        if (replaced) saveJournalOptions(replaced, { skipSync: true });
      }
      if (currentProfile?.log_r_options != null) {
        const lr = logROptionsFromRemoteProfileOnly(currentProfile.log_r_options);
        if (lr) saveLogROptions(lr, { skipSync: true });
      }

      const localStrategies = loadStrategies();
      const localDefault = localStrategies.find((s) => s.id === STRATEGY_DEFAULT_ID);
      const defaultName =
        (currentProfile?.default_strategy_name && String(currentProfile.default_strategy_name).trim()) ||
        (currentUser?.user_metadata?.default_strategy_name && String(currentUser.user_metadata.default_strategy_name).trim()) ||
        localDefault?.name ||
        'Default';

      let remoteList = (await fetchStrategiesFromSupabase(currentUser.id)) || [];
      if (!Array.isArray(remoteList)) remoteList = [];

      const supaSync = initSupabase();
      if (supaSync && currentUser) {
        const remoteIds = new Set(remoteList.map((r) => r.id));
        for (const s of localStrategies) {
          if (s.id === STRATEGY_DEFAULT_ID || !/^[0-9a-f-]{36}$/i.test(s.id)) continue;
          if (!remoteIds.has(s.id)) {
            const { error } = await supaSync.from('strategies').upsert(
              { id: s.id, user_id: currentUser.id, name: s.name },
              { onConflict: 'id' }
            );
            if (error) console.error('[Tagverse] sync missing strategy to Supabase', s.id, error.message);
          }
        }
        const refreshed = await fetchStrategiesFromSupabase(currentUser.id);
        remoteList = Array.isArray(refreshed) ? refreshed : [];
      }

      if (remoteList.length > 0) {
        const hasDefaultRemote = remoteList.some((s) => s.id === STRATEGY_DEFAULT_ID || s.name === 'Default');
        const base = hasDefaultRemote ? remoteList : [{ id: STRATEGY_DEFAULT_ID, name: defaultName }, ...remoteList];
        strategies = base.map((s) => {
          if (s.id === STRATEGY_DEFAULT_ID) return { ...s, name: defaultName };
          return { ...s };
        });
      } else {
        strategies = [{ id: STRATEGY_DEFAULT_ID, name: defaultName }];
      }

      saveStrategies(strategies);
    } else {
      dailyResults = loadDailyResults();
      declarations = loadDeclarations();
      strategies = loadStrategies();
      currentProfile = null;
    }
    if (currentUser && currentProfile?.calendar_preferences?.strategyId) {
      const sidNeed = currentProfile.calendar_preferences.strategyId;
      if (typeof sidNeed === 'string' && sidNeed !== STRATEGY_DEFAULT_ID && !strategies.some((s) => s.id === sidNeed)) {
        await ensureStrategyInListForUser(currentUser.id, sidNeed);
      }
    }
    selectedStrategyId = loadSelectedStrategyId();
    if (!strategies.some((s) => s.id === selectedStrategyId)) selectedStrategyId = strategies[0]?.id || STRATEGY_DEFAULT_ID;
    saveSelectedStrategyId(selectedStrategyId);
    if (currentUser && currentProfile) {
      const cal = applyCalendarPreferencesFromProfile(currentProfile, strategies);
      if (cal) {
        selectedInstrument = cal.instrument;
        selectedStrategyId = cal.strategyId;
        saveSelectedInstrument(selectedInstrument);
        saveSelectedStrategyId(selectedStrategyId);
      }
    }
    if (currentUser) {
      scheduleProfilePreferencesSync();
    }
    updateAuthUI();
    hydrateProfileSettings();
    if (typeof window.renderStrategyPills === 'function') window.renderStrategyPills();
    renderCalendar();
    renderDailyLogScreen();
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
    if (now - lastCloudRefreshAt < 500) return;
    lastCloudRefreshAt = now;
    applyAuthState();
  });
  window.addEventListener('pageshow', (e) => {
    if (e.persisted && currentUser) applyAuthState();
  });

  document.querySelectorAll('.nav-tab').forEach((tab) => {
    tab.addEventListener('click', () => showScreen(tab.dataset.screen));
  });

  document.getElementById('journalTabOverview')?.addEventListener('click', () => switchJournalView('overview'));
  document.getElementById('journalTabCalendar')?.addEventListener('click', () => switchJournalView('calendar'));
  document.getElementById('journalNewEntryBtn')?.addEventListener('click', () => openJournalEntryModal(null));
  document.getElementById('journalPrevMonth')?.addEventListener('click', journalPrevMonth);
  document.getElementById('journalNextMonth')?.addEventListener('click', journalNextMonth);
  document.getElementById('journalCalToday')?.addEventListener('click', journalGoToday);
  document.getElementById('journalEntryModalBackdrop')?.addEventListener('click', closeJournalEntryModal);
  document.getElementById('journalEntryCloseHeader')?.addEventListener('click', closeJournalEntryModal);
  document.getElementById('journalEntryCancelBtn')?.addEventListener('click', closeJournalEntryModal);
  document.getElementById('journalEntrySaveBtn')?.addEventListener('click', saveJournalEntryFromModal);
  document.getElementById('journalEntryDeleteBtn')?.addEventListener('click', deleteJournalEntryFromModal);

  document.getElementById('journalBtnPickCategory')?.addEventListener('click', (e) => {
    e.stopPropagation();
    openJournalPicker('category', document.getElementById('journalBtnPickCategory'));
  });
  document.getElementById('journalBtnPickEmotions')?.addEventListener('click', (e) => {
    e.stopPropagation();
    openJournalPicker('emotion', document.getElementById('journalBtnPickEmotions'));
  });
  document.getElementById('journalBtnPickRisk')?.addEventListener('click', (e) => {
    e.stopPropagation();
    openJournalPicker('risk', document.getElementById('journalBtnPickRisk'));
  });
  document.getElementById('journalPickerList')?.addEventListener('click', (e) => {
    if (e.target.closest('.journal-picker-option-edit')) return;
    const li = e.target.closest('.journal-picker-li');
    if (!li || !journalPickerKind) return;
    const val = li.dataset.value;
    if (!val) return;
    e.stopPropagation();
    if (journalPickerKind === 'emotion') {
      toggleJournalEmotion(val);
      renderJournalPickerList();
    } else if (journalPickerKind === 'category') {
      ensureJournalOption('category', val);
      toggleJournalCategory(val);
      renderJournalPickerList();
    } else if (journalPickerKind === 'risk') {
      ensureJournalOption('risk', val);
      applyJournalRisk(val);
      closeJournalPickerPop();
    }
  });
  document.getElementById('journalPickerSearch')?.addEventListener('input', () => renderJournalPickerList());
  document.getElementById('journalPickerSearch')?.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    if (!journalPickerCanCreateFromSearch()) return;
    e.preventDefault();
    e.stopPropagation();
    journalPickerCreateFromSearch();
  });
  document.getElementById('journalPickerCreateBtn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    journalPickerCreateFromSearch();
  });
  document.getElementById('journalPickerPop')?.addEventListener('click', (e) => e.stopPropagation());

  document.getElementById('journalImageBeforeBtn')?.addEventListener('click', () => document.getElementById('journalImageBeforeInput')?.click());
  document.getElementById('journalImageAfterBtn')?.addEventListener('click', () => document.getElementById('journalImageAfterInput')?.click());
  document.getElementById('journalImageBeforeInput')?.addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    if (f) journalReadFileToSlot('before', f);
    e.target.value = '';
  });
  document.getElementById('journalImageAfterInput')?.addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    if (f) journalReadFileToSlot('after', f);
    e.target.value = '';
  });
  document.getElementById('journalImageBeforeRemove')?.addEventListener('click', (e) => {
    e.stopPropagation();
    setJournalImageSlot('before', null);
  });
  document.getElementById('journalImageAfterRemove')?.addEventListener('click', (e) => {
    e.stopPropagation();
    setJournalImageSlot('after', null);
  });

  document.getElementById('journalOptionEditDeleteBtn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    deleteJournalOptionFromEditor();
  });
  document.getElementById('journalOptionEditInput')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitJournalOptionRename();
    }
  });
  document.getElementById('journalOptionEditInput')?.addEventListener('blur', () => {
    setTimeout(() => {
      const ed = document.getElementById('journalOptionEditPop');
      if (!ed || ed.hidden || !journalOptionEditKind) return;
      if (document.activeElement && ed.contains(document.activeElement)) return;
      commitJournalOptionRename();
    }, 150);
  });
  document.getElementById('journalOptionEditPop')?.addEventListener('click', (e) => e.stopPropagation());

  document.addEventListener(
    'click',
    (e) => {
      const editPop = document.getElementById('journalOptionEditPop');
      if (editPop && !editPop.hidden) {
        if (e.target.closest('#journalOptionEditPop')) return;
        closeJournalOptionEditor();
        return;
      }
      const pop = document.getElementById('journalPickerPop');
      if (!pop || pop.hidden) return;
      if (e.target.closest('#journalPickerPop') || e.target.closest('.journal-prop-trigger')) return;
      closeJournalPickerPop();
    },
    true
  );
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const editPop = document.getElementById('journalOptionEditPop');
    if (editPop && !editPop.hidden) {
      closeJournalOptionEditor();
      e.preventDefault();
      return;
    }
    const pop = document.getElementById('journalPickerPop');
    if (pop && !pop.hidden) {
      closeJournalPickerPop();
      e.preventDefault();
    }
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
    const calendarContainer = document.getElementById('strategyPills');
    const journalSelect = document.getElementById('journalEntryStrategySelect');

    if (calendarContainer) {
      calendarContainer.innerHTML = '';
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
          calendarContainer.querySelectorAll('.strategy-pill').forEach((p) => {
            p.classList.toggle('selected', p.dataset.strategyId === selectedStrategyId);
            p.setAttribute('aria-pressed', p.dataset.strategyId === selectedStrategyId ? 'true' : 'false');
          });
          if (journalSelect) journalSelect.value = selectedStrategyId;
          renderCalendar();
          renderDailyLogScreen();
          if (typeof window.renderAnalytics === 'function') window.renderAnalytics();
          if (typeof window.renderCompareStrategies === 'function') window.renderCompareStrategies();
          scheduleProfilePreferencesSync();
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

        calendarContainer.appendChild(wrap);
      });
    }

    if (journalSelect) {
      journalSelect.innerHTML = '';
      strategies.forEach((s) => {
        const opt = document.createElement('option');
        opt.value = s.id;
        opt.textContent = s.name;
        journalSelect.appendChild(opt);
      });
      if (strategies.some((s) => s.id === selectedStrategyId)) {
        journalSelect.value = selectedStrategyId;
      } else if (strategies[0]) {
        selectedStrategyId = strategies[0].id;
        saveSelectedStrategyId(selectedStrategyId);
        journalSelect.value = selectedStrategyId;
      }
    }
  }
  window.renderStrategyPills = renderStrategyPills;

  document.getElementById('journalEntryStrategySelect')?.addEventListener('change', (e) => {
    const id = e.target.value;
    if (!id) return;
    selectedStrategyId = id;
    saveSelectedStrategyId(selectedStrategyId);
    renderStrategyPills();
    renderCalendar();
    renderDailyLogScreen();
    if (typeof window.renderAnalytics === 'function') window.renderAnalytics();
    if (typeof window.renderCompareStrategies === 'function') window.renderCompareStrategies();
    scheduleProfilePreferencesSync();
  });

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
    renderDailyLogScreen();
    if (typeof window.renderAnalytics === 'function') window.renderAnalytics();
    if (typeof window.renderCompareStrategies === 'function') window.renderCompareStrategies();
    scheduleProfilePreferencesSync();
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
  const settingsLogROptionsInput = document.getElementById('settingsLogROptions');
  const settingsSaveLogROptionsBtn = document.getElementById('settingsSaveLogROptions');
  const settingsResetLogROptionsBtn = document.getElementById('settingsResetLogROptions');
  const settingsLogROptionsMessage = document.getElementById('settingsLogROptionsMessage');

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
      let bio = clampBio(settingsBioInput?.value || '');
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
      if (settingsLogROptionsInput) {
        saveLogROptions(parseLogROptionsFromTextField(settingsLogROptionsInput.value), { skipSync: true });
      }
      const profilePayload = { username, bio: bio || null };
      if (currentProfile?.default_strategy_name != null && currentProfile.default_strategy_name !== '') {
        profilePayload.default_strategy_name = currentProfile.default_strategy_name;
      }
      profilePayload.journal_options = loadJournalOptions();
      profilePayload.log_r_options = loadLogROptions();
      profilePayload.calendar_preferences = buildCalendarPreferencesPayload();
      const { error } = await upsertProfile(currentUser.id, profilePayload);
      settingsSaveProfileBtn.disabled = false;
      if (error) {
        settingsProfileMessage.textContent = formatPostgrestError(error) || error.message || 'Could not save profile.';
        return;
      }
      if (settingsProfileMessage) settingsProfileMessage.textContent = 'Profile updated.';
      updateAuthUI();
      updateSettingsAvatarPreview();
      syncCalendarUserBio();
    });
  }

  if (settingsSaveLogROptionsBtn && settingsLogROptionsInput) {
    settingsSaveLogROptionsBtn.addEventListener('click', async () => {
      const parsed = parseLogROptionsFromTextField(settingsLogROptionsInput.value);
      saveLogROptions(parsed, { skipSync: true });
      hydrateLogROptionsSettings();
      renderLogModalROptions();
      if (!currentUser) {
        if (settingsLogROptionsMessage) settingsLogROptionsMessage.textContent = 'Saved on this device.';
        return;
      }
      settingsSaveLogROptionsBtn.disabled = true;
      if (settingsLogROptionsMessage) settingsLogROptionsMessage.textContent = '';
      let profile = currentProfile;
      if (!profile?.username) {
        if (settingsLogROptionsMessage) {
          settingsLogROptionsMessage.textContent = 'Set a username under Profile first so options can sync to the cloud.';
        }
        settingsSaveLogROptionsBtn.disabled = false;
        return;
      }
      const { error } = await upsertProfile(currentUser.id, {
        username: profile.username,
        bio: profile.bio ?? null,
        avatar_url: profile.avatar_url ?? null,
        default_strategy_name: profile.default_strategy_name ?? null,
        journal_options: loadJournalOptions(),
        log_r_options: loadLogROptions(),
        calendar_preferences: buildCalendarPreferencesPayload()
      });
      settingsSaveLogROptionsBtn.disabled = false;
      if (error) {
        if (settingsLogROptionsMessage) {
          settingsLogROptionsMessage.textContent = formatPostgrestError(error) || error.message || 'Could not sync.';
        }
        return;
      }
      if (settingsLogROptionsMessage) settingsLogROptionsMessage.textContent = 'Saved and synced.';
    });
  }

  if (settingsResetLogROptionsBtn) {
    settingsResetLogROptionsBtn.addEventListener('click', () => {
      saveLogROptions([...DEFAULT_LOG_R_VALUES], { skipSync: true });
      hydrateLogROptionsSettings();
      renderLogModalROptions();
      if (settingsLogROptionsMessage) {
        settingsLogROptionsMessage.textContent = currentUser
          ? 'Reset to default. Syncing to cloud…'
          : 'Reset to default on this device.';
      }
      if (currentUser) {
        void syncProfilePreferencesToSupabase().then(() => {
          if (settingsLogROptionsMessage) {
            settingsLogROptionsMessage.textContent = currentProfile?.username
              ? 'Reset to default and synced.'
              : 'Reset on this device. Save a username under Profile to sync.';
          }
        });
      }
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

  function onSettingsBioInput() {
    if (!settingsBioInput) return;
    const next = clampBioInputLength(settingsBioInput.value);
    if (next !== settingsBioInput.value) settingsBioInput.value = next;
  }

  function hydrateLogROptionsSettings() {
    if (!settingsLogROptionsInput) return;
    settingsLogROptionsInput.value = loadLogROptions().join(', ');
    if (settingsLogROptionsMessage) settingsLogROptionsMessage.textContent = '';
  }

  function hydrateProfileSettings() {
    if (!settingsUsernameInput || !settingsBioInput) return;
    if (!currentUser) {
      settingsUsernameInput.value = '';
      settingsBioInput.value = '';
      if (settingsProfileMessage) settingsProfileMessage.textContent = 'Sign in to edit your profile.';
      updateSettingsAvatarPreview();
      hydrateLogROptionsSettings();
      return;
    }
    settingsUsernameInput.value = currentProfile?.username || '';
    settingsBioInput.value = clampBioInputLength(
      String(currentProfile?.bio != null ? currentProfile.bio : '').trim()
    );
    if (settingsProfileMessage) settingsProfileMessage.textContent = '';
    updateSettingsAvatarPreview();
    hydrateLogROptionsSettings();
  }

  settingsUsernameInput?.addEventListener('input', () => updateSettingsAvatarPreview());
  settingsBioInput?.addEventListener('input', onSettingsBioInput);

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
      scheduleProfilePreferencesSync();
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
  document.getElementById('logModalROptions')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.r-option[data-r]');
    if (!btn) return;
    saveOutcomeFromModal(btn.getAttribute('data-r'));
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

  document.getElementById('shareGenerateBtn')?.addEventListener('click', () => {
    const periodVal = document.getElementById('sharePeriod')?.value || 'month';
    const { token } = buildSnapshotTokenForPeriod(periodVal);
    const base = window.location.origin + window.location.pathname.replace(/index\.html?$/, '');
    const link = (base.endsWith('/') ? base : base + '/') + 'share.html?t=' + encodeURIComponent(token);
    const linkBox = document.getElementById('shareLinkBox');
    const input = document.getElementById('shareLinkInput');
    if (input) input.value = link;
    if (linkBox) linkBox.hidden = false;
  });

  document.getElementById('shareCopyBtn')?.addEventListener('click', () => {
    const input = document.getElementById('shareLinkInput');
    if (input) {
      input.select();
      document.execCommand('copy');
    }
  });

  document.getElementById('settingsSyncCalendarBtn')?.addEventListener('click', async () => {
    const msg = document.getElementById('settingsSyncCalendarMessage');
    const btn = document.getElementById('settingsSyncCalendarBtn');
    if (!currentUser) {
      if (msg) msg.textContent = 'Sign in first.';
      return;
    }
    if (btn) btn.disabled = true;
    if (msg) msg.textContent = 'Syncing…';
    try {
      await applyAuthState();
      if (msg) msg.textContent = 'Calendar updated.';
    } catch (_) {
      if (msg) msg.textContent = 'Could not sync. Check connection.';
    }
    if (btn) btn.disabled = false;
    window.setTimeout(() => {
      if (msg) msg.textContent = '';
    }, 3500);
  });

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
});
