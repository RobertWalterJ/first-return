# First Return

Turns a photo into a lidar-style point cloud. Personal tool, not GPA. Live at https://robertwalterj.github.io/first-return/

**Run it locally:** double-click `Launch First Return.bat` (or the Desktop shortcut). It runs `node serve.mjs` and opens http://localhost:8811. The window also prints a link for your phone on the same Wi-Fi.

## Using it
- **Look:** four styles (Void, Sparse, Scanner, Survey), each shown as a thumbnail of your own photo, plus the dot pattern (Scatter, Scan rings, Grid).
- **Adjust:** one control at a time, each with named steps: Dots, Dot size, Glow, Brightness, Colour, 3D, Backdrop, Floor, Edges.
- **Subject:** tap what matters. **Sharper outline** adds Magic Touch for cleaner edges.
- **Move:** camera moves as an MP4 video.
- **People:** hide faces (Light, Medium or Strong, or tap to cover a face) and add floating names.
- Hold the split-square button on the picture to compare with the photo. Drag to turn the view, pinch to zoom, double tap to line it back up.

See `AUDIT.md` for the design, science and capabilities review behind this version.

## How it works
1. **Depth:** Depth Anything V2 Small (int8, split into two parts in `docs/models/`) runs on the device through ONNX Runtime Web (WASM). A guided filter snaps the depth edges to the photo.
2. **Camera:** the field of view comes from the photo's EXIF 35 mm focal length.
3. **Floor:** a RANSAC plane is fitted in (column, row, disparity). It finds the floor, and its horizon sets the depth shift, which is the real near-to-far ratio.
4. **Subject:** either the automatic Otsu depth cut with the floor excluded, or tap-seeded region growing through depth. Magic Touch outlines are optional.
5. **Cloud:** stratified samples, or scan rings with real beam elevations, back-projected. Points on depth cliffs are dropped, range noise is added, and scan rings lose returns on dark surfaces and at glancing angles. The synthetic floor sits on the fitted 3D plane.
6. **Render:** WebGL2 points in linear light, half-float targets, eye-dome lighting, two-width bloom and ACES tone mapping. Recovers if the phone drops the graphics context.
7. **Faces:** UltraFace RFB-320 on aspect-correct tiles. Anonymising blurs or flattens the colour, smooths the depth and thins the points.
8. **Video:** WebCodecs with mp4-muxer, frame by frame. MediaRecorder is the fallback.

## Editing
Edit `src/shell.html` (markup and CSS) and `src/js/*.js` (joined in name order), then run `python build.py` to regenerate `docs/index.html`. Never hand-edit the built file. `tools/precompute.mjs` rebuilds the sample's depth map.

## Credits
- Sample: *Abraham Lincoln: The Man (Standing Lincoln)*, Augustus Saint-Gaudens, The Metropolitan Museum of Art, CC0.
- Depth Anything V2 Small, Apache 2.0 (onnx-community export).
- MediaPipe Tasks Vision and the Magic Touch model, Apache 2.0.
- UltraFace (Linzaer), MIT, from the ONNX model zoo.
- ONNX Runtime Web 1.20.1, MIT. mp4-muxer 5.2.2, MIT.
