"use client";

import * as React from "react";
import Link from "next/link";
import {
  CalendarRange,
  Eraser,
  MessageSquareQuote,
  Send,
  Sparkles,
  Square,
} from "lucide-react";
import { useCantes, useProgresos, useSesiones, useStore, useTemas } from "@/lib/store/store";
import { Cabecera } from "@/components/Shell";
import { Boton, Card, TituloSeccion, Vacio, cx } from "@/components/ui";
import { useFicha, useIA, pedirIA } from "@/lib/ai/hooks";
import { AvisoIA } from "@/components/AvisoIA";
import { FIN_RESPUESTA } from "@/lib/ai/protocolo";
import { resumenGlobal } from "@/lib/data/srs";
import { horas } from "@/lib/utils/time";

const SUGERENCIAS = [
  {
    icono: CalendarRange,
    texto: "¿Qué estudio esta semana?",
    prompt:
      "Mírame la ficha y dime qué debería estudiar esta semana, día a día, con temas concretos.",
  },
  {
    icono: Sparkles,
    texto: "¿Dónde estoy fallando?",
    prompt:
      "Analiza mis datos y dime en qué estoy fallando de verdad. Sé duro si hace falta.",
  },
  {
    icono: MessageSquareQuote,
    texto: "¿Llego al examen?",
    prompt:
      "Con mi ritmo actual, ¿llego a la próxima convocatoria? Si no llego, dime qué tendría que cambiar.",
  },
];

