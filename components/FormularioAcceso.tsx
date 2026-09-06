"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LogIn, Mail, UserPlus } from "lucide-react";
import { Boton, Campo } from "./ui";
import { Aviso } from "./MarcoAuth";
import { useSesion, nombreVisible } from "./Sesion";
import { clienteNavegador } from "@/lib/supabase/navegador";
import { mensajeAuth } from "@/lib/supabase/errores";
import { PARAM_DESTINO, rutaSegura } from "@/lib/supabase/destino";
import { SIN_SUPABASE } from "@/lib/supabase/config";

type Modo = "entrar" | "crear";

/**
 * El formulario de entrar / crear cuenta. Es el mismo con dos textos: lo que
 * cambia entre ambos es una llamada y un par de rótulos, no la pantalla.
 *
 * Iniciar sesión es **opcional** en toda la app: sirve para poder sincronizar
 * el expediente entre dispositivos, no para desbloquear nada.
 */
export function FormularioAcceso({ modo }: { modo: Modo }) {
  const router = useRouter();
  const { configurado, cargando: cargandoSesion, usuario } = useSesion();

  const [correo, setCorreo] = React.useState("");
  const [clave, setClave] = React.useState("");
  const [nombre, setNombre] = React.useState("");
  const [enviando, setEnviando] = React.useState<null | "correo" | "google">(null);
  const [error, setError] = React.useState("");
  const [aviso, setAviso] = React.useState("");

  // El callback de OAuth y el de confirmación devuelven aquí los fallos.
  // Se lee después de montar para no desincronizar la hidratación.
  React.useEffect(() => {
    const p = new URLSearchParams(window.location.search).get("error");
    if (p) setError(p);
  }, []);

  const destino = () =>
    rutaSegura(new URLSearchParams(window.location.search).get(PARAM_DESTINO));

  const urlCallback = () =>
    `${window.location.origin}/auth/callback?${PARAM_DESTINO}=${encodeURIComponent(destino())}`;

  /* ------------------------------ sin Supabase ----------------------------- */

  if (!configurado && !cargandoSesion) {
    return (
      <div className="space-y-4">
        <Aviso tono="info">{SIN_SUPABASE}</Aviso>
        <p className="text-[13px] text-muted leading-relaxed">
          Para activar las cuentas hace falta rellenar{" "}
          <code className="text-[12px] text-fg">NEXT_PUBLIC_SUPABASE_URL</code> y{" "}
          <code className="text-[12px] text-fg">NEXT_PUBLIC_SUPABASE_ANON_KEY</code>{" "}
          y volver a compilar. Lo tienes explicado en{" "}
          <code className="text-[12px] text-fg">.env.example</code>.
        </p>
        <Boton variante="secundario" className="w-full" onClick={() => router.push("/")}>
          Seguir en local
        </Boton>
      </div>
    );
  }

  /* ---------------------------- ya hay sesión ------------------------------ */

  if (usuario) {
    return (
      <div className="space-y-4">
        <Aviso tono="ok">
          Ya has entrado como <strong>{nombreVisible(usuario)}</strong>.
        </Aviso>
        <div className="flex gap-2">
          <Boton variante="primario" className="flex-1" onClick={() => router.push("/")}>
            Ir al panel
          </Boton>
          <Boton variante="secundario" onClick={() => router.push("/salir")}>
            Cerrar sesión
          </Boton>
        </div>
      </div>
    );
  }

  /* -------------------------------- acciones ------------------------------- */

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    const supabase = clienteNavegador();
    if (!supabase) return;

    setError("");
    setAviso("");
    setEnviando("correo");

    try {
      if (modo === "entrar") {
        const { error } = await supabase.auth.signInWithPassword({
          email: correo.trim(),
          password: clave,
        });
        if (error) throw error;
        router.replace(destino());
        router.refresh();
        return;
      }

      const { data, error } = await supabase.auth.signUp({
        email: correo.trim(),
        password: clave,
        options: {
          emailRedirectTo: urlCallback(),
          data: nombre.trim() ? { nombre: nombre.trim() } : undefined,
        },
      });
      if (error) throw error;

      if (data.session) {
        // El proyecto no exige confirmar el correo: dentro directamente.
        router.replace(destino());
        router.refresh();
        return;
      }

      setAviso(
        `Te hemos mandado un correo a ${correo.trim()}. Abre el enlace para confirmar la cuenta y ya podrás entrar.`,
      );
      setClave("");
    } catch (err) {
      setError(mensajeAuth(err));
    } finally {
      setEnviando(null);
    }
  };

  const conGoogle = async () => {
    const supabase = clienteNavegador();
    if (!supabase) return;

    setError("");
    setAviso("");
    setEnviando("google");
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: urlCallback() },
      });
      if (error) throw error;
      // Si no hay error, el navegador ya se está yendo a Google.
    } catch (err) {
      setError(mensajeAuth(err));
      setEnviando(null);
    }
  };

  /* ------------------------------- formulario ------------------------------ */

  const esCrear = modo === "crear";

  return (
    <form onSubmit={enviar} className="space-y-4">
      {error && <Aviso tono="error">{error}</Aviso>}
      {aviso && <Aviso tono="ok">{aviso}</Aviso>}

      {esCrear && (
        <Campo
          etiqueta="Cómo te llamas"
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          placeholder="Tu nombre"
          autoComplete="name"
        />
      )}

      <Campo
        etiqueta="Correo"
        type="email"
        required
        value={correo}
        onChange={(e) => setCorreo(e.target.value)}
        placeholder="tu@correo.es"
        autoComplete="email"
        autoFocus={!esCrear}
      />

      <Campo
        etiqueta="Contraseña"
        type="password"
        required
        minLength={esCrear ? 8 : undefined}
        value={clave}
        onChange={(e) => setClave(e.target.value)}
        placeholder="••••••••"
        autoComplete={esCrear ? "new-password" : "current-password"}
        pista={esCrear ? "Ocho caracteres como mínimo." : undefined}
      />

      <Boton
        type="submit"
        variante="primario"
        tam="lg"
        className="w-full"
        cargando={enviando === "correo"}
        disabled={enviando !== null}
      >
        {enviando !== "correo" &&
          (esCrear ? <UserPlus className="size-4" /> : <LogIn className="size-4" />)}
        {esCrear ? "Crear cuenta" : "Entrar"}
      </Boton>

      <div className="flex items-center gap-3 py-0.5">
        <span className="hairline flex-1" />
        <span className="text-[11px] uppercase tracking-[0.14em] text-subtle">o</span>
        <span className="hairline flex-1" />
      </div>

      <Boton
        type="button"
        variante="secundario"
        tam="lg"
        className="w-full"
        onClick={conGoogle}
        cargando={enviando === "google"}
        disabled={enviando !== null}
      >
        {enviando !== "google" && <LogoGoogle />}
        Continuar con Google
      </Boton>

      <p className="text-[11.5px] text-subtle leading-relaxed pt-1">
        <Mail className="inline size-3 mr-1 -mt-0.5" />
        La cuenta solo sirve para guardar tu expediente en la nube y poder
        seguirlo en otro dispositivo. Sin cuenta la app funciona igual, en este
        navegador.
      </p>

      <div className="text-center text-[13px] text-muted pt-1">
        {esCrear ? (
          <>
            ¿Ya tienes cuenta?{" "}
            <Link href="/entrar" className="text-[var(--laton)] hover:underline">
              Entrar
            </Link>
          </>
        ) : (
          <>
            ¿Todavía no tienes cuenta?{" "}
            <Link href="/crear-cuenta" className="text-[var(--laton)] hover:underline">
              Crear una
            </Link>
          </>
        )}
      </div>
    </form>
  );
}

/** La G de Google, con sus colores de marca. */
function LogoGoogle() {
  return (
    <svg viewBox="0 0 48 48" className="size-4 shrink-0" aria-hidden>
      <path
        fill="#4285F4"
        d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z"
      />
      <path
        fill="#34A853"
        d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z"
      />
      <path
        fill="#FBBC05"
        d="M11.69 28.18c-.44-1.32-.69-2.73-.69-4.18s.25-2.86.69-4.18v-5.7H4.34A21.99 21.99 0 0 0 2 24c0 3.55.85 6.91 2.34 9.88l7.35-5.7z"
      />
      <path
        fill="#EA4335"
        d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z"
      />
    </svg>
  );
}
