// ---------------------------------------------------------------- video clips
// A short clip becomes a moving point cloud (or moving splats): up to 6 seconds, read at 8 frames a second
// (6 on a phone), each frame given depth. Depth models normalise every frame on their own, which makes a
// clip flicker, so each frame's range is eased toward the frames before it. The first frame goes through
// the full photo steps (finder, floors, sky); the rest reuse that setup, so the scene holds still around
// what moves. Frames are kept as small JPEGs plus depth, to stay light on a phone.
// Recorded videos step through the clip while the camera move and effect play (once, or out and back
// with Loop); the Move tab's Clip frame slider chooses what the still view shows.
async function openClip(file){
  const g = ++S.gen, url = URL.createObjectURL(file), vid = document.createElement('video');
  vid.muted = true; vid.playsInline = true; vid.preload = 'auto'; vid.src = url;
  busy('Opening the clip', null);
  await new Promise((res, rej)=>{ vid.onloadeddata = res; vid.onerror = () => rej(new Error('this video could not be read')); });
  // clips recorded in a browser often report an endless length until played to the end once
  if (!isFinite(vid.duration)){ vid.currentTime = 1e7; await new Promise(res=>{ vid.ondurationchange = res; vid.onseeked = res; setTimeout(res, 3000); }); vid.currentTime = 0; }
  if (!(vid.duration > 0.2) || !isFinite(vid.duration)) throw new Error('this clip has no length the browser can read');
  const fps = MOBILE ? 6 : 8, dur = Math.min(6, vid.duration), n = Math.max(2, Math.min(48, Math.floor(dur*fps)));
  const LONG = MOBILE ? 960 : 1280, s = Math.min(1, LONG/Math.max(vid.videoWidth, vid.videoHeight));
  const w = Math.round(vid.videoWidth*s), h = Math.round(vid.videoHeight*s);
  const frames = []; let lo = null, hi = null;
  for (let i=0;i<n;i++){
    busy(`Reading depth, frame ${i+1} of ${n}`, i/n);
    vid.currentTime = Math.min(dur - 0.01, i/fps);
    await new Promise(res=>{ vid.onseeked = res; });
    if (g!==S.gen){ URL.revokeObjectURL(url); return; }
    const c = document.createElement('canvas'); c.width=w; c.height=h; c.getContext('2d').drawImage(vid, 0, 0, w, h);
    const raw = await estimateDepth(c); if (g!==S.gen){ URL.revokeObjectURL(url); return; }
    // this frame's range, eased toward the clip's so far, so depth does not pump from frame to frame
    const srt = Float32Array.from(raw.d).sort(), l0 = srt[Math.floor(srt.length*0.005)], h0 = srt[Math.min(srt.length-1, Math.floor(srt.length*0.9995))];
    lo = lo==null ? l0 : lo*0.75 + l0*0.25; hi = hi==null ? h0 : hi*0.75 + h0*0.25;
    const d = new Float32Array(raw.d.length); for (let k=0;k<d.length;k++) d[k] = Math.min(1, Math.max(0, (raw.d[k]-lo)/(hi-lo||1)));
    frames.push({blob: await canvasBlob(c), depth: {w:raw.w, h:raw.h, d}});
  }
  URL.revokeObjectURL(url);
  // the first frame sets up the scene like a photo
  const bmp = await createImageBitmap(frames[0].blob), c0 = document.createElement('canvas'); c0.width=w; c0.height=h; const x0 = c0.getContext('2d', {willReadFrequently:true}); x0.drawImage(bmp, 0, 0);
  const ph = {canvas:c0, w, h, data:x0.getImageData(0,0,w,h).data, fov:{tanV:Math.tan(25*Math.PI/180), src:'video clip, lens assumed'}, url:URL.createObjectURL(frames[0].blob)};
  S.clip = null;
  await setPhoto(ph, frames[0].depth, `Video clip: ${n} frames over ${dur.toFixed(1)} seconds. It stayed on this device.`);
  if (g!==S.gen) return;
  // outlines belong to one moment; across a clip the subject is followed by depth from the same taps
  S.picks.forEach(p=>{ delete p.seg; delete p.box; });
  S.clip = {frames, fps, n, w, h, shown:0, want:0};
  notice(`Opened a clip: ${n} frames. Moves and effects play it in the video; Clip frame on the Move tab picks the still.`);
  renderTray();
}
// Show clip frame i: its picture and depth, with the scene set up from the first frame. The view, its
// pivot and the scene's range are held, so the camera does not jump as the frames change.
async function clipFrame(i){
  const C = S.clip; if (!C) return; i = Math.max(0, Math.min(C.n-1, i|0)); if (C.shown===i && S.photoSrc && S.photoSrc.clipI===i) return;
  const F = C.frames[i], bmp = await createImageBitmap(F.blob), c = document.createElement('canvas'); c.width=C.w; c.height=C.h;
  const x = c.getContext('2d', {willReadFrequently:true}); x.drawImage(bmp, 0, 0);
  S.photoCanvas = c; S.photo = S.photoSrc = {w:C.w, h:C.h, data:x.getImageData(0,0,C.w,C.h).data, clipI:i};
  S.depthSrc = S.depth = refineDepth(F.depth, c); S.sky = skyMask(S.depth);
  S.ground = groundMask(S.depth, S.planes); S.autoCut = otsu(S.depth.d, S.ground);
  S.depthVer++; S.compCache = null; S.fillCache = null;
  if (S.anon) applyAnon();
  const keep = {target:S.target.slice(), pivot:S.pivot.slice(), pan:S.pan.slice(), userMoved:S.userMoved, rng:S.rng.slice(), yr:S.yr.slice()};
  S.userMoved = true; build(); Object.assign(S, keep);
  C.shown = i;
}
// which clip frame belongs at time t (seconds) of a move lasting secs: once through, or out and back
function clipIndexAt(t, secs){
  const C = S.clip; if (!C) return 0;
  const f = t*C.fps; if (!S.loop) return Math.min(C.n-1, Math.floor(f));
  const period = 2*(C.n-1); let k = Math.floor(f) % period; if (k >= C.n) k = period - k; return k;
}
$('#fileClip').addEventListener('change', async e=>{
  const f = e.target.files[0]; if (!f) return; e.target.value='';
  try { await openClip(f); } catch(err){ console.error(err); busy(null); notice('Could not read that clip: '+(err.message||err)); }
});
