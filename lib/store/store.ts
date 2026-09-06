"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import * as React from "react";
import { idbStorage } from "./persist";
import { materiasIniciales } from "../data/materias";
import { esUuid, uid } from "../utils/id";
import { calcularProximoRepaso } from "../data/srs";
import {
  derivarProgresos,
  notaMediaDeTema,
  segundosDeTema,
  vueltasDeTema,
} from "../data/derivados";
import { migrarAUuid, type ExpedienteV1 } from "./migraciones";
import type {
  AnalisisCante,
  Cante,
  CanteEpigrafe,
  Epigrafe,
  EpigrafeBorrado,
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
  Vuelta,
} from "../data/types";

const PERFIL_INICIAL: Perfil = {
  nombre: "",
  oposicion: "notarias",
  fechaInicio: Date.now(),
  objetivoHorasSemana: 45,
  minutosPorTema: 10,
  diasOxido: 45,
  tema: "dark",
  estiloFeedback: "directo",
};

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
  /** Tumbas de epígrafes borrados, para que el borrado pueda viajar. */
  epigrafesBorrados: EpigrafeBorrado[];
  chat: MensajeChat[];
  crono: CronoActivo | null;
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
    cante: Omit<Cante, "id" | "fecha"> & { fecha?: number },
  ) => Cante;
  updateCante: (id: string, parcial: Partial<Cante>) => void;
  setAnalisisCante: (id: string, analisis: AnalisisCante) => void;
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
  addSimulacro: (s: Omit<Simulacro, "id">) => Simulacro;
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
  epigrafesBorrados: [],
  chat: [],
  crono: null,
};

