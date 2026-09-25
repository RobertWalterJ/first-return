# First Return audit, 24 September 2026

Three reviews ran in parallel: design and user journey (tested on the live site at phone size), science and technical (a line-by-line code review), and capabilities research (current models and techniques that run in a browser). This page gives what each found, what changed as a result, and what is still open.

## 1. Design and user journey

**What was wrong on a phone**
- The picture and the controls were never on screen together. The Void look forced a 16:9 frame, so the picture was 211 px tall with 292 px of black around it. The sliders started about 530 px below the picture's bottom edge. Every adjustment was made blind.
- Swiping on the top 62% of the screen turned the model instead of scrolling the page.
- There were nine sliders showing raw numbers such as "0.85". "Colour" and "Colour by" were two separate controls, and the Colour slider did nothing in two of the colour modes. "Subject edge" was never explained.
- Picking a look quietly wiped your changes, with no undo.
- Adding a name or covering a face was switched on at the bottom of the page, but the tap had to happen on the picture about 1,300 px higher up.

**What changed**
- **One screen, no page scroll.** A top bar (Open, Shape, Save, About), the picture, then five tabs: Look, Adjust, Subject, Move, People. Only one short tray opens at a time, and the picture stays in view while you adjust. On a desktop the tabs sit in a side panel.
- **The frame follows the photo** by default on a phone. Wide, Square and Tall are in the Shape menu.
- **Adjust shows one control at a time.** Each control has five named steps (for example Few, Some, Many, Lots, Max) that you can tap or slide between. A small dot marks the current look's own setting. Each has a one-line hint with a read-aloud button. Colour is now a single row of choices: Photo, Muted, Grey, Distance, Height, Green.
- **Looks show thumbnails** rendered from your own photo. A "Custom" tag appears once you change anything, alongside **Reset look** and **Undo**.
- **Hold to compare** with the original photo. The original is the anonymised version when faces are hidden.
- Prompts ("Tap a face to cover it") now appear on the picture itself.
- Controls that rebuild the cloud use a lighter version while you drag and the full one when you let go, so dragging stays smooth.

## 2. Picking the subject (your "it blends into the background" problem)

**Cause.** The subject used to be "everything nearer than an automatic depth cut". Anything in front of the thing you cared about won, and the real subject became background.

**Now.** In the **Subject** tab you **tap what matters**. The tool grows outward from your tap across surfaces at about the same depth and stops at depth jumps. The result becomes the subject even if something else is nearer, and nearer things are treated as backdrop. While the tab is open, everything else dims so you can see what was picked.
- **Tighter**, **Normal** and **Looser** control how much depth variation is included.
- You can tap more things to add them, or tap a ring to remove one.
- **Auto** goes back to the automatic cut.
- **Sharper outline** adds Google's MediaPipe Magic Touch model (Apache 2.0, about 18 MB the first time, then cached). It traces the tapped object's outline, and depth then removes stray parts. On the sample, one tap on the chair takes the whole chair (back, seat and legs) and drops the nearer statue into the backdrop.

## 3. Science and technical

| Finding | Severity | Status |
|---|---|---|
| Every photo was given the same 7:1 near-to-far depth ratio, so portraits were over-stretched about 5 times and streets were flattened | High | **Fixed.** A floor plane is fitted with RANSAC and extended to the horizon, which gives the real ratio. The **3D** control then scales it (Flat to Extra) |
| The field of view was fixed at 50°, but phone portrait shots are about 72°, so shapes were squeezed about 1.55 times when turned | High | **Fixed.** The lens's 35 mm focal length is read from the photo's EXIF data. With no lens data, a phone-typical view is assumed |
| Face finder stretched portrait photos almost 2 times | High | **Fixed.** Every crop keeps a true 4:3 shape; stricter threshold on small tiles |
| Blurred faces can sometimes be re-identified | Medium | **Improved.** Light blurs. Medium replaces the face with its own average colour and smooths its 3D shape. Strong also flattens the shape and drops most of the face's points. The About panel and the People tab both say what anonymising can't hide |
| Video stuttered on slow phones because it was recorded in real time | High | **Fixed.** WebCodecs plus an MP4 muxer render every frame at its exact time. The old recorder is kept as a fallback |
| No recovery if the phone drops the graphics context | High | **Fixed** |
| A 50 MP photo was decoded at full size | Medium | **Fixed.** Photos are decoded at 1,600 to 2,000 px on the long side |
| Depth edges were soft, smearing people into the wall behind them | Medium | **Fixed.** A guided filter snaps depth edges to the photo's own edges at twice the resolution |
| The floor was detected row by row, the synthetic floor ignored camera tilt, and the photo's own floor was mistaken for the subject | Medium | **Fixed.** The floor is a 3D plane, anything at or behind it is not subject, and the synthetic floor follows its tilt |
| Scan rings were just straight rows | Medium | **Fixed.** Real beam elevations, bunched near the horizon. Circles on the floor. Range noise that grows with distance. Returns lost on dark surfaces and at glancing angles |
| Colours clipped before tone mapping, and the glow flickered | Medium | **Fixed.** Linear colour, half-float targets, ACES tone mapping, filtered glow |
| No lidar-style depth shading | Could | **Added:** eye-dome lighting, the **Edges** control |
| Dots reshuffled on every change, and the point cap cut off the bottom of the frame | Low | **Fixed.** Stable per-cell randomness, and the budget is set before sampling |
| Saved files leaked memory; "first time only" was not reliably true | Low | **Fixed.** Blob URLs are released. Models are kept in Cache Storage |

