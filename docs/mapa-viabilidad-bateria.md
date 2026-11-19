# Mapa mundial de viabilidad de TCU · simulador de batería Factiun

## Alcance

La pestaña **Mapa mundial de viabilidad** se abre desde bateria.html. No crea otro
simulador ni utiliza un modelo distinto: llama a simulate, simulaSeguido,
summarize, controlesPara, opcionesPara y fetchYearDeclarado que ya viven en
la página.

El mapa **no calcula por proximidad geográfica**. Los marcadores inicialmente
aparecen grises; solo se colorean para el perfil, estrategia, periodo y parámetros
que se han evaluado en ese punto exacto.

## Uso

1. Abrir bateria.html y pulsar **Mapa mundial de viabilidad**.
2. Seleccionar una planta de la cartera por nombre, buscar una ciudad mediante
   OpenStreetMap, introducir latitud/longitud (admite coma decimal) o pulsar el
   mapa y añadir las coordenadas.
3. Elegir modelo de TCU, panel, estrategia visible en el mapa y periodo.
4. Pulsar **Calcular conclusiones del punto**. Se calculan todas las estrategias
   disponibles para ese perfil con la **misma meteorología**; el selector de
   estrategia determina el color del marcador.
5. Abrir cualquier marcador para ver el resultado y las otras estrategias.

El selector de **30 años** (por defecto) solicita el histórico de los 30 años
completos anteriores al año actual. Los años se simulan de manera continua
dentro de cada tramo disponible, exactamente como en el simulador de batería.
También hay años individuales para exploraciones rápidas: nunca se presentan
como disponibilidad certificada.

Las nuevas ubicaciones y los **resúmenes de las evaluaciones**, no las series
meteorológicas, se almacenan en el navegador. Los resultados se invalidan para
cualquier cambio de perfil, panel, periodo, parámetros físicos o versión del motor
identificada por el mapa. No se crea un registro externo de autoridad.

## Criterios de visualización

- **Apto**: sin horas con batería agotada, sin episodios de reserva comprometida
  ni indisponibilidad por batería en el histórico completo, sin faltantes
  meteorológicos detectados y con una configuración de catálogo.
- **Condicionado**: sin agotamiento total, pero con episodios de reserva
  comprometida, indisponibilidad o estrategia sin protección por SOC.
- **No apto**: hay horas de batería agotada en un año observado; no queda
  garantizada la energía para maniobras de protección.
- **Sin evaluación completa**: ubicación no simulada, histórico insuficiente,
  datos de viento/nieve/temperatura/irradiancia incompletos, sólo un año histórico
  o un equipo de estudio/no documentado.

La ficha indica los periodos incompletos, los años no disponibles y si las
temperaturas alcanzadas quedan fuera de los límites declarados en el perfil.
Nunca se asigna un verde interpolando a partir de un marcador cercano.

## Meteorología

La vista consulta **Open-Meteo histórico por la latitud y longitud del punto**
a través del lector existente del simulador. Se hace explícitamente así porque
un WeatherContract histórico activo podría corresponder a otra ubicación; no
se reutiliza sin validar su emplazamiento.

Se exigen años horarios cronológicamente completos. El lector anota si faltan
irradiancia, temperatura o viento que el simulador antiguo sustituye por
defaults; el mapa no puede dar un veredicto verde en ese caso. La propia
simulación contabiliza la ausencia de racha o profundidad de nieve.

Una consulta externa fallida deja el punto sin evaluar; no se sustituye
automáticamente por un año sintético.

## Límites declarados

- El resultado describe **disponibilidad energética del control**, no certifica
  resistencia estructural ni validación de cargas extremas del seguidor.
- Las limitaciones del simulador de batería se conservan: el motor no estima
  exhaustivamente el incremento de par aerodinámico ni todos los límites de
  batería caliente/fría. Cuando se observan temperaturas fuera de límites
  declarados no se asigna «Apto».
- Un equipo sin ficha comercial o una pareja panel–batería de estudio no recibe
  un verde comercial.
- Un solo año no es suficiente para una conclusión de disponibilidad climática.
- La consulta histórica puede tardar y estar limitada por cuota de la fuente.
  El mapa no precalcula automáticamente todas las plantas del mundo.
- El resultado y su fecha pueden consultarse localmente en el navegador; no se
  sincroniza con Notion ni con un backend en esta versión.

## Comprobación

Ejecutar desde la raíz del repositorio: node tools/prueba_mapa_viabilidad.mjs.

Esta prueba bloqueante verifica el enlace, la reutilización del simulador, el
rechazo de años horarios incompletos y la clasificación conservadora de
falta de datos, agotamiento, falta de reserva y límites térmicos.

**No se fusiona a main sin revisar y probar manualmente la interfaz y una
ejecución meteorológica real en navegador.**
