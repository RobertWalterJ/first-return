// ---------------------------------------------------------------- interface
const ICON_SAY = '<svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16 9a4 4 0 0 1 0 6"/><path d="M18.5 6.5a8 8 0 0 1 0 11"/></svg>';
const sayBtn = text => `<button class="say" data-say="${text.replace(/"/g,'&quot;')}" aria-label="Read aloud">${ICON_SAY}</button>`;
// small pictures of each dot layout, so the choice reads at a glance
const PAT_ICON = (()=>{ const svg = inner => `<svg class="paticon" viewBox="0 0 24 24" aria-hidden="true">${inner}</svg>`, dot=(x,y)=>`<circle cx="${x}" cy="${y}" r="1.3"/>`;
  const sc=[[4,6],[9,3],[15,7],[20,4],[6,12],[12,11],[18,13],[3,19],[10,17],[16,20],[21,18],[13,4]];
  const grid=[]; for (let y=4;y<=20;y+=5.3) for (let x=4;x<=20;x+=5.3) grid.push([x,y]);
  const rings=[]; for (const r of [5,9]) for (let a=0;a<Math.PI;a+=Math.PI/(r*0.9)) rings.push([12+r*Math.cos(a)*1.05, 20-r*Math.sin(a)*0.55]);
  return {scatter:svg(sc.map(p=>dot(...p)).join('')), grid:svg(grid.map(p=>dot(...p)).join('')), rings:svg(rings.map(p=>dot(p[0].toFixed(1),p[1].toFixed(1))).join(''))}; })();
