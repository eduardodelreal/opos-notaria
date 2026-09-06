"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import * as React from "react";
import { idbStorage } from "./persist";
import { materiasIniciales } from "../data/materias";
import { PERFIL_INICIAL } from "../data/perfil";
import { haySupabase } from "../supabase/config";
import {
  cambiosDe,
  clave as claveCola,
  encolarTodo,
  ID_PERFIL,
  type Cola,
} from "../sync/cola";
import {
  MARCAS_INICIALES,
  type Expediente,
  type Marcas,
} from "../sync/expediente";
import type { Almacen, CambioSync } from "../sync/motor";
import { ahoraSellado } from "../sync/reloj";
import { esUuid, uid } from "../utils/id";
import { calcularProximoRepaso } from "../data/srs";
import {
  derivarProgresos,
  notaMediaDeTema,
  segundosDeTema,
  vueltasDeTema,
} from "../data/derivados";
import { temasVivos, vivos, vivosMapa } from "../data/vivos";
import { sellar } from "./sellado";
import {
  migrarARelojes,
  migrarAUuid,
  type ExpedienteV1,
  type ExpedienteV2,
} from "./migraciones";
import type {
  AnalisisCante,
  AudioCante,
  Cante,
  ComparacionCante,
  CanteEpigrafe,
  Epigrafe,
  EstadoTema,
  KeyPoint,
  Materia,
  MensajeChat,
  Nota,
  Perfil,
  ProgresoTema,
  Sesion,
  Simulacro,
  Tema,
  TipoSesion,
  TranscripcionCante,
  Vuelta,
} from "../data/types";

export interface CronoActivo {
  tipo: TipoSesion;
  temaId?: string;
  /** Momento en el que arrancó el tramo actual. */
  desde: number;
  /** Segundos acumulados de tramos anteriores de esta misma sesión. */
  acumulado: number;
  pausado: boolean;
}

interface Estado {
  hidratado: boolean;
  perfil: Perfil;
  materias: Materia[];
  temas: Tema[];
  /**
   * Caché de contadores por tema. Lo que se pinta sale de `useProgresos()`,
   * que recalcula `segundos`, `notaMedia` y `vueltas` desde las colecciones
   * append-only. Ver lib/data/derivados.ts.
   */
  progresos: Record<string, ProgresoTema>;
  sesiones: Sesion[];
  cantes: Cante[];
  keypoints: KeyPoint[];
  notas: Nota[];
  simulacros: Simulacro[];
  /** Append-only: una fila por cada transición a "dominado". */
  vueltas: Vuelta[];
  chat: MensajeChat[];
  crono: CronoActivo | null;
  /**
   * Cola de salida de la sincronización: qué filas ha tocado este aparato y
   * todavía no han subido. Va DENTRO del estado persistido, no en una clave
   * suya de IndexedDB, para que el dato y su marca de "pendiente" se
   * guarden en la misma escritura (lib/sync/cola.ts).
   */
  cola: Cola;
  /** Cursor del pull, cuenta y relojes de la sincronización. */
  sincro: Marcas;
}

interface Acciones {
  setPerfil: (parcial: Partial<Perfil>) => void;
  alternarTema: () => void;

  // --- materias ---
  addMateria: (nombre: string, abrev: string, color: string) => Materia;
  updateMateria: (id: string, parcial: Partial<Materia>) => void;
  removeMateria: (id: string) => void;

  // --- temas ---
  addTema: (materiaId: string, numero: number, titulo: string) => Tema;
  addTemasMasivo: (
    materiaId: string,
    filas: { numero: number; titulo: string }[],
  ) => number;
  updateTema: (id: string, parcial: Partial<Tema>) => void;
  removeTema: (id: string) => void;
  setEpigrafes: (temaId: string, epigrafes: Epigrafe[]) => void;
  addEpigrafe: (temaId: string, titulo: string, texto?: string) => void;
  updateEpigrafe: (
    temaId: string,
    epigrafeId: string,
    parcial: Partial<Epigrafe>,
  ) => void;
  removeEpigrafe: (temaId: string, epigrafeId: string) => void;

  // --- progreso ---
  progresoDe: (temaId: string) => ProgresoTema;
  setEstado: (temaId: string, estado: EstadoTema) => void;
  setDificultad: (temaId: string, dificultad: number) => void;
  alternarFavorito: (temaId: string) => void;
  sumarVuelta: (temaId: string) => void;

  // --- crono ---
  iniciarCrono: (tipo: TipoSesion, temaId?: string) => void;
  pausarCrono: () => void;
  reanudarCrono: () => void;
  pararCrono: (nota?: string) => Sesion | null;
  descartarCrono: () => void;
  segundosCrono: () => number;

  // --- cantes ---
  guardarCante: (
    cante: Omit<Cante, "id" | "fecha" | "actualizado"> & { fecha?: number },
  ) => Cante;
  updateCante: (id: string, parcial: Partial<Cante>) => void;
  setAnalisisCante: (id: string, analisis: AnalisisCante) => void;
  /** Ficha de la grabación. El binario va aparte (lib/audio/almacen.ts). */
  setAudioCante: (id: string, audio: Partial<AudioCante>) => void;
  setTranscripcionCante: (id: string, transcripcion: TranscripcionCante) => void;
  setComparacionCante: (id: string, comparacion: ComparacionCante) => void;
  removeCante: (id: string) => void;
  cantesDe: (temaId: string) => Cante[];

