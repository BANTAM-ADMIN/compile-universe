#!/usr/bin/env node
import {mkdir,writeFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {Universe} from './universe.mjs';
import {Interface} from './interface.mjs';
import {InputParser} from './input.mjs';
import {Grid,TerminalDisplay,encodeANSI} from './display.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const help=`COMPILE UNIVERSE / TERMINAL

Usage: ./universe-terminal [options]
       python3 run.py terminal [options]

  --destination NAME   Start a flight to a named star, world or phenomenon
  --tour               Start the Grand Tour
  --fps N              Maximum updates per second (1..120; default 30)
  --cols N --rows N    Limit the character grid (60..320 / 20..160)
  --colors MODE        truecolor (default), 256, or none
  --no-mouse           Keep the terminal's normal mouse/text selection
  --sync               Use synchronized terminal updates (DEC 2026)
  --snapshot PREFIX    Save a still .ansi and .txt; works without a TTY
  --frames N           Quit after N rendered frames (for diagnostics)
  --help               Show this help

Arrows/drag: look/orbit   +/-/wheel: zoom   O: orbit/free   B: hold/cruise
Orbit: A/D + R/F circle, W/S zoom   Free: WASD + R/F fly
/: destinations   M: system map   T: tour   Space: pause   ?: help
P: save frame   Esc: return/cancel   Q or Ctrl-C: quit

Requires Node.js 18+ and the project's compiled assets. Runs locally with
the same WASM scene engines as the browser; no browser or server required.
Use a dark terminal with RGB color and a smaller font for more detail.
`;

function options(argv){
 const o={fps:30,colors:'truecolor',mouse:true,sync:false};
 const values=new Set(['destination','fps','cols','rows','colors','snapshot','frames']);
 for(let i=0;i<argv.length;i++){
  const arg=argv[i];if(arg==='--help'||arg==='-h'){o.help=true;continue;}
  if(arg==='--no-mouse'){o.mouse=false;continue;}if(arg==='--sync'){o.sync=true;continue;}if(arg==='--tour'){o.tour=true;continue;}
  const key=arg.slice(2);if(!arg.startsWith('--')||!values.has(key))throw Error(`Unknown option: ${arg}. Use --help.`);
  if(!argv[i+1]||argv[i+1].startsWith('--'))throw Error(`Missing value for ${arg}`);o[key]=argv[++i];
 }
 for(const [key,min,max]of[['fps',1,120],['cols',60,320],['rows',20,160],['frames',1,1000000]])if(o[key]!==undefined){o[key]=Number(o[key]);if(!Number.isInteger(o[key])||o[key]<min||o[key]>max)throw Error(`--${key} must be ${min}..${max}`);}
 if(!['truecolor','256','none'].includes(o.colors))throw Error('--colors must be truecolor, 256, or none');
 if(o.destination&&o.tour)throw Error('Choose either --destination or --tour');
 if(o.snapshot&&o.tour)throw Error('--snapshot needs one destination; omit --tour');
 return o;
}

export async function saveFrame(frame,prefix,colors='truecolor'){
 const path=resolve(prefix);await mkdir(dirname(path),{recursive:true});
 // A standalone ANSI document, not a stream of deltas or a screenshot.
 await Promise.all([writeFile(path+'.txt',frame.plain()),writeFile(path+'.ansi','\x1b[0m\x1b[2J\x1b[?7l'+encodeANSI(frame,null,colors)+`\x1b[0m\x1b[?7h\x1b[${frame.rows+1};1H\n`)]);
 return path;
}

async function snapshot(o){
 const u=new Universe();
 try{
  u.resize(o.cols||120,o.rows||42);await u.init();if(o.destination)await u.fly(o.destination,{instant:true});
  for(let i=0;i<60;i++)u.tick(1/60);
  const frame=await u.frame(),ui=new Interface(u),grid=ui.render(frame),path=await saveFrame(grid,o.snapshot,o.colors);
  console.log(JSON.stringify({destination:u.selected.name,cols:grid.cols,rows:grid.rows,scene:frame.stats.active_scene,frameMs:frame.stats.frame_ms,files:[path+'.ansi',path+'.txt']}));
 }finally{await u.close();}
}

async function interactive(o){
 if(!process.stdin.isTTY||!process.stdout.isTTY)throw Error('Open this in a terminal, or use --snapshot PREFIX to export a frame.');
 const u=new Universe(),display=new TerminalDisplay(process.stdout,o);
 let quitting=false,suspended=false,latest=null,framePending=false,frames=0,failure=null,last=performance.now(),sampleAt=last,sampleFrames=0,dirtySize=true;
 const quit=()=>{quitting=true;};
 const fail=e=>{failure=e;quit();};
 const size=()=>{
  const cols=Math.min(320,o.cols||320,process.stdout.columns||80),rows=Math.min(160,o.rows||160,process.stdout.rows||24);
  if(cols!==u.state.cols||rows!==u.state.rows){u.resize(Math.max(16,cols),Math.max(8,rows));latest=null;display.reset();}dirtySize=false;return cols>=60&&rows>=20;
 };
 const raw=enabled=>{if(process.stdin.isTTY)process.stdin.setRawMode(enabled);};
 const suspend=()=>{
  if(suspended||quitting||process.platform==='win32')return;suspended=true;display.leave();raw(false);process.stdin.pause();
  process.kill(process.pid,'SIGSTOP');
 };
 const resume=()=>{if(!suspended||quitting)return;suspended=false;raw(true);process.stdin.resume();display.enter();dirtySize=true;last=performance.now();};
 const ui=new Interface(u,{quit,suspend,snapshot:()=>ui.run(async()=>{
  if(!ui.grid||!u.ready)return;
  const stamp=new Date().toISOString().replace(/[:.]/g,'-'),name=String(u.selected.id).replace(/[^a-z0-9-]/gi,'_');
  await saveFrame(ui.grid,resolve(root,`artifacts/terminal-${name}-${stamp}`),o.colors);u.notice=`Saved text + ANSI in artifacts/terminal-${name}-${stamp}`;
 })});
 const parser=new InputParser(event=>{if(suspended||quitting)return;try{if(event.type==='key')ui.key(event.key);else if(event.type==='mouse')ui.mouse(event);else ui.paste(event.text);}catch(e){u.notice=e.message;}});
 const input=chunk=>parser.feed(chunk),resize=()=>{dirtySize=true;};
 const signals=['SIGINT','SIGTERM','SIGHUP'];
 for(const signal of signals)process.on(signal,quit);
 process.on('SIGCONT',resume);process.on('uncaughtException',fail);process.on('unhandledRejection',fail);process.stdout.on('error',fail);
 process.stdout.on('resize',resize);process.stdin.setEncoding('utf8');process.stdin.on('data',input);process.stdin.on('end',quit);process.stdin.on('error',fail);
 try{
  raw(true);process.stdin.resume();display.enter();
  u.init().then(async()=>{if(quitting)return;if(o.destination)await u.fly(o.destination);else if(o.tour)await u.startTour();}).catch(e=>{if(!quitting)fail(e);});
  let fits=size();
  while(!quitting){
   const started=performance.now();if(suspended){await delay(30);continue;}
   if(dirtySize)fits=size();u.tick((started-last)/1000);last=started;
   if(fits&&u.ready&&!framePending){
    framePending=true;
    u.frame().then(frame=>{
     if(quitting)return;if(frame.cols!==u.state.cols||frame.rows!==u.state.rows)return;
     latest=frame;frames++;sampleFrames++;
     const now=performance.now();if(now-sampleAt>1000){ui.fps=Math.round(sampleFrames*1000/(now-sampleAt));sampleFrames=0;sampleAt=now;}
    }).catch(e=>{if(!quitting)fail(e);}).finally(()=>{framePending=false;});
   }
   let grid;
   if(fits)grid=ui.render(latest);
   else{grid=new Grid(u.state.cols,u.state.rows);grid.text(1,1,'COMPILE UNIVERSE');grid.text(1,3,'Resize to at least 60 x 20.');grid.text(1,5,'Q or Ctrl-C: quit');}
   await display.present(grid);
   if(o.frames&&frames>=o.frames)quit();
   await delay(Math.max(1,1000/o.fps-(performance.now()-started)));
  }
 }finally{
  quitting=true;parser.close();process.stdin.off('data',input);process.stdin.off('end',quit);process.stdin.off('error',fail);process.stdin.pause();raw(false);display.leave();
  process.stdout.off('resize',resize);for(const signal of signals)process.off(signal,quit);process.off('SIGCONT',resume);
  await u.close();process.off('uncaughtException',fail);process.off('unhandledRejection',fail);process.stdout.off('error',fail);
 }
 if(failure)throw failure;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{const o=options(process.argv.slice(2));if(o.help)console.log(help);else if(o.snapshot)await snapshot(o);else await interactive(o);}
 catch(e){console.error(`COMPILE UNIVERSE: ${e.message}`);process.exitCode=1;}
}
