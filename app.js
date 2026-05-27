const canvas = document.querySelector("#commandCanvas");
const ctx = canvas.getContext("2d");

const scanStatus = document.querySelector("#scanStatus");
const aiFeed = document.querySelector("#aiFeed");
const demoPulse = document.querySelector("#demoPulse");

const authForm = document.querySelector("#authForm");
const authNote = document.querySelector("#authNote");
const authSubmit = document.querySelector("#authSubmit");
const authModeButtons = Array.from(document.querySelectorAll("[data-auth-mode]"));
const logoutBtn = document.querySelector("#logoutBtn");
const sessionCard = document.querySelector("#sessionCard");
const sessionEmail = document.querySelector("#sessionEmail");
const dashboardStatus = document.querySelector("#dashboardStatus");
const statsGrid = document.querySelector("#statsGrid");

const tradeForm = document.querySelector("#tradeForm");
const tradeIdInput = tradeForm.querySelector('input[name="id"]');
const tradeSubmit = document.querySelector("#tradeSubmit");
const tradeReset = document.querySelector("#tradeReset");
const tradeNote = document.querySelector("#tradeNote");
const tradeTableBody = document.querySelector("#tradeTableBody");
const journalEmpty = document.querySelector("#journalEmpty");

const heroLossTitle = document.querySelector("#heroLossTitle");
const heroLossMeta = document.querySelector("#heroLossMeta");
const heroPlanValue = document.querySelector("#heroPlanValue");
const heroPlanMeta = document.querySelector("#heroPlanMeta");
const heroDataValue = document.querySelector("#heroDataValue");
const heroDataMeta = document.querySelector("#heroDataMeta");
const heroRuleValue = document.querySelector("#heroRuleValue");
const heroRuleMeta = document.querySelector("#heroRuleMeta");

const connectionForm = document.querySelector("#connectionForm");
const connectionList = document.querySelector("#connectionList");
const importForm = document.querySelector("#importForm");
const importFileInput = document.querySelector("#importFile");
const importNote = document.querySelector("#importNote");
const reviewSummary = document.querySelector("#reviewSummary");
const reviewRange = document.querySelector("#reviewRange");
const reviewChecklist = document.querySelector("#reviewChecklist");
const reviewWins = document.querySelector("#reviewWins");
const reviewLosses = document.querySelector("#reviewLosses");
const reviewDetail = document.querySelector("#reviewDetail");
const generateReviewBtn = document.querySelector("#generateReviewBtn");
const calendarGrid = document.querySelector("#calendarGrid");
const exportBtn = document.querySelector("#exportBtn");
const deleteAccountBtn = document.querySelector("#deleteAccountBtn");

const STORAGE = {
  authMode: "atb.authMode.v2",
  ui: "atb.ui.v2"
};

let state = {
  user: null,
  trades: [],
  attachments: [],
  connections: [],
  weeklyReview: null,
  summary: null,
  calendar: []
};

let authMode = localStorage.getItem(STORAGE.authMode) || "signup";
let currentMonth = new Date();
let busy = false;
let frame = 0;

const nodes = Array.from({ length: 34 }, (_, index) => ({
  x: Math.random(),
  y: Math.random(),
  z: Math.random() * 0.8 + 0.2,
  phase: index * 0.37,
  speed: Math.random() * 0.25 + 0.08
}));

const streams = Array.from({ length: 22 }, (_, index) => ({
  x: Math.random(),
  y: Math.random(),
  length: Math.random() * 0.16 + 0.08,
  speed: Math.random() * 0.006 + 0.002,
  hue: index % 4
}));

const STATIC_API_KEYS = {
  users: "atb.static.users.v1",
  session: "atb.static.session.v1"
};

let staticApiMode = false;

function request(path, options = {}) {
  return fetch(path, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    ...options
  }).then(async (response) => {
    const contentType = response.headers.get("content-type") || "";
    const payload = contentType.includes("application/json") ? await response.json() : await response.text();
    if (path.startsWith("/api/") && response.status === 404 && !contentType.includes("application/json")) {
      staticApiMode = true;
      return localApiRequest(path, options);
    }
    if (!response.ok) {
      const message = payload?.error || payload || "request_failed";
      throw new Error(message);
    }
    return payload;
  }).catch((error) => {
    if (path.startsWith("/api/") && (staticApiMode || error instanceof TypeError)) {
      staticApiMode = true;
      return localApiRequest(path, options);
    }
    throw error;
  });
}

