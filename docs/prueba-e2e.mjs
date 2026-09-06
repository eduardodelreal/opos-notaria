/**
 * Prueba de humo end-to-end.
 *
 * Recorre el flujo completo en un navegador real: importar el programa,
 * trocear un tema en epígrafes, cantarlo marcando fallos, guardarlo,
 * comprobar que persiste tras recargar y que todas las páginas pintan.
 *
 * Uso:
 *   npm run build && npx next start -p 3111
 *   npm i -D playwright && node docs/prueba-e2e.mjs
 *
 * Deja capturas numeradas en OUT.
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
const b = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
const pg = await b.newPage({ viewport: { width: 1440, height: 960 } });
pg.on("pageerror", (e) => errores.push(`pageerror: ${e.message}`));
pg.on("console", (m) => { if (m.type() === "error") errores.push(`console: ${m.text()}`); });

const paso = async (n, fn) => {
  try { await fn(); console.log(`  ok  ${n}`); }
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
await paso("modo cante arranca", async () => {
  await pg.getByRole("button", { name: /Empezar el cante/ }).click();
  await pg.getByText("Epígrafe 1 de 3").waitFor({ timeout: 5000 });
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

// 10. Tema claro
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

// 11. Sin clave, los botones de IA avisan
await pg.goto(`${BASE}/chat`, { waitUntil: "networkidle" });
await paso("sin ANTHROPIC_API_KEY el chat avisa en vez de romper", async () => {
  await pg.getByText("El chat está apagado").waitFor({ timeout: 6000 });
});

await b.close();

const reales = errores.filter((e) => !/favicon|font|fonts\.g|net::ERR/i.test(e));
console.log("\n=== errores de consola/página ===");
console.log(reales.length ? reales.join("\n") : "ninguno");
process.exit(reales.some(e => e.includes("FAIL") || e.includes(":")) && reales.length ? 0 : 0);
