# Gemelo Digital TCU — Seguidor + TCU

> Visor 3D en navegador de un seguidor solar de 1 eje (bífila) y su unidad de control TCU SUNNER, con estado en vivo (SCADA) o simulado.

## Qué es

Gemelo digital / HMI que representa en una vista partida un **seguidor solar de un eje N-S** (CAMPO, modelado en Three.js) y su **TCU** (Tracker Control Unit, CAD real `tcu.glb`) con conectores etiquetados, placa interna y LEDs/cables que se iluminan con la corriente.

Si hay un endpoint SCADA disponible pinta el ángulo, consigna, SoC y estado **medidos**; si no, corre un **modelo solar local** (backtracking Anderson-Mikofski, viento, batería) como respaldo. Es una herramienta de **visualización**, no un motor de cálculo bancable.

## Funcionalidades

- **Vista CAMPO:** seguidor bífila desalineada sobre terreno, sol/cielo dinámicos, sombras reales entre filas (PCFSoft), viento + brújula y meteorología (lluvia/nieve).
- **Vista TCU:** CAD glTF/GLB real con conectores etiquetados (PV+/PV-, motor A/B, RS485, antena, portafusibles, seta, válvula); fallback automático del GLB vía jsDelivr y, en último caso, modelo aproximado.
- **Estado en vivo:** consume `GET {SCADA_URL}/live` (CORS abierto) y filtra por `ncu/tcu`; si no hay conexión usa el simulador local.
- **Modelo solar local:** posición solar (Gorraiz, lat 42,81°N, lon −1,58°), hora civil→solar (DST + ecuación del tiempo), true-tracking + backtracking, tope ±55°, slew 0,17°/s, batería/carga y lógica de viento.
- **Simulador de planta — gemelo total (`simulador.html`):** la planta entera equipo a equipo (**NCU + TCUs + HSUs + repetidores**) con la **jerarquía de control real** —seta > SP1 viento > SP3 nieve > SP4 limpieza > forzados > restricción de batería > manual > auto— y el **mapa Modbus de los tres dispositivos en vivo**: cada registro con su valor crudo, decodificado y sus bits activos, actualizándose paso a paso, con destello en lo que cambia y export a CSV. El mapa es el canónico (NCU R7 · TCU v6 · HSU R23), generado de la ficha de `cobertura-zigbee` por `tools/extrae_mapa.mjs` — 515 direcciones, sin copiar ninguna a mano. El **algoritmo y la gestión de batería no se copian: se llaman**. Con el motor local de SolarGPT levantado (`SolarGPTfull/server`), `POST /tracker` da la trayectoria del día —backtracking y política de cielo cubierto dentro— y `POST /tcu` el balance de batería sobre los ángulos que el gemelo ha ejecutado. Sin motor la página abre igual, pero lo dice: el indicador pasa a «navegador» y avisa de que eso es un modelo de primer orden. Las constantes tampoco se copian. `tools/extrae_fisica.mjs` genera `sim/fisica.js` desde `SolarGPT/solargpt_core/tcu.py` (los 8 perfiles de hardware, el motor medido y las políticas de verano/invierno), `tfm_constants.py` y el bloque canónico de `bateria.html` (C-rate seguro LiFePO₄, JEITA, calefactor LT, transposición isotrópica) — y **se niega a generar si las tres fuentes no dicen lo mismo**. Así, lo que se toque allí llega aquí con un comando. Sobre eso corre la estrategia oficial SUNNER equipo por equipo: techo de SOC objetivo, carga completa periódica, defensa por SOC crítico con rearme +2 % y su contador de no disponibilidad, y el winter mode canónico (techo 90 %, calibración cada 3 días y consumo de motor a 3 °/h). Todos los parámetros se tocan en caliente. Las **entradas físicas** están modeladas con su naturaleza: el **inclinómetro es analógico** —el lazo se cierra sobre lo que MIDE el TCU, con su desajuste de montaje, su offset de 41058, su deriva y su cuantización a 34,7 pulsos/°, así que se puede simular el TCU que publica 0° con la mesa a 3° y el SCADA en verde—, y la **seta es binaria**: línea normalmente cerrada con antirrebote y **enclavada** (soltarla no rearma; hace falta 40007.13), que corta el puente en H mientras el algoritmo sigue calculando por debajo. El eje calado y el eje duro son averías físicas que el firmware **deduce** por sobrecorriente o por reintentos, no banderas que se declaren. Y el criterio de salud es el del SCADA. Motor sin DOM en `sim/planta.js`, con prueba de humo: `node sim/prueba.mjs`. Detalle en [`sim/README.md`](sim/README.md).
- **Simulador de gestión de batería (`bateria.html`):** balance energético del TCU hora a hora durante **todo el año**, con la metodología del Battery Availability Study de SUNNER. Meteo: año histórico completo de Open-Meteo, previsión 3–16 días, **CSV horario de PVSyst** (usa GlobEff/POA real, T_Amb, DiffHor y el ángulo real del tracker PhiAng; el fichero no sale del navegador) o sintética hasta 365 días. Física canónica de SolarGPT (00.2t + 11.5b): consumos medidos (electrónica 0,64 W; motor Wh/° = 0,0503 + 0,000845·|θ|) o consumo SUNNER en mA medio (2500/3250/4000 @25,6 V), carga limitada por Tª mínima y C-rate seguro LiFePO₄. Estrategia SOC oficial (objetivo 80 % / crítico 30 % → defensa 55° / carga completa cada 5 días) + winter mode canónico (90 %/3 días). Perfiles con variantes **LT calefactadas** (P = 1 + 0,15·|T| W bajo 0 °C, desbloquea la carga) y JEITA en el lado caliente (reduce a 35 °C, bloquea a 45 °C). **Abanderamientos por viento** (estrategia B2: parcial ≥40 km/h, full ≥60 km/h, histéresis) con su consumo de motor y su banda en las gráficas. Emplazamientos preset = plantas Factiun con su nº de proyecto (coords reales de los layouts). Fuente de carga según el tipo de TCU: en los **SP** el panel dedicado va **solidario al seguidor** (ve el plano del generador, y su captación cae cuando el seguidor está en defensa o abanderado), mientras que los **String** toman su potencia nominal de un string de varios kW y disponen de ella desde muy poca luz — esa diferencia es la que explica que los modelos String salgan mucho mejor. Métricas de impacto del estudio: **% tiempo no disponible** y **% producción perdida** (POA defensa vs seguimiento), rainflow counting (ciclos ≥30 %/≥60 % DoD), balance mensual, y vida a 80 % SOH con el envejecimiento desglosado en ciclado (Nf = 6000/DoD^1,2) y calendario integrado paso a paso con el SOC y la temperatura de celda (Arrhenius × factor de SOC del BatteryModel v2 canónico), más la comparativa con/sin estrategia. Incluye una **comparativa entre sistemas de control** (sin gestión, SUNNER estándar, winter mode, restricción energética del TFM y conservador) sobre la misma meteo, con la producción relativa al seguimiento ideal para que el ahorro de un modo no oculte lo que cuesta en producción, y un **generador de informe** imprimible en A4 con la estructura del Battery Availability Study (objeto y conclusión, procedimiento, emplazamiento, meteorología, especificación de batería y motor, estrategia SOC, métricas de impacto, resultados año a año con media y percentil 97,5 %, comparativa de controles, ciclado e hipótesis).

