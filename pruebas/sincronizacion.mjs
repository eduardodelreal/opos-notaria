/**
 * Prueba de integración del motor de sincronización contra un PostgreSQL de
 * verdad, con el esquema real de db/migrations/ y la RLS puesta.
 *
 * Qué se ejercita y por qué contra la base y no contra un doble:
 *
 *   · el arbitraje last-write-wins lo hace el TRIGGER (`tocar_updated_at`),
 *     no el cliente. Un doble que "devuelve lo que le mandas" daría todas
 *     las pruebas por buenas mientras en producción se pierden escrituras.
 *   · la cascada de borrado también es del servidor, y es lo que decide si
 *     un tema borrado en el móvil resucita en el portátil.
 *   · el mapeo camelCase → snake_case solo falla de verdad contra columnas
 *     de verdad: una columna que no existe aquí es un error; en un doble,
 *     un `undefined` que nadie mira.
 *
 * Monta dos "dispositivos" del MISMO opositor sobre el store real (el mismo
 * que corre en la app; ver pruebas/cargador.mjs), les hace trabajar sin
 * sincronizar entre medias y comprueba que convergen.
 *
 * Uso:
 *   node --experimental-strip-types --import ./pruebas/cargador.mjs pruebas/sincronizacion.mjs
 *
 * Necesita un PostgreSQL local y un psql que pueda crear bases de datos.
 * Crea y DESTRUYE la base `opos_sync_test` (variable PGDATABASE_TEST).
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Se ponen ANTES de importar nada del proyecto: `lib/supabase/config.ts` las
// lee al cargarse, y sin ellas el store no encolaría (la app sin Supabase
// configurado no sincroniza, que es justo lo que se prueba en otro sitio).
process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://localhost:54321";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "clave-de-pruebas";

// Las migraciones son idempotentes y sueltan NOTICEs a puñados; aquí solo
// interesan los errores.
process.env.PGOPTIONS = "-c client_min_messages=warning";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DB = process.env.PGDATABASE_TEST ?? "opos_sync_test";
const USUARIO = "11111111-1111-4111-8111-111111111111";

/* ============================================================
   psql
   ============================================================ */

function psql(args, base = DB) {
  return execFileSync("psql", ["-X", "-q", "-v", "ON_ERROR_STOP=1", "-d", base, ...args], {
    encoding: "utf8",
  });
}

