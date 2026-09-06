/**
 * Prueba de humo end-to-end.
 *
 * Recorre el flujo completo en un navegador real: importar el programa,
 * trocear un tema en epígrafes, cantarlo **grabando el audio** y marcando
 * fallos, guardarlo, comprobar que la grabación queda en su almacén y se
 * puede reproducir, que todo persiste tras recargar y que todas las páginas
 * pintan.
 *
 * El micrófono es real desde el punto de vista del navegador: se lanza
 * Chromium con dispositivo de captura simulado, así que `getUserMedia` y
 * `MediaRecorder` hacen su trabajo de verdad y producen un webm que el
 * propio navegador tiene que ser capaz de abrir después.
 *
 * Uso:
 *   npm run build && npx next start -p 3111
 *   npm i -D playwright && node docs/prueba-e2e.mjs
 *
 * Deja capturas numeradas en OUT. Sale con 1 si algo falla.
 */
import { chromium } from "playwright";

const BASE = "http://127.0.0.1:3111";
const OUT = process.env.OUT ?? "./capturas";

const TEMAS = `1. La persona física. El nacimiento y la personalidad. La protección del concebido.
2. La ausencia. La declaración de fallecimiento y sus efectos.
Tema 3.— La nacionalidad y la vecindad civil. Adquisición y pérdida.
4. La representación. El poder. El autocontrato y los poderes preventivos.
5. La prescripción extintiva y la caducidad. La usucapión.
6. El derecho de propiedad. Contenido, límites y protección del dominio.
7. La comunidad de bienes. La división de la cosa común.
8. El usufructo. Constitución, contenido y extinción.
9. La hipoteca. Concepto, caracteres y clases. La responsabilidad hipotecaria.
10. La legítima. Cálculo, protección, preterición y desheredación.`;

const errores = [];
// Micrófono simulado: `--use-fake-device-for-media-stream` mete un tono de
// prueba como entrada de audio y `--use-fake-ui-for-media-stream` acepta el
// diálogo de permiso solo. Con las dos, `getUserMedia` y `MediaRecorder`
// funcionan de verdad y producen un webm real, que es lo que hay que probar:
// simular la grabación con un doble no diría nada del navegador.
const b = await chromium.launch({
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  args: [
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
    "--autoplay-policy=no-user-gesture-required",
  ],
});
const ctx = await b.newContext({
  viewport: { width: 1440, height: 960 },
  permissions: ["microphone"],
});
const pg = await ctx.newPage();
pg.on("pageerror", (e) => errores.push(`pageerror: ${e.message}`));
pg.on("console", (m) => { if (m.type() === "error") errores.push(`console: ${m.text()}`); });

let pasos = 0;
let pasosOk = 0;
const paso = async (n, fn) => {
  pasos += 1;
  try { await fn(); pasosOk += 1; console.log(`  ok  ${n}`); }
  catch (e) { console.log(`  FAIL ${n}: ${e.message}`); errores.push(`${n}: ${e.message}`); }
};

// 1. Panel vacío
await pg.goto(`${BASE}/`, { waitUntil: "networkidle" });
await paso("panel vacío muestra onboarding", async () => {
  await pg.getByText("Tu expediente está vacío").waitFor({ timeout: 8000 });
});
await pg.screenshot({ path: `${OUT}/01-vacio.png` });

