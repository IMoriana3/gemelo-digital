"""Lado PYTHON del careo por resultado: corre el MISMO día en el core.

Lo llama `tools/carea_resultado.mjs`. Lee por stdin el volcado del gemelo —sus
entradas y sus salidas, paso a paso— y devuelve por stdout lo que el core saca
con ESAS MISMAS entradas. No inventa meteo: si generase la suya, la diferencia
de meteo contaminaría la del modelo, que es lo que se quiere medir.

El reloj se alinea con el huso que el gemelo DECLARA (`tz` + `dst`), no con un
ajuste: el gemelo lleva hora civil local y el core deriva el sol del timestamp
UTC. Con esa conversión las dos posiciones solares coinciden a 0,064° de media.
"""
import json, sys, numpy as np, pandas as pd

def main():
    """`sys.argv[1]` es la raíz del core. Se inserta a mano en el path en vez de
    fiarlo al cwd: correr pytest desde el sitio equivocado ya me costó 80 fallos
    fantasma una vez hoy, y aquí el error sería mudo (el arnés se saltaría)."""
    if len(sys.argv) > 1:
        sys.path.insert(0, sys.argv[1])
    d = json.load(sys.stdin)
    f, loc, off = d["pasos"], d["loc"], d["utc_offset_h"]
    n = len(f)
    from solargpt_core.tcu_compare import run_tcu_sim, TCU_PRESETS
    dia, h0 = f[0]["dia"], f[0]["hora"]
    base = (pd.Timestamp("2023-01-01", tz="UTC") + pd.Timedelta(days=dia - 1)
            + pd.Timedelta(hours=h0 - off))
    idx = pd.DatetimeIndex([base + pd.Timedelta(minutes=5 * i) for i in range(n)])
    el = np.array([x["el"] or 0.0 for x in f], float)
    bh = np.array([x["bh"] for x in f], float)
    sin_el = np.maximum(np.sin(np.radians(np.maximum(el, 0))), 1e-6)
    df = pd.DataFrame({
        "theta_bt_deg": [x["objetivo"] for x in f],
        "GHI": [x["ghi"] for x in f],
        "DNI": np.where(el > 0, bh / sin_el, 0.0),
        "DHI": [x["dhi"] for x in f],
        "temp_air": [x["tAmb"] for x in f],
        "wind_speed_kmh": [x["viento"] * 3.6 for x in f],
    }, index=idx)
    cfg = dict(TCU_PRESETS[d["preset"]])
    cfg["soc0"] = f[0]["soc"] / 100.0
    out = run_tcu_sim(df, {"lat": loc["lat"], "lon": loc["lon"], "axis_tilt": 0.0,
                           "axis_azimuth": 180.0, "albedo": 0.2}, cfg)
    json.dump({
        "theta": out["theta_exec_deg"].tolist(),
        "poa": out["POA_Target_Wm2"].tolist(),
        "soc": out["SOC_%"].tolist(),
        "carga": out["P_load_W"].tolist(),
        "entrada": out["P_in_W"].tolist(),
        "el_pvlib": (90 - __import__("pvlib").solarposition.get_solarposition(
            idx, loc["lat"], loc["lon"])["apparent_zenith"]).tolist(),
    }, sys.stdout)

if __name__ == "__main__":
    main()
