/**
 * Contrato entre la ruta de chat y el cliente.
 *
 * El streaming va como texto plano, así que necesitamos una marca fuera de
 * banda para distinguir "el modelo ha terminado" de "la conexión se cortó".
 * Sin esto, una respuesta truncada por el tope de ejecución de una función
 * serverless llega al cliente como un cierre normal y se guarda como si
 * estuviera completa: el opositor se queda con media respuesta creyendo que
 * es entera.
 *
 * EOT (U+0004) no aparece en texto natural, así que sirve de centinela.
 */
export const FIN_RESPUESTA = "\u0004";
