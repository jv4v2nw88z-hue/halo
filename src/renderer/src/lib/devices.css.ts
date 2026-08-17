/** Devices inspector styles. Same tokens as the layout view. */

export const DEVICES_CSS = `
.dv-root{
  --raised:#161619;--raised-2:#1E1E22;
  --hairline:rgba(255,255,255,0.085);
  --ink:#F5F5F7;--ink-2:#A8A8B0;--ink-3:#82828A;
  --ease:cubic-bezier(0.32,0.72,0,1);
  height:100%;overflow-y:auto;padding:30px 34px 40px;background:#0B0B0C;color:var(--ink);
}
.dv-root *{box-sizing:border-box;}
/* :where() keeps this reset at zero specificity so .dv-btn can still set
   its own background and border. */
.dv-root :where(button){font:inherit;color:inherit;background:none;border:none;cursor:pointer;}
.dv-root :focus-visible{outline:2px solid var(--ink);outline-offset:2px;border-radius:8px;}

.dv-header{display:flex;align-items:flex-start;gap:20px;margin-bottom:28px;}
.dv-eyebrow{font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-3);font-weight:600;}
.dv-title{font-size:30px;font-weight:600;letter-spacing:-.03em;margin:6px 0 8px;line-height:1.05;}
.dv-sub{font-size:13.5px;color:var(--ink-2);margin:0;max-width:60ch;line-height:1.55;}
.dv-btn{margin-left:auto;padding:8px 15px;border-radius:9px;font-size:13px;
  background:var(--raised);border:1px solid var(--hairline);transition:background .18s var(--ease);}
.dv-btn:hover{background:var(--raised-2);}

.dv-empty{background:var(--raised);border:1px solid var(--hairline);border-radius:18px;
  padding:34px;max-width:60ch;}
.dv-empty h2{font-size:17px;font-weight:600;letter-spacing:-.02em;margin:0 0 10px;}
.dv-empty p{font-size:13.5px;color:var(--ink-2);line-height:1.6;margin:0 0 18px;}
.dv-empty .dv-btn{margin-left:0;}

.dv-group{margin-bottom:26px;}
.dv-group-title{font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;
  color:var(--ink-3);font-weight:600;margin-bottom:10px;}

.dv-card{background:var(--raised);border:1px solid var(--hairline);border-radius:14px;
  margin-bottom:8px;overflow:hidden;transition:border-color .2s var(--ease);}
.dv-card.is-open{border-color:rgba(255,255,255,.18);}
.dv-card-head{width:100%;display:flex;align-items:center;gap:20px;padding:15px 18px;text-align:left;}
.dv-card-head:hover{background:rgba(255,255,255,.03);}
.dv-card-id{min-width:0;}
.dv-name{font-size:14px;font-weight:500;letter-spacing:-.015em;}
.dv-vendor{font-size:11.5px;color:var(--ink-3);margin-top:2px;}
.dv-facts{margin-left:auto;display:flex;gap:16px;align-items:center;
  font-size:11.5px;color:var(--ink-3);white-space:nowrap;}
.dv-facts b{font-family:ui-monospace,"SF Mono",Menlo,monospace;font-weight:500;color:var(--ink-2);}
.dv-warn{color:#D9A441;}
.dv-chev{font-size:15px;color:var(--ink-3);width:14px;text-align:center;}

.dv-card-body{padding:0 18px 18px;border-top:1px solid var(--hairline);}
.dv-table{width:100%;border-collapse:collapse;margin-top:14px;font-size:12.5px;}
.dv-table th{text-align:left;font-size:10px;letter-spacing:.08em;text-transform:uppercase;
  color:var(--ink-3);font-weight:600;padding:6px 8px;}
.dv-table td{padding:7px 8px;border-top:1px solid var(--hairline);color:var(--ink-2);}
.dv-table td:first-child{color:var(--ink);}
.dv-table td:nth-child(2),.dv-table td:nth-child(3){
  font-family:ui-monospace,"SF Mono",Menlo,monospace;font-size:11.5px;}
.dv-note{font-size:12.5px;color:var(--ink-3);line-height:1.6;margin:14px 0 0;}

.dv-btn:disabled{opacity:.4;cursor:not-allowed;}
.dv-btn-danger{color:#FF453A;}
.dv-btn-danger:hover:not(:disabled){background:rgba(255,69,58,.14);}

.dv-conflict{background:var(--raised);border:1px solid var(--hairline);border-radius:14px;padding:18px;}
.dv-conflict-lead{max-width:70ch;margin:0 0 14px;}
.dv-conflict-list{list-style:none;margin:0 0 16px;padding:0;display:flex;flex-direction:column;gap:2px;}
.dv-check{display:flex;align-items:center;gap:10px;padding:7px 8px;border-radius:8px;cursor:pointer;
  transition:background .16s var(--ease);}
.dv-check:hover{background:rgba(255,255,255,.04);}
.dv-check input{position:absolute;opacity:0;width:0;height:0;}
.dv-check-box{flex:0 0 auto;width:15px;height:15px;border-radius:4px;
  border:1px solid rgba(255,255,255,.3);background:var(--raised-2);position:relative;
  transition:background .16s var(--ease),border-color .16s var(--ease);}
.dv-check input:checked + .dv-check-box{background:var(--ink);border-color:var(--ink);}
.dv-check input:checked + .dv-check-box::after{
  content:"";position:absolute;left:4.5px;top:1px;width:4px;height:8px;
  border:solid #0B0B0C;border-width:0 2px 2px 0;transform:rotate(45deg);}
.dv-check input:focus-visible + .dv-check-box{outline:2px solid var(--ink);outline-offset:2px;}
.dv-check-name{font-size:13px;}
.dv-check-proc{font-family:ui-monospace,"SF Mono",Menlo,monospace;font-size:11px;color:var(--ink-3);}
.dv-check-pid{margin-left:auto;font-family:ui-monospace,"SF Mono",Menlo,monospace;
  font-size:11px;color:var(--ink-3);}
.dv-conflict-foot{display:flex;gap:8px;}
.dv-conflict-foot .dv-btn{margin-left:0;}

.dv-resize{display:flex;align-items:center;gap:6px;}
.dv-resize input{width:64px;font:inherit;font-size:12px;color:var(--ink);
  background:var(--raised-2);border:1px solid var(--hairline);border-radius:6px;padding:3px 6px;}
.dv-resize input:focus{outline:none;border-color:rgba(255,255,255,.28);}
.dv-resize .dv-btn{margin-left:0;padding:3px 10px;font-size:12px;}
.dv-resize-max{font-family:ui-monospace,"SF Mono",Menlo,monospace;font-size:10.5px;color:var(--ink-3);}
.dv-resize-fixed{font-size:11.5px;color:var(--ink-3);}

.dv-path{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}
.dv-path-value{flex:1;min-width:220px;font-family:ui-monospace,"SF Mono",Menlo,monospace;
  font-size:11.5px;color:var(--ink-2);background:var(--raised-2);
  border:1px solid var(--hairline);border-radius:8px;padding:7px 10px;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.dv-path .dv-btn{margin-left:0;}

.dv-foot{display:flex;gap:20px;padding-top:20px;margin-top:10px;
  border-top:1px solid var(--hairline);font-size:11px;color:var(--ink-3);
  font-family:ui-monospace,"SF Mono",Menlo,monospace;}

@media (max-width:760px){
  .dv-root{padding:22px 18px 34px;}
  .dv-card-head{flex-wrap:wrap;gap:10px;}
  .dv-facts{margin-left:0;}
}
`;
