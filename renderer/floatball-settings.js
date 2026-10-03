(() => {
  const C=window.FloatballConfig, panel=document.getElementById('panel-floatball');
  const status=document.getElementById('fb-save-status'), retry=document.getElementById('fb-save-retry');
  const preview=window.Companion.avatar;
  let settings=C.normalize(),accent='#53616d',facing={yaw:-14,pitch:8},pending=false,saving=false,debounce,loaded=false;
  const fields=[...panel.querySelectorAll('[data-fb-key]')];
  fields.forEach(input=>input.disabled=true);
  const titles={normal:'你好，我在这里',low:'我先安静休息一会儿',static:'安静地陪着你'};
  const descriptions={normal:'活力模式',low:'低精力模式',static:'静止模式'};
  for(const [id,label] of Object.entries({...C.animations,wide:'睁大眼睛','thinking-orbit':'思考 · 轨道'})){
    const button=document.createElement('button');button.type='button';button.dataset.fbAnimation=id;
    button.textContent=label;button.setAttribute('aria-pressed','false');button.disabled=true;
    button.addEventListener('click',()=>window.Companion.preview(id));document.getElementById('fb-animation-buttons').append(button);
  }
  for(const [id,label] of Object.entries(C.shapes)) {
    const button=document.createElement('button');button.type='button';button.dataset.fbShape=id;
    const icon=document.createElement('span');icon.className='fb-shape-icon';button.append(icon,document.createTextNode(label));
    const thumb=new FloatballAvatar(icon,{...C.defaults,shape:id,mode:'static',orientation:'front',size:24});thumb.destroy();icon.style.width=icon.style.height='36px';
    button.addEventListener('click',()=>edit({shape:id}));document.getElementById('fb-shapes').append(button);
  }
  const colorNames=['墨黑','棕色','红色','橙色','琥珀','绿色','青绿','蓝色','紫色','粉色','灰色','奶白'];
  Bloub.COLORS.forEach((color,i)=>{
    const b=document.createElement('button');b.type='button';b.className='fb-color-swatch';b.dataset.fbColor=color.hex;
    b.setAttribute('aria-label',colorNames[i]);b.title=colorNames[i];b.style.setProperty('--swatch',color.hex);
    b.append(document.createElement('span'));b.addEventListener('click',()=>edit({color:color.hex,followAccent:false}));document.getElementById('fb-colors').append(b);
  });
  panel.querySelectorAll('#fb-expression,select[data-fb-key$="Expression"]').forEach(select=>{
    for(const [id,label] of Object.entries(C.expressions)){const option=document.createElement('option');option.value=id;option.textContent=label;select.append(option);}
  });
  function message(text,error=false){status.textContent=text;status.dataset.error=String(error);retry.hidden=!error||!pending;}
  function render() {
    fields.forEach(input=>{
      const key=input.dataset.fbKey;
      if(input.type==='checkbox')input.checked=settings[key];else input.value=settings[key];
      input.disabled=!loaded;
      if(['followPointer','intensity','idle'].includes(key))input.disabled ||=settings.mode==='static';
      if(['hoverExpression','dragExpression'].includes(key))input.disabled ||=settings.mode==='static';
      if(key.endsWith('Expression'))input.disabled ||=!settings.reactions;
    });
    panel.querySelectorAll('[data-fb-shape]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.fbShape===settings.shape)));
    panel.querySelectorAll('[data-fb-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.fbMode===settings.mode)));
    panel.querySelectorAll('[data-fb-color]').forEach(b=>b.setAttribute('aria-pressed',String(!settings.followAccent&&b.dataset.fbColor.toLowerCase()===settings.color.toLowerCase())));
    document.getElementById('fb-color-hex').value=settings.color;
    document.getElementById('fb-size-value').textContent=settings.size+' px';
    document.getElementById('fb-opacity-value').textContent=settings.opacity+'%';
    document.getElementById('fb-intensity-value').textContent=settings.intensity.toFixed(1)+'×';
    document.getElementById('fb-preview-title').textContent=titles[settings.mode];
    document.getElementById('fb-mode-description').textContent=descriptions[settings.mode];
    panel.querySelectorAll('[data-fb-animation]').forEach(button=>button.disabled=!loaded);
    window.Companion.configure({settings,accent,facing});
  }
  function edit(patch) {
    if(!loaded)return;
    settings=C.normalize({...settings,...patch});pending=true;render();message('正在保存…');
    clearTimeout(debounce);debounce=setTimeout(save,180);
  }
  async function save() {
    if(saving||!pending)return;
    saving=true;pending=false;const snapshot={...settings};
    try {
      const result=await window.app.setFloatballSettings(snapshot);
      if(!result?.ok)throw new Error(result?.error||'无法保存设置，请重试');
      accent=result.accent||accent;
      if(!pending){settings=C.normalize(result.settings);render();message('已保存');}
    } catch(error){
      pending=true;message(error.message,true);saving=false;return;
    }
    saving=false;if(pending)save();
  }
  fields.forEach(input=>input.addEventListener(input.type==='range'?'input':'change',()=>{
    const k=input.dataset.fbKey,v=input.type==='checkbox'?input.checked:input.type==='range'?Number(input.value):input.value;
    edit(k==='color'?{color:v,followAccent:false}:{[k]:v});
  }));
  panel.querySelectorAll('[data-fb-mode]').forEach(b=>b.addEventListener('click',()=>edit({mode:b.dataset.fbMode})));
  document.getElementById('fb-color-apply').addEventListener('click',()=>{
    const value=document.getElementById('fb-color-hex').value.trim();
    if(!/^#[0-9a-f]{6}$/i.test(value)){message('请输入完整颜色，例如 #53616d。',true);return;}
    edit({color:value,followAccent:false});
  });
  document.getElementById('fb-reset-style').addEventListener('click',()=>edit({...C.defaults}));
  document.getElementById('fb-random').addEventListener('click',()=>{
    const pick=a=>a[Math.floor(Math.random()*a.length)];
    edit({shape:pick(Object.keys(C.shapes)),expression:pick(Object.keys(C.expressions)),color:pick(Bloub.COLORS).hex,followAccent:false});
  });
  retry.addEventListener('click',()=>{message('正在重试保存…');save();});
  document.getElementById('fb-source-link').addEventListener('click',e=>{e.preventDefault();window.app.openExternal('https://github.com/jeremy-prt/bloub');});
  document.getElementById('fb-test-drag').addEventListener('click',()=>{window.Companion.resetPreview();preview.react('drag');});
  window.app.onOpenSettingsPanel?.(name=>{
    if(name!=='floatball')return;
    document.getElementById('settings-overlay').classList.add('show');document.querySelector('[data-panel="floatball"]').click();
  });
  window.app.onFloatballSettingsChange?.(value=>{
    if(!value?.settings)return;accent=value.accent||accent;facing=value.facing||facing;
    if(!pending&&!saving)settings=C.normalize(value.settings);
    render();
  });
  window.app.getFloatballSettings().then(value=>{
    if(value?.settings){settings=C.normalize(value.settings);accent=value.accent||accent;facing=value.facing||facing;}
    loaded=true;render();message('已保存');
  }).catch(()=>{loaded=true;render();message('无法读取设置，修改后可重试保存。',true);});
  window.addEventListener('beforeunload',()=>clearTimeout(debounce));
})();
