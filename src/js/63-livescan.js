// ---------------------------------------------------------------- live scan
// Scanning while you walk, so the phone can choose its own views: it keeps one only when you are steady (so it
// is sharp) and have reached an angle it does not have yet (so it adds something), and says what to do next.
// Two ways in:
//  - with the phone's own AR tracking (WebXR with camera access: Chrome on Android, through ARCore). Every view
//    arrives with where the camera was, in metres, so nothing has to be worked out afterwards, and a ring
//    shows which sides are covered. The phone's depth sensor, where it has one, sets true scale.
//  - otherwise the camera alone: views are kept when sharp and new, then placed as a video scan is.
// Nothing leaves the phone. There are no timers: it waits for you.

const LIVE = { max: MOBILE ? 36 : 44, min: 8, ring: 16, bands: 3 };
let liveState = null;

function liveCue(text, speak){
  const L=liveState; if (!L || L.cueText===text) return; L.cueText=text; $('#liveCue').textContent=text;
  if (speak && L.voice) say(text);
}
function liveCount(){ const L=liveState, n=L.views.length; $('#liveCount').textContent = `${n} ${n===1?'view':'views'}`; $('#liveDone').disabled = n < LIVE.min; }
// the coverage ring: sixteen directions around the subject, in three bands from low to high
function liveRing(){
  const L=liveState, svg=$('#liveRing'); if (!L.xr){ svg.hidden=true; return; } svg.hidden=false; let s='';
  for (let b=0;b<LIVE.bands;b++) for (let k=0;k<LIVE.ring;k++){
    const r0=22+b*12, r1=r0+10, a0=(k/LIVE.ring)*2*Math.PI-Math.PI/2+0.03, a1=((k+1)/LIVE.ring)*2*Math.PI-Math.PI/2-0.03;
    const P=(r,a)=>`${(r*Math.cos(a)).toFixed(2)} ${(r*Math.sin(a)).toFixed(2)}`;
    s+=`<path d="M${P(r0,a0)} L${P(r1,a0)} A${r1} ${r1} 0 0 1 ${P(r1,a1)} L${P(r0,a1)} A${r0} ${r0} 0 0 0 ${P(r0,a0)}Z" class="${L.cover.has(b*LIVE.ring+k)?'on':''}"/>`; }
  // where you are now
  if (L.here) { const a=(L.here[0]/LIVE.ring)*2*Math.PI-Math.PI/2, r=22+L.here[1]*12+5; s+=`<circle cx="${(r*Math.cos(a)).toFixed(1)}" cy="${(r*Math.sin(a)).toFixed(1)}" r="3.4" class="me"/>`; }
  svg.innerHTML=s;
}
// When the views fill up, every second one is let go and the next ones must be twice as far apart, so the
// scan always spans the whole walk, however long it is, and the phone never holds more than it can work on.
function liveThin(){ const L=liveState; L.views = L.views.filter((_,i)=>i%2===0); L.space *= 2;
  if (L.xr){ L.cover = new Set(L.views.filter(v=>v.cell).map(v=>v.cell[1]*LIVE.ring+v.cell[0])); liveRing(); }
  liveCount(); liveCue('Spreading the views out, so the whole walk fits', true); }
function liveThumb(data, w, h){ const c=$('#liveThumb'), x=c.getContext('2d'), t=document.createElement('canvas'); t.width=w; t.height=h;
  t.getContext('2d').putImageData(new ImageData(data, w, h), 0, 0); const s=Math.min(c.width/w, c.height/h); x.clearRect(0,0,c.width,c.height);
  x.drawImage(t, (c.width-w*s)/2, (c.height-h*s)/2, w*s, h*s); c.hidden=false; }

