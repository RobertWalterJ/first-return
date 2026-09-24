// ---------------------------------------------------------------- faces: find and anonymise
let faceSession = null;
async function loadFaceModel(){
  if (faceSession) return faceSession;
  await ensureOrt();
  const r = await cachedFetch('models/face-ultraface-320.onnx');
  faceSession = await ort.InferenceSession.create(new Uint8Array(await r.arrayBuffer()), {executionProviders:['wasm'], logSeverityLevel:3});
  return faceSession;
}
// The detector takes 320 x 240. Every crop keeps that 4:3 shape in real pixels (a portrait photo
// squeezed into it was stretched almost 2x and faces went unfound), and small faces in full-length
// shots are found in overlapping tiles.
async function detectFaces(canvas){
  const sess = await loadFaceModel(), W = canvas.width, H = canvas.height;
  const c = document.createElement('canvas'); c.width=320; c.height=240; const x=c.getContext('2d',{willReadFrequently:true});
  const crops = [];
  { const s=Math.min(320/W,240/H); crops.push({sx:0,sy:0,sw:W,sh:H,dx:(320-W*s)/2,dy:(240-H*s)/2,dw:W*s,dh:H*s}); }
  for (const f of [0.55, 0.34]){
    const tw = Math.round(Math.min(W, H*4/3)*f*(W>H?1:1.4)), th = Math.round(tw*0.75);
    if (tw < 120) continue;
    for (let y=0; y<=Math.max(0,H-th); y+=Math.max(1,Math.round(th*0.5))) for (let xx=0; xx<=Math.max(0,W-tw); xx+=Math.max(1,Math.round(tw*0.5)))
      crops.push({sx:xx,sy:y,sw:tw,sh:th,dx:0,dy:0,dw:320,dh:240});
  }
  const boxes=[];
  for (const k of crops){
    x.fillStyle='#000'; x.fillRect(0,0,320,240); x.drawImage(canvas, k.sx,k.sy,k.sw,k.sh, k.dx,k.dy,k.dw,k.dh);
    const px=x.getImageData(0,0,320,240).data, t=new Float32Array(3*76800);
    for (let i=0;i<76800;i++) for (let j=0;j<3;j++) t[j*76800+i]=(px[i*4+j]-127)/128;
    const r = await sess.run({[sess.inputNames[0]]: new ort.Tensor('float32', t, [1,3,240,320])});
    const sc=r.scores.data, bx=r.boxes.data, fx=k.sw/k.dw, fy=k.sh/k.dh;
    const thr = k.sw===W && k.sh===H ? 0.78 : 0.86;     // tiles see more clutter, so ask for more certainty
    for (let i=0;i<sc.length/2;i++) if (sc[i*2+1] > thr){
      const b=[(k.sx+(bx[i*4]*320-k.dx)*fx)/W, (k.sy+(bx[i*4+1]*240-k.dy)*fy)/H, (k.sx+(bx[i*4+2]*320-k.dx)*fx)/W, (k.sy+(bx[i*4+3]*240-k.dy)*fy)/H];
      if (b[2]-b[0] > 0.004 && b[3]-b[1] > 0.004) boxes.push({s:sc[i*2+1], b}); }
  }
  boxes.sort((a,b)=>b.s-a.s); const keep=[];
  const overlap=(a,b)=>{ const w=Math.max(0,Math.min(a[2],b[2])-Math.max(a[0],b[0])), h=Math.max(0,Math.min(a[3],b[3])-Math.max(a[1],b[1])); return w*h/Math.min((a[2]-a[0])*(a[3]-a[1]),(b[2]-b[0])*(b[3]-b[1])); };
  for (const f of boxes) if (!keep.some(k=>overlap(k.b,f.b)>0.3)) keep.push(f);
  return keep.map(f=>({cx:(f.b[0]+f.b[2])/2, cy:(f.b[1]+f.b[3])/2, rx:(f.b[2]-f.b[0])*0.7, ry:(f.b[3]-f.b[1])*0.75, auto:true}));
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
// Light blurs features; Medium replaces the face with its own average colour and smooths the
// shape; Strong also flattens the depth to a plain dome and drops most of the points.
const ANON = [{blur:.25, flat:0,   depth:.3}, {blur:.45, flat:.75, depth:.55}, {blur:.6, flat:1, depth:.9}];
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
