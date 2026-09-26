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
  // A tap on something the floor finder claimed only because it faces up (the top of a boat on a
  // shoulder, a table) means "this": let the tap win. A tap on a fitted floor plane means "the thing
  // standing here", so move to the nearest pixel that is not floor.
  const onUp = G[seed]===4;
  if (G[seed] && !onUp){ let best=-1, bd=1e9; const r=Math.round(W*0.03);
    for (let y=Math.max(0,sy-r);y<Math.min(D.h,sy+r);y++) for (let x=Math.max(0,sx-r);x<Math.min(W,sx+r);x++){ const i=y*W+x; if (!G[i]){ const dd=(x-sx)**2+(y-sy)**2; if (dd<bd){bd=dd; best=i;} } }
    if (best>=0) seed=best; }
  const rel = (D.d[seed] + S.shiftAuto)/(0.5 + S.shiftAuto), tau = BANDS[S.band]*rel, step = (0.018 + 0.01*S.band)*rel;
  let lo, hi, seg = pick.seg;
  if (seg){
    // the outline model gives the shape; depth decides which parts of it really belong together
    const vals=[]; for (let i=0;i<n;i+=3) if (seg[i]) vals.push(D.d[i]);
    // keep the outline's own depth range (an object can reach towards you), dropping only strays well off it
    if (vals.length > 20){ vals.sort((a,b)=>a-b); lo=vals[Math.floor(vals.length*0.05)]-tau; hi=vals[Math.floor(vals.length*0.95)]+tau; }
    else seg = null;
  }
  if (!seg){ const d0=D.d[seed]; lo=d0-tau; hi=d0+tau; }
  const allowFloor = onUp || !!seg;          // an outline or a deliberate tap outranks the floor guess
  const bx = pick.box;                        // a found thing stays inside its own box
  const inBox = j => { if (!bx) return true; const u=(j%W+.5)/W, v=(((j/W)|0)+.5)/D.h; return u>=bx[0] && u<=bx[2] && v>=bx[1] && v<=bx[3]; };
  const ok = j => map[j]===-1 && (allowFloor ? G[j]!==9 && (G[j]===0 || G[j]===4 || !!seg) : !G[j]) && D.d[j]>=lo && D.d[j]<=hi && (!seg || seg[j]) && inBox(j);
  const q=new Int32Array(n); let head=0, tail=0, area=0;
  if (seg){
    // take every pixel of the outline that sits in the depth band...
    for (let i=0;i<n;i++) if (ok(i)){ map[i]=id; q[tail++]=i; }
    // ...then let it grow into neighbours whose depth carries on smoothly: the outline model often skips
    // dark clothing, but a jacket's depth runs straight on from the face and hands. Depth maps blur edges,
    // so smoothness alone would creep into the background; growth must also stay clearly nearer than the
    // background inside the box (at least halfway from it to the thing). Where the two are too close to
    // tell apart, the outline is used as it is.
    const inside=[], behind=[];
    for (let i=0;i<n;i+=2){ if (!inBox(i)) continue; (seg[i] ? inside : behind).push(D.d[i]); }
    inside.sort((a,b)=>a-b); behind.sort((a,b)=>a-b);
    const thing = inside[inside.length>>1], back = behind.length > 50 ? behind[Math.floor(behind.length*0.25)] : -1;
    if (!(thing - back > tau)){ area=tail; return area; }
    const floorD = Math.max(lo, back + 0.5*(thing-back));
    const okGrow = j => map[j]===-1 && G[j]!==9 && (!G[j] || G[j]===4) && D.d[j]>=floorD && D.d[j]<=hi && inBox(j);
    while(head<tail){ const i=q[head++]; area++; const x=i%W, di=D.d[i];
      const tryJ = j => { if (okGrow(j) && Math.abs(D.d[j]-di) < step*0.6){ map[j]=id; q[tail++]=j; } };
      if (x>0) tryJ(i-1); if (x<W-1) tryJ(i+1); if (i>=W) tryJ(i-W); if (i<n-W) tryJ(i+W); }
    return area;
  }
  if (map[seed]!==-1) return 0; map[seed]=id; q[tail++]=seed;
  while(head<tail){ const i=q[head++]; area++; const x=i%W, di=D.d[i];
    const tryJ = j => { if (ok(j) && Math.abs(D.d[j]-di) < step){ map[j]=id; q[tail++]=j; } };
    if (x>0) tryJ(i-1); if (x<W-1) tryJ(i+1); if (i>=W) tryJ(i-W); if (i<n-W) tryJ(i+W); }
  return area;
}
function subjectMap(){
  // cached: the subject only depends on the depth, the picks and the band, not on the look
  const key = (S.wholeScene ? 'whole|' : '')+S.depthVer+'|'+S.band+'|'+S.autoCut+'|'+S.picks.map(p=>p.u.toFixed(4)+','+p.v.toFixed(4)+(p.seg?'s':'')+(p.box?p.box.join(','):'')).join(';');
  if (S.compCache && S.compCache.key===key) return S.compCache.map;
  let map;
  // Whole scene: a landscape has no one subject, so everything but the sky gets the subject's full dots
  if (S.wholeScene){ map = new Int32Array(S.depth.w*S.depth.h); for (let i=0;i<map.length;i++) map[i] = S.sky && S.sky[i] ? -1 : 0; }
  else if (!S.picks.length) map = autoComponents();
  else {
    map = new Int32Array(S.depth.w*S.depth.h).fill(-1); let area=0;
    S.picks.forEach((p,i)=>{ area += growFrom(p, i, map); });
    // picks that grew to almost nothing leave the photo with no subject; fall back to the nearest things
    if (area < map.length*0.003) map = autoComponents();
  }
  S.compCache = {key, map};
  return map;
}

