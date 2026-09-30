// 管理ページ（window.postMessage）⇔ 拡張の background（Port）の中継
const WEB = 'sns-insight-web'
const EXT = 'sns-insight-ext'

window.addEventListener('message', (e) => {
  if (e.source !== window || e.data?.source !== WEB) return
  const msg = e.data

  if (msg.type === 'ping') {
    window.postMessage({ source: EXT, type: 'pong', version: chrome.runtime.getManifest().version }, '*')
    return
  }

  if (msg.type === 'collect') {
    const port = chrome.runtime.connect({ name: 'collect' })
    port.onMessage.addListener((m) => window.postMessage({ source: EXT, requestId: msg.requestId, ...m }, '*'))
    port.onDisconnect.addListener(() => {
      if (chrome.runtime.lastError)
        window.postMessage(
          {
            source: EXT,
            type: 'result',
            requestId: msg.requestId,
            result: { data: {}, errors: [`拡張との接続が切れました: ${chrome.runtime.lastError.message}`] },
          },
          '*',
        )
    })
    port.postMessage({ urls: msg.urls, periodStart: msg.periodStart, periodEnd: msg.periodEnd, targets: msg.targets })
  }
})
