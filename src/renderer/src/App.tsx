import React, { useState } from 'react';
import { useHalo } from './hooks/useHalo';
import DevicesView from './views/DevicesView';
import LayoutView from './views/LayoutView';

/**
 * Shell. Two tabs, a live status line, and a notice bar for the things that
 * genuinely need saying out loud: missing SMBus permissions, hardware that
 * changed since last launch, a device with no per-LED mode.
 */

const TABS = [
  { id: 'layout', label: 'Layout' },
  { id: 'devices', label: 'Devices' },
] as const;

const STATE_COPY: Record<string, string> = {
  idle: 'Not connected',
  connecting: 'Connecting',
  connected: 'Connected',
  reconnecting: 'Reconnecting',
  failed: 'Connection failed',
};

export default function App() {
  const halo = useHalo();
  const [tab, setTab] = useState<'devices' | 'layout'>('layout');

  if (!halo.ready) {
    return <div className="app-boot">Looking for lighting hardware</div>;
  }

  const s = halo.status;
  // Read from the engine rather than tracking it here: a renderer reload used
  // to reset this to "running" while the lighting was actually paused.
  const running = s?.running ?? true;

  return (
    <div className="app">
      <style>{SHELL_CSS}</style>

      <nav className="app-nav">
        <div className="app-tabs" role="tablist" aria-label="Views">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              id={`tab-${t.id}`}
              aria-selected={tab === t.id}
              aria-controls="app-panel"
              tabIndex={tab === t.id ? 0 : -1}
              className={tab === t.id ? 'is-on' : ''}
              onClick={() => setTab(t.id)}
              onKeyDown={(e) => {
                if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
                e.preventDefault();
                const i = TABS.findIndex((x) => x.id === tab);
                const next = TABS[(i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length];
                setTab(next.id);
                document.getElementById(`tab-${next.id}`)?.focus();
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="app-status" role="status">
          <span className={`app-dot is-${s?.state ?? 'idle'}`} />
          <span>{STATE_COPY[s?.state ?? 'idle']}</span>
          {s?.state === 'connected' && (
            <span className="app-stats">
              {s.deviceCount} devices · {s.ledCount} LEDs · {s.fps} fps
              {s.droppedFrames > 0 && ` · ${s.droppedFrames} skipped`}
            </span>
          )}
        </div>

        <button
          className="app-power"
          aria-pressed={!running}
          onClick={() => void halo.setRunning(!running)}
        >
          {running ? 'Pause lighting' : 'Resume lighting'}
        </button>
      </nav>

      {halo.notice && (
        <div className="app-notice">
          <span>{halo.notice}</span>
          <button onClick={halo.dismissNotice}>Dismiss</button>
        </div>
      )}

      {s?.unsupported?.length ? (
        <div className="app-notice is-quiet">
          <span>
            No per-LED mode on {s.unsupported.join(', ')}. These will follow their own
            built-in effect instead of the layout.
          </span>
        </div>
      ) : null}

      <div
        className="app-body"
        id="app-panel"
        role="tabpanel"
        aria-labelledby={`tab-${tab}`}
      >
        {tab === 'layout'
          ? <LayoutView halo={halo} />
          : <DevicesView halo={halo} />}
      </div>
    </div>
  );
}

const SHELL_CSS = `
.app{
  --void:#0B0B0C;
  --raised:#161619;
  --raised-2:#1E1E22;
  --hairline:rgba(255,255,255,.085);
  --ink:#F5F5F7;
  --ink-2:#A8A8B0;
  /* 4.75:1 on --raised, the tightest surface it lands on. Do not darken. */
  --ink-3:#82828A;
  /* Decoration only — below AA, never use for text. */
  --ink-dim:#5A5A61;
  --danger:#FF453A;

  /* Tells the platform to render scrollbars and form controls dark. */
  color-scheme:dark;

  height:100vh;display:flex;flex-direction:column;background:var(--void);color:var(--ink);
  font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","Inter","Helvetica Neue",Arial,sans-serif;
  -webkit-font-smoothing:antialiased;letter-spacing:-0.011em;}
.app :focus-visible{outline:2px solid var(--ink);outline-offset:2px;border-radius:8px;}
.app-boot{height:100vh;display:grid;place-items:center;background:#0B0B0C;color:#82828A;font-size:14px;
  font-family:-apple-system,BlinkMacSystemFont,"Inter",sans-serif;}
.app-nav{display:flex;align-items:center;gap:18px;padding:10px 16px;
  border-bottom:1px solid var(--hairline);-webkit-app-region:drag;}
.app-nav button{-webkit-app-region:no-drag;}
.app-tabs{display:flex;gap:2px;background:var(--raised);border:1px solid var(--hairline);
  border-radius:10px;padding:3px;}
.app-tabs button{padding:6px 16px;border:none;background:none;color:var(--ink-3);font:inherit;
  font-size:13px;border-radius:8px;cursor:pointer;transition:all .2s cubic-bezier(.32,.72,0,1);}
.app-tabs button:hover{color:var(--ink-2);}
.app-tabs button.is-on{background:#2A2A2F;color:var(--ink);font-weight:500;}
.app-status{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--ink-2);}
.app-dot{width:6px;height:6px;border-radius:50%;background:var(--ink-dim);flex:0 0 auto;}
.app-dot.is-connected{background:#F5F5F7;animation:appPulse 2.4s ease-in-out infinite;}
.app-dot.is-reconnecting,.app-dot.is-connecting{background:var(--ink-2);animation:appPulse .9s ease-in-out infinite;}
.app-dot.is-failed{background:var(--danger);}
@keyframes appPulse{0%,100%{opacity:.3}50%{opacity:1}}
.app-stats{font-family:ui-monospace,"SF Mono",Menlo,monospace;font-size:11px;color:var(--ink-3);}
.app-power{margin-left:auto;padding:6px 14px;border-radius:8px;font-size:12.5px;
  background:var(--raised);border:1px solid var(--hairline);color:var(--ink-2);cursor:pointer;font:inherit;
  transition:color .2s;}
.app-power:hover{color:var(--ink);}
.app-notice{display:flex;align-items:center;gap:14px;padding:10px 16px;font-size:12.5px;
  background:var(--raised-2);border-bottom:1px solid var(--hairline);color:var(--ink);}
.app-notice.is-quiet{background:#141416;color:var(--ink-2);}
.app-notice button{margin-left:auto;background:none;border:none;color:var(--ink-2);font:inherit;
  font-size:12px;cursor:pointer;text-decoration:underline;}
.app-notice button:hover{color:var(--ink);}
.app-body{flex:1;min-height:0;overflow:hidden;}
@media (prefers-reduced-motion:reduce){
  .app *{animation-duration:.001ms !important;transition-duration:.001ms !important;}
}
`;
