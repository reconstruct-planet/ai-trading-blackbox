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

const STORAGE_KEYS = {
  users: "atb.users.v1",
  session: "atb.session.v1"
};

let width = 0;
let height = 0;
let dpr = 1;
let frame = 0;
let authMode = "signup";
let users = [];
let sessionUserId = null;
let currentUser = null;
let editingTradeId = null;
let busy = false;

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

function readJSON(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function writeJSON(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function safeId() {
  return window.crypto?.randomUUID?.() ?? `id_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function wait(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

async function hashPassword(password) {
  const text = String(password || "");
  if (window.crypto?.subtle) {
    const bytes = new TextEncoder().encode(text);
    const digest = await window.crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  return btoa(unescape(encodeURIComponent(text)));
}

function formatUSDT(value) {
  const amount = Number(value || 0);
  const prefix = amount > 0 ? "+" : "";
  return `${prefix}${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT`;
}

function formatDateLabel(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function formatCompactDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("ko-KR", {
    month: "short",
    day: "numeric"
  }).format(date);
}

function emotionLabel(value) {
  const labels = {
    calm: "Calm",
    fomo: "FOMO",
    revenge: "Revenge",
    fear: "Fear"
  };
  return labels[value] || value || "-";
}

function sideLabel(value) {
  return value === "short" ? "Short" : "Long";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function loadUsers() {
  const raw = readJSON(STORAGE_KEYS.users, []);
  return Array.isArray(raw) ? raw : [];
}

function saveUsers(nextUsers) {
  users = nextUsers;
  writeJSON(STORAGE_KEYS.users, users);
}

function loadSession() {
  const raw = readJSON(STORAGE_KEYS.session, null);
  return raw && typeof raw === "object" ? raw : null;
}

function saveSession(userId) {
  sessionUserId = userId;
  writeJSON(STORAGE_KEYS.session, { userId });
}

function clearSession() {
  sessionUserId = null;
  localStorage.removeItem(STORAGE_KEYS.session);
}

function getCurrentUser() {
  if (!sessionUserId) return null;
  return users.find((user) => user.id === sessionUserId) || null;
}

function migrateUser(user) {
  const trades = Array.isArray(user.trades) ? user.trades : Array.isArray(user.entries) ? user.entries : [];
  return {
    id: user.id || safeId(),
    email: normalizeEmail(user.email),
    passwordHash: user.passwordHash || "",
    createdAt: user.createdAt || new Date().toISOString(),
    trades: trades.map((trade) => ({
      id: trade.id || safeId(),
      symbol: String(trade.symbol || "").toUpperCase(),
      side: trade.side === "short" ? "short" : "long",
      entryPrice: Number(trade.entryPrice || 0),
      exitPrice: Number(trade.exitPrice || 0),
      quantity: Number(trade.quantity || 0),
      leverage: Number(trade.leverage || 1),
      emotion: trade.emotion || "calm",
      note: String(trade.note || ""),
      tradeDate: trade.tradeDate || new Date().toISOString().slice(0, 10),
      pnl:
        typeof trade.pnl === "number"
          ? trade.pnl
          : ((trade.side === "short" ? Number(trade.entryPrice || 0) - Number(trade.exitPrice || 0) : Number(trade.exitPrice || 0) - Number(trade.entryPrice || 0)) *
              Number(trade.quantity || 0)),
      createdAt: trade.createdAt || new Date().toISOString(),
      updatedAt: trade.updatedAt || new Date().toISOString()
    }))
  };
}

function loadState() {
  users = loadUsers().map(migrateUser);
  sessionUserId = loadSession()?.userId || null;
  currentUser = getCurrentUser();
  if (sessionUserId && !currentUser) {
    clearSession();
  }
  saveUsers(users);
}

function getTrades() {
  return [...(currentUser?.trades || [])].sort((a, b) => new Date(b.tradeDate) - new Date(a.tradeDate) || new Date(b.updatedAt) - new Date(a.updatedAt));
}

function computeStats(trades) {
  const count = trades.length;
  const totalPnl = trades.reduce((sum, trade) => sum + trade.pnl, 0);
  const wins = trades.filter((trade) => trade.pnl > 0).length;
  const winRate = count ? Math.round((wins / count) * 100) : 0;
  const best = trades[0] || null;
  const worst = [...trades].sort((a, b) => a.pnl - b.pnl)[0] || null;
  const avgLeverage = count ? trades.reduce((sum, trade) => sum + trade.leverage, 0) / count : 0;
  return { count, totalPnl, wins, winRate, best, worst, avgLeverage };
}

function computeInsights(trades) {
  if (!trades.length) {
    return {
      lossTitle: "데이터 없음",
      lossMeta: "로그인 후 거래를 저장하면 표시됩니다.",
      ruleTitle: "기록 없음",
      ruleMeta: "거래를 저장하면 다음 행동 규칙이 계산됩니다.",
      feed: [
        "거래를 저장하면 AI 로그가 실제 데이터로 바뀝니다.",
        "현재 단계는 브라우저 저장 기반 MVP입니다.",
        "거래소 API 동기화는 Phase 2로 분리했습니다."
      ]
    };
  }

  const worst = [...trades].sort((a, b) => a.pnl - b.pnl)[0];
  const latest = trades[0];
  const leverageRisk = worst.leverage >= 10 ? "고배율" : "보통";
  const emotionTag = emotionLabel(worst.emotion);
  return {
    lossTitle: `${worst.symbol} ${worst.pnl < 0 ? "손실" : "수익"}`,
    lossMeta: `${formatUSDT(worst.pnl)} / ${formatCompactDate(worst.tradeDate)} / ${sideLabel(worst.side)} ${worst.leverage}x`,
    ruleTitle: worst.pnl < 0 ? "손절 고정" : "분할 익절",
    ruleMeta: `${emotionTag} 상태와 ${leverageRisk} 레버리지 조합을 다시 점검하세요.`,
    feed: [
      `${latest.symbol} 최근 거래 ${formatUSDT(latest.pnl)}가 최신 패턴입니다.`,
      `${emotionTag} 태그와 ${latest.leverage}x 레버리지 조합이 손익에 가장 큰 영향을 줍니다.`,
      `다음 거래 전 권장 규칙: ${worst.pnl < 0 ? "진입 전에 손절가부터 적기" : "계획 R과 청산 조건을 먼저 고정하기"}`
    ]
  };
}

function setBusy(nextBusy, context = "action") {
  busy = nextBusy;
  [authSubmit, tradeSubmit, tradeReset, logoutBtn, ...authModeButtons].forEach((button) => {
    if (!button) return;
    button.disabled = nextBusy && button !== tradeReset;
  });
  if (context === "auth") {
    authSubmit.textContent = nextBusy ? "처리 중..." : authMode === "signup" ? "회원가입" : "로그인";
  } else if (context === "trade") {
    tradeSubmit.textContent = nextBusy ? "저장 중..." : editingTradeId ? "거래 수정" : "거래 저장";
  }
}

function setAuthMode(nextMode) {
  authMode = nextMode;
  applyAuthModeUI(nextMode);
  authNote.textContent =
    nextMode === "signup"
      ? "이메일과 비밀번호로 계정을 만들고 바로 로그인합니다."
      : "기존 계정으로 로그인하면 저장된 거래가 다시 불러와집니다.";
}

function applyAuthModeUI(nextMode) {
  authModeButtons.forEach((button) => button.classList.toggle("is-active", button.dataset.authMode === nextMode));
  document.querySelectorAll(".signup-only").forEach((field) => {
    field.hidden = nextMode !== "signup";
  });
  authSubmit.textContent = nextMode === "signup" ? "회원가입" : "로그인";
}

function setCurrentUser(nextUserId) {
  saveSession(nextUserId);
  currentUser = getCurrentUser();
}

function setAuthMessage(message, tone = "info") {
  authNote.textContent = message;
  authNote.dataset.tone = tone;
}

function setTradeMessage(message, tone = "info") {
  tradeNote.textContent = message;
  tradeNote.dataset.tone = tone;
}

function getTradeFormValues() {
  const formData = new FormData(tradeForm);
  return {
    id: String(formData.get("id") || "").trim(),
    symbol: String(formData.get("symbol") || "").trim().toUpperCase(),
    side: String(formData.get("side") || "long"),
    entryPrice: Number(formData.get("entryPrice")),
    exitPrice: Number(formData.get("exitPrice")),
    quantity: Number(formData.get("quantity")),
    leverage: Number(formData.get("leverage")),
    emotion: String(formData.get("emotion") || "calm"),
    tradeDate: String(formData.get("tradeDate") || ""),
    note: String(formData.get("note") || "").trim()
  };
}

function validateTrade(values) {
  if (!currentUser) return "로그인 후 거래를 저장할 수 있습니다.";
  if (!values.symbol) return "심볼을 입력해 주세요.";
  if (!values.entryPrice || values.entryPrice <= 0) return "진입가는 0보다 커야 합니다.";
  if (!values.exitPrice || values.exitPrice <= 0) return "청산가는 0보다 커야 합니다.";
  if (!values.quantity || values.quantity <= 0) return "수량은 0보다 커야 합니다.";
  if (!values.leverage || values.leverage < 1) return "레버리지는 1 이상이어야 합니다.";
  if (!values.tradeDate) return "거래 날짜를 선택해 주세요.";
  if (!values.note) return "메모를 입력해 주세요.";
  return "";
}

function computePnl(values) {
  const delta = values.side === "short" ? values.entryPrice - values.exitPrice : values.exitPrice - values.entryPrice;
  return delta * values.quantity;
}

function syncTradeFormState() {
  const enabled = Boolean(currentUser);
  tradeForm.querySelectorAll("input, select, textarea, button").forEach((control) => {
    if (control.id === "tradeReset") return;
    control.disabled = !enabled;
  });
  if (!enabled) {
    tradeSubmit.textContent = "로그인 필요";
  } else if (editingTradeId) {
    tradeSubmit.textContent = "거래 수정";
  } else {
    tradeSubmit.textContent = "거래 저장";
  }
}

function fillTradeForm(trade) {
  tradeIdInput.value = trade.id;
  tradeForm.symbol.value = trade.symbol;
  tradeForm.side.value = trade.side;
  tradeForm.entryPrice.value = trade.entryPrice;
  tradeForm.exitPrice.value = trade.exitPrice;
  tradeForm.quantity.value = trade.quantity;
  tradeForm.leverage.value = trade.leverage;
  tradeForm.emotion.value = trade.emotion;
  tradeForm.tradeDate.value = trade.tradeDate;
  tradeForm.note.value = trade.note;
}

function resetTradeForm() {
  tradeForm.reset();
  tradeIdInput.value = "";
  editingTradeId = null;
  if (currentUser) {
    const now = new Date().toISOString().slice(0, 10);
    tradeForm.tradeDate.value = now;
  }
  syncTradeFormState();
  setTradeMessage("새 거래를 입력하면 아래 목록에 저장됩니다.");
}

function renderStats() {
  const trades = getTrades();
  const stats = computeStats(trades);
  const summary = [
    { label: "총 거래", value: stats.count.toString(), tone: "cyan" },
    { label: "총 손익", value: formatUSDT(stats.totalPnl), tone: stats.totalPnl >= 0 ? "green" : "red" },
    { label: "승률", value: `${stats.winRate}%`, tone: "amber" },
    { label: "평균 레버리지", value: `${stats.avgLeverage ? stats.avgLeverage.toFixed(1) : "0.0"}x`, tone: "violet" }
  ];

  statsGrid.innerHTML = summary
    .map(
      (item) => `
        <article class="stat-card">
          <span>${escapeHtml(item.label)}</span>
          <strong data-tone="${item.tone}">${escapeHtml(item.value)}</strong>
        </article>
      `
    )
    .join("");
}

function renderTradeTable() {
  const trades = getTrades();
  tradeTableBody.innerHTML = trades
    .map((trade) => {
      const pnlClass = trade.pnl >= 0 ? "positive" : "negative";
      return `
        <tr>
          <td>${escapeHtml(formatDateLabel(trade.tradeDate))}</td>
          <td><strong>${escapeHtml(trade.symbol)}</strong></td>
          <td>${escapeHtml(sideLabel(trade.side))} ${trade.leverage}x</td>
          <td class="${pnlClass}">${escapeHtml(formatUSDT(trade.pnl))}</td>
          <td>${escapeHtml(emotionLabel(trade.emotion))}</td>
          <td>${escapeHtml(trade.note)}</td>
          <td>
            <div class="row-actions">
              <button type="button" class="inline-button" data-action="edit" data-id="${escapeHtml(trade.id)}">편집</button>
              <button type="button" class="inline-button danger" data-action="delete" data-id="${escapeHtml(trade.id)}">삭제</button>
            </div>
          </td>
        </tr>
      `;
    })
    .join("");

  journalEmpty.hidden = trades.length > 0 || !currentUser;
}

function renderHeroAndFeed() {
  const trades = getTrades();
  const insights = computeInsights(trades);
  const latestTrade = trades[0] || null;

  heroLossTitle.textContent = insights.lossTitle;
  heroLossMeta.textContent = insights.lossMeta;
  heroPlanValue.textContent = currentUser ? "Logged in" : "Phase 1";
  heroPlanMeta.textContent = currentUser ? `계정: ${currentUser.email}` : "localStorage 기반 로그인, 거래일지, 대시보드";
  heroDataValue.textContent = currentUser ? `${trades.length} trades` : "Browser Storage";
  heroDataMeta.textContent = currentUser ? "이 브라우저에 저장되고 새로고침 후 다시 불러옵니다." : "이 브라우저에 저장되고 새로고침 후 다시 불러옵니다.";
  heroRuleValue.textContent = insights.ruleTitle;
  heroRuleMeta.textContent = insights.ruleMeta;

  aiFeed.innerHTML = `<span>AI LOG</span>${insights.feed.map((line) => `<p>${escapeHtml(line)}</p>`).join("")}`;

  if (latestTrade) {
    scanStatus.textContent = "SYNCED";
  } else {
    scanStatus.textContent = currentUser ? "READY" : "LOCKED";
  }
}

function renderAuth() {
  const signedIn = Boolean(currentUser);
  authForm.hidden = signedIn;
  sessionCard.hidden = !signedIn;
  logoutBtn.hidden = !signedIn;
  dashboardStatus.textContent = signedIn ? `로그인됨 · ${currentUser.email}` : "로그인 필요";
  sessionEmail.textContent = signedIn ? currentUser.email : "-";
  syncTradeFormState();
  authModeButtons.forEach((button) => {
    button.disabled = signedIn;
  });
  if (!signedIn) {
    applyAuthModeUI(authMode);
  }
}

function renderAll() {
  currentUser = getCurrentUser();
  renderAuth();
  renderStats();
  renderTradeTable();
  renderHeroAndFeed();
  updateDashboardLockState();
  if (!currentUser) {
    setTradeMessage("로그인하면 거래 저장, 수정, 삭제가 활성화됩니다.");
  } else if (!getTrades().length) {
    setTradeMessage("첫 거래를 저장하면 통계와 목록이 자동으로 채워집니다.");
  } else {
    setTradeMessage("거래를 저장하면 대시보드와 AI 로그가 즉시 갱신됩니다.");
  }
}

function setDashboardEnabled(enabled) {
  tradeForm.querySelectorAll("input, select, textarea").forEach((control) => {
    if (control.name !== "id") {
      control.disabled = !enabled;
    }
  });
  tradeSubmit.disabled = !enabled;
  tradeReset.disabled = !enabled;
}

function updateDashboardLockState() {
  const enabled = Boolean(currentUser);
  setDashboardEnabled(enabled);
  document.querySelector(".dashboard-panel").classList.toggle("is-locked", !enabled);
}

authModeButtons.forEach((button) => {
  button.addEventListener("click", () => {
    if (busy) return;
    setAuthMode(button.dataset.authMode);
  });
});

authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (busy) return;
  const formData = new FormData(authForm);
  const email = normalizeEmail(formData.get("email"));
  const password = String(formData.get("password") || "");
  const confirmPassword = String(formData.get("confirmPassword") || "");

  if (!email || !email.includes("@")) {
    setAuthMessage("유효한 이메일을 입력해 주세요.", "error");
    return;
  }
  if (password.length < 8) {
    setAuthMessage("비밀번호는 8자 이상이어야 합니다.", "error");
    return;
  }
  if (authMode === "signup" && password !== confirmPassword) {
    setAuthMessage("비밀번호 확인이 일치하지 않습니다.", "error");
    return;
  }

  setBusy(true, "auth");
  setAuthMessage("처리 중입니다...", "loading");
  await wait(250);

  try {
    const passwordHash = await hashPassword(password);
    const existingUser = users.find((user) => user.email === email);

    if (authMode === "signup") {
      if (existingUser) {
        setAuthMessage("이미 존재하는 이메일입니다. 로그인으로 전환해 주세요.", "error");
        return;
      }

      const nextUser = migrateUser({
        id: safeId(),
        email,
        passwordHash,
        createdAt: new Date().toISOString(),
        trades: []
      });
      const nextUsers = [...users, nextUser];
      saveUsers(nextUsers);
      setCurrentUser(nextUser.id);
      setAuthMessage("회원가입이 완료되었습니다. 로그인 상태로 대시보드를 열었습니다.", "success");
    } else {
      if (!existingUser) {
        setAuthMessage("계정을 찾을 수 없습니다. 먼저 회원가입해 주세요.", "error");
        return;
      }
      if (existingUser.passwordHash !== passwordHash) {
        setAuthMessage("비밀번호가 일치하지 않습니다.", "error");
        return;
      }
      setCurrentUser(existingUser.id);
      setAuthMessage("로그인되었습니다. 저장된 거래를 불러왔습니다.", "success");
    }

    authForm.reset();
    setAuthMode("login");
    renderAll();
  } finally {
    setBusy(false, "auth");
    renderAll();
  }
});

logoutBtn.addEventListener("click", () => {
  clearSession();
  currentUser = null;
  editingTradeId = null;
  resetTradeForm();
  renderAll();
  setAuthMessage("로그아웃했습니다. 다시 로그인하면 이전 거래를 불러올 수 있습니다.");
});

tradeReset.addEventListener("click", () => {
  if (!currentUser) return;
  resetTradeForm();
  renderAll();
});

tradeForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (busy) return;

  const values = getTradeFormValues();
  const validationMessage = validateTrade(values);
  if (validationMessage) {
    setTradeMessage(validationMessage, "error");
    return;
  }

  setBusy(true, "trade");
  setTradeMessage(values.id ? "거래를 수정하는 중입니다..." : "거래를 저장하는 중입니다...", "loading");
  await wait(220);

  try {
    const pnl = computePnl(values);
    const now = new Date().toISOString();
    const nextTrade = {
      id: values.id || safeId(),
      symbol: values.symbol,
      side: values.side,
      entryPrice: values.entryPrice,
      exitPrice: values.exitPrice,
      quantity: values.quantity,
      leverage: values.leverage,
      emotion: values.emotion,
      note: values.note,
      tradeDate: values.tradeDate,
      pnl,
      createdAt: values.id ? getTrades().find((trade) => trade.id === values.id)?.createdAt || now : now,
      updatedAt: now
    };

    const nextUsers = users.map((user) => {
      if (user.id !== currentUser.id) return user;
      const trades = [...(user.trades || [])];
      const existingIndex = trades.findIndex((trade) => trade.id === nextTrade.id);
      if (existingIndex >= 0) {
        trades[existingIndex] = nextTrade;
      } else {
        trades.unshift(nextTrade);
      }
      return { ...user, trades };
    });

    saveUsers(nextUsers);
    currentUser = getCurrentUser();
    editingTradeId = null;
    resetTradeForm();
    setTradeMessage(values.id ? "거래를 수정했습니다." : "거래를 저장했습니다.", "success");
    renderAll();
  } finally {
    setBusy(false, "trade");
    renderAll();
  }
});

tradeTableBody.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button || !currentUser) return;
  const tradeId = button.dataset.id;
  const action = button.dataset.action;
  const trade = getTrades().find((entry) => entry.id === tradeId);
  if (!trade) return;

  if (action === "edit") {
    editingTradeId = trade.id;
    fillTradeForm(trade);
    tradeSubmit.textContent = "거래 수정";
    setTradeMessage("편집할 거래를 불러왔습니다. 내용을 바꾼 뒤 저장하세요.");
    window.location.hash = "#app";
  }

  if (action === "delete") {
    const confirmed = window.confirm(`정말 ${trade.symbol} 거래를 삭제할까요?`);
    if (!confirmed) return;
    const nextUsers = users.map((user) => {
      if (user.id !== currentUser.id) return user;
      return { ...user, trades: (user.trades || []).filter((entry) => entry.id !== trade.id) };
    });
    saveUsers(nextUsers);
    currentUser = getCurrentUser();
    setTradeMessage("거래를 삭제했습니다.", "success");
    resetTradeForm();
    renderAll();
  }
});

demoPulse.addEventListener("click", () => {
  renderHeroAndFeed();
  demoPulse.textContent = currentUser && getTrades().length ? "실제 데이터 분석 완료" : "데모 스캔 실행";
  window.setTimeout(() => {
    demoPulse.textContent = "데모 스캔 실행";
  }, 1200);
});

function resizeCanvas() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  width = window.innerWidth;
  height = window.innerHeight;
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
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#03070b";
  ctx.fillRect(0, 0, width, height);
  drawGrid(time);
  drawStreams();
  drawNodes(time);
  drawScanFrame(time);
  requestAnimationFrame(drawCanvas);
}

window.addEventListener("resize", () => {
  resizeCanvas();
  renderHeroAndFeed();
});

function initializeApp() {
  loadState();
  resizeCanvas();

  if (users.length) {
    users = users.map(migrateUser);
    saveUsers(users);
  }

  if (!authModeButtons.some((button) => button.classList.contains("is-active"))) {
    setAuthMode("signup");
  }

  tradeForm.tradeDate.value = new Date().toISOString().slice(0, 10);
  renderAll();
  requestAnimationFrame(drawCanvas);
}

initializeApp();
