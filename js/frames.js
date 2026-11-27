/**
 * frames.js — loads an SVG frame, stamps today's date/time into it,
 * finds the photo windows, rasterizes it, and composes the final strip.
 *
 * Expected files: assets/frames/{newsprint|receipt|film}-{1|2|3}.svg
 * Photo windows:  <g id="photo-01"><rect x y width height/></g>  (also -02, -03)
 * Text targets:   #date, #header-2, #serial
 */

const PRINTER_FRAME_WIDTH = 384; // Paperang P1 output width (48 bytes * 8 bits)
const DIGITAL_SCALE = 3;          // compose the capture/export strip at 3x print width
const FRAME_WIDTH = PRINTER_FRAME_WIDTH * DIGITAL_SCALE; // 1152px digital master
const TARGET_ASPECT = 4 / 3; // uniform photo aspect ratio across all frames
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

const pad = (n) => String(n).padStart(2, '0');

/**
 * Load + prepare a frame.
 * Returns { style, shotCount, image, width, height, slots }
 *  - image: a <canvas> with the rasterized SVG (opaque white paper)
 *  - slots: [{ x, y, w, h }, ...] in canvas pixels, one per photo
 */
export async function loadFrame(style, shotCount) {
  const url = `assets/frames/${style}-${shotCount}.svg`;
  const response = await fetch(url); // needs a local server, not file://
  if (!response.ok) throw new Error(`Could not load ${url} (${response.status})`);
  const svgText = await response.text();

  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  if (doc.querySelector('parsererror')) throw new Error(`Invalid SVG: ${url}`);
  const svg = doc.documentElement;

  injectDateTime(doc);

  // Work out the SVG's own size from its viewBox (fallback: width/height).
  const vb = (svg.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
  const srcW = vb.length === 4 ? vb[2] : parseFloat(svg.getAttribute('width'));
  const srcH = vb.length === 4 ? vb[3] : parseFloat(svg.getAttribute('height'));
  if (!srcW || !srcH) throw new Error(`SVG needs a viewBox or width/height: ${url}`);

  const scale = FRAME_WIDTH / srcW;
  const height = Math.round(srcH * scale);

  // Read each photo window's <rect> in SVG units first.
  const rawRects = [];
  for (let i = 1; i <= shotCount; i++) {
    const rect = doc.querySelector(`#photo-0${i} rect`);
    if (!rect) throw new Error(`Missing #photo-0${i} <rect> in ${url}`);
    if (rect.parentNode.getAttribute('transform')) {
      console.warn(`#photo-0${i} has a transform; slot position may be off.`);
    }
    rawRects.push({
      el: rect,
      x: parseFloat(rect.getAttribute('x') || 0),
      y: parseFloat(rect.getAttribute('y') || 0),
      w: parseFloat(rect.getAttribute('width')),
      h: parseFloat(rect.getAttribute('height')),
    });
  }

  // Normalize all photo slots to the exact same size (fit inside the smallest slot).
  const maxW = Math.min(...rawRects.map((r) => r.w));
  const maxH = Math.min(...rawRects.map((r) => r.h));
  const uniformSrcW = Math.min(maxW, maxH * TARGET_ASPECT);
  const uniformSrcH = uniformSrcW / TARGET_ASPECT;

  const slots = rawRects.map((r) => {
    const normX = r.x + (r.w - uniformSrcW) / 2;
    const normY = r.y + (r.h - uniformSrcH) / 2;

    // Update the SVG <rect> so any frame border/cutout matches the uniform size
    r.el.setAttribute('x', normX.toFixed(2));
    r.el.setAttribute('y', normY.toFixed(2));
    r.el.setAttribute('width', uniformSrcW.toFixed(2));
    r.el.setAttribute('height', uniformSrcH.toFixed(2));

    return {
      x: Math.round(normX * scale),
      y: Math.round(normY * scale),
      w: Math.round(uniformSrcW * scale),
      h: Math.round(uniformSrcH * scale),
    };
  });

  // Rasterize the frame at the higher-resolution digital master size. The printer
  // module independently downsamples the finished canvas to its native 384px row.
  svg.setAttribute('width', FRAME_WIDTH);
  svg.setAttribute('height', height);
  const image = await rasterize(new XMLSerializer().serializeToString(svg), FRAME_WIDTH, height);

  return { style, shotCount, image, width: FRAME_WIDTH, height, slots };
}

/**
 * Build the final strip.
 * ORDER MATTERS: the SVG has an opaque white paper, so it is drawn FIRST
 * and each 1-bit photo is drawn ON TOP at its slot position.
 */
export function composeStrip(frame, shots) {
  const canvas = document.createElement('canvas');
  canvas.width = frame.width;
  canvas.height = frame.height;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(frame.image, 0, 0); // 1) frame artwork first

  ctx.imageSmoothingEnabled = false; // keep pixels crisp and 1-bit
  frame.slots.forEach((slot, i) => {
    if (shots[i]) ctx.drawImage(shots[i], slot.x, slot.y, slot.w, slot.h); // 2) photos on top
  });
  return canvas;
}

// ---------- helpers ----------

/** Write today's date/time into #date, #header-2 and #serial. */
function injectDateTime(doc) {
  const now = new Date();
  const hours12 = now.getHours() % 12 || 12;
  const ampm = now.getHours() < 12 ? 'AM' : 'PM';

  const date = `${MONTHS[now.getMonth()]} ${now.getDate()} ’${pad(now.getFullYear() % 100)}`;
  const time = `${pad(hours12)}:${pad(now.getMinutes())}${ampm}`;
  const serial = `NO. ${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;

  setText(doc, '#date', date);
  setText(doc, '#header-2', `DATE: ${date}   TIME: ${time}`);
  setText(doc, '#serial', serial);
}

/** Replace an element's text; keep multiple spaces visible. Skips missing ids. */
function setText(doc, selector, text) {
  const el = doc.querySelector(selector);
  if (!el) return;
  el.textContent = text;
  el.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve');
  el.style.whiteSpace = 'pre';
}

/** SVG markup string -> canvas of w x h pixels. */
function rasterize(svgString, w, h) {
  return new Promise((resolve, reject) => {
    const blobUrl = URL.createObjectURL(new Blob([svgString], { type: `image/svg+xml;charset=utf-8` }));
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(blobUrl);
      resolve(canvas);
    };
    img.onerror = () => {
      URL.revokeObjectURL(blobUrl);
      reject(new Error('Could not rasterize the SVG frame.'));
    };
    img.src = blobUrl;
  });
}
