# Halo

RGB lighting control with spatial effects, built on the OpenRGB SDK.

Effects are driven by where your hardware physically sits, not by the order
OpenRGB happened to enumerate it. A sweep set to 0° enters at your front fans,
crosses the pump, hits the RAM, and exits at the I/O shield. Move a fan on the
canvas and the wave finds it.

## Getting started

```bash
npm install
npm run mock      # fake OpenRGB server, no hardware needed
npm run dev       # in a second terminal
npm test          # 21 checks across the codec and the socket client
```

`npm run mock` stands up a stand-in server on port 6742 with seven fake devices
and 295 LEDs. It shreds its replies across small TCP writes on purpose, so
anything that only works against a polite server fails immediately. Develop the
entire app against it: no admin rights, no risk of writing to an I2C address you
did not mean to.

## Architecture

```
OpenRGB (headless, port 6742)
   ▲ TCP, binary protocol
   │
main process ──── engine (40fps) ──── rate limit ──── socket writes
   │                  │
   │                  └── preview @20fps
   ▼ IPC (contextBridge)
renderer ──── LayoutView, DevicesView
```

**The engine lives in main, not in the renderer.** Lighting keeps running when
the window is closed to the tray, and your hardware never depends on a React
tree being mounted. The renderer receives a preview copy of the exact bytes that
went out over the socket, so the canvas cannot drift from reality.

| Path | What it does |
| --- | --- |
| `src/main/openrgb/protocol.ts` | Wire format: headers, controller blocks, frame payloads |
| `src/main/openrgb/client.ts` | Socket, stream reframing, version negotiation, reconnect |
| `src/main/openrgb/mockserver.ts` | Fake server for development |
| `src/main/engine.ts` | Frame loop, rate limiting, dirty checking, backpressure |
| `src/main/autolayout.ts` | First-run placement and hardware reconciliation |
| `src/shared/effects.ts` | Geometry and the spatial field, shared by main and renderer |
| `src/renderer/src/hooks/useHalo.ts` | The one seam between UI and hardware |

## The spatial field

Every effect is one function:

```ts
sampleField(nx, ny, t, cfg, out, at)
```

Normalized position in, RGB out. Adding an effect is one `case` block and
touches no device code. Normalization runs against the bounding box of
everything actually placed, not the canvas, so moving all your gear into one
corner compresses the effect to fit rather than leaving dead space.

`src/shared/effects.ts` is imported by both processes. One implementation means
the preview and the output cannot disagree.

## Things that will bite you

**Direct mode.** `UPDATELEDS` is silently ignored on most hardware unless the
controller is first switched to its per-LED mode. OpenRGB usually names it
"Direct", sometimes "Custom", and some controllers have neither.
`findDirectMode()` checks name then the `HAS_PER_LED_COLOR` flag, and the engine
reports anything with no support by name so the UI can say so out loud instead
of appearing broken.

**Write rates.** SMBus motherboards and DRAM visibly stutter above roughly 30
updates per second. USB peripherals take far more. The engine gives each device
its own budget by bus type, skips writes when nothing changed, and drops frames
rather than queueing them when the socket has not drained. A queued lighting
frame is worthless by the time it lands.

**Windows permissions.** Motherboard and DRAM lighting sit on the SMBus and need
administrator rights. Without elevation you see USB peripherals, miss everything
on I2C, and it looks exactly like a bug. `package.json` sets
`requestedExecutionLevel: requireAdministrator`, and the app also detects the
symptom at runtime and explains it.

**TCP is a stream.** One `data` event can carry half a packet, three packets, or
a packet split across events. OpenRGB also pushes `DEVICE_LIST_UPDATED`
unprompted on hotplug, interleaved with replies to your own requests, which is
why request matching is by packet id rather than arrival order.

**Device indices are not stable.** Unplug a keyboard and everything after it
shifts. `reconcileLayout()` matches saved placements on device name plus zone
name, keeps your arrangement, and auto-places anything new.

## Licensing

Halo talks to OpenRGB over a TCP socket and links none of its code, so this
project carries no GPL obligation and can be licensed however you like.

OpenRGB itself is GPL-2.0-or-later. If you bundle its binary in your installer,
include its license text and a written offer of source in
`resources/licenses/`. Shipping an unmodified upstream binary alongside a
separate program is the ordinary case here, not a grey area.

One thing worth repeating from upstream: OpenRGB drives hardware using reverse
engineered protocols, and devices have been bricked in the past. That risk
transfers to anything built on it. Say so in your own installer.
