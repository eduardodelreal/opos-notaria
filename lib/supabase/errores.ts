/**
 * Traduce los errores de Supabase Auth a castellano llano.
 *
 * Los mensajes de la API vienen en inglés y algunos son crípticos ("Invalid
 * login credentials"). Aquí se convierten en algo que un opositor entienda a
 * la primera y que le diga qué hacer.
 */
export function mensajeAuth(error: unknown): string {
  if (!error) return "";

  const e = error as { code?: string; message?: string; status?: number };
  const codigo = (e.code ?? "").toLowerCase();
  const texto = (e.message ?? "").toLowerCase();
  const contiene = (...trozos: string[]) => trozos.some((t) => texto.includes(t));

  if (codigo === "invalid_credentials" || contiene("invalid login credentials"))
    return "El correo o la contraseña no son correctos.";

  if (codigo === "email_not_confirmed" || contiene("email not confirmed"))
    return "Todavía no has confirmado el correo. Busca el mensaje de confirmación en tu bandeja (mira también el spam).";

  if (codigo === "user_already_exists" || contiene("already registered", "already been registered"))
    return "Ya hay una cuenta con ese correo. Prueba a entrar en vez de crearla.";

  if (codigo === "weak_password" || contiene("password should be", "password is too short"))
    return "La contraseña es demasiado corta. Pon al menos 8 caracteres.";

  if (codigo === "validation_failed" && contiene("email"))
    return "Ese correo no tiene buena pinta. Revísalo.";

  if (
    codigo === "provider_disabled" ||
    contiene("unsupported provider", "provider is not enabled")
  )
    return "Ese proveedor no está activado en el proyecto de Supabase. Actívalo en Authentication → Providers.";

  if (
    codigo === "over_email_send_rate_limit" ||
    codigo === "over_request_rate_limit" ||
    e.status === 429 ||
    contiene("rate limit", "too many requests")
  )
    return "Demasiados intentos seguidos. Espera un minuto y vuelve a probarlo.";

  if (codigo === "otp_expired" || contiene("expired", "invalid or has expired"))
    return "El enlace ha caducado o ya se había usado. Pide uno nuevo.";

  if (contiene("failed to fetch", "network", "fetch failed"))
    return "No se ha podido conectar con Supabase. Revisa tu conexión y la URL del proyecto.";

  return e.message || "Algo ha ido mal. Inténtalo otra vez.";
}
