/*
 * Service worker de los avisos. Nada más.
 *
 * Es lo MÍNIMO que exige el Web Push: un navegador solo entrega un push a un
 * service worker, no a una pestaña. Por eso existe este fichero y por eso no
 * hace nada más.
 *
 * En particular NO tiene manejador de `fetch`: sin él, el navegador no le pasa
 * ni una petición y la app se sigue sirviendo exactamente igual que hasta
 * ahora. Eso es deliberado. Un service worker con `fetch` sería el primer paso
 * de una PWA (caché, modo avión, versiones servidas desde disco) y traería
 * consigo el problema clásico de "he desplegado y siguen viendo la versión
 * vieja". Aquí no queremos nada de eso: queremos recibir notificaciones.
 *
 * Tampoco hay manifest ni prompt de instalación, con una consecuencia que
 * conviene saber: en iOS, Safari solo entrega push a las webs añadidas a la
 * pantalla de inicio como aplicación, así que en iPhone esto NO va a funcionar
 * hasta que la app tenga manifest y se instale. En Chrome, Edge, Firefox y
 * Safari de escritorio sí. Está escrito en docs/avisos.md.
 *
 * Ojo con tocar este fichero: el navegador se queda con la copia que ya tiene
 * y solo la sustituye cuando el byte a byte cambia. `skipWaiting` + `claim`
 * hacen que la versión nueva mande desde el primer momento en vez de esperar a
 * que se cierren todas las pestañas.
 */

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (evento) => {
  evento.waitUntil(self.clients.claim());
});

/* -------------------------------------------------------------------------
   Llega un push
   ------------------------------------------------------------------------- */

const POR_DEFECTO = {
  titulo: "opos-notaria",
  cuerpo: "Tienes algo pendiente.",
  url: "/",
  tipo: "repaso",
  clave: "desconocida",
};

self.addEventListener("push", (evento) => {
  let carga = POR_DEFECTO;
  try {
    // El cuerpo lo escribe scripts/enviar-avisos.ts. Si viniera vacío o
    // corrupto se enseña el genérico: `userVisibleOnly` obliga a mostrar
    // SIEMPRE una notificación, y no mostrar ninguna hace que el navegador
    // acabe revocando el permiso por su cuenta.
    if (evento.data) carga = { ...POR_DEFECTO, ...evento.data.json() };
  } catch (e) {
    // Silencio: mejor el aviso genérico que ninguno.
  }

  evento.waitUntil(
    self.registration.showNotification(carga.titulo, {
      body: carga.cuerpo,
      icon: "/aviso-192.png",
      badge: "/aviso-192.png",
      lang: "es",
      // La clave del aviso como `tag`: dos avisos de lo mismo se sustituyen en
      // vez de apilarse en la bandeja.
      tag: carga.clave,
      // Que no reviva un sonido si ya estaba ahí el mismo aviso.
      renotify: false,
      // No secuestra la pantalla: se lee cuando se lea.
      requireInteraction: false,
      data: { url: carga.url, tipo: carga.tipo, clave: carga.clave },
    }),
  );
});

/* -------------------------------------------------------------------------
   Clic en la notificación

   Tiene que abrir el TEMA, no la portada: un aviso que dice "el tema 33 se te
   oxida" y al tocarlo te deja en el inicio obliga a buscar el tema a mano, que
   es exactamente la fricción que el aviso venía a quitar.
   ------------------------------------------------------------------------- */

self.addEventListener("notificationclick", (evento) => {
  evento.notification.close();

  const destino = new URL(
    (evento.notification.data && evento.notification.data.url) || "/",
    self.location.origin,
  ).href;

  evento.waitUntil(
    (async () => {
      const ventanas = await self.clients.matchAll({
        type: "window",
        // Hace falta: las pestañas abiertas ANTES de instalarse el service
        // worker no están controladas por él y, sin esto, no aparecerían aquí.
        includeUncontrolled: true,
      });

      // Si ya hay una pestaña de la app, se reutiliza. Abrir una nueva cada vez
      // le deja al opositor seis pestañas iguales al cabo de la semana.
      for (const ventana of ventanas) {
        if (new URL(ventana.url).origin !== self.location.origin) continue;
        await ventana.focus();
        if ("navigate" in ventana) {
          try {
            await ventana.navigate(destino);
          } catch (e) {
            // Puede fallar si la pestaña no está controlada todavía. Da igual:
            // ya está enfocada, y es mejor eso que abrir otra.
          }
        }
        return;
      }

      await self.clients.openWindow(destino);
    })(),
  );
});

/* -------------------------------------------------------------------------
   El navegador rota la suscripción

   Pasa solo (caducidad de la clave del servicio push, limpieza del navegador).
   Aquí no se puede guardar el endpoint nuevo en Supabase: el service worker no
   tiene la sesión del usuario. Lo que sí se hace es resuscribirse con la misma
   clave del servidor para que el endpoint siga existiendo; la fila se pone al
   día la próxima vez que se abra la app, porque el cliente reescribe su
   suscripción en cada arranque (lib/avisos/navegador.ts).
   ------------------------------------------------------------------------- */

self.addEventListener("pushsubscriptionchange", (evento) => {
  const anterior = evento.oldSubscription;
  const clave =
    (anterior && anterior.options && anterior.options.applicationServerKey) || null;
  if (!clave) return;
  evento.waitUntil(
    self.registration.pushManager
      .subscribe({ userVisibleOnly: true, applicationServerKey: clave })
      .catch(() => {}),
  );
});
