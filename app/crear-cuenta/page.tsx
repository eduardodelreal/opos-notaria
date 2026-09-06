import type { Metadata } from "next";
import { MarcoAuth } from "@/components/MarcoAuth";
import { FormularioAcceso } from "@/components/FormularioAcceso";

export const metadata: Metadata = { title: "Crear cuenta — opos-notaria" };

export default function CrearCuenta() {
  return (
    <MarcoAuth
      titulo="Date de alta"
      descripcion="Una cuenta, tu programa y tus cantes contigo en cualquier sitio."
    >
      <FormularioAcceso modo="crear" />
    </MarcoAuth>
  );
}
