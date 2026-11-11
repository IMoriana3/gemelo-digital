# Abanderamientos reales, medidos en los logs de las NCU

`abanderamientos_reales.py` lee los logs diarios de las NCU y mide lo que pasa en un
abanderamiento de verdad: cuánto tarda la orden en llegar a cada TCU, cuánto tarda el eje
en llegar a la bandera, hacia qué lado va, qué energía de motor gasta, con cuánta batería
empieza y qué viento hay mientras va de camino.

## Aquí vive el método, no el dato

Los logs son **privados** y están en otro repositorio (`elburgo-logs-ncu`, un zip por NCU y
día). Este programa sólo los lee. Lo que escribe —una fila por maniobra, con TCU y hora—
es dato de planta y **no se versiona**: la salida va fuera del repositorio o a
`salida_logs_ncu/`, que está ignorada, y el propio programa se niega a escribir en otra
carpeta de este repositorio.

Las cifras que sí se publican son **agregados** (medianas y percentiles con su `n`) y van
siempre etiquetadas con planta, fuente y periodo:
`Medido · El Burgo I · logs de NCU · 26/05–04/10/2026`. En `bateria.html` viven en
`MEDIDO_EL_BURGO`, y `tools/prueba_bateria.mjs` exige que ninguna salga sin su etiqueta.

## Cómo se corre

No hace falta terminal propio: se corre en una sesión de Claude Code con el repositorio de
logs adjunto.

    python3 tools/logs_ncu/abanderamientos_reales.py --logs ../elburgo-logs-ncu --salida /tmp/abanderamientos
    python3 tools/logs_ncu/abanderamientos_reales.py --autoprueba

Necesita `pandas` y `numpy`. Tarda unos 25 s sobre 264 zips. Deja `maniobras.csv`,
`cobertura.csv` y `resumen.json`; lo que se cita sale de `resumen.json`.

`--autoprueba` fabrica un día con tres TCU y una alarma cuya respuesta se sabe antes de
correr —230 s de una, 510 s de la que cruza el plano, 200 J/°— y comprueba que el programa
la cuenta. No está en la puerta de CI: allí no hay `pandas` ni logs.

## Qué mide y cómo

| Cifra | De dónde sale |
|---|---|
| De la alarma a la petición | `Wind alarm for HSU n changed. Enabled: true` → `Requesting safe position…` del registro de eventos de la NCU |
| La TCU tiene la orden | primera fila del log de la TCU con `active_security_position` > 0 |
| Cobertura a 30, 60, 120 y 300 s | por cada alarma y cada TCU que no estuviera ya abanderada, su posición segura en la última fila anterior a ese instante |
| Llega a la bandera | primera fila a ±1° del objetivo que tuvo durante la bandera |
| Energía de la maniobra | incremento de `daily_motor_power_consumption`, que cuenta en **julios** (integrando tensión × corriente del motor sale 1,01 veces el contador) |
| Lado | signo del objetivo frente al signo del ángulo de partida, cuando parte a más de 8° del plano |
| Viento en tránsito | máximo de las HSU entre la orden y la llegada |

## Lo que no mide

- El tramo de anemómetro a alarma: el registro de eventos empieza en la alarma.
- Nada por debajo del muestreo del log de la TCU, una fila cada 12 a 21 s. «La TCU tiene la
  orden a los N s» es una cota superior.
- La fuerza. Dice si el eje llegó y qué gastó; no dice si el motor iba sobrado ni si la
  estructura aguanta.
- Lo que no ha ocurrido. En los logs de El Burgo I ninguna TCU abanderó con menos del 32 %
  de SOC ni hubo viento por encima de 21 m/s: de esos dos casos no hay medida.
- Otra planta u otro control. Es El Burgo I, con el control de Sunner, en verano.
