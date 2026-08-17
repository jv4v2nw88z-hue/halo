/**
 * Integration check: the real client against the mock server, over a real
 * loopback socket. Verifies handshake, discovery, stream reframing, hotplug
 * notification, and frame writes.
 *
 * Run with: npm run test:client
 */
import assert from 'node:assert';
import { OpenRgbClient } from './client.js';
import { startMockServer, MOCK_DEVICES } from './mockserver.js';
import { buildField, renderFrame } from '../../shared/effects.js';
import { DEFAULT_EFFECT, type LayoutElement } from '../../shared/types.js';

const PORT = 16742; // not the default, so a real OpenRGB install is never touched

let checks = 0;
const ok = (label: string) => { checks++; console.log(`  ok  ${label}`); };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  // chunkSize 7 means every reply is shredded across many TCP writes, so any
  // assumption that one 'data' event equals one packet will fail loudly.
  const mock = startMockServer({ port: PORT, chunkSize: 7, hotplugAfter: 600, quiet: true });
  await wait(150);

  const client = new OpenRgbClient('127.0.0.1', PORT, 'Halo Test');

  let hotplugged = false;
  client.on('devices-changed', () => { hotplugged = true; });

  /* 1. connect and negotiate ---------------------------------------- */
  await client.connect();
  assert.strictEqual(client.state, 'connected');
  assert.strictEqual(client.protocol, 3, 'negotiated protocol version');
  ok('handshake and protocol negotiation');

  /* 2. discovery survives being split across TCP writes -------------- */
  const controllers = client.controllers;
  assert.strictEqual(controllers.length, MOCK_DEVICES.length);
  assert.strictEqual(controllers[0].name, 'ROG STRIX B650E-F');
  assert.strictEqual(controllers[0].typeName, 'Motherboard');
  assert.strictEqual(controllers[1].typeName, 'DRAM');
  assert.strictEqual(controllers[3].zones.length, 4);
  assert.strictEqual(controllers[3].leds.length, 57);
  assert.strictEqual(controllers[5].zones[0].ledsCount, 87);
  ok('device discovery through a shredded stream');

  const totalLeds = controllers.reduce((n, c) => n + c.leds.length, 0);
  assert.strictEqual(totalLeds, 295, 'total LED count across all devices');
  ok(`enumerated ${controllers.length} devices and ${totalLeds} LEDs`);

  /* 3. direct-mode detection, including the device that lacks it ----- */
  const unsupported = await client.enableDirectModeAll();
  assert.deepStrictEqual(unsupported, ['G502 X Plus'], 'reports the one device with no per-LED mode');
  ok('direct-mode enable reports unsupported hardware by name');

  /* 4. writing real frames ------------------------------------------ */
  const layout: LayoutElement[] = controllers.flatMap((c) => {
    let offset = 0;
    return c.zones.map((z, zi) => {
      const el: LayoutElement = {
        id: `${c.index}:${zi}`,
        deviceIndex: c.index, zoneIndex: zi,
        ledOffset: offset, ledCount: z.ledsCount,
        device: c.name, zone: z.name,
        shape: 'line', x: 100 + c.index * 60, y: 100 + zi * 40, rot: 0, len: 80,
      };
      offset += z.ledsCount;
      return el;
    });
  });

  const field = buildField(layout);
  assert.strictEqual(field.length, totalLeds, 'field covers every LED');

  // Normalization must span the full 0..1 range on both axes.
  const nxs = field.map((p) => p.nx);
  const nys = field.map((p) => p.ny);
  assert.ok(Math.min(...nxs) === 0 && Math.max(...nxs) === 1, 'x normalized to the placed bounding box');
  assert.ok(Math.min(...nys) === 0 && Math.max(...nys) === 1, 'y normalized to the placed bounding box');
  ok('spatial field spans the placed hardware exactly');

  const frame = new Uint8Array(field.length * 3);
  renderFrame(field, 1.7, DEFAULT_EFFECT, frame);
  assert.ok(frame.some((b) => b > 0), 'sweep produced non-black output');

  // A spatial effect must give different colors at different positions.
  const first = frame.slice(0, 3).join(',');
  const last = frame.slice(-3).join(',');
  assert.notStrictEqual(first, last, 'color varies across the field');
  ok('sweep renders a gradient across space, not a flat color');

  let sent = 0;
  for (const c of controllers) {
    const buf = new Uint8Array(c.leds.length * 3).fill(128);
    if (client.updateLeds(c.index, buf)) sent++;
  }
  assert.strictEqual(sent, controllers.length, 'every device accepted a frame');
  await wait(200);
  assert.strictEqual(mock.framesReceived, controllers.length, 'server received every frame');
  ok('frames reached the server intact');

  /* 5. unsolicited hotplug interleaved with our traffic -------------- */
  await wait(700);
  assert.ok(hotplugged, 'DEVICE_LIST_UPDATED was surfaced as an event');
  ok('unsolicited hotplug notification handled');

  /* 6. clean disconnect without a reconnect storm -------------------- */
  client.disconnect();
  await wait(300);
  assert.strictEqual(client.state, 'idle', 'explicit disconnect does not trigger reconnect');
  ok('explicit disconnect stays disconnected');

  await mock.close();
  console.log(`\nPASS  ${checks} client checks`);
}

main().catch((e) => {
  console.error('\nFAIL', e);
  process.exit(1);
});
