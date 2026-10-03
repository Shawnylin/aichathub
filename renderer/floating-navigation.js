(() => {
  const host = document.getElementById('webview-container');
  const oldBar = document.getElementById('navbar');
  const overlay = document.createElement('div'); overlay.id = 'floating-controls';
  overlay.innerHTML = `
    <div id="nav-hover-region"><div id="nav-capsule" class="browser-capsule"><div id="nav-capsule-actions"></div></div></div>
    <div id="url-capsule" class="browser-capsule">
      <div id="url-capsule-field"></div>
      <button id="url-reveal" class="capsule-trigger" type="button" aria-label="输入网址或搜索" aria-expanded="false" aria-controls="url-capsule-field" title="输入网址或搜索（Ctrl+L）">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/></svg>
      </button>
    </div>`;
  host.append(overlay);
  ['nav-back', 'nav-fwd', 'nav-refresh'].forEach(id => {
    const control = document.getElementById(id);
    control.setAttribute('aria-label', control.title);
    document.getElementById('nav-capsule-actions').append(control);
  });
  const input = document.getElementById('url-bar');
  input.setAttribute('aria-label', '网址或搜索关键词');
  document.getElementById('url-capsule-field').append(input);
  const download = document.getElementById('dl-btn');
  download.setAttribute('aria-label', '下载管理');
  document.querySelector('.sidebar-footer').append(download);
  oldBar.remove();
  const nav = document.getElementById('nav-capsule'), url = document.getElementById('url-capsule');
  const region = document.getElementById('nav-hover-region');
  document.body.append(region);
  const tabs = document.getElementById('top-tabs');
  const tabBar = document.getElementById('tab-bar');
  tabBar.insertBefore(url, document.getElementById('new-tab-btn'));
  let closeTimer;
  const siteTab = () => tabs.querySelector('.site-tab');
  const siteTrigger = () => tabs.querySelector('.site-nav-trigger');
  function positionNav() {
    const rect = siteTab()?.getBoundingClientRect();
    if (!rect) return;
    region.style.left = Math.max(0, Math.min(window.innerWidth - 144, rect.left - 12)) + 'px';
    region.style.top = rect.bottom + 'px';
  }
  function scheduleClose() {
    clearTimeout(closeTimer);
    closeTimer = setTimeout(() => {
      if (!region.matches(':hover') && !siteTab()?.matches(':hover') && !region.contains(document.activeElement) && document.activeElement !== siteTrigger()) toggle(nav, false);
    }, 320);
  }
  function toggle(capsule, open) {
    capsule.classList.toggle('is-open', open);
    if (capsule === nav) {
      clearTimeout(closeTimer); positionNav(); region.classList.toggle('is-open', open);
      siteTrigger()?.setAttribute('aria-expanded', String(open));
    } else capsule.querySelector('.capsule-trigger').setAttribute('aria-expanded', String(open));
  }
  function open(capsule) {
    const other = capsule === nav ? url : nav;
    if (other.contains(document.activeElement)) return;
    toggle(other, false); toggle(capsule, true);
  }
  for (const capsule of [nav, url]) {
    capsule.addEventListener('pointerenter', () => open(capsule));
    capsule.addEventListener('pointerleave', () => { if (capsule === nav) scheduleClose(); else if (!capsule.contains(document.activeElement)) toggle(capsule, false); });
    capsule.addEventListener('focusin', () => { toggle(capsule === nav ? url : nav, false); toggle(capsule, true); });
    capsule.addEventListener('focusout', () => queueMicrotask(() => { if (!capsule.contains(document.activeElement)) toggle(capsule, false); }));
    capsule.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); document.activeElement?.blur(); toggle(capsule, false); }
    });
  }
  document.getElementById('url-reveal').addEventListener('click', () => { toggle(nav, false); toggle(url, true); input.focus(); });
  tabs.addEventListener('pointerover', event => { if (event.target.closest('.site-tab')) open(nav); });
  tabs.addEventListener('pointerout', event => { if (event.target.closest('.site-tab')) scheduleClose(); });
  tabs.addEventListener('click', event => { if (event.target.closest('.site-nav-trigger')) { toggle(url, false); toggle(nav, true); } });
  tabs.addEventListener('keydown', event => {
    if (!event.target.closest('.site-nav-trigger')) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault(); toggle(nav, true);
      requestAnimationFrame(() => requestAnimationFrame(() => { if (nav.classList.contains('is-open')) nav.querySelector('button:not(:disabled)')?.focus(); }));
    }
    if (event.key === 'Escape') { event.preventDefault(); toggle(nav, false); }
  });
  tabs.addEventListener('focusout', scheduleClose);
  region.addEventListener('pointerenter', () => { clearTimeout(closeTimer); });
  region.addEventListener('pointerleave', scheduleClose);
  new MutationObserver(() => { if (nav.classList.contains('is-open')) { positionNav(); siteTrigger()?.setAttribute('aria-expanded', 'true'); } }).observe(tabs, { childList:true });
  window.addEventListener('resize', positionNav);
  tabs.addEventListener('scroll', positionNav);
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter') { input.blur(); toggle(url, false); }
  });
  // Keep unavailable controls out of the keyboard sequence too.
  const state = () => ['nav-back', 'nav-fwd'].forEach(id => { const control = document.getElementById(id); control.disabled = control.classList.contains('disabled'); });
  const observer = new MutationObserver(state);
  ['nav-back', 'nav-fwd'].forEach(id => observer.observe(document.getElementById(id), { attributes: true, attributeFilter: ['class'] })); state();
})();
