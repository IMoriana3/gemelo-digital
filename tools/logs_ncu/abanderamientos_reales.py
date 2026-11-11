#!/usr/bin/env python3
"""ABANDERAMIENTOS REALES, medidos en los logs diarios de las NCU.

Qué contesta, con dato de planta y no con modelo:
  · cuánto tarda la orden de posición segura en llegar a cada TCU tras la alarma,
  · cuánto tarda el eje en llegar a la bandera y cuántos llegan,
  · hacia qué lado abandera y cuántas veces cruza el plano,
  · cuánta energía de motor cuesta la maniobra (contador del firmware, en julios),
  · con cuánta batería empieza,
  · y qué viento hay mientras el eje va de camino.

De dónde salen los datos. Un zip por NCU y día (`NCU01_2026-06-09.zip`) con:
  NCU_EVENT_LOG_<día>.csv   alarmas de viento, peticiones de posición segura y fallos
  TCU_<nnn>_<día>.csv       una fila cada 12-21 s: ángulo, objetivo, posición segura
                            activa, SOC, contador diario de energía de motor…
  HSU_<nnn>_<día>.csv       anemómetro cada 5 s
Los logs son PRIVADOS (repositorio `elburgo-logs-ncu`) y NO se copian aquí: este
programa sólo los lee, y lo que escribe va fuera del repositorio o a una carpeta
ignorada. Aquí vive el método, no el dato.

    python3 tools/logs_ncu/abanderamientos_reales.py --logs ../elburgo-logs-ncu --salida /tmp/abanderamientos
    python3 tools/logs_ncu/abanderamientos_reales.py --autoprueba

LO QUE NO MIDE, y va dicho donde se cita cada cifra:
  · el tramo de anemómetro a alarma (el log de eventos empieza en la alarma);
  · nada por debajo del muestreo del log de la TCU: «la TCU tiene la orden a los
    N s» es una cota superior, no el instante;
  · la fuerza: dice si el eje llegó y qué gastó, no si la estructura aguanta;
  · lo que no ha ocurrido: si en los logs ninguna TCU abanderó con la batería
    baja, de ese caso no hay medida.
"""
import argparse, glob, json, os, re, sys, tempfile, zipfile
from multiprocessing import Pool
import numpy as np, pandas as pd

COLS = ['datetime', 'main_state', 'active_security_position', 'angle', 'target_angle', 'soc',
        'remaining_capacity', 'ps_voltage', 'voltage', 'motor_current_peak', 'daily_motor_power_consumption']
RE_REQ = re.compile(r'(\S+ \S+);Requesting safe position (\d+), wind_from_east: (\w+), for TCU (\d+)\. Reason: (.*)')
RE_AL = re.compile(r'(\S+ \S+);Wind alarm for HSU (\d+) changed\. Enabled: (\w+)')
RE_FA = re.compile(r'(\S+ \S+);Failed to set the security position for TCU (\d+)')
TOL_LLEGA = 1.0      # ° · «llega» = a ±1° del objetivo que tuvo durante la bandera
MIN_GRADOS = 20.0    # ° · por debajo no se juzga tiempo ni energía: es ruido de inclinómetro más un paso
LADO_MIN = 8.0       # ° · por debajo de esto el eje está «en plano» y no tiene lado


def _s(serie):
    return serie.values.astype('datetime64[s]').astype('int64')


def _t(txt):
    return int(np.datetime64(txt.replace(' ', 'T'), 's').astype('int64'))


