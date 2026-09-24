// ---------------------------------------------------------------- interface
const ICON_SAY = '<svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16 9a4 4 0 0 1 0 6"/><path d="M18.5 6.5a8 8 0 0 1 0 11"/></svg>';
const sayBtn = text => `<button class="say" data-say="${text.replace(/"/g,'&quot;')}" aria-label="Read aloud">${ICON_SAY}</button>`;
const esc = s => String(s).replace(/[&<>"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

// ---------------------------------------------------------------- undo
let undoArmed = true;
function snapshot(){ return {P:{...P}, look, picks:S.picks.map(p=>({...p})), band:S.band, shape:S.shape, level:S.level}; }
function pushUndo(){ if (!undoArmed) return; S.undo.push(snapshot()); if (S.undo.length>40) S.undo.shift(); undoArmed=false; }
function commit(){ undoArmed = true; persist(); renderTray(); }
function undo(){
  const s = S.undo.pop(); if (!s) return;
  Object.assign(P, s.P); look=s.look; S.picks=s.picks; S.band=s.band;
  if (s.shape!==S.shape){ S.shape=s.shape; layout(); }
  if (s.level!==S.level){ S.level=s.level; S.roll = S.level ? S.rollAuto : 0; }
  S.dirtyBuild=true; undoArmed=true; persist(); renderTray(); banner(modeText());
}
function persist(){ store('state', {P, look, shape:S.shape, level:S.level}); }
function isCustom(){ const L=LOOKS[look]; return LOOK_KEYS.some(k=>typeof L[k]==='number' ? Math.abs(L[k]-P[k])>0.02 : L[k]!==P[k]); }

function applyLook(name, keepView){
  pushUndo(); look=name; const L=LOOKS[name];
  LOOK_KEYS.forEach(k=>{ P[k]=L[k]; });
  if (keepView) P.light = S.lightAuto;          // Reset look also returns Light to what the photo needed
  if (!keepView){ S.yaw=L.yaw; S.pitch=L.pitch; S.zoom=L.zoom; S.pan=[0,0,0]; S.userMoved=false; S.home=null; S.reframe = L.bgTint>0 && !S.isSample && !S.scan; }
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
document.querySelectorAll('.tab').forEach(b=>b.addEventListener('click', ()=>{ notice(''); setTab(b.dataset.tab); }));
$('#tray').addEventListener('click', ()=>notice(''), true);

function modeText(){
  if (S.placing==='face') return 'Tap a face to cover it.';
  if (S.placing==='label') return 'Tap a person or thing to name it.';
  if (S.tab==='subject') return S.picks.length ? 'Tap more things to add them. Tap a ring to remove one.' : 'Tap Find, or tap what matters in the picture.';
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
    if (S.scan && (S.ctrl==='depth3d' || S.ctrl==='light')) S.ctrl='dots';
    const c = CTRL[S.ctrl];
    let body;
    if (c.chips){
      body = `<div class="scroller" style="margin-top:12px">${c.chips.map(([v,n])=>`<button class="chip ${LOOKS[look].colour===v?'def':''}" data-colour="${v}" aria-pressed="${P.colour===v}">${n}</button>`).join('')}</div>`;
    } else {
      const def = c.key==='light' ? S.lightAuto : Math.round(LOOKS[look][c.key]);
      body = `<div class="stepper"><input type="range" id="ctl" min="0" max="${c.stops.length-1}" step="0.05" value="${P[c.key]}" aria-label="${c.name}">
        <div class="stops">${c.stops.map(([n],i)=>`<button data-stop="${i}" aria-current="${Math.abs(P[c.key]-i)<0.15}" class="${i===def?'def':''}">${n}${i===def?(c.key==='light'?' (auto)':' ·'):''}</button>`).join('')}</div></div>`;
    }
    tr.innerHTML = `<div class="scroller">${CONTROLS.filter(k=>!(S.scan && (k.key==='depth3d'||k.key==='light'))).map(k=>`<button class="chip" data-ctrl="${k.key}" aria-pressed="${k.key===S.ctrl}">${k.name}</button>`).join('')}</div>
      ${body}<p class="hint">${sayBtn(c.hint)}<span>${c.hint}</span></p>
      <div class="sect row">${undoBtn}</div>`;
    tr.querySelectorAll('[data-ctrl]').forEach(b=>b.addEventListener('click',()=>{ S.ctrl=b.dataset.ctrl; renderTray(); }));
    tr.querySelectorAll('[data-colour]').forEach(b=>b.addEventListener('click',()=>{ pushUndo(); P.colour=b.dataset.colour; S.dirtyDraw=true; commit(); }));
    const r = $('#ctl');
    if (r){
      r.addEventListener('input', ()=>{ pushUndo(); P[c.key]=+r.value; if (c.key==='floor') S.floorTouched=true; if (c.rebuild){ S.lowDetail=true; S.dirtyBuild=true; } S.dirtyDraw=true; markStops(c); });
      r.addEventListener('change', ()=>{ if (c.rebuild){ S.lowDetail=false; S.dirtyBuild=true; } commit(); });
      tr.querySelectorAll('[data-stop]').forEach(b=>b.addEventListener('click',()=>{ pushUndo(); P[c.key]=+b.dataset.stop; if (c.key==='floor') S.floorTouched=true; if (c.rebuild){ S.lowDetail=false; S.dirtyBuild=true; } S.dirtyDraw=true; commit(); }));
    }
  }
  else if (S.tab==='subject' && S.scan){
    tr.innerHTML = `<p class="hint" style="margin:0">${sayBtn('A scan keeps every point it measured, so there is no subject to pick. Use Backdrop under Adjust to thin out its floor.')}<span>A scan keeps every point it measured, so there is no subject to pick. Use Backdrop under Adjust to thin out its floor.</span></p>`;
  }
  else if (S.tab==='subject'){
    const outlined = S.sharp || S.picks.some(p=>p.seg);
    tr.innerHTML = `<p class="hint" style="margin:0 0 10px">${sayBtn('Tap Find to look for people and things, or tap the thing that matters in the picture. It becomes the subject, even if something else is nearer.')}<span>Tap Find, or tap the thing that matters. It becomes the subject even if something else is nearer.</span></p>
      <div class="row" style="margin-bottom:10px"><button class="btn primary" id="findThings">Find people and things</button></div>
      ${S.picks.length ? `<div class="scroller" style="margin-bottom:8px">${S.picks.map((p,i)=>`<button class="chip" data-unpick="${i}" aria-label="Remove ${esc(pickName(p,i))}">${esc(pickName(p,i))} &#x2715;</button>`).join('')}</div>` : ''}
      <div class="scroller"><button class="chip" id="autoSub" aria-pressed="${!S.picks.length}">Nearest things</button>
      ${['Tighter','Normal','Looser'].map((n,i)=>`<button class="chip" data-band="${i}" aria-pressed="${S.band===i}">${n}</button>`).join('')}
      <button class="chip" id="sharp" aria-pressed="${outlined}">Sharper outline</button>${undoBtn}</div>
      <p class="hint">${outlined?'Outlines come from an outline finder (part of the 23 MB finder download).':'Tighter keeps only what sits at the same depth as your tap. Looser takes in more.'}</p>`;
    $('#autoSub').addEventListener('click',()=>{ pushUndo(); S.picks=[]; S.dirtyBuild=true; S.reframe=true; commit(); banner(modeText()); });
    tr.querySelectorAll('[data-unpick]').forEach(b=>b.addEventListener('click',()=>{ pushUndo(); S.picks.splice(+b.dataset.unpick,1); S.dirtyBuild=true; S.reframe=true; commit(); banner(modeText()); }));
    $('#findThings').addEventListener('click', async ()=>{
      const g=S.gen, picks = await findThings(); if (g!==S.gen) return;
      if (picks===null){ notice('The finder could not start here. Tap what matters instead.'); return; }
      if (!picks.length){ notice('Nothing found. Tap what matters instead.'); return; }
      pushUndo(); S.picks = picks; S.dirtyBuild = true; S.reframe=true; commit();
      notice('Found '+describePicks(picks)+'.');
    });
    tr.querySelectorAll('[data-band]').forEach(b=>b.addEventListener('click',()=>{ pushUndo(); S.band=+b.dataset.band; S.dirtyBuild=true; commit(); }));
    $('#sharp').addEventListener('click', async ()=>{ const g=S.gen; S.sharp=!outlined; renderTray();
      if (S.sharp && S.picks.length){ for (const p of S.picks) if (!p.seg){ const m = await outlineFor(p.u,p.v); if (g!==S.gen) return; p.seg = m; } S.dirtyBuild=true; }
      if (!S.sharp){ S.picks.forEach(p=>{ delete p.seg; }); S.dirtyBuild=true; renderTray(); }
      if (S.sharp && segFailed){ S.sharp=false; notice('The outline finder could not start here. Depth alone is being used.'); renderTray(); } });
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
    tr.innerHTML = S.scan ? `<p class="hint" style="margin:0 0 10px"><span>Faces can only be found in photos.</span></p><div class="sect"><h3>Names</h3><div class="row"><button class="chip" id="addLabel" aria-pressed="${S.placing==='label'}">+ Name</button></div>
      <div class="lablist">${S.labels.map((L,i)=>`<div><input id="label-${i}" value="${esc(L.text)}" placeholder="Name" aria-label="Name"><button class="chip" data-del="${i}">Remove</button></div>`).join('')}</div></div>` : `<h3>Faces</h3>
      <div class="scroller"><button class="chip" id="anon" aria-pressed="${S.anon}">Hide faces</button>
      ${['Light','Medium','Strong'].map((n,i)=>`<button class="chip" data-level="${i}" aria-pressed="${S.anon&&S.anonLevel===i}">${n}</button>`).join('')}
      <button class="chip" id="addFace" aria-pressed="${S.placing==='face'}">+ Face</button>${S.faces.length?'<button class="chip" id="clearFaces">Clear</button>':''}</div>
      <p class="hint">${sayBtn(status+' Hair, clothes and the setting can still identify someone.')}<span>${status}</span></p>
      <div class="sect"><h3>Names</h3><div class="row"><button class="chip" id="addLabel" aria-pressed="${S.placing==='label'}">+ Name</button></div>
      <div class="lablist">${S.labels.map((L,i)=>`<div><input id="label-${i}" value="${esc(L.text)}" placeholder="Name" aria-label="Name"><button class="chip" data-del="${i}">Remove</button></div>`).join('')}</div></div>`;
    if ($('#anon')) $('#anon').addEventListener('click', async ()=>{ S.anon=!S.anon; if (S.anon && !S.facesFound) await findFaces(); applyAnon(); invalidateCompare(); renderTray(); });
    tr.querySelectorAll('[data-level]').forEach(b=>b.addEventListener('click', async ()=>{ S.anonLevel=+b.dataset.level; if (!S.anon){ S.anon=true; if (!S.facesFound) await findFaces(); } applyAnon(); invalidateCompare(); renderTray(); }));
    if ($('#addFace')) $('#addFace').addEventListener('click',()=>{ S.placing = S.placing==='face' ? false : 'face'; setTab('people'); });
    const cf=$('#clearFaces'); if (cf) cf.addEventListener('click',()=>{ S.faces=[]; S.facesFound=false; S.anon=false; applyAnon(); invalidateCompare(); renderTray(); });
    $('#addLabel').addEventListener('click',()=>{ S.placing = S.placing==='label' ? false : 'label'; setTab('people'); });
    S.labels.forEach((L,i)=>{ $('#label-'+i).addEventListener('input',e=>{ L.text=e.target.value; S.dirtyDraw=true; }); });
    tr.querySelectorAll('[data-del]').forEach(b=>b.addEventListener('click',()=>{ S.labels.splice(+b.dataset.del,1); renderTray(); S.dirtyDraw=true; }));
  }
  if (S.tab==='adjust') tr.querySelectorAll('.scroller [aria-pressed="true"]').forEach(b=>{ const sc=b.parentElement; sc.scrollLeft = b.offsetLeft - sc.clientWidth/2 + b.offsetWidth/2; });
  const u=$('#undoBtn'); if (u) u.addEventListener('click', undo);
  tr.querySelectorAll('[data-say]').forEach(b=>b.addEventListener('click',()=>say(b.dataset.say)));
}
function markStops(c){ document.querySelectorAll('[data-stop]').forEach(b=>b.setAttribute('aria-current', Math.abs(P[c.key]-(+b.dataset.stop))<0.15)); }

// ---------------------------------------------------------------- look thumbnails, drawn from your own photo
let thumbsFor = null, thumbJob = 0;
function queueThumbs(){ thumbsFor = null; const job=++thumbJob; setTimeout(()=>makeThumbs(job), 400); }
function makeThumbs(job){
  if (job!==thumbJob) return;
  if (!gl || !G || !S.photo || (!S.compMap && !S.scan) || S.dirtyBuild){ setTimeout(()=>makeThumbs(job), 300); return; }
  const keys = Object.keys(LOOKS); const out = {};
  const next = i => {
    if (job!==thumbJob) return;
    if (i>=keys.length){ thumbsFor = out; paintThumbs(); return; }
    const k=keys[i], L=LOOKS[k];
    const R = (S.scan ? buildScanCloud : buildCloud)({dots:CTRL.dots.stops[Math.round(Math.min(2,L.dots))][1], backdrop:CTRL.backdrop.stops[Math.round(L.backdrop)][1],
      floor:CTRL.floor.stops[Math.round(L.floor)][1], pattern:L.pattern, bgTint:L.bgTint, cap:60000});
    uploadCloud(R.out, R.n, 'thumb');
    const tw=208, th=156;
    if (cv.width>=tw && cv.height>=th){
      renderView(tw, th, {cloud:G.clouds.thumb, look:k, colour:L.colour, size:CTRL.size.stops[Math.round(L.size)][1]*1.3, bright:val2('bright',L.bright)*1.5,
        glow:val2('glow',L.glow), edges:val2('edges',L.edges), light:val('light'), yaw:L.yaw, pitch:L.pitch, zoom:Math.max(1, L.zoom*0.78), thumb:true, targetKey:'thumb'});
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
function labelWorld(L){ if (L.fixed) return L.fixed; const p=unproject(L.u, L.v, zOf(depthAt(L.u,L.v))); return [p[0], p[1]+L.lift, p[2]]; }
function pickDrawn(cx, cy){
  if (!S.count || !S.P) return null;
  const MV=M4.mul(S.P,S.V), out=S.cpu; let best=1e9, bi=-1;
  const step=Math.max(1, Math.floor(S.count/250000));
  for (let i=0;i<S.count;i+=step){ const o=i*10; const c=M4.xf(MV,[out[o],out[o+1],out[o+2]]); if (c[3]<=0) continue;
    const sx=(c[0]*.5+.5)*S.cssW, sy=(1-(c[1]*.5+.5))*S.cssH, dd=(sx-cx)**2+(sy-cy)**2; if (dd<best){best=dd; bi=i;} }
  if (bi<0 || best > 44*44) return null;
  const o=bi*10; return {u:0, v:0, comp:-1, p:[out[o],out[o+1],out[o+2]]};
}
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
    const d=document.createElement('div'); d.className='pin'; d.style.left=(ox+s[0])+'px'; d.style.top=(oy+s[1])+'px';
    const i=S.picks.indexOf(p); d.innerHTML=`<b>${esc(pickName(p,i))}</b>`; box.appendChild(d); p.sx=s[0]; p.sy=s[1]; });
}
function pickName(p, i){ const n = p.name ? p.name.charAt(0).toUpperCase()+p.name.slice(1) : 'Tap '+(i+1); return n; }
function describePicks(picks){
  const people = picks.filter(p=>p.name==='person').length, other = picks.length-people, parts=[];
  if (people) parts.push(people+' '+(people===1?'person':'people')); if (other) parts.push(other+' '+(other===1?'thing':'things'));
  return parts.join(' and ');
}

// What was tapped, found from the photo's own depth rather than from the dots on screen: in the Void
// look most of the background is not drawn, and a tap there used to land on whatever dot was near.
// Within a small radius the nearest surface to the camera wins, so a tap on a person in front of a
// wall picks the person.
function pickPoint(cx, cy){
  if (S.scan) return pickDrawn(cx, cy);
  if (!S.depth || !S.P) return null;
  const D=S.depth, MV=M4.mul(S.P,S.V), step=Math.max(1, Math.round(Math.sqrt(D.w*D.h/160000)));
  let best=1e9, bi=-1, bp=null, near=-1, nearW=1e9, nearP=null;
  for (let y=0;y<D.h;y+=step) for (let x=0;x<D.w;x+=step){
    const i=y*D.w+x, p=unproject((x+.5)/D.w,(y+.5)/D.h,zOf(D.d[i])), c=M4.xf(MV,p); if (c[3]<=0) continue;
    const sx=(c[0]*.5+.5)*S.cssW, sy=(1-(c[1]*.5+.5))*S.cssH, dd=(sx-cx)**2+(sy-cy)**2;
    if (dd<best){ best=dd; bi=i; bp=p; }
    if (dd<14*14 && c[3]<nearW){ nearW=c[3]; near=i; nearP=p; } }
  if (near>=0){ bi=near; bp=nearP; } else if (bi<0 || best > 44*44) return null;
  return {u:((bi%D.w)+.5)/D.w, v:(((bi/D.w)|0)+.5)/D.h, comp:S.compMap ? S.compMap[bi] : -1, p:bp};
}
async function onTap(cx, cy){
  if (S.tab==='subject' && S.scan) return;
  if (S.tab==='subject'){
    const hit = S.picks.findIndex(p=>p.sx!=null && Math.hypot(p.sx-cx,p.sy-cy)<22);
    const pushed = undoArmed; pushUndo(); const g = S.gen;
    if (hit>=0){ S.picks.splice(hit,1); }
    else {
      // tapping in photo view maps straight to the photo; otherwise use the nearest point
      const hitP=pickPoint(cx,cy); if (!hitP){ if (pushed) S.undo.pop(); undoArmed=true; return; }
      const u=hitP.u, v=hitP.v;
      const pick={u,v}; if (S.sharp){ pick.seg = await outlineFor(u,v); if (g!==S.gen) return; }
      S.picks.push(pick); if (S.picks.length>5){ S.picks.shift(); notice('Up to five at once, so the first one was let go.'); }
    }
    S.dirtyBuild=true; S.reframe=true; commit(); banner(modeText()); return;
  }
  if (S.placing==='face'){ const p=pickPoint(cx,cy); if (!p) return; addFaceAt(p.u, p.v, p.comp); invalidateCompare(); S.placing=false; setTab('people'); return; }
  if (S.placing==='label'){ const p=pickPoint(cx,cy); if (!p) return;
    if (S.scan){ const L={fixed:[p.p[0], p.p[1]+0.06*S.refDist, p.p[2]], text:''}; L.pos=L.fixed; S.labels.push(L); S.placing=false; setTab('people');
      const inp=$('#label-'+(S.labels.length-1)); if (inp) inp.focus(); S.dirtyDraw=true; return; }
    const c=S.comps.find(k=>k.id===p.comp);
    const L = c ? {u:c.topUV[0], v:c.topUV[1], lift:(c.maxY-c.minY)*0.07, text:''} : {u:p.u, v:p.v, lift:0.06, text:''};
    L.pos=labelWorld(L); S.labels.push(L); S.placing=false; setTab('people');
    const inp=$('#label-'+(S.labels.length-1)); if (inp) inp.focus(); S.dirtyDraw=true; }
}

// ---------------------------------------------------------------- gestures
// ---------------------------------------------------------------- panning and the centre of turning
function rotOnly(){ return M4.mul(M4.rx(S.pitch*Math.PI/180), M4.mul(M4.ry(S.yaw*Math.PI/180), M4.rz(S.roll))); }
// Move the pivot to t without changing what is on screen, by folding the difference into the pan.
function setPivotKeepingView(t){
  const V = viewMatrix(S.yaw,S.pitch,S.zoom,S.pivot,S.pan), T=[V[12],V[13],V[14]], Rt = M4.xf(rotOnly(), t), back=(S.zoom-1)*S.refDist;
  S.pan = [t[0]-Rt[0]-T[0], t[1]-Rt[1]-T[1], t[2]-Rt[2]-T[2]-back]; S.pivot = t.slice();
}
// After a slide, turn about whatever is now in the middle of the screen, at the old pivot's depth.
function recentrePivot(){
  const V = viewMatrix(S.yaw,S.pitch,S.zoom,S.pivot,S.pan), pv = M4.xf(V, S.pivot), T=[V[12],V[13],V[14]];
  const c = [0-T[0], 0-T[1], pv[2]-T[2]], Rinv = M4.mul(M4.rz(-S.roll), M4.mul(M4.ry(-S.yaw*Math.PI/180), M4.rx(-S.pitch*Math.PI/180)));
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
cv.addEventListener('pointerdown', e=>{ notice(''); try { cv.setPointerCapture(e.pointerId); } catch(err){} if (!ptrs.size) didPan=false; ptrs.set(e.pointerId,{x:e.clientX,y:e.clientY}); moved=0; glide++;
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
function homeView(){ const L=LOOKS[look]; return S.home || {yaw:L.yaw, pitch:L.pitch, zoom:L.zoom, pan:[0,0,0]}; }
function viewAtHome(){ const h=homeView(); return Math.abs(S.yaw-h.yaw)<0.5 && Math.abs(S.pitch-h.pitch)<0.5 && Math.abs(S.zoom-h.zoom)<0.01 && S.pan.every((v,i)=>Math.abs(v-h.pan[i])<1e-3) && (S.home || !S.userMoved); }
function viewButton(){ $('#photoView').hidden = viewAtHome(); }
// Centre the subject and size it to fill about 60% of the frame height, like the reference shots.
function frameSubject(){
  if (!S.count || !S.P || !S.comps.length) return;
  draw();
  const MV=M4.mul(S.P,S.V), out=S.cpu; let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9, sx=0,sy=0,sz=0,n=0;
  for (let i=0;i<S.count;i+=3){ const o=i*10; if (out[o+6]!==0) continue; const c=M4.xf(MV,[out[o],out[o+1],out[o+2]]); if (c[3]<=0) continue;
    x0=Math.min(x0,c[0]); x1=Math.max(x1,c[0]); y0=Math.min(y0,c[1]); y1=Math.max(y1,c[1]); sx+=out[o]; sy+=out[o+1]; sz+=out[o+2]; n++; }
  if (n<50) return;
  const h = Math.max((y1-y0)/2, (x1-x0)/2*S.cssW/S.cssH);           // share of the frame the subject spans now
  S.zoom = Math.max(0.45, Math.min(2.5, S.zoom * h / 0.6));
  S.pivot = S.target.slice(); S.pan=[0,0,0]; S.userMoved = true;
  draw(); const V=viewMatrix(S.yaw,S.pitch,S.zoom,S.pivot,S.pan), pv=M4.xf(V,[sx/n,sy/n,sz/n]);
  setPivotKeepingView([sx/n,sy/n,sz/n]); S.pan=[S.pan[0]+pv[0], S.pan[1]+pv[1], S.pan[2]];
  S.home = {yaw:S.yaw, pitch:S.pitch, zoom:S.zoom, pivot:S.pivot.slice(), pan:S.pan.slice()};
  S.dirtyDraw = true; viewButton();
}
function resetView(){ const L=LOOKS[look], h=S.home; glide++; S.spin=false; syncSpin();
  if (h){ S.yaw=h.yaw; S.pitch=h.pitch; S.zoom=h.zoom; S.pivot=h.pivot.slice(); S.pan=h.pan.slice(); S.userMoved=true; }
  else { S.yaw=L.yaw; S.pitch=L.pitch; S.zoom=L.zoom; S.pivot=S.target.slice(); S.pan=[0,0,0]; S.userMoved=false; }
  S.dirtyDraw=true; viewButton(); }
function syncSpin(){ $('#spin').setAttribute('aria-pressed', S.spin); }
$('#photoView').addEventListener('click', resetView);
$('#spin').addEventListener('click', ()=>{ S.spin=!S.spin; syncSpin(); });
function syncPan(){ $('#panBtn').setAttribute('aria-pressed', S.panMode); $('#panPill').hidden = !S.panMode; }
$('#panBtn').addEventListener('click', ()=>{ S.panMode=!S.panMode; syncPan(); });
$('#panPill').addEventListener('click', ()=>{ S.panMode=false; syncPan(); });
let compareURL=null;
function invalidateCompare(){ if (compareURL){ URL.revokeObjectURL(compareURL); compareURL=null; } }
let compareHeld=false;
async function showCompare(on){
  const im=$('#compare'); compareHeld=on;
  if (!on || !S.photo || !S.photo.data){ im.hidden=true; return; }
  if (!compareURL){ const c=document.createElement('canvas'); c.width=S.photo.w; c.height=S.photo.h; c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(S.photo.data),S.photo.w,S.photo.h),0,0);
    compareURL = URL.createObjectURL(await new Promise(r=>c.toBlob(r,'image/jpeg',0.9))); }
  if (!compareHeld) return;
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
$('#openBtn').addEventListener('click', e=>{ e.stopPropagation();
  const m=menu($('#openBtn'), '#openMenu', [['photo','Photo','From your camera or gallery'],['scan','3D scan','A .ply file from Polycam, a lidar app or a splat trainer']]);
  if (m) m.querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>{ m.hidden=true; $('#openBtn').setAttribute('aria-expanded','false');
    (b.dataset.v==='scan' ? $('#fileScan') : $('#file')).click(); })); });
$('#shapeBtn').addEventListener('click', e=>{ e.stopPropagation();
  const items=[['photo','Same as the photo','',S.shape==='photo'],['wide','Wide','16 by 9',S.shape==='wide'],['square','Square','',S.shape==='square'],['tall','Tall','9 by 16, for stories',S.shape==='tall']];
  if (S.rollAuto) items.push(['level', S.level ? 'Straightened' : 'Straighten', S.level ? `Tilted ${(Math.abs(S.rollAuto)*180/Math.PI).toFixed(1)}°, levelled from its upright edges. Tap to undo.` : `Tilted ${(Math.abs(S.rollAuto)*180/Math.PI).toFixed(1)}°. Tap to level it.`, S.level]);
  const m=menu($('#shapeBtn'), '#shapeMenu', items);
  if (m) m.querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>{ m.hidden=true; $('#shapeBtn').setAttribute('aria-expanded','false');
    if (b.dataset.v==='level'){ pushUndo(); S.level=!S.level; S.roll = S.level ? S.rollAuto : 0; S.dirtyDraw=true; commit(); return; }
    pushUndo(); S.shape=b.dataset.v; commit(); layout(); })); });
