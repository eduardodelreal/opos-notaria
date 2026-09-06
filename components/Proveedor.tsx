"use client";

import * as React from "react";
import { useStore } from "@/lib/store/store";
import {
  CLAVES_APARIENCIA,
  TONOS,
  apariencia,
  type Apariencia,
} from "@/lib/data/apariencia";

/**
 * Clase del tono + la de densidad. Es la lista que hay que limpiar antes de
 * volver a pintar, y la misma que conoce el guion antiparpadeo de
 * app/layout.tsx: si crece, hay que tocar los dos sitios (y solo esos dos).
 */
const CLASES_APARIENCIA = [...TONOS.map((t) => t.clase).filter(Boolean), "compacta"];

/** Dónde deja el estado visual para que el guion del `head` lo replique. */
export const CLAVE_APARIENCIA = "opos-apariencia";

/**
 * Aplica el aspecto elegido y espera a que IndexedDB hidrate el store antes
 * de pintar. Sin lo segundo se ve un flash de "no tienes temas" en cada
 * recarga.
 *
 * Lo visual se escribe sobre `<html>`, no sobre un contenedor: el fondo, la
 * viñeta y la barra del navegador cuelgan de ahí, y meterlo en un div
 * dejaría los bordes de la pantalla con el tono anterior.
 */
export function Proveedor({ children }: { children: React.ReactNode }) {
  const hidratado = useStore((s) => s.hidratado);
  // El perfil entero, no campo a campo: `apariencia()` mira seis de sus
  // campos y la referencia que devuelve el store es estable (no se deriva
  // nada dentro del selector, que es el bucle infinito de siempre).
  const perfil = useStore((s) => s.perfil);
  const aspecto = React.useMemo(() => apariencia(perfil), [perfil]);

  // Red de seguridad: si IndexedDB está bloqueado (modo incógnito estricto,
  // políticas del navegador) la hidratación nunca resuelve. Antes que dejar
  // al opositor mirando un spinner, arrancamos en memoria.
  React.useEffect(() => {
    if (hidratado) return;
    const id = setTimeout(() => useStore.setState({ hidratado: true }), 3000);
    return () => clearTimeout(id);
  }, [hidratado]);

  React.useEffect(() => {
    aplicarApariencia(aspecto);
    try {
      // El guion antiparpadeo lo lee TAL CUAL, sin recalcular nada: el
      // cálculo de color vive en un único sitio (lib/data/apariencia.ts) y
      // en el `head` solo se copian pares clave/valor. Por eso se guarda el
      // resultado y no el perfil.
      localStorage.setItem(CLAVE_APARIENCIA, JSON.stringify(aspecto));
      // Se sigue escribiendo la clave vieja: una pestaña con la versión
      // anterior de la app cargada en caché sigue sabiendo leerla.
      localStorage.setItem("opos-tema", perfil.tema);
    } catch {
      /* modo incógnito: la apariencia simplemente no se recuerda */
    }
  }, [aspecto, perfil.tema]);

  if (!hidratado) {
    return (
      <div className="fixed inset-0 grid place-items-center">
        <div className="flex flex-col items-center gap-4">
          <div
            className="size-9 rounded-full border-2 border-[var(--border)] animate-spin-slow"
            style={{ borderTopColor: "var(--laton)" }}
          />
          <p className="text-[13px] text-subtle tracking-wide">
            Abriendo tu expediente
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

/** Escribe el aspecto en `<html>`. Idempotente: se puede llamar cada render. */
export function aplicarApariencia(a: Apariencia): void {
  const html = document.documentElement;
  for (const c of CLASES_APARIENCIA) html.classList.toggle(c, a.clases.includes(c));
  // Se limpian TODAS las claves conocidas antes de escribir: si no, volver
  // del acento personal al de la casa dejaría el color anterior pegado en
  // el atributo `style` para siempre.
  for (const k of CLAVES_APARIENCIA) html.style.removeProperty(k);
  for (const [k, v] of Object.entries(a.vars)) html.style.setProperty(k, v);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", a.themeColor);
}
