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
import { temasVivos, vivos, vivosMapa } from "../lib/data/vivos.ts";
import { derivarProgresos } from "../lib/data/derivados.ts";
import {
  colaDeRepaso,
  epigrafesProblematicos,
  detectarLagunas,
  resumenGlobal,
  statsPorMateria,
} from "../lib/data/srs.ts";
import { migrarARelojes } from "../lib/store/migraciones.ts";

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
    assert.equal(copia.version, 3);
    assert.ok(!copia.temas.some((t) => t.id === tema.id));
    assert.ok(!copia.cantes.length);
    assert.ok(!copia.notas.length);
    assert.ok(!copia.keypoints.length);
    assert.ok(!copia.vueltas.length);
    assert.equal(copia.progresos[tema.id], undefined);
    assert.ok(copia.sesiones.length >= 2, "el export perdió las sesiones");
    assert.ok(copia.temas.some((t) => t.id === otro.id), "se llevó el tema vivo");
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

console.log(
  `\n${hechas - fallos}/${hechas} pruebas en verde` +
    (fallos ? `  ·  ${fallos} FALLIDAS` : ""),
);
process.exit(fallos ? 1 : 0);
