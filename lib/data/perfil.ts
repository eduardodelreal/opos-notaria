import type { Perfil } from "./types";

/**
 * El perfil con el que arranca una instalación nueva.
 *
 * Vive aquí y no dentro del store porque la primera sincronización necesita
 * compararlo (ver `perfilDeFabrica`) y el store no puede importar de la
 * sincronización sin cerrar un ciclo de módulos.
 */
export const PERFIL_INICIAL: Perfil = {
  nombre: "",
  oposicion: "notarias",
  fechaInicio: Date.now(),
  objetivoHorasSemana: 45,
  minutosPorTema: 10,
  diasOxido: 45,
  tema: "dark",
  estiloFeedback: "directo",
};

/**
 * ¿Es un perfil que nadie ha tocado?
 *
 * Lo pregunta la primera sincronización para decidir quién gana cuando hay
 * dos perfiles y ninguno tiene reloj fiable: el del opositor que lleva
 * meses trabajando en este navegador, o el que el trigger de alta acaba de
 * crear en el servidor con los valores por defecto. Un perfil de fábrica no
 * es trabajo de nadie y puede perder sin que a nadie le duela.
 *
 * `tema` y `fechaInicio` no cuentan: el primero es una preferencia visual
 * de cada aparato y el segundo lo pone la instalación sin que el usuario
 * haga nada.
 */
export function perfilDeFabrica(p: Perfil): boolean {
  return (
    !p.nombre.trim() &&
    !p.fechaExamen &&
    !p.preparador?.trim() &&
    p.oposicion === PERFIL_INICIAL.oposicion &&
    p.objetivoHorasSemana === PERFIL_INICIAL.objetivoHorasSemana &&
    p.minutosPorTema === PERFIL_INICIAL.minutosPorTema &&
    p.diasOxido === PERFIL_INICIAL.diasOxido &&
    p.estiloFeedback === PERFIL_INICIAL.estiloFeedback
  );
}
