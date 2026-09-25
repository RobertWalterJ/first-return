// ---------------------------------------------------------------- drawing splats
// Each splat becomes a screen-facing quad shaped by its 3D size and rotation seen from the camera (the
// standard 3DGS projection: the 3D covariance through the view and the perspective Jacobian), drawn
// back to front with premultiplied blending. Splats live in one integer texture, two texels each:
// position and colour, then the covariance as six halves plus a flag. A worker sorts them by depth
// while you move, so turning stays smooth; exports sort in place so every frame is exact.
const SPLAT_VS = `#version 300 es
precision highp float; precision highp int;
uniform highp usampler2D uData; uniform mat4 uProj, uView; uniform vec2 uFocal, uVp, uR;
uniform float uCovK, uExposure, uOrbit, uFxT, uTime, uLin, uFxK, uFocus, uDof, uFocusD, uNearF; uniform int uFx, uMix;
layout(location=0) in vec2 aCorner; layout(location=1) in uint aIndex;
out vec4 vCol; out vec2 vPos;
float hsh(float n){ return fract(sin(n*12.9898+4.1)*43758.5453); }
// an integer hash: sin() hashes lose precision at large inputs, so neighbouring splats (one row of the
// photo) got nearly the same number and moved together in streaks
uint hu(uint x){ x^=x>>16; x*=0x7feb352du; x^=x>>15; x*=0x846ca68bu; x^=x>>16; return x; }
float hf(uint x){ return float(hu(x)>>8)/16777216.; }
void main(){
  ivec2 tc = ivec2(int(aIndex & 1023u)*2, int(aIndex >> 10));
  uvec4 t0 = texelFetch(uData, tc, 0), t1 = texelFetch(uData, tc+ivec2(1,0), 0);
  vec3 p = uintBitsToFloat(t0.xyz);
  vec4 col = vec4(float(t0.w & 255u), float((t0.w>>8)&255u), float((t0.w>>16)&255u), float(t0.w>>24))/255.;
  float rnd = hf(aIndex), grow = 1.;
  float r = clamp((length(p)-uR.x)/(uR.y-uR.x), 0., 1.);
  if((t1.w & 1u) == 1u) col.a *= uOrbit;                       // hidden parts show as the view turns
  bool subj = (t1.w & 2u) == 2u;                                  // mixed looks: 1 photo subject only, 2 everything else
  if((uMix==1 && !subj) || (uMix==2 && subj)) col.a = 0.;
  if(uFx==1){ if(r > uFxT*1.15) col.a = 0.; }                   // sweep and resolve: only what the beam has reached
  if(uFx==2){ float st=rnd*.7, k=clamp((uFxT-st)/(1.-st), 0., 1.);   // decay: each splat lets go in turn and drifts off
    vec3 dir = normalize(vec3(hf(aIndex*3u+1u)-.5, hf(aIndex*3u+2u)-.25, hf(aIndex*3u+3u)-.5));
    p += dir*k*k*length(p)*.3*uFxK; col.a *= 1.-smoothstep(.3,.9,k); grow = 1.-.75*k; }
  // build up and dissolve: splats gather one by one, on a slower curve because several overlap every pixel
  if(uFx==5) col.a *= smoothstep(rnd, rnd+.12, pow(uFxT,1.8)*1.12);
  if(uFx==7){ float a=uTime*.5; p += vec3(sin(a+rnd*41.), .7*sin(a*.8+rnd*23.), cos(a*.9+rnd*31.))*length(p)*.003*uFxK; }   // dust
  if(uFx==3){ float band=floor(p.y*18.+floor(uTime*7.)*3.), on=step(1.-.1*uFxK, hsh(band+floor(uTime*11.)));   // glitch: bands slip sideways
    p.x += on*(hsh(band*3.1)-.5)*(uR.y-uR.x)*.08*uFxK; }
  vec4 cam = uView*vec4(p,1.), clip = uProj*cam; float cb = 1.2*clip.w;
  col.a *= smoothstep(uNearF, uNearF*4., -cam.z);                // passing through: splats at the lens fade, not smear
  if(cam.z > -.02 || col.a < .004 || abs(clip.x) > cb || abs(clip.y) > cb){ gl_Position = vec4(0.,0.,2.,1.); return; }
  vec2 u1=unpackHalf2x16(t1.x), u2=unpackHalf2x16(t1.y), u3=unpackHalf2x16(t1.z);
  mat3 Vrk = mat3(u1.x,u1.y,u2.x, u1.y,u2.y,u3.x, u2.x,u3.x,u3.y) * (uCovK*grow*grow);
  float iz = 1./cam.z;
  mat3 J = mat3(-uFocal.x*iz, 0., 0.,  0., -uFocal.y*iz, 0.,  uFocal.x*cam.x*iz*iz, uFocal.y*cam.y*iz*iz, 0.);
  mat3 T = J*mat3(uView);
  mat3 c2 = T*Vrk*transpose(T);
  float a = c2[0][0]+.3, b = c2[0][1], c = c2[1][1]+.3;
  if(uDof > 0.){ float coc = uDof*abs(-iz - 1./uFocusD)*uFocusD*uVp.y*.012, det0 = a*c-b*b; a += coc*coc; c += coc*coc; col.a *= sqrt(max(det0,1e-6)/(a*c-b*b)); }
  float mid = .5*(a+c), rad = length(vec2(.5*(a-c), b)), l1 = mid+rad, l2 = max(mid-rad, .1);
  vec2 d1 = abs(b) < 1e-7 ? (a >= c ? vec2(1.,0.) : vec2(0.,1.)) : normalize(vec2(b, l1-a));
  vec2 e1 = min(3.*sqrt(l1), 1024.)*d1, e2 = min(3.*sqrt(l2), 1024.)*vec2(d1.y,-d1.x);
  // each splat at its own centre's depth, so the mixed looks can hide splats behind the dots
  gl_Position = vec4(clip.xy/clip.w + (aCorner.x*e1 + aCorner.y*e2)*2./uVp, clamp(clip.z/clip.w, -1., 1.), 1.);
  vPos = aCorner*3.;
  vec3 rgb = col.rgb*uExposure;
  if(uFx==8){ float a0=mix(-.75,.75,uFxT), hl=exp(-pow((atan(p.x,-p.z)-a0)/.16,2.));
    vec3 n = vec3(float((t1.w>>8)&255u), float((t1.w>>16)&255u), float(t1.w>>24))/127.5-1.; if(dot(n,-p)<0.) n=-n;
    vec3 L = normalize(vec3(sin(a0)*1.2, .45, .9)); float lit = .7+.5*max(0.,dot(normalize(n),L));
    rgb *= mix(1., lit*(.7+1.1*hl), min(1.,uFxK*1.2)); }
  if(uFocus > .5 && !subj) rgb *= .22;                          // Subject tab: everything else steps back, as it does for dots
  if(uFx==1){ float e = 1.-smoothstep(0., .02+.025*uFxK, abs(r-uFxT*1.15)); rgb = mix(rgb, vec3(.55,1.,.9), e*min(.8,.65*uFxK)); }   // the beam's edge
  if(uLin > .5) rgb = pow(max(rgb,0.), vec3(2.2));
  vCol = vec4(rgb, col.a);
}`;
const SPLAT_FS = `#version 300 es
precision highp float; in vec4 vCol; in vec2 vPos; out vec4 o;
void main(){ float A = dot(vPos,vPos); if(A > 9.) discard; float a = vCol.a*exp(-.5*A); if(a < 1./255.) discard; o = vec4(vCol.rgb*a, a); }`;

