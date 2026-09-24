// ---------------------------------------------------------------- interface
const ICON_SAY = '<svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16 9a4 4 0 0 1 0 6"/><path d="M18.5 6.5a8 8 0 0 1 0 11"/></svg>';
const sayBtn = text => `<button class="say" data-say="${text.replace(/"/g,'&quot;')}" aria-label="Read aloud">${ICON_SAY}</button>`;
const esc = s => String(s).replace(/[&<>"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

// ---------------------------------------------------------------- undo
let undoArmed = true;
function snapshot(){ return {P:{...P}, look, picks:S.picks.map(p=>({...p})), band:S.band, shape:S.shape}; }
function pushUndo(){ if (!undoArmed) return; S.undo.push(snapshot()); if (S.undo.length>40) S.undo.shift(); undoArmed=false; }
function commit(){ undoArmed = true; persist(); renderTray(); }
function undo(){
  const s = S.undo.pop(); if (!s) return;
  Object.assign(P, s.P); look=s.look; S.picks=s.picks; S.band=s.band;
  if (s.shape!==S.shape){ S.shape=s.shape; layout(); }
  S.dirtyBuild=true; undoArmed=true; persist(); renderTray(); banner(modeText());
}
function persist(){ store('state', {P, look, shape:S.shape}); }
function isCustom(){ const L=LOOKS[look]; return LOOK_KEYS.some(k=>typeof L[k]==='number' ? Math.abs(L[k]-P[k])>0.02 : L[k]!==P[k]); }

function applyLook(name, keepView){
  pushUndo(); look=name; const L=LOOKS[name];
  LOOK_KEYS.forEach(k=>{ P[k]=L[k]; });
  if (!keepView){ S.yaw=L.yaw; S.pitch=L.pitch; S.zoom=L.zoom; S.pan=[0,0,0]; S.userMoved=false; }
  S.dirtyBuild=true; commit(); viewButton();
}

// ---------------------------------------------------------------- tabs and trays
function setTab(t){
  if (S.tab===t && !WIDE()) t=null;             // on a phone, tapping the open tab closes its tray
  S.tab=t; if (t!=='people' && (S.placing==='face'||S.placing==='label')) S.placing=false;
  document.querySelectorAll('.tab').forEach(b=>b.setAttribute('aria-selected', b.dataset.tab===t));
  $('#tray').hidden = !t; $('#stage').classList.toggle('picking', t==='subject' || !!S.placing);
  renderTray(); banner(modeText()); S.dirtyDraw=true; renderPins();
  requestAnimationFrame(layout);
  if (t) store('tab', t);
}
document.querySelectorAll('.tab').forEach(b=>b.addEventListener('click', ()=>setTab(b.dataset.tab)));

function modeText(){
  if (S.placing==='face') return 'Tap a face to cover it.';
  if (S.placing==='label') return 'Tap a person or thing to name it.';
  if (S.tab==='subject') return S.picks.length ? 'Tap more things to add them. Tap a ring to remove it.' : 'Tap what matters in the picture.';
  if (S.panMode) return 'Drag to slide the view. Double tap a spot to centre on it.';
  return '';
}

function renderTray(){
  const tr=$('#tray'); if (!S.tab){ tr.innerHTML=''; return; }
  const undoBtn = `<button class="chip" id="undoBtn" ${S.undo.length?'':'disabled'}>Undo</button>`;
  if (S.tab==='look'){
    tr.innerHTML = `<h3>Look ${isCustom()?'<span class="chip" style="padding:3px 8px;font-size:11px;letter-spacing:0;text-transform:none;color:var(--accent);border-color:var(--accent)">Custom</span>':''}<span class="sp"></span></h3>
      <div class="looks">${Object.entries(LOOKS).map(([k,L])=>`<button class="look" data-look="${k}" aria-pressed="${k===look}"><canvas id="thumb-${k}" width="208" height="156"></canvas><b>${L.name}</b></button>`).join('')}</div>
      <div class="sect"><h3>Dot pattern</h3><div class="scroller">${[['scatter','Scatter'],['rings','Scan rings'],['grid','Grid']].map(([v,n])=>`<button class="chip" data-pattern="${v}" aria-pressed="${P.pattern===v}">${n}</button>`).join('')}</div></div>
      <div class="sect row"><button class="chip" id="resetLook" ${isCustom()?'':'disabled'}>Reset look</button>${undoBtn}</div>`;
    tr.querySelectorAll('.look').forEach(b=>b.addEventListener('click',()=>applyLook(b.dataset.look)));
    tr.querySelectorAll('[data-pattern]').forEach(b=>b.addEventListener('click',()=>{ pushUndo(); P.pattern=b.dataset.pattern; S.dirtyBuild=true; commit(); }));
    $('#resetLook').addEventListener('click',()=>applyLook(look, true));
    paintThumbs();
  }
  else if (S.tab==='adjust'){
    const c = CTRL[S.ctrl];
    let body;
    if (c.chips){
      body = `<div class="scroller" style="margin-top:12px">${c.chips.map(([v,n])=>`<button class="chip ${LOOKS[look].colour===v?'def':''}" data-colour="${v}" aria-pressed="${P.colour===v}">${n}</button>`).join('')}</div>`;
    } else {
      const near = Math.round(P[c.key]), def = Math.round(LOOKS[look][c.key]);
      body = `<div class="stepper"><input type="range" id="ctl" min="0" max="${c.stops.length-1}" step="0.05" value="${P[c.key]}" aria-label="${c.name}">
        <div class="stops">${c.stops.map(([n],i)=>`<button data-stop="${i}" aria-current="${Math.abs(P[c.key]-i)<0.15}" class="${i===def?'def':''}">${n}${i===def?' ·':''}</button>`).join('')}</div></div>`;
    }
    tr.innerHTML = `<div class="scroller">${CONTROLS.map(k=>`<button class="chip" data-ctrl="${k.key}" aria-pressed="${k.key===S.ctrl}">${k.name}</button>`).join('')}</div>
      ${body}<p class="hint">${sayBtn(c.hint)}<span>${c.hint}</span></p>
      <div class="sect row">${undoBtn}</div>`;
    tr.querySelectorAll('[data-ctrl]').forEach(b=>b.addEventListener('click',()=>{ S.ctrl=b.dataset.ctrl; renderTray(); }));
    tr.querySelectorAll('[data-colour]').forEach(b=>b.addEventListener('click',()=>{ pushUndo(); P.colour=b.dataset.colour; S.dirtyDraw=true; commit(); }));
    const r = $('#ctl');
    if (r){
      r.addEventListener('input', ()=>{ pushUndo(); P[c.key]=+r.value; if (c.rebuild){ S.lowDetail=true; S.dirtyBuild=true; } S.dirtyDraw=true; markStops(c); });
      r.addEventListener('change', ()=>{ if (c.rebuild){ S.lowDetail=false; S.dirtyBuild=true; } commit(); });
      tr.querySelectorAll('[data-stop]').forEach(b=>b.addEventListener('click',()=>{ pushUndo(); P[c.key]=+b.dataset.stop; if (c.rebuild){ S.lowDetail=false; S.dirtyBuild=true; } S.dirtyDraw=true; commit(); }));
    }
  }
  else if (S.tab==='subject'){
    tr.innerHTML = `<p class="hint" style="margin:0 0 10px">${sayBtn('Tap the thing that matters in the picture. It becomes the subject, even if something else is nearer. Tap more things to add them.')}<span>Tap the thing that matters. It becomes the subject, even if something else is nearer.</span></p>
      <div class="scroller"><button class="chip" id="autoSub" aria-pressed="${!S.picks.length}">Auto</button>
      ${['Tighter','Normal','Looser'].map((n,i)=>`<button class="chip" data-band="${i}" aria-pressed="${S.band===i}">${n}</button>`).join('')}
      <button class="chip" id="sharp" aria-pressed="${!!S.sharp}">Sharper outline</button>${undoBtn}</div>
      <p class="hint">${S.sharp?'Uses an outline finder (18 MB, first time only) for cleaner edges.':'Tighter keeps only what sits at the same depth as your tap. Looser takes in more.'}</p>`;
    $('#autoSub').addEventListener('click',()=>{ pushUndo(); S.picks=[]; S.dirtyBuild=true; commit(); banner(modeText()); });
    tr.querySelectorAll('[data-band]').forEach(b=>b.addEventListener('click',()=>{ pushUndo(); S.band=+b.dataset.band; S.dirtyBuild=true; commit(); }));
    $('#sharp').addEventListener('click', async ()=>{ S.sharp=!S.sharp; renderTray();
      if (S.sharp && S.picks.length){ for (const p of S.picks) if (!p.seg) p.seg = await outlineFor(p.u,p.v); S.dirtyBuild=true; }
      if (S.sharp && segFailed){ S.sharp=false; banner('The outline finder could not start here. Depth alone is being used.'); renderTray(); } });
  }
  else if (S.tab==='move'){
    const mv = S.move||'push', len = S.moveLen||6;
    tr.innerHTML = `<div class="scroller">${[['push','Push in'],['orbit','Orbit'],['drift','Drift'],['rise','Rise']].map(([v,n])=>`<button class="chip" data-move="${v}" aria-pressed="${mv===v}">${n}</button>`).join('')}</div>
      <div class="scroller" style="margin-top:8px">${[4,6,10].map(s=>`<button class="chip" data-len="${s}" aria-pressed="${len===s}">${s} seconds</button>`).join('')}</div>
      <div class="sect row"><button class="btn" id="playMove">Play</button><button class="btn rec" id="recMove">Record video</button></div>
      <p class="hint">${sayBtn('The move starts from the view on screen, so line it up first.')}<span>Starts from the view on screen, so line it up first.</span></p>`;
    tr.querySelectorAll('[data-move]').forEach(b=>b.addEventListener('click',()=>{ S.move=b.dataset.move; renderTray(); previewMove(S.move, Math.min(4,S.moveLen||6)); }));
    tr.querySelectorAll('[data-len]').forEach(b=>b.addEventListener('click',()=>{ S.moveLen=+b.dataset.len; renderTray(); }));
    $('#playMove').addEventListener('click',()=>previewMove(S.move||'push', S.moveLen||6));
    $('#recMove').addEventListener('click',()=>recordMove(S.move||'push', S.moveLen||6));
  }
  else if (S.tab==='people'){
    const auto=S.faces.filter(f=>f.auto).length, hand=S.faces.length-auto;
    const status = !S.anon ? 'Faces are shown as they are.' : `${auto?`Found ${auto} face${auto===1?'':'s'}.`:'No faces found by itself.'}${hand?` ${hand} covered by hand.`:''}`;
    tr.innerHTML = `<h3>Faces</h3>
      <div class="scroller"><button class="chip" id="anon" aria-pressed="${S.anon}">Hide faces</button>
      ${['Light','Medium','Strong'].map((n,i)=>`<button class="chip" data-level="${i}" aria-pressed="${S.anon&&S.anonLevel===i}">${n}</button>`).join('')}
      <button class="chip" id="addFace" aria-pressed="${S.placing==='face'}">+ Face</button>${S.faces.length?'<button class="chip" id="clearFaces">Clear</button>':''}</div>
      <p class="hint">${sayBtn(status+' Hair, clothes and the setting can still identify someone.')}<span>${status}</span></p>
      <div class="sect"><h3>Names</h3><div class="row"><button class="chip" id="addLabel" aria-pressed="${S.placing==='label'}">+ Name</button></div>
      <div class="lablist">${S.labels.map((L,i)=>`<div><input id="label-${i}" value="${esc(L.text)}" placeholder="Name" aria-label="Name"><button class="chip" data-del="${i}">Remove</button></div>`).join('')}</div></div>`;
    $('#anon').addEventListener('click', async ()=>{ S.anon=!S.anon; if (S.anon && !S.facesFound) await findFaces(); applyAnon(); invalidateCompare(); renderTray(); });
    tr.querySelectorAll('[data-level]').forEach(b=>b.addEventListener('click', async ()=>{ S.anonLevel=+b.dataset.level; if (!S.anon){ S.anon=true; if (!S.facesFound) await findFaces(); } applyAnon(); invalidateCompare(); renderTray(); }));
    $('#addFace').addEventListener('click',()=>{ S.placing = S.placing==='face' ? false : 'face'; setTab('people'); });
    const cf=$('#clearFaces'); if (cf) cf.addEventListener('click',()=>{ S.faces=[]; S.facesFound=false; S.anon=false; applyAnon(); invalidateCompare(); renderTray(); });
    $('#addLabel').addEventListener('click',()=>{ S.placing = S.placing==='label' ? false : 'label'; setTab('people'); });
    S.labels.forEach((L,i)=>{ $('#label-'+i).addEventListener('input',e=>{ L.text=e.target.value; S.dirtyDraw=true; }); });
    tr.querySelectorAll('[data-del]').forEach(b=>b.addEventListener('click',()=>{ S.labels.splice(+b.dataset.del,1); renderTray(); S.dirtyDraw=true; }));
  }
  tr.querySelectorAll('.scroller [aria-pressed="true"]').forEach(b=>{ const sc=b.parentElement; sc.scrollLeft = b.offsetLeft - sc.clientWidth/2 + b.offsetWidth/2; });
  const u=$('#undoBtn'); if (u) u.addEventListener('click', undo);
  tr.querySelectorAll('[data-say]').forEach(b=>b.addEventListener('click',()=>say(b.dataset.say)));
}
function markStops(c){ document.querySelectorAll('[data-stop]').forEach(b=>b.setAttribute('aria-current', Math.abs(P[c.key]-(+b.dataset.stop))<0.15)); }

// ---------------------------------------------------------------- look thumbnails, drawn from your own photo
let thumbsFor = null, thumbJob = 0;
function queueThumbs(){ thumbsFor = null; const job=++thumbJob; setTimeout(()=>makeThumbs(job), 400); }
function makeThumbs(job){
  if (job!==thumbJob) return;
  if (!gl || !G || !S.photo || !S.compMap || S.dirtyBuild){ setTimeout(()=>makeThumbs(job), 300); return; }
  const keys = Object.keys(LOOKS); const out = {};
  const next = i => {
    if (job!==thumbJob) return;
    if (i>=keys.length){ thumbsFor = out; paintThumbs(); return; }
    const k=keys[i], L=LOOKS[k];
    const R = buildCloud({dots:CTRL.dots.stops[Math.round(Math.min(2,L.dots))][1], backdrop:CTRL.backdrop.stops[Math.round(L.backdrop)][1],
      floor:CTRL.floor.stops[Math.round(L.floor)][1], pattern:L.pattern, bgTint:L.bgTint, cap:60000});
    uploadCloud(R.out, R.n, 'thumb');
    const tw=208, th=156;
    if (cv.width>=tw && cv.height>=th){
      renderView(tw, th, {cloud:G.clouds.thumb, look:k, colour:L.colour, size:CTRL.size.stops[Math.round(L.size)][1]*1.3, bright:val2('bright',L.bright)*1.5,
        glow:val2('glow',L.glow), edges:val2('edges',L.edges), yaw:L.yaw, pitch:L.pitch, zoom:Math.max(1, L.zoom*0.78), thumb:true, targetKey:'thumb'});
      const c=document.createElement('canvas'); c.width=tw; c.height=th; c.getContext('2d').drawImage(cv, 0, cv.height-th, tw, th, 0, 0, tw, th);
      out[k]=c; S.dirtyDraw=true;
    }
    setTimeout(()=>next(i+1), 30);
  };
  next(0);
}
function val2(key, pos){ const c=CTRL[key], p=Math.max(0,Math.min(c.stops.length-1,pos)), i=Math.min(c.stops.length-2,Math.floor(p)), f=p-i; return c.stops[i][1]*(1-f)+c.stops[i+1][1]*f; }
function paintThumbs(){ if (!thumbsFor) return; for (const k in thumbsFor){ const el=$('#thumb-'+k); if (el) el.getContext('2d').drawImage(thumbsFor[k],0,0); } }

// ---------------------------------------------------------------- picture: layout, labels, pins
function layout(){
  const st=$('#stage').getBoundingClientRect(); if (!st.width || !st.height) return;
  const a=frameAspect(); let w=st.width, h=w/a; if (h>st.height){ h=st.height; w=h*a; }
  cv.style.width=w+'px'; cv.style.height=h+'px'; cv.style.left=(st.width-w)/2+'px'; cv.style.top=(st.height-h)/2+'px';
  let dpr=Math.min(devicePixelRatio||1, 2); const maxPx = MOBILE ? 2.4e6 : 5e6;
  if (w*h*dpr*dpr > maxPx) dpr=Math.sqrt(maxPx/(w*h));
  if (!S.recording){ cv.width=Math.max(1,Math.round(w*dpr)); cv.height=Math.max(1,Math.round(h*dpr)); }
  S.cssW=w; S.cssH=h; S.dirtyDraw=true;
}
new ResizeObserver(()=>layout()).observe($('#stage'));
function project(p, W, H){ const c=M4.xf(M4.mul(S.P, S.V), p); if (c[3]<=0) return null; return [(c[0]*.5+.5)*W, (1-(c[1]*.5+.5))*H]; }
function labelWorld(L){ const p=unproject(L.u, L.v, zOf(depthAt(L.u,L.v))); return [p[0], p[1]+L.lift, p[2]]; }
function refreshLabelPositions(){ S.labels.forEach(L=>{ L.pos=labelWorld(L); }); }
function renderLabels(){
  const box=$('#labels'), fs=Math.max(11, S.cssH*0.03);
  while (box.children.length > S.labels.length) box.lastChild.remove();
  while (box.children.length < S.labels.length) box.appendChild(document.createElement('div')).className='lbl';
  const ox=parseFloat(cv.style.left), oy=parseFloat(cv.style.top);
  S.labels.forEach((L,i)=>{ const el=box.children[i], s=L.pos&&S.P&&project(L.pos,S.cssW,S.cssH); el.hidden=!s||!L.text; if(!s) return;
    el.textContent=L.text; el.style.fontSize=fs+'px'; el.style.left=(ox+s[0])+'px'; el.style.top=(oy+s[1])+'px'; });
}
function renderPins(){
  const box=$('#pins'); box.innerHTML='';
  if (S.tab!=='subject' || !S.depth || !S.P) return;
  const ox=parseFloat(cv.style.left), oy=parseFloat(cv.style.top);
  S.picks.forEach(p=>{ const s=project(unproject(p.u,p.v,zOf(depthAt(p.u,p.v))), S.cssW, S.cssH); if (!s) return;
    const d=document.createElement('div'); d.className='pin'; d.style.left=(ox+s[0])+'px'; d.style.top=(oy+s[1])+'px'; box.appendChild(d); p.sx=s[0]; p.sy=s[1]; });
}

// nearest drawn point to a tap, for picking what was tapped in any view
function pickPoint(cx, cy){
  if (!S.count) return null;
  const MV=M4.mul(S.P,S.V), out=S.cpu; let best=1e9, bi=-1;
  const step=Math.max(1, Math.floor(S.count/250000));
  for (let i=0;i<S.count;i+=step){ const o=i*10; if (out[o+6]===2) continue; const c=M4.xf(MV,[out[o],out[o+1],out[o+2]]); if (c[3]<=0) continue;
    const sx=(c[0]*.5+.5)*S.cssW, sy=(1-(c[1]*.5+.5))*S.cssH, dd=(sx-cx)**2+(sy-cy)**2; if (dd<best){best=dd; bi=i;} }
  if (bi<0 || best > 44*44) return null;
  const o=bi*10, uv=uvOf([out[o],out[o+1],out[o+2]]);
  return {u:uv[0], v:uv[1], comp:S.cpuComp[bi], p:[out[o],out[o+1],out[o+2]]};
}
async function onTap(cx, cy){
  if (S.tab==='subject'){
    const hit = S.picks.findIndex(p=>p.sx!=null && Math.hypot(p.sx-cx,p.sy-cy)<22);
    pushUndo();
    if (hit>=0){ S.picks.splice(hit,1); }
    else {
      // tapping in photo view maps straight to the photo; otherwise use the nearest point
      let u, v;
      if (Math.abs(S.yaw)<0.5 && Math.abs(S.pitch)<0.5 && Math.abs(S.zoom-1)<0.01 && frameAspect()===S.photo.w/S.photo.h){ u=cx/S.cssW; v=cy/S.cssH; }
      else { const p=pickPoint(cx,cy); if (!p){ undoArmed=true; S.undo.pop(); return; } u=p.u; v=p.v; }
      const pick={u,v}; if (S.sharp) pick.seg = await outlineFor(u,v);
      S.picks.push(pick); if (S.picks.length>4) S.picks.shift();
    }
    S.dirtyBuild=true; commit(); banner(modeText()); return;
  }
  if (S.placing==='face'){ const p=pickPoint(cx,cy); if (!p) return; addFaceAt(p.u, p.v, p.comp); invalidateCompare(); S.placing=false; setTab('people'); return; }
  if (S.placing==='label'){ const p=pickPoint(cx,cy); if (!p) return;
    const c=S.comps.find(k=>k.id===p.comp);
    const L = c ? {u:c.topUV[0], v:c.topUV[1], lift:(c.maxY-c.minY)*0.07, text:''} : {u:p.u, v:p.v, lift:0.06, text:''};
    L.pos=labelWorld(L); S.labels.push(L); S.placing=false; setTab('people');
    const inp=$('#label-'+(S.labels.length-1)); if (inp) inp.focus(); S.dirtyDraw=true; }
}

// ---------------------------------------------------------------- gestures
// ---------------------------------------------------------------- panning and the centre of turning
function rotOnly(){ return M4.mul(M4.rx(S.pitch*Math.PI/180), M4.ry(S.yaw*Math.PI/180)); }
// Move the pivot to t without changing what is on screen, by folding the difference into the pan.
function setPivotKeepingView(t){
  const V = viewMatrix(S.yaw,S.pitch,S.zoom,S.pivot,S.pan), T=[V[12],V[13],V[14]], Rt = M4.xf(rotOnly(), t), back=(S.zoom-1)*S.refDist;
  S.pan = [t[0]-Rt[0]-T[0], t[1]-Rt[1]-T[1], t[2]-Rt[2]-T[2]-back]; S.pivot = t.slice();
}
// After a slide, turn about whatever is now in the middle of the screen, at the old pivot's depth.
function recentrePivot(){
  const V = viewMatrix(S.yaw,S.pitch,S.zoom,S.pivot,S.pan), pv = M4.xf(V, S.pivot), T=[V[12],V[13],V[14]];
  const c = [0-T[0], 0-T[1], pv[2]-T[2]], Rinv = M4.mul(M4.ry(-S.yaw*Math.PI/180), M4.rx(-S.pitch*Math.PI/180));
  setPivotKeepingView(M4.xf(Rinv, c));
}
function panBy(dx, dy){
  const V = viewMatrix(S.yaw,S.pitch,S.zoom,S.pivot,S.pan), depth = Math.max(0.2, -M4.xf(V, S.pivot)[2]);
  const k = 2*viewTan(S.cssW/S.cssH)*depth/S.cssH;
  S.pan[0] -= dx*k; S.pan[1] += dy*k; S.userMoved = true; S.dirtyDraw = true; didPan = true; viewButton();
}
let glide = 0;
function centreOn(p){
  // glide the tapped point to the middle of the screen, then make it the centre of turning
  setPivotKeepingView(p);
  const V = viewMatrix(S.yaw,S.pitch,S.zoom,S.pivot,S.pan), pv = M4.xf(V, p);
  const from = S.pan.slice(), to = [S.pan[0]+pv[0], S.pan[1]+pv[1], S.pan[2]], job = ++glide;
  S.userMoved = true; viewButton();
  if (matchMedia('(prefers-reduced-motion:reduce)').matches){ S.pan = to; S.dirtyDraw = true; return; }
  const t0 = performance.now();
  const step = () => { if (job!==glide) return; const t = Math.min(1,(performance.now()-t0)/260), e = t*t*(3-2*t);
    S.pan = from.map((f,i)=>f+(to[i]-f)*e); S.dirtyDraw = true; if (t<1) requestAnimationFrame(step); else S.pan = to; };
  requestAnimationFrame(step);
}

const ptrs=new Map(); let pinch0=0, zoom0=1, moved=0, lastTap=0, mid0=null, panDrag=false, didPan=false;
const midOf = () => { const v=[...ptrs.values()]; return [(v[0].x+v[1].x)/2, (v[0].y+v[1].y)/2]; };
cv.addEventListener('contextmenu', e=>e.preventDefault());
cv.addEventListener('pointerdown', e=>{ try { cv.setPointerCapture(e.pointerId); } catch(err){} if (!ptrs.size) didPan=false; ptrs.set(e.pointerId,{x:e.clientX,y:e.clientY}); moved=0; glide++;
  // pan with the Pan button on, a right or middle mouse button, or Shift held
  panDrag = S.panMode || e.button===1 || e.button===2 || e.shiftKey;
  if (ptrs.size===2){ const [a,b]=[...ptrs.values()]; pinch0=Math.hypot(a.x-b.x,a.y-b.y); zoom0=S.zoom; mid0=midOf(); } });
cv.addEventListener('pointermove', e=>{ const p=ptrs.get(e.pointerId); if(!p || S.recording) return;
  const dx=e.clientX-p.x, dy=e.clientY-p.y; p.x=e.clientX; p.y=e.clientY; moved+=Math.abs(dx)+Math.abs(dy);
  if (moved<8) return;
  if (ptrs.size===1){ if (panDrag) panBy(dx, dy); else { S.yaw+=dx*0.35; S.pitch=Math.max(-80,Math.min(80,S.pitch+dy*0.3)); } }
  else if (ptrs.size===2){ const [a,b]=[...ptrs.values()]; const d=Math.hypot(a.x-b.x,a.y-b.y); if (pinch0) S.zoom=Math.max(0.35,Math.min(5,zoom0*pinch0/d));
    // two fingers moving together slide the view
    const m=midOf(); if (mid0){ panBy(m[0]-mid0[0], m[1]-mid0[1]); } mid0=m; }
  S.dirtyDraw=true; viewButton(); });
cv.addEventListener('pointerup', e=>{
  if (ptrs.size===1 && moved<8){ const r=cv.getBoundingClientRect(), now=performance.now(), cx=e.clientX-r.left, cy=e.clientY-r.top;
    if (S.tab!=='subject' && !S.placing && now-lastTap<320){ const hit=pickPoint(cx,cy); if (hit) centreOn(hit.p); lastTap=0; }
    else { lastTap=now; onTap(cx, cy); } }
  ptrs.delete(e.pointerId); pinch0=0; mid0 = ptrs.size===2 ? midOf() : null;
  if (didPan && ptrs.size===0){ recentrePivot(); didPan=false; } });
cv.addEventListener('pointercancel', e=>{ ptrs.delete(e.pointerId); mid0=null; });
cv.addEventListener('wheel', e=>{ e.preventDefault(); S.zoom=Math.max(0.35,Math.min(5,S.zoom*Math.exp(e.deltaY*0.001))); S.dirtyDraw=true; viewButton(); }, {passive:false});
cv.addEventListener('keydown', e=>{ const k={ArrowLeft:[-4,0],ArrowRight:[4,0],ArrowUp:[0,-4],ArrowDown:[0,4]}[e.key]; if(!k) return; e.preventDefault();
  if (e.shiftKey){ panBy(-k[0]*6, -k[1]*6); recentrePivot(); return; }
  S.yaw+=k[0]; S.pitch=Math.max(-80,Math.min(80,S.pitch+k[1])); S.dirtyDraw=true; viewButton(); });

// ---------------------------------------------------------------- picture buttons
function viewButton(){ const L=LOOKS[look]; $('#photoView').hidden = !(S.userMoved||Math.abs(S.yaw-L.yaw)>0.5||Math.abs(S.pitch-L.pitch)>0.5||Math.abs(S.zoom-L.zoom)>0.01); }
function resetView(){ const L=LOOKS[look]; glide++; S.yaw=L.yaw; S.pitch=L.pitch; S.zoom=L.zoom; S.pivot=S.target.slice(); S.pan=[0,0,0]; S.userMoved=false; S.spin=false; syncSpin(); S.dirtyDraw=true; viewButton(); }
function syncSpin(){ $('#spin').setAttribute('aria-pressed', S.spin); }
$('#photoView').addEventListener('click', resetView);
$('#spin').addEventListener('click', ()=>{ S.spin=!S.spin; syncSpin(); });
$('#panBtn').addEventListener('click', ()=>{ S.panMode=!S.panMode; $('#panBtn').setAttribute('aria-pressed', S.panMode); banner(modeText()); });
let compareURL=null;
function invalidateCompare(){ if (compareURL){ URL.revokeObjectURL(compareURL); compareURL=null; } }
async function showCompare(on){
  const im=$('#compare');
  if (!on || !S.photo){ im.hidden=true; return; }
  if (!compareURL){ const c=document.createElement('canvas'); c.width=S.photo.w; c.height=S.photo.h; c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(S.photo.data),S.photo.w,S.photo.h),0,0);
    compareURL = URL.createObjectURL(await new Promise(r=>c.toBlob(r,'image/jpeg',0.9))); }
  const pa=S.photo.w/S.photo.h, fa=frameAspect(); let w=S.cssW, h=S.cssH;
  if (fa>pa) w=h*pa; else h=w/pa;
  Object.assign(im.style, {width:w+'px', height:h+'px', left:(parseFloat(cv.style.left)+(S.cssW-w)/2)+'px', top:(parseFloat(cv.style.top)+(S.cssH-h)/2)+'px'});
  im.src=compareURL; im.hidden=false;
}
const cb=$('#compareBtn');
cb.addEventListener('pointerdown', e=>{ e.preventDefault(); showCompare(true); });
['pointerup','pointerleave','pointercancel'].forEach(ev=>cb.addEventListener(ev, ()=>showCompare(false)));
cb.addEventListener('contextmenu', e=>e.preventDefault());

