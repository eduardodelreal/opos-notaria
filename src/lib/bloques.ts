import type { Block, BlockId, Tema } from './types'

/**
 * Las materias las crea el opositor. Aquí solo vive la paleta, la generación de
 * ids y los helpers para no romper la UI cuando un tema apunta a una materia
 * que se ha borrado.
 */

export interface ColorBloque {
  nombre: string
  color: string
  colorSoft: string
  colorText: string
}

/** Paleta clara, pensada para que ocho materias sigan distinguiéndose. */
export const PALETA: ColorBloque[] = [
  { nombre: 'Salvia', color: '#517C5E', colorSoft: '#DFE8E1', colorText: '#293F30' },
  { nombre: 'Índigo', color: '#556296', colorSoft: '#DFE3F1', colorText: '#434D77' },
  { nombre: 'Terracota', color: '#B45F42', colorSoft: '#F6E2D9', colorText: '#934A32' },
  { nombre: 'Oro viejo', color: '#A6832B', colorSoft: '#F5EACB', colorText: '#7A5F1C' },
  { nombre: 'Verde azulado', color: '#4A7C7C', colorSoft: '#D9EAEA', colorText: '#2F5555' },
  { nombre: 'Ciruela', color: '#7A6A8A', colorSoft: '#E9E3F0', colorText: '#544766' },
  { nombre: 'Arcilla', color: '#8A6A4F', colorSoft: '#EFE4D8', colorText: '#614835' },
  { nombre: 'Pizarra', color: '#5C6B72', colorSoft: '#E0E6E9', colorText: '#3E4A50' },
  { nombre: 'Musgo', color: '#6E7F3F', colorSoft: '#E6EBD5', colorText: '#4B582A' },
  { nombre: 'Rosa palo', color: '#A55F72', colorSoft: '#F3DDE3', colorText: '#7C4453' },
]

export const BLOQUE_HUERFANO: Block = {
  id: '__sin_materia__',
  nombre: 'Sin materia',
  ejercicio: 1,
  color: '#8E8A82',
  colorSoft: '#EFECE5',
  colorText: '#3C3A34',
  orden: 999,
}

/** Slug estable a partir del nombre. "Derecho Civil" → "derecho-civil". */
export function slugBloque(nombre: string, existentes: BlockId[] = []): BlockId {
  const base =
    nombre
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 32) || 'materia'
  if (!existentes.includes(base)) return base
  let i = 2
  while (existentes.includes(`${base}-${i}`)) i++
  return `${base}-${i}`
}

/** Siguiente color libre de la paleta. */
export function colorLibre(bloques: Block[]): ColorBloque {
  const usados = new Set(bloques.map((b) => b.color))
  return PALETA.find((c) => !usados.has(c.color)) ?? PALETA[bloques.length % PALETA.length]
}

export function crearBloque(
  nombre: string,
  bloques: Block[],
  opts?: { ejercicio?: Block['ejercicio']; color?: ColorBloque },
): Block {
  const c = opts?.color ?? colorLibre(bloques)
  return {
    id: slugBloque(nombre, bloques.map((b) => b.id)),
    nombre: nombre.trim(),
    ejercicio: opts?.ejercicio ?? 1,
    color: c.color,
    colorSoft: c.colorSoft,
    colorText: c.colorText,
    orden: bloques.length,
  }
}

export function mapaBloques(bloques: Block[]): Map<BlockId, Block> {
  return new Map(bloques.map((b) => [b.id, b]))
}

/**
 * Devuelve siempre un bloque pintable. Si el tema apunta a una materia
 * borrada, cae en el bloque huérfano en vez de romper la pantalla.
 */
export function bloqueDe(mapa: Map<BlockId, Block>, id: BlockId | null | undefined): Block {
  return (id ? mapa.get(id) : undefined) ?? BLOQUE_HUERFANO
}

export function ordenarBloques(bloques: Block[]): Block[] {
  return [...bloques].sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre, 'es'))
}

/** Siguiente número libre dentro de una materia. */
export function siguienteNumero(temas: Tema[], bloqueId: BlockId): number {
  const nums = temas.filter((t) => t.bloque === bloqueId).map((t) => t.numero)
  return nums.length ? Math.max(...nums) + 1 : 1
}

/* ------------------------------------------------------- importación ----- */

export interface LineaImportada {
  numero: number | null
  titulo: string
}

/**
 * Parsea una lista de temas pegada tal cual desde el PDF o el WhatsApp de la
 * academia. Acepta, en la misma pega:
 *
 *   1. El Derecho civil español. La codificación.
 *   Tema 2 - Las fuentes del Derecho
 *   3) La costumbre
 *   • La jurisprudencia            ← sin número: se numera solo
 *
 * Ignora líneas vacías y cabeceras sueltas de una sola palabra en mayúsculas.
 */
export function parsearTemas(texto: string): LineaImportada[] {
  const out: LineaImportada[] = []
  for (const bruta of texto.split(/\r?\n/)) {
    let linea = bruta.trim()
    if (!linea) continue

    // Viñetas y guiones de lista.
    linea = linea.replace(/^[-•*·–—]+\s*/, '')
    if (!linea) continue

    // Cabecera de materia suelta ("CIVIL", "TEMARIO"): ignorar.
    if (/^[A-ZÁÉÍÓÚÑ\s]{3,}$/.test(linea) && !/\d/.test(linea) && linea.split(/\s+/).length <= 3) {
      continue
    }

    let numero: number | null = null
    // El separador puede ser doble: «5.-», «Tema 3 —», «6 :». Hasta tres signos.
    const m = linea.match(/^(?:tema\s*)?(\d{1,3})\s*[.)\-:—–]{0,3}\s+(.*)$/i)
    if (m) {
      numero = Number(m[1])
      linea = m[2].trim()
    }
    if (!linea) continue
    out.push({ numero, titulo: linea })
  }
  return out
}
