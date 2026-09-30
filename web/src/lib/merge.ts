import type { CollectResult } from './extension'
import { autoGroup } from './matching'
import type { Platform, Report } from '../types'

/**
 * 拡張機能の取込結果をレポートに反映する（レポート画面と一括取込で共通）。
 * all: 同じクライアントの全レポート（過去の月かどうかの判定に使う）
 */
export function mergeCollected(report: Report, res: CollectResult, all: Report[], opts: { keepSheetPosts?: boolean } = {}): Report {
  const platforms = { ...report.platforms }
  // 各管理画面の「フォロワー総数」は期間を指定しても今日の値しか出ない。
  // もっと新しい月のレポートがある（＝過去の月を取り込んでいる）ときは上書きせず、既にある値（過去シートなど）を残す。
  // 最新の月は、締めから何日たっていても今の総数を入れる
  const isPast = all.some((r) => r.id !== report.id && r.periodStart > report.periodEnd)
  const hasSheetPosts = !!report.platforms.instagram?.posts.some((p) => p.id.startsWith('sheet-'))
  for (const [pl, fetched] of Object.entries(res.data)) {
    const prev = report.platforms[pl as Platform]
    let d = fetched
    // 過去シートの投稿（当時の記録）は残し、期間の数値だけ更新する
    if (pl === 'instagram' && opts.keepSheetPosts && hasSheetPosts) d = { ...d, posts: prev!.posts }
    if (isPast) d = { ...d, account: { ...d.account, followers: prev?.account.followers } }
    // 確認済みの「同じ動画の紐付け」は取り込み直しても残す（投稿 id は取り込みごとに同じ）
    const keep = new Map((prev?.posts ?? []).filter((p) => p.groupKey).map((p) => [p.id, p.groupKey]))
    d = { ...d, posts: d.posts.map((p) => (keep.has(p.id) ? { ...p, groupKey: keep.get(p.id) } : p)) }
    platforms[pl as Platform] = d
  }
  return autoGroup({ ...report, platforms })
}

/** YYYY-MM-DD を n か月ずらす（月末を超える日は月末にそろえる） */
export function addMonths(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number)
  const first = new Date(Date.UTC(y, m - 1 + n, 1))
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate()
  first.setUTCDate(Math.min(d, last))
  return first.toISOString().slice(0, 10)
}
