(() => {
  "use strict";

  const SVG_NS = "http://www.w3.org/2000/svg";
  let scheduled = false;

  function makeCityHero() {
    const hero = document.createElement("section");
    hero.className = "neon-cinematic";
    hero.setAttribute("aria-label", "新霓市城市訊號");
    hero.innerHTML = `
      <img class="neon-city-art" src="./media/neon_city_rain.png" alt="" aria-hidden="true" />
      <div class="neon-city-shade" aria-hidden="true"></div>
      <div class="neon-city-rain" aria-hidden="true"></div>
      <div class="neon-city-copy">
        <div class="neon-city-kicker"><i aria-hidden="true"></i> ANGEL.NET // CITY LINK</div>
        <div class="neon-city-code">NC—2049 / OLD ALLEY NODE / LOCAL LIFE SIMULATION</div>
        <h1><span>新霓市</span><small>NEON CITY</small></h1>
        <p>城市在運轉，TA 也在生活。<br /><span>在霓虹夜色裡，找到一盞為你亮著的燈。</span></p>
        <div class="neon-city-metrics" aria-label="世界包內容">
          <span>06 DISTRICTS</span>
          <span>40+ LOCATIONS</span>
          <span>WARMTH SIGNAL</span>
        </div>
      </div>
      <div class="neon-resident">
        <img src="./media/guwenzhou_full.png" alt="新霓市官方角色顧聞舟" />
        <div class="neon-resident-tag">CHARACTER FILE // OFFICIAL<b>顧聞舟・城市訊號</b></div>
      </div>`;
    return hero;
  }

  function makeMapHud() {
    const hud = document.createElement("div");
    hud.className = "city-map-hud";
    hud.setAttribute("aria-hidden", "true");
    hud.innerHTML = `<b data-map-mode>2D // HOLO GRID</b><span>ROADS / SIGNAL / RESIDENTS</span>`;
    return hud;
  }

  function addHolographicRoutes(svg) {
    if (svg.querySelector(":scope > .c2-holo-routes")) return;
    const group = document.createElementNS(SVG_NS, "g");
    group.setAttribute("class", "c2-holo-routes");
    group.setAttribute("aria-hidden", "true");

    const routes = [
      "M-40 845 L180 690 L405 635 L590 510 L790 355 L1040 250",
      "M85 -30 L205 205 L380 390 L555 620 L760 805 L1040 930"
    ];
    routes.forEach((data) => {
      const path = document.createElementNS(SVG_NS, "path");
      path.setAttribute("d", data);
      group.appendChild(path);
    });

    [[180, 690], [405, 635], [590, 510], [790, 355], [380, 390], [760, 805]].forEach(([cx, cy]) => {
      const node = document.createElementNS(SVG_NS, "circle");
      node.setAttribute("cx", String(cx));
      node.setAttribute("cy", String(cy));
      node.setAttribute("r", "6");
      group.appendChild(node);
    });
    svg.appendChild(group);
  }

  function updateMapMode(map) {
    const is3d = Boolean(map.querySelector(".city3d")) ||
      map.querySelector('.city-tools [role="radio"][aria-checked="true"]')?.textContent?.includes("3D");
    const label = map.querySelector("[data-map-mode]");
    if (label) label.textContent = is3d ? "3D // CITY VOLUME" : "2D // HOLO GRID";
    map.dataset.neonMode = is3d ? "3d" : "2d";
  }

  function enhanceCity() {
    scheduled = false;
    const cyber = document.documentElement.dataset.ui === "cyber";

    document.querySelectorAll(".city-page").forEach((page) => {
      // 賽博專屬增強在別的主題要完整退場，不能留下未套樣式的大圖與 HUD。
      if (!cyber) {
        page.querySelectorAll(":scope > .neon-cinematic, .city-map-hud, .c2-holo-routes").forEach((el) => el.remove());
        return;
      }
      if (!page.querySelector(":scope > .neon-cinematic")) {
        page.prepend(makeCityHero());
      }

      const map = page.querySelector(".city-map-wrap");
      if (map) {
        if (!map.querySelector(":scope > .city-map-hud")) {
          map.appendChild(makeMapHud());
        }
        const svg = map.querySelector(".city2d svg");
        if (svg) addHolographicRoutes(svg);
        updateMapMode(map);
      }
    });
  }

  function scheduleEnhancement() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(enhanceCity);
  }

  const observer = new MutationObserver(scheduleEnhancement);
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-ui"] });
  window.addEventListener("hashchange", scheduleEnhancement);
  document.addEventListener("click", (event) => {
    if (event.target.closest(".city-tools")) setTimeout(scheduleEnhancement, 0);
  });
  document.addEventListener("DOMContentLoaded", scheduleEnhancement, { once: true });
  scheduleEnhancement();
})();
