import http from "node:http";
import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = __dirname;
const dataDir = path.join(__dirname, "data");
const uploadsDir = path.join(dataDir, "uploads");
const appKeyPath = path.join(dataDir, "app.key");
const dbPath = path.join(dataDir, "app.sqlite");
const port = Number(process.env.PORT || 4173);

mkdirSync(dataDir, { recursive: true });
mkdirSync(uploadsDir, { recursive: true });
if (!existsSync(appKeyPath)) {
  writeFileSync(appKeyPath, crypto.randomBytes(32).toString("hex"), "utf8");
}
const masterKey = Buffer.from(readFileSync(appKeyPath, "utf8").trim(), "hex");

const db = new DatabaseSync(dbPath);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS profiles (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    display_name TEXT,
    timezone TEXT DEFAULT 'Asia/Seoul',
    free_plan INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS exchange_connections (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    exchange TEXT NOT NULL,
    label TEXT NOT NULL,
    status TEXT NOT NULL,
    api_key_last4 TEXT,
    permission_mode TEXT NOT NULL,
    notes TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS trades (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    symbol TEXT NOT NULL,
    market_type TEXT NOT NULL,
    side TEXT NOT NULL,
    entry_price REAL NOT NULL,
    exit_price REAL NOT NULL,
    quantity REAL NOT NULL,
    fee REAL NOT NULL DEFAULT 0,
    leverage REAL NOT NULL DEFAULT 1,
    planned_stop REAL,
    planned_take_profit REAL,
    planned_r REAL,
    actual_r REAL,
    strategy_tags TEXT NOT NULL DEFAULT '[]',
    emotion_tags TEXT NOT NULL DEFAULT '[]',
    mistake_tags TEXT NOT NULL DEFAULT '[]',
    note TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'manual',
    trade_date TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS trade_attachments (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    trade_id TEXT NOT NULL REFERENCES trades(id) ON DELETE CASCADE,
    file_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    file_path TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS weekly_reviews (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    week_start TEXT NOT NULL,
    week_end TEXT NOT NULL,
    summary TEXT NOT NULL,
    checklist TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(user_id, week_start)
  );
`);

function ensureColumn(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((entry) => entry.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function migrateSchema() {
  ensureColumn("exchange_connections", "api_key_ciphertext", "TEXT");
  ensureColumn("exchange_connections", "api_secret_ciphertext", "TEXT");
  ensureColumn("exchange_connections", "base_url", "TEXT");
  ensureColumn("exchange_connections", "symbols", "TEXT");
  ensureColumn("exchange_connections", "category", "TEXT");
  ensureColumn("exchange_connections", "last_sync_at", "TEXT");
  ensureColumn("exchange_connections", "last_sync_status", "TEXT");
  ensureColumn("exchange_connections", "last_sync_count", "INTEGER DEFAULT 0");
  ensureColumn("exchange_connections", "last_sync_error", "TEXT");
  ensureColumn("trades", "external_source", "TEXT");
  ensureColumn("trades", "external_ref", "TEXT");
  ensureColumn("trades", "raw_payload", "TEXT");
}

migrateSchema();

const sessionsCleanup = () => {
  const now = new Date().toISOString();
  db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now);
};

sessionsCleanup();

function nowISO() {
  return new Date().toISOString();
}

function id() {
  return crypto.randomUUID();
}

function json(res, status, payload, headers = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    ...headers
  });
  res.end(body);
}

function text(res, status, body, headers = {}) {
  res.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    ...headers
  });
  res.end(body);
}

function cookieHeader(name, value, options = {}) {
  const segments = [`${name}=${encodeURIComponent(value)}`];
  segments.push(`Path=${options.path || "/"}`);
  segments.push("HttpOnly");
  segments.push("SameSite=Lax");
  if (options.maxAge != null) segments.push(`Max-Age=${options.maxAge}`);
  if (options.expires) segments.push(`Expires=${options.expires.toUTCString()}`);
  return segments.join("; ");
}

function parseCookies(header = "") {
  const out = {};
  header.split(";").forEach((part) => {
    const [k, ...rest] = part.trim().split("=");
    if (!k) return;
    out[k] = decodeURIComponent(rest.join("="));
  });
  return out;
}

function getSessionUserId(req) {
  const cookies = parseCookies(req.headers.cookie || "");
  const token = cookies.atb_session;
  if (!token) return null;
  const row = db.prepare("SELECT user_id, expires_at FROM sessions WHERE token = ?").get(token);
  if (!row) return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
    return null;
  }
  return row.user_id;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve(null);
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(String(password || ""), salt, 64).toString("hex");
  return { salt, hash };
}

function verifyPassword(password, salt, hash) {
  const next = crypto.scryptSync(String(password || ""), salt, 64).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(next, "hex"), Buffer.from(hash, "hex"));
}

function encryptSecret(value) {
  if (!value) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", masterKey, iv);
  const encrypted = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

function decryptSecret(payload) {
  if (!payload) return null;
  const [ivHex, tagHex, dataHex] = String(payload).split(":");
  if (!ivHex || !tagHex || !dataHex) return null;
  const decipher = crypto.createDecipheriv("aes-256-gcm", masterKey, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(dataHex, "hex")), decipher.final()]);
  return decrypted.toString("utf8");
}

function safeConnectionRow(row) {
  if (!row) return null;
  const { api_key_ciphertext, api_secret_ciphertext, ...safe } = row;
  return safe;
}

function safeTradeRow(trade) {
  if (!trade) return null;
  return {
    ...trade,
    strategy_tags: JSON.parse(trade.strategy_tags || "[]"),
    emotion_tags: JSON.parse(trade.emotion_tags || "[]"),
    mistake_tags: JSON.parse(trade.mistake_tags || "[]")
  };
}

function requireAuth(req, res) {
  const userId = getSessionUserId(req);
  if (!userId) {
    json(res, 401, { error: "unauthorized" });
    return null;
  }
  return userId;
}

function getUser(userId) {
  return db.prepare("SELECT id, email, created_at FROM users WHERE id = ?").get(userId);
}

function ensureProfile(userId) {
  const existing = db.prepare("SELECT user_id FROM profiles WHERE user_id = ?").get(userId);
  if (!existing) {
    const now = nowISO();
    db.prepare(
      "INSERT INTO profiles (user_id, display_name, timezone, free_plan, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)"
    ).run(userId, null, "Asia/Seoul", now, now);
  }
}

function queryTrades(userId) {
  return db
    .prepare(
      "SELECT * FROM trades WHERE user_id = ? ORDER BY date(trade_date) DESC, datetime(updated_at) DESC, datetime(created_at) DESC"
    )
    .all(userId)
    .map((trade) => safeTradeRow(trade));
}

function queryAttachments(userId, tradeId) {
  const base = "SELECT * FROM trade_attachments WHERE user_id = ?";
  const params = [userId];
  const sql = tradeId ? `${base} AND trade_id = ?` : base;
  if (tradeId) params.push(tradeId);
  return db.prepare(sql).all(...params);
}

function calculatePnl(trade) {
  const delta = trade.side === "short" ? trade.entry_price - trade.exit_price : trade.exit_price - trade.entry_price;
  return delta * trade.quantity - Number(trade.fee || 0);
}

function calculateActualR(trade) {
  const risk = trade.planned_stop ? Math.abs(trade.entry_price - trade.planned_stop) * trade.quantity : 0;
  if (!risk) return null;
  return (calculatePnl(trade) / risk).toFixed(2);
}

function computeWeeklyReview(userId, weekStartISO) {
  const weekStart = new Date(weekStartISO);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);
  const start = weekStart.toISOString().slice(0, 10);
  const end = weekEnd.toISOString().slice(0, 10);
  const trades = db
    .prepare(
      "SELECT * FROM trades WHERE user_id = ? AND trade_date BETWEEN ? AND ? ORDER BY date(trade_date) DESC"
    )
    .all(userId, start, end)
    .map((trade) => safeTradeRow(trade));

  const scored = trades.map((trade) => ({ ...trade, pnl: calculatePnl(trade) }));
  const totalPnl = scored.reduce((sum, trade) => sum + trade.pnl, 0);
  const worstTrade = [...scored].sort((a, b) => a.pnl - b.pnl)[0] || null;
  const bestTrade = [...scored].sort((a, b) => b.pnl - a.pnl)[0] || null;
  const mostCommonMistake = scored.flatMap((trade) => trade.mistake_tags || []).reduce((map, tag) => {
    map.set(tag, (map.get(tag) || 0) + 1);
    return map;
  }, new Map());
  const topMistake = [...mostCommonMistake.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "손절 미준수";
  const winConditionScores = new Map();
  const lossPatternScores = new Map();
  scored.forEach((trade) => {
    const tags = [...(trade.strategy_tags || []), ...(trade.emotion_tags || [])].filter(Boolean);
    tags.forEach((tag) => {
      const target = trade.pnl >= 0 ? winConditionScores : lossPatternScores;
      target.set(tag, (target.get(tag) || 0) + trade.pnl);
    });
  });
  const topWins = [...winConditionScores.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([tag, pnl]) => `${tag} · ${pnl.toFixed(2)} USDT`);
  const topLosses = [...lossPatternScores.entries()].sort((a, b) => a[1] - b[1]).slice(0, 3).map(([tag, pnl]) => `${tag} · ${pnl.toFixed(2)} USDT`);
  const checklist = [
    "진입 전에 손절가를 먼저 적기",
    "감정 태그를 거래 후 즉시 남기기",
    "계획 R 대비 실제 R을 기록하기",
    "고배율 진입은 사전에 이유를 적기"
  ];
  const summary = trades.length
    ? `이번 주 ${start} ~ ${end} 사이 ${trades.length}건의 거래에서 총 손익 ${totalPnl.toFixed(2)} USDT. 가장 큰 손실은 ${
        worstTrade ? worstTrade.symbol : "-"
      }였고, 가장 자주 반복된 실수는 ${topMistake}였습니다.`
    : `이번 주 ${start} ~ ${end}에는 저장된 거래가 없습니다.`;
  return { weekStart: start, weekEnd: end, summary, checklist, trades: scored, topWins, topLosses, worstTrade, bestTrade, topMistake };
}

function serveStatic(req, res, pathname) {
  if (pathname === "/favicon.ico") {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#03070b"/><path d="M15 38h7l5-14 8 25 6-20h8" fill="none" stroke="#4cffb0" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="48" cy="20" r="5" fill="#4fdbff"/></svg>`;
    res.writeHead(200, {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Content-Length": Buffer.byteLength(svg)
    });
    res.end(svg);
    return true;
  }
  const fileMap = {
    "/": "index.html",
    "/styles.css": "styles.css",
    "/app.js": "app.js",
    "/README.md": "README.md",
    "/crypto-trading-journal-product-plan.md": "crypto-trading-journal-product-plan.md",
    "/supabase-schema.sql": "supabase-schema.sql"
  };
  const file = fileMap[pathname];
  if (!file) return false;
  const fullPath = path.join(publicDir, file);
  if (!existsSync(fullPath)) {
    text(res, 404, "not found");
    return true;
  }
  const ext = path.extname(fullPath);
  const contentType =
    ext === ".html"
      ? "text/html; charset=utf-8"
      : ext === ".css"
        ? "text/css; charset=utf-8"
        : ext === ".js"
          ? "text/javascript; charset=utf-8"
          : ext === ".sql"
            ? "text/plain; charset=utf-8"
            : "text/plain; charset=utf-8";
  const stream = createReadStream(fullPath);
  res.writeHead(200, { "Content-Type": contentType });
  stream.pipe(res);
  return true;
}

async function handleApi(req, res, pathname) {
  if (pathname === "/api/session" && req.method === "GET") {
    const userId = getSessionUserId(req);
    if (!userId) return json(res, 200, { user: null });
    ensureProfile(userId);
    const user = getUser(userId);
    const profile = db.prepare("SELECT * FROM profiles WHERE user_id = ?").get(userId);
    const connections = db.prepare("SELECT * FROM exchange_connections WHERE user_id = ? ORDER BY datetime(created_at) DESC").all(userId).map(safeConnectionRow);
    const stats = getDashboardStats(userId);
    return json(res, 200, { user: { ...user, profile, connections, stats } });
  }

  if (pathname === "/api/auth/signup" && req.method === "POST") {
    const body = await readBody(req);
    const email = normalizeEmail(body?.email);
    const password = String(body?.password || "");
    if (!email || !email.includes("@")) return json(res, 400, { error: "invalid_email" });
    if (password.length < 8) return json(res, 400, { error: "password_too_short" });
    const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
    if (existing) return json(res, 409, { error: "email_exists" });
    const userId = id();
    const createdAt = nowISO();
    const { salt, hash } = hashPassword(password);
    db.prepare("INSERT INTO users (id, email, password_hash, password_salt, created_at) VALUES (?, ?, ?, ?, ?)").run(
      userId,
      email,
      hash,
      salt,
      createdAt
    );
    ensureProfile(userId);
    const token = createSession(userId);
    const user = getUser(userId);
    const profile = db.prepare("SELECT * FROM profiles WHERE user_id = ?").get(userId);
    json(
      res,
      200,
      { user: { ...user, profile } },
      { "Set-Cookie": cookieHeader("atb_session", token, { maxAge: 60 * 60 * 24 * 30 }) }
    );
    return;
  }

  if (pathname === "/api/auth/login" && req.method === "POST") {
    const body = await readBody(req);
    const email = normalizeEmail(body?.email);
    const password = String(body?.password || "");
    const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
    if (!user) return json(res, 401, { error: "invalid_credentials" });
    const ok = verifyPassword(password, user.password_salt, user.password_hash);
    if (!ok) return json(res, 401, { error: "invalid_credentials" });
    ensureProfile(user.id);
    const token = createSession(user.id);
    const profile = db.prepare("SELECT * FROM profiles WHERE user_id = ?").get(user.id);
    json(
      res,
      200,
      { user: { id: user.id, email: user.email, created_at: user.created_at, profile } },
      { "Set-Cookie": cookieHeader("atb_session", token, { maxAge: 60 * 60 * 24 * 30 }) }
    );
    return;
  }

  if (pathname === "/api/auth/logout" && req.method === "POST") {
    const cookies = parseCookies(req.headers.cookie || "");
    if (cookies.atb_session) {
      db.prepare("DELETE FROM sessions WHERE token = ?").run(cookies.atb_session);
    }
    json(
      res,
      200,
      { ok: true },
      { "Set-Cookie": cookieHeader("atb_session", "", { maxAge: 0, expires: new Date(0) }) }
    );
    return;
  }

  const userId = requireAuth(req, res);
  if (!userId) return;

  if (pathname === "/api/account" && req.method === "DELETE") {
    const attachments = queryAttachments(userId);
    for (const attachment of attachments) {
      const fullPath = path.join(dataDir, attachment.file_path);
      if (existsSync(fullPath)) {
        await unlink(fullPath).catch(() => {});
      }
    }
    db.prepare("DELETE FROM users WHERE id = ?").run(userId);
    db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
    return json(res, 200, { ok: true });
  }

  if (pathname === "/api/trades" && req.method === "GET") {
    return json(res, 200, { trades: queryTrades(userId), attachments: queryAttachments(userId) });
  }

  if (pathname === "/api/trades" && req.method === "POST") {
    const body = await readBody(req);
    const trade = normalizeTradeBody(body, userId);
    const tradeId = id();
    const createdAt = nowISO();
    db.prepare(
      `INSERT INTO trades (
        id, user_id, symbol, market_type, side, entry_price, exit_price, quantity, fee, leverage,
        planned_stop, planned_take_profit, planned_r, actual_r, strategy_tags, emotion_tags, mistake_tags,
        note, source, trade_date, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      tradeId,
      userId,
      trade.symbol,
      trade.market_type,
      trade.side,
      trade.entry_price,
      trade.exit_price,
      trade.quantity,
      trade.fee,
      trade.leverage,
      trade.planned_stop,
      trade.planned_take_profit,
      trade.planned_r,
      trade.actual_r,
      JSON.stringify(trade.strategy_tags),
      JSON.stringify(trade.emotion_tags),
      JSON.stringify(trade.mistake_tags),
      trade.note,
      trade.source,
      trade.trade_date,
      createdAt,
      createdAt
    );
    if (Array.isArray(body?.attachments)) {
      await saveAttachments(userId, tradeId, body.attachments);
    }
    return json(res, 200, { trade: db.prepare("SELECT * FROM trades WHERE id = ?").get(tradeId) });
  }

  if (pathname.startsWith("/api/trades/") && req.method === "PUT") {
    const tradeId = pathname.split("/").pop();
    const existing = db.prepare("SELECT * FROM trades WHERE id = ? AND user_id = ?").get(tradeId, userId);
    if (!existing) return json(res, 404, { error: "not_found" });
    const body = await readBody(req);
    const trade = normalizeTradeBody(body, userId, existing);
    const updatedAt = nowISO();
    db.prepare(
      `UPDATE trades SET
        symbol = ?, market_type = ?, side = ?, entry_price = ?, exit_price = ?, quantity = ?, fee = ?, leverage = ?,
        planned_stop = ?, planned_take_profit = ?, planned_r = ?, actual_r = ?, strategy_tags = ?, emotion_tags = ?,
        mistake_tags = ?, note = ?, source = ?, trade_date = ?, updated_at = ?
      WHERE id = ? AND user_id = ?`
    ).run(
      trade.symbol,
      trade.market_type,
      trade.side,
      trade.entry_price,
      trade.exit_price,
      trade.quantity,
      trade.fee,
      trade.leverage,
      trade.planned_stop,
      trade.planned_take_profit,
      trade.planned_r,
      trade.actual_r,
      JSON.stringify(trade.strategy_tags),
      JSON.stringify(trade.emotion_tags),
      JSON.stringify(trade.mistake_tags),
      trade.note,
      trade.source,
      trade.trade_date,
      updatedAt,
      tradeId,
      userId
    );
    if (Array.isArray(body?.attachments)) {
      await saveAttachments(userId, tradeId, body.attachments, true);
    }
    return json(res, 200, { trade: db.prepare("SELECT * FROM trades WHERE id = ?").get(tradeId) });
  }

  if (pathname.startsWith("/api/trades/") && req.method === "DELETE") {
    const tradeId = pathname.split("/").pop();
    db.prepare("DELETE FROM trades WHERE id = ? AND user_id = ?").run(tradeId, userId);
    db.prepare("DELETE FROM trade_attachments WHERE trade_id = ? AND user_id = ?").run(tradeId, userId);
    return json(res, 200, { ok: true });
  }

  if (pathname === "/api/connections" && req.method === "GET") {
    const connections = db.prepare("SELECT * FROM exchange_connections WHERE user_id = ? ORDER BY datetime(created_at) DESC").all(userId).map(safeConnectionRow);
    return json(res, 200, { connections });
  }

  if (pathname === "/api/connections" && req.method === "POST") {
    const body = await readBody(req);
    if (!body?.exchange || !body?.label) return json(res, 400, { error: "invalid_connection" });
    if (String(body?.permissionMode || "read-only") !== "read-only") return json(res, 400, { error: "read_only_only" });
    const stored = normalizeConnectionForStore(body);
    if (String(stored.exchange).toLowerCase().includes("bybit") && (!stored.api_key_ciphertext || !stored.api_secret_ciphertext)) {
      return json(res, 400, { error: "bybit_credentials_required" });
    }
    const connectionId = id();
    const createdAt = nowISO();
    db.prepare(
      `INSERT INTO exchange_connections (
        id, user_id, exchange, label, status, api_key_last4, permission_mode, notes, api_key_ciphertext, api_secret_ciphertext, base_url, symbols, category, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      connectionId,
      userId,
      stored.exchange,
      stored.label,
      stored.status,
      stored.api_key_last4,
      stored.permission_mode,
      stored.notes,
      stored.api_key_ciphertext,
      stored.api_secret_ciphertext,
      stored.base_url,
      stored.symbols,
      stored.category,
      createdAt,
      createdAt
    );
    return json(res, 200, { connection: safeConnectionRow(db.prepare("SELECT * FROM exchange_connections WHERE id = ?").get(connectionId)) });
  }

  if (pathname.startsWith("/api/connections/") && req.method === "DELETE") {
    const connectionId = pathname.split("/").pop();
    db.prepare("DELETE FROM exchange_connections WHERE id = ? AND user_id = ?").run(connectionId, userId);
    return json(res, 200, { ok: true });
  }

  if (pathname.startsWith("/api/connections/") && pathname.endsWith("/sync") && req.method === "POST") {
    const connectionId = pathname.split("/")[3];
    const connection = db.prepare("SELECT * FROM exchange_connections WHERE id = ? AND user_id = ?").get(connectionId, userId);
    if (!connection) return json(res, 404, { error: "not_found" });
    const body = await readBody(req);
    if (String(connection.exchange).toLowerCase().includes("bybit")) {
      try {
        const result = await syncBybitConnection(connection, userId, body || {});
        return json(res, 200, { ok: true, connection: safeConnectionRow(db.prepare("SELECT * FROM exchange_connections WHERE id = ?").get(connectionId)), result });
      } catch (error) {
        db.prepare(
          `UPDATE exchange_connections SET last_sync_at = ?, last_sync_status = ?, last_sync_count = ?, last_sync_error = ? WHERE id = ? AND user_id = ?`
        ).run(nowISO(), "error", 0, String(error.message || error), connectionId, userId);
        return json(res, 200, {
          ok: false,
          error: String(error.message || error),
          connection: safeConnectionRow(db.prepare("SELECT * FROM exchange_connections WHERE id = ?").get(connectionId))
        });
      }
    }
    return json(res, 200, { ok: false, error: "sync_not_supported", connection: safeConnectionRow(connection) });
  }

  if (pathname === "/api/import/csv" && req.method === "POST") {
    const body = await readBody(req);
    const text = String(body?.text || "");
    if (!text.trim()) return json(res, 400, { error: "empty_csv" });
    const rows = parseCsv(text);
    if (!rows.length) return json(res, 400, { error: "empty_csv" });
    const result = importCsvTrades(rows, userId, {
      source: "csv",
      externalSource: "csv",
      externalRefPrefix: body?.fileName ? hashTradeRef({ fileName: body.fileName }) : "csv"
    });
    return json(res, 200, { ok: true, ...result });
  }

  if (pathname === "/api/weekly-review" && req.method === "GET") {
    const weekStart = String(new URL(req.url, `http://${req.headers.host}`).searchParams.get("weekStart") || defaultWeekStart());
    const review = computeWeeklyReview(userId, weekStart);
    const existing = db.prepare("SELECT * FROM weekly_reviews WHERE user_id = ? AND week_start = ?").get(userId, review.weekStart);
    const reviewId = id();
    const now = nowISO();
    if (existing) {
      db.prepare(
        "UPDATE weekly_reviews SET week_end = ?, summary = ?, checklist = ?, updated_at = ? WHERE id = ? AND user_id = ?"
      ).run(review.weekEnd, review.summary, JSON.stringify(review.checklist), now, existing.id, userId);
      return json(res, 200, { review: db.prepare("SELECT * FROM weekly_reviews WHERE id = ?").get(existing.id), computed: review });
    }
    db.prepare(
      "INSERT INTO weekly_reviews (id, user_id, week_start, week_end, summary, checklist, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(reviewId, userId, review.weekStart, review.weekEnd, review.summary, JSON.stringify(review.checklist), now, now);
    return json(res, 200, { review: db.prepare("SELECT * FROM weekly_reviews WHERE id = ?").get(reviewId), computed: review });
  }

  if (pathname === "/api/summary" && req.method === "GET") {
    return json(res, 200, { summary: getDashboardStats(userId), calendar: getCalendar(userId), review: computeWeeklyReview(userId, defaultWeekStart()) });
  }

  if (pathname === "/api/upload-attachment" && req.method === "POST") {
    const body = await readBody(req);
    const { tradeId, fileName, mimeType, dataUrl } = body || {};
    if (!tradeId || !fileName || !dataUrl) return json(res, 400, { error: "invalid_upload" });
    const attachmentId = id();
    const ext = mimeType?.split("/")[1] || "bin";
    const filePath = path.join("uploads", `${attachmentId}.${ext}`);
    const fullPath = path.join(dataDir, filePath);
    const payload = Buffer.from(String(dataUrl).split(",").pop() || "", "base64");
    await writeFile(fullPath, payload);
    db.prepare(
      "INSERT INTO trade_attachments (id, user_id, trade_id, file_name, mime_type, file_path, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(attachmentId, userId, tradeId, fileName, mimeType || "application/octet-stream", filePath, nowISO());
    return json(res, 200, { attachment: db.prepare("SELECT * FROM trade_attachments WHERE id = ?").get(attachmentId) });
  }

  text(res, 404, "not found");
}

function createSession(userId) {
  const token = crypto.randomBytes(32).toString("hex");
  const expires = new Date();
  expires.setDate(expires.getDate() + 30);
  db.prepare("INSERT INTO sessions (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)").run(
    token,
    userId,
    expires.toISOString(),
    nowISO()
  );
  return token;
}

async function bybitRequest(connection, pathName, params = {}) {
  const baseUrl = connection.base_url || "https://api-testnet.bybit.com";
  const apiKey = decryptSecret(connection.api_key_ciphertext);
  const apiSecret = decryptSecret(connection.api_secret_ciphertext);
  if (!apiKey || !apiSecret) throw new Error("missing_api_credentials");
  const url = new URL(pathName, baseUrl);
  Object.entries(params).forEach(([key, value]) => {
    if (value != null && value !== "") url.searchParams.set(key, String(value));
  });
  const timestamp = Date.now().toString();
  const recvWindow = "5000";
  const queryString = url.searchParams.toString();
  const signPayload = `${timestamp}${apiKey}${recvWindow}${queryString}`;
  const signature = crypto.createHmac("sha256", apiSecret).update(signPayload).digest("hex");
  const response = await fetch(url, {
    method: "GET",
    headers: {
      "X-BAPI-API-KEY": apiKey,
      "X-BAPI-TIMESTAMP": timestamp,
      "X-BAPI-RECV-WINDOW": recvWindow,
      "X-BAPI-SIGN": signature,
      "Content-Type": "application/json"
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || Number(payload.retCode) !== 0) {
    throw new Error(payload.retMsg || `http_${response.status}`);
  }
  return payload.result || {};
}

async function syncBybitConnection(connection, userId, overrides = {}) {
  const category = String(overrides.category || connection.category || "linear").trim() || "linear";
  const symbols = normalizeTags(overrides.symbols || connection.symbols || "")
    .map((value) => value.toUpperCase())
    .filter(Boolean);
  if (!symbols.length) throw new Error("symbols_required");

  let imported = 0;
  let updated = 0;
  const rows = [];
  for (const symbol of symbols) {
    let cursor = null;
    do {
      const result = await bybitRequest(connection, "/v5/position/closed-pnl", {
        category,
        symbol,
        limit: 100,
        ...(cursor ? { cursor } : {})
      });
      const list = Array.isArray(result.list) ? result.list : [];
      for (const item of list) {
        const tradePayload = normalizeImportedTrade(item, {
          source: "bybit",
          externalSource: "bybit-closed-pnl",
          externalRef: `${category}:${symbol}:${item.orderId || item.updatedTime}`,
          marketType: "futures",
          symbol,
          side: item.side === "Buy" ? "short" : "long",
          note: `Imported from Bybit ${category} closed PnL`,
          strategyTags: ["bybit-sync"],
          emotionTags: [],
          mistakeTags: []
        });
        if (!tradePayload) continue;
        const existing = db.prepare("SELECT id FROM trades WHERE user_id = ? AND external_ref = ?").get(userId, tradePayload.external_ref);
        upsertImportedTrade(userId, tradePayload);
        if (existing) updated += 1;
        else imported += 1;
        rows.push({
          symbol: tradePayload.symbol,
          tradeDate: tradePayload.trade_date,
          pnl: tradePayload.pnl,
          externalRef: tradePayload.external_ref
        });
      }
      cursor = result.nextPageCursor || null;
    } while (cursor);
  }

  db.prepare(
    `UPDATE exchange_connections
     SET last_sync_at = ?, last_sync_status = ?, last_sync_count = ?, last_sync_error = ?
     WHERE id = ? AND user_id = ?`
  ).run(nowISO(), "success", imported + updated, null, connection.id, userId);
  return { imported, updated, rows };
}

function normalizeConnectionForStore(body) {
  const exchange = String(body?.exchange || "").trim();
  const lower = exchange.toLowerCase();
  const isBybit = lower.includes("bybit");
  const isBinance = lower.includes("binance");
  const baseUrl =
    String(body?.baseUrl || "").trim() ||
    (isBybit ? "https://api-testnet.bybit.com" : isBinance ? "https://fapi.binance.com" : "");
  return {
    exchange,
    label: String(body?.label || "").trim(),
    status: String(body?.status || "active"),
    api_key_last4: String(body?.apiKeyLast4 || body?.api_key_last4 || "").trim().slice(-4) || null,
    permission_mode: String(body?.permissionMode || body?.permission_mode || "read-only"),
    notes: String(body?.notes || "").trim() || null,
    api_key_ciphertext: encryptSecret(String(body?.apiKey || body?.api_key || "").trim() || null),
    api_secret_ciphertext: encryptSecret(String(body?.apiSecret || body?.api_secret || "").trim() || null),
    base_url: baseUrl || null,
    symbols: String(body?.symbols || "").trim() || null,
    category: String(body?.category || (isBybit ? "linear" : "umfutures")).trim() || null
  };
}

function importCsvTrades(rows, userId, context = {}) {
  let imported = 0;
  let updated = 0;
  const importedRows = [];
  for (const row of rows) {
    const payload = normalizeImportedTrade(row, {
      source: context.source || "csv",
      externalSource: context.externalSource || "csv",
      externalRef: context.externalRefPrefix ? `${context.externalRefPrefix}:${hashTradeRef(row)}` : hashTradeRef(row),
      marketType: context.marketType || row.market_type || "futures",
      note: context.note || "Imported from CSV"
    });
    if (!payload) continue;
    const existing = db.prepare("SELECT id FROM trades WHERE user_id = ? AND external_ref = ?").get(userId, payload.external_ref);
    upsertImportedTrade(userId, payload);
    if (existing) updated += 1;
    else imported += 1;
    importedRows.push(payload);
  }
  return { imported, updated, importedRows };
}

function defaultWeekStart() {
  const now = new Date();
  const day = now.getDay();
  const diff = (day + 6) % 7;
  now.setDate(now.getDate() - diff);
  return now.toISOString().slice(0, 10);
}

function normalizeTradeBody(body, userId, existing = null) {
  const strategyTags = normalizeTags(body?.strategyTags || body?.strategy_tags);
  const emotionTags = normalizeTags(body?.emotionTags || body?.emotion_tags);
  const mistakeTags = normalizeTags(body?.mistakeTags || body?.mistake_tags);
  const trade = {
    symbol: String(body?.symbol || existing?.symbol || "").trim().toUpperCase(),
    market_type: String(body?.marketType || body?.market_type || existing?.market_type || "futures"),
    side: String(body?.side || existing?.side || "long"),
    entry_price: Number(body?.entryPrice ?? body?.entry_price ?? existing?.entry_price ?? 0),
    exit_price: Number(body?.exitPrice ?? body?.exit_price ?? existing?.exit_price ?? 0),
    quantity: Number(body?.quantity ?? existing?.quantity ?? 0),
    fee: Number(body?.fee ?? existing?.fee ?? 0),
    leverage: Number(body?.leverage ?? existing?.leverage ?? 1),
    planned_stop: body?.plannedStop != null ? Number(body.plannedStop) : body?.planned_stop != null ? Number(body.planned_stop) : existing?.planned_stop ?? null,
    planned_take_profit:
      body?.plannedTakeProfit != null
        ? Number(body.plannedTakeProfit)
        : body?.planned_take_profit != null
          ? Number(body.planned_take_profit)
          : existing?.planned_take_profit ?? null,
    planned_r: body?.plannedR != null ? Number(body.plannedR) : body?.planned_r != null ? Number(body.planned_r) : existing?.planned_r ?? null,
    actual_r: body?.actualR != null ? Number(body.actualR) : body?.actual_r != null ? Number(body.actual_r) : existing?.actual_r ?? null,
    strategy_tags: strategyTags,
    emotion_tags: emotionTags,
    mistake_tags: mistakeTags,
    note: String(body?.note || existing?.note || ""),
    source: String(body?.source || existing?.source || "manual"),
    trade_date: String(body?.tradeDate || body?.trade_date || existing?.trade_date || nowISO().slice(0, 10))
  };
  trade.actual_r = trade.actual_r ?? Number.isFinite(trade.planned_stop) ? Number(calculatePnl(trade) / Math.max(Math.abs(trade.entry_price - trade.planned_stop) * trade.quantity, 1)).toFixed(2) : null;
  return trade;
}

function normalizeImportedTrade(row, context = {}) {
  const symbol = String(
    firstMatching(row, ["symbol", "pair", "market", "market_symbol", "instrument", "ticker"]) || context.symbol || ""
  )
    .trim()
    .toUpperCase();
  if (!symbol) return null;
  const side = inferSide(firstMatching(row, ["side", "direction", "position", "trade_side", "buy_sell"]) || context.side || "long");
  const entry = toNumberOrNull(firstMatching(row, ["avg entry price", "entry price", "entry", "buy price", "open price"])) ?? 0;
  const exit = toNumberOrNull(firstMatching(row, ["avg exit price", "exit price", "exit", "sell price", "close price"])) ?? 0;
  const quantity =
    toNumberOrNull(firstMatching(row, ["closed size", "qty", "quantity", "size", "volume", "amount"])) ??
    toNumberOrNull(firstMatching(row, ["filled qty", "executed qty"])) ??
    0;
  const fee =
    toNumberOrNull(firstMatching(row, ["fee", "commission", "trading fee", "open fee", "close fee"])) ??
    ((toNumberOrNull(firstMatching(row, ["open fee"])) || 0) + (toNumberOrNull(firstMatching(row, ["close fee"])) || 0));
  const leverage = toNumberOrNull(firstMatching(row, ["leverage", "lev"])) || 1;
  const pnl =
    toNumberOrNull(firstMatching(row, ["closed pnl", "realized pnl", "pnl", "realised pnl"])) ??
    (exit && entry ? calculatePnl({ side, entry_price: entry, exit_price: exit, quantity, fee }) : 0);
  const tradeTime = firstMatching(row, ["createdtime", "updatedtime", "exec time", "trade time", "date", "time"]) || "";
  const tradeDate = parseDateText(tradeTime);
  return {
    symbol,
    market_type: String(context.marketType || row.market_type || row.market || row.category || "futures"),
    side,
    entry_price: entry,
    exit_price: exit,
    quantity,
    fee,
    leverage,
    planned_stop: null,
    planned_take_profit: null,
    planned_r: null,
    actual_r: null,
    strategy_tags: context.strategyTags || ["imported"],
    emotion_tags: context.emotionTags || [],
    mistake_tags: context.mistakeTags || [],
    note:
      String(firstMatching(row, ["note", "memo", "comment", "remark"]) || context.note || "Imported trade from CSV/API")
        .trim(),
    source: context.source || "import",
    trade_date: tradeDate,
    external_source: context.externalSource || "csv",
    external_ref: context.externalRef || hashTradeRef({ row, context }),
    raw_payload: JSON.stringify(row),
    pnl
  };
}

function upsertImportedTrade(userId, payload) {
  const existing = db.prepare("SELECT id FROM trades WHERE user_id = ? AND external_ref = ?").get(userId, payload.external_ref);
  const now = nowISO();
  const actualR = payload.planned_stop
    ? Number((payload.pnl / Math.max(Math.abs(payload.entry_price - payload.planned_stop) * payload.quantity, 1)).toFixed(2))
    : null;
  if (existing) {
    db.prepare(
      `UPDATE trades SET
        symbol = ?, market_type = ?, side = ?, entry_price = ?, exit_price = ?, quantity = ?, fee = ?, leverage = ?,
        planned_stop = ?, planned_take_profit = ?, planned_r = ?, actual_r = ?, strategy_tags = ?, emotion_tags = ?,
        mistake_tags = ?, note = ?, source = ?, trade_date = ?, external_source = ?, raw_payload = ?, updated_at = ?
      WHERE id = ? AND user_id = ?`
    ).run(
      payload.symbol,
      payload.market_type,
      payload.side,
      payload.entry_price,
      payload.exit_price,
      payload.quantity,
      payload.fee,
      payload.leverage,
      payload.planned_stop,
      payload.planned_take_profit,
      payload.planned_r,
      actualR,
      JSON.stringify(payload.strategy_tags || []),
      JSON.stringify(payload.emotion_tags || []),
      JSON.stringify(payload.mistake_tags || []),
      payload.note,
      payload.source,
      payload.trade_date,
      payload.external_source,
      payload.raw_payload,
      now,
      existing.id,
      userId
    );
    return existing.id;
  }
  const idValue = id();
  db.prepare(
    `INSERT INTO trades (
      id, user_id, symbol, market_type, side, entry_price, exit_price, quantity, fee, leverage,
      planned_stop, planned_take_profit, planned_r, actual_r, strategy_tags, emotion_tags, mistake_tags,
      note, source, trade_date, external_source, external_ref, raw_payload, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    idValue,
    userId,
    payload.symbol,
    payload.market_type,
    payload.side,
    payload.entry_price,
    payload.exit_price,
    payload.quantity,
    payload.fee,
    payload.leverage,
    payload.planned_stop,
    payload.planned_take_profit,
    payload.planned_r,
    actualR,
    JSON.stringify(payload.strategy_tags || []),
    JSON.stringify(payload.emotion_tags || []),
    JSON.stringify(payload.mistake_tags || []),
    payload.note,
    payload.source,
    payload.trade_date,
    payload.external_source,
    payload.external_ref,
    payload.raw_payload,
    now,
    now
  );
  return idValue;
}

function normalizeTags(value) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  if (!value) return [];
  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseCsv(text) {
  const lines = String(text || "")
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);
  if (!lines.length) return [];
  const rows = [];
  const parseLine = (line) => {
    const cells = [];
    let cell = "";
    let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
      const char = line[i];
      const next = line[i + 1];
      if (char === '"' && quoted && next === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') {
        quoted = !quoted;
      } else if (char === "," && !quoted) {
        cells.push(cell);
        cell = "";
      } else {
        cell += char;
      }
    }
    cells.push(cell);
    return cells.map((value) => value.trim());
  };
  const headers = parseLine(lines.shift()).map((header) => header.toLowerCase());
  for (const line of lines) {
    const values = parseLine(line);
    const row = {};
    headers.forEach((header, index) => {
      row[header] = values[index] ?? "";
    });
    rows.push(row);
  }
  return rows;
}

function firstMatching(row, names) {
  const normalize = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  for (const name of names) {
    const target = normalize(name);
    const key = Object.keys(row).find((candidate) => normalize(candidate) === target);
    if (key && row[key] != null && String(row[key]).trim() !== "") return row[key];
  }
  return "";
}

function toNumberOrNull(value) {
  if (value == null || value === "") return null;
  const n = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function parseDateText(value) {
  if (!value) return nowISO().slice(0, 10);
  const trimmed = String(value).trim();
  if (/^\d{10,13}$/.test(trimmed)) {
    const ms = trimmed.length === 10 ? Number(trimmed) * 1000 : Number(trimmed);
    return new Date(ms).toISOString().slice(0, 10);
  }
  const date = new Date(trimmed);
  if (!Number.isNaN(date.getTime())) return date.toISOString().slice(0, 10);
  const match = trimmed.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (match) {
    const [, y, m, d] = match;
    return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  return nowISO().slice(0, 10);
}

function inferSide(value) {
  const normalized = String(value || "").toLowerCase();
  if (["short", "sell", "close short", "s"].some((item) => normalized.includes(item))) return "short";
  return "long";
}

function hashTradeRef(payload) {
  return crypto.createHash("sha1").update(JSON.stringify(payload)).digest("hex");
}

function getDashboardStats(userId) {
  const trades = queryTrades(userId);
  const count = trades.length;
  const pnl = trades.reduce((sum, trade) => sum + calculatePnl(trade), 0);
  const wins = trades.filter((trade) => calculatePnl(trade) > 0).length;
  const avgLeverage = count ? trades.reduce((sum, trade) => sum + Number(trade.leverage || 0), 0) / count : 0;
  const worst = [...trades].sort((a, b) => calculatePnl(a) - calculatePnl(b))[0] || null;
  return {
    count,
    pnl,
    wins,
    winRate: count ? Math.round((wins / count) * 100) : 0,
    avgLeverage,
    worst,
    latest: trades[0] || null
  };
}

function getCalendar(userId) {
  const rows = db.prepare("SELECT trade_date, side, entry_price, exit_price, quantity, fee, symbol FROM trades WHERE user_id = ?").all(userId);
  const map = new Map();
  rows.forEach((trade) => {
    const pnl = calculatePnl(trade);
    const key = trade.trade_date;
    map.set(key, (map.get(key) || 0) + pnl);
  });
  return [...map.entries()].map(([date, pnl]) => ({ date, pnl }));
}

async function saveAttachments(userId, tradeId, attachments, replace = false) {
  if (replace) {
    db.prepare("DELETE FROM trade_attachments WHERE user_id = ? AND trade_id = ?").run(userId, tradeId);
  }
  for (const attachment of attachments) {
    if (!attachment?.fileName || !attachment?.dataUrl) continue;
    const attachmentId = id();
    const ext = String(attachment.mimeType || "application/octet-stream").split("/")[1] || "bin";
    const filePath = path.join("uploads", `${attachmentId}.${ext}`);
    const fullPath = path.join(dataDir, filePath);
    const payload = Buffer.from(String(attachment.dataUrl).split(",").pop() || "", "base64");
    await writeFile(fullPath, payload);
    db.prepare(
      "INSERT INTO trade_attachments (id, user_id, trade_id, file_name, mime_type, file_path, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(attachmentId, userId, tradeId, attachment.fileName, attachment.mimeType || "application/octet-stream", filePath, nowISO());
  }
}

const server = http.createServer(async (req, res) => {
  try {
    sessionsCleanup();
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;

    if (pathname.startsWith("/api/")) {
      await handleApi(req, res, pathname);
      return;
    }

    if (pathname.startsWith("/uploads/")) {
      const fullPath = path.join(dataDir, pathname.slice(1));
      if (!existsSync(fullPath)) return text(res, 404, "not found");
      const ext = path.extname(fullPath).toLowerCase();
      const type = ext === ".png" ? "image/png" : ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : ext === ".webp" ? "image/webp" : "application/octet-stream";
      res.writeHead(200, { "Content-Type": type });
      createReadStream(fullPath).pipe(res);
      return;
    }

    if (!serveStatic(req, res, pathname)) {
      text(res, 404, "not found");
    }
  } catch (error) {
    console.error(error);
    text(res, 500, "internal error");
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`AI Trading Blackbox running at http://127.0.0.1:${port}`);
});
