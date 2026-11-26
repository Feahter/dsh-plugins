// Readable, deterministic views of the novel artifacts. No model calls or disk writes.
import { buildOutlineSkeleton } from './plan.js'
import { chapterId } from './outline.js'
import { countCjk } from './craft.js'
import { castTier, splitInline } from './chapter.js'
import { slugify } from './export.js'
import { emptyCanon, entityOf, formatCanon, mergeCanon } from './canon.js'

const list = (value) => Array.isArray(value) ? value : []
const text = (value) => typeof value === 'string' ? value.trim() : ''
const line = (value) => text(value).replace(/\s+/g, ' ')
const cell = (value) => line(value).replaceAll('|', '\\|') || '—'
const number = (value) => Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : 0
const chapterNumber = (id) => number(/^ch(\d+)$/i.exec(id ?? '')?.[1])
const ordered = (rows) => rows.map((row, i) => ({ row, index: number(row.index) || i + 1 }))
  .sort((a, b) => a.index - b.index).map(({ row }) => row)

function chapterPlan(outline, spine, params, artifacts) {
  const total = number(outline?.totalChapters) || number(params.chapters)
  const skeleton = spine && total ? buildOutlineSkeleton({ ...params, chapters: total, spine }) : null
  const volumes = ordered(list(outline?.volumes).length ? outline.volumes : list(skeleton?.volumes ?? spine?.volumes))
  const flat = list(outline?.chapters)
  const groups = (volumes.length ? volumes : [{}]).map((volume, index) => {
    const fromSpine = list(spine?.volumes)[index] ?? {}
    const rows = list(volume.chapters).length ? volume.chapters : (volumes.length
      ? flat.filter((row) => row.volume === volume.id && Boolean(volume.id) || list(volume.chapterIds).includes(row.id))
      : flat)
    return { ...fromSpine, ...volume, title: text(volume.title) || `第 ${index + 1} 卷`, rows: ordered(rows) }
  })
  const assigned = new Set(groups.flatMap((group) => group.rows.map((row) => row.id)))
  const unmatched = flat.filter((row) => !assigned.has(row.id))
  if (unmatched.length) groups[0].rows.push(...unmatched)

  const used = new Set()
  let offset = 0
  for (const group of groups) {
    const size = Math.max(number(group.targetChapters), group.rows.length)
    const planned = new Map(group.rows.map((row, i) => [number(row.index) || chapterNumber(row.id) || offset + i + 1, row]))
    for (let i = 1; i <= size; i++) {
      const no = offset + i
      if (!planned.has(no)) planned.set(no, { skeleton: true })
    }
    group.rows = [...planned].sort(([a], [b]) => a - b).map(([no, row]) => {
      const id = row.id || chapterId(no - 1, total)
      used.add(id)
      return { ...row, no, id }
    })
    offset += size
  }
  for (const key of [...artifacts.keys()].filter((key) => key.startsWith('draft/')).sort()) {
    const id = key.slice(6)
    if (!used.has(id)) groups.at(-1).rows.push({ id, no: chapterNumber(id) || ++offset })
  }
  for (const group of groups) group.rows.sort((a, b) => a.no - b.no)
  return groups
}