  // --- keypoints ---
  addKeyPoint: (
    temaId: string,
    anverso: string,
    reverso: string,
    epigrafeId?: string,
  ) => void;
  responderKeyPoint: (id: string, acierto: boolean) => void;
  removeKeyPoint: (id: string) => void;

  // --- notas ---
  addNota: (temaId: string, texto: string, epigrafeId?: string) => void;
  updateNota: (id: string, texto: string) => void;
  removeNota: (id: string) => void;

  // --- simulacros ---
  addSimulacro: (s: Omit<Simulacro, "id" | "actualizado">) => Simulacro;
  updateSimulacro: (id: string, parcial: Partial<Simulacro>) => void;
  removeSimulacro: (id: string) => void;

  // --- chat ---
  addMensaje: (m: Omit<MensajeChat, "id" | "creado">) => MensajeChat;
  limpiarChat: () => void;

  // --- datos ---
  exportar: () => string;
  importar: (json: string) => { ok: boolean; error?: string };
  borrarTodo: () => void;
}

export type Store = Estado & Acciones;

const ESTADO_INICIAL: Estado = {
  hidratado: false,
  perfil: PERFIL_INICIAL,
  materias: materiasIniciales(),
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
  cola: {},
  sincro: MARCAS_INICIALES,
};

function progresoVacio(temaId: string): ProgresoTema {
  return {
    temaId,
    estado: "nuevo",
    segundos: 0,
    dificultad: 3,
    vueltas: 0,
    actualizado: Date.now(),
  };
}

/* ---------------- borrado lógico ----------------

   Borrar es poner `borrado`, nunca sacar la fila del array: un borrado
   físico no deja nada que empujar y el otro dispositivo resucitaría la
   fila en el siguiente pull (docs/sincronizacion.md §7). El reloj de la
   tumba lo pone el sellado, porque marcarla es una modificación como
   cualquier otra.

   Estas funciones devuelven el array original cuando no hay nada que
   marcar: así el sellado no tiene ni que mirarlo.
   ---------------------------------------------- */

function marcarBorradas<T extends { id: string; borrado?: number }>(
  filas: T[],
  ids: Set<string>,
  ahora: number,
): T[] {
  let cambia = false;
  const salida = filas.map((f) => {
    if (!ids.has(f.id) || f.borrado != null) return f;
    cambia = true;
    return { ...f, borrado: ahora };
  });
  return cambia ? salida : filas;
}

function marcarPorTema<T extends { temaId: string; borrado?: number }>(
  filas: T[],
  temas: Set<string>,
  ahora: number,
): T[] {
  let cambia = false;
  const salida = filas.map((f) => {
    if (!temas.has(f.temaId) || f.borrado != null) return f;
    cambia = true;
    return { ...f, borrado: ahora };
  });
  return cambia ? salida : filas;
}

/**
 * La misma cascada que hace el servidor en `cascada_borrado_tema()`.
 *
 * Está duplicada a propósito (§7 del contrato): si solo la hiciera el
 * servidor, este dispositivo enseñaría los cantes y las notas de un tema
 * que ya no existe hasta el siguiente pull.
 *
 * `sesiones` NO se cascadea, aquí ni allí: borrar un tema del programa no
 * significa no haberlo estudiado, y esas horas son del opositor. Su
 * `temaId` queda apuntando a un tema con tumba, que es exactamente lo que
 * el contrato describe.
 */
function cascadaTemas(s: Estado, ids: Set<string>, ahora: number): Partial<Estado> {
  if (!ids.size) return {};

  const progresos = { ...s.progresos };
  for (const temaId of ids) {
    const p = progresos[temaId];
    if (p && p.borrado == null) progresos[temaId] = { ...p, borrado: ahora };
  }

  return {
    temas: s.temas.map((t) => {
      if (!ids.has(t.id) || t.borrado != null) return t;
      return {
        ...t,
        borrado: ahora,
        // Los epígrafes son filas propias en el servidor: la cascada tiene
        // que marcarlos uno a uno, no darlos por muertos con el tema.
        epigrafes: t.epigrafes.map((e) =>
          e.borrado == null ? { ...e, borrado: ahora } : e,
        ),
      };
    }),
    progresos,
    cantes: marcarPorTema(s.cantes, ids, ahora),
    keypoints: marcarPorTema(s.keypoints, ids, ahora),
    notas: marcarPorTema(s.notas, ids, ahora),
    vueltas: marcarPorTema(s.vueltas, ids, ahora),
  };
}

/** Recalcula el próximo repaso cada vez que se toca un tema. */
function conSRS(p: ProgresoTema): ProgresoTema {
  return { ...p, proximoRepaso: calcularProximoRepaso(p) };
}