// ---------------------------------------------------------------- top bar menus
function menu(btn, id, items){
  const m=$(id), open=m.hidden;
  document.querySelectorAll('.menu').forEach(x=>x.hidden=true); document.querySelectorAll('.tb[aria-haspopup]').forEach(b=>b.setAttribute('aria-expanded','false'));
  if (!open) return;
  m.innerHTML = items.map(([v,n,sub,on])=>`<button data-v="${v}" aria-pressed="${!!on}">${n}${sub?`<small>${sub}</small>`:''}</button>`).join('');
  const r=btn.getBoundingClientRect(); m.style.top=(r.bottom+6)+'px'; m.style.left=Math.max(8,Math.min(innerWidth-210, r.left-60))+'px';
  m.hidden=false; btn.setAttribute('aria-expanded','true');
  return m;
}
$('#shapeBtn').addEventListener('click', e=>{ e.stopPropagation();
  const m=menu($('#shapeBtn'), '#shapeMenu', [['photo','Same as the photo','',S.shape==='photo'],['wide','Wide','16 by 9',S.shape==='wide'],['square','Square','',S.shape==='square'],['tall','Tall','9 by 16, for stories',S.shape==='tall']]);
  if (m) m.querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>{ pushUndo(); S.shape=b.dataset.v; commit(); layout(); m.hidden=true; $('#shapeBtn').setAttribute('aria-expanded','false'); })); });
