/**
 * dsh-update-check — Web half.
 *
 * A sidebar panel that answers "am I current?" and, when the Desktop app reports a
 * newer release, offers the one click that actually updates: it hands the version
 * to the Desktop's own updater (`window.dshDesktop.updates.open()`), which owns
 * download, verification, task teardown and restart. Nothing here ever replaces
 * application files itself.
 */
window.__ModuleLoader__.load({
  id: 'dsh-update-check',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const NS = 'dsh-update-check'
    const PANEL_KEY = 'dsh-update-check'
    const API_PREFIX = '/api/dsh-update-check'

    // ------------------------------------------------------------------ locale

    const zh = {
      panelTitle: '版本更新',
      panelHint: '检查 DSH Desktop 是否有新版本',
      loading: '正在检查更新…',
      checking: '检查中…',
      refresh: '重新检查',
      update: '立即更新',
      download: '下载安装包',
      upToDate: '已是最新版本',
      available: '发现新版本 v{version}',
      currentVersion: '当前版本',
      latestVersion: '最新版本',
      unknown: '未知',
      checkFailed: '检查更新失败',
      feedUnreachable: '更新源不可达',
      feedUnconfigured: '更新源未配置',
      manifestInvalid: '更新源返回了无法解析的版本信息',
      versionUnknown: '无法确定已安装版本',
      downloading: '正在下载 {percent}%',
      verifying: '正在校验…',
      ready: '安装包已就绪，重启后安装',
      installing: '正在安装并重启…',
      handedOff: '已交给应用内更新器，请按系统对话框确认',
      openedDownload: '已打开下载页，请按提示安装',
      browserMode: '当前页面不在桌面应用内，只能下载安装包，无法自动安装。',
      nativeHint: '一键更新由桌面应用自带的更新器完成：下载 → 校验 → 确认重启，不会由本页面替换应用文件。',
      feedLabel: '更新源',
      checkedAt: '上次检查',
      nativePhase: '应用内更新器',
      updateFailed: '应用内更新器失败：{reason}',
      updateFailedCheck: '检查更新',
      updateFailedDownload: '下载安装包',
      updateFailedInstall: '安装',
      updateFailedGeneric: '未知原因',
      noAction: '该更新源不属于应用内更新器，无法一键安装',
    }

    const en = {
      panelTitle: 'Version & updates',
      panelHint: 'Check whether DSH Desktop has a newer release',
      loading: 'Checking for updates…',
      checking: 'Checking…',
      refresh: 'Check again',
      update: 'Update now',
      download: 'Download installer',
      upToDate: 'You are on the latest version',
      available: 'Version v{version} is available',
      currentVersion: 'Installed',
      latestVersion: 'Available',
      unknown: 'unknown',
      checkFailed: 'Update check failed',
      feedUnreachable: 'Update feed unreachable',
      feedUnconfigured: 'No update feed configured',
      manifestInvalid: 'The feed returned no usable version',
      versionUnknown: 'Cannot determine the installed version',
      downloading: 'Downloading {percent}%',
      verifying: 'Verifying…',
      ready: 'Installer ready — restart to install',
      installing: 'Installing and restarting…',
      handedOff: 'Handed to the in-app updater — confirm in the native dialog',
      openedDownload: 'Download page opened — follow its instructions',
      browserMode: 'This page is not inside the Desktop app, so it can only download an installer.',
      nativeHint: 'One-click update runs the Desktop app’s own updater: download → verify → confirmed restart. This page never replaces application files.',
      feedLabel: 'Feed',
      checkedAt: 'Last checked',
      nativePhase: 'In-app updater',
      updateFailed: 'The in-app updater failed: {reason}',
      updateFailedCheck: 'update check',
      updateFailedDownload: 'download',
      updateFailedInstall: 'installation',
      updateFailedGeneric: 'unknown reason',
      noAction: 'That feed is not the app’s own updater feed, so it cannot be installed from here',
    }

    const CSS = [
      '.upd-page{display:flex;flex-direction:column;gap:16px;padding:24px;height:100%;overflow:auto;box-sizing:border-box}',
      '.upd-head{display:flex;align-items:flex-start;gap:12px}',
      '.upd-title{font-size:16px;font-weight:600;color:var(--dsw-alias-label-primary)}',
      '.upd-sub{font-size:12px;color:var(--dsw-alias-label-tertiary);margin-top:2px}',
      '.upd-card{background:var(--dsw-alias-bg-layer-1);border:.5px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-md);padding:16px;display:flex;flex-direction:column;gap:12px}',
      '.upd-row{display:flex;align-items:center;justify-content:space-between;gap:12px;font-size:13px}',
      '.upd-key{color:var(--dsw-alias-label-secondary)}',
      '.upd-val{color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums}',
      '.upd-status{font-size:14px;font-weight:600}',
      '.upd-status[data-tone=ok]{color:var(--dsw-alias-state-success-primary)}',
      '.upd-status[data-tone=accent]{color:var(--dsw-alias-brand-primary)}',
      '.upd-status[data-tone=error]{color:var(--dsw-alias-state-error-primary)}',
      '.upd-status[data-tone=idle]{color:var(--dsw-alias-label-secondary)}',
      '.upd-detail{font-size:12px;color:var(--dsw-alias-label-tertiary);line-height:1.5;white-space:pre-wrap;word-break:break-word}',
      '.upd-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
      '.upd-btn{appearance:none;cursor:pointer;font-size:13px;line-height:1;padding:9px 14px;border-radius:var(--dsw-radius-sm);border:.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary)}',
      '.upd-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}',
      '.upd-btn:disabled{opacity:.5;cursor:default}',
      '.upd-btn[data-kind=primary]{background:var(--dsw-alias-brand-primary);border-color:transparent;color:#fff}',
      '.upd-btn[data-kind=primary]:hover:not(:disabled){filter:brightness(1.06)}',
      '.upd-btn:focus-visible{outline:2px solid var(--dsw-focus-ring-color);outline-offset:2px}',
      '.upd-mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;color:var(--dsw-alias-label-tertiary);word-break:break-all}',
      '.upd-warn{font-size:12px;color:var(--dsw-alias-state-warn-primary);line-height:1.5}',
    ].join('\n')

    // -------------------------------------------------------------------- data

    const STATUS_TIMEOUT_MS = 20_000

    async function requestStatus({ refresh = false } = {}) {
      const controller = typeof AbortController === 'function' ? new AbortController() : null
      const timer = controller === null ? undefined : setTimeout(() => controller.abort(), STATUS_TIMEOUT_MS)
      try {
        const response = await fetch(`${API_PREFIX}/status${refresh ? '?refresh=1' : ''}`, {
          credentials: 'same-origin',
          headers: { accept: 'application/json' },
          ...(controller === null ? {} : { signal: controller.signal }),
        })
        if (!response.ok) throw new Error(`${API_PREFIX}/status: HTTP ${response.status}`)
        return await response.json()
      } finally {
        if (timer !== undefined) clearTimeout(timer)
      }
    }

    /** The Desktop preload bridge, or null when this page is not the product window. */
    function nativeUpdater() {
      const bridge = window.dshDesktop
      if (bridge === undefined || bridge === null) return null
      const updates = bridge.updates
      if (updates === undefined || updates === null) return null
      if (typeof updates.status !== 'function' || typeof updates.open !== 'function') return null
      if (typeof updates.subscribe !== 'function') return null
      return updates
    }

    /** Native failure kinds → which operation failed (main.js `desktopUpdateFailureKind`). */
    const NATIVE_FAILURE_REASON = {
      check: 'updateFailedCheck',
      'check-network': 'updateFailedCheck',
      download: 'updateFailedDownload',
      'download-network': 'updateFailedDownload',
      install: 'updateFailedInstall',
      'install-network': 'updateFailedInstall',
    }

    /** Pure: turn a status payload + native state into what the panel shows. */
    function describeStatus(status, native) {
      if (native !== null && native.phase !== undefined && native.phase !== 'idle') {
        if (native.phase === 'downloading') {
          return { tone: 'accent', title: 'downloading', detail: '', phase: 'downloading', percent: native.percent ?? 0 }
        }
        if (native.phase === 'error') {
          const kind = typeof native.failure === 'string' ? native.failure : ''
          return {
            tone: 'error',
            title: 'updateFailed',
            detail: '',
            phase: 'error',
            reason: NATIVE_FAILURE_REASON[kind] ?? 'updateFailedGeneric',
          }
        }
        return {
          tone: 'accent',
          title: native.phase,
          detail: '',
          phase: native.phase,
          version: typeof native.version === 'string' ? native.version : '',
        }
      }
      if (status.kind === 'loading') return { tone: 'idle', title: 'loading', detail: '' }
      if (status.kind === 'error') return { tone: 'error', title: 'checkFailed', detail: status.message }
      const value = status.value
      if (value === null || typeof value !== 'object') return { tone: 'error', title: 'checkFailed', detail: '' }
      if (value.error) {
        const key = value.error.kind === 'feed-unreachable' || value.error.kind === 'feed-timeout'
          ? 'feedUnreachable'
          : value.error.kind === 'feed-unconfigured'
            ? 'feedUnconfigured'
            : value.error.kind === 'manifest-invalid'
              ? 'manifestInvalid'
              : value.error.kind === 'version-unknown'
                ? 'versionUnknown'
                : 'checkFailed'
        return { tone: 'error', title: key, detail: value.error.message ?? '', currentVersion: value.currentVersion }
      }
      if (value.updateAvailable === true) {
        return { tone: 'accent', title: 'available', detail: '', version: value.latest?.version ?? '' }
      }
      return { tone: 'ok', title: 'upToDate', detail: '' }
    }

    /** Pure: which button the user gets, and what it does. */
    function resolveAction(status, updater) {
      if (status.kind !== 'ready') return { kind: 'none' }
      const value = status.value
      if (value === null || value.updateAvailable !== true) return { kind: 'none' }
      const ownFeed = value.feed?.source === 'app-update.yml'
      if (updater !== null && ownFeed) return { kind: 'native', version: value.latest?.version ?? '' }
      if (typeof value.latest?.downloadUrl === 'string') {
        return { kind: 'download', url: value.latest.downloadUrl, nativeMismatch: updater !== null && !ownFeed }
      }
      return { kind: 'none', version: value.latest?.version ?? '' }
    }

    // ------------------------------------------------------------------- views

    function formatVersion(t, value) {
      return typeof value === 'string' && value !== '' ? `v${value.replace(/^v/, '')}` : t('unknown')
    }

    /** Guards against a second click landing before React commits the disabled state. */
    let handoffLatch = false

    function UpdateCheckPage(props) {
      // `t` arrives because the registration declares `locale`; keep a passthrough for safety.
      const t = typeof props.t === 'function' ? props.t : (key) => key
      const [status, setStatus] = React.useState({ kind: 'loading' })
      const [native, setNative] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const [handingOff, setHandingOff] = React.useState(false)
      const [notice, setNotice] = React.useState('')

      const releaseHandoff = () => {
        handoffLatch = false
        setHandingOff(false)
      }

      const load = (refresh) => {
        let cancelled = false
        setBusy(true)
        requestStatus({ refresh }).then((value) => {
          if (cancelled) return
          setStatus({ kind: 'ready', value })
          setBusy(false)
          releaseHandoff()
        }, (error) => {
          if (cancelled) return
          setStatus({ kind: 'error', message: String(error?.message ?? error) })
          setBusy(false)
        })
        return () => { cancelled = true }
      }

      React.useEffect(() => {
        const updater = nativeUpdater()
        if (updater !== null) {
          let cancelled = false
          updater.status().then((state) => { if (!cancelled) setNative(state) }, () => {})
          const off = updater.subscribe((state) => {
            handoffLatch = false
            setNative(state)
          })
          return () => { cancelled = true; if (typeof off === 'function') off() }
        }
        return undefined
      }, [])

      React.useEffect(() => load(false), [])

      const view = describeStatus(status, native)
      const action = resolveAction(status, nativeUpdater())
      const value = status.kind === 'ready' ? status.value : null
      const currentVersion = value?.currentVersion ?? view.currentVersion ?? null
      const latestVersion = value?.latest?.version ?? null

      const onUpdate = () => {
        if (handingOff || handoffLatch) return
        const updater = nativeUpdater()
        if (action.kind === 'native' && updater !== null) {
          handoffLatch = true
          setHandingOff(true)
          setNotice('handedOff')
          Promise.resolve(updater.open()).then(releaseHandoff, releaseHandoff)
          return
        }
        if (action.kind === 'download' && typeof window.open === 'function') {
          handoffLatch = true
          setHandingOff(true)
          window.open(action.url, '_blank', 'noopener')
          setNotice('openedDownload')
          setTimeout(releaseHandoff, 1500)
        }
      }

      const statusText = view.title === 'loading'
        ? t('loading')
        : view.title === 'available'
          ? t('available', { version: view.version })
          : view.title === 'downloading'
            ? t('downloading', { percent: view.percent })
            : view.title === 'verifying'
              ? t('verifying')
              : view.title === 'ready'
                ? t('ready')
                : view.title === 'installing'
                  ? t('installing')
                  : view.title === 'updateFailed'
                    ? t('updateFailed', { reason: t(view.reason ?? 'updateFailedGeneric') })
                    : view.title === 'checkFailed' || view.tone === 'error'
                    ? t(view.title === 'checkFailed' ? 'checkFailed' : view.title)
                    : t('upToDate')

      const rows = []
      rows.push(h('div', { key: 'current', className: 'upd-row' },
        h('span', { className: 'upd-key' }, t('currentVersion')),
        h('span', { className: 'upd-val' }, formatVersion(t, currentVersion))))
      if (latestVersion !== null) {
        rows.push(h('div', { key: 'latest', className: 'upd-row' },
          h('span', { className: 'upd-key' }, t('latestVersion')),
          h('span', { className: 'upd-val' }, formatVersion(t, latestVersion))))
      }
      if (value?.feed?.manifestUrl) {
        rows.push(h('div', { key: 'feed', className: 'upd-row' },
          h('span', { className: 'upd-key' }, t('feedLabel')),
          h('span', { className: 'upd-mono' }, value.feed.manifestUrl)))
      }
      if (value?.checkedAt) {
        rows.push(h('div', { key: 'checked', className: 'upd-row' },
          h('span', { className: 'upd-key' }, t('checkedAt')),
          h('span', { className: 'upd-val' }, new Date(value.checkedAt).toLocaleTimeString())))
      }
      if (native !== null && native.phase !== undefined && native.phase !== 'idle') {
        rows.push(h('div', { key: 'native', className: 'upd-row' },
          h('span', { className: 'upd-key' }, t('nativePhase')),
          h('span', { className: 'upd-val' }, `${native.phase}${native.percent === undefined ? '' : ` ${native.percent}%`}`)))
      }

      const actions = []
      if (action.kind === 'native' || action.kind === 'download') {
        actions.push(h('button', {
          key: 'update',
          type: 'button',
          className: 'upd-btn',
          'data-kind': 'primary',
          disabled: busy || handingOff || view.phase === 'downloading' || view.phase === 'installing',
          onClick: onUpdate,
        }, action.kind === 'native' ? t('update') : t('download')))
      }
      actions.push(h('button', {
        key: 'refresh',
        type: 'button',
        className: 'upd-btn',
        disabled: busy,
        onClick: () => load(true),
      }, busy ? t('checking') : t('refresh')))

      const notes = []
      if (notice !== '') notes.push(h('div', { key: 'notice', className: 'upd-detail' }, t(notice)))
      if (nativeUpdater() === null) notes.push(h('div', { key: 'browser', className: 'upd-warn' }, t('browserMode')))
      if (action.kind === 'none' && value?.updateAvailable === true && action.version) {
        notes.push(h('div', { key: 'mismatch', className: 'upd-warn' }, t('noAction')))
      }
      notes.push(h('div', { key: 'hint', className: 'upd-detail' }, t('nativeHint')))

      return h('div', { className: 'upd-page' },
        h('div', { className: 'upd-head' },
          h('div', null,
            h('div', { className: 'upd-title' }, t('panelTitle')),
            h('div', { className: 'upd-sub' }, t('panelHint')))),
        h('div', { className: 'upd-card' },
          h('div', { className: 'upd-status', 'data-tone': view.tone, role: 'status' }, statusText),
          view.detail ? h('div', { className: 'upd-detail' }, view.detail) : null,
          rows,
          h('div', { className: 'upd-actions' }, actions),
          notes),
      )
    }

    function PanelIcon() {
      return h('svg', { width: 18, height: 18, viewBox: '0 0 18 18', fill: 'none', 'aria-hidden': true },
        h('path', { d: 'M9 2.5v7.5', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' }),
        h('path', { d: 'M5.5 6.5 9 10l3.5-3.5', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' }),
        h('path', { d: 'M3.5 12.5v1a1.5 1.5 0 0 0 1.5 1.5h8a1.5 1.5 0 0 0 1.5-1.5v-1', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' }),
      )
    }

    function insertStyles() {
      const tag = document.createElement('style')
      tag.dataset.plugin = 'dsh-update-check'
      tag.dataset.pluginCss = 'dsh-update-check/client.css'
      tag.textContent = CSS
      document.head.appendChild(tag)
      return () => { tag.remove() }
    }

    // -------------------------------------------------------------------- mount

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }))
      ctx.effect(() => insertStyles())
      ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
        name: 'sidebar.panellist',
        id: PANEL_KEY,
        order: 60,
        label: () => (ctx.locale.bind(NS))('panelTitle'),
      }, PanelIcon))
      ctx.slots.inject('main', () => ctx.slots.register({
        name: 'main',
        key: PANEL_KEY,
        locale: NS,
      }, UpdateCheckPage))
    }

    return {
      inject: ['slots', 'locale'],
      apply,
      // Test seams: pure helpers, no DOM required.
      __test: { describeStatus, resolveAction, requestStatus, nativeUpdater },
    }
  },
})