## 4. Still open (next candidates)

1. **Test on the S23 FE.** No speeds have been measured on the phone yet: the depth model, Magic Touch, or video encoding.
2. **YuNet face finder** (MIT, about 230 KB). It is better than UltraFace on small faces.
3. **MoGe-2 small** (MIT). Metric depth and the true field of view from one image. It needs an int8 build and phone timing first.
4. **Run depth in a worker**, so the page does not freeze while depth is being worked out.
5. **Protect feet** where a person meets the floor. They can still be trimmed.
6. **Licence traps to keep avoiding:** RMBG-1.4 and 2.0, EdgeSAM, the SCRFD weights, UniDepth, Depth Anything 3 Large and Giant, and Apple SHARP are all non-commercial or research-only.

---

# Round two, 24 September 2026

Three more reviews ran after the subject finder, 3D scans and straightening were added: a code and science audit, a design audit of the new flows, and a research sweep of MIT and other groups (2024 to 2026) for better methods that can run in a phone browser.

## Fixed from the code and science audit
- **Results landing on the wrong photo:** a generation counter drops any result that arrives after another photo or scan was opened. Controls lock while the app is busy or recording. Undo is cleared for each new photo.
- **Straighten fooled by converging verticals:** edge lean is now fitted against position across the frame. The constant part is the roll; the slope is the camera's pitch. The fit is robust and calibrated on synthetic scenes of known tilt. On real photos turned by a known amount it reads 3.0°, 3.9°, 5.1° and 6.0° against true 3°, 4°, 5° and 6°.
- **Depth range thrown off by pitch:** the pitch now sets the horizon row on which the floor's depth range is measured.
- **Smaller issues:**
  - roll applied before the turn;
  - zoom distance fixed per photo;
  - outline value chosen by majority;
  - found things seeded on their nearest pixel, with a fallback;
  - up-facing floors judged at the automatic depth, against the floor's own "up";
  - depth-relative tolerances;
  - extra floors must share the main floor's horizon;
  - the subject map is cached;
  - scan levelling rejects walls;
  - scan memory capped on phones;
  - range noise is stable between rebuilds.

## Fixed from the design audit
- Automatic finds, straightening and dark-subject Light each report what they did, in a one-off notice placed low on the picture so names stay clear. Instructions sit in a separate line.
- The finder download shows megabytes.
- Found things are listed by name with remove buttons, and their rings are labelled.
- The auto-framed view is "home" for Photo view.
- Pan mode shows a reminder.
- Light marks its automatic setting.
- Open is a Photo / 3D scan menu, so the phone's normal photo picker is kept.

## Adopted from the research
- **Multi-core processing on GitHub Pages** (coi-serviceworker, MIT). Confirmed active on the live site.
- **YuNet face finder** (OpenCV Zoo, MIT) replaces UltraFace.
- **Solid fill by default for faces**, because blur can be reversed by recognition software.

## New
- **Hidden parts:** the background behind subjects is filled in (push-pull inpainting of depth and colour), and each subject gets a rounded back. Both appear only when the view turns.
- **Advanced:** diagnostic views and direct settings.