export const useStore = create<Store>()(
  persist(
    (set, get) => ({
      ...ESTADO_INICIAL,

      // El perfil también es una fila del servidor, así que su escritura
      // pasa por el mismo embudo: si no, se editaría en Ajustes y no
      // llegaría nunca al otro dispositivo.
      setPerfil: (parcial) =>
        escribir((s) => ({ perfil: { ...s.perfil, ...parcial } })),

      alternarTema: () =>
        escribir((s) => ({
          perfil: {
            ...s.perfil,
            tema: s.perfil.tema === "dark" ? "light" : "dark",
          },
        })),

      /* ---------------- materias ---------------- */

      addMateria: (nombre, abrev, color) => {
        const limpio = nombre.trim();
        const materia: Materia = {
          id: uid(),
          nombre: limpio,
          abrev:
            abrev.trim().toUpperCase().slice(0, 4) ||
            limpio.toUpperCase().slice(0, 3),
          color,
          ejercicio: 1,
          descripcion: "",
          // Va al final de la lista: es donde el usuario la ve aparecer.
          // Cuenta también las borradas para no reutilizar un `orden` que
          // podría volver en un pull.
          orden: get().materias.reduce((max, m) => Math.max(max, m.orden), -1) + 1,
          actualizado: Date.now(),
        };
        escribir((s) => ({ materias: [...s.materias, materia] }));
        return materia;
      },

      updateMateria: (id, parcial) =>
        escribir((s) => ({
          materias: s.materias.map((m) => (m.id === id ? { ...m, ...parcial } : m)),
        })),

      // Igual que `cascada_borrado_materia()` en el servidor: la materia se
      // marca y arrastra sus temas, que a su vez arrastran lo suyo.
      removeMateria: (id) =>
        escribir((s) => {
          const ahora = Date.now();
          const hijos = new Set(
            s.temas
              .filter((t) => t.materiaId === id && t.borrado == null)
              .map((t) => t.id),
          );
          return {
            materias: marcarBorradas(s.materias, new Set([id]), ahora),
            ...cascadaTemas(s, hijos, ahora),
          };
        }),

      /* ---------------- temas ---------------- */

      addTema: (materiaId, numero, titulo) => {
        const tema: Tema = {
          id: uid(),
          materiaId,
          numero,
          titulo: titulo.trim(),
          epigrafes: [],
          propio: true,
          actualizado: Date.now(),
        };
        escribir((s) => ({
          temas: [...s.temas, tema],
          progresos: { ...s.progresos, [tema.id]: progresoVacio(tema.id) },
        }));
        return tema;
      },

      addTemasMasivo: (materiaId, filas) => {
        const nuevos: Tema[] = [];
        const progresos: Record<string, ProgresoTema> = {};
        const ahora = Date.now();
        for (const f of filas) {
          const titulo = f.titulo.trim();
          if (!titulo) continue;
          const tema: Tema = {
            id: uid(),
            materiaId,
            numero: f.numero,
            titulo,
            epigrafes: [],
            propio: true,
            actualizado: ahora,
          };
          nuevos.push(tema);
          progresos[tema.id] = progresoVacio(tema.id);
        }
        escribir((s) => ({
          temas: [...s.temas, ...nuevos],
          progresos: { ...s.progresos, ...progresos },
        }));
        return nuevos.length;
      },

      updateTema: (id, parcial) =>
        escribir((s) => ({
          temas: s.temas.map((t) => (t.id === id ? { ...t, ...parcial } : t)),
        })),

      removeTema: (id) =>
        escribir((s) => cascadaTemas(s, new Set([id]), Date.now())),

      // El array de epígrafes es una comodidad de la UI; en el servidor cada
      // epígrafe es una fila con su propio reloj. Por eso esto no sustituye
      // el array a ciegas: compara con lo que había para distinguir qué se
      // creó, qué cambió (y solo entonces avanza `actualizado`) y qué se
      // borró, que es lo único que la sincronización sabrá convertir en
      // altas, updates y tumbas.
      setEpigrafes: (temaId, epigrafes) =>
        escribir((s) => {
          const tema = s.temas.find((t) => t.id === temaId);
          if (!tema) return {};
          const ahora = Date.now();
          const previos = new Map(tema.epigrafes.map((e) => [e.id, e]));

          const siguientes: Epigrafe[] = epigrafes.map((e, i) => {
            const orden = i + 1;
            const previo = previos.get(e.id);
            // `borrado: undefined` porque la lista que llega es "estos son
            // los epígrafes vivos": si uno vuelve, deja de ser tumba. El
            // reloj no se toca aquí; el sellado lo mueve solo si el
            // contenido ha cambiado de verdad.
            if (!previo) {
              return {
                ...e,
                orden,
                creado: e.creado ?? ahora,
                actualizado: ahora,
                borrado: undefined,
              };
            }
            return { ...previo, ...e, orden, creado: previo.creado, borrado: undefined };
          });

          // Los que ya no vienen se marcan; las tumbas anteriores se quedan
          // como están, con su fecha original.
          const presentes = new Set(siguientes.map((e) => e.id));
          const idas = tema.epigrafes
            .filter((e) => !presentes.has(e.id))
            .map((e) => (e.borrado == null ? { ...e, borrado: ahora } : e));

          return {
            temas: s.temas.map((t) =>
              t.id === temaId ? { ...t, epigrafes: [...siguientes, ...idas] } : t,
            ),
          };
        }),

      addEpigrafe: (temaId, titulo, texto) =>
        escribir((s) => {
          const ahora = Date.now();
          return {
            temas: s.temas.map((t) =>
              t.id === temaId
                ? {
                    ...t,
                    epigrafes: [
                      ...t.epigrafes,
                      {
                        id: uid(),
                        // El orden lo dan los epígrafes vivos: las tumbas
                        // no ocupan sitio en la lista que ve el opositor.
                        orden: t.epigrafes.filter((e) => e.borrado == null).length + 1,
                        titulo: titulo.trim(),
                        texto,
                        creado: ahora,
                        actualizado: ahora,
                      },
                    ],
                  }
                : t,
            ),
          };
        }),

      updateEpigrafe: (temaId, epigrafeId, parcial) =>
        escribir((s) => ({
          temas: s.temas.map((t) =>
            t.id === temaId
              ? {
                  ...t,
                  epigrafes: t.epigrafes.map((e) =>
                    e.id === epigrafeId ? { ...e, ...parcial } : e,
                  ),
                }
              : t,
          ),
        })),

      // Renumerar deja constancia: cada epígrafe que cambia de posición es
      // una fila más que tendrá que subir, no solo la que desaparece.
      removeEpigrafe: (temaId, epigrafeId) =>
        escribir((s) => {
          const ahora = Date.now();
          return {
            temas: s.temas.map((t) => {
              if (t.id !== temaId) return t;
              let orden = 0;
              return {
                ...t,
                epigrafes: t.epigrafes.map((e) => {
                  if (e.id === epigrafeId) {
                    return e.borrado == null ? { ...e, borrado: ahora } : e;
                  }
                  // Una tumba no ocupa posición ni se renumera.
                  if (e.borrado != null) return e;
                  orden += 1;
                  return e.orden === orden ? e : { ...e, orden };
                }),
              };
            }),
          };
        }),

      /* ---------------- progreso ---------------- */

      // Devuelve el progreso ya derivado: nadie que pregunte por el progreso
      // de un tema debería recibir los contadores en caché.
      progresoDe: (temaId) => {
        const s = get();
        const guardado = s.progresos[temaId];
        // Un progreso con tumba es como no tener progreso: el tema está
        // borrado y nadie debería ver sus contadores.
        const previo =
          guardado && guardado.borrado == null ? guardado : progresoVacio(temaId);
        return {
          ...previo,
          segundos: segundosDeTema(temaId, s.sesiones),
          notaMedia: notaMediaDeTema(temaId, s.cantes),
          vueltas: vueltasDeTema(temaId, s.vueltas),
        };
      },

      setEstado: (temaId, estado) =>
        escribir((s) => {
          const previo = s.progresos[temaId] ?? progresoVacio(temaId);
          // Marcar un tema como dominado cierra vuelta. Se registra como
          // hecho, no como incremento: un contador no se puede reconstruir
          // si dos dispositivos cierran vuelta antes de sincronizar.
          const cierra = estado === "dominado" && previo.estado !== "dominado";
          const siguiente = conSRS({
            ...previo,
            estado,
            vueltas: previo.vueltas + (cierra ? 1 : 0),
          });
          return {
            progresos: { ...s.progresos, [temaId]: siguiente },
            vueltas: cierra
              ? [
                  ...s.vueltas,
                  { id: uid(), temaId, fecha: Date.now(), actualizado: Date.now() },
                ]
              : s.vueltas,
          };
        }),

      setDificultad: (temaId, dificultad) =>
        escribir((s) => {
          const previo = s.progresos[temaId] ?? progresoVacio(temaId);
          return {
            progresos: {
              ...s.progresos,
              [temaId]: conSRS({ ...previo, dificultad }),
            },
          };
        }),

      alternarFavorito: (temaId) =>
        escribir((s) => {
          const previo = s.progresos[temaId] ?? progresoVacio(temaId);
          return {
            progresos: {
              ...s.progresos,
              [temaId]: { ...previo, favorito: !previo.favorito },
            },
          };
        }),

      sumarVuelta: (temaId) =>
        escribir((s) => {
          const previo = s.progresos[temaId] ?? progresoVacio(temaId);
          return {
            progresos: {
              ...s.progresos,
              [temaId]: conSRS({ ...previo, vueltas: previo.vueltas + 1 }),
            },
            vueltas: [
              ...s.vueltas,
              { id: uid(), temaId, fecha: Date.now(), actualizado: Date.now() },
            ],
          };
        }),

      /* ---------------- crono ---------------- */

      iniciarCrono: (tipo, temaId) =>
        set({
          crono: { tipo, temaId, desde: Date.now(), acumulado: 0, pausado: false },
        }),

      pausarCrono: () =>
        set((s) => {
          if (!s.crono || s.crono.pausado) return {};
          const extra = Math.floor((Date.now() - s.crono.desde) / 1000);
          return {
            crono: {
              ...s.crono,
              acumulado: s.crono.acumulado + extra,
              pausado: true,
            },
          };
        }),

      reanudarCrono: () =>
        set((s) => {
          if (!s.crono || !s.crono.pausado) return {};
          return { crono: { ...s.crono, desde: Date.now(), pausado: false } };
        }),

      segundosCrono: () => {
        const c = get().crono;
        if (!c) return 0;
        if (c.pausado) return c.acumulado;
        return c.acumulado + Math.floor((Date.now() - c.desde) / 1000);
      },

      pararCrono: (nota) => {
        const c = get().crono;
        if (!c) return null;
        const segundos = get().segundosCrono();
        set({ crono: null });
        // Menos de 20 segundos no es una sesión, es un clic sin querer.
        if (segundos < 20) return null;

        const sesion: Sesion = {
          id: uid(),
          temaId: c.temaId,
          tipo: c.tipo,
          inicio: c.desde - c.acumulado * 1000,
          fin: Date.now(),
          segundos,
          nota,
        };

        escribir((s) => {
          const progresos = { ...s.progresos };
          if (c.temaId) {
            const previo = progresos[c.temaId] ?? progresoVacio(c.temaId);
            progresos[c.temaId] = conSRS({
              ...previo,
              segundos: previo.segundos + segundos,
              ultimoEstudio: Date.now(),
              estado: previo.estado === "nuevo" ? "estudiando" : previo.estado,
            });
          }
          return { sesiones: [...s.sesiones, sesion], progresos };
        });

        return sesion;
      },

      descartarCrono: () => set({ crono: null }),

      /* ---------------- cantes ---------------- */

      guardarCante: (datos) => {
        const cante: Cante = {
          ...datos,
          id: uid(),
          fecha: datos.fecha ?? Date.now(),
          actualizado: Date.now(),
        };

        escribir((s) => {
          const previo =
            s.progresos[cante.temaId] ?? progresoVacio(cante.temaId);
          // La media es de los cantes vivos: uno borrado no debe seguir
          // tirando de la nota del tema.
          const notasPrevias = vivos(s.cantes)
            .filter((c) => c.temaId === cante.temaId && c.nota != null)
            .map((c) => c.nota as number);
          if (cante.nota != null) notasPrevias.push(cante.nota);
          const notaMedia = notasPrevias.length
            ? Number(
                (
                  notasPrevias.reduce((a, b) => a + b, 0) / notasPrevias.length
                ).toFixed(1),
              )
            : previo.notaMedia;

          const progreso = conSRS({
            ...previo,
            ultimoCante: cante.fecha,
            segundos: previo.segundos + cante.segundos,
            notaMedia,
            estado:
              previo.estado === "nuevo" || previo.estado === "estudiando"
                ? "cantable"
                : previo.estado === "oxidado"
                  ? "cantable"
                  : previo.estado,
          });

          const sesion: Sesion = {
            id: uid(),
            temaId: cante.temaId,
            tipo: "cante",
            inicio: cante.fecha - cante.segundos * 1000,
            fin: cante.fecha,
            segundos: cante.segundos,
          };

          return {
            cantes: [...s.cantes, cante],
            sesiones: [...s.sesiones, sesion],
            progresos: { ...s.progresos, [cante.temaId]: progreso },
          };
        });

        return cante;
      },

      updateCante: (id, parcial) =>
        escribir((s) => ({
          cantes: s.cantes.map((c) => (c.id === id ? { ...c, ...parcial } : c)),
        })),

      setAnalisisCante: (id, analisis) =>
        escribir((s) => ({
          cantes: s.cantes.map((c) => (c.id === id ? { ...c, analisis } : c)),
        })),

      // Fusiona en vez de reemplazar: la subida rellena `path` y `subido`
      // sin tener por qué conocer las marcas de epígrafe que puso el cante.
      setAudioCante: (id, audio) =>
        escribir((s) => ({
          cantes: s.cantes.map((c) =>
            c.id === id ? { ...c, audio: { ...c.audio, ...audio } } : c,
          ),
        })),

      setTranscripcionCante: (id, transcripcion) =>
        escribir((s) => ({
          cantes: s.cantes.map((c) => (c.id === id ? { ...c, transcripcion } : c)),
        })),

      setComparacionCante: (id, comparacion) =>
        escribir((s) => ({
          cantes: s.cantes.map((c) => (c.id === id ? { ...c, comparacion } : c)),
        })),

      removeCante: (id) =>
        escribir((s) => ({
          cantes: marcarBorradas(s.cantes, new Set([id]), Date.now()),
        })),

      cantesDe: (temaId) =>
        vivos(get().cantes)
          .filter((c) => c.temaId === temaId)
          .sort((a, b) => b.fecha - a.fecha),

      /* ---------------- keypoints ---------------- */

      addKeyPoint: (temaId, anverso, reverso, epigrafeId) =>
        escribir((s) => ({
          keypoints: [
            ...s.keypoints,
            {
              id: uid(),
              temaId,
              epigrafeId,
              anverso: anverso.trim(),
              reverso: reverso.trim(),
              creado: Date.now(),
              actualizado: Date.now(),
              aciertos: 0,
              fallos: 0,
              intervaloDias: 1,
              proximoRepaso: Date.now(),
            },
          ],
        })),

      responderKeyPoint: (id, acierto) =>
        escribir((s) => ({
          keypoints: s.keypoints.map((k) => {
            if (k.id !== id) return k;
            // SM-2 simplificado: acierto duplica y algo más, fallo vuelve al día 1.
            const intervaloDias = acierto
              ? Math.min(180, Math.max(1, Math.round(k.intervaloDias * 2.3)))
              : 1;
            return {
              ...k,
              aciertos: k.aciertos + (acierto ? 1 : 0),
              fallos: k.fallos + (acierto ? 0 : 1),
              intervaloDias,
              proximoRepaso: Date.now() + intervaloDias * 86_400_000,
            };
          }),
        })),

      removeKeyPoint: (id) =>
        escribir((s) => ({
          keypoints: marcarBorradas(s.keypoints, new Set([id]), Date.now()),
        })),

      /* ---------------- notas ---------------- */

      addNota: (temaId, texto, epigrafeId) =>
        escribir((s) => ({
          notas: [
            ...s.notas,
            {
              id: uid(),
              temaId,
              epigrafeId,
              texto,
              creado: Date.now(),
              actualizado: Date.now(),
            },
          ],
        })),

      updateNota: (id, texto) =>
        escribir((s) => ({
          notas: s.notas.map((n) => (n.id === id ? { ...n, texto } : n)),
        })),

      removeNota: (id) =>
        escribir((s) => ({
          notas: marcarBorradas(s.notas, new Set([id]), Date.now()),
        })),

      /* ---------------- simulacros ---------------- */

      addSimulacro: (s0) => {
        const simulacro: Simulacro = { ...s0, id: uid(), actualizado: Date.now() };
        escribir((s) => ({ simulacros: [...s.simulacros, simulacro] }));
        return simulacro;
      },

      updateSimulacro: (id, parcial) =>
        escribir((s) => ({
          simulacros: s.simulacros.map((x) =>
            x.id === id ? { ...x, ...parcial } : x,
          ),
        })),

      removeSimulacro: (id) =>
        escribir((s) => ({
          simulacros: marcarBorradas(s.simulacros, new Set([id]), Date.now()),
        })),

      /* ---------------- chat ---------------- */

      addMensaje: (m) => {
        const mensaje: MensajeChat = { ...m, id: uid(), creado: Date.now() };
        set((s) => ({ chat: [...s.chat, mensaje] }));
        return mensaje;
      },

      limpiarChat: () => set({ chat: [] }),

      /* ---------------- datos ---------------- */

      // La copia de seguridad es del expediente, no del estado interno:
      // las tumbas se quedan fuera. Sirven para que un borrado viaje a otro
      // dispositivo, y un fichero que el opositor se lleva no es eso.
      exportar: () => {
        const s = get();
        return JSON.stringify(
          {
            version: 3,
            exportado: new Date().toISOString(),
            perfil: s.perfil,
            materias: vivos(s.materias),
            temas: temasVivos(s.temas),
            progresos: vivosMapa(s.progresos),
            sesiones: s.sesiones,
            cantes: vivos(s.cantes),
            keypoints: vivos(s.keypoints),
            notas: vivos(s.notas),
            simulacros: vivos(s.simulacros),
            vueltas: vivos(s.vueltas),
          },
          null,
          2,
        );
      },

      importar: (json) => {
        try {
          const bruto = JSON.parse(json);
          if (!bruto || typeof bruto !== "object" || !Array.isArray(bruto.temas)) {
            return { ok: false, error: "El archivo no tiene el formato esperado." };
          }
          // Una copia exportada antes de la v2 trae ids que no son uuid.
          // Pasa por la misma migración que el expediente de IndexedDB: si
          // no, el import reintroduciría el problema que ella arregla. No
          // basta con mirar `version`: un fichero editado a mano puede
          // mentir, y los ids no.
          const anticuado =
            (bruto.version ?? 1) < 2 ||
            bruto.temas.some((t: { id?: string }) => !esUuid(t?.id));
          // Y una copia anterior a la v3 no trae relojes. Pasa también por
          // esa migración: sin `actualizado` la fila no se puede empujar y
          // habría que inventarle uno al vuelo en cada push.
          const d = migrarARelojes(
            anticuado
              ? migrarAUuid(bruto as ExpedienteV1).estado
              : (bruto as ExpedienteV2),
          );
          const importado: Expediente = {
            perfil: { ...PERFIL_INICIAL, ...(d.perfil ?? {}) },
            materias:
              Array.isArray(d.materias) && d.materias.length
                ? d.materias
                : materiasIniciales(),
            temas: d.temas ?? [],
            progresos: d.progresos ?? {},
            sesiones: d.sesiones ?? [],
            cantes: d.cantes ?? [],
            keypoints: d.keypoints ?? [],
            notas: d.notas ?? [],
            simulacros: d.simulacros ?? [],
            vueltas: d.vueltas ?? [],
          };
          const ahora = Date.now();
          set((s) => ({
            ...importado,
            // Un expediente importado es tan local como el que había: hay
            // que subirlo entero. Cada fila conserva su reloj, así que es
            // el arbitraje —y no el orden de los acontecimientos— el que
            // decide si gana lo importado o lo que ya hubiera en la nube.
            cola: haySupabase()
              ? {
                  ...encolarTodo(importado, {}, ahora),
                  [claveCola("perfiles", ID_PERFIL)]: ahora,
                }
              : {},
            sincro: { ...s.sincro, perfilActualizado: ahora },
          }));
          return { ok: true };
        } catch (e) {
          return { ok: false, error: (e as Error).message };
        }
      },

      // Borra este navegador, no la cuenta: el cliente nunca hace DELETE y
      // aquí no se entierra nada, así que lo que esté en la nube sigue ahí.
      // Por eso se reinician también las marcas: la próxima sincronización
      // vuelve a ser una primera, con su pull completo y su reconciliación
      // de materias sembradas, y el expediente baja otra vez entero.
      borrarTodo: () =>
        set({
          ...ESTADO_INICIAL,
          hidratado: true,
          materias: materiasIniciales(),
          cola: {},
          sincro: MARCAS_INICIALES,
        }),
    }),
    {
      name: "opos-notaria",
      version: 3,
      storage: createJSONStorage(() => idbStorage),
      // v1 → v2: ids a uuid, referencias reescritas, `Materia.orden`,
      // timestamps de los epígrafes y registros de vuelta.
      // v2 → v3: `actualizado` en todas las entidades mutables y las tumbas
      // de epígrafe plegadas dentro del tema. Ver lib/store/migraciones.ts,
      // donde está el porqué de cada valor elegido.
      migrate: (guardado, version) => {
        let estado = guardado as ExpedienteV2;
        if (version < 2) {
          const migrado = migrarAUuid(guardado as ExpedienteV1);
          estado = migrado.estado;
          // El mapa `idViejo → uuid` se guarda aparte y sin bloquear la
          // migración: si algo sale mal, es lo único que permite reconstruir
          // a mano un expediente reescrito.
          void idbStorage.setItem(
            "opos-notaria:mapa-uuid",
            JSON.stringify({ fecha: Date.now(), mapa: migrado.mapa }),
          );
        }
        return migrarARelojes(estado) as unknown as Store;
      },
      partialize: (s) => {
        const { hidratado, ...resto } = s as Estado;
        return resto as Estado;
      },
      // Marcamos la hidratación con setState (mutar el objeto recibido no
      // dispara re-render). Se llama tanto si había datos como si no.
      onRehydrateStorage: () => () => {
        useStore.setState({ hidratado: true });
      },
    },
  ),
);

