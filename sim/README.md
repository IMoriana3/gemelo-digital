# Simulador de planta TCU — el gemelo total

> Una planta entera de seguidores Factiun simulada equipo a equipo —NCU, TCUs, HSUs y repetidores—, con la jerarquía de control real y **el mapa Modbus de los tres dispositivos actualizándose en vivo**.

Se abre en `../simulador.html`. No necesita servidor ni red: es HTML y tres ficheros JS.

## Por qué

El gemelo de `index.html` ya tenía seguimiento solar y los modos manual/auto de un seguidor. Lo que faltaba para que sirviera de banco de pruebas es todo lo demás: **la planta**. Un TCU no decide solo — le llegan el viento de una HSU que no es la suya, un interruptor de limpieza del armario de la NCU, un forzado por Modbus a su grupo, una seta que inhibe el motor entero. Y esas decisiones se ven, desde fuera, como registros Modbus concretos.

Aquí están las dos cosas a la vez: el comportamiento y su reflejo en el mapa.

## Jerarquía de control

De más a menos prioritaria. La regla que gana es la que fija el ángulo objetivo; la vista **Detalle del equipo** la pinta en verde y en ámbar las que están activas pero pierden.

| # | Regla | Qué la dispara | Dónde se ve |
|---|---|---|---|
| — | **Seta de emergencia** | pulsador local, seta del armario o cable cortado | no decide el objetivo: **corta el motor**. 30002.4 · NCU 30100.13 · 30006.11 |
| 1 | **SP1 viento** | nivel de viento de cualquier HSU o `force_sp_1` al grupo | 30001 bits 15:13 = 1 |
| 2 | **SP3 nieve** | alarma de nieve o `force_sp_3` | 30001 bits 15:13 = 3 |
| 3 | **SP4 limpieza** | interruptor de limpieza del grupo (NCU 30100 bits 12:3) o `force_sp_4` | 30001 bits 15:13 = 4 |
| 4 | **SP2/5/6/7** | forzados genéricos de la NCU (40002, 40005–40007) | 30001 bits 15:13 |
| 5 | **Restricción de batería** | SoC bajo el crítico de la estrategia → defensa 55° y *no disponible*; bajo L2 del firmware → congela el seguimiento | 30001 bits 2:1 · 30002 bits 13/12/11 |
| 6 | **Manual** | modo 1, consigna del operador | 30001 bits 9:8 = 1 |
| 7 | **Auto** | seguimiento solar con backtracking; de noche, posición nocturna | 30001 bits 9:8 = 2, bit 0 = backtracking |

El viento manda sobre manual, que es como se comporta el equipo real.

### Abanderamiento — `viento.js`, compartido entre repos

La estrategia **B2** canónica (`solargpt_core/wind_stow_strategies.py`, *«Defaults canónicos, decisión EPC del proyecto»*) no se implementa aquí: vive en **`sim/viento.js`**, y es el único sitio de la casa donde está escrita. La usan **cuatro** páginas:

| | |
|---|---|
| `simulador.html` | la planta entera, con el selector de las cuatro estrategias |
| `index.html` | el gemelo 3D de un seguidor |
| `bateria.html` | el estudio de autonomía (paso horario) |
| `cobertura-zigbee/terreno.html` | el visor 3D de planta, con su propio selector |

Mismo criterio que `seguidor.js`: si se toca en un repo, se copia al otro.

| | |
|---|---|
| **40 km/h** | bandera **parcial**: el seguidor se queda dentro del **sector [30°, 55°]** del lado del sol. No es irse a 30°: si el seguimiento pide 42°, se queda en 42. Sigue produciendo, pero ya no da la cara plana |
| **60 km/h** | bandera **total**: ±55° |
| **30 min** | histéresis para desabanderar (`destow_hold_minutes`) |
| **cara al sol** | eje B del canon |

Y están **las cuatro** del canon, elegibles en la interfaz igual que en el selector de Streamlit:

| | 1 umbral · todo o nada | 2 umbrales · sector parcial + histéresis |
|---|---|---|
| **cara al SOL** | B1 | **B2** ← la de la casa (decisión EPC) |
| **cara al VIENTO** | A1 | A2 |

