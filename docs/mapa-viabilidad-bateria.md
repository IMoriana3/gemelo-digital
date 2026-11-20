# Mapa mundial de viabilidad de TCU · simulador de batería Factiun

## Alcance

La pestaña **Mapa mundial de viabilidad** se abre desde bateria.html. No crea otro
simulador ni utiliza un modelo distinto: llama a simulate, simulaSeguido,
summarize, controlesPara, opcionesPara y fetchYearDeclarado que ya viven en
la página.

El mapa **no calcula por proximidad geográfica**. Los marcadores inicialmente
aparecen grises; solo se colorean para el perfil, estrategia, periodo y parámetros
que se han evaluado en ese punto exacto.

## Contrato obligatorio de paridad literal

La vista del mapa **no es otro simulador**. La fórmula de energía, SOC,
movimiento, límites de carga, viento y nieve existe **una sola vez** en
`simulate()` de `bateria.html`; `simulaSeguido()` reutiliza `simulate()`
para encadenar años sin reiniciar el estado. El único punto de ejecución de
ambas interfaces es `ejecutaBalanceTCU()`, también en `bateria.html`.
El panel principal y su referencia utilizan este ejecutor directamente;
las estrategias de ambas vistas pasan por `calculaControlTCU()`, que llama
a `opcionesDe()` y a `ejecutaBalanceTCU()`. El mapa no copia ninguna
ecuación energética: solo selecciona coordenadas, datos, parámetros, muestra
los indicadores del simulador y añade avisos conservadores de calidad de datos.

La prueba de paridad no sustituye a la implementación única: sirve para evitar
que alguien introduzca posteriormente otro algoritmo o desvíe un parámetro.

**Cómo comparar sin ambigüedad:**

1. Evaluar una ubicación del mapa, con una serie meteorológica completa.
2. Pulsar **«Usar mismos datos en el simulador»**. Se pasan al panel principal
   referencias a las **mismas filas horarias**, sin nueva descarga, corrección,
   interpolación ni cambio de modelo meteorológico.
3. El panel sincroniza coordenadas exactas, hardware, panel, fuente meteorológica,
   año/rango, paso horario y modo de SOC inicial. Los demás parámetros físicos,
   SOH y política se conservan porque ambas vistas leen el mismo formulario.
4. Ejecutar `Simular` en el panel. La comparación de cifras se realiza sobre
   los mismos datos y con el mismo motor.
5. El barrido de 30 años arranca cada tramo en el SOC estacionario propio de su
   estrategia. Para un año individual ambos leen el SOC inicial del deslizador.

**Qué métricas son comparables:** la serie horaria completa de SOC, posición,
carga, motor, electrónica, reserva, temperatura, viento y nieve; y cualquier KPI
calculado sobre el **mismo rango de fechas**. El simulador enseña en su tabla de
estrategias el invierno que gobierna la **estrategia base**; el mapa enseña
tanto todo el histórico como, separado, ese mismo invierno y sus KPIs.
No comparar un porcentaje anual de 30 años con un porcentaje del peor invierno.

**Control de calidad:** `tools/prueba_bateria.mjs` compara con `===` o
`JSON.stringify` sin redondear las filas y KPIs de los dos caminos para
Tordesillas, Chorzele, La Joya y Dunedin, cinco modelos de TCU y cuatro
políticas, con viento, nieve, frío y dos tramos multianuales de prueba. La
prueba falla ante cualquier diferencia. `tools/prueba_mapa_viabilidad.mjs`
vigila que no aparezca otra implementación del balance en el mapa.

**CASO NAS:** la petición desde la web incluye una firma completa de escenario
y todos los valores editables; el NAS rechaza el trabajo **antes de calcular**
si los ajustes reconstruidos no dan la misma firma. El identificador de cola
incluye la firma y las coordenadas sin redondearlas. Los trabajos generados por
`seed.mjs` no llevan firma de usuario: utilizan los valores predeterminados
de `bateria.html` y solo se muestran en la UI con su firma de resultados.
No equivalen automáticamente a un estudio manual con parámetros editados.

**No comparables:** estudios NASA POWER 2025 sin ráfaga/nieve, estudios de
WeatherContract con otra procedencia o series de distinta fecha/año. Ni una
prueba exacta entre dos vistas demuestra que la física esté calibrada frente
a campo: la paridad prueba ausencia de divergencia software.

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
  comprometida, indisponibilidad, estrategia sin protección por SOC o eventos
  de nieve/viento cuya física de cobertura/par del motor aún no está validada.
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

El barrido geográfico usa fuentes **explícitas por variable** según
la documentación oficial de Open-Meteo: `models=era5` para GHI, DHI
y **viento medio**; `models=era5_land` para temperatura, nieve acumulada
y **ráfaga de 10 m**. ERA5 no ofrece ráfagas en esta API. Se exige coincidencia
exacta de todos los instantes horarios de ambos modelos.

**Unidades obligatorias:** ambas peticiones incluyen `wind_speed_unit=ms`
(el antiguo `windspeed_unit=ms` era inválido). No basta con la URL:
se verifica `hourly_units.windspeed_10m === 'm/s'` en ERA5 y
`hourly_units.wind_gusts_10m === 'm/s'` en ERA5-Land. Sin unidades
verificables el mapa no calcula un veredicto. Esta corrección invalida
todos los resultados anteriores.

ERA5-Land aporta la componente terrestre a ~0,1° y ERA5 la atmosférica
a ~0,25°. La coordenada NO identifica una estación meteorológica exacta.
Dos consultas históricas por año, un solo balance de batería.
La selección evita que «Best Match» cambie de modelo entre décadas.
La nieve de `snow_depth` es profundidad **sobre el suelo**, y el proveedor
advierte que puede estar sobreestimada. Fuente primaria:
https://open-meteo.com/en/docs/historical-weather-api

Se exigen años horarios cronológicamente completos. El lector anota si faltan
irradiancia, temperatura o viento que el simulador antiguo sustituye por
defaults; el mapa no puede dar un veredicto verde en ese caso. La propia
simulación contabiliza la ausencia de racha o profundidad de nieve. Los valores
no finitos o negativos también son datos inválidos, nunca horas de calma
meteorológica ni de ausencia de nieve.

Una consulta externa fallida deja el punto sin evaluar; no se sustituye
automáticamente por un año sintético.

## Límites declarados

- El resultado describe **disponibilidad energética del control**, no certifica
  resistencia estructural ni validación de cargas extremas del seguidor.
- Las limitaciones del simulador de batería se conservan: el motor no estima
  exhaustivamente el incremento de par aerodinámico ni todos los límites de
  batería caliente/fría. Cuando se observan temperaturas fuera de límites
  declarados no se asigna «Apto».
- El sistema aplica la protección de nieve SP3, pero no dispone de un modelo
  validado de la pérdida óptica del panel auxiliar o del string por nieve
  adherida. **Cualquier nieve observada deja el veredicto como condicionado**
  si los datos son completos; no se inventa una eficiencia de limpieza.
- Si el periodo contiene maniobras de viento, el par aerodinámico real requiere
  validación de campo: el veredicto no se presenta como «Apto» sin ella.
- Indicadores o temperaturas NaN/Infinity, salidas físicamente inconsistentes
  o un número de años verificados distinto del solicitado bloquean «Apto».
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
falta de datos, agotamiento, falta de reserva, límites térmicos,
no-finitos y riesgos de viento/nieve sin caracterización completa.

**No se fusiona a main sin revisar y probar manualmente la interfaz y una
ejecución meteorológica real en navegador.**