/**
 * TODA escritura de entidades sincronizables del store pasa por aquí.
 *
 * `sellar` compara el parcial con el estado anterior y avanza `actualizado`
 * en las filas cuyo contenido ha cambiado. Es la única forma de que no se
 * escape ninguna: hay más de treinta acciones, y ponerlo a mano en cada una
 * es cuestión de tiempo que se olvide en alguna; esa modificación no
 * viajaría nunca, porque el servidor la vería más vieja que la suya y la
 * descartaría sin dar error.
 *
 * Regla: en el store no se llama a `set` a pelo salvo para lo que no es una
 * entidad sincronizable (el cronómetro, el chat, el flag de hidratación) o
 * para reemplazar el expediente entero (importar, borrar todo).
 */
function escribir(
  mutador: Partial<Estado> | ((s: Estado) => Partial<Estado>),
): void {
  useStore.setState((s) => {
    // El reloj corregido con el desfase medido contra el servidor
    // (lib/sync/reloj.ts). Es el mismo instante para el sello y para la cola:
    // el del perfil sale de aquí y también arbitra.
    const ahora = ahoraSellado(s.sincro);
    const sellado = sellar(s, typeof mutador === "function" ? mutador(s) : mutador, ahora);
    // Y aquí mismo, por la misma razón, se encola lo que ha cambiado: el
    // sellado sin la cola movería el reloj de una fila que no viaja, que es
    // la mitad exacta del problema. Una acción nueva no tiene que acordarse
    // de nada; una COLECCIÓN nueva sí, y por eso las dos listas —la del
    // sellado y la de la cola— están cada una en un único sitio.
    //
    // Sin Supabase configurado no se encola nada: la app funciona entera en
    // local y no tiene sentido llevar la cuenta de una cola que nadie va a
    // vaciar. Cuando se conecte una cuenta, la primera sincronización encola
    // el expediente entero de todas formas (lib/sync/motor.ts).
    if (!haySupabase()) return sellado;
    const salida = cambiosDe(s, sellado, s.cola, ahora);
    if (salida.cola === s.cola) return sellado;
    return {
      ...sellado,
      cola: salida.cola,
      sincro: salida.perfilActualizado
        ? { ...s.sincro, perfilActualizado: salida.perfilActualizado }
        : s.sincro,
    };
  });
}

