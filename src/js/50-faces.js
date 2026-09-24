// ---------------------------------------------------------------- faces: find and anonymise
let faceSession = null;
async function loadFaceModel(){
  if (faceSession) return faceSession;
  await ensureOrt();
  const r = await cachedFetch('models/face-yunet-2023mar.onnx');
  faceSession = await ort.InferenceSession.create(new Uint8Array(await r.arrayBuffer()), {executionProviders:['wasm'], logSeverityLevel:3});
  return faceSession;
}
// YuNet (OpenCV Zoo, MIT) takes a 640 x 640 BGR image and reports faces at three scales. The whole
// photo is letterboxed in without stretching; large photos are also read in overlapping tiles, so
// small faces in full-length shots are big enough to find. It is tuned toward finding every face:
// a covered sleeve does no harm, a missed face does.
async function detectFaces(canvas){
  const sess = await loadFaceModel(), W = canvas.width, H = canvas.height, N = 640;
  const c = document.createElement('canvas'); c.width=N; c.height=N; const x=c.getContext('2d',{willReadFrequently:true});
  const crops = [{sx:0, sy:0, sw:W, sh:H, thr:0.6}];
  if (Math.max(W,H) > 1000){ const t=Math.round(Math.max(W,H)*0.55);
    for (const fy of [0, 1]) for (const fx of [0, 1]) crops.push({sx:fx*(W-Math.min(t,W)), sy:fy*(H-Math.min(t,H)), sw:Math.min(t,W), sh:Math.min(t,H), thr:0.7}); }
  const boxes=[];
  for (const k of crops){
    const s = Math.min(N/k.sw, N/k.sh);
    x.fillStyle='#000'; x.fillRect(0,0,N,N); x.drawImage(canvas, k.sx,k.sy,k.sw,k.sh, 0,0,k.sw*s,k.sh*s);
    const px=x.getImageData(0,0,N,N).data, t=new Float32Array(3*N*N);
    for (let i=0;i<N*N;i++){ t[i]=px[i*4+2]; t[N*N+i]=px[i*4+1]; t[2*N*N+i]=px[i*4]; }
    const r = await sess.run({[sess.inputNames[0]]: new ort.Tensor('float32', t, [1,3,N,N])});
    for (const st of [8,16,32]){ const cols=N/st, cls=r['cls_'+st].data, obj=r['obj_'+st].data, bb=r['bbox_'+st].data;
      for (let i=0;i<cls.length;i++){ const sc=Math.sqrt(Math.min(1,Math.max(0,cls[i]))*Math.min(1,Math.max(0,obj[i]))); if (sc < k.thr) continue;
        const cx=((i%cols)+bb[i*4])*st, cy=(Math.floor(i/cols)+bb[i*4+1])*st, w=Math.exp(bb[i*4+2])*st, h=Math.exp(bb[i*4+3])*st;
        const b=[(k.sx+(cx-w/2)/s)/W, (k.sy+(cy-h/2)/s)/H, (k.sx+(cx+w/2)/s)/W, (k.sy+(cy+h/2)/s)/H];
        if (b[2]-b[0] > 0.003 && b[3]-b[1] > 0.003) boxes.push({s:sc, b}); } }
  }
  boxes.sort((a,b)=>b.s-a.s); const keep=[];
  const overlap=(a,b)=>{ const w=Math.max(0,Math.min(a[2],b[2])-Math.max(a[0],b[0])), h=Math.max(0,Math.min(a[3],b[3])-Math.max(a[1],b[1])); return w*h/Math.min((a[2]-a[0])*(a[3]-a[1]),(b[2]-b[0])*(b[3]-b[1])); };
  for (const f of boxes) if (!keep.some(k=>overlap(k.b,f.b)>0.3)) keep.push(f);
  // a little larger than the detected box, which is tight on the features
  return keep.map(f=>({cx:(f.b[0]+f.b[2])/2, cy:(f.b[1]+f.b[3])/2, rx:(f.b[2]-f.b[0])*0.72, ry:(f.b[3]-f.b[1])*0.72, auto:true}));
}

