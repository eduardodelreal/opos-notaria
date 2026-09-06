import type {
  Cante,
  Materia,
  Perfil,
  ProgresoTema,
  Sesion,
  Tema,
  TranscripcionCante,
} from "../data/types";
import {
  colaDeRepaso,
  detectarLagunas,
  epigrafesProblematicos,
  estadoEfectivo,
  predecirFinalizacion,
  resumenGlobal,
  statsPorMateria,
} from "../data/srs";
import { horasMin, horas, haceTexto, fecha, reloj } from "../utils/time";

/**
 * La ficha del opositor.
 *
 * Es lo que convierte la app en un preparador y no en un chatbot:
 * cada llamada al modelo lleva el estado real de ESTE opositor.
 * Se manda como texto (no JSON) porque ocupa la mitad y el modelo lo
 * lee mejor. Va siempre en el mensaje del usuario, nunca en el system
 * prompt, para no romper la caché del prefijo.
 */

export interface DatosFicha {
  perfil: Perfil;
  materias: Materia[];
  temas: Tema[];
  progresos: Record<string, ProgresoTema>;
  sesiones: Sesion[];
  cantes: Cante[];
}

export function construirFicha(d: DatosFicha): string {
  const { perfil, materias, temas, progresos, sesiones, cantes } = d;

  if (!temas.length) {
    return [
      "# Ficha del opositor",
      `Nombre: ${perfil.nombre || "sin indicar"}`,
      `Oposición: ${perfil.oposicion}`,
      "",
      "Todavía no ha dado de alta ningún tema en la aplicación. No tiene datos de progreso, cantes ni horas.",
    ].join("\n");
  }

  const resumen = resumenGlobal(
    temas,
    progresos,
    sesiones,
    cantes,
    perfil.diasOxido,
  );
  const porMateria = statsPorMateria(temas, progresos, cantes, perfil.diasOxido);
  const lagunas = detectarLagunas(temas, progresos, cantes, 5);
  const problematicos = epigrafesProblematicos(cantes, 6);
  const cola = colaDeRepaso(temas, progresos, 8);
  const prediccion = predecirFinalizacion(
    temas,
    progresos,
    cantes,
    perfil.fechaExamen,
  );

  const nombreMateria = (id: string) =>
    materias.find((m) => m.id === id)?.nombre ?? id;
  const tituloTema = (id: string) => {
    const t = temas.find((x) => x.id === id);
    return t ? `T${t.numero} ${t.titulo}` : id;
  };

  const l: string[] = [];
  l.push("# Ficha del opositor");
  l.push(`Nombre: ${perfil.nombre || "sin indicar"}`);
  l.push(`Oposición: ${perfil.oposicion}`);
  l.push(`Empezó: ${fecha(perfil.fechaInicio)}`);
  if (perfil.fechaExamen) l.push(`Examen objetivo: ${perfil.fechaExamen}`);
  if (perfil.preparador) l.push(`Preparador: ${perfil.preparador}`);
  l.push(
    `Objetivo semanal: ${perfil.objetivoHorasSemana} h · Tiempo de tribunal por tema: ${perfil.minutosPorTema} min`,
  );

  l.push("");
  l.push("## Estado del programa");
  l.push(`Temas dados de alta: ${resumen.totalTemas}`);
  l.push(
    `Sin empezar ${resumen.porEstado.nuevo} · Estudiando ${resumen.porEstado.estudiando} · Cantables ${resumen.porEstado.cantable} · Dominados ${resumen.porEstado.dominado} · Oxidados ${resumen.porEstado.oxidado}`,
  );
  l.push(`Avance ponderado: ${resumen.avance.toFixed(1)}%`);
  l.push(
    `Horas totales ${horas(resumen.segundosTotales)} h · esta semana ${horas(resumen.segundosSemana)} h de ${perfil.objetivoHorasSemana} h · hoy ${horasMin(resumen.segundosHoy)}`,
  );
  l.push(
    `Racha: ${resumen.racha} días · Cantes registrados: ${resumen.cantesTotales} · Nota media de cante: ${resumen.notaMedia ?? "sin notas"}`,
  );

  if (prediccion.temasPorSemana > 0) {
    l.push(
      `Ritmo actual: ${prediccion.temasPorSemana} temas dominados/semana. A ese ritmo cierra el programa en ${prediccion.semanasRestantes} semanas${
        prediccion.fechaEstimada ? ` (${fecha(prediccion.fechaEstimada)})` : ""
      }.${prediccion.vasJusto === true ? " NO LLEGA a la fecha de examen fijada." : prediccion.vasJusto === false ? " Llega con margen a la fecha de examen." : ""}`,
    );
  } else {
    l.push(
      "Ritmo actual: no ha pasado ningún tema a dominado en las últimas 8 semanas.",
    );
  }

  l.push("");
  l.push("## Por materia");
  for (const m of porMateria.sort((a, b) => a.avance - b.avance)) {
    l.push(
      `- ${nombreMateria(m.materiaId)}: ${m.temas} temas, ${m.dominados} dominados, avance ${m.avance.toFixed(0)}%, ${horas(m.segundos)} h, nota media ${m.notaMedia ?? "s/n"}`,
    );
  }

  if (cola.length) {
    l.push("");
    l.push("## Temas que urge repasar (los más pasados de fecha primero)");
    for (const c of cola) {
      l.push(
        `- ${tituloTema(c.tema.id)} (${nombreMateria(c.tema.materiaId)}) — ${c.diasSinTocar} días sin tocarlo, estado ${estadoEfectivo(c.progreso, perfil.diasOxido)}`,
      );
    }
  }

  if (lagunas.length) {
    l.push("");
    l.push("## Temas con muchas horas y mala nota (posible problema de método)");
    for (const x of lagunas) {
      l.push(
        `- ${tituloTema(x.tema.id)}: ${horas(x.segundos)} h invertidas, nota media ${x.notaMedia}`,
      );
    }
  }

  if (problematicos.length) {
    l.push("");
    l.push("## Epígrafes que falla de forma recurrente");
    for (const p of problematicos) {
      l.push(
        `- "${p.titulo}" (${tituloTema(p.temaId)}): ${p.fallos} fallos en ${p.veces} cantes`,
      );
    }
  }

  const ultimos = [...cantes].sort((a, b) => b.fecha - a.fecha).slice(0, 6);
  if (ultimos.length) {
    l.push("");
    l.push("## Últimos cantes");
    for (const c of ultimos) {
      l.push(
        `- ${fecha(c.fecha)} · ${tituloTema(c.temaId)} · ${reloj(c.segundos)} · nota ${c.nota ?? "s/n"}${c.conPreparador ? " (con preparador)" : ""}${c.feedback ? ` · feedback: ${recorta(c.feedback, 160)}` : ""}`,
      );
    }
  }

  return l.join("\n");
}

