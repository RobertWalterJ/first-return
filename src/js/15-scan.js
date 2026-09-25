// ---------------------------------------------------------------- real 3D scans (.ply)
// A scan from Polycam, a phone lidar app, photogrammetry or a Gaussian splat trainer is measured
// geometry, not a guess from one photo. It is read, levelled on its own floor, and drawn with the
// same looks. Colour comes from red/green/blue, or from a splat's base colour (f_dc_0..2).
const PLY_SIZE = {char:1,int8:1,uchar:1,uint8:1,short:2,int16:2,ushort:2,uint16:2,int:4,int32:4,uint:4,uint32:4,float:4,float32:4,double:8,float64:8};
function parsePly(buf){
  const u8 = new Uint8Array(buf);
  const endTag = [101,110,100,95,104,101,97,100,101,114];          // "end_header"
  let he = -1;
  for (let i=0;i<Math.min(u8.length, 200000);i++){ let ok=true; for (let k=0;k<endTag.length;k++) if (u8[i+k]!==endTag[k]){ ok=false; break; } if (ok){ he=i+endTag.length; break; } }
  if (he<0) throw new Error('this does not look like a PLY file');
  while (u8[he]===13) he++; if (u8[he]===10) he++;
  const header = new TextDecoder().decode(u8.subarray(0, he)).split(/\r?\n/);
  let format='', els=[], cur=null, upHint=null;
  for (const line of header){ const t=line.trim().split(/\s+/);
    if (t[0]==='format') format=t[1];
    else if (t[0]==='element'){ cur={name:t[1], count:+t[2], props:[]}; els.push(cur); }
    else if (t[0]==='property' && cur){ if (t[1]==='list') cur.props.push({list:true, ct:t[2], it:t[3], name:t[4]}); else cur.props.push({type:t[1], name:t[2]}); }
    else if (t[0]==='comment' && /vertical axis:\s*z/i.test(line)) upHint='z';
    else if (t[0]==='comment' && /vertical axis:\s*y/i.test(line)) upHint='y'; }
  const vi = els.findIndex(e=>e.name==='vertex'); if (vi<0) throw new Error('no points in this file');
  const V = els[vi], names = V.props.map(p=>p.name), idx = n => names.indexOf(n);
  if (idx('x')<0 || idx('y')<0 || idx('z')<0) throw new Error('the points have no x, y, z');
  const total = V.count, step = Math.max(1, Math.ceil(total/(MOBILE ? 1.5e6 : 4e6))), n = Math.ceil(total/step);
  const pos = new Float32Array(n*3), col = new Float32Array(n*3); let m = 0;
  const hasRGB = idx('red')>=0, hasDC = idx('f_dc_0')>=0, hasOp = idx('opacity')>=0;
  // a Gaussian splat file also has sizes and rotations: keep those for the Photoreal look
  const isSplat = hasOp && hasDC && idx('scale_0')>=0 && idx('rot_0')>=0, sp = isSplat ? newSplats(n) : null; let ms = 0;
  const is0=idx('scale_0'), is1=idx('scale_1'), is2=idx('scale_2'), ir0=idx('rot_0'), ir1=idx('rot_1'), ir2=idx('rot_2'), ir3=idx('rot_3');
  const colScale = hasRGB ? (V.props[idx('red')].type.startsWith('u') && PLY_SIZE[V.props[idx('red')].type]===1 ? 1/255 : PLY_SIZE[V.props[idx('red')].type]===2 ? 1/65535 : 1) : 1;
  const ix=idx('x'), iy=idx('y'), iz=idx('z'), ir=idx('red'), ig=idx('green'), ib=idx('blue'), d0=idx('f_dc_0'), d1=idx('f_dc_1'), d2=idx('f_dc_2'), io=idx('opacity');
  const take = (get) => {
    const X=get(ix), Y=get(iy), Z=get(iz); if (!isFinite(X) || !isFinite(Y) || !isFinite(Z)) return;
    let r=.75,g=.75,b=.75;
    if (hasRGB){ r=get(ir)*colScale; g=get(ig)*colScale; b=get(ib)*colScale; }
    else if (hasDC){ const C0=0.28209479; r=.5+C0*get(d0); g=.5+C0*get(d1); b=.5+C0*get(d2); }
    const alpha = hasOp ? 1/(1+Math.exp(-get(io))) : 1;
    if (sp && alpha >= 0.02){ const o=ms*3; sp.pos[o]=X; sp.pos[o+1]=Y; sp.pos[o+2]=Z;
      sp.scl[o]=Math.exp(get(is0)); sp.scl[o+1]=Math.exp(get(is1)); sp.scl[o+2]=Math.exp(get(is2));
      sp.rot[ms*4]=get(ir0); sp.rot[ms*4+1]=get(ir1); sp.rot[ms*4+2]=get(ir2); sp.rot[ms*4+3]=get(ir3);
      sp.rgba[ms*4]=clamp255(Math.round(r*255)); sp.rgba[ms*4+1]=clamp255(Math.round(g*255)); sp.rgba[ms*4+2]=clamp255(Math.round(b*255)); sp.rgba[ms*4+3]=Math.round(alpha*255); ms++; }
    if (alpha < 0.15) return;        // near-transparent splats are noise as dots
    pos[m*3]=X; pos[m*3+1]=Y; pos[m*3+2]=Z;
    col[m*3]=Math.min(1,Math.max(0,r)); col[m*3+1]=Math.min(1,Math.max(0,g)); col[m*3+2]=Math.min(1,Math.max(0,b)); m++;
  };
  if (format==='ascii'){
    const lines = new TextDecoder().decode(u8.subarray(he)).split(/\r?\n/);
    let li = 0; for (let e=0;e<vi;e++) li += els[e].count;
    for (let i=0;i<total;i+=step){ const t=lines[li+i]; if (!t) continue; const v=t.trim().split(/\s+/).map(Number); take(k=>v[k]); }
  } else {
    const le = format==='binary_little_endian'; if (!le && format!=='binary_big_endian') throw new Error('unknown PLY format '+format);
    let off = he;
    for (let e=0;e<vi;e++){ if (els[e].props.some(p=>p.list)) throw new Error('this PLY lists faces before its points, which is not supported yet'); off += els[e].count*els[e].props.reduce((s,p)=>s+PLY_SIZE[p.type],0); }
    if (V.props.some(p=>p.list)) throw new Error('unsupported point layout');
    const offs=[]; let stride=0; for (const p of V.props){ offs.push(stride); stride+=PLY_SIZE[p.type]; }
    const dv = new DataView(buf);
    const rd = (o,t) => t==='float'||t==='float32' ? dv.getFloat32(o,le) : t==='double'||t==='float64' ? dv.getFloat64(o,le) : t==='uchar'||t==='uint8' ? dv.getUint8(o) : t==='char'||t==='int8' ? dv.getInt8(o)
      : t==='ushort'||t==='uint16' ? dv.getUint16(o,le) : t==='short'||t==='int16' ? dv.getInt16(o,le) : t==='uint'||t==='uint32' ? dv.getUint32(o,le) : dv.getInt32(o,le);
    const types = V.props.map(p=>p.type);
    for (let i=0;i<total;i+=step){ const base=off+i*stride; if (base+stride>buf.byteLength) break; take(k=>rd(base+offs[k], types[k])); }
  }
  // trained splats (3DGS, COLMAP cameras) are stored y-down unless the file says otherwise
  if (sp && !upHint) upHint = '-y';
  return {n:m, pos:pos.subarray(0,m*3), col:col.subarray(0,m*3), upHint, hasColour: hasRGB||hasDC, splats: sp ? trimSplats(sp, ms) : null};
}

