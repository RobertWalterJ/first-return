// ---------------------------------------------------------------- scanning a scene from a video
// A real 3D scene from many views, made on the phone: no server, no training loop.
//  1. frames: about 2.5 a second from a slow walk around something (up to 40);
//  2. depth for each frame, its range eased across frames so it holds steady;
//  3. the camera's path: corner features (FAST) with binary descriptors (BRIEF) are matched between
//     neighbouring frames, lifted into 3D with depth, and the move between frames is solved as a rotation,
//     shift and scale (Horn's method inside RANSAC, so bad matches are thrown out);
//  4. every frame's points go into one voxel grid, averaging position and colour; a voxel seen from only
//     one frame is dropped, which removes most floaters;
//  5. the voxels become splats and open like any scan, with every look, move, Measure and splat export.
// It is not a trained splat (that needs a GPU training loop) but it is truly three-dimensional.

// ---- features
const FAST_RING = [[0,-3],[1,-3],[2,-2],[3,-1],[3,0],[3,1],[2,2],[1,3],[0,3],[-1,3],[-2,2],[-3,1],[-3,0],[-3,-1],[-2,-2],[-1,-3]];
const BRIEF_PAIRS = (()=>{ const r=seeded(1234), p=[]; const g=()=>Math.max(-13,Math.min(13,Math.round(gauss(r)*5.5)));
  for (let i=0;i<256;i++) p.push([g(),g(),g(),g()]); return p; })();
function grayOf(data, w, h){ const g=new Uint8Array(w*h); for (let i=0;i<w*h;i++) g[i]=(data[i*4]*77+data[i*4+1]*150+data[i*4+2]*29)>>8; return g; }
function boxBlur(g, w, h){ const t=new Uint8Array(w*h), o=new Uint8Array(w*h);
  for (let y=0;y<h;y++){ let s=0; for (let x=-2;x<=2;x++) s+=g[y*w+Math.max(0,Math.min(w-1,x))];
    for (let x=0;x<w;x++){ t[y*w+x]=s/5; s+=g[y*w+Math.min(w-1,x+3)]-g[y*w+Math.max(0,x-2)]; } }
  for (let x=0;x<w;x++){ let s=0; for (let y=-2;y<=2;y++) s+=t[Math.max(0,Math.min(h-1,y))*w+x];
    for (let y=0;y<h;y++){ o[y*w+x]=s/5; s+=t[Math.min(h-1,y+3)*w+x]-t[Math.max(0,y-2)*w+x]; } }
  return o; }
function features(data, w, h, want=1100){
  const g=grayOf(data,w,h), T=16, B=18, score=new Float32Array(w*h), ring=FAST_RING.map(([dx,dy])=>dy*w+dx);
  for (let y=B;y<h-B;y++) for (let x=B;x<w-B;x++){ const i=y*w+x, c=g[i], hi=c+T, lo=c-T;
    // quick test on the four compass points: a corner needs three of them clearly brighter or darker
    let nb=0, nd=0; for (const k of [0,4,8,12]){ const v=g[i+ring[k]]; if (v>hi) nb++; else if (v<lo) nd++; }
    if (nb<2 && nd<2) continue;
    // nine in a row, all brighter or all darker
    let run=0, best=0, dir=nb>=nd?1:-1;
    for (let k=0;k<25;k++){ const v=g[i+ring[k&15]]; if (dir>0 ? v>hi : v<lo){ run++; if (run>best) best=run; } else run=0; }
    if (best<9) continue;
    let s=0; for (let k=0;k<16;k++) s+=Math.abs(g[i+ring[k]]-c); score[i]=s; }
  // keep local maxima, spread over a grid so the whole frame is covered
  const cells=12, cw=w/cells, ch=h/cells, buckets=Array.from({length:cells*cells},()=>[]);
  for (let y=B;y<h-B;y++) for (let x=B;x<w-B;x++){ const i=y*w+x, s=score[i]; if (!s) continue;
    if (s<score[i-1]||s<score[i+1]||s<score[i-w]||s<score[i+w]||s<score[i-w-1]||s<score[i-w+1]||s<score[i+w-1]||s<score[i+w+1]) continue;
    buckets[Math.min(cells-1,(y/ch)|0)*cells+Math.min(cells-1,(x/cw)|0)].push([s,x,y]); }
  const per=Math.ceil(want/(cells*cells))+2, kp=[];
  for (const b of buckets){ b.sort((a,c)=>c[0]-a[0]); for (let k=0;k<Math.min(per,b.length);k++) kp.push(b[k]); }
  kp.sort((a,c)=>c[0]-a[0]); kp.length=Math.min(kp.length, want);
  const sm=boxBlur(g,w,h), desc=new Uint32Array(kp.length*8), xy=new Float32Array(kp.length*2);
  kp.forEach(([,x,y],n)=>{ xy[n*2]=x; xy[n*2+1]=y; const base=y*w+x;
    for (let b=0;b<256;b++){ const [ax,ay,bx,by]=BRIEF_PAIRS[b]; if (sm[base+ay*w+ax] < sm[base+by*w+bx]) desc[n*8+(b>>5)] |= 1<<(b&31); } });
  return {n:kp.length, xy, desc};
}
const popc = x => { x-=(x>>>1)&0x55555555; x=(x&0x33333333)+((x>>>2)&0x33333333); return (((x+(x>>>4))&0x0F0F0F0F)*0x01010101)>>>24; };
function matchFeatures(A, B){
  const bestAB=new Int32Array(A.n).fill(-1), dAB=new Int32Array(A.n), bestBA=new Int32Array(B.n).fill(-1), dBA=new Int32Array(B.n).fill(999);
  for (let i=0;i<A.n;i++){ let b1=999, b2=999, bj=-1; const ai=i*8;
    for (let j=0;j<B.n;j++){ const bjj=j*8; let d=0; for (let k=0;k<8;k++) d+=popc(A.desc[ai+k]^B.desc[bjj+k]);
      if (d<b1){ b2=b1; b1=d; bj=j; } else if (d<b2) b2=d;
      if (d<dBA[j]){ dBA[j]=d; bestBA[j]=i; } }
    if (b1<64 && b1<0.8*b2){ bestAB[i]=bj; dAB[i]=b1; } }
  const m=[]; for (let i=0;i<A.n;i++){ const j=bestAB[i]; if (j>=0 && bestBA[j]===i) m.push([i,j]); }
  return m;
}

// ---- geometry: a similarity (scale, rotation, shift) from matched 3D points, by Horn's quaternion method
function jacobiEig4(M){ const a=M.map(r=>r.slice()), v=[[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]];
  for (let sweep=0;sweep<30;sweep++){ let off=0; for (let p=0;p<4;p++) for (let q=p+1;q<4;q++) off+=a[p][q]*a[p][q]; if (off<1e-18) break;
    for (let p=0;p<4;p++) for (let q=p+1;q<4;q++){ if (Math.abs(a[p][q])<1e-20) continue;
      const th=(a[q][q]-a[p][p])/(2*a[p][q]), t=Math.sign(th||1)/(Math.abs(th)+Math.sqrt(th*th+1)), c=1/Math.sqrt(t*t+1), s=t*c;
      for (let k=0;k<4;k++){ const akp=a[k][p], akq=a[k][q]; a[k][p]=c*akp-s*akq; a[k][q]=s*akp+c*akq; }
      for (let k=0;k<4;k++){ const apk=a[p][k], aqk=a[q][k]; a[p][k]=c*apk-s*aqk; a[q][k]=s*apk+c*aqk; }
      for (let k=0;k<4;k++){ const vkp=v[k][p], vkq=v[k][q]; v[k][p]=c*vkp-s*vkq; v[k][q]=s*vkp+c*vkq; } } }
  let bi=0; for (let i=1;i<4;i++) if (a[i][i]>a[bi][bi]) bi=i; return [v[0][bi],v[1][bi],v[2][bi],v[3][bi]]; }
