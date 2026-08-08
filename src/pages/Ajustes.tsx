import { useRef, useState } from 'react'
import { useApp } from '@/store/AppStore'
import { describeBackend, hasSupabase } from '@/lib/supabase'
import { ESCALONES } from '@/lib/srs'
import { DIAS_CORTOS, fmtDuracion, hoy } from '@/lib/dates'
import { cn, copiar } from '@/lib/utils'
import { Campo, Card, Chip, Select, SectionTitle, Slider, Toggle, useConfirmar } from '@/components/ui'
import { PLANTILLAS, contarTemas, materializar } from '@/data/plantillas'

export function Ajustes() {
  const {
    data,
    guardarAjustes,
    exportar,
    importar,
    resetear,
    importarPlantilla,
    mostrarAviso,
    session,
    modoLocal,
  } = useApp()
  const a = data.ajustes
  const confirmar = useConfirmar()
  const fileRef = useRef<HTMLInputElement>(null)
  const [nombre, setNombre] = useState(a.nombre)

  const descargar = () => {
    const blob = new Blob([exportar()], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `opos-notaria-${hoy()}.json`
    link.click()
    URL.revokeObjectURL(url)
    mostrarAviso('Copia de seguridad descargada.', 'ok')
  }

  const cargar = async (file: File) => {
    const texto = await file.text()
    const r = await importar(texto)
    mostrarAviso(r.error ?? 'Datos importados correctamente.', r.error ? 'error' : 'ok')
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-serif text-[30px] leading-tight">Ajustes</h1>
        <p className="mt-1 text-[13.5px] text-ink-500">
          Calibra la app a tu oposición y a tu preparador. Todo esto cambia cómo se calculan las
          notas y los repasos.
        </p>
      </header>

      {/* ------------------------------------------------------- perfil -- */}
      <Card>
        <SectionTitle sub="Cómo te llamamos y a qué oposición te presentas">Perfil</SectionTitle>
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo label="Nombre">
            <input
              className="input"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              onBlur={() => void guardarAjustes({ nombre: nombre.trim() || 'Opositor' })}
            />
          </Campo>
          <Campo label="Oposición">
            <Select
              value={a.oposicion}
              onChange={(v) => void guardarAjustes({ oposicion: v as typeof a.oposicion })}
              opciones={[
                { valor: 'notarias', etiqueta: 'Notarías' },
                { valor: 'registros', etiqueta: 'Registros de la Propiedad' },
                { valor: 'judicatura', etiqueta: 'Judicatura / Fiscales' },
              ]}
            />
          </Campo>
          <Campo label="Empecé a preparar el">
            <input
              className="input"
              type="date"
              value={a.fechaInicio}
              onChange={(e) => void guardarAjustes({ fechaInicio: e.target.value })}
            />
          </Campo>
          <Campo label="Fecha estimada de la convocatoria" hint="Topa los intervalos de repaso.">
            <input
              className="input"
              type="date"
              value={a.fechaExamen ?? ''}
              onChange={(e) => void guardarAjustes({ fechaExamen: e.target.value || null })}
            />
          </Campo>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-ink-100 pt-4">
          <Chip color={modoLocal ? '#7A5F1C' : '#324F3B'} bg={modoLocal ? '#F5EACB' : '#DFE8E1'}>
            {describeBackend()}
          </Chip>
          {session && (
            <span className="text-[12px] text-ink-400">
              Sesión: <span className="num">{session.user.email}</span>
            </span>
          )}
          {!hasSupabase && (
            <span className="text-[12px] text-ink-400">
              Configura VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY para sincronizar entre
              dispositivos.
            </span>
          )}
        </div>
      </Card>

      {/* ---------------------------------------------------- el cante --- */}
      <Card>
        <SectionTitle sub="El tiempo tasado es la mitad de la nota">El cante</SectionTitle>
        <div className="space-y-6">
          <div>
            <div className="mb-1.5 flex items-baseline justify-between">
              <span className="label">Tiempo objetivo por tema</span>
              <span className="num text-[13px] font-bold text-sage-700">
                {fmtDuracion(a.objetivoCanteSegundos)}
              </span>
            </div>
            <Slider
              value={a.objetivoCanteSegundos / 60}
              onChange={(v) => void guardarAjustes({ objetivoCanteSegundos: v * 60 })}
              min={5}
              max={30}
              formato={(v) => `${v} minutos`}
            />
            <p className="mt-1.5 text-[11.5px] text-ink-400">
              En Notarías lo habitual es 11–12 minutos por tema. Pregunta a tu preparador con qué
              tiempo te corta.
            </p>
          </div>

          <div>
            <div className="mb-1.5 flex items-baseline justify-between">
              <span className="label">Temas por ejercicio</span>
              <span className="num text-[13px] font-bold text-sage-700">
                {a.temasPorEjercicio}
              </span>
            </div>
            <Slider
              value={a.temasPorEjercicio}
              onChange={(v) => void guardarAjustes({ temasPorEjercicio: v })}
              min={1}
              max={6}
              formato={(v) => `${v} temas`}
            />
          </div>

          <div className="border-t border-ink-100 pt-1">
            <Toggle
              activo={a.grabarAudio}
              onChange={(v) => void guardarAjustes({ grabarAudio: v })}
              label="Grabar audio del cante"
              desc="Se activa automáticamente con el cronómetro. ~3 MB por cante de 12 min."
            />
            <Toggle
              activo={a.avisoSonoro}
              onChange={(v) => void guardarAjustes({ avisoSonoro: v })}
              label="Aviso sonoro de tiempo"
              desc="Un pitido corto al 80% del tiempo y otro más grave al llegar al límite."
            />
            <Toggle
              activo={a.modoCiegoPorDefecto}
              onChange={(v) => void guardarAjustes({ modoCiegoPorDefecto: v })}
              label="Empezar en modo ciego"
              desc="Bloquea la pantalla al arrancar: para cantar paseando sin toques accidentales."
            />
          </div>
        </div>
      </Card>

      {/* --------------------------------------------------- objetivos --- */}
      <Card>
        <SectionTitle sub="Definen la racha y los avisos del día">Objetivos diarios</SectionTitle>
        <div className="space-y-6">
          <div>
            <div className="mb-1.5 flex items-baseline justify-between">
              <span className="label">Horas de estudio al día</span>
              <span className="num text-[13px] font-bold text-sage-700">{a.metaHorasDia} h</span>
            </div>
            <Slider
              value={a.metaHorasDia}
              onChange={(v) => void guardarAjustes({ metaHorasDia: v })}
              min={1}
              max={14}
              formato={(v) => `${v} horas`}
            />
          </div>
          <div>
            <div className="mb-1.5 flex items-baseline justify-between">
              <span className="label">Cantes al día</span>
              <span className="num text-[13px] font-bold text-sage-700">{a.metaCantesDia}</span>
            </div>
            <Slider
              value={a.metaCantesDia}
              onChange={(v) =>
                void guardarAjustes({ metaCantesDia: v, metaCantesSemana: v * 6 })
              }
              min={1}
              max={12}
              formato={(v) => `${v} cantes`}
            />
            <p className="mt-1.5 text-[11.5px] text-ink-400">
              Objetivo semanal calculado: {a.metaCantesSemana} cantes. También limita cuántos temas
              te propone la cola del día, para que sea alcanzable.
            </p>
          </div>
        </div>
      </Card>

      {/* -------------------------------------------------- preparador --- */}
      <Card>
        <SectionTitle sub="Marcamos su día en el calendario y en el panel de hoy">
          Preparador
        </SectionTitle>
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo label="Nombre del preparador">
            <input
              className="input"
              value={a.preparadorNombre}
              onChange={(e) => void guardarAjustes({ preparadorNombre: e.target.value })}
              placeholder="p. ej. D. Fulano de Tal, notario de…"
            />
          </Campo>
          <Campo label="Día de la semana en que le cantas">
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5, 6, 0].map((d) => (
                <button
                  key={d}
                  onClick={() =>
                    void guardarAjustes({ diaPreparador: a.diaPreparador === d ? null : d })
                  }
                  className={cn(
                    'h-9 flex-1 rounded-xl text-[12.5px] font-bold transition-all',
                    a.diaPreparador === d
                      ? 'bg-sage-700 text-white'
                      : 'bg-ink-100 text-ink-400 hover:bg-ink-200',
                  )}
                >
                  {DIAS_CORTOS[d]}
                </button>
              ))}
            </div>
          </Campo>
        </div>
      </Card>

      {/* -------------------------------------------------------- SRS ---- */}
      <Card>
        <SectionTitle sub="Cómo decide la app cuándo te vuelve a salir un tema">
          Sistema de vueltas
        </SectionTitle>
        <div className="space-y-6">
          <div>
            <div className="mb-1.5 flex items-baseline justify-between">
              <span className="label">Agresividad de los repasos</span>
              <span className="num text-[13px] font-bold text-sage-700">
                ×{a.factorSrs.toFixed(2)}
              </span>
            </div>
            <Slider
              value={a.factorSrs}
              onChange={(v) => void guardarAjustes({ factorSrs: v })}
              min={0.6}
              max={1.6}
              step={0.05}
              formato={(v) =>
                v < 0.9 ? `×${v.toFixed(2)} · más repaso` : v > 1.1 ? `×${v.toFixed(2)} · menos repaso` : `×${v.toFixed(2)} · equilibrado`
              }
            />
            <div className="mt-3 flex flex-wrap gap-1">
              {ESCALONES.map((e) => (
                <span key={e} className="num chip bg-ink-100 text-[11px] text-ink-500">
                  {Math.max(1, Math.round(e * a.factorSrs))} d
                </span>
              ))}
            </div>
            <p className="mt-2 text-[11.5px] text-ink-400">
              Escalones de repaso con tu configuración actual. Al fallar un tema no vuelves al día
              1: retrocedes uno o dos escalones.
            </p>
          </div>

          <div>
            <div className="mb-1.5 flex items-baseline justify-between">
              <span className="label">Un tema dominado se oxida a los</span>
              <span className="num text-[13px] font-bold text-sage-700">{a.umbralOxido} días</span>
            </div>
            <Slider
              value={a.umbralOxido}
              onChange={(v) => void guardarAjustes({ umbralOxido: v })}
              min={20}
              max={180}
              step={5}
              formato={(v) => `${v} días sin cantar`}
            />
          </div>
        </div>
      </Card>

      {/* ----------------------------------------------------- plantillas */}
      <Card>
        <SectionTitle sub="Solo si quieres. Todo lo que cargues pasa a ser tuyo y editable.">
          Cargar un programa de plantilla
        </SectionTitle>
        <p className="mb-4 text-[12.5px] leading-relaxed text-ink-500">
          Tu temario lo construyes tú, tema a tema, según te lo van dando. Pero si prefieres partir
          del programa oficial completo y luego borrar, renumerar o reescribir lo que no encaje,
          aquí lo tienes. No sustituye nada de lo que ya tengas: solo añade lo que falte.
        </p>
        <div className="space-y-2">
          {PLANTILLAS.map((pl) => (
            <div
              key={pl.id}
              className="flex flex-wrap items-center gap-3 rounded-xl border border-ink-100 p-3.5"
            >
              <div className="min-w-[200px] flex-1">
                <p className="text-[13.5px] font-semibold text-ink-900">{pl.nombre}</p>
                <p className="mt-0.5 text-[12px] leading-snug text-ink-500">{pl.desc}</p>
              </div>
              <button
                onClick={() =>
                  confirmar.pedir(
                    contarTemas(pl) > 0
                      ? `Se añadirán ${contarTemas(pl)} temas en ${pl.materias.length} materias. No se toca nada de lo que ya tengas.`
                      : `Se crearán ${pl.materias.length} materias vacías.`,
                    async () => {
                      const { bloques, temas } = materializar(pl, data.bloques)
                      await importarPlantilla(bloques, temas)
                      mostrarAviso(
                        temas.length
                          ? `${temas.length} temas añadidos. Ya son tuyos: edítalos a tu gusto.`
                          : `${bloques.length} materias creadas.`,
                        'ok',
                      )
                    },
                  )
                }
                className="btn-secondary btn-sm shrink-0"
              >
                Cargar
                {contarTemas(pl) > 0 && (
                  <span className="num ml-1 text-ink-400">{contarTemas(pl)}</span>
                )}
              </button>
            </div>
          ))}
        </div>
      </Card>

      {/* ------------------------------------------------------- datos --- */}
      <Card>
        <SectionTitle sub="Todo lo has creado tú">Tus datos</SectionTitle>
        <div className="grid gap-3 sm:grid-cols-3">
          <Resumen
            label="Materias y temas"
            valor={`${data.bloques.length} · ${data.temas.length}`}
          />
          <Resumen label="Cantes registrados" valor={`${data.cantes.length}`} />
          <Resumen label="Tareas y series" valor={`${data.tareas.length}`} />
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          <button onClick={descargar} className="btn-secondary btn-sm">
            Descargar copia de seguridad
          </button>
          <button onClick={() => fileRef.current?.click()} className="btn-secondary btn-sm">
            Importar copia
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void cargar(f)
              e.target.value = ''
            }}
          />
          <button
            onClick={async () => {
              const ok = await copiar(exportar())
              mostrarAviso(ok ? 'JSON copiado al portapapeles.' : 'No se pudo copiar.', ok ? 'ok' : 'error')
            }}
            className="btn-ghost btn-sm"
          >
            Copiar JSON
          </button>
          <button
            onClick={() =>
              confirmar.pedir(
                'Se borrará TODO: materias, temas, cantes, sesiones, tareas y progreso. La app volverá a estar vacía. Esta acción no se puede deshacer.',
                () => {
                  void resetear()
                  mostrarAviso('Datos reiniciados.', 'ok')
                },
                true,
              )
            }
            className="btn-ghost btn-sm ml-auto text-clay-500"
          >
            Borrar todo y empezar de cero
          </button>
        </div>
      </Card>

      <p className="pb-4 text-center text-[11.5px] text-ink-300">
        Cante · herramienta de estudio para la oposición a Notarías. El programa precargado procede
        de fuentes públicas (BOE) y es editable.
      </p>

      {confirmar.nodo}
    </div>
  )
}

function Resumen({ label, valor }: { label: string; valor: string }) {
  return (
    <div className="rounded-xl bg-canvas px-3.5 py-3">
      <p className="label">{label}</p>
      <p className="num mt-0.5 text-[19px] font-bold text-ink-900">{valor}</p>
    </div>
  )
}