def procesa_dia(z):
    """Un zip → (activaciones, cobertura por alarma, meta). Puro respecto al zip."""
    ncu, dia = os.path.basename(z)[:5], os.path.basename(z)[6:16]
    act, cob, meta = [], [], {'ncu': ncu, 'dia': dia, 'n_req': 0, 'n_fallos': 0, 'n_alarmas': 0}
    with zipfile.ZipFile(z) as f:
        nev = [n for n in f.namelist() if n.startswith('NCU_EVENT_LOG')]
        if not nev:
            return act, cob, meta
        req, al, fa = [], [], []
        for l in f.open(nev[0]).read().decode('utf-8', 'replace').splitlines():
            m = RE_REQ.match(l)
            if m:
                req.append((_t(m.group(1)), int(m.group(2)), m.group(3) in ('1', 'true'), int(m.group(4)), m.group(5).strip()))
                continue
            m = RE_AL.match(l)
            if m:
                al.append((_t(m.group(1)), int(m.group(2)), m.group(3) == 'true'))
                continue
            m = RE_FA.match(l)
            if m:
                fa.append((_t(m.group(1)), int(m.group(2))))
        on = [a for a in al if a[2]]
        meta.update(n_req=len(req), n_fallos=len(fa), n_alarmas=len(on))
        if not on and not any(r[4] == 'Request from HSU' and r[1] > 0 for r in req):
            return act, cob, meta
        hs = []
        for h in f.namelist():
            if h.startswith('HSU_'):
                x = pd.read_csv(f.open(h), sep=';', usecols=['datetime', 'wind_speed', 'wind_direction'], parse_dates=['datetime'])
                hs.append((_s(x.datetime), x.wind_speed.values, x.wind_direction.values))

        def viento(t0, t1):
            vm, dm = np.nan, np.nan
            for (t, v, d) in hs:
                a, b = np.searchsorted(t, t0), np.searchsorted(t, t1, side='right')
                if b > a:
                    k = a + int(np.argmax(v[a:b]))
                    if not (vm >= v[k]):
                        vm, dm = float(v[k]), float(d[k])
            return vm, dm

        T = np.array([a[0] for a in on], dtype='int64')
        fin = np.array([min([b[0] for b in al if (not b[2]) and b[1] == a[1] and b[0] > a[0]] or [a[0] + 600]) for a in on], dtype='int64')
        claves = ['n', 'sin_registro', 'ya'] + ['%s%d' % (p, x) for p in ('con', 'dato') for x in (30, 60, 120, 300)]
        acc = {k: np.zeros(len(T), int) for k in claves}
        al_on = np.sort(T)
        req_t, fa_t = {}, {}
        for r in req:
            req_t.setdefault(r[3], []).append(r)
        for a in fa:
            fa_t.setdefault(a[1], []).append(a[0])

        for n in sorted(x for x in f.namelist() if x.startswith('TCU_')):
            tcu = int(n.split('_')[1])
            try:
                df = pd.read_csv(f.open(n), sep=';', usecols=COLS, parse_dates=['datetime'])
            except Exception:
                continue
            if len(df) < 50:
                continue
            t = _s(df.datetime); asp = df.active_security_position.values; ang = df.angle.values; tg = df.target_angle.values
            # el contador diario se pone a cero al anochecer: se acumulan sólo los incrementos
            cj = np.cumsum(np.concatenate([[0], np.clip(np.diff(df.daily_motor_power_consumption.values.astype(float)), 0, None)]))
            cap = df.remaining_capacity.values.astype(float); ps = df.ps_voltage.values; soc = df.soc.values; vb = df.voltage.values
            pk = df.motor_current_peak.values

            # — cobertura: por cada alarma, ¿tiene esta TCU la posición segura a los N s? —
            for a, Ta in enumerate(T):
                acc['n'][a] += 1
                i0 = np.searchsorted(t, Ta, side='right')
                if i0 >= len(t) or t[i0] - Ta > 120:
                    acc['sin_registro'][a] += 1
                    continue
                if i0 > 0 and asp[i0 - 1] > 0 and Ta - t[i0 - 1] <= 60:
                    acc['ya'][a] += 1          # ya estaba abanderada: no cuenta para la latencia
                    continue
                for x in (30, 60, 120, 300):
                    k = np.searchsorted(t, Ta + x, side='right') - 1
                    if k >= i0:
                        acc['dato%d' % x][a] += 1
                        acc['con%d' % x][a] += int(asp[k] > 0)

            # — activaciones: cada paso de 0 a posición segura —
            for i in np.where((asp[1:] > 0) & (asp[:-1] == 0))[0] + 1:
                rel = np.where(asp[i:] == 0)[0]
                j = i + int(rel[0]) if len(rel) else len(asp)
                if j - i < 3:
                    continue
                obj = float(np.median(tg[min(i + 1, j - 1):j]))
                lleg = np.where(np.abs(ang[i:j] - obj) <= TOL_LLEGA)[0]
                k = i + int(lleg[0]) if len(lleg) else None
                f_ = k if k is not None else j - 1
                rs = [r for r in req_t.get(tcu, []) if r[1] > 0 and t[i] - 180 <= r[0] <= t[i] + 5]
                r = rs[-1] if rs else None
                ta = al_on[al_on <= (r[0] if r else t[i])]
                vmax, vdir = viento(t[i - 1], t[f_])
                v1, _ = viento(t[i - 1] - 60, t[i])
                fila = dict(ncu=ncu, dia=dia, tcu=tcu, t_alarma=(int(ta[-1]) if len(ta) else None), t_peticion=(r[0] if r else None),
                            t_tcu=int(t[i]), t_previa=int(t[i - 1]), t_fin=int(t[f_]), motivo=(r[4] if r else None), viento_este=(r[2] if r else None),
                            ang0=float(ang[i - 1]), obj=obj, llega=(k is not None), ang_fin=float(ang[f_]), grados=float(abs(ang[f_] - ang[i - 1])),
                            J=float(cj[f_] - cj[i - 1]), mAh=float(cap[i - 1] - cap[f_]), soc0=int(soc[i - 1]), vbat0=int(vb[i - 1]),
                            fuente_max=int(ps[i - 1:f_ + 1].max()), pico_mA=int(pk[i - 1:f_ + 1].max()), viento_max=vmax, viento_dir=vdir,
                            viento_min_antes=v1, s_bandera=int(t[j - 1] - t[i]),
                            fallos_previos=sum(1 for x in fa_t.get(tcu, []) if t[i] - 180 <= x <= t[i] + 5))
                # la vuelta: de la liberación a alcanzar el seguimiento (15 min o hasta otra activación)
                if j < len(asp) - 3:
                    lim = np.searchsorted(t, t[j] + 900); nx = np.where(asp[j:lim] > 0)[0]
                    lim = j + int(nx[0]) if len(nx) else lim
                    al2 = np.where(np.abs(ang[j:lim] - tg[j:lim]) <= 1.5)[0]
                    if len(al2):
                        q = j + int(al2[0]); vr, _ = viento(t[j - 1], t[q])
                        fila.update(v_grados=float(abs(ang[q] - ang[j - 1])), v_J=float(cj[q] - cj[j - 1]), v_viento=vr)
                act.append(fila)
        for a in range(len(T)):
            c = dict(ncu=ncu, dia=dia, t=int(T[a]), hsu=on[a][1], s_alarma=int(fin[a] - T[a]))
            c.update({k: int(v[a]) for k, v in acc.items()})
            cob.append(c)
    return act, cob, meta


