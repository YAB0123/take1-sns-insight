import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { ReportView } from '../components/ReportView'
import { getPublicClientName, listPublicReports } from '../lib/db'
import type { Report } from '../types'

export function PublicReport() {
  const { token = '' } = useParams()
  const [params, setParams] = useSearchParams()
  const [name, setName] = useState<string>()
  const [reports, setReports] = useState<Report[]>()
  const [error, setError] = useState(false)

  useEffect(() => {
    Promise.all([getPublicClientName(token), listPublicReports(token)])
      .then(([n, rs]) => {
        if (!n) setError(true)
        setName(n)
        setReports(rs)
      })
      .catch(() => setError(true))
  }, [token])

  if (error) return <p className="p-8 text-slate-600">レポートが見つかりません。URLをご確認ください。</p>
  if (!reports || !name) return <p className="p-8 text-slate-500">読み込み中…</p>
  if (reports.length === 0) return <p className="p-8 text-slate-600">公開中のレポートはまだありません。</p>

  const current = reports.find((r) => r.id === params.get('r')) ?? reports[0]

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 print:max-w-none print:p-0">
      <ReportView
        key={current.id}
        report={current}
        reports={reports}
        clientName={name}
        headerRight={
          <select
            aria-label="表示する月"
            value={current.id}
            onChange={(e) => setParams({ r: e.target.value })}
            className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
          >
            {reports.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
        }
      />
      <footer className="mt-12 border-t border-slate-200 pt-4 text-xs text-slate-400">
        数値は各SNSの管理画面から取込時点のものです。投稿ごとの数値は、集計期間内に公開した投稿の取込時点までの累計です。
      </footer>
    </main>
  )
}
