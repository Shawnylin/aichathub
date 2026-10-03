const { ipcRenderer } = require('electron');
(() => {
  let composing=false, last='idle';
  const editable = el => el instanceof HTMLElement && !el.closest('[inert]') &&
    !el.disabled && !el.readOnly && (el.isContentEditable ||
    el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement &&
      ['text','search','url','tel','email',''].includes(el.type)));
  const target = event => event.composedPath().find(editable);
  const populated = el => !!(el && (el.isContentEditable ? el.textContent?.trim() : el.value?.trim()));
  const send = kind => { if(kind!==last || kind==='submit'){last=kind;ipcRenderer.sendToHost('companion-activity',kind);} };
  document.addEventListener('compositionstart',event=>{if(target(event))composing=true;},true);
  document.addEventListener('compositionend',event=>{composing=false;if(target(event))send(populated(target(event))?'typing':'idle');},true);
  document.addEventListener('input',event=>{const el=target(event);if(el)send(populated(el)?'typing':'idle');},true);
  document.addEventListener('focusin',event=>{const el=target(event);send(el&&populated(el)?'typing':'idle');},true);
  document.addEventListener('keydown',event=>{
    const el=target(event);
    if(el && populated(el) && event.key==='Enter' && !composing && !event.isComposing && event.keyCode!==229 &&
      !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey)send('submit');
  },true);
  document.addEventListener('focusout',()=>queueMicrotask(()=>{
    let el=document.activeElement;while(el?.shadowRoot?.activeElement)el=el.shadowRoot.activeElement;
    if(!editable(el))send('idle');
  }),true);
  window.addEventListener('blur',()=>{composing=false;send('idle');});
  // Only these three states cross the bridge; page content stays in the guest.
})();
