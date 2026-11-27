/**
 * ui.js — the ONLY module that touches the DOM.
 * main.js passes in handler functions; this file wires them to buttons.
 */
import { state, subscribe } from './state.js';
import { captureFrame } from './camera.js';
import { applyFilter } from './filters.js';

const IDS = [
  'app', 'topbar', 'camera-stage', 'camera-video', 'camera-message', 'countdown', 'flash',
  'result-scroll', 'result-actions', 'controls',
  'bt-pill', 'bt-pill-label', 'shot-progress', 'shutter-btn',
  'drawer-toggle', 'drawer', 'drawer-close', 'drawer-backdrop',
  'frame-picker', 'filter-picker', 'shot-selector',
  'printer-slot', 'receipt-paper', 'strip-canvas',
  'btn-save', 'btn-share', 'btn-print', 'btn-retake', 'toast', 'result',
];
const BT_LABELS = {
  idle: 'Printer', connecting: 'Connecting…', connected: null, // null = show device name
  error: 'Retry printer', unsupported: 'No Bluetooth',
};
const PREVIEW_W = 480;      // lightweight live preview; still captures use the higher-res slot dimensions
const PREVIEW_FRAME_MS = 66; // ~15 fps keeps dithering cheap

let els = {};
let preview = null;         // live filtered <canvas> we create ourselves
let previewAspect = 4 / 3;
let rafId = 0;
let lastDraw = 0;
let toastTimer = 0;
let themeToggle = null;
let themeIcon = null;
let themeLabel = null;
let stripViewerEl = null;
let stripViewerReturnFocus = null;
let viewerBodyOverflow = '';
let paperLayoutFrame = 0;
const THEME_STORAGE_KEY = 'pocket-booth-theme';

/** Look up elements, build the preview canvas, and attach all listeners. */
export function initUI(h) {
  IDS.forEach((id) => { els[id.replace(/-(\w)/g, (_, c) => c.toUpperCase())] = document.getElementById(id); });

  // Live preview canvas framed cleanly inside #camera-stage (matches the photo crop).
  els.cameraVideo.style.display = 'none';
  preview = document.createElement('canvas');
  preview.id = 'preview-canvas';
  els.cameraStage.insertBefore(preview, els.cameraVideo.nextSibling);

  // Build UI-only wrappers/controls without changing index.html or module boundaries.
  wrapReceiptPaper();
  ensurePrinterIndicator();
  createDrawerControls(h);
  wrapLiveComposition();
  makeReceiptInteractive();
  applyTheme(readSavedTheme());
  window.addEventListener('resize', scheduleReceiptLayout, { passive: true });

  // Pickers (event delegation: one listener per group).
  radioGroup(els.framePicker, 'data-frame-style', h.onFrame);
  radioGroup(els.filterPicker, 'data-filter', h.onFilter);
  radioGroup(els.shotSelector, 'data-shots', (v) => h.onShots(Number(v)));

  // Buttons.
  els.shutterBtn.addEventListener('click', h.onShutter);
  els.btPill.addEventListener('click', h.onBtClick);
  els.btnSave.addEventListener('click', h.onSave);
  els.btnShare.addEventListener('click', h.onShare);
  els.btnPrint.addEventListener('click', h.onPrint);
  els.btnRetake.addEventListener('click', h.onRetake);

  // Drawer.
  els.drawerToggle.addEventListener('click', () => setDrawer(!els.drawer.classList.contains('is-open')));
  els.drawerClose.addEventListener('click', () => setDrawer(false));
  els.drawerBackdrop.addEventListener('click', () => setDrawer(false));
  document.addEventListener('keydown', (e) => {
    if (stripViewerEl && e.key === 'Escape') {
      e.preventDefault();
      closeStripViewer();
      return;
    }
    if (stripViewerEl && e.key === 'Tab') {
      const focusable = [...stripViewerEl.querySelectorAll('button:not([disabled])')];
      if (focusable.length) {
        const current = focusable.indexOf(document.activeElement);
        const next = e.shiftKey
          ? (current <= 0 ? focusable.length - 1 : current - 1)
          : (current < 0 || current === focusable.length - 1 ? 0 : current + 1);
        e.preventDefault();
        focusable[next].focus();
      }
      return;
    }
    if (e.key === 'Escape') setDrawer(false);
  });
  document.addEventListener('click', (e) => {
    if (!els.drawer.classList.contains('is-open')) return;
    if (!els.drawer.contains(e.target) && !els.drawerToggle.contains(e.target)) {
      setDrawer(false);
    }
  });

  subscribe(render);
  render(state);
}

