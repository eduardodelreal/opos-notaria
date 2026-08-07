#!/usr/bin/env node
/**
 * Crea un usuario de prueba en Supabase y le siembra ~7 meses de estudio
 * realista: primera vuelta de Civil casi cerrada, Mercantil e Hipotecario
 * empezados, temas oxidados, cantes con notas variables, tareas recurrentes
 * y un par de simulacros.
 *
 * Uso:
 *   SUPABASE_URL=https://xxx.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=eyJ... \
 *   DEMO_EMAIL=tu@email.com \
 *   DEMO_PASSWORD='UnaClaveSegura123' \
 *   node scripts/seed-demo.mjs
 *
 * Opcional:
 *   RESET=1     borra los datos previos de ese usuario antes de sembrar
 *   VACIO=1     crea el usuario sin datos de ejemplo
 *
 * La service role key salta RLS: úsala solo en local, nunca en el navegador
 * ni en variables de Netlify con prefijo VITE_.
 */

import { createClient } from '@supabase/supabase-js'

const URL = process.env.SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const EMAIL = process.env.DEMO_EMAIL
const PASSWORD = process.env.DEMO_PASSWORD
const RESET = process.env.RESET === '1'
const VACIO = process.env.VACIO === '1'

if (!URL || !KEY || !EMAIL || !PASSWORD) {
  console.error(
    'Faltan variables. Necesitas SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DEMO_EMAIL y DEMO_PASSWORD.',
  )
  process.exit(1)
}

const sb = createClient(URL, KEY, { auth: { persistSession: false } })

/* Debe coincidir con src/data/programa.ts */
const BLOQUES = [
  { id: 'civil', prefijo: 'CIVIL', total: 145 },
  { id: 'mercantil', prefijo: 'MERC', total: 60 },
  { id: 'hipotecario', prefijo: 'HIPO', total: 45 },
  { id: 'notarial', prefijo: 'NOT', total: 35 },
  { id: 'fiscal', prefijo: 'FISC', total: 25 },
  { id: 'admin_procesal', prefijo: 'ADM', total: 18 },
]

const temaId = (prefijo, n) => `${prefijo}_${String(n).padStart(3, '0')}`
const iso = (d) => d.toISOString().slice(0, 10)
const addDays = (d, n) => new Date(d.getTime() + n * 86400000)
const rnd = (a, b) => a + Math.random() * (b - a)
const rndInt = (a, b) => Math.floor(rnd(a, b + 1))
const pick = (xs) => xs[rndInt(0, xs.length - 1)]

const HOY = new Date()
const OBJETIVO = 12 * 60

/* ------------------------------------------------------------ 1. usuario -- */

async function obtenerOCrearUsuario() {
  const { data: lista, error: errLista } = await sb.auth.admin.listUsers({ perPage: 1000 })
  if (errLista) throw errLista
  const existente = lista.users.find((u) => u.email?.toLowerCase() === EMAIL.toLowerCase())

  if (existente) {
    const { error } = await sb.auth.admin.updateUserById(existente.id, {
      password: PASSWORD,
      email_confirm: true,
    })
    if (error) throw error
    console.log(`· Usuario ya existía: ${EMAIL} (contraseña actualizada)`)
    return existente.id
  }

  const { data, error } = await sb.auth.admin.createUser({
    email: EMAIL,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { nombre: 'Eduardo' },
  })
  if (error) throw error
  console.log(`· Usuario creado: ${EMAIL}`)
  return data.user.id
}

/* --------------------------------------------------------------- 2. datos -- */

/**
 * Perfil de opositor de 2º año: Civil muy rodado, Mercantil e Hipotecario en
 * primera vuelta, Notarial empezando, Fiscal y Admin sin tocar.
 */
const PLAN = {
  civil: { tocados: 118, dominados: 34, vueltasMax: 6 },
  mercantil: { tocados: 41, dominados: 6, vueltasMax: 3 },
  hipotecario: { tocados: 28, dominados: 3, vueltasMax: 3 },
  notarial: { tocados: 11, dominados: 0, vueltasMax: 2 },
  fiscal: { tocados: 4, dominados: 0, vueltasMax: 1 },
  admin_procesal: { tocados: 0, dominados: 0, vueltasMax: 0 },
}

const ESCALONES = [1, 3, 7, 14, 25, 40, 60, 90, 130, 180]