function progresoVacio(temaId: string): ProgresoTema {
  return {
    temaId,
    estado: "nuevo",
    segundos: 0,
    dificultad: 3,
    vueltas: 0,
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

      setPerfil: (parcial) =>
        set((s) => ({ perfil: { ...s.perfil, ...parcial } })),

      alternarTema: () =>
        set((s) => ({
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
          orden: get().materias.reduce((max, m) => Math.max(max, m.orden), -1) + 1,
        };
        set((s) => ({ materias: [...s.materias, materia] }));
        return materia;
      },

      updateMateria: (id, parcial) =>
        set((s) => ({
          materias: s.materias.map((m) => (m.id === id ? { ...m, ...parcial } : m)),
        })),

      removeMateria: (id) =>
        set((s) => {
          const temasFuera = s.temas.filter((t) => t.materiaId === id);
          const idsFuera = new Set(temasFuera.map((t) => t.id));
          const progresos = { ...s.progresos };
          for (const tid of idsFuera) delete progresos[tid];
          return {
            materias: s.materias.filter((m) => m.id !== id),
            temas: s.temas.filter((t) => t.materiaId !== id),
            progresos,
            cantes: s.cantes.filter((c) => !idsFuera.has(c.temaId)),
            keypoints: s.keypoints.filter((k) => !idsFuera.has(k.temaId)),
            notas: s.notas.filter((n) => !idsFuera.has(n.temaId)),
            vueltas: s.vueltas.filter((v) => !idsFuera.has(v.temaId)),
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
        };
        set((s) => ({
          temas: [...s.temas, tema],
          progresos: { ...s.progresos, [tema.id]: progresoVacio(tema.id) },
        }));
        return tema;
      },

      addTemasMasivo: (materiaId, filas) => {
        const nuevos: Tema[] = [];
        const progresos: Record<string, ProgresoTema> = {};
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
          };
          nuevos.push(tema);
          progresos[tema.id] = progresoVacio(tema.id);
        }
        set((s) => ({
          temas: [...s.temas, ...nuevos],
          progresos: { ...s.progresos, ...progresos },
        }));
        return nuevos.length;
      },

      updateTema: (id, parcial) =>
        set((s) => ({
          temas: s.temas.map((t) => (t.id === id ? { ...t, ...parcial } : t)),
        })),

      removeTema: (id) =>
        set((s) => {
          const progresos = { ...s.progresos };
          delete progresos[id];
          return {
            temas: s.temas.filter((t) => t.id !== id),
            progresos,
            cantes: s.cantes.filter((c) => c.temaId !== id),
            keypoints: s.keypoints.filter((k) => k.temaId !== id),
            notas: s.notas.filter((n) => n.temaId !== id),
            vueltas: s.vueltas.filter((v) => v.temaId !== id),
          };
        }),

      // El array de epígrafes es una comodidad de la UI; en el servidor cada
      // epígrafe es una fila con su propio reloj. Por eso esto no sustituye
      // el array a ciegas: compara con lo que había para distinguir qué se
      // creó, qué cambió (y solo entonces avanza `actualizado`) y qué se
      // borró, que es lo único que la sincronización sabrá convertir en
      // altas, updates y tumbas.
      setEpigrafes: (temaId, epigrafes) =>
        set((s) => {
          const tema = s.temas.find((t) => t.id === temaId);
          if (!tema) return {};
          const ahora = Date.now();
          const previos = new Map(tema.epigrafes.map((e) => [e.id, e]));

          const siguientes: Epigrafe[] = epigrafes.map((e, i) => {
            const orden = i + 1;
            const previo = previos.get(e.id);
            if (!previo) {
              return { ...e, orden, creado: e.creado ?? ahora, actualizado: ahora };
            }
            const igual =
              previo.titulo === e.titulo &&
              previo.texto === e.texto &&
              previo.orden === orden;
            return {
              ...previo,
              ...e,
              orden,
              creado: previo.creado,
              actualizado: igual ? previo.actualizado : ahora,
            };
          });

          const vivos = new Set(siguientes.map((e) => e.id));
          const tumbas = tema.epigrafes
            .filter((e) => !vivos.has(e.id))
            .map((e) => ({ id: e.id, temaId, borrado: ahora }));

          return {
            temas: s.temas.map((t) =>
              t.id === temaId ? { ...t, epigrafes: siguientes } : t,
            ),
            epigrafesBorrados: tumbas.length
              ? [...s.epigrafesBorrados, ...tumbas]
              : s.epigrafesBorrados,
          };
        }),

      addEpigrafe: (temaId, titulo, texto) =>
        set((s) => {
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
                        orden: t.epigrafes.length + 1,
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
        set((s) => ({
          temas: s.temas.map((t) =>
            t.id === temaId
              ? {
                  ...t,
                  epigrafes: t.epigrafes.map((e) =>
                    e.id === epigrafeId
                      ? { ...e, ...parcial, actualizado: Date.now() }
                      : e,
                  ),
                }
              : t,
          ),
        })),

      // Renumerar deja constancia: cada epígrafe que cambia de posición es
      // una fila más que tendrá que subir, no solo la que desaparece.
      removeEpigrafe: (temaId, epigrafeId) =>
        set((s) => {
          const ahora = Date.now();
          return {
            temas: s.temas.map((t) =>
              t.id === temaId
                ? {
                    ...t,
                    epigrafes: t.epigrafes
                      .filter((e) => e.id !== epigrafeId)
                      .map((e, i) =>
                        e.orden === i + 1
                          ? e
                          : { ...e, orden: i + 1, actualizado: ahora },
                      ),
                  }
                : t,
            ),
            epigrafesBorrados: [
              ...s.epigrafesBorrados,
              { id: epigrafeId, temaId, borrado: ahora },
            ],
          };
        }),

      /* ---------------- progreso ---------------- */

      // Devuelve el progreso ya derivado: nadie que pregunte por el progreso
      // de un tema debería recibir los contadores en caché.
      progresoDe: (temaId) => {
        const s = get();
        const previo = s.progresos[temaId] ?? progresoVacio(temaId);
        return {
          ...previo,
          segundos: segundosDeTema(temaId, s.sesiones),
          notaMedia: notaMediaDeTema(temaId, s.cantes),
          vueltas: vueltasDeTema(temaId, s.vueltas),
        };
      },

      setEstado: (temaId, estado) =>
        set((s) => {
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
              ? [...s.vueltas, { id: uid(), temaId, fecha: Date.now() }]
              : s.vueltas,
          };
        }),

      setDificultad: (temaId, dificultad) =>
        set((s) => {
          const previo = s.progresos[temaId] ?? progresoVacio(temaId);
          return {
            progresos: {
              ...s.progresos,
              [temaId]: conSRS({ ...previo, dificultad }),
            },
          };
        }),

      alternarFavorito: (temaId) =>
        set((s) => {
          const previo = s.progresos[temaId] ?? progresoVacio(temaId);
          return {
            progresos: {
              ...s.progresos,
              [temaId]: { ...previo, favorito: !previo.favorito },
            },
          };
        }),

      sumarVuelta: (temaId) =>
        set((s) => {
          const previo = s.progresos[temaId] ?? progresoVacio(temaId);
          return {
            progresos: {
              ...s.progresos,
              [temaId]: conSRS({ ...previo, vueltas: previo.vueltas + 1 }),
            },
            vueltas: [...s.vueltas, { id: uid(), temaId, fecha: Date.now() }],
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

        set((s) => {
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
        };

        set((s) => {
          const previo =
            s.progresos[cante.temaId] ?? progresoVacio(cante.temaId);
          const notasPrevias = s.cantes
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
        set((s) => ({
          cantes: s.cantes.map((c) => (c.id === id ? { ...c, ...parcial } : c)),
        })),

      setAnalisisCante: (id, analisis) =>
        set((s) => ({
          cantes: s.cantes.map((c) => (c.id === id ? { ...c, analisis } : c)),
        })),

      removeCante: (id) =>
        set((s) => ({ cantes: s.cantes.filter((c) => c.id !== id) })),

      cantesDe: (temaId) =>
        get()
          .cantes.filter((c) => c.temaId === temaId)
          .sort((a, b) => b.fecha - a.fecha),

      /* ---------------- keypoints ---------------- */

      addKeyPoint: (temaId, anverso, reverso, epigrafeId) =>
        set((s) => ({
          keypoints: [
            ...s.keypoints,
            {
              id: uid(),
              temaId,
              epigrafeId,
              anverso: anverso.trim(),
              reverso: reverso.trim(),
              creado: Date.now(),
              aciertos: 0,
              fallos: 0,
              intervaloDias: 1,
              proximoRepaso: Date.now(),
            },
          ],
        })),

      responderKeyPoint: (id, acierto) =>
        set((s) => ({
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
        set((s) => ({ keypoints: s.keypoints.filter((k) => k.id !== id) })),

      /* ---------------- notas ---------------- */

      addNota: (temaId, texto, epigrafeId) =>
        set((s) => ({
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
        set((s) => ({
          notas: s.notas.map((n) =>
            n.id === id ? { ...n, texto, actualizado: Date.now() } : n,
          ),
        })),

      removeNota: (id) =>
        set((s) => ({ notas: s.notas.filter((n) => n.id !== id) })),

      /* ---------------- simulacros ---------------- */

      addSimulacro: (s0) => {
        const simulacro: Simulacro = { ...s0, id: uid() };
        set((s) => ({ simulacros: [...s.simulacros, simulacro] }));
        return simulacro;
      },

      updateSimulacro: (id, parcial) =>
        set((s) => ({
          simulacros: s.simulacros.map((x) =>
            x.id === id ? { ...x, ...parcial } : x,
          ),
        })),

      removeSimulacro: (id) =>
        set((s) => ({ simulacros: s.simulacros.filter((x) => x.id !== id) })),

      /* ---------------- chat ---------------- */

      addMensaje: (m) => {
        const mensaje: MensajeChat = { ...m, id: uid(), creado: Date.now() };
        set((s) => ({ chat: [...s.chat, mensaje] }));
        return mensaje;
      },

      limpiarChat: () => set({ chat: [] }),

      /* ---------------- datos ---------------- */

      exportar: () => {
        const s = get();
        return JSON.stringify(
          {
            version: 2,
            exportado: new Date().toISOString(),
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
          const d = anticuado ? migrarAUuid(bruto as ExpedienteV1).estado : bruto;
          set({
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
            epigrafesBorrados: d.epigrafesBorrados ?? [],
          });
          return { ok: true };
        } catch (e) {
          return { ok: false, error: (e as Error).message };
        }
      },

      borrarTodo: () =>
        set({ ...ESTADO_INICIAL, hidratado: true, materias: materiasIniciales() }),
    }),
    {
      name: "opos-notaria",
      version: 2,
      storage: createJSONStorage(() => idbStorage),
      // v1 → v2: ids a uuid, referencias reescritas, `Materia.orden`,
      // timestamps de los epígrafes y registros de vuelta. Ver
      // lib/store/migraciones.ts, donde está el porqué de cada paso.
      migrate: (guardado, version) => {
        if (version >= 2) return guardado as Store;
        const { estado, mapa } = migrarAUuid(guardado as ExpedienteV1);
        // El mapa `idViejo → uuid` se guarda aparte y sin bloquear la
        // migración: si algo sale mal, es lo único que permite reconstruir
        // a mano un expediente reescrito.
        void idbStorage.setItem(
          "opos-notaria:mapa-uuid",
          JSON.stringify({ fecha: Date.now(), mapa }),
        );
        return estado as unknown as Store;
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
