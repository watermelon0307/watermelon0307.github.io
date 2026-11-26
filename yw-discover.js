/* 餘溫：新功能入口與版本代號
 * 在「我的」頁注入「新功能」區塊（衣櫃／一起聽・音色／2.5D 地圖），
 * 底部顯示版本代號（對照 <meta name="yw-build">，企劃書要求）。
 * 非侵入 MutationObserver 注入，重渲染後自動補回。
 */
(() => {
  "use strict";
  const $ = (s, el = document) => el.querySelector(s);

  const ENTRIES = [
    { id: "closet", icon: "👗", color: "#b49977", title: "我的衣櫃", desc: "WARMTH CLOSET｜服裝管理・商城購物・願望清單",
      go: () => { location.hash = "#/city"; waitFor(() => window.__warmthCloset, (c) => c.openPanel()); } },
    { id: "audio", icon: "🎧", color: "#7a8fc9", title: "一起聽・音色中心", desc: "音樂・每角色音色與試聽・通話辨識設定・唱歌",
      go: () => window.__ywAudio?.openPanel("now") },
    { id: "iso", icon: "🗺", color: "#6fbf8a", title: "2.5D 城市地圖", desc: "等距霓虹城市｜點地點直接前往，走真實遊戲流程",
      go: () => { location.hash = "#/city"; waitFor(() => window.__neonIso, (m) => m.activate()); } },
  ];

  function waitFor(get, run, tries = 40) {
    const v = get();
    if (v) { run(v); return; }
    if (tries > 0) setTimeout(() => waitFor(get, run, tries - 1), 250);
  }

  function buildInfo() {
    const meta = document.querySelector('meta[name="yw-build"]');
    return meta?.content || "dev";
  }

  function entryHtml(e) {
    return `<button type="button" class="list-item ywd-item" data-ywd="${e.id}" style="cursor:pointer">` +
      `<span class="ic" style="background:${e.color}">${e.icon}</span>` +
      `<span class="grow"><span style="display:block">${e.title}</span><span class="small muted">${e.desc}</span></span>` +
      `<span class="ywd-chev" aria-hidden="true">›</span></button>`;
  }

  function sectionHtml() {
    return `<div class="section-title ywd-title">新功能</div><div class="list ywd-list">${ENTRIES.map(entryHtml).join("")}</div>`;
  }

  function inject() {
    // 只在「我的」頁
    if (!location.hash.startsWith("#/me")) return;
    const pad = $(".page .page-pad") || $(".page");
    if (!pad) return;
    if (!$(".ywd-list", pad)) {
      const titles = [...pad.querySelectorAll(".section-title")];
      const anchor = titles.find((t) => t.textContent.trim().startsWith("個人化")) || titles[0];
      const tpl = document.createElement("template");
      tpl.innerHTML = sectionHtml().trim();
      const frag = tpl.content;
      if (anchor) pad.insertBefore(frag, anchor); else pad.appendChild(frag);
    }
    // 版本代號（頁面最底部，只放一個）
    if (!$(".ywd-build", pad)) {
      const b = document.createElement("div");
      b.className = "ywd-build";
      b.textContent = `版本 ${buildInfo()} · 單檔版`;
      pad.appendChild(b);
    }
  }

  document.addEventListener("click", (e) => {
    const btn = e.target.closest?.("[data-ywd]");
    if (!btn) return;
    const entry = ENTRIES.find((x) => x.id === btn.dataset.ywd);
    entry?.go();
  });

  window.__ywDiscover = { get build() { return buildInfo(); }, get mounted() { return !!document.querySelector(".ywd-list"); } };
  const mo = new MutationObserver(() => inject());
  mo.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener("hashchange", () => setTimeout(inject, 200));
  document.addEventListener("DOMContentLoaded", () => setTimeout(inject, 500), { once: true });
  setTimeout(inject, 900);
})();
