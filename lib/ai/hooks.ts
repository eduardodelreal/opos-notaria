"use client";

import * as React from "react";
import { useStore } from "../store/store";
import { construirFicha } from "./contexto";

/** ¿Hay clave de API configurada en el servidor? */
export function useIA() {
  const [estado, setEstado] = React.useState<{
    cargando: boolean;
    disponible: boolean;
    modelo: string;
  }>({ cargando: true, disponible: false, modelo: "" });

  React.useEffect(() => {
    let vivo = true;
    fetch("/api/ai/estado")
      .then((r) => r.json())
      .then((d) => {
        if (vivo) setEstado({ cargando: false, disponible: !!d.disponible, modelo: d.modelo });
      })
      .catch(() => vivo && setEstado({ cargando: false, disponible: false, modelo: "" }));
    return () => {
      vivo = false;
    };
  }, []);

  return estado;
}

/**
 * Construye la ficha del opositor bajo demanda.
 * No se memoriza en render: se llama justo antes de mandar la petición,
 * así siempre viaja el estado del segundo actual.
 */
export function useFicha() {
  return React.useCallback(() => {
    const s = useStore.getState();
    return construirFicha({
      perfil: s.perfil,
      materias: s.materias,
      temas: s.temas,
      progresos: s.progresos,
      sesiones: s.sesiones,
      cantes: s.cantes,
    });
  }, []);
}