// Sorting: back to front along the view direction, by a 16-bit counting sort (one pass, no comparisons).
function sortSplatIndex(pos, n, v){
  const z = new Float32Array(n); let mn = Infinity, mx = -Infinity;
  for (let i=0;i<n;i++){ const d = v[2]*pos[i*3] + v[6]*pos[i*3+1] + v[10]*pos[i*3+2]; z[i]=d; if (d<mn) mn=d; if (d>mx) mx=d; }
  const sc = 65535/((mx-mn)||1), keys = new Uint16Array(n), counts = new Uint32Array(65536);
  for (let i=0;i<n;i++){ const k = ((z[i]-mn)*sc)|0; keys[i]=k; counts[k]++; }
  for (let k=1;k<65536;k++) counts[k]+=counts[k-1];
  const idx = new Uint32Array(n);
  for (let i=n-1;i>=0;i--) idx[--counts[keys[i]]] = i;
  return idx;
}
const SORT_WORKER = `let pos=null, n=0; ${sortSplatIndex.toString()}
onmessage = e => { const d=e.data; if (d.pos){ pos=d.pos; n=d.n; return; }
  const idx = sortSplatIndex(pos, n, d.view); postMessage({idx, id:d.id, set:d.set}, [idx.buffer]); };`;

const _hf = new Float32Array(1), _hu = new Uint32Array(_hf.buffer);
function toHalf(v){ _hf[0]=v; const x=_hu[0], s=(x>>>16)&0x8000, e=((x>>>23)&255)-112, m=x&0x7fffff;
  if (e<=0){ if (e<-10) return s; return s + (((m|0x800000)>>>(1-e)) + 0x1000 >>> 13); }
  if (e>=31) return s|0x7c00; return s + (e<<10) + ((m+0x1000)>>>13); }

