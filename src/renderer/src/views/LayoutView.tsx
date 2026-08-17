import React, { useRef, useState, useCallback, useMemo } from 'react';
import { elementLeds } from '../../../shared/effects';
import type { LayoutElement, EffectId, EffectConfig } from '../../../shared/types';
import { overrideKey, resolveConfig } from '../../../shared/types';
import { usePreviewPaint, type useHalo } from '../hooks/useHalo';
import { Slider, Segmented, ColorPicker } from '../lib/controls';
import { LAYOUT_CSS } from '../lib/layout.css';

type Scope = 'all' | 'device' | 'zone' | 'led';

const VB_W = 960;
const VB_H = 600;

/**
 * Solid leads because it is the "make the whole rig one colour" answer, and it
 * is the only entry that ignores motion entirely.
 */
const EFFECTS: { id: EffectId; label: string }[] = [
  { id: 'solid', label: 'Solid' },
  { id: 'sweep', label: 'Sweep' },
  { id: 'ripple', label: 'Ripple' },
  { id: 'spin', label: 'Spin' },
  { id: 'rain', label: 'Rain' },
  { id: 'plasma', label: 'Plasma' },
];

const DIRECTION = (a: number) =>
  a === 0 ? 'Front to rear' : a === 90 ? 'Top to bottom'
  : a === 180 ? 'Rear to front' : a === 270 ? 'Bottom to top' : 'Diagonal';