async function openLiveScan(){
  let xr=false; try { xr = !!navigator.xr && await navigator.xr.isSessionSupported('immersive-ar'); } catch(e){}
  liveState = {xr, views:[], cover:new Set(), cueText:'', voice:true, done:false, space:1};
  $('#live').hidden=false; $('#liveStart').hidden=false; $('#liveDone').hidden=true; $('#liveThumb').hidden=true; $('#liveRing').hidden=true;
  $('#liveVoice').setAttribute('aria-pressed','true'); liveCount();
  $('#liveIntro').textContent = xr
    ? 'Walk slowly around the thing you want to scan. The phone tracks where it is and keeps a view each time you are steady at a new angle. The ring fills in as the sides are covered.'
    : 'Walk slowly around the thing you want to scan. The phone keeps a view each time you are steady at a new angle.';
  $('#liveIntro').hidden=false; liveCue('Tap Start when you are ready', false);
}
function closeLive(){ const L=liveState; if (L){ L.done=true; try{ L.session?.end().catch(()=>{}); }catch(e){} L.stream?.getTracks().forEach(t=>t.stop()); }
  const v=$('#liveVid'); v.srcObject=null; v.removeAttribute('src'); v.hidden=true; $('#live').hidden=true; document.body.classList.remove('xr'); liveState=null; }

