// ─── Singlet Design System ────────────────────────────────────────────────────
// Shared constants + helpers for the front/back singlet template renderer.
// Everything tunable about the singlet visual lives here so other modules
// (SingletTemplate, SingletCreator, future test harnesses) stay symmetric.
//
// The PNG outline (`/singlet-template.png`) is a side-by-side front+back
// line-art template. We display the left half in the front view and the
// right half in the back view, both clipped to a binary mask derived from
// the same PNG via a one-time client-side flood-fill.

export const SINGLET_VIEWBOX = { width: 240, height: 360 };

// Image-positioning fixes derived from inspecting the actual template.png.
// The front singlet is centered slightly right of its half (off by +8.7
// viewBox units), the back is centered slightly left of its half. We shift
// the <image> placement so each silhouette renders centered in viewBox x=120.
export const TEMPLATE_IMAGE = {
  src: '/singlet-template.png',
  width: 480,
  height: 360,
  frontX: -9,
  backX: -227,
};

// Stripe paths: ONE definition shared by front + back. Anchored to the
// outer side of the silhouette; mask handles silhouette-edge clipping so
// front and back stay aligned without per-view tuning.
export const STRIPE_PATHS = {
  left: 'M -30,100 L 50,100 L 50,370 L -30,370 Z',
  right: 'M 190,100 L 270,100 L 270,370 L 190,370 Z',
};

// Text positions inside the chest panel (chest fill spans x=58..182 inside
// the side stripes). Vertical y values centered between the U-neck and
// the lower hem so text never collides with the strap area.
export const TEXT_POSITIONS = {
  front: {
    team:   { x: 120, y: 175, baseFS: 20, maxWidth: 110 },
    weight: { x: 120, y: 200, baseFS: 16, maxWidth: 110 },
  },
  back: {
    name:   { x: 120, y: 145, baseFS: 24, maxWidth: 110 },
    weight: { x: 120, y: 178, baseFS: 14, maxWidth: 110 },
  },
};

export const SINGLET_DEFAULTS = Object.freeze({
  chestColor:      '#0a1f44',
  sidesColor:      '#ffffff',
  textColor:       '#ffffff',
  teamText:        '',
  lastNameText:    '',
  weightClassText: '',
});

// 12 wrestling-relevant zone colors. Distinct from `COLOR_PRESETS` in
// wrestlerColors.js, which keeps preset/dark pairs for the legacy renderer.
// These are flat hex values used by the per-zone swatch rows.
export const SINGLET_COLORS = Object.freeze([
  { id: 'black',    hex: '#1a1a1a', label: 'Black' },
  { id: 'white',    hex: '#ffffff', label: 'White' },
  { id: 'silver',   hex: '#c0c0c0', label: 'Silver' },
  { id: 'navy',     hex: '#0a1f44', label: 'Navy' },
  { id: 'royal',    hex: '#1e3a8a', label: 'Royal' },
  { id: 'cardinal', hex: '#b91c1c', label: 'Cardinal' },
  { id: 'maroon',   hex: '#7c1d1d', label: 'Maroon' },
  { id: 'forest',   hex: '#14532d', label: 'Forest' },
  { id: 'kelly',    hex: '#16a34a', label: 'Kelly' },
  { id: 'gold',     hex: '#eab308', label: 'Gold' },
  { id: 'orange',   hex: '#ea580c', label: 'Orange' },
  { id: 'purple',   hex: '#6b21a8', label: 'Purple' },
]);

/**
 * Compute auto-scaled font size that keeps `text` within `maxWidth` viewBox
 * units, falling back to a minimum size of 8 so very long inputs stay
 * legible. baseFS is the natural font size for short text. charWidth is the
 * approximate viewBox-units width per glyph at baseFS for the Impact
 * fallback stack used on the canvas.
 */
export function autoFontSize(text, baseFS, maxWidth, charWidth = 12) {
  const len = (text || '').length || 1;
  const natural = len * charWidth;
  const fitFS = (baseFS * maxWidth) / natural;
  const fs = Math.min(baseFS, Math.max(8, fitFS));
  return Number(fs.toFixed(1));
}

