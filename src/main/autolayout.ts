import type { Controller } from './openrgb/protocol.js';
import type { LayoutElement, ElementShape } from '../shared/types.js';

/**
 * First-run layout.
 *
 * Nobody wants to open a new app and find twenty overlapping circles in the
 * middle of a canvas. We seed positions from device type so the arrangement is
 * roughly right before the user touches anything, then they nudge.
 *
 * Coordinates match the canvas viewBox: 960 x 600, case on the left, desk on
 * the right, front of the case at low X.
 */

const CASE = { x: 40, y: 36, w: 520, h: 528 };
const DESK = { x: 596, y: 36, w: 324, h: 528 };

/** Guess a physical shape from the zone's name and size. */
function shapeFor(deviceType: string, zoneName: string, ledCount: number): ElementShape {
  const n = zoneName.toLowerCase();
  if (/fan|pump|ring|halo|cap/.test(n)) return 'ring';
  if (deviceType === 'Keyboard' && ledCount > 20) return 'grid';
  if (ledCount === 1) return 'point';
  if (deviceType === 'Cooler' && ledCount >= 12) return 'ring';
  return 'line';
}

export function autoLayout(controllers: Controller[]): LayoutElement[] {
  const out: LayoutElement[] = [];

  // Cursors per region, so same-category hardware stacks instead of colliding.
  let frontSlot = 0;   // left edge of the case
  let topSlot = 0;     // top edge of the case
  let boardSlot = 0;   // right side of the case
  let deskSlot = 0;    // desk column

  for (const c of controllers) {
    let ledOffset = 0;

    for (let zi = 0; zi < c.zones.length; zi++) {
      const z = c.zones[zi];
      if (z.ledsCount === 0) { continue; }

      const shape = shapeFor(c.typeName, z.name, z.ledsCount);
      const base: LayoutElement = {
        id: `${c.index}:${zi}`,
        deviceIndex: c.index,
        zoneIndex: zi,
        ledOffset,
        ledCount: z.ledsCount,
        device: c.name,
        zone: z.name,
        shape,
        x: 0, y: 0, rot: 0,
      };

      switch (c.typeName) {
        case 'Cooler': {
          if (/pump|head|cap/i.test(z.name)) {
            base.x = 300; base.y = 252; base.r = 34;
          } else {
            base.x = 232 + (topSlot % 4) * 90;
            base.y = 92;
            base.r = 30;
            topSlot++;
          }
          break;
        }
        case 'Case': {
          base.x = 112;
          base.y = 142 + (frontSlot % 3) * 130;
          base.r = 32;
          frontSlot++;
          break;
        }
        case 'DRAM': {
          base.shape = 'line';
          base.x = 396 + (boardSlot % 4) * 22;
          base.y = 206;
          base.len = 78;
          base.rot = 90;
          boardSlot++;
          break;
        }
        case 'GPU': {
          base.shape = 'line';
          base.x = 268; base.y = 332; base.len = 92;
          break;
        }
        case 'Motherboard': {
          base.shape = 'line';
          if (/io|shield|rear/i.test(z.name)) { base.x = 521; base.y = 152; base.len = 92; base.rot = 90; }
          else if (/argb|header|strip/i.test(z.name)) { base.x = 300; base.y = 520; base.len = 380; }
          else { base.x = 458; base.y = 402; base.len = 70; }
          break;
        }
        case 'Keyboard': {
          if (shape === 'grid') {
            base.x = 760; base.y = 170; base.w = 280; base.h = 104;
            base.cols = Math.min(18, Math.max(6, Math.round(Math.sqrt(z.ledsCount * 2.4))));
          } else {
            base.shape = 'line'; base.x = 760; base.y = 242; base.len = 292;
          }
          break;
        }
        case 'Mouse':
        case 'Mousemat':
        case 'Headset':
        case 'Headset Stand':
        case 'Speaker': {
          base.x = 700 + (deskSlot % 2) * 120;
          base.y = 348 + Math.floor(deskSlot / 2) * 60;
          if (base.shape === 'line') base.len = 40;
          deskSlot++;
          break;
        }
        default: {
          // Unknown hardware goes in an unclaimed strip along the case bottom
          // rather than on top of something the user already recognises.
          base.x = CASE.x + 80 + (out.length % 5) * 90;
          base.y = CASE.y + CASE.h - 70;
          if (base.shape === 'line') base.len = 70;
          if (base.shape === 'ring') base.r = 26;
        }
      }

      out.push(base);
      ledOffset += z.ledsCount;
    }
  }

  return out;
}

/**
 * Reconcile a saved layout against the hardware currently present.
 *
 * Devices get reordered by OpenRGB whenever you unplug something, so we match
 * on device name plus zone name rather than on index. Anything that no longer
 * exists is dropped, anything new is auto-placed.
 */
export function reconcileLayout(
  saved: LayoutElement[], controllers: Controller[],
): { layout: LayoutElement[]; added: number; removed: number } {
  const fresh = autoLayout(controllers);
  const byKey = new Map(saved.map((el) => [`${el.device}::${el.zone}`, el]));

  let added = 0;
  const layout = fresh.map((el) => {
    const prev = byKey.get(`${el.device}::${el.zone}`);
    if (!prev) { added++; return el; }
    byKey.delete(`${el.device}::${el.zone}`);

    // Keep the user's placement, take fresh indices and LED counts from
    // hardware. Shape and dimensions are only carried over when the zone is
    // still the same size: a channel that grew from 1 LED to 24 is no longer a
    // 'point', and keeping that shape would map a single LED and silently
    // strand the other 23.
    const sameSize = prev.ledCount === el.ledCount;
    // A 'point' can only ever express one LED, so a saved point on a multi-LED
    // zone is stale bookkeeping and must not be carried forward — that is how a
    // resized channel ends up mapping a single LED.
    const shapeFits = prev.shape !== 'point' || el.ledCount === 1;
    return {
      ...el,
      x: prev.x, y: prev.y, rot: prev.rot,
      ...(sameSize && shapeFits ? {
        r: prev.r ?? el.r,
        len: prev.len ?? el.len,
        w: prev.w ?? el.w,
        h: prev.h ?? el.h,
        cols: prev.cols ?? el.cols,
        shape: prev.shape,
      } : {}),
    };
  });

  return { layout, added, removed: byKey.size };
}

export { CASE, DESK };
