/* WARMTH B14 同居規則：無框架、可供頁內 API／面板／Node 測試共用。 */
((root, factory) => {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.YWCohabCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  "use strict";

  const DAY = 86400000;
  const SPLIT_MODES = ["aa", "income", "user", "ta", "joint"];
  const HOUSES = [
    { id: "attic", district: "舊巷", name: "舊巷閣樓", rent: 2500, deposit: 2500, due: 10000, utilities: 600, feature: "便宜、樓下小吃多；缺點是隔音差，雨夜能聽見屋簷滴水。", preference: "浪漫、喜歡生活感的 TA", sceneWords: ["老街", "舊巷", "old", "alley"] },
    { id: "green", district: "綠帶", name: "綠帶住宅區", rent: 5000, deposit: 5000, due: 20000, utilities: 900, feature: "安靜、有寵物公園；通勤較遠，窗邊看得見樹冠。", preference: "溫柔、想養寵的 TA", sceneWords: ["公園", "綠", "park", "garden"] },
    { id: "central", district: "中心區", name: "中心區公寓", rent: 9000, deposit: 9000, due: 36000, utilities: 1400, feature: "高樓夜景、智慧家居、通勤近；生活成本也最高。", preference: "事業型、常加班的 TA", sceneWords: ["夜景", "高樓", "中心", "city", "night"] },
  ];
  const RECIPES = [
    { id: "tomato", name: "番茄燉菜", note: "酸甜、失敗也很像家常宵夜", cuts: 5 },
    { id: "mushroom", name: "奶油蘑菇燉飯", note: "要耐心翻鍋，香味會慢慢出來", cuts: 6 },
    { id: "noodles", name: "深夜炒麵", note: "大火快炒，適合晚歸的兩個人", cuts: 5 },
  ];
  const CHORES = [
    { id: "dishes", name: "洗碗" },
    { id: "trash", name: "倒垃圾" },
    { id: "sweep", name: "掃地" },
    { id: "pet", name: "餵寵物" },
  ];
  const FRICTIONS = [
    { id: "toothpaste", title: "牙膏從哪裡擠", line: "你又從中間擠？", options: [
      { id: "yield", label: "我讓步，以後從尾巴擠", rule: "牙膏從尾巴往前擠，用完蓋好。" },
      { id: "insist", label: "各自保留習慣，不念對方", rule: "牙膏怎麼擠都可以，不因此互相數落。" },
      { id: "two", label: "買兩條，各用各的", rule: "牙膏各用各的，公用的用完要補。" },
    ] },
    { id: "temperature", title: "冷氣要開幾度", line: "26 度是大夏天的罪。", options: [
      { id: "blanket", label: "怕冷的蓋被，維持 25 度", rule: "冷氣先開 25 度，怕冷的人自己加床薄被。" },
      { id: "middle", label: "各退一步，固定 26 度", rule: "冷氣以 26 度為預設，不舒服可以商量再調。" },
      { id: "rooms", label: "不同房間各自設定", rule: "不同房間冷氣各自設定，離開隨手關。" },
    ] },
    { id: "schedule", title: "夜貓子與早睡家", line: "你還不睡，我明天怎麼早起？", options: [
      { id: "headphones", label: "晚睡的人戴耳機、用小燈", rule: "早睡的人先休息；晚睡的人戴耳機、只用小燈。" },
      { id: "sync", label: "一起把睡前半小時留出來", rule: "每天睡前半小時不處理工作，留給彼此與休息。" },
    ] },
    { id: "tidy", title: "椅子不是衣櫃", line: "衣服可以不要丟椅子上嗎？", options: [
      { id: "rule", label: "設一個暫放籃，每天睡前收", rule: "外出服只放暫放籃，每天睡前收好，不堆在椅子或床上。" },
      { id: "soft", label: "先撒嬌，明天一起整理", rule: "看到衣物堆起來先提醒，不翻舊帳；隔天一起整理。" },
    ] },
    { id: "spending", title: "公仔與共同生活", line: "你又買公仔？", options: [
      { id: "joint", label: "家用先進共同帳戶，再自由花", rule: "每月家用與共同目標先保留，剩下的錢各自自由使用。" },
      { id: "separate", label: "各花各的，大額家用先商量", rule: "個人收藏各自負責；超過一週生活費的共同支出先商量。" },
    ] },
  ];
  const EVENTS = {
    morning: [
      { title: "洗手間前的晨間會議", text: "你們同時站在洗手間門口，TA 手裡還拿著牙刷。", options: [
        { id: "yield", label: "讓 TA 先用", reply: "TA 點點頭，出來時替你擠好了牙膏。", mood: 2 },
        { id: "race", label: "猜拳決定", reply: "你們認真猜了三局，最後一起遲到了兩分鐘。", mood: 3, energy: -1 },
      ] },
      { title: "桌上多了一份早餐", text: "TA 早起做了早餐，正在等你決定要坐下吃，還是帶出門。", options: [
        { id: "sit", label: "坐下慢慢吃", reply: "你把第一口分給 TA。今天從同一張餐桌開始。", mood: 4, energy: 2 },
        { id: "take", label: "帶走，出門前抱一下", reply: "TA 把早餐包好，叮囑你別又在路上忘記吃。", mood: 3 },
      ] },
      { title: "被窩裡的賴床談判", text: "鬧鐘響過兩次，TA 把臉埋進枕頭，看起來完全不想起床。", options: [
        { id: "wake", label: "溫柔叫醒", reply: "你報出早餐香味，TA 終於眯著眼坐起來。", mood: 2, energy: 1 },
        { id: "sleep", label: "再讓 TA 睡十分鐘", reply: "你替 TA 留了早餐。十分鐘後，TA 自己走出房間。", mood: 3 },
        { id: "photo", label: "偷拍睡臉，設成私人桌布", reply: "TA 醒來發現後追著你刪照片，最後答應只准留在私人相簿。", mood: 3 },
      ] },
    ],
    leave: [
      { title: "出門前的衣領", text: "TA 在玄關叫住你，指了指自己的衣領，又看向你。", options: [
        { id: "fix", label: "替 TA 整理好衣領", reply: "TA 低頭讓你整理，出門前也替你拍平肩上的一點灰。", mood: 3 },
        { id: "kiss", label: "整理完，再親一下", reply: "TA 愣了半秒，笑著把你推出門：「真的要遲到了。」", mood: 4 },
      ] },
      { title: "鑰匙還在桌上", text: "門關到一半，你發現 TA 的鑰匙還靜靜躺在玄關。", options: [
        { id: "run", label: "追出去送鑰匙", reply: "你在電梯門關上前趕到。TA 說今晚要記得檢查彼此。", mood: 2, energy: -1 },
        { id: "message", label: "傳訊息，替 TA 開門", reply: "TA 折返時你已經站在門邊，手裡還拿著那串鑰匙。", mood: 3 },
      ] },
    ],
    day: [
      { title: "晚上吃什麼", text: "工作到一半，TA 傳來一句：「今晚想吃你做的，還是叫外賣？」", options: [
        { id: "cook", label: "提議一起做飯", reply: "TA 回了菜單，順便提醒你先別把鹽當糖。", mood: 3, minigame: "cooking" },
        { id: "delivery", label: "今天叫外賣吧", reply: "TA 選了你上次說好吃的那家，沒有忘記你的口味。", mood: 2 },
      ] },
      { title: "冰箱裡的最後一瓶飲料", text: "TA 拍照問你：最後一瓶要不要留給晚回家的人？", options: [
        { id: "leave", label: "留給 TA", reply: "TA 說好，最後卻把飲料倒成兩杯。", mood: 3 },
        { id: "share", label: "現在開視訊一起喝", reply: "你們隔著鏡頭碰杯，像是在同一張桌前。", mood: 3, energy: 1 },
      ] },
    ],
    dusk: [
      { title: "今天輪到誰進廚房", text: "食材已經洗好，TA 靠在廚房門邊等你分配。", options: [
        { id: "cook", label: "一起動手", reply: "你負責備料，TA 把圍裙遞給你。", mood: 4, minigame: "cooking" },
        { id: "ta", label: "撒嬌讓 TA 做主廚", reply: "TA 嘴上说拿你沒辦法，還是把你趕去洗菜。", mood: 2 },
        { id: "later", label: "先放著，休息一下", reply: "你們決定晚一點再吃，至少不要帶著疲憊進廚房。", energy: 2 },
      ] },
      { title: "家務待辦跳出來了", text: "本週的家務分配還沒確認，垃圾桶已經先發出抗議。", options: [
        { id: "assign", label: "現在分配家務", reply: "你們把四項家務攤開，決定不再靠誰先看不下去。", mood: 1, openTab: "chores" },
        { id: "together", label: "先花十分鐘一起收", reply: "十分鐘後，地板和心情都清爽了一點。", mood: 2, energy: -1 },
      ] },
    ],
    night: [
      { title: "遙控器只有一支", text: "你們同時伸手拿到遙控器，誰也沒有先放開。", options: [
        { id: "ta", label: "今晚看 TA 選的", reply: "TA 選了收藏很久的片子，還把靠枕分你一半。", mood: 3 },
        { id: "vote", label: "各選一部，抽籤", reply: "抽籤結果讓你們笑成一團，最後兩部都看了一點。", mood: 4 },
      ] },
      { title: "陽台的夜景", text: "城市的燈還亮著，TA 拿了两件外套走到陽台。", options: [
        { id: "lean", label: "靠在一起，不說話", reply: "你們安靜看了一會兒樓下的車燈，誰也沒急著回房間。", mood: 4, energy: 2 },
        { id: "talk", label: "聊聊今天最累的事", reply: "TA 沒有急著給答案，只把你的手牽得更緊。", mood: 4 },
      ] },
    ],
    late: [
      { title: "留給你的那盞燈", text: "玄關的燈還亮著，桌上蓋著一份宵夜。", options: [
        { id: "eat", label: "先吃完，再去找 TA", reply: "宵夜還有一點餘溫。你吃完時，TA 在房裡迷迷糊糊問你回來了沒。", mood: 4, energy: 3 },
        { id: "hug", label: "先抱抱等我的 TA", reply: "TA 嘴上念你晚歸，手卻沒有鬆開。", mood: 5 },
      ] },
      { title: "沙發上的等待", text: "TA 已經在沙發上睡著，手機還停在你最後一則訊息。", options: [
        { id: "blanket", label: "替 TA 蓋好毯子", reply: "你調暗燈光，把明早的道歉與早餐一起記進備忘。", mood: 3 },
        { id: "wake", label: "輕聲叫 TA 回床上", reply: "TA 醒來第一句不是責怪，而是問你吃過了沒有。", mood: 4 },
      ] },
    ],
  };
  const SLOTS = [
    { id: "morning", from: 6, to: 9 },
    { id: "leave", from: 9, to: 11 },
    { id: "day", from: 11, to: 17 },
    { id: "dusk", from: 17, to: 19 },
    { id: "night", from: 19, to: 23 },
    { id: "late", from: 23, to: 30 },
  ];

  const clone = (v) => JSON.parse(JSON.stringify(v));
  const num = (v, fallback = 0) => Number.isFinite(Number(v)) ? Number(v) : fallback;
  const int = (v, fallback = 0) => Math.max(0, Math.round(num(v, fallback)));
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const pad = (n) => String(n).padStart(2, "0");
  const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const monthKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  const monthIndex = (key) => { const [y, m] = String(key).split("-").map(Number); return y * 12 + (m || 1) - 1; };
  const nextMonth = (key, step = 1) => { const n = monthIndex(key) + step; return `${Math.floor(n / 12)}-${pad(n % 12 + 1)}`; };
  const house = (id) => HOUSES.find((h) => h.id === id) || null;
  const recipe = (id) => RECIPES.find((r) => r.id === id) || null;
  const hash = (text) => { let h = 2166136261; for (const ch of String(text)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };

  function weekKey(date) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const day = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - day);
    const year = d.getUTCFullYear();
    const first = new Date(Date.UTC(year, 0, 1));
    const week = Math.ceil((((d - first) / DAY) + 1) / 7);
    return `${year}-W${pad(week)}`;
  }

  function slotFor(date) {
    const hour = date.getHours();
    const slot = SLOTS.find((s) => hour >= s.from && hour < s.to) || SLOTS[SLOTS.length - 1];
    return slot.id;
  }

  function eventFor(date, characterId) {
    const slot = slotFor(date);
    const defs = EVENTS[slot];
    const key = `${dayKey(date)}:${slot}`;
    let index = hash(`${characterId}:${key}`) % defs.length;
    const def = clone(defs[index]);
    if (slot === "late" && date.getHours() >= 2) index = 1;
    const chosen = clone(defs[index]);
    return { id: `${key}:${index}`, date: dayKey(date), slot, title: chosen.title, text: chosen.text, options: chosen.options, createdAt: date.getTime() };
  }

  function initialState() {
    return {
      v: 1, status: "none", homeId: null, proposal: null, visited: [], visitLog: [], viewing: null, splitMode: "aa",
      contract: null, boxes: [], movedAt: null, movedOutAt: null, rentPaidThrough: null, nextBillMonth: null,
      jointBalance: 0, savingsGoal: { id: "ring", label: "求婚戒指", target: 0 }, debt: 0, taDebt: 0, discontent: 0, conflictWeek: null,
      chores: { week: null, assignments: {}, assessedWeeks: [], completed: {} },
      friction: [], activeFrictionId: null, rules: [],
      events: { pending: null, history: [] }, bills: [], cooking: [], care: [], actionIds: [],
    };
  }

  function normalizeState(raw) {
    const base = initialState();
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return base;
    const s = { ...base, ...clone(raw), v: 1 };
    if (!["none", "proposed", "viewing", "moving", "active", "movedOut"].includes(s.status)) s.status = "none";
    if (s.homeId && !house(s.homeId)) s.homeId = null;
    if (!SPLIT_MODES.includes(s.splitMode)) s.splitMode = "aa";
    s.visited = Array.isArray(s.visited) ? s.visited.filter((id) => !!house(id)).slice(0, 3) : [];
    s.visitLog = Array.isArray(s.visitLog) ? s.visitLog.slice(-12) : [];
    s.boxes = Array.isArray(s.boxes) ? s.boxes.slice(0, 12) : [];
    s.friction = Array.isArray(s.friction) ? s.friction.slice(0, 5) : [];
    s.rules = Array.isArray(s.rules) ? s.rules.slice(-40) : [];
    s.bills = Array.isArray(s.bills) ? s.bills.slice(-60) : [];
    s.cooking = Array.isArray(s.cooking) ? s.cooking.slice(-30) : [];
    s.care = Array.isArray(s.care) ? s.care.slice(-30) : [];
    s.actionIds = Array.isArray(s.actionIds) ? s.actionIds.map(String).slice(-120) : [];
    s.events = { ...base.events, ...(s.events || {}) };
    s.events.history = Array.isArray(s.events.history) ? s.events.history.slice(-60) : [];
    s.chores = { ...base.chores, ...(s.chores || {}) };
    s.chores.assignments = s.chores.assignments && typeof s.chores.assignments === "object" ? s.chores.assignments : {};
    s.chores.assessedWeeks = Array.isArray(s.chores.assessedWeeks) ? s.chores.assessedWeeks.slice(-30) : [];
    s.chores.completed = s.chores.completed && typeof s.chores.completed === "object" ? s.chores.completed : {};
    s.savingsGoal = { ...base.savingsGoal, ...(s.savingsGoal || {}) };
    for (const key of ["jointBalance", "debt", "taDebt", "discontent"]) s[key] = int(s[key]);
    s.savingsGoal.target = int(s.savingsGoal.target);
    return s;
  }

  function createBoxes() {
    return [
      { id: "living", room: "living", roomName: "客廳", item: "兩人第一次一起買的杯子", opened: false, story: null },
      { id: "bedroom", room: "bedroom", roomName: "臥室", item: "收在衣櫃深處的舊衛衣", opened: false, story: null },
      { id: "kitchen", room: "kitchen", roomName: "廚房", item: "寫滿修改痕跡的食譜卡", opened: false, story: null },
      { id: "balcony", room: "balcony", roomName: "陽台", item: "曾經一起撿回家的枯枝", opened: false, story: null },
    ];
  }

  function createFrictions(characterId) {
    return FRICTIONS.map((f, i) => ({
      id: f.id, dueDay: 2 + i * 11 + hash(`${characterId}:${f.id}`) % 7,
      status: "pending", ignored: 0, presentedAt: null, resolvedAt: null, optionId: null,
    }));
  }

  function houseReaction(character, homeId) {
    const likes = JSON.stringify([character?.data?.likes || [], character?.data?.persona || "", character?.data?.occupation || ""]);
    const h = house(homeId);
    if (!h) return { liked: false, line: "找不到這間房。" };
    const tests = {
      attic: /浪漫|小吃|生活|老街|舊巷|咖啡|書|藝術/,
      green: /貓|狗|寵|自然|公園|花|溫柔|散步/,
      central: /事業|工作|加班|夜景|智慧|科技|效率|工程|商/,
    };
    const liked = tests[homeId].test(likes);
    const lines = {
      attic: liked ? "TA 對樓下的小吃店很感興趣，說這裡有你們會記住的生活聲音。" : "TA 喜歡價格與煙火氣，但提醒你們要先試試隔音。",
      green: liked ? "TA 在寵物公園前停最久，已經開始想像以後散步的路線。" : "TA 喜歡窗邊的樹，但把通勤時間也認真記了下來。",
      central: liked ? "TA 看著高樓夜景，第一個問的是智慧家居與到公司要多久。" : "TA 承認夜景迷人，不過更在意每月固定支出會不會造成壓力。",
    };
    return { liked, line: lines[homeId] };
  }

  function createBill(state, month, hasPet) {
    const h = house(state.homeId);
    if (!h) throw new Error("尚未選擇住家");
    const rentDue = !state.rentPaidThrough || monthIndex(month) > monthIndex(state.rentPaidThrough);
    const items = [
      { category: "rent", label: "房租", amount: rentDue ? h.rent : 0 },
      { category: "utilities", label: "水電", amount: h.utilities },
      { category: "food", label: "食物", amount: 2400 },
      { category: "pet", label: "寵物", amount: hasPet ? 600 : 0 },
      { category: "fun", label: "娛樂", amount: 800 },
    ].filter((item) => item.amount > 0);
    return { id: `bill:${month}`, month, items, total: items.reduce((sum, item) => sum + item.amount, 0), status: "due" };
  }

  function incomeRatio(userIncome, taIncome) {
    const u = int(userIncome), t = int(taIncome);
    return u + t > 0 ? clamp(u / (u + t), 0.2, 0.8) : 0.5;
  }

  function shares(total, mode, userIncome, taIncome) {
    const amount = int(total);
    if (mode === "user") return { user: amount, ta: 0 };
    if (mode === "ta") return { user: 0, ta: amount };
    const ratio = mode === "income" ? incomeRatio(userIncome, taIncome) : 0.5;
    const user = Math.round(amount * ratio);
    return { user, ta: amount - user };
  }

  function choreFairness(assignments) {
    let user = 0, ta = 0;
    for (const chore of CHORES) {
      const value = assignments[chore.id];
      if (value === "user") user += 1;
      else if (value === "ta") ta += 1;
      else if (value === "together") { user += 0.5; ta += 0.5; }
    }
    return { user, ta, difference: Math.abs(user - ta), fair: CHORES.every((c) => ["user", "ta", "together"].includes(assignments[c.id])) && Math.abs(user - ta) < 2 };
  }

  function cookResult(recipeId, cuts, flipOffsetMs, plating) {
    const r = recipe(recipeId);
    if (!r) throw new Error("請選擇食譜");
    const c = int(cuts), offset = Math.abs(Math.round(num(flipOffsetMs, 9999)));
    if (c < r.cuts) throw new Error(`至少要切 ${r.cuts} 刀`);
    if (!Number.isFinite(Number(flipOffsetMs))) throw new Error("請完成翻鍋");
    if (!["warm", "neat", "playful"].includes(plating)) throw new Error("請選擇擺盤");
    const burned = offset > 150;
    const cutScore = clamp(c - r.cuts, 0, 3) * 3;
    const score = burned ? clamp(55 - Math.floor((offset - 150) / 100), 10, 55) : clamp(82 + cutScore - Math.floor(offset / 75), 70, 100);
    return {
      recipeId, recipeName: r.name, cuts: c, flipOffsetMs: offset, plating, burned, score,
      title: burned ? `${r.name}有一點焦香` : `${r.name}完成`,
      reply: burned ? "TA 笑著把焦掉的部分撥到一旁，還是陪你把整盤吃完，最後認真建議下次由 TA 翻鍋。" : "TA 先拍了一張照片，再把第一口分給你，說這道菜可以放進你們的家常菜單。",
    };
  }

  return {
    DAY, SPLIT_MODES, HOUSES, RECIPES, CHORES, FRICTIONS, SLOTS,
    dayKey, monthKey, monthIndex, nextMonth, weekKey, slotFor, eventFor,
    initialState, normalizeState, createBoxes, createFrictions, houseReaction,
    createBill, incomeRatio, shares, choreFairness, cookResult, house, recipe, hash,
  };
});
