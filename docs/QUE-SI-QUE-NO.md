# Qué SÍ y qué NO debe tener esta app

La lista de decisiones de producto. Escrita antes de programar y usada como filtro
para todo lo que entra en el repo. La regla es una: **si no ayuda a un opositor a
llegar al tribunal sabiéndose 328 temas, no entra.**

---

## Parte 1 · Lo que SÍ, por orden de impacto

### Nivel 1 — Sin esto la app no existe

| # | Feature | Problema del opositor | Esfuerzo | Estado |
|---|---------|----------------------|----------|--------|
| 1 | **Cante cronometrado con nota automática** | «Creo que voy bien de tiempo» no es un dato. El tribunal te corta a los 12 minutos y nadie mide eso en casa. | M | ✅ |
| 2 | **Sistema de vueltas (SRS de temas, no de tarjetas)** | Repasa lo que recuerda que repasó, no lo que toca. Los agujeros aparecen en el examen. | L | ✅ |
| 3 | **Temario completo precargado y editable** | Media hora de Excel antes de poder empezar a estudiar. | M | ✅ |
| 4 | **Panel de "lo que toca hoy" ordenado por riesgo** | Abre el cuaderno y decide con la intuición. La intuición prioriza lo que le gusta. | M | ✅ |
| 5 | **Grabación del cante vinculada al tema** | Se escucha a sí mismo cero veces. No detecta las muletillas ni los silencios. | M | ✅ |
| 6 | **Estado por tema con oxidación automática** | «Ese lo tengo» dicho de un tema cantado hace cuatro meses. | S | ✅ |

### Nivel 2 — Lo que convierte la app en la herramienta central del día

| # | Feature | Problema del opositor | Esfuerzo | Estado |
|---|---------|----------------------|----------|--------|
| 7 | **Calendario con tareas recurrentes reales** | Día de preparador, dictamen del sábado, repaso quincenal de Fiscal: todo en la cabeza. | L | ✅ |
| 8 | **Botón de pánico (reprogramación)** | Un día de gripe descuadra la semana y abandona el plan entero. | M | ✅ |
| 9 | **Previsión de carga a 6 semanas** | Llega a marzo con 70 temas vencidos el mismo día. | M | ✅ |
| 10 | **Bombo virtual + simulacros** | Entrena cantando lo que ha elegido él. En el examen no elige. | M | ✅ |
| 11 | **Métricas por bloque** | Sabe que Hipotecario va flojo, pero no *cuánto* ni comparado con qué. | M | ✅ |
| 12 | **Índice de preparación y ritmo de primera vuelta** | «¿Me presento a esta convocatoria o a la siguiente?» decidido a ojo. | M | ✅ |
| 13 | **Modo ciego** | Canta paseando; el móvil en la mesa se apaga o se toca solo. | S | ✅ |
| 14 | **Compartir el cante con el preparador** | El feedback llega por WhatsApp y se pierde. El preparador no va a instalarse nada. | M | ✅ |
| 15 | **Registro de tiempo de estudio separado del cante** | Cuenta como estudio el rato leyendo. Leer no es cantar. | S | ✅ |

### Nivel 3 — Cuando ya haya usuarios de verdad

| # | Feature | Por qué después | Esfuerzo |
|---|---------|-----------------|----------|
| 16 | **Panel del preparador** (varios alumnos) | Necesita opositores usándola primero. Es la palanca B2B. | XL |
| 17 | **Transcripción del cante con Whisper** | Barato de implementar, caro de que sea útil sin ajustar. | L |
| 18 | **Detección de silencios y ritmo del audio** | Métrica valiosa (segundos de bloqueo) pero requiere el punto 17. | L |
| 19 | **Notas por epígrafe con mapa de fallos** | Estructura de datos ya prevista (`epigrafes`), UI pendiente. | M |
| 20 | **Módulo de dictamen** con casos y corrección | Es media oposición, pero es *otro* producto dentro del producto. | XL |
| 21 | **App móvil nativa (Expo)** | La web instalable cubre el 90% mientras no haya tracción. | XL |
| 22 | **Multi-oposición** (Registros, Judicatura) | Solo cambia el catálogo. Ya está preparado el campo. | M |

---

## Parte 2 · Lo que NO. Y por qué

Esta es la parte importante. Casi todo el software de estudio fracasa por lo que
mete, no por lo que le falta.

### ❌ Flashcards sueltas al estilo Anki
El opositor no memoriza definiciones aisladas: recita 20 minutos seguidos con
estructura, transiciones y citas. Partir el tema en tarjetas entrena una habilidad
que **no es la que se examina** y da una falsa sensación de dominio. La unidad de
repaso aquí es el tema completo.

### ❌ Rachas que se rompen y castigan
Una racha de 300 días que se rompe por una gripe es una razón para cerrar la app y
no volver. Aquí la racha se calcula con el objetivo mínimo del día (cantes **o** el
85% de las horas) y el día de hoy nunca la rompe hasta que acaba.

### ❌ Gamificación infantil
Ni mascotas, ni confeti, ni «¡bien hecho campeón!», ni XP por abrir la app. Un
jurista de 28 años que estudia 10 horas al día se siente insultado. Los hitos son
en números romanos, miden trabajo real y se cuentan en una línea.

### ❌ Notificaciones push de motivación
«¡No pierdas tu racha!» a las 21:00 es la razón número uno para desinstalar. Si
hay avisos algún día, serán sobre datos (`tienes 14 temas vencidos`), nunca sobre
sentimientos.

### ❌ Feed social, ranking público y comparación con otros opositores
En una oposición con 40 plazas y 800 aspirantes, un ranking visible genera ansiedad
sin mejorar el rendimiento. Y una filtración de «voy por el tema 90» daña a alguien
en un mundo pequeño donde todos se conocen. Si algún día hay comparación, será
agregada, anónima y opt-in.

