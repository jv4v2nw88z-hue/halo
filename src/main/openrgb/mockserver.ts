/**
 * A fake OpenRGB SDK server.
 *
 * Speaks enough of the real protocol to develop the whole app with no RGB
 * hardware, no admin rights, and no risk of writing to an I2C address you did
 * not mean to. Run it with: npm run mock
 *
 * It deliberately does two rude things that the real server also does, because
 * code that only works against a polite server does not work:
 *
 *  - Splits replies across TCP writes at arbitrary boundaries, so the client's
 *    stream framing gets exercised rather than assumed.
 *  - Pushes an unsolicited DEVICE_LIST_UPDATED a few seconds in, simulating a
 *    hotplug landing in the middle of a request.
 */

import net from 'node:net';
import {
  Packet, HEADER_SIZE, DEFAULT_PORT, decodeHeader, encodePacket,
  encodeController, type Controller, type Mode, ModeFlag,
} from './protocol.js';

const SERVER_PROTOCOL = 3;

function mode(name: string, flags = 0): Mode {
  return {
    name, value: -1, flags,
    speedMin: 0, speedMax: 100, brightnessMin: 0, brightnessMax: 100,
    colorMin: 0, colorMax: 2, speed: 50, brightness: 100,
    direction: 0, colorMode: 1, colors: [{ r: 255, g: 255, b: 255 }],
  };
}

function device(
  index: number, type: number, name: string, vendor: string,
  zones: { name: string; leds: number }[], direct = true,
): Controller {
  const total = zones.reduce((n, z) => n + z.leds, 0);
  return {
    index, type, typeName: '', name, vendor,
    description: `${vendor} ${name}`, version: '1.0', serial: `SN${index}`,
    location: `mock:${index}`,
    activeMode: 0,
    modes: direct
      ? [mode('Direct', ModeFlag.HAS_PER_LED_COLOR), mode('Rainbow', ModeFlag.HAS_SPEED)]
      : [mode('Static'), mode('Rainbow', ModeFlag.HAS_SPEED)],
    zones: zones.map((z) => ({
      name: z.name, type: 1, ledsMin: z.leds, ledsMax: z.leds, ledsCount: z.leds, matrix: null,
    })),
    leds: Array.from({ length: total }, (_, i) => ({ name: `LED ${i + 1}`, value: 0 })),
    colors: Array.from({ length: total }, () => ({ r: 0, g: 0, b: 0 })),
  };
}

/** Roughly the rig the UI was designed against. */
export const MOCK_DEVICES: Controller[] = [
  device(0, 0, 'ROG STRIX B650E-F', 'ASUS', [
    { name: 'I/O Shield', leds: 12 },
    { name: 'PCH Heatsink', leds: 8 },
    { name: 'ARGB Header 1', leds: 30 },
  ]),
  device(1, 1, 'Trident Z5 RGB', 'G.Skill', [
    { name: 'Slot A1', leds: 8 }, { name: 'Slot A2', leds: 8 },
    { name: 'Slot B1', leds: 8 }, { name: 'Slot B2', leds: 8 },
  ]),
  device(2, 2, 'TUF RTX 3070 Ti', 'ASUS', [{ name: 'Shroud Logo', leds: 6 }]),
  device(3, 3, 'H150i Elite Capellix', 'Corsair', [
    { name: 'Pump Head', leds: 33 },
    { name: 'Radiator Fan 1', leds: 8 },
    { name: 'Radiator Fan 2', leds: 8 },
    { name: 'Radiator Fan 3', leds: 8 },
  ]),
  device(4, 15, 'Uni Fan SL120 V2', 'Lian Li', [
    { name: 'Front Fan 1', leds: 8 }, { name: 'Front Fan 2', leds: 8 },
    { name: 'Front Fan 3', leds: 8 }, { name: 'Rear Exhaust', leds: 16 },
  ]),
  device(5, 5, 'K70 RGB TKL', 'Corsair', [
    { name: 'Key Matrix', leds: 87 }, { name: 'Edge Lighting', leds: 18 },
  ]),
  // No direct mode, so the "unsupported" path gets exercised in the UI.
  device(6, 6, 'G502 X Plus', 'Logitech', [
    { name: 'Logo', leds: 1 }, { name: 'Scroll Wheel', leds: 4 },
  ], false),
];

