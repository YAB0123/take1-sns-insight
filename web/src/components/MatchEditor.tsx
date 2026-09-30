import { useState } from 'react'
import type { Platform, Post, Report } from '../types'
import { PLATFORMS, PLATFORM_LABEL } from '../types'
import { formatPublished } from './PostTable'

type Platforms = Report['platforms']

const short = (p: Post) => `${formatPublished(p.publishedAt)}　${p.title.replace(/\s+/g, ' ').slice(0, 28)}`

/** 投稿の groupKey を書き換えた platforms を返す */
function withGroupKeys(platforms: Platforms, fn: (p: Post) => string | undefined): Platforms {
  const next: Platforms = { ...platforms }
  for (const pl of PLATFORMS) {
    const d = next[pl]
    if (d) next[pl] = { ...d, posts: d.posts.map((p) => ({ ...p, groupKey: fn(p) })) }
  }
  return next
}

/**
 * 同じ動画の紐付け。行＝動画、列＝SNS。各マスで投稿を選ぶ。
 * AIの提案を取り込んだあと、違っていればここで直す。
 */
export function MatchEditor({
  report,
  onChange,
  onSuggest,
  busy,
}: {
  report: Report
  onChange: (platforms: Platforms) => void
  onSuggest: () => void
  busy: boolean
}) {
  const [extraRows, setExtraRows] = useState<string[]>([])
  const present = PLATFORMS.filter((pl) => (report.platforms[pl]?.posts.length ?? 0) > 0)
  const all = present.flatMap((pl) => report.platforms[pl]!.posts)

  // 既存の groupKey の並び（最初の投稿の公開日の新しい順）＋ 追加した空の行
  const keys = [...new Set(all.filter((p) => p.groupKey).map((p) => p.groupKey!))]
  const firstDate = (k: string) => all.filter((p) => p.groupKey === k).map((p) => p.publishedAt).sort()[0] ?? ''
  keys.sort((a, b) => firstDate(b).localeCompare(firstDate(a)))
  const rows = [...keys, ...extraRows.filter((k) => !keys.includes(k))]

  function setCell(rowKey: string, pl: Platform, postId: string) {
    onChange(
      withGroupKeys(report.platforms, (p) => {
        if (p.platform !== pl) return p.groupKey
        if (p.id === postId) return rowKey
        return p.groupKey === rowKey ? undefined : p.groupKey
      }),
    )
  }

  const unmatched = all.filter((p) => !p.groupKey).length

  return (
    <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold text-slate-800">4. 同じ動画の紐付け（SNS別比較の表に使います）</h2>
        <div className="flex gap-2">
          <button onClick={onSuggest} disabled={busy || all.length < 2} className="rounded-md bg-violet-700 px-3 py-1.5 text-sm text-white disabled:opacity-40">
            AIで紐付けを提案
          </button>
          <button
            onClick={() => setExtraRows((r) => [...r, `g-${Date.now()}`])}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm"
          >
            行を追加
          </button>
        </div>
      </div>
      <p className="text-xs text-slate-500">
        SNSごとにタイトルや公開日が違っても、同じ動画ならこの表で同じ行にしてください。「AIで紐付けを提案」は今の紐付けを置き換えます。
        変更したら「保存」を押してください。どの行にも入っていない投稿：{unmatched}件
      </p>
      {rows.length === 0 ? (
        <p className="text-sm text-slate-500">まだ紐付けがありません。</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-xs">
            <thead className="text-slate-500">
              <tr>
                {present.map((pl) => (
                  <th key={pl} className="px-1 py-1 text-left font-medium">
                    {PLATFORM_LABEL[pl]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((rowKey) => (
                <tr key={rowKey} className="border-t border-slate-100">
                  {present.map((pl) => {
                    const posts = report.platforms[pl]!.posts
                    const current = posts.find((p) => p.groupKey === rowKey)
                    return (
                      <td key={pl} className="px-1 py-1">
                        <select
                          value={current?.id ?? ''}
                          onChange={(e) => setCell(rowKey, pl, e.target.value)}
                          className={`w-full rounded border px-1 py-1 ${current ? 'border-slate-300 bg-white' : 'border-dashed border-slate-200 bg-slate-50 text-slate-400'}`}
                        >
                          <option value="">（なし）</option>
                          {[...posts]
                            .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
                            .map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.groupKey && p.groupKey !== rowKey ? '※別の行 ' : ''}
                                {short(p)}
                              </option>
                            ))}
                        </select>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

/** AIの提案（投稿 id のグループ）で紐付けを置き換える */
export function applyGroups(platforms: Platforms, groups: string[][]): Platforms {
  const keyOf = new Map<string, string>()
  for (const g of groups) for (const id of g) keyOf.set(id, g[0])
  return withGroupKeys(platforms, (p) => keyOf.get(p.id))
}
