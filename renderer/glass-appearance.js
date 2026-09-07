(() => {
  const section = document.createElement('section'); section.id = 'glass-settings';
  section.innerHTML = `<h3 class="panel-heading">毛玻璃透明度</h3><div class="glass-setting-row"><label for="glass-transparency">面板透明度</label><output id="glass-value" for="glass-transparency">20%</output><button id="glass-reset" type="button">恢复默认</button></div><input id="glass-transparency" type="range" min="0" max="70" step="1" value="20" aria-describedby="glass-description"><p id="glass-description" class="setting-hint">0% 更实，70% 更通透。调整导航胶囊、侧栏、标签栏、设置和任务面板的背景，网页与文字保持清晰。</p>`;
  document.getElementById('panel-appearance').append(section);
  const slider = document.getElementById('glass-transparency'), output = document.getElementById('glass-value');
  let timer;
  const read = localStorage.getItem('aihub-glass-transparency');
  function apply(raw) {
    const value = Math.min(70, Math.max(0, Number.isFinite(Number(raw)) ? Math.round(Number(raw)) : 20));
    slider.value = value; output.value = value + '%';
    document.documentElement.style.setProperty('--glass-alpha', String(1 - value / 100));
    localStorage.setItem('aihub-glass-transparency', String(value));
    clearTimeout(timer);
    timer = setTimeout(() => window.app.setGlassTransparency(value), 120);
  }
  slider.addEventListener('input', () => apply(slider.value));
  document.getElementById('glass-reset').addEventListener('click', () => apply(20));
  apply(read === null ? 20 : read);
})();