const esc = s => String(s).replace(/[&<>"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

// ---------------------------------------------------------------- undo
let undoArmed = true;
function snapshot(){ return {P:{...P}, look, activeMine:S.activeMine, picks:S.picks.map(p=>({...p})), band:S.band, shape:S.shape, level:S.level}; }
function pushUndo(){ if (!undoArmed) return; S.undo.push(snapshot()); if (S.undo.length>40) S.undo.shift(); undoArmed=false; }
function commit(){ undoArmed = true; persist(); renderTray(); }
function undo(){
  const s = S.undo.pop(); if (!s) return;
  Object.assign(P, s.P); look=s.look; S.activeMine=s.activeMine||null; S.picks=s.picks; S.band=s.band;
  if (s.shape!==S.shape){ S.shape=s.shape; layout(); }
  if (s.level!==S.level){ S.level=s.level; S.roll = S.level ? S.rollAuto : 0; }
  S.dirtyBuild=true; undoArmed=true; persist(); renderTray(); banner(modeText());
}
function persist(){ store('state', {P, look, shape:S.shape, level:S.level, activeMine:S.activeMine, move:S.move, moveLen:S.moveLen, fx:S.fx, strength:S.strength, loop:!!S.loop, exportLong:S.adv.exportLong}); queueSessionSave(); }
// ---------------------------------------------------------------- my looks: save, apply, share
function myLooks(){ const v=recall('myLooks'); return Array.isArray(v) ? v : []; }
function saveMyLooks(list){ store('myLooks', list); }
function activePreset(){ const m = S.activeMine && myLooks().find(x=>x.id===S.activeMine); return m ? {...LOOKS[m.base], ...m.values, name:m.name} : LOOKS[look]; }
function applyMine(id, keepView){
  const m = myLooks().find(x=>x.id===id); if (!m || !LOOKS[m.base]) return;
  if (!lookAvailable(m.base)){ notice(`"${m.name}" is based on ${LOOKS[m.base].name}, which needs ${S.scan ? 'a photo' : 'splats'}.`); return; }
  pushUndo(); look=m.base; const L=LOOKS[look];
  LOOK_KEYS.forEach(k=>{ P[k] = m.values[k]!=null ? m.values[k] : L[k]; });
  S.activeMine=id;
  if (!keepView){ S.yaw=L.yaw; S.pitch=L.pitch; S.zoom=L.zoom; S.pan=[0,0,0]; S.userMoved=false; S.home=null; S.reframe = L.bgTint>0 && !S.isSample && !S.scan; }
  S.dirtyBuild=true; commit(); viewButton();
}
function saveCurrentLook(name){
  const list=myLooks(), values={}; LOOK_KEYS.forEach(k=>{ values[k]=P[k]; });
  const id='m'+Date.now().toString(36);
  list.push({id, name:(name||'My look').slice(0,40), base:look, values}); saveMyLooks(list);
  S.activeMine=id; persist(); queueThumbs(); notice('Saved "'+(name||'My look')+'". It is under My looks.');
}
function exportLooks(){
  const list=myLooks(); if (!list.length){ notice('Save a look first, then you can share it.'); return; }
  const blob=new Blob([JSON.stringify({app:'First Return', kind:'looks', version:1, looks:list}, null, 1)], {type:'application/json'});
  if (shareFile(blob, 'first-return-looks.json')) return;
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a'); a.href=url; a.download='first-return-looks.json'; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 30000);
  notice(`Saved ${list.length} look${list.length===1?'':'s'} to first-return-looks.json. Open it with Load looks on another device.`);
}
async function importLooks(file){
  try {
    const data=JSON.parse(await file.text()); const incoming=Array.isArray(data) ? data : data.looks;
    if (!Array.isArray(incoming)) throw new Error('no looks in that file');
    const list=myLooks(); let added=0;
    for (const m of incoming){
      if (!m || typeof m.name!=='string' || !LOOKS[m.base] || typeof m.values!=='object') continue;
      const values={}; LOOK_KEYS.forEach(k=>{ const v=m.values[k]; if (v!=null && typeof v===typeof LOOKS[m.base][k]) values[k]=v; });
      if (list.some(x=>x.name===m.name && JSON.stringify(x.values)===JSON.stringify(values))) continue;
      list.push({id:'m'+Date.now().toString(36)+added, name:m.name.slice(0,40), base:m.base, values}); added++;
    }
    saveMyLooks(list); queueThumbs(); renderTray();
    notice(added ? `Loaded ${added} look${added===1?'':'s'}.` : 'Those looks are already here.');
  } catch(err){ notice('Could not load that file: '+(err.message||err)); }
}
function isCustom(){ const L=activePreset(); return LOOK_KEYS.some(k=>typeof L[k]==='number' ? Math.abs(L[k]-P[k])>0.02 : L[k]!==P[k]); }

function applyLook(name, keepView){
  if (keepView && S.activeMine){ applyMine(S.activeMine, true); P.light = S.lightAuto; S.dirtyBuild=true; commit(); return; }   // Reset look returns to the saved look, view kept
  pushUndo(); look=name; const L=LOOKS[name]; S.activeMine=null;
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
  renderTray(); banner(modeText()); S.dirtyDraw=true; renderPins(); showDebug();
  requestAnimationFrame(layout);
  if (t) store('tab', t);
}
document.querySelectorAll('.tab').forEach(b=>b.addEventListener('click', ()=>{ notice(''); setTab(b.dataset.tab); }));

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
    const mine = myLooks(), custom = isCustom();
    tr.innerHTML = `<h3>Look ${custom?'<span class="chip" style="padding:3px 8px;font-size:11px;letter-spacing:0;text-transform:none;color:var(--accent);border-color:var(--accent)">Changed</span>':''}<span class="sp"></span><button class="chip small" id="resetLook" ${custom?'':'disabled'}>Reset look</button>${undoBtn.replace('class="chip"','class="chip small"')}</h3>
      ${[['Dots', k=>!LOOKS[k].splat && !LOOKS[k].pack], ['Styles', k=>LOOKS[k].pack], ['Photo', k=>LOOKS[k].splat]].map(([title, test])=>{ const ks=Object.keys(LOOKS).filter(k=>test(k) && lookAvailable(k)); return ks.length ? `<p class="rowlabel">${title}</p><div class="looks">${ks.map(k=>`<button class="look" data-look="${k}" aria-pressed="${k===look && !S.activeMine}"><canvas id="thumb-${k}" width="208" height="156"></canvas><b>${LOOKS[k].name}</b></button>`).join('')}</div>` : ''; }).join('')}
      <p class="hint">${sayBtn(LOOK_HINT[look]||'')}<span>${LOOK_HINT[look]||''}</span></p>
      ${(LOOKS[look].splat && !LOOKS[look].mix) || S.scan ? '' : `<h3 style="margin-top:12px">Dot pattern</h3>
      <div class="scroller pats">${CTRL.pattern.chips.map(([v,n])=>`<button class="chip pat" data-pat="${v}" aria-pressed="${P.pattern===v}">${PAT_ICON[v]}${n}</button>`).join('')}</div>`}
      <div class="sect"><h3>My looks</h3>
        ${mine.length ? `<div class="looks">${mine.map(m=>`<div class="look mine" aria-pressed="${S.activeMine===m.id}"><button class="lookpick" data-mine="${m.id}" aria-label="Use ${esc(m.name)}" ${lookAvailable(m.base)?'':'disabled'}><canvas id="thumb-${m.id}" width="208" height="156"></canvas><b>${esc(m.name)}</b>${lookAvailable(m.base)?'':'<small>Needs a photo</small>'}</button><button class="lookdel" data-delmine="${m.id}" aria-label="Remove ${esc(m.name)}">&#x2715;</button></div>`).join('')}</div>` : `<p class="hint" style="margin:0 0 8px">${sayBtn('Change anything, then save it here to use again on other photos.')}<span>Change anything, then save it here to use again on other photos.</span></p>`}
        ${S.savingLook ? `<div class="row" style="margin-top:8px"><input id="lookName" class="nameinput" value="My look ${mine.length+1}" aria-label="Name for this look" maxlength="40"><button class="btn primary" id="saveLookOk">Save</button><button class="btn" id="saveLookNo">Cancel</button></div>`
          : `<div class="row" style="margin-top:8px"><button class="chip" id="saveLook">Save this look</button><button class="chip" id="shareLooks" ${mine.length?'':'disabled'}>Share looks</button><button class="chip" id="loadLooks">Load looks</button>${S.lastRemoved?`<button class="chip" id="bringBack">Bring back ${esc(S.lastRemoved.m.name)}</button>`:''}</div>`}
      </div>`;
    tr.querySelectorAll('[data-look]').forEach(b=>b.addEventListener('click',()=>applyLook(b.dataset.look)));
    tr.querySelectorAll('[data-mine]').forEach(b=>b.addEventListener('click',()=>applyMine(b.dataset.mine)));
    tr.querySelectorAll('[data-pat]').forEach(b=>b.addEventListener('click',()=>{ if (P.pattern===b.dataset.pat) return; pushUndo(); P.pattern=b.dataset.pat; S.dirtyBuild=true; commit(); }));
    tr.querySelectorAll('[data-delmine]').forEach(b=>b.addEventListener('click',()=>{ const id=b.dataset.delmine, m=myLooks().find(x=>x.id===id);
      const list=myLooks(); S.lastRemoved = m ? {m, at:list.findIndex(x=>x.id===id)} : null;
      saveMyLooks(list.filter(x=>x.id!==id)); if (S.activeMine===id) S.activeMine=null; persist(); renderTray(); notice('Removed "'+(m?m.name:'look')+'".'); }));
    if ($('#bringBack')) $('#bringBack').addEventListener('click',()=>{ const r=S.lastRemoved; if (!r) return; const list=myLooks();
      if (!list.some(x=>x.id===r.m.id)) list.splice(Math.max(0,Math.min(list.length,r.at)),0,r.m); saveMyLooks(list); S.lastRemoved=null; queueThumbs(); renderTray(); notice('"'+r.m.name+'" is back.'); });
    $('#resetLook').addEventListener('click',()=>applyLook(look, true));
    if ($('#saveLook')) $('#saveLook').addEventListener('click',()=>{ S.savingLook=true; renderTray(); const i=$('#lookName'); if (i){ i.focus(); i.select(); } });
    if ($('#saveLookOk')) $('#saveLookOk').addEventListener('click',()=>{ const n=$('#lookName').value.trim(); S.savingLook=false; saveCurrentLook(n||'My look'); renderTray(); });
    if ($('#lookName')) $('#lookName').addEventListener('keydown',e=>{ if (e.key==='Enter') $('#saveLookOk').click(); if (e.key==='Escape') $('#saveLookNo').click(); });
    if ($('#saveLookNo')) $('#saveLookNo').addEventListener('click',()=>{ S.savingLook=false; renderTray(); });
    if ($('#shareLooks')) $('#shareLooks').addEventListener('click', exportLooks);
    if ($('#loadLooks')) $('#loadLooks').addEventListener('click',()=>$('#fileLooks').click());
    paintThumbs();
  }
  else if (S.tab==='adjust' && S.group==='advanced'){
    renderAdvanced(tr);
  }
  else if (S.tab==='adjust'){
    if (!groupKeys(S.group).length) S.group = GROUPS.find(g=>groupKeys(g.id).length).id;
    const keys = groupKeys(S.group);
    if (!keys.includes(S.ctrl)) S.ctrl = keys[0];
    const c = CTRL[S.ctrl];
    let body;
    if (c.chips){
      body = `<div class="scroller" style="margin-top:12px">${c.chips.map(([v,n])=>`<button class="chip ${activePreset()[c.key]===v?'def':''}" data-choice="${v}" aria-pressed="${P[c.key]===v}">${n}</button>`).join('')}</div>`;
    } else {
      const def = c.key==='light' ? S.lightAuto : Math.round(activePreset()[c.key]);
      // splats have no backs to fill, so Hidden parts is Off or On there
      const stops = c.key==='hidden' && LOOKS[look].splat ? [['Off',0],['On',1]] : c.stops;
      body = `<div class="stepper"><input type="range" id="ctl" min="0" max="${stops.length-1}" step="0.05" value="${Math.min(P[c.key], stops.length-1)}" aria-label="${c.name}">
        <div class="stops">${stops.map(([n],i)=>`<button data-stop="${i}" aria-current="${Math.abs(P[c.key]-i)<0.15}" class="${i===def?'def':''}">${n}${i===def?(c.key==='light'?' (auto)':' ·'):''}</button>`).join('')}</div></div>`;
    }
    const note = c.key==='floor' && !S.hasFloor && !S.scan ? ' This photo has no floor, so moving this adds one.' : '';
    tr.innerHTML = `${groupRow()}
      ${keys.length>1 ? `<div class="scroller" style="margin-top:8px">${keys.map(k=>`<button class="chip" data-ctrl="${k}" aria-pressed="${k===S.ctrl}">${CTRL[k].name}</button>`).join('')}${S.group==='scene' && S.rollAuto && !S.scan ? `<button class="chip" id="levelChip" aria-pressed="${S.level}">Straighten ${(Math.abs(S.rollAuto)*180/Math.PI).toFixed(1)}°</button>` : ''}</div>` : ''}
      ${body}<p class="hint">${sayBtn(c.hint+note)}<span>${c.hint}${note}</span></p>
      <div class="sect row">${undoBtn}</div>`;
    tr.querySelectorAll('[data-ctrl]').forEach(b=>b.addEventListener('click',()=>{ S.ctrl=b.dataset.ctrl; renderTray(); }));
    if ($('#levelChip')) $('#levelChip').addEventListener('click',()=>{ pushUndo(); S.level=!S.level; S.roll = S.level ? S.rollAuto : 0; S.adv.roll=null; S.dirtyDraw=true; commit(); });
    tr.querySelectorAll('[data-choice]').forEach(b=>b.addEventListener('click',()=>{ pushUndo(); P[c.key]=b.dataset.choice; if (c.rebuild) S.dirtyBuild=true; S.dirtyDraw=true; commit(); }));
    wireGroupRow(tr);
    const r = $('#ctl');
    if (r){
      r.addEventListener('input', ()=>{ pushUndo(); P[c.key]=+r.value; if (c.key==='floor') S.floorTouched=true; if (c.rebuild){ S.lowDetail=true; S.dirtyBuild=true; } S.dirtyDraw=true; markStops(c); });
      r.addEventListener('change', ()=>{ if (c.rebuild){ S.lowDetail=false; S.dirtyBuild=true; } commit(); });
      tr.querySelectorAll('[data-stop]').forEach(b=>b.addEventListener('click',()=>{ pushUndo(); P[c.key]=+b.dataset.stop; if (c.key==='floor') S.floorTouched=true; if (c.rebuild){ S.lowDetail=false; S.dirtyBuild=true; } S.dirtyDraw=true; commit(); }));
    }
  }
  else if (S.tab==='subject' && S.scan){
    tr.innerHTML = `<p class="hint" style="margin:0">${sayBtn('A scan keeps every point it measured, so there is no subject to pick. Use Background under Adjust, Scene to thin out its floor.')}<span>A scan keeps every point it measured, so there is no subject to pick. Use Background under Adjust, Scene to thin out its floor.</span></p>`;
  }
  else if (S.tab==='subject'){
    const outlined = S.sharp || S.picks.some(p=>p.seg);
    const sHint = LOOKS[look].splat && !LOOKS[look].mix ? 'In Photoreal the subject shows only while this tab is open. It shapes Real subject and Real setting, and every dot look.' : 'Tap Find, or tap the thing that matters. It becomes the subject even if something else is nearer.';
    const sHint2 = outlined ? 'Outlines come from an outline finder, part of the 23 MB finder download.' : 'Tighter keeps only what sits at the same depth as your tap. Looser takes in more.';
    tr.innerHTML = `<p class="hint" style="margin:0 0 10px">${sayBtn(sHint)}<span>${sHint}</span></p>
      <div class="row" style="margin-bottom:10px"><button class="btn primary" id="findThings">Find people and things</button></div>
      ${S.picks.length ? `<div class="scroller" style="margin-bottom:8px">${S.picks.map((p,i)=>`<button class="chip" data-unpick="${i}" aria-label="Remove ${esc(pickName(p,i))}">${esc(pickName(p,i))} &#x2715;</button>`).join('')}</div>` : ''}
      <div class="scroller"><button class="chip" id="autoSub" aria-pressed="${!S.picks.length}">Nearest things</button>
      ${['Tighter','Normal','Looser'].map((n,i)=>`<button class="chip" data-band="${i}" aria-pressed="${S.band===i}">${n}</button>`).join('')}
      <button class="chip" id="sharp" aria-pressed="${outlined}">Sharper outline</button>${undoBtn}</div>
      <p class="hint">${sayBtn(sHint2)}<span>${sHint2}</span></p>`;
    $('#autoSub').addEventListener('click',()=>{ pushUndo(); S.picks=[]; S.dirtyBuild=true; S.reframe=true; commit(); banner(modeText()); });
    tr.querySelectorAll('[data-unpick]').forEach(b=>b.addEventListener('click',()=>{ pushUndo(); S.picks.splice(+b.dataset.unpick,1); S.dirtyBuild=true; S.reframe=true; commit(); banner(modeText()); }));
    $('#findThings').addEventListener('click', async ()=>{
      const g=S.gen, picks = await findThings(); if (g!==S.gen) return;
      if (picks===null){ notice('The finder could not start here. Tap what matters instead.'); return; }
      if (!picks.length){ notice('Nothing found. Tap what matters instead.'); return; }
      pushUndo(); S.picks = picks; protectFound(picks); S.dirtyBuild = true; S.reframe=true; commit();
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
    const fxs = FX.filter(([v])=>!FX_NEEDS_SPLATS.has(v)||hasSplats()); if (!fxs.some(f=>f[0]===S.fx)) S.fx='none';
    const fx = FX.find(f=>f[0]===S.fx) || FX[0], st = S.strength||'gentle';
    const moveHint = fx[2]+' The move starts from the view on screen.';
    tr.innerHTML = `<h3>Move</h3><div class="scroller">${MOVE_NAMES.map(([v,n])=>`<button class="chip" data-move="${v}" aria-pressed="${mv===v}">${n}</button>`).join('')}</div>
      <h3 style="margin-top:10px">Effect</h3><div class="scroller">${fxs.map(([v,n])=>`<button class="chip" data-fx="${v}" aria-pressed="${fx[0]===v}">${n}</button>`).join('')}</div>
      <h3 style="margin-top:10px">Strength</h3>
      <div class="scroller">${STRENGTH.map(([v,n])=>`<button class="chip" data-strength="${v}" aria-pressed="${st===v}">${n}</button>`).join('')}</div>
      <p class="hint">${sayBtn(moveHint)}<span>${moveHint}</span></p>
      <div class="sect row"><button class="btn" id="playMove">Play</button><button class="btn rec" id="recMove">Record video</button><button class="chip" id="lenChip" aria-label="Length ${len} seconds, tap to change">Length ${len} s</button><button class="chip" id="loopChip" aria-pressed="${!!S.loop}">Loop</button></div>`;
    // a tapped chip plays the opening of the real move at its real speed
    // a new tap cuts off the look still playing, so trying options never means waiting
    const peek = async () => { if (S.peeking){ S.stopReq=true; await S.playP; } S.playP = previewMove(S.move||'push', S.moveLen||6, Math.min(1, 4/(S.moveLen||6)), true); };
    tr.querySelectorAll('[data-move]').forEach(b=>b.addEventListener('click',()=>{ S.move=b.dataset.move; persist(); renderTray(); peek(); }));
    $('#loopChip').addEventListener('click',()=>{ S.loop=!S.loop; persist(); renderTray(); });
    $('#lenChip').addEventListener('click',()=>{ const i=MOVE_LENGTHS.indexOf(S.moveLen||6); S.moveLen=MOVE_LENGTHS[(i+1)%MOVE_LENGTHS.length]; persist(); renderTray(); });
    tr.querySelectorAll('[data-strength]').forEach(b=>b.addEventListener('click',()=>{ S.strength=b.dataset.strength; persist(); renderTray(); peek(); }));
    tr.querySelectorAll('[data-fx]').forEach(b=>b.addEventListener('click',()=>{ S.fx=b.dataset.fx; persist(); renderTray(); if (S.fx!=='none') peek(); }));
    $('#playMove').addEventListener('click',async ()=>{ if (S.peeking){ S.stopReq=true; await S.playP; } previewMove(S.move||'push', S.moveLen||6); });
    $('#recMove').addEventListener('click',async ()=>{ if (S.peeking){ S.stopReq=true; await S.playP; } recordMove(S.move||'push', S.moveLen||6); });
  }
  else if (S.tab==='people'){
    const auto=S.faces.filter(f=>f.auto).length, hand=S.faces.length-auto;
    const status = !S.anon ? 'Faces are shown as they are.' : `${auto?`Found ${auto} face${auto===1?'':'s'}.`:'No faces found by itself.'}${hand?` ${hand} covered by hand.`:''}`;
    const pHint = status+(S.anon&&S.anonLevel===0?' Light only blurs, which can sometimes be undone.':' Hair, clothes and the setting can still identify someone.');
    const nameRows = S.labels.map((L,i)=>`<div><input id="label-${i}" value="${esc(L.text)}" placeholder="Name" aria-label="Name ${i+1}"><button class="chip" data-del="${i}" aria-label="Remove name ${i+1}">Remove</button></div>`).join('');
    tr.innerHTML = S.scan ? `<p class="hint" style="margin:0 0 10px">${sayBtn('Faces can only be found in photos. Names work on scans too.')}<span>Faces can only be found in photos. Names work on scans too.</span></p><div class="sect"><h3>Names</h3><div class="row"><button class="chip" id="addLabel" aria-pressed="${S.placing==='label'}">+ Name</button></div>
      <div class="lablist">${nameRows}</div></div>` : `<h3>Faces</h3>
      <div class="scroller"><button class="chip" id="anon" aria-pressed="${S.anon}">Hide faces</button>
      ${['Light','Medium','Strong'].map((n,i)=>`<button class="chip" data-level="${i}" aria-pressed="${S.anon&&S.anonLevel===i}">${n}</button>`).join('')}
      <button class="chip" id="addFace" aria-pressed="${S.placing==='face'}">+ Face</button>${S.faces.length?'<button class="chip" id="clearFaces">Clear</button>':''}</div>
      <p class="hint">${sayBtn(pHint)}<span>${pHint}</span></p>
      <div class="sect"><h3>Names</h3><div class="row"><button class="chip" id="addLabel" aria-pressed="${S.placing==='label'}">+ Name</button></div>
      <div class="lablist">${nameRows}</div></div>`;
    if ($('#anon')) $('#anon').addEventListener('click', async ()=>{ S.anon=!S.anon; if (S.anon && !S.facesFound) await findFaces(); applyAnon(); invalidateCompare(); queueThumbs(); renderTray(); });
    tr.querySelectorAll('[data-level]').forEach(b=>b.addEventListener('click', async ()=>{ S.anonLevel=+b.dataset.level; if (!S.anon){ S.anon=true; if (!S.facesFound) await findFaces(); } applyAnon(); invalidateCompare(); queueThumbs(); renderTray(); }));
    if ($('#addFace')) $('#addFace').addEventListener('click',()=>setPlacing('face'));
    const cf=$('#clearFaces'); if (cf) cf.addEventListener('click',()=>{ S.faces=[]; S.facesFound=false; S.anon=false; applyAnon(); invalidateCompare(); queueThumbs(); renderTray(); });
    $('#addLabel').addEventListener('click',()=>setPlacing('label'));
    S.labels.forEach((L,i)=>{ $('#label-'+i).addEventListener('input',e=>{ L.text=e.target.value; S.dirtyDraw=true; }); });
    tr.querySelectorAll('[data-del]').forEach(b=>b.addEventListener('click',()=>{ S.labels.splice(+b.dataset.del,1); renderTray(); S.dirtyDraw=true; }));
  }
  tr.querySelectorAll('.scroller [aria-pressed="true"], .looks [aria-pressed="true"]').forEach(b=>{ const sc=b.parentElement; sc.scrollLeft = b.offsetLeft - sc.clientWidth/2 + b.offsetWidth/2; });
  const u=$('#undoBtn'); if (u) u.addEventListener('click', undo);
  tr.querySelectorAll('[data-say]').forEach(b=>b.addEventListener('click',()=>say(b.dataset.say)));
}
// Waiting for a tap on the picture. This must not go through setTab: on a phone, re-selecting the open
// tab closes it, and closing People cancels the placing, so the tap would do nothing.
function afterPlacing(){ if (S.tab!=='people') setTab('people'); else { $('#stage').classList.remove('picking'); renderTray(); banner(modeText()); } }
function setPlacing(kind){ S.placing = S.placing===kind ? false : kind; $('#stage').classList.toggle('picking', !!S.placing || S.tab==='subject');
  renderTray(); banner(modeText()); renderPins(); }
const SPLAT_KEYS = ['bright','glow','depth3d','hidden','focus'];
const LOOK_HINT = {
  void:'Void: the subject in true colour on a black stage, with a faint backdrop and floor.',
  sparse:'Sparse: fewer, bigger, glowing dots, muted colour.',
  scanner:'Scanner: rings like a spinning lidar, coloured by distance, seen from above.',
  survey:'Survey: a dense scan coloured by height, with outlines.',
  real:'Photoreal: the photo itself in 3D, made of soft splats. Turn the view to see its depth.',
  psub:'Real subject: the people or things you picked as the real photo, on the stage of dots.',
  pworld:'Real setting: everything around the subject as the real photo, the subject as dots.',
  thermal:'Thermal: an ironbow heat palette, warmest where it is brightest and nearest.',
  night:'Night vision: green phosphor with grain, scan lines and a dark vignette.',
  blueprint:'Blueprint: pale lines of dots on blueprint blue, with outlines at every edge.',
  print:'Print: a halftone in black ink on warm paper; darker places get bigger dots.'};
// Photoreal needs splats; the mixed looks also need a subject, so not scans
function lookAvailable(k){ const L=LOOKS[k]; return !L.splat || (hasSplats() && (!L.mix || !S.scan)); }
function groupKeys(g){ const G=GROUPS.find(x=>x.id===g)||GROUPS[0]; return G.keys.filter(k=>!(S.scan && (k==='depth3d'||k==='light'||k==='hidden'||k==='floor')) && (!LOOKS[look].splat || LOOKS[look].mix || SPLAT_KEYS.includes(k))); }
function groupRow(){ return `<div class="seg" role="tablist">${GROUPS.filter(g=>g.id==='advanced'||groupKeys(g.id).length).map(g=>`<button class="segb" data-group="${g.id}" aria-selected="${S.group===g.id}">${g.name}</button>`).join('')}</div>`; }
function wireGroupRow(tr){ tr.querySelectorAll('[data-group]').forEach(b=>b.addEventListener('click',()=>{ S.group=b.dataset.group; if (S.group!=='advanced') S.ctrl=groupKeys(S.group)[0]; store('group', S.group); renderTray(); showDebug(); })); }
// ---------------------------------------------------------------- Advanced: diagnostic views and direct settings
function autoRatio(){ return (1+S.shiftAuto)/S.shiftAuto; }
function renderAdvanced(tr){
  const deg = r => r*180/Math.PI, A=S.adv;
  const fov = A.fov || deg(2*Math.atan(S.tanVAuto)), ratio = A.ratio || Math.pow(autoRatio(), val('depth3d')), roll = A.roll!=null ? A.roll : deg(S.roll);
  const beams = A.beams || Math.round(16 + val('dots')/100*200);
  const ratioPos = Math.log(ratio/1.1)/Math.log(60/1.1)*100;
  const row = (id, label, min, max, step, v, out, auto) => `<div class="advrow"><label for="${id}">${label}</label><input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${v}"><output id="${id}Out">${out}</output>${auto?`<button class="chip small" data-auto="${id}">Auto</button>`:'<span></span>'}</div>`;
  tr.innerHTML = `${groupRow()}
    <div class="sect"><h3>Show</h3><div class="scroller">${[['result','The result'],['depth','Depth map'],['masks','Subject and floors']].map(([v,n])=>`<button class="chip" data-dbg="${v}" aria-pressed="${S.dbg===v}" ${S.scan&&v!=='result'?'disabled':''}>${n}</button>`).join('')}</div>
      ${(h=>h?`<p class="hint">${sayBtn(h)}<span>${h}</span></p>`:'')(S.dbg==='masks'?'Yellow is the subject. Pale blue is sky, which sits on a distant dome. Blue, cyan and violet are floors that were fitted. Green is other ground facing up.':S.dbg==='depth'?'Light is near, dark is far.':'')}</div>
    <div class="sect"><h3>Camera and depth</h3>
      ${row('advFov','View angle',20,110,1,fov.toFixed(0),fov.toFixed(0)+'°',!!A.fov)}
      ${S.scan?'':row('advRatio','Far vs near',0,100,1,ratioPos.toFixed(0),ratio.toFixed(1)+'x',!!A.ratio)}
      ${S.scan?'':row('advRoll','Tilt',-12,12,0.1,roll.toFixed(1),roll.toFixed(1)+'°',A.roll!=null)}
    </div>
    ${S.scan || (LOOKS[look].splat && !LOOKS[look].mix) ? '' : `<div class="sect"><h3>Scanner</h3>
      ${P.pattern==='rings' ? row('advBeams','Beams',16,256,1,beams,beams,!!A.beams) : '<p class="hint">Beams applies to the Scan rings pattern, on the Look tab.</p>'}
      ${row('advNoise','Range noise',0,4,0.1,A.noise,A.noise.toFixed(1)+'x',A.noise!==1)}
    </div>`}
    <p class="hint">${sayBtn('Picture size is in the Save menu.')}<span>Picture size is in the Save menu.</span></p>`;
  wireGroupRow(tr);
  tr.querySelectorAll('[data-dbg]').forEach(b=>b.addEventListener('click',()=>{ S.dbg=b.dataset.dbg; renderTray(); showDebug(); }));
  const on = (id, fn) => { const el=$('#'+id); if (el) el.addEventListener('input', ()=>fn(+el.value, $('#'+id+'Out'))); };
  on('advFov', (v,o)=>{ A.fov=v; S.tanV=Math.tan(v*Math.PI/360); o.textContent=v+'°'; S.dirtyBuild=true; });
  on('advRatio', (v,o)=>{ const r=1.1*Math.pow(60/1.1, v/100); A.ratio=r; o.textContent=r.toFixed(1)+'x'; S.lowDetail=true; S.dirtyBuild=true; });
  on('advRoll', (v,o)=>{ A.roll=v; S.roll=v*Math.PI/180; o.textContent=v.toFixed(1)+'°'; S.dirtyDraw=true; });
  on('advBeams', (v,o)=>{ A.beams=v; o.textContent=v; S.dirtyBuild=true; });
  on('advNoise', (v,o)=>{ A.noise=v; o.textContent=v.toFixed(1)+'x'; S.dirtyBuild=true; });
  tr.querySelectorAll('input[type=range]').forEach(el=>el.addEventListener('change',()=>{ S.lowDetail=false; S.dirtyBuild=true; renderTray(); }));
  tr.querySelectorAll('[data-auto]').forEach(b=>b.addEventListener('click',()=>{ const k=b.dataset.auto;
    if (k==='advFov'){ A.fov=null; S.tanV=S.tanVAuto; }
    if (k==='advRatio') A.ratio=null;
    if (k==='advRoll'){ A.roll=null; S.roll = S.level ? S.rollAuto : 0; }
    if (k==='advBeams') A.beams=null;
    if (k==='advNoise') A.noise=1;
    S.dirtyBuild=true; renderTray(); }));
}
// Diagnostic views drawn over the picture: the depth map, or what counts as subject and floor.
function showDebug(){
  const c=$('#dbgView');
  if (S.dbg==='result' || S.scan || !S.depth || S.tab!=='adjust' || S.group!=='advanced'){ c.hidden=true; return; }
  const D=S.depth, m=S.compMap, G=S.ground; c.width=D.w; c.height=D.h;
  const x=c.getContext('2d'), im=x.createImageData(D.w,D.h), col={1:[40,120,255],2:[40,220,220],3:[160,80,255],4:[40,200,90],9:[20,40,90]};
  for (let i=0;i<D.w*D.h;i++){ const v=D.d[i]*255; let cc=[v,v,v];
    if (S.dbg==='masks'){ const g=v*0.35; cc = m && m[i]>=0 ? [255,200,40] : S.sky && S.sky[i] ? [120,170,255] : (G && G[i] ? col[G[i]] : [g,g,g]); }
    im.data[i*4]=cc[0]; im.data[i*4+1]=cc[1]; im.data[i*4+2]=cc[2]; im.data[i*4+3]=255; }
  x.putImageData(im,0,0);
  const pa=S.photo.w/S.photo.h, fa=frameAspect(); let w=S.cssW, h=S.cssH; if (fa>pa) w=h*pa; else h=w/pa;
  Object.assign(c.style, {width:w+'px', height:h+'px', left:(parseFloat(cv.style.left)+(S.cssW-w)/2)+'px', top:(parseFloat(cv.style.top)+(S.cssH-h)/2)+'px'});
  c.hidden=false;
}
function markStops(c){ document.querySelectorAll('[data-stop]').forEach(b=>b.setAttribute('aria-current', Math.abs(P[c.key]-(+b.dataset.stop))<0.15)); }

// ---------------------------------------------------------------- look thumbnails, drawn from your own photo
let thumbsFor = null, thumbJob = 0;
function queueThumbs(){ thumbsFor = null; const job=++thumbJob; setTimeout(()=>makeThumbs(job), 400); }
function makeThumbs(job){
  if (job!==thumbJob) return;
  if (S.recording){ setTimeout(()=>makeThumbs(job), 500); return; }     // re-sorting splats mid-move would flicker
  if (!gl || !G || !S.photo || (!S.compMap && !S.scan) || S.dirtyBuild){ setTimeout(()=>makeThumbs(job), 300); return; }
  const mine = myLooks(), keys = Object.keys(LOOKS).filter(lookAvailable).concat(mine.map(m=>m.id)); const out = {};
  const next = i => {
    if (job!==thumbJob) return;
    if (i>=keys.length){ thumbsFor = out; paintThumbs(); return; }
    const k=keys[i], m=mine.find(x=>x.id===k), L = m ? {...LOOKS[m.base], ...m.values} : LOOKS[k], lk = m ? m.base : k;
    const R = (S.scan ? buildScanCloud : buildCloud)({dots:CTRL.dots.stops[Math.round(Math.min(2,L.dots))][1], backdrop:CTRL.backdrop.stops[Math.round(L.backdrop)][1],
      floor:CTRL.floor.stops[Math.round(L.floor)][1], pattern:L.pattern, bgTint:L.bgTint, cap:60000});
    uploadCloud(R.out, R.n, 'thumb');
    const tw=208, th=156;
    if (cv.width>=tw && cv.height>=th){
      renderView(tw, th, {cloud:G.clouds.thumb, look:lk, colour:L.colour, size:val2('size',L.size)*1.3, bright:val2('bright',L.bright)*1.5,
        glow:val2('glow',L.glow), edges:val2('edges',L.edges), light:val('light'), yaw:L.yaw, pitch:L.pitch, zoom:Math.max(1, L.zoom*0.78), thumb:true, sync:true, dof:val2('focus',L.focus||0), targetKey:'thumb'});
      if (G.splat) G.splat.sortedFor = null;       // the main view needs its own order again
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
  if (S.placing==='face'){ const p=pickPoint(cx,cy); if (!p) return; addFaceAt(p.u, p.v, p.comp); invalidateCompare(); queueThumbs(); S.placing=false; afterPlacing(); return; }
  if (S.placing==='label'){ const p=pickPoint(cx,cy); if (!p) return;
    if (S.scan){ const L={fixed:[p.p[0], p.p[1]+0.06*S.refDist, p.p[2]], text:''}; L.pos=L.fixed; S.labels.push(L); S.placing=false; afterPlacing();
      markNewName(); S.dirtyDraw=true; return; }
    const c=S.comps.find(k=>k.id===p.comp);
    const L = c ? {u:c.topUV[0], v:c.topUV[1], lift:(c.maxY-c.minY)*0.07, text:''} : {u:p.u, v:p.v, lift:0.06, text:''};
    L.pos=labelWorld(L); S.labels.push(L); S.placing=false; afterPlacing();
    markNewName(); S.dirtyDraw=true; }
}

// A new name box is marked rather than focused: focusing opens the phone keyboard, which hides the
// picture just when you want to see where the name landed.
function markNewName(){ const inp=$('#label-'+(S.labels.length-1)); if (!inp) return; inp.classList.add('fresh'); inp.placeholder='Tap here to type the name';
  inp.addEventListener('focus',()=>inp.classList.remove('fresh'),{once:true}); inp.scrollIntoView({block:'nearest'}); }
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
    if (S.measure){ measureTap(cx, cy); }
    else if (S.panMode && S.tab!=='subject' && !S.placing){ const hit=pickPoint(cx,cy); if (hit) centreOn(hit.p); }      // no timing needed
    else if (S.tab!=='subject' && !S.placing && now-lastTap<320){ const hit=pickPoint(cx,cy); if (hit) centreOn(hit.p); lastTap=0; }
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
  // with no size on screen (the page in the background) the sums below divide by zero and the view
  // becomes NaN, a blank picture; wait until the picture is shown again
  if (!(S.cssW>0 && S.cssH>0 && cv.width>0 && cv.height>0)){ S.framePending = true; return; }
  draw();
  const MV=M4.mul(S.P,S.V), out=S.cpu; let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9, sx=0,sy=0,sz=0,n=0;
  for (let i=0;i<S.count;i+=3){ const o=i*10; if (out[o+6]!==0) continue; const c=M4.xf(MV,[out[o],out[o+1],out[o+2]]); if (c[3]<=0) continue;
    x0=Math.min(x0,c[0]); x1=Math.max(x1,c[0]); y0=Math.min(y0,c[1]); y1=Math.max(y1,c[1]); sx+=out[o]; sy+=out[o+1]; sz+=out[o+2]; n++; }
  if (n<50) return;
  const h = Math.max((y1-y0)/2, (x1-x0)/2*S.cssW/S.cssH);           // share of the frame the subject spans now
  if (!(h>0 && isFinite(h))) return;
  S.zoom = Math.max(0.45, Math.min(2.5, S.zoom * h / 0.6));
  S.pivot = S.target.slice(); S.pan=[0,0,0]; S.userMoved = true;
  draw(); const V=viewMatrix(S.yaw,S.pitch,S.zoom,S.pivot,S.pan), pv=M4.xf(V,[sx/n,sy/n,sz/n]);
  setPivotKeepingView([sx/n,sy/n,sz/n]); S.pan=[S.pan[0]+pv[0], S.pan[1]+pv[1], S.pan[2]];
  if (![S.zoom, ...S.pan, ...S.pivot].every(isFinite)){ S.zoom=LOOKS[look].zoom; S.pan=[0,0,0]; S.pivot=S.target.slice(); S.userMoved=false; S.home=null; return; }
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
$('#panBtn').addEventListener('click', ()=>{ if (S.measure) setMeasure(false); });
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
  m.innerHTML = items.map(([v,n,sub,on])=>`<button data-v="${v}"${typeof on==='boolean' ? ` aria-pressed="${on}"` : ''}>${n}${sub?`<small>${sub}</small>`:''}</button>`).join('');
  const r=btn.getBoundingClientRect(); m.style.top=(r.bottom+6)+'px'; m.style.left=Math.max(8,Math.min(innerWidth-210, r.left-60))+'px';
  m.hidden=false; btn.setAttribute('aria-expanded','true');
  return m;
}
$('#openBtn').addEventListener('click', e=>{ e.stopPropagation();
  const m=menu($('#openBtn'), '#openMenu', [['photo','Photo','From your camera or gallery'],['live','Live scan','Walk around something while the phone picks the views; makes a 3D splat here'],['vscan','Scan from video','Walk slowly around something for 10 to 30 seconds; makes a 3D splat here'],['scan','3D scan','A .ply, .splat or .spz from Polycam, Scaniverse, a lidar app or a splat trainer']]);
  if (m) m.querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>{ m.hidden=true; $('#openBtn').setAttribute('aria-expanded','false');
    if (b.dataset.v==='live'){ openLiveScan(); return; }
    (b.dataset.v==='scan' ? $('#fileScan') : b.dataset.v==='vscan' ? $('#fileVideo') : $('#file')).click(); })); });
$('#shapeBtn').addEventListener('click', e=>{ e.stopPropagation();
  const items=[['photo','Same as the photo','',S.shape==='photo'],['wide','Wide','16 by 9',S.shape==='wide'],['square','Square','',S.shape==='square'],['tall','Tall','9 by 16, for stories',S.shape==='tall']];
  const m=menu($('#shapeBtn'), '#shapeMenu', items);
  if (m) m.querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>{ m.hidden=true; $('#shapeBtn').setAttribute('aria-expanded','false');
    pushUndo(); S.shape=b.dataset.v; commit(); layout(); })); });