def pct(s, ps):
    s = np.asarray(s, dtype=float); s = s[~np.isnan(s)]
    return {('p%g' % p): (round(float(np.percentile(s, p)), 2) if len(s) else None) for p in ps}


def resume(act, cob, metas):
    """Las cifras que se citan. Cada una con su n: una mediana sin n no es una medida."""
    d, c, m = pd.DataFrame(act), pd.DataFrame(cob), pd.DataFrame(metas)
    R = {'periodo': [m.dia.min(), m.dia.max()] if len(m) else None, 'ncu_dias': int(len(m)),
         'alarmas': int(m.n_alarmas.sum()) if len(m) else 0, 'dias_con_alarma': int(m[m.n_alarmas > 0].dia.nunique()) if len(m) else 0,
         'peticiones': int(m.n_req.sum()) if len(m) else 0, 'fallos_peticion': int(m.n_fallos.sum()) if len(m) else 0}
    if not len(d):
        return R
    # SÓLO las de alarma de viento. La HSU pide posición segura por más motivos —la alarma de
    # difusa manda a plano a alguna TCU suelta—, y esas se colaban aquí: salían como «cruces
    # del plano» sin serlo. Una petición de HSU en un día sin alarma de viento no es de viento.
    hsu = d[d.motivo == 'Request from HSU']
    h = hsu[hsu.t_alarma.notna()].copy()
    R['activaciones'] = int(len(h)); R['tcu'] = int(h.groupby('ncu').tcu.nunique().sum())
    R['dias_con_activaciones'] = int(h.dia.nunique()); R['peticiones_hsu_que_no_son_de_viento'] = int(len(hsu) - len(h))
    R['fallos_pct'] = round(100 * R['fallos_peticion'] / max(1, R['peticiones']), 2)
    h['a_pet'] = h.t_peticion - h.t_alarma; h['a_tcu'] = h.t_tcu - h.t_alarma
    R['s_alarma_a_peticion'] = dict(n=int(h.a_pet.notna().sum()), **pct(h.a_pet, (50, 95, 99)))
    R['s_alarma_a_tcu_cota'] = dict(n=int(h.a_tcu.notna().sum()), **pct(h.a_tcu, (50, 95, 99)))
    R['s_muestreo_tcu'] = pct(h.t_tcu - h.t_previa, (50, 95))
    x = h[h.fallos_previos > 0]
    R['reintento_s_alarma_a_tcu'] = dict(n=int(len(x)), **pct(x.a_tcu, (50, 95)))
    if len(c):
        R['cobertura'] = {'tcu_alarma': int((c.n - c.sin_registro).sum()), 'sin_registro': int(c.sin_registro.sum()), 'ya_abanderadas': int(c.ya.sum())}
        for s in (30, 60, 120, 300):
            R['cobertura']['a_%ds' % s] = dict(con=int(c['con%d' % s].sum()), de=int(c['dato%d' % s].sum()),
                                               pct=round(100 * c['con%d' % s].sum() / max(1, c['dato%d' % s].sum()), 2))
    g = h[h.grados >= MIN_GRADOS].copy()
    R['llegan'] = dict(de=int(len(g)), llegan=int(g.llega.sum()))
    gl = g[g.llega & g.t_alarma.notna()].copy(); gl['s'] = gl.t_fin - gl.t_alarma
    en_curso = gl[gl.s < 1800]                    # más de 30 min desde la alarma = la maniobra no la provocó esa alarma
    R['s_alarma_a_bandera'] = dict(n=int(len(en_curso)), **pct(en_curso.s, (50, 95, 99)))
    R['s_alarma_a_bandera_por_recorrido'] = {
        '%d-%d' % (a, b): dict(n=int(((en_curso.grados >= a) & (en_curso.grados < b)).sum()),
                               **pct(en_curso[(en_curso.grados >= a) & (en_curso.grados < b)].s, (50, 95)))
        for a, b in ((20, 30), (30, 40), (40, 50), (50, 62), (62, 115))}
    gl = g[g.llega].copy()                        # la energía y la velocidad no necesitan saber qué alarma fue
    R['velocidad_gps'] = pct(gl.grados / (gl.t_fin - gl.t_previa).clip(lower=1), (5, 50))
    con_lado = h[(h.grados >= 5) & (h.ang0.abs() >= LADO_MIN)]
    mismo = np.sign(con_lado.obj) == np.sign(con_lado.ang0)
    R['lado'] = dict(n=int(len(con_lado)), al_lado_en_que_esta=int(mismo.sum()), cruza=int((~mismo).sum()),
                     dias_de_los_cruces=con_lado[~mismo].dia.value_counts().head(5).to_dict())
    e = gl[gl.J > 0].copy(); e['Jg'] = e.J / e.grados; e['Wh'] = e.J / 3600
    aleja = ((np.sign(e.obj) == np.sign(e.ang0)) & (e.obj.abs() > e.ang0.abs())) | (e.ang0.abs() < LADO_MIN)
    for nom, y in (('mismo_lado', e[aleja]), ('cruzando_el_plano', e[~aleja])):
        R['energia_' + nom] = dict(n=int(len(y)), grados_p50=(round(float(y.grados.median()), 1) if len(y) else None),
                                   J_por_grado=pct(y.Jg, (5, 50, 95)), Wh=pct(y.Wh, (50, 95)))
    R['energia_mismo_lado_por_viento_Jg_p50'] = {'%d-%d' % (a, b): (round(float(e[aleja & (e.viento_max >= a) & (e.viento_max < b)].Jg.median()), 0)
                                                 if (aleja & (e.viento_max >= a) & (e.viento_max < b)).sum() > 20 else None)
                                                 for a, b in ((10, 12), (12, 14), (14, 16), (16, 18))}
    if 'v_grados' in h:
        v = h[(h.v_grados >= MIN_GRADOS) & (h.v_J > 0)].copy(); v['Jg'] = v.v_J / v.v_grados
        R['energia_vuelta_hacia_el_plano'] = dict(n=int(len(v)), J_por_grado=pct(v.Jg, (5, 50, 95)),
                                                  Jg_p50_en_calma=(round(float(v[v.v_viento < 10].Jg.median()), 0) if (v.v_viento < 10).sum() > 20 else None),
                                                  Jg_p50_con_viento=(round(float(v[v.v_viento >= 10].Jg.median()), 0) if (v.v_viento >= 10).sum() > 20 else None))
    sb = e[e.fuente_max < 5000]
    R['solo_bateria'] = dict(n=int(len(sb)), mAh_p50=(float(sb.mAh.median()) if len(sb) else None),
                             Wh_bateria_p50=(round(float((sb.mAh * sb.vbat0 / 1e6).median()), 2) if len(sb) else None),
                             Wh_motor_p50=(round(float(sb.Wh.median()), 2) if len(sb) else None))
    R['soc_al_empezar'] = dict(n=int(len(h)), minimo=int(h.soc0.min()), **pct(h.soc0, (1, 5, 50)))
    R['pico_motor_mA'] = dict(maximo=int(e.pico_mA.max()) if len(e) else None, **pct(e.pico_mA, (50, 95)))
    R['viento_minuto_anterior_ms'] = pct(h.viento_min_antes, (5, 50, 95))
    R['viento_en_transito_ms'] = dict(maximo=(float(np.nanmax(g.viento_max)) if len(g) else None), **pct(g.viento_max, (50, 95)))
    R['s_bandera_p50'] = float(h.s_bandera.median())
    return R


