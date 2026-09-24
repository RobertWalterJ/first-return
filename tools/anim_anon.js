function drawLabels2D(x, W, H){
  const fs = H*0.03; x.save(); x.font = `560 ${fs}px Archivo, "Helvetica Neue", Arial, sans-serif`; x.textAlign='center'; x.textBaseline='bottom';
  S.labels.forEach(L=>{ if(!L.text||!L.pos) return; const s=project(L.pos,W,H); if(!s) return;
    x.fillStyle='#fff'; x.shadowColor='rgba(255,255,255,.55)'; x.shadowBlur=fs*0.5; x.fillText(L.text,s[0],s[1]); x.shadowBlur=fs*0.18; x.fillText(L.text,s[0],s[1]); });
  x.restore();
}
function showSheet(url, kind, name){
  const img=$('#sheetImg'), vid=$('#sheetVid');
  img.hidden = kind!=='image'; vid.hidden = kind!=='video';
  if (kind==='image') img.src=url; else { vid.src=url; vid.play().catch(()=>{}); }
  $('#sheetDl').href=url; $('#sheetDl').download=name;
  $('#sheetNote').textContent = kind==='image'
    ? 'On a phone, press and hold the picture to save it. On a computer, right-click it and choose Save image.'
    : 'Tap Download to save the video. If nothing saves, try the three-dot menu on the video, or use the app on your computer.';
  $('#sheet').hidden=false;
}

// ---------------------------------------------------------------- animation
// each move is an offset from the view on screen, eased so it starts and ends at rest
const MOVES = {
  push:  t=>({dz:-0.32*t}),
  orbit: t=>({dy:-14+28*t}),
  drift: t=>({dz:-0.26*t, dy:-8+16*t, dp:4-4*t}),
  rise:  t=>({dy:22*t, dp:16*t, dz:-0.12*t})
};
const ease = t => 0.5-0.5*Math.cos(Math.PI*t);
function poseAt(base, move, t){ const m=MOVES[move](ease(t));
  return {yaw:base.yaw+(m.dy||0), pitch:Math.max(-80,Math.min(80,base.pitch+(m.dp||0))), zoom:Math.max(0.3, base.zoom*(1+(m.dz||0)))}; }
