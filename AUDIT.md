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