// ---- with the phone's AR tracking
async function liveXR(){
  const L=liveState;
  const session = await navigator.xr.requestSession('immersive-ar', {
    requiredFeatures:['camera-access', 'local'], optionalFeatures:['dom-overlay', 'depth-sensing'], domOverlay:{root:$('#live')},
    depthSensing:{usagePreference:['cpu-optimized'], dataFormatPreference:['luminance-alpha', 'float32']} });
  L.session=session; document.body.classList.add('xr');
  const cv=document.createElement('canvas'), gl=cv.getContext('webgl2', {xrCompatible:true, alpha:true, antialias:false});
  await gl.makeXRCompatible?.();
  session.updateRenderState({baseLayer: new XRWebGLLayer(session, gl)});
  const ref = await session.requestReferenceSpace('local'), bind = new XRWebGLBinding(session, gl);
  L.depthOn = session.enabledFeatures ? session.enabledFeatures.includes('depth-sensing') : true;   // older Chrome does not list them; then just try
  // copying the camera picture: draw it into a small texture of our own, then read the pixels back
  const vs=`#version 300 es\nin vec2 p; out vec2 uv; void main(){ uv=p*0.5+0.5; gl_Position=vec4(p,0.,1.); }`;
  const fs=`#version 300 es\nprecision mediump float; uniform sampler2D t; in vec2 uv; out vec4 o; void main(){ o=texture(t, uv); }`;
  const sh=(type,src)=>{ const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s); return s; };
  const prog=gl.createProgram(); gl.attachShader(prog, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(prog);
  const vao=gl.createVertexArray(), buf=gl.createBuffer(); gl.bindVertexArray(vao); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
  const loc=gl.getAttribLocation(prog,'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc,2,gl.FLOAT,false,0,0); gl.bindVertexArray(null);
  let fbo=null, ftex=null, FW=0, FH=0;
  const grab = (tex, cw, ch) => {
    const s=Math.min(1, 640/Math.max(cw,ch)), W=Math.round(cw*s), H=Math.round(ch*s);
    if (W!==FW || H!==FH){ FW=W; FH=H; ftex=gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, ftex); gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, W, H);
      fbo=gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, ftex, 0); }
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.viewport(0,0,W,H); gl.disable(gl.BLEND); gl.useProgram(prog);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(gl.getUniformLocation(prog,'t'), 0);
    gl.bindVertexArray(vao); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); gl.bindVertexArray(null);
    const px=new Uint8Array(W*H*4); gl.readPixels(0,0,W,H,gl.RGBA,gl.UNSIGNED_BYTE,px);
    // GL rows run bottom to top; pictures run top to bottom
    const out=new Uint8ClampedArray(W*H*4); for (let y=0;y<H;y++) out.set(px.subarray((H-1-y)*W*4, (H-y)*W*4), y*W*4);
    for (let i=3;i<out.length;i+=4) out[i]=255;
    return {data:out, w:W, h:H};
  };
  let prev=null, anchor=null, lastSay=0;
  const ended = new Promise(res=>session.addEventListener('end', res, {once:true}));
  const onFrame = (t, frame) => {
    if (L.done) return; session.requestAnimationFrame(onFrame);
    const bl=session.renderState.baseLayer; gl.bindFramebuffer(gl.FRAMEBUFFER, bl.framebuffer); gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT);
    const pose=frame.getViewerPose(ref);
    if (!pose || pose.emulatedPosition){ liveCue('Finding its bearings. Move the phone slowly from side to side.', true); prev=null; return; }
    const view=pose.views[0], m=view.transform.matrix, c=[m[12],m[13],m[14]], fwd=[-m[8],-m[9],-m[10]];
    // how fast the phone is moving and turning: a still phone gives a sharp picture
    let lin=0, ang=0; if (prev && t>prev.t){ const dt=(t-prev.t)/1000; lin=Math.hypot(c[0]-prev.c[0], c[1]-prev.c[1], c[2]-prev.c[2])/dt;
      ang=Math.acos(Math.min(1, fwd[0]*prev.f[0]+fwd[1]*prev.f[1]+fwd[2]*prev.f[2]))/dt; }
    prev={t, c, f:fwd};
    // where the phone is around the subject, for the ring
    const cell = () => { if (!anchor) return null; const d=[c[0]-anchor[0], c[1]-anchor[1], c[2]-anchor[2]], r=Math.hypot(...d)||1;
      const az=Math.atan2(d[0], d[2]), el=Math.asin(Math.max(-1, Math.min(1, d[1]/r)));
      return [((Math.round(az/(2*Math.PI)*LIVE.ring)%LIVE.ring)+LIVE.ring)%LIVE.ring, el < 0.26 ? 0 : el < 0.79 ? 1 : 2]; };
    const here=cell(); if (here && (!L.here || here[0]!==L.here[0] || here[1]!==L.here[1])){ L.here=here; liveRing(); }
    // too fast above 22 cm/s or 26 degrees/s, steady again below 15 cm/s and 17 degrees/s (so the advice does not flicker)
    if (!L.slow && (lin > 0.22 || ang > 0.45)) L.slow = true; else if (L.slow && lin < 0.15 && ang < 0.3) L.slow = false;
    const steady = !L.slow;
    // new enough: at least 7 cm or 9 degrees from every view already kept
    let novel = Infinity; for (const v of L.views){ const dp=Math.hypot(c[0]-v.c[0], c[1]-v.c[1], c[2]-v.c[2]), da=Math.acos(Math.min(1, fwd[0]*v.f[0]+fwd[1]*v.f[1]+fwd[2]*v.f[2]));
      novel = Math.min(novel, Math.max(dp/(0.08*L.space), da/(0.175*L.space))); }
    if (L.views.length >= LIVE.max) liveThin();
    if (!steady) liveCue('A little slower', t-lastSay > 2500 && (lastSay=t, true));
    else if (novel >= 1 && view.camera){
      const tex=bind.getCameraImage(view.camera); if (!tex) return;
      const img=grab(tex, view.camera.width, view.camera.height);
      gl.bindFramebuffer(gl.FRAMEBUFFER, bl.framebuffer);
      // depth from the phone's sensor, on a grid over the picture, where it has one
      const samples=[]; if (L.depthOn) try { const di=frame.getDepthInformation(view); if (di){ const gw=18, gh=Math.max(8, Math.round(18*img.h/img.w));
        for (let y=0;y<gh;y++) for (let x=0;x<gw;x++){ const u=(x+.5)/gw, v=(y+.5)/gh, z=di.getDepthInMeters(u, v); if (z>0.05 && z<8) samples.push([u, v, z]); } } } catch(e){}
      const P=view.projectionMatrix, K={tanX:1/P[0], tanY:1/P[5], ox:-P[8], oy:-P[9]};
      const R=[m[0],m[4],m[8], m[1],m[5],m[9], m[2],m[6],m[10]];
      if (!anchor){ const zc = samples.length ? samples.map(s=>s[2]).sort((a,b)=>a-b)[samples.length>>1] : 0.6; anchor=[c[0]+fwd[0]*zc, c[1]+fwd[1]*zc, c[2]+fwd[2]*zc]; }
      const cl=cell(); if (cl) L.cover.add(cl[1]*LIVE.ring+cl[0]); L.here=cl;
      L.views.push({img, pose:{s:1, R, t:c}, K, samples, c, f:fwd, cell:cl});
      navigator.vibrate?.(12); liveCount(); liveRing(); liveThumb(img.data, img.w, img.h);
      const n=L.views.length, high=[...L.cover].filter(k=>k>=LIVE.ring).length;
      liveCue(n===1 ? 'Got the first view. Now walk slowly around it.' : n>=14 && high<3 ? 'Now a few from higher up, looking down at it' : 'Keep going slowly around it', n===1 || (n>=14 && high<3));
    }
    else if (L.views.length===0) liveCue('Point at what you want to scan, and hold still', false);
    else liveCue('Keep going slowly around it', false);
  };
  session.requestAnimationFrame(onFrame);
  liveCue('Point at what you want to scan, and hold still', true);
  return ended;
}

