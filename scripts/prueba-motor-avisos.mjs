/**
 * Pruebas del motor de decisión de avisos.
 *
 * Corren contra el código real (lib/avisos/motor.ts, que a su vez usa
 * lib/data/srs.ts sin copiar nada), igual que pruebas/modelo.mjs. Lo que se
 * comprueba aquí es lo que, si se rompe, no da error sino avisos malos:
 *
 *   · que avisa de lo que hay que avisar, con el número de tema dentro;
 *   · que NO avisa a quien va al día — el fallo más caro de todos, porque el
 *     opositor apaga las notificaciones y ya no vuelve;
 *   · que no repite el mismo aviso dos días seguidos;
 *   · que no manda dos en un día;
 *   · que respeta lo que el opositor ha apagado;
 *   · que el enlace lleva al tema concreto y no a la portada.
 *
 * Uso:
 *   node --experimental-strip-types --import ./pruebas/cargador.mjs \
 *        scripts/prueba-motor-avisos.mjs
 */

// Antes de cualquier `Date`: el SRS trabaja con días locales del proceso
// (`claveDia`, `calcularRacha`), así que sin fijar la zona la prueba diría
// cosas distintas según dónde corra.
process.env.TZ = "Europe/Madrid";

import assert from "node:assert/strict";

import { candidatosDeAviso, decidirAviso } from "../lib/avisos/motor.ts";
import { conZona, horaLocal, minutosDeHora, tocaAhora } from "../lib/avisos/zonas.ts";

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
   Expedientes de mentira
   ============================================================ */

const AHORA = Date.now();

/** Mediodía local de hace `n` días. Con Date y no con restas de ms: así no se
 *  descuadra en el cambio de hora. */
function haceDias(n) {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return d.getTime();
}

