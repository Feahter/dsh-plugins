// 新建长篇：一屏向导。左边是参数，右边是本地公式算出来的实时预估。
import React from 'react'
import { Button, Field, Switch, formatNumber, formatTokens } from './bits.jsx'
import { CADENCES, CHANNELS, GENRES, LONGFORM_FIELDS, POVS, STAGES } from '../strings.js'
import { randomIdea } from '../ideas.js'
import * as api from '../api.js'

const DEFAULT = {
  premise: '',
  title: '',
  genre: '悬疑',
  channel: '通用',
  tags: '',
  sellingPoint: '',
  chapters: 24,
  wordsPerChapter: 3000,
  chaptersPerVolume: 30,
  updateCadence: '日更',
  goldenFinger: '',
  comps: '',
  pov: '第三人称限知',
  protagonistGender: 'auto',
  audience: '成年',
  tone: '',
  styleGuide: '',
  reviewGate: false,
}

// 网文动辄几百章：上限跟 recipe 的 paramsSchema 对齐（6–3000），预设取常见连载体量。
const CHAPTER_PRESETS = [100, 300, 600, 1000]
const CHAPTER_MIN = 6
const CHAPTER_MAX = 3000
const CHAPTERS_PER_VOLUME_PRESETS = [20, 30, 40, 50]
const CHAPTERS_PER_VOLUME_MIN = 10
const CHAPTERS_PER_VOLUME_MAX = 60
const CHAPTERS_PER_VOLUME_DEFAULT = 30
const VOLUME_LIMIT = 40
const WORD_PRESETS = [2000, 3000, 4500, 6000]
const GENDER_PRESETS = [
  { value: 'auto', label: '自动' },
  { value: '男', label: '男' },
  { value: '女', label: '女' },
]

function clampPerVolume(value) {
  const number = Math.round(Number(value) || 0)
  if (!number) return CHAPTERS_PER_VOLUME_DEFAULT
  return Math.min(CHAPTERS_PER_VOLUME_MAX, Math.max(CHAPTERS_PER_VOLUME_MIN, number))
}

/** 与 plan.volumeCount 同口径：超过 40 卷时自动抬升每卷章数，保证卷数 ≤ 40。 */
function volumeCountFor(chapters, chaptersPerVolume = CHAPTERS_PER_VOLUME_DEFAULT) {
  const total = Math.max(0, Number(chapters) || 0)
  if (!total) return 0
  const perVolume = clampPerVolume(chaptersPerVolume)
  const effective = total / perVolume > VOLUME_LIMIT
    ? Math.max(1, Math.ceil(total / VOLUME_LIMIT))
    : perVolume
  return Math.ceil(total / effective)
}

/** 本地预估，不调模型；公式与 recipe.estimate 保持一致，服务端可达时以服务端为准。 */
export function estimateFor(chapters, wordsPerChapter, autoReview = true, chaptersPerVolume = CHAPTERS_PER_VOLUME_DEFAULT) {
  const chapterCount = Math.max(0, Number(chapters) || 0)
  const words = Math.max(0, Number(wordsPerChapter) || 0)
  // 固定 7 段（pitch/brief/设定/人物/脊柱/开篇/首卷章纲）+ 每章 3.5 次
  // （细纲 / 草稿（含内联摘要）/ 审校 / 修订（含内联摘要））；不开审校只有 2.5 次。
  const perChapter = autoReview ? 3.5 : 2.5
  const volumes = volumeCountFor(chapterCount, chaptersPerVolume)
  const calls = Math.ceil(7 + chapterCount * perChapter + volumes)
  const perChar = 1 / 1.6 // 中文约 1.6 字/token
  // 常量来自 12 章 × 3000 字的实测聚合（docs/architecture.md §6.5）。
  // 与 recipe.estimate 同步：pitch/opener 各多一次调用，固定段 6→7。
  const fixedIn = 32000
  const fixedOut = 13700
  const prose = ratio => Math.round(words * ratio)
  const perIn = 5483 + 6324 + (autoReview ? 6331 + prose(1.05) + 4581 + prose(1.05) : 0)
  const perOut = 1757 + prose(1.03) + (autoReview ? 1053 + prose(1.07) : 0)
  const tokens = Math.round((fixedIn + chapterCount * perIn + fixedOut + chapterCount * perOut) * perChar)
  // 一次调用大致 2 分钟（含写正文的长调用），只给一个量级。
  const minutes = calls * 2
  return { chapters: chapterCount, calls, tokens, minutes }
}

