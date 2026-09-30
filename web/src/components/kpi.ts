import type { PlatformSummary } from '../lib/metrics'
import type { Platform, Report } from '../types'

export type TabKey = Platform | 'combined'

export const PLATFORM_COLOR: Record<Platform, string> = {
  instagram: '#C13584',
  facebook: '#1877F2',
  tiktok: '#00A3A3',
  youtube: '#E62117',
}

export interface KpiSpec {
  label: string
  get: (s: PlatformSummary, r: Report) => number | undefined
  unit?: string
  digits?: number
  /** 変化量をポイント差で出す（率の指標） */
  points?: boolean
  /** 集計の仕方。先月と違えば先月比を出さない */
  basis?: (s: PlatformSummary) => string
}

const views: KpiSpec = { label: '総ビュー', get: (s) => s.views, basis: (s) => s.viewsBasis }
const net: KpiSpec = { label: '新規フォロワー（純増）', get: (s) => s.netFollowers }
const followers: KpiSpec = { label: 'フォロワー数', get: (s) => s.followers, basis: (s) => s.followersBasis ?? '' }
const posts: KpiSpec = { label: '投稿数', get: (s) => s.postCount }
const likes: KpiSpec = { label: 'いいね', get: (s) => s.likes }
const comments: KpiSpec = { label: 'コメント', get: (s) => s.comments }
const shares: KpiSpec = { label: 'シェア', get: (s) => s.shares }
const saves: KpiSpec = { label: '保存', get: (s) => s.saves }
const er: KpiSpec = { label: 'エンゲージメント率', get: (s) => s.engagementRate, unit: '%', digits: 2, points: true }

export const KPI_SPECS: Record<TabKey, KpiSpec[]> = {
  combined: [views, net, followers, posts, likes, comments, shares, saves, er],
  instagram: [
    { ...views, label: '閲覧数' },
    { label: 'リーチ', get: (s) => s.reach },
    net,
    followers,
    posts,
    likes,
    saves,
    { label: 'プロフィールアクセス', get: (s) => s.profileViews },
    er,
  ],
  facebook: [{ ...views, label: '閲覧数' }, { label: 'リーチ', get: (s) => s.reach }, net, followers, posts, likes, comments, shares, er],
  tiktok: [
    { ...views, label: '動画視聴数' },
    { label: 'プロフィール表示', get: (s) => s.profileViews },
    net,
    followers,
    posts,
    likes,
    comments,
    shares,
    er,
  ],
  youtube: [
    { ...views, label: '視聴回数' },
    { label: '総再生時間', get: (s) => s.watchHours, unit: '時間', digits: 1 },
    { ...net, label: '登録者（純増）' },
    { ...followers, label: '登録者数' },
    posts,
    { ...likes, label: '高評価' },
    comments,
    shares,
    er,
  ],
}
