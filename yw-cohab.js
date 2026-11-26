/* 餘溫 B14：同住生活面板。非侵入聊天入口；狀態與金流只讀寫既有頁內 API。 */
(() => {
  "use strict";
  const $ = (selector, el = document) => el.querySelector(selector);
  const $$ = (selector, el = document) => [...el.querySelectorAll(selector)];
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  const fmt = (value) => Math.max(0, Math.round(Number(value) || 0)).toLocaleString("zh-TW");
  const dateFmt = (value, withTime = false) => value ? new Intl.DateTimeFormat("zh-TW", { year: "numeric", month: "2-digit", day: "2-digit", ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}) }).format(new Date(value)) : "—";
  const actionId = (prefix) => `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
  const C = () => globalThis.YWCohabCore;
  const STATUS = {
    none: ["尚未提議", "先確認彼此都準備好，把喜歡延伸成日常。"],
    proposed: ["提議已送達", "下一步不是直接簽約，是一起走進房子看看。"],
    viewing: ["挑一個共同的家", "每次看房都是一場真實的面對面約會。"],
    moving: ["把舊物帶進新生活", "四只箱子、四段故事，全部安放好才算搬進來。"],
    active: ["兩個人的日常訊號", "柴米、家務、帳單與照顧，都會留在你們的生活裡。"],
    movedOut: ["回憶沒有被刪除", "同住已結束；家具、家規、帳本與故事仍然保留。"],
  };
  const SLOT_NAMES = { morning: "早晨", leave: "出門", day: "日間", dusk: "黃昏", night: "夜晚", late: "深夜" };
  const SPLIT_NAMES = { aa: "各自一半", income: "依收入比例", user: "由我支付", ta: "由 TA 支付", joint: "共同帳戶優先" };
  const TABS = [
    ["home", "總覽", "home"], ["life", "日常", "spark"], ["chores", "家務", "list"],
    ["ledger", "帳本", "wallet"], ["cook", "廚房", "cook"], ["care", "照護", "heart"],
  ];
  const S = {
    open: false, loading: false, busy: "", error: "", uncertain: "", notice: "", altAt: 0,
    charId: "", convId: "", data: null, tab: "home", houseId: "attic", confirmMoveOut: false,
    returnFocus: null, choreDraft: null, choreDirty: false, lastCook: null,
    cook: { recipeId: "tomato", cuts: 0, flipOffsetMs: null, flipStartedAt: 0, plating: "warm", actionId: null },
    care: { who: "ta", action: "porridge" },
  };

  function icon(name, size = 20) {
    const paths = {
      home: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v10h13V10M9 20v-6h6v6"/>',
      close: '<path d="m6 6 12 12M18 6 6 18"/>',
      spark: '<path d="m12 3 1.6 5.4L19 10l-5.4 1.6L12 17l-1.6-5.4L5 10l5.4-1.6L12 3Z"/><path d="m19 16 .7 2.3L22 19l-2.3.7L19 22l-.7-2.3L16 19l2.3-.7L19 16Z"/>',
      list: '<path d="M9 6h11M9 12h11M9 18h11"/><path d="m3 6 1 1 2-2m-3 7 1 1 2-2m-3 7 1 1 2-2"/>',
      wallet: '<path d="M4 6.5h14a2 2 0 0 1 2 2v10H4a2 2 0 0 1-2-2v-12a2 2 0 0 1 2-2h13v4"/><path d="M15 11h7v5h-7a2.5 2.5 0 0 1 0-5Z"/>',
      cook: '<path d="M7 3v7m3-7v7m3-7v7M5 10h10v3a5 5 0 0 1-10 0v-3Zm5 8v4M4 21h12"/><path d="M18 4c2 2 2 5 0 7v10"/>',
      heart: '<path d="M20.8 5.8a5.4 5.4 0 0 0-7.6 0L12 7l-1.2-1.2a5.4 5.4 0 0 0-7.6 7.6L12 22l8.8-8.6a5.4 5.4 0 0 0 0-7.6Z"/>',
      key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9m-4 4 3 3m-6 0 3 3"/>',
      box: '<path d="m4 7 8-4 8 4-8 4-8-4Zm0 0v10l8 4 8-4V7M12 11v10"/>',
      check: '<path d="m5 12 4 4L19 6"/>',
      arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
      alert: '<path d="M12 3 2 21h20L12 3Z"/><path d="M12 9v5m0 3v.1"/>',
      calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4m8-4v4M3 10h18"/>',
    };
    return `<svg class="ywc-icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.spark}</svg>`;
  }

  function toast(text, bad = false) {
    $(".ywc-toast")?.remove();
    const el = document.createElement("div");
    el.className = `ywc-toast${bad ? " bad" : ""}`;
    el.setAttribute("role", bad ? "alert" : "status");
    el.textContent = text;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3200);
  }

  function ensureRoot() {
    let root = $("#ywCohabRoot");
    if (!root) { root = document.createElement("div"); root.id = "ywCohabRoot"; document.body.appendChild(root); }
    return root;
  }

  function currentChatId() {
    const match = location.hash.match(/#\/chat\/([^/?&#]+)/);
    return match ? decodeURIComponent(match[1]) : "";
  }

  async function characterForConversation(convId) {
    const response = await fetch(`/api/conversations/${encodeURIComponent(convId)}`);
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "找不到這段對話");
    const id = body.characterId || body.character_id || body.participantId || (body.type === "direct" ? body.members?.[0] : null);
    if (id) return id;
    const characters = await (await fetch("/api/characters")).json();
    const found = (Array.isArray(characters) ? characters : characters.characters || []).find((ch) => ch.conversationId === convId || ch.conversation_id === convId);
    return found?.id || "";
  }

  async function openChat() {
    const convId = currentChatId();
    if (!convId) return toast("請先進入一位角色的聊天室", true);
    S.returnFocus = document.activeElement;
    S.convId = convId; S.open = true; S.loading = true; S.error = ""; S.data = null; S.charId = "";
    render();
    try {
      const id = await characterForConversation(convId);
      if (!id) throw new Error("群組聊天沒有單一同住對象，請從一對一聊天進入");
      await openForCharacter(id, convId);
    } catch (error) {
      S.loading = false; S.error = error.message || "無法開啟同住生活"; render();
    }
  }

  async function openForCharacter(id, convId = "") {
    S.returnFocus ||= document.activeElement;
    S.charId = id; S.convId = convId || S.convId; S.open = true; S.loading = true; S.error = ""; S.uncertain = ""; S.notice = "";
    S.data = null; S.tab = "home"; S.confirmMoveOut = false; S.altAt = 0; S.choreDraft = null; S.choreDirty = false;
    render();
    await refresh();
  }

  function close() {
    S.open = false; S.busy = ""; S.confirmMoveOut = false;
    document.body.classList.remove("ywc-open");
    render();
    const target = S.returnFocus; S.returnFocus = null;
    if (target?.isConnected) setTimeout(() => target.focus({ preventScroll: true }), 0);
  }

  function syncDraft() {
    if (!S.data) return;
    const state = S.data.state;
    if (!S.houseId || (["moving", "active", "movedOut"].includes(state.status) && state.homeId)) S.houseId = state.homeId || "attic";
    if (!S.choreDirty) S.choreDraft = { assignments: { ...(state.chores?.assignments || {}) }, completed: { ...(state.chores?.completed || {}) } };
  }

  async function refresh() {
    if (!S.charId) return;
    S.loading = !S.data; S.error = ""; S.uncertain = ""; render();
    try {
      const response = await fetch(`/api/cohab/${encodeURIComponent(S.charId)}`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "同住狀態讀取失敗");
      S.data = body; S.loading = false; syncDraft();
      if (body.state.status === "movedOut" && !["home", "ledger"].includes(S.tab)) S.tab = "home";
      render();
    } catch (error) {
      S.loading = false; S.error = error.message || "同住狀態讀取失敗"; render();
    }
  }

  async function perform(path, payload, label, success = "已保存") {
    if (S.busy) return null;
    S.busy = label; S.error = ""; S.notice = ""; S.uncertain = ""; S.altAt = 0; render();
    let response;
    try {
      response = await fetch(`/api/cohab/${encodeURIComponent(S.charId)}${path}`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload || {}),
      });
    } catch {
      S.busy = ""; S.uncertain = label;
      S.error = `「${label}」的連線中斷，結果尚未確認。請先重新讀取狀態；系統不會自動重送，避免重複扣款或記錄。`;
      render(); return null;
    }
    const body = await response.json().catch(() => ({}));
    S.busy = "";
    if (!response.ok) {
      S.error = body.error || `${label}失敗，請稍後再試`;
      if (body.date?.propose) S.altAt = body.date.propose;
      render(); return null;
    }
    if (body.state) S.data = body;
    syncDraft();
    S.notice = body.duplicate ? "這項操作已處理過，沒有重複扣款或寫入" : success;
    render();
    return body;
  }

  function button(action, label, style = "secondary", disabled = false, extra = "") {
    const off = disabled || !!S.busy;
    return `<button type="button" class="ywc-btn ${style}" data-act="${action}" data-focus="${action}" ${off ? "disabled" : ""} ${extra}>${S.busy && extra.includes("data-primary-busy") ? '<span class="ywc-spinner"></span>' : ""}<span>${esc(label)}</span></button>`;
  }

  function empty(title, text, symbol = "home") {
    return `<div class="ywc-empty"><span class="ywc-empty-icon">${icon(symbol, 26)}</span><h3>${esc(title)}</h3><p>${esc(text)}</p></div>`;
  }

  function noticeHtml() {
    return `${S.error ? `<div class="ywc-alert error" role="alert">${icon("alert", 19)}<div><b>這一步還沒有完成</b><p>${esc(S.error)}</p>${S.altAt ? `<p class="ywc-alt-time">TA 提議：${dateFmt(S.altAt, true)}</p>${button("visit-alt", "改用 TA 提議的時間", "warm", false, 'data-primary-busy="1"')}` : ""}${S.uncertain ? button("refresh", "先重新讀取狀態", "secondary") : ""}</div></div>` : ""}${S.notice ? `<div class="ywc-alert success" role="status">${icon("check", 19)}<p>${esc(S.notice)}</p></div>` : ""}`;
  }

  function statusHero() {
    if (!S.data) return "";
    const { state, character, wallet } = S.data;
    const [title, desc] = STATUS[state.status] || STATUS.none;
    const opened = state.boxes?.filter((box) => box.opened).length || 0;
    return `<section class="ywc-hero ywc-cut">
      <div class="ywc-hero-copy"><div class="ywc-eyebrow"><i></i> HOME SIGNAL // ${state.status === "active" ? "CONNECTED" : "STANDBY"}</div>
      <h2>${esc(title)}<span>與 ${esc(character.name)}</span></h2><p>${esc(desc)}</p>
      <div class="ywc-signal-line"><span></span><b>${state.status === "moving" ? `${opened} / 4 BOXES` : state.status === "active" ? `${dateFmt(state.movedAt)} 起同住` : esc(S.data.eligibility.hint)}</b></div></div>
      <div class="ywc-house-mark" aria-hidden="true"><span class="ywc-roof"></span><span class="ywc-window one"></span><span class="ywc-window two"></span><i></i></div>
      <div class="ywc-wallet-strip"><div><small>你的免費錢包</small><strong>${fmt(wallet.user)}</strong></div><div><small>TA 的免費錢包</small><strong>${fmt(wallet.ta)}</strong></div><div><small>共同帳戶</small><strong>${fmt(wallet.joint)}</strong></div><span>虹幣</span></div>
    </section>`;
  }

  function stepper() {
    const status = S.data.state.status;
    const order = ["none", "proposed", "viewing", "moving", "active"];
    const current = status === "movedOut" ? 5 : Math.max(0, order.indexOf(status));
    const labels = ["提議", "看房", "簽約", "搬家", "日常"];
    return `<ol class="ywc-steps" aria-label="同住進度">${labels.map((label, index) => `<li class="${index < current ? "done" : index === current ? "now" : ""}" ${index === current ? 'aria-current="step"' : ""}><span>${index < current ? icon("check", 13) : String(index + 1).padStart(2, "0")}</span><b>${label}</b></li>`).join("")}</ol>`;
  }

  function tabHtml() {
    const movedOut = S.data?.state.status === "movedOut";
    return `<nav class="ywc-tabs" role="tablist" aria-label="同住生活功能">${TABS.map(([id, label, glyph]) => {
      const disabled = movedOut && !["home", "ledger"].includes(id);
      return `<button type="button" role="tab" id="ywc-tab-${id}" aria-controls="ywc-panel" aria-selected="${S.tab === id}" tabindex="${S.tab === id ? 0 : -1}" class="${S.tab === id ? "on" : ""}" data-tab="${id}" ${disabled ? "disabled" : ""}>${icon(glyph, 18)}<span>${label}</span></button>`;
    }).join("")}</nav>`;
  }

  function homeHtml() {
    const { state, eligibility, character } = S.data;
    if (state.status === "none") return `${stepper()}<section class="ywc-section ywc-proposal">
      <div class="ywc-section-head"><div><span class="ywc-kicker">01 / PROPOSAL</span><h3>把「以後」說成具體的生活</h3></div><span class="ywc-status-chip">${esc(eligibility.stageName || "目前關係")}</span></div>
      <p>同住不是換一個聊天背景。你們會一起看房、負擔押金與房租，也要面對家務、摩擦和每一頓晚餐。</p>
      <div class="ywc-gate ${eligibility.allowed ? "ready" : ""}">${icon(eligibility.allowed ? "check" : "calendar", 22)}<div><b>${esc(eligibility.hint)}</b><span>戀人／至親階段滿 14 天・目前第 ${eligibility.days} 天</span></div></div>
      ${button("invite", `向 ${character.name} 提議同住`, "primary", !eligibility.allowed, 'data-primary-busy="1"')}
      <small class="ywc-footnote">提議本身不扣款；房子要看過、雙方資金足夠後才會簽約。</small>
    </section>`;
    if (["proposed", "viewing"].includes(state.status)) return viewingHtml();
    if (state.status === "moving") return movingHtml();
    if (state.status === "movedOut") return movedOutHtml();
    return activeHomeHtml();
  }

  function viewingHtml() {
    const { state, houses, wallet, date } = S.data;
    const selected = houses.find((house) => house.id === S.houseId) || houses[0];
    const hasVisit = state.visited.includes(selected.id);
    const viewing = state.viewing;
    const activeVisit = viewing && date?.active;
    const total = wallet.user + wallet.ta;
    return `${stepper()}<section class="ywc-section"><div class="ywc-section-head"><div><span class="ywc-kicker">02–03 / VIEW & LEASE</span><h3>先看見生活，再決定地址</h3></div><span class="ywc-status-chip">已看 ${state.visited.length} 間</span></div>
      <div class="ywc-house-grid">${houses.map((house) => `<button type="button" class="ywc-house-card ${selected.id === house.id ? "on" : ""}" data-house="${house.id}" data-focus="house-${house.id}" aria-pressed="${selected.id === house.id}">
        <span class="ywc-house-no">0${houses.indexOf(house) + 1}</span><span class="ywc-district">${esc(house.district)}</span>
        <b>${esc(house.name)}</b><p>${esc(house.feature)}</p><span class="ywc-house-price"><strong>${fmt(house.rent)}</strong> / 月</span>
        <small>押一付三 ${fmt(house.due)}・水電 ${fmt(house.utilities)}</small>${state.visited.includes(house.id) ? `<em>${icon("check", 13)} 已看房</em>` : ""}
      </button>`).join("")}</div>
      <article class="ywc-detail-card"><div><span class="ywc-kicker">CURRENT PICK</span><h4>${esc(selected.name)}</h4><p>${esc(selected.preference)}可能特別喜歡這裡，但真正的反應要等看過才知道。</p></div>
        <div class="ywc-detail-actions">${activeVisit ? `${button("visit-end", "結束這場看房約會", "primary", false, 'data-primary-busy="1"')}<small>約會進行中：${esc(date.active.sceneName || date.active.sceneId || "面對面看房")}</small>` : viewing?.status === "planned" ? `<div class="ywc-planned">${icon("calendar", 18)} 已預約 ${dateFmt(viewing.at, true)}${button("refresh", "重新確認約會狀態", "secondary")}</div>` : button("visit", `約 TA 看${selected.name}`, "primary", !!date?.active, 'data-primary-busy="1"')}</div>
      </article>
      ${S.altAt ? "" : ""}
      ${state.visitLog.length ? `<div class="ywc-visit-log">${state.visitLog.slice(-3).reverse().map((log) => `<div>${icon("home", 18)}<p><b>${esc(houses.find((h) => h.id === log.homeId)?.name || log.homeId)}</b><span>${esc(log.reaction?.line || log.line || "看房已完成")}</span></p><small>${esc(log.grade || "完成")}</small></div>`).join("")}</div>` : ""}
    </section>
    <section class="ywc-section ywc-lease"><div class="ywc-section-head"><div><span class="ywc-kicker">LEASE / FREE WALLET ONLY</span><h3>簽下 ${esc(selected.name)}</h3></div><span class="ywc-money">${fmt(selected.due)} <small>虹幣</small></span></div>
      <div class="ywc-funds"><span>雙方可用合計 <b>${fmt(total)}</b></span><span class="${total < selected.due ? "short" : "ok"}">${total < selected.due ? `還差 ${fmt(selected.due - total)}` : "資金已足夠"}</span></div>
      <fieldset class="ywc-split-pick"><legend>這次押一付三如何分攤</legend>${["aa", "income", "user", "ta"].map((mode) => `<label><input type="radio" name="ywcSignSplit" value="${mode}" ${state.splitMode === mode ? "checked" : ""}><span>${SPLIT_NAMES[mode]}</span></label>`).join("")}</fieldset>
      <p class="ywc-note">先依分攤方式付款；若一方餘額不足，另一方會以實際餘額補足並記入雙向代墊。付費虹幣不參與。</p>
      ${button("sign", hasVisit ? `支付 ${fmt(selected.due)} 並簽約` : "完成這間房的看房後才能簽約", "warm", !hasVisit || !!date?.active, 'data-primary-busy="1"')}
    </section>`;
  }

  function movingHtml() {
    const { state, houses } = S.data;
    const opened = state.boxes.filter((box) => box.opened).length;
    const house = houses.find((h) => h.id === state.homeId);
    return `${stepper()}<section class="ywc-section"><div class="ywc-section-head"><div><span class="ywc-kicker">04 / UNPACKING</span><h3>${esc(house?.name || "新家")}・四箱舊物</h3></div><span class="ywc-status-chip">${opened} / 4</span></div>
      <p>點擊箱子就能安放，不需要拖放。TA 會真的生成一段舊物故事；生成失敗時箱子不會被打開。</p>
      <div class="ywc-box-progress"><span style="width:${opened * 25}%"></span></div>
      <div class="ywc-box-grid">${state.boxes.map((box, index) => `<article class="ywc-box-card ${box.opened ? "opened" : ""}">
        <div class="ywc-box-top"><span>${icon(box.opened ? "check" : "box", 25)}</span><small>BOX 0${index + 1}・${esc(box.roomName)}</small></div>
        <h4>${esc(box.item)}</h4>${box.opened ? `<p class="ywc-story">「${esc(box.story)}」</p><small>${dateFmt(box.openedAt, true)}・故事已寫入聊天</small>` : `<p>還封著膠帶。把這件舊物放進${esc(box.roomName)}，聽 TA 說說它為什麼值得留下。</p>${button(`open-box:${box.id}`, `打開${box.roomName}的箱子`, "secondary", false, 'data-primary-busy="1"')}`}
      </article>`).join("")}</div>
    </section>`;
  }

  function activeHomeHtml() {
    const { state, houses, character, careNeeded } = S.data;
    const house = houses.find((h) => h.id === state.homeId);
    const event = state.events.pending;
    const friction = state.activeFrictionId ? S.data.frictions.find((f) => f.id === state.activeFrictionId) : null;
    const due = state.bills.filter((bill) => bill.status !== "paid");
    return `<section class="ywc-section ywc-live"><div class="ywc-section-head"><div><span class="ywc-kicker">05 / LIVING TOGETHER</span><h3>${esc(house?.name || "共同的家")}</h3></div><span class="ywc-live-pill"><i></i> 日常連線中</span></div>
      <div class="ywc-life-grid"><button type="button" class="ywc-life-card cyan" data-tab="life"><span>${icon("spark", 23)}</span><small>目前時段</small><b>${event ? esc(event.title) : "這個時段已一起度過"}</b><p>${event ? "有一件小事等你回應" : "下一個生活時段再回來看看"}</p>${icon("arrow", 18)}</button>
      <button type="button" class="ywc-life-card gold" data-tab="chores"><span>${icon("list", 23)}</span><small>本週家務</small><b>${Object.keys(state.chores.assignments || {}).length} / ${S.data.chores.length} 項已分配</b><p>不滿 ${state.discontent}・家規 ${state.rules.length} 條</p>${icon("arrow", 18)}</button>
      <button type="button" class="ywc-life-card" data-tab="ledger"><span>${icon("wallet", 23)}</span><small>家庭帳本</small><b>${due.length ? `${due.length} 個月份待繳` : "目前帳單已結清"}</b><p>${state.debt ? `你欠 TA ${fmt(state.debt)}` : state.taDebt ? `TA 欠你 ${fmt(state.taDebt)}` : "小本子目前沒有欠款"}</p>${icon("arrow", 18)}</button></div>
      ${friction ? `<article class="ywc-friction-banner"><span>${icon("alert", 21)}</span><div><small>生活摩擦・${character.name} 想和你談談</small><b>${esc(friction.title)}</b><p>「${esc(friction.line)}」</p></div>${button("go-friction", "好好談", "warm")}</article>` : ""}
      ${careNeeded ? `<div class="ywc-care-note">${icon("heart", 18)} 城市狀態顯示你目前需要休息；可以讓 ${esc(character.name)} 知道。</div>` : ""}
    </section>
    <section class="ywc-section ywc-compact"><div class="ywc-section-head"><div><span class="ywc-kicker">HOME MEMORIES</span><h3>一起帶來的舊物</h3></div><span class="ywc-status-chip">${dateFmt(state.movedAt)} 入住</span></div>
      <div class="ywc-memory-row">${state.boxes.map((box) => `<details><summary><span>${esc(box.roomName)}</span><b>${esc(box.item)}</b></summary><p>${esc(box.story)}</p></details>`).join("")}</div>
      <button type="button" class="ywc-text-btn danger" data-act="ask-move-out">結束這段同住生活</button>
    </section>${S.confirmMoveOut ? moveOutConfirmHtml() : ""}`;
  }

  function moveOutConfirmHtml() {
    return `<div class="ywc-confirm" role="alertdialog" aria-modal="true" aria-labelledby="ywcMoveOutTitle"><div>${icon("alert", 25)}<h3 id="ywcMoveOutTitle">確認結束同住？</h3><p>這不是刪除角色。家具、家規、帳單、舊物故事與聊天都會保留，但日常事件、做飯與照護會停止。</p><div>${button("cancel-move-out", "先留下來", "secondary")}${button("move-out", "確認搬出", "danger", false, 'data-primary-busy="1"')}</div></div></div>`;
  }

  function movedOutHtml() {
    const { state, houses } = S.data;
    const house = houses.find((h) => h.id === state.homeId);
    return `<section class="ywc-section"><div class="ywc-section-head"><div><span class="ywc-kicker">ARCHIVED / ${dateFmt(state.movedOutAt)}</span><h3>${esc(house?.name || "曾經共同的家")}</h3></div><span class="ywc-status-chip">紀錄保留</span></div>
      <p>這段同住生活已結束。舊家具仍在原住家，${state.rules.length} 條家規、${state.bills.length} 份帳單與 ${state.boxes.filter((b) => b.story).length} 段舊物故事沒有被重置。</p>
      <div class="ywc-memory-row">${state.boxes.filter((box) => box.story).map((box) => `<details><summary><span>${esc(box.roomName)}</span><b>${esc(box.item)}</b></summary><p>${esc(box.story)}</p></details>`).join("")}</div>
      ${button("go-ledger", "查看保留的家庭帳本", "secondary")}
    </section>`;
  }

  function lifeHtml() {
    const { state } = S.data;
    const event = state.events.pending;
    const history = state.events.history.slice().reverse();
    return `<section class="ywc-section"><div class="ywc-section-head"><div><span class="ywc-kicker">DAILY / CURRENT SLOT ONLY</span><h3>只接住現在這一刻</h3></div>${event ? `<span class="ywc-status-chip">${SLOT_NAMES[event.slot] || event.slot}</span>` : ""}</div>
      <div class="ywc-slot-strip">${C().SLOTS.map((slot) => `<div class="${event?.slot === slot.id ? "now" : ""}"><i></i><b>${SLOT_NAMES[slot.id]}</b><span>${String(slot.from).padStart(2, "0")}:00–${String(slot.to % 24).padStart(2, "0")}:00</span></div>`).join("")}</div>
      ${event ? `<article class="ywc-event-card ywc-cut"><span class="ywc-event-date">${esc(event.date)}・${SLOT_NAMES[event.slot]}</span><h3>${esc(event.title)}</h3><p>${esc(event.text)}</p><div class="ywc-choice-list">${event.options.map((option) => `<button type="button" data-act="event" data-event="${esc(event.id)}" data-option="${esc(option.id)}" data-focus="event-${esc(option.id)}" ${S.busy ? "disabled" : ""}><span>${esc(option.label)}</span>${icon("arrow", 18)}</button>`).join("")}</div></article>` : empty("這個時段已經過完了", "完成後同一時段不會重複出現；離線錯過的小事也不會補發。", "spark")}
    </section><section class="ywc-section"><div class="ywc-section-head"><div><span class="ywc-kicker">RECENT DAYS</span><h3>最近的生活小事</h3></div><span class="ywc-status-chip">${history.length} 則</span></div>
      ${history.length ? `<div class="ywc-history">${history.slice(0, 12).map((item) => `<article><time>${esc(item.date)}・${SLOT_NAMES[item.slot] || item.slot}</time><h4>${esc(item.title)}</h4><p><b>你選擇${esc(item.choice)}</b>${esc(item.reply)}</p></article>`).join("")}</div>` : empty("還沒有完成的小事", "日常會在六個生活時段自然出現。", "calendar")}
    </section>`;
  }

  function fairness() {
    return C().choreFairness(S.choreDraft?.assignments || {});
  }

  function frictionHtml() {
    const { state, frictions } = S.data;
    const active = state.activeFrictionId;
    if (!active) return "";
    const def = frictions.find((item) => item.id === active);
    if (!def) return "";
    const record = state.friction.find((item) => item.id === active);
    return `<article class="ywc-friction-card"><span class="ywc-kicker">TALK IT THROUGH</span><h3>${esc(def.title)}</h3><blockquote>「${esc(def.line)}」</blockquote><p>已擱置 ${record?.ignored || 0} 次。前兩次可以先緩緩，第三次重複忽略才會影響關係。</p><div class="ywc-choice-list">${def.options.map((option) => `<button type="button" data-act="friction" data-friction="${esc(def.id)}" data-option="${esc(option.id)}" data-focus="friction-${esc(option.id)}" ${S.busy ? "disabled" : ""}><span>${esc(option.label)}</span>${icon("arrow", 18)}</button>`).join("")}</div></article>`;
  }

  function choresHtml() {
    const { state, chores } = S.data;
    const fair = fairness();
    const draft = S.choreDraft || { assignments: {}, completed: {} };
    return `<section class="ywc-section"><div class="ywc-section-head"><div><span class="ywc-kicker">WEEK ${esc(state.chores.week || "—")}</span><h3>家務不是誰先受不了</h3></div><span class="ywc-status-chip ${fair.fair ? "good" : ""}">${fair.fair ? "本週分配公平" : `差距 ${fair.difference} 項`}</span></div>
      ${frictionHtml()}
      <div class="ywc-chore-list">${chores.map((chore) => `<article class="ywc-chore-row"><div class="ywc-chore-name"><button type="button" role="checkbox" aria-checked="${!!draft.completed[chore.id]}" class="ywc-check ${draft.completed[chore.id] ? "on" : ""}" data-act="chore-done" data-chore="${chore.id}" aria-label="標記${esc(chore.name)}${draft.completed[chore.id] ? "未完成" : "已完成"}">${icon("check", 16)}</button><b>${esc(chore.name)}</b></div><div class="ywc-assign" role="group" aria-label="${esc(chore.name)}分配">${[["user", "我"], ["ta", "TA"], ["together", "一起"]].map(([id, label]) => `<button type="button" data-act="chore-assign" data-chore="${chore.id}" data-value="${id}" class="${draft.assignments[chore.id] === id ? "on" : ""}" aria-pressed="${draft.assignments[chore.id] === id}">${label}</button>`).join("")}</div></article>`).join("")}</div>
      <div class="ywc-fairness"><span>你 ${fair.user} 項</span><div><i style="width:${Math.min(100, fair.user / 4 * 100)}%"></i></div><span>TA ${fair.ta} 項</span></div>
      ${button("save-chores", "保存本週分配與完成狀態", "primary", false, 'data-primary-busy="1"')}
      <p class="ywc-note">每週只結算一次。全部分配且雙方差距小於 2 項才算公平；長期不公平會累積不滿並引發真正的爭執。</p>
    </section><section class="ywc-section"><div class="ywc-section-head"><div><span class="ywc-kicker">HOUSE RULES</span><h3>你們談出來的家規</h3></div><span class="ywc-status-chip">${state.rules.length} 條</span></div>
      ${state.rules.length ? `<ol class="ywc-rules">${state.rules.slice().reverse().map((rule) => `<li><span>${icon("check", 16)}</span><p>${esc(rule.text)}<small>${dateFmt(rule.at)}</small></p></li>`).join("")}</ol>` : empty("還沒有家規", "生活摩擦出現後，好好談出一個雙方都能做到的約定。", "list")}
    </section>`;
  }

  function ledgerHtml() {
    const { state, wallet } = S.data;
    const archived = state.status === "movedOut";
    const bills = state.bills.slice().reverse();
    const repayableMeals = state.cooking.filter((meal) => !meal.burned && !meal.debtRepaidAt);
    return `<section class="ywc-section"><div class="ywc-section-head"><div><span class="ywc-kicker">HOUSEHOLD LEDGER</span><h3>每一筆都算得清楚</h3></div><span class="ywc-status-chip">免費虹幣</span></div>
      <div class="ywc-ledger-cards"><div><small>你的錢包</small><b>${fmt(wallet.user)}</b></div><div><small>TA 的錢包</small><b>${fmt(wallet.ta)}</b></div><div class="warm"><small>共同帳戶</small><b>${fmt(wallet.joint)}</b></div></div>
      ${!archived ? `<div class="ywc-form-grid"><label class="ywc-field"><span>日常分攤方式</span><select id="ywcSplitMode">${Object.entries(SPLIT_NAMES).map(([id, name]) => `<option value="${id}" ${state.splitMode === id ? "selected" : ""}>${name}</option>`).join("")}</select></label><label class="ywc-field"><span>共同儲蓄目標（虹幣）</span><input id="ywcSavingsTarget" type="number" inputmode="numeric" min="0" max="10000000" step="100" value="${state.savingsGoal.target}"></label></div>
      ${button("save-settings", "保存分攤與儲蓄目標", "secondary", false, 'data-primary-busy="1"')}<p class="ywc-note">儲蓄目標目前只記錄進度，不會因此解鎖求婚或買房；共同帳戶也不能使用付費虹幣。</p>
      <div class="ywc-inline-form"><label class="ywc-field"><span>存入共同帳戶</span><input id="ywcDeposit" type="number" inputmode="numeric" min="1" max="1000000" step="1" placeholder="輸入金額"></label>${button("deposit", "從我的免費錢包存入", "primary", false, 'data-primary-busy="1"')}</div>` : `<div class="ywc-archive-note">${icon("box", 18)} 同住已結束，帳本為唯讀；待繳帳單仍可按原分攤方式結清。</div>`}
    </section>
    <section class="ywc-section"><div class="ywc-section-head"><div><span class="ywc-kicker">MONTHLY BILLS</span><h3>每月家庭帳單</h3></div><span class="ywc-status-chip">${bills.filter((b) => b.status !== "paid").length} 待繳</span></div>
      ${bills.length ? `<div class="ywc-bills">${bills.map((bill) => `<article class="ywc-bill ${bill.status === "paid" ? "paid" : "due"}"><div class="ywc-bill-head"><div><small>${esc(bill.month)}</small><h4>${bill.status === "paid" ? "已結清" : "待繳"}</h4></div><b>${fmt(bill.total)} <small>虹幣</small></b></div><div class="ywc-bill-items">${bill.items.map((item) => `<span>${esc(item.label)}<b>${fmt(item.amount)}</b></span>`).join("")}</div>${bill.status === "paid" ? `<p>你 ${fmt(bill.userPaid)}・TA ${fmt(bill.taPaid)}・共同帳戶 ${fmt(bill.jointUsed)}${bill.taAdvance ? `・TA 代墊 ${fmt(bill.taAdvance)}` : ""}</p>` : `<p>目前還差 ${fmt(bill.outstanding)}；不會因為暫時付不出就被趕出家門。</p>${button(`pay-bill:${esc(bill.month)}`, `結清 ${esc(bill.month)} 帳單`, "warm", false, 'data-primary-busy="1"')}`}</article>`).join("")}</div>` : empty("還沒有月帳單", "簽約後按月產生；預付租金期間不會重複收租。", "wallet")}
    </section>
    <section class="ywc-section"><div class="ywc-section-head"><div><span class="ywc-kicker">SMALL DEBTS</span><h3>代墊小本子</h3></div><span class="ywc-status-chip">雙向記錄</span></div>
      <div class="ywc-debt-grid"><div><small>你欠 TA</small><b>${fmt(state.debt)}</b></div><div><small>TA 欠你</small><b>${fmt(state.taDebt)}</b></div></div>
      ${state.debt > 0 && !archived ? `<div class="ywc-repay"><h4>用現金還款</h4><div class="ywc-inline-form"><label class="ywc-field"><span>償還金額</span><input id="ywcRepayCash" type="number" inputmode="numeric" min="1" max="${state.debt}" step="1" value="${Math.min(100, state.debt)}"></label>${button("repay-cash", "還給 TA", "primary", false, 'data-primary-busy="1"')}</div>
        <h4>或用一頓真正完成的晚餐</h4>${repayableMeals.length ? `<div class="ywc-inline-form"><label class="ywc-field"><span>選擇未燒焦、尚未抵債的晚餐</span><select id="ywcRepayMeal">${repayableMeals.map((meal) => `<option value="${esc(meal.id)}">${esc(meal.recipeName)}・${meal.score} 分・可抵 ${fmt(Math.max(100, Math.round(meal.score * 5)))}</option>`).join("")}</select></label>${button("repay-dinner", "用這頓晚餐抵債", "warm", false, 'data-primary-busy="1"')}</div>` : `<p class="ywc-note">目前沒有可抵債的晚餐。先去廚房完成一頓沒有燒焦的飯；同一頓只能抵一次。</p>`}</div>` : `<p class="ywc-note">${archived ? "搬出後不再新增還款操作，歷史金額保留。" : "目前沒有你欠 TA 的款項。TA 代墊時會按實際支付差額記錄，不會憑空產生欠款。"}</p>`}
    </section>`;
  }

  function cookHtml() {
    const { state, recipes } = S.data;
    const cook = S.cook;
    const recipe = recipes.find((item) => item.id === cook.recipeId) || recipes[0];
    const required = recipe.cuts;
    const offset = cook.flipOffsetMs;
    return `<section class="ywc-section"><div class="ywc-section-head"><div><span class="ywc-kicker">OUR KITCHEN</span><h3>今天在家吃</h3></div><span class="ywc-status-chip">點擊・鍵盤皆可</span></div>
      <div class="ywc-recipe-grid">${recipes.map((item, index) => `<button type="button" class="ywc-recipe ${item.id === recipe.id ? "on" : ""}" data-act="recipe" data-recipe="${item.id}" aria-pressed="${item.id === recipe.id}"><small>RECIPE 0${index + 1}</small><b>${esc(item.name)}</b><p>${esc(item.note)}</p><span>至少 ${item.cuts} 刀</span></button>`).join("")}</div>
      <div class="ywc-cook-steps"><article><div class="ywc-cook-step-head"><span>01</span><div><h4>備料</h4><p>每點一次就是一刀切下，也可以用 Tab 與空白鍵。</p></div></div><div class="ywc-cut-board" aria-label="切菜進度">${Array.from({ length: required + 3 }, (_, index) => `<i class="${index < cook.cuts ? "cut" : ""}"></i>`).join("")}</div><div class="ywc-cook-control"><span>已切 <b>${cook.cuts}</b> 刀・需要 ${required} 刀${cook.cuts > required ? "・更細心，最多多加 3 刀" : ""}</span>${button("cut", "切一刀", "secondary", cook.cuts >= required + 3)}</div></article>
      <article><div class="ywc-cook-step-head"><span>02</span><div><h4>翻鍋</h4><p>開始後約 0.72 秒翻鍋最接近火候；±150ms 內不會燒焦。</p></div></div><div class="ywc-heat ${offset != null ? offset > 150 ? "hot" : "good" : ""}"><span>${offset == null ? "等待翻鍋" : `${offset}ms`}</span><small>${offset == null ? "按下開始，再按一次翻鍋" : offset > 150 ? "會有一點焦，但仍會一起吃完" : "火候正好"}</small></div><div class="ywc-cook-control">${button("flip", cook.flipStartedAt ? "現在翻鍋！" : offset == null ? "開始計時" : "再試一次", "warm")}<label class="ywc-range-label" for="ywcFlipRange">觸控／鍵盤輔助</label><input id="ywcFlipRange" type="range" min="0" max="600" step="10" value="${offset ?? 720}" aria-label="翻鍋誤差毫秒數"><output id="ywcFlipValue" for="ywcFlipRange">${offset ?? 720}ms</output></div></article>
      <article><div class="ywc-cook-step-head"><span>03</span><div><h4>擺盤</h4><p>最後一步，選一個今天餐桌的樣子。</p></div></div><div class="ywc-plating" role="group" aria-label="擺盤方式">${[["warm", "溫暖家常"], ["neat", "整齊清爽"], ["playful", "玩心一點"]].map(([id, label]) => `<button type="button" data-act="plating" data-value="${id}" class="${cook.plating === id ? "on" : ""}" aria-pressed="${cook.plating === id}">${label}</button>`).join("")}</div></article></div>
      ${button("cook", `完成${recipe.name}`, "primary", cook.cuts < required || offset == null, 'data-primary-busy="1"')}
      ${S.lastCook ? `<div class="ywc-cook-result ${S.lastCook.burned ? "burned" : ""}" role="status"><span>${icon("cook", 27)}</span><div><small>剛出爐・${S.lastCook.score} 分</small><h3>${esc(S.lastCook.title)}</h3><p>${esc(S.lastCook.reply)}</p></div></div>` : ""}
    </section><section class="ywc-section"><div class="ywc-section-head"><div><span class="ywc-kicker">HOME MENU</span><h3>你們一起吃過的飯</h3></div><span class="ywc-status-chip">${state.cooking.length} 頓</span></div>${state.cooking.length ? `<div class="ywc-history meals">${state.cooking.slice().reverse().slice(0, 12).map((meal) => `<article><time>${dateFmt(meal.at, true)}</time><h4>${esc(meal.recipeName)}・${meal.score} 分${meal.debtRepaidAt ? "・已抵債" : ""}</h4><p>${meal.burned ? "有一點焦，還是一起吃完了。" : "已放進你們的家常菜單。"}${meal.debtAmount ? ` 抵掉 ${fmt(meal.debtAmount)} 虹幣代墊。` : ""}</p></article>`).join("")}</div>` : empty("家常菜單還空著", "選一份食譜，從第一刀開始。", "cook")}</section>`;
  }

  function careHtml() {
    const { state, character, careNeeded } = S.data;
    const labels = { porridge: ["煮一鍋粥", "把熱氣與時間慢慢熬進去"], medicine: ["準備藥與溫水", "只記錄陪伴與照顧，不假裝病情立刻痊癒"], stay: ["留下陪伴", "不趕時間，在旁邊坐一會兒"] };
    return `<section class="ywc-section"><div class="ywc-section-head"><div><span class="ywc-kicker">CARE / NOT A CURE</span><h3>不舒服的時候，有人在</h3></div>${careNeeded ? `<span class="ywc-status-chip warm">你可能需要休息</span>` : ""}</div>
      <div class="ywc-care-who" role="group" aria-label="誰需要照顧"><button type="button" data-act="care-who" data-value="ta" class="${S.care.who === "ta" ? "on" : ""}" aria-pressed="${S.care.who === "ta"}">照顧 ${esc(character.name)}</button><button type="button" data-act="care-who" data-value="user" class="${S.care.who === "user" ? "on" : ""}" aria-pressed="${S.care.who === "user"}">讓 TA 照顧我</button></div>
      <div class="ywc-care-actions">${Object.entries(labels).map(([id, [title, desc]]) => `<button type="button" data-act="care-action" data-value="${id}" class="${S.care.action === id ? "on" : ""}" aria-pressed="${S.care.action === id}"><span>${icon("heart", 20)}</span><b>${title}</b><p>${desc}</p></button>`).join("")}</div>
      <label class="ywc-field"><span>留一句話（選填）</span><textarea id="ywcCareNote" maxlength="160" rows="3" placeholder="今天先休息，我在這裡。"></textarea></label>
      ${button("care", S.care.who === "ta" ? `把這份照顧交給 ${character.name}` : "告訴 TA 我今天不舒服", "primary", false, 'data-primary-busy="1"')}
      <p class="ywc-note">照顧 TA 時會追加寫入 TA 當天的既有日記，不覆蓋原文；這不是醫療診斷或服藥確認。</p>
    </section><section class="ywc-section"><div class="ywc-section-head"><div><span class="ywc-kicker">CARE NOTES</span><h3>被記住的照顧</h3></div><span class="ywc-status-chip">${state.care.length} 則</span></div>${state.care.length ? `<div class="ywc-history">${state.care.slice().reverse().slice(0, 12).map((care) => `<article><time>${dateFmt(care.at, true)}</time><h4>${care.who === "ta" ? `照顧 ${esc(character.name)}` : "讓 TA 照顧你"}・${esc(care.actionLabel)}</h4><p>${esc(care.note || "沒有多說什麼，陪伴已經被記住。")}${care.diaryDate ? " 已追加進當天日記。" : ""}</p></article>`).join("")}</div>` : empty("還沒有照護紀錄", "需要時，從一鍋粥或一句陪伴開始。", "heart")}</section>`;
  }

  function contentHtml() {
    if (S.loading && !S.data) return `<div class="ywc-loading" role="status"><span class="ywc-loader-house">${icon("home", 34)}</span><b>正在接通你們的生活訊號</b><p>讀取關係、免費錢包與住家紀錄…</p></div>`;
    if (!S.data) return empty("暫時接不上同住訊號", S.error || "請重新讀取", "alert") + button("refresh", "重新讀取", "primary");
    return `${statusHero()}${S.busy ? `<div class="ywc-busy" role="status"><span class="ywc-spinner"></span>${esc(S.busy)}處理中，請勿重複點擊</div>` : ""}${noticeHtml()}<div class="ywc-workspace">${tabHtml()}<main id="ywc-panel" class="ywc-content" role="tabpanel" aria-labelledby="ywc-tab-${S.tab}">${S.tab === "life" ? lifeHtml() : S.tab === "chores" ? choresHtml() : S.tab === "ledger" ? ledgerHtml() : S.tab === "cook" ? cookHtml() : S.tab === "care" ? careHtml() : homeHtml()}</main></div>`;
  }

  function render() {
    const root = ensureRoot();
    document.body.classList.toggle("ywc-open", S.open);
    if (!S.open) { root.innerHTML = ""; return; }
    const active = document.activeElement;
    const focusKey = active?.dataset?.focus || (active?.id && root.contains(active) ? active.id : "");
    const character = S.data?.character;
    root.innerHTML = `<div class="ywc-backdrop" data-ywc-backdrop><section class="ywc-dialog" role="dialog" aria-modal="true" aria-labelledby="ywcTitle"><header class="ywc-header"><div class="ywc-brand"><span class="ywc-brand-mark">${icon("home", 22)}<i></i></span><div><span>COHABIT / B14</span><h1 id="ywcTitle">同住生活${character ? `<small>與 ${esc(character.name)}</small>` : ""}</h1></div></div><div class="ywc-header-right"><span class="ywc-connection"><i></i>${S.data?.state.status === "active" ? "HOME ONLINE" : "RAINY SIGNAL"}</span><button type="button" class="ywc-close" data-act="close" data-focus="close" aria-label="關閉同住生活">${icon("close", 22)}</button></div></header><div class="ywc-scroll">${contentHtml()}</div><footer class="ywc-footer"><span>WARMTH / 雨夜玻璃・餘溫訊號</span><span>資料保存在既有角色與城市存檔</span></footer></section></div>`;
    if (focusKey) {
      const next = active?.id === focusKey ? $(`#${CSS.escape(focusKey)}`, root) : $(`[data-focus="${CSS.escape(focusKey)}"]`, root);
      next?.focus({ preventScroll: true });
    }
  }

  async function handleAction(buttonEl) {
    const action = buttonEl.dataset.act;
    if (!action || buttonEl.disabled) return;
    if (action === "close") return close();
    if (action === "refresh") return refresh();
    if (action === "ask-move-out") { S.confirmMoveOut = true; render(); return; }
    if (action === "cancel-move-out") { S.confirmMoveOut = false; render(); return; }
    if (action === "go-friction") { S.tab = "chores"; S.error = ""; render(); return; }
    if (action === "go-ledger") { S.tab = "ledger"; S.error = ""; render(); return; }
    if (action === "invite") return perform("/invite", {}, "同住提議", "提議已送達，TA 的回覆也寫進了聊天");
    if (action === "visit" || action === "visit-alt") {
      const body = { homeId: S.houseId };
      if (action === "visit-alt" && S.altAt) body.at = S.altAt;
      const result = await perform("/visit", body, "看房邀約", "看房約會已建立，沒有提前簽約或扣款");
      if (result) { S.altAt = 0; render(); }
      return;
    }
    if (action === "visit-end") return perform("/visit/end", {}, "結束看房", "看房反應已保存，可以決定是否簽約");
    if (action === "sign") {
      const splitMode = $("input[name='ywcSignSplit']:checked", ensureRoot())?.value || S.data.state.splitMode;
      return perform("/sign", { homeId: S.houseId, splitMode, actionId: actionId("ui-sign") }, "簽約與押一付三", "簽約完成；四只箱子已經送到新家");
    }
    if (action.startsWith("open-box:")) {
      const boxId = action.split(":")[1];
      const result = await perform("/move/open", { boxId }, "生成舊物故事", "這只箱子已安放，故事也寫進了聊天");
      if (result?.state?.status === "active") await refresh();
      return result;
    }
    if (action === "event") {
      const result = await perform("/event/choose", { eventId: buttonEl.dataset.event, optionId: buttonEl.dataset.option }, "回應生活小事", "這一刻已經被你們一起度過");
      if (result?.outcome?.minigame === "cooking") S.tab = "cook";
      else if (result?.outcome?.openTab === "chores") S.tab = "chores";
      if (result) render();
      return;
    }
    if (action === "friction") return perform("/friction/choose", { frictionId: buttonEl.dataset.friction, optionId: buttonEl.dataset.option }, "解決生活摩擦", "新的家規已保存，關係變化也寫進了紀錄");
    if (action === "chore-assign") {
      S.choreDraft.assignments[buttonEl.dataset.chore] = buttonEl.dataset.value; S.choreDirty = true; render(); return;
    }
    if (action === "chore-done") {
      const id = buttonEl.dataset.chore;
      S.choreDraft.completed[id] = !S.choreDraft.completed[id]; S.choreDirty = true; render(); return;
    }
    if (action === "save-chores") {
      const result = await perform("/chores", S.choreDraft, "保存家務", "本週家務已保存");
      if (result) { S.choreDirty = false; syncDraft(); render(); }
      return;
    }
    if (action === "save-settings") {
      const splitMode = $("#ywcSplitMode")?.value;
      const savingsTarget = Number($("#ywcSavingsTarget")?.value || 0);
      return perform("/settings", { splitMode, savingsTarget }, "保存家庭設定", "分攤方式與儲蓄目標已保存");
    }
    if (action === "deposit") {
      const amount = Number($("#ywcDeposit")?.value || 0);
      return perform("/joint/deposit", { amount, actionId: actionId("ui-joint") }, "存入共同帳戶", `已存入共同帳戶 ${fmt(amount)} 虹幣`);
    }
    if (action.startsWith("pay-bill:")) {
      const month = action.slice("pay-bill:".length);
      return perform("/bill/pay", { month, actionId: actionId("ui-bill") }, `結清 ${month} 帳單`, `${month} 家庭帳單已結清`);
    }
    if (action === "repay-cash") {
      const amount = Number($("#ywcRepayCash")?.value || 0);
      return perform("/debt/repay", { method: "cash", amount, actionId: actionId("ui-debt-cash") }, "現金還款", `已償還 ${fmt(amount)} 虹幣，TA 的錢包也已入帳`);
    }
    if (action === "repay-dinner") {
      const cookingId = $("#ywcRepayMeal")?.value;
      return perform("/debt/repay", { method: "dinner", cookingId, actionId: actionId("ui-debt-dinner") }, "晚餐抵債", "這頓晚餐已抵債，不能重複使用");
    }
    if (action === "recipe") {
      S.cook = { recipeId: buttonEl.dataset.recipe, cuts: 0, flipOffsetMs: null, flipStartedAt: 0, plating: "warm", actionId: null }; render(); return;
    }
    if (action === "cut") {
      const recipe = S.data.recipes.find((item) => item.id === S.cook.recipeId);
      S.cook.cuts = Math.min(recipe.cuts + 3, S.cook.cuts + 1); render(); return;
    }
    if (action === "flip") {
      if (S.cook.flipStartedAt) {
        S.cook.flipOffsetMs = Math.abs(Math.round(performance.now() - S.cook.flipStartedAt - 720));
        S.cook.flipStartedAt = 0;
      } else { S.cook.flipStartedAt = performance.now(); S.cook.flipOffsetMs = null; }
      render(); return;
    }
    if (action === "plating") { S.cook.plating = buttonEl.dataset.value; render(); return; }
    if (action === "cook") {
      if (!S.cook.actionId) S.cook.actionId = actionId("ui-cook");
      const payload = { recipeId: S.cook.recipeId, cuts: S.cook.cuts, flipOffsetMs: S.cook.flipOffsetMs, plating: S.cook.plating, actionId: S.cook.actionId };
      const result = await perform("/cook", payload, "完成晚餐", "晚餐完成了，兩個人會一起吃完");
      if (result?.outcome) {
        S.lastCook = result.outcome;
        S.cook = { recipeId: S.cook.recipeId, cuts: 0, flipOffsetMs: null, flipStartedAt: 0, plating: S.cook.plating, actionId: null };
        render();
      }
      return;
    }
    if (action === "care-who") { S.care.who = buttonEl.dataset.value; render(); return; }
    if (action === "care-action") { S.care.action = buttonEl.dataset.value; render(); return; }
    if (action === "care") {
      const note = $("#ywcCareNote")?.value || "";
      return perform("/care", { who: S.care.who, action: S.care.action, note, actionId: actionId("ui-care") }, "記錄照護", S.care.who === "ta" ? "照顧已追加進 TA 今天的日記" : "TA 已收到你需要照顧的訊息");
    }
    if (action === "move-out") {
      const result = await perform("/move-out", {}, "結束同住", "同住已結束，家具、帳本與回憶都保留");
      if (result) { S.confirmMoveOut = false; S.tab = "home"; render(); }
    }
  }

  function wire() {
    const root = ensureRoot();
    root.addEventListener("click", (event) => {
      if (event.target.hasAttribute("data-ywc-backdrop")) { close(); return; }
      const tab = event.target.closest("[data-tab]");
      if (tab && root.contains(tab) && !tab.disabled) {
        S.tab = tab.dataset.tab; S.error = ""; S.notice = ""; S.confirmMoveOut = false; render(); return;
      }
      const house = event.target.closest("[data-house]");
      if (house && root.contains(house) && ["proposed", "viewing"].includes(S.data?.state.status)) {
        S.houseId = house.dataset.house; S.error = ""; S.altAt = 0; render(); return;
      }
      const action = event.target.closest("[data-act]");
      if (action && root.contains(action)) { event.preventDefault(); void handleAction(action); }
    });
    root.addEventListener("input", (event) => {
      if (event.target.id === "ywcFlipRange") {
        const output = $("#ywcFlipValue", root); if (output) output.value = `${event.target.value}ms`;
      }
    });
    root.addEventListener("change", (event) => {
      if (event.target.id === "ywcFlipRange") {
        S.cook.flipOffsetMs = Math.abs(Number(event.target.value)); S.cook.flipStartedAt = 0; render();
      }
    });
    root.addEventListener("keydown", (event) => {
      const tab = event.target.closest("[role='tab']");
      if (tab && ["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        const tabs = $$("[role='tab']:not(:disabled)", root);
        let index = tabs.indexOf(tab);
        index = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
        S.tab = tabs[index].dataset.tab; render();
        $(`[data-tab="${S.tab}"]`, root)?.focus();
      }
    });
  }

  document.addEventListener("keydown", (event) => {
    if (!S.open) return;
    if (event.key === "Escape") { event.preventDefault(); close(); return; }
    if (event.key !== "Tab") return;
    const root = ensureRoot();
    const focusable = $$("button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex]:not([tabindex='-1'])", root).filter((el) => el.getClientRects().length && getComputedStyle(el).visibility !== "hidden");
    if (!focusable.length) return;
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });

  function ensureChatButton() {
    const convId = currentChatId();
    if (!convId) return;
    const composer = $(".composer.glass") || $(".composer");
    if (!composer || $(".ywc-chat-btn", composer)) return;
    const buttonEl = document.createElement("button");
    buttonEl.type = "button"; buttonEl.className = "ywc-chat-btn";
    buttonEl.setAttribute("aria-label", "同住生活"); buttonEl.title = "同住生活・看房、家務、帳本與日常";
    buttonEl.innerHTML = icon("home", 21);
    buttonEl.addEventListener("click", () => void openChat());
    const plus = $(".cbtn.plus", composer);
    composer.insertBefore(buttonEl, plus || composer.firstChild);
  }

  globalThis.__ywCohab = {
    get open() { return S.open; }, get busy() { return S.busy; }, get tab() { return S.tab; },
    get characterId() { return S.charId; }, get snapshot() { return S.data; },
    openForCharacter: (id) => openForCharacter(id), close,
  };

  wire();
  let queued = false;
  const observer = new MutationObserver(() => {
    if (queued) return; queued = true;
    setTimeout(() => { queued = false; ensureChatButton(); }, 180);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  addEventListener("hashchange", () => { if (S.open && currentChatId() !== S.convId) close(); setTimeout(ensureChatButton, 180); });
  document.addEventListener("DOMContentLoaded", () => setTimeout(ensureChatButton, 350), { once: true });
  setTimeout(ensureChatButton, 600);
})();
