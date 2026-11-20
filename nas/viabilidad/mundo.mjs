/* FACTIUN / Cobertura terrestre global.
 * No calcula SOC ni interpola viabilidad. Sólo construye nodos de muestreo
 * geográfico con procedencia Natural Earth. Los resultados de batería
 * se obtienen EXCLUSIVAMENTE desde bateria.html.
 */
const EPS=1e-10;
export const WORLD_LEVELS=[5,2,1];
export function inRing(x,y,ring){
  let inside=false;
  for(let i=0,j=ring.length-1;i<ring.length;j=i++){
    const a=ring[i],b=ring[j];
    if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])
      inside=!inside;
  }
  return inside;
}
export function inPolygon(x,y,rings){
  return rings.length>0&&inRing(x,y,rings[0])&&
    !rings.slice(1).some(r=>inRing(x,y,r));
}
export function inLand(x,y,geo){
  const features=geo.type==='FeatureCollection'?geo.features:
    [{geometry:geo.geometry||geo}];
  return features.some(f=>{
    const g=f.geometry;if(!g)return false;
    if(g.type==='Polygon')return inPolygon(x,y,g.coordinates);
    if(g.type==='MultiPolygon')return g.coordinates.some(p=>inPolygon(x,y,p));
    return false;
  });
}
function bounds(ring){
  let xmin=Infinity,xmax=-Infinity,ymin=Infinity,ymax=-Infinity;
  for(const p of ring){
    xmin=Math.min(xmin,p[0]);xmax=Math.max(xmax,p[0]);
    ymin=Math.min(ymin,p[1]);ymax=Math.max(ymax,p[1]);
  }
  return {xmin,xmax,ymin,ymax};
}
export function geometries(geo){
  if(!geo||!['FeatureCollection','Feature','Polygon','MultiPolygon'].includes(geo.type))
    throw Error('Máscara terrestre inválida');
  const features=geo.type==='FeatureCollection'?geo.features:
    geo.type==='Feature'?[geo]:[{geometry:geo}];
  const polys=[];
  for(const feature of features){
    const g=feature.geometry;if(!g)continue;
    const parts=g.type==='Polygon'?[g.coordinates]:
      g.type==='MultiPolygon'?g.coordinates:[];
    for(const rings of parts){
      if(!Array.isArray(rings)||!rings.length||rings[0].length<4)continue;
      polys.push({rings,bb:bounds(rings[0])});
    }
  }
  if(!polys.length)throw Error('Máscara terrestre sin polígonos');
  return polys;
}
function insideCell(x,y,c){
  return x>=c.xmin-EPS&&x<=c.xmax+EPS&&
    y>=c.ymin-EPS&&y<=c.ymax+EPS&&Math.abs(y)<90;
}
function pointIn(x,y,p,c){
  return insideCell(x,y,c)&&inPolygon(x,y,p.rings);
}
function sample(p,c){
  const cx=(c.xmin+c.xmax)/2,cy=(c.ymin+c.ymax)/2;
  if(pointIn(cx,cy,p,c))return [cx,cy];
  const x0=Math.max(c.xmin,p.bb.xmin),x1=Math.min(c.xmax,p.bb.xmax);
  const y0=Math.max(c.ymin,p.bb.ymin),y1=Math.min(c.ymax,p.bb.ymax);
  if(!(x0<=x1&&y0<=y1))return null;
  const midx=(x0+x1)/2,midy=(y0+y1)/2;
  if(pointIn(midx,midy,p,c))return [midx,midy];
  // Incluye islas pequeñas cuyo centroide cae dentro de una celda mayor.
  for(const t of [.25,.75,.05,.5,.95]){
    for(const u of [.25,.75,.05,.5,.95]){
      const x=x0+(x1-x0)*t,y=y0+(y1-y0)*u;
      if(pointIn(x,y,p,c))return [x,y];
    }
  }
  // Costas muy estrechas: puntos interiores cerca de vértices/segmentos.
  const ring=p.rings[0],n=ring.length-1;
  for(let i=0;i<n;i++){
    const a=ring[(i+n-1)%n],b=ring[i],d=ring[(i+1)%n];
    const tx=(a[0]+b[0]+d[0])/3,ty=(a[1]+b[1]+d[1])/3;
    if(pointIn(tx,ty,p,c))return [tx,ty];
    const x=(b[0]+d[0])/2,y=(b[1]+d[1])/2;
    if(pointIn(x,y,p,c))return [x,y];
    // Un vértice puede estar sobre costa; explorar ambos lados sin asumir orientación.
    if(insideCell(b[0],b[1],c)){
      const delta=Math.min(c.xmax-c.xmin,c.ymax-c.ymin)*0.00001;
      for(const [dx,dy] of [[1,1],[1,-1],[-1,1],[-1,-1]]){
        const xx=b[0]+dx*delta,yy=b[1]+dy*delta;
        if(pointIn(xx,yy,p,c))return [xx,yy];
      }
    }
  }
  // Una intersección de segmento con el límite de celda puede no incluir
  // ningún vértice. Muestreo final de la caja de intersección, conservador.
  for(let ix=0;ix<9;ix++)for(let iy=0;iy<9;iy++){
    const x=x0+(x1-x0)*(ix+.5)/9,y=y0+(y1-y0)*(iy+.5)/9;
    if(pointIn(x,y,p,c))return [x,y];
  }
  return null; // no inventar un punto de tierra a partir de la bbox
}
function gridBounds(step){
  if(![5,2,1,0.5,0.25].includes(step))throw Error('Paso de rejilla no admitido');
  return {nlat:Math.round(180/step),nlon:Math.round(360/step)};
}
export function worldGrid(geo,step,limits){
  const polys=geometries(geo),{nlat,nlon}=gridBounds(step);
  const clipped=limits||[-90,-180,90,180];
  if(!Array.isArray(clipped)||clipped.length!==4||clipped.some(x=>!Number.isFinite(x))||
     clipped[0]>=clipped[2]||clipped[1]>=clipped[3])
    throw Error('Límites geográficos inválidos');
  const nodes=new Map();
  let candidates=0;
  for(const p of polys){
    const b=p.bb;
    let imin=Math.max(0,Math.floor((b.ymin+90)/step)-1),
        imax=Math.min(nlat-1,Math.floor((b.ymax+90)/step)+1);
    let jmin=Math.max(0,Math.floor((b.xmin+180)/step)-1),
        jmax=Math.min(nlon-1,Math.floor((b.xmax+180)/step)+1);
    for(let i=imin;i<=imax;i++){
      const south=-90+i*step,north=south+step;
      if(north<=clipped[0]||south>=clipped[2])continue;
      for(let j=jmin;j<=jmax;j++){
        const west=-180+j*step,east=west+step;
        if(east<=clipped[1]||west>=clipped[3])continue;
        const key=i+':'+j;
        if(nodes.has(key))continue;
        const c={xmin:west,xmax:east,ymin:south,ymax:north};
        const found=sample(p,c);candidates++;
        if(!found)continue;
        const lat=+found[1].toFixed(9),lon=+found[0].toFixed(9);
        if(Math.abs(lat)>=90)continue;
        nodes.set(key,{
          id:'grid:'+step+':'+i+':'+j,
          n:'Mundo '+step+'° · '+lat.toFixed(5)+', '+lon.toFixed(5),
          lat,lon,step,
          cell:[south,west,north,east],
          fuente:'Natural Earth 1:10m · muestra terrestre; no representa toda la celda'
        });
      }
    }
  }
  const res=[...nodes.values()].sort((a,b)=>a.cell[0]-b.cell[0]||a.cell[1]-b.cell[1]);
  return {step,nodes:res,candidateChecks:candidates,
    exactCoverage:false,landPolygonCount:polys.length,
    caveat:'Nodos terrestres mundiales, NO viabilidad entre nodos ni cobertura climática continua'};
}
