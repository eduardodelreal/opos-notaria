/**
 * Prueba de extremo a extremo del ENVÍO del push, sin navegador y sin salir a
 * internet.
 *
 * Qué demuestra: que lo que sale de `lib/avisos/envio.ts` es un Web Push
 * válido y que el navegador podrá leerlo. Se monta un servidor push de mentira
 * en localhost, se le manda un aviso con una suscripción cuyas claves genera
 * esta misma prueba, y luego se DESCIFRA el cuerpo con la clave privada del
 * "navegador" para comprobar que dentro está exactamente el JSON que espera
 * public/sw-avisos.js.
 *
 * Eso es lo que falla en silencio en el Web Push: un cifrado mal hecho da un
 * 201 del servidor push y una notificación que no llega nunca.
 *
 * Qué NO demuestra: que Google/Mozilla/Apple acepten el envío, ni que el
 * service worker pinte la notificación. Para eso hace falta un navegador de
 * verdad y un endpoint real; está explicado en docs/avisos.md.
 *
 * Uso:
 *   node --experimental-strip-types --import ./pruebas/cargador.mjs \
 *        scripts/prueba-envio-push.mjs
 */

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { configurarVapid, enviarPush } from "../lib/avisos/envio.ts";

let fallos = 0;
let hechas = 0;

async function prueba(nombre, fn) {
  hechas += 1;
  try {
    await fn();
    console.log(`  ok   ${nombre}`);
  } catch (e) {
    fallos += 1;
    console.log(`  FAIL ${nombre}\n       ${e.message.split("\n")[0]}`);
  }
}

const b64url = (buf) => buf.toString("base64url");

/* ============================================================
   El "navegador": una suscripción push con claves de verdad
   ============================================================ */

function fabricarSuscripcion(endpoint) {
  const ecdh = crypto.createECDH("prime256v1");
  ecdh.generateKeys();
  const auth = crypto.randomBytes(16);
  return {
    ecdh,
    auth,
    publica: ecdh.getPublicKey(), // 65 bytes, sin comprimir
    sub: {
      id: "sub-prueba",
      endpoint,
      claveP256dh: b64url(ecdh.getPublicKey()),
      claveAuth: b64url(auth),
      userAgent: "prueba",
      zonaHoraria: "Europe/Madrid",
      ultimoEnvio: null,
    },
  };
}

/* ============================================================
   Descifrado aes128gcm (RFC 8188 + RFC 8291), lado navegador

   Escrito a mano y NO con web-push a propósito: si el descifrado usara la
   misma librería que el cifrado, un error de la librería se cancelaría consigo
   mismo y la prueba pasaría con un push que ningún navegador podría leer.
   ============================================================ */

function hkdf(salt, ikm, info, largo) {
  const prk = crypto.createHmac("sha256", salt).update(ikm).digest();
  const bloque = crypto
    .createHmac("sha256", prk)
    .update(Buffer.concat([info, Buffer.from([1])]))
    .digest();
  return bloque.subarray(0, largo);
}

function descifrar(cuerpo, navegador) {
  // Cabecera del cuerpo: salt(16) | rs(4) | idlen(1) | clave pública del emisor
  const salt = cuerpo.subarray(0, 16);
  const idlen = cuerpo[20];
  const publicaServidor = cuerpo.subarray(21, 21 + idlen);
  const cifrado = cuerpo.subarray(21 + idlen);
  assert.equal(idlen, 65, "la clave del emisor tiene que ser un punto P-256 sin comprimir");

  const compartido = navegador.ecdh.computeSecret(publicaServidor);
  const infoClave = Buffer.concat([
    Buffer.from("WebPush: info\0", "utf8"),
    navegador.publica,
    publicaServidor,
  ]);
  const ikm = hkdf(navegador.auth, compartido, infoClave, 32);
  const cek = hkdf(salt, ikm, Buffer.from("Content-Encoding: aes128gcm\0", "utf8"), 16);
  const nonce = hkdf(salt, ikm, Buffer.from("Content-Encoding: nonce\0", "utf8"), 12);

  const descifrador = crypto.createDecipheriv("aes-128-gcm", cek, nonce);
  descifrador.setAuthTag(cifrado.subarray(cifrado.length - 16));
  const plano = Buffer.concat([
    descifrador.update(cifrado.subarray(0, cifrado.length - 16)),
    descifrador.final(),
  ]);

  // Relleno: ceros hasta un delimitador (0x02 en el último registro).
  let i = plano.length - 1;
  while (i >= 0 && plano[i] === 0) i -= 1;
  assert.ok(plano[i] === 2 || plano[i] === 1, "delimitador de relleno inesperado");
  return plano.subarray(0, i).toString("utf8");
}

/* ============================================================
   Servidor push de mentira

   Tiene que hablar TLS: `web-push` usa `https.request` siempre, mire el
   esquema del endpoint que mire, y con razón — un push va cifrado de extremo a
   extremo pero la cabecera VAPID viaja en claro. Así que se fabrica un
   certificado de usar y tirar y se le enseña a Node como autoridad de
   confianza SOLO para esta prueba. La verificación de TLS sigue activa: no se
   toca `NODE_TLS_REJECT_UNAUTHORIZED` ni nada por el estilo.
   ============================================================ */

