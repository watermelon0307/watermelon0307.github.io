/* 餘溫：ElevenLabs 音色、通話聲波、唱歌與一起聽 */
(() => {
  "use strict";
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
  const Account = window.YWMusicAccount;
  if (!Account) return;
  const LS = "yw_audio_v1", DB_NAME = "yw_music_db", STORE = "tracks";
  let ownerId = Account.id;
  const defaultSettings = () => ({ currentId:null, volume:.85, repeat:"list", mini:false, lastChatId:"" });
  let settings = Object.assign(defaultSettings(), Account.read(LS, {}));
  function persist() { Account.write(LS, settings); }
  let toastTimer;
  function toast(text, err=false) { $(".ywa-toast")?.remove(); const el=document.createElement("div"); el.className="ywa-toast"+(err?" err":""); el.textContent=text; document.body.appendChild(el); clearTimeout(toastTimer); toastTimer=setTimeout(()=>el.remove(),2800); }
  const fmt = sec => `${Math.floor((sec||0)/60)}:${String(Math.floor((sec||0)%60)).padStart(2,"0")}`;

  /* ---------- IndexedDB：音檔與歌詞保存在這台裝置，按帳號隔離 ---------- */
  let dbPromise;
  function db() {
    if (!dbPromise) dbPromise = new Promise((resolve,reject) => {
      const req=indexedDB.open(DB_NAME,1);
      req.onupgradeneeded=()=>req.result.createObjectStore(STORE,{keyPath:"id"});
      req.onsuccess=()=>resolve(req.result); req.onerror=()=>reject(req.error);
    });
    return dbPromise;
  }
  async function idbAll() { const d=await db(); return new Promise((res,rej)=>{const r=d.transaction(STORE).objectStore(STORE).getAll();r.onsuccess=()=>res(r.result||[]);r.onerror=()=>rej(r.error);}); }
  async function idbPut(t) { const owned=Account.withOwner(t,t.ownerId||ownerId);const d=await db();return new Promise((res,rej)=>{const r=d.transaction(STORE,"readwrite").objectStore(STORE).put(owned);r.onsuccess=()=>res(owned);r.onerror=()=>rej(r.error);}); }
  async function idbDel(id) { const d=await db(); return new Promise((res,rej)=>{const r=d.transaction(STORE,"readwrite").objectStore(STORE).delete(id);r.onsuccess=()=>res();r.onerror=()=>rej(r.error);}); }
  let trackMigration=null;
  async function migrateLegacyTracks(){
    if(trackMigration)return trackMigration;
    const claimedBy=Account.trackMigrationOwner();
    const cloud=Account.cloudTrackMigration();
    if(!claimedBy&&!cloud)return;
    trackMigration=(async()=>{
      const all=await idbAll();
      const idMap={};
      for(const original of [...all]){
        let track=original;
        if(!track.ownerId&&claimedBy){
          track=await idbPut({...track,ownerId:claimedBy});
          const index=all.findIndex(item=>item.id===track.id);if(index>=0)all[index]=track;
        }
        if(cloud&&track.ownerId===cloud.sourceOwnerId){
          const clonedId=Account.cloudTrackId(track.id,cloud.ownerId);
          idMap[track.id]=clonedId;
          if(all.some(item=>item.id===clonedId))continue;
          const clone=await idbPut({...track,id:clonedId,ownerId:cloud.ownerId,migratedFrom:{ownerId:track.ownerId,trackId:track.id}});
          all.push(clone);
        }
      }
      if(claimedBy)Account.finishTrackMigration(claimedBy);
      if(cloud){
        Account.finishCloudTrackMigration(cloud.ownerId,idMap);
        if(ownerId===cloud.ownerId&&idMap[settings.currentId])settings.currentId=idMap[settings.currentId];
      }
    })().catch(error=>{trackMigration=null;throw error;});
    return trackMigration;
  }

  /* ---------- 狀態 ---------- */
  const S = { open:false, tab:"now", tracks:[], current:null, playing:false, lyrics:[], lyricIndex:-1,
    importSource:"netease", voiceChar:null, voiceCfg:null, voiceKey:"", voiceStatus:null,
    composing:false, composeStatus:null, composeResultId:"",
    compose:{ title:"", prompt:"", duration:30000, instrumental:false },
    chatOpen:false, chatMessages:[], singing:false, singSong:null, singLine:"", mini:settings.mini };
  const audio = new Audio(); audio.preload="metadata"; audio.volume=settings.volume; audio.crossOrigin="anonymous";
  let objectUrl=null, cloudResolving=false;

  function chatId() { const m=location.hash.match(/#\/chat\/([^/?&#]+)/); return m?decodeURIComponent(m[1]):settings.lastChatId||""; }
  function currentTrack() { return S.tracks.find(t=>t.id===settings.currentId)||null; }
  function sourceName(t) { return ({local:"本機音檔",netease:"網易雲分享",qq:"QQ 音樂分享",itunes:"iTunes 試聽",recommend:"TA 推薦",elevenmusic:"Eleven Music 創作"})[t?.source]||"音樂"; }
  function parseLrc(text) {
    const out=[]; String(text||"").split(/\r?\n/).forEach(line=>{const ms=[...line.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];if(!ms.length)return;const txt=line.replace(/\[[^\]]+\]/g,"").trim();ms.forEach(m=>out.push({time:+m[1]*60 + +m[2],text:txt||"♪"}));});
    return out.sort((a,b)=>a.time-b.time);
  }

  /* ---------- 音訊分析：只輸出真實播放頻率；通話待機不製造波形 ---------- */
  let actx=null, analyser=null, freqData=null;
  const mediaGraphs=new WeakMap();
  function graphFor(media) {
    if (mediaGraphs.has(media)) return mediaGraphs.get(media);
    try {
      const AC=window.AudioContext||window.webkitAudioContext; if(!AC)return null;
      if(!actx){actx=new AC();analyser=actx.createAnalyser();analyser.fftSize=128;analyser.smoothingTimeConstant=.78;analyser.connect(actx.destination);freqData=new Uint8Array(analyser.frequencyBinCount);}
      const src=actx.createMediaElementSource(media); src.connect(analyser); mediaGraphs.set(media,src); return src;
    } catch { return null; }
  }
  function hookMedia(media){ media.addEventListener("play",()=>{graphFor(media);actx?.resume().catch(()=>{});});
    if(media!==audio){media.addEventListener("play",()=>duck(true));media.addEventListener("ended",()=>duck(false));media.addEventListener("pause",()=>duck(false));}
  }
  /* ---------- Audio Ducking：TA 說話或唱歌時，背景音樂自動轉小 ---------- */
  let duckCount=0;
  function duck(on){duckCount=Math.max(0,duckCount+(on?1:-1));const ducked=duckCount>0;const target=ducked?Math.min(.25,settings.volume*.3):settings.volume;if(Math.abs(audio.volume-target)>.01)audio.volume=target;}
  if(window.speechSynthesis&&!window.__ywSpeakHooked){window.__ywSpeakHooked=true;const orig=window.speechSynthesis.speak.bind(window.speechSynthesis);window.speechSynthesis.speak=u=>{duck(true);const done=()=>duck(false);u.addEventListener?.("end",done);u.addEventListener?.("error",done);orig(u);};}
  hookMedia(audio);
  const NativeAudio=window.Audio;
  if(NativeAudio && !window.__ywAudioHooked){
    window.__ywAudioHooked=true;
    window.Audio=function(...args){const el=new NativeAudio(...args);hookMedia(el);return el;};
    window.Audio.prototype=NativeAudio.prototype;
  }

  /* ---------- 全螢場面板 ---------- */
  function open(tab="now") {
    settings.mini=false; S.mini=false; S.open=true; S.tab=tab;
    if(!$("#ywAudioRoot")){const root=document.createElement("div");root.id="ywAudioRoot";document.body.appendChild(root);}
    render(); refreshTracks(); if(tab==="voice"||tab==="compose")loadVoice();
  }
  function close(mini=true) { S.open=false; S.chatOpen=false; if(mini && (S.current||audio.src)){settings.mini=true;S.mini=true;} persist(); render(); }
  function rootHtml() {
    if(S.open) return `<div class="ywm" role="dialog" aria-label="一起聽與音色中心">
      <div class="ywm-head"><button data-close title="縮成漂浮窗">⌄</button><span class="ywm-head-title">一起聽</span><button class="ywm-back" data-back title="關閉並返回聊天">✕ 返回聊天</button>
      <div class="ywm-head-tabs">${[["now","播放"],["list","歌單"],["compose","創作"],["voice","音色"]].map(([k,n])=>`<button data-tab="${k}" class="${S.tab===k?"on":""}">${n}</button>`).join("")}</div></div>
      <div class="ywm-body">${S.tab==="list"?listHtml():S.tab==="voice"?voiceHtml():S.tab==="compose"?composeHtml():nowHtml()}</div>${dockHtml()}${S.chatOpen?chatHtml():""}</div>`;
    if(S.mini && S.current) return miniHtml();
    return "";
  }
  function render(){const root=$("#ywAudioRoot");if(root)root.innerHTML=rootHtml();wire();renderMini();}

  function nowHtml(){const t=currentTrack();if(!t)return `<div class="ywm-page ywm-now"><div class="ywm-empty">還沒有音樂。<br>先去「歌單」匯入手機裡的音檔，或貼上網易雲／QQ 音樂分享。</div><div class="ywm-actions"><button class="ywm-btn red" data-tab="list">＋ 匯入音樂</button><button class="ywm-btn" data-tab="voice">設定 TA 的音色</button></div><p class="ywm-note">角色點歌、歌曲／歌詞討論、安靜模式與一起聽紀錄從第一次開啟就能使用。</p></div>`;
    return `<div class="ywm-page ywm-now"><div class="ywm-disc-wrap"><div class="ywm-disc ${S.playing?"playing":""}">${t.cover?`<img src="${esc(t.cover)}" alt="">`:""}</div></div>
      <h2 class="ywm-song">${esc(t.name)}</h2><div class="ywm-artist">${esc(t.artist||"未知歌手")}</div>
      <div class="ywm-badges"><span class="ywm-badge">${sourceName(t)}</span>${t.preview?`<span class="ywm-badge">30 秒試聽${t.previewName?`：${esc(t.previewName)}`:""}</span>`:""}</div>
      <div class="ywm-lyrics" id="ywmLyrics">${lyricsHtml()}</div>
      <div class="ywm-progress"><span id="ywmCur">${fmt(audio.currentTime)}</span><input id="ywmSeek" type="range" min="0" max="${audio.duration||t.duration||30}" step=".1" value="${audio.currentTime||0}"><span id="ywmDur">${fmt(audio.duration||t.duration||30)}</span></div>
      <div class="ywm-controls"><button data-repeat title="循環模式">${settings.repeat==="one"?"🔂":"🔁"}</button><button data-prev>⏮</button><button class="ywm-play" data-toggle>${S.playing?"⏸":"▶"}</button><button data-next>⏭</button><button data-chat title="邊聽邊聊">💬</button></div>
      <div class="ywm-actions"><button class="ywm-btn red" data-share>分享給 TA，一起聽</button><button class="ywm-btn" data-chat>邊聽邊聊</button><button class="ywm-btn" data-tab="voice">讓 TA 唱歌</button></div>
      <p class="ywm-note">歌詞支援 .lrc 同步歌詞；在歌單裡可為每首歌貼上歌詞。音樂持續播放時，可縮成右下角漂浮窗回聊天室。</p></div>`;
  }
  function lyricsHtml(){if(!S.lyrics.length)return `<div class="ywm-nolyric">${esc(currentTrack()?.lyricsText?"純文字歌詞":"暫無歌詞，享受音樂吧")}</div>`;return S.lyrics.map((l,i)=>`<div class="ywm-lyric-line ${i===S.lyricIndex?"on":""}" data-li="${i}">${esc(l.text)}</div>`).join("");}
  function dockHtml(){const t=currentTrack();if(!t||S.tab==="now")return "";return `<div class="ywm-dock"><div class="ywm-dock-info"><b>${esc(t.name)}</b><small>${esc(t.artist)} · ${sourceName(t)}</small></div><button data-toggle>${S.playing?"⏸":"▶"}</button><button data-tab="now">♫</button></div>`;}

  function listHtml(){const filter=S.listFilter||"all",visible=filter==="favorites"?S.tracks.filter(t=>t.favorite):S.tracks,favoriteCount=S.tracks.reduce((n,t)=>n+(t.favorite?1:0),0);return `<div class="ywm-page"><div class="ywm-section-title">匯入音樂<span>目前帳號的私人曲庫</span></div>
    <div class="ywm-import"><button data-import="local">📁 本機音樂<small>一次多選音檔 / .lrc</small></button><button class="netease" data-import="netease">網易雲音樂<small>${window.YWNcm?"WARMTH 一起聽":"貼上分享文字"}</small></button><button class="qq" data-import="qq">QQ 音樂<small>貼上分享文字</small></button></div>
    <p class="ywm-note">手機瀏覽器不能讀取網易雲／QQ App 的 DRM 音樂庫，所以不會要求你的帳密。分享匯入會建立歌曲資訊；播放時嘗試尋找 iTunes 30 秒試聽，完整歌曲請選「本機音樂」。</p>
    <div id="ywmImportBox">${S.importing?importHtml():""}</div>
    <div class="ywm-section-title">我的歌單<span>${S.tracks.length} 首</span></div>
    <div class="ywm-list-filters" role="group" aria-label="歌單篩選"><button data-filter="all" class="${filter==="all"?"on":""}" aria-pressed="${filter==="all"}">全部 ${S.tracks.length}</button><button data-filter="favorites" class="${filter==="favorites"?"on":""}" aria-pressed="${filter==="favorites"}">收藏 ${favoriteCount}</button></div>
    ${visible.length?visible.map((t,i)=>`<div class="ywm-track ${t.id===settings.currentId?"on":""}" data-track="${esc(t.id)}"><span class="ywm-track-index">${String(i+1).padStart(2,"0")}</span><div class="ywm-track-info"><div class="ywm-track-name">${esc(t.name)}</div><div class="ywm-track-meta">${esc(t.artist)} · ${sourceName(t)}${t.preview?" · 試聽":""}</div></div><button class="ywm-favorite ${t.favorite?"on":""}" data-favorite="${esc(t.id)}" aria-pressed="${!!t.favorite}" aria-label="${t.favorite?"取消收藏":"收藏"} ${esc(t.name)}" title="${t.favorite?"取消收藏":"收藏"}">${t.favorite?"♥":"♡"}</button><button data-lyric="${esc(t.id)}" title="編輯歌詞" aria-label="編輯 ${esc(t.name)} 歌詞">詞</button><button data-del="${esc(t.id)}" title="刪除" aria-label="刪除 ${esc(t.name)}">×</button></div>`).join(""):`<div class="ywm-empty">${filter==="favorites"&&S.tracks.length?"還沒有收藏歌曲，點歌曲右側的 ♡ 就能收藏":"歌單還是空的"}</div>`}
    <div id="ywmLyricEditor"></div></div>`;
  }
  function importHtml(){return `<div class="ywm-card"><div class="ywm-field"><span>${S.importSource==="qq"?"QQ 音樂":"網易雲"}分享文字 / 每行「歌手 - 歌名」</span><textarea id="ywmShareText" placeholder="例如：分享周杰伦的单曲《晴天》\n或：周杰倫 - 晴天"></textarea></div><div class="ywm-form-row"><button class="ywm-btn" data-cancel-import>取消</button><button class="ywm-btn red" data-parse-import>匯入歌單</button></div></div>`;}

  /* ---------- Eleven Music：真正的雲端作曲，完成後存入既有私人歌單 ---------- */
  const MUSIC_EXAMPLES=[
    {title:"霓虹雨夜",prompt:"新霓市午夜下著細雨，溫柔的 synthwave 與 lo-fi 節拍，電鋼琴、柔和合成器與遠處城市環境聲，像有人陪你在窗邊等天亮。",instrumental:true},
    {title:"留一盞燈",prompt:"一首溫暖、簡短的中文流行晚安歌，木吉他與鋼琴，真誠而克制，表達累了也沒關係、有人替你留一盞燈。",instrumental:false},
    {title:"城市慢跑",prompt:"清晨在河畔慢跑，明亮有推進力的 electro-pop，120 BPM，乾淨貝斯與輕快打擊樂，充滿重新開始的希望。",instrumental:true}
  ];
  function composeHtml(){
    const c=S.voiceChar,v=S.compose,result=S.tracks.find(t=>t.id===S.composeResultId);
    if(!c)return `<div class="ywm-page"><div class="ywm-section-title">AI 音樂創作</div><div class="ywm-empty">請先從一個角色的聊天室開啟創作頁，讓 TA 為這首作品點題。</div></div>`;
    return `<div class="ywm-page ywm-compose"><div class="ywm-section-title">AI 音樂創作<span>${esc(c.name)} 點題</span></div>
      <p class="ywm-compose-lead">描述此刻想聽的聲音。作品會使用你的 ElevenLabs 額度生成，完成後自動收進這台裝置的私人歌單。</p>
      ${!S.hasKey?`<div class="ywm-compose-key"><b>還差一把金鑰</b><p>先到音色頁保存 ElevenLabs API Key；金鑰只會由內建加密設定讀取。</p><button class="ywm-btn" data-tab="voice">前往保存金鑰</button></div>`:""}
      <div class="ywm-compose-examples">${MUSIC_EXAMPLES.map((x,i)=>`<button data-music-example="${i}" ${S.composing?"disabled":""}>${esc(x.title)}</button>`).join("")}</div>
      <div class="ywm-field"><span>作品名稱<em>選填</em></span><input id="ywmComposeTitle" maxlength="80" value="${esc(v.title)}" placeholder="例如：雨停之前的晚安" ${S.composing?"disabled":""}></div>
      <div class="ywm-field"><span>音樂提示<b id="ywmPromptCount">${[...v.prompt].length}／2000</b></span><textarea id="ywmComposePrompt" maxlength="2000" placeholder="描述情緒、曲風、節奏、樂器，以及是否想聽人聲…" ${S.composing?"disabled":""}>${esc(v.prompt)}</textarea></div>
      <div class="ywm-compose-settings"><label class="ywm-field"><span>長度</span><select id="ywmComposeDuration" ${S.composing?"disabled":""}>${[[15000,"15 秒"],[30000,"30 秒"],[60000,"60 秒"]].map(([n,label])=>`<option value="${n}" ${v.duration===n?"selected":""}>${label}</option>`).join("")}</select></label>
      <label class="ywm-compose-toggle"><input id="ywmComposeInstrumental" type="checkbox" ${v.instrumental?"checked":""} ${S.composing?"disabled":""}><span><b>純音樂</b><small>不生成人聲</small></span></label></div>
      <button class="ywm-btn red ywm-compose-submit" data-compose-music ${!S.hasKey||S.composing||[...v.prompt].length<4?"disabled":""}>${S.composing?"Eleven Music 生成中…":"生成並存入私人歌單"}</button>
      ${S.composeStatus?`<div class="ywm-status ${S.composeStatus.kind}" role="status" aria-live="polite">${esc(S.composeStatus.text)}</div>`:""}
      ${result?`<div class="ywm-generated"><span class="ywm-generated-index">NEW</span><div class="ywm-generated-info"><b>${esc(result.name)}</b><small>${Math.round(result.duration)} 秒・${result.instrumental?"純音樂":"含人聲設定"}・${esc(result.model)}</small></div><button class="ywm-btn red" data-play-generated="${result.id}">播放</button><button class="ywm-btn" data-tab="list">收藏</button></div>`:""}
      <p class="ywm-note">Eleven Music 生成的是新音樂作品，不保證使用「${esc(c.name)}」的角色聲線，也不是聲音克隆。若要角色用自己的音色逐句念唱，請使用「音色」頁的原創短歌。生成歌曲可播放、刪除或分享給 TA；沒有授權歌詞時不會自動編造歌詞。</p></div>`;
  }
  function syncComposeForm(){
    if(!$("#ywAudioRoot")||S.tab!=="compose")return;
    S.compose={
      title:$("#ywmComposeTitle")?.value.trim()||"",
      prompt:$("#ywmComposePrompt")?.value.trim()||"",
      duration:Number($("#ywmComposeDuration")?.value)||30000,
      instrumental:!!$("#ywmComposeInstrumental")?.checked
    };
  }
  async function composeMusic(){
    if(S.composing)return;
    syncComposeForm();
    const v=S.compose,c=S.voiceChar;
    if(!c)return toast("找不到目前角色，請從角色聊天室開啟",true);
    if([...v.prompt].length<4)return toast("請再多描述一點想聽的音樂",true);
    S.composing=true;S.composeResultId="";S.composeStatus={kind:"",text:"正在向 Eleven Music 送出創作請求。雲端生成需要一些時間，請不要重複提交。"};render();
    try{
      const r=await fetch("/api/music/compose",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({prompt:v.prompt,musicLengthMs:v.duration,instrumental:v.instrumental})});
      if(!r.ok){const j=await r.json().catch(()=>({}));throw new Error(j.error||`生成失敗（${r.status}）`);}
      const blob=await r.blob();if(!blob.size)throw new Error("收到的音檔是空的，請再試一次");
      const now=Date.now();
      const track={id:"tr_em_"+now.toString(36)+Math.random().toString(36).slice(2,6),name:v.title||`${c.name}的${v.instrumental?"純音樂小品":"音樂小品"}`,artist:`${c.name} 點題・Eleven Music`,source:"elevenmusic",blob:new Blob([blob],{type:"audio/mpeg"}),lyricsText:"",duration:v.duration/1000,prompt:v.prompt,instrumental:v.instrumental,characterId:c.id,model:r.headers.get("x-music-model")||"music_v2_5",favorite:true,createdAt:now};
      await idbPut(track);
      S.composeResultId=track.id;S.composeStatus={kind:"ok",text:"作品已生成，並保存到這台裝置的私人歌單。"};
      await refreshTracks();
    }catch(e){S.composeStatus={kind:"bad",text:e.message||"生成失敗，請稍後再試"};}
    finally{S.composing=false;render();}
  }

  function voiceHtml(){const c=S.voiceChar,v=S.voiceCfg;return `<div class="ywm-page"><div class="ywm-section-title">TA 的聲音<span>${esc(c?.name||"尚未選擇角色")}</span></div>
    ${!c?`<div class="ywm-empty">請先從一個角色的聊天室開啟這個頁面。</div>`:`<div class="ywm-card"><div class="ywm-field"><span>ElevenLabs API Key（保存一次，不用每次輸入）</span><input id="ywaKey" type="password" placeholder="${S.hasKey?"已保存；留空表示不修改":"輸入 ElevenLabs API Key"}" autocomplete="off"></div><button class="ywm-btn" data-save-key>保存金鑰</button><span class="ywm-note">金鑰交給餘溫內建設定加密保存；這裡不會顯示完整金鑰。</span></div>
    <div class="ywm-card"><div class="ywm-field"><span>聲音引擎</span><select id="ywaProvider"><option value="browser" ${v?.provider==="browser"?"selected":""}>瀏覽器中文語音（免金鑰）</option><option value="elevenlabs" ${v?.provider==="elevenlabs"?"selected":""}>ElevenLabs</option><option value="fish" ${v?.provider==="fish"?"selected":""}>Fish Audio</option><option value="openai" ${v?.provider==="openai"?"selected":""}>OpenAI TTS</option></select></div>
      <div id="ywaVoiceIdWrap" class="${v?.provider==="browser"?"ywa-hidden":""}"><div class="ywm-field"><span>Voice ID</span><input id="ywaVoiceId" value="${esc(v?.voiceId||"")}" placeholder="ElevenLabs Voice ID"></div></div>
      <div id="ywaBrowserVoiceWrap" class="${v?.provider!=="browser"?"ywa-hidden":""}"><div class="ywm-field"><span>瀏覽器音色</span><select id="ywaBrowserVoice"><option value="">自動（中文）</option>${("speechSynthesis"in window?speechSynthesis.getVoices():[]).filter(x=>x.lang?.toLowerCase().startsWith("zh")).map(x=>`<option value="${esc(x.name)}" ${v?.browserVoice===x.name?"selected":""}>${esc(x.name)}（${esc(x.lang)}）</option>`).join("")}</select></div></div>
      <div class="ywm-field"><span>音色名稱（自己記得就好，例如「清冷青年」）</span><input id="ywaVoiceName" value="${esc(v?.voiceName||"")}" placeholder="清冷青年、溫柔姐姐…"></div>
      <div class="ywm-chips">${["清冷青年","溫柔姐姐","元氣少年","沉穩低音"].map(n=>`<button class="ywm-chip ${v?.voiceName===n?"on":""}" data-preset="${n}">${n}</button>`).join("")}</div>
      <div class="ywm-field"><span>語言（試聽與通話朗讀使用）</span><select id="ywaLang">${LANGS.map(([k,n])=>`<option value="${k}" ${(v?.language||"zh-TW")===k?"selected":""}>${n}</option>`).join("")}</select></div>
      ${slider("stability","穩定度",v?.stability??.4)}${slider("similarity","相似度",v?.similarity??.85)}${slider("style","表現力",v?.style??.35)}
      ${slider("rate","語速",v?.rate??1,.5,1.6,.05)}${slider("pitch","音高（瀏覽器語音）",v?.pitch??1,.5,2,.05)}
      <div class="ywm-field"><span>試聽台詞</span><input id="ywaPreview" value="${esc(v?.previewText||"")}" placeholder="${esc(defaultPreview(v?.language))}"></div>
      <div class="ywm-form-row"><button class="ywm-btn" data-test-voice>試聽音色</button><button class="ywm-btn red" data-save-voice>保存到角色</button></div>${S.voiceStatus?`<div class="ywm-status ${S.voiceStatus.kind}">${esc(S.voiceStatus.text)}</div>`:""}</div>
    <div class="ywm-card"><div class="ywm-field"><span>我的語音辨識語言（打電話時辨識你說的話）</span><select id="ywaAsrLang">${LANGS.map(([k,n])=>`<option value="${k}" ${asrLang()===k?"selected":""}>${n}</option>`).join("")}</select></div>
      <label class="ywm-field ywm-check"><input id="ywaCallMem" type="checkbox" ${callMemOn()?"checked":""}><span>通話結束後，把你說過的話摘要記進 TA 的記憶（可隨時關掉）</span></label>
      <p class="ywm-note">麥克風權限由瀏覽器在第一次辨識時詢問；通話中麥克風開啟時會顯示「聆聽中」。語音辨識由瀏覽器提供，若你的瀏覽器連不上辨識服務，通話畫面會顯示提示，可以改用「打字」。</p></div>`}
    <div class="ywm-section-title">讓 TA 唱歌給你聽<span>原創短歌</span></div>
    ${S.singing?singStageHtml():`<div class="ywm-sing-grid">${SONGS.map((s,i)=>`<button class="ywm-songcard" data-sing="${i}"><b>🎤 ${esc(s.title)}</b><small>${esc(s.desc)}</small></button>`).join("")}</div><p class="ywm-note">歌聲實驗使用角色音色逐句念唱，搭配即時合成旋律；不是專業歌聲克隆，也不會假冒真人演唱。</p>`}</div>`;}
  function slider(id,name,val,min=0,max=1,step=.05){return `<label class="ywm-field"><span>${name}<b id="yw_${id}_val">${Number(val).toFixed(2)}</b></span><input id="yw_${id}" data-slider="${id}" type="range" min="${min}" max="${max}" step="${step}" value="${val}"></label>`;}
  function singStageHtml(){return `<div class="ywm-card ywm-sing-stage"><div>🎤 ${esc(S.singSong?.title)}</div><div class="ywm-sing-bars">${"<i></i>".repeat(12)}</div><div class="ywm-sing-lyric">${esc(S.singLine||"前奏…")}</div><button class="ywm-btn" data-stop-sing>停止演唱</button></div>`;}

  /* ---------- 原創旋律與歌詞 ---------- */
  const SONGS=[
    {title:"霓虹雨",desc:"給新霓市的雨夜，一段慢慢亮起來的歌",beat:.42,lines:[
      {text:"雨落在霓虹的窗邊",notes:[60,62,64,67,64,62,60]},
      {text:"你把晚安留在我耳邊",notes:[62,64,65,67,69,67,65,64]},
      {text:"城市再亮也有陰影",notes:[60,60,62,64,65,64,62]},
      {text:"我陪你走到天亮以前",notes:[62,64,67,69,67,65,64,62,60]}]},
    {title:"留一盞燈",desc:"累了的時候，總有人替你留一點溫度",beat:.46,lines:[
      {text:"如果今天有點疲倦",notes:[60,62,64,62,60,57,60]},
      {text:"就把心事放在我身邊",notes:[62,64,65,64,62,60,59,60]},
      {text:"不用急著變得堅強",notes:[64,64,65,67,65,64,62]},
      {text:"我會為你留一盞燈光",notes:[62,64,67,65,64,62,60,60]}]},
    {title:"晚安信號",desc:"一段很輕、很短的睡前旋律",beat:.5,lines:[
      {text:"把今天的喧嘩關小",notes:[60,62,64,65,64,62,60]},
      {text:"讓月光蓋住你的眼角",notes:[62,64,65,67,65,64,62]},
      {text:"夢裡不需要趕路",notes:[60,60,62,64,65,64]},
      {text:"晚安我在這裡陪你",notes:[62,64,65,64,62,60,59,60]}]}
  ];
  let singCancel=null;
  async function startSing(i){if(S.singing)return;stopSing();audio.pause();const song=SONGS[i];S.singing=true;S.singSong=song;S.singLine="前奏…";render();
    const cfg=S.voiceCfg||S.voiceChar?.data?.voice||{provider:"browser"};let cancelled=false;let lineAudio=null;let oscillators=[];
    const ctx=actx||new (window.AudioContext||window.webkitAudioContext)();actx=ctx;await ctx.resume().catch(()=>{});
    const stop=()=>{cancelled=true;window.speechSynthesis?.cancel();lineAudio?.pause();oscillators.forEach(o=>{try{o.stop()}catch{}});};singCancel=stop;
    try{
      for(const line of song.lines){if(cancelled)return;S.singLine=line.text;const lyric=$(".ywm-sing-lyric");if(lyric)lyric.textContent=line.text;
        // 雲端音色先取得音訊，再同時啟動旋律與人聲，避免前奏播完人聲才到。
        const cloud=cfg.provider&&cfg.provider!=="browser"&&S.voiceChar;
        const blob=cloud?await ttsBlob(line.text,S.voiceChar.id):null;if(cancelled)return;
        const start=ctx.currentTime+.05,beat=song.beat;line.notes.forEach((midi,j)=>{const o=ctx.createOscillator(),g=ctx.createGain();o.type="sine";o.frequency.value=440*Math.pow(2,(midi-69)/12);const at=start+j*beat;g.gain.setValueAtTime(0,at);g.gain.linearRampToValueAtTime(.055,at+.035);g.gain.exponentialRampToValueAtTime(.001,at+beat*.9);o.connect(g);g.connect(ctx.destination);o.start(at);o.stop(at+beat);oscillators.push(o);});
        if(blob){const url=URL.createObjectURL(blob);lineAudio=new Audio(url);hookMedia(lineAudio);await new Promise(res=>{lineAudio.onended=lineAudio.onerror=()=>{URL.revokeObjectURL(url);res()};lineAudio.play().catch(res);});}
        else await browserSpeak(line.text,line.notes,cfg);
        if(cancelled)return;await new Promise(r=>setTimeout(r,180));
      }
      if(!cancelled){S.singLine="唱完了。希望你喜歡 ♪";toast("演唱結束");}
    }finally{if(!cancelled){S.singing=false;render();}singCancel=null;}
  }
  function browserSpeak(text,notes,cfg){return new Promise(resolve=>{if(!("speechSynthesis"in window))return resolve();const u=new SpeechSynthesisUtterance(text);u.lang=cfg.language||"zh-TW";u.rate=Math.min(.92,cfg.rate||.82);const avg=notes.reduce((a,b)=>a+b,0)/notes.length;u.pitch=Math.max(.6,Math.min(1.8,(cfg.pitch||1)+(avg-64)*.035));const voices=speechSynthesis.getVoices();const chosen=voices.find(v=>v.name===cfg.browserVoice)||voices.find(v=>v.lang?.startsWith("zh"));if(chosen)u.voice=chosen;u.onend=u.onerror=()=>resolve();speechSynthesis.speak(u);setTimeout(()=>{if(!u.ended){/* onend 為主，超時只作保險 */}},12000);});}
  function stopSing(){singCancel?.();singCancel=null;if(S.singing){S.singing=false;S.singLine="";render();}}

  /* ---------- 語言與本機偏好 ---------- */
  const LANGS=[["zh-TW","中文（台灣）"],["zh-CN","中文（普通話）"],["zh-HK","中文（廣東話）"],["ja","日本語"],["en","English"],["ko","한국어"]];
  const PREVIEWS={"zh-TW":"早安，今天會是怎樣的一天呢。","zh-CN":"早安，今天会是怎样的一天呢。","zh-HK":"早晨，今日會係點嘅一日呢。","ja":"おはよう。今日はどんな一日になるかな。","en":"Good morning. I wonder what today will bring.","ko":"좋은 아침이에요. 오늘은 어떤 하루가 될까요."};
  function defaultPreview(lang){return PREVIEWS[lang]||PREVIEWS["zh-TW"];}
  function asrLang(){try{return localStorage.getItem("yw_asr_lang")||"zh-TW";}catch{return "zh-TW";}}
  function callMemOn(){try{return localStorage.getItem("yw_call_memory")!=="off";}catch{return true;}}

  /* ---------- 音色 ---------- */
  async function currentCharacter(){const cid=chatId();if(!cid)return null;try{const b=await fetch("/api/bootstrap").then(r=>r.json());const conv=(b.conversations||[]).find(c=>c.id===cid);const charId=conv?.members?.[0];const c=(b.characters||[]).find(c=>c.id===charId);if(c){settings.lastChatId=cid;persist();return c;}}catch{}return null;}
  async function loadVoice(){S.voiceStatus=null;render();S.voiceChar=await currentCharacter();S.voiceCfg=Object.assign({provider:"browser",rate:1,pitch:1,stability:.4,similarity:.85,style:.35},S.voiceChar?.data?.voice||{});try{const k=await fetch("/api/settings/voice").then(r=>r.json());S.hasKey=!!(k.elevenlabsKey||k.env?.elevenlabs);}catch{S.hasKey=false;}render();}
  function voiceForm(){return {provider:$("#ywaProvider")?.value||"browser",voiceId:$("#ywaVoiceId")?.value.trim()||"",stability:+$("#yw_stability")?.value||.4,similarity:+$("#yw_similarity")?.value||.85,style:+$("#yw_style")?.value||.35,rate:+$("#yw_rate")?.value||1,pitch:+$("#yw_pitch")?.value||1,browserVoice:$("#ywaBrowserVoice")?.value||S.voiceCfg?.browserVoice,voiceName:$("#ywaVoiceName")?.value.trim()||"",language:$("#ywaLang")?.value||"zh-TW",previewText:$("#ywaPreview")?.value.trim()||""};}
  async function saveVoice(){if(!S.voiceChar)return toast("找不到目前角色",true);const v=Object.assign({},S.voiceCfg,voiceForm());try{const r=await fetch(`/api/characters/${encodeURIComponent(S.voiceChar.id)}`,{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify({data:{voice:v}})});if(!r.ok)throw new Error((await r.json()).error||"保存失敗");S.voiceCfg=v;S.voiceStatus={kind:"ok",text:"音色已保存到角色，以後通話與語音都會沿用。"};render();}catch(e){S.voiceStatus={kind:"bad",text:e.message};render();}}
  async function saveVoiceKey(){const key=$("#ywaKey")?.value.trim();if(!key)return toast("輸入新金鑰再保存；已保存的金鑰不需重填");try{const r=await fetch("/api/settings/voice",{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify({elevenlabsKey:key})});if(!r.ok)throw new Error("保存失敗");S.hasKey=true;toast("ElevenLabs 金鑰已保存");render();}catch(e){toast(e.message,true);}}
  async function ttsBlob(text,characterId){try{const r=await fetch("/api/tts",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({text,characterId})});return r.status===200?await r.blob():null;}catch{return null;}}
  async function testVoice(){if(!S.voiceChar)return toast("找不到角色",true);const chosen=voiceForm();await saveVoice();S.voiceStatus={kind:"",text:"正在生成試聽…"};render();
    const line=chosen.previewText||defaultPreview(chosen.language);
    if(chosen.provider==="browser"){await browserSpeak(line,[60,62,64],chosen);S.voiceStatus={kind:"ok",text:"已用瀏覽器語音試聽。"};render();return;}
    const blob=await ttsBlob(line,S.voiceChar.id);if(blob){const url=URL.createObjectURL(blob);const a=new Audio(url);hookMedia(a);a.onended=()=>URL.revokeObjectURL(url);await a.play().catch(()=>{});S.voiceStatus={kind:"ok",text:"試聽播放中。"};}else{S.voiceStatus={kind:"bad",text:"雲端 TTS 未啟用或連線失敗；請確認金鑰、Voice ID 與引擎。可改用瀏覽器中文語音。"};}render();}

  /* ---------- 播放 ---------- */
  async function refreshTracks(){
    const requestedOwner=ownerId;
    try{await migrateLegacyTracks();}catch(error){console.warn("音樂舊資料遷移未完成",error);}
    const all=await idbAll();
    if(requestedOwner!==ownerId)return;
    S.tracks=(requestedOwner?all.filter(track=>Account.owns(track,requestedOwner)):[]).sort((a,b)=>(a.createdAt||0)-(b.createdAt||0));
    S.current=S.tracks.find(track=>track.id===settings.currentId)||null;
    if(!S.current){settings.currentId=null;S.lyrics=[];S.lyricIndex=-1;}
    if(S.mini&&!$("#ywAudioRoot")){const root=document.createElement("div");root.id="ywAudioRoot";document.body.appendChild(root);}
    render();
  }
  async function toggleFavorite(id){
    const track=S.tracks.find(item=>item.id===id);if(!track)return;
    track.favorite=!track.favorite;await idbPut(track);await refreshTracks();
    toast(track.favorite?"已加入私人收藏":"已取消收藏");
  }
  function clearAccountPlayback(){
    stopSing();audio.pause();audio.removeAttribute("src");audio.load();
    if(objectUrl){URL.revokeObjectURL(objectUrl);objectUrl=null;}
    S.current=null;S.tracks=[];S.playing=false;S.lyrics=[];S.lyricIndex=-1;S.mini=false;S.chatOpen=false;S.chatMessages=[];
  }
  async function activateAccount(id){
    const next=Account.activate(id),changed=next!==ownerId;
    if(changed){
      clearAccountPlayback();ownerId=next;settings=Object.assign(defaultSettings(),Account.read(LS,{}));
      audio.volume=settings.volume;S.listFilter="all";S.composeResultId="";S.composeStatus=null;S.voiceChar=null;S.voiceCfg=null;
      if(!ownerId)S.open=false;
    }
    render();await refreshTracks();
  }
  async function resolveCloud(t){if(t.url)return t.url;if(cloudResolving)throw new Error("正在尋找試聽，請稍候");cloudResolving=true;toast("正在尋找這首歌的公開試聽…");try{const q=encodeURIComponent(`${t.name} ${t.artist||""}`);const r=await fetch(`https://itunes.apple.com/search?term=${q}&media=music&entity=song&country=TW&lang=zh_tw&limit=1`);const j=await r.json();const hit=j.results?.[0];if(!hit?.previewUrl)throw new Error("找不到公開試聽；請匯入本機音檔");t.url=hit.previewUrl;t.preview=true;t.previewName=hit.trackName||"";t.previewArtist=hit.artistName||"";t.duration=30;t.cover=hit.artworkUrl100?.replace("100x100","500x500");await idbPut(t);return t.url;}finally{cloudResolving=false;}}
  async function playTrack(id){const t=S.tracks.find(x=>x.id===id);if(!t)return;try{stopSing();settings.currentId=id;settings.lastChatId=chatId();S.current=t;S.lyrics=parseLrc(t.lyricsText);S.lyricIndex=-1;persist();const hasBlob=t.source==="local"||t.source==="elevenmusic";const src=hasBlob?URL.createObjectURL(t.blob):await resolveCloud(t);if(objectUrl){URL.revokeObjectURL(objectUrl);objectUrl=null;}if(hasBlob)objectUrl=src;audio.src=src;audio.volume=settings.volume;await audio.play();S.playing=true;S.tab="now";document.dispatchEvent(new CustomEvent("yw-music-play",{detail:{id:t.id,name:t.name,artist:t.artist||"",source:t.source,at:Date.now()}}));render();}catch(e){S.playing=false;render();toast(e.message||"播放失敗",true);}}
  async function toggle(){const t=currentTrack();if(!t){if(S.tracks[0])return playTrack(S.tracks[0].id);return open("list");}if(!audio.src)return playTrack(t.id);if(audio.paused){try{await audio.play();}catch(e){return toast(e.message,true);}}else audio.pause();}
  function step(dir){if(!S.tracks.length)return;let i=S.tracks.findIndex(t=>t.id===settings.currentId);i=(i+dir+S.tracks.length)%S.tracks.length;playTrack(S.tracks[i].id);}
  audio.addEventListener("play",()=>{S.playing=true;render();});audio.addEventListener("pause",()=>{S.playing=false;render();});audio.addEventListener("ended",()=>{if(settings.repeat==="one"){audio.currentTime=0;audio.play();}else step(1);});
  audio.addEventListener("timeupdate",()=>{const cur=$("#ywmCur"),dur=$("#ywmDur"),seek=$("#ywmSeek");if(cur)cur.textContent=fmt(audio.currentTime);if(dur)dur.textContent=fmt(audio.duration);if(seek&&!seek.matches(":active")){seek.max=audio.duration||30;seek.value=audio.currentTime;}if(S.lyrics.length){let idx=-1;for(let i=0;i<S.lyrics.length;i++){if(S.lyrics[i].time<=audio.currentTime+.12)idx=i;else break;}if(idx!==S.lyricIndex){S.lyricIndex=idx;const box=$("#ywmLyrics");if(box){box.innerHTML=lyricsHtml();const on=$(".ywm-lyric-line.on",box);if(on)box.scrollTop=Math.max(0,on.offsetTop-box.clientHeight/2+17);}}}const miniLyric=$(".ywm-mini-lyric");if(miniLyric&&S.lyrics[idxSafe(S.lyricIndex)])miniLyric.textContent=S.lyrics[S.lyricIndex].text;});
  function idxSafe(i){return i>=0?i:0;}

  /* ---------- 匯入 ---------- */
  function pickFiles(){const inp=document.createElement("input");inp.type="file";inp.accept="audio/*,.lrc";inp.multiple=true;inp.onchange=()=>importFiles([...inp.files]);inp.click();}
  async function importFiles(files){const audios=files.filter(f=>f.type.startsWith("audio/")||/\.(mp3|m4a|aac|wav|ogg|flac)$/i.test(f.name));const lrcs=files.filter(f=>/\.lrc$/i.test(f.name));if(!audios.length)return toast("請選擇音檔，也可以一起選 .lrc 歌詞",true);toast(`正在匯入 ${audios.length} 首…`);let n=0;
    for(const f of audios){try{const base=f.name.replace(/\.[^.]+$/,"");let name=base,artist="本機音樂";const parts=base.split(" - ");if(parts.length>=2){artist=parts.shift().trim();name=parts.join(" - ").trim();}const lrc=lrcs.find(l=>l.name.replace(/\.lrc$/i,"")===base);const lyricsText=lrc?await lrc.text():"";await idbPut({id:"tr_"+Date.now().toString(36)+Math.random().toString(36).slice(2,6),name,artist,source:"local",blob:f,lyricsText,createdAt:Date.now()+n});n++;}catch(e){console.warn(e);}}
    await refreshTracks();toast(`已匯入 ${n} 首，音檔只保存在這台裝置`);
  }
  function parseShare(text,source){const tracks=[];String(text).split(/\r?\n/).map(x=>x.trim()).filter(Boolean).forEach(line=>{let name="",artist="未知歌手";let m=line.match(/分享(.+?)的(?:单曲|單曲)《([^》]+)》/)||line.match(/《([^》]+)》/);if(m){if(m[2]){artist=m[1].trim();name=m[2].trim();}else{name=m[1].trim();artist=line.split("《")[0].replace(/^分享/,"").trim()||"未知歌手";}}else if(line.includes(" - ")){const p=line.split(" - ");artist=p.shift().trim();name=p.join(" - ").trim();}else if(line.includes("-")){const p=line.split("-");artist=p.shift().trim();name=p.join("-").trim();}else if(/^https?:\/\//.test(line)){return;}else{name=line.replace(/分享.*?(单曲|單曲)/,"").trim();}if(name)tracks.push({name:name.slice(0,100),artist:artist.slice(0,80),source});});return tracks;}
  async function importShare(){const text=$("#ywmShareText")?.value.trim();const found=parseShare(text,S.importSource);if(!found.length)return toast("沒有讀到歌曲，請貼上分享文字或「歌手 - 歌名」",true);for(let i=0;i<found.length;i++)await idbPut(Object.assign(found[i],{id:"tr_"+Date.now().toString(36)+Math.random().toString(36).slice(2,6)+i,lyricsText:"",createdAt:Date.now()+i}));S.importing=false;await refreshTracks();toast(`已匯入 ${found.length} 首歌曲資訊；播放時會尋找公開試聽`);}
  async function editLyrics(id){const t=S.tracks.find(x=>x.id===id);if(!t)return;const box=$("#ywmLyricEditor");box.innerHTML=`<div class="ywm-card"><div class="ywm-field"><span>「${esc(t.name)}」歌詞（支援 LRC 時間軸）</span><textarea id="ywmLrcText" placeholder="[00:01.00]第一句歌詞">${esc(t.lyricsText||"")}</textarea></div><div class="ywm-form-row"><button class="ywm-btn" data-cancel-lrc>取消</button><button class="ywm-btn red" data-save-lrc="${id}">保存歌詞</button></div></div>`;box.scrollIntoView({behavior:"smooth"});}
  async function saveLyrics(id){const t=S.tracks.find(x=>x.id===id);if(!t)return;t.lyricsText=$("#ywmLrcText")?.value||"";await idbPut(t);if(id===settings.currentId){S.lyrics=parseLrc(t.lyricsText);S.lyricIndex=-1;}await refreshTracks();toast("歌詞已保存");}

  /* ---------- 邊聽邊聊：讀寫真正的餘溫訊息 ---------- */
  function chatHtml(){return `<div class="ywm" style="background:#171717f5;z-index:2"><div class="ywm-head"><button data-chat-close>‹</button><span class="ywm-head-title">邊聽邊聊</span><span class="ywm-note" style="margin-left:auto">${esc(currentTrack()?.name||"")}</span></div><div class="ywm-body" id="ywaChatBody" style="padding:14px">${S.chatMessages.length?S.chatMessages.map(m=>`<div style="display:flex;justify-content:${m.sender==="user"?"flex-end":"flex-start"};margin:8px 0"><div style="max-width:78%;padding:9px 12px;border-radius:14px;background:${m.sender==="user"?"#ec4141":"#ffffff12"};font-size:13px;line-height:1.6;white-space:pre-wrap">${esc(m.content)}</div></div>`).join(""):`<div class="ywm-empty">說點什麼，音樂不會中斷。</div>`}</div><form id="ywaChatForm" style="display:flex;gap:8px;padding:12px;padding-bottom:calc(12px + env(safe-area-inset-bottom,0px));background:#222"><input id="ywaChatInput" style="flex:1;border:1px solid #ffffff20;background:#111;color:#fff;border-radius:20px;padding:10px 15px;outline:none" placeholder="和 TA 聊聊這首歌…" autocomplete="off"><button class="ywm-btn red" type="submit">送出</button></form></div>`;}
  async function openChat(){const cid=chatId();if(!cid)return toast("請先從角色聊天室開啟一起聽",true);S.chatOpen=true;render();await loadChat();}
  async function loadChat(){const cid=chatId();if(!cid)return;try{const j=await fetch(`/api/conversations/${encodeURIComponent(cid)}/messages?limit=30`).then(r=>r.json());const arr=Array.isArray(j)?j:(j.messages||[]);S.chatMessages=arr.filter(m=>m.kind==="text"||m.kind==="action").slice(-30);const body=$("#ywaChatBody");if(body){body.innerHTML=S.chatMessages.map(m=>`<div style="display:flex;justify-content:${m.sender==="user"?"flex-end":"flex-start"};margin:8px 0"><div style="max-width:78%;padding:9px 12px;border-radius:14px;background:${m.sender==="user"?"#ec4141":"#ffffff12"};font-size:13px;line-height:1.6;white-space:pre-wrap">${esc(m.content)}</div></div>`).join("");body.scrollTop=body.scrollHeight;}}catch{}}
  async function sendChat(text){const cid=chatId();if(!cid||!text.trim())return;try{const r=await fetch(`/api/conversations/${encodeURIComponent(cid)}/messages`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({text:text.trim()})});if(!r.ok)throw new Error("傳送失敗");await loadChat();let count=0;const timer=setInterval(async()=>{await loadChat();if(++count>=4)clearInterval(timer);},2200);}catch(e){toast(e.message,true);}}
  async function shareCurrent(){const t=currentTrack(),cid=chatId();if(!t)return;if(!cid)return toast("請先從角色聊天室開啟一起聽",true);try{const r=await fetch(`/api/conversations/${encodeURIComponent(cid)}/action`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({type:"music",title:t.name,artist:t.artist})});if(!r.ok)throw new Error("分享失敗");toast("已分享給 TA，回到聊天室繼續聊");close(true);location.hash=`#/chat/${cid}`;}catch(e){toast(e.message,true);}}

  /* ---------- 漂浮窗 ---------- */
  function miniHtml(){const t=currentTrack();return `<div class="ywm-mini" id="ywmMini"><div class="ywm-mini-cover">${t.cover?`<img src="${esc(t.cover)}">`:""}</div><div class="ywm-mini-info" data-mini-open><div class="ywm-mini-name">${esc(t.name)} · ${esc(t.artist)}</div><div class="ywm-mini-lyric">${esc(S.lyrics[S.lyricIndex]?.text||"正在一起聽")}</div></div><button data-toggle>${S.playing?"⏸":"▶"}</button><button class="ywm-mini-close" data-mini-close>×</button></div>`;}
  function renderMini(){/* 全螢幕與漂浮窗由同一個 root 管理，避免重複 */}
  function makeMiniDraggable(){const el=$("#ywmMini");if(!el)return;let start=null;el.addEventListener("pointerdown",e=>{if(e.target.closest("button,[data-mini-open]"))return;start={x:e.clientX,y:e.clientY,left:el.offsetLeft,top:el.offsetTop};el.setPointerCapture(e.pointerId);});el.addEventListener("pointermove",e=>{if(!start)return;el.style.left=Math.max(4,Math.min(innerWidth-el.offsetWidth-4,start.left+e.clientX-start.x))+"px";el.style.top=Math.max(4,Math.min(innerHeight-el.offsetHeight-4,start.top+e.clientY-start.y))+"px";el.style.right="auto";el.style.bottom="auto";});el.addEventListener("pointerup",()=>start=null);}

  function backToChat(){S.open=false;S.mini=false;settings.mini=false;persist();render();const cid=chatId();if(cid&&!location.hash.includes("/chat/"))location.hash=`#/chat/${encodeURIComponent(cid)}`;}

  /* ---------- 事件委派 ---------- */
  function wire(){const root=$("#ywAudioRoot");if(!root)return;root.onclick=e=>{const b=e.target.closest("button,[data-track],[data-mini-open]");if(!b)return;
    if(b.dataset.tab){syncComposeForm();S.tab=b.dataset.tab;S.importing=false;render();if((S.tab==="voice"||S.tab==="compose")&&!S.voiceCfg)loadVoice();return;}
    if(b.dataset.filter){S.listFilter=b.dataset.filter;S.tab="list";render();return;}
    if(b.hasAttribute("data-close"))return close(true);if(b.hasAttribute("data-back"))return backToChat();if(b.hasAttribute("data-toggle"))return toggle();if(b.hasAttribute("data-prev"))return step(-1);if(b.hasAttribute("data-next"))return step(1);
    if(b.hasAttribute("data-repeat")){settings.repeat=settings.repeat==="one"?"list":"one";persist();render();return;}
    if(b.hasAttribute("data-chat"))return openChat();if(b.hasAttribute("data-chat-close")){S.chatOpen=false;render();return;}if(b.hasAttribute("data-share"))return shareCurrent();
    if(b.dataset.track)return playTrack(b.dataset.track);if(b.dataset.import==="local")return pickFiles();if(b.dataset.import==="netease"&&window.YWNcm){window.YWNcm.open().then(ok=>{if(ok)return;toast("連不上手機上的網易雲伺服器（ncm_web），先改用貼上分享文字",true);S.importSource="netease";S.importing=true;render();});return;}
    if(b.dataset.import){S.importSource=b.dataset.import;S.importing=true;render();return;}
    if(b.hasAttribute("data-cancel-import")){S.importing=false;render();return;}if(b.hasAttribute("data-parse-import"))return importShare();
    if(b.dataset.favorite)return toggleFavorite(b.dataset.favorite);
    if(b.dataset.lyric)return editLyrics(b.dataset.lyric);if(b.dataset.del){idbDel(b.dataset.del).then(async()=>{if(settings.currentId===b.dataset.del){audio.pause();audio.removeAttribute("src");settings.currentId=null;S.current=null;persist();}await refreshTracks();});return;}
    if(b.hasAttribute("data-cancel-lrc")){$("#ywmLyricEditor").innerHTML="";return;}if(b.dataset.saveLrc)return saveLyrics(b.dataset.saveLrc);
    if(b.hasAttribute("data-save-key"))return saveVoiceKey();if(b.hasAttribute("data-save-voice"))return saveVoice();if(b.hasAttribute("data-test-voice"))return testVoice();
    if(b.dataset.preset){const inp=$("#ywaVoiceName");if(inp)inp.value=b.dataset.preset;$$(".ywm-chip",root).forEach(c=>c.classList.toggle("on",c===b));return;}
    if(b.dataset.musicExample!=null){syncComposeForm();const x=MUSIC_EXAMPLES[+b.dataset.musicExample];S.compose={...S.compose,title:x.title,prompt:x.prompt,instrumental:x.instrumental};S.composeStatus=null;render();return;}
    if(b.hasAttribute("data-compose-music"))return composeMusic();if(b.dataset.playGenerated)return playTrack(b.dataset.playGenerated);
    if(b.dataset.sing!=null)return startSing(+b.dataset.sing);if(b.hasAttribute("data-stop-sing"))return stopSing();
    if(b.hasAttribute("data-mini-open")){S.open=true;S.mini=false;settings.mini=false;persist();render();return;}if(b.hasAttribute("data-mini-close")){S.mini=false;settings.mini=false;persist();render();return;}
  };
    root.oninput=e=>{if(e.target.dataset.slider){const out=$(`#yw_${e.target.dataset.slider}_val`);if(out)out.textContent=(+e.target.value).toFixed(2);}if(e.target.id==="ywmSeek"){audio.currentTime=+e.target.value;}
    if(e.target.id==="ywmComposePrompt"||e.target.id==="ywmComposeTitle"){syncComposeForm();const count=$("#ywmPromptCount");if(count)count.textContent=`${[...S.compose.prompt].length}／2000`;const submit=$("[data-compose-music]",root);if(submit)submit.disabled=!S.hasKey||S.composing||[...S.compose.prompt].length<4;}};
    root.onchange=e=>{if(e.target.id==="ywaProvider"){$("#ywaVoiceIdWrap")?.classList.toggle("ywa-hidden",e.target.value==="browser");$("#ywaBrowserVoiceWrap")?.classList.toggle("ywa-hidden",e.target.value!=="browser");}
    if(e.target.id==="ywmComposeDuration"||e.target.id==="ywmComposeInstrumental")syncComposeForm();
    if(e.target.id==="ywaAsrLang"){try{localStorage.setItem("yw_asr_lang",e.target.value);}catch{}toast("語音辨識語言已更新，下一通電話生效");}
    if(e.target.id==="ywaCallMem"){try{localStorage.setItem("yw_call_memory",e.target.checked?"on":"off");}catch{}toast(e.target.checked?"通話摘要會記進 TA 的記憶":"通話摘要不會再寫入記憶");}};
    const form=$("#ywaChatForm",root);if(form)form.onsubmit=e=>{e.preventDefault();const inp=$("#ywaChatInput");const text=inp.value;inp.value="";sendChat(text);};
    makeMiniDraggable();
  }

  /* ---------- 聊天室與通話入口 ---------- */
  function ensureChatButton(){const cid=location.hash.match(/#\/chat\/([^/?&#]+)/);if(!cid)return;settings.lastChatId=decodeURIComponent(cid[1]);persist();const composer=$(".composer.glass")||$(".composer");if(!composer||$(".ywa-chat-btn",composer))return;const b=document.createElement("button");b.type="button";b.className="ywa-chat-btn";b.title="一起聽・音色・唱歌";b.textContent="🎧";b.onclick=()=>open("now");const plus=$(".cbtn.plus",composer);composer.insertBefore(b,plus||composer.firstChild);}
  function ensureCallViz(){const call=$(".call");if(!call||$(".ywa-callviz",call))return;const top=$(".top",call);if(!top)return;const box=document.createElement("div");box.className="ywa-callviz";box.innerHTML=`<canvas width="660" height="132" role="img" aria-label="目前沒有可分析音訊"></canvas><div class="ywa-callviz-label">AUDIO IDLE // 等待真實音訊</div><div class="ywa-asr-status" aria-live="polite"></div><button type="button" class="ywa-sing-call">音色與唱歌 ↗</button>`;top.appendChild(box);$("button",box).onclick=()=>open("voice");updateAsrPill(lastAsr);}
  /* ---------- 通話中的語音辨識狀態提示 ---------- */
  let lastAsr=null;
  const ASR_HINT={"not-allowed":"麥克風權限被擋下了。請在網址列允許麥克風，再重開麥克風。","service-not-allowed":"這個瀏覽器不允許語音辨識服務，可改用「打字」。","audio-capture":"找不到麥克風裝置，請檢查耳機／麥克風連線。","network":"辨識服務連線失敗（瀏覽器語音辨識需要連網，部分地區可能無法使用），可改用「打字」。","no-speech":"沒有聽到聲音，靠近麥克風再試一次。","language-not-supported":"瀏覽器不支援目前的辨識語言，可到「一起聽 › 音色」更換。","unknown":"語音辨識發生問題，可改用「打字」。"};
  function updateAsrPill(d){lastAsr=d;$$(".ywa-asr-status").forEach(el=>{if(!d||d.state==="ended"||d.state==="listening"){el.className="ywa-asr-status"+(d?.state==="listening"?" on":"");el.innerHTML=d?.state==="listening"?`<span class="ywa-rec"></span>聆聽中・你說話時 TA 會先停下來`:"";return;}if(d.state==="speaking"){el.className="ywa-asr-status on speaking";el.textContent="聽到你的聲音了…";return;}if(d.state==="error"){el.className="ywa-asr-status err";el.textContent="⚠ "+(ASR_HINT[d.error]||ASR_HINT.unknown);}});}
  document.addEventListener("yw-asr-status",e=>updateAsrPill(e.detail));

  /* 即時音波與 RAF 由 yw-call-monitor.js 統一管理；沒有真實音訊時保持平線。 */

  window.__ywAudio={
    get ducked(){return duckCount>0},get volume(){return audio.volume},get asrState(){return lastAsr},
    get open(){return S.open},get playing(){return S.playing},get current(){return currentTrack()},get ownerId(){return ownerId},
    get tracks(){return S.tracks.map(track=>({...track}))},
    audioEl:audio,playTrack,refreshTracks,toggleFavorite,currentChatId:()=>chatId(),back:backToChat,openPanel:(tab)=>open(tab),
    readOutputSpectrum:()=>{if(!analyser||!freqData)return null;analyser.getByteFrequencyData(freqData);return new Uint8Array(freqData);}
  };
  document.addEventListener("yowen:authenticated",event=>activateAccount(event.detail?.id).catch(error=>toast(error.message,true)));
  document.addEventListener("yowen:logout",()=>activateAccount("").catch(()=>{}));

  let queued=false;const observer=new MutationObserver(()=>{if(queued)return;queued=true;setTimeout(()=>{queued=false;ensureChatButton();ensureCallViz();},250);});observer.observe(document.documentElement,{childList:true,subtree:true});
  document.addEventListener("DOMContentLoaded",()=>setTimeout(()=>{refreshTracks();ensureChatButton();ensureCallViz();},600),{once:true});
  setTimeout(refreshTracks,500);
})();
