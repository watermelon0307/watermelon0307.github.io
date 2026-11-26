/* ============================================================
   新霓市・自由行動 RPG 層 (NEON TERMINAL)
   ------------------------------------------------------------
   原則：
   ・所有會改變遊戲狀態的操作，一律走 App 真實 API
     （/api/world・/api/neon/*），不造假狀態。
   ・只有「冒險日誌」的目標進度記錄在本機 localStorage。
   ・行動力（AP）由玩家自己開關，不偷偷改設定。
   ============================================================ */
(() => {
  "use strict";

  const LS_KEY = "yw_neon_rpg_v1";

  /* ---------- 小工具 ---------- */

  const norm = (s) =>
    String(s ?? "")
      .toLowerCase()
      .replace(/[\s　，。！？!?,、~～…·・'"「」『』【】[\]()（）:：;；\-—]/g, "");

  const esc = (s) =>
    String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  async function apiGet(path) {
    const r = await fetch(path);
    if (!r.ok) throw new Error("GET " + path + " → " + r.status);
    return r.json();
  }

  async function apiSend(method, path, body) {
    const r = await fetch(path, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
    let j = null;
    try { j = await r.json(); } catch { /* 空回應 */ }
    return { httpOk: r.ok, status: r.status, body: j };
  }

  const apiPost = (p, b) => apiSend("POST", p, b);
  const apiPut = (p, b) => apiSend("PUT", p, b);

  /* ---------- 本機冒險日誌狀態 ---------- */

  const blankLocal = () => ({ v: 1, visited: [], dayKey: null, daily: {}, mile: {}, log: [] });
  let L = blankLocal();
  try {
    const raw = JSON.parse(localStorage.getItem(LS_KEY) || "null");
    if (raw && raw.v === 1) L = { ...blankLocal(), ...raw };
  } catch { /* 壞掉就重來 */ }

  function saveLocal() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(L)); } catch { /* 容量滿就放棄 */ }
  }

  /* ---------- 關鍵字 → 地點（只負責指路，驗證仍在伺服器端） ---------- */

  const PLACE_KW = {
    "neon-ave": ["霓虹大道", "大道"],
    "central-station": ["車站", "中央車站"],
    "skyline-mall": ["百貨", "星耀", "逛街"],
    "cloud-deck": ["觀景台", "夜景", "雲頂"],
    "star-cinema": ["電影", "影城", "看片"],
    "night-mart": ["便利店", "便利商店", "超商", "二十四時", "買便當", "口罩", "雨傘"],
    "quantum-cafe": ["咖啡", "cafe", "咖啡店"],
    "city-hall": ["市政", "市政大樓"],
    "lantern-market": ["夜市", "燈籠", "小吃"],
    "noodle-house": ["麵館", "吃麵", "老街麵館"],
    "echo-records": ["唱片", "黑膠", "回聲"],
    "repair-shop": ["修理", "維修", "修理鋪"],
    "alley-tea": ["茶室", "喝茶", "巷口茶"],
    "book-stall": ["書攤", "舊書", "買書"],
    "jazz-cellar": ["爵士", "酒館", "jazz"],
    "neo-univ": ["大學", "旁聽", "上課", "新霓大學"],
    "library": ["圖書館", "看書", "讀書"],
    "lab": ["實驗室"],
    "canteen": ["學餐", "學生餐廳"],
    "clock-tower": ["鐘塔"],
    "rooftop-astro": ["天文", "觀星", "屋頂天文"],
    "star-pier": ["星港", "看船", "碼頭邊"],
    "container-market": ["貨櫃"],
    "harbor-tower": ["港灣辦公", "辦公大樓"],
    "ferry": ["渡輪"],
    "lighthouse-diner": ["燈塔餐廳", "燈塔"],
    "cyber-clinic": ["義體", "診所"],
    "night-warehouse": ["倉庫", "夜班倉庫"],
    "green-park": ["公園", "綠帶"],
    "greenhouse": ["溫室", "花房", "植物"],
    "jog-trail": ["晨跑", "跑步", "跑道"],
    "pet-park": ["寵物", "遛狗", "狗狗"],
    "lake-camp": ["露營", "湖畔"],
    "firefly-vale": ["螢火蟲"],
    "seawall-walk": ["海堤"],
    "beach": ["沙灘", "海邊"],
    "surf-hut": ["衝浪"],
    "seafood-stall": ["海鮮", "大排檔"],
    "fisher-wharf": ["漁人碼頭", "漁港"],
    "meteor-point": ["流星"],
    "old-flat": ["回家", "住處", "出租屋", "老社區"],
    "central-plaza": ["廣場", "中央廣場", "街頭表演"],
    "flea-market": ["舊貨", "跳蚤", "二手"],
    "izakaya": ["居酒屋"],
    "seaside-shop": ["濱海", "明信片", "海邊小店"],
  };

  /* 有短工的地點（供「打工」指令列出選項） */
  const GIG_PLACES = [
    "night-mart", "central-plaza", "lantern-market", "noodle-house", "library",
    "star-pier", "container-market", "ferry", "pet-park", "seafood-stall",
  ];

  const HOME_WORDS = ["回家", "住處", "家裡", "家"];

  /* ---------- 冒險日誌定義 ---------- */

  const DAILY_DEFS = [
    { id: "explore", name: "城市探索", desc: "去一個還沒去過的地點" },
    { id: "gig", name: "打工換虹幣", desc: "完成一份短工" },
    { id: "bond", name: "城市羈絆", desc: "回應一次偶遇，或和 TA 一起出門" },
  ];

  const MILE_DEFS = [
    { id: "m10", name: "熟門熟路", desc: "累計走訪 10 個地點", target: 10 },
    { id: "meet5", name: "街坊都認識你", desc: "認識 5 位城市居民", target: 5 },
    { id: "rich", name: "小小富翁", desc: "資產累積到 4,000,000 虹幣", target: 8000, unit: "元" },
  ];

  /* ---------- 執行期狀態 ---------- */

  const S = {
    world: null,
    me: null,
    rules: null,
    placeCache: new Map(),
    busy: false,
    root: null,        // 目前掛載的 console DOM
    apArmed: false,    // 行動力開關的二次確認
    focus: null,       // 進行中的專注小遊戲
  };

  /* ---------- 數值變化顯示 ---------- */

  const DELTA_LABELS = {
    energy: "體力", mood: "心情", hunger: "飽足", health: "健康",
    stress: "壓力", reputation: "聲譽", skin: "膚質", humanity: "人性",
  };

  function deltaHtml(delta) {
    if (!delta || typeof delta !== "object") return "";
    const parts = [];
    for (const [k, label] of Object.entries(DELTA_LABELS)) {
      const v = Math.round(Number(delta[k]) || 0);
      if (!v) continue;
      const cls = k === "stress" ? (v > 0 ? "down" : "up") : (v > 0 ? "up" : "down");
      parts.push(`${label} <b class="${cls}">${v > 0 ? "+" : ""}${v}</b>`);
    }
    return parts.length ? `<span class="nrpg-delta">${parts.join("・")}</span>` : "";
  }

  /* ---------- 訊息紀錄 ---------- */
  /* 紀錄會存進 localStorage，重整或頁面重掛後還在。 */

  function pushLog(tag, html, cls = "ok") {
    L.log.push({ tag, html, cls });
    if (L.log.length > 40) L.log = L.log.slice(-40);
    saveLocal();
    renderLog();
  }

  function renderLog() {
    const box = S.root?.querySelector("[data-log]");
    if (!box) return;
    box.innerHTML = L.log
      .map((e) => `<div class="nrpg-line nrpg-${e.cls}"><span class="nrpg-tag">${esc(e.tag)}</span>${e.html}</div>`)
      .join("");
    box.scrollTop = box.scrollHeight;
  }

  /* ---------- 狀態列 ---------- */

  function chip(label, value, extraCls = "") {
    return `<span class="nrpg-chip ${extraCls}"><small>${esc(label)}</small>${esc(value)}</span>`;
  }

  function renderStatus() {
    const box = S.root?.querySelector("[data-status]");
    if (!box) return;
    const w = S.world, m = S.me;
    if (!w || !m) { box.innerHTML = ""; return; }

    const chips = [];
    chips.push(chip("時間", `第${w.time.day}天 ${w.time.time}・${w.time.band.name}`));
    if (m.weather) chips.push(chip("天氣", `${m.weather.name}・${m.weather.seasonName}`));
    const st = m.stats ?? {};
    chips.push(chip("體力", st.energy ?? "—", st.energy <= 25 ? "is-low" : ""));
    chips.push(chip("心情", st.mood ?? "—", st.mood <= 25 ? "is-low" : ""));
    chips.push(chip("飽足", st.hunger ?? "—", st.hunger <= 25 ? "is-low" : ""));
    if (m.player?.health != null) chips.push(chip("健康", m.player.health, m.player.health <= 30 ? "is-low" : ""));
    if (m.money?.text) chips.push(chip("資產", m.money.text, "is-key"));
    if (w.ap?.on) chips.push(chip("行動力", `${w.ap.left}/${w.ap.perDay}`, w.ap.left <= 2 ? "is-low" : ""));
    box.innerHTML = chips.join("");
  }

  function renderApButton() {
    const btn = S.root?.querySelector("[data-ap]");
    if (!btn) return;
    const ap = S.world?.ap;
    if (!ap) { btn.hidden = true; return; }
    btn.hidden = false;
    btn.classList.toggle("is-on", !!ap.on);
    btn.classList.toggle("is-armed", S.apArmed);
    if (S.apArmed) {
      btn.innerHTML = `<i></i>${ap.on ? "再按一次關閉" : "再按一次開啟"}`;
    } else {
      btn.innerHTML = ap.on
        ? `<i></i>行動力 ${ap.left}/${ap.perDay}`
        : `<i></i>行動力・關`;
    }
    btn.title = ap.on
      ? "每日行動力開啟中：去一個地點消耗 1 點。點一下可關閉"
      : "企劃書玩法：每天 10 點行動力，去一個地點消耗 1 點。點一下開啟";
  }

  /* ---------- 冒險日誌 ---------- */

  function questProgress(def) {
    if (def.id === "m10") return Math.min(L.visited.length, def.target);
    if (def.id === "meet5") return Math.min((S.world?.npcs ?? []).filter((n) => n.met).length, def.target);
    if (def.id === "rich") return Math.min(S.me?.money?.yuan ?? 0, def.target);
    return 0;
  }

  function renderQuests() {
    const list = S.root?.querySelector("[data-quests]");
    if (!list) return;

    const dayKey = S.world?.time?.day != null ? "day-" + S.world.time.day : null;
    const li = [];

    li.push(`<li class="nq-head" style="color:var(--nr-dim);font-size:10.5px;letter-spacing:.14em;">今日目標${dayKey ? "・第 " + S.world.time.day + " 天" : ""}</li>`);
    for (const d of DAILY_DEFS) {
      const done = !!L.daily[d.id];
      li.push(
        `<li class="${done ? "is-done" : ""}"><span class="nq-box">${done ? "✓" : ""}</span>` +
        `<span class="nq-name">${esc(d.name)}</span><span class="nq-desc">${esc(d.desc)}</span></li>`
      );
    }

    li.push(`<li class="nq-head nrpg-qsec">長期目標</li>`);
    for (const d of MILE_DEFS) {
      const p = questProgress(d);
      const done = p >= d.target;
      li.push(
        `<li class="${done ? "is-done" : ""}"><span class="nq-box">${done ? "✓" : ""}</span>` +
        `<span class="nq-name">${esc(d.name)}</span><span class="nq-desc">${esc(d.desc)}</span>` +
        `<span class="nq-prog">${p}/${d.target}${d.unit ?? ""}</span></li>`
      );
    }
    list.innerHTML = li.join("");
  }

  function markDaily(id) {
    if (L.daily[id]) return;
    L.daily[id] = true;
    saveLocal();
    const def = DAILY_DEFS.find((d) => d.id === id);
    if (def) pushLog("日誌", `完成今日目標「${esc(def.name)}」。`, "story");
    renderQuests();
  }

  function noteVisited(placeId) {
    if (!placeId) return;
    if (!L.visited.includes(placeId)) {
      L.visited.push(placeId);
      saveLocal();
      markDaily("explore");
    }
  }

  /* ---------- 偶遇 ---------- */

  function encounterNpc(enc) {
    return (S.world?.npcs ?? []).find((n) => n.id === enc.npcId) ?? null;
  }

  function renderEncounter() {
    const box = S.root?.querySelector("[data-enc]");
    if (!box) return;
    const enc = S.world?.pending;
    if (!enc || !enc.scene) { box.hidden = true; box.innerHTML = ""; return; }

    const npc = encounterNpc(enc);
    const place = (S.world?.places ?? []).find((p) => p.id === enc.placeId);
    const opts = (enc.scene.options ?? [])
      .map((o, i) => `<button type="button" data-enc-opt="${i}">${esc(o.text)}</button>`)
      .join("");
    box.innerHTML =
      `<div class="nrpg-enc-head">ENCOUNTER // 偶遇</div>` +
      `<p>${esc(enc.scene.scene || enc.line || "")}${npc ? `——<b>${esc(npc.name)}</b>${npc.job ? `（${esc(npc.job)}）` : ""}` : ""}` +
      `${place ? ` @ ${esc(place.name)}` : ""}</p>` +
      `<div class="nrpg-enc-opts">${opts}</div>`;
    box.hidden = false;
  }

  /* ---------- 資料刷新 ---------- */

  async function refresh() {
    const [w, m] = await Promise.all([
      apiGet("/api/world").catch(() => null),
      apiGet("/api/neon/me").catch(() => null),
    ]);
    S.world = w;
    S.me = m;

    // 換天了 → 重置今日目標
    const dayKey = w?.time?.day != null ? "day-" + w.time.day : null;
    if (dayKey && L.dayKey !== dayKey) {
      L.dayKey = dayKey;
      L.daily = {};
      saveLocal();
    }

    renderStatus();
    renderApButton();
    renderQuests();
    renderEncounter();
  }

  async function getPlace(id) {
    if (!S.placeCache.has(id)) {
      S.placeCache.set(id, await apiGet("/api/neon/place/" + encodeURIComponent(id)));
    }
    return S.placeCache.get(id);
  }

  /* 讓外層 React 介面重新讀取城市狀態（時鐘、狀態卡、地圖標記） */
  function syncAppUi() {
    const back = location.hash && location.hash.length > 1 ? location.hash : "#/city";
    location.hash = "#/me";
    setTimeout(() => {
      location.hash = back;
      // 等城市頁重掛完成後，把控制台滾回眼前
      let tries = 0;
      const t = setInterval(() => {
        const el = document.querySelector(".nrpg");
        if (el) { el.scrollIntoView({ block: "start", behavior: "auto" }); clearInterval(t); }
        else if (++tries > 12) clearInterval(t);
      }, 250);
    }, 80);
  }

  /* ---------- 指令解析 ---------- */

  function resolvePlace(text) {
    const places = S.world?.places ?? [];
    const hits = [];
    for (const p of places) {
      const n = norm(p.name);
      if (n && text.includes(n)) hits.push({ p, score: n.length + 100 });
    }
    for (const [pid, kws] of Object.entries(PLACE_KW)) {
      const p = places.find((x) => x.id === pid);
      if (!p) continue;
      for (const k of kws) {
        const nk = norm(k);
        if (nk && text.includes(nk)) hits.push({ p, score: nk.length });
      }
    }
    if (!hits.length && HOME_WORDS.some((w) => text.includes(norm(w)))) {
      const homeId = S.me?.home?.placeId;
      const home = places.find((x) => x.id === homeId);
      if (home) return home;
    }
    hits.sort((a, b) => b.score - a.score);
    return hits[0]?.p ?? null;
  }

  function resolveCompanion(text) {
    for (const c of S.world?.characters ?? []) {
      const n = norm(c.name);
      if (n && n.length >= 2 && text.includes(n)) return c;
    }
    return null;
  }

  function resolveAction(text, detail) {
    let best = null;
    for (const a of detail?.actions ?? []) {
      const n = norm(a.label);
      if (n && text.includes(n) && (!best || n.length > norm(best.label).length)) best = a;
    }
    return best;
  }

  function placeActionButtons(detail) {
    const placeId = detail.placeId ?? detail.id;
    const acts = (detail.actions ?? [])
      .map((a) => {
        const dis = a.blocked ? "disabled" : "";
        const tip = a.blocked && a.blockedText ? ` title="${esc(a.blockedText)}"` : "";
        const price = a.priceYuan ? `（${a.priceYuan} 元）` : "";
        return `<button type="button" data-do="act" data-place="${esc(placeId)}" data-act="${esc(a.id)}" ${dis}${tip}>${esc(a.label)}${price}</button>`;
      })
      .join("");
    const gigs = (detail.gigs ?? [])
      .map((g) => {
        const dis = g.blocked ? "disabled" : "";
        return `<button type="button" class="is-gig" data-do="gigpick" data-place="${esc(placeId)}" data-gig="${esc(g.id)}" ${dis}>${esc(g.label)}（短工）</button>`;
      })
      .join("");
    if (!acts && !gigs) return "";
    return `<div class="nrpg-acts">${acts}${gigs}</div>`;
  }

  /* ---------- 指令主入口 ---------- */

  /* 忙碌保護 + 錯誤捕捉的共用包裝 */
  async function task(fn) {
    if (S.busy) return;
    S.busy = true;
    S.root?.classList.add("is-busy");
    try {
      await fn();
    } catch (e) {
      pushLog("系統", "執行失敗：" + esc(e?.message ?? e), "err");
    } finally {
      S.busy = false;
      S.root?.classList.remove("is-busy");
    }
  }

  async function runCommand(raw) {
    const input = String(raw ?? "").trim();
    if (!input || S.busy) return;
    pushLog("你", esc(input), "you");
    await task(() => dispatch(norm(input), input));
    const inp = S.root?.querySelector("[data-input]");
    if (inp) { inp.value = ""; inp.focus({ preventScroll: true }); }
  }

  async function dispatch(text, raw) {
    // 幫助
    if (/^(幫助|指令|說明|help|\?|？)$/.test(text)) return cmdHelp();
    // 狀態
    if (/^(狀態|屬性|我的狀態|狀態列)$/.test(text)) return cmdStatus();
    // 帳本
    if (/^(帳本|記帳|收支|錢包|資產|ledger)$/.test(text)) return cmdLedger();
    // 行動力開關說明
    if (/^行動力$/.test(text)) return cmdApInfo();
    if (/^(開啟|打開)行動力$/.test(text)) return setAp(true);
    if (/^關閉行動力$/.test(text)) return setAp(false);
    // 回應偶遇
    if (S.world?.pending && /(回應|偶遇|居民)/.test(text)) {
      return pushLog("系統", "上面的偶遇卡片可以直接選一個回覆。", "ok");
    }
    // 睡覺 / 明天
    if (/(跳到明天|睡到明天|新的一天|下一天|直接明天)/.test(text)) return doNextDay();
    if (/睡/.test(text) || /晚安/.test(text)) return doSleep(parseAlarm(raw));
    // 淋浴、泡麵等住處行動
    const homeAct = matchHomeAct(text);
    if (homeAct) return doHomeAct(homeAct);
    // 打工
    if (/(打工|兼職|短工|上班|賺錢)/.test(text)) return cmdGig(text);
    // 找地點
    const place = resolvePlace(text);
    if (place) return cmdVisitAct(place, text);
    // 不知道
    return cmdUnknown(text);
  }

  function parseAlarm(raw) {
    const m = String(raw).match(/(\d{1,2})\s*[:：點]\s*(\d{1,2})?\s*(半)?/);
    if (!m) return null;
    const h = Number(m[1]);
    if (!(h >= 0 && h <= 23)) return null;
    const mm = m[2] != null ? Number(m[2]) : (m[3] ? 30 : 0);
    if (!(mm >= 0 && mm <= 59)) return null;
    return h * 60 + mm;
  }

  function matchHomeAct(text) {
    const acts = S.me?.home?.acts ?? [];
    let best = null;
    for (const a of acts) {
      if (a.id === "sleep") continue; // 睡覺走 /api/neon/sleep
      const n = norm(a.label);
      if (n && text.includes(n) && (!best || n.length > norm(best.label).length)) best = a;
    }
    if (!best && /(洗澡|淋浴|沖澡)/.test(text)) best = acts.find((a) => a.id === "bath") ?? null;
    if (!best && /泡麵/.test(text)) best = acts.find((a) => a.id === "noodle") ?? null;
    return best;
  }

  /* ---------- 基本指令 ---------- */

  function cmdHelp() {
    pushLog("系統",
      `自由行動指令範例：<br>` +
      `・<b>去量子咖啡</b>、<b>去海堤步道散步</b>——直接報地點就會出發<br>` +
      `・<b>和顧聞舟去中央廣場</b>——親密度夠的話可以約 TA 同行<br>` +
      `・<b>打工</b> 或 <b>去圖書館打工</b>——賺虹幣，可玩專注小遊戲減少失誤<br>` +
      `・<b>喝咖啡</b>、<b>吃泡麵</b>、<b>淋浴</b>——地點能做的行動<br>` +
      `・<b>睡覺 7:30</b>——睡覺並設鬧鐘；<b>跳到明天</b>——直接進入新的一天<br>` +
      `・<b>狀態</b>、<b>帳本</b>、<b>行動力</b>——查看數值與開關<br>` +
      `行動力開啟時，每天 ${S.world?.ap?.perDay ?? 10} 點，去一個地點消耗 1 點。`,
      "ok");
  }

  function cmdStatus() {
    const m = S.me, w = S.world;
    if (!m || !w) return pushLog("系統", "狀態讀取中，請再試一次。", "warn");
    const st = m.stats ?? {}, pl = m.player ?? {};
    pushLog("狀態",
      `第 ${w.time.day} 天 ${w.time.time}（${esc(w.time.band.name)}）・${esc(m.weather?.name ?? "")} <br>` +
      `體力 ${st.energy}・心情 ${st.mood}・飽足 ${st.hunger} <br>` +
      `健康 ${pl.health}・聲譽 ${pl.reputation}・壓力 ${pl.stress}・人性 ${pl.humanity} <br>` +
      `效率 ${(m.efficiency * 100).toFixed(0)}%・資產 ${esc(m.money?.text ?? "")}` +
      (w.ap?.on ? `・行動力 ${w.ap.left}/${w.ap.perDay}` : "・行動力關閉中"),
      "ok");
  }

  async function cmdLedger() {
    const d = await apiGet("/api/neon/ledger?limit=12").catch(() => null);
    if (!d) return pushLog("系統", "帳本讀取失敗。", "err");
    const rows = (d.entries ?? d.items ?? []).slice(0, 8);
    if (!rows.length) return pushLog("帳本", "今天還沒有收支紀錄。", "ok");
    const moneyName = d.currency?.name ?? "虹幣";
    const perYuan = Number(d.currency?.perYuan) || 500;
    const lines = rows.map((e) => {
      const yuan = Number.isFinite(e.amountJiao) ? e.amountJiao / 10 : Number(e.amount ?? e.yuan ?? 0);
      const credit = yuan >= 0;
      const pretty = Math.abs(Math.round(yuan * perYuan)).toLocaleString("zh-Hant");
      return `${esc(e.note ?? e.kind ?? "收支")} <b style="color:${credit ? "#7dffb2" : "#ff9ec7"}">${credit ? "+" : "−"}${pretty} ${esc(moneyName)}</b>`;
    });
    pushLog("帳本", lines.join("<br>"), "ok");
  }

  function cmdApInfo() {
    const ap = S.world?.ap;
    pushLog("系統",
      ap?.on
        ? `行動力開啟中：今天還剩 <b>${ap.left}</b> / ${ap.perDay} 點，去一個地點消耗 1 點。輸入「關閉行動力」可自由走動。`
        : `行動力關閉中，目前可以隨意走動。企劃書玩法是每天 ${ap?.perDay ?? 10} 點行動力——「今天要去哪」會變成每日決策。輸入「開啟行動力」試試。`,
      "ok");
  }

  async function setAp(on) {
    const r = await apiPut("/api/user", { worldAp: on });
    if (!r.httpOk) return pushLog("系統", "切換失敗，請稍後再試。", "err");
    S.apArmed = false;
    await refresh();
    pushLog("系統", on
      ? `每日行動力已開啟：今天有 ${S.world?.ap?.left ?? "—"}/${S.world?.ap?.perDay ?? 10} 點，去一個地點消耗 1 點。`
      : "每日行動力已關閉，可以隨意走動。", "ok");
    syncAppUi();
  }

  function cmdUnknown(text) {
    const places = S.world?.places ?? [];
    const cand = places
      .map((p) => ({ p, n: norm(p.name) }))
      .filter(({ n }) => n.includes(text) || (text.length >= 2 && n.includes(text.slice(0, 2))))
      .slice(0, 4);
    const sug = cand.length
      ? `<div class="nrpg-acts">${cand.map(({ p }) => `<button type="button" data-do="visit" data-place="${p.id}">${esc(p.name)}</button>`).join("")}</div>`
      : "";
    pushLog("系統", `聽不懂「${esc(text)}」這個指令。輸入「幫助」看範例，或直接說一個地點。${sug}`, "warn");
  }

  /* ---------- 移動與行動 ---------- */

  function visitResultText(v, place) {
    switch (v?.kind) {
      case "closed": return { cls: "warn", html: `「${esc(place.name)}」現在沒開。` };
      case "tired": return { cls: "warn", html: `今天的行動力用完了——想繼續走動的話，輸入「關閉行動力」或等明天。` };
      case "asleep": return { cls: "warn", html: esc(v.text || "你正在睡覺。") };
      case "locked": return { cls: "warn", html: esc(v.hint || "現在還不能一起去。") };
      case "failed": return { cls: "err", html: esc(v.text || "路上出了點狀況。") };
      default: return null;
    }
  }

  async function ensureArrive(place, companion) {
    const detail = await getPlace(place.id);
    if (detail.here) return { detail, arrived: true, already: true };

    const r = await apiPost("/api/world/visit", {
      placeId: place.id,
      ...(companion ? { withId: companion.id } : {}),
    });
    const v = r.body;
    if (!r.httpOk || !v) {
      return { detail, arrived: false, msg: { cls: "err", html: esc(v?.error || "去不了這裡。") } };
    }
    const bad = visitResultText(v, place);
    if (bad) return { detail, arrived: false, msg: bad };

    // 到達回報
    if (v.kind === "outing" && v.character) {
      pushLog("同行", `和 <b>${esc(v.character.name)}</b> 一起去了「${esc(v.place ?? place.name)}」。<br>${esc(v.text ?? "")}` +
        (v.character.conversationId
          ? `<div class="nrpg-acts"><button type="button" data-do="chat" data-conv="${esc(v.character.conversationId)}">去和 ${esc(v.character.name)} 聊聊</button></div>`
          : ""), "story");
      markDaily("bond");
    } else if (v.kind === "ta") {
      const names = (v.characters ?? []).map((c) => esc(c.name)).join("、");
      pushLog("偶遇", `在「${esc(v.place ?? place.name)}」遇見了 <b>${names}</b>。`, "story");
      markDaily("bond");
    } else if (v.kind === "npc") {
      pushLog("偶遇", `在「${esc(v.place ?? place.name)}」遇到了人——看上面的偶遇卡片。`, "story");
    } else {
      pushLog("移動", `抵達「${esc(v.place ?? place.name)}」。${esc(v.crowd?.line ?? v.text ?? "")}`, "ok");
    }
    noteVisited(place.id);
    return { detail, arrived: true, already: false, encounter: v.kind === "npc" };
  }

  async function cmdVisitAct(place, text) {
    const companion = resolveCompanion(text);
    const { detail, arrived, already, msg } = await ensureArrive(place, companion);
    if (!arrived) { pushLog("系統", msg.html, msg.cls); await refresh(); return; }

    const fresh = await apiGet("/api/neon/place/" + encodeURIComponent(place.id)).catch(() => detail);
    S.placeCache.set(place.id, fresh);

    const action = resolveAction(text, fresh);
    if (!action) {
      const open = fresh.open !== false;
      pushLog("地點", open
        ? `「${esc(fresh.name)}」${already ? "你就在這裡" : "到了"}。想做什麼？${placeActionButtons(fresh)}`
        : `「${esc(fresh.name)}」現在沒開${fresh.closedReason ? `（${esc(fresh.closedReason)}）` : ""}。`, open ? "ok" : "warn");
      await refresh();
      if (!already) syncAppUi();
      return;
    }
    await doAct(place.id, action);
  }

  async function doAct(placeId, actionId) {
    const r = await apiPost("/api/neon/act", { placeId, actionId });
    const v = r.body ?? {};
    if (!v.ok) {
      pushLog("系統", esc(v.text || v.reason || "這個行動現在不能做。"), "warn");
      await refresh();
      return;
    }
    pushLog("行動", esc(v.text ?? "完成。") + deltaHtml(v.delta), "ok");
    S.placeCache.delete(placeId);
    await refresh();
    syncAppUi();
  }

  async function doHomeAct(act) {
    const r = await apiPost("/api/neon/home/act", { action: act.id });
    const v = r.body ?? {};
    if (!v.ok) {
      pushLog("系統", esc(v.text || v.reason || "現在不能這麼做。"), "warn");
    } else {
      pushLog("住處", esc(v.text ?? act.label) + deltaHtml(v.delta), "ok");
    }
    await refresh();
    syncAppUi();
  }

  async function doSleep(alarmMin) {
    const r = await apiPost("/api/neon/sleep", alarmMin != null ? { alarmMin } : {});
    const v = r.body ?? {};
    if (v && v.ok === false) {
      pushLog("系統", esc(v.text || "現在睡不著。"), "warn");
      await refresh();
      return;
    }
    pushLog("睡眠", esc(v?.text || v?.report?.text || (alarmMin != null ? `設好 ${Math.floor(alarmMin / 60)}:${String(alarmMin % 60).padStart(2, "0")} 的鬧鐘，睡了。` : "睡了一覺。")), "story");
    S.placeCache.clear();
    await refresh();
    syncAppUi();
  }

  async function doNextDay() {
    const r = await apiPost("/api/neon/next-day", {});
    const v = r.body ?? {};
    pushLog("新的一天", esc(v?.text || v?.report?.text || "新的一天開始了。"), "story");
    S.placeCache.clear();
    await refresh();
    syncAppUi();
  }

  /* ---------- 打工 ---------- */

  async function cmdGig(text) {
    let place = resolvePlace(text);
    if (!place) {
      // 沒指定地點：先看腳下有沒有，沒有就列出有短工的地點
      const places = S.world?.places ?? [];
      const hereId = await currentPlaceId();
      const here = places.find((p) => p.id === hereId);
      if (here) {
        const d = await getPlace(here.id);
        if ((d.gigs ?? []).length) place = here;
      }
      if (!place) {
        const btns = GIG_PLACES
          .map((id) => places.find((p) => p.id === id))
          .filter(Boolean)
          .map((p) => `<button type="button" data-do="gigat" data-place="${p.id}">${esc(p.name)}</button>`)
          .join("");
        return pushLog("打工", `想去哪裡打工？這些地方今天有短工：<div class="nrpg-acts">${btns}</div>`, "ok");
      }
    }
    await listGigs(place);
  }

  async function currentPlaceId() {
    // 2D 地圖上的「在這裡」標記最準；抓不到就當在住處
    try {
      const t = document.querySelector(".city-here")?.textContent?.trim();
      if (t) {
        const hit = (S.world?.places ?? []).find((p) => t.includes(p.name));
        if (hit) return hit.id;
      }
    } catch { /* ignore */ }
    return S.me?.home?.placeId ?? null;
  }

  async function listGigs(place) {
    const detail = await apiGet("/api/neon/place/" + encodeURIComponent(place.id)).catch(() => null);
    if (!detail) return pushLog("系統", "地點資料讀取失敗。", "err");
    S.placeCache.set(place.id, detail);
    const gigs = (detail.gigs ?? []).filter((g) => !g.blocked);
    const blocked = (detail.gigs ?? []).filter((g) => g.blocked);
    if (!gigs.length) {
      const why = blocked[0]?.blockedText ?? "今天這裡沒有短工了。";
      return pushLog("打工", `「${esc(detail.name)}」${esc(why)}`, "warn");
    }
    const btns = gigs
      .map((g) => `<button type="button" class="is-gig" data-do="gigpick" data-place="${esc(place.id)}" data-gig="${esc(g.id)}">${esc(g.label)}${g.payText ? `（${esc(g.payText)}）` : ""}</button>`)
      .join("");
    const gt = detail.gigsToday;
    const leftTxt = gt && Number.isFinite(gt.max - gt.done) ? `（今天還能做 ${gt.max - gt.done} 份）` : "";
    pushLog("打工", `「${esc(detail.name)}」的短工${leftTxt}：<div class="nrpg-acts">${btns}</div>`, "ok");
  }

  function gigPick(placeId, gigId) {
    const detail = S.placeCache.get(placeId);
    const gig = (detail?.gigs ?? []).find((g) => g.id === gigId);
    if (!gig || !detail) return pushLog("系統", "這份短工已經不在了。", "warn");
    const cfg = detail.focusGame ?? { seconds: 10, taps: 24 };
    pushLog("打工", `「${esc(gig.label)}」要怎麼做？<div class="nrpg-acts">` +
      `<button type="button" data-do="gigfocus" data-place="${esc(placeId)}" data-gig="${esc(gigId)}">專心做（${cfg.seconds} 秒小遊戲，成功少出錯）</button>` +
      `<button type="button" data-do="gigskip" data-place="${esc(placeId)}" data-gig="${esc(gigId)}">直接做</button></div>`, "ok");
  }

  async function doGig(placeId, gigId, focus) {
    // 先走真實的「前往地點」流程（行動力開啟時會扣點），再開工
    const place = (S.world?.places ?? []).find((x) => x.id === placeId);
    if (place) {
      const { arrived, msg } = await ensureArrive(place, null);
      if (!arrived) { pushLog("系統", msg.html, msg.cls); await refresh(); return; }
    }
    const r = await apiPost("/api/neon/gig", { jobId: gigId, focus });
    const v = r.body ?? {};
    if (!v.ok) {
      pushLog("打工", esc(v.text || v.reason || "這份短工現在做不了。"), "warn");
      await refresh();
      return;
    }
    pushLog("打工",
      esc(v.text ?? "做完了一份短工。") +
      (v.payText ? `<br>收入 <b style="color:#7dffb2">${esc(v.payText)}</b>` : "") +
      deltaHtml(v.delta) +
      (v.error ? `<br><span style="color:#ff9ec7">出了一點失誤，薪水被扣了。</span>` : ""),
      v.error ? "warn" : "ok");
    markDaily("gig");
    S.placeCache.delete(placeId);
    await refresh();
    syncAppUi();
  }

  /* ---------- 專注小遊戲 ---------- */

  function startFocusGame(placeId, gigId, cfg) {
    if (S.focus) return;
    const seconds = Math.max(3, Number(cfg.seconds) || 10);
    const target = Math.max(1, Number(cfg.taps) || 24);

    const wrap = document.createElement("div");
    wrap.className = "nrpg-focus";
    wrap.innerHTML =
      `<div class="nrpg-focus-card" role="dialog" aria-label="專注小遊戲">` +
      `<h3>FOCUS // 專心做</h3>` +
      `<p>${seconds} 秒內點滿 ${target} 下，這份短工會做得更好。<br>準備好就按「開始」。</p>` +
      `<div class="nrpg-focus-timer" data-ft>${seconds.toFixed(1)}</div>` +
      `<div class="nrpg-focus-bar"><i data-fb></i></div>` +
      `<div class="nrpg-focus-count" data-fc>0 / ${target}</div>` +
      `<button type="button" class="nrpg-focus-pad" data-fp>開始</button>` +
      `<br><button type="button" class="nrpg-focus-cancel" data-fx>先不要</button>` +
      `</div>`;
    document.body.appendChild(wrap);

    const pad = wrap.querySelector("[data-fp]");
    const timerEl = wrap.querySelector("[data-ft]");
    const barEl = wrap.querySelector("[data-fb]");
    const countEl = wrap.querySelector("[data-fc]");

    const game = { taps: 0, running: false, endAt: 0, raf: 0, dead: false };
    S.focus = game;

    const cleanup = () => {
      cancelAnimationFrame(game.raf);
      wrap.remove();
      S.focus = null;
    };

    const finish = (won) => {
      if (game.dead) return;
      game.dead = true;
      game.running = false;
      cleanup();
      doGig(placeId, gigId, won ? "won" : "lost");
    };

    const tick = () => {
      if (!game.running) return;
      const left = (game.endAt - performance.now()) / 1000;
      timerEl.textContent = Math.max(0, left).toFixed(1);
      if (left <= 0) return finish(game.taps >= target);
      game.raf = requestAnimationFrame(tick);
    };

    pad.addEventListener("click", () => {
      if (game.dead) return;
      if (!game.running) {
        game.running = true;
        game.taps = 0;
        game.endAt = performance.now() + seconds * 1000;
        pad.textContent = "點我!";
        game.raf = requestAnimationFrame(tick);
        return;
      }
      game.taps += 1;
      countEl.textContent = `${game.taps} / ${target}`;
      barEl.style.width = Math.min(100, (game.taps / target) * 100) + "%";
      if (game.taps >= target) finish(true);
    });
    wrap.querySelector("[data-fx]").addEventListener("click", () => {
      game.dead = true;
      cleanup();
    });
  }

  /* ---------- 偶遇回覆 ---------- */

  async function answerEncounter(idx) {
    const enc = S.world?.pending;
    if (!enc) return;
    const r = await apiPost("/api/world/answer", { encounterId: enc.id, option: idx });
    const v = r.body ?? {};
    if (!r.httpOk || v.error) {
      pushLog("偶遇", esc(v?.error || "這段偶遇已經結束了。"), "warn");
    } else {
      const npc = encounterNpc(enc);
      pushLog("偶遇",
        `${esc(v.reply ?? "")}` +
        (v.delta ? `<span class="nrpg-delta">${esc(npc?.name ?? "對方")}好感 <b class="${v.delta > 0 ? "up" : "down"}">${v.delta > 0 ? "+" : ""}${esc(v.delta)}</b></span>` : ""),
        "story");
      markDaily("bond");
    }
    await refresh();
    syncAppUi();
  }

  /* ---------- 控制台 DOM ---------- */

  const QUICK_CMDS = ["狀態", "幫助", "打工", "喝咖啡", "回家", "睡覺", "跳到明天"];

  function buildConsole() {
    const sec = document.createElement("section");
    sec.className = "nrpg";
    sec.setAttribute("aria-label", "自由行動控制台");
    sec.innerHTML =
      `<div class="nrpg-head">` +
      `<div class="nrpg-title"><b>NEON TERMINAL</b><span>自由行動 // 新霓市 RPG</span></div>` +
      `<button type="button" class="nrpg-ap" data-ap hidden></button>` +
      `</div>` +
      `<div class="nrpg-status" data-status></div>` +
      `<div class="nrpg-enc" data-enc hidden></div>` +
      `<div class="nrpg-quests">` +
      `<div class="nrpg-qhead">冒險日誌 <small>目標進度只記錄在這台裝置</small></div>` +
      `<ul data-quests></ul>` +
      `</div>` +
      `<div class="nrpg-log" data-log aria-live="polite"></div>` +
      `<div class="nrpg-chips" data-chips>${QUICK_CMDS.map((c) => `<button type="button" data-cmd="${esc(c)}">${esc(c)}</button>`).join("")}</div>` +
      `<form class="nrpg-form" data-form>` +
      `<input data-input type="text" autocomplete="off" enterkeyhint="send" ` +
      `placeholder="輸入指令：去量子咖啡喝咖啡、和 TA 去海堤、打工…" />` +
      `<button type="submit">執行</button>` +
      `</form>`;

    // 指令送出
    sec.querySelector("[data-form]").addEventListener("submit", (e) => {
      e.preventDefault();
      const inp = sec.querySelector("[data-input]");
      runCommand(inp.value);
    });

    // 快捷指令
    sec.querySelector("[data-chips]").addEventListener("click", (e) => {
      const b = e.target.closest("[data-cmd]");
      if (b) runCommand(b.dataset.cmd);
    });

    // 紀錄內的行動按鈕（事件委派）
    sec.querySelector("[data-log]").addEventListener("click", (e) => {
      const b = e.target.closest("[data-do]");
      if (!b || b.disabled || S.busy) return;
      const act = b.dataset.do;
      const placeId = b.dataset.place;
      const place = (S.world?.places ?? []).find((x) => x.id === placeId);
      if (act === "visit" && place) {
        runCommand("去" + place.name);
      } else if (act === "act" && place && b.dataset.act) {
        task(async () => {
          const { arrived, msg } = await ensureArrive(place, null);
          if (!arrived) { pushLog("系統", msg.html, msg.cls); await refresh(); return; }
          S.placeCache.delete(placeId);
          await doAct(placeId, b.dataset.act);
        });
      } else if (act === "gigpick") {
        gigPick(placeId, b.dataset.gig);
      } else if (act === "gigfocus") {
        const d = S.placeCache.get(placeId);
        startFocusGame(placeId, b.dataset.gig, d?.focusGame ?? { seconds: 10, taps: 24 });
      } else if (act === "gigskip") {
        task(() => doGig(placeId, b.dataset.gig, "skip"));
      } else if (act === "gigat" && place) {
        task(() => listGigs(place));
      } else if (act === "chat" && b.dataset.conv) {
        location.hash = "#/chat/" + b.dataset.conv;
      }
    });

    // 偶遇選項
    sec.querySelector("[data-enc]").addEventListener("click", (e) => {
      const b = e.target.closest("[data-enc-opt]");
      if (b && !S.busy) answerEncounter(Number(b.dataset.encOpt));
    });

    // 行動力開關（二次確認）
    sec.querySelector("[data-ap]").addEventListener("click", () => {
      if (!S.apArmed) {
        S.apArmed = true;
        renderApButton();
        setTimeout(() => { S.apArmed = false; renderApButton(); }, 4200);
        return;
      }
      S.apArmed = false;
      setAp(!S.world?.ap?.on);
    });

    return sec;
  }

  /* ---------- 掛載 ---------- */

  let scheduled = false;

  function inject() {
    scheduled = false;
    const pages = document.querySelectorAll(".city-page");
    for (const page of pages) {
      const map = page.querySelector(".city-map-wrap");
      if (!map) continue; // 世界包未開啟或尚未載入
      let sec = page.querySelector(":scope > .nrpg");
      if (!sec) {
        sec = buildConsole();
        map.insertAdjacentElement("afterend", sec);
        S.root = sec;
        renderLog();
        refresh().catch(() => {});
      } else {
        S.root = sec;
      }
    }
  }

  function scheduleInject() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(inject);
  }

  const observer = new MutationObserver(scheduleInject);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener("hashchange", scheduleInject);
  document.addEventListener("DOMContentLoaded", scheduleInject, { once: true });
  scheduleInject();
})();
