// ---------------------------------------------------------------- WebGL2 renderer
// Linear-light colour into a half-float target when the GPU allows it, eye-dome lighting for
// lidar-viewer edges, a two-width bloom, then ACES tone mapping. Survives WebGL context loss.
const cv = $('#gl');
let gl = null, G = null;          // G holds every GL object so it can be rebuilt after a context loss

const PTS_VS = `#version 300 es
layout(location=0) in vec3 aPos; layout(location=1) in vec3 aCol; layout(location=2) in vec4 aMeta;
uniform mat4 uProj, uView; uniform float uSkyD, uPx, uExposure, uSat, uBgTint, uBgGain, uBgSize, uSparkle, uFocus, uLight, uOrbit, uFxT, uTime, uFxK, uDof, uFocusD, uNearF; uniform int uMode, uFx, uMix;
uniform vec2 uR, uY;
float hsh(float n){ return fract(sin(n*12.9898+4.1)*43758.5453); }
out vec3 vCol; flat out float vRound;
vec3 turbo(float x){ const vec4 kR=vec4(0.13572138,4.61539260,-42.66032258,132.13108234); const vec2 kR2=vec2(-152.94239396,59.28637943);
 const vec4 kG=vec4(0.09140261,2.19418839,4.84296658,-14.18503333); const vec2 kG2=vec2(4.27729857,2.82956604);
 const vec4 kB=vec4(0.10667330,12.64194608,-60.58204836,110.36276771); const vec2 kB2=vec2(-89.90310912,27.34824973);
 x=clamp(x,0.,1.); vec4 v4=vec4(1.,x,x*x,x*x*x); vec2 v2=v4.zw*v4.z; return clamp(vec3(dot(v4,kR)+dot(v2,kR2),dot(v4,kG)+dot(v2,kG2),dot(v4,kB)+dot(v2,kB2)),0.,1.); }
vec3 heat(float t){ t=clamp(t,0.,1.);
 vec3 a=vec3(.10,.05,.26), b=vec3(.48,.11,.43), c=vec3(.89,.35,.20), d=vec3(.98,.83,.36), e=vec3(1.,.98,.86);
 return t<.25?mix(a,b,t/.25):t<.5?mix(b,c,(t-.25)/.25):t<.8?mix(c,d,(t-.5)/.3):mix(d,e,(t-.8)/.2); }
vec3 lin(vec3 c){ return pow(max(c,0.),vec3(2.2)); }
// ironbow, the thermal camera palette: black, violet, red, orange, yellow, white
vec3 ironbow(float t){ t=clamp(t,0.,1.);
 vec3 a=vec3(.02,.01,.05), b=vec3(.28,.03,.52), c=vec3(.80,.10,.34), d=vec3(.99,.46,.06), e=vec3(1.,.87,.25), f=vec3(1.,1.,.9);
 return t<.2?mix(a,b,t/.2):t<.4?mix(b,c,(t-.2)/.2):t<.62?mix(c,d,(t-.4)/.22):t<.84?mix(d,e,(t-.62)/.22):mix(e,f,(t-.84)/.16); }
void main(){
  float kind=aMeta.x, rnd=aMeta.y, lum=aMeta.z, inc=aMeta.w; bool sky = inc < -.5; if(sky) inc = 1.;
  float r = clamp((length(aPos)-uR.x)/(uR.y-uR.x),0.,1.); if(inc < -.5) r = 1.;
  // video effects, scaled by strength uFxK: 2 decay (dots let go and drift off), 3 glitch (bands slip
  // sideways), 5 build up (dots gather one by one), 6 dissolve (dots fade out as the photo fades in),
  // 7 dust (a slow, slight drift)
  vec3 P0 = aPos; float fade = 1.;
  if(uFx==2){ float st=rnd*.7, k=clamp((uFxT-st)/(1.-st),0.,1.); vec3 dir=normalize(vec3(hsh(rnd*91.)-.5, hsh(rnd*37.)-.25, hsh(rnd*53.)-.5));
    P0 += dir*k*k*length(P0)*.3*uFxK; fade = 1.-smoothstep(.3,.9,k); }
  if(uFx==3){ float band=floor(P0.y*18.+floor(uTime*7.)*3.), on=step(1.-.1*uFxK, hsh(band+floor(uTime*11.))); P0.x += on*(hsh(band*3.1)-.5)*(uR.y-uR.x)*.08*uFxK; }
  if(uFx==5) fade = smoothstep(rnd, rnd+.12, uFxT*1.12);
  if(uFx==6) fade = 1.-smoothstep(rnd, rnd+.12, uFxT*1.12);
  if(uFx==7){ float a=uTime*.5; P0 += vec3(sin(a+rnd*41.), .7*sin(a*.8+rnd*23.), cos(a*.9+rnd*31.))*length(P0)*.006*uFxK; }
  // mixed looks: 1 the subject is drawn as photo, so its dots stand aside; 2 the reverse
  bool isSubj = kind<.5 || (kind>3.5);
  if((uMix==1 && isSubj) || (uMix==2 && !isSubj)) fade = 0.;
  vec4 vp = uView*vec4(P0,1.); gl_Position = uProj*vp;
  float dist = max(-vp.z, 1e-3);
  vec3 c = lin(aCol); float g = dot(c, vec3(.2126,.7152,.0722)); float lumL = pow(lum,2.2);
  if(uLight>0. && kind<1.5){
    // squeeze the brightness range toward a mid grey, keeping each dot's own hue and some texture
    float gl=max(g,1e-4), ng=.16*pow(gl/.16, 1.-.78*uLight);
    c = mix(vec3(ng), min(c/gl, vec3(3.))*ng, smoothstep(.0008,.012,g)); g=ng; lumL=ng;
  }
  if(uMode==0) c = mix(vec3(g), c, uSat);
  else if(uMode==1) c = lin(turbo(1.-r)) * (.3+.9*lumL);
  else if(uMode==2) c = lin(heat((aPos.y-uY.x)/(uY.y-uY.x))) * (.35+.8*lumL);
  else if(uMode==3) c = vec3(lumL*(.3+.7*inc))*vec3(.92,.97,1.)*1.4;
  else if(uMode==4) c = lin(vec3(.25,.95,.7))*(.04+lumL*1.4);
  else if(uMode==5) c = lin(ironbow(.62*pow(lum,.8) + .38*(1.-r)))*1.15;
  // flat styles are drawn in the final colours on a coloured ground, so they skip the light and glow path
  else if(uMode==6) c = vec3(.08,.075,.09);
  else c = mix(vec3(.55,.74,.95), vec3(.96,.99,1.), smoothstep(.1,.8,lum));
  bool flatStyle = uMode>=6;
  if(!flatStyle) c *= uExposure * (1. - .35*r);
  float size = uPx / (sky ? uSkyD*dist/length(P0) : dist); float round_ = 1.;   // sky dots keep the size they had before moving out to the dome
  if(uMode==6) size *= .22 + 1.05*pow(1.-lum, 1.4);               // halftone: darker places get bigger dots, never quite solid
  if(uSparkle>0.5){ c *= .6 + 1.4*rnd*rnd; }
  float hiddenPart = kind>2.5 ? 1. : 0.;
  if(kind>3.5) c *= .75;                          // a filled-in back is a guess: draw it a little darker
  if(flatStyle){ if(kind>.5 && kind<3.5 && uMode==6) c = mix(c, vec3(.95,.93,.87), .45); if(kind>.5 && kind<3.5 && uMode==7) c *= .72; }
  else if((kind>.5 && kind<1.5) || (kind>2.5 && kind<3.5)){
    vec3 t = lin(vec3(.30,.78,.70))*(.03+lumL*.9);
    c = mix(c, t*uExposure, uBgTint) * uBgGain; size *= uBgSize; round_ = 1.-uBgTint;
    c *= mix(1., .16, uFocus);
  } else if(kind>1.5 && kind<2.5){
    c = lin(vec3(.62,.72,.76))*(.02 + 1.1*pow(rnd,4.)) * min(uExposure,1.8);
    size *= .75 + fract(rnd*17.3)*1.1; round_ = 0.;
    c *= mix(1., .16, uFocus);
  }
  if(hiddenPart>.5){ if(uOrbit<.02){ gl_Position=vec4(2.,2.,2.,1.); } c *= uOrbit; }
  // 1 sweep: only what the beam has reached; 4 resolve: only what it has not yet turned into the photo
  if(uFx==1 || uFx==4){ float edge=uFxT*1.15, e=1.-smoothstep(0.,.02+.025*uFxK,abs(r-edge));
    if((uFx==1 && r>edge) || (uFx==4 && r<edge)) gl_Position=vec4(2.,2.,2.,1.);
    c = mix(c, lin(vec3(.55,1.,.9))*2.2*uExposure, e*min(.85,.7*uFxK)); }
  if(uFx==8){ float a0=mix(-.75,.75,uFxT), hl=exp(-pow((atan(P0.x,-P0.z)-a0)/.14,2.)); c *= mix(1., .6+2.*hl, min(1.,uFxK*1.3)); }
  fade *= smoothstep(uNearF, uNearF*4., dist);                  // passing through: dots at the lens fade out
  if(fade < .004) gl_Position=vec4(2.,2.,2.,1.);
  c *= fade;
  // depth of field: the blur circle grows with distance from the focus plane, and its light spreads out
  if(uDof>0.){ float coc = 1. + uDof*abs(1./dist - 1./uFocusD)*uFocusD*9.; size *= coc; c /= coc*coc; round_ = 1.; }
  // points smaller than a pixel still draw one pixel, so dim them to keep brightness honest
  if(size < 1. && !flatStyle) c *= size*size;
  vCol = c; vRound = (size >= 3. ? round_ : 0.);
  gl_PointSize = clamp(size, 1., 64.);
}`;
const PTS_FS = `#version 300 es
precision mediump float; in vec3 vCol; flat in float vRound; out vec4 o;
void main(){ if(vRound>.5){ vec2 p=gl_PointCoord*2.-1.; if(dot(p,p)>1.) discard; } o=vec4(vCol,0.); }`;   // alpha 0: a dot, not photo
const QUAD_VS = `#version 300 es
out vec2 vUv; void main(){ vec2 p=vec2((gl_VertexID<<1)&2, gl_VertexID&2); vUv=p; gl_Position=vec4(p*2.-1.,0.,1.); }`;
const BRIGHT_FS = `#version 300 es
precision highp float; in vec2 vUv; uniform sampler2D uTex; uniform vec2 uTexel; out vec4 o;
void main(){ vec2 h=uTexel*.5; vec4 s=(texture(uTex,vUv+vec2(-h.x,-h.y))+texture(uTex,vUv+vec2(h.x,-h.y))+texture(uTex,vUv+vec2(-h.x,h.y))+texture(uTex,vUv+vec2(h.x,h.y)))*.25;
 vec3 c=s.rgb; float m=max(c.r,max(c.g,c.b));
 // the photo glows far less than dots do, or a bright sky washes over everything
 o=vec4(c*smoothstep(.35,1.2,m)*mix(1.,.3,s.a),1.); }`;
