"use client";

import * as React from "react";
import { progresosDerivados, useStore } from "../store/store";
import { construirFicha } from "./contexto";

/**
 * Resuelve a donde van las llamadas de IA.
 *
 * Las respuestas del modelo tardan entre 60 y 180 s. Las funciones
 * serverless de Netlify cortan a los 10-30 s y **ignoran** el `maxDuration`
 * de Next, asi que ahi las rutas largas no pueden vivir.
 *
 * Solucion: el mismo build desplegado tambien en Railway (contenedor de
 * larga vida, sin tope por peticion) y `NEXT_PUBLIC_IA_URL` apuntando a el.
 * Si la variable no esta, se llama al propio origen: asi en local y en un
 * despliegue solo-Railway todo funciona sin tocar nada.
 */
export function rutaIA(ruta: string): string {
  const base = process.env.NEXT_PUBLIC_IA_URL?.replace(/\/+$/, "");
  return base ? `${base}${ruta}` : ruta;
}

/** ¿Hay clave de API configurada en el servidor? */
export function useIA() {
  const [estado, setEstado] = React.useState<{
    cargando: boolean;
    disponible: boolean;
    modelo: string;
  }>({ cargando: true, disponible: false, modelo: "" });

  React.useEffect(() => {
    let vivo = true;
    fetch(rutaIA("/api/ai/estado"))
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
      // Derivados: la ficha que lee el modelo dice las horas reales.
      progresos: progresosDerivados(),
      sesiones: s.sesiones,
      cantes: s.cantes,
    });
  }, []);
}
