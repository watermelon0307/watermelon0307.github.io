/* ============================================================
   YOWEN ID — 開機後登入 / 註冊 / 手機與郵箱驗證碼
   ------------------------------------------------------------
   預設為清楚標示的本機示範：驗證碼只顯示在畫面，QQ／微信也是示範授權。
   正式模式可在本檔載入前設定 window.YOWEN_AUTH_CONFIG = { apiBase }。
   apiBase 例：https://example.com/api/auth（不可在瀏覽器放服務商密鑰）。

   正式服務接點（皆 POST JSON，session 由伺服器以 HttpOnly Cookie 管理）：
     /code/request    { target, purpose } -> { requestId, expiresIn?, resendAfter? }
     /register        { target, password, code, requestId } -> { user }
     /login/password  { target, password } -> { user }
     /login/code      { target, code, requestId } -> { user }
     /logout          {} -> {}
   user 至少包含 id、login，可另含 nick。只有 2xx 才視為發碼或登入成功。
   ============================================================ */
(() => {
  "use strict";

  const LS_ACCOUNTS = "yowen_accounts";
  const LS_SESSION = "yowen_session";
  const LS_OAUTH = "yowen_oauth_demo_identities";
  const CODE_TTL = 5 * 60 * 1000;
  const CODE_RESEND = 60;
  const MAX_CODE_ATTEMPTS = 5;
  const configured = window.YOWEN_AUTH_CONFIG ?? {};
  const API_BASE = String(
    configured.apiBase ?? document.querySelector('meta[name="yowen-auth-api"]')?.content ?? "",
  ).trim().replace(/\/+$/, "");
  const supabase = configured.provider === "supabase";
  const googleOAuth = supabase && configured.googleOAuthEnabled === true;
  const remote = Boolean(API_BASE) || supabase;
  const authMode = supabase ? "supabase" : API_BASE ? "remote" : "demo";
  let cloudReady = !supabase;
  let cloudAccount = null;
  let supabaseProviderPromise = null;
  let readyPromise = null;
  let lastAuthenticatedId = "";

  function cloudProvider() {
    if (!supabaseProviderPromise) {
      supabaseProviderPromise = Promise.resolve().then(() => {
        if (!window.YowenSupabaseAuth?.create) throw new Error("Supabase 登入元件尚未載入");
        return window.YowenSupabaseAuth.create(configured);
      });
    }
    return supabaseProviderPromise;
  }

  const $ = (selector, root = document) => root.querySelector(selector);
  const esc = (value) => String(value ?? "").replace(
    /[&<>"']/g,
    (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character],
  );

  function readJson(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
  }

  function writeJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
  }

  function randomId(prefix = "u_") {
    if (crypto.randomUUID) return prefix + crypto.randomUUID();
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return prefix + [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  function emailTarget(value) {
    const target = String(value ?? "").trim().toLowerCase();
    return target.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target) ? target : null;
  }

  function phoneTarget(value) {
    let target = String(value ?? "").trim().replace(/[\s().-]/g, "");
    if (target.startsWith("00")) target = "+" + target.slice(2);
    if (/^09\d{8}$/.test(target)) target = "+886" + target.slice(1);
    else if (/^1[3-9]\d{9}$/.test(target)) target = "+86" + target;
    return /^\+[1-9]\d{7,14}$/.test(target) ? target : null;
  }

  function normalizeTarget(value) {
    return emailTarget(value) ?? phoneTarget(value) ?? String(value ?? "").trim().toLowerCase();
  }

  function isAccount(value) { return Boolean(emailTarget(value) ?? phoneTarget(value)); }
  function accountKind(value) { return emailTarget(value) ? "email" : "phone"; }

  function maskTarget(value) {
    const target = normalizeTarget(value);
    if (emailTarget(target)) {
      const [name, domain] = target.split("@");
      return `${name.slice(0, 2)}${name.length > 2 ? "***" : ""}@${domain}`;
    }
    return target.length > 7 ? `${target.slice(0, 4)}****${target.slice(-4)}` : target;
  }

  function hex(buffer) {
    return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  async function legacyHash(text) {
    return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  }

  async function passwordHash(password, salt) {
    const key = await crypto.subtle.importKey(
      "raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"],
    );
    const bits = await crypto.subtle.deriveBits(
      { name: "PBKDF2", hash: "SHA-256", salt: new TextEncoder().encode(salt), iterations: 120000 },
      key,
      256,
    );
    return hex(bits);
  }

  function accounts() {
    const value = readJson(LS_ACCOUNTS, []);
    return Array.isArray(value) ? value.filter((item) => item && item.id && item.login) : [];
  }

  function findAccount(login) {
    const raw = String(login ?? "").trim().toLowerCase();
    const target = normalizeTarget(login);
    return accounts().find((account) => {
      const saved = String(account.login).trim().toLowerCase();
      return saved === raw || normalizeTarget(saved) === target;
    }) ?? null;
  }

  function saveAccount(account) {
    return writeJson(LS_ACCOUNTS, [...accounts().filter((item) => item.id !== account.id), account]);
  }

  function session() {
    // Supabase 驗證完成前，不信任舊版 yowen_session，避免短暫解鎖私人資料。
    if (supabase) return cloudReady && cloudAccount ? { ...cloudAccount } : null;
    const value = readJson(LS_SESSION, null);
    return value && value.id && value.login ? value : null;
  }

  function setSession(account, via) {
    const previous = readJson(LS_SESSION, null);
    if (supabase && previous?.mode === "demo" && previous.id && previous.id !== account.id) {
      // 音樂模組據此複製本機示範帳號資料；原帳號與原始收藏均不刪除。
      writeJson("yowen_demo_music_source_v1", { id: previous.id });
    }
    const value = {
      id: account.id,
      login: account.login,
      nick: account.nick ?? account.login,
      via,
      mode: authMode,
      at: Date.now(),
    };
    if (!writeJson(LS_SESSION, value)) throw new Error("這台裝置無法保存登入狀態，請檢查瀏覽器儲存權限");
    if (supabase) cloudAccount = { ...value };
  }

  function clearSession() {
    cloudAccount = null;
    lastAuthenticatedId = "";
    localStorage.removeItem(LS_SESSION);
  }

  function localAccount(target, password = "") {
    return (async () => {
      const salt = randomId("salt_");
      const kind = accountKind(target);
      return {
        id: randomId(),
        login: target,
        kind,
        salt,
        hash: password ? await passwordHash(password, salt) : "",
        hashAlgorithm: password ? "PBKDF2-SHA256-120000" : "",
        nick: kind === "phone" ? `用戶 ${target.slice(-4)}` : target.split("@")[0],
        createdAt: Date.now(),
      };
    })();
  }

  async function post(path, body) {
    let response;
    try {
      response = await fetch(API_BASE + path, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(body),
      });
    } catch {
      throw new Error("無法連接登入服務，請檢查網路後再試");
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = data.error?.message ?? data.error ?? data.message;
      throw new Error(typeof detail === "string" && detail ? detail : `登入服務回應錯誤（${response.status}）`);
    }
    return data;
  }

  function remoteAccount(data) {
    const user = data.user ?? data.account ?? data;
    if (!user?.id || !user?.login) throw new Error("登入服務缺少有效的用戶資料");
    return { id: String(user.id), login: String(user.login), nick: String(user.nick ?? user.login) };
  }

  let pendingCode = null;
  let resendAt = 0;
  let ticker = 0;

  function localCode(target, purpose) {
    const values = crypto.getRandomValues(new Uint32Array(1));
    const code = String(100000 + (values[0] % 900000));
    pendingCode = {
      login: target,
      requestId: randomId("local_"),
      code,
      purpose,
      exp: Date.now() + CODE_TTL,
      attempts: 0,
    };
    resendAt = Date.now() + CODE_RESEND * 1000;
  }

  function checkLocalCode(target, input, purpose) {
    if (!pendingCode || pendingCode.login !== target || pendingCode.purpose !== purpose) return "請先取得這個帳號的驗證碼";
    if (Date.now() > pendingCode.exp) { pendingCode = null; return "驗證碼已過期，請重新取得"; }
    if (pendingCode.attempts >= MAX_CODE_ATTEMPTS) { pendingCode = null; return "錯誤次數過多，請重新取得驗證碼"; }
    if (!/^\d{6}$/.test(String(input).trim())) return "請輸入 6 位數字驗證碼";
    if (pendingCode.code !== String(input).trim()) {
      pendingCode.attempts += 1;
      const remaining = MAX_CODE_ATTEMPTS - pendingCode.attempts;
      if (remaining <= 0) { pendingCode = null; return "錯誤次數過多，舊驗證碼已失效，請重新取得"; }
      return `驗證碼不正確，還可嘗試 ${remaining} 次`;
    }
    pendingCode = null;
    return null;
  }

  const G = {
    el: null,
    tab: "login",
    method: "password",
    oauth: null,
    busy: false,
    msg: "",
    msgOk: false,
  };

  function bootDone() { return !document.querySelector(".cy-boot, .ui-boot"); }

  async function gateLoop() {
    if (G.el || !bootDone() || session()) return;
    if (!document.getElementById("root")?.children.length) return;
    mount();
  }

  function mount() {
    if (G.el || session()) return;
    const element = document.createElement("div");
    element.className = "yid-gate";
    element.innerHTML = '<div class="yid-card" role="dialog" aria-modal="true" aria-labelledby="yidTitle"></div>';
    document.body.appendChild(element);
    G.el = element;
    render();
    ticker = window.setInterval(updateCountdown, 1000);
  }

  function unmount() {
    window.clearInterval(ticker);
    ticker = 0;
    G.el?.remove();
    G.el = null;
    G.oauth = null;
    G.busy = false;
  }

  function setMsg(text, ok = false) {
    G.msg = text;
    G.msgOk = ok;
    const message = $(".yid-msg", G.el);
    if (message) { message.textContent = text; message.classList.toggle("ok", ok); }
  }

  function render() {
    const card = $(".yid-card", G.el);
    if (!card) return;
    const keep = {};
    card.querySelectorAll("[data-f]").forEach((input) => { keep[input.dataset.f] = input.value; });
    const environment = supabase ? "SUPABASE AUTH" : API_BASE ? "REMOTE AUTH" : "LOCAL DEMO";
    card.innerHTML =
      `<div class="yid-brand"><div class="yid-logo" id="yidTitle">餘溫</div><div class="yid-sub">YOWEN ID // IDENTITY GATE</div><span class="yid-environment ${remote ? "remote" : "demo"}">${environment}</span></div>` +
      (!cloudReady
        ? '<p class="yid-notice remote" role="status">正在安全恢復登入狀態…</p>'
        : G.oauth ? oauthHtml(G.oauth) : authHtml());
    card.querySelectorAll("[data-f]").forEach((input) => {
      if (keep[input.dataset.f] != null) input.value = keep[input.dataset.f];
    });
    wire(card);
    updateCountdown();
  }

  function noticeHtml() {
    if (supabase) return '<p class="yid-notice remote">由 Supabase 處理郵箱驗證碼與登入；驗證碼只寄到你的信箱，不會顯示在畫面。</p>';
    return remote
      ? '<p class="yid-notice remote">由正式登入服務處理帳號與驗證碼；服務回應成功後才會顯示已發送。</p>'
      : '<p class="yid-notice">本機示範：不會真的發簡訊、郵件或連接 QQ／微信；帳號只保存在這台裝置。</p>';
  }

  function authHtml() {
    const accountInput = (placeholder = "+886 912345678 / name@example.com") =>
      `<label class="yid-field"><span>${supabase ? "郵箱" : "手機號或郵箱"}</span><input data-f="login" inputmode="email" placeholder="${supabase ? "name@example.com" : placeholder}" autocomplete="username" maxlength="254" /></label>`;
    const accountHint = supabase
      ? '<p class="yid-field-hint">目前雲端登入開放郵箱；手機簡訊尚未配置。</p>'
      : '<p class="yid-field-hint">手機可用國際格式、台灣 09 開頭或中國大陸 11 位號碼。</p>';
    const tabs = [["login", "登入"], ["register", "註冊"]]
      .map(([key, text]) => `<button type="button" data-tab="${key}" aria-pressed="${G.tab === key}" class="${G.tab === key ? "on" : ""}" ${G.busy ? "disabled" : ""}>${text}</button>`).join("");

    if (G.tab === "register") {
      return `<div class="yid-tabs">${tabs}</div>${noticeHtml()}` +
        accountInput() + accountHint +
        '<label class="yid-field"><span>密碼（至少 8 位，含字母與數字）</span><input data-f="pass" type="password" placeholder="設定密碼" autocomplete="new-password" maxlength="128" /></label>' +
        '<label class="yid-field"><span>確認密碼</span><input data-f="pass2" type="password" placeholder="再輸入一次" autocomplete="new-password" maxlength="128" /></label>' +
        '<label class="yid-field"><span>驗證碼</span><div class="yid-code-row"><input data-f="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]*" maxlength="6" placeholder="6 位數字" /><button type="button" data-send>發送驗證碼</button></div></label>' +
        smsHtml("register") +
        `<div class="yid-msg ${G.msgOk ? "ok" : ""}" role="status" aria-live="polite">${esc(G.msg)}</div>` +
        `<button type="button" class="yid-go" data-submit ${G.busy ? "disabled" : ""}>${G.busy ? "處理中…" : "註冊並登入"}</button>` +
        '<div class="yid-alt">已經有帳號？<button type="button" data-tab="login">直接登入</button></div>';
    }

    const methods = [
      ["password", "密碼"], ["code", "驗證碼"], ["qq", "QQ"], ["wx", "微信"],
      ...(googleOAuth ? [["google", "Google"]] : []),
    ].map(([key, text]) => `<button type="button" data-method="${key}" aria-pressed="${G.method === key}" class="${key === "qq" ? "yid-qq" : key === "wx" ? "yid-wx" : key === "google" ? "yid-google" : ""} ${G.method === key ? "on" : ""}" ${G.busy ? "disabled" : ""}>${text}</button>`).join("");
    let body = "";
    if (G.method === "password") {
      body = accountInput() +
        '<label class="yid-field"><span>密碼</span><input data-f="pass" type="password" placeholder="密碼" autocomplete="current-password" maxlength="128" /></label>';
    } else if (G.method === "code") {
      body = accountInput("用來接收驗證碼") +
        '<label class="yid-field"><span>驗證碼</span><div class="yid-code-row"><input data-f="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]*" maxlength="6" placeholder="6 位數字" /><button type="button" data-send>發送驗證碼</button></div></label>' +
        smsHtml("login");
    }
    return `<div class="yid-tabs">${tabs}</div>${noticeHtml()}<div class="yid-methods">${methods}</div>` + body +
      `<div class="yid-msg ${G.msgOk ? "ok" : ""}" role="status" aria-live="polite">${esc(G.msg)}</div>` +
      `<button type="button" class="yid-go" data-submit ${G.busy ? "disabled" : ""}>${G.busy ? "處理中…" : G.method === "code" ? "驗證並登入" : "登入"}</button>` +
      '<div class="yid-alt">第一次用？<button type="button" data-tab="register">註冊新帳號</button></div>';
  }

  function smsHtml(purpose) {
    if (remote || !pendingCode || pendingCode.purpose !== purpose || Date.now() > pendingCode.exp) return "";
    const email = accountKind(pendingCode.login) === "email";
    return '<div class="yid-sms">' +
      `<div class="yid-sms-head"><span>${email ? "模擬郵件 // MAIL" : "模擬簡訊 // SMS"}</span><span>5 分鐘內有效</span></div>` +
      `【餘溫 WARMTH】驗證碼 <b>${pendingCode.code}</b>，你正在${purpose === "register" ? "註冊" : "登入"} YOWEN ID，請勿洩露。` +
      `<div class="yid-sms-note">這不是真的${email ? "郵件" : "簡訊"}；示範驗證碼只顯示於此畫面，連續錯誤 ${MAX_CODE_ATTEMPTS} 次會失效。</div></div>`;
  }

  function oauthHtml(kind) {
    const qq = kind === "qq";
    return `<div class="yid-oauth ${kind}">` +
      `<div class="yid-oauth-logo" aria-hidden="true">${qq ? "Q" : "微"}</div>` +
      `<p>「餘溫 WARMTH」申請取得你的${qq ? " QQ " : " 微信 "}公開資料<br>（暱稱、頭像）</p>` +
      '<div class="yid-oauth-btns"><button type="button" class="yid-ghost" data-oauth-cancel>取消</button><button type="button" class="yid-go" data-oauth-ok>同意示範授權</button></div>' +
      `<div class="yid-oauth-note">本機示範：不會連接${qq ? "騰訊 QQ" : "微信"}伺服器；授權身分只保存在這台裝置，重複登入會沿用同一示範帳號。</div></div>`;
  }

  function val(name) { return $(`[data-f="${name}"]`, G.el)?.value?.trim() ?? ""; }

  function wire(card) {
    card.querySelectorAll("[data-tab]").forEach((button) => button.addEventListener("click", () => {
      G.tab = button.dataset.tab; G.msg = ""; G.oauth = null; render();
    }));
    card.querySelectorAll("[data-method]").forEach((button) => button.addEventListener("click", () => {
      const method = button.dataset.method;
      if (method === "google") { onGoogle(); return; }
      if (method === "qq" || method === "wx") {
        if (remote) {
          setMsg(`${method === "qq" ? "QQ" : "微信"}正式授權尚未配置；請先使用${supabase ? "郵箱或密碼" : "手機、郵箱或密碼"}登入`);
          return;
        }
        G.oauth = method; G.msg = ""; render(); return;
      }
      G.method = method; G.msg = ""; render();
    }));
    $("[data-send]", card)?.addEventListener("click", onSendCode);
    $("[data-submit]", card)?.addEventListener("click", onSubmit);
    $("[data-oauth-ok]", card)?.addEventListener("click", () => onOAuth(G.oauth));
    $("[data-oauth-cancel]", card)?.addEventListener("click", () => { G.oauth = null; render(); });
    card.querySelectorAll("input").forEach((input) => input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") { event.preventDefault(); onSubmit(); }
    }));
  }

  function updateCountdown() {
    if (!G.el) return;
    if (pendingCode && Date.now() > pendingCode.exp) {
      pendingCode = null;
      resendAt = 0;
      render();
      setMsg("驗證碼已過期，請重新取得");
      return;
    }
    const button = $("[data-send]", G.el);
    if (!button) return;
    const seconds = Math.max(0, Math.ceil((resendAt - Date.now()) / 1000));
    button.disabled = G.busy || seconds > 0;
    button.textContent = seconds > 0 ? `重新發送（${seconds} 秒）` : pendingCode ? "重新發送驗證碼" : "發送驗證碼";
  }

  function validPassword(password) { return password.length >= 8 && /[A-Za-z]/.test(password) && /\d/.test(password); }

  async function onSendCode() {
    if (G.busy || !cloudReady) return;
    if (supabase && !emailTarget(val("login"))) return setMsg("目前雲端登入只開放郵箱，請輸入有效郵箱");
    if (!isAccount(val("login"))) return setMsg("請輸入有效的國際手機號或郵箱");
    const target = normalizeTarget(val("login"));
    const purpose = G.tab === "register" ? "register" : "login";
    if (purpose === "register") {
      if (!validPassword(val("pass"))) return setMsg("密碼至少 8 位，且要同時包含字母與數字");
      if (val("pass") !== val("pass2")) return setMsg("兩次輸入的密碼不一致");
    }
    if (purpose === "register" && !remote && findAccount(target)) return setMsg("這個帳號已註冊，請直接登入");
    if (Date.now() < resendAt) return updateCountdown();
    G.busy = true;
    updateCountdown();
    try {
      if (supabase) {
        const provider = await cloudProvider();
        const data = await provider.requestCode({
          target, purpose, password: val("pass"),
          resend: Boolean(pendingCode?.login === target && pendingCode.purpose === purpose),
        });
        const ttl = Math.min(Math.max(Number(data.expiresIn) || 300, 30), 600);
        const wait = Math.min(Math.max(Number(data.resendAfter) || 60, 5), 300);
        pendingCode = { login: target, requestId: "supabase", code: "", purpose, exp: Date.now() + ttl * 1000, attempts: 0 };
        resendAt = Date.now() + wait * 1000;
        setMsg(`驗證碼已發送到 ${maskTarget(target)}`, true);
      } else if (API_BASE) {
        const data = await post("/code/request", { target, purpose });
        if (!data.requestId) throw new Error("發碼服務缺少 requestId");
        const ttl = Math.min(Math.max(Number(data.expiresIn) || 300, 30), 600);
        const wait = Math.min(Math.max(Number(data.resendAfter) || 60, 5), 300);
        pendingCode = { login: target, requestId: String(data.requestId), code: "", purpose, exp: Date.now() + ttl * 1000, attempts: 0 };
        resendAt = Date.now() + wait * 1000;
        setMsg(`驗證碼已發送到 ${maskTarget(target)}`, true);
      } else {
        localCode(target, purpose);
        render();
        setMsg(`本機示範驗證碼已產生（${maskTarget(target)}），並未實際發送`, true);
      }
    } catch (error) {
      setMsg(error?.message ?? String(error));
    } finally {
      G.busy = false;
      if (G.el) { render(); updateCountdown(); }
    }
  }

  async function onSubmit() {
    if (G.busy || !cloudReady) return;
    const rawLogin = val("login");
    if (supabase && !emailTarget(rawLogin)) return setMsg("目前雲端登入只開放郵箱，請輸入有效郵箱");
    if (!isAccount(rawLogin)) return setMsg("請輸入有效的手機號或郵箱");
    const target = normalizeTarget(rawLogin);
    const purpose = G.tab === "register" ? "register" : "login";

    if (purpose === "register") {
      if (!validPassword(val("pass"))) return setMsg("密碼至少 8 位，且要同時包含字母與數字");
      if (val("pass") !== val("pass2")) return setMsg("兩次輸入的密碼不一致");
      if (!remote && findAccount(target)) return setMsg("這個帳號已註冊，請直接登入");
    }
    if (G.method === "password" && purpose === "login" && !val("pass")) return setMsg("請輸入密碼");
    if ((G.method === "code" || purpose === "register") && !/^\d{6}$/.test(val("code"))) return setMsg("請輸入 6 位數字驗證碼");

    G.busy = true;
    render();
    try {
      let account;
      let via;
      if (supabase) {
        const provider = await cloudProvider();
        if (purpose === "register") {
          if (!pendingCode || pendingCode.login !== target || pendingCode.purpose !== purpose) throw new Error("請先取得這個帳號的驗證碼");
          account = await provider.register({ target, code: val("code") });
          via = "email";
        } else if (G.method === "password") {
          account = await provider.loginPassword({ target, password: val("pass") });
          via = "password";
        } else {
          if (!pendingCode || pendingCode.login !== target || pendingCode.purpose !== "login") throw new Error("請先取得這個帳號的驗證碼");
          account = await provider.loginCode({ target, code: val("code") });
          via = "code";
        }
        pendingCode = null;
      } else if (API_BASE) {
        if (purpose === "register") {
          if (!pendingCode || pendingCode.login !== target || pendingCode.purpose !== purpose) throw new Error("請先取得這個帳號的驗證碼");
          account = remoteAccount(await post("/register", { target, password: val("pass"), code: val("code"), requestId: pendingCode.requestId }));
          via = accountKind(target);
        } else if (G.method === "password") {
          account = remoteAccount(await post("/login/password", { target, password: val("pass") }));
          via = "password";
        } else {
          if (!pendingCode || pendingCode.login !== target || pendingCode.purpose !== "login") throw new Error("請先取得這個帳號的驗證碼");
          account = remoteAccount(await post("/login/code", { target, code: val("code"), requestId: pendingCode.requestId }));
          via = "code";
        }
        pendingCode = null;
      } else if (purpose === "register") {
        const error = checkLocalCode(target, val("code"), "register");
        if (error) throw new Error(error);
        account = await localAccount(target, val("pass"));
        if (!saveAccount(account)) throw new Error("無法保存本機帳號");
        via = accountKind(target);
      } else if (G.method === "password") {
        account = findAccount(target);
        if (!account) throw new Error("找不到這個帳號，請先註冊");
        if (!account.hash) throw new Error("這個帳號沒有設定密碼，請使用驗證碼或原授權方式登入");
        const actual = account.hashAlgorithm === "PBKDF2-SHA256-120000"
          ? await passwordHash(val("pass"), account.salt)
          : await legacyHash(account.salt + val("pass"));
        if (actual !== account.hash) throw new Error("帳號或密碼不正確");
        via = "password";
      } else {
        const error = checkLocalCode(target, val("code"), "login");
        if (error) throw new Error(error);
        account = findAccount(target);
        if (!account) {
          account = await localAccount(target);
          if (!saveAccount(account)) throw new Error("無法保存本機帳號");
        }
        via = "code";
      }
      setSession(account, via);
      afterAuth(account, via);
    } catch (error) {
      setMsg(error?.message ?? String(error));
    } finally {
      G.busy = false;
      if (G.el) render();
    }
  }

  async function onGoogle() {
    if (G.busy || !cloudReady || !googleOAuth) return;
    G.busy = true;
    setMsg("正在前往 Google 授權…", true);
    render();
    try {
      await (await cloudProvider()).loginGoogle();
    } catch (error) {
      setMsg(error?.message ?? String(error));
    } finally {
      G.busy = false;
      if (G.el) render();
    }
  }

  function onOAuth(kind) {
    if (G.busy || remote || !["qq", "wx"].includes(kind)) return;
    const identities = readJson(LS_OAUTH, {});
    if (!identities[kind]) identities[kind] = randomId(`${kind}_`);
    const identity = identities[kind];
    writeJson(LS_OAUTH, identities);
    const login = `${kind}:${identity}`;
    let account = accounts().find((item) => item.login === login);
    if (!account) {
      account = {
        id: randomId(), login, kind, salt: "", hash: "", hashAlgorithm: "",
        nick: `${kind === "qq" ? "QQ" : "微信"}示範用戶`, createdAt: Date.now(),
      };
      if (!saveAccount(account)) return setMsg("無法保存本機示範帳號");
    }
    try { setSession(account, kind); afterAuth(account, kind); } catch (error) { setMsg(error.message); }
  }

  function afterAuth(account, via) {
    unmount();
    if (lastAuthenticatedId === account.id) return;
    lastAuthenticatedId = account.id;
    document.dispatchEvent(new CustomEvent("yowen:authenticated", {
      detail: { id: account.id, login: account.login, nick: account.nick, via, mode: authMode },
    }));
  }

  function emitLogout(previous) {
    document.dispatchEvent(new CustomEvent("yowen:logout", {
      detail: { id: previous?.id ?? "", login: previous?.login ?? "" },
    }));
  }

  function resetGate() {
    pendingCode = null;
    resendAt = 0;
    G.tab = "login";
    G.method = "password";
    G.msg = "";
    unmount();
    if (bootDone()) mount();
  }

  async function logout() {
    const previous = session();
    if (supabase) {
      try { await (await cloudProvider()).logout(); } catch { /* 本機仍要登出 */ }
    } else if (API_BASE) {
      try { await post("/logout", {}); } catch { /* 本機仍要登出 */ }
    }
    clearSession();
    emitLogout(previous);
    resetGate();
  }

  function onCloudAuthEvent(event, account) {
    if (event === "INITIAL_SESSION" || (event === "SIGNED_IN" && G.busy)) return;
    if (event === "SIGNED_OUT") {
      const previous = session();
      if (!previous && G.el) return; // 手動登出已完成，忽略隨後送達的重複事件。
      clearSession();
      emitLogout(previous);
      resetGate();
      return;
    }
    if (!account || !["SIGNED_IN", "TOKEN_REFRESHED", "USER_UPDATED"].includes(event)) return;
    const previous = session();
    const via = previous?.id === account.id ? previous.via : "code";
    try {
      setSession(account, via);
      afterAuth(account, via);
    } catch (error) { setMsg(error?.message ?? String(error)); }
  }

  async function initializeAuth() {
    if (!supabase) { schedule(); return; }
    schedule();
    try {
      const provider = await cloudProvider();
      const account = await provider.restore();
      cloudReady = true;
      if (account) {
        const previous = readJson(LS_SESSION, null);
        const via = previous?.id === account.id ? previous.via : "code";
        setSession(account, via);
        afterAuth(account, via);
      } else {
        clearSession();
        schedule();
        if (G.el) render();
      }
      // 恢復完成後才訂閱，避免 INITIAL_SESSION 重複觸發私人資料遷移。
      provider.subscribe(onCloudAuthEvent).catch(() => {});
    } catch (error) {
      cloudReady = true;
      clearSession();
      G.msg = `無法恢復 Supabase 登入：${error?.message ?? String(error)}`;
      schedule();
      if (G.el) render();
    }
  }

  window.YowenID = Object.freeze({
    logout,
    session: () => ({ ...session() }),
    normalizeTarget,
    ready: () => readyPromise ?? Promise.resolve(),
    mode: authMode,
  });

  let scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => { scheduled = false; gateLoop().catch(() => {}); }, 300);
  }
  const observer = new MutationObserver(() => { if (!G.el) schedule(); });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener("DOMContentLoaded", schedule, { once: true });
  readyPromise = initializeAuth();
})();
