/**
 * Pruebas del modelo local preparado para sincronizar.
 *
 * Se ejecutan contra el código real del store (ver pruebas/cargador.mjs),
 * no contra una copia: lo que se comprueba aquí es exactamente lo que corre
 * en la app.
 *
 * Cubren las dos cosas que, si se rompen, no dan error sino datos mal:
 *
 *   1. Borrado lógico. Tras borrar un tema no puede quedar NI UNA lectura
 *      que lo enseñe (mural, derivados, cola de repaso, estadísticas,
 *      export, ficha de IA), y las sesiones tienen que sobrevivir porque
 *      esas horas son del opositor.
 *   2. Sellado de `actualizado`. Cualquier acción que cambie el contenido
 *      de una fila mutable tiene que moverle el reloj, o el servidor
 *      descartará esa edición sin decir nada.
 *
 * Uso:
 *   node --experimental-strip-types --import ./pruebas/cargador.mjs pruebas/modelo.mjs
 */
import assert from "node:assert/strict";

import { estadoVivo, useStore } from "../lib/store/store.ts";
import { materiasOrdenadas } from "../lib/data/materias.ts";
import { temasVivos, vivos, vivosMapa } from "../lib/data/vivos.ts";
import { derivarProgresos } from "../lib/data/derivados.ts";
import {
  colaDeRepaso,
  epigrafesProblematicos,
  detectarLagunas,
  resumenGlobal,
  statsPorMateria,
} from "../lib/data/srs.ts";
import { migrarAApariencia, migrarAArticulos, migrarARelojes } from "../lib/store/migraciones.ts";
import {
  agruparPorEpigrafe,
  articulosPropuestos,
  claveArticulo,
  etiquetaArticulo,
  extraerCitas,
  indiceCruzado,
  normalizarCuerpo,
  normalizarNumero,
  parsearArticulos,
  temasDeArticulo,
} from "../lib/data/articulos.ts";
import { temasOrdenados, ordenDeTriaje } from "../lib/store/store.ts";
import { PERFIL_INICIAL, normalizarPerfil, perfilDeFabrica } from "../lib/data/perfil.ts";
import {
  ACENTOS,
  MINIMO_ETIQUETA,
  MINIMO_SOLIDO,
  MINIMO_TEXTO_FONDO,
  MINIMO_TEXTO_SUPERFICIE,
  TONOS,
  apariencia,
  paletaAcento,
  paletaDe,
  veredictoAcento,
} from "../lib/data/apariencia.ts";
import { contraste, hslARgb, rgbAHex } from "../lib/data/color.ts";
import { readFileSync } from "node:fs";

const DIA = 86_400_000;
let fallos = 0;
let hechas = 0;

function prueba(nombre, fn) {
  hechas += 1;
  try {
    fn();
    console.log(`  ok   ${nombre}`);
  } catch (e) {
    fallos += 1;
    console.log(`  FAIL ${nombre}\n       ${e.message.split("\n")[0]}`);
  }
}

/* ============================================================
   Utilidades
   ============================================================ */

/**
 * Igualdad estructural ignorando el reloj. Escrita aquí a mano y no
 * importada de lib/store/sellado.ts a propósito: si la comparación del
 * sellado tuviera un fallo, reutilizarla haría que la prueba lo tapara.
 */
function igualSinReloj(a, b) {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || !a || !b) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    return a.length === b.length && a.every((x, i) => igualSinReloj(x, b[i]));
  }
  const claves = new Set([...Object.keys(a), ...Object.keys(b)]);
  claves.delete("actualizado");
  for (const k of claves) if (!igualSinReloj(a[k], b[k])) return false;
  return true;
}

/** Todas las filas con reloj del estado, aplanadas como `clave → fila`. */
function filasSelladas(s) {
  const salida = new Map();
  const meter = (tabla, filas) => {
    for (const f of filas) salida.set(`${tabla}:${f.id ?? f.temaId}`, f);
  };
  meter("materias", s.materias);
  // El tema va sin sus epígrafes: en el servidor son filas distintas y
  // cada una tiene su propio reloj. Editar el epígrafe 3 no debe mover el
  // reloj del tema.
  meter("temas", s.temas.map((t) => ({ ...t, epigrafes: undefined })));
  meter("cantes", s.cantes);
  meter("keypoints", s.keypoints);
  meter("notas", s.notas);
  meter("simulacros", s.simulacros);
  meter("vueltas", s.vueltas);
  meter("progresos", Object.values(s.progresos));
  for (const t of s.temas) meter(`epigrafes(${t.id})`, t.epigrafes);
  return salida;
}

/**
 * Ejecuta una acción y exige la invariante del sellado: toda fila cuyo
 * contenido haya cambiado tiene que haber avanzado su `actualizado`.
 *
 * Es la red que hace que no haga falta acordarse acción por acción: si
 * mañana alguien añade una acción nueva que escribe sin sellar, esta
 * comprobación la caza en cuanto se la meta en la lista de abajo.
 */
function conSellado(nombre, accion) {
  prueba(`sellado · ${nombre}`, () => {
    const antes = filasSelladas(useStore.getState());
    accion();
    const despues = filasSelladas(useStore.getState());
    let tocadas = 0;
    for (const [clave, fila] of despues) {
      const previa = antes.get(clave);
      if (!previa) {
        // Fila nueva: basta con que nazca con reloj.
        tocadas += 1;
        assert.ok(
          typeof fila.actualizado === "number",
          `${clave} nace sin reloj`,
        );
        continue;
      }
      if (igualSinReloj(previa, fila)) continue;
      tocadas += 1;
      assert.ok(
        fila.actualizado > previa.actualizado,
        `${clave} cambió de contenido y su reloj no avanzó ` +
          `(${previa.actualizado} → ${fila.actualizado})`,
      );
    }
    assert.ok(tocadas > 0, "la acción no modificó ninguna fila sellada");
  });
}

/* ============================================================
   Expediente de prueba
   ============================================================ */

function sembrar() {
  const st = useStore.getState();
  st.borrarTodo();
  const materia = useStore.getState().addMateria("Prueba", "PRU", "#fff");
  const tema = useStore.getState().addTema(materia.id, 1, "Tema que se borrará");
  const otro = useStore.getState().addTema(materia.id, 2, "Tema que se queda");

  useStore.getState().addEpigrafe(tema.id, "Epígrafe A", "texto A");
  useStore.getState().addEpigrafe(tema.id, "Epígrafe B", "texto B");
  useStore.getState().addEpigrafe(otro.id, "Epígrafe C");

  const epigrafes = useStore.getState().temas.find((t) => t.id === tema.id).epigrafes;

  useStore.getState().setEstado(tema.id, "cantable");
  useStore.getState().setDificultad(tema.id, 4);
  useStore.getState().alternarFavorito(tema.id);
  useStore.getState().sumarVuelta(tema.id);

  const cante = useStore.getState().guardarCante({
    temaId: tema.id,
    segundos: 600,
    epigrafes: epigrafes.map((e) => ({
      epigrafeId: e.id,
      titulo: e.titulo,
      segundos: 300,
      fallos: ["laguna", "dato"],
    })),
    nota: 4,
    conPreparador: false,
  });
  useStore.getState().guardarCante({
    temaId: tema.id,
    segundos: 500,
    epigrafes: [],
    nota: 3,
    conPreparador: false,
  });
  // Dos artículos en el tema que se borra (uno archivado en el epígrafe A y
  // otro todavía suelto) y uno en el que se queda: es lo que permite ver que
  // la cascada llega a ellos y que no se lleva por delante los del vecino.
  useStore.getState().addArticulo(tema.id, {
    cuerpo: "CC",
    numero: "1255",
    titulo: "Libertad de pacto",
    contenido: "Los contratantes pueden establecer los pactos…",
    epigrafeId: epigrafes[0].id,
  });
  useStore.getState().addArticulo(tema.id, { cuerpo: "LH", numero: "34" });
  useStore.getState().addArticulo(otro.id, { cuerpo: "CC", numero: "1255" });

  useStore.getState().addKeyPoint(tema.id, "¿Artículo?", "1902 CC");
  useStore.getState().addNota(tema.id, "Nota del tema que se borrará");
  const simulacro = useStore.getState().addSimulacro({
    tipo: "cante",
    fecha: Date.now(),
    temaIds: [tema.id, otro.id],
    minutos: 20,
    segundosUsados: 0,
    notas: [null, null],
    completado: false,
  });

  // Una sesión de estudio parada de verdad, para poder comprobar que
  // sobrevive al borrado del tema.
  useStore.setState({
    crono: {
      tipo: "estudio",
      temaId: tema.id,
      desde: Date.now() - 3600_000,
      acumulado: 0,
      pausado: false,
    },
  });
  useStore.getState().pararCrono();

  // Lo envejecemos para que entre en la cola de repaso: si no, un tema
  // recién tocado no aparece y la prueba de la cola no probaría nada.
  useStore.setState((s) => ({
    progresos: {
      ...s.progresos,
      [tema.id]: {
        ...s.progresos[tema.id],
        ultimoEstudio: Date.now() - 120 * DIA,
        ultimoCante: Date.now() - 120 * DIA,
      },
    },
  }));

  return { materia, tema, otro, cante, simulacro };
}

/* ============================================================
   1 · Borrado lógico de un tema
   ============================================================ */

