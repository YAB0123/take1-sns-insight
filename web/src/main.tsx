import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import './index.css'

// クライアント用ページで管理画面のコードを読み込まないよう、ページ単位で分割する
const PublicReport = lazy(() => import('./pages/PublicReport').then((m) => ({ default: m.PublicReport })))
const AdminLayout = lazy(() => import('./pages/AdminLayout').then((m) => ({ default: m.AdminLayout })))
const AdminHome = lazy(() => import('./pages/AdminHome').then((m) => ({ default: m.AdminHome })))
const AdminClient = lazy(() => import('./pages/AdminClient').then((m) => ({ default: m.AdminClient })))
const ReportEditor = lazy(() => import('./pages/ReportEditor').then((m) => ({ default: m.ReportEditor })))
// 開発用デモ。本番ビルドでは import.meta.env.DEV が false になり丸ごと消える
const DemoPage = import.meta.env.DEV ? lazy(() => import('./dev/DemoPage').then((m) => ({ default: m.DemoPage }))) : null

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Suspense fallback={<p className="p-8 text-slate-500">読み込み中…</p>}>
        <Routes>
          <Route path="/r/:token" element={<PublicReport />} />
          <Route path="/admin" element={<AdminLayout />}>
            <Route index element={<AdminHome />} />
            <Route path="clients/:clientId" element={<AdminClient />} />
            <Route path="clients/:clientId/reports/:reportId" element={<ReportEditor />} />
          </Route>
          {DemoPage && <Route path="/demo" element={<DemoPage />} />}
          <Route path="*" element={<Navigate to="/admin" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  </StrictMode>,
)
