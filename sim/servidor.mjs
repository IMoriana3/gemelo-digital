#!/usr/bin/env node
/* ============================================================================
   servidor.mjs — EL MOTOR DE PLANTA, POR HTTP.

   El simulador vive en el navegador, y ahí no puede haber un esclavo Modbus TCP.
   Pero `scada/tools/ncu_simulada.py` ya es un esclavo de verdad —el que sirve para
   ejercitar el troceado a 110 registros, el orden de palabra y el direccionamiento—
   y hasta ahora se alimentaba de una planta de juguete que su propia cabecera
   declara «verosímil, no real».

   Esto le da la de verdad. El motor corre aquí, en Node, y publica su imagen de
   registros; la NCU simulada la pide y la sirve por Modbus. Resultado: la toolbox y
   el colector reales hablan con la planta simulada de verdad, con su jerarquía, su
   inclinómetro que miente y su seta enclavada.

   Y la escritura vuelve por el mismo sitio: lo que un maestro Modbus escriba en la
   NCU simulada llega aquí y entra por `P.escribe()`, que es la misma puerta que usa
   la interfaz. No hay un camino «de la web» y otro «de Modbus».

       node sim/servidor.mjs --tcus 200 --hsus 4 --puerto 8787 --vel 60

   Endpoints
       GET  /estado                resumen de la planta y del reloj simulado
       GET  /regs?dev=ncu          imagen de registros {direccion: valor}
       GET  /regs?dev=tcu&id=7     ídem del mapa propio de un TCU
       POST /escribe               {dev,id,dir,vals} → la misma P.escribe()
       POST /meteo                 {viento,nubes,nieve,temp,…} para mover el tiempo
   ============================================================================ */
import http from 'node:http';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const SIM = require('./planta.js');

/* ---- argumentos, sin dependencias ---- */
const A = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith('--')) A[a.slice(2)] = (process.argv[i + 1] || '').startsWith('--') ? true : process.argv[++i];
}
const CFG = {
  tcus: +(A.tcus || 200), hsus: +(A.hsus || 4), reps: +(A.reps || 2),
  grupos: +(A.grupos || 4), puerto: +(A.puerto || 8787), host: A.host || '127.0.0.1',
  vel: +(A.vel || 60),                     /* segundos simulados por segundo real */
  lat: +(A.lat || 42.82), lon: +(A.lon || -1.60), tz: +(A.tz || 1),
  dia: +(A.dia || 172), hora: +(A.hora || 6),
  perfil: A.perfil || undefined
};

const P = new SIM.Planta({
  nTcu: CFG.tcus, nHsu: CFG.hsus, nRep: CFG.reps, grupos: CFG.grupos,
  lat: CFG.lat, lon: CFG.lon, tz: CFG.tz, dia: CFG.dia, hora: CFG.hora,
  perfil: CFG.perfil,
  averias: A.averias ? { activo: true, comsMtbfH: 40, comsMin: 15, duroMtbfD: 20,
                         caladoMtbfD: 60, reparaH: 8, desajusteSig: 0.6 } : undefined
});

/* El reloj avanza con el de pared × velocidad. A ×60 un día simulado son 24 minutos
   reales, que es lo que hace falta para dejar un colector recogiendo un rato. */
let tUlt = Date.now();
setInterval(() => {
  const ahora = Date.now();
  let dt = Math.min(5, (ahora - tUlt) / 1000) * CFG.vel;
  tUlt = ahora;
  while (dt > 0) { const p = Math.min(60, dt); P.paso(p); dt -= p; }
}, 200);

/* Un FC16 no es «un registro con muchos valores»: son REGISTROS SEGUIDOS, cada uno con
   el suyo. Pasarle los N valores a la primera dirección escribiría uno y tiraría el resto
   sin decirlo. Aquí se reparten dirección a dirección, gastando dos registros en los que
   son f32 —que es lo que hace el firmware— y abortando entero en el primer rechazo, como
   una excepción Modbus. */
function escribeBloque(dev, id, dir, vals) {
  const cat = SIM.ESCRITURA[dev] || {};
  const out = { ok: true, aplicados: [], avisos: [] };
  for (let k = 0; k < vals.length;) {
    const d = dir + k, def = cat[d], ancho = (def && def.f32) ? 2 : 1;
    const r = P.escribe(dev, id, d, vals.slice(k, k + ancho));
    out.aplicados.push.apply(out.aplicados, r.aplicados);
    out.avisos.push.apply(out.avisos, r.avisos);
    if (!r.ok) { out.ok = false; break; }
    k += ancho;
  }
  return out;
}