console.log("\nborrado lógico de un tema");
{
  const { materia, tema, otro, cante } = sembrar();
  const perfil = useStore.getState().perfil;

  const antes = estadoVivo();
  const horasAntes = resumenGlobal(
    antes.temas,
    antes.progresos,
    antes.sesiones,
    antes.cantes,
    perfil.diasOxido,
  );
  const colaAntes = colaDeRepaso(antes.temas, antes.progresos, 40);

  prueba("el expediente de partida contiene el tema en todas las lecturas", () => {
    assert.ok(antes.temas.some((t) => t.id === tema.id));
    assert.ok(antes.cantes.some((c) => c.temaId === tema.id));
    assert.ok(antes.keypoints.some((k) => k.temaId === tema.id));
    assert.ok(antes.notas.some((n) => n.temaId === tema.id));
    assert.ok(antes.vueltas.some((v) => v.temaId === tema.id));
    assert.ok(antes.progresos[tema.id]);
    assert.ok(colaAntes.some((x) => x.tema.id === tema.id), "no entró en la cola");
    assert.equal(horasAntes.totalTemas, 2);
    assert.equal(horasAntes.cantesTotales, 2);
  });

  const sesionesDelTema = antes.sesiones.filter((s) => s.temaId === tema.id);
  assert.ok(sesionesDelTema.length >= 2, "el sembrado no dejó sesiones");

  useStore.getState().removeTema(tema.id);
  const d = estadoVivo();

  prueba("la fila sigue en el estado, pero como tumba", () => {
    const crudo = useStore.getState().temas.find((t) => t.id === tema.id);
    assert.ok(crudo, "la fila desapareció: el borrado no podría viajar");
    assert.equal(typeof crudo.borrado, "number");
    assert.ok(crudo.epigrafes.every((e) => typeof e.borrado === "number"));
  });

  prueba("no aparece en ninguna colección viva (cascada completa)", () => {
    assert.equal(d.temas.filter((t) => t.id === tema.id).length, 0);
    assert.equal(d.cantes.filter((c) => c.temaId === tema.id).length, 0);
    assert.equal(d.keypoints.filter((k) => k.temaId === tema.id).length, 0);
    assert.equal(d.notas.filter((n) => n.temaId === tema.id).length, 0);
    assert.equal(d.vueltas.filter((v) => v.temaId === tema.id).length, 0);
    assert.equal(d.progresos[tema.id], undefined);
  });

  prueba("no queda ni una referencia de texto al tema ni a sus hijos", () => {
    // Barrido bruto: si alguna colección viva —presente o futura— se
    // dejara sin filtrar, el id aparecería aquí. Se excluyen a propósito
    // las sesiones (sobreviven) y los simulacros (no se cascadean, ni aquí
    // ni en el servidor: el histórico pinta "?" para el tema que ya no está).
    const { sesiones, simulacros, ...visible } = d;
    const json = JSON.stringify(visible);
    assert.ok(!json.includes(tema.id), "el id del tema sigue visible");
    assert.ok(!json.includes(cante.id), "el id del cante sigue visible");
    for (const e of useStore.getState().temas.find((t) => t.id === tema.id).epigrafes) {
      assert.ok(!json.includes(e.id), `el epígrafe ${e.titulo} sigue visible`);
    }
  });

  prueba("desaparece de la cola de repaso", () => {
    const cola = colaDeRepaso(d.temas, d.progresos, 40);
    assert.ok(!cola.some((x) => x.tema.id === tema.id));
  });

  prueba("los derivados no cuentan sus filas", () => {
    const der = derivarProgresos(
      useStore.getState().progresos,
      useStore.getState().sesiones,
      useStore.getState().cantes,
      useStore.getState().vueltas,
    );
    assert.equal(der[tema.id], undefined, "el progreso borrado se derivó igual");
    const resumen = resumenGlobal(
      d.temas,
      d.progresos,
      d.sesiones,
      d.cantes,
      perfil.diasOxido,
    );
    assert.equal(resumen.totalTemas, 1);
    assert.equal(resumen.cantesTotales, 0);
    assert.equal(resumen.notaMedia, null);
    const stats = statsPorMateria(d.temas, d.progresos, d.cantes, perfil.diasOxido);
    assert.equal(stats.find((x) => x.materiaId === materia.id).temas, 1);
    assert.equal(
      epigrafesProblematicos(d.cantes).filter((x) => x.temaId === tema.id).length,
      0,
    );
    assert.equal(
      detectarLagunas(d.temas, d.progresos, d.cantes).filter(
        (x) => x.tema.id === tema.id,
      ).length,
      0,
    );
  });

  prueba("las sesiones sobreviven y las horas no se mueven", () => {
    const sesiones = useStore.getState().sesiones.filter((s) => s.temaId === tema.id);
    assert.equal(sesiones.length, sesionesDelTema.length);
    const resumen = resumenGlobal(
      d.temas,
      d.progresos,
      d.sesiones,
      d.cantes,
      perfil.diasOxido,
    );
    assert.equal(resumen.segundosTotales, horasAntes.segundosTotales);
    assert.equal(resumen.racha, horasAntes.racha);
  });

  prueba("exportar() no se lleva las tumbas", () => {
    const copia = JSON.parse(useStore.getState().exportar());
    assert.equal(copia.version, 4);
    assert.ok(!copia.temas.some((t) => t.id === tema.id));
    assert.ok(
      !copia.articulos.some((a) => a.temaId === tema.id),
      "el export se llevó la tumba de un artículo",
    );
    assert.equal(
      copia.articulos.filter((a) => a.temaId === otro.id).length,
      1,
      "el export perdió el artículo del tema vivo",
    );
    assert.ok(!copia.cantes.length);
    assert.ok(!copia.notas.length);
    assert.ok(!copia.keypoints.length);
    assert.ok(!copia.vueltas.length);
    assert.equal(copia.progresos[tema.id], undefined);
    assert.ok(copia.sesiones.length >= 2, "el export perdió las sesiones");
    assert.ok(copia.temas.some((t) => t.id === otro.id), "se llevó el tema vivo");
  });

  prueba("borrar el tema arrastra sus artículos y no toca los del vecino", () => {
    const todos = useStore.getState().articulos;
    const suyos = todos.filter((a) => a.temaId === tema.id);
    assert.equal(suyos.length, 2, "los artículos han desaparecido del array");
    assert.ok(suyos.every((a) => a.borrado != null), "algún artículo sigue vivo");
    // La tumba tiene que poder empujarse, y para eso necesita reloj.
    assert.ok(suyos.every((a) => a.actualizado >= a.borrado));
    const vecino = todos.filter((a) => a.temaId === otro.id);
    assert.equal(vecino.length, 1);
    assert.equal(vecino[0].borrado, undefined, "se llevó por delante al vecino");
  });

  prueba("ninguna lectura enseña los artículos del tema borrado", () => {
    const vivosAhora = estadoVivo();
    assert.ok(!vivosAhora.articulos.some((a) => a.temaId === tema.id));
    assert.equal(vivosAhora.articulos.length, 1);
  });

  prueba("el tema vivo no se ve afectado", () => {
    const vivo = d.temas.find((t) => t.id === otro.id);
    assert.ok(vivo);
    assert.equal(vivo.epigrafes.length, 1);
  });

  prueba("borrar dos veces no reescribe la tumba", () => {
    const fecha = useStore.getState().temas.find((t) => t.id === tema.id).borrado;
    useStore.getState().removeTema(tema.id);
    assert.equal(useStore.getState().temas.find((t) => t.id === tema.id).borrado, fecha);
  });
}

/* ============================================================
   2 · Cascada de materia y borrados sueltos
   ============================================================ */

console.log("\ncascada de materia y borrados sueltos");
{
  const { materia, tema, otro } = sembrar();
  useStore.getState().removeMateria(materia.id);
  const d = estadoVivo();

  prueba("borrar la materia arrastra sus temas y lo que cuelga de ellos", () => {
    assert.ok(!d.materias.some((m) => m.id === materia.id));
    assert.ok(!d.temas.some((t) => t.id === tema.id || t.id === otro.id));
    assert.equal(d.cantes.length, 0);
    assert.equal(d.notas.length, 0);
    assert.equal(d.keypoints.length, 0);
    assert.equal(Object.keys(d.progresos).length, 0);
  });

  prueba("las sesiones tampoco se cascadean al borrar la materia", () => {
    assert.ok(useStore.getState().sesiones.some((s) => s.temaId === tema.id));
  });
}

{
  const { tema } = sembrar();
  const st = () => useStore.getState();

  prueba("borrar un epígrafe lo marca y renumera los vivos", () => {
    const eps = st().temas.find((t) => t.id === tema.id).epigrafes;
    st().removeEpigrafe(tema.id, eps[0].id);
    const despues = st().temas.find((t) => t.id === tema.id).epigrafes;
    assert.equal(despues.length, 2, "la fila desapareció en vez de marcarse");
    const tumba = despues.find((e) => e.id === eps[0].id);
    assert.equal(typeof tumba.borrado, "number");
    const visibles = temasVivos(st().temas).find((t) => t.id === tema.id).epigrafes;
    assert.equal(visibles.length, 1);
    assert.equal(visibles[0].orden, 1, "no se renumeró tras el borrado");
  });

  prueba("setEpigrafes conserva las tumbas anteriores", () => {
    const visibles = temasVivos(st().temas).find((t) => t.id === tema.id).epigrafes;
    st().setEpigrafes(tema.id, [{ ...visibles[0], titulo: "Renombrado" }]);
    const todos = st().temas.find((t) => t.id === tema.id).epigrafes;
    assert.equal(todos.filter((e) => e.borrado != null).length, 1);
    assert.equal(todos.filter((e) => e.borrado == null).length, 1);
  });

  prueba("cante, keypoint, nota y simulacro se borran marcando", () => {
    const c = st().cantes[0];
    st().removeCante(c.id);
    assert.ok(st().cantes.some((x) => x.id === c.id && x.borrado != null));
    assert.ok(!st().cantesDe(tema.id).some((x) => x.id === c.id));

    const k = st().keypoints[0];
    st().removeKeyPoint(k.id);
    assert.ok(st().keypoints.some((x) => x.id === k.id && x.borrado != null));
    assert.ok(!vivos(st().keypoints).some((x) => x.id === k.id));

    const n = st().notas[0];
    st().removeNota(n.id);
    assert.ok(st().notas.some((x) => x.id === n.id && x.borrado != null));
    assert.ok(!vivos(st().notas).some((x) => x.id === n.id));

    const s = st().simulacros[0];
    st().removeSimulacro(s.id);
    assert.ok(st().simulacros.some((x) => x.id === s.id && x.borrado != null));
    assert.ok(!vivos(st().simulacros).some((x) => x.id === s.id));
  });

  prueba("la media de cante ignora los cantes borrados", () => {
    // Quedaba un cante de nota 3 tras borrar el de nota 4.
    const der = derivarProgresos(
      st().progresos,
      st().sesiones,
      st().cantes,
      st().vueltas,
    );
    assert.equal(der[tema.id].notaMedia, 3);
  });
}

