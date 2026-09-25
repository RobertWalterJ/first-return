// ---------------------------------------------------------------- Gaussian splats
// A splat is a small soft ellipsoid: a centre, three sizes, a rotation, a colour and an opacity. Scans
// from Scaniverse, Polycam, Luma, Brush or any 3DGS trainer are splats. Every photo is also turned
// into one (a splat per depth pixel, lying flat on the surface it came from) for the Photoreal look.
// Held as {n, pos (xyz), scl (sizes, linear), rot (w x y z), rgba (bytes, sRGB), flag (1 = hidden part)}.
const SH_C0 = 0.28209479;
// rotation (w, x, y, z) whose columns are the frame (e1, e2, n): a splat's two wide axes and its thin one
function quatFromAxes(e1, e2, n){
  const m00=e1[0],m10=e1[1],m20=e1[2],m01=e2[0],m11=e2[1],m21=e2[2],m02=n[0],m12=n[1],m22=n[2], tr=m00+m11+m22; let w,x,y,z;
  if (tr>0){ const s=Math.sqrt(tr+1)*2; w=s/4; x=(m21-m12)/s; y=(m02-m20)/s; z=(m10-m01)/s; }
  else if (m00>m11 && m00>m22){ const s=Math.sqrt(1+m00-m11-m22)*2; w=(m21-m12)/s; x=s/4; y=(m01+m10)/s; z=(m02+m20)/s; }
  else if (m11>m22){ const s=Math.sqrt(1+m11-m00-m22)*2; w=(m02-m20)/s; x=(m01+m10)/s; y=s/4; z=(m12+m21)/s; }
  else { const s=Math.sqrt(1+m22-m00-m11)*2; w=(m10-m01)/s; x=(m02+m20)/s; y=(m12+m21)/s; z=s/4; }
  return [w, x, y, z];
}
function newSplats(n){ return {n, pos:new Float32Array(n*3), scl:new Float32Array(n*3), rot:new Float32Array(n*4), rgba:new Uint8Array(n*4), flag:new Uint8Array(n)}; }
function trimSplats(s, m){ return {n:m, pos:s.pos.slice(0,m*3), scl:s.scl.slice(0,m*3), rot:s.rot.slice(0,m*4), rgba:s.rgba.slice(0,m*4), flag:s.flag.slice(0,m)}; }
const clamp255 = v => v<0 ? 0 : v>255 ? 255 : v;
// a point cloud for the dot looks, from the splats that are solid enough to have been "hit"
function pointsFromSplats(sp){
  const pos=new Float32Array(sp.n*3), col=new Float32Array(sp.n*3); let m=0;
  for (let i=0;i<sp.n;i++){ if (sp.rgba[i*4+3] < 38) continue;
    pos.set(sp.pos.subarray(i*3,i*3+3), m*3); col[m*3]=sp.rgba[i*4]/255; col[m*3+1]=sp.rgba[i*4+1]/255; col[m*3+2]=sp.rgba[i*4+2]/255; m++; }
  return {pos:pos.subarray(0,m*3), col:col.subarray(0,m*3), n:m};
}

// .splat (antimatter15 layout, 32 bytes each): position 3 floats, sizes 3 floats, rgba bytes, rotation bytes (w x y z)
function parseSplatFile(buf){
  const n = Math.floor(buf.byteLength/32); if (n < 1) throw new Error('this .splat file is empty');
  const step = Math.max(1, Math.ceil(n/(MOBILE ? 1.5e6 : 4e6))), f = new Float32Array(buf, 0, n*8), u = new Uint8Array(buf);
  const sp = newSplats(Math.ceil(n/step)); let m=0;
  for (let i=0;i<n;i+=step){ const o=i*8, b=i*32;
    if (!isFinite(f[o]) || !isFinite(f[o+1]) || !isFinite(f[o+2])) continue;
    sp.pos[m*3]=f[o]; sp.pos[m*3+1]=f[o+1]; sp.pos[m*3+2]=f[o+2];
    sp.scl[m*3]=f[o+3]; sp.scl[m*3+1]=f[o+4]; sp.scl[m*3+2]=f[o+5];
    sp.rgba.set(u.subarray(b+24,b+28), m*4);
    for (let k=0;k<4;k++) sp.rot[m*4+k]=(u[b+28+k]-128)/128;
    m++; }
  return trimSplats(sp, m);
}

