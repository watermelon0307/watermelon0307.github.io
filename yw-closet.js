/* WARMTH CLOSET — 餘溫衣間（衣櫃 V1.0＋V2.1 精簡）
 * 依據 docs/neon-city/wardrobe-design.md（使用者提供）：
 *   V1.0 衣櫃首頁、分類管理、服裝詳情、收藏
 *   V2.1 商城聯動、虹幣購買、願望清單
 * 資料原則：全走既有真實 API——/api/life/wardrobe（GET/POST/PUT/DELETE）、
 *   /api/life/mall（商品＋餘額）、/api/life/mall/buy（真實扣虹幣）、/api/life/wallet。
 *   收藏為既有欄位的真實更新（PUT）；後端無 wishlist API，願望清單存本機 localStorage，UI 如實標示。
 * 掛載原則：非侵入 MutationObserver 注入，不改既有 React 路由；city-tabs 加一格「衣櫃」。
 */
(() => {
  "use strict";

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => [...(root || document).querySelectorAll(sel)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const CATEGORIES = ["上衣", "下身", "外套", "洋裝", "鞋子", "配件"];
  const SEASONS = ["四季", "春", "夏", "秋", "冬"];
  const STYLES = ["日常", "簡約", "學院", "休閒", "復古", "甜美", "街頭", "正式", "運動"];
  const KIND_TO_CAT = [
    [/top|shirt|tee|blouse|sweater|hoodie|knit|shirt/i, "上衣"],
    [/bottom|pants|skirt|jean|short|trouser/i, "下身"],
    [/coat|jacket|outer|blazer|cardigan/i, "外套"],
    [/dress|onepiece/i, "洋裝"],
    [/shoe|sneaker|boot|heel|sandal|loafer/i, "鞋子"],
    [/bag|hat|accessor|scarf|belt|jewel|watch|glass/i, "配件"],
  ];

  const WISH_KEY = "warmth-closet:wishlist:v1";

  const S = {
    root: null,        // 面板容器
    tabBtn: null,      // city-tabs 裡的「衣櫃」鈕
    open: false,
    tab: "closet",     // closet | mall
    items: [],         // /api/life/wardrobe
    wishlist: [],      // 本機 localStorage（後端無 wishlist API，標明本機儲存）
    mall: null,        // { categories, items, balance }
    wallet: null,      // /api/life/wallet
    busy: false, error: null,
    filter: { cat: "全部", q: "", fav: false },
    detailId: null,
    injecting: false,
  };

  function loadWishlist() {
    try { S.wishlist = JSON.parse(localStorage.getItem(WISH_KEY) || "[]"); }
    catch { S.wishlist = []; }
    if (!Array.isArray(S.wishlist)) S.wishlist = [];
  }
  function saveWishlist() {
    try { localStorage.setItem(WISH_KEY, JSON.stringify(S.wishlist)); } catch { /* ignore */ }
  }

  async function apiGet(p) { const r = await fetch(p); if (!r.ok) throw new Error("GET " + p + "→" + r.status); return r.json(); }
  async function apiSend(m, p, body) { const r = await fetch(p, { method: m, headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) }); let j = null; try { j = await r.json(); } catch { } return { ok: r.ok, status: r.status, body: j }; }

  /* ---------- 資料 ---------- */

  async function loadAll() {
    S.error = null;
    try {
      const [ward, mall, wallet] = await Promise.all([
        apiGet("/api/life/wardrobe").catch(() => []),
        apiGet("/api/life/mall").catch(() => null),
        apiGet("/api/life/wallet").catch(() => null),
      ]);
      S.items = Array.isArray(ward) ? ward : [];
      loadWishlist(); // 願望清單從本機讀
      S.mall = mall && Array.isArray(mall.items) ? mall : null;
      S.wallet = wallet;
      // 商城餘額可能掛在 mall.balance
      if (S.wallet == null && mall && Number.isFinite(mall.balance)) S.wallet = { balance: mall.balance };
    } catch (e) {
      S.error = e?.message || String(e);
    }
  }

  function balance() {
    const b = S.wallet?.balance ?? S.wallet?.amount ?? S.wallet?.yuan ?? S.mall?.balance;
    return Number.isFinite(b) ? b : null;
  }

  function guessCategory(name) {
    for (const [re, cat] of KIND_TO_CAT) if (re.test(name || "")) return cat;
    return "配件";
  }

  /* ---------- 面板 DOM ---------- */

  function buildPanel() {
    const el = document.createElement("section");
    el.className = "ywc";
    el.setAttribute("aria-label", "餘溫衣間");
    el.hidden = true;
    el.innerHTML =
      `<div class="ywc-head">` +
      `<div class="ywc-title"><b>WARMTH CLOSET</b><span>餘溫衣間 · 你的私人穿搭空間</span></div>` +
      `<button type="button" class="ywc-close" data-ywc-close aria-label="關閉衣櫃">✕</button>` +
      `</div>` +
      `<div class="ywc-tabs" role="tablist">` +
      `<button type="button" data-ywc-tab="closet" role="tab">衣櫃</button>` +
      `<button type="button" data-ywc-tab="mall" role="tab">商城</button>` +
      `</div>` +
      `<div class="ywc-stats" data-ywc-stats></div>` +
      `<p class="ywc-err" data-ywc-err hidden></p>` +
      `<div class="ywc-body" data-ywc-body></div>`;
    el.addEventListener("click", onClick);
    el.addEventListener("submit", onSubmit);
    el.addEventListener("input", onInput);
    el.addEventListener("change", onChange);
    return el;
  }

  /* ---------- 統計列 ---------- */

  function renderStats() {
    const box = $("[data-ywc-stats]", S.root);
    if (!box) return;
    const fav = S.items.filter((i) => i.favorite || i.fav).length;
    const b = balance();
    box.innerHTML =
      `<div class="ywc-stat"><b>${S.items.length}</b><span>擁有服飾</span></div>` +
      `<div class="ywc-stat"><b>${fav}</b><span>收藏搭配</span></div>` +
      `<div class="ywc-stat"><b>${S.wishlist.length}</b><span>願望清單</span></div>` +
      (b != null ? `<div class="ywc-stat ywc-money"><b>${b.toLocaleString("zh-Hant")}</b><span>虹幣</span></div>` : "");
  }

  /* ---------- 衣櫃視圖 ---------- */

  function renderCloset() {
    const body = $("[data-ywc-body]", S.root);
    if (!body) return;
    const f = S.filter;
    const cats = ["全部", ...CATEGORIES];
    let list = S.items;
    if (f.fav) list = list.filter((i) => i.favorite || i.fav);
    if (f.cat !== "全部") list = list.filter((i) => (i.category || guessCategory(i.name)) === f.cat);
    if (f.q) { const q = f.q.toLowerCase(); list = list.filter((i) => (i.name || "").toLowerCase().includes(q) || (i.color || "").toLowerCase().includes(q) || (i.style || "").toLowerCase().includes(q)); }

    const toolbar =
      `<div class="ywc-toolbar">` +
      `<div class="ywc-cats">${cats.map((c) => `<button type="button" data-ywc-cat="${esc(c)}" class="${f.cat === c ? "on" : ""}">${esc(c)}</button>`).join("")}</div>` +
      `<div class="ywc-tools-row">` +
      `<input data-ywc-q type="search" placeholder="搜尋名尋名稱／顏色／風格" value="${esc(f.q)}" />` +
      `<button type="button" data-ywc-favtoggle class="${f.fav ? "on" : ""}" aria-pressed="${f.fav}">♥ 收藏</button>` +
      `<button type="button" data-ywc-addopen>＋ 新增服飾</button>` +
      `</div></div>`;

    const addForm = S.adding ?
      `<form class="ywc-add" data-ywc-addform>` +
      `<input data-f="name" name="name" required maxlength="40" placeholder="服飾名稱（例：奶油針織外套）" />` +
      `<div class="ywc-add-row">` +
      `<select data-f="category" name="category">${CATEGORIES.map((c) => `<option>${c}</option>`).join("")}</select>` +
      `<input data-f="color" name="color" maxlength="16" placeholder="顏色" />` +
      `</div>` +
      `<div class="ywc-add-row">` +
      `<select data-f="style" name="style">${STYLES.map((s) => `<option>${s}</option>`).join("")}</select>` +
      `<select data-f="season" name="season">${SEASONS.map((s) => `<option>${s}</option>`).join("")}</select>` +
      `</div>` +
      `<div class="ywc-add-row"><button type="submit" class="ywc-primary">加入衣櫃</button><button type="button" data-ywc-addcancel>取消</button></div>` +
      `</form>` : "";

    const grid = list.length
      ? `<div class="ywc-grid">${list.map(cardHtml).join("")}</div>`
      : `<p class="ywc-empty">${S.items.length ? "沒有符合條件的服飾。" : "衣櫃還是空的，先新增一件，或去商城逛逛。"}</p>`;

    body.innerHTML = toolbar + addForm + grid;
    if (S.detailId) renderDetail(body);
  }

  function cardHtml(i) {
    const cat = i.category || guessCategory(i.name);
    const fav = i.favorite || i.fav;
    return (
      `<article class="ywc-card" data-ywc-card="${esc(i.id)}" tabindex="0" role="button" aria-label="${esc(i.name)}">` +
      `<div class="ywc-thumb ywc-thumb-${esc(cat)}"><span>${esc((i.name || "?").slice(0, 1))}</span></div>` +
      `<div class="ywc-card-meta"><b>${esc(i.name)}</b><small>${esc(cat)}${i.color ? " · " + esc(i.color) : ""}${i.season ? " · " + esc(i.season) : ""}</small></div>` +
      `<button type="button" class="ywc-fav ${fav ? "on" : ""}" data-ywc-fav="${esc(i.id)}" aria-pressed="${!!fav}" aria-label="收藏">${fav ? "♥" : "♡"}</button>` +
      `</article>`
    );
  }

  /* ---------- 服裝詳情 ---------- */

  function renderDetail(body) {
    const i = S.items.find((x) => x.id === S.detailId);
    if (!i) { S.detailId = null; return; }
    const fav = i.favorite || i.fav;
    const dlg = document.createElement("div");
    dlg.className = "ywc-detail";
    dlg.innerHTML =
      `<div class="ywc-detail-card" role="dialog" aria-modal="true" aria-label="服裝詳情">` +
      `<div class="ywc-thumb ywc-thumb-${esc(i.category || guessCategory(i.name))} ywc-detail-thumb"><span>${esc((i.name || "?").slice(0, 1))}</span></div>` +
      `<h3>${esc(i.name)}</h3>` +
      `<dl>` +
      `<div><dt>分類</dt><dd>${esc(i.category || guessCategory(i.name))}</dd></div>` +
      (i.color ? `<div><dt>顏色</dt><dd>${esc(i.color)}</dd></div>` : "") +
      (i.style ? `<div><dt>風格</dt><dd>${esc(i.style)}</dd></div>` : "") +
      (i.season ? `<div><dt>季節</dt><dd>${esc(i.season)}</dd></div>` : "") +
      (i.brand ? `<div><dt>品牌</dt><dd>${esc(i.brand)}</dd></div>` : "") +
      `</dl>` +
      `<div class="ywc-detail-acts">` +
      `<button type="button" class="ywc-fav ${fav ? "on" : ""}" data-ywc-fav="${esc(i.id)}">${fav ? "♥ 已收藏" : "♡ 收藏"}</button>` +
      `<button type="button" class="ywc-danger" data-ywc-del="${esc(i.id)}">刪除</button>` +
      `</div>` +
      `<button type="button" class="ywc-close" data-ywc-detailclose aria-label="關閉詳情">✕</button>` +
      `</div>`;
    body.appendChild(dlg);
  }

  /* ---------- 商城視圖 ---------- */

  function renderMall() {
    const body = $("[data-ywc-body]", S.root);
    if (!body) return;
    if (!S.mall) {
      body.innerHTML = `<p class="ywc-empty">商城資料讀取失敗，或尚未開放。${S.error ? `<br><small>${esc(S.error)}</small>` : ""}</p>`;
      return;
    }
    const b = balance();
    const head =
      `<div class="ywc-mall-head">` +
      (b != null ? `<span class="ywc-balance">餘額 <b>${b.toLocaleString("zh-Hant")}</b> 虹幣</span>` : "") +
      `<span class="ywc-mall-note">購買真實扣虹幣並寫入帳本 · 願望清單存於本機</span>` +
      `</div>`;
    const list = S.mall.items.map((m) => {
      const owned = S.items.some((i) => i.name === m.name);
      const wished = S.wishlist.some((w) => w.itemId === m.id || w.name === m.name);
      const afford = b == null || b >= (m.price ?? 0);
      return (
        `<article class="ywc-mall-item" data-mid="${esc(m.id)}">` +
        `<div class="ywc-mall-meta"><b>${esc(m.name)}</b><small>${esc(m.category || guessCategory(m.name))}${m.desc ? " · " + esc(m.desc) : ""}</small></div>` +
        `<div class="ywc-mall-right">` +
        `<span class="ywc-price">${Number.isFinite(m.price) ? m.price.toLocaleString("zh-Hant") : "—"}</span>` +
        (owned ? `<span class="ywc-owned">已擁有</span>` :
          `<button type="button" class="ywc-buy" data-ywc-buy="${esc(m.id)}" ${afford ? "" : "disabled title=虹幣不足"}>購買</button>`) +
        `<button type="button" class="ywc-wish ${wished ? "on" : ""}" data-ywc-wish="${esc(m.id)}" aria-pressed="${wished}" aria-label="願望清單">${wished ? "♥" : "♡"}</button>` +
        `</div>` +
        `</article>`
      );
    }).join("");
    body.innerHTML = head + `<div class="ywc-mall-list">${list}</div>`;
  }

  /* ---------- 事件 ---------- */

  function onClick(e) {
    const t = e.target;
    const close = t.closest("[data-ywc-close]");
    if (close) { setOpen(false); return; }
    const tab = t.closest("[data-ywc-tab]");
    if (tab) { S.tab = tab.dataset.ywcTab; S.detailId = null; render(); return; }
    const cat = t.closest("[data-ywc-cat]");
    if (cat) { S.filter.cat = cat.dataset.ywcCat; render(); return; }
    if (t.closest("[data-ywc-favtoggle]")) { S.filter.fav = !S.filter.fav; render(); return; }
    if (t.closest("[data-ywc-addopen]")) { S.adding = true; render(); return; }
    if (t.closest("[data-ywc-addcancel]")) { S.adding = false; render(); return; }
    if (t.closest("[data-ywc-detailclose]")) { S.detailId = null; render(); return; }
    if (t.closest(".ywc-detail") && !t.closest(".ywc-detail-card")) { S.detailId = null; render(); return; }

    const fav = t.closest("[data-ywc-fav]");
    if (fav) { toggleFav(fav.dataset.ywcFav); return; }
    const del = t.closest("[data-ywc-del]");
    if (del) { removeItem(del.dataset.ywcDel); return; }
    const card = t.closest("[data-ywc-card]");
    if (card) { S.detailId = card.dataset.ywcCard; render(); return; }
    const buy = t.closest("[data-ywc-buy]");
    if (buy) { buyItem(buy.dataset.ywcBuy); return; }
    const wish = t.closest("[data-ywc-wish]");
    if (wish) { toggleWish(wish.dataset.ywcWish); return; }
  }

  function onSubmit(e) {
    const form = e.target.closest("[data-ywc-addform]");
    if (!form) return;
    e.preventDefault();
    const fd = new FormData(form);
    addItem({
      name: String(fd.get("name") || "").trim(),
      category: String(fd.get("category") || "上衣"),
      color: String(fd.get("color") || "").trim(),
      style: String(fd.get("style") || "日常"),
      season: String(fd.get("season") || "四季"),
    });
  }

  function onInput(e) {
    if (e.target.matches("[data-ywc-q]")) {
      S.filter.q = e.target.value;
      // 簡易 debounce
      clearTimeout(onInput.t);
      onInput.t = setTimeout(render, 220);
    }
  }
  function onChange() { }

  /* ---------- 操作（全走真實 API） ---------- */

  async function guard(fn) {
    if (S.busy) return;
    S.busy = true; S.error = null; render();
    try { await fn(); }
    catch (e2) { S.error = e2?.message || String(e2); }
    finally { S.busy = false; render(); }
  }

  function addItem(data) {
    guard(async () => {
      if (!data.name) throw new Error("請填服飾名稱");
      const r = await apiSend("POST", "/api/life/wardrobe", data);
      if (!r.ok) throw new Error("加入失敗（" + r.status + "）");
      S.adding = false;
      await loadAll();
    });
  }

  function toggleFav(id) {
    guard(async () => {
      const i = S.items.find((x) => x.id === id);
      if (!i) return;
      const r = await apiSend("PUT", "/api/life/wardrobe/" + encodeURIComponent(id), { favorite: !(i.favorite || i.fav) });
      if (!r.ok) throw new Error("收藏更新失敗（" + r.status + "）");
      await loadAll();
    });
  }

  function removeItem(id) {
    guard(async () => {
      const r = await fetch("/api/life/wardrobe/" + encodeURIComponent(id), { method: "DELETE" });
      if (!r.ok) throw new Error("刪除失敗（" + r.status + "）");
      S.detailId = null;
      await loadAll();
    });
  }

  function buyItem(mid) {
    guard(async () => {
      const m = S.mall.items.find((x) => x.id === mid);
      if (!m) return;
      const r = await apiSend("POST", "/api/life/mall/buy", { itemId: mid, to: "me" });
      if (!r.ok) throw new Error(r.body?.error === "cannotAfford" ? "虹幣不足" : ("購買失敗（" + (r.body?.error || r.status) + "）"));
      // 買到後寫入衣櫃
      await apiSend("POST", "/api/life/wardrobe", { name: m.name, category: guessCategory(m.name), color: m.color || "", style: m.style || "日常", season: m.season || "四季", source: "mall", itemId: m.id });
      await loadAll();
    });
  }

  function toggleWish(mid) {
    guard(async () => {
      const m = S.mall.items.find((x) => x.id === mid);
      if (!m) return;
      const exist = S.wishlist.find((w) => w.itemId === mid || w.name === m.name);
      if (exist) {
        S.wishlist = S.wishlist.filter((w) => w !== exist);
      } else {
        S.wishlist.push({ itemId: m.id, name: m.name, price: m.price ?? null, category: guessCategory(m.name), addedAt: Date.now() });
      }
      saveWishlist();
      await loadAll();
    });
  }

  /* ---------- 渲染與開關 ---------- */

  function render() {
    if (!S.root) return;
    // tab 態
    $$("[data-ywc-tab]", S.root).forEach((b) => {
      const on = b.dataset.ywcTab === S.tab;
      b.classList.toggle("on", on);
      b.setAttribute("aria-selected", String(on));
    });
    const err = $("[data-ywc-err]", S.root);
    if (err) { err.hidden = !S.error; err.textContent = S.error ? "發生錯誤：" + S.error : ""; }
    renderStats();
    if (S.tab === "mall") renderMall(); else renderCloset();
    S.root.classList.toggle("is-busy", S.busy);
  }

  function setOpen(on) {
    if (on === S.open) return;
    S.open = on;
    if (S.root) S.root.hidden = !on;
    if (S.tabBtn) { S.tabBtn.setAttribute("aria-pressed", String(on)); S.tabBtn.classList.toggle("on", on); }
    const page = S.root?.closest(".city-page");
    if (page) page.classList.toggle("ywc-open", on);
    if (on) { loadAll().then(render); }
  }

  /* ---------- 掛載 ---------- */

  function bind(page) {
    const tabs = $(".city-tabs", page);
    if (!tabs) return;

    // city-tabs 會被 React 整棵重渲染（點 seg 就重畫），注入物會被清掉——
    // 所以每次 inject 都檢查「鈕還在不在、還連不連著」，不在就重建，不用 __ywcBound 旗標。
    let btn = $(".ywc-tabbtn", tabs);
    if (!btn || !btn.isConnected) {
      btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ywc-tabbtn";
      btn.setAttribute("aria-pressed", String(S.open));
      btn.textContent = "衣櫃";
      btn.addEventListener("click", (e) => { e.stopPropagation(); setOpen(!S.open); });
      tabs.appendChild(btn);
    }
    btn.classList.toggle("on", S.open);
    S.tabBtn = btn;

    // 面板放 city-map-wrap 之後；不存在才建，存在就只同步參照
    let panel = $(".ywc", page);
    if (!panel || !panel.isConnected) {
      panel = buildPanel();
      const anchor = $(".city-map-wrap", page) || tabs;
      anchor.insertAdjacentElement("afterend", panel);
      panel.hidden = !S.open;
      if (S.open) { loadAll().then(render); } else { render(); }
    }
    S.root = panel;
    page.classList.toggle("ywc-open", S.open);
  }

  let scheduled = false;
  function inject() {
    scheduled = false;
    for (const page of document.querySelectorAll(".city-page")) bind(page);
    // 頁面重掛釋放參照
    if (S.root && !S.root.isConnected) { S.root = null; }
    if (S.tabBtn && !S.tabBtn.isConnected) { S.tabBtn = null; }
  }
  // 同步排程：React 重渲染後 observer 回呼立刻補注入，不等 rAF
  function scheduleInject() { inject(); }

  const observer = new MutationObserver(scheduleInject);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener("hashchange", scheduleInject);
  document.addEventListener("DOMContentLoaded", scheduleInject, { once: true });
  scheduleInject();

  /* ---------- 偵錯掛點（測試用） ---------- */
  window.__warmthCloset = {
    get open() { return S.open; },
    get tab() { return S.tab; },
    get itemCount() { return S.items.length; },
    get mallCount() { return S.mall?.items?.length ?? 0; },
    get wishlistCount() { return S.wishlist.length; },
    get balance() { return balance(); },
    get error() { return S.error; },
    openPanel: () => setOpen(true),
    closePanel: () => setOpen(false),
    setTab: (t) => { S.tab = t; render(); },
    reload: () => loadAll().then(render),
    version: "1.0.0",
  };
})();
