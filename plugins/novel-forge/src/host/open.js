// 在系统文件管理器里打开一个目录。
// 只接受宿主自己算出的目录（书稿目录），不接受客户端传路径：
// 这个能力等于一次本地 shell 调用，不能变成「打开任意路径」的接口。

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const exec = promisify(execFile)

const OPENERS = {
  darwin: ['open', []],
  // explorer.exe 成功时也常返回 1，下面单独放过。
  win32: ['explorer.exe', []],
  linux: ['xdg-open', []],
}

/**
 * @param {string} directory 绝对路径，调用方已确认存在且是目录
 * @param {{platform?: string, run?: Function}} options 测试可注入平台与执行器
 */
export async function openDirectory(directory, { platform = process.platform, run } = {}) {
  const opener = OPENERS[platform]
  if (!opener) {
    const error = new Error(`当前系统不支持自动打开目录：${platform}`)
    error.code = 'UNSUPPORTED_PLATFORM'
    throw error
  }
  const [command, args] = opener
  const execute = run ?? ((cmd, argv) => exec(cmd, argv, { timeout: 5000, windowsHide: true }))
  try {
    await execute(command, [...args, directory])
  } catch (error) {
    // Windows 资源管理器打开目录后返回 1 是常态，只有「找不到命令」才算失败。
    if (platform === 'win32' && error?.code !== 'ENOENT') return { command, directory }
    if (error?.code === 'ENOENT') {
      const missing = new Error(`找不到系统打开命令：${command}`)
      missing.code = 'OPEN_UNAVAILABLE'
      throw missing
    }
    const failed = new Error(`打开目录失败：${error?.message ?? error}`)
    failed.code = 'OPEN_FAILED'
    throw failed
  }
  return { command, directory }
}

export const OPEN_PLATFORMS = Object.keys(OPENERS)