function json(sql, base = DB) {
  const salida = psql(["-tA", "-c", sql], base);
  return salida
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

/** Consulta como servidor (se salta la RLS): para comprobar, no para operar. */
function enLaNube(sql) {
  return json(sql);
}

function prepararBase() {
  psql(["-c", `drop database if exists ${DB}`], "postgres");
  psql(["-c", `create database ${DB}`], "postgres");
  psql(["-f", path.join(RAIZ, "db/pruebas/andamiaje.sql")]);
  const dir = path.join(RAIZ, "db/migrations");
  for (const f of readdirSync(dir).sort()) {
    if (f.endsWith(".sql")) psql(["-f", path.join(dir, f)]);
  }
  // El alta dispara `crear_perfil()`, igual que en Supabase: cuando el
  // opositor crea la cuenta ya hay un perfil de fábrica esperándole, y esa
  // fila es la que la primera sincronización tiene que saber no pisar.
  psql([
    "-c",
    `insert into auth.users (id, email, raw_user_meta_data)
     values ('${USUARIO}', 'opositor@ejemplo.es', '{}'::jsonb)`,
  ]);
}

/* ============================================================
   Transporte contra psql

   Reproduce lo que hace PostgREST con `upsert(...).select()`: inserta solo
   las columnas del payload (las demás se quedan con su DEFAULT), resuelve
   el conflicto por la PK y devuelve la fila resultante, que es la GANADORA
   del arbitraje y no necesariamente la que se mandó.

   Y corre como `authenticated` con el JWT del opositor, así que la RLS está
   activa: si una política estuviera mal, estas pruebas se caen.
   ============================================================ */

function transportePsql(usuarioId, control = {}) {
  const sesion = `set local role authenticated;
     set local request.jwt.claims = '{"sub":"${usuarioId}"}';`;

  return {
    usuarioId,

    async subir(tabla, filas) {
      if (control.fallar) throw new Error("red caída (simulado)");
      if (!filas.length) return [];
      control.subidas = (control.subidas ?? 0) + filas.length;

      const columnas = Object.keys(filas[0]);
      const conflicto = CONFLICTO[tabla];
      const asigna = columnas
        .filter((c) => c !== conflicto)
        .map((c) => `${c} = excluded.${c}`)
        .join(", ");
      const lista = columnas.join(", ");

      return json(`begin;
        ${sesion}
        insert into public.${tabla} (${lista})
        select ${lista}
        from jsonb_populate_recordset(null::public.${tabla}, $sync$${JSON.stringify(filas)}$sync$::jsonb)
        on conflict (${conflicto}) do update set ${asigna}
        returning to_jsonb(${tabla}.*);
        commit;`);
    },

    async bajar(tabla, desde, limite) {
      if (control.fallar) throw new Error("red caída (simulado)");
      const columnaUsuario = tabla === "perfiles" ? "id" : "usuario_id";
      return json(`begin;
        ${sesion}
        select to_jsonb(t.*) from public.${tabla} t
        where t.${columnaUsuario} = '${usuarioId}'
          and t.updated_at > '${new Date(desde).toISOString()}'
        order by t.updated_at
        limit ${limite};
        commit;`);
    },
  };
}

/* ============================================================
   Dispositivos

   El store es un singleton (uno por pestaña, como en la app), así que dos
   dispositivos son dos instantáneas que se turnan. Lo que corre en cada
   turno es el store real y el motor real: las acciones sellan y encolan
   como en producción.
   ============================================================ */

const CLAVES = [
  "perfil", "materias", "temas", "progresos", "sesiones", "cantes",
  "keypoints", "notas", "simulacros", "vueltas", "chat", "crono",
  "cola", "sincro",
];

const aparatos = new Map();

function instantanea() {
  const s = useStore.getState();
  const o = {};
  for (const k of CLAVES) o[k] = structuredClone(s[k]);
  return o;
}

function instalar(nombre) {
  useStore.getState().borrarTodo();
  aparatos.set(nombre, instantanea());
}

async function en(nombre, fn) {
  useStore.setState(structuredClone(aparatos.get(nombre)));
  try {
    return await fn(useStore.getState());
  } finally {
    // También si la acción ha fallado: un ciclo de sincronización que se
    // corta a la mitad deja el aparato como esté, y eso es justo lo que
    // hay que poder comprobar.
    aparatos.set(nombre, instantanea());
  }
}

/** Lo que el dispositivo tiene ahora mismo, sin cargarlo. */
function estadoDe(nombre) {
  return aparatos.get(nombre);
}

async function sincroniza(nombre, transporte) {
  return en(nombre, () => sincronizar(almacenSync(), transporte));
}

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

/* ============================================================
   Andamiaje de aserciones
   ============================================================ */

let fallos = 0;
let hechas = 0;

function prueba(nombre, fn) {
  hechas += 1;
  try {
    fn();
    console.log(`  ok   ${nombre}`);
  } catch (e) {
    fallos += 1;
    console.log(`  FAIL ${nombre}\n       ${String(e.message).split("\n")[0]}`);
  }
}

/* ============================================================
   Arranque
   ============================================================ */

console.log("\n== preparando la base ==");
prepararBase();

const { useStore, almacenSync } = await import("../lib/store/store.ts");
const { sincronizar } = await import("../lib/sync/motor.ts");
const { CONFLICTO } = await import("../lib/sync/tablas.ts");
const { temasVivos, vivos, vivosMapa } = await import("../lib/data/vivos.ts");
const { derivarProgresos } = await import("../lib/data/derivados.ts");

const control = {};
const nube = transportePsql(USUARIO, control);

/* ------------------------------------------------------------------
   1 · Primera sincronización: meses de trabajo en local y ahora cuenta
   ------------------------------------------------------------------ */

console.log("\n== primera sincronización ==");

instalar("portatil");

const datos = await en("portatil", (st) => {
  st.setPerfil({ nombre: "Marta", objetivoHorasSemana: 52 });
  const materia = useStore.getState().materias[2]; // Hipotecario, de la siembra
  const tema = st.addTema(materia.id, 47, "La hipoteca. Concepto y caracteres");
  st.addEpigrafe(tema.id, "Concepto");
  st.addEpigrafe(tema.id, "Caracteres");
  st.addNota(tema.id, "Repasar el 1857 CC");
  return { materiaId: materia.id, temaId: tema.id };
});

await sincroniza("portatil", nube);

prueba("la primera sincronización sube el expediente entero", () => {
  const [{ n: materias }] = enLaNube(
    `select jsonb_build_object('n', count(*)) from public.materias where usuario_id = '${USUARIO}'`,
  );
  const [{ n: temas }] = enLaNube(
    `select jsonb_build_object('n', count(*)) from public.temas where deleted_at is null`,
  );
  const [{ n: epigrafes }] = enLaNube(
    `select jsonb_build_object('n', count(*)) from public.epigrafes where deleted_at is null`,
  );
  const [{ n: notas }] = enLaNube(
    `select jsonb_build_object('n', count(*)) from public.notas where deleted_at is null`,
  );
  assert.equal(materias, 5, "las cinco materias sembradas");
  assert.equal(temas, 1);
  assert.equal(epigrafes, 2);
  assert.equal(notas, 1);
});

prueba("el perfil local gana al perfil de fábrica que creó el alta", () => {
  const [p] = enLaNube(`select to_jsonb(t.*) from public.perfiles t`);
  assert.equal(p.nombre, "Marta");
  assert.equal(p.objetivo_horas_semana, 52);
});

prueba("la cola queda vacía tras subir", () => {
  assert.deepEqual(Object.keys(estadoDe("portatil").cola), []);
});

/* ------------------------------------------------------------------
   2 · Segundo dispositivo: instalación nueva sobre una cuenta con datos
   ------------------------------------------------------------------ */

console.log("\n== segundo dispositivo ==");

instalar("movil");
await sincroniza("movil", nube);

prueba("las materias sembradas sin usar no se duplican en el móvil", () => {
  const m = vivos(estadoDe("movil").materias);
  assert.equal(m.length, 5, `el móvil tiene ${m.length} materias, no 5`);
  const idsPortatil = new Set(vivos(estadoDe("portatil").materias).map((x) => x.id));
  assert.ok(
    m.every((x) => idsPortatil.has(x.id)),
    "las materias que quedan son las de la cuenta, no las sembradas aquí",
  );
});

prueba("el móvil recibe el tema, sus epígrafes y su nota", () => {
  const s = estadoDe("movil");
  const tema = temasVivos(s.temas).find((t) => t.id === datos.temaId);
  assert.ok(tema, "el tema no ha bajado");
  assert.equal(tema.titulo, "La hipoteca. Concepto y caracteres");
  assert.equal(tema.epigrafes.length, 2);
  assert.equal(vivos(s.notas).length, 1);
  assert.equal(vivos(s.notas)[0].texto, "Repasar el 1857 CC");
});

prueba("el perfil del portátil llega al móvil", () => {
  assert.equal(estadoDe("movil").perfil.nombre, "Marta");
  assert.equal(estadoDe("movil").perfil.objetivoHorasSemana, 52);
});

/* ------------------------------------------------------------------
   3 · Las horas de dos dispositivos que estudian sin sincronizar
       (docs/sincronizacion.md §6: el caso que motivó los derivados)
   ------------------------------------------------------------------ */

console.log("\n== horas y notas desde dos dispositivos ==");

await en("portatil", (st) => {
  st.guardarCante({
    temaId: datos.temaId,
    segundos: 2400, // 40 minutos
    epigrafes: [],
    conPreparador: false,
    nota: 7,
  });
});

await espera(3);

await en("movil", (st) => {
  st.guardarCante({
    temaId: datos.temaId,
    segundos: 1800, // 30 minutos
    epigrafes: [],
    conPreparador: false,
    nota: 9,
  });
});

// Ninguno de los dos ha sincronizado entre medias: es exactamente el
// escenario en el que el last-write-wins deja 40 minutos o 30, nunca 70.
await sincroniza("portatil", nube);
await sincroniza("movil", nube);
await sincroniza("portatil", nube);

prueba("las horas de los dos dispositivos se suman, no se truncan", () => {
  for (const nombre of ["portatil", "movil"]) {
    const s = estadoDe(nombre);
    const derivados = derivarProgresos(s.progresos, s.sesiones, s.cantes, s.vueltas);
    assert.equal(
      derivados[datos.temaId].segundos,
      4200,
      `${nombre}: ${derivados[datos.temaId].segundos}s en vez de 4200`,
    );
    assert.equal(
      s.progresos[datos.temaId].segundos,
      4200,
      `${nombre}: la caché del progreso no se ha rehecho tras el pull`,
    );
  }
});

prueba("la nota media sale de los dos cantes", () => {
  for (const nombre of ["portatil", "movil"]) {
    const s = estadoDe(nombre);
    assert.equal(vivos(s.cantes).length, 2, `${nombre}: faltan cantes`);
    const derivados = derivarProgresos(s.progresos, s.sesiones, s.cantes, s.vueltas);
    assert.equal(derivados[datos.temaId].notaMedia, 8, `${nombre}: nota media mal`);
    assert.equal(
      s.progresos[datos.temaId].notaMedia,
      8,
      `${nombre}: la caché de la nota media no se ha rehecho tras el pull`,
    );
  }
});

prueba("las dos sesiones han viajado", () => {
  const [{ n }] = enLaNube(
    `select jsonb_build_object('n', count(*)) from public.sesiones where tema_id = '${datos.temaId}'`,
  );
  assert.equal(n, 2);
  assert.equal(estadoDe("movil").sesiones.length, 2);
});

/* ------------------------------------------------------------------
   4 · Conflicto en una entidad mutable: gana el más reciente
   ------------------------------------------------------------------ */

console.log("\n== conflicto en una nota ==");

const notaId = vivos(estadoDe("portatil").notas)[0].id;

await en("movil", (st) => st.updateNota(notaId, "versión del móvil"));
await espera(5);
await en("portatil", (st) => st.updateNota(notaId, "versión del portátil"));

// El móvil sube primero; el portátil, que escribió después, gana.
await sincroniza("movil", nube);
await sincroniza("portatil", nube);
await sincroniza("movil", nube);

prueba("gana la edición más reciente en los dos dispositivos y en la nube", () => {
  for (const nombre of ["portatil", "movil"]) {
    const nota = vivos(estadoDe(nombre).notas).find((n) => n.id === notaId);
    assert.equal(nota.texto, "versión del portátil", `${nombre}`);
  }
  const [fila] = enLaNube(`select to_jsonb(t.*) from public.notas t where t.id = '${notaId}'`);
  assert.equal(fila.texto, "versión del portátil");
});

/* ------------------------------------------------------------------
   5 · La escritura que pierde adopta la fila ganadora del RETURNING,
       sin esperar al siguiente pull (§4)
   ------------------------------------------------------------------ */

console.log("\n== adopción de la fila ganadora del upsert ==");

await en("movil", () => {
  const s = useStore.getState();
  // Una edición hecha ANTES de la del portátil y que sube después: es lo
  // que pasa cuando el móvil estuvo días sin cobertura.
  const notas = s.notas.map((n) =>
    n.id === notaId ? { ...n, texto: "edición vieja del móvil", actualizado: 1_000 } : n,
  );
  useStore.setState({
    notas,
    cola: { ...s.cola, [`notas:${notaId}`]: Date.now() },
    // Cursor en el futuro: el pull no puede traer nada, así que lo único
    // que puede corregir la nota es el RETURNING del propio push.
    sincro: { ...s.sincro, ultimoPull: Date.now() + 3_600_000 },
  });
});

await sincroniza("movil", nube);

prueba("el perdedor adopta la fila del servidor en el mismo ciclo", () => {
  const nota = vivos(estadoDe("movil").notas).find((n) => n.id === notaId);
  assert.equal(nota.texto, "versión del portátil");
});

prueba("la nube no se ha llevado la edición perdedora", () => {
  const [fila] = enLaNube(`select to_jsonb(t.*) from public.notas t where t.id = '${notaId}'`);
  assert.equal(fila.texto, "versión del portátil");
});

// Se devuelve el cursor a su sitio para el resto de la prueba.
await en("movil", () => {
  const s = useStore.getState();
  useStore.setState({ sincro: { ...s.sincro, ultimoPull: 0 } });
});

/* ------------------------------------------------------------------
   5 bis · Una primera sincronización no se traga lo local más nuevo
   ------------------------------------------------------------------ */

console.log("\n== primera sincronización con edición local más nueva ==");

await en("movil", (st) => st.updateNota(notaId, "corrección del móvil"));
await en("movil", () => {
  const s = useStore.getState();
  // Lo peor que puede pasarle a un aparato: la cola se ha perdido (una
  // escritura de IndexedDB a medias) y vuelve a creerse recién estrenado,
  // pero su copia de la nota es más nueva que la de la nube.
  useStore.setState({
    cola: {},
    sincro: { ...s.sincro, primeraHecha: false, ultimoPull: 0 },
  });
});

await sincroniza("movil", nube);
await sincroniza("portatil", nube);

prueba("la edición local más nueva sube aunque la fila ya estuviera arriba", () => {
  const [fila] = enLaNube(`select to_jsonb(t.*) from public.notas t where t.id = '${notaId}'`);
  assert.equal(fila.texto, "corrección del móvil");
  const enPortatil = vivos(estadoDe("portatil").notas).find((n) => n.id === notaId);
  assert.equal(enPortatil.texto, "corrección del móvil");
});

/* ------------------------------------------------------------------
   6 · Un push que falla no pierde la cola
   ------------------------------------------------------------------ */

console.log("\n== reintento tras un fallo de red ==");

await en("portatil", (st) => st.addNota(datos.temaId, "escrita sin cobertura"));

control.fallar = true;
let hubo = null;
try {
  await sincroniza("portatil", nube);
} catch (e) {
  hubo = e;
}
control.fallar = false;

prueba("un fallo de red no vacía la cola", () => {
  assert.ok(hubo, "el ciclo tenía que fallar");
  const cola = Object.keys(estadoDe("portatil").cola);
  assert.ok(cola.some((k) => k.startsWith("notas:")), "la nota pendiente se ha perdido");
});

await sincroniza("portatil", nube);
await sincroniza("movil", nube);

prueba("al volver la red se sube lo pendiente", () => {
  assert.deepEqual(Object.keys(estadoDe("portatil").cola), []);
  const textos = vivos(estadoDe("movil").notas).map((n) => n.texto);
  assert.ok(textos.includes("escrita sin cobertura"), textos.join(" | "));
});

/* ------------------------------------------------------------------
   7 · Borrado: se propaga, cascadea y no resucita
   ------------------------------------------------------------------ */

console.log("\n== borrado ==");

await en("portatil", (st) => st.removeTema(datos.temaId));
await sincroniza("portatil", nube);
await sincroniza("movil", nube);

prueba("el borrado llega al otro dispositivo", () => {
  const s = estadoDe("movil");
  assert.equal(
    temasVivos(s.temas).find((t) => t.id === datos.temaId),
    undefined,
    "el tema sigue vivo en el móvil",
  );
});

prueba("la cascada entierra epígrafes, notas, cantes y progreso", () => {
  const s = estadoDe("movil");
  assert.equal(vivos(s.notas).length, 0, "quedan notas vivas de un tema borrado");
  assert.equal(vivos(s.cantes).length, 0, "quedan cantes vivos de un tema borrado");
  assert.equal(vivosMapa(s.progresos)[datos.temaId], undefined, "el progreso sigue vivo");
  const tema = s.temas.find((t) => t.id === datos.temaId);
  assert.ok(tema.borrado, "el tema no tiene tumba");
  assert.equal(vivos(tema.epigrafes).length, 0, "quedan epígrafes vivos");
});

prueba("las sesiones sobreviven al borrado del tema", () => {
  assert.equal(estadoDe("movil").sesiones.length, 2, "las horas del opositor son suyas");
  const [{ n }] = enLaNube(
    `select jsonb_build_object('n', count(*)) from public.sesiones
     where tema_id = '${datos.temaId}' and deleted_at is null`,
  );
  assert.equal(n, 2, "el servidor ha cascadeado las sesiones y no debe");
});

// Varias vueltas más: si algo resucitara, sería aquí.
await sincroniza("movil", nube);
await sincroniza("portatil", nube);
await sincroniza("movil", nube);

prueba("el tema borrado no resucita al seguir sincronizando", () => {
  for (const nombre of ["portatil", "movil"]) {
    const s = estadoDe(nombre);
    assert.equal(
      temasVivos(s.temas).find((t) => t.id === datos.temaId),
      undefined,
      `${nombre}: el tema ha vuelto`,
    );
    assert.equal(vivos(s.notas).length, 0, `${nombre}: han vuelto las notas`);
  }
  const [{ n }] = enLaNube(
    `select jsonb_build_object('n', count(*)) from public.temas where deleted_at is null`,
  );
  assert.equal(n, 0, "el tema ha vuelto a la vida en el servidor");
});

/* ------------------------------------------------------------------
   8 · Convergencia final
   ------------------------------------------------------------------ */

console.log("\n== convergencia ==");

await sincroniza("portatil", nube);
await sincroniza("movil", nube);
await sincroniza("portatil", nube);

prueba("los dos dispositivos acaban con el mismo expediente", () => {
  const a = estadoDe("portatil");
  const b = estadoDe("movil");
  const comparable = (s) => ({
    materias: vivos(s.materias)
      .map((m) => m.id)
      .sort(),
    temas: temasVivos(s.temas)
      .map((t) => t.id)
      .sort(),
    notas: vivos(s.notas)
      .map((n) => `${n.id}:${n.texto}`)
      .sort(),
    cantes: vivos(s.cantes)
      .map((c) => c.id)
      .sort(),
    sesiones: s.sesiones.map((x) => `${x.id}:${x.segundos}`).sort(),
    perfil: s.perfil.nombre,
  });
  assert.deepEqual(comparable(a), comparable(b));
});

prueba("nadie queda con cola pendiente", () => {
  assert.deepEqual(Object.keys(estadoDe("portatil").cola), []);
  assert.deepEqual(Object.keys(estadoDe("movil").cola), []);
});

/* ------------------------------------------------------------------
   9 · Un tercer aparato que TAMBIÉN traía trabajo propio

   Es el caso feo de la primera sincronización: no una instalación en
   blanco, sino un opositor que llevaba meses en la tableta y ahora entra
   en una cuenta que ya tiene expediente. No se puede duplicar lo sembrado
   ni pisar lo que hay arriba, y su trabajo tiene que subir entero.
   ------------------------------------------------------------------ */

console.log("\n== tercer aparato con trabajo propio ==");

instalar("tableta");

const propio = await en("tableta", (st) => {
  const materia = useStore.getState().materias[0]; // su Civil, con otro id
  const tema = st.addTema(materia.id, 12, "La compraventa");
  st.addNota(tema.id, "Apuntes de la tableta");
  return { materiaId: materia.id, temaId: tema.id };
});

await sincroniza("tableta", nube);

prueba("el trabajo del tercer aparato sube entero", () => {
  const [fila] = enLaNube(
    `select to_jsonb(t.*) from public.temas t where t.id = '${propio.temaId}'`,
  );
  assert.ok(fila, "el tema de la tableta no ha subido");
  assert.equal(fila.titulo, "La compraventa");
  const [{ n }] = enLaNube(
    `select jsonb_build_object('n', count(*)) from public.notas
     where tema_id = '${propio.temaId}' and deleted_at is null`,
  );
  assert.equal(n, 1);
});

prueba("solo sobrevive la materia sembrada que estaba en uso", () => {
  const m = vivos(estadoDe("tableta").materias);
  // Las cinco de la cuenta más la suya, que tiene un tema colgando y por
  // eso no se descarta. Es la unión: nadie ha pedido borrar nada.
  assert.equal(m.length, 6, `la tableta tiene ${m.length} materias, no 6`);
  assert.ok(
    m.some((x) => x.id === propio.materiaId),
    "se ha descartado una materia que estaba en uso",
  );
});

prueba("lo que ya había en la nube sigue intacto", () => {
  const [{ n }] = enLaNube(
    `select jsonb_build_object('n', count(*)) from public.materias where deleted_at is null`,
  );
  assert.equal(n, 6, "las materias de la cuenta se han duplicado o borrado");
});

/* ------------------------------------------------------------------
   10 · Otra cuenta en el mismo navegador
   ------------------------------------------------------------------ */

console.log("\n== cambio de cuenta ==");

const OTRO = "22222222-2222-4222-8222-222222222222";
psql([
  "-c",
  `insert into auth.users (id, email) values ('${OTRO}', 'otro@ejemplo.es')`,
]);

const antesDelCambio = structuredClone(estadoDe("tableta"));
let corte = null;
try {
  await sincroniza("tableta", transportePsql(OTRO));
} catch (e) {
  corte = e;
}

prueba("entrar con otra cuenta corta la sincronización en vez de mezclar", () => {
  assert.ok(corte, "la sincronización tenía que pararse");
  assert.equal(corte.name, "ErrorCuentaDistinta", corte.message);
  const [{ n }] = enLaNube(
    `select jsonb_build_object('n', count(*)) from public.temas where usuario_id = '${OTRO}'`,
  );
  assert.equal(n, 0, "se le han subido a la cuenta nueva los temas de la otra");
});

prueba("y no toca el expediente que ya estaba en el navegador", () => {
  const ahora = estadoDe("tableta");
  assert.deepEqual(
    temasVivos(ahora.temas).map((t) => t.id).sort(),
    temasVivos(antesDelCambio.temas).map((t) => t.id).sort(),
  );
  assert.equal(ahora.sincro.usuarioId, USUARIO, "las marcas siguen siendo las de la cuenta buena");
});

prueba("«Borrar todo» deja el navegador listo para la cuenta nueva", () => {
  useStore.setState(structuredClone(estadoDe("tableta")));
  useStore.getState().borrarTodo();
  aparatos.set("tableta", instantanea());
  assert.equal(estadoDe("tableta").sincro.usuarioId, null);
  assert.deepEqual(Object.keys(estadoDe("tableta").cola), []);
});

await sincroniza("tableta", transportePsql(OTRO));

prueba("tras borrar, la cuenta nueva sincroniza sin arrastrar nada", () => {
  const s = estadoDe("tableta");
  assert.equal(s.sincro.usuarioId, OTRO);
  assert.equal(temasVivos(s.temas).length, 0, "han vuelto los temas de la otra cuenta");
  const [{ n }] = enLaNube(
    `select jsonb_build_object('n', count(*)) from public.temas where usuario_id = '${OTRO}'`,
  );
  assert.equal(n, 0);
});

/* ============================================================ */

console.log(
  `\n${hechas - fallos}/${hechas} comprobaciones ok${fallos ? `, ${fallos} FALLIDAS` : ""}\n`,
);
process.exit(fallos ? 1 : 0);
