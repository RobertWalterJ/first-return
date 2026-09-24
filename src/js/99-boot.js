// ---------------------------------------------------------------- start
async function boot(){
  if (!initGL()){ banner('This browser has no WebGL2, which drawing the dots needs.'); return; }
  const saved = recall('state');
  look = saved && LOOKS[saved.look] ? saved.look : 'void';
  LOOK_KEYS.forEach(k=>{ P[k]=LOOKS[look][k]; });
  if (saved && saved.P) LOOK_KEYS.forEach(k=>{ if (saved.P[k]!=null && typeof saved.P[k]===typeof P[k]) P[k]=saved.P[k]; });
  S.shape = saved && saved.shape ? saved.shape : (MOBILE ? 'photo' : 'wide');
  const L=LOOKS[look]; S.yaw=L.yaw; S.pitch=L.pitch; S.zoom=L.zoom;
  setTab(recall('tab') || 'look');
  layout(); requestAnimationFrame(frame);
  try {
    const [pi, db] = await Promise.all([
      new Promise((res,rej)=>{ const im=new Image(); im.onload=()=>res(im); im.onerror=()=>rej(new Error('sample')); im.src='sample.jpg'; }),
      fetch('sample-depth.png').then(r=>r.blob())]);
    const c=document.createElement('canvas'); c.width=pi.naturalWidth; c.height=pi.naturalHeight; const x=c.getContext('2d',{willReadFrequently:true}); x.drawImage(pi,0,0);
    // decode the 16-bit depth without colour management, which would alter the low byte
    const bmp = await createImageBitmap(db, {colorSpaceConversion:'none', premultiplyAlpha:'none'});
    const d=document.createElement('canvas'); d.width=bmp.width; d.height=bmp.height; const dx=d.getContext('2d',{willReadFrequently:true}); dx.drawImage(bmp,0,0);
    const px=dx.getImageData(0,0,d.width,d.height).data, raw=new Float32Array(d.width*d.height);
    for (let i=0;i<raw.length;i++) raw[i]=(px[i*4]*256+px[i*4+1])/65535;
    await setPhoto({canvas:c, w:c.width, h:c.height, data:x.getImageData(0,0,c.width,c.height).data, fov:{tanV:Math.tan(25*Math.PI/180), src:'museum photo, lens assumed'}},
      normaliseDepth({w:d.width, h:d.height, d:raw}),
      'Sample: Abraham Lincoln: The Man (Standing Lincoln), Augustus Saint-Gaudens, The Metropolitan Museum of Art, public domain (CC0).');
    // a name over the sample's head, to show what names look like
    requestAnimationFrame(()=>{ const c0=S.comps.slice().sort((a,b)=>b.n-a.n)[0];
      if (c0){ const Lb={u:c0.topUV[0], v:c0.topUV[1], lift:(c0.maxY-c0.minY)*0.07, text:'Standing Lincoln'}; Lb.pos=labelWorld(Lb); S.labels=[Lb]; S.dirtyDraw=true; if (S.tab==='people') renderTray(); } });
  } catch(err){ console.error(err); banner('Tap Open to choose a photo.'); }
}
window.__fr = {S, P, LOOKS, build, setTab, queueThumbs};   // for testing from the console
boot();
