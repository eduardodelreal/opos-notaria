/**
 * El disparador de los avisos. Corre en Railway como cron job.
 *
 * Lo que hace en cada pasada:
 *
 *   1. Lee todos los perfiles con `avisos_activos`.
 *   2. Para cada uno, mira sus dispositivos suscritos y resuelve la hora
 *      preferida contra la ZONA DE CADA APARATO. A quien no le toca todavía,
 *      se le deja en paz.
 *   3. Comprueba que hoy no se le haya mandado ya nada (uno al día, y ni uno
 *      más).
 *   4. Le pide al motor (lib/avisos/motor.ts) qué merece un aviso hoy. Si
 *      dice `null` —el caso normal, el del que va al día— no pasa nada más.
 *   5. Manda el push a todos sus aparatos vivos, marca los que ya no existen
 *      y anota lo enviado.
 *
 * ============================================================================
 * LA `service_role` SOLO PUEDE VIVIR AQUÍ
 * ============================================================================
 * Este proceso necesita leer los datos de TODOS los usuarios, así que usa la
 * `service_role` de Supabase, que se salta la RLS entera. Esa clave:
 *
 *   · va en el entorno del CRON de Railway y en ningún otro sitio;
 *   · NUNCA en una variable `NEXT_PUBLIC_*` — esas Next las incrusta en el
 *     JavaScript que descarga cualquiera que abra la web;
 *   · NUNCA en el entorno del servicio web (ni Netlify ni el Railway que
 *     sirve la app): ninguna ruta de `app/` la lee, y si estuviera declarada
 *     ahí, el primer `process.env` mal puesto la filtraría;
 *   · NUNCA en el repositorio.
 *
 * Quien tenga esa clave puede leer y escribir el expediente de todos los
 * opositores sin iniciar sesión. Se trata como lo que es.
 * ============================================================================
 *
 * Se ejecuta con el mismo cargador que las pruebas, porque los módulos del
 * proyecto son TypeScript con imports sin extensión:
 *
 *   node --experimental-strip-types --import ./pruebas/cargador.mjs \
 *        scripts/enviar-avisos.ts
 *
 * Banderas:
 *   --seco             decide e informa, pero no manda ningún push
 *   --forzar           ignora la hora, los días y el tope diario (para probar)
 *   --usuario <uuid>   solo ese opositor
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cargarExpediente } from "../lib/avisos/expediente";
import { configurarVapid, enviarPush } from "../lib/avisos/envio";
import { decidirAviso } from "../lib/avisos/motor";
import type { Aviso, AvisoEnviado, SuscripcionAviso, TipoAviso } from "../lib/avisos/tipos";
import { conZona, horaLocal, tocaAhora } from "../lib/avisos/zonas";

/* ============================================================
   Entorno
   ============================================================ */

const TIPOS_VALIDOS: TipoAviso[] = ["oxido", "repaso", "racha", "simulacro"];

function requerido(nombre: string, alternativa?: string): string {
  const v = (process.env[nombre] ?? (alternativa ? process.env[alternativa] : "") ?? "").trim();
  if (!v) {
    console.error(
      `[avisos] Falta la variable de entorno ${nombre}. ` +
        `Sin ella el cron no puede funcionar; mira docs/avisos.md.`,
    );
    process.exit(1);
  }
  return v;
}

const SUPABASE_URL = requerido("SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL");
const SERVICE_ROLE = requerido("SUPABASE_SERVICE_ROLE_KEY");
const VAPID_PUBLICA = requerido("VAPID_PUBLIC_KEY", "NEXT_PUBLIC_VAPID_PUBLIC_KEY");
const VAPID_PRIVADA = requerido("VAPID_PRIVATE_KEY");
const VAPID_SUBJECT = (process.env.VAPID_SUBJECT ?? "").trim();

if (!VAPID_SUBJECT.startsWith("mailto:") && !VAPID_SUBJECT.startsWith("https://")) {
  console.error(
    "[avisos] VAPID_SUBJECT tiene que ser un mailto: o una https://. " +
      "Es el contacto al que el servicio push avisa si nuestros envíos dan " +
      "problemas, y algunos servicios rechazan la petición sin él.",
  );
  process.exit(1);
}

