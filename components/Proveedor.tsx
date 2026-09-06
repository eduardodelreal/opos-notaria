"use client";

import * as React from "react";
import { useStore } from "@/lib/store/store";

/**
 * Aplica el tema y espera a que IndexedDB hidrate el store antes de
 * pintar. Sin esto se ve un flash de "no tienes temas" en cada recarga.
 */
export function Proveedor({ children }: { children: React.ReactNode }) {
  const hidratado = useStore((s) => s.hidratado);
  const tema = useStore((s) => s.perfil.tema);

  // Red de seguridad: si IndexedDB está bloqueado (modo incógnito estricto,
  // políticas del navegador) la hidratación nunca resuelve. Antes que dejar
  // al opositor mirando un spinner, arrancamos en memoria.
  React.useEffect(() => {
    if (hidratado) return;
    const id = setTimeout(() => useStore.setState({ hidratado: true }), 3000);
    return () => clearTimeout(id);
  }, [hidratado]);

  React.useEffect(() => {
    document.documentElement.classList.toggle("light", tema === "light");
    try {
      localStorage.setItem("opos-tema", tema);
    } catch {
      /* modo incógnito: el tema simplemente no se recuerda */
    }
  }, [tema]);

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
