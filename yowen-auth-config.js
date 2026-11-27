/* 公開前端設定：只能放 project URL 與 publishable key，禁止放 SMTP／secret key。 */
window.YOWEN_AUTH_CONFIG = Object.freeze(window.YOWEN_AUTH_CONFIG ?? {
  provider: "supabase",
  googleOAuthEnabled: false,
  supabaseUrl: "https://lsgxrixqabdtlabjqyuz.supabase.co",
  supabasePublishableKey: "sb_publishable_a2uhQo-ZoX7coK5-bk_RRw_JVDyamdb",
});
