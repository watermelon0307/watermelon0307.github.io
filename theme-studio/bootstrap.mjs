import { mountThemeStudio } from './studio.mjs';
let studio = null, pending = null, retryTimer = null;
function routeContainer() { return document.getElementById('theme-studio-route'); }
async function sync() {
  const active = location.hash.startsWith('#/studio');
  if (!active) { if (pending) pending.cancelled = true; if (studio) { const current = studio; studio = null; await current.dispose(); } return; }
  if (studio || pending) return;
  const token = { cancelled: false }; pending = token;
  try {
    let container = routeContainer(), attempts = 0;
    while (!container && attempts++ < 90 && !token.cancelled) { await new Promise(requestAnimationFrame); container = routeContainer(); }
    if (!container) throw new Error('找不到 /studio route；請重新整理後重試');
    const instance = await mountThemeStudio(container); if (token.cancelled || !location.hash.startsWith('#/studio')) await instance.dispose(); else { studio = instance; window.__warmthThemeStudio = instance; }
  } catch (error) {
    const container = routeContainer(); if (container) { container.innerHTML = `<section style="position:fixed;inset:0;z-index:9000;display:grid;place-items:center;background:#1e1e24;color:#e0e0e0;font:14px system-ui"><div style="max-width:440px;padding:24px"><h1>Theme Studio 無法啟動</h1><p style="color:#9a9aab">${String(error.message).replace(/[<>&]/g, '')}</p><button id="studio-retry" style="padding:9px 16px">重試</button><button id="studio-back" style="padding:9px 16px;margin-left:8px">返回</button></div></section>`; container.querySelector('#studio-retry').onclick = () => sync(); container.querySelector('#studio-back').onclick = () => { location.hash = '#/me'; }; }
  } finally { if (pending === token) pending = null; }
}
window.addEventListener('hashchange', () => { clearTimeout(retryTimer); retryTimer = setTimeout(sync, 0); });
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', sync, { once: true }); else sync();
export { sync as syncThemeStudioRoute };
