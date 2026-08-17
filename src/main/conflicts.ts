import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

/**
 * Other software that drives the same LEDs.
 *
 * Two programs writing the same controller is the classic cause of "half my
 * lighting ignores the app": whoever wrote last wins, so it reads as flicker
 * or as devices that snap back to a vendor effect a second after Halo sets
 * them. We only ever *list* these. Stopping one is always an explicit,
 * per-process choice made in the UI.
 *
 * OpenRGB is deliberately absent: Halo talks through it, so offering to kill
 * it would be offering to cut the branch we are sitting on.
 */
export interface ConflictProc {
  pid: number;
  process: string;
  app: string;
}

export interface StopResult {
  pid: number;
  process: string;
  ok: boolean;
  reason?: string;
}

const KNOWN: { match: RegExp; app: string }[] = [
  { match: /^lghub/i, app: 'Logitech G HUB' },
  { match: /^SteelSeries/i, app: 'SteelSeries GG' },
  { match: /^(iCUE|Corsair)/i, app: 'Corsair iCUE' },
  { match: /^SignalRgb/i, app: 'SignalRGB' },
  { match: /^(NZXT|CAM)/i, app: 'NZXT CAM' },
  { match: /^(ArmouryCrate|AsusCertService|LightingService|AuraService|RogLiveService|AacKingstonDramHal)/i, app: 'ASUS Armoury Crate / Aura' },
  { match: /^(MysticLight|MSI_?(Center|Dragon))/i, app: 'MSI Mystic Light' },
  { match: /^Razer/i, app: 'Razer Synapse' },
  { match: /^(GloriousCore|Glorious)/i, app: 'Glorious Core' },
  { match: /^Wootility/i, app: 'Wooting' },
  { match: /^(Logi|LogiOptions|LogiOverlay)/i, app: 'Logitech Options' },
  { match: /^(Fusion|GigabyteRGB|RGBFusion)/i, app: 'Gigabyte RGB Fusion' },
];

function classify(procName: string): string | null {
  const bare = procName.replace(/\.exe$/i, '');
  for (const k of KNOWN) if (k.match.test(bare)) return k.app;
  return null;
}

/** Everything currently running that is known to drive RGB hardware. */
export async function listConflicts(): Promise<ConflictProc[]> {
  const found: ConflictProc[] = [];
  try {
    if (process.platform === 'win32') {
      const { stdout } = await run('tasklist', ['/FO', 'CSV', '/NH'], { windowsHide: true, maxBuffer: 4 << 20 });
      for (const line of stdout.split(/\r?\n/)) {
        const m = /^"([^"]+)","(\d+)"/.exec(line.trim());
        if (!m) continue;
        const app = classify(m[1]);
        if (app) found.push({ pid: Number(m[2]), process: m[1].replace(/\.exe$/i, ''), app });
      }
    } else {
      const { stdout } = await run('ps', ['-eo', 'pid=,comm='], { maxBuffer: 4 << 20 });
      for (const line of stdout.split('\n')) {
        const m = /^\s*(\d+)\s+(.+)$/.exec(line);
        if (!m) continue;
        const name = m[2].split('/').pop() ?? m[2];
        const app = classify(name);
        if (app) found.push({ pid: Number(m[1]), process: name, app });
      }
    }
  } catch {
    return [];
  }
  return found.sort((a, b) => a.app.localeCompare(b.app) || a.process.localeCompare(b.process));
}

/**
 * Stop the given pids. Reports per process rather than throwing, because a
 * partial result is the normal case: vendor suites keep a watchdog service
 * running as SYSTEM that an unelevated Halo cannot touch, and the user needs
 * to see exactly which ones survived.
 */
export async function stopConflicts(pids: number[]): Promise<StopResult[]> {
  const running = await listConflicts();
  const byPid = new Map(running.map((p) => [p.pid, p]));
  const out: StopResult[] = [];

  for (const pid of pids) {
    const proc = byPid.get(pid);
    // Only ever stop something we independently re-confirmed is a known RGB
    // process. A stale pid from the UI must never become an arbitrary kill.
    if (!proc) {
      out.push({ pid, process: String(pid), ok: false, reason: 'no longer running, or not a known RGB process' });
      continue;
    }
    try {
      if (process.platform === 'win32') {
        await run('taskkill', ['/PID', String(pid), '/F'], { windowsHide: true });
      } else {
        process.kill(pid, 'SIGTERM');
      }
      out.push({ pid, process: proc.process, ok: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      out.push({
        pid,
        process: proc.process,
        ok: false,
        reason: /access is denied/i.test(msg)
          ? 'access denied — runs as a service, needs an elevated Halo'
          : msg.split('\n')[0],
      });
    }
  }
  return out;
}
