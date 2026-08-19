import { useEffect, useRef, useState, useCallback } from 'react';
import type {
  DeviceSummary, EffectConfig, EngineStatus, LayoutElement, OverrideMap,
} from '../../../shared/types';

/**
 * The single seam between the UI and real hardware.
 *
 * Both view components were built against mock data with exactly this shape,
 * so wiring them up is a matter of deleting their local state and calling this
 * instead. Nothing else in either file changes.
 *
 * Preview frames deliberately do NOT live in React state. They arrive 20 times
 * a second and re-rendering a tree on every one of them would burn a core for
 * no reason. They land in a ref, and the canvas reads that ref from its own
 * animation loop.
 */

declare global {
  interface Window {
    halo: import('../../../preload/index').HaloApi;
  }
}

export interface HaloState {
  ready: boolean;
  devices: DeviceSummary[];
  layout: LayoutElement[];
  cfg: EffectConfig | null;
  status: EngineStatus | null;
  overrides: OverrideMap;
  serverPath: string | null;
  profiles: { name: string; cfg: EffectConfig }[];
  notice: string | null;
}

export function useHalo() {
  const [state, setState] = useState<HaloState>({
    ready: false, devices: [], layout: [], cfg: null,
    status: null, overrides: {}, serverPath: null, profiles: [], notice: null,
  });

  /** Latest preview frame, flat RGB triples in layout order. Read, never watched. */
  const frameRef = useRef<Uint8Array>(new Uint8Array(0));

  useEffect(() => {
    let alive = true;

    window.halo.getState().then((s) => {
      if (!alive) return;
      setState({
        ready: true,
        devices: s.devices,
        layout: s.layout,
        cfg: s.cfg,
        status: s.status,
        overrides: s.overrides ?? {},
        serverPath: s.serverPath ?? null,
        profiles: s.profiles,
        notice: null,
      });
    });

    const offs = [
      window.halo.onDevices((devices) => setState((p) => ({ ...p, devices }))),
      window.halo.onLayout((layout) => setState((p) => ({ ...p, layout }))),
      window.halo.onStatus((status) => setState((p) => ({ ...p, status }))),
      window.halo.onNotice((notice) => setState((p) => ({ ...p, notice }))),
      window.halo.onOverrides((overrides) => setState((p) => ({ ...p, overrides }))),
      window.halo.onConfig((cfg) => setState((p) => ({ ...p, cfg }))),
      window.halo.onPreview((f) => { frameRef.current = f.rgb; }),
    ];

    return () => { alive = false; offs.forEach((off) => off()); };
  }, []);

  /* ---------------------------------------------------------------- */

  /**
   * Layout writes are optimistic. The drag stays at 60fps locally and the main
   * process catches up, rather than every pointermove waiting on an IPC round
   * trip.
   */
  const fail = (what: string) => (e: unknown) =>
    setState((p) => ({ ...p, notice: `${what} failed: ${e instanceof Error ? e.message : String(e)}` }));

  const setLayout = useCallback((layout: LayoutElement[]) => {
    setState((p) => ({ ...p, layout }));
    window.halo.setLayout(layout).catch(fail('Saving the layout'));
  }, []);

  const setConfig = useCallback((patch: Partial<EffectConfig>) => {
    setState((p) => (p.cfg ? { ...p, cfg: { ...p.cfg, ...patch } } : p));
    window.halo.setConfig(patch).catch(fail('Changing the effect'));
  }, []);

  const autoArrange = useCallback(async () => {
    const layout = await window.halo.autoLayout();
    setState((p) => ({ ...p, layout }));
  }, []);

  const rescan = useCallback(async () => {
    const devices = await window.halo.rescan();
    setState((p) => ({ ...p, devices }));
  }, []);

  const setRunning = useCallback((run: boolean) => window.halo.setRunning(run), []);

  const saveProfile = useCallback(async (name: string) => {
    const profiles = await window.halo.saveProfile(name);
    setState((p) => ({ ...p, profiles }));
  }, []);

  const loadProfile = useCallback(async (name: string) => {
    const cfg = await window.halo.loadProfile(name);
    if (cfg) setState((p) => ({ ...p, cfg }));
  }, []);

  const deleteProfile = useCallback(async (name: string) => {
    const profiles = await window.halo.deleteProfile(name);
    setState((p) => ({ ...p, profiles }));
  }, []);

  /** Targeted colour control. `patch: null` drops the override entirely. */
  const setOverride = useCallback(async (key: string, patch: Partial<EffectConfig> | null) => {
    const overrides = await window.halo.setOverride(key, patch);
    setState((p) => ({ ...p, overrides }));
  }, []);

  const clearOverrides = useCallback(async () => {
    const overrides = await window.halo.clearOverrides();
    setState((p) => ({ ...p, overrides }));
  }, []);

  const pickServerPath = useCallback(async () => {
    const serverPath = await window.halo.pickServerPath();
    setState((p) => ({ ...p, serverPath }));
  }, []);

  const clearServerPath = useCallback(async () => {
    await window.halo.clearServerPath();
    setState((p) => ({ ...p, serverPath: null }));
  }, []);

  const retryServer = useCallback(() => window.halo.retryServer(), []);

  const dismissNotice = useCallback(() => setState((p) => ({ ...p, notice: null })), []);

  return {
    ...state,
    frameRef,
    setLayout, setConfig, autoArrange, rescan, setRunning,
    saveProfile, loadProfile, deleteProfile, dismissNotice,
    setOverride, clearOverrides,
    pickServerPath, clearServerPath, retryServer,
  };
}

/**
 * Paint LED nodes from live hardware frames.
 *
 * Drop this into the layout canvas in place of its local rAF loop. The visual
 * result is identical, except the colors are now the exact bytes that went out
 * over the socket rather than a second, separately computed simulation.
 */
export function usePreviewPaint(
  svgRef: React.RefObject<SVGSVGElement>,
  frameRef: React.RefObject<Uint8Array>,
  ledCount: number,
) {
  useEffect(() => {
    if (!svgRef.current) return;
    const nodes = Array.from(svgRef.current.querySelectorAll<SVGCircleElement>('.hl-led'));
    let raf = 0;

    const loop = () => {
      const rgb = frameRef.current;
      if (!rgb) { raf = requestAnimationFrame(loop); return; }
      const n = Math.min(nodes.length, rgb.length / 3);
      for (let i = 0; i < n; i++) {
        const r = rgb[i * 3], g = rgb[i * 3 + 1], b = rgb[i * 3 + 2];
        nodes[i].setAttribute('fill', `rgb(${r},${g},${b})`);
        const lum = (r * 0.3 + g * 0.6 + b * 0.1) / 255;
        nodes[i].setAttribute('r', (2.6 + lum * 1.6).toFixed(2));
      }
      raf = requestAnimationFrame(loop);
    };

    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [svgRef, frameRef, ledCount]);
}
