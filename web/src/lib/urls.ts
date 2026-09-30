import type { Client, ReportUrls } from '../types'

export interface ParsedPeriod {
  start: string
  end: string
}

const DAY_MS = 86_400_000

function utcDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

/** 何重にエンコードされていても JSON になるまで decode する */
function decodeUntilJson(raw: string): unknown {
  let s = raw
  for (let i = 0; i < 4; i++) {
    try {
      return JSON.parse(s)
    } catch {
      s = decodeURIComponent(s)
    }
  }
  return JSON.parse(s)
}

/** Meta Business Suite: time_range={"end":"2026-09-15","start":"2026-08-16"}（二重エンコード） */
export function parseMetaUrl(url: string) {
  const u = new URL(url)
  const raw = u.searchParams.get('time_range')
  const range = raw ? (decodeUntilJson(raw) as { start: string; end: string }) : undefined
  return {
    period: range ? { start: range.start, end: range.end } : undefined,
    businessId: u.searchParams.get('business_id') ?? undefined,
    assetId: u.searchParams.get('asset_id') ?? undefined,
  }
}

/** TikTok Studio: dateRange.UTCDateRange.from/to = "2026/08/16 00:00:00" */
export function parseTikTokUrl(url: string) {
  const u = new URL(url)
  const raw = u.searchParams.get('dateRange')
  if (!raw) return { period: undefined }
  const dr = decodeUntilJson(raw) as { UTCDateRange?: { from: string; to: string } }
  const toIso = (s: string) => s.slice(0, 10).replaceAll('/', '-')
  return {
    period: dr.UTCDateRange
      ? { start: toIso(dr.UTCDateRange.from), end: toIso(dr.UTCDateRange.to) }
      : undefined,
  }
}

/** YouTube Studio: .../period-<開始ms>,<終了ms>（終了は翌日0時・太平洋時間） */
export function parseYouTubeUrl(url: string) {
  const channel = url.match(/\/channel\/([^/]+)/)?.[1]
  const m = url.match(/period-(\d+),(\d+)/)
  return {
    channelId: channel,
    period: m ? { start: utcDate(Number(m[1])), end: utcDate(Number(m[2]) - DAY_MS) } : undefined,
  }
}

export function detectPeriod(urls: ReportUrls): ParsedPeriod | undefined {
  try {
    if (urls.meta) {
      const p = parseMetaUrl(urls.meta).period
      if (p) return p
    }
    if (urls.tiktok) {
      const p = parseTikTokUrl(urls.tiktok).period
      if (p) return p
    }
    if (urls.youtube) {
      const p = parseYouTubeUrl(urls.youtube).period
      if (p) return p
    }
  } catch {
    // 不正なURLは無視して手入力に任せる
  }
  return undefined
}

export function extractIds(urls: ReportUrls): Client['ids'] {
  const ids: NonNullable<Client['ids']> = {}
  try {
    if (urls.meta) {
      const m = parseMetaUrl(urls.meta)
      ids.metaBusinessId = m.businessId
      ids.metaAssetId = m.assetId
    }
    if (urls.youtube) ids.youtubeChannelId = parseYouTubeUrl(urls.youtube).channelId
  } catch {
    // ignore
  }
  return ids
}

/** YYYY-MM-DD を日本時間0時のミリ秒に */
function jstMidnight(date: string): number {
  return Date.parse(`${date}T00:00:00+09:00`)
}
/** YYYY-MM-DD を太平洋時間0時のミリ秒に（夏時間は YouTube Studio 側が吸収するので PDT 固定で十分） */
function laMidnight(date: string): number {
  return Date.parse(`${date}T00:00:00-07:00`)
}

/** 保存済みIDと期間から3つのURLを組み立てる */
export function buildUrls(ids: Client['ids'], start: string, end: string): ReportUrls {
  const urls: ReportUrls = {}
  if (ids?.metaBusinessId && ids.metaAssetId) {
    const tr = encodeURIComponent(encodeURIComponent(JSON.stringify({ end, start })))
    urls.meta = `https://business.facebook.com/latest/insights/results?business_id=${ids.metaBusinessId}&asset_id=${ids.metaAssetId}&time_range=${tr}&platform=Instagram`
  }
  const slash = (d: string) => d.replaceAll('-', '/')
  const dateRange = {
    type: 'custom',
    dateRange: { start: jstMidnight(start), end: jstMidnight(end) },
    UTCDateRange: { from: `${slash(start)} 00:00:00`, to: `${slash(end)} 00:00:00` },
  }
  urls.tiktok = `https://www.tiktok.com/tiktokstudio/analytics?dateRange=${encodeURIComponent(JSON.stringify(dateRange))}`
  if (ids?.youtubeChannelId) {
    urls.youtube = `https://studio.youtube.com/channel/${ids.youtubeChannelId}/analytics/tab-overview/period-${laMidnight(start)},${laMidnight(end) + DAY_MS}`
  }
  return urls
}

/** 期間から表示名を作る（16日〜翌15日なら開始月の「月度」） */
export function defaultLabel(start: string): string {
  const [y, m] = start.split('-').map(Number)
  return `${y}年${m}月度`
}
