import type { Cante, EstadoTema, ProgresoTema, Sesion, Tema } from "./types";
import { DIA_MS, claveDia, inicioSemana } from "../utils/time";
import { temasVivos, vivos, vivosMapa } from "./vivos";

/*
   Estas funciones reciben colecciones del store, y el store guarda las
   tumbas del borrado lógico. Filtran en la entrada —`vivos()` devuelve el
   mismo array cuando no hay ninguna, así que no cuesta nada— para que un
   tema borrado no reaparezca en la cola de repaso ni sume en las
   estadísticas. Las `sesiones` no se filtran: no tienen tumba y sobreviven
   al borrado del tema a propósito.
*/

/* ============================================================
   Repaso espaciado adaptado a oposicion
   Anki reparte cartas; aqui repartimos TEMAS. El intervalo depende
   del estado, de la dificultad declarada, de la nota media de cante
   y de cuantas vueltas lleva dado. Un tema dominado con nota 9 y
   cuatro vueltas aguanta cinco semanas; uno cantable con un 5 vuelve
   en menos de una.
   ============================================================ */

const BASE_DIAS: Record<EstadoTema, number> = {
  nuevo: 1,
  estudiando: 3,
  cantable: 10,
  dominado: 26,
  oxidado: 1,
};

export function intervaloDias(p: ProgresoTema): number {
  const base = BASE_DIAS[p.estado] ?? 7;
  const dificultad = Math.min(5, Math.max(1, p.dificultad || 3));
  const fDificultad = 1.6 - 0.2 * dificultad; // 1 -> 1.4x  |  5 -> 0.6x
  const fNota = p.notaMedia == null ? 1 : 0.6 + (p.notaMedia / 10) * 0.8;
  const fVueltas = 1 + Math.min(p.vueltas || 0, 6) * 0.08;
  return Math.max(1, Math.round(base * fDificultad * fNota * fVueltas));
}

export function ultimoContacto(p: ProgresoTema): number | undefined {
  const v = [p.ultimoEstudio, p.ultimoCante].filter(Boolean) as number[];
  return v.length ? Math.max(...v) : undefined;
}

export function calcularProximoRepaso(p: ProgresoTema): number | undefined {
  const ultimo = ultimoContacto(p);
  if (!ultimo) return undefined;
  return ultimo + intervaloDias(p) * DIA_MS;
}

/**
 * Estado que se muestra en pantalla. Un tema dominado que lleva mas de
 * `diasOxido` sin tocarse se pinta oxidado aunque en base de datos siga
 * dominado: asi el mural no miente.
 */
export function estadoEfectivo(p: ProgresoTema, diasOxido: number): EstadoTema {
  if (p.estado !== "dominado" && p.estado !== "cantable") return p.estado;
  const ultimo = ultimoContacto(p);
  if (!ultimo) return p.estado;
  const dias = (Date.now() - ultimo) / DIA_MS;
  const umbral = p.estado === "dominado" ? diasOxido : Math.round(diasOxido * 0.6);
  return dias > umbral ? "oxidado" : p.estado;
}

/**
 * Urgencia de repaso. >1 significa que ya se ha pasado la fecha.
 * Se usa para ordenar la cola diaria.
 */
export function urgencia(p: ProgresoTema): number {
  const ultimo = ultimoContacto(p);
  if (!ultimo) return p.estado === "nuevo" ? 0 : 1;
  const intervalo = intervaloDias(p) * DIA_MS;
  return (Date.now() - ultimo) / intervalo;
}

export interface ItemCola {
  tema: Tema;
  progreso: ProgresoTema;
  urgencia: number;
  diasSinTocar: number;
}

export function colaDeRepaso(
  temas: Tema[],
  progresos: Record<string, ProgresoTema>,
  limite = 12,
): ItemCola[] {
  const vivosProgresos = vivosMapa(progresos);
  return temasVivos(temas)
    .map((tema) => {
      const progreso = vivosProgresos[tema.id];
      if (!progreso || progreso.estado === "nuevo") return null;
      const ultimo = ultimoContacto(progreso);
      return {
        tema,
        progreso,
        urgencia: urgencia(progreso),
        diasSinTocar: ultimo ? Math.floor((Date.now() - ultimo) / DIA_MS) : 999,
      };
    })
    .filter((x): x is ItemCola => x !== null && x.urgencia >= 0.85)
    .sort((a, b) => b.urgencia - a.urgencia)
    .slice(0, limite);
}

/* ============================================================
   Estadisticas
   ============================================================ */

export interface ResumenGlobal {
  totalTemas: number;
  porEstado: Record<EstadoTema, number>;
  segundosTotales: number;
  segundosSemana: number;
  segundosHoy: number;
  racha: number;
  cantesTotales: number;
  notaMedia: number | null;
  /** Porcentaje 0-100 de avance ponderado del programa. */
  avance: number;
}

const PESO_ESTADO: Record<EstadoTema, number> = {
  nuevo: 0,
  estudiando: 0.35,
  cantable: 0.75,
  dominado: 1,
  oxidado: 0.55,
};