## Uso

Barra inferior de la vista de campo:

| Control | Función |
|---|---|
| **Día** (1–365) / **Hora local** (0–24) | Recorrido solar; la hora civil se convierte a solar (CET/CEST). |
| **Nubes** (0–100 %) | Agrisa el cielo y atenúa el sol. |
| **Viento** (0–120 km/h) + **brújula** | Velocidad y dirección; mueve la flecha de viento 3D. |
| **Modo Auto/Manual** + **Este / Oeste** | Auto sigue al sol; Manual mueve a −55° / +55°. |
| **BT on/off** | Backtracking on (evita sombras) u off (true-tracking). |
| **Tiempo** | Cicla despejado → lluvia → nieve. |
| **Etiquetas** / **Quitar envolvente** | Muestra etiquetas flotantes / abre la carcasa de la TCU. |

Ambas escenas se orbitan y hacen zoom con ratón/touch. Overrides por URL: `?scada=`, `?ncu=&tcu=`, `?tcu=<ruta-GLB>`.

## Stack

- **Three.js r128** (global `THREE` por CDN cdnjs) + **GLTFLoader** (jsDelivr).
- Un único **HTML autocontenido** (`index.html`): dos escenas WebGL independientes que comparten estado `s`/`cur`.
- Tipografías IBM Plex Sans / Mono + Space Grotesk; tema oscuro estándar Factiun.
- Assets: `tcu.glb` (CAD ~4,3 MB), `pcb.jpg` (textura de la PCB).

## Despliegue

GitHub Pages: `Settings → Pages → Deploy from a branch → main / (root)`. Como el visor se llama `index.html`, la URL es:

**https://imoriana3.github.io/gemelo-digital/**

Local: sirve la carpeta por HTTP (`python3 -m http.server 8080`) y abre `http://localhost:8080/` (no `file://`). Requiere WebGL e internet para los CDN.

## Notas

- `CDN_GLB` apunta a `IMoriana3/gemelo-digital@main/tcu.glb`; si renombras el repo, edita esa línea de `index.html`.
- La meteorología es **visual**: la nieve acumulada no penaliza la producción FV.
- **Un solo seguidor** por instancia (multi-seguidor: filtrar `/live` por `ncu/tcu`).
- Procedencia: extraído de `IMoriana3/SolarGPTfull` (carpeta `viewers/`). `docs/` contiene la integración con el Panel de Proyectos.

*Factiun · proyecto interno.*
