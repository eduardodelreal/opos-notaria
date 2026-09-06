"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { idbStorage } from "./persist";
import { MATERIAS } from "../data/materias";
import { uid, slug } from "../utils/id";
import { calcularProximoRepaso } from "../data/srs";
import type {
  AnalisisCante,
  Cante,
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
  progresos: Record<string, ProgresoTema>;
  sesiones: Sesion[];
  cantes: Cante[];
  keypoints: KeyPoint[];
  notas: Nota[];
  simulacros: Simulacro[];
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
  materias: MATERIAS,
  temas: [],
  progresos: {},
  sesiones: [],
  cantes: [],
  keypoints: [],
  notas: [],
  simulacros: [],
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
        const existentes = new Set(get().materias.map((m) => m.id));
        let id = slug(nombre) || uid("mat");
        while (existentes.has(id)) id = `${id}-${Math.floor(Math.random() * 90 + 10)}`;
        const materia: Materia = {
          id,
          nombre: nombre.trim(),
          abrev: abrev.trim().toUpperCase().slice(0, 4) || id.slice(0, 3).toUpperCase(),
          color,
          ejercicio: 1,
          descripcion: "",
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
          };
        }),

      /* ---------------- temas ---------------- */

      addTema: (materiaId, numero, titulo) => {
        const tema: Tema = {
          id: uid("tem"),
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
            id: uid("tem"),
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
          };
        }),

      setEpigrafes: (temaId, epigrafes) =>
        set((s) => ({
          temas: s.temas.map((t) => (t.id === temaId ? { ...t, epigrafes } : t)),
        })),

      addEpigrafe: (temaId, titulo, texto) =>
        set((s) => ({
          temas: s.temas.map((t) =>
            t.id === temaId
              ? {
                  ...t,
                  epigrafes: [
                    ...t.epigrafes,
                    {
                      id: uid("epi"),
                      orden: t.epigrafes.length + 1,
                      titulo: titulo.trim(),
                      texto,
                    },
                  ],
                }
              : t,
          ),
        })),

      updateEpigrafe: (temaId, epigrafeId, parcial) =>
        set((s) => ({
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

      removeEpigrafe: (temaId, epigrafeId) =>
        set((s) => ({
          temas: s.temas.map((t) =>
            t.id === temaId
              ? {
                  ...t,
                  epigrafes: t.epigrafes
                    .filter((e) => e.id !== epigrafeId)
                    .map((e, i) => ({ ...e, orden: i + 1 })),
                }
              : t,
          ),
        })),

      /* ---------------- progreso ---------------- */

      progresoDe: (temaId) => get().progresos[temaId] ?? progresoVacio(temaId),

      setEstado: (temaId, estado) =>
        set((s) => {
          const previo = s.progresos[temaId] ?? progresoVacio(temaId);
          const siguiente = conSRS({
            ...previo,
            estado,
            // Marcar un tema como dominado cierra vuelta.
            vueltas:
              estado === "dominado" && previo.estado !== "dominado"
                ? previo.vueltas + 1
                : previo.vueltas,
          });
          return { progresos: { ...s.progresos, [temaId]: siguiente } };
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
          id: uid("ses"),
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
          id: uid("can"),
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
            id: uid("ses"),
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
              id: uid("kp"),
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
              id: uid("not"),
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
        const simulacro: Simulacro = { ...s0, id: uid("sim") };
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
        const mensaje: MensajeChat = { ...m, id: uid("msg"), creado: Date.now() };
        set((s) => ({ chat: [...s.chat, mensaje] }));
        return mensaje;
      },

      limpiarChat: () => set({ chat: [] }),

      /* ---------------- datos ---------------- */

      exportar: () => {
        const s = get();
        return JSON.stringify(
          {
            version: 1,
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
          },
          null,
          2,
        );
      },

      importar: (json) => {
        try {
          const d = JSON.parse(json);
          if (!d || typeof d !== "object" || !Array.isArray(d.temas)) {
            return { ok: false, error: "El archivo no tiene el formato esperado." };
          }
          set({
            perfil: { ...PERFIL_INICIAL, ...(d.perfil ?? {}) },
            materias: Array.isArray(d.materias) && d.materias.length ? d.materias : MATERIAS,
            temas: d.temas ?? [],
            progresos: d.progresos ?? {},
            sesiones: d.sesiones ?? [],
            cantes: d.cantes ?? [],
            keypoints: d.keypoints ?? [],
            notas: d.notas ?? [],
            simulacros: d.simulacros ?? [],
          });
          return { ok: true };
        } catch (e) {
          return { ok: false, error: (e as Error).message };
        }
      },

      borrarTodo: () =>
        set({ ...ESTADO_INICIAL, hidratado: true, materias: MATERIAS }),
    }),
    {
      name: "opos-notaria",
      version: 1,
      storage: createJSONStorage(() => idbStorage),
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
  const orden = new Map(materias.map((m, i) => [m.id, i]));
  return [...temas].sort((a, b) => {
    const oa = orden.get(a.materiaId) ?? 99;
    const ob = orden.get(b.materiaId) ?? 99;
    if (oa !== ob) return oa - ob;
    return a.numero - b.numero;
  });
}
