// ---------------------------------------------------------------- saving: picture, 3D file, video
let sheetURL = null, sheetFile = null;
// The phone's own share sheet (WhatsApp, Instagram, Photos...). Chrome accepts pictures and videos;
// anything it will not take is downloaded instead.
function canShareFile(file){ try { return !!(navigator.canShare && navigator.canShare({files:[file]})); } catch(e){ return false; } }
function shareFile(blob, name){ const file = blob instanceof File ? blob : new File([blob], name, {type:blob.type});
  if (!canShareFile(file)) return false;
  navigator.share({files:[file], title:'First Return'}).catch(err=>{ if (err.name!=='AbortError') notice('Could not share: '+(err.message||err)); });
  return true; }
function showSheet(url, kind, name, blob){
  if (sheetURL && sheetURL !== url) URL.revokeObjectURL(sheetURL);
  sheetURL = url;
  const img=$('#sheetImg'), vid=$('#sheetVid');
  img.hidden = kind!=='image'; vid.hidden = kind!=='video';
  if (kind==='image') img.src=url; else { vid.src=url; vid.play().catch(()=>{}); }
  $('#sheetDl').href=url; $('#sheetDl').download=name;
  sheetFile = blob ? new File([blob], name, {type:blob.type}) : null;
  $('#sheetShare').hidden = !(sheetFile && canShareFile(sheetFile));
  const how = $('#sheetShare').hidden ? 'Tap Download' : 'Tap Share to send it, or Download to keep it';
  $('#sheetNote').textContent = kind==='image' ? how+'. You can also press and hold the picture.' : how+'.';
  $('#sheet').hidden=false;
}
$('#sheetShare').addEventListener('click', ()=>{ if (!sheetFile) return;
  navigator.share({files:[sheetFile], title:'First Return'}).catch(err=>{ if (err.name!=='AbortError') $('#sheetNote').textContent='Could not share: '+(err.message||err)+'. Use Download instead.'; }); });
$('#sheetClose').addEventListener('click', ()=>{ $('#sheet').hidden=true; $('#sheetVid').pause(); $('#sheetVid').removeAttribute('src'); $('#sheetImg').removeAttribute('src');
  if (sheetURL){ URL.revokeObjectURL(sheetURL); sheetURL=null; } });

function drawLabels2D(x, W, H){
  const fs = H*0.03; x.save(); x.font = `560 ${fs}px Archivo, "Helvetica Neue", Arial, sans-serif`; x.textAlign='center'; x.textBaseline='bottom';
  S.labels.forEach(L=>{ if(!L.text||!L.pos) return; const s=project(L.pos,W,H); if(!s) return;
    x.fillStyle='#fff'; x.shadowColor='rgba(255,255,255,.55)'; x.shadowBlur=fs*0.5; x.fillText(L.text,s[0],s[1]); x.shadowBlur=fs*0.18; x.fillText(L.text,s[0],s[1]); });
  x.restore();
}
function withCanvasSize(W, H, fn){
  const ow=cv.width, oh=cv.height; cv.width=W; cv.height=H;
  const restore = () => { cv.width=ow; cv.height=oh; S.dirtyDraw=true; };
  let r; try { r = fn(); } catch(e){ restore(); throw e; }
  if (r && typeof r.then === 'function') return r.finally(restore);
  restore(); return r;
}
// Picture size applies to pictures; video is capped at 1920, the most phone encoders will take.
function exportSize(long, cap){ const a=frameAspect(); const L=Math.min(S.adv.exportLong || long, cap || 1e9, gl.getParameter(gl.MAX_TEXTURE_SIZE));
  return a>=1 ? [L&~1, Math.round(L/a)&~1] : [Math.round(L*a)&~1, L&~1]; }
