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
const reviewSummary = document.querySelector("#reviewSummary");
const reviewRange = document.querySelector("#reviewRange");
const reviewChecklist = document.querySelector("#reviewChecklist");
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
  calendar: [],
  loading: false
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
    if (!response.ok) {
      const message = payload?.error || payload || "request_failed";
      throw new Error(message);
    }
    return payload;
  });
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
  authSubmit.disabled = nextBusy;
  tradeSubmit.disabled = nextBusy;
  tradeReset.disabled = nextBusy;
  logoutBtn.disabled = nextBusy;
  connectionForm.querySelector('button[type="submit"]').disabled = nextBusy;
  generateReviewBtn.disabled = nextBusy;
  exportBtn.disabled = nextBusy;
  deleteAccountBtn.disabled = nextBusy;
  if (context === "auth") authSubmit.textContent = nextBusy ? "처리 중..." : authMode === "signup" ? "회원가입" : "로그인";
  if (context === "trade") tradeSubmit.textContent = nextBusy ? "저장 중..." : tradeIdInput.value ? "거래 수정" : "거래 저장";
  if (context === "connection") connectionForm.querySelector('button[type="submit"]').textContent = nextBusy ? "저장 중..." : "연결 저장";
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
  state.weeklyReview = reviewRes.review || reviewRes.computed || null;
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
  tradeForm.querySelectorAll("input, select, textarea, button").forEach((control) => {
    if (control.id === "tradeReset") return;
    control.disabled = !signedIn || busy;
  });
  connectionForm.querySelectorAll("input, select, textarea, button").forEach((control) => {
    control.disabled = !signedIn || busy;
  });
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
          (connection) => `
            <article class="connection-card">
              <div>
                <span>${escapeHtml(connection.exchange)}</span>
                <strong>${escapeHtml(connection.label)}</strong>
                <p>${escapeHtml(connection.permission_mode)} · ${escapeHtml(connection.api_key_last4 || "----")} · ${escapeHtml(connection.status)}</p>
              </div>
              <button type="button" class="inline-button danger" data-connection-delete="${connection.id}">삭제</button>
            </article>
          `
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
    reviewDetail.textContent = "-";
    return;
  }
  reviewSummary.textContent = review.summary || "주간 복기";
  reviewRange.textContent = `${formatWeek(review.week_start)} - ${formatWeek(review.week_end)}`;
  const checklist = JSON.parse(review.checklist || "[]");
  reviewChecklist.innerHTML = checklist.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  reviewDetail.textContent = review.summary || "-";
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

  connectionList.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-connection-delete]");
    if (!button) return;
    const connectionId = button.dataset.connectionDelete;
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
      state.weeklyReview = result.review || result.computed;
      render();
    } finally {
      setBusy(false, "trade");
    }
  });

  exportBtn.addEventListener("click", async () => {
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

async function deleteAccount() {
  await request("/api/account", { method: "DELETE", body: JSON.stringify({}) });
  await request("/api/auth/logout", { method: "POST", body: JSON.stringify({}) }).catch(() => {});
  await refreshSession();
}

window.addEventListener("resize", resizeCanvas);

boot().catch((error) => {
  console.error(error);
  authNote.textContent = "앱 초기화에 실패했습니다.";
});
