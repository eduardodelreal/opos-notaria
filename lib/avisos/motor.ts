/**
 * El motor de decisión: dado el expediente de un opositor, ¿qué merece hoy
 * una notificación, si es que merece alguna?
 *
 * Tres reglas de producto mandan sobre todo lo demás:
 *
 *   1. **Un aviso solo si es accionable y concreto.** Nada de "vuelve a
 *      estudiar". Todos los textos de aquí nombran un tema por su número y su
 *      título, o una cifra que el opositor reconoce. Si no hay nada concreto
 *      que decir, se devuelve `null`: al que va al día no se le molesta.
 *   2. **Como mucho uno al día.** Dos notificaciones el mismo día convierten
 *      la app en spam y el opositor apaga los avisos para siempre.
 *   3. **No repetir el mismo aviso dos días seguidos.** Por eso las claves son
 *      estables (`oxido:tema:<id>`) y hay un historial: si ayer ya le dijimos
 *      lo del tema 33 y sigue sin tocarlo, hoy le decimos otra cosa.
 *
 * De qué avisar sale de `lib/data/srs.ts` —`colaDeRepaso`, `estadoEfectivo`,
 * `urgencia`, `intervaloDias`, `calcularRacha`—, que es la misma lógica que
 * pinta el mural y la cola de repaso. Reimplementarla aquí haría que la
 * notificación y la pantalla dijeran cosas distintas del mismo tema, que es el
 * peor fallo posible en algo que interrumpe a alguien.
 *
 * Este fichero es PURO: ni Supabase, ni red, ni navegador. Por eso se puede
 * probar con expedientes de mentira (scripts/prueba-motor-avisos.mjs).
 */

import type {
  Materia,
  ProgresoTema,
  Sesion,
  Simulacro,
  Tema,
} from "../data/types";
import {
  calcularRacha,
  colaDeRepaso,
  estadoEfectivo,
  intervaloDias,
  ultimoContacto,
  urgencia,
} from "../data/srs";
import { temasVivos, vivos, vivosMapa } from "../data/vivos";
import { DIA_MS, HORA, claveDia, inicioSemana } from "../utils/time";
import type { Aviso, AvisoEnviado, PerfilAvisos } from "./tipos";

/** Todo lo que hace falta saber de un opositor para decidir su aviso. */
/*
 * Los cantes NO están aquí y no es un olvido: lo que el SRS necesita de ellos
 * —la nota media— ya viaja en `ProgresoTema.notaMedia`, y bajarse el histórico
 * de cantes de todos los usuarios cada quince minutos sería mucho tráfico para
 * un dato que ya tenemos.
 */
export interface ExpedienteAvisos {
  materias: Materia[];
  temas: Tema[];
  progresos: Record<string, ProgresoTema>;
  sesiones: Sesion[];
  simulacros: Simulacro[];
  perfil: PerfilAvisos;
}

export interface OpcionesDecision {
  /**
   * El instante en que se decide. Por defecto ahora.
   *
   * OJO: `lib/data/srs.ts` usa `Date.now()` por dentro, así que esto no sirve
   * para viajar en el tiempo — sirve para que las cuentas de "hoy" y "esta
   * semana" sean deterministas en las pruebas. Tiene que ir a la par del
   * reloj real.
   */
  ahora?: number;
  /** Día local del usuario (YYYY-MM-DD). Por defecto, el día del proceso. */
  hoy?: string;
  /** Avisos ya enviados, para el tope diario y el anti-repetición. */
  historial?: AvisoEnviado[];
  /**
   * Días durante los que una clave ya usada no se repite. 2 = "ni hoy ni
   * mañana", que es literalmente "no dos días seguidos".
   */
  diasSinRepetir?: number;
}

/** Un aviso candidato. `temaId` solo se usa aquí dentro, para no duplicar. */
export interface Candidato extends Aviso {
  temaId?: string;
}

/* ============================================================
   Utilidades de texto
   La voz es la del resto de la app: seca y concreta. Ni signos de
   exclamación ni ánimos. Se le dice el dato y dónde tocar.
   ============================================================ */

const dias = (n: number) => `${n} ${n === 1 ? "día" : "días"}`;

/** "Derecho Hipotecario" → "Hipotecario". En 40 caracteres de notificación sobra. */
function materiaCorta(m: Materia | undefined): string {
  if (!m) return "";
  return m.nombre.replace(/^derecho\s+/i, "").trim() || m.nombre;
}

