// Flight math follows the browser's collision-aware routes and logarithmic approach.
export const AU_PC=Math.PI/(180*3600),PC_KM=3.085677581491367e13,SOLAR_RADIUS_PC=2.25461e-8;
export const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export const length=v=>Math.hypot(...v),sub=(a,b)=>a.map((v,i)=>v-b[i]),add=(a,b)=>a.map((v,i)=>v+b[i]),scale=(v,s)=>v.map(x=>x*s);
export const normalize=v=>scale(v,1/Math.max(length(v),1e-30));
export const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
export const smooth=t=>t*t*(3-2*t);
export const radius=r=>Number(r?.radius_pc??r?.radiusPc)||(r?.radius_solar||1)*SOLAR_RADIUS_PC;
export const isPhenomenon=r=>r?.sceneKind==='phenomenon'||r?.sceneKind==='blackhole';
export const navigationRadius=r=>r?.kind==='region'?0:radius(r)*(r?.sceneKind==='blackhole'?Number(r.minimumViewRadius)||6.05:1);
export const minimumOrbitRadius=r=>r?.kind==='region' ? .01 : radius(r)*(isPhenomenon(r)?Number(r.minimumViewRadius)?Number(r.minimumViewRadius)+.0001:r.sceneKind==='blackhole'?6.051:.02:1.04);
export function segmentDistance(a, b, center) {
  const d = sub(b, a), squared = dot(d, d);
  const t = squared > 0 ? clamp(dot(sub(center, a), d) / squared, 0, 1) : 0;
  const point = add(a, scale(d, t)); return { distance: length(sub(point, center)), point, t, direction: d };
}
export function safeWaypoints(initial, obstacles) {
  const points = initial.map(point => [...point]);
  for (let pass = 0; pass < 24; pass++) {
    let changed = false;
    outer: for (let i = 0; i < points.length - 1; i++) {
      for (const body of obstacles) {
        const hit = segmentDistance(points[i], points[i + 1], body.position), clearance = navigationRadius(body) * 1.10;
        if (hit.distance >= clearance) continue;
        // A radial departure segment is safe even when a freely positioned
        // starting camera lies inside the extra navigation margin.
        const da = length(sub(points[i], body.position)), db = length(sub(points[i + 1], body.position));
        if (hit.t < 1e-10 && da >= radius(body) * 1.015 && db > da) continue;
        if (hit.t > 1 - 1e-10 && db >= radius(body) * 1.015 && da > db) continue;
        let offset = sub(hit.point, body.position);
        if (length(offset) < clearance * .05) { offset = cross(hit.direction, body.axis || [0, 0, 1]); if (length(offset) < 1e-25) offset = cross(hit.direction, [0, 1, 0]); }
        const waypoint = add(body.position, scale(normalize(offset), clearance * 3));
        points.splice(i + 1, 0, waypoint); changed = true; break outer;
      }
    }
    if (!changed) break;
  }
  const cumulative = [0]; for (let i = 1; i < points.length; i++) cumulative.push(cumulative[i - 1] + length(sub(points[i], points[i - 1])));
  return { points, cumulative, length: cumulative[cumulative.length - 1] };
}
export function pointOnRoute(route, distance) {
  const along = clamp(distance, 0, route.length);
  for (let i = 1; i < route.points.length; i++) if (along <= route.cumulative[i] || i === route.points.length - 1) {
    const segmentLength = route.cumulative[i] - route.cumulative[i - 1], u = segmentLength > 0 ? (along - route.cumulative[i - 1]) / segmentLength : 1;
    // Subtract from the nearby endpoint on arrival: adding almost a whole
    // interstellar segment discards useful precision near a tiny target.
    return u > .5 ? add(route.points[i], scale(sub(route.points[i - 1], route.points[i]), 1 - u))
      : add(route.points[i - 1], scale(sub(route.points[i], route.points[i - 1]), u));
  }
  return [...route.points[route.points.length - 1]];
}
// Walk back along the already collision-checked route to its first crossing
// of the requested camera radius. This preserves detours and world positions.
export function remainingAtRadius(route, center, boundary) {
  let remaining = 0;
  for (let i = route.points.length - 1; i > 0; i--) {
    const end = route.points[i], previous = route.points[i - 1], segment = sub(previous, end), span = length(segment);
    if (length(sub(previous, center)) >= boundary && span > 0) {
      const offset = sub(end, center), direction = scale(segment, 1 / span), projection = dot(offset, direction);
      const crossing = -projection + Math.sqrt(Math.max(0, projection * projection + boundary * boundary - dot(offset, offset)));
      return remaining + clamp(crossing, 0, span);
    }
    remaining += span;
  }
  return null;
}
export function phenomenonWaypoints(start, endpoint, record) {
  if (!isPhenomenon(record)) return [];
  const blackhole = record.sceneKind === 'blackhole';
  const incoming = sub(start, record.position), startRadius = length(incoming), unit = radius(record);
  if (startRadius < unit * (blackhole ? 500 : 100)) return [];
  const from = normalize(incoming), to = normalize(sub(endpoint, record.position));
  const cosine = clamp(dot(from, to), -1, 1), angle = Math.acos(cosine);
  let tangent = sub(to, scale(from, cosine));
  if (length(tangent) < 1e-8) tangent = cross(from, Math.abs(from[1]) < .9 ? [0, 1, 0] : [1, 0, 0]);
  tangent = normalize(tangent);
  // Turn toward the final viewing bearing before the close-up region. The
  // angular easing has radial tangents at both ends, so the last leg can keep
  // one steady view while the shadow grows. Even opposite bearings remain
  // outside the object rather than cutting a chord through its center.
  const endRadius = Math.max(unit * (blackhole ? 420 : 90), startRadius * .035);
  const beginRadius = Math.min(startRadius * .94, Math.max(endRadius * 1.08, startRadius * .65));
  const points = [];
  for (let i = 0; i <= 96; i++) {
    const u = i / 96, bearing = angle * smooth(u);
    const direction = i === 96 ? to : add(scale(from, Math.cos(bearing)), scale(tangent, Math.sin(bearing)));
    const distance = beginRadius * Math.exp(Math.log(endRadius / beginRadius) * u);
    points.push(add(record.position, scale(direction, distance)));
  }
  return points;
}
export function localApproach(record, route, duration, sameTarget, leg) {
  if (!isPhenomenon(record) || sameTarget || duration <= 0) return null;
  const blackhole=record.sceneKind==='blackhole';
  const remaining = remainingAtRadius(route, record.position, radius(record) * (blackhole?4096:512));
  if (!(remaining > 0) || remaining >= leg) return null;
  const closeSeconds = Math.min(8, duration * .45), closeStart = duration - closeSeconds, approachStart = duration * .38;
  const logarithm = Math.log(leg / remaining);
  const targetScale = Math.max(radius(record) * (blackhole?24:record.viewDistanceRadii||6), 1e-13), closeLog = Math.log1p(remaining / targetScale);
  const span = closeStart - approachStart, e = Math.exp(-closeLog), q = 1 - e;
  const terminalSlope = -2 * closeLog / q * span / (closeSeconds * logarithm);
  const terminalCurvature = (2 * closeLog / q - 4 * closeLog * closeLog * e / (q * q)) * span * span / (closeSeconds * closeSeconds * logarithm);
  return { remaining, closeStart, closeSeconds, approachStart, logarithm, targetScale, closeLog,
    // Match position, velocity and acceleration at the start of the final
    // braking leg; a velocity-only match still produced a sharp slowdown.
    terminalSlope, terminalCurvature,
    exponentCoefficients: [-10 - 4 * terminalSlope + .5 * terminalCurvature,
      15 + 7 * terminalSlope - terminalCurvature, -6 - 3 * terminalSlope + .5 * terminalCurvature] };
}
export function travelDuration(distance, sameTarget) {
  if (sameTarget) return 2.8;
  const au = distance / AU_PC;
  if (au < .01) return 4.4;
  if (au < 1000) return clamp(5.1 + Math.log10(Math.max(.02, au) + .2) * 1.45, 4.8, 9.3);
  return clamp(10.5 + Math.log10(Math.max(1, distance)) * 1.15, 10.5, 14);
}