export interface MockOptions {
  port?: number;
  /** Split every reply into chunks of this size to stress the client's framing. */
  chunkSize?: number;
  /** Emit a hotplug notification after this many ms. 0 disables. */
  hotplugAfter?: number;
  quiet?: boolean;
}

export function startMockServer(opts: MockOptions = {}) {
  const {
    port = DEFAULT_PORT, chunkSize = 23, hotplugAfter = 0, quiet = false,
  } = opts;

  let framesReceived = 0;

  const server = net.createServer((sock) => {
    let inbox = Buffer.alloc(0);
    let clientName = 'unknown';
    if (!quiet) console.log('[mock] client connected');

    const reply = (deviceId: number, packetId: number, data?: Buffer) => {
      const pkt = encodePacket(deviceId, packetId, data);
      for (let i = 0; i < pkt.length; i += chunkSize) {
        sock.write(pkt.subarray(i, i + chunkSize));
      }
    };

    sock.on('data', (chunk) => {
      inbox = Buffer.concat([inbox, chunk]);
      for (;;) {
        if (inbox.length < HEADER_SIZE) return;
        const h = decodeHeader(inbox);
        if (!h) { inbox = Buffer.alloc(0); return; }
        if (inbox.length < HEADER_SIZE + h.dataSize) return;

        const body = inbox.subarray(HEADER_SIZE, HEADER_SIZE + h.dataSize);
        inbox = inbox.subarray(HEADER_SIZE + h.dataSize);

        switch (h.packetId) {
          case Packet.SET_CLIENT_NAME:
            clientName = body.toString('utf8').replace(/\0+$/, '');
            if (!quiet) console.log(`[mock] client identified as "${clientName}"`);
            break;

          case Packet.REQUEST_PROTOCOL_VERSION: {
            const b = Buffer.allocUnsafe(4);
            b.writeUInt32LE(SERVER_PROTOCOL, 0);
            reply(0, Packet.REQUEST_PROTOCOL_VERSION, b);
            break;
          }

          case Packet.REQUEST_CONTROLLER_COUNT: {
            const b = Buffer.allocUnsafe(4);
            b.writeUInt32LE(MOCK_DEVICES.length, 0);
            reply(0, Packet.REQUEST_CONTROLLER_COUNT, b);
            break;
          }

          case Packet.REQUEST_CONTROLLER_DATA: {
            const c = MOCK_DEVICES[h.deviceId];
            if (c) reply(h.deviceId, Packet.REQUEST_CONTROLLER_DATA, encodeController(c, SERVER_PROTOCOL));
            break;
          }

          case Packet.RGBCONTROLLER_UPDATELEDS: {
            framesReceived++;
            if (!quiet && framesReceived % 100 === 0) {
              const n = body.readUInt16LE(4);
              console.log(`[mock] ${framesReceived} frames received (last: device ${h.deviceId}, ${n} LEDs)`);
            }
            break;
          }

          case Packet.RGBCONTROLLER_UPDATEMODE:
          case Packet.RGBCONTROLLER_SETCUSTOMMODE:
            if (!quiet) console.log(`[mock] device ${h.deviceId} switched to direct mode`);
            break;

          default:
            if (!quiet) console.log(`[mock] ignoring packet ${h.packetId}`);
        }
      }
    });

    if (hotplugAfter > 0) {
      setTimeout(() => {
        if (!sock.destroyed) {
          if (!quiet) console.log('[mock] simulating hotplug');
          reply(0, Packet.DEVICE_LIST_UPDATED);
        }
      }, hotplugAfter);
    }

    sock.on('error', () => { /* client vanished, nothing to do */ });
    sock.on('close', () => { if (!quiet) console.log('[mock] client disconnected'); });
  });

  server.listen(port, '127.0.0.1', () => {
    if (!quiet) {
      console.log(`[mock] OpenRGB stand-in listening on 127.0.0.1:${port}`);
      console.log(`[mock] ${MOCK_DEVICES.length} devices, ${MOCK_DEVICES.reduce((n, d) => n + d.leds.length, 0)} LEDs`);
    }
  });

  return {
    server,
    get framesReceived() { return framesReceived; },
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

// Allow `node mockserver.js` to just run it.
if (process.argv[1] && process.argv[1].includes('mockserver')) {
  startMockServer({ hotplugAfter: 8000 });
}
