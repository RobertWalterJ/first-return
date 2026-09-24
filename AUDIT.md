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
