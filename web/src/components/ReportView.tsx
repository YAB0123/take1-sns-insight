import { useState, type ReactNode } from 'react'
import { changeRate, fmt, hasData, platformsOf, previousReport, summaryFor } from '../lib/metrics'
import type { Report } from '../types'
import { PLATFORMS, PLATFORM_LABEL } from '../types'
import { PlatformShare, TrendChart } from './Charts'
import { CrossPlatform } from './CrossPlatform'
import { KPI_SPECS, PLATFORM_COLOR, type KpiSpec, type TabKey } from './kpi'
import { PostTable } from './PostTable'

const COMBINED_COLOR = '#334155'

function formatPeriod(r: Report) {
  const f = (d: string) => d.replaceAll('-', '/')
  return `${f(r.periodStart)} 〜 ${f(r.periodEnd)}`
}

function Delta({ cur, prev, spec }: { cur?: number; prev?: number; spec: KpiSpec }) {
  if (cur == null || prev == null) return <span className="text-xs text-slate-400">先月比 —</span>
  const diff = spec.points ? cur - prev : changeRate(cur, prev)
  if (diff == null) return <span className="text-xs text-slate-400">先月比 —</span>
  const up = diff > 0
  const flat = Math.abs(diff) < 0.05
  const cls = flat ? 'text-slate-500' : up ? 'text-emerald-700' : 'text-rose-700'
  const arrow = flat ? '→' : up ? '▲' : '▼'
  return (
    <span className={`text-xs tabular-nums ${cls}`}>
      先月比 {arrow} {fmt(Math.abs(diff), 1)}
      {spec.points ? 'pt' : '%'}
    </span>
  )
}