## Still worth doing (from the research)
1. **MoGe-2 small** (Microsoft, MIT): metric depth, view angle and surface normals from one image. It needs an int8 version of the 141 MB model and a phone speed test.
2. **RF-DETR Segmentation Nano** (Apache): one pass gives outlines for all common objects. It could replace detector plus outline.
3. **GeoCalib** (ETH, CC BY weights): stronger tilt estimation, if straightening still misses on some photos.
4. **Full 3D objects from one photo** (SAM 3D, TRELLIS and similar): these need a PC GPU. Their output can come back in through the .ply import.

Avoid (non-commercial or copyleft): Perspective Fields, EdgeSAM, UniDepthV2, MASt3R/DUSt3R, Depth Anything 3 Large and Giant, the original VGGT, YOLO-World and Ultralytics YOLO.

---

# Round three, 24 September 2026: features, options and a plan

Three reviews ran at the same time:
- a design and feature review of the app as it is now (reading the code);
- research into new capabilities that can run in a phone browser under permissive licences;
- a survey of similar apps: Polycam, Scaniverse, Record3D, Immersity, Google Cinematic photos, Apple Spatial Scenes, CapCut, Potree, TouchDesigner and Blender lidar looks, and Radiohead's *House of Cards*.

## Ground rules for anything new
- **No new tabs and no new top-bar buttons.** Every new option goes into a tray that already exists, as at most one new row of chips.
- **Model-driven features work automatically** (sky, better outlines) or sit under Advanced. They never add a decision to the main flow.
- **Nothing new is downloaded on first load.** A new model is fetched only when it is first used, with the size shown in MB, and then cached.
- **Budget:** the page stays under about 200 KB, and no shader change may slow the preview on the S23 FE.
- **Accessibility:** no timers. Every new message gets a read-aloud button.

## Fix first (no new UI)
1. **Save > Video can close the Move tray** when Move is already open, because tapping an open tab closes it.
2. **Video uses the Picture size setting.** At 2880 or 4096 the phone's encoder refuses, and the video falls back to a stuttering screen recording. Video gets its own cap of about 1920.
3. **Play doesn't lock the controls.** Tapping Record during a preview does nothing.
4. **Some settings are forgotten.** The chosen move, its length and Picture size reset on every reload.
5. **Saving 3D points shows no busy screen,** so a large file can freeze the page for a moment.
6. **The screen can sleep during a long video export.** It needs a wake lock.
7. **Automatic messages and menus have no read-aloud button.**
8. **Adding a name opens the keyboard straight away,** which pushes the picture off screen.
9. **Tidy-ups:**
   - Picture size moves into the Save menu.
   - Straighten moves into Adjust > Scene, so it sits beside the manual tilt.
   - Controls a 3D scan ignores (Pattern, Floor, Beams, Range noise) are greyed out, with a one-line reason.
   - Hidden parts also shows during a pan or push-in, not only when the view turns.
   - "Backdrop" becomes "Background" everywhere.

## Phase 1: motion and sharing (Move tab and save screen)
| Feature | Where | Weight |
|---|---|---|
| **Share button** (Web Share to WhatsApp, Instagram, Photos); PLY stays a download | Next to Download on the save screen | about 0.5 KB |
| **Scan sweep:** dots appear outward by distance behind a bright leading edge. This is the "first return" itself | A new move in Move | about 1 KB of shader |
| **Loop:** forward then back, or a full turn for scans | A chip in the Move length row | about 0.5 KB |
| **Start and end views:** set a start and an end, and the move glides between them, including pan | Two chips in Move | about 1.5 KB |
| **Tilt to look:** gyro parallax, so the phone works like a window. The most-loved effect in Apple's and Record3D's apps | One toggle in Move | about 1 KB |
| **Safe path:** moves are limited so they never open visible gaps behind the subject | Automatic | about 0.5 KB |

## Phase 2: looks (shader only, no downloads)
| Feature | Where | Weight |
|---|---|---|
| **Focus blur:** dots away from the subject grow and dim | Adjust > Scene: Off / Soft / Strong | about 0.6 KB |
| **Haze:** distant dots fade into the black | Adjust > Scene | about 0.3 KB |
| **More colour ramps:** Thermal, Turbo, Mono with 4 tint swatches (teal, amber, magenta, white) | The Colour chips; swatches show only for Mono | about 0.8 KB |
| **Decay:** points drift, drop out and jitter, the *House of Cards* look. Also usable as a move | A move, and a Survey-style option | about 1 KB |
| **Name styles:** Glow (now), Survey tag (leader line, small caps), Plain | One chip row in People | about 1.5 KB |
| **Shuffle:** a new random seed or small variation of the current look | One chip on the Look tab | about 0.3 KB |

