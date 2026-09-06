"use client";

import * as React from "react";
import { Loader2, X } from "lucide-react";

export function cx(...partes: (string | false | null | undefined)[]): string {
  return partes.filter(Boolean).join(" ");
}

/* ---------------------------------- Botón --------------------------------- */

type Variante = "primario" | "secundario" | "fantasma" | "peligro" | "oro";
type Tam = "sm" | "md" | "lg";

const VARIANTES: Record<Variante, string> = {
  primario:
    "bg-[var(--lacre)] text-white hover:bg-[var(--lacre-bright)] border-transparent shadow-[0_6px_20px_-8px_var(--lacre)]",
  secundario:
    "bg-[var(--surface-2)] text-fg hover:bg-[var(--surface-3)] border-[var(--border)]",
  fantasma:
    "bg-transparent text-muted hover:text-fg hover:bg-[var(--surface-2)] border-transparent",
  peligro:
    "bg-transparent text-[var(--danger)] hover:bg-[color-mix(in_srgb,var(--danger)_14%,transparent)] border-[color-mix(in_srgb,var(--danger)_35%,transparent)]",
  oro: "bg-[var(--laton)] text-[#15130c] hover:brightness-110 border-transparent font-semibold",
};

const TAMS: Record<Tam, string> = {
  sm: "h-8 px-3 text-[13px] gap-1.5 rounded-lg",
  md: "h-10 px-4 text-sm gap-2 rounded-[10px]",
  lg: "h-12 px-6 text-[15px] gap-2.5 rounded-xl",
};

export function Boton({
  variante = "secundario",
  tam = "md",
  cargando,
  className,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variante?: Variante;
  tam?: Tam;
  cargando?: boolean;
}) {
  return (
    <button
      {...props}
      disabled={props.disabled || cargando}
      className={cx(
        "inline-flex items-center justify-center border font-medium transition-all duration-150",
        "active:scale-[0.98] disabled:opacity-45 disabled:pointer-events-none select-none whitespace-nowrap",
        VARIANTES[variante],
        TAMS[tam],
        className,
      )}
    >
      {cargando && <Loader2 className="size-4 animate-spin" />}
      {children}
    </button>
  );
}

/* ---------------------------------- Card ---------------------------------- */

export function Card({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...props} className={cx("card p-5", className)}>
      {children}
    </div>
  );
}

export function TituloSeccion({
  children,
  accion,
}: {
  children: React.ReactNode;
  accion?: React.ReactNode;
}) {
  return (
    <div className="flex items-end justify-between gap-4 mb-4">
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-subtle">
        {children}
      </h2>
      {accion}
    </div>
  );
}

/* --------------------------------- Badge ---------------------------------- */

export function Badge({
  color,
  children,
  className,
}: {
  color?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 h-6 text-[11px] font-medium",
        className,
      )}
      style={
        color
          ? {
              color,
              borderColor: `color-mix(in srgb, ${color} 40%, transparent)`,
              background: `color-mix(in srgb, ${color} 12%, transparent)`,
            }
          : undefined
      }
    >
      {children}
    </span>
  );
}

export function Punto({ color, size = 8 }: { color: string; size?: number }) {
  return (
    <span
      className="inline-block rounded-full shrink-0"
      style={{ width: size, height: size, background: color }}
    />
  );
}

/* -------------------------------- Campos ---------------------------------- */

const BASE_CAMPO =
  "w-full bg-[var(--bg-elevated)] border border-[var(--border)] rounded-[10px] px-3 text-sm text-fg placeholder:text-subtle transition-colors focus:border-[var(--border-strong)] outline-none";

