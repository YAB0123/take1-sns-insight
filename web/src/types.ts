export type Platform = 'instagram' | 'facebook' | 'tiktok' | 'youtube'

export const PLATFORMS: Platform[] = ['instagram', 'facebook', 'tiktok', 'youtube']

export const PLATFORM_LABEL: Record<Platform, string> = {
  instagram: 'Instagram',
  facebook: 'Facebook',
  tiktok: 'TikTok',
  youtube: 'YouTube',
}

/** 投稿ごとの指標。プラットフォームに無い指標は undefined のまま */
export interface PostMetrics {
  views?: number
  reach?: number
  likes?: number
  comments?: number
  shares?: number
  saves?: number
  /** 投稿経由のフォロー（YouTubeは登録者増） */
  follows?: number
  avgWatchSec?: number
  /** フル視聴率 % (TikTok) */
  completionRate?: number
  /** 総再生時間（時間） */
  watchHours?: number
  /** インプレッション (YouTube) */
  impressions?: number
  /** クリック率 % (YouTube) */
  ctr?: number
}

export interface Post {
  id: string
  platform: Platform
  title: string
  /** 説明文（YouTube。タイトルとは別で、Instagram・TikTok のキャプションと同じことが多い） */
  description?: string
  /** ISO 8601 */
  publishedAt: string
  type?: string
  url?: string
  metrics: PostMetrics
  /** 同じ動画を横展開した投稿を束ねるキー */
  groupKey?: string
}

/** 期間全体のアカウント指標 */
export interface AccountMetrics {
  /** 取込時点のフォロワー総数（YouTubeは登録者数） */
  followers?: number
  /** 期間中のフォロワー純増（フォロー − フォロー解除） */
  netFollowers?: number
  views?: number
  reach?: number
  interactions?: number
  profileViews?: number
  linkClicks?: number
  likes?: number
  comments?: number
  shares?: number
  watchHours?: number
}

export interface PlatformData {
  account: AccountMetrics
  posts: Post[]
  collectedAt?: string
}

export interface Insight {
  /** 今月の総評 */
  summary: string
  /** 先月との比較 */
  comparison: string
  /** 良かった点 */
  goodPoints: string
  /** 来月の課題 */
  issues: string
  /** 来月の提案 */
  proposals: string
}

export const EMPTY_INSIGHT: Insight = {
  summary: '',
  comparison: '',
  goodPoints: '',
  issues: '',
  proposals: '',
}

export interface ReportUrls {
  meta?: string
  tiktok?: string
  youtube?: string
}

export interface Report {
  id: string
  clientId: string
  /** YYYY-MM-DD */
  periodStart: string
  /** YYYY-MM-DD */
  periodEnd: string
  /** 表示名（例: 2026年8月度） */
  label: string
  urls: ReportUrls
  platforms: Partial<Record<Platform, PlatformData>>
  insight: Insight
  status: 'draft' | 'published'
  updatedAt: string
  publishedAt?: string
}

export interface Client {
  id: string
  name: string
  shareToken: string
  createdAt: string
  /** URLから読み取ったID。次回のURL自動生成に使う */
  ids?: {
    metaBusinessId?: string
    metaAssetId?: string
    youtubeChannelId?: string
  }
}
