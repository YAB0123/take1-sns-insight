/*
 * 取込の手順を動かす service worker。
 * 管理ページから Port 経由で { urls, periodStart, periodEnd, targets } を受け取り、
 * 専用タブで各管理画面を順に開いて scrape-lib.js の関数を実行し、結果を返す。
 */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const DAY = 86400000
const jstStart = (d) => Date.parse(`${d}T00:00:00+09:00`)
const inPeriod = (iso, start, end) => {
  const t = Date.parse(iso)
  return t >= jstStart(start) && t < jstStart(end) + DAY
}

/* ---------- タブ操作 ---------- */

function waitComplete(tabId, timeout = 45000) {
  return new Promise((resolve) => {
    const timer = setTimeout(done, timeout)
    function done() {
      clearTimeout(timer)
      chrome.tabs.onUpdated.removeListener(listener)
      resolve()
    }
    function listener(id, info) {
      if (id === tabId && info.status === 'complete') done()
    }
    chrome.tabs.onUpdated.addListener(listener)
  })
}

async function open(tabId, url) {
  const loaded = waitComplete(tabId)
  await chrome.tabs.update(tabId, { url })
  await loaded
  await sleep(1500)
}

async function run(tabId, name, ...args) {
  await chrome.scripting.executeScript({ target: { tabId }, files: ['src/scrape-lib.js'] })
  const [res] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (n, a) => globalThis.__snsScrape[n](...a),
    args: [name, args],
  })
  if (res?.error) throw new Error(res.error.message ?? String(res.error))
  return res?.result
}

/* ---------- 本物のホイール操作（仮想スクロールの一覧で続きを読み込ませる） ---------- */

const attached = new Set()

async function wheel(tabId, point, deltaY = 500) {
  if (!attached.has(tabId)) {
    await chrome.debugger.attach({ tabId }, '1.3')
    attached.add(tabId)
  }
  await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: point.x,
    y: point.y,
  })
  await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', {
    type: 'mouseWheel',
    x: point.x,
    y: point.y,
    deltaX: 0,
    deltaY,
  })
}

async function click(tabId, point) {
  await ensureAttached(tabId)
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
    await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', { type, x: point.x, y: point.y, button: 'left', clickCount: 1 })
  }
}

async function key(tabId, name, code) {
  await ensureAttached(tabId)
  for (const type of ['keyDown', 'keyUp']) {
    await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', { type, key: name, code: name, windowsVirtualKeyCode: code })
  }
}

async function ensureAttached(tabId) {
  if (!attached.has(tabId)) {
    await chrome.debugger.attach({ tabId }, '1.3')
    attached.add(tabId)
  }
}

async function detach(tabId) {
  if (!attached.has(tabId)) return
  attached.delete(tabId)
  try {
    await chrome.debugger.detach({ tabId })
  } catch {
    // タブが閉じられていれば何もしない
  }
}

/** 投稿一覧をスクロールしながら最後（期間の開始より前）まで読む */
async function scrollMetaContent(tabId, req, mode, log) {
  const found = new Map()
  let crossPosted = 0
  let stale = 0
  for (let i = 0; i < 150 && stale < 3; i++) {
    const step = await run(tabId, 'metaContentStep', mode)
    crossPosted = Math.max(crossPosted, step.crossPosted)
    let added = 0
    for (const p of step.posts) {
      if (!found.has(p.id)) added++
      found.set(p.id, p)
    }
    log(`Meta: 投稿一覧を読み取り中…（${found.size}件）`)
    if (step.oldest < jstStart(req.periodStart)) break
    await wheel(tabId, step.point, 600)
    await sleep(1500)
    stale = added ? 0 : stale + 1
  }
  return { found, crossPosted }
}

/** 本物のクリックで投稿一覧の「フィルター > 配置」を選ぶ */
async function applyMetaPlacement(tabId, label) {
  const box = await run(tabId, 'metaFilterPoint', 'combobox')
  if (!box) return false
  await click(tabId, box)
  await sleep(800)
  const opt = await run(tabId, 'metaFilterPoint', label)
  if (!opt) return false
  await click(tabId, opt)
  await sleep(500)
  await key(tabId, 'Escape', 27)
  await sleep(4000)
  return true
}

