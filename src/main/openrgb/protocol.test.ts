/**
 * Round-trip checks for the wire codec. Run with: npm run test:protocol
 * No test framework, no dependencies. It either prints PASS or throws.
 */
import assert from 'node:assert';
import {
  Controller, Mode, decodeController, encodeController, decodeHeader,
  encodePacket, buildUpdateLeds, buildUpdateZoneLeds, buildUpdateMode,
  buildClientName, findDirectMode, Packet, ModeFlag, HEADER_SIZE,
} from './protocol.js';

function mode(name: string, flags = 0): Mode {
  return {
    name, value: -1, flags,
    speedMin: 0, speedMax: 100, brightnessMin: 0, brightnessMax: 100,
    colorMin: 0, colorMax: 2, speed: 50, brightness: 100,
    direction: 0, colorMode: 1,
    colors: [{ r: 255, g: 59, b: 48 }, { r: 10, g: 132, b: 255 }],
  };
}

const sample: Controller = {
  index: 3,
  type: 3,
  typeName: 'Cooler',
  name: 'Corsair H150i Elite Capellix',
  vendor: 'Corsair',
  description: 'Corsair Commander Core',
  version: '1.4.2',
  serial: '0A1B2C3D',
  location: 'HID: /dev/hidraw3',
  activeMode: 1,
  modes: [mode('Direct', ModeFlag.HAS_PER_LED_COLOR), mode('Rainbow Wave', ModeFlag.HAS_SPEED)],
  zones: [
    { name: 'Pump Head', type: 1, ledsMin: 33, ledsMax: 33, ledsCount: 33, matrix: null },
    {
      name: 'Radiator Fan 1', type: 2, ledsMin: 8, ledsMax: 8, ledsCount: 8,
      matrix: { width: 3, height: 3, data: [0, 1, 2, 3, 4, 5, 6, 7, 0xffffffff] },
    },
  ],
  leds: Array.from({ length: 41 }, (_, i) => ({ name: `LED ${i + 1}`, value: 0 })),
  colors: Array.from({ length: 41 }, () => ({ r: 12, g: 34, b: 56 })),
};

let checks = 0;
const ok = (label: string) => { checks++; console.log(`  ok  ${label}`); };

/* 1. controller block survives encode -> decode ---------------------- */
for (const protocol of [0, 1, 3]) {
  const blob = encodeController(sample, protocol);
  const back = decodeController(blob, 3, protocol);

  assert.strictEqual(back.name, sample.name);
  assert.strictEqual(back.typeName, 'Cooler');
  assert.strictEqual(back.activeMode, 1);
  assert.strictEqual(back.modes.length, 2);
  assert.strictEqual(back.modes[0].name, 'Direct');
  assert.strictEqual(back.modes[1].speed, 50);
  assert.deepStrictEqual(back.modes[0].colors, sample.modes[0].colors);
  assert.strictEqual(back.zones.length, 2);
  assert.strictEqual(back.zones[0].ledsCount, 33);
  assert.deepStrictEqual(back.zones[1].matrix, sample.zones[1].matrix);
  assert.strictEqual(back.leds.length, 41);
  assert.strictEqual(back.leds[40].name, 'LED 41');
  assert.strictEqual(back.colors.length, 41);

  // vendor only exists on protocol 1+
  assert.strictEqual(back.vendor, protocol >= 1 ? 'Corsair' : '');
  // brightness fields only exist on protocol 3+
  assert.strictEqual(back.modes[0].brightness, protocol >= 3 ? 100 : 0);

  ok(`controller round-trip at protocol ${protocol}`);
}

/* 2. the decoder consumes exactly the bytes the encoder produced ----- */
{
  const blob = encodeController(sample, 3);
  assert.strictEqual(blob.readUInt32LE(0), blob.length, 'declared size matches actual');
  ok('declared block size matches buffer length');
}