$('#saveBtn').addEventListener('click', e=>{ e.stopPropagation();
  const m=menu($('#saveBtn'), '#saveMenu', [['png','Picture','PNG, full size'],['video','Video','Opens camera moves'],['ply','3D points','PLY file for Blender, MeshLab']]);
  if (m) m.querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>{ m.hidden=true; $('#saveBtn').setAttribute('aria-expanded','false');
    if (b.dataset.v==='png') savePicture(); else if (b.dataset.v==='ply') savePly(); else setTab('move'); })); });
document.addEventListener('click', ()=>{ document.querySelectorAll('.menu').forEach(x=>x.hidden=true); document.querySelectorAll('.tb[aria-haspopup]').forEach(b=>b.setAttribute('aria-expanded','false')); });
$('#infoBtn').addEventListener('click', e=>{ e.stopPropagation(); const i=$('#info'); i.hidden=!i.hidden; $('#infoBtn').setAttribute('aria-expanded', !i.hidden);
  if (!i.hidden){ const text='First Return turns a photo into a lidar style point cloud. Depth is worked out on your device, and the photo never leaves it.';
    i.innerHTML = `<p style="display:flex;gap:8px;align-items:center">${sayBtn(text)}<b>${text}</b></p>
      <p>${S.count.toLocaleString()} dots. ${S.nComp} subject${S.nComp===1?'':'s'}. Camera view: ${esc(S.fovSource)}.${S.planes.length?` ${S.planes.length===1?'A floor':S.planes.length+' floor surfaces'} found in the photo.`:''}${P.light?' Light evened out.':''}</p>
      <p>${esc(S.credit||'')}</p><p>Depth: Depth Anything V2 Small (Apache 2.0). Finder: MediaPipe EfficientDet Lite0 (Apache 2.0). Outlines: MediaPipe Magic Touch (Apache 2.0). Faces: UltraFace (MIT). Runtime: ONNX Runtime Web (MIT).</p>
      <button class="btn" id="infoClose">Close</button>`;
    $('#infoClose').addEventListener('click',()=>{ i.hidden=true; });
    i.querySelectorAll('[data-say]').forEach(b=>b.addEventListener('click',()=>say(b.dataset.say))); } });
