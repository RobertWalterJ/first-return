# First Return

Turns a photo into a lidar-style point cloud. Personal tool, not GPA.

**Run it:** double-click `Launch First Return.bat` (or the Desktop shortcut). It opens at http://localhost:8811. The window it opens also prints a link for your phone on the same Wi-Fi.

## How it works
1. **Depth:** Depth Anything V2 Small (int8, 27 MB, split into two parts in `docs/models/`) runs on the device through ONNX Runtime Web (WASM). The photo never leaves the machine.
2. **Subject:** a depth threshold (Otsu) splits near from far. Connected regions become separate subjects. A level floor visible in the photo is found by fitting the steady rise in depth at the outer edges of the lower frame. It is treated as background so the synthetic floor can replace it.
3. **Cloud:** stratified samples (or scan rings, or a grid) are back-projected through a 50° pinhole camera. Points on depth cliffs ("flying pixels") are dropped, the way a real sensor would.
4. **Render:** WebGL2 points with depth testing, then a two-width bloom. Wide frames keep the photo's vertical field of view.
5. **Faces:** UltraFace RFB-320 (1.3 MB) scans the whole frame plus overlapping tiles. In each face, colour is blurred, the depth is smoothed so the 3D profile is gone, and points are thinned and roughened. This is not a guarantee of anonymity: hair, clothes and the setting can still identify someone.
6. **Video:** MediaRecorder captures the canvas as MP4 where the browser supports it, otherwise as WebM.

## Editing
Edit `src/first-return.html`, then run `python build.py` to regenerate `docs/index.html`. Never hand-edit the built file. `src/first-return.html` is also the Artifact page. `tools/precompute.mjs` rebuilds the sample's depth map.

## Credits
- Sample: *Abraham Lincoln: The Man (Standing Lincoln)*, Augustus Saint-Gaudens, The Metropolitan Museum of Art, CC0.
- Depth Anything V2 Small, Apache 2.0 (onnx-community export).
- UltraFace (Linzaer), MIT, from the ONNX model zoo.
- ONNX Runtime Web 1.20.1, MIT.
