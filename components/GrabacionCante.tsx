"use client";

import * as React from "react";
import { ChevronDown, CloudUpload, HardDrive, Mic, ScanSearch } from "lucide-react";
import { Badge, Boton, TituloSeccion, cx } from "./ui";
import { TarjetaComparacion } from "./TarjetaComparacion";
import { useStore } from "@/lib/store/store";
import { descargarAudio, fuenteDeAudio } from "@/lib/audio/subida";
import { llamarIA, pedirIA, useIA } from "@/lib/ai/hooks";
import { NotaIA } from "./AvisoIA";
import {
  construirComparacion,
  hayTextoDeTema,
  pistaDeTema,
} from "@/lib/ai/contexto";
import type {
  Cante,
  ComparacionCante,
  Perfil,
  Tema,
  TranscripcionCante,
} from "@/lib/data/types";
import { reloj } from "@/lib/utils/time";

/* ============================================================
   La grabación de un cante, en la ficha del tema

   Tres cosas en este orden, que es el del valor:

     1. escucharla,
     2. leer lo que dijiste,
     3. ver qué te saltaste.

   Cada paso se pide a mano. Transcribir cuesta dinero y comparar también:
   nada se dispara solo al abrir la ficha.
   ============================================================ */

export function GrabacionCante({
  cante,
  tema,
  estilo,
}: {
  cante: Cante;
  tema: Tema;
  estilo: Perfil["estiloFeedback"];
}) {
  const ia = useIA();
  const setTranscripcion = useStore((s) => s.setTranscripcionCante);
  const setComparacion = useStore((s) => s.setComparacionCante);

  const [fuente, setFuente] = React.useState<{ url: string; local: boolean } | null>(
    null,
  );
  const [buscando, setBuscando] = React.useState(true);
  const [trabajando, setTrabajando] = React.useState<"texto" | "comparar" | null>(
    null,
  );
  const [error, setError] = React.useState<string | null>(null);
  const [verTexto, setVerTexto] = React.useState(false);
  const audioRef = React.useRef<HTMLAudioElement | null>(null);

  /* ----------------------------- la fuente ----------------------------- */
  // Depende solo del id y de la ruta, NO del objeto `cante`: guardar la
  // transcripción crea un cante nuevo y con él se rehacía la fuente, que
  // rebobinaba el reproductor en mitad de la escucha.
  const canteId = cante.id;
  const path = cante.audio?.path;
  React.useEffect(() => {
    let vivo = true;
    let revocar: (() => void) | undefined;
    setBuscando(true);
    void fuenteDeAudio(canteId, path).then((f) => {
      if (!vivo) {
        // Llegó tarde (el componente ya no está): soltar el object URL o se
        // queda el blob entero retenido en memoria.
        f?.revocar?.();
        return;
      }
      revocar = f?.revocar;
      setFuente(f ? { url: f.url, local: f.local } : null);
      setBuscando(false);
    });
    return () => {
      vivo = false;
      revocar?.();
    };
  }, [canteId, path]);

  const marcas = cante.audio?.marcas ?? [];
  const conTexto = hayTextoDeTema(tema);

  /* ------------------------------ acciones ----------------------------- */

  const transcribir = async () => {
    setTrabajando("texto");
    setError(null);
    try {
      const blob = await descargarAudio(cante);
      if (!blob) {
        setError(
          "La grabación no está en este dispositivo y no se ha podido descargar de la nube.",
        );
        return;
      }
      const cuerpo = new FormData();
      cuerpo.append("audio", blob, `cante-${cante.id}`);
      // Vocabulario del tema: sin esto el transcriptor destroza los
      // tecnicismos y luego se cuentan como lagunas que no existieron.
      cuerpo.append("pista", pistaDeTema(tema));

      // FormData sin `Content-Type` a mano: lo pone el navegador con su
      // frontera multipart. `llamarIA` solo añade la cabecera de sesión.
      const r = await llamarIA("/api/ai/transcribir", {
        method: "POST",
        body: cuerpo,
      });
      const d = await r.json();
      if (!r.ok) {
        setError(d.mensaje ?? "No se ha podido transcribir la grabación.");
        return;
      }
      const t = d.transcripcion as { texto: string; segundos?: number; motor: string };
      setTranscripcion(cante.id, {
        texto: t.texto,
        segundos: t.segundos,
        motor: t.motor,
        generado: Date.now(),
      } satisfies TranscripcionCante);
      setVerTexto(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setTrabajando(null);
    }
  };

  const comparar = async () => {
    if (!cante.transcripcion) return;
    setTrabajando("comparar");
    setError(null);
    try {
      const r = await pedirIA("/api/ai/comparar-cante", {
        comparacion: construirComparacion(cante, tema, cante.transcripcion),
        estilo,
      });
      const d = await r.json();
      if (!r.ok) {
        setError(d.mensaje ?? "No se ha podido comparar el cante con el tema.");
        return;
      }
      setComparacion(cante.id, {
        ...(d.comparacion as ComparacionCante),
        generado: Date.now(),
        modelo: d.modelo,
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setTrabajando(null);
    }
  };

  const saltarA = (ms: number) => {
    const el = audioRef.current;
    if (!el) return;
    el.currentTime = ms / 1000;
    void el.play().catch(() => {
      /* el navegador puede negarse a reproducir sin gesto; no es un error */
    });
  };

  if (buscando) return null;

  // Ni blob local ni objeto en la nube: este cante no tiene audio y no hay
  // nada que enseñar. No se pinta un hueco vacío.
  if (!fuente && !cante.audio) return null;

  return (
    <div>
      <TituloSeccion>
        <span className="inline-flex items-center gap-2">
          <Mic className="size-3.5" />
          Grabación
        </span>
      </TituloSeccion>

      <div className="flex flex-wrap items-center gap-2 mb-3">
        {cante.audio?.subido ? (
          <Badge color="var(--ok)">
            <CloudUpload className="size-3" />
            copia en la nube
          </Badge>
        ) : (
          <Badge color="var(--fg-subtle)">
            <HardDrive className="size-3" />
            solo en este equipo
          </Badge>
        )}
        {cante.audio?.segundos != null && (
          <span className="text-[12px] text-subtle numeric">
            {reloj(cante.audio.segundos)}
          </span>
        )}
        {fuente && !fuente.local && (
          <span className="text-[12px] text-subtle">descargada de la nube</span>
        )}
      </div>

      {fuente ? (
        <audio
          ref={audioRef}
          src={fuente.url}
          controls
          preload="metadata"
          data-cante={cante.id}
          className="w-full h-10 mb-3"
        />
      ) : (
        <p className="text-[13px] text-muted mb-3 leading-relaxed">
          La grabación está subida pero no se ha podido abrir ahora mismo.
          Vuelve a intentarlo cuando haya conexión.
        </p>
      )}

      {marcas.length > 1 && (
        <div className="flex flex-wrap gap-1.5 mb-4">
          {marcas.map((m, i) => (
            <button
              key={i}
              type="button"
              onClick={() => saltarA(m.desdeMs)}
              title={`Ir a ${reloj(Math.round(m.desdeMs / 1000))}`}
              className="h-7 px-2.5 rounded-full border border-[var(--border)] text-[11.5px] text-muted hover:text-fg hover:border-[var(--border-strong)] transition-colors inline-flex items-center gap-1.5 max-w-full"
            >
              <span className="numeric text-[10.5px] text-subtle">
                {reloj(Math.round(m.desdeMs / 1000))}
              </span>
              <span className="truncate max-w-[16ch]">{m.titulo}</span>
            </button>
          ))}
        </div>
      )}

      {error && (
        <p className="text-[13px] text-[var(--warn)] mb-3 leading-relaxed">{error}</p>
      )}

      {/* --------------------------- transcripción --------------------------- */}
      {cante.transcripcion ? (
        <div className="mb-4">
          <button
            type="button"
            onClick={() => setVerTexto((v) => !v)}
            className="w-full flex items-center justify-between gap-3 text-left py-2 group"
          >
            <span className="text-[13px] font-medium">
              Transcripción de lo que dijiste
            </span>
            <ChevronDown
              className={cx(
                "size-4 text-subtle transition-transform shrink-0",
                verTexto && "rotate-180",
              )}
            />
          </button>
          {verTexto && (
            <div className="rounded-[10px] border border-[var(--border)] bg-[var(--surface-2)] px-4 py-3.5">
              <p className="font-serif text-[13.5px] leading-relaxed whitespace-pre-wrap">
                {cante.transcripcion.texto}
              </p>
              <p className="text-[10.5px] text-subtle mt-3">
                Transcrita con {cante.transcripcion.motor}. Automática: los
                tecnicismos y las cifras pueden venir mal.
              </p>
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <Boton
            variante="secundario"
            onClick={transcribir}
            cargando={trabajando === "texto"}
            disabled={!ia.transcripcion || ia.bloqueado || trabajando !== null || !fuente}
          >
            {trabajando === "texto" ? "Transcribiendo…" : "Transcribir el cante"}
          </Boton>
          {/* Falta sesión antes que falta proveedor: es lo que el opositor
              puede arreglar él mismo, y transcribir también cuesta dinero. */}
          {ia.bloqueado && <NotaIA ia={ia} />}
          {!ia.bloqueado && !ia.transcripcion && !ia.cargando && (
            <span className="text-[12px] text-subtle leading-relaxed max-w-md">
              No hay servicio de transcripción configurado. La API de Anthropic no
              acepta audio: hace falta un proveedor compatible con Whisper
              (TRANSCRIPCION_API_KEY). Escuchar la grabación funciona igual.
            </span>
          )}
        </div>
      )}

      {/* ---------------------------- comparación ---------------------------- */}
      {cante.comparacion ? (
        <TarjetaComparacion comparacion={cante.comparacion} />
      ) : (
        cante.transcripcion && (
          <div className="flex flex-wrap items-center gap-3">
            <Boton
              variante="oro"
              onClick={comparar}
              cargando={trabajando === "comparar"}
              disabled={!ia.listo || !conTexto || trabajando !== null}
            >
              <ScanSearch className="size-4" />
              {trabajando === "comparar"
                ? "Comparando…"
                : "Comparar con el texto del tema"}
            </Boton>
            {!conTexto && (
              <span className="text-[12px] text-subtle leading-relaxed max-w-md">
                Para comparar hace falta el texto del tema: pégalo en la pestaña
                Epígrafes y vuelve aquí.
              </span>
            )}
            {conTexto && <NotaIA ia={ia} />}
          </div>
        )
      )}
    </div>
  );
}
