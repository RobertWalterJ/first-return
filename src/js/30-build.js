// ---------------------------------------------------------------- building the cloud
// Each point is 10 floats: position (3), photo colour (3), kind, random, luminance, incidence.
// kind 0 = subject, 1 = backdrop, 2 = synthetic floor. Which subject a point belongs to is kept
// separately (S.cpuComp) because only picking needs it.
function buildCloud(cfg){
  const Ph=S.photo, D=S.depth, aspect=Ph.w/Ph.h, map=S.compMap, tanV=S.tanV, tanH=tanV*aspect;
  const density = cfg.dots;                         // 0..100
  let target = Math.round(2000*Math.pow(10, density/100*2.75)) * (cfg.low ? 0.3 : 1);
  const floorOK = (S.planes && S.planes.length) || S.floorTouched;     // no made-up floor under a hand held up to the sky
  const floorN = cfg.floor > 0 && floorOK ? Math.round(cfg.floor * Math.min(90000, 9000 + target*0.08)) : 0;
  target = Math.max(1000, Math.min(target, (cfg.cap||MAXPTS) - floorN - 2000));
  const cap = Math.round(target*1.08) + (cfg.cap ? 0 : 60000) + floorN + 4000;   // room for the subject detail pass
  const out = new Float32Array(cap*10), comp = new Int16Array(cap);
  let n = 0;
  const push = (x,y,z,r,g,b,kind,rnd,lum,inc,c) => { if (n>=cap) return; const o=n*10;
    out[o]=x;out[o+1]=y;out[o+2]=z;out[o+3]=r;out[o+4]=g;out[o+5]=b;out[o+6]=kind;out[o+7]=rnd;out[o+8]=lum;out[o+9]=inc; comp[n]=c; n++; };
  const nComp = map.reduce((m,v)=>Math.max(m,v+1),0);
  const cinfo = Array.from({length:nComp},()=>({n:0,sx:0,sz:0,minY:1e9,maxY:-1e9,top:null,topUV:null,foot:null}));
  const pix = Ph.data, pw = Ph.w, ph = Ph.h, du = 1/D.w, dv = 1/D.h;
  const rings = cfg.pattern==='rings', fog = cfg.bgTint > 0;
  const noise = seeded(3);

  // centre of the subject in the frame, for fading the backdrop out around it
  let fx=0.5, fy=0.5, bx0=1, by0=1, bx1=0, by1=0, subjArea=0;
  { let sx=0,sy=0,c=0; for (let i=0;i<map.length;i+=3) if (map[i]>=0){ const x=i%D.w, y=(i/D.w)|0; sx+=x; sy+=y; c++;
      bx0=Math.min(bx0,x/D.w); bx1=Math.max(bx1,(x+1)/D.w); by0=Math.min(by0,y/D.h); by1=Math.max(by1,(y+1)/D.h); }
    if (c){ fx=sx/c/D.w; fy=sy/c/D.h; subjArea=c*3/map.length; } }

  const sample = (u,v,cell) => {
    if (u<0||u>=1||v<0||v>=1) return;
    const mi = Math.min(D.h-1,(v*D.h)|0)*D.w + Math.min(D.w-1,(u*D.w)|0);
    const c = map[mi], kind = c>=0 ? 0 : 1, rnd = hash2(cell, 17, 5);
    const inFace = S.faceMask ? S.faceMask[mi]/255 : 0;
    if (inFace && hash2(cell,3,9) < [0.25,0.55,0.8][S.anonLevel]*inFace) return;
    if (kind===1){
      let keep = cfg.backdrop;
      if (fog){ const dx=(u-fx)*aspect/Math.max(aspect,1), dy=v-fy; keep *= Math.exp(-(dx*dx+dy*dy)/0.07); }
      if (rnd >= keep) return;
    }
    const d = depthAt(u,v), z = zOf(d);
    const zl=zOf(depthAt(u-du,v)), zr=zOf(depthAt(u+du,v)), zu=zOf(depthAt(u,v-dv)), zd=zOf(depthAt(u,v+dv));
    // a real sensor sees one surface or the other across a depth cliff, never the smear between
    if (Math.abs(zr-zl) > z*0.05 || Math.abs(zd-zu) > z*0.05) return;
    // surface normal from the neighbours, for how squarely the beam hits it
    const pl=unproject(u-du,v,zl), pr=unproject(u+du,v,zr), pu=unproject(u,v-dv,zu), pd=unproject(u,v+dv,zd);
    const ax=pr[0]-pl[0], ay=pr[1]-pl[1], az=pr[2]-pl[2], bx=pd[0]-pu[0], by=pd[1]-pu[1], bz=pd[2]-pu[2];
    let nx=ay*bz-az*by, ny=az*bx-ax*bz, nz=ax*by-ay*bx; const nl=Math.hypot(nx,ny,nz)||1; nx/=nl; ny/=nl; nz/=nl;
    const p0 = unproject(u,v,z), rl=Math.hypot(p0[0],p0[1],p0[2]);
    const inc = Math.abs((nx*p0[0]+ny*p0[1]+nz*p0[2])/rl);
    const ci = (Math.min(ph-1,(v*ph)|0)*pw + Math.min(pw-1,(u*pw)|0))*4;
    const r=pix[ci]/255, g=pix[ci+1]/255, b=pix[ci+2]/255, lum=0.299*r+0.587*g+0.114*b;
    if (rings){
      // spinning sensors lose returns from dark surfaces and from surfaces hit at a glancing angle
      const drop = 0.4*Math.pow(1-inc,3) + 0.18*Math.pow(1-lum,4);
      if (hash2(cell,7,11) < drop) return;
    }
    // range noise grows with distance, along the beam
    // hashed per cell, so the dots stay put between rebuilds
    const gn = Math.sqrt(-2*Math.log(hash2(cell,41,7)+1e-9))*Math.cos(6.283185*hash2(cell,43,9));
    const zz = z + gn*(0.002 + 0.0035*z)*(1 + 4*inFace);
    const p = unproject(u,v,zz);
    push(p[0],p[1],p[2],r,g,b,kind,rnd,lum,inc,c);
    if (kind===0){ const ci2=cinfo[c]; ci2.n++; ci2.sx+=p[0]; ci2.sz+=p[2];
      if (p[1]>ci2.maxY){ci2.maxY=p[1]; ci2.top=p; ci2.topUV=[u,v];} if (p[1]<ci2.minY){ci2.minY=p[1]; ci2.foot=p;} }
  };

  const azMax = Math.atan(tanH), elMax = Math.atan(tanV);
  const beamEls = [];
  if (rings){
    // fixed beam elevations, packed closer together near the horizon like a real multi-beam unit
    const beams = Math.round(16 + density/100*200);
    for (let k=0;k<beams;k++){ const s=(k+.5)/beams*2-1; beamEls.push(elMax*1.02*Math.sign(s)*Math.pow(Math.abs(s),1.45)); }
    const per = Math.max(200, Math.min(4000, Math.round(target/beams)));
    beamEls.forEach((el,k)=>{
      for (let j=0;j<per;j++){ const az=-azMax + (j+.5)/per*2*azMax;
        const u = 0.5 + Math.tan(az)/(2*tanH), v = 0.5 - Math.tan(el)/Math.cos(az)/(2*tanV);
        sample(u, v, k*8192+j); } });
  } else {
    const cw = Math.sqrt(aspect/target), chh = cw/aspect, nx = Math.ceil(1/cw), ny = Math.ceil(1/chh);
    const jit = cfg.pattern==='grid' ? 0 : 1;
    for (let y=0;y<ny;y++) for (let x=0;x<nx;x++){ const cell=y*nx+x;
      sample(Math.min(.9999,(x+.5+(hash2(x,y,1)-.5)*jit)/nx), Math.min(.9999,(y+.5+(hash2(x,y,2)-.5)*jit)/ny), cell); }
  }

  // Detail where it matters: a small subject gets extra samples of its own, so it holds up when framed
  // close. Only subject pixels are kept from this pass.
  if (subjArea > 0 && !cfg.cap){
    const want = Math.min(60000, target), have = target*subjArea;
    if (have < want){
      const extra = Math.min(want - have, (cfg.cap||MAXPTS) - n - floorN - 2000), bw=bx1-bx0, bh=by1-by0;
      if (extra > 500 && bw>0 && bh>0){
        const cells = extra/Math.max(0.05, subjArea/(bw*bh)), cw2 = Math.sqrt(bw*bh/cells), nx2 = Math.ceil(bw/cw2), ny2 = Math.ceil(bh/cw2);
        for (let y=0;y<ny2;y++) for (let x=0;x<nx2;x++){
          const u = bx0 + (x+hash2(x,y,31))*bw/nx2, v = by0 + (y+hash2(x,y,32))*bh/ny2;
          const mi = Math.min(D.h-1,(v*D.h)|0)*D.w + Math.min(D.w-1,(u*D.w)|0);
          if (map[mi] >= 0) sample(u, v, 1e7 + y*nx2 + x); }
      }
    }
  }

  // synthetic floor, laid on the real floor plane when the photo has one
  const live = cinfo.map((c,i)=>({...c,id:i})).filter(c=>c.n>50 && c.foot);
  let floorPlane = null;
  if (floorN && live.length){
    floorPlane = floorPlane3D(live);
    const feet = live.map(c=>[c.sx/c.n, c.sz/c.n]);
    const zc = feet.reduce((s,f)=>s+f[1],0)/feet.length, xc = feet.reduce((s,f)=>s+f[0],0)/feet.length;
    const depth0 = Math.abs(zc), xr = tanV*depth0*2.4*Math.max(1,aspect), zr = depth0*0.75, sig = tanV*depth0*0.28;
    const fr = seeded(21);
    const yAt = (x,z) => floorPlane.a*x + floorPlane.c*z + floorPlane.b;
    const weight = (x,z,ex,ez) => { let near=0; for (const f of feet){ const dx=x-f[0], dz=(z-f[1])*1.6; near=Math.max(near, Math.exp(-(dx*dx+dz*dz)/(2*sig*sig))); }
      return 0.22*(1-Math.pow(ex*ex+ez*ez,1.5)) + 0.78*near; };
    if (rings){
      // the beams below the horizon draw circles on the floor, the signature of a spinning scanner
      const per = Math.max(300, Math.round(floorN/Math.max(1,beamEls.filter(e=>e<0).length)));
      beamEls.forEach((el,k)=>{ if (el>=0) return;
        for (let j=0;j<per*3;j++){ const az = (j/(per*3)*2-1)*Math.PI*0.95;
          const rx=Math.sin(az)*Math.cos(el), ry=Math.sin(el), rz=-Math.cos(az)*Math.cos(el);
          const den = ry - floorPlane.a*rx - floorPlane.c*rz; if (Math.abs(den)<1e-4) continue;
          const t = floorPlane.b/den; if (!(t>0.2 && t<60)) continue;
          const x=rx*t, z=rz*t, ex=(x-xc)/xr, ez=(z-zc)/zr; if (ex*ex+ez*ez>1) continue;
          if (fr() > weight(x,z,ex,ez)*1.2) continue;
          push(x, yAt(x,z), z, .6,.7,.75, 2, fr(), .5, 1, -1); } });
    } else {
      let made=0, tries=0;
      while (made<floorN && tries<floorN*8){ tries++;
        const ex = fr()*2-1, ez = fr()*2-1; if (ex*ex+ez*ez>1) continue;
        const x = xc + ex*xr, z = zc + ez*zr; if (z > -0.3) continue;
        if (fr() > weight(x,z,ex,ez)) continue;
        push(x, yAt(x,z) + (fr()-.5)*0.004, z, .6,.7,.75, 2, fr(), .5, 1, -1); made++; }
    }
  }
  return {out, comp, n, cinfo, live, floorPlane};
}

