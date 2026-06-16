# Gemelo Digital TCU — Seguidor Factiun
### Gemelo digital 3D del conjunto seguidor + TCU de Factiun, con física de seguimiento y simulación energética en el navegador

Réplica fiel, en 3D y en el navegador, de un seguidor solar **1V bífila** real de Factiun y de su TCU (caja **SUNNER**), con seguimiento solar astronómico, *backtracking* y dinámica energética de la batería LiFePO4. Es el banco de pruebas del control predictivo con restricción energética desarrollado en el TFM.

> TODO: enlazar el repositorio y, si se publica, la URL de visualización.

## Qué hace

- Representa en 3D, físicamente fiel, un seguidor 1V bífila real de Factiun y su TCU (caja SUNNER).
- Simula en tiempo real el seguimiento solar astronómico con *backtracking* y la dinámica del TCU autoalimentado (panel auxiliar + batería LiFePO4).
- Sirve de banco de pruebas para el control con restricción energética (línea del TFM): cuando la batería cae, el sistema prioriza la supervivencia operativa sobre el seguimiento óptimo.

## Archivos

| Archivo | Qué es |
|---|---|
| `dtwin-seguidor-tcu.html` | Gemelo principal: vista de planta (seguidor 1V bífila) + vista de detalle del TCU. |
| `dtwin-viewer.html` | Visor de campo (pendiente de replicar la geometría 1V bífila). |

> TODO: confirmar el conjunto completo de ficheros. Quedan tres HTML por consolidar: visor de campo, comparativa seguidor+TCU y flujo eléctrico.

## Cómo funciona (arquitectura)

**Hoy:** un único HTML con Three.js y dos viewports — *planta* (geometría del seguidor) y *detalle* (TCU SUNNER) — con la simulación corriendo en el propio navegador (`step()` por frame).

**Objetivo (integración con SolarGPT):**

```
  ┌───────────────────────┐   import    ┌────────────────────────────┐
  │ solargpt/tracking.py  │ ──────────► │ Notebook SolarGPT (~476 c.) │
  │ (algoritmo, 1 fuente)  │             └────────────────────────────┘
  └──────────┬────────────┘
             │ wrap
  ┌──────────┴────────────┐  HTTP /setpoints    ┌──────────────────┐
  │ FastAPI (SolarGPT      │ ◄──── polling ───── │ bt-service       │
  │  "caliente", ms/call)  │      (30–60 s)      │ escribe Modbus   │
  └────────────────────────┘                     │ reg. 40001 (set) │
                                                  └────────┬─────────┘
  ┌────────────────────────┐  WebSocket ~5 Hz             │ Modbus
  │ Física del gemelo       │ ───────────────────────────► gemelo  ó  NCU real
  │ (continua) → estado     │     visor: listener WS (sustituye a step())
  └────────────────────────┘
```

Claves: SolarGPT se carga una vez al arrancar y responde en milisegundos (no se reejecuta por *setpoint*); todo arranca junto con `docker compose up` en bucles paralelos autónomos; para pasar a campo basta cambiar la IP Modbus del gemelo por la de la NCU real — el contrato es idéntico.

> TODO: estado actual de la integración (qué piezas están ya implementadas y cuáles en diseño).

## Geometría modelada (1V bífila)

- **1V**: un módulo en vertical (retrato) por cuerda. Módulo real **2382 mm × 1134 mm**, huecos de 12 mm.
- **Dos filas** paralelas separadas **6 m** eje a eje, cada una con su tubo de torsión.
- Un único **eje de transmisión** central, perpendicular a ambas filas, las acciona a la vez.
- Cada fila se divide en ala norte + ala sur de **28 módulos** cada una → **4 strings** (2 por fila), con un hueco de **550 mm** en el punto de accionamiento central.
- **GCR = cuerda / pitch ≈ 0,397**.
- La caja TCU cuelga del grupo del tubo que gira (se mueve con la viga), en la cara lateral junto al eje de transmisión.

## Vista de detalle del TCU (SUNNER)

Reproduce la caja blanca real **SUNNER** de Factiun: cuerpo redondeado abovedado, tapa desmontable con tornillos y logo SUNNER, mando de seccionamiento rojo en la cara lateral, antena con base/conector, prensaestopas y nervios moldeados (no son aletas de disipador — la unidad real no lleva disipador).

- **Quitar tapa**: levanta la tapa, hace el cuerpo transparente y muestra el interior (batería, PCB, driver, MCU, cableado) con railes de corriente animados — ámbar para PV→batería (carga) y azul para batería→motor (descarga), solo cuando la tapa está abierta.

## Modelo de simulación

- **Posición solar astronómica**: ángulo horario, declinación, latitud 42,8° (Navarra).
- **Seguimiento** verdadero sobre eje N-S, con **backtracking** (Anderson-Mikofski / Lorenzo, GCR ≈ 0,397).
- **Controlador de carga LiFePO4** en tres estados: Bulk (CC) → Absorción (CV) → Flotación.
- **SoC por conteo de culombios**.
- **Modo de conservación con restricción energética** por debajo de SoC 18%: el control deja de seguir el sol "a ciegas" y prioriza la supervivencia del equipo (núcleo del TFM).
- Chip **"Modo carga"** con el estado de carga en vivo.

## Controles

- **Quitar tapa** — abre/cierra el TCU y revela el interior y los flujos de corriente.
- **Parar / Reanudar** — *flag* `hold`: congela el seguidor en su ángulo actual.
- Chip **Modo carga** — lectura del estado del controlador (Bulk / Absorción / Flotación / Conservación).

## Requisitos

- Navegador moderno con WebGL (Three.js).

> TODO: indicar si Three.js va incrustado en el HTML o se carga por CDN (afecta al uso sin conexión).

## Uso

Abrir `dtwin-seguidor-tcu.html` en el navegador. La simulación arranca sola; usa los controles para inspeccionar el TCU y pausar el seguimiento.

> TODO: si lleva CDN, servirlo por HTTP o tener conexión.

## Pendientes / mejoras

- Replicar la geometría 1V bífila en el visor de campo `dtwin-viewer.html`.
- Consolidar los tres HTML (visor de campo, comparativa seguidor+TCU, flujo eléctrico) en una sola pestaña.
- Cerrar la integración con SolarGPT (FastAPI + WebSocket + Docker) según la arquitectura de arriba.

## Notas técnicas

- Three.js; el cuerpo del TCU se modela con ExtrudeGeometry y bisel; la caja se ancla como hijo del grupo del tubo giratorio para moverse con la viga.
- *Backtracking* con GCR ≈ 0,397 (cuerda/pitch); latitud 42,8°.
- En campo, el contrato Modbus es idéntico al del gemelo: basta apuntar al registro 40001 de la NCU real.
