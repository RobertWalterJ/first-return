// ---------------------------------------------------------------- measuring
// Single-view metrology, the surveyor's way, rather than trusting depth (which one photo squeezes badly at
// a distance): with the camera a known height above the ground (a phone is usually about 1.5 m up), a
// point where something meets the ground is where its line of sight crosses the fitted ground plane, in
// metres. Tap that, then another spot on the ground for the distance between, or the thing's top for its
// height (the top lies on the vertical through the first point). A known length corrects it all.
// Scans are measured directly, in their own units (metres for Polycam, Scaniverse and similar).
// Without a floor a photo falls back to depth, marked as rough.
S.measure = false; S.mPts = []; S.mLines = []; S.mScale = null; S.mCorr = 1; S.camH = 1.5; S.hzV = null;
const CAM_HEIGHTS = [1.2, 1.5, 1.7, 2.0];
function floorFit(){
  const key = S.scan ? 'scan' : S.depthVer+'|'+SHIFT.toFixed(5)+'|'+S.tanV.toFixed(5);
  if (S.floorFitCache && S.floorFitCache.key===key) return S.floorFitCache.pl;
  let pl = null;
  if (S.scan){ const ys=[]; for (let i=0;i<S.scan.n;i+=5) if (S.scan.floor[i]) ys.push(S.scan.pos[i*3+1]); ys.sort((a,b)=>a-b);
    if (ys.length > 50) pl = {a:0, c:0, b:ys[ys.length>>1]}; }
  else if (S.ground && S.depth){ const D=S.depth, G=S.ground, rnd=seeded(19), rows=[];
    for (let k=0;k<30000 && rows.length<2000;k++){ const i=(rnd()*G.length)|0; if (G[i]!==1) continue;
      rows.push(unproject(((i%D.w)+.5)/D.w, (((i/D.w)|0)+.5)/D.h, zOf(D.d[i]))); }
    pl = rows.length > 200 ? lsqFloor(rows) : null; }
  S.floorFitCache = {key, pl}; return pl;
}
// metres per scene unit, or null when there is nothing to go on yet
function metresPerUnit(){
  if (S.mScale) return S.mScale;
  if (S.scan) return 1;
  const pl = floorFit(); if (!pl) return null;
  const h = Math.abs(pl.b)/Math.sqrt(1+pl.a*pl.a+pl.c*pl.c);
  return h > 1e-6 ? S.camH/h : null;
}
const v3 = { dot:(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2], sub:(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]], len:a=>Math.hypot(a[0],a[1],a[2]) };
// Which way is up, from the horizon rather than the fitted floor: relative depth bends a floor upward with
// distance, which tilts a fitted plane toward the camera. The horizon (from how upright edges converge,
// as Straighten uses) is where lines of sight run parallel to the ground. Needs a floor in the photo.
// The horizon is also eye level: everything it crosses is the camera's height above the ground. It starts
// from the upright edges and can be dragged to where eye level really is (a standing person's eyes).
function horizonV(){ return S.hzV!=null ? S.hzV : 0.5 + PITCH_SIGN*(S.pitchTan||0)/(2*S.tanV); }
function upNormal(){ if (!S.scan && !S.depth) return null; const vh = horizonV(), nz = (1-2*vh)*S.tanV, l = Math.hypot(1, nz); return [0, 1/l, nz/l]; }
// where the line of sight through (u, v) meets the ground, in metres from the camera
function groundHit(u, v){ const n=upNormal(); if (!n) return null; const d=unproject(u,v,1), nd=v3.dot(n,d);
  if (nd > -1e-4) return null; const t=-S.camH/nd; return [d[0]*t, d[1]*t, d[2]*t]; }
// the height of the point seen at (u, v) above ground point G: the closest approach of its line of sight
// to the vertical through G
function heightFrom(G, u, v){ const n=upNormal(), d=unproject(u,v,1), b=v3.dot(n,d), c=v3.dot(d,d), dd=v3.dot(n,G), e=v3.dot(d,G), den=c-b*b;
  return Math.abs(den) < 1e-9 ? null : (b*e - c*dd)/den; }