async function savePicture(){
  if (!S.count) return;
  busy('Making the picture', null); await tick();
  const [W,H] = exportSize(MOBILE ? 2048 : 2880);
  const c2 = document.createElement('canvas'); c2.width=W; c2.height=H; const x=c2.getContext('2d');
  S.exporting=true; try { withCanvasSize(W, H, ()=>{ draw(W,H); x.drawImage(cv,0,0); }); } finally { S.exporting=false; }
  drawLabels2D(x, W, H); drawMeasures2D(x, W, H);
  c2.toBlob(b=>{ busy(null); showSheet(URL.createObjectURL(b), 'image', 'first-return.png', b); }, 'image/png');
}
async function savePly(){
  if (!S.count) return;
  busy('Making the 3D file', null); await tick();
  const n=S.count, out=S.cpu;
  const head = `ply\nformat binary_little_endian 1.0\ncomment First Return point cloud, units are relative\nelement vertex ${n}\nproperty float x\nproperty float y\nproperty float z\nproperty uchar red\nproperty uchar green\nproperty uchar blue\nend_header\n`;
  const hb = new TextEncoder().encode(head), buf = new ArrayBuffer(hb.length + n*15); new Uint8Array(buf).set(hb); const dv=new DataView(buf);
  for (let i=0;i<n;i++){ const o=i*10, p=hb.length+i*15; dv.setFloat32(p,out[o],true); dv.setFloat32(p+4,out[o+1],true); dv.setFloat32(p+8,out[o+2],true);
    const g = out[o+6]===2 ? 0.25+0.6*out[o+7]**3 : 1;
    dv.setUint8(p+12,Math.min(255,out[o+3]*255*g)); dv.setUint8(p+13,Math.min(255,out[o+4]*255*g)); dv.setUint8(p+14,Math.min(255,out[o+5]*255*g)); }
  const url = URL.createObjectURL(new Blob([buf],{type:'application/octet-stream'}));
  const a = document.createElement('a'); a.href=url; a.download='first-return.ply'; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 30000); busy(null);
  notice(`Saved first-return.ply, ${(buf.byteLength/1e6).toFixed(1)} MB. It opens in Blender, MeshLab or CloudCompare.`);
}

// ---------------------------------------------------------------- camera moves
// Moves are small and slow by default, the drift of documentary footage: long durations, smootherstep
// easing (a slower start and stop than a plain ease), and a Strength that scales every move and effect
// together. Old moves at Strong match what they used to be. dz zoom, dy turn, dp tilt, px/py slide
// (in units of the subject's distance).
const STRENGTH = [['gentle','Gentle',0.4],['medium','Medium',0.75],['strong','Strong',1.25]];
const strength = () => (STRENGTH.find(s=>s[0]===S.strength)||STRENGTH[0])[2];
const MOVES = {
  push:  (t,k)=>({dz:-0.32*k*t}),
  pull:  (t,k)=>({dz:0.28*k*t}),
  slide: (t,k)=>({px:(t-0.5)*0.22*k, dy:(0.5-t)*7*k}),          // a sideways dolly, turning a little to hold the subject
  float: (t,k)=>({dy:Math.sin(t*2*Math.PI)*6*k, dp:Math.sin(t*4*Math.PI)*2.2*k, dz:-0.05*k*Math.sin(t*Math.PI)}),   // ends where it began: loops
  orbit: (t,k)=>({dy:(-14+28*t)*k}),
  drift: (t,k)=>({dz:-0.26*t*k, dy:(-8+16*t)*k, dp:(4-4*t)*k}),
  rise:  (t,k)=>({py:0.12*t*k, dp:10*t*k, dz:-0.1*t*k}),          // the camera rises and looks down a touch
  // Into the scene: the camera itself travels forward (pz, in units of the subject's distance), not a zoom,
  // so near things pass by and the space opens up. Walk in adds the faint rise and fall of steps and a
  // slow glance aside; Glide in is the smooth, drone-like version.
  walk:  (t,k,secs)=>({pz:-0.6*k*t, py:0.0045*k*Math.sin(t*secs*1.8*2*Math.PI) - 0.02*k*t, dy:Math.sin(t*Math.PI)*5*k, dp:-1.5*k*t}),
  glide: (t,k)=>({pz:-0.55*k*t, py:0.06*k*t, dy:Math.sin(t*Math.PI)*3*k, dp:-2*k*t})
};
const MOVE_NAMES = [['walk','Walk in'],['glide','Glide in'],['push','Push in'],['pull','Pull out'],['slide','Slide'],['float','Float'],['drift','Drift'],['orbit','Orbit'],['rise','Rise']];
const LOOPING = new Set(['float']);
// walking keeps an even pace, only softened at the very start and end
const WALKING = new Set(['walk','glide']);   // (a flat photo cannot be walked past, so the walk arrives calmly rather than lunging)
const ease = t => t*t*t*(t*(6*t-15)+10);
// Loop plays a move out and back (Float already ends where it began), so the clip repeats with no jump
const loopT = (move, t) => S.loop && !LOOPING.has(move) ? (t<0.5 ? 2*t : 2-2*t) : t;
function poseAt(base, move, t, secs=6){
  const tt = Math.min(1,Math.max(0,t)), e = LOOPING.has(move) ? tt : WALKING.has(move) ? 0.35*tt+0.65*ease(tt) : ease(tt);
  const m = MOVES[move](e, strength(), secs), R = S.refDist||2;
  return {yaw:base.yaw+(m.dy||0), pitch:Math.max(-80,Math.min(80,base.pitch+(m.dp||0))), zoom:Math.max(0.3, base.zoom*(1+(m.dz||0))),
    pan:[base.pan[0]+(m.px||0)*R, base.pan[1]+(m.py||0)*R, base.pan[2]+(m.pz||0)*R]}; }
