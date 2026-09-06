"use client";

import * as React from "react";
import Link from "next/link";
import { Mic, Search, Shuffle } from "lucide-react";
import { useStore, temasOrdenados } from "@/lib/store/store";
import { Cabecera } from "@/components/Shell";
import { Badge, Boton, Card, Punto, TituloSeccion, Vacio, cx } from "@/components/ui";
import { ESTADOS } from "@/lib/data/types";
import { estadoEfectivo, urgencia } from "@/lib/data/srs";
import { fecha, haceTexto, reloj } from "@/lib/utils/time";
import { plural } from "@/lib/utils/texto";

export default function ElegirCante() {
  const { temas, materias, progresos, perfil, cantes } = useStore();
  const [busqueda, setBusqueda] = React.useState("");
  const [materiaId, setMateriaId] = React.useState("todas");

  const ordenados = React.useMemo(
    () => temasOrdenados(temas, materias),
    [temas, materias],
  );

  const lista = React.useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return ordenados
      .filter((t) => materiaId === "todas" || t.materiaId === materiaId)
      .filter((t) => !q || `${t.numero} ${t.titulo}`.toLowerCase().includes(q))
      .sort((a, b) => {
        const pa = progresos[a.id];
        const pb = progresos[b.id];
        return (pb ? urgencia(pb) : 0) - (pa ? urgencia(pa) : 0);
      });
  }, [ordenados, materiaId, busqueda, progresos]);

  const alAzar = () => {
    const candidatos = lista.filter((t) => {
      const p = progresos[t.id];
      return p && p.estado !== "nuevo";
    });
    const pool = candidatos.length ? candidatos : lista;
    if (!pool.length) return;
    const t = pool[Math.floor(Math.random() * pool.length)];
    window.location.href = `/cante/vivo?tema=${t.id}`;
  };

  const ultimos = React.useMemo(
    () => [...cantes].sort((a, b) => b.fecha - a.fecha).slice(0, 5),
    [cantes],
  );

  if (!temas.length) {
    return (
      <>
        <Cabecera titulo="Cante" />
        <Card className="p-0">
          <Vacio
            icono={<Mic className="size-5" />}
            titulo="Necesitas temas para cantar"
            texto="Da de alta tu programa y vuelve. El modo cante cronometra epígrafe a epígrafe y te deja marcar fallos sin romper el ritmo."
            accion={
              <Link href="/programa">
                <Boton variante="primario">Añadir temas</Boton>
              </Link>
            }
          />
        </Card>
      </>
    );
  }

  return (
    <>
      <Cabecera
        titulo="Cante"
        descripcion="Elige el tema. Arriba salen primero los que más piden cante según el repaso espaciado."
        acciones={
          <Boton variante="secundario" onClick={alAzar}>
            <Shuffle className="size-4" />
            Al azar
          </Boton>
        }
      />

      <div className="flex flex-wrap gap-3 mb-5">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-subtle pointer-events-none" />
          <input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar tema…"
            className="w-full h-10 pl-9 pr-3 rounded-[10px] bg-[var(--bg-elevated)] border border-[var(--border)] text-sm outline-none focus:border-[var(--border-strong)]"
          />
        </div>
        <select
          value={materiaId}
          onChange={(e) => setMateriaId(e.target.value)}
          className="h-10 px-3 rounded-[10px] bg-[var(--bg-elevated)] border border-[var(--border)] text-sm cursor-pointer outline-none"
        >
          <option value="todas">Todas las materias</option>
          {materias.map((m) => (
            <option key={m.id} value={m.id}>
              {m.nombre}
            </option>
          ))}
        </select>
      </div>

      <div className="grid lg:grid-cols-[1.6fr_1fr] gap-4">
        <Card className="p-0 overflow-hidden max-h-[600px] overflow-y-auto">
          {lista.map((t, i) => {
            const p = progresos[t.id];
            const estado = p ? estadoEfectivo(p, perfil.diasOxido) : "nuevo";
            const meta = ESTADOS.find((e) => e.id === estado)!;
            const materia = materias.find((m) => m.id === t.materiaId);
            return (
              <Link
                key={t.id}
                href={`/cante/vivo?tema=${t.id}`}
                className={cx(
                  "flex items-center gap-3.5 px-5 py-3.5 hover:bg-[var(--surface-2)] transition-colors",
                  i > 0 && "border-t border-[var(--border)]",
                )}
              >
                <Punto color={meta.color} />
                <span className="numeric text-[12px] text-subtle w-8 shrink-0">
                  {t.numero}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[13.5px] truncate">{t.titulo}</p>
                  <p className="text-[11.5px] text-subtle mt-0.5">
                    {materia?.nombre}
                    {t.epigrafes.length > 0
                      ? ` · ${plural(t.epigrafes.length, "epígrafe")}`
                      : " · sin epígrafes"}
                    {p?.ultimoCante ? ` · cantado ${haceTexto(p.ultimoCante)}` : ""}
                  </p>
                </div>
                {p?.notaMedia != null && (
                  <span className="numeric text-[13px] text-muted shrink-0">
                    {p.notaMedia}
                  </span>
                )}
                <Mic className="size-4 text-subtle shrink-0" />
              </Link>
            );
          })}
          {lista.length === 0 && <Vacio titulo="Ningún tema encaja con el filtro" />}
        </Card>

        <div className="space-y-4">
          <Card>
            <TituloSeccion>Cómo funciona</TituloSeccion>
            <ul className="space-y-3 text-[13px] text-muted leading-relaxed">
              <li className="flex gap-3">
                <kbd className="shrink-0 px-2 h-6 grid place-items-center rounded-md bg-[var(--surface-3)] border border-[var(--border)] text-[11px] font-medium text-fg">
                  Espacio
                </kbd>
                Pasas al siguiente epígrafe y se cierra el tiempo del anterior.
              </li>
              <li className="flex gap-3">
                <kbd className="shrink-0 px-2 h-6 grid place-items-center rounded-md bg-[var(--surface-3)] border border-[var(--border)] text-[11px] font-medium text-fg">
                  1 – 4
                </kbd>
                Marcas laguna, titubeo, orden o dato erróneo sin parar de cantar.
              </li>
              <li className="flex gap-3">
                <kbd className="shrink-0 px-2 h-6 grid place-items-center rounded-md bg-[var(--surface-3)] border border-[var(--border)] text-[11px] font-medium text-fg">
                  Esc
                </kbd>
                Terminas y pasas al resumen para poner nota y feedback.
              </li>
            </ul>
            <p className="text-[12.5px] text-subtle mt-4 leading-relaxed">
              El objetivo de tiempo por tema está en {perfil.minutosPorTema} min. Se
              cambia en Ajustes.
            </p>
          </Card>

          {ultimos.length > 0 && (
            <Card>
              <TituloSeccion>Últimos cantes</TituloSeccion>
              <div className="space-y-2.5">
                {ultimos.map((c) => {
                  const t = temas.find((x) => x.id === c.temaId);
                  return (
                    <Link
                      key={c.id}
                      href={`/tema/${c.temaId}`}
                      className="flex items-center gap-3 text-[12.5px] hover:text-fg text-muted transition-colors"
                    >
                      <span className="truncate flex-1">
                        {t ? `T${t.numero} ${t.titulo}` : "Tema borrado"}
                      </span>
                      <span className="numeric text-subtle shrink-0">
                        {reloj(c.segundos)}
                      </span>
                      {c.nota != null && (
                        <span className="numeric font-medium shrink-0 w-5 text-right">
                          {c.nota}
                        </span>
                      )}
                    </Link>
                  );
                })}
              </div>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
