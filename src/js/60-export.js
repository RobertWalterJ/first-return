// ---------------------------------------------------------------- saving: picture, 3D file, video
let sheetURL = null;
function showSheet(url, kind, name){
  if (sheetURL && sheetURL !== url) URL.revokeObjectURL(sheetURL);
  sheetURL = url;
  const img=$('#sheetImg'), vid=$('#sheetVid');
  img.hidden = kind!=='image'; vid.hidden = kind!=='video';
  if (kind==='image') img.src=url; else { vid.src=url; vid.play().catch(()=>{}); }
  $('#sheetDl').href=url; $('#sheetDl').download=name;
  $('#sheetNote').textContent = kind==='image' ? 'Tap Download, or press and hold the picture to save it.' : 'Tap Download to save the video.';
  $('#sheet').hidden=false;
}
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
function exportSize(long){ const a=frameAspect(); const L=Math.min(S.adv.exportLong || long, gl.getParameter(gl.MAX_TEXTURE_SIZE));
  return a>=1 ? [L&~1, Math.round(L/a)&~1] : [Math.round(L*a)&~1, L&~1]; }
async function savePicture(){
  if (!S.count) return;
  busy('Making the picture', null); await tick();
  const [W,H] = exportSize(MOBILE ? 2048 : 2880);
  const c2 = document.createElement('canvas'); c2.width=W; c2.height=H; const x=c2.getContext('2d');
  withCanvasSize(W, H, ()=>{ draw(W,H); x.drawImage(cv,0,0); });
  drawLabels2D(x, W, H);
  c2.toBlob(b=>{ busy(null); showSheet(URL.createObjectURL(b), 'image', 'first-return.png'); }, 'image/png');
}
function savePly(){
  if (!S.count) return;
  const n=S.count, out=S.cpu;
  const head = `ply\nformat binary_little_endian 1.0\ncomment First Return point cloud, units are relative\nelement vertex ${n}\nproperty float x\nproperty float y\nproperty float z\nproperty uchar red\nproperty uchar green\nproperty uchar blue\nend_header\n`;
  const hb = new TextEncoder().encode(head), buf = new ArrayBuffer(hb.length + n*15); new Uint8Array(buf).set(hb); const dv=new DataView(buf);
  for (let i=0;i<n;i++){ const o=i*10, p=hb.length+i*15; dv.setFloat32(p,out[o],true); dv.setFloat32(p+4,out[o+1],true); dv.setFloat32(p+8,out[o+2],true);
    const g = out[o+6]===2 ? 0.25+0.6*out[o+7]**3 : 1;
    dv.setUint8(p+12,Math.min(255,out[o+3]*255*g)); dv.setUint8(p+13,Math.min(255,out[o+4]*255*g)); dv.setUint8(p+14,Math.min(255,out[o+5]*255*g)); }
  const url = URL.createObjectURL(new Blob([buf],{type:'application/octet-stream'}));
  const a = document.createElement('a'); a.href=url; a.download='first-return.ply'; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 30000);
  notice(`Saved first-return.ply, ${(buf.byteLength/1e6).toFixed(1)} MB. It opens in Blender, MeshLab or CloudCompare.`);
}

// ---------------------------------------------------------------- camera moves
const MOVES = {
  push:  t=>({dz:-0.32*t}),
  orbit: t=>({dy:-14+28*t}),
  drift: t=>({dz:-0.26*t, dy:-8+16*t, dp:4-4*t}),
  rise:  t=>({dy:22*t, dp:16*t, dz:-0.12*t})
};
const ease = t => 0.5-0.5*Math.cos(Math.PI*t);
function poseAt(base, move, t){ const m=MOVES[move](ease(Math.min(1,Math.max(0,t))));
  return {yaw:base.yaw+(m.dy||0), pitch:Math.max(-80,Math.min(80,base.pitch+(m.dp||0))), zoom:Math.max(0.3, base.zoom*(1+(m.dz||0)))}; }

async function previewMove(move, secs){
  if (S.recording || !S.count) return;
  const base={yaw:S.yaw,pitch:S.pitch,zoom:S.zoom}, dur=secs*1000;
  S.recording=true; S.spin=false; syncSpin(); $('#recbar').hidden=false; banner('Playing the move');
  await new Promise(res=>{ const t0=performance.now(); const step=()=>{ const el=performance.now()-t0;
    Object.assign(S, poseAt(base, move, el/dur)); draw(); renderLabels(); renderPins();
    $('#recfill').style.width=(Math.min(1,el/dur)*100)+'%'; if (el<dur) requestAnimationFrame(step); else res(); }; requestAnimationFrame(step); });
  S.recording=false; $('#recbar').hidden=true; Object.assign(S, base); S.dirtyDraw=true; banner(modeText());
}

// Frame by frame with WebCodecs: every frame is rendered at its exact time, so a slow phone makes a
// slower export, never a jerky video. Older browsers fall back to recording the screen in real time.
async function recordMove(move, secs){
  if (S.recording || !S.count) return;
  const base={yaw:S.yaw,pitch:S.pitch,zoom:S.zoom}, fps=30, hold=Math.round(fps*0.4), frames=Math.round(secs*fps)+2*hold;
  const [W,H] = exportSize(MOBILE ? 1280 : 1920);
  const rc=document.createElement('canvas'); rc.width=W; rc.height=H; const rx=rc.getContext('2d');
  const frameAt = i => { const t=(i-hold)/(frames-2*hold-1); Object.assign(S, poseAt(base, move, t)); draw(W,H); rx.drawImage(cv,0,0); drawLabels2D(rx,W,H); };
  S.recording=true; S.spin=false; syncSpin(); $('#recbar').hidden=false; document.body.classList.add('locked');
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
        for (let i=0;i<frames && !failed;i++){
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
  } catch(err){ console.error(err); banner(String(err.message||err)); }
  S.recording=false; $('#recbar').hidden=true; document.body.classList.remove('locked'); Object.assign(S, base); S.dirtyDraw=true;
  if (blob){ banner(modeText()); showSheet(URL.createObjectURL(blob), 'video', 'first-return.'+ext); }
}