function createDrawerControls(h) {
  // Give the drawer a scrollable content area and a pinned utility footer.
  const content = document.createElement('div');
  content.className = 'drawer-content';
  while (els.drawer.firstElementChild) content.appendChild(els.drawer.firstElementChild);
  els.drawer.appendChild(content);

  // Move the existing 1/2/3 selector into Style settings; keep its ID and handlers.
  const shotSection = document.createElement('section');
  shotSection.className = 'drawer-section drawer-shot-section';
  const shotHeading = document.createElement('h3');
  shotHeading.textContent = 'Photos per strip';
  shotSection.append(shotHeading, els.shotSelector);
  const drawerHead = content.querySelector('.drawer-head');
  drawerHead.insertAdjacentElement('afterend', shotSection);

  // Appearance and printer controls live in the two bottom corners of the drawer.
  const utilities = document.createElement('div');
  utilities.id = 'drawer-utility-controls';
  utilities.setAttribute('role', 'group');
  utilities.setAttribute('aria-label', 'Appearance and printer settings');

  themeToggle = document.createElement('button');
  themeToggle.id = 'theme-toggle';
  themeToggle.type = 'button';
  themeToggle.className = 'drawer-utility-btn theme-toggle';
  themeToggle.setAttribute('aria-pressed', 'false');
  themeIcon = document.createElement('span');
  themeIcon.className = 'theme-toggle-icon';
  themeIcon.setAttribute('aria-hidden', 'true');
  themeLabel = document.createElement('span');
  themeLabel.className = 'theme-toggle-label';
  themeToggle.append(themeIcon, themeLabel);
  themeToggle.addEventListener('click', () => {
    const next = els.app.dataset.theme === 'dark' ? 'light' : 'dark';
    applyTheme(next, true);
  });

  els.btPill.classList.add('drawer-utility-btn');
  utilities.append(themeToggle, els.btPill);
  els.drawer.appendChild(utilities);

  // The homepage has only Flip Camera, Shutter, and Style controls.
  const flipButton = document.createElement('button');
  flipButton.id = 'flip-camera-btn';
  flipButton.type = 'button';
  flipButton.className = 'flip-camera-btn home-icon-button';
  flipButton.setAttribute('aria-label', 'Switch between front and rear cameras');
  flipButton.title = 'Flip camera';
  flipButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M16 3l4 4-4 4"/><path d="M20 7H9a5 5 0 0 0-5 5"/><path d="M8 21l-4-4 4-4"/><path d="M4 17h11a5 5 0 0 0 5-5"/></svg>';
  flipButton.addEventListener('click', () => {
    if (typeof h.onFlipCamera === 'function') h.onFlipCamera();
  });
  els.flipCameraBtn = flipButton;
  els.controls.insertBefore(flipButton, els.shutterBtn);

  // Match Style to Flip Camera: both are icon-only, equally sized keycaps.
  els.drawerToggle.classList.add('home-icon-button', 'style-icon-button');
  els.drawerToggle.setAttribute('aria-label', 'Open style settings');
  els.drawerToggle.title = 'Style settings';
  els.drawerToggle.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/></svg>';
}

function wrapLiveComposition() {
  if (document.getElementById('live-layout')) return;

  const layout = document.createElement('div');
  layout.id = 'live-layout';
  layout.setAttribute('aria-label', 'Camera and capture controls');

  const cameraGroup = document.createElement('div');
  cameraGroup.className = 'camera-group';

  // Keep the camera/progress group together with the three-button capture deck.
  els.topbar.insertAdjacentElement('afterend', layout);
  cameraGroup.append(els.cameraStage, els.shotProgress);
  layout.append(cameraGroup, els.controls);
}


function ensurePrinterIndicator() {
  // The bridge visually joins the two fixed slot lips. It is inserted behind
  // the paper window so the moving receipt remains unobstructed.
  if (!els.printerSlot.querySelector('.printer-slot-bridge')) {
    const bridge = document.createElement('span');
    bridge.className = 'printer-slot-bridge';
    bridge.setAttribute('aria-hidden', 'true');
    const paperWindow = els.printerSlot.querySelector('.paper-window');
    els.printerSlot.insertBefore(bridge, paperWindow || null);
  }

  if (!els.printerSlot.querySelector('.printer-indicator')) {
    const indicator = document.createElement('span');
    indicator.className = 'printer-indicator';
    indicator.setAttribute('aria-hidden', 'true');
    els.printerSlot.appendChild(indicator);
  }
}