## Phase 3: better seeing (models on demand, mostly invisible)
| Capability | Licence | Size | Benefit |
|---|---|---|---|
| **Sky mask** (TinySkyNet, from U-2-Net skyseg) | MIT | 0.2 MB | Sky is no longer painted onto a far wall. It becomes black or haze. Automatic |
| **RF-DETR Seg Nano** | Apache-2.0 | about 10 MB int8 (29 MB fp32) | Outlines for every common object in one pass. Could replace the detector plus Magic Touch (together 11 MB), with sharper masks, including dark clothing. Automatic |
| **MoGe-2 ViT-S:** metric depth, true view angle and surface normals | MIT | about 40 to 70 MB | Real scale, no guessed focal length, better "backs" and lidar-style intensity. An optional **Precise geometry** switch in Advanced, used mainly where WebGPU exists. The S23 FE has two versions: the Snapdragon one supports WebGPU in Chrome, the Exynos one doesn't yet |
| **MI-GAN inpainting:** real texture behind subjects instead of blurred fill | MIT weights, but distilled from an NVIDIA non-commercial model | about 28 MB | Much better turned views. Fine for personal use; the licence is uncertain for anything commercial |

## Phase 4: output extras
- **GIF** through gifenc (MIT, 9 KB), as a choice on the save screen.
- **Share to First Return** from the phone's gallery, through a manifest share target.
- **glTF points export** alongside PLY, for three.js and Blender.

## Not recommended
- **Batch processing:** depth takes seconds per photo, and a queue needs its own interface.
- **Settings remembered per photo:** the app has no way to tell photos apart.
- **Different styling for each subject:** a single background colour option covers most of it.
- **Single-photo 3D generators** (SAM 3D, TRELLIS): they need a PC graphics card, and their output can already come in through the scan import.

**Avoid (licence):** Depth Pro, Apple SHARP, UniK3D, Metric3D, EdgeSAM, Robust Video Matting (GPL), Ultralytics YOLO (AGPL), and Depth Anything 3 Large and Giant.

## Suggested order
Fixes → Share → Scan sweep with Loop → Focus blur, Haze and colour ramps → Sky mask → Tilt to look → Start and end views → RF-DETR → the rest.
Everything before RF-DETR adds about 8 KB and no models.

---

# Round four, 24 September 2026: splats, Photoreal and effects

## Built
- **A splat renderer inside the app.** About 11 KB of code and no libraries. It uses the standard 3DGS projection (3D covariance, view, then perspective Jacobian). Splats are sorted back to front by a 16-bit counting sort in a worker, blended premultiplied, and stored in one integer texture. The covariance is stored as halves, scaled toward 1 so millimetre splats survive.
- **Photo to splats.** One splat per depth pixel, lying on its surface. Edge pixels are snapped to the nearer or farther surface, so they no longer float as stripes. The inpainted background behind subjects gets its own splats. Measured: 1.29 M splats in 0.36 s on the PC, and 323 k at phone limits. Frames take 20 to 35 ms after the first.
- **Splat files in.** `.ply` (3DGS), `.splat` and `.spz` v1 to v3. v4 uses Zstandard, which browsers cannot unpack yet. Splats are levelled with their points, rotations included.
- **Splat file out.** Standard 3DGS `.ply`, y-down. Round trip verified: save, reopen, same count and upright.
- **Effects** in both renderers: Sweep, Resolve, Decay and Glitch. The Glitch look (band tearing, channel split, block dropout, scanlines) runs in the compositing pass. A 4 s Resolve orbit recorded to MP4 in 3.3 s.

## Found while building
- The GPU `sin()` hash gives neighbouring indices nearly the same number, which made the Decay streaks. Use an integer hash for anything indexed.
- Sending the splat set with every sort request would have copied tens of MB each time. The worker now gets the positions once, then an id.