export default function LayoutView({ halo }: { halo: ReturnType<typeof useHalo> }) {
  const {
    layout, cfg, setLayout, setConfig, autoArrange, frameRef,
    profiles, saveProfile, loadProfile, deleteProfile,
    overrides, setOverride,
  } = halo;

  const [selected, setSelected] = useState<string | null>(null);
  const [selectedLed, setSelectedLed] = useState<number | null>(null);
  const [scope, setScope] = useState<Scope>('all');
  const [snap, setSnap] = useState(true);
  const [guides, setGuides] = useState(true);
  const [draftName, setDraftName] = useState('');

  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{ id: string; dx: number; dy: number } | null>(null);
  const movedRef = useRef(false);

  const ledTotal = useMemo(
    () => layout.reduce((n, el) => n + el.ledCount, 0),
    [layout],
  );

  // Paint from the frames the main process actually sent to hardware. The
  // preview cannot drift from reality because it IS reality.
  usePreviewPaint(svgRef, frameRef, ledTotal);

  const toSvg = useCallback((cx: number, cy: number) => {
    const r = svgRef.current!.getBoundingClientRect();
    const s = Math.min(r.width / VB_W, r.height / VB_H);
    return {
      x: (cx - r.left - (r.width - VB_W * s) / 2) / s,
      y: (cy - r.top - (r.height - VB_H * s) / 2) / s,
    };
  }, []);

  const onDown = (e: React.PointerEvent, el: LayoutElement) => {
    e.stopPropagation();
    svgRef.current!.setPointerCapture(e.pointerId);
    const p = toSvg(e.clientX, e.clientY);
    dragRef.current = { id: el.id, dx: p.x - el.x, dy: p.y - el.y };
    movedRef.current = false;
    setSelected(el.id);
  };

  const onMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    movedRef.current = true;
    const p = toSvg(e.clientX, e.clientY);
    let x = p.x - d.dx;
    let y = p.y - d.dy;
    if (snap) { x = Math.round(x / 10) * 10; y = Math.round(y / 10) * 10; }
    x = Math.max(12, Math.min(VB_W - 12, x));
    y = Math.max(12, Math.min(VB_H - 12, y));
    setLayout(layout.map((el) => (el.id === d.id ? { ...el, x, y } : el)));
  };

  const onUp = (e: React.PointerEvent) => {
    if (dragRef.current) svgRef.current!.releasePointerCapture(e.pointerId);
    dragRef.current = null;
  };

  const patchSel = (changes: Partial<LayoutElement>) =>
    setLayout(layout.map((el) => (el.id === selected ? { ...el, ...changes } : el)));

  /** Keyboard equivalent of dragging: arrows nudge, shift+arrow moves by ten. */
  const onZoneKey = (e: React.KeyboardEvent, el: LayoutElement) => {
    const step = e.shiftKey ? 10 : 1;
    const delta: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0], ArrowRight: [step, 0],
      ArrowUp: [0, -step], ArrowDown: [0, step],
    };
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setSelected(el.id);
      return;
    }
    const d = delta[e.key];
    if (!d) return;
    e.preventDefault();
    setSelected(el.id);
    const x = Math.max(12, Math.min(VB_W - 12, el.x + d[0]));
    const y = Math.max(12, Math.min(VB_H - 12, el.y + d[1]));
    setLayout(layout.map((it) => (it.id === el.id ? { ...it, x, y } : it)));
  };

  const sel = layout.find((el) => el.id === selected) ?? null;

  /* --- what am I editing? ------------------------------------------ */

  // Scopes only exist when something is selected to hang them on.
  const scopeOptions: { id: Scope; label: string }[] = [
    { id: 'all', label: 'All' },
    ...(sel ? [{ id: 'device' as Scope, label: 'Device' }, { id: 'zone' as Scope, label: 'Zone' }] : []),
    ...(sel && selectedLed !== null ? [{ id: 'led' as Scope, label: 'LED' }] : []),
  ];
  const activeScope: Scope = scopeOptions.some((o) => o.id === scope) ? scope : 'all';

  const targetKey =
    activeScope === 'device' && sel ? overrideKey.device(sel.device)
    : activeScope === 'zone' && sel ? overrideKey.zone(sel.device, sel.zone)
    : activeScope === 'led' && sel && selectedLed !== null ? overrideKey.led(sel.device, selectedLed)
    : null;

  /** The config the panel should display: everything inherited, then this level. */
  const shown: EffectConfig | null = !cfg ? null : (() => {
    if (!sel || activeScope === 'all') return cfg;
    const d = overrides[overrideKey.device(sel.device)];
    const z = overrides[overrideKey.zone(sel.device, sel.zone)];
    if (activeScope === 'device') return { ...cfg, ...d };
    if (activeScope === 'zone') return { ...cfg, ...d, ...z };
    return resolveConfig(cfg, overrides, sel.device, sel.zone, selectedLed ?? -1);
  })();

  /** Writes land on the global config or on the targeted override. */
  const apply = (patch: Partial<EffectConfig>) => {
    if (targetKey === null) setConfig(patch);
    else void setOverride(targetKey, patch);
  };

  const scopeLabel =
    activeScope === 'all' ? 'every device'
    : activeScope === 'device' ? sel?.device
    : activeScope === 'zone' ? sel?.zone
    : `LED ${selectedLed} of ${sel?.zone}`;

  const isSolid = shown?.effect === 'solid';

  const grouped = useMemo(() => {
    const m = new Map<string, LayoutElement[]>();
    for (const el of layout) {
      if (!m.has(el.device)) m.set(el.device, []);
      m.get(el.device)!.push(el);
    }
    return [...m.entries()];
  }, [layout]);

  if (!cfg || !shown) return null;

  return (
    <div className="hl-root">
      <style>{LAYOUT_CSS}</style>

      <div className="hl-stage">
        <header className="hl-header">
          <div>
            <div className="hl-eyebrow">Layout</div>
            <h1 className="hl-title">Physical arrangement</h1>
            <p className="hl-sub">
              Drag each zone to where it sits in your rig. Effects read those coordinates,
              so a sweep travels across the case instead of down a device list.
            </p>
          </div>
          <div className="hl-count">
            <span className="hl-count-n">{ledTotal}</span>
            <span className="hl-count-l">LEDs mapped</span>
          </div>
        </header>

        <div className="hl-canvas-wrap">
          <svg
            ref={svgRef}
            className="hl-canvas"
            viewBox={`0 0 ${VB_W} ${VB_H}`}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
            onPointerDown={() => { setSelected(null); setSelectedLed(null); }}
          >
            <defs>
              <pattern id="hlGrid" width="20" height="20" patternUnits="userSpaceOnUse">
                <path d="M20 0 L0 0 0 20" fill="none" stroke="rgba(255,255,255,.035)" strokeWidth="1" />
              </pattern>
            </defs>

            {guides && <rect width={VB_W} height={VB_H} fill="url(#hlGrid)" />}
            {guides && (
              <>
                <rect x="40" y="36" width="520" height="528" rx="18" className="hl-region" />
                <text x="58" y="60" className="hl-region-label">CASE INTERIOR</text>
                <rect x="596" y="36" width="324" height="528" rx="18" className="hl-region" />
                <text x="614" y="60" className="hl-region-label">DESK</text>
              </>
            )}

            {layout.map((el) => {
              const pts = elementLeds(el);
              const xs = pts.map((p) => p.x);
              const ys = pts.map((p) => p.y);
              const pad = 11;
              return (
                <g
                  key={el.id}
                  className={'hl-el' + (el.id === selected ? ' is-selected' : '')}
                  onPointerDown={(e) => onDown(e, el)}
                  tabIndex={0}
                  role="button"
                  aria-label={`${el.zone} on ${el.device}, ${el.ledCount} LEDs, at ${Math.round(el.x)}, ${Math.round(el.y)}`}
                  onKeyDown={(e) => onZoneKey(e, el)}
                  onFocus={() => setSelected(el.id)}
                >
                  {el.shape === 'ring' ? (
                    <circle cx={el.x} cy={el.y} r={(el.r ?? 30) + 9} className="hl-hit" />
                  ) : (
                    <rect
                      x={Math.min(...xs) - pad}
                      y={Math.min(...ys) - pad}
                      width={Math.max(...xs) - Math.min(...xs) + pad * 2}
                      height={Math.max(...ys) - Math.min(...ys) + pad * 2}
                      rx={8}
                      className="hl-hit"
                    />
                  )}
                  {el.shape === 'ring' && (
                    <circle cx={el.x} cy={el.y} r={el.r ?? 30} className="hl-ring-guide" />
                  )}
                  {pts.map((p, i) => {
                    const ledIndex = el.ledOffset + i;
                    const isPinned = !!overrides[overrideKey.led(el.device, ledIndex)];
                    const isPicked = el.id === selected && selectedLed === ledIndex;
                    return (
                      <circle
                        key={i}
                        className={
                          'hl-led'
                          + (isPinned ? ' is-pinned' : '')
                          + (isPicked ? ' is-picked' : '')
                        }
                        cx={p.x}
                        cy={p.y}
                        r={3}
                        fill="#222"
                        onClick={(e) => {
                          // A drag ends in a click too; only a still pointer selects.
                          if (movedRef.current) return;
                          e.stopPropagation();
                          setSelected(el.id);
                          setSelectedLed(ledIndex);
                          setScope('led');
                        }}
                      />
                    );
                  })}
                </g>
              );
            })}
          </svg>

          <div className="hl-canvas-foot">
            <button className={'hl-toggle' + (snap ? ' is-on' : '')} onClick={() => setSnap((v) => !v)}>
              Snap to grid
            </button>
            <button className={'hl-toggle' + (guides ? ' is-on' : '')} onClick={() => setGuides((v) => !v)}>
              Guides
            </button>
            <button className="hl-toggle" onClick={() => { setSelected(null); void autoArrange(); }}>
              Auto arrange
            </button>
          </div>
        </div>
      </div>

      <aside className="hl-rail">
        <div className="hl-card">
          <div className="hl-card-title">Applies to</div>
          <Segmented
            block
            label="Target"
            options={scopeOptions}
            value={activeScope}
            onChange={(v) => setScope(v as Scope)}
          />
          <div className="hl-scope-line">
            <span className="hl-scope-what">{scopeLabel}</span>
            {targetKey && overrides[targetKey] && (
              <button
                className="hl-scope-reset"
                onClick={() => void setOverride(targetKey, null)}
              >
                Reset to inherited
              </button>
            )}
          </div>
          {targetKey && !overrides[targetKey] && (
            <p className="hl-note hl-note-inline">
              Following the level above. Changing anything here detaches just this
              {activeScope === 'device' ? ' device' : activeScope === 'zone' ? ' zone' : ' LED'}.
            </p>
          )}

          <div className="hl-card-title hl-card-title-sub">Effect</div>
          <Segmented
            block
            columns={3}
            label="Effect"
            options={EFFECTS}
            value={shown.effect}
            onChange={(effect) => apply({ effect: effect as EffectId })}
          />

          {isSolid && activeScope === 'all' && (
            <p className="hl-note hl-note-inline">
              Every LED on every device that supports direct mode is driven to this
              one colour.
            </p>
          )}

          {shown.effect === 'sweep' && (
            <div className="hl-dial-row">
              <button
                className="hl-dial"
                style={{ ['--ang' as string]: shown.angle + 'deg' }}
                onClick={() => apply({ angle: (shown.angle + 45) % 360 })}
                aria-label={`Sweep direction ${shown.angle} degrees`}
              >
                <span className="hl-dial-needle" />
              </button>
              <div>
                <div className="hl-label">Direction</div>
                <div className="hl-dial-val">{shown.angle}°</div>
                <div className="hl-dial-hint">{DIRECTION(shown.angle)}</div>
              </div>
            </div>
          )}

          <div className="hl-stack">
            {/* Speed and scale drive the phase term, which solid never reads. */}
            {!isSolid && (
              <>
                <Slider label="Speed" value={shown.speed}
                  onChange={(speed) => apply({ speed })} readout={shown.speed + '%'} />
                <Slider label="Scale" value={shown.scale}
                  onChange={(scale) => apply({ scale })} readout={shown.scale + '%'} />
              </>
            )}
            <Slider label="Brightness" value={shown.brightness}
              onChange={(brightness) => apply({ brightness })} readout={shown.brightness + '%'} />
          </div>

          {/* Solid reads colorA directly and ignores the palette entirely. */}
          {isSolid ? (
            <>
              <div className="hl-card-title hl-card-title-sub">Colour</div>
              <ColorPicker label={scopeLabel ?? 'Colour'} value={shown.colorA}
                onChange={(colorA) => apply({ colorA })} />
            </>
          ) : (
            <>
              <div className="hl-card-title hl-card-title-sub">Palette</div>
              <Segmented
                block
                label="Palette"
                options={[{ id: 'spectrum', label: 'Spectrum' }, { id: 'duotone', label: 'Duotone' }]}
                value={shown.palette}
                onChange={(palette) => apply({ palette: palette as 'spectrum' | 'duotone' })}
              />
              {shown.palette === 'duotone' && (
                <div className="hl-stack">
                  <ColorPicker label="From" value={shown.colorA}
                    onChange={(colorA) => apply({ colorA })} />
                  <ColorPicker label="To" value={shown.colorB}
                    onChange={(colorB) => apply({ colorB })} />
                </div>
              )}
            </>
          )}
        </div>

        <div className="hl-card">
          <div className="hl-card-title">Presets</div>
          <form
            className="hl-profile-new"
            onSubmit={(e) => {
              e.preventDefault();
              const n = draftName.trim();
              if (!n) return;
              void saveProfile(n);
              setDraftName('');
            }}
          >
            <input
              className="hl-input"
              value={draftName}
              placeholder="Name this look"
              aria-label="Preset name"
              onChange={(e) => setDraftName(e.target.value)}
            />
            <button className="hl-toggle" type="submit" disabled={!draftName.trim()}>
              Save
            </button>
          </form>

          {profiles.length ? (
            <div className="hl-list hl-profile-list">
              {profiles.map((p) => (
                <div key={p.name} className="hl-profile-row">
                  <button
                    className="hl-list-item"
                    onClick={() => void loadProfile(p.name)}
                  >
                    <span>{p.name}</span>
                    <b>{p.cfg.effect}</b>
                  </button>
                  <button
                    className="hl-profile-del"
                    aria-label={`Delete preset ${p.name}`}
                    title="Delete"
                    onClick={() => void deleteProfile(p.name)}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="hl-note">
              Save the current effect, colours and brightness as a named look you
              can bring back in one click.
            </p>
          )}
        </div>

        <div className="hl-card">
          <div className="hl-card-title">Selection</div>
          {sel ? (
            <>
              <div className="hl-sel-name">{sel.zone}</div>
              <div className="hl-sel-device">{sel.device}</div>
              <div className="hl-meta-grid">
                <div><span>X</span><b>{Math.round(sel.x)}</b></div>
                <div><span>Y</span><b>{Math.round(sel.y)}</b></div>
                <div><span>LEDs</span><b>{sel.ledCount}</b></div>
                <div><span>Shape</span><b>{sel.shape}</b></div>
              </div>
              {sel.shape !== 'point' && sel.shape !== 'ring' && (
                <Slider label="Rotation" value={sel.rot} max={359}
                  onChange={(rot) => patchSel({ rot })} readout={sel.rot + '°'} />
              )}
              {sel.shape === 'ring' && (
                <Slider label="Radius" value={sel.r ?? 30} min={12} max={60}
                  onChange={(r) => patchSel({ r })} readout={String(sel.r ?? 30)} />
              )}
              {sel.shape === 'line' && (
                <Slider label="Length" value={sel.len ?? 80} min={20} max={420}
                  onChange={(len) => patchSel({ len })} readout={String(sel.len ?? 80)} />
              )}
            </>
          ) : (
            <p className="hl-note">
              Nothing selected. Click a zone on the canvas to move it, rotate it, or resize it.
            </p>
          )}
        </div>

        <div className="hl-card">
          <div className="hl-card-title">Zones</div>
          <div className="hl-list">
            {grouped.map(([device, items]) => (
              <div key={device}>
                <div className="hl-list-device">{device}</div>
                {items.map((el) => (
                  <button
                    key={el.id}
                    className={'hl-list-item' + (el.id === selected ? ' is-active' : '')}
                    onClick={() => { setSelected(el.id); setSelectedLed(null); }}
                  >
                    <span>{el.zone}</span>
                    <b>{el.ledCount}</b>
                  </button>
                ))}
              </div>
            ))}
            {!layout.length && (
              <p className="hl-note">
                No lighting zones found yet. If your motherboard and RAM are missing,
                OpenRGB needs administrator rights to reach the SMBus.
              </p>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}
