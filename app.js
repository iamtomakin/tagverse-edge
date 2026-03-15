/**
 * Tagverse Edge — Calendar, declarations, log modal, analytics, share, settings
 */

const STORAGE_KEYS = { dailyResults: 'tagverse_daily_results', declarations: 'tagverse_declarations', theme: 'tagverse_theme', shareTokens: 'tagverse_share_tokens', selectedInstrument: 'tagverse_selected_instrument', mode: 'tagverse_mode' };

const MODES = { BACKTEST: 'backtest', LIVE: 'live' };

// Supabase config: replace with your own values from Supabase project settings.
const SUPABASE_URL = window.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = window.SUPABASE_ANON_KEY || '';

let supabaseClient = null;
let currentUser = null;
let currentMode = MODES.LIVE;

function isSupabaseEnabled() {
  return typeof window.supabase !== 'undefined' && SUPABASE_URL && SUPABASE_ANON_KEY;
}

function initSupabase() {
  if (!isSupabaseEnabled()) return null;
  if (!supabaseClient) {
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  return supabaseClient;
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
      if (typeof parsed === 'object' && parsed !== null && Object.keys(parsed).length > 0) {
        const migrated = migrateDailyResults(parsed);
        if (migrated !== parsed) saveDailyResults(migrated);
        return migrated;
      }
      return getInitialDailyResults();
    }
  } catch (_) {}
  return getInitialDailyResults();
}

function loadDeclarations() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.declarations);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (typeof parsed === 'object' && parsed !== null) {
        const migrated = migrateDeclarations(parsed);
        if (migrated !== parsed) saveDeclarations(migrated);
        return migrated;
      }
      return {};
    }
  } catch (_) {}
  return {};
}

function saveDailyResults(data) {
  try {
    localStorage.setItem(STORAGE_KEYS.dailyResults, JSON.stringify(data));
  } catch (_) {}
}

function saveDeclarations(data) {
  try {
    localStorage.setItem(STORAGE_KEYS.declarations, JSON.stringify(data));
  } catch (_) {}
}

async function fetchDailyResultsFromSupabase(userId) {
  const supa = initSupabase();
  if (!supa) return {};
  const { data: rows, error } = await supa.from('daily_results').select('date_key, instrument, total_r, trade_count, trade_1_r').eq('user_id', userId);
  if (error) return {};
  const out = {};
  (rows || []).forEach((r) => {
    if (!out[r.date_key]) out[r.date_key] = {};
    out[r.date_key][r.instrument] = { totalR: r.total_r, tradeCount: r.trade_count };
    if (r.trade_1_r != null) out[r.date_key][r.instrument].trade_1_r = r.trade_1_r;
  });
  return out;
}

async function fetchDeclarationsFromSupabase(userId) {
  const supa = initSupabase();
  if (!supa) return {};
  const { data: rows, error } = await supa.from('declarations').select('date_key, instrument, trade_count_planned, created_at').eq('user_id', userId);
  if (error) return {};
  const out = {};
  (rows || []).forEach((r) => {
    if (!out[r.date_key]) out[r.date_key] = {};
    out[r.date_key][r.instrument] = { tradeCountPlanned: r.trade_count_planned, createdAt: r.created_at };
  });
  return out;
}

async function persistDayResultToSupabase(userId, dateKey, instrument, entry) {
  const supa = initSupabase();
  if (!supa) return;
  await supa.from('daily_results').upsert(
    {
      user_id: userId,
      date_key: dateKey,
      instrument,
      total_r: entry.totalR,
      trade_count: entry.tradeCount,
      trade_1_r: entry.trade_1_r ?? null
    },
    { onConflict: 'user_id,date_key,instrument' }
  );
}

async function persistDeclarationToSupabase(userId, dateKey, instrument, tradeCountPlanned, createdAt) {
  const supa = initSupabase();
  if (!supa) return;
  await supa.from('declarations').upsert(
    {
      user_id: userId,
      date_key: dateKey,
      instrument,
      trade_count_planned: tradeCountPlanned,
      created_at: createdAt
    },
    { onConflict: 'user_id,date_key,instrument' }
  );
}

async function deleteDayResultFromSupabase(userId, dateKey, instrument) {
  const supa = initSupabase();
  if (!supa) return;
  await supa.from('daily_results').delete().eq('user_id', userId).eq('date_key', dateKey).eq('instrument', instrument);
}