/* ---------- Meta（Instagram / Facebook） ---------- */

/*
 * 貼られたURLの期間は使わない（既定の「過去28日間」などのまま貼られることがある）。
 * どのSNSも、レポートの集計期間から開くURLを組み立て直す。
 */

/** 日本時間の日付 YYYY-MM-DD */
const jstYmd = (ms) => new Date(ms + 9 * 3600000).toISOString().slice(0, 10)

/*
 * 投稿一覧は1か月分を開くと最も古い行が出てこない（件数が多いと末尾が切れる）ため、7日ずつに分けて読む。
 * また一覧の期間は日本時間ではなく米国太平洋時間で絞り込まれ、初日の朝（JST 0〜16/17時）の投稿が漏れるので、
 * 各区間とも1日前から開き、期間内かどうかは inPeriod（日本時間）で判定する。
 */
function metaContentWindows(req) {
  const out = []
  const end = jstStart(req.periodEnd)
  for (let s = jstStart(req.periodStart); s <= end; s += 7 * DAY) {
    out.push({ periodStart: jstYmd(s), periodEnd: jstYmd(Math.min(s + 6 * DAY, end)) })
  }
  return out
}

function metaUrl(base, page, platform, req) {
  const u = new URL(base)
  u.pathname = `/latest/insights/${page}`
  u.searchParams.set('platform', platform === 'instagram' ? 'Instagram' : 'Facebook')
  const start = page === 'content' ? jstYmd(jstStart(req.periodStart) - DAY) : req.periodStart
  // Meta は time_range を二重にエンコードする（searchParams.set がもう一段エンコードする）
  u.searchParams.set('time_range', encodeURIComponent(JSON.stringify({ end: req.periodEnd, start })))
  if (page === 'people') u.searchParams.set('audience_tab', 'trends')
  else u.searchParams.delete('audience_tab')
  return u.toString()
}

async function collectMeta(tabId, req, platforms, log) {
  const out = {}
  for (const pl of platforms) {
    const name = pl === 'instagram' ? 'Instagram' : 'Facebook'
    log(`${name}: 期間の数値（結果）を読み取り中…`)
    await open(tabId, metaUrl(req.urls.meta, 'results', pl, req))
    const results = await run(tabId, 'metaResults', pl)
    log(`${name}: フォロワー（オーディエンス > トレンド）を読み取り中…`)
    await open(tabId, metaUrl(req.urls.meta, 'people', pl, req))
    const trends = await run(tabId, 'metaTrends')
    out[pl] = {
      account: {
        followers: trends.followers,
        netFollowers: trends.netFollowers,
        views: results.views,
        reach: results.reach,
        interactions: results.interactions,
        profileViews: results.profileViews,
        linkClicks: results.linkClicks,
      },
      posts: [],
    }
  }

  const byId = new Map()
  for (const w of metaContentWindows(req)) {
    const wreq = { ...req, ...w }
    log(`Meta: 投稿一覧を読み取り中…（${w.periodStart}〜${w.periodEnd}）`)
    await open(tabId, metaUrl(req.urls.meta, 'content', platforms[0], wreq))
    const all = await scrollMetaContent(tabId, wreq, 'all', log)
    let posts = [...all.found.values()]

    // クロス投稿（IG+FB を1行で表示）があれば、「Instagramフィード」に絞り込んで Instagram 側の数値で読み直す
    if (all.crossPosted > 0 && platforms.includes('instagram')) {
      log(`Meta: クロス投稿 ${all.crossPosted}件を「Instagramフィード」で読み直し中…`)
      await open(tabId, metaUrl(req.urls.meta, 'content', platforms[0], wreq))
      if (await applyMetaPlacement(tabId, 'Instagramフィード')) {
        const ig = await scrollMetaContent(tabId, wreq, 'igPlacement', log)
        posts = [...posts.filter((p) => p.platform !== 'instagram'), ...ig.found.values()]
      } else {
        log('⚠ Meta: 「Instagramフィード」の絞り込みができず、クロス投稿の動画は取り込めませんでした')
      }
    }
    for (const p of posts) if (inPeriod(p.publishedAt, w.periodStart, w.periodEnd)) byId.set(p.id, p)
  }
  for (const p of byId.values()) {
    if (out[p.platform] && inPeriod(p.publishedAt, req.periodStart, req.periodEnd)) out[p.platform].posts.push(p)
  }
  for (const pl of platforms) log(`${pl === 'instagram' ? 'Instagram' : 'Facebook'}: 期間内の投稿 ${out[pl].posts.length}件`)
  return out
}