// ---- with the camera alone
async function liveCamera(){
  const L=liveState, v=$('#liveVid');
  // testing only: a video file stands in for the camera, stepped through at 15 frames a second
  const test = window.__liveSrc;
  if (test){ v.src=test; await new Promise(r=>{ v.onloadeddata=r; }); }
  else { L.stream = await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}, width:{ideal:1920}, height:{ideal:1080}}, audio:false}); v.srcObject=L.stream; }
  v.hidden=false; v.muted=true; v.playsInline=true; if (!test) await v.play();
  const next = f => { if (!test) return v.requestVideoFrameCallback ? v.requestVideoFrameCallback(f) : requestAnimationFrame(f);
    if (v.currentTime + 1/15 >= v.duration){ L.finish?.(); return; } v.onseeked = () => f(); v.currentTime += 1/15; };
  // the phone's gyro, where there is one, says when it is still
  let rot=0; const onMotion = e => { const r=e.rotationRate; if (r) rot=Math.hypot(r.alpha||0, r.beta||0, r.gamma||0); };
  window.addEventListener('devicemotion', onMotion);
  const small=document.createElement('canvas'), sx=small.getContext('2d', {willReadFrequently:true}), recent=[];
  let lastThumb=null, locked=false;
  const thumbOf = (data, w, h) => { const TW=24, TH=Math.max(8, Math.round(24*h/w)), t=new Float32Array(TW*TH); let mu=0, sd=0;
    for (let y=0;y<TH;y++) for (let x=0;x<TW;x++){ const k=(((y+.5)/TH*h|0)*w + ((x+.5)/TW*w|0))*4; t[y*TW+x]=data[k]+data[k+1]+data[k+2]; mu+=t[y*TW+x]; }
    mu/=t.length; for (let k=0;k<t.length;k++){ t[k]-=mu; sd+=t[k]*t[k]; } sd=Math.sqrt(sd)||1; for (let k=0;k<t.length;k++) t[k]/=sd; return t; };
  const corr = (a, b) => { let s=0; for (let k=0;k<a.length;k++) s+=a[k]*b[k]; return s; };
  let lastSay=0;
  const step = () => {
    if (L.done || v.ended){ window.removeEventListener('devicemotion', onMotion); return; }
    const W0=v.videoWidth, H0=v.videoHeight; if (!W0){ next(step); return; }
    const s=160/Math.max(W0,H0), w=Math.round(W0*s), h=Math.round(H0*s); small.width=w; small.height=h; sx.drawImage(v,0,0,w,h);
    const d=sx.getImageData(0,0,w,h).data, sh=sharpness(d, w, h), th=thumbOf(d, w, h);
    recent.push(sh); if (recent.length>40) recent.shift(); const med=recent.slice().sort((a,b)=>a-b)[recent.length>>1];
    if (!L.slow && rot > 35) L.slow = true; else if (L.slow && rot < 22) L.slow = false;       // degrees a second, with a gap so the advice does not flicker
    const moved = lastThumb ? 1-corr(th, lastThumb) : 1, still = !L.slow, sharp = sh >= 0.8*med;
    // Without the phone's tracking, neighbouring views must overlap to be placed afterwards, so they cannot be
    // thinned out; when there are enough, it says so.
    const t=performance.now(), full = L.views.length >= LIVE.max;
    if (full) liveCue('That is plenty. Tap Make the scan.', true);
    else if (!still) liveCue('A little slower', t-lastSay > 2500 && (lastSay=t, true));
    // a big change since the last view means the walk went too fast for the views to overlap; the view is still
    // kept (so there is something to carry on from) and the advice is to slow down
    // the sharpest views are preferred, but never at the cost of a gap: once the view has moved well on, the
    // next steady one is kept even if it is a little soft, since views that do not overlap cannot be placed
    else if (recent.length >= 6 && (!lastThumb ? sharp : (sharp && moved > 0.25) || moved > 0.4)){
      const jump = moved > 0.6 && L.views.length;
      const S2=Math.min(1, 640/Math.max(W0,H0)), FW=Math.round(W0*S2), FH=Math.round(H0*S2), c=document.createElement('canvas'); c.width=FW; c.height=FH;
      c.getContext('2d', {willReadFrequently:true}).drawImage(v, 0, 0, FW, FH);
      L.views.push({canvas:c, w:FW, h:FH, sharp:sh, at:+v.currentTime.toFixed(2), moved:+moved.toFixed(2)}); lastThumb=th;
      S.liveLog = L.views.map(x=>[x.at, x.moved]);                                   // for testing from the console
      // hold the exposure and colour where they are, so every view is lit alike
      if (!locked && L.stream){ locked=true; const tr=L.stream.getVideoTracks()[0], cap=tr.getCapabilities?.()||{}, set=tr.getSettings?.()||{}, adv={};
        if (cap.exposureMode?.includes('manual') && set.exposureTime) Object.assign(adv, {exposureMode:'manual', exposureTime:set.exposureTime});
        if (cap.whiteBalanceMode?.includes('manual') && set.colorTemperature) Object.assign(adv, {whiteBalanceMode:'manual', colorTemperature:set.colorTemperature});
        if (Object.keys(adv).length) tr.applyConstraints({advanced:[adv]}).catch(()=>{}); }
      navigator.vibrate?.(12); liveCount(); const t2=c.getContext('2d').getImageData(0,0,FW,FH); liveThumb(t2.data, FW, FH);
      if (jump) liveCue('A little slower, so each view overlaps the last', t-lastSay > 2500 && (lastSay=t, true));
      else liveCue(L.views.length===1 ? 'Got the first view. Now walk slowly around it.' : 'Keep going slowly around it', L.views.length===1);
    }
    else if (!L.views.length) liveCue('Point at what you want to scan, and hold still', false);
    next(step);
  };
  step();
  liveCue('Point at what you want to scan, and hold still', true);
  return new Promise(res=>{ L.finish=res; v.addEventListener('ended', res, {once:true}); });
}

