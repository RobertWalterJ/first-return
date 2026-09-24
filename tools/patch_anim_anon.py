from pathlib import Path
p = Path(__file__).parent.parent / 'src' / 'first-return.html'
s = p.read_text(encoding='utf-8')
add = (Path(__file__).parent / 'anim_anon.js').read_text(encoding='utf-8')

def rep(old, new):
    global s
    assert s.count(old) == 1, (s.count(old), old[:90])
    s = s.replace(old, new)

# ---- CSS
rep(".sheet img{max-width:100%;max-height:72vh;border:1px solid var(--line2);-webkit-touch-callout:default}",
    ".sheet img,.sheet video{max-width:100%;max-height:72vh;border:1px solid var(--line2);-webkit-touch-callout:default;background:#000}\n"
    ".recbar{position:absolute;left:0;right:0;top:0;height:3px;background:var(--line)}\n.recbar i{position:absolute;left:0;top:0;bottom:0;width:0;background:#ff5a4e}\n"
    ".ctl.wide{grid-template-columns:104px minmax(0,1fr)}\n.ctl.wide select{grid-column:2}")

rep('    <div class="labels" id="labels"></div>',
    '    <div class="labels" id="labels"></div>\n    <div class="recbar" id="recbar" hidden><i id="recfill"></i></div>')

rep('''    <section>
      <h2>Labels</h2>''', '''    <section>
      <h2>Animate</h2>
      <div class="ctl wide"><label for="animMove">Camera move</label><select id="animMove">
        <option value="push">Slow push in</option><option value="orbit">Gentle orbit</option><option value="drift">Push in and drift</option><option value="rise">Rise and turn</option></select></div>
      <div class="ctl wide"><label for="animLen">Length</label><select id="animLen">
        <option value="4">4 seconds</option><option value="6" selected>6 seconds</option><option value="10">10 seconds</option></select></div>
      <div class="row"><button class="btn small" id="animPreview">Preview</button><button class="btn small primary" id="animRecord">Record video</button></div>
      <p class="note">The move starts from whatever view is on screen, so frame it first.</p>
    </section>

    <section>
      <h2>Faces</h2>
      <div class="row"><button class="btn small" id="anon" aria-pressed="false">Anonymise faces</button><button class="btn small" id="addFace" aria-pressed="false">Cover a face</button><button class="btn small" id="clearFaces" hidden>Clear</button></div>
      <div class="ctl" style="margin-top:10px"><label for="anonStr">Strength</label><input id="anonStr" type="range" min="0.2" max="1" step="0.05" value="0.7"><output for="anonStr">0.70</output></div>
      <p class="note" id="faceNote"></p>
    </section>

    <section>
      <h2>Labels</h2>''')

rep('  <img id="sheetImg" alt="Your rendered point cloud image">',
    '  <img id="sheetImg" alt="Your rendered point cloud image">\n  <video id="sheetVid" controls loop muted playsinline hidden></video>')
rep('<p>On a phone, press and hold the picture to save it. On a computer, right-click it and choose Save image.</p>',
    '<p id="sheetNote"></p>')

rep("  labels:[], placing:false,", "  labels:[], placing:false, faces:[], anon:false, anonStr:0.7, recording:false,")

# point size: perspective already scales with distance, so zoom must not scale it again
rep("gl.uniform1f(u.uPx, P.size * 2.1 * fitH/1000 * ref / Math.max(0.35, S.zoom));", "gl.uniform1f(u.uPx, P.size * 1.62 * fitH/1000 * ref);")
rep("bgSize:1,  yaw:24,pitch:14,zoom:1.75", "bgSize:1,  yaw:24,pitch:14,zoom:2.2")

# thin and roughen points inside anonymised faces
rep("""    const rnd = rand();
    if (kind===1){""", """    const rnd = rand();
    const inFace = S.faceMask ? S.faceMask[mi]/255 : 0;
    if (inFace && rand() < 0.5*S.anonStr*inFace) return;
    if (kind===1){""")
rep("    const zz = z*(1+(rand()-.5)*0.004);", "    const zz = z*(1+(rand()-.5)*(0.004 + 0.03*S.anonStr*inFace));")

