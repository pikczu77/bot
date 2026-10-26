// profileCard.js — the /profil picture (2026-10-26, owner picked idea 11): avatar, level and XP bar,
// cash and bank, collections, badges and spouse on one PNG.
//
// Drawn with @napi-rs/canvas and the Inter font from assets/fonts (OFL; a server container has no
// fonts of its own). When the canvas module cannot load, renderProfileCard() returns null and the
// command answers with an embed instead. No emoji on the picture: the font has none.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger } from '../utils/logger.js';

const FONT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../assets/fonts');
const FAMILY = 'Inter';
export const CARD_WIDTH = 1000;
export const CARD_HEIGHT = 420;

let canvasModule;
let loadFailed = false;

async function loadCanvas() {
  if (canvasModule || loadFailed) return canvasModule ?? null;
  try {
    canvasModule = await import('@napi-rs/canvas');
    for (const file of ['Inter-Regular.ttf', 'Inter-Bold.ttf', 'Inter-ExtraBold.ttf']) {
      canvasModule.GlobalFonts.registerFromPath(path.join(FONT_DIR, file), FAMILY);
    }
    return canvasModule;
  } catch (error) {
    loadFailed = true;
    logger.warn(`Profile card: canvas not available (${error.message}), /profil answers with an embed`);
    return null;
  }
}

function roundRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, height / 2, width / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

/** Cut `text` with "…" so it fits `maxWidth` in the current font. */
function fit(ctx, text, maxWidth) {
  let value = String(text ?? '');
  if (ctx.measureText(value).width <= maxWidth) return value;
  while (value.length > 1 && ctx.measureText(`${value}…`).width > maxWidth) value = value.slice(0, -1);
  return `${value}…`;
}

async function fetchAvatar(url, timeoutMs = 5000) {
  if (!url) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return null;
    return Buffer.from(await response.arrayBuffer());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Draw the card. `data`: { name, subtitle, avatarUrl | avatarBuffer, accent, level, xp, xpNeeded, xpText,
 * tiles: [{ label, value }] (4), badgesTitle, badges: [name], spouse }. Returns a PNG buffer or null.
 */
export async function renderProfileCard(data) {
  const canvas = await loadCanvas();
  if (!canvas) return null;
  const { createCanvas, loadImage } = canvas;
  const card = createCanvas(CARD_WIDTH, CARD_HEIGHT);
  const ctx = card.getContext('2d');
  const accent = data.accent || '#5865F2';

  // Background with a soft glow in the accent colour.
  const background = ctx.createLinearGradient(0, 0, CARD_WIDTH, CARD_HEIGHT);
  background.addColorStop(0, '#0B0F19');
  background.addColorStop(1, '#1A2238');
  roundRect(ctx, 0, 0, CARD_WIDTH, CARD_HEIGHT, 28);
  ctx.fillStyle = background;
  ctx.fill();
  ctx.save();
  ctx.clip();
  const glow = ctx.createRadialGradient(150, 120, 10, 150, 120, 420);
  glow.addColorStop(0, `${accent}66`);
  glow.addColorStop(1, `${accent}00`);
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);
  ctx.restore();

  // Avatar.
  const avatarSize = 156;
  const ax = 50;
  const ay = 34;
  ctx.beginPath();
  ctx.arc(ax + avatarSize / 2, ay + avatarSize / 2, avatarSize / 2 + 6, 0, Math.PI * 2);
  ctx.fillStyle = accent;
  ctx.fill();
  const buffer = data.avatarBuffer ?? await fetchAvatar(data.avatarUrl);
  let image = null;
  if (buffer) image = await loadImage(buffer).catch(() => null);
  ctx.save();
  ctx.beginPath();
  ctx.arc(ax + avatarSize / 2, ay + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2);
  ctx.clip();
  if (image) {
    ctx.drawImage(image, ax, ay, avatarSize, avatarSize);
  } else {
    ctx.fillStyle = '#2A3352';
    ctx.fillRect(ax, ay, avatarSize, avatarSize);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = `800 80px ${FAMILY}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(data.name ?? '?').slice(0, 1).toUpperCase(), ax + avatarSize / 2, ay + avatarSize / 2 + 4);
  }
  ctx.restore();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  // Name, subtitle, spouse.
  const left = 260;
  const right = CARD_WIDTH - 50;
  ctx.fillStyle = '#FFFFFF';
  ctx.font = `800 44px ${FAMILY}`;
  ctx.fillText(fit(ctx, data.name, right - left), left, 100);
  ctx.fillStyle = '#AEB6CC';
  ctx.font = `400 22px ${FAMILY}`;
  ctx.fillText(fit(ctx, data.subtitle, right - left), left, 136);

  // Level and XP bar.
  const barY = 160;
  const barHeight = 26;
  roundRect(ctx, left, barY, right - left, barHeight, 13);
  ctx.fillStyle = '#FFFFFF1F';
  ctx.fill();
  const share = data.xpNeeded > 0 ? Math.max(0, Math.min(1, data.xp / data.xpNeeded)) : 0;
  if (share > 0) {
    const fill = ctx.createLinearGradient(left, 0, right, 0);
    fill.addColorStop(0, accent);
    fill.addColorStop(1, '#9B8CFF');
    roundRect(ctx, left, barY, Math.max(barHeight, (right - left) * share), barHeight, 13);
    ctx.fillStyle = fill;
    ctx.fill();
  }
  ctx.fillStyle = '#FFFFFF';
  ctx.font = `700 16px ${FAMILY}`;
  ctx.textAlign = 'right';
  ctx.fillText(data.xpText ?? '', right - 12, barY + 19);
  ctx.textAlign = 'left';

  // Four tiles: cash, bank, cards, fish.
  const tiles = (data.tiles ?? []).slice(0, 4);
  const gap = 16;
  const tileY = 214;
  const tileWidth = (CARD_WIDTH - 100 - gap * 3) / 4;
  tiles.forEach((tile, index) => {
    const x = 50 + index * (tileWidth + gap);
    roundRect(ctx, x, tileY, tileWidth, 84, 18);
    ctx.fillStyle = '#FFFFFF12';
    ctx.fill();
    ctx.fillStyle = '#8E97B0';
    ctx.font = `400 17px ${FAMILY}`;
    ctx.fillText(fit(ctx, tile.label, tileWidth - 32), x + 16, tileY + 32);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = `700 26px ${FAMILY}`;
    ctx.fillText(fit(ctx, tile.value, tileWidth - 32), x + 16, tileY + 66);
  });

  // Badges as pills.
  const badgeY = 322;
  ctx.fillStyle = '#AEB6CC';
  ctx.font = `700 18px ${FAMILY}`;
  ctx.fillText(data.badgesTitle ?? '', 50, badgeY + 10);
  let x = 50;
  const pillY = badgeY + 26;
  ctx.font = `700 17px ${FAMILY}`;
  for (const name of data.badges ?? []) {
    const width = Math.min(260, ctx.measureText(name).width + 32);
    if (x + width > right) break;
    roundRect(ctx, x, pillY, width, 38, 19);
    ctx.fillStyle = `${accent}33`;
    ctx.fill();
    ctx.strokeStyle = `${accent}AA`;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText(fit(ctx, name, width - 32), x + 16, pillY + 25);
    x += width + 10;
  }
  if (!(data.badges ?? []).length) {
    ctx.fillStyle = '#6B7490';
    ctx.font = `400 17px ${FAMILY}`;
    ctx.fillText(data.noBadges ?? '', 50, pillY + 25);
  }

  return card.encode('png');
}