$('#info').addEventListener('click', e=>e.stopPropagation());

// ---------------------------------------------------------------- opening a photo
// Everything after a wait checks S.gen, so a result that arrives after another photo or scan was
// opened is dropped instead of landing on the wrong picture.
async function setPhoto(ph, D, credit){
  const g = S.gen;
  S.scan=null; document.body.classList.remove('scan'); $('#compareBtn').hidden=false; S.roll=0; S.rollAuto=0; S.pitchTan=0;
  if (S.colourBeforeScan){ P.colour=S.colourBeforeScan; S.colourBeforeScan=null; }
  S.photoCanvas=ph.canvas; S.photoSrc=S.photo={w:ph.w,h:ph.h,data:ph.data}; S.tanV=ph.fov.tanV; S.fovSource=ph.fov.src; S.credit=credit||'';
  S.isSample = /^Sample/.test(S.credit);
  invalidateCompare();
  S.undo=[]; undoArmed=true; S.placing=false; S.home=null; S.refFrozen=false; S.compCache=null; S.depthVer++;
  S.panMode=false; syncPan(); banner(''); notice('');
  busy('Sharpening the depth edges', null); await tick(); if (g!==S.gen) return;
  S.depthSrc=S.depth=refineDepth(D, ph.canvas);
  // tilt first: the pitch sets the horizon row that the depth range is measured on
  const tv = tiltFromVerticals(ph.canvas, S.tanV);
  if (tv && Math.abs(tv.roll) > 0.4*Math.PI/180 && Math.abs(tv.roll) < 12*Math.PI/180) S.rollAuto = tv.roll;
  S.pitchTan = tv ? Math.max(-0.6, Math.min(0.6, tv.pitchTan)) : 0;
  const vh = 0.5 + PITCH_SIGN*S.pitchTan/(2*S.tanV);
  S.planes=fitFloors(S.depth); S.plane=S.planes[0]||null; S.shiftAuto=estimateShift(S.plane, vh);
  // level surfaces vanish on one horizon, so floors 2 and 3 must share the main floor's
  if (S.planes.length>1){ const t=S.shiftAuto, hz=p=>(-t-p.ga-p.al*0.5)/p.be, h0=hz(S.planes[0]); S.planes=S.planes.filter((p,k)=>k===0 || Math.abs(hz(p)-h0)<0.2); }
  S.ground=groundMask(S.depth, S.planes);
  // judge surfaces at the automatic depth range, whatever the 3D setting, and against the floor's own "up"
  SHIFT=S.shiftAuto; let upv=null;
  if (S.plane){ const rnd=seeded(8), rows=[]; for (let k=0;k<20000 && rows.length<1500;k++){ const i=(rnd()*S.ground.length)|0; if (S.ground[i]!==1) continue;
      rows.push(unproject(((i%S.depth.w)+.5)/S.depth.w, (((i/S.depth.w)|0)+.5)/S.depth.h, zOf(S.depth.d[i]))); }
    const fl = rows.length>200 ? lsqFloor(rows) : null; if (fl){ const l=Math.hypot(fl.a,1,fl.c); upv=[-fl.a/l, 1/l, -fl.c/l]; } }
  upFacingGround(S.depth, S.ground, upv); S.autoCut=otsu(S.depth.d, S.ground); SHIFT=curShift();
  S.roll = S.level ? S.rollAuto : 0;
  S.floorTouched=false; S.autoLight=true; S.lightAuto=0;
  S.picks=[]; S.labels=[]; S.faces=[]; S.facesFound=false; S.faceMask=null;
  if (S.anon){ await findFaces(); if (g!==S.gen) return; applyAnon(); }
  // look for people and things first; depth alone decides only when nothing is found
  let found = null;
  if (S.autoFind){ found = await findThings(); if (g!==S.gen) return; if (found && found.length) S.picks = found; }
  const L=LOOKS[look]; S.yaw=L.yaw; S.pitch=L.pitch; S.zoom=L.zoom; S.pan=[0,0,0]; S.userMoved=false;
  S.autoFrame = L.bgTint > 0 && !S.isSample;       // the stage looks frame the subject
  busy(null); layout(); S.dirtyBuild=true; renderTray(); queueThumbs(); viewButton();
  const notes = [];
  if (S.autoFind) notes.push(found && found.length ? 'Found '+describePicks(found)+'. Change it under Subject.' : found===null ? 'The finder could not start, so the nearest things are the subject.' : 'Nothing found, so the nearest things are the subject.');
  if (S.roll) notes.push(`Straightened ${(Math.abs(S.roll)*180/Math.PI).toFixed(1)}°.`);
  notice(notes.join(' '));
}
$('#file').addEventListener('change', async e=>{
  const f=e.target.files[0]; if (!f) return; e.target.value='';
  const g = ++S.gen;
  try { busy('Opening the photo', null); await tick();
    const ph = await decodePhoto(f); if (g!==S.gen) return;
    const raw = await estimateDepth(ph.canvas); if (g!==S.gen) return;
    await setPhoto(ph, normaliseDepth(raw), 'Your photo stayed on this device.');
  } catch(err){ console.error(err); busy(null); notice('Could not read that photo: '+(err.message||err)); }
});
$('#fileScan').addEventListener('change', async e=>{
  const f=e.target.files[0]; if (!f) return; e.target.value='';
  try { await openScan(f); } catch(err){ console.error(err); busy(null); notice('Could not read that scan: '+(err.message||err)); }
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
