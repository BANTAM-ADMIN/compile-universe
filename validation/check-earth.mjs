import {chromium} from 'playwright';
const b=await chromium.launch({headless:true,args:['--no-sandbox']}),p=await b.newPage({viewport:{width:1440,height:1000}});
await p.goto('http://127.0.0.1:8768');await p.waitForFunction(()=>__atlas?.ready,null,{timeout:60000});await p.evaluate(()=>__atlas.setPaused(true));await p.waitForTimeout(1000);await p.screenshot({path:'validation/earth-current.png'});console.log(await p.evaluate(()=>({state:__atlas.state,earth:__atlas.destinations.earth})));await b.close();
