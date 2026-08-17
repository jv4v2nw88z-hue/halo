import React, { useState, useMemo, useEffect, useCallback } from 'react';
import type { useHalo } from '../hooks/useHalo';
import type { ConflictProc } from '../../../preload/index';
import { DEVICES_CSS } from '../lib/devices.css';

/**
 * Hardware inspector.
 *
 * Deliberately not a second set of lighting controls. Once effects are driven
 * by the layout field, per-device color pickers would be a competing source of
 * truth, and the classic result is a UI where two panels disagree about what
 * your fans are doing. This view answers a different question: what did we
 * actually find, and is anything wrong with it.
 */

export default function DevicesView({ halo }: { halo: ReturnType<typeof useHalo> }) {
  const { devices, layout, status, rescan, serverPath, pickServerPath, clearServerPath, retryServer } = halo;
  const [open, setOpen] = useState<number | null>(null);

  const [conflicts, setConflicts] = useState<ConflictProc[] | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [stopping, setStopping] = useState(false);

  const scanConflicts = useCallback(async () => {
    const found = await window.halo.listConflicts();
    setConflicts(found);
    // Default to everything checked: if you opened this panel you probably do
    // want them gone, but nothing is stopped without pressing the button.
    setPicked(new Set(found.map((c) => c.pid)));
  }, []);

  useEffect(() => { void scanConflicts(); }, [scanConflicts]);

  const toggle = (pid: number) => setPicked((prev) => {
    const next = new Set(prev);
    if (next.has(pid)) next.delete(pid); else next.add(pid);
    return next;
  });

  const stopPicked = async () => {
    setStopping(true);
    try {
      await window.halo.stopConflicts([...picked]);
      await scanConflicts();
      await rescan();
    } finally { setStopping(false); }
  };

  const [retrying, setRetrying] = useState(false);
  const doRetry = async () => {
    setRetrying(true);
    try { await retryServer(); } finally { setRetrying(false); }
  };

  const [resizing, setResizing] = useState<string | null>(null);
  const resize = async (d: number, z: number, n: number) => {
    setResizing(`${d}:${z}`);
    try { await window.halo.resizeZone(d, z, n); } finally { setResizing(null); }
  };

  const placed = useMemo(() => {
    const s = new Set(layout.map((el) => `${el.deviceIndex}:${el.zoneIndex}`));
    return s;
  }, [layout]);

  const grouped = useMemo(() => {
    const m = new Map<string, typeof devices>();
    for (const d of devices) {
      if (!m.has(d.type)) m.set(d.type, []);
      m.get(d.type)!.push(d);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [devices]);

  return (
    <div className="dv-root">
      <style>{DEVICES_CSS}</style>

      <header className="dv-header">
        <div>
          <div className="dv-eyebrow">Devices</div>
          <h1 className="dv-title">Detected hardware</h1>
          <p className="dv-sub">
            Everything OpenRGB can reach on this machine, exactly as it reports itself.
          </p>
        </div>
        <button className="dv-btn" onClick={() => void rescan()}>Rescan</button>
      </header>

      {conflicts && conflicts.length > 0 && (
        <section className="dv-group">
          <div className="dv-group-title">Conflicting software</div>
          <div className="dv-conflict">
            <p className="dv-sub dv-conflict-lead">
              These are running and drive the same LEDs. Two programs writing one
              controller is why lighting flickers or snaps back to a vendor effect.
              Nothing is stopped unless you press the button.
            </p>
            <ul className="dv-conflict-list">
              {conflicts.map((c) => (
                <li key={c.pid}>
                  <label className="dv-check">
                    <input
                      type="checkbox"
                      checked={picked.has(c.pid)}
                      onChange={() => toggle(c.pid)}
                    />
                    <span className="dv-check-box" aria-hidden="true" />
                    <span className="dv-check-name">{c.app}</span>
                    <span className="dv-check-proc">{c.process}</span>
                    <span className="dv-check-pid">pid {c.pid}</span>
                  </label>
                </li>
              ))}
            </ul>
            <div className="dv-conflict-foot">
              <button
                className="dv-btn dv-btn-danger"
                disabled={!picked.size || stopping}
                onClick={() => void stopPicked()}
              >
                {stopping ? 'Stopping…' : `Stop ${picked.size} selected`}
              </button>
              <button className="dv-btn" onClick={() => void scanConflicts()}>Refresh</button>
            </div>
          </div>
        </section>
      )}

      {!devices.length && (
        <div className="dv-empty">
          <h2>Nothing found yet</h2>
          <p>
            If OpenRGB is running and you still see this, the most common cause on Windows
            is permissions: motherboard and DRAM lighting sit on the SMBus and need
            administrator rights. USB peripherals would normally still appear.
          </p>
          <button className="dv-btn" onClick={() => void rescan()}>Try again</button>
        </div>
      )}

      {grouped.map(([type, items]) => (
        <section key={type} className="dv-group">
          <div className="dv-group-title">{type}</div>

          {items.map((d) => {
            const isOpen = open === d.index;
            const unplaced = d.zones.filter((z) => !placed.has(`${d.index}:${z.index}`)).length;
            return (
              <div key={d.index} className={'dv-card' + (isOpen ? ' is-open' : '')}>
                <button
                  className="dv-card-head"
                  aria-expanded={isOpen}
                  aria-label={`${d.name} by ${d.vendor}, ${d.ledCount} LEDs in ${d.zones.length} zones`}
                  onClick={() => setOpen(isOpen ? null : d.index)}
                >
                  <div className="dv-card-id">
                    <div className="dv-name">{d.name}</div>
                    <div className="dv-vendor">{d.vendor}</div>
                  </div>
                  <div className="dv-facts">
                    <span><b>{d.ledCount}</b> LEDs</span>
                    <span><b>{d.zones.length}</b> zones</span>
                    {!d.supportsDirect && <span className="dv-warn">no direct mode</span>}
                    {unplaced > 0 && <span className="dv-warn">{unplaced} unplaced</span>}
                  </div>
                  <span className="dv-chev" aria-hidden="true">{isOpen ? '−' : '+'}</span>
                </button>

                {isOpen && (
                  <div className="dv-card-body">
                    <table className="dv-table">
                      <thead>
                        <tr><th>Zone</th><th>LEDs</th><th>Offset</th><th>Placed</th><th>Length</th></tr>
                      </thead>
                      <tbody>
                        {d.zones.map((z) => {
                          const resizable = z.ledsMax > z.ledsMin;
                          const busy = resizing === `${d.index}:${z.index}`;
                          return (
                            <tr key={z.index}>
                              <td>{z.name}</td>
                              <td>{z.ledCount}</td>
                              <td>{z.ledOffset}</td>
                              <td>{placed.has(`${d.index}:${z.index}`) ? 'Yes' : 'No'}</td>
                              <td>
                                {resizable ? (
                                  <form
                                    className="dv-resize"
                                    onSubmit={(e) => {
                                      e.preventDefault();
                                      const v = Number(new FormData(e.currentTarget).get('n'));
                                      if (Number.isFinite(v)) void resize(d.index, z.index, v);
                                    }}
                                  >
                                    <input
                                      name="n"
                                      type="number"
                                      min={z.ledsMin}
                                      max={z.ledsMax}
                                      defaultValue={z.ledCount}
                                      aria-label={`LEDs on ${z.name}`}
                                    />
                                    <button className="dv-btn" type="submit" disabled={busy}>
                                      {busy ? '…' : 'Set'}
                                    </button>
                                    <span className="dv-resize-max">max {z.ledsMax}</span>
                                  </form>
                                ) : (
                                  <span className="dv-resize-fixed">fixed</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>

                    {d.zones.some((z) => z.ledsMax > z.ledsMin) && (
                      <p className="dv-note">
                        This device has addressable channels whose length OpenRGB cannot
                        detect, so it assumes a placeholder count. Any LED past that count
                        is never written, which looks like "only part of my strip lights
                        up". Set the real number of LEDs on each channel above.
                      </p>
                    )}

                    {!d.supportsDirect && (
                      <p className="dv-note">
                        This controller does not advertise a per-LED mode, so Halo cannot
                        drive it frame by frame. It will keep running whatever effect is set
                        in its own firmware.
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </section>
      ))}

      <section className="dv-group">
        <div className="dv-group-title">OpenRGB server</div>
        <div className="dv-conflict">
          <p className="dv-sub dv-conflict-lead">
            Halo drives your hardware through OpenRGB over a local socket. If it is
            installed somewhere non-standard, point Halo at it here. Motherboard and
            DRAM lighting sit on the SMBus and need OpenRGB running as administrator.
          </p>
          <div className="dv-path">
            <span className="dv-path-value">
              {serverPath ?? 'Auto-detected (standard install locations)'}
            </span>
            <button className="dv-btn" onClick={() => void pickServerPath()}>Browse…</button>
            {serverPath && (
              <button className="dv-btn" onClick={() => void clearServerPath()}>Reset</button>
            )}
            <button className="dv-btn" disabled={retrying} onClick={() => void doRetry()}>
              {retrying ? 'Connecting…' : 'Start & connect'}
            </button>
          </div>
        </div>
      </section>

      {status && (
        <footer className="dv-foot">
          <span>Protocol {status.protocol}</span>
          <span>{status.fps} fps</span>
          <span>{status.droppedFrames} frames skipped</span>
          {status.lastError && <span className="dv-warn">{status.lastError}</span>}
        </footer>
      )}
    </div>
  );
}