async function deleteDeclarationFromSupabase(userId, dateKey, instrument) {
  const supa = initSupabase();
  if (!supa) return;
  await supa.from('declarations').delete().eq('user_id', userId).eq('date_key', dateKey).eq('instrument', instrument);
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
  const byDate = dailyResults[dateKey];
  if (!byDate) return null;
  if (isLegacyDailyEntry(byDate)) {
    const migrated = migrateDailyResults({ [dateKey]: byDate });
    dailyResults[dateKey] = migrated[dateKey];
    saveDailyResults(dailyResults);
    return dailyResults[dateKey][instrument] || null;
  }
  return byDate[instrument] || null;
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
  const byDate = declarations[dateKey];
  if (!byDate) return null;
  if (isLegacyDeclarationEntry(byDate)) {
    const migrated = migrateDeclarations({ [dateKey]: byDate });
    declarations[dateKey] = migrated[dateKey];
    saveDeclarations(declarations);
    return declarations[dateKey][instrument] || null;
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
  const existing = declarations[dateKey];
  const byInstrument = typeof existing === 'object' && existing !== null && !isLegacyDeclarationEntry(existing) ? { ...existing } : {};
  byInstrument[inst] = { tradeCountPlanned, createdAt };
  declarations[dateKey] = byInstrument;
  saveDeclarations(declarations);
  if (currentUser) persistDeclarationToSupabase(currentUser.id, dateKey, inst, tradeCountPlanned, createdAt);
}

function setDayResult(dateKey, instrument, totalR, tradeCount) {
  const inst = instrument ?? selectedInstrument;
  const entry = { totalR, tradeCount };
  if (tradeCount === 1) entry.trade_1_r = totalR;
  const existing = dailyResults[dateKey];
  const byInstrument = typeof existing === 'object' && existing !== null && !isLegacyDailyEntry(existing) ? { ...existing } : {};
  byInstrument[inst] = entry;
  dailyResults[dateKey] = byInstrument;
  saveDailyResults(dailyResults);
  if (currentUser) persistDayResultToSupabase(currentUser.id, dateKey, inst, entry);
}

function clearDayLog(dateKey, instrument) {
  const inst = instrument ?? selectedInstrument;
  const byDate = dailyResults[dateKey];
  if (byDate && typeof byDate === 'object' && !isLegacyDailyEntry(byDate)) {
    delete byDate[inst];
    if (Object.keys(byDate).length === 0) delete dailyResults[dateKey];
    else dailyResults[dateKey] = byDate;
    saveDailyResults(dailyResults);
    if (currentUser) deleteDayResultFromSupabase(currentUser.id, dateKey, inst);
  } else if (byDate) {
    delete dailyResults[dateKey];
    saveDailyResults(dailyResults);
    if (currentUser) deleteDayResultFromSupabase(currentUser.id, dateKey, inst);
  }
  const declByDate = declarations[dateKey];
  if (declByDate && typeof declByDate === 'object' && !isLegacyDeclarationEntry(declByDate)) {
    delete declByDate[inst];
    if (Object.keys(declByDate).length === 0) delete declarations[dateKey];
    else declarations[dateKey] = declByDate;
    saveDeclarations(declarations);
    if (currentUser) deleteDeclarationFromSupabase(currentUser.id, dateKey, inst);
  } else if (declByDate) {
    delete declarations[dateKey];
    saveDeclarations(declarations);
    if (currentUser) deleteDeclarationFromSupabase(currentUser.id, dateKey, inst);
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

function updateAuthUI() {
  const statusEl = document.getElementById('authStatus');
  const loginButton = document.getElementById('loginButton');
  const logoutButton = document.getElementById('logoutButton');
  const accountMeta = document.getElementById('settingsAccountMeta');
  if (!statusEl || !loginButton || !logoutButton) return;
  if (currentUser) {
    const email = currentUser.email || 'Signed in';
    statusEl.textContent = email;
    loginButton.hidden = true;
    logoutButton.hidden = false;
    if (accountMeta) accountMeta.textContent = 'Signed in as ' + email + '. Your data is synced to the cloud.';
  } else {
    statusEl.textContent = 'Not signed in';
    loginButton.hidden = false;
    logoutButton.hidden = true;
    if (accountMeta) accountMeta.textContent = 'Sign in with email to sync your data.';
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
}

function renderCalendar() {
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDay = new Date(year, month, 1).getDay();

  document.getElementById('monthYear').textContent =
    currentDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });

  let monthlyTotalR = 0;

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
          monthlyTotalR += data.totalR;
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

  const streakEl = document.getElementById('disciplineStreak');
  if (streakEl) streakEl.textContent = 'Streak: ' + computeDisciplineStreak();
  const scoreEl = document.getElementById('disciplineScore');
  if (scoreEl) {
    const score = computeDisciplineScore();
    scoreEl.textContent = score != null ? 'Score: ' + score : 'Score: —';
  }

  const banner = document.getElementById('declarationBanner');
  if (banner) {
    const today = new Date();
    const todayKey = formatDateKey(today);
    const hasDecl = getDeclaration(todayKey, selectedInstrument);
    const isWeekdayToday = isWeekday(today);
    banner.hidden = false;
    const bannerRight = banner.querySelector('.declaration-banner-right');
    if (bannerRight) bannerRight.hidden = !isWeekdayToday;
    document.querySelectorAll('.instrument-pill').forEach((pill) => {
      const inst = pill.dataset.instrument;
      const isSelected = inst === selectedInstrument;
      pill.classList.toggle('selected', isSelected);
      pill.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
    });
    const promptEl = document.getElementById('declarationPrompt');
    const confirmedEl = document.getElementById('declarationConfirmed');
    const confirmedTextEl = document.getElementById('declarationConfirmedText');
    if (promptEl && confirmedEl && confirmedTextEl) {
      if (hasDecl) {
        promptEl.hidden = true;
        confirmedEl.hidden = false;
        const n = hasDecl.tradeCountPlanned;
        const timeStr = formatDeclarationTime(hasDecl.createdAt);
        confirmedTextEl.textContent = 'Planned: ' + n + ' trade' + (n === 1 ? '' : 's') + (timeStr ? ' · ' + timeStr : '');
      } else {
        promptEl.hidden = false;
        confirmedEl.hidden = true;
      }
    }
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
  const declareSection = document.getElementById('logModalDeclare');
  const outcomeSection = document.getElementById('logModalOutcome');
  const plannedLine = document.getElementById('logModalPlanned');
  const comparisonLine = document.getElementById('logModalComparison');
  const decl = getDeclaration(key, selectedInstrument);
  const past = isPastDate(logModalTargetDate);
  title.textContent = logModalTargetDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const instrumentLabel = document.getElementById('logModalInstrument');
  if (instrumentLabel) instrumentLabel.textContent = 'Logging for ' + selectedInstrument;
  declareSection.hidden = past || !!decl;
  outcomeSection.hidden = false;
  comparisonLine.hidden = true;
  comparisonLine.textContent = '';
  if (plannedLine) {
    if (decl) {
      const n = decl.tradeCountPlanned;
      const timeStr = formatDeclarationTime(decl.createdAt);
      plannedLine.textContent = 'Planned: ' + n + ' trade' + (n === 1 ? '' : 's') + (timeStr ? ' at ' + timeStr : '');
      plannedLine.hidden = false;
    } else {
      plannedLine.hidden = true;
    }
  }
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
  document.getElementById('logModalDeclare').hidden = true;
  const decl = getDeclaration(key, selectedInstrument);
  const plannedLine = document.getElementById('logModalPlanned');
  if (plannedLine && decl) {
    const n = decl.tradeCountPlanned;
    const timeStr = formatDeclarationTime(decl.createdAt);
    plannedLine.textContent = 'Planned: ' + n + ' trade' + (n === 1 ? '' : 's') + (timeStr ? ' at ' + timeStr : '');
    plannedLine.hidden = false;
  }
  renderCalendar();
}

function saveOutcomeFromModal(r) {
  if (!logModalTargetDate) return;
  const key = formatDateKey(logModalTargetDate);
  const totalR = Number(r);
  const tradeCount = totalR === 2 || totalR === -2 ? (totalR === 2 ? 1 : 2) : (totalR === 1 ? 2 : 1);
  const decl = getDeclaration(key, selectedInstrument);
  setDayResult(key, selectedInstrument, totalR, tradeCount);
  const comparisonEl = document.getElementById('logModalComparison');
  if (comparisonEl) {
    const planned = decl && decl.tradeCountPlanned;
    const match = planned != null && planned === tradeCount;
    comparisonEl.textContent = planned != null
      ? (match ? 'Logged ' + tradeCount + ' trade' + (tradeCount === 1 ? '' : 's') + '. Matches plan.' : 'Logged ' + tradeCount + ' trade' + (tradeCount === 1 ? '' : 's') + '. Plan was ' + planned + ' trade' + (planned === 1 ? '' : 's') + '.')
      : 'Logged ' + tradeCount + ' trade' + (tradeCount === 1 ? '' : 's') + '.';
    comparisonEl.hidden = false;
    comparisonEl.classList.toggle('comparison-mismatch', planned != null && !match);
    window._logModalCloseTimeout = setTimeout(closeLogModal, 1800);
  } else {
    closeLogModal();
  }
}

document.addEventListener('DOMContentLoaded', () => {
  currentMode = loadCurrentMode();

  async function applyAuthState() {
    if (currentUser) {
      dailyResults = await fetchDailyResultsFromSupabase(currentUser.id);
      declarations = await fetchDeclarationsFromSupabase(currentUser.id);
      saveDailyResults(dailyResults);
      saveDeclarations(declarations);
    } else {
      dailyResults = loadDailyResults();
      declarations = loadDeclarations();
    }
    updateAuthUI();
    renderCalendar();
    if (typeof window.renderAnalytics === 'function') window.renderAnalytics();
  }

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

  document.querySelectorAll('.nav-tab').forEach((tab) => {
    tab.addEventListener('click', () => showScreen(tab.dataset.screen));
  });

  const loginButton = document.getElementById('loginButton');
  const logoutButton = document.getElementById('logoutButton');
  const authModal = document.getElementById('authModal');
  const authModalBackdrop = document.getElementById('authModalBackdrop');
  const authEmail = document.getElementById('authEmail');
  const authPassword = document.getElementById('authPassword');
  const authPasswordConfirm = document.getElementById('authPasswordConfirm');
  const authPasswordConfirmWrap = document.getElementById('authPasswordConfirmWrap');
  const authModalMessage = document.getElementById('authModalMessage');
  const authModalTitle = document.getElementById('authModalTitle');
  const authModalSubtitle = document.getElementById('authModalSubtitle');
  const authModalSubmit = document.getElementById('authModalSubmit');
  const authModalCancel = document.getElementById('authModalCancel');
  const authModalSwitchMode = document.getElementById('authModalSwitchMode');

  if (loginButton) loginButton.textContent = 'Sign in with email';

  let authModalMode = 'signin';

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
      if (authModalMessage) { authModalMessage.hidden = true; authModalMessage.textContent = ''; }
      authEmail?.focus();
    }
  }

  function closeAuthModal() {
    if (authModal) authModal.hidden = true;
    if (authPassword) authPassword.value = '';
    if (authPasswordConfirm) authPasswordConfirm.value = '';
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

  document.getElementById('declareOne')?.addEventListener('click', () => {
    setDeclaration(formatDateKey(new Date()), selectedInstrument, 1);
    renderCalendar();
  });
  document.getElementById('declareTwo')?.addEventListener('click', () => {
    setDeclaration(formatDateKey(new Date()), selectedInstrument, 2);
    renderCalendar();
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
  period.forEach((btn) => {
    btn.addEventListener('click', () => {
      analyticsPeriod = btn.dataset.period;
      period.forEach((b) => b.classList.toggle('active', b === btn));
      renderAnalytics();
    });
  });

  function getResultsInRange(periodKey, instrument) {
    const inst = instrument ?? selectedInstrument;
    const end = new Date();
    const results = [];
    let start;
    if (periodKey === '30') {
      start = new Date(end);
      start.setDate(start.getDate() - 30);
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
        const data = getDayResult(key, inst);
        if (data) results.push({ key, ...data });
      }
      cur.setDate(cur.getDate() + 1);
    }
    return results;
  }

  function getResultsForLatestMonth(instrument) {
    const inst = instrument ?? selectedInstrument;
    const keys = Object.keys(dailyResults).filter((k) => getDayResult(k, inst));
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

  function renderAnalytics() {
    let results = getResultsInRange(analyticsPeriod);
    let usedFallback = false;
    if (results.length === 0 && (analyticsPeriod === 'month' || analyticsPeriod === 'week')) {
      const tryOrder = analyticsPeriod === 'month' ? ['week', '30'] : ['month', '30'];
      for (const key of tryOrder) {
        const next = getResultsInRange(key);
        if (next.length > 0) {
          analyticsPeriod = key;
          period.forEach((b) => b.classList.toggle('active', b.dataset.period === key));
          results = next;
          break;
        }
      }
    }
    if (results.length === 0) {
      const latest = getResultsForLatestMonth();
      if (latest.length > 0) {
        results = latest;
        usedFallback = true;
      }
    }
    const totalR = results.reduce((s, r) => s + r.totalR, 0);
    const greenDays = results.filter((r) => r.totalR > 0).length;
    const winRate = results.length ? (greenDays / results.length * 100) : 0;

    let runningTotal = 0;
    let peak = 0;
    let maxDrawdown = 0;
    results.forEach((r) => {
      runningTotal += r.totalR;
      if (runningTotal > peak) peak = runningTotal;
      const drawdown = peak - runningTotal;
      if (drawdown > maxDrawdown) maxDrawdown = drawdown;
    });

    let winningStreak = 0;
    let losingStreak = 0;
    let curWin = 0;
    let curLose = 0;
    results.forEach((r) => {
      if (r.totalR > 0) {
        curWin++;
        curLose = 0;
        if (curWin > winningStreak) winningStreak = curWin;
      } else if (r.totalR < 0) {
        curLose++;
        curWin = 0;
        if (curLose > losingStreak) losingStreak = curLose;
      } else {
        curWin = 0;
        curLose = 0;
      }
    });

    const firstTradeOutcomes = results.map((r) => {
      if (r.trade_1_r != null) return r.trade_1_r;
      if (r.tradeCount === 1 && r.totalR != null) return r.totalR;
      return null;
    }).filter((x) => x != null);
    const firstTradeWins = firstTradeOutcomes.filter((r) => r > 0).length;
    const firstTradeWinRate = firstTradeOutcomes.length ? (firstTradeWins / firstTradeOutcomes.length * 100) : null;

    // Second trade: only 2-trade days. +1R = first loss, second win; -2R = both losses.
    const twoTradeDays = results.filter((r) => r.tradeCount === 2);
    const secondTradeWins = twoTradeDays.filter((r) => r.totalR === 1).length;
    const secondTradeWinRate = twoTradeDays.length ? (secondTradeWins / twoTradeDays.length * 100) : null;

    const set = (id, text) => {
      const el = document.getElementById(id);
      if (el) el.textContent = text;
    };
    const fallbackEl = document.getElementById('analyticsFallbackNote');
    if (fallbackEl) {
      if (usedFallback && results.length > 0) {
        const sampleKey = results[0].key;
        const [y, m] = sampleKey.split('-').map(Number);
        const d = new Date(y, m - 1, 1);
        fallbackEl.textContent = 'Showing latest available data (' + d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) + ')';
        fallbackEl.hidden = false;
      } else {
        fallbackEl.hidden = true;
        fallbackEl.textContent = '';
      }
    }
    set('metricWinRate', results.length ? winRate.toFixed(1) + '%' : '—');
    set('metricFirstTradeWinRate', firstTradeWinRate != null ? firstTradeWinRate.toFixed(1) + '%' : '—');
    set('metricSecondTradeWinRate', secondTradeWinRate != null ? secondTradeWinRate.toFixed(1) + '%' : '—');
    set('metricMaxDrawdown', results.length ? (maxDrawdown > 0 ? '-' : '') + maxDrawdown + 'R' : '—');
    set('metricWinningStreak', results.length ? String(winningStreak) : '—');
    set('metricLosingStreak', results.length ? String(losingStreak) : '—');
    set('metricTotalR', results.length ? formatR(totalR) : '—');
  }
  window.renderAnalytics = renderAnalytics;

  document.getElementById('shareGenerateBtn')?.addEventListener('click', () => {
    const periodVal = document.getElementById('sharePeriod')?.value || 'month';
    const results = getResultsInRange(periodVal === '30' ? '30' : 'month');
    const totalR = results.reduce((s, r) => s + r.totalR, 0);
    const streak = computeDisciplineStreak();
    const score = computeDisciplineScore();
    const payload = {
      period: periodVal,
      totalR,
      streak,
      score: score != null ? score : null,
      daysLogged: results.length,
      greenDays: results.filter((r) => r.totalR > 0).length,
    };
    const token = btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
    let tokens = {};
    try {
      tokens = JSON.parse(localStorage.getItem(STORAGE_KEYS.shareTokens) || '{}');
    } catch (_) {}
    tokens[token] = { createdAt: Date.now(), payload };
    localStorage.setItem(STORAGE_KEYS.shareTokens, JSON.stringify(tokens));

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
  showScreen('calendar');
});
