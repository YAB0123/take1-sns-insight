import type { Platform, PlatformData, Post, Report } from '../types'
import { PLATFORMS } from '../types'

const sum = (xs: (number | undefined)[]) => xs.reduce<number>((a, b) => a + (b ?? 0), 0)

export function hasData(d: PlatformData | undefined): d is PlatformData {
  return !!d && (d.posts.length > 0 || Object.values(d.account).some((v) => v != null))
}

/** プラットフォームの期間サマリー。投稿の合計で埋め、アカウント指標があればそちらを優先 */
export interface PlatformSummary {
  followers?: number
  netFollowers?: number
  views: number
  /** ビューの出どころ。account=管理画面の期間合計、posts=期間内投稿の合計（過去シート分など）。違う月同士は比べない */
  viewsBasis: 'account' | 'posts' | 'mixed'
  /** フォロワー総数が入っているSNSの組み合わせ。先月と違えば比べない（過去の月は総数が無いSNSがある） */
  followersBasis?: string
  reach?: number
  likes: number
  comments: number
  shares: number
  saves: number
  postCount: number
  /** (いいね+コメント+シェア+保存) ÷ 視聴数 × 100 */
  engagementRate?: number
  profileViews?: number
  watchHours?: number
}

export function summarize(d: PlatformData | undefined): PlatformSummary | undefined {
  if (!hasData(d)) return undefined
  const p = d.posts
  const a = d.account
  const views = a.views ?? sum(p.map((x) => x.metrics.views))
  const likes = a.likes ?? sum(p.map((x) => x.metrics.likes))
  const comments = a.comments ?? sum(p.map((x) => x.metrics.comments))
  const shares = a.shares ?? sum(p.map((x) => x.metrics.shares))
  const saves = sum(p.map((x) => x.metrics.saves))
  const postViews = sum(p.map((x) => x.metrics.views))
  const postEng = sum(p.map((x) => sum([x.metrics.likes, x.metrics.comments, x.metrics.shares, x.metrics.saves])))
  return {
    followers: a.followers,
    netFollowers: a.netFollowers,
    views,
    viewsBasis: a.views != null ? 'account' : 'posts',
    reach: a.reach,
    likes,
    comments,
    shares,
    saves,
    postCount: p.length,
    engagementRate: postViews > 0 ? (postEng / postViews) * 100 : undefined,
    profileViews: a.profileViews,
    watchHours: a.watchHours ?? (p.some((x) => x.metrics.watchHours != null) ? sum(p.map((x) => x.metrics.watchHours)) : undefined),
  }
}

export function platformsOf(report: Report): Platform[] {
  return PLATFORMS.filter((pl) => hasData(report.platforms[pl]))
}

/** 全プラットフォーム（only を渡せばその中だけ）の合算 */
export function combine(report: Report, only: Platform[] = PLATFORMS): PlatformSummary | undefined {
  const pls = only.filter((pl) => hasData(report.platforms[pl]))
  const parts = pls.map((pl) => summarize(report.platforms[pl])!)
  if (parts.length === 0) return undefined
  const allPosts = pls.flatMap((pl) => report.platforms[pl]?.posts ?? [])
  const bases = new Set(parts.map((x) => x.viewsBasis))
  const postViews = sum(allPosts.map((x) => x.metrics.views))
  const postEng = sum(allPosts.map((x) => sum([x.metrics.likes, x.metrics.comments, x.metrics.shares, x.metrics.saves])))
  const opt = (k: 'followers' | 'netFollowers') =>
    parts.some((x) => x[k] != null) ? sum(parts.map((x) => x[k])) : undefined
  return {
    followers: opt('followers'),
    netFollowers: opt('netFollowers'),
    views: sum(parts.map((x) => x.views)),
    viewsBasis: bases.size === 1 ? [...bases][0] : 'mixed',
    followersBasis: pls.filter((pl) => report.platforms[pl]?.account.followers != null).join(','),
    likes: sum(parts.map((x) => x.likes)),
    comments: sum(parts.map((x) => x.comments)),
    shares: sum(parts.map((x) => x.shares)),
    saves: sum(parts.map((x) => x.saves)),
    postCount: sum(parts.map((x) => x.postCount)),
    engagementRate: postViews > 0 ? (postEng / postViews) * 100 : undefined,
  }
}

export function summaryFor(report: Report, key: Platform | 'combined', only?: Platform[]): PlatformSummary | undefined {
  return key === 'combined' ? combine(report, only) : summarize(report.platforms[key])
}

/** 直前の期間のレポート（periodEnd がこのレポートの開始より前で最も新しいもの） */
export function previousReport(reports: Report[], current: Report): Report | undefined {
  return reports
    .filter((r) => r.periodEnd < current.periodStart)
    .sort((a, b) => b.periodEnd.localeCompare(a.periodEnd))[0]
}

/** 変化率 %（前回が0や未定義なら undefined） */
export function changeRate(cur: number | undefined, prev: number | undefined): number | undefined {
  if (cur == null || prev == null || prev === 0) return undefined
  return ((cur - prev) / Math.abs(prev)) * 100
}

export const fmt = (n: number | undefined, digits = 0) =>
  n == null || Number.isNaN(n) ? '—' : n.toLocaleString('ja-JP', { maximumFractionDigits: digits, minimumFractionDigits: digits })

export const pct = (n: number | undefined, digits = 1) => (n == null ? '—' : `${fmt(n, digits)}%`)

export function engagementOf(p: Post): number | undefined {
  const v = p.metrics.views
  if (!v) return undefined
  return ((p.metrics.likes ?? 0) + (p.metrics.comments ?? 0) + (p.metrics.shares ?? 0) + (p.metrics.saves ?? 0)) / v * 100
}