$('#saveBtn').addEventListener('click', e=>{ e.stopPropagation();
  const m=menu($('#saveBtn'), '#saveMenu', [['png','Picture','PNG, full size'],['video','Video','Opens camera moves'],['ply','3D points','PLY file for Blender, MeshLab']]);
  if (m) m.querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>{ m.hidden=true; $('#saveBtn').setAttribute('aria-expanded','false');
    if (b.dataset.v==='png') savePicture(); else if (b.dataset.v==='ply') savePly(); else setTab('move'); })); });
document.addEventListener('click', ()=>{ document.querySelectorAll('.menu').forEach(x=>x.hidden=true); document.querySelectorAll('.tb[aria-haspopup]').forEach(b=>b.setAttribute('aria-expanded','false')); });
$('#infoBtn').addEventListener('click', e=>{ e.stopPropagation(); const i=$('#info'); i.hidden=!i.hidden; $('#infoBtn').setAttribute('aria-expanded', !i.hidden);
  if (!i.hidden){ const text='First Return turns a photo into a lidar style point cloud. Depth is worked out on your device, and the photo never leaves it.';
    i.innerHTML = `<p style="display:flex;gap:8px;align-items:center">${sayBtn(text)}<b>${text}</b></p>
      <p>${S.count.toLocaleString()} dots. ${S.nComp} subject${S.nComp===1?'':'s'}. Camera view: ${esc(S.fovSource)}.${S.plane?' Floor found in the photo.':''}</p>
      <p>${esc(S.credit||'')}</p><p>Depth: Depth Anything V2 Small (Apache 2.0). Outlines: MediaPipe Magic Touch (Apache 2.0). Faces: UltraFace (MIT). Runtime: ONNX Runtime Web (MIT).</p>
      <button class="btn" id="infoClose">Close</button>`;
    $('#infoClose').addEventListener('click',()=>{ i.hidden=true; });
    i.querySelectorAll('[data-say]').forEach(b=>b.addEventListener('click',()=>say(b.dataset.say))); } });