function chapterMarkdown(draft, title, no) {
  const body = splitInline(draft).body
  if (!body) return null
  if (/^#{1,6}\s+/u.test(body)) return body
  const [first, ...rest] = body.split('\n')
  if (/^(?:第\s*[\d一二三四五六七八九十百千零〇两]+\s*章|chapter\s+\d+\b)/iu.test(first) || line(first) === title) {
    return `# ${first}\n${rest.join('\n')}`
  }
  return `# 第 ${no} 章 ${title}\n\n${body}`
}

export function renderBook(project, artifacts, { stage, itemId } = {}) {
  const get = (key) => artifacts.get(key)?.content
  const params = project.params ?? {}
  const brief = get('brief') ?? {}
  const pitch = get('pitch') ?? {}
  const blurb = get('blurb') ?? {}
  const spine = get('spine')
  const outline = get('outline')
  const groups = chapterPlan(outline, spine, params, artifacts)
  const chapters = groups.flatMap((group) => group.rows).sort((a, b) => a.no - b.no)
  const files = new Map()
  const put = (path, body) => { if (text(body)) files.set(path, `${body.trimEnd()}\n`) }
  const bullet = (label, value) => text(value) ? `- ${label}：${line(value)}` : ''
  const table = (header, rows) => [
    `| ${header.join(' | ')} |`, `| ${header.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.join(' | ')} |`),
  ].join('\n')
  let drafted = 0
  let words = 0
  for (const row of chapters) {
    const draft = get(`draft/${row.id}`)
    const review = get(`review/${row.id}`)
    row.title = line(row.title) || `第 ${row.no} 章`
    const markdown = chapterMarkdown(draft, row.title, row.no)
    row.status = row.skeleton ? '待排章' : '待写'
    if (markdown) {
      row.file = `chapters/${String(row.no).padStart(4, '0')}-${slugify(row.title)}.md`
      row.words = countCjk(markdown.replace(/^#{1,6}\s+[^\n]*(?:\n|$)/u, ''))
      row.status = artifacts.get(`draft/${row.id}`)?.meta?.by?.stage === 'revise' ? '已修订'
        : review ? `已审校${review.verdict === 'revise' ? '（待修订）' : ''}` : '已写'
      drafted += 1
      words += row.words
      put(row.file, markdown)
    }
  }

  const title = line(blurb.title || brief.title || project.title || params.title) || '未命名'
  const total = Math.max(chapters.at(-1)?.no ?? 0, number(outline?.totalChapters) || number(params.chapters))
  const readme = [
    `# ${title}`, '',
    bullet('一句话卖点', pitch.sellingPoint || blurb.tagline || brief.logline || params.premise),
    bullet('故事提案', brief.logline && brief.logline !== pitch.sellingPoint ? brief.logline : ''),
    bullet('开篇钩子', pitch.hookLine),
    bullet('类型', [params.genre, ...new Set([...list(brief.genreTags), ...list(pitch.tags), ...list(blurb.tags)])].filter(Boolean).join('、')),
    bullet('频道', pitch.channel || params.channel), `- 进度：${drafted}/${total} 章，${words} 字`,
    ...(text(blurb.blurb) ? ['', '## 简介', '', text(blurb.blurb)] : []),
  ].filter((entry, i) => entry || i === 1)

  const bible = get('bible')
  if (text(bible)) files.set('bible.md', bible)
  const cast = list(get('characters')?.cast)
  const source = get('canon') ?? get('ledger')
  const canon = source && (Number(source.version) === 2 ? source : mergeCanon(emptyCanon(), source))
  const covered = new Set()
  const withCanon = cast.filter((person) => text(person?.name)).map((person) => {
    const found = entityOf(canon, person.name)
    if (!found || found.entity.kind !== 'character') return person
    covered.add(found.name)
    const { entity } = found
    const aliases = [...new Set([...list(person.aliases), ...list(entity.aliases)].map(line))]
      .filter((alias) => alias && alias !== line(person.name))
    return { ...person, aliases, firstSeen: person.firstSeen || entity.firstSeen }
  })
  const registered = Object.entries(canon?.entities ?? {}).filter(([key, entity]) => entity?.kind === 'character' && !covered.has(key))
    .map(([key, entity]) => ({ ...entity, name: entity.displayName || key, tier: 'minor' }))
  const roster = [...withCanon, ...registered]
  if (roster.length) {
    const byTier = (tier) => roster.filter((person) => castTier(person) === tier)
    const aliasesOf = (person) => list(person.aliases).map(line).filter((alias) => alias && alias !== line(person.name)).join('、')
    const core = byTier('core').map((person) => [
      `\n### ${line(person.name)}`,
      ...Object.entries({ role: '定位', gender: '性别', want: '欲望（want）', need: '需求（need）', wound: '创伤（wound）', lie: '谎言（lie）' })
        .map(([key, label]) => bullet(label, person[key])),
      bullet('关系', list(person.relations).map(({ to, kind }) => [line(to), line(kind)].filter(Boolean).join('：')).filter(Boolean).join('；')),
      bullet('别名', aliasesOf(person)), bullet('首次出场', person.firstSeen),
    ].filter(Boolean).join('\n'))
    const major = byTier('major').map((person) => `- ${[
      line(person.name), line(person.role), person.want && `想要：${line(person.want)}`,
      person.pressure && `压力：${line(person.pressure)}`, person.recognitionTag && `标签：${line(person.recognitionTag)}`,
      aliasesOf(person) && `别名：${aliasesOf(person)}`, person.firstSeen && `首次出场：${line(person.firstSeen)}`,
    ].filter(Boolean).join('｜')}`)
    const minor = byTier('minor').map((person) => [
      cell([line(person.name), aliasesOf(person) && `（${aliasesOf(person)}）`].filter(Boolean).join('')),
      cell(person.role), cell(person.firstSeen),
    ])
    put('characters.md', ['# 人物档案', '', '## 核心人物', ...core,
      '', '## 阶段人物', '', ...major, '', '## 登记人物', '', table(['名字', '定位', '首次出场'], minor),
    ].join('\n'))
  }

  if (outline || spine) {
    put('outline.md', ['# 卷章大纲', '', bullet('主线', spine?.mainline), bullet('结局', spine?.ending),
      ...groups.map((group) => [
        `\n## ${line(group.title)}`, bullet('卷目标', group.goal || group.purpose), bullet('卷故事弧', group.arc), bullet('卷末钩子', group.cliffhanger),
        ...(group.rows.length ? ['', table(['章号', '标题', '目标', '冲突', '钩子'], group.rows.map((row) => [
          row.no, cell(row.title), cell(row.goal || (row.skeleton && group.goal)), cell(row.conflict), cell(row.hook?.text || row.hook),
        ]))] : []),
      ].filter(Boolean).join('\n')),
    ].join('\n'))
  }
  if (canon) {
    const formatted = formatCanon(canon, { maxChars: 0 })
    if (formatted) put('canon.md', `# 正典\n\n${formatted.replace(/^【(.+)】$/gm, '\n## $1\n').trim()}`)
  }
  const links = [['bible.md', '世界设定'], ['characters.md', '人物档案'], ['outline.md', '卷章大纲'], ['canon.md', '正典']]
    .filter(([path]) => files.has(path)).map(([path, label]) => `[${label}](${path})`)
  if (links.length) readme.push('', links.join(' · '))
  if (chapters.length) readme.push('', '## 章节目录', '', table(['章号', '标题', '状态'], chapters.map((row) => [
    row.no, row.file ? `[${cell(row.title).replace(/[\[\]]/g, '\\$&')}](${encodeURI(row.file).replace(/[()#]/g, (char) => `%${char.charCodeAt(0).toString(16)}`)})` : cell(row.title), row.status,
  ])))
  put('README.md', readme.join('\n'))

  const row = chapters.find((chapter) => chapter.id === itemId)
  const messages = {
    premise: `立项：${title}`, bible: '世界设定：更新设定原文', characters: `人物档案：写完 ${cast.length} 个角色`,
    spine: `卷纲：${groups.length} 卷 ${total} 章`, outline: `章纲：${groups.length} 卷 ${total} 章`, blurb: `书名与简介：${title}`,
  }
  const chapterStage = { draft: '初稿', review: '审校', revise: '修订' }[stage]
  const message = chapterStage
    ? `第 ${row?.no || chapterNumber(itemId) || itemId} 章 ${row?.title ?? ''}：${chapterStage}（${row?.words ?? 0} 字）`
    : messages[stage] ?? `回填书稿：${title}`
  return { files, message }
}

export function isBookSnapshotStage(stage, itemId) {
  return (itemId ? ['draft', 'review', 'revise'] : ['premise', 'bible', 'characters', 'spine', 'outline', 'blurb']).includes(stage)
}