function localRead(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function localWrite(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function localId() {
  return window.crypto?.randomUUID?.() || `id_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

async function localHash(value) {
  const text = String(value || "");
  if (!window.crypto?.subtle) return btoa(unescape(encodeURIComponent(text)));
  const digest = await window.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function localUsers() {
  const users = localRead(STATIC_API_KEYS.users, []);
  return Array.isArray(users) ? users : [];
}

function saveLocalUsers(users) {
  localWrite(STATIC_API_KEYS.users, users);
}

function localSessionId() {
  return localRead(STATIC_API_KEYS.session, null)?.userId || null;
}

function setLocalSession(userId) {
  localWrite(STATIC_API_KEYS.session, { userId });
}

function clearLocalSession() {
  localStorage.removeItem(STATIC_API_KEYS.session);
}

function localCurrentUser() {
  const userId = localSessionId();
  return localUsers().find((user) => user.id === userId) || null;
}

function localPublicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    created_at: user.created_at,
    profile: { user_id: user.id, free_plan: 1, timezone: "Asia/Seoul" }
  };
}

function localPnl(trade) {
  const delta = trade.side === "short" ? trade.entry_price - trade.exit_price : trade.exit_price - trade.entry_price;
  return delta * trade.quantity - Number(trade.fee || 0);
}

function localStats(trades) {
  const count = trades.length;
  const pnl = trades.reduce((sum, trade) => sum + localPnl(trade), 0);
  const wins = trades.filter((trade) => localPnl(trade) > 0).length;
  return {
    count,
    pnl,
    wins,
    winRate: count ? Math.round((wins / count) * 100) : 0,
    avgLeverage: count ? trades.reduce((sum, trade) => sum + Number(trade.leverage || 0), 0) / count : 0,
    worst: [...trades].sort((a, b) => localPnl(a) - localPnl(b))[0] || null,
    latest: trades[0] || null
  };
}

function localCalendar(trades) {
  const map = new Map();
  trades.forEach((trade) => {
    map.set(trade.trade_date, (map.get(trade.trade_date) || 0) + localPnl(trade));
  });
  return [...map.entries()].map(([date, pnl]) => ({ date, pnl }));
}

function localWeekStart() {
  const now = new Date();
  const diff = (now.getDay() + 6) % 7;
  now.setDate(now.getDate() - diff);
  return now.toISOString().slice(0, 10);
}

function localWeeklyReview(trades) {
  const start = localWeekStart();
  const endDate = new Date(start);
  endDate.setDate(endDate.getDate() + 6);
  const end = endDate.toISOString().slice(0, 10);
  const scoped = trades.filter((trade) => trade.trade_date >= start && trade.trade_date <= end);
  const scored = scoped.map((trade) => ({ ...trade, pnl: localPnl(trade) }));
  const total = scored.reduce((sum, trade) => sum + trade.pnl, 0);
  const worst = [...scored].sort((a, b) => a.pnl - b.pnl)[0] || null;
  const summary = scoped.length
    ? `이번 주 ${start} ~ ${end} 사이 ${scoped.length}건의 거래에서 총 손익 ${total.toFixed(2)} USDT. 가장 큰 손실은 ${worst?.symbol || "-"}입니다.`
    : `이번 주 ${start} ~ ${end}에는 저장된 거래가 없습니다.`;
  return {
    weekStart: start,
    weekEnd: end,
    summary,
    checklist: ["진입 전에 손절가를 먼저 적기", "감정 태그를 거래 후 즉시 남기기", "계획 R 대비 실제 R을 기록하기"],
    topWins: scored.filter((trade) => trade.pnl >= 0).slice(0, 3).map((trade) => `${trade.symbol} · ${trade.pnl.toFixed(2)} USDT`),
    topLosses: scored.filter((trade) => trade.pnl < 0).slice(0, 3).map((trade) => `${trade.symbol} · ${trade.pnl.toFixed(2)} USDT`),
    worstTrade: worst,
    bestTrade: [...scored].sort((a, b) => b.pnl - a.pnl)[0] || null
  };
}

function localTradeFromBody(body, existing = {}) {
  const now = new Date().toISOString();
  const entry = Number(body.entryPrice ?? body.entry_price ?? existing.entry_price ?? 0);
  const exit = Number(body.exitPrice ?? body.exit_price ?? existing.exit_price ?? 0);
  const quantity = Number(body.quantity ?? existing.quantity ?? 0);
  const fee = Number(body.fee ?? existing.fee ?? 0);
  const side = String(body.side || existing.side || "long");
  const plannedStop = body.plannedStop != null && body.plannedStop !== "" ? Number(body.plannedStop) : null;
  const pnl = (side === "short" ? entry - exit : exit - entry) * quantity - fee;
  const risk = plannedStop ? Math.abs(entry - plannedStop) * quantity : 0;
  return {
    id: existing.id || localId(),
    symbol: String(body.symbol || existing.symbol || "").trim().toUpperCase(),
    market_type: String(body.marketType || body.market_type || existing.market_type || "futures"),
    side,
    entry_price: entry,
    exit_price: exit,
    quantity,
    fee,
    leverage: Number(body.leverage ?? existing.leverage ?? 1),
    planned_stop: plannedStop,
    planned_take_profit: body.plannedTakeProfit != null && body.plannedTakeProfit !== "" ? Number(body.plannedTakeProfit) : null,
    planned_r: body.plannedR != null && body.plannedR !== "" ? Number(body.plannedR) : null,
    actual_r: risk ? Number((pnl / risk).toFixed(2)) : null,
    strategy_tags: body.strategyTags || body.strategy_tags || existing.strategy_tags || [],
    emotion_tags: body.emotionTags || body.emotion_tags || existing.emotion_tags || [],
    mistake_tags: body.mistakeTags || body.mistake_tags || existing.mistake_tags || [],
    note: String(body.note || existing.note || ""),
    source: String(body.source || existing.source || "manual"),
    trade_date: String(body.tradeDate || body.trade_date || existing.trade_date || now.slice(0, 10)),
    created_at: existing.created_at || now,
    updated_at: now
  };
}

function parseLocalCsv(text) {
  const lines = String(text || "").split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return [];
  const headers = lines.shift().split(",").map((item) => item.trim().toLowerCase());
  return lines.map((line) => {
    const cells = line.split(",").map((item) => item.trim());
    return Object.fromEntries(headers.map((header, index) => [header, cells[index] || ""]));
  });
}

function localImportCsv(text) {
  const rows = parseLocalCsv(text);
  const user = localCurrentUser();
  if (!user) throw new Error("unauthorized");
  const imported = rows.map((row) =>
    localTradeFromBody({
      symbol: row.symbol || row.pair,
      side: row.side || "long",
      entryPrice: row.entry_price || row.entry || row.open_price,
      exitPrice: row.exit_price || row.exit || row.close_price,
      quantity: row.quantity || row.qty || row.size,
      fee: row.fee || 0,
      leverage: row.leverage || 1,
      tradeDate: row.trade_date || row.date,
      note: row.note || "CSV import",
      source: "csv",
      strategyTags: ["csv-import"]
    })
  ).filter((trade) => trade.symbol && trade.entry_price && trade.exit_price && trade.quantity);
  const users = localUsers().map((entry) => entry.id === user.id ? { ...entry, trades: [...imported, ...(entry.trades || [])] } : entry);
  saveLocalUsers(users);
  return { ok: true, imported: imported.length, updated: 0 };
}

async function localApiRequest(path, options = {}) {
  const method = String(options.method || "GET").toUpperCase();
  const body = options.body ? JSON.parse(options.body) : {};
  const users = localUsers();
  const user = localCurrentUser();
  const url = new URL(path, window.location.origin);

  if (path === "/api/session" && method === "GET") return { user: localPublicUser(user) };
  if (path === "/api/auth/signup" && method === "POST") {
    const email = String(body.email || "").trim().toLowerCase();
    if (users.some((entry) => entry.email === email)) throw new Error("email_exists");
    const nextUser = { id: localId(), email, passwordHash: await localHash(body.password), created_at: new Date().toISOString(), trades: [], connections: [] };
    saveLocalUsers([...users, nextUser]);
    setLocalSession(nextUser.id);
    return { user: localPublicUser(nextUser) };
  }
  if (path === "/api/auth/login" && method === "POST") {
    const email = String(body.email || "").trim().toLowerCase();
    const found = users.find((entry) => entry.email === email);
    if (!found || found.passwordHash !== await localHash(body.password)) throw new Error("invalid_credentials");
    setLocalSession(found.id);
    return { user: localPublicUser(found) };
  }
  if (path === "/api/auth/logout" && method === "POST") {
    clearLocalSession();
    return { ok: true };
  }
  if (!user) throw new Error("unauthorized");
  const trades = [...(user.trades || [])].sort((a, b) => new Date(b.trade_date) - new Date(a.trade_date));
  if (path === "/api/trades" && method === "GET") return { trades, attachments: [] };
  if (path === "/api/trades" && method === "POST") {
    const trade = localTradeFromBody(body);
    saveLocalUsers(users.map((entry) => entry.id === user.id ? { ...entry, trades: [trade, ...(entry.trades || [])] } : entry));
    return { trade };
  }
  if (path.startsWith("/api/trades/") && method === "PUT") {
    const tradeId = path.split("/").pop();
    const existing = trades.find((trade) => trade.id === tradeId);
    const trade = localTradeFromBody(body, existing);
    saveLocalUsers(users.map((entry) => entry.id === user.id ? { ...entry, trades: (entry.trades || []).map((item) => item.id === tradeId ? trade : item) } : entry));
    return { trade };
  }
  if (path.startsWith("/api/trades/") && method === "DELETE") {
    const tradeId = path.split("/").pop();
    saveLocalUsers(users.map((entry) => entry.id === user.id ? { ...entry, trades: (entry.trades || []).filter((item) => item.id !== tradeId) } : entry));
    return { ok: true };
  }
  if (path === "/api/summary" && method === "GET") return { summary: localStats(trades), calendar: localCalendar(trades), review: localWeeklyReview(trades) };
  if (path.startsWith("/api/weekly-review") && method === "GET") return { computed: localWeeklyReview(trades), review: localWeeklyReview(trades) };
  if (path === "/api/connections" && method === "GET") return { connections: user.connections || [] };
  if (path === "/api/connections" && method === "POST") {
    const connection = {
      id: localId(),
      exchange: body.exchange,
      label: body.label,
      status: "active",
      api_key_last4: String(body.apiKeyLast4 || body.apiKey || "").slice(-4),
      permission_mode: "read-only",
      symbols: body.symbols || "",
      category: body.category || "linear",
      last_sync_status: "not synced"
    };
    saveLocalUsers(users.map((entry) => entry.id === user.id ? { ...entry, connections: [connection, ...(entry.connections || [])] } : entry));
    return { connection };
  }
  if (path.startsWith("/api/connections/") && path.endsWith("/sync") && method === "POST") {
    const connectionId = path.split("/").at(-2);
    saveLocalUsers(users.map((entry) => entry.id === user.id ? {
      ...entry,
      connections: (entry.connections || []).map((item) => item.id === connectionId ? {
        ...item,
        last_sync_status: "error",
        last_sync_error: "GitHub Pages static mode cannot connect to exchange APIs. Run the Node server deployment for live exchange sync.",
        updated_at: new Date().toISOString()
      } : item)
    } : entry));
    return { ok: false, error: "static_pages_no_exchange_sync" };
  }
  if (path.startsWith("/api/connections/") && method === "DELETE") {
    const connectionId = path.split("/").pop();
    saveLocalUsers(users.map((entry) => entry.id === user.id ? { ...entry, connections: (entry.connections || []).filter((item) => item.id !== connectionId) } : entry));
    return { ok: true };
  }
  if (path === "/api/import/csv" && method === "POST") return localImportCsv(body.text || "");
  if (path === "/api/account" && method === "DELETE") {
    saveLocalUsers(users.filter((entry) => entry.id !== user.id));
    clearLocalSession();
    return { ok: true };
  }
  throw new Error(`unsupported_static_api:${url.pathname}`);
}

function normalizeTags(value) {
  if (!value) return [];
  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatUSDT(value) {
  const amount = Number(value || 0);
  const prefix = amount > 0 ? "+" : "";
  return `${prefix}${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT`;
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function formatWeek(dateText) {
  const date = new Date(dateText);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric" }).format(date);
}

function formatMonthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function formatTrade(trade) {
  return {
    id: trade.id,
    symbol: trade.symbol,
    marketType: trade.market_type,
    side: trade.side,
    entryPrice: Number(trade.entry_price),
    exitPrice: Number(trade.exit_price),
    quantity: Number(trade.quantity),
    fee: Number(trade.fee || 0),
    leverage: Number(trade.leverage || 1),
    plannedStop: trade.planned_stop == null ? null : Number(trade.planned_stop),
    plannedTakeProfit: trade.planned_take_profit == null ? null : Number(trade.planned_take_profit),
    plannedR: trade.planned_r == null ? null : Number(trade.planned_r),
    actualR: trade.actual_r == null ? null : Number(trade.actual_r),
    strategyTags: trade.strategy_tags || [],
    emotionTags: trade.emotion_tags || [],
    mistakeTags: trade.mistake_tags || [],
    note: trade.note,
    source: trade.source,
    tradeDate: trade.trade_date,
    createdAt: trade.created_at,
    updatedAt: trade.updated_at
  };
}

function pnlFor(trade) {
  const base = trade.side === "short" ? trade.entryPrice - trade.exitPrice : trade.exitPrice - trade.entryPrice;
  return base * trade.quantity - Number(trade.fee || 0);
}

function actualRFor(trade) {
  if (!trade.plannedStop || !trade.quantity) return null;
  const risk = Math.abs(trade.entryPrice - trade.plannedStop) * trade.quantity;
  return risk ? Number((pnlFor(trade) / risk).toFixed(2)) : null;
}

function weekdayLabel(dateText) {
  const date = new Date(dateText);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("ko-KR", { weekday: "short" }).format(date);
}

function sideLabel(side) {
  return side === "short" ? "Short" : "Long";
}

function emotionLabel(value) {
  const map = { calm: "Calm", fomo: "FOMO", revenge: "Revenge", fear: "Fear" };
  return map[value] || value || "-";
}

function setBusy(nextBusy, context = "trade") {
  busy = nextBusy;
  renderControlState();
  if (context === "auth") authSubmit.textContent = nextBusy ? "처리 중..." : authMode === "signup" ? "회원가입" : "로그인";
  if (context === "trade") tradeSubmit.textContent = nextBusy ? "저장 중..." : tradeIdInput.value ? "거래 수정" : "거래 저장";
  if (context === "connection") connectionForm.querySelector('button[type="submit"]').textContent = nextBusy ? "저장 중..." : "연결 저장";
  if (context === "import" && importForm) importForm.querySelector('button[type="submit"]').textContent = nextBusy ? "가져오는 중..." : "CSV 가져오기";
}

function setControlsDisabled(root, disabled, exceptions = []) {
  root.querySelectorAll("input, select, textarea, button").forEach((control) => {
    if (exceptions.includes(control.id)) return;
    control.disabled = disabled;
    control.setAttribute("aria-disabled", String(disabled));
  });
}

function renderControlState() {
  const signedIn = Boolean(state.user);
  authSubmit.disabled = busy;
  logoutBtn.disabled = busy || !signedIn;
  setControlsDisabled(tradeForm, !signedIn || busy, ["tradeReset"]);
  tradeReset.disabled = busy || !signedIn;
  setControlsDisabled(connectionForm, !signedIn || busy);
  if (importForm) setControlsDisabled(importForm, !signedIn || busy);
  generateReviewBtn.disabled = !signedIn || busy;
  exportBtn.disabled = !signedIn || busy;
  deleteAccountBtn.disabled = !signedIn || busy;
}

function setAuthMode(nextMode) {
  authMode = nextMode;
  localStorage.setItem(STORAGE.authMode, authMode);
  authModeButtons.forEach((button) => button.classList.toggle("is-active", button.dataset.authMode === nextMode));
  document.querySelectorAll(".signup-only").forEach((field) => {
    field.hidden = nextMode !== "signup";
  });
  authSubmit.textContent = nextMode === "signup" ? "회원가입" : "로그인";
  authNote.textContent =
    nextMode === "signup"
      ? "이메일과 비밀번호로 계정을 만들고 바로 로그인합니다."
      : "기존 계정으로 로그인하면 저장된 거래가 다시 불러와집니다.";
}

async function boot() {
  setAuthMode(authMode);
  tradeForm.tradeDate.value = new Date().toISOString().slice(0, 10);
  await refreshSession();
  attachHandlers();
  resizeCanvas();
  requestAnimationFrame(drawCanvas);
}

async function refreshSession() {
  const data = await request("/api/session");
  state.user = data.user;
  if (state.user) {
    await loadDashboardData();
  } else {
    state.trades = [];
    state.attachments = [];
    state.connections = [];
    state.weeklyReview = null;
    state.summary = null;
    state.calendar = [];
  }
  render();
}

async function loadDashboardData() {
  const [tradesRes, summaryRes, reviewRes, connectionsRes] = await Promise.all([
    request("/api/trades"),
    request("/api/summary"),
    request(`/api/weekly-review?weekStart=${getWeekStartISO()}`),
    request("/api/connections")
  ]);
  state.trades = (tradesRes.trades || []).map(formatTrade);
  state.attachments = tradesRes.attachments || [];
  state.summary = summaryRes.summary || null;
  state.weeklyReview = reviewRes.computed || reviewRes.review || null;
  state.calendar = summaryRes.calendar || [];
  state.connections = connectionsRes.connections || [];
}

function getWeekStartISO() {
  const now = new Date();
  const day = now.getDay();
  const diff = (day + 6) % 7;
  now.setDate(now.getDate() - diff);
  return now.toISOString().slice(0, 10);
}

function statsForTrades(trades) {
  const count = trades.length;
  const totalPnl = trades.reduce((sum, trade) => sum + pnlFor(trade), 0);
  const wins = trades.filter((trade) => pnlFor(trade) > 0).length;
  const winRate = count ? Math.round((wins / count) * 100) : 0;
  const avgLeverage = count ? trades.reduce((sum, trade) => sum + Number(trade.leverage || 0), 0) / count : 0;
  const worst = [...trades].sort((a, b) => pnlFor(a) - pnlFor(b))[0] || null;
  const best = [...trades].sort((a, b) => pnlFor(b) - pnlFor(a))[0] || null;
  return { count, totalPnl, wins, winRate, avgLeverage, worst, best };
}

function render() {
  const signedIn = Boolean(state.user);
  authForm.hidden = signedIn;
  sessionCard.hidden = !signedIn;
  logoutBtn.hidden = !signedIn;
  dashboardStatus.textContent = signedIn ? `로그인됨 · ${state.user.email}` : "로그인 필요";
  sessionEmail.textContent = signedIn ? state.user.email : "-";
  renderControlState();
  document.querySelector("#app .dashboard-panel")?.classList.toggle("is-locked", !signedIn);

  const stats = statsForTrades(state.trades);
  heroLossTitle.textContent = stats.worst ? `${stats.worst.symbol} ${pnlFor(stats.worst) < 0 ? "손실" : "수익"}` : "데이터 없음";
  heroLossMeta.textContent = stats.worst
    ? `${formatUSDT(pnlFor(stats.worst))} / ${formatDate(stats.worst.tradeDate)} / ${sideLabel(stats.worst.side)} ${stats.worst.leverage}x`
    : "로그인 후 거래를 저장하면 표시됩니다.";
  heroPlanValue.textContent = signedIn ? "Connected" : "Ready";
  heroPlanMeta.textContent = signedIn ? `계정: ${state.user.email}` : "서버 SQLite 기반 auth, trade, review";
  heroDataValue.textContent = signedIn ? `${state.trades.length} trades` : "Server DB";
  heroDataMeta.textContent = signedIn ? "거래와 복기가 서버에 저장됩니다." : "로그인 후 저장 데이터가 생깁니다.";
  heroRuleValue.textContent = stats.worst ? (pnlFor(stats.worst) < 0 ? "손절 고정" : "분할 익절") : "기록 없음";
  heroRuleMeta.textContent = stats.worst
    ? `가장 큰 손실 패턴: ${stats.worst.mistakeTags[0] || "기록 없음"}`
    : "거래를 저장하면 다음 행동 규칙이 계산됩니다.";
  scanStatus.textContent = signedIn ? "SYNCED" : "READY";

  aiFeed.innerHTML = signedIn
    ? `<span>AI LOG</span>
       <p>${escapeHtml(state.trades.length ? `저장된 ${state.trades.length}개 거래를 기반으로 반복 패턴을 분석합니다.` : "첫 거래를 저장하면 AI 로그가 실제 데이터로 바뀝니다.")}</p>
       <p>${escapeHtml(state.summary ? `이번 주 총 손익 ${formatUSDT(state.summary.pnl)}.` : "대시보드가 열리면 주간 복기가 자동 계산됩니다.")}</p>
       <p>${escapeHtml(state.connections.length ? `${state.connections.length}개 거래소 연결이 저장되어 있습니다.` : "거래소 연결은 읽기 전용으로 관리됩니다.")}</p>`
    : `<span>AI LOG</span><p>로그인하면 실제 데이터 기반 분석이 표시됩니다.</p><p>현재 상태는 로그인 전입니다.</p><p>모든 데이터는 서버에 저장됩니다.</p>`;

  renderStats(stats);
  renderTrades();
  renderConnections();
  renderReview();
  renderCalendar();
  setFormMessages(signedIn, stats);
}

function renderStats(stats) {
  const rows = [
    ["총 거래", String(stats.count), "cyan"],
    ["총 손익", formatUSDT(stats.totalPnl), stats.totalPnl >= 0 ? "green" : "red"],
    ["승률", `${stats.winRate}%`, "amber"],
    ["평균 레버리지", `${stats.avgLeverage ? stats.avgLeverage.toFixed(1) : "0.0"}x`, "violet"]
  ];
  statsGrid.innerHTML = rows
    .map(
      ([label, value, tone]) => `
        <article class="stat-card">
          <span>${escapeHtml(label)}</span>
          <strong data-tone="${tone}">${escapeHtml(value)}</strong>
        </article>
      `
    )
    .join("");
}

function renderTrades() {
  const signedIn = Boolean(state.user);
  const trades = state.trades;
  tradeTableBody.innerHTML = trades
    .map((trade) => {
      const pnl = pnlFor(trade);
      return `
        <tr>
          <td>${escapeHtml(formatDate(trade.tradeDate))}</td>
          <td><strong>${escapeHtml(trade.symbol)}</strong></td>
          <td>${escapeHtml(trade.marketType)}</td>
          <td>${escapeHtml(trade.source || "manual")}</td>
          <td>${escapeHtml(sideLabel(trade.side))} ${trade.leverage}x</td>
          <td class="${pnl >= 0 ? "positive" : "negative"}">${escapeHtml(formatUSDT(pnl))}</td>
          <td>${escapeHtml((trade.emotionTags && trade.emotionTags[0]) || "Calm")}</td>
          <td>${escapeHtml([...trade.strategyTags, ...trade.mistakeTags].join(", ") || "-")}</td>
          <td>${escapeHtml(trade.note)}</td>
          <td>
            <div class="row-actions">
              <button type="button" class="inline-button" data-action="edit" data-id="${trade.id}">편집</button>
              <button type="button" class="inline-button danger" data-action="delete" data-id="${trade.id}">삭제</button>
            </div>
          </td>
        </tr>
      `;
    })
    .join("");
  journalEmpty.hidden = signedIn && trades.length > 0;
}

function renderConnections() {
  connectionList.innerHTML = state.connections.length
    ? state.connections
        .map(
          (connection) => {
            const canSync = String(connection.exchange || "").toLowerCase().includes("bybit");
            return `
            <article class="connection-card">
              <div>
                <span>${escapeHtml(connection.exchange)}</span>
                <strong>${escapeHtml(connection.label)}</strong>
                <p>${escapeHtml(connection.permission_mode)} · ${escapeHtml(connection.api_key_last4 || "----")} · ${escapeHtml(connection.status)}</p>
                <small>${escapeHtml(connection.symbols || "symbols not set")} · ${escapeHtml(connection.category || "-")} · ${escapeHtml(connection.last_sync_status || "not synced")}${connection.last_sync_error ? ` · ${escapeHtml(connection.last_sync_error)}` : ""}</small>
              </div>
              <div class="row-actions">
                ${canSync ? `<button type="button" class="inline-button" data-connection-sync="${connection.id}">동기화</button>` : ""}
                <button type="button" class="inline-button danger" data-connection-delete="${connection.id}">삭제</button>
              </div>
            </article>
          `;
          }
        )
        .join("")
    : `<div class="journal-empty"><strong>저장된 연결이 없습니다.</strong><p>읽기 전용 키만 추가할 수 있습니다.</p></div>`;
}

function renderReview() {
  const review = state.weeklyReview;
  if (!review) {
    reviewSummary.textContent = "로그인 후 생성됩니다.";
    reviewRange.textContent = "-";
    reviewChecklist.innerHTML = "";
    reviewWins.innerHTML = "";
    reviewLosses.innerHTML = "";
    reviewDetail.textContent = "-";
    return;
  }
  reviewSummary.textContent = review.summary || "주간 복기";
  const weekStart = review.week_start || review.weekStart;
  const weekEnd = review.week_end || review.weekEnd;
  reviewRange.textContent = `${formatWeek(weekStart)} - ${formatWeek(weekEnd)}`;
  const checklist = Array.isArray(review.checklist) ? review.checklist : JSON.parse(review.checklist || "[]");
  reviewChecklist.innerHTML = checklist.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  const wins = Array.isArray(review.topWins) ? review.topWins : [];
  const losses = Array.isArray(review.topLosses) ? review.topLosses : [];
  reviewWins.innerHTML = wins.length ? wins.map((item) => `<li>${escapeHtml(item)}</li>`).join("") : "<li>기록이 쌓이면 표시됩니다.</li>";
  reviewLosses.innerHTML = losses.length ? losses.map((item) => `<li>${escapeHtml(item)}</li>`).join("") : "<li>기록이 쌓이면 표시됩니다.</li>";
  reviewDetail.textContent = `가장 큰 손실: ${review.worstTrade?.symbol || "-"} / 가장 좋은 조건: ${review.bestTrade?.symbol || "-"}`;
}

function renderCalendar() {
  const monthKey = formatMonthKey(currentMonth);
  const [year, month] = monthKey.split("-").map(Number);
  const first = new Date(year, month - 1, 1);
  const last = new Date(year, month, 0);
  const days = last.getDate();
  const startOffset = (first.getDay() + 6) % 7;
  const pnlMap = new Map(state.calendar.map((entry) => [entry.date, Number(entry.pnl || 0)]));
  const labels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const cells = [];
  labels.forEach((label) => cells.push(`<div class="calendar-head">${label}</div>`));
  for (let i = 0; i < startOffset; i += 1) cells.push(`<div class="calendar-cell is-empty"></div>`);
  for (let day = 1; day <= days; day += 1) {
    const date = new Date(year, month - 1, day).toISOString().slice(0, 10);
    const pnl = pnlMap.get(date) || 0;
    const tone = pnl > 0 ? "positive" : pnl < 0 ? "negative" : "neutral";
    cells.push(
      `<div class="calendar-cell ${tone}">
        <strong>${day}</strong>
        <span>${pnl ? formatUSDT(pnl) : "-"}</span>
      </div>`
    );
  }
  calendarGrid.innerHTML = cells.join("");
}

function setFormMessages(signedIn, stats) {
  authNote.textContent = signedIn
    ? `서버에 로그인되었습니다. 현재 거래 ${state.trades.length}건이 저장되어 있습니다.`
    : authMode === "signup"
      ? "이메일과 비밀번호로 계정을 만들고 바로 로그인합니다."
      : "기존 계정으로 로그인하면 저장된 거래가 다시 불러와집니다.";
  tradeNote.textContent = signedIn
    ? state.trades.length
      ? `총 손익 ${formatUSDT(stats.totalPnl)}. 거래를 추가/수정/삭제하면 즉시 반영됩니다.`
      : "첫 거래를 저장하면 통계와 캘린더가 바로 채워집니다."
    : "로그인하면 거래 저장 폼이 활성화됩니다.";
}

function attachHandlers() {
  authModeButtons.forEach((button) => {
    button.addEventListener("click", () => setAuthMode(button.dataset.authMode));
  });

  authForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(authForm);
    const email = String(form.get("email") || "").trim().toLowerCase();
    const password = String(form.get("password") || "");
    const confirmPassword = String(form.get("confirmPassword") || "");
    if (!email.includes("@")) return (authNote.textContent = "유효한 이메일을 입력해 주세요.");
    if (password.length < 8) return (authNote.textContent = "비밀번호는 8자 이상이어야 합니다.");
    if (authMode === "signup" && password !== confirmPassword) return (authNote.textContent = "비밀번호 확인이 일치하지 않습니다.");
    setBusy(true, "auth");
    try {
      await request(`/api/auth/${authMode === "signup" ? "signup" : "login"}`, {
        method: "POST",
        body: JSON.stringify({ email, password })
      });
      authForm.reset();
      await refreshSession();
    } catch (error) {
      authNote.textContent = error.message === "email_exists" ? "이미 존재하는 이메일입니다." : error.message === "invalid_credentials" ? "이메일 또는 비밀번호가 올바르지 않습니다." : "인증 처리에 실패했습니다.";
    } finally {
      setBusy(false, "auth");
      await refreshSession().catch(() => {});
    }
  });

  logoutBtn.addEventListener("click", async () => {
    if (busy) return;
    setBusy(true, "auth");
    try {
      await request("/api/auth/logout", { method: "POST", body: JSON.stringify({}) });
      await refreshSession();
    } finally {
      setBusy(false, "auth");
    }
  });

  tradeReset.addEventListener("click", () => {
    tradeForm.reset();
    tradeIdInput.value = "";
    tradeForm.tradeDate.value = new Date().toISOString().slice(0, 10);
    tradeSubmit.textContent = "거래 저장";
  });

  tradeForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy || !state.user) return;
    const form = new FormData(tradeForm);
    const files = Array.from(form.getAll("attachments")).filter((value) => value instanceof File && value.size > 0);
    const payload = {
      symbol: String(form.get("symbol") || "").trim().toUpperCase(),
      marketType: String(form.get("marketType") || "futures"),
      side: String(form.get("side") || "long"),
      entryPrice: Number(form.get("entryPrice")),
      exitPrice: Number(form.get("exitPrice")),
      quantity: Number(form.get("quantity")),
      fee: Number(form.get("fee") || 0),
      leverage: Number(form.get("leverage") || 1),
      plannedStop: form.get("plannedStop") ? Number(form.get("plannedStop")) : null,
      plannedTakeProfit: form.get("plannedTakeProfit") ? Number(form.get("plannedTakeProfit")) : null,
      plannedR: form.get("plannedR") ? Number(form.get("plannedR")) : null,
      actualR: null,
      strategyTags: normalizeTags(form.get("strategyTags")),
      emotionTags: normalizeTags(form.get("emotion") || "calm"),
      mistakeTags: normalizeTags(form.get("mistakeTags")),
      note: String(form.get("note") || "").trim(),
      source: "manual",
      tradeDate: String(form.get("tradeDate") || ""),
      attachments: []
    };
    if (!payload.symbol || !payload.entryPrice || !payload.exitPrice || !payload.quantity || !payload.note || !payload.tradeDate) {
      tradeNote.textContent = "필수 항목을 모두 입력해 주세요.";
      return;
    }
    for (const file of files) {
      payload.attachments.push(await fileToDataUrl(file));
    }
    if (tradeIdInput.value) {
      payload.id = tradeIdInput.value;
    }
    setBusy(true, "trade");
    try {
      const endpoint = tradeIdInput.value ? `/api/trades/${tradeIdInput.value}` : "/api/trades";
      const method = tradeIdInput.value ? "PUT" : "POST";
      await request(endpoint, { method, body: JSON.stringify(payload) });
      tradeForm.reset();
      tradeIdInput.value = "";
      tradeForm.tradeDate.value = new Date().toISOString().slice(0, 10);
      tradeSubmit.textContent = "거래 저장";
      await loadDashboardData();
      render();
    } catch (error) {
      tradeNote.textContent = "거래 저장에 실패했습니다.";
    } finally {
      setBusy(false, "trade");
      await refreshSession().catch(() => {});
    }
  });

  tradeTableBody.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const tradeId = button.dataset.id;
    const trade = state.trades.find((entry) => entry.id === tradeId);
    if (!trade) return;
    if (button.dataset.action === "edit") {
      fillTradeForm(trade);
      tradeSubmit.textContent = "거래 수정";
      window.location.hash = "#app";
    }
    if (button.dataset.action === "delete") {
      if (!confirm(`정말 ${trade.symbol} 거래를 삭제할까요?`)) return;
      setBusy(true, "trade");
      try {
        await request(`/api/trades/${tradeId}`, { method: "DELETE", body: JSON.stringify({}) });
        await loadDashboardData();
        render();
      } finally {
        setBusy(false, "trade");
      }
    }
  });

  connectionForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy || !state.user) return;
    const form = new FormData(connectionForm);
    const body = {
      exchange: String(form.get("exchange") || ""),
      label: String(form.get("label") || "").trim(),
      permissionMode: String(form.get("permissionMode") || "read-only"),
      apiKeyLast4: String(form.get("apiKeyLast4") || "").trim(),
      apiKey: String(form.get("apiKey") || "").trim(),
      apiSecret: String(form.get("apiSecret") || "").trim(),
      baseUrl: String(form.get("baseUrl") || "").trim(),
      symbols: String(form.get("symbols") || "").trim(),
      category: String(form.get("category") || "").trim(),
      notes: String(form.get("notes") || "").trim(),
      status: "active"
    };
    if (!body.exchange || !body.label) return;
    setBusy(true, "connection");
    try {
      await request("/api/connections", { method: "POST", body: JSON.stringify(body) });
      connectionForm.reset();
      await loadDashboardData();
      render();
    } finally {
      setBusy(false, "connection");
    }
  });

  if (importForm) {
    importForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (busy || !state.user) return;
      const file = importFileInput?.files?.[0];
      if (!file) {
        importNote.textContent = "CSV 파일을 먼저 선택해 주세요.";
        return;
      }
      setBusy(true, "import");
      try {
        const text = await fileToText(file);
        const result = await request("/api/import/csv", {
          method: "POST",
          body: JSON.stringify({ fileName: file.name, text })
        });
        importNote.textContent = `CSV ${result.imported || 0}건 가져왔습니다.`;
        importForm.reset();
        await loadDashboardData();
        render();
      } catch (error) {
        importNote.textContent = error.message === "empty_csv" ? "비어 있는 CSV입니다." : "CSV 가져오기에 실패했습니다.";
      } finally {
        setBusy(false, "import");
      }
    });
  }

  connectionList.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-connection-delete]");
    const syncButton = event.target.closest("button[data-connection-sync]");
    if (!button && !syncButton) return;
    const target = button || syncButton;
    const connectionId = target.dataset.connectionDelete || target.dataset.connectionSync;
    const connection = state.connections.find((item) => item.id === connectionId);
    if (!connection) return;
    if (syncButton) {
      const symbols = connection.symbols || "";
      if (!symbols.trim()) {
        alert("동기화하려면 연결 설정에 심볼 목록을 입력해 주세요.");
        return;
      }
      setBusy(true, "connection");
      try {
        const result = await request(`/api/connections/${connectionId}/sync`, {
          method: "POST",
          body: JSON.stringify({ category: connection.category, symbols })
        });
        await loadDashboardData();
        render();
        if (result.ok === false) {
          importNote.textContent = `동기화 실패: ${result.error || "알 수 없는 오류"}`;
          return;
        }
        importNote.textContent = `동기화 완료: ${result.result?.imported || 0}건 추가, ${result.result?.updated || 0}건 갱신`;
      } catch (error) {
        await loadDashboardData().catch(() => {});
        render();
        importNote.textContent = error.message === "symbols_required" ? "심볼 목록이 필요합니다." : `동기화 실패: ${error.message}`;
      } finally {
        setBusy(false, "connection");
      }
      return;
    }
    if (!confirm("연결을 삭제할까요?")) return;
    setBusy(true, "connection");
    try {
      await request(`/api/connections/${connectionId}`, { method: "DELETE", body: JSON.stringify({}) });
      await loadDashboardData();
      render();
    } finally {
      setBusy(false, "connection");
    }
  });

  generateReviewBtn.addEventListener("click", async () => {
    if (!state.user) return;
    setBusy(true, "trade");
    try {
      const result = await request(`/api/weekly-review?weekStart=${getWeekStartISO()}`);
      state.weeklyReview = result.computed || result.review;
      render();
    } finally {
      setBusy(false, "trade");
    }
  });

  exportBtn.addEventListener("click", async () => {
    if (!state.user) {
      authNote.textContent = "내보내기는 로그인 후 사용할 수 있습니다.";
      window.location.hash = "#app";
      return;
    }
    const payload = {
      user: state.user,
      trades: state.trades,
      connections: state.connections,
      weeklyReview: state.weeklyReview,
      calendar: state.calendar
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ai-trading-blackbox-export-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  deleteAccountBtn.addEventListener("click", async () => {
    if (!state.user) {
      authNote.textContent = "계정 삭제는 로그인 후 사용할 수 있습니다.";
      window.location.hash = "#app";
      return;
    }
    if (!confirm("계정과 모든 데이터를 삭제할까요?")) return;
    await request("/api/account", { method: "DELETE", body: JSON.stringify({}) }).catch(() => {});
    await request("/api/auth/logout", { method: "POST", body: JSON.stringify({}) }).catch(() => {});
    await refreshSession();
  });

  demoPulse.addEventListener("click", () => {
    const hasData = Boolean(state.trades.length);
    demoPulse.textContent = hasData ? "실제 데이터 분석 완료" : "데모 스캔 실행";
    setTimeout(() => {
      demoPulse.textContent = "데모 스캔 실행";
    }, 1200);
  });
}

function fillTradeForm(trade) {
  tradeIdInput.value = trade.id;
  tradeForm.symbol.value = trade.symbol || "";
  tradeForm.marketType.value = trade.marketType || "futures";
  tradeForm.side.value = trade.side || "long";
  tradeForm.entryPrice.value = trade.entryPrice ?? "";
  tradeForm.exitPrice.value = trade.exitPrice ?? "";
  tradeForm.quantity.value = trade.quantity ?? "";
  tradeForm.fee.value = trade.fee ?? "";
  tradeForm.leverage.value = trade.leverage ?? 1;
  tradeForm.plannedStop.value = trade.plannedStop ?? "";
  tradeForm.plannedTakeProfit.value = trade.plannedTakeProfit ?? "";
  tradeForm.plannedR.value = trade.plannedR ?? "";
  tradeForm.emotion.value = (trade.emotionTags && trade.emotionTags[0]) || "calm";
  tradeForm.strategyTags.value = (trade.strategyTags || []).join(", ");
  tradeForm.mistakeTags.value = (trade.mistakeTags || []).join(", ");
  tradeForm.tradeDate.value = trade.tradeDate || "";
  tradeForm.note.value = trade.note || "";
}

async function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ fileName: file.name, mimeType: file.type, dataUrl: reader.result });
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function fileToText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

function resizeCanvas() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = window.innerWidth;
  const height = window.innerHeight;
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function line(x1, y1, x2, y2, color, alpha, lineWidth = 1) {
  ctx.strokeStyle = color.replace("ALPHA", alpha);
  ctx.lineWidth = lineWidth;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function drawGrid(time) {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const horizon = height * 0.55;
  const vanishingX = width * 0.72;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";

  for (let i = -12; i <= 16; i += 1) {
    const startX = width * 0.5 + i * 72;
    line(startX, height, vanishingX, horizon, "rgba(79, 219, 255, ALPHA)", 0.08, 1);
  }

  for (let j = 0; j < 22; j += 1) {
    const t = j / 21;
    const y = horizon + Math.pow(t, 2.2) * (height - horizon);
    const drift = Math.sin(time * 0.001 + j) * 4;
    line(0, y + drift, width, y + drift, "rgba(79, 219, 255, ALPHA)", 0.05 + t * 0.08, 1);
  }

  ctx.restore();
}

function drawNodes(time) {
  const width = window.innerWidth;
  const height = window.innerHeight;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  nodes.forEach((node, index) => {
    const x = node.x * width + Math.sin(time * 0.0005 * node.speed + node.phase) * 28;
    const y = node.y * height * 0.78 + Math.cos(time * 0.0007 * node.speed + node.phase) * 20;
    const radius = 1.5 + node.z * 2.5;
    const alpha = 0.14 + node.z * 0.38;
    ctx.fillStyle = `rgba(79, 219, 255, ${alpha})`;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    const next = nodes[(index + 7) % nodes.length];
    const nextX = next.x * width;
    const nextY = next.y * height * 0.78;
    const distance = Math.hypot(x - nextX, y - nextY);
    if (distance < 320) {
      line(x, y, nextX, nextY, "rgba(76, 255, 176, ALPHA)", Math.max(0, 0.16 - distance / 2200));
    }
  });
  ctx.restore();
}

function drawStreams() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  streams.forEach((stream) => {
    stream.y += stream.speed;
    if (stream.y > 1.08) {
      stream.y = -0.08;
      stream.x = Math.random();
    }
    const x = stream.x * width;
    const y = stream.y * height;
    const len = stream.length * height;
    const color = stream.hue === 0 ? "79, 219, 255" : stream.hue === 1 ? "76, 255, 176" : stream.hue === 2 ? "255, 73, 106" : "255, 209, 102";
    const gradient = ctx.createLinearGradient(x, y - len, x, y);
    gradient.addColorStop(0, `rgba(${color}, 0)`);
    gradient.addColorStop(0.58, `rgba(${color}, 0.22)`);
    gradient.addColorStop(1, `rgba(${color}, 0)`);
    ctx.strokeStyle = gradient;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y - len);
    ctx.lineTo(x, y);
    ctx.stroke();
  });
  ctx.restore();
}

function drawScanFrame(time) {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const panelW = Math.min(520, width * 0.38);
  const panelH = Math.min(360, height * 0.36);
  const x = width * 0.56;
  const y = height * 0.18;
  const pulse = (Math.sin(time * 0.003) + 1) / 2;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.strokeStyle = `rgba(79, 219, 255, ${0.14 + pulse * 0.18})`;
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y, panelW, panelH);
  const scanY = y + (frame % 220) / 220 * panelH;
  line(x, scanY, x + panelW, scanY, "rgba(76, 255, 176, ALPHA)", 0.42, 2);
  for (let i = 0; i < 9; i += 1) {
    const bx = x + 22 + i * (panelW - 44) / 8;
    const barHeight = 30 + Math.sin(time * 0.002 + i) * 18 + i * 4;
    ctx.fillStyle = i % 3 === 0 ? "rgba(255, 73, 106, 0.22)" : "rgba(79, 219, 255, 0.18)";
    ctx.fillRect(bx, y + panelH - 34 - barHeight, 12, barHeight);
  }
  ctx.restore();
}

function drawCanvas(time = 0) {
  frame += 1;
  ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
  ctx.fillStyle = "#03070b";
  ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);
  drawGrid(time);
  drawStreams();
  drawNodes(time);
  drawScanFrame(time);
  requestAnimationFrame(drawCanvas);
}

window.addEventListener("resize", resizeCanvas);

boot().catch((error) => {
  console.error(error);
  authNote.textContent = "앱 초기화에 실패했습니다.";
});
