/* WARMTH B14：安裝到現有頁內 Hono；所有資料與金流仍走原角色、錢包、約會與住家。 */
((root) => {
  "use strict";

  class CohabError extends Error {
    constructor(status, message) { super(message); this.status = status; }
  }
  const fail = (status, message) => { throw new CohabError(status, message); };
  const money = (value) => Math.max(0, Math.round(Number(value) || 0));
  const text = (value, max = 120) => String(value ?? "").trim().slice(0, max);

  /* 先依分攤模式付款，再由仍有餘額的一方補足；回傳雙向代墊，不無中生有。 */
  function allocatePayment(total, mode, userWallet, taWallet, userIncome, taIncome, C) {
    const amount = money(total);
    const target = C.shares(amount, mode, userIncome, taIncome);
    let user = Math.min(money(userWallet), target.user);
    let ta = Math.min(money(taWallet), target.ta);
    let remaining = amount - user - ta;
    const userExtra = Math.min(money(userWallet) - user, remaining);
    user += userExtra; remaining -= userExtra;
    const taExtra = Math.min(money(taWallet) - ta, remaining);
    ta += taExtra; remaining -= taExtra;
    return {
      user, ta, shortfall: remaining,
      userAdvance: Math.max(0, user - target.user),
      taAdvance: Math.max(0, ta - target.ta),
      target,
    };
  }

  function install(app, ctx, d) {
    const C = root.YWCohabCore;
    if (!C) throw new Error("B14 core 尚未載入");
    const now = () => ctx.now();
    const char = (id) => d.character(ctx.db, id);
    const load = (id) => {
      const ch = char(id);
      if (!ch) fail(404, "找不到角色");
      return C.normalizeState(ch.data?.cohabit);
    };
    const save = (id, state) => {
      d.updateCharacter(ctx, id, { data: { cohabit: C.normalizeState(state) } });
      return load(id);
    };
    const profileIncome = () => {
      const p = d.profile(ctx.db);
      return Number(p.monthlyIncome ?? p.income ?? p.salary) || 0;
    };
    const taIncome = (ch) => Number(ch.data?.monthlyIncome ?? ch.data?.economy?.monthlyIncome ?? String(ch.data?.economy?.incomeTier ?? "").replace(/[^0-9.]/g, "")) || 0;
    const hasPet = (id) => !!ctx.db.getSetting(`pet:${id}`, null);
    const actionKey = (body, prefix, required = true) => {
      const id = text(body?.actionId, 100);
      if (required && id.length < 8) fail(400, "缺少操作識別碼，請重新整理後再試");
      return id ? `${prefix}:${id}` : null;
    };
    const seen = (s, key) => !!key && s.actionIds.includes(key);
    const mark = (s, key) => { if (key && !s.actionIds.includes(key)) s.actionIds.push(key); };
    const eligibility = (id) => {
      const rel = d.relationship(ctx, id);
      const days = rel.stageSince > 0 ? Math.max(0, Math.floor((now().getTime() - rel.stageSince) / C.DAY)) : 0;
      const stageReady = rel.enabled && rel.stage >= 4 && !!rel.unlocks?.cohabit?.open;
      return {
        allowed: stageReady && days >= 14,
        stageReady, stage: rel.stage, stageName: rel.stageName, days,
        remainingDays: Math.max(0, 14 - days),
        hint: !stageReady ? "關係到「戀人／至親」後，才能提議同住" : days < 14 ? `目前關係階段還需要滿 14 天，再等 ${14 - days} 天` : "可以提議同住了",
      };
    };
    const snapshot = (id, state = null) => {
      const ch = char(id);
      if (!ch) fail(404, "找不到角色");
      const s = state || load(id);
      let city = null;
      try { city = d.cityMe(ctx); } catch { city = null; }
      return {
        state: s,
        character: { id: ch.id, name: ch.name, avatar: ch.avatar, wallet: ch.wallet },
        relationship: d.relationship(ctx, id),
        eligibility: eligibility(id),
        wallet: { user: d.userBalance(ctx), ta: ch.wallet, joint: s.jointBalance, currency: "free" },
        houses: C.HOUSES,
        recipes: C.RECIPES,
        chores: C.CHORES,
        frictions: C.FRICTIONS,
        splitModes: C.SPLIT_MODES,
        home: d.home(ctx, id),
        date: d.dateView(ctx, id),
        careNeeded: !!(city?.player?.sick || city?.warn?.health),
        generatedAt: now().getTime(),
      };
    };
    const message = (id, sender, kind, content, meta = {}) => d.writeMessage(ctx, {
      conversationId: d.conversation(ctx, id).id, sender, kind, content, meta,
    });
    const director = async (id, note) => {
      try { return await d.react(ctx, id, note); }
      catch (error) { console.error("[cohab:reply]", error?.message || error); return []; }
    };
    const duplicate = (c, id, s) => c.json({ ...snapshot(id, s), duplicate: true });
    const handler = (fn) => async (c) => {
      try {
        const body = c.req.method === "GET" ? {} : await c.req.json().catch(() => ({}));
        return await fn(c, body || {});
      } catch (error) {
        const status = error instanceof CohabError ? error.status : 500;
        if (status === 500) console.error("[cohab]", error);
        return c.json({ error: text(error?.message, 240) || "同居功能暫時無法使用" }, status);
      }
    };
    const active = (s, allowMoving = false) => {
      if (!allowMoving && s.status !== "active") fail(409, "搬進新家後才能使用這項功能");
      if (allowMoving && !["moving", "active"].includes(s.status)) fail(409, "目前沒有進行中的同住生活");
    };
    const noDate = (id) => { if (d.currentDate(ctx, id)) fail(409, "請先結束目前的約會"); };

    function changeTaWallet(id, delta, kind, note) {
      const ch = char(id);
      const amount = Math.round(Math.abs(delta));
      if (!amount) return;
      if (delta < 0 && ch.wallet < amount) fail(409, "TA 的餘額不足");
      ctx.db.run("UPDATE characters SET wallet = wallet + ? WHERE id = ?", Math.round(delta), id);
      ctx.db.run("INSERT INTO wallet_tx(id, character_id, direction, kind, amount, note, created_at) VALUES(?,?,?,?,?,?,?)",
        d.id("tx_"), id, delta > 0 ? "to_char" : "from_char", kind, amount, text(note, 160), now().getTime());
    }

    /* 在 db.tx 內呼叫；共同帳戶先付，不足再分攤，所有費用一次寫成功或全部 rollback。 */
    function settleBill(id, s, bill, key = null) {
      if (seen(s, key)) return { duplicate: true };
      const ch = char(id);
      const total = money(bill.total);
      const jointUsed = s.splitMode === "joint" ? Math.min(money(s.jointBalance), total) : 0;
      const remaining = total - jointUsed;
      const mode = s.splitMode === "joint" ? "aa" : s.splitMode;
      const pay = allocatePayment(remaining, mode, d.userBalance(ctx), ch.wallet, profileIncome(), taIncome(ch), C);
      if (pay.shortfall > 0) fail(409, `家庭帳戶與雙方錢包還差 ${pay.shortfall} 霓幣`);
      if (jointUsed) s.jointBalance -= jointUsed;
      if (pay.user) d.adjustUserBalance(ctx, -pay.user, "b9_cohab_bill", { ref: bill.id, note: `${bill.month} 家庭帳單` });
      if (pay.ta) changeTaWallet(id, -pay.ta, "cohab_bill", `${bill.month} 家庭帳單`);
      s.debt += pay.taAdvance;
      s.taDebt += pay.userAdvance;
      Object.assign(bill, {
        status: "paid", paidAt: now().getTime(), outstanding: 0, splitMode: s.splitMode,
        jointUsed, userPaid: pay.user, taPaid: pay.ta, userAdvance: pay.userAdvance, taAdvance: pay.taAdvance,
      });
      mark(s, key);
      d.footprint(ctx, id, "cohab_bill", `${bill.month} 家庭帳單已分攤`, `你 ${pay.user}・TA ${pay.ta}・共同帳戶 ${jointUsed}`);
      message(id, "system", "cohab_bill", `${bill.month} 家庭帳單 ${total} 霓幣已結清：你 ${pay.user}、TA ${pay.ta}、共同帳戶 ${jointUsed}。`, {
        cohabit: { billId: bill.id, month: bill.month, total, userPaid: pay.user, taPaid: pay.ta, jointUsed, debt: s.debt },
      });
      return { duplicate: false };
    }

    function refresh(id) {
      let s = load(id);
      const notices = [];
      if (s.status !== "active") return { state: s, notices };
      const currentMonth = C.monthKey(now());
      let guard = 0;
      while (s.nextBillMonth && C.monthIndex(s.nextBillMonth) <= C.monthIndex(currentMonth) && guard++ < 120) {
        const month = s.nextBillMonth;
        s = load(id);
        if (s.bills.some((b) => b.month === month)) { s.nextBillMonth = C.nextMonth(month); save(id, s); continue; }
        const bill = C.createBill(s, month, hasPet(id));
        ctx.db.tx(() => {
          const ch = char(id);
          const available = d.userBalance(ctx) + ch.wallet + (s.splitMode === "joint" ? s.jointBalance : 0);
          if (available >= bill.total) settleBill(id, s, bill);
          else {
            bill.outstanding = bill.total;
            d.footprint(ctx, id, "cohab_bill", `${month} 家庭帳單待繳`, `目前還差 ${bill.total - available} 霓幣，不會因此被趕出家門`);
          }
          s.bills.push(bill);
          s.nextBillMonth = C.nextMonth(month);
          save(id, s);
        });
        s = load(id);
      }

      let changed = false;
      const today = C.dayKey(now());
      const dayNumber = s.movedAt ? Math.max(0, Math.floor((now().getTime() - s.movedAt) / C.DAY)) : 0;
      if (!s.friction.length) { s.friction = C.createFrictions(id); changed = true; }
      if (s.activeFrictionId) {
        const f = s.friction.find((item) => item.id === s.activeFrictionId);
        if (f && f.status === "pending" && f.presentedDay !== today) {
          f.presentedDay = today; f.presentedAt = now().getTime(); f.ignored = Math.min(99, (f.ignored || 0) + 1); changed = true;
          if (f.ignored >= 3 && !f.penaltyAt) {
            f.penaltyAt = now().getTime();
            d.adjustRelationship(ctx, id, "harsh", 20, `重複不處理同住摩擦：${f.id}`);
            notices.push({ type: "frictionPenalty", frictionId: f.id });
          }
        }
      } else {
        const next = s.friction.find((f) => f.status === "pending" && f.dueDay <= dayNumber);
        if (next) {
          next.presentedAt = now().getTime(); next.presentedDay = today; next.ignored = 0;
          s.activeFrictionId = next.id; changed = true;
          notices.push({ type: "friction", frictionId: next.id });
        }
      }

      const week = C.weekKey(now());
      if (!s.chores.week) { s.chores.week = week; changed = true; }
      else if (s.chores.week !== week) {
        const previous = s.chores.week;
        const assessed = s.chores.assessedWeeks.some((item) => (typeof item === "string" ? item : item.week) === previous);
        if (!assessed) {
          const fairness = C.choreFairness(s.chores.assignments);
          s.chores.assessedWeeks.push({ week: previous, fair: fairness.fair, difference: fairness.difference, at: now().getTime() });
          s.discontent = Math.max(0, s.discontent + (fairness.fair ? -5 : 12));
          changed = true;
        }
        s.chores.week = week; s.chores.assignments = {}; s.chores.completed = {}; changed = true;
      }
      if (s.discontent >= 40 && s.conflictWeek !== week) {
        s.conflictWeek = week;
        d.unresolved(ctx, id, "同住家務分配長期不公平，需要好好談談，而不是繼續累積不滿。", now().getTime() + 2 * C.DAY);
        notices.push({ type: "conflict" }); changed = true;
      } else if (s.discontent < 40 && s.conflictWeek) { s.conflictWeek = null; changed = true; }

      const event = C.eventFor(now(), id);
      const completed = s.events.history.some((item) => item.id === event.id);
      if (completed) {
        if (s.events.pending?.id === event.id) { s.events.pending = null; changed = true; }
      } else if (!s.events.pending || s.events.pending.id !== event.id) { s.events.pending = event; changed = true; }
      if (changed) save(id, s);
      return { state: load(id), notices };
    }

    async function sendNotices(id, notices) {
      for (const notice of notices) {
        if (notice.type === "friction") {
          const def = C.FRICTIONS.find((f) => f.id === notice.frictionId);
          if (def) await director(id, `你們同住後出現一個生活習慣差異：「${def.title}」。請用你的性格，以「${def.line}」的意思自然開口，不要替對方做決定。`);
        } else if (notice.type === "frictionPenalty") {
          await director(id, "同一件生活摩擦已經多次被擱置。請表達你真的有點受傷，但仍給對方好好談清楚的機會，不要冷嘲熱諷。 ");
        } else if (notice.type === "conflict") {
          await director(id, "你們的家務分配長期不公平，不滿終於累積成一場小爭執。請具體說出你在意的家務與感受，要求一起重新分配，不要只說空泛的「我們聊聊」。 ");
        }
      }
    }

    app.get("/api/cohab/:id", handler(async (c) => {
      const id = c.req.param("id"); char(id) || fail(404, "找不到角色");
      const { state, notices } = refresh(id);
      await sendNotices(id, notices);
      return c.json(snapshot(id, state));
    }));

    app.post("/api/cohab/:id/invite", handler(async (c) => {
      const id = c.req.param("id");
      const ch = char(id) || fail(404, "找不到角色");
      const eligible = eligibility(id);
      if (!eligible.allowed) fail(403, eligible.hint);
      const old = load(id);
      if (old.status !== "none") fail(409, old.status === "movedOut" ? "這段同住生活已結束，現有紀錄會保留" : "已經提出過同住邀請");
      const s = C.initialState();
      s.status = "proposed";
      s.proposal = { by: "user", at: now().getTime(), stage: eligible.stage, stageDays: eligible.days };
      save(id, s);
      message(id, "user", "action", "我想和你住在一起。不是只找一個地方睡，是想把每天的小事也放進我們的生活。", { cohabit: { type: "invite" } });
      d.footprint(ctx, id, "cohabit", "向 TA 提議同住", `關係階段已滿 ${eligible.days} 天`);
      await director(id, `${ch.data?.speech?.callUser || "對方"}認真提議和你同住。請依你的性格答應，並說一件你期待或擔心的日常小事；不要直接決定房子或金額。`);
      return c.json(snapshot(id));
    }));

    app.post("/api/cohab/:id/visit", handler(async (c, body) => {
      const id = c.req.param("id");
      const ch = char(id) || fail(404, "找不到角色");
      const s = load(id);
      if (!["proposed", "viewing"].includes(s.status)) fail(409, "請先完成同住提議");
      noDate(id);
      const home = C.house(text(body.homeId, 30)) || fail(400, "請選擇要看房的住家");
      const view = d.dateView(ctx, id);
      const scenes = (view.scenes || []).filter((scene) => !scene.locked);
      if (!scenes.length) fail(409, "目前沒有可用的面對面約會場景");
      const requested = text(body.sceneId, 60);
      const scene = scenes.find((item) => item.id === requested) || scenes.find((item) => home.sceneWords.some((word) => `${item.name}${item.opening}`.toLowerCase().includes(word.toLowerCase()))) || scenes[0];
      if (s.viewing?.status === "planned") fail(409, "已經有一場預約看房，請等約會開始或從約會頁調整");
      const requestedAt = Number(body.at);
      const at = Number.isFinite(requestedAt) && requestedAt > now().getTime() - 60000 && requestedAt < now().getTime() + 30 * C.DAY ? requestedAt : now().getTime();
      const result = await d.startDate(ctx, id, scene.id, at);
      if (result.status === "busy") return c.json({ error: "TA 這個時間不方便看房，可以改用 TA 提議的時間；目前沒有簽約或扣款", date: result }, 409);
      s.status = "viewing"; s.homeId = home.id;
      s.viewing = { homeId: home.id, sceneId: scene.id, startedAt: now().getTime(), at: result.at, status: result.status };
      save(id, s);
      d.footprint(ctx, id, "cohabit", result.status === "now" ? `到${home.name}看房` : `預約到${home.name}看房`, `面對面約會：${scene.name}`);
      return c.json({ ...snapshot(id), visit: { homeId: home.id, sceneId: scene.id, sceneName: scene.name, status: result.status, at: result.at } });
    }));

    app.post("/api/cohab/:id/visit/end", handler(async (c) => {
      const id = c.req.param("id");
      const ch = char(id) || fail(404, "找不到角色");
      const s = load(id);
      if (s.status !== "viewing" || !s.viewing) fail(409, "目前沒有進行中的看房");
      const activeDate = d.currentDate(ctx, id);
      if (!activeDate || activeDate.state?.sceneId !== s.viewing.sceneId) fail(409, "看房約會不在進行中，請先回到約會畫面確認");
      const result = await d.endDate(ctx, id);
      const reaction = C.houseReaction(ch, s.viewing.homeId);
      const log = {
        id: d.id("view_"), homeId: s.viewing.homeId, sceneId: s.viewing.sceneId,
        at: now().getTime(), grade: result?.grade || "C", line: result?.line || "", reaction,
      };
      if (!s.visited.includes(log.homeId)) s.visited.push(log.homeId);
      s.visitLog.push(log); s.homeId = log.homeId; s.viewing = null; s.status = "viewing";
      save(id, s);
      d.footprint(ctx, id, "cohabit", `看完${C.house(log.homeId).name}`, reaction.line);
      await director(id, `你剛和對方看完「${C.house(log.homeId).name}」。請依你的性格延續這個反應：${reaction.line} 可以說喜歡與疑慮，但不要替對方簽約。`);
      return c.json({ ...snapshot(id), visit: log });
    }));

    app.post("/api/cohab/:id/sign", handler(async (c, body) => {
      const id = c.req.param("id");
      char(id) || fail(404, "找不到角色");
      let s = load(id);
      if (["moving", "active"].includes(s.status) && s.contract) return duplicate(c, id, s);
      if (s.status !== "viewing") fail(409, "請先完成至少一場看房約會");
      noDate(id);
      const home = C.house(text(body.homeId, 30) || s.homeId) || fail(400, "請選擇要簽約的住家");
      if (!s.visited.includes(home.id)) fail(409, "這間房還沒有完成看房");
      const splitMode = C.SPLIT_MODES.includes(body.splitMode) ? body.splitMode : s.splitMode;
      const key = actionKey(body, "sign", false) || `sign:${id}:${home.id}`;
      if (seen(s, key)) return duplicate(c, id, s);
      ctx.db.tx(() => {
        const ch = char(id);
        const pay = allocatePayment(home.due, splitMode === "joint" ? "aa" : splitMode, d.userBalance(ctx), ch.wallet, profileIncome(), taIncome(ch), C);
        if (pay.shortfall > 0) fail(409, `押一付三需要 ${home.due} 霓幣，雙方存款合計還差 ${pay.shortfall}`);
        if (pay.user) d.adjustUserBalance(ctx, -pay.user, "b9_cohab_sign", { ref: home.id, note: `${home.name}押一付三` });
        if (pay.ta) changeTaWallet(id, -pay.ta, "cohab_sign", `${home.name}押一付三`);
        const month = C.monthKey(now());
        s.homeId = home.id; s.splitMode = splitMode; s.status = "moving";
        s.debt += pay.taAdvance; s.taDebt += pay.userAdvance;
        s.contract = {
          id: d.id("lease_"), homeId: home.id, signedAt: now().getTime(), month,
          due: home.due, deposit: home.deposit, prepaidMonths: 3,
          userPaid: pay.user, taPaid: pay.ta, userAdvance: pay.userAdvance, taAdvance: pay.taAdvance,
        };
        s.rentPaidThrough = C.nextMonth(month, 2); s.nextBillMonth = C.nextMonth(month);
        s.boxes = C.createBoxes(); s.friction = C.createFrictions(id); s.movedAt = null; s.movedOutAt = null;
        s.events.pending = null; mark(s, key); save(id, s);
        d.footprint(ctx, id, "cohabit", `簽下${home.name}`, `押一付三 ${home.due}：你 ${pay.user}・TA ${pay.ta}`);
        message(id, "system", "cohab_contract", `你們簽下「${home.name}」。押一付三 ${home.due} 霓幣，你支付 ${pay.user}，TA 支付 ${pay.ta}；接下來把四只箱子搬進房間。`, {
          cohabit: { type: "contract", homeId: home.id, due: home.due, userPaid: pay.user, taPaid: pay.ta },
        });
      });
      s = load(id);
      await director(id, `你們剛一起簽下「${home.name}」，接下來要搬家。請用你的性格說一句期待，也提醒對方還有四只裝著舊物的箱子要一起整理。`);
      return c.json(snapshot(id, s));
    }));

    app.post("/api/cohab/:id/move/open", handler(async (c, body) => {
      const id = c.req.param("id");
      const ch = char(id) || fail(404, "找不到角色");
      let s = load(id); active(s, true);
      if (s.status !== "moving") fail(409, "搬家已經完成");
      const box = s.boxes.find((item) => item.id === text(body.boxId, 30));
      if (!box) fail(404, "找不到这只箱子");
      if (box.opened) return duplicate(c, id, s);
      let generated;
      try {
        generated = await d.react(ctx, id, `你們正在搬進${C.house(s.homeId).name}。對方把「${box.item}」的箱子放到${box.roomName}並打開。請用你的性格講一段 60–120 字的舊物小故事：這件東西和你們過去哪個日常瞬間有關，為什麼值得帶來新家。不要說自己是 AI，不要重複導演提示。`, { kind: "cohab_story", extra: { item: box.item, room: box.roomName, home: C.house(s.homeId).name } });
      } catch (error) {
        console.error("[cohab:box]", error?.message || error);
        fail(502, "TA 暫時沒能想起這段故事，箱子尚未開啟，請稍後再試");
      }
      const story = (generated || []).map((m) => text(m.content, 800)).filter(Boolean).join("\n").trim();
      if ([...story].length < 20) fail(502, "故事內容過短，箱子尚未開啟，請稍後再試");
      s = load(id);
      const target = s.boxes.find((item) => item.id === box.id);
      if (target.opened) return duplicate(c, id, s);
      ctx.db.tx(() => {
        target.opened = true; target.openedAt = now().getTime(); target.story = story;
        target.messageIds = (generated || []).map((m) => m.id).filter(Boolean);
        if (s.boxes.every((item) => item.opened)) {
          s.status = "active"; s.movedAt = now().getTime(); s.chores.week = C.weekKey(now());
        }
        save(id, s);
        d.footprint(ctx, id, "cohabit", `在${target.roomName}打開一只箱子`, target.item);
        if (s.status === "active") {
          d.footprint(ctx, id, "cohabit", "正式搬進共同的家", C.house(s.homeId).name);
          message(id, "system", "cohab_move", "四只箱子都有了位置。從今天起，這裡就是你們共同生活的家。", { cohabit: { type: "moved", homeId: s.homeId } });
        }
      });
      return c.json({ ...snapshot(id), box: target });
    }));

    app.post("/api/cohab/:id/event/choose", handler(async (c, body) => {
      const id = c.req.param("id"); char(id) || fail(404, "找不到角色");
      let s = load(id); active(s);
      const pending = s.events.pending;
      if (!pending || pending.id !== text(body.eventId, 100)) fail(409, "這個時段已經過了，請查看目前的生活事件");
      const option = pending.options.find((item) => item.id === text(body.optionId, 40));
      if (!option) fail(400, "請選擇有效的回應");
      ctx.db.tx(() => {
        s.events.history.push({ ...pending, chosenAt: now().getTime(), optionId: option.id, choice: option.label, reply: option.reply });
        s.events.pending = null;
        if ((option.mood || option.energy) && d.cityStats && d.setCityStats) {
          const stats = d.cityStats(ctx);
          d.setCityStats(ctx, { ...stats, mood: stats.mood + (option.mood || 0), energy: stats.energy + (option.energy || 0) });
        }
        save(id, s);
        message(id, "user", "action", option.label, { cohabit: { type: "daily", eventId: pending.id, optionId: option.id } });
        message(id, "system", "cohab_event", option.reply, { cohabit: { eventId: pending.id, openTab: option.openTab, minigame: option.minigame } });
      });
      return c.json({ ...snapshot(id), outcome: option });
    }));

    app.post("/api/cohab/:id/friction/choose", handler(async (c, body) => {
      const id = c.req.param("id"); char(id) || fail(404, "找不到角色");
      const s = load(id); active(s);
      const frictionId = text(body.frictionId, 40);
      if (!s.activeFrictionId || s.activeFrictionId !== frictionId) fail(409, "這個生活摩擦目前不在等待處理");
      const record = s.friction.find((item) => item.id === frictionId && item.status === "pending");
      const def = C.FRICTIONS.find((item) => item.id === frictionId);
      const option = def?.options.find((item) => item.id === text(body.optionId, 40));
      if (!record || !def || !option) fail(400, "請選擇有效的解決方式");
      ctx.db.tx(() => {
        record.status = "resolved"; record.resolvedAt = now().getTime(); record.optionId = option.id;
        s.activeFrictionId = null; s.discontent = Math.max(0, s.discontent - 8);
        s.rules.push({ id: d.id("home_rule_"), frictionId, text: option.rule, at: now().getTime() });
        d.homeRule(ctx, id, option.rule, "home");
        const relationship = d.adjustRelationship(ctx, id, "resolved", 10, `解決同住摩擦：${def.title}`);
        record.relationshipApplied = relationship?.applied || 0;
        save(id, s);
        message(id, "system", "cohab_rule", `家規多了一條：${option.rule}`, { cohabit: { type: "rule", frictionId, optionId: option.id } });
        d.footprint(ctx, id, "cohabit", `解決「${def.title}」`, option.rule);
      });
      await director(id, `你們剛好好解決「${def.title}」，約定是：${option.rule} 請用你的性格回應，接受這個共同決定，不必再爭辯。`);
      return c.json(snapshot(id));
    }));

    app.post("/api/cohab/:id/chores", handler(async (c, body) => {
      const id = c.req.param("id"); char(id) || fail(404, "找不到角色");
      const refreshed = refresh(id); let s = refreshed.state; active(s);
      const assignments = body.assignments && typeof body.assignments === "object" ? body.assignments : {};
      for (const chore of C.CHORES) {
        if (!Object.prototype.hasOwnProperty.call(assignments, chore.id)) continue;
        const value = text(assignments[chore.id], 20);
        if (!["user", "ta", "together"].includes(value)) fail(400, `${chore.name}的分配方式無效`);
        s.chores.assignments[chore.id] = value;
      }
      if (body.completed && typeof body.completed === "object") {
        for (const chore of C.CHORES) if (Object.prototype.hasOwnProperty.call(body.completed, chore.id)) s.chores.completed[chore.id] = !!body.completed[chore.id];
      }
      save(id, s);
      const fairness = C.choreFairness(s.chores.assignments);
      return c.json({ ...snapshot(id), fairness });
    }));

    app.post("/api/cohab/:id/settings", handler(async (c, body) => {
      const id = c.req.param("id"); char(id) || fail(404, "找不到角色");
      const s = load(id); active(s, true);
      if (body.splitMode !== void 0) {
        if (!C.SPLIT_MODES.includes(body.splitMode)) fail(400, "無效的分攤模式");
        s.splitMode = body.splitMode;
      }
      if (body.savingsTarget !== void 0) {
        const target = Number(body.savingsTarget);
        if (!Number.isFinite(target) || target < 0 || target > 10000000) fail(400, "儲蓄目標需在 0–10,000,000 之間");
        s.savingsGoal.target = Math.round(target);
      }
      save(id, s);
      return c.json(snapshot(id));
    }));

    app.post("/api/cohab/:id/joint/deposit", handler(async (c, body) => {
      const id = c.req.param("id"); char(id) || fail(404, "找不到角色");
      let s = load(id); active(s, true);
      const key = actionKey(body, "joint"); if (seen(s, key)) return duplicate(c, id, s);
      const amount = money(body.amount);
      if (!(amount > 0) || amount > 1000000) fail(400, "存入金額需在 1–1,000,000 之間");
      if (d.userBalance(ctx) < amount) fail(409, "你的免費錢包餘額不足");
      ctx.db.tx(() => {
        d.adjustUserBalance(ctx, -amount, "b9_cohab_joint", { ref: key, note: "存入共同帳戶" });
        s.jointBalance += amount; mark(s, key); save(id, s);
        message(id, "user", "action", `存入共同帳戶 ${amount} 霓幣`, { cohabit: { type: "jointDeposit", amount, actionId: body.actionId } });
        d.footprint(ctx, id, "cohab_finance", "存入共同帳戶", `${amount} 霓幣・餘額 ${s.jointBalance}`);
      });
      return c.json(snapshot(id));
    }));

    app.post("/api/cohab/:id/bill/pay", handler(async (c, body) => {
      const id = c.req.param("id"); char(id) || fail(404, "找不到角色");
      let s = load(id);
      if (!["moving", "active", "movedOut"].includes(s.status)) fail(409, "目前沒有家庭帳單");
      const key = actionKey(body, "billpay"); if (seen(s, key)) return duplicate(c, id, s);
      const month = text(body.month, 7);
      const bill = s.bills.find((item) => item.month === month && item.status !== "paid");
      if (!bill) fail(404, "找不到待繳的月份，或帳單已結清");
      ctx.db.tx(() => {
        settleBill(id, s, bill, key);
        save(id, s);
      });
      await director(id, `你們補繳了 ${month} 的家庭帳單。請依實際情況回應：對方 ${bill.userPaid}、你 ${bill.taPaid}、共同帳戶 ${bill.jointUsed}。若你有代墊，可以溫柔提醒這筆錢記在你們的小本子，不要威脅趕人。`);
      return c.json(snapshot(id));
    }));

    app.post("/api/cohab/:id/debt/repay", handler(async (c, body) => {
      const id = c.req.param("id"); char(id) || fail(404, "找不到角色");
      let s = load(id);
      if (!["moving", "active", "movedOut"].includes(s.status)) fail(409, "目前沒有需要償還的同住欠款");
      if (!(s.debt > 0)) fail(409, "小本子上目前沒有你欠 TA 的款項");
      const key = actionKey(body, "debt"); if (seen(s, key)) return duplicate(c, id, s);
      const method = body.method === "dinner" ? "dinner" : "cash";
      let amount = 0;
      ctx.db.tx(() => {
        if (method === "dinner") {
          const cooking = s.cooking.find((item) => item.id === text(body.cookingId, 100));
          if (!cooking || cooking.burned || cooking.debtRepaidAt) fail(400, "請選擇一頓已完成、沒有燒焦且尚未用來還債的晚餐");
          amount = Math.min(s.debt, Math.max(100, Math.round(cooking.score * 5)));
          cooking.debtRepaidAt = now().getTime(); cooking.debtAmount = amount;
        } else {
          amount = money(body.amount);
          if (!(amount > 0) || amount > s.debt) fail(400, `償還金額需在 1–${s.debt} 之間`);
          if (d.userBalance(ctx) < amount) fail(409, "你的免費錢包餘額不足");
          d.adjustUserBalance(ctx, -amount, "b9_cohab_debt", { ref: key, note: "償還 TA 代墊" });
          changeTaWallet(id, amount, "cohab_debt_repay", "對方償還同住代墊");
        }
        s.debt -= amount; mark(s, key); save(id, s);
        message(id, "user", "action", method === "dinner" ? `用一頓晚餐還了 ${amount} 霓幣的同住欠款` : `償還 TA 代墊 ${amount} 霓幣`, {
          cohabit: { type: "debtRepay", method, amount, cookingId: body.cookingId || null },
        });
        d.footprint(ctx, id, "cohab_finance", method === "dinner" ? "用晚餐還了一筆欠款" : "償還 TA 代墊", `${amount} 霓幣・尚欠 ${s.debt}`);
      });
      await director(id, method === "dinner" ? `對方用一頓實際完成的晚餐，抵掉你們小本子裡 ${amount} 霓幣的代墊。請依你的性格回應這份心意，不要再要求現金。` : `對方剛償還你代墊的 ${amount} 霓幣，還剩 ${s.debt}。請自然收下並回應，不要數落對方。`);
      return c.json(snapshot(id));
    }));

    app.post("/api/cohab/:id/cook", handler(async (c, body) => {
      const id = c.req.param("id"); char(id) || fail(404, "找不到角色");
      const s = load(id); active(s);
      const key = actionKey(body, "cook"); if (seen(s, key)) return duplicate(c, id, s);
      let result;
      try { result = C.cookResult(body.recipeId, body.cuts, body.flipOffsetMs, body.plating); }
      catch (error) { fail(400, error.message); }
      const record = { id: d.id("cook_"), at: now().getTime(), ...result };
      ctx.db.tx(() => {
        s.cooking.push(record); mark(s, key); save(id, s);
        message(id, "user", "action", `做了${result.recipeName}・${result.score} 分${result.burned ? "・有一點焦" : ""}`, {
          cohabit: { type: "cooking", cookingId: record.id, recipeId: result.recipeId, score: result.score, burned: result.burned },
        });
        message(id, "system", "cohab_cooking", result.reply, { cohabit: { cookingId: record.id } });
        d.footprint(ctx, id, "cohabit", result.title, `${result.recipeName}・${result.score} 分`);
      });
      return c.json({ ...snapshot(id), outcome: record });
    }));

    app.post("/api/cohab/:id/care", handler(async (c, body) => {
      const id = c.req.param("id"); const ch = char(id) || fail(404, "找不到角色");
      const s = load(id); active(s);
      const who = body.who === "user" ? "user" : body.who === "ta" ? "ta" : null;
      if (!who) fail(400, "請選擇誰需要照顧");
      const action = ["porridge", "medicine", "stay"].includes(body.action) ? body.action : null;
      if (!action) fail(400, "請選擇煮粥、準備藥與水，或留下陪伴");
      const key = actionKey(body, "care"); if (seen(s, key)) return duplicate(c, id, s);
      const labels = { porridge: "煮一鍋粥", medicine: "準備藥與溫水", stay: "留下陪伴" };
      const note = text(body.note, 160);
      const record = { id: d.id("care_"), at: now().getTime(), date: C.dayKey(now()), who, action, actionLabel: labels[action], note };
      ctx.db.tx(() => {
        s.care.push(record); mark(s, key);
        if (who === "ta") {
          const date = record.date;
          const oldRow = ctx.db.get("SELECT data FROM daily WHERE date = ? AND kind = 'diary' AND ref = ?", date, id);
          let diary = { date, mood: "被照顧", text: "" };
          if (oldRow) { try { diary = { ...diary, ...JSON.parse(oldRow.data) }; } catch {} }
          const line = `今天身體不舒服時，對方選擇${labels[action]}${note ? `，還說「${note}」` : ""}。這件事被我記進了今天的日記。`;
          diary.text = `${diary.text || ""}${diary.text ? "\n\n" : ""}${line}`.trim();
          ctx.db.run("INSERT OR REPLACE INTO daily(date, kind, ref, data) VALUES(?, 'diary', ?, ?)", date, id, JSON.stringify(diary));
          record.diaryDate = date;
        }
        save(id, s);
        message(id, "user", "action", `${who === "ta" ? "照顧 TA" : "告訴 TA 自己不舒服"}：${labels[action]}${note ? `｜${note}` : ""}`, { cohabit: { type: "care", careId: record.id, who, action } });
        d.footprint(ctx, id, "cohab_care", who === "ta" ? "照顧生病的 TA" : "讓 TA 照顧自己", labels[action]);
      });
      await director(id, who === "ta" ? `你生病了，對方剛選擇${labels[action]}${note ? `，並說「${note}」` : ""}。請用你的性格回應被照顧的感受；這件事已經寫進你的日記，不要假稱病情立刻痊癒。` : `對方今天身體不舒服，希望你能${labels[action]}。請用你的性格表達關心與照顧，可以叨念，但不要假稱已經痊癒。`);
      return c.json({ ...snapshot(id), outcome: record });
    }));

    app.post("/api/cohab/:id/move-out", handler(async (c) => {
      const id = c.req.param("id"); char(id) || fail(404, "找不到角色");
      const s = load(id); active(s, true); noDate(id);
      s.status = "movedOut"; s.movedOutAt = now().getTime(); s.events.pending = null; s.activeFrictionId = null; s.viewing = null;
      save(id, s);
      message(id, "system", "cohab_move_out", "你們結束了這段同住生活。家具、家規、帳單與回憶仍保留，沒有資料被重置。", { cohabit: { type: "moveOut", homeId: s.homeId } });
      d.footprint(ctx, id, "cohabit", "結束這段同住生活", "家具、帳本與回憶保留");
      await director(id, "你們剛共同決定結束這段同住生活。請依你的性格認真回應，不挽留、不威脅，也不要假裝過去的回憶不存在。 ");
      return c.json(snapshot(id));
    }));
  }

  const api = { install, allocatePayment, CohabError };
  root.YWCohabAPI = api;
  if (typeof module === "object" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