function wrapReceiptPaper() {
  if (els.receiptPaper.parentElement?.classList.contains('paper-window')) return;
  const windowEl = document.createElement('div');
  windowEl.className = 'paper-window';
  els.printerSlot.insertBefore(windowEl, els.receiptPaper);
  windowEl.appendChild(els.receiptPaper);
}

function makeReceiptInteractive() {
  // The finished receipt acts as a keyboard-accessible button to open the viewer.
  els.receiptPaper.tabIndex = -1;
  els.receiptPaper.setAttribute('role', 'button');
  els.receiptPaper.setAttribute('aria-label', 'View the finished photo strip full screen');
  els.receiptPaper.setAttribute('aria-haspopup', 'dialog');
  els.receiptPaper.setAttribute('aria-controls', 'strip-viewer');
  els.receiptPaper.setAttribute('aria-expanded', 'false');
  els.receiptPaper.setAttribute('aria-disabled', 'true');
  // Delegate from the printer so clicks on the canvas or paper both open the viewer.
  // The paper window clips the strip, so the click target must remain the paper itself.
  els.printerSlot.addEventListener('click', (event) => {
    if (els.receiptPaper.contains(event.target)) openStripViewer();
  });
  els.receiptPaper.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    openStripViewer();
  });
}

function openStripViewer() {
  if (stripViewerEl || !els.app.classList.contains('is-printed') || !els.stripCanvas.width || !els.stripCanvas.height) return;

  const overlay = document.createElement('div');
  overlay.id = 'strip-viewer';
  overlay.className = 'strip-viewer';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Full-screen photo strip');

  const closeButton = document.createElement('button');
  closeButton.className = 'strip-viewer-close';
  closeButton.type = 'button';
  closeButton.setAttribute('aria-label', 'Close full-screen photo strip');
  closeButton.textContent = '×';

  const viewport = document.createElement('div');
  viewport.className = 'strip-viewer-viewport';
  viewport.setAttribute('aria-label', 'Pinch, double-tap, or use the mouse wheel to zoom');

  const paper = document.createElement('div');
  paper.className = 'strip-viewer-paper';

  const image = document.createElement('canvas');
  image.className = 'strip-viewer-canvas';
  image.setAttribute('role', 'img');
  image.setAttribute('aria-label', 'Full-size photo strip');
  image.width = els.stripCanvas.width;
  image.height = els.stripCanvas.height;
  image.getContext('2d').drawImage(els.stripCanvas, 0, 0);
  paper.appendChild(image);
  viewport.appendChild(paper);

  overlay.dataset.theme = els.app.dataset.theme || 'light';
  overlay.append(closeButton, viewport);

  closeButton.addEventListener('click', () => closeStripViewer());
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) closeStripViewer();
  });

  setupViewerZoom(viewport, paper);
  stripViewerReturnFocus = els.receiptPaper;
  stripViewerEl = overlay;
  els.receiptPaper.setAttribute('aria-expanded', 'true');
  viewerBodyOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
  document.body.appendChild(overlay);
  closeButton.focus();
}

