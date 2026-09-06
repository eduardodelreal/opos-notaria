"use client";

import Link from "next/link";
import { LogIn, Sparkles } from "lucide-react";
import { Card } from "./ui";
import type { EstadoIA } from "@/lib/ai/hooks";

/* ============================================================
   Por qué no se puede pulsar el botón de IA

   Dos motivos posibles, y conviene distinguirlos porque se arreglan de
   forma distinta:

     1. Falta `ANTHROPIC_API_KEY` en el servidor  → lo arregla quien
        despliega.
     2. Hace falta iniciar sesión                 → lo arregla el opositor,
        y le basta un clic.

   El segundo caso aparece cuando el servidor que atiende la IA tiene
   Supabase configurado: entonces sus rutas exigen sesión, porque cada
   llamada gasta dinero (lib/ai/guardia.ts). Se avisa ANTES de dejar
   pulsar; un botón que falla en silencio es peor que un botón apagado.

   Mismo patrón de aviso que ya usaba el chat para la clave que falta,
   ahora en un solo sitio para las cinco pantallas.
   ============================================================ */

/** El texto del motivo, o `null` si no hay nada que avisar. */
function motivo(ia: EstadoIA): "sesion" | "clave" | null {
  if (ia.cargando) return null;
  // La sesión primero: es lo que el opositor puede resolver él mismo.
  if (ia.bloqueado) return "sesion";
  if (!ia.disponible) return "clave";
  return null;
}

/**
 * Aviso en tarjeta, para pantallas donde la IA es lo principal (el chat).
 * `titulo` permite decir "El chat está apagado" en vez del genérico.
 */
export function AvisoIA({
  ia,
  titulo = "Las funciones de IA están apagadas",
  className = "mb-4",
}: {
  ia: EstadoIA;
  titulo?: string;
  className?: string;
}) {
  const causa = motivo(ia);
  if (!causa) return null;

  if (causa === "sesion") {
    return (
      <Card className={`${className} flex items-start gap-3.5`}>
        <LogIn className="size-4 text-[var(--warn)] shrink-0 mt-0.5" />
        <div>
          <p className="text-[13.5px] font-medium">
            Inicia sesión para usar el preparador
          </p>
          <p className="text-[12.5px] text-muted mt-1 leading-relaxed">
            Las funciones de IA cuestan dinero en cada llamada, así que en esta
            instalación solo responden a quien ha entrado con su cuenta.{" "}
            <Link href="/entrar" className="text-[var(--laton)] hover:underline">
              Entrar
            </Link>
            . El resto de la app funciona igual sin sesión.
          </p>
        </div>
      </Card>
    );
  }

  return (
    <Card className={`${className} flex items-start gap-3.5`}>
      <Sparkles className="size-4 text-[var(--warn)] shrink-0 mt-0.5" />
      <div>
        <p className="text-[13.5px] font-medium">{titulo}</p>
        <p className="text-[12.5px] text-muted mt-1 leading-relaxed">
          Copia <code className="text-[var(--laton)]">.env.example</code> a{" "}
          <code className="text-[var(--laton)]">.env.local</code>, pon tu{" "}
          <code className="text-[var(--laton)]">ANTHROPIC_API_KEY</code> y reinicia el
          servidor. El resto de la app funciona igual sin clave.
        </p>
      </div>
    </Card>
  );
}

/**
 * La misma información en una línea, para ponerla al lado de un botón
 * apagado (fichas de tema, cantes, simulacros). Devuelve `null` si no hay
 * nada que decir.
 */
export function NotaIA({ ia, className = "" }: { ia: EstadoIA; className?: string }) {
  const causa = motivo(ia);
  if (!causa) return null;

  return (
    <span className={`text-[12px] text-subtle leading-relaxed max-w-md ${className}`}>
      {causa === "sesion" ? (
        <>
          Hace falta iniciar sesión para usar la IA: cada llamada cuesta dinero.{" "}
          <Link href="/entrar" className="text-[var(--laton)] hover:underline">
            Entrar
          </Link>
          .
        </>
      ) : (
        <>Configura ANTHROPIC_API_KEY en el servidor para activar esto.</>
      )}
    </span>
  );
}
