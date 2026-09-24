// ---------------------------------------------------------------- core: constants, state, settings
const $ = s => document.querySelector(s);
const MOBILE = matchMedia('(pointer:coarse)').matches;
const MAXPTS = MOBILE ? 520000 : 1150000;
const WIDE = () => matchMedia('(min-width:900px)').matches;
const PITCH_SIGN = 1;      // how edge convergence maps to the horizon row (checked against a synthetic photo)

// Every adjustable setting has named stops. The slider moves smoothly between them and snaps
// to a stop when you tap its name, so there is always a sensible preset one tap away.
const CONTROLS = [
  {key:'dots',     name:'Dots',       hint:'How many dots make up the picture.', rebuild:true,
   stops:[['Few',6],['Some',28],['Many',55],['Lots',75],['Max',92]]},
  {key:'size',     name:'Dot size',   hint:'How big each dot is.',
   stops:[['Fine',.55],['Small',.8],['Medium',1.05],['Big',1.5],['Huge',2.3]]},
  {key:'glow',     name:'Glow',       hint:'Light that spills around the bright dots.',
   stops:[['Off',0],['Soft',.45],['Medium',.9],['Strong',1.4],['Bloom',2.1]]},
  {key:'bright',   name:'Brightness', hint:'How bright the dots are.',
   stops:[['Dim',.6],['Soft',.9],['Normal',1.25],['Bright',1.8],['Blazing',2.7]]},
  {key:'light',    name:'Light',      hint:'Evens out the photo\'s lighting so dark or backlit subjects still show. Real lidar sees surfaces, not sunlight.',
   stops:[['As shot',0],['Lifted',.5],['Even',1]]},
  {key:'colour',   name:'Colour',     hint:'What decides the colour of each dot.', chips:[
     ['photo','Photo'],['muted','Muted'],['grey','Grey'],['range','Distance'],['height','Height'],['phosphor','Green']]},
  {key:'depth3d',  name:'3D',         hint:'How far near things stand out from far things. Easiest to see when you turn the view.', rebuild:true,
   stops:[['Flat',.08],['Low',.5],['Normal',1],['Deep',1.6],['Extra',2.4]]},
  {key:'backdrop', name:'Backdrop',   hint:'Dots behind and around the subject.', rebuild:true,
   stops:[['None',0],['Faint',.12],['Some',.4],['Full',1]]},
  {key:'floor',    name:'Floor',      hint:'A scatter of dots on the ground under the subject.', rebuild:true,
   stops:[['Off',0],['Light',.55],['Full',1.1]]},
  {key:'hidden',   name:'Hidden parts', hint:'Fills in what the photo could not see: the background behind things, and the backs of people and objects. It shows when you turn the view.', rebuild:true,
   stops:[['Off',0],['Behind',1],['Behind and backs',2]]},
  {key:'edges',    name:'Edges',      hint:'Dark outlines where near meets far, the way lidar viewers shade a scan.',
   stops:[['Off',0],['Soft',.9],['Strong',2.2]]},
];
const CTRL = Object.fromEntries(CONTROLS.map(c=>[c.key,c]));

// Looks set every control plus a few things that are part of the style itself.
// Control values are positions on the stops (0 = first stop, 1 = second, fractions in between).
const LOOKS = {
  void:    {name:'Void',    dots:3.05, size:1.9, glow:1.9, bright:2.3, colour:'photo',  depth3d:2, backdrop:1.05, floor:1.3, edges:0, hidden:2,
            pattern:'scatter', bgTint:1, bgGain:.45, bgSize:2.4, sparkle:0, yaw:0, pitch:0, zoom:1.3},
  sparse:  {name:'Sparse',  dots:1.45, size:2.7, glow:2.4, bright:3.1, colour:'muted',  depth3d:2, backdrop:0,    floor:1.55, edges:0, hidden:2,
            pattern:'scatter', bgTint:1, bgGain:.4, bgSize:2, sparkle:1, yaw:0, pitch:0, zoom:1.3},
  scanner: {name:'Scanner', dots:1.8,  size:1.4, glow:1.0, bright:1.7, colour:'range',  depth3d:2, backdrop:3,    floor:0,   edges:1, hidden:0,
            pattern:'rings',   bgTint:0, bgGain:1, bgSize:1, sparkle:0, yaw:24, pitch:14, zoom:2.2},
  survey:  {name:'Survey',  dots:2.85, size:1.2, glow:.55, bright:1.4, colour:'height', depth3d:2, backdrop:3,    floor:0,   edges:1.6, hidden:2,
            pattern:'scatter', bgTint:0, bgGain:1, bgSize:1, sparkle:0, yaw:18, pitch:10, zoom:1.6},
};
const LOOK_KEYS = ['dots','size','glow','bright','colour','depth3d','backdrop','floor','edges','hidden','pattern'];

const P = {};            // the live settings
let look = 'void';