## Opportunities this opens (all within the one-page, on-device constraint)
1. **Layered edges everywhere.** The dark tears behind heads when turned come from depth edges that aren't subjects. Running the existing push-pull fill along every depth edge, not only behind picked subjects, would close them. This is the idea behind 3D Photo Inpainting, done cheaply.
2. **Sky as a far dome.** The sky mask (0.2 MB, planned) would put sky splats on a distant sphere, so turning never shows sky as a flat wall.
3. **Relighting.** Splats from a photo carry a surface normal, so a movable light (or a "scan beam" light) can shade them. That is lidar-intensity shading and a new kind of video move.
4. **Depth of field in Photoreal.** Grow splats by their distance from the focus plane. This is nearly free, because splat size is already in the shader.
5. **Mixed looks.** Subject photoreal with dotted surroundings, or the reverse. Both passes exist; it is a per-splat mask.
6. **Lighter splat files.** Export `.spz` (gzip, 8 to 10 times smaller) or a thinned `.ply`. The 72 MB desktop file is heavy to share.
7. **Loops.** The Resolve then Decay pair makes a natural seamless loop for social video.
8. **Several photos, one scene.** Out of reach in the browser without camera-pose solving. The offline route is Brush. Deliberately not pursued, since the aim is to avoid clunky off-app processing.

---

# Round five, 24 September 2026: gentle moves, mixed looks, and a UX/UI audit

## Built
- **Gentle moves.** Push in, Pull out, Slide, Float (loops), Drift, Orbit and Rise, eased with smootherstep. Strength (Gentle by default, Medium, Strong) scales every move and effect. Length goes from 4 to 30 s. Tapping a chip plays the opening of the real move at its real speed.
- **Gentle effects.** Build up, Dissolve and Dust are new. Sweep, Resolve, Decay and Glitch now scale with Strength.
- **Mixed looks.** Real subject and Real setting. Each pixel knows whether it is photo or dots (splat coverage in the alpha channel), so the photo keeps its colours while dots get the filmic curve and glow.
- **Edges filled.** Behind every depth edge the far surface is grown in, closing the tears that showed when the view turned.
- **.spz export.** 12 MB where the .ply is 72 MB. Round trip verified.

## Audit and fixes (code review plus a live walk through at 375 x 812)
- **Fixed, blank picture:** auto framing with no size on screen (page in the background) made the view NaN, and that could be saved into the resume data. It now waits for a size, rejects values that are not numbers, and resume ignores them.
- **Fixed, My looks:** they could apply a look this picture cannot show (blank on a plain scan). They are now greyed out with "Needs a photo". Undo restores which saved look was on. Reset on a saved look keeps the view.
- **Fixed, stale thumbnails:** thumbnails now follow Hide faces and hand-covered faces, and they wait while a move plays.
- **Fixed, Move tab:**
  - Stop ends any preview or video.
  - A chip tap's quick look leaves the controls free, and the next tap cuts it off.
  - An effect this picture cannot play is reset rather than silently swapped.
  - Strength has its own row. Length is a chip next to Play that changes each time it is tapped.
- **Fixed, Photoreal:**
  - The Subject tab dims everything but the subject, and says what it does there.
  - Hidden parts is Off or On.
  - Scanner settings are hidden.
- **Layout:**
  - Looks sit in two labelled rows, Dots and Photo, with a description line that reads aloud.
  - The pattern row is hidden on scans.
  - The selected chip scrolls into view on every tab.
  - The tray height follows the visible screen (dvh).
  - Straighten now lives only in Adjust, Scene.
  - Save items are named by what they are: Points (.ply), Splat, small (.spz), Splat, full (.ply). Picture size says pixels.
- **Accessibility:**
  - Read-aloud is on every message, banner and hint, and each one speaks what it shows.
  - Messages stay until closed or the tab changes, instead of vanishing at a touch.
  - Messages, banners and the busy screen are announced politely (role="status" with aria-live).
  - Menu actions are no longer announced as toggles, and Escape closes menus, About and the save screen.
  - Each name box and Remove button has its own label.
  - Headings are 13.5 px in sentence case. Tab and top-bar labels are larger. Disabled chips have more contrast.

## Still open, then closed in round six
- Look tray: Reset and Undo moved into the heading and the cards are shorter, so the tray is 478 px tall, down from 548. A short scroll reaches My looks.
- Tap to centre: with Pan on, a single tap centres on a spot, so there is no timing.
- Weight: the built page drops full-line comments and indentation, so it is 194 KB, down from 225 KB (the sources keep them).
- New: Focus (depth of field for dots and splats) and the Focus pull effect.

