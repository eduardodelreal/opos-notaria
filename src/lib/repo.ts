import type {
  AppData,
  Ajustes,
  Block,
  Cante,
  ProgresoTema,
  SesionEstudio,
  Simulacro,
  Tarea,
  Tema,
} from './types'
import { supabase } from './supabase'
import { datosVacios, DATA_VERSION } from './defaults'

/**
 * Dos drivers con la misma interfaz:
 *  - LocalRepo: localStorage. Se usa sin credenciales de Supabase o sin sesión.
 *  - SupabaseRepo: tablas normalizadas con RLS por usuario.
 *
 * La UI nunca sabe con cuál habla. Las escrituras son "write-through": el estado
 * en memoria se actualiza al instante y la persistencia va detrás.
 */
export interface Repo {
  readonly kind: 'local' | 'supabase'
  load(): Promise<AppData>
  saveAjustes(a: Ajustes): Promise<void>
  upsertProgreso(p: ProgresoTema): Promise<void>
  insertCante(c: Cante): Promise<void>
  updateCante(c: Cante): Promise<void>
  deleteCante(id: string): Promise<void>
  insertSesion(s: SesionEstudio): Promise<void>
  deleteSesion(id: string): Promise<void>
  upsertTarea(t: Tarea): Promise<void>
  deleteTarea(id: string): Promise<void>
  upsertTema(t: Tema): Promise<void>
  upsertTemas(ts: Tema[]): Promise<void>
  deleteTema(id: string): Promise<void>
  upsertBloque(b: Block): Promise<void>
  upsertBloques(bs: Block[]): Promise<void>
  deleteBloque(id: string): Promise<void>
  insertSimulacro(s: Simulacro): Promise<void>
  saveMeta(meta: { diasCumplidos: string[]; logros: string[] }): Promise<void>
  /** Sustituye todo el estado (importar copia de seguridad / reset). */
  replaceAll(data: AppData): Promise<void>
}

/* ------------------------------------------------------------------ local */

const LS_KEY = 'opos-notaria:data:v1'

export class LocalRepo implements Repo {
  readonly kind = 'local' as const
  private cache: AppData | null = null

  private read(): AppData {
    if (this.cache) return this.cache
    try {
      const raw = localStorage.getItem(LS_KEY)
      if (raw) {
        const parsed = JSON.parse(raw) as AppData
        // Todo el catálogo es del usuario: se guarda y se lee tal cual.
        this.cache = { ...datosVacios(), ...parsed, version: DATA_VERSION }
        return this.cache
      }
    } catch (e) {
      console.warn('[repo] datos locales corruptos, se reinicia', e)
    }
    this.cache = datosVacios()
    return this.cache
  }

  private write(mut: (d: AppData) => void): void {
    const d = this.read()
    mut(d)
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(d))
    } catch (e) {
      console.warn('[repo] no se pudo guardar en localStorage', e)
    }
  }

  async load(): Promise<AppData> {
    return structuredClone(this.read())
  }
  async saveAjustes(a: Ajustes) {
    this.write((d) => {
      d.ajustes = a
    })
  }
  async upsertProgreso(p: ProgresoTema) {
    this.write((d) => {
      d.progreso[p.temaId] = p
    })
  }
  async insertCante(c: Cante) {
    this.write((d) => {
      d.cantes = [c, ...d.cantes]
    })
  }
  async updateCante(c: Cante) {
    this.write((d) => {
      d.cantes = d.cantes.map((x) => (x.id === c.id ? c : x))
    })
  }
  async deleteCante(id: string) {
    this.write((d) => {
      d.cantes = d.cantes.filter((x) => x.id !== id)
    })
  }
  async insertSesion(s: SesionEstudio) {
    this.write((d) => {
      d.sesiones = [s, ...d.sesiones]
    })
  }
  async deleteSesion(id: string) {
    this.write((d) => {
      d.sesiones = d.sesiones.filter((x) => x.id !== id)
    })
  }
  async upsertTarea(t: Tarea) {
    this.write((d) => {
      const i = d.tareas.findIndex((x) => x.id === t.id)
      if (i >= 0) d.tareas[i] = t
      else d.tareas.push(t)
    })
  }
  async deleteTarea(id: string) {
    this.write((d) => {
      d.tareas = d.tareas.filter((x) => x.id !== id)
    })
  }
  async upsertTema(t: Tema) {
    this.write((d) => {
      const i = d.temas.findIndex((x) => x.id === t.id)
      if (i >= 0) d.temas[i] = t
      else d.temas.push(t)
    })
  }
  async upsertTemas(ts: Tema[]) {
    this.write((d) => {
      const idx = new Map(d.temas.map((t, i) => [t.id, i]))
      for (const t of ts) {
        const i = idx.get(t.id)
        if (i != null) d.temas[i] = t
        else d.temas.push(t)
      }
    })
  }
  async deleteTema(id: string) {
    this.write((d) => {
      d.temas = d.temas.filter((x) => x.id !== id)
      delete d.progreso[id]
    })
  }
  async upsertBloque(b: Block) {
    this.write((d) => {
      const i = d.bloques.findIndex((x) => x.id === b.id)
      if (i >= 0) d.bloques[i] = b
      else d.bloques.push(b)
    })
  }
  async upsertBloques(bs: Block[]) {
    this.write((d) => {
      for (const b of bs) {
        const i = d.bloques.findIndex((x) => x.id === b.id)
        if (i >= 0) d.bloques[i] = b
        else d.bloques.push(b)
      }
    })
  }
  async deleteBloque(id: string) {
    this.write((d) => {
      d.bloques = d.bloques.filter((x) => x.id !== id)
      const huerfanos = d.temas.filter((t) => t.bloque === id).map((t) => t.id)
      d.temas = d.temas.filter((t) => t.bloque !== id)
      for (const t of huerfanos) delete d.progreso[t]
    })
  }
  async insertSimulacro(s: Simulacro) {
    this.write((d) => {
      d.simulacros = [s, ...d.simulacros]
    })
  }
  async saveMeta(meta: { diasCumplidos: string[]; logros: string[] }) {
    this.write((d) => {
      d.diasCumplidos = meta.diasCumplidos
      d.logros = meta.logros
    })
  }
  async replaceAll(data: AppData) {
    this.cache = data
    localStorage.setItem(LS_KEY, JSON.stringify(data))
  }
}