/** Detalle de un cante concreto, para el análisis individual. */
export function construirDetalleCante(
  cante: Cante,
  tema: Tema,
  materia: Materia | undefined,
  anteriores: Cante[],
  minutosObjetivo: number,
): string {
  const l: string[] = [];
  l.push(`# Cante a analizar`);
  l.push(`Tema ${tema.numero} — ${tema.titulo}`);
  l.push(`Materia: ${materia?.nombre ?? tema.materiaId}`);
  l.push(`Fecha: ${fecha(cante.fecha)}`);
  l.push(
    `Duración total: ${reloj(cante.segundos)} (objetivo del tribunal: ${minutosObjetivo} min)`,
  );
  l.push(`Nota: ${cante.nota ?? "sin nota"}`);
  l.push(`Con preparador: ${cante.conPreparador ? "sí" : "no"}`);
  if (cante.feedback) l.push(`Feedback del preparador: ${cante.feedback}`);

  if (cante.epigrafes.length) {
    l.push("");
    l.push("## Desglose por epígrafe (tiempo y fallos marcados en vivo)");
    for (const e of cante.epigrafes) {
      const fallos = e.fallos.length
        ? e.fallos.join(", ")
        : "sin fallos marcados";
      l.push(`- ${e.titulo} — ${reloj(e.segundos)} — ${fallos}`);
    }
  } else {
    l.push("");
    l.push("(No hay desglose por epígrafe: se cronometró el tema entero.)");
  }

  if (anteriores.length) {
    l.push("");
    l.push("## Cantes anteriores de este mismo tema (del más reciente al más antiguo)");
    for (const c of anteriores.slice(0, 5)) {
      const desglose = c.epigrafes.length
        ? c.epigrafes
            .map((e) => `${e.titulo}: ${reloj(e.segundos)}/${e.fallos.length}f`)
            .join(" | ")
        : "sin desglose";
      l.push(
        `- ${fecha(c.fecha)} · ${reloj(c.segundos)} · nota ${c.nota ?? "s/n"} · ${desglose}`,
      );
    }
  } else {
    l.push("");
    l.push("(Es el primer cante registrado de este tema: no hay comparativa.)");
  }

  return l.join("\n");
}