function quatMat(w,x,y,z){ return [1-2*(y*y+z*z), 2*(x*y-w*z), 2*(x*z+w*y), 2*(x*y+w*z), 1-2*(x*x+z*z), 2*(y*z-w*x), 2*(x*z-w*y), 2*(y*z+w*x), 1-2*(x*x+y*y)]; }
const xfR = (R,p) => [R[0]*p[0]+R[1]*p[1]+R[2]*p[2], R[3]*p[0]+R[4]*p[1]+R[5]*p[2], R[6]*p[0]+R[7]*p[1]+R[8]*p[2]];
function similarity(P, Q, idx){
  const n=idx.length; let pc=[0,0,0], qc=[0,0,0];
  for (const i of idx) for (let k=0;k<3;k++){ pc[k]+=P[i][k]/n; qc[k]+=Q[i][k]/n; }
  const S3=[0,0,0,0,0,0,0,0,0]; let pp=0, qq=0;
  for (const i of idx){ const p=[P[i][0]-pc[0],P[i][1]-pc[1],P[i][2]-pc[2]], q=[Q[i][0]-qc[0],Q[i][1]-qc[1],Q[i][2]-qc[2]];
    for (let a=0;a<3;a++) for (let b=0;b<3;b++) S3[a*3+b]+=p[a]*q[b]; pp+=p[0]*p[0]+p[1]*p[1]+p[2]*p[2]; qq+=q[0]*q[0]+q[1]*q[1]+q[2]*q[2]; }
  const [xx,xy,xz,yx,yy,yz,zx,zy,zz]=S3;
  const q=jacobiEig4([[xx+yy+zz, yz-zy, zx-xz, xy-yx],[yz-zy, xx-yy-zz, xy+yx, zx+xz],[zx-xz, xy+yx, -xx+yy-zz, yz+zy],[xy-yx, zx+xz, yz+zy, -xx-yy+zz]]);
  // Horn's symmetric scale: a one-sided (regression) scale is biased low when both sides are noisy, and
  // chained over thirty frames that shrank the scene by a third
  const R=quatMat(q[0],q[1],q[2],q[3]), s = pp>1e-12 ? Math.sqrt(qq/pp) : 1, rpc=xfR(R,pc);
  return {s, R, t:[qc[0]-s*rpc[0], qc[1]-s*rpc[1], qc[2]-s*rpc[2]]};
}
const applySim = (T,p) => { const r=xfR(T.R,p); return [T.s*r[0]+T.t[0], T.s*r[1]+T.t[1], T.s*r[2]+T.t[2]]; };
// the inverse move: R^T (q - t) / s
const unapplySim = (T,q) => { const d=[q[0]-T.t[0], q[1]-T.t[1], q[2]-T.t[2]], R=T.R; return [(R[0]*d[0]+R[3]*d[1]+R[6]*d[2])/T.s, (R[1]*d[0]+R[4]*d[1]+R[7]*d[2])/T.s, (R[2]*d[0]+R[5]*d[1]+R[8]*d[2])/T.s]; };
// Fit inverse depth as a*d + b to target inverse depths (robust: fit, drop the worst, fit again)
function fitInvDepth(ds, inv){
  const fit = idx => { let n=0,sx=0,sy=0,sxx=0,sxy=0; for (const i of idx){ n++; sx+=ds[i]; sy+=inv[i]; sxx+=ds[i]*ds[i]; sxy+=ds[i]*inv[i]; }
    const den=n*sxx-sx*sx; if (n<8 || Math.abs(den)<1e-12) return null; const a=(n*sxy-sx*sy)/den; return [a, (sy-a*sx)/n]; };
  let idx=ds.map((_,i)=>i), ab=fit(idx); if (!ab) return null;
  for (let pass=0; pass<2; pass++){ const r=idx.map(i=>Math.abs(ab[0]*ds[i]+ab[1]-inv[i])), med=r.slice().sort((x,y)=>x-y)[r.length>>1]||0;
    const keep=idx.filter((i,k)=>r[k] <= 2.5*med+1e-9); const ab2=fit(keep); if (!ab2) break; ab=ab2; idx=keep; }
  return ab[0] > 0 ? ab : null;
}
function composeSim(A, B){ // A after B
  const R=[0,0,0,0,0,0,0,0,0]; for (let i=0;i<3;i++) for (let j=0;j<3;j++) for (let k=0;k<3;k++) R[i*3+j]+=A.R[i*3+k]*B.R[k*3+j];
  const at=applySim({s:A.s,R:A.R,t:[0,0,0]}, B.t); return {s:A.s*B.s, R, t:[at[0]+A.t[0], at[1]+A.t[1], at[2]+A.t[2]]}; }
// Q2 holds the reference frame's pixel for each match; proj puts a 3D point into that frame's pixels.
// A match counts when the moved point lands within a few pixels of where it was seen, and its depth
// roughly agrees (depth from one photo is least reliable along the line of sight, so it only gates).
function ransacSim(P, Q, Q2, proj){
  const n=P.length, rnd=seeded(77); if (n<8) return null; let best=null, bestIn=[];
  const inliers = T => { const out=[]; for (let i=0;i<n;i++){ const p=applySim(T,P[i]), q=Q[i];
      if (p[2] > -1e-3) continue; const px=proj(p), dz=Math.abs(p[2]/q[2]-1);
      if (Math.hypot(px[0]-Q2[i*2], px[1]-Q2[i*2+1]) < 3.5 && dz < 0.25) out.push(i); } return out; };
  for (let it=0; it<300; it++){
    const a=(rnd()*n)|0, b=(rnd()*n)|0, c=(rnd()*n)|0; if (a===b||b===c||a===c) continue;
    const T=similarity(P,Q,[a,b,c]); if (!(T.s>0.6 && T.s<1.6)) continue;          // neighbouring frames are close to the same scale
    const inl=inliers(T); if (inl.length>bestIn.length){ bestIn=inl; best=T; } }
  if (!best || bestIn.length < Math.max(12, n*0.25)) return null;
  let T=similarity(P,Q,bestIn); let inl2=inliers(T); if (inl2.length>=bestIn.length) T=similarity(P,Q,inl2); else inl2=bestIn;
  return {T, idx:inl2, of:n};
}

// ---- placing a camera from what it sees: points already in the scene, and where they land in its picture
function rodrigues(wx, wy, wz){ const th=Math.hypot(wx,wy,wz); if (th<1e-12) return [1,-wz,wy, wz,1,-wx, -wy,wx,1];
  const kx=wx/th, ky=wy/th, kz=wz/th, c=Math.cos(th), s=Math.sin(th), v=1-c;
  return [c+kx*kx*v, kx*ky*v-kz*s, kx*kz*v+ky*s, ky*kx*v+kz*s, c+ky*ky*v, ky*kz*v-kx*s, kz*kx*v-ky*s, kz*ky*v+kx*s, c+kz*kz*v]; }
function mul3(A, B){ const R=[0,0,0,0,0,0,0,0,0]; for (let i=0;i<3;i++) for (let j=0;j<3;j++) R[i*3+j]=A[i*3]*B[j]+A[i*3+1]*B[3+j]+A[i*3+2]*B[6+j]; return R; }
function solve6(M, b){ const n=6, a=M.map((r,i)=>[...r, b[i]]);
  for (let c=0;c<n;c++){ let p=c; for (let r=c+1;r<n;r++) if (Math.abs(a[r][c])>Math.abs(a[p][c])) p=r; [a[c],a[p]]=[a[p],a[c]]; if (Math.abs(a[c][c])<1e-18) return null;
    for (let r=0;r<n;r++){ if (r===c) continue; const f=a[r][c]/a[c][c]; for (let k=c;k<=n;k++) a[r][k]-=f*a[c][k]; } }
  return a.map((r,i)=>r[n]/r[i]); }
