// ---------------------------------------------------------------- photo decoding, camera, depth
// Camera field of view. Phones write the lens as a 35 mm equivalent focal length into EXIF;
// that fixes how wide the view is, which matters as soon as you turn the cloud.
function readExifFocal35(buf){
  try {
    const v = new DataView(buf); if (v.getUint16(0) !== 0xFFD8) return null;
    let o = 2;
    while (o < v.byteLength - 4){
      const m = v.getUint16(o), len = v.getUint16(o+2);
      if (m === 0xFFE1 && v.getUint32(o+4) === 0x45786966){          // "Exif"
        const t = o + 10, le = v.getUint16(t) === 0x4949;
        const u16 = p => v.getUint16(p, le), u32 = p => v.getUint32(p, le);
        const ifd = (start, want) => { const n = u16(start); for (let i=0;i<n;i++){ const e=start+2+i*12; if (u16(e)===want) return e; } return -1; };
        const ex = ifd(t + u32(t+4), 0x8769); if (ex < 0) return null;
        const exStart = t + u32(ex+8);
        const f35 = ifd(exStart, 0xA405); if (f35 >= 0){ const val = u16(f35+8); if (val > 5 && val < 1200) return val; }
        return null;
      }
      if ((m & 0xFF00) !== 0xFF00) break;
      o += 2 + len;
    }
  } catch(e){}
  return null;
}
function fovFrom(f35, w, h){
  const L = Math.max(w,h), Sd = Math.min(w,h), diag = Math.hypot(L, Sd);
  let tanLong, tanShort, src;
  if (f35){ const hd = 21.635/f35; tanLong = hd*L/diag; tanShort = hd*Sd/diag; src = `${f35} mm lens (from the photo)`; }
  else { tanLong = Math.tan(30*Math.PI/180); tanShort = tanLong*Sd/L; src = 'assumed, no lens data in the photo'; }
  return {tanV: h >= w ? tanLong : tanShort, src};
}

// Decode at a sensible size: a 50 MP phone photo decoded at full size can take the tab down.
async function decodePhoto(file){
  const buf = await file.arrayBuffer();
  const f35 = readExifFocal35(buf);
  const url = URL.createObjectURL(file);
  const img = new Image(); img.src = url; await img.decode();
  const W0 = img.naturalWidth, H0 = img.naturalHeight, LIM = MOBILE ? 1600 : 2000;
  const s = Math.min(1, LIM/Math.max(W0,H0)), w = Math.round(W0*s), h = Math.round(H0*s);
  const c = document.createElement('canvas'); c.width=w; c.height=h; const x = c.getContext('2d', {willReadFrequently:true});
  x.drawImage(img, 0, 0, w, h);
  return {canvas:c, url, w, h, data:x.getImageData(0,0,w,h).data, fov:fovFrom(f35, W0, H0)};
}

