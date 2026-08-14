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

El viento manda sobre manual, que es como se comporta el equipo real. El abanderamiento sigue la estrategia canónica **B2**: parcial a partir de 40 km/h (±30° mínimo, cara al sol), total a partir de 60 km/h (±55°), y **una hora de histéresis** antes de desabanderar — el `DESTOW_HOLD_H` canónico, que tampoco se escribe aquí.

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

Lo que hace que valga la pena no es copiar sin manos: es que **contrasta lo que aparece en más de una fuente y se niega a generar si divergen** (K0, K1, pico de motor, idle, tensión nominal, capacidad). Que es exactamente el bug que cuenta la cabecera de `tfm_constants.py`: `cap_Wh` copiado en cuatro scripts y arreglado solo en uno.

```bash
node tools/extrae_fisica.mjs   # tras tocar la gestión de batería en SolarGPT
```

Conectarlo ya encontró dos divergencias con lo que había aquí escrito a mano: el **winter mode** no era solo mover menos (sube el techo a 90 % y calibra cada 3 días), y el perfil de **alterna canónico va sin batería** (`AC_grid`, 0 Ah).

### De qué come el TCU

El mismo seguidor se comporta de forma muy distinta según su alimentación, y el mapa lo declara (30000, campo *TCU type*):

| Tipo | Qué es | Lo que cambia |
|---|---|---|
| **SELF / SP** | panel auxiliar propio de 45 o 60 W, montado en el seguidor | lo que entra depende del **ángulo real**: abanderar o quedarse parado también cuesta carga. Es el caso duro |
| **STRING** | del propio string de la planta, a **1500 V** de continua, por un convertidor de 60 W | con sol hay potencia de sobra: el convertidor satura en su tope y quien limita la carga pasa a ser la temperatura y el C-rate, no la fuente |
| **AC** | de alterna (`AC_grid`) | en el canon va **sin batería**: mientras haya red va servido, y un corte tumba el TCU entero |

Y no cambia solo de dónde viene la corriente: cambia **qué tiene sentido mirar**. `tcu.py` trae una regla marcada como *auditada* que el simulador lee y respeta (`ui_visibility_for_source`):

| Alimentación | Panel | Batería | SoC | Calibración |
|---|---|---|---|---|
| SELF / SP | sí | sí | sí | sí |
| STRING | **no** | sí | sí | sí |
| AC | **no** | **no** | **no** | **no** |

Por eso, con un perfil de alterna, la interfaz deja de enseñar SoC y batería: no es que valgan cero, es que no hay batería que gestionar.

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
| `prueba.mjs` | prueba de humo: 111 comprobaciones sobre un día de planta |
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

## Lo que hay que saber antes de fiarse

- **No habla Modbus por la red.** Genera la *imagen* de registros que el equipo serviría. Para ejercitar el transporte de verdad (troceado a 110 registros, orden de palabra, direccionamiento) está `scada/tools/ncu_simulada.py`, que es un esclavo Modbus TCP real.
- **Dos registros llevan codificación inventada.** 30113 (criterio del ángulo objetivo) y 30114 (fuente de la posición segura) los nombra el documento pero no transcribe su enumerado; lo mismo con los valores del campo *TCU type* de 30000. Lo que sale ahí es del simulador, y el visor lo pinta en violeta para que no se confunda con lo documentado.
- **Las filas atenuadas del visor no están simuladas.** Se listan igual para que el mapa esté entero: es preferible un hueco visible a un cero que parece un dato.
- **No es un modelo bancable de producción.** Es un banco de pruebas de control y de lectura de mapas, no un PVsyst.
- Un **repetidor** es una TCU fija: misma electrónica, batería y firmware, sin seguidor que mover. No cuenta como seguidor en los porcentajes de flota, igual que en el SCADA.

*Factiun · proyecto interno.*
