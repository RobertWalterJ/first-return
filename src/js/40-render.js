// ---------------------------------------------------------------- WebGL2 renderer
// Linear-light colour into a half-float target when the GPU allows it, eye-dome lighting for
// lidar-viewer edges, a two-width bloom, then ACES tone mapping. Survives WebGL context loss.
const cv = $('#gl');
let gl = null, G = null;          // G holds every GL object so it can be rebuilt after a context loss

const PTS_VS = `#version 300 es
layout(location=0) in vec3 aPos; layout(location=1) in vec3 aCol; layout(location=2) in vec4 aMeta;
uniform mat4 uProj, uView; uniform float uPx, uExposure, uSat, uBgTint, uBgGain, uBgSize, uSparkle, uFocus, uLight; uniform int uMode;
uniform vec2 uR, uY;
out vec3 vCol; flat out float vRound;
vec3 turbo(float x){ const vec4 kR=vec4(0.13572138,4.61539260,-42.66032258,132.13108234); const vec2 kR2=vec2(-152.94239396,59.28637943);
 const vec4 kG=vec4(0.09140261,2.19418839,4.84296658,-14.18503333); const vec2 kG2=vec2(4.27729857,2.82956604);
 const vec4 kB=vec4(0.10667330,12.64194608,-60.58204836,110.36276771); const vec2 kB2=vec2(-89.90310912,27.34824973);
 x=clamp(x,0.,1.); vec4 v4=vec4(1.,x,x*x,x*x*x); vec2 v2=v4.zw*v4.z; return clamp(vec3(dot(v4,kR)+dot(v2,kR2),dot(v4,kG)+dot(v2,kG2),dot(v4,kB)+dot(v2,kB2)),0.,1.); }
vec3 heat(float t){ t=clamp(t,0.,1.);
 vec3 a=vec3(.10,.05,.26), b=vec3(.48,.11,.43), c=vec3(.89,.35,.20), d=vec3(.98,.83,.36), e=vec3(1.,.98,.86);
 return t<.25?mix(a,b,t/.25):t<.5?mix(b,c,(t-.25)/.25):t<.8?mix(c,d,(t-.5)/.3):mix(d,e,(t-.8)/.2); }
vec3 lin(vec3 c){ return pow(max(c,0.),vec3(2.2)); }
void main(){
  vec4 vp = uView*vec4(aPos,1.); gl_Position = uProj*vp;
  float dist = max(-vp.z, 1e-3);
  float kind=aMeta.x, rnd=aMeta.y, lum=aMeta.z, inc=aMeta.w;
  float r = clamp((length(aPos)-uR.x)/(uR.y-uR.x),0.,1.);
  vec3 c = lin(aCol); float g = dot(c, vec3(.2126,.7152,.0722)); float lumL = pow(lum,2.2);
  if(uLight>0. && kind<1.5){
    // squeeze the brightness range toward a mid grey, keeping each dot's own hue and some texture
    float gl=max(g,1e-4), ng=.16*pow(gl/.16, 1.-.78*uLight);
    c = mix(vec3(ng), c/gl*ng, smoothstep(.0008,.012,g)); g=ng; lumL=ng;
  }
  if(uMode==0) c = mix(vec3(g), c, uSat);
  else if(uMode==1) c = lin(turbo(1.-r)) * (.3+.9*lumL);
  else if(uMode==2) c = lin(heat((aPos.y-uY.x)/(uY.y-uY.x))) * (.35+.8*lumL);
  else if(uMode==3) c = vec3(lumL*(.3+.7*inc))*vec3(.92,.97,1.)*1.4;
  else c = lin(vec3(.25,.95,.7))*(.04+lumL*1.4);
  c *= uExposure * (1. - .35*r);
  float size = uPx / dist; float round_ = 1.;
  if(uSparkle>0.5){ c *= .6 + 1.4*rnd*rnd; }
  if(kind>.5 && kind<1.5){
    vec3 t = lin(vec3(.30,.78,.70))*(.03+lumL*.9);
    c = mix(c, t*uExposure, uBgTint) * uBgGain; size *= uBgSize; round_ = 1.-uBgTint;
    c *= mix(1., .16, uFocus);
  } else if(kind>1.5){
    c = lin(vec3(.62,.72,.76))*(.02 + 1.1*pow(rnd,4.)) * min(uExposure,1.8);
    size *= .75 + fract(rnd*17.3)*1.1; round_ = 0.;
    c *= mix(1., .16, uFocus);
  }
  // points smaller than a pixel still draw one pixel, so dim them to keep brightness honest
  if(size < 1.) c *= size*size;
  vCol = c; vRound = (size >= 3. ? round_ : 0.);
  gl_PointSize = clamp(size, 1., 64.);
}`;
const PTS_FS = `#version 300 es
precision mediump float; in vec3 vCol; flat in float vRound; out vec4 o;
void main(){ if(vRound>.5){ vec2 p=gl_PointCoord*2.-1.; if(dot(p,p)>1.) discard; } o=vec4(vCol,1.); }`;
const QUAD_VS = `#version 300 es
out vec2 vUv; void main(){ vec2 p=vec2((gl_VertexID<<1)&2, gl_VertexID&2); vUv=p; gl_Position=vec4(p*2.-1.,0.,1.); }`;
const BRIGHT_FS = `#version 300 es
precision highp float; in vec2 vUv; uniform sampler2D uTex; uniform vec2 uTexel; out vec4 o;
void main(){ vec2 h=uTexel*.5; vec3 c=(texture(uTex,vUv+vec2(-h.x,-h.y)).rgb+texture(uTex,vUv+vec2(h.x,-h.y)).rgb+texture(uTex,vUv+vec2(-h.x,h.y)).rgb+texture(uTex,vUv+vec2(h.x,h.y)).rgb)*.25;
 float m=max(c.r,max(c.g,c.b)); o=vec4(c*smoothstep(.35,1.2,m),1.); }`;