// ---- after capture: the kept views become a scene
async function liveBuild(){
  const L=liveState, views=L.views, xr=L.xr && !!L.session; closeLive();
  if (views.length < 3){ notice('Not enough views were kept to make a scan. Walk slowly around the subject, pausing a moment at each new angle.'); return; }
  const g=++S.gen, n=views.length, frames=[], st={};
  let wake=null; try { wake=await navigator.wakeLock?.request('screen'); } catch(e){}
  try {
    const w=xr ? views[0].img.w : views[0].w, h=xr ? views[0].img.h : views[0].h;
    // The camera picture is copied out of the graphics card, whose rows may run either way up. Where the phone
    // measured depth, check which way up the depth model's guess agrees with it, and turn the pictures to match.
    const probe = xr && views.find(v=>v.samples.length>=30);
    S.liveLog = {xr, views:n, at: views.map(v=>v.at), depthSamples: xr ? views.reduce((a,v)=>a+v.samples.length,0) : 0};
    if (probe){ busy('Checking the camera picture', 0); await tick();
      const pic = flip => { const c=document.createElement('canvas'); c.width=w; c.height=h; const x=c.getContext('2d'); x.putImageData(new ImageData(probe.img.data, w, h), 0, 0);
        if (!flip) return c; const f=document.createElement('canvas'); f.width=w; f.height=h; const fx=f.getContext('2d'); fx.translate(0,h); fx.scale(1,-1); fx.drawImage(c,0,0); return f; };
      const rank = a => { const idx=a.map((v,i)=>i).sort((i,j)=>a[i]-a[j]), r=new Array(a.length); idx.forEach((i,k)=>r[i]=k); return r; };
      const agree = async flip => { const raw=await estimateDepth(pic(flip), null, true, MOBILE ? 364 : 434), a=[], b=[];
        for (const [u,v,z] of probe.samples){ a.push(raw.d[Math.min(raw.h-1,(v*raw.h)|0)*raw.w + Math.min(raw.w-1,(u*raw.w)|0)]); b.push(1/z); }
        const ra=rank(a), rb=rank(b), m=(a.length-1)/2; let sab=0, saa=0, sbb=0; for (let i=0;i<a.length;i++){ sab+=(ra[i]-m)*(rb[i]-m); saa+=(ra[i]-m)**2; sbb+=(rb[i]-m)**2; }
        return sab/Math.sqrt(saa*sbb||1); };
      const asIs = await agree(false), turned = await agree(true); S.liveLog.upright = {asIs:+asIs.toFixed(2), turned:+turned.toFixed(2)};
      if (turned > asIs + 0.2){ S.liveLog.flipped = true;
        for (const v of views){ const d=v.img.data, row=w*4, t=new Uint8ClampedArray(row); for (let y=0;y<h>>1;y++){ const a=y*row, b=(h-1-y)*row; t.set(d.subarray(a,a+row)); d.copyWithin(a, b, b+row); d.set(t, b); } } }
    }
    for (let i=0;i<n;i++){
      busy(`Reading view ${i+1} of ${n}: depth and features`, i/n*0.8); await tick();
      let c=views[i].canvas; if (!c){ c=document.createElement('canvas'); c.width=w; c.height=h; c.getContext('2d').putImageData(new ImageData(views[i].img.data, w, h), 0, 0); views[i].img=null; }
      frames.push(await frameFromCanvas(c, w, h, st, views[i].sharp)); if (g!==S.gen) return;
    }
    const TL=0.62, K = xr ? views[0].K : {tanX: w>=h ? TL : TL*w/h, tanY: w>=h ? TL*h/w : TL, ox:0, oy:0};
    if (window.__vsKeep) window.__vsKeep.live = {frames, w, h, K, poses: xr ? views.map(v=>v.pose) : null};     // testing only
    const note = xr ? ` Placed by the phone's own AR tracking${S.liveLog.depthSamples ? ' and scaled by its depth sensor' : ''}.` : '';
    await buildScanScene(frames, {g, w, h, K, name:'Live scan', from:'a live scan', note,
      poses: xr ? views.map(v=>v.pose) : null, metric: xr ? views.map(v=>v.samples) : null});
  } finally { try { wake?.release(); } catch(e){} }
}

