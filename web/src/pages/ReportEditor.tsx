import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ReportView } from '../components/ReportView'
import { auth } from '../firebase'
import { collect, pingExtension } from '../lib/extension'
import { applyGroups, MatchEditor } from '../components/MatchEditor'
import { deleteReport, getClient, listReports, publishReport, requestInsight, requestMatch, saveReport, unpublishReport } from '../lib/db'
import { mergeCollected } from '../lib/merge'
import { buildUrls } from '../lib/urls'
import type { AccountMetrics, Client, Insight, Platform, Report } from '../types'
import { PLATFORMS, PLATFORM_LABEL } from '../types'
import { shareUrl } from './AdminClient'

const INSIGHT_FIELDS: { key: keyof Insight; label: string; rows: number }[] = [
  { key: 'summary', label: '今月の総評', rows: 4 },
  { key: 'comparison', label: '先月との比較', rows: 5 },
  { key: 'goodPoints', label: '良かった点', rows: 4 },
  { key: 'issues', label: '来月の課題', rows: 4 },
  { key: 'proposals', label: '来月の提案', rows: 6 },
]

const ACCOUNT_FIELDS: { key: keyof AccountMetrics; label: string }[] = [
  { key: 'followers', label: 'フォロワー数' },
  { key: 'netFollowers', label: '新規フォロワー（純増）' },
  { key: 'views', label: 'ビュー' },
  { key: 'reach', label: 'リーチ' },
  { key: 'profileViews', label: 'プロフィール表示' },
]

/** 拡張が扱う取込対象。Meta の URL 1本で Instagram と Facebook の両方を取る */
function targetsFor(r: Report): Platform[] {
  return PLATFORMS.filter((pl) => (pl === 'instagram' || pl === 'facebook' ? !!r.urls.meta : !!r.urls[pl]))
}

