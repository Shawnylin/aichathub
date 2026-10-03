(() => {
  const launcher=document.getElementById('float-launcher'), avatar=new FloatballAvatar(document.getElementById('float-avatar'));
  let pointerId=null,startX=0,startY=0,dragged=false,opening=false,openTimer;
  function configure(value){if(value?.settings){avatar.configure(value.settings,value.accent);avatar.setFacing(value.facing);}}
  window.float.onSettingsChange(configure);window.float.getSettings().then(configure);
  window.float.onFacingChange(value=>avatar.setFacing(value));
  launcher.addEventListener('pointerenter',()=>avatar.hover(true));
  launcher.addEventListener('pointerleave',()=>avatar.hover(false));
  launcher.addEventListener('contextmenu',e=>{e.preventDefault();avatar.react('context',1.6);window.float.showContextMenu();});
  launcher.addEventListener('pointerdown',e=>{
    if(e.button!==0||pointerId!==null||opening)return;
    pointerId=e.pointerId;startX=e.screenX;startY=e.screenY;dragged=false;
    launcher.setPointerCapture(pointerId);launcher.classList.add('is-pressed');
  });
  launcher.addEventListener('pointermove',e=>{
    if(!dragged){const r=launcher.getBoundingClientRect();avatar.look((e.clientX-r.x-r.width/2)/(r.width/2),(e.clientY-r.y-r.height/2)/(r.height/2));}
    if(pointerId!==e.pointerId)return;
    if(!dragged&&Math.abs(e.screenX-startX)+Math.abs(e.screenY-startY)>4){
      dragged=true;launcher.classList.add('is-dragging');avatar.setDragging(true);
      window.float.onDragStart(startX,startY);
    }
  });
  function finish(e,cancel=false){
    if(pointerId===null||(e&&e.pointerId!==pointerId))return;
    const id=pointerId;pointerId=null;if(launcher.hasPointerCapture(id))launcher.releasePointerCapture(id);
    launcher.classList.remove('is-pressed','is-dragging');
    if(dragged){window.float.onDragEnd();avatar.setDragging(false);avatar.hover(false);}else if(!cancel)open();dragged=false;
  }
  function open(){
    if(opening)return;opening=true;
    launcher.classList.add('is-opening');avatar.setActive(false);
    openTimer=setTimeout(()=>window.float.onClick(),avatar.static?0:240);
  }
  launcher.addEventListener('pointerup',e=>finish(e));
  launcher.addEventListener('pointercancel',e=>finish(e,true));
  launcher.addEventListener('lostpointercapture',e=>finish(e,true));
  launcher.addEventListener('click',e=>{if(e.detail===0)open();});
  window.float.onFadeOut(()=>{launcher.classList.add('is-hidden');avatar.setActive(false);});
  window.float.onFadeIn(()=>{launcher.classList.remove('is-hidden');avatar.setActive(true);});
  window.addEventListener('beforeunload',()=>{clearTimeout(openTimer);avatar.destroy();});
})();