/**
 * Ancho de la ventana de disparo, en minutos. TIENE QUE COINCIDIR con cada
 * cuánto corre el cron: si el cron va cada 15 minutos y la ventana fuera de 5,
 * los avisos de los 10 minutos restantes no se mandarían jamás; al revés, se
 * mandarían dos veces (aunque el tope diario lo taparía).
 */
const VENTANA_MIN = Number(process.env.AVISOS_VENTANA_MIN ?? 15) || 15;

const args = process.argv.slice(2);
const SECO = args.includes("--seco");
const FORZAR = args.includes("--forzar");
const SOLO_USUARIO = (() => {
  const i = args.indexOf("--usuario");
  return i >= 0 ? (args[i + 1] ?? null) : null;
})();

const AHORA = Date.now();

/* ============================================================
   Cliente con service_role
   ============================================================ */

const supabase: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: {
    // Un proceso por lotes no tiene sesión que refrescar ni que guardar. Sin
    // esto, el cliente intenta escribir en un almacenamiento que no existe.
    persistSession: false,
    autoRefreshToken: false,
  },
});

configurarVapid(VAPID_SUBJECT, VAPID_PUBLICA, VAPID_PRIVADA);

/* ============================================================
   Historial: memoria contra la repetición

   `db/migrations/0003` NO trae tabla para esto (ver docs/avisos.md §Pendiente).
   El cron funciona sin ella: el tope de uno al día sale de
   `suscripciones_aviso.ultimo_envio`. Lo que se pierde sin la tabla es el "no
   repetir el mismo aviso dos días seguidos", porque no hay dónde recordar cuál
   fue. Se detecta al arrancar y se avisa una sola vez, en vez de reventar.
   ============================================================ */

let hayHistorial = true;

async function comprobarHistorial(): Promise<void> {
  const { error } = await supabase.from("avisos_enviados").select("clave").limit(1);
  if (!error) return;
  hayHistorial = false;
  console.warn(
    "[avisos] No existe la tabla `avisos_enviados`: se mantiene el tope de un " +
      "aviso al día, pero NO se puede evitar repetir el mismo dos días " +
      "seguidos. El SQL para crearla está en docs/avisos.md.",
  );
}

async function leerHistorial(usuarioId: string): Promise<AvisoEnviado[]> {
  if (!hayHistorial) return [];
  const desde = new Date(AHORA - 7 * 86_400_000).toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from("avisos_enviados")
    .select("clave, dia")
    .eq("usuario_id", usuarioId)
    .gte("dia", desde);
  if (error) return [];
  return (data ?? []).map((f) => ({ clave: String(f.clave), dia: String(f.dia) }));
}

async function anotarEnvio(usuarioId: string, aviso: Aviso, dia: string): Promise<void> {
  if (!hayHistorial) return;
  const { error } = await supabase.from("avisos_enviados").upsert(
    {
      usuario_id: usuarioId,
      clave: aviso.clave,
      tipo: aviso.tipo,
      titulo: aviso.titulo,
      cuerpo: aviso.cuerpo,
      url: aviso.url,
      dia,
    },
    { onConflict: "usuario_id,dia" },
  );
  if (error) console.warn(`[avisos] ${usuarioId}: no se pudo anotar el envío (${error.message})`);
}

/* ============================================================
   Lectura de perfiles y suscripciones
   ============================================================ */

interface FilaPerfil {
  id: string;
  hora: string;
  dias: number[];
  tipos: TipoAviso[];
  diasOxido: number;
  objetivoHorasSemana: number;
}