/* --------------------------------------------------------------- supabase */

function must() {
  if (!supabase) throw new Error('Supabase no configurado')
  return supabase
}

export class SupabaseRepo implements Repo {
  readonly kind = 'supabase' as const
  constructor(private userId: string) {}

  private get uid() {
    return this.userId
  }

  async load(): Promise<AppData> {
    const sb = must()
    const [perfil, bloques, temas, progreso, cantes, sesiones, tareas, simulacros] =
      await Promise.all([
        sb.from('perfiles').select('*').eq('id', this.uid).maybeSingle(),
        sb.from('bloques').select('*').eq('user_id', this.uid).order('orden'),
        sb.from('temas').select('*').eq('user_id', this.uid).order('numero'),
        sb.from('progreso').select('*').eq('user_id', this.uid),
        sb.from('cantes').select('*').eq('user_id', this.uid).order('fecha', { ascending: false }),
        sb.from('sesiones').select('*').eq('user_id', this.uid).order('fecha', { ascending: false }),
        sb.from('tareas').select('*').eq('user_id', this.uid),
        sb
          .from('simulacros')
          .select('*')
          .eq('user_id', this.uid)
          .order('fecha', { ascending: false }),
      ])

    const base = datosVacios()

    // Perfil: si no existe todavía, se crea con los valores por defecto.
    if (perfil.data) {
      base.ajustes = { ...base.ajustes, ...(perfil.data.ajustes ?? {}) }
      base.diasCumplidos = perfil.data.dias_cumplidos ?? []
      base.logros = perfil.data.logros ?? []
    } else {
      await sb.from('perfiles').upsert({
        id: this.uid,
        ajustes: base.ajustes,
        dias_cumplidos: [],
        logros: [],
      })
    }

    // Materias y temas: todo es del usuario, no hay catálogo base que reconciliar.
    base.bloques = (bloques.data ?? []).map((r) => ({
      id: r.bloque_id,
      nombre: r.nombre,
      ejercicio: r.ejercicio,
      color: r.color,
      colorSoft: r.color_soft,
      colorText: r.color_text,
      orden: r.orden,
    }))

    base.temas = (temas.data ?? []).map((r) => ({
      id: r.tema_id,
      bloque: r.bloque_id,
      numero: r.numero,
      titulo: r.titulo,
      excluido: r.excluido ?? false,
      epigrafes: r.epigrafes ?? undefined,
      creadoEn: r.creado_en?.slice(0, 10),
    }))

    for (const r of progreso.data ?? []) {
      base.progreso[r.tema_id] = {
        temaId: r.tema_id,
        estado: r.estado,
        vueltas: r.vueltas,
        intervalo: r.intervalo,
        facilidad: Number(r.facilidad),
        ultimoCante: r.ultimo_cante,
        proximaRevision: r.proxima_revision,
        notaMedia: r.nota_media == null ? null : Number(r.nota_media),
        minutosEstudio: r.minutos_estudio ?? 0,
        prioritario: r.prioritario ?? false,
        notas: r.notas ?? undefined,
      }
    }

    base.cantes = (cantes.data ?? []).map((r) => ({
      id: r.id,
      temaId: r.tema_id,
      fecha: r.fecha,
      duracionSegundos: r.duracion_segundos,
      objetivoSegundos: r.objetivo_segundos,
      calificacion: r.calificacion,
      nota: Number(r.nota),
      lagunas: r.lagunas ?? 0,
      antePreparador: r.ante_preparador ?? false,
      comentarios: r.comentarios ?? undefined,
      audioPath: r.audio_path,
      audioDuracion: r.audio_duracion ?? undefined,
      simulacroId: r.simulacro_id ?? undefined,
    }))

    base.sesiones = (sesiones.data ?? []).map((r) => ({
      id: r.id,
      temaId: r.tema_id,
      fecha: r.fecha,
      minutos: r.minutos,
      tipo: r.tipo,
      notas: r.notas ?? undefined,
    }))

    base.tareas = (tareas.data ?? []).map((r) => ({
      id: r.id,
      titulo: r.titulo,
      fecha: r.fecha,
      hora: r.hora,
      duracionEstim: r.duracion_estim ?? undefined,
      recurrencia: r.recurrencia ?? { tipo: 'ninguna' },
      hasta: r.hasta,
      categoria: r.categoria,
      temaId: r.tema_id,
      bloqueId: r.bloque_id,
      color: r.color ?? undefined,
      notas: r.notas ?? undefined,
      completadas: r.completadas ?? [],
      saltadas: r.saltadas ?? [],
      archivada: r.archivada ?? false,
    }))

    base.simulacros = (simulacros.data ?? []).map((r) => ({
      id: r.id,
      fecha: r.fecha,
      temaIds: r.tema_ids ?? [],
      duracionTotal: r.duracion_total,
      notaMedia: Number(r.nota_media),
      completado: r.completado,
    }))

    return base
  }

