import React, { useRef, useState, useCallback } from 'react';

export type RGB = [number, number, number];

/** Named presets. Same hues the rest of the UI uses, so picks stay on-palette. */
const PRESETS: { name: string; rgb: RGB }[] = [
  { name: 'Red', rgb: [255, 59, 48] },
  { name: 'Orange', rgb: [255, 149, 0] },
  { name: 'Yellow', rgb: [255, 214, 10] },
  { name: 'Green', rgb: [52, 199, 89] },
  { name: 'Teal', rgb: [48, 176, 199] },
  { name: 'Blue', rgb: [10, 132, 255] },
  { name: 'Indigo', rgb: [94, 92, 230] },
  { name: 'Magenta', rgb: [255, 55, 95] },
  { name: 'White', rgb: [255, 255, 255] },
];

const toHex = (c: RGB) =>
  '#' + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');

const fromHex = (h: string): RGB | null => {
  const m = /^#?([0-9a-f]{6})$/i.exec(h.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/**
 * Colour input for the effects that actually read one. A swatch row for speed,
 * the OS picker for anything else, and a hex field so a specific brand colour
 * can be typed rather than hunted for.
 */
export function ColorPicker({
  label, value, onChange,
}: {
  label: string;
  value: RGB;
  onChange: (c: RGB) => void;
}) {
  const hex = toHex(value);
  const [draft, setDraft] = useState<string | null>(null);

  const commit = (text: string) => {
    const rgb = fromHex(text);
    if (rgb) onChange(rgb);
    setDraft(null);
  };

  return (
    <div className="hl-color">
      <div className="hl-slider-head">
        <span className="hl-label">{label}</span>
        <input
          className="hl-hex"
          value={draft ?? hex.toUpperCase()}
          spellCheck={false}
          aria-label={`${label} hex value`}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit((e.target as HTMLInputElement).value);
            if (e.key === 'Escape') setDraft(null);
          }}
        />
      </div>

      <div className="hl-swatches">
        <label className="hl-swatch hl-swatch-custom" title="Custom colour">
          <span className="hl-swatch-fill" style={{ background: hex }} />
          <input
            type="color"
            value={hex}
            aria-label={`${label}, choose a custom colour`}
            onChange={(e) => onChange(fromHex(e.target.value) ?? value)}
          />
        </label>

        {PRESETS.map((p) => {
          const on = toHex(p.rgb) === hex;
          return (
            <button
              key={p.name}
              className={'hl-swatch' + (on ? ' is-on' : '')}
              style={{ background: toHex(p.rgb) }}
              aria-label={p.name}
              aria-pressed={on}
              title={p.name}
              onClick={() => onChange(p.rgb)}
            />
          );
        })}
      </div>
    </div>
  );
}

export function Slider({
  value, min = 0, max = 100, onChange, label, readout,
}: {
  value: number; min?: number; max?: number;
  onChange: (v: number) => void; label?: string; readout?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const pct = ((value - min) / (max - min)) * 100;

  const set = useCallback((clientX: number) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const p = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    onChange(Math.round(min + p * (max - min)));
  }, [min, max, onChange]);

  return (
    <div className="hl-slider-wrap">
      {label && (
        <div className="hl-slider-head">
          <span className="hl-label">{label}</span>
          <span className="hl-readout">{readout ?? value}</span>
        </div>
      )}
      <div
        ref={ref}
        className={'hl-slider' + (dragging ? ' is-dragging' : '')}
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuenow={value}
        aria-valuemin={min}
        aria-valuemax={max}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          setDragging(true);
          set(e.clientX);
        }}
        onPointerMove={(e) => dragging && set(e.clientX)}
        onPointerUp={(e) => {
          e.currentTarget.releasePointerCapture(e.pointerId);
          setDragging(false);
        }}
        onPointerCancel={() => setDragging(false)}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 10 : 1;
          const clamp = (v: number) => Math.min(max, Math.max(min, v));
          const keys: Record<string, number> = {
            ArrowRight: value + step, ArrowUp: value + step,
            ArrowLeft: value - step, ArrowDown: value - step,
            PageUp: value + 10, PageDown: value - 10,
            Home: min, End: max,
          };
          if (!(e.key in keys)) return;
          e.preventDefault();
          onChange(clamp(keys[e.key]));
        }}
      >
        <div className="hl-slider-track" />
        <div className="hl-slider-fill" style={{ width: pct + '%' }} />
        <div className="hl-slider-knob" style={{ left: pct + '%' }} />
      </div>
    </div>
  );
}

/**
 * Single-choice picker. This is a radio group, not a tab list: the options
 * pick a value, they do not swap panels. Arrow keys move the selection and
 * only the active option is a tab stop, which is what a radiogroup owes the
 * keyboard.
 */
export function Segmented({
  options, value, onChange, block, label, columns,
}: {
  options: { id: string; label: string }[];
  value: string;
  onChange: (id: string) => void;
  block?: boolean;
  label?: string;
  /** Wrap into a grid. Omit for a single row. */
  columns?: number;
}) {
  const idx = Math.max(0, options.findIndex((o) => o.id === value));
  const cols = columns ?? options.length;
  const rows = Math.ceil(options.length / cols);

  const move = (delta: number) => {
    const next = options[(idx + delta + options.length) % options.length];
    onChange(next.id);
    document.getElementById(`seg-${next.id}`)?.focus();
  };

  return (
    <div
      className={'hl-segmented' + (block ? ' is-block' : '')}
      style={{
        ['--seg-count' as string]: options.length,
        ['--seg-cols' as string]: cols,
        ['--seg-rows' as string]: rows,
        ['--seg-col' as string]: idx % cols,
        ['--seg-row' as string]: Math.floor(idx / cols),
      }}
      role="radiogroup"
      aria-label={label}
    >
      <div className="hl-segmented-thumb" />
      {options.map((o) => (
        <button
          key={o.id}
          id={`seg-${o.id}`}
          role="radio"
          aria-checked={o.id === value}
          tabIndex={o.id === value ? 0 : -1}
          className={'hl-seg' + (o.id === value ? ' is-active' : '')}
          onClick={() => onChange(o.id)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); move(1); }
            if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
