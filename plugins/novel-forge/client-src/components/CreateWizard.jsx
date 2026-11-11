// 新建长篇：一屏向导。左边是参数，右边是本地公式算出来的实时预估。
import React from 'react'
import { Button, Field, Switch, formatNumber, formatTokens } from './bits.jsx'
import { GENRES, POVS, STAGES } from '../strings.js'
import * as api from '../api.js'

const DEFAULT = {
  premise: '',
  title: '',
  genre: '悬疑',
  chapters: 24,
  wordsPerChapter: 3000,
  pov: '第三人称限知',
  audience: '成年',
  tone: '',
  styleGuide: '',
  reviewGate: false,
}

const CHAPTER_PRESETS = [6, 12, 24, 48]
const WORD_PRESETS = [2000, 3000, 4500, 6000]

/** 本地预估，不调模型：调用数 ≈ 章数×4+8，token ≈ 章数×每章字数×3.2。 */
export function estimateFor(chapters, wordsPerChapter) {
  const chapterCount = Math.max(0, Number(chapters) || 0)
  const words = Math.max(0, Number(wordsPerChapter) || 0)
  const calls = chapterCount * 4 + 8
  const tokens = Math.round(chapterCount * words * 3.2)
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

export function CreateWizard({ onCreated, onCancel, notify }) {
  const [form, setForm] = React.useState(DEFAULT)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState(null)
  const estimate = React.useMemo(() => estimateFor(form.chapters, form.wordsPerChapter), [form.chapters, form.wordsPerChapter])

  const set = (key, value) => setForm(previous => ({ ...previous, [key]: value }))

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
          audience: form.audience,
          language: 'zh',
          chapters: Number(form.chapters) || 24,
          wordsPerChapter: Number(form.wordsPerChapter) || 3000,
          pov: form.pov,
          tone: form.tone.trim(),
          styleGuide: form.styleGuide.trim(),
          autoReview: true,
          reviewGate: Boolean(form.reviewGate),
        },
      })
      await api.startRun(project.id, {
        stages: STAGES.map(stage => stage.id),
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
              React.createElement('input', {
                className: 'nf-input', value: form.title, placeholder: '长夜将明',
                onChange: event => set('title', event.target.value), maxLength: 80,
              }),
            ),
            React.createElement(Field, { label: '类型' },
              React.createElement('select', {
                className: 'nf-select', value: form.genre,
                onChange: event => set('genre', event.target.value),
              }, GENRES.map(genre => React.createElement('option', { key: genre, value: genre }, genre))),
            ),
          ),

          React.createElement('div', { className: 'nf-row' },
            React.createElement(NumberField, {
              label: '章数', hint: '6–120 章', value: form.chapters, min: 6, max: 120,
              onChange: value => set('chapters', value), presets: CHAPTER_PRESETS, suffix: ' 章',
            }),
            React.createElement(NumberField, {
              label: '每章字数', hint: '800–8000 字', value: form.wordsPerChapter, min: 800, max: 8000,
              onChange: value => set('wordsPerChapter', value), presets: WORD_PRESETS, suffix: ' 字',
            }),
          ),

          React.createElement('div', { className: 'nf-row-3' },
            React.createElement(Field, { label: '视角' },
              React.createElement('select', {
                className: 'nf-select', value: form.pov,
                onChange: event => set('pov', event.target.value),
              }, POVS.map(pov => React.createElement('option', { key: pov, value: pov }, pov))),
            ),
            React.createElement(Field, { label: '文风', hint: '几个词就够' },
              React.createElement('input', {
                className: 'nf-input', value: form.tone, placeholder: '冷、克制、潮湿的温情',
                onChange: event => set('tone', event.target.value), maxLength: 200,
              }),
            ),
            React.createElement(Field, { label: '读者' },
              React.createElement('select', {
                className: 'nf-select', value: form.audience,
                onChange: event => set('audience', event.target.value),
              }, ['成年', '青少年', '泛读者'].map(audience => React.createElement('option', { key: audience, value: audience }, audience))),
            ),
          ),

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
            React.createElement('b', null, `${estimate.calls} 次`),
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
            '预估是本地公式，不进模型：调用数 = 章数×4+8，token ≈ 章数×每章字数×3.2。',
            form.reviewGate ? ' 审稿门打开后，中途停下的时间不算在内。' : '',
          ),
        ),
      ),
    ),
  )
}