Con un umbral no hay sector parcial ni histéresis: por encima de 40 km/h, bandera completa, y suelta en cuanto baja. Cambiar de estrategia es **en caliente**, sin rehacer la planta. En el eje A (cara al viento) hace falta saber de dónde **viene** el viento, así que el selector saca además el azimut meteorológico (0 N · 90 E · 180 S · 270 O); en el eje B lo esconde, porque no pinta nada.

Y una regla que **no está en el canon pero sí en el equipo**, aprendida de `terreno.html`: **el lado se fija al abanderar**. Si abandera de mañana mirando al este, se queda al este aunque el sol cruce el mediodía. Recalcularlo a media bandera manda al seguidor a cruzar 110° con el viento encima — justo lo que el abanderamiento existe para evitar. El simulador lo hacía mal hasta que se unificó.

Ojo con el azimut: el canon usa convención pvlib (90° = este al amanecer) y la casa usa 0 en el mediodía solar con negativo al este. La conversión es `az_pvlib = 180 + az`, y equivocarla abandera al lado contrario sin que salte nada.

### Cielo cubierto — `difusa.js`, del canon `DiffuseConfig`

Con el cielo cerrado casi toda la irradiancia es **difusa**, y la difusa no viene de donde está el sol: viene de todo el cielo. Apuntar al sol deja de ser lo mejor, porque un plano de canto ve menos cielo que uno tumbado. Las cuatro políticas de `solargpt_core/tracker.py`, elegibles en la interfaz:

| | |
|---|---|
| `none` | no toca nada. La referencia |
| `poa_switch` | como `flat` pero con máquina de estados: **30 min** confirmando antes de entrar y **90 min** de permanencia mínima. La que se parece a un equipo real — uno que se tumba y se levanta con cada nube se rompe |
| `flat` | si el plano llano recoge un **2 %** más, se tumba. Sin memoria |
| `continuous` | barre α ∈ {0, ¼, ½, ¾, 1} sobre θ = (1−α)·θ<sub>bt</sub> y se queda con el mejor POA. Es el **techo teórico**: nunca peor que `flat`, porque `flat` es α = 1 |
| `limited` | mantiene el ángulo anterior mientras no pierda POA. No busca ganancia: busca **no moverse** |

Las ventanas van en **minutos y no en pasos**, que es lo que las hace independientes del paso de simulación — el canon lo dice explícitamente (schema 2.1.0). Aquí se acumulan minutos de reloj simulado en vez de contar pasos: lo mismo en el límite continuo, y lo correcto cuando el paso es variable.

**Dos reglas que no se negocian**, las dos aprendidas a base de disgusto:

1. **Protección por encima de optimización.** Donde hay abanderamiento, noche o defensa por batería, la difusa **no toca el ángulo**. En SolarGPT se cazó en producción al revés: con 90 km/h el motor devolvía `stow_active=1` y a la vez θ=0°, porque el plano llano recogía un 2 % más. El tracker tumbado en pleno vendaval con el registro diciendo que estaba aparcado.
2. **Clamp al backtracking.** |θ| nunca por encima de |θ<sub>bt</sub>|. El backtracking ya recortó el ángulo para no sombrear al vecino; dejar que la difusa lo abra otra vez es inventarse energía que se come la fila de al lado.

Medido sobre un día de junio en Gorraiz con el cielo al 95 %:

| política | min al plano | motor/día |
|---|---|---|
| `none` | 0 | 13,60 Wh |
| `flat` | 562 | 7,48 Wh |
| `poa_switch` | 687 | 5,75 Wh |
| `continuous` | 672 | 4,36 Wh |
| `limited` | 354 | 3,49 Wh |

Con el cielo despejado **ninguna interviene**, que es la primera comprobación que hay que exigirle a esto.

### El reparto entre directa y difusa — `cielo.js`, y por qué era lo que faltaba

La política de arriba no se disparaba nunca, y no era culpa suya: el gemelo repartía la global con una regla **inventada**, `dhi = ghi · (0,12 + 0,6·nubes)`. Con el cielo cerrado del todo dejaba un **28 % de directa** que en un día encapotado no existe — y mientras quede directa, apuntar al sol siempre gana.

Ahora usa **Erbs (1982)**, que es el modelo por defecto de `solargpt_core.meteo.decompose_ghi` (*«erbs, default robusto»*) y lo que implementa `pvlib.irradiance.erbs`. Depende solo del índice de claridad `kt = GHI / (I0·cos z)`:

```
kt ≤ 0,22        kd = 1 − 0,09·kt                                   → casi todo difusa
0,22 < kt ≤ 0,80 kd = 0,9511 − 0,1604kt + 4,388kt² − 16,638kt³ + 12,336kt⁴
kt > 0,80        kd = 0,165                                         → cielo limpio
```

Con el cielo cerrado (kt ≈ 0,15) sale **kd ≈ 0,99**. Esa es la diferencia entre una política que no se activa jamás y una que se activa cuando toca.

## Las dos entradas físicas

Las entradas que mandan sobre el seguidor no se parecen en nada, y modelarlas igual era lo que impedía representar los fallos que más se ven en planta.

### Inclinómetro — entrada analógica

El TCU **no sabe dónde está la mesa**: sabe lo que mide. La simulación mantiene las dos cosas por separado:

```
anguloReal    la mesa. Solo la sabe el simulador (y el operario con el nivel)
angulo        = real + desajuste de montaje − offset(41058) + deriva térmica + ruido,
              cuantizado a 34,7 pulsos/° y filtrado
```

**El lazo se cierra sobre la medida, y los registros publican la medida.** De ahí sale el defecto que no se ve en pantalla: pon 3° de desajuste sin compensar en 41058 y el TCU publicará que está clavado en su objetivo mientras la mesa está 3° torcida — con el SCADA en verde y la producción sin aparecer. Es justo lo que persigue el ensayo **D.1.1** del Anexo 4 con instrumento externo, y por eso ese ensayo necesita instrumento externo.

La cuantización sale del propio mapa: `41037/41038` dan ±1910 pulsos para ±55°. Y los **deadbands también están en pulsos**: `41060/41061` = 45 (1,3°) y `41063` = 90 (2,6°) cuando hay alarma de baja capacidad — el propio firmware engorda el lazo cuando va justo de batería.

### Seta — entrada binaria

No es una regla de la jerarquía: es una **línea de contacto que corta la alimentación del puente en H**. Modelada como tal:

- **Antirrebote**: un pulso de 20 ms no dispara nada.
- **Normalmente cerrado**: un cable cortado se lee como pulsada. Un lazo de seguridad que fallara al revés no sería un lazo de seguridad.
- **Enclavada**: soltarla **no** rearma el motor. Hay que limpiar la alarma con `40007` bit 13 — el botón «LIMPIAR ALARMAS» de la toolbox. Y como la seta del armario alcanza a toda la planta, hay que limpiar la flota entera, no el equipo que estés mirando.
- **El algoritmo sigue calculando por debajo**: la consigna se mueve con el sol y `30110` (objetivo − real) se va abriendo. Eso es lo que ve el operario, y con la seta modelada como una decisión no pasaba.

### El eje: la avería es física, la alarma se deduce

Dos averías distintas que el equipo distingue por caminos distintos:

| Avería | Qué pasa | Cómo se entera el TCU |
|---|---|---|
| **Eje calado** | no gira y el motor pega corriente de calado | salta la **sobrecorriente software** (`41040`, 7000 mA) casi al instante → `30003.5` |
| **Eje duro** | gira, pero arrastrándose, sin llegar al disparo | por la vía lenta: ventana de `41039` (5 s), `41065` reintentos (3) → **eje bloqueado** `30003.8` |

Ninguna de las dos se declara: el firmware simulado las **deduce** comparando lo que manda mover con lo que el inclinómetro dice que se ha movido. Escribir bien esa comparación tiene su miga — hacerla contra la velocidad máxima en vez de contra el paso mandado hace que cualquier corrección pequeña se diagnostique como eje bloqueado.

## Alimentación y gestión de batería

No es una copia del modelo canónico: **se lee de él**. `sim/fisica.js` lo genera `tools/extrae_fisica.mjs` a partir de sus fuentes, igual que el mapa Modbus:

| Fuente | Qué aporta |
|---|---|
| `SolarGPTfull/solargpt/solargpt_core/tcu.py` | los 8 perfiles de hardware, el motor medido (campaña *Consumos motor_02 @24V*) y las políticas de verano/invierno. El fichero se declara a sí mismo *single source of truth* |
| `SolarGPTfull/solargpt/scripts/tfm_constants.py` | las constantes del TFM |
| `bateria.html` | las curvas y umbrales de la estrategia, que solo existen en JS: C-rate, JEITA, calefactor, transposición isotrópica, abanderamiento |
| `SolarGPTfull/solargpt/solargpt_core/tcu_compare.py` | no aporta nada a `fisica.js` —el simulador no lo usa— pero **se coteja**: es el motor con el que SolarGPT compara variantes, y sus *defaults* tienen que decir lo mismo |

