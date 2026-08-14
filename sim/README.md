# Simulador de planta TCU — el gemelo total

> Una planta entera de seguidores Factiun simulada equipo a equipo —NCU, TCUs, HSUs y repetidores—, con la jerarquía de control real y **el mapa Modbus de los tres dispositivos actualizándose en vivo**.

Se abre en `../simulador.html`. No necesita servidor ni red: es HTML y dos ficheros JS.

## Por qué

El gemelo de `index.html` ya tenía seguimiento solar y los modos manual/auto de un seguidor. Lo que faltaba para que sirviera de banco de pruebas es todo lo demás: **la planta**. Un TCU no decide solo — le llegan el viento de una HSU que no es la suya, un interruptor de limpieza del armario de la NCU, un forzado por Modbus a su grupo, una seta que inhibe el motor entero. Y esas decisiones se ven, desde fuera, como registros Modbus concretos.

Aquí están las dos cosas a la vez: el comportamiento y su reflejo en el mapa.

## Jerarquía de control

De más a menos prioritaria. La regla que gana es la que fija el ángulo objetivo; la vista **Detalle del equipo** la pinta en verde y en ámbar las que están activas pero pierden.

| # | Regla | Qué la dispara | Dónde se ve |
|---|---|---|---|
| 0 | **Seta de emergencia** | pulsador local o seta del armario de la NCU | 30002.4 · NCU 30100.13 · motor inhibido |
| 1 | **SP1 viento** | nivel de viento de cualquier HSU o `force_sp_1` al grupo | 30001 bits 15:13 = 1 |
| 2 | **SP3 nieve** | alarma de nieve o `force_sp_3` | 30001 bits 15:13 = 3 |
| 3 | **SP4 limpieza** | interruptor de limpieza del grupo (NCU 30100 bits 12:3) o `force_sp_4` | 30001 bits 15:13 = 4 |
| 4 | **SP2/5/6/7** | forzados genéricos de la NCU (40002, 40005–40007) | 30001 bits 15:13 |
| 5 | **Restricción de batería** | SoC bajo L3 → defensa; bajo L2 → congela; bajo L1 → lazo grueso (*winter mode*) | 30001 bits 2:1 · 30002 bits 13/12/11 |
| 6 | **Manual** | modo 1, consigna del operador | 30001 bits 9:8 = 1 |
| 7 | **Auto** | seguimiento solar con backtracking; de noche, posición nocturna | 30001 bits 9:8 = 2, bit 0 = backtracking |

El viento manda sobre manual, que es como se comporta el equipo real. El abanderamiento sigue la estrategia canónica **B2**: parcial a partir de 40 km/h (±30° mínimo, cara al sol), total a partir de 60 km/h (±55°), y **30 minutos de histéresis** antes de desabanderar.

## Alimentación y gestión de batería

Es **el mismo modelo que `bateria.html`**, no una versión reducida: mismas constantes, mismas curvas y misma estrategia, aplicados a cada TCU de la planta a la vez y en tiempo continuo en vez de a un equipo hora a hora.

### De qué come el TCU

El mismo seguidor se comporta de forma muy distinta según su alimentación, y el mapa lo declara (30000, campo *TCU type*):

| Tipo | Qué es | Lo que cambia |
|---|---|---|
| **SP** (*self-powered*) | panel auxiliar propio de 45 o 60 W sobre el seguidor | lo que entra depende del **ángulo real**: abanderar o quedarse parado también cuesta carga. Es el caso duro |
| **STRING** | del propio string FV por regulador de 60 W | con sol satura en su tope; la carga la limitan la temperatura y el C-rate, no el panel |
| **AC** | de alterna | la batería flota en el techo y solo trabaja si se corta la red. Sin batería, un corte tumba el TCU |

### Estrategia oficial SUNNER

| Parámetro | Por defecto | Qué hace |
|---|---|---|
| **SOC objetivo** (techo) | 80 % | con la estrategia activa la batería **no sube de ahí**: por encima del techo no entra carga, aunque sobre sol. Es lo que evita tenerla siempre al 100 % envejeciendo |
| **Carga completa** | cada 5 días | uno de cada N días el techo sube al 100 %, para reequilibrar |
| **SOC crítico** | 30 % | por debajo, el seguidor va a **defensa 55°** y cuenta como **no disponible**. Rearma al superar el crítico **+2 %**, que es lo que evita el baile de entrar y salir al rozar el umbral |
| **Winter mode** | off | el seguidor va al mismo sitio pero con paso tan grueso que consume como si corrigiera **3 °/h en vez de 10** — un 70 % menos de motor |
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
| `prueba.mjs` | prueba de humo: 72 comprobaciones sobre un día de planta |
| `../simulador.html` | la interfaz |
| `../tools/extrae_mapa.mjs` | regenera `modbus-map.js` desde la ficha de `cobertura-zigbee` |

```bash
node sim/prueba.mjs          # física + codificación de registros
node tools/extrae_mapa.mjs   # si cambia la ficha del mapa
```

La prueba decodifica **al revés** que el motor —como lo haría el colector del SCADA, no como lo escribió quien lo codificó—, así que un cambio de orden de palabra o de escala se cae en el sitio.

## De dónde salen los números

- **Mapa y bits:** ficha `cobertura-zigbee/modbus.html`, que transcribe `NCU_Modbus_Map_R7`, `SUNNER_TCU_ModbusMap_v6` (FW v1.4.3) y `HSU_Modbus_Map_R23`.
- **Escalas de los registros propios de la TCU:** las que usa la [TCU Toolbox](https://github.com/IMoriana3/scada/tree/main/tools/tcu-toolbox) contra equipo real — tilt ×10, ángulos solares ×100, temperaturas ×10, tensiones mV, corrientes mA, reloj en BCD.
- **Física, gestión de batería y umbrales:** los mismos que `bateria.html` (estudio de disponibilidad de batería de SUNNER + física canónica de SolarGPT 00.2t + 11.5b): consumo de electrónica 0,64 W, motor Wh/° = 0,0503 + 0,000845·|θ|, η de carga 0,90, C-rate seguro, JEITA, calefactor LT, giro a 0,17 °/s, deadband de 2,5°, GCR 0,397, tope ±55°. Las funciones `cRateSafeLFP`, `hotDerate`, `heaterW` y `poaAt` son las de allí, sin cambiar una coma.
- **Criterio de salud** (`ok` / `aviso` / `alarma` / `offline`): el del colector del SCADA y la toolbox.

## Lo que hay que saber antes de fiarse

- **No habla Modbus por la red.** Genera la *imagen* de registros que el equipo serviría. Para ejercitar el transporte de verdad (troceado a 110 registros, orden de palabra, direccionamiento) está `scada/tools/ncu_simulada.py`, que es un esclavo Modbus TCP real.
- **Dos registros llevan codificación inventada.** 30113 (criterio del ángulo objetivo) y 30114 (fuente de la posición segura) los nombra el documento pero no transcribe su enumerado; lo mismo con los valores del campo *TCU type* de 30000. Lo que sale ahí es del simulador, y el visor lo pinta en violeta para que no se confunda con lo documentado.
- **Las filas atenuadas del visor no están simuladas.** Se listan igual para que el mapa esté entero: es preferible un hueco visible a un cero que parece un dato.
- **No es un modelo bancable de producción.** Es un banco de pruebas de control y de lectura de mapas, no un PVsyst.
- Un **repetidor** es una TCU fija: misma electrónica, batería y firmware, sin seguidor que mover. No cuenta como seguidor en los porcentajes de flota, igual que en el SCADA.

*Factiun · proyecto interno.*
