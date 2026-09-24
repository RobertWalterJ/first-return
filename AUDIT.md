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
