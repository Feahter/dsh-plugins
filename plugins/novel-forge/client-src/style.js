// 一套 CSS：宣纸、墨、朱砂。没有渐变仪表盘，只有细线、留白和衬线标题。
// 主题变量挂在 .nf-root 上，暗色跟随 prefers-color-scheme 与宿主 data-ds-dark-theme。
export const CSS = String.raw`
.nf-root{
  --nf-paper: #f7f4ee;
  --nf-paper-2: #fbf9f4;
  --nf-card: #fffdf8;
  --nf-card-2: #f1ece1;
  --nf-ink: #1f1d1a;
  --nf-ink-2: #5c574e;
  --nf-ink-3: #8b8478;
  --nf-line: #e2dbcd;
  --nf-line-2: #d2c8b5;
  --nf-cinnabar: #b23a2f;
  --nf-cinnabar-2: #8f2c23;
  --nf-cinnabar-soft: rgba(178, 58, 47, .07);
  --nf-ok: #3f6b4f;
  --nf-warn: #9a6b1f;
  --nf-note: #5e6b7a;
  --nf-shadow: 0 1px 0 rgba(31, 29, 26, .03), 0 12px 32px -24px rgba(31, 29, 26, .4);
  --nf-serif: "Songti SC", "Noto Serif SC", "Source Han Serif SC", "STSong", serif;
  --nf-sans: -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", sans-serif;
  --nf-mono: "SF Mono", ui-monospace, Menlo, Consolas, monospace;
  --nf-ease: cubic-bezier(.2, .8, .2, 1);
  position: absolute; inset: 0; display: flex; flex-direction: column; overflow: hidden;
  background:
    radial-gradient(circle at 14% 8%, var(--nf-cinnabar-soft), transparent 40%),
    radial-gradient(circle at 88% -4%, rgba(31, 29, 26, .035), transparent 44%),
    var(--nf-paper);
  color: var(--nf-ink); font-family: var(--nf-sans); font-size: 13px; line-height: 1.6;
  -webkit-font-smoothing: antialiased;
}
.nf-root *, .nf-root *::before, .nf-root *::after{ box-sizing: border-box; }
.nf-root button{ font-family: inherit; }
.nf-root ::selection{ background: rgba(178, 58, 47, .16); }

@media (prefers-color-scheme: dark){
  .nf-root{
    --nf-paper: #16150f;
    --nf-paper-2: #1a1913;
    --nf-card: #1e1c16;
    --nf-card-2: #262319;
    --nf-ink: #ece6d8;
    --nf-ink-2: #a9a294;
    --nf-ink-3: #7c7567;
    --nf-line: #302c22;
    --nf-line-2: #413b2d;
    --nf-cinnabar: #d2604f;
    --nf-cinnabar-2: #e07a68;
    --nf-cinnabar-soft: rgba(210, 96, 79, .1);
    --nf-ok: #7fae8d;
    --nf-warn: #c79a4f;
    --nf-note: #93a1b2;
    --nf-shadow: 0 1px 0 rgba(0, 0, 0, .2), 0 16px 40px -28px #000;
    background:
      radial-gradient(circle at 14% 8%, rgba(210, 96, 79, .09), transparent 40%),
      radial-gradient(circle at 88% -4%, rgba(236, 230, 216, .035), transparent 44%),
      var(--nf-paper);
  }
}
body[data-ds-dark-theme] .nf-root{
  --nf-paper: #16150f;
  --nf-paper-2: #1a1913;
  --nf-card: #1e1c16;
  --nf-card-2: #262319;
  --nf-ink: #ece6d8;
  --nf-ink-2: #a9a294;
  --nf-ink-3: #7c7567;
  --nf-line: #302c22;
  --nf-line-2: #413b2d;
  --nf-cinnabar: #d2604f;
  --nf-cinnabar-2: #e07a68;
  --nf-cinnabar-soft: rgba(210, 96, 79, .1);
  --nf-ok: #7fae8d;
  --nf-warn: #c79a4f;
  --nf-note: #93a1b2;
}

/* ------------------------------------------------------------- 顶栏 */
.nf-top{
  flex: none; display: flex; align-items: center; gap: 12px; height: 58px; padding: 0 22px;
  border-bottom: 1px solid var(--nf-line); background: color-mix(in srgb, var(--nf-paper) 82%, transparent);
  backdrop-filter: blur(14px) saturate(120%); position: relative; z-index: 8;
}
.nf-brand{ display: flex; flex-direction: column; gap: 0; line-height: 1.2; }
.nf-brand b{
  font-family: var(--nf-serif); font-size: 19px; font-weight: 600; letter-spacing: .18em;
}
.nf-brand small{ font-size: 10px; color: var(--nf-ink-3); letter-spacing: .16em; }
.nf-top-rule{ width: 1px; height: 22px; background: var(--nf-line); margin: 0 4px; }
.nf-grow{ flex: 1 1 auto; min-width: 0; }
.nf-top-actions{ display: flex; align-items: center; gap: 8px; }

.nf-icon-btn{
  display: inline-flex; align-items: center; gap: 5px; border: 0; background: transparent;
  color: var(--nf-ink-2); font-size: 12px; padding: 6px 9px; border-radius: 4px; cursor: pointer;
  transition: color .16s var(--nf-ease), background .16s var(--nf-ease);
}
.nf-icon-btn:hover{ color: var(--nf-ink); background: rgba(31, 29, 26, .05); }
.nf-icon-btn:focus-visible{ outline: 2px solid var(--nf-cinnabar); outline-offset: 2px; }

/* ------------------------------------------------------------- 通用按钮 */
.nf-btn{
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  border: 1px solid var(--nf-line-2); background: transparent; color: var(--nf-ink);
  font-size: 12.5px; padding: 7px 14px; border-radius: 2px; cursor: pointer;
  transition: background .18s var(--nf-ease), border-color .18s var(--nf-ease), color .18s var(--nf-ease), transform .12s var(--nf-ease);
  white-space: nowrap;
}
.nf-btn:hover{ background: rgba(31, 29, 26, .045); border-color: var(--nf-ink-3); }
.nf-btn:active{ transform: translateY(1px); }
.nf-btn:focus-visible{ outline: 2px solid var(--nf-cinnabar); outline-offset: 2px; }
.nf-btn:disabled{ opacity: .42; cursor: not-allowed; transform: none; }
.nf-btn-sm{ font-size: 11.5px; padding: 4px 10px; }
.nf-btn-primary{
  background: var(--nf-ink); border-color: var(--nf-ink); color: var(--nf-paper);
  letter-spacing: .04em;
}
.nf-btn-primary:hover{ background: #000; border-color: #000; color: var(--nf-paper); }
.nf-btn-accent{ border-color: var(--nf-cinnabar); color: var(--nf-cinnabar); }
.nf-btn-accent:hover{ background: var(--nf-cinnabar); color: #fdf8ef; border-color: var(--nf-cinnabar); }
.nf-btn-quiet{ border-color: transparent; color: var(--nf-ink-2); }
.nf-btn-quiet:hover{ color: var(--nf-ink); border-color: transparent; background: rgba(31, 29, 26, .05); }
.nf-btn-danger{ color: var(--nf-cinnabar); border-color: transparent; }
.nf-btn-danger:hover{ background: var(--nf-cinnabar); color: #fdf8ef; }

.nf-spinner{
  display: inline-block; border: 1.5px solid currentColor; border-right-color: transparent;
  border-radius: 50%; animation: nf-spin .7s linear infinite; vertical-align: -2px;
}
@keyframes nf-spin{ to{ transform: rotate(360deg); } }

/* ------------------------------------------------------------- 书架 */
.nf-body{ flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; }
.nf-scroll{ flex: 1 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior: contain; }
.nf-shelf{ max-width: 1020px; margin: 0 auto; padding: 44px 32px 96px; }
.nf-shelf-head{ display: flex; align-items: flex-end; gap: 18px; margin-bottom: 30px; }
.nf-shelf-head h1{
  margin: 0; font-family: var(--nf-serif); font-size: 27px; font-weight: 600; letter-spacing: .08em;
}
.nf-shelf-head p{ margin: 5px 0 0; color: var(--nf-ink-3); font-size: 12px; letter-spacing: .04em; }
.nf-shelf-head .nf-grow{ flex: 1; }
.nf-hairline{ height: 1px; background: var(--nf-line); margin: 0 0 22px; }

.nf-grid{ display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
@media (max-width: 860px){ .nf-grid{ grid-template-columns: minmax(0, 1fr); } .nf-shelf{ padding: 28px 18px 80px; } }

.nf-card{
  position: relative; display: flex; flex-direction: column; min-height: 196px;
  background: var(--nf-card); border: 1px solid var(--nf-line); border-radius: 3px;
  padding: 18px 18px 14px; box-shadow: var(--nf-shadow);
  transition: border-color .2s var(--nf-ease), transform .2s var(--nf-ease);
}
.nf-card::before{
  content: ''; position: absolute; left: 0; top: 14px; bottom: 14px; width: 2px;
  background: var(--nf-cinnabar); opacity: 0; transition: opacity .2s var(--nf-ease);
}
.nf-card:hover{ border-color: var(--nf-line-2); transform: translateY(-1px); }
.nf-card:hover::before{ opacity: .8; }
.nf-card-top{ display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.nf-card-top time{ margin-left: auto; color: var(--nf-ink-3); font-size: 10.5px; letter-spacing: .04em; }
.nf-card-title{
  margin: 0 0 6px; font-family: var(--nf-serif); font-size: 20px; font-weight: 600;
  letter-spacing: .03em; line-height: 1.35;
}
.nf-premise{
  margin: 0; color: var(--nf-ink-2); font-size: 12px; line-height: 1.75;
  display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;
}
.nf-card-meta{ display: flex; align-items: center; gap: 10px; margin-top: auto; padding-top: 16px; color: var(--nf-ink-3); font-size: 11px; }
.nf-card-meta .nf-grow{ flex: 1; }
.nf-card-progress{ margin-top: 14px; }
.nf-card-nums{ display: flex; justify-content: space-between; font-size: 10.5px; color: var(--nf-ink-3); margin-bottom: 6px; letter-spacing: .03em; }
.nf-card-actions{ display: flex; align-items: center; gap: 4px; margin-top: 10px; padding-top: 10px; border-top: 1px dashed var(--nf-line); }
.nf-card-actions .nf-grow{ flex: 1; }

.nf-progress{
  display: block; position: relative; height: 3px; background: var(--nf-line); border-radius: 2px; overflow: hidden;
}
.nf-progress i{ position: absolute; inset: 0 auto 0 0; background: var(--nf-ink); transition: width .5s var(--nf-ease); }
.nf-progress-accent i{ background: var(--nf-cinnabar); }

/* 徽章 */
.nf-badge{
  display: inline-flex; align-items: center; gap: 4px; padding: 1px 7px; font-size: 10px;
  border: 1px solid var(--nf-line-2); border-radius: 2px; color: var(--nf-ink-2);
  letter-spacing: .08em; line-height: 1.7; white-space: nowrap;
}
.nf-badge-accent{ color: var(--nf-cinnabar); border-color: color-mix(in srgb, var(--nf-cinnabar) 34%, transparent); }
.nf-badge-ok{ color: var(--nf-ok); border-color: color-mix(in srgb, var(--nf-ok) 34%, transparent); }
.nf-badge-warn{ color: var(--nf-warn); border-color: color-mix(in srgb, var(--nf-warn) 34%, transparent); }
.nf-badge-muted{ color: var(--nf-ink-3); border-color: var(--nf-line); }
.nf-badge-inverse{ background: var(--nf-ink); color: var(--nf-paper); border-color: var(--nf-ink); }

/* 状态点 */
.nf-dot{ display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: var(--nf-line-2); flex: none; }
.nf-dot.is-done{ background: var(--nf-ink); }
.nf-dot.is-running{ background: var(--nf-cinnabar); box-shadow: 0 0 0 3px var(--nf-cinnabar-soft); animation: nf-pulse 1.6s ease-in-out infinite; }
.nf-dot.is-error{ background: var(--nf-cinnabar); }
.nf-dot.is-partial{ background: linear-gradient(90deg, var(--nf-ink) 50%, var(--nf-line-2) 50%); }
.nf-dot.is-paused{ background: var(--nf-warn); }
.nf-dot.is-idle{ background: transparent; border: 1px solid var(--nf-line-2); }
@keyframes nf-pulse{ 0%, 100%{ opacity: 1; } 50%{ opacity: .45; } }

/* 空态 */
.nf-empty{ max-width: 520px; margin: 8vh auto 0; text-align: center; padding: 0 24px; }
.nf-empty-mark{
  width: 58px; height: 58px; margin: 0 auto 22px; border: 1px solid var(--nf-line-2); border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-family: var(--nf-serif); font-size: 26px; color: var(--nf-cinnabar);
  background: var(--nf-card); box-shadow: inset 0 0 0 5px var(--nf-paper);
}
.nf-empty h2{ margin: 0 0 10px; font-family: var(--nf-serif); font-size: 24px; font-weight: 600; letter-spacing: .06em; }
.nf-empty p{ margin: 0 0 10px; color: var(--nf-ink-2); font-size: 12.5px; line-height: 1.9; }
.nf-sample{
  margin: 24px 0 22px; padding: 14px 16px; border: 1px dashed var(--nf-line-2); border-radius: 3px;
  color: var(--nf-ink-2); font-size: 12px; line-height: 1.8; text-align: left; background: var(--nf-paper-2);
}
.nf-sample b{ display: block; font-size: 10px; letter-spacing: .14em; color: var(--nf-ink-3); margin-bottom: 6px; font-weight: 500; }

.nf-muted{ color: var(--nf-ink-3); }
.nf-fade{ opacity: .55; }

/* ------------------------------------------------------------- 新建 */
.nf-create{ max-width: 1060px; margin: 0 auto; padding: 34px 32px 100px; }
.nf-create-head{ margin-bottom: 26px; }
.nf-create-head h1{ margin: 0; font-family: var(--nf-serif); font-size: 26px; font-weight: 600; letter-spacing: .06em; }
.nf-create-head p{ margin: 6px 0 0; color: var(--nf-ink-3); font-size: 12px; }
.nf-create-grid{ display: grid; grid-template-columns: minmax(0, 1fr) 296px; gap: 44px; align-items: start; }
@media (max-width: 940px){ .nf-create-grid{ grid-template-columns: minmax(0, 1fr); gap: 26px; } .nf-create{ padding: 24px 18px 80px; } }

.nf-form{ display: flex; flex-direction: column; gap: 20px; }
.nf-field{ display: flex; flex-direction: column; gap: 7px; }
.nf-label{
  display: flex; align-items: baseline; gap: 8px; font-size: 11px; letter-spacing: .12em;
  color: var(--nf-ink-2); text-transform: none;
}
.nf-label em{ font-style: normal; color: var(--nf-ink-3); font-size: 10px; letter-spacing: .02em; }
.nf-input, .nf-textarea, .nf-select{
  width: 100%; font-family: var(--nf-sans); font-size: 13px; color: var(--nf-ink);
  background: var(--nf-card); border: 1px solid var(--nf-line); border-radius: 2px;
  padding: 9px 11px; outline: none; transition: border-color .16s var(--nf-ease), box-shadow .16s var(--nf-ease);
}
.nf-input:hover, .nf-textarea:hover, .nf-select:hover{ border-color: var(--nf-line-2); }
.nf-input:focus, .nf-textarea:focus, .nf-select:focus{
  border-color: var(--nf-cinnabar); box-shadow: 0 0 0 3px var(--nf-cinnabar-soft);
}
.nf-textarea{ resize: vertical; min-height: 80px; line-height: 1.85; }
.nf-textarea-premise{
  min-height: 148px; font-family: var(--nf-serif); font-size: 15px; line-height: 1.95; letter-spacing: .02em;
}
.nf-select{ appearance: none; cursor: pointer; padding-right: 30px;
  background-image: linear-gradient(45deg, transparent 50%, var(--nf-ink-3) 50%), linear-gradient(135deg, var(--nf-ink-3) 50%, transparent 50%);
  background-position: calc(100% - 15px) 52%, calc(100% - 11px) 52%;
  background-size: 4px 4px, 4px 4px; background-repeat: no-repeat;
}
.nf-row{ display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
.nf-row-3{ display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
@media (max-width: 560px){ .nf-row, .nf-row-3{ grid-template-columns: minmax(0, 1fr); } }

.nf-switch-row{
  display: flex; align-items: flex-start; gap: 12px; text-align: left; width: 100%;
  border: 1px solid var(--nf-line); background: var(--nf-card); border-radius: 3px;
  padding: 12px 14px; cursor: pointer; color: var(--nf-ink); font-size: 12.5px;
  transition: border-color .16s var(--nf-ease), background .16s var(--nf-ease);
}
.nf-switch-row:hover{ border-color: var(--nf-line-2); }
.nf-switch-row:focus-visible{ outline: 2px solid var(--nf-cinnabar); outline-offset: 2px; }
.nf-switch{ flex: none; width: 30px; height: 17px; border-radius: 9px; background: var(--nf-line-2); position: relative; margin-top: 2px; transition: background .2s var(--nf-ease); }
.nf-switch i{ position: absolute; top: 2px; left: 2px; width: 13px; height: 13px; border-radius: 50%; background: var(--nf-card); transition: transform .2s var(--nf-ease); box-shadow: 0 1px 2px rgba(0,0,0,.2); }
.nf-switch-row.is-on .nf-switch{ background: var(--nf-cinnabar); }
.nf-switch-row.is-on .nf-switch i{ transform: translateX(13px); }
.nf-switch-text{ display: flex; flex-direction: column; gap: 2px; }
.nf-switch-text b{ font-weight: 500; }
.nf-switch-text small{ color: var(--nf-ink-3); font-size: 10.5px; line-height: 1.6; }

.nf-estimate{
  position: sticky; top: 0; background: var(--nf-card); border: 1px solid var(--nf-line);
  border-radius: 3px; padding: 20px; box-shadow: var(--nf-shadow);
}
.nf-estimate h3{
  margin: 0 0 16px; font-family: var(--nf-serif); font-size: 15px; font-weight: 600; letter-spacing: .12em;
  padding-bottom: 12px; border-bottom: 1px solid var(--nf-line);
}
.nf-est-row{ display: flex; align-items: baseline; justify-content: space-between; gap: 12px; padding: 7px 0; font-size: 12px; color: var(--nf-ink-2); }
.nf-est-row b{ font-family: var(--nf-serif); font-size: 15px; font-weight: 600; color: var(--nf-ink); letter-spacing: .02em; }
.nf-est-note{ margin: 14px 0 0; padding-top: 12px; border-top: 1px dashed var(--nf-line); color: var(--nf-ink-3); font-size: 10.5px; line-height: 1.8; }
.nf-est-bar{ margin: 12px 0 2px; }
.nf-actions{ display: flex; align-items: center; gap: 10px; margin-top: 8px; }
.nf-actions .nf-grow{ flex: 1; }

/* ------------------------------------------------------------- 工作台 */
.nf-workbench{
  flex: 1 1 auto; min-height: 0; display: grid;
  grid-template-columns: 252px minmax(0, 1fr) 318px;
}
.nf-workbench.no-drawer{ grid-template-columns: 252px minmax(0, 1fr); }
/* 窄屏才显示紧凑运行条（宽屏用右侧抽屉）；基础规则须在媒体查询之前，避免同权重覆盖。 */
.nf-runbar{ display: none; }
@media (max-width: 1080px){
  .nf-workbench{ grid-template-columns: 216px minmax(0, 1fr); }
  .nf-workbench .nf-drawer{ display: none; }
  .nf-workbench.no-drawer{ grid-template-columns: 216px minmax(0, 1fr); }
  /* 抽屉被隐藏后，顶部紧凑运行条接管进度与取消。 */
  .nf-runbar{
    display: flex; align-items: center; gap: 8px; flex-basis: 100%; order: 10;
    padding: 6px 10px; border: 1px solid var(--nf-line); border-radius: 3px;
    background: var(--nf-paper-2); font-size: 11px; color: var(--nf-ink-2);
  }
  .nf-runbar-label{ min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
}

/* 阶段轨 */
.nf-rail{
  min-height: 0; overflow-y: auto; border-right: 1px solid var(--nf-line);
  padding: 20px 0 40px; background: var(--nf-paper-2);
}
.nf-rail-head{ padding: 0 18px 12px; display: flex; align-items: baseline; justify-content: space-between; }
.nf-rail-head b{ font-size: 10px; letter-spacing: .18em; color: var(--nf-ink-3); font-weight: 500; }
.nf-rail-head span{ font-size: 10px; color: var(--nf-ink-3); }
.nf-rail-item{
  display: grid; grid-template-columns: 14px minmax(0, 1fr) auto; align-items: center; gap: 8px;
  width: 100%; text-align: left; border: 0; background: transparent; color: var(--nf-ink);
  padding: 9px 18px 9px 16px; cursor: pointer; position: relative; font-size: 12.5px;
  transition: background .16s var(--nf-ease);
}
.nf-rail-item:hover{ background: rgba(31, 29, 26, .04); }
.nf-rail-item:focus-visible{ outline: 2px solid var(--nf-cinnabar); outline-offset: -2px; }
.nf-rail-item.is-active{ background: var(--nf-card); }
.nf-rail-item.is-active::before{ content: ''; position: absolute; left: 0; top: 8px; bottom: 8px; width: 2px; background: var(--nf-cinnabar); }
.nf-rail-title{ overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nf-rail-title small{ display: block; color: var(--nf-ink-3); font-size: 9.5px; letter-spacing: .06em; line-height: 1.4; }
.nf-rail-item.is-active .nf-rail-title{ font-weight: 600; }
.nf-rail-count{ font-size: 9.5px; color: var(--nf-ink-3); font-variant-numeric: tabular-nums; }
.nf-rail-overview{
  display: flex; align-items: center; gap: 8px; margin: 0 12px 10px; padding: 8px 8px;
  border: 0; border-bottom: 1px dashed var(--nf-line); width: calc(100% - 24px);
  background: transparent; color: var(--nf-ink-2); font-size: 11px; letter-spacing: .14em; cursor: pointer; text-align: left;
}
.nf-rail-overview:hover{ color: var(--nf-ink); }
.nf-rail-overview.is-active{ color: var(--nf-cinnabar); }

/* 主区 */
.nf-main{ min-height: 0; overflow-y: auto; overscroll-behavior: contain; }
.nf-main-inner{ max-width: 780px; margin: 0 auto; padding: 34px 38px 100px; }
@media (max-width: 720px){ .nf-main-inner{ padding: 24px 20px 80px; } }
.nf-main-head{ display: flex; align-items: flex-end; gap: 12px; margin-bottom: 8px; }
.nf-eyebrow{ font-size: 10px; letter-spacing: .2em; color: var(--nf-ink-3); }
.nf-main-title{
  margin: 4px 0 0; font-family: var(--nf-serif); font-size: 30px; font-weight: 600; line-height: 1.3;
  letter-spacing: .04em; word-break: break-word;
}
.nf-main-sub{ margin: 8px 0 0; color: var(--nf-ink-2); font-size: 13px; line-height: 1.8; }
.nf-main-top{ display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-bottom: 20px; min-height: 30px; }
.nf-main-actions{ display: flex; align-items: center; gap: 6px; margin-left: auto; padding-bottom: 6px; }

.nf-section{ margin-top: 30px; padding-top: 22px; border-top: 1px solid var(--nf-line); }
.nf-section:first-of-type{ border-top: 0; padding-top: 0; }
.nf-section-title{ margin: 0 0 14px; font-family: var(--nf-serif); font-size: 15px; font-weight: 600; letter-spacing: .12em; }
.nf-keyline{ display: flex; flex-wrap: wrap; gap: 6px; margin-top: 14px; }

/* 总览统计 */
.nf-stats{ display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 1px; background: var(--nf-line); border: 1px solid var(--nf-line); margin-top: 26px; }
.nf-stat{ background: var(--nf-card); padding: 14px 14px 12px; }
.nf-stat b{ display: block; font-family: var(--nf-serif); font-size: 21px; font-weight: 600; line-height: 1.2; letter-spacing: .02em; }
.nf-stat span{ display: block; margin-top: 4px; font-size: 9.5px; letter-spacing: .14em; color: var(--nf-ink-3); }
.nf-stat .nf-stat-sub{ display: block; margin-top: 2px; font-size: 9.5px; letter-spacing: .02em; color: var(--nf-ink-3); }
@media (max-width: 640px){ .nf-stats{ grid-template-columns: repeat(2, minmax(0, 1fr)); } }

.nf-quote{
  margin: 24px 0 0; padding: 2px 0 2px 16px; border-left: 2px solid var(--nf-cinnabar);
  font-family: var(--nf-serif); font-size: 16px; line-height: 1.95; color: var(--nf-ink);
}
.nf-quote small{ display: block; margin-top: 8px; font-family: var(--nf-sans); font-size: 10px; letter-spacing: .16em; color: var(--nf-ink-3); }

.nf-flat-list{ display: flex; flex-direction: column; }
.nf-flat-row{
  display: flex; align-items: baseline; gap: 12px; padding: 11px 2px; border-bottom: 1px dashed var(--nf-line);
  font-size: 12.5px;
}
.nf-flat-row:last-child{ border-bottom: 0; }
.nf-flat-key{ flex: none; width: 68px; color: var(--nf-ink-3); font-size: 10px; letter-spacing: .12em; }
.nf-flat-val{ flex: 1; min-width: 0; line-height: 1.75; }
.nf-flat-val.serif{ font-family: var(--nf-serif); font-size: 14px; }

/* 大纲 */
.nf-volume{ margin-top: 22px; }
.nf-volume-head{ display: flex; align-items: baseline; gap: 10px; margin-bottom: 4px; }
.nf-volume-head b{ font-family: var(--nf-serif); font-size: 16px; font-weight: 600; letter-spacing: .06em; }
.nf-volume-head span{ color: var(--nf-ink-3); font-size: 10.5px; }
.nf-chapter-row{
  display: grid; grid-template-columns: 42px minmax(0, 1fr) auto; align-items: center; gap: 10px;
  width: 100%; text-align: left; border: 0; border-bottom: 1px solid var(--nf-line);
  background: transparent; color: var(--nf-ink); padding: 11px 4px; cursor: pointer; font: inherit;
  transition: background .14s var(--nf-ease);
}
.nf-chapter-row:hover{ background: rgba(31, 29, 26, .035); }
.nf-chapter-row:focus-visible{ outline: 2px solid var(--nf-cinnabar); outline-offset: -2px; }
.nf-chapter-tail{ display: flex; align-items: center; gap: 8px; color: var(--nf-ink-3); }
.nf-chapter-id{ font-family: var(--nf-mono); font-size: 10.5px; color: var(--nf-ink-3); letter-spacing: .02em; }
.nf-chapter-title{ font-family: var(--nf-serif); font-size: 14.5px; letter-spacing: .02em; }
.nf-chapter-title small{ display: block; margin-top: 2px; font-family: var(--nf-sans); font-size: 10.5px; color: var(--nf-ink-3); font-weight: 400; letter-spacing: 0; line-height: 1.6;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nf-chapter-go{ color: var(--nf-ink-3); display: inline-flex; align-items: center; gap: 6px; }

/* 人物卡 */
.nf-cast{ display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
@media (max-width: 720px){ .nf-cast{ grid-template-columns: minmax(0, 1fr); } }
.nf-person{ background: var(--nf-card); border: 1px solid var(--nf-line); border-radius: 3px; padding: 14px 16px; }
.nf-person-head{ display: flex; align-items: baseline; gap: 8px; margin-bottom: 10px; }
.nf-person-head b{ font-family: var(--nf-serif); font-size: 16px; font-weight: 600; letter-spacing: .04em; }
.nf-person-head span{ font-size: 10px; color: var(--nf-ink-3); letter-spacing: .1em; }
.nf-person dl{ margin: 0; display: grid; grid-template-columns: 44px minmax(0, 1fr); gap: 4px 8px; font-size: 11.5px; line-height: 1.7; }
.nf-person dt{ color: var(--nf-ink-3); font-size: 10px; letter-spacing: .1em; padding-top: 2px; }
.nf-person dd{ margin: 0; color: var(--nf-ink-2); }

/* 审校 findings */
.nf-findings{ display: flex; flex-direction: column; gap: 16px; }
.nf-finding-group{ border: 1px solid var(--nf-line); border-radius: 3px; background: var(--nf-card); overflow: hidden; }
.nf-finding-group > header{
  display: flex; align-items: center; gap: 8px; padding: 9px 14px; font-size: 10.5px;
  letter-spacing: .14em; border-bottom: 1px solid var(--nf-line); background: var(--nf-paper-2);
}
.nf-finding-group.block > header{ color: var(--nf-cinnabar); }
.nf-finding-group.warn > header{ color: var(--nf-warn); }
.nf-finding-group.note > header{ color: var(--nf-note); }
.nf-finding{ padding: 11px 14px; border-top: 1px dashed var(--nf-line); font-size: 12px; line-height: 1.8; }
.nf-finding:first-of-type{ border-top: 0; }
.nf-finding .where{ font-family: var(--nf-mono); font-size: 10px; color: var(--nf-ink-3); margin-right: 8px; }
.nf-finding .issue{ display: block; }
.nf-finding .fix{ display: block; margin-top: 4px; color: var(--nf-ink-2); }
.nf-finding .fix::before{ content: '改法 · '; color: var(--nf-ink-3); font-size: 10px; letter-spacing: .1em; }

/* 账本 */
.nf-ledger{ display: flex; flex-direction: column; gap: 22px; }
.nf-ledger h4{ margin: 0 0 8px; font-size: 10.5px; letter-spacing: .16em; color: var(--nf-ink-3); font-weight: 500; }
.nf-ledger ul{ margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 0; }
.nf-ledger li{ padding: 7px 0; border-bottom: 1px dashed var(--nf-line); font-size: 12px; line-height: 1.75; display: flex; gap: 8px; }
.nf-ledger li:last-child{ border-bottom: 0; }
.nf-ledger li time{ flex: none; font-family: var(--nf-mono); font-size: 10px; color: var(--nf-ink-3); padding-top: 2px; }

/* 正典 */
.nf-canon{ display: flex; flex-direction: column; gap: 20px; }
.nf-canon-stats{ display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 1px; background: var(--nf-line); border: 1px solid var(--nf-line); }
.nf-canon-stat{ background: var(--nf-card); padding: 11px 14px; }
.nf-canon-stat b{ display: block; font-family: var(--nf-serif); font-size: 18px; font-weight: 600; line-height: 1.2; }
.nf-canon-stat span{ display: block; margin-top: 2px; font-size: 9.5px; letter-spacing: .14em; color: var(--nf-ink-3); }
@media (max-width: 640px){ .nf-canon-stats{ grid-template-columns: repeat(2, minmax(0, 1fr)); } }

/* 正文（markdown） */
.nf-prose{
  font-family: var(--nf-serif); font-size: 15.5px; line-height: 2; color: var(--nf-ink);
  word-break: break-word;
}
.nf-prose > *:first-child{ margin-top: 0; }
.nf-prose h1, .nf-prose h2, .nf-prose h3, .nf-prose h4{
  font-family: var(--nf-serif); font-weight: 600; line-height: 1.45; letter-spacing: .04em;
  margin: 2em 0 .8em;
}
.nf-prose h1{ font-size: 24px; }
.nf-prose h2{ font-size: 20px; padding-bottom: 8px; border-bottom: 1px solid var(--nf-line); }
.nf-prose h3{ font-size: 16.5px; }
.nf-prose h4{ font-size: 14.5px; }
.nf-prose p{ margin: 0 0 1em; }
.nf-prose ul, .nf-prose ol{ padding-left: 1.4em; margin: 0 0 1em; }
.nf-prose li{ margin: .3em 0; }
.nf-prose blockquote{
  margin: 1.4em 0; padding: 4px 0 4px 18px; border-left: 2px solid var(--nf-cinnabar);
  color: var(--nf-ink-2); font-style: normal;
}
.nf-prose hr{ border: 0; border-top: 1px solid var(--nf-line); margin: 2em 0; }
.nf-prose code{ font-family: var(--nf-mono); font-size: .86em; background: var(--nf-card-2); padding: 1px 5px; border-radius: 2px; }
.nf-prose pre{ background: var(--nf-card-2); border: 1px solid var(--nf-line); padding: 14px 16px; overflow-x: auto; border-radius: 2px; }
.nf-prose pre code{ background: transparent; padding: 0; }
.nf-prose table{ width: 100%; border-collapse: collapse; font-family: var(--nf-sans); font-size: 12px; margin: 0 0 1em; }
.nf-prose th, .nf-prose td{ border: 1px solid var(--nf-line); padding: 7px 9px; text-align: left; }
.nf-prose th{ background: var(--nf-paper-2); font-weight: 500; }
.nf-prose a{ color: var(--nf-cinnabar); text-decoration: none; border-bottom: 1px solid currentColor; }
.nf-prose strong{ font-weight: 600; }
.nf-prose img{ max-width: 100%; }
.nf-prose.is-reading{ font-size: 16.5px; line-height: 2.05; }
.nf-prose.is-reading p{ text-indent: 2em; margin: 0 0 .7em; }
.nf-prose.is-reading p:first-of-type{ text-indent: 0; }

/* 章节视图 */
.nf-chapter-head{ display: flex; align-items: flex-start; gap: 16px; margin-bottom: 22px; }
.nf-chapter-head .nf-main-title{ font-size: 26px; }
.nf-tabs{ display: flex; gap: 2px; border-bottom: 1px solid var(--nf-line); margin-bottom: 22px; }
.nf-tab{
  border: 0; background: transparent; color: var(--nf-ink-3); font: inherit; font-size: 12px;
  padding: 8px 14px; cursor: pointer; position: relative; letter-spacing: .08em;
}
.nf-tab:hover{ color: var(--nf-ink); }
.nf-tab.is-active{ color: var(--nf-ink); }
.nf-tab.is-active::after{ content: ''; position: absolute; left: 10px; right: 10px; bottom: -1px; height: 1px; background: var(--nf-ink); }
.nf-tab:focus-visible{ outline: 2px solid var(--nf-cinnabar); outline-offset: -2px; }
.nf-tab small{ margin-left: 6px; color: var(--nf-ink-3); font-size: 9.5px; }
.nf-chapter-nav{ display: flex; align-items: center; gap: 8px; margin-top: 40px; padding-top: 18px; border-top: 1px solid var(--nf-line); }
.nf-editor{ display: flex; flex-direction: column; gap: 10px; }
.nf-editor textarea{
  width: 100%; min-height: 480px; resize: vertical; font-family: var(--nf-serif);
  font-size: 15.5px; line-height: 2; color: var(--nf-ink); background: var(--nf-card);
  border: 1px solid var(--nf-line); border-radius: 2px; padding: 22px 24px; outline: none;
}
.nf-editor textarea:focus{ border-color: var(--nf-cinnabar); box-shadow: 0 0 0 3px var(--nf-cinnabar-soft); }
.nf-editor-bar{ display: flex; align-items: center; gap: 8px; color: var(--nf-ink-3); font-size: 10.5px; }
.nf-editor-bar .nf-grow{ flex: 1; }

/* 审稿门 */
.nf-banner{
  flex: none; display: flex; align-items: center; gap: 12px; padding: 10px 22px;
  background: var(--nf-cinnabar-soft); border-bottom: 1px solid color-mix(in srgb, var(--nf-cinnabar) 24%, transparent);
  font-size: 12px; color: var(--nf-ink);
}
.nf-banner b{ font-family: var(--nf-serif); font-size: 13.5px; font-weight: 600; letter-spacing: .04em; }
.nf-banner .nf-grow{ flex: 1; }
.nf-banner-mark{ flex: none; width: 20px; height: 20px; border: 1px solid var(--nf-cinnabar); color: var(--nf-cinnabar); border-radius: 50%; display: flex; align-items: center; justify-content: center; font-family: var(--nf-serif); font-size: 11px; }

/* 运行抽屉 */
.nf-drawer{
  min-height: 0; display: flex; flex-direction: column; border-left: 1px solid var(--nf-line);
  background: var(--nf-paper-2);
}
.nf-drawer-head{ flex: none; display: flex; align-items: center; gap: 8px; padding: 14px 16px 10px; }
.nf-drawer-head b{ font-size: 10px; letter-spacing: .18em; color: var(--nf-ink-3); font-weight: 500; }
.nf-drawer-head .nf-grow{ flex: 1; }
.nf-drawer-body{ min-height: 0; overflow-y: auto; padding: 0 16px 16px; display: flex; flex-direction: column; gap: 12px; }
.nf-run-card{ background: var(--nf-card); border: 1px solid var(--nf-line); border-radius: 3px; padding: 12px 13px; }
.nf-run-top{ display: flex; align-items: center; gap: 7px; margin-bottom: 8px; }
.nf-run-top .nf-grow{ flex: 1; }
.nf-run-current{ font-family: var(--nf-serif); font-size: 13px; letter-spacing: .02em; margin-bottom: 8px; word-break: break-word; }
.nf-run-nums{ display: flex; justify-content: space-between; font-size: 10px; color: var(--nf-ink-3); margin-top: 7px; font-variant-numeric: tabular-nums; }
.nf-events{ list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
.nf-event{ display: grid; grid-template-columns: 44px minmax(0, 1fr); gap: 8px; padding: 5px 0; font-size: 11px; line-height: 1.6; color: var(--nf-ink-2); border-bottom: 1px dashed var(--nf-line);
  /* 屏外事件跳过布局与绘制；22px 是单行高度，避免滚动条跳动。 */
  content-visibility: auto; contain-intrinsic-size: 0 22px; }
.nf-new-events{
  position: sticky; top: 0; z-index: 3; align-self: center; flex: none; margin: 2px 0;
  padding: 4px 12px; border: 1px solid var(--nf-cinnabar); border-radius: 999px;
  background: var(--nf-card); color: var(--nf-cinnabar); font: inherit; font-size: 11px;
  cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,.08);
}
.nf-new-events:hover{ background: var(--nf-paper-2); }
.nf-event:last-child{ border-bottom: 0; }
.nf-event time{ color: var(--nf-ink-3); font-family: var(--nf-mono); font-size: 9.5px; padding-top: 1px; }
.nf-event.is-accent span{ color: var(--nf-cinnabar); }
.nf-event.is-warn span{ color: var(--nf-warn); }
.nf-event.is-strong span{ color: var(--nf-ink); }
.nf-run-empty{ padding: 18px 6px; color: var(--nf-ink-3); font-size: 11px; line-height: 1.9; text-align: center; }
.nf-drawer-foot{ flex: none; padding: 10px 16px 14px; border-top: 1px solid var(--nf-line); display: flex; gap: 8px; }
.nf-drawer-foot .nf-btn{ flex: 1; }

/* 菜单 */
.nf-menu-wrap{ position: relative; }
.nf-menu{
  position: absolute; right: 0; top: calc(100% + 6px); z-index: 30; min-width: 156px;
  background: var(--nf-card); border: 1px solid var(--nf-line-2); border-radius: 3px;
  box-shadow: 0 18px 40px -22px rgba(31, 29, 26, .55); padding: 4px;
}
.nf-menu button{
  display: flex; width: 100%; align-items: center; gap: 8px; border: 0; background: transparent;
  color: var(--nf-ink); font: inherit; font-size: 12px; padding: 8px 10px; cursor: pointer; text-align: left; border-radius: 2px;
}
.nf-menu button:hover{ background: rgba(31, 29, 26, .06); }
.nf-menu button:focus-visible{ outline: 2px solid var(--nf-cinnabar); outline-offset: -2px; }
.nf-menu button small{ margin-left: auto; color: var(--nf-ink-3); font-size: 10px; }

/* 错误 / 加载 */
.nf-error{
  margin: 18px 0; padding: 12px 14px; border: 1px solid color-mix(in srgb, var(--nf-cinnabar) 30%, transparent);
  background: var(--nf-cinnabar-soft); color: var(--nf-ink); font-size: 12px; line-height: 1.8; border-radius: 2px;
}
.nf-loading{ display: flex; align-items: center; gap: 10px; color: var(--nf-ink-3); font-size: 12px; padding: 60px 0; justify-content: center; }
.nf-loading .nf-spinner{ color: var(--nf-cinnabar); }

/* Toast */
.nf-toast{
  position: absolute; left: 50%; bottom: 26px; transform: translateX(-50%); z-index: 60;
  display: flex; align-items: center; gap: 10px; max-width: min(640px, 88vw);
  background: var(--nf-ink); color: var(--nf-paper); border-radius: 3px;
  padding: 10px 12px 10px 16px; font-size: 12px; line-height: 1.6;
  box-shadow: 0 18px 40px -18px rgba(0, 0, 0, .6); animation: nf-rise .22s var(--nf-ease);
}
.nf-toast-error{ background: var(--nf-cinnabar-2); color: #fdf8ef; }
.nf-toast-ok{ background: var(--nf-ink); color: var(--nf-paper); }
.nf-toast-text{ flex: 1; min-width: 0; }
.nf-toast-close{ border: 0; background: transparent; color: inherit; opacity: .6; cursor: pointer; font-size: 16px; line-height: 1; padding: 0 2px; }
.nf-toast-close:hover{ opacity: 1; }
@keyframes nf-rise{ from{ opacity: 0; transform: translate(-50%, 8px); } to{ opacity: 1; transform: translate(-50%, 0); } }

/* 滚动条：细，安静 */
.nf-root *{ scrollbar-width: thin; scrollbar-color: var(--nf-line-2) transparent; }
.nf-root *::-webkit-scrollbar{ width: 8px; height: 8px; }
.nf-root *::-webkit-scrollbar-thumb{ background: var(--nf-line-2); border-radius: 4px; border: 2px solid transparent; background-clip: content-box; }
.nf-root *::-webkit-scrollbar-track{ background: transparent; }

@media (prefers-reduced-motion: reduce){
  .nf-root *, .nf-root *::before, .nf-root *::after{ animation-duration: .001ms !important; transition-duration: .001ms !important; }
}

/* 正典入口：与 9 段阶段轨隔开，避免被当成第 10 步 */
.nf-rail-sep{ height: 0; margin: 10px 18px; border-top: 1px dashed var(--nf-line); }
.nf-rail-canon .nf-rail-title small{ color: var(--nf-ink-3); }
`

let injected = false

/** 只注入一次样式；重复 apply（HMR）时幂等。 */
export function injectStylesOnce(doc = document) {
  if (injected && doc.getElementById('nf-style')) return
  let node = doc.getElementById('nf-style')
  if (!node) {
    node = doc.createElement('style')
    node.id = 'nf-style'
    node.textContent = CSS
    doc.head.appendChild(node)
  }
  injected = true
}
