/** Layout canvas styles. Extracted so the view file stays readable. */

export const LAYOUT_CSS = `
.hl-root{
  --void:#0B0B0C;
  --panel:#0F0F11;
  --raised:#161619;
  --raised-2:#1E1E22;
  --hairline:rgba(255,255,255,0.085);
  --hairline-strong:rgba(255,255,255,0.18);
  --ink:#F5F5F7;
  --ink-2:#A8A8B0;
  /* 4.75:1 on --raised, the tightest surface it lands on. Do not darken. */
  --ink-3:#82828A;
  /* Decoration only — below AA, never use for text. */
  --ink-dim:#5A5A61;
  --ease:cubic-bezier(0.32,0.72,0,1);

  display:flex;gap:0;height:100%;min-height:0;
  background:var(--void);color:var(--ink);
  font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","Inter","Helvetica Neue",Arial,sans-serif;
  -webkit-font-smoothing:antialiased;letter-spacing:-0.011em;
}
.hl-root *,.hl-root *::before,.hl-root *::after{box-sizing:border-box;}
/* :where() keeps this reset at zero specificity so component rules below
   (.hl-toggle, .hl-dial) can still set their own background and border. */
.hl-root :where(button){font:inherit;color:inherit;background:none;border:none;cursor:pointer;letter-spacing:inherit;}
.hl-root :focus-visible{outline:2px solid var(--ink);outline-offset:2px;border-radius:8px;}

/* stage ------------------------------------------------------------ */
.hl-stage{flex:1;min-width:0;padding:30px 30px 34px;display:flex;flex-direction:column;}
.hl-header{display:flex;gap:26px;align-items:flex-start;margin-bottom:22px;}
.hl-eyebrow{font-size:10.5px;letter-spacing:0.1em;text-transform:uppercase;color:var(--ink-3);font-weight:600;}
.hl-title{font-size:30px;font-weight:600;letter-spacing:-0.03em;margin:6px 0 8px;line-height:1.05;}
.hl-sub{font-size:13.5px;color:var(--ink-2);line-height:1.55;max-width:56ch;margin:0;}
.hl-count{margin-left:auto;text-align:right;flex:0 0 auto;}
.hl-count-n{display:block;font-size:30px;font-weight:600;letter-spacing:-0.04em;line-height:1;}
.hl-count-l{display:block;font-size:10.5px;letter-spacing:0.1em;text-transform:uppercase;color:var(--ink-3);margin-top:6px;font-weight:600;}

.hl-canvas-wrap{
  flex:1;display:flex;flex-direction:column;
  background:var(--panel);border:1px solid var(--hairline);
  border-radius:20px;padding:14px;min-height:0;
}
.hl-canvas{width:100%;flex:1;min-height:360px;display:block;touch-action:none;user-select:none;}
.hl-region{fill:none;stroke:rgba(255,255,255,0.09);stroke-width:1;}
.hl-region-label{
  fill:#6E6E76;font-size:9.5px;letter-spacing:0.14em;font-weight:600;
  font-family:ui-monospace,"SF Mono",Menlo,monospace;
}
.hl-el{cursor:grab;}
.hl-el:active{cursor:grabbing;}
/* Zones are keyboard-operable: Tab to reach, arrows to nudge, shift+arrow x10. */
.hl-el:focus{outline:none;}
.hl-el:focus-visible .hl-hit{fill:rgba(255,255,255,0.06);stroke:var(--ink);stroke-width:1.5;}
.hl-hit{fill:transparent;stroke:transparent;stroke-width:1;transition:stroke .18s var(--ease),fill .18s var(--ease);}
.hl-el:hover .hl-hit{fill:rgba(255,255,255,0.03);stroke:rgba(255,255,255,0.12);}
.hl-el.is-selected .hl-hit{fill:rgba(255,255,255,0.05);stroke:var(--hairline-strong);stroke-dasharray:4 4;}
.hl-ring-guide{fill:none;stroke:rgba(255,255,255,0.07);stroke-width:1;}
.hl-led{transition:none;}

.hl-canvas-foot{display:flex;gap:8px;padding:14px 4px 2px;flex-wrap:wrap;}
.hl-toggle{
  padding:6px 13px;border-radius:8px;font-size:12.5px;
  background:var(--raised);border:1px solid var(--hairline);color:var(--ink-2);
  transition:all .18s var(--ease);
}
.hl-toggle:hover{color:var(--ink);}
.hl-toggle.is-on{background:var(--ink);color:#0B0B0C;border-color:var(--ink);font-weight:500;}

/* rail ------------------------------------------------------------- */
.hl-rail{
  width:318px;flex:0 0 318px;
  background:var(--panel);border-left:1px solid var(--hairline);
  padding:30px 18px;overflow-y:auto;
  display:flex;flex-direction:column;gap:16px;
}
.hl-card{background:var(--raised);border:1px solid var(--hairline);border-radius:16px;padding:18px;}
.hl-card-title{font-size:10.5px;letter-spacing:0.1em;text-transform:uppercase;color:var(--ink-3);font-weight:600;margin-bottom:14px;}
.hl-card-title-sub{margin-top:22px;padding-top:18px;border-top:1px solid var(--hairline);}
.hl-stack{margin-top:20px;}
.hl-note{font-size:12.5px;color:var(--ink-3);line-height:1.55;margin:0;}

.hl-segmented{position:relative;display:inline-grid;grid-template-columns:repeat(var(--seg-cols),1fr);background:var(--raised-2);border:1px solid var(--hairline);border-radius:10px;padding:3px;gap:0;}
.hl-segmented.is-block{display:grid;width:100%;}
/* Thumb rides on transform, not left/top, so a move never triggers layout. */
.hl-segmented-thumb{
  position:absolute;left:3px;top:3px;
  width:calc((100% - 6px)/var(--seg-cols));
  height:calc((100% - 6px)/var(--seg-rows));
  transform:translate(calc(var(--seg-col)*100%),calc(var(--seg-row)*100%));
  background:#2A2A2F;border-radius:8px;
  box-shadow:0 1px 3px rgba(0,0,0,.5),inset 0 1px 0 rgba(255,255,255,.06);
  transition:transform .38s var(--ease);
  will-change:transform;
}
.hl-seg{position:relative;z-index:1;padding:7px 4px;font-size:12px;color:var(--ink-3);transition:color .2s var(--ease);white-space:nowrap;}
.hl-seg:hover{color:var(--ink-2);}
.hl-seg.is-active{color:var(--ink);font-weight:500;}

/* scope ------------------------------------------------------------ */
.hl-scope-line{display:flex;align-items:center;gap:10px;margin-top:10px;}
.hl-scope-what{font-size:12.5px;color:var(--ink-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.hl-scope-reset{margin-left:auto;flex:0 0 auto;font-size:11.5px;color:var(--ink-3);
  text-decoration:underline;transition:color .16s var(--ease);}
.hl-scope-reset:hover{color:var(--ink);}

/* an LED with its own colour, and the one being edited */
.hl-led.is-pinned{stroke:rgba(255,255,255,.55);stroke-width:1;}
.hl-led.is-picked{stroke:var(--ink);stroke-width:2;}

/* colour ----------------------------------------------------------- */
.hl-note-inline{margin-top:12px;}
.hl-color + .hl-color{margin-top:16px;}
.hl-hex{
  font-family:ui-monospace,"SF Mono",Menlo,monospace;font-size:11.5px;
  color:var(--ink-2);background:var(--raised-2);border:1px solid var(--hairline);
  border-radius:6px;padding:2px 6px;width:82px;text-align:right;
  transition:border-color .18s var(--ease),color .18s var(--ease);
}
.hl-hex:hover{color:var(--ink);}
.hl-hex:focus{outline:none;border-color:var(--hairline-strong);color:var(--ink);}
.hl-swatches{display:grid;grid-template-columns:repeat(10,1fr);gap:6px;margin-top:10px;}
.hl-swatch{
  position:relative;aspect-ratio:1;border-radius:7px;padding:0;
  border:1px solid rgba(255,255,255,.14);cursor:pointer;
  transition:transform .16s var(--ease),box-shadow .16s var(--ease);
}
.hl-swatch:hover{transform:scale(1.12);}
.hl-swatch.is-on{box-shadow:0 0 0 2px var(--void),0 0 0 3.5px var(--ink);}
.hl-swatch-custom{
  overflow:hidden;display:block;
  background:conic-gradient(#FF3B30,#FFD60A,#34C759,#30B0C7,#0A84FF,#5E5CE6,#FF375F,#FF3B30);
}
.hl-swatch-custom .hl-swatch-fill{position:absolute;inset:3px;border-radius:4px;}
.hl-swatch-custom input{position:absolute;inset:0;opacity:0;cursor:pointer;}

/* presets ---------------------------------------------------------- */
.hl-profile-new{display:flex;gap:8px;margin-bottom:14px;}
.hl-input{
  flex:1;min-width:0;font:inherit;font-size:12.5px;color:var(--ink);
  background:var(--raised-2);border:1px solid var(--hairline);
  border-radius:8px;padding:6px 10px;
  transition:border-color .18s var(--ease);
}
.hl-input::placeholder{color:var(--ink-3);}
.hl-input:focus{outline:none;border-color:var(--hairline-strong);}
.hl-toggle:disabled{opacity:.4;cursor:not-allowed;}
.hl-profile-list{gap:2px;}
.hl-profile-row{display:flex;align-items:center;gap:2px;}
.hl-profile-row .hl-list-item{flex:1;min-width:0;}
.hl-profile-row .hl-list-item b{text-transform:capitalize;}
.hl-profile-del{
  flex:0 0 auto;width:24px;height:24px;border-radius:7px;font-size:15px;line-height:1;
  color:var(--ink-3);transition:background .16s var(--ease),color .16s var(--ease);
}
.hl-profile-del:hover{background:rgba(255,69,58,.15);color:#FF453A;}

.hl-dial-row{display:flex;align-items:center;gap:16px;margin-top:20px;}
.hl-dial{
  position:relative;width:58px;height:58px;flex:0 0 58px;border-radius:50%;
  background:var(--raised-2);border:1px solid var(--hairline);
  transition:border-color .2s var(--ease);
}
.hl-dial:hover{border-color:var(--hairline-strong);}
.hl-dial-needle{
  position:absolute;inset:0;transform:rotate(var(--ang));
  transition:transform .45s var(--ease);
}
.hl-dial-needle::before{
  content:"";position:absolute;left:50%;top:8px;
  width:2px;height:20px;border-radius:1px;background:var(--ink);
  transform:translateX(-50%);
}
.hl-dial-needle::after{
  content:"";position:absolute;left:50%;top:50%;
  width:5px;height:5px;border-radius:50%;background:var(--ink-3);
  transform:translate(-50%,-50%);
}
.hl-dial-val{font-size:19px;font-weight:600;letter-spacing:-0.03em;margin:3px 0 2px;}
.hl-dial-hint{font-size:11.5px;color:var(--ink-3);}

.hl-sel-name{font-size:16px;font-weight:550;letter-spacing:-0.02em;}
.hl-sel-device{font-size:12px;color:var(--ink-3);margin-top:3px;}
.hl-meta-grid{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin:16px 0 18px;}
.hl-meta-grid div{background:var(--raised-2);border-radius:9px;padding:8px 10px;}
.hl-meta-grid span{display:block;font-size:10px;letter-spacing:0.08em;text-transform:uppercase;color:var(--ink-3);font-weight:600;}
.hl-meta-grid b{display:block;font-family:ui-monospace,"SF Mono",Menlo,monospace;font-size:13px;font-weight:500;margin-top:3px;}

.hl-list{display:flex;flex-direction:column;gap:16px;}
.hl-list-device{font-size:11px;color:var(--ink-3);margin-bottom:6px;font-weight:500;}
.hl-list-item{
  width:100%;display:flex;justify-content:space-between;align-items:center;
  padding:6px 9px;border-radius:8px;font-size:12.5px;color:var(--ink-2);
  transition:background .16s var(--ease),color .16s var(--ease);
}
.hl-list-item:hover{background:rgba(255,255,255,0.04);color:var(--ink);}
.hl-list-item.is-active{background:rgba(255,255,255,0.085);color:var(--ink);}
.hl-list-item b{font-family:ui-monospace,"SF Mono",Menlo,monospace;font-size:11px;font-weight:500;color:var(--ink-3);}
/* The hover/active highlight lifts the background, so the count has to lift with it. */
.hl-list-item:hover b,.hl-list-item.is-active b{color:var(--ink-2);}

/* sliders ---------------------------------------------------------- */
.hl-slider-wrap + .hl-slider-wrap{margin-top:16px;}
.hl-slider-head{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px;}
.hl-label{font-size:12.5px;color:var(--ink-2);}
.hl-readout{font-family:ui-monospace,"SF Mono",Menlo,monospace;font-size:11.5px;color:var(--ink-3);}
.hl-slider{position:relative;height:18px;display:flex;align-items:center;cursor:pointer;touch-action:none;}
.hl-slider-track{position:absolute;left:0;right:0;height:4px;border-radius:2px;background:rgba(255,255,255,.12);}
.hl-slider-fill{position:absolute;left:0;height:4px;border-radius:2px;background:var(--ink);opacity:.9;}
.hl-slider-knob{position:absolute;width:15px;height:15px;border-radius:50%;background:#fff;transform:translateX(-50%);box-shadow:0 1px 4px rgba(0,0,0,.55);transition:transform .15s var(--ease);}
.hl-slider:hover .hl-slider-knob,.hl-slider.is-dragging .hl-slider-knob{transform:translateX(-50%) scale(1.18);}

.hl-toast{
  position:fixed;bottom:26px;left:50%;transform:translateX(-50%);
  background:rgba(30,30,34,.92);backdrop-filter:blur(20px);
  border:1px solid var(--hairline-strong);border-radius:12px;
  padding:11px 20px;font-size:13px;
  box-shadow:0 12px 40px rgba(0,0,0,.5);z-index:50;
  animation:hlRise .4s var(--ease);
}
@keyframes hlRise{from{opacity:0;transform:translateX(-50%) translateY(10px);}to{opacity:1;transform:translateX(-50%) translateY(0);}}

@media (max-width:1080px){
  .hl-root{flex-direction:column;}
  .hl-rail{width:100%;flex:none;border-left:none;border-top:1px solid var(--hairline);padding:20px 18px 34px;}
  .hl-stage{padding:22px 18px;}
  .hl-header{flex-direction:column;gap:14px;}
  .hl-count{margin-left:0;text-align:left;}
  .hl-title{font-size:24px;}
}
@media (prefers-reduced-motion:reduce){
  .hl-root *{animation-duration:.001ms !important;transition-duration:.001ms !important;}
}
`;