// Scenery: a fair amount of sky, and no found subject, or one that fills only a sliver of the picture
// (a rower on a wide lake, a walker on a hill). Then the scene itself is what the picture is of.
function looksLikeScenery(){
  if (S.scan || !S.sky || !S.depth) return false;
  const n=S.sky.length; let sky=0; for (let i=0;i<n;i+=4) if (S.sky[i]) sky++; sky = sky*4/n;
  if (sky < 0.12) return false;
  if (!S.picks.length) return true;
  const m = new Int32Array(n).fill(-1); let area=0; S.picks.forEach((p,i)=>{ area += growFrom(p, i, m); });
  return area/n < 0.06;
}

// ---------------------------------------------------------------- optional sharper outline (MediaPipe Magic Touch)
let segmenter = null, segFailed = false, visionFiles = null;
async function visionFileset(){
  if (visionFiles) return visionFiles;
  await loadScript('mp/vision_bundle.js');
  return visionFiles = await Vision.FilesetResolver.forVisionTasks(new URL('mp/wasm', location.href).href);
}
// The finder and the outline model share one download (about 23 MB), shown with real progress.
let visionBuffers = null, visionP = null;
const VISION_FILES = [['mp/wasm/vision_wasm_internal.wasm', 11756954], ['models/efficientdet_lite0.tflite', 4602795], ['models/magic_touch.tflite', 6227884]];
// One shared download, so a quiet early start and a later real request never fetch twice.
function fetchVisionModels(quiet){
  if (visionBuffers) return Promise.resolve(visionBuffers);
  return visionP || (visionP = (async ()=>{
    const total = VISION_FILES.reduce((s,f)=>s+f[1],0); let got = 0; const out = [];
    for (const [url] of VISION_FILES){
      const rd = (await cachedFetch(url)).body.getReader(), chunks=[]; let n=0;
      for(;;){ const {done,value}=await rd.read(); if (done) break; chunks.push(value); n+=value.length; got+=value.length;
        if (!quiet) busy(`Getting the finder, first time only: ${(got/1e6).toFixed(0)} of ${(total/1e6).toFixed(0)} MB`, got/total); }
      const buf=new Uint8Array(n); let o=0; for (const c of chunks){ buf.set(c,o); o+=c.length; } out.push(buf);
    }
    return visionBuffers = {det:out[1], seg:out[2]};
  })().catch(err=>{ visionP=null; throw err; }));
}
// While depth is being worked out, start the finder and outline models too, but only when they are
// already stored on this device: a first-time download should show its own progress, not run hidden.
async function warmFinder(){
  try { const c = await caches.open('first-return-models-v1'); for (const [url] of VISION_FILES) if (!(await c.match(url))) return; } catch(e){ return; }
  await loadDetector(true); await loadSegmenter(true);
}
let segP = null;
function loadSegmenter(quiet){
  if (segmenter || segFailed) return Promise.resolve(segmenter);
  return segP || (segP = (async ()=>{
    try {
      const bufs = await fetchVisionModels(quiet);
      if (!quiet){ busy('Starting the outline finder', null); await tick(); }
      const fileset = await visionFileset();
      segmenter = await Vision.InteractiveSegmenterLegacy.createFromOptions(fileset, {
        baseOptions:{modelAssetPath:URL.createObjectURL(new Blob([bufs.seg])), delegate:'CPU'},
        outputCategoryMask:true, outputConfidenceMasks:false});
    } catch(err){ console.error(err); segFailed = true; segmenter = null; }
    if (!quiet) busy(null);
    segP = null; return segmenter;
  })());
}
// The outline model gains almost nothing from more than about 1024 pixels (masks agree 99.6% with
// the full photo) and runs faster on less, so it gets a reduced copy.
let segInput = null;
function outlineInput(){
  const c = S.photoCanvas, L = 1024, s = L/Math.max(c.width, c.height);
  if (s >= 1) return c;
  if (segInput && segInput.src===c) return segInput.canvas;
  const o = document.createElement('canvas'); o.width=Math.round(c.width*s); o.height=Math.round(c.height*s); o.getContext('2d').drawImage(c,0,0,o.width,o.height);
  segInput = {src:c, canvas:o}; return o;
}
async function outlineFor(u, v, stroke){
  if (!segmenter && segP){ busy('Starting the outline finder', null); }
  const seg = await loadSegmenter(); if (!seg) return null;
  busy('Finding the outline', null); await tick();
  try {
    const res = seg.segment(outlineInput(), stroke ? {scribble:stroke} : {keypoint:{x:u, y:v}});
    const m = res.categoryMask, mw = m.width, mh = m.height, a = m.getAsUint8Array();
    // resample to the depth grid; the tapped pixel tells us which value means "selected"
    const at = (x,y) => a[Math.min(mh-1,(y*mh)|0)*mw + Math.min(mw-1,(x*mw)|0)];
    let on = at(u,v);
    if (stroke){ const votes={}; for (const p of stroke){ const k=at(p.x,p.y); votes[k]=(votes[k]||0)+1; } on = +Object.keys(votes).sort((p,q)=>votes[q]-votes[p])[0]; }
    const D=S.depth, out=new Uint8Array(D.w*D.h); let count=0;
    for (let y=0;y<D.h;y++) for (let x=0;x<D.w;x++){ const s=a[Math.min(mh-1,((y+.5)/D.h*mh)|0)*mw + Math.min(mw-1,((x+.5)/D.w*mw)|0)]; if (s===on){ out[y*D.w+x]=1; count++; } }
    res.close(); busy(null); S.lastSeg={count, total:D.w*D.h, on};
    if (count < D.w*D.h*0.001 || count > D.w*D.h*0.9) return null;     // nothing sensible: fall back to depth alone
    return out;
  } catch(err){ console.error(err); busy(null); return null; }
}

