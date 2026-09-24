import fs from 'node:fs'; import ort from 'onnxruntime-node'; import jpeg from 'jpeg-js';
const sess = await ort.InferenceSession.create('yunet.onnx', {logSeverityLevel:3});
async function detect(img, sx, sy, sw, sh){
  // letterbox the crop into 640x640, BGR, 0..255
  const S=640, s=Math.min(S/sw, S/sh), t=new Float32Array(3*S*S);
  for (let y=0;y<S;y++) for (let x=0;x<S;x++){ const X=Math.floor(sx+x/s), Y=Math.floor(sy+y/s); if (x/s>=sw || y/s>=sh) continue;
    const i=(Y*img.width+X)*4; t[y*S+x]=img.data[i+2]; t[S*S+y*S+x]=img.data[i+1]; t[2*S*S+y*S+x]=img.data[i]; }
  const r = await sess.run({input:new ort.Tensor('float32', t, [1,3,S,S])}); const out=[];
  for (const st of [8,16,32]){ const cols=S/st, cls=r['cls_'+st].data, obj=r['obj_'+st].data, bb=r['bbox_'+st].data;
    for (let i=0;i<cls.length;i++){ const sc=Math.sqrt(Math.min(1,Math.max(0,cls[i]))*Math.min(1,Math.max(0,obj[i]))); if (sc<0.6) continue;
      const rr=Math.floor(i/cols), cc=i%cols, cx=(cc+bb[i*4])*st, cy=(rr+bb[i*4+1])*st, w=Math.exp(bb[i*4+2])*st, h=Math.exp(bb[i*4+3])*st;
      out.push({s:+sc.toFixed(2), x:Math.round(sx+(cx-w/2)/s), y:Math.round(sy+(cy-h/2)/s), w:Math.round(w/s), h:Math.round(h/s)}); } }
  return out;
}
for (const f of process.argv.slice(2)){
  const img = jpeg.decode(fs.readFileSync(f), {useTArray:true, maxMemoryUsageInMB:2048});
  const all = await detect(img, 0, 0, img.width, img.height);
  // keep the best of overlapping boxes
  all.sort((a,b)=>b.s-a.s); const keep=[]; for (const b of all) if (!keep.some(k=>Math.abs(k.x-b.x)<k.w*0.5 && Math.abs(k.y-b.y)<k.h*0.5)) keep.push(b);
  console.log(f, img.width+'x'+img.height, keep.length, 'faces', JSON.stringify(keep.slice(0,6)));
}