const PIC_SIZES = [null, 1080, 2048, 2880, 4096];
// Effects play over a camera move, in preview and in the video.
const FX = [['none','None','Just the move.'],
  ['build','Build up','The picture gathers slowly, dot by dot, from nothing.'],
  ['dissolve','Dissolve','The dots quietly give way to the real photo, a little at a time.'],
  ['dust','Dust','Everything drifts very slightly, like dust in still air.'],
  ['focuspull','Focus pull','Focus starts close to the camera and slowly settles on the subject.'],
  ['light','Light pass','A soft light passes slowly across the scene, falling on the shapes as it goes.'],
  ['sweep','Sweep','A scanning beam moves outward and the picture appears behind it.'],
  ['resolve','Resolve','The beam moves outward and turns the dots into the real photo as it passes.'],
  ['decay','Decay','The picture comes apart: pieces let go one after another and drift away.'],
  ['glitch','Glitch','Bands tear sideways, colours split and blocks drop out, in bursts.']];
const FX_NEEDS_SPLATS = new Set(['dissolve','resolve']);
const MOVE_LENGTHS = [4, 6, 10, 20, 30];
$('#saveBtn').addEventListener('click', e=>{ e.stopPropagation();
  const px = S.adv.exportLong || (MOBILE ? 2048 : 2880);
  const m=menu($('#saveBtn'), '#saveMenu', [['png','Picture',`PNG, ${px} pixels on the long side`],
    ['size', `Picture size: ${S.adv.exportLong ? S.adv.exportLong+' pixels' : 'Auto'}`, 'Tap to change. Videos stop at 1920.'],
    ['video','Video','Moves and effects, on the Move tab'],['ply','Points (.ply)','For Blender, MeshLab, CloudCompare'], ...(hasSplats() ? [['spz','Splat, small (.spz)','For SuperSplat and splat apps'],['splat','Splat, full (.ply)','Larger, for any 3DGS tool']] : [])]);
  if (m) m.querySelectorAll('button').forEach(b=>b.addEventListener('click',ev=>{
    if (b.dataset.v==='size'){ ev.stopPropagation(); const i=PIC_SIZES.indexOf(S.adv.exportLong); S.adv.exportLong=PIC_SIZES[(i+1)%PIC_SIZES.length]; persist();
      m.hidden=true; $('#saveBtn').click(); return; }       // reopen with the new size showing
    m.hidden=true; $('#saveBtn').setAttribute('aria-expanded','false');
    if (b.dataset.v==='png') savePicture(); else if (b.dataset.v==='ply') savePly(); else if (b.dataset.v==='splat') saveSplatPly(); else if (b.dataset.v==='spz') saveSplatSpz(); else if (S.tab!=='move') setTab('move'); else notice('Choose a move and an effect below, then tap Record video.'); })); });