// Find the floor with RANSAC and turn the scan so it is level, then centre it in front of the camera.
function levelScan(sc){
  const n=sc.n, P=sc.pos, rnd=seeded(17), K=Math.min(n,20000), S0=[];
  for (let k=0;k<K;k++){ const i=(rnd()*n)|0; S0.push([P[i*3],P[i*3+1],P[i*3+2]]); }
  // extent from the 2nd to 98th percentile, so a few stray splats do not inflate the tolerance
  const pct=(a,q)=>{ const v=S0.map(p=>p[a]).sort((x,y)=>x-y); return v[Math.floor(v.length*q)]; };
  const lo=[0,1,2].map(a=>pct(a,0.02)), hi=[0,1,2].map(a=>pct(a,0.98));
  const ext = Math.hypot(hi[0]-lo[0],hi[1]-lo[1],hi[2]-lo[2]) || 1, tol = ext*0.008;
  let best=null, bestN=0;
  for (let it=0; it<400; it++){
    const a=S0[(rnd()*K)|0], b=S0[(rnd()*K)|0], c=S0[(rnd()*K)|0];
    const u=[b[0]-a[0],b[1]-a[1],b[2]-a[2]], v=[c[0]-a[0],c[1]-a[1],c[2]-a[2]];
    let nn=[u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]]; const l=Math.hypot(...nn); if (l<1e-9) continue; nn=nn.map(x=>x/l);
    // only planes near one of the axes can be a floor (scans are saved Y-up or Z-up)
    // a floor is near the Y or Z axis (the two ways scans are saved), never a sideways wall
    const hintAxis = sc.upHint==='z' ? 2 : 1;
    if (Math.abs(nn[1]) < 0.906 && Math.abs(nn[2]) < 0.906) continue;
    const d0 = nn[0]*a[0]+nn[1]*a[1]+nn[2]*a[2]; let cnt=0;
    for (let k=0;k<K;k+=2){ const p=S0[k]; if (Math.abs(nn[0]*p[0]+nn[1]*p[1]+nn[2]*p[2]-d0) < tol) cnt++; }
    const bonus = Math.abs(nn[hintAxis]) > 0.8 ? 1.3 : 1;                 // favour the axis the file says is up
    if (cnt*bonus <= bestN) continue;
    // nearly everything sits on one side of a floor; a wall splits a room scan in two
    let side=0; for (let k=1;k<K;k+=7){ const p=S0[k]; if (nn[0]*p[0]+nn[1]*p[1]+nn[2]*p[2] > d0) side++; }
    const frac = side/Math.ceil((K-1)/7); if (Math.max(frac, 1-frac) < 0.9) continue;
    bestN=cnt*bonus; best={nn, d0, cnt};
  }
  let up = sc.upHint==='z' ? [0,0,1] : sc.upHint==='-y' ? [0,-1,0] : [0,1,0], floorD = null;
  if (best && best.cnt > K/2*0.12){ up = best.nn.slice(); floorD = best.d0;
    // the floor's normal should point to where most points are
    let above=0; for (let k=0;k<K;k+=3){ const p=S0[k]; if (up[0]*p[0]+up[1]*p[1]+up[2]*p[2] > floorD) above++; }
    if (above < K/3/2){ up=up.map(x=>-x); floorD=-floorD; } }
  // rotate "up" onto +Y (Rodrigues)
  const ax=[-up[2],0,up[0]], s=Math.hypot(ax[0],ax[2]), c=up[1];      // axis = up x Y
  const Rm = s<1e-6 ? (c>0 ? [1,0,0,0,1,0,0,0,1] : [1,0,0,0,-1,0,0,0,-1]) : (()=>{ const k=[ax[0]/s,0,ax[2]/s], t=1-c;
    return [t*k[0]*k[0]+c, -s*k[2], t*k[0]*k[2], s*k[2], c, -s*k[0], t*k[0]*k[2], s*k[0], t*k[2]*k[2]+c]; })();
  const out = new Float32Array(n*3), floor = new Uint8Array(n);
  for (let i=0;i<n;i++){ const x=P[i*3],y=P[i*3+1],z=P[i*3+2];
    out[i*3]=Rm[0]*x+Rm[1]*y+Rm[2]*z; out[i*3+1]=Rm[3]*x+Rm[4]*y+Rm[5]*z; out[i*3+2]=Rm[6]*x+Rm[7]*y+Rm[8]*z; }
  // floor height after levelling, and which points lie on it
  // once "up" is +Y the fitted plane is simply y = floorD
  if (floorD!==null){ for (let i=0;i<n;i++) if (Math.abs(out[i*3+1]-floorD) < tol*1.5) floor[i]=1; }
  // centre on the median of the non-floor points, camera in front, looking at it
  const xs=[],ys2=[],zs=[]; for (let i=0;i<n;i+=Math.max(1,(n/20000)|0)) if (!floor[i]){ xs.push(out[i*3]); ys2.push(out[i*3+1]); zs.push(out[i*3+2]); }
  const med=a=>{ a.sort((p,q)=>p-q); return a.length ? a[a.length>>1] : 0; }, cx=med(xs), cy=med(ys2), cz=med(zs);
  const rs=[]; for (let i=0;i<n;i+=Math.max(1,(n/20000)|0)) rs.push(Math.hypot(out[i*3]-cx,out[i*3+1]-cy,out[i*3+2]-cz)); rs.sort((a,b)=>a-b);
  const R = rs[Math.floor(rs.length*0.9)] || 1, tanV = Math.tan(25*Math.PI/180), D = R*1.15/tanV;
  for (let i=0;i<n;i++){ out[i*3]-=cx; out[i*3+1]-=cy; out[i*3+2]-=cz+D; }
  // how far off square the scan was (ignoring a plain Y-up / Z-up swap)
  const tilt = Math.acos(Math.min(1, Math.max(Math.abs(up[0]),Math.abs(up[1]),Math.abs(up[2]))))*180/Math.PI;
  return {pos:out, floor, D, levelled: floorD!==null, tilt, Rm, shift:[cx, cy, cz+D]};
}

