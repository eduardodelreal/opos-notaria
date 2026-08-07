import { Navigate, Route, Routes } from 'react-router-dom'
import { AppProvider, useApp } from '@/store/AppStore'
import { Layout } from '@/components/Layout'
import { Login } from '@/pages/Login'
import { Dashboard } from '@/pages/Dashboard'
import { Cante } from '@/pages/Cante'
import { Temario } from '@/pages/Temario'
import { Calendario } from '@/pages/Calendario'
import { Metricas } from '@/pages/Metricas'
import { Bombo } from '@/pages/Bombo'
import { Ajustes } from '@/pages/Ajustes'


function Cargando() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4">
      <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-sage-700">
        <svg viewBox="0 0 32 32" className="h-6 w-6">
          <path
            d="M10 22V10.5c0-.3.35-.46.58-.27L21.4 19.6c.24.2.6.03.6-.28V10"
            fill="none"
            stroke="#DFE8E1"
            strokeWidth="2.6"
            strokeLinecap="round"
          />
        </svg>
      </div>
      <div className="h-1 w-32 overflow-hidden rounded-full bg-ink-100">
        <div className="h-full w-1/3 animate-pulse rounded-full bg-sage-500" />
      </div>
      <p className="text-[12.5px] text-ink-400">Cargando tu oposición…</p>
    </div>
  )
}

function Rutas() {
  const { cargando, session, modoDemo } = useApp()

  if (cargando) return <Cargando />

  // Sin sesión de Supabase solo se entra si el usuario ha elegido el modo local.
  if (!session && !modoDemo) return <Login />

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/cante" element={<Cante />} />
        <Route path="/temario" element={<Temario />} />
        <Route path="/calendario" element={<Calendario />} />
        <Route path="/metricas" element={<Metricas />} />
        <Route path="/bombo" element={<Bombo />} />
        <Route path="/ajustes" element={<Ajustes />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  )
}

export default function App() {
  return (
    <AppProvider>
      <Rutas />
    </AppProvider>
  )
}