function boxBlur(src, w, h, ch, x0, y0, x1, y1, r, passes){
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
// Blur alone can be undone by recognition software, so Medium (the default) and Strong fill the face
// with its own average colour; Light is a blur, for when the look matters more than privacy.
const ANON = [{blur:.3, flat:0, depth:.35}, {blur:.45, flat:1, depth:.6}, {blur:.6, flat:1, depth:.95}];
function applyAnon(){
  const P0=S.photoSrc, D0=S.depthSrc; if (!P0 || !D0) return;
  S.depthVer++;
  if (!S.anon || !S.faces.length){ S.photo=P0; S.depth=D0; S.faceMask=null; S.dirtyBuild=true; return; }
  const L = ANON[S.anonLevel];
  const pd = new Float32Array(P0.data), dd = Float32Array.from(D0.d), mask = new Uint8Array(D0.w*D0.h);
  const pOut = new Uint8ClampedArray(P0.data), dOut = Float32Array.from(D0.d);
  const feather = (x, y, f) => Math.min(1, Math.max(0, (1.15 - Math.hypot((x-f.cx)/f.rx, (y-f.cy)/f.ry))/0.3));
  for (const f of S.faces){
    let X0=Math.max(0,Math.floor((f.cx-f.rx*1.3)*P0.w)), X1=Math.min(P0.w,Math.ceil((f.cx+f.rx*1.3)*P0.w));
    let Y0=Math.max(0,Math.floor((f.cy-f.ry*1.3)*P0.h)), Y1=Math.min(P0.h,Math.ceil((f.cy+f.ry*1.3)*P0.h));
    let mr=0,mg=0,mb=0,mn=0;
    for (let y=Y0;y<Y1;y++) for (let x=X0;x<X1;x++) if (feather((x+.5)/P0.w,(y+.5)/P0.h,f)>0.9){ const i=(y*P0.w+x)*4; mr+=P0.data[i]; mg+=P0.data[i+1]; mb+=P0.data[i+2]; mn++; }
    if (mn){ mr/=mn; mg/=mn; mb/=mn; }
    boxBlur(pd, P0.w, P0.h, 4, X0, Y0, X1, Y1, f.rx*P0.w*L.blur, 3);
    for (let y=Y0;y<Y1;y++) for (let x=X0;x<X1;x++){ const m=feather((x+.5)/P0.w,(y+.5)/P0.h,f);
      if (m>0){ const i=(y*P0.w+x)*4, mean=[mr,mg,mb];
        for (let c=0;c<3;c++){ const smeared = pd[i+c]*(1-L.flat) + mean[c]*L.flat; pOut[i+c]=P0.data[i+c]*(1-m)+smeared*m; } } }
    X0=Math.max(0,Math.floor((f.cx-f.rx*1.3)*D0.w)); X1=Math.min(D0.w,Math.ceil((f.cx+f.rx*1.3)*D0.w));
    Y0=Math.max(0,Math.floor((f.cy-f.ry*1.3)*D0.h)); Y1=Math.min(D0.h,Math.ceil((f.cy+f.ry*1.3)*D0.h));
    boxBlur(dd, D0.w, D0.h, 1, X0, Y0, X1, Y1, f.rx*D0.w*L.depth, 3);
    for (let y=Y0;y<Y1;y++) for (let x=X0;x<X1;x++){ const m=feather((x+.5)/D0.w,(y+.5)/D0.h,f);
      if (m>0){ const i=y*D0.w+x; dOut[i]=D0.d[i]*(1-m)+dd[i]*m; mask[i]=Math.max(mask[i], Math.round(m*255)); } }
  }
  S.photo={w:P0.w,h:P0.h,data:pOut}; S.depth={w:D0.w,h:D0.h,d:dOut}; S.faceMask=mask; S.dirtyBuild=true;
}
async function findFaces(){
  try { busy('Looking for faces', null); await tick();
    const found = await detectFaces(S.photoCanvas);
    S.faces = S.faces.filter(f=>!f.auto).concat(found); S.facesFound = true;
  } catch(err){ console.error(err); busy(null); banner('The face finder could not run here.'); return false; }
  busy(null); return true;
}
function addFaceAt(u, v, comp){
  // size the cover from the figure it sits on: a head is about an eighth of a standing person
  let ry = 0.05; const c = S.comps.find(k=>k.id===comp);
  if (c) ry = Math.min(0.2, Math.max(0.02, (c.maxY-c.minY)/(2*S.tanV*Math.abs(c.sz/c.n)) * 0.075));
  S.faces.push({cx:u, cy:v, rx:ry*S.photo.h/S.photo.w*0.85, ry, auto:false});
  S.anon = true; applyAnon();
}
