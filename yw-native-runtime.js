/* 原生 App 小型橋接：瀏覽器不啟用；Android／iOS 由 Capacitor 注入。 */
(() => {
  "use strict";
  const capacitor = window.Capacitor;
  if (!capacitor?.isNativePlatform?.()) return;
  const platform = capacitor.getPlatform();
  document.documentElement.classList.add("yw-native-app", `yw-native-${platform}`);
  document.documentElement.dataset.nativePlatform = platform;

  const app = capacitor.Plugins?.App;
  app?.addListener("backButton", () => {
    if (document.querySelector("#ywcHistory")) {
      window.__ywMusicCompanion?.closeHistory();
      return;
    }
    if (window.__ywAudio?.open) {
      window.__ywAudio.back();
      return;
    }
    const hash = location.hash;
    if (hash && !["#/", "#/home", "#/city"].includes(hash)) {
      history.back();
      return;
    }
    app.exitApp();
  });
})();