/* ---------- TikTok ---------- */

/** TikTok Studio の期間指定（開始日・最終日の日本時間0時） */
function tiktokUrl(path, req) {
  const slash = (d) => d.replaceAll('-', '/')
  const dateRange = {
    type: 'custom',
    dateRange: { start: jstStart(req.periodStart), end: jstStart(req.periodEnd) },
    UTCDateRange: { from: `${slash(req.periodStart)} 00:00:00`, to: `${slash(req.periodEnd)} 00:00:00` },
  }
  return `https://www.tiktok.com/tiktokstudio/${path}?dateRange=${encodeURIComponent(JSON.stringify(dateRange))}`
}

async function collectTikTok(tabId, req, log) {
  log('TikTok: 期間の数値を読み取り中…')
  await open(tabId, tiktokUrl('analytics', req))
  const overview = await run(tabId, 'tiktokOverview')

  await open(tabId, tiktokUrl('analytics/followers', req))
  const followers = await run(tabId, 'tiktokFollowers')

  log('TikTok: 投稿一覧を確認中…')
  await open(tabId, 'https://www.tiktok.com/tiktokstudio/content')
  const found = new Map()
  let stale = 0
  for (let i = 0; i < 120 && stale < 5; i++) {
    const step = await run(tabId, 'tiktokListStep')
    let added = 0
    for (const it of step.items) {
      if (!found.has(it.id)) added++
      found.set(it.id, it)
    }
    if (step.newest > -Infinity && step.newest < jstStart(req.periodStart)) break
    await wheel(tabId, step.point, 500)
    await sleep(1200)
    stale = added ? 0 : stale + 1
  }
  const targets = [...found.values()].filter((v) => inPeriod(v.publishedAt, req.periodStart, req.periodEnd))

  const posts = []
  for (const [i, v] of targets.entries()) {
    log(`TikTok: 動画の詳細を読み取り中…（${i + 1}/${targets.length}）`)
    await open(tabId, `https://www.tiktok.com/tiktokstudio/analytics/${v.id}/overview`)
    const d = await run(tabId, 'tiktokVideo')
    posts.push({
      id: `tt-${v.id}`,
      platform: 'tiktok',
      title: d.title,
      publishedAt: v.publishedAt,
      type: '動画',
      url: `https://www.tiktok.com/video/${v.id}`,
      metrics: d.metrics,
    })
  }
  // TikTok Studio は約1年より前の期間を出さず、そのとき純フォロワー数は 0 と表示される
  const noPeriodData = overview.views == null
  if (noPeriodData) log('⚠ TikTok: この期間の数値（視聴数・フォロワー純増など）はTikTok Studioに残っていません。投稿ごとの数値だけ取り込みました')
  return {
    account: {
      followers: followers.followers,
      netFollowers: noPeriodData ? undefined : followers.netFollowers,
      views: overview.views,
      profileViews: overview.profileViews,
      likes: overview.likes,
      comments: overview.comments,
      shares: overview.shares,
    },
    posts,
  }
}

/* ---------- YouTube（ショート） ---------- */

const YT_METRICS = [
  'EXTERNAL_VIEWS',
  'VIDEO_THUMBNAIL_IMPRESSIONS',
  'VIDEO_THUMBNAIL_IMPRESSIONS_VTR',
  'AVERAGE_WATCH_TIME',
  'EXTERNAL_WATCH_TIME',
  'RATINGS_LIKES',
  'COMMENTS',
  'SHARINGS',
  'SUBSCRIBERS_NET_CHANGE',
]

