/**
 * state.js — the single source of truth for Pocket Booth.
 * Other modules READ `state` and CHANGE it only through `setState()`.
 * UI code uses `subscribe()` to re-render whenever something changes.
 */

export const state = {
  frameStyle: 'newsprint',  // 'newsprint' | 'receipt' | 'film'
  filter: 'bw',             // 'bw' | 'sepia' | 'normal'
  shotCount: 3,             // 1 | 2 | 3
  view: 'live',             // 'live' | 'capturing' | 'result'
  btStatus: 'idle',         // 'idle' | 'connecting' | 'connected' | 'error' | 'unsupported'
  btDeviceName: null,       // e.g. "Paperang_P1" once connected
  shots: [],                // array of 1-bit <canvas> elements (one per photo)
  strip: null,              // the final composed <canvas>, or null
};

// A Set holds each listener function once, with no duplicates.
const listeners = new Set();

/**
 * Merge `patch` into state, then tell every listener.
 * Example: setState({ view: 'capturing' })
 * Listeners receive (state, patch) so they can react only to what changed.
 */
export function setState(patch) {
  Object.assign(state, patch);
  listeners.forEach((listener) => listener(state, patch));
}

/**
 * Register a function to run after every setState().
 * Returns an "unsubscribe" function you can call to stop listening.
 */
export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