export function resumenGlobal(
  temas: Tema[],
  progresos: Record<string, ProgresoTema>,
  sesiones: Sesion[],
  cantes: Cante[],
  diasOxido: number,
): ResumenGlobal {
  const porEstado: Record<EstadoTema, number> = {
    nuevo: 0,
    estudiando: 0,
    cantable: 0,
    dominado: 0,
    oxidado: 0,
  };

  let pesoAcumulado = 0;
  for (const tema of temasVivos(temas)) {
    const p = vivosMapa(progresos)[tema.id];
    const estado = p ? estadoEfectivo(p, diasOxido) : "nuevo";
    porEstado[estado] += 1;
    pesoAcumulado += PESO_ESTADO[estado];
  }

  const desdeSemana = inicioSemana();
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const desdeHoy = hoy.getTime();

  let segundosTotales = 0;
  let segundosSemana = 0;
  let segundosHoy = 0;
  for (const s of sesiones) {
    segundosTotales += s.segundos;
    if (s.inicio >= desdeSemana) segundosSemana += s.segundos;
    if (s.inicio >= desdeHoy) segundosHoy += s.segundos;
  }

  const vivosCantes = vivos(cantes);
  const notas = vivosCantes.map((c) => c.nota).filter((n): n is number => n != null);

  return {
    totalTemas: temasVivos(temas).length,
    porEstado,
    segundosTotales,
    segundosSemana,
    segundosHoy,
    racha: calcularRacha(sesiones),
    cantesTotales: vivosCantes.length,
    notaMedia: notas.length
      ? Number((notas.reduce((a, b) => a + b, 0) / notas.length).toFixed(1))
      : null,
    avance: temasVivos(temas).length
      ? (pesoAcumulado / temasVivos(temas).length) * 100
      : 0,
  };
}