const BLUR_FS = `#version 300 es
precision highp float; in vec2 vUv; uniform sampler2D uTex; uniform vec2 uDir; out vec4 o;
void main(){ vec3 s=texture(uTex,vUv).rgb*.227;
 s+=(texture(uTex,vUv+uDir*1.385).rgb+texture(uTex,vUv-uDir*1.385).rgb)*.316;
 s+=(texture(uTex,vUv+uDir*3.231).rgb+texture(uTex,vUv-uDir*3.231).rgb)*.070; o=vec4(s,1.); }`;
const COMP_FS = `#version 300 es
precision highp float; in vec2 vUv; uniform sampler2D uScene, uGlowA, uGlowB, uDepth; uniform float uGlow, uEdl, uNear, uFar; uniform vec2 uRes; out vec4 o;
float h(vec2 p){ return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453); }
float lz(float d){ float z=(2.*uNear*uFar)/(uFar+uNear-(d*2.-1.)*(uFar-uNear)); return log2(z); }
vec3 aces(vec3 x){ return clamp((x*(2.51*x+.03))/(x*(2.43*x+.59)+.14),0.,1.); }
void main(){
  vec3 c=texture(uScene,vUv).rgb;
  if(uEdl>0.){
    // eye-dome lighting: darken a point when its neighbours on screen are nearer than it
    float d=texture(uDepth,vUv).r;
    if(d<1.){ float zc=lz(d), s=0.; vec2 px=1.4/uRes;
      for(int i=0;i<8;i++){ float a=float(i)*.785398; vec2 off=vec2(cos(a),sin(a))*px;
        float dn=texture(uDepth,vUv+off).r; float zn = dn<1. ? lz(dn) : zc+8.; s+=max(0.,zc-zn); }
      c*=exp(-s/8.*uEdl*45.); }
  }
  c += uGlow*(texture(uGlowA,vUv).rgb*.9 + texture(uGlowB,vUv).rgb*1.3);
  vec2 q=(vUv-.5)*vec2(uRes.x/uRes.y,1.); c*=1.-.4*smoothstep(.45,1.2,length(q));
  c=pow(aces(c),vec3(1./2.2)); c+=(h(vUv*uRes)-.5)/255.; o=vec4(c,1.); }`;

