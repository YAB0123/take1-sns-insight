/*
 * 開発用のデモ（npm run dev のときだけ /demo で表示。本番ビルドには含まれない）。
 * 過去分はスプレッドシートの実データ、2026年8月度は 2026-09-29 の調査で各管理画面から読んだ実数値。
 * TikTok・YouTube・Facebook の投稿は一部のみ。考察文は見た目確認用のサンプル。
 */
import { useSearchParams } from 'react-router-dom'
import { ReportView } from '../components/ReportView'
import { autoGroup } from '../lib/matching'
import type { Post, Report } from '../types'
import sheet from './sheet-reports.json'

const base = (sheet as Omit<Report, 'id' | 'clientId' | 'urls' | 'insight' | 'status' | 'updatedAt'>[]).map(
  (r): Report => ({
    ...r,
    id: r.periodStart,
    clientId: 'demo',
    urls: {},
    insight: { summary: '', comparison: '', goodPoints: '', issues: '', proposals: '' },
    status: 'published',
    updatedAt: '',
  }),
)

const tt = (id: string, date: string, title: string, views: number, likes: number, comments: number, extra: Post['metrics'] = {}): Post => ({
  id: `tt-${id}`,
  platform: 'tiktok',
  title,
  publishedAt: `${date}T20:10:00+09:00`,
  type: '動画',
  metrics: { views, likes, comments, ...extra },
})

const aug = base.find((r) => r.periodStart === '2026-08-16')!
aug.platforms.instagram!.account = {
  ...aug.platforms.instagram!.account,
  followers: 6958,
  netFollowers: 195,
  views: 186491,
  reach: 45000,
  interactions: 9253,
  profileViews: 2993,
  linkClicks: 186,
}
aug.platforms.facebook = {
  account: { followers: 3132, netFollowers: 78, views: 58390, reach: 20000, interactions: 1876, profileViews: 1242, linkClicks: 66 },
  posts: [
    { id: 'fb1', platform: 'facebook', title: '馬が勝手に曲がってしまう…それ、馬がサボっているわけではありません！', publishedAt: '2026-09-13T20:10:00+09:00', type: 'リール', metrics: { views: 8607, reach: 7567, likes: 277, shares: 3, comments: 1, follows: 0, avgWatchSec: 23 } },
    { id: 'fb2', platform: 'facebook', title: '運動音痴だから…と乗馬を諦めていませんか！？理由を聞けば納得です', publishedAt: '2026-09-09T20:10:00+09:00', type: 'リール', metrics: { views: 4934, reach: 4391, likes: 168, shares: 3, comments: 2 } },
    { id: 'fb3', platform: 'facebook', title: '脚がバタバタ揺れてしまう方必見！落ちまいと足で馬を強く挟むのは逆効果', publishedAt: '2026-08-31T20:10:00+09:00', type: 'リール', metrics: { views: 8319, reach: 7069, likes: 232, shares: 0, comments: 3 } },
    { id: 'fb4', platform: 'facebook', title: 'そのお手入れ、馬に嫌がられていませんか！？馬のしっぽのブラシがけ', publishedAt: '2026-08-26T20:11:00+09:00', type: 'リール', metrics: { views: 5196, reach: 4487, likes: 167, shares: 1, comments: 4 } },
  ],
}
aug.platforms.tiktok = {
  account: { followers: 1800, netFollowers: 50, views: 46000, profileViews: 646, likes: 1751, comments: 86, shares: 75 },
  posts: [
    tt('1', '2026-09-13', '馬が勝手に曲がってしまう…それ、馬がサボっているわけではありません！', 3992, 174, 1),
    tt('2', '2026-09-09', '運動音痴だから…と乗馬を諦めていませんか！？理由を聞けば納得です！', 1978, 112, 3),
    tt('3', '2026-09-04', '馬が“急に止まる”前兆、体のどこに出る？', 3275, 168, 1),
    tt('4', '2026-08-31', '脚がバタバタ揺れてしまう方必見！落ちまいと足で馬を強く挟むのは逆効果', 3422, 178, 5, { shares: 1, saves: 54, avgWatchSec: 23.62, completionRate: 10.6, follows: 7, watchHours: 24.2 }),
    tt('5', '2026-08-26', 'そのお手入れ、馬に嫌がられていませんか！？馬のしっぽのブラシがけ、上から…', 2484, 136, 10),
    tt('6', '2026-08-24', '夏！海！馬ーーーッ！？なんとスミオさん、淡路島のハーモニーワールドで…', 3125, 183, 15),
    tt('7', '2026-08-22', 'まだ手綱をガチャガチャ引っ張って調整していませんか！？障害の手前で…', 3253, 143, 7),
  ],
}
aug.platforms.youtube = {
  account: { followers: 6384, netFollowers: 166, views: 156630, watchHours: 2054.5, likes: 3651, comments: 32, shares: 249 },
  posts: [
    { id: 'yt1', platform: 'youtube', title: 'なぜスミオさんの脚は動かない？『足バタバタ』を劇的に止める秘密', publishedAt: '2026-08-31T00:00:00+09:00', type: 'ショート', metrics: { views: 8961, impressions: 19116, ctr: 10.7, avgWatchSec: 84, watchHours: 95.6, likes: 327, comments: 1, shares: 22, follows: 2 } },
    { id: 'yt2', platform: 'youtube', title: '馬が“急に止まる”前兆、体のどこに出る？', publishedAt: '2026-09-04T00:00:00+09:00', type: 'ショート', metrics: { views: 5437, impressions: 12987, ctr: 9.0, avgWatchSec: 78, watchHours: 52.6, likes: 180, comments: 2, shares: 9, follows: 5 } },
  ],
}
aug.insight = {
  summary: '（見た目確認用のサンプル文です）今月はInstagramの閲覧数が18.6万回、フォロワー純増は195人でした。',
  comparison: '・Instagram：フォロワー純増 337人 → 195人\n・投稿数は同じ7本',
  goodPoints: '・「夏！海！馬ーーーッ！？」が2.1万ビュー\n・保存率の高い解説系が安定',
  issues: '・新規フォロワーの伸びが鈍化\n・TikTokとYouTubeの導線が弱い',
  proposals: '・冒頭2秒で結論を見せるフックに統一\n・木曜・日曜20時台の投稿を継続\n・プロフィールリンクの体験予約導線を強化',
}

const reports = base.map((r) => (r.id === aug.id ? autoGroup(aug) : r)).sort((a, b) => b.periodStart.localeCompare(a.periodStart))

export function DemoPage() {
  const [params, setParams] = useSearchParams()
  const current = reports.find((r) => r.id === params.get('r')) ?? reports[0]
  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <ReportView
        key={current.id}
        report={current}
        reports={reports}
        clientName="岡山乗馬倶楽部（デモ）"
        headerRight={
          <select value={current.id} onChange={(e) => setParams({ r: e.target.value })} className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm">
            {reports.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
        }
      />
    </main>
  )
}
