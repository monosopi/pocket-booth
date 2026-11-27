/**
 * main.js — the conductor. Connects the modules and runs the capture sequence.
 * Load it from index.html with: <script type="module" src="js/main.js"></script>
 */
import { state, setState } from './state.js';
import { startCamera, stopCamera, captureFrame } from './camera.js';
import { applyFilter } from './filters.js';
import { loadFrame, composeStrip } from './frames.js';
import * as printer from './printer.js';
import { saveStrip, shareStrip } from './export.js';
import * as ui from './ui.js';

const COUNTDOWN_SECONDS = 3;
const PAUSE_BETWEEN_SHOTS_MS = 600;

let frame = null;      // current loaded frame { image, slots, ... }
let frameToken = 0;    // guards against out-of-order frame loads
let busy = false;      // true while capturing
let printing = false;  // true while sending to the printer
let cameraFacingMode = 'user'; // front camera by default

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- start-up ----------

async function init() {
  ui.initUI({
    onFrame: (frameStyle) => changeSetting({ frameStyle }, true),
    onFilter: (filter) => changeSetting({ filter }, false), // preview reads state.filter live
    onShots: (shotCount) => changeSetting({ shotCount }, true),
    onShutter: runCaptureSequence,
    onFlipCamera: handleFlipCamera,
    onBtClick: handleBluetoothClick,
    onSave: handleSave,
    onShare: handleShare,
    onPrint: handlePrint,
    onRetake: handleRetake,
  });

  // Mirror the printer's status into shared state (the pill re-renders itself).
  printer.onStatusChange(({ status, deviceName }) => {
    setState({ btStatus: status, btDeviceName: deviceName });
  });

  ui.setPreviewAspect(4 / 3); // Lock viewfinder aspect ratio once on startup

  try { await refreshFrame(); } catch (err) { ui.showToast(`Frame error: ${err.message}`); }
  await startLive();
}

async function startLive() {
  ui.setCameraMessage('Starting camera…');
  try {
    await startCamera(ui.getVideoEl(), cameraFacingMode);
    ui.setCameraMessage('');
    ui.startPreview();
  } catch (err) {
    console.error(err);
    ui.setCameraMessage('Camera unavailable. Allow camera access, then reload.');
  }
}

/** Switch between front and rear cameras without changing the capture pipeline. */
async function handleFlipCamera() {
  if (busy || state.view !== 'live') return;

  const previousFacingMode = cameraFacingMode;
  const nextFacingMode = previousFacingMode === 'user' ? 'environment' : 'user';
  ui.stopPreview();
  stopCamera();

  try {
    cameraFacingMode = nextFacingMode;
    // Use an exact facing-mode request for an intentional front/rear switch.
    await startCamera(ui.getVideoEl(), cameraFacingMode, true);
    ui.setCameraMessage('');
    ui.startPreview();
    ui.showToast(cameraFacingMode === 'environment' ? 'Rear camera' : 'Front camera');
  } catch (err) {
    console.warn('Requested camera is unavailable; restoring the previous camera.', err);
    cameraFacingMode = previousFacingMode;
    try {
      await startCamera(ui.getVideoEl(), cameraFacingMode);
      ui.setCameraMessage('');
      ui.startPreview();
      ui.showToast('That camera is unavailable. Keeping the previous camera.');
    } catch (restoreError) {
      console.error(restoreError);
      ui.setCameraMessage('Camera unavailable. Check camera permissions, then reload.');
      ui.showToast('Could not restore the camera.');
    }
  }
}

/** (Re)load the SVG frame so the date/time stamp is fresh. */
async function refreshFrame() {
  const token = ++frameToken;
  const loaded = await loadFrame(state.frameStyle, state.shotCount);
  if (token !== frameToken) return frame; // a newer request won
  frame = loaded;
  return frame;
}

async function changeSetting(patch, needsFrame) {
  if (busy || state.view !== 'live') return;
  setState(patch);
  if (!needsFrame) return;
  try { await refreshFrame(); } catch (err) { ui.showToast(`Frame error: ${err.message}`); }
}

// ---------- capture sequence ----------

async function runCaptureSequence() {
  if (busy || state.view !== 'live') return;
  busy = true;
  try {
    await refreshFrame(); // fresh date/time on every strip
    const count = frame.slots.length;
    const shots = [];
    setState({ view: 'capturing', shots: [], strip: null });

    for (let i = 0; i < count; i++) {
      ui.setShotProgress(i + 1, count);
      await ui.runCountdown(COUNTDOWN_SECONDS);
      ui.flash();

      const slot = frame.slots[i];
      const shot = captureFrame(ui.getVideoEl(), slot.w, slot.h); // mirrored + cropped
      applyFilter(shot, state.filter);
      shots.push(shot);
      setState({ shots: [...shots] });

      if (i < count - 1) await wait(PAUSE_BETWEEN_SHOTS_MS);
    }

    ui.setShotProgress(0, 0);
    const strip = composeStrip(frame, shots);
    ui.stopPreview();
    stopCamera(); // turn the camera light off while viewing the result
    setState({ strip, view: 'result' });

    await ui.playPrintOut(strip);
    await maybeAutoPrint();
  } catch (err) {
    console.error(err);
    ui.setShotProgress(0, 0);
    ui.showToast(`Something went wrong: ${err.message}`);
    setState({ view: 'live', shots: [], strip: null });
  } finally {
    busy = false;
  }
}

// ---------- printing ----------

/** Auto-print ONLY if the printer is already connected. Never opens a Bluetooth picker. */
async function maybeAutoPrint() {
  if (printer.isConnected() === true) await printStrip();
}

async function printStrip() {
  if (!state.strip || printing) return;
  printing = true;
  try {
    ui.showToast('Printing…');
    await printer.printCanvas(state.strip);
    ui.showToast('Printed!');
  } catch (err) {
    console.error(err);
    ui.showToast(`Print failed: ${err.message}`);
  } finally {
    printing = false;
  }
}

/** Print button: connect first if needed, then print. */
async function handlePrint() {
  if (!state.strip) return;
  try {
    if (!printer.isConnected()) {
      const ok = await printer.connect();
      if (!ok) return; // user cancelled the picker
    }
    await printStrip();
  } catch (err) {
    console.error(err);
    ui.showToast(`Printer error: ${err.message}`);
  }
}

/** Tapping the Bluetooth pill toggles the connection. */
async function handleBluetoothClick() {
  try {
    if (printer.isConnected()) printer.disconnect();
    else await printer.connect();
  } catch (err) {
    console.error(err);
    ui.showToast(`Printer error: ${err.message}`);
  }
}

// ---------- save / share / retake ----------

async function handleSave() {
  if (!state.strip) return;
  try {
    await saveStrip(state.strip);
    ui.showToast('Saved!');
  } catch (err) {
    ui.showToast(`Save failed: ${err.message}`);
  }
}

async function handleShare() {
  if (!state.strip) return;
  try {
    const result = await shareStrip(state.strip);
    if (result === 'saved') ui.showToast('Sharing unavailable, saved instead');
  } catch (err) {
    ui.showToast(`Share failed: ${err.message}`);
  }
}

/** Retake keeps frameStyle, filter and shotCount; only photos/strip/view reset. */
async function handleRetake() {
  if (busy) return;
  ui.resetPrintOut();
  setState({ shots: [], strip: null, view: 'live' });
  try { await refreshFrame(); } catch (err) { ui.showToast(`Frame error: ${err.message}`); }
  await startLive();
}

init();