// one measurement from its two taps (kept, so a new camera height can work it out again)
function makeLine(A, B){
  const L = {a:A.p, b:B.p, taps:[A,B], m:null, kind:'rough'};
  if (S.scan){ L.m = v3.len(v3.sub(A.p, B.p)); L.kind = 'scan'; return L; }
  const G = groundHit(A.u, A.v), D = S.depth, bi = Math.min(D.h-1,(B.v*D.h)|0)*D.w + Math.min(D.w-1,(B.u*D.w)|0);
  const G2 = S.ground && S.ground[bi] ? groundHit(B.u, B.v) : null;
  if (G && G2){ L.m = v3.len(v3.sub(G, G2)); L.kind = 'ground'; }
  else if (G){ const h = heightFrom(G, B.u, B.v); if (h!=null){ L.m = h; L.kind = 'height'; } }
  if (L.m==null){ const k = metresPerUnit(); if (k){ L.m = v3.len(v3.sub(A.p, B.p))*k; L.kind = 'rough'; } }
  return L;
}
function fmtM(m){ return m < 1 ? Math.round(m*100)+' cm' : m < 10 ? m.toFixed(1)+' m' : Math.round(m)+' m'; }
function lineText(L){ if (L.m==null) return (v3.len(v3.sub(L.a,L.b))).toFixed(2)+' units';
  return (L.kind==='rough' ? 'about ' : '') + fmtM(Math.abs(L.m)*S.mCorr) + (L.kind==='height' ? ' high' : ''); }

