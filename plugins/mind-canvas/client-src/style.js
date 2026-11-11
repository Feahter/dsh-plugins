// 颜色全部走宿主 DSH 语义 token，明暗主题由宿主负责；这里只管排版和手感。
export const CSS = String.raw`
/* 每个颜色都是「主题变量 --mc-* 优先，否则退回宿主 DSH token」：
   theme.js 只产出 --mc-* 覆盖，preset=auto 时一个都不给，于是完全跟随宿主明暗主题。 */
.mc-root{
  --ink: var(--mc-text, var(--dsw-alias-label-primary));
  --ink2: var(--mc-text-dim, var(--dsw-alias-label-secondary));
  --ink3: color-mix(in srgb, var(--ink2) 72%, transparent);
  --bg: var(--mc-bg, var(--dsw-alias-bg-base));
  --card: var(--mc-card, var(--dsw-alias-bg-layer-2));
  --layer1: var(--mc-card, var(--dsw-alias-bg-layer-1));
  --line: var(--mc-line, var(--dsw-alias-border-l1));
  --line-strong: var(--mc-edge, var(--dsw-alias-border-l2));
  --hover: color-mix(in srgb, var(--ink) 7%, transparent);
  --active: color-mix(in srgb, var(--ink) 12%, transparent);
  --accent: var(--mc-accent, var(--dsw-alias-brand-primary));
  --danger: var(--dsw-alias-state-error-primary);
  --tone-a: var(--mc-tone-a, #3a5bd9);
  --tone-b: var(--mc-tone-b, #0f8f6d);
  --tone-c: var(--mc-tone-c, #b1661b);
  --tone-d: var(--mc-tone-d, #a03a86);
  --tone-e: var(--mc-tone-e, #2f7fa8);
  --tone-f: var(--mc-tone-f, #6b5bd0);
  --ease: cubic-bezier(.2,.8,.2,1);
  --r-lg: var(--dsw-radius-lg, 16px);
  --r-md: var(--dsw-radius-md, 12px);
  --r-sm: var(--dsw-radius-sm, 8px);
  position: absolute; inset: 0; display: flex; flex-direction: column; overflow: hidden;
  background: var(--bg); color: var(--ink); font-size: 13px; line-height: 1.5;
  container-type: inline-size;
}
body[data-ds-dark-theme] .mc-root{ color-scheme: dark; }

/* ---------------------------------------------------------------- 顶栏 */
.mc-bar{
  flex: none; display: flex; align-items: center; gap: 8px; padding: 10px 14px;
  border-bottom: .5px solid var(--line); background: color-mix(in srgb, var(--bg) 88%, transparent);
  backdrop-filter: blur(20px) saturate(160%); position: relative; z-index: 6; min-height: 52px; flex-wrap: wrap;
}
.mc-back{ flex: none; padding-left: 7px; color: var(--ink2); }
.mc-back:hover{ color: var(--ink); }
.mc-brand{ display: flex; flex-direction: column; gap: 1px; margin-right: 4px; }
.mc-brand b{ font-size: 13.5px; font-weight: 650; letter-spacing: .2px; }
.mc-brand small{ font-size: 10.5px; color: var(--ink3); }
.mc-grow{ flex: 1; min-width: 0; }

.mc-select, .mc-input, .mc-textarea{
  font: inherit; color: var(--ink); background: var(--card); border: .5px solid var(--line);
  border-radius: var(--r-sm); padding: 5px 8px; outline: none;
}
.mc-select:hover, .mc-input:hover{ border-color: var(--line-strong); }
.mc-select:focus-visible, .mc-input:focus-visible, .mc-textarea:focus-visible{
  border-color: var(--accent); box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 22%, transparent);
}
.mc-select{ max-width: 240px; cursor: pointer; }

.mc-btn{
  display: inline-flex; align-items: center; gap: 5px; font: inherit; font-size: 12px; cursor: pointer;
  padding: 5px 10px; border-radius: 999px; border: .5px solid var(--line); background: transparent; color: var(--ink);
  transition: background .16s var(--ease), border-color .16s var(--ease), transform .12s var(--ease);
  white-space: nowrap;
}
.mc-btn:hover{ background: var(--hover); border-color: var(--line-strong); }
.mc-btn:active{ transform: scale(.97); }
.mc-btn[disabled]{ opacity: .45; cursor: not-allowed; }
.mc-btn.is-primary{ background: var(--accent); border-color: transparent; color: var(--dsw-alias-label-primary-foreground, #fff); }
.mc-btn.is-primary:hover{ filter: brightness(1.06); background: var(--accent); }
.mc-btn.is-danger{ color: var(--danger); border-color: color-mix(in srgb, var(--danger) 40%, transparent); }
.mc-btn.is-danger:hover{ background: color-mix(in srgb, var(--danger) 12%, transparent); }
.mc-icon{ width: 28px; height: 28px; padding: 0; justify-content: center; border-radius: 8px; }
.mc-btn svg{ flex: none; }

.mc-split{ display: inline-flex; align-items: center; border: .5px solid var(--line); border-radius: 999px; overflow: hidden; }
.mc-split .mc-btn{ border: 0; border-radius: 0; }
.mc-split .mc-btn + .mc-btn{ border-left: .5px solid var(--line); }

/* ---------------------------------------------------------------- 画布 */
.mc-stage{ position: absolute; inset: 0; overflow: hidden; }
.mc-stage .react-flow{ background: transparent; }
.mc-stage .react-flow__pane{ cursor: grab; }
.mc-stage .react-flow__pane.dragging{ cursor: grabbing; }
.mc-stage .react-flow__attribution{ font-size: 9px; opacity: .4; }
.mc-stage .react-flow__attribution a{ color: var(--ink3); }
.mc-stage .react-flow__controls{
  border-radius: var(--r-md); overflow: hidden; box-shadow: var(--dsw-elevation-soft, 0 6px 20px rgb(0 0 0 / .12));
  border: .5px solid var(--line); background: var(--card);
}
.mc-stage .react-flow__controls-button{
  background: var(--card); border-bottom: .5px solid var(--line); color: var(--ink);
}
.mc-stage .react-flow__controls-button:hover{ background: var(--hover); }
.mc-stage .react-flow__controls-button svg{ fill: currentColor; }
.mc-stage .react-flow__minimap{
  background: color-mix(in srgb, var(--card) 82%, transparent); border-radius: var(--r-md);
  border: .5px solid var(--line); overflow: hidden;
}
.mc-stage .react-flow__minimap-mask{ fill: color-mix(in srgb, var(--bg) 62%, transparent); }

/* 点阵底纹：跟随缩放自己画，不参与世界变换 */
.mc-grid{
  position: absolute; inset: 0; pointer-events: none; z-index: 0;
  background-image: radial-gradient(circle, color-mix(in srgb, var(--ink) 10%, transparent) 1px, transparent 1.2px);
  background-size: 26px 26px;
}

/* ---------------------------------------------------------------- 节点卡片 */
.mc-node{ width: 208px; }
.mc-card{
  --tone: var(--accent);
  position: relative; width: 100%; box-sizing: border-box; text-align: left;
  border: .5px solid var(--line-strong); border-left: 3px solid var(--tone);
  border-radius: var(--r-md); padding: 9px 11px 10px;
  background: color-mix(in srgb, var(--tone) 8%, var(--card));
  color: var(--ink);
  box-shadow: 0 1px 2px rgb(0 0 0 / .06), 0 8px 20px -14px rgb(0 0 0 / .4);
  transition: box-shadow .18s var(--ease), border-color .18s var(--ease), transform .18s var(--ease);
  cursor: grab;
}
.mc-node[data-tone="a"] .mc-card{ --tone: var(--tone-a) }
.mc-node[data-tone="b"] .mc-card{ --tone: var(--tone-b) }
.mc-node[data-tone="c"] .mc-card{ --tone: var(--tone-c) }
.mc-node[data-tone="d"] .mc-card{ --tone: var(--tone-d) }
.mc-node[data-tone="e"] .mc-card{ --tone: var(--tone-e) }
.mc-node[data-tone="f"] .mc-card{ --tone: var(--tone-f) }
.mc-node:hover .mc-card{ box-shadow: 0 1px 2px rgb(0 0 0 / .07), 0 14px 30px -16px rgb(0 0 0 / .5); }
.mc-node.is-selected .mc-card{
  border-color: color-mix(in srgb, var(--tone) 62%, var(--line-strong));
  box-shadow: 0 0 0 1.5px color-mix(in srgb, var(--tone) 50%, transparent), 0 14px 30px -16px rgb(0 0 0 / .45);
}
.mc-node.is-root .mc-card{ border-left-width: 5px; }
.mc-card-text{
  display: block; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 12.5px; line-height: 1.55;
  max-height: 96px; overflow: hidden;
}
.mc-card-text.is-empty{ color: var(--ink3); }
.mc-card-badge{
  display: inline-flex; align-items: center; gap: 3px; margin-top: 5px; font-size: 9.5px;
  color: var(--ink3); letter-spacing: .3px; text-transform: uppercase;
}
.mc-card-edit{
  width: 100%; box-sizing: border-box; font: inherit; font-size: 12.5px; line-height: 1.55; color: var(--ink);
  background: color-mix(in srgb, var(--bg) 55%, transparent); border: .5px solid var(--line-strong);
  border-radius: var(--r-sm); padding: 5px 6px; resize: vertical; min-height: 56px; outline: none;
}
.mc-card-edit:focus{ border-color: var(--accent); }
.mc-node .react-flow__handle{
  width: 7px; height: 7px; background: var(--card); border: 1px solid color-mix(in srgb, var(--tone) 70%, var(--line-strong));
  opacity: 0; transition: opacity .15s var(--ease);
}
.mc-node:hover .react-flow__handle, .mc-node.is-selected .react-flow__handle{ opacity: .9; }

.mc-collapse{
  position: absolute; right: -11px; top: 50%; transform: translateY(-50%); z-index: 3;
  width: 20px; height: 20px; border-radius: 50%; display: grid; place-items: center; cursor: pointer;
  background: var(--card); border: .5px solid var(--line-strong); color: var(--ink2);
  font-size: 10px; line-height: 1; box-shadow: 0 2px 6px rgb(0 0 0 / .12);
}
.mc-collapse:hover{ background: var(--hover); color: var(--ink); }
.mc-collapse[data-hidden="true"]{ right: auto; left: -11px; color: var(--accent); border-color: color-mix(in srgb, var(--accent) 55%, var(--line-strong)); }

/* ---------------------------------------------------------------- 菜单 / 色板 / 主题 */
.mc-anchor{ position: relative; display: inline-flex; }
.mc-menu{
  position: absolute; top: calc(100% + 6px); right: 0; z-index: 20; min-width: 200px;
  padding: 5px; border-radius: var(--r-md); background: var(--card); border: .5px solid var(--line-strong);
  box-shadow: var(--dsw-elevation-prominent, 0 18px 44px rgb(0 0 0 / .22));
  display: flex; flex-direction: column; gap: 1px; animation: mc-pop .14s var(--ease);
}
.mc-menu-title{ padding: 5px 9px 3px; font-size: 10.5px; color: var(--ink3); letter-spacing: .3px; }
.mc-menu-item{
  display: flex; align-items: center; gap: 8px; width: 100%; text-align: left; font: inherit; font-size: 12px;
  padding: 6px 9px; border: 0; border-radius: var(--r-sm); background: transparent; color: var(--ink); cursor: pointer;
}
.mc-menu-item:hover{ background: var(--hover); }
.mc-menu-item[data-on="true"]{ color: var(--accent); }
.mc-menu-item small{ margin-left: auto; color: var(--ink3); font-size: 10px; }
.mc-menu-item .mc-dot{ width: 10px; height: 10px; border-radius: 50%; flex: none; box-shadow: inset 0 0 0 1px rgb(0 0 0 / .18); }
.mc-menu-sep{ height: .5px; margin: 3px 6px; background: var(--line); }
.mc-menu-check{ margin-left: auto; color: var(--accent); }

.mc-swatches{
  position: absolute; top: 58px; left: 50%; transform: translateX(-50%); z-index: 20;
  display: flex; gap: 6px; padding: 7px 9px; border-radius: 999px; background: var(--card);
  border: .5px solid var(--line-strong); box-shadow: var(--dsw-elevation-prominent, 0 18px 44px rgb(0 0 0 / .22));
  animation: mc-pop .14s var(--ease);
}
.mc-swatch{
  width: 20px; height: 20px; padding: 0; border-radius: 50%; cursor: pointer; border: .5px solid rgb(0 0 0 / .18);
  transition: transform .12s var(--ease);
}
.mc-swatch:hover{ transform: scale(1.12); }
.mc-swatch[data-on="true"]{ box-shadow: 0 0 0 2px var(--bg), 0 0 0 3.5px var(--ink); }
.mc-swatch.is-auto{ background: conic-gradient(from 210deg, #3a5bd9, #0f8f6d, #b1661b, #a03a86, #3a5bd9); }

.mc-theme-grid{ display: flex; flex-direction: column; gap: 6px; }
.mc-theme-row{ display: grid; grid-template-columns: 1fr auto 76px; align-items: center; gap: 8px; font-size: 11.5px; color: var(--ink2); }
.mc-theme-row input[type="color"]{
  width: 28px; height: 24px; padding: 0; border: .5px solid var(--line-strong); border-radius: 6px;
  background: transparent; cursor: pointer;
}
.mc-theme-row code{ font-family: var(--dsh-font-family-code, ui-monospace, Menlo, monospace); font-size: 10.5px; color: var(--ink3); }
.mc-preset-row{ display: flex; flex-wrap: wrap; gap: 6px; }

/* ---------------------------------------------------------------- 空态 */
.mc-empty{
  position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 14px; pointer-events: none; z-index: 2; padding: 24px; text-align: center;
}
.mc-empty-card{
  pointer-events: auto; width: min(440px, 100%); display: flex; flex-direction: column; gap: 10px;
  padding: 22px; border-radius: var(--r-lg); border: .5px solid var(--line); background: color-mix(in srgb, var(--card) 90%, transparent);
  box-shadow: var(--dsw-elevation-soft, 0 10px 30px rgb(0 0 0 / .1)); backdrop-filter: blur(18px);
}
.mc-empty-card h2{ margin: 0; font-size: 15px; font-weight: 620; }
.mc-empty-row{ display: flex; gap: 8px; }
.mc-empty-row .mc-input{ flex: 1; min-width: 0; }
.mc-empty-hint{ font-size: 11px; color: var(--ink3); }

/* ---------------------------------------------------------------- 浮动工具条 */
.mc-toolbar{
  position: absolute; top: 12px; left: 50%; transform: translateX(-50%); z-index: 5;
  display: flex; align-items: center; gap: 6px; padding: 6px 8px; border-radius: 999px;
  background: color-mix(in srgb, var(--card) 92%, transparent); border: .5px solid var(--line-strong);
  box-shadow: var(--dsw-elevation-soft, 0 8px 24px rgb(0 0 0 / .12)); backdrop-filter: blur(18px);
  max-width: min(94cqw, 760px); overflow-x: auto; scrollbar-width: none;
}
.mc-toolbar::-webkit-scrollbar{ display: none; }
.mc-toolbar-hint{ font-size: 11px; color: var(--ink3); padding: 0 6px; white-space: nowrap; }

.mc-corner{
  position: absolute; right: 14px; bottom: 40px; z-index: 5; display: flex; align-items: center; gap: 6px;
  font-size: 11px; color: var(--ink3); padding: 5px 9px; border-radius: 999px;
  background: color-mix(in srgb, var(--card) 88%, transparent); border: .5px solid var(--line);
  backdrop-filter: blur(14px); pointer-events: none;
}

/* ---------------------------------------------------------------- 弹层 */
.mc-scrim{
  position: absolute; inset: 0; z-index: 30; display: grid; place-items: center; padding: 20px;
  background: color-mix(in srgb, var(--bg) 55%, transparent); backdrop-filter: blur(3px);
  animation: mc-fade .16s var(--ease);
}
.mc-dialog{
  width: min(520px, 100%); max-height: min(88%, 620px); display: flex; flex-direction: column; overflow: hidden;
  border-radius: var(--r-lg); border: .5px solid var(--line-strong); background: var(--card);
  box-shadow: var(--dsw-elevation-prominent, 0 24px 60px rgb(0 0 0 / .3));
  animation: mc-pop .2s var(--ease);
}
.mc-dialog header{ display: flex; align-items: center; gap: 8px; padding: 14px 16px 10px; }
.mc-dialog header h3{ margin: 0; font-size: 14px; font-weight: 640; flex: 1; }
.mc-dialog .mc-body{ padding: 0 16px 12px; overflow: auto; display: flex; flex-direction: column; gap: 10px; }
.mc-dialog footer{ display: flex; justify-content: flex-end; gap: 8px; padding: 12px 16px; border-top: .5px solid var(--line); }
.mc-dialog p{ margin: 0; font-size: 12px; color: var(--ink2); }
.mc-label{ display: flex; flex-direction: column; gap: 4px; font-size: 11.5px; color: var(--ink2); }
.mc-textarea{ resize: vertical; min-height: 62px; font-family: inherit; }
.mc-count{ display: flex; gap: 6px; flex-wrap: wrap; }
.mc-count .mc-btn{ min-width: 36px; justify-content: center; }
.mc-count .mc-btn.is-on{ background: color-mix(in srgb, var(--accent) 16%, transparent); border-color: var(--accent); color: var(--ink); }

.mc-picks{ display: flex; flex-direction: column; gap: 4px; }
.mc-pick{
  display: flex; align-items: flex-start; gap: 8px; padding: 7px 9px; border-radius: var(--r-sm);
  border: .5px solid transparent; cursor: pointer; font-size: 12px; line-height: 1.5;
}
.mc-pick:hover{ background: var(--hover); }
.mc-pick.is-on{ background: color-mix(in srgb, var(--accent) 12%, transparent); border-color: color-mix(in srgb, var(--accent) 40%, transparent); }
.mc-pick input{ margin: 3px 0 0; flex: none; accent-color: var(--accent); }
.mc-pick span{ min-width: 0; overflow-wrap: anywhere; }
.mc-pick small{ display: block; color: var(--ink3); font-size: 10.5px; }

.mc-toast{
  position: absolute; left: 50%; bottom: 18px; transform: translateX(-50%); z-index: 40;
  padding: 7px 14px; border-radius: 999px; font-size: 12px; max-width: 80%;
  background: var(--dsw-alias-bg-overlay, var(--card)); color: var(--ink);
  border: .5px solid var(--line-strong); box-shadow: var(--dsw-elevation-soft, 0 8px 24px rgb(0 0 0 / .16));
  animation: mc-rise .2s var(--ease);
}
.mc-toast[data-kind="error"]{ color: var(--danger); border-color: color-mix(in srgb, var(--danger) 45%, transparent); }

.mc-center{ flex: 1; display: grid; place-items: center; padding: 30px; color: var(--ink2); font-size: 12.5px; }

@keyframes mc-fade{ from{ opacity: 0 } }
@keyframes mc-pop{ from{ opacity: 0; transform: translateY(8px) scale(.985) } }
@keyframes mc-rise{ from{ opacity: 0; transform: translate(-50%, 8px) } }

@media (prefers-reduced-motion: reduce){
  .mc-root *{ animation-duration: .001ms !important; transition-duration: .001ms !important; }
}
@container (max-width: 900px){
  .mc-back span{ display: none; }
}
@container (max-width: 620px){
  .mc-brand small{ display: none; }
  .mc-bar{ padding: 8px 10px; gap: 6px; }
  .mc-select{ max-width: 130px; }
}
`
