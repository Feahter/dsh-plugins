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
.clib-select{
  height: 30px; cursor: pointer; max-width: 150px; min-width: 0; padding: 0 24px 0 10px;
  border-radius: 999px; appearance: none; -webkit-appearance: none; text-overflow: ellipsis;
  background-color: var(--clib-card);
  background-image: url("data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20width='10'%20height='6'%20viewBox='0%200%2010%206'%3E%3Cpath%20d='M1%201l4%204%204-4'%20fill='none'%20stroke='%236b7280'%20stroke-width='1.4'%20stroke-linecap='round'%20stroke-linejoin='round'/%3E%3C/svg%3E");
  background-repeat: no-repeat; background-position: right 9px center; background-size: 9px 6px;
}
html[data-theme='dark'] .clib-select, body[data-ds-dark-theme] .clib-select{
  background-image: url("data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20width='10'%20height='6'%20viewBox='0%200%2010%206'%3E%3Cpath%20d='M1%201l4%204%204-4'%20fill='none'%20stroke='%239aa3ad'%20stroke-width='1.4'%20stroke-linecap='round'%20stroke-linejoin='round'/%3E%3C/svg%3E");
}
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
.clib-body{ flex: 1; min-height: 0; display: grid; position: relative; grid-template-columns: 214px minmax(0, 1fr) minmax(320px, 408px); }
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

