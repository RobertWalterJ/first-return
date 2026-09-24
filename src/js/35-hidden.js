// ---------------------------------------------------------------- hidden parts
// One photo only sees the front of things. Turning the view shows what was hidden: the background
// behind a person, and the person's own back. Two cheap reconstructions fill those in:
//  - Behind: the background under the subject is filled by continuing the surrounding background
//    inward (push-pull interpolation, the idea behind layered-depth "3D photo" inpainting), in both
//    depth and colour.
//  - Backs: each subject gets a rounded back surface, as thick at each row as it is wide there.
// Both fade in only as the view turns away from the photo, so the straight-on picture is unchanged.

// Fill unknown pixels from known ones: average down a pyramid, then blend back up.
function pushPull(vals, ch, known, w, h){
  const levels = [{w, h, v:Float32Array.from(vals), wt:new Float32Array(w*h)}];
  { const L=levels[0]; for (let i=0;i<w*h;i++){ const k=known[i]?1:0; L.wt[i]=k; for (let c=0;c<ch;c++) L.v[i*ch+c]*=k; } }
  while (levels[levels.length-1].w>1 || levels[levels.length-1].h>1){
    const A=levels[levels.length-1], w2=Math.max(1,Math.ceil(A.w/2)), h2=Math.max(1,Math.ceil(A.h/2));
    const B={w:w2, h:h2, v:new Float32Array(w2*h2*ch), wt:new Float32Array(w2*h2)};
    for (let y=0;y<A.h;y++) for (let x=0;x<A.w;x++){ const i=y*A.w+x, j=(y>>1)*w2+(x>>1); B.wt[j]+=A.wt[i]; for (let c=0;c<ch;c++) B.v[j*ch+c]+=A.v[i*ch+c]; }
    levels.push(B);
  }
  // top down: each level becomes "known where it had weight, parent's value elsewhere"
  const top=levels[levels.length-1]; for (let i=0;i<top.w*top.h;i++){ const wt=Math.max(top.wt[i],1e-6); for (let c=0;c<ch;c++) top.v[i*ch+c]/=wt; top.wt[i]=1; }
  for (let l=levels.length-2;l>=0;l--){
    const A=levels[l], B=levels[l+1];
    for (let y=0;y<A.h;y++) for (let x=0;x<A.w;x++){
      const i=y*A.w+x, a=Math.min(1, A.wt[i]);
      // bilinear read of the coarser level, so fills are smooth rather than blocky
      const fx=Math.min(B.w-1, Math.max(0,(x+.5)/2-.5)), fy=Math.min(B.h-1, Math.max(0,(y+.5)/2-.5)), x0=fx|0, y0=fy|0, x1=Math.min(B.w-1,x0+1), y1=Math.min(B.h-1,y0+1), ax=fx-x0, ay=fy-y0;
      for (let c=0;c<ch;c++){
        const p=(B.v[(y0*B.w+x0)*ch+c]*(1-ax)+B.v[(y0*B.w+x1)*ch+c]*ax)*(1-ay)+(B.v[(y1*B.w+x0)*ch+c]*(1-ax)+B.v[(y1*B.w+x1)*ch+c]*ax)*ay;
        const own = A.wt[i]>0 ? A.v[i*ch+c]/A.wt[i] : 0;
        A.v[i*ch+c] = own*a + p*(1-a); }
      A.wt[i]=1;
    }
  }
  return levels[0].v;
}

// Background depth and colour behind the subject, cached per depth map and subject.
function hiddenFill(map){
  const key = S.depthVer+'|'+(S.compCache ? S.compCache.key : '');
  if (S.fillCache && S.fillCache.key===key) return S.fillCache;
  const D=S.depth, W=D.w, H=D.h, n=W*H;
  // the hidden region is the subject, grown a little so its soft edge does not leak into the fill
  const region=new Uint8Array(n); for (let i=0;i<n;i++) if (map[i]>=0) region[i]=1;
  const r=Math.max(2, Math.round(W*0.006));
  for (let pass=0;pass<r;pass++){ const nx=region.slice(); for (let y=1;y<H-1;y++) for (let x=1;x<W-1;x++){ const i=y*W+x; if (!region[i] && (region[i-1]||region[i+1]||region[i-W]||region[i+W])) nx[i]=1; } region.set(nx); }
  // colour at depth resolution
  const c=document.createElement('canvas'); c.width=S.photo.w; c.height=S.photo.h; c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(S.photo.data),S.photo.w,S.photo.h),0,0);
  const c2=document.createElement('canvas'); c2.width=W; c2.height=H; const x2=c2.getContext('2d',{willReadFrequently:true}); x2.drawImage(c,0,0,W,H);
  const px=x2.getImageData(0,0,W,H).data;
  const vals=new Float32Array(n*4), known=new Uint8Array(n);
  for (let i=0;i<n;i++){ vals[i*4]=D.d[i]; vals[i*4+1]=px[i*4]/255; vals[i*4+2]=px[i*4+1]/255; vals[i*4+3]=px[i*4+2]/255; known[i]=region[i]?0:1; }
  const f = pushPull(vals, 4, known, W, H);
  // extents of each subject along every row, for the rounded backs
  const nComp = map.reduce((m,v)=>Math.max(m,v+1),0), lo=new Int32Array(nComp*H).fill(1e9), hi=new Int32Array(nComp*H).fill(-1);
  for (let y=0;y<H;y++) for (let x=0;x<W;x++){ const k=map[y*W+x]; if (k<0) continue; const j=k*H+y; if (x<lo[j]) lo[j]=x; if (x>hi[j]) hi[j]=x; }
  return S.fillCache = {key, region, f, lo, hi, W, H};
}