export function sampleFlight(travel,dt){
  travel.elapsed = Math.min(travel.duration, travel.elapsed + dt);
  const t = travel.elapsed / travel.duration, D = travel.route.length, leg = travel.leg;
  let distance;
  if (travel.sameTarget) distance = D * smooth(t);
  else if (t < .24) distance = travel.nearStart * Math.expm1(Math.log1p(leg / travel.nearStart) * smooth(t / .24));
  else if (travel.closeApproach) {
    const approach = travel.closeApproach, elapsed = travel.elapsed;
    if (elapsed < approach.approachStart) distance = leg + (D - 2 * leg) * smooth((t - .24) / (approach.approachStart / travel.duration - .24));
    else if (elapsed < approach.closeStart) {
      const u = clamp((elapsed - approach.approachStart) / (approach.closeStart - approach.approachStart), 0, 1);
      const [a, b, c] = approach.exponentCoefficients;
      const exponent = 1 + u * u * u * (a + u * (b + u * c));
      distance = D - approach.remaining * Math.exp(approach.logarithm * exponent);
    } else {
      const u = clamp((elapsed - approach.closeStart) / approach.closeSeconds, 0, 1);
      distance = D - approach.targetScale * Math.expm1(approach.closeLog * (1 - u) ** 2);
    }
  } else if (t < .64) distance = leg + (D - 2 * leg) * smooth((t - .24) / .40);
  else distance = D - travel.nearEnd * Math.expm1(Math.log1p(leg / travel.nearEnd) * (1 - smooth((t - .64) / .36)));
  const position=pointOnRoute(travel.route,distance);
  const pulse=travel.sameTarget?0:Math.sin(Math.PI*clamp((t-.15)/.72,0,1))**2;
  return {position,t,fov:travel.baseFov+(travel.targetFov-travel.baseFov)*smooth(t)+pulse*8};
}
export function forward(camera){const cp=Math.cos(camera.pitch);return [Math.sin(camera.yaw)*cp,Math.sin(camera.pitch),Math.cos(camera.yaw)*cp];}
export function bearing(direction){return {yaw:Math.atan2(direction[0],direction[2]),pitch:Math.atan2(direction[1],Math.hypot(direction[0],direction[2]))};}
export function blendDirection(a,b,t){
 const from=normalize(a),to=normalize(b),cosine=clamp(dot(from,to),-1,1);
 if(cosine>.9995)return normalize(add(scale(from,1-t),scale(to,t)));
 let tangent=sub(to,scale(from,cosine));if(length(tangent)<1e-8)tangent=cross(from,Math.abs(from[1])<.9?[0,1,0]:[1,0,0]);
 const angle=Math.acos(cosine)*t;return add(scale(from,Math.cos(angle)),scale(normalize(tangent),Math.sin(angle)));
}
export function basis(camera){const f=forward(camera),r=[-Math.cos(camera.yaw),0,Math.sin(camera.yaw)],v=cross(r,f),c=Math.cos(camera.roll||0),s=Math.sin(camera.roll||0);return {forward:f,right:add(scale(r,c),scale(v,s)),up:sub(scale(v,c),scale(r,s))};}
export function project(position,camera){const b=basis(camera),d=sub(position,camera.position),z=dot(d,b.forward);if(z<=0)return null;const ty=Math.tan(camera.fov*Math.PI/360),tx=ty*camera.cols/(camera.rows*1.8);return [(dot(d,b.right)/(z*tx)+1)*.5,(1-dot(d,b.up)/(z*ty))*.5];}
export function distanceText(pc){const km=Math.max(0,pc)*PC_KM;if(km<1e6)return Math.round(km).toLocaleString('en-US')+' km';if(pc/AU_PC<1000)return (pc/AU_PC).toFixed(2)+' AU';const ly=pc*3.261563777;return ly>=1e6?(ly/1e6).toFixed(2)+' Mly':ly.toFixed(2)+' ly';}