Lo que hace que valga la pena no es copiar sin manos: es que **contrasta lo que aparece en más de una fuente y se niega a generar si divergen** (K0, K1, pico de motor, idle, sleep, tensión nominal, capacidad). Que es exactamente el bug que cuenta la cabecera de `tfm_constants.py`: `cap_Wh` copiado en cuatro scripts y arreglado solo en uno.

La cuarta fuente entró por un caso real: `tcu_compare.py` llevaba `p_sleep = 0,45 W` mientras `tcu.py` decía 0,64, y el generador no lo veía porque solo contrastaba `tcu.py` contra `bateria.html`. **Un divergente escondido en la fuente que nadie coteja son ~2 puntos de SOC.**

La segunda que salió al cotejar fue la **velocidad del actuador**: `tcu_compare.py` traía **0,16 °/s** por defecto frente a los **0,17** medidos en campo, que ya usaban `poa.py`, `bankable_config.py` y los scripts de validación desde siempre (`tracker.CANONICAL_SLEW_RATE_DEG_PER_S`). No es cosmético: el motor gasta `P(θ)·Δθ/v`, así que el valor lento inflaba un **6,3 %** la energía de **cada** movimiento del año. Resuelto a 0,17.

Y el generador ya no se conforma con que los números coincidan: exige que `tcu_compare.py` los escriba como **nombre del canónico**, no como cifra. Un número que hoy coincide es el que mañana se queda atrás — que es literalmente lo que pasó con el sleep y con el slew. Si alguien vuelve a escribir `0.16` ahí, el generador se planta:

```
✗ LAS FUENTES NO DICEN LO MISMO — no se genera nada:
  velocidad del actuador:  el canon = 0.17   ≠   tcu_compare.py = 0.16
  velocidad del actuador: tcu_compare.py lo escribe como número (0.16) en vez de
  importar el canónico. Hoy coincide; mañana es el que se queda atrás.
```

## El consumo no lo calcula el gemelo

Lo que gasta un TCU en un paso —electrónica, motor y calefactor— vive en **`consumoTCU`**, dentro del módulo de gestión de batería (`bateria.html`), y el generador lo copia **entero** a `fisica.js` igual que las cuatro curvas. El gemelo y el informe de impacto **no lo recalculan: lo llaman**.

```js
consumoTCU({ dtH, dia, mov, pos, motorModel, calefactada, tAmb })
// → { base, motor, heat, total, tEff }
```

El reparto de responsabilidades queda así: el gemelo decide **cuánto se mueve** el seguidor y **en qué ángulo** —eso es suyo, con su lazo, su banda muerta en pulsos y su sensor— y el módulo dice **cuántos Wh cuesta eso**. Lo único que el gemelo sigue calculando aparte es el consumo de una **avería**: un eje calado o duro consume la corriente de la avería, que es cosa del equipo y no de la gestión de batería.

Las constantes se pueden pasar (`k0`, `k1`, `picoW`, `vNom`, `slew`, `idleW`, `sleepW`) y si no se pasan manda el canon. Sin eso, los parámetros ajustables del gemelo habrían quedado sin efecto sobre el consumo, que es peor que no tenerlos: parecen hacer algo.

Guards en `prueba.mjs`: que los Wh de motor del gemelo sean **los del módulo al bit**, que en `planta.js` ya no quede la fórmula, y que mover `MOT_K0` siga cambiando el consumo pasando por ahí. El refactor no movió ni un número — misma tabla de impacto antes y después, que es lo que se le pide a un cambio así.

Un detalle que sale al probarlo: a plena velocidad el motor **topa en su pico**. La curva medida pide ~49 W a 0,17 °/s y el tope son 50 W, así que un movimiento a tope de slew sale exactamente `MOTOR_PEAK_W · dtH`. No es un error de redondeo, es el limitador — y explica por qué *subir* K0 no cambia nada en ese régimen.

## El canon es el defecto, no el dogma

Ninguna constante está clavada. `K` nace del canon, pero **todo** se puede apartar en caliente:

```js
SIM.ajusta({ SLEW_DPS: 0.16, WIND_T1: 8 });   // surte efecto en el paso siguiente
SIM.tocados();                                 // { SLEW_DPS: {canon: 0.17, ahora: 0.16}, … }
SIM.restauraCanon();                           // y vuelta atrás
```