function setupViewerZoom(viewport, paper) {
  let scale = 1;
  let panX = 0;
  let panY = 0;
  let lastTap = 0;
  let moved = false;
  const pointers = new Map();
  let pinchStartDistance = 0;
  let pinchStartScale = 1;
  let dragStart = null;

  const applyTransform = (animate = true) => {
    paper.classList.toggle('is-zoomed', scale > 1.01);
    paper.style.transition = animate ? 'transform 220ms cubic-bezier(.2,.75,.25,1)' : 'none';
    paper.style.transform = `translate3d(${panX}px, ${panY}px, 0) scale(${scale})`;
  };
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const clampPan = () => {
    const bounds = viewport.getBoundingClientRect();
    const paperBounds = paper.getBoundingClientRect();
    const maxX = Math.max(0, (paperBounds.width - bounds.width) / 2 + 36);
    const maxY = Math.max(0, (paperBounds.height - bounds.height) / 2 + 36);
    panX = Math.max(-maxX, Math.min(maxX, panX));
    panY = Math.max(-maxY, Math.min(maxY, panY));
  };
  const toggleZoom = () => {
    if (scale > 1.01) { scale = 1; panX = 0; panY = 0; }
    else scale = 2.15;
    clampPan();
    applyTransform(true);
  };

  viewport.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    viewport.setPointerCapture?.(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY, type: event.pointerType });
    moved = false;
    if (pointers.size === 2) {
      const pts = [...pointers.values()];
      pinchStartDistance = distance(pts[0], pts[1]);
      pinchStartScale = scale;
    } else {
      dragStart = { x: event.clientX, y: event.clientY, panX, panY, time: performance.now() };
    }
  });

  viewport.addEventListener('pointermove', (event) => {
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY, type: event.pointerType });
    if (dragStart && Math.hypot(event.clientX - dragStart.x, event.clientY - dragStart.y) > 8) moved = true;
    if (pointers.size >= 2) {
      const pts = [...pointers.values()];
      const currentDistance = distance(pts[0], pts[1]);
      if (pinchStartDistance > 0) {
        scale = Math.max(1, Math.min(4, pinchStartScale * currentDistance / pinchStartDistance));
        if (scale === 1) { panX = 0; panY = 0; }
        moved = true;
        applyTransform(false);
      }
      return;
    }
    if (scale > 1.01 && dragStart) {
      panX = dragStart.panX + event.clientX - dragStart.x;
      panY = dragStart.panY + event.clientY - dragStart.y;
      moved = true;
      clampPan();
      applyTransform(false);
    }
  });

  const releasePointer = (event) => {
    const point = pointers.get(event.pointerId);
    pointers.delete(event.pointerId);
    if (pointers.size < 2) pinchStartDistance = 0;
    if (point && point.type !== 'mouse' && !moved && dragStart && performance.now() - dragStart.time < 260) {
      const now = performance.now();
      if (now - lastTap < 320) {
        toggleZoom();
        lastTap = 0;
      } else {
        lastTap = now;
      }
    }
    if (pointers.size === 0) dragStart = null;
    if (scale <= 1.01) { scale = 1; panX = 0; panY = 0; applyTransform(true); }
  };
  viewport.addEventListener('pointerup', releasePointer);
  viewport.addEventListener('pointercancel', releasePointer);
  viewport.addEventListener('click', (event) => {
    if (event.target === viewport && scale <= 1.01) closeStripViewer();
  });
  viewport.addEventListener('dblclick', (event) => { event.preventDefault(); toggleZoom(); });
  viewport.addEventListener('wheel', (event) => {
    event.preventDefault();
    scale = Math.max(1, Math.min(4, scale * (event.deltaY < 0 ? 1.16 : 1 / 1.16)));
    if (scale === 1) { panX = 0; panY = 0; }
    clampPan();
    applyTransform(true);
  }, { passive: false });
}

function closeStripViewer(restoreFocus = true) {
  if (!stripViewerEl) return;
  stripViewerEl.remove();
  stripViewerEl = null;
  document.body.style.overflow = viewerBodyOverflow;
  els.receiptPaper.setAttribute('aria-expanded', 'false');

  const focusTarget = stripViewerReturnFocus;
  stripViewerReturnFocus = null;
  if (restoreFocus && focusTarget?.isConnected && typeof focusTarget.focus === 'function') {
    focusTarget.focus();
  }
}

