import type { Metadata } from "next";
import { MarcoAuth } from "@/components/MarcoAuth";
import { FormularioAcceso } from "@/components/FormularioAcceso";

export const metadata: Metadata = { title: "Entrar — opos-notaria" };

export default function Entrar() {
  return (
    <MarcoAuth
      titulo="Abre tu expediente"
      descripcion="Entra para tener el mismo expediente en el ordenador y en el móvil."
    >
      <FormularioAcceso modo="entrar" />
    </MarcoAuth>
  );
}
