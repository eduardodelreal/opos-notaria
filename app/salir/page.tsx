import type { Metadata } from "next";
import { MarcoAuth } from "@/components/MarcoAuth";
import { Salida } from "@/components/Salida";

export const metadata: Metadata = { title: "Cerrar sesión — opos-notaria" };

export default function Salir() {
  return (
    <MarcoAuth
      titulo="Cerrar sesión"
      descripcion="Se cierra la sesión en este navegador. Tu expediente sigue guardado aquí y en la nube."
    >
      <Salida />
    </MarcoAuth>
  );
}
