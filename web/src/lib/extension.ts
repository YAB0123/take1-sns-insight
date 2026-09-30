import type { Platform, PlatformData, ReportUrls } from '../types'

/*
 * 管理ページ ⇔ Chrome拡張 の橋渡し。
 * 拡張のコンテンツスクリプトが window.postMessage を中継する（extension/src/bridge.js）。
 */

const WEB = 'sns-insight-web'
const EXT = 'sns-insight-ext'

export interface CollectRequest {
  urls: ReportUrls
  periodStart: string
  periodEnd: string
  targets: Platform[]
}

export interface CollectResult {
  data: Partial<Record<Platform, PlatformData>>
  errors: string[]
}

type ExtMessage =
  | { source: typeof EXT; type: 'pong'; version: string }
  | { source: typeof EXT; type: 'progress'; requestId: string; message: string }
  | { source: typeof EXT; type: 'result'; requestId: string; result: CollectResult }

function listen(handler: (m: ExtMessage) => void) {
  const fn = (e: MessageEvent) => {
    if (e.source !== window || e.data?.source !== EXT) return
    handler(e.data as ExtMessage)
  }
  window.addEventListener('message', fn)
  return () => window.removeEventListener('message', fn)
}

/** 拡張が入っていればバージョンを返す */
export function pingExtension(timeoutMs = 800): Promise<string | undefined> {
  return new Promise((resolve) => {
    const stop = listen((m) => {
      if (m.type === 'pong') {
        stop()
        resolve(m.version)
      }
    })
    window.postMessage({ source: WEB, type: 'ping' }, '*')
    setTimeout(() => {
      stop()
      resolve(undefined)
    }, timeoutMs)
  })
}

export function collect(req: CollectRequest, onProgress: (msg: string) => void): Promise<CollectResult> {
  const requestId = crypto.randomUUID()
  return new Promise((resolve) => {
    const stop = listen((m) => {
      if (m.type === 'progress' && m.requestId === requestId) onProgress(m.message)
      if (m.type === 'result' && m.requestId === requestId) {
        stop()
        resolve(m.result)
      }
    })
    window.postMessage({ source: WEB, type: 'collect', requestId, ...req }, '*')
  })
}