/* ============================================================
   Puerta del motor de sincronización

   El motor (lib/sync/motor.ts) no sabe nada de zustand: pide una
   instantánea y devuelve un cambio ya resuelto. Lo que entra por
   `aplicar()` viene del servidor o ya está arbitrado, así que NO pasa por
   `escribir()`: ni se sella —los relojes que traen las filas son los
   buenos— ni se encola, porque reencolar lo que acaba de bajar es la forma
   más rápida de montar un bucle entre dos dispositivos.
   ============================================================ */

export function almacenSync(): Almacen {
  return {
    leer() {
      const s = useStore.getState();
      return { expediente: expedienteDe(s), cola: s.cola, marcas: s.sincro };
    },
    aplicar(cambio: CambioSync) {
      useStore.setState((s) => {
        const parcial: Partial<Estado> = { ...(cambio.expediente as Partial<Estado>) };
        if (cambio.cola) parcial.cola = cambio.cola;
        if (cambio.marcas) parcial.sincro = { ...s.sincro, ...cambio.marcas };
        return parcial;
      });
    },
  };
}

function expedienteDe(s: Estado): Expediente {
  return {
    perfil: s.perfil,
    materias: s.materias,
    temas: s.temas,
    progresos: s.progresos,
    sesiones: s.sesiones,
    cantes: s.cantes,
    keypoints: s.keypoints,
    notas: s.notas,
    simulacros: s.simulacros,
    vueltas: s.vueltas,
  };
}

