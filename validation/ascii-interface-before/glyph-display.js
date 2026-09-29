/* A terminal-style character presenter. It has no scene, camera, physics,
 * meshes, or lighting. Its inputs are already final ASCII + FG/BG bytes.
 * The GPU only stamps font coverage over each cell's two colors. */
export class GlyphDisplay {
  constructor(canvas) {
    this.canvas = canvas;
    this.cols = this.rows = 0;
    this.latest = null;
    this.lost = false;
    this.bounds={width:canvas.parentElement.clientWidth,height:canvas.parentElement.clientHeight};
    this.sizeKey='';
    this.observer=new ResizeObserver(entries=>{
      const {width,height}=entries[0].contentRect;this.bounds={width,height};this.sizeKey='';
      if(this.latest)this.render(this.latest);
    });
    this.observer.observe(canvas.parentElement);
    this.gl = canvas.getContext('webgl2', {alpha:false, antialias:false,
      depth:false, stencil:false, preserveDrawingBuffer:false, powerPreference:'low-power'});
    if (this.gl) {
      this.kind = 'Batched character display';
      this.initGL();
      canvas.addEventListener('webglcontextlost', event => {event.preventDefault(); this.lost=true;});
      canvas.addEventListener('webglcontextrestored', () => {
        this.lost=false; this.cols=this.rows=0; this.initGL(); if(this.latest)this.render(this.latest);
      });
    } else {
      this.ctx = canvas.getContext('2d', {alpha:false});
      if (!this.ctx) throw Error('This browser could not create a character display. Select text mode.');
      this.kind = 'Canvas character display';
    }
  }

  initGL() {
    const gl=this.gl;
    const shader=(type,source)=>{
      const result=gl.createShader(type);gl.shaderSource(result,source);gl.compileShader(result);
      if(!gl.getShaderParameter(result,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(result));
      return result;
    };
    const vertex=shader(gl.VERTEX_SHADER,`#version 300 es
      out vec2 uv;
      void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);uv=p;gl_Position=vec4(p*2.-1.,0.,1.);}`);
    const fragment=shader(gl.FRAGMENT_SHADER,`#version 300 es
      precision highp float;
      precision highp usampler2D;
      in vec2 uv;
      uniform usampler2D characters;
      uniform sampler2D foregrounds,backgrounds,font;
      uniform vec2 grid;
      out vec4 color;
      void main(){
        vec2 p=vec2(uv.x,1.-uv.y)*grid;
        ivec2 cell=clamp(ivec2(p),ivec2(0),ivec2(grid)-1);
        uint code=texelFetch(characters,cell,0).r;
        vec2 tile=vec2(code%16u,code/16u);
        vec2 fontUV=(tile+clamp(fract(p),vec2(.001),vec2(.999)))/vec2(16.,8.);
        // Derivatives belong to the continuous cell coordinates. Derivatives
        // of the wrapped atlas UV jump at cell/glyph boundaries and choose the
        // wrong mip level, producing stripes of their own.
        float coverage=textureGrad(font,fontUV,dFdx(p)/vec2(16.,8.),dFdy(p)/vec2(16.,8.)).a;
        vec3 fg=texelFetch(foregrounds,cell,0).rgb;
        vec3 bg=texelFetch(backgrounds,cell,0).rgb;
        color=vec4(mix(bg,fg,coverage),1.);
      }`);
    this.program=gl.createProgram();gl.attachShader(this.program,vertex);gl.attachShader(this.program,fragment);
    gl.linkProgram(this.program);gl.deleteShader(vertex);gl.deleteShader(fragment);
    if(!gl.getProgramParameter(this.program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(this.program));
    gl.useProgram(this.program);gl.bindVertexArray(gl.createVertexArray());
    this.gridLocation=gl.getUniformLocation(this.program,'grid');
    this.textures=[];
    for(const [unit,name] of ['characters','foregrounds','backgrounds','font'].entries()) {
      const texture=gl.createTexture();this.textures.push(texture);gl.activeTexture(gl.TEXTURE0+unit);
      gl.bindTexture(gl.TEXTURE_2D,texture);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,unit===3?gl.LINEAR_MIPMAP_LINEAR:gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,unit===3?gl.LINEAR:gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      gl.uniform1i(gl.getUniformLocation(this.program,name),unit);
    }
    const atlas=document.createElement('canvas');atlas.width=16*20;atlas.height=8*36;
    const ctx=atlas.getContext('2d');ctx.fillStyle='#fff';ctx.textAlign='center';ctx.textBaseline='alphabetic';
    ctx.font='32px "Liberation Mono",Consolas,monospace';
    for(let code=32;code<127;code++)ctx.fillText(String.fromCharCode(code),(code%16)*20+10,Math.floor(code/16)*36+28);
    // Average the final stroke coverage before reducing the font. Sampling a
    // full-size thin stroke once per screen pixel loses it in some columns.
    const ink=ctx.getImageData(0,0,atlas.width,atlas.height);
    for(let i=3;i<ink.data.length;i+=4){const a=ink.data[i]/255;ink.data[i]=Math.round(255*a*(2-a));}
    ctx.putImageData(ink,0,0);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT,1);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,atlas);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.disable(gl.DEPTH_TEST);gl.disable(gl.BLEND);
  }

