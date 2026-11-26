/* 餘溫通話：真實麥克風音量、VAD 插話與可清理的音訊視覺化 */
(() => {
  "use strict";
  const $ = (s, el=document) => el.querySelector(s);
  const $$ = (s, el=document) => [...el.querySelectorAll(s)];
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const ASR_HINT={"not-allowed":"麥克風權限被擋下了。請在網址列允許麥克風，再重開麥克風。","service-not-allowed":"這個瀏覽器不允許語音辨識服務，可改用「打字」。","audio-capture":"找不到麥克風裝置，請檢查耳機／麥克風連線。","network":"辨識服務連線失敗；麥克風音量與辨識服務是兩條管線，可改用「打字」。","no-speech":"辨識服務沒有回傳語音；請查看下方麥克風音量狀態。","language-not-supported":"瀏覽器不支援目前的辨識語言，可到「一起聽 › 音色」更換。","unknown":"語音辨識發生問題，可改用「打字」。"};
  let asr=null, micError="", stream=null, ctx=null, sourceNode=null, micAnalyser=null, pcm=null;
  let starting=false, attempt=0, raf=0, micState="idle", startedAt=0, lastTranscriptAt=0, lastInputAt=0, maxRms=0;
  let above=0, below=0, vadSpeaking=false, lastInterrupt=0, rawRms=0, level=0, noise=.006, drawSource="idle";
  let bars=new Array(42).fill(0), lastStatusRender=0, lastGlow=-1;

  function dispatchInterrupt(){
    const now=performance.now(); if(now-lastInterrupt<1600)return; lastInterrupt=now;
    document.dispatchEvent(new CustomEvent("yw-voice-interrupt",{detail:{source:"mic-vad",at:Date.now()}}));
  }
  function fatalAsr(error){return ["not-allowed","service-not-allowed","audio-capture","language-not-supported"].includes(error);}
  function onAsr(e){
    asr=e.detail||null;
    if(asr?.state==="listening"){lastTranscriptAt=performance.now();ensureMic();}
    if(asr?.state==="speaking"){lastTranscriptAt=performance.now();ensureMic();}
    if(asr?.state==="error"&&fatalAsr(asr.error))stopMic();
    if(asr?.state==="ended"){stopMic();micError="";}
    renderStatus(true);ensureLoop();
  }
  document.addEventListener("yw-asr-status",onAsr);

  async function ensureMic(){
    if(stream||starting||micError||!$(".call"))return;
    if(!navigator.mediaDevices?.getUserMedia){micError="這個瀏覽器無法讀取麥克風音量；ASR 與打字仍可使用。";renderStatus(true);return;}
    starting=true;const token=++attempt;let pendingStream=null;
    try{
      const nextStream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false});pendingStream=nextStream;
      if(token!==attempt||!$(".call")||!["listening","speaking"].includes(asr?.state)){nextStream.getTracks().forEach(t=>t.stop());return;}
      const AC=window.AudioContext||window.webkitAudioContext;if(!AC)throw new Error("audio-context");
      ctx=new AC();micAnalyser=ctx.createAnalyser();micAnalyser.fftSize=1024;micAnalyser.smoothingTimeConstant=0;
      pcm=new Float32Array(micAnalyser.fftSize);sourceNode=ctx.createMediaStreamSource(nextStream);sourceNode.connect(micAnalyser); // 不接 destination，避免麥克風回放
      stream=nextStream;pendingStream=null;micState="active";startedAt=lastTranscriptAt=performance.now();lastInputAt=0;maxRms=0;noise=.006;vadSpeaking=false;above=below=0;
      await ctx.resume?.().catch(()=>{});
      stream.getTracks().forEach(track=>track.addEventListener?.("ended",()=>{if(stream===nextStream)stopMic();},{once:true}));
      renderStatus(true);ensureLoop();
    }catch(error){
      if(token!==attempt)return;
      micError=error?.name==="NotAllowedError"?"麥克風權限被擋下了；請允許權限後重新開麥。":error?.name==="NotFoundError"?"找不到麥克風裝置；請檢查耳機或輸入裝置。":"麥克風音量監測啟動失敗；可改用打字。";
      micState="error";pendingStream?.getTracks().forEach(t=>t.stop());stream?.getTracks().forEach(t=>t.stop());pendingStream=null;stream=null;
      try{await ctx?.close?.();}catch{}ctx=null;renderStatus(true);
    }finally{if(token===attempt)starting=false;}
  }

  function stopMic(){
    ++attempt;starting=false;const oldStream=stream;stream=null;
    oldStream?.getTracks().forEach(track=>{try{track.stop();}catch{}});
    try{sourceNode?.disconnect();}catch{}try{micAnalyser?.disconnect();}catch{}
    sourceNode=null;micAnalyser=null;pcm=null;const oldCtx=ctx;ctx=null;try{const closing=oldCtx?.close?.();closing?.catch?.(()=>{});}catch{}
    micState="idle";vadSpeaking=false;above=below=0;rawRms=level=0;bars.fill(0);maxRms=0;lastInputAt=0;
    $(".call")?.classList.remove("ywa-input-active");renderStatus(true);
  }
  window.addEventListener("pagehide",()=>{stopMic();if(raf){cancelAnimationFrame(raf);raf=0;}});

  function renderStatus(force=false){
    const now=performance.now();if(!force&&now-lastStatusRender<240)return;lastStatusRender=now;
    $$(".ywa-asr-status").forEach(el=>{
      let cls="ywa-asr-status",html="";
      if(asr?.state==="error"){cls+=" err";html="⚠ "+(ASR_HINT[asr.error]||ASR_HINT.unknown);}
      else if(micState==="speaking"){cls+=" on speaking";html="聽到你的聲音了・已停止 TA 播放";}
      else if(asr?.state==="speaking"){cls+=" on speaking";html="辨識服務收到語音…";}
      else if(asr?.state==="listening"||stream){
        cls+=" on";
        if(micError)html=`<span class="ywa-rec"></span>聆聽中・音量監測未啟用，ASR 仍進行中`;
        else if(lastInputAt&&now-startedAt>2800&&now-lastTranscriptAt>2800)html=`<span class="ywa-rec"></span>麥克風有音量，辨識服務尚未回傳文字`;
        else if(now-startedAt>3500&&maxRms<.004)html=`<span class="ywa-rec"></span>麥克風已連接，尚未偵測到音量`;
        else html=`<span class="ywa-rec"></span>聆聽中・你說話時 TA 會先停下來`;
      }
      else if(micError){cls+=" err";html="⚠ "+micError;}
      el.className=cls;el.innerHTML=html;
    });
  }

  function ensureLoop(){if(!raf&&($(".ywa-callviz canvas")||stream))raf=requestAnimationFrame(tick);}
  function tick(now){
    raf=0;const canvas=$(".ywa-callviz canvas");if(!canvas&&!stream){drawSource="idle";return;}
    let target=0,nextSource="idle",output=null;
    if(stream&&micAnalyser&&pcm){
      micAnalyser.getFloatTimeDomainData(pcm);let sum=0;for(let i=0;i<pcm.length;i++)sum+=pcm[i]*pcm[i];rawRms=Math.sqrt(sum/pcm.length);maxRms=Math.max(maxRms,rawRms);
      if(rawRms>.006)lastInputAt=now;
      noise=rawRms<noise?noise*.98+rawRms*.02:noise*.995+rawRms*.005;
      const threshold=Math.max(.02,noise*2.8);
      if(rawRms>threshold){above++;below=0;}else{below++;above=0;}
      if(!vadSpeaking&&above>=3){vadSpeaking=true;micState="speaking";dispatchInterrupt();renderStatus(true);}
      if(vadSpeaking&&below>=14){vadSpeaking=false;micState="active";renderStatus(true);}
      target=Math.min(1,rawRms*5);nextSource=rawRms>.0005?"mic":"idle";
    }else if($(".call .st")?.textContent.includes("對方正在說話")){
      output=window.__ywAudio?.readOutputSpectrum?.()||null;
      if(output&&output.some(v=>v>0)){let sum=0;output.forEach(v=>sum+=v);target=Math.min(1,sum/output.length/170);nextSource="output";}
    }
    drawSource=nextSource;level=reduced.matches?target:level+(target-level)*.18;
    if(canvas)draw(canvas,output,reduced.matches?target:undefined);
    const call=$(".call");if(call){call.classList.toggle("ywa-input-active",drawSource==="mic"&&level>.015);const glow=reduced.matches?0:Math.round(level*22);if(glow!==lastGlow){call.style.setProperty("--ywa-glow",glow+"px");lastGlow=glow;}}
    if(level<.001)level=0;bars=bars.map(v=>v<.001?0:v);
    const outputActive=$(".call .st")?.textContent.includes("對方正在說話");
    renderStatus();if(stream||outputActive||level>0||bars.some(v=>v>0))raf=requestAnimationFrame(tick);else drawSource="idle";
  }

  function draw(canvas,output,exactTarget){
    const c=canvas.getContext("2d"),w=canvas.width,h=canvas.height;c.clearRect(0,0,w,h);
    for(let i=0;i<bars.length;i++){
      let target=0;
      if(drawSource==="mic"&&pcm){const size=Math.floor(pcm.length/bars.length),start=i*size;let sum=0;for(let j=start;j<start+size;j++)sum+=pcm[j]*pcm[j];target=Math.min(1,Math.sqrt(sum/size)*5);}
      else if(drawSource==="output"&&output){target=Math.min(1,(output[Math.floor(i*output.length/bars.length)]||0)/170);}
      bars[i]=reduced.matches?target:bars[i]+(target-bars[i])*.18;
      const bh=Math.max(2,bars[i]*h*.88),x=i*(w/bars.length);
      c.fillStyle=drawSource==="idle"?"rgba(120,120,120,.48)":drawSource==="mic"?"#fafafa":"#d4d4d0";
      c.fillRect(x,h/2-bh/2,Math.max(2,w/bars.length*.42),bh);
    }
    if(canvas.dataset.source!==drawSource){canvas.dataset.source=drawSource;canvas.setAttribute("aria-label",drawSource==="mic"?"麥克風即時音波":drawSource==="output"?"角色輸出即時音波":"目前沒有可分析音訊");const label=$(".ywa-callviz-label");if(label)label.textContent=drawSource==="mic"?"MIC INPUT // 麥克風即時輸入":drawSource==="output"?"VOICE OUTPUT // 角色輸出":"AUDIO IDLE // 等待真實音訊";}
  }

  let queued=false;const observer=new MutationObserver(()=>{if(queued)return;queued=true;setTimeout(()=>{queued=false;if(!$(".call")&&(stream||starting||micState!=="idle"))stopMic();ensureLoop();},300);});observer.observe(document.documentElement,{childList:true,subtree:true});
  document.addEventListener("DOMContentLoaded",ensureLoop,{once:true});
  window.__ywCallMonitor={get asr(){return asr},get micState(){return micState},get rawRms(){return rawRms},get level(){return level},get drawSource(){return drawSource},get running(){return !!stream},get rafActive(){return !!raf},get contextState(){return ctx?.state||"closed"},stop:stopMic};
})();