export function ReportEditor() {
  const { clientId = '', reportId = '' } = useParams()
  const navigate = useNavigate()
  const [client, setClient] = useState<Client>()
  const [report, setReport] = useState<Report>()
  const [all, setAll] = useState<Report[]>([])
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState<string>()
  const [log, setLog] = useState<string[]>([])
  const [extVersion, setExtVersion] = useState<string | null>(null)
  const [targets, setTargets] = useState<Platform[]>([])
  const [preview, setPreview] = useState(false)
  const [keepSheetPosts, setKeepSheetPosts] = useState(true)

  useEffect(() => {
    getClient(clientId).then(setClient)
    listReports(clientId).then((rs) => {
      setAll(rs)
      const r = rs.find((x) => x.id === reportId)
      setReport(r)
      if (r) setTargets(targetsFor(r))
    })
    pingExtension().then((v) => setExtVersion(v ?? null))
  }, [clientId, reportId])

  if (!client || !report) return <p className="text-slate-500">読み込み中…</p>

  const hasSheetPosts = !!report.platforms.instagram?.posts.some((p) => p.id.startsWith('sheet-'))

  const update = (patch: Partial<Report>) => {
    setReport({ ...report, ...patch })
    setDirty(true)
  }

  async function save(r: Report = report!) {
    setBusy('保存中…')
    await saveReport(r)
    setAll((xs) => xs.map((x) => (x.id === r.id ? r : x)))
    setDirty(false)
    setBusy(undefined)
  }

  async function runCollect() {
    setBusy('取込中…')
    setLog([])
    const res = await collect(
      { urls: report!.urls, periodStart: report!.periodStart, periodEnd: report!.periodEnd, targets },
      (m) => setLog((l) => [...l, m]),
    )
    const next = mergeCollected(report!, res, all, { keepSheetPosts })
    setLog((l) => [...l, ...res.errors.map((e) => `⚠ ${e}`), '取込が終わりました。内容を確認して保存してください。'])
    setReport(next)
    setDirty(true)
    setBusy(undefined)
  }

  async function generate() {
    if (dirty) await save()
    setBusy('AIに依頼しています…')
    try {
      const insight = await requestInsight(report!, auth.currentUser?.email ?? '', setBusy)
      update({ insight })
    } catch (e) {
      alert(`AI下書きの作成に失敗しました: ${(e as Error).message}`)
    } finally {
      setBusy(undefined)
    }
  }

  async function suggestMatch() {
    if (!confirm('AIに同じ動画の紐付けを提案させます。今の紐付けは置き換わります。よろしいですか？')) return
    if (dirty) await save()
    setBusy('AIに依頼しています…')
    try {
      const groups = await requestMatch(report!, auth.currentUser?.email ?? '', setBusy)
      update({ platforms: applyGroups(report!.platforms, groups) })
    } catch (e) {
      alert(`紐付けの提案に失敗しました: ${(e as Error).message}`)
    } finally {
      setBusy(undefined)
    }
  }

  async function setPublished(publish: boolean) {
    setBusy('処理中…')
    let r: Report
    if (publish) {
      r = await publishReport(client!, report!)
    } else {
      await unpublishReport(client!, report!)
      r = { ...report!, status: 'draft' }
    }
    setDirty(false)
    setReport(r)
    setAll((xs) => xs.map((x) => (x.id === r.id ? r : x)))
    setBusy(undefined)
  }

  function setAccount(pl: Platform, key: keyof AccountMetrics, value: string) {
    const d = report!.platforms[pl] ?? { account: {}, posts: [] }
    const n = value === '' ? undefined : Number(value.replaceAll(',', ''))
    update({ platforms: { ...report!.platforms, [pl]: { ...d, account: { ...d.account, [key]: n } } } })
  }

  const collected = PLATFORMS.filter((pl) => report.platforms[pl])

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link to={`/admin/clients/${client.id}`} className="text-sm text-slate-500 hover:underline">
            ← {client.name}
          </Link>
          <div className="mt-1 flex items-center gap-3">
            <input
              value={report.label}
              onChange={(e) => update({ label: e.target.value })}
              className="rounded-md border border-transparent px-1 text-xl font-bold text-slate-900 hover:border-slate-300"
            />
            <span className={`rounded-full px-2 py-0.5 text-xs ${report.status === 'published' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-700'}`}>
              {report.status === 'published' ? '公開中' : '下書き'}
            </span>
          </div>
          <p className="text-sm text-slate-500">
            {report.periodStart} 〜 {report.periodEnd}
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setPreview((p) => !p)} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm">
            {preview ? '編集に戻る' : 'クライアント表示でプレビュー'}
          </button>
          <button onClick={() => save()} disabled={!dirty || !!busy} className="rounded-md bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-40">
            保存
          </button>
          <button onClick={() => setPublished(true)} disabled={!!busy} className="rounded-md bg-emerald-700 px-4 py-2 text-sm text-white disabled:opacity-40">
            {report.status === 'published' ? '公開内容を更新' : '公開する'}
          </button>
          {report.status === 'published' && (
            <button onClick={() => setPublished(false)} disabled={!!busy} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm disabled:opacity-40">
              公開を取り消す
            </button>
          )}
        </div>
      </div>

      {busy && <div className="rounded-md bg-indigo-50 px-4 py-2 text-sm text-indigo-800">{busy}</div>}
      {report.status === 'published' && (
        <p className="text-sm text-slate-600">
          公開先:{' '}
          <a className="text-indigo-700 hover:underline" href={`${shareUrl(client)}?r=${report.id}`} target="_blank" rel="noreferrer">
            {shareUrl(client)}?r={report.id}
          </a>
          （修正後は「公開内容を更新」を押すと反映されます）
        </p>
      )}

      {preview ? (
        <div className="rounded-lg bg-white p-6 shadow-sm">
          <ReportView report={report} reports={all.map((x) => (x.id === report.id ? report : x))} clientName={client.name} />
        </div>
      ) : (
        <>
          <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-5">
            <h2 className="font-semibold text-slate-800">1. 数値の取込（Chrome拡張）</h2>
            {client.ids?.metaAssetId && (!report.urls.meta || !report.urls.tiktok || (client.ids.youtubeChannelId && !report.urls.youtube)) && (
              <div className="flex items-center gap-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
                このレポートには取込用のURLがありません（過去データから作った月など）。
                <button
                  onClick={() => {
                    const urls = { ...buildUrls(client.ids, report.periodStart, report.periodEnd), ...report.urls }
                    const next = { ...report, urls }
                    setReport(next)
                    setTargets(targetsFor(next))
                    setDirty(true)
                  }}
                  className="rounded border border-amber-300 bg-white px-2 py-1 text-xs"
                >
                  期間からURLを自動生成
                </button>
              </div>
            )}
            {extVersion === null ? (
              <p className="text-sm text-rose-700">
                拡張機能が見つかりません。{client.name}のSNSにログインしているChromeプロファイルで、拡張機能「SNSインサイト取込」を有効にしてからこのページを開き直してください。
              </p>
            ) : (
              <p className="text-sm text-slate-600">拡張機能 v{extVersion} を検出しました。取込中はタブが自動で開閉します。</p>
            )}
            <div className="flex flex-wrap gap-4">
              {PLATFORMS.map((pl) => (
                <label key={pl} className="flex items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    checked={targets.includes(pl)}
                    disabled={!targetsFor(report).includes(pl)}
                    onChange={(e) => setTargets((t) => (e.target.checked ? [...t, pl] : t.filter((x) => x !== pl)))}
                  />
                  {PLATFORM_LABEL[pl]}
                  {report.platforms[pl] && <span className="text-xs text-emerald-700">（取込済 {report.platforms[pl]!.posts.length}件）</span>}
                </label>
              ))}
            </div>
            {hasSheetPosts && targets.includes('instagram') && (
              <label className="flex items-center gap-1.5 text-sm text-slate-700">
                <input type="checkbox" checked={keepSheetPosts} onChange={(e) => setKeepSheetPosts(e.target.checked)} />
                Instagramの投稿は過去シートの値（当時の記録）を残し、期間の数値（閲覧数・純増など）だけ取り込む
              </label>
            )}
            <button
              onClick={runCollect}
              disabled={!extVersion || !!busy || targets.length === 0}
              className="rounded-md bg-indigo-700 px-4 py-2 text-sm text-white disabled:opacity-40"
            >
              取込開始
            </button>
            {log.length > 0 && (
              <pre className="max-h-48 overflow-auto rounded-md bg-slate-900 p-3 text-xs whitespace-pre-wrap text-slate-100">{log.join('\n')}</pre>
            )}
          </section>

          {collected.length > 0 && (
            <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-5">
              <h2 className="font-semibold text-slate-800">2. アカウント数値の確認・修正</h2>
              <p className="text-xs text-slate-500">取込できなかった値や、画面と違う値はここで直せます（空欄は「—」表示）。</p>
              <div className="overflow-x-auto">
                <table className="text-sm">
                  <thead>
                    <tr className="text-slate-500">
                      <th className="px-2 py-1 text-left font-medium" />
                      {collected.map((pl) => (
                        <th key={pl} className="px-2 py-1 text-left font-medium">
                          {PLATFORM_LABEL[pl]}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {ACCOUNT_FIELDS.map((f) => (
                      <tr key={f.key}>
                        <td className="px-2 py-1 whitespace-nowrap text-slate-600">{f.label}</td>
                        {collected.map((pl) => (
                          <td key={pl} className="px-2 py-1">
                            <input
                              inputMode="numeric"
                              value={report.platforms[pl]?.account[f.key] ?? ''}
                              onChange={(e) => setAccount(pl, f.key, e.target.value)}
                              className="w-28 rounded border border-slate-300 px-2 py-1 text-right tabular-nums"
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {collected.length > 0 && (
            <MatchEditor report={report} busy={!!busy} onSuggest={suggestMatch} onChange={(platforms) => update({ platforms })} />
          )}

          <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-5">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-slate-800">3. インサイト考察・来月の提案</h2>
              <button onClick={generate} disabled={!!busy || collected.length === 0} className="rounded-md bg-violet-700 px-4 py-2 text-sm text-white disabled:opacity-40">
                AIで下書きを作成
              </button>
            </div>
            <p className="text-xs text-slate-500">AIの下書きは上書きされます。修正したら「保存」を押してください。</p>
            {INSIGHT_FIELDS.map((f) => (
              <label key={f.key} className="block space-y-1">
                <span className="text-sm font-medium text-slate-700">{f.label}</span>
                <textarea
                  rows={f.rows}
                  value={report.insight[f.key]}
                  onChange={(e) => update({ insight: { ...report.insight, [f.key]: e.target.value } })}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm leading-relaxed"
                />
              </label>
            ))}
          </section>

          <div className="text-right">
            <button
              onClick={async () => {
                if (!confirm(`${report.label} を削除します。元に戻せません。よろしいですか？`)) return
                await deleteReport(client, report.id)
                navigate(`/admin/clients/${client.id}`)
              }}
              className="text-sm text-rose-700 hover:underline"
            >
              このレポートを削除
            </button>
          </div>
        </>
      )}
    </div>
  )
}
