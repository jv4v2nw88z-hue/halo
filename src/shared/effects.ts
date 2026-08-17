/**
 * The spatial effect field, shared verbatim between the main process (which
 * writes real frames to hardware) and the renderer (which draws the layout
 * canvas). One implementation means the preview cannot drift from the output.
 *
 * Nothing in here knows what a fan is. Color is a function of position and
 * time, which is the entire premise of the layout feature.
 */

import type { EffectConfig, LayoutElement } from './types.js';

/* ------------------------------------------------------------------ */
/* color                                                               */
/* ------------------------------------------------------------------ */

export function hsvToRgb(h: number, s: number, v: number, out: Uint8Array, at: number) {
  h = ((h % 360) + 360) % 360;
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else { r = c; b = x; }
  out[at] = ((r + m) * 255) | 0;
  out[at + 1] = ((g + m) * 255) | 0;
  out[at + 2] = ((b + m) * 255) | 0;
}

/* ------------------------------------------------------------------ */
/* geometry: element -> world-space LED coordinates                    */
/* ------------------------------------------------------------------ */

export interface LedPoint { x: number; y: number; nx: number; ny: number }

export function elementLeds(el: LayoutElement): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  const rad = (el.rot * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const push = (lx: number, ly: number) =>
    out.push({ x: el.x + lx * cos - ly * sin, y: el.y + lx * sin + ly * cos });

  const n = el.ledCount;

  if (el.shape === 'ring') {
    const r = el.r ?? 30;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 - Math.PI / 2;
      push(Math.cos(a) * r, Math.sin(a) * r);
    }
  } else if (el.shape === 'line') {
    const len = el.len ?? 80;
    for (let i = 0; i < n; i++) {
      const p = n === 1 ? 0.5 : i / (n - 1);
      push((p - 0.5) * len, 0);
    }
  } else if (el.shape === 'grid') {
    const cols = el.cols ?? Math.ceil(Math.sqrt(n));
    const rows = Math.ceil(n / cols);
    const w = el.w ?? 200;
    const h = el.h ?? 100;
    for (let i = 0; i < n; i++) {
      const c = i % cols;
      const rw = (i / cols) | 0;
      push(
        cols === 1 ? 0 : (c / (cols - 1) - 0.5) * w,
        rows === 1 ? 0 : (rw / (rows - 1) - 0.5) * h,
      );
    }
  } else {
    // 'point'. Emit one coordinate per LED rather than a single one: the number
    // of points here defines how many LEDs get addressed at all, so returning
    // fewer than ledCount silently strands the remainder. Coincident points are
    // the honest reading of "this zone is one spot".
    for (let i = 0; i < n; i++) push(0, 0);
  }
  return out;
}

/**
 * Flatten a layout into normalized LED coordinates.
 *
 * Normalization is against the bounding box of everything actually placed, not
 * against the canvas, so effects always span the user's real hardware footprint
 * with no dead space.
 */
export function buildField(elements: LayoutElement[]): LedPoint[] {
  const pts: LedPoint[] = [];
  for (const el of elements) {
    for (const p of elementLeds(el)) pts.push({ x: p.x, y: p.y, nx: 0, ny: 0 });
  }
  if (!pts.length) return pts;

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const w = Math.max(1, maxX - minX);
  const h = Math.max(1, maxY - minY);
  for (const p of pts) {
    p.nx = (p.x - minX) / w;
    p.ny = (p.y - minY) / h;
  }
  return pts;
}

/* ------------------------------------------------------------------ */
/* the field itself                                                    */
/* ------------------------------------------------------------------ */

/** Writes one RGB triple into `out` at byte offset `at`. */
export function sampleField(
  nx: number, ny: number, t: number, cfg: EffectConfig, out: Uint8Array, at: number,
) {
  const rate = cfg.speed / 100;
  const scale = cfg.scale / 100;
  let phase = 0;
  let vmul = 1;

  switch (cfg.effect) {
    case 'sweep': {
      const a = (cfg.angle * Math.PI) / 180;
      phase = t * rate * 0.4 + ((nx - 0.5) * Math.cos(a) + (ny - 0.5) * Math.sin(a)) * scale * 3.2;
      break;
    }
    case 'ripple': {
      const dx = nx - 0.5, dy = ny - 0.5;
      phase = t * rate * 0.5 - Math.sqrt(dx * dx + dy * dy) * scale * 4.5;
      break;
    }
    case 'spin': {
      phase = t * rate * 0.3 + (Math.atan2(ny - 0.5, nx - 0.5) / (Math.PI * 2) + 0.5) * scale * 2.4;
      break;
    }
    case 'rain': {
      phase = t * rate * 0.4 + ny * scale * 2.6;
      let band = (t * rate * 1.1 - ny * 2.4 + nx * 0.12) % 1;
      if (band < 0) band += 1;
      vmul = Math.max(0.05, 1 - band * 2.6);
      break;
    }
    case 'plasma': {
      const s = scale * 4.5;
      phase =
        (Math.sin(nx * 6 * s + t * rate * 1.1) +
          Math.sin(ny * 5 * s - t * rate * 0.8) +
          Math.sin((nx + ny) * 4 * s + t * rate * 0.6)) / 6 + 0.5;
      break;
    }
    case 'solid':
    default:
      phase = 0;
      break;
  }

  phase %= 1;
  if (phase < 0) phase += 1;

  const gain = (cfg.brightness / 100) * vmul;

  if (cfg.palette === 'spectrum' && cfg.effect !== 'solid') {
    hsvToRgb(phase * 360, 1, gain, out, at);
    return;
  }

  if (cfg.effect === 'solid') {
    out[at] = (cfg.colorA[0] * gain) | 0;
    out[at + 1] = (cfg.colorA[1] * gain) | 0;
    out[at + 2] = (cfg.colorA[2] * gain) | 0;
    return;
  }

  const k = phase < 0.5 ? phase * 2 : (1 - phase) * 2;
  out[at] = ((cfg.colorA[0] + (cfg.colorB[0] - cfg.colorA[0]) * k) * gain) | 0;
  out[at + 1] = ((cfg.colorA[1] + (cfg.colorB[1] - cfg.colorA[1]) * k) * gain) | 0;
  out[at + 2] = ((cfg.colorA[2] + (cfg.colorB[2] - cfg.colorA[2]) * k) * gain) | 0;
}

/**
 * Fill a whole frame buffer. Allocation free on the hot path.
 *
 * `perLed`, when given, supplies an already-resolved config per LED index so
 * targeted overrides cost one array lookup per LED rather than a merge. It is
 * rebuilt only when the layout, the base config or the overrides change.
 */
export function renderFrame(
  field: LedPoint[],
  t: number,
  cfg: EffectConfig,
  out: Uint8Array,
  perLed?: readonly (EffectConfig | undefined)[],
) {
  for (let i = 0; i < field.length; i++) {
    sampleField(field[i].nx, field[i].ny, t, perLed?.[i] ?? cfg, out, i * 3);
  }
}
