import { contextBridge, ipcRenderer } from 'electron';
import type {
  DeviceSummary, EffectConfig, EngineStatus, LayoutElement, OverrideMap,
} from '../shared/types.js';

export interface ConflictProc { pid: number; process: string; app: string }
export interface StopResult { pid: number; process: string; ok: boolean; reason?: string }

/**
 * The only surface the renderer gets.
 *
 * contextIsolation is on and nodeIntegration is off, so the UI cannot touch
 * sockets, the filesystem, or child processes. Everything goes through these
 * named channels, which also means the whole privileged surface of the app is
 * one readable list rather than something scattered through the UI.
 */

export interface Profile { name: string; cfg: EffectConfig }

export interface HaloApi {
  getState(): Promise<{
    devices: DeviceSummary[];
    layout: LayoutElement[];
    cfg: EffectConfig;
    serverPath: string | null;
    overrides: OverrideMap;
    profiles: Profile[];
    status: EngineStatus;
  }>;
  setLayout(layout: LayoutElement[]): Promise<boolean>;
  setConfig(cfg: Partial<EffectConfig>): Promise<EffectConfig>;
  autoLayout(): Promise<LayoutElement[]>;
  setRunning(run: boolean): Promise<boolean>;
  rescan(): Promise<DeviceSummary[]>;
  saveProfile(name: string): Promise<Profile[]>;
  loadProfile(name: string): Promise<EffectConfig | null>;
  deleteProfile(name: string): Promise<Profile[]>;
  setServerPath(p: string | null): Promise<boolean>;

  pickServerPath(): Promise<string | null>;
  clearServerPath(): Promise<null>;
  retryServer(): Promise<{ ok: boolean; reason?: string }>;
  setOverride(key: string, patch: Partial<EffectConfig> | null): Promise<OverrideMap>;
  clearOverrides(): Promise<OverrideMap>;
  listConflicts(): Promise<ConflictProc[]>;
  stopConflicts(pids: number[]): Promise<StopResult[]>;
  resizeZone(deviceIndex: number, zoneIndex: number, ledCount: number): Promise<{ ok: boolean; reason?: string }>;

  onDevices(cb: (d: DeviceSummary[]) => void): () => void;
  onLayout(cb: (l: LayoutElement[]) => void): () => void;
  onStatus(cb: (s: EngineStatus) => void): () => void;
  onPreview(cb: (f: { t: number; rgb: Uint8Array }) => void): () => void;
  onNotice(cb: (msg: string) => void): () => void;
  onOverrides(cb: (o: OverrideMap) => void): () => void;
}

function subscribe(channel: string, cb: (payload: any) => void) {
  const handler = (_e: unknown, payload: any) => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.off(channel, handler);
}

const api: HaloApi = {
  getState: () => ipcRenderer.invoke('halo:getState'),
  setLayout: (layout) => ipcRenderer.invoke('halo:setLayout', layout),
  setConfig: (cfg) => ipcRenderer.invoke('halo:setConfig', cfg),
  autoLayout: () => ipcRenderer.invoke('halo:autoLayout'),
  setRunning: (run) => ipcRenderer.invoke('halo:setRunning', run),
  rescan: () => ipcRenderer.invoke('halo:rescan'),
  saveProfile: (name) => ipcRenderer.invoke('halo:saveProfile', name),
  loadProfile: (name) => ipcRenderer.invoke('halo:loadProfile', name),
  deleteProfile: (name) => ipcRenderer.invoke('halo:deleteProfile', name),
  setServerPath: (p) => ipcRenderer.invoke('halo:setServerPath', p),

  pickServerPath: () => ipcRenderer.invoke('halo:pickServerPath'),
  clearServerPath: () => ipcRenderer.invoke('halo:clearServerPath'),
  retryServer: () => ipcRenderer.invoke('halo:retryServer'),
  setOverride: (key, patch) => ipcRenderer.invoke('halo:setOverride', key, patch),
  clearOverrides: () => ipcRenderer.invoke('halo:clearOverrides'),
  listConflicts: () => ipcRenderer.invoke('halo:listConflicts'),
  stopConflicts: (pids) => ipcRenderer.invoke('halo:stopConflicts', pids),
  resizeZone: (d, z, n) => ipcRenderer.invoke('halo:resizeZone', d, z, n),

  onDevices: (cb) => subscribe('halo:devices', cb),
  onLayout: (cb) => subscribe('halo:layout', cb),
  onStatus: (cb) => subscribe('halo:status', cb),
  onPreview: (cb) => subscribe('halo:preview', (f) => cb({ t: f.t, rgb: new Uint8Array(f.rgb) })),
  onNotice: (cb) => subscribe('halo:notice', cb),
  onOverrides: (cb) => subscribe('halo:overrides', cb),
};

contextBridge.exposeInMainWorld('halo', api);