/**
 * Pick a high-contrast text color for a given background hex. Used as the
 * default for the editor's text-color picker; user can override.
 */
export function readableTextColor(hex) {
  if (typeof hex !== 'string' || hex[0] !== '#') return '#ffffff';
  const c = hex.replace('#', '');
  if (c.length !== 6) return '#ffffff';
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  const luma = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luma > 0.6 ? '#1a1a1a' : '#ffffff';
}

/**
 * Build a `singlet` object from arbitrary partial input + defaults. Used
 * by both the editor's initial state and firestoreService's backfill of
 * legacy profiles.
 */
export function buildSinglet(partial = {}, fallbacks = {}) {
  const out = { ...SINGLET_DEFAULTS, ...fallbacks };
  for (const k of Object.keys(SINGLET_DEFAULTS)) {
    const v = partial?.[k];
    if (typeof v === 'string') out[k] = v;
  }
  return out;
}

// ─── Mask processor (one-time, module-cached) ────────────────────────────────
// Loads `template.png`, flood-fills bg (light-coloured pixels connected to
// any edge) into transparent black, sets the rest to opaque white, and
// returns a data URL suitable for use as an SVG <mask> source.
//
// The result is cached in a module-scoped Promise so multiple SingletTemplate
// instances share the work. Tournament bracket cards (many singlets on
// screen at once) hit the cache after the first render.

let maskUrlPromise = null;

export function loadSingletMaskUrl(src = TEMPLATE_IMAGE.src) {
  if (maskUrlPromise) return maskUrlPromise;
  maskUrlPromise = new Promise((resolve, reject) => {
    if (typeof Image === 'undefined' || typeof document === 'undefined') {
      reject(new Error('singletDesign.loadSingletMaskUrl requires a browser'));
      return;
    }
    const img = new Image();
    img.onload = () => {
      try {
        const w = img.naturalWidth;
        const h = img.naturalHeight;
        if (!w || !h) {
          reject(new Error('Template image has zero size'));
          return;
        }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('No 2D canvas context'));
          return;
        }
        ctx.drawImage(img, 0, 0);
        const imgData = ctx.getImageData(0, 0, w, h);
        const data = imgData.data;
        const isLight = (i) => data[i] > 220 && data[i + 1] > 220 && data[i + 2] > 220;
        const isBg = new Uint8Array(w * h);
        const queue = [];
        // Seed every border pixel that's light: bg is connected to the edge.
        for (let x = 0; x < w; x++) {
          queue.push(x);
          queue.push((h - 1) * w + x);
        }
        for (let y = 0; y < h; y++) {
          queue.push(y * w);
          queue.push(y * w + w - 1);
        }
        let head = 0;
        while (head < queue.length) {
          const idx = queue[head++];
          if (isBg[idx]) continue;
          if (!isLight(idx * 4)) continue;
          isBg[idx] = 1;
          const x = idx % w;
          const y = (idx - x) / w;
          if (x > 0)     queue.push(idx - 1);
          if (x < w - 1) queue.push(idx + 1);
          if (y > 0)     queue.push(idx - w);
          if (y < h - 1) queue.push(idx + w);
        }
        for (let i = 0; i < w * h; i++) {
          const k = i * 4;
          if (isBg[i]) {
            data[k] = data[k + 1] = data[k + 2] = 0;
          } else {
            data[k] = data[k + 1] = data[k + 2] = 255;
          }
          data[k + 3] = 255;
        }
        ctx.putImageData(imgData, 0, 0);
        resolve(canvas.toDataURL('image/png'));
      } catch (err) {
        reject(err);
      }
    };
    img.onerror = () => reject(new Error(`Failed to load template image at ${src}`));
    img.src = src;
  });
  return maskUrlPromise;
}

/**
 * Test-only: clear the cached mask URL so a fresh load runs on next call.
 */
export function _resetMaskCache() {
  maskUrlPromise = null;
}
