"use client";

import * as React from "react";
import { estadoVivo, progresosDerivados } from "../store/store";
import { haySupabase } from "../supabase/config";
import { cabecerasAuth, clienteNavegador } from "../supabase/navegador";
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

/**
 * La ÚNICA forma de llamar a `/api/ai/*` desde el navegador.
 *
 * Antes cada pantalla hacía su `fetch(rutaIA(...))` a mano; ahora hay una
 * sola puerta, porque a la petición hay que añadirle algo que es fácil
 * olvidar en el quinto sitio: el **token de acceso de Supabase** en la
 * cabecera `Authorization`.
 *
 * Hace falta porque estas llamadas salen a OTRO dominio (la app en Netlify,
 * la API en Railway) y ahí el navegador no manda las cookies de sesión. Sin
 * la cabecera, el servidor no sabría quién llama y respondería 401.
 *
 * Si no hay sesión —o no hay Supabase— `cabecerasAuth()` devuelve `{}` y la
 * petición sale tal cual: en una instalación sin cuentas todo sigue igual.
 *
 * Devuelve la `Response` cruda a propósito, sin tocar el cuerpo: el chat va
 * en streaming y necesita leer `r.body` él mismo.
 */
export async function llamarIA(
  ruta: string,
  init: RequestInit = {},
): Promise<Response> {
  const auth = await cabecerasAuth();
  return fetch(rutaIA(ruta), {
    ...init,
    headers: { ...((init.headers as Record<string, string>) ?? {}), ...auth },
  });
}

/** `llamarIA` para el caso normal: un POST con cuerpo JSON. */
export async function pedirIA(
  ruta: string,
  cuerpo: unknown,
  init: RequestInit = {},
): Promise<Response> {
  return llamarIA(ruta, {
    ...init,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...((init.headers as Record<string, string>) ?? {}),
    },
    body: JSON.stringify(cuerpo),
  });
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
  /**
   * El servidor que atiende la IA tiene Supabase, así que sus rutas exigen
   * sesión. Lo dice ÉL, no esta pestaña: la web (Netlify) y la API
   * (Railway) son dos builds distintos y podrían no coincidir.
   */
  requiereSesion: boolean;
  /** Ese mismo servidor ha reconocido nuestra credencial. */
  sesion: boolean;
  /**
   * Hace falta iniciar sesión y no la hay. Derivado, para no repetir la
   * condición en cada pantalla.
   */
  bloqueado: boolean;
  /**
   * Se puede pulsar: hay clave de Anthropic y, si hace falta, sesión.
   * Sustituye a `disponible` en los `disabled` de los botones.
   */
  listo: boolean;
}

const IA_APAGADA: EstadoIA = {
  cargando: false,
  disponible: false,
  modelo: "",
  transcripcion: false,
  motorTranscripcion: "",
  requiereSesion: false,
  sesion: false,
  bloqueado: false,
  listo: false,
};

/** Qué funciones de IA tiene encendidas esta instalación. */
export function useIA(): EstadoIA {
  const [estado, setEstado] = React.useState<EstadoIA>({
    ...IA_APAGADA,
    cargando: true,
  });

  /**
   * El token con el que preguntar. `undefined` = todavía no sabemos si hay
   * sesión; en cuanto Supabase conteste (o si no hay Supabase, de entrada)
   * pasa a ser una cadena o `null` y se dispara la consulta.
   *
   * Se espera a saberlo antes de preguntar para no consultar dos veces por
   * montaje: primero sin credencial y luego con ella.
   */
  const [token, setToken] = React.useState<string | null | undefined>(() =>
    haySupabase() ? undefined : null,
  );

  React.useEffect(() => {
    const supabase = clienteNavegador();
    if (!supabase) return;

    // `onAuthStateChange` emite INITIAL_SESSION nada más suscribirse, así
    // que vale de lectura inicial y de escucha (entrar, salir, refresco).
    const { data } = supabase.auth.onAuthStateChange((_evento, sesion) =>
      setToken(sesion?.access_token ?? null),
    );

    // Red de seguridad, como en ProveedorSesion: si Supabase no contesta,
    // seguimos como "sin sesión" en vez de quedarnos cargando para siempre.
    const reloj = setTimeout(
      () => setToken((t) => (t === undefined ? null : t)),
      4000,
    );

    return () => {
      clearTimeout(reloj);
      data.subscription.unsubscribe();
    };
  }, []);

  React.useEffect(() => {
    if (token === undefined) return;

    let vivo = true;
    llamarIA("/api/ai/estado")
      .then((r) => r.json())
      .then((d) => {
        if (!vivo) return;
        const requiereSesion = !!d.requiereSesion;
        const sesion = !!d.sesion;
        const bloqueado = requiereSesion && !sesion;
        setEstado({
          cargando: false,
          disponible: !!d.disponible,
          modelo: d.modelo ?? "",
          transcripcion: !!d.transcripcion,
          motorTranscripcion: d.motorTranscripcion ?? "",
          requiereSesion,
          sesion,
          bloqueado,
          listo: !!d.disponible && !bloqueado,
        });
      })
      .catch(() => vivo && setEstado(IA_APAGADA));
    return () => {
      vivo = false;
    };
    // Al entrar o salir cambia el token y se vuelve a preguntar: así los
    // botones se encienden solos justo después de iniciar sesión.
  }, [token]);

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