function buildScanCloud(cfg){
  const sc=S.scan, n=sc.n;
  let target = Math.round(2000*Math.pow(10, cfg.dots/100*2.75)) * (cfg.low ? 0.3 : 1);
  target = Math.min(target, cfg.cap||MAXPTS);
  const keep = Math.min(1, target/n), out = new Float32Array(Math.min(n, Math.ceil(target*1.1)+10)*10), comp = new Int16Array(out.length/10);
  let m = 0;
  for (let i=0;i<n && m<comp.length;i++){
    const r = hash2(i, 5, 71); if (r >= keep) continue;
    const kind = sc.floor[i] ? 1 : 0;
    if (kind===1 && hash2(i, 9, 3) >= Math.max(cfg.backdrop, 0.05)) continue;   // the scan's own floor follows Background
    const o=m*10, cr=sc.col[i*3], cg=sc.col[i*3+1], cb=sc.col[i*3+2];
    out[o]=sc.pos[i*3]; out[o+1]=sc.pos[i*3+1]; out[o+2]=sc.pos[i*3+2]; out[o+3]=cr; out[o+4]=cg; out[o+5]=cb;
    out[o+6]=kind; out[o+7]=hash2(i,13,17); out[o+8]=0.299*cr+0.587*cg+0.114*cb; out[o+9]=1; comp[m]=kind===0?0:-1; m++;
  }
  return {out, comp, n:m, cinfo:[], live:[], floorPlane:null};
}