function videoSize(){ const a=frameAspect(), L = MOBILE ? 1280 : 1920; let w,h; if (a>=1){ w=L; h=Math.round(L/a); } else { h=L; w=Math.round(L*a); } return [w&~1, h&~1]; }
async function playMove(recordIt){
  if (S.recording || !S.count) return;
  const move=$('#animMove').value, dur=+$('#animLen').value*1000, base={yaw:S.yaw,pitch:S.pitch,zoom:S.zoom};
  let rec=null, chunks=[], rx=null, W=0, H=0, mime='';
  const ow=cv.width, oh=cv.height;
  if (recordIt){
    mime = ['video/mp4;codecs=avc1.640028','video/mp4','video/webm;codecs=vp9','video/webm'].find(m=>window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || '';
    if (!mime || !HTMLCanvasElement.prototype.captureStream){ $('#readout').textContent='This browser cannot record video. Try Chrome, Edge or Firefox.'; return; }
    [W,H] = videoSize(); cv.width=W; cv.height=H;
    const rc=document.createElement('canvas'); rc.width=W; rc.height=H; rx=rc.getContext('2d');
    rx.fillStyle='#030405'; rx.fillRect(0,0,W,H);
    rec = new MediaRecorder(rc.captureStream(30), {mimeType:mime, videoBitsPerSecond: MOBILE?8e6:16e6});
    rec.ondataavailable = e=>{ if (e.data && e.data.size) chunks.push(e.data); };
    rec.start(250);
  }
  S.recording = true; S.spin=false; $('#spin').setAttribute('aria-pressed','false');
  $('#recbar').hidden=false; $('#readout').textContent = recordIt ? 'Recording the move' : 'Previewing the move';
  const hold = recordIt ? 500 : 0;   // a still beat at the end so the video does not stop mid-motion
  await new Promise(res=>{ const t0=performance.now();
    const step=()=>{ const el=performance.now()-t0, t=Math.min(1, el/dur);
      Object.assign(S, poseAt(base, move, t));
      if (recordIt){ draw(W,H); rx.drawImage(cv,0,0); drawLabels2D(rx,W,H); }
      else { draw(); renderLabels(); }
      $('#recfill').style.width=(Math.min(1,el/(dur+hold))*100)+'%';
      if (el < dur+hold) requestAnimationFrame(step); else res(); };
    requestAnimationFrame(step); });
  if (recordIt){ await new Promise(r=>{ rec.onstop=r; rec.stop(); }); cv.width=ow; cv.height=oh; }
  S.recording=false; $('#recbar').hidden=true; Object.assign(S, base); S.dirtyDraw=true; readout(); viewButton();
  if (recordIt){ const ext = mime.includes('mp4') ? 'mp4' : 'webm';
    showSheet(URL.createObjectURL(new Blob(chunks,{type:mime.split(';')[0]})), 'video', 'first-return.'+ext); }
}
$('#animPreview').addEventListener('click', ()=>playMove(false));
$('#animRecord').addEventListener('click', ()=>playMove(true));

// ---------------------------------------------------------------- faces
let faceSession = null;
async function loadFaceModel(){
  if (faceSession) return faceSession;
  const r = await fetch('models/face-ultraface-320.onnx'); if (!r.ok) throw new Error('could not fetch the face model');
  ort.env.wasm.wasmPaths = new URL('ort/', location.href).href;
  ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency||2) : 1;
  faceSession = await ort.InferenceSession.create(new Uint8Array(await r.arrayBuffer()), {executionProviders:['wasm']});
  return faceSession;
}
async function detectFaces(){
  const sess = await loadFaceModel(); const Ph = S.photoSrc;
  const src = document.createElement('canvas'); src.width=Ph.w; src.height=Ph.h;
  src.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(Ph.data), Ph.w, Ph.h), 0, 0);
  const c = document.createElement('canvas'); c.width=320; c.height=240; const x=c.getContext('2d',{willReadFrequently:true});
  // the whole frame, then overlapping tiles so small faces in full-length shots are still big enough to find
  const crops=[[0,0,1,1]];
  for (const s of [0.6, 0.4]){ const n=Math.ceil((1-s)/(s*0.5)); for (let j=0;j<=n;j++) for (let i=0;i<=n;i++) crops.push([i*(1-s)/n, j*(1-s)/n, s, s]); }
  const boxes=[];
  for (const [cx,cy,cw,ch] of crops){
    x.drawImage(src, cx*Ph.w, cy*Ph.h, cw*Ph.w, ch*Ph.h, 0, 0, 320, 240);
    const px=x.getImageData(0,0,320,240).data, t=new Float32Array(3*76800);
    for (let i=0;i<76800;i++) for (let k=0;k<3;k++) t[k*76800+i]=(px[i*4+k]-127)/128;
    const r = await sess.run({[sess.inputNames[0]]: new ort.Tensor('float32', t, [1,3,240,320])});
    const sc=r.scores.data, bx=r.boxes.data;
    for (let i=0;i<sc.length/2;i++) if (sc[i*2+1] > 0.8){
      const b=[cx+bx[i*4]*cw, cy+bx[i*4+1]*ch, cx+bx[i*4+2]*cw, cy+bx[i*4+3]*ch];
      if (b[2]-b[0] > 0.004 && b[3]-b[1] > 0.004) boxes.push({s:sc[i*2+1], b}); }
  }
  boxes.sort((a,b)=>b.s-a.s); const keep=[];
  const iou=(a,b)=>{ const w=Math.max(0,Math.min(a[2],b[2])-Math.max(a[0],b[0])), h=Math.max(0,Math.min(a[3],b[3])-Math.max(a[1],b[1])), i=w*h;
    return i/((a[2]-a[0])*(a[3]-a[1])+(b[2]-b[0])*(b[3]-b[1])-i); };
  const within=(a,b)=>{ const w=Math.max(0,Math.min(a[2],b[2])-Math.max(a[0],b[0])), h=Math.max(0,Math.min(a[3],b[3])-Math.max(a[1],b[1])); return w*h > 0.6*(a[2]-a[0])*(a[3]-a[1]); };
  for (const f of boxes) if (!keep.some(k=>iou(k.b,f.b)>0.25 || within(f.b,k.b) || within(k.b,f.b))) keep.push(f);
  return keep.map(f=>({cx:(f.b[0]+f.b[2])/2, cy:(f.b[1]+f.b[3])/2, rx:(f.b[2]-f.b[0])*0.68, ry:(f.b[3]-f.b[1])*0.72, auto:true}));
}
function boxBlur(src, w, h, ch, x0, y0, x1, y1, r, passes){
  // separable box blur of one rectangle, in place, on an interleaved array with ch channels
  r = Math.max(1, Math.round(r)); const bw=x1-x0, bh=y1-y0; if (bw<2||bh<2) return;
  const tmp = new Float32Array(Math.max(bw,bh)*ch);
  for (let p=0;p<passes;p++){
    for (let y=y0;y<y1;y++){
      for (let x=0;x<bw;x++) for (let c=0;c<ch;c++){ let s=0; for (let k=-r;k<=r;k++){ const xx=Math.min(x1-1,Math.max(x0,x0+x+k)); s+=src[(y*w+xx)*ch+c]; } tmp[x*ch+c]=s/(2*r+1); }
      for (let x=0;x<bw;x++) for (let c=0;c<ch;c++) src[(y*w+x0+x)*ch+c]=tmp[x*ch+c]; }
    for (let x=x0;x<x1;x++){
      for (let y=0;y<bh;y++) for (let c=0;c<ch;c++){ let s=0; for (let k=-r;k<=r;k++){ const yy=Math.min(y1-1,Math.max(y0,y0+y+k)); s+=src[(yy*w+x)*ch+c]; } tmp[y*ch+c]=s/(2*r+1); }
      for (let y=0;y<bh;y++) for (let c=0;c<ch;c++) src[((y0+y)*w+x)*ch+c]=tmp[y*ch+c]; }
  }
}
function applyAnon(){
  const P0=S.photoSrc, D0=S.depthSrc; if (!P0 || !D0) return;
  if (!S.anon || !S.faces.length){ S.photo=P0; S.depth=D0; S.faceMask=null; S.dirtyBuild=true; return; }
  const st = S.anonStr;
  const pd = new Float32Array(P0.data), dd = Float32Array.from(D0.d), mask = new Uint8Array(D0.w*D0.h);
  const pOut = new Uint8ClampedArray(P0.data), dOut = Float32Array.from(D0.d);
  const feather = (x, y, f) => Math.min(1, Math.max(0, (1.15 - Math.hypot((x-f.cx)/f.rx, (y-f.cy)/f.ry))/0.3));
  for (const f of S.faces){
    // photo: smear the colour so eyes, brows and mouth vanish but skin tone and head shape stay
    let X0=Math.max(0,Math.floor((f.cx-f.rx*1.3)*P0.w)), X1=Math.min(P0.w,Math.ceil((f.cx+f.rx*1.3)*P0.w));
    let Y0=Math.max(0,Math.floor((f.cy-f.ry*1.3)*P0.h)), Y1=Math.min(P0.h,Math.ceil((f.cy+f.ry*1.3)*P0.h));
    boxBlur(pd, P0.w, P0.h, 4, X0, Y0, X1, Y1, f.rx*P0.w*(0.12+0.3*st), 3);
    for (let y=Y0;y<Y1;y++) for (let x=X0;x<X1;x++){ const m=feather((x+.5)/P0.w,(y+.5)/P0.h,f);
      if (m>0){ const i=(y*P0.w+x)*4; for (let c=0;c<3;c++) pOut[i+c]=P0.data[i+c]*(1-m)+pd[i+c]*m; } }
    // depth: smooth the relief so the face's 3D profile cannot be read back out of the cloud
    X0=Math.max(0,Math.floor((f.cx-f.rx*1.3)*D0.w)); X1=Math.min(D0.w,Math.ceil((f.cx+f.rx*1.3)*D0.w));
    Y0=Math.max(0,Math.floor((f.cy-f.ry*1.3)*D0.h)); Y1=Math.min(D0.h,Math.ceil((f.cy+f.ry*1.3)*D0.h));
    boxBlur(dd, D0.w, D0.h, 1, X0, Y0, X1, Y1, f.rx*D0.w*(0.15+0.35*st), 3);
    for (let y=Y0;y<Y1;y++) for (let x=X0;x<X1;x++){ const m=feather((x+.5)/D0.w,(y+.5)/D0.h,f);
      if (m>0){ const i=y*D0.w+x; dOut[i]=D0.d[i]*(1-m)+dd[i]*m; mask[i]=Math.max(mask[i], Math.round(m*255)); } }
  }
  S.photo={w:P0.w,h:P0.h,data:pOut}; S.depth={w:D0.w,h:D0.h,d:dOut}; S.faceMask=mask; S.dirtyBuild=true;
}
function faceNote(){
  const n=S.faces.length, auto=S.faces.filter(f=>f.auto).length;
  $('#clearFaces').hidden = !n;
  $('#faceNote').textContent = !S.anon
    ? 'Finds faces and wipes out their detail: colour is smeared and the 3D shape is smoothed, so the head and body still read but the features do not. Hair, clothes and the setting can still identify someone.'
    : `${auto ? `Found ${auto} face${auto===1?'':'s'}.` : 'No faces found automatically.'}${n-auto ? ` ${n-auto} covered by hand.` : ''} Tap Cover a face for any it missed.`;
}
async function setAnon(on){
  S.anon=on; $('#anon').setAttribute('aria-pressed', on);
  if (on && !S.facesFound){
    try { busy('Looking for faces', null); await tick(); const found = await detectFaces(); S.faces = S.faces.filter(f=>!f.auto).concat(found); S.facesFound=true; }
    catch(err){ console.error(err); busy(null); $('#faceNote').textContent='Could not run the face finder: '+(err.message||err); return; }
    busy(null);
  }
  applyAnon(); faceNote();
}
function placeFace(cx, cy){
  if (!S.count) return;
  const MV = M4.mul(S.P, S.V), out=S.cpu; let best=1e9, bi=-1;
  const step = Math.max(1, Math.floor(S.count/250000));
  for (let i=0;i<S.count;i+=step){ const o=i*10; if (out[o+6]===2) continue; const c=M4.xf(MV,[out[o],out[o+1],out[o+2]]); if (c[3]<=0) continue;
    const sx=(c[0]*.5+.5)*S.cssW, sy=(1-(c[1]*.5+.5))*S.cssH, dd=(sx-cx)**2+(sy-cy)**2; if (dd<best){best=dd; bi=i;} }
  if (bi<0 || best > 40*40) return;
  const o=bi*10, z=-out[o+2], a=S.photo.w/S.photo.h, u=(out[o]/(TANH*a*z)+1)/2, v=(1-out[o+1]/(TANH*z))/2;
  // size the cover from the figure it sits on: a head is about an eighth of a standing person
  const c = S.comps.find(k=>k.id===out[o+9]); let ry = 0.05;
  if (c) ry = Math.min(0.2, Math.max(0.02, (c.maxY-c.minY)/(2*TANH*Math.abs(c.sz/c.n)) * 0.075));
  S.faces.push({cx:u, cy:v, rx:ry*S.photo.h/S.photo.w*0.85, ry, auto:false});
  if (!S.anon){ S.anon=true; $('#anon').setAttribute('aria-pressed', true); }
  setPlacing(false); applyAnon(); faceNote();
}
$('#anon').addEventListener('click', ()=>setAnon(!S.anon));
$('#addFace').addEventListener('click', ()=>setPlacing(S.placing==='face'?false:'face'));
$('#clearFaces').addEventListener('click', ()=>{ S.faces=[]; S.facesFound=false; S.anon=false; $('#anon').setAttribute('aria-pressed', false); applyAnon(); faceNote(); });
$('#anonStr').addEventListener('input', e=>{ S.anonStr=+e.target.value; e.target.nextElementSibling.textContent=S.anonStr.toFixed(2); applyAnon(); });
