import { EventEmitter } from 'node:events';
import { OpenRgbClient } from './openrgb/client.js';
import { buildField, renderFrame, type LedPoint } from '../shared/effects.js';
import type { EffectConfig, LayoutElement, EngineStatus, OverrideMap } from '../shared/types.js';
import { overrideKey, resolveConfig } from '../shared/types.js';

/**
 * The frame engine.
 *
 * Runs in the MAIN process on purpose. Lighting keeps running when the window
 * is closed to the tray, and the renderer never becomes a dependency of your
 * hardware staying lit. The renderer gets a preview copy at a lower rate.
 *
 * Three protections matter here, and all three came from hardware reality
 * rather than theory:
 *
 *  - Rate limit. SMBus motherboards and DRAM will visibly stutter or drop
 *    writes above roughly 30 updates per second. Peripherals happily take more.
 *    Each device gets its own budget.
 *  - Dirty check. A static effect should send nothing at all after the first
 *    frame. Comparing against the last sent buffer costs far less than a write.
 *  - Backpressure. If the socket has not drained we skip the frame rather than
 *    queueing it, because a queued lighting frame is worthless by the time it
 *    lands.
 */

const TARGET_FPS = 40;
const PREVIEW_FPS = 20;

/** Per-device write ceilings, chosen by bus rather than by brand. */
function fpsCapFor(typeName: string): number {
  switch (typeName) {
    case 'Motherboard':
    case 'DRAM':
    case 'Storage':
      return 20; // SMBus / I2C, genuinely slow and easy to overrun
    case 'GPU':
    case 'Cooler':
    case 'Case':
      return 30;
    default:
      return 40; // USB HID peripherals
  }
}

interface DeviceSlice {
  deviceIndex: number;
  ledCount: number;
  /** Offset into the global frame buffer, in LEDs. */
  fieldOffset: number;
  buffer: Uint8Array;
  lastSent: Uint8Array;
  minInterval: number;
  lastSentAt: number;
  everSent: boolean;
}

export class Engine extends EventEmitter {
  private field: LedPoint[] = [];
  private frame = new Uint8Array(0);
  private slices: DeviceSlice[] = [];
  private timer: NodeJS.Timeout | null = null;
  private startedAt = 0;
  private lastPreview = 0;
  private frames = 0;
  private fpsWindow = 0;

  running = false;
  fps = 0;
  dropped = 0;
  unsupported: string[] = [];
  lastError: string | null = null;

  cfg: EffectConfig;
  overrides: OverrideMap = {};

  /** Parallel to `field`: which device/zone/LED each field entry belongs to. */
  private ledMeta: { d: number; z: number; l: number }[] = [];
  /** Parallel to `field`: resolved config, or undefined to use the base cfg. */
  private perLed: (EffectConfig | undefined)[] = [];

  constructor(private client: OpenRgbClient, cfg: EffectConfig) {
    super();
    this.cfg = cfg;
  }

  /* ---------------------------------------------------------------- */

  /**
   * Rebuild the field and the per-device slices from a layout.
   *
   * The layout is authoritative about geometry, but OpenRGB is authoritative
   * about LED counts. Where they disagree, usually because the user swapped
   * hardware, we clamp to whatever the device actually reports so we never
   * write past the end of a device's LED array.
   */
  setLayout(elements: LayoutElement[]) {
    const ordered = [...elements].sort(
      (a, b) => a.deviceIndex - b.deviceIndex || a.ledOffset - b.ledOffset,
    );

    const safe: LayoutElement[] = [];
    for (const el of ordered) {
      const c = this.client.controllers[el.deviceIndex];
      if (!c) continue;
      const available = Math.max(0, c.leds.length - el.ledOffset);
      if (available === 0) continue;
      safe.push({ ...el, ledCount: Math.min(el.ledCount, available) });
    }

    this.field = buildField(safe);
    this.frame = new Uint8Array(this.field.length * 3);

    // Same iteration order as buildField, so index i in the field is index i
    // here. This is what lets an override name a single physical LED.
    const meta: { d: number; z: number; l: number }[] = [];
    for (const el of safe) {
      for (let j = 0; j < el.ledCount; j++) {
        meta.push({ d: el.deviceIndex, z: el.zoneIndex, l: el.ledOffset + j });
      }
    }
    this.ledMeta = meta;
    this.rebuildPerLed();

    // One slice per device, covering that device's full LED array so a single
    // UPDATELEDS call can carry it.
    const slices: DeviceSlice[] = [];
    let cursor = 0;
    const byDevice = new Map<number, { offset: number; leds: number }>();

    for (const el of safe) {
      if (!byDevice.has(el.deviceIndex)) {
        byDevice.set(el.deviceIndex, { offset: cursor, leds: 0 });
      }
      byDevice.get(el.deviceIndex)!.leds += el.ledCount;
      cursor += el.ledCount;
    }

    for (const [deviceIndex, info] of byDevice) {
      const c = this.client.controllers[deviceIndex];
      slices.push({
        deviceIndex,
        ledCount: info.leds,
        fieldOffset: info.offset,
        buffer: new Uint8Array(info.leds * 3),
        lastSent: new Uint8Array(info.leds * 3),
        minInterval: 1000 / fpsCapFor(c?.typeName ?? 'Unknown'),
        lastSentAt: 0,
        everSent: false,
      });
    }

    this.slices = slices;
    this.emit('status', this.status());
  }