async function perfilesActivos(): Promise<FilaPerfil[]> {
  const salida: FilaPerfil[] = [];
  const PAGINA = 500;

  for (let desde = 0; ; desde += PAGINA) {
    let consulta = supabase
      .from("perfiles")
      .select("id, aviso_hora, aviso_dias, aviso_tipos, dias_oxido, objetivo_horas_semana")
      .eq("avisos_activos", true)
      .is("deleted_at", null)
      .order("id")
      .range(desde, desde + PAGINA - 1);
    if (SOLO_USUARIO) consulta = consulta.eq("id", SOLO_USUARIO);

    const { data, error } = await consulta;
    if (error) throw new Error(`perfiles: ${error.message}`);
    for (const f of data ?? []) {
      salida.push({
        id: String(f.id),
        hora: String(f.aviso_hora ?? "20:00"),
        dias: Array.isArray(f.aviso_dias) ? f.aviso_dias.map(Number) : [1, 2, 3, 4, 5, 6, 7],
        tipos: (Array.isArray(f.aviso_tipos) ? f.aviso_tipos : [])
          .map(String)
          .filter((t): t is TipoAviso => TIPOS_VALIDOS.includes(t as TipoAviso)),
        diasOxido: Number(f.dias_oxido ?? 45),
        objetivoHorasSemana: Number(f.objetivo_horas_semana ?? 45),
      });
    }
    if (!data || data.length < PAGINA) break;
  }

  return salida;
}

async function suscripcionesVivas(usuarioId: string): Promise<SuscripcionAviso[]> {
  const { data, error } = await supabase
    .from("suscripciones_aviso")
    .select("id, endpoint, clave_p256dh, clave_auth, user_agent, zona_horaria, ultimo_envio")
    .eq("usuario_id", usuarioId)
    .is("deleted_at", null)
    .is("caducada_at", null);
  if (error) throw new Error(`suscripciones: ${error.message}`);
  return (data ?? []).map((f) => ({
    id: String(f.id),
    endpoint: String(f.endpoint),
    claveP256dh: String(f.clave_p256dh),
    claveAuth: String(f.clave_auth),
    userAgent: String(f.user_agent ?? ""),
    zonaHoraria: String(f.zona_horaria ?? "Europe/Madrid"),
    ultimoEnvio: f.ultimo_envio ? Date.parse(String(f.ultimo_envio)) : null,
  }));
}

/* ============================================================
   Una pasada
   ============================================================ */

const cuenta = { mirados: 0, tocaban: 0, decididos: 0, enviados: 0, caducadas: 0, fallos: 0 };

