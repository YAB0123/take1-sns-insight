import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { applyGroups } from '../components/MatchEditor'
import { auth } from '../firebase'
import { getClient, listReports, requestMatch, saveReport } from '../lib/db'
import { collect, pingExtension } from '../lib/extension'
import { mergeCollected } from '../lib/merge'
import type { Client, Platform, Report } from '../types'
import { PLATFORMS } from '../types'

type Status = { state: 'waiting' | 'running' | 'done' | 'error'; message: string }

const hasData = (r: Report) => Object.keys(r.platforms ?? {}).length > 0

function targetsFor(r: Report): Platform[] {
  return PLATFORMS.filter((pl) => (pl === 'instagram' || pl === 'facebook' ? !!r.urls.meta : !!r.urls[pl]))
}

/**
 * まだ数値の入っていないレポートを、新しい月から順にまとめて取り込む。
 * 新しいクライアントの初回（過去1年分）で使う。1か月あたり3〜4分。
 */
export function Backfill() {
  const { clientId = '' } = useParams()
  const [client, setClient] = useState<Client>()
  const [reports, setReports] = useState<Report[]>([])
  const [status, setStatus] = useState<Record<string, Status>>({})
  const [extVersion, setExtVersion] = useState<string | null>(null)
  const [withMatch, setWithMatch] = useState(true)
  const [running, setRunning] = useState(false)
  const stopRef = useRef(false)

  useEffect(() => {
    getClient(clientId).then(setClient)
    listReports(clientId).then(setReports)
    pingExtension().then((v) => setExtVersion(v ?? null))
  }, [clientId])

  // 取込中はページを閉じないよう警告する
  useEffect(() => {
    if (!running) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [running])

  const pending = reports.filter((r) => !hasData(r)).sort((a, b) => b.periodStart.localeCompare(a.periodStart))

  async function run() {
    setRunning(true)
    stopRef.current = false
    let all = [...reports]
    const set = (id: string, s: Status) => setStatus((st) => ({ ...st, [id]: s }))
    for (const r of pending) {
      if (stopRef.current) break
      try {
        set(r.id, { state: 'running', message: '取込中…' })
        const res = await collect(
          { urls: r.urls, periodStart: r.periodStart, periodEnd: r.periodEnd, targets: targetsFor(r) },
          (m) => set(r.id, { state: 'running', message: m }),
        )
        let next = mergeCollected(r, res, all)
        await saveReport(next)
        if (withMatch && Object.keys(next.platforms).length > 1) {
          set(r.id, { state: 'running', message: 'AIで同じ動画を紐付け中…' })
          const groups = await requestMatch(next, auth.currentUser?.email ?? '', (m) => set(r.id, { state: 'running', message: m }))
          next = { ...next, platforms: applyGroups(next.platforms, groups) }
          await saveReport(next)
        }
        all = all.map((x) => (x.id === next.id ? next : x))
        setReports(all)
        const counts = PLATFORMS.filter((pl) => next.platforms[pl]).map((pl) => `${pl} ${next.platforms[pl]!.posts.length}件`)
        set(r.id, {
          state: res.errors.length ? 'error' : 'done',
          message: [counts.join('・'), ...res.errors.map((e) => `⚠ ${e}`)].filter(Boolean).join(' / '),
        })
      } catch (e) {
        set(r.id, { state: 'error', message: `⚠ ${(e as Error).message}` })
      }
    }
    setRunning(false)
  }

  if (!client) return <p className="text-slate-500">読み込み中…</p>

  return (
    <div className="space-y-6">
      <div>
        <Link to={`/admin/clients/${client.id}`} className="text-sm text-slate-500 hover:underline">
          ← {client.name}
        </Link>
        <h1 className="mt-1 text-xl font-bold text-slate-900">過去分のまとめて取込</h1>
        <p className="mt-1 text-sm text-slate-600">
          まだ数値の入っていないレポートを、新しい月から順に取り込みます（1か月あたり3〜4分）。取込中は、このページとChromeを閉じないでください。
        </p>
      </div>

      {extVersion === null ? (
        <p className="text-sm text-rose-700">
          拡張機能が見つかりません。{client.name}のSNSにログインしているChromeプロファイルで、拡張機能「SNSインサイト取込」を有効にしてからこのページを開き直してください。
        </p>
      ) : (
        <p className="text-sm text-slate-600">拡張機能 v{extVersion} を検出しました。</p>
      )}

      <div className="flex flex-wrap items-center gap-4">
        <button
          onClick={run}
          disabled={!extVersion || running || pending.length === 0}
          className="rounded-md bg-indigo-700 px-4 py-2 text-sm text-white disabled:opacity-40"
        >
          {pending.length}か月分の取込を開始
        </button>
        {running && (
          <button onClick={() => (stopRef.current = true)} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm">
            この月が終わったら止める
          </button>
        )}
        <label className="flex items-center gap-1.5 text-sm text-slate-700">
          <input type="checkbox" checked={withMatch} onChange={(e) => setWithMatch(e.target.checked)} disabled={running} />
          取込後にAIで同じ動画を紐付ける
        </label>
      </div>

      <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
        {[...reports]
          .sort((a, b) => b.periodStart.localeCompare(a.periodStart))
          .map((r) => {
            const s = status[r.id]
            const badge = s
              ? { waiting: '待機', running: '取込中', done: '完了', error: '要確認' }[s.state]
              : hasData(r)
                ? '取込済'
                : '未取込'
            const color =
              s?.state === 'running'
                ? 'bg-indigo-100 text-indigo-800'
                : s?.state === 'error'
                  ? 'bg-amber-100 text-amber-800'
                  : s?.state === 'done' || hasData(r)
                    ? 'bg-emerald-100 text-emerald-800'
                    : 'bg-slate-100 text-slate-600'
            return (
              <li key={r.id} className="flex items-start justify-between gap-4 px-4 py-3">
                <div>
                  <Link to={`/admin/clients/${client.id}/reports/${r.id}`} className="text-slate-900 hover:underline">
                    {r.label}
                  </Link>
                  <span className="ml-2 text-sm text-slate-500">
                    {r.periodStart} 〜 {r.periodEnd}
                  </span>
                  {s?.message && <div className="mt-0.5 text-xs text-slate-500">{s.message}</div>}
                </div>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${color}`}>{badge}</span>
              </li>
            )
          })}
      </ul>

      {!running && Object.values(status).some((s) => s.state === 'done' || s.state === 'error') && (
        <p className="text-sm text-slate-600">
          取り込んだ月は「下書き」のままです。各月を開いて内容を確認し、「公開する」を押してください（考察が必要な月は「AIで下書きを作成」も）。
        </p>
      )}
    </div>
  )
}