// .spz (Niantic, versions 1 to 3: gzip, a 16-byte header, then positions, alphas, colours, sizes, rotations).
// Stored right, up, back, which is this app's own frame.
async function parseSpz(buf){
  let raw;
  try { raw = new Uint8Array(await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()); }
  catch(e){ throw new Error('this .spz is a newer kind (version 4) that browsers cannot unpack yet. Export it as .ply instead'); }
  const dv = new DataView(raw.buffer);
  if (dv.getUint32(0,true)!==0x5053474e) throw new Error('this does not look like an .spz file');
  const ver = dv.getUint32(4,true), n = dv.getUint32(8,true), shDeg = raw[12], fb = raw[13];
  if (ver<1 || ver>3) throw new Error('unsupported .spz version '+ver);
  const H=16, posB = ver===1 ? 6 : 9, rotB = ver>=3 ? 4 : 3;
  const oPos=H, oA=oPos+n*posB, oC=oA+n, oS=oC+n*3, oR=oS+n*3;
  if (oR + n*rotB > raw.length) throw new Error('this .spz file is cut short');
  const sp = newSplats(n), scale = 1/(1<<fb), colScale = 0.15, halfF = new Float32Array(1), halfU = new Uint32Array(halfF.buffer);
  const fromHalf = h => { const s=(h&0x8000)<<16, e=(h>>10)&31, m=h&1023; if (!e) return (s?-1:1)*m*5.960464477539063e-8;
    if (e===31) return s?-Infinity:Infinity; halfU[0]= s | ((e-15+127)<<23) | (m<<13); return halfF[0]; };
  for (let i=0;i<n;i++){
    for (let k=0;k<3;k++){
      if (ver===1) sp.pos[i*3+k] = fromHalf(raw[oPos+i*6+k*2] | raw[oPos+i*6+k*2+1]<<8);
      else { const o=oPos+i*9+k*3; let v = raw[o] | raw[o+1]<<8 | raw[o+2]<<16; if (v & 0x800000) v |= 0xff000000; sp.pos[i*3+k] = v*scale; }
      sp.scl[i*3+k] = Math.exp(raw[oS+i*3+k]/16 - 10);
      sp.rgba[i*4+k] = clamp255(Math.round((0.5 + SH_C0*((raw[oC+i*3+k]/255 - 0.5)/colScale))*255));
    }
    sp.rgba[i*4+3] = raw[oA+i];
    let x,y,z,w;
    if (rotB===3){ x=raw[oR+i*3]/127.5-1; y=raw[oR+i*3+1]/127.5-1; z=raw[oR+i*3+2]/127.5-1; w=Math.sqrt(Math.max(0,1-x*x-y*y-z*z)); }
    else { let c = (raw[oR+i*4] | raw[oR+i*4+1]<<8 | raw[oR+i*4+2]<<16 | raw[oR+i*4+3]<<24)>>>0; const big = c>>>30, q=[0,0,0,0]; let ss=0;
      for (let k=3;k>=0;k--){ if (k===big) continue; const mag=c&511, neg=(c>>>9)&1; c>>>=10; q[k]=Math.SQRT1_2*mag/511*(neg?-1:1); ss+=q[k]*q[k]; }
      q[big]=Math.sqrt(Math.max(0,1-ss)); [x,y,z,w]=q; }
    sp.rot[i*4]=w; sp.rot[i*4+1]=x; sp.rot[i*4+2]=y; sp.rot[i*4+3]=z;
  }
  return sp;
}