async function procesar(perfil: FilaPerfil): Promise<void> {
  cuenta.mirados += 1;

  if (!perfil.tipos.length) return; // no quiere ninguna familia de aviso

  const subs = await suscripcionesVivas(perfil.id);
  if (!subs.length) return; // dice que sí a los avisos pero no hay aparato suscrito

  // A quién le toca AHORA. La hora es una sola (está en `perfiles`) pero la
  // zona es de cada aparato, así que el mismo minuto puede ser la hora buena
  // para el móvil que se fue a Canarias y no para el portátil de Madrid.
  const disparador = FORZAR
    ? subs[0]
    : subs.find((s) =>
        tocaAhora(horaLocal(AHORA, s.zonaHoraria), perfil.hora, perfil.dias, VENTANA_MIN),
      );
  if (!disparador) return;

  const local = horaLocal(AHORA, disparador.zonaHoraria);
  cuenta.tocaban += 1;

  // Tope diario, primera barrera: ¿ya se le mandó algo en SU día de hoy? Se
  // mira sobre todos sus aparatos, no solo el que dispara, porque el aviso es
  // del opositor y no del cacharro.
  if (!FORZAR) {
    const yaHoy = subs.some(
      (s) => s.ultimoEnvio != null && horaLocal(s.ultimoEnvio, disparador.zonaHoraria).dia === local.dia,
    );
    if (yaHoy) return;
  }

  const historial = FORZAR ? [] : await leerHistorial(perfil.id);

  const expediente = await cargarExpediente(
    supabase,
    perfil.id,
    {
      diasOxido: perfil.diasOxido,
      objetivoHorasSemana: perfil.objetivoHorasSemana,
      tipos: perfil.tipos,
    },
    AHORA,
  );

  // `conZona` es síncrona a propósito: dentro se toca `process.env.TZ`, que es
  // global, y un `await` ahí dejaría a otro usuario mirando el reloj de este.
  const aviso = conZona(disparador.zonaHoraria, () =>
    decidirAviso(expediente, { ahora: AHORA, hoy: local.dia, historial }),
  );

  if (!aviso) {
    console.log(`[avisos] ${perfil.id}: nada que decir hoy.`);
    return;
  }

  cuenta.decididos += 1;
  console.log(
    `[avisos] ${perfil.id}: ${aviso.tipo} · ${aviso.clave} · "${aviso.titulo}" → ${aviso.url}`,
  );

  if (SECO) return;

  const carga = {
    titulo: aviso.titulo,
    cuerpo: aviso.cuerpo,
    url: aviso.url,
    tipo: aviso.tipo,
    clave: aviso.clave,
  };

  // A todos sus aparatos vivos: el aviso es uno, pero el opositor puede estar
  // delante de cualquiera de ellos.
  const resultados = await Promise.all(subs.map((s) => enviarPush(s, carga)));

  const enviadas: string[] = [];
  const caducadas: string[] = [];
  resultados.forEach((r, i) => {
    const s = subs[i];
    if (r.ok) enviadas.push(s.id);
    else if (r.caducada) caducadas.push(s.id);
    else {
      cuenta.fallos += 1;
      console.warn(`[avisos] ${perfil.id}: fallo ${r.estado ?? "?"} en ${s.endpoint.slice(0, 60)}… ${r.error ?? ""}`);
    }
  });

  cuenta.enviados += enviadas.length;
  cuenta.caducadas += caducadas.length;

  const ahoraIso = new Date(AHORA).toISOString();
  if (enviadas.length) {
    const { error } = await supabase
      .from("suscripciones_aviso")
      .update({ ultimo_envio: ahoraIso })
      .in("id", enviadas);
    if (error) console.warn(`[avisos] ${perfil.id}: no se pudo sellar ultimo_envio (${error.message})`);
  }

  if (caducadas.length) {
    // Caducada, no borrada: la diferencia entre "se rompió el endpoint" y "el
    // opositor apagó los avisos en este aparato" es justo lo que hace falta
    // saber para decidir si se le vuelve a pedir permiso (0003, bloque 3).
    const { error } = await supabase
      .from("suscripciones_aviso")
      .update({ caducada_at: ahoraIso })
      .in("id", caducadas);
    if (error) console.warn(`[avisos] ${perfil.id}: no se pudo marcar caducada (${error.message})`);
  }

  if (enviadas.length) await anotarEnvio(perfil.id, aviso, local.dia);
}

/* ============================================================
   Arranque
   ============================================================ */

await comprobarHistorial();

const perfiles = await perfilesActivos();
console.log(
  `[avisos] ${new Date(AHORA).toISOString()} · ${perfiles.length} perfiles con avisos activos` +
    (SECO ? " · MODO SECO (no se manda nada)" : "") +
    (FORZAR ? " · FORZADO (se ignoran hora y tope diario)" : ""),
);

for (const perfil of perfiles) {
  // En serie y no en paralelo: son consultas por usuario contra la misma base,
  // y el orden no importa. Con miles de opositores habría que trocearlo, pero
  // entonces el problema sería otro.
  try {
    await procesar(perfil);
  } catch (e) {
    cuenta.fallos += 1;
    console.error(`[avisos] ${perfil.id}: ${(e as Error).message}`);
  }
}

console.log(
  `[avisos] Fin. mirados=${cuenta.mirados} tocaban=${cuenta.tocaban} ` +
    `decididos=${cuenta.decididos} enviados=${cuenta.enviados} ` +
    `caducadas=${cuenta.caducadas} fallos=${cuenta.fallos}`,
);

// Un fallo suelto de un endpoint no debe pintar la ejecución de rojo en
// Railway: eso pasa todos los días y no hay nada que arreglar. Solo se sale
// con error si no se pudo ni empezar (eso ya lo hacen los `process.exit(1)` de
// arriba).
process.exit(0);
