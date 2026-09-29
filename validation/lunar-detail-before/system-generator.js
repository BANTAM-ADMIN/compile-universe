// Compact, deterministic fictional systems anchored to catalog stars.
// Generation happens on demand. No generated orbit is an exoplanet detection.
export const GENERATOR_VERSION = 1;
const AU_PC = Math.PI / (180 * 3600), KM_PC = 3.085677581491367e13;
const TAU = Math.PI * 2;
const norm = v => { const n = Math.hypot(...v); return v.map(x => x / n); };
const cross = (a,b) => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
function random(seed) { let a = seed >>> 0; return () => { a += 0x6D2B79F5; let t = a; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function plane(axis) { const u = norm(cross(axis, Math.abs(axis[2]) < .9 ? [0,0,1] : [1,0,0])); return [u, cross(axis,u)]; }
function offset(center, axis, radiusAU, phase) { const [u,v] = plane(axis); return center.map((x,k) => x + radiusAU*AU_PC*(u[k]*Math.cos(phase)+v[k]*Math.sin(phase))); }
const texture = key => ({url:`/artifacts/surface-${key}.bin`,width:512,height:256,channels:3});
const romans = ['I','II','III','IV','V','VI','VII','VIII'];
const variants = {
  lava: {label:'Volcanic world', chart:'lava', kind:'lava', atmosphere:0,
    description:'A dark volcanic world threaded with incandescent fissures.'},
  desert: {label:'Desert world', chart:'desert', kind:'rocky', atmosphere:.18,
    description:'Copper-colored basins and pale uplands beneath a thin amber haze.'},
  ocean: {label:'Ocean world', chart:'ocean', kind:'water', atmosphere:.8,
    description:'Deep blue seas wrap around scattered islands and cloud banks.'},
  rocky: {label:'Rocky world', chart:'temperate-rock', kind:'rocky', atmosphere:.08,
    description:'A cratered landscape of ancient plateaus and mineral-rich plains.'},
  carbon: {label:'Carbon-dark world', chart:'carbon', kind:'rocky', atmosphere:0,
    description:'Charcoal-colored terrain broken by bright impact scars.'},
  gas: {label:'Banded gas giant', chart:'jupiter', kind:'gas', atmosphere:.38,
    description:'Wide cloud belts curl around a giant globe, with small moons beyond the limb.'},
  hotgas: {label:'Hot gas giant', chart:'hot-jupiter', kind:'gas', atmosphere:.5,
    description:'Rose and copper cloud bands surround a swollen close-orbiting giant.'},
  icegiant: {label:'Ice giant', chart:'neptune', kind:'gas', atmosphere:.4,
    description:'An azure giant with fine atmospheric bands and a family of distant moons.'},
  ice: {label:'Frozen world', chart:'ice-rock', kind:'ice', atmosphere:0,
    description:'Pale fractured ice and blue shadows cover a world at the edge of its system.'},
  violet: {label:'Mineral world', chart:'violet', kind:'rocky', atmosphere:.25,
    description:'An imagined mineral palette gives this world violet highlands and silver plains.'},
};

export function generateSystem(star, measuredBodies = []) {
  if (!Number.isInteger(star?.index) || star.index <= 0 || !Array.isArray(star.position) || star.position.length !== 3 || !star.position.every(Number.isFinite))
    throw new Error('A non-Solar catalog star with finite coordinates is required');
  const identity=star.gaia_id ?? star.id ?? star.index;
  let seed=Number(identity);
  if(star.gaia_id || !Number.isSafeInteger(seed)) {
    seed=2166136261;
    for(const char of String(identity))seed=Math.imul(seed^char.charCodeAt(0),16777619)>>>0;
  }
  const rng = random((seed ^ 0x517CC1B7) >>> 0);
  const pick = values => values[Math.floor(rng()*values.length)];
  const id = `generated-system-${star.index}`, name = star.name || `HYG ${star.id}`;
  const axis = norm([rng()-.5,rng()-.5,.35+rng()]);
  const luminosity = Math.min(1e6, Math.max(.0001, Number(star.luminosity) || 10**((4.83-(star.absmag??4.83))/2.5)));
  const starRadiusAU = (star.radius_pc ?? star.radiusPc ?? 2.25e-8)/AU_PC;
  const massEstimate = Math.min(25,Math.max(.08,luminosity**.27));
  const count = 3 + Math.floor(rng()*6), bodies = [];
  const measured = measuredBodies.filter(body => body.parentStarIndex === star.index && !body.generated);
  let orbitAU = Math.max(starRadiusAU*9, .065*Math.sqrt(luminosity))*(.8+rng()*.7), ordinal = 0;
  const baseIndex = -100000-star.index*128;
  function makeBody({bodyId,bodyName,parent,position,radiusKm,variant,semiMajorAxisAU,phase,bodyAxis,orbitAxis=axis,kind,periodDays}) {
    const style = variants[variant];
    const body = {id:bodyId,index:baseIndex-(++ordinal),name:bodyName,kind,systemId:id,
      position,radiusKm,radiusPc:radiusKm/KM_PC,radius_pc:radiusKm/KM_PC,parentId:parent,
      parentBodyId:parent,parentStarIndex:star.index,hostPosition:[...star.position],
      classification:style.label,dataClass:'generated-world',generated:true,generatorVersion:GENERATOR_VERSION,
      appearanceKind:style.kind,appearanceDataClass:'authored illustration',texture:texture(style.chart),
      axis:bodyAxis,primeMeridian:rng()*TAU,rotationRate:(.006+rng()*.02)*(rng()<.1?-1:1),
      atmosphere:{strength:style.atmosphere,color:style.kind==='water'?[.08,.4,1]:[.25,.48,.7]},
      semiMajorAxisAU,orbitalSemiMajorAxisAU:semiMajorAxisAU,orbitalPeriodDays:periodDays,
      orbit:{semiMajorAxisAU,periodDays,phaseRad:phase,axis:orbitAxis,eccentricity:0},
      positionDataClass:'generated orbital layout, fixed phase',radiusDataClass:'generated size',
      description:`${style.description} An imagined ${kind} in a persistent generated system.`,
      facts:[{label:'World',value:'Generated, not an observed discovery'},{label:'Radius',value:Math.round(radiusKm),unit:'km'},
        {label:'Orbit size',value:Number(semiMajorAxisAU.toPrecision(4)),unit:'AU'},
        {label:'Orbital period',value:Number(periodDays.toPrecision(4)),unit:'days (illustrative)'}],
    };
    bodies.push(body); return body;
  }
  for (let i=0;i<count;i++) {
    if (i) orbitAU *= 1.6+rng()*.75;
    // Keep invented worlds visually separate from selected measured exoplanets.
    for (const known of measured) if (Math.abs(Math.log(orbitAU/(known.semiMajorAxisAU || known.orbitalSemiMajorAxisAU || known.orbit?.semimajorAxisAU || orbitAU*100))) < .25) orbitAU *= 1.45;
    const warmth = orbitAU/Math.sqrt(luminosity);
    const giant = i>0 && rng()<.46;
    let variant = giant ? (warmth<.5?'hotgas':warmth>3?'icegiant':'gas') :
      warmth<.22 ? 'lava' : warmth<.7 ? pick(['desert','rocky','carbon']) :
      warmth<1.8 ? pick(['ocean','rocky','violet','desert']) : pick(['ice','carbon','rocky']);
    const radiusKm = giant ? (3+rng()*8)*6371 : (.35+rng()*1.65)*6371;
    const phase=rng()*TAU,bodyId=`generated-${star.index}-${i+1}`;
    const body=makeBody({bodyId,bodyName:`${name} ${romans[i]}`,parent:`star-${star.index}`,
      position:offset(star.position,axis,orbitAU,phase),radiusKm,variant,semiMajorAxisAU:orbitAU,phase,
      bodyAxis:norm(axis.map(v=>v+(rng()-.5)*.3)),kind:'planet',periodDays:365.25*Math.sqrt(orbitAU**3/massEstimate)});
    if (giant && rng()<.5) body.ring={innerRadius:1.28,outerRadius:2.35,texture:{url:'/artifacts/rings-saturn.bin',width:1024,channels:4},dataClass:'generated ring system'};
    const moonCount = giant ? 1+Math.floor(rng()*4) : (rng()<.48?1:0);
    let moonOrbitKm = radiusKm*(giant?4.5:5.5);
    for (let j=0;j<moonCount;j++) {
      moonOrbitKm *= 1.65+rng()*.55;
      // A conservative layout bound, not a solved orbital-stability model.
      if (moonOrbitKm > orbitAU*149597870.7*(giant?.025:.006)) break;
      const moonRadius = Math.min(radiusKm*.21,200+rng()*2200), moonPhase=rng()*TAU, moonAxis=body.axis;
      const m=makeBody({bodyId:`${bodyId}-moon-${j+1}`,bodyName:`${name} ${romans[i]}-${String.fromCharCode(97+j)}`,
        parent:body.id,position:offset(body.position,moonAxis,moonOrbitKm/149597870.7,moonPhase),radiusKm:moonRadius,
        variant:pick(warmth<.6?['lava','carbon','rocky']:['ice','rocky','carbon']),semiMajorAxisAU:moonOrbitKm/149597870.7,
        phase:moonPhase,bodyAxis:moonAxis,orbitAxis:moonAxis,kind:'moon',periodDays:Math.max(.2,Math.sqrt((moonOrbitKm/radiusKm)**3)*.12)});
      if (moonRadius<650) m.shape=[1.22,.83,.98];
    }
  }
  const beltInner = orbitAU*(1.3+rng()*.3);
  for(let i=0;i<2;i++) {
    const a=beltInner*(1.08+i*.31),phase=rng()*TAU;
    const dwarf=makeBody({bodyId:`generated-${star.index}-dwarf-${i+1}`,bodyName:`${name} ${i?'Farshore':'Shard'}`,
      parent:`star-${star.index}`,position:offset(star.position,axis,a,phase),radiusKm:180+rng()*1150,
      variant:pick(['ice','carbon','violet']),semiMajorAxisAU:a,phase,bodyAxis:axis,kind:'dwarf planet',
      periodDays:365.25*Math.sqrt(a**3/massEstimate)});
    dwarf.shape=i?[1.45,.85,.81]:[1,1,1];
  }
  const asteroidCount=Math.floor(rng()*3);
  for(let i=0;i<asteroidCount;i++){
    const a=beltInner*(1.03+rng()*.35),phase=rng()*TAU;
    const asteroid=makeBody({bodyId:`generated-${star.index}-asteroid-${i+1}`,bodyName:`${name} Fragment ${i+1}`,
      parent:`star-${star.index}`,position:offset(star.position,axis,a,phase),radiusKm:2+rng()*65,
      variant:pick(['rocky','carbon']),semiMajorAxisAU:a,phase,bodyAxis:axis,kind:'asteroid',periodDays:365.25*Math.sqrt(a**3/massEstimate)});
    asteroid.shape=[1.35,.82,.9];
  }
  if(rng()<.7){
    const a=Math.max(starRadiusAU*15,.8*Math.sqrt(luminosity))*(.7+rng()*.6),phase=rng()*TAU;
    const comet=makeBody({bodyId:`generated-${star.index}-comet`,bodyName:`${name} Wanderer`,
      parent:`star-${star.index}`,position:offset(star.position,axis,a,phase),radiusKm:2+rng()*10,
      variant:'carbon',semiMajorAxisAU:a,phase,bodyAxis:axis,kind:'comet',periodDays:365.25*Math.sqrt(a**3/massEstimate)});
    comet.shape=[1.3,.8,.96];comet.appearanceKind='comet';comet.classification='Generated active comet';
    comet.comet={tailLengthRadii:50,comaRadiusRadii:3};comet.viewDistanceRadii=64;
    comet.description='A persistent imagined comet with an illustrative coma and a tail directed away from its star.';
    comet.facts[2]={label:'Current stellar distance',value:Number(a.toPrecision(4)),unit:'AU'};
  }
  const belts=[{id:`${id}-belt`,name:`${name} debris belt`,innerRadiusAU:beltInner,outerRadiusAU:beltInner*(1.2+rng()*.35),
    axis,position:[...star.position],hostStarIndex:star.index,seed:star.index+SEED_OFFSET,dataClass:'generated debris belt',count:1400}];
  return {id,name:`${name} system`,host:star,hostStarIndex:star.index,axis,bodyIds:[...measured,...bodies].map(b=>b.id),
    bodies:[...measured,...bodies],belts,dataClass:'generated-system',generatorVersion:GENERATOR_VERSION,
    description:'A persistent imagined system around a catalog star. Any separately labeled confirmed planets retain their measured data.'};
}
const SEED_OFFSET = 14683;