/* ---- HTTP ---- */
function json(res, code, obj) {
  const b = Buffer.from(JSON.stringify(obj));
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8',
                        'content-length': b.length,
                        'access-control-allow-origin': '*',
                        'access-control-allow-headers': 'content-type' });
  res.end(b);
}
function cuerpo(req) {
  return new Promise((ok) => {
    let s = '';
    req.on('data', (c) => { s += c; if (s.length > 1e6) req.destroy(); });
    req.on('end', () => { try { ok(JSON.parse(s || '{}')); } catch (e) { ok({}); } });
  });
}

const srv = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  if (req.method === 'OPTIONS') return json(res, 204, {});

  if (u.pathname === '/estado') {
    const r = P.resumen(), f = P.fechaSim();
    return json(res, 200, {
      ok: true, motor: 'gemelo-digital/sim/planta.js',
      t: { dia: P.t.dia, hora: P.t.hora, epoch: P.t.epoch,
           fecha: `${f.dia}/${f.mes} ${f.hora}:${String(f.min).padStart(2, '0')}` },
      planta: { tcus: P.tcus.length, hsus: P.hsus.length, grupos: P.cfg.grupos, vel: CFG.vel },
      resumen: r,
      meteo: { viento_kmh: +(P.meteo.viento * 3.6).toFixed(1), rachas: P.meteo.rachas,
               dir: P.meteo.dirViento, nubes: P.meteo.nubes,
               nieve_cm: +(P.meteo.nieve * 100).toFixed(1), temp: P.meteo.tMedia }
    });
  }

  if (u.pathname === '/regs') {
    const dev = u.searchParams.get('dev') || 'ncu';
    const id = +(u.searchParams.get('id') || 1);
    let R;
    if (dev === 'ncu') R = P.regsNCU();
    else if (dev === 'tcu') { const t = P.tcu(id); if (!t) return json(res, 404, { ok: false, error: 'no hay TCU ' + id }); R = P.regsTCU(t); }
    else if (dev === 'hsu') { const h = P.hsus[id - 1]; if (!h) return json(res, 404, { ok: false, error: 'no hay HSU ' + id }); R = P.regsHSU(h); }
    else return json(res, 400, { ok: false, error: 'dev tiene que ser ncu, tcu o hsu' });
    return json(res, 200, { ok: true, dev, id, epoch: P.t.epoch, n: Object.keys(R).length, regs: R });
  }

  if (u.pathname === '/escribe' && req.method === 'POST') {
    const b = await cuerpo(req);
    if (b.dir == null) return json(res, 400, { ok: false, avisos: ['falta dir'] });
    const r = escribeBloque(b.dev || 'tcu', b.id || 1, +b.dir, b.vals || [b.val || 0]);
    return json(res, r.ok ? 200 : 400, r);
  }

  if (u.pathname === '/meteo' && req.method === 'POST') {
    const b = await cuerpo(req), m = P.meteo, hechos = [];
    if (b.viento_kmh != null) { m.viento = +b.viento_kmh / 3.6; hechos.push('viento'); }
    if (b.rachas != null) { m.rachas = +b.rachas; hechos.push('rachas'); }
    if (b.dir != null) { m.dirViento = +b.dir; hechos.push('dir'); }
    if (b.nubes != null) { m.nubes = +b.nubes; hechos.push('nubes'); }
    if (b.nieve_cm != null) { m.nieve = +b.nieve_cm / 100; hechos.push('nieve'); }
    if (b.temp != null) { m.tMedia = +b.temp; hechos.push('temp'); }
    return json(res, 200, { ok: true, aplicados: hechos });
  }

  json(res, 404, { ok: false, error: 'no existe: ' + u.pathname,
                   endpoints: ['/estado', '/regs?dev=ncu', 'POST /escribe', 'POST /meteo'] });
});

srv.listen(CFG.puerto, CFG.host, () => {
  console.log(`motor de planta en http://${CFG.host}:${CFG.puerto}  ·  ` +
              `${P.tcus.length} equipos (${CFG.hsus} HSU) · ×${CFG.vel} · ` +
              `día ${CFG.dia} a las ${CFG.hora}:00`);
  console.log('   la NCU simulada lo consume con:  python3 tools/ncu_simulada.py --gemelo ' +
              `http://${CFG.host}:${CFG.puerto}`);
});
