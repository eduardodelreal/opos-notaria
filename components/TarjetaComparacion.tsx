"use client";

import * as React from "react";
import { AlertTriangle, ScanSearch } from "lucide-react";
import { Badge, Barra, Punto } from "./ui";
import { fecha } from "@/lib/utils/time";
import type { ComparacionCante, TipoOmision } from "@/lib/data/types";

/**
 * Lo que se saltó, pintado.
 *
 * La jerarquía visual es deliberada: primero LO QUE FALTA, que es lo único
 * que el opositor no puede ver por sí mismo mientras canta. La cobertura y
 * la literalidad son contexto; las omisiones son el producto.
 */

const COLOR_GRAVEDAD: Record<string, string> = {
  alta: "var(--danger)",
  media: "var(--warn)",
  baja: "var(--info)",
};

const ETIQUETA_TIPO: Record<TipoOmision, string> = {
  articulo: "artículo",
  requisito: "requisito",
  clasificacion: "clasificación",
  plazo: "plazo",
  concepto: "concepto",
  epigrafe: "epígrafe entero",
};

function colorCobertura(pct: number): string {
  if (pct >= 85) return "var(--ok)";
  if (pct >= 60) return "var(--warn)";
  return "var(--danger)";
}

export function TarjetaComparacion({ comparacion }: { comparacion: ComparacionCante }) {
  const omisiones = comparacion.omisiones ?? [];

  return (
    <div
      className="rounded-[12px] border p-5"
      style={{
        borderColor: "color-mix(in srgb, var(--lacre) 30%, transparent)",
        background: "color-mix(in srgb, var(--lacre) 6%, transparent)",
      }}
    >
      <div className="flex items-start gap-3 mb-5">
        <ScanSearch className="size-4 text-[var(--lacre-bright)] shrink-0 mt-1" />
        <div className="min-w-0 flex-1">
          <p className="font-serif text-[17px] font-semibold leading-snug">
            {comparacion.titular}
          </p>
          <div className="mt-3 flex items-center gap-3">
            <div className="flex-1 max-w-[240px]">
              <Barra
                valor={comparacion.cobertura}
                color={colorCobertura(comparacion.cobertura)}
              />
            </div>
            <span
              className="numeric text-[13px] font-semibold"
              style={{ color: colorCobertura(comparacion.cobertura) }}
            >
              {comparacion.cobertura}%
            </span>
            <span className="text-[11.5px] text-subtle">del tema, recitado</span>
          </div>
        </div>
      </div>

      {omisiones.length > 0 ? (
        <div className="mb-5">
          <p className="text-[11px] uppercase tracking-[0.14em] text-subtle mb-2.5">
            Lo que te saltaste
          </p>
          <div className="space-y-3.5">
            {omisiones.map((o, i) => (
              <div
                key={i}
                className="pl-3 border-l-2"
                style={{ borderColor: COLOR_GRAVEDAD[o.gravedad] ?? "var(--border)" }}
              >
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  <span className="text-[10.5px] uppercase tracking-[0.12em] text-subtle">
                    {ETIQUETA_TIPO[o.tipo] ?? o.tipo}
                  </span>
                  <span className="text-[11.5px] text-subtle">·</span>
                  <span className="text-[11.5px] text-subtle truncate max-w-[60%]">
                    {o.epigrafe}
                  </span>
                </div>
                <p className="text-[13.5px] font-medium leading-snug">{o.falta}</p>
                {o.cita && (
                  // La cita es del temario del opositor, no del modelo: es lo
                  // que convierte "te dejaste algo" en algo comprobable.
                  <p className="font-serif text-[13px] text-muted mt-1.5 leading-relaxed border-l border-[var(--border)] pl-3">
                    «{o.cita}»
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <p className="text-[13.5px] text-muted mb-5 leading-relaxed">
          No se ha detectado nada del texto del tema que te dejaras. Repasa aun
          así la literalidad de aquí abajo.
        </p>
      )}

      {comparacion.epigrafesIncompletos?.length > 0 && (
        <div className="mb-5">
          <p className="text-[11px] uppercase tracking-[0.14em] text-subtle mb-2.5">
            Epígrafes que te dejaste a medias
          </p>
          <div className="space-y-2.5">
            {comparacion.epigrafesIncompletos.map((e, i) => (
              <div key={i}>
                <div className="flex items-center justify-between gap-3 mb-1">
                  <span className="text-[13px] truncate">{e.epigrafe}</span>
                  <span
                    className="numeric text-[12px] shrink-0"
                    style={{ color: colorCobertura(e.cobertura) }}
                  >
                    {e.cobertura}%
                  </span>
                </div>
                <Barra valor={e.cobertura} color={colorCobertura(e.cobertura)} alto={4} />
                <p className="text-[12.5px] text-muted mt-1.5 leading-relaxed">
                  {e.nota}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {comparacion.dichoDeMas?.length > 0 && (
        <div className="mb-5">
          <p className="text-[11px] uppercase tracking-[0.14em] text-subtle mb-2 flex items-center gap-1.5">
            <AlertTriangle className="size-3.5 text-[var(--warn)]" />
            Dicho de más (contrástalo con tu temario)
          </p>
          <ul className="space-y-1.5">
            {comparacion.dichoDeMas.map((d, i) => (
              <li key={i} className="text-[13px] flex gap-2.5">
                <Punto color="var(--warn)" size={6} />
                <span className="text-muted flex-1">{d}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div
        className="rounded-lg px-4 py-3"
        style={{ background: "color-mix(in srgb, var(--lacre) 10%, transparent)" }}
      >
        <p className="text-[11px] uppercase tracking-[0.14em] text-subtle mb-1.5">
          Literalidad
        </p>
        <p className="text-[13.5px] leading-relaxed">{comparacion.literalidad}</p>
      </div>

      <div className="flex flex-wrap items-center gap-2 mt-3">
        <Badge color="var(--fg-subtle)">{comparacion.modelo}</Badge>
        <p className="text-[10.5px] text-subtle">
          Comparado el {fecha(comparacion.generado)} contra el texto que tú
          guardaste · la transcripción es automática y puede traer errores.
        </p>
      </div>
    </div>
  );
}
