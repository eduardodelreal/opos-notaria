import { useCallback, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '@/store/AppStore'
import { BLOQUES, BLOQUE_MAP } from '@/data/programa'
import { progresoVacio, riesgo, ESTADOS } from '@/lib/srs'
import { barajar, cn } from '@/lib/utils'
import { hoy } from '@/lib/dates'
import { Card, Chip, Select, Toggle } from '@/components/ui'
import type { BlockId } from '@/lib/types'

/**
 * El bombo de bolas. En el ejercicio real el opositor ve salir las bolas y se le
 * acelera el pulso: reproducirlo en casa es parte del entrenamiento, no un adorno.
 */
export function Bombo() {
  const { data } = useApp()
  const nav = useNavigate()
  const { temas, progreso, ajustes } = data
  const h = hoy()

  const [cuantas, setCuantas] = useState(ajustes.temasPorEjercicio)
  const [bloque, setBloque] = useState<'todos' | BlockId>('todos')
  const [soloTocados, setSoloTocados] = useState(false)
  const [sesgoRiesgo, setSesgoRiesgo] = useState(false)
  const [girando, setGirando] = useState(false)
  const [salidas, setSalidas] = useState<string[]>([])
  const [reveladas, setReveladas] = useState(0)

  const elegibles = useMemo(() => {
    return temas.filter((t) => {
      if (t.excluido) return false
      if (bloque !== 'todos' && t.bloque !== bloque) return false
      if (soloTocados && (progreso[t.id]?.estado ?? 'no_tocado') === 'no_tocado') return false
      return true
    })
  }, [temas, bloque, soloTocados, progreso])

  const sortear = useCallback(() => {
    if (elegibles.length === 0) return
    setGirando(true)
    setSalidas([])
    setReveladas(0)

    let pool = barajar(elegibles).map((t) => t.id)
    if (sesgoRiesgo) {
      pool = elegibles
        .map((t) => {
          const p = progreso[t.id] ?? progresoVacio(t.id)
          const r = p.estado === 'no_tocado' ? 70 : riesgo(p, h)
          // Aleatoriedad + sesgo: no siempre salen los mismos, pero pesan los flojos.
          return { id: t.id, peso: r + Math.random() * 55 }
        })
        .sort((a, b) => b.peso - a.peso)
        .map((x) => x.id)
    }
    const elegidas = pool.slice(0, Math.min(cuantas, pool.length))

    window.setTimeout(() => {
      setSalidas(elegidas)
      setGirando(false)
      // Revelado escalonado, una bola cada 600 ms.
      elegidas.forEach((_, i) =>
        window.setTimeout(() => setReveladas(i + 1), 300 + i * 600),
      )
    }, 2400)
  }, [elegibles, cuantas, sesgoRiesgo, progreso, h])

  const temasSalidos = salidas
    .map((id) => temas.find((t) => t.id === id))
    .filter((t): t is NonNullable<typeof t> => !!t)

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-serif text-[30px] leading-tight">El bombo</h1>
        <p className="mt-1 text-[13.5px] text-ink-500">
          Sortea los temas como en el ejercicio real. Sin elegir tú, sin trampas, con los nervios
          incluidos.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        {/* -------------------------------------------------------- bombo */}
        <Card className="flex flex-col items-center justify-center py-12">
          <div className="relative">
            {/* Esfera del bombo */}
            <div
              className={cn(
                'relative flex h-56 w-56 items-center justify-center rounded-full border-[10px] border-ink-100 shadow-inset transition-shadow',
                girando && 'shadow-lift',
              )}
              style={{
                background:
                  'radial-gradient(circle at 32% 28%, #FFFFFF 0%, #F3F1EC 42%, #E4E0D6 100%)',
              }}
            >
              <div
                className={cn(
                  'relative h-40 w-40 rounded-full',
                  girando && 'animate-bombo-spin',
                )}
              >
                {/* Bolitas decorativas dentro del bombo */}
                {Array.from({ length: 14 }, (_, i) => {
                  const ang = (i / 14) * Math.PI * 2
                  const r = 52 + (i % 3) * 9
                  const b = BLOQUES[i % BLOQUES.length]
                  return (
                    <span
                      key={i}
                      className="absolute h-5 w-5 rounded-full shadow-sm"
                      style={{
                        left: `calc(50% + ${Math.cos(ang) * r}px - 10px)`,
                        top: `calc(50% + ${Math.sin(ang) * r}px - 10px)`,
                        background: b.colorSoft,
                        border: `1.5px solid ${b.color}44`,
                      }}
                    />
                  )
                })}
              </div>
              {!girando && salidas.length === 0 && (
                <span className="absolute font-serif text-[15px] text-ink-400">
                  {elegibles.length} bolas
                </span>
              )}
            </div>
            {/* Boquilla */}
            <div className="mx-auto -mt-2 h-6 w-16 rounded-b-2xl border-x-4 border-b-4 border-ink-100 bg-canvas" />
          </div>

          <button
            onClick={sortear}
            disabled={girando || elegibles.length === 0}
            className="btn-primary mt-8 px-8 py-3.5 text-[15px]"
          >
            {girando ? 'Girando…' : salidas.length ? 'Volver a sortear' : 'Sortear temas'}
          </button>

          {/* Bolas que han salido */}
          {temasSalidos.length > 0 && (
            <div className="mt-9 w-full space-y-2.5">
              {temasSalidos.map((t, i) => {
                const b = BLOQUE_MAP[t.bloque]
                const p = progreso[t.id] ?? progresoVacio(t.id)
                const est = ESTADOS[p.estado]
                const visible = i < reveladas
                return (
                  <div
                    key={t.id}
                    className={cn(
                      'flex items-center gap-3.5 rounded-2xl border p-3.5 transition-all duration-500',
                      visible ? 'animate-scale-in opacity-100' : 'opacity-0',
                    )}
                    style={{ borderColor: `${b.color}33`, background: `${b.colorSoft}66` }}
                  >
                    <div
                      className="num flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-[15px] font-bold text-white shadow"
                      style={{ background: b.color }}
                    >
                      {t.numero}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span
                          className="text-[10.5px] font-bold uppercase tracking-wide"
                          style={{ color: b.colorText }}
                        >
                          {b.nombre}
                        </span>
                        <Chip color={est.color} bg="rgba(255,255,255,0.8)">
                          {est.etiqueta}
                        </Chip>
                      </div>
                      <p className="mt-0.5 text-[13.5px] font-medium leading-snug text-ink-900">
                        {t.titulo}
                      </p>
                    </div>
                    <button
                      onClick={() => nav(`/cante?tema=${t.id}`)}
                      className="btn-secondary btn-sm shrink-0"
                    >
                      Cantar
                    </button>
                  </div>
                )
              })}

              {reveladas === temasSalidos.length && (
                <button
                  onClick={() =>
                    nav(`/cante?temas=${temasSalidos.map((t) => t.id).join(',')}&simulacro=1`)
                  }
                  className="btn-primary mt-3 w-full animate-fade-in py-3"
                >
                  Cantar los {temasSalidos.length} temas seguidos como simulacro
                </button>
              )}
            </div>
          )}
        </Card>

        {/* ------------------------------------------------------ ajustes */}
        <div className="space-y-4">
          <Card>
            <p className="label mb-3">Configuración del sorteo</p>
            <div className="space-y-4">
              <div>
                <p className="label mb-1.5">Bolas a sacar</p>
                <div className="flex gap-1.5">
                  {[1, 2, 3, 4, 5, 6].map((n) => (
                    <button
                      key={n}
                      onClick={() => setCuantas(n)}
                      className={cn(
                        'num h-9 flex-1 rounded-xl text-[13px] font-bold transition-all',
                        cuantas === n
                          ? 'bg-sage-700 text-white'
                          : 'bg-ink-100 text-ink-500 hover:bg-ink-200',
                      )}
                    >
                      {n}
                    </button>
                  ))}
                </div>
                <p className="mt-1.5 text-[11.5px] text-ink-400">
                  En Notarías el 1.º y 2.º ejercicio son de {ajustes.temasPorEjercicio} temas.
                </p>
              </div>

              <div>
                <p className="label mb-1.5">Restringir a un bloque</p>
                <Select
                  value={bloque}
                  onChange={(v) => setBloque(v as 'todos' | BlockId)}
                  opciones={[
                    { valor: 'todos', etiqueta: 'Todo el programa' },
                    ...BLOQUES.map((b) => ({ valor: b.id, etiqueta: b.nombre })),
                  ]}
                />
              </div>

              <div className="border-t border-ink-100 pt-1">
                <Toggle
                  activo={soloTocados}
                  onChange={setSoloTocados}
                  label="Solo temas ya tocados"
                  desc="Evita que salgan temas que nunca has estudiado."
                />
                <Toggle
                  activo={sesgoRiesgo}
                  onChange={setSesgoRiesgo}
                  label="Sesgar hacia lo flojo"
                  desc="Pondera el sorteo por riesgo. Menos realista, más útil para entrenar."
                />
              </div>
            </div>
          </Card>

          <Card>
            <p className="label mb-2">Cómo usarlo bien</p>
            <ul className="space-y-2 text-[12.5px] leading-snug text-ink-500">
              <li className="flex gap-2">
                <span className="text-sage-500">·</span>
                Sortea, no mires el temario, y ponte a cantar en frío. Es la única forma de entrenar
                la recuperación bajo presión.
              </li>
              <li className="flex gap-2">
                <span className="text-sage-500">·</span>
                Haz un simulacro completo una vez por semana como mínimo el último año.
              </li>
              <li className="flex gap-2">
                <span className="text-sage-500">·</span>
                Si un tema sale y te bloqueas, no lo repitas ese día: apúntalo y déjalo para el
                repaso. Repetir en caliente infla la sensación de dominio.
              </li>
            </ul>
          </Card>
        </div>
      </div>
    </div>
  )
}