function calcularNota(calificacion, duracion, objetivo, lagunas) {
  const base = (calificacion - 1) * 2.5
  const ratio = duracion / objetivo
  let ajuste
  if (ratio > 1.05) ajuste = -Math.min(3.5, ((ratio - 1.05) / 0.1) * 0.9)
  else if (ratio < 0.88) ajuste = -Math.min(3.0, ((0.88 - ratio) / 0.1) * 0.8)
  else ajuste = 0.3
  const n = base + ajuste - Math.min(1.5, lagunas * 0.4)
  return Math.round(Math.max(0, Math.min(10, n)) * 10) / 10
}

function construir() {
  const progreso = []
  const cantes = []
  const sesiones = []
  const simulacros = []
  let contador = 0

  for (const b of BLOQUES) {
    const plan = PLAN[b.id]
    for (let n = 1; n <= plan.tocados; n++) {
      const id = temaId(b.prefijo, n)
      const esDominado = n <= plan.dominados
      const vueltas = esDominado
        ? rndInt(3, plan.vueltasMax)
        : rndInt(1, Math.max(1, plan.vueltasMax - 1))

      // Un 8% de los dominados llevan mucho sin cantarse → salen oxidados.
      const oxidado = esDominado && Math.random() < 0.08
      const diasDesdeUltimo = oxidado ? rndInt(80, 150) : esDominado ? rndInt(5, 55) : rndInt(1, 30)
      const ultimo = addDays(HOY, -diasDesdeUltimo)
      const intervalo = ESCALONES[Math.min(ESCALONES.length - 1, vueltas + 1)]
      const notaMedia = esDominado ? rnd(7.6, 9.4) : rnd(4.2, 7.6)

      progreso.push({
        tema_id: id,
        estado: oxidado
          ? 'oxidado'
          : esDominado
            ? 'dominado'
            : vueltas <= 1
              ? 'primera_vuelta'
              : 'en_arrastre',
        vueltas,
        intervalo,
        facilidad: Math.round(rnd(1.8, 2.8) * 100) / 100,
        ultimo_cante: iso(ultimo),
        proxima_revision: iso(addDays(ultimo, intervalo)),
        nota_media: Math.round(notaMedia * 100) / 100,
        minutos_estudio: rndInt(90, 620),
        prioritario: Math.random() < 0.04,
        notas:
          Math.random() < 0.12
            ? 'Siempre me quedo en blanco en el epígrafe de los efectos frente a terceros.'
            : null,
      })

      // Un cante por vuelta, repartido hacia atrás en el tiempo.
      for (let v = 0; v < vueltas; v++) {
        const fecha = addDays(ultimo, -v * rndInt(12, 40) - rndInt(0, 3))
        if (fecha > HOY) continue
        // El opositor mejora con el tiempo: los cantes recientes salen mejor.
        const antiguedad = (HOY - fecha) / (HOY - addDays(HOY, -220))
        const calificacion = Math.max(
          1,
          Math.min(5, Math.round(rnd(esDominado ? 3.4 : 2.4, esDominado ? 5.2 : 4.2) - antiguedad)),
        )
        const duracion = Math.round(
          OBJETIVO * rnd(0.86, 1.2 - (esDominado ? 0.12 : 0)) * (1 + antiguedad * 0.07),
        )
        const lagunas = calificacion >= 4 ? rndInt(0, 1) : rndInt(1, 4)
        contador++
        cantes.push({
          id: `seed_cante_${contador}`,
          tema_id: id,
          fecha: fecha.toISOString(),
          duracion_segundos: duracion,
          objetivo_segundos: OBJETIVO,
          calificacion,
          nota: calcularNota(calificacion, duracion, OBJETIVO, lagunas),
          lagunas,
          ante_preparador: Math.random() < 0.2,
          comentarios:
            Math.random() < 0.18
              ? pick([
                  'El preparador me corta: me he ido por las ramas en la introducción.',
                  'Falta la STS de 2019. Estructura bien, contenido flojo al final.',
                  'Muy bien de tiempo, pero he confundido dos artículos.',
                  'Se me ha olvidado citar la reforma. Repasar antes del siguiente cante.',
                ])
              : null,
          audio_path: null,
          audio_duracion: null,
          simulacro_id: null,
        })
      }
    }
  }

  // Sesiones de estudio de los últimos 180 días (con domingos flojos).
  const idsTocados = progreso.map((p) => p.tema_id)
  for (let d = 180; d >= 0; d--) {
    const fecha = addDays(HOY, -d)
    const dow = fecha.getDay()
    if (dow === 0 && Math.random() < 0.6) continue
    if (Math.random() < 0.08) continue // días perdidos: enfermedad, imprevistos
    const bloquesDia = rndInt(2, 4)
    for (let i = 0; i < bloquesDia; i++) {
      sesiones.push({
        id: `seed_ses_${d}_${i}`,
        tema_id: Math.random() < 0.8 ? pick(idsTocados) : null,
        fecha: new Date(
          fecha.getFullYear(),
          fecha.getMonth(),
          fecha.getDate(),
          8 + i * 3,
          rndInt(0, 50),
        ).toISOString(),
        minutos: rndInt(45, 150),
        tipo: pick(['lectura', 'esquema', 'memorizacion', 'memorizacion', 'dictamen']),
        notas: null,
      })
    }
  }

  // Dos simulacros recientes.
  for (let i = 0; i < 2; i++) {
    const fecha = addDays(HOY, -(7 + i * 21))
    const ids = Array.from({ length: 4 }, () => pick(idsTocados))
    simulacros.push({
      id: `seed_sim_${i}`,
      fecha: fecha.toISOString(),
      tema_ids: ids,
      duracion_total: rndInt(2700, 3400),
      nota_media: Math.round(rnd(5.4, 8.1) * 100) / 100,
      completado: true,
    })
  }

  const tareas = [
    {
      id: 'seed_tarea_cante',
      titulo: 'Cante diario de repaso (3 temas)',
      fecha: iso(addDays(HOY, -120)),
      hora: '09:00',
      duracion_estim: 60,
      recurrencia: { tipo: 'dias_laborables' },
      hasta: null,
      categoria: 'cante',
      tema_id: null,
      bloque_id: null,
      color: null,
      notas: 'Los que marque la cola del día, sin elegir yo.',
      completadas: Array.from({ length: 40 }, (_, i) => iso(addDays(HOY, -(i + 1) * 2))),
      saltadas: [],
      archivada: false,
    },
    {
      id: 'seed_tarea_prep',
      titulo: 'Cante ante el preparador',
      fecha: iso(addDays(HOY, -119)),
      hora: '18:30',
      duracion_estim: 90,
      recurrencia: { tipo: 'semanal', cada: 1, dias: [2] },
      hasta: null,
      categoria: 'preparador',
      tema_id: null,
      bloque_id: null,
      color: null,
      notas: '4 temas: 2 de Civil y 2 del bloque de la semana.',
      completadas: Array.from({ length: 14 }, (_, i) => iso(addDays(HOY, -(i + 1) * 7))),
      saltadas: [],
      archivada: false,
    },
    {
      id: 'seed_tarea_dictamen',
      titulo: 'Dictamen semanal',
      fecha: iso(addDays(HOY, -117)),
      hora: '10:00',
      duracion_estim: 180,
      recurrencia: { tipo: 'semanal', cada: 1, dias: [6] },
      hasta: null,
      categoria: 'dictamen',
      tema_id: null,
      bloque_id: null,
      color: null,
      notas: null,
      completadas: [],
      saltadas: [],
      archivada: false,
    },
    {
      id: 'seed_tarea_fiscal',
      titulo: 'Repaso de Fiscal (bloque flojo)',
      fecha: iso(addDays(HOY, -60)),
      hora: null,
      duracion_estim: 120,
      recurrencia: { tipo: 'semanal', cada: 2, dias: [5] },
      hasta: null,
      categoria: 'repaso',
      tema_id: null,
      bloque_id: 'fiscal',
      color: null,
      notas: null,
      completadas: [],
      saltadas: [],
      archivada: false,
    },
    {
      id: 'seed_tarea_simulacro',
      titulo: 'Simulacro completo de ejercicio',
      fecha: iso(addDays(HOY, -90)),
      hora: '11:00',
      duracion_estim: 90,
      recurrencia: { tipo: 'mensual', cada: 1, diaMes: 1 },
      hasta: null,
      categoria: 'cante',
      tema_id: null,
      bloque_id: null,
      color: null,
      notas: 'Sortear en el bombo y cantar del tirón.',
      completadas: [],
      saltadas: [],
      archivada: false,
    },
    {
      id: 'seed_tarea_deporte',
      titulo: 'Correr 40 min',
      fecha: iso(addDays(HOY, -100)),
      hora: '20:00',
      duracion_estim: 40,
      recurrencia: { tipo: 'semanal', cada: 1, dias: [1, 3, 5] },
      hasta: null,
      categoria: 'personal',
      tema_id: null,
      bloque_id: null,
      color: null,
      notas: 'No negociable. Cinco años sentado no se aguantan de otra forma.',
      completadas: [],
      saltadas: [],
      archivada: false,
    },
  ]

  // Días cumplidos: los últimos 5 meses con algún hueco.
  const diasCumplidos = []
  for (let d = 150; d >= 1; d--) {
    const f = addDays(HOY, -d)
    if (f.getDay() === 0 && Math.random() < 0.5) continue
    if (Math.random() < 0.1) continue
    diasCumplidos.push(iso(f))
  }
  // Racha limpia de los últimos 12 días para que se vea bonita en el panel.
  for (let d = 12; d >= 1; d--) {
    const f = iso(addDays(HOY, -d))
    if (!diasCumplidos.includes(f)) diasCumplidos.push(f)
  }

  return { progreso, cantes, sesiones, tareas, simulacros, diasCumplidos: diasCumplidos.sort() }
}