function splatGL(){
  if (G.splat) return G.splat;
  const vao = gl.createVertexArray(), quad = gl.createBuffer(), idx = gl.createBuffer(), tex = gl.createTexture();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, quad); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, idx); gl.enableVertexAttribArray(1); gl.vertexAttribIPointer(1, 1, gl.UNSIGNED_INT, 0, 0); gl.vertexAttribDivisor(1, 1);
  gl.bindVertexArray(null);
  let worker = null;
  try { worker = new Worker(URL.createObjectURL(new Blob([SORT_WORKER], {type:'text/javascript'}))); } catch(e){}
  const Sg = G.splat = {vao, idx, tex, n:0, set:null, worker, busy:false, pending:null, sortedFor:null, covK:1};
  if (worker) worker.onmessage = e => { if (!G || G.splat!==Sg) return; Sg.busy=false;
    if (e.data.set===Sg.setId){ gl.bindBuffer(gl.ARRAY_BUFFER, Sg.idx); gl.bufferData(gl.ARRAY_BUFFER, e.data.idx, gl.DYNAMIC_DRAW); Sg.sortedFor = e.data.id; S.dirtyDraw = true; }
    if (Sg.pending){ const p=Sg.pending; Sg.pending=null; askSort(p); } };
  return Sg;
}
// Pack the splats into the texture. Covariances are stored as halves, scaled so typical ones sit near 1
// (a splat a few millimetres across would otherwise fall below what a half can hold).
function uploadSplats(sp){
  const Sg = splatGL(); if (Sg.set===sp) return;
  const n = sp.n, rows = Math.max(1, Math.ceil(n/1024)), data = new Uint32Array(2048*rows*4), f = new Float32Array(data.buffer);
  const sample=[]; for (let i=0;i<n;i+=Math.max(1,(n/4000)|0)) sample.push(Math.max(sp.scl[i*3],sp.scl[i*3+1],sp.scl[i*3+2])**2); sample.sort((a,b)=>a-b);
  const K = 1/(sample[sample.length>>1] || 1);
  for (let i=0;i<n;i++){ const o=i*8;
    f[o]=sp.pos[i*3]; f[o+1]=sp.pos[i*3+1]; f[o+2]=sp.pos[i*3+2];
    data[o+3] = (sp.rgba[i*4] | sp.rgba[i*4+1]<<8 | sp.rgba[i*4+2]<<16 | sp.rgba[i*4+3]<<24)>>>0;
    let w=sp.rot[i*4], x=sp.rot[i*4+1], y=sp.rot[i*4+2], z=sp.rot[i*4+3]; const l=Math.hypot(w,x,y,z)||1; w/=l; x/=l; y/=l; z/=l;
    const sx=sp.scl[i*3], sy=sp.scl[i*3+1], sz=sp.scl[i*3+2];
    // M = R * S; covariance = M M^T
    const m00=(1-2*(y*y+z*z))*sx, m01=(2*(x*y-w*z))*sy, m02=(2*(x*z+w*y))*sz;
    const m10=(2*(x*y+w*z))*sx, m11=(1-2*(x*x+z*z))*sy, m12=(2*(y*z-w*x))*sz;
    const m20=(2*(x*z-w*y))*sx, m21=(2*(y*z+w*x))*sy, m22=(1-2*(x*x+y*y))*sz;
    const cxx=(m00*m00+m01*m01+m02*m02)*K, cxy=(m00*m10+m01*m11+m02*m12)*K, cxz=(m00*m20+m01*m21+m02*m22)*K;
    const cyy=(m10*m10+m11*m11+m12*m12)*K, cyz=(m10*m20+m11*m21+m12*m22)*K, czz=(m20*m20+m21*m21+m22*m22)*K;
    data[o+4] = (toHalf(cxx) | toHalf(cxy)<<16)>>>0; data[o+5] = (toHalf(cxz) | toHalf(cyy)<<16)>>>0; data[o+6] = (toHalf(cyz) | toHalf(czz)<<16)>>>0;
    // the surface direction is the splat's thinnest axis, packed into the spare bytes after the flag
    const ax = sx<=sy && sx<=sz ? 0 : sy<=sz ? 1 : 2;
    const cx0 = ax===0 ? [1-2*(y*y+z*z), 2*(x*y+w*z), 2*(x*z-w*y)] : ax===1 ? [2*(x*y-w*z), 1-2*(x*x+z*z), 2*(y*z+w*x)] : [2*(x*z+w*y), 2*(y*z-w*x), 1-2*(x*x+y*y)];
    const pk = v => Math.max(0, Math.min(255, Math.round((v+1)*127.5)));
    data[o+7] = (sp.flag[i] | pk(cx0[0])<<8 | pk(cx0[1])<<16 | pk(cx0[2])<<24)>>>0;
  }
  gl.bindTexture(gl.TEXTURE_2D, Sg.tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32UI, 2048, rows, 0, gl.RGBA_INTEGER, gl.UNSIGNED_INT, data);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  Sg.n = n; Sg.set = sp; Sg.setId = (Sg.setId||0)+1; Sg.covK = 1/K; Sg.sortedFor = null;
  if (Sg.worker) Sg.worker.postMessage({pos: sp.pos.slice(), n});
}
const viewKey = V => [V[2],V[6],V[10],V[14]].map(x=>x.toFixed(3)).join(',');
function askSort(V){
  const Sg = G.splat; if (!Sg || !Sg.worker){ sortNow(V); return; }
  const id = viewKey(V); if (Sg.sortedFor===id) return;
  if (Sg.busy){ Sg.pending = V; return; }
  Sg.busy = true; Sg.worker.postMessage({view:Array.from(V), id, set:Sg.setId});   // an id, not the splats: they were sent once
}
function sortNow(V){
  const Sg = G.splat, id = viewKey(V); if (Sg.sortedFor===id) return;
  const idx = sortSplatIndex(Sg.set.pos, Sg.n, V);
  gl.bindBuffer(gl.ARRAY_BUFFER, Sg.idx); gl.bufferData(gl.ARRAY_BUFFER, idx, gl.DYNAMIC_DRAW); Sg.sortedFor = id;
}
// Draw into the current scene target. sync: sort right now (exports, thumbnails); otherwise the worker
// catches up a frame or two behind while the view moves.
function drawSplats(W, H, V, Pm, o, lin, fxK=1){
  const sp = currentSplats(); if (!sp || !sp.n) return;
  uploadSplats(sp); const Sg = G.splat;
  if (o.sync || Sg.sortedFor===null) sortNow(V); else askSort(V);
  const u = G.SP.u; gl.useProgram(G.SP.p);
  gl.uniformMatrix4fv(u.uProj,false,Pm); gl.uniformMatrix4fv(u.uView,false,V);
  gl.uniform2f(u.uFocal, Pm[0]*W/2, Pm[5]*H/2); gl.uniform2f(u.uVp, W, H); gl.uniform2f(u.uR, S.rng[0], S.rng[1]);
  gl.uniform1f(u.uCovK, Sg.covK); gl.uniform1f(u.uExposure, lin ? 1 : o.bright/1.25);   // next to dots the photo keeps its own exposure; Brightness is for the dots 
  gl.uniform1f(u.uLin, 0);     // splats stay in the photo's own colour space; the final pass knows which pixels are photo
  
  const slid = o.thumb ? 0 : Math.hypot(S.pan[0], S.pan[1], S.pan[2]*0.5)/(S.refDist||2);
  gl.uniform1f(u.uOrbit, Math.min(1, (Math.abs(o.yaw)+Math.abs(o.pitch))/8 + slid*8));
  gl.uniform1i(u.uFx, o.splatFx||0); gl.uniform1f(u.uFxT, o.fxT||0); gl.uniform1f(u.uTime, o.fxTime||0); gl.uniform1f(u.uFxK, fxK); gl.uniform1i(u.uMix, o.mix||0); gl.uniform1f(u.uFocus, o.focus && !S.scan ? 1 : 0); gl.uniform1f(u.uDof, o.dof||0); gl.uniform1f(u.uFocusD, o.focusD||2); gl.uniform1f(u.uNearF, 0.03*(S.refDist||2));
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, Sg.tex); gl.uniform1i(u.uData, 0);
  // In the mixed looks the dots are drawn first; the splats then respect their depth (without writing their
  // own), so photo behind a dotted subject stays behind it. Without this, the background filled in behind a
  // subject covered it as soon as the view turned.
  if (o.mix && o.cloud && o.cloud.count){ gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(false); } else gl.disable(gl.DEPTH_TEST);
  gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.bindVertexArray(Sg.vao); gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, Sg.n); gl.bindVertexArray(null);
  gl.disable(gl.BLEND); gl.depthMask(true); gl.disable(gl.DEPTH_TEST);
}