const viewBase = () => ({yaw:S.yaw, pitch:S.pitch, zoom:S.zoom, pan:S.pan.slice()});

// portion: play only the opening of the move at its real speed (a quick look when a chip is tapped)
// peek: a quick look from a chip tap, which leaves the controls free (the next tap cuts it off).
// Stop ends any preview or video early.
async function previewMove(move, secs, portion=1, peek=false){
  if (S.recording || !S.count) return;
  const base=viewBase(), dur=secs*1000*portion;
  S.recording=true; S.peeking=peek; S.stopReq=false; S.spin=false; syncSpin(); $('#recbar').hidden=false; $('#stopBtn').hidden=false;
  if (!peek) document.body.classList.add('locked');
  banner(portion<1 ? 'Playing the start of the move' : 'Playing the move');
  S.fxNow = S.fx||'none';
  await new Promise(res=>{ const t0=performance.now(); const step=()=>{ const el=performance.now()-t0, t=Math.min(1,el/dur)*portion;
    const lt = loopT(move, t); Object.assign(S, poseAt(base, move, lt, secs)); S.fxT=lt; S.fxTime=el/1000; draw(); renderLabels(); renderPins();
    $('#recfill').style.width=(Math.min(1,el/dur)*100)+'%'; if (el<dur && !S.stopReq) requestAnimationFrame(step); else res(); }; requestAnimationFrame(step); });
  S.recording=false; S.peeking=false; S.stopReq=false; S.fxNow='none'; $('#recbar').hidden=true; $('#stopBtn').hidden=true; document.body.classList.remove('locked'); Object.assign(S, base); S.dirtyDraw=true; banner(modeText());
}
$('#stopBtn').addEventListener('click', ()=>{ S.stopReq = true; });