  resize(cols,rows) {
    const {width,height}=this.bounds;
    const key=`${width},${height},${cols},${rows},${devicePixelRatio}`;
    if(key===this.sizeKey)return;
    this.sizeKey=key;
    const aspect=cols/(rows*1.8);
    const cssWidth=Math.min(width,height*aspect),cssHeight=cssWidth/aspect;
    // Keep display pixel work bounded on high-DPI phones. Character resolution
    // is a separate decision made by the adaptive scene player.
    const ratio=Math.min(devicePixelRatio||1,1.5,Math.sqrt(2300000/Math.max(1,cssWidth*cssHeight)));
    const w=Math.max(1,Math.round(cssWidth*ratio)),h=Math.max(1,Math.round(cssHeight*ratio));
    this.canvas.style.width=cssWidth+'px';this.canvas.style.height=cssHeight+'px';
    if(this.canvas.width!==w||this.canvas.height!==h){this.canvas.width=w;this.canvas.height=h;}
  }

  render(frame) {
    const {cols,rows,glyphsUint8,foregroundRGBUint8,backgroundRGBUint8}=frame;
    if(glyphsUint8.length!==cols*rows||foregroundRGBUint8.length!==cols*rows*3||backgroundRGBUint8.length!==cols*rows*3)
      throw Error('Invalid character buffer dimensions.');
    this.latest=frame;this.resize(cols,rows);
    if(this.lost)return;
    if(!this.gl){this.render2D(frame);return;}
    const gl=this.gl, changed=cols!==this.cols||rows!==this.rows;
    gl.useProgram(this.program);
    for(let unit=0;unit<3;unit++){
      gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,this.textures[unit]);
      const data=[glyphsUint8,foregroundRGBUint8,backgroundRGBUint8][unit];
      const format=unit===0?gl.RED_INTEGER:gl.RGB;
      if(changed)gl.texImage2D(gl.TEXTURE_2D,0,unit===0?gl.R8UI:gl.RGB8,cols,rows,0,format,gl.UNSIGNED_BYTE,data);
      else gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,cols,rows,format,gl.UNSIGNED_BYTE,data);
    }
    this.cols=cols;this.rows=rows;
    gl.viewport(0,0,this.canvas.width,this.canvas.height);gl.uniform2f(this.gridLocation,cols,rows);
    gl.drawArrays(gl.TRIANGLES,0,3);
  }

  render2D({cols,rows,glyphsUint8,foregroundRGBUint8,backgroundRGBUint8}) {
    const ctx=this.ctx,w=this.canvas.width/cols,h=this.canvas.height/rows;
    ctx.fillStyle='#000';ctx.fillRect(0,0,this.canvas.width,this.canvas.height);
    ctx.font=`${h*.89}px "Liberation Mono",Consolas,monospace`;ctx.textAlign='center';ctx.textBaseline='alphabetic';
    let fg='',bg='';
    for(let y=0;y<rows;y++)for(let x=0;x<cols;x++){
      const i=y*cols+x,j=i*3,b=backgroundRGBUint8,f=foregroundRGBUint8;
      if(b[j]||b[j+1]||b[j+2]){const c=`rgb(${b[j]},${b[j+1]},${b[j+2]})`;if(bg!==c){ctx.fillStyle=c;bg=c;fg='';}ctx.fillRect(x*w,y*h,Math.ceil(w),Math.ceil(h));}
      if(glyphsUint8[i]!==32){const c=`rgb(${f[j]},${f[j+1]},${f[j+2]})`;if(fg!==c){ctx.fillStyle=c;fg=c;bg='';}ctx.fillText(String.fromCharCode(glyphsUint8[i]),(x+.5)*w,(y+.78)*h);}
    }
  }
}
