// 全部颜色走宿主语义 token，缺 token 时退回本地兜底；深浅色跟随 html[data-theme] / body[data-ds-dark-theme]。
const CSS = String.raw`
.clib-root{
  --clib-ink: var(--dsw-alias-label-primary, #1f2328);
  --clib-ink2: var(--dsw-alias-label-secondary, #5b6470);
  --clib-ink3: color-mix(in srgb, var(--clib-ink2) 72%, transparent);
  --clib-bg: var(--dsw-alias-bg-base, #ffffff);
  --clib-card: var(--dsw-alias-bg-layer-2, #f6f7f9);
  --clib-layer: var(--dsw-alias-bg-layer-1, #f1f3f6);
  --clib-line: var(--dsw-alias-border-l1, #e3e6ea);
  --clib-line-strong: var(--dsw-alias-border-l2, #cdd3da);
  --clib-accent: var(--dsw-alias-brand-primary, #3a5bd9);
  --clib-danger: var(--dsw-alias-state-error-primary, #c8332b);
  --clib-ok: var(--dsw-alias-state-success-primary, #0f8f6d);
  --clib-warn: var(--dsw-alias-state-warning-primary, #b1661b);
  --clib-hover: color-mix(in srgb, var(--clib-ink) 7%, transparent);
  --clib-active: color-mix(in srgb, var(--clib-accent) 13%, transparent);
  --clib-r: var(--dsw-radius-sm, 8px);
  --clib-r-lg: var(--dsw-radius-md, 12px);
  --clib-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  position: absolute; inset: 0; display: flex; flex-direction: column; overflow: hidden;
  background: var(--clib-bg); color: var(--clib-ink);
  font-size: 13px; line-height: 1.5; -webkit-font-smoothing: antialiased;
}
html[data-theme='dark'] .clib-root, body[data-ds-dark-theme] .clib-root{
  --clib-ink: var(--dsw-alias-label-primary, #e6e8ea);
  --clib-ink2: var(--dsw-alias-label-secondary, #9aa2ac);
  --clib-bg: var(--dsw-alias-bg-base, #17191c);
  --clib-card: var(--dsw-alias-bg-layer-2, #202327);
  --clib-layer: var(--dsw-alias-bg-layer-1, #1c1f22);
  --clib-line: var(--dsw-alias-border-l1, #2d3136);
  --clib-line-strong: var(--dsw-alias-border-l2, #3b4046);
  --clib-accent: var(--dsw-alias-brand-primary, #7d95ff);
  --clib-danger: var(--dsw-alias-state-error-primary, #ff6b60);
  --clib-ok: var(--dsw-alias-state-success-primary, #3fc79a);
  --clib-warn: var(--dsw-alias-state-warning-primary, #e0a04a);
  color-scheme: dark;
}
.clib-root *, .clib-root *::before, .clib-root *::after{ box-sizing: border-box; }
.clib-root button, .clib-root input, .clib-root select, .clib-root textarea{ font: inherit; color: inherit; }
.clib-root button{ cursor: pointer; }
.clib-root ::selection{ background: color-mix(in srgb, var(--clib-accent) 28%, transparent); }
.clib-root ::-webkit-scrollbar{ width: 10px; height: 10px; }
.clib-root ::-webkit-scrollbar-thumb{ background: color-mix(in srgb, var(--clib-ink) 18%, transparent); border-radius: 8px; border: 3px solid transparent; background-clip: content-box; }
.clib-root ::-webkit-scrollbar-thumb:hover{ background-color: color-mix(in srgb, var(--clib-ink) 30%, transparent); }

/* ---------------------------------------------------------------- 顶栏 */
.clib-toolbar{
  flex: none; display: flex; align-items: center; flex-wrap: wrap; gap: 8px;
  padding: 10px 14px; border-bottom: .5px solid var(--clib-line);
  background: color-mix(in srgb, var(--clib-bg) 90%, transparent);
  backdrop-filter: blur(18px) saturate(160%); z-index: 6;
}
.clib-brand{ display: flex; flex-direction: column; gap: 1px; margin-right: 4px; min-width: 92px; }
.clib-brand b{ font-size: 13.5px; font-weight: 650; letter-spacing: .2px; }
.clib-brand small{ font-size: 10.5px; color: var(--clib-ink3); }
.clib-search{
  flex: 1 1 220px; min-width: 170px; display: flex; align-items: center; gap: 6px;
  padding: 0 9px; height: 30px; border: .5px solid var(--clib-line); border-radius: 999px;
  background: var(--clib-card); color: var(--clib-ink3);
}
.clib-search:focus-within{ border-color: var(--clib-accent); box-shadow: 0 0 0 2px color-mix(in srgb, var(--clib-accent) 20%, transparent); }
.clib-search input{ flex: 1; min-width: 0; border: 0; outline: none; background: transparent; color: var(--clib-ink); height: 100%; }
.clib-search input::placeholder{ color: var(--clib-ink3); }
.clib-select, .clib-input, .clib-textarea{
  font: inherit; color: var(--clib-ink); background: var(--clib-card); border: .5px solid var(--clib-line);
  border-radius: var(--clib-r); padding: 5px 8px; outline: none;
}
.clib-select{ height: 30px; cursor: pointer; max-width: 150px; }
.clib-select:hover, .clib-input:hover, .clib-textarea:hover{ border-color: var(--clib-line-strong); }
.clib-select:focus-visible, .clib-input:focus-visible, .clib-textarea:focus-visible{
  border-color: var(--clib-accent); box-shadow: 0 0 0 2px color-mix(in srgb, var(--clib-accent) 20%, transparent);
}
.clib-btn{
  display: inline-flex; align-items: center; justify-content: center; gap: 5px;
  padding: 5px 10px; height: 30px; border-radius: 999px; border: .5px solid var(--clib-line);
  background: transparent; color: var(--clib-ink); font-size: 12px; white-space: nowrap;
  transition: background .16s ease, border-color .16s ease, transform .12s ease;
}
.clib-btn:hover{ background: var(--clib-hover); border-color: var(--clib-line-strong); }
.clib-btn:active{ transform: scale(.97); }
.clib-btn[disabled]{ opacity: .45; cursor: not-allowed; transform: none; }
.clib-btn.is-primary{ background: var(--clib-accent); border-color: transparent; color: #fff; }
.clib-btn.is-primary:hover{ background: var(--clib-accent); filter: brightness(1.06); }
.clib-btn.is-danger{ color: var(--clib-danger); border-color: color-mix(in srgb, var(--clib-danger) 42%, transparent); }
.clib-btn.is-danger:hover{ background: color-mix(in srgb, var(--clib-danger) 12%, transparent); }
.clib-btn.is-on{ background: var(--clib-active); border-color: color-mix(in srgb, var(--clib-accent) 38%, transparent); color: var(--clib-accent); }
.clib-icon{ width: 28px; height: 28px; padding: 0; border-radius: 8px; }
.clib-spin{ animation: clib-spin 1s linear infinite; }
@keyframes clib-spin{ to{ transform: rotate(360deg); } }

/* ---------------------------------------------------------------- 三栏 */
.clib-body{ flex: 1; min-height: 0; display: grid; grid-template-columns: 214px minmax(0, 1fr) minmax(320px, 408px); }
.clib-side{
  min-height: 0; overflow-y: auto; padding: 12px 10px 18px;
  border-right: .5px solid var(--clib-line); background: color-mix(in srgb, var(--clib-layer) 55%, transparent);
}
.clib-side-title{
  display: flex; align-items: center; justify-content: space-between; gap: 6px;
  margin: 12px 6px 5px; font-size: 10.5px; font-weight: 650; letter-spacing: .7px;
  text-transform: uppercase; color: var(--clib-ink3);
}
.clib-side-title:first-child{ margin-top: 0; }
.clib-nav{
  width: 100%; display: flex; align-items: center; gap: 7px; padding: 5px 7px;
  border: 0; border-radius: 7px; background: transparent; text-align: left;
  font-size: 12.5px; color: var(--clib-ink2); line-height: 1.35;
}
.clib-nav:hover{ background: var(--clib-hover); color: var(--clib-ink); }
.clib-nav.is-on{ background: var(--clib-active); color: var(--clib-accent); font-weight: 600; }
.clib-nav .clib-nav-label{ flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.clib-nav .clib-count{ flex: none; font-size: 10.5px; color: var(--clib-ink3); font-variant-numeric: tabular-nums; }
.clib-nav.is-on .clib-count{ color: inherit; opacity: .8; }
.clib-nav .clib-dot{ flex: none; width: 6px; height: 6px; border-radius: 2px; background: color-mix(in srgb, var(--clib-ink2) 55%, transparent); }
.clib-nav.is-on .clib-dot{ background: var(--clib-accent); }

.clib-tagcloud{ display: flex; flex-wrap: wrap; gap: 5px; padding: 2px 4px; }
.clib-tag{
  display: inline-flex; align-items: center; gap: 4px; max-width: 100%;
  padding: 2px 8px; border-radius: 999px; border: .5px solid var(--clib-line);
  background: transparent; font-size: 11px; color: var(--clib-ink2); overflow: hidden;
}
.clib-tag span{ overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.clib-tag:hover{ border-color: var(--clib-line-strong); color: var(--clib-ink); background: var(--clib-hover); }
.clib-tag.is-on{ background: var(--clib-active); border-color: color-mix(in srgb, var(--clib-accent) 40%, transparent); color: var(--clib-accent); }
.clib-tag em{ font-style: normal; font-size: 9.5px; opacity: .65; font-variant-numeric: tabular-nums; }
.clib-side-empty{ margin: 2px 6px; font-size: 11px; color: var(--clib-ink3); }

.clib-source-form{ display: flex; flex-direction: column; gap: 5px; margin: 6px 4px 0; }
.clib-source-form .clib-input{ width: 100%; font-size: 11.5px; padding: 4px 7px; }
.clib-source-form-row{ display: flex; gap: 5px; }
.clib-source-form-row .clib-btn{ flex: 1; height: 26px; font-size: 11px; }
.clib-side-add{ margin-left: auto; border: 0; background: transparent; color: var(--clib-ink3); font-size: 11px; padding: 0 4px; }
.clib-side-add:hover{ color: var(--clib-accent); }
.clib-source-row{ position: relative; }
.clib-source-row .clib-source-remove{
  position: absolute; right: 5px; top: 50%; transform: translateY(-50%);
  width: 20px; height: 20px; padding: 0; border: 0; border-radius: 5px;
  background: transparent; color: var(--clib-ink3); display: none; align-items: center; justify-content: center;
}
.clib-source-row:hover .clib-source-remove{ display: inline-flex; }
.clib-source-row .clib-source-remove:hover{ background: var(--clib-hover); color: var(--clib-danger); }
.clib-missing{ color: var(--clib-warn); font-size: 10px; }

/* ---------------------------------------------------------------- 列表 */
.clib-main{ min-width: 0; min-height: 0; display: flex; flex-direction: column; background: var(--clib-bg); }
.clib-list-head{
  flex: none; display: flex; align-items: center; gap: 8px; justify-content: space-between;
  padding: 8px 14px; border-bottom: .5px solid var(--clib-line); min-height: 36px;
  font-size: 11.5px; color: var(--clib-ink3);
}
.clib-list-head b{ color: var(--clib-ink2); font-weight: 600; font-variant-numeric: tabular-nums; }
.clib-list{ flex: 1; min-height: 0; overflow-y: auto; }
.clib-row{
  width: 100%; display: flex; align-items: flex-start; gap: 10px; padding: 10px 14px;
  border: 0; border-bottom: .5px solid var(--clib-line); background: transparent;
  text-align: left; color: inherit; position: relative; transition: background .12s ease;
}
.clib-row:hover{ background: var(--clib-hover); }
.clib-row.is-on{ background: var(--clib-active); }
.clib-row.is-on::before{ content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 2.5px; background: var(--clib-accent); }
.clib-row-icon{
  flex: none; width: 28px; height: 28px; margin-top: 1px; border-radius: 8px;
  display: inline-flex; align-items: center; justify-content: center;
  background: var(--clib-card); color: var(--clib-ink2); border: .5px solid var(--clib-line);
}
.clib-row.is-on .clib-row-icon{ color: var(--clib-accent); border-color: color-mix(in srgb, var(--clib-accent) 30%, transparent); }
.clib-row-body{ flex: 1; min-width: 0; }
.clib-row-title{ display: flex; align-items: baseline; gap: 6px; min-width: 0; }
.clib-row-title strong{ font-size: 13px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.clib-badge{
  flex: none; font-size: 9.5px; line-height: 1.6; padding: 0 6px; border-radius: 999px;
  background: var(--clib-card); border: .5px solid var(--clib-line); color: var(--clib-ink3);
}
.clib-row-meta{
  display: flex; align-items: center; gap: 7px; margin-top: 1px;
  font-size: 10.5px; color: var(--clib-ink3); min-width: 0;
}
.clib-row-meta .clib-path{ overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.clib-row-meta .clib-sep{ flex: none; opacity: .5; }
.clib-row-meta .clib-num{ flex: none; font-variant-numeric: tabular-nums; }
.clib-row-snippet{
  margin-top: 3px; font-size: 11.5px; color: var(--clib-ink2);
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
  word-break: break-word;
}
.clib-row-tags{ display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }
.clib-mini-tag{ font-size: 9.5px; padding: 0 5px; border-radius: 4px; background: var(--clib-card); color: var(--clib-ink3); }
.clib-list-foot{ flex: none; display: flex; justify-content: center; padding: 10px; border-top: .5px solid var(--clib-line); }

.clib-empty{
  flex: 1; min-height: 220px; display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 8px; padding: 32px; text-align: center; color: var(--clib-ink2);
}
.clib-empty-icon{
  width: 46px; height: 46px; border-radius: 14px; display: flex; align-items: center; justify-content: center;
  background: var(--clib-card); border: .5px solid var(--clib-line); color: var(--clib-ink3); margin-bottom: 2px;
}
.clib-empty b{ font-size: 14px; color: var(--clib-ink); }
.clib-empty p{ margin: 0; max-width: 320px; font-size: 12px; color: var(--clib-ink3); }

.clib-skel{ padding: 13px 14px; border-bottom: .5px solid var(--clib-line); display: flex; gap: 10px; }
.clib-skel-avatar{ width: 28px; height: 28px; border-radius: 8px; flex: none; }
.clib-skel-lines{ flex: 1; display: flex; flex-direction: column; gap: 6px; }
.clib-skel-line{ height: 9px; border-radius: 5px; }
.clib-shimmer{
  background: linear-gradient(90deg, var(--clib-card) 25%, var(--clib-layer) 37%, var(--clib-card) 63%);
  background-size: 400% 100%; animation: clib-shimmer 1.3s ease infinite;
}
@keyframes clib-shimmer{ 0%{ background-position: 100% 50%; } 100%{ background-position: 0 50%; } }

/* ---------------------------------------------------------------- 详情 */
.clib-detail{
  min-width: 0; min-height: 0; display: flex; flex-direction: column;
  border-left: .5px solid var(--clib-line); background: var(--clib-bg);
}
.clib-detail-head{
  flex: none; display: flex; align-items: flex-start; gap: 8px; padding: 10px 14px 8px;
  border-bottom: .5px solid var(--clib-line);
}
.clib-detail-head .clib-detail-titles{ flex: 1; min-width: 0; }
.clib-detail-head h2{ margin: 0; font-size: 14px; font-weight: 650; line-height: 1.35; word-break: break-word; }
.clib-detail-sub{ margin-top: 2px; font-size: 10.5px; color: var(--clib-ink3); display: flex; flex-wrap: wrap; gap: 5px 8px; align-items: center; }
.clib-detail-body{ flex: 1; min-height: 0; overflow-y: auto; padding: 12px 14px 14px; display: flex; flex-direction: column; gap: 12px; }
.clib-detail-foot{
  flex: none; display: flex; align-items: center; flex-wrap: wrap; gap: 7px;
  padding: 9px 14px; border-top: .5px solid var(--clib-line);
  background: color-mix(in srgb, var(--clib-bg) 92%, transparent); backdrop-filter: blur(10px);
}
.clib-detail-foot .clib-grow{ flex: 1; }
.clib-placeholder{
  flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px;
  padding: 30px; text-align: center; color: var(--clib-ink3);
}
.clib-placeholder b{ color: var(--clib-ink2); font-size: 13px; }
.clib-placeholder p{ margin: 0; max-width: 240px; font-size: 11.5px; }

.clib-field{ display: flex; flex-direction: column; gap: 4px; }
.clib-field > label{ display: flex; align-items: baseline; justify-content: space-between; gap: 6px; font-size: 10.5px; font-weight: 650; letter-spacing: .4px; text-transform: uppercase; color: var(--clib-ink3); }
.clib-field > label small{ font-weight: 400; text-transform: none; letter-spacing: 0; opacity: .8; }
.clib-field .clib-input, .clib-field .clib-textarea{ width: 100%; }
.clib-textarea{ resize: vertical; min-height: 58px; line-height: 1.5; }
.clib-path-line{ font-family: var(--clib-mono); font-size: 10.5px; color: var(--clib-ink3); word-break: break-all; }
.clib-path-row{ display: flex; align-items: flex-start; gap: 4px; }
.clib-path-row .clib-path-line{ flex: 1; min-width: 0; }
.clib-icon-btn{
  flex: none; display: inline-flex; align-items: center; justify-content: center;
  width: 20px; height: 20px; padding: 0; border: .5px solid var(--clib-line); border-radius: 5px;
  background: var(--clib-card); color: var(--clib-ink3); cursor: pointer; line-height: 1;
}
.clib-icon-btn:hover{ color: var(--clib-ink); border-color: var(--clib-ink3); }
.clib-icon-btn:disabled{ opacity: .45; cursor: default; }
.clib-chips{ display: flex; flex-wrap: wrap; gap: 4px; }

.clib-preview{ display: flex; flex-direction: column; gap: 5px; }
.clib-preview-head{ display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 10.5px; color: var(--clib-ink3); }
.clib-code-wrap{
  display: flex; max-height: 330px; overflow: auto; border: .5px solid var(--clib-line);
  border-radius: var(--clib-r); background: var(--clib-card); font-family: var(--clib-mono); font-size: 11px; line-height: 1.6;
}
.clib-code-gutter{
  flex: none; padding: 8px 6px 8px 8px; text-align: right; color: var(--clib-ink3);
  background: color-mix(in srgb, var(--clib-ink) 4%, transparent);
  border-right: .5px solid var(--clib-line); user-select: none; font-variant-numeric: tabular-nums;
}
.clib-code{
  margin: 0; padding: 8px 10px 8px 8px; white-space: pre; color: var(--clib-ink);
  font-family: inherit; font-size: inherit; line-height: inherit; flex: 1;
}
.clib-image-wrap{
  border: .5px solid var(--clib-line); border-radius: var(--clib-r); overflow: hidden;
  background-color: var(--clib-card);
  background-image: linear-gradient(45deg, color-mix(in srgb, var(--clib-ink) 6%, transparent) 25%, transparent 25%),
    linear-gradient(-45deg, color-mix(in srgb, var(--clib-ink) 6%, transparent) 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, color-mix(in srgb, var(--clib-ink) 6%, transparent) 75%),
    linear-gradient(-45deg, transparent 75%, color-mix(in srgb, var(--clib-ink) 6%, transparent) 75%);
  background-size: 16px 16px; background-position: 0 0, 0 8px, 8px -8px, -8px 0;
  display: flex; align-items: center; justify-content: center; min-height: 120px; padding: 6px;
}
.clib-image-wrap img{ max-width: 100%; max-height: 340px; object-fit: contain; display: block; }
.clib-doc-text{
  display: flex; flex-direction: column; gap: 4px; max-height: 330px; overflow: auto;
  border: .5px solid var(--clib-line); border-radius: var(--clib-r); background: var(--clib-card);
  font-family: var(--clib-mono); font-size: 11px; line-height: 1.6;
}
.clib-doc-text .clib-code{ white-space: pre-wrap; word-break: break-word; }
.clib-hint{
  padding: 8px 10px; border-radius: var(--clib-r); background: var(--clib-card);
  border: .5px solid var(--clib-line); color: var(--clib-ink3); font-size: 11.5px;
}
.clib-confirm{
  display: flex; flex-direction: column; gap: 7px; padding: 10px;
  border-radius: var(--clib-r); border: .5px solid color-mix(in srgb, var(--clib-danger) 40%, transparent);
  background: color-mix(in srgb, var(--clib-danger) 7%, transparent);
}
.clib-confirm b{ font-size: 12px; color: var(--clib-ink); }
.clib-confirm p{ margin: 0; font-size: 11.5px; color: var(--clib-ink2); }
.clib-confirm-row{ display: flex; gap: 7px; justify-content: flex-end; }

/* ---------------------------------------------------------------- 弹窗 / toast */
.clib-overlay{
  position: fixed; inset: 0; z-index: 60; display: flex; align-items: center; justify-content: center;
  padding: 20px; background: rgb(0 0 0 / .32); backdrop-filter: blur(2px);
}
.clib-dialog{
  width: min(520px, 100%); max-height: 86vh; overflow: auto; display: flex; flex-direction: column; gap: 10px;
  padding: 16px; border-radius: var(--clib-r-lg); border: .5px solid var(--clib-line);
  background: var(--clib-bg); box-shadow: 0 20px 60px rgb(0 0 0 / .22);
}
.clib-dialog h3{ margin: 0; font-size: 14px; font-weight: 650; }
.clib-dialog textarea{ min-height: 190px; font-family: var(--clib-mono); font-size: 12px; }
.clib-dialog-actions{ display: flex; justify-content: flex-end; gap: 7px; }

.clib-toasts{
  position: fixed; top: 14px; right: 14px; z-index: 80; display: flex; flex-direction: column; gap: 8px;
  width: min(420px, calc(100vw - 28px)); pointer-events: none;
}
.clib-toast{
  pointer-events: auto; padding: 9px 10px 9px 12px; border-radius: 10px;
  border: .5px solid var(--clib-line); border-left: 3px solid var(--clib-accent);
  background: var(--clib-bg); color: var(--clib-ink);
  box-shadow: 0 10px 34px rgb(0 0 0 / .16); font-size: 12px;
  animation: clib-toast-in .18s ease-out;
}
.clib-toast.is-error{ border-left-color: var(--clib-danger); }
.clib-toast.is-warn{ border-left-color: var(--clib-warn); }
.clib-toast.is-ok{ border-left-color: var(--clib-ok); }
.clib-toast-top{ display: flex; align-items: flex-start; gap: 8px; }
.clib-toast-title{ flex: 1; font-weight: 600; }
.clib-toast-close{
  flex: none; width: 20px; height: 20px; padding: 0; border: 0; border-radius: 5px;
  background: transparent; color: var(--clib-ink3); display: inline-flex; align-items: center; justify-content: center;
}
.clib-toast-close:hover{ background: var(--clib-hover); color: var(--clib-ink); }
.clib-toast-body{ margin-top: 3px; color: var(--clib-ink2); white-space: pre-wrap; word-break: break-word; }
.clib-toast-line{ font-size: 11.5px; line-height: 1.45; }
.clib-toast-line.is-bad{ color: var(--clib-danger); }
@keyframes clib-toast-in{ from{ opacity: 0; transform: translateY(-6px); } to{ opacity: 1; transform: none; } }

/* ---------------------------------------------------------------- 窄屏 */
@media (max-width: 1080px){
  .clib-body{ grid-template-columns: 188px minmax(0, 1fr) minmax(290px, 350px); }
}
@media (max-width: 900px){
  .clib-body{ grid-template-columns: minmax(0, 1fr) minmax(300px, 380px); }
  .clib-side{ display: none; }
}
@media (max-width: 720px){
  .clib-body{ grid-template-columns: minmax(0, 1fr); position: relative; }
  .clib-detail{ position: absolute; inset: 0; z-index: 7; display: none; }
  .clib-detail.is-open{ display: flex; }
  .clib-list-head{ padding: 7px 10px; }
  .clib-toolbar{ padding: 8px 10px; }
  .clib-brand small{ display: none; }
}
`

/** 幂等地把样式塞进 <head>；返回拆除函数，HMR 重跑 apply 时可以摘掉。 */
export function injectStylesOnce(doc = document) {
  const id = 'clib-styles'
  doc.getElementById(id)?.remove()
  const style = doc.createElement('style')
  style.id = id
  style.textContent = CSS
  doc.head.appendChild(style)
  return () => style.remove()
}