  async saveAjustes(a: Ajustes) {
    await must().from('perfiles').upsert({ id: this.uid, ajustes: a })
  }

  async saveMeta(meta: { diasCumplidos: string[]; logros: string[] }) {
    await must()
      .from('perfiles')
      .upsert({ id: this.uid, dias_cumplidos: meta.diasCumplidos, logros: meta.logros })
  }

  async upsertProgreso(p: ProgresoTema) {
    await must()
      .from('progreso')
      .upsert(
        {
          user_id: this.uid,
          tema_id: p.temaId,
          estado: p.estado,
          vueltas: p.vueltas,
          intervalo: p.intervalo,
          facilidad: p.facilidad,
          ultimo_cante: p.ultimoCante,
          proxima_revision: p.proximaRevision,
          nota_media: p.notaMedia,
          minutos_estudio: p.minutosEstudio,
          prioritario: p.prioritario ?? false,
          notas: p.notas ?? null,
        },
        { onConflict: 'user_id,tema_id' },
      )
  }

  private canteRow(c: Cante) {
    return {
      id: c.id,
      user_id: this.uid,
      tema_id: c.temaId,
      fecha: c.fecha,
      duracion_segundos: c.duracionSegundos,
      objetivo_segundos: c.objetivoSegundos,
      calificacion: c.calificacion,
      nota: c.nota,
      lagunas: c.lagunas,
      ante_preparador: c.antePreparador,
      comentarios: c.comentarios ?? null,
      audio_path: c.audioPath ?? null,
      audio_duracion: c.audioDuracion ?? null,
      simulacro_id: c.simulacroId ?? null,
    }
  }

  async insertCante(c: Cante) {
    await must().from('cantes').insert(this.canteRow(c))
  }
  async updateCante(c: Cante) {
    await must().from('cantes').upsert(this.canteRow(c))
  }
  async deleteCante(id: string) {
    await must().from('cantes').delete().eq('id', id).eq('user_id', this.uid)
  }

  async insertSesion(s: SesionEstudio) {
    await must().from('sesiones').insert({
      id: s.id,
      user_id: this.uid,
      tema_id: s.temaId,
      fecha: s.fecha,
      minutos: s.minutos,
      tipo: s.tipo,
      notas: s.notas ?? null,
    })
  }
  async deleteSesion(id: string) {
    await must().from('sesiones').delete().eq('id', id).eq('user_id', this.uid)
  }

