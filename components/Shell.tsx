"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BookMarked,
  Brain,
  Gauge,
  LayoutGrid,
  LogIn,
  LogOut,
  Menu,
  Mic,
  MessageSquareQuote,
  Moon,
  Settings,
  Sun,
  Timer,
  Dices,
  X,
} from "lucide-react";
import { useStore, useTemas } from "@/lib/store/store";
import { cx } from "./ui";
import { CronoFlotante } from "./CronoFlotante";
import { nombreVisible, useSesion } from "./Sesion";
import { IndicadorSync } from "./Sincronizacion";

const NAV = [
  { href: "/", label: "Panel", icono: Gauge },
  { href: "/programa", label: "Programa", icono: LayoutGrid },
  { href: "/cante", label: "Cante", icono: Mic },
  { href: "/crono", label: "Cronos", icono: Timer },
  { href: "/repaso", label: "Repaso", icono: Brain },
  { href: "/simulacros", label: "Simulacros", icono: Dices },
  { href: "/estadisticas", label: "Estadísticas", icono: BookMarked },
  { href: "/chat", label: "Preparador IA", icono: MessageSquareQuote },
];

/** Páginas con marco propio: no llevan barra lateral. */
const RUTAS_AUTH = ["/entrar", "/crear-cuenta", "/salir"];