Se pisa el **mismo** objeto `K`, no una copia, porque el motor lee `K.LO_QUE_SEA` en el momento de usarlo: mover un valor con la planta andando no obliga a rehacer nada. Lo único con estado propio son las máquinas de abanderamiento, que releen sus umbrales en cada paso (`sincronizaBandera`) para no perder ni el estado ni el lado ya fijado.

El panel de la interfaz **no lleva escrito ni un control**: se pinta de `SIM.PARAMS`, el catálogo que da etiqueta, unidad, decimales, grupo y procedencia (`canon` = generado de SolarGPT · `del gemelo` = propio, porque el estudio de batería no lo necesita pero un equipo que sirve Modbus sí). Una constante nueva en `K` aparece sola en el panel — y si nadie la cataloga, el módulo **no carga**: `PARAMS` y `K` tienen que cuadrar exactamente.

Lo que se aparta del canon se marca en ámbar con su valor original al lado, se guarda en el navegador y se avisa: **los números que salgan de ahí ya no son comparables con SolarGPT**. Los controles que dependen de un parámetro lo siguen (el tope de eje manda en la consigna manual; los umbrales, en la nota del abanderamiento).

`bateria.html` lleva el mismo panel con sus 21 constantes. Ahí las declaraciones literales **no** se tocan nunca —son las que lee el generador para cotejarlas— así que el panel escribe sobre las variables ya cargadas, y el canon del fichero sigue siendo el del fichero.

Del lado de Python la regla es la misma y ya estaba: `run_tcu_sim` toma **todo** de `df_meta`/`config` y solo cae al canónico cuando no se lo configuras. Guard: `tests/test_tcu_compare_defaults_canonical.py` — comprueba las dos mitades, que el default apunte al canon **y** que el override siga existiendo.

```bash
node tools/extrae_fisica.mjs   # tras tocar la gestión de batería en SolarGPT
```

Conectarlo ya encontró dos divergencias con lo que había aquí escrito a mano: el **winter mode** no era solo mover menos (sube el techo a 90 % y calibra cada 3 días), y el perfil de **alterna canónico va sin batería** (`AC_grid`, 0 Ah).

### De qué come el TCU

El mismo seguidor se comporta de forma muy distinta según su alimentación, y el mapa lo declara (30000, campo *TCU type*):

| Tipo | Qué es | Lo que cambia |
|---|---|---|
| **SELF / SP** | panel auxiliar propio de 45 o 60 W, montado en el seguidor | lo que entra depende del **ángulo real**: abanderar o quedarse parado también cuesta carga. Es el caso duro |
| **STRING** | del propio string de la planta, por un convertidor **1500 / 48 V** limitado a ~57,6 W (48 V × 1,2 A) | en cuanto amanece la fuente satura en su tope, y **ese tope es el que manda** en operación normal |
| **AC** | de alterna (`AC_grid`) | en el canon va **sin batería**: mientras haya red va servido, y un corte tumba el TCU entero |

Y no cambia solo de dónde viene la corriente: cambia **qué tiene sentido mirar**. `tcu.py` trae una regla marcada como *auditada* que el simulador lee y respeta (`ui_visibility_for_source`):

| Alimentación | Panel | Batería | SoC | Calibración |
|---|---|---|---|---|
| SELF / SP | sí | sí | sí | sí |
| STRING | **no** | sí | sí | sí |
| AC | **no** | **no** | **no** | **no** |

Por eso, con un perfil de alterna, la interfaz deja de enseñar SoC y batería: no es que valgan cero, es que no hay batería que gestionar.

**Quién limita la carga, y cuándo.** Lo que entra de verdad en la batería es el **mínimo de tres**: el tope de la fuente, lo que admite la batería por C-rate a su temperatura, y lo que deja JEITA por el lado caliente. En operación normal manda el **tope de la fuente** (54 W efectivos tras η, contra los 154 W que admitiría una batería de 6 Ah a 25 °C); el C-rate solo se pone por delante **en frío**:

| Perfil | Tope de fuente tras η | Admisión a 25 °C | El C-rate manda por debajo de |
|---|---|---|---|
| SP 45 W · 6 Ah | 40,5 W | 154 W | 2,2 °C |
| SP 60 W · 6 Ah | 54,0 W | 154 W | 5,1 °C |
| STRING 60 W · 6 Ah | 54,0 W | 154 W | 5,1 °C |
| SP 45 W · 3 Ah | 40,5 W | 77 W | 10,9 °C |
| STRING 60 W · 3 Ah | 54,0 W | 77 W | 16,1 °C |

Las de 3 Ah pasan la mitad del invierno limitadas por la batería, no por el sol — que es de lo que va el estudio de disponibilidad.

> **Pendiente de confirmar en campo.** El convertidor de string está en el canon como **60 W** y el valor de planta que manejamos es **57,6 W**: un 4 % de diferencia que conviene cerrar en `tcu.py`, que es de donde lo lee todo lo demás. Y si su salida son 48 V hay una etapa más antes del bus interno, porque las alarmas del propio mapa vigilan la ventana de **22 a 33 V** en bus y motor (30005 bits 0–3).

### Estrategia oficial SUNNER

| Parámetro | Por defecto | Qué hace |
|---|---|---|
| **SOC objetivo** (techo) | 80 % verano · **90 % invierno** | con la estrategia activa la batería **no sube de ahí**: por encima del techo no entra carga, aunque sobre sol. Es lo que evita tenerla siempre al 100 % envejeciendo |
| **Carga completa** | cada 5 días verano · **3 invierno** | uno de cada N días el techo sube al 100 %, para reequilibrar |
| **SOC crítico** | 30 % | por debajo, el seguidor va a **defensa 55°** y cuenta como **no disponible**. Rearma al superar el crítico **+2 %**, que es lo que evita el baile de entrar y salir al rozar el umbral |
| **Winter mode** | off | tres cosas a la vez, las tres canónicas: techo **90 %**, calibración cada **3 días**, y paso tan grueso que consume como si corrigiera **3 °/h en vez de 10** — un 70 % menos de motor |
| **T mínima de carga** | 0 °C | por debajo no se admite carga… salvo versión LT |
| **Cut-in del regulador** | 50 W/m² | por debajo de ese POA el regulador no arranca |

### Lo que limita la carga

1. **POA de la posición REAL**, por transposición isotrópica (directa + difusa + albedo 0,2). Un seguidor abanderado o en defensa carga menos, y ese es el coste oculto de cada abanderamiento.
2. **Rendimiento de carga** η = 0,90.
3. **C-rate seguro LiFePO₄** según temperatura (1 C sobre 25 °C, 0,2 C a 0 °C, 0,05 C bajo −10 °C).
4. **JEITA** por el lado caliente: reduce a partir de 35 °C, bloquea a 45 °C.
5. **Calefactor LT**: `1 + 0,15·|T|` W bajo 0 °C, solo de día — gasta, pero desbloquea la carga.

**Consumo:** electrónica 0,64 W siempre, más el motor con el modelo que se elija — la medición de Factiun (`Wh/° = 0,0503 + 0,000845·|θ|` sobre el ángulo medio del movimiento, tope 50 W) o el consumo SUNNER en mA medios a 25,6 V (2500 / 3250 / 4000).

Los umbrales **L1/L2/L3** del firmware son otra cosa distinta y conviven con la estrategia: son los umbrales configurables de *alarma* del propio TCU (bits 13/11/12 de 30002 y el *low capacity mode* de 30001), y por debajo de L2 el firmware congela el seguimiento donde esté.

## Ficheros

| Fichero | Qué es |
|---|---|
| `planta.js` | el motor: física, jerarquía y generación de la imagen de registros. Sin DOM — se ejecuta igual en Node |
| `modbus-map.js` | **generado**, no se toca a mano: 515 direcciones del mapa canónico |
| `fisica.js` | **generado**, no se toca a mano: perfiles, constantes medidas, políticas y curvas de carga |
| `viento.js` | **compartido con cobertura-zigbee**: la estrategia B2 de abanderamiento, una sola implementación |
| `impacto.mjs` | informe de impacto de las divergencias entre los dos cálculos de batería |
| `prueba.mjs` | prueba de humo: 129 comprobaciones sobre un día de planta |
| `../simulador.html` | la interfaz |
| `../tools/extrae_mapa.mjs` | regenera `modbus-map.js` desde la ficha de `cobertura-zigbee` |
| `../tools/extrae_fisica.mjs` | regenera `fisica.js` desde SolarGPT y `bateria.html`, contrastando las fuentes |