// ---------------------------------------------------------------- the depth model
let session = null;
async function ensureOrt(){
  if (!window.ort) await loadScript('ort/ort.wasm.min.js');
  ort.env.wasm.wasmPaths = new URL('ort/', location.href).href;
  ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency||2) : 1;
}
async function cachedFetch(url){
  // keep the model in Cache Storage, so "first time only" is true even after the web cache expires
  let cache = null; try { cache = await caches.open('first-return-models-v1'); const hit = await cache.match(url); if (hit) return hit; } catch(e){}
  const r = await fetch(url); if (!r.ok) throw new Error('could not fetch '+url);
  if (cache){ try { await cache.put(url, r.clone()); } catch(e){} }
  return r;
}
async function loadModel(){
  if (session) return session;
  await ensureOrt();
  const parts = ['models/depth-q8.part0','models/depth-q8.part1'], total = 27258801, pieces = []; let got = 0;
  for (const part of parts){
    for (let attempt=0;;attempt++){
      const start = got, chunks = [];
      try {
        const rd = (await cachedFetch(part)).body.getReader();
        for(;;){ const {done,value}=await rd.read(); if(done) break; chunks.push(value); got+=value.length;
          busy(`Getting the depth model, first time only: ${(got/1e6).toFixed(0)} of ${(total/1e6).toFixed(0)} MB`, got/total); }
        pieces.push(...chunks); break;
      } catch(err){ got = start; if (attempt>=1) throw err; }
    }
  }
  const buf = new Uint8Array(got); { let o=0; for (const c of pieces){ buf.set(c,o); o+=c.length; } }
  busy('Starting the depth model', null); await tick();
  session = await ort.InferenceSession.create(buf, {executionProviders:['wasm']});
  return session;
}
async function estimateDepth(photoCanvas){
  const sess = await loadModel();
  busy('Reading depth from the photo', null); await tick();
  const LONG = MOBILE ? 434 : 518, s = LONG/Math.max(photoCanvas.width, photoCanvas.height);
  const mw = Math.max(14, Math.round(photoCanvas.width*s/14)*14), mh = Math.max(14, Math.round(photoCanvas.height*s/14)*14);
  const c = document.createElement('canvas'); c.width=mw; c.height=mh; const x=c.getContext('2d',{willReadFrequently:true});
  x.drawImage(photoCanvas,0,0,mw,mh);
  const px = x.getImageData(0,0,mw,mh).data, t = new Float32Array(3*mw*mh), m=[.485,.456,.406], sd=[.229,.224,.225];
  for (let i=0;i<mw*mh;i++) for (let k=0;k<3;k++) t[k*mw*mh+i] = (px[i*4+k]/255-m[k])/sd[k];
  const res = await sess.run({[sess.inputNames[0]]: new ort.Tensor('float32', t, [1,3,mh,mw])});
  const o = res[sess.outputNames[0]], dims=o.dims, oh=dims[dims.length-2], ow=dims[dims.length-1];
  return {w:ow, h:oh, d:Float32Array.from(o.data)};
}

// Map raw model output to 0..1. Only the far end is clipped hard; clipping the near end
// flattened the closest surfaces (often the floor at your feet) into a plateau.
function normaliseDepth(raw){
  const s = Float32Array.from(raw.d).sort(), lo = s[Math.floor(s.length*0.005)], hi = s[Math.min(s.length-1, Math.floor(s.length*0.9995))];
  const d = new Float32Array(raw.d.length); for (let i=0;i<d.length;i++) d[i] = Math.min(1, Math.max(0, (raw.d[i]-lo)/(hi-lo||1)));
  return {w:raw.w, h:raw.h, d};
}

