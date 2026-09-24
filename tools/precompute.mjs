// Precompute the bundled sample: a resized JPEG plus its depth map as a 16-bit PNG
// (high byte in R, low byte in G). Uses the same preprocessing as the app.
import fs from 'node:fs';
import ort from 'onnxruntime-node';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';

const SRC = process.argv[2] || 's1.jpg';
const OUT = '../app/';
const LONG = 518;            // model input long side (multiple of 14)
const PHOTO_LONG = 1100;     // bundled photo long side

const img = jpeg.decode(fs.readFileSync(SRC), { useTArray: true });

function resize(src, sw, sh, dw, dh) {
  const out = new Uint8Array(dw * dh * 4);
  for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) {
    const fx = (x + 0.5) * sw / dw - 0.5, fy = (y + 0.5) * sh / dh - 0.5;
    const x0 = Math.max(0, Math.floor(fx)), y0 = Math.max(0, Math.floor(fy));
    const x1 = Math.min(sw - 1, x0 + 1), y1 = Math.min(sh - 1, y0 + 1);
    const ax = Math.min(1, Math.max(0, fx - x0)), ay = Math.min(1, Math.max(0, fy - y0));
    for (let c = 0; c < 4; c++) {
      const a = src[(y0 * sw + x0) * 4 + c], b = src[(y0 * sw + x1) * 4 + c];
      const d = src[(y1 * sw + x0) * 4 + c], e = src[(y1 * sw + x1) * 4 + c];
      out[(y * dw + x) * 4 + c] = (a * (1 - ax) + b * ax) * (1 - ay) + (d * (1 - ax) + e * ax) * ay;
    }
  }
  return out;
}

// bundled photo
const ps = PHOTO_LONG / Math.max(img.width, img.height);
const pw = Math.round(img.width * ps), ph = Math.round(img.height * ps);
fs.writeFileSync(OUT + 'sample.jpg', jpeg.encode({ data: resize(img.data, img.width, img.height, pw, ph), width: pw, height: ph }, 86).data);

// model input
const s = LONG / Math.max(img.width, img.height);
const mw = Math.max(14, Math.round(img.width * s / 14) * 14), mh = Math.max(14, Math.round(img.height * s / 14) * 14);
const px = resize(img.data, img.width, img.height, mw, mh);
const mean = [0.485, 0.456, 0.406], std = [0.229, 0.224, 0.225];
const t = new Float32Array(3 * mw * mh);
for (let i = 0; i < mw * mh; i++) for (let c = 0; c < 3; c++) t[c * mw * mh + i] = (px[i * 4 + c] / 255 - mean[c]) / std[c];

const sess = await ort.InferenceSession.create('depth-anything-v2-small-q8.onnx');
console.log('inputs', sess.inputNames, 'outputs', sess.outputNames);
const t0 = Date.now();
const res = await sess.run({ [sess.inputNames[0]]: new ort.Tensor('float32', t, [1, 3, mh, mw]) });
const out = res[sess.outputNames[0]];
console.log('dims', out.dims, 'ms', Date.now() - t0);
const d = out.data; const [ , oh, ow] = out.dims.length === 3 ? out.dims : [1, out.dims[2], out.dims[3]];
let lo = Infinity, hi = -Infinity; for (const v of d) { if (v < lo) lo = v; if (v > hi) hi = v; }
const png = new PNG({ width: ow, height: oh });
for (let i = 0; i < ow * oh; i++) {
  const q = Math.round((d[i] - lo) / (hi - lo) * 65535);
  png.data[i * 4] = q >> 8; png.data[i * 4 + 1] = q & 255; png.data[i * 4 + 2] = 0; png.data[i * 4 + 3] = 255;
}
fs.writeFileSync(OUT + 'sample-depth.png', PNG.sync.write(png));
console.log('photo', pw, ph, 'depth', ow, oh);
