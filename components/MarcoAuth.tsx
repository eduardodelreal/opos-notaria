"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Card } from "./ui";

/**
 * El marco de las páginas de acceso: pantalla completa, degradados de marca,
 * sello de lacre y título en serif. Sin barra lateral, para que entrar o
 * crear la cuenta sea lo único que hay delante.
 */
export function MarcoAuth({
  titulo,
  descripcion,
  children,
  pie,
}: {
  titulo: string;
  descripcion?: string;
  children: React.ReactNode;
  pie?: React.ReactNode;
}) {
  return (
    <div className="relative min-h-screen flex flex-col items-center justify-center px-5 py-14">
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-0"
        style={{
          background:
            "radial-gradient(760px 420px at 50% -8%, var(--lacre-soft), transparent 68%), radial-gradient(620px 380px at 12% 108%, var(--laton-soft), transparent 66%)",
        }}
      />

      <div className="relative z-10 w-full max-w-[416px] animate-rise">
        <div className="flex flex-col items-center text-center mb-7">
          <SelloGrande />
          <h1 className="mt-5 font-serif text-[28px] sm:text-[31px] font-semibold tracking-[-0.02em] leading-tight">
            {titulo}
          </h1>
          {descripcion && (
            <p className="mt-2.5 text-[13.5px] text-muted leading-relaxed max-w-[34ch]">
              {descripcion}
            </p>
          )}
        </div>

        <Card className="p-6 sm:p-7">{children}</Card>

        {pie && (
          <div className="mt-5 text-center text-[13px] text-muted leading-relaxed">
            {pie}
          </div>
        )}

        <div className="mt-7 text-center">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-[12.5px] text-subtle hover:text-fg transition-colors"
          >
            <ArrowLeft className="size-3.5" />
            Volver al panel
          </Link>
        </div>
      </div>
    </div>
  );
}

/** El sello de lacre de la marca, en grande. */
function SelloGrande() {
  return (
    <span className="relative size-14 grid place-items-center">
      <span
        className="absolute inset-0 rounded-[18px] rotate-3"
        style={{
          background: "linear-gradient(145deg, var(--lacre-bright), var(--lacre))",
          boxShadow: "0 14px 34px -14px var(--lacre)",
        }}
      />
      <span className="relative font-serif text-[23px] font-semibold text-white/95">
        N
      </span>
    </span>
  );
}

/** Aviso en línea (error o confirmación) con el tono correspondiente. */
export function Aviso({
  tono,
  children,
}: {
  tono: "error" | "ok" | "info";
  children: React.ReactNode;
}) {
  const color =
    tono === "error" ? "var(--danger)" : tono === "ok" ? "var(--ok)" : "var(--info)";
  return (
    <div
      role={tono === "error" ? "alert" : "status"}
      className="rounded-[10px] border px-3.5 py-2.5 text-[12.5px] leading-relaxed"
      style={{
        color,
        borderColor: `color-mix(in srgb, ${color} 34%, transparent)`,
        background: `color-mix(in srgb, ${color} 10%, transparent)`,
      }}
    >
      {children}
    </div>
  );
}