// ---------------------------------------------------------------- find people and things (MediaPipe object detector)
// Depth alone cannot tell that the person behind the dinner table is the point of the photo. A small
// object detector (EfficientDet Lite0, Apache 2.0) finds people, animals and vehicles; each one is then
// outlined with Magic Touch using a stroke down its middle, kept inside its box, and checked against depth.
let detector = null, detFailed = false, detP = null;
const SKIP = new Set(['dining table','chair','bench','couch','bed','potted plant','tv','toilet','sink','refrigerator','oven','microwave','book','vase','clock','cup','bowl','bottle','wine glass','fork','knife','spoon','cell phone','remote','keyboard','mouse','laptop']);
function loadDetector(quiet){
  if (detector || detFailed) return Promise.resolve(detector);
  return detP || (detP = (async ()=>{
    try {
      const bufs = await fetchVisionModels(quiet);
      if (!quiet){ busy('Starting the finder', null); await tick(); }
      const fileset = await visionFileset();
      detector = await Vision.ObjectDetector.createFromOptions(fileset, {
        baseOptions:{modelAssetPath:URL.createObjectURL(new Blob([bufs.det])), delegate:'CPU'},
        scoreThreshold:0.35, maxResults:12, runningMode:'IMAGE'});
    } catch(err){ console.error(err); detFailed = true; detector = null; }
    if (!quiet) busy(null);
    detP = null; return detector;
  })());
}
async function findThings(){
  if (!detector && detP) busy('Starting the finder', null);      // an early start is still finishing
  const det = await loadDetector(); if (!det) return null;
  busy('Looking for people and things', null); await tick();
  const W = S.photoCanvas.width, H = S.photoCanvas.height;
  let found = [];
  try {
    const r = det.detect(S.photoCanvas);
    for (const d of r.detections){
      const c = d.categories[0]; if (!c || SKIP.has(c.categoryName)) continue;
      const b = d.boundingBox, x0=b.originX/W, y0=b.originY/H, x1=(b.originX+b.width)/W, y1=(b.originY+b.height)/H;
      if ((x1-x0)*(y1-y0) < 0.004) continue;
      found.push({name:c.categoryName, score:c.score, box:[x0,y0,x1,y1]});
    }
  } catch(err){ console.error(err); busy(null); return null; }
  // people first, then the biggest things; at most five
  const area = f => (f.box[2]-f.box[0])*(f.box[3]-f.box[1]);
  found.sort((a,b)=>((b.name==='person')-(a.name==='person')) || (area(b)-area(a)));
  found = found.slice(0, MOBILE ? 3 : 5);
  const picks = [];
  for (const f of found){
    const [x0,y0,x1,y1] = f.box, cx=(x0+x1)/2, pad=0.04, D=S.depth;
    // The outline is guided by a stroke drawn down the person. A box cut off by the frame edge (a selfie)
    // has empty background at its centre, so each stroke point goes on the nearest part of the thing in
    // its row of the box instead.
    const stroke = [0.25,0.4,0.55,0.7].map(t=>{ const vy=y0+(y1-y0)*t, yi=Math.min(D.h-1,(vy*D.h)|0); let bx=cx, bd=-1;
      for (let k=0;k<40;k++){ const ux=x0+(x1-x0)*(k+.5)/40, d=D.d[yi*D.w+Math.min(D.w-1,(ux*D.w)|0)]; if (d>bd){ bd=d; bx=ux; } }
      return {x:bx, y:vy}; });
    const seg = await outlineFor(cx, (y0+y1)/2, stroke);
    let su=cx, sv=y0+(y1-y0)*0.4, best=-1;
    for (let k=0;k<200;k++){ const uu=x0+(x1-x0)*(0.3+0.4*hash2(k,1,5)), vv=y0+(y1-y0)*(0.2+0.5*hash2(k,2,5));
      const dd=D.d[Math.min(D.h-1,(vv*D.h)|0)*D.w+Math.min(D.w-1,(uu*D.w)|0)]; if (dd>best){ best=dd; su=uu; sv=vv; } }
    picks.push({u:su, v:sv, seg, name:f.name,
      box:[Math.max(0,x0-pad),Math.max(0,y0-pad),Math.min(1,x1+pad),Math.min(1,y1+pad)]});
  }
  busy(null);
  return picks;
}