def corre(logs, salida, filtro=None, procesos=2):
    zs = sorted(glob.glob(os.path.join(logs, 'NCU*_*.zip')))
    if filtro:
        zs = [z for z in zs if filtro in os.path.basename(z)]
    if not zs:
        sys.exit('no hay zips NCU*_AAAA-MM-DD.zip en ' + logs)
    act, cob, metas = [], [], []
    with Pool(procesos) as p:
        for a, c, m in p.imap_unordered(procesa_dia, zs):
            act += a; cob += c; metas.append(m)
    R = resume(act, cob, metas)
    if salida:
        os.makedirs(salida, exist_ok=True)
        pd.DataFrame(act).to_csv(os.path.join(salida, 'maniobras.csv'), index=False)
        pd.DataFrame(cob).to_csv(os.path.join(salida, 'cobertura.csv'), index=False)
        json.dump(R, open(os.path.join(salida, 'resumen.json'), 'w'), indent=1, ensure_ascii=False, default=str)
    return R


def autoprueba():
    """Un día fabricado, con la respuesta sabida antes de correr. Tres TCU y una alarma:
       TCU 1 a +10° va a +55° (45°); TCU 2 a −30° va a −55° (25°); TCU 3 a +40° recibe la
       orden tarde, tras un fallo, y cruza a −55° (95°). 0,2 °/s y 200 J/° en las tres."""
    d = tempfile.mkdtemp(prefix='autoprueba_logs_ncu_')
    base = np.datetime64('2026-01-01T09:50:00', 's')
    f = lambda k: str(base + np.timedelta64(int(k), 's')).replace('T', ' ')
    ev = ['%s;Wind alarm for HSU 1 changed. Enabled: true' % f(600)]
    ev += ['%s;Requesting safe position 1, wind_from_east: 0, for TCU %d. Reason: Request from HSU' % (f(605), n) for n in (1, 2, 3)]
    ev += ['%s;Failed to set the security position for TCU 3' % f(606),
           '%s;Requesting safe position 1, wind_from_east: 0, for TCU 3. Reason: Request from HSU' % f(640),
           '%s;Wind alarm for HSU 1 changed. Enabled: false' % f(1800)]
    ev += ['%s;Requesting safe position 0, wind_from_east: 0, for TCU %d. Reason: Default choice' % (f(1805), n) for n in (1, 2, 3)]
    hsu = ['datetime;main_battery;internal_temp;wind_speed;wind_direction;wind_level;snow_level;irradiance;wind_alarm;gusty_wind_alarm;snow_alarm;snow_sensor_com_error']
    for k in range(0, 2400, 5):
        hsu.append('%s;12000;20;%s;270;0;0;0;false;false;false;false' % (f(k), '16.00' if 570 <= k <= 1700 else ('18.50' if k == 700 else '5.00')))
    hsu[1 + 700 // 5] = '%s;12000;20;18.50;270;0;0;0;false;false;false;false' % f(700)
    cab = 'datetime;main_state;backtracking;wind_from_east;active_security_position;angle;target_angle;soc;remaining_capacity;ps_voltage;ps_current;voltage;current;motor_voltage;motor_current;motor_current_peak;motor_state;motor_pwm;daily_motor_power_consumption;pcb_temp;battery_temp;alarms_1;alarms_2;hw_alarms;system_monitor_status;system_monitor_flags;power_section_alarms'
    z = os.path.join(d, 'NCU01_2026-01-01.zip')
    with zipfile.ZipFile(z, 'w') as zf:
        zf.writestr('NCU_EVENT_LOG_2026-01-01.csv', '\n'.join(ev) + '\n')
        zf.writestr('HSU_230_2026-01-01.csv', '\n'.join(hsu) + '\n')
        for n, a0, obj, t_orden in ((1, 10.0, 55.0, 620), (2, -30.0, -55.0, 620), (3, 40.0, -55.0, 650)):
            filas, ang, J = [cab], a0, 0.0
            for k in range(0, 2400, 10):
                en = t_orden <= k < 1810
                if en:
                    paso = min(2.0, abs(obj - ang)); ang += np.sign(obj - ang) * paso; J += 200 * paso
                filas.append('%s;AUTO;false;false;%d;%.2f;%.2f;80;5000;0;1;26000;-24;0;0;%d;OFF;0;%d;25;25;0;0;0;0;0;0'
                             % (f(k), 1 if en else 0, ang, obj if en else a0, 1500 if en else 0, round(J)))
            zf.writestr('TCU_%03d_2026-01-01.csv' % n, '\n'.join(filas) + '\n')
    R = corre(d, None, procesos=1)
    fallos = []
    def ok(c, m, x=''):
        print(('  ✓ ' if c else '  ✗ ') + m + ('' if c else '  → ' + str(x)))
        if not c:
            fallos.append(m)
    ok(R['alarmas'] == 1 and R['activaciones'] == 3 and R['tcu'] == 3, 'una alarma, tres activaciones, tres TCU', R)
    ok(R['peticiones'] == 7 and R['fallos_peticion'] == 1, 'siete peticiones y un fallo en el registro de eventos', (R['peticiones'], R['fallos_peticion']))
    ok(R['s_alarma_a_peticion']['p50'] == 5, 'de la alarma a la petición, 5 s (la del reintento, 40 s)', R['s_alarma_a_peticion'])
    ok(R['s_alarma_a_tcu_cota']['p50'] == 20 and R['s_alarma_a_tcu_cota']['p99'] > 49, 'la orden llega a los 20 s a dos TCU y a los 50 s a la del fallo', R['s_alarma_a_tcu_cota'])
    ok(R['reintento_s_alarma_a_tcu'] == {'n': 1, 'p50': 50.0, 'p95': 50.0}, 'el reintento se reconoce y tarda 50 s', R['reintento_s_alarma_a_tcu'])
    cb = R['cobertura']
    ok(cb['a_30s'] == {'con': 2, 'de': 3, 'pct': 66.67} and cb['a_60s'] == {'con': 3, 'de': 3, 'pct': 100.0}, 'a los 30 s la tienen 2 de 3 y a los 60 s las 3', cb)
    ok(R['llegan'] == {'de': 3, 'llegan': 3}, 'las tres llegan a ±1° del objetivo', R['llegan'])
    # A 2° por muestra de 10 s y con «llega» = a ±1° del objetivo. TCU 1: orden a los 20 s de la
    # alarma, de 10° a 54° son 22 muestras → 20 + 210 = 230 s. TCU 3: orden a los 50 s, de 40° a
    # −54° son 47 muestras → 50 + 460 = 510 s. La maniobra se mide hasta que llega: 44° y 94°.
    ok(R['s_alarma_a_bandera_por_recorrido']['40-50'] == {'n': 1, 'p50': 230.0, 'p95': 230.0}, 'de +10° a +55°: 230 s desde la alarma', R['s_alarma_a_bandera_por_recorrido'])
    ok(R['s_alarma_a_bandera_por_recorrido']['62-115'] == {'n': 1, 'p50': 510.0, 'p95': 510.0}, 'el cruce de +40° a −55°: 510 s desde la alarma', R['s_alarma_a_bandera_por_recorrido'])
    ok(R['lado'] == {'n': 3, 'al_lado_en_que_esta': 2, 'cruza': 1, 'dias_de_los_cruces': {'2026-01-01': 1}}, 'dos al lado en que ya están y una cruza el plano', R['lado'])
    ok(R['energia_mismo_lado']['n'] == 2 and abs(R['energia_mismo_lado']['J_por_grado']['p50'] - 200) < 1e-6, 'energía al mismo lado: 200 J/°', R['energia_mismo_lado'])
    ok(R['energia_cruzando_el_plano']['n'] == 1 and abs(R['energia_cruzando_el_plano']['Wh']['p50'] - 94 * 200 / 3600) < 0.01, 'y el cruce, 94° × 200 J/° = 5,22 Wh', R['energia_cruzando_el_plano'])
    ok(R['soc_al_empezar']['minimo'] == 80 and R['viento_en_transito_ms']['maximo'] == 18.5, 'SOC al empezar 80 % y viento máximo en tránsito 18,5 m/s (la racha de las 10:01:40)', (R['soc_al_empezar'], R['viento_en_transito_ms']))
    print('\n' + ('✗ %d fallo(s)' % len(fallos) if fallos else '✓ abanderamientos_reales.py cuenta bien un día fabricado'))
    return 1 if fallos else 0


if __name__ == '__main__':
    ap = argparse.ArgumentParser(description='Abanderamientos reales medidos en los logs de las NCU')
    ap.add_argument('--logs'); ap.add_argument('--salida'); ap.add_argument('--filtro'); ap.add_argument('--autoprueba', action='store_true')
    a = ap.parse_args()
    if a.autoprueba:
        sys.exit(autoprueba())
    if not a.logs:
        ap.error('falta --logs <carpeta con los zip de las NCU>')
    if a.salida and os.path.abspath(a.salida).startswith(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))) + os.sep) \
            and 'salida_logs_ncu' not in a.salida:
        sys.exit('la salida lleva datos de planta: escríbela FUERA del repositorio o en salida_logs_ncu/ (ignorada)')
    print(json.dumps(corre(a.logs, a.salida, a.filtro), indent=1, ensure_ascii=False, default=str))
