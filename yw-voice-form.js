/* 餘溫：建立／編輯角色流程內嵌「語言與音色細節」
 * 非侵入：偵測表單「專屬聲線」區塊，於其後插入補充卡；
 * 送出時透過 fetch 包裹，把使用者改過的欄位併入 body.data.voice。
 * 欄位最終保存在 character.data.voice，通話與語音沿用。
 */
(() => {
  "use strict";
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const LANGS = [["zh-TW","中文（台灣）"],["zh-CN","中文（普通話）"],["zh-HK","中文（廣東話）"],["ja","日本語"],["en","English"],["ko","한국어"]];
  const PREVIEWS = {"zh-TW":"早安，今天會是怎樣的一天呢。","zh-CN":"早安，今天会是怎样的一天呢。","zh-HK":"早晨，今日會係點嘅一日呢。","ja":"おはよう。今日はどんな一日になるかな。","en":"Good morning. I wonder what today will bring.","ko":"좋은 아침이에요. 오늘은 어떤 하루가 될까요."};
  const SLIDERS = [["stability","穩定度",.4],["similarity","相似度",.85],["style","表現力",.35]];
  const dirty = {};   // 只合併使用者實際改過的欄位
  let routeId = null; // 編輯頁的角色 id（新建頁為 null）

  function mark(key, val) { dirty[key] = val; }

  function cardHtml() {
    return `<div class="ywvf-card" data-ywvf>
      <div class="ywvf-title">🎙 語言與音色細節 <small>選填・會隨這張表單一起保存到角色</small></div>
      <div class="ywvf-row"><span>語言（試聽與通話朗讀使用）</span>
        <select data-ywvf-lang>${LANGS.map(([k,n])=>`<option value="${k}">${n}</option>`).join("")}</select></div>
      <div class="ywvf-row"><span>音色名稱（備註用，例如「清冷青年」）</span>
        <input type="text" data-ywvf-name placeholder="清冷青年、溫柔姐姐…"></div>
      <div class="ywvf-sliders">${SLIDERS.map(([k,n,d])=>`<label>${n}<input type="range" min="0" max="1" step=".05" value="${d}" data-ywvf-slider="${k}"><b data-ywvf-out="${k}">${d.toFixed(2)}</b></label>`).join("")}</div>
      <div class="ywvf-row"><span>試聽台詞</span><input type="text" data-ywvf-preview placeholder="${PREVIEWS["zh-TW"]}"></div>
      <div class="ywvf-row"><button type="button" class="ywvf-preview-btn" data-ywvf-test>▶ 用瀏覽器語音試聽</button></div>
    </div>`;
  }

  function findVoiceCard() {
    const title = $$(".section-title").find(el => el.textContent.trim().startsWith("專屬聲線"));
    if (!title) return null;
    const card = title.nextElementSibling;
    return card?.classList.contains("card") ? card : null;
  }

  function isEditorPage() {
    const h = location.hash;
    return h.startsWith("#/character/new") || /^#\/character\/[^/]+\/edit/.test(h);
  }

  async function prefill() {
    const m = location.hash.match(/^#\/character\/([^/]+)\/edit/);
    routeId = m ? m[1] : null;
    if (!routeId) return;
    try {
      const c = await fetch(`/api/characters/${encodeURIComponent(routeId)}`).then(r => r.json());
      const v = c?.data?.voice || {};
      const card = $("[data-ywvf]"); if (!card) return;
      if (v.language) $("[data-ywvf-lang]", card).value = v.language;
      if (v.voiceName) $("[data-ywvf-name]", card).value = v.voiceName;
      if (v.previewText) $("[data-ywvf-preview]", card).value = v.previewText;
      SLIDERS.forEach(([k]) => { if (typeof v[k] === "number") { const inp = $(`[data-ywvf-slider="${k}"]`, card); if (inp) { inp.value = v[k]; const out = $(`[data-ywvf-out="${k}"]`, card); if (out) out.textContent = v[k].toFixed(2); } } });
      // 預填的值視為已確認：送出時一併帶上，避免被表單預設覆蓋
      if (v.language) dirty.language = v.language;
      if (v.voiceName) dirty.voiceName = v.voiceName;
      if (v.previewText) dirty.previewText = v.previewText;
      SLIDERS.forEach(([k]) => { if (typeof v[k] === "number") dirty[k] = v[k]; });
    } catch { /* 讀不到就當新建 */ }
  }

  function wire(card) {
    card.addEventListener("input", e => {
      const t = e.target;
      if (t.matches("[data-ywvf-lang]")) { mark("language", t.value); $(`[data-ywvf-preview]`, card).placeholder = PREVIEWS[t.value] || PREVIEWS["zh-TW"]; }
      if (t.matches("[data-ywvf-name]")) mark("voiceName", t.value.trim());
      if (t.matches("[data-ywvf-preview]")) mark("previewText", t.value.trim());
      if (t.matches("[data-ywvf-slider]")) { const k = t.dataset.ywvfSlider; mark(k, +t.value); const out = $(`[data-ywvf-out="${k}"]`, card); if (out) out.textContent = (+t.value).toFixed(2); }
    });
    card.addEventListener("click", e => {
      const b = e.target.closest("[data-ywvf-test]"); if (!b) return;
      if (!("speechSynthesis" in window)) { b.textContent = "這個瀏覽器沒有語音功能"; return; }
      const lang = $(`[data-ywvf-lang]`, card)?.value || "zh-TW";
      const text = $(`[data-ywvf-preview]`, card)?.value.trim() || PREVIEWS[lang] || PREVIEWS["zh-TW"];
      const u = new SpeechSynthesisUtterance(text); u.lang = lang;
      const vs = speechSynthesis.getVoices().filter(v => v.lang?.toLowerCase().startsWith(lang.split("-")[0]));
      if (vs[0]) u.voice = vs[0];
      speechSynthesis.cancel(); speechSynthesis.speak(u);
      b.textContent = "播放中…"; u.onend = u.onerror = () => { b.textContent = "▶ 用瀏覽器語音試聽"; };
    });
  }

  function ensure() {
    if (!isEditorPage()) return;
    if ($("[data-ywvf]")) return;
    const anchor = findVoiceCard(); if (!anchor) return;
    const tpl = document.createElement("template");
    tpl.innerHTML = cardHtml().trim();
    const card = tpl.content.firstChild;
    anchor.after(card);
    wire(card);
    prefill();
  }

  /* ---- 送出時把改過的欄位併入 body.data.voice ----
     主程式可能在我們之後才攔截 fetch，所以在每次 ensure 時重新包到最外層。 ---- */
  let wrappedFn = null;
  function wrapFetch() {
    if (window.fetch === wrappedFn) return;
    const prev = window.fetch;
    wrappedFn = function (input, init) {
      try {
        const url = typeof input === "string" ? input : input?.url || "";
        const method = (init?.method || "GET").toUpperCase();
        const isCreate = /\/api\/characters\/?(\?|$)/.test(url) && method === "POST";
        const isUpdate = /\/api\/characters\/[^/?]+$/.test(url) && method === "PUT";
        if ((isCreate || isUpdate) && typeof init?.body === "string" && Object.keys(dirty).length) {
          const body = JSON.parse(init.body);
          if (body && typeof body === "object") {
            body.data = { ...(body.data || {}), voice: { ...(body.data?.voice || {}), ...dirty } };
            init = { ...init, body: JSON.stringify(body) };
          }
        }
      } catch { /* 併入失敗不擋主流程 */ }
      return prev.call(this, input, init);
    };
    window.fetch = wrappedFn;
  }

  window.__ywVoiceForm = { get dirty() { return { ...dirty }; }, ensure };
  const mo = new MutationObserver(() => { wrapFetch(); ensure(); });
  mo.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener("DOMContentLoaded", () => setTimeout(() => { wrapFetch(); ensure(); }, 400), { once: true });
  wrapFetch();
  setTimeout(() => { wrapFetch(); ensure(); }, 800);
  setInterval(wrapFetch, 2000);
})();