function setMeasure(on){
  S.measure = on; S.mPts = []; $('#measureBtn').setAttribute('aria-pressed', on); $('#measureBar').hidden = !on;
  if (on && S.panMode){ S.panMode=false; syncPan(); }
  renderMeasureBar(); renderMeasures();
}
function measureTap(cx, cy){
  const hit = pickPoint(cx, cy); if (!hit) return;
  S.mPts.push({p:hit.p.slice(), u:hit.u, v:hit.v});
  if (S.mPts.length === 2){ S.mLines.push(makeLine(S.mPts[0], S.mPts[1])); S.mPts = []; }
  renderMeasureBar(); renderMeasures();
}
function renderMeasureBar(){
  const bar = $('#measureBar'); if (bar.hidden) return;
  const how = S.mCorr!==1 ? 'Corrected by your known length.' : S.scan ? 'Scan units, usually metres.' : `Eye level is taken as ${S.camH} m above the ground. Expect some error; a known length makes it better.`;
  const tip = (S.scan ? (S.mPts.length ? 'Now tap the second point.' : 'Tap two points to measure between them.')
    : (S.mPts.length ? 'Now tap its top for its height, or another spot on the ground for a distance.' : "First drag the dashed line to eye level, at the height of a standing person's eyes. Then tap where something meets the ground."))+' '+how;
  bar.innerHTML = `<p class="hint" style="margin:0 0 6px">${sayBtn(tip)}<span>${tip}</span></p>
    <div class="row">${S.scan ? '' : `<button class="chip" id="mCam">Camera ${S.camH} m</button>`}
    <button class="chip" id="mSet" ${S.mLines.length?'':'disabled'}>Set length</button><button class="chip" id="mClear" ${S.mLines.length||S.mPts.length?'':'disabled'}>Clear</button><button class="chip" id="mDone">Done</button></div>
    ${S.mSetting ? `<div class="row" style="margin-top:6px"><input id="mLen" class="nameinput" inputmode="decimal" placeholder="Real length of the last line, in metres" aria-label="Real length in metres"><button class="btn primary" id="mOk">Set</button></div>` : ''}`;
  bar.querySelectorAll('[data-say]').forEach(b=>b.addEventListener('click',()=>say(b.dataset.say)));
  if ($('#mCam')) $('#mCam').addEventListener('click',()=>{ const i=CAM_HEIGHTS.indexOf(S.camH); S.camH=CAM_HEIGHTS[(i+1)%CAM_HEIGHTS.length]; S.mLines=S.mLines.map(L=>L.taps?makeLine(...L.taps):L); renderMeasureBar(); renderMeasures(); });
  $('#mSet').addEventListener('click',()=>{ S.mSetting=!S.mSetting; renderMeasureBar(); });
  $('#mClear').addEventListener('click',()=>{ S.mLines=[]; S.mPts=[]; S.mScale=null; S.mCorr=1; renderMeasureBar(); renderMeasures(); });
  $('#mDone').addEventListener('click',()=>setMeasure(false));
  if ($('#mOk')) $('#mOk').addEventListener('click',()=>{ const v=parseFloat(($('#mLen').value||'').replace(',','.')), L=S.mLines[S.mLines.length-1];
    if (!(v>0) || !L || !L.m) return; S.mCorr = v/Math.abs(L.m); S.mSetting=false; renderMeasureBar(); renderMeasures(); });
}
// lines, ends and labels over the picture, redrawn with every view
function renderMeasures(){
  const box = $('#measures'); if (!box) return;
  if ((!S.mLines.length && !S.mPts.length && !S.measure) || !S.P){ box.innerHTML=''; return; }
  const ox=parseFloat(cv.style.left)||0, oy=parseFloat(cv.style.top)||0, W=S.cssW, H=S.cssH, P=p=>{ const s=project(p,W,H); return s ? [s[0]+ox, s[1]+oy] : null; };
  let svg = '';
  for (const L of S.mLines){ const a=P(L.a), b=P(L.b); if (!a||!b) continue; const mx=(a[0]+b[0])/2, my=(a[1]+b[1])/2;
    svg += `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" class="ml"/><circle cx="${a[0]}" cy="${a[1]}" r="4" class="me"/><circle cx="${b[0]}" cy="${b[1]}" r="4" class="me"/>`
      + `<text x="${mx}" y="${my-8}" class="mt">${esc(lineText(L))}</text>`;
  }
  for (const q of S.mPts){ const s=P(q.p); if (s) svg += `<circle cx="${s[0]}" cy="${s[1]}" r="5" class="me pending"/>`; }
  if (S.measure && !S.scan && S.photo){ const far=400, hz=horizonV(), l=P(unproject(-0.2,hz,far)), r=P(unproject(1.2,hz,far));
    if (l && r){ const hy = l[1] + (r[1]-l[1])*((ox+14-l[0])/((r[0]-l[0])||1));
      svg += `<line x1="${l[0]}" y1="${l[1]}" x2="${r[0]}" y2="${r[1]}" class="mhz"/><g class="mtag"><rect x="${ox+6}" y="${hy-13}" width="96" height="26" rx="13"/><text x="${ox+54}" y="${hy+5}">&#x21D5; eye level</text></g>`; } }
  box.innerHTML = `<svg width="100%" height="100%">${svg}</svg>`;
}
// the same, drawn into saved pictures and videos
function drawMeasures2D(x, W, H){
  if (!S.mLines.length) return;
  const fs=H*0.026; x.save(); x.font=`600 ${fs}px Archivo, "Helvetica Neue", Arial, sans-serif`; x.textAlign='center';
  for (const L of S.mLines){ const a=project(L.a,W,H), b=project(L.b,W,H); if (!a||!b) continue;
    x.strokeStyle='#fff'; x.lineWidth=Math.max(2,H*0.003); x.setLineDash([H*0.012,H*0.008]); x.beginPath(); x.moveTo(a[0],a[1]); x.lineTo(b[0],b[1]); x.stroke(); x.setLineDash([]);
    x.fillStyle='#72e8cb'; for (const s of [a,b]){ x.beginPath(); x.arc(s[0],s[1],H*0.006,0,7); x.fill(); }
    x.fillStyle='#fff'; x.shadowColor='rgba(0,0,0,.8)'; x.shadowBlur=fs*0.4; x.fillText(lineText(L),(a[0]+b[0])/2,(a[1]+b[1])/2-fs*0.5); x.shadowBlur=0; }
  x.restore();
}
$('#measureBtn').addEventListener('click', ()=>setMeasure(!S.measure));
// dragging near the eye-level line moves it (instead of turning the view); the move is converted from
// screen pixels to the photo's own rows
let hzDrag = null;
cv.addEventListener('pointerdown', e=>{ if (!S.measure || S.scan || !S.photo || !S.P) return;
  // only the eye-level tag at the left starts a drag, so taps near the line still measure
  const r=cv.getBoundingClientRect(), x=e.clientX-r.left, y=e.clientY-r.top, s=project(unproject(0,horizonV(),400), S.cssW, S.cssH);
  if (s && x < 110 && Math.abs(y-s[1]) < 18){ hzDrag = {y0:e.clientY, v0:horizonV()}; e.stopImmediatePropagation(); try{ cv.setPointerCapture(e.pointerId); }catch(err){} } }, true);
cv.addEventListener('pointermove', e=>{ if (!hzDrag) return; e.stopImmediatePropagation();
  const dv = (e.clientY-hzDrag.y0)/S.cssH * viewTan(S.cssW/S.cssH)/S.tanV / Math.max(0.3, S.zoom);
  S.hzV = Math.max(0.05, Math.min(0.95, hzDrag.v0 + dv)); S.mLines = S.mLines.map(L=>L.taps?makeLine(...L.taps):L); renderMeasures(); }, true);
cv.addEventListener('pointerup', e=>{ if (!hzDrag) return; e.stopImmediatePropagation(); hzDrag = null; renderMeasureBar(); }, true);
