import { useMemo, useState } from 'react'
import { useApp } from '@/store/AppStore'
import { PLANTILLAS, contarTemas, materializar } from '@/data/plantillas'
import { crearBloque } from '@/lib/bloques'
import { Campo, Card, Select, Slider } from '@/components/ui'
import { cn } from '@/lib/utils'
import { fmtDuracion } from '@/lib/dates'

/**
 * Tres pasos, todos saltables. El objetivo es que en menos de un minuto el
 * opositor tenga la app configurada a SU oposición y pueda cantar. Nada de
 * ocho pantallas de tutorial.
 */
export function Bienvenida({ onListo }: { onListo(): void }) {
  const { data, guardarAjustes, guardarBloques, importarPlantilla, mostrarAviso } = useApp()
  const [paso, setPaso] = useState(0)

  const [nombre, setNombre] = useState(data.ajustes.nombre)
  const [oposicion, setOposicion] = useState(data.ajustes.oposicion)
  const [fechaExamen, setFechaExamen] = useState(data.ajustes.fechaExamen ?? '')
  const [horas, setHoras] = useState(data.ajustes.metaHorasDia)
  const [cantes, setCantes] = useState(data.ajustes.metaCantesDia)
  const [minutosCante, setMinutosCante] = useState(
    Math.round(data.ajustes.objetivoCanteSegundos / 60),
  )
  const [materias, setMaterias] = useState<string[]>([])
  const [nuevaMateria, setNuevaMateria] = useState('')
  const [guardando, setGuardando] = useState(false)

  const sugeridas = useMemo(
    () =>
      oposicion === 'notarias'
        ? ['Civil', 'Mercantil', 'Hipotecario', 'Notarial', 'Fiscal', 'Admin. y Procesal']
        : oposicion === 'registros'
          ? ['Civil', 'Mercantil', 'Hipotecario', 'Fiscal', 'Admin. y Procesal']
          : ['Civil', 'Penal', 'Procesal Civil', 'Procesal Penal', 'Constitucional', 'Mercantil'],
    [oposicion],
  )

  const terminar = async (opts?: { plantilla?: (typeof PLANTILLAS)[number] }) => {
    setGuardando(true)
    try {
      await guardarAjustes({
        nombre: nombre.trim() || 'Opositor',
        oposicion,
        fechaExamen: fechaExamen || null,
        metaHorasDia: horas,
        metaCantesDia: cantes,
        metaCantesSemana: cantes * 6,
        objetivoCanteSegundos: minutosCante * 60,
        configurado: true,
      })

      if (opts?.plantilla) {
        const { bloques, temas } = materializar(opts.plantilla, data.bloques)
        await importarPlantilla(bloques, temas)
        mostrarAviso(
          temas.length
            ? `Cargados ${temas.length} temas. Edítalos, bórralos o renumera lo que quieras.`
            : `Creadas ${bloques.length} materias.`,
          'ok',
        )
      } else if (materias.length) {
        const acumulado = [...data.bloques]
        const nuevos = materias.map((m) => {
          const b = crearBloque(m, acumulado, { ejercicio: 1 })
          acumulado.push(b)
          return b
        })
        await guardarBloques(nuevos)
      }
      onListo()
    } finally {
      setGuardando(false)
    }
  }

  const pasos = ['Tu oposición', 'Tu ritmo', 'Tu temario']

  return (
    <div className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-5 py-10">
      {/* Progreso */}
      <div className="mb-8 flex items-center gap-2">
        {pasos.map((p, i) => (
          <div key={p} className="flex flex-1 items-center gap-2">
            <div className="flex-1">
              <div
                className={cn(
                  'h-1 rounded-full transition-colors',
                  i <= paso ? 'bg-sage-600' : 'bg-ink-100',
                )}
              />
              <p
                className={cn(
                  'mt-1.5 text-[10.5px] font-semibold uppercase tracking-wider',
                  i <= paso ? 'text-sage-700' : 'text-ink-300',
                )}
              >
                {p}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* -------------------------------------------------------- paso 0 */}
      {paso === 0 && (
        <div className="animate-slide-up space-y-5">
          <header>
            <h1 className="font-serif text-[30px] leading-tight">Vamos a empezar</h1>
            <p className="mt-1.5 text-[14px] leading-relaxed text-ink-500">
              La app arranca vacía a propósito. Tú vas metiendo los temas, las tareas y las horas
              según te los vayan dando. Esto son solo cuatro datos para calibrarla.
            </p>
          </header>

          <Card className="space-y-4">
            <Campo label="¿Cómo te llamas?">
              <input
                className="input"
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                placeholder="Tu nombre"
                autoFocus
              />
            </Campo>
            <Campo label="¿Qué oposición preparas?">
              <Select
                value={oposicion}
                onChange={(v) => setOposicion(v as typeof oposicion)}
                opciones={[
                  { valor: 'notarias', etiqueta: 'Notarías' },
                  { valor: 'registros', etiqueta: 'Registros de la Propiedad' },
                  { valor: 'judicatura', etiqueta: 'Judicatura / Fiscales' },
                ]}
              />
            </Campo>
            <Campo
              label="¿Cuándo crees que será la convocatoria?"
              hint="Puedes dejarlo en blanco y ponerlo cuando se sepa. Sirve para que ningún repaso se programe más allá del examen."
            >
              <input
                className="input"
                type="date"
                value={fechaExamen}
                onChange={(e) => setFechaExamen(e.target.value)}
              />
            </Campo>
          </Card>

          <button onClick={() => setPaso(1)} className="btn-primary w-full py-3">
            Siguiente
          </button>
        </div>
      )}

      {/* -------------------------------------------------------- paso 1 */}
      {paso === 1 && (
        <div className="animate-slide-up space-y-5">
          <header>
            <h1 className="font-serif text-[30px] leading-tight">Tu ritmo</h1>
            <p className="mt-1.5 text-[14px] leading-relaxed text-ink-500">
              Todo esto se cambia luego en Ajustes. Pon lo que te haya dicho tu preparador; si no
              lo sabes todavía, deja lo que hay.
            </p>
          </header>

          <Card className="space-y-6">
            <div>
              <div className="mb-1.5 flex items-baseline justify-between">
                <span className="label">Horas de estudio al día</span>
                <span className="num text-[13px] font-bold text-sage-700">{horas} h</span>
              </div>
              <Slider value={horas} onChange={setHoras} min={1} max={14} formato={(v) => `${v} horas`} />
            </div>
            <div>
              <div className="mb-1.5 flex items-baseline justify-between">
                <span className="label">Cantes al día</span>
                <span className="num text-[13px] font-bold text-sage-700">{cantes}</span>
              </div>
              <Slider
                value={cantes}
                onChange={setCantes}
                min={1}
                max={12}
                formato={(v) => `${v} cantes`}
              />
              <p className="mt-1.5 text-[11.5px] text-ink-400">
                También limita cuántos temas te propone la app cada mañana, para que la lista sea
                alcanzable.
              </p>
            </div>
            <div>
              <div className="mb-1.5 flex items-baseline justify-between">
                <span className="label">Tiempo por tema al cantar</span>
                <span className="num text-[13px] font-bold text-sage-700">
                  {fmtDuracion(minutosCante * 60)}
                </span>
              </div>
              <Slider
                value={minutosCante}
                onChange={setMinutosCante}
                min={5}
                max={30}
                formato={(v) => `${v} minutos`}
              />
              <p className="mt-1.5 text-[11.5px] text-ink-400">
                En Notarías suelen ser 11–12 minutos. Es la mitad de la nota de cada cante.
              </p>
            </div>
          </Card>

          <div className="flex gap-2">
            <button onClick={() => setPaso(0)} className="btn-secondary flex-1 py-3">
              Atrás
            </button>
            <button onClick={() => setPaso(2)} className="btn-primary flex-[2] py-3">
              Siguiente
            </button>
          </div>
        </div>
      )}

      {/* -------------------------------------------------------- paso 2 */}
      {paso === 2 && (
        <div className="animate-slide-up space-y-5">
          <header>
            <h1 className="font-serif text-[30px] leading-tight">Tu temario</h1>
            <p className="mt-1.5 text-[14px] leading-relaxed text-ink-500">
              Los temas los añades tú desde el Temario, según te los den. Aquí solo dejamos
              creadas las materias para que tengan dónde caer.
            </p>
          </header>

          <Card>
            <p className="label mb-2.5">Materias sugeridas para tu oposición</p>
            <div className="flex flex-wrap gap-1.5">
              {sugeridas.map((m) => {
                const puesta = materias.includes(m)
                return (
                  <button
                    key={m}
                    onClick={() =>
                      setMaterias((prev) =>
                        puesta ? prev.filter((x) => x !== m) : [...prev, m],
                      )
                    }
                    className={cn(
                      'chip transition-all',
                      puesta ? 'bg-sage-600 text-white' : 'bg-ink-100 text-ink-500 hover:bg-ink-200',
                    )}
                  >
                    {puesta ? '✓ ' : '+ '}
                    {m}
                  </button>
                )
              })}
            </div>

            <div className="mt-4 flex gap-2">
              <input
                className="input flex-1"
                value={nuevaMateria}
                onChange={(e) => setNuevaMateria(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && nuevaMateria.trim()) {
                    setMaterias((prev) => [...prev, nuevaMateria.trim()])
                    setNuevaMateria('')
                  }
                }}
                placeholder="…o escribe la tuya y pulsa Enter"
              />
              <button
                className="btn-secondary btn-sm"
                disabled={!nuevaMateria.trim()}
                onClick={() => {
                  setMaterias((prev) => [...prev, nuevaMateria.trim()])
                  setNuevaMateria('')
                }}
              >
                Añadir
              </button>
            </div>

            {materias.filter((m) => !sugeridas.includes(m)).length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {materias
                  .filter((m) => !sugeridas.includes(m))
                  .map((m) => (
                    <button
                      key={m}
                      onClick={() => setMaterias((prev) => prev.filter((x) => x !== m))}
                      className="chip bg-sage-600 text-white"
                    >
                      ✓ {m} ✕
                    </button>
                  ))}
              </div>
            )}
          </Card>

          <button
            onClick={() => void terminar()}
            disabled={guardando}
            className="btn-primary w-full py-3.5"
          >
            {guardando
              ? 'Preparando…'
              : materias.length
                ? `Empezar con ${materias.length} ${materias.length === 1 ? 'materia' : 'materias'}`
                : 'Empezar de cero'}
          </button>

          <div className="rounded-2xl border border-ink-100 bg-canvas/60 p-4">
            <p className="text-[12.5px] font-semibold text-ink-700">
              ¿Prefieres cargar el programa oficial completo?
            </p>
            <p className="mt-1 text-[12px] leading-snug text-ink-500">
              Puedes traerlo entero y después editar, borrar o renumerar lo que quieras. También
              está siempre disponible en Ajustes.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {PLANTILLAS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => void terminar({ plantilla: p })}
                  disabled={guardando}
                  className="btn-secondary btn-sm"
                >
                  {p.nombre}
                  {contarTemas(p) > 0 && (
                    <span className="num ml-1 text-ink-400">({contarTemas(p)})</span>
                  )}
                </button>
              ))}
            </div>
          </div>

          <button onClick={() => setPaso(1)} className="btn-ghost btn-sm mx-auto">
            ← Atrás
          </button>
        </div>
      )}
    </div>
  )
}
