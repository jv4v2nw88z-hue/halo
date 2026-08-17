/**
 * OpenRGB SDK binary protocol.
 *
 * Wire format is a 16-byte header followed by an optional payload:
 *
 *   magic      4 bytes   "ORGB"
 *   deviceId   uint32 LE
 *   packetId   uint32 LE
 *   dataSize   uint32 LE
 *
 * Strings inside payloads are length-prefixed with a uint16 and the length
 * INCLUDES the trailing null byte. Colors are 4 bytes: R, G, B, padding.
 *
 * Reference: OpenRGB NetworkProtocol.h (GPL-2.0-or-later). We reimplement the
 * wire format rather than linking any OpenRGB code, so this file carries no
 * GPL obligation.
 */

export const MAGIC = Buffer.from('ORGB', 'ascii');
export const HEADER_SIZE = 16;
export const DEFAULT_PORT = 6742;

/** Highest protocol revision this client understands. */
export const CLIENT_PROTOCOL_VERSION = 3;

export const Packet = {
  REQUEST_CONTROLLER_COUNT: 0,
  REQUEST_CONTROLLER_DATA: 1,
  REQUEST_PROTOCOL_VERSION: 40,
  SET_CLIENT_NAME: 50,
  DEVICE_LIST_UPDATED: 100,
  RGBCONTROLLER_RESIZEZONE: 1000,
  RGBCONTROLLER_UPDATELEDS: 1050,
  RGBCONTROLLER_UPDATEZONELEDS: 1051,
  RGBCONTROLLER_UPDATESINGLELED: 1052,
  RGBCONTROLLER_SETCUSTOMMODE: 1100,
  RGBCONTROLLER_UPDATEMODE: 1101,
} as const;

export const DeviceType = [
  'Motherboard', 'DRAM', 'GPU', 'Cooler', 'LED Strip', 'Keyboard', 'Mouse',
  'Mousemat', 'Headset', 'Headset Stand', 'Gamepad', 'Light', 'Speaker',
  'Virtual', 'Storage', 'Case', 'Microphone', 'Accessory', 'Keypad', 'Unknown',
] as const;

/** Mode flag bits we care about. */
export const ModeFlag = {
  HAS_SPEED: 1 << 0,
  HAS_DIRECTION_LR: 1 << 1,
  HAS_DIRECTION_UD: 1 << 2,
  HAS_DIRECTION_HV: 1 << 3,
  HAS_BRIGHTNESS: 1 << 4,
  HAS_PER_LED_COLOR: 1 << 5,
  HAS_MODE_SPECIFIC_COLOR: 1 << 6,
  HAS_RANDOM_COLOR: 1 << 7,
  MANUAL_SAVE: 1 << 8,
  AUTOMATIC_SAVE: 1 << 9,
} as const;

export interface RgbColor { r: number; g: number; b: number }

export interface Mode {
  name: string;
  value: number;
  flags: number;
  speedMin: number;
  speedMax: number;
  brightnessMin: number;
  brightnessMax: number;
  colorMin: number;
  colorMax: number;
  speed: number;
  brightness: number;
  direction: number;
  colorMode: number;
  colors: RgbColor[];
}

export interface Zone {
  name: string;
  type: number;
  ledsMin: number;
  ledsMax: number;
  ledsCount: number;
  matrix: { width: number; height: number; data: number[] } | null;
}

export interface Controller {
  index: number;
  type: number;
  typeName: string;
  name: string;
  vendor: string;
  description: string;
  version: string;
  serial: string;
  location: string;
  activeMode: number;
  modes: Mode[];
  zones: Zone[];
  leds: { name: string; value: number }[];
  colors: RgbColor[];
}

/* ------------------------------------------------------------------ */
/* readers                                                             */
/* ------------------------------------------------------------------ */

class Reader {
  constructor(private buf: Buffer, public off = 0) {}

