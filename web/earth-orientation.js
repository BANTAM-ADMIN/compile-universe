// Daily precession/nutation is compiled offline. Only Earth's rotation angle
// is evaluated per view (IERS Conventions 2010, chapter 5). UTC approximates UT1.
const TAU=Math.PI*2,DAY=86400000,J2000=Date.UTC(2000,0,1,12);
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const unit=v=>{const n=Math.hypot(...v);return v.map(x=>x/n);};
export function earthRotationAngle(utcMs){
 if(!Number.isFinite(utcMs))throw Error('Invalid Earth UTC clock');
 const d=(utcMs-J2000)/DAY;
 // Split integral days from the daily fraction to retain subsecond precision.
 const turns=.7790572732640+.00273781191135448*d+(d-Math.floor(d));
 return TAU*(turns-Math.floor(turns));
}
export function earthOrientation(utcMs,metadata,chart){
 const day=(utcMs-metadata.startUtcMs)/metadata.stepMs;
 if(day<0||day>metadata.count-1)throw Error('Earth orientation chart covers 2000–2050');
 const a=Math.min(Math.floor(day),metadata.count-2),f=day-a;
 const row=Array.from({length:6},(_,k)=>chart[a*6+k]*(1-f)+chart[(a+1)*6+k]*f);
 const axis=unit(row.slice(3)),projection=dot(row.slice(0,3),axis);
 const cio=unit(row.slice(0,3).map((x,i)=>x-projection*axis[i])),east=cross(axis,cio);
 const angle=earthRotationAngle(utcMs),greenwich=cio.map((x,i)=>x*Math.cos(angle)+east[i]*Math.sin(angle));
 const reference=Math.abs(axis[0])<.9?[1,0,0]:[0,1,0],p=dot(reference,axis);
 const ex=unit(reference.map((x,i)=>x-p*axis[i])),ey=cross(axis,ex);
 return {axis,greenwich,primeMeridian:-Math.atan2(dot(greenwich,ey),dot(greenwich,ex)),utcMs};
}