// Depth models blur edges by a few pixels, which smears people into the wall behind them.
// A guided filter (He, Sun and Tang) snaps the depth edges onto the photo's own edges and
// doubles the resolution at the same time.
function boxMean(src, w, h, r){
  const I = new Float64Array((w+1)*(h+1));
  for (let y=0;y<h;y++){ let row=0; for (let x=0;x<w;x++){ row+=src[y*w+x]; I[(y+1)*(w+1)+x+1]=I[y*(w+1)+x+1]+row; } }
  const out = new Float32Array(w*h);
  for (let y=0;y<h;y++){ const y0=Math.max(0,y-r), y1=Math.min(h,y+r+1);
    for (let x=0;x<w;x++){ const x0=Math.max(0,x-r), x1=Math.min(w,x+r+1);
      out[y*w+x] = (I[y1*(w+1)+x1]-I[y0*(w+1)+x1]-I[y1*(w+1)+x0]+I[y0*(w+1)+x0])/((x1-x0)*(y1-y0)); } }
  return out;
}
function refineDepth(D, photoCanvas){
  const scale = Math.min(2, photoCanvas.width/D.w), w = Math.round(D.w*scale), h = Math.round(D.h*scale), n = w*h;
  const c = document.createElement('canvas'); c.width=w; c.height=h; const x=c.getContext('2d',{willReadFrequently:true});
  x.drawImage(photoCanvas,0,0,w,h); const px = x.getImageData(0,0,w,h).data;
  const I = new Float32Array(n); for (let i=0;i<n;i++) I[i]=(0.299*px[i*4]+0.587*px[i*4+1]+0.114*px[i*4+2])/255;
  const p = new Float32Array(n);
  for (let yy=0;yy<h;yy++) for (let xx=0;xx<w;xx++){ const u=(xx+.5)/w, v=(yy+.5)/h;
    const fx=Math.min(D.w-1.001,Math.max(0,u*D.w-.5)), fy=Math.min(D.h-1.001,Math.max(0,v*D.h-.5)), x0=fx|0, y0=fy|0, ax=fx-x0, ay=fy-y0, i=y0*D.w+x0;
    p[yy*w+xx]=(D.d[i]*(1-ax)+D.d[i+1]*ax)*(1-ay)+(D.d[i+D.w]*(1-ax)+D.d[i+D.w+1]*ax)*ay; }
  const r = Math.max(2, Math.round(Math.max(w,h)*0.006)), eps = 0.0025;
  const mI=boxMean(I,w,h,r), mP=boxMean(p,w,h,r);
  const II=new Float32Array(n), IP=new Float32Array(n); for (let i=0;i<n;i++){ II[i]=I[i]*I[i]; IP[i]=I[i]*p[i]; }
  const mII=boxMean(II,w,h,r), mIP=boxMean(IP,w,h,r);
  const a=new Float32Array(n), b=new Float32Array(n);
  for (let i=0;i<n;i++){ const varI=mII[i]-mI[i]*mI[i], cov=mIP[i]-mI[i]*mP[i]; a[i]=cov/(varI+eps); b[i]=mP[i]-a[i]*mI[i]; }
  const ma=boxMean(a,w,h,r), mb=boxMean(b,w,h,r), d=new Float32Array(n);
  for (let i=0;i<n;i++) d[i]=Math.min(1,Math.max(0, ma[i]*I[i]+mb[i]));
  return {w, h, d};
}

