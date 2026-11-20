# FACTIUN · mapa mundial de viabilidad TCU · NAS Synology

**Estado: preparado en código, no desplegado ni ejecutado en el NAS.**

El NAS DS923+ ejecutará un solo trabajo a la vez dentro de Container Manager,
sin GitHub Actions para cálculos. Chromium abre el simulador **bateria.html** y
usa sus funciones simulate/simulaSeguido/controlesPara/summarize.
No hay otro motor de batería. Una cola en /data guarda el estado al reiniciar.

## Instalación (sin fusionar PR)

1. Clonar la rama del PR en una carpeta aislada del NAS, por ejemplo
   /volume1/docker/factiun-mapa-tcu/app, y crear otra ruta persistente
   /volume1/docker/factiun-mapa-tcu/data. No se mezclan con FamiliaOS,
   Home Assistant ni /volume1/docker/github-runner.
2. Copiar nas/viabilidad/.env.example a un .env del proyecto (NO a Git).
3. Construir el proyecto en Synology Container Manager a partir de
   nas/viabilidad/compose.yaml, con el contexto en la raíz del repositorio.
   Por defecto el puerto 8787 se publica solo en loopback.
4. Consultar http://127.0.0.1:8787/api/mapa/health desde el NAS.
   La web está en http://127.0.0.1:8787/bateria.html.
   Para abrirla desde otro equipo, usar acceso privado LAN/Tailscale,
   firewall y autenticación; NO publicar un puerto directo en Internet.

**IMPORTANTE — licencia:** la API gratuita de Open-Meteo es exclusivamente
no comercial. Factiun debe utilizar una suscripción con permiso de uso
comercial y configurar OPEN_METEO_API_KEY para la API histórica customer-.
Sin clave, el servicio muestra estado pero **no ejecuta la cola**. No
se generan series sintéticas para rellenar datos ausentes.

## Encolar plantas y regiones

Desde terminal del proyecto:
  docker compose -f nas/viabilidad/compose.yaml exec viabilidad-tcu node nas/viabilidad/seed.mjs --cartera --limit 5 --period 30

Este comando solo presenta una VISTA PREVIA. Para ejecutar:
  docker compose -f nas/viabilidad/compose.yaml exec viabilidad-tcu node nas/viabilidad/seed.mjs --cartera --limit 5 --period 30 --enqueue

## Cobertura GLOBAL terrestre: todas las celdas, no una muestra de 20