rep("  if (S.dirtyDraw){ S.dirtyDraw=false; draw(); renderLabels(); }", "  if (S.dirtyDraw && !S.recording){ S.dirtyDraw=false; draw(); renderLabels(); }")
rep("  if (S.spin){ S.yaw += 0.25;", "  if (S.spin && !S.recording){ S.yaw += 0.25;")

rep("const up = e=>{ if (ptrs.size===1 && moved<6 && S.placing){ const r=cv.getBoundingClientRect(); placeLabel(e.clientX-r.left, e.clientY-r.top); }",
    "const up = e=>{ if (ptrs.size===1 && moved<6 && S.placing){ const r=cv.getBoundingClientRect(); (S.placing==='face'?placeFace:placeLabel)(e.clientX-r.left, e.clientY-r.top); }")
rep("function setPlacing(on){ S.placing=on; $('#addLabel').setAttribute('aria-pressed', on); $('#stage').classList.toggle('placing', on);",
    "function setPlacing(on){ if (on===true) on='label'; S.placing=on; $('#addLabel').setAttribute('aria-pressed', on==='label'); $('#addFace').setAttribute('aria-pressed', on==='face'); $('#stage').classList.toggle('placing', !!on);\n  faceNote(); if (on==='face') $('#faceNote').textContent='Now tap the face to cover.';")
rep("$('#labelHint').textContent = on ?", "$('#labelHint').textContent = on==='label' ?")
rep("$('#addLabel').addEventListener('click', ()=>setPlacing(!S.placing));", "$('#addLabel').addEventListener('click', ()=>setPlacing(S.placing==='label'?false:'label'));")

rep("""  const fs = H*0.03; x.font = `560 ${fs}px Archivo, "Helvetica Neue", Arial, sans-serif`; x.textAlign='center'; x.textBaseline='bottom';
  S.labels.forEach(L=>{ if(!L.text||!L.pos) return; const s=project(L.pos,W,H); if(!s) return;
    x.fillStyle='#fff'; x.shadowColor='rgba(255,255,255,.55)'; x.shadowBlur=fs*0.5; x.fillText(L.text,s[0],s[1]); x.shadowBlur=fs*0.18; x.fillText(L.text,s[0],s[1]); });""",
    "  drawLabels2D(x, W, H);")
rep("c2.toBlob(b=>{ const url=URL.createObjectURL(b); $('#sheetImg').src=url; $('#sheetDl').href=url; $('#sheet').hidden=false; busy(null); }, 'image/png');",
    "c2.toBlob(b=>{ showSheet(URL.createObjectURL(b), 'image', 'first-return.png'); busy(null); }, 'image/png');")
rep("$('#sheetClose').addEventListener('click', ()=>{ $('#sheet').hidden=true; });",
    "$('#sheetClose').addEventListener('click', ()=>{ $('#sheet').hidden=true; $('#sheetVid').pause(); });\n" + add)

# keep the untouched photo and depth as sources; the anonymiser derives the copies the cloud is built from
rep("S.photo = photoFrom(bmp); S.depth = depth; S.ground = findGround(); S.autoCut = otsu(depth.d); S.labels=[]; renderLabelList();",
    "S.photoSrc = S.photo = photoFrom(bmp); S.depthSrc = S.depth = depth; S.ground = findGround(); S.autoCut = otsu(depth.d); S.labels=[]; renderLabelList();\n    S.faces=[]; S.facesFound=false; if (S.anon) await setAnon(true); else faceNote();")
rep("    S.photo = {w:c.width,h:c.height,data:x.getImageData(0,0,c.width,c.height).data};",
    "    S.photoSrc = S.photo = {w:c.width,h:c.height,data:x.getImageData(0,0,c.width,c.height).data};")
rep("S.depth = normaliseDepth(raw, d.width, d.height); S.ground = findGround(); S.autoCut = otsu(S.depth.d);",
    "S.depthSrc = S.depth = normaliseDepth(raw, d.width, d.height); S.ground = findGround(); S.autoCut = otsu(S.depth.d); faceNote();")
p.write_text(s, encoding='utf-8'); print('patched')
