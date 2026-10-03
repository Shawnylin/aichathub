(() => {
  const dock=document.getElementById('sidebar-companion-slot'),overlay=document.getElementById('settings-overlay');
  const panel=document.getElementById('panel-floatball'),slot=document.getElementById('fb-preview');
  const button=document.createElement('button');button.id='companion';button.type='button';button.setAttribute('aria-label','GrokBot');
  const host=document.createElement('span');host.id='companion-avatar';button.append(host);dock.append(button);
  const avatar=new FloatballAvatar(host),states=new WeakMap(),attached=new WeakSet();
  let settings=FloatballConfig.normalize(),accent='#53616d',transition=null,settingsOpen=false,previewing=false,resetting=false,fallbackTimer,activeGuest=null;
  const motion=matchMedia('(prefers-reduced-motion: reduce)');
  const inComparison=()=>document.body.classList.contains('comparison-open');
  const shown=view=>view?.isConnected && (inComparison()?view.classList.contains('cmp-webview') &&
    view.getBoundingClientRect().width>0:view.classList.contains('visible'));
  const currentView=()=>inComparison()?(shown(activeGuest)?activeGuest:
    [...document.querySelectorAll('webview.cmp-webview')].find(shown)):
    document.querySelector('webview.visible');
  function clearSelection(){panel.querySelectorAll('[data-fb-animation]').forEach(b=>b.setAttribute('aria-pressed','false'));}
  function reset(){resetting=true;clearTimeout(fallbackTimer);previewing=false;avatar.rest();clearSelection();resetting=false;avatar.schedule();}
  function resume(){
    if(resetting)return;
    previewing=false;clearSelection();
    if(!settingsOpen && states.get(currentView())==='typing')avatar.playAction('wide',{hold:true,activity:'typing'});
  }
  avatar.onActionEnd=resume;
  function play(id,activity='preview'){
    clearTimeout(fallbackTimer);previewing=activity==='preview';clearSelection();
    if(!avatar.playAction(id,{activity}))return;
    if(previewing)panel.querySelector(`[data-fb-animation="${id}"]`)?.setAttribute('aria-pressed','true');
    if(motion.matches)fallbackTimer=setTimeout(()=>{reset();resume();},900);
  }
  function locate(animate=false){
    const before=button.getBoundingClientRect(),open=overlay.classList.contains('show');
    const customized=open && panel.classList.contains('active');
    const parent=customized?slot:open?overlay:dock;
    const moved=button.parentElement!==parent;
    if(moved){transition?.cancel();parent.append(button);}
    const r=(customized?slot:dock).getBoundingClientRect();
    const size=Math.min(settings.size*1.5,r.width-4,r.height-4);
    button.style.width=button.style.height=Math.max(24,size)+'px';
    button.style.left=open&&!customized?r.x+(r.width-size)/2+'px':'';
    button.style.top=open&&!customized?r.y+(r.height-size)/2+'px':'';
    // While a modal is open the companion is part of that modal's focus scope.
    button.tabIndex=open&&!customized?-1:0;
    if(moved && animate && !motion.matches){
      const after=button.getBoundingClientRect();
      transition=button.animate([{transform:`translate(${before.x-after.x}px,${before.y-after.y}px)`},{transform:'translate(0,0)'}],{duration:280,easing:'cubic-bezier(.2,0,0,1)'});
    }
    if(settingsOpen!==open){settingsOpen=open;reset();if(!open)resume();}
  }
  function configure(value){
    if(!value?.settings)return;
    const next=FloatballConfig.normalize(value.settings),nextAccent=value.accent||accent;
    if(JSON.stringify(next)!==JSON.stringify(settings)||accent!==nextAccent){
      settings=next;accent=nextAccent;avatar.configure(settings,accent,true);
    }
    if(value.facing)avatar.setFacing(value.facing);
    locate();
  }
  function activity(view,kind){
    if(!['typing','idle','submit'].includes(kind))return;
    states.set(view,kind==='submit'?'idle':kind);
    if(settingsOpen || !shown(view))return;
    activeGuest=view;
    if(kind==='typing'){
      clearTimeout(fallbackTimer);previewing=false;
      if(host.dataset.activity!=='typing')avatar.playAction('wide',{hold:true,activity:'typing'});
    } else if(kind==='submit')play('thinking-orbit','thinking');
    else if(host.dataset.activity!=='thinking'){reset();}
  }
  function attach(){
    document.querySelectorAll('webview').forEach(view=>{
      if(attached.has(view))return;attached.add(view);
      view.addEventListener('ipc-message',e=>{
        if(e.channel==='companion-activity' && e.args.length===1 && typeof e.args[0]==='string')activity(view,e.args[0]);
      });
      view.addEventListener('did-start-loading',()=>activity(view,'idle'));
    });
  }
  button.addEventListener('pointerenter',()=>avatar.hover(true));
  button.addEventListener('pointerleave',()=>avatar.hover(false));
  button.addEventListener('pointermove',e=>{const r=button.getBoundingClientRect();avatar.look((e.clientX-r.x-r.width/2)/(r.width/2),(e.clientY-r.y-r.height/2)/(r.height/2));});
  button.addEventListener('click',()=>{if(previewing)reset();avatar.react('click');});
  button.addEventListener('contextmenu',e=>{e.preventDefault();if(previewing)reset();avatar.react('context');});
  const observer=new MutationObserver(records=>{
    attach();
    if(records.some(r=>r.target===overlay||r.target===panel)){locate(true);return;}
    if(!settingsOpen && records.some(r=>(r.target.tagName==='WEBVIEW'||r.target===document.body) && r.attributeName==='class')){reset();resume();}
  });
  observer.observe(document.getElementById('webview-container'),{childList:true,subtree:true,attributes:true,attributeFilter:['class']});
  observer.observe(overlay,{attributes:true,attributeFilter:['class']});observer.observe(panel,{attributes:true,attributeFilter:['class']});
  observer.observe(document.body,{attributes:true,attributeFilter:['class']});
  const resize=new ResizeObserver(()=>locate());resize.observe(dock);resize.observe(slot);
  window.addEventListener('resize',()=>locate());
  window.app.onCompanionArrival?.(()=>{
    avatar.setActive(true);locate();play('burst','arrival');
  });
  window.app.onFloatballSettingsChange?.(configure);
  const motionChanged=()=>{if(motion.matches){reset();resume();}};
  motion.addEventListener('change',motionChanged);
  // Settings owns saving; this one avatar owns both the dock and live preview.
  window.Companion={avatar,configure,preview:id=>play(id),resetPreview:()=>{reset();resume();}};
  attach();locate();
  window.app.getFloatballSettings().then(configure).catch(()=>{});
  window.addEventListener('beforeunload',()=>{clearTimeout(fallbackTimer);transition?.cancel();motion.removeEventListener('change',motionChanged);observer.disconnect();resize.disconnect();avatar.destroy();});
})();