```bash
node sim/prueba.mjs           # física + codificación de registros
node tools/extrae_mapa.mjs    # si cambia la ficha del mapa
node tools/extrae_fisica.mjs  # si cambia la gestión de batería en SolarGPT
```

La prueba decodifica **al revés** que el motor —como lo haría el colector del SCADA, no como lo escribió quien lo codificó—, así que un cambio de orden de palabra o de escala se cae en el sitio.

## De dónde salen los números

- **Mapa y bits:** ficha `cobertura-zigbee/modbus.html`, que transcribe `NCU_Modbus_Map_R7`, `SUNNER_TCU_ModbusMap_v6` (FW v1.4.3) y `HSU_Modbus_Map_R23`.
- **Escalas de los registros propios de la TCU:** las que usa la [TCU Toolbox](https://github.com/IMoriana3/scada/tree/main/tools/tcu-toolbox) contra equipo real — tilt ×10, ángulos solares ×100, temperaturas ×10, tensiones mV, corrientes mA, reloj en BCD.
- **Física, gestión de batería y umbrales:** no se escriben en este repo — llegan por `sim/fisica.js` desde SolarGPT (`solargpt_core/tcu.py`, `tfm_constants.py`) y el bloque canónico de `bateria.html`. Ver la sección de gestión de batería.
- **Criterio de salud** (`ok` / `aviso` / `alarma` / `offline`): el del colector del SCADA y la toolbox.

## Decisiones abiertas

### La curva de motor — a la espera de tres cosas

El gemelo y `bateria.html` gastan `Wh/° = K0 + K1·|θ|`, un ajuste **lineal** de la campaña *Consumos motor_02 @24V*. El port del cuaderno (`tcu_compare.py`) interpola en cambio la **tabla medida** de corriente: de 1.500 mA a 0° hasta 2.800 mA a 55°. La tabla es convexa y el lineal se queda corto en los extremos, que es donde el seguidor pasa buena parte del día.

Medido sobre 365 días con la misma velocidad de actuador en los dos lados (`node sim/impacto.mjs`):

| | motor/día | SoC mín |
|---|---|---|
| ajuste lineal, como está hoy | 16,47 Wh | 72,7 % |
| tabla medida `I(θ)` | 18,72 Wh (**+14 %**) | 72,6 % (**−0,1 pp**) |

**No se adopta todavía.** Se espera a contrastarla con:

1. la **curva medida** que tenemos,
2. los datos de campo de **El Burgo** (23003, Zaragoza),
3. los de **Ayora** (24025, Valencia).

El contraste que decide es directo: **Wh de motor por día y por TCU**, que es lo que separa los dos modelos en un 14 % — y como el SoC apenas se mueve, la autonomía no sirve para desempatar. Cuando lleguen los datos el cambio es de una línea, porque el consumo vive ya en un solo sitio (`consumoTCU`, en el módulo de gestión de batería).

> Mientras tanto, ojo con el histórico: el **+21 %** que se citó antes no era la curva sola. Se medía con el actuador a 0,16 °/s en un lado y a 0,17 en el otro, así que llevaba dentro el 6,3 % del actuador lento. Con la velocidad ya alineada, la curva sola son +14 %.

## Lo que hay que saber antes de fiarse

- **No habla Modbus por la red.** Genera la *imagen* de registros que el equipo serviría. Para ejercitar el transporte de verdad (troceado a 110 registros, orden de palabra, direccionamiento) está `scada/tools/ncu_simulada.py`, que es un esclavo Modbus TCP real.
- **Dos registros llevan codificación inventada.** 30113 (criterio del ángulo objetivo) y 30114 (fuente de la posición segura) los nombra el documento pero no transcribe su enumerado; lo mismo con los valores del campo *TCU type* de 30000. Lo que sale ahí es del simulador, y el visor lo pinta en violeta para que no se confunda con lo documentado.
- **Las filas atenuadas del visor no están simuladas.** Se listan igual para que el mapa esté entero: es preferible un hueco visible a un cero que parece un dato.
- **No es un modelo bancable de producción.** Es un banco de pruebas de control y de lectura de mapas, no un PVsyst.
- Un **repetidor** es una TCU fija: misma electrónica, batería y firmware, sin seguidor que mover. No cuenta como seguidor en los porcentajes de flota, igual que en el SCADA.

*Factiun · proyecto interno.*
