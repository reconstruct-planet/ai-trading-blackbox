const canvas = document.querySelector("#commandCanvas");
const ctx = canvas.getContext("2d");
const scanStatus = document.querySelector("#scanStatus");
const aiFeed = document.querySelector("#aiFeed");
const demoPulse = document.querySelector("#demoPulse");
const waitlistForm = document.querySelector("#waitlistForm");
const formNote = document.querySelector("#formNote");

let width = 0;
let height = 0;
let dpr = 1;
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

function draw(time = 0) {
  frame += 1;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#03070b";
  ctx.fillRect(0, 0, width, height);
  drawGrid(time);
  drawStreams();
  drawNodes(time);
  drawScanFrame(time);
  requestAnimationFrame(draw);
}

function runDemoScan() {
  scanStatus.textContent = "SCANNING";
  demoPulse.textContent = "스캔 중";
  aiFeed.classList.add("is-scanning");

  const entries = [
    "AI LOG",
    "SOLUSDT 손실 거래에서 Revenge + 18x 레버리지 조합 감지",
    "BTCUSDT 돌파 추격 진입 4건 중 3건이 -1R 이하로 종료",
    "다음 거래 전 90초 대기 규칙을 체크리스트에 추가 권장"
  ];

  aiFeed.innerHTML = `<span>${entries[0]}</span>${entries.slice(1).map((entry) => `<p>${entry}</p>`).join("")}`;

  window.setTimeout(() => {
    scanStatus.textContent = "READY";
    demoPulse.textContent = "데모 스캔 실행";
    aiFeed.classList.remove("is-scanning");
  }, 1400);
}

demoPulse.addEventListener("click", runDemoScan);

waitlistForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const data = new FormData(waitlistForm);
  const exchange = data.get("exchange");
  const hasApiKey = Boolean(String(data.get("apiKey") || "").trim());
  formNote.textContent = hasApiKey
    ? `${exchange} read-only API 연결 준비가 완료되었습니다. Free Plan 대시보드에서 체결 내역 동기화를 시작합니다.`
    : `${exchange}를 선택했습니다. Free Plan으로 시작하고, 대시보드에서 API 키 또는 CSV 업로드를 연결할 수 있습니다.`;
  waitlistForm.reset();
});

window.addEventListener("resize", resizeCanvas);
resizeCanvas();
requestAnimationFrame(draw);
