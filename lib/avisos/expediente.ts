/**
 * Carga el expediente de un opositor desde Supabase y lo traduce al modelo de
 * dominio de la app (`lib/data/types.ts`).
 *
 * Existe esta traducción, y no se consulta la base "a lo que haga falta",
 * porque el motor de decisión reutiliza `lib/data/srs.ts` tal cual. Para poder
 * llamar a `colaDeRepaso` con lo que hay en el servidor hay que darle
 * exactamente lo que espera: `Tema[]`, `Record<string, ProgresoTema>` y
 * `Sesion[]`, con los tiempos en milisegundos y no en ISO.
 *
 * Lo usa el cron (scripts/enviar-avisos.ts) con la `service_role`, que se salta
 * la RLS. Por eso TODAS las consultas de aquí filtran por `usuario_id` a mano:
 * sin RLS que ponga la red debajo, olvidarse de ese filtro sería mezclar los
 * datos de dos opositores en el mismo aviso.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  EstadoTema,
  Materia,
  ProgresoTema,
  Sesion,
  Simulacro,
  Tema,
  TipoSesion,
} from "../data/types";
import { DIA_MS } from "../utils/time";
import type { ExpedienteAvisos, } from "./motor";
import type { PerfilAvisos } from "./tipos";

/**
 * Ventanas de datos. El motor mira "hace cuánto" y "esta semana", así que no
 * hace falta bajarse cinco años de expediente por usuario y por pasada.
 *   · sesiones: 400 días, que es lo que aguanta una racha larga de verdad.
 *   · simulacros: 400 días, para poder decir "nunca has hecho uno".
 */
const DIAS_SESIONES = 400;
const DIAS_SIMULACROS = 400;
const TOPE_FILAS = 5000;

const ms = (v: unknown): number | undefined => {
  if (typeof v !== "string") return undefined;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : undefined;
};

const iso = (ts: number) => new Date(ts).toISOString();

export async function cargarExpediente(
  supabase: SupabaseClient,
  usuarioId: string,
  perfil: PerfilAvisos,
  ahora = Date.now(),
): Promise<ExpedienteAvisos> {
  const desdeSesiones = iso(ahora - DIAS_SESIONES * DIA_MS);
  const desdeSimulacros = iso(ahora - DIAS_SIMULACROS * DIA_MS);

  const [materias, temas, progresos, sesiones, simulacros] = await Promise.all([
    supabase
      .from("materias")
      .select("id, nombre, abrev, color, ejercicio, descripcion, orden")
      .eq("usuario_id", usuarioId)
      .is("deleted_at", null),
    supabase
      .from("temas")
      .select("id, materia_id, numero, titulo, propio")
      .eq("usuario_id", usuarioId)
      .is("deleted_at", null),
    supabase
      .from("progreso_temas")
      .select(
        "tema_id, estado, segundos, dificultad, vueltas, ultimo_estudio, ultimo_cante, nota_media, proximo_repaso, favorito",
      )
      .eq("usuario_id", usuarioId)
      .is("deleted_at", null),
    supabase
      .from("sesiones")
      .select("id, tema_id, tipo, inicio, fin, segundos")
      .eq("usuario_id", usuarioId)
      .is("deleted_at", null)
      .gte("inicio", desdeSesiones)
      .order("inicio", { ascending: false })
      .limit(TOPE_FILAS),
    supabase
      .from("simulacros")
      .select("id, tipo, fecha, tema_ids, minutos, segundos_usados, notas, completado")
      .eq("usuario_id", usuarioId)
      .is("deleted_at", null)
      .gte("fecha", desdeSimulacros),
  ]);

  const primerError =
    materias.error ?? temas.error ?? progresos.error ?? sesiones.error ?? simulacros.error;
  if (primerError) throw new Error(`Supabase: ${primerError.message}`);

  return {
    materias: (materias.data ?? []).map(
      (f): Materia => ({
        id: String(f.id),
        nombre: String(f.nombre ?? ""),
        abrev: String(f.abrev ?? ""),
        color: String(f.color ?? "#c9a227"),
        ejercicio: Number(f.ejercicio ?? 1) as Materia["ejercicio"],
        descripcion: String(f.descripcion ?? ""),
        orden: Number(f.orden ?? 0),
        // El reloj del last-write-wins no pinta nada aquí: el cron solo lee y
        // no empuja nada de vuelta. Se rellena para cumplir el tipo.
        actualizado: 0,
      }),
    ),
    temas: (temas.data ?? []).map(
      (f): Tema => ({
        id: String(f.id),
        materiaId: String(f.materia_id),
        numero: Number(f.numero ?? 0),
        titulo: String(f.titulo ?? ""),
        // Los epígrafes no se bajan: ningún aviso los nombra, y son la tabla
        // más grande del esquema con diferencia.
        epigrafes: [],
        propio: f.propio === true,
        actualizado: 0,
      }),
    ),
    progresos: Object.fromEntries(
      (progresos.data ?? []).map((f) => {
        const p: ProgresoTema = {
          temaId: String(f.tema_id),
          estado: String(f.estado ?? "nuevo") as EstadoTema,
          segundos: Number(f.segundos ?? 0),
          dificultad: Number(f.dificultad ?? 3),
          vueltas: Number(f.vueltas ?? 0),
          ultimoEstudio: ms(f.ultimo_estudio),
          ultimoCante: ms(f.ultimo_cante),
          notaMedia: f.nota_media == null ? undefined : Number(f.nota_media),
          proximoRepaso: ms(f.proximo_repaso),
          favorito: f.favorito === true,
          actualizado: 0,
        };
        return [p.temaId, p];
      }),
    ),
    sesiones: (sesiones.data ?? []).map(
      (f): Sesion => ({
        id: String(f.id),
        temaId: f.tema_id ? String(f.tema_id) : undefined,
        tipo: String(f.tipo ?? "estudio") as TipoSesion,
        inicio: ms(f.inicio) ?? 0,
        fin: ms(f.fin) ?? 0,
        segundos: Number(f.segundos ?? 0),
      }),
    ),
    simulacros: (simulacros.data ?? []).map(
      (f): Simulacro => ({
        id: String(f.id),
        tipo: f.tipo === "dictamen" ? "dictamen" : "cante",
        fecha: ms(f.fecha) ?? 0,
        temaIds: Array.isArray(f.tema_ids) ? f.tema_ids.map(String) : [],
        minutos: Number(f.minutos ?? 0),
        segundosUsados: Number(f.segundos_usados ?? 0),
        notas: Array.isArray(f.notas) ? (f.notas as (number | null)[]) : [],
        completado: f.completado === true,
        actualizado: 0,
      }),
    ),
    perfil,
  };
}