/** «La hipoteca de máximo» */
const comillas = (s: string) => `«${s}»`;

function inicioDelDia(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function segundosDesde(sesiones: Sesion[], desde: number): number {
  let total = 0;
  for (const s of sesiones) if (s.inicio >= desde) total += s.segundos;
  return total;
}

/* ============================================================
   Candidatos
   Cada función devuelve como mucho UN aviso de su familia: el mejor.
   Todos se ordenan luego por peso, que solo existe para eso.
   ============================================================ */

interface Contexto {
  ahora: number;
  materias: Map<string, Materia>;
  temas: Tema[];
  progresos: Record<string, ProgresoTema>;
  perfil: PerfilAvisos;
}

/**
 * Un tema que estaba dominado (o cantable) y ha cruzado el umbral de óxido.
 *
 * El umbral no se calcula aquí: es `estadoEfectivo`, la misma función que hace
 * que el mural lo pinte en rojo. Si la app dice "oxidado", el aviso dice
 * "oxidado", y el mismo día.
 */
function candidatoOxidoTema(ctx: Contexto): Candidato | null {
  let mejor: { tema: Tema; dias: number } | null = null;

  for (const tema of ctx.temas) {
    const p = ctx.progresos[tema.id];
    if (!p) continue;
    // Solo los que el opositor había levantado: un tema "estudiando" que
    // lleva meses parado no se ha oxidado, es que no lo ha empezado en serio.
    if (p.estado !== "dominado" && p.estado !== "cantable") continue;
    if (estadoEfectivo(p, ctx.perfil.diasOxido) !== "oxidado") continue;
    const ultimo = ultimoContacto(p);
    if (!ultimo) continue;
    const d = Math.floor((ctx.ahora - ultimo) / DIA_MS);
    if (!mejor || d > mejor.dias) mejor = { tema, dias: d };
  }

  if (!mejor) return null;
  const { tema, dias: d } = mejor;
  const materia = materiaCorta(ctx.materias.get(tema.materiaId));
  const estabaEn = ctx.progresos[tema.id]?.estado === "dominado" ? "dominado" : "cantable";

  return {
    tipo: "oxido",
    clave: `oxido:tema:${tema.id}`,
    temaId: tema.id,
    titulo: `El tema ${tema.numero} se te está oxidando`,
    cuerpo: `${dias(d)} sin tocar ${comillas(tema.titulo)}${
      materia ? ` (${materia})` : ""
    }. Lo tenías ${estabaEn}.`,
    url: `/tema/${tema.id}`,
    // Cuanto más tiempo lleva, más peso, pero con techo: a partir de dos meses
    // da igual que sean 60 días o 200, la urgencia ya no crece.
    peso: 60 + Math.min(d / 10, 6) * 5,
  };
}

/**
 * Una materia entera abandonada: "llevas 11 días sin tocar Hipotecario".
 *
 * Exige que el opositor SIGA estudiando otra cosa (alguna materia tocada en
 * los últimos 3 días). Sin esa condición, el que lleva una semana de
 * vacaciones recibiría "abandonaste Civil", que no es verdad: no ha abandonado
 * una materia, ha parado. De eso ya avisan la racha y el ritmo semanal.
 */
function candidatoMateriaAbandonada(ctx: Contexto): Candidato | null {
  const ultimoPorMateria = new Map<string, number>();
  const temasPorMateria = new Map<string, Tema[]>();

  for (const tema of ctx.temas) {
    const lista = temasPorMateria.get(tema.materiaId) ?? [];
    lista.push(tema);
    temasPorMateria.set(tema.materiaId, lista);

    const p = ctx.progresos[tema.id];
    const ultimo = p ? ultimoContacto(p) : undefined;
    if (!ultimo) continue;
    const previo = ultimoPorMateria.get(tema.materiaId);
    if (previo == null || ultimo > previo) ultimoPorMateria.set(tema.materiaId, ultimo);
  }

  if (ultimoPorMateria.size < 2) return null;

  const masReciente = Math.max(...ultimoPorMateria.values());
  if ((ctx.ahora - masReciente) / DIA_MS > 3) return null; // ha parado del todo

  // Un cuarto del umbral de óxido: con los 45 días por defecto salen 11, que
  // es cuando una materia empieza a notarse abandonada de verdad.
  const umbral = Math.max(7, Math.round(ctx.perfil.diasOxido / 4));

  let mejor: { materiaId: string; dias: number } | null = null;
  for (const [materiaId, ultimo] of ultimoPorMateria) {
    const d = Math.floor((ctx.ahora - ultimo) / DIA_MS);
    if (d < umbral) continue;
    if (!mejor || d > mejor.dias) mejor = { materiaId, dias: d };
  }
  if (!mejor) return null;

  // El tema por el que empezar: el más urgente de esa materia según el SRS, y
  // si ninguno tiene progreso, el primero del programa. Un aviso que dice
  // "vuelve a Hipotecario" sin decir por dónde no es accionable.
  const suyos = temasPorMateria.get(mejor.materiaId) ?? [];
  const conProgreso = suyos
    .filter((t) => ctx.progresos[t.id])
    .sort((a, b) => urgencia(ctx.progresos[b.id]) - urgencia(ctx.progresos[a.id]));
  const destino =
    conProgreso[0] ?? [...suyos].sort((a, b) => a.numero - b.numero)[0];
  if (!destino) return null;

  const materia = materiaCorta(ctx.materias.get(mejor.materiaId));

  return {
    tipo: "oxido",
    clave: `oxido:materia:${mejor.materiaId}`,
    temaId: destino.id,
    titulo: `${dias(mejor.dias)} sin tocar ${materia}`,
    cuerpo: `Lo que más lo pide es el tema ${destino.numero}: ${comillas(
      destino.titulo,
    )}.`,
    url: `/tema/${destino.id}`,
    peso: 50 + Math.min(mejor.dias / 7, 6) * 4,
  };
}

/**
 * El repaso vencido de mayor urgencia, tal cual lo ordena `colaDeRepaso`.
 *
 * La cola admite desde 0.85 (a punto de vencer) porque en pantalla conviene
 * enseñar lo que viene. Para interrumpir a alguien se exige >= 1: la fecha ya
 * ha pasado, así que la frase "te tocaba hace 4 días" es literalmente cierta.
 */
function candidatoRepaso(ctx: Contexto): Candidato | null {
  const cola = colaDeRepaso(ctx.temas, ctx.progresos, 12);
  const vencidos = cola.filter((i) => i.urgencia >= 1);
  const top = vencidos[0];
  if (!top) return null;

  const materia = materiaCorta(ctx.materias.get(top.tema.materiaId));
  const retraso = Math.max(0, top.diasSinTocar - intervaloDias(top.progreso));
  const restantes = vencidos.length - 1;

  return {
    tipo: "repaso",
    clave: `repaso:${top.tema.id}`,
    temaId: top.tema.id,
    titulo: `Toca repasar el tema ${top.tema.numero}`,
    cuerpo:
      `${comillas(top.tema.titulo)}${materia ? ` (${materia})` : ""}. ` +
      `${dias(top.diasSinTocar)} sin tocarlo` +
      (retraso > 0 ? `, ${retraso} más de la cuenta.` : ".") +
      (restantes > 0
        ? ` Y ${restantes} ${restantes === 1 ? "tema más" : "temas más"} en la cola.`
        : ""),
    url: `/tema/${top.tema.id}`,
    peso: 40 + Math.min(top.urgencia, 10) * 4,
  };
}

/**
 * La racha se rompe hoy.
 *
 * Solo si hay racha que perder (>= 2 días) y hoy no ha caído ni un segundo. Un
 * "no has estudiado hoy" a las 20:00 de alguien que empezó ayer no es un
 * aviso, es una regañina.
 */
function candidatoRacha(ctx: Contexto, sesiones: Sesion[]): Candidato | null {
  if (segundosDesde(sesiones, inicioDelDia(ctx.ahora)) > 0) return null;
  const racha = calcularRacha(sesiones);
  if (racha < 2) return null;

  const cola = colaDeRepaso(ctx.temas, ctx.progresos, 3);
  const destino = cola[0]?.tema;

  return {
    tipo: "racha",
    // Clave sin fecha: es lo que impide que esto se convierta en un recordatorio
    // diario a las 20:00, que dejaría de leerse a la semana.
    clave: "racha",
    temaId: destino?.id,
    titulo: `Racha de ${dias(racha)}`,
    cuerpo: destino
      ? `Hoy no has estudiado nada todavía. Media hora con el tema ${destino.numero} y sigue viva.`
      : `Hoy no has estudiado nada todavía. Media hora y sigue viva.`,
    url: destino ? `/tema/${destino.id}` : "/repaso",
    // Es lo más urgente que hay: solo vale hoy, y a las 00:00 ya no.
    peso: 66 + Math.min(racha, 20) * 1.2,
  };
}

/**
 * Objetivo semanal lejos a mitad de semana.
 *
 * De miércoles a viernes: el lunes no hay nada que juzgar y el sábado ya no da
 * tiempo a arreglarlo, así que un aviso ahí solo sirve para amargar el fin de
 * semana. El listón es el 60 % de lo que tocaría a estas alturas de la semana,
 * no el 100 %: el objetivo es una meta, no una cuota diaria.
 */
function candidatoRitmo(ctx: Contexto, sesiones: Sesion[]): Candidato | null {
  const objetivoSeg = ctx.perfil.objetivoHorasSemana * HORA;
  if (objetivoSeg <= 0) return null;

  const d = new Date(ctx.ahora);
  const diaSemana = ((d.getDay() + 6) % 7) + 1; // 1 = lunes … 7 = domingo
  if (diaSemana < 3 || diaSemana > 5) return null;

  const lunes = inicioSemana(ctx.ahora);
  const hechos = segundosDesde(sesiones, lunes);
  const esperado = (diaSemana / 7) * objetivoSeg;
  if (hechos >= esperado * 0.6) return null;

  const cola = colaDeRepaso(ctx.temas, ctx.progresos, 3);
  const destino = cola[0]?.tema;
  const horasHechas = Math.round(hechos / HORA);
  const porcentaje = Math.round((hechos / objetivoSeg) * 100);

  return {
    // Se encuadra en "racha" porque es la misma familia —constancia— y porque
    // `perfiles.aviso_tipos` solo admite cuatro valores (0003). Ver docs/avisos.md.
    tipo: "racha",
    // Una clave por semana: no se arrastra a la semana siguiente, donde el dato
    // ya sería otro.
    clave: `ritmo:${claveDia(lunes)}`,
    temaId: destino?.id,
    titulo: `${horasHechas} h de ${ctx.perfil.objetivoHorasSemana} esta semana`,
    cuerpo: destino
      ? `Vas por el ${porcentaje} % del objetivo y ya es ${DIA_NOMBRE[diaSemana]}. Empieza por el tema ${destino.numero}.`
      : `Vas por el ${porcentaje} % del objetivo y ya es ${DIA_NOMBRE[diaSemana]}.`,
    url: destino ? `/tema/${destino.id}` : "/repaso",
    peso: 45,
  };
}

const DIA_NOMBRE: Record<number, string> = {
  1: "lunes",
  2: "martes",
  3: "miércoles",
  4: "jueves",
  5: "viernes",
  6: "sábado",
  7: "domingo",
};

/**
 * Hace demasiado del último simulacro.
 *
 * Exige masa crítica (8 temas cantables o dominados): mandar a alguien con
 * cuatro temas a un simulacro es mandarlo a suspender.
 */
function candidatoSimulacro(ctx: Contexto, simulacros: Simulacro[]): Candidato | null {
  let cantables = 0;
  for (const tema of ctx.temas) {
    const p = ctx.progresos[tema.id];
    if (!p) continue;
    const e = estadoEfectivo(p, ctx.perfil.diasOxido);
    if (e === "cantable" || e === "dominado") cantables += 1;
  }
  if (cantables < 8) return null;

  const hechos = simulacros.filter((s) => s.completado);
  const ultimo = hechos.length ? Math.max(...hechos.map((s) => s.fecha)) : null;
  const d = ultimo == null ? null : Math.floor((ctx.ahora - ultimo) / DIA_MS);
  if (d != null && d < 21) return null;

  return {
    tipo: "simulacro",
    clave: "simulacro",
    titulo: d == null ? "Nunca has hecho un simulacro" : `${dias(d)} sin simulacro`,
    cuerpo: `Tienes ${cantables} temas en pie. Un sorteo a ciegas te dice cuáles aguantan de verdad.`,
    url: "/simulacros",
    peso: 30,
  };
}

/* ============================================================
   Decisión
   ============================================================ */

/**
 * Todos los candidatos del expediente, de más a menos urgente.
 *
 * Se expone aparte de `decidirAviso` para poder probar cada familia por
 * separado: si solo se pudiera ver el ganador, una regla rota se escondería
 * detrás de otra que pesa más.
 */
export function candidatosDeAviso(
  expediente: ExpedienteAvisos,
  opciones: OpcionesDecision = {},
): Candidato[] {
  const ahora = opciones.ahora ?? Date.now();

  // Filtrado de tumbas en la entrada, igual que hace toda lectura de la app
  // (lib/data/vivos.ts). Un tema borrado no puede generar una notificación.
  const temas = temasVivos(expediente.temas);
  const progresos = vivosMapa(expediente.progresos);
  const materias = new Map(vivos(expediente.materias).map((m) => [m.id, m]));
  const simulacros = vivos(expediente.simulacros);
  const sesiones = expediente.sesiones;

  const ctx: Contexto = {
    ahora,
    materias,
    temas,
    progresos,
    perfil: expediente.perfil,
  };

  return [
    candidatoOxidoTema(ctx),
    candidatoMateriaAbandonada(ctx),
    candidatoRepaso(ctx),
    candidatoRacha(ctx, sesiones),
    candidatoRitmo(ctx, sesiones),
    candidatoSimulacro(ctx, simulacros),
  ]
    .filter((c): c is Candidato => c !== null)
    .sort((a, b) => b.peso - a.peso);
}

/**
 * Dos avisos sobre el mismo tema son el mismo aviso dicho dos veces: "el tema
 * 33 se te oxida" y "toca repasar el tema 33" son la misma frase. Se queda el
 * de más peso, aunque el otro sea de otra familia.
 */
function sinTemasRepetidos(candidatos: Candidato[]): Candidato[] {
  const vistos = new Set<string>();
  return candidatos.filter((c) => {
    if (!c.temaId) return true;
    if (vistos.has(c.temaId)) return false;
    vistos.add(c.temaId);
    return true;
  });
}

/** Días enteros entre dos claves YYYY-MM-DD. */
function diasEntre(desde: string, hasta: string): number {
  const a = Date.parse(`${desde}T00:00:00Z`);
  const b = Date.parse(`${hasta}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Number.POSITIVE_INFINITY;
  return Math.round((b - a) / DIA_MS);
}

/**
 * El aviso de hoy, o `null` si hoy no hay nada que decir.
 *
 * `null` es el caso bueno y el más frecuente: el que va al día no recibe nada.
 */
export function decidirAviso(
  expediente: ExpedienteAvisos,
  opciones: OpcionesDecision = {},
): Aviso | null {
  const ahora = opciones.ahora ?? Date.now();
  const hoy = opciones.hoy ?? claveDia(ahora);
  const historial = opciones.historial ?? [];
  const ventana = opciones.diasSinRepetir ?? 2;

  // Tope de uno al día. Se comprueba aquí y no solo en el cron para que la
  // regla viva junto a la decisión y se pueda probar sin base de datos.
  if (historial.some((h) => h.dia === hoy)) return null;

  const tipos = new Set(expediente.perfil.tipos);

  // El orden de los tres filtros importa:
  //   1. tipos, primero, para no descartar por duplicado un tema cuyo aviso
  //      ganador es de una familia que el opositor ha apagado;
  //   2. temas repetidos, después, para que el anti-repetición vea un solo
  //      candidato por tema;
  //   3. historial, al final: así "no repetir" significa "no volver sobre el
  //      mismo tema", no "no volver a usar la misma frase".
  const elegibles = sinTemasRepetidos(
    candidatosDeAviso(expediente, { ...opciones, ahora }).filter((c) =>
      tipos.has(c.tipo),
    ),
  ).filter(
    // Anti-repetición: la misma clave no vuelve hasta pasada la ventana. Con
    // ventana 2, un aviso de ayer (1 día) está fuera y uno de anteayer (2
    // días) vuelve a estar disponible.
    (c) => !historial.some((h) => h.clave === c.clave && diasEntre(h.dia, hoy) < ventana),
  );

  const elegido = elegibles[0];
  if (!elegido) return null;

  // Se devuelve sin `temaId`: fuera de este fichero nadie lo necesita y el
  // payload del push conviene que sea exactamente lo que lee el service worker.
  const { temaId: _ignorado, ...aviso } = elegido;
  return aviso;
}
