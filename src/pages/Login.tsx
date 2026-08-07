import { useState } from 'react'
import { useApp } from '@/store/AppStore'
import { hasSupabase } from '@/lib/supabase'
import { Campo, useAutoFocus } from '@/components/ui'
import { cn } from '@/lib/utils'

type Modo = 'entrar' | 'registro' | 'recuperar'

export function Login() {
  const { entrar, registrar, recuperar, entrarComoDemo } = useApp()
  const [modo, setModo] = useState<Modo>('entrar')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [nombre, setNombre] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [cargando, setCargando] = useState(false)
  const refEmail = useAutoFocus<HTMLInputElement>()

  async function enviar(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setOk(null)
    setCargando(true)
    try {
      if (modo === 'entrar') {
        const r = await entrar(email.trim(), password)
        if (r.error) setError(r.error)
      } else if (modo === 'registro') {
        const r = await registrar(email.trim(), password, nombre.trim() || 'Opositor')
        if (r.error) setError(r.error)
        else setOk('Cuenta creada. Revisa tu correo si te pedimos confirmación y luego entra.')
      } else {
        const r = await recuperar(email.trim())
        if (r.error) setError(r.error)
        else setOk('Te hemos enviado un enlace para restablecer la contraseña.')
      }
    } finally {
      setCargando(false)
    }
  }

  return (
    <div className="flex min-h-screen">
      {/* Columna izquierda: relato de producto. Se oculta en móvil. */}
      <div className="relative hidden w-[46%] flex-col justify-between overflow-hidden bg-sage-700 p-12 lg:flex">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.14]"
          style={{
            backgroundImage:
              'radial-gradient(circle at 80% 15%, #DFE8E1 0%, transparent 45%), radial-gradient(circle at 15% 85%, #F5EACB 0%, transparent 40%)',
          }}
        />
        <div className="relative">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-sage-50/15">
              <svg viewBox="0 0 32 32" className="h-5 w-5">
                <path
                  d="M10 22V10.5c0-.3.35-.46.58-.27L21.4 19.6c.24.2.6.03.6-.28V10"
                  fill="none"
                  stroke="#DFE8E1"
                  strokeWidth="2.6"
                  strokeLinecap="round"
                />
              </svg>
            </div>
            <div>
              <p className="font-serif text-[19px] leading-none text-sage-50">Cante</p>
              <p className="mt-1 text-[10.5px] font-medium uppercase tracking-[0.14em] text-sage-200">
                Oposición a Notarías
              </p>
            </div>
          </div>
        </div>

        <div className="relative max-w-md">
          <h1 className="font-serif text-[40px] leading-[1.1] text-sage-50">
            328 temas.
            <br />
            Un solo sistema.
          </h1>
          <p className="mt-5 text-[15px] leading-relaxed text-sage-100/85">
            Cronometra tus cantes, grábalos, deja que el sistema de vueltas decida qué toca hoy y
            mira por primera vez tu oposición en números.
          </p>
          <div className="mt-9 grid grid-cols-2 gap-x-6 gap-y-5">
            {[
              ['Cante cronometrado', 'con nota automática por tiempo y contenido'],
              ['Repaso por vueltas', 'no flashcards: temas enteros'],
              ['Bombo virtual', 'simulacros del ejercicio real'],
              ['Métricas de verdad', 'horas netas, arrastre, oxidación'],
            ].map(([t, d]) => (
              <div key={t}>
                <p className="text-[13px] font-semibold text-sage-50">{t}</p>
                <p className="mt-0.5 text-[12px] leading-snug text-sage-200/75">{d}</p>
              </div>
            ))}
          </div>
        </div>

        <p className="relative text-[11.5px] text-sage-200/60">
          Hecho para quien estudia 10 horas al día.
        </p>
      </div>

      {/* Columna derecha: formulario */}
      <div className="flex flex-1 items-center justify-center px-5 py-12">
        <div className="w-full max-w-[380px]">
          <div className="mb-8 lg:hidden">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-sage-700">
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
            <p className="font-serif text-[24px] leading-tight">Cante · Notarías</p>
          </div>

          <h2 className="font-serif text-[27px] leading-tight text-ink-900">
            {modo === 'entrar'
              ? 'Entra a tu oposición'
              : modo === 'registro'
                ? 'Crea tu cuenta'
                : 'Recuperar acceso'}
          </h2>
          <p className="mt-1.5 text-[13.5px] text-ink-500">
            {modo === 'entrar'
              ? 'Tus temas, tus cantes y tu arrastre te esperan.'
              : modo === 'registro'
                ? 'El programa completo viene precargado. Empiezas en 30 segundos.'
                : 'Te mandamos un enlace al correo.'}
          </p>

          {!hasSupabase && (
            <div className="mt-5 rounded-xl border border-gold-200 bg-gold-50 px-3.5 py-3 text-[12.5px] leading-snug text-ink-700">
              <strong className="font-semibold">Sin backend configurado.</strong> Faltan las
              variables <code className="num text-[11.5px]">VITE_SUPABASE_URL</code> y{' '}
              <code className="num text-[11.5px]">VITE_SUPABASE_ANON_KEY</code>. Puedes entrar en
              modo local y todo se guardará en este navegador.
            </div>
          )}

          <form onSubmit={enviar} className="mt-6 space-y-3.5">
            {modo === 'registro' && (
              <Campo label="Nombre">
                <input
                  className="input"
                  value={nombre}
                  onChange={(e) => setNombre(e.target.value)}
                  placeholder="Cómo te llamas"
                  autoComplete="name"
                />
              </Campo>
            )}
            <Campo label="Email">
              <input
                ref={refEmail}
                className="input"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="tu@email.com"
                autoComplete="email"
              />
            </Campo>
            {modo !== 'recuperar' && (
              <Campo label="Contraseña">
                <input
                  className="input"
                  type="password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete={modo === 'entrar' ? 'current-password' : 'new-password'}
                />
              </Campo>
            )}

            {error && (
              <p className="rounded-xl bg-clay-50 px-3.5 py-2.5 text-[12.5px] font-medium text-clay-600">
                {error}
              </p>
            )}
            {ok && (
              <p className="rounded-xl bg-sage-50 px-3.5 py-2.5 text-[12.5px] font-medium text-sage-700">
                {ok}
              </p>
            )}

            <button
              type="submit"
              disabled={cargando || !hasSupabase}
              className={cn('btn-primary w-full', cargando && 'opacity-70')}
            >
              {cargando
                ? 'Un momento…'
                : modo === 'entrar'
                  ? 'Entrar'
                  : modo === 'registro'
                    ? 'Crear cuenta'
                    : 'Enviar enlace'}
            </button>
          </form>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-[12.5px]">
            {modo === 'entrar' ? (
              <>
                <button
                  onClick={() => setModo('registro')}
                  className="font-semibold text-sage-700 hover:underline"
                >
                  Crear una cuenta
                </button>
                <button
                  onClick={() => setModo('recuperar')}
                  className="text-ink-400 hover:text-ink-700"
                >
                  He olvidado la contraseña
                </button>
              </>
            ) : (
              <button
                onClick={() => setModo('entrar')}
                className="font-semibold text-sage-700 hover:underline"
              >
                ← Volver a entrar
              </button>
            )}
          </div>

          <div className="my-7 flex items-center gap-3">
            <div className="h-px flex-1 bg-ink-100" />
            <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-300">
              o
            </span>
            <div className="h-px flex-1 bg-ink-100" />
          </div>

          <button onClick={entrarComoDemo} className="btn-secondary w-full">
            Entrar en modo local (sin cuenta)
          </button>
          <p className="mt-2.5 text-center text-[11.5px] leading-snug text-ink-400">
            Guarda todo en este navegador. Ideal para probar la app; puedes exportar tus datos
            después desde Ajustes.
          </p>
        </div>
      </div>
    </div>
  )
}