/* ------------------------------------------------------------- 3. inserta -- */

async function insertarPorLotes(tabla, filas, userId, tam = 400) {
  for (let i = 0; i < filas.length; i += tam) {
    const lote = filas.slice(i, i + tam).map((f) => ({ ...f, user_id: userId }))
    const { error } = await sb.from(tabla).upsert(lote)
    if (error) throw new Error(`${tabla}: ${error.message}`)
  }
  console.log(`· ${tabla}: ${filas.length} filas`)
}

async function main() {
  const userId = await obtenerOCrearUsuario()

  if (RESET) {
    for (const t of ['cantes', 'sesiones', 'tareas', 'simulacros', 'progreso', 'temas_usuario']) {
      const { error } = await sb.from(t).delete().eq('user_id', userId)
      if (error) throw new Error(`limpiando ${t}: ${error.message}`)
    }
    console.log('· Datos anteriores borrados')
  }

  const ajustes = {
    nombre: 'Eduardo',
    oposicion: 'notarias',
    fechaInicio: iso(addDays(HOY, -680)),
    fechaExamen: iso(addDays(HOY, 240)),
    objetivoCanteSegundos: OBJETIVO,
    objetivoEjercicioSegundos: 3600,
    temasPorEjercicio: 4,
    metaHorasDia: 9,
    metaCantesDia: 3,
    metaCantesSemana: 18,
    preparadorNombre: 'D. Ignacio Vidal, notario de Madrid',
    diaPreparador: 2,
    grabarAudio: true,
    avisoSonoro: true,
    modoCiegoPorDefecto: false,
    factorSrs: 1,
    umbralOxido: 75,
  }

  if (VACIO) {
    const { error } = await sb
      .from('perfiles')
      .upsert({ id: userId, ajustes, dias_cumplidos: [], logros: [] })
    if (error) throw error
    console.log('\n✓ Usuario listo, sin datos de ejemplo.')
    console.log(`  Email: ${EMAIL}\n  Contraseña: ${PASSWORD}`)
    return
  }

  const d = construir()

  const { error: errPerfil } = await sb.from('perfiles').upsert({
    id: userId,
    ajustes,
    dias_cumplidos: d.diasCumplidos,
    logros: ['primer_cante', 'cantes_50', 'cantes_250', 'reloj_suizo', 'racha_7', 'simulacro'],
  })
  if (errPerfil) throw errPerfil
  console.log('· perfiles: 1 fila')

  await insertarPorLotes('progreso', d.progreso, userId)
  await insertarPorLotes('cantes', d.cantes, userId)
  await insertarPorLotes('sesiones', d.sesiones, userId)
  await insertarPorLotes('tareas', d.tareas, userId)
  await insertarPorLotes('simulacros', d.simulacros, userId)

  const horas = Math.round(d.sesiones.reduce((a, s) => a + s.minutos, 0) / 60)
  console.log('\n✓ Usuario de prueba listo.')
  console.log(`  Email:      ${EMAIL}`)
  console.log(`  Contraseña: ${PASSWORD}`)
  console.log(
    `  Sembrado:   ${d.progreso.length} temas con progreso · ${d.cantes.length} cantes · ${horas} h de estudio · ${d.tareas.length} tareas`,
  )
  console.log('\n  Entra en la app y verás el panel con datos reales desde el primer segundo.')
}

main().catch((e) => {
  console.error('\n✗ Error:', e.message)
  process.exit(1)
})
