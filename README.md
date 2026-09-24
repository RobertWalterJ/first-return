# First Return

Turns a photo into a lidar-style point cloud. Personal tool, not GPA. Live at https://robertwalterj.github.io/first-return/

**Run it locally:** double-click `Launch First Return.bat` (or the Desktop shortcut). It runs `node serve.mjs` and opens http://localhost:8811. The window also prints a link for your phone on the same Wi-Fi.

## Using it
- **Look:** four styles (Void, Sparse, Scanner, Survey), each shown as a thumbnail of your own photo, and the **Dot pattern** (Scatter, Scan rings, Grid) right under them. **My looks** keeps your own: change anything, tap Save this look and name it. Saved looks get thumbnails too, and Reset look returns to the saved version. Share looks writes `first-return-looks.json`; Load looks reads one on another device (duplicates and bad entries are skipped). A removed look can be brought back.
- **Adjust:** controls sit in four groups, one control at a time with named steps. **Dots:** Amount, Dot size. **Light and colour:** Brightness, Glow, Shadows, Colour, Outlines. **Scene:** Depth, Background, Floor, Hidden parts. **Advanced:** diagnostic views and direct settings.
- **Subject:** each new photo is searched for people and things (people, animals, vehicles, boats; not furniture), and each one found is outlined and framed. If nothing is found, the nearest things are used. Tap what matters to choose yourself; **Sharper outline** adds Magic Touch for cleaner edges; **Nearest things** goes back to depth alone.
- **3D scans:** Open also takes a `.ply` point cloud (Polycam, phone lidar apps, photogrammetry, Gaussian splats from Brush and similar). The scan is levelled on its own floor and drawn in the same looks; its floor follows the Backdrop setting.
- **Hidden parts (Adjust, Scene):** fills in what one photo cannot see, the background behind people and things (push-pull inpainting of depth and colour) and a rounded back for each subject sized from its silhouette. Both appear only as the view turns away from the photo; Scanner leaves them off, since real lidar has shadows.
- **Advanced (Adjust):** views of the depth map and of what counts as subject and floor, plus direct settings for view angle, far-versus-near depth, tilt, scanner beams, range noise and picture size.
- **Straighten (Shape menu):** a tilted photo is levelled from how its upright edges lean. Lean is fitted against position across the frame, so converging verticals (looking up or down) give the camera's pitch instead of a false tilt; the pitch then sets the horizon for the depth range. Calibrated on synthetic scenes of known tilt; photos without clear verticals are left alone.
- **Shadows (Adjust, Light and colour):** evens out the photo's lighting so backlit and silhouetted subjects still show. It switches on by itself when the subject is dark.
- **Move:** camera moves as an MP4 video.
- **People:** hide faces (Light, Medium or Strong, or tap to cover a face) and add floating names.
- Hold the split-square button on the picture to compare with the photo.
- **Share:** saved pictures and videos have a Share button that opens the phone's share sheet (WhatsApp, Instagram, Photos). Where a file type can't be shared, it downloads instead.
- **Picks up where you left off:** if the phone drops the page while you're in another app, reopening brings back the photo (or scan), what was picked, names, hidden faces, settings and the view. It is kept on the device only (IndexedDB) and replaced when you open something new.
- **Moving around:** drag to turn, pinch or scroll to zoom. Drag with two fingers to slide the view; on a computer right-drag, middle-drag or Shift+drag (Shift+arrow keys too). The Pan button (four arrows) makes a one-finger drag slide instead of turn. After a slide, turning centres on whatever is in the middle of the screen. Double tap a spot to glide it to the centre and turn around it. The circular-arrow button lines everything back up with the photo.

See `AUDIT.md` for the design, science and capabilities review behind this version.

## How it works
1. **Depth:** Depth Anything V2 Small (int8, split into two parts in `docs/models/`) runs on the device through ONNX Runtime Web (WASM). A guided filter snaps the depth edges to the photo.
2. **Camera:** the field of view comes from the photo's EXIF 35 mm focal length.
3. **Floor:** a RANSAC plane is fitted in (column, row, disparity). It finds the floor, and its horizon sets the depth shift, which is the real near-to-far ratio.
4. **Floors and subject:** up to three floor planes (RANSAC), plus any large upward-facing surface running off the bottom of the frame (docks, decks, tables), are treated as floor. The subject is found by MediaPipe's EfficientDet Lite0 detector with each find outlined by Magic Touch and checked against depth; failing that, the nearest non-floor things (Otsu cut). Taps grow through depth. Small subjects get an extra sampling pass so they hold detail when framed close.
5. **Cloud:** stratified samples, or scan rings with real beam elevations, back-projected. Points on depth cliffs are dropped, range noise is added, and scan rings lose returns on dark surfaces and at glancing angles. The synthetic floor sits on the fitted 3D plane.
6. **Render:** WebGL2 points in linear light, half-float targets, eye-dome lighting, two-width bloom and ACES tone mapping. Recovers if the phone drops the graphics context.
7. **Faces:** YuNet (OpenCV Zoo) on the letterboxed photo plus overlapping tiles. Medium and Strong (default Medium) fill each face with its own average colour, smooth the depth and thin the points; Light only blurs, which recognition software can sometimes undo.
8. **Video:** WebCodecs with mp4-muxer, frame by frame. MediaRecorder is the fallback.

## Editing
Edit `src/shell.html` (markup and CSS) and `src/js/*.js` (joined in name order), then run `python build.py` to regenerate `docs/index.html`. Never hand-edit the built file. `tools/precompute.mjs` rebuilds the sample's depth map.

## Credits
- Sample: *Abraham Lincoln: The Man (Standing Lincoln)*, Augustus Saint-Gaudens, The Metropolitan Museum of Art, CC0.
- Depth Anything V2 Small, Apache 2.0 (onnx-community export).
- MediaPipe Tasks Vision, the Magic Touch model and EfficientDet Lite0, Apache 2.0.
- YuNet face detector (OpenCV Zoo), MIT.
- coi-serviceworker (Guido Zuidhof), MIT: enables multi-core processing on GitHub Pages.
- ONNX Runtime Web 1.20.1, MIT. mp4-muxer 5.2.2, MIT.
