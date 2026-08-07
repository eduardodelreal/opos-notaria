# opos-notaria

Web app para **trackear el estudio de las oposiciones a Notaría en España**.

Herramienta pensada para opositores que necesitan una forma seria de planificar temas, cantar el programa, medir horas efectivas de estudio, hacer seguimiento de repasos, y llegar al examen sin lagunas.

> Estado: `pre-alfa` — este README describe la visión de producto. Las instrucciones detalladas de implementación llegan pronto.

---

## Índice

1. [Contexto: la oposición](#contexto-la-oposición)
2. [Problema que resuelve](#problema-que-resuelve)
3. [Público objetivo](#público-objetivo)
4. [Funcionalidades previstas](#funcionalidades-previstas)
5. [Stack técnico](#stack-técnico)
6. [Arquitectura](#arquitectura)
7. [Modelo de datos (borrador)](#modelo-de-datos-borrador)
8. [Roadmap](#roadmap)
9. [Cómo arrancar en local](#cómo-arrancar-en-local)
10. [Estructura del repo](#estructura-del-repo)
11. [Convenciones](#convenciones)
12. [Licencia](#licencia)

---

## Contexto: la oposición

Las **oposiciones a Notarías** en España son una de las pruebas más exigentes del sistema jurídico español:

- **Programa oficial**: ~328 temas (Civil, Mercantil, Hipotecario, Fiscal, Notarial, etc.).
- **Duración media** del opositor: **4–7 años** de estudio a jornada completa.
- **Exámenes**: 4 ejercicios (dos orales de "cante" de temas + dos de dictamen/práctico).
- **Formato oral**: el opositor recita el tema de memoria ante tribunal, con tiempo tasado por tema.
- **Preparador**: casi todos los opositores trabajan con un preparador (notario) al que "cantan" temas semanalmente.

Este contexto marca las decisiones de producto: la app no es un Todoist genérico, es una herramienta de dominio.

---

## Problema que resuelve

Los opositores hoy gestionan su preparación con **Excel, cuadernos, o apps genéricas** que no entienden la estructura del programa. Los problemas típicos:

- No saben con precisión **cuántas horas efectivas** llevan estudiadas por tema.
- Pierden el rastro de **cuándo repasaron por última vez** cada tema → lagunas antes del examen.
- No pueden medir su **progresión de "cante"** (velocidad, fallos, tiempo por epígrafe).
- No tienen visibilidad clara del **estado global** del programa: qué está verde, qué está en rojo.
- Su preparador les da feedback verbal que **se pierde** en vez de acumularse como dato.

---

## Público objetivo

- **Opositor a Notarías** (usuario principal).
- Secundariamente: opositor a **Registros de la Propiedad** (programa muy similar) y **Judicatura / Fiscales** (ajustando programa).
- **Preparadores** — a futuro, dashboard para seguir a sus opositores.

---

## Funcionalidades previstas

> Esta sección se completará con las instrucciones detalladas del usuario. Lista inicial de referencia:

### Núcleo (MVP)

- [ ] **Programa oficial precargado** (los ~328 temas por materia).
- [ ] **Estado por tema**: no empezado / estudiando / cantable / dominado / oxidado.
- [ ] **Timer de estudio** con tracking de horas efectivas por tema y por sesión.
- [ ] **Registro de cantes**: fecha, duración, nota del preparador, fallos por epígrafe.
- [ ] **Sistema de repaso espaciado** (SRS tipo Anki) adaptado al ciclo de la oposición.
- [ ] **Dashboard**: horas semanales, temas dominados vs. pendientes, alertas de "temas oxidados".

### Fase 2

- [ ] **Calendario/planificación**: asignar temas a semanas, previsualizar carga.
- [ ] **Notas por epígrafe** dentro de cada tema.
- [ ] **Flashcards** integradas para epígrafes concretos.
- [ ] **Estadísticas avanzadas**: curva de aprendizaje, predicción de "listo para examen".
- [ ] **Modo preparador**: alta de alumnos, feedback estructurado.

### Fase 3

- [ ] **Comunidad** (opcional, con moderación): comparación anónima de progreso.
- [ ] **Integración con audio**: grabar cantes y transcribir para autocorrección.
- [ ] **App móvil** (Expo/React Native) para timer + repaso en cualquier sitio.

---

## Stack técnico

> Por definir con las instrucciones del usuario. Propuesta por defecto:

- **Frontend**: Next.js 15 (App Router) + TypeScript + Tailwind + shadcn/ui.
- **Backend**: Next.js API routes / Server Actions.
- **Base de datos**: Supabase (Postgres + Auth + RLS + Storage).
- **Auth**: Supabase Auth (email + Google).
- **Deploy**: Vercel (frontend) + Supabase (backend gestionado).
- **Analytics**: PostHog o similar (opt-in).

---

## Arquitectura

```
┌──────────────────────────┐
│  Next.js App (Vercel)    │
│  - UI + Server Actions   │
│  - Auth con Supabase SDK │
└───────────┬──────────────┘
            │
            ▼
┌──────────────────────────┐
│  Supabase                │
│  - Postgres (RLS)        │
│  - Auth                  │
│  - Storage (audio cantes)│
└──────────────────────────┘
```

---

## Modelo de datos (borrador)

Tablas principales previstas:

- `users` — perfil del opositor (fecha inicio, oposición objetivo, preparador).
- `subjects` — materias (Civil, Mercantil, Hipotecario…).
- `topics` — temas del programa (numeración oficial, materia, texto).
- `topic_status` — estado por usuario y tema.
- `study_sessions` — sesiones de estudio con timer (inicio, fin, tema, notas).
- `recitations` — cantes registrados (fecha, tema, duración, valoración, feedback).
- `reviews` — repasos programados por SRS.
- `notes` — notas libres por tema/epígrafe.

Detalle final tras las instrucciones del usuario.

---

## Roadmap

- **v0.1** — Bootstrapping: Next.js + Supabase + Auth + seed del programa oficial.
- **v0.2** — MVP: estado por tema, timer, dashboard básico.
- **v0.3** — Cantes y repaso espaciado.
- **v0.4** — Estadísticas avanzadas.
- **v1.0** — Modo preparador y multi-oposición.

---

## Cómo arrancar en local

> Instrucciones definitivas se añadirán cuando exista el código. Placeholder:

```bash
# Requisitos: Node 20+, pnpm, cuenta de Supabase

git clone https://github.com/eduardodelreal/opos-notaria.git
cd opos-notaria
pnpm install
cp .env.example .env.local  # rellenar con credenciales de Supabase
pnpm dev
```

---

## Estructura del repo

```
opos-notaria/
├── app/               # Next.js App Router
├── components/        # UI (shadcn/ui + custom)
├── lib/               # Utilidades, cliente Supabase
├── db/                # Migraciones y seeds del programa oficial
├── public/            # Assets estáticos
├── docs/              # Documentación de producto
└── README.md
```

---

## Convenciones

- **Idioma**: la app es **en español** (público objetivo 100% ES). El código y los commits pueden estar en inglés.
- **Commits**: [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, `chore:`).
- **Branch principal**: `main`. Trabajo en ramas `feat/*` con PR.
- **Formato**: Prettier + ESLint.
- **Tipado**: TypeScript estricto (`strict: true`).

---

## Licencia

Por definir. Propuesta: **MIT** para el código; el contenido del programa oficial es de dominio público (BOE).

---

_Repo iniciado el 2026-08-07 por [@eduardodelreal](https://github.com/eduardodelreal)._