function initGL(){
  gl = cv.getContext('webgl2', {antialias:false, alpha:false, preserveDrawingBuffer:false, powerPreference:'high-performance'});
  if (!gl) return false;
  const half = !!gl.getExtension('EXT_color_buffer_float');
  const sh=(type,src)=>{ const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s); if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
  const prog=(vs,fs)=>{ const p=gl.createProgram(); gl.attachShader(p,sh(gl.VERTEX_SHADER,vs)); gl.attachShader(p,sh(gl.FRAGMENT_SHADER,fs)); gl.linkProgram(p); if(!gl.getProgramParameter(p,gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p)); const u={}; const n=gl.getProgramParameter(p,gl.ACTIVE_UNIFORMS); for(let i=0;i<n;i++){const a=gl.getActiveUniform(p,i); u[a.name]=gl.getUniformLocation(p,a.name);} return {p,u}; };
  G = {half, P:prog(PTS_VS,PTS_FS), B:prog(QUAD_VS,BRIGHT_FS), Bl:prog(QUAD_VS,BLUR_FS), C:prog(QUAD_VS,COMP_FS),
       quad:gl.createVertexArray(), clouds:{}, targets:{}};
  return true;
}
function cloudBuffer(key){
  if (G.clouds[key]) return G.clouds[key];
  const vao=gl.createVertexArray(), vbo=gl.createBuffer();
  gl.bindVertexArray(vao); gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0,3,gl.FLOAT,false,40,0);
  gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1,3,gl.FLOAT,false,40,12);
  gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2,4,gl.FLOAT,false,40,24);
  gl.bindVertexArray(null);
  return G.clouds[key] = {vao, vbo, count:0};
}
function uploadCloud(out, n, key='main'){
  const c = cloudBuffer(key); gl.bindBuffer(gl.ARRAY_BUFFER, c.vbo); gl.bufferData(gl.ARRAY_BUFFER, out.subarray(0,n*10), gl.STATIC_DRAW); c.count = n;
}
function targets(w,h,key){
  const old = G.targets[key]; if (old && old.w===w && old.h===h) return old;
  if (old){ [old.sT,old.dT,old.a,old.b,old.c,old.d].forEach(x=>gl.deleteTexture(x)); [old.sF,old.aF,old.bF,old.cF,old.dF].forEach(x=>gl.deleteFramebuffer(x)); }
  const fmt = G.half ? [gl.RGBA16F, gl.HALF_FLOAT] : [gl.RGBA8, gl.UNSIGNED_BYTE];
  const tex=(w,h,depth)=>{ const t=gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D,t);
    if (depth) gl.texImage2D(gl.TEXTURE_2D,0,gl.DEPTH_COMPONENT24,w,h,0,gl.DEPTH_COMPONENT,gl.UNSIGNED_INT,null);
    else gl.texImage2D(gl.TEXTURE_2D,0,fmt[0],w,h,0,gl.RGBA,fmt[1],null);
    const f = depth ? gl.NEAREST : gl.LINEAR;
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,f); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,f);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE); return t; };
  const fbo=(t,d)=>{ const f=gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER,f); gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,t,0);
    if (d) gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.TEXTURE_2D,d,0); return f; };
  const hw=Math.max(1,w>>1), hh=Math.max(1,h>>1), qw=Math.max(1,w>>2), qh=Math.max(1,h>>2);
  const T={w,h,hw,hh,qw,qh, sT:tex(w,h), dT:tex(w,h,true), a:tex(hw,hh), b:tex(hw,hh), c:tex(qw,qh), d:tex(qw,qh)};
  T.sF=fbo(T.sT,T.dT); T.aF=fbo(T.a); T.bF=fbo(T.b); T.cF=fbo(T.c); T.dF=fbo(T.d);
  gl.bindFramebuffer(gl.FRAMEBUFFER,null);
  return G.targets[key]=T;
}

// ---------------------------------------------------------------- camera
function frameAspect(){ const pa = S.photo ? S.photo.w/S.photo.h : 1;
  return S.shape==='wide'?16/9:S.shape==='square'?1:S.shape==='tall'?9/16:pa; }
function viewMatrix(yaw, pitch, zoom, pivot, pan){
  // yaw = pitch = 0, zoom = 1 and no pan is exactly the photo's own viewpoint. Turning happens about
  // the pivot; pan slides the camera in its own plane (and along its axis when the pivot is re-centred).
  const t = pivot || S.target, pn = pan || [0,0,0], back = (zoom-1)*S.refDist;
  const R = M4.mul(M4.rx(pitch*Math.PI/180), M4.ry(yaw*Math.PI/180));
  return M4.mul(M4.tr(-pn[0],-pn[1],-back-pn[2]), M4.mul(M4.tr(t[0],t[1],t[2]), M4.mul(R, M4.tr(-t[0],-t[1],-t[2]))));
}
function viewTan(aspect){ const pa = S.photo ? S.photo.w/S.photo.h : 1; return aspect < pa ? S.tanV*pa/aspect : S.tanV; }
function projMatrix(aspect){
  const pa = S.photo ? S.photo.w/S.photo.h : 1;
  return M4.persp(2*Math.atan(viewTan(aspect)), aspect, 0.05, 400);   // tall frames keep the photo's width
}

