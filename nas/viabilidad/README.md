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

Para el mapa mundial, primero una rejilla terrestre *exploratoria* de 5°:
  node nas/viabilidad/seed.mjs --grid 5 --download-land --limit 20 --period 30
  node nas/viabilidad/seed.mjs --grid 5 --limit 20 --period 30 --enqueue

La máscara se obtiene explícitamente de Natural Earth 110m, dominio público.
La cuadrícula no abarca cada isla pequeña y sus puntos no son polígonos
certificados. Posteriormente refinar zonas prioritarias con --grid 2 o
--grid 1 y --bounds latMin,lonMin,latMax,lonMax. Lotes de más de 200
trabajos requieren --confirm-large. No se pone en marcha el mundo entero
automáticamente.

Perfiles por defecto: SP 6Ah, STRING 6Ah, versiones LT y Track N Co 6Ah.
Dentro de cada perfil se calculan sus propias estrategias sobre la misma
meteorología. Cambiar de perfil no sobrescribe otros resultados.

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
