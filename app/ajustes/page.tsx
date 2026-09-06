"use client";

import * as React from "react";
import { Download, Moon, Sun, Trash2, Upload } from "lucide-react";
import { useCantes, useKeyPoints, useSesiones, useStore, useTemas } from "@/lib/store/store";
import { Cabecera } from "@/components/Shell";
import {
  Boton,
  Campo,
  Card,
  Selector,
  TituloSeccion,
  cx,
  useConfirmacion,
} from "@/components/ui";
import { AvisoSinCuenta, TarjetaSincronizacion } from "@/components/Sincronizacion";
import type { Perfil } from "@/lib/data/types";

export default function Ajustes() {
  const perfil = useStore((s) => s.perfil);
  const sesiones = useSesiones();
  const temas = useTemas();
  const cantes = useCantes();
  const keypoints = useKeyPoints();
  const setPerfil = useStore((s) => s.setPerfil);
  const exportar = useStore((s) => s.exportar);
  const importar = useStore((s) => s.importar);
  const borrarTodo = useStore((s) => s.borrarTodo);
  const { pedir, dialogo } = useConfirmacion();

  const [mensaje, setMensaje] = React.useState<{ ok: boolean; texto: string } | null>(
    null,
  );
  const inputRef = React.useRef<HTMLInputElement>(null);

  const descargar = () => {
    const blob = new Blob([exportar()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `opos-notaria-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setMensaje({ ok: true, texto: "Copia descargada." });
  };

  const subir = async (archivo: File) => {
    const texto = await archivo.text();
    const r = importar(texto);
    setMensaje(
      r.ok
        ? { ok: true, texto: "Expediente importado." }
        : { ok: false, texto: r.error ?? "No se ha podido importar." },
    );
  };

  return (
    <>
      <Cabecera
        titulo="Ajustes"
        descripcion="Tu perfil, tus objetivos y tus datos. Todo se guarda en este navegador; nada sale de aquí salvo lo que mandas a la IA cuando la usas."
      />

      <div className="grid lg:grid-cols-2 gap-4">
        {/* -------------------------------- Perfil ---------------------------- */}
        <Card>
          <TituloSeccion>Perfil</TituloSeccion>
          <div className="space-y-4">
            <Campo
              etiqueta="Cómo te llamas"
              value={perfil.nombre}
              onChange={(e) => setPerfil({ nombre: e.target.value })}
              placeholder="Tu nombre"
            />
            <Selector
              etiqueta="Oposición"
              value={perfil.oposicion}
              onChange={(e) =>
                setPerfil({ oposicion: e.target.value as Perfil["oposicion"] })
              }
            >
              <option value="notarias">Notarías</option>
              <option value="registros">Registros de la Propiedad</option>
              <option value="judicatura">Judicatura / Fiscales</option>
            </Selector>
            <Campo
              etiqueta="Preparador"
              value={perfil.preparador ?? ""}
              onChange={(e) => setPerfil({ preparador: e.target.value })}
              placeholder="Nombre de tu preparador (opcional)"
            />
            <div className="grid grid-cols-2 gap-3">
              <Campo
                etiqueta="Empecé la oposición"
                type="date"
                value={new Date(perfil.fechaInicio).toISOString().slice(0, 10)}
                onChange={(e) =>
                  setPerfil({ fechaInicio: new Date(e.target.value).getTime() })
                }
              />
              <Campo
                etiqueta="Examen objetivo"
                type="date"
                value={perfil.fechaExamen ?? ""}
                onChange={(e) => setPerfil({ fechaExamen: e.target.value })}
                pista="Se usa para avisarte si no llegas"
              />
            </div>
          </div>
        </Card>

        {/* ------------------------------ Objetivos --------------------------- */}
        <Card>
          <TituloSeccion>Objetivos y reglas</TituloSeccion>
          <div className="space-y-4">
            <Campo
              etiqueta="Horas de estudio por semana"
              type="number"
              min={1}
              max={100}
              value={perfil.objetivoHorasSemana}
              onChange={(e) =>
                setPerfil({ objetivoHorasSemana: Number(e.target.value) || 40 })
              }
              pista="Sé honesto: el plan de la IA se construye sobre lo que haces, no sobre lo que te propones"
            />
            <Campo
              etiqueta="Minutos por tema en el cante"
              type="number"
              min={1}
              max={60}
              value={perfil.minutosPorTema}
              onChange={(e) =>
                setPerfil({ minutosPorTema: Number(e.target.value) || 10 })
              }
              pista="El tiempo que da tu tribunal. Marca la línea roja del modo cante"
            />
            <Campo
              etiqueta="Días para marcar un tema como oxidado"
              type="number"
              min={7}
              max={365}
              value={perfil.diasOxido}
              onChange={(e) => setPerfil({ diasOxido: Number(e.target.value) || 45 })}
              pista="Un tema dominado que lleva más de este tiempo sin tocarse se pinta en rojo"
            />
            <Selector
              etiqueta="Cómo quieres el feedback de la IA"
              value={perfil.estiloFeedback}
              onChange={(e) =>
                setPerfil({
                  estiloFeedback: e.target.value as Perfil["estiloFeedback"],
                })
              }
            >
              <option value="directo">Directo — al fallo, sin rodeos</option>
              <option value="equilibrado">Equilibrado — exigente y constructivo</option>
              <option value="amable">Amable — exigente pero cuidando la moral</option>
            </Selector>
          </div>
        </Card>

        {/* ------------------------------ Apariencia -------------------------- */}
        <Card>
          <TituloSeccion>Apariencia</TituloSeccion>
          <div className="grid grid-cols-2 gap-3">
            {(
              [
                { id: "dark", label: "Oscuro", icono: Moon },
                { id: "light", label: "Claro", icono: Sun },
              ] as const
            ).map((t) => {
              const Icono = t.icono;
              return (
                <button
                  key={t.id}
                  onClick={() => setPerfil({ tema: t.id })}
                  className={cx(
                    "h-20 rounded-[12px] border flex flex-col items-center justify-center gap-2 transition-all",
                    perfil.tema === t.id
                      ? "border-[var(--laton)] bg-[var(--laton-soft)]"
                      : "border-[var(--border)] text-muted hover:text-fg",
                  )}
                >
                  <Icono className="size-5" />
                  <span className="text-[13px]">{t.label}</span>
                </button>
              );
            })}
          </div>
        </Card>

        {/* -------------------------------- Datos ----------------------------- */}
        <Card>
          <TituloSeccion>Tus datos</TituloSeccion>
          <div className="grid grid-cols-4 gap-3 mb-5 text-center">
            {[
              { v: temas.length, l: "temas" },
              { v: cantes.length, l: "cantes" },
              { v: sesiones.length, l: "sesiones" },
              { v: keypoints.length, l: "keypoints" },
            ].map((x) => (
              <div key={x.l}>
                <div className="numeric text-[20px] font-semibold">{x.v}</div>
                <div className="text-[10.5px] uppercase tracking-[0.1em] text-subtle mt-1">
                  {x.l}
                </div>
              </div>
            ))}
          </div>

          <p className="text-[12.5px] text-muted leading-relaxed mb-4">
            Todo vive en IndexedDB, en este navegador. Si formateas el equipo o borras
            los datos del sitio, se pierde: descarga una copia de vez en cuando.
          </p>

          <AvisoSinCuenta className="mb-4" />

          <div className="flex flex-wrap gap-2">
            <Boton variante="secundario" onClick={descargar}>
              <Download className="size-4" />
              Descargar copia
            </Boton>
            <Boton variante="secundario" onClick={() => inputRef.current?.click()}>
              <Upload className="size-4" />
              Importar
            </Boton>
            <input
              ref={inputRef}
              type="file"
              accept="application/json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) subir(f);
                e.target.value = "";
              }}
            />
            <Boton
              variante="peligro"
              onClick={() =>
                pedir(
                  "Borrar todo",
                  "Se borran temas, cantes, sesiones, keypoints, notas y simulacros. No hay vuelta atrás. Descarga una copia antes si tienes dudas.",
                  borrarTodo,
                )
              }
            >
              <Trash2 className="size-4" />
              Borrar todo
            </Boton>
          </div>

          {mensaje && (
            <p
              className="text-[12.5px] mt-3"
              style={{ color: mensaje.ok ? "var(--ok)" : "var(--danger)" }}
            >
              {mensaje.texto}
            </p>
          )}
        </Card>
      </div>

      <TarjetaSincronizacion className="mt-4" />

      <Card className="mt-4">
        <TituloSeccion>Sobre la IA</TituloSeccion>
        <p className="text-[13px] text-muted leading-relaxed">
          Las funciones de IA (análisis de cantes, chat, plan semanal, keypoints y
          corrección de dictámenes) llaman a la API de Anthropic desde el servidor de
          la app, con la clave que pongas en{" "}
          <code className="text-[var(--laton)]">.env.local</code>. En cada llamada se
          envía tu ficha: temas, estados, horas, cantes, notas y epígrafes fallados.
          No se manda el texto completo de tus temas salvo cuando pides extraer
          keypoints de un tema concreto o corregir un dictamen. Sin clave, la app
          funciona entera menos esas funciones.
        </p>
      </Card>

      {dialogo}
    </>
  );
}