export function Campo({
  etiqueta,
  pista,
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & {
  etiqueta?: string;
  pista?: string;
}) {
  return (
    <label className="block">
      {etiqueta && (
        <span className="block text-xs font-medium text-muted mb-1.5">
          {etiqueta}
        </span>
      )}
      <input {...props} className={cx(BASE_CAMPO, "h-10", className)} />
      {pista && <span className="block text-[11px] text-subtle mt-1.5">{pista}</span>}
    </label>
  );
}

export function AreaTexto({
  etiqueta,
  pista,
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  etiqueta?: string;
  pista?: string;
}) {
  return (
    <label className="block">
      {etiqueta && (
        <span className="block text-xs font-medium text-muted mb-1.5">
          {etiqueta}
        </span>
      )}
      <textarea
        {...props}
        className={cx(BASE_CAMPO, "py-2.5 leading-relaxed resize-y", className)}
      />
      {pista && <span className="block text-[11px] text-subtle mt-1.5">{pista}</span>}
    </label>
  );
}

export function Selector({
  etiqueta,
  className,
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & { etiqueta?: string }) {
  return (
    <label className="block">
      {etiqueta && (
        <span className="block text-xs font-medium text-muted mb-1.5">
          {etiqueta}
        </span>
      )}
      <select {...props} className={cx(BASE_CAMPO, "h-10 cursor-pointer", className)}>
        {children}
      </select>
    </label>
  );
}

/* --------------------------------- Modal ---------------------------------- */

export function Modal({
  abierto,
  onCerrar,
  titulo,
  descripcion,
  ancho = "max-w-lg",
  children,
}: {
  abierto: boolean;
  onCerrar: () => void;
  titulo: string;
  descripcion?: string;
  ancho?: string;
  children: React.ReactNode;
}) {
  React.useEffect(() => {
    if (!abierto) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCerrar();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [abierto, onCerrar]);

  if (!abierto) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:p-8">
      <div
        className="fixed inset-0 bg-black/65 backdrop-blur-[3px]"
        onClick={onCerrar}
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
        className={cx(
          "relative w-full card p-0 my-auto animate-rise overflow-hidden",
          ancho,
        )}
        style={{ boxShadow: "var(--shadow-lg)" }}
      >
        <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-4 border-b border-[var(--border)]">
          <div>
            <h3 className="text-base font-semibold tracking-tight">{titulo}</h3>
            {descripcion && (
              <p className="text-[13px] text-muted mt-1 leading-relaxed">
                {descripcion}
              </p>
            )}
          </div>
          <button
            onClick={onCerrar}
            className="text-subtle hover:text-fg transition-colors -mr-1 -mt-0.5 p-1"
            aria-label="Cerrar"
          >
            <X className="size-4.5" />
          </button>
        </div>
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
  );
}

/* ------------------------------ Estado vacío ------------------------------ */

export function Vacio({
  icono,
  titulo,
  texto,
  accion,
}: {
  icono?: React.ReactNode;
  titulo: string;
  texto?: string;
  accion?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-14 px-6">
      {icono && (
        <div className="mb-4 size-12 rounded-2xl grid place-items-center bg-[var(--surface-2)] border border-[var(--border)] text-subtle">
          {icono}
        </div>
      )}
      <p className="text-[15px] font-medium">{titulo}</p>
      {texto && (
        <p className="text-[13px] text-muted mt-2 max-w-sm leading-relaxed">
          {texto}
        </p>
      )}
      {accion && <div className="mt-5">{accion}</div>}
    </div>
  );
}

/* ------------------------------- Indicadores ------------------------------ */

export function Metrica({
  valor,
  etiqueta,
  sufijo,
  color,
  sub,
}: {
  valor: React.ReactNode;
  etiqueta: string;
  sufijo?: string;
  color?: string;
  sub?: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-baseline gap-1">
        <span
          className="numeric text-[28px] leading-none font-semibold tracking-tight"
          style={color ? { color } : undefined}
        >
          {valor}
        </span>
        {sufijo && <span className="text-[13px] text-subtle">{sufijo}</span>}
      </div>
      <div className="text-[11px] uppercase tracking-[0.12em] text-subtle mt-2">
        {etiqueta}
      </div>
      {sub && <div className="text-[12px] text-muted mt-1">{sub}</div>}
    </div>
  );
}

export function Barra({
  valor,
  color = "var(--laton)",
  alto = 6,
  fondo = "var(--surface-3)",
}: {
  valor: number;
  color?: string;
  alto?: number;
  fondo?: string;
}) {
  return (
    <div
      className="w-full rounded-full overflow-hidden"
      style={{ height: alto, background: fondo }}
    >
      <div
        className="h-full rounded-full transition-[width] duration-700 ease-out"
        style={{
          width: `${Math.min(100, Math.max(0, valor))}%`,
          background: color,
        }}
      />
    </div>
  );
}

export function Cargando({ texto = "Cargando" }: { texto?: string }) {
  return (
    <div className="flex items-center gap-2.5 text-muted text-sm py-10 justify-center">
      <Loader2 className="size-4 animate-spin" />
      {texto}
    </div>
  );
}

/* -------------------------------- Pestañas -------------------------------- */

export function Pestanas<T extends string>({
  valor,
  onCambio,
  opciones,
}: {
  valor: T;
  onCambio: (v: T) => void;
  opciones: { id: T; label: string; contador?: number }[];
}) {
  return (
    <div className="inline-flex items-center gap-1 p-1 rounded-xl bg-[var(--surface-2)] border border-[var(--border)]">
      {opciones.map((o) => (
        <button
          key={o.id}
          onClick={() => onCambio(o.id)}
          className={cx(
            "h-8 px-3.5 rounded-lg text-[13px] font-medium transition-all",
            valor === o.id
              ? "bg-[var(--surface)] text-fg shadow-sm"
              : "text-muted hover:text-fg",
          )}
        >
          {o.label}
          {o.contador != null && (
            <span className="ml-1.5 text-[11px] text-subtle numeric">
              {o.contador}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------- Confirmación ----------------------------- */

export function useConfirmacion() {
  const [estado, setEstado] = React.useState<{
    titulo: string;
    texto: string;
    onOk: () => void;
  } | null>(null);

  const pedir = React.useCallback(
    (titulo: string, texto: string, onOk: () => void) =>
      setEstado({ titulo, texto, onOk }),
    [],
  );

  const dialogo = (
    <Modal
      abierto={!!estado}
      onCerrar={() => setEstado(null)}
      titulo={estado?.titulo ?? ""}
      ancho="max-w-md"
    >
      <p className="text-sm text-muted leading-relaxed">{estado?.texto}</p>
      <div className="flex justify-end gap-2 mt-6">
        <Boton variante="fantasma" onClick={() => setEstado(null)}>
          Cancelar
        </Boton>
        <Boton
          variante="peligro"
          onClick={() => {
            estado?.onOk();
            setEstado(null);
          }}
        >
          Sí, continuar
        </Boton>
      </div>
    </Modal>
  );

  return { pedir, dialogo };
}