function syncReceiptLayout() {
  if (!els.printerSlot || !els.stripCanvas?.width || !els.stripCanvas?.height) return;

  const slotWidth = els.printerSlot.getBoundingClientRect().width || Math.min(420, window.innerWidth - 32);
  const headerHeight = Math.max(58, els.topbar?.getBoundingClientRect().height || 64);
  const actionsHeight = els.resultActions?.getBoundingClientRect().height || (window.innerWidth < 768 ? 132 : 78);

  // Reserve space for the fixed wordmark and the always-accessible action deck.
  // The three-photo format defines the standard physical paper width; shorter
  // 1- and 2-photo strips keep that same width and simply have less height.
  const topReserve = Math.max(66, headerHeight + 8);
  const bottomReserve = actionsHeight + 10;
  const availableAssemblyHeight = Math.max(220, window.innerHeight - topReserve - bottomReserve);
  // The printer fascia and outlet stay at fixed coordinates for every shot count.
  // Only the paper canvas height changes; the feed window remains anchored to the slot.
  const compactViewport = window.innerWidth <= 600;
  const headHeight = compactViewport ? 58 : 64;
  const slotTop = compactViewport ? 40 : 45;
  const finalOffset = compactViewport ? 10 : 12;
  const maxPaperHeight = Math.max(150, availableAssemblyHeight - headHeight - slotTop - 10);
  const stripAspect = els.stripCanvas.height / els.stripCanvas.width;

  // Use a fixed reference aspect for the three-photo master. This keeps the
  // physical paper width identical for 1, 2, and 3 photos; shorter strips only
  // use less of the fixed feed window.
  const standardThreePhotoAspect = 3.0;
  const paperWidth = Math.min(278, slotWidth * 0.84, maxPaperHeight / standardThreePhotoAspect);
  // Keep the printer/feed assembly height constant for every shot count.
  // The window is sized for the three-photo format, while the actual receipt
  // canvas retains its natural height and rests at the same outlet position.
  const windowHeight = maxPaperHeight + finalOffset + 2;

  els.printerSlot.style.setProperty('--printer-head-height', `${headHeight}px`);
  els.printerSlot.style.setProperty('--paper-slot-top', `${slotTop}px`);
  els.printerSlot.style.setProperty('--paper-final-offset', `${finalOffset}px`);
  els.printerSlot.style.setProperty('--paper-render-width', `${paperWidth}px`);
  els.printerSlot.style.setProperty('--paper-window-height', `${windowHeight}px`);
  els.printerSlot.style.setProperty('--printer-total-height', `${slotTop + windowHeight + 12}px`);
}

function scheduleReceiptLayout() {
  cancelAnimationFrame(paperLayoutFrame);
  paperLayoutFrame = requestAnimationFrame(syncReceiptLayout);
}

function readSavedTheme() {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    return saved === 'dark' || saved === 'light' ? saved : 'light';
  } catch {
    return 'light';
  }
}

function applyTheme(theme, persist = false) {
  const normalized = theme === 'dark' ? 'dark' : 'light';
  const isDark = normalized === 'dark';
  els.app.dataset.theme = normalized;
  themeToggle.setAttribute('aria-pressed', String(isDark));
  themeToggle.setAttribute('aria-label', `Switch to ${isDark ? 'light' : 'dark'} mode`);
  themeToggle.title = `Switch to ${isDark ? 'light' : 'dark'} mode`;
  themeIcon.textContent = isDark ? '☾' : '☼';
  themeLabel.textContent = isDark ? 'DARK' : 'LIGHT';
  if (persist) {
    try { localStorage.setItem(THEME_STORAGE_KEY, normalized); } catch { /* storage can be unavailable in private contexts */ }
  }
}

function radioGroup(container, attr, callback) {
  container.addEventListener('click', (e) => {
    const btn = e.target.closest(`[${attr}]`);
    if (btn && container.contains(btn)) callback(btn.getAttribute(attr));
  });
}

function setDrawer(open) {
  els.drawer.classList.toggle('is-open', open);
  els.drawerBackdrop.classList.toggle('is-open', open);
  els.drawerToggle.setAttribute('aria-expanded', String(open));
  els.drawer.inert = !open;
}

/** Reflect state into the DOM. Runs on every setState(). */
export function render(s) {
  if (s.view !== 'result') closeStripViewer(false);
  els.app.dataset.view = s.view;
  els.result.inert = s.view !== 'result';
  mark(els.framePicker, 'data-frame-style', s.frameStyle);
  mark(els.filterPicker, 'data-filter', s.filter);
  mark(els.shotSelector, 'data-shots', String(s.shotCount));
  els.shutterBtn.disabled = s.view !== 'live';
  if (els.flipCameraBtn) els.flipCameraBtn.disabled = s.view !== 'live';

  const pill = els.btPill;
  pill.className = pill.className.replace(/\bbt-\w+/g, '').trim();
  pill.classList.add(`bt-${s.btStatus}`);
  els.btPillLabel.textContent = BT_LABELS[s.btStatus] ?? s.btDeviceName ?? 'Connected';
}

function mark(container, attr, value) {
  container.querySelectorAll(`[${attr}]`).forEach((b) => {
    b.setAttribute('aria-checked', String(b.getAttribute(attr) === value));
  });
}

// ---------- tiny getters / setters used by main.js ----------

export const getVideoEl = () => els.cameraVideo;

