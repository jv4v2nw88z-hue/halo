/** Types crossing the main/renderer boundary. Keep this file dependency free. */

export type ConnectionState = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'failed';

export type ElementShape = 'ring' | 'line' | 'grid' | 'point';

/** A placeable lighting zone. `deviceIndex` and `zoneIndex` point back at OpenRGB. */
export interface LayoutElement {
  id: string;
  deviceIndex: number;
  zoneIndex: number;
  /** First LED of this element within the device's flat LED array. */
  ledOffset: number;
  ledCount: number;
  device: string;
  zone: string;

  shape: ElementShape;
  x: number;
  y: number;
  rot: number;
  r?: number;
  len?: number;
  w?: number;
  h?: number;
  cols?: number;
}

export type EffectId = 'sweep' | 'ripple' | 'spin' | 'rain' | 'plasma' | 'solid';

export interface EffectConfig {
  effect: EffectId;
  angle: number;
  speed: number;
  scale: number;
  brightness: number;
  palette: 'spectrum' | 'duotone';
  colorA: [number, number, number];
  colorB: [number, number, number];
}

/**
 * Per-target colour overrides, layered on top of the global EffectConfig.
 *
 * Keys are `device:<deviceIndex>`, `zone:<deviceIndex>:<zoneIndex>` or
 * `led:<deviceIndex>:<ledIndex>`, resolved most-specific-wins so a single LED
 * can be pinned without detaching its zone or its device from the global look.
 * Values are partial: an override that only sets `colorA` still inherits speed,
 * scale and brightness from the level above it.
 */
export type OverrideMap = Record<string, Partial<EffectConfig>>;

export const overrideKey = {
  device: (d: number) => `device:${d}`,
  zone: (d: number, z: number) => `zone:${d}:${z}`,
  led: (d: number, l: number) => `led:${d}:${l}`,
};

/** Most specific first. Used by both the engine and the UI. */
export function resolveConfig(
  base: EffectConfig,
  overrides: OverrideMap,
  deviceIndex: number,
  zoneIndex: number,
  ledIndex: number,
): EffectConfig {
  const d = overrides[overrideKey.device(deviceIndex)];
  const z = overrides[overrideKey.zone(deviceIndex, zoneIndex)];
  const l = overrides[overrideKey.led(deviceIndex, ledIndex)];
  if (!d && !z && !l) return base;
  return { ...base, ...d, ...z, ...l };
}

export interface DeviceSummary {
  index: number;
  name: string;
  vendor: string;
  type: string;
  ledCount: number;
  zones: {
    index: number; name: string; ledCount: number; ledOffset: number;
    /** When ledsMax > ledsMin the zone is an addressable channel whose length
     *  OpenRGB cannot detect, and which the user must state. */
    ledsMin: number; ledsMax: number;
  }[];
  supportsDirect: boolean;
}

export interface EngineStatus {
  state: ConnectionState;
  protocol: number;
  fps: number;
  deviceCount: number;
  ledCount: number;
  droppedFrames: number;
  unsupported: string[];
  lastError: string | null;
}

/** Preview frame pushed to the renderer. `rgb` is a flat RGB triple array. */
export interface PreviewFrame {
  t: number;
  rgb: Uint8Array;
}

export const DEFAULT_EFFECT: EffectConfig = {
  effect: 'sweep',
  angle: 0,
  speed: 42,
  scale: 45,
  brightness: 100,
  palette: 'spectrum',
  colorA: [255, 59, 48],
  colorB: [10, 132, 255],
};