$('#info').addEventListener('click', e=>e.stopPropagation());

// ---------------------------------------------------------------- opening a photo
async function setPhoto(ph, D, credit){
  S.photoCanvas=ph.canvas; S.photoSrc=S.photo={w:ph.w,h:ph.h,data:ph.data}; S.tanV=ph.fov.tanV; S.fovSource=ph.fov.src; S.credit=credit||'';
  invalidateCompare();
  busy('Sharpening the depth edges', null); await tick();
  S.depthSrc=S.depth=refineDepth(D, ph.canvas);
  S.plane=fitFloor(S.depth); S.ground=groundMask(S.depth, S.plane); S.shiftAuto=estimateShift(S.plane); S.autoCut=otsu(S.depth.d, S.ground);
  S.picks=[]; S.labels=[]; S.faces=[]; S.facesFound=false; S.faceMask=null;
  if (S.anon){ await findFaces(); applyAnon(); }
  const L=LOOKS[look]; S.yaw=L.yaw; S.pitch=L.pitch; S.zoom=L.zoom; S.pan=[0,0,0]; S.userMoved=false; viewButton();
  busy(null); layout(); S.dirtyBuild=true; renderTray(); queueThumbs();
}
$('#file').addEventListener('change', async e=>{
  const f=e.target.files[0]; if (!f) return; e.target.value='';
  try { busy('Opening the photo', null); await tick();
    const ph = await decodePhoto(f);
    const raw = await estimateDepth(ph.canvas);
    await setPhoto(ph, normaliseDepth(raw), 'Your photo stayed on this device.');
  } catch(err){ console.error(err); busy(null); banner('Could not read that photo: '+(err.message||err)); }
});

// ---------------------------------------------------------------- main loop
function frame(){
  if (gl && G){
    if (S.dirtyBuild && !S.recording) build();
    if (S.spin && !S.recording){ S.yaw+=0.25; S.dirtyDraw=true; viewButton(); }
    if (S.dirtyDraw && !S.recording){ S.dirtyDraw=false; draw(); renderLabels(); renderPins(); }
  }
  requestAnimationFrame(frame);
}
