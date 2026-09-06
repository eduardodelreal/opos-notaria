"use client";

import * as React from "react";
import { horasMin, reloj, fecha } from "@/lib/utils/time";

/* ============================================================
   Gráficos a medida en SVG.
   Sin librería: así el estilo es el de la app y no el de Chart.js,
   y no cargamos 90 kB para pintar cinco barras.
   ============================================================ */

/* --------------------------- Anillo de progreso --------------------------- */

export function Anillo({
  valor,
  tamano = 132,
  grosor = 10,
  color = "var(--laton)",
  centro,
  sub,
}: {
  valor: number;
  tamano?: number;
  grosor?: number;
  color?: string;
  centro?: React.ReactNode;
  sub?: React.ReactNode;
}) {
  const r = (tamano - grosor) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.min(100, Math.max(0, valor));

  return (
    <div className="relative inline-grid place-items-center" style={{ width: tamano, height: tamano }}>
      <svg width={tamano} height={tamano} className="-rotate-90">
        <circle
          cx={tamano / 2}
          cy={tamano / 2}
          r={r}
          fill="none"
          stroke="var(--surface-3)"
          strokeWidth={grosor}
        />
        <circle
          cx={tamano / 2}
          cy={tamano / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={grosor}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c - (pct / 100) * c}
          style={{ transition: "stroke-dashoffset 900ms cubic-bezier(0.22,1,0.36,1)" }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        <div>
          <div className="numeric text-[26px] font-semibold leading-none">{centro}</div>
          {sub && <div className="text-[10px] uppercase tracking-[0.14em] text-subtle mt-1.5">{sub}</div>}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ Mapa de calor ----------------------------- */

const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

export function MapaCalor({
  datos,
  celda = 11,
  hueco = 3,
}: {
  datos: { dia: string; ts: number; segundos: number }[];
  celda?: number;
  hueco?: number;
}) {
  const max = Math.max(3600, ...datos.map((d) => d.segundos));
  const paso = celda + hueco;

  // Alineamos la primera columna al lunes anterior al primer dato.
  const primero = datos[0];
  const offset = primero ? (new Date(primero.ts).getDay() + 6) % 7 : 0;
  const columnas = Math.ceil((datos.length + offset) / 7);

  const etiquetasMes: { x: number; texto: string }[] = [];
  let mesPrevio = -1;
  datos.forEach((d, i) => {
    const col = Math.floor((i + offset) / 7);
    const m = new Date(d.ts).getMonth();
    if (m !== mesPrevio && (i + offset) % 7 <= 6) {
      if (!etiquetasMes.length || col - etiquetasMes[etiquetasMes.length - 1].x / paso > 3) {
        etiquetasMes.push({ x: col * paso, texto: MESES[m] });
      }
      mesPrevio = m;
    }
  });

  const intensidad = (s: number) => {
    if (s <= 0) return 0;
    return Math.min(1, 0.22 + (s / max) * 0.78);
  };

  return (
    <div className="overflow-x-auto pb-1">
      <svg
        width={columnas * paso}
        height={7 * paso + 18}
        className="block"
        role="img"
        aria-label="Horas de estudio por día del último año"
      >
        {etiquetasMes.map((e, i) => (
          <text key={i} x={e.x} y={9} fontSize={9} fill="var(--fg-subtle)">
            {e.texto}
          </text>
        ))}
        <g transform="translate(0,16)">
          {datos.map((d, i) => {
            const idx = i + offset;
            const col = Math.floor(idx / 7);
            const fila = idx % 7;
            const a = intensidad(d.segundos);
            return (
              <rect
                key={d.dia}
                x={col * paso}
                y={fila * paso}
                width={celda}
                height={celda}
                rx={2.5}
                fill={a === 0 ? "var(--surface-2)" : "var(--laton)"}
                fillOpacity={a === 0 ? 1 : a}
                stroke={a === 0 ? "var(--border)" : "none"}
                strokeWidth={0.5}
              >
                <title>{`${fecha(d.ts)} · ${horasMin(d.segundos)}`}</title>
              </rect>
            );
          })}
        </g>
      </svg>
    </div>
  );
}

/* ------------------------------ Barras simples ---------------------------- */

export function Barras({
  datos,
  alto = 120,
  color = "var(--laton)",
  objetivo,
  formato = (v: number) => horasMin(v),
}: {
  datos: { etiqueta: string; valor: number }[];
  alto?: number;
  color?: string;
  objetivo?: number;
  formato?: (v: number) => string;
}) {
  const max = Math.max(1, objetivo ?? 0, ...datos.map((d) => d.valor));

  return (
    <div>
      <div className="flex items-end gap-1.5 relative" style={{ height: alto }}>
        {objetivo != null && objetivo > 0 && (
          <div
            className="absolute left-0 right-0 border-t border-dashed pointer-events-none"
            style={{
              bottom: `${(objetivo / max) * 100}%`,
              borderColor: "color-mix(in srgb, var(--fg-subtle) 55%, transparent)",
            }}
          >
            <span className="absolute -top-4 right-0 text-[10px] text-subtle">
              objetivo
            </span>
          </div>
        )}
        {datos.map((d, i) => (
          <div key={i} className="flex-1 h-full flex items-end group relative">
            <div
              className="w-full rounded-t-[4px] transition-all duration-500"
              style={{
                height: `${Math.max(2, (d.valor / max) * 100)}%`,
                background: d.valor > 0 ? color : "var(--surface-3)",
                opacity: d.valor > 0 ? 1 : 0.5,
              }}
            />
            <div className="absolute -top-6 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none text-[11px] numeric bg-[var(--surface-3)] px-1.5 py-0.5 rounded border border-[var(--border)] whitespace-nowrap z-10">
              {formato(d.valor)}
            </div>
          </div>
        ))}
      </div>
      <div className="flex gap-1.5 mt-2">
        {datos.map((d, i) => (
          <div key={i} className="flex-1 text-center text-[10px] text-subtle truncate">
            {d.etiqueta}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------ Línea temporal ---------------------------- */

export function Linea({
  puntos,
  alto = 150,
  color = "var(--lacre-bright)",
  min = 0,
  max = 10,
  formato = (v: number) => String(v),
}: {
  puntos: { ts: number; valor: number }[];
  alto?: number;
  color?: string;
  min?: number;
  max?: number;
  formato?: (v: number) => string;
}) {
  const ancho = 600;
  const pad = { t: 12, r: 12, b: 22, l: 30 };

  if (puntos.length < 2) {
    return (
      <div
        className="grid place-items-center text-[13px] text-subtle"
        style={{ height: alto }}
      >
        Hacen falta al menos dos registros para dibujar la evolución
      </div>
    );
  }

  const ordenados = [...puntos].sort((a, b) => a.ts - b.ts);
  const t0 = ordenados[0].ts;
  const t1 = ordenados[ordenados.length - 1].ts;
  const rango = Math.max(1, t1 - t0);

  const x = (ts: number) => pad.l + ((ts - t0) / rango) * (ancho - pad.l - pad.r);
  const y = (v: number) =>
    pad.t + (1 - (v - min) / Math.max(1, max - min)) * (alto - pad.t - pad.b);

  const d = ordenados.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.ts).toFixed(1)},${y(p.valor).toFixed(1)}`).join(" ");
  const area = `${d} L${x(t1).toFixed(1)},${alto - pad.b} L${x(t0).toFixed(1)},${alto - pad.b} Z`;

  const ticks = [min, (min + max) / 2, max];

  return (
    <svg viewBox={`0 0 ${ancho} ${alto}`} className="w-full" style={{ height: alto }}>
      <defs>
        <linearGradient id="grad-linea" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {ticks.map((t) => (
        <g key={t}>
          <line
            x1={pad.l}
            x2={ancho - pad.r}
            y1={y(t)}
            y2={y(t)}
            stroke="var(--border)"
            strokeDasharray="3 4"
          />
          <text x={0} y={y(t) + 3} fontSize={10} fill="var(--fg-subtle)">
            {formato(t)}
          </text>
        </g>
      ))}
      <path d={area} fill="url(#grad-linea)" />
      <path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      {ordenados.map((p, i) => (
        <circle key={i} cx={x(p.ts)} cy={y(p.valor)} r={3.5} fill="var(--bg)" stroke={color} strokeWidth={2}>
          <title>{`${fecha(p.ts)} · ${formato(p.valor)}`}</title>
        </circle>
      ))}
    </svg>
  );
}

/* --------------------- Comparativa de cantes por epígrafe ------------------ */

export function ComparativaEpigrafes({
  filas,
}: {
  filas: {
    titulo: string;
    actual: number;
    anterior?: number;
    fallos: number;
  }[];
}) {
  const max = Math.max(30, ...filas.flatMap((f) => [f.actual, f.anterior ?? 0]));

  return (
    <div className="space-y-3">
      {filas.map((f, i) => {
        const delta = f.anterior != null ? f.actual - f.anterior : null;
        return (
          <div key={i}>
            <div className="flex items-baseline justify-between gap-3 mb-1.5">
              <span className="text-[13px] truncate flex-1" title={f.titulo}>
                <span className="text-subtle numeric mr-2">{i + 1}</span>
                {f.titulo}
              </span>
              <span className="numeric text-[12px] text-muted shrink-0">
                {reloj(f.actual)}
                {delta != null && Math.abs(delta) >= 3 && (
                  <span
                    className="ml-2"
                    style={{ color: delta < 0 ? "var(--ok)" : "var(--warn)" }}
                  >
                    {delta < 0 ? "−" : "+"}
                    {reloj(Math.abs(delta))}
                  </span>
                )}
                {f.fallos > 0 && (
                  <span className="ml-2 text-[var(--danger)]">{f.fallos}f</span>
                )}
              </span>
            </div>
            <div className="relative h-2 rounded-full bg-[var(--surface-3)] overflow-hidden">
              {f.anterior != null && (
                <div
                  className="absolute inset-y-0 left-0 rounded-full"
                  style={{
                    width: `${(f.anterior / max) * 100}%`,
                    background: "var(--border-strong)",
                  }}
                />
              )}
              <div
                className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-700"
                style={{
                  width: `${(f.actual / max) * 100}%`,
                  background:
                    f.fallos > 1
                      ? "var(--danger)"
                      : f.fallos === 1
                        ? "var(--warn)"
                        : "var(--st-cantable)",
                  opacity: 0.92,
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* --------------------------------- Radar ---------------------------------- */

export function Radar({
  ejes,
  tamano = 240,
}: {
  ejes: { etiqueta: string; valor: number; color?: string }[];
  tamano?: number;
}) {
  if (ejes.length < 3) return null;
  const cx = tamano / 2;
  const cy = tamano / 2;
  const r = tamano / 2 - 34;
  const n = ejes.length;

  const punto = (i: number, v: number) => {
    const ang = (Math.PI * 2 * i) / n - Math.PI / 2;
    const rr = (Math.min(100, Math.max(0, v)) / 100) * r;
    return [cx + Math.cos(ang) * rr, cy + Math.sin(ang) * rr] as const;
  };

  const anillos = [25, 50, 75, 100];
  const poligono = ejes
    .map((e, i) => punto(i, e.valor).join(","))
    .join(" ");

  return (
    <svg width={tamano} height={tamano} className="overflow-visible">
      {anillos.map((a) => (
        <polygon
          key={a}
          points={ejes.map((_, i) => punto(i, a).join(",")).join(" ")}
          fill="none"
          stroke="var(--border)"
          strokeWidth={a === 100 ? 1 : 0.75}
        />
      ))}
      {ejes.map((_, i) => {
        const [x, y] = punto(i, 100);
        return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="var(--border)" strokeWidth={0.75} />;
      })}
      <polygon
        points={poligono}
        fill="var(--laton)"
        fillOpacity={0.18}
        stroke="var(--laton)"
        strokeWidth={2}
        strokeLinejoin="round"
      />
      {ejes.map((e, i) => {
        const [x, y] = punto(i, e.valor);
        return <circle key={i} cx={x} cy={y} r={3} fill={e.color ?? "var(--laton)"} />;
      })}
      {ejes.map((e, i) => {
        const [x, y] = punto(i, 122);
        return (
          <text
            key={i}
            x={x}
            y={y}
            fontSize={10}
            fill="var(--fg-muted)"
            textAnchor={x < cx - 8 ? "end" : x > cx + 8 ? "start" : "middle"}
            dominantBaseline="middle"
          >
            {e.etiqueta}
          </text>
        );
      })}
    </svg>
  );
}