  async upsertTarea(t: Tarea) {
    await must()
      .from('tareas')
      .upsert({
        id: t.id,
        user_id: this.uid,
        titulo: t.titulo,
        fecha: t.fecha,
        hora: t.hora ?? null,
        duracion_estim: t.duracionEstim ?? null,
        recurrencia: t.recurrencia,
        hasta: t.hasta ?? null,
        categoria: t.categoria,
        tema_id: t.temaId ?? null,
        bloque_id: t.bloqueId ?? null,
        color: t.color ?? null,
        notas: t.notas ?? null,
        completadas: t.completadas,
        saltadas: t.saltadas,
        archivada: t.archivada ?? false,
      })
  }
  async deleteTarea(id: string) {
    await must().from('tareas').delete().eq('id', id).eq('user_id', this.uid)
  }

  private temaRow(t: Tema) {
    return {
      user_id: this.uid,
      tema_id: t.id,
      bloque_id: t.bloque,
      numero: t.numero,
      titulo: t.titulo,
      excluido: t.excluido ?? false,
      epigrafes: t.epigrafes ?? null,
    }
  }

  async upsertTema(t: Tema) {
    const { error } = await must()
      .from('temas')
      .upsert(this.temaRow(t), { onConflict: 'user_id,tema_id' })
    if (error) throw error
  }

  async upsertTemas(ts: Tema[]) {
    if (!ts.length) return
    const sb = must()
    // Por lotes: pegar un temario entero son cientos de filas de golpe.
    for (let i = 0; i < ts.length; i += 300) {
      const { error } = await sb
        .from('temas')
        .upsert(ts.slice(i, i + 300).map((t) => this.temaRow(t)), {
          onConflict: 'user_id,tema_id',
        })
      if (error) throw error
    }
  }

  async deleteTema(id: string) {
    const sb = must()
    await sb.from('temas').delete().eq('tema_id', id).eq('user_id', this.uid)
    await sb.from('progreso').delete().eq('tema_id', id).eq('user_id', this.uid)
  }

  private bloqueRow(b: Block) {
    return {
      user_id: this.uid,
      bloque_id: b.id,
      nombre: b.nombre,
      ejercicio: b.ejercicio,
      color: b.color,
      color_soft: b.colorSoft,
      color_text: b.colorText,
      orden: b.orden,
    }
  }

  async upsertBloque(b: Block) {
    const { error } = await must()
      .from('bloques')
      .upsert(this.bloqueRow(b), { onConflict: 'user_id,bloque_id' })
    if (error) throw error
  }

  async upsertBloques(bs: Block[]) {
    if (!bs.length) return
    const { error } = await must()
      .from('bloques')
      .upsert(bs.map((b) => this.bloqueRow(b)), { onConflict: 'user_id,bloque_id' })
    if (error) throw error
  }

  async deleteBloque(id: string) {
    const sb = must()
    // Los temas de la materia caen con ella (y su progreso, por la FK).
    const { data } = await sb.from('temas').select('tema_id').eq('user_id', this.uid).eq('bloque_id', id)
    const ids = (data ?? []).map((r) => r.tema_id)
    if (ids.length) await sb.from('progreso').delete().eq('user_id', this.uid).in('tema_id', ids)
    await sb.from('temas').delete().eq('user_id', this.uid).eq('bloque_id', id)
    await sb.from('bloques').delete().eq('user_id', this.uid).eq('bloque_id', id)
  }

  async insertSimulacro(s: Simulacro) {
    await must().from('simulacros').insert({
      id: s.id,
      user_id: this.uid,
      fecha: s.fecha,
      tema_ids: s.temaIds,
      duracion_total: s.duracionTotal,
      nota_media: s.notaMedia,
      completado: s.completado,
    })
  }

  async replaceAll(data: AppData) {
    const sb = must()
    // Borrado en orden inverso a las dependencias.
    await Promise.all([
      sb.from('cantes').delete().eq('user_id', this.uid),
      sb.from('sesiones').delete().eq('user_id', this.uid),
      sb.from('tareas').delete().eq('user_id', this.uid),
      sb.from('simulacros').delete().eq('user_id', this.uid),
      sb.from('progreso').delete().eq('user_id', this.uid),
      sb.from('temas').delete().eq('user_id', this.uid),
    ])
    await sb.from('bloques').delete().eq('user_id', this.uid)
    await this.saveAjustes(data.ajustes)
    await this.saveMeta({ diasCumplidos: data.diasCumplidos, logros: data.logros })
    await this.upsertBloques(data.bloques)
    await this.upsertTemas(data.temas)
    for (const p of Object.values(data.progreso)) await this.upsertProgreso(p)
    for (const c of data.cantes) await this.insertCante(c)
    for (const s of data.sesiones) await this.insertSesion(s)
    for (const t of data.tareas) await this.upsertTarea(t)
    for (const s of data.simulacros) await this.insertSimulacro(s)
  }
}