export function Shell({ children }: { children: React.ReactNode }) {
  const ruta = usePathname();
  const [abierto, setAbierto] = React.useState(false);
  const alternarTema = useStore((s) => s.alternarTema);
  const tema = useStore((s) => s.perfil.tema);
  const temas = useTemas();
  const nombre = useStore((s) => s.perfil.nombre);

  React.useEffect(() => setAbierto(false), [ruta]);

  // El modo cante ocupa toda la pantalla: sin barra lateral que distraiga.
  // Las páginas de acceso tampoco la llevan, tienen su propio marco.
  const pantallaCompleta =
    ruta.startsWith("/cante/vivo") || RUTAS_AUTH.some((r) => ruta.startsWith(r));

  if (pantallaCompleta) return <>{children}</>;

  return (
    <div className="relative z-10 flex min-h-screen">
      {/* --------------------------- Barra lateral --------------------------- */}
      <aside
        className={cx(
          "fixed inset-y-0 left-0 z-40 w-[248px] shrink-0 flex flex-col",
          "border-r border-[var(--border)] bg-[var(--bg-elevated)]/85 backdrop-blur-xl",
          "transition-transform duration-300 lg:translate-x-0",
          abierto ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="px-5 pt-6 pb-5">
          <Link href="/" className="flex items-center gap-3 group">
            <Sello />
            <div className="leading-tight">
              <div className="font-serif text-[17px] font-semibold tracking-tight">
                opos<span className="text-[var(--laton)]">·</span>notaría
              </div>
              <div className="text-[10px] uppercase tracking-[0.18em] text-subtle">
                {nombre || "Tu expediente"}
              </div>
            </div>
          </Link>
        </div>

        <nav className="flex-1 px-3 space-y-0.5 overflow-y-auto">
          {NAV.map((item) => {
            const activo =
              item.href === "/" ? ruta === "/" : ruta.startsWith(item.href);
            const Icono = item.icono;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cx(
                  "relative flex items-center gap-3 h-10 px-3 rounded-[10px] text-[13.5px] font-medium transition-all group",
                  activo
                    ? "text-fg bg-[var(--surface-2)]"
                    : "text-muted hover:text-fg hover:bg-[var(--surface-2)]/60",
                )}
              >
                {activo && (
                  <span
                    className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full"
                    style={{ background: "var(--lacre-bright)" }}
                  />
                )}
                <Icono
                  className={cx(
                    "size-[17px] shrink-0 transition-colors",
                    activo ? "text-[var(--laton)]" : "text-subtle group-hover:text-muted",
                  )}
                />
                {item.label}
                {item.href === "/programa" && temas.length > 0 && (
                  <span className="ml-auto text-[11px] numeric text-subtle">
                    {temas.length}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        <div className="p-3 border-t border-[var(--border)] space-y-1">
          <IndicadorSync />
          <BloqueSesion />
          <div className="flex items-center gap-1">
            <Link
              href="/ajustes"
              className={cx(
                "flex-1 flex items-center gap-3 h-10 px-3 rounded-[10px] text-[13.5px] font-medium transition-colors",
                ruta.startsWith("/ajustes")
                  ? "text-fg bg-[var(--surface-2)]"
                  : "text-muted hover:text-fg hover:bg-[var(--surface-2)]/60",
              )}
            >
              <Settings className="size-[17px] text-subtle" />
              Ajustes
            </Link>
            <button
              onClick={alternarTema}
              aria-label="Cambiar tema"
              title={tema === "dark" ? "Modo claro" : "Modo oscuro"}
              className="size-10 grid place-items-center rounded-[10px] text-subtle hover:text-fg hover:bg-[var(--surface-2)] transition-colors"
            >
              {tema === "dark" ? (
                <Sun className="size-[17px]" />
              ) : (
                <Moon className="size-[17px]" />
              )}
            </button>
          </div>
        </div>
      </aside>

      {abierto && (
        <div
          className="fixed inset-0 z-30 bg-black/55 lg:hidden"
          onClick={() => setAbierto(false)}
        />
      )}

      {/* ------------------------------ Contenido ---------------------------- */}
      <div className="flex-1 lg:pl-[248px] min-w-0">
        <header className="lg:hidden sticky top-0 z-20 h-14 flex items-center gap-3 px-4 border-b border-[var(--border)] bg-[var(--bg)]/90 backdrop-blur-xl">
          <button
            onClick={() => setAbierto((v) => !v)}
            className="size-9 grid place-items-center rounded-lg text-muted hover:text-fg hover:bg-[var(--surface-2)]"
            aria-label="Menú"
          >
            {abierto ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
          <span className="font-serif text-[15px] font-semibold">
            opos<span className="text-[var(--laton)]">·</span>notaría
          </span>
        </header>

        <main className="px-5 sm:px-8 py-7 lg:py-9 max-w-[1240px] mx-auto pb-28">
          {children}
        </main>
      </div>

      <CronoFlotante />
    </div>
  );
}

/**
 * Quién ha iniciado sesión, en el pie de la barra lateral.
 *
 * Si la instalación no tiene Supabase configurado no se pinta nada: la app
 * funciona entera en local y no tiene sentido enseñar un acceso que no lleva
 * a ninguna parte.
 */
function BloqueSesion() {
  const { configurado, cargando, usuario } = useSesion();

  if (!configurado || cargando) return null;

  if (!usuario) {
    return (
      <Link
        href="/entrar"
        className="flex items-center gap-3 h-10 px-3 rounded-[10px] text-[13.5px] font-medium text-muted hover:text-fg hover:bg-[var(--surface-2)]/60 transition-colors"
      >
        <LogIn className="size-[17px] text-subtle" />
        Entrar
      </Link>
    );
  }

  const etiqueta = nombreVisible(usuario);

  return (
    <div className="flex items-center gap-1">
      <div className="flex-1 min-w-0 flex items-center gap-2.5 h-10 px-3">
        <span
          className="size-[22px] shrink-0 grid place-items-center rounded-full text-[10px] font-semibold text-white/95"
          style={{
            background:
              "linear-gradient(145deg, var(--lacre-bright), var(--lacre))",
          }}
          aria-hidden
        >
          {etiqueta.slice(0, 1).toUpperCase()}
        </span>
        <span className="min-w-0">
          <span className="block text-[9.5px] uppercase tracking-[0.16em] text-subtle leading-none">
            Sesión
          </span>
          <span className="block text-[12px] text-muted truncate leading-tight mt-1" title={etiqueta}>
            {etiqueta}
          </span>
        </span>
      </div>
      <Link
        href="/salir"
        aria-label="Cerrar sesión"
        title="Cerrar sesión"
        className="size-9 shrink-0 grid place-items-center rounded-[10px] text-subtle hover:text-fg hover:bg-[var(--surface-2)] transition-colors"
      >
        <LogOut className="size-[16px]" />
      </Link>
    </div>
  );
}

/** El sello de lacre de la marca. */
function Sello() {
  return (
    <span className="relative size-9 shrink-0 grid place-items-center">
      <span
        className="absolute inset-0 rounded-[11px] rotate-3 transition-transform group-hover:rotate-6"
        style={{
          background:
            "linear-gradient(145deg, var(--lacre-bright), var(--lacre))",
        }}
      />
      <span className="relative font-serif text-[15px] font-semibold text-white/95">
        N
      </span>
    </span>
  );
}

export function Cabecera({
  titulo,
  descripcion,
  acciones,
}: {
  titulo: string;
  descripcion?: string;
  acciones?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 mb-7">
      <div>
        <h1 className="font-serif text-[27px] sm:text-[32px] font-semibold tracking-[-0.02em] leading-tight">
          {titulo}
        </h1>
        {descripcion && (
          <p className="text-[13.5px] text-muted mt-1.5 max-w-2xl leading-relaxed">
            {descripcion}
          </p>
        )}
      </div>
      {acciones && <div className="flex items-center gap-2">{acciones}</div>}
    </div>
  );
}