const BLUR_FS = `#version 300 es
precision highp float; in vec2 vUv; uniform sampler2D uTex; uniform vec2 uDir; out vec4 o;
void main(){ vec3 s=texture(uTex,vUv).rgb*.227;
 s+=(texture(uTex,vUv+uDir*1.385).rgb+texture(uTex,vUv-uDir*1.385).rgb)*.316;
 s+=(texture(uTex,vUv+uDir*3.231).rgb+texture(uTex,vUv-uDir*3.231).rgb)*.070; o=vec4(s,1.); }`;
const COMP_FS = `#version 300 es
precision highp float; in vec2 vUv; uniform sampler2D uScene, uGlowA, uGlowB, uDepth; uniform float uGlow, uEdl, uNear, uFar, uRaw, uGlitch, uTime, uFlat, uNight; uniform vec2 uRes; out vec4 o;
float h(vec2 p){ return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453); }
float lz(float d){ float z=(2.*uNear*uFar)/(uFar+uNear-(d*2.-1.)*(uFar-uNear)); return log2(z); }
vec3 aces(vec3 x){ return clamp((x*(2.51*x+.03))/(x*(2.43*x+.59)+.14),0.,1.); }
void main(){
  vec2 uv=vUv; vec3 c;
  if(uGlitch>0.){
    // glitch: horizontal bands tear sideways, the colour channels split, and blocks drop out now and then
    float t=floor(uTime*10.), band=floor(vUv.y*28.), on=step(1.-.4*uGlitch, h(vec2(band,t)));
    uv.x += on*(h(vec2(band*1.7,t))-.5)*.09*uGlitch;
    float sp=.007*uGlitch*(.4+on);
    c=vec3(texture(uScene,uv+vec2(sp,0.)).r, texture(uScene,uv).g, texture(uScene,uv-vec2(sp,0.)).b);
    vec2 blk=floor(vUv*vec2(16.,9.)); if(h(blk+t*1.37) > 1.-.05*uGlitch) c*=.05;
  } else c=texture(uScene,vUv).rgb;
  float photo=texture(uScene,uv).a;       // how much of this pixel is photo (splats) rather than dots
  if(uEdl>0. && photo<.99){
    // eye-dome lighting: darken a point when its neighbours on screen are nearer than it
    float d=texture(uDepth,vUv).r;
    if(d<1.){ float zc=lz(d), s=0.; vec2 px=2./uRes;
      for(int i=0;i<8;i++){ float a=float(i)*.785398; vec2 off=vec2(cos(a),sin(a))*px;
        float dn=texture(uDepth,vUv+off).r; float zn = dn<1. ? lz(dn) : zc+8.; s+=max(0.,zc-zn); }
      c*=mix(exp(-s/8.*uEdl*110.), 1., photo); }
  }
  vec3 bloom = uGlow*(texture(uGlowA,uv).rgb*.9 + texture(uGlowB,uv).rgb*1.3);
  vec2 q=(vUv-.5)*vec2(uRes.x/uRes.y,1.);
  // The photo keeps its own colours; dots go through a filmic curve. Per pixel, so a frame can hold both.
  vec3 raw = clamp((c + bloom)*(1.-.25*smoothstep(.55,1.25,length(q))), 0., 1.);
  vec3 film = pow(aces((c + bloom)*(1.-.4*smoothstep(.45,1.2,length(q)))), vec3(1./2.2));
  c = mix(film, raw, clamp(photo,0.,1.));
  if(uFlat>.5) c = texture(uScene,uv).rgb * (uEdl>0. ? 1. : 1.);          // flat styles: the ground and dots exactly as drawn
  if(uFlat>.5 && uEdl>0.){ float d=texture(uDepth,uv).r; if(d<1.){ float zc=lz(d), s2=0.; vec2 px=2./uRes;
      for(int i=0;i<8;i++){ float a=float(i)*.785398; float dn=texture(uDepth,uv+vec2(cos(a),sin(a))*px).r; float zn=dn<1.?lz(dn):zc+8.; s2+=max(0.,zc-zn); }
      c = mix(c, vec3(1.), clamp(s2/8.*uEdl*60.,0.,.8)); } }   // blueprint: edges light up like drawn lines
  if(uNight>.5){ float g=dot(c,vec3(.3,.59,.11)); c = vec3(.18,1.,.35)*g*1.15 + vec3(.02,.05,.02);
    c += (h(vUv*uRes + fract(uTime*7.)*91.)-.5)*.13; c *= 1.-.14*step(.5,fract(vUv.y*uRes.y*.33)); c *= 1.-.75*smoothstep(.35,1.05,length(q)); }
  if(uGlitch>0.) c*=1.-.1*uGlitch*step(.5,fract(vUv.y*uRes.y*.5));
  c+=(h(vUv*uRes)-.5)/255.; o=vec4(c,1.); }`;