function KpiGrid({ report, prev, tab }: { report: Report; prev?: Report; tab: TabKey }) {
  const s = summaryFor(report, tab)
  // 合算の先月比は、両月ともデータがあるSNSだけで比べる
  const common = prev ? platformsOf(report).filter((pl) => platformsOf(prev).includes(pl)) : []
  const cs = tab === 'combined' ? summaryFor(report, tab, common) : s
  const ps = prev ? summaryFor(prev, tab, tab === 'combined' ? common : undefined) : undefined
  if (!s) return null
  const partial = tab === 'combined' && prev && common.length > 0 && common.length < platformsOf(report).length
  return (
    <div className="space-y-2">
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 print:grid-cols-5">
      {KPI_SPECS[tab].map((spec) => {
        const cur = spec.get(s, report)
        const comparable = !!(cs && ps && prev) && (!spec.basis || spec.basis(cs) === spec.basis(ps))
        const p = comparable ? spec.get(ps!, prev!) : undefined
        const c = comparable ? spec.get(cs!, report) : undefined
        return (
          <div key={spec.label} className="rounded-lg border border-slate-200 bg-white p-3 break-inside-avoid">
            <div className="text-xs text-slate-500">{spec.label}</div>
            <div className="mt-1 text-xl font-semibold text-slate-900 tabular-nums">
              {spec.label.includes('純増') && cur != null && cur > 0 ? '+' : ''}
              {fmt(cur, spec.digits ?? 0)}
              {cur != null && spec.unit && <span className="ml-0.5 text-sm font-normal text-slate-500">{spec.unit}</span>}
            </div>
            <Delta cur={c} prev={p} spec={spec} />
          </div>
        )
      })}
    </div>
      {partial && (
        <p className="text-xs text-slate-500">
          ※ 先月比は、先月もデータがある {common.map((pl) => PLATFORM_LABEL[pl]).join('・')} だけで計算しています。
        </p>
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3 break-inside-avoid-page">
      <h3 className="text-base font-semibold text-slate-800">{title}</h3>
      {children}
    </section>
  )
}

function TabPanel({ report, reports, prev, tab }: { report: Report; reports: Report[]; prev?: Report; tab: TabKey }) {
  const color = tab === 'combined' ? COMBINED_COLOR : PLATFORM_COLOR[tab]
  return (
    <div className="space-y-8">
      <KpiGrid report={report} prev={prev} tab={tab} />

      {tab === 'combined' && (
        <>
          <PlatformShare report={report} />
          <Section title="同じ動画のSNS別比較（★は最もビューが多かったSNS）">
            <CrossPlatform report={report} />
          </Section>
        </>
      )}

      <div className="grid gap-4 md:grid-cols-2 print:grid-cols-2">
        <TrendChart reports={reports} tab={tab} currentId={report.id} title="ビューの推移" pick={(s) => s.views} color={color} />
        <TrendChart
          reports={reports}
          tab={tab}
          currentId={report.id}
          title="新規フォロワー（純増）の推移"
          pick={(s) => s.netFollowers}
          color={color}
        />
      </div>

      {tab !== 'combined' && (
        <Section title="投稿ごとの数値（黄色はビュー上位3投稿）">
          <PostTable platform={tab} posts={report.platforms[tab]?.posts ?? []} />
        </Section>
      )}
    </div>
  )
}

const INSIGHT_BLOCKS: { key: keyof Report['insight']; title: string }[] = [
  { key: 'summary', title: '今月の総評' },
  { key: 'comparison', title: '先月との比較' },
  { key: 'goodPoints', title: '良かった点' },
  { key: 'issues', title: '来月の課題' },
  { key: 'proposals', title: '来月の提案' },
]

export function InsightView({ report }: { report: Report }) {
  const blocks = INSIGHT_BLOCKS.filter((b) => report.insight[b.key]?.trim())
  if (blocks.length === 0) return null
  return (
    <section className="space-y-4 break-before-page">
      <h2 className="text-lg font-semibold text-slate-900">インサイト考察と来月の提案</h2>
      <div className="grid gap-4 md:grid-cols-2 print:grid-cols-1">
        {blocks.map((b) => (
          <div
            key={b.key}
            className={`rounded-lg border p-4 break-inside-avoid ${
              b.key === 'proposals' || b.key === 'issues' ? 'border-indigo-200 bg-indigo-50/40' : 'border-slate-200 bg-white'
            } ${b.key === 'summary' ? 'md:col-span-2' : ''}`}
          >
            <h3 className="mb-2 text-sm font-semibold text-slate-800">{b.title}</h3>
            <div className="text-sm leading-relaxed whitespace-pre-wrap text-slate-700">{report.insight[b.key]}</div>
          </div>
        ))}
      </div>
    </section>
  )
}

export function ReportView({
  report,
  reports,
  clientName,
  headerRight,
}: {
  report: Report
  reports: Report[]
  clientName: string
  headerRight?: ReactNode
}) {
  const tabs: TabKey[] = ['combined', ...PLATFORMS.filter((pl) => hasData(report.platforms[pl]))]
  const [tab, setTab] = useState<TabKey>('combined')
  const active = tabs.includes(tab) ? tab : 'combined'
  const prev = previousReport(reports, report)

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <p className="text-sm text-slate-500">{clientName} 様 SNSインサイトレポート</p>
          <h1 className="text-2xl font-bold text-slate-900">{report.label}</h1>
          <p className="text-sm text-slate-500">
            集計期間 {formatPeriod(report)}
            {prev && <span className="ml-2">（比較: {prev.label}）</span>}
          </p>
        </div>
        <div className="flex items-center gap-2 print:hidden">
          {headerRight}
          <button
            onClick={() => window.print()}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
          >
            PDFで保存
          </button>
        </div>
      </header>

      <nav className="flex gap-1 overflow-x-auto border-b border-slate-200 print:hidden" role="tablist">
        {tabs.map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={active === t}
            onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm whitespace-nowrap ${
              active === t ? 'border-slate-900 font-semibold text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            {t === 'combined' ? '合算' : PLATFORM_LABEL[t]}
          </button>
        ))}
      </nav>

      {/* 画面では選択中のタブだけ、印刷（PDF）では全タブを順に出す */}
      {tabs.map((t) => (
        <div key={t} className={`${active === t ? '' : 'hidden'} print:block print:break-before-page`}>
          <h2 className="mb-4 hidden text-lg font-semibold text-slate-900 print:block">{t === 'combined' ? '合算' : PLATFORM_LABEL[t]}</h2>
          <TabPanel report={report} reports={reports} prev={prev} tab={t} />
        </div>
      ))}

      <InsightView report={report} />
    </div>
  )
}
