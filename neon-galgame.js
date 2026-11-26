/* 新霓市 Galgame 偶遇舞台（切片一）
 * 偵測既有偶遇卡 [data-enc] 出現 → 以全幅舞台呈現立繪／名牌／打字機台詞／分支選項。
 * 原則：舞台只是呈現層——選項點擊一律轉發到真實的 [data-enc-opt] 按鈕，
 * 判定與好感度仍由 neon-rpg 的 /api/world/answer 流程執行，不造假狀態。
 */
(() => {
  "use strict";

  const LS_KEY = "neon-galgame:v1";
  const TYPE_MS = 26;
  const ANSWER_TIMEOUT = 9000;
  const REDUCED = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;

  const S = {
    stage: null, chip: null, encBox: null,
    enc: null, npc: null, place: null,
    fixture: false,           // true = 測試夾具模式（不觸碰真實 API）
    sending: false,
    typeTimer: 0, typeDone: false,
    enabled: loadEnabled(),
    mo: null,
  };

  const $ = (sel, root) => (root || document).querySelector(sel);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function loadEnabled() {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || "{}").enabled !== false; }
    catch { return true; }
  }
  function saveEnabled() {
    try { localStorage.setItem(LS_KEY, JSON.stringify({ enabled: S.enabled })); } catch { /* ignore */ }
  }

  /* ---------- 偶遇資料 ---------- */

  async function loadEncounter() {
    try {
      const r = await fetch("/api/world", { headers: { accept: "application/json" } });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const w = await r.json();
      const enc = w?.pending;
      if (!enc || !enc.scene) return null;
      return {
        enc,
        npc: (w.npcs || []).find((n) => n.id === enc.npcId) || null,
        place: (w.places || []).find((p) => p.id === enc.placeId) || null,
      };
    } catch {
      return readFromDom(); // 網路失敗時，用既有偶遇卡的真實內容兜底
    }
  }

  function readFromDom() {
    const box = S.encBox;
    if (!box || box.hidden) return null;
    const opts = [...box.querySelectorAll("[data-enc-opt]")].map((b) => ({ text: b.textContent.trim() }));
    const text = box.querySelector("p")?.textContent?.trim() || "";
    if (!opts.length && !text) return null;
    return { enc: { id: "dom", scene: { scene: text, options: opts } }, npc: null, place: null };
  }

  /* ---------- 立繪（誠實佔位：官方角色用既有 avatar，一般居民用霓虹訊號合成） ---------- */

  function portraitHtml(npc) {
    const id = npc?.id || "";
    if (id.startsWith("official_")) {
      const file = id.replace(/^official_/, "");
      return `<img class="nrgal-portrait" src="./avatars/${esc(file)}.svg" alt="${esc(npc?.name || "角色")}" ` +
        `onerror="this.closest('.nrgal-figure').classList.add('is-synth');this.remove();" />`;
    }
    return ""; // 合成立牌由 CSS/結構呈現
  }

  function figureHtml(npc) {
    const name = npc?.name || "神秘居民";
    const initial = [...name][0] || "？";
    const img = portraitHtml(npc);
    return (
      `<div class="nrgal-figure${img ? "" : " is-synth"}" data-figure>` +
      img +
      `<div class="nrgal-synth" aria-hidden="true">` +
      `<div class="nrgal-synth-head"></div><div class="nrgal-synth-body"></div>` +
      `<div class="nrgal-synth-glyph">${esc(initial)}</div>` +
      `</div>` +
      `<div class="nrgal-figure-tag">${img ? "CHARACTER // OFFICIAL" : "居民影像 // 訊號合成"}</div>` +
      `</div>`
    );
  }

  /* ---------- 舞台 DOM ---------- */

  function buildStage() {
    const el = document.createElement("div");
    el.className = "nrgal-stage";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", "true");
    el.setAttribute("aria-label", "偶遇演出");
    el.hidden = true;
    el.innerHTML =
      `<div class="nrgal-bg" aria-hidden="true"><span data-bg-place></span></div>` +
      `<div class="nrgal-layout">` +
      `<div class="nrgal-left" data-figure-slot></div>` +
      `<div class="nrgal-panel">` +
      `<div class="nrgal-nameplate"><b data-np-name></b><span data-np-sub></span></div>` +
      `<p class="nrgal-text" data-text tabindex="0"></p>` +
      `<div class="nrgal-opts" data-opts></div>` +
      `<div class="nrgal-tools">` +
      `<button type="button" data-gal-skip>略過打字</button>` +
      `<button type="button" data-gal-auto></button>` +
      `<button type="button" data-gal-close>關閉演出（改用文字卡）</button>` +
      `</div>` +
      `</div>` +
      `</div>`;
    document.body.appendChild(el);

    el.addEventListener("click", (e) => {
      if (e.target.closest("[data-gal-close]")) return closeStage(false);
      if (e.target.closest("[data-gal-skip]")) return completeTyping();
      if (e.target.closest("[data-gal-auto]")) {
        S.enabled = !S.enabled;
        saveEnabled();
        renderAutoBtn();
        return;
      }
      const opt = e.target.closest("[data-gal-opt]");
      if (opt && !S.sending) return choose(Number(opt.dataset.galOpt));
      if (e.target.closest("[data-text]")) completeTyping();
    });
    el.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeStage(false);
    });
    return el;
  }

  function renderAutoBtn() {
    const b = $("[data-gal-auto]", S.stage);
    if (b) b.textContent = `自動演出：${S.enabled ? "開" : "關"}`;
  }

  /* ---------- 打字機 ---------- */

  function typewrite(text) {
    const el = $("[data-text]", S.stage);
    clearInterval(S.typeTimer);
    S.typeDone = false;
    if (REDUCED) {
      el.textContent = text;
      S.typeDone = true;
      showOpts();
      return;
    }
    el.textContent = "";
    let i = 0;
    S.typeTimer = setInterval(() => {
      i += 1;
      el.textContent = text.slice(0, i);
      if (i >= text.length) completeTyping();
    }, TYPE_MS);
  }

  function completeTyping() {
    if (S.typeDone) return;
    clearInterval(S.typeTimer);
    S.typeDone = true;
    const el = $("[data-text]", S.stage);
    if (el && S.fullText) el.textContent = S.fullText;
    showOpts();
  }

  function showOpts() {
    const box = $("[data-opts]", S.stage);
    if (box) box.classList.add("ready");
  }

  /* ---------- 開關舞台 ---------- */

  async function openStage(fixtureData) {
    const data = fixtureData || await loadEncounter();
    if (!data || !data.enc) return false;

    S.enc = data.enc;
    S.npc = data.npc;
    S.place = data.place;
    S.fixture = !!fixtureData;
    S.sending = false;

    if (!S.stage) S.stage = buildStage();

    const scene = S.enc.scene || {};
    const opts = scene.options || [];
    S.fullText = scene.scene || S.enc.line || "";

    $("[data-figure-slot]", S.stage).innerHTML = figureHtml(S.npc);
    $("[data-np-name]", S.stage).textContent = S.npc?.name || "神秘居民";
    $("[data-np-sub]", S.stage).textContent =
      [S.npc?.job, S.place ? `@ ${S.place.name}` : null].filter(Boolean).join("　");
    $("[data-bg-place]", S.stage).textContent = S.place?.name || "新霓市";
    $("[data-opts]", S.stage).innerHTML = opts
      .map((o, i) => `<button type="button" data-gal-opt="${i}"><i>${String(i + 1).padStart(2, "0")}</i>${esc(o.text)}</button>`)
      .join("");
    $("[data-opts]", S.stage).classList.remove("ready", "sending"); // 上一場的 sending 也要清掉
    renderAutoBtn();

    S.stage.hidden = false;
    requestAnimationFrame(() => S.stage.classList.add("on"));
    $("[data-text]", S.stage).focus({ preventScroll: true });
    typewrite(S.fullText);
    return true;
  }

  function closeStage(answered) {
    if (!S.stage) return;
    clearInterval(S.typeTimer);
    S.stage.classList.remove("on");
    S.stage.classList.toggle("answered", !!answered);
    const el = S.stage;
    setTimeout(() => {
      el.hidden = true;
      el.classList.remove("answered");
      if (S.fixture) { S.fixture = false; S.enc = null; }
      updateChip(); // 等舞台真正隱藏後再決定 chip
    }, REDUCED ? 0 : 320);
    updateChip();
  }

  /* ---------- 選項轉發（真實流程） ---------- */

  function choose(idx) {
    if (S.fixture) {
      // 測試夾具模式：只記錄選擇，不觸碰真實 API
      window.__neonGalgame.fixtureChoice = idx;
      closeStage(true);
      return;
    }
    const real = document.querySelector(`[data-enc-opt="${idx}"]`);
    if (!real) {
      // 真實偶遇已消失（可能過期）——誠實回報
      const el = $("[data-text]", S.stage);
      if (el) el.textContent = "這段偶遇已經結束了。";
      $("[data-opts]", S.stage).innerHTML = "";
      return;
    }
    S.sending = true;
    $("[data-opts]", S.stage).classList.add("sending");
    real.click(); // 轉發給 neon-rpg 的 answerEncounter → /api/world/answer
    // 等待真實偶遇卡消失（refresh 後 pending 清空）；逾時則恢復可操作
    const t0 = performance.now();
    const timer = setInterval(() => {
      const gone = !S.encBox || S.encBox.hidden || !S.encBox.querySelector("[data-enc-opt]");
      if (gone) {
        clearInterval(timer);
        S.sending = false;
        closeStage(true);
      } else if (performance.now() - t0 > ANSWER_TIMEOUT) {
        clearInterval(timer);
        S.sending = false;
        $("[data-opts]", S.stage)?.classList.remove("sending");
      }
    }, 200);
  }

  /* ---------- 演出模式 chip（偶遇還在但舞台關閉時可重開） ---------- */

  function ensureChip() {
    if (S.chip) return S.chip;
    const b = document.createElement("button");
    b.type = "button";
    b.className = "nrgal-chip";
    b.textContent = "✦ 演出模式";
    b.hidden = true;
    b.addEventListener("click", () => { openStage(); });
    document.body.appendChild(b);
    S.chip = b;
    return b;
  }

  function updateChip() {
    const chip = ensureChip();
    // 以即時 DOM 為準：React 重掛後 S.encBox 可能還指著舊卡片
    const liveBox = document.querySelector(".nrpg [data-enc]");
    if (liveBox && liveBox !== S.encBox) watchEncBox(liveBox);
    const encActive = !!(liveBox && !liveBox.hidden && liveBox.querySelector("[data-enc-opt]"));
    chip.hidden = !(encActive && (S.stage?.hidden !== false));
  }

  /* ---------- 觀察既有偶遇卡 ---------- */

  function watchEncBox(box) {
    if (S.encBox === box) return;
    S.mo?.disconnect();
    S.encBox = box;
    S.mo = new MutationObserver(() => onEncChange());
    S.mo.observe(box, { attributes: true, attributeFilter: ["hidden"], childList: true });
    onEncChange();
  }

  let openTimer = 0;
  function onEncChange() {
    const active = !!(S.encBox && !S.encBox.hidden && S.encBox.querySelector("[data-enc-opt]"));
    clearTimeout(openTimer);
    if (active && S.enabled && (S.stage?.hidden !== false) && !S.fixture) {
      // 稍等真實卡片渲染完成再開舞台
      openTimer = setTimeout(() => { openStage(); }, 180);
    }
    if (!active && !S.fixture && S.stage && !S.stage.hidden && !S.sending) {
      closeStage(false); // 偶遇被其他路徑結束（例如在文字卡作答）→ 舞台同步關閉
    }
    updateChip();
  }

  /* ---------- 掛載 ---------- */

  let scheduled = false;
  function inject() {
    scheduled = false;
    const box = document.querySelector(".nrpg [data-enc]");
    if (box) watchEncBox(box);
  }
  function scheduleInject() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(inject);
  }

  /* ---------- 偵錯掛點（測試用） ---------- */
  window.__neonGalgame = {
    get open() { return !!S.stage && !S.stage.hidden; },
    get encounterId() { return S.fixture ? null : (S.enc?.id ?? null); },
    get enabled() { return S.enabled; },
    get fixture() { return S.fixture; },
    fixtureChoice: null,
    setEnabled(v) { S.enabled = !!v; saveEnabled(); renderAutoBtn(); },
    reopen: () => openStage(),
    dismiss: () => closeStage(false),
    /** 測試專用：以合成偶遇渲染舞台；選項只記錄 fixtureChoice，不觸碰真實 API */
    presentFixture(enc, npc, place) {
      return openStage({ enc, npc: npc ?? null, place: place ?? null });
    },
    version: "1.0.0",
  };

  const observer = new MutationObserver(scheduleInject);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener("hashchange", scheduleInject);
  document.addEventListener("DOMContentLoaded", scheduleInject, { once: true });
  scheduleInject();
})();