/** shortsOnly: 「コンテンツ > YouTube ショート」と同じ絞り込み（CM・通常の動画を除く） */
function ytExploreUrl(channel, from, to, videoId, shortsOnly = false) {
  const q = new URLSearchParams({
    entity_type: videoId ? 'VIDEO' : 'CHANNEL',
    entity_id: videoId ?? channel,
    ...(shortsOnly ? { ur_dimensions: 'CREATOR_CONTENT_TYPE', ur_values: "'SHORTS'", ur_inclusive_starts: '', ur_exclusive_ends: '' } : {}),
    time_period: `${from},${to}`,
    explore_type: 'TABLE_AND_CHART',
    metric: 'EXTERNAL_VIEWS',
    granularity: 'DAY',
    dimension: videoId ? 'DAY' : 'VIDEO',
    o_column: 'EXTERNAL_VIEWS',
    o_direction: 'ANALYTICS_ORDER_DIRECTION_DESC',
  })
  for (const m of YT_METRICS) q.append('t_metrics', m)
  const base = videoId ? `video/${videoId}` : `channel/${channel}`
  return `https://studio.youtube.com/${base}/analytics/tab-overview/period-${from},${to}/explore?${q}`
}

const normTitle = (s) => (s || '').replace(/\s+/g, '').replace(/#\S+/g, '')

/** YouTube Studio の期間は太平洋時間0時のミリ秒（終了は最終日の翌日0時） */
const laStart = (d) => Date.parse(`${d}T00:00:00-07:00`)

async function youtubeChannel(tabId, url) {
  const fromUrl = url.match(/\/channel\/(UC[\w-]+)/)?.[1]
  if (fromUrl) return fromUrl
  // URL にチャンネルIDが無ければ、YouTube Studio を開いて転送先のURLから読む
  await open(tabId, 'https://studio.youtube.com/')
  const tab = await chrome.tabs.get(tabId)
  const id = tab.url?.match(/\/channel\/(UC[\w-]+)/)?.[1]
  if (!id) throw new Error('YouTube Studio のチャンネルIDを特定できません（このChromeでYouTube Studioにログインしているか確認してください）')
  return id
}

async function collectYouTube(tabId, req, log) {
  const channel = await youtubeChannel(tabId, req.urls.youtube)
  const [from, to] = [laStart(req.periodStart), laStart(req.periodEnd) + DAY]

  log('YouTube: 期間の数値を読み取り中…')
  await open(tabId, `https://studio.youtube.com/channel/${channel}/analytics/tab-overview/period-${from},${to}`)
  const overview = await run(tabId, 'ytOverview')
  await open(tabId, ytExploreUrl(channel, from, to))
  const channelTable = await run(tabId, 'ytExplore')
  // 閲覧数などはショートだけで数える（CMを広告で回すとチャンネル全体の視聴回数が大きく膨らむため）
  await open(tabId, ytExploreUrl(channel, from, to, undefined, true))
  const periodTable = await run(tabId, 'ytExplore')

  log('YouTube: ショート一覧を確認中…')
  await open(tabId, `https://studio.youtube.com/channel/${channel}/videos/short`)
  const shorts = []
  for (let page = 0; page < 10; page++) {
    const res = await run(tabId, 'ytShortsPage')
    shorts.push(...res.items)
    const oldest = res.items.reduce((a, it) => (it.date < a ? it.date : a), '9999-99-99')
    if (oldest < req.periodStart || !res.hasNext) break
    await run(tabId, 'ytNextPage')
    await sleep(1000)
  }
  const targets = shorts.filter((s) => s.published && s.date >= req.periodStart && s.date <= req.periodEnd)

  // 公開日から取込日までの累計を取るため、期間の開始から今日までで表を出す
  log('YouTube: ショートごとの数値を読み取り中…')
  const tomorrow = Math.ceil((Date.now() - from) / DAY) * DAY + from
  await open(tabId, ytExploreUrl(channel, from, tomorrow, undefined, true))
  const lifetime = await run(tabId, 'ytExplore')
  const byTitle = new Map(lifetime.rows.map((r) => [normTitle(r.title), r.metrics]))

  const posts = targets.map((s) => ({
    id: `yt-${s.id}`,
    platform: 'youtube',
    title: s.title,
    description: s.description,
    publishedAt: `${s.date}T00:00:00+09:00`,
    type: 'ショート',
    url: `https://youtube.com/shorts/${s.id}`,
    metrics: byTitle.get(normTitle(s.title)) ?? {},
  }))
  // 詳細モードの表は視聴回数の上位50本までなので、漏れた動画はその動画だけの表で取り直す
  const missing = posts.filter((p) => Object.keys(p.metrics).length === 0)
  for (const [i, p] of missing.entries()) {
    log(`YouTube: 表に無かったショートを個別に読み取り中…（${i + 1}/${missing.length}）`)
    const videoId = p.id.replace(/^yt-/, '')
    await open(tabId, ytExploreUrl(channel, from, tomorrow, videoId))
    p.metrics = (await run(tabId, 'ytExplore')).total ?? {}
  }
  const stillMissing = posts.filter((p) => Object.keys(p.metrics).length === 0).length
  if (stillMissing) log(`⚠ YouTube: ${stillMissing}本のショートの数値を取得できませんでした`)

  const t = periodTable.total ?? {}
  return {
    account: {
      followers: overview.followers,
      // 登録者の純増はチャンネル全体（ショート以外からの登録も含む）
      netFollowers: channelTable.total?.follows ?? overview.netFollowers,
      views: t.views ?? overview.views,
      watchHours: t.watchHours ?? overview.watchHours,
      likes: t.likes,
      comments: t.comments,
      shares: t.shares,
    },
    posts,
  }
}

/* ---------- 全体の流れ ---------- */

async function collect(req, post) {
  const log = (message) => post({ type: 'progress', message })
  const data = {}
  const errors = []
  const tab = await chrome.tabs.create({ url: 'about:blank', active: true })
  const collectedAt = new Date().toISOString()
  try {
    const metaTargets = req.targets.filter((t) => t === 'instagram' || t === 'facebook')
    if (metaTargets.length && req.urls.meta) {
      try {
        Object.assign(data, await collectMeta(tab.id, req, metaTargets, log))
      } catch (e) {
        errors.push(`Instagram/Facebook: ${e.message}`)
      }
    }
    if (req.targets.includes('tiktok') && req.urls.tiktok) {
      try {
        data.tiktok = await collectTikTok(tab.id, req, log)
      } catch (e) {
        errors.push(`TikTok: ${e.message}`)
      }
    }
    if (req.targets.includes('youtube') && req.urls.youtube) {
      try {
        data.youtube = await collectYouTube(tab.id, req, log)
      } catch (e) {
        errors.push(`YouTube: ${e.message}`)
      }
    }
  } finally {
    await detach(tab.id)
    try {
      await chrome.tabs.remove(tab.id)
    } catch {
      // すでに閉じられている
    }
  }
  for (const d of Object.values(data)) d.collectedAt = collectedAt
  return { data, errors }
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'collect') return
  // 管理ページを閉じた・移動した（戻る/進むキャッシュ含む）ときの切断。取込は続け、結果は捨てる
  port.onDisconnect.addListener(() => void chrome.runtime.lastError)
  port.onMessage.addListener(async (req) => {
    // 管理ページ側からの生存確認（service worker が途中で止められないように送ってもらっている）
    if (req?.type === 'keepalive') return
    const post = (m) => {
      try {
        port.postMessage(m)
      } catch {
        // 管理ページが閉じられた
      }
    }
    try {
      const result = await collect(req, post)
      post({ type: 'result', result })
    } catch (e) {
      post({ type: 'result', result: { data: {}, errors: [e.message] } })
    }
  })
})