// 2. Importar temas
await pg.goto(`${BASE}/programa`, { waitUntil: "networkidle" });
await paso("abrir modal e importar 10 temas", async () => {
  await pg.getByRole("button", { name: /Añadir temas/ }).first().click();
  await pg.getByPlaceholder(/La persona física/).fill(TEMAS);
  await pg.getByText("10 temas detectados").waitFor({ timeout: 5000 });
  await pg.getByRole("button", { name: /Importar 10 temas/ }).click();
  await pg.waitForTimeout(400);
});
await pg.keyboard.press("Escape");
await pg.waitForTimeout(600);
await paso("el parser respeta 'Tema 3.—' y limpia el separador", async () => {
  await pg.getByRole("button", { name: /Vista lista/ }).click();
  await pg.waitForTimeout(300);
  const txt = await pg.locator("body").innerText();
  if (!txt.includes("La nacionalidad y la vecindad civil")) throw new Error("tema 3 no importado");
  if (/— La nacionalidad/.test(txt)) throw new Error("el separador — no se ha limpiado del titulo");
  await pg.getByRole("button", { name: /Vista mural/ }).click();
  await pg.waitForTimeout(300);
});
await paso("mural pinta 10 celdas", async () => {
  const n = await pg.locator('a[href^="/tema/"]').count();
  if (n < 10) throw new Error(`solo ${n} celdas`);
});
await pg.screenshot({ path: `${OUT}/02-programa.png` });

// 3. Ficha de tema + epígrafes por autoparser
const href = await pg.locator('a[href^="/tema/"]').nth(8).getAttribute("href");
await pg.goto(BASE + href, { waitUntil: "networkidle" });
await paso("ficha del tema carga", async () => {
  await pg.getByText("Tiempo invertido").waitFor({ timeout: 6000 });
});
await paso("autoparser trocea el texto en epígrafes", async () => {
  await pg.getByRole("button", { name: /Pegar el texto del tema/ }).click();
  await pg.getByPlaceholder(/Concepto y caracteres/).fill(
    `I. Concepto y caracteres de la hipoteca.
La hipoteca es un derecho real de garantía que sujeta directa e inmediatamente los bienes sobre los que se impone al cumplimiento de la obligación.

II. Clases de hipoteca.
Se distingue entre hipotecas voluntarias y legales, expresas y tácitas.

III. La responsabilidad hipotecaria.
Comprende principal, intereses ordinarios, intereses de demora y costas.`
  );
  await pg.getByText("3 epígrafes detectados").waitFor({ timeout: 5000 });
  await pg.getByRole("button", { name: /Guardar 3 epígrafes/ }).click();
  await pg.waitForTimeout(600);
  // Los títulos de epígrafe son inputs editables: hay que mirar su value.
  const valores = await pg.locator('input').evaluateAll((els) =>
    els.map((e) => e.value).filter(Boolean));
  if (!valores.some((v) => v.includes("Clases de hipoteca")))
    throw new Error("epígrafes no guardados: " + JSON.stringify(valores));
});
await pg.screenshot({ path: `${OUT}/03-tema.png` });

// 4. Cambiar estado
await paso("marcar el tema como cantable", async () => {
  await pg.getByRole("button", { name: "Cantable" }).first().click();
  await pg.waitForTimeout(300);
});