// Level a splat scan with the same turn and shift as its points (levelScan), rotations included.
function levelSplats(sp, Rm, shift){
  // quaternion of the levelling turn
  const tr=Rm[0]+Rm[4]+Rm[8]; let qw,qx,qy,qz;
  if (tr>0){ const s=Math.sqrt(tr+1)*2; qw=s/4; qx=(Rm[7]-Rm[5])/s; qy=(Rm[2]-Rm[6])/s; qz=(Rm[3]-Rm[1])/s; }
  else if (Rm[0]>Rm[4] && Rm[0]>Rm[8]){ const s=Math.sqrt(1+Rm[0]-Rm[4]-Rm[8])*2; qw=(Rm[7]-Rm[5])/s; qx=s/4; qy=(Rm[1]+Rm[3])/s; qz=(Rm[2]+Rm[6])/s; }
  else if (Rm[4]>Rm[8]){ const s=Math.sqrt(1+Rm[4]-Rm[0]-Rm[8])*2; qw=(Rm[2]-Rm[6])/s; qx=(Rm[1]+Rm[3])/s; qy=s/4; qz=(Rm[5]+Rm[7])/s; }
  else { const s=Math.sqrt(1+Rm[8]-Rm[0]-Rm[4])*2; qw=(Rm[3]-Rm[1])/s; qx=(Rm[2]+Rm[6])/s; qy=(Rm[5]+Rm[7])/s; qz=s/4; }
  for (let i=0;i<sp.n;i++){ const x=sp.pos[i*3],y=sp.pos[i*3+1],z=sp.pos[i*3+2];
    sp.pos[i*3]=Rm[0]*x+Rm[1]*y+Rm[2]*z-shift[0]; sp.pos[i*3+1]=Rm[3]*x+Rm[4]*y+Rm[5]*z-shift[1]; sp.pos[i*3+2]=Rm[6]*x+Rm[7]*y+Rm[8]*z-shift[2];
    const w=sp.rot[i*4], a=sp.rot[i*4+1], b=sp.rot[i*4+2], c=sp.rot[i*4+3];
    sp.rot[i*4]=qw*w-qx*a-qy*b-qz*c; sp.rot[i*4+1]=qw*a+qx*w+qy*c-qz*b; sp.rot[i*4+2]=qw*b-qx*c+qy*w+qz*a; sp.rot[i*4+3]=qw*c+qx*b-qy*a+qz*w; }
}