function certificadoDeUsarYTirar() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "push-prueba-"));
  const clave = path.join(dir, "clave.pem");
  const cert = path.join(dir, "cert.pem");
  execFileSync("openssl", [
    "req", "-x509", "-newkey", "rsa:2048", "-nodes",
    "-keyout", clave, "-out", cert,
    "-days", "1", "-subj", "/CN=127.0.0.1",
    "-addext", "subjectAltName=IP:127.0.0.1",
  ], { stdio: "ignore" });
  return {
    key: fs.readFileSync(clave),
    cert: fs.readFileSync(cert),
    limpiar: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

const TLS = certificadoDeUsarYTirar();
// `web-push` no pasa agente, así que usa el global: es ahí donde se añade la
// autoridad de esta prueba.
https.globalAgent.options.ca = [TLS.cert];

function levantar(estado = 201) {
  const recibido = [];
  const servidor = https.createServer({ key: TLS.key, cert: TLS.cert }, (req, res) => {
    const trozos = [];
    req.on("data", (t) => trozos.push(t));
    req.on("end", () => {
      recibido.push({
        metodo: req.method,
        ruta: req.url,
        cabeceras: req.headers,
        cuerpo: Buffer.concat(trozos),
      });
      res.writeHead(estado);
      res.end(estado >= 400 ? "no" : "");
    });
  });
  return new Promise((ok) => {
    servidor.listen(0, "127.0.0.1", () =>
      ok({ servidor, recibido, puerto: servidor.address().port }),
    );
  });
}

const cerrar = (servidor) => new Promise((ok) => servidor.close(ok));

/* ============================================================
   Pruebas
   ============================================================ */

const { default: webpush } = await import("web-push");
const CLAVES = webpush.generateVAPIDKeys();
configurarVapid("mailto:avisos@ejemplo.es", CLAVES.publicKey, CLAVES.privateKey);

const CARGA = {
  titulo: "El tema 33 se te está oxidando",
  cuerpo: "60 días sin tocar «La hipoteca de máximo» (Civil). Lo tenías dominado.",
  url: "/tema/abc-123",
  tipo: "oxido",
  clave: "oxido:tema:abc-123",
};

console.log("\nEnvío de push (servidor de mentira en localhost)");

await prueba("el envío llega, va firmado con VAPID y cifrado en aes128gcm", async () => {
  const { servidor, recibido, puerto } = await levantar(201);
  try {
    const navegador = fabricarSuscripcion(`https://127.0.0.1:${puerto}/push/xyz`);
    const r = await enviarPush(navegador.sub, CARGA);
    assert.equal(r.ok, true, `no se envió: ${r.error ?? ""}`);
    assert.equal(recibido.length, 1);

    const p = recibido[0];
    assert.equal(p.metodo, "POST");
    assert.equal(p.ruta, "/push/xyz");
    assert.equal(p.cabeceras["content-encoding"], "aes128gcm");
    assert.equal(p.cabeceras.ttl, "3600");
    assert.equal(p.cabeceras.urgency, "normal");
    assert.match(p.cabeceras.authorization ?? "", /^vapid t=/);
    assert.ok(
      (p.cabeceras.authorization ?? "").includes(`k=${CLAVES.publicKey}`),
      "la cabecera VAPID tiene que llevar NUESTRA clave pública",
    );

    // El JWT va dirigido al origen del servicio push, no a otro.
    const jwt = p.cabeceras.authorization.match(/t=([^,]+)/)[1];
    const payload = JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString());
    assert.equal(payload.aud, `https://127.0.0.1:${puerto}`);
    assert.equal(payload.sub, "mailto:avisos@ejemplo.es");
    assert.ok(payload.exp > Math.floor(Date.now() / 1000), "el JWT no puede ir caducado");

    assert.ok(p.cuerpo.length > 100, "el cuerpo cifrado no puede ir vacío");
  } finally {
    await cerrar(servidor);
  }
});

await prueba("el navegador puede descifrarlo y dentro está el aviso exacto", async () => {
  const { servidor, recibido, puerto } = await levantar(201);
  try {
    const navegador = fabricarSuscripcion(`https://127.0.0.1:${puerto}/push/xyz`);
    const r = await enviarPush(navegador.sub, CARGA);
    assert.equal(r.ok, true);

    const claro = descifrar(recibido[0].cuerpo, navegador);
    assert.deepEqual(JSON.parse(claro), CARGA);
  } finally {
    await cerrar(servidor);
  }
});

await prueba("un 410 se marca como caducada, no como fallo", async () => {
  const { servidor, puerto } = await levantar(410);
  try {
    const navegador = fabricarSuscripcion(`https://127.0.0.1:${puerto}/push/muerto`);
    const r = await enviarPush(navegador.sub, CARGA);
    assert.equal(r.ok, false);
    assert.equal(r.caducada, true);
    assert.equal(r.estado, 410);
  } finally {
    await cerrar(servidor);
  }
});

await prueba("un 404 también es endpoint muerto", async () => {
  const { servidor, puerto } = await levantar(404);
  try {
    const navegador = fabricarSuscripcion(`https://127.0.0.1:${puerto}/push/nada`);
    const r = await enviarPush(navegador.sub, CARGA);
    assert.equal(r.caducada, true);
  } finally {
    await cerrar(servidor);
  }
});

await prueba("un 500 es un fallo pasajero: NO se da la suscripción por muerta", async () => {
  const { servidor, puerto } = await levantar(500);
  try {
    const navegador = fabricarSuscripcion(`https://127.0.0.1:${puerto}/push/roto`);
    const r = await enviarPush(navegador.sub, CARGA);
    assert.equal(r.ok, false);
    assert.equal(r.caducada, false, "un 500 no puede borrar la suscripción de nadie");
    assert.equal(r.estado, 500);
  } finally {
    await cerrar(servidor);
  }
});

TLS.limpiar();

console.log(
  `\n${hechas - fallos}/${hechas} pruebas en verde` +
    (fallos ? `  ·  ${fallos} FALLIDAS` : ""),
);
process.exit(fallos ? 1 : 0);
