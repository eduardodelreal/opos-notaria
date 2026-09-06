"use client";

import * as React from "react";
import { Sparkles } from "lucide-react";
import { Badge, Punto } from "./ui";
import { fecha } from "@/lib/utils/time";
import type { AnalisisCante } from "@/lib/data/types";

/** Las conclusiones del modelo sobre un cante, pintadas como tarjeta. */
export function TarjetaAnalisis({ analisis }: { analisis: AnalisisCante }) {
  const PRIORIDAD: Record<string, string> = {
    alta: "var(--danger)",
    media: "var(--warn)",
    baja: "var(--info)",
  };

  return (
    <div
      className="rounded-[12px] border p-5"
      style={{
        borderColor: "color-mix(in srgb, var(--laton) 32%, transparent)",
        background: "color-mix(in srgb, var(--laton) 6%, transparent)",
      }}
    >
      <div className="flex items-start gap-3 mb-4">
        <Sparkles className="size-4 text-[var(--laton)] shrink-0 mt-1" />
        <div>
          <p className="font-serif text-[17px] font-semibold leading-snug">
            {analisis.titular}
          </p>
          <p className="text-[13.5px] text-muted mt-2 leading-relaxed">
            {analisis.diagnostico}
          </p>
        </div>
      </div>

      {analisis.fortalezas?.length > 0 && (
        <div className="mb-4">
          <p className="text-[11px] uppercase tracking-[0.14em] text-subtle mb-2">
            Lo que has hecho bien
          </p>
          <ul className="space-y-1.5">
            {analisis.fortalezas.map((f, i) => (
              <li key={i} className="text-[13px] flex gap-2.5">
                <Punto color="var(--ok)" size={6} />
                <span className="text-muted flex-1">{f}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {analisis.mejoras?.length > 0 && (
        <div className="mb-4">
          <p className="text-[11px] uppercase tracking-[0.14em] text-subtle mb-2">
            Qué mejorar
          </p>
          <div className="space-y-3">
            {analisis.mejoras.map((m, i) => (
              <div
                key={i}
                className="pl-3 border-l-2"
                style={{ borderColor: PRIORIDAD[m.prioridad] ?? "var(--border)" }}
              >
                <p className="text-[13.5px] font-medium">{m.que}</p>
                <p className="text-[12.5px] text-muted mt-1 leading-relaxed">{m.como}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {analisis.epigrafesCriticos?.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-4">
          {analisis.epigrafesCriticos.map((e, i) => (
            <Badge key={i} color="var(--danger)">
              {e}
            </Badge>
          ))}
        </div>
      )}

      <div
        className="rounded-lg px-4 py-3"
        style={{ background: "color-mix(in srgb, var(--laton) 12%, transparent)" }}
      >
        <p className="text-[11px] uppercase tracking-[0.14em] text-subtle mb-1.5">
          Foco de la próxima sesión
        </p>
        <p className="text-[13.5px] font-medium leading-relaxed">
          {analisis.focoProximaSesion}
        </p>
      </div>

      <p className="text-[10.5px] text-subtle mt-3">
        Generado el {fecha(analisis.generado)} · orientativo: manda tu temario y tu preparador.
      </p>
    </div>
  );
}