// ---------------------------------------------------------------- one photo as splats
// One splat per depth pixel (every other one on a phone), lying flat on the surface it came from, as wide
// as the gap to its neighbours so they join into a continuous skin. Across a depth cliff the splat faces
// the camera instead of stretching into a sheet. Behind the subject, the filled-in background (hidden
// parts) gets splats of its own, which only show once the view turns. Built from the anonymised photo
// when faces are hidden.
function photoSplatKey(){ return [S.depthVer, S.skyR.toFixed(3), SHIFT.toFixed(5), S.tanV.toFixed(5), S.compCache ? S.compCache.key : '', val('hidden')>=0.5].join('|'); }
function photoSplats(){
  const D=S.depth, Ph=S.photo, W=D.w, H=D.h, cap = MOBILE ? 380000 : 1000000;
  const step = W*H > cap ? Math.ceil(Math.sqrt(W*H/cap)) : 1, gw=Math.ceil(W/step), gh=Math.ceil(H/step);
  // colour averaged over each splat's patch of the photo
  const c1=document.createElement('canvas'); c1.width=Ph.w; c1.height=Ph.h; c1.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(Ph.data), Ph.w, Ph.h), 0, 0);
  const c2=document.createElement('canvas'); c2.width=gw; c2.height=gh; const x2=c2.getContext('2d',{willReadFrequently:true}); x2.imageSmoothingQuality='high'; x2.drawImage(c1,0,0,gw,gh);
  const px=x2.getImageData(0,0,gw,gh).data;
  const map=S.compMap, fill = val('hidden')>=0.5 && map && map.some(v=>v>=0) ? hiddenFill(map) : null;
  const sp = newSplats(gw*gh*2 + Math.ceil((gw*1.8)*(gh+gw*0.4)/9)); let m=0;
  const Z = new Float32Array(W*H); for (let i=0;i<W*H;i++) Z[i]=zOf(D.d[i]);
  if (S.sky && S.skyR) for (let i=0;i<W*H;i++) if (S.sky[i]) Z[i]=skyZ(((i%W)+.5)/W, (((i/W)|0)+.5)/H);
  const P = (x,y) => unproject((x+.5)/W, (y+.5)/H, Z[y*W+x]);
  const K = 0.62, foot0 = 2*S.tanV/H*step;          // splat spread relative to spacing; footprint per unit depth
  const put = (p, e1, e2, n, s1, s2, s3, r, g, b, a, flag) => {
    const o=m*3; sp.pos[o]=p[0]; sp.pos[o+1]=p[1]; sp.pos[o+2]=p[2]; sp.scl[o]=s1; sp.scl[o+1]=s2; sp.scl[o+2]=s3;
    sp.rot.set(quatFromAxes(e1, e2, n), m*4);
    sp.rgba[m*4]=r; sp.rgba[m*4+1]=g; sp.rgba[m*4+2]=b; sp.rgba[m*4+3]=a; sp.flag[m]=flag; m++; };
  const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]], len=a=>Math.hypot(a[0],a[1],a[2]), nrm=a=>{ const l=len(a)||1; return [a[0]/l,a[1]/l,a[2]/l]; },
        cross=(a,b)=>[a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]], dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
  const facing = (p, z, r, g, b, a, flag, grow) => { const f=foot0*z*K*grow; put(p,[1,0,0],[0,1,0],[0,0,1],f,f,f*0.15,r,g,b,a,flag); };
  for (let gy=0; gy<gh; gy++) for (let gx=0; gx<gw; gx++){
    const x=Math.min(W-1,gx*step), y=Math.min(H-1,gy*step), i=y*W+x, z=Z[i], p=P(x,y);
    const ci=(gy*gw+gx)*4, r=px[ci], g=px[ci+1], b=px[ci+2], sf = map && map[i]>=0 ? 2 : 0;
    // one-sided differences, taking the side that stays on the same surface
    const xr=Math.min(W-1,x+step), xl=Math.max(0,x-step), yd=Math.min(H-1,y+step), yu=Math.max(0,y-step);
    const zr=Math.abs(Z[y*W+xr]-z), zl=Math.abs(z-Z[y*W+xl]), zd=Math.abs(Z[yd*W+x]-z), zu=Math.abs(z-Z[yu*W+x]);
    const tx = zr<=zl ? sub(P(xr,y),p) : sub(p,P(xl,y)), ty = zd<=zu ? sub(P(x,yd),p) : sub(p,P(x,yu));
    const cliff = Math.min(zr,zl) > 0.05*z || Math.min(zd,zu) > 0.05*z || (xr===x && xl===x);
    if (cliff){
      // A depth map blends a near edge into what lies behind over a few pixels, and splats left at those
      // in-between depths float in mid-air as stripes once the view turns. Snap each one to the nearer
      // or the farther surface around it, whichever it is closer to.
      let zmin=z, zmax=z;
      for (let k=1;k<=3;k++){ for (const [xx,yy] of [[x+k*step,y],[x-k*step,y],[x,y+k*step],[x,y-k*step]]){
        if (xx<0||yy<0||xx>=W||yy>=H) continue; const zz=Z[yy*W+xx]; if (zz<zmin) zmin=zz; if (zz>zmax) zmax=zz; } }
      const zs = z-zmin < zmax-z ? zmin : zmax;
      facing(unproject((x+.5)/W,(y+.5)/H,zs), zs, r, g, b, 255, sf, 1); continue;
    }
    const e1=nrm(tx), n=nrm(cross(tx,ty)), e2=cross(n,e1), lx=len(tx), ly=Math.max(Math.abs(dot(ty,e2)), 0.35*len(ty));
    // very steep surfaces (seen nearly edge on) are capped, so a smeared edge does not become a curtain
    const cap2 = foot0*z*6;
    // some thickness, so a surface seen nearly edge on still closes up instead of showing gaps
    put(p, e1, e2, n, Math.min(lx,cap2)*K, Math.min(ly,cap2)*K, Math.min(lx,ly)*0.3, r, g, b, 255, sf);
  }
  // Behind every other depth edge too (not only picked subjects): the far surface is grown a short way in
  // under the near one, one ring at a time from the pixels just across the edge, so turning the view shows
  // background there instead of a black tear. The idea of layered-depth 3D photos, done cheaply.
  if (val('hidden')>=0.5){
    const n=gw*gh, Zg=new Float32Array(n), fz=new Float32Array(n), fc=new Float32Array(n*3), st=new Uint8Array(n);
    for (let gy=0; gy<gh; gy++) for (let gx=0; gx<gw; gx++) Zg[gy*gw+gx]=Z[Math.min(H-1,gy*step)*W+Math.min(W-1,gx*step)];
    let front=[];
    const seed=(j)=>{ if (st[j]) return; st[j]=1; fz[j]=Zg[j]; fc[j*3]=px[j*4]; fc[j*3+1]=px[j*4+1]; fc[j*3+2]=px[j*4+2]; front.push(j); };
    for (let gy=0; gy<gh; gy++) for (let gx=0; gx<gw; gx++){ const i=gy*gw+gx;
      if (gx+1<gw){ const j=i+1; if (Zg[j]>Zg[i]*1.06) seed(j); else if (Zg[i]>Zg[j]*1.06) seed(i); }
      if (gy+1<gh){ const j=i+gw; if (Zg[j]>Zg[i]*1.06) seed(j); else if (Zg[i]>Zg[j]*1.06) seed(i); } }
    const band = Math.max(4, Math.round(0.03*Math.max(gw,gh)));
    for (let pass=0; pass<band && front.length; pass++){
      const next=[];
      for (const p of front){ const px0=p%gw;
        for (const q of [px0>0?p-1:-1, px0<gw-1?p+1:-1, p>=gw?p-gw:-1, p<n-gw?p+gw:-1]){
          if (q<0 || st[q]) continue;
          let sz=0, sr=0, sg=0, sb=0, c=0; const qx=q%gw;
          for (const k of [qx>0?q-1:-1, qx<gw-1?q+1:-1, q>=gw?q-gw:-1, q<n-gw?q+gw:-1]) if (k>=0 && st[k]){ sz+=fz[k]; sr+=fc[k*3]; sg+=fc[k*3+1]; sb+=fc[k*3+2]; c++; }
          const zf = sz/c; if (!(Zg[q] < zf*0.95)) continue;     // only under something nearer
          st[q]=2; fz[q]=zf; fc[q*3]=sr/c; fc[q*3+1]=sg/c; fc[q*3+2]=sb/c; next.push(q);
          const x=Math.min(W-1,(q%gw)*step), y=Math.min(H-1,((q/gw)|0)*step);
          if (fill && fill.region[y*W+x]) continue;             // the subject's own fill covers it
          facing(unproject((x+.5)/W,(y+.5)/H,zf), zf, fc[q*3], fc[q*3+1], fc[q*3+2], 255, 1, 1.3);
        } }
      front = next;
    }
  }
  // The sky carries on past the edges of the photo, in the colours at its border, so turning the view
  // shows more sky rather than black. Coarser and larger out there; only where the border is sky.
  if (S.sky && S.skyR){
    const ext = Math.round(0.4*gw), st = 3;
    for (let gy=-ext; gy<gh; gy+=st) for (let gx=-ext; gx<gw+ext; gx+=st){
      if (gx>=0 && gx<gw && gy>=0) continue;
      const cx=Math.min(gw-1,Math.max(0,gx)), cy=Math.min(gh-1,Math.max(0,gy)), di=Math.min(H-1,cy*step)*W+Math.min(W-1,cx*step);
      if (!S.sky[di]) continue;
      const u=(gx*step+.5)/W, v=(gy*step+.5)/H, z=skyZ(u,v), ci=(cy*gw+cx)*4;
      facing(unproject(u,v,z), z, px[ci], px[ci+1], px[ci+2], 255, 1, st*1.2);
    }
  }
  if (fill){
    for (let gy=0; gy<gh; gy++) for (let gx=0; gx<gw; gx++){
      const x=Math.min(W-1,gx*step), y=Math.min(H-1,gy*step), i=y*W+x; if (!fill.region[i]) continue;
      const zF=zOf(fill.f[i*4]); if (zF < Z[i]*1.03) continue;
      const p=unproject((x+.5)/W,(y+.5)/H,zF);
      facing(p, zF, clamp255(fill.f[i*4+1]*255), clamp255(fill.f[i*4+2]*255), clamp255(fill.f[i*4+3]*255), 255, 1, 1.25);
    }
  }
  return trimSplats(sp, m);
}
// The splats to draw now: the scan's own, or this photo's (made again only when what they depend on changed).
function currentSplats(){
  if (S.scan) return S.scan.splats || null;
  if (!S.photo || !S.depth || !S.compMap) return null;
  const key = photoSplatKey();
  if (!S.photoSplats || S.photoSplats.key!==key){ S.photoSplats = photoSplats(); S.photoSplats.key = key; S.photoSplats.ver = (S.splatVer = (S.splatVer||0)+1); }
  return S.photoSplats;
}
function hasSplats(){ return S.scan ? !!S.scan.splats : !!(S.photo && S.depth); }