// Floor as a 3D plane y = a*x + c*z + b. From the photo's own floor when there is one, so a camera
// tilted down gives a tilted floor; otherwise level, just under the lowest subject.
function floorPlane3D(live){
  const lowest = Math.min(...live.map(c=>c.minY));
  const G = S.ground, D = S.depth;
  // of the floors found, use the one the subjects actually stand on
  let best = null, bestErr = 1e9;
  for (let id=1; id<=(S.planes||[]).length; id++){
    const rnd = seeded(5+id), rows=[];
    for (let k=0;k<9000 && rows.length<1500;k++){ const i=(rnd()*G.length)|0; if (G[i]!==id) continue;
      const u=((i%D.w)+.5)/D.w, v=(((i/D.w)|0)+.5)/D.h; rows.push(unproject(u,v,zOf(D.d[i]))); }
    const pl = rows.length > 200 ? lsqFloor(rows) : null; if (!pl) continue;
    const h = Math.max(...live.map(c=>c.maxY-c.minY));
    const err = live.reduce((s,c)=>s+Math.abs(pl.a*c.foot[0]+pl.c*c.foot[2]+pl.b-c.minY),0)/live.length;
    if (err < bestErr && err < 0.35*h){ bestErr=err; best=pl; }
  }
  // level in the world, which is tilted in the camera's frame when the photo was straightened
  return best || {a:-Math.tan(S.roll), c:0, b:lowest};
}
function lsqFloor(rows){
  // least squares for y = a x + c z + b
  let Sxx=0,Sxz=0,Sx=0,Szz=0,Sz=0,Sy=0,Sxy=0,Szy=0; const N=rows.length;
  for (const [x,y,z] of rows){ Sxx+=x*x; Sxz+=x*z; Sx+=x; Szz+=z*z; Sz+=z; Sy+=y; Sxy+=x*y; Szy+=z*y; }
  const A=[[Sxx,Sxz,Sx],[Sxz,Szz,Sz],[Sx,Sz,N]], B=[Sxy,Szy,Sy];
  const det=m=>m[0][0]*(m[1][1]*m[2][2]-m[1][2]*m[2][1])-m[0][1]*(m[1][0]*m[2][2]-m[1][2]*m[2][0])+m[0][2]*(m[1][0]*m[2][1]-m[1][1]*m[2][0]);
  const D0=det(A); if (Math.abs(D0)<=1e-9) return null;
  const col=i=>A.map((r,k)=>r.map((v,j)=>j===i?B[k]:v));
  const a=det(col(0))/D0, c=det(col(1))/D0, b=det(col(2))/D0;
  return (Math.abs(a)<0.5 && Math.abs(c)<1.2) ? {a,c,b} : null;
}

