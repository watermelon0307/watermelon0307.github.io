/* 新霓市 3D 安全模式：初始化看門狗、海報兜底、2D 返回與 WebGL 掉線恢復。 */
(() => {
  "use strict";

  const watched = new WeakSet();
  const autoRetried = new WeakSet();
  let scheduled = false;

  function cityPoster() {
    const buildings = [];
    for (let row = 0; row < 3; row += 1) {
      for (let col = 0; col < 9; col += 1) {
        const w = 42 + ((col * 17 + row * 13) % 28);
        const h = 54 + ((col * 47 + row * 61) % 150);
        const x = 54 + col * 82 + row * 24;
        const y = 282 + row * 70 - col * 3;
        const d = 15;
        const hue = (col + row) % 3;
        const front = ["#101d42", "#171737", "#0c2842"][hue];
        const side = ["#1b2850", "#251a4a", "#123554"][hue];
        const light = ["#63e6ff", "#ff6ad5", "#ffc97a"][hue];
        const windows = [];
        for (let wy = y - h + 14; wy < y - 10; wy += 18) {
          windows.push(`<path d="M${x + 8} ${wy}h${Math.max(10, w - 20)}" stroke="${light}" stroke-opacity="${((wy + col) % 4 === 0) ? ".7" : ".18"}" stroke-width="3" stroke-dasharray="5 7"/>`);
        }
        buildings.push(`<g>
          <polygon points="${x},${y - h} ${x + w},${y - h} ${x + w + d},${y - h - 8} ${x + d},${y - h - 8}" fill="${light}" fill-opacity=".18" stroke="${light}" stroke-opacity=".38"/>
          <polygon points="${x},${y} ${x + w},${y} ${x + w},${y - h} ${x},${y - h}" fill="${front}" stroke="${light}" stroke-opacity=".28"/>
          <polygon points="${x + w},${y} ${x + w + d},${y - 8} ${x + w + d},${y - h - 8} ${x + w},${y - h}" fill="${side}" stroke="${light}" stroke-opacity=".22"/>
          ${windows.join("")}
        </g>`);
      }
    }
    const grid = [];
    for (let x = -300; x <= 1100; x += 80) grid.push(`<path d="M400 190L${x} 500"/>`);
    for (let y = 250; y <= 500; y += 42) grid.push(`<path d="M0 ${y}H800"/>`);
    return `<svg viewBox="0 0 800 500" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <linearGradient id="yw-city-sky" x2="0" y2="1"><stop stop-color="#11173a"/><stop offset=".58" stop-color="#080d24"/><stop offset="1" stop-color="#030713"/></linearGradient>
        <radialGradient id="yw-city-haze"><stop stop-color="#1de5ff" stop-opacity=".25"/><stop offset="1" stop-color="#1de5ff" stop-opacity="0"/></radialGradient>
      </defs>
      <rect width="800" height="500" fill="url(#yw-city-sky)"/>
      <ellipse cx="620" cy="150" rx="310" ry="220" fill="url(#yw-city-haze)"/>
      <path d="M0 190H800" stroke="#7beeff" stroke-opacity=".18"/>
      <g stroke="#42cfe4" stroke-opacity=".09" fill="none">${grid.join("")}</g>
      ${buildings.join("")}
      <path d="M30 438C220 390 490 478 790 398" fill="none" stroke="#ff4fc8" stroke-opacity=".4" stroke-width="2"/>
      <path d="M30 444C220 396 490 484 790 404" fill="none" stroke="#56e9ff" stroke-opacity=".22"/>
    </svg>`;
  }

  function radios(scope) {
    const map = scope?.closest?.(".city-map-wrap") || document;
    return [...map.querySelectorAll('.city-tools [role="radio"]')];
  }

  function choose(scope, text) {
    const button = radios(scope).find((item) => item.textContent.includes(text));
    if (button && button.getAttribute("aria-checked") !== "true") button.click();
    return Boolean(button);
  }

  function retry(scope) {
    if (!scope?.isConnected || scope.dataset.ywRetrying === "1") return;
    scope.dataset.ywRetrying = "1";
    choose(scope, "2D");
    setTimeout(() => {
      const current = document.querySelector(".city-map-wrap");
      if (current) choose(current, "3D");
    }, 320);
  }

  function removeFallback(scope) {
    scope?.querySelector(":scope > .yw-city-fallback")?.remove();
    if (scope?.dataset) delete scope.dataset.ywFallback;
  }

  function showFallback(scope, stage = "init") {
    if (!scope?.isConnected || scope.dataset.ywFallback === stage) return;
    removeFallback(scope);
    scope.dataset.ywFallback = stage;
    const copy = {
      init: ["3D 圖形連線未完成", "這台裝置暫時無法建立 WebGL。你可以返回 2D 地圖，或重新嘗試一次。"],
      lost: ["立體城市暫時離線", "瀏覽器的圖形連線中斷了。正在等待恢復；你也可以直接回到 2D。"],
      runtime: ["3D 畫面沒有完成載入", "城市資料仍然安全保留。重新建立圖形畫面，通常不必刷新整個頁面。"],
      timeout: ["城市燈光還沒有亮起來", "載入時間比預期長。你可以繼續等待、重新嘗試，或先回 2D 地圖。"],
      size: ["3D 畫布大小異常", "城市沒有消失，只是圖形畫布還沒有準備好。請重試或返回 2D。"]
    }[stage] || ["3D 畫面暫時不可用", "可返回 2D 繼續城市生活，或重新嘗試。"];

    const panel = document.createElement("section");
    panel.className = "yw-city-fallback";
    panel.setAttribute("role", "alert");
    panel.innerHTML = `
      <div class="yw-city-poster">${cityPoster()}</div>
      <div class="yw-city-safe-card">
        <div class="yw-city-safe-kicker"><i></i> CITY VOLUME // SAFE MODE</div>
        <h3>${copy[0]}</h3>
        <p>${copy[1]}</p>
        <div class="yw-city-safe-note">不會清除城市、角色或行動進度，也不需要刷新。</div>
        <div class="yw-city-safe-actions">
          <button type="button" class="yw-city-safe-primary" data-city-2d>返回 2D 地圖</button>
          <button type="button" class="yw-city-safe-secondary" data-city-retry>重新嘗試 3D</button>
        </div>
      </div>`;
    panel.addEventListener("click", (event) => {
      const button = event.target.closest("button");
      if (!button) return;
      event.preventDefault();
      event.stopPropagation();
      if (button.hasAttribute("data-city-2d")) choose(scope, "2D");
      if (button.hasAttribute("data-city-retry")) retry(scope);
    });
    panel.addEventListener("keydown", (event) => {
      if (event.key === "Escape") choose(scope, "2D");
    });
    scope.appendChild(panel);

    if (stage === "lost" && !autoRetried.has(scope)) {
      autoRetried.add(scope);
      setTimeout(() => {
        if (scope.isConnected && scope.dataset.city3dError === "lost") retry(scope);
      }, 2400);
    }
  }

  function watch(scope) {
    if (watched.has(scope)) return;
    watched.add(scope);
    setTimeout(() => {
      if (!scope.isConnected || scope.querySelector(".yw-city-fallback")) return;
      if (scope.dataset.city3dError) {
        showFallback(scope, scope.dataset.city3dError);
        return;
      }
      const canvas = scope.querySelector("canvas");
      if (!canvas) showFallback(scope, "timeout");
      else if (canvas.clientWidth < 8 || canvas.clientHeight < 8) showFallback(scope, "size");
    }, 4000);
  }

  function scan() {
    scheduled = false;
    document.querySelectorAll(".city3d").forEach((scope) => {
      watch(scope);
      if (scope.dataset.city3dError) showFallback(scope, scope.dataset.city3dError);
    });
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(scan);
  }

  document.addEventListener("city3derror", (event) => {
    const scope = event.target.closest?.(".city3d") || event.target;
    showFallback(scope, event.detail?.stage || "runtime");
  });
  document.addEventListener("city3drestored", (event) => {
    removeFallback(event.target.closest?.(".city3d") || event.target);
  });
  window.addEventListener("error", (event) => {
    const scope = document.querySelector(".city3d");
    if (scope && /webgl|three|shader|context/i.test(String(event.message || ""))) showFallback(scope, "runtime");
  });
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener("hashchange", schedule);
  document.addEventListener("DOMContentLoaded", schedule, { once: true });
  schedule();
})();