export default function Chat() {
  const ia = useIA();
  const ficha = useFicha();
  // Un selector por campo: con `useStore()` a pelo, la pagina se re-renderiza
  // ante cualquier cambio del store, venga de donde venga.
  const chat = useStore((s) => s.chat);
  const perfil = useStore((s) => s.perfil);
  const temas = useTemas();
  const progresos = useProgresos();
  const sesiones = useSesiones();
  const cantes = useCantes();
  const addMensaje = useStore((s) => s.addMensaje);
  const limpiar = useStore((s) => s.limpiarChat);

  const [entrada, setEntrada] = React.useState("");
  const [generando, setGenerando] = React.useState(false);
  // La respuesta en curso vive en estado local, no en el store. Escribirla en
  // el store token a token serializaria el expediente entero en IndexedDB en
  // cada chunk: cientos de KB por token en cuanto llevas unos meses de datos.
  const [borrador, setBorrador] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const abortRef = React.useRef<AbortController | null>(null);
  const finRef = React.useRef<HTMLDivElement>(null);

  const resumen = React.useMemo(
    () => resumenGlobal(temas, progresos, sesiones, cantes, perfil.diasOxido),
    [temas, progresos, sesiones, cantes, perfil.diasOxido],
  );

  React.useEffect(() => {
    finRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [chat, borrador]);

  const enviar = async (texto: string) => {
    const limpio = texto.trim();
    if (!limpio || generando) return;

    setEntrada("");
    setError(null);
    addMensaje({ rol: "user", texto: limpio });

    const historial = [
      ...useStore.getState().chat.map((m) => ({ rol: m.rol, texto: m.texto })),
    ];

    setBorrador("");
    setGenerando(true);

    const controlador = new AbortController();
    abortRef.current = controlador;
    let acumulado = "";
    let completa = false;

    try {
      // `pedirIA` añade el token de sesión; el streaming se lee igual
      // porque devuelve la Response cruda, sin tocar el cuerpo.
      const r = await pedirIA(
        "/api/ai/chat",
        {
          mensajes: historial,
          ficha: ficha(),
          estilo: perfil.estiloFeedback,
        },
        { signal: controlador.signal },
      );

      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setError(d.mensaje ?? "El modelo no ha podido responder.");
        return;
      }

      const reader = r.body?.getReader();
      if (!reader) throw new Error("Respuesta vacía del servidor.");
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        acumulado += decoder.decode(value, { stream: true });
        setBorrador(acumulado);
      }

      // El servidor cierra con un centinela. Si no llega, la conexión se
      // cortó a medias (tope de una función serverless, red caída) y hay
      // que decirlo en vez de guardar media respuesta como si fuera entera.
      completa = acumulado.endsWith(FIN_RESPUESTA);
      acumulado = acumulado.replaceAll(FIN_RESPUESTA, "");
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        setError((e as Error).message);
      }
    } finally {
      setGenerando(false);
      abortRef.current = null;
      // El borrador se vuelca al store UNA sola vez, al terminar.
      const final = acumulado.replaceAll(FIN_RESPUESTA, "").trim();
      if (final) {
        addMensaje({
          rol: "assistant",
          texto: completa
            ? final
            : `${final}\n\n[Respuesta cortada antes de terminar. Vuelve a preguntar o pide que continúe.]`,
        });
      }
      setBorrador(null);
    }
  };

  const parar = () => abortRef.current?.abort();

  return (
    <>
      <Cabecera
        titulo="Preparador IA"
        descripcion="Habla con él como con tu preparador. En cada mensaje recibe tu ficha completa: temas, horas, cantes, notas y epígrafes que fallas."
        acciones={
          chat.length > 0 && (
            <Boton variante="fantasma" onClick={limpiar}>
              <Eraser className="size-4" />
              Vaciar
            </Boton>
          )
        }
      />

      <AvisoIA ia={ia} titulo="El chat está apagado" />

      <Card className="p-0 overflow-hidden flex flex-col" style={{ minHeight: "60vh" }}>
        <div className="flex-1 overflow-y-auto px-5 sm:px-7 py-6 space-y-6 max-h-[62vh]">
          {chat.length === 0 ? (
            <div className="py-8">
              <Vacio
                icono={<MessageSquareQuote className="size-5" />}
                titulo={
                  temas.length
                    ? "Pregúntale lo que le preguntarías a tu preparador"
                    : "Primero da de alta tus temas"
                }
                texto={
                  temas.length
                    ? `Conoce tus ${resumen.totalTemas} temas, tus ${horas(resumen.segundosTotales)} h y tus ${resumen.cantesTotales} cantes. No te va a dar consejos de manual.`
                    : "Sin datos solo puede darte generalidades. Monta el programa y vuelve."
                }
                accion={
                  !temas.length && (
                    <Link href="/programa">
                      <Boton variante="primario">Añadir temas</Boton>
                    </Link>
                  )
                }
              />

              {temas.length > 0 && (
                <div className="grid sm:grid-cols-3 gap-2.5 mt-2 max-w-2xl mx-auto">
                  {SUGERENCIAS.map((s) => {
                    const Icono = s.icono;
                    return (
                      <button
                        key={s.texto}
                        onClick={() => enviar(s.prompt)}
                        disabled={!ia.listo}
                        className="text-left px-4 py-3.5 rounded-[10px] border border-[var(--border)] bg-[var(--surface-2)] hover:border-[var(--border-strong)] transition-colors disabled:opacity-40 disabled:pointer-events-none"
                      >
                        <Icono className="size-4 text-[var(--laton)] mb-2.5" />
                        <span className="text-[13px] block leading-snug">
                          {s.texto}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            chat.map((m) => <Burbuja key={m.id} rol={m.rol} texto={m.texto} />)
          )}

          {borrador !== null && (
            <Burbuja rol="assistant" texto={borrador} escribiendo />
          )}
          <div ref={finRef} />
        </div>

        {error && (
          <div className="px-5 sm:px-7 pb-3">
            <p className="text-[12.5px] text-[var(--danger)]">{error}</p>
          </div>
        )}

        <div className="border-t border-[var(--border)] p-3.5 sm:p-4">
          <div className="flex items-end gap-2.5">
            <textarea
              value={entrada}
              onChange={(e) => setEntrada(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  enviar(entrada);
                }
              }}
              rows={1}
              disabled={!ia.listo}
              placeholder={
                ia.listo
                  ? "Pregunta lo que quieras sobre tu preparación…"
                  : ia.bloqueado
                    ? "Inicia sesión para escribir al preparador"
                    : "Configura ANTHROPIC_API_KEY para escribir"
              }
              className="flex-1 bg-[var(--bg-elevated)] border border-[var(--border)] rounded-[12px] px-4 py-3 text-[14px] resize-none outline-none focus:border-[var(--border-strong)] transition-colors max-h-40 disabled:opacity-50"
              style={{ minHeight: 46 }}
            />
            {generando ? (
              <Boton variante="secundario" tam="lg" onClick={parar} className="px-4">
                <Square className="size-4" />
              </Boton>
            ) : (
              <Boton
                variante="primario"
                tam="lg"
                onClick={() => enviar(entrada)}
                disabled={!entrada.trim() || !ia.listo}
                className="px-4"
              >
                <Send className="size-4" />
              </Boton>
            )}
          </div>
          <p className="text-[11px] text-subtle mt-2.5 leading-relaxed">
            Orientativo. Sobre el contenido jurídico mandan tu temario y tu preparador,
            no el modelo.
          </p>
        </div>
      </Card>
    </>
  );
}

/** Una intervención de la conversación. Se usa igual para los mensajes ya
 *  guardados y para la respuesta que está llegando en streaming. */
function Burbuja({
  rol,
  texto,
  escribiendo,
}: {
  rol: "user" | "assistant";
  texto: string;
  escribiendo?: boolean;
}) {
  return (
    <div className={cx("flex", rol === "user" ? "justify-end" : "justify-start")}>
      <div
        className={cx(
          "max-w-[85%] rounded-[14px] px-4 py-3",
          rol === "user"
            ? "bg-[var(--surface-3)]"
            : "bg-transparent border border-[var(--border)]",
        )}
      >
        {rol === "assistant" && (
          <div className="flex items-center gap-2 mb-2">
            <Sparkles className="size-3 text-[var(--laton)]" />
            <span className="text-[10px] uppercase tracking-[0.14em] text-subtle">
              Preparador
            </span>
          </div>
        )}
        <div className="text-[14px] leading-[1.7] whitespace-pre-wrap">
          {texto}
          {escribiendo && (
            <span className="inline-block w-[2px] h-[15px] bg-[var(--laton)] ml-0.5 align-middle animate-pulse" />
          )}
        </div>
      </div>
    </div>
  );
}
