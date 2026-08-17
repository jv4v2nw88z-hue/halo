import { spawn, type ChildProcess } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DEFAULT_PORT } from './openrgb/protocol.js';

/**
 * OpenRGB process management.
 *
 * The user installs one app. Whether the lighting engine is a separate binary
 * is our problem, not theirs, so we find an existing install, fall back to the
 * copy we ship, and start it headless.
 *
 * Two things to be aware of when you package this:
 *
 *  - OpenRGB is GPL-2.0. Shipping its unmodified binary alongside your own
 *    separate program is fine, but your installer must include its license text
 *    and an offer of source. Talking to it over TCP does not make your code a
 *    derivative work.
 *  - On Windows it needs administrator rights to reach SMBus devices
 *    (motherboard and DRAM). Without elevation you will still see USB
 *    peripherals and silently miss everything on the I2C bus, which looks
 *    exactly like a bug. Detect it and say so.
 */

const CANDIDATES: Record<string, string[]> = {
  win32: [
    'C:\\Program Files\\OpenRGB\\OpenRGB.exe',
    'C:\\Program Files (x86)\\OpenRGB\\OpenRGB.exe',
    path.join(os.homedir(), 'AppData', 'Local', 'OpenRGB', 'OpenRGB.exe'),
  ],
  darwin: [
    '/Applications/OpenRGB.app/Contents/MacOS/OpenRGB',
  ],
  linux: [
    '/usr/bin/openrgb',
    '/usr/local/bin/openrgb',
    '/var/lib/flatpak/exports/bin/org.openrgb.OpenRGB',
  ],
};

export function findServerBinary(explicit?: string | null): string | null {
  if (explicit && fs.existsSync(explicit)) return explicit;
  for (const c of CANDIDATES[process.platform] ?? []) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

/** Is something already listening on the SDK port? */
export function probe(host = '127.0.0.1', port = DEFAULT_PORT, timeout = 700): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      sock.destroy();
      resolve(ok);
    };
    sock.setTimeout(timeout);
    sock.once('connect', () => finish(true));
    sock.once('timeout', () => finish(false));
    sock.once('error', () => finish(false));
    sock.connect(port, host);
  });
}

export class ServerManager {
  private child: ChildProcess | null = null;
  spawned = false;

  /**
   * Returns true once the SDK port is answering, whether we started it or the
   * user already had OpenRGB running. Never starts a second instance, since two
   * processes fighting over the same I2C bus is how hardware gets confused.
   */
  async ensure(explicitPath?: string | null): Promise<{ ok: boolean; reason?: string }> {
    if (await probe()) return { ok: true };

    const bin = findServerBinary(explicitPath);
    if (!bin) {
      return {
        ok: false,
        reason: 'OpenRGB was not found. Install it, or point Halo at the binary in Settings.',
      };
    }

    this.child = spawn(bin, ['--server', '--startminimized', '--noautoconnect'], {
      detached: false,
      stdio: 'ignore',
      windowsHide: true,
    });
    this.spawned = true;

    this.child.on('exit', (code) => {
      this.child = null;
      console.warn('[server] OpenRGB exited with code', code);
    });

    // Device enumeration takes a moment on first launch, especially with SMBus
    // hardware present, so poll rather than assuming a fixed delay is enough.
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 250));
      if (await probe()) return { ok: true };
    }

    return { ok: false, reason: 'OpenRGB started but never opened the SDK port.' };
  }

  stop() {
    // Only kill what we started. If the user had OpenRGB open before us, it
    // stays open after us.
    if (this.child && this.spawned) {
      this.child.kill();
      this.child = null;
    }
  }
}