const S = {
  photoSrc:null, photo:null,       // {w,h,data} untouched, and the copy the cloud is built from (anonymised when asked)
  depthSrc:null, depth:null,       // {w,h,d} 0..1, 1 = near
  photoURL:null,                   // for the hold-to-compare view
  tanV:Math.tan(25*Math.PI/180),   // half of the vertical field of view, as a tangent
  fovSource:'assumed',
  shiftAuto:0.25, plane:null, ground:null, autoCut:0.5,
  picks:[], band:1, pickMask:null, segMask:null, // chosen subject
  comps:[], compMap:null, nComp:0,
  labels:[], placing:false,
  faces:[], anon:false, anonLevel:1, faceMask:null, facesFound:false,
  yaw:0, pitch:0, zoom:1, target:[0,0,-2], spin:false,
  planes:[], floorTouched:false, autoLight:false, autoFind:true, scan:null,
  roll:0, rollAuto:0, level:true, pitchTan:0,   // camera tilt: roll from upright edges, pitch from how they converge
  adv:{fov:null, ratio:null, roll:null, beams:null, noise:1, exportLong:null}, tanVAuto:Math.tan(25*Math.PI/180), dbg:'result', fillCache:null,
  gen:0, home:null, reframe:false, lightAuto:0, compCache:null, depthVer:0, refFrozen:false,
  pivot:[0,0,-2], pan:[0,0,0], refDist:2, userMoved:false, panMode:false,   // where turning is centred, and how far the view has slid
  count:0, cpu:null, rng:[1,2], yr:[0,1], floor3d:null,
  dirtyBuild:true, dirtyDraw:true, lowDetail:false, recording:false,
  tab:null, ctrl:'dots', undo:[], shape:'photo'
};

// ---------------------------------------------------------------- small helpers
function val(key){ const c=CTRL[key], p=Math.max(0,Math.min(c.stops.length-1,P[key])), i=Math.min(c.stops.length-2,Math.floor(p)), f=p-i;
  return c.stops[i][1]*(1-f)+c.stops[i+1][1]*f; }
function hash2(x, y, s){ let h = Math.imul(x|0, 374761393) ^ Math.imul(y|0, 668265263) ^ Math.imul(s|0, 2246822519);
  h = Math.imul(h ^ (h>>>13), 1274126177); return ((h ^ (h>>>16))>>>0)/4294967296; }
function seeded(seed){ let a=seed>>>0; return () => { a|=0; a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }
function gauss(r){ return Math.sqrt(-2*Math.log(r()+1e-9))*Math.cos(6.283185*r()); }
const tick = () => new Promise(r=>setTimeout(r,30));
function busy(text, frac){ const b=$('#busy'); document.body.classList.toggle('locked', text!=null || S.recording); if (text==null){ b.hidden=true; return; } b.hidden=false; $('#busyText').textContent=text; $('#busyBar').style.width = frac==null ? '100%' : (Math.min(1,frac)*100).toFixed(1)+'%'; }
function banner(text){ const b=$('#banner'); b.hidden=!text; if (text) b.textContent=text; }
function notice(text){ const b=$('#notice'); b.hidden=!text; if (text) b.textContent=text; }
function store(k,v){ try{ localStorage.setItem('firstreturn.'+k, JSON.stringify(v)); }catch(e){} }
function recall(k){ try{ const v=localStorage.getItem('firstreturn.'+k); return v==null?null:JSON.parse(v); }catch(e){ return null; } }
function say(text){ try{ speechSynthesis.cancel(); const u=new SpeechSynthesisUtterance(text); u.rate=0.95; speechSynthesis.speak(u); }catch(e){} }
// one promise per script, so a second caller waits for the same load instead of racing ahead of it
const scriptLoads = {};
function loadScript(src){ return scriptLoads[src] || (scriptLoads[src] = new Promise((res,rej)=>{ const s=document.createElement('script'); s.src=src; s.onload=res; s.onerror=()=>{ delete scriptLoads[src]; rej(new Error('could not load '+src)); }; document.head.appendChild(s); })); }

const M4 = {
  persp(fy, a, n, f){ const t=1/Math.tan(fy/2), nf=1/(n-f); return [t/a,0,0,0, 0,t,0,0, 0,0,(f+n)*nf,-1, 0,0,2*f*n*nf,0]; },
  mul(a,b){ const o=new Array(16); for(let c=0;c<4;c++) for(let r=0;r<4;r++){ let s=0; for(let k=0;k<4;k++) s+=a[k*4+r]*b[c*4+k]; o[c*4+r]=s; } return o; },
  tr(x,y,z){ return [1,0,0,0, 0,1,0,0, 0,0,1,0, x,y,z,1]; },
  ry(a){ const c=Math.cos(a), s=Math.sin(a); return [c,0,-s,0, 0,1,0,0, s,0,c,0, 0,0,0,1]; },
  rx(a){ const c=Math.cos(a), s=Math.sin(a); return [1,0,0,0, 0,c,s,0, 0,-s,c,0, 0,0,0,1]; },
  rz(a){ const c=Math.cos(a), s=Math.sin(a); return [c,s,0,0, -s,c,0,0, 0,0,1,0, 0,0,0,1]; },
  xf(m,p){ const x=p[0],y=p[1],z=p[2]; const w=m[3]*x+m[7]*y+m[11]*z+m[15]; return [(m[0]*x+m[4]*y+m[8]*z+m[12])/w,(m[1]*x+m[5]*y+m[9]*z+m[13])/w,(m[2]*x+m[6]*y+m[10]*z+m[14])/w,w]; }
};