export function setCameraMessage(text) {
  els.cameraMessage.textContent = text || '';
  els.cameraMessage.hidden = !text;
}

/** Renders a segmented progress bar under the camera preview. Pass total = 0 to hide. */
export function setShotProgress(current, total) {
  const bar = els.shotProgress;
  if (!total) {
    bar.hidden = true;
    bar.innerHTML = '';
    return;
  }
  bar.hidden = false;
  bar.setAttribute('aria-valuemax', String(total));
  bar.setAttribute('aria-valuenow', String(current));
  bar.innerHTML = Array.from({ length: total }, (_, idx) => {
    const stateClass = idx + 1 < current ? 'is-done' : idx + 1 === current ? 'is-active' : '';
    return `<span class="progress-seg ${stateClass}"></span>`;
  }).join('');
}

export function showToast(msg) {
  els.toast.textContent = msg;
  els.toast.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove('is-visible'), 2600);
}

// ---------- live preview ----------

/** Match the preview crop to the photo slot so "what you see" = "what you get". */
export function setPreviewAspect(ratio) {
  previewAspect = ratio || 4 / 3;
  if (preview) preview.style.aspectRatio = String(previewAspect);
}

export function startPreview() {
  stopPreview();
  const loop = (t) => {
    rafId = requestAnimationFrame(loop);
    if (t - lastDraw < PREVIEW_FRAME_MS) return;
    lastDraw = t;
    drawPreview();
  };
  rafId = requestAnimationFrame(loop);
}

export function stopPreview() {
  cancelAnimationFrame(rafId);
}

function drawPreview() {
  const video = els.cameraVideo;
  if (!video.videoWidth) return; // camera not ready yet
  const w = PREVIEW_W;
  const h = Math.round(w / previewAspect);
  if (preview.width !== w || preview.height !== h) { preview.width = w; preview.height = h; }
  const frame = captureFrame(video, w, h); // mirrored + cropped, same as the real shot
  applyFilter(frame, state.filter);        // the 1-bit thermal look, live
  preview.getContext('2d').drawImage(frame, 0, 0);
}

// ---------- effects ----------

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Shows 3… 2… 1… in #countdown, one number per second. */
export async function runCountdown(seconds = 3) {
  for (let n = seconds; n >= 1; n--) {
    els.countdown.textContent = String(n);
    els.countdown.classList.remove('is-visible');
    void els.countdown.offsetWidth; // force reflow so the CSS animation restarts
    els.countdown.classList.add('is-visible');
    await wait(1000);
  }
  els.countdown.classList.remove('is-visible');
  els.countdown.textContent = '';
}

export function flash() {
  els.flash.classList.add('is-on');
  setTimeout(() => els.flash.classList.remove('is-on'), 180);
}

/** Draw the strip into #strip-canvas and play the "printing out" animation. */
export function playPrintOut(stripCanvas) {
  const target = els.stripCanvas;
  target.width = stripCanvas.width;
  target.height = stripCanvas.height;
  const context = target.getContext('2d');
  context.clearRect(0, 0, target.width, target.height);
  context.drawImage(stripCanvas, 0, 0);
  syncReceiptLayout();

  resetPrintOut();

  // Respect reduced motion without leaving the result screen waiting for a timer.
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    els.app.classList.add('is-printed');
    els.receiptPaper.tabIndex = 0;
    els.receiptPaper.setAttribute('aria-disabled', 'false');
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    let done = false;
    const fallbackTimer = setTimeout(finish, 3200);

    function finish(event) {
      if (event && event.target !== els.receiptPaper) return;
      if (done) return;
      done = true;
      clearTimeout(fallbackTimer);
      els.receiptPaper.removeEventListener('animationend', finish);
      els.app.classList.remove('is-printing-out');
      els.app.classList.add('is-printed');
      els.receiptPaper.tabIndex = 0;
      els.receiptPaper.setAttribute('aria-disabled', 'false');
      resolve();
    }

    // Listen on the animated paper itself, not the app's unrelated animations.
    els.receiptPaper.addEventListener('animationend', finish);
    els.app.classList.add('is-printing-out');
  });
}

/** Clear print-out classes (used by Retake). */
export function resetPrintOut() {
  closeStripViewer(false);
  els.app.classList.remove('is-printing-out', 'is-printed');
  els.receiptPaper.tabIndex = -1;
  els.receiptPaper.setAttribute('aria-disabled', 'true');
}