/** Dias consecutivos con al menos una sesion. Hoy cuenta si ya has estudiado. */
export function calcularRacha(sesiones: Sesion[]): number {
  if (!sesiones.length) return 0;
  const dias = new Set(sesiones.map((s) => claveDia(s.inicio)));
  let racha = 0;
  const cursor = new Date();
  cursor.setHours(0, 0, 0, 0);
  if (!dias.has(claveDia(cursor.getTime()))) {
    cursor.setDate(cursor.getDate() - 1); // permitimos que hoy aun no haya empezado
  }
  while (dias.has(claveDia(cursor.getTime()))) {
    racha += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return racha;
}

/** Segundos por dia de los ultimos `dias` dias, del mas antiguo al mas reciente. */
export function serieDiaria(
  sesiones: Sesion[],
  dias = 364,
): { dia: string; ts: number; segundos: number }[] {
  const mapa = new Map<string, number>();
  for (const s of sesiones) {
    const k = claveDia(s.inicio);
    mapa.set(k, (mapa.get(k) ?? 0) + s.segundos);
  }
  const salida: { dia: string; ts: number; segundos: number }[] = [];
  const cursor = new Date();
  cursor.setHours(0, 0, 0, 0);
  cursor.setDate(cursor.getDate() - dias + 1);
  for (let i = 0; i < dias; i++) {
    const k = claveDia(cursor.getTime());
    salida.push({ dia: k, ts: cursor.getTime(), segundos: mapa.get(k) ?? 0 });
    cursor.setDate(cursor.getDate() + 1);
  }
  return salida;
}

export interface StatsMateria {
  materiaId: string;
  temas: number;
  dominados: number;
  segundos: number;
  notaMedia: number | null;
  avance: number;
}

export function statsPorMateria(
  temas: Tema[],
  progresos: Record<string, ProgresoTema>,
  cantes: Cante[],
  diasOxido: number,
): StatsMateria[] {
  const mapa = new Map<string, StatsMateria & { peso: number; notas: number[] }>();
  const cantesPorTema = new Map<string, number[]>();
  for (const c of vivos(cantes)) {
    if (c.nota == null) continue;
    const arr = cantesPorTema.get(c.temaId) ?? [];
    arr.push(c.nota);
    cantesPorTema.set(c.temaId, arr);
  }

  for (const tema of temasVivos(temas)) {
    const acc =
      mapa.get(tema.materiaId) ??
      ({
        materiaId: tema.materiaId,
        temas: 0,
        dominados: 0,
        segundos: 0,
        notaMedia: null,
        avance: 0,
        peso: 0,
        notas: [],
      } as StatsMateria & { peso: number; notas: number[] });

    const p = vivosMapa(progresos)[tema.id];
    const estado = p ? estadoEfectivo(p, diasOxido) : "nuevo";
    acc.temas += 1;
    acc.peso += PESO_ESTADO[estado];
    if (estado === "dominado") acc.dominados += 1;
    acc.segundos += p?.segundos ?? 0;
    acc.notas.push(...(cantesPorTema.get(tema.id) ?? []));
    mapa.set(tema.materiaId, acc);
  }

  return [...mapa.values()].map((a) => ({
    materiaId: a.materiaId,
    temas: a.temas,
    dominados: a.dominados,
    segundos: a.segundos,
    notaMedia: a.notas.length
      ? Number((a.notas.reduce((x, y) => x + y, 0) / a.notas.length).toFixed(1))
      : null,
    avance: a.temas ? (a.peso / a.temas) * 100 : 0,
  }));
}

export interface Prediccion {
  temasPorSemana: number;
  semanasRestantes: number | null;
  fechaEstimada: number | null;
  /** true si el ritmo actual no llega a la fecha de examen fijada. */
  vasJusto: boolean | null;
}

/**
 * Proyeccion de "listo para examen": ritmo de temas que pasan a dominado
 * en las ultimas 8 semanas, extrapolado a los que faltan. Es una regla
 * de tres honesta, no un modelo: por eso mostramos el ritmo, no solo la fecha.
 */
export function predecirFinalizacion(
  temas: Tema[],
  progresos: Record<string, ProgresoTema>,
  cantes: Cante[],
  fechaExamen?: string,
): Prediccion {
  const ventana = 8 * 7 * DIA_MS;
  const desde = Date.now() - ventana;

  const vivosTemas = temasVivos(temas);
  const vivosProgresos = vivosMapa(progresos);
  const dominadosRecientes = vivosTemas.filter((t) => {
    const p = vivosProgresos[t.id];
    if (!p || p.estado !== "dominado") return false;
    const ultimo = ultimoContacto(p);
    return !!ultimo && ultimo >= desde;
  }).length;

  const temasPorSemana = Number((dominadosRecientes / 8).toFixed(2));
  const pendientes = vivosTemas.filter((t) => {
    const p = vivosProgresos[t.id];
    return !p || p.estado !== "dominado";
  }).length;

  if (temasPorSemana <= 0 || pendientes === 0) {
    return {
      temasPorSemana,
      semanasRestantes: pendientes === 0 ? 0 : null,
      fechaEstimada: pendientes === 0 ? Date.now() : null,
      vasJusto: null,
    };
  }

  const semanasRestantes = Math.ceil(pendientes / temasPorSemana);
  const fechaEstimada = Date.now() + semanasRestantes * 7 * DIA_MS;
  const objetivo = fechaExamen ? new Date(fechaExamen).getTime() : null;

  return {
    temasPorSemana,
    semanasRestantes,
    fechaEstimada,
    vasJusto: objetivo ? fechaEstimada > objetivo : null,
  };
}

export interface Laguna {
  tema: Tema;
  segundos: number;
  notaMedia: number;
  motivo: string;
}

/**
 * Temas con muchas horas y mala nota: el problema no es tiempo, es metodo.
 * Es el aviso mas util que puede dar la app.
 */
export function detectarLagunas(
  temas: Tema[],
  progresos: Record<string, ProgresoTema>,
  cantes: Cante[],
  limite = 6,
): Laguna[] {
  const porTema = new Map<string, number[]>();
  for (const c of vivos(cantes)) {
    if (c.nota == null) continue;
    const arr = porTema.get(c.temaId) ?? [];
    arr.push(c.nota);
    porTema.set(c.temaId, arr);
  }

  const vivosTemas = temasVivos(temas);
  const vivosProgresos = vivosMapa(progresos);
  const horasMedias =
    vivosTemas.reduce((acc, t) => acc + (vivosProgresos[t.id]?.segundos ?? 0), 0) /
    Math.max(1, vivosTemas.length);

  const salida: Laguna[] = [];
  for (const tema of vivosTemas) {
    const notas = porTema.get(tema.id);
    if (!notas || notas.length < 2) continue;
    const media = notas.reduce((a, b) => a + b, 0) / notas.length;
    const segundos = vivosProgresos[tema.id]?.segundos ?? 0;
    if (media >= 6.5) continue;
    if (segundos < horasMedias) continue;
    salida.push({
      tema,
      segundos,
      notaMedia: Number(media.toFixed(1)),
      motivo:
        media < 5
          ? "Muchas horas y nota baja: revisa el método, no le eches más tiempo"
          : "Horas por encima de la media sin que suba la nota",
    });
  }

  return salida.sort((a, b) => a.notaMedia - b.notaMedia).slice(0, limite);
}

/** Epigrafes que se caen una y otra vez, agregados de todos los cantes. */
export function epigrafesProblematicos(
  cantes: Cante[],
  limite = 8,
): { titulo: string; temaId: string; fallos: number; veces: number }[] {
  const mapa = new Map<
    string,
    { titulo: string; temaId: string; fallos: number; veces: number }
  >();
  for (const c of vivos(cantes)) {
    for (const e of c.epigrafes) {
      const clave = `${c.temaId}::${e.epigrafeId}`;
      const acc =
        mapa.get(clave) ??
        { titulo: e.titulo, temaId: c.temaId, fallos: 0, veces: 0 };
      acc.fallos += e.fallos.length;
      acc.veces += 1;
      mapa.set(clave, acc);
    }
  }
  return [...mapa.values()]
    .filter((x) => x.fallos > 0)
    .sort((a, b) => b.fallos / b.veces - a.fallos / a.veces)
    .slice(0, limite);
}
