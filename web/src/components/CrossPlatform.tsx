import { groups } from '../lib/matching'
import { engagementOf, fmt, pct } from '../lib/metrics'
import type { Report } from '../types'
import { PLATFORMS, PLATFORM_LABEL } from '../types'
import { formatPublished } from './PostTable'

/** 同じ動画のSNS別比較 */
export function CrossPlatform({ report }: { report: Report }) {
  const gs = groups(report)
  const present = PLATFORMS.filter((pl) => (report.platforms[pl]?.posts.length ?? 0) > 0)
  if (gs.length === 0)
    return <p className="text-sm text-slate-500">SNSをまたいで同じ動画と判定された投稿はありません。</p>

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="w-full min-w-[720px] text-sm print:min-w-0 print:text-[9px]">
        <thead className="bg-slate-50 text-slate-600">
          <tr>
            <th className="px-3 py-2 text-left font-medium">動画</th>
            {present.map((pl) => (
              <th key={pl} className="px-3 py-2 text-right font-medium whitespace-nowrap">
                {PLATFORM_LABEL[pl]}
                <div className="text-[10px] font-normal text-slate-400">ビュー / エンゲージ率</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {gs.map((g) => {
            const best = Math.max(...g.map((p) => p.metrics.views ?? 0))
            const first = [...g].sort((a, b) => a.publishedAt.localeCompare(b.publishedAt))[0]
            return (
              <tr key={g[0].groupKey}>
                <td className="max-w-[300px] px-3 py-2">
                  <div className="line-clamp-2 text-slate-800" title={first.title}>
                    {first.title}
                  </div>
                  <div className="text-xs text-slate-400">{formatPublished(first.publishedAt)}</div>
                </td>
                {present.map((pl) => {
                  const p = g.find((x) => x.platform === pl)
                  const isBest = p && (p.metrics.views ?? 0) === best && best > 0
                  return (
                    <td key={pl} className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
                      {p ? (
                        <>
                          <span className={isBest ? 'font-bold text-slate-900' : 'text-slate-700'}>
                            {isBest && '★ '}
                            {fmt(p.metrics.views)}
                          </span>
                          <div className="text-xs text-slate-400">{pct(engagementOf(p), 1)}</div>
                        </>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
