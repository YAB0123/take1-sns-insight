/*
 * 各SNS管理画面から数値を読み取る関数群。
 * background.js が対象タブに注入し、globalThis.__snsScrape[name](...args) で呼び出す。
 * 画面の構成が変わったときに直すのは基本的にこのファイルだけ。
 *
 * 一覧のスクロールはページ内から scrollTop を動かしても続きを読み込まない画面があるため、
 * 「〜Step」関数は今見えている行だけを読んで返し、スクロールは background.js が
 * デバッガー経由の本物のホイール操作で行う。
 */
;(() => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

  async function waitFor(fn, timeout = 25000, interval = 400) {
    const t0 = Date.now()
    while (Date.now() - t0 < timeout) {
      try {
        const v = fn()
        if (v) return v
      } catch {
        // 描画途中は無視して待つ
      }
      await sleep(interval)
    }
    return undefined
  }

  const clean = (s) => (s ?? '').replace(/[​ ]/g, ' ').replace(/\s+/g, ' ').trim()
  const isDash = (t) => !t || /^[-‑–—]+$/.test(t)

  /** "14,796" "4.5万" "2.2K" "12%" "‑‑" → 数値 or undefined */
  function num(s) {
    const t = clean(s).replace(/,/g, '')
    if (isDash(t)) return undefined
    const m = t.match(/^([+-]?\d+(?:\.\d+)?)\s*(万|億|K|M|%)?/i)
    if (!m) return undefined
    const n = parseFloat(m[1])
    const unit = (m[2] || '').toUpperCase()
    return unit === '万' ? n * 1e4 : unit === '億' ? n * 1e8 : unit === 'K' ? n * 1e3 : unit === 'M' ? n * 1e6 : n
  }

  /** "41秒" "1分5秒" "23.35s" "1:24" "16h:26m:21s" → 秒 */
  function seconds(s) {
    const t = clean(s)
    if (isDash(t)) return undefined
    let m = t.match(/^(?:(\d+)時間)?(?:(\d+)分)?(?:([\d.]+)秒)?$/)
    if (m && (m[1] || m[2] || m[3])) return (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0)
    m = t.match(/^(?:(\d+)h:?)?(?:(\d+)m:?)?(?:([\d.]+)s)?$/)
    if (m && (m[1] || m[2] || m[3])) return (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0)
    m = t.match(/^(?:(\d+):)?(\d+):(\d{2})$/)
    if (m) return (+m[1] || 0) * 3600 + +m[2] * 60 + +m[3]
    return num(t)
  }

  const pad = (n) => String(n).padStart(2, '0')

  /** "2026年9月13日(日) 20:11"（今年の投稿）/ "2025/12/15"（去年以前・時刻なし）→ ISO(JST) */
  function jaDateTime(s) {
    const t = clean(s)
    const m =
      t.match(/(\d{4})年(\d{1,2})月(\d{1,2})日(?:\([^)]*\))?\s*(?:(\d{1,2}):(\d{2}))?/) ??
      t.match(/(\d{4})\/(\d{1,2})\/(\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?/)
    if (!m) return undefined
    return `${m[1]}-${pad(m[2])}-${pad(m[3])}T${pad(m[4] ?? 0)}:${pad(m[5] ?? 0)}:00+09:00`
  }

  /** "9月26日 午後8:15" / "2025年4月19日 午後6:25" → ISO(JST)。年が無ければ今年 */
  function tiktokDate(s) {
    const m = clean(s).match(/(?:(\d{4})年)?(\d{1,2})月(\d{1,2})日\s*(午前|午後)?(\d{1,2}):(\d{2})/)
    if (!m) return undefined
    const year = m[1] ?? new Date(Date.now() + 9 * 3600e3).getUTCFullYear()
    let h = +m[5]
    if (m[4] === '午後' && h < 12) h += 12
    if (m[4] === '午前' && h === 12) h = 0
    return `${year}-${pad(m[2])}-${pad(m[3])}T${pad(h)}:${m[6]}:00+09:00`
  }

  const startTs = (start) => Date.parse(`${start}T00:00:00+09:00`)

  function hash(s) {
    let h = 5381
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
    return (h >>> 0).toString(36)
  }

  const linesOf = (el) =>
    (el?.innerText || '')
      .split('\n')
      .map(clean)
      .filter(Boolean)

  const mainLines = () => linesOf(document.querySelector('[role=main]') || document.querySelector('main') || document.body).filter((l) => !l.includes('\t'))

  /**
   * label の直後 lookahead 行以内で最初に数値になる行。
   * 途中で別の見出し（数値でも「通算」等でもない行）に当たったら、その指標は空とみなす
   * （古い期間でデータが無いとき、次の指標の値を取り違えないように）
   */
  function numAfter(lines, label, lookahead = 4, skip = ['通算', '全期間']) {
    const i = lines.indexOf(label)
    if (i < 0) return undefined
    for (const raw of lines.slice(i + 1, i + 1 + lookahead)) {
      // 目に見えない空白（ゼロ幅スペース）だけの行は見出しではないので読み飛ばす
      const l = clean(raw)
      if (!l || skip.includes(l)) continue
      const v = num(l)
      if (v != null) return v
      if (!isDash(l)) return undefined
    }
    return undefined
  }

  function centerOf(el) {
    const r = el.getBoundingClientRect()
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + Math.min(r.height / 2, 300)) }
  }

  /* ================= Meta Business Suite ================= */

  /** insights/results: 各カードの見出し値・日別合計・SNS別内訳 */
  async function metaResults(platform) {
    const ok = await waitFor(() => document.querySelectorAll('table').length >= 4)
    if (!ok) throw new Error('Meta「結果」画面の読み込みがタイムアウトしました')
    await sleep(1000)
    const cards = {}
    for (const table of document.querySelectorAll('table')) {
      let card = table
      while (card.parentElement && card.parentElement.querySelectorAll('table').length === 1) card = card.parentElement
      const lines = linesOf(card).filter((l) => !l.includes('\t'))
      const title = lines[0]
      const headline = lines.slice(1).map(num).find((v) => v != null)
      const row = [...table.querySelectorAll('tr')].find((r) => clean(r.children[0]?.textContent) === 'Primary')
      const daily = row ? [...row.children].slice(1).reduce((a, c) => a + (num(c.textContent) ?? 0), 0) : undefined
      // 閲覧数カードの「Facebook 閲覧N回 / Instagram 閲覧N回」
      const breakdown = {}
      for (const img of card.querySelectorAll('img[alt]')) {
        const m = clean(img.parentElement?.textContent).match(/閲覧([\d,]+)回/)
        if (m) breakdown[img.alt] = num(m[1])
      }
      cards[title] = { headline, daily, breakdown }
    }
    const label = platform === 'instagram' ? 'Instagram' : 'Facebook'
    const views = cards['閲覧数']
    return {
      views: views?.breakdown[label] ?? views?.daily,
      reach: (cards['リーチ'] ?? cards['閲覧者'])?.headline,
      interactions: cards['コンテンツでのインタラクション']?.daily,
      linkClicks: cards['リンククリック']?.daily,
      profileViews: cards['アクセス']?.daily,
    }
  }

  /** insights/people?audience_tab=trends: フォロー・フォロー解除・フォロワー総数 */
  async function metaTrends() {
    // フォロワーが100人未満のアカウントは「トレンド」が出ず、「Instagramフォロワー N」だけが表示される
    const total = (lines) => lines.findIndex((l) => /^(Instagram|Facebook)フォロワー$/.test(l))
    // この画面はグラフが多く、innerText を何度も読むと描画の再計算で固まることがある。待つ間は textContent（再計算なし）で見る
    const ok = await waitFor(
      () => {
        const tc = (document.querySelector('[role=main]') || document.body).textContent
        return tc.includes('フォローをやめた数') || /(Instagram|Facebook)フォロワー/.test(tc)
      },
      25000,
      1000,
    )
    if (!ok) throw new Error('Meta「オーディエンス > トレンド」の読み込みがタイムアウトしました')
    await sleep(1500)
    const lines = mainLines()
    const ti = total(lines)
    // 表示されているSNS（Facebook を指定しても、Facebookページが無いと Instagram の画面になる）
    const shown = ti >= 0 ? lines[ti].replace('フォロワー', '') : undefined
    if (!lines.includes('フォローをやめた数')) return { shown, followers: ti >= 0 ? numAfter(lines, lines[ti]) : undefined }
    const follows = numAfter(lines, 'フォロー')
    const unfollows = numAfter(lines, 'フォローをやめた数')
    return {
      follows,
      unfollows,
      netFollowers: numAfter(lines, '純フォロー数') ?? (follows != null && unfollows != null ? follows - unfollows : undefined),
      followers: numAfter(lines, 'フォロワー') ?? (ti >= 0 ? numAfter(lines, lines[ti]) : undefined),
      shown,
    }
  }

  const META_COLUMNS = {
    閲覧数: 'views',
    リーチ: 'reach',
    '「いいね！」とリアクション': 'likes',
    シェア数: 'shares',
    コメント数: 'comments',
    保存数: 'saves',
    フォロー: 'follows',
    動画平均再生時間: 'avgWatchSec',
  }

  /**
   * 投稿一覧の「フィルター」操作用に、クリックする場所を返す。
   * target: 'combobox'（フィルターの入れ物）か、選択肢の文言（例: 'Instagramフィード'）
   */
  async function metaFilterPoint(target) {
    const el = await waitFor(() => {
      if (target === 'combobox') return [...document.querySelectorAll('[role=combobox]')].find((e) => clean(e.textContent).startsWith('フィルター'))
      return [...document.querySelectorAll('[role=option]')].find((e) => clean(e.textContent) === target)
    }, 8000)
    if (!el) return null
    el.scrollIntoView({ block: 'center' })
    await sleep(200)
    const r = el.getBoundingClientRect()
    return { x: Math.round(r.left + Math.min(r.width / 2, 60)), y: Math.round(r.top + r.height / 2) }
  }

  /**
   * insights/content: 表示中の行を読む。
   * mode 'all'  : 1つのSNSにだけ投稿した行（ストーリーズ除く）
   * mode 'igPlacement': 「Instagramフィード」で絞り込んだ一覧から、Instagramを含む行（クロス投稿もInstagramとして）
   * クロス投稿の行は閲覧数・いいねが IG+FB の合計で分けられないため、Instagram 側に1回だけ数える
   */
  async function metaContentStep(mode = 'all') {
    const EMPTY = 'この期間のアクティビティはありません'
    const grid = await waitFor(() => {
      const g = document.querySelector('[role=grid]')
      return g && (g.querySelectorAll('[role=row]').length > 1 || g.textContent.includes(EMPTY)) ? g : undefined
    })
    if (!grid) throw new Error('Meta「コンテンツ」画面の投稿一覧が見つかりません')
    // 投稿の無い区間（7日ずつ読むので起こりうる）
    if (grid.querySelectorAll('[role=row]').length <= 1) return { posts: [], oldest: -Infinity, crossPosted: 0, point: centerOf(grid) }
    const headers = [...grid.querySelectorAll('[role=columnheader]')].map((h) => clean(h.textContent))
    const col = {}
    headers.forEach((h, i) => {
      if (h === '公開日') col.date = i
      if (META_COLUMNS[h]) col[META_COLUMNS[h]] = i
    })
    if (col.date == null) throw new Error('Meta「コンテンツ」の列（公開日）が見つかりません')

    const posts = []
    let oldest = Infinity
    let crossPosted = 0
    for (const row of grid.querySelectorAll('[role=row]')) {
      const cells = [...row.querySelectorAll('[role=gridcell]')]
      if (cells.length < headers.length - 1) continue
      const first = cells[0]
      const alts = [...first.querySelectorAll('img[alt]')].map((i) => i.alt).filter((a) => a === 'Instagram' || a === 'Facebook')
      const lines = linesOf(first)
      const type = lines[1]
      const publishedAt = jaDateTime(cells[col.date]?.textContent)
      if (!publishedAt) continue
      oldest = Math.min(oldest, Date.parse(publishedAt))
      if (type === 'ストーリーズ') continue
      const cross = alts.length > 1
      if (cross) crossPosted++
      let platformAlt
      if (mode === 'igPlacement') {
        if (!alts.includes('Instagram')) continue
        platformAlt = 'Instagram'
      } else {
        if (alts.length !== 1) continue
        platformAlt = alts[0]
      }
      const title = lines[0] === 'この投稿にはテキストがありません' ? `（テキストなし・${type}）` : lines[0]
      const key = `${platformAlt}|${publishedAt}|${title.slice(0, 40)}`
      const metrics = {}
      for (const [k, i] of Object.entries(col)) {
        if (k === 'date') continue
        metrics[k] = k === 'avgWatchSec' ? seconds(cells[i]?.textContent) : num(cells[i]?.textContent)
      }
      posts.push({
        id: `meta-${hash(key)}`,
        platform: platformAlt === 'Instagram' ? 'instagram' : 'facebook',
        title,
        publishedAt,
        type: cross ? `${type}（FB同時投稿）` : type,
        metrics,
      })
    }
    return { posts, oldest, crossPosted, point: centerOf(grid) }
  }

  /* ================= TikTok Studio ================= */

  const TT_DATE_RE = /^(?:\d{4}年)?\d{1,2}月\d{1,2}日\s*午[前後]\d{1,2}:\d{2}$/

  /** 投稿一覧（/tiktokstudio/content）の表示中の行から動画IDと公開日時を読む */
  async function tiktokListStep() {
    const first = await waitFor(() => document.querySelector('a[href*="/video/"]'))
    if (!first) throw new Error('TikTok「投稿」一覧が見つかりません')
    await sleep(300)
    const items = []
    // ピン留めは古い投稿が先頭に来るので「どこまで読んだか」の判定から外す
    let newest = -Infinity
    for (const leaf of document.querySelectorAll('span,div,p')) {
      if (leaf.children.length || !TT_DATE_RE.test(clean(leaf.textContent))) continue
      let row = leaf
      for (let k = 0; k < 10 && row && !row.querySelector('a[href*="/video/"]'); k++) row = row.parentElement
      const id = row?.querySelector('a[href*="/video/"]')?.getAttribute('href')?.match(/video\/(\d+)/)?.[1]
      if (!id) continue
      const publishedAt = tiktokDate(leaf.textContent)
      if (!(row.innerText || '').includes('ピン留め')) newest = Math.max(newest, Date.parse(publishedAt))
      items.push({ id, publishedAt })
    }
    let scroller = first
    while (scroller && !(scroller.scrollHeight > scroller.clientHeight + 5 && /(auto|scroll)/.test(getComputedStyle(scroller).overflowY)))
      scroller = scroller.parentElement
    return { items, newest, point: centerOf(scroller || document.body) }
  }

  /** 動画の詳細（/tiktokstudio/analytics/{id}/overview） */
  async function tiktokVideo() {
    const ok = await waitFor(() => mainLines().includes('平均視聴時間') && mainLines().some((l) => /に投稿$/.test(l)))
    if (!ok) throw new Error('TikTok 動画詳細の読み込みがタイムアウトしました')
    await sleep(800)
    const lines = mainLines()
    const postedIdx = lines.findIndex((l) => /^\d{4}\/\d{1,2}\/\d{1,2}に投稿$/.test(l))
    // 投稿日の直後に 視聴数・いいね・コメント・シェア・保存 の正確な値が並ぶ
    const [views, likes, comments, shares, saves] = lines.slice(postedIdx + 1, postedIdx + 6).map(num)
    const after = (label) => {
      const i = lines.indexOf(label)
      return i < 0 ? undefined : lines[i + 1]
    }
    const watch = seconds(after('総再生時間'))
    return {
      title: postedIdx > 0 ? lines[postedIdx - 1] : '',
      metrics: {
        views,
        likes,
        comments,
        shares,
        saves,
        watchHours: watch != null ? Math.round((watch / 3600) * 10) / 10 : undefined,
        avgWatchSec: seconds(after('平均視聴時間')),
        completionRate: num(after('動画をフル視聴')),
        follows: num(after('新規フォロワー数')),
      },
    }
  }

  /** アナリティクス概要（期間合計。視聴数は画面上「4.6万」のように丸められている） */
  async function tiktokOverview() {
    const ok = await waitFor(() => mainLines().includes('プロフィールの表示回数'))
    if (!ok) throw new Error('TikTok アナリティクス概要の読み込みがタイムアウトしました')
    await sleep(1500)
    const all = mainLines()
    // 左メニューにも「コメント」があるので、指標の並びの先頭から後ろだけを見る
    const lines = all.slice(Math.max(0, all.findIndex((l) => l === '動画の視聴' || l === '動画の視聴数')))
    return {
      views: numAfter(lines, '動画の視聴', 1) ?? numAfter(lines, '動画の視聴数', 1),
      profileViews: numAfter(lines, 'プロフィールの表示回数', 1),
      likes: numAfter(lines, 'いいね', 1),
      comments: numAfter(lines, 'コメント', 1),
      shares: numAfter(lines, 'シェア', 1),
    }
  }

  /** フォロワー（/tiktokstudio/analytics/followers?dateRange=...） */
  async function tiktokFollowers() {
    const ok = await waitFor(() => mainLines().includes('純フォロワー数'))
    if (!ok) throw new Error('TikTok フォロワーの読み込みがタイムアウトしました')
    await sleep(1500)
    const lines = mainLines()
    return {
      followers: numAfter(lines, 'トータルフォロワー数'),
      netFollowers: numAfter(lines, '純フォロワー数', 1),
    }
  }

  /* ================= YouTube Studio ================= */

  /** チャンネル アナリティクス概要：期間の視聴回数・総再生時間・登録者増減・現在の登録者数 */
  async function ytOverview() {
    const ok = await waitFor(() => mainLines().includes('総再生時間（単位: 時間）'))
    if (!ok) throw new Error('YouTube アナリティクス概要の読み込みがタイムアウトしました')
    await sleep(1500)
    const lines = mainLines()
    const m = lines.join('\n').match(/チャンネル視聴回数は\s*([\d,]+)\s*回/)
    // リアルタイム欄：「6,384」「チャンネル登録者」
    const subIdx = lines.findIndex((l, i) => l === 'チャンネル登録者' && num(lines[i - 1]) != null && lines.slice(Math.max(0, i - 4), i).includes('リアルタイム更新'))
    return {
      views: m ? num(m[1]) : numAfter(lines, '視聴回数', 3),
      watchHours: numAfter(lines, '総再生時間（単位: 時間）', 2),
      netFollowers: numAfter(lines, 'チャンネル登録者', 2),
      followers: subIdx > 0 ? num(lines[subIdx - 1]) : undefined,
    }
  }

  const YT_COLUMNS = {
    視聴回数: 'views',
    サムネイルのインプレッション数: 'impressions',
    サムネイルのクリック率: 'ctr',
    平均視聴時間: 'avgWatchSec',
    '総再生時間（単位: 時間）': 'watchHours',
    高評価数: 'likes',
    コメントの追加回数: 'comments',
    共有数: 'shares',
    チャンネル登録者: 'follows',
  }

  /** 詳細モードの表：合計行と動画ごとの行 */
  async function ytExplore() {
    const ok = await waitFor(() => document.querySelectorAll('yta-explore-table-row .debug-metric-value').length > 0)
    if (!ok) throw new Error('YouTube 詳細モードの表の読み込みがタイムアウトしました')
    await sleep(1000)
    const headers = [...document.querySelectorAll('yta-explore-table-header-cell #header-title')]
      .map((e) => clean(e.textContent))
      .filter((h) => YT_COLUMNS[h])
    const parse = (row) => {
      const vals = [...row.querySelectorAll('.debug-metric-value')].map((e) => clean(e.textContent))
      const metrics = {}
      headers.forEach((h, i) => {
        const k = YT_COLUMNS[h]
        metrics[k] = k === 'avgWatchSec' ? seconds(vals[i]) : num(vals[i])
      })
      return metrics
    }
    const rows = [...document.querySelectorAll('yta-explore-table-row')]
    const totalRow = rows.find((r) => r.classList.contains('total-row'))
    return {
      total: totalRow ? parse(totalRow) : undefined,
      rows: rows
        .filter((r) => r.classList.contains('breakdown-row'))
        .map((r) => ({ title: clean(r.querySelector('#entity-title-value')?.textContent), metrics: parse(r) })),
    }
  }

  /** コンテンツ > ショート 一覧の1ページ分 */
  async function ytShortsPage() {
    const ok = await waitFor(() => document.querySelectorAll('ytcp-video-row').length > 0)
    if (!ok) throw new Error('YouTube ショート一覧の読み込みがタイムアウトしました')
    await sleep(800)
    const items = []
    for (const r of document.querySelectorAll('ytcp-video-row')) {
      const l = linesOf(r)
      const id = (r.querySelector('a[href*="/video/"]')?.getAttribute('href') || '').split('/')[2]
      const di = l.findIndex((x) => /^\d{4}\/\d{2}\/\d{2}$/.test(x))
      if (!id || di < 0) continue
      const status = l[di - 1]
      // 行は「長さ / タイトル / 説明文 / — / 公開状態 / 日付…」。説明文は Instagram・TikTok のキャプションと同じことが多く、紐付けに使う
      const description = di >= 4 && l[2] && !isDash(l[2]) ? l[2] : undefined
      items.push({ id, title: l[1], description, date: l[di].replaceAll('/', '-'), published: status === '公開' || l[di + 1] === '公開日' })
    }
    const next = document.querySelector('#navigate-after')
    return { items, hasNext: !!next && next.getAttribute('aria-disabled') !== 'true' }
  }

  async function ytNextPage() {
    const before = document.querySelector('ytcp-video-row')?.innerText
    document.querySelector('#navigate-after')?.click()
    await waitFor(() => document.querySelector('ytcp-video-row')?.innerText !== before, 15000)
    return true
  }

  globalThis.__snsScrape = {
    metaResults,
    metaTrends,
    metaContentStep,
    metaFilterPoint,
    tiktokListStep,
    tiktokVideo,
    tiktokOverview,
    tiktokFollowers,
    ytOverview,
    ytExplore,
    ytShortsPage,
    ytNextPage,
    _util: { num, seconds, jaDateTime, tiktokDate, startTs, clean, linesOf },
  }
})()