// Levenberg-Marquardt on picture error (Huber-weighted), so a few wrong matches cannot drag the camera
function refinePose(T, X, obs, idx, proj, iters=10){
  let R=T.R.slice(), t=T.t.slice(), lam=1e-3;
  const res = (R, t) => { const r=new Float64Array(idx.length*2); idx.forEach((k,j)=>{ const c=unapplySim({s:1,R,t}, X[k]);
      if (c[2] > -1e-3){ r[j*2]=r[j*2+1]=50; return; } const u=proj(c); r[j*2]=u[0]-obs[k*2]; r[j*2+1]=u[1]-obs[k*2+1]; }); return r; };
  const cost = r => { let s=0; for (let i=0;i<r.length;i+=2){ const e=Math.hypot(r[i],r[i+1]); s += e<2 ? e*e : 4*e-4; } return s; };
  const step = (R, t, d) => [mul3(R, rodrigues(d[0],d[1],d[2])), [t[0]+d[3], t[1]+d[4], t[2]+d[5]]];
  let r0=res(R,t), c0=cost(r0);
  for (let it=0; it<iters; it++){
    const J=[]; for (let p=0;p<6;p++){ const d=[0,0,0,0,0,0]; d[p]=p<3 ? 1e-5 : 1e-5; const [R2,t2]=step(R,t,d), r2=res(R2,t2); J.push(r2.map((v,i)=>(v-r0[i])/1e-5)); }
    const H=[...Array(6)].map(()=>new Array(6).fill(0)), g=new Array(6).fill(0);
    for (let i=0;i<r0.length;i+=2){ const e=Math.hypot(r0[i],r0[i+1]), wgt = e<2 ? 1 : 2/e;
      for (let q=0;q<2;q++) for (let a=0;a<6;a++){ g[a]+=wgt*J[a][i+q]*r0[i+q]; for (let b=a;b<6;b++) H[a][b]+=wgt*J[a][i+q]*J[b][i+q]; } }
    for (let a=0;a<6;a++) for (let b=0;b<a;b++) H[a][b]=H[b][a];
    let ok=false;
    for (let tries=0; tries<5 && !ok; tries++){ const Hd=H.map((row,a)=>row.map((v,b)=>a===b ? v*(1+lam)+1e-9 : v)), d=solve6(Hd, g.map(v=>-v)); if (!d) break;
      const [R2,t2]=step(R,t,d), r2=res(R2,t2), c2=cost(r2);
      if (c2 < c0){ R=R2; t=t2; r0=r2; ok = (c0-c2) > 1e-6*c0; c0=c2; lam=Math.max(1e-7, lam/3); if (!ok) return {s:1,R,t}; } else lam*=10; }
    if (!ok) break;
  }
  return {s:1, R, t};
}

// Laplacian energy of the grey image: motion blur lowers it, so the sharpest nearby moment is kept
function sharpness(data, w, h){ let s=0, n=0;
  for (let y=2;y<h-2;y+=2) for (let x=2;x<w-2;x+=2){ const i=(y*w+x)*4, g=k=>data[k]+data[k+1]+data[k+2];
    const L=4*g(i)-g(i-4)-g(i+4)-g(i-w*4)-g(i+w*4); s+=L*L; n++; }
  return s/(n||1); }

// ---- one frame: depth, colour and features, from a picture already drawn at the working size
// st carries the depth range between frames, eased so that it holds steady.
async function frameFromCanvas(c, w, h, st, sharp){
  const data = c.getContext('2d', {willReadFrequently:true}).getImageData(0,0,w,h).data;
  const raw = await estimateDepth(c, null, true, MOBILE ? 364 : 434);
  const srt = Float32Array.from(raw.d).sort(), l0 = srt[Math.floor(srt.length*0.005)], h0 = srt[Math.min(srt.length-1, Math.floor(srt.length*0.9995))];
  st.lo = st.lo==null ? l0 : st.lo*0.7+l0*0.3; st.hi = st.hi==null ? h0 : st.hi*0.7+h0*0.3;
  const d = new Float32Array(raw.d.length); for (let k=0;k<d.length;k++) d[k] = Math.min(1, Math.max(0, (raw.d[k]-st.lo)/(st.hi-st.lo||1)));
  // colour is kept only at the depth grid's size, which is all the fusion reads (a quarter of the memory)
  const cc=document.createElement('canvas'); cc.width=raw.w; cc.height=raw.h; const cx=cc.getContext('2d', {willReadFrequently:true}); cx.drawImage(c, 0, 0, raw.w, raw.h);
  return {col:cx.getImageData(0,0,raw.w,raw.h).data, depth:{w:raw.w, h:raw.h, d}, feat:features(data, w, h), sharp: sharp ?? sharpness(data, w, h)};
}

// ---- the whole scan from a video file
async function scanFromVideo(file){
  const g = ++S.gen, url = URL.createObjectURL(file), vid = document.createElement('video');
  vid.muted = true; vid.playsInline = true; vid.preload = 'auto'; vid.src = url;
  busy('Opening the video', null);
  let wake = null; try { wake = await navigator.wakeLock?.request('screen'); } catch(e){}     // keep the screen on while it works
  try {
    await new Promise((res, rej)=>{ vid.onloadeddata = res; vid.onerror = () => rej(new Error('this video could not be read')); setTimeout(()=>rej(new Error('this video took too long to open')), 20000); });
    if (!isFinite(vid.duration)){ vid.currentTime = 1e7; await new Promise(res=>{ vid.ondurationchange = res; vid.onseeked = res; setTimeout(res, 3000); }); vid.currentTime = 0; }
    if (!(vid.duration > 1)) throw new Error('this video is too short to scan from');
    // frames spread over the whole video, at most about 0.65 s apart (further than that and neighbours share
    // too little to be matched); a longer video is cut to what that covers, and says so
    const budget = MOBILE ? 36 : 44, dur = Math.min(vid.duration, budget/1.5), n = Math.max(6, Math.min(budget, Math.round(dur*2.5))), trimmed = vid.duration > dur + 0.5;
    const gap = (dur-0.2)/(n-1);
    // seek, then wait for that frame to be ready to draw; some phones never report the seek, so give up after a while
    const seekTo = t => new Promise(res=>{ let done=false; const fin=()=>{ if (!done){ done=true; res(); } };
      vid.onseeked = () => { if (vid.requestVideoFrameCallback) { vid.requestVideoFrameCallback(()=>fin()); setTimeout(fin, 400); } else fin(); };
      setTimeout(fin, 4000); vid.currentTime = t; });
    const LONG = 640, sc = Math.min(1, LONG/Math.max(vid.videoWidth, vid.videoHeight)), w = Math.round(vid.videoWidth*sc), h = Math.round(vid.videoHeight*sc);
    const TL = window.__vsOpt?.tan || 0.62;             // a phone camera's usual view
    const K = {tanX: w>=h ? TL : TL*w/h, tanY: w>=h ? TL*h/w : TL, ox:0, oy:0};
    const frames = [], st = {};
    const cv = [0,1,2].map(()=>{ const c=document.createElement('canvas'); c.width=w; c.height=h; return c; });
    const cached = window.__vsKeep && window.__vsKeep[file.name];          // testing only: reuse frames already read
    if (cached) frames.push(...cached);
    for (let i=frames.length;i<n;i++){
      busy(`Reading frame ${i+1} of ${n}: finding the sharpest moment`, i/n*0.8);
      // three moments around each sample time; the sharpest one is used (a hand-held video blurs often)
      const t0 = 0.1 + i*gap; let best=-1, bi=0;
      for (let k=0;k<3;k++){ await seekTo(Math.max(0.05, Math.min(dur-0.05, t0 + (k-1)*gap*0.3))); if (g!==S.gen) return;
        const x=cv[k].getContext('2d', {willReadFrequently:true}); x.drawImage(vid, 0, 0, w, h);
        const s=sharpness(x.getImageData(0,0,w,h).data, w, h); if (s>best){ best=s; bi=k; } }
      busy(`Reading frame ${i+1} of ${n}: depth and features`, (i+0.3)/n*0.8); await tick();
      frames.push(await frameFromCanvas(cv[bi], w, h, st, best)); if (g!==S.gen) return;
    }
    if (window.__vsKeep) window.__vsKeep[file.name] = frames;
    await buildScanScene(frames, {g, w, h, K, name:file.name, from:'the video', note: trimmed ? ` Only the first ${Math.round(dur)} seconds were used.` : ''});
  } finally { vid.removeAttribute('src'); vid.load(); URL.revokeObjectURL(url); try { wake?.release(); } catch(e){} }
}

