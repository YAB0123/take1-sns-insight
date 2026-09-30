import type { Platform, Post, Report } from '../types'
import { PLATFORMS } from '../types'

/** 絵文字・記号・ハッシュタグ・空白を落として比較用の文字列にする */
export function normalizeTitle(s: string): string {
  return s
    .replace(/#\S+/g, '')
    .replace(/[\p{Extended_Pictographic}\p{P}\p{S}\s]/gu, '')
    .slice(0, 60)
}

function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>()
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2)
    m.set(g, (m.get(g) ?? 0) + 1)
  }
  return m
}

/** Dice 係数 0〜1 */
export function similarity(a: string, b: string): number {
  const na = normalizeTitle(a)
  const nb = normalizeTitle(b)
  if (na.length < 2 || nb.length < 2) return 0
  const ba = bigrams(na)
  const bb = bigrams(nb)
  let inter = 0
  for (const [g, c] of ba) inter += Math.min(c, bb.get(g) ?? 0)
  return (2 * inter) / (na.length - 1 + nb.length - 1)
}

// 公開日が近いものは緩く、離れているもの（YouTubeは1〜2週間遅れることがある）は本文がよく似ているときだけ束ねる
const NEAR_DAYS = 3
const MAX_DAYS_APART = 14
const MIN_SIMILARITY_NEAR = 0.25
const MIN_SIMILARITY_FAR = 0.5

/** 比べる文章。YouTubeはタイトルが別物なので、キャプションと同じ説明文を使う */
const textOf = (p: Post) => p.description || p.title

function daysApart(a: string, b: string): number {
  return Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000
}

/**
 * 同じ動画を横展開した投稿に共通の groupKey を振る。
 * 手動で groupKey が付いている投稿はそのまま残す。
 */
export function autoGroup(report: Report): Report {
  const posts = PLATFORMS.flatMap((pl) => report.platforms[pl]?.posts ?? [])
  const candidates = posts.filter((p) => !p.groupKey && p.type !== 'ストーリーズ')

  type Pair = { a: Post; b: Post; score: number }
  const pairs: Pair[] = []
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const a = candidates[i]
      const b = candidates[j]
      if (a.platform === b.platform) continue
      const days = daysApart(a.publishedAt, b.publishedAt)
      if (days > MAX_DAYS_APART) continue
      const sim = similarity(textOf(a), textOf(b))
      if (sim < (days <= NEAR_DAYS ? MIN_SIMILARITY_NEAR : MIN_SIMILARITY_FAR)) continue
      pairs.push({ a, b, score: sim - days * 0.05 })
    }
  }
  pairs.sort((x, y) => y.score - x.score)

  // groupKey -> そのグループに入っているプラットフォーム
  const members = new Map<string, Set<Platform>>()
  const keyOf = new Map<string, string>()
  for (const { a, b } of pairs) {
    const ka = keyOf.get(a.id)
    const kb = keyOf.get(b.id)
    if (ka && kb) continue
    const key = ka ?? kb ?? a.id
    const set = members.get(key) ?? new Set<Platform>()
    const joining = ka ? b : a
    if (!ka && !kb) {
      set.add(a.platform)
      set.add(b.platform)
      keyOf.set(a.id, key)
      keyOf.set(b.id, key)
    } else if (!set.has(joining.platform)) {
      set.add(joining.platform)
      keyOf.set(joining.id, key)
    }
    members.set(key, set)
  }

  const platforms = { ...report.platforms }
  for (const pl of PLATFORMS) {
    const d = platforms[pl]
    if (!d) continue
    platforms[pl] = {
      ...d,
      posts: d.posts.map((p) => (p.groupKey || !keyOf.has(p.id) ? p : { ...p, groupKey: keyOf.get(p.id) })),
    }
  }
  return { ...report, platforms }
}

/** groupKey ごとに投稿を束ねる（2つ以上のSNSにまたがるものだけ） */
export function groups(report: Report): Post[][] {
  const map = new Map<string, Post[]>()
  for (const pl of PLATFORMS) {
    for (const p of report.platforms[pl]?.posts ?? []) {
      if (!p.groupKey) continue
      map.set(p.groupKey, [...(map.get(p.groupKey) ?? []), p])
    }
  }
  return [...map.values()]
    .filter((g) => new Set(g.map((p) => p.platform)).size > 1)
    .sort((a, b) => b[0].publishedAt.localeCompare(a[0].publishedAt))
}