/* ============================================================
   3 · Referencias estables (el bucle de renders de React #185)
   ============================================================ */

console.log("\nreferencias estables de las lecturas");
{
  const { tema } = sembrar();
  prueba("dos lecturas seguidas del mismo estado dan la misma referencia", () => {
    const s = useStore.getState();
    assert.equal(temasVivos(s.temas), temasVivos(s.temas));
    assert.equal(vivos(s.cantes), vivos(s.cantes));
    assert.equal(vivosMapa(s.progresos), vivosMapa(s.progresos));
    // Sin tumbas, ni siquiera se copia el array.
    assert.equal(vivos(s.notas), s.notas);
  });

  prueba("sigue siendo estable cuando ya hay tumbas", () => {
    useStore.getState().removeTema(tema.id);
    const s = useStore.getState();
    assert.equal(temasVivos(s.temas), temasVivos(s.temas));
    assert.notEqual(temasVivos(s.temas), s.temas);
  });
}

/* ============================================================
   4 · Sellado de `actualizado` en todas las acciones mutables
   ============================================================ */

console.log("\nsellado de actualizado");
{
  const { materia, tema, cante, simulacro } = sembrar();
  const st = () => useStore.getState();
  const epigrafe = () => st().temas.find((t) => t.id === tema.id).epigrafes[0];

  conSellado("updateMateria", () => st().updateMateria(materia.id, { nombre: "Otra" }));
  conSellado("updateTema", () => st().updateTema(tema.id, { titulo: "Otro título" }));
  conSellado("addEpigrafe", () => st().addEpigrafe(tema.id, "Epígrafe nuevo"));
  conSellado("updateEpigrafe", () =>
    st().updateEpigrafe(tema.id, epigrafe().id, { titulo: "Epígrafe editado" }),
  );
  conSellado("setEpigrafes", () => {
    const eps = temasVivos(st().temas).find((t) => t.id === tema.id).epigrafes;
    st().setEpigrafes(
      tema.id,
      eps.map((e, i) => (i === 0 ? { ...e, texto: "texto cambiado" } : e)),
    );
  });
  conSellado("setEstado", () => st().setEstado(tema.id, "dominado"));
  conSellado("setDificultad", () => st().setDificultad(tema.id, 2));
  conSellado("alternarFavorito", () => st().alternarFavorito(tema.id));
  conSellado("sumarVuelta", () => st().sumarVuelta(tema.id));
  conSellado("updateCante", () => st().updateCante(cante.id, { nota: 9 }));
  conSellado("setAnalisisCante", () =>
    st().setAnalisisCante(cante.id, {
      titular: "t",
      diagnostico: "d",
      fortalezas: [],
      mejoras: [],
      focoProximaSesion: "f",
      epigrafesCriticos: [],
      generado: Date.now(),
      modelo: "m",
    }),
  );
  // La grabación: la ficha del audio, la transcripción y la comparación son
  // ediciones del cante como cualquier otra y tienen que mover su reloj, o el
  // servidor las descartaría sin decir nada.
  conSellado("setAudioCante", () =>
    st().setAudioCante(cante.id, {
      mime: "audio/webm",
      bytes: 1234,
      segundos: 42,
      marcas: [{ epigrafeId: "e1", titulo: "Uno", desdeMs: 0, hastaMs: 42000 }],
    }),
  );
  conSellado("setAudioCante (la subida rellena la ruta)", () =>
    st().setAudioCante(cante.id, { path: "u/c.webm", subido: Date.now() }),
  );
  conSellado("setTranscripcionCante", () =>
    st().setTranscripcionCante(cante.id, {
      texto: "lo que dijo el opositor",
      motor: "prueba/whisper",
      generado: Date.now(),
    }),
  );
  conSellado("setComparacionCante", () =>
    st().setComparacionCante(cante.id, {
      titular: "t",
      cobertura: 70,
      omisiones: [],
      dichoDeMas: [],
      epigrafesIncompletos: [],
      literalidad: "l",
      generado: Date.now(),
      modelo: "m",
    }),
  );

  prueba("setAudioCante funde y no pisa lo que ya había", () => {
    const c = useStore.getState().cantes.find((x) => x.id === cante.id);
    // Las dos llamadas de arriba: la primera puso las marcas y la duración,
    // la segunda solo la ruta. Si `setAudioCante` reemplazara en vez de
    // fundir, las marcas de epígrafe se habrían perdido al subir el audio y
    // el reproductor se quedaría sin capítulos.
    assert.equal(c.audio.path, "u/c.webm");
    assert.equal(c.audio.mime, "audio/webm");
    assert.equal(c.audio.segundos, 42);
    assert.equal(c.audio.marcas.length, 1);
    assert.ok(c.audio.subido > 0);
  });

  conSellado("responderKeyPoint", () =>
    st().responderKeyPoint(st().keypoints[0].id, true),
  );
  conSellado("updateNota", () => st().updateNota(st().notas[0].id, "otro texto"));
  conSellado("updateSimulacro", () =>
    st().updateSimulacro(simulacro.id, { completado: true }),
  );
  conSellado("pararCrono (progreso del tema)", () => {
    useStore.setState({
      crono: {
        tipo: "estudio",
        temaId: tema.id,
        desde: Date.now() - 600_000,
        acumulado: 0,
        pausado: false,
      },
    });
    st().pararCrono();
  });
  conSellado("guardarCante", () =>
    st().guardarCante({
      temaId: tema.id,
      segundos: 100,
      epigrafes: [],
      nota: 8,
      conPreparador: true,
    }),
  );
  conSellado("removeNota (la tumba también es una edición)", () =>
    st().removeNota(st().notas[0].id),
  );
  conSellado("removeTema (cascada)", () => st().removeTema(tema.id));

  prueba("editar un epígrafe no mueve el reloj del tema", () => {
    // Expediente limpio: el bloque anterior acabó borrando el tema.
    const nuevo = sembrar().tema;
    const antesTema = st().temas.find((t) => t.id === nuevo.id);
    const ep = antesTema.epigrafes[0];
    st().updateEpigrafe(nuevo.id, ep.id, { titulo: "Otro epígrafe más" });
    const despues = st().temas.find((t) => t.id === nuevo.id);
    assert.equal(
      despues.actualizado,
      antesTema.actualizado,
      "el tema y el epígrafe son filas distintas: el reloj del tema no se toca",
    );
    assert.ok(
      despues.epigrafes.find((e) => e.id === ep.id).actualizado > ep.actualizado,
      "el epígrafe editado no movió su propio reloj",
    );
  });

  prueba("una escritura que no cambia nada no mueve ningún reloj", () => {
    const antes = filasSelladas(useStore.getState());
    useStore.getState().updateMateria(materia.id, { nombre: "Otra" });
    for (const [clave, fila] of filasSelladas(useStore.getState())) {
      assert.equal(
        fila.actualizado,
        antes.get(clave).actualizado,
        `${clave} movió el reloj sin cambiar de contenido`,
      );
    }
  });

  prueba("toda fila mutable del expediente tiene reloj", () => {
    const s = useStore.getState();
    for (const [clave, fila] of filasSelladas(s)) {
      assert.equal(typeof fila.actualizado, "number", `${clave} sin reloj`);
    }
  });
}

/* ============================================================
   5 · Migración v2 → v3 de un expediente ya guardado
   ============================================================ */

