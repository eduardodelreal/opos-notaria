/**
 * Tipos compartidos de los avisos proactivos.
 *
 * Este fichero no importa nada del navegador ni de Supabase a propósito: lo
 * leen tres sitios muy distintos —el motor de decisión, el componente de
 * ajustes y el cron de Railway— y solo uno de ellos corre en un navegador.
 */

/**
 * Las cuatro familias de aviso.
 *
 * Los valores están atados al check de `perfiles.aviso_tipos`
 * (db/migrations/0003), así que NO se pueden inventar más sin una migración:
 *
 *   oxido      un tema dominado que se está oxidando, o una materia entera
 *              que lleva días sin tocarse
 *   repaso     el SRS dice que ese tema ya tocaba (lib/data/srs.ts)
 *   racha      constancia: la racha se rompe hoy, o el objetivo semanal
 *              está lejos a mitad de semana
 *   simulacro  hace demasiado del último simulacro
 */
export type TipoAviso = "oxido" | "repaso" | "racha" | "simulacro";

export const TIPOS_AVISO: { id: TipoAviso; label: string; desc: string }[] = [
  {
    id: "oxido",
    label: "Temas que se oxidan",
    desc: "Un tema que dominabas y llevas semanas sin tocar, o una materia entera abandonada",
  },
  {
    id: "repaso",
    label: "Repasos vencidos",
    desc: "Cuando el repaso espaciado dice que un tema ya tocaba",
  },
  {
    id: "racha",
    label: "Constancia",
    desc: "La racha se te rompe hoy, o vas lejos del objetivo semanal a mitad de semana",
  },
  {
    id: "simulacro",
    label: "Simulacros",
    desc: "Hace demasiado del último simulacro",
  },
];

/** Un aviso ya decidido, listo para convertirse en notificación. */
export interface Aviso {
  tipo: TipoAviso;
  /**
   * Identidad estable del aviso, y la pieza sobre la que gira el "no repetir
   * dos días seguidos". Es estable A PROPÓSITO —`oxido:tema:<id>`, no
   * `oxido:tema:<id>:2026-09-06`—: si llevara la fecha dentro, el mismo aviso
   * sería una clave distinta cada día y no habría nada que comparar, que es
   * justo lo que produce el goteo diario que queremos evitar.
   */
  clave: string;
  titulo: string;
  cuerpo: string;
  /** Ruta interna a la que lleva el toque en la notificación. */
  url: string;
  /** Solo ordena candidatos entre sí; no sale a ninguna pantalla. */
  peso: number;
}

/** Lo que el cron necesita saber del perfil para decidir. */
export interface PerfilAvisos {
  diasOxido: number;
  objetivoHorasSemana: number;
  /** Qué familias quiere recibir. Un aviso de una familia fuera de aquí se descarta. */
  tipos: TipoAviso[];
}

/** Un aviso ya enviado. Es la memoria contra la repetición. */
export interface AvisoEnviado {
  clave: string;
  /** Día LOCAL del usuario (YYYY-MM-DD) en que se envió. */
  dia: string;
}

/** Una suscripción push viva, tal y como está en `suscripciones_aviso`. */
export interface SuscripcionAviso {
  id: string;
  endpoint: string;
  claveP256dh: string;
  claveAuth: string;
  userAgent: string;
  zonaHoraria: string;
  ultimoEnvio: number | null;
}

/** Las preferencias de `perfiles`, ya en forma de app. */
export interface PreferenciasAviso {
  activos: boolean;
  /** "20:00", hora local del dispositivo que recibe. */
  hora: string;
  /** Días ISO: 1 = lunes … 7 = domingo. */
  dias: number[];
  tipos: TipoAviso[];
}

export const PREFERENCIAS_POR_DEFECTO: PreferenciasAviso = {
  activos: false,
  hora: "20:00",
  dias: [1, 2, 3, 4, 5, 6, 7],
  tipos: ["oxido", "repaso", "racha"],
};

/** Lo que viaja dentro del push y lee el service worker (public/sw-avisos.js). */
export interface CargaPush {
  titulo: string;
  cuerpo: string;
  url: string;
  tipo: TipoAviso;
  clave: string;
}
