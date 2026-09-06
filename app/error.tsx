"use client";

import * as React from "react";
import Link from "next/link";
import { Download, RotateCcw } from "lucide-react";

/**
 * Límite de error de la app.
 *
 * Lo importante aquí no es el mensaje: es el botón de descargar la copia.
 * Si algo revienta, el opositor tiene años de expediente en IndexedDB y su
 * primer pensamiento va a ser "lo he perdido todo". Los datos siguen ahí,
 * así que le damos la vía para sacarlos antes de nada.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [descargando, setDescargando] = React.useState(false);
  const [resultado, setResultado] = React.useState<string | null>(null);

  const descargarCopia = async () => {
    setDescargando(true);
    try {
      // Leemos IndexedDB directamente: si el fallo viene del store, el store
      // no es de fiar para esto.
      const { get } = await import("idb-keyval");
      const crudo = await get("opos-notaria");
      if (!crudo) {
        setResultado("No hay ningún expediente guardado en este navegador.");
        return;
      }
      const blob = new Blob([typeof crudo === "string" ? crudo : JSON.stringify(crudo)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `opos-notaria-rescate-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setResultado("Copia descargada. Tus datos están a salvo.");
    } catch (e) {
      setResultado(`No se ha podido leer el expediente: ${(e as Error).message}`);
    } finally {
      setDescargando(false);
    }
  };

  return (
    <div className="min-h-[70vh] grid place-items-center px-6">
      <div className="max-w-lg w-full text-center">
        <h1 className="font-serif text-[28px] font-semibold tracking-[-0.02em]">
          Algo ha fallado
        </h1>
        <p className="text-[14px] text-muted mt-3 leading-relaxed">
          Ha habido un error en esta pantalla.{" "}
          <strong className="text-fg font-medium">
            Tu expediente no se ha perdido
          </strong>
          : sigue guardado en este navegador. Puedes reintentar, y si el fallo
          se repite, descarga una copia antes de tocar nada.
        </p>

        <div className="flex flex-wrap items-center justify-center gap-2.5 mt-8">
          <button
            onClick={reset}
            className="inline-flex items-center gap-2 h-10 px-4 rounded-[10px] border border-transparent bg-[var(--lacre)] text-white text-sm font-medium hover:bg-[var(--lacre-bright)] transition-colors"
          >
            <RotateCcw className="size-4" />
            Reintentar
          </button>
          <button
            onClick={descargarCopia}
            disabled={descargando}
            className="inline-flex items-center gap-2 h-10 px-4 rounded-[10px] border border-[var(--border)] bg-[var(--surface-2)] text-sm font-medium hover:bg-[var(--surface-3)] transition-colors disabled:opacity-50"
          >
            <Download className="size-4" />
            {descargando ? "Leyendo…" : "Descargar copia de rescate"}
          </button>
          <Link
            href="/"
            className="inline-flex items-center h-10 px-4 rounded-[10px] text-sm text-muted hover:text-fg transition-colors"
          >
            Ir al panel
          </Link>
        </div>

        {resultado && (
          <p className="text-[12.5px] text-muted mt-5">{resultado}</p>
        )}

        {error.digest && (
          <p className="text-[11px] text-subtle mt-8 font-mono">
            Referencia del error: {error.digest}
          </p>
        )}
      </div>
    </div>
  );
}
