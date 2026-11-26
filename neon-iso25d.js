/* 新霓市 2.5D 等距城市地圖（切片一）
 * 非侵入：只在既有 .city-map-wrap 內加一個視圖開關與 canvas 容器，不修改 React。
 * 資料全部來自 /api/world（districts polygon + places x/y）；點地點時把「去＜地名＞」
 * 送進既有自由行動控制台的真實表單，走真實 visit 流程，不造假狀態。
 */
(() => {
  "use strict";

  const WORLD_URL = "/api/world";
  const REFRESH_MS = 45000;       // 啟用時每 45s 重拉世界（營業狀態會隨時間變）
  const LOG_FETCH_GAP = 8000;     // 觀察到 RPG 紀錄更新時的最短重拉間隔
  const EXTRUDE = 26;             // 區域立體擠出高度（螢幕 px）
  const TYPE_COLOR = {
    life: "#5fe39a", work: "#ffb25b", date: "#ff2bd6", fun: "#19f0ff", hidden: "#8b5cff",
  };

  const S = {
    wrap: null, host: null, canvas: null, ctx: null, toggle: null, errBox: null,
    active: false, world: null, worldAt: 0, worldFail: null,
    hereId: null, hoverId: null, markers: [],
    dpr: 1, cw: 0, ch: 0, proj: null,
    raf: 0, running: false, t0: performance.now(),
    ro: null, lastLogFetch: 0,
  };

  const $ = (sel, root) => (root || document).querySelector(sel);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  /* ---------- 世界資料 ---------- */

  async function fetchWorld(force) {
    if (!force && S.world && performance.now() - S.worldAt < REFRESH_MS) return S.world;
    try {
      const r = await fetch(WORLD_URL, { headers: { accept: "application/json" } });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const data = await r.json();
      if (!data || !Array.isArray(data.places) || !Array.isArray(data.districts)) {
        throw new Error("world payload malformed");
      }
      S.world = data;
      S.worldAt = performance.now();
      S.worldFail = null;
      if (S.host) renderA11yList();
    } catch (e) {
      S.worldFail = e?.message || String(e);
    }
    return S.world;
  }

  /* ---------- 等距投影 ---------- */

  function computeProj() {
    const w = S.cw, h = S.ch;
    if (!w || !h) return null;
    // 世界座標 1000×1080 → iso：sx=(x-y), sy=(x+y)/2
    const isoW = 2080, isoH = 1040; // sx∈[-1080,1000], sy∈[0,1040]
    const padX = 28, padTop = 34 + EXTRUDE, padBottom = 30;
    const scale = Math.min((w - padX * 2) / isoW, (h - padTop - padBottom) / isoH);
    const ox = padX + (w - padX * 2 - isoW * scale) / 2 + 1080 * scale; // 讓 x-y=-1080 對齊左邊
    const oy = padTop + (h - padTop - padBottom - isoH * scale) / 2;
    return { scale, ox, oy };
  }

  function P(x, y) {
    const { scale, ox, oy } = S.proj;
    return { x: (x - y) * scale + ox, y: (x + y) / 2 * scale + oy };
  }

  /* ---------- 繪製 ---------- */

  function polyPath(ctx, pts, lift) {
    ctx.beginPath();
    pts.forEach((pt, i) => {
      const s = P(pt[0], pt[1]);
      if (i === 0) ctx.moveTo(s.x, s.y - lift);
      else ctx.lineTo(s.x, s.y - lift);
    });
    ctx.closePath();
  }

  function shade(hex, k) {
    const n = parseInt(hex.slice(1), 16);
    const r = Math.min(255, Math.max(0, ((n >> 16) & 255) * k));
    const g = Math.min(255, Math.max(0, ((n >> 8) & 255) * k));
    const b = Math.min(255, Math.max(0, (n & 255) * k));
    return `rgb(${r | 0},${g | 0},${b | 0})`;
  }

  function drawDistrict(ctx, d) {
    const pts = d.poly;
    if (!Array.isArray(pts) || pts.length < 3) return;
    const base = d.color || "#3fe0ff";
    // 假擠出：由底到頂疊多層同形多邊形，側面自然成形且不會露出背面
    const steps = 7;
    for (let i = steps; i >= 1; i--) {
      const lift = (EXTRUDE * i) / steps;
      polyPath(ctx, pts, lift);
      ctx.fillStyle = shade(base, 0.16 + 0.05 * (1 - i / steps));
      ctx.fill();
    }
    // 頂面
    polyPath(ctx, pts, EXTRUDE);
    const top = ctx.createLinearGradient(0, 0, S.cw, S.ch);
    top.addColorStop(0, shade(base, 0.34));
    top.addColorStop(1, shade(base, 0.2));
    ctx.fillStyle = top;
    ctx.fill();
    ctx.strokeStyle = shade(base, 1.15);
    ctx.lineWidth = 1.2;
    ctx.globalAlpha = 0.9;
    ctx.stroke();
    ctx.globalAlpha = 1;

    // 區名 chip（質心）
    const c = pts.reduce((a, p) => [a[0] + p[0] / pts.length, a[1] + p[1] / pts.length], [0, 0]);
    const s = P(c[0], c[1]);
    ctx.font = "700 12px 'Noto Sans TC', system-ui, sans-serif";
    const label = d.name || d.id;
    const tw = ctx.measureText(label).width;
    ctx.fillStyle = "rgba(4,8,20,0.72)";
    ctx.beginPath();
    ctx.roundRect(s.x - tw / 2 - 8, s.y - EXTRUDE - 24, tw + 16, 20, 6);
    ctx.fill();
    ctx.strokeStyle = shade(base, 1.3);
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = shade(base, 1.6);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, s.x, s.y - EXTRUDE - 14);
  }

  function drawMarker(ctx, place, now) {
    const s = P(place.x, place.y);
    const y = s.y - EXTRUDE;
    const color = TYPE_COLOR[place.type] || "#19f0ff";
    const isHere = place.id === S.hereId;
    const isHover = place.id === S.hoverId;
    const closed = place.open === false;
    const pulse = 1 + 0.12 * Math.sin((now - S.t0) / 480 + (place.x + place.y));

    // 落地菱形
    ctx.beginPath();
    ctx.moveTo(s.x, y - 4);
    ctx.lineTo(s.x + 7, y);
    ctx.lineTo(s.x, y + 4);
    ctx.lineTo(s.x - 7, y);
    ctx.closePath();
    ctx.fillStyle = shade(color, closed ? 0.18 : 0.3);
    ctx.fill();

    // 立柱 + 光點
    const h = (isHere ? 22 : 14) * (isHover ? 1.25 : 1);
    ctx.strokeStyle = shade(color, closed ? 0.5 : 0.95);
    ctx.lineWidth = isHere ? 2 : 1.2;
    ctx.beginPath();
    ctx.moveTo(s.x, y);
    ctx.lineTo(s.x, y - h);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(s.x, y - h - 3, (isHere ? 4.4 : 3) * (isHover ? 1.3 : pulse), 0, Math.PI * 2);
    ctx.fillStyle = closed ? shade(color, 0.45) : color;
    ctx.shadowColor = color;
    ctx.shadowBlur = closed ? 0 : isHere || isHover ? 14 : 7;
    ctx.fill();
    ctx.shadowBlur = 0;

    if (isHere) {
      ctx.beginPath();
      ctx.arc(s.x, y - h - 3, 9 + 2.4 * Math.sin((now - S.t0) / 300), 0, Math.PI * 2);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.4;
      ctx.globalAlpha = 0.85;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // 標籤：目前位置 / hover 才顯示名稱
    if (isHere || isHover) {
      const label = (place.short || place.name || "") + (closed ? "・休息中" : "");
      ctx.font = "700 12px 'Noto Sans TC', system-ui, sans-serif";
      const tw = ctx.measureText(label).width;
      const lx = Math.min(Math.max(s.x, tw / 2 + 10), S.cw - tw / 2 - 10);
      ctx.fillStyle = "rgba(4,8,20,0.85)";
      ctx.beginPath();
      ctx.roundRect(lx - tw / 2 - 8, y - h - 34, tw + 16, 20, 6);
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = "#eaf6ff";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label, lx, y - h - 24);
    }

    return { id: place.id, x: s.x, y: y - h, r: 15 };
  }

  function draw(now) {
    const ctx = S.ctx;
    if (!ctx || !S.proj) return;
    ctx.clearRect(0, 0, S.cw, S.ch);

    // 背景網格
    ctx.fillStyle = "#05081a";
    ctx.fillRect(0, 0, S.cw, S.ch);
    ctx.strokeStyle = "rgba(64,120,255,0.07)";
    ctx.lineWidth = 1;
    const gridStep = 26;
    for (let gx = -S.ch; gx < S.cw + S.ch; gx += gridStep) {
      ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx + S.ch, S.ch); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx - S.ch, S.ch); ctx.stroke();
    }

    if (S.worldFail && !S.world) {
      ctx.fillStyle = "#ff9ec7";
      ctx.font = "600 13px 'Noto Sans TC', system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("城市資料讀取失敗：" + S.worldFail, S.cw / 2, S.ch / 2 - 8);
      ctx.fillStyle = "#9db8e8";
      ctx.font = "12px 'Noto Sans TC', system-ui, sans-serif";
      ctx.fillText("點右上角「重試」重新載入", S.cw / 2, S.ch / 2 + 14);
      return;
    }
    if (!S.world) {
      ctx.fillStyle = "#9db8e8";
      ctx.font = "13px 'Noto Sans TC', system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("城市資料載入中…", S.cw / 2, S.ch / 2);
      return;
    }

    // 後到前：以質心 x+y 深度排序
    const districts = [...(S.world.districts || [])].sort((a, b) => {
      const ca = a.poly.reduce((s2, p) => s2 + p[0] + p[1], 0) / a.poly.length;
      const cb = b.poly.reduce((s2, p) => s2 + p[0] + p[1], 0) / b.poly.length;
      return ca - cb;
    });
    for (const d of districts) drawDistrict(ctx, d);

    const places = [...(S.world.places || [])].sort((a, b) => a.x + a.y - (b.x + b.y));
    S.markers = [];
    for (const p of places) {
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
      S.markers.push(drawMarker(ctx, p, now));
    }
  }

  function loop(now) {
    if (!S.running) return;
    draw(now);
    S.raf = requestAnimationFrame(loop);
  }

  function startLoop() {
    if (S.running) return;
    S.running = true;
    S.raf = requestAnimationFrame(loop);
  }

  function stopLoop() {
    S.running = false;
    cancelAnimationFrame(S.raf);
  }

  /* ---------- 尺寸 ---------- */

  function resize() {
    if (!S.canvas || !S.host) return;
    const rect = S.host.getBoundingClientRect();
    S.dpr = Math.min(3, window.devicePixelRatio || 1);
    S.cw = Math.max(1, rect.width);
    S.ch = Math.max(1, rect.height);
    S.canvas.width = Math.round(S.cw * S.dpr);
    S.canvas.height = Math.round(S.ch * S.dpr);
    S.ctx.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
    S.proj = computeProj();
    if (!S.running) draw(performance.now());
  }

  /* ---------- 互動 ---------- */

  function pick(px, py) {
    let best = null, bd = 1e9;
    for (const m of S.markers) {
      const d = (m.x - px) ** 2 + (m.y - py) ** 2;
      if (d < m.r * m.r && d < bd) { best = m; bd = d; }
    }
    return best;
  }

  function gotoPlace(place) {
    // 走真實控制台：填「去＜地名＞」並送出既有表單
    const page = S.wrap?.closest(".city-page") || document;
    const input = $("[data-input]", page);
    const form = $("[data-form]", page);
    if (!input || !form) {
      showError("找不到自由行動控制台，請確認新霓市 RPG 已載入。");
      return false;
    }
    input.value = "去" + (place.name || "");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    if (form.requestSubmit) form.requestSubmit();
    else form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    S.herePending = place.id;
    return true;
  }

  function showError(msg) {
    if (!S.errBox) return;
    S.errBox.textContent = msg;
    S.errBox.hidden = false;
    clearTimeout(showError.t);
    showError.t = setTimeout(() => { S.errBox.hidden = true; }, 5000);
  }

  /* 「在這裡」追蹤：解析真實 RPG 紀錄的抵達文字，保持與遊戲狀態一致 */
  function observeLog(page) {
    const log = $("[data-log]", page);
    if (!log || log.__isoBound) return;
    log.__isoBound = true;
    const scan = (node) => {
      const text = node.textContent || "";
      let m = text.match(/抵達「(.+?)」/) || text.match(/一起去了「(.+?)」/) || text.match(/「(.+?)」(?:你就在這裡|到了)/);
      if (m) {
        const place = (S.world?.places || []).find((p) => m[1].includes(p.name) || p.name.includes(m[1]));
        if (place) S.hereId = place.id;
      }
      // 紀錄有動靜時節流重拉世界（營業狀態／時間）
      const now = performance.now();
      if (S.active && now - S.lastLogFetch > LOG_FETCH_GAP) {
        S.lastLogFetch = now;
        fetchWorld(true);
      }
    };
    new MutationObserver((muts) => {
      for (const mu of muts) for (const n of mu.addedNodes) scan(n);
    }).observe(log, { childList: true, subtree: true });
  }

  /* ---------- 視圖切換 ---------- */

  function setActive(on) {
    if (on === S.active) return;
    S.active = on;
    if (S.toggle) {
      S.toggle.setAttribute("aria-pressed", String(on));
      S.toggle.classList.toggle("on", on);
    }
    if (S.wrap) S.wrap.classList.toggle("iso25d-on", on);
    if (S.host) S.host.hidden = !on;
    if (on) {
      fetchWorld(false).then(() => { resize(); });
      resize();
      startLoop();
    } else {
      stopLoop();
    }
  }

  /* ---------- 掛載 ---------- */

  function buildHost() {
    const host = document.createElement("div");
    host.className = "nrpg-iso";
    host.hidden = true;
    host.innerHTML =
      `<canvas class="nrpg-iso-canvas" role="img" aria-label="新霓市 2.5D 等距地圖"></canvas>` +
      `<div class="nrpg-iso-toolbar">` +
      `<span class="nrpg-iso-hint">點地點 → 送出「去」指令</span>` +
      `<button type="button" class="nrpg-iso-retry" data-iso-retry>重新整理</button>` +
      `</div>` +
      `<p class="nrpg-iso-err" data-iso-err hidden></p>` +
      `<div class="nrpg-iso-a11y" data-iso-a11y></div>`;
    return host;
  }

  function renderA11yList() {
    const box = $("[data-iso-a11y]", S.host);
    if (!box) return;
    const places = S.world?.places || [];
    box.innerHTML = places
      .map((p) => `<button type="button" data-iso-place="${esc(p.id)}">${esc(p.name)}${p.open === false ? "（休息中）" : ""}</button>`)
      .join("");
  }

  function bindWrap(wrap) {
    if (wrap.__isoBound) return;
    wrap.__isoBound = true;

    const tools = $(".city-tools", wrap);
    const host = buildHost();
    wrap.appendChild(host);

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "nrpg-iso-toggle";
    toggle.setAttribute("aria-pressed", "false");
    toggle.textContent = "2.5D";
    toggle.title = "切換 2.5D 等距地圖";
    if (tools) tools.appendChild(toggle);

    S.wrap = wrap;
    S.host = host;
    S.canvas = $("canvas", host);
    S.ctx = S.canvas.getContext("2d");
    S.toggle = toggle;
    S.errBox = $("[data-iso-err]", host);

    toggle.addEventListener("click", () => setActive(!S.active));

    // 使用者在既有 seg 切回 2D/3D 時，退出 2.5D 視圖（seg 是 button 群，不是 radio）
    if (tools) {
      tools.addEventListener("click", (e) => {
        if (e.target.closest(".seg button")) setActive(false);
      }, true);
    }

    // 點擊 / hover 選地點
    S.canvas.addEventListener("pointermove", (e) => {
      const r = S.canvas.getBoundingClientRect();
      const m = pick(e.clientX - r.left, e.clientY - r.top);
      const id = m?.id ?? null;
      if (id !== S.hoverId) {
        S.hoverId = id;
        S.canvas.style.cursor = id ? "pointer" : "default";
      }
    });
    S.canvas.addEventListener("pointerleave", () => { S.hoverId = null; });
    S.canvas.addEventListener("click", (e) => {
      const r = S.canvas.getBoundingClientRect();
      const m = pick(e.clientX - r.left, e.clientY - r.top);
      if (!m) return;
      const place = (S.world?.places || []).find((p) => p.id === m.id);
      if (place) gotoPlace(place);
    });

    // 無障礙地點清單（視覺隱藏，鍵盤/讀屏可達）
    $("[data-iso-a11y]", host).addEventListener("click", (e) => {
      const b = e.target.closest("[data-iso-place]");
      if (!b) return;
      const place = (S.world?.places || []).find((p) => p.id === b.dataset.isoPlace);
      if (place) gotoPlace(place);
    });

    $("[data-iso-retry]", host).addEventListener("click", () => {
      fetchWorld(true).then(() => { renderA11yList(); resize(); });
    });

    S.ro = new ResizeObserver(() => { if (S.active) resize(); });
    S.ro.observe(host);

    // React 重掛（例如 syncAppUi 切 hash）後，若 2.5D 本來就開著，把 DOM 狀態補回來
    if (S.active) {
      wrap.classList.add("iso25d-on");
      host.hidden = false;
      toggle.setAttribute("aria-pressed", "true");
      toggle.classList.add("on");
      requestAnimationFrame(() => { resize(); startLoop(); });
    }

    // 世界資料到位後補一次清單
    fetchWorld(false).then(() => { if (S.active) { renderA11yList(); resize(); } });
    observeLog(wrap.closest(".city-page") || document);
  }

  let scheduled = false;
  function inject() {
    scheduled = false;
    for (const wrap of document.querySelectorAll(".city-map-wrap")) bindWrap(wrap);
    // wrap 被 React 重掛時釋放 DOM 參照；保留 S.active（使用者的視圖選擇），重掛時補回
    if (S.wrap && !S.wrap.isConnected) {
      stopLoop();
      S.wrap = null; S.host = null; S.canvas = null; S.ctx = null; S.toggle = null;
      S.ro?.disconnect();
    }
  }
  function scheduleInject() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(inject);
  }

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopLoop();
    else if (S.active) startLoop();
  });

  /* ---------- 偵錯掛點（測試用） ---------- */
  window.__neonIso = {
    get active() { return S.active; },
    get placeCount() { return S.world?.places?.length ?? 0; },
    get districtCount() { return S.world?.districts?.length ?? 0; },
    get hereId() { return S.hereId; },
    get worldFail() { return S.worldFail; },
    activate: () => setActive(true),
    deactivate: () => setActive(false),
    goto: (name) => {
      const p = (S.world?.places || []).find((x) => x.name === name || x.short === name);
      return p ? gotoPlace(p) : false;
    },
    version: "1.0.0",
  };

  const observer = new MutationObserver(scheduleInject);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener("hashchange", scheduleInject);
  document.addEventListener("DOMContentLoaded", scheduleInject, { once: true });
  scheduleInject();
})();