---

# Round six, 25 September 2026: Scan from video, audit and research

## Fixed now (the audit's quick batch)
- **Symmetric (Horn) scale.** Every pose step used a one-sided scale, which is biased low when both point sets are noisy. Chained over 30 frames, that shrank the scene by 25 to 45 percent. Each step is also gated to 0.6 to 1.6x.
- **Inliers in pixels.** Inliers are judged by where a point lands in the picture (3.5 px) rather than by distance along the depth ray, where depth from one photo is least reliable. Depth now only gates.
- **Progress stays readable.** The scan's own progress text is no longer overwritten by the depth step.
- **Seeking cannot hang.** Seeks time out, and each seek waits for the decoded frame (requestVideoFrameCallback).
- **Long videos.** A long video is cut to what the frame budget covers (about 0.4 s apart), and the result says so.
- **Lost frames.** A frame that could not be placed gets a second try against the nearest placed frames.
- **FAST.** Uses the proper FAST-9 pre-test.
- **Tidying.** Empty black pixels no longer create voxels. The video decoder is released however the scan ends.

## Ranked plan (audit and research agree)
1. **Pose from 2D matches plus a depth fit for each frame.** PnP on pixel error against points already placed in the world. Then fit each frame's disparity as 1/z = a*d + b to those points, which removes the fixed shift and the bending. This is the biggest geometry gain (3 to 5 days).
2. **Capture quality.** Keyframes chosen by sharpness (variance of the Laplacian) and parallax, and in-app capture with exposure and white balance locked (applyConstraints) and a "too fast" cue from the gyro. No timers.
3. **Multi-view consistency in fusion.** Keep a pixel only where 2 or more neighbouring depth maps agree, and take a weighted mean or median. This removes doubled surfaces and floaters.
4. **Swap the depth model to Depth Anything 3 Small** (Apache-2.0, single-view ONNX exists), and run it on WebGPU where the phone has it.
5. **Focal length** found by a 1D search that maximises inliers.
6. **Oriented, disc-like splats** from depth normals (reuses the photo-splat logic).
7. **Loop closure, a pose graph, then windowed bundle adjustment** (Levenberg-Marquardt with a Schur complement; under a second for about 40 cameras).
8. **Later: DA3-Small's multi-view pose-and-depth graph** exported to ONNX and run in windows of 8 to 16 keyframes on WebGPU.
9. **Later: optional Brush "Refine"** (Apache-2.0, trains in the browser on WebGPU) seeded from the fused splats, on phones that support it.

**Avoid (licence):** DUSt3R and MASt3R, MV-DUSt3R+, Fast3R, Pi3, the original VGGT, ORB-SLAM3 (GPL), and Video Depth Anything Base and Large.
**Too big for a phone:** MapAnything (its Apache variant is useful as a desktop reference), VGGT-1B-Commercial and AnySplat.

---

# Round seven, 25 September 2026: tested on real phone video

Two hand-held clips of books and a toy on a bedside table (1080 x 1920, 20 and 23 s). The first run, before this round, followed 25 of 44 frames of the easier clip and doubled the toy about four times. The changes below follow the standard visual-odometry and multi-view-stereo recipe (ORB-SLAM keyframe relocalisation, PnP, bundle adjustment, COLMAP-style depth fusion; CasualSAM for fitting monocular depth per frame).