// 5. Cante en vivo
const temaId = href.split("/").pop();
await pg.goto(`${BASE}/cante/vivo?tema=${temaId}`, { waitUntil: "networkidle" });
await paso("la grabación se ofrece antes de empezar, no a mitad", async () => {
  // El permiso se pide antes del primer epígrafe: si el diálogo saliera a
  // media recitación, la toma estaría arruinada.
  await pg.getByRole("button", { name: /Se grabará el audio/ }).waitFor({ timeout: 5000 });
});
await paso("modo cante arranca", async () => {
  await pg.getByRole("button", { name: /Empezar el cante/ }).click();
  await pg.getByText("Epígrafe 1 de 3").waitFor({ timeout: 5000 });
});
await paso("el indicador dice que está grabando", async () => {
  await pg.getByRole("button", { name: /Grabando/ }).waitFor({ timeout: 5000 });
});
await pg.screenshot({ path: `${OUT}/04-cante.png` });
await paso("marcar fallo con tecla y avanzar con espacio", async () => {
  await pg.waitForTimeout(1200);
  await pg.keyboard.press("1");
  await pg.getByText("Laguna marcado").waitFor({ timeout: 3000 });
  await pg.keyboard.press("Space");
  await pg.getByText("Epígrafe 2 de 3").waitFor({ timeout: 3000 });
  await pg.waitForTimeout(1100);
  await pg.keyboard.press("Space");
  await pg.waitForTimeout(1100);
  await pg.keyboard.press("Space");
});
await paso("llega al resumen con desglose", async () => {
  await pg.getByText("Cante terminado").waitFor({ timeout: 5000 });
  // innerText devuelve el texto ya transformado por CSS (uppercase).
  const txt = (await pg.locator("body").innerText()).toLowerCase();
  for (const marca of ["epígrafe", "fallo", "por epígrafe"]) {
    if (!txt.includes(marca)) throw new Error(`falta "${marca}" en el resumen`);
  }
});
await paso("el resumen ofrece guardar la grabación", async () => {
  await pg.getByText(/Guardar la grabación/).waitFor({ timeout: 6000 });
});
await paso("guardar cante con nota", async () => {
  await pg.getByRole("button", { name: "6", exact: true }).first().click();
  await pg.getByRole("button", { name: /Guardar cante/ }).click();
  await pg.waitForURL(/\/tema\//, { timeout: 8000 });
});
await pg.screenshot({ path: `${OUT}/05-resumen.png` });

// 6. El cante aparece en la ficha
await paso("el cante queda registrado en la ficha", async () => {
  await pg.getByRole("button", { name: /^Cantes/ }).click();
  await pg.waitForTimeout(400);
  const txt = (await pg.locator("body").innerText()).toLowerCase();
  if (!txt.includes("tiempo por epígrafe"))
    throw new Error("no se ve el desglose del cante");
  if (!txt.includes("laguna") && !/\df/.test(txt))
    throw new Error("no se ve el fallo marcado durante el cante");
});
await paso("la grabación se guarda y se puede reproducir", async () => {
  const audio = pg.locator("audio[data-cante]");
  await audio.waitFor({ timeout: 8000 });
  const info = await audio.evaluate(async (el) => {
    if (el.readyState < 1) {
      await new Promise((listo) => {
        el.addEventListener("loadedmetadata", listo, { once: true });
        el.addEventListener("error", listo, { once: true });
        setTimeout(listo, 4000);
      });
    }
    return { src: el.currentSrc || el.src, readyState: el.readyState };
  });
  // Blob local, no una URL firmada: sin Supabase el audio tiene que
  // reproducirse igual desde IndexedDB.
  if (!info.src.startsWith("blob:")) throw new Error(`src raro: ${info.src}`);
  // readyState >= 1 (HAVE_METADATA) es "el navegador ha abierto el audio":
  // si el blob estuviera corrupto o vacío, se quedaría en 0.
  if (info.readyState < 1)
    throw new Error(`el navegador no ha podido abrir la grabación (readyState ${info.readyState})`);
});
await paso("el blob está en IndexedDB, no en el estado serializado", async () => {
  const bytes = await pg.evaluate(
    () =>
      new Promise((resolver) => {
        const p = indexedDB.open("opos-notaria-audio");
        p.onerror = () => resolver(-1);
        p.onsuccess = () => {
          const db = p.result;
          if (!db.objectStoreNames.contains("cantes")) return resolver(-2);
          const tx = db.transaction("cantes", "readonly").objectStore("cantes").getAll();
          tx.onerror = () => resolver(-3);
          tx.onsuccess = () =>
            resolver(tx.result.reduce((a, x) => a + (x?.blob?.size ?? 0), 0));
        };
      }),
  );
  if (bytes <= 0) throw new Error(`el audio no está en su almacén (${bytes})`);
  const estado = await pg.evaluate(
    () =>
      new Promise((resolver) => {
        const p = indexedDB.open("keyval-store");
        p.onerror = () => resolver("");
        p.onsuccess = () => {
          const db = p.result;
          if (!db.objectStoreNames.contains("keyval")) return resolver("");
          const tx = db.transaction("keyval", "readonly").objectStore("keyval").getAll();
          tx.onerror = () => resolver("");
          tx.onsuccess = () => resolver(JSON.stringify(tx.result));
        };
      }),
  );
  // El estado persistido lleva la FICHA del audio, nunca el binario: si el
  // blob acabara ahí, cada tecla marcada en el cante reescribiría megas.
  if (estado && estado.length > 400_000)
    throw new Error(`el estado serializado pesa ${estado.length} bytes: ¿se ha colado el audio?`);
});
await paso("hay capítulos por epígrafe en la grabación", async () => {
  const n = await pg.locator('button[title^="Ir a "]').count();
  if (n < 3) throw new Error(`solo ${n} marcas de epígrafe`);
});
await paso("sin proveedor de transcripción se avisa en vez de romper", async () => {
  await pg
    .getByText(/No hay servicio de transcripción configurado/)
    .first()
    .waitFor({ timeout: 6000 });
});
await pg.screenshot({ path: `${OUT}/06-cantes.png` });

// 7. Resto de páginas con datos
for (const [ruta, marca] of [
  ["/", "Panel"], ["/crono", "Reparto semanal"], ["/repaso", "Repaso"],
  ["/simulacros", "Configurar el bombo"], ["/estadisticas", "Esfuerzo por materia"],
  ["/chat", "Preparador"], ["/ajustes", "Perfil"],
]) {
  await pg.goto(BASE + ruta, { waitUntil: "networkidle" });
  await paso(`${ruta} renderiza con datos`, async () => {
    await pg.getByText(marca).first().waitFor({ timeout: 8000 });
  });
}
await pg.goto(`${BASE}/estadisticas`, { waitUntil: "networkidle" });
await pg.waitForTimeout(800);
await pg.screenshot({ path: `${OUT}/07-estadisticas.png`, fullPage: true });

// 8. Bombo
await pg.goto(`${BASE}/simulacros`, { waitUntil: "networkidle" });
await paso("el bombo saca bolas", async () => {
  await pg.getByRole("button", { name: /Sacar bolas/ }).click();
  await pg.waitForTimeout(2500);
  await pg.getByRole("button", { name: /Empezar simulacro/ }).waitFor({ timeout: 6000 });
});
await pg.screenshot({ path: `${OUT}/08-bombo.png` });

// 9. Persistencia tras recarga
await pg.goto(`${BASE}/programa`, { waitUntil: "networkidle" });
await pg.reload({ waitUntil: "networkidle" });
await paso("los datos sobreviven a la recarga (IndexedDB)", async () => {
  await pg.waitForTimeout(900);
  const n = await pg.locator('a[href^="/tema/"]').count();
  if (n < 10) throw new Error(`tras recargar solo hay ${n} temas`);
});

// 10. Apariencia: lo que el opositor elige tiene que verse de verdad
//
// Nada de comprobar que el control existe: eso lo pasaría una pantalla de
// ajustes que no estuviera enchufada a nada. Aquí se leen ESTILOS
// COMPUTADOS —el fondo real del body, el color real del botón primario, la
// tipografía real del texto del tema— y se comprueba que sobreviven a una
// recarga sin parpadeo.
await pg.goto(`${BASE}/ajustes`, { waitUntil: "networkidle" });
await paso("cambio a tema claro", async () => {
  await pg.getByRole("button", { name: "Claro" }).click();
  await pg.waitForTimeout(500);
  const cls = await pg.locator("html").getAttribute("class");
  if (!cls?.includes("light")) throw new Error("no se aplicó .light");
});
await pg.goto(`${BASE}/`, { waitUntil: "networkidle" });
await pg.waitForTimeout(700);
await pg.screenshot({ path: `${OUT}/09-claro.png` });

// Lee variables y estilos computados de la página, ya resueltos por el
// navegador: es la única forma de saber que el CSS ha llegado a la pantalla.
const estilos = () =>
  pg.evaluate(() => {
    const html = getComputedStyle(document.documentElement);
    const boton = document.querySelector(".card button, button");
    return {
      clases: document.documentElement.className,
      lacre: html.getPropertyValue("--lacre").trim(),
      cuerpo: html.getPropertyValue("--tema-cuerpo").trim(),
      fuente: html.getPropertyValue("--tema-fuente").trim(),
      fondo: getComputedStyle(document.body).backgroundColor,
      espaciado: html.getPropertyValue("--spacing").trim(),
      boton: boton ? getComputedStyle(boton).backgroundColor : null,
    };
  });

await pg.goto(`${BASE}/ajustes`, { waitUntil: "networkidle" });
const antesApariencia = await estilos();

await paso("el tono sepia repinta el fondo de verdad", async () => {
  await pg.locator("[data-tono=sepia]").click();
  await pg.waitForTimeout(400);
  const e = await estilos();
  if (!e.clases.includes("sepia")) throw new Error(`clases: ${e.clases}`);
  // #f2ebdc, el papel cálido de :root.sepia en app/globals.css.
  if (e.fondo !== "rgb(242, 235, 220)") throw new Error(`fondo del body: ${e.fondo}`);
});

await paso("el acento elegido llega al color del botón primario", async () => {
  await pg.locator("[data-acento=jade]").click();
  await pg.waitForTimeout(400);
  const e = await estilos();
  if (e.lacre === antesApariencia.lacre)
    throw new Error(`el acento no ha cambiado: sigue en ${e.lacre}`);
  const primario = await pg
    .locator("button:has-text('Empezar el cante')")
    .first()
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  const esperado = await pg.evaluate((hex) => {
    const d = document.createElement("div");
    d.style.color = hex;
    document.body.appendChild(d);
    const c = getComputedStyle(d).color;
    d.remove();
    return c;
  }, e.lacre);
  if (primario !== esperado)
    throw new Error(`el botón pinta ${primario} y el acento dice ${esperado}`);
});

await paso("un acento ilegible se corrige solo en vez de aplicarse tal cual", async () => {
  await pg.locator("[data-acento=personal]").click();
  // Amarillo pálido sobre papel: invisible. La app tiene que oscurecerlo.
  await pg.locator("input[aria-label='Color del acento']").fill("#fafad0");
  await pg.waitForTimeout(600);
  const medida = await pg.evaluate(() => {
    const html = getComputedStyle(document.documentElement);
    const pinta = (c) => {
      const d = document.createElement("div");
      d.style.color = c;
      document.body.appendChild(d);
      const v = getComputedStyle(d).color;
      d.remove();
      return v.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number);
    };
    const lum = (rgb) => {
      const [r, g, b] = rgb.map((v) => {
        const x = v / 255;
        return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const a = lum(pinta(html.getPropertyValue("--lacre").trim()));
    const b = lum(pinta(getComputedStyle(document.body).backgroundColor));
    const [alto, bajo] = a >= b ? [a, b] : [b, a];
    return {
      aplicado: html.getPropertyValue("--lacre").trim(),
      contraste: (alto + 0.05) / (bajo + 0.05),
    };
  });
  if (medida.aplicado.toLowerCase() === "#fafad0")
    throw new Error("se ha aplicado el color ilegible tal cual");
  // 3:1 es el umbral de la WCAG 2.1 para elementos no textuales, que es lo
  // que este color rellena (botones, bordes, puntos de gráfica).
  if (medida.contraste < 3)
    throw new Error(`sigue ilegible: ${medida.contraste.toFixed(2)}:1`);
  // Se vuelve a un acento de la paleta para el resto de la prueba.
  await pg.locator("[data-acento=jade]").click();
  await pg.waitForTimeout(300);
});

await paso("la tipografía y el cuerpo del texto de los temas cambian", async () => {
  await pg.locator("[data-fuente=sans]").click();
  await pg.locator("input[aria-label='Cuerpo del texto de los temas']").fill("22");
  // El guardado va diferido para no escribir en IndexedDB en cada píxel de
  // arrastre; se le da margen.
  await pg.waitForTimeout(700);
  const e = await estilos();
  if (e.cuerpo !== "1.375rem") throw new Error(`--tema-cuerpo: ${e.cuerpo}`);
  if (!e.fuente.includes("Inter")) throw new Error(`--tema-fuente: ${e.fuente}`);
});

await paso("y se ven en el texto del tema, no solo en la variable", async () => {
  await pg.goto(`${BASE}/tema/${temaId}`, { waitUntil: "networkidle" });
  await pg.getByText("Tiempo invertido").waitFor({ timeout: 8000 });
  // El texto del epígrafe está plegado: se despliega para poder medirlo.
  await pg.locator("button[aria-label='Ver texto']").first().click();
  const caja = pg.locator(".prose-tema").first();
  await caja.waitFor({ timeout: 8000 });
  const tipo = await caja.evaluate((el) => {
    const c = getComputedStyle(el);
    return { familia: c.fontFamily, tamano: c.fontSize };
  });
  if (tipo.tamano !== "22px") throw new Error(`cuerpo del temario: ${tipo.tamano}`);
  // Ojo: la pila sans acaba en "sans-serif", así que buscar /serif/ daría
  // siempre positivo. Lo que hay que mirar es la primera familia.
  if (/Newsreader/i.test(tipo.familia) || !/Inter/i.test(tipo.familia))
    throw new Error(`sigue en serif: ${tipo.familia}`);
});

await paso("la densidad compacta encoge la retícula de verdad", async () => {
  await pg.goto(`${BASE}/ajustes`, { waitUntil: "networkidle" });
  const antes = await pg
    .locator(".card")
    .first()
    .evaluate((el) => getComputedStyle(el).paddingTop);
  await pg.locator("[data-densidad=compacta]").click();
  await pg.waitForTimeout(400);
  const despues = await pg
    .locator(".card")
    .first()
    .evaluate((el) => getComputedStyle(el).paddingTop);
  if (parseFloat(despues) >= parseFloat(antes))
    throw new Error(`la tarjeta no ha encogido: ${antes} → ${despues}`);
  const e = await estilos();
  if (!e.clases.includes("compacta")) throw new Error(`clases: ${e.clases}`);
});
await pg.screenshot({ path: `${OUT}/10-apariencia.png`, fullPage: true });

await paso("la apariencia sobrevive a la recarga y se aplica ANTES de hidratar", async () => {
  const esperado = await estilos();
  // `domcontentloaded` es antes de que React hidrate: si lo que se lee aquí
  // ya está bien, el guion antiparpadeo del <head> ha hecho su trabajo y el
  // opositor no ve un fogonazo del tema anterior en cada recarga.
  await pg.reload({ waitUntil: "domcontentloaded" });
  const temprano = await pg.evaluate(() => ({
    clases: document.documentElement.className,
    lacre: document.documentElement.style.getPropertyValue("--lacre").trim(),
    cuerpo: document.documentElement.style.getPropertyValue("--tema-cuerpo").trim(),
  }));
  if (!temprano.clases.includes("sepia") || !temprano.clases.includes("compacta"))
    throw new Error(`clases antes de hidratar: "${temprano.clases}"`);
  if (temprano.lacre !== esperado.lacre)
    throw new Error(`acento antes de hidratar: ${temprano.lacre} ≠ ${esperado.lacre}`);
  if (temprano.cuerpo !== "1.375rem")
    throw new Error(`cuerpo antes de hidratar: ${temprano.cuerpo}`);
  await pg.waitForLoadState("networkidle");
  const ahora = await estilos();
  if (ahora.lacre !== esperado.lacre || ahora.fondo !== esperado.fondo)
    throw new Error("la apariencia no ha sobrevivido a la recarga");
});

await paso("el orden de los temas elegido manda en el programa", async () => {
  await pg.goto(`${BASE}/ajustes`, { waitUntil: "networkidle" });
  await pg.getByLabel("Orden de los temas").selectOption("nota");
  await pg.waitForTimeout(300);
  await pg.goto(`${BASE}/programa`, { waitUntil: "networkidle" });
  await pg.waitForTimeout(500);
  // El único tema cantado en esta prueba es el 9 (la hipoteca, con un 6):
  // ordenando por nota tiene que ponerse el primero, por delante del tema 1.
  const primero = await pg.locator('a[href^="/tema/"]').first().getAttribute("href");
  if (!primero.endsWith(temaId))
    throw new Error(`ordenando por nota el primero debería ser el tema cantado`);

  await pg.goto(`${BASE}/ajustes`, { waitUntil: "networkidle" });
  await pg.getByLabel("Orden de los temas").selectOption("numero");
  await pg.waitForTimeout(300);
  await pg.goto(`${BASE}/programa`, { waitUntil: "networkidle" });
  await pg.waitForTimeout(500);
  const deVuelta = await pg.locator('a[href^="/tema/"]').first().getAttribute("href");
  if (deVuelta === primero)
    throw new Error("volviendo al orden por número la lista no ha cambiado");
});

await paso("las materias se pueden reordenar desde el programa", async () => {
  await pg.goto(`${BASE}/programa`, { waitUntil: "networkidle" });
  await pg.getByRole("button", { name: "Materias" }).click();
  const nombres = () =>
    pg.locator("input[type=color]").evaluateAll((els) =>
      els.map((e) => e.getAttribute("aria-label")),
    );
  const antes = await nombres();
  await pg.locator("button[aria-label^='Bajar ']").first().click();
  await pg.waitForTimeout(400);
  const despues = await nombres();
  if (antes[0] === despues[0])
    throw new Error(`la materia no ha bajado: ${antes[0]} sigue la primera`);
  if (despues[1] !== antes[0])
    throw new Error(`orden raro tras bajar: ${JSON.stringify(despues)}`);
  await pg.keyboard.press("Escape");
});

// Se deja la app como estaba para las comprobaciones que quedan.
await pg.goto(`${BASE}/ajustes`, { waitUntil: "networkidle" });
await pg.getByRole("button", { name: "Volver a la de siempre" }).click();
await pg.waitForTimeout(400);
await paso("«volver a la de siempre» devuelve la app original", async () => {
  const e = await estilos();
  if (e.clases.trim() !== "") throw new Error(`quedan clases: "${e.clases}"`);
  if (e.lacre.toLowerCase() !== "#a82f3c") throw new Error(`acento: ${e.lacre}`);
  if (e.cuerpo !== "1.0625rem") throw new Error(`cuerpo: ${e.cuerpo}`);
  if (e.espaciado !== "0.25rem") throw new Error(`espaciado: ${e.espaciado}`);
});

// 11. Sin clave, los botones de IA avisan
await pg.goto(`${BASE}/chat`, { waitUntil: "networkidle" });
await paso("sin ANTHROPIC_API_KEY el chat avisa en vez de romper", async () => {
  await pg.getByText("El chat está apagado").waitFor({ timeout: 6000 });
});

await b.close();

const reales = errores.filter((e) => !/favicon|font|fonts\.g|net::ERR/i.test(e));
console.log(`\n${pasosOk}/${pasos} pasos ok`);
console.log("=== errores de consola/página ===");
console.log(reales.length ? reales.join("\n") : "ninguno");
// Sale con error si algo ha fallado: una prueba de humo que siempre devuelve
// 0 no se entera nadie de que se ha roto.
process.exit(reales.length ? 1 : 0);
