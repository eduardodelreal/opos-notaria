import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '@/store/AppStore'
import { BLOQUE_MAP, BLOQUES } from '@/data/programa'
import { ESTADOS, progresoVacio, riesgo } from '@/lib/srs'
import { fmtDuracion, fmtHoras, fmtRelativo, hoy } from '@/lib/dates'
import { cn, colorNota, copiar, pct, uid } from '@/lib/utils'
import { Campo, Card, Chip, Modal, Select, Tabs, useConfirmar, Vacio } from '@/components/ui'
import { Progreso } from '@/components/charts'
import { enlaceParaPreparador, urlAudio } from '@/lib/audio'
import type { BlockId, EstadoTema, Tema } from '@/lib/types'

type Orden = 'programa' | 'riesgo' | 'nota' | 'reciente'

export function Temario() {
  const { data, guardarTema, borrarTema, guardarProgreso } = useApp()
  const nav = useNavigate()
  const { temas, progreso } = data
  const h = hoy()

  const [bloque, setBloque] = useState<'todos' | BlockId>('todos')
  const [estado, setEstado] = useState<'todos' | EstadoTema>('todos')
  const [busca, setBusca] = useState('')
  const [orden, setOrden] = useState<Orden>('programa')
  const [abierto, setAbierto] = useState<string | null>(null)
  const [editando, setEditando] = useState<Tema | null>(null)
  const [creando, setCreando] = useState(false)
  const confirmar = useConfirmar()

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase()
    let out = temas.filter((t) => {
      if (bloque !== 'todos' && t.bloque !== bloque) return false
      const e = progreso[t.id]?.estado ?? 'no_tocado'
      if (estado !== 'todos' && e !== estado) return false
      if (!q) return true
      return (
        t.titulo.toLowerCase().includes(q) ||
        `${t.numero}` === q ||
        t.id.toLowerCase().includes(q)
      )
    })
    const clave = (t: Tema) => {
      const p = progreso[t.id] ?? progresoVacio(t.id)
      if (orden === 'riesgo') return -(p.estado === 'no_tocado' ? 100 : riesgo(p, h))
      if (orden === 'nota') return p.notaMedia ?? 99
      if (orden === 'reciente') return p.ultimoCante ? -Number(p.ultimoCante.replace(/-/g, '')) : 1
      return 0
    }
    if (orden !== 'programa') out = [...out].sort((a, b) => clave(a) - clave(b))
    return out
  }, [temas, progreso, bloque, estado, busca, orden, h])

  const resumenBloques = useMemo(
    () =>
      BLOQUES.map((b) => {
        const ts = temas.filter((t) => t.bloque === b.id && !t.excluido)
        const dominados = ts.filter((t) => progreso[t.id]?.estado === 'dominado').length
        const tocados = ts.filter(
          (t) => (progreso[t.id]?.estado ?? 'no_tocado') !== 'no_tocado',
        ).length
        return { bloque: b, total: ts.length, dominados, tocados }
      }),
    [temas, progreso],
  )

  const conteoEstados = useMemo(() => {
    const c: Record<string, number> = {}
    for (const t of temas) {
      if (t.excluido) continue
      const e = progreso[t.id]?.estado ?? 'no_tocado'
      c[e] = (c[e] ?? 0) + 1
    }
    return c
  }, [temas, progreso])

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-serif text-[30px] leading-tight">Temario</h1>
          <p className="mt-1 text-[13.5px] text-ink-500">
            {temas.filter((t) => !t.excluido).length} temas en programa. Puedes editar títulos,
            excluir temas o añadir los tuyos.
          </p>
        </div>
        <button onClick={() => setCreando(true)} className="btn-secondary">
          + Añadir tema
        </button>
      </header>

      {/* Resumen por bloque */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {resumenBloques.map(({ bloque: b, total, dominados, tocados }) => (
          <button
            key={b.id}
            onClick={() => setBloque(bloque === b.id ? 'todos' : b.id)}
            className={cn(
              'card card-hover p-4 text-left',
              bloque === b.id && 'ring-4 ring-sage-100',
            )}
            style={bloque === b.id ? { borderColor: b.color } : undefined}
          >
            <div className="flex items-baseline justify-between">
              <span className="text-[14px] font-semibold" style={{ color: b.colorText }}>
                {b.nombre}
              </span>
              <span className="num text-[12px] text-ink-400">
                {tocados}/{total}
              </span>
            </div>
            <Progreso valor={tocados} max={total} alto={5} color={b.color} className="mt-2.5" />
            <p className="mt-2 text-[11.5px] text-ink-400">
              <span className="num font-semibold" style={{ color: b.color }}>
                {dominados}
              </span>{' '}
              dominados · {pct(dominados, total)}% del bloque · {b.ejercicio}º ejercicio
            </p>
          </button>
        ))}
      </div>

      {/* Filtros */}
      <div className="space-y-3">
        <Tabs
          valor={estado}
          onChange={(v) => setEstado(v)}
          items={[
            { valor: 'todos' as const, etiqueta: 'Todos' },
            { valor: 'no_tocado' as const, etiqueta: 'Sin tocar', badge: conteoEstados.no_tocado },
            {
              valor: 'primera_vuelta' as const,
              etiqueta: '1ª vuelta',
              badge: conteoEstados.primera_vuelta,
            },
            {
              valor: 'en_arrastre' as const,
              etiqueta: 'En arrastre',
              badge: conteoEstados.en_arrastre,
            },
            { valor: 'oxidado' as const, etiqueta: 'Oxidados', badge: conteoEstados.oxidado },
            { valor: 'dominado' as const, etiqueta: 'Dominados', badge: conteoEstados.dominado },
          ]}
        />
        <div className="flex flex-wrap gap-2.5">
          <input
            className="input min-w-[200px] flex-1"
            placeholder="Buscar por título o número de tema…"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
          <Select
            className="w-full sm:w-48"
            value={bloque}
            onChange={(v) => setBloque(v as 'todos' | BlockId)}
            opciones={[
              { valor: 'todos', etiqueta: 'Todos los bloques' },
              ...BLOQUES.map((b) => ({ valor: b.id, etiqueta: b.nombre })),
            ]}
          />
          <Select
            className="w-full sm:w-44"
            value={orden}
            onChange={(v) => setOrden(v as Orden)}
            opciones={[
              { valor: 'programa', etiqueta: 'Orden del programa' },
              { valor: 'riesgo', etiqueta: 'Más riesgo primero' },
              { valor: 'nota', etiqueta: 'Peor nota primero' },
              { valor: 'reciente', etiqueta: 'Cantado hace más' },
            ]}
          />
        </div>
      </div>

      {/* Lista */}
      <Card padding={false}>
        {filtrados.length === 0 ? (
          <Vacio titulo="Ningún tema coincide" texto="Cambia los filtros o la búsqueda." />
        ) : (
          <ul className="divide-y divide-ink-100">
            {filtrados.map((t) => {
              const p = progreso[t.id] ?? progresoVacio(t.id)
              const b = BLOQUE_MAP[t.bloque]
              const est = ESTADOS[p.estado]
              return (
                <li key={t.id}>
                  <button
                    onClick={() => setAbierto(t.id)}
                    className={cn(
                      'flex w-full items-center gap-3.5 px-4 py-3 text-left transition-colors hover:bg-canvas sm:px-5',
                      t.excluido && 'opacity-40',
                    )}
                  >
                    <div
                      className="num flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-[12px] font-bold"
                      style={{ background: b.colorSoft, color: b.colorText }}
                    >
                      {t.numero}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span
                          className="text-[10.5px] font-bold uppercase tracking-wide"
                          style={{ color: b.color }}
                        >
                          {b.nombre}
                        </span>
                        <Chip color={est.color} bg={est.bg}>
                          {est.etiqueta}
                        </Chip>
                        {p.prioritario && (
                          <Chip color="#7A5F1C" bg="#F5EACB">
                            prioritario
                          </Chip>
                        )}
                        {t.custom && (
                          <Chip color="#544766" bg="#E9E3F0">
                            propio
                          </Chip>
                        )}
                        {t.excluido && <Chip>excluido</Chip>}
                      </div>
                      <p className="mt-0.5 truncate text-[13.5px] font-medium text-ink-900">
                        {t.titulo}
                      </p>
                      <p className="mt-0.5 text-[11.5px] text-ink-400">
                        {p.vueltas > 0 ? `${p.vueltas} vueltas` : 'sin vueltas'}
                        {p.ultimoCante && ` · ${fmtRelativo(p.ultimoCante, h)}`}
                        {p.proximaRevision && ` · próximo ${fmtRelativo(p.proximaRevision, h)}`}
                        {p.minutosEstudio > 0 && ` · ${fmtHoras(p.minutosEstudio)}`}
                      </p>
                    </div>
                    {p.notaMedia != null && (
                      <span
                        className="num hidden text-[15px] font-bold sm:block"
                        style={{ color: colorNota(p.notaMedia) }}
                      >
                        {p.notaMedia.toFixed(1)}
                      </span>
                    )}
                    <span className="text-ink-300">›</span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </Card>

      {/* Ficha de tema */}
      {abierto && (
        <FichaTema
          temaId={abierto}
          cerrar={() => setAbierto(null)}
          onEditar={(t) => {
            setAbierto(null)
            setEditando(t)
          }}
          onCantar={(id) => nav(`/cante?tema=${id}`)}
        />
      )}

      {/* Editor / creador */}
      <EditorTema
        abierto={creando || !!editando}
        tema={editando}
        cerrar={() => {
          setCreando(false)
          setEditando(null)
        }}
        onGuardar={(t) => {
          void guardarTema(t)
          setCreando(false)
          setEditando(null)
        }}
        onBorrar={(id) => {
          confirmar.pedir(
            'Se borrará el tema y todo su progreso. Los cantes registrados se conservan en el historial.',
            () => {
              void borrarTema(id)
              setEditando(null)
            },
            true,
          )
        }}
        onExcluir={(t) => {
          void guardarTema({ ...t, excluido: !t.excluido })
          setEditando(null)
        }}
        onPrioritario={(t) => {
          const p = progreso[t.id] ?? progresoVacio(t.id)
          void guardarProgreso(t.id, { prioritario: !p.prioritario })
        }}
        prioritario={editando ? (progreso[editando.id]?.prioritario ?? false) : false}
      />

      {confirmar.nodo}
    </div>
  )
}

/* ==================================================================== */

function FichaTema({
  temaId,
  cerrar,
  onEditar,
  onCantar,
}: {
  temaId: string
  cerrar(): void
  onEditar(t: Tema): void
  onCantar(id: string): void
}) {
  const { data, guardarProgreso, borrarCante, registrarSesion } = useApp()
  const tema = data.temas.find((t) => t.id === temaId)
  const p = data.progreso[temaId] ?? progresoVacio(temaId)
  const cantes = useMemo(
    () => data.cantes.filter((c) => c.temaId === temaId),
    [data.cantes, temaId],
  )
  const [notas, setNotas] = useState(p.notas ?? '')
  const [minutos, setMinutos] = useState(30)
  const h = hoy()
  const confirmar = useConfirmar()

  useEffect(() => setNotas(p.notas ?? ''), [p.notas])

  if (!tema) return null
  const b = BLOQUE_MAP[tema.bloque]
  const est = ESTADOS[p.estado]

  return (
    <Modal
      abierto
      cerrar={cerrar}
      titulo={`${b.nombre} · Tema ${tema.numero}`}
      ancho="max-w-2xl"
      pie={
        <>
          <button className="btn-secondary btn-sm" onClick={() => onEditar(tema)}>
            Editar tema
          </button>
          <button className="btn-primary btn-sm" onClick={() => onCantar(tema.id)}>
            Cantar ahora
          </button>
        </>
      }
    >
      <div className="space-y-5">
        <div>
          <h3 className="font-serif text-[20px] leading-snug text-ink-900">{tema.titulo}</h3>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <Chip color={est.color} bg={est.bg}>
              {est.etiqueta}
            </Chip>
            <Chip>{p.vueltas} vueltas</Chip>
            {p.notaMedia != null && (
              <Chip color="#fff" bg={colorNota(p.notaMedia)}>
                media {p.notaMedia.toFixed(1)}
              </Chip>
            )}
            {p.proximaRevision && <Chip>próximo {fmtRelativo(p.proximaRevision, h)}</Chip>}
          </div>
        </div>

        {/* Métricas del tema */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <MiniDato label="Cantes" valor={`${cantes.length}`} />
          <MiniDato label="Horas" valor={fmtHoras(p.minutosEstudio)} />
          <MiniDato
            label="Intervalo"
            valor={p.intervalo > 0 ? `${p.intervalo} d` : '—'}
          />
          <MiniDato
            label="Riesgo"
            valor={`${p.estado === 'no_tocado' ? 100 : riesgo(p, h)}`}
          />
        </div>

        {/* Acciones rápidas de estado */}
        <div>
          <p className="label mb-2">Forzar estado</p>
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(ESTADOS) as EstadoTema[]).map((e) => (
              <button
                key={e}
                onClick={() => void guardarProgreso(temaId, { estado: e })}
                className={cn(
                  'chip transition-all',
                  p.estado === e ? 'ring-2 ring-offset-1' : 'opacity-60 hover:opacity-100',
                )}
                style={{
                  color: ESTADOS[e].color,
                  background: ESTADOS[e].bg,
                  boxShadow: p.estado === e ? `0 0 0 2px ${ESTADOS[e].color}` : undefined,
                }}
              >
                {ESTADOS[e].etiqueta}
              </button>
            ))}
            <button
              onClick={() => void guardarProgreso(temaId, { prioritario: !p.prioritario })}
              className={cn('chip', p.prioritario ? 'bg-gold-100 text-gold-500' : 'bg-ink-100 text-ink-400')}
            >
              {p.prioritario ? '★ prioritario' : '☆ marcar prioritario'}
            </button>
          </div>
        </div>

        {/* Registrar tiempo de estudio */}
        <div className="rounded-2xl border border-ink-100 bg-canvas/60 p-4">
          <p className="label mb-2">Registrar estudio (sin cantar)</p>
          <div className="flex flex-wrap items-center gap-2">
            {[15, 30, 60, 90, 120].map((m) => (
              <button
                key={m}
                onClick={() => setMinutos(m)}
                className={cn(
                  'chip num',
                  minutos === m ? 'bg-sage-600 text-white' : 'bg-ink-100 text-ink-500',
                )}
              >
                {m} min
              </button>
            ))}
            <button
              onClick={() =>
                void registrarSesion({
                  temaId,
                  fecha: new Date().toISOString(),
                  minutos,
                  tipo: 'memorizacion',
                })
              }
              className="btn-primary btn-sm ml-auto"
            >
              Añadir
            </button>
          </div>
        </div>

        {/* Notas */}
        <Campo label="Mis notas de este tema" hint="Se guardan al salir del campo.">
          <textarea
            className="input min-h-[90px] resize-y"
            value={notas}
            onChange={(e) => setNotas(e.target.value)}
            onBlur={() => void guardarProgreso(temaId, { notas })}
            placeholder="Epígrafes que siempre olvido, sentencias clave, estructura del cante…"
          />
        </Campo>

        {/* Historial */}
        <div>
          <p className="label mb-2">Historial de cantes</p>
          {cantes.length === 0 ? (
            <p className="rounded-xl bg-canvas px-3.5 py-3 text-[12.5px] text-ink-400">
              Todavía no has cantado este tema.
            </p>
          ) : (
            <ul className="space-y-2">
              {cantes.map((c) => (
                <FilaCante
                  key={c.id}
                  cante={c}
                  tema={tema}
                  onBorrar={() =>
                    confirmar.pedir('Se borrará este cante y su audio.', () => void borrarCante(c.id), true)
                  }
                />
              ))}
            </ul>
          )}
        </div>
      </div>
      {confirmar.nodo}
    </Modal>
  )
}

function MiniDato({ label, valor }: { label: string; valor: string }) {
  return (
    <div className="rounded-xl bg-canvas px-3 py-2.5">
      <p className="label">{label}</p>
      <p className="num mt-0.5 text-[16px] font-bold text-ink-900">{valor}</p>
    </div>
  )
}

function FilaCante({
  cante,
  tema,
  onBorrar,
}: {
  cante: import('@/lib/types').Cante
  tema: Tema
  onBorrar(): void
}) {
  const { mostrarAviso, data } = useApp()
  const [url, setUrl] = useState<string | null>(null)
  const [cargandoAudio, setCargandoAudio] = useState(false)
  const [compartiendo, setCompartiendo] = useState(false)

  /** Genera el mensaje listo para pegar en WhatsApp al preparador. */
  const compartir = async () => {
    setCompartiendo(true)
    try {
      const enlace = cante.audioPath ? await enlaceParaPreparador(cante.audioPath) : null
      const b = BLOQUE_MAP[tema.bloque]
      const lineas = [
        `${data.ajustes.nombre || 'Opositor'} · cante grabado`,
        `${b.nombre} · Tema ${tema.numero}: ${tema.titulo}`,
        `Fecha: ${new Intl.DateTimeFormat('es-ES', { dateStyle: 'long', timeStyle: 'short' }).format(new Date(cante.fecha))}`,
        `Tiempo: ${fmtDuracion(cante.duracionSegundos)} (límite ${fmtDuracion(cante.objetivoSegundos)})`,
        `Autovaloración: ${cante.nota.toFixed(1)}/10${cante.lagunas ? ` · ${cante.lagunas} lagunas` : ''}`,
        cante.comentarios ? `Notas: ${cante.comentarios}` : null,
        enlace ? `Audio (enlace válido 7 días): ${enlace}` : null,
      ].filter(Boolean)
      const texto = lineas.join('\n')

      const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> }
      if (nav.share) {
        await nav.share({ title: 'Cante para el preparador', text: texto })
        return
      }
      const ok = await copiar(texto)
      mostrarAviso(
        ok
          ? enlace
            ? 'Resumen y enlace del audio copiados. Pégaselo al preparador.'
            : 'Resumen copiado. El audio solo está en este navegador: configura Supabase para poder enviarlo.'
          : 'No se pudo copiar el resumen.',
        ok ? 'ok' : 'error',
      )
    } finally {
      setCompartiendo(false)
    }
  }

  return (
    <li className="rounded-xl border border-ink-100 px-3.5 py-3">
      <div className="flex items-center gap-3">
        <span
          className="num flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[12.5px] font-bold text-white"
          style={{ background: colorNota(cante.nota) }}
        >
          {cante.nota.toFixed(1)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[12.5px] font-semibold text-ink-900">
            {new Intl.DateTimeFormat('es-ES', {
              day: 'numeric',
              month: 'short',
              hour: '2-digit',
              minute: '2-digit',
            }).format(new Date(cante.fecha))}
            {cante.antePreparador && (
              <span className="ml-2 text-[11px] font-bold uppercase text-gold-500">preparador</span>
            )}
          </p>
          <p className="num text-[11.5px] text-ink-400">
            {fmtDuracion(cante.duracionSegundos)} / {fmtDuracion(cante.objetivoSegundos)}
            {cante.lagunas > 0 && ` · ${cante.lagunas} lagunas`}
            {cante.simulacroId && ' · simulacro'}
          </p>
        </div>
        {cante.audioPath && !url && (
          <button
            className="btn-secondary btn-sm shrink-0"
            disabled={cargandoAudio}
            onClick={async () => {
              setCargandoAudio(true)
              const u = await urlAudio(cante.audioPath!)
              setUrl(u)
              setCargandoAudio(false)
            }}
          >
            {cargandoAudio ? '…' : '▸ Audio'}
          </button>
        )}
        <button
          onClick={() => void compartir()}
          disabled={compartiendo}
          title="Compartir con el preparador"
          className="btn-ghost btn-sm shrink-0 text-ink-400"
        >
          {compartiendo ? '…' : '↗'}
        </button>
        <button onClick={onBorrar} className="btn-ghost btn-sm shrink-0 text-ink-300">
          ✕
        </button>
      </div>
      {cante.comentarios && (
        <p className="mt-2 border-l-2 border-ink-200 pl-2.5 text-[12px] leading-snug text-ink-500">
          {cante.comentarios}
        </p>
      )}
      {url && <audio src={url} controls className="mt-2.5 h-9 w-full" />}
    </li>
  )
}

/* ==================================================================== */

function EditorTema({
  abierto,
  tema,
  cerrar,
  onGuardar,
  onBorrar,
  onExcluir,
  onPrioritario,
  prioritario,
}: {
  abierto: boolean
  tema: Tema | null
  cerrar(): void
  onGuardar(t: Tema): void
  onBorrar(id: string): void
  onExcluir(t: Tema): void
  onPrioritario(t: Tema): void
  prioritario: boolean
}) {
  const [titulo, setTitulo] = useState('')
  const [bloque, setBloque] = useState<BlockId>('civil')
  const [numero, setNumero] = useState(1)
  const [epigrafes, setEpigrafes] = useState('')

  useEffect(() => {
    if (!abierto) return
    setTitulo(tema?.titulo ?? '')
    setBloque(tema?.bloque ?? 'civil')
    setNumero(tema?.numero ?? 1)
    setEpigrafes((tema?.epigrafes ?? []).join('\n'))
  }, [abierto, tema])

  const guardar = () => {
    if (!titulo.trim()) return
    const eps = epigrafes
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
    onGuardar({
      id: tema?.id ?? `PROP_${uid()}`,
      bloque,
      numero,
      titulo: titulo.trim(),
      custom: tema?.custom ?? !tema,
      excluido: tema?.excluido,
      epigrafes: eps.length ? eps : undefined,
    })
  }

  return (
    <Modal
      abierto={abierto}
      cerrar={cerrar}
      titulo={tema ? 'Editar tema' : 'Añadir tema propio'}
      pie={
        <>
          {tema && (
            <>
              <button className="btn-ghost btn-sm mr-auto" onClick={() => onExcluir(tema)}>
                {tema.excluido ? 'Volver a incluir' : 'Excluir del programa'}
              </button>
              {tema.custom && (
                <button className="btn-ghost btn-sm text-clay-500" onClick={() => onBorrar(tema.id)}>
                  Borrar
                </button>
              )}
            </>
          )}
          <button className="btn-secondary btn-sm" onClick={cerrar}>
            Cancelar
          </button>
          <button className="btn-primary btn-sm" onClick={guardar}>
            Guardar
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <Campo label="Título del tema">
          <textarea
            className="input min-h-[70px] resize-y"
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
            placeholder="El negocio jurídico: concepto, elementos y clases."
          />
        </Campo>
        <div className="grid grid-cols-2 gap-3">
          <Campo label="Bloque">
            <Select
              value={bloque}
              onChange={(v) => setBloque(v as BlockId)}
              opciones={BLOQUES.map((b) => ({ valor: b.id, etiqueta: b.nombre }))}
            />
          </Campo>
          <Campo label="Número">
            <input
              className="input num"
              type="number"
              min={1}
              value={numero}
              onChange={(e) => setNumero(Number(e.target.value))}
            />
          </Campo>
        </div>
        <Campo
          label="Epígrafes (uno por línea)"
          hint="Opcional. Sirve para marcar en qué epígrafe te quedas en blanco."
        >
          <textarea
            className="input min-h-[100px] resize-y font-mono text-[12.5px]"
            value={epigrafes}
            onChange={(e) => setEpigrafes(e.target.value)}
            placeholder={'Concepto\nElementos esenciales\nClases\nEficacia'}
          />
        </Campo>
        {tema && (
          <button onClick={() => onPrioritario(tema)} className="btn-secondary btn-sm w-full">
            {prioritario ? '★ Quitar de prioritarios' : '☆ Marcar como prioritario'}
          </button>
        )}
      </div>
    </Modal>
  )
}
