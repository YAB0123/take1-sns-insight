import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { getClient, listReports, newReportId, publishReport, saveReport, updateClient } from '../lib/db'
import { buildUrls, defaultLabel, detectPeriod, extractIds } from '../lib/urls'
import type { Client, Report, ReportUrls } from '../types'
import { EMPTY_INSIGHT } from '../types'

export function shareUrl(c: Client) {
  return `${location.origin}/r/${c.shareToken}`
}

const URL_FIELDS: { key: keyof ReportUrls; label: string; placeholder: string }[] = [
  { key: 'meta', label: 'Instagram / Facebook（Meta Business Suite インサイト）', placeholder: 'https://business.facebook.com/latest/insights/results?...' },
  { key: 'tiktok', label: 'TikTok（TikTok Studio アナリティクス）', placeholder: 'https://www.tiktok.com/tiktokstudio/analytics?dateRange=...' },
  { key: 'youtube', label: 'YouTube（YouTube Studio アナリティクス）', placeholder: 'https://studio.youtube.com/channel/.../analytics/tab-overview/period-...' },
]

export function AdminClient() {
  const { clientId = '' } = useParams()
  const navigate = useNavigate()
  const [client, setClient] = useState<Client>()
  const [reports, setReports] = useState<Report[]>()
  const [urls, setUrls] = useState<ReportUrls>({})
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    getClient(clientId).then(setClient)
    listReports(clientId).then(setReports)
  }, [clientId])

  function setUrl(key: keyof ReportUrls, value: string) {
    const next = { ...urls, [key]: value.trim() }
    setUrls(next)
    const p = detectPeriod(next)
    if (p) {
      setStart(p.start)
      setEnd(p.end)
    }
  }

  function generateUrls() {
    if (client?.ids && start && end) setUrls(buildUrls(client.ids, start, end))
  }

  async function create() {
    if (!client || !start || !end) return
    const ids = { ...client.ids, ...Object.fromEntries(Object.entries(extractIds(urls) ?? {}).filter(([, v]) => v)) }
    await updateClient(client.id, { ids })
    const report: Report = {
      id: newReportId(client.id),
      clientId: client.id,
      periodStart: start,
      periodEnd: end,
      label: defaultLabel(start),
      urls,
      platforms: {},
      insight: EMPTY_INSIGHT,
      status: 'draft',
      updatedAt: new Date().toISOString(),
    }
    await saveReport(report)
    navigate(`/admin/clients/${client.id}/reports/${report.id}`)
  }

  async function importJson(file: File) {
    if (!client) return
    const items = JSON.parse(await file.text()) as Pick<Report, 'periodStart' | 'periodEnd' | 'label' | 'platforms'>[]
    const existing = new Set((reports ?? []).map((r) => r.periodStart))
    const fresh = items.filter((it) => !existing.has(it.periodStart))
    if (!confirm(`${fresh.length}か月分を取り込み、クライアント用ページに公開します（既にある${items.length - fresh.length}か月分は飛ばします）。よろしいですか？`)) return
    const added: Report[] = []
    for (const it of fresh) {
      const r: Report = {
        ...it,
        id: newReportId(client.id),
        clientId: client.id,
        urls: {},
        insight: EMPTY_INSIGHT,
        status: 'draft',
        updatedAt: new Date().toISOString(),
      }
      added.push(await publishReport(client, r))
    }
    setReports((rs) => [...added, ...(rs ?? [])].sort((a, b) => b.periodStart.localeCompare(a.periodStart)))
  }

  if (!client) return <p className="text-slate-500">読み込み中…</p>

  return (
    <div className="space-y-8">
      <div>
        <Link to="/admin" className="text-sm text-slate-500 hover:underline">
          ← クライアント一覧
        </Link>
        <h1 className="mt-1 text-xl font-bold text-slate-900">{client.name}</h1>
        <div className="mt-2 flex items-center gap-2 text-sm">
          <span className="text-slate-500">クライアント用URL:</span>
          <a href={shareUrl(client)} target="_blank" rel="noreferrer" className="text-indigo-700 hover:underline">
            {shareUrl(client)}
          </a>
          <button
            onClick={() => navigator.clipboard.writeText(shareUrl(client)).then(() => setCopied(true))}
            className="rounded border border-slate-300 bg-white px-2 py-0.5 text-xs"
          >
            {copied ? 'コピーしました' : 'コピー'}
          </button>
        </div>
      </div>

      <section className="space-y-3">
        <h2 className="font-semibold text-slate-800">レポート</h2>
        <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
          {reports?.map((r) => (
            <li key={r.id}>
              <Link to={`/admin/clients/${client.id}/reports/${r.id}`} className="flex items-center justify-between px-4 py-3 hover:bg-slate-50">
                <span>
                  {r.label}
                  <span className="ml-3 text-sm text-slate-500">
                    {r.periodStart} 〜 {r.periodEnd}
                  </span>
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs ${r.status === 'published' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'}`}
                >
                  {r.status === 'published' ? '公開中' : '下書き'}
                </span>
              </Link>
            </li>
          ))}
          {reports?.length === 0 && <li className="px-4 py-3 text-sm text-slate-500">まだレポートがありません。</li>}
        </ul>
        <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-slate-600">
          <span className="rounded border border-slate-300 bg-white px-2 py-1">過去データ（JSON）を取り込む</span>
          <input
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) importJson(f).catch((err) => alert(`取り込みに失敗しました: ${err.message}`))
              e.target.value = ''
            }}
          />
          <span className="text-xs text-slate-400">scripts/import_sheet.py で作ったファイル</span>
        </label>
      </section>

      <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="font-semibold text-slate-800">新しいレポートを作成</h2>
        {URL_FIELDS.map((f) => (
          <label key={f.key} className="block space-y-1">
            <span className="text-sm text-slate-700">{f.label}</span>
            <input
              value={urls[f.key] ?? ''}
              onChange={(e) => setUrl(f.key, e.target.value)}
              placeholder={f.placeholder}
              className="w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-xs"
            />
          </label>
        ))}
        <div className="flex flex-wrap items-end gap-4">
          <label className="space-y-1">
            <span className="block text-sm text-slate-700">集計開始日</span>
            <input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
          </label>
          <label className="space-y-1">
            <span className="block text-sm text-slate-700">集計終了日</span>
            <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
          </label>
          {client.ids?.metaAssetId && (
            <button onClick={generateUrls} disabled={!start || !end} className="rounded-md border border-slate-300 px-3 py-2 text-sm disabled:opacity-40">
              前回の設定からURLを自動生成
            </button>
          )}
          <button
            onClick={create}
            disabled={!start || !end}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-700 disabled:opacity-40"
          >
            作成して取込へ進む
          </button>
        </div>
        <p className="text-xs text-slate-500">URLを貼ると集計期間は自動で入ります。日付を先に入れて「自動生成」を押せば、URLを貼らなくても作れます（2回目以降）。</p>
      </section>
    </div>
  )
}
