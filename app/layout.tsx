import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Proveedor } from "@/components/Proveedor";
import { ProveedorSesion } from "@/components/Sesion";
import { Shell } from "@/components/Shell";
import { MotorSincronizacion } from "@/components/Sincronizacion";

export const metadata: Metadata = {
  title: "opos-notaria — preparación de la oposición a Notarías",
  description:
    "Programa, cantes, cronos, repaso espaciado, simulacros y un preparador con IA que analiza tus cantes.",
};

export const viewport: Viewport = {
  themeColor: "#08090c",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es" suppressHydrationWarning>
      <head>
        {/* Fuentes con degradación limpia: si no hay red, caen al stack del sistema. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;0,6..72,600;1,6..72,400&display=swap"
          rel="stylesheet"
        />
        {/*
          Antiparpadeo. Aplica el aspecto guardado ANTES del primer pintado:
          el tono base, la densidad y las variables del acento y de la
          tipografía del temario.

          No calcula nada. components/Proveedor.tsx deja en `opos-apariencia`
          el resultado ya masticado (clases + pares clave/valor) y aquí solo
          se copia. Es lo que permite que el color, que necesita medir
          contrastes, no tenga que existir dos veces: una en el módulo y otra,
          resumida y desincronizada, en una cadena del `head`.

          La clave vieja `opos-tema` sigue leyéndose como respaldo, para el
          navegador que ya tenía la app instalada y todavía no ha llegado a
          escribir la nueva.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var d=document.documentElement;var r=localStorage.getItem('opos-apariencia');if(r){var a=JSON.parse(r);['light','sepia','compacta'].forEach(function(c){d.classList.remove(c)});(a.clases||[]).forEach(function(c){d.classList.add(c)});var v=a.vars||{};for(var k in v)d.style.setProperty(k,v[k]);if(a.themeColor){var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute('content',a.themeColor)}}else{var t=localStorage.getItem('opos-tema');if(t==='light')d.classList.add('light')}}catch(e){}})()`,
          }}
        />
      </head>
      <body className="min-h-screen">
        <Proveedor>
          <ProveedorSesion>
            {/* No pinta nada: mantiene vivo el ciclo de sincronización
                mientras el opositor navega. */}
            <MotorSincronizacion />
            <Shell>{children}</Shell>
          </ProveedorSesion>
        </Proveedor>
      </body>
    </html>
  );
}
