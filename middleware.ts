import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import {
  SUPABASE_ANON_KEY,
  SUPABASE_URL,
  haySupabase,
} from "@/lib/supabase/config";

/**
 * Refresca la sesión de Supabase en cada navegación.
 *
 * Los tokens de acceso caducan en una hora. Sin este middleware, el servidor
 * vería la sesión caducada aunque el navegador la haya renovado por su cuenta,
 * y el usuario aparecería como desconectado a mitad de sesión.
 *
 * Si no hay Supabase configurado esto es un paso al vacío: `NextResponse.next()`
 * y a otra cosa. La app no se entera de que existe autenticación.
 */
export async function middleware(peticion: NextRequest) {
  if (!haySupabase()) return NextResponse.next();

  let respuesta = NextResponse.next({ request: peticion });

  try {
    const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      cookies: {
        getAll: () => peticion.cookies.getAll(),
        setAll: (aEscribir, cabeceras) => {
          for (const { name, value } of aEscribir) {
            peticion.cookies.set(name, value);
          }
          // Se rehace la respuesta para que el render de abajo vea ya las
          // cookies nuevas, y luego se vuelcan también en la respuesta.
          respuesta = NextResponse.next({ request: peticion });
          for (const { name, value, options } of aEscribir) {
            respuesta.cookies.set(name, value, options);
          }
          // Cabeceras anti-caché: una respuesta que renueva la sesión no la
          // puede cachear un CDN, o le serviría el token de uno a otro.
          for (const [clave, valor] of Object.entries(cabeceras ?? {})) {
            respuesta.headers.set(clave, valor);
          }
        },
      },
    });

    // Hay que tocar la sesión antes de generar la respuesta: si el refresco
    // termina después, las cookies nuevas ya no se pueden escribir.
    await supabase.auth.getClaims();
  } catch {
    // Supabase caído, red sin salida, credenciales mal puestas: la navegación
    // sigue su curso en modo local. Jamás una pantalla en blanco por esto.
  }

  return respuesta;
}

export const config = {
  matcher: [
    /*
     * Todas las rutas de página, menos:
     * - las rutas de API (se autentican solas con `usuarioDePeticion`),
     * - los estáticos de Next y los archivos con extensión.
     */
    "/((?!api/|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml|woff|woff2)$).*)",
  ],
};
