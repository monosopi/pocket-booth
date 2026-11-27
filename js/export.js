/**
 * export.js — native photostrip saving plus a ready-to-share 9:16 Story image.
 * The Save action always writes the original strip dimensions. Share builds a
 * separate Story composition matching the active light/dark Paperang UI theme.
 */

const STORY_WIDTH = 1080;
const STORY_HEIGHT = 1920;

// TODO: Replace with your finalized deployed URL once ready.
const STORY_APP_LINK = 'pocketbooth.app';

const THEMES = {
  light: {
    paper: '#f7f6f2',
    paperBright: '#ffffff',
    ink: '#111111',
    inkSoft: '#4a4a47',
    dotPerf: '#a8a69f',
    shadow: 'rgba(17, 17, 17, 0.16)',
    stripMount: '#ffffff',
  },
  dark: {
    paper: '#161615',
    paperBright: '#222220',
    ink: '#f2f1ec',
    inkSoft: '#c9c8c1',
    dotPerf: '#52514c',
    shadow: 'rgba(0, 0, 0, 0.45)',
    stripMount: '#f7f6f2',
  },
};

function getActiveTheme() {
  const appEl = typeof document !== 'undefined' ? document.getElementById('app') : null;
  const themeKey = appEl?.dataset?.theme === 'dark' ? 'dark' : 'light';
  return THEMES[themeKey];
}

function toBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not create PNG.'))), 'image/png');
  });
}

function fileName(suffix = '') {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
  return `pocket-booth-${stamp}${suffix}.png`;
}

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function validateStrip(stripCanvas) {
  if (!(stripCanvas instanceof HTMLCanvasElement) || !stripCanvas.width || !stripCanvas.height) {
    throw new Error('The photostrip is empty or unavailable.');
  }
}

/** Download the exact photostrip canvas as a lossless PNG, without a background. */
export async function saveStrip(stripCanvas) {
  validateStrip(stripCanvas);
  download(await toBlob(stripCanvas), fileName());
}

/** Draw the Paperang-styled 9:16 Story background around the original photostrip. */
function makeStoryCanvas(stripCanvas) {
  const canvas = document.createElement('canvas');
  canvas.width = STORY_WIDTH;
  canvas.height = STORY_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not prepare the Story image.');

  const palette = getActiveTheme();

  // Paper base + dot grid matching the active theme
  ctx.fillStyle = palette.paper;
  ctx.fillRect(0, 0, STORY_WIDTH, STORY_HEIGHT);

  ctx.save();
  ctx.fillStyle = palette.dotPerf;
  const dotSpacing = 48;
  const dotRadius = 3;
  for (let y = 24; y < STORY_HEIGHT; y += dotSpacing) {
    for (let x = 24; x < STORY_WIDTH; x += dotSpacing) {
      ctx.beginPath();
      ctx.arc(x, y, dotRadius, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();

  // Top title badge matching #app-title and active theme tokens
  const titleText = 'POCKET BOOTH';
  ctx.save();
  ctx.font = '800 38px ui-monospace, "SFMono-Regular", Menlo, Monaco, Consolas, monospace';
  const titleMetrics = ctx.measureText(titleText);
  const badgePadX = 48;
  const badgeW = Math.ceil(titleMetrics.width + badgePadX * 2);
  const badgeH = 82;
  const badgeX = Math.round((STORY_WIDTH - badgeW) / 2);
  const badgeY = 112;

  roundedRect(ctx, badgeX, badgeY + 7, badgeW, badgeH, 10, palette.ink);
  roundedRect(ctx, badgeX, badgeY, badgeW, badgeH, 10, palette.paperBright);
  ctx.lineWidth = 4;
  ctx.strokeStyle = palette.ink;
  roundedRect(ctx, badgeX, badgeY, badgeW, badgeH, 10, null);

  ctx.fillStyle = palette.ink;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(titleText, STORY_WIDTH / 2, badgeY + badgeH / 2 + 1);
  ctx.restore();

  // Fit the exact strip cleanly between top title and bottom link without distortion
  const area = { x: 150, y: 248, w: 780, h: 1380 };
  const scale = Math.min(area.w / stripCanvas.width, area.h / stripCanvas.height);
  const drawWidth = Math.round(stripCanvas.width * scale);
  const drawHeight = Math.round(stripCanvas.height * scale);
  const drawX = Math.round((STORY_WIDTH - drawWidth) / 2);
  const drawY = Math.round(area.y + (area.h - drawHeight) / 2);

  // Subtle hardware shadow + thermal paper mount behind the strip
  ctx.save();
  ctx.shadowColor = palette.shadow;
  ctx.shadowBlur = 28;
  ctx.shadowOffsetY = 12;
  ctx.fillStyle = palette.stripMount;
  ctx.fillRect(drawX - 10, drawY - 10, drawWidth + 20, drawHeight + 20);
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = palette.ink;
  ctx.lineWidth = 3;
  ctx.strokeRect(drawX - 10, drawY - 10, drawWidth + 20, drawHeight + 20);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(stripCanvas, drawX, drawY, drawWidth, drawHeight);
  ctx.restore();

  // Editable app link near the bottom
  if (STORY_APP_LINK) {
    ctx.save();
    ctx.font = '700 28px ui-monospace, "SFMono-Regular", Menlo, Monaco, Consolas, monospace';
    ctx.fillStyle = palette.inkSoft;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(STORY_APP_LINK, STORY_WIDTH / 2, 1732);
    ctx.restore();
  }

  return canvas;
}

function roundedRect(ctx, x, y, width, height, radius, fillStyle) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
  if (fillStyle) {
    ctx.fillStyle = fillStyle;
    ctx.fill();
  }
}

/**
 * Share the Story composition. If Web Share with files is unavailable, download
 * the same 9:16 Story PNG instead. Returns 'shared' | 'saved' | 'cancelled'.
 */
export async function shareStrip(stripCanvas) {
  validateStrip(stripCanvas);
  const storyCanvas = makeStoryCanvas(stripCanvas);
  const blob = await toBlob(storyCanvas);
  const name = fileName('-story');
  const file = new File([blob], name, { type: 'image/png' });

  if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Pocket Booth Story' });
      return 'shared';
    } catch (err) {
      if (err && err.name === 'AbortError') return 'cancelled';
      // Any other share error falls through to a download of the same Story image.
    }
  }
  download(blob, name);
  return 'saved';
}