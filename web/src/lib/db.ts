import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore'
import { db } from '../firebase'
import type { Client, Insight, Report } from '../types'

const clientsCol = collection(db, 'clients')
const reportsCol = (clientId: string) => collection(db, 'clients', clientId, 'reports')

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(18))
  return btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, (c) => ({ '+': '-', '/': '_', '=': '' })[c]!)
}

/** Firestore は undefined を保存できないので落とす */
function clean<T>(v: T): T {
  return JSON.parse(JSON.stringify(v))
}

export async function listClients(): Promise<Client[]> {
  const snap = await getDocs(query(clientsCol, orderBy('createdAt')))
  return snap.docs.map((d) => ({ ...(d.data() as Omit<Client, 'id'>), id: d.id }))
}

export async function getClient(id: string): Promise<Client | undefined> {
  const snap = await getDoc(doc(clientsCol, id))
  return snap.exists() ? { ...(snap.data() as Omit<Client, 'id'>), id: snap.id } : undefined
}

export async function createClient(name: string): Promise<Client> {
  const ref = doc(clientsCol)
  const client: Client = { id: ref.id, name, shareToken: randomToken(), createdAt: new Date().toISOString() }
  const { id: _, ...data } = client
  const batch = writeBatch(db)
  batch.set(ref, data)
  batch.set(doc(db, 'public', client.shareToken), { clientName: name })
  await batch.commit()
  return client
}

export async function updateClient(id: string, patch: Partial<Omit<Client, 'id'>>) {
  await updateDoc(doc(clientsCol, id), clean(patch))
}

export async function listReports(clientId: string): Promise<Report[]> {
  const snap = await getDocs(query(reportsCol(clientId), orderBy('periodStart', 'desc')))
  return snap.docs.map((d) => ({ ...(d.data() as Omit<Report, 'id'>), id: d.id }))
}

export async function getReport(clientId: string, id: string): Promise<Report | undefined> {
  const snap = await getDoc(doc(reportsCol(clientId), id))
  return snap.exists() ? { ...(snap.data() as Omit<Report, 'id'>), id: snap.id } : undefined
}

export function newReportId(clientId: string): string {
  return doc(reportsCol(clientId)).id
}

export async function saveReport(report: Report) {
  const { id, ...data } = report
  await setDoc(doc(reportsCol(report.clientId), id), clean({ ...data, updatedAt: new Date().toISOString() }))
}

export async function deleteReport(client: Client, reportId: string) {
  const batch = writeBatch(db)
  batch.delete(doc(reportsCol(client.id), reportId))
  batch.delete(doc(db, 'public', client.shareToken, 'reports', reportId))
  await batch.commit()
}

/** 公開：クライアント用URLから読める場所にコピーする */
export async function publishReport(client: Client, report: Report) {
  const publishedAt = new Date().toISOString()
  const published: Report = { ...report, status: 'published', publishedAt }
  const { id, ...data } = published
  const batch = writeBatch(db)
  batch.set(doc(reportsCol(client.id), id), clean(data))
  batch.set(doc(db, 'public', client.shareToken), { clientName: client.name })
  batch.set(doc(db, 'public', client.shareToken, 'reports', id), clean(data))
  await batch.commit()
  return published
}

export async function unpublishReport(client: Client, report: Report) {
  const batch = writeBatch(db)
  batch.update(doc(reportsCol(client.id), report.id), { status: 'draft' })
  batch.delete(doc(db, 'public', client.shareToken, 'reports', report.id))
  await batch.commit()
}

/**
 * AIの処理（考察の作成・同じ動画の紐付け）を依頼し、Cloud Functions が結果を書き戻すまで待つ。
 * （組織ポリシーで Functions を直接呼べないため、Firestore の書き込みを合図にしている）
 */
type JobType = 'insight' | 'match'
const JOB_LABEL: Record<JobType, string> = { insight: '考察を作成', match: '同じ動画を判定' }

async function requestJob(
  report: Report,
  email: string,
  type: JobType,
  onStatus: (message: string) => void,
  timeoutMs = 600_000,
): Promise<Record<string, unknown>> {
  const ref = await addDoc(collection(db, 'clients', report.clientId, 'reports', report.id, 'jobs'), {
    type,
    requestedBy: email,
    requestedAt: new Date().toISOString(),
  })
  return new Promise((resolve, reject) => {
    const started = Date.now()
    let running = false
    // 1分たっても処理が始まらなければ、関数が動いていない（権限・デプロイの問題）
    const notStarted = setTimeout(() => {
      if (running) return
      clearTimeout(timer)
      stop()
      reject(new Error('AIの機能が起動しませんでした。管理者にお知らせください（関数の権限・デプロイを確認）'))
    }, 60_000)
    const timer = setTimeout(() => {
      clearTimeout(notStarted)
      stop()
      reject(new Error('時間内に終わりませんでした。少し待ってからもう一度お試しください'))
    }, timeoutMs)
    const stop = onSnapshot(
      ref,
      (snap) => {
        const d = snap.data()
        if (d?.status === 'running' && !running) {
          running = true
          onStatus(`AIが${JOB_LABEL[type]}中…（処理開始まで ${Math.round((Date.now() - started) / 1000)}秒。完了まで数分かかります）`)
        }
        if (d?.status === 'done') {
          clearTimeout(notStarted)
          clearTimeout(timer)
          stop()
          resolve(d)
        } else if (d?.status === 'error') {
          clearTimeout(notStarted)
          clearTimeout(timer)
          stop()
          reject(new Error(d.message))
        }
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      },
    )
  })
}

export async function requestInsight(report: Report, email: string, onStatus: (message: string) => void): Promise<Insight> {
  return (await requestJob(report, email, 'insight', onStatus)).insight as Insight
}

/** 同じ動画と判断した投稿 id のグループ一覧 */
export async function requestMatch(report: Report, email: string, onStatus: (message: string) => void): Promise<string[][]> {
  const groups = (await requestJob(report, email, 'match', onStatus)).groups as { ids: string[] }[]
  return groups.map((g) => g.ids)
}

/* ---------- クライアント用（ログイン不要・トークンで読む） ---------- */

export async function getPublicClientName(token: string): Promise<string | undefined> {
  const snap = await getDoc(doc(db, 'public', token))
  return snap.exists() ? (snap.data().clientName as string) : undefined
}

export async function listPublicReports(token: string): Promise<Report[]> {
  const snap = await getDocs(query(collection(db, 'public', token, 'reports'), orderBy('periodStart', 'desc')))
  return snap.docs.map((d) => ({ ...(d.data() as Omit<Report, 'id'>), id: d.id }))
}
