#!/usr/bin/env node
/* Gate puro del WeatherContract v2 del gemelo. No necesita el repo hermano. */
import * as W from "../sim/weather-contract-adapter.mjs";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
let ok=0,ko=0;
const check=(name,cond,detail="")=>{
  if(cond){ok++;console.log("OK   "+name);}
  else{ko++;console.log("FAIL "+name+(detail?" · "+detail:""));}
};

const pkg={
  schema_version:"2.0.0",contract_id:"wc:test",kind:"historical",
  site:{timezone:"Europe/Madrid"},source:{id:"open_meteo"},
  qa:{dataset_hash:"hash-test"},
  rows:[
    {t:"2024-01-01T00:00:00Z",ghi_wm2:0,dhi_wm2:0,temp_c:1,wind_ms:2,gust_ms:4,precip_mm:0,snowfall_cm:0,cloud_total:null},
    {t:"2024-01-01T01:00:00Z",ghi_wm2:100,dhi_wm2:30,temp_c:2,wind_ms:5,gust_ms:8,precip_mm:1,snowfall_cm:.2,cloud_total:.6},
    {t:"2025-01-01T00:00:00Z",ghi_wm2:50,dhi_wm2:20,temp_c:3,wind_ms:3,gust_ms:6,cloud_total:.4}
  ]
};

const st=W.stamp(pkg,"battery_winter");
check("sello conserva contract_id/hash/TZ",st.contract_id==="wc:test"&&st.dataset_hash==="hash-test"&&st.timezone==="Europe/Madrid");
check("sello declara consumidor",st.consumer==="battery_winter");

const b=W.contractToBattery(pkg,{year:2024});
check("batería filtra el año",b.length===2,String(b.length));
check("batería conserva GHI/viento/racha",b[1].ghi===100&&b[1].wind===5&&b[1].gust===8,JSON.stringify(b[1]));
check("batería conserva identidad del contrato",b.contract.contract_id==="wc:test"&&b.contract.dataset_hash==="hash-test");
check("batería declara WeatherContract",b.source==="weather_contract");
check("años del contrato salen ordenados",JSON.stringify(W.contractYears(pkg))===JSON.stringify([2024,2025]));

const s=W.twinWeatherSnapshot(pkg,"2024-01-01T00:20:00Z",{maxGapMin:45});
check("gemelo toma el instante más cercano",s?.t==="2024-01-01T00:00:00Z",s?.t);
check("gemelo conserva contract_id/hash",s?.contract.contract_id==="wc:test"&&s?.contract.dataset_hash==="hash-test");
check("ausencia cloud_total sigue siendo ausencia",s?.cloud_total===null,String(s?.cloud_total));
check("gemelo rechaza datos fuera de cobertura",W.twinWeatherSnapshot(pkg,"2024-01-02T00:00:00Z",{maxGapMin:45})===null);

const bat=fs.readFileSync(path.join(ROOT,"bateria.html"),"utf8");
const sim=fs.readFileSync(path.join(ROOT,"simulador.html"),"utf8");
check("Batería prefiere WeatherContract",bat.includes('value="contract" selected'));
check("Batería conserva fallback declarado",bat.includes("contractOrFallback")&&bat.includes("open_meteo_fallback"));
check("Gemelo expone forecast/historical compartido",sim.includes('id="meteoTwinMode"')&&sim.includes('value="forecast"')&&sim.includes('value="historical"'));
check("Gemelo no sustituye seguridad HSU",sim.includes("WEATHER alimenta la simulación; CONTROL/HSU decide"));
check("ambas superficies cargan el mismo adapter",bat.includes("weather-contract-adapter.mjs")&&sim.includes("weather-contract-adapter.mjs"));

console.log("");
console.log((ko?"FALLA":"TODO OK")+" — "+ok+" comprobaciones"+(ko?" · "+ko+" fallos":""));
process.exit(ko?1:0);
