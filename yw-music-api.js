/* 餘溫音樂陪伴 API installer：掛進既有頁內 Hono，沿用角色、對話與 AI 生成管線。
   端點：POST /api/conversations/:id/music-nudge
   - recommend：角色主動把歌曲推薦卡發進聊天室，再用 AI 生成一段推薦理由
   - comment  ：就指定曲目，由角色依人設與對話脈絡發表看法
   - lyrics   ：就使用者自行匯入的歌詞節錄，討論意象與含義（不整段複述）
   不建立平行資料層；歌曲卡 enrich 走既有 ISA／hY 管線。 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.YWMusicAPI = api;
})(typeof self !== "undefined" ? self : globalThis, function () {
  "use strict";

  const MODES = new Set(["recommend", "comment", "lyrics"]);
  const MUSIC_MODEL = "music_v2_5";
  const MUSIC_MIN_MS = 3000;
  const MUSIC_MAX_MS = 300000;

  function composeInput(body) {
    const prompt = String(body?.prompt ?? "").trim();
    const musicLengthMs = Number(body?.musicLengthMs);
    if ([...prompt].length < 4 || [...prompt].length > 2000) {
      return { error: "請輸入 4–2000 字的音樂提示，描述情緒、曲風、節奏與想聽到的聲音。" };
    }
    if (!Number.isInteger(musicLengthMs) || musicLengthMs < MUSIC_MIN_MS || musicLengthMs > MUSIC_MAX_MS) {
      return { error: "音樂長度需為 3–300 秒之間的整數毫秒。" };
    }
    if (body?.instrumental != null && typeof body.instrumental !== "boolean") {
      return { error: "純音樂選項格式不正確。" };
    }
    return { prompt, musicLengthMs, instrumental: body?.instrumental === true };
  }

  function upstreamMessage(status, detail) {
    if (status === 401 || status === 403) return "ElevenLabs 金鑰無效或沒有音樂生成權限，請檢查金鑰與帳戶方案。";
    if (status === 429) return "ElevenLabs 額度不足或請求太頻繁，請查看用量後再試。";
    if (status === 400 || status === 422) return `ElevenLabs 無法接受這個創作請求${detail ? `：${detail}` : "，請調整提示或時長。"}`;
    return `Eleven Music 暫時無法生成（上游狀態 ${status}），請稍後再試。`;
  }

  function install(app, ctx, d) {
    if (!app || app.__ywMusicInstalled) return;
    app.__ywMusicInstalled = true;

    app.post("/api/music/compose", async (c) => {
      const input = composeInput(await c.req.json().catch(() => ({})));
      if (input.error) return c.json({ error: input.error }, 400);
      const saved = ctx.db.getSetting("voice_keys", {});
      const key = ctx.box.decrypt(saved.elevenlabsKey) || ctx.cfg.tts.elevenlabsKey;
      if (!key) return c.json({ error: "尚未設定 ElevenLabs API Key，請先到「音色」保存金鑰。" }, 503);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 180000);
      try {
        const upstream = await fetch("https://api.elevenlabs.io/v1/music", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "xi-api-key": key,
            accept: "audio/mpeg",
          },
          body: JSON.stringify({
            prompt: input.prompt,
            music_length_ms: input.musicLengthMs,
            instrumental: input.instrumental,
            model_id: MUSIC_MODEL,
            output_format: "mp3_48000_192",
          }),
          signal: controller.signal,
        });
        if (!upstream.ok) {
          const payload = await upstream.json().catch(() => null);
          const detail = String(payload?.detail?.message ?? payload?.detail ?? payload?.message ?? "").trim().slice(0, 240);
          return c.json({ error: upstreamMessage(upstream.status, detail) }, upstream.status === 429 ? 429 : 502);
        }
        const bytes = new Uint8Array(await upstream.arrayBuffer());
        if (!bytes.length) return c.json({ error: "Eleven Music 回傳了空白音檔，請再試一次。" }, 502);
        if (bytes.length > 25 * 1024 * 1024) return c.json({ error: "生成的音檔超過本機收藏上限 25MB。" }, 502);
        return new Response(bytes, {
          status: 200,
          headers: {
            "content-type": "audio/mpeg",
            "cache-control": "no-store",
            "x-music-model": MUSIC_MODEL,
          },
        });
      } catch (error) {
        const timedOut = error?.name === "AbortError";
        console.error("[music-compose]", timedOut ? "timeout" : error?.message ?? error);
        return c.json({ error: timedOut ? "生成等待超過 3 分鐘，請稍後再試；費用與生成狀態請以 ElevenLabs 帳戶為準。" : "連不上 Eleven Music，請檢查網路後再試。" }, timedOut ? 504 : 502);
      } finally {
        clearTimeout(timeout);
      }
    });

    app.post("/api/conversations/:id/music-nudge", async (c) => {
      const body = await c.req.json().catch(() => ({}));
      const conv = d.conversation(ctx.db, c.req.param("id"));
      if (!conv) return c.json({ error: "找不到對話" }, 404);
      if (conv.type === "group") return c.json({ error: "目前只支援單人聊天室" }, 400);
      const character = d.character(ctx.db, conv.members?.[0]);
      if (!character) return c.json({ error: "找不到角色" }, 404);
      if (!MODES.has(body.mode)) return c.json({ error: "未知模式" }, 400);

      const title = String(body.title ?? "").trim().slice(0, 100);
      const artist = String(body.artist ?? "").trim().slice(0, 80);
      if (!title) return c.json({ error: "缺少曲名" }, 400);
      const who = artist ? `《${title}》（${artist}）` : `《${title}》`;
      let note = "";

      if (body.mode === "recommend") {
        // 角色主動發出的音樂推薦卡（sender 是角色，不冒充使用者）
        const msg = d.writeMessage(ctx, {
          conversationId: conv.id,
          sender: character.id,
          kind: "action",
          content: `想跟你分享一首歌：${title}${artist ? ` - ${artist}` : ""}`,
          meta: {
            action: { type: "music", title, artist: artist || undefined },
            song: d.songMeta(title, artist || undefined),
          },
        });
        d.enrichSong(ctx, msg.id, title, artist); // 背景補封面／試聽，失敗不影響卡片
        note =
          `你剛剛主動把歌曲${who}的分享卡片傳給對方，想推薦給對方聽。` +
          `用你自己的性格說一段推薦理由：為什麼這首歌讓你想到對方，或符合你們最近的對話氣氛。` +
          `不確定自己是否熟悉這首歌就坦白說是憑直覺或資料推薦，不要編造你聽過它的事實或假樂評。`;
      } else if (body.mode === "comment") {
        note =
          `對方正在聽${who}，想聽聽你的看法。` +
          `根據你對這首歌的認識與你們最近的對話，用你自己的性格發表對這首歌的觀點（曲風、氛圍、歌詞意象皆可）。` +
          `如果你不知道這首歌，就坦白說不熟，請對方分享聽感；不要編造歌曲細節、發行年份或假裝聽過。`;
      } else {
        const excerpt = String(body.lyricsExcerpt ?? "").trim().slice(0, 220);
        if (!excerpt) return c.json({ error: "這首歌還沒有可討論的歌詞" }, 400);
        note =
          `對方提供了${who}的幾段歌詞節錄（對方自行匯入的內容）：「${excerpt}」。` +
          `用你自己的性格聊聊這些歌詞的意象與含義，可以連結你們的關係或最近聊過的事。` +
          `最多引用其中一句，不要整段複述歌詞；不熟這首歌就聚焦在文字本身，不要假裝知道創作背景。`;
      }

      d.generate(ctx, { conv, character, directorNote: note })
        .catch((e) => console.error("[music-nudge]", e));
      return c.json({ ok: true });
    });
  }

  return { install };
});
