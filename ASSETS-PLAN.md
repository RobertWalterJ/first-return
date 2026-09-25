# First Return: game assets from photos, a plan (draft for audit)

25 September 2026. Personal project, not GPA work.

## The question

Can First Return turn photos into things a game can use, in the low poly style Robert
uses in Coilover and On the Step: simple shapes wearing real photographs? And can it help
with game systems such as GTA V style pedestrians?

Three features answer that. Each one is a separate build, in this order.

| | Feature | What comes out | Who uses it |
|---|---|---|---|
| A | **Low poly object** | a `.glb` model: few triangles, the photo as its skin | any 3D engine, Blender, Coilover |
| B | **Wall to material** | a square texture that repeats, plus a bump (normal) map | Coilover ground, walls, buildings |
| C | **People to spots** | a `.json` list of where people stand and sit, on the ground | a pedestrian system's spawn and idle points |

Later, not in this plan: a "Complete this object" button that sends the photo to a GPU
machine running a single-image 3D model (SAM 3D Objects, TRELLIS.2, Hunyuan3D, SPAR3D) and
brings the whole object back; and several photos of one object fused into one model.

## Ground rules (from AUDIT.md round three, still binding)

- No new tabs and no new top-bar buttons. Everything lives on the **Save** screen as one
  new row of choices per feature.
- Nothing new downloads on first load. The asset code is its own file (`asset.js`), loaded
  the first time someone taps an asset export. The page is already 234 KB, over its 200 KB
  budget, so none of this may go into the main page.
- No timers. Every message gets read-aloud.
- The anonymised photo (`S.photo`) is the only source of colour. Faces never leave the app
  un-blurred.
- Everything runs on the phone. No server.

## What we start from (already in the code)

- `S.depth`: relative depth grid (1 = near), about 434 px on the long side on a phone.
- `zOf(d)` and `unproject(u,v,z)`: depth to 3D, through `SHIFT`, which the **Depth** slider
  changes. `uvOf(p)` goes back.
- `S.compMap` from `subjectMap()`: which pixels belong to which picked subject.
- `S.planes` and `S.ground`: RANSAC floors. `S.roll`, `S.pitchTan`: camera tilt.
- `hiddenFill(map)`: push-pull fill behind the subject; row extents `lo`/`hi` for rounded backs.
- The 5% depth-cliff test in `buildCloud`, which stops skin being stretched between near and far.
- `75-measure.js`: ground distances and heights from the horizon plus an assumed camera height
  of 1.5 m. Lesson on record: a floor plane fitted to relative depth gives heights about 5 times
  too small, so real-world scale must come from the horizon or from a known size, never from
  the depth alone.
- The finder: people and things (EfficientDet Lite0) with Magic Touch outlines.
- Coilover (three.js r128, single file, offline) already bakes photo textures as base64 PNGs at
  128 px: high-passed, edge-blended to wrap, quantised to 7 levels, nearest filter when
  magnified. That recipe is the target look for B and for the skin in A.

## A. Low poly object

**One tap:** Save, then 3D object. Choices on one row: **Detail** (Chunky, Low, Medium, Fine),
**Back** (Open, Flat, Rounded), **Skin** (Photo, Game: 128 px posterised).

1. **Freeze the shape.** Export always uses the Depth setting "Normal" (the photo's own
   near-to-far ratio), not whatever the Depth slider is set to for the look. Otherwise the
   object's proportions would depend on a style choice.
2. **Which pixels.** The picked subject(s) by default. If nothing is picked, the whole scene
   except the sky. Floors become a separate flat piece.
