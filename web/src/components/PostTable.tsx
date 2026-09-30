import { useMemo, useState } from 'react'
import { fmt, pct } from '../lib/metrics'
import type { Platform, Post } from '../types'

interface Col {
  label: string
  get: (p: Post) => number | undefined
  render?: (p: Post) => string
}

const rate = (a?: number, b?: number) => (a != null && b ? (a / b) * 100 : undefined)

const COLUMNS: Record<Platform, Col[]> = {
  instagram: [
    { label: 'ビュー', get: (p) => p.metrics.views },
    { label: 'リーチ', get: (p) => p.metrics.reach },
    { label: 'いいね', get: (p) => p.metrics.likes },
    { label: 'いいね率', get: (p) => rate(p.metrics.likes, p.metrics.reach), render: (p) => pct(rate(p.metrics.likes, p.metrics.reach), 2) },
    { label: 'コメント', get: (p) => p.metrics.comments },
    { label: 'シェア', get: (p) => p.metrics.shares },
    { label: '保存', get: (p) => p.metrics.saves },
    { label: '保存率', get: (p) => rate(p.metrics.saves, p.metrics.reach), render: (p) => pct(rate(p.metrics.saves, p.metrics.reach), 2) },
    { label: 'フォロー', get: (p) => p.metrics.follows },
    { label: '平均再生(秒)', get: (p) => p.metrics.avgWatchSec },
  ],
  facebook: [
    { label: 'ビュー', get: (p) => p.metrics.views },
    { label: 'リーチ', get: (p) => p.metrics.reach },
    { label: 'リアクション', get: (p) => p.metrics.likes },
    { label: 'コメント', get: (p) => p.metrics.comments },
    { label: 'シェア', get: (p) => p.metrics.shares },
    { label: 'フォロー', get: (p) => p.metrics.follows },
    { label: '平均再生(秒)', get: (p) => p.metrics.avgWatchSec },
  ],
  tiktok: [
    { label: '視聴数', get: (p) => p.metrics.views },
    { label: 'いいね', get: (p) => p.metrics.likes },
    { label: 'コメント', get: (p) => p.metrics.comments },
    { label: 'シェア', get: (p) => p.metrics.shares },
    { label: '保存', get: (p) => p.metrics.saves },
    { label: '平均視聴(秒)', get: (p) => p.metrics.avgWatchSec, render: (p) => fmt(p.metrics.avgWatchSec, 1) },
    { label: 'フル視聴率', get: (p) => p.metrics.completionRate, render: (p) => pct(p.metrics.completionRate, 0) },
    { label: '新規フォロワー', get: (p) => p.metrics.follows },
  ],
  youtube: [
    { label: '視聴回数', get: (p) => p.metrics.views },
    { label: 'インプレッション', get: (p) => p.metrics.impressions },
    { label: 'クリック率', get: (p) => p.metrics.ctr, render: (p) => pct(p.metrics.ctr, 1) },
    { label: '平均視聴(秒)', get: (p) => p.metrics.avgWatchSec },
    { label: '総再生(時間)', get: (p) => p.metrics.watchHours, render: (p) => fmt(p.metrics.watchHours, 1) },
    { label: '高評価', get: (p) => p.metrics.likes },
    { label: 'コメント', get: (p) => p.metrics.comments },
    { label: '共有', get: (p) => p.metrics.shares },
    { label: '登録者増', get: (p) => p.metrics.follows },
  ],
}

const WEEKDAY = ['日', '月', '火', '水', '木', '金', '土']

export function formatPublished(iso: string) {
  const d = new Date(iso)
  const time = d.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo' })
  const jst = new Date(d.getTime() + 9 * 3600_000)
  const date = `${jst.getUTCMonth() + 1}/${jst.getUTCDate()}(${WEEKDAY[jst.getUTCDay()]})`
  // YouTube は公開日だけで時刻が無い（00:00 で保存している）
  return time === '00:00' ? date : `${date} ${time}`
}

export function PostTable({ platform, posts }: { platform: Platform; posts: Post[] }) {
  const cols = COLUMNS[platform]
  const [sortIdx, setSortIdx] = useState<number | null>(null)

  const sorted = useMemo(() => {
    if (sortIdx == null) return [...posts].sort((a, b) => a.publishedAt.localeCompare(b.publishedAt))
    const c = cols[sortIdx]
    return [...posts].sort((a, b) => (c.get(b) ?? -Infinity) - (c.get(a) ?? -Infinity))
  }, [posts, cols, sortIdx])

  // 上位3投稿（ビュー順）に印をつける
  const top = useMemo(
    () => new Set([...posts].sort((a, b) => (b.metrics.views ?? 0) - (a.metrics.views ?? 0)).slice(0, 3).map((p) => p.id)),
    [posts],
  )

  if (posts.length === 0) return <p className="text-sm text-slate-500">この期間の投稿データはありません。</p>

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 print:overflow-visible">
      <table className="w-full min-w-[900px] text-sm print:min-w-0 print:text-[9px]">
        <thead className="bg-slate-50 text-slate-600">
          <tr>
            <th className="px-3 py-2 text-left font-medium whitespace-nowrap">
              <button className="hover:text-slate-900" onClick={() => setSortIdx(null)}>
                公開日時{sortIdx == null && ' ▲'}
              </button>
            </th>
            <th className="px-3 py-2 text-left font-medium">投稿</th>
            {cols.map((c, i) => (
              <th key={c.label} className="px-3 py-2 text-right font-medium whitespace-nowrap">
                <button className="hover:text-slate-900" onClick={() => setSortIdx(i)}>
                  {c.label}
                  {sortIdx === i && ' ▼'}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {sorted.map((p) => (
            <tr key={p.id} className={top.has(p.id) ? 'bg-amber-50/60' : ''}>
              <td className="px-3 py-2 whitespace-nowrap text-slate-600">{formatPublished(p.publishedAt)}</td>
              <td className="max-w-[320px] px-3 py-2">
                <div className="flex items-start gap-2">
                  {top.has(p.id) && <span className="mt-0.5 shrink-0 rounded bg-amber-400 px-1 text-[10px] font-bold text-white">TOP</span>}
                  <span className="line-clamp-2 text-slate-800" title={p.title}>
                    {p.url ? (
                      <a href={p.url} target="_blank" rel="noreferrer" className="hover:underline">
                        {p.title}
                      </a>
                    ) : (
                      p.title
                    )}
                  </span>
                </div>
                {p.type && <span className="text-xs text-slate-400">{p.type}</span>}
              </td>
              {cols.map((c) => (
                <td key={c.label} className="px-3 py-2 text-right tabular-nums whitespace-nowrap text-slate-800">
                  {c.render ? c.render(p) : fmt(c.get(p))}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
