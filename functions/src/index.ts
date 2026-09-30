import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { defineSecret } from 'firebase-functions/params'
import { onDocumentCreated } from 'firebase-functions/v2/firestore'
import { z } from 'zod'

initializeApp()
const db = getFirestore()

const ANTHROPIC_API_KEY = defineSecret('ANTHROPIC_API_KEY')

/** web/src/firebase.ts と firestore.rules の管理者と揃えること */
const ADMIN_EMAILS = ['yabu@snstake1.com']

const MODEL = 'claude-opus-5-5'

const InsightSchema = z.object({
  summary: z.string().describe('今月の総評。3〜5文'),
  comparison: z.string().describe('先月との比較。主要指標の増減を数値つきで、SNSごとに'),
  goodPoints: z.string().describe('良かった点。箇条書き（行頭「・」）3〜5項目'),
  issues: z.string().describe('来月の課題。箇条書き（行頭「・」）3項目前後'),
  proposals: z.string().describe('来月の具体的な提案。箇条書き（行頭「・」）4〜6項目'),
})

const SYSTEM = `あなたは中小企業のSNS運用を支援するコンサルタントです。
Instagram・Facebook・TikTok・YouTubeショートの月次インサイトデータを読み、クライアント（事業者本人）向けの月次レポートの文章を書きます。

書き方:
- 日本語の丁寧語（です・ます）。専門用語は必要なときだけ使い、使うときは短く言い換える。
- 主張には必ずデータの数値を添える。データに無いことは推測で書かない。データが欠けている指標は「取得できていない」と明記する。
- 投稿に触れるときは、タイトルの冒頭20文字程度で特定できるようにする。
- 同じ動画を複数SNSに投稿している場合（groupKey が同じ投稿）は、SNSごとの伸び方の違いに触れる。
- 提案は「来月やること」として具体的に（テーマ、フック、尺、投稿曜日・時間帯、CTA、SNSごとの出し分けなど）。実行できる粒度で書く。
- 「エンゲージメント率」は（いいね＋コメント＋シェア＋保存）÷ビュー。
- フォロワーの「純増」はフォロー数からフォロー解除数を引いた数。`

type Platform = 'instagram' | 'facebook' | 'tiktok' | 'youtube'
interface Post {
  title: string
  description?: string
  publishedAt: string
  type?: string
  groupKey?: string
  metrics: Record<string, number | undefined>
}
interface ReportDoc {
  label: string
  periodStart: string
  periodEnd: string
  platforms: Partial<Record<Platform, { account: Record<string, number | undefined>; posts: Post[] }>>
}

/** モデルに渡す形に絞る（タイトルは短く、指標はそのまま） */
function compact(r: ReportDoc) {
  const platforms: Record<string, unknown> = {}
  for (const [pl, d] of Object.entries(r.platforms ?? {})) {
    if (!d) continue
    platforms[pl] = {
      account: d.account,
      posts: d.posts.map((p) => ({
        title: p.title.slice(0, 60),
        publishedAt: p.publishedAt,
        type: p.type,
        groupKey: p.groupKey,
        ...p.metrics,
      })),
    }
  }
  return { label: r.label, period: `${r.periodStart}〜${r.periodEnd}`, platforms }
}

/** 過去分は推移だけ（アカウント指標のみ） */
function trend(r: ReportDoc) {
  return {
    label: r.label,
    account: Object.fromEntries(Object.entries(r.platforms ?? {}).map(([pl, d]) => [pl, d?.account])),
    postCount: Object.fromEntries(Object.entries(r.platforms ?? {}).map(([pl, d]) => [pl, d?.posts.length ?? 0])),
  }
}

/** 失敗の理由をそのまま管理ページに見せるためのエラー */
class JobError extends Error {}

async function generate(clientId: string, reportId: string) {
  const clientSnap = await db.doc(`clients/${clientId}`).get()
  const snap = await db.collection(`clients/${clientId}/reports`).get()
  const reports = snap.docs.map((d) => ({ id: d.id, ...(d.data() as ReportDoc) }))
  const current = reports.find((r) => r.id === reportId)
  if (!current) throw new JobError('レポートが見つかりません')
  const older = reports
    .filter((r) => r.periodEnd < current.periodStart)
    .sort((a, b) => b.periodEnd.localeCompare(a.periodEnd))
  const previous = older[0]

  const input = {
    client: clientSnap.get('name'),
    current: compact(current),
    previous: previous ? compact(previous) : null,
    history: older.slice(1, 6).map(trend),
  }

  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY.value() })
  try {
    const response = await client.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      output_config: { effort: 'high', format: zodOutputFormat(InsightSchema) },
      system: SYSTEM,
      messages: [
        {
          role: 'user',
          content: `次のデータから、今月（current）のレポート文章を作成してください。previous が先月、history はそれ以前の推移です。\n\n${JSON.stringify(input)}`,
        },
      ],
    })
    if (response.stop_reason === 'refusal') throw new JobError('AIが回答を控えました。内容を確認して手で記入してください')
    if (!response.parsed_output) throw new JobError('AIの出力を読み取れませんでした。もう一度お試しください')
    return response.parsed_output
  } catch (e) {
    if (e instanceof JobError) throw e
    if (e instanceof Anthropic.RateLimitError) throw new JobError('AIの利用上限に達しました。少し待ってから再実行してください')
    if (e instanceof Anthropic.AuthenticationError) throw new JobError('Claude APIキーが無効です')
    if (e instanceof Anthropic.APIError) throw new JobError(`Claude API エラー (${e.status}): ${e.message}`)
    throw e
  }
}

