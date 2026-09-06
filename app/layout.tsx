import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Proveedor } from "@/components/Proveedor";
import { Shell } from "@/components/Shell";

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
        {/* Evita el parpadeo de tema: lee la preferencia antes de pintar. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem('opos-tema');if(t==='light')document.documentElement.classList.add('light');}catch(e){}`,
          }}
        />
      </head>
      <body className="min-h-screen">
        <Proveedor>
          <Shell>{children}</Shell>
        </Proveedor>
      </body>
    </html>
  );
}
