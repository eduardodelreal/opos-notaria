"use client";

import * as React from "react";
import { estadoVivo, progresosDerivados } from "../store/store";
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

export interface EstadoIA {
  cargando: boolean;
  /** ¿Hay ANTHROPIC_API_KEY en el servidor? */
  disponible: boolean;
  modelo: string;
  /**
   * ¿Hay servicio de transcripción? Es OTRO proveedor: la API de Anthropic
   * no acepta audio (lib/ai/transcripcion.ts), así que se configura aparte
   * y puede faltar aunque el resto de la IA funcione.
   */
  transcripcion: boolean;
  motorTranscripcion: string;
}

const IA_APAGADA: EstadoIA = {
  cargando: false,
  disponible: false,
  modelo: "",
  transcripcion: false,
  motorTranscripcion: "",
};

/** Qué funciones de IA tiene encendidas esta instalación. */
export function useIA(): EstadoIA {
  const [estado, setEstado] = React.useState<EstadoIA>({
    ...IA_APAGADA,
    cargando: true,
  });

  React.useEffect(() => {
    let vivo = true;
    fetch(rutaIA("/api/ai/estado"))
      .then((r) => r.json())
      .then((d) => {
        if (!vivo) return;
        setEstado({
          cargando: false,
          disponible: !!d.disponible,
          modelo: d.modelo ?? "",
          transcripcion: !!d.transcripcion,
          motorTranscripcion: d.motorTranscripcion ?? "",
        });
      })
      .catch(() => vivo && setEstado(IA_APAGADA));
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
    // `estadoVivo()` en vez del estado crudo: al modelo no se le cuentan
    // temas ni cantes borrados, o el diagnóstico hablaría de un temario que
    // el opositor ya no tiene.
    const s = estadoVivo();
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