  setConfig(cfg: Partial<EffectConfig>) {
    this.cfg = { ...this.cfg, ...cfg };
    this.rebuildPerLed();
  }

  setOverrides(overrides: OverrideMap) {
    this.overrides = overrides;
    this.rebuildPerLed();
  }

  /**
   * Precompute the config each LED renders with.
   *
   * Done here rather than per frame so the 40fps path stays a single array
   * lookup. Entries that resolve back to the base config are left undefined,
   * which keeps the common "no overrides at all" case free.
   */
  private rebuildPerLed() {
    if (!Object.keys(this.overrides).length) { this.perLed = []; return; }

    const cache = new Map<string, EffectConfig>();
    const out: (EffectConfig | undefined)[] = new Array(this.ledMeta.length);

    for (let i = 0; i < this.ledMeta.length; i++) {
      const m = this.ledMeta[i];
      // One resolved object per (device, zone), plus one per individually
      // targeted LED, instead of one per LED.
      const hasLed = !!this.overrides[overrideKey.led(m.d, m.l)];
      const sig = `${m.d}:${m.z}:${hasLed ? m.l : '-'}`;
      let resolved = cache.get(sig);
      if (!resolved) {
        resolved = resolveConfig(this.cfg, this.overrides, m.d, m.z, m.l);
        cache.set(sig, resolved);
      }
      out[i] = resolved === this.cfg ? undefined : resolved;
    }
    this.perLed = out;
  }

  /* ---------------------------------------------------------------- */

  async start() {
    if (this.running) return;
    this.unsupported = await this.client.enableDirectModeAll();
    this.running = true;
    this.startedAt = performance.now();
    this.fpsWindow = this.startedAt;
    this.frames = 0;
    this.tick();
    this.emit('status', this.status());
  }

  stop() {
    this.running = false;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    this.emit('status', this.status());
  }

  /** Send one all-black frame so hardware does not freeze on the last color. */
  blackout() {
    for (const s of this.slices) {
      s.buffer.fill(0);
      this.client.updateLeds(s.deviceIndex, s.buffer);
      s.lastSent.fill(0);
    }
  }

  /* ---------------------------------------------------------------- */

  private tick = () => {
    if (!this.running) return;
    const begin = performance.now();

    try {
      if (this.client.connected && this.field.length) {
        const t = (begin - this.startedAt) / 1000;
        renderFrame(this.field, t, this.cfg, this.frame, this.perLed);
        this.flush(begin);

        if (begin - this.lastPreview >= 1000 / PREVIEW_FPS) {
          this.lastPreview = begin;
          this.emit('preview', { t, rgb: this.frame });
        }
      }

      this.frames++;
      if (begin - this.fpsWindow >= 1000) {
        this.fps = Math.round((this.frames * 1000) / (begin - this.fpsWindow));
        this.frames = 0;
        this.fpsWindow = begin;
        this.emit('status', this.status());
      }
      this.lastError = null;
    } catch (e) {
      this.lastError = e instanceof Error ? e.message : String(e);
      this.emit('status', this.status());
    }

    const elapsed = performance.now() - begin;
    this.timer = setTimeout(this.tick, Math.max(0, 1000 / TARGET_FPS - elapsed));
  };

  private flush(now: number) {
    for (const s of this.slices) {
      if (now - s.lastSentAt < s.minInterval) continue;

      // Copy this device's window out of the global frame.
      const from = s.fieldOffset * 3;
      s.buffer.set(this.frame.subarray(from, from + s.buffer.length));

      if (s.everSent && equal(s.buffer, s.lastSent)) continue; // nothing changed

      if (!this.client.writable) { this.dropped++; continue; } // socket backed up

      const wrote = this.client.updateLeds(s.deviceIndex, s.buffer);
      if (!wrote) this.dropped++;

      s.lastSent.set(s.buffer);
      s.lastSentAt = now;
      s.everSent = true;
    }
  }

  status(): EngineStatus {
    return {
      state: this.client.state,
      protocol: this.client.protocol,
      fps: this.fps,
      deviceCount: this.slices.length,
      ledCount: this.field.length,
      droppedFrames: this.dropped,
      unsupported: this.unsupported,
      lastError: this.lastError,
    };
  }
}

function equal(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