  u8() { const v = this.buf.readUInt8(this.off); this.off += 1; return v; }
  u16() { const v = this.buf.readUInt16LE(this.off); this.off += 2; return v; }
  u32() { const v = this.buf.readUInt32LE(this.off); this.off += 4; return v; }
  i32() { const v = this.buf.readInt32LE(this.off); this.off += 4; return v; }

  /** uint16 length prefix, length includes the trailing null. */
  str() {
    const len = this.u16();
    if (len === 0) return '';
    const s = this.buf.toString('utf8', this.off, this.off + len - 1);
    this.off += len;
    return s;
  }

  color(): RgbColor {
    const r = this.u8(), g = this.u8(), b = this.u8();
    this.off += 1; // padding
    return { r, g, b };
  }

  skip(n: number) { this.off += n; }
  get remaining() { return this.buf.length - this.off; }
}

/* ------------------------------------------------------------------ */
/* writers                                                             */
/* ------------------------------------------------------------------ */

class Writer {
  private chunks: Buffer[] = [];
  private len = 0;

  private push(b: Buffer) { this.chunks.push(b); this.len += b.length; return this; }

  u16(v: number) { const b = Buffer.allocUnsafe(2); b.writeUInt16LE(v, 0); return this.push(b); }
  u32(v: number) { const b = Buffer.allocUnsafe(4); b.writeUInt32LE(v, 0); return this.push(b); }
  i32(v: number) { const b = Buffer.allocUnsafe(4); b.writeInt32LE(v, 0); return this.push(b); }

  str(s: string) {
    const body = Buffer.from(s, 'utf8');
    this.u16(body.length + 1);
    this.push(body);
    return this.push(Buffer.from([0]));
  }

  color(c: RgbColor) {
    return this.push(Buffer.from([c.r & 255, c.g & 255, c.b & 255, 0]));
  }

  raw(b: Buffer) { return this.push(b); }
  get length() { return this.len; }
  done() { return Buffer.concat(this.chunks, this.len); }
}

/* ------------------------------------------------------------------ */
/* header                                                              */
/* ------------------------------------------------------------------ */

export function encodeHeader(deviceId: number, packetId: number, dataSize: number) {
  const h = Buffer.allocUnsafe(HEADER_SIZE);
  MAGIC.copy(h, 0);
  h.writeUInt32LE(deviceId, 4);
  h.writeUInt32LE(packetId, 8);
  h.writeUInt32LE(dataSize, 12);
  return h;
}

export function encodePacket(deviceId: number, packetId: number, data?: Buffer) {
  const body = data ?? Buffer.alloc(0);
  return Buffer.concat([encodeHeader(deviceId, packetId, body.length), body]);
}

export interface ParsedHeader { deviceId: number; packetId: number; dataSize: number }

export function decodeHeader(buf: Buffer): ParsedHeader | null {
  if (buf.length < HEADER_SIZE) return null;
  if (buf.compare(MAGIC, 0, 4, 0, 4) !== 0) return null;
  return {
    deviceId: buf.readUInt32LE(4),
    packetId: buf.readUInt32LE(8),
    dataSize: buf.readUInt32LE(12),
  };
}

/* ------------------------------------------------------------------ */
/* mode encode / decode                                                */
/* ------------------------------------------------------------------ */

function readMode(r: Reader, protocol: number): Mode {
  const name = r.str();
  const value = r.i32();
  const flags = r.u32();
  const speedMin = r.u32();
  const speedMax = r.u32();
  const brightnessMin = protocol >= 3 ? r.u32() : 0;
  const brightnessMax = protocol >= 3 ? r.u32() : 0;
  const colorMin = r.u32();
  const colorMax = r.u32();
  const speed = r.u32();
  const brightness = protocol >= 3 ? r.u32() : 0;
  const direction = r.u32();
  const colorMode = r.u32();
  const numColors = r.u16();
  const colors: RgbColor[] = [];
  for (let i = 0; i < numColors; i++) colors.push(r.color());
  return {
    name, value, flags, speedMin, speedMax, brightnessMin, brightnessMax,
    colorMin, colorMax, speed, brightness, direction, colorMode, colors,
  };
}

