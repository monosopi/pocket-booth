# Pocket Booth v2: Architecture

## File tree
```text
index.html
styles.css
assets/frames/{newsprint,receipt,film}-{1,2,3}.svg   (owned, 384px wide)
js/main.js        entry point, wires everything
js/state.js       single shared state object
js/ui.js          all DOM reads/writes
js/camera.js      getUserMedia + frame capture
js/filters.js     Black & White ('bw'), Sepia ('sepia'), Normal ('normal') + sharpening
js/frames.js      load SVG frames, update live date/time, compose the strip
js/printer.js     Paperang P1 Web Bluetooth (384px / 48 bytes per row)
js/export.js      Save PNG and 1080x1920 Story Share
```
Rule: only `ui.js` touches the DOM. Only `main.js` calls across modules.

## Frame SVG contract
All 9 SVG frames have opaque white backgrounds (`<rect id="paper" fill="#fff"/>`) and photo boxes inside `<g id="photo-01"><rect x="..." y="..." width="..." height="..."/></g>` (`#photo-01`, `#photo-02`, `#photo-03`).
`frames.js` parses the SVG with `DOMParser`, updates `#date`, `#header-2`, and `#serial` with live local date/time, draws the rasterized SVG first, and draws each filtered photo on top of its slot coordinates.

## Types
```js
/** @typedef {'newsprint' | 'receipt' | 'film'} FrameStyle */
/** @typedef {'bw' | 'sepia' | 'normal'} FilterId */
/** @typedef {1 | 2 | 3} ShotCount */
/** @typedef {'live' | 'capturing' | 'result'} View */
/** @typedef {'idle' | 'connecting' | 'connected' | 'error' | 'unsupported'} BtStatus */
/** @typedef {{x:number, y:number, w:number, h:number}} Rect */
```

## DOM IDs (index.html)

| ID | Element | Purpose |
|---|---|---|
| `app` | div | Root. Holds `data-view` and print-out state classes |
| `topbar` | header | Centered bold ALL CAPS title + pinned top-right Bluetooth pill |
| `app-title` | h1 | "POCKET BOOTH" |
| `bt-pill` | button | Connect / disconnect Paperang P1 printer |
| `bt-pill-label` | span | Pill text |
| `camera-stage` | main | Framed camera viewfinder container |
| `camera-video` | video | Hidden raw video stream source |
| `preview-canvas` | canvas | Created by `ui.js`; renders live filtered preview |
| `camera-message` | p | Camera error / permission text |
| `countdown` | div | Big 3-2-1 number |
| `flash` | div | White flash overlay |
| `shot-progress` | div | Segmented progress bar (`.progress-seg`) below camera preview |
| `controls` | footer | Bottom control row |
| `shot-selector` | div | Radiogroup; buttons carry `data-shots="1|2|3"` |
| `shutter-btn` | button | Start capture sequence |
| `drawer-toggle` | button | Open / close style drawer |
| `drawer` | aside | Style panel (toggles `.is-open` and `inert`) |
| `drawer-close` | button | Close drawer |
| `drawer-backdrop` | div | Mobile dimmer, click closes |
| `frame-picker` | div | Radiogroup; buttons carry `data-frame-style` |
| `filter-picker` | div | Radiogroup; buttons carry `data-filter="bw|sepia|normal"` |
| `result` | section | Result overlay (toggles `inert` when hidden) |
| `printer-slot` | div | Recessed slot lip; clips the emerging paper |
| `receipt-paper` | div | Animated paper with zig-zag bottom edge |
| `strip-canvas` | canvas | Final strip (384px wide) |
| `btn-save` / `btn-share` / `btn-print` / `btn-retake` | button | Result actions |
| `toast` | div | Short status messages |

Selected options use `aria-checked="true"` on the radio buttons.

## CSS state classes and attributes

