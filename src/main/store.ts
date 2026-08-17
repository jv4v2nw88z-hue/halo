import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { EffectConfig, LayoutElement, OverrideMap } from '../shared/types.js';
import { DEFAULT_EFFECT } from '../shared/types.js';

export interface Profile { name: string; cfg: EffectConfig }

export interface Persisted {
  version: 1;
  layout: LayoutElement[];
  cfg: EffectConfig;
  overrides: OverrideMap;
  profiles: Profile[];
  launchOnStartup: boolean;
  serverPath: string | null;
}

const EMPTY: Persisted = {
  version: 1,
  layout: [],
  cfg: DEFAULT_EFFECT,
  overrides: {},
  profiles: [],
  launchOnStartup: false,
  serverPath: null,
};

/**
 * Flat JSON on disk. Writes are atomic via a temp file and rename, because the
 * one guaranteed way to lose a layout someone spent twenty minutes arranging is
 * to be halfway through a write when the process dies.
 */
export class Store {
  private file: string;
  private data: Persisted;
  private writeTimer: NodeJS.Timeout | null = null;

  constructor() {
    this.file = path.join(app.getPath('userData'), 'halo.json');
    this.data = this.read();
  }

  private read(): Persisted {
    try {
      const raw = fs.readFileSync(this.file, 'utf8');
      const parsed = JSON.parse(raw) as Persisted;
      if (parsed.version !== 1) return { ...EMPTY };
      return { ...EMPTY, ...parsed, cfg: { ...DEFAULT_EFFECT, ...parsed.cfg } };
    } catch {
      return { ...EMPTY };
    }
  }

  /** Coalesces rapid writes during a drag into a single flush. */
  private schedule() {
    if (this.writeTimer) clearTimeout(this.writeTimer);
    this.writeTimer = setTimeout(() => this.flush(), 400);
  }

  flush() {
    if (this.writeTimer) { clearTimeout(this.writeTimer); this.writeTimer = null; }
    const tmp = this.file + '.tmp';
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
      fs.renameSync(tmp, this.file);
    } catch (e) {
      console.error('[store] write failed', e);
    }
  }

  get all() { return this.data; }
  get layout() { return this.data.layout; }
  get cfg() { return this.data.cfg; }
  get overrides() { return this.data.overrides; }
  get profiles() { return this.data.profiles; }
  get serverPath() { return this.data.serverPath; }
  get launchOnStartup() { return this.data.launchOnStartup; }

  setLayout(layout: LayoutElement[]) { this.data.layout = layout; this.schedule(); }
  setCfg(cfg: EffectConfig) { this.data.cfg = cfg; this.schedule(); }
  setOverrides(o: OverrideMap) { this.data.overrides = o; this.schedule(); }
  setServerPath(p: string | null) { this.data.serverPath = p; this.schedule(); }
  setLaunchOnStartup(v: boolean) { this.data.launchOnStartup = v; this.schedule(); }

  saveProfile(name: string, cfg: EffectConfig) {
    const i = this.data.profiles.findIndex((p) => p.name === name);
    if (i >= 0) this.data.profiles[i] = { name, cfg };
    else this.data.profiles.push({ name, cfg });
    this.schedule();
  }

  deleteProfile(name: string) {
    this.data.profiles = this.data.profiles.filter((p) => p.name !== name);
    this.schedule();
  }
}