$('#liveStart').addEventListener('click', async ()=>{
  const L=liveState; if (!L) return; $('#liveStart').hidden=true; $('#liveIntro').hidden=true; $('#liveDone').hidden=false;
  try { if (typeof DeviceMotionEvent!=='undefined' && DeviceMotionEvent.requestPermission) await DeviceMotionEvent.requestPermission().catch(()=>{}); } catch(e){}
  try {
    if (L.xr){ try { await liveXR(); } catch(err){ console.warn(err); L.xr=false; liveCue('The phone\'s AR tracking is not available here, so the camera alone is used', true); await liveCamera(); } }
    else await liveCamera();
    if (liveState && !liveState.done && liveState.views.length) await liveBuild(); else if (liveState) closeLive();
  } catch(err){ console.error(err); busy(null); closeLive(); notice('Could not make a live scan: '+(err.message||err)+'.'); }
});
$('#liveDone').addEventListener('click', ()=>{ const L=liveState; if (!L) return;
  if (L.session){ L.stopping=true; L.session.end().catch(()=>{}); } else L.finish?.(); });
$('#liveCancel').addEventListener('click', ()=>{ const L=liveState; if (L){ L.views.length=0; if (L.session) L.session.end().catch(()=>{}); else L.finish?.(); } closeLive(); });
$('#liveVoice').addEventListener('click', e=>{ const L=liveState; if (!L) return; L.voice=!L.voice; e.currentTarget.setAttribute('aria-pressed', String(L.voice)); if (!L.voice) try{ speechSynthesis.cancel(); }catch(err){} });
