# Pocket Booth v2: PRD

## Goal
A camera-first photobooth web app. Take 1, 2 or 3 photos, get a styled photo strip in a chosen frame, then save, share or print it on a Paperang P1.

## Users & environment
- Beginner-built, local-first. Runs from VS Code Live Server at `http://127.0.0.1:5500` (counts as a secure context, so camera + Web Bluetooth work).
- Web Bluetooth needs Chrome / Edge / Android Chrome. Safari and iOS cannot print; the app must still work for Save and Share.

## In scope

| Area | Requirement |
|---|---|
| Stack | Zero-build HTML5 + CSS3 + Vanilla JS (ES modules). No npm, no bundler. |
| Home | Camera viewfinder is the homepage (`100dvh`), warm studio backdrop (`#f5f3ee`), centered bold ALL CAPS `POCKET BOOTH` title, no landing screen. |
| Progress | Segmented horizontal progress bar (`#shot-progress`) directly underneath the camera preview during multi-shot capture. |
| Bluetooth | Pinned top-right pill (`#bt-pill`): Paperang P1 status (idle / connecting / connected / error / unsupported). Tap to connect or disconnect. |
| Drawer | Hidable. Bottom sheet below 768px, floating side panel from 768px up. |
| Frame Style | `newsprint`, `receipt`, `film`, loaded from `assets/frames/{style}-{shots}.svg` (9 owned files). |
| Filter | `'bw'` (Black & White), `'sepia'` (Sepia), `'normal'` (Normal) with auto-contrast + unsharp-mask edge sharpening. |
| Shots | `1`, `2` or `3` photos per strip. |
| Result | Stepped thermal print-out animation reveals a crisp 384px-wide digital preview of the strip. |
| Auto-print | Only when the printer is connected. Otherwise the preview is shown and Print stays manual. |
| Buttons | `Save` (384px strip PNG), `Share` (1080x1920, 9:16 PNG), `Print`, `Retake`. |

## Strict exclusions (do not build)
- Halftone branding or name
- Landing / start screen
- Order counters or any API / backend
- PIN lock
- Print darkness slider
- Custom receipt text inputs
- Unconditional auto-print
- Music or song features
- Generating new SVGs (the 9 frame files are supplied)

## Success criteria
1. Camera opens on page load with a single permission prompt.
2. Changing Frame, Filter or Shots takes effect on the next capture with no reload.
3. The composed strip is 384px wide and sharp so `printer.js` converts it cleanly to 1-bit for the Paperang P1.
4. Print-out animation finishes in about 2.4 seconds, and respects reduced-motion.
5. Every button works with the printer disconnected, except Print, which asks the user to connect.
