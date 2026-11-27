/**
 * filters.js — clean photo filters ('bw' | 'sepia' | 'normal') with
 * auto-exposure contrast and unsharp-mask sharpening so digital strips
 * look great AND thermal prints stay crisp and sharp.
 */

export function applyFilter(canvas, filterId = 'bw') {
  const w = canvas.width;
  const h = canvas.height;
  if (!w || !h) return canvas;

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const image = ctx.getImageData(0, 0, w, h);
  const px = image.data;

  // 1. Subtle unsharp mask on luminance so faces, eyes, and hair print sharply
  sharpenImage(px, w, h, 0.42);

  // 2. Apply selected color grade + crisp S-curve contrast
  for (let p = 0; p < px.length; p += 4) {
    let r = contrastCurve(px[p]);
    let g = contrastCurve(px[p + 1]);
    let b = contrastCurve(px[p + 2]);

    if (filterId === 'bw') {
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      r = g = b = lum;
    } else if (filterId === 'sepia') {
      const sr = r * 0.393 + g * 0.769 + b * 0.189;
      const sg = r * 0.349 + g * 0.686 + b * 0.168;
      const sb = r * 0.272 + g * 0.534 + b * 0.131;
      r = sr;
      g = sg;
      b = sb;
    }

    px[p]     = r < 0 ? 0 : r > 255 ? 255 : r;
    px[p + 1] = g < 0 ? 0 : g > 255 ? 255 : g;
    px[p + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
    px[p + 3] = 255;
  }

  ctx.putImageData(image, 0, 0);
  return canvas;
}

/** Gentle S-curve contrast boost for crisp tonal separation. */
function contrastCurve(v) {
  const n = v / 255;
  const curved = n < 0.5
    ? 0.5 * Math.pow(2 * n, 1.16)
    : 1 - 0.5 * Math.pow(2 * (1 - n), 1.16);
  return curved * 255;
}

/** Fast 3x3 luminance unsharp mask for crisp edges on screen & thermal paper. */
function sharpenImage(px, w, h, amount) {
  const count = w * h;
  const lum = new Float32Array(count);
  for (let i = 0, p = 0; i < count; i++, p += 4) {
    lum[i] = 0.299 * px[p] + 0.587 * px[p + 1] + 0.114 * px[p + 2];
  }

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const blur = (lum[i - w] + lum[i - 1] + lum[i + 1] + lum[i + w]) * 0.25;
      const delta = (lum[i] - blur) * amount;
      const p = i * 4;
      px[p]     += delta;
      px[p + 1] += delta;
      px[p + 2] += delta;
    }
  }
}
