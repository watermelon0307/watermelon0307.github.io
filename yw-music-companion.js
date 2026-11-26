/* 餘溫音樂陪伴：角色點歌、歌曲／歌詞討論、安靜模式與真實一起聽紀錄。
   非侵入式介面；曲庫沿用 yw-audio.js 的 IndexedDB，AI 訊息走 YWMusicAPI。 */
(() => {
  "use strict";
  if (window.__ywMusicCompanionLoaded) return;
  window.__ywMusicCompanionLoaded = true;

  const Core = window.YWMusicCore;
  const Account = window.YWMusicAccount;
  if (!Core || !Account) return;
  const SETTINGS_KEY = "yw_music_companion_v1";
  const HISTORY_KEY = "yw_music_history_v1";
  const PENDING_KEY = "yw_music_pending_recs";
  const DB_NAME = "yw_music_db", STORE = "tracks";
  let ownerId = Account.id;
  let settings = Core.companionSettings(Account.read(SETTINGS_KEY, {}));
  let history = Account.read(HISTORY_KEY, []);
  let pending = Account.read(PENDING_KEY, []);
  if (!Array.isArray(history)) history = [];
  if (!Array.isArray(pending)) pending = [];

  const $ = (s, el = document) => el.querySelector(s);
  const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[c]);
  const activeChatId = () => audioApi()?.currentChatId?.() || "";
  const audioApi = () => window.__ywAudio;
  const saveSettings = () => Account.write(SETTINGS_KEY, settings);
  const saveHistory = () => Account.write(HISTORY_KEY, history);
  const savePending = () => Account.write(PENDING_KEY, pending);

  let toastTimer;
  function toast(text, error = false) {
    $(".ywa-toast")?.remove();
    const el = document.createElement("div");
    el.className = "ywa-toast" + (error ? " err" : "");
    el.textContent = text;
    document.body.appendChild(el);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.remove(), 2800);
  }

  /* 同一個曲庫，不另建歌曲資料層。 */
  let dbPromise;
  function db() {
    if (!dbPromise) dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }
  async function allTracks() {
    const database = await db();
    return new Promise((resolve, reject) => {
      const req = database.transaction(STORE).objectStore(STORE).getAll();
      req.onsuccess = () => resolve((req.result || []).filter(track => Account.owns(track)));
      req.onerror = () => reject(req.error);
    });
  }
  async function putTrack(track) {
    const owned = Account.withOwner(track, track.ownerId || ownerId);
    const database = await db();
    return new Promise((resolve, reject) => {
      const req = database.transaction(STORE, "readwrite").objectStore(STORE).put(owned);
      req.onsuccess = () => resolve(owned);
      req.onerror = () => reject(req.error);
    });
  }

  function barHtml() {
    return `<section id="ywcBar" class="ywc-bar" aria-label="角色音樂陪伴">
      <div class="ywc-actions">
        <button type="button" class="ywc-ai" data-ywc-mode="recommend">TA 點歌</button>
        <button type="button" class="ywc-ai" data-ywc-mode="comment">聊這首歌</button>
        <button type="button" class="ywc-ai" data-ywc-mode="lyrics">聊歌詞</button>
        <button type="button" data-ywc-history>一起聽紀錄</button>
      </div>
      <div class="ywc-preferences">
        <label><input type="checkbox" data-ywc-setting="proactive" ${settings.proactive ? "checked" : ""}><span>主動點歌</span></label>
        <label><input type="checkbox" data-ywc-setting="quiet" ${settings.quiet ? "checked" : ""}><span>安靜模式</span></label>
      </div>
      <p class="ywc-status">${settings.quiet ? "安靜模式開啟：只播放音樂，角色不發言。" : "角色會依人設推薦音樂，也能聊聊歌曲與你匯入的歌詞。"}</p>
    </section>`;
  }
  function inject() {
    const actions = $(".ywm-now .ywm-actions");
    const host = actions || $(".ywm-now");
    if (host && !$("#ywcBar")) {
      const template = document.createElement("template");
      template.innerHTML = barHtml().trim();
      const bar = template.content.firstElementChild;
      if (actions) actions.insertAdjacentElement("afterend", bar);
      else host.appendChild(bar);
      wireBar(bar);
    }
    syncSettingsUI();
  }
  function changeSetting(input) {
    const key = input.dataset?.ywcSetting;
    if (!key || !["proactive", "quiet"].includes(key)) return;
    settings = Core.companionSettings({ ...settings, [key]: input.checked });
    saveSettings();
    syncSettingsUI();
    toast(key === "quiet"
      ? (settings.quiet ? "安靜模式已開啟，角色不會再主動發言" : "安靜模式已關閉")
      : (settings.proactive ? "主動點歌已開啟" : "主動點歌已關閉，仍可手動請 TA 推薦"));
  }
  function wireBar(bar) {
    // 直接綁在注入節點，避免聊天室根節點的事件攔截吃掉 document 委派。
    bar.onclick = event => {
      const button = event.target.closest("button");
      if (!button) return;
      if (button.dataset.ywcMode) return request(button.dataset.ywcMode);
      if (button.hasAttribute("data-ywc-history")) return openHistory();
    };
    bar.onchange = event => {
      if (event.target.matches?.("[data-ywc-setting]")) changeSetting(event.target);
    };
  }
  function syncSettingsUI() {
    const bar = $("#ywcBar");
    if (!bar) return;
    const proactive = $('[data-ywc-setting="proactive"]', bar);
    const quiet = $('[data-ywc-setting="quiet"]', bar);
    if (proactive) proactive.checked = settings.proactive;
    if (quiet) quiet.checked = settings.quiet;
    const status = $(".ywc-status", bar);
    if (status) status.textContent = settings.quiet
      ? "安靜模式開啟：只播放音樂，角色不發言。"
      : "角色會依人設推薦音樂，也能聊聊歌曲與你匯入的歌詞。";
  }

  async function postMode(mode, track, lyricsExcerpt = "") {
    const cid = activeChatId();
    if (!cid) {
      toast("請先從角色聊天室開啟一起聽", true);
      return { ok: false };
    }
    const response = await fetch(`/api/conversations/${encodeURIComponent(cid)}/music-nudge`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mode,
        title: track.name,
        artist: track.artist || "",
        ...(lyricsExcerpt ? { lyricsExcerpt } : {}),
      }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "送出失敗，請稍後再試");
    return { ok: true, cid };
  }

  let requestInFlight = false;
  async function request(mode, automatic = false) {
    if (settings.quiet) {
      if (!automatic) toast("安靜模式開啟中；關閉後角色才會發言");
      return false;
    }
    if (requestInFlight) {
      if (!automatic) toast("TA 正在回覆，請稍候");
      return false;
    }
    const api = audioApi();
    if (!api) return false;
    let track = api.current;
    try {
      if (mode === "recommend") {
        const tracks = await allTracks();
        track = Core.pickRecommendation(tracks, history, track?.id, Date.now());
        if (!track) {
          if (!automatic) toast("歌單裡還沒有可推薦的其他歌曲，請先匯入音樂", true);
          return false;
        }
      } else {
        if (!track) {
          toast("請先選一首歌", true);
          return false;
        }
      }
      let excerpt = "";
      if (mode === "lyrics") {
        excerpt = Core.lyricExcerpt(track.lyricsText);
        if (!excerpt) {
          toast("這首歌還沒有歌詞；請先到歌單編輯並保存歌詞", true);
          return false;
        }
      }
      const requestOwner = ownerId;
      requestInFlight = true;
      document.querySelectorAll("#ywcBar [data-ywc-mode]").forEach(button => { button.disabled = true; });
      const posted = await postMode(mode, track, excerpt);
      if (!posted.ok || requestOwner !== ownerId) return false;
      if (mode === "recommend") {
        pending.push({ name: track.name, artist: track.artist || "", at: Date.now() });
        pending = pending.slice(-50);
        savePending();
        settings.lastNudgeAt = Date.now();
        saveSettings();
      }
      if (!automatic) {
        toast(mode === "recommend" ? "推薦卡已送出，TA 正在想推薦理由" : "已請 TA 聊聊，回覆會出現在聊天室");
      }
      return true;
    } catch (error) {
      if (!automatic) toast(error.message || "操作失敗", true);
      return false;
    } finally {
      requestInFlight = false;
      document.querySelectorAll("#ywcBar [data-ywc-mode]").forEach(button => { button.disabled = false; });
    }
  }

  async function maybeNudge() {
    const api = audioApi();
    if (!api || !activeChatId() || requestInFlight) return false;
    const allowed = Core.shouldNudge({
      proactive: settings.proactive,
      quiet: settings.quiet,
      playing: api.playing,
      visible: document.visibilityState === "visible",
      lastAt: settings.lastNudgeAt,
    }, Date.now());
    if (!allowed) return false;
    return request("recommend", true);
  }

  /* 只有 audio.play() 真正成功才會收到這個事件。 */
  document.addEventListener("yw-music-play", event => {
    const track = event.detail;
    if (!track?.id) return;
    const accepted = track.source === "recommend" || pending.some(item => Core.sameSong(item, track));
    history = Core.addPlay(history, track, track.at || Date.now(), accepted ? "recommend" : "library");
    saveHistory();
    if (accepted) {
      pending = pending.filter(item => !Core.sameSong(item, track));
      savePending();
    }
    listenState = { id: String(track.id), time: 0 };
    if (!settings.quiet && activeChatId()) syncNowPlaying(track);
  });

  async function syncNowPlaying(track) {
    const cid = activeChatId();
    if (!cid) return;
    try {
      await fetch(`/api/conversations/${encodeURIComponent(cid)}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ settings: { nowPlaying: { title: track.name, artist: track.artist || "" } } }),
      });
    } catch { /* 播放不被聊天狀態同步失敗中斷 */ }
  }

  /* 用實際 currentTime 前進量累積；拖曳進度、倒退與暫停不算聆聽時間。 */
  let listenState = null, unsavedMs = 0;
  function flushListening() {
    if (unsavedMs > 0) {
      saveHistory();
      unsavedMs = 0;
    }
  }
  function bindListening() {
    const audio = audioApi()?.audioEl;
    if (!audio || audio.__ywcListeningBound) return;
    audio.__ywcListeningBound = true;
    audio.addEventListener("play", () => {
      const current = audioApi()?.current;
      listenState = current ? { id: String(current.id), time: audio.currentTime } : null;
    });
    audio.addEventListener("timeupdate", () => {
      const current = audioApi()?.current;
      if (!current || audio.paused || audio.seeking) {
        listenState = null;
        return;
      }
      const id = String(current.id), time = audio.currentTime;
      if (listenState?.id === id) {
        const delta = time - listenState.time;
        if (delta > 0 && delta <= 2 && Core.addListenedMs(history, id, delta * 1000)) {
          unsavedMs += delta * 1000;
          if (unsavedMs >= 10000) flushListening();
        }
      }
      listenState = { id, time };
    });
    audio.addEventListener("pause", () => { listenState = null; flushListening(); });
    audio.addEventListener("ended", () => { listenState = null; flushListening(); });
  }
  window.addEventListener("pagehide", flushListening);

  const SOURCE_NAMES = {
    local: "本機音檔", netease: "網易雲分享", qq: "QQ 音樂分享",
    itunes: "iTunes 試聽", recommend: "TA 推薦",
  };
  function listenedText(ms) {
    const seconds = Math.max(0, Math.round((ms || 0) / 1000));
    if (seconds < 60) return `${seconds} 秒`;
    const minutes = Math.floor(seconds / 60);
    return `${minutes} 分 ${seconds % 60} 秒`;
  }
  let historyReturnFocus = null;
  function historyHtml() {
    const items = history.slice().reverse();
    return `<div class="ywc-backdrop" data-ywc-close></div>
      <section class="ywc-history" role="dialog" aria-modal="true" aria-labelledby="ywcHistoryTitle">
        <header><div><h2 id="ywcHistoryTitle">一起聽紀錄</h2><p>只保存成功播放的曲目與實際聆聽時間</p></div>
          <button type="button" class="ywc-close" data-ywc-close aria-label="關閉一起聽紀錄">×</button></header>
        <div class="ywc-history-tools"><span>共 ${items.length} 筆</span><button type="button" data-ywc-clear ${items.length ? "" : "disabled"}>清除紀錄</button></div>
        <div class="ywc-history-list">${items.length ? items.map(item => `<article class="ywc-history-item">
          <div class="ywc-history-copy"><h3>${esc(item.name || "未命名歌曲")}</h3>
            <p>${esc(item.artist || "未知歌手")} · ${esc(SOURCE_NAMES[item.source] || "音樂")}</p>
            <p><time>${esc(new Date(item.playedAt).toLocaleString("zh-TW"))}</time> · 實際聆聽 ${listenedText(item.listenedMs)}</p>
            ${item.via === "recommend" ? '<span class="ywc-rec-badge">接受 TA 推薦</span>' : ""}</div>
          <button type="button" class="ywc-replay" data-ywc-play="${esc(item.id)}" aria-label="播放 ${esc(item.name)}">播放</button>
        </article>`).join("") : '<div class="ywc-history-empty">還沒有一起聽的紀錄。成功播放一首歌後，會記錄在這裡。</div>'}</div>
      </section>`;
  }
  function openHistory() {
    $("#ywcHistory")?.remove();
    historyReturnFocus = document.activeElement;
    const root = document.createElement("div");
    root.id = "ywcHistory";
    root.className = "ywc-overlay";
    root.innerHTML = historyHtml();
    document.body.appendChild(root);
    $(".ywc-close", root)?.focus();
  }
  function closeHistory() {
    $("#ywcHistory")?.remove();
    if (historyReturnFocus?.isConnected) historyReturnFocus.focus();
    historyReturnFocus = null;
  }
  function clearHistory() {
    if (!history.length || !window.confirm("確定清除這台裝置上的一起聽紀錄？歌曲與歌單不會被刪除。")) return;
    history = [];
    unsavedMs = 0;
    saveHistory();
    const root = $("#ywcHistory");
    if (root) root.innerHTML = historyHtml();
    $(".ywc-close", root)?.focus();
  }
  async function replay(id) {
    const item = history.slice().reverse().find(entry => String(entry.id) === String(id));
    if (!item) return;
    try {
      const tracks = await allTracks();
      let track = tracks.find(entry => String(entry.id) === String(id)) || tracks.find(entry => Core.sameSong(entry, item));
      if (!track) {
        track = {
          id: String(item.id), name: item.name, artist: item.artist || "",
          source: "recommend", lyricsText: "", createdAt: Date.now(),
        };
        await putTrack(track);
      }
      await audioApi()?.refreshTracks?.();
      closeHistory();
      await audioApi()?.playTrack?.(track.id);
    } catch (error) {
      toast(error.message || "無法播放這首歌", true);
    }
  }

  // 紀錄 overlay 在 body 下，不受聊天室根節點事件影響。
  document.addEventListener("click", event => {
    if (event.target.closest("[data-ywc-close]")) return closeHistory();
    const button = event.target.closest("button");
    if (!button) return;
    if (button.hasAttribute("data-ywc-clear")) clearHistory();
    else if (button.dataset.ywcPlay) replay(button.dataset.ywcPlay);
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && $("#ywcHistory")) closeHistory();
  });

  function activateAccount(id) {
    flushListening();
    ownerId = Account.activate(id);
    settings = Core.companionSettings(Account.read(SETTINGS_KEY, {}));
    history = Account.read(HISTORY_KEY, []);
    pending = Account.read(PENDING_KEY, []);
    if (!Array.isArray(history)) history = [];
    if (!Array.isArray(pending)) pending = [];
    listenState = null;
    unsavedMs = 0;
    closeHistory();
    inject();
  }
  document.addEventListener("yowen:authenticated", event => activateAccount(event.detail?.id));
  document.addEventListener("yowen:logout", () => activateAccount(""));

  let observerQueued = false;
  const observer = new MutationObserver(() => {
    if (observerQueued) return;
    observerQueued = true;
    setTimeout(() => {
      observerQueued = false;
      inject();
      bindListening();
    }, 100);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  inject();
  bindListening();
  setInterval(maybeNudge, 60000);

  /* 測試與同頁模組用的唯讀快照；不取代既有播放器 API。 */
  window.__ywMusicCompanion = {
    get settings() { return { ...settings }; },
    get history() { return history.map(item => ({ ...item })); },
    maybeNudge,
    request,
    openHistory,
    closeHistory,
  };
})();