/** Selector con memoria estable para listas ordenadas de temas. */
export function temasOrdenados(temas: Tema[], materias: Materia[]): Tema[] {
  // El orden lo manda `Materia.orden`, no la posición en el array: es lo
  // único que sobrevive a un viaje por la tabla de materias.
  const orden = new Map(materias.map((m) => [m.id, m.orden ?? 0]));
  return [...temas].sort((a, b) => {
    const oa = orden.get(a.materiaId) ?? 99;
    const ob = orden.get(b.materiaId) ?? 99;
    if (oa !== ob) return oa - ob;
    return a.numero - b.numero;
  });
}

/**
 * Progresos con los contadores derivados de las colecciones append-only.
 * Úsalo en lugar de `useStore((s) => s.progresos)` en todo lo que se pinte.
 *
 * Cada `useStore` devuelve una referencia estable del estado y el cálculo
 * va en un `useMemo`: derivar dentro del selector crearía un objeto nuevo
 * en cada render y con él el bucle infinito de siempre.
 */
export function useProgresos(): Record<string, ProgresoTema> {
  const progresos = useStore((s) => s.progresos);
  const sesiones = useStore((s) => s.sesiones);
  const cantes = useStore((s) => s.cantes);
  const vueltas = useStore((s) => s.vueltas);
  return React.useMemo(
    () => derivarProgresos(progresos, sesiones, cantes, vueltas),
    [progresos, sesiones, cantes, vueltas],
  );
}