/* 3. header framing --------------------------------------------------- */
{
  const pkt = encodePacket(7, Packet.REQUEST_CONTROLLER_DATA, Buffer.from([1, 2, 3, 4]));
  const h = decodeHeader(pkt)!;
  assert.strictEqual(pkt.length, HEADER_SIZE + 4);
  assert.strictEqual(h.deviceId, 7);
  assert.strictEqual(h.packetId, Packet.REQUEST_CONTROLLER_DATA);
  assert.strictEqual(h.dataSize, 4);
  assert.strictEqual(decodeHeader(Buffer.from('NOPE________________')), null);
  ok('header encode/decode and magic rejection');
}

/* 4. UPDATELEDS layout ------------------------------------------------ */
{
  const rgb = new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255]);
  const p = buildUpdateLeds(rgb);
  assert.strictEqual(p.readUInt32LE(0), p.length);
  assert.strictEqual(p.readUInt16LE(4), 3, 'led count');
  assert.deepStrictEqual([...p.subarray(6, 10)], [255, 0, 0, 0], 'first color plus padding');
  assert.deepStrictEqual([...p.subarray(14, 18)], [0, 0, 255, 0], 'third color plus padding');
  assert.strictEqual(p.length, 4 + 2 + 3 * 4);
  ok('UPDATELEDS payload layout');
}

/* 5. UPDATEZONELEDS carries the zone index ---------------------------- */
{
  const p = buildUpdateZoneLeds(2, new Uint8Array([1, 2, 3, 4, 5, 6]));
  assert.strictEqual(p.readUInt32LE(0), p.length);
  assert.strictEqual(p.readUInt32LE(4), 2, 'zone index');
  assert.strictEqual(p.readUInt16LE(8), 2, 'led count');
  ok('UPDATEZONELEDS payload layout');
}

/* 6. UPDATEMODE re-serializes a mode the server can read back --------- */
{
  const p = buildUpdateMode(0, sample.modes[0], 3);
  assert.strictEqual(p.readUInt32LE(0), p.length);
  assert.strictEqual(p.readUInt32LE(4), 0, 'mode index');
  ok('UPDATEMODE payload layout');
}

/* 7. client name is raw, null terminated, no length prefix ------------ */
{
  const b = buildClientName('Halo');
  assert.deepStrictEqual([...b], [72, 97, 108, 111, 0]);
  ok('SET_CLIENT_NAME payload is raw and null terminated');
}

/* 8. direct-mode discovery -------------------------------------------- */
{
  assert.strictEqual(findDirectMode(sample), 0, 'finds Direct by name');

  const noDirect: Controller = {
    ...sample,
    modes: [mode('Static'), mode('Breathing', ModeFlag.HAS_PER_LED_COLOR)],
  };
  assert.strictEqual(findDirectMode(noDirect), 1, 'falls back to the per-LED flag');

  const none: Controller = { ...sample, modes: [mode('Static'), mode('Breathing')] };
  assert.strictEqual(findDirectMode(none), -1, 'reports -1 when nothing supports per-LED');
  ok('direct-mode discovery including the no-support case');
}

/* 9. empty strings and zero-length collections ------------------------ */
{
  const bare: Controller = {
    ...sample, vendor: '', serial: '', modes: [], zones: [], leds: [], colors: [], activeMode: 0,
  };
  const back = decodeController(encodeController(bare, 3), 0, 3);
  assert.strictEqual(back.serial, '');
  assert.strictEqual(back.modes.length, 0);
  assert.strictEqual(back.leds.length, 0);
  ok('empty strings and empty collections');
}

/* 10. non-ascii device names ------------------------------------------ */
{
  const utf: Controller = { ...sample, name: 'Lian Li Uni Fan · SL120 V2' };
  const back = decodeController(encodeController(utf, 3), 0, 3);
  assert.strictEqual(back.name, 'Lian Li Uni Fan · SL120 V2');
  ok('multi-byte utf-8 device names');
}

console.log(`\nPASS  ${checks} protocol checks`);
