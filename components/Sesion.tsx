"use client";

import * as React from "react";
import type { User } from "@supabase/supabase-js";
import { clienteNavegador } from "@/lib/supabase/navegador";

export type EstadoSesion = {
  /** ¿Tiene esta instalación credenciales de Supabase? */
  configurado: boolean;
  /** Todavía no sabemos si hay sesión o no. */
  cargando: boolean;
  usuario: User | null;
};

const INICIAL: EstadoSesion = {
  configurado: false,
  cargando: true,
  usuario: null,
};

const Contexto = React.createContext<EstadoSesion>(INICIAL);

/**
 * Mantiene al día quién ha iniciado sesión.
 *
 * Sin Supabase configurado se resuelve al instante en `{ configurado: false }`
 * y no hace ni una petición: la app entera sigue funcionando en local.
 */
export function ProveedorSesion({ children }: { children: React.ReactNode }) {
  const [estado, setEstado] = React.useState<EstadoSesion>(INICIAL);

  React.useEffect(() => {
    const supabase = clienteNavegador();
    if (!supabase) {
      setEstado({ configurado: false, cargando: false, usuario: null });
      return;
    }

    let vivo = true;

    // `onAuthStateChange` emite INITIAL_SESSION nada más suscribirse, así que
    // esto sirve a la vez de lectura inicial y de escucha de cambios (entrar,
    // salir, refresco de token, otra pestaña).
    const { data } = supabase.auth.onAuthStateChange((_evento, sesion) => {
      if (vivo)
        setEstado({
          configurado: true,
          cargando: false,
          usuario: sesion?.user ?? null,
        });
    });

    // Red de seguridad, igual que la hidratación del store: si Supabase no
    // contesta, seguimos como "sin sesión" en vez de quedarnos cargando.
    const reloj = setTimeout(
      () =>
        vivo &&
        setEstado((e) => (e.cargando ? { ...e, configurado: true, cargando: false } : e)),
      4000,
    );

    return () => {
      vivo = false;
      clearTimeout(reloj);
      data.subscription.unsubscribe();
    };
  }, []);

  return <Contexto.Provider value={estado}>{children}</Contexto.Provider>;
}

/** El usuario actual y si esta instalación tiene cuentas siquiera. */
export function useSesion(): EstadoSesion {
  return React.useContext(Contexto);
}

/** Cómo llamar al usuario en la interfaz: su nombre si lo dio, si no el correo. */
export function nombreVisible(usuario: User | null): string {
  if (!usuario) return "";
  const meta = usuario.user_metadata ?? {};
  const nombre = (meta.nombre ?? meta.full_name ?? meta.name) as unknown;
  if (typeof nombre === "string" && nombre.trim()) return nombre.trim();
  return usuario.email ?? "Cuenta sin correo";
}
