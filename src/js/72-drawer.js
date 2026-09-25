// ---------------------------------------------------------------- the menu tray
// Everything that is not about the picture in front of you right now: ways to make something, how the
// picture is framed and measured, files to save, settings and About. The top bar keeps only the two things
// used every time (Open and Save); the tabs keep the looks and controls.
const DICON = {
  photo:'<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M21 16l-5-5-8 8"/>',
  live:'<circle cx="12" cy="12" r="3"/><path d="M4 8V5h3M17 5h3v3M20 16v3h-3M7 19H4v-3"/>',
  video:'<rect x="3" y="6" width="13" height="12" rx="2"/><path d="M16 10l5-3v10l-5-3"/>',
  scan:'<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 12l8-4.5M12 12v9M12 12L4 7.5"/>',
  measure:'<path d="M3 16l13-13 5 5-13 13z"/><path d="M7 12l2 2M10 9l2 2M13 6l2 2"/>',
  spin:'<ellipse cx="12" cy="15" rx="8" ry="3"/><path d="M12 12V4"/><path d="M16 7l-4-3-4 3"/>',
  picture:'<path d="M12 4v11"/><path d="M7 10l5 5 5-5"/><path d="M4 20h16"/>',
  points:'<circle cx="6" cy="7" r="1.3"/><circle cx="12" cy="5" r="1.3"/><circle cx="18" cy="8" r="1.3"/><circle cx="8" cy="13" r="1.3"/><circle cx="15" cy="13" r="1.3"/><circle cx="11" cy="19" r="1.3"/>',
  splat:'<ellipse cx="12" cy="12" rx="8" ry="4"/><ellipse cx="12" cy="12" rx="3" ry="7"/>',
  about:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6"/><path d="M12 7.5v.5"/>',
  close:'<path d="M6 6l12 12M18 6L6 18"/>'
};
const dItem = (id, icon, name, sub, pressed) => `<button class="ditem" data-d="${id}"${pressed!=null ? ` aria-pressed="${pressed}"` : ''}><svg viewBox="0 0 24 24">${DICON[icon]}</svg><span>${name}${sub ? `<small>${sub}</small>` : ''}</span></button>`;

function renderDrawer(){
  const d=$('#drawer'), px = S.adv.exportLong || (MOBILE ? 2048 : 2880), splats = hasSplats();
  d.innerHTML = `<div class="dhead"><b>First Return</b><button class="fb" id="dClose" aria-label="Close the menu"><svg viewBox="0 0 24 24">${DICON.close}</svg></button></div>
    <div class="dsec">Make something</div>
    ${dItem('photo','photo','Photo','From your camera or gallery')}
    ${dItem('live','live','Live scan','Walk around something; the phone picks the views')}
    ${dItem('vscan','video','Scan from a video','10 to 30 seconds of walking slowly around it')}
    ${dItem('scan','scan','Open a 3D scan','.ply, .splat or .spz from a scanning app')}
    <div class="dsec">Picture</div>
    <div class="dlabel">Shape</div>
    <div class="dseg">${[['photo','As the photo'],['wide','Wide'],['square','Square'],['tall','Tall']].map(([v,n])=>`<button class="chip" data-shape="${v}" aria-pressed="${S.shape===v}">${n}</button>`).join('')}</div>
    ${dItem('measure','measure','Measure','Heights and distances in the picture', !!S.measure)}
    ${dItem('spin','spin','Turntable','The view turns slowly by itself', $('#spin').getAttribute('aria-pressed')==='true')}
    <div class="dsec">Save and share</div>
    ${dItem('png','picture','Save the picture',`PNG, ${px} pixels on the long side`)}
    <div class="dlabel">Picture size</div>
    <div class="dseg">${PIC_SIZES.map(v=>`<button class="chip" data-size="${v??''}" aria-pressed="${(S.adv.exportLong??null)===v}">${v ? v : 'Auto'}</button>`).join('')}</div>
    ${dItem('video','video','Make a video','Choose a move on the Move tab, then Record')}
    ${dItem('ply','points','Points (.ply)','For Blender, MeshLab, CloudCompare')}
    ${splats ? dItem('spz','splat','Splat, small (.spz)','For SuperSplat and splat apps') + dItem('splatply','splat','Splat, full (.ply)','Larger, for any 3DGS tool') : ''}
    <div class="dsec">About</div>
    ${dItem('about','about','About First Return','What it does, and the models and credits')}`;
  $('#dClose').addEventListener('click', ()=>closeDrawer());
  d.querySelectorAll('[data-shape]').forEach(b=>b.addEventListener('click', ()=>{ setShape(b.dataset.shape); renderDrawer(); }));
  d.querySelectorAll('[data-size]').forEach(b=>b.addEventListener('click', ()=>{ S.adv.exportLong = b.dataset.size ? +b.dataset.size : null; persist(); renderDrawer(); }));
  d.querySelectorAll('[data-d]').forEach(b=>b.addEventListener('click', ()=>{ const v=b.dataset.d; closeDrawer();
    if (v==='photo') $('#file').click(); else if (v==='vscan') $('#fileVideo').click(); else if (v==='scan') $('#fileScan').click();
    else if (v==='live') openLiveScan();
    else if (v==='measure') setMeasure(!S.measure); else if (v==='spin') $('#spin').click();
    else if (v==='png') savePicture(); else if (v==='ply') savePly(); else if (v==='spz') saveSplatSpz(); else if (v==='splatply') saveSplatPly();
    else if (v==='video') setTab('move'); else if (v==='about') showAbout(); }));
}
function openDrawer(){ renderDrawer(); $('#drawer').hidden=false; $('#scrim').hidden=false; $('#menuBtn').setAttribute('aria-expanded','true'); $('#dClose').focus(); }
function closeDrawer(){ $('#drawer').hidden=true; $('#scrim').hidden=true; $('#menuBtn').setAttribute('aria-expanded','false'); }
$('#menuBtn').addEventListener('click', e=>{ e.stopPropagation(); document.querySelectorAll('.menu').forEach(x=>x.hidden=true); $('#drawer').hidden ? openDrawer() : closeDrawer(); });
$('#scrim').addEventListener('click', ()=>closeDrawer());
$('#drawer').addEventListener('click', e=>e.stopPropagation());
document.addEventListener('keydown', e=>{ if (e.key==='Escape' && !$('#drawer').hidden) closeDrawer(); });
