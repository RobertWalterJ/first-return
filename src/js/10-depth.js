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
// A scene can have more than one floor: water and a dock, a road and a pavement, a deck and the sea.
// Fit the biggest one, set its points aside, and look again, up to three times.
function fitFloors(D){
  const W=D.w, H=D.h, rnd=seeded(11), pts=[];
  for (let k=0;k<4000;k++){ const x=(rnd()*W)|0, y=(H*0.42+rnd()*H*0.58)|0; pts.push([(x+.5)/W,(y+.5)/H,D.d[y*W+x]]); }
  const planes=[]; let rest=pts;
  for (let k=0;k<3;k++){
    const pl = fitFloor(rest, rnd, pts.length*(k===0 ? 0.12 : 0.06)); if (!pl) break;
    pl.frac = pl.n/pts.length; planes.push(pl);
    rest = rest.filter(p=>Math.abs(p[2]-(pl.al*p[0]+pl.be*p[1]+pl.ga)) >= 0.02);
    if (rest.length < 300) break;
  }
  return planes;
}
function fitFloor(pts, rnd, minN){
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
  if (!best || bestN < minN) return null;
  // least-squares polish on the inliers
  const inl = pts.filter(p=>Math.abs(p[2]-(best[0]*p[0]+best[1]*p[1]+best[2])) < tol);
  let Sxx=0,Sxy=0,Sx=0,Syy=0,Sy=0,Sn=inl.length,Sxd=0,Syd=0,Sd=0;
  for (const [x,y,d] of inl){ Sxx+=x*x; Sxy+=x*y; Sx+=x; Syy+=y*y; Sy+=y; Sxd+=x*d; Syd+=y*d; Sd+=d; }
  const A=[[Sxx,Sxy,Sx],[Sxy,Syy,Sy],[Sx,Sy,Sn]], B=[Sxd,Syd,Sd];
  const det=m=>m[0][0]*(m[1][1]*m[2][2]-m[1][2]*m[2][1])-m[0][1]*(m[1][0]*m[2][2]-m[1][2]*m[2][0])+m[0][2]*(m[1][0]*m[2][1]-m[1][1]*m[2][0]);
  const D0=det(A); if (Math.abs(D0)<1e-12) return {al:best[0],be:best[1],ga:best[2],n:bestN};
  const col=(i)=>A.map((r,k)=>r.map((v,j)=>j===i?B[k]:v));
  return {al:det(col(0))/D0, be:det(col(1))/D0, ga:det(col(2))/D0, n:inl.length};
}
// 1, 2, 3 = on floor 1, 2 or 3; 9 = at or behind the main floor, which nothing standing on it can be.
// Only the main floor gets the "behind" rule: a smaller fitted surface could be the top of a car
// bonnet, and the rest of the car is behind that.
function groundMask(D, planes){
  const g = new Uint8Array(D.w*D.h); if (!planes.length) return g;
  for (let y=0;y<D.h;y++){ const v=(y+.5)/D.h;
    for (let x=0;x<D.w;x++){ const u=(x+.5)/D.w, i=y*D.w+x, d=D.d[i];
      for (let k=0;k<planes.length;k++){ const pl=planes[k], e=pl.al*u+pl.be*v+pl.ga; if (e<=0.02) continue;
        const r=d-e; if (Math.abs(r) < 0.015+0.03*e){ g[i]=1+k; break; } if (k===0 && r<0) g[i]=9; } } }
  return g;
}
// Any big upward-facing surface that runs off the bottom of the frame is floor too: a dock, a deck,
// a pavement, a table top. Planes alone missed wet boards, whose depth is not flat enough to fit.
// Held things (a boat on a shoulder) face up too but do not reach the bottom edge, so they stay.
// Needs the camera and depth range set first.
function upFacingGround(D, g){
  const W=D.w, H=D.h, k=Math.max(2, Math.round(W*0.006)), up=new Uint8Array(W*H);
  for (let y=k;y<H-k;y+=1) for (let x=k;x<W-k;x+=1){
    const u=(x+.5)/W, v=(y+.5)/H, du=k/W, dv=k/H, i=y*W+x;
    const zc=zOf(D.d[i]), zl=zOf(D.d[i-k]), zr=zOf(D.d[i+k]), zu=zOf(D.d[i-k*W]), zd=zOf(D.d[i+k*W]);
    // a floor has no sideways depth jumps; across the edge of a thin thing the "normal" is nonsense
    if (Math.abs(zr-zl) > 0.06*zc || Math.abs(zd-zu) > 0.3*zc) continue;
    const pl=unproject(u-du,v,zl), pr=unproject(u+du,v,zr), pu=unproject(u,v-dv,zu), pd=unproject(u,v+dv,zd);
    const ax=pr[0]-pl[0], ay=pr[1]-pl[1], az=pr[2]-pl[2], bx=pd[0]-pu[0], by=pd[1]-pu[1], bz=pd[2]-pu[2];
    const nx=ay*bz-az*by, ny=az*bx-ax*bz, nz=ax*by-ay*bx, nl=Math.hypot(nx,ny,nz)||1;
    if (Math.abs(ny)/nl > 0.82 && v > 0.35) up[i]=1;
  }
  // keep connected patches that are big and reach the bottom edge
  const seen=new Uint8Array(W*H), q=new Int32Array(W*H);
  for (let s=0;s<W*H;s++){
    if (!up[s] || seen[s]) continue;
    let head=0, tail=0, anchored=false; q[tail++]=s; seen[s]=1;
    while(head<tail){ const i=q[head++], x=i%W, y=(i/W)|0;
      if (y>=H-k-2) anchored=true;
      for (const j of [x>0?i-1:-1, x<W-1?i+1:-1, y>0?i-W:-1, y<H-1?i+W:-1]){ if (j<0) continue;
        if (up[j] && !seen[j]){ seen[j]=1; q[tail++]=j; } } }
    if (anchored && tail > W*H*0.012) for (let t=0;t<tail;t++) if (!g[q[t]]) g[q[t]]=4;
  }
  return g;
}
// How far the camera was rolled, from how far the photo's vertical edges lean (walls, poles, door
// frames, easels, people standing). Depth models learn from upright photos and tend to straighten
// floors in their output, so the floor under-reads a tilt; vertical edges do not.
function rollFromVerticals(canvas){
  const L=640, s=Math.min(1, L/Math.max(canvas.width,canvas.height)), w=Math.round(canvas.width*s), h=Math.round(canvas.height*s);
  const c=document.createElement('canvas'); c.width=w; c.height=h; const x=c.getContext('2d',{willReadFrequently:true}); x.drawImage(canvas,0,0,w,h);
  const px=x.getImageData(0,0,w,h).data, g=new Float32Array(w*h); for (let i=0;i<w*h;i++) g[i]=0.299*px[i*4]+0.587*px[i*4+1]+0.114*px[i*4+2];
  const gx=new Float32Array(w*h), gy=new Float32Array(w*h);
  for (let y=1;y<h-1;y++) for (let xx=1;xx<w-1;xx++){ const i=y*w+xx;
    gx[i]=(g[i-w+1]+2*g[i+1]+g[i+w+1])-(g[i-w-1]+2*g[i-1]+g[i+w-1]); gy[i]=(g[i+w-1]+2*g[i+w]+g[i+w+1])-(g[i-w-1]+2*g[i-w]+g[i-w+1]); }
  // Structure tensor over 7x7 windows: the edge direction is averaged, so pixel-grid and JPEG block
  // edges stop pulling the answer toward zero, and coherence keeps long straight lines over foliage.
  const r=3, bins=new Float64Array(97);                 // -12..+12 degrees in quarter-degree bins
  for (let y=r+1;y<h-r-1;y+=2) for (let xx=r+1;xx<w-r-1;xx+=2){
    let a=0,b=0,cc=0; for (let dy=-r;dy<=r;dy++) for (let dx=-r;dx<=r;dx++){ const j=(y+dy)*w+xx+dx; a+=gx[j]*gx[j]; b+=gy[j]*gy[j]; cc+=gx[j]*gy[j]; }
    const tr=a+b; if (tr < 60*60*49) continue;
    const coh=Math.sqrt((a-b)**2+4*cc*cc)/tr; if (coh<0.75) continue;
    const d=0.5*Math.atan2(2*cc, a-b)*180/Math.PI; if (Math.abs(d)>12) continue;   // how far a vertical edge leans
    bins[Math.round((d+12)*4)] += Math.sqrt(tr)*coh*coh; }
  let total=0; for (const q of bins) total+=q; if (!total) return 0;
  let best=-1, bi=48; for (let k=2;k<95;k++){ const v=bins[k-2]+2*bins[k-1]+3*bins[k]+2*bins[k+1]+bins[k+2]; if (v>best){ best=v; bi=k; } }
  if (best/9 < total/97*4) return 0;                   // no clear shared lean: leave the photo alone
  let sw=0, sd=0; for (let k=bi-3;k<=bi+3;k++){ sw+=bins[k]; sd+=bins[k]*((k/4)-12); }
  return (sd/sw)*Math.PI/180;
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
