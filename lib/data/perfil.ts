import type { Perfil } from "./types";
import {
  ACENTO_PERSONAL_INICIAL,
  TAMANO_TEMA_INICIAL,
  acotarTamanoTema,
  esAcento,
  esDensidad,
  esFuenteTemas,
  esOrdenTemas,
  esTono,
  esVistaPrograma,
} from "./apariencia";
import { normalizarHex } from "./color";

/**
 * El perfil con el que arranca una instalación nueva.
 *
 * Vive aquí y no dentro del store porque la primera sincronización necesita
 * compararlo (ver `perfilDeFabrica`) y el store no puede importar de la
 * sincronización sin cerrar un ciclo de módulos.
 *
 * Los valores de apariencia son los que reproducen la app tal y como era
 * antes de que la personalización existiera: lacre, serif a 17px, densidad
 * normal, temas por número y mural. Si alguien los cambia aquí, cambia la
 * app de todo el mundo que no haya tocado nada.
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
  acento: "lacre",
  fuenteTemas: "serif",
  tamanoTema: TAMANO_TEMA_INICIAL,
  densidad: "normal",
  ordenTemas: "numero",
  vistaPrograma: "mural",
};

/**
 * Deja un perfil de procedencia dudosa en un estado que la app puede pintar
 * y el esquema puede aceptar.
 *
 * Lo llaman los tres sitios por los que entra un perfil que no ha escrito
 * esta versión del código: la migración del expediente guardado, la
 * importación de una copia (un fichero JSON que alguien puede haber editado
 * a mano) y el pull de la nube (una fila escrita por una versión anterior,
 * con columnas a null). Sin esto, un `acento: "arcoiris"` acabaría en el
 * generador de paletas y un `tamanoTema: 400` dejaría el temario ilegible.
 */
export function normalizarPerfil(bruto: Partial<Perfil> | undefined | null): Perfil {
  const p = { ...PERFIL_INICIAL, ...(bruto ?? {}) };
  const acentoPersonal = normalizarHex(p.acentoPersonal);
  return {
    ...p,
    tema: esTono(p.tema) ? p.tema : PERFIL_INICIAL.tema,
    acento: esAcento(p.acento) ? p.acento : PERFIL_INICIAL.acento,
    // Un acento personal sin color no es un error: se cae al lacre, que es
    // el color de partida del selector libre.
    acentoPersonal: acentoPersonal ?? (p.acento === "personal" ? ACENTO_PERSONAL_INICIAL : undefined),
    fuenteTemas: esFuenteTemas(p.fuenteTemas) ? p.fuenteTemas : PERFIL_INICIAL.fuenteTemas,
    tamanoTema: acotarTamanoTema(p.tamanoTema),
    densidad: esDensidad(p.densidad) ? p.densidad : PERFIL_INICIAL.densidad,
    ordenTemas: esOrdenTemas(p.ordenTemas) ? p.ordenTemas : PERFIL_INICIAL.ordenTemas,
    vistaPrograma: esVistaPrograma(p.vistaPrograma)
      ? p.vistaPrograma
      : PERFIL_INICIAL.vistaPrograma,
  };
}

/**
 * ¿Es un perfil que nadie ha tocado?
 *
 * Lo pregunta la primera sincronización para decidir quién gana cuando hay
 * dos perfiles y ninguno tiene reloj fiable: el del opositor que lleva
 * meses trabajando en este navegador, o el que el trigger de alta acaba de
 * crear en el servidor con los valores por defecto. Un perfil de fábrica no
 * es trabajo de nadie y puede perder sin que a nadie le duela.
 *
 * `tema` y `fechaInicio` no cuentan: el primero es lo primero que toca todo
 * el mundo por reflejo (y el guion antiparpadeo ya lo recuerda en este
 * navegador) y el segundo lo pone la instalación sin que el usuario haga
 * nada.
 *
 * El resto de la apariencia SÍ cuenta, y no es una incoherencia con lo
 * anterior: elegir acento, tipografía, cuerpo, densidad y orden es
 * configurar la app a conciencia. Si no contara, al opositor que personalizó
 * la app antes de crearse la cuenta se lo borraría el perfil de fábrica del
 * alta, que es exactamente lo que esta función existe para evitar.
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
    p.estiloFeedback === PERFIL_INICIAL.estiloFeedback &&
    p.acento === PERFIL_INICIAL.acento &&
    p.fuenteTemas === PERFIL_INICIAL.fuenteTemas &&
    p.tamanoTema === PERFIL_INICIAL.tamanoTema &&
    p.densidad === PERFIL_INICIAL.densidad &&
    p.ordenTemas === PERFIL_INICIAL.ordenTemas &&
    p.vistaPrograma === PERFIL_INICIAL.vistaPrograma
  );
}
