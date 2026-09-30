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
    let finished = false
    // service worker は外から何も届かないと30秒ほどで止められることがあるので、取込中は定期的に送る
    const keepalive = setInterval(() => {
      try {
        port.postMessage({ type: 'keepalive' })
      } catch {
        clearInterval(keepalive)
      }
    }, 20000)
    port.onMessage.addListener((m) => {
      if (m.type === 'result') {
        finished = true
        clearInterval(keepalive)
      }
      window.postMessage({ source: EXT, requestId: msg.requestId, ...m }, '*')
    })
    port.onDisconnect.addListener(() => {
      clearInterval(keepalive)
      if (finished) return
      const reason = chrome.runtime.lastError?.message ?? '拡張の処理が途中で止まりました'
      window.postMessage(
        {
          source: EXT,
          type: 'result',
          requestId: msg.requestId,
          result: { data: {}, errors: [`拡張との接続が切れました: ${reason}。もう一度「取込開始」を押してください`] },
        },
        '*',
      )
    })
    port.postMessage({ urls: msg.urls, periodStart: msg.periodStart, periodEnd: msg.periodEnd, targets: msg.targets })
  }
})
