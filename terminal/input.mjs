// Stateful parser: terminals may split escape sequences across arbitrary reads.
export class InputParser {
 constructor(emit){this.emit=emit;this.buffer='';this.timer=null;this.pasting=false;this.paste='';}
 feed(text){clearTimeout(this.timer);this.buffer+=text;this.parse();if(this.buffer==='\x1b')this.timer=setTimeout(()=>{this.buffer='';this.emit({type:'key',key:'escape'});},35);}
 parse(){
  while(this.buffer){
   if(this.pasting){const end=this.buffer.indexOf('\x1b[201~');if(end<0){if(this.buffer.length>6){this.paste=(this.paste+this.buffer.slice(0,-6)).slice(0,512);this.buffer=this.buffer.slice(-6);}return;}this.paste=(this.paste+this.buffer.slice(0,end)).slice(0,512);this.emit({type:'paste',text:this.paste.slice(0,512)});this.paste='';this.pasting=false;this.buffer=this.buffer.slice(end+6);continue;}
   if(this.buffer.startsWith('\x1b[200~')){this.pasting=true;this.buffer=this.buffer.slice(6);continue;}
   if(this.buffer[0]==='\x1b'){
    if(this.buffer.length===1)return;
    if(this.buffer[1]==='['){
     const mouse=/^\x1b\[<(\d+);(\d+);(\d+)([Mm])/.exec(this.buffer);
     if(mouse){const code=+mouse[1];this.emit({type:'mouse',code,x:+mouse[2]-1,y:+mouse[3]-1,release:mouse[4]==='m',motion:!!(code&32),wheel:!!(code&64)});this.buffer=this.buffer.slice(mouse[0].length);continue;}
     const csi=/^\x1b\[([0-9;?<]*)([ -/]*)([@-~])/.exec(this.buffer);
     if(!csi){if(this.buffer.length>64)this.buffer='';return;}
     const key=({A:'up',B:'down',C:'right',D:'left',H:'home',F:'end',Z:'shift-tab'})[csi[3]]||(csi[3]==='~'?({'1':'home','3':'delete','4':'end','5':'pageup','6':'pagedown','7':'home','8':'end'})[csi[1]]:null);
     if(key)this.emit({type:'key',key});this.buffer=this.buffer.slice(csi[0].length);continue;
    }
    if(this.buffer[1]==='O'){if(this.buffer.length<3)return;const key=({A:'up',B:'down',C:'right',D:'left',H:'home',F:'end'})[this.buffer[2]];if(key)this.emit({type:'key',key});this.buffer=this.buffer.slice(3);continue;}
    this.buffer=this.buffer.slice(1);this.emit({type:'key',key:'escape'});continue;
   }
   const c=String.fromCodePoint(this.buffer.codePointAt(0));this.buffer=this.buffer.slice(c.length);
   const key=({'\x03':'ctrl-c','\x04':'ctrl-d','\x1a':'ctrl-z','\x7f':'backspace','\b':'backspace','\r':'enter','\n':'enter','\t':'tab',' ':'space'})[c]||c;
   if(c>=' '||key!==c)this.emit({type:'key',key});
  }
 }
 close(){clearTimeout(this.timer);}
}
