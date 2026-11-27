/* 餘溫音樂私人資料：帳號隔離、一次性舊資料歸屬與首次雲端遷移。
   只複製資料，不刪除原始 localStorage 或 IndexedDB 內容。 */
(() => {
  "use strict";

  const MIGRATION_KEY = "yw_music_legacy_owner_v1";
  const CLOUD_MIGRATION_KEY = "yw_music_cloud_migration_v1";
  const DEMO_SOURCE_KEY = "yowen_demo_music_source_v1";
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
  function cloudMarker() {
    const value = readJson(CLOUD_MIGRATION_KEY, null);
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

  /* 同裝置只有第一個 Supabase 帳號能複製目前 demo 帳號的私人音樂資料。 */
  function claimCloud(ownerId, sourceId = "") {
    const id = cleanId(ownerId);
    if (!id) return null;
    let owned = cloudMarker();
    if (owned) return owned;
    const savedSource = cleanId(readJson(DEMO_SOURCE_KEY, null)?.id);
    const legacySource = cleanId(marker()?.ownerId);
    const source = cleanId(sourceId) || savedSource || (legacySource !== id ? legacySource : "");
    owned = {
      ownerId: id,
      sourceOwnerId: source !== id ? source : "",
      claimedAt: Date.now(),
      tracksMigratedAt: 0,
    };
    if (!owned.sourceOwnerId) owned.tracksMigratedAt = Date.now();
    if (!writeJson(CLOUD_MIGRATION_KEY, owned)) return null;
    if (owned.sourceOwnerId) {
      for (const base of LEGACY_KEYS) {
        try {
          const original = localStorage.getItem(key(base, owned.sourceOwnerId));
          const scoped = key(base, id);
          if (original !== null && localStorage.getItem(scoped) === null) {
            localStorage.setItem(scoped, original);
          }
        } catch { /* 保留來源與目標現有資料，下一次登入可再補齊缺失副本 */ }
      }
    }
    return owned;
  }

  function activate(ownerId, context = {}) {
    activeId = cleanId(ownerId);
    if (activeId) {
      claimLegacy(activeId);
      if (context?.mode === "supabase") claimCloud(activeId, context.sourceId);
    }
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
  function cloudTrackMigration() {
    const owned = cloudMarker();
    return owned && !owned.tracksMigratedAt && owned.sourceOwnerId ? owned : null;
  }
  function cloudTrackId(trackId, ownerId = activeId) {
    return `cloud:${encodeURIComponent(cleanId(ownerId))}:${String(trackId)}`;
  }
  function finishCloudTrackMigration(ownerId, idMap = {}) {
    const owned = cloudMarker();
    const id = cleanId(ownerId);
    if (!owned || owned.ownerId !== id) return;
    const audio = read("yw_audio_v1", {}, id);
    if (audio && idMap[audio.currentId]) {
      write("yw_audio_v1", { ...audio, currentId: idMap[audio.currentId] }, id);
    }
    for (const base of ["yw_music_history_v1", "yw_music_pending_recs"]) {
      const entries = read(base, [], id);
      if (Array.isArray(entries)) {
        write(base, entries.map(item => idMap[item?.id] ? { ...item, id: idMap[item.id] } : item), id);
      }
    }
    writeJson(CLOUD_MIGRATION_KEY, { ...owned, tracksMigratedAt: Date.now() });
  }

  const initialSession = window.YowenID?.session();
  activate(initialSession?.id, initialSession);
  // 先於播放器與陪伴模組接收事件，確保它們讀到已完成歸屬設定的帳號資料。
  document.addEventListener("yowen:authenticated", event => activate(event.detail?.id, event.detail));
  document.addEventListener("yowen:logout", () => activate(""));
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
    cloudTrackMigration,
    cloudTrackId,
    finishCloudTrackMigration,
    migrationKey: MIGRATION_KEY,
    cloudMigrationKey: CLOUD_MIGRATION_KEY,
  });
})();