El objetivo es un **mapamundi de referencia mundial**, no una colección
de cuatro plantas. La máscara [Natural Earth 1:10m](https://github.com/nvkelso/natural-earth-vector)
incluye costas e islas mucho menores que la cartografía antigua de 110m.
La cuadrícula se genera con un punto real **sobre tierra en cada celda
detectable**, con tres niveles sucesivos:

1. **5°**: primera pasada terrestre global, incluidos islotes cuando aparecen
   en Natural Earth 10m
2. **2°**: segunda pasada mundial más densa
3. **1°**: refinamiento mundial, no solo de las zonas prioritarias

Los puntos en la costa pueden estar desplazados dentro de su celda para
caer en tierra; las coordenadas geográficas de las plantas reales NO se
redondean ni se sustituyen por centros de celda. Las áreas oceánicas
siguen visibles en el mapa base, sin evaluación TCU.

Para obtener la distribución **completa** y el conteo de nodos, sin
consumir una sola consulta meteo ni calcular SOC:

```bash
node nas/viabilidad/seed.mjs --world all --period 30 --download-land
```

Para **registrar los tres manifiestos mundiales** en el NAS, después de
configurar la fuente meteorológica comercial y el almacenamiento:

```bash
node nas/viabilidad/seed.mjs --world all --period 30 --enqueue --confirm-world
```

Esto registra todos los nodos y sus configuraciones. NO crea cientos de
miles de ficheros pending ni consume meteorología por sí mismo. El servidor
alimenta una cola persistente de tamaño reducido (`WORLD_QUEUE_BUFFER`,
12 por defecto), procesa **un solo escenario cada vez** mediante
`bateria.html` y reanuda tras los reinicios. Termina una fase antes
de pasar a la siguiente. El cursor y los manifiestos permanecen en
`/data/world`. `--world` nunca admite `--limit`.

La vista `GET /api/mapa/world?step=5&bounds=-90,-180,90,180`
presenta el estado de los nodos por ventana geográfica. El zoom selecciona
5°, 2° o 1° y el API limita el volumen de respuesta para no saturar
Leaflet. **Gris** = sin evaluar; **en cola** y **calculando** se diferencian;
**azul** = hay cálculo pero la firma de escenario no coincide;
**verde, ámbar, rojo** solo son el veredicto de un nodo realmente simulado
con el mismo motor, parámetros, año y meteo. Nunca se pintan polígonos
de viabilidad extrapolada a partir de centros de celda.

**Límite técnico:** resolución de 1° no representa todas las variaciones
de relieve, microclima, panel cubierto de nieve o coste mecánico por viento.
La cobertura es *mundial en extensión*, pero **muestreada**, no una
certificación continua de cada metro cuadrado. El modelo del tiempo
ERA5/ERA5-Land tiene también su propia resolución. Las islas o
microparcels ausentes de Natural Earth 10m siguen sin evaluarse; esto
se declara, no se colorea como apto.

La cantidad exacta de trabajos se obtiene del resumen real generado por
`--world all`. Para 30 años, cada ubicación requiere dos solicitudes
históricas por año antes de aplicar caché; cinco equipos por punto pueden
compartir esa meteorología. No se ha calculado aún el mundo ni existe un
mapa mundial de aptitudes verificado.

Perfiles por defecto: SP 6Ah, STRING 6Ah, versiones LT y Track N Co 6Ah.
Dentro de cada perfil se calculan sus propias estrategias sobre la misma
meteorología. Cambiar de perfil no sobrescribe otros resultados.

## Lote de cuatro emplazamientos · 20/11/2026

La lista de Tordesillas (Valladolid), Chorzele (Mazowieckie),
San José–La Joya (Arequipa) y Dunedin (Otago) se mantiene **una sola vez**
en `nas/viabilidad/casos-tordesillas-chorzele-joya-dunedin.json`.
El NAS y el mapa web leen ese fichero. San José se resuelve a partir del
proyecto 24019 de la cartera canónica, sin copiar sus coordenadas.

Por seguridad, el servicio HTTP solo publica ese JSON dentro de
`nas/viabilidad`: el código del servidor, secretos y variables de entorno
no son descargables. Los tests HTTP verifican esa restricción.

Los otros tres puntos son **centros de población**, no coordenadas verificadas
de los proyectos. Sustituirlos por el punto exacto de implantación antes de
emitir un informe para cliente. El archivo conserva la procedencia y esta
limitación por separado.

Vista previa, sin descargar meteorología ni ejecutar el simulador:

```bash
node nas/viabilidad/seed.mjs \
  --sites nas/viabilidad/casos-tordesillas-chorzele-joya-dunedin.json \
  --period 30
```

Son cuatro ubicaciones × cinco configuraciones de partida = **20 trabajos**.
Cada ubicación requiere inicialmente 30 años horarios de dos fuentes
compatibles (ERA5 atmosférico + ERA5-Land terrestre): hasta **240
consultas al servicio histórico en total** sin caché (4 × 30 × 2), no
120 consultas por año. La caché reutiliza la misma meteorología entre
los cinco perfiles de cada emplazamiento.

Para calcularlos, una vez desplegado en NAS y configurada una licencia
meteorológica comercial autorizada:

```bash
node nas/viabilidad/seed.mjs \
  --sites nas/viabilidad/casos-tordesillas-chorzele-joya-dunedin.json \
  --period 30 --enqueue
```

NO se ha lanzado esta cola. No se publican SOC ni veredictos hasta obtener
los resultados horarios del propio simulador. Los resultados se consultan
por `/api/mapa/snapshot`, separando claramente equipos y estrategias.
Las pruebas CI validan el montaje y coordenadas, **no** la meteorología real.

## Periodos históricos: identidad y caducidad

La petición `--period 30` se resuelve en años completos del calendario
**UTC**. Por ejemplo, en 2026 significa 1996–2025; al pasar a 2027
significa 1997–2026. Ambos intervalos son trabajos **distintos**:
`normalizeJob` incluye `yearRange` en el identificador de cola.

Un trabajo pendiente que cruce el cambio de año sin ejecutarse se
rechaza como caducado y debe volverse a encolar. Los resultados anteriores
permanecen archivados en `/data/done`, pero se excluyen de
`/api/mapa/snapshot`, que solo sirve periodos vigentes. Esto no reinicia
el SOC el 1 de enero: los años continuos se siguen simulando juntos.

La vista previa del comando `seed.mjs` no cambia ficheros de la cola,
ni puede mover un trabajo de `running` a `pending`. La recuperación
de trabajos interrumpidos pertenece al arranque del servidor NAS.

## Persistencia, datos y visor

- /data/pending: trabajos pendientes.
- /data/running: trabajo actual; vuelve a pending tras reinicio.
- /data/done: registros terminados, con conclusiones y firma del motor.
- /data/failed: fallos después de 3 intentos.
- /data/meteo: caché de respuestas históricas, sin token de acceso.

La cola usa las coordenadas concretas de cada emplazamiento. La salida
GET /api/mapa/snapshot alimenta el mapa web servido por el NAS; el
visor nunca extrapola un color de una ubicación a otra.

Opcional: ENABLE_UI_QUEUE=1 y FACTIUN_MAPA_TOKEN con una clave larga permiten
encolar desde la página. Se necesita mismo origen y cabecera de autorización.
La clave solo vive en memoria del navegador durante la sesión, no se incluye
en archivos web ni se guarda en localStorage.

El cálculo del NAS requiere acceso saliente y puede consumir mucha RAM
para una serie seguida de 30 años; verificar la RAM del DS923+ antes de
aumentar la carga. La fuente meteorológica y el simulador pueden tener
limitaciones de resolución y de física: los veredictos NO son certificación
estructural. Verificar primero un caso real y compararlo con la ejecución
manual antes de ampliar la cobertura.

## Verificaciones
- Unitario (sin APIs): node tools/test_nas_viabilidad.mjs
- Integración real NAS/Playwright con licencia: pendiente.
- Sin fusionar ni desplegar automáticamente: requiere aprobación del propietario.