function claveDiaLocal(ts) {
  const d = new Date(ts);
  const p = (x) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const materia = (id, nombre) => ({
  id,
  nombre,
  abrev: nombre.slice(0, 3).toUpperCase(),
  color: "#c9a227",
  ejercicio: 1,
  descripcion: "",
  orden: 0,
  actualizado: 0,
});

const tema = (id, materiaId, numero, titulo) => ({
  id,
  materiaId,
  numero,
  titulo,
  epigrafes: [],
  actualizado: 0,
});

const progreso = (temaId, estado, diasSinTocar, extra = {}) => ({
  temaId,
  estado,
  segundos: 3600,
  dificultad: 3,
  vueltas: 0,
  ultimoEstudio: diasSinTocar == null ? undefined : haceDias(diasSinTocar),
  actualizado: 0,
  ...extra,
});

const sesion = (diasAtras, segundos, temaId) => ({
  id: `s${diasAtras}`,
  temaId,
  tipo: "estudio",
  inicio: haceDias(diasAtras),
  fin: haceDias(diasAtras) + segundos * 1000,
  segundos,
});

const mapa = (...ps) => Object.fromEntries(ps.map((p) => [p.temaId, p]));

const PERFIL = { diasOxido: 45, objetivoHorasSemana: 45, tipos: ["oxido", "repaso", "racha", "simulacro"] };

/** Un opositor con un tema muy oxidado y otro con el repaso pasado. */
function expedienteOxidado() {
  return {
    materias: [materia("m-civ", "Derecho Civil")],
    temas: [
      tema("t-fresco", "m-civ", 12, "La compraventa"),
      tema("t-oxido", "m-civ", 33, "La hipoteca de máximo"),
      tema("t-viejo", "m-civ", 50, "Las servidumbres"),
    ],
    progresos: mapa(
      progreso("t-fresco", "dominado", 2),
      progreso("t-oxido", "dominado", 60),
      progreso("t-viejo", "estudiando", 20),
    ),
    // Ha estudiado hoy: así no se cuela el aviso de racha, que taparía al resto.
    sesiones: [sesion(0, 3600, "t-fresco")],
    simulacros: [],
    perfil: { ...PERFIL },
  };
}

/** Estudia todos los días, pero hace once que no abre Hipotecario. */
function expedienteMateriaAbandonada() {
  return {
    materias: [materia("m-civ", "Derecho Civil"), materia("m-hip", "Derecho Hipotecario")],
    temas: [
      tema("t-civ", "m-civ", 5, "La persona"),
      tema("t-hip", "m-hip", 33, "El principio de fe pública"),
      tema("t-hip2", "m-hip", 34, "La anotación preventiva"),
    ],
    progresos: mapa(
      progreso("t-civ", "estudiando", 0),
      progreso("t-hip", "estudiando", 11),
      progreso("t-hip2", "estudiando", 11),
    ),
    sesiones: [sesion(0, 7200, "t-civ")],
    simulacros: [],
    perfil: { ...PERFIL },
  };
}

/** Cinco días seguidos estudiando y hoy, a las 20:00, todavía nada. */
function expedienteRachaEnPeligro() {
  return {
    materias: [materia("m-civ", "Derecho Civil")],
    temas: [tema("t-civ", "m-civ", 7, "Las obligaciones")],
    progresos: mapa(progreso("t-civ", "estudiando", 5)),
    sesiones: [1, 2, 3, 4, 5].map((d) => sesion(d, 7200, "t-civ")),
    simulacros: [],
    perfil: { ...PERFIL },
  };
}

/** Va al día: nada oxidado, nada vencido, ha estudiado hoy. */
function expedienteAlDia() {
  return {
    materias: [materia("m-civ", "Derecho Civil")],
    temas: [
      tema("t1", "m-civ", 1, "Fuentes del derecho"),
      tema("t2", "m-civ", 2, "La norma jurídica"),
      tema("t3", "m-civ", 3, "La costumbre"),
    ],
    progresos: mapa(
      progreso("t1", "dominado", 0),
      progreso("t2", "dominado", 1),
      progreso("t3", "cantable", 0),
    ),
    sesiones: [sesion(0, 5 * 3600, "t1"), sesion(1, 4 * 3600, "t2")],
    simulacros: [],
    // Objetivo pequeño y ya cumplido: el aviso de ritmo no tiene nada que decir.
    perfil: { ...PERFIL, objetivoHorasSemana: 4 },
  };
}

const opts = (extra = {}) => ({ ahora: AHORA, hoy: claveDiaLocal(AHORA), ...extra });

/* ============================================================
   1. Avisa de lo que hay que avisar
   ============================================================ */

console.log("\nMotor de avisos");

prueba("tema oxidado: nombra el tema, el número y los días", () => {
  const aviso = decidirAviso(expedienteOxidado(), opts());
  assert.ok(aviso, "tendría que haber avisado");
  assert.equal(aviso.tipo, "oxido");
  assert.equal(aviso.clave, "oxido:tema:t-oxido");
  assert.match(aviso.titulo, /33/, "el título tiene que llevar el número de tema");
  assert.match(aviso.cuerpo, /60 días/);
  assert.match(aviso.cuerpo, /hipoteca de máximo/);
});

prueba("tema oxidado: el enlace lleva al tema, no a la portada", () => {
  const aviso = decidirAviso(expedienteOxidado(), opts());
  assert.equal(aviso.url, "/tema/t-oxido");
  assert.match(aviso.url, /^\/tema\/[^/]+$/);
});

prueba("materia abandonada: 11 días sin tocar Hipotecario, con tema por el que seguir", () => {
  const candidatos = candidatosDeAviso(expedienteMateriaAbandonada(), opts());
  const c = candidatos.find((x) => x.clave === "oxido:materia:m-hip");
  assert.ok(c, `no hay candidato de materia abandonada: ${candidatos.map((x) => x.clave)}`);
  assert.equal(c.titulo, "11 días sin tocar Hipotecario");
  assert.match(c.cuerpo, /tema 33/, "tiene que decir por dónde empezar");
  assert.match(c.url, /^\/tema\/t-hip/);
});

prueba("materia abandonada: no salta si es que ha parado del todo", () => {
  const e = expedienteMateriaAbandonada();
  // Nadie ha tocado nada en semanas: eso no es abandonar una materia, es parar.
  e.progresos["t-civ"].ultimoEstudio = haceDias(30);
  e.sesiones = [];
  const claves = candidatosDeAviso(e, opts()).map((c) => c.clave);
  assert.ok(!claves.includes("oxido:materia:m-hip"), `salió igualmente: ${claves}`);
});

prueba("racha en peligro: la nombra y propone un tema concreto", () => {
  const aviso = decidirAviso(expedienteRachaEnPeligro(), opts());
  assert.ok(aviso, "tendría que haber avisado");
  assert.equal(aviso.tipo, "racha");
  assert.equal(aviso.clave, "racha");
  assert.match(aviso.titulo, /Racha de 5 días/);
  assert.match(aviso.cuerpo, /tema 7/);
});

prueba("racha: no salta si hoy ya ha estudiado", () => {
  const e = expedienteRachaEnPeligro();
  e.sesiones = [sesion(0, 3600, "t-civ"), ...e.sesiones];
  const claves = candidatosDeAviso(e, opts()).map((c) => c.clave);
  assert.ok(!claves.includes("racha"), `salió igualmente: ${claves}`);
});

prueba("racha: no salta con un solo día, que no hay nada que perder", () => {
  const e = expedienteRachaEnPeligro();
  e.sesiones = [sesion(1, 7200, "t-civ")];
  const claves = candidatosDeAviso(e, opts()).map((c) => c.clave);
  assert.ok(!claves.includes("racha"), `salió igualmente: ${claves}`);
});

prueba("objetivo semanal: a mitad de semana y lejos, avisa con las horas", () => {
  // Miércoles a las 20:00 de una semana cualquiera, con dos horas hechas de 45.
  const miercoles = new Date();
  miercoles.setHours(20, 0, 0, 0);
  miercoles.setDate(miercoles.getDate() - ((miercoles.getDay() + 4) % 7)); // → miércoles
  const ahora = miercoles.getTime();
  const lunes = new Date(miercoles);
  lunes.setDate(lunes.getDate() - 2);
  lunes.setHours(10, 0, 0, 0);

  const e = {
    materias: [materia("m-civ", "Derecho Civil")],
    temas: [],
    progresos: {},
    sesiones: [{ id: "s", tipo: "estudio", inicio: lunes.getTime(), fin: lunes.getTime(), segundos: 7200 }],
    simulacros: [],
    perfil: { ...PERFIL },
  };

  const c = candidatosDeAviso(e, { ahora, hoy: claveDiaLocal(ahora) }).find((x) =>
    x.clave.startsWith("ritmo:"),
  );
  assert.ok(c, "tendría que haber candidato de ritmo");
  assert.equal(c.tipo, "racha");
  assert.match(c.titulo, /2 h de 45/);
  assert.match(c.cuerpo, /miércoles/);
});

prueba("objetivo semanal: el lunes no dice nada, que no hay nada que juzgar", () => {
  const lunes = new Date();
  lunes.setHours(20, 0, 0, 0);
  lunes.setDate(lunes.getDate() - ((lunes.getDay() + 6) % 7)); // → lunes
  const e = {
    materias: [],
    temas: [],
    progresos: {},
    sesiones: [],
    simulacros: [],
    perfil: { ...PERFIL },
  };
  const claves = candidatosDeAviso(e, {
    ahora: lunes.getTime(),
    hoy: claveDiaLocal(lunes.getTime()),
  }).map((c) => c.clave);
  assert.ok(!claves.some((k) => k.startsWith("ritmo:")), `salió igualmente: ${claves}`);
});

/* ============================================================
   2. Al que va al día NO se le molesta
   ============================================================ */

prueba("al día: ni un candidato", () => {
  const candidatos = candidatosDeAviso(expedienteAlDia(), opts());
  assert.deepEqual(
    candidatos.map((c) => c.clave),
    [],
    "no debería haber nada que decirle",
  );
});

prueba("al día: decidirAviso devuelve null", () => {
  assert.equal(decidirAviso(expedienteAlDia(), opts()), null);
});

prueba("expediente vacío: tampoco inventa nada", () => {
  const vacio = {
    materias: [],
    temas: [],
    progresos: {},
    sesiones: [],
    simulacros: [],
    perfil: { ...PERFIL },
  };
  assert.equal(decidirAviso(vacio, opts()), null);
});

/* ============================================================
   3. Ruido: uno al día y sin repetirse
   ============================================================ */

prueba("no repite: si ayer se avisó del tema 33, hoy toca otra cosa", () => {
  const ayer = claveDiaLocal(AHORA - DIA);
  const sinHistorial = decidirAviso(expedienteOxidado(), opts());
  assert.equal(sinHistorial.clave, "oxido:tema:t-oxido");

  const conHistorial = decidirAviso(
    expedienteOxidado(),
    opts({ historial: [{ clave: "oxido:tema:t-oxido", dia: ayer }] }),
  );
  assert.ok(conHistorial, "hay más cosas que decir, no debería callarse");
  assert.notEqual(conHistorial.clave, "oxido:tema:t-oxido");
  assert.equal(conHistorial.clave, "repaso:t-viejo");
});

prueba("no repite: tampoco por la puerta de atrás, con otra familia sobre el mismo tema", () => {
  const ayer = claveDiaLocal(AHORA - DIA);
  const aviso = decidirAviso(
    expedienteOxidado(),
    opts({ historial: [{ clave: "oxido:tema:t-oxido", dia: ayer }] }),
  );
  assert.ok(!aviso.url.includes("t-oxido"), `volvió al mismo tema: ${aviso.url}`);
});

prueba("no repite: pasada la ventana, el aviso vuelve a estar disponible", () => {
  const anteayer = claveDiaLocal(AHORA - 2 * DIA);
  const aviso = decidirAviso(
    expedienteOxidado(),
    opts({ historial: [{ clave: "oxido:tema:t-oxido", dia: anteayer }] }),
  );
  assert.equal(aviso.clave, "oxido:tema:t-oxido");
});

prueba("uno al día: con algo ya enviado hoy, no sale nada más", () => {
  const aviso = decidirAviso(
    expedienteOxidado(),
    opts({ historial: [{ clave: "racha", dia: claveDiaLocal(AHORA) }] }),
  );
  assert.equal(aviso, null);
});

prueba("respeta lo que el opositor ha apagado", () => {
  const e = expedienteOxidado();
  e.perfil.tipos = ["repaso"];
  const aviso = decidirAviso(e, opts());
  assert.ok(aviso);
  assert.equal(aviso.tipo, "repaso");

  e.perfil.tipos = [];
  assert.equal(decidirAviso(e, opts()), null, "sin tipos no debe salir nada");
});

/* ============================================================
   4. Zonas horarias
   ============================================================ */

console.log("\nZonas horarias");

prueba("horaLocal: el mismo instante es otro día según dónde estés", () => {
  const t = Date.parse("2026-09-06T22:30:00Z");
  const madrid = horaLocal(t, "Europe/Madrid");
  const utc = horaLocal(t, "UTC");
  assert.equal(madrid.dia, "2026-09-07");
  assert.equal(madrid.diaSemana, 1, "en Madrid ya es lunes");
  assert.equal(madrid.minutosDelDia, 30);
  assert.equal(utc.dia, "2026-09-06");
  assert.equal(utc.diaSemana, 7, "en UTC todavía es domingo");
  assert.equal(utc.minutosDelDia, 22 * 60 + 30);
});

prueba("horaLocal: una zona inventada cae a UTC en vez de reventar", () => {
  const t = Date.parse("2026-09-06T22:30:00Z");
  assert.deepEqual(horaLocal(t, "Marte/Olympus"), horaLocal(t, "UTC"));
});

prueba("minutosDeHora entiende lo que devuelve Postgres", () => {
  assert.equal(minutosDeHora("20:00"), 1200);
  assert.equal(minutosDeHora("20:00:00"), 1200);
  assert.equal(minutosDeHora("07:45"), 465);
});

prueba("tocaAhora: dentro de la ventana sí, fuera no", () => {
  const local = horaLocal(Date.parse("2026-09-09T18:07:00Z"), "Europe/Madrid"); // miércoles 20:07
  assert.equal(local.diaSemana, 3);
  assert.equal(tocaAhora(local, "20:00", [1, 2, 3, 4, 5, 6, 7], 15), true);
  assert.equal(tocaAhora(local, "20:00", [1, 2, 4, 5, 6, 7], 15), false, "miércoles apagado");
  assert.equal(tocaAhora(local, "20:00", [3], 5), false, "ventana de 5 minutos ya pasada");
  assert.equal(tocaAhora(local, "21:00", [3], 15), false, "todavía no");
});

prueba("conZona mueve el día local y lo devuelve donde estaba", () => {
  const antes = process.env.TZ;
  const t = Date.parse("2026-09-06T22:30:00Z");
  const enMadrid = conZona("Europe/Madrid", () => new Date(t).getDate());
  const enAuckland = conZona("Pacific/Auckland", () => new Date(t).getDate());
  assert.equal(enMadrid, 7);
  assert.equal(enAuckland, 7, "en Auckland ya es el 7 por la mañana");
  assert.notEqual(
    conZona("UTC", () => new Date(t).getDate()),
    enMadrid,
    "en UTC todavía es el 6",
  );
  assert.equal(process.env.TZ, antes, "tiene que dejar la zona como estaba");
});

prueba("conZona restaura la zona aunque la función reviente", () => {
  const antes = process.env.TZ;
  assert.throws(() =>
    conZona("Pacific/Auckland", () => {
      throw new Error("bum");
    }),
  );
  assert.equal(process.env.TZ, antes);
});

console.log(
  `\n${hechas - fallos}/${hechas} pruebas en verde` +
    (fallos ? `  ·  ${fallos} FALLIDAS` : ""),
);
process.exit(fallos ? 1 : 0);