document.addEventListener('keydown', e=>{ if (e.key!=='Escape') return;
  document.querySelectorAll('.menu').forEach(x=>x.hidden=true); document.querySelectorAll('.tb[aria-haspopup]').forEach(b=>b.setAttribute('aria-expanded','false'));
  if (!$('#info').hidden) $('#info').hidden=true; if (!$('#sheet').hidden) $('#sheetClose').click(); });
document.addEventListener('click', ()=>{ document.querySelectorAll('.menu').forEach(x=>x.hidden=true); document.querySelectorAll('.tb[aria-haspopup]').forEach(b=>b.setAttribute('aria-expanded','false')); });
$('#infoBtn').addEventListener('click', e=>{ e.stopPropagation(); const i=$('#info'); i.hidden=!i.hidden; $('#infoBtn').setAttribute('aria-expanded', !i.hidden);
  if (!i.hidden){ const text='First Return turns a photo into a lidar style point cloud. Depth is worked out on your device, and the photo never leaves it.';
    i.innerHTML = `<p style="display:flex;gap:8px;align-items:center">${sayBtn(text)}<b>${text}</b></p>
      <p>${S.count.toLocaleString()} dots. ${S.nComp} subject${S.nComp===1?'':'s'}. Camera view: ${esc(S.fovSource)}. ${self.crossOriginIsolated ? `Using up to ${Math.min(4, navigator.hardwareConcurrency||2)} processor cores.` : 'Using one processor core.'}${S.planes.length?` ${S.planes.length===1?'A floor':S.planes.length+' floor surfaces'} found in the photo.`:''}${P.light?' Light evened out.':''}</p>
      <p>${esc(S.credit||'')}</p><p>Depth: Depth Anything V2 Small (Apache 2.0). Finder: MediaPipe EfficientDet Lite0 (Apache 2.0). Outlines: MediaPipe Magic Touch (Apache 2.0). Faces: YuNet, OpenCV Zoo (MIT). Runtime: ONNX Runtime Web (MIT). Photoreal: Gaussian splatting (Kerbl and others, 2023), drawn by this app; .spz is Niantic's format (MIT).</p>
      <button class="btn" id="infoClose">Close</button>`;
    $('#infoClose').addEventListener('click',()=>{ i.hidden=true; });
    i.querySelectorAll('[data-say]').forEach(b=>b.addEventListener('click',()=>say(b.dataset.say))); } });