function initGL(){
  gl = cv.getContext('webgl2', {antialias:false, alpha:false, preserveDrawingBuffer:false, powerPreference:'high-performance'});
  if (!gl) return false;
  const half = !!gl.getExtension('EXT_color_buffer_float');
  const sh=(type,src)=>{ const s=gl.createShader(type); gl.shaderSource(s,src); gl.compileShader(s); if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
  const prog=(vs,fs)=>{ const p=gl.createProgram(); gl.attachShader(p,sh(gl.VERTEX_SHADER,vs)); gl.attachShader(p,sh(gl.FRAGMENT_SHADER,fs)); gl.linkProgram(p); if(!gl.getProgramParameter(p,gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p)); const u={}; const n=gl.getProgramParameter(p,gl.ACTIVE_UNIFORMS); for(let i=0;i<n;i++){const a=gl.getActiveUniform(p,i); u[a.name]=gl.getUniformLocation(p,a.name);} return {p,u}; };
  G = {half, P:prog(PTS_VS,PTS_FS), SP:prog(SPLAT_VS,SPLAT_FS), B:prog(QUAD_VS,BRIGHT_FS), Bl:prog(QUAD_VS,BLUR_FS), C:prog(QUAD_VS,COMP_FS),
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
  // straightening first, then the turn, so the view orbits about the true vertical
  const R = M4.mul(M4.rx(pitch*Math.PI/180), M4.mul(M4.ry(yaw*Math.PI/180), M4.rz(S.roll)));
  return M4.mul(M4.tr(-pn[0],-pn[1],-back-pn[2]), M4.mul(M4.tr(t[0],t[1],t[2]), M4.mul(R, M4.tr(-t[0],-t[1],-t[2]))));
}
// The dot looks sit on a black stage, so a frame wider than the photo shows it whole (bars at the sides).
// The photo looks fill the frame like a camera would, trimming a little top and bottom instead.
function viewTan(aspect){ const pa = S.photo ? S.photo.w/S.photo.h : 1, L = LOOKS[look], fill = L.splat && L.mix!==1 && !S.scan;
  return aspect < pa || fill ? S.tanV*pa/aspect : S.tanV; }
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
  const ground = LOOKS[o.look].bg || [0.004,0.005,0.006];
  gl.clearColor(ground[0], ground[1], ground[2], 0); gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
  // Photoreal draws the splats; the Resolve effect draws both, the dots giving way to the photo as the
  // beam passes. Every other look draws the dots.
  const Lo = LOOKS[o.look], mix = Lo.mix||0, fx = o.fx||'none', splatLook = !!Lo.splat;
  const both = (mix>0 || fx==='resolve' || fx==='dissolve') && hasSplats();
  const L = splatLook && !mix ? LOOKS.void : Lo;
  const ptFx = {sweep:1, decay:2, glitch:3, resolve: both?4:1, build:5, dissolve: both?6:5, dust:7, light:8}[fx]||0;
  o.splatFx = {sweep:1, resolve:1, decay:2, glitch:3, build:5, dissolve:5, dust:7, light:8}[fx]||0; o.mix = mix;
  const fxK = o.fxK!=null ? o.fxK : strength();
  // focus on the subject; Focus pull starts close to the camera and settles on it
  // With no subject picked (a street, a room, a scan) focus goes where a camera's would: on whatever is in
  // the middle of the frame, easing toward it as the view moves so a walk-in racks focus gently.
  const tv = M4.xf(V, S.target||[0,0,-2]); let focusD = Math.max(0.1, -tv[2]); o.dof = o.dof!=null ? o.dof : val('focus');
  if (o.dof>0 && (!S.picks.length || S.scan) && !o.thumb){ const cd = centreDepth(V, Pm); if (cd){ S.focusSm = S.focusSm ? S.focusSm + (cd-S.focusSm)*(o.sync ? 0.25 : 0.12) : cd; focusD = S.focusSm; } }
  if (fx==='focuspull'){ const e=(o.fxT||0), s=e*e*e*(e*(6*e-15)+10); focusD = focusD*(0.35+0.65*s); o.dof = Math.max(o.dof, 0.35+0.45*fxK); }
  o.focusD = focusD;
  if (o.cloud.count && (!splatLook || both)){
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);
    gl.useProgram(G.P.p); const u=G.P.u;
    gl.uniformMatrix4fv(u.uProj,false,Pm); gl.uniformMatrix4fv(u.uView,false,V);
    // point size at the subject's distance scales with the output height, so exports match the preview
    const ref = Math.abs(S.target[2]) || 2, pa = S.photo.w/S.photo.h, fitH = aspect < pa ? H*aspect/pa : H;
    gl.uniform1f(u.uPx, o.size * 1.62 * fitH/1000 * ref * (0.466/S.tanV)); gl.uniform1f(u.uSkyD, S.skyR ? S.skyR/3.2 : 1);
    gl.uniform1f(u.uExposure, o.bright); gl.uniform1f(u.uSat, o.colour==='muted' ? .45 : 1);
    gl.uniform1f(u.uBgTint, L.bgTint); gl.uniform1f(u.uBgGain, L.bgGain); gl.uniform1f(u.uBgSize, L.bgSize);
    gl.uniform1f(u.uSparkle, L.sparkle); gl.uniform1f(u.uFocus, o.focus ? 1 : 0); gl.uniform1f(u.uLight, o.light||0);
    // hidden parts show once the view has turned or slid sideways, since either uncovers what the photo could not see
    const slid = o.thumb ? 0 : Math.hypot(S.pan[0], S.pan[1], S.pan[2]*0.5)/(S.refDist||2);
    gl.uniform1f(u.uOrbit, Math.min(1, (Math.abs(o.yaw)+Math.abs(o.pitch))/8 + slid*8));
    gl.uniform1i(u.uMode, {photo:0,muted:0,range:1,height:2,grey:3,phosphor:4,thermal:5,ink:6,blueprint:7}[o.colour]||0);
    gl.uniform2f(u.uR, S.rng[0], S.rng[1]); gl.uniform2f(u.uY, S.yr[0], S.yr[1]);
    gl.uniform1i(u.uFx, ptFx); gl.uniform1f(u.uFxT, o.fxT||0); gl.uniform1f(u.uTime, o.fxTime||0); gl.uniform1f(u.uFxK, fxK); gl.uniform1i(u.uMix, both ? mix : 0); gl.uniform1f(u.uDof, o.dof); gl.uniform1f(u.uFocusD, focusD); gl.uniform1f(u.uNearF, 0.03*(S.refDist||2));
    gl.bindVertexArray(o.cloud.vao); gl.drawArrays(gl.POINTS, 0, o.cloud.count); gl.bindVertexArray(null);
    gl.disable(gl.DEPTH_TEST);
  }
  if ((splatLook || both) && hasSplats()) drawSplats(W, H, V, Pm, o, both, fxK);
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
    const raw = splatLook && !both, gk = Math.min(1, fxK), glitch = fx==='glitch' ? gk*(.45 + .55*Math.max(0, Math.sin((o.fxTime||0)*2.3)*Math.sin((o.fxTime||0)*5.1))) : fx==='decay' ? gk*.25*Math.max(0,(o.fxT||0)-.6)/.4 : 0;
    gl.uniform1f(u.uRaw, raw?1:0); gl.uniform1f(u.uGlitch, glitch); gl.uniform1f(u.uTime, o.fxTime||performance.now()/1000);
    gl.uniform1f(u.uFlat, Lo.style==='flat'?1:0); gl.uniform1f(u.uNight, Lo.style==='night'?1:0);
    gl.uniform1f(u.uGlow,o.glow); gl.uniform1f(u.uEdl, raw ? 0 : o.edges); gl.uniform1f(u.uNear,0.05); gl.uniform1f(u.uFar,400.); gl.uniform2f(u.uRes,W,H); });
  gl.bindVertexArray(null);
}
// Median distance of the dots near the middle of the screen (a sample of them, so it costs little per frame).
function centreDepth(V, Pm){
  const out=S.cpu, n=S.count; if (!out || !n) return 0;
  const MV=M4.mul(Pm,V), step=Math.max(1,(n/6000)|0), ds=[];
  for (let i=0;i<n;i+=step){ const o=i*10, x=out[o], y=out[o+1], z=out[o+2];
    const cw=MV[3]*x+MV[7]*y+MV[11]*z+MV[15]; if (cw<=0.05) continue;
    const cx=(MV[0]*x+MV[4]*y+MV[8]*z+MV[12])/cw, cy=(MV[1]*x+MV[5]*y+MV[9]*z+MV[13])/cw;
    if (Math.abs(cx)<0.18 && Math.abs(cy)<0.18) ds.push(cw); }
  if (ds.length < 8) return 0; ds.sort((a,b)=>a-b); return ds[ds.length>>1];
}
function viewOpts(extra){
  return Object.assign({cloud:G.clouds.main||{count:0}, look, colour:P.colour, size:val('size'), bright:val('bright'), glow:val('glow'), light:val('light'),
    edges:val('edges'), yaw:S.yaw, pitch:S.pitch, zoom:S.zoom, focus:S.tab==='subject' && !S.recording, sync:!!S.exporting, fx:S.fxNow||'none', fxT:S.fxT||0, fxTime:S.fxTime||0}, extra||{});
}
function draw(W, H){ if (!gl || gl.isContextLost()) return; renderView(W||cv.width, H||cv.height, viewOpts()); }

cv.addEventListener('webglcontextlost', e=>{ e.preventDefault(); G=null; });
cv.addEventListener('webglcontextrestored', ()=>{ if (initGL()){ if (S.cpu) uploadCloud(S.cpu, S.count); S.dirtyDraw=true; queueThumbs(); } });