/** Igual, pero fuera de React (contexto de IA, acciones puntuales). */
export function progresosDerivados(): Record<string, ProgresoTema> {
  const s = useStore.getState();
  return derivarProgresos(s.progresos, s.sesiones, s.cantes, s.vueltas);
}

/* ============================================================
   Lecturas

   Ninguna página lee las colecciones del store en crudo: ahí están las
   tumbas del borrado lógico, y una sola lectura sin filtrar le pinta al
   opositor un tema fantasma. Estos hooks son la puerta, y detrás está el
   único filtro de verdad (lib/data/vivos.ts).

   Los selectores son constantes de módulo y devuelven referencias
   estables —`vivos()` memoriza por identidad del array— porque Zustand
   compara por identidad: derivar un array nuevo dentro del selector es lo
   que provocó el bucle infinito de renders (React #185) que está
   documentado en app/cante/vivo/page.tsx.
   ============================================================ */

const selMaterias = (s: Store) => vivos(s.materias);
const selTemas = (s: Store) => temasVivos(s.temas);
const selCantes = (s: Store) => vivos(s.cantes);
const selKeypoints = (s: Store) => vivos(s.keypoints);
const selNotas = (s: Store) => vivos(s.notas);
const selSimulacros = (s: Store) => vivos(s.simulacros);
const selSesiones = (s: Store) => s.sesiones;

