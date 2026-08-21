/* ============================================================================
   canon.js — EL ALGORITMO SE LEE DEL MOTOR, NO SE REESCRIBE AQUÍ.

   El gemelo simula el EQUIPO: el lazo con su banda muerta en pulsos, el
   inclinómetro con su ruido, la seta, la batería, el mapa Modbus. Eso es suyo.

   Pero el ALGORITMO de seguimiento —backtracking, política de cielo cubierto,
   abanderamiento, night latch— es de SolarGPT, y portarlo a JavaScript es
   exactamente lo que crea dos versiones que divergen sin que nadie se entere.
   Ya pasó con el sleep (0,45 contra 0,64 W) y con la velocidad del actuador
   (0,16 contra 0,17 °/s): números que coincidían el día que se copiaron.

   Así que aquí no se calcula: se PIDE. Al arrancar una simulación se le pregunta
   al motor local de SolarGPT (SolarGPTfull/server/app.py, `POST /tracker`) por la
   trayectoria del ángulo del día, y el gemelo la ejecuta.

   Es el patrón que ya usa la plataforma y lo dice el propio servicio: «la ficha
   detecta el servicio (GET /health); si está, usa el motor; si no, cae al modelo
   de navegador (primer orden)». Lo que NO se hace es caer al modelo de navegador
   en silencio: si el motor no está, se dice en pantalla y se dice en el registro,
   porque un resultado de primer orden que parece uno canónico es peor que no
   tener resultado.

       cd SolarGPTfull/server && ./run.sh      → http://127.0.0.1:8765

   ⚠ CONVENCIÓN DE SIGNO. El motor devuelve θ en convención pvlib: POSITIVO es
   cara al este. La casa usa lo contrario. La conversión se hace AQUÍ, una vez,
   al recibir la serie — no en cada sitio que la use.
   ============================================================================ */
(function (global) {
'use strict';

var POR_DEFECTO = 'http://127.0.0.1:8765';

function Canon(cfg) {
  cfg = cfg || {};
  this.url = (cfg.url || POR_DEFECTO).replace(/\/+$/, '');
  this.estado = 'sin probar';    /* sin probar · ausente · listo · error */
  this.motor = null;             /* qué motor dice ser */
  this.serie = null;             /* la trayectoria del día, ya en convención de la casa */
  this.detalle = '';
}

/* ¿está el motor? Una sola llamada, y no se vuelve a insistir sola. */
Canon.prototype.busca = function () {
  var yo = this;
  return fetch(this.url + '/health', { method: 'GET' })
    .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)); })
    .then(function (j) {
      yo.estado = j && j.ok ? 'listo' : 'error';
      yo.motor = j || null;
      yo.detalle = j && j.pipeline_version ? ('SolarGPT ' + j.pipeline_version) : '';
      return yo.estado === 'listo';
    })
    .catch(function (e) {
      yo.estado = 'ausente';
      yo.detalle = String(e.message || e);
      return false;
    });
};

/* Pide la trayectoria de un día. `pet` lleva sitio, día, nubosidad y qué política
   de cielo cubierto se quiere — todo lo demás lo pone el canon. */
Canon.prototype.trayectoria = function (pet) {
  var yo = this;
  return fetch(this.url + '/tracker', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(pet)
  }).then(function (r) {
    return r.ok ? r.json() : r.text().then(function (t) { return Promise.reject(new Error(t.slice(0, 200))); });
  }).then(function (j) {
    if (!j || !j.hora || !j.theta_deg) throw new Error('respuesta sin trayectoria');
    /* pvlib → casa: el signo cambia AQUÍ y no se vuelve a tocar */
    var n = j.hora.length, th = new Array(n), tt = new Array(n);
    for (var i = 0; i < n; i++) { th[i] = -j.theta_deg[i]; tt[i] = -j.theta_target_deg[i]; }
    yo.serie = {
      hora: j.hora, theta: th, objetivo: tt,
      difusa: j.diffuse_active || null, alpha: j.diffuse_alpha || null,
      ghi: j.GHI || null, dhi: j.DHI || null, poa: j.POA_Global || null,
      motor: j.motor, engine: j.engine, resumen: j.resumen, paso: j.paso_min
    };
    yo.estado = 'listo';
    return yo.serie;
  }).catch(function (e) {
    yo.estado = 'error'; yo.detalle = String(e.message || e); yo.serie = null;
    return null;
  });
};

/* Balance de batería del TCU: POST /tcubalance. Mismo trato que la trayectoria —
   el modelo de batería (SOC, OCV, curva η(G) del cargador, JEITA, calefactor,
   inhibiciones y calibración) es de `run_tcu_sim` y se ejecuta ALLÍ.

   Devuelve la respuesta tal cual, que ya viene autodeclarada: `motor` dice qué la
   calculó, `modelo_stow` qué abanderamiento lleva dentro y `motor_el_burgo` el
   consumo medido con su dominio. Aquí no se reinterpreta nada.

   Null si el motor no está o contesta mal: quien llama cae a su cálculo local y
   —esto es lo importante— lo DICE. */
Canon.prototype.balance = function (pet) {
  var yo = this;
  return fetch(this.url + '/tcubalance', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(pet)
  }).then(function (r) {
    return r.ok ? r.json()
                : r.text().then(function (t) { return Promise.reject(new Error(t.slice(0, 200))); });
  }).then(function (j) {
    if (!j || !j.resumen || !j.energia_wh) throw new Error('respuesta sin balance');
    yo.estado = 'listo';
    return j;
  }).catch(function (e) {
    yo.estado = 'error'; yo.detalle = String(e.message || e);
    return null;
  });
};

/* Consulta por hora civil, interpolando entre muestras. La serie da la vuelta al
   día, así que la hora se busca en circular: a las 23,9 h el vecino es 0,0 h. */
Canon.prototype.en = function (hora) {
  var s = this.serie;
  if (!s || !s.hora.length) return null;
  var h = ((hora % 24) + 24) % 24, n = s.hora.length;
  /* la serie viene ordenada por índice de tiempo UTC, que con huso no nulo NO está
     ordenada por hora civil: se busca el intervalo por proximidad circular */
  var mejor = 0, dmin = 1e9;
  for (var i = 0; i < n; i++) {
    var d = Math.abs(((s.hora[i] - h + 36) % 24) - 12);   /* distancia circular */
    if (d < dmin) { dmin = d; mejor = i; }
  }
  var j = (mejor + 1) % n;
  var dh = ((s.hora[j] - s.hora[mejor] + 36) % 24) - 12;
  var f = Math.abs(dh) > 1e-9 ? ((((h - s.hora[mejor] + 36) % 24) - 12) / dh) : 0;
  f = Math.max(0, Math.min(1, f));
  return {
    theta: s.theta[mejor] + f * (s.theta[j] - s.theta[mejor]),
    objetivo: s.objetivo[mejor] + f * (s.objetivo[j] - s.objetivo[mejor]),
    difusa: s.difusa ? !!s.difusa[mejor] : false,
    alpha: s.alpha ? s.alpha[mejor] : 0,
    ghi: s.ghi ? s.ghi[mejor] : null
  };
};

Canon.prototype.hayTrayectoria = function () { return !!(this.serie && this.serie.hora.length); };
Canon.POR_DEFECTO = POR_DEFECTO;
if (typeof window !== 'undefined') window.Canon = Canon;
if (typeof module !== 'undefined') module.exports = Canon;
})(this);