async function openScan(file){
  const g = ++S.gen; S.clip = null;
  busy('Reading the scan', null); await tick();
  const name = (file.name||'').toLowerCase(), buf = await file.arrayBuffer();
  let sc;
  if (name.endsWith('.splat') || name.endsWith('.spz')){
    const sp = name.endsWith('.spz') ? await parseSpz(buf) : parseSplatFile(buf), pts = pointsFromSplats(sp);
    sc = {n:pts.n, pos:pts.pos, col:pts.col, upHint:null, hasColour:true, splats:sp};
  } else sc = parsePly(buf);
  if (g!==S.gen) return;
  if (sc.n < 100) throw new Error('only '+sc.n+' usable points in this file');
  busy('Levelling the scan', null); await tick();
  const L = levelScan(sc);
  if (sc.splats) levelSplats(sc.splats, L.Rm, L.shift);
  S.scan = {n:sc.n, pos:L.pos, col:sc.col, floor:L.floor, splats:sc.splats};
  S.photo = S.photoSrc = {w:1600, h:1200, data:null}; S.photoCanvas = null; S.depth = S.depthSrc = null;
  S.tanV = S.tanVAuto = Math.tan(25*Math.PI/180); Object.assign(S.adv, {fov:null, ratio:null, roll:null, beams:null}); S.dbg='result'; showDebug(); S.planes=[]; S.plane=null; S.ground=null; S.compMap=null; S.comps=[];
  S.fovSource = 'a 3D scan'; S.credit = `3D scan: ${file.name}, ${sc.n.toLocaleString()} points${L.levelled ? `, levelled on its floor${L.tilt>=1 ? ` (it was ${L.tilt.toFixed(0)}° off)` : ''}` : ''}. It stayed on this device.`;
  S.undo=[]; undoArmed=true; S.placing=false; S.panMode=false; syncPan(); S.autoFrame=false; S.home=null; S.refFrozen=true; S.pitchTan=0;
  S.picks=[]; S.labels=[]; S.faces=[]; S.faceMask=null; S.mLines=[]; S.mPts=[]; S.mScale=null; S.mCorr=1; S.hzV=null; S.rollAuto=0; S.roll=0; S.compCache=null;
  S.target=[0,0,-L.D]; S.refDist=L.D; S.pivot=S.target.slice(); S.pan=[0,0,0]; S.userMoved=false;
  if (!sc.hasColour && (P.colour==='photo'||P.colour==='muted')){ S.colourBeforeScan=P.colour; P.colour='height'; }
  if (LOOKS[look].splat && (!sc.splats || LOOKS[look].mix)){ look='void'; S.activeMine=null; LOOK_KEYS.forEach(k=>{ P[k]=LOOKS.void[k]; }); }
  if (FX_NEEDS_SPLATS.has(S.fx) && !sc.splats) S.fx='none';
  const Lk=LOOKS[look]; S.yaw=Lk.yaw; S.pitch=Math.max(Lk.pitch, 12); S.zoom=Lk.zoom;
  invalidateCompare(); $('#compareBtn').hidden = true;
  busy(null); banner(''); notice(`Opened a 3D scan: ${sc.n.toLocaleString()} points${L.levelled ? ', levelled on its floor' : ''}.`);
  document.body.classList.add('scan'); layout(); S.dirtyBuild=true; renderTray(); queueThumbs(); viewButton();
}