// ---------------------------------------------------------------- floor plane and depth range
// The model's depth is only known up to a scale and a shift. A level floor has disparity that
// is a flat plane in (column, row, depth), and that plane reaches zero at the horizon. Fitting
// it with RANSAC finds the floor (so it can be swapped for the synthetic one) and pins the shift,
// which sets how far away the back wall really is compared with the subject.
function fitFloor(D){
  const W=D.w, H=D.h, rnd=seeded(11), pts=[];
  for (let k=0;k<3000;k++){ const x=(rnd()*W)|0, y=(H*0.42+rnd()*H*0.58)|0; pts.push([(x+.5)/W,(y+.5)/H,D.d[y*W+x]]); }
  let best=null, bestN=0; const tol=0.012;
  for (let it=0; it<300; it++){
    const a=pts[(rnd()*pts.length)|0], b=pts[(rnd()*pts.length)|0], c=pts[(rnd()*pts.length)|0];
    const ux=b[0]-a[0], uy=b[1]-a[1], ud=b[2]-a[2], vx=c[0]-a[0], vy=c[1]-a[1], vd=c[2]-a[2];
    const nx=uy*vd-ud*vy, ny=ud*vx-ux*vd, nd=ux*vy-uy*vx; if (Math.abs(nd)<1e-6) continue;
    const al=-nx/nd, be=-ny/nd, ga=a[2]-al*a[0]-be*a[1];
    if (!(be > 0.5 && Math.abs(al) < 0.6*be)) continue;          // a floor gets nearer as you look down the frame
    let n=0; for (const p of pts) if (Math.abs(p[2]-(al*p[0]+be*p[1]+ga)) < tol) n++;
    if (n > bestN){ bestN=n; best=[al,be,ga]; }
  }
  if (!best || bestN < pts.length*0.12) return null;
  // least-squares polish on the inliers
  const inl = pts.filter(p=>Math.abs(p[2]-(best[0]*p[0]+best[1]*p[1]+best[2])) < tol);
  let Sxx=0,Sxy=0,Sx=0,Syy=0,Sy=0,Sn=inl.length,Sxd=0,Syd=0,Sd=0;
  for (const [x,y,d] of inl){ Sxx+=x*x; Sxy+=x*y; Sx+=x; Syy+=y*y; Sy+=y; Sxd+=x*d; Syd+=y*d; Sd+=d; }
  const A=[[Sxx,Sxy,Sx],[Sxy,Syy,Sy],[Sx,Sy,Sn]], B=[Sxd,Syd,Sd];
  const det=m=>m[0][0]*(m[1][1]*m[2][2]-m[1][2]*m[2][1])-m[0][1]*(m[1][0]*m[2][2]-m[1][2]*m[2][0])+m[0][2]*(m[1][0]*m[2][1]-m[1][1]*m[2][0]);
  const D0=det(A); if (Math.abs(D0)<1e-12) return {al:best[0],be:best[1],ga:best[2],frac:bestN/pts.length};
  const col=(i)=>A.map((r,k)=>r.map((v,j)=>j===i?B[k]:v));
  return {al:det(col(0))/D0, be:det(col(1))/D0, ga:det(col(2))/D0, frac:inl.length/pts.length};
}
function groundMask(D, pl){
  const g = new Uint8Array(D.w*D.h); if (!pl) return g;
  for (let y=0;y<D.h;y++){ const v=(y+.5)/D.h;
    for (let x=0;x<D.w;x++){ const u=(x+.5)/D.w, e=pl.al*u+pl.be*v+pl.ga, r=D.d[y*D.w+x]-e; if (e<=0.02) continue;
      // 1 = on the floor; 2 = at or behind the floor, which nothing standing on it can be
      if (Math.abs(r) < 0.022) g[y*D.w+x]=1; else if (r < 0) g[y*D.w+x]=2; } }
  return g;
}
function estimateShift(pl){
  // level camera: the horizon is the middle row, where the floor's true disparity is zero
  if (pl){ const t = -(pl.al*0.5 + pl.be*0.5 + pl.ga); if (t > 0.04 && t < 3) return t; }
  return 1/3;                      // no floor to go on: assume the far wall is 4 times further than the subject
}
function otsu(d, skip){
  const bins=64, hist=new Float64Array(bins); let total=0;
  for (let i=0;i<d.length;i++){ if (skip && skip[i]) continue; hist[Math.min(bins-1,(d[i]*bins)|0)]++; total++; }
  let sum=0; for (let i=0;i<bins;i++) sum+=i*hist[i];
  let sB=0,wB=0,best=0,th=bins/2;
  for (let i=0;i<bins;i++){ wB+=hist[i]; if(!wB) continue; const wF=total-wB; if(!wF) break; sB+=i*hist[i];
    const mB=sB/wB, mF=(sum-sB)/wF, v=wB*wF*(mB-mF)*(mB-mF); if(v>best){best=v; th=i+1;} }
  return th/bins;
}

// ---------------------------------------------------------------- geometry
function depthAt(u,v){ const D=S.depth; const x=Math.min(D.w-1.001,Math.max(0,u*D.w-.5)), y=Math.min(D.h-1.001,Math.max(0,v*D.h-.5));
  const x0=x|0,y0=y|0,ax=x-x0,ay=y-y0,i=y0*D.w+x0, d=D.d;
  return (d[i]*(1-ax)+d[i+1]*ax)*(1-ay)+(d[i+D.w]*(1-ax)+d[i+D.w+1]*ax)*ay; }
function curShift(){
  // the 3D control scales the near-to-far ratio found for this photo
  const R0 = (1+S.shiftAuto)/S.shiftAuto, R = Math.max(1.03, Math.min(80, Math.pow(R0, val('depth3d'))));
  return 1/(R-1);
}
let SHIFT = 1/3;
function zOf(d){ return 1.2*(1+SHIFT)/(d+SHIFT); }
function unproject(u,v,z){ const a=S.photo.w/S.photo.h; return [(2*u-1)*S.tanV*a*z, (1-2*v)*S.tanV*z, -z]; }
function uvOf(p){ const a=S.photo.w/S.photo.h, z=-p[2]; return [(p[0]/(S.tanV*a*z)+1)/2, (1-p[1]/(S.tanV*z))/2]; }
