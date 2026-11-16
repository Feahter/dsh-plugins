// 兼容入口：Markdown / OPML / FreeMind / JSON 的唯一实现在 src/export.js。
// 宿主半片（零第三方依赖）与客户端半片（esbuild 打包）共用同一份，
// 避免宿主大纲与界面导出在孤儿/环等边界数据上生成不同结果。
export * from '../src/export.js'
