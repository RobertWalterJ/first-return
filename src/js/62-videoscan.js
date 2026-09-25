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

// ---- the whole scan
async function scanFromVideo(file){
  const g = ++S.gen, url = URL.createObjectURL(file), vid = document.createElement('video');
  vid.muted = true; vid.playsInline = true; vid.preload = 'auto'; vid.src = url;
  busy('Opening the video', null);
  try {
    await new Promise((res, rej)=>{ vid.onloadeddata = res; vid.onerror = () => rej(new Error('this video could not be read')); setTimeout(()=>rej(new Error('this video took too long to open')), 20000); });
    if (!isFinite(vid.duration)){ vid.currentTime = 1e7; await new Promise(res=>{ vid.ondurationchange = res; vid.onseeked = res; setTimeout(res, 3000); }); vid.currentTime = 0; }
    if (!(vid.duration > 1)) throw new Error('this video is too short to scan from');
    // frames about 0.4 s apart; a long video is cut to what that many frames can cover, and says so
    const budget = MOBILE ? 36 : 44, dur = Math.min(vid.duration, budget/2.5), n = Math.max(6, Math.min(budget, Math.round(dur*2.5))), trimmed = vid.duration > dur + 0.5;
    // seek, then wait for that frame to be ready to draw; some phones never report the seek, so give up after a while
    const seekTo = t => new Promise(res=>{ let done=false; const fin=()=>{ if (!done){ done=true; res(); } };
      vid.onseeked = () => { if (vid.requestVideoFrameCallback) { vid.requestVideoFrameCallback(()=>fin()); setTimeout(fin, 400); } else fin(); };
      setTimeout(fin, 4000); vid.currentTime = t; });
    const LONG = 640, sc = Math.min(1, LONG/Math.max(vid.videoWidth, vid.videoHeight)), w = Math.round(vid.videoWidth*sc), h = Math.round(vid.videoHeight*sc);
    const tanX = w>=h ? 0.62 : 0.62*w/h, tanY = w>=h ? 0.62*h/w : 0.62, SH = 0.35;       // a phone camera's usual view; a middling depth range
    const frames = []; let lo=null, hi=null;
    for (let i=0;i<n;i++){
      busy(`Reading frame ${i+1} of ${n}: depth and features`, i/n*0.8);
      await seekTo(Math.min(dur-0.05, 0.1 + i*(dur-0.2)/(n-1)));
      if (g!==S.gen) return;
      const c = document.createElement('canvas'); c.width=w; c.height=h; const x=c.getContext('2d', {willReadFrequently:true}); x.drawImage(vid, 0, 0, w, h);
      const data = x.getImageData(0,0,w,h).data, raw = await estimateDepth(c, null, true); if (g!==S.gen) return;
      const srt = Float32Array.from(raw.d).sort(), l0 = srt[Math.floor(srt.length*0.005)], h0 = srt[Math.min(srt.length-1, Math.floor(srt.length*0.9995))];
      lo = lo==null ? l0 : lo*0.7+l0*0.3; hi = hi==null ? h0 : hi*0.7+h0*0.3;
      const d = new Float32Array(raw.d.length); for (let k=0;k<d.length;k++) d[k] = Math.min(1, Math.max(0, (raw.d[k]-lo)/(hi-lo||1)));
      frames.push({data, depth:{w:raw.w, h:raw.h, d}, feat:features(data, w, h)});
    }
    // a point in a frame's camera, from a pixel and the depth there (null across a depth edge)
    // Each frame's depth is a*d + b in inverse depth. It starts from a fixed guess and, once the frame is
    // placed, is refitted to the points the scene already agrees on; relative depth bends differently in
    // every frame, and a shared guess left the same wall at a different depth in each, doubling it.
    const A0 = 1/(1.2*(1+SH)), B0 = SH*A0; frames.forEach(F=>{ F.ab=[A0,B0]; });
    const zOfD = dd => 1/(A0*dd+B0), zOfF = (F, dd) => 1/Math.max(1e-3, F.ab[0]*dd+F.ab[1]);
    const lift = (F, px, py) => { const D=F.depth, u=(px+.5)/w, v=(py+.5)/h, xi=Math.min(D.w-2,Math.max(1,(u*D.w)|0)), yi=Math.min(D.h-2,Math.max(1,(v*D.h)|0)), i=yi*D.w+xi, dd=D.d[i];
      if (Math.abs(D.d[i+1]-D.d[i-1]) > 0.06 || Math.abs(D.d[i+D.w]-D.d[i-D.w]) > 0.06 || dd < 0.03) return null;
      const z=zOfF(F, dd); return [(2*u-1)*tanX*z, (1-2*v)*tanY*z, -z]; };
    // the camera's path: each frame placed relative to the last one that was placed
    const proj = p => [((p[0]/-p[2])/tanX+1)/2*w - .5, (1-(p[1]/-p[2])/tanY)/2*h - .5];
    const depthAtKp = (F, px, py) => { const D=F.depth, xi=Math.min(D.w-1,((px+.5)/w*D.w)|0), yi=Math.min(D.h-1,((py+.5)/h*D.h)|0); return D.d[yi*D.w+xi]; };
    const placeAgainst = (i, ref) => { const Fi=frames[i], A=Fi.feat, B=frames[ref].feat, m=matchFeatures(A,B), P=[], Q=[], Q2=[], K=[];
      const build = () => { P.length=0; Q.length=0; Q2.length=0; K.length=0;
        for (const [a,b] of m){ const p=lift(Fi, A.xy[a*2], A.xy[a*2+1]), q=lift(frames[ref], B.xy[b*2], B.xy[b*2+1]); if (p && q){ P.push(p); Q.push(q); Q2.push(B.xy[b*2], B.xy[b*2+1]); K.push(a); } } };
      build(); let r = ransacSim(P, Q, Q2, proj); if (!r) return null;
      // refit this frame's depth to where the reference says its matched points are, then place it again
      const ds=[], inv=[]; for (const k of r.idx){ const pt=unapplySim(r.T, Q[k]); if (pt[2] < -1e-3){ ds.push(depthAtKp(Fi, A.xy[K[k]*2], A.xy[K[k]*2+1])); inv.push(1/-pt[2]); } }
      const ab = fitInvDepth(ds, inv);
      if (ab){ const keep=Fi.ab; Fi.ab=ab; build(); const r2 = ransacSim(P, Q, Q2, proj); if (r2 && r2.idx.length >= r.idx.length*0.8) r = r2; else { Fi.ab=keep; } }
      return composeSim(pose[ref], r.T); };
    busy('Following the camera', 0.82); await tick();
    const pose = [ {s:1, R:[1,0,0,0,1,0,0,0,1], t:[0,0,0]} ]; let placed = [0], lost = 0;
    for (let i=1;i<n;i++){
      let got = null;
      for (const ref of placed.slice(-3).reverse()){
        got = placeAgainst(i, ref); if (got) break;
      }
      pose[i] = got; if (got) placed.push(i); else lost++;
      if (i%4===0){ busy(`Following the camera: frame ${i+1} of ${n}`, 0.82+0.08*i/n); await tick(); if (g!==S.gen) return; }
    }
    // frames that were lost get a second chance against the nearest placed frames on either side
    for (let i=1;i<n;i++){ if (pose[i]) continue;
      const near = placed.slice().sort((a,b)=>Math.abs(a-i)-Math.abs(b-i)).slice(0,4);
      for (const ref of near){ const got=placeAgainst(i, ref); if (got){ pose[i]=got; placed.push(i); lost--; break; } } }
    placed.sort((a,b)=>a-b);
    if (placed.length < 3) throw new Error('the camera could not be followed. Walk more slowly, keep the subject in view, and avoid plain walls');
    // fuse every placed frame into one voxel grid
    busy('Building the 3D scene', 0.92); await tick();
    const z0=[]; { const D=frames[0].depth; for (let i=0;i<D.d.length;i+=37) if (D.d[i]>0.03) z0.push(zOfD(D.d[i])); z0.sort((a,b)=>a-b); }
    const vs = (z0[z0.length>>1] || 2) * (MOBILE ? 0.006 : 0.0045), vox = new Map();
    let cap = 400000, P = new Float32Array(cap*3), C = new Float32Array(cap*3), cnt = new Uint16Array(cap), seen = new Uint16Array(cap), last = new Int32Array(cap).fill(-1), nv = 0;
    const grow = () => { cap*=2; const g2=(A,T)=>{ const B=new T(cap*(A.length/(cap/2))); B.set(A); return B; }; P=g2(P,Float32Array); C=g2(C,Float32Array); cnt=g2(cnt,Uint16Array); seen=g2(seen,Uint16Array); const L2=new Int32Array(cap).fill(-1); L2.set(last); last=L2; };
    for (const i of placed){
      const F=frames[i], D=F.depth, T=pose[i], step = MOBILE ? 2 : 1;
      for (let yi=1; yi<D.h-1; yi+=step) for (let xi=1; xi<D.w-1; xi+=step){
        const k=yi*D.w+xi, dd=D.d[k]; if (dd < 0.03) continue;
        if (Math.abs(D.d[k+1]-D.d[k-1]) > 0.05 || Math.abs(D.d[k+D.w]-D.d[k-D.w]) > 0.05) continue;       // across a depth edge
        const u=(xi+.5)/D.w, v=(yi+.5)/D.h, z=zOfF(F, dd), p=applySim(T, [(2*u-1)*tanX*z, (1-2*v)*tanY*z, -z]);
        const ix=Math.round(p[0]/vs), iy=Math.round(p[1]/vs), iz=Math.round(p[2]/vs); if (Math.abs(ix)>32000||Math.abs(iy)>32000||Math.abs(iz)>32000) continue;
        const ci=(Math.min(h-1,(v*h)|0)*w + Math.min(w-1,(u*w)|0))*4;
        if (F.data[ci]+F.data[ci+1]+F.data[ci+2] < 18) continue;                 // empty black (letterboxing, lens edges) is not a surface
        const key=((ix+32768)*65536 + (iy+32768))*65536 + (iz+32768);
        let j=vox.get(key); if (j===undefined){ if (nv>=cap) grow(); j=nv++; vox.set(key,j); }
        P[j*3]+=p[0]; P[j*3+1]+=p[1]; P[j*3+2]+=p[2]; C[j*3]+=F.data[ci]; C[j*3+1]+=F.data[ci+1]; C[j*3+2]+=F.data[ci+2]; cnt[j]++;
        if (last[j]!==i){ last[j]=i; seen[j]++; }
      }
      await tick(); if (g!==S.gen) return;
    }
    const need = 2; let m=0; for (let j=0;j<nv;j++) if (seen[j]>=need) m++;
    const sp = newSplats(m); let o=0;
    for (let j=0;j<nv;j++){ if (seen[j]<need) continue; const c=cnt[j];
      sp.pos[o*3]=P[j*3]/c; sp.pos[o*3+1]=P[j*3+1]/c; sp.pos[o*3+2]=P[j*3+2]/c;
      sp.scl[o*3]=sp.scl[o*3+1]=sp.scl[o*3+2]=vs*0.62; sp.rot[o*4]=1;
      sp.rgba[o*4]=C[j*3]/c; sp.rgba[o*4+1]=C[j*3+1]/c; sp.rgba[o*4+2]=C[j*3+2]/c; sp.rgba[o*4+3]=240; o++; }
    const pts = pointsFromSplats(sp);
    const scene = {n:pts.n, pos:pts.pos, col:pts.col, upHint:'y', hasColour:true, splats:sp,
      message:`Scanned from the video: followed ${placed.length} of ${n} frames, ${sp.n.toLocaleString()} splats.${lost ? ' Some frames were skipped where the camera could not be followed.' : ''}${trimmed ? ` Only the first ${Math.round(dur)} seconds were used.` : ''}`};
    await finishScan(scene, file.name, g, `Scanned from a video on this device: ${placed.length} of ${n} frames, ${sp.n.toLocaleString()} splats. It stayed on this device.`);
    if (!LOOKS[look].splat){ applyLook('real'); }
  } finally { vid.removeAttribute('src'); vid.load(); URL.revokeObjectURL(url); }
}
$('#fileVideo').addEventListener('change', async e=>{
  const f = e.target.files[0]; if (!f) return; e.target.value='';
  try { await scanFromVideo(f); } catch(err){ console.error(err); busy(null); notice('Could not scan that video: '+(err.message||err)+'.'); }
});