/* ---------------------------------------------------------------- 全屏预览 */
.clib-fs{
  position: absolute; inset: 0; z-index: 50;
  display: flex; align-items: stretch; justify-content: center;
  background: rgb(0 0 0 / .40); backdrop-filter: blur(2px);
  animation: clib-fs-fade .14s ease-out;
}
@keyframes clib-fs-fade{ from{ opacity: 0; } to{ opacity: 1; } }
.clib-fs-card{
  position: relative; flex: 1; min-width: 0; min-height: 0; margin: 14px;
  display: flex; flex-direction: column; overflow: hidden;
  border-radius: var(--clib-r-lg); border: .5px solid var(--clib-line-strong);
  background: var(--clib-bg); color: var(--clib-ink);
  box-shadow: 0 24px 70px rgb(0 0 0 / .35), 0 2px 8px rgb(0 0 0 / .18);
}
.clib-fs-head{
  flex: none; display: flex; align-items: center; gap: 10px;
  padding: 9px 10px 9px 14px; border-bottom: .5px solid var(--clib-line);
  background: color-mix(in srgb, var(--clib-card) 76%, transparent);
}
.clib-fs-title{
  flex: 1; min-width: 0; font-size: 12px; font-weight: 600; color: var(--clib-ink2);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.clib-fs-tools{ flex: none; display: inline-flex; align-items: center; gap: 8px; }
.clib-fs-close{ width: 24px; height: 24px; border-radius: 7px; }
.clib-fs-modes{
  display: inline-flex; gap: 2px; padding: 2px; border-radius: 999px;
  border: .5px solid var(--clib-line); background: var(--clib-card);
}
.clib-fs-mode{
  height: 22px; padding: 0 10px; border: 0; border-radius: 999px; background: transparent;
  color: var(--clib-ink3); font: inherit; font-size: 11px; cursor: pointer;
}
.clib-fs-mode:hover{ color: var(--clib-ink); }
.clib-fs-mode.is-on{ background: var(--clib-bg); color: var(--clib-accent); font-weight: 600; box-shadow: 0 1px 2px rgb(0 0 0 / .12); }
.clib-fs-mode:focus-visible{ outline: none; box-shadow: 0 0 0 2px color-mix(in srgb, var(--clib-accent) 30%, transparent); }
.clib-fs-body{
  flex: 1; min-height: 0; display: flex; flex-direction: column; overflow: auto;
  padding: 14px 16px 18px;
}
.clib-fs-body .clib-code-wrap{ max-height: none; overflow: visible; flex: none; }
.clib-fs-body .clib-doc-text{ max-height: none; overflow: visible; flex: none; }
.clib-fs-body .clib-image-wrap{ flex: 1; min-height: 0; }
.clib-fs-body .clib-image-wrap img{ max-height: 100%; }
.clib-fs-body .clib-hint{ flex: none; }
.clib-fs-open{ color: var(--clib-ink3); }
.clib-fs-open:hover{ color: var(--clib-accent); }

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

/* ---------------------------------------------------------------- 视图：分段控件 / 卡片 / 表格 / 图库 */
.clib-seg{
  display: inline-flex; align-items: center; gap: 2px; padding: 2px;
  border: .5px solid var(--clib-line); border-radius: 999px; background: var(--clib-card);
}
.clib-seg-btn{
  height: 24px; padding: 0 9px; border: 0; border-radius: 999px; background: transparent;
  color: var(--clib-ink3); font-size: 11px; font-family: inherit; cursor: pointer; white-space: nowrap;
}
.clib-seg-btn:hover{ color: var(--clib-ink); }
.clib-seg-btn.is-on{ background: var(--clib-bg); color: var(--clib-ink); font-weight: 600; box-shadow: 0 1px 3px rgb(0 0 0 / .12); }
.clib-seg-sm{ padding: 1px; }
.clib-seg-sm .clib-seg-btn{ height: 20px; padding: 0 7px; font-size: 10.5px; }

.clib-cards{
  display: grid; gap: 10px; padding: 12px; align-content: start;
  grid-template-columns: repeat(auto-fill, minmax(178px, 1fr));
}
.clib-card{
  display: flex; flex-direction: column; min-width: 0; padding: 0; overflow: hidden; text-align: left;
  border: .5px solid var(--clib-line); border-radius: var(--clib-r-lg); background: var(--clib-bg);
  color: inherit; font-family: inherit; cursor: pointer;
}
.clib-card:hover{ border-color: var(--clib-line-strong); box-shadow: 0 6px 18px rgb(0 0 0 / .09); }
.clib-card.is-on{ border-color: var(--clib-accent); box-shadow: 0 0 0 2px color-mix(in srgb, var(--clib-accent) 22%, transparent); }
.clib-card-thumb{
  position: relative; flex: none; height: 104px; display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 6px; overflow: hidden; border-bottom: .5px solid var(--clib-line); background: var(--clib-card);
}
.clib-card-thumb img{ width: 100%; height: 100%; object-fit: cover; display: block; }
.clib-card-glyph{ color: var(--clib-ink3); display: flex; }
.clib-card-snippet{
  font-size: 10px; line-height: 1.4; color: var(--clib-ink3); padding: 0 10px; text-align: center;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; word-break: break-word;
}
.clib-card-body{ display: flex; flex-direction: column; gap: 5px; padding: 8px 10px 10px; min-width: 0; }
.clib-card-title{
  font-size: 12.5px; font-weight: 600; line-height: 1.35; color: var(--clib-ink); word-break: break-word;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.clib-card-meta{ display: flex; align-items: center; flex-wrap: wrap; gap: 4px; font-size: 10px; color: var(--clib-ink3); }
.clib-card-tags{ display: flex; flex-wrap: wrap; gap: 4px; }

.clib-table-wrap{ min-height: 100%; }
.clib-table{ width: 100%; border-collapse: collapse; font-size: 11.5px; }
.clib-table th{
  position: sticky; top: 0; z-index: 1; height: 30px; padding: 0 10px; text-align: left; font-weight: 600;
  background: var(--clib-bg); border-bottom: .5px solid var(--clib-line-strong); color: var(--clib-ink3); white-space: nowrap;
}
.clib-table th.clib-th-sort{ padding: 0; }
.clib-table th .clib-th-btn{
  display: inline-flex; align-items: center; gap: 3px; width: 100%; height: 30px; padding: 0 10px;
  border: 0; background: transparent; color: inherit; font: inherit; cursor: pointer; text-align: left;
}
.clib-table th .clib-th-btn:hover, .clib-table th .clib-th-btn.is-on{ color: var(--clib-ink); }
.clib-sort-mark{ font-size: 9px; color: var(--clib-accent); }
.clib-table td{ padding: 7px 10px; border-bottom: .5px solid var(--clib-line); vertical-align: top; color: var(--clib-ink2); }
.clib-table tbody tr{ cursor: pointer; }
.clib-table tbody tr:hover{ background: var(--clib-hover); }
.clib-table tbody tr.is-on{ background: var(--clib-active); }
.clib-table tbody tr.is-on .clib-td-title strong{ color: var(--clib-accent); }
.clib-td-title{ color: var(--clib-ink); }
.clib-td-title-row{ display: flex; align-items: flex-start; gap: 5px; }
.clib-td-title-row svg{ flex: none; margin-top: 2px; color: var(--clib-ink3); }
.clib-td-title-row strong{ font-weight: 600; word-break: break-word; }
.clib-table .clib-num{ white-space: nowrap; font-variant-numeric: tabular-nums; color: var(--clib-ink3); font-size: 10.5px; }
.clib-table-tags{ display: inline-flex; flex-wrap: wrap; gap: 3px; }

.clib-gallery{
  display: grid; gap: 10px; padding: 12px; align-content: start;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
}
.clib-gal{
  position: relative; aspect-ratio: 4 / 3; overflow: hidden; padding: 0; cursor: pointer;
  border: .5px solid var(--clib-line); border-radius: var(--clib-r); background: var(--clib-card);
}
.clib-gal:hover{ border-color: var(--clib-line-strong); }
.clib-gal.is-on{ border-color: var(--clib-accent); box-shadow: 0 0 0 2px color-mix(in srgb, var(--clib-accent) 22%, transparent); }
.clib-gal img{ width: 100%; height: 100%; object-fit: cover; display: block; }
.clib-gal-cap{
  position: absolute; left: 0; right: 0; bottom: 0; padding: 16px 8px 6px; color: #fff; font-size: 10px;
  text-align: left; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  background: linear-gradient(transparent, rgb(0 0 0 / .68));
}

/* ---------------------------------------------------------------- Markdown 渲染 */
.clib-md{
  max-height: 360px; overflow: auto; padding: 10px 12px; font-size: 12.5px; line-height: 1.62;
  border: .5px solid var(--clib-line); border-radius: var(--clib-r); background: var(--clib-card);
  color: var(--clib-ink); word-break: break-word;
}
.clib-md.is-plain{ max-height: 300px; padding: 0; border: 0; background: transparent; }
.clib-md > :first-child{ margin-top: 0; }
.clib-md > :last-child{ margin-bottom: 0; }
.clib-md h1, .clib-md h2, .clib-md h3, .clib-md h4, .clib-md h5, .clib-md h6{
  margin: 12px 0 6px; line-height: 1.35; color: var(--clib-ink);
}
.clib-md h1{ font-size: 17px; } .clib-md h2{ font-size: 15px; } .clib-md h3{ font-size: 13.5px; }
.clib-md h4, .clib-md h5, .clib-md h6{ font-size: 12.5px; }
.clib-md p{ margin: 0 0 8px; }
.clib-md ul, .clib-md ol{ margin: 0 0 8px; padding-left: 20px; }
.clib-md li{ margin: 2px 0; }
.clib-md code{
  font-family: var(--clib-mono); font-size: 10.5px; padding: 1px 4px; border-radius: 4px;
  background: var(--clib-layer); border: .5px solid var(--clib-line);
}
.clib-md pre{
  margin: 0 0 8px; padding: 8px 10px; overflow: auto; border-radius: 6px;
  background: var(--clib-layer); border: .5px solid var(--clib-line);
}
.clib-md pre code{ padding: 0; border: 0; background: none; font-size: 11px; line-height: 1.55; white-space: pre; }
.clib-md a{ color: var(--clib-accent); text-decoration: none; }
.clib-md a:hover{ text-decoration: underline; }
.clib-md strong{ font-weight: 650; }
.clib-preview-tools{ display: inline-flex; align-items: center; gap: 8px; flex: none; }

/* ---------------------------------------------------------------- 助手抽屉 */
.clib-assist{
  position: absolute; top: 0; right: 0; bottom: 0; z-index: 30; width: 360px; max-width: 100%;
  display: flex; flex-direction: column; background: var(--clib-bg);
  border-left: .5px solid var(--clib-line-strong); box-shadow: -20px 0 54px rgb(0 0 0 / .2);
  animation: clib-assist-in .16s ease-out;
}
@keyframes clib-assist-in{ from{ opacity: 0; transform: translateX(14px); } to{ opacity: 1; transform: none; } }
.clib-assist-head{
  flex: none; display: flex; align-items: flex-start; gap: 8px; padding: 10px 10px 10px 12px;
  border-bottom: .5px solid var(--clib-line);
}
.clib-assist-head > svg{ flex: none; margin-top: 2px; color: var(--clib-accent); }
.clib-assist-titles{ flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.clib-assist-titles b{ font-size: 13px; font-weight: 650; color: var(--clib-ink); }
.clib-assist-titles small{ font-size: 10px; line-height: 1.4; color: var(--clib-ink3); word-break: break-word; }
.clib-assist-tabs{ flex: none; display: flex; gap: 2px; padding: 0 8px; border-bottom: .5px solid var(--clib-line); }
.clib-assist-tab{
  flex: 1; height: 34px; padding: 0; border: 0; border-bottom: 2px solid transparent;
  background: transparent; color: var(--clib-ink3); font-family: inherit; font-size: 12px; cursor: pointer;
}
.clib-assist-tab:hover{ color: var(--clib-ink); }
.clib-assist-tab.is-on{ color: var(--clib-accent); border-bottom-color: var(--clib-accent); font-weight: 600; }
.clib-assist-body{
  flex: 1; min-height: 0; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 10px;
}
.clib-assist-pane{ display: flex; flex-direction: column; gap: 10px; }
.clib-assist-hint{ font-size: 11.5px; line-height: 1.55; color: var(--clib-ink3); }
.clib-assist-warn{
  display: flex; align-items: flex-start; gap: 8px; padding: 8px 10px; border-radius: var(--clib-r);
  border: .5px solid color-mix(in srgb, var(--clib-warn) 45%, transparent);
  background: color-mix(in srgb, var(--clib-warn) 8%, transparent);
  color: var(--clib-ink2); font-size: 11.5px; line-height: 1.5;
}
.clib-assist-warn span{ flex: 1; min-width: 0; word-break: break-word; }
.clib-assist-card{
  display: flex; flex-direction: column; gap: 8px; padding: 10px;
  border: .5px solid var(--clib-line); border-radius: var(--clib-r); background: var(--clib-card);
}
.clib-assist-card-head{ display: flex; align-items: center; gap: 6px; font-size: 10.5px; color: var(--clib-ink3); }
.clib-assist-card-head b{ font-size: 11px; color: var(--clib-ink2); }
.clib-assist-meta{ font-size: 9.5px; color: var(--clib-ink3); }
.clib-assist-actions{ display: flex; align-items: center; gap: 7px; flex-wrap: wrap; }
.clib-assist-actions .clib-grow{ flex: 1; }
.clib-assist-change{ display: flex; align-items: flex-start; gap: 8px; padding: 6px 0; border-top: .5px solid var(--clib-line); }
.clib-assist-change:first-child{ border-top: 0; padding-top: 0; }
.clib-assist-change-main{ flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.clib-assist-change-label{ font-size: 9.5px; letter-spacing: .3px; text-transform: uppercase; color: var(--clib-ink3); }
.clib-assist-change-value{ font-size: 11.5px; color: var(--clib-ink); word-break: break-word; }
.clib-assist-done{ display: inline-flex; align-items: center; gap: 4px; font-size: 10.5px; color: var(--clib-ok); }
.clib-assist-error{ font-size: 10.5px; line-height: 1.45; color: var(--clib-danger); word-break: break-word; }
.clib-assist-empty{ padding: 14px 8px; text-align: center; font-size: 11.5px; line-height: 1.5; color: var(--clib-ink3); }
.clib-assist-ask{ display: flex; gap: 6px; }
.clib-assist-ask .clib-input{ flex: 1; min-width: 0; }
.clib-assist-table{ width: 100%; border-collapse: collapse; font-size: 10px; table-layout: fixed; }
.clib-assist-table th{
  padding: 0 4px 4px; text-align: left; font-weight: 600; color: var(--clib-ink3);
  border-bottom: .5px solid var(--clib-line); white-space: nowrap;
}
.clib-assist-table td{ padding: 6px 4px; vertical-align: top; border-bottom: .5px solid var(--clib-line); color: var(--clib-ink2); word-break: break-word; }
.clib-assist-table tr.is-done td{ opacity: .72; }
.clib-assist-td-title{ color: var(--clib-ink); font-weight: 600; }
.clib-assist-td-reason{ color: var(--clib-ink3); line-height: 1.45; }
.clib-assist-td-action{ white-space: nowrap; }
.clib-assist-error-row{ padding-top: 0; color: var(--clib-danger); line-height: 1.45; }
.clib-assist-tags{ display: flex; flex-wrap: wrap; gap: 3px; }
.clib-assist-result{ display: flex; flex-direction: column; gap: 6px; }
.clib-spin-inline{ display: inline-flex; align-items: center; }
@media (max-width: 720px){
  .clib-assist{ width: 100%; }
}

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
  .clib-select{ max-width: 124px; }
  .clib-fs-card{ margin: 8px; }
  .clib-fs-head{ padding: 8px 8px 8px 12px; }
  .clib-fs-body{ padding: 10px 12px 14px; }
  .clib-fs-mode{ padding: 0 8px; font-size: 10.5px; }
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
