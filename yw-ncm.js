/* 餘溫 × WARMTH 一起聽（網易雲）。
   介面就是手機上 ncm_web/server.py 提供的那一頁（預設 http://127.0.0.1:8787），這裡把它嵌成全螢幕面板：
   搜尋、播放、歌詞、掃碼登入都在那一頁裡完成，帳號 Cookie 只留在本機伺服器，App 不經手。
   App 這邊只做三件事：確認伺服器在不在、收合時讓音樂繼續播、和 App 自己的播放器互相讓聲。 */
(() => {
  "use strict";
  if (window.YWNcm) return;
  const KEY = "yw_ncm_base";
  const DEFAULT_BASE = "http://127.0.0.1:8787";
  let base = DEFAULT_BASE;
  try { base = (localStorage.getItem(KEY) || DEFAULT_BASE).replace(/\/+$/, ""); } catch { /* 儲存不可用就用預設 */ }
  const origin = new URL(base).origin;
  let root = null, frame = null, pill = null, isOpen = false;
  let now = { playing: false, id: null, name: "", artist: "" };

  async function ping() {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    try {
      const res = await fetch(base + "/api/status", { signal: ctrl.signal, credentials: "omit", cache: "no-store" });
      return res.ok;
    } catch { return false; }
    finally { clearTimeout(timer); }
  }

  function css() {
    if (document.getElementById("ywNcmStyle")) return;
    const style = document.createElement("style");
    style.id = "ywNcmStyle";
    style.textContent = `
.ywn{position:fixed;inset:0;z-index:10080;background:#100F13;display:flex;flex-direction:column}
.ywn[hidden],.ywn-pill[hidden]{display:none}
.ywn-bar{flex:none;display:flex;align-items:center;justify-content:space-between;padding:calc(env(safe-area-inset-top,0px) + 4px) 8px 4px;color:#BDB5C0;font-size:13px}
.ywn-bar button{min-width:44px;min-height:44px;padding:0 12px;border:0;border-radius:14px;background:none;color:inherit;font:inherit;cursor:pointer}
.ywn-bar button:focus-visible,.ywn-pill:focus-visible{outline:2px solid #F9D0DA;outline-offset:2px}
.ywn-frame{flex:1;min-height:0;width:100%;border:0;background:#100F13}
.ywn-pill{position:fixed;z-index:10075;left:14px;bottom:calc(env(safe-area-inset-bottom,0px) + 92px);max-width:min(64vw,240px);min-height:48px;padding:0 16px 0 12px;border:0;border-radius:24px;display:flex;align-items:center;gap:8px;cursor:pointer;font:500 13px/1.3 Inter,"Noto Sans TC","PingFang TC","Microsoft JhengHei",system-ui,sans-serif;color:#301A25;background:radial-gradient(120% 120% at 30% 18%,#FFF6F8 0%,#F9D0DA 46%,#E9A9BC 100%);box-shadow:inset 0 1px 0 rgba(255,255,255,.85),inset 0 -3px 6px rgba(150,60,92,.3),0 10px 24px rgba(0,0,0,.45)}
.ywn-pill span{min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}`;
    document.head.appendChild(style);
  }

  function build() {
    if (root) return;
    css();
    root = document.createElement("div");
    root.className = "ywn";
    root.hidden = true;
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-label", "WARMTH 一起聽");
    root.innerHTML = `<div class="ywn-bar"><button type="button" data-ywn-min aria-label="收合，音樂繼續播放">⌄ 收合</button><button type="button" data-ywn-quit aria-label="關閉並停止播放">✕ 關閉</button></div>`;
    frame = document.createElement("iframe");
    frame.className = "ywn-frame";
    frame.title = "WARMTH 一起聽";
    frame.allow = "autoplay";
    frame.referrerPolicy = "no-referrer";
    frame.src = base + "/";
    root.appendChild(frame);
    root.querySelector("[data-ywn-min]").onclick = () => close();
    root.querySelector("[data-ywn-quit]").onclick = () => quit();
    pill = document.createElement("button");
    pill.type = "button";
    pill.className = "ywn-pill";
    pill.hidden = true;
    pill.innerHTML = `<b aria-hidden="true">♪</b><span></span>`;
    pill.onclick = () => show();
    document.body.append(root, pill);
  }

  function renderPill() {
    if (!pill) return;
    pill.hidden = isOpen || !now.name;
    pill.querySelector("span").textContent = now.name ? `${now.name}${now.artist ? " — " + now.artist : ""}` : "";
    pill.setAttribute("aria-label", `開啟一起聽：${now.name || ""}`);
  }
  function show() { build(); isOpen = true; root.hidden = false; renderPill(); }
  function close() { if (!root) return; isOpen = false; root.hidden = true; renderPill(); }
  function quit() {
    if (!root) return;
    root.remove(); pill.remove();
    root = frame = pill = null; isOpen = false;
    now = { playing: false, id: null, name: "", artist: "" };
  }

  /* 伺服器沒開就回 false，呼叫端可以退回原本的做法 */
  async function open() {
    if (root) { show(); return true; }
    if (!(await ping())) return false;
    show();
    return true;
  }

  function send(cmd) {
    if (frame && frame.contentWindow) frame.contentWindow.postMessage({ target: "ncm_web", cmd }, origin);
  }

  window.addEventListener("message", event => {
    if (!frame || event.source !== frame.contentWindow || event.origin !== origin) return;
    const d = event.data;
    if (!d || d.source !== "ncm_web" || d.type !== "state") return;
    const changed = d.id && d.id !== now.id;
    now = { playing: !!d.playing, id: d.id || null, name: String(d.name || ""), artist: (d.artists || []).join(" / ") };
    renderPill();
    if (now.playing) {
      const appAudio = window.__ywAudio && window.__ywAudio.audioEl;
      if (appAudio && !appAudio.paused) appAudio.pause(); // 兩邊不同時出聲
    }
    if (changed && now.playing) {
      document.dispatchEvent(new CustomEvent("yw-music-play", { detail: { id: "ncm_" + now.id, name: now.name, artist: now.artist, source: "netease", at: Date.now() } }));
    }
  });
  /* App 自己的播放器開始播時，請網易雲那一頁暫停 */
  document.addEventListener("DOMContentLoaded", () => {
    const appAudio = window.__ywAudio && window.__ywAudio.audioEl;
    if (appAudio) appAudio.addEventListener("play", () => { if (now.playing) send("pause"); });
  }, { once: true });

  window.YWNcm = Object.freeze({
    get base() { return base; },
    get isOpen() { return isOpen; },
    get now() { return { ...now }; },
    open, close, quit, ping,
  });
})();
