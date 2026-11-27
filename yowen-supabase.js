/* YOWEN ID × Supabase Auth
   瀏覽器只接受 project URL 與 publishable／anon key；嚴禁 secret／service-role key。
   正式寄信、OTP 時效與重發限制由 Supabase 專案設定控制。 */
(() => {
  "use strict";

  const DEFAULT_LIBRARY_URL = "./vendor/supabase-js.2.119.2.js";
  const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const clean = value => String(value ?? "").trim();

  function assertPublicKey(key) {
    if (/^(?:sb_secret_|service_role)/i.test(key)) throw new Error("Supabase 前端不可使用 secret 或 service-role key");
    const parts = key.split(".");
    if (parts.length !== 3) return;
    let payload;
    try {
      const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
      payload = JSON.parse(decodeURIComponent(escape(atob(base64))));
    } catch { throw new Error("Supabase anon key 格式無效"); }
    if (payload.role === "service_role") throw new Error("Supabase 前端不可使用 service-role key");
    if (payload.role && payload.role !== "anon") throw new Error("Supabase 前端只接受 anon 或 publishable key");
  }

  function translated(error) {
    const code = clean(error?.code ?? error?.error_code);
    const status = Number(error?.status ?? error?.statusCode ?? 0);
    const original = clean(error?.message ?? error);
    if (status === 429 || /rate_limit/i.test(code)) return new Error("發送太頻繁，請稍後再試");
    if (code === "invalid_credentials" || /invalid login credentials/i.test(original)) return new Error("郵箱或密碼不正確");
    if (code === "email_not_confirmed") return new Error("郵箱尚未驗證，請先使用驗證碼登入");
    if (code === "user_not_found") return new Error("找不到這個郵箱帳號，請先註冊");
    if (code === "user_already_exists" || /already registered/i.test(original)) return new Error("這個郵箱已註冊，請直接登入");
    if (/otp_expired|invalid_otp/i.test(code) || /token has expired|invalid token/i.test(original)) return new Error("驗證碼不正確或已過期，請重新取得");
    if (/failed to fetch|networkerror|load failed/i.test(original)) return new Error("無法連接 Supabase 登入服務，請檢查網路後再試");
    return new Error(original || "Supabase 登入服務回應錯誤");
  }

  function unwrap(result) {
    if (result?.error) throw translated(result.error);
    return result?.data ?? {};
  }

  function accountFrom(user) {
    if (!user?.id) return null;
    const login = clean(user.email ?? user.phone).toLowerCase();
    if (!login) return null;
    return {
      id: String(user.id), login,
      nick: clean(user.user_metadata?.nick ?? user.user_metadata?.name ?? user.user_metadata?.full_name) || login.split("@")[0],
    };
  }

  function authenticatedAccount(data) {
    if (!data?.session) throw new Error("登入成功但沒有建立有效會話，請檢查 Supabase Auth 設定");
    const account = accountFrom(data.user ?? data.session.user);
    if (!account) throw new Error("Supabase 沒有回傳有效的用戶資料");
    return account;
  }

  function create(configuration = {}) {
    const url = clean(configuration.supabaseUrl).replace(/\/+$/, "");
    const key = clean(configuration.supabasePublishableKey ?? configuration.supabaseAnonKey);
    if (!url || !key) throw new Error("Supabase 尚未填寫 project URL 與 publishable key");
    let parsed;
    try { parsed = new URL(url); } catch { throw new Error("Supabase project URL 格式無效"); }
    const local = ["localhost", "127.0.0.1"].includes(parsed.hostname);
    if (parsed.protocol !== "https:" && !local) throw new Error("Supabase project URL 必須使用 HTTPS");
    assertPublicKey(key);

    const redirectTo = clean(configuration.redirectTo) || `${window.location.origin}${window.location.pathname}`;
    const storageKey = clean(configuration.storageKey) || "yowen_supabase_auth_v1";
    let clientPromise = null;

    async function loadFactory() {
      if (typeof configuration.createClient === "function") return configuration.createClient;
      if (typeof window.supabase?.createClient === "function") return window.supabase.createClient;
      await new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = clean(configuration.supabaseJsUrl) || DEFAULT_LIBRARY_URL;
        script.async = true;
        script.dataset.yowenSupabase = "2.119.2";
        script.onload = resolve;
        script.onerror = () => reject(new Error("Supabase 登入元件載入失敗，請檢查網路或重新整理"));
        document.head.appendChild(script);
      });
      if (typeof window.supabase?.createClient !== "function") throw new Error("Supabase 登入元件格式無效");
      return window.supabase.createClient;
    }

    async function client() {
      if (!clientPromise) {
        clientPromise = (async () => {
          const factory = await loadFactory();
          return factory(url, key, { auth: {
            persistSession: true, autoRefreshToken: true, detectSessionInUrl: true,
            flowType: "pkce", storageKey,
          } });
        })().catch(error => { clientPromise = null; throw translated(error); });
      }
      return clientPromise;
    }

    function requireEmail(target) {
      const email = clean(target).toLowerCase();
      if (!EMAIL_PATTERN.test(email)) throw new Error("目前雲端登入只開放郵箱；手機簡訊尚未配置");
      return email;
    }

    async function requestCode({ target, purpose, password = "", resend = false }) {
      const email = requireEmail(target);
      const auth = (await client()).auth;
      if (purpose === "register") {
        if (resend) {
          unwrap(await auth.resend({ type: "signup", email, options: { emailRedirectTo: redirectTo } }));
        } else {
          const data = unwrap(await auth.signUp({ email, password, options: { emailRedirectTo: redirectTo } }));
          if (data.session) {
            await auth.signOut({ scope: "local" }).catch(() => {});
            throw new Error("請先在 Supabase 啟用 Confirm email，再使用郵箱驗證碼註冊");
          }
        }
      } else if (purpose === "login") {
        unwrap(await auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: redirectTo } }));
      } else throw new Error("不支援的驗證碼用途");
      return { expiresIn: 300, resendAfter: 60 };
    }

    async function register({ target, code }) {
      const data = unwrap(await (await client()).auth.verifyOtp({ email: requireEmail(target), token: clean(code), type: "email" }));
      return authenticatedAccount(data);
    }

    async function loginPassword({ target, password }) {
      const data = unwrap(await (await client()).auth.signInWithPassword({ email: requireEmail(target), password: String(password ?? "") }));
      return authenticatedAccount(data);
    }

    async function loginCode({ target, code }) {
      const data = unwrap(await (await client()).auth.verifyOtp({ email: requireEmail(target), token: clean(code), type: "email" }));
      return authenticatedAccount(data);
    }

    async function loginGoogle() {
      const data = unwrap(await (await client()).auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo },
      }));
      if (!clean(data.url)) throw new Error("Google 登入沒有回傳授權網址");
      return { url: clean(data.url) };
    }

    async function restore() {
      const data = unwrap(await (await client()).auth.getSession());
      return accountFrom(data.session?.user);
    }

    async function subscribe(callback) {
      const auth = (await client()).auth;
      const result = auth.onAuthStateChange((event, session) => {
        const account = accountFrom(session?.user);
        // 不在 Supabase 回呼中 await 其他 Auth API，避免官方文件所述死鎖。
        setTimeout(() => callback(event, account), 0);
      });
      return () => result?.data?.subscription?.unsubscribe?.();
    }

    async function logout() { unwrap(await (await client()).auth.signOut({ scope: "local" })); }

    return Object.freeze({ requestCode, register, loginPassword, loginCode, loginGoogle, restore, subscribe, logout });
  }

  window.YowenSupabaseAuth = Object.freeze({ create });
})();
