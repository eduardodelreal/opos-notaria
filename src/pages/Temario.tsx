import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '@/store/AppStore'
import { ESTADOS, progresoVacio, riesgo } from '@/lib/srs'
import { fmtDuracion, fmtHoras, fmtRelativo, hoy } from '@/lib/dates'
import { cn, colorNota, copiar, pct, uid } from '@/lib/utils'
import {
  Campo,
  Card,
  Chip,
  Modal,
  Select,
  Tabs,
  useConfirmar,
  Vacio,
} from '@/components/ui'
import { Progreso } from '@/components/charts'
import { enlaceParaPreparador, urlAudio } from '@/lib/audio'
import {
  PALETA,
  bloqueDe,
  crearBloque,
  mapaBloques,
  ordenarBloques,
  parsearTemas,
  siguienteNumero,
} from '@/lib/bloques'
import type { Block, BlockId, EstadoTema, Tema } from '@/lib/types'

type Orden = 'programa' | 'riesgo' | 'nota' | 'reciente' | 'nuevos'

export function Temario() {
  const { data, guardarTema, guardarTemas, borrarTema, guardarProgreso } = useApp()
  const nav = useNavigate()
  const { temas, progreso, bloques } = data
  const h = hoy()

  const [bloqueSel, setBloqueSel] = useState<'todos' | BlockId>('todos')
  const [estado, setEstado] = useState<'todos' | EstadoTema>('todos')
  const [busca, setBusca] = useState('')
  const [orden, setOrden] = useState<Orden>('programa')
  const [abierto, setAbierto] = useState<string | null>(null)
  const [editando, setEditando] = useState<Tema | null>(null)
  const [creando, setCreando] = useState(false)
  const [pegando, setPegando] = useState(false)
  const [gestionandoMaterias, setGestionandoMaterias] = useState(false)
  const confirmar = useConfirmar()

  const mapaB = useMemo(() => mapaBloques(bloques), [bloques])
  const bloquesOrd = useMemo(() => ordenarBloques(bloques), [bloques])

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase()
    const orderBloque = new Map(bloquesOrd.map((b, i) => [b.id, i]))
    let out = temas.filter((t) => {
      if (bloqueSel !== 'todos' && t.bloque !== bloqueSel) return false
      const e = progreso[t.id]?.estado ?? 'no_tocado'
      if (estado !== 'todos' && e !== estado) return false
      if (!q) return true
      return t.titulo.toLowerCase().includes(q) || `${t.numero}` === q
    })
    out = [...out].sort((a, b) => {
      if (orden === 'programa') {
        const d = (orderBloque.get(a.bloque) ?? 99) - (orderBloque.get(b.bloque) ?? 99)
        return d !== 0 ? d : a.numero - b.numero
      }
      const pa = progreso[a.id] ?? progresoVacio(a.id)
      const pb = progreso[b.id] ?? progresoVacio(b.id)
      if (orden === 'riesgo') {
        const ra = pa.estado === 'no_tocado' ? 100 : riesgo(pa, h)
        const rb = pb.estado === 'no_tocado' ? 100 : riesgo(pb, h)
        return rb - ra
      }
      if (orden === 'nota') return (pa.notaMedia ?? 99) - (pb.notaMedia ?? 99)
      if (orden === 'nuevos') return (b.creadoEn ?? '').localeCompare(a.creadoEn ?? '')
      return (pa.ultimoCante ?? '9999').localeCompare(pb.ultimoCante ?? '9999')
    })
    return out
  }, [temas, progreso, bloqueSel, estado, busca, orden, h, bloquesOrd])

  const resumenBloques = useMemo(
    () =>
      bloquesOrd.map((b) => {
        const ts = temas.filter((t) => t.bloque === b.id && !t.excluido)
        const dominados = ts.filter((t) => progreso[t.id]?.estado === 'dominado').length
        const tocados = ts.filter(
          (t) => (progreso[t.id]?.estado ?? 'no_tocado') !== 'no_tocado',
        ).length
        return { bloque: b, total: ts.length, dominados, tocados }
      }),
    [bloquesOrd, temas, progreso],
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

  const activos = temas.filter((t) => !t.excluido).length

  /* ------------------------------------------------------ estado vacío -- */

  if (temas.length === 0) {
    return (
      <>
        <TemarioVacio
          hayMaterias={bloques.length > 0}
          onPegar={() => setPegando(true)}
          onCrearMateria={() => setGestionandoMaterias(true)}
          onCrearTema={() => setCreando(true)}
        />
        <PegarTemas abierto={pegando} cerrar={() => setPegando(false)} />
        <GestorMaterias
          abierto={gestionandoMaterias}
          cerrar={() => setGestionandoMaterias(false)}
        />
        <EditorTema
          abierto={creando}
          tema={null}
          cerrar={() => setCreando(false)}
          onGuardar={(t) => {
            void guardarTema(t)
            setCreando(false)
          }}
          onBorrar={() => {}}
          onExcluir={() => {}}
        />
      </>
    )
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-serif text-[30px] leading-tight">Tu temario</h1>
          <p className="mt-1 text-[13.5px] text-ink-500">
            {activos} {activos === 1 ? 'tema' : 'temas'} en {bloques.length}{' '}
            {bloques.length === 1 ? 'materia' : 'materias'}. Ve añadiendo los que te den en la
            academia.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setGestionandoMaterias(true)} className="btn-ghost">
            Materias
          </button>
          <button onClick={() => setPegando(true)} className="btn-secondary">
            Pegar lista
          </button>
          <button onClick={() => setCreando(true)} className="btn-primary">
            + Añadir temas
          </button>
        </div>
      </header>

      {/* Resumen por materia */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {resumenBloques.map(({ bloque: b, total, dominados, tocados }) => (
          <button
            key={b.id}
            onClick={() => setBloqueSel(bloqueSel === b.id ? 'todos' : b.id)}
            className={cn(
              'card card-hover p-4 text-left',
              bloqueSel === b.id && 'ring-4 ring-sage-100',
            )}
            style={bloqueSel === b.id ? { borderColor: b.color } : undefined}
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
              {total === 0 ? (
                'sin temas todavía'
              ) : (
                <>
                  <span className="num font-semibold" style={{ color: b.color }}>
                    {dominados}
                  </span>{' '}
                  dominados · {pct(dominados, total)}% · {b.ejercicio}º ejercicio
                </>
              )}
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
            value={bloqueSel}
            onChange={(v) => setBloqueSel(v)}
            opciones={[
              { valor: 'todos', etiqueta: 'Todas las materias' },
              ...bloquesOrd.map((b) => ({ valor: b.id, etiqueta: b.nombre })),
            ]}
          />
          <Select
            className="w-full sm:w-48"
            value={orden}
            onChange={(v) => setOrden(v as Orden)}
            opciones={[
              { valor: 'programa', etiqueta: 'Orden del programa' },
              { valor: 'riesgo', etiqueta: 'Más riesgo primero' },
              { valor: 'nota', etiqueta: 'Peor nota primero' },
              { valor: 'reciente', etiqueta: 'Cantado hace más' },
              { valor: 'nuevos', etiqueta: 'Añadidos hace poco' },
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
              const b = bloqueDe(mapaB, t.bloque)
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
        onGuardarVarios={(ts) => {
          void guardarTemas(ts)
          setCreando(false)
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

      <PegarTemas abierto={pegando} cerrar={() => setPegando(false)} />
      <GestorMaterias abierto={gestionandoMaterias} cerrar={() => setGestionandoMaterias(false)} />

      {confirmar.nodo}
    </div>
  )
}

/* ==================================================================== */
/*  Estado vacío                                                        */
/* ==================================================================== */

function TemarioVacio({
  hayMaterias,
  onPegar,
  onCrearMateria,
  onCrearTema,
}: {
  hayMaterias: boolean
  onPegar(): void
  onCrearMateria(): void
  onCrearTema(): void
}) {
  return (
    <div className="mx-auto max-w-2xl space-y-6 py-6">
      <header className="text-center">
        <h1 className="font-serif text-[32px] leading-tight">Tu temario está vacío</h1>
        <p className="mx-auto mt-2 max-w-md text-[14px] leading-relaxed text-ink-500">
          Y así debe empezar. Ve metiendo los temas según te los vayan dando en la academia: la
          app se construye contigo, no al revés.
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-3">
        <OpcionVacio
          icono="⌸"
          titulo="Pegar una lista"
          desc="Copia el temario del PDF o del WhatsApp de la academia y pégalo. Se numera solo."
          cta="Pegar lista"
          onClick={onPegar}
          destacado
        />
        <OpcionVacio
          icono="+"
          titulo="Uno a uno"
          desc="Escribe los temas a mano, seguidos, sin salir del cuadro."
          cta="Añadir temas"
          onClick={onCrearTema}
          deshabilitado={!hayMaterias}
          motivo="Crea antes una materia"
        />
        <OpcionVacio
          icono="◫"
          titulo="Crear materias"
          desc="Civil, Mercantil, Hipotecario… o las que use tu preparador."
          cta="Gestionar materias"
          onClick={onCrearMateria}
        />
      </div>

      <Card className="bg-canvas/60">
        <p className="label mb-2">Por si te sirve</p>
        <ul className="space-y-1.5 text-[12.5px] leading-snug text-ink-500">
          <li className="flex gap-2">
            <span className="text-sage-500">·</span>
            No hace falta que metas los 328 de golpe. Con los de esta semana ya puedes cantar y
            empezar a acumular datos.
          </li>
          <li className="flex gap-2">
            <span className="text-sage-500">·</span>
            El número y el título los pones tú: si tu preparador numera distinto, manda él.
          </li>
          <li className="flex gap-2">
            <span className="text-sage-500">·</span>
            Si algún día quieres el programa oficial completo como punto de partida, está en
            Ajustes → Cargar plantilla. Después es tuyo y lo editas.
          </li>
        </ul>
      </Card>
    </div>
  )
}

function OpcionVacio({
  icono,
  titulo,
  desc,
  cta,
  onClick,
  destacado,
  deshabilitado,
  motivo,
}: {
  icono: string
  titulo: string
  desc: string
  cta: string
  onClick(): void
  destacado?: boolean
  deshabilitado?: boolean
  motivo?: string
}) {
  return (
    <div
      className={cn(
        'card flex flex-col p-5',
        destacado && 'border-sage-200 bg-sage-50/40',
        deshabilitado && 'opacity-60',
      )}
    >
      <span
        className={cn(
          'mb-3 flex h-9 w-9 items-center justify-center rounded-xl text-[15px]',
          destacado ? 'bg-sage-600 text-white' : 'bg-ink-100 text-ink-400',
        )}
      >
        {icono}
      </span>
      <p className="text-[14px] font-semibold text-ink-900">{titulo}</p>
      <p className="mt-1 flex-1 text-[12px] leading-snug text-ink-500">{desc}</p>
      <button
        onClick={onClick}
        disabled={deshabilitado}
        className={cn('mt-4 w-full', destacado ? 'btn-primary btn-sm' : 'btn-secondary btn-sm')}
      >
        {deshabilitado ? motivo : cta}
      </button>
    </div>
  )
}

/* ==================================================================== */
/*  Pegar lista de temas                                                */
/* ==================================================================== */

function PegarTemas({ abierto, cerrar }: { abierto: boolean; cerrar(): void }) {
  const { data, guardarTemas, guardarBloque, mostrarAviso } = useApp()
  const [texto, setTexto] = useState('')
  const [destino, setDestino] = useState<string>('')
  const [materiaNueva, setMateriaNueva] = useState('')
  const [renumerar, setRenumerar] = useState(true)
  const [guardando, setGuardando] = useState(false)
  const bloquesOrd = useMemo(() => ordenarBloques(data.bloques), [data.bloques])

  useEffect(() => {
    if (abierto) {
      setTexto('')
      setMateriaNueva('')
      setDestino(bloquesOrd[0]?.id ?? '__nueva__')
    }
  }, [abierto, bloquesOrd])

  const parseadas = useMemo(() => parsearTemas(texto), [texto])
  const creaMateria = destino === '__nueva__'
  const puede = parseadas.length > 0 && (!creaMateria || materiaNueva.trim().length > 0)

  const importar = async () => {
    setGuardando(true)
    try {
      let bloqueId = destino
      if (creaMateria) {
        const b = crearBloque(materiaNueva, data.bloques)
        await guardarBloque(b)
        bloqueId = b.id
      }
      const base = renumerar ? 0 : siguienteNumero(data.temas, bloqueId) - 1
      const existentes = new Set(data.temas.map((t) => t.id))
      const nuevos: Tema[] = parseadas.map((l, i) => {
        const numero = l.numero ?? base + i + 1
        let id = `${bloqueId}_${String(numero).padStart(3, '0')}`
        // Si ya existe ese número, no pisamos el tema anterior.
        if (existentes.has(id)) id = `${bloqueId}_${String(numero).padStart(3, '0')}_${uid()}`
        existentes.add(id)
        return { id, bloque: bloqueId, numero, titulo: l.titulo, creadoEn: hoy() }
      })
      await guardarTemas(nuevos)
      mostrarAviso(
        `${nuevos.length} ${nuevos.length === 1 ? 'tema añadido' : 'temas añadidos'}.`,
        'ok',
      )
      cerrar()
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Modal
      abierto={abierto}
      cerrar={cerrar}
      titulo="Pegar una lista de temas"
      ancho="max-w-2xl"
      pie={
        <>
          <span className="mr-auto text-[12.5px] text-ink-500">
            {parseadas.length > 0 && (
              <>
                <span className="num font-bold text-sage-700">{parseadas.length}</span>{' '}
                {parseadas.length === 1 ? 'tema detectado' : 'temas detectados'}
              </>
            )}
          </span>
          <button className="btn-secondary btn-sm" onClick={cerrar}>
            Cancelar
          </button>
          <button
            className="btn-primary btn-sm"
            disabled={!puede || guardando}
            onClick={() => void importar()}
          >
            {guardando ? 'Añadiendo…' : `Añadir ${parseadas.length || ''}`.trim()}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Campo label="Materia de destino">
            <Select
              value={destino}
              onChange={setDestino}
              opciones={[
                ...bloquesOrd.map((b) => ({ valor: b.id, etiqueta: b.nombre })),
                { valor: '__nueva__', etiqueta: '+ Crear una materia nueva' },
              ]}
            />
          </Campo>
          {creaMateria && (
            <Campo label="Nombre de la materia">
              <input
                className="input"
                value={materiaNueva}
                onChange={(e) => setMateriaNueva(e.target.value)}
                placeholder="p. ej. Civil"
                autoFocus
              />
            </Campo>
          )}
        </div>

        <Campo
          label="Pega aquí el temario"
          hint="Un tema por línea. Detecta «1.», «Tema 2 -», «3)» y viñetas; si no hay número, los numera seguidos."
        >
          <textarea
            className="input min-h-[200px] resize-y font-mono text-[12.5px] leading-relaxed"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder={
              '1. El Derecho civil español. La codificación.\nTema 2 - Las fuentes del Derecho\n3) La costumbre y los usos jurídicos\n• La jurisprudencia'
            }
          />
        </Campo>

        <label className="flex items-center gap-2.5">
          <input
            type="checkbox"
            checked={renumerar}
            onChange={(e) => setRenumerar(e.target.checked)}
            className="h-4 w-4 rounded border-ink-300 accent-sage-600"
          />
          <span className="text-[13px] text-ink-700">
            Respetar los números de la lista{' '}
            <span className="text-ink-400">
              (si no, continúan a partir del último tema de la materia)
            </span>
          </span>
        </label>

        {parseadas.length > 0 && (
          <div>
            <p className="label mb-2">Vista previa</p>
            <ul className="max-h-52 space-y-1 overflow-y-auto rounded-xl border border-ink-100 bg-canvas/60 p-2.5">
              {parseadas.slice(0, 40).map((l, i) => (
                <li key={i} className="flex gap-2.5 text-[12.5px]">
                  <span className="num w-7 shrink-0 text-right font-bold text-sage-600">
                    {l.numero ?? i + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-ink-700">{l.titulo}</span>
                </li>
              ))}
              {parseadas.length > 40 && (
                <li className="pt-1 text-center text-[11.5px] text-ink-400">
                  …y {parseadas.length - 40} más
                </li>
              )}
            </ul>
          </div>
        )}
      </div>
    </Modal>
  )
}

/* ==================================================================== */
/*  Gestor de materias                                                  */
/* ==================================================================== */

function GestorMaterias({ abierto, cerrar }: { abierto: boolean; cerrar(): void }) {
  const { data, guardarBloque, borrarBloque } = useApp()
  const [nombre, setNombre] = useState('')
  const [ejercicio, setEjercicio] = useState<Block['ejercicio']>(1)
  const [editando, setEditando] = useState<Block | null>(null)
  const confirmar = useConfirmar()
  const bloquesOrd = useMemo(() => ordenarBloques(data.bloques), [data.bloques])
  const refNombre = useRef<HTMLInputElement>(null)

  const añadir = () => {
    const n = nombre.trim()
    if (!n) return
    void guardarBloque(crearBloque(n, data.bloques, { ejercicio }))
    setNombre('')
    refNombre.current?.focus()
  }

  const contarTemas = (id: BlockId) => data.temas.filter((t) => t.bloque === id).length

  return (
    <Modal abierto={abierto} cerrar={cerrar} titulo="Materias del programa" ancho="max-w-xl">
      <div className="space-y-5">
        <div className="rounded-2xl border border-ink-100 bg-canvas/60 p-4">
          <p className="label mb-2.5">Nueva materia</p>
          <div className="flex flex-wrap gap-2">
            <input
              ref={refNombre}
              className="input min-w-[160px] flex-1"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && añadir()}
              placeholder="Civil, Mercantil, Hipotecario…"
              autoFocus
            />
            <Select
              className="w-32"
              value={String(ejercicio)}
              onChange={(v) => setEjercicio(Number(v) as Block['ejercicio'])}
              opciones={[1, 2, 3, 4].map((n) => ({ valor: String(n), etiqueta: `${n}º ejerc.` }))}
            />
            <button onClick={añadir} disabled={!nombre.trim()} className="btn-primary btn-sm">
              Añadir
            </button>
          </div>
        </div>

        {bloquesOrd.length === 0 ? (
          <p className="py-4 text-center text-[13px] text-ink-400">
            Todavía no has creado ninguna materia.
          </p>
        ) : (
          <ul className="space-y-2">
            {bloquesOrd.map((b) => {
              const n = contarTemas(b.id)
              const enEdicion = editando?.id === b.id
              return (
                <li key={b.id} className="rounded-xl border border-ink-100 p-3">
                  {enEdicion ? (
                    <div className="space-y-3">
                      <input
                        className="input"
                        value={editando.nombre}
                        onChange={(e) => setEditando({ ...editando, nombre: e.target.value })}
                        autoFocus
                      />
                      <div className="flex flex-wrap gap-1.5">
                        {PALETA.map((c) => (
                          <button
                            key={c.color}
                            onClick={() =>
                              setEditando({
                                ...editando,
                                color: c.color,
                                colorSoft: c.colorSoft,
                                colorText: c.colorText,
                              })
                            }
                            title={c.nombre}
                            className={cn(
                              'h-7 w-7 rounded-lg transition-transform',
                              editando.color === c.color
                                ? 'scale-110 ring-2 ring-offset-2 ring-ink-300'
                                : 'hover:scale-105',
                            )}
                            style={{ background: c.color }}
                          />
                        ))}
                      </div>
                      <div className="flex items-center gap-2">
                        <Select
                          className="w-32"
                          value={String(editando.ejercicio)}
                          onChange={(v) =>
                            setEditando({ ...editando, ejercicio: Number(v) as Block['ejercicio'] })
                          }
                          opciones={[1, 2, 3, 4].map((x) => ({
                            valor: String(x),
                            etiqueta: `${x}º ejerc.`,
                          }))}
                        />
                        <button
                          className="btn-primary btn-sm ml-auto"
                          onClick={() => {
                            if (editando.nombre.trim()) void guardarBloque(editando)
                            setEditando(null)
                          }}
                        >
                          Guardar
                        </button>
                        <button className="btn-ghost btn-sm" onClick={() => setEditando(null)}>
                          Cancelar
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-3">
                      <span
                        className="h-8 w-2 shrink-0 rounded-full"
                        style={{ background: b.color }}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-[13.5px] font-semibold text-ink-900">{b.nombre}</p>
                        <p className="text-[11.5px] text-ink-400">
                          {n} {n === 1 ? 'tema' : 'temas'} · {b.ejercicio}º ejercicio
                        </p>
                      </div>
                      <button onClick={() => setEditando(b)} className="btn-ghost btn-sm px-2">
                        ✎
                      </button>
                      <button
                        onClick={() =>
                          confirmar.pedir(
                            n > 0
                              ? `Se borrará la materia «${b.nombre}» y sus ${n} temas, con su progreso. Los cantes se conservan en el historial.`
                              : `Se borrará la materia «${b.nombre}».`,
                            () => void borrarBloque(b.id),
                            true,
                          )
                        }
                        className="btn-ghost btn-sm px-2 text-clay-500"
                      >
                        ✕
                      </button>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
      {confirmar.nodo}
    </Modal>
  )
}

/* ==================================================================== */
/*  Ficha de tema                                                       */
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
  const mapaB = useMemo(() => mapaBloques(data.bloques), [data.bloques])
  const h = hoy()
  const confirmar = useConfirmar()

  useEffect(() => setNotas(p.notas ?? ''), [p.notas])

  if (!tema) return null
  const b = bloqueDe(mapaB, tema.bloque)
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

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <MiniDato label="Cantes" valor={`${cantes.length}`} />
          <MiniDato label="Horas" valor={fmtHoras(p.minutosEstudio)} />
          <MiniDato label="Intervalo" valor={p.intervalo > 0 ? `${p.intervalo} d` : '—'} />
          <MiniDato label="Riesgo" valor={`${p.estado === 'no_tocado' ? 100 : riesgo(p, h)}`} />
        </div>

        <div>
          <p className="label mb-2">Forzar estado</p>
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(ESTADOS) as EstadoTema[]).map((e) => (
              <button
                key={e}
                onClick={() => void guardarProgreso(temaId, { estado: e })}
                className={cn('chip transition-all', p.estado !== e && 'opacity-60 hover:opacity-100')}
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
              className={cn(
                'chip',
                p.prioritario ? 'bg-gold-100 text-gold-500' : 'bg-ink-100 text-ink-400',
              )}
            >
              {p.prioritario ? '★ prioritario' : '☆ marcar prioritario'}
            </button>
          </div>
        </div>

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

        {tema.epigrafes && tema.epigrafes.length > 0 && (
          <div>
            <p className="label mb-2">Epígrafes</p>
            <ol className="space-y-1 rounded-xl bg-canvas/60 p-3">
              {tema.epigrafes.map((e, i) => (
                <li key={i} className="flex gap-2 text-[12.5px] text-ink-600">
                  <span className="num text-ink-300">{i + 1}.</span>
                  {e}
                </li>
              ))}
            </ol>
          </div>
        )}

        <Campo label="Mis notas de este tema" hint="Se guardan al salir del campo.">
          <textarea
            className="input min-h-[90px] resize-y"
            value={notas}
            onChange={(e) => setNotas(e.target.value)}
            onBlur={() => void guardarProgreso(temaId, { notas })}
            placeholder="Epígrafes que siempre olvido, sentencias clave, estructura del cante…"
          />
        </Campo>

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
                  bloqueNombre={b.nombre}
                  onBorrar={() =>
                    confirmar.pedir(
                      'Se borrará este cante y su audio.',
                      () => void borrarCante(c.id),
                      true,
                    )
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
  bloqueNombre,
  onBorrar,
}: {
  cante: import('@/lib/types').Cante
  tema: Tema
  bloqueNombre: string
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
      const lineas = [
        `${data.ajustes.nombre || 'Opositor'} · cante grabado`,
        `${bloqueNombre} · Tema ${tema.numero}: ${tema.titulo}`,
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
/*  Editor / alta rápida de temas                                       */
/* ==================================================================== */

function EditorTema({
  abierto,
  tema,
  cerrar,
  onGuardar,
  onGuardarVarios,
  onBorrar,
  onExcluir,
  onPrioritario,
  prioritario,
}: {
  abierto: boolean
  tema: Tema | null
  cerrar(): void
  onGuardar(t: Tema): void
  onGuardarVarios?(ts: Tema[]): void
  onBorrar(id: string): void
  onExcluir(t: Tema): void
  onPrioritario?(t: Tema): void
  prioritario?: boolean
}) {
  const { data, guardarTema, mostrarAviso } = useApp()
  const [titulo, setTitulo] = useState('')
  const [bloque, setBloque] = useState<BlockId>('')
  const [numero, setNumero] = useState(1)
  const [epigrafes, setEpigrafes] = useState('')
  /** En alta rápida se van acumulando aquí antes de guardar de golpe. */
  const [cola, setCola] = useState<Tema[]>([])
  const refTitulo = useRef<HTMLTextAreaElement>(null)
  const bloquesOrd = useMemo(() => ordenarBloques(data.bloques), [data.bloques])
  const esAlta = !tema

  useEffect(() => {
    if (!abierto) return
    setCola([])
    setTitulo(tema?.titulo ?? '')
    setEpigrafes((tema?.epigrafes ?? []).join('\n'))
    const b = tema?.bloque ?? bloquesOrd[0]?.id ?? ''
    setBloque(b)
    setNumero(tema?.numero ?? (b ? siguienteNumero(data.temas, b) : 1))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abierto, tema])

  /** Al cambiar de materia en alta, propone el siguiente número libre. */
  const cambiarBloque = (b: BlockId) => {
    setBloque(b)
    if (esAlta) {
      const yaEnCola = cola.filter((t) => t.bloque === b).length
      setNumero(siguienteNumero(data.temas, b) + yaEnCola)
    }
  }

  const construir = (): Tema | null => {
    const tit = titulo.trim()
    if (!tit || !bloque) return null
    const eps = epigrafes
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
    const id = tema?.id ?? `${bloque}_${String(numero).padStart(3, '0')}_${uid()}`
    return {
      id,
      bloque,
      numero,
      titulo: tit,
      excluido: tema?.excluido,
      epigrafes: eps.length ? eps : undefined,
      creadoEn: tema?.creadoEn ?? hoy(),
    }
  }

  /** Guarda el actual y deja el cuadro listo para el siguiente. */
  const siguiente = () => {
    const t = construir()
    if (!t) return
    setCola((c) => [...c, t])
    void guardarTema(t)
    setTitulo('')
    setEpigrafes('')
    setNumero((n) => n + 1)
    refTitulo.current?.focus()
  }

  const terminar = () => {
    const t = construir()
    if (t) {
      if (esAlta && onGuardarVarios) onGuardarVarios([t])
      else onGuardar(t)
    } else if (cola.length) {
      mostrarAviso(
        `${cola.length} ${cola.length === 1 ? 'tema añadido' : 'temas añadidos'}.`,
        'ok',
      )
      cerrar()
    } else {
      cerrar()
    }
  }

  if (bloquesOrd.length === 0 && abierto) {
    return (
      <Modal abierto cerrar={cerrar} titulo="Antes, una materia" ancho="max-w-md">
        <p className="text-[13.5px] leading-relaxed text-ink-600">
          Los temas van dentro de una materia (Civil, Mercantil, la que uses). Crea al menos una
          desde el botón <strong>Materias</strong> y vuelve aquí.
        </p>
      </Modal>
    )
  }

  return (
    <Modal
      abierto={abierto}
      cerrar={cerrar}
      titulo={tema ? 'Editar tema' : 'Añadir temas'}
      ancho="max-w-xl"
      pie={
        <>
          {tema ? (
            <>
              <button className="btn-ghost btn-sm mr-auto" onClick={() => onExcluir(tema)}>
                {tema.excluido ? 'Volver a incluir' : 'Excluir del programa'}
              </button>
              <button
                className="btn-ghost btn-sm text-clay-500"
                onClick={() => onBorrar(tema.id)}
              >
                Borrar
              </button>
              <button className="btn-secondary btn-sm" onClick={cerrar}>
                Cancelar
              </button>
              <button className="btn-primary btn-sm" onClick={terminar}>
                Guardar
              </button>
            </>
          ) : (
            <>
              <span className="mr-auto text-[12.5px] text-ink-500">
                {cola.length > 0 && (
                  <>
                    <span className="num font-bold text-sage-700">{cola.length}</span> añadidos en
                    esta tanda
                  </>
                )}
              </span>
              <button
                className="btn-secondary btn-sm"
                disabled={!titulo.trim()}
                onClick={siguiente}
                title="Ctrl + Enter"
              >
                Guardar y seguir
              </button>
              <button className="btn-primary btn-sm" onClick={terminar}>
                {titulo.trim() ? 'Guardar y cerrar' : 'Cerrar'}
              </button>
            </>
          )}
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-[1fr_auto] gap-3">
          <Campo label="Materia">
            <Select
              value={bloque}
              onChange={cambiarBloque}
              opciones={bloquesOrd.map((b) => ({ valor: b.id, etiqueta: b.nombre }))}
            />
          </Campo>
          <Campo label="Nº">
            <input
              className="input num w-20 text-center"
              type="number"
              min={1}
              value={numero}
              onChange={(e) => setNumero(Number(e.target.value))}
            />
          </Campo>
        </div>

        <Campo
          label="Título del tema"
          hint={esAlta ? 'Ctrl + Enter guarda y deja el cuadro listo para el siguiente.' : undefined}
        >
          <textarea
            ref={refTitulo}
            className="input min-h-[72px] resize-y"
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault()
                if (esAlta) siguiente()
                else terminar()
              }
            }}
            placeholder="El negocio jurídico: concepto, elementos y clases."
            autoFocus
          />
        </Campo>

        <Campo
          label="Epígrafes (opcional, uno por línea)"
          hint="Útil para saber en qué punto te quedas en blanco."
        >
          <textarea
            className="input min-h-[80px] resize-y font-mono text-[12.5px]"
            value={epigrafes}
            onChange={(e) => setEpigrafes(e.target.value)}
            placeholder={'Concepto\nElementos esenciales\nClases\nEficacia'}
          />
        </Campo>

        {cola.length > 0 && (
          <div>
            <p className="label mb-1.5">Añadidos ahora</p>
            <ul className="max-h-32 space-y-1 overflow-y-auto rounded-xl bg-canvas/60 p-2.5">
              {[...cola].reverse().map((t) => (
                <li key={t.id} className="flex gap-2 text-[12px]">
                  <span className="num w-6 shrink-0 text-right font-bold text-sage-600">
                    {t.numero}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-ink-600">{t.titulo}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {tema && onPrioritario && (
          <button onClick={() => onPrioritario(tema)} className="btn-secondary btn-sm w-full">
            {prioritario ? '★ Quitar de prioritarios' : '☆ Marcar como prioritario'}
          </button>
        )}
      </div>
    </Modal>
  )
}
