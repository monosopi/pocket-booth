/**
 * camera.js — webcam access and still-frame capture.
 * Knows nothing about filters, frames, or the UI.
 */

let stream = null;     // the active MediaStream (or null)
let activeVideo = null; // the <video> element we attached it to
let mirrored = true;   // front cameras are shown mirrored, like a mirror

/**
 * Ask permission, start the front camera, and play it in `videoEl`.
 * Throws if the browser has no camera API or the user says no
 * (main.js should catch this and show a message).
 */
export async function startCamera(videoEl, facingMode = 'user', requireFacingMode = false) {
  stopCamera(); // never leave two streams running

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error('Camera is not supported in this browser.');
  }

  const facingConstraint = requireFacingMode
    ? { exact: facingMode }
    : { ideal: facingMode };

  stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: facingConstraint, width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: false,
  });

  // Desktop webcams often report no facingMode, so we only un-mirror
  // when the browser explicitly says it's the back camera.
  const settings = stream.getVideoTracks()[0].getSettings();
  mirrored = settings.facingMode !== 'environment';

  videoEl.srcObject = stream;
  videoEl.muted = true;
  videoEl.setAttribute('playsinline', ''); // required for iOS Safari
  await videoEl.play();
  activeVideo = videoEl;
}

/** Turn the camera off (the little camera light goes out). */
export function stopCamera() {
  if (stream) stream.getTracks().forEach((track) => track.stop());
  if (activeVideo) activeVideo.srcObject = null;
  stream = null;
  activeVideo = null;
}

/** True when the preview should be flipped horizontally (front camera). */
export function isMirrored() {
  return mirrored;
}

/**
 * Snapshot the current video frame into a NEW canvas of targetW x targetH.
 * The image is center-cropped ("cover" style) so it matches the photo slot's
 * aspect ratio, and flipped horizontally if the camera is mirrored.
 */
export function captureFrame(videoEl, targetW, targetH) {
  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  const vw = videoEl.videoWidth;
  const vh = videoEl.videoHeight;
  if (!vw || !vh) return canvas; // video not ready: return a blank canvas

  // Scale so the video fully covers the target, then crop the overflow.
  const scale = Math.max(targetW / vw, targetH / vh);
  const sw = targetW / scale; // source width we keep
  const sh = targetH / scale; // source height we keep
  const sx = (vw - sw) / 2;   // centered crop
  const sy = (vh - sh) / 2;

  if (mirrored) {
    ctx.translate(targetW, 0); // move origin to the right edge...
    ctx.scale(-1, 1);          // ...then flip the x axis
  }
  ctx.drawImage(videoEl, sx, sy, sw, sh, 0, 0, targetW, targetH);
  return canvas;
}