const MatchSchema = z.object({
  groups: z
    .array(z.array(z.string()).describe('同じ動画と判断した投稿の id。SNSごとに1つまで、2つ以上'))
    .describe('同じ動画のグループの一覧'),
})

const MATCH_SYSTEM = `同じ動画を Instagram・Facebook・TikTok・YouTubeショートに横展開している事業者の投稿一覧から、同じ動画の投稿をまとめます。

判断のしかた:
- YouTube は短いタイトルが別に付いているが、description（説明文）は Instagram・TikTok のキャプションと同じことが多い。description があればそれを優先して比べる。
- それ以外でもSNSによって書き方が違うことがある。文字の一致ではなく、扱っているテーマ・場面・固有名詞（場所、人名、馬術の用語）が同じかで判断する。
- 公開日は同じ日が多いが、最大2週間ほどずれることがある。
- InstagramとFacebookは同じ説明文で同時に投稿されることが多い。
- 1つのグループに同じSNSの投稿は1つまで。確信が持てない投稿はどのグループにも入れない。
- 写真やキャンペーン告知など、動画でなさそうな投稿も、他SNSに同じ内容があれば同じグループにしてよい。`

async function match(clientId: string, reportId: string) {
  const snap = await db.doc(`clients/${clientId}/reports/${reportId}`).get()
  const report = snap.data() as ReportDoc | undefined
  if (!report) throw new JobError('レポートが見つかりません')
  const posts = Object.entries(report.platforms ?? {}).flatMap(([pl, d]) =>
    (d?.posts ?? []).map((p) => ({ id: (p as Post & { id: string }).id, platform: pl, date: p.publishedAt.slice(0, 10), title: p.title.slice(0, 160), ...(p.description ? { description: p.description.slice(0, 200) } : {}) })),
  )
  if (posts.length < 2) return { groups: [] as string[][] }

  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY.value() })
  try {
    const response = await client.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      output_config: { effort: 'medium', format: zodOutputFormat(MatchSchema) },
      system: MATCH_SYSTEM,
      messages: [{ role: 'user', content: `投稿一覧:\n${JSON.stringify(posts)}` }],
    })
    if (response.stop_reason === 'refusal') throw new JobError('AIが回答を控えました。手で紐付けてください')
    if (!response.parsed_output) throw new JobError('AIの出力を読み取れませんでした。もう一度お試しください')
    // 念のため：存在しない id を除き、同じSNSが重複したグループは先頭だけ残す
    const byId = new Map(posts.map((p) => [p.id, p]))
    const used = new Set<string>()
    const groups = response.parsed_output.groups
      .map((g) => {
        const seen = new Set<string>()
        return g.filter((id) => {
          const p = byId.get(id)
          if (!p || used.has(id) || seen.has(p.platform)) return false
          seen.add(p.platform)
          used.add(id)
          return true
        })
      })
      .filter((g) => g.length >= 2)
    return { groups }
  } catch (e) {
    if (e instanceof JobError) throw e
    if (e instanceof Anthropic.RateLimitError) throw new JobError('AIの利用上限に達しました。少し待ってから再実行してください')
    if (e instanceof Anthropic.AuthenticationError) throw new JobError('Claude APIキーが無効です')
    if (e instanceof Anthropic.APIError) throw new JobError(`Claude API エラー (${e.status}): ${e.message}`)
    throw e
  }
}

/*
 * 管理ページが clients/{clientId}/reports/{reportId}/jobs/{jobId} に { type: 'insight' | 'match' } を作ると動き、
 * 結果を同じドキュメントに書き戻す。作成できるのは firestore.rules で管理者だけ。
 * （組織ポリシーで Cloud Run を「誰でも呼び出し可」にできないため、HTTPS 呼び出しではなくこの形にしている）
 */
export const generateInsight = onDocumentCreated(
  {
    document: 'clients/{clientId}/reports/{reportId}/jobs/{jobId}',
    region: 'asia-northeast1',
    // イベント起動の関数の上限。Opus 5.5 の考察生成は数分かかることがある
    timeoutSeconds: 540,
    memory: '512MiB',
    secrets: [ANTHROPIC_API_KEY],
  },
  async (event) => {
    const ref = event.data?.ref
    const type = event.data?.get('type')
    if (!ref || (type !== 'insight' && type !== 'match')) return
    const requestedBy = event.data!.get('requestedBy') as string | undefined
    if (!requestedBy || !ADMIN_EMAILS.includes(requestedBy)) {
      await ref.update({ status: 'error', message: '管理者のみ実行できます' })
      return
    }
    await ref.update({ status: 'running' })
    try {
      const { clientId, reportId } = event.params
      const result = type === 'match' ? { groups: (await match(clientId, reportId)).groups.map((ids) => ({ ids })) } : { insight: await generate(clientId, reportId) }
      await ref.update({ status: 'done', ...result, finishedAt: new Date().toISOString() })
    } catch (e) {
      console.error(e)
      const message = e instanceof JobError ? e.message : `予期しないエラー: ${(e as Error).message}`
      await ref.update({ status: 'error', message, finishedAt: new Date().toISOString() })
    }
  },
)