function duration(minutes) {
  if (minutes < 60) return `${minutes} 分钟`
  const hours = minutes / 60
  if (hours < 10) return `${hours.toFixed(1).replace(/\.0$/, '')} 小时`
  return `${Math.round(hours)} 小时`
}

function NumberField({ label, hint, value, onChange, min, max, presets, suffix }) {
  return React.createElement(Field, { label, hint },
    React.createElement('div', { className: 'nf-actions', style: { marginTop: 0, alignItems: 'stretch' } },
      React.createElement('input', {
        className: 'nf-input', type: 'number', value, min, max,
        onChange: event => onChange(Number(event.target.value)),
        style: { flex: '0 0 108px' },
        'aria-label': label,
      }),
      React.createElement('div', { style: { display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' } },
        presets.map(preset => React.createElement('button', {
          key: preset,
          type: 'button',
          className: 'nf-btn nf-btn-sm nf-btn-quiet',
          onClick: () => onChange(preset),
          'aria-pressed': value === preset,
          style: value === preset ? { borderColor: 'var(--nf-ink)', color: 'var(--nf-ink)' } : undefined,
        }, `${preset}${suffix || ''}`)),
      ),
    ),
  )
}

function SegmentField({ label, hint, value, options, onChange }) {
  return React.createElement('div', { className: 'nf-field' },
    React.createElement('span', { className: 'nf-label' }, label,
      hint ? React.createElement('em', null, hint) : null),
    React.createElement('div', {
      role: 'group',
      'aria-label': label,
      style: { display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' },
    },
    options.map(option => React.createElement('button', {
      key: option,
      type: 'button',
      className: 'nf-btn nf-btn-sm nf-btn-quiet',
      onClick: () => onChange(option),
      'aria-pressed': value === option,
      style: value === option ? { borderColor: 'var(--nf-ink)', color: 'var(--nf-ink)' } : undefined,
    }, option))),
  )
}

export function CreateWizard({ onCreated, onCancel, notify }) {
  const [form, setForm] = React.useState(DEFAULT)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState(null)
  const [showMore, setShowMore] = React.useState(false)
  const localEstimate = React.useMemo(
    () => estimateFor(form.chapters, form.wordsPerChapter, form.autoReview !== false, form.chaptersPerVolume),
    [form.chapters, form.wordsPerChapter, form.autoReview, form.chaptersPerVolume],
  )
  // 后端按 recipe.estimate 算（含审校/修订的真实调用数）；拿不到就退回本地公式。
  const [serverEstimate, setServerEstimate] = React.useState(null)
  React.useEffect(() => {
    let live = true
    const timer = setTimeout(() => {
      // 估算只吃篇幅、每卷章数与审校开关：主角性别不影响调用数，不往这里带。
      api.estimateNew({
        genre: form.genre,
        chapters: Number(form.chapters) || 24,
        wordsPerChapter: Number(form.wordsPerChapter) || 3000,
        chaptersPerVolume: clampPerVolume(form.chaptersPerVolume),
        autoReview: form.autoReview !== false,
      }).then(value => {
        if (live && value && Number.isFinite(value.calls)) setServerEstimate(value)
      }).catch(() => {})
    }, 300)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [form.chapters, form.wordsPerChapter, form.chaptersPerVolume, form.genre, form.autoReview])
  const estimate = serverEstimate
    ? {
        chapters: serverEstimate.chapters ?? localEstimate.chapters,
        calls: serverEstimate.calls,
        tokens: (serverEstimate.estTokensIn ?? 0) + (serverEstimate.estTokensOut ?? 0),
        minutes: serverEstimate.calls * 2,
        note: serverEstimate.note,
      }
    : localEstimate

  const set = (key, value) => setForm(previous => ({ ...previous, [key]: value }))

  // 本地随机：不调模型，一次把故事核/书名/类型/文风/篇幅都填上，用户再改。
  const randomize = () => {
    setForm(previous => ({ ...previous, ...randomIdea() }))
    setError(null)
  }

  // AI 协助：一次调用当前模型，结果放回对应输入框；失败只提示，不动已填内容。
  const [assistBusy, setAssistBusy] = React.useState('')
  const runAssist = async task => {
    if (assistBusy) return
    const source = task === 'polish-tone' ? form.tone : form.premise
    if (!source.trim()) {
      setError(task === 'polish-tone' ? '先写几个文风词，再让 AI 顺一遍。' : '先写一两句故事核，再让 AI 润色。')
      return
    }
    setAssistBusy(task)
    setError(null)
    try {
      const text = await api.assist({ task, text: source.trim(), genre: form.genre, tone: form.tone.trim() })
      if (task === 'title') {
        const lines = text.split('\n').map(line => line.replace(/^[\d.、\-*\s]+/, '').trim()).filter(Boolean)
        if (!lines.length) throw new Error('模型没给出可用书名')
        set('title', lines[0].slice(0, 80))
        notify(lines.length > 1 ? `另外两个：${lines.slice(1).join(' / ')}` : `书名：${lines[0]}`, 'ok')
      } else if (task === 'polish-tone') {
        set('tone', text.split('\n')[0].slice(0, 200))
      } else {
        set('premise', text.slice(0, 2000))
        notify('润色好了，可以接着改。', 'ok')
      }
    } catch (caught) {
      const message = caught?.message || String(caught)
      setError(message)
      notify(message, 'error')
    } finally {
      setAssistBusy('')
    }
  }

  const submit = async event => {
    event?.preventDefault?.()
    const premise = form.premise.trim()
    if (premise.length < 8) {
      setError('故事核至少写 8 个字——一句话也行，但要能看出人和事。')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const project = await api.createProject({
        title: form.title.trim() || undefined,
        recipeId: 'novel',
        params: {
          premise,
          title: form.title.trim(),
          genre: form.genre,
          channel: form.channel,
          tags: form.tags.split(',').map(tag => tag.trim()).filter(Boolean).join(','),
          sellingPoint: form.sellingPoint.trim(),
          audience: form.audience,
          language: 'zh',
          chapters: Number(form.chapters) || 24,
          wordsPerChapter: Number(form.wordsPerChapter) || 3000,
          chaptersPerVolume: clampPerVolume(form.chaptersPerVolume),
          pov: form.pov,
          protagonistGender: form.protagonistGender,
          tone: form.tone.trim(),
          styleGuide: form.styleGuide.trim(),
          updateCadence: form.updateCadence,
          goldenFinger: form.goldenFinger.trim(),
          comps: form.comps.trim(),
          autoReview: true,
          reviewGate: Boolean(form.reviewGate),
        },
      })
      await api.startRun(project.id, {
        from: 'premise',
        autoApprove: !form.reviewGate,
      })
      notify(`《${project.title || '未命名'}》已开炉。`, 'ok')
      onCreated(project.id)
    } catch (caught) {
      setError(caught.message || String(caught))
      notify(caught.message || '创建失败', 'error')
      setBusy(false)
    }
  }

  // 小按钮：随机（本地）与 AI（调模型）分开，随时能再按。
  const assistBtn = (task, label) => React.createElement('button', {
    type: 'button',
    className: 'nf-btn nf-btn-sm nf-btn-quiet',
    onClick: () => runAssist(task),
    disabled: Boolean(assistBusy) || Boolean(busy),
    'aria-busy': assistBusy === task ? 'true' : undefined,
  }, assistBusy === task ? '处理中…' : label)

  const perVolume = clampPerVolume(form.chaptersPerVolume)
  const volumes = Math.max(1, volumeCountFor(Number(form.chapters) || 0, perVolume))
  const volumeLifted = (Number(form.chapters) || 0) / perVolume > VOLUME_LIMIT

  return React.createElement('div', { className: 'nf-scroll' },
    React.createElement('form', { className: 'nf-create', onSubmit: submit },
      React.createElement('div', { className: 'nf-create-head' },
        React.createElement('h1', null, '新建长篇'),
        React.createElement('p', null, '先给一句话。其余的，墨炉在写的过程中替你问清楚。'),
      ),

      React.createElement('div', { className: 'nf-create-grid' },
        React.createElement('div', { className: 'nf-form' },
          React.createElement(Field, {
            label: '故事核',
            hint: '必填 · 8–2000 字 · 一句话或一小段都行',
          },
          React.createElement('div', { className: 'nf-actions', style: { marginTop: 0, marginBottom: 6, justifyContent: 'flex-start' } },
            React.createElement('button', {
              type: 'button',
              className: 'nf-btn nf-btn-sm',
              onClick: randomize,
              disabled: Boolean(busy) || Boolean(assistBusy),
            }, '随机来一个'),
            assistBtn('polish-premise', 'AI 润色'),
            React.createElement('span', { className: 'nf-muted', style: { fontSize: 10.5 } }, '随机不耗 token；AI 润色会用一次模型调用'),
          ),
          React.createElement('textarea', {
            className: 'nf-textarea nf-textarea-premise',
            value: form.premise,
            placeholder: '一个在殡仪馆值夜班的年轻人，发现死者会在头七那晚回来……',
            onChange: event => set('premise', event.target.value),
            maxLength: 2000,
            autoFocus: true,
            'aria-label': '故事核',
          }),
          ),

          React.createElement('div', { className: 'nf-row' },
            React.createElement(Field, { label: '书名', hint: '可空，留空由第一步起名' },
              React.createElement('div', { className: 'nf-actions', style: { marginTop: 0 } },
                React.createElement('input', {
                  className: 'nf-input', value: form.title, placeholder: '长夜将明',
                  onChange: event => set('title', event.target.value), maxLength: 80,
                }),
                assistBtn('title', '起三个'),
              ),
            ),
            React.createElement(Field, { label: '类型' },
              React.createElement('select', {
                className: 'nf-select', value: form.genre,
                onChange: event => set('genre', event.target.value),
              }, GENRES.map(genre => React.createElement('option', { key: genre, value: genre }, genre))),
            ),
          ),

          React.createElement(SegmentField, {
            label: LONGFORM_FIELDS.channel,
            hint: '决定读者预期与爽点密度；拿不准就选「通用」。',
            value: form.channel, options: CHANNELS,
            onChange: value => set('channel', value),
          }),

          React.createElement('div', { className: 'nf-row' },
            React.createElement(Field, { label: LONGFORM_FIELDS.tags, hint: '3–6 个，逗号分隔 · 可空，留空由 AI 起' },
              React.createElement('input', {
                className: 'nf-input', value: form.tags, placeholder: '都市,异能,升级流',
                onChange: event => set('tags', event.target.value), maxLength: 120,
              }),
            ),
            React.createElement(Field, { label: LONGFORM_FIELDS.sellingPoint, hint: '≤60 字 · 可空，留空由 AI 起' },
              React.createElement('input', {
                className: 'nf-input', value: form.sellingPoint, placeholder: '一句话说清这本书爽在哪',
                onChange: event => set('sellingPoint', event.target.value), maxLength: 60,
              }),
            ),
          ),

          React.createElement('div', { className: 'nf-row' },
            React.createElement(NumberField, {
              label: '章数',
              hint: `6–3000 章 · 每卷约 ${perVolume} 章，当前约 ${volumes} 卷${volumeLifted ? '（超 40 卷会自动加厚每卷）' : ''}`,
              value: form.chapters, min: CHAPTER_MIN, max: CHAPTER_MAX,
              onChange: value => set('chapters', value), presets: CHAPTER_PRESETS, suffix: ' 章',
            }),
            React.createElement(NumberField, {
              label: '每章字数', hint: '800–8000 字', value: form.wordsPerChapter, min: 800, max: 8000,
              onChange: value => set('wordsPerChapter', value), presets: WORD_PRESETS, suffix: ' 字',
            }),
          ),

          React.createElement(NumberField, {
            label: LONGFORM_FIELDS.chaptersPerVolume,
            hint: `10–60 章 · 当前约 ${volumes} 卷${volumeLifted ? '（已按 40 卷上限自动加厚）' : ''}`,
            value: form.chaptersPerVolume, min: CHAPTERS_PER_VOLUME_MIN, max: CHAPTERS_PER_VOLUME_MAX,
            onChange: value => set('chaptersPerVolume', value),
            presets: CHAPTERS_PER_VOLUME_PRESETS, suffix: ' 章',
          }),

          React.createElement('div', { className: 'nf-row-3' },
            React.createElement(Field, { label: '视角' },
              React.createElement('select', {
                className: 'nf-select', value: form.pov,
                onChange: event => set('pov', event.target.value),
              }, POVS.map(pov => React.createElement('option', { key: pov, value: pov }, pov))),
            ),
            React.createElement(Field, { label: '文风', hint: '几个词就够' },
              React.createElement('div', { className: 'nf-actions', style: { marginTop: 0 } },
                React.createElement('input', {
                  className: 'nf-input', value: form.tone, placeholder: '冷、克制、潮湿的温情',
                  onChange: event => set('tone', event.target.value), maxLength: 200,
                }),
                assistBtn('polish-tone', '润色'),
              ),
            ),
            React.createElement(Field, { label: '读者' },
              React.createElement('select', {
                className: 'nf-select', value: form.audience,
                onChange: event => set('audience', event.target.value),
              }, ['成年', '青少年', '泛读者'].map(audience => React.createElement('option', { key: audience, value: audience }, audience))),
            ),
          ),

          React.createElement('div', { className: 'nf-field' },
            React.createElement('span', { className: 'nf-label' },
              '主角性别',
              React.createElement('em', null, '定死主角的代词，避免正文里「他/她」混用；选「自动」由模型按故事核心决定。'),
            ),
            React.createElement('div', {
              role: 'group',
              'aria-label': '主角性别',
              style: { display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' },
            },
            GENDER_PRESETS.map(option => React.createElement('button', {
              key: option.value,
              type: 'button',
              className: 'nf-btn nf-btn-sm nf-btn-quiet',
              onClick: () => set('protagonistGender', option.value),
              'aria-pressed': form.protagonistGender === option.value,
              style: form.protagonistGender === option.value ? { borderColor: 'var(--nf-ink)', color: 'var(--nf-ink)' } : undefined,
            }, option.label))),
          ),

          React.createElement('div', { className: 'nf-field' },
            React.createElement('button', {
              type: 'button',
              className: 'nf-btn nf-btn-sm nf-btn-quiet',
              onClick: () => setShowMore(value => !value),
              'aria-expanded': showMore,
            }, showMore ? `收起${LONGFORM_FIELDS.more}` : LONGFORM_FIELDS.more,
              showMore ? null : React.createElement('em', null, ' · 更新节奏 / 金手指 / 对标作品，都可空')),
          ),

          showMore ? React.createElement('div', { style: { display: 'grid', gap: 12 } },
            React.createElement(SegmentField, {
              label: LONGFORM_FIELDS.updateCadence,
              hint: '影响卷末钩子与存稿建议',
              value: form.updateCadence, options: CADENCES,
              onChange: value => set('updateCadence', value),
            }),
            React.createElement(Field, { label: LONGFORM_FIELDS.comps, hint: '可空 · ≤160 字 · 格式「书名：借什么机制」，1–2 本' },
              React.createElement('textarea', {
                className: 'nf-textarea', value: form.comps, rows: 2,
                placeholder: '《诡秘之主》：借途径升级与失控代价',
                onChange: event => set('comps', event.target.value), maxLength: 160,
              }),
            ),
            React.createElement(Field, { label: LONGFORM_FIELDS.goldenFinger, hint: '可空 · ≤200 字 · 写清规则与代价，别只写名字' },
              React.createElement('textarea', {
                className: 'nf-textarea', value: form.goldenFinger, rows: 3,
                placeholder: '能看见死者最后七秒的记忆，但每用一次就忘掉自己一段记忆。',
                onChange: event => set('goldenFinger', event.target.value), maxLength: 200,
              }),
            ),
          ) : null,

          React.createElement(Field, {
            label: '风格样本', hint: '可空 · 贴一段你想让它学的文字，或写下禁用语',
          },
          React.createElement('textarea', {
            className: 'nf-textarea', value: form.styleGuide, rows: 4,
            placeholder: '比如：不要“仿佛/似乎/缓缓”，少用形容词；对话要短；每段不超过四行。',
            onChange: event => set('styleGuide', event.target.value), maxLength: 4000,
          }),
          ),

          React.createElement(Switch, {
            checked: form.reviewGate,
            onChange: value => set('reviewGate', value),
            label: '审稿门：每步停下来让我看',
            hint: '打开后，大纲与每章草稿写出来会先停住，等你说「继续」再往下炼。',
          }),

          error ? React.createElement('div', { className: 'nf-error' }, error) : null,

          React.createElement('div', { className: 'nf-actions' },
            React.createElement(Button, { variant: 'primary', type: 'submit', busy, disabled: busy }, busy ? '正在开炉…' : '开始炼'),
            React.createElement(Button, { variant: 'quiet', onClick: onCancel, disabled: busy }, '返回书架'),
            React.createElement('span', { className: 'nf-grow' }),
            React.createElement('span', { className: 'nf-muted', style: { fontSize: 10.5 } }, '创建后立即从「故事核心」开始'),
          ),
        ),

        React.createElement('aside', { className: 'nf-estimate' },
          React.createElement('h3', null, '这本大概要'),
          React.createElement('div', { className: 'nf-est-row' },
            React.createElement('span', null, '篇幅'),
            React.createElement('b', null, `${estimate.chapters} 章 · ${formatNumber(form.wordsPerChapter * estimate.chapters)} 字`),
          ),
          React.createElement('div', { className: 'nf-est-row' },
            React.createElement('span', null, '模型调用'),
            React.createElement('b', null, `约 ${formatNumber(estimate.calls)} 次模型调用`),
          ),
          React.createElement('div', { className: 'nf-est-row' },
            React.createElement('span', null, 'token 量级'),
            React.createElement('b', null, formatTokens(estimate.tokens)),
          ),
          React.createElement('div', { className: 'nf-est-row' },
            React.createElement('span', null, '预计耗时'),
            React.createElement('b', null, duration(estimate.minutes)),
          ),
          React.createElement('div', { className: 'nf-est-bar' },
            React.createElement('span', { className: 'nf-progress' },
              React.createElement('i', { style: { width: form.reviewGate ? '55%' : '100%', opacity: form.reviewGate ? .6 : 1 } }))),
          React.createElement('p', { className: 'nf-est-note' },
            estimate.note || '预估不调模型，按当前参数与审校开关折算；公式与 recipe 一致。',
            form.reviewGate ? ' 审稿门打开后，中途停下的时间不算在内。' : '',
          ),
        ),
      ),
    ),
  )
}