function writeMode(w: Writer, m: Mode, protocol: number) {
  w.str(m.name);
  w.i32(m.value);
  w.u32(m.flags);
  w.u32(m.speedMin);
  w.u32(m.speedMax);
  if (protocol >= 3) { w.u32(m.brightnessMin); w.u32(m.brightnessMax); }
  w.u32(m.colorMin);
  w.u32(m.colorMax);
  w.u32(m.speed);
  if (protocol >= 3) w.u32(m.brightness);
  w.u32(m.direction);
  w.u32(m.colorMode);
  w.u16(m.colors.length);
  for (const c of m.colors) w.color(c);
}

/* ------------------------------------------------------------------ */
/* controller data                                                     */
/* ------------------------------------------------------------------ */

export function decodeController(data: Buffer, index: number, protocol: number): Controller {
  const r = new Reader(data);
  r.u32(); // total size, already known from the header

  const type = r.i32();
  const name = r.str();
  const vendor = protocol >= 1 ? r.str() : '';
  const description = r.str();
  const version = r.str();
  const serial = r.str();
  const location = r.str();

  const numModes = r.u16();
  const activeMode = r.i32();
  const modes: Mode[] = [];
  for (let i = 0; i < numModes; i++) modes.push(readMode(r, protocol));

  const numZones = r.u16();
  const zones: Zone[] = [];
  for (let i = 0; i < numZones; i++) {
    const zName = r.str();
    const zType = r.i32();
    const ledsMin = r.u32();
    const ledsMax = r.u32();
    const ledsCount = r.u32();
    const matrixLen = r.u16();
    let matrix: Zone['matrix'] = null;
    if (matrixLen > 0) {
      const height = r.u32();
      const width = r.u32();
      const cells: number[] = [];
      for (let c = 0; c < width * height; c++) cells.push(r.u32());
      matrix = { width, height, data: cells };
    }
    zones.push({ name: zName, type: zType, ledsMin, ledsMax, ledsCount, matrix });
  }

  const numLeds = r.u16();
  const leds: { name: string; value: number }[] = [];
  for (let i = 0; i < numLeds; i++) leds.push({ name: r.str(), value: r.u32() });

  const numColors = r.u16();
  const colors: RgbColor[] = [];
  for (let i = 0; i < numColors; i++) colors.push(r.color());

  return {
    index, type, typeName: DeviceType[type] ?? 'Unknown',
    name, vendor, description, version, serial, location,
    activeMode, modes, zones, leds, colors,
  };
}

/** Re-serialize a controller block. Only used by the round-trip test. */
export function encodeController(c: Controller, protocol: number): Buffer {
  const w = new Writer();
  w.i32(c.type);
  w.str(c.name);
  if (protocol >= 1) w.str(c.vendor);
  w.str(c.description);
  w.str(c.version);
  w.str(c.serial);
  w.str(c.location);
  w.u16(c.modes.length);
  w.i32(c.activeMode);
  for (const m of c.modes) writeMode(w, m, protocol);
  w.u16(c.zones.length);
  for (const z of c.zones) {
    w.str(z.name);
    w.i32(z.type);
    w.u32(z.ledsMin);
    w.u32(z.ledsMax);
    w.u32(z.ledsCount);
    if (z.matrix) {
      const cells = z.matrix.width * z.matrix.height;
      w.u16(8 + cells * 4);
      w.u32(z.matrix.height);
      w.u32(z.matrix.width);
      for (const v of z.matrix.data) w.u32(v);
    } else {
      w.u16(0);
    }
  }
  w.u16(c.leds.length);
  for (const l of c.leds) { w.str(l.name); w.u32(l.value); }
  w.u16(c.colors.length);
  for (const col of c.colors) w.color(col);

  const body = w.done();
  const out = Buffer.allocUnsafe(body.length + 4);
  out.writeUInt32LE(body.length + 4, 0);
  body.copy(out, 4);
  return out;
}

