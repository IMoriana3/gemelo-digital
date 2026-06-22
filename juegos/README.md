# 🎮 Arena Solar — juegos internos (Factiun)

Plataforma de **juegos web** para formación, team building y ferias (Intersolar),
construida sobre el **Gemelo Digital** y datos de planta reales del SCADA.

> Sin build, sin dependencias que instalar: HTML + JavaScript *vanilla* + Three.js
> (CDN). Se publica tal cual en GitHub Pages.

---

## 🕹️ Juegos

| Juego | Archivo | Qué es |
|------|---------|--------|
| ☀ **Solar Tycoon** | `tycoon.html` | Simulador de operación de **temporada** sobre una planta REAL (El Burgo, 219 seguidores). Mercado eléctrico, clima, contratos, cuadrillas (desplazamiento + repuestos + preventivo) y economía entre días. |
| 🧠 **Trivial Solar** | `trivial.html` | Concurso por equipos (estilo Kahoot) con banco de preguntas FV/PRL/O&M y *hook* para SolarGPT. |
| 🧩 **Ensambla el Tracker** | `montaje.html` | Montaje 3D del seguidor en el orden real (las cajas van con los módulos). |
| 🔍 **Caza-fallos** | `cazafallos.html` | Dado un síntoma, toca el componente averiado. |
| 📱 **Tracker en AR** | `trackerar.html` | Render completo del gemelo + Realidad Aumentada (WebXR). |
| 🛠️ **Mantenimiento AR** | `mantenimiento.html` | Guía de O&M sobre el CAD real de la TCU (`tcu.glb`) + AR. |
| 🔓 **Escape Room Solar** | `escape.html` | Acertijos técnicos encadenados; reúne el código y escapa. |
| 🏠 **Arena (lobby)** | `index.html` | Portada que enlaza todos los juegos. |

### Módulos compartidos
- **`escena.js`** — Motor de render reutilizable que **porta la escena del Gemelo**
  (`../index.html`): seguidor `detail:'full'` (módulos, correas+abarcones, slew,
  motor, TCU, cable de motor y dampers que se reorientan al bascular), césped
  procedural, **sol real con sombras que se alargan** y **cielo dinámico** por
  elevación solar (un día en bucle). Lo usan Caza-fallos, Ensambla y Tracker AR.
- **`plantas.js`** — Layouts REALES (El Burgo / Páramo) extraídos de `scada/index.html`
  (coordenadas relativas de cada seguidor + NCU). Lo usa el Tycoon.
- **`../seguidor.js`** — FUENTE ÚNICA del seguidor (cotas + piezas + materiales),
  compartida con el Gemelo y Cobertura. **No se duplica.**

---

## ▶️ Ejecutar en local

Es estático; basta con servirlo por HTTP (no `file://`, por las texturas/CORS):

```bash
cd gemelo-digital
python3 -m http.server 8080
# abre http://localhost:8080/juegos/
```

## 🚀 Publicar (GitHub Pages)

`Settings → Pages → Deploy from a branch → main / (root)`. Queda en:

```
https://imoriana3.github.io/gemelo-digital/juegos/
```

> **La Realidad Aumentada de cámara requiere HTTPS.** En `file://` o `http://` la
> RA no arranca (sí el visor 3D). Publicado en Pages funciona en **Android/Chrome**
> (WebXR / Scene Viewer). En iPhone, el AR pleno necesitaría un `.usdz`; sin él,
> iOS muestra el modelo en 3D.

## 📦 Versión de un solo archivo (para repartir / kiosko)

Cada juego puede empaquetarse en un **HTML autónomo** incrustando sus scripts
locales (Three.js y model-viewer siguen viniendo de CDN). Script de referencia:

```js
// node bundle.js  (inlina <script src="..."> locales; deja los https)
const fs=require('fs'),path=require('path');
function bundle(htmlRel,out){
  const p=path.resolve(htmlRel),dir=path.dirname(p);
  let h=fs.readFileSync(p,'utf8').replace(/<script src="([^"]+)"[^>]*><\/script>/g,(m,src)=>
    /^https?:/.test(src)?m:'<script>\n'+fs.readFileSync(path.resolve(dir,src.split('?')[0]),'utf8')+'\n</scr'+'ipt>');
  fs.writeFileSync(out,h);
}
bundle('juegos/tycoon.html','solar-tycoon.html');
```

---

## 🔧 Cómo extender cada juego

- **Trivial** (`trivial.js`): añade preguntas al array `BANK` (`{cat,q,a:[4],c,exp}`).
  Para generación automática, define `SOLARGPT_URL` (POST `{n,cats}` → `[{q,a,c,cat,exp}]`);
  si falla, usa el banco local.
- **Tycoon** (`tycoon.js` + `plantas.js`): los layouts salen de `plantas.js`. Para
  añadir una planta, exporta sus seguidores desde el SCADA con el mismo formato
  (`{name,w,h,ncus,count,trackers:[{x,y,ncu,name}]}`). Parámetros de juego (PNOM,
  precio, dificultad, averías) están al principio de `tycoon.js`.
- **Ensambla / Caza-fallos**: el render y la física vienen de `escena.js`; los pasos
  de montaje (`STEPS`/`STEP_OF`) y los puntos de inspección (`HOTSPOTS`) están al
  principio de cada `.js`.
- **AR**: `trackerar.js` usa WebXR (`immersive-ar` + hit-test). `mantenimiento.html`
  usa `<model-viewer>` con `tcu.glb` (servido por jsDelivr) y `ar-modes`. Para AR en
  iOS habría que añadir un `.usdz` (`ios-src`).

## 🌐 Dependencias (CDN)
- Three.js **r128** — cdnjs
- `@google/model-viewer` 3.5 — unpkg (solo Mantenimiento AR)
- Fuentes IBM Plex Sans/Mono + Space Grotesk — Google Fonts
- `tcu.glb` — jsDelivr (`gh/IMoriana3/gemelo-digital@main/tcu.glb`)

---

Hecho con el Gemelo Digital · Factiun.