3. **Mesh the depth as a height field.** The depth grid is a height field in image space, so
   use **RTIN** (right-triangulated irregular network, the method in Mapbox's Martini): resample
   the depth to a 2^k+1 grid, and split triangles only where the surface bends more than an
   error limit. It never leaves cracks, is fast, and is small code. The error is measured as a
   fraction of distance (a 1 cm bump matters near the camera, not at 30 m). Detail sets the
   limit: Chunky about 150 triangles, Low 600, Medium 2,500, Fine 10,000.
4. **Cut at cliffs and at the outline.** Drop triangles that cross a depth cliff (the same 5% test
   as the dots) or whose centre is outside the subject. Snap boundary vertices onto the
   outline (marching squares, then Douglas-Peucker) so the silhouette is clean rather than a
   staircase.
5. **The back.** Open: the shell alone, drawn double-sided. Flat: the outline pushed straight
   back to a flat plate. Rounded: the existing rounded-back rule (thick where the subject is
   wide). Back faces take the average colour of the front row they come from: flat colour
   suits low poly, and it does not pretend to know what the back looks like.
6. **Skin (texture bake).** Every front vertex keeps its photo position as its UV. A big low poly
   triangle that runs away from the camera would warp the photo if the UVs were just interpolated
   (the PS1 "swimming texture" effect). So the skin is **baked**: for every texel of each triangle,
   find its true 3D point and read the photo where that point really falls. Output 512 px (Photo)
   or 128 px posterised to 7 levels with nearest filtering (Game), matching Coilover.
7. **Seen, filled or guessed.** Each vertex carries `_PROVENANCE` (0 = seen in the photo,
   1 = filled between seen parts, 2 = invented back). glTF allows custom attributes that start
   with an underscore; engines ignore them unless asked. A stretch warning is also recorded
   where the photo has too few pixels per square metre (steep surfaces).
8. **Size and orientation.** Y up, level (camera roll and pitch taken out), origin at the centre
   of the object's base on the floor. Scale: if Measure's horizon is set, metres from that;
   otherwise one field, "How tall is it?", with 1 m, 2 m and 3 m chips plus a typed value.
   The file records which method set the scale (`extras.scale`).
9. **The file.** A hand-written GLB writer (about 120 lines): positions, normals, UVs,
   `_PROVENANCE`, indices, one embedded PNG, a sampler set to nearest when magnified, and
   `extras` with the source, date and scale method. Checked with the Khronos glTF Validator.
10. **Coilover side.** three.js r128 has no GLB loader in the core file, and Coilover must run
    offline from one file. Because we control the writer, Coilover gets a tiny GLB reader
    (about 60 lines) that only understands what First Return writes, and assets go in as
    base64 like its textures.

**Done means:** a known synthetic scene (a tilted plane and a sphere with a made-up depth map)
comes back within 2% of its shape at Fine; the bake's texture error is under 1 pixel against a
reference render; the file passes the validator; it loads in Blender and in three.js r128; and on
the S23 FE the export takes under 5 seconds with no freeze of the page.

## B. Wall to material

**One tap:** Save, then Material, then tap a wall.

1. **Find the wall.** Grow a region from the tap across pixels whose depth normals agree, then
   fit a plane (the same RANSAC as the floors).
2. **Make it flat-on.** Remove perspective using the wall's two vanishing points, from its
   vertical and horizontal edges (the structure tensor already finds verticals). The depth
   plane is the fallback. Lines are preferred because relative depth gets the wall's angle
   wrong.
3. **Crop** the largest rectangle with no subject, sky or low-confidence depth in it.
4. **Make it repeat.** Coilover's recipe: high-pass (removes the sun and shade across the wall),
   then blend the edges so it wraps. For brick and siding, find the repeat distance by
   autocorrelation and crop to a whole number of courses, so the tiling follows the real pattern.
5. **Bump map.** The depth is too soft to see mortar lines. So the bump comes from the photo's
   own fine brightness (a standard trick), blended with the depth's large shape. Labelled as a
   guess.
6. **Scale.** Metres per tile from one known size. Chips: Ontario modular brick course (about
   67 mm with mortar), siding board, concrete block, or a typed value.
7. **Out:** albedo and normal PNGs at 128, 256 or 512, and a Coilover-ready base64 snippet.

**Done means:** on `buildings.jpg` and two more walls, the tile shows no visible seam when
repeated 4 by 4, brick courses stay level to within 1 pixel per 128, and Robert can drop it
into Coilover without editing anything.

## C. People to spots

**One tap:** Save, then People spots (only shown when the finder found people).

1. **Where each person stands.** Foot point = the lowest outline pixel of each found person.
   Cast a ray from the camera through it to the ground, using the horizon and the 1.5 m camera
   height (the Measure method), not the floor fitted to relative depth.
2. **Standing or sitting.** Height in metres from the same single-view method. Under about
   1.35 m with the feet on the ground = sitting. Otherwise standing.
3. **Groups.** People within 1.5 m of each other form a group (conversation clusters, as in
   Gehl's public-life counts).
4. **Out:** JSON: `{scale, horizon, camera_height, points:[{x, z, pose, group, confidence}]}`
   in the same frame as the object export from A, so spots sit on the exported ground. No
   pictures, no faces, only positions.
5. **Honesty.** One photo is one instant. The file says so, and the feature is framed as
   sampling: many photos of one place build a heat map of where people linger. Video clips
   (48 frames) can later add walking paths and speeds.

**Done means:** on the family selfie and the street tests, ground positions agree with a hand
measurement within 15% at 10 m; sitting versus standing is right for every clear case in the
test set.

## Risks this plan already expects

- Relative depth is not a true shape. A: freeze the Depth setting; a later MoGe-2 metric depth
  model would help.
- Thin things (poles, railings, leaves) break up in depth at 434 px. Warn, do not fake.
- Glass, sky reflections and shiny cars give wrong depth.
- The back is always invented. The provenance attribute says so.
- Phone memory: a 512 px bake plus the mesh must stay within about 50 MB.

## Build order and size (rough)

1. A: GLB writer and validator test, then RTIN and cut, then texture bake, then backs, then UI.
   Two to three sessions.
2. B: one to two sessions.
3. C: one session, since the finder, horizon and ground maths already exist.
