// src/lib/shareCard.js
//
// Client-side renderer for the "match result" PNG share card. Produces a
// 1200×630 image (standard OpenGraph aspect) via HTMLCanvasElement so
// players can share a richer artifact than the existing text string.
//
// The card is rendered entirely from drawing primitives - no asset
// preloads, no remote fonts. Using the user's platform font keeps the
// output consistent with what they see in the app while avoiding the
// flash of missing text that async font loading can cause.
//
// Integration contract:
//   renderShareCard(data) → Promise<Blob | null>
//
// Returns null (not throws) if rendering fails or canvas is unavailable
// (e.g. very old WebView). Callers fall back to the existing text-share.
//
// `data` shape (all optional except p1/p2 names + scores):
//   {
//     p1Name, p1Score, p1Color,     // p1Color: "#34d399" primary
//     p2Name, p2Score, p2Color,
//     winner:        'p1' | 'p2' | 'draw',
//     winMethodLabel:'PINNED' | 'TECHNICAL FALL' | 'DECISION' | 'DRAW' | ...
//     wrestlingStyle:'folkstyle' | 'freestyle' | 'greco',
//     tournamentRound: 'Quarterfinals' | null,
//   }

const WIDTH = 1200;
const HEIGHT = 630;

function _hasCanvas() {
  return typeof document !== 'undefined' && typeof document.createElement === 'function';
}

function _safe(str, fallback = '') {
  if (typeof str !== 'string') return fallback;
  return str.trim() || fallback;
}

function _clampName(ctx, name, maxWidth) {
  // Truncate with an ellipsis if the name would overrun its column. Keeps
  // the card readable for players with long handles.
  if (ctx.measureText(name).width <= maxWidth) return name;
  const ellipsis = '…';
  let lo = 0;
  let hi = name.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ctx.measureText(name.slice(0, mid) + ellipsis).width <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return name.slice(0, lo) + ellipsis;
}