### ❌ Temario con contenido nuestro
No vamos a escribir los 328 temas. Es un producto distinto (editorial), con riesgo
jurídico, coste enorme y competencia frontal con los preparadores, que son quienes
nos van a recomendar. La app **mide** el estudio; el contenido es del opositor y de
su preparador.

### ❌ IA que «te corrige el cante» de entrada
Una nota generada por un modelo que no ha leído el temario oficial es ruido con
apariencia de dato. Y el opositor detecta la impostura en dos usos. Primero la
transcripción y las métricas objetivas (tiempo, silencios, velocidad); el juicio de
contenido es del preparador.

### ❌ Chat, foro o comunidad
Moderar es un trabajo a tiempo completo. Un foro sin moderar en una oposición se
llena de rumores sobre el tribunal y de ansiedad compartida. No es nuestro trabajo.

### ❌ Pomodoro, matriz de Eisenhower y productividad genérica
El opositor a Notarías ya tiene un método impuesto por su preparador. La app se
adapta a él, no le enseña a estudiar.

### ❌ Onboarding de 8 pantallas
Al primer arranque el programa ya está cargado y se puede cantar un tema en 30
segundos. El resto se configura desde Ajustes cuando le apetezca.

### ❌ Modo oscuro como prioridad
Contra la intuición: el opositor estudia de día en una mesa con flexo, y la app se
usa en ráfagas de dos minutos entre cantes. Tonos claros, papel, cero estridencia.
Antes que un tema oscuro hay veinte cosas más útiles.

### ❌ Sincronización en tiempo real y colaboración
Un solo usuario, un solo dispositivo a la vez. Websockets, presencia y resolución
de conflictos serían complejidad pura sin beneficio.

### ❌ Cronómetro que suena como una alarma
Un pitido agresivo a los 12 minutos rompe la concentración justo cuando hay que
cerrar el tema con elegancia. Dos tonos suaves (80% y 100%) y el fondo de pantalla
que cambia de color despacio.

---

## Parte 3 · Las tres que se cuentan entre opositores

Lo que hace que alguien lo mencione en la academia sin que se lo pidas.

### 1. El bombo con los nervios incluidos
Nadie más lo tiene. Sortear cuatro bolas, ver salir los temas y ponerse a cantar en
frío es exactamente el examen. Es la pantalla que un opositor le enseña a otro.

### 2. La nota que castiga el tiempo
En el resto de apps un cante «perfecto» de 19 minutos sale con un 10. Aquí sale con
un 6,5, y esa es la conversación: *«esta app me ha dicho que voy sobrado de
contenido y fatal de reloj»*. Es un insight que el opositor no tenía.

### 3. El enlace para el preparador
Un notario en activo con 10 minutos libres abre un enlace en el móvil, escucha el
cante y contesta. Sin cuenta, sin app, sin instalar nada. Cuando el preparador lo
usa, recomienda la app a sus otros diez opositores. Es el canal de distribución.

---

## Parte 4 · Monetización

| Modelo | A favor | En contra | Veredicto |
|--------|---------|-----------|-----------|
| **Suscripción mensual** | Ingreso recurrente durante 4–7 años de preparación. | Un opositor sin ingresos ve 12 €/mes × 60 meses = 720 €. | ✅ Base, con precio bajo (7–9 €) |
| **Freemium** | Sin barrera; el programa precargado engancha el primer día. | El valor está en el histórico acumulado: limitarlo mutila justo lo que retiene. | ✅ Gratis generoso: todo menos audio en la nube e histórico >90 días |
| **Pago único** | Encaja con la mentalidad del opositor (compra un libro, no un servicio). | Storage de audio es coste recurrente. Insostenible. | ❌ |
| **B2B preparadores** | Un notario con 15 opositores = 15 usuarios de golpe. Es el multiplicador. | Producto distinto (panel del preparador). Requiere el punto 16. | ✅ Fase 2, y ahí está el margen |
| **Academias** | Contratos anuales grandes. | Ciclo de venta lento; te vuelves proveedor y pierdes el contacto con el usuario. | ⚠️ Solo cuando haya marca |

**Recomendación:** gratis con límites que no duelan → 7–9 €/mes para el opositor →
licencia de preparador con panel, a 3–5 € por alumno, cuando exista.

---

## Parte 5 · Las cinco formas de fracasar

1. **Que registrar el estudio cueste más que estudiar.** *Mitigación:* un cante se
   registra en tres toques (empezar → terminar → calificación) y nada más es
   obligatorio.
2. **Que el SRS abrume.** 40 temas vencidos un lunes y el opositor vuelve al Excel.
   *Mitigación:* la cola del día está topada por su objetivo, el fallo retrocede
   escalones en vez de resetear, y hay jitter para no acumular vencimientos.
3. **Que el opositor no confíe en la nota.** Si le parece arbitraria, ignora la
   mitad de la app. *Mitigación:* la fórmula está explicada en la propia pantalla,
   los pesos son ajustables y la nota se puede ver descompuesta antes de guardar.
4. **Que los preparadores la vean como competencia.** Son los guardianes del canal.
   *Mitigación:* la app no da contenido ni corrige; les manda el audio de sus
   alumnos y les ahorra tiempo. Nunca sustituye su criterio.
5. **Que el mercado sea demasiado pequeño.** ~1.500 opositores activos a Notarías en
   España. *Mitigación:* el modelo de datos es agnóstico al catálogo; Registros,
   Judicatura, Abogacía del Estado e Inspección de Hacienda comparten la mecánica
   de cantar temas. El programa es un dato, no código.
