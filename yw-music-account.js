/* 餘溫音樂私人資料：帳號隔離與一次性舊資料歸屬。
   只負責儲存鍵與遷移標記；音檔仍保存在既有 IndexedDB，不另建曲庫。 */
(() => {
  "use strict";

  const MIGRATION_KEY = "yw_music_legacy_owner_v1";
  const LEGACY_KEYS = [
    "yw_audio_v1",
    "yw_music_companion_v1",
    "yw_music_history_v1",
    "yw_music_pending_recs",
  ];
  let activeId = "";

  function readJson(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
  }
  function writeJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
  }
  function cleanId(value) {
    const id = String(value ?? "").trim();
    return id && id !== "undefined" && id !== "null" ? id : "";
  }
  function key(base, ownerId = activeId) {
    const id = cleanId(ownerId);
    return id ? `${base}:account:${encodeURIComponent(id)}` : "";
  }
  function marker() {
    const value = readJson(MIGRATION_KEY, null);
    return value && cleanId(value.ownerId) ? value : null;
  }

  /* 全域只有一個 legacy 擁有者。即使之後登入其他帳號，也不能再認領舊資料。 */
  function claimLegacy(ownerId) {
    const id = cleanId(ownerId);
    if (!id) return null;
    let owned = marker();
    if (!owned) {
      owned = { ownerId: id, claimedAt: Date.now(), tracksMigratedAt: 0 };
      if (!writeJson(MIGRATION_KEY, owned)) return null;
      for (const base of LEGACY_KEYS) {
        try {
          const legacy = localStorage.getItem(base);
          const scoped = key(base, id);
          if (legacy !== null && localStorage.getItem(scoped) === null) {
            localStorage.setItem(scoped, legacy);
          }
        } catch { /* 儲存不可用時不清除舊資料，也不影響登入 */ }
      }
    }
    return owned;
  }

  function activate(ownerId) {
    activeId = cleanId(ownerId);
    if (activeId) claimLegacy(activeId);
    return activeId;
  }
  function read(base, fallback, ownerId = activeId) {
    const scoped = key(base, ownerId);
    return scoped ? readJson(scoped, fallback) : fallback;
  }
  function write(base, value, ownerId = activeId) {
    const scoped = key(base, ownerId);
    return scoped ? writeJson(scoped, value) : false;
  }
  function owns(track, ownerId = activeId) {
    const id = cleanId(ownerId);
    return Boolean(id && track && track.ownerId === id);
  }
  function withOwner(track, ownerId = activeId) {
    const id = cleanId(ownerId);
    if (!id) throw new Error("請先登入，再保存私人音樂資料");
    return { ...track, ownerId: id };
  }
  function trackMigrationOwner() {
    const owned = marker();
    return owned && !owned.tracksMigratedAt ? owned.ownerId : "";
  }
  function finishTrackMigration(ownerId) {
    const owned = marker();
    if (!owned || owned.ownerId !== cleanId(ownerId)) return;
    writeJson(MIGRATION_KEY, { ...owned, tracksMigratedAt: Date.now() });
  }

  activate(window.YowenID?.session()?.id);
  window.YWMusicAccount = Object.freeze({
    get id() { return activeId; },
    key,
    activate,
    read,
    write,
    owns,
    withOwner,
    trackMigrationOwner,
    finishTrackMigration,
    migrationKey: MIGRATION_KEY,
  });
})();
