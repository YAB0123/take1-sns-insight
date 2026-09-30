import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { createClient, listClients } from '../lib/db'
import type { Client } from '../types'

export function AdminHome() {
  const [clients, setClients] = useState<Client[]>()
  const [name, setName] = useState('')

  useEffect(() => {
    listClients().then(setClients)
  }, [])

  async function add() {
    if (!name.trim()) return
    const c = await createClient(name.trim())
    setClients((cs) => [...(cs ?? []), c])
    setName('')
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-slate-900">クライアント</h1>
      <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
        {clients?.map((c) => (
          <li key={c.id}>
            <Link to={`/admin/clients/${c.id}`} className="block px-4 py-3 hover:bg-slate-50">
              {c.name}
            </Link>
          </li>
        ))}
        {clients?.length === 0 && <li className="px-4 py-3 text-sm text-slate-500">まだ登録がありません。</li>}
        {!clients && <li className="px-4 py-3 text-sm text-slate-500">読み込み中…</li>}
      </ul>
      <div className="flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
          placeholder="クライアント名（例: 岡山乗馬倶楽部）"
          className="w-80 rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
        <button onClick={add} className="rounded-md bg-slate-900 px-4 py-2 text-sm text-white hover:bg-slate-700">
          追加
        </button>
      </div>
    </div>
  )
}
