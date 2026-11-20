/* Factiun · mapa mundial de viabilidad del control TCU.
   Solo presentación/selección: utiliza simulate(), simulaSeguido(), summarize(),
   controlesPara() y los lectores meteo YA existentes en bateria.html.
   No hay otro balance energético ni se publican zonas extrapoladas. */
(function(){
'use strict';
var MV_VERSION='viabilidad-2026-11-20-paridad-v9';
var MV_CUSTOM='bateria_mapa_puntos_v1';
var MV_RESULTS='bateria_mapa_conclusiones_v1';
var MV_COLORS={apto:'#36d399',condicionado:'#e8b451',no_apto:'#e46569',pendiente:'#8392a2'};
var mv={sites:[],selected:null,map:null,markers:{},busy:false,records:{},custom:[],config:null};
/* Una conclusión guardada deja de ser vigente si cambia el motor de la página. */
var MV_ENGINE_HASH=(function(){
  var functions=[simulate,simulaSeguido,summarize,controlesPara,opcionesDe,calculaControlTCU,
                 FISICA.consumoTCU,Abanderamiento.prototype.paso];
  var src=functions.map(function(f){return typeof f==='function'?Function.prototype.toString.call(f):'missing';}).join('|');
  var hash=2166136261;
  for(var i=0;i<src.length;i++){hash^=src.charCodeAt(i);hash=Math.imul(hash,16777619);}
  return (hash>>>0).toString(16);
})();
function e(id){return document.getElementById(id);}
function num(x){if(x==null||String(x).trim()==='')return NaN;var n=Number(String(x).trim().replace(',','.'));return Number.isFinite(n)?n:NaN;}
function coordOK(lat,lon){return Number.isFinite(lat)&&Number.isFinite(lon)&&lat>=-89&&lat<=89&&lon>=-180&&lon<=180;}
function dec(x,d){return Number(x||0).toLocaleString('es-ES',{maximumFractionDigits:d==null?1:d,minimumFractionDigits:0});}
function saved(key,fallback){try{var data=JSON.parse(localStorage.getItem(key));return data&&typeof data==='object'?data:fallback;}catch(_){return fallback;}}
function persist(){try{localStorage.setItem(MV_CUSTOM,JSON.stringify(mv.custom));localStorage.setItem(MV_RESULTS,JSON.stringify(mv.records));}catch(_){}}
function note(s){e('mv-progress').textContent=s;}
function setText(id,s){e(id).textContent=s;}
function statusWord(s){return s==='apto'?'APTO':s==='condicionado'?'CONDICIONADO':s==='no_apto'?'NO APTO':'SIN EVALUACIÓN COMPLETA';}
function statusDot(s){var z=document.createElement('span');z.className='viab-dot viab-dot--'+(s||'pendiente');return z;}
function siteOf(name,lat,lon,id,src){
  return {id:id,n:String(name||'Emplazamiento').trim(),lat:Number(lat),lon:Number(lon),fuente:src||''};
}
function saveCustom(site){
  var at=mv.custom.findIndex(function(x){return x.id===site.id;});
  if(at>=0)mv.custom[at]=site;else mv.custom.push(site);
  if(!mv.sites.some(function(x){return x.id===site.id;}))mv.sites.push(site);
  persist();pin(site);listSites();
}
function getSite(id){return mv.sites.find(function(x){return x.id===id;})||null;}
function isCustom(x){return x&&x.id.indexOf('custom:')===0;}
function cleanName(x){return String(x||'').trim();}
function signature(){
  var p=activeProfile(), page=selectedPageProfile(), isSelected=page&&p&&page.id===p.id&&num(e('panel').value)===num(p.chgW);
  var tmin=isSelected?num(e('tmin').value):p&&p.tCarga?num(p.tCarga[0]):num(e('tmin').value);
  var physics=typeof tocadosFis==='function'?tocadosFis():{};
  /* La página normal arranca en SOC del deslizador en 1 año. El barrido
     30 años usa SOC estacionario por estrategia, no el deslizador. */
  var period=e('mv-period').value;
  var soc0=period==='30'?null:num(e('soc0').value)/100;
  var base={
    motorModel:['factiun','curva'].includes(e('motor').value)?e('motor').value:num(e('motor').value),
    soh:e('aged').checked?SOH_FIN_VIDA:1,
    vientoStow:e('vientoStow').value,
    socTgt:num(e('socTgt').value),socCrit:num(e('socCrit').value),fcDays:num(e('fc').value),
    poaMin:num(e('poaMin').value),tMin:tmin,
    mountTilt:e('mount').value==='fix'?num(e('tilt').value):null,
    strategy:true,winter:e('winter').checked
  };
  /* La validez depende también de la ficha y química, no solo de las funciones:
     cambiar la celda no debe conservar un resultado verde anterior. */
  var specs={profile:p?{id:p.id,wh:p.wh,chgW:p.chgW,string:!!p.string,lt:!!p.lt,
    control:p.control||null,tCarga:p.tCarga,tDescarga:p.tDescarga,sinFicha:!!p.sinFicha}:null,
    physics:typeof FISICA==='object'?FISICA.e:null,
    trackNC:typeof TRACK_N_CO!=='undefined'?TRACK_N_CO:null,
    snowAlarm:typeof SNOW_ALARM_M==='number'?SNOW_ALARM_M:null,
    stowMotor:typeof K_STOW_MOTOR==='number'?K_STOW_MOTOR:null,
    stringFull:typeof POA_STRING_FULL==='number'?POA_STRING_FULL:null};
  return {key:JSON.stringify({v:MV_VERSION,engine:MV_ENGINE_HASH,p:p&&p.id,w:p&&p.chgW,
    period:period,meteo:'ERA5+ERA5-Land',soc0:soc0,base:base,physics:physics,specs:specs}),
    base:base,profile:p,soc0:soc0};
}
function selectedPageProfile(){
  return PROFILES[e('prof').value]||null;
}
function activeProfile(){
  var id=e('mv-profile').value;
  var p=PROFILES.find(function(x){return x.id===id;});
  if(!p)return null;
  return p.string?p:conPanel(p,num(e('mv-panel').value)||p.chgW);
}
function effectiveResult(site){
  if(!site)return null;
  var entries=mv.records[site.id];
  if(!entries)return null;
  var all=Array.isArray(entries)?entries:[entries]; /* compatibilidad con 1ª versión */
  var sig=signature().key;
  /* Un mismo nombre/código de planta con coordenadas cambiadas NO hereda
     un resultado anterior. Las fichas sin localización explícita caducan. */
  return all.find(function(item){return item&&item.sig===sig&&item.site&&
    item.site.lat===site.lat&&item.site.lon===site.lon;})||null;
}
function controlsFor(p){
  return controlesPara(p).filter(function(c){return !c.prof;});
}
function syncControls(){
  var profile=activeProfile();
  var ctrls=profile?controlsFor(profile):[],sel=e('mv-control'),old=sel.value;
  sel.innerHTML='';
  ctrls.forEach(function(c){var o=document.createElement('option');o.value=c.k;o.textContent=c.n;sel.appendChild(o);});
  sel.value=ctrls.some(function(c){return c.k===old;})?old:ctrls.some(function(c){return c.k==='std';})?'std':ctrls[0]?ctrls[0].k:'';
}
function syncPanel(){
  var p=PROFILES.find(function(x){return x.id===e('mv-profile').value;});
  var fld=e('mv-panel-field'),sel=e('mv-panel'),old=num(sel.value);
  if(!p||p.string){fld.hidden=true;sel.innerHTML='';syncControls();return;}
  fld.hidden=false;sel.innerHTML='';
  var opts=Array.from(new Set(PANELES.concat([p.chgW]))).sort(function(a,b){return a-b;});
  opts.forEach(function(w){var o=document.createElement('option');o.value=w;
    o.textContent=w+' W'+(enCatalogo(conPanel(p,w))?' · catálogo':' · estudio');
    sel.appendChild(o);
  });
  sel.value=opts.includes(old)?old:p.chgW;
  syncControls();
}
function mapStatus(site){
  var record=effectiveResult(site);
  if(!record)return 'pendiente';
  var ctl=e('mv-control').value;
  var r=record.results.find(function(x){return x.k===ctl;});
  return r?r.status:'pendiente';
}
function pin(site){
  if(!mv.map||!coordOK(site.lat,site.lon))return;
  var s=mapStatus(site),existing=mv.markers[site.id];
  var style={radius:site.id===(mv.selected&&mv.selected.id)?9:6,weight:site.id===(mv.selected&&mv.selected.id)?3:1.5,
             color:site.id===(mv.selected&&mv.selected.id)?'#f6f0db':'#0f1824',fillColor:MV_COLORS[s],fillOpacity:.95};
  if(existing){existing.setLatLng([site.lat,site.lon]);existing.setStyle(style);return;}
  var mark=L.circleMarker([site.lat,site.lon],style).addTo(mv.map);
  var title=document.createElement('span');title.textContent=site.n;
  mark.bindTooltip(title,{direction:'top',opacity:.95});
  mark.on('click',function(){selectSite(site,true);});
  mv.markers[site.id]=mark;
}
function drawPins(){mv.sites.forEach(pin);}
function selectSite(site,fly){
  if(!site)return;
  mv.selected=site;
  setText('mv-selected',site.n);
  e('mv-name').value=site.n;
  e('mv-lat').value=site.lat;
  e('mv-lon').value=site.lon;
  if(mv.map&&fly)mv.map.setView([site.lat,site.lon],Math.max(mv.map.getZoom(),5),{animate:true});
  drawPins();listSites();renderResult();updateParityButton();
}
function listSites(){
  var search=cleanName(e('mv-search').value).toLocaleLowerCase('es-ES');
  var visible=mv.sites.filter(function(x){return x.n.toLocaleLowerCase('es-ES').includes(search)||
                         (''+x.lat+','+x.lon).includes(search);});
  var host=e('mv-sites');host.replaceChildren();
  setText('mv-count',mv.sites.length+' ubicaciones con coordenadas');
  if(!visible.length){var d=document.createElement('div');d.className='viab-blank';d.textContent='Ninguna ubicación del catálogo coincide. Busca en OpenStreetMap o introduce coordenadas.';host.appendChild(d);}
  visible.slice(0,120).forEach(function(site){
    var b=document.createElement('button');b.type='button';b.className='viab-site';
    b.setAttribute('aria-current',String(!!mv.selected&&mv.selected.id===site.id));
    b.appendChild(statusDot(mapStatus(site)));
    var span=document.createElement('span');span.style.flex='1';span.textContent=site.n;b.appendChild(span);
    var cr=document.createElement('small');cr.textContent=dec(site.lat,3)+', '+dec(site.lon,3);b.appendChild(cr);
    b.onclick=function(){selectSite(site,true);};host.appendChild(b);
  });
  /* La cartera también contiene plantas sin coordenadas: no asignarles
     las del municipio por parecido del nombre. */
  var missingCoord=(typeof SIN_COORD!=='undefined'&&Array.isArray(SIN_COORD)?SIN_COORD:[])
    .filter(function(p){return !search||_rotulo(p).toLocaleLowerCase('es-ES').includes(search);});
  missingCoord.slice(0,20).forEach(function(p){
    var b=document.createElement('button');b.type='button';b.className='viab-site';b.disabled=true;
    b.textContent=_rotulo(p)+' · sin coordenadas de planta';host.appendChild(b);
  });
}
function resultLine(host,name,value){
  var p=document.createElement('div');p.className='viab-stat';
  var b=document.createElement('strong');b.textContent=name+': ';p.appendChild(b);
  p.appendChild(document.createTextNode(value));host.appendChild(p);
}
function renderResult(){
  var site=mv.selected,holder=e('mv-result');
  holder.replaceChildren();
  if(!site){var h=document.createElement('div');h.className='viab-blank';h.textContent='Selecciona una ubicación en el mapa o busca por nombre.';holder.appendChild(h);return;}
  var record=effectiveResult(site),selectedCtrl=e('mv-control').value,choice=record&&record.results.find(function(x){return x.k===selectedCtrl;});
  var coords=document.createElement('p');coords.className='viab-meta';
  coords.textContent='Lat '+site.lat.toFixed(6)+' · Lon '+site.lon.toFixed(6)+
    ' · Coordenadas: '+(site.fuente||'referencia del simulador, sin procedencia adicional');
  holder.appendChild(coords);
  var intro=document.createElement('div');intro.className='viab-brief';intro.dataset.status=choice?choice.status:'pendiente';
  var ttl=document.createElement('span');ttl.className='viab-status';ttl.textContent=choice?statusWord(choice.status):'SIN EVALUAR';intro.appendChild(ttl);
  var desc=document.createElement('div');desc.textContent=choice?choice.conclusion:
    'Este punto todavía no tiene conclusiones para el equipo, periodo y ajustes seleccionados. No se ha inferido su viabilidad por proximidad a otras plantas.';
  intro.appendChild(desc);holder.appendChild(intro);
  if(!record)return;
  var met=document.createElement('p');met.className='viab-meta';
  met.textContent=record.source+' · '+record.yearsOK+'/'+record.yearsAsked+' años completos · '+record.date;
  holder.appendChild(met);
  if(record.missingYears.length){var err=document.createElement('p');err.className='viab-note';err.textContent='Años no disponibles: '+record.missingYears.join(', ')+'. La conclusión no se considera certificada.';holder.appendChild(err);}
  record.results.forEach(function(item){
    var div=document.createElement('section');div.className='viab-outcome';
    var h=document.createElement('div');h.appendChild(statusDot(item.status));var b=document.createElement('b');b.textContent=item.name+' · '+statusWord(item.status);h.appendChild(b);div.appendChild(h);
    resultLine(div,'Conclusión',item.conclusion);
    resultLine(div,'Peor invierno por estrategia',item.worst||'No determinado');
    resultLine(div,'Reserva comprometida (histórico completo)',item.periodosRes+' episodios, '+dec(item.diasRes,0)+' días');
    resultLine(div,'Indisponibilidad (histórico completo)',dec(item.inactivePct,3)+' %; batería agotada '+dec(item.hZero,1)+' h');
    if(item.simulador){
      /* El panel compara estrategias en el PEOR INVIERNO DE LA CONFIGURACIÓN
         PRINCIPAL, no en el peor invierno individual de cada política. */
      resultLine(div,'Invierno del informe del simulador',item.simulador.invierno);
      resultLine(div,'SOC mínimo en ese invierno',dec(item.simulador.socMinPct,4)+' %');
      resultLine(div,'Indisponibilidad en ese invierno',dec(item.simulador.inactivePct,6)+' %');
      resultLine(div,'Batería agotada en ese invierno',dec(item.simulador.hZero,2)+' h');
    }
    resultLine(div,'Protección ambiental','Viento '+dec(item.hStow,0)+' h; nieve '+dec(item.hNieve,0)+' h');
    if(item.limitations.length)resultLine(div,'Limitaciones',item.limitations.join('; '));
    holder.appendChild(div);
  });
}
function parityAvailable(){
  var data=window.BAT_METEO_PARIDAD,s=mv.selected;
  return !!(data&&s&&data.site&&
    data.site.lat===s.lat&&data.site.lon===s.lon&&
    data.period===e('mv-period').value);
}
function updateParityButton(){
  var btn=e('mv-use-same-meteo');
  if(btn)btn.hidden=!parityAvailable();
}
function updateView(){
  if(!mv.map)return;
  drawPins();listSites();renderResult();updateParityButton();
}
function useSameScenarioInSimulator(){
  if(!parityAvailable()){note('Primero calcula el emplazamiento exacto en el mapa.');return;}
  var site=mv.selected,p=activeProfile(),data=window.BAT_METEO_PARIDAD;
  var i=PROFILES.findIndex(function(q){return q.id===e('mv-profile').value;});
  if(i<0||!p)throw new Error('La TCU del mapa ya no existe en el simulador');
  /* La vista principal leerá los MISMOS arrays de meteorología, sin
     descargas. Se conservan sus controles físicos, SOH y estrategia. */
  e('prof').value=String(i);
  e('prof').dispatchEvent(new Event('change'));
  if(!p.string){
    e('panel').value=String(p.chgW);
    e('panel').dispatchEvent(new Event('change'));
  }
  e('loc').value='custom';e('loc').dispatchEvent(new Event('change'));
  e('clat').value=String(site.lat);e('clon').value=String(site.lon);
  e('cname').value=site.n;
  var period=e('mv-period').value;
  e('year').value=period==='30'?'worst':period;
  if(e('year').value!==(period==='30'?'worst':period))
    throw new Error('Año no disponible en el selector de batería');
  if(period==='30')e('sweepFrom').value=String(data.years[0]);
  e('step').value='auto';
  e('cmp').checked=true;
  e('src').value='mapa';e('src').dispatchEvent(new Event('change'));
  e('year').dispatchEvent(new Event('change'));
  e('mv-close').click();
  e('srcTag').textContent='DATOS HORARIOS IDÉNTICOS al mapa: '+site.n+
    ' · '+data.years[0]+'–'+data.years[data.years.length-1]+
    ' · Pulsa Simular para comparar';
  e('run').focus();
}
function addLocation(name,lat,lon){
  if(!coordOK(lat,lon))throw new Error('Introduce coordenadas válidas: latitud −89…89, longitud −180…180.');
  var near=mv.sites.find(function(x){return Math.abs(x.lat-lat)<.000001&&Math.abs(x.lon-lon)<.000001;});
  if(near){selectSite(near,true);return near;}
  var id='custom:'+lat.toFixed(6)+':'+lon.toFixed(6);
  var site=siteOf(name||'Coordenadas '+lat.toFixed(4)+', '+lon.toFixed(4),lat,lon,id,'Coordenadas indicadas por el usuario');
  saveCustom(site);selectSite(site,true);return site;
}
function addFromForm(){
  try{
    var lat=num(String(e('mv-lat').value).replace(',','.')),lon=num(String(e('mv-lon').value).replace(',','.'));
    var item=addLocation(cleanName(e('mv-name').value),lat,lon);
    note('Seleccionado: '+item.n+'. Pulsa «Calcular conclusiones» para evaluar el punto.');
  }catch(err){note(err.message);}
}
function fullYear(m,year){
  if(!m||m.error||!Array.isArray(m))return false;
  var leap=year%4===0&&(year%100!==0||year%400===0),hours=leap?8784:8760;
  if(m.length!==hours)return false;
  if(+m[0].t!==Date.UTC(year,0,1,0)||+m[hours-1].t!==Date.UTC(year+1,0,1,0)-3600000)return false;
  for(var i=1;i<m.length;i++)if(+m[i].t-(+m[i-1].t)!==3600000)return false;
  return true;
}
function searchOnMap(){
  var q=cleanName(e('mv-search').value);if(!q){note('Escribe un nombre para buscar.');return;}
  var host=e('mv-search-remote');host.replaceChildren();note('Buscando '+q+'…');
  fetch('https://nominatim.openstreetmap.org/search?format=json&limit=5&q='+encodeURIComponent(q),{
      headers:{'Accept':'application/json'}
    })
    .then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);return r.json();})
    .then(function(items){
      note(items.length?'Selecciona el lugar correcto. Sus coordenadas se conservarán en tu navegador.':'No se han encontrado lugares. Usa coordenadas.');
      items.forEach(function(item){
        var lat=num(item.lat),lon=num(item.lon);if(!coordOK(lat,lon))return;
        var b=document.createElement('button');b.type='button';b.className='viab-site';
        b.textContent=item.display_name||q;
        b.onclick=function(){addLocation(item.display_name||q,lat,lon);host.replaceChildren();};
        host.appendChild(b);
      });
    }).catch(function(err){note('Búsqueda externa no disponible: '+err.message+'. Puedes introducir las coordenadas.');});
}
async function meteoForSite(site,period){
  /* Siempre meteo local para las coordenadas del punto. Un WeatherContract activo
     puede ser de OTRO emplazamiento: no puede dar un falso mapa verde. */
  var finalYear=new Date().getFullYear()-1;
  var years=period==='30'?Array.from({length:30},function(_,i){return finalYear-29+i;}):[Number(period)];
  /* Misma familia de reanálisis en todos los inviernos. La celda
     meteorológica no equivale a una estación en las coordenadas exactas. */
  var weatherSite=Object.assign({},site,{meteoMode:'era5_hybrid'});
  var list=[];
  for(var i=0;i<years.length;i+=4){
    note('Descargando meteorología del punto · '+Math.min(i+4,years.length)+'/'+years.length+' años…');
    var batch=years.slice(i,i+4);
    var got=await Promise.all(batch.map(function(y){return fetchYearDeclarado(weatherSite,y);}));
    list.push.apply(list,got);
  }
  var missing=[],ok=0,qa={sin_irradiancia:0,sin_temperatura:0,sin_viento:0};
  list.forEach(function(m,i){
    if(!fullYear(m,years[i])){missing.push(years[i]);list[i]={error:'año incompleto'};}
    else{
      ok++;
      if(m.mapaQA)Object.keys(qa).forEach(function(k){qa[k]+=Number(m.mapaQA[k])||0;});
      else qa.sin_irradiancia++; /* Sin metadatos: la fuente queda sin certificar */
    }
  });
  var tramos=tramosContinuos(list,years);
  if(!tramos.length)throw new Error('No hay años completos de meteorología en este punto.');
  return {years:years,list:list,tramos:tramos,missing:missing,ok:ok,qa:qa,source:'Open-Meteo histórico · ERA5 (irradiancia, viento y ráfaga) + ERA5-Land (temperatura y nieve)'};
}
function outcome(S,c,met,opts,worst,profile,thermal,modelBad,snowPresenceHours){
  var issues=[];
  /* Fail-closed: un NaN o Infinity daría APTO con comparaciones «> 0». */
  var metricas=['reservaWh','margenMin','periodosRes','diasRes','hBajoReserva',
    'socMin','hZero','hStow','hNieve','hSinRacha','hSinNieve','inactivePct'];
  var invalidSummary=metricas.some(function(k){return !Number.isFinite(S[k]);}) ||
    S.socMin<0||S.socMin>1||S.inactivePct<0||S.inactivePct>100||
    ['periodosRes','diasRes','hBajoReserva','hZero','hStow','hNieve','hSinRacha','hSinNieve']
      .some(function(k){return S[k]<0;});
  var invalidThermal=!thermal||!Number.isFinite(thermal.min)||
    !Number.isFinite(thermal.max)||thermal.min>thermal.max;
  if(invalidSummary)issues.push('indicadores de disponibilidad incompletos o no finitos');
  if(invalidThermal)issues.push('temperatura de celda no verificable');
  if(modelBad>0)issues.push('salida física inconsistente: '+modelBad+' registros');
  if(Number.isFinite(met.ok)&&met.ok!==met.years.length)
    issues.push('número de años verificados distinto del solicitado');
  if(met.missing.length)issues.push('años sin meteorología');
  if(met.qa.sin_irradiancia)issues.push('irradiancia incompleta: '+met.qa.sin_irradiancia+' registros');
  if(met.qa.sin_temperatura)issues.push('temperatura incompleta: '+met.qa.sin_temperatura+' registros');
  if(met.qa.sin_viento)issues.push('viento incompleto: '+met.qa.sin_viento+' registros');
  if(S.hSinRacha>0&&opts.vientoStow!=='media')issues.push('faltan ráfagas en parte del periodo');
  if(opts.vientoStow==='media')issues.push('abanderamiento calculado con viento medio, no racha');
  if(S.hSinNieve>0)issues.push('faltan datos de profundidad de nieve');
  if(met.years.length===1)issues.push('solo un año histórico');
  if(profile.sinFicha||(!profile.string&&!enCatalogo(profile)))
    issues.push('combinación de estudio o sin ficha comercial');
  if(profile.tDescarga&&(
       Number.isFinite(profile.tDescarga[0])&&thermal.min<profile.tDescarga[0]||
       Number.isFinite(profile.tDescarga[1])&&thermal.max>profile.tDescarga[1]))
    issues.push('temperaturas fuera de los límites de descarga declarados en la ficha');
  if(profile.tCarga&&Number.isFinite(profile.tCarga[1])&&thermal.max>profile.tCarga[1])
    issues.push('se alcanzan temperaturas fuera del límite superior de carga; revisar inhibiciones del modelo');
  /* La nieve del reanálisis es manto en el SUELO. El simulador sí ejecuta
     SP3, pero no valida cuánta nieve tapa el mini-panel ni el incremento de
     par aerodinámico real. Estos casos son CONDICIONADOS, no falsos verdes. */
  var physicalWarnings=[];
  if(snowPresenceHours>0)physicalWarnings.push(
    'nieve en suelo: falta validar la cobertura y recarga del panel auxiliar/string');
  if(S.hStow>0)physicalWarnings.push(
    'maniobras de viento: par aerodinámico del motor no caracterizado en campo');
  var status='pendiente',conclusion='';
  var datosCriticos=invalidSummary||invalidThermal||modelBad>0||
    (Number.isFinite(met.ok)&&met.ok!==met.years.length)||
    met.qa.sin_irradiancia||met.qa.sin_temperatura||met.qa.sin_viento||
    profile.tDescarga&&(thermal.min<profile.tDescarga[0]||Number.isFinite(profile.tDescarga[1])&&thermal.max>profile.tDescarga[1])||
    profile.tCarga&&Number.isFinite(profile.tCarga[1])&&thermal.max>profile.tCarga[1];
  if(datosCriticos){
    status='pendiente';
    conclusion='Faltan datos verificables o la salida del modelo no es físicamente válida. No se emite veredicto.';
  }else if(S.hZero>0){
    status='no_apto';
    conclusion='El equipo se queda sin batería durante '+dec(S.hZero,1)+' h; no se puede garantizar la maniobra de seguridad.';
  }else if(issues.length){
    status='pendiente';
    conclusion='No se puede confirmar la viabilidad con los datos disponibles.';
    if(S.periodosRes>0||S.inactivePct>0)conclusion+=' Hay episodios con reserva comprometida o seguimiento detenido.';
  }else if(S.periodosRes>0||S.inactivePct>0||c.k==='none'||physicalWarnings.length){
    status='condicionado';
    conclusion=c.k==='none'
      ?'La simulación no agota la batería, pero esta referencia carece de protección por SOC. No se considera una estrategia de seguridad validada.'
      :S.periodosRes>0||S.inactivePct>0
      ?'No se agota la batería, pero se compromete la reserva o el seguimiento durante el periodo evaluado.'
      :'La disponibilidad energética simulada supera el histórico, pero hay efectos físicos de viento o nieve que requieren validación adicional.';
  }else{
    status='apto';
    conclusion='Mantiene la reserva y no registra indisponibilidad por batería durante el histórico evaluado. Las maniobras de viento y nieve se contabilizan por separado.';
  }
  return {k:c.k,name:c.n,status:status,conclusion:conclusion,worst:worst,
    periodosRes:S.periodosRes,diasRes:S.diasRes,inactivePct:S.inactivePct,
    hZero:S.hZero,hStow:S.hStow,hNieve:S.hNieve,limitations:issues.concat(physicalWarnings)};
}
function pause(){return new Promise(function(resolve){setTimeout(resolve,0);});}
async function evaluateSite(){
  if(mv.busy)return;
  var site=mv.selected;
  if(!site){note('Selecciona un emplazamiento.');return;}
  var cfg=signature(),profile=cfg.profile;
  if(!profile){note('Selecciona una TCU.');return;}
  var period=e('mv-period').value, controls=controlsFor(profile);
  if(!controls.length){note('Este perfil no tiene estrategia disponible.');return;}
  var btn=e('mv-evaluate');btn.disabled=true;mv.busy=true;
  try{
    /* Una evaluación nueva invalida el enlace a datos de una evaluación
       anterior; nunca se ofrece equivalencia tras una descarga fallida. */
    window.BAT_METEO_PARIDAD=null;
    var met=await meteoForSite(site,period),rows,results=[],snowPresenceHours=0;
    /* Mismo criterio del informe de batería: el peor invierno se elige
       usando la configuración base, no cada estrategia por separado. */
    var periodoInforme=null;
    if(met.years.length>1){
      var baseRows=simulaSeguido(met.tramos,profile,site,cfg.base);
      var invBase=resumenInviernos(baseRows);
      periodoInforme=invBase.length?peorInvierno(invBase):null;
      baseRows=null;
    }
    /* El riesgo sobre el panel existe incluso con menos de 3 cm: SP3 sólo
       dispara a partir de ese umbral, pero una película de nieve puede tapar
       el panel de alimentación. Se avisa sin inventar su transmisión óptica. */
    met.tramos.forEach(function(tr){
      tr.meteo.forEach(function(m){if(Number.isFinite(m.snowDepth)&&m.snowDepth>0)snowPresenceHours++;});
    });
    for(var j=0;j<controls.length;j++){
      var control=controls[j],derived=opcionesDe(control,profile,cfg.base);
      note('Evaluando '+site.n+' · '+control.n+' ('+(j+1)+'/'+controls.length+')…');
      await pause();
      /* MISMA FUNCIÓN que usa runControls en el simulador principal. Se prohíbe
         una segunda decisión de SOC inicial, perfil o política en el mapa. */
      var result=calculaControlTCU(
        met.years.length>1?met.tramos:met.tramos[0].meteo,
        profile,site,cfg.base,control,
        met.years.length>1?{seguido:true}:{soc0:cfg.soc0});
      rows=result.rows;
      if(!rows||!rows.length)throw new Error('El simulador no devolvió datos para '+control.n);
      var s=result.S,win=null;
      var tmin=Infinity,tmax=-Infinity,modelBad=0;
       for(var ti=0;ti<rows.length;ti++){
         var r=rows[ti],tc=r.tCell;
         if(Number.isFinite(tc)){tmin=Math.min(tmin,tc);tmax=Math.max(tmax,tc);}
         if(!Number.isFinite(r.soc)||r.soc<0||r.soc>1||
            !Number.isFinite(r.eLib)||!Number.isFinite(tc)||
            !Number.isFinite(r.chg)||r.chg<0||
            !Number.isFinite(r.base)||r.base<0||
            !Number.isFinite(r.motor)||r.motor<0||
            !Number.isFinite(r.ghi)||!Number.isFinite(r.temp)||
            !Number.isFinite(r.wind)||![0,1,2].includes(r.vf)||
            typeof r.nd!=='boolean')modelBad++;
       }
      if(met.years.length>1){var inv=resumenInviernos(rows);win=inv.length?peorInvierno(inv).label:null;}
      else win=String(met.years[0]);
      var item=outcome(s,control,met,derived.o,win,derived.p,{min:tmin,max:tmax},modelBad,snowPresenceHours);
      if(periodoInforme){
        var sr=summarize(recorta(rows,periodoInforme.i0,periodoInforme.i1));
        item.simulador={invierno:periodoInforme.label,socMinPct:sr.socMin*100,
          inactivePct:sr.inactivePct,hZero:sr.hZero};
      }else{
        item.simulador={invierno:String(met.years[0]),socMinPct:s.socMin*100,
          inactivePct:s.inactivePct,hZero:s.hZero};
      }
      results.push(item);rows=null;
    }
    var record={sig:cfg.key,site:{lat:site.lat,lon:site.lon},
      source:met.source,yearsOK:met.ok,yearsAsked:met.years.length,
      missingYears:met.missing,results:results,date:new Date().toLocaleString('es-ES')};
    var entries=mv.records[site.id],all=Array.isArray(entries)?entries:(entries?[entries]:[]);
    var previous=all.findIndex(function(item){return item.sig===record.sig&&
      item.site&&item.site.lat===site.lat&&item.site.lon===site.lon;});
    if(previous>=0)all.splice(previous,1);
    all.push(record);
    /* Varias TCUs por ubicación, pero solo resúmenes: nunca las 262.800 filas */
    mv.records[site.id]=all.slice(-32);
    persist();
    /* Guardamos SOLO las referencias a las mismas series, una ubicación a la
       vez. El simulador podrá reutilizarlas byte a byte en esta sesión. */
    if(met.missing.length===0){
      window.BAT_METEO_PARIDAD={site:{lat:site.lat,lon:site.lon},
        years:met.years.slice(),list:met.list,period:period,source:met.source};
    }
    updateView();
    note('Evaluación terminada para '+site.n+'. Los resultados proceden del simulador de batería.');
  }catch(err){
    /* Si el usuario pide recalcular y falla la fuente o el motor, no dejamos
       el antiguo verde bajo la misma firma como si fuera un nuevo resultado.
       Otras TCUs, estrategias y emplazamientos permanecen intactos. */
    var prev=mv.records[site.id];
    if(prev){
      var all=Array.isArray(prev)?prev:[prev];
      var keep=all.filter(function(x){return x&&x.sig!==cfg.key;});
      if(keep.length)mv.records[site.id]=keep;
      else delete mv.records[site.id];
      persist();updateView();
    }
    note('No se ha asignado viabilidad: '+String(err&&err.message||err));
  }finally{mv.busy=false;btn.disabled=false;}
}
function initialize(){
  var button=e('mv-open');if(!button||typeof L==='undefined'||typeof LOCS==='undefined')return;
  var all=(Array.isArray(LOCS)?LOCS:[]);
  all.forEach(function(p,i){if(coordOK(num(p.lat),num(p.lon)))
    mv.sites.push(siteOf(p.n,p.lat,p.lon,'portfolio:'+i,p.fuente||''));});
  mv.custom=saved(MV_CUSTOM,[]);
  if(!Array.isArray(mv.custom))mv.custom=[];
  mv.custom=mv.custom.filter(function(s){return s&&typeof s.id==='string'&&isCustom(s)&&coordOK(num(s.lat),num(s.lon));});
  mv.custom.forEach(function(s){if(!mv.sites.some(function(x){return x.id===s.id;}))mv.sites.push(s);});
  mv.records=saved(MV_RESULTS,{});if(Array.isArray(mv.records))mv.records={};
  var root=document.createElement('section');root.id='mv-root';root.className='viab-overlay';
  root.hidden=true;root.setAttribute('role','dialog');root.setAttribute('aria-modal','true');
  root.setAttribute('aria-labelledby','mv-title');
  root.innerHTML=[
    '<div class="viab-frame">',
      '<header class="viab-head"><h2 id="mv-title">Mapa mundial · viabilidad TCU</h2>',
      '<span class="viab-sub">Conclusiones por emplazamiento, sin fórmulas ni interpolaciones</span>',
      '<span class="viab-spacer"></span><button class="viab-close" id="mv-close" type="button">Cerrar</button></header>',
      '<div class="viab-grid">',
       '<aside class="viab-panel viab-panel--left">',
        '<div class="viab-field"><label for="mv-search">Seleccionar por nombre</label><input id="mv-search" type="search" placeholder="Planta, ciudad o número de proyecto">',
        '<button class="viab-act viab-secondary" id="mv-geosearch" type="button">Buscar lugar fuera del catálogo</button>',
        '<div class="viab-search-results viab-list" id="mv-search-remote"></div></div>',
        '<div class="viab-field"><label>Seleccionar por coordenadas (o pulsar el mapa)</label>',
          '<div class="viab-pair"><input id="mv-lat" type="text" inputmode="decimal" aria-label="Latitud" placeholder="Latitud">',
          '<input id="mv-lon" type="text" inputmode="decimal" aria-label="Longitud" placeholder="Longitud"></div>',
          '<input style="margin-top:6px" id="mv-name" type="text" placeholder="Nombre del emplazamiento" aria-label="Nombre">',
          '<button class="viab-act viab-secondary" id="mv-add" type="button">Añadir / seleccionar ubicación</button></div>',
        '<h3 class="viab-section">Escenario de la TCU</h3>',
        '<div class="viab-field"><label for="mv-profile">Equipo</label><select id="mv-profile"></select></div>',
        '<div class="viab-field" id="mv-panel-field"><label for="mv-panel">Panel</label><select id="mv-panel"></select></div>',
        '<div class="viab-field"><label for="mv-control">Control mostrado en el mapa</label><select id="mv-control"></select></div>',
        '<div class="viab-field"><label for="mv-period">Histórico meteorológico</label><select id="mv-period"></select></div>',
        '<button class="viab-act" id="mv-evaluate" type="button">Calcular conclusiones del punto</button>',
        '<button class="viab-act viab-secondary" id="mv-use-same-meteo" type="button" hidden>Usar mismos datos en el simulador</button>',
        '<p class="viab-progress" id="mv-progress" role="status">Selecciona un punto y evalúalo.</p>',
        '<h3 class="viab-section">Emplazamientos</h3><p class="viab-meta" id="mv-count"></p>',
        '<div class="viab-list" id="mv-sites"></div>',
       '</aside>',
       '<div class="viab-map-shell"><div id="viab-map" aria-label="Mapa mundial de emplazamientos"></div>',
       '<div class="viab-map-hint">Pulsa un marcador para abrir la ficha; pulsa el mapa para elegir nuevas coordenadas</div></div>',
       '<aside class="viab-panel viab-panel--right">',
        '<div class="viab-legend"><span><i class="viab-dot viab-dot--apto"></i>Apto</span>',
         '<span><i class="viab-dot viab-dot--condicionado"></i>Condicionado</span>',
         '<span><i class="viab-dot viab-dot--no_apto"></i>No apto</span>',
         '<span><i class="viab-dot viab-dot--pendiente"></i>Sin evaluación completa</span></div>',
        '<h3 id="mv-selected" class="viab-picked">Selecciona un emplazamiento</h3>',
        '<div id="mv-result"></div>',
       '</aside>',
      '</div>',
      '<footer class="viab-footer">Origen del cálculo: simulador de batería de Factiun · meteo Open-Meteo histórica del punto exacto · sin veredicto automático por proximidad. Un resultado energético no sustituye las comprobaciones estructurales.</footer>',
    '</div>'
  ].join('');
  document.body.appendChild(root);
  PROFILES.forEach(function(p){if(!p.variante){
    var o=document.createElement('option');o.value=p.id;o.textContent=(p.comercial||p.n)+(p.sinFicha?' · sin ficha comercial':'');e('mv-profile').appendChild(o);
  }});
  var active=selectedPageProfile();
  if(active)e('mv-profile').value=active.id;
  syncPanel();
  e('mv-panel').value=e('panel').value;
  syncControls();
  var year=new Date().getFullYear()-1,period=e('mv-period');
  period.add(new Option('30 años seguidos · estudio de viabilidad','30'));
  for(var y=year;y>=year-10;y--)period.add(new Option(y+' · comprobación preliminar (1 año)',String(y)));
  period.value='30';
  mv.map=L.map('viab-map',{worldCopyJump:true,zoomControl:true}).setView([20,0],2);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    {maxZoom:18,attribution:'© OpenStreetMap contributors',className:'osm-oscuro'}).addTo(mv.map);
  mv.map.on('click',function(ev){
    e('mv-lat').value=ev.latlng.lat.toFixed(6);
    e('mv-lon').value=ev.latlng.lng.toFixed(6);
    e('mv-name').value='Coordenadas '+ev.latlng.lat.toFixed(3)+', '+ev.latlng.lng.toFixed(3);
    note('Coordenadas seleccionadas. Pulsa «Añadir / seleccionar ubicación» para guardar el punto.');
  });
  e('mv-close').onclick=function(){root.hidden=true;document.body.style.overflow='';button.focus();};
  button.onclick=function(){
    root.hidden=false;document.body.style.overflow='hidden';
    setTimeout(function(){mv.map.invalidateSize();},50);
    if(!mv.selected){var loc=typeof getLoc==='function'?getLoc():null;
      var same=loc&&mv.sites.find(function(s){return Math.abs(s.lat-loc.lat)<.000001&&Math.abs(s.lon-loc.lon)<.000001;});
      if(same)selectSite(same,true);
      else if(loc&&e('loc').value==='custom'&&coordOK(num(loc.lat),num(loc.lon)))
        addLocation(loc.n,loc.lat,loc.lon);
      else selectSite(mv.sites[0],false);
    }else updateView();
  };
  root.addEventListener('keydown',function(ev){if(ev.key==='Escape'&&!mv.busy){root.hidden=true;document.body.style.overflow='';button.focus();}});
  e('mv-add').onclick=addFromForm;
  e('mv-search').oninput=listSites;
  e('mv-search').onkeydown=function(ev){if(ev.key==='Enter'){
    ev.preventDefault();
    var query=cleanName(e('mv-search').value).toLocaleLowerCase('es-ES');
    var site=mv.sites.find(function(s){return s.n.toLocaleLowerCase('es-ES').includes(query);});
    if(site)selectSite(site,true);else searchOnMap();
  }};
  e('mv-geosearch').onclick=searchOnMap;
  e('mv-profile').onchange=function(){syncPanel();updateView();};
  e('mv-panel').onchange=function(){syncControls();updateView();};
  e('mv-control').onchange=updateView;
  e('mv-period').onchange=updateView;
  e('mv-evaluate').onclick=evaluateSite;
  e('mv-use-same-meteo').onclick=useSameScenarioInSimulator;
  var nasButton=document.createElement('button');nasButton.id='mv-nas-submit';
  nasButton.type='button';nasButton.className='viab-act viab-secondary';
  nasButton.textContent='Enviar cálculo al NAS';nasButton.hidden=true;
  nasButton.onclick=sendToNAS;e('mv-evaluate').after(nasButton);
  drawPins();listSites();renderResult();
  refreshNAS();
  setInterval(function(){if(!root.hidden)refreshNAS();},20000);
}