$('#info').addEventListener('click', e=>e.stopPropagation());

// A fitted "floor" lying mostly on found people or things is a body or an object, not a floor.
function mostlyOnFound(pl, picks){
  const boxes=picks.filter(p=>p.box).map(p=>p.box); if (!boxes.length) return false;
  const D=S.depth; let on=0, inB=0;
  for (let y=0;y<D.h;y+=3){ const v=(y+.5)/D.h; for (let x=0;x<D.w;x+=3){ const u=(x+.5)/D.w, e=pl.al*u+pl.be*v+pl.ga;
    if (e<=0.02 || Math.abs(D.d[y*D.w+x]-e) > 0.015+0.03*e) continue; on++;
    if (boxes.some(b=>u>=b[0]&&u<=b[2]&&v>=b[1]&&v<=b[3])) inB++; } }
  return on>0 && inB/on > 0.5;
}
// Nothing inside a found person or thing counts as floor (its outline when there is one, else its box).
function protectFound(picks){
  const D=S.depth, G=S.ground; if (!G) return;
  for (const p of picks){ if (!p.box) continue; const [x0,y0,x1,y1]=p.box;
    for (let y=Math.floor(y0*D.h); y<Math.min(D.h,Math.ceil(y1*D.h)); y++) for (let x=Math.floor(x0*D.w); x<Math.min(D.w,Math.ceil(x1*D.w)); x++){
      const i=y*D.w+x; if (!p.seg || p.seg[i]) G[i]=0; } }
  S.compCache=null;
}
// ---------------------------------------------------------------- opening a photo
// Everything after a wait checks S.gen, so a result that arrives after another photo or scan was
// opened is dropped instead of landing on the wrong picture.
// restore: {picks} when coming back to earlier work, so the finder does not run again
async function setPhoto(ph, D, credit, restore){
  const g = S.gen;
  if (!restore) mediaId = null;      // until this photo is saved, nothing is paired with the previous one
  S.scan=null; document.body.classList.remove('scan'); $('#compareBtn').hidden=false; S.roll=0; S.rollAuto=0; S.pitchTan=0;
  if (S.colourBeforeScan){ P.colour=S.colourBeforeScan; S.colourBeforeScan=null; }
  S.photoCanvas=ph.canvas; S.photoSrc=S.photo={w:ph.w,h:ph.h,data:ph.data}; S.tanV=S.tanVAuto=ph.fov.tanV; S.fovSource=ph.fov.src; S.credit=credit||'';
  Object.assign(S.adv, {fov:null, ratio:null, roll:null, beams:null}); S.fillCache=null; S.dbg='result'; showDebug();
  S.isSample = /^Sample/.test(S.credit);
  invalidateCompare();
  S.undo=[]; undoArmed=true; S.placing=false; S.home=null; S.refFrozen=false; S.compCache=null; S.depthVer++;
  S.panMode=false; syncPan(); banner(''); notice('');
  busy('Sharpening the depth edges', null); await tick(); if (g!==S.gen) return;
  S.depthSrc=S.depth=refineDepth(D, ph.canvas); S.sky = skyMask(S.depth); S.skyR = 0;
  // tilt first: the pitch sets the horizon row that the depth range is measured on
  const tv = tiltFromVerticals(ph.canvas, S.tanV);
  if (tv && Math.abs(tv.roll) > 0.4*Math.PI/180 && Math.abs(tv.roll) < 12*Math.PI/180) S.rollAuto = tv.roll;
  S.pitchTan = tv ? Math.max(-0.6, Math.min(0.6, tv.pitchTan)) : 0;
  const vh = 0.5 + PITCH_SIGN*S.pitchTan/(2*S.tanV);
  S.picks=[]; S.labels=[]; S.faces=[]; S.facesFound=false; S.faceMask=null; S.mLines=[]; S.mPts=[]; S.mScale=null; S.mCorr=1; S.hzV=null;
  // Find people and things before looking for floors: a close-up body is a big surface facing the
  // camera, and without this it could be fitted as a "floor" and wiped out along with everything behind it.
  let found = null;
  if (restore) found = restore.picks;
  else if (S.autoFind){ found = await findThings(); if (g!==S.gen) return; }
  if (found && found.length) S.picks = found;
  S.planes=fitFloors(S.depth).filter(pl=>!mostlyOnFound(pl, S.picks)); S.plane=S.planes[0]||null; S.shiftAuto=estimateShift(S.plane, vh);
  // level surfaces vanish on one horizon, so floors 2 and 3 must share the main floor's
  if (S.planes.length>1){ const t=S.shiftAuto, hz=p=>(-t-p.ga-p.al*0.5)/p.be, h0=hz(S.planes[0]); S.planes=S.planes.filter((p,k)=>k===0 || Math.abs(hz(p)-h0)<0.2); }
  S.ground=groundMask(S.depth, S.planes);
  // judge surfaces at the automatic depth range, whatever the 3D setting, and against the floor's own "up"
  SHIFT=S.shiftAuto; let upv=null;
  if (S.plane){ const rnd=seeded(8), rows=[]; for (let k=0;k<20000 && rows.length<1500;k++){ const i=(rnd()*S.ground.length)|0; if (S.ground[i]!==1) continue;
      rows.push(unproject(((i%S.depth.w)+.5)/S.depth.w, (((i/S.depth.w)|0)+.5)/S.depth.h, zOf(S.depth.d[i]))); }
    const fl = rows.length>200 ? lsqFloor(rows) : null; if (fl){ const l=Math.hypot(fl.a,1,fl.c); upv=[-fl.a/l, 1/l, -fl.c/l]; } }
  upFacingGround(S.depth, S.ground, upv); protectFound(S.picks); S.autoCut=otsu(S.depth.d, S.ground); SHIFT=curShift();
  S.hasFloor = S.planes.length>0 || S.ground.some(v=>v===4);
  S.roll = S.level ? S.rollAuto : 0;
  S.floorTouched=false; S.autoLight=true; S.lightAuto=0;
  if (S.anon){ await findFaces(); if (g!==S.gen) return; applyAnon(); }
  const L=LOOKS[look]; S.yaw=L.yaw; S.pitch=L.pitch; S.zoom=L.zoom; S.pan=[0,0,0]; S.userMoved=false;
  S.autoFrame = L.bgTint > 0 && !S.isSample;       // the stage looks frame the subject
  busy(null); layout(); S.dirtyBuild=true; renderTray(); queueThumbs(); viewButton();
  if (restore) return;
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
    // the finder models start while depth is being worked out
    const raw = await estimateDepth(ph.canvas, ()=>{ if (S.autoFind) warmFinder().catch(()=>{}); }); if (g!==S.gen) return;
    const D = normaliseDepth(raw);
    await setPhoto(ph, D, 'Your photo stayed on this device.');
    if (g===S.gen) saveMedia({kind:'photo', blob: await canvasBlob(ph.canvas), depth:D, fov:ph.fov, credit:'Your photo stayed on this device.'});
  } catch(err){ console.error(err); busy(null); notice('Could not read that photo: '+(err.message||err)); }
});
$('#fileScan').addEventListener('change', async e=>{
  const f=e.target.files[0]; if (!f) return; e.target.value='';
  mediaId = null;
  try { await openScan(f); if (f.size < 200e6) saveMedia({kind:'scan', file:f}); } catch(err){ console.error(err); busy(null); notice('Could not read that scan: '+(err.message||err)); }
});

// ---------------------------------------------------------------- main loop
function frame(){
  if (S.framePending && S.cssW>0 && S.cssH>0 && !S.recording){ S.framePending=false; frameSubject(); }
  if (gl && G){
    if (S.dirtyBuild && !S.recording) build();
    if (S.spin && !S.recording){ S.yaw+=0.25; S.dirtyDraw=true; viewButton(); }
    if (S.dirtyDraw && !S.recording){ S.dirtyDraw=false; draw(); renderLabels(); renderPins(); renderMeasures(); }
  }
  requestAnimationFrame(frame);
}