| Selector | Set on | Meaning |
|---|---|---|
| `[data-view="live"\|"capturing"\|"result"]` | `#app` | Current screen |
| `.bt-idle` `.bt-connecting` `.bt-connected` `.bt-error` `.bt-unsupported` | `#bt-pill` | Printer status |
| `.is-open` (`inert = false`) | `#drawer`, `#drawer-backdrop` | Drawer visible and interactive |
| `.is-on` | `#flash` | Plays flash overlay |
| `.is-visible` | `#countdown`, `#toast` | Shows countdown pop or toast |
| `.is-active` / `.is-done` | `.progress-seg` | Highlights current/completed shots in `#shot-progress` |
| `.is-printing-out` | `#app` | Stepped thermal paper feed animation running |
| `.is-printed` | `#app` | Animation finished, paper at rest, action buttons shown |

## js/state.js
```js
export const state = {
  frameStyle: 'newsprint',   // FrameStyle
  filter: 'bw',              // FilterId ('bw' | 'sepia' | 'normal')
  shotCount: 3,              // ShotCount
  view: 'live',              // View
  btStatus: 'idle',          // BtStatus
  btDeviceName: null,        // string | null
  shots: [],                 // HTMLCanvasElement[]
  strip: null,               // HTMLCanvasElement | null (composed result)
};
export function setState(patch) {}
export function subscribe(listener) {}
```

## js/camera.js
```js
export async function startCamera(videoEl) {}
export function stopCamera() {}
export function captureFrame(videoEl, targetWidth, targetHeight) {} // -> HTMLCanvasElement (mirrored + center-cropped)
```

## js/filters.js
```js
/** Applies S-curve contrast, 3x3 unsharp mask, and 'bw' | 'sepia' | 'normal' tone in place. */
export function applyFilter(canvas, filterId = 'bw') {} // -> HTMLCanvasElement
```

## js/frames.js
```js
export async function loadFrame(style, shotCount) {} // -> { svgText, image, width, height, slots }
export function composeStrip(frame, shots) {}       // -> HTMLCanvasElement (384px wide)
```

## js/printer.js
```js
export function isSupported() {}
export async function connect() {}
export function disconnect() {}
export function isConnected() {}
export async function printCanvas(canvas) {}        // converts to 1-bit rows & prints on Paperang P1
export function onStatusChange(cb) {}
```

## js/export.js
```js
export async function saveStrip(stripCanvas) {}     // 384px PNG download
export async function shareStrip(stripCanvas) {}    // 1080x1920 9:16 PNG via navigator.share or download fallback
```

## js/ui.js
```js
export function initUI(handlers) {}                 // handlers: {onFrame,onFilter,onShots,onShutter,onBtClick,onSave,onShare,onPrint,onRetake}
export function render(state) {}                    // updates data-view, aria-checked, btPill, and result.inert
export const getVideoEl = () => els.cameraVideo;
export function setCameraMessage(text) {}
export function setShotProgress(current, total) {}  // renders .progress-seg bars; total = 0 hides
export function showToast(msg) {}
export function setPreviewAspect(ratio) {}
export function startPreview() {}
export function stopPreview() {}
export async function runCountdown(seconds = 3) {}
export function flash() {}
export function playPrintOut(stripCanvas) {}        // -> Promise<void>
export function resetPrintOut() {}
```

## js/main.js
```js
async function init() {}                            // wires ui.initUI, subscribes to printer status, loads frame & starts live camera
async function runCaptureSequence() {}              // loops shotCount: progress -> countdown -> flash -> capture + applyFilter -> composeStrip -> playPrintOut -> maybeAutoPrint
async function maybeAutoPrint() {}                  // prints automatically only if printer.isConnected() === true
async function handlePrint() {}                     // connects Paperang P1 if disconnected, then prints
async function handleBluetoothClick() {}            // toggles printer connect/disconnect
async function handleSave() {}
async function handleShare() {}
async function handleRetake() {}
```