console.log("\nmigración v2 → v3");
{
  const fechaInicio = Date.parse("2024-01-15T00:00:00Z");
  const fechaCante = Date.parse("2025-03-01T10:00:00Z");
  const fechaSimulacro = Date.parse("2025-04-02T09:00:00Z");
  const ultimoEstudio = Date.parse("2025-05-10T18:00:00Z");
  const respuestaKp = Date.parse("2025-02-01T12:00:00Z");

  // Expediente tal y como lo dejó la v2: sin `actualizado` en ninguna
  // entidad salvo notas y epígrafes, y con las tumbas de epígrafe en un
  // array aparte.
  const v2 = {
    perfil: { nombre: "Ana", fechaInicio },
    materias: [{ id: "m1", nombre: "Civil", abrev: "CIV", color: "#c00", ejercicio: 1, descripcion: "", orden: 0 }],
    temas: [
      {
        id: "t1",
        materiaId: "m1",
        numero: 1,
        titulo: "La persona física",
        epigrafes: [
          { id: "e1", orden: 1, titulo: "Nacimiento", creado: fechaInicio, actualizado: fechaInicio },
          { id: "e2", orden: 2, titulo: "Capacidad", creado: fechaInicio, actualizado: fechaInicio },
        ],
      },
    ],
    progresos: {
      t1: {
        temaId: "t1",
        estado: "cantable",
        segundos: 3600,
        dificultad: 3,
        vueltas: 1,
        ultimoEstudio,
        ultimoCante: fechaCante,
      },
    },
    sesiones: [{ id: "s1", temaId: "t1", tipo: "estudio", inicio: ultimoEstudio, fin: ultimoEstudio + 3600_000, segundos: 3600 }],
    cantes: [{ id: "c1", temaId: "t1", fecha: fechaCante, segundos: 600, epigrafes: [], nota: 7, conPreparador: false }],
    keypoints: [
      {
        id: "k1",
        temaId: "t1",
        anverso: "a",
        reverso: "b",
        creado: fechaInicio,
        aciertos: 2,
        fallos: 0,
        intervaloDias: 10,
        proximoRepaso: respuestaKp + 10 * DIA,
      },
      {
        id: "k2",
        temaId: "t1",
        anverso: "sin contestar",
        reverso: "b",
        creado: fechaCante,
        aciertos: 0,
        fallos: 0,
        intervaloDias: 1,
        proximoRepaso: fechaCante,
      },
    ],
    notas: [{ id: "n1", temaId: "t1", texto: "x", creado: fechaInicio, actualizado: fechaCante }],
    simulacros: [{ id: "si1", tipo: "cante", fecha: fechaSimulacro, temaIds: ["t1"], minutos: 10, segundosUsados: 60, notas: [6], completado: true }],
    vueltas: [{ id: "v1", temaId: "t1", fecha: fechaCante }],
    epigrafesBorrados: [{ id: "e9", temaId: "t1", borrado: fechaCante }],
    chat: [],
    crono: null,
  };

  const v3 = migrarARelojes(structuredClone(v2));

  prueba("no se pierde ni se duplica nada del expediente", () => {
    assert.equal(v3.materias.length, 1);
    assert.equal(v3.temas.length, 1);
    assert.equal(v3.cantes.length, 1);
    assert.equal(v3.keypoints.length, 2);
    assert.equal(v3.notas.length, 1);
    assert.equal(v3.simulacros.length, 1);
    assert.equal(v3.sesiones.length, 1);
    assert.equal(v3.vueltas.length, 1);
    assert.equal(v3.temas[0].titulo, "La persona física");
    assert.equal(v3.progresos.t1.segundos, 3600);
  });

  prueba("cada reloj toma el valor razonable de su entidad", () => {
    assert.equal(v3.cantes[0].actualizado, fechaCante, "cante → su fecha");
    assert.equal(v3.simulacros[0].actualizado, fechaSimulacro, "simulacro → su fecha");
    assert.equal(v3.progresos.t1.actualizado, ultimoEstudio, "progreso → último contacto");
    assert.equal(v3.keypoints[0].actualizado, respuestaKp, "keypoint → última respuesta");
    assert.equal(v3.keypoints[1].actualizado, fechaCante, "keypoint sin respuestas → creado");
    assert.equal(v3.notas[0].actualizado, fechaCante, "nota → el que ya tenía");
    assert.equal(v3.vueltas[0].actualizado, fechaCante, "vuelta → su fecha");
    assert.equal(v3.materias[0].actualizado, fechaInicio, "materia → inicio del expediente");
    assert.equal(v3.temas[0].actualizado, fechaInicio, "tema → inicio del expediente");
    assert.equal(v3.temas[0].epigrafes[0].actualizado, fechaInicio);
  });

  prueba("las tumbas de epígrafe se pliegan dentro del tema", () => {
    assert.equal(v3.epigrafesBorrados, undefined);
    const tumba = v3.temas[0].epigrafes.find((e) => e.id === "e9");
    assert.ok(tumba, "se perdió la tumba: el borrado dejaría de viajar");
    assert.equal(tumba.borrado, fechaCante);
    assert.equal(temasVivos(v3.temas)[0].epigrafes.length, 2, "la tumba se ve");
  });

  prueba("el expediente migrado se lee bien desde la app", () => {
    useStore.getState().borrarTodo();
    useStore.setState({
      materias: v3.materias,
      temas: v3.temas,
      progresos: v3.progresos,
      sesiones: v3.sesiones,
      cantes: v3.cantes,
      keypoints: v3.keypoints,
      notas: v3.notas,
      simulacros: v3.simulacros,
      vueltas: v3.vueltas,
    });
    const d = estadoVivo();
    assert.equal(d.temas.length, 1);
    assert.equal(d.temas[0].epigrafes.length, 2);
    const resumen = resumenGlobal(d.temas, d.progresos, d.sesiones, d.cantes, 45);
    assert.equal(resumen.totalTemas, 1);
    assert.equal(resumen.segundosTotales, 3600);
    assert.equal(resumen.notaMedia, 7);
    const der = derivarProgresos(d.progresos, d.sesiones, d.cantes, d.vueltas);
    assert.equal(der.t1.vueltas, 1);
    assert.equal(der.t1.segundos, 3600);
    // Y sigue borrándose bien después de migrar.
    useStore.getState().removeTema("t1");
    assert.equal(estadoVivo().temas.length, 0);
    assert.equal(useStore.getState().sesiones.length, 1, "se llevó la sesión");
  });

  prueba("migrar dos veces no cambia nada (idempotente)", () => {
    const otra = migrarARelojes(structuredClone(v3));
    assert.deepEqual(otra.cantes[0].actualizado, v3.cantes[0].actualizado);
    assert.deepEqual(otra.temas[0].epigrafes.length, v3.temas[0].epigrafes.length);
  });
}


/* ============================================================
   6 · Apariencia

   Dos cosas que, si se rompen, no dan error sino una app peor:

     1. Que los valores por defecto dejen de reproducir la app de siempre.
        Se comprueba contra el PROPIO app/globals.css, no contra una copia
        de sus valores en la prueba: si alguien retoca el CSS y no la tabla
        de lib/data/apariencia.ts (o al revés), esto se pone rojo.
     2. Que alguna combinación elegible deje texto que no se lee. Se
        comprueba por fuerza bruta sobre todo el círculo de tonos.
   ============================================================ */

