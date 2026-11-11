// 读自媒体工作台（dsh-media-desk）的 state.json，把灵感条目标成可导入的列表。
// 只用只读方式读文件，不改对方任何数据；没装插件时返回空列表。
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { dshHome } from './store.js'

export function inspirationFile(env = process.env) {
  return join(dshHome(env), 'media-desk', 'state.json')
}

/** 只要标题级信息，绝不把整份工作台状态（含成稿、风格、指标）送到浏览器。 */
export function mapInspirations(state, limit = 80) {
  if (!state || !Array.isArray(state.items)) return []
  return state.items
    .filter(item => item && typeof item.id === 'string')
    .map(item => ({
      id: item.id,
      title: typeof item.title === 'string' && item.title.trim() ? item.title.trim().slice(0, 240) : '（无标题灵感）',
      kind: typeof item.kind === 'string' ? item.kind : 'note',
      status: typeof item.status === 'string' ? item.status : null,
      platform: typeof item.platform === 'string' ? item.platform : null,
      createdAt: typeof item.createdAt === 'string' ? item.createdAt : null,
      url: typeof item.url === 'string' ? item.url : null,
      tags: Array.isArray(item.tags) ? item.tags.filter(tag => typeof tag === 'string').slice(0, 8) : [],
    }))
    .sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')))
    .slice(0, limit)
}

export async function readInspirations(env = process.env) {
  try {
    const text = await readFile(inspirationFile(env), 'utf8')
    return mapInspirations(JSON.parse(text))
  } catch (error) {
    if (error.code === 'ENOENT') return []
    // 对方文件坏了不该让导入功能报错，当作没有
    return []
  }
}
