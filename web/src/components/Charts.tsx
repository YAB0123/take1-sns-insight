import { useLayoutEffect, useRef, useState, type ReactElement } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, LabelList, Tooltip, XAxis, YAxis } from 'recharts'
import { fmt, summarize, summaryFor, type PlatformSummary } from '../lib/metrics'
import type { Report } from '../types'
import { PLATFORMS, PLATFORM_LABEL } from '../types'
import { PLATFORM_COLOR, type TabKey } from './kpi'

const AXIS = { fontSize: 11, fill: '#64748b' }
const GRID = '#e2e8f0'

function TooltipBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs shadow-sm">
      <div className="text-slate-500">{label}</div>
      <div className="font-semibold text-slate-900 tabular-nums">{value}</div>
    </div>
  )
}

// 軸ラベルは短く（「2026年11月度」→「11月」）。12か月並べても間引かれないように
const monthLabel = (r: Report) => r.label.replace(/^\d{4}年/, '').replace(/度$/, '')

/**
 * 親要素の幅を測ってから、確定した幅でグラフを描く。
 * （ResponsiveContainer は幅0のまま計算した棒がアニメーションなしだと描き直されず、幅がマイナスになる）
 */
function Sized({ height, children }: { height: number; children: (width: number) => ReactElement }) {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    // 画面に描画されていない（背景タブ等）と ResizeObserver が呼ばれないことがあるので、まずその場で測る
    setWidth(Math.floor(el.getBoundingClientRect().width))
    const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return (
    <div ref={ref} style={{ height }}>
      {width > 0 && children(width)}
    </div>
  )
}

/** 合算タブの推移：SNS別の積み上げ（どのSNSがいつから加わったかが分かるように） */
function StackedTrend({
  reports,
  title,
  pick,
}: {
  reports: Report[]
  title: string
  pick: (s: PlatformSummary) => number | undefined
}) {
  const sorted = [...reports].sort((a, b) => a.periodStart.localeCompare(b.periodStart)).slice(-12)
  const used = PLATFORMS.filter((pl) => sorted.some((r) => summarize(r.platforms[pl]) && pick(summarize(r.platforms[pl])!) != null))
  const data = sorted.map((r) => {
    const row: Record<string, string | number | undefined> = { label: monthLabel(r), full: r.label }
    for (const pl of used) {
      const s = summarize(r.platforms[pl])
      row[pl] = s ? pick(s) : undefined
    }
    return row
  })
  if (data.length < 2 || used.length === 0) return null
  const last = used[used.length - 1]

  return (
    <figure className="rounded-lg border border-slate-200 p-4 break-inside-avoid">
      <figcaption className="mb-2 flex flex-wrap items-center justify-between gap-2 text-sm font-medium text-slate-700">
        {title}
        <span className="flex flex-wrap gap-3 text-xs font-normal text-slate-600">
          {used.map((pl) => (
            <span key={pl} className="flex items-center gap-1">
              <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: PLATFORM_COLOR[pl] }} />
              {PLATFORM_LABEL[pl]}
            </span>
          ))}
        </span>
      </figcaption>
      <Sized height={192}>
        {(width) => (
          <BarChart width={width} height={192} data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="20%">
            <CartesianGrid vertical={false} stroke={GRID} />
            <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} interval={0} />
            <YAxis tick={AXIS} tickLine={false} axisLine={false} width={48} tickFormatter={(v: number) => fmt(v)} />
            <Tooltip
              cursor={{ fill: '#f1f5f9' }}
              content={({ active, payload }) =>
                active && payload?.length ? (
                  <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs shadow-sm">
                    <div className="mb-1 text-slate-500">{payload[0].payload.full}</div>
                    {[...payload].reverse().map((p) => (
                      <div key={String(p.dataKey)} className="flex items-center justify-between gap-4">
                        <span className="flex items-center gap-1 text-slate-600">
                          <span className="inline-block h-2 w-2 rounded-sm" style={{ background: p.color }} />
                          {PLATFORM_LABEL[p.dataKey as keyof typeof PLATFORM_LABEL]}
                        </span>
                        <span className="font-medium text-slate-900 tabular-nums">{fmt(p.value as number)}</span>
                      </div>
                    ))}
                  </div>
                ) : null
              }
            />
            {used.map((pl) => (
              <Bar
                key={pl}
                dataKey={pl}
                stackId="a"
                fill={PLATFORM_COLOR[pl]}
                stroke="#ffffff"
                strokeWidth={1}
                maxBarSize={36}
                radius={pl === last ? [4, 4, 0, 0] : 0}
                // 背景タブや印刷ではアニメーションが途中で止まり棒が短く描かれるため、最初から最終形で描く
                isAnimationActive={false}
              />
            ))}
          </BarChart>
        )}
      </Sized>
    </figure>
  )
}