// Frame by frame with WebCodecs: every frame is rendered at its exact time, so a slow phone makes a
// slower export, never a jerky video. Older browsers fall back to recording the screen in real time.
async function recordMove(move, secs){
  if (S.recording || !S.count) return;
  const base=viewBase(), fps=30, hold=Math.round(fps*(LOOPING.has(move)||S.loop?0:0.4)), frames=Math.round(secs*fps)+2*hold;
  const [W,H] = exportSize(MOBILE ? 1280 : 1920, 1920);
  const rc=document.createElement('canvas'); rc.width=W; rc.height=H; const rx=rc.getContext('2d');
  // a loop's last frame stops one short of its first, so the repeat is seamless
  const frameAt = i => { const t = S.loop||LOOPING.has(move) ? i/frames : (i-hold)/(frames-2*hold-1), lt=loopT(move, Math.min(1,Math.max(0,t))); Object.assign(S, poseAt(base, move, lt, secs)); S.fxT=lt; S.fxTime=i/fps; draw(W,H); rx.drawImage(cv,0,0); drawLabels2D(rx,W,H); drawMeasures2D(rx,W,H); };
  S.recording=true; S.exporting=true; S.stopReq=false; S.fxNow=S.fx||'none'; S.spin=false; syncSpin(); $('#recbar').hidden=false; $('#stopBtn').hidden=false; document.body.classList.add('locked'); stayAwake(true);
  let blob=null, ext='mp4';
  try {
    let config=null;
    if (window.VideoEncoder){
      if (!window.Mp4Muxer) await loadScript('vendor/mp4-muxer.js');
      for (const codec of ['avc1.640028','avc1.4D4028','avc1.42E028','avc1.42001f']){
        const c={codec, width:W, height:H, bitrate: MOBILE?8e6:14e6, framerate:fps};
        try { const s=await VideoEncoder.isConfigSupported(c); if (s.supported){ config=c; break; } } catch(e){}
      }
    }
    if (config){
      banner('Making the video');
      const muxer = new Mp4Muxer.Muxer({target:new Mp4Muxer.ArrayBufferTarget(), video:{codec:'avc', width:W, height:H}, fastStart:'in-memory'});
      let failed=null;
      const enc = new VideoEncoder({output:(chunk,meta)=>muxer.addVideoChunk(chunk,meta), error:e=>{ failed=e; }});
      enc.configure(config);
      await withCanvasSize(W, H, async ()=>{
        for (let i=0;i<frames && !failed && !S.stopReq;i++){
          frameAt(i);
          const vf = new VideoFrame(rc, {timestamp:Math.round(i*1e6/fps), duration:Math.round(1e6/fps)});
          enc.encode(vf, {keyFrame: i%60===0}); vf.close();
          while (enc.encodeQueueSize > 4) await new Promise(r=>setTimeout(r,4));
          $('#recfill').style.width=((i+1)/frames*100)+'%';
          if (i%6===0) await new Promise(r=>setTimeout(r,0));
        }
        await enc.flush();
      });
      enc.close(); if (failed) throw failed;
      muxer.finalize(); blob = new Blob([muxer.target.buffer], {type:'video/mp4'});
    } else {
      const mime = ['video/mp4','video/webm;codecs=vp9','video/webm'].find(m=>window.MediaRecorder && MediaRecorder.isTypeSupported(m));
      if (!mime) throw new Error('This browser cannot make videos. Try Chrome or Edge.');
      ext = mime.includes('mp4') ? 'mp4' : 'webm'; banner('Recording the move');
      const rec = new MediaRecorder(rc.captureStream(30), {mimeType:mime, videoBitsPerSecond: MOBILE?8e6:14e6}), chunks=[];
      rec.ondataavailable = e=>{ if (e.data && e.data.size) chunks.push(e.data); };
      rec.start(250);
      await withCanvasSize(W, H, ()=>new Promise(res=>{ const t0=performance.now(), dur=frames/fps*1000;
        const step=()=>{ const el=performance.now()-t0; frameAt(Math.min(frames-1, Math.round(el/1000*fps)));
          $('#recfill').style.width=(Math.min(1,el/dur)*100)+'%'; if (el<dur) requestAnimationFrame(step); else res(); }; requestAnimationFrame(step); }));
      await new Promise(r=>{ rec.onstop=r; rec.stop(); });
      blob = new Blob(chunks, {type:mime.split(';')[0]});
    }
  } catch(err){ console.error(err); notice('The video could not be made: '+String(err.message||err)); }
  const stopped = S.stopReq; if (stopped){ blob=null; notice('Stopped. No video was saved.'); }
  S.recording=false; S.exporting=false; S.stopReq=false; S.fxNow='none'; $('#recbar').hidden=true; $('#stopBtn').hidden=true; document.body.classList.remove('locked'); stayAwake(false); Object.assign(S, base); S.dirtyDraw=true;
  if (blob){ banner(modeText()); showSheet(URL.createObjectURL(blob), 'video', 'first-return.'+ext, blob); }
}