function _drawBackground(ctx) {
  // Deep zinc gradient to match the in-app dark aesthetic.
  const bg = ctx.createLinearGradient(0, 0, 0, HEIGHT);
  bg.addColorStop(0, '#18181b');
  bg.addColorStop(1, '#09090b');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // Soft amber glow bleeding from the top - enough to feel branded
  // without stealing focus from the score.
  const glow = ctx.createRadialGradient(WIDTH / 2, -80, 80, WIDTH / 2, -80, 900);
  glow.addColorStop(0, 'rgba(245, 158, 11, 0.35)');
  glow.addColorStop(1, 'rgba(245, 158, 11, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // Thin amber border for definition.
  ctx.strokeStyle = 'rgba(245, 158, 11, 0.55)';
  ctx.lineWidth = 4;
  ctx.strokeRect(12, 12, WIDTH - 24, HEIGHT - 24);
}

function _drawHeader(ctx, winMethodLabel, tournamentRound) {
  ctx.save();
  ctx.textBaseline = 'top';

  // "MATGRIND" wordmark - amber accent over light stroke for contrast.
  ctx.fillStyle = '#fbbf24';
  ctx.font = '900 40px system-ui, -apple-system, "Segoe UI", sans-serif';
  ctx.fillText('MATGRIND', 56, 48);

  // Sub-line: match method / round chip
  const chipParts = [];
  if (_safe(winMethodLabel)) chipParts.push(winMethodLabel.toUpperCase());
  if (_safe(tournamentRound)) chipParts.push(tournamentRound.toUpperCase());
  const chipText = chipParts.join(' • ');
  if (chipText) {
    ctx.fillStyle = '#a1a1aa';
    ctx.font = '700 22px system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.fillText(chipText, 56, 100);
  }
  ctx.restore();
}

function _drawWrestlerColumn(ctx, x, name, score, color, isWinner) {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';

  // Color swatch - pill indicating the singlet color.
  ctx.fillStyle = color || '#71717a';
  const swatchX = x - 50;
  const swatchY = 200;
  ctx.fillRect(swatchX, swatchY, 100, 12);

  // Name - clamp to 420px for readability.
  ctx.fillStyle = isWinner ? '#ffffff' : '#a1a1aa';
  ctx.font = `${isWinner ? 900 : 800} 36px system-ui, -apple-system, "Segoe UI", sans-serif`;
  const clamped = _clampName(ctx, _safe(name, 'Wrestler'), 420);
  ctx.fillText(clamped, x, swatchY + 32);

  // Score - massive, winner gets pure white; loser is dimmed so the eye
  // snaps to the decisive number.
  ctx.fillStyle = isWinner ? '#fbbf24' : '#52525b';
  ctx.font = '900 200px system-ui, -apple-system, "Segoe UI", sans-serif';
  ctx.fillText(String(score ?? 0), x, swatchY + 100);
  ctx.restore();
}

function _drawVersusDivider(ctx, winner) {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // Separator
  ctx.fillStyle = '#27272a';
  ctx.font = '900 140px system-ui, -apple-system, "Segoe UI", sans-serif';
  ctx.fillText('-', WIDTH / 2, 360);
  // Below: tiny verdict tag
  const tag = winner === 'draw' ? 'DRAW' : winner === 'p1' || winner === 'p2' ? 'FINAL' : 'FINAL';
  ctx.fillStyle = '#71717a';
  ctx.font = '800 24px system-ui, -apple-system, "Segoe UI", sans-serif';
  ctx.fillText(tag, WIDTH / 2, 490);
  ctx.restore();
}

function _drawFooter(ctx, style) {
  ctx.save();
  ctx.textBaseline = 'bottom';
  ctx.fillStyle = '#71717a';
  ctx.font = '700 22px system-ui, -apple-system, "Segoe UI", sans-serif';
  ctx.textAlign = 'left';
  const styleLabel = _safe(style, 'folkstyle');
  ctx.fillText(styleLabel.toUpperCase(), 56, HEIGHT - 40);
  ctx.textAlign = 'right';
  ctx.fillText('matgrind.com', WIDTH - 56, HEIGHT - 40);
  ctx.restore();
}

/**
 * Render the PNG share card for a completed match. Never throws.
 *
 * @returns {Promise<Blob|null>}
 */
export function renderShareCard(data = {}) {
  return new Promise((resolve) => {
    try {
      if (!_hasCanvas()) return resolve(null);
      const canvas = document.createElement('canvas');
      canvas.width = WIDTH;
      canvas.height = HEIGHT;
      const ctx = canvas.getContext('2d');
      if (!ctx) return resolve(null);

      const {
        p1Name, p1Score, p1Color,
        p2Name, p2Score, p2Color,
        winner, winMethodLabel, wrestlingStyle, tournamentRound,
      } = data;

      _drawBackground(ctx);
      _drawHeader(ctx, winMethodLabel, tournamentRound);
      _drawWrestlerColumn(ctx, WIDTH * 0.28, p1Name, p1Score, p1Color, winner === 'p1');
      _drawVersusDivider(ctx, winner);
      _drawWrestlerColumn(ctx, WIDTH * 0.72, p2Name, p2Score, p2Color, winner === 'p2');
      _drawFooter(ctx, wrestlingStyle);

      // Prefer toBlob - avoids an intermediate base64 string. If the
      // browser can't produce a blob (rare), resolve null so callers fall
      // back to text share.
      if (typeof canvas.toBlob === 'function') {
        canvas.toBlob((blob) => resolve(blob || null), 'image/png');
      } else {
        resolve(null);
      }
    } catch {
      resolve(null);
    }
  });
}

/**
 * Feature-detect Web Share API with file support. Separated so callers
 * can gate their render path without importing the renderer itself.
 *
 * @param {File} [sampleFile]
 * @returns {boolean}
 */
export function canShareFiles(sampleFile) {
  try {
    if (typeof navigator === 'undefined') return false;
    if (typeof navigator.share !== 'function') return false;
    if (typeof navigator.canShare !== 'function') return false;
    if (!sampleFile) return true; // API present - caller will re-check with real file
    return navigator.canShare({ files: [sampleFile] });
  } catch {
    return false;
  }
}
