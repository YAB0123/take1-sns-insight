import { useState } from 'react'
import type { Platform, PlatformData, PostMetrics } from '../types'
import { PLATFORM_LABEL } from '../types'
import { formatPublished } from './PostTable'

/** 手で直せる投稿の指標（広告で回した分を除くときなど） */
const FIELDS: Record<Platform, { key: keyof PostMetrics; label: string }[]> = {
  instagram: [
    { key: 'views', label: 'ビュー' },
    { key: 'reach', label: 'リーチ' },
    { key: 'likes', label: 'いいね' },
    { key: 'comments', label: 'コメント' },
    { key: 'shares', label: 'シェア' },
    { key: 'saves', label: '保存' },
    { key: 'follows', label: 'フォロー' },
  ],
  facebook: [
    { key: 'views', label: 'ビュー' },
    { key: 'reach', label: 'リーチ' },
    { key: 'likes', label: 'リアクション' },
    { key: 'comments', label: 'コメント' },
    { key: 'shares', label: 'シェア' },
    { key: 'follows', label: 'フォロー' },
  ],
  tiktok: [
    { key: 'views', label: '視聴数' },
    { key: 'likes', label: 'いいね' },
    { key: 'comments', label: 'コメント' },
    { key: 'shares', label: 'シェア' },
    { key: 'saves', label: '保存' },
    { key: 'follows', label: '新規フォロワー' },
  ],
  youtube: [
    { key: 'views', label: '視聴回数' },
    { key: 'impressions', label: 'インプレッション' },
    { key: 'watchHours', label: '総再生(時間)' },
    { key: 'likes', label: '高評価' },
    { key: 'comments', label: 'コメント' },
    { key: 'shares', label: '共有' },
    { key: 'follows', label: '登録者増' },
  ],
}

export function PostEditor({
  platforms,
  onChange,
}: {
  platforms: Partial<Record<Platform, PlatformData>>
  onChange: (platforms: Partial<Record<Platform, PlatformData>>) => void
}) {
  const available = (Object.keys(FIELDS) as Platform[]).filter((pl) => (platforms[pl]?.posts.length ?? 0) > 0)
  const [tab, setTab] = useState<Platform | undefined>(available[0])
  const pl = tab && available.includes(tab) ? tab : available[0]
  if (!pl) return null
  const d = platforms[pl]!

  function setMetric(postId: string, key: keyof PostMetrics, value: string) {
    const n = value === '' ? undefined : Number(value.replaceAll(',', ''))
    if (n != null && Number.isNaN(n)) return
    const posts = d.posts.map((p) => (p.id === postId ? { ...p, metrics: { ...p.metrics, [key]: n } } : p))
    onChange({ ...platforms, [pl!]: { ...d, posts } })
  }

  const posts = [...d.posts].sort((a, b) => a.publishedAt.localeCompare(b.publishedAt))
  return (
    <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-5">
      <h2 className="font-semibold text-slate-800">投稿ごとの数値の修正</h2>
      <p className="text-xs text-slate-500">
        広告で回した分を除くときなどに直せます。修正したら「保存」を押してください。取込をやり直すと取込時の数値に戻ります。
      </p>
      <div className="flex gap-1">
        {available.map((x) => (
          <button
            key={x}
            onClick={() => setTab(x)}
            className={`rounded-md px-3 py-1 text-sm ${x === pl ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-700'}`}
          >
            {PLATFORM_LABEL[x]}
          </button>
        ))}
      </div>
      <div className="overflow-x-auto">
        <table className="text-sm">
          <thead>
            <tr className="text-slate-500">
              <th className="px-2 py-1 text-left font-medium">公開日時</th>
              <th className="px-2 py-1 text-left font-medium">投稿</th>
              {FIELDS[pl].map((f) => (
                <th key={f.key} className="px-2 py-1 text-left font-medium whitespace-nowrap">
                  {f.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {posts.map((p) => (
              <tr key={p.id}>
                <td className="px-2 py-1 whitespace-nowrap text-slate-600">{formatPublished(p.publishedAt)}</td>
                <td className="max-w-[16rem] truncate px-2 py-1 text-slate-700" title={p.title}>
                  {p.title}
                </td>
                {FIELDS[pl].map((f) => (
                  <td key={f.key} className="px-1 py-1">
                    <input
                      inputMode="decimal"
                      value={p.metrics[f.key] ?? ''}
                      onChange={(e) => setMetric(p.id, f.key, e.target.value)}
                      className="w-24 rounded border border-slate-300 px-2 py-1 text-right tabular-nums"
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
