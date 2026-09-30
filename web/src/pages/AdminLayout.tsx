import { onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth'
import { useEffect, useState } from 'react'
import { Link, Outlet } from 'react-router-dom'
import { ADMIN_EMAILS, auth, googleProvider } from '../firebase'

export function AdminLayout() {
  const [user, setUser] = useState<User | null | undefined>(undefined)
  useEffect(() => onAuthStateChanged(auth, setUser), [])

  if (user === undefined) return <p className="p-8 text-slate-500">読み込み中…</p>

  if (!user || !ADMIN_EMAILS.includes(user.email ?? '')) {
    return (
      <main className="mx-auto mt-24 max-w-sm space-y-4 text-center">
        <h1 className="text-xl font-bold text-slate-900">SNSインサイト 管理ページ</h1>
        {user && <p className="text-sm text-rose-700">{user.email} には管理権限がありません。</p>}
        <button
          onClick={() => (user ? signOut(auth) : signInWithPopup(auth, googleProvider))}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-700"
        >
          {user ? 'ログアウト' : 'Googleでログイン'}
        </button>
      </main>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white print:hidden">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <Link to="/admin" className="font-semibold text-slate-900">
            SNSインサイト 管理
          </Link>
          <div className="flex items-center gap-3 text-sm text-slate-500">
            {user.email}
            <button onClick={() => signOut(auth)} className="text-slate-700 hover:underline">
              ログアウト
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  )
}
