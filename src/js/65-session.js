// ---------------------------------------------------------------- picking up where you left off
// A phone often throws a page away while you are in another app, and coming back reloads it. The work
// in progress is kept on this device (IndexedDB, never uploaded) so it comes back as it was: the photo
// and its depth (or the scan file), what was picked, names, hidden faces, settings and the view.
// The photo is saved once per photo; the rest after each change and whenever the page goes to the back.
const SESSION_DB = 'first-return-session';
function sessionDb(){
  return new Promise((res, rej)=>{ const r = indexedDB.open(SESSION_DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}
async function sessionPut(key, value){
  try { const db = await sessionDb(); await new Promise((res, rej)=>{ const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(value, key);
    t.oncomplete = res; t.onerror = () => rej(t.error); }); db.close(); } catch(e){ console.warn('could not keep the work for later', e); }
}
async function sessionGet(key){
  try { const db = await sessionDb(); const v = await new Promise((res, rej)=>{ const r = db.transaction('kv').objectStore('kv').get(key);
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); db.close(); return v; } catch(e){ return null; }
}
const canvasBlob = c => new Promise(r=>c.toBlob(r, 'image/jpeg', 0.92));

let mediaId = null;
async function saveMedia(m){
  mediaId = 'm' + Date.now().toString(36); m.id = mediaId;
  await sessionPut('media', m); saveSessionNow();
}
// What is needed to rebuild the work on top of the saved photo or scan.
function sessionState(){
  return {v:1, media:mediaId, savedAt:Date.now(),
    picks: S.picks.map(p=>({u:p.u, v:p.v, name:p.name, box:p.box, seg:p.seg||null})), band:S.band, sharp:!!S.sharp,
    labels: S.labels.map(L=>({u:L.u, v:L.v, lift:L.lift, fixed:L.fixed, text:L.text})),
    faces: S.faces.map(f=>({...f})), facesFound:S.facesFound, anon:S.anon, anonLevel:S.anonLevel,
    view: {yaw:S.yaw, pitch:S.pitch, zoom:S.zoom, pan:S.pan.slice(), pivot:S.pivot.slice(), home:S.home, userMoved:S.userMoved, refDist:S.refDist},
    adv: {fov:S.adv.fov, ratio:S.adv.ratio, roll:S.adv.roll, beams:S.adv.beams, noise:S.adv.noise},
    light:P.light, lightAuto:S.lightAuto};
}
function saveSessionNow(){ if (!mediaId || S.isSample || S.restoring) return; sessionPut('state', sessionState()); }
let sessionQueued = false;
function queueSessionSave(){ if (sessionQueued) return; sessionQueued = true;
  window.requestIdleCallback ? requestIdleCallback(()=>{ sessionQueued=false; saveSessionNow(); }, {timeout:2000}) : setTimeout(()=>{ sessionQueued=false; saveSessionNow(); }, 800); }
// going to the back is the moment that matters: the page may not get another chance
document.addEventListener('visibilitychange', ()=>{ if (document.visibilityState==='hidden') saveSessionNow(); });
addEventListener('pagehide', saveSessionNow);

async function restoreSession(){
  const m = await sessionGet('media'); if (!m) return false;
  const st = await sessionGet('state'); const ok = st && st.media===m.id ? st : null;
  const g = ++S.gen; S.restoring = true;
  try {
    busy('Picking up where you left off', null); await tick();
    if (m.kind==='scan'){ await openScan(m.file); if (g!==S.gen) return true; }
    else {
      const bmp = await createImageBitmap(m.blob), c = document.createElement('canvas'); c.width=bmp.width; c.height=bmp.height;
      const x = c.getContext('2d', {willReadFrequently:true}); x.drawImage(bmp, 0, 0);
      const ph = {canvas:c, w:c.width, h:c.height, data:x.getImageData(0,0,c.width,c.height).data, fov:m.fov, url:URL.createObjectURL(m.blob)};
      const anon = ok && ok.anon; S.anon = false;               // faces come back from the saved list, not a new search
      await setPhoto(ph, m.depth, m.credit, {picks: ok ? ok.picks.map(p=>({...p, seg:p.seg||undefined})) : []});
      if (g!==S.gen) return true;
      if (ok){
        S.band = ok.band; S.sharp = ok.sharp;
        S.faces = ok.faces||[]; S.facesFound = !!ok.facesFound; S.anonLevel = ok.anonLevel; S.anon = !!anon; applyAnon();
        if (ok.light!=null){ S.autoLight = false; P.light = ok.light; S.lightAuto = ok.lightAuto; }
      }
    }
    mediaId = m.id;
    if (ok){
      Object.assign(S.adv, ok.adv);
      if (S.adv.fov) S.tanV = Math.tan(S.adv.fov*Math.PI/360);
      if (S.adv.roll!=null) S.roll = S.adv.roll*Math.PI/180;
      S.labels = (ok.labels||[]).map(L=>{ const o={...L}; if (!o.fixed) delete o.fixed; o.pos = labelWorld(o); return o; });
      const V = ok.view; S.autoFrame = false; S.reframe = false;
      Object.assign(S, {yaw:V.yaw, pitch:V.pitch, zoom:V.zoom, pan:V.pan, pivot:V.pivot, home:V.home, userMoved:V.userMoved});
      if (V.refDist){ S.refDist = V.refDist; S.refFrozen = true; }
    }
    S.dirtyBuild = true; busy(null); renderTray(); viewButton();
    notice('Back where you left off. Open starts something new.');
    return true;
  } catch(err){
    console.error(err); busy(null); sessionPut('media', null); mediaId = null; return false;   // a damaged save is dropped, and the sample loads
  } finally { S.restoring = false; }
}
