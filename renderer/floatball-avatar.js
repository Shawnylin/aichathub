/* DOM adapter for the upstream MIT bloub engine; all assets are local. */
(() => {
  const { BotEngine, SHAPE_BY_ID, EXPRESSION_BY_ID, STATE_BY_ID, NOTIF_BLUE, RAYON } = window.Bloub;
  const C = window.FloatballConfig;
  let serial = 0;
  function node(tag, attrs = {}) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [key,value] of Object.entries(attrs)) el.setAttribute(key,value);
    return el;
  }
  class Avatar {
    constructor(host, settings = C.defaults) {
      this.host = host; this.settings = C.normalize(settings); this.accent = '#53616d';
      this.facing = {yaw:-14,pitch:8}; this.clock = 1; this.last = 0;
      this.raf = null; this.frameTimer = null; this.playTimer = null; this.until = 0; this.returnAt = 0;
      this.active = true; this.destroyed = false; this.hovered = false; this.dragging = false;
      this.playIndex = 0; this.playing = false; this.frames = 0; this.pointer = null;
      this.reduce = matchMedia('(prefers-reduced-motion: reduce)');
      this.svg = node('svg',{viewBox:'-158 -158 316 316','aria-hidden':'true'});
      this.id = ++serial;
      const id = 'fb-clip-' + this.id, clip = node('clipPath',{id}), defs = this.defs = node('defs');
      this.clipPath = node('path'); clip.append(this.clipPath); defs.append(clip); this.svg.append(defs);
      const maskId='fb-notch-'+this.id, mask=node('mask',{id:maskId,maskUnits:'userSpaceOnUse',x:-158,y:-158,width:316,height:316});
      this.notch=node('circle',{fill:'#000',r:0});mask.append(node('rect',{x:-158,y:-158,width:316,height:316,fill:'#fff'}),this.notch);defs.append(mask);
      this.backArcs=node('g',{'data-layer':'arcs-back'});this.frontArcs=node('g',{'data-layer':'arcs-front'});
      this.dots=node('g',{'data-layer':'dots'});this.dotNodes=[];this.arcNodes=new Map();
      this.body = node('path',{mask:`url(#${maskId})`}); this.eyes = node('g',{'clip-path':`url(#${id})`,mask:`url(#${maskId})`});
      this.eyeNodes = [node('path'),node('path')]; this.eyes.append(...this.eyeNodes);
      this.notification=node('circle',{fill:NOTIF_BLUE,r:0,'data-layer':'notification'});
      this.svg.append(this.backArcs,this.body,this.eyes,this.dots,this.frontArcs,this.notification); host.replaceChildren(this.svg);
      this.motionChanged = () => this.configure(this.settings,this.accent,true);
      this.visibilityChanged = () => {
        if(document.hidden) this.stop(); else if(this.active) { this.last=0; this.schedule(); this.armPlay(); }
      };
      this.reduce.addEventListener('change',this.motionChanged);
      document.addEventListener('visibilitychange',this.visibilityChanged);
      this.configure(this.settings);
    }
    // All expressions use a level head; emotional eye shapes are preserved.
    expression(id) { return {...EXPRESSION_BY_ID.get(id),gaze:{yaw:0,pitch:0,roll:0}}; }
    baseLook() {
      const direction = this.settings.orientation === 'front' ? {yaw:0,pitch:0} : this.facing;
      return {...direction,mix:1,spin:0,wander:this.settings.mode==='normal' ? .25 : 0};
    }
    get static() { return this.reduce.matches; }
    get continuous() { return this.settings.mode==='normal' && this.settings.idle && !this.dragging && !this.reduce.matches; }
    resetRest() {
      this.clock = 1; this.until = 0; this.returnAt = 0; this.last = 0;
      this.playing = false; this.pointer = null;
      this.controlled = false; this.orbitEngine = null;
      this.engine = new BotEngine(100,'idle',SHAPE_BY_ID.get(this.settings.shape).radii,this.expression(this.settings.expression));
      this.engine.setLook(this.baseLook(),0,.001);
      delete this.host.dataset.reaction; delete this.host.dataset.activity;delete this.host.dataset.animation;
      this.render();
    }
    configure(settings, accent = this.accent, preserve = false) {
      this.stop(); this.settings = C.normalize(settings);
      this.accent = /^#[0-9a-f]{6}$/i.test(accent) ? accent : '#53616d';
      this.host.style.width = this.host.style.height = this.settings.size*1.5+'px';
      this.host.style.opacity = this.settings.opacity/100;
      this.host.dataset.mode = this.settings.mode;
      if(preserve && this.engine) {
        this.engine.setShape(SHAPE_BY_ID.get(this.settings.shape).radii,this.clock);
        this.engine.setExpression(this.expression(this.settings.expression),this.clock);
        if(this.reduce.matches){this.clock+=.6;this.orbitEngine=null;}
        this.until=Math.max(this.until,this.clock+.6);this.render();
      } else this.resetRest();
      this.schedule(); this.armPlay(true);
    }
    setFacing(value) {
      if(!value || !Number.isFinite(value.yaw+value.pitch)) return;
      this.facing = {yaw:Math.max(-16,Math.min(16,value.yaw)),pitch:Math.max(-10,Math.min(10,value.pitch))};
      if(this.pointer || this.settings.orientation==='front') return;
      const moving = this.raf !== null && this.settings.mode!=='static';
      this.engine.setLook(this.baseLook(), moving ? this.clock : this.clock-1, moving ? .2 : .001);
      this.render();
    }
    render() {
      // Hold the drag expression once its morph finishes; native window motion
      // provides the movement, without repeatedly repainting a breathing body.
      const lively = this.settings.mode==='normal' && !this.dragging && !this.reduce.matches;
      const frame = this.engine.sample(this.clock,lively);
      if(this.orbitEngine && !this.reduce.matches) frame.arcs=this.orbitEngine.sample(this.clock,false).arcs;
      const color = this.settings.followAccent ? this.accent : this.settings.color;
      this.body.setAttribute('d',frame.bodyPath); this.body.setAttribute('fill',color);
      this.body.setAttribute('opacity',frame.bodyAlpha);
      this.clipPath.setAttribute('d',frame.bodyPath);
      const rgb = color.slice(1).match(/../g).map(v=>parseInt(v,16));
      const ink = rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722>166 ? '#18212a' : '#fff';
      this.eyeNodes.forEach((el,i)=>{
        const eye=frame.eyes[i];if(!eye){el.setAttribute('opacity',0);return;}
        el.setAttribute('d',eye.d); el.setAttribute('transform',eye.matrix);
        el.setAttribute('opacity',eye.alpha); el.setAttribute('fill',ink);
      });
      this.renderDecor(frame,color);
      this.frames++;
    }
    renderDecor(frame,color) {
      // Reuse SVG nodes while an effect plays, including independent front/back
      // arc segments. This keeps the original depth without rebuilding the DOM.
      const alive=new Set();
      for(const arc of frame.arcs){
        alive.add(arc.id);let record=this.arcNodes.get(arc.id);
        if(!record){
          const id='fb-arc-'+this.id+'-'+arc.id;
          const gradient=node('linearGradient',{id,gradientUnits:'userSpaceOnUse'});
          const stops=[0,.5,1].map(offset=>node('stop',{offset}));gradient.append(...stops);this.defs.append(gradient);
          const attrs={fill:'none',stroke:`url(#${id})`,'stroke-linecap':'round','stroke-linejoin':'round'};
          const back=node('path',attrs),front=node('path',attrs);
          this.backArcs.append(back);this.frontArcs.append(front);
          record={gradient,stops,back,front};this.arcNodes.set(arc.id,record);
        }
        for(const k of ['x1','y1','x2','y2'])record.gradient.setAttribute(k,arc.grad[k]);
        record.stops.forEach((stop,i)=>stop.setAttribute('stop-color',arc.grad.stops[i]));
        for(const [path,d] of [[record.back,arc.back],[record.front,arc.front]]){
          path.setAttribute('d',d);path.setAttribute('stroke-width',arc.width);path.setAttribute('opacity',arc.opacity);
        }
      }
      for(const [id,record] of this.arcNodes)if(!alive.has(id)){
        record.gradient.remove();record.back.remove();record.front.remove();this.arcNodes.delete(id);
      }
      const before=frame.dotsBehind?this.body:this.frontArcs;
      if(this.dots.nextSibling!==before)this.svg.insertBefore(this.dots,before);
      frame.dots.forEach((dot,i)=>{
        const tag=dot.d?'path':'circle';let el=this.dotNodes[i];
        if(!el||el.tagName!==tag){const replacement=node(tag);if(el)el.replaceWith(replacement);else this.dots.append(replacement);el=replacement;this.dotNodes[i]=el;}
        el.setAttribute('fill',dot.color||color);
        el.setAttribute('opacity',dot.opacity*(dot.depth===undefined?1:.35+.65*dot.depth));
        if(dot.d){el.setAttribute('d',dot.d);el.setAttribute('transform',`translate(${dot.x} ${dot.y}) rotate(${dot.rot||0}) scale(${RAYON})`);}
        else{el.setAttribute('cx',dot.x);el.setAttribute('cy',dot.y);el.setAttribute('r',dot.r);}
      });
      while(this.dotNodes.length>frame.dots.length)this.dotNodes.pop().remove();
      for(const [el,value] of [[this.notch,frame.notch],[this.notification,frame.notif]]){
        el.setAttribute('cx',value?.x||0);el.setAttribute('cy',value?.y||0);el.setAttribute('r',value?.r||0);
      }
    }
    setActive(active) {
      if(this.active===!!active) return;
      this.active=!!active;
      if(!this.active) this.stop(); else {this.resetRest();this.schedule();this.armPlay(true);}
    }
    stop() {
      if(this.raf!==null)cancelAnimationFrame(this.raf);
      clearTimeout(this.frameTimer);clearTimeout(this.playTimer);
      this.raf=null;this.frameTimer=null;this.playTimer=null;this.last=0;
    }
    schedule() {
      if(this.destroyed||!this.active||document.hidden||this.reduce.matches)return;
      if(this.raf!==null||(!this.continuous&&this.until<=this.clock))return;
      // Transparent desktop windows can lose compositor callbacks even while
      // visible. Race a 60Hz timer against RAF; only one may render each frame.
      const run=time=>{
        if(this.raf!==null)cancelAnimationFrame(this.raf);
        clearTimeout(this.frameTimer);this.frameTimer=null;this.raf=null;this.tick(time);
      };
      this.raf=requestAnimationFrame(run);
      this.frameTimer=setTimeout(()=>run(performance.now()),1000/60);
    }
    tick(time) {
      this.raf=null;
      if(this.destroyed||!this.active||document.hidden||this.reduce.matches)return;
      if(this.last)this.clock+=Math.min((time-this.last)/1000,.1);
      this.last=time;
      if(this.pointer){
        const {x,y}=this.pointer,k=this.settings.intensity;
        this.engine.setLook({yaw:Math.max(-38,Math.min(38,x*32*k)),pitch:Math.max(-25,Math.min(25,-y*23*k)),mix:1,spin:0,wander:0},this.clock);
        this.pointer=null;
      }
      if(this.returnAt&&this.clock>=this.returnAt)this.rest();
      if(!this.continuous&&this.clock>=this.until){
        if(this.controlled){this.render();return;}
        if(!this.dragging){this.resetRest();this.armPlay();}
        return;
      }
      this.render();this.schedule();
    }
    react(kind,duration=1.05) {
      if(this.controlled)return;
      if(!this.active||this.destroyed||this.reduce.matches||!this.settings.reactions)return;
      if(this.settings.mode==='static'&&!['click','context'].includes(kind))return;
      const id=this.settings[kind+'Expression'];if(!id)return;
      clearTimeout(this.playTimer);this.playTimer=null;this.playing=false;
      this.engine.setState('idle',this.clock);
      this.engine.setShape(SHAPE_BY_ID.get(this.settings.shape).radii,this.clock);
      this.engine.setExpression(this.expression(id),this.clock);
      this.engine.setLook(this.baseLook(),this.clock);
      this.returnAt=this.clock+duration;this.until=this.returnAt+.55;
      this.host.dataset.reaction=kind;delete this.host.dataset.activity;delete this.host.dataset.animation;
      this.schedule();
    }
    rest() {
      const wasControlled=this.controlled;
      this.controlled=false;this.orbitEngine=null;
      this.returnAt=0;this.playing=false;this.pointer=null;
      const at=this.reduce.matches?this.clock-1:this.clock;
      this.engine.setState('idle',at);
      this.engine.setShape(SHAPE_BY_ID.get(this.settings.shape).radii,at);
      this.engine.setExpression(this.expression(this.settings.expression),at);
      this.engine.setLook(this.baseLook(),at);
      this.until=this.clock+.55;
      delete this.host.dataset.reaction;delete this.host.dataset.activity;delete this.host.dataset.animation;
      this.armPlay();
      if(this.reduce.matches)this.render();
      if(wasControlled)this.onActionEnd?.();
    }
    hover(on) {
      this.hovered=on;
      if(this.controlled)return;
      if(this.settings.mode==='static'||this.reduce.matches)return;
      if(on){clearTimeout(this.playTimer);this.playTimer=null;this.react('hover',.8);}
      else if(!this.dragging){
        if(['click','context'].includes(this.host.dataset.reaction)&&this.returnAt>this.clock)return;
        this.rest();this.schedule();
      }
    }
    look(x,y) {
      if(this.controlled)return;
      if(this.settings.mode==='static'||this.reduce.matches||!this.settings.followPointer||this.dragging)return;
      if(!Number.isFinite(x+y))return;
      clearTimeout(this.playTimer);this.playTimer=null;
      this.pointer={x,y};this.until=Math.max(this.until,this.clock+.65);this.schedule();
    }
    setDragging(on) {
      this.dragging=on;clearTimeout(this.playTimer);this.playTimer=null;
      if(on){this.react('drag',3600);this.returnAt=0;this.until=this.clock+.6;}
      else if(this.settings.mode!=='static'){this.rest();this.schedule();}
      else this.armPlay();
    }
    armPlay(first=false) {
      if(this.controlled||this.playTimer!==null||this.destroyed||!this.active||document.hidden||this.reduce.matches||!this.settings.idle||this.settings.mode==='static'||this.hovered||this.dragging)return;
      this.playDelay=this.settings.mode==='low' ? 60000+Math.random()*40000 : (first?5000:9000)+Math.random()*6000;
      this.playTimer=setTimeout(()=>{this.playTimer=null;this.startPlay();},this.playDelay);
    }
    startPlay(requested) {
      if(this.controlled)return false;
      if(this.destroyed||!this.active||document.hidden||this.reduce.matches||!this.settings.idle||this.settings.mode==='static'||this.hovered||this.dragging)return false;
      if(requested!==undefined&&!Object.hasOwn(C.animations,requested))return false;
      clearTimeout(this.playTimer);this.playTimer=null;
      const animation=this.settings.mode==='low'?'morph':requested||Object.keys(C.animations)[this.playIndex%Object.keys(C.animations).length];
      const shapes=['nuage','capsule','goutte','squircle','hexagone','galet'].filter(id=>id!==this.settings.shape);
      const shape=shapes[this.playIndex%shapes.length];
      const expression=this.settings.mode==='low'?this.settings.expression:['heureux','excite','curieux','fier'][this.playIndex%4];
      this.playIndex++;this.playing=true;this.host.dataset.activity='selfplay';
      this.host.dataset.animation=animation;delete this.host.dataset.reaction;this.pointer=null;
      this.engine.setState('idle',this.clock);
      this.engine.setShape(SHAPE_BY_ID.get(animation==='morph'?shape:this.settings.shape).radii,this.clock);
      this.engine.setExpression(this.expression(animation==='morph'?expression:this.settings.expression),this.clock);
      const state=STATE_BY_ID.get(animation);
      if(state){
        this.engine.setState(animation,this.clock);
        this.engine.setLook({...this.baseLook(),mix:0,wander:0},this.clock,state.morph);
      }else this.engine.setLook(this.baseLook(),this.clock);
      const duration=state?Math.max(state.duration,state.minDuration||0):2.2;
      this.returnAt=this.clock+duration;this.until=this.returnAt+.55;
      this.schedule();return true;
    }
    // Explicit app states take priority over hover and autonomous play.
    playAction(animation,{hold=false,activity='preview'}={}) {
      const combined=animation==='thinking-orbit',state=STATE_BY_ID.get(combined?'thinking':animation);
      if(!state && animation!=='morph')return false;
      if(!this.active||this.destroyed)return false;
      clearTimeout(this.playTimer);this.playTimer=null;this.pointer=null;this.orbitEngine=null;
      this.controlled=true;this.playing=!hold;
      this.host.dataset.activity=activity;this.host.dataset.animation=animation;delete this.host.dataset.reaction;
      this.engine.setState(state?state.id:'idle',this.clock);
      this.engine.setShape(SHAPE_BY_ID.get(animation==='morph'?'nuage':this.settings.shape).radii,this.clock);
      this.engine.setExpression(this.expression(this.settings.expression),this.clock);
      this.engine.setLook({...this.baseLook(),mix:animation==='wide'?1:0,wander:0},this.clock,.4);
      if(combined && !this.reduce.matches){
        this.orbitEngine=new BotEngine(100,'idle');this.orbitEngine.setState('orbit',this.clock);
      }
      const duration=combined?3.6:state?Math.max(state.duration,state.minDuration||0):2.2;
      this.returnAt=hold?0:this.clock+duration;this.until=hold?this.clock+.65:this.returnAt+.55;
      if(this.reduce.matches){
        // Show a readable still pose when system motion is reduced.
        this.engine.setState(hold?'wide':'idle',this.clock-1);
        this.engine.setExpression(this.expression(hold?this.settings.expression:'attentif'),this.clock-1);
        this.returnAt=0;this.until=0;
      }
      this.render();this.schedule();return true;
    }
    destroy() {
      this.destroyed=true;this.stop();
      this.reduce.removeEventListener('change',this.motionChanged);
      document.removeEventListener('visibilitychange',this.visibilityChanged);
    }
  }
  window.FloatballAvatar=Avatar;
})();