console.log("\napariencia");
{
  const CSS = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

  /** Lee una variable de un bloque `:root…{}` del CSS de verdad. */
  function varCss(selector, nombre) {
    const bloque = CSS.slice(CSS.indexOf(selector + " {"));
    const cuerpo = bloque.slice(0, bloque.indexOf("}"));
    const m = cuerpo.match(new RegExp("\\" + nombre + ":\\s*([^;]+);"));
    return m ? m[1].trim() : null;
  }

  prueba("la tabla de tonos es un espejo fiel de globals.css", () => {
    for (const t of TONOS) {
      const selector = t.clase ? `:root.${t.clase}` : ":root";
      for (const [campo, variable] of [
        ["bg", "--bg"],
        ["surface", "--surface"],
        ["lacre", "--lacre"],
        ["lacreBright", "--lacre-bright"],
      ]) {
        assert.equal(
          varCss(selector, variable),
          t[campo],
          `${selector} ${variable}: el CSS dice ${varCss(selector, variable)} y la tabla ${t[campo]}`,
        );
      }
    }
  });

  prueba("el perfil por defecto pinta EXACTAMENTE la app de siempre", () => {
    const a = apariencia(PERFIL_INICIAL);
    assert.deepEqual(a.clases, [], "sin clases: el oscuro es el :root pelado");
    assert.equal(a.vars["--lacre"], varCss(":root", "--lacre"));
    assert.equal(a.vars["--lacre-bright"], varCss(":root", "--lacre-bright"));
    assert.equal(a.vars["--lacre-soft"], varCss(":root", "--lacre-soft"));
    assert.equal(a.vars["--lacre-fg"], varCss(":root", "--lacre-fg"));
    assert.equal(a.vars["--tema-fuente"], varCss(":root", "--tema-fuente"));
    assert.equal(a.vars["--tema-cuerpo"], varCss(":root", "--tema-cuerpo"));
  });

  prueba("el tema claro por defecto también sale calcado", () => {
    const a = apariencia({ ...PERFIL_INICIAL, tema: "light" });
    assert.deepEqual(a.clases, ["light"]);
    assert.equal(a.vars["--lacre"], varCss(":root.light", "--lacre"));
    assert.equal(a.vars["--lacre-bright"], varCss(":root.light", "--lacre-bright"));
    assert.equal(a.vars["--lacre-soft"], varCss(":root.light", "--lacre-soft"));
  });

  prueba("la densidad compacta añade su clase y nada más", () => {
    const normal = apariencia(PERFIL_INICIAL);
    const compacta = apariencia({ ...PERFIL_INICIAL, densidad: "compacta" });
    assert.deepEqual(compacta.clases, ["compacta"]);
    assert.deepEqual(compacta.vars, normal.vars, "la densidad no toca colores");
  });

  prueba("el cuerpo del texto de los temas sale en rem exactos", () => {
    assert.equal(apariencia(PERFIL_INICIAL).vars["--tema-cuerpo"], "1.0625rem");
    assert.equal(
      apariencia({ ...PERFIL_INICIAL, tamanoTema: 22 }).vars["--tema-cuerpo"],
      "1.375rem",
    );
  });

  prueba("la fuente sans solo cambia el texto de los temas", () => {
    const a = apariencia({ ...PERFIL_INICIAL, fuenteTemas: "sans" });
    assert.equal(a.vars["--tema-fuente"], "var(--font-ui)");
  });

  /** Comprueba los suelos de legibilidad de una semilla en los tres tonos. */
  function exigirLegible(semilla, etiqueta) {
    for (const t of TONOS) {
      const p = paletaAcento(semilla, t.id);
      const medidas = {
        "sólido sobre el fondo": [contraste(p.lacre, t.bg), MINIMO_SOLIDO],
        "sólido sobre la tarjeta": [contraste(p.lacre, t.surface), MINIMO_SOLIDO],
        "texto sobre el fondo": [contraste(p.lacreBright, t.bg), MINIMO_TEXTO_FONDO],
        "texto sobre la tarjeta": [
          contraste(p.lacreBright, t.surface),
          MINIMO_TEXTO_SUPERFICIE,
        ],
        "etiqueta sobre el sólido": [contraste(p.lacreFg, p.lacre), MINIMO_ETIQUETA],
      };
      for (const [que, [valor, minimo]] of Object.entries(medidas)) {
        assert.ok(
          valor + 1e-9 >= minimo,
          `${etiqueta} (${semilla}) en ${t.id}: ${que} = ${valor.toFixed(2)} < ${minimo}`,
        );
      }
    }
  }

  prueba("los cinco acentos con nombre se leen en los tres fondos", () => {
    for (const a of ACENTOS) {
      if (!a.semilla) continue;
      exigirLegible(a.semilla, a.nombre);
    }
  });

  prueba("NINGÚN color libre puede dejar el acento ilegible (fuerza bruta)", () => {
    let probados = 0;
    for (let h = 0; h < 360; h += 5) {
      for (const sat of [0.05, 0.25, 0.5, 0.75, 1]) {
        for (const luz of [0.02, 0.2, 0.35, 0.5, 0.65, 0.8, 0.98]) {
          exigirLegible(rgbAHex(hslARgb([h, sat, luz])), "libre");
          probados += 1;
        }
      }
    }
    assert.ok(probados >= 2500, `solo se han probado ${probados} colores`);
  });

  prueba("elegir un acento con nombre cambia de verdad lo que se pinta", () => {
    const casa = apariencia(PERFIL_INICIAL).vars;
    for (const a of ACENTOS) {
      if (a.id === "lacre" || a.id === "personal") continue;
      const otro = apariencia({ ...PERFIL_INICIAL, acento: a.id }).vars;
      assert.notEqual(
        otro["--lacre"],
        casa["--lacre"],
        `el acento ${a.nombre} pinta el mismo color que el lacre de la casa`,
      );
      // Y es exactamente el que sale del generador para ese tono: la
      // pantalla no puede prometer un color y aplicar otro.
      assert.deepEqual(
        paletaDe({ ...PERFIL_INICIAL, acento: a.id }),
        paletaAcento(a.semilla, "dark"),
      );
    }
    // Los cinco acentos son cinco colores distintos, no cinco nombres.
    const colores = new Set(
      ACENTOS.map((a) => apariencia({ ...PERFIL_INICIAL, acento: a.id }).vars["--lacre"]),
    );
    assert.equal(colores.size, ACENTOS.length, `solo ${colores.size} colores distintos`);
  });

  prueba("el acento libre es el que ha elegido el opositor, no otro", () => {
    const p = paletaDe({
      ...PERFIL_INICIAL,
      tema: "light",
      acento: "personal",
      acentoPersonal: "#2f6fb0",
    });
    // Ese azul ya contrasta de sobra sobre el papel: tiene que salir intacto.
    assert.equal(p.lacre, "#2f6fb0");
  });

  prueba("el mismo color se adapta a cada fondo cuando hace falta", () => {
    // Un azul de noche: sobre el papel se lee de sobra y sale tal cual;
    // sobre el fondo oscuro hay que aclararlo o desaparece.
    const noche = "#123a6b";
    const claro = paletaAcento(noche, "light");
    const oscuro = paletaAcento(noche, "dark");
    assert.equal(claro.lacre, noche, "sobre papel no había nada que corregir");
    assert.notEqual(oscuro.lacre, noche, "sobre el fondo oscuro no se ha aclarado");
    assert.ok(
      contraste(oscuro.lacre, TONOS[0].bg) > contraste(noche, TONOS[0].bg),
      "la corrección tiene que MEJORAR el contraste",
    );
    // Y un acento bien elegido no se toca en ningún tono: la corrección es
    // una red de seguridad, no un filtro que reescriba siempre.
    for (const t of TONOS) {
      assert.equal(paletaAcento("#2f8f63", t.id).lacre, "#2f8f63");
    }
  });

  prueba("un acento que ya se lee NO se toca", () => {
    // Un rojo lacre sobre el fondo oscuro cumple de sobra el mínimo de
    // sólido: la corrección es una red de seguridad, no un filtro de marca.
    const v = veredictoAcento("#c94152", "dark");
    assert.equal(v.corregido, false);
    assert.equal(v.aplicado, "#c94152");
  });

  prueba("un acento ilegible se corrige y se dice que se ha corregido", () => {
    // Azul marino casi negro sobre el fondo casi negro: invisible.
    const v = veredictoAcento("#0a0f2a", "dark");
    assert.equal(v.corregido, true);
    assert.ok(
      v.contrasteFondo >= MINIMO_SOLIDO,
      `sigue ilegible: ${v.contrasteFondo.toFixed(2)}`,
    );
  });

  prueba("el acento personal sin color no revienta el generador", () => {
    const p = paletaDe({ ...PERFIL_INICIAL, acento: "personal" });
    assert.ok(/^#[0-9a-f]{6}$/.test(p.lacre), `lacre raro: ${p.lacre}`);
  });

  prueba("normalizarPerfil salva un perfil con basura dentro", () => {
    const p = normalizarPerfil({
      acento: "arcoiris",
      tema: "fucsia",
      tamanoTema: 400,
      densidad: 7,
      ordenTemas: "por-lo-que-sea",
      vistaPrograma: null,
      acentoPersonal: "no-soy-un-color",
      nombre: "Marta",
    });
    assert.equal(p.acento, "lacre");
    assert.equal(p.tema, "dark");
    assert.equal(p.tamanoTema, 24, "se acota al máximo del esquema");
    assert.equal(p.densidad, "normal");
    assert.equal(p.ordenTemas, "numero");
    assert.equal(p.vistaPrograma, "mural");
    assert.equal(p.acentoPersonal, undefined);
    assert.equal(p.nombre, "Marta", "lo que sí era válido se respeta");
  });

  prueba("normalizarPerfil acepta y normaliza un hex corto", () => {
    const p = normalizarPerfil({ acento: "personal", acentoPersonal: "#F0A" });
    assert.equal(p.acentoPersonal, "#ff00aa");
  });

  prueba("la migración v3 → v4 rellena la apariencia sin tocar lo demás", () => {
    const viejo = {
      perfil: { nombre: "Marta", diasOxido: 30, tema: "light" },
      materias: [],
      temas: [],
      progresos: {},
      sesiones: [],
      cantes: [],
      keypoints: [],
      notas: [],
      simulacros: [],
      vueltas: [],
      chat: [],
      crono: null,
    };
    const p = migrarAApariencia(viejo).perfil;
    assert.equal(p.nombre, "Marta");
    assert.equal(p.diasOxido, 30);
    assert.equal(p.tema, "light");
    assert.equal(p.acento, "lacre");
    assert.equal(p.tamanoTema, 17);
    assert.equal(p.ordenTemas, "numero");
    // Y el resultado es la app de siempre, que es de lo que se trata.
    assert.deepEqual(apariencia(p).vars, apariencia({ ...PERFIL_INICIAL, tema: "light" }).vars);
  });

  prueba("un perfil que solo cambia la apariencia YA NO es de fábrica", () => {
    assert.equal(perfilDeFabrica(PERFIL_INICIAL), true);
    assert.equal(perfilDeFabrica({ ...PERFIL_INICIAL, tema: "sepia" }), true,
      "el tono sí sigue sin contar: es lo primero que toca todo el mundo");
    assert.equal(perfilDeFabrica({ ...PERFIL_INICIAL, acento: "jade" }), false);
    assert.equal(perfilDeFabrica({ ...PERFIL_INICIAL, densidad: "compacta" }), false);
    assert.equal(perfilDeFabrica({ ...PERFIL_INICIAL, ordenTemas: "nota" }), false);
  });
}

/* ============================================================
   7 · Orden de los temas configurable
   ============================================================ */

console.log("\norden de los temas");
{
  const st = () => useStore.getState();
  st().borrarTodo();
  const civil = st().addMateria("Civil", "CIV", "#c94152");
  const hipo = st().addMateria("Hipotecario", "HIP", "#3f93c4");

  // Se dan de alta en orden inverso al del programa para que ordenar "por
  // número" no salga bien por accidente.
  const h9 = st().addTema(hipo.id, 9, "Hipoteca");
  const c3 = st().addTema(civil.id, 3, "Nacionalidad");
  const c2 = st().addTema(civil.id, 2, "Ausencia");
  const c1 = st().addTema(civil.id, 1, "Persona física");

  // El expediente está montado para que los CINCO criterios den órdenes
  // DISTINTOS. Si no, una prueba en verde no demostraría que cada criterio
  // hace lo suyo: valdría con que todos ordenaran igual.
  //
  //   estado    C3 oxidado  < C2 estudiando < C1 cantable
  //   urgencia  C2 (400 d)  > C3 (60 d)     > C1 (1 d)
  //   tiempo    C1 100 s    < C3 500 s      < C2 9000 s
  //   nota      C3 (2)      < C1 (5)        < C2 (8)
  const ahora = Date.now();
  useStore.setState((s) => ({
    progresos: {
      ...s.progresos,
      [c1.id]: { ...s.progresos[c1.id], estado: "cantable", segundos: 100,
        notaMedia: 5, ultimoEstudio: ahora - DIA },
      [c2.id]: { ...s.progresos[c2.id], estado: "estudiando", segundos: 9000,
        notaMedia: 8, ultimoEstudio: ahora - 400 * DIA },
      // Dominado pero sin tocar hace 60 días: en pantalla sale OXIDADO, y es
      // el estado efectivo el que tiene que mandar al ordenar.
      [c3.id]: { ...s.progresos[c3.id], estado: "dominado", segundos: 500,
        notaMedia: 2, ultimoEstudio: ahora - 60 * DIA },
    },
  }));

  const temas = () => estadoVivo().temas;
  const materias = () => materiasOrdenadas(estadoVivo().materias);
  const progresos = () => estadoVivo().progresos;
  const etiqueta = (t) => `${t.materiaId === civil.id ? "C" : "H"}${t.numero}`;
  const orden = (criterio) =>
    temasOrdenados(temas(), materias(), criterio, progresos(), 45).map(etiqueta);

  prueba("por defecto ordena como siempre: materia y número", () => {
    assert.deepEqual(orden(), ["C1", "C2", "C3", "H9"]);
    assert.deepEqual(orden("numero"), ["C1", "C2", "C3", "H9"]);
  });

  prueba("por estado manda el estado EFECTIVO, no el guardado", () => {
    assert.deepEqual(orden("estado"), ["C3", "C2", "C1", "H9"]);
  });

  prueba("por urgencia, primero lo que hace más que no tocas", () => {
    assert.deepEqual(orden("urgencia"), ["C2", "C3", "C1", "H9"]);
  });

  prueba("por tiempo, primero los temas con menos horas", () => {
    assert.deepEqual(orden("tiempo"), ["C1", "C3", "C2", "H9"]);
  });

  prueba("por nota, primero los peor cantados", () => {
    assert.deepEqual(orden("nota"), ["C3", "C1", "C2", "H9"]);
  });

  prueba("los temas sin cantar van al final, no mezclados con los suspensos", () => {
    const sinCantar = st().addTema(civil.id, 4, "Sin cantar nunca");
    assert.deepEqual(orden("nota"), ["C3", "C1", "C2", "C4", "H9"]);
    st().removeTema(sinCantar.id);
  });

  prueba("los cinco criterios dan cinco órdenes distintos", () => {
    const vistos = new Set(
      ["numero", "estado", "urgencia", "tiempo", "nota"].map((c) => orden(c).join()),
    );
    assert.equal(vistos.size, 5, `solo ${vistos.size} órdenes distintos: ${[...vistos]}`);
  });

  prueba("el orden de materias manda por encima del criterio", () => {
    // Hipotecario delante: su tema pasa a ir primero pase lo que pase.
    st().moverMateria(hipo.id, -1);
    assert.deepEqual(orden("nota"), ["H9", "C3", "C1", "C2"]);
    assert.deepEqual(orden(), ["H9", "C1", "C2", "C3"]);
    st().moverMateria(hipo.id, 1);
    assert.deepEqual(orden("nota"), ["C3", "C1", "C2", "H9"]);
  });

  prueba("moverMateria no se sale de la lista", () => {
    const antes = materias().map((m) => m.id);
    st().moverMateria(antes[0], -1);
    st().moverMateria(antes[antes.length - 1], 1);
    assert.deepEqual(materias().map((m) => m.id), antes);
  });

  prueba("moverMateria mueve el reloj de las DOS materias que intercambia", () => {
    const antes = new Map(materias().map((m) => [m.id, m.actualizado]));
    const ids = materias().map((m) => m.id);
    st().moverMateria(ids[1], -1);
    const movidas = materias().filter((m) => m.actualizado > antes.get(m.id));
    assert.equal(movidas.length, 2, `relojes movidos: ${movidas.length}`);
    st().moverMateria(ids[1], 1);
  });

  prueba("en las colas de triaje el orden por defecto sigue siendo la urgencia", () => {
    assert.equal(ordenDeTriaje("numero"), "urgencia");
    assert.equal(ordenDeTriaje("nota"), "nota");
    assert.equal(ordenDeTriaje("urgencia"), "urgencia");
  });

  prueba("temasOrdenados no muta el array que recibe", () => {
    const entrada = temas();
    const copia = [...entrada];
    temasOrdenados(entrada, materias(), "nota", progresos(), 45);
    assert.deepEqual(entrada, copia);
  });
}


/* ============================================================
   8 · Artículos: acciones del store

   Lo que se comprueba aquí es lo que, si se rompe, no da error sino
   pérdida de trabajo: el artículo es lo único del modelo que el opositor
   ha copiado entero a mano.
   ============================================================ */

console.log("\nartículos");
{
  const st = () => useStore.getState();
  st().borrarTodo();
  const materia = st().addMateria("Civil", "CIV", "#c94152");
  const tema = st().addTema(materia.id, 47, "La hipoteca");
  const otroTema = st().addTema(materia.id, 48, "La prenda");
  st().addEpigrafe(tema.id, "Concepto");
  st().addEpigrafe(tema.id, "Caracteres");
  const [epA, epB] = st().temas.find((t) => t.id === tema.id).epigrafes;

  const arts = () => vivos(st().articulos);
  const deTema = (id = tema.id) => arts().filter((a) => a.temaId === id);

  prueba("el alta suelta guarda el artículo entero", () => {
    const a = st().addArticulo(tema.id, {
      cuerpo: "CC",
      numero: "1857",
      titulo: "Requisitos esenciales",
      contenido: "Son requisitos esenciales de los contratos de prenda e hipoteca…",
      epigrafeId: epA.id,
    });
    const guardado = arts().find((x) => x.id === a.id);
    assert.equal(guardado.contenido.startsWith("Son requisitos"), true);
    assert.equal(guardado.epigrafeId, epA.id);
    assert.ok(guardado.creado > 0 && guardado.actualizado > 0);
  });

  prueba("el alta en lote numera en orden y no pisa lo que ya había", () => {
    const n = st().addArticulos(
      tema.id,
      [
        { cuerpo: "CC", numero: "1858", titulo: "", contenido: "Es también de esencia…" },
        { cuerpo: "CC", numero: "1859", titulo: "Pacto comisorio", contenido: "El acreedor no puede…" },
      ],
      epA.id,
    );
    assert.equal(n, 2);
    const ordenes = deTema().map((a) => a.orden);
    assert.deepEqual([...new Set(ordenes)].length, ordenes.length, "hay órdenes repetidos");
    assert.deepEqual([...ordenes].sort((x, y) => x - y), [1, 2, 3]);
  });

  prueba("una fila sin número no se da de alta", () => {
    const antes = deTema().length;
    const n = st().addArticulos(tema.id, [
      { cuerpo: "CC", numero: "  ", titulo: "", contenido: "texto huérfano" },
    ]);
    assert.equal(n, 0);
    assert.equal(deTema().length, antes);
  });

  prueba("editar un artículo mueve su reloj", () => {
    const a = deTema()[0];
    const antes = a.actualizado;
    st().updateArticulo(a.id, { titulo: "Requisitos esenciales de prenda e hipoteca" });
    const despues = arts().find((x) => x.id === a.id);
    assert.ok(despues.actualizado > antes, "el reloj no se ha movido");
    assert.equal(despues.titulo, "Requisitos esenciales de prenda e hipoteca");
  });

  prueba("reescribir un artículo con lo mismo NO mueve su reloj", () => {
    const a = deTema()[0];
    const antes = a.actualizado;
    st().updateArticulo(a.id, { titulo: a.titulo, contenido: a.contenido });
    assert.equal(arts().find((x) => x.id === a.id).actualizado, antes);
  });

  prueba("moverArticulo intercambia el orden y mueve los DOS relojes", () => {
    const orden = () => deTema().sort((a, b) => a.orden - b.orden).map((a) => a.numero);
    assert.deepEqual(orden(), ["1857", "1858", "1859"]);
    const antes = new Map(deTema().map((a) => [a.id, a.actualizado]));
    const segundo = deTema().find((a) => a.numero === "1858");
    st().moverArticulo(segundo.id, -1);
    assert.deepEqual(orden(), ["1858", "1857", "1859"]);
    const movidos = deTema().filter((a) => a.actualizado > antes.get(a.id));
    assert.equal(movidos.length, 2, `relojes movidos: ${movidos.length}`);
    st().moverArticulo(segundo.id, 1);
    assert.deepEqual(orden(), ["1857", "1858", "1859"]);
  });

  prueba("moverArticulo no se sale de la lista", () => {
    const antes = deTema().map((a) => a.orden);
    const lista = deTema().sort((a, b) => a.orden - b.orden);
    st().moverArticulo(lista[0].id, -1);
    st().moverArticulo(lista[lista.length - 1].id, 1);
    assert.deepEqual(deTema().map((a) => a.orden), antes);
  });

  prueba("moverArticulo solo cambia de sitio dentro de su epígrafe", () => {
    const suelto = st().addArticulo(tema.id, { cuerpo: "LH", numero: "104" });
    const antes = arts().find((a) => a.id === suelto.id).orden;
    // Es el único de su grupo: no tiene con quién intercambiarse, aunque por
    // delante haya tres artículos del epígrafe A.
    st().moverArticulo(suelto.id, -1);
    assert.equal(arts().find((a) => a.id === suelto.id).orden, antes);
    st().removeArticulo(suelto.id);
  });

  prueba("borrar un artículo deja tumba, no vacía el array", () => {
    const a = deTema().find((x) => x.numero === "1859");
    st().removeArticulo(a.id);
    const crudo = st().articulos.find((x) => x.id === a.id);
    assert.ok(crudo, "la fila ha desaparecido del array y no habría nada que empujar");
    assert.ok(crudo.borrado > 0);
    assert.ok(crudo.actualizado >= crudo.borrado, "la tumba no lleva reloj");
    assert.ok(!arts().some((x) => x.id === a.id), "la tumba se sigue leyendo");
  });

  prueba("borrar un EPÍGRAFE no borra sus artículos: se quedan en el tema", () => {
    st().addArticulo(tema.id, { cuerpo: "CC", numero: "1860", epigrafeId: epB.id });
    const antes = deTema().length;
    const delEpigrafe = deTema().filter((a) => a.epigrafeId === epA.id);
    assert.ok(delEpigrafe.length >= 2, "el escenario no tiene artículos en el epígrafe");
    const relojes = new Map(delEpigrafe.map((a) => [a.id, a.actualizado]));

    st().removeEpigrafe(tema.id, epA.id);

    assert.equal(deTema().length, antes, "la cuenta de artículos ha cambiado");
    const despues = deTema().filter((a) => relojes.has(a.id));
    assert.ok(despues.every((a) => a.borrado == null), "se ha borrado alguno");
    assert.ok(despues.every((a) => !a.epigrafeId), "alguno sigue colgando del epígrafe muerto");
    // Es una modificación como otra cualquiera: sin reloj nuevo no viajaría y
    // el otro dispositivo los seguiría enseñando bajo un epígrafe que no está.
    assert.ok(
      despues.every((a) => a.actualizado > relojes.get(a.id)),
      "quedarse sin epígrafe no ha movido el reloj",
    );
    // Y no se meten en mitad de la lista de otro: van al final del tema.
    const ordenes = deTema().map((a) => a.orden);
    assert.equal([...new Set(ordenes)].length, ordenes.length, "hay órdenes repetidos");
  });

  prueba("el artículo del otro epígrafe sigue en el suyo", () => {
    const a = deTema().find((x) => x.numero === "1860");
    assert.equal(a.epigrafeId, epB.id);
  });

  prueba("borrar el tema sí arrastra sus artículos", () => {
    st().addArticulo(otroTema.id, { cuerpo: "CC", numero: "1863" });
    st().removeTema(tema.id);
    assert.equal(deTema().length, 0, "quedan artículos vivos del tema borrado");
    assert.equal(deTema(otroTema.id).length, 1, "se llevó los del tema vecino");
    assert.ok(
      st().articulos.filter((a) => a.temaId === tema.id).every((a) => a.borrado != null),
    );
  });

  prueba("borrar la materia arrastra los artículos de todos sus temas", () => {
    st().removeMateria(materia.id);
    assert.equal(arts().length, 0, "sobrevivió algún artículo a la materia borrada");
  });

  prueba("la cola de sincronización no encola artículos sin Supabase", () => {
    // Sin cuenta configurada la app entera funciona en local: llevar la
    // cuenta de una cola que nadie va a vaciar solo gastaría escrituras.
    assert.deepEqual(Object.keys(st().cola), []);
  });
}

/* ============================================================
   9 · Troceado de un bloque pegado

   La vía de entrada real: el opositor copia y pega. Lo que se vigila aquí
   es lo de siempre con los parsers — que no se inventen nada. Mejor una
   rúbrica vacía que una rúbrica falsa, y mejor "no he encontrado nada" que
   un troceado por donde caiga.
   ============================================================ */

console.log("\ntroceado de un bloque pegado");
{
  prueba("parte un bloque del Código por sus cabeceras", () => {
    const r = parsearArticulos(
      [
        "Artículo 1255.",
        "Los contratantes pueden establecer los pactos, cláusulas y condiciones que tengan por conveniente.",
        "",
        "Artículo 1256.",
        "La validez y el cumplimiento de los contratos no pueden dejarse al arbitrio de uno de los contratantes.",
      ].join("\n"),
      "CC",
    );
    assert.equal(r.length, 2);
    assert.equal(r[0].numero, "1255");
    assert.equal(r[0].cuerpo, "CC");
    assert.ok(r[0].contenido.startsWith("Los contratantes"));
    assert.ok(!r[0].contenido.includes("Artículo 1256"), "se ha comido la frontera");
    assert.equal(r[1].numero, "1256");
  });

  prueba("separa la rúbrica cuando va en su propia línea", () => {
    const r = parsearArticulos(
      [
        "Artículo 34",
        "Fe pública registral",
        "El tercero que de buena fe adquiera a título oneroso algún derecho de persona que",
        "en el Registro aparezca con facultades para transmitirlo, será mantenido en su adquisición.",
      ].join("\n"),
      "LH",
    );
    assert.equal(r.length, 1);
    assert.equal(r[0].titulo, "Fe pública registral");
    assert.equal(r[0].cuerpo, "LH");
    assert.ok(r[0].contenido.startsWith("El tercero"));
  });

  prueba("separa la rúbrica cuando va detrás del número", () => {
    const r = parsearArticulos(
      ["Art. 1858 CC — Realización del valor", "Es también de esencia de estos contratos…"].join("\n"),
    );
    assert.equal(r[0].numero, "1858");
    assert.equal(r[0].cuerpo, "CC");
    assert.equal(r[0].titulo, "Realización del valor");
    assert.ok(r[0].contenido.startsWith("Es también"));
  });

  prueba("si la rúbrica no se distingue, se deja VACÍA y no se inventa", () => {
    // Lo que sigue al número es el texto del artículo, no su rúbrica, y la
    // forma es EXACTAMENTE la misma que la de "1858. Realización del valor".
    // Lo único que las separa es que una frase termina en punto.
    const r = parsearArticulos(
      [
        "Artículo 1256. La validez de los contratos no puede dejarse al arbitrio.",
        "Lo dijo el Tribunal Supremo mil veces.",
      ].join("\n"),
      "CC",
    );
    assert.equal(r.length, 1);
    assert.equal(r[0].titulo, "", `se ha inventado la rúbrica: ${r[0].titulo}`);
    assert.ok(r[0].contenido.startsWith("La validez"));
    assert.ok(r[0].contenido.includes("Tribunal Supremo"), "se ha comido el texto");
  });

  prueba("una rúbrica larguísima tampoco se da por buena", () => {
    const r = parsearArticulos(
      [
        "Artículo 1255. Los contratantes pueden establecer los pactos, cláusulas y condiciones que tengan por conveniente",
        "siempre que no sean contrarios a las leyes, a la moral ni al orden público.",
      ].join("\n"),
      "CC",
    );
    assert.equal(r[0].titulo, "");
    assert.ok(r[0].contenido.startsWith("Los contratantes"));
  });

  prueba("una línea corta sin nada debajo es el artículo, no su rúbrica", () => {
    const r = parsearArticulos("Artículo 3. Las leyes no tendrán efecto retroactivo", "CC");
    assert.equal(r[0].titulo, "");
    assert.equal(r[0].contenido, "Las leyes no tendrán efecto retroactivo");
  });

  prueba("lee el número con ordinal y con punto de millar", () => {
    const r = parsearArticulos(
      ["Artículo 1.255 bis.", "Texto del bis.", "ARTÍCULO 9.1", "Texto del apartado."].join("\n"),
      "CC",
    );
    assert.equal(r[0].numero, "1255 bis");
    assert.equal(r[1].numero, "9.1");
  });

  prueba("acepta la cabecera sin la palabra «artículo» si trae el cuerpo", () => {
    const r = parsearArticulos(["104 LH", "La hipoteca sujeta directa e inmediatamente los bienes."].join("\n"));
    assert.equal(r.length, 1);
    assert.equal(r[0].numero, "104");
    assert.equal(r[0].cuerpo, "LH");
  });

  prueba("un índice de epígrafes numerado NO se lee como articulado", () => {
    // Sin esta cautela, pegar el índice de un tema daría de alta media
    // docena de artículos que no existen.
    const r = parsearArticulos(
      ["1. Concepto y caracteres", "2. Clases de hipoteca", "3. La hipoteca de máximo"].join("\n"),
    );
    assert.deepEqual(r, []);
  });

  prueba("sin ninguna cabecera se dice que no se ha encontrado nada", () => {
    const r = parsearArticulos("La hipoteca es un derecho real de garantía que recae sobre inmuebles.");
    assert.deepEqual(r, []);
  });

  prueba("el cuerpo de la cabecera gana al que se pasa por defecto", () => {
    const r = parsearArticulos(["Art. 34 LH", "Fe pública", "El tercero que…"].join("\n"), "CC");
    assert.equal(r[0].cuerpo, "LH");
  });
}

/* ============================================================
   10 · Citas de pasada

   Distinto del troceado: aquí no hay texto del artículo, solo la mención.
   De una mención salen número y cuerpo, y nada más.
   ============================================================ */

console.log("\ncitas en el texto de los epígrafes");
{
  prueba("detecta las formas que el opositor escribe de verdad", () => {
    const c = extraerCitas(
      "Rige el art. 1255 CC, matizado por el artículo 34 de la Ley Hipotecaria y por el art. 9.1 LH.",
    );
    assert.deepEqual(
      c.map((x) => `${x.numero} ${x.cuerpo}`),
      ["1255 CC", "34 LH", "9.1 LH"],
    );
  });

  prueba("una serie «y ss.» se marca, no se expande", () => {
    // Inventarse el 1089, el 1090 y los que hagan falta sería dar de alta
    // artículos que nadie ha escrito.
    const c = extraerCitas("Ver arts. 1088 y ss. CC");
    assert.equal(c.length, 1);
    assert.equal(c[0].numero, "1088");
    assert.equal(c[0].siguientes, true);
  });

  prueba("una enumeración da todos los números con el mismo cuerpo", () => {
    const c = extraerCitas("Los arts. 1261, 1262 y 1274 del Código Civil.");
    assert.deepEqual(c.map((x) => x.numero), ["1261", "1262", "1274"]);
    assert.ok(c.every((x) => x.cuerpo === "CC"));
  });

  prueba("de la cita NO sale ni rúbrica ni contenido", () => {
    const [c] = extraerCitas("art. 1255 CC");
    assert.deepEqual(Object.keys(c).sort(), [
      "cuerpo",
      "epigrafeId",
      "numero",
      "siguientes",
      "veces",
    ]);
  });

  prueba("sin cuerpo reconocible el cuerpo se queda vacío", () => {
    const [c] = extraerCitas("como dice el artículo 47, la cosa cambia");
    assert.equal(c.numero, "47");
    assert.equal(c.cuerpo, "");
  });

  prueba("la misma cita repetida se cuenta, no se duplica", () => {
    const c = extraerCitas("El art. 1255 CC y, más abajo, otra vez el artículo 1.255 del Código Civil.");
    assert.equal(c.length, 1);
    assert.equal(c[0].veces, 2);
  });

  prueba("un número suelto que no es una cita no se recoge", () => {
    assert.deepEqual(extraerCitas("La sanción es de 1.500 euros y el plazo, de 30 días."), []);
  });

  prueba("propone solo lo que todavía no está dado de alta", () => {
    const st = () => useStore.getState();
    st().borrarTodo();
    const m = st().addMateria("Civil", "CIV", "#c94152");
    const t = st().addTema(m.id, 47, "La hipoteca");
    st().addEpigrafe(t.id, "Concepto", "Según el art. 1857 CC y el 104 LH, la hipoteca…");
    const tema = temasVivos(st().temas).find((x) => x.id === t.id);

    assert.deepEqual(
      articulosPropuestos(tema, st().articulos).map((c) => `${c.numero} ${c.cuerpo}`),
      ["1857 CC", "104 LH"],
    );

    st().addArticulo(t.id, { cuerpo: "CC", numero: "1857" });
    assert.deepEqual(
      articulosPropuestos(tema, st().articulos).map((c) => `${c.numero} ${c.cuerpo}`),
      ["104 LH"],
    );
  });
}

/* ============================================================
   11 · Índice cruzado

   "El 1255 CC te sale en los temas 67, 70 y 95." Es lo que más pregunta el
   tribunal, y todo depende de normalizar: CC, C.C. y Código Civil son lo
   mismo, y 1255 y 1.255 también.
   ============================================================ */

console.log("\níndice cruzado");
{
  prueba("normaliza el cuerpo legal", () => {
    assert.equal(normalizarCuerpo("CC"), "CC");
    assert.equal(normalizarCuerpo("C.C."), "CC");
    assert.equal(normalizarCuerpo("Código Civil"), "CC");
    assert.equal(normalizarCuerpo("codigo civil"), "CC");
    assert.equal(normalizarCuerpo("Ley Hipotecaria"), "LH");
    // Una ley que no está en la lista pero se cita con siglas se respeta.
    assert.equal(normalizarCuerpo("L.M.V."), "LMV");
    // Lo que no parece un cuerpo no se convierte en uno.
    assert.equal(normalizarCuerpo("la doctrina"), "");
  });

  prueba("normaliza el número", () => {
    assert.equal(normalizarNumero("1.255"), "1255");
    assert.equal(normalizarNumero("1255"), "1255");
    assert.equal(normalizarNumero("9.1"), "9.1", "se ha comido el apartado");
    assert.equal(normalizarNumero("1255 BIS"), "1255 bis");
    assert.equal(normalizarNumero("34."), "34");
  });

  prueba("dos formas de escribir el mismo artículo comparten clave", () => {
    assert.equal(claveArticulo("C.C.", "1.255"), claveArticulo("Código Civil", "1255"));
    assert.notEqual(claveArticulo("CC", "1255"), claveArticulo("LH", "1255"));
    // Sin cuerpo no se cruza con los que sí lo tienen: el 34 a secas puede
    // ser el de cualquier ley y decidirlo por el opositor sería mentir.
    assert.notEqual(claveArticulo("", "34"), claveArticulo("LH", "34"));
  });

  prueba("dice en qué otros temas aparece el artículo", () => {
    const st = () => useStore.getState();
    st().borrarTodo();
    const m = st().addMateria("Civil", "CIV", "#c94152");
    const t67 = st().addTema(m.id, 67, "Obligaciones");
    const t70 = st().addTema(m.id, 70, "Contratos");
    const t95 = st().addTema(m.id, 95, "Compraventa");
    const t99 = st().addTema(m.id, 99, "Ajeno");

    st().addArticulo(t67.id, { cuerpo: "CC", numero: "1255" });
    // Escrito de otra manera: tiene que cruzar igual.
    st().addArticulo(t95.id, { cuerpo: "C.C.", numero: "1.255" });
    st().addArticulo(t99.id, { cuerpo: "LH", numero: "1255" });
    // En el 70 no está dado de alta: solo se menciona en el texto.
    st().addEpigrafe(t70.id, "Autonomía de la voluntad", "Lo consagra el art. 1255 del Código Civil.");

    const temas = temasVivos(st().temas);
    const articulos = vivos(st().articulos);
    const ref = articulos.find((a) => a.temaId === t67.id);

    const otros = temasDeArticulo(ref, articulos, temas);
    assert.deepEqual(otros.map((a) => a.numeroTema), [70, 95], "el cruce no cuadra");
    assert.deepEqual(otros.map((a) => a.fuente), ["cita", "articulo"]);
    assert.ok(!otros.some((a) => a.temaId === t67.id), "se incluye a sí mismo");
    assert.ok(!otros.some((a) => a.temaId === t99.id), "cruza artículos de otra ley");
  });

  prueba("el índice completo pone el alta por delante de la cita", () => {
    const st = () => useStore.getState();
    st().borrarTodo();
    const m = st().addMateria("Civil", "CIV", "#c94152");
    const t = st().addTema(m.id, 67, "Obligaciones");
    st().addEpigrafe(t.id, "Concepto", "El art. 1255 CC dice…");
    st().addArticulo(t.id, { cuerpo: "CC", numero: "1255" });

    const apariciones = indiceCruzado(vivos(st().articulos), temasVivos(st().temas)).get(
      claveArticulo("CC", "1255"),
    );
    assert.equal(apariciones.length, 1, "el mismo tema sale dos veces");
    assert.equal(apariciones[0].fuente, "articulo");
  });

  prueba("un tema borrado desaparece del índice cruzado", () => {
    const st = () => useStore.getState();
    st().borrarTodo();
    const m = st().addMateria("Civil", "CIV", "#c94152");
    const a = st().addTema(m.id, 1, "Vivo");
    const b = st().addTema(m.id, 2, "Se borra");
    st().addArticulo(a.id, { cuerpo: "CC", numero: "1255" });
    st().addArticulo(b.id, { cuerpo: "CC", numero: "1255" });
    st().removeTema(b.id);

    const ref = vivos(st().articulos).find((x) => x.temaId === a.id);
    // Se le pasan las colecciones EN CRUDO a propósito: el índice tiene que
    // filtrar las tumbas por su cuenta, porque es lo que hará el día que
    // alguien se lo llame sin pasar por los hooks.
    const otros = temasDeArticulo(ref, st().articulos, st().temas);
    assert.deepEqual(otros, []);
  });

  prueba("agrupa los artículos por epígrafe y deja los sueltos al final", () => {
    const st = () => useStore.getState();
    st().borrarTodo();
    const m = st().addMateria("Civil", "CIV", "#c94152");
    const t = st().addTema(m.id, 1, "Tema");
    st().addEpigrafe(t.id, "Uno");
    st().addEpigrafe(t.id, "Dos");
    const eps = temasVivos(st().temas).find((x) => x.id === t.id).epigrafes;
    st().addArticulo(t.id, { cuerpo: "CC", numero: "3" });
    st().addArticulo(t.id, { cuerpo: "CC", numero: "1", epigrafeId: eps[0].id });
    st().addArticulo(t.id, { cuerpo: "CC", numero: "2", epigrafeId: eps[1].id });

    const grupos = agruparPorEpigrafe(vivos(st().articulos), eps);
    assert.deepEqual(
      grupos.map((g) => [g.epigrafe?.titulo ?? "(sueltos)", g.articulos.map((a) => a.numero)]),
      [
        ["Uno", ["1"]],
        ["Dos", ["2"]],
        ["(sueltos)", ["3"]],
      ],
    );
  });

  prueba("la etiqueta del artículo se lee entera", () => {
    assert.equal(etiquetaArticulo({ cuerpo: "C.C.", numero: "1.255" }), "artículo 1255 CC");
    assert.equal(etiquetaArticulo({ numero: "34" }), "artículo 34");
  });
}

/* ============================================================
   12 · La lente de lectura

   Quien no cree ningún artículo tiene que ver EXACTAMENTE la app de hoy:
   el tema entero.
   ============================================================ */

console.log("\nlente de lectura");
{
  prueba("el perfil de fábrica abre el tema entero", () => {
    assert.equal(PERFIL_INICIAL.nivelLectura, "completo");
  });

  prueba("un perfil sin lente cae en el tema entero", () => {
    // Es el perfil de quien tenía la app instalada antes de todo esto.
    const { nivelLectura, ...sinLente } = PERFIL_INICIAL;
    assert.equal(normalizarPerfil(sinLente).nivelLectura, "completo");
  });

  prueba("una lente inventada no llega a la interfaz", () => {
    assert.equal(
      normalizarPerfil({ ...PERFIL_INICIAL, nivelLectura: "diagonal" }).nivelLectura,
      "completo",
    );
  });

  prueba("las tres lentes válidas se conservan", () => {
    for (const n of ["articulos", "articulos-texto", "completo"]) {
      assert.equal(normalizarPerfil({ ...PERFIL_INICIAL, nivelLectura: n }).nivelLectura, n);
    }
  });

  prueba("elegir lente es una escritura del perfil como otra cualquiera", () => {
    const st = () => useStore.getState();
    st().borrarTodo();
    st().setPerfil({ nivelLectura: "articulos" });
    assert.equal(st().perfil.nivelLectura, "articulos");
  });

  prueba("un expediente de la v4 estrena la colección de artículos vacía", () => {
    const migrado = migrarAArticulos({ materias: [], temas: [] });
    assert.deepEqual(migrado.articulos, []);
  });
}

console.log(
  `\n${hechas - fallos}/${hechas} pruebas en verde` +
    (fallos ? `  ·  ${fallos} FALLIDAS` : ""),
);
process.exit(fallos ? 1 : 0);