/** 月ごとの推移（1指標1チャート。二軸は使わない） */
export function TrendChart({
  reports,
  tab,
  title,
  pick,
  color,
  currentId,
}: {
  reports: Report[]
  tab: TabKey
  title: string
  pick: (s: PlatformSummary) => number | undefined
  color: string
  currentId: string
}) {
  if (tab === 'combined') return <StackedTrend reports={reports} title={title} pick={pick} />

  const data = [...reports]
    .sort((a, b) => a.periodStart.localeCompare(b.periodStart))
    .slice(-12)
    .map((r) => {
      const s = summaryFor(r, tab)
      return { id: r.id, label: monthLabel(r), full: r.label, value: s ? pick(s) : undefined, basis: s?.viewsBasis }
    })
    .filter((d) => d.value != null)

  if (data.length < 2) return null
  const mixedBasis = title.includes('ビュー') && new Set(data.map((d) => d.basis)).size > 1

  return (
    <figure className="rounded-lg border border-slate-200 p-4 break-inside-avoid">
      <figcaption className="mb-2 text-sm font-medium text-slate-700">{title}</figcaption>
      <Sized height={192}>
        {(width) => (
          <BarChart width={width} height={192} data={data} margin={{ top: 16, right: 8, left: 0, bottom: 0 }} barCategoryGap="20%">
            <CartesianGrid vertical={false} stroke={GRID} />
            <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} interval={0} />
            <YAxis tick={AXIS} tickLine={false} axisLine={false} width={48} tickFormatter={(v: number) => fmt(v)} />
            <Tooltip
              cursor={{ fill: '#f1f5f9' }}
              content={({ active, payload }) =>
                active && payload?.[0] ? (
                  <TooltipBox label={payload[0].payload.full} value={fmt(payload[0].value as number)} />
                ) : null
              }
            />
            <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={36} isAnimationActive={false}>
              {data.map((d) => (
                <Cell key={d.id} fill={color} fillOpacity={d.id === currentId ? 1 : 0.35} />
              ))}
              <LabelList
                dataKey="value"
                position="top"
                content={({ x, y, width, value, index }) =>
                  data[index as number]?.id === currentId ? (
                    <text x={Number(x) + Number(width) / 2} y={Number(y) - 4} textAnchor="middle" fontSize={11} fill="#0f172a">
                      {fmt(value as number)}
                    </text>
                  ) : null
                }
              />
            </Bar>
          </BarChart>
        )}
      </Sized>
      {mixedBasis && (
        <p className="mt-1 text-xs text-slate-500">
          ※ 月によって集計方法が異なります（取込開始前の月は期間内に公開した投稿のビュー合計、以降はアカウント全体の閲覧数）。
        </p>
      )}
    </figure>
  )
}

/** 合算タブ：プラットフォーム別のビュー内訳 */
export function PlatformShare({ report }: { report: Report }) {
  const rows = PLATFORMS.map((pl) => ({ pl, s: summarize(report.platforms[pl]) })).filter(
    (x): x is { pl: (typeof PLATFORMS)[number]; s: PlatformSummary } => !!x.s,
  )
  const total = rows.reduce((a, r) => a + r.s.views, 0)
  if (total === 0) return null
  return (
    <figure className="rounded-lg border border-slate-200 p-4 break-inside-avoid">
      <figcaption className="mb-3 text-sm font-medium text-slate-700">ビューのSNS別内訳</figcaption>
      <div className="space-y-2">
        {rows
          .sort((a, b) => b.s.views - a.s.views)
          .map(({ pl, s }) => {
            const share = (s.views / total) * 100
            return (
              <div key={pl} className="grid grid-cols-[90px_1fr_130px] items-center gap-3 text-sm" title={`${PLATFORM_LABEL[pl]}: ${fmt(s.views)}`}>
                <span className="text-slate-700">{PLATFORM_LABEL[pl]}</span>
                <div className="h-3 rounded bg-slate-100">
                  <div className="h-3 rounded" style={{ width: `${share}%`, background: PLATFORM_COLOR[pl] }} />
                </div>
                <span className="text-right text-slate-700 tabular-nums">
                  {fmt(s.views)} <span className="text-slate-400">({fmt(share, 1)}%)</span>
                </span>
              </div>
            )
          })}
      </div>
    </figure>
  )
}