export const useMaterias = () => useStore(selMaterias);
/** Temas vivos, y dentro de cada uno solo sus epígrafes vivos. */
export const useTemas = () => useStore(selTemas);
export const useCantes = () => useStore(selCantes);
export const useKeyPoints = () => useStore(selKeypoints);
export const useNotas = () => useStore(selNotas);
export const useSimulacros = () => useStore(selSimulacros);
/**
 * Las sesiones no tienen tumba y no se cascadean: las horas que el opositor
 * le echó a un tema son suyas aunque luego borre el tema del programa.
 * Existe como hook solo para que nadie tenga que pensar si esta colección
 * era de las que se filtran.
 */
export const useSesiones = () => useStore(selSesiones);

/** El tema vivo con ese id, o undefined si no está o está borrado. */
export function useTema(id: string | undefined): Tema | undefined {
  return useStore(
    React.useCallback(
      (s: Store) => (id ? temasVivos(s.temas).find((t) => t.id === id) : undefined),
      [id],
    ),
  );
}

/** Las mismas lecturas fuera de React (contexto de IA, acciones sueltas). */
export function estadoVivo() {
  const s = useStore.getState();
  return {
    perfil: s.perfil,
    materias: vivos(s.materias),
    temas: temasVivos(s.temas),
    progresos: vivosMapa(s.progresos),
    sesiones: s.sesiones,
    cantes: vivos(s.cantes),
    keypoints: vivos(s.keypoints),
    notas: vivos(s.notas),
    simulacros: vivos(s.simulacros),
    vueltas: vivos(s.vueltas),
  };
}
