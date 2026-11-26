/* 餘溫音樂陪伴核心（純邏輯，瀏覽器與 Node 共用，無 DOM／網路依賴）
   一起聽紀錄、主動點歌判斷、推薦接受比對、授權歌詞節錄。 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.YWMusicCore = api;
})(typeof self !== "undefined" ? self : globalThis, function () {
  "use strict";

  const HISTORY_LIMIT = 200;
  const NUDGE_INTERVAL_MS = 30 * 60 * 1000; // 主動點歌最短間隔 30 分鐘
  const RECENT_PLAY_MS = 7 * 24 * 60 * 60 * 1000; // 推薦避開近 7 天已播
  const SAME_PLAY_DEDUPE_MS = 60 * 1000; // 同一首 60 秒內不重複記一筆

  function readJson(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
  }
  function writeJson(key, v) {
    try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* 容量滿就放棄，不影響播放 */ }
  }

  function companionSettings(raw) {
    const r = raw && typeof raw === "object" ? raw : {};
    return {
      proactive: r.proactive !== false,       // 主動點歌，預設開啟、可關閉
      quiet: r.quiet === true,                // 安靜模式：關閉角色發言
      lastNudgeAt: Number.isFinite(r.lastNudgeAt) ? r.lastNudgeAt : 0,
    };
  }

  /* 與 index.html 內 Eh() 相同的正規化規則，用於比對「同一首歌」 */
  function normalizeTitle(t) {
    return String(t ?? "").toLowerCase().replace(/[\s'’"「」《》()（）\-–—_.,，。!?！？]/g, "");
  }
  function sameSong(a, b) {
    if (!a || !b) return false;
    const an = normalizeTitle(a.name ?? a.title), bn = normalizeTitle(b.name ?? b.title);
    if (!an || an !== bn) return false;
    const aa = normalizeTitle(a.artist), ba = normalizeTitle(b.artist);
    return !aa || !ba || aa === ba; // 任一方缺歌手時只比曲名
  }

  /* ---------- 一起聽紀錄：只記真實播放過的曲目 ---------- */
  function addPlay(history, track, at, via) {
    const list = Array.isArray(history) ? history.slice() : [];
    const last = list[list.length - 1];
    if (last && last.id === track.id && at - last.playedAt < SAME_PLAY_DEDUPE_MS) {
      last.playedAt = at;
      return list;
    }
    list.push({
      id: String(track.id),
      name: String(track.name ?? "").slice(0, 100),
      artist: String(track.artist ?? "").slice(0, 80),
      source: String(track.source ?? "local"),
      playedAt: at,
      listenedMs: 0,
      via: via === "recommend" ? "recommend" : "library",
    });
    return list.slice(-HISTORY_LIMIT);
  }

  /* 實際聆聽秒數累到最後一筆同曲紀錄；回傳是否有更新 */
  function addListenedMs(history, trackId, ms) {
    if (!Array.isArray(history) || !(ms > 0)) return false;
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].id === trackId) { history[i].listenedMs = Math.round((history[i].listenedMs || 0) + ms); return true; }
      if (history[i].playedAt < Date.now() - RECENT_PLAY_MS) break;
    }
    return false;
  }

  /* 推薦選曲：避開目前播放與近 7 天已播，否則選最久沒聽的；曲庫空回 null */
  function pickRecommendation(tracks, history, currentId, now) {
    if (!Array.isArray(tracks) || !tracks.length) return null;
    const recent = new Set(
      (history ?? []).filter(h => now - h.playedAt < RECENT_PLAY_MS).map(h => h.id)
    );
    const lastPlayed = new Map((history ?? []).map(h => [h.id, h.playedAt]));
    const pool = tracks.filter(t => t.id !== currentId);
    if (!pool.length) return null;
    const fresh = pool.filter(t => !recent.has(t.id));
    const candidates = fresh.length ? fresh : pool;
    return candidates.slice().sort((a, b) =>
      (lastPlayed.get(a.id) ?? 0) - (lastPlayed.get(b.id) ?? 0) ||
      (a.createdAt ?? 0) - (b.createdAt ?? 0)
    )[0];
  }

  /* 主動點歌判斷：需開啟主動推薦、非安靜模式、正在播放、頁面可見、超過間隔 */
  function shouldNudge(state, now, interval = NUDGE_INTERVAL_MS) {
    if (!state) return false;
    return !!(
      state.proactive && !state.quiet && state.playing && state.visible &&
      now - (state.lastAt || 0) >= interval
    );
  }

  /* 歌詞節錄：去掉 LRC 時間標籤，取前幾行、限字數；只用使用者自行匯入的歌詞 */
  function lyricExcerpt(text, maxLines = 6, maxChars = 220) {
    const lines = String(text ?? "").split(/\r?\n/)
      .map(l => l.replace(/\[[^\]]+\]/g, "").trim())
      .filter(l => l && !/^(ar|ti|al|by|offset):/i.test(l));
    if (!lines.length) return "";
    let out = "";
    for (const line of lines.slice(0, maxLines)) {
      const next = out ? out + "／" + line : line;
      if (next.length > maxChars) break;
      out = next;
    }
    return out;
  }

  return {
    HISTORY_LIMIT, NUDGE_INTERVAL_MS, RECENT_PLAY_MS,
    readJson, writeJson, companionSettings,
    normalizeTitle, sameSong,
    addPlay, addListenedMs, pickRecommendation, shouldNudge, lyricExcerpt,
  };
});
