# Design Brief — ft_ai_learn (acceso, cuenta, y el grafo que viene)

> Paso 1 del proceso brief-first de `frontend-anti-slop`. **Ninguna línea de CSS/JSX de presentación
> se escribe antes de rellenar este brief y derivar los tokens.** El orden es contrato, no sugerencia.
>
> Este brief nace en **FTAI-D.2** (la pantalla de acceso) pero **gobierna también FTAI-E** (el grafo).
> Se escribe entero ahora a propósito: elegir la dirección viendo sólo un formulario de login daría
> una decisión que no aguanta la pantalla que de verdad importa.

## 1. Contexto, industria y audiencia
- **Producto / superficie:** `ft_ai_learn`, PWA de microlearning sobre un mapa de competencias de IA
  al estilo del Holy Graph de 42. Superficies de este brief: **acceso** (registro por invitación y
  login), **cuenta** (tus invitaciones y tu cupo) y, en la hija siguiente, **el grafo**.
- **Industria / dominio:** formación técnica autodirigida con evidencia verificable (rúbricas, commits).
- **Audiencia primaria:** el autor y un círculo cerrado por invitación — gente técnica, con criterio,
  que ya sabe lo que es una terminal. **Entorno de uso declarado en la spec §13.4: de pie, en el
  metro, en sentadas de quince minutos.** Móvil primero, con la red yéndose.
- **Densidad de información esperada:** **intermedia tirando a densa**. El grafo pide densidad; el
  acceso pide calma. La densidad varía por superficie, la voz no.

## 2. Tone & Direction (estética elegida — UNA, comprometida)
- **Dirección elegida:** **Carta estelar.** Un mapa del cielo, no un panel de control. Fondo de noche
  profunda; los nodos son **estrellas** —encendidas, apagadas, con halo— y las aristas son **líneas de
  constelación**: trazos finos que unen puntos y dibujan una figura que sólo se ve entera al alejarse.
  El acceso es **la entrada al mapa**: sobrio, con el cielo ya detrás.
- **Justificación:** el producto **es literalmente un grafo de competencias que se ilumina**
  conforme avanzas. La metáfora no es decorativa — es la que ya usa el dominio: nodos que se
  desbloquean, ramas que se especializan, un radar de ejes. Una carta estelar da el vocabulario
  visual hecho (*bloqueado* = estrella apagada, *disponible* = halo, *hecho* = brillo pleno,
  *prerequisito* = línea trazada) en vez de inventarlo con badges de colores. Y encaja con el
  entorno real: pantalla oscura, de noche, en el metro, con una mano.

## 3. Anti-objetivos (lo que esta UI NO será)
- **NO** un panel de SaaS: nada de sidebar + breadcrumb + tarjetas equidistantes con métrica y flechita.
- **NO** un LMS: ni barras de «completado 34%» como protagonistas, ni gamificación de confeti, ni
  medallas. El progreso se lee en el cielo, no en un termómetro.
- **NO** gradiente morado→azul, ni glassmorphism, ni sombras difusas de plantilla.
- **NO** centrarlo todo: el mapa se ancla y se recorre; el contenido no flota en el medio por defecto.
- **NO** fuentes de marca genéricas (`Inter`, `Roboto`, `system-ui` como identidad).

## 4. Paleta (roles + hex de referencia → se traducen a tokens OKLCH)
Base neutra dominante (la noche), **un** acento nítido (la luz de las estrellas) y un ámbar reservado
para lo que reclama atención. Nada de paleta tímida equidistante: el celeste manda y el ámbar es raro.

| Rol | Hex de referencia | Token destino (OKLCH) |
|-----|-------------------|-----------------------|
| Base / fondo (noche) | `#0b1020` | `--color-fondo` |
| Superficie (panel sobre el cielo) | `#121a2e` | `--color-panel` |
| Borde / horizonte | `#1e2b47` | `--color-borde` |
| Texto | `#e6edf7` | `--color-tinta` |
| Texto tenue | `#8ea3c4` | `--color-tenue` |
| Acento nítido (luz de estrella) | `#7dd3fc` | `--color-acento` |
| Halo (nodo disponible) | — | `--color-halo` |
| Línea de constelación | — | `--color-linea` |
| Estrella apagada (bloqueado) | — | `--color-apagado` |
| Aviso (error, cupo agotado) | — | `--color-alerta` |

Los cuatro primeros vienen de la semilla de FTAI-B y **se conservan**: la identidad ya existía y era
coherente con la dirección; lo que faltaba era el brief que la justificara y los tokens en OKLCH.

## 5. Tipografía (display / body / mono + justificación)
- **Display:** una **serif de contraste alto** para marca y titulares. Justificación: las cartas
  astronómicas antiguas eran grabados con serifas; una display serif sobre fondo oscuro da la
  autoridad de instrumento antiguo y separa el producto de todo el SaaS sans-serif. Se **auto-aloja**
  en `woff2`: la spec §13.4 pide offline de verdad y una fuente de CDN es un tercero en el camino
  crítico (§13.3 prohíbe terceros en el camino crítico).
- **Body:** una **grotesca legible** de x-height alta para leer de pie en movimiento. No es la fuente
  de marca — la marca la lleva la display —, así que un stack de sistema bien especificado es legítimo
  aquí y ahorra bytes en la primera carga, que es lo que se paga en el metro.
- **Mono:** para códigos de invitación e ids de nodo, donde importa distinguir `0`/`O` y `1`/`l`.
  Stack de sistema mono.

## 6. Movimiento (profundidad de motion)
- **Profundidad:** **micro-feedback**, con un único momento de alto impacto reservado para el grafo.
- **Momentos clave:**
  - *Acceso*: transición de estado del botón mientras la petición vuela. Nada más — un formulario que
    se anima es un formulario que estorba.
  - *Cuenta*: aparición del código recién emitido; es lo único que hay que copiar, y merece que el ojo
    lo encuentre.
  - *Grafo (FTAI-E)*: **el encendido de un nodo al completarlo**, y el trazo de las líneas que
    desbloquea. Ése es el momento de alto impacto del producto entero; no se gasta antes.
  - Todo respeta `prefers-reduced-motion`: en el metro, con mareo, el movimiento es hostil.

## 7. Referencias conceptuales (3)
1. **Cartas astronómicas grabadas (Bayer, *Uranometria*)** — tomo: la serif de autoridad, las líneas
   finas de constelación sobre fondo profundo, y la idea de que la figura emerge al unir puntos.
   **No** tomo: el ornamento, las figuras mitológicas, el papel envejecido.
2. **La vista estelar del Dashboard del enjambre** — tomo: la coherencia con el resto de la casa y el
   tratamiento de nodos con halo sobre azul profundo. **No** tomo: su densidad de galaxia 3D, que aquí
   sería ruido.
3. **Kurzgesagt** — tomo: el color usado como señal —pocos tonos, muy saturados, sobre base oscura— y
   la claridad de una figura simple sobre fondo complejo. **No** tomo: la ilustración plana ni el
   humor visual; esto es un instrumento, no una explicación.