## Built
- **Sharpest moment.** Each sample time looks at three nearby moments and keeps the sharpest (Laplacian energy). Frames are spread over the whole clip, at most about 0.65 s apart, instead of cutting it at 18 s.
- **PnP placement.** A new frame is placed by where points already in the scene land in its picture, from the last three placed frames at once. Hypotheses come from Horn on three matches, then Levenberg-Marquardt polishes the pose on Huber-weighted pixel error. Depth from one photo is used only on the side already in the scene, so errors no longer compound.
- **Depth scale only while chaining.** Fitting scale and shift per frame during the chain let each frame pass a flatter scene to the next (the scale fell from 0.58 to 0.06 over 26 frames). While chaining, only the scale is fitted.
- **Found again.** A lost frame is searched for across the whole scene so far, with candidates ranked by a tiny thumbnail, so tracking resumes when the walk comes back to a place it has seen.
- **Bundle adjustment.** All cameras plus each frame's depth scale and offset are solved together (8 unknowns a frame, frame 0 fixed, numerical Jacobians, Cholesky, Huber, outliers dropped halfway). Pixel error went from 2.6 to 1.85 px on both clips.
- **Depth consensus, then agreement.** Before fusion, each pixel's depth becomes the median of what up to six neighbouring views put on that line of sight. A point is then kept only when two other views find a surface within 5 percent. Agreement (voxels seen by 2 or more frames) went from 0.13 to 0.38.
- **Cheaper and steadier on phones.** Frame colour is kept at the depth grid's size (a quarter of the memory). Depth runs at 364 px on phones and 434 px on computers. The screen stays awake during a scan (Wake Lock). Progress changes within each frame, not only between frames. Candidate frames are chosen by thumbnail before any feature matching: that cut tracking from 42 s to 12 s.

## Results (PC, hidden test tab, so slower than real)
- Toy clip: 36 of 44 frames followed; the book, shelf and bottles are solid and square. The white toy's eyes still show a few copies: it has no texture to match, so each view's depth guess for it stands alone.
- Books clip: 29 of 44 frames followed. The blurry close-ups from about 9 to 16 s are lost, then tracking finds itself again. The Bible, the green book, the shelf post, the toy and the tissue box all come out as solid, legible objects.
- Tried and set aside: a lens-angle search. Inliers were flat from tan 0.5 to 0.8, and agreement peaked at the 0.62 already used.

## Next
- **Live capture (see below)** would remove the hardest part, following the camera, by using the phone's own AR tracking.
- A photometric refine (Brush) is what would fix plain, textureless things like the white toy.

---

# Round eight, 25 September 2026: live scan, crisper splats, pieces of map

## Built
- **Live scan (Open, Live scan).** The phone chooses its own views while you walk: one is kept only when you are steady (sharp) and at a new angle (adds something), with spoken and written advice and no timers.
  - *With AR tracking* (WebXR immersive-ar with camera-access, Chrome on Android through ARCore): every view comes with its camera position in metres and the lens from the projection matrix, so nothing is worked out afterwards. A ring of 16 directions by 3 heights shows coverage. The depth sensor (depth-sensing, cpu-optimized) sets true scale where present. A self-check compares the depth model with the sensor on the picture as copied and turned over, and turns the pictures if they came out upside down. When the views fill up, every second one is let go and the spacing doubles, so the scan spans the whole walk. After capture, only depth is solved: per-frame scale and offset fitted to sensor depth plus points triangulated between known cameras, then bundle adjustment on depth alone.
  - *Camera alone*: views about half a second of movement apart (tested on the toy clip, stepped at 15 fps), never leaving a gap (a steady view is kept once the picture has moved well on, even if a little soft), with exposure and white balance held after the first view. Placed afterwards as a video scan.
- **Pieces of map.** When the camera cannot be followed, a new piece starts instead of the rest being lost. Pieces are joined afterwards wherever a view is recognised in the joined map, with the scale settled at the join (as ORB-SLAM merges maps).
- **Crisper splats.** Colour is weighted to the sharpest, nearest views (sharpness over distance squared) instead of an even average. Where the views agree on a surface's facing (about 80 percent of splats), each splat is a thin disc lying on it rather than a ball.
- **Shared code.** Reading a frame and building a scene are separate (frameFromCanvas, buildScanScene), so video and both live modes share the same fusion. quatFromAxes is shared with the photo splats.

## Tested
- Video clips: unchanged or better (toy 36 of 44, books 29 of 44; pixel error 1.84 and 1.87 px). The pieces the joins could not reach are the extreme close-ups and the overhead swing, which share too little with the rest.
- Camera-alone live scan on the toy clip: views spread evenly, gaps closed, and all 44 placed on the first spacing tried.
- AR path: run end to end against a stand-in session (video frames as the camera, a made-up orbit, a made-up depth sensor) with no errors: views kept, ring filled, upright check, depth scaling, known-pose build and the finished note. **Still to test on a real phone**, which is the only place the camera picture's orientation and ARCore's depth can be confirmed.

## Next
- A UI and UX pass across the whole app (menus, a tray for less-used features, workflow).
- Photometric refinement for plain, textureless things.
