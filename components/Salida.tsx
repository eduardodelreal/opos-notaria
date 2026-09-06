"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { Boton } from "./ui";
import { Aviso } from "./MarcoAuth";
import { nombreVisible, useSesion } from "./Sesion";
import { clienteNavegador } from "@/lib/supabase/navegador";
import { mensajeAuth } from "@/lib/supabase/errores";

/**
 * Confirmación de cierre de sesión.
 *
 * Se pide confirmación a propósito: `/salir` es un enlace normal de la barra
 * lateral, y un enlace que cierra la sesión con solo tocarlo (o con un
 * prefetch mal medido) es un accidente esperando a pasar.
 */
export function Salida() {
  const router = useRouter();
  const { configurado, cargando, usuario } = useSesion();
  const [saliendo, setSaliendo] = React.useState(false);
  const [error, setError] = React.useState("");

  if (cargando) {
    return <p className="text-[13px] text-muted">Comprobando la sesión…</p>;
  }

  if (!configurado || !usuario) {
    return (
      <div className="space-y-4">
        <Aviso tono="info">No hay ninguna sesión abierta en este navegador.</Aviso>
        <Boton variante="secundario" className="w-full" onClick={() => router.push("/")}>
          Volver al panel
        </Boton>
      </div>
    );
  }

  const salir = async () => {
    const supabase = clienteNavegador();
    if (!supabase) return;
    setError("");
    setSaliendo(true);
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      router.replace("/");
      router.refresh();
    } catch (e) {
      setError(mensajeAuth(e));
      setSaliendo(false);
    }
  };

  return (
    <div className="space-y-4">
      {error && <Aviso tono="error">{error}</Aviso>}

      <p className="text-[13.5px] text-muted leading-relaxed">
        Tienes la sesión abierta como{" "}
        <strong className="text-fg">{nombreVisible(usuario)}</strong>.
      </p>

      <div className="flex gap-2">
        <Boton
          variante="primario"
          className="flex-1"
          onClick={salir}
          cargando={saliendo}
        >
          {!saliendo && <LogOut className="size-4" />}
          Cerrar sesión
        </Boton>
        <Boton variante="fantasma" onClick={() => router.back()} disabled={saliendo}>
          Cancelar
        </Boton>
      </div>
    </div>
  );
}