// ---- from frames to a 3D scene. o: {g, w, h, K (lens: tanX, tanY and centre offsets ox, oy), name, from, note,
//      poses (optional: each camera already known, in metres, from the phone's own tracking),
//      metric (optional: per frame, [u, v, metres] samples from the phone's depth sensor)}
async function buildScanScene(frames, o){
  const {g, w, h, K} = o, {tanX, tanY, ox, oy} = K, n = frames.length, known = !!o.poses;
  // a point in a frame's camera, from a pixel and the depth there (null across a depth edge)
  // Each frame's depth is a*d + b in inverse depth. It starts from a guess and is then fitted to where the
  // scene says its points are; relative depth bends differently in every frame, and a shared guess left the
  // same wall at a different depth in each, doubling it.
  const SH = 0.35, A0 = 1/(1.2*(1+SH)), B0 = SH*A0; frames.forEach(F=>{ F.ab=[A0,B0]; });
  const zOfD = dd => 1/(A0*dd+B0), zOfF = (F, dd) => 1/Math.max(1e-3, F.ab[0]*dd+F.ab[1]);
  const lift = (F, px, py) => { const D=F.depth, u=(px+.5)/w, v=(py+.5)/h, xi=Math.min(D.w-2,Math.max(1,(u*D.w)|0)), yi=Math.min(D.h-2,Math.max(1,(v*D.h)|0)), i=yi*D.w+xi, dd=D.d[i];
    if (Math.abs(D.d[i+1]-D.d[i-1]) > 0.06 || Math.abs(D.d[i+D.w]-D.d[i-D.w]) > 0.06 || dd < 0.03) return null;
    const z=zOfF(F, dd); return [(2*u-1-ox)*tanX*z, (1-2*v-oy)*tanY*z, -z]; };
  const proj = p => [((p[0]/-p[2])/tanX+ox+1)/2*w - .5, (1-((p[1]/-p[2])/tanY+oy))/2*h - .5];
  const rayOf = (px, py) => [(2*(px+.5)/w-1-ox)*tanX, (1-2*(py+.5)/h-oy)*tanY, -1];
  const depthAtKp = (F, px, py) => { const D=F.depth, xi=Math.min(D.w-1,((px+.5)/w*D.w)|0), yi=Math.min(D.h-1,((py+.5)/h*D.h)|0); return D.d[yi*D.w+xi]; };
  const mcache = new Map(), matchesOf = (i, j) => { const k=i*4096+j; let m=mcache.get(k); if (!m){ m=matchFeatures(frames[i].feat, frames[j].feat); mcache.set(k, m); } return m; };
  // a tiny grey thumbnail per frame, to guess cheaply which frames look alike before matching features
  for (const F of frames){ const D=F.depth, TW=24, TH=Math.max(8,Math.round(24*D.h/D.w)), v=new Float32Array(TW*TH); let mu=0, sd=0;
    for (let y=0;y<TH;y++) for (let x=0;x<TW;x++){ const k=(((y+.5)/TH*D.h|0)*D.w + ((x+.5)/TW*D.w|0))*4; v[y*TW+x]=F.col[k]+F.col[k+1]+F.col[k+2]; mu+=v[y*TW+x]; }
    mu/=v.length; for (let k=0;k<v.length;k++){ v[k]-=mu; sd+=v[k]*v[k]; } sd=Math.sqrt(sd)||1; for (let k=0;k<v.length;k++) v[k]/=sd; F.thumb=v; }
  const alike = (i, j) => { const a=frames[i].thumb, b=frames[j].thumb; let s=0; for (let k=0;k<a.length;k++) s+=a[k]*b[k]; return s; };
  // the frames most worth matching against: the nearest in time, and the few that look most alike
  const nearOf = (i, pool, span, k) => { const near=pool.filter(j=>j!==i && Math.abs(j-i)<=span), rest=pool.filter(j=>j!==i && Math.abs(j-i)>span);
    return [...near, ...rest.sort((a,b)=>alike(i,b)-alike(i,a)).slice(0,k)]; };
  const pose = known ? o.poses.slice() : [ {s:1, R:[1,0,0,0,1,0,0,0,1], t:[0,0,0]} ];
  const dbg = []; S.vscanLog = {n, w, h, dbg, known, feats:frames.map(F=>F.feat.n), sharp:frames.map(F=>Math.round(F.sharp))};   // for testing from the console
  const tRead = performance.now();
  let placed, lost = 0;
  if (!known){
    // Place frame i against the scene seen by the reference frames: their matched points, already in the
    // scene, must land where frame i saw them (perspective-n-point). Guesses come from 3 matches at a time
    // (Horn's method, using frame i's own rough depth), then the best is polished on picture error alone.
    // Depth from one photo is used only on the side already in the scene, so errors no longer compound.
    const placeFrame = (i, refs, init) => {
      const Fi=frames[i], A=Fi.feat, P=[], X=[], obs=[];
      for (const ref of refs){ const B=frames[ref].feat, m=matchesOf(i, ref);
        for (const [a,b] of m){ const q=lift(frames[ref], B.xy[b*2], B.xy[b*2+1]); if (!q) continue; const p=lift(Fi, A.xy[a*2], A.xy[a*2+1]);
          P.push(p); X.push(applySim(pose[ref], q)); obs.push(A.xy[a*2], A.xy[a*2+1]); } }
      const nn=X.length; if (nn<12) return null;
      const err = (T, k) => { const c=unapplySim(T, X[k]); if (c[2] > -1e-3) return 1e9; const u=proj(c); return Math.hypot(u[0]-obs[k*2], u[1]-obs[k*2+1]); };
      const inl = (T, th) => { const out=[]; for (let k=0;k<nn;k++) if (err(T,k) < th) out.push(k); return out; };
      let T=init, best=init ? inl(init, 8) : [];
      if (!init){ const ok=[]; for (let k=0;k<nn;k++) if (P[k]) ok.push(k); if (ok.length<12) return null; const rnd=seeded(77+i);
        for (let it=0; it<400; it++){ const a=ok[(rnd()*ok.length)|0], b=ok[(rnd()*ok.length)|0], c=ok[(rnd()*ok.length)|0]; if (a===b||b===c||a===c) continue;
          const H=similarity(P, X, [a,b,c]); if (!(H.s>0.4 && H.s<2.5)) continue;
          const H1={s:1, R:H.R, t:H.t}, got=inl(H1, 8); if (got.length>best.length){ best=got; T=H1; } } }
      if (!T || best.length<10) return null;
      T = refinePose(T, X, obs, best, proj); let keep = inl(T, 4);
      if (keep.length>=10){ T = refinePose(T, X, obs, keep, proj); keep = inl(T, 3); }
      if (keep.length < Math.max(15, nn*0.15)) return null;
      // refit this frame's own depth scale to where the scene says its matched points are. Only the scale:
      // fitting a shift too let each frame hand a slightly flatter scene to the next, until the far end came
      // right up to the near.
      const ks=[]; for (const k of keep){ const c=unapplySim(T, X[k]); ks.push((1/-c[2])/(A0*depthAtKp(Fi, obs[k*2], obs[k*2+1])+B0)); } ks.sort((a,b)=>a-b);
      if (ks.length>=8){ const kk=ks[ks.length>>1]; Fi.ab = [kk*A0, kk*B0]; }
      return {T, inl:keep.length, of:nn};
    };
    busy('Following the camera', 0.82); await tick();
    // Pieces of map: when the camera cannot be followed, a new piece starts from that frame rather than the rest
    // of the walk being lost. Afterwards the pieces are joined wherever a view from one is recognised in another
    // (as ORB-SLAM merges maps); the difference in scale between pieces is settled at the join.
    const I3 = {s:1, R:[1,0,0,0,1,0,0,0,1], t:[0,0,0]}, segOf = [0]; let curSeg = 0, nseg = 1;
    placed = [0];
    const inSeg = sg => placed.filter(j=>segOf[j]===sg);
    const attempt = (i, sg) => { const pool=inSeg(sg); if (!pool.length) return null; frames[i].ab = frames[pool[pool.length-1]].ab.slice();
      let r = placeFrame(i, pool.slice(-3)), how='chain';
      if (!r){ // lost: look for this view anywhere in this piece, the frames that look most alike first
        for (const j of pool.slice().sort((a,b)=>alike(i,b)-alike(i,a)).slice(0,6)){ r = placeFrame(i, [j]); if (r){ how='found again'; break; } } }
      if (r){ pose[i]=r.T; segOf[i]=sg; dbg.push({i, how, seg:sg, inl:r.inl, of:r.of}); }
      return r; };
    for (let i=1;i<n;i++){
      let ok = attempt(i, curSeg);
      if (!ok) for (let sg=nseg-1; sg>=0 && !ok; sg--) if (sg!==curSeg && (ok = attempt(i, sg))) curSeg = sg;     // back on an earlier piece
      if (!ok){ curSeg = nseg++; segOf[i]=curSeg; pose[i]={...I3}; frames[i].ab=[A0,B0]; dbg.push({i, how:'new piece', seg:curSeg}); }
      placed.push(i);
      if (i%4===0){ busy(`Following the camera: frame ${i+1} of ${n}`, 0.82+0.06*i/n); await tick(); if (g!==S.gen) return; }
    }
    // join the pieces to the largest, the biggest first
    const sizes = [...Array(nseg)].map((_,sg)=>inSeg(sg).length), order = sizes.map((c,sg)=>sg).sort((a,b)=>sizes[b]-sizes[a]), base = order[0];
    const joined = new Set([base]); S.vscanLog.pieces = sizes.slice();
    for (let pass=0; pass<2; pass++) for (const sg of order){ if (joined.has(sg)) continue;
      const mine = inSeg(sg), theirs = placed.filter(j=>joined.has(segOf[j])); let link=null;
      for (const i of mine){ const saved=frames[i].ab.slice(), before=pose[i];
        for (const j of theirs.slice().sort((a,b)=>alike(i,b)-alike(i,a)).slice(0,4)){ const r=placeFrame(i, [j]); if (r){ link={i, r, before, kB:saved[0]/A0, kA:frames[i].ab[0]/A0}; break; } }
        if (link) break; frames[i].ab = saved; }
      if (!link) continue;
      // the move from this piece into the joined map: turn, scale and shift, found from the frame seen in both
      const Rb=link.before.R, Rt=[Rb[0],Rb[3],Rb[6], Rb[1],Rb[4],Rb[7], Rb[2],Rb[5],Rb[8]], Rm=mul3(link.r.T.R, Rt), sc=link.kB/link.kA;
      const cb=xfR(Rm, link.before.t), tm=[link.r.T.t[0]-sc*cb[0], link.r.T.t[1]-sc*cb[1], link.r.T.t[2]-sc*cb[2]];
      for (const f of mine){ const c=xfR(Rm, pose[f].t); pose[f] = {s:1, R:mul3(Rm, pose[f].R), t:[sc*c[0]+tm[0], sc*c[1]+tm[1], sc*c[2]+tm[2]]};
        if (f!==link.i) frames[f].ab = frames[f].ab.map(v=>v/sc); }
      pose[link.i] = link.r.T; joined.add(sg); dbg.push({i:link.i, how:'joined', seg:sg, scale:+sc.toFixed(3)});
    }
    // frames in pieces that could not be joined are left out
    lost = placed.filter(j=>!joined.has(segOf[j])).length; placed = placed.filter(j=>joined.has(segOf[j])); placed.sort((a,b)=>a-b);
    if (placed.length < 3) throw new Error('the camera could not be followed. Walk more slowly, keep the subject in view, and avoid plain walls');
    // settle: each frame is placed again against the frames that share the most with it, on either side,
    // which spreads out small errors and closes the loop when the walk comes back to where it began
    busy('Settling the camera path', 0.88); await tick();
    for (let sweep=0; sweep<2; sweep++){
      for (const i of placed){ if (i===0) continue;
        const refs = nearOf(i, placed, 3, 3).map(j=>[j, matchesOf(i,j).length]).filter(([,c])=>c>=25).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([j])=>j);
        if (!refs.length) continue; const keep = frames[i].ab, r = placeFrame(i, refs, pose[i]); if (r) pose[i]=r.T; else frames[i].ab = keep; }
      await tick(); if (g!==S.gen) return;
    }
  } else {
    // The phone already knows where every view was taken, in metres. What is left is each frame's depth
    // scale: from the phone's depth sensor where it has one, and from matched points seen from two known
    // places (triangulated) everywhere; a robust fit of inverse depth, a*d + b, to both.
    placed = frames.map((_, i)=>i);
    busy('Measuring depth from the views', 0.82); await tick();
    for (const i of placed){ const F=frames[i], ds=[], inv=[];
      for (const [u, v, z] of (o.metric?.[i] || [])){ const D=F.depth, xi=Math.min(D.w-1,(u*D.w)|0), yi=Math.min(D.h-1,(v*D.h)|0), dd=D.d[yi*D.w+xi]; if (dd>0.03 && z>0.05){ ds.push(dd); inv.push(1/z); } }
      const Ci=pose[i].t;
      for (const j of nearOf(i, placed, 3, 2)){ const A=F.feat, B=frames[j].feat, Cj=pose[j].t;
        for (const [a,b] of matchesOf(i,j)){ const ra=xfR(pose[i].R, rayOf(A.xy[a*2], A.xy[a*2+1])), rb=xfR(pose[j].R, rayOf(B.xy[b*2], B.xy[b*2+1]));
          // closest points of the two lines of sight; kept when the views are far enough apart to measure
          const la=Math.hypot(...ra), lb=Math.hypot(...rb), da=ra.map(x=>x/la), db=rb.map(x=>x/lb), wv=[Ci[0]-Cj[0], Ci[1]-Cj[1], Ci[2]-Cj[2]];
          const bb=da[0]*db[0]+da[1]*db[1]+da[2]*db[2], dd1=da[0]*wv[0]+da[1]*wv[1]+da[2]*wv[2], ee=db[0]*wv[0]+db[1]*wv[1]+db[2]*wv[2], den=1-bb*bb;
          if (den < 0.0012) continue;                                                      // under about 2 degrees apart
          const sA=(bb*ee-dd1)/den, sB=(ee-bb*dd1)/den; if (sA<=0.05 || sB<=0.05) continue;
          const PA=[Ci[0]+da[0]*sA, Ci[1]+da[1]*sA, Ci[2]+da[2]*sA], PB=[Cj[0]+db[0]*sB, Cj[1]+db[1]*sB, Cj[2]+db[2]*sB];
          if (Math.hypot(PA[0]-PB[0], PA[1]-PB[1], PA[2]-PB[2]) > 0.01*sA) continue;         // the lines must nearly meet
          const zc=sA/la, dd=depthAtKp(F, A.xy[a*2], A.xy[a*2+1]); if (dd>0.03){ ds.push(dd); inv.push(1/zc); } } }
      const ab = fitInvDepth(ds, inv); if (ab) F.ab = ab;
      dbg.push({i, samples:ds.length, ab:F.ab.map(v=>+v.toFixed(3))});
    }
  }
  // Bundle adjustment: the cameras and every frame's depth scale and offset solved together, so that each
  // matched point, lifted with its own frame's depth, lands where the other frame saw it. Placing frames one
  // at a time leaves small errors that add up along the walk; solving them all at once shares them out and
  // closes the loop. When the phone has tracked the cameras, they stay as they are and only depth is solved;
  // otherwise frame 0 stays put, which fixes where the scene sits and how big it is.
  busy('Settling the camera path: all views together', 0.9); await tick();
  {
    const fi = new Map(placed.map((f,k)=>[f,k])), NF = placed.length;
    const colOf = (k, q) => known ? (q>=6 ? k*2+(q-6) : -1) : (k===0 ? -1 : (k-1)*8+q), NP = known ? 2*NF : 8*(NF-1);
    const st = placed.map(f=>({R:pose[f].R.slice(), t:pose[f].t.slice(), k:frames[f].ab[0]/A0, m:frames[f].ab[1]/B0}));
    const kpRay = (F, px, py) => { const D=F.depth, u=(px+.5)/w, v=(py+.5)/h, xi=Math.min(D.w-2,Math.max(1,(u*D.w)|0)), yi=Math.min(D.h-2,Math.max(1,(v*D.h)|0)), i=yi*D.w+xi, dd=D.d[i];
      if (Math.abs(D.d[i+1]-D.d[i-1]) > 0.06 || Math.abs(D.d[i+D.w]-D.d[i-D.w]) > 0.06 || dd < 0.03) return null;
      return [(2*u-1-ox)*tanX, (1-2*v-oy)*tanY, dd]; };
    const obs = [], pairs = new Set();
    for (const i of placed) for (const j of nearOf(i, placed, 3, 3)){ const key=Math.min(i,j)*4096+Math.max(i,j); if (pairs.has(key)) continue; pairs.add(key);
      const A=frames[i].feat, B=frames[j].feat;
      for (const [a,b] of matchesOf(i,j)){ const ra=kpRay(frames[i], A.xy[a*2], A.xy[a*2+1]), rb=kpRay(frames[j], B.xy[b*2], B.xy[b*2+1]);
        if (ra) obs.push({i:fi.get(i), j:fi.get(j), r:ra, x:B.xy[b*2], y:B.xy[b*2+1]});
        if (rb) obs.push({i:fi.get(j), j:fi.get(i), r:rb, x:A.xy[a*2], y:A.xy[a*2+1]}); } }
    const resid = (o, Ri, ti, ki, mi, Rj, tj) => { const z=1/Math.max(1e-3, ki*A0*o.r[2]+mi*B0), p=[o.r[0]*z, o.r[1]*z, -z], X=xfR(Ri,p), d=[X[0]+ti[0]-tj[0], X[1]+ti[1]-tj[1], X[2]+ti[2]-tj[2]];
      const c=[Rj[0]*d[0]+Rj[3]*d[1]+Rj[6]*d[2], Rj[1]*d[0]+Rj[4]*d[1]+Rj[7]*d[2], Rj[2]*d[0]+Rj[5]*d[1]+Rj[8]*d[2]];
      if (c[2] > -1e-3) return [30,30]; const u=proj(c); return [u[0]-o.x, u[1]-o.y]; };
    const rOf = (o, s) => resid(o, s[o.i].R, s[o.i].t, s[o.i].k, s[o.i].m, s[o.j].R, s[o.j].t);
    const hub = e => e<2 ? e*e : 4*e-4;
    // how strongly each frame's depth keeps the model's own shape (offset in step with scale); with the
    // phone's metric depth or triangulated points already fitted, that fit is the shape to keep
    const PM = window.__vsOpt?.pm ?? 40, m0 = st.map(f=>Math.log(f.m/f.k));
    const costOf = (s, list) => { let c=0; for (const o of list){ const r=rOf(o,s); c+=hub(Math.hypot(r[0],r[1])); } for (let k=0;k<s.length;k++) if (colOf(k,7)>=0){ const l=Math.log(s[k].m/s[k].k)-m0[k]; c+=PM*l*l; } return c; };
    // the matches that hold up under the camera path found so far (wrong matches would pull it apart)
    let use = obs.filter(o=>{ const r=rOf(o,st); return Math.hypot(r[0],r[1]) < 8; });
    const EPS = 1e-5, stepped = (s, d) => s.map((f,k)=>{ const q=[0,1,2,3,4,5,6,7].map(j=>{ const c=colOf(k,j); return c<0 ? 0 : d[c]; });
      return {R:(q[0]||q[1]||q[2]) ? mul3(f.R, rodrigues(q[0],q[1],q[2])) : f.R, t:[f.t[0]+q[3], f.t[1]+q[4], f.t[2]+q[5]], k:f.k*Math.exp(q[6]), m:f.m*Math.exp(q[7])}; });
    let cur = st, c0 = costOf(cur, use), lam = 1e-3;
    const ba0 = {obs:obs.length, used:use.length, rms0:Math.sqrt(c0/Math.max(1,use.length))};
    for (let it=0; it<14 && use.length>=30; it++){
      if (it===7){ use = use.filter(o=>{ const r=rOf(o,cur); return Math.hypot(r[0],r[1]) < 4; }); c0 = costOf(cur, use); }
      // one small nudge per parameter of the two frames a match joins (numerical derivatives)
      const pert = known ? null : cur.map(f=>({Rw:[0,1,2].map(a=>mul3(f.R, rodrigues(a===0?EPS:0, a===1?EPS:0, a===2?EPS:0)))}));
      const H = new Float64Array(NP*NP), gv = new Float64Array(NP), J = new Float64Array(32), col = new Int32Array(16);
      for (const o of use){ const s0=rOf(o,cur), e=Math.hypot(s0[0],s0[1]), wgt = e<2 ? 1 : 2/e; let nc=0;
        for (const [f,side] of [[o.i,0],[o.j,1]]){ const F=cur[f];
          for (let q=0;q<(side===0 ? 8 : 6);q++){ const cc=colOf(f,q); if (cc<0) continue;
            let R=F.R, t=F.t, k=F.k, m=F.m; if (q<3) R=pert[f].Rw[q]; else if (q<6){ t=F.t.slice(); t[q-3]+=EPS; } else if (q===6) k=F.k*Math.exp(EPS); else m=F.m*Math.exp(EPS);
            const r = side===0 ? resid(o, R, t, k, m, cur[o.j].R, cur[o.j].t) : resid(o, cur[o.i].R, cur[o.i].t, cur[o.i].k, cur[o.i].m, R, t);
            J[nc*2]=(r[0]-s0[0])/EPS; J[nc*2+1]=(r[1]-s0[1])/EPS; col[nc]=cc; nc++; } }
        for (let a=0;a<nc;a++){ gv[col[a]] += wgt*(J[a*2]*s0[0]+J[a*2+1]*s0[1]);
          for (let b=0;b<nc;b++) H[col[a]*NP+col[b]] += wgt*(J[a*2]*J[b*2]+J[a*2+1]*J[b*2+1]); } }
      for (let k=0;k<NF;k++){ const a=colOf(k,6), b=colOf(k,7); if (a<0) continue; const l=Math.log(cur[k].m/cur[k].k)-m0[k];
        H[a*NP+a]+=PM; H[b*NP+b]+=PM; H[a*NP+b]-=PM; H[b*NP+a]-=PM; gv[a]-=PM*l; gv[b]+=PM*l; }
      let acc = false, conv = false;
      for (let tries=0; tries<6 && !acc; tries++){
        // Cholesky solve of (H + lam*diag) d = -g
        const M = Float64Array.from(H); for (let a=0;a<NP;a++) M[a*NP+a] = H[a*NP+a]*(1+lam) + 1e-9;
        let bad = false; for (let a=0;a<NP && !bad;a++){ for (let b=0;b<=a;b++){ let s=M[a*NP+b]; for (let k=0;k<b;k++) s-=M[a*NP+k]*M[b*NP+k];
          if (a===b){ if (s<=0){ bad=true; break; } M[a*NP+a]=Math.sqrt(s); } else M[a*NP+b]=s/M[b*NP+b]; } }
        if (bad){ lam*=10; continue; }
        const y = new Float64Array(NP), d = new Float64Array(NP);
        for (let a=0;a<NP;a++){ let s=-gv[a]; for (let k=0;k<a;k++) s-=M[a*NP+k]*y[k]; y[a]=s/M[a*NP+a]; }
        for (let a=NP-1;a>=0;a--){ let s=y[a]; for (let k=a+1;k<NP;k++) s-=M[k*NP+a]*d[k]; d[a]=s/M[a*NP+a]; }
        const nx = stepped(cur, d), c1 = costOf(nx, use);
        if (c1 < c0){ acc = true; conv = (c0-c1) <= 1e-5*c0; cur = nx; c0 = c1; lam = Math.max(1e-7, lam/4); } else lam *= 8; }
      if (!acc || conv) break;
      await tick(); if (g!==S.gen) return;
    }
    placed.forEach((f,k)=>{ pose[f] = {s:1, R:cur[k].R, t:cur[k].t}; frames[f].ab = [cur[k].k*A0, cur[k].m*B0]; });
    S.vscanLog.ba = {...ba0, used:use.length, rms:+Math.sqrt(c0/Math.max(1,use.length)).toFixed(2), rms0:+ba0.rms0.toFixed(2)};
  }
  S.vscanLog.placed = placed.slice(); S.vscanLog.cams = placed.map(i=>({i, c:pose[i].t.map(v=>+v.toFixed(4)), f:xfR(pose[i].R,[0,0,-1]).map(v=>+v.toFixed(3)), k:+(frames[i].ab[0]/A0).toFixed(3), m:+(frames[i].ab[1]/B0).toFixed(3)})); S.vscanLog.trackMs = Math.round(performance.now()-tRead);
  if (dbg.length && dbg[0].of){ let e=0, c=0; for (const d of dbg) { e+=d.inl; c+=d.of; } S.vscanLog.inlierShare = +(e/c).toFixed(3); }

  // ---- fusion
  busy('Building the 3D scene', 0.92); await tick();
  // Each frame's depth in scene units (0 where there is none: too far, or across a depth edge)
  const nbOf = new Map(placed.map(i=>[i, nearOf(i, placed, 3, 3).map(j=>[j, matchesOf(i,j).length]).sort((a,b)=>b[1]-a[1]).slice(0, window.__vsOpt?.nb ?? 6).map(([j])=>j)]));
  for (const i of placed){ const F=frames[i], D=F.depth, z=new Float32Array(D.w*D.h);
    for (let yi=1; yi<D.h-1; yi++) for (let xi=1; xi<D.w-1; xi++){ const k=yi*D.w+xi, dd=D.d[k]; if (dd < 0.03) continue;
      if (Math.abs(D.d[k+1]-D.d[k-1]) > 0.05 || Math.abs(D.d[k+D.w]-D.d[k-D.w]) > 0.05) continue; z[k]=zOfF(F, dd); }
    F.z = z; }
  const camPt = (F, xi, yi, z) => { const D=F.depth, u=(xi+.5)/D.w, v=(yi+.5)/D.h; return [(2*u-1-ox)*tanX*z, (1-2*v-oy)*tanY*z, -z]; };
  const pixIn = (j, p) => { const c=unapplySim(pose[j], p); if (c[2] > -1e-3) return -1; const u=proj(c), Dj=frames[j].depth;
    const xj=Math.round((u[0]+.5)/w*Dj.w-.5), yj=Math.round((u[1]+.5)/h*Dj.h-.5); return (xj<1||yj<1||xj>=Dj.w-1||yj>=Dj.h-1) ? -1 : yj*Dj.w+xj; };
  // Consensus: each pixel's depth becomes the median of what its neighbouring views put on the same line
  // of sight (as in multi-view depth-map fusion). Depth from one photo places a plain object, like a white
  // toy, a little nearer or farther in each view; left alone, that made a copy of it for every view.
  if ((window.__vsOpt?.cons ?? 1) > 0){ busy('Building the 3D scene: agreeing on depth', 0.93); await tick();
    const out = new Map(), cand = new Float32Array(16);
    for (const i of placed){ const F=frames[i], D=F.depth, T=pose[i], z2=F.z.slice(), step = MOBILE ? 2 : 1;
      for (let yi=1; yi<D.h-1; yi+=step) for (let xi=1; xi<D.w-1; xi+=step){ const k=yi*D.w+xi, z=F.z[k]; if (!z) continue;
        const p=applySim(T, camPt(F, xi, yi, z)); let nc=0; cand[nc++]=z;
        for (const j of nbOf.get(i)){ const q=pixIn(j, p); if (q<0) continue; const zj=frames[j].z[q]; if (!zj) continue; const Dj=frames[j].depth;
          const Q=applySim(pose[j], camPt(frames[j], q%Dj.w, (q/Dj.w)|0, zj)), qi=unapplySim(T, Q), zi=-qi[2];
          if (zi > 0 && Math.abs(zi/z-1) < 0.2) cand[nc++]=zi; }
        if (nc>=3){ const a=Array.from(cand.subarray(0,nc)).sort((x,y)=>x-y); z2[k]=a[nc>>1]; } }
      out.set(i, z2); await tick(); if (g!==S.gen) return; }
    for (const i of placed) frames[i].z = out.get(i);
  }
  // Multi-view agreement (as in COLMAP's depth-map fusion): a point is kept only when two other frames that
  // look at the same place find a surface at that depth too. Depth guessed from one photo is wrong in
  // different ways in each frame, and it is these disagreements that doubled edges and made floaters.
  const TOL = window.__vsOpt?.tol ?? 0.05, NEED = window.__vsOpt?.need ?? 2, agreeIn = (p, js) => { let seenBy=0, ok=0;
    for (const j of js){ const q=pixIn(j, p); if (q<0) continue; const zj=frames[j].z[q]; if (!zj) continue; seenBy++;
      const c=unapplySim(pose[j], p); if (Math.abs(zj + c[2]) < TOL*-c[2] && ++ok >= NEED) return 1; }
    return seenBy ? 0 : -1; };
  const zs=[]; { const F=frames[placed[0]]; for (let k=0;k<F.z.length;k+=17) if (F.z[k]) zs.push(F.z[k]); zs.sort((a,b)=>a-b); }
  const vs = (zs[zs.length>>1] || 1.2) * (MOBILE ? 0.006 : 0.0045), vox = new Map();
  // per voxel: position, colour (weighted), normal (summed), how many samples, how many frames
  let cap = 400000, P = new Float32Array(cap*3), C = new Float32Array(cap*3), Wc = new Float32Array(cap), Nn = new Float32Array(cap*3), cnt = new Uint16Array(cap), seen = new Uint16Array(cap), last = new Int32Array(cap).fill(-1), nv = 0;
  const grow = () => { cap*=2; const g2=(A,T)=>{ const B=new T(cap*(A.length/(cap/2))); B.set(A); return B; };
    P=g2(P,Float32Array); C=g2(C,Float32Array); Wc=g2(Wc,Float32Array); Nn=g2(Nn,Float32Array); cnt=g2(cnt,Uint16Array); seen=g2(seen,Uint16Array); const L2=new Int32Array(cap).fill(-1); L2.set(last); last=L2; };
  // Colour comes mostly from the sharpest, nearest views (weight: sharpness over distance squared) rather than
  // an even average of every view, which blurred fine print and edges.
  const sharpMed = frames.map(F=>F.sharp).sort((a,b)=>a-b)[frames.length>>1] || 1;
  let dropped=0;
  for (const i of placed){
    const F=frames[i], D=F.depth, T=pose[i], step = MOBILE ? 2 : 1, nb = nbOf.get(i), sw = Math.min(3, F.sharp/sharpMed);
    for (let yi=1; yi<D.h-1; yi+=step) for (let xi=1; xi<D.w-1; xi+=step){
      const k=yi*D.w+xi, z=F.z[k]; if (!z) continue;
      const ci=k*4; if (F.col[ci]+F.col[ci+1]+F.col[ci+2] < 18) continue;       // empty black (letterboxing, lens edges) is not a surface
      const pc=camPt(F, xi, yi, z), p=applySim(T, pc);
      if (TOL > 0 && agreeIn(p, nb) === 0){ dropped++; continue; }
      const ix=Math.round(p[0]/vs), iy=Math.round(p[1]/vs), iz=Math.round(p[2]/vs); if (Math.abs(ix)>32000||Math.abs(iy)>32000||Math.abs(iz)>32000) continue;
      const key=((ix+32768)*65536 + (iy+32768))*65536 + (iz+32768);
      let j=vox.get(key); if (j===undefined){ if (nv>=cap) grow(); j=nv++; vox.set(key,j); }
      // the surface's facing, from the depth around this pixel, turned to face the camera
      const zr=F.z[k+1], zl=F.z[k-1], zd=F.z[k+D.w], zu=F.z[k-D.w];
      if (zr && zl && zd && zu){ const a=camPt(F, xi+1, yi, zr), b=camPt(F, xi-1, yi, zl), c=camPt(F, xi, yi+1, zd), e=camPt(F, xi, yi-1, zu);
        const dx=[a[0]-b[0], a[1]-b[1], a[2]-b[2]], dy=[c[0]-e[0], c[1]-e[1], c[2]-e[2]];
        let nx=dx[1]*dy[2]-dx[2]*dy[1], ny=dx[2]*dy[0]-dx[0]*dy[2], nz=dx[0]*dy[1]-dx[1]*dy[0]; const l=Math.hypot(nx,ny,nz);
        if (l>0){ if (nx*pc[0]+ny*pc[1]+nz*pc[2] > 0){ nx=-nx; ny=-ny; nz=-nz; } const nw=xfR(T.R, [nx/l, ny/l, nz/l]); Nn[j*3]+=nw[0]; Nn[j*3+1]+=nw[1]; Nn[j*3+2]+=nw[2]; } }
      const wc = sw/(z*z);
      P[j*3]+=p[0]; P[j*3+1]+=p[1]; P[j*3+2]+=p[2]; C[j*3]+=wc*F.col[ci]; C[j*3+1]+=wc*F.col[ci+1]; C[j*3+2]+=wc*F.col[ci+2]; Wc[j]+=wc; cnt[j]++;
      if (last[j]!==i){ last[j]=i; seen[j]++; }
    }
    await tick(); if (g!==S.gen) return;
  }
  const need = 2; let m=0; for (let j=0;j<nv;j++) if (seen[j]>=need) m++;
  { let s3=0; for (let j=0;j<nv;j++) if (seen[j]>=3) s3++; Object.assign(S.vscanLog, {dropped, voxels:nv, seen2:m, seen3:s3, agree:+(m/nv).toFixed(3)}); }
  // Splats: a thin disc lying on the surface where the views agree on its facing, a round one where they do not
  const flat = (window.__vsOpt?.flat ?? 1) > 0, sp = newSplats(m); let q=0, discs=0;
  for (let j=0;j<nv;j++){ if (seen[j]<need) continue; const c=cnt[j];
    sp.pos[q*3]=P[j*3]/c; sp.pos[q*3+1]=P[j*3+1]/c; sp.pos[q*3+2]=P[j*3+2]/c;
    const nl=Math.hypot(Nn[j*3], Nn[j*3+1], Nn[j*3+2]);
    if (flat && nl > 0.7*c){ const nn=[Nn[j*3]/nl, Nn[j*3+1]/nl, Nn[j*3+2]/nl], ax=Math.abs(nn[1])<0.9 ? [0,1,0] : [1,0,0];
      let e1=[ax[1]*nn[2]-ax[2]*nn[1], ax[2]*nn[0]-ax[0]*nn[2], ax[0]*nn[1]-ax[1]*nn[0]]; const l1=Math.hypot(...e1); e1=e1.map(v=>v/l1);
      const e2=[nn[1]*e1[2]-nn[2]*e1[1], nn[2]*e1[0]-nn[0]*e1[2], nn[0]*e1[1]-nn[1]*e1[0]], qt=quatFromAxes(e1, e2, nn);
      sp.scl[q*3]=sp.scl[q*3+1]=vs*0.78; sp.scl[q*3+2]=vs*0.14; sp.rot.set(qt, q*4); discs++; }
    else { sp.scl[q*3]=sp.scl[q*3+1]=sp.scl[q*3+2]=vs*0.62; sp.rot[q*4]=1; }
    const wc=Wc[j]||1; sp.rgba[q*4]=C[j*3]/wc; sp.rgba[q*4+1]=C[j*3+1]/wc; sp.rgba[q*4+2]=C[j*3+2]/wc; sp.rgba[q*4+3]=240; q++; }
  S.vscanLog.discs = discs;
  if (window.__vsKeep){ const qq=[]; for (let k=0;k<sp.n;k+=25) qq.push([sp.pos[k*3],sp.pos[k*3+1],sp.pos[k*3+2],sp.rgba[k*4],sp.rgba[k*4+1],sp.rgba[k*4+2]]); S.vscanLog.cloud=qq; }
  const pts = pointsFromSplats(sp);
  const scene = {n:pts.n, pos:pts.pos, col:pts.col, upHint:'y', hasColour:true, splats:sp,
    message:`Scanned from ${o.from}: ${known ? `${n} views` : `followed ${placed.length} of ${n} frames`}, ${sp.n.toLocaleString()} splats.${lost ? ' Some frames were skipped where the camera could not be followed.' : ''}${o.note||''}`};
  await finishScan(scene, o.name, g, `Scanned from ${o.from} on this device: ${placed.length} of ${n} ${known ? 'views' : 'frames'}, ${sp.n.toLocaleString()} splats. It stayed on this device.`);
  if (!LOOKS[look].splat){ applyLook('real'); }
}
$('#fileVideo').addEventListener('change', async e=>{
  const f = e.target.files[0]; if (!f) return; e.target.value='';
  try { await scanFromVideo(f); } catch(err){ console.error(err); busy(null); notice('Could not scan that video: '+(err.message||err)+'.'); }
});