/* ------------------------------------------------------------------ */
/* outbound payload builders                                           */
/* ------------------------------------------------------------------ */

export function buildClientName(name: string) {
  // Raw string plus null terminator. No length prefix on this one.
  return Buffer.concat([Buffer.from(name, 'utf8'), Buffer.from([0])]);
}

export function buildProtocolVersion(version: number) {
  const b = Buffer.allocUnsafe(4);
  b.writeUInt32LE(version, 0);
  return b;
}

/**
 * RESIZEZONE payload: which zone, and how many LEDs are physically on it.
 *
 * OpenRGB cannot detect the length of an addressable strip or fan chain, so a
 * resizable zone reports a placeholder count until someone states the real
 * one. Everything past that count is simply never addressed, which presents as
 * "only some of my LEDs light up". Unlike the frame packets this is a two-word
 * payload with no leading size field.
 */
export function buildResizeZone(zoneIndex: number, ledCount: number): Buffer {
  const b = Buffer.allocUnsafe(8);
  b.writeUInt32LE(zoneIndex, 0);
  b.writeUInt32LE(ledCount, 4);
  return b;
}

/**
 * UPDATELEDS payload. `colors` is a flat Uint8Array of RGB triples, which is
 * what the frame engine produces, so no per-LED object allocation happens on
 * the hot path.
 */
export function buildUpdateLeds(rgb: Uint8Array): Buffer {
  const count = Math.floor(rgb.length / 3);
  const size = 4 + 2 + count * 4;
  const b = Buffer.allocUnsafe(size);
  b.writeUInt32LE(size, 0);
  b.writeUInt16LE(count, 4);
  let o = 6;
  for (let i = 0; i < count; i++) {
    b[o++] = rgb[i * 3];
    b[o++] = rgb[i * 3 + 1];
    b[o++] = rgb[i * 3 + 2];
    b[o++] = 0;
  }
  return b;
}

export function buildUpdateZoneLeds(zoneIndex: number, rgb: Uint8Array): Buffer {
  const count = Math.floor(rgb.length / 3);
  const size = 4 + 4 + 2 + count * 4;
  const b = Buffer.allocUnsafe(size);
  b.writeUInt32LE(size, 0);
  b.writeUInt32LE(zoneIndex, 4);
  b.writeUInt16LE(count, 8);
  let o = 10;
  for (let i = 0; i < count; i++) {
    b[o++] = rgb[i * 3];
    b[o++] = rgb[i * 3 + 1];
    b[o++] = rgb[i * 3 + 2];
    b[o++] = 0;
  }
  return b;
}

export function buildUpdateMode(modeIndex: number, mode: Mode, protocol: number): Buffer {
  const w = new Writer();
  writeMode(w, mode, protocol);
  const modeBlock = w.done();
  const size = 4 + 4 + modeBlock.length;
  const head = Buffer.allocUnsafe(8);
  head.writeUInt32LE(size, 0);
  head.writeUInt32LE(modeIndex, 4);
  return Buffer.concat([head, modeBlock]);
}

/**
 * Find the mode that accepts per-LED color, which is what we need before any
 * UPDATELEDS call will stick. OpenRGB usually names it "Direct"; some
 * controllers expose it as "Custom" instead, and a few expose neither.
 */
export function findDirectMode(c: Controller): number {
  const byName = c.modes.findIndex((m) => /^(direct|custom)$/i.test(m.name));
  if (byName >= 0) return byName;
  const byFlag = c.modes.findIndex((m) => (m.flags & ModeFlag.HAS_PER_LED_COLOR) !== 0);
  return byFlag;
}