function cfgFromP(extra){
  const L = LOOKS[look];
  return Object.assign({dots:val('dots'), backdrop:val('backdrop'), floor:val('floor'), pattern:P.pattern, bgTint:L.bgTint}, extra||{});
}
function build(){
  S.dirtyBuild = false;
  if (S.scan){
    const R = buildScanCloud(cfgFromP({low:S.lowDetail}));
    S.cpu = R.out; S.cpuComp = R.comp; S.count = R.n; S.nComp = 0; S.comps = []; S.floor3d = null;
    const ex = extents(R.out, R.n); S.rng=ex.rng; S.yr=ex.yr;
    uploadCloud(R.out, R.n); refreshLabelPositions(); renderPins(); S.dirtyDraw = true; return;
  }
  if (!S.photo || !S.depth) return;
  SHIFT = curShift();
  S.compMap = subjectMap();
  const R = buildCloud(cfgFromP({low:S.lowDetail}));
  S.cpu = R.out; S.cpuComp = R.comp; S.count = R.n; S.nComp = R.live.length; S.floor3d = R.floorPlane;
  S.comps = R.live;
  if (S.autoLight && !S.scan){
    S.autoLight = false; const ls=[];
    for (let i=0;i<R.n;i+=7) if (R.out[i*10+6]===0) ls.push(R.out[i*10+8]);
    ls.sort((a,b)=>a-b); const med = ls.length ? ls[ls.length>>1] : 0.5;
    P.light = S.lightAuto = med < 0.16 ? 2 : med < 0.26 ? 1 : 0;
    if (P.light){ const cur=$('#notice'); notice((cur.hidden ? '' : cur.textContent+' ') + (P.light===2 ? 'The subject was in shadow, so its light is evened out (Adjust, Light).' : 'The subject was dark, so its light is lifted (Adjust, Light).')); }
    if (S.tab==='adjust') renderTray();
  }
  if (R.live.length){ const all=R.live.reduce((a,c)=>[a[0]+c.sx, a[1]+(c.minY+c.maxY)/2*c.n, a[2]+c.sz, a[3]+c.n],[0,0,0,0]);
    S.target=[all[0]/all[3], all[1]/all[3], all[2]/all[3]]; }
  else S.target=[0,0,-zOf(0.5)];
  // zoom distance is fixed per photo, so changing a setting does not move the camera
  if (!S.refFrozen){ S.refDist = Math.abs(S.target[2]) || 2; S.refFrozen = true; }
  if (!S.userMoved){ S.pivot = S.target.slice(); S.pan = [0,0,0]; }
  if (S.reframe){ S.reframe = false; if (LOOKS[look].bgTint > 0 && !S.isSample && viewAtHome()) S.autoFrame = true; }
  const ex = extents(R.out, R.n); S.rng=ex.rng; S.yr=ex.yr;
  uploadCloud(R.out, R.n);
  if (S.autoFrame){ S.autoFrame = false; setTimeout(frameSubject, 0); }
  refreshLabelPositions(); renderPins();
  S.dirtyDraw = true;
}
function extents(out, n){
  let rmin=1e9,rmax=-1e9,ymin=1e9,ymax=-1e9; const step=Math.max(1,(n/20000)|0);
  for (let i=0;i<n;i+=step){ const o=i*10, x=out[o],y=out[o+1],z=out[o+2], r=Math.hypot(x,y,z); if(r<rmin)rmin=r; if(r>rmax)rmax=r; if(y<ymin)ymin=y; if(y>ymax)ymax=y; }
  return {rng:[rmin,rmax], yr:[ymin,ymax]};
}
