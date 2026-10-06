/* Factiun · WeatherContract v2 consumer for battery / winter / twin.
   The authority is the Weather Workbench in /proyectos.
*/
let _api=null;
export async function weatherContractApi(){
  if(_api)return _api;
  const candidates=[
    "/proyectos/lib/weather-contract.js",
    "https://imoriana3.github.io/proyectos/lib/weather-contract.js"
  ];
  let last=null;
  for(const url of candidates){
    try{_api=await import(url);return _api;}catch(e){last=e;}
  }
  throw last||new Error("WeatherContract API unavailable");
}
export async function loadActiveContract(kind){
  const api=await weatherContractApi();
  return api.loadActiveWeatherContract(kind);
}
export function stamp(pkg,consumer){
  return {
    consumer,contract_version:pkg?.schema_version||null,
    contract_id:pkg?.contract_id||null,dataset_hash:pkg?.qa?.dataset_hash||null,
    source_id:pkg?.source?.id||null,timezone:pkg?.site?.timezone||pkg?.temporal?.timezone||null,
    rows:pkg?.rows?.length||0
  };
}
function finite(v,dflt){
  const n=Number(v);return Number.isFinite(n)?n:dflt;
}
export function contractToBattery(pkg,{year=null}={}){
  if(!pkg||pkg.schema_version!=="2.0.0"||!Array.isArray(pkg.rows))
    throw new Error("WeatherContract v2 inválido");
  let rows=pkg.rows;
  if(year!=null&&year!=="worst"){
    const y=+year;rows=rows.filter(r=>new Date(r.t).getUTCFullYear()===y);
  }
  if(!rows.length)throw new Error("WeatherContract no cubre el periodo solicitado");
  const out=rows.map(r=>({
    t:new Date(r.t),
    ghi:Math.max(0,finite(r.ghi_wm2,0)),
    dhi:Math.max(0,finite(r.dhi_wm2,0)),
    temp:finite(r.temp_c,15),
    wind:Math.max(0,finite(r.wind_ms,0)),
    gust:Math.max(0,finite(r.gust_ms,0)),
    precip:Math.max(0,finite(r.precip_mm,0)),
    snow:Math.max(0,finite(r.snowfall_cm,0))
  }));
  out.contract=stamp(pkg,"battery_winter");
  out.source="weather_contract";
  return out;
}
export async function loadBatteryContract({kind="historical",year=null}={}){
  const pkg=await loadActiveContract(kind);
  if(!pkg)throw new Error("sin WeatherContract "+kind+" activo");
  return {pkg,meteo:contractToBattery(pkg,{year})};
}
export function contractYears(pkg){
  if(!pkg?.rows)return [];
  return [...new Set(pkg.rows.map(r=>new Date(r.t).getUTCFullYear()).filter(Number.isFinite))].sort((a,b)=>a-b);
}
export function twinWeatherSnapshot(pkg,at,{maxGapMin=180}={}){
  if(!pkg?.rows?.length)return null;
  const t=Date.parse(at||new Date());
  let best=pkg.rows[0],d=Math.abs(Date.parse(best.t)-t);
  for(const r of pkg.rows){
    const x=Math.abs(Date.parse(r.t)-t);if(x<d){best=r;d=x;}
  }
  if(Number.isFinite(maxGapMin)&&d>maxGapMin*60000)return null;
  return {
    t:best.t,gap_min:d/60000,
    ghi_wm2:finite(best.ghi_wm2,null),dni_wm2:finite(best.dni_wm2,null),
    dhi_wm2:finite(best.dhi_wm2,null),temp_c:finite(best.temp_c,null),
    wind_ms:finite(best.wind_ms,null),wind_dir_deg:finite(best.wind_dir_deg,null),
    gust_ms:finite(best.gust_ms,null),precip_mm:finite(best.precip_mm,null),
    snowfall_cm:finite(best.snowfall_cm,null),snow_depth_m:finite(best.snow_depth_m,null),
    cloud_total:finite(best.cloud_total,null),cape_jkg:finite(best.cape_jkg,null),
    contract:stamp(pkg,"digital_twin")
  };
}
