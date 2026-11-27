/* 餘溫 × 本機網易雲伺服器橋接。
   伺服器是手機上的 ncm_web/server.py（預設 http://127.0.0.1:8787）；登入與 Cookie 只留在那一頁，
   這裡只呼叫搜尋、播放地址、歌詞與「目前播放」同步，拿不到也不經手帳號 Cookie。 */
(() => {
  "use strict";
  if (window.YWNcm) return;
  const KEY = "yw_ncm_base";
  const DEFAULT_BASE = "http://127.0.0.1:8787";
  let base = DEFAULT_BASE;
  try { base = (localStorage.getItem(KEY) || DEFAULT_BASE).replace(/\/+$/, ""); } catch { /* 儲存不可用就用預設 */ }
  let online = null; // null 還沒試過／true／false

  async function call(path, params, body) {
    const url = new URL(base + path);
    for (const [k, v] of Object.entries(params || {})) url.searchParams.set(k, v);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    // POST 用 text/plain 送 JSON，省掉一次 CORS 預檢；伺服器只看內容不看型別
    const init = { signal: ctrl.signal, credentials: "omit", cache: "no-store" };
    if (body) Object.assign(init, { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify(body) });
    let res;
    try { res = await fetch(url, init); }
    catch { online = false; throw new Error("連不上本機網易雲伺服器，請確認手機上的 server.py 正在執行"); }
    finally { clearTimeout(timer); }
    online = true;
    const data = await res.json().catch(() => ({ error: "本機伺服器回應格式錯誤" }));
    if (!res.ok || data.error) throw new Error(data.error || `本機伺服器回應 HTTP ${res.status}`);
    return data;
  }

  window.YWNcm = Object.freeze({
    get base() { return base; },
    get online() { return online; },
    cover: (url, size) => (url ? `${url}?param=${size}y${size}` : ""),
    status: () => call("/api/status"),
    search: (q, offset = 0, limit = 20) => call("/api/search", { q, offset, limit }),
    playUrl: id => call("/api/playurl", { id }),
    lyric: id => call("/api/lyric", { id }),
    /* 同步目前播放給讀 /api/nowplaying 的一方；伺服器沒開過就不打擾 */
    syncNow: body => (online ? call("/api/nowplaying", null, body).catch(() => {}) : Promise.resolve()),
  });
})();