// Render one cloud at W x H into the canvas (viewport origin bottom left).
function renderView(W, H, o){
  const T = targets(W, H, o.targetKey||'main');
  const aspect = W/H, V = o.thumb ? viewMatrix(o.yaw, o.pitch, o.zoom, S.target, null) : viewMatrix(o.yaw, o.pitch, o.zoom, S.pivot, S.pan), Pm = projMatrix(aspect);
  if (!o.thumb){ S.V=V; S.P=Pm; }
  gl.bindFramebuffer(gl.FRAMEBUFFER, T.sF); gl.viewport(0,0,W,H);
  gl.clearColor(0.004,0.005,0.006,1); gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
  const L = LOOKS[o.look];
  if (o.cloud.count){
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);
    gl.useProgram(G.P.p); const u=G.P.u;
    gl.uniformMatrix4fv(u.uProj,false,Pm); gl.uniformMatrix4fv(u.uView,false,V);
    // point size at the subject's distance scales with the output height, so exports match the preview
    const ref = Math.abs(S.target[2]) || 2, pa = S.photo.w/S.photo.h, fitH = aspect < pa ? H*aspect/pa : H;
    gl.uniform1f(u.uPx, o.size * 1.62 * fitH/1000 * ref * (0.466/S.tanV));
    gl.uniform1f(u.uExposure, o.bright); gl.uniform1f(u.uSat, o.colour==='muted' ? .45 : 1);
    gl.uniform1f(u.uBgTint, L.bgTint); gl.uniform1f(u.uBgGain, L.bgGain); gl.uniform1f(u.uBgSize, L.bgSize);
    gl.uniform1f(u.uSparkle, L.sparkle); gl.uniform1f(u.uFocus, o.focus ? 1 : 0); gl.uniform1f(u.uLight, o.light||0);
    gl.uniform1i(u.uMode, {photo:0,muted:0,range:1,height:2,grey:3,phosphor:4}[o.colour]||0);
    gl.uniform2f(u.uR, S.rng[0], S.rng[1]); gl.uniform2f(u.uY, S.yr[0], S.yr[1]);
    gl.bindVertexArray(o.cloud.vao); gl.drawArrays(gl.POINTS, 0, o.cloud.count); gl.bindVertexArray(null);
    gl.disable(gl.DEPTH_TEST);
  }
  gl.bindVertexArray(G.quad);
  const pass = (p, f, w, h, bind) => { gl.bindFramebuffer(gl.FRAMEBUFFER,f); gl.viewport(0,0,w,h); gl.useProgram(p.p); bind(p.u); gl.drawArrays(gl.TRIANGLES,0,3); };
  const tx = (unit, t) => { gl.activeTexture(gl.TEXTURE0+unit); gl.bindTexture(gl.TEXTURE_2D,t); };
  pass(G.B, T.aF, T.hw, T.hh, u=>{ tx(0,T.sT); gl.uniform1i(u.uTex,0); gl.uniform2f(u.uTexel,1/W,1/H); });
  const k = H/900;
  pass(G.Bl, T.bF, T.hw, T.hh, u=>{ tx(0,T.a); gl.uniform1i(u.uTex,0); gl.uniform2f(u.uDir,k/T.hw,0); });
  pass(G.Bl, T.aF, T.hw, T.hh, u=>{ tx(0,T.b); gl.uniform1i(u.uTex,0); gl.uniform2f(u.uDir,0,k/T.hh); });
  pass(G.Bl, T.dF, T.qw, T.qh, u=>{ tx(0,T.a); gl.uniform1i(u.uTex,0); gl.uniform2f(u.uDir,2.2*k/T.qw,0); });
  pass(G.Bl, T.cF, T.qw, T.qh, u=>{ tx(0,T.d); gl.uniform1i(u.uTex,0); gl.uniform2f(u.uDir,0,2.2*k/T.qh); });
  pass(G.C, null, W, H, u=>{ tx(0,T.sT); tx(1,T.a); tx(2,T.c); tx(3,T.dT);
    gl.uniform1i(u.uScene,0); gl.uniform1i(u.uGlowA,1); gl.uniform1i(u.uGlowB,2); gl.uniform1i(u.uDepth,3);
    gl.uniform1f(u.uGlow,o.glow); gl.uniform1f(u.uEdl,o.edges); gl.uniform1f(u.uNear,0.05); gl.uniform1f(u.uFar,400.); gl.uniform2f(u.uRes,W,H); });
  gl.bindVertexArray(null);
}
function viewOpts(extra){
  return Object.assign({cloud:G.clouds.main||{count:0}, look, colour:P.colour, size:val('size'), bright:val('bright'), glow:val('glow'), light:val('light'),
    edges:val('edges'), yaw:S.yaw, pitch:S.pitch, zoom:S.zoom, focus:S.tab==='subject' && !S.recording}, extra||{});
}
function draw(W, H){ if (!gl || gl.isContextLost()) return; renderView(W||cv.width, H||cv.height, viewOpts()); }

cv.addEventListener('webglcontextlost', e=>{ e.preventDefault(); G=null; });
cv.addEventListener('webglcontextrestored', ()=>{ if (initGL()){ if (S.cpu) uploadCloud(S.cpu, S.count); S.dirtyDraw=true; queueThumbs(); } });