if(typeof window!=='undefined')window.FACTIUN_MAPA_NAS={
  async run(job){
    var src=job.site||{},site=siteOf(src.n,src.lat,src.lon,src.id,src.fuente);
    if(!coordOK(site.lat,site.lon))throw new Error('Coordenadas NAS inválidas');
    var p=PROFILES.find(function(x){return x.id===job.profileId;});
    if(!p)throw new Error('Perfil NAS no presente en batería');
    var selected=p.variante?PROFILES.find(function(x){
      return !x.variante&&x.wh===p.wh&&!!x.string===!!p.string&&!!x.lt===!!p.lt;
    }):p;
    if(!selected)throw new Error('No existe perfil equivalente visible');
    if(!mv.sites.some(function(x){return x.id===site.id;}))mv.sites.push(site);
    selectSite(site,false);
    /* El panel principal y el mapa DEBEN apuntar al mismo hardware antes
       de aplicar overrides: la firma deriva tMin del perfil seleccionado. */
    var pageIdx=PROFILES.indexOf(selected);
    if(pageIdx<0)throw new Error('El perfil no existe en batería.html');
    e('prof').value=String(pageIdx);
    e('prof').dispatchEvent(new Event('change'));
    e('mv-profile').value=selected.id;syncPanel();
    if(!p.string){
      var w=String(job.panelW||p.chgW);
      e('panel').value=w;
      e('panel').dispatchEvent(new Event('change'));
      e('mv-panel').value=w;
      if(!e('mv-panel').value||e('panel').value!==w)
        throw new Error('Panel NAS no ofertado en los dos selectores');
    }
    syncControls();e('mv-period').value=String(job.period||'30');
    if(!e('mv-period').value)throw new Error('Periodo NAS no reconocido');
    /* Un trabajo de UI conserva todo el escenario, incluidos los parámetros
       físicos modificados. Si el firmware o el formulario no puede reproducirlo,
       no se calculan ni publican conclusiones. */
    if(job.scenario){
      var sc=job.scenario;
      if(sc.strategy!==true)throw new Error('Política no compatible con el mapa');
      if(sc.soh!==1&&sc.soh!==SOH_FIN_VIDA)
        throw new Error('SOH solicitado no disponible en batería.html');
      e('aged').checked=sc.soh===SOH_FIN_VIDA;
      e('motor').value=String(sc.motorModel);
      e('vientoStow').value=sc.vientoStow;
      e('socTgt').value=String(sc.socTgt);
      e('socCrit').value=String(sc.socCrit);
      e('fc').value=String(sc.fcDays);
      e('tmin').value=String(sc.tMin);
      e('poaMin').value=String(sc.poaMin);
      e('mount').value=sc.mountTilt==null?'trk':'fix';
      if(sc.mountTilt!=null)e('tilt').value=String(sc.mountTilt);
      e('winter').checked=sc.winter;
      if(sc.soc0!=null)e('soc0').value=String(sc.soc0*100);
      for(var key of Object.keys(sc.physics)){
        if(!PARAMS_FIS.some(function(v){return v.k===key;}))
          throw new Error('Parámetro físico ajeno al simulador: '+key);
        if(!Number.isFinite(sc.physics[key]))
          throw new Error('Parámetro físico no finito: '+key);
        window[key]=sc.physics[key];
      }
    }
    if(job.signature&&signature().key!==job.signature)
      throw new Error('Diferencia de configuración NAS/visor: trabajo rechazado');
    await evaluateSite();
    var result=effectiveResult(site);
    if(!result)throw new Error(e('mv-progress').textContent||'Sin resultado');
    if(job.signature&&result.sig!==job.signature)
      throw new Error('Diferencia de firma al terminar: resultado descartado');
    return result;
  }
};
async function refreshNAS(){
  try{
    var response=await fetch('/api/mapa/snapshot',{cache:'no-store'});
    if(!response.ok)return;
    var data=await response.json();
    if(!data||!data.ok||!Array.isArray(data.items))return;
    var changed=false;
    data.items.forEach(function(item){
      var s=item.site,r=item.record;
      if(!s||!r||!r.sig||!coordOK(Number(s.lat),Number(s.lon)))return;
      if(!mv.sites.some(function(x){return x.id===s.id;})){
        mv.sites.push(siteOf(s.n,s.lat,s.lon,s.id,s.fuente));changed=true;
      }
      var entries=mv.records[s.id],all=Array.isArray(entries)?entries:(entries?[entries]:[]);
      if(!all.some(function(x){return x.sig===r.sig&&x.site&&
        x.site.lat===Number(s.lat)&&x.site.lon===Number(s.lon);})){
        all.push(r);mv.records[s.id]=all.slice(-32);changed=true;
      }
    });
    if(changed)updateView();
    mv.nasOnline=true;
    e('mv-evaluate').hidden=true; // Cálculo largo y descargas, exclusivamente en NAS
    if(e('mv-nas-submit')){
      var st=await fetch('/api/mapa/health',{cache:'no-store'});
      if(st.ok){
        var health=await st.json();
        e('mv-nas-submit').hidden=!health.puede_encolar;
      }
    }
  }catch(_){/* Fuera de NAS se conserva el modo normal del simulador. */}
}
async function sendToNAS(){
  if(!mv.selected){note('Selecciona antes un emplazamiento.');return;}
  if(!mv.nasToken)mv.nasToken=window.prompt('Clave privada del NAS (solo esta sesión):')||'';
  if(!mv.nasToken)return;
  var p=activeProfile();
  try{
    var config=signature(),physics={};
    var mods=typeof tocadosFis==='function'?tocadosFis():{};
    for(var key of Object.keys(mods))physics[key]=mods[key].ahora;
    var scenario=Object.assign({},config.base,{soc0:config.soc0,physics:physics});
    var resp=await fetch('/api/mapa/jobs',{
      method:'POST',headers:{'content-type':'application/json','x-factiun-token':mv.nasToken},
      body:JSON.stringify({site:mv.selected,profileId:e('mv-profile').value,
        period:e('mv-period').value,panelW:p&&!p.string?p.chgW:null,
        scenario:scenario,signature:config.key})
    });
    var j=await resp.json();
    if(!resp.ok){if(resp.status===403)mv.nasToken='';throw new Error(j.error||'No autorizado');}
    note('Trabajo NAS '+j.id+' · '+(j.already||'en cola')+'. El marcador se actualizará al recibir conclusiones.');
  }catch(err){note('No se ha encolado: '+err.message);}
}

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initialize,{once:true});
else initialize();
})();
