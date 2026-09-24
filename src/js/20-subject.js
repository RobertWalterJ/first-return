// ---------------------------------------------------------------- choosing the subject
// Automatic: everything nearer than a depth threshold (floor excluded) is the subject.
function autoComponents(){
  const D=S.depth, n=D.w*D.h, cut=S.autoCut, G=S.ground, map=new Int32Array(n).fill(-1), q=new Int32Array(n), comps=[];
  for (let s=0;s<n;s++){
    if (map[s]!==-1 || D.d[s]<cut || G[s]) continue;
    let head=0, tail=0; q[tail++]=s; const id=comps.length; map[s]=id; let area=0;
    while(head<tail){ const i=q[head++]; area++; const x=i%D.w;
      if (x>0){ const j=i-1; if (map[j]===-1 && D.d[j]>=cut && !G[j]){ map[j]=id; q[tail++]=j; } }
      if (x<D.w-1){ const j=i+1; if (map[j]===-1 && D.d[j]>=cut && !G[j]){ map[j]=id; q[tail++]=j; } }
      if (i>=D.w){ const j=i-D.w; if (map[j]===-1 && D.d[j]>=cut && !G[j]){ map[j]=id; q[tail++]=j; } }
      if (i<n-D.w){ const j=i+D.w; if (map[j]===-1 && D.d[j]>=cut && !G[j]){ map[j]=id; q[tail++]=j; } } }
    comps.push(area);
  }
  const remap=[]; let k=0; comps.forEach((a,i)=>{ remap[i] = a >= n*0.004 ? k++ : -1; });
  for (let i=0;i<n;i++) if (map[i]>=0) map[i]=remap[map[i]];
  return map;
}

// Tapped: grow outward from the tap across surfaces at about the same depth, stopping at
// depth cliffs. Things in front of the subject are no longer mistaken for it.
const BANDS = [0.045, 0.085, 0.15];
function growFrom(pick, id, map){
  const D=S.depth, n=D.w*D.h, G=S.ground, W=D.w;
  const sx=Math.min(W-1,(pick.u*W)|0), sy=Math.min(D.h-1,(pick.v*D.h)|0);
  let seed=sy*W+sx;
  // if the tap landed on the floor or a hole, use the nearest non-floor pixel close by
  if (G[seed]){ let best=-1, bd=1e9; const r=Math.round(W*0.03);
    for (let y=Math.max(0,sy-r);y<Math.min(D.h,sy+r);y++) for (let x=Math.max(0,sx-r);x<Math.min(W,sx+r);x++){ const i=y*W+x; if (!G[i]){ const dd=(x-sx)**2+(y-sy)**2; if (dd<bd){bd=dd; best=i;} } }
    if (best>=0) seed=best; }
  const tau = BANDS[S.band], step = 0.018 + 0.01*S.band;
  let lo, hi, seg = pick.seg;
  if (seg){
    // the outline model gives the shape; depth decides which parts of it really belong together
    const vals=[]; for (let i=0;i<n;i+=3) if (seg[i]) vals.push(D.d[i]);
    // keep the outline's own depth range (an object can reach towards you), dropping only strays well off it
    if (vals.length > 20){ vals.sort((a,b)=>a-b); lo=vals[Math.floor(vals.length*0.05)]-tau; hi=vals[Math.floor(vals.length*0.95)]+tau; }
    else seg = null;
  }
  if (!seg){ const d0=D.d[seed]; lo=d0-tau; hi=d0+tau; }
  const ok = j => map[j]===-1 && !G[j] && D.d[j]>=lo && D.d[j]<=hi && (!seg || seg[j]);
  if (seg){ // take every pixel of the outline that sits in the depth band
    let area=0; for (let i=0;i<n;i++) if (ok(i)){ map[i]=id; area++; } return area; }
  const q=new Int32Array(n); let head=0, tail=0, area=0;
  if (map[seed]!==-1) return 0; map[seed]=id; q[tail++]=seed;
  while(head<tail){ const i=q[head++]; area++; const x=i%W, di=D.d[i];
    const tryJ = j => { if (ok(j) && Math.abs(D.d[j]-di) < step){ map[j]=id; q[tail++]=j; } };
    if (x>0) tryJ(i-1); if (x<W-1) tryJ(i+1); if (i>=W) tryJ(i-W); if (i<n-W) tryJ(i+W); }
  return area;
}
function subjectMap(){
  if (!S.picks.length) return autoComponents();
  const map = new Int32Array(S.depth.w*S.depth.h).fill(-1);
  S.picks.forEach((p,i)=>growFrom(p, i, map));
  return map;
}

// ---------------------------------------------------------------- optional sharper outline (MediaPipe Magic Touch)
let segmenter = null, segFailed = false;
async function loadSegmenter(){
  if (segmenter || segFailed) return segmenter;
  try {
    busy('Getting the outline finder, first time only', null); await tick();
    await loadScript('mp/vision_bundle.js');
    const fileset = await Vision.FilesetResolver.forVisionTasks(new URL('mp/wasm', location.href).href);
    segmenter = await Vision.InteractiveSegmenterLegacy.createFromOptions(fileset, {
      baseOptions:{modelAssetPath:new URL('models/magic_touch.tflite', location.href).href, delegate:'CPU'},
      outputCategoryMask:true, outputConfidenceMasks:false});
  } catch(err){ console.error(err); segFailed = true; segmenter = null; }
  busy(null);
  return segmenter;
}
async function outlineFor(u, v){
  const seg = await loadSegmenter(); if (!seg) return null;
  busy('Finding the outline', null); await tick();
  try {
    const res = seg.segment(S.photoCanvasForSeg || S.photoCanvas, {keypoint:{x:u, y:v}});
    const m = res.categoryMask, mw = m.width, mh = m.height, a = m.getAsUint8Array();
    // resample to the depth grid; the tapped pixel tells us which value means "selected"
    const on = a[Math.min(mh-1,(v*mh)|0)*mw + Math.min(mw-1,(u*mw)|0)];
    const D=S.depth, out=new Uint8Array(D.w*D.h); let count=0;
    for (let y=0;y<D.h;y++) for (let x=0;x<D.w;x++){ const s=a[Math.min(mh-1,((y+.5)/D.h*mh)|0)*mw + Math.min(mw-1,((x+.5)/D.w*mw)|0)]; if (s===on){ out[y*D.w+x]=1; count++; } }
    res.close(); busy(null);
    if (count < D.w*D.h*0.001 || count > D.w*D.h*0.9) return null;     // nothing sensible: fall back to depth alone
    return out;
  } catch(err){ console.error(err); busy(null); return null; }
}