// ---------------------------------------------------------------- saving splats
// .spz (Niantic, version 2): gzip over a 16-byte header then positions (24-bit fixed point), opacities,
// colours, sizes and rotations, packed per attribute. Roughly a tenth of the .ply. Right, up, back frame,
// which is this app's own, so nothing is turned.
async function saveSplatSpz(){
  const sp = currentSplats(); if (!sp || !sp.n) return;
  busy('Making the splat file', null); await tick();
  const N=sp.n; let ext=0; for (let i=0;i<N*3;i++) ext=Math.max(ext, Math.abs(sp.pos[i]));
  const fb = Math.max(4, Math.min(16, 22 - Math.ceil(Math.log2(Math.max(1, ext)))));    // as fine as the scene's size allows
  const raw=new Uint8Array(16+N*19), dv=new DataView(raw.buffer); dv.setUint32(0,0x5053474e,true); dv.setUint32(4,2,true); dv.setUint32(8,N,true); raw[12]=0; raw[13]=fb;
  const oP=16, oA=oP+N*9, oC=oA+N, oS=oC+N*3, oR=oS+N*3, one=1<<fb;
  for (let i=0;i<N;i++){
    for (let k=0;k<3;k++){ let v=Math.round(sp.pos[i*3+k]*one); v=Math.max(-8388608, Math.min(8388607, v)) & 0xffffff; const o=oP+i*9+k*3; raw[o]=v&255; raw[o+1]=(v>>8)&255; raw[o+2]=(v>>16)&255;
      raw[oC+i*3+k]=clamp255(Math.round(((sp.rgba[i*4+k]/255-.5)/SH_C0*0.15+.5)*255));
      raw[oS+i*3+k]=clamp255(Math.round((Math.log(Math.max(1e-9, sp.scl[i*3+k]))+10)*16)); }
    raw[oA+i]=sp.rgba[i*4+3];
    let w=sp.rot[i*4], x=sp.rot[i*4+1], y=sp.rot[i*4+2], z=sp.rot[i*4+3]; const l=Math.hypot(w,x,y,z)||1; if (w<0){ w=-w; x=-x; y=-y; z=-z; }
    raw[oR+i*3]=clamp255(Math.round((x/l+1)*127.5)); raw[oR+i*3+1]=clamp255(Math.round((y/l+1)*127.5)); raw[oR+i*3+2]=clamp255(Math.round((z/l+1)*127.5));
  }
  const blob = await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('gzip'))).blob();
  const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href=url; a.download='first-return.spz'; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 30000); busy(null);
  notice(`Saved first-return.spz, ${N.toLocaleString()} splats, ${(blob.size/1e6).toFixed(1)} MB. It opens in SuperSplat, Scaniverse and here.`);
}
// Standard 3DGS .ply (position, base colour, opacity, log sizes, rotation), turned into the usual
// y-down, z-forward frame so SuperSplat, Polycam and other splat viewers show it the right way up.
async function saveSplatPly(){
  const sp = currentSplats(); if (!sp || !sp.n) return;
  busy('Making the splat file', null); await tick();
  const props=['x','y','z','f_dc_0','f_dc_1','f_dc_2','opacity','scale_0','scale_1','scale_2','rot_0','rot_1','rot_2','rot_3'];
  // the floats that follow must start on a 4-byte boundary, so the comment is padded to fit
  let pad = '', head;
  for (;;){ head = `ply\nformat binary_little_endian 1.0\ncomment First Return splats${pad}\nelement vertex ${sp.n}\n${props.map(p=>'property float '+p).join('\n')}\nend_header\n`;
    if (new TextEncoder().encode(head).length % 4 === 0) break; pad += ' '; }
  const hb = new TextEncoder().encode(head), buf = new ArrayBuffer(hb.length + sp.n*props.length*4); new Uint8Array(buf).set(hb);
  const f = new Float32Array(buf, hb.length);
  let k=0;
  for (let i=0;i<sp.n;i++){
    f[k++]=sp.pos[i*3]; f[k++]=-sp.pos[i*3+1]; f[k++]=-sp.pos[i*3+2];
    for (let c=0;c<3;c++) f[k++]=(sp.rgba[i*4+c]/255-0.5)/SH_C0;
    const a=Math.min(0.995, Math.max(0.005, sp.rgba[i*4+3]/255)); f[k++]=Math.log(a/(1-a));
    for (let c=0;c<3;c++) f[k++]=Math.log(Math.max(1e-7, sp.scl[i*3+c]));
    // a half turn about x (y and z flipped) applied to the rotation too
    const w=sp.rot[i*4], x=sp.rot[i*4+1], y=sp.rot[i*4+2], z=sp.rot[i*4+3];
    f[k++]=-x; f[k++]=w; f[k++]=-z; f[k++]=y;
  }
  const blob = new Blob([buf], {type:'application/octet-stream'}), url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href=url; a.download='first-return-splats.ply'; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 30000); busy(null);
  notice(`Saved first-return-splats.ply, ${sp.n.toLocaleString()} splats, ${(buf.byteLength/1e6).toFixed(0)} MB. It opens in SuperSplat and other splat viewers.`);
}
