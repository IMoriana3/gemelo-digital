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
- **Simulador de gestión de batería (`bateria.html`):** balance energético del TCU hora a hora sobre meteo real (previsión Open-Meteo 3–16 días) o sintética. Modelo canónico de SolarGPT (celdas 00.2t + 11.5b): consumos medidos (idle/sleep 0,64 W; motor Wh/° = 0,0503 + 0,000845·|θ|, pico 50 W), carga solar ∝ GHI limitada por C-rate seguro LiFePO₄ según temperatura, perfiles reales de TCU (SP/STRING, 3/6 Ah, 45/60 W). Gestión de energía: winter mode (correcciones gruesas 3°/h) y control con restricción energética del TFM (SOC crítico → aparcar y sobrevivir, rearme con histéresis), con comparativa «sin gestión vs con gestión», análisis de ciclos LFP (EFC, DoD, vida a 80 % SOH) y gráficas SOC/balance/meteo/posición.

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