/* ------------------------- comparación con el temario ---------------------- */

/**
 * Vocabulario del tema para el transcriptor.
 *
 * Whisper acepta una pista de contexto y con ella deja de destrozar los
 * tecnicismos: sin esto "usufructo" sale "uso fructo" y "art. 1255" sale
 * "artículo mil doscientos cincuenta y cinco" o directamente mal. Y lo que
 * el transcriptor escriba mal es exactamente lo que luego se cuenta como
 * laguna que no existió.
 */
export function pistaDeTema(tema: Tema): string {
  const titulos = tema.epigrafes
    .filter((e) => e.borrado == null)
    .map((e) => e.titulo)
    .join(". ");
  return `Oposición a Notarías, España. Tema ${tema.numero}: ${tema.titulo}. ${titulos}`;
}

/** ¿Hay texto de temario contra el que comparar? Sin esto no hay tarea. */
export function hayTextoDeTema(tema: Tema): boolean {
  return tema.epigrafes.some(
    (e) => e.borrado == null && (e.texto ?? "").trim().length > 0,
  );
}

/**
 * Las dos columnas que se le ponen delante al modelo: el texto del tema y
 * lo que el opositor recitó de verdad.
 *
 * La transcripción va ENTERA y sin trocear por epígrafes. Se podría partir
 * con las marcas de tiempo, pero el transcriptor no siempre devuelve
 * marcas de segmento, y un corte a destiempo parte una frase por la mitad y
 * convierte media frase en una laguna inventada. Lo que sí se le da es el
 * guion: qué epígrafes hubo, en qué orden y cuánto duró cada uno, que es
 * suficiente para que alinee por contenido.
 */
export function construirComparacion(
  cante: Cante,
  tema: Tema,
  transcripcion: TranscripcionCante,
): string {
  const l: string[] = [];
  const epigrafes = tema.epigrafes
    .filter((e) => e.borrado == null)
    .sort((a, b) => a.orden - b.orden);

  l.push(`# Texto del tema ${tema.numero} — ${tema.titulo}`);
  l.push("Esto es lo que el opositor estudia. Es la única fuente válida.");
  for (const e of epigrafes) {
    l.push("");
    l.push(`## ${e.titulo}`);
    l.push((e.texto ?? "").trim() || "(este epígrafe no tiene texto guardado)");
  }

  l.push("");
  l.push("# Guion del cante (medido en vivo)");
  l.push(
    `Duración total ${reloj(cante.segundos)}. Los fallos entre paréntesis los marcó el propio opositor mientras cantaba.`,
  );
  if (cante.epigrafes.length) {
    for (const e of cante.epigrafes) {
      const fallos = e.fallos.length ? ` (${e.fallos.join(", ")})` : "";
      l.push(`- ${e.titulo} — ${reloj(e.segundos)}${fallos}`);
    }
  } else {
    l.push("- (se cronometró el tema entero, sin desglose)");
  }

  l.push("");
  l.push("# Transcripción de lo que dijo");
  l.push(
    "Transcripción automática, con los errores típicos de una máquina oyendo vocabulario jurídico.",
  );
  l.push("");
  l.push(transcripcion.texto);

  return l.join("\n");
}

function recorta(t: string, n: number): string {
  return t.length <= n ? t : `${t.slice(0, n - 1)}…`;
}

export { haceTexto };
