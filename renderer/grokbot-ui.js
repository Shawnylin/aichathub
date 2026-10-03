/* Keep focus inside app-owned modal sheets, then return to the opening control. */
(() => {
  const sheets = ['settings', 'site-form', 'close'].map(id => ({
    overlay: document.getElementById(id + '-overlay'),
    dialog: document.getElementById(id + '-dialog'),
    opener: null,
    open: false,
  }));
  const focusable = dialog => [...dialog.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]')]
    .filter(node => node.getClientRects().length && getComputedStyle(node).visibility === 'visible');
  for (const sheet of sheets) {
    const update = () => {
      const open = sheet.overlay.classList.contains('show');
      sheet.dialog.setAttribute('aria-hidden', String(!open));
      if (open === sheet.open) return;
      sheet.open = open;
      if (open) {
        sheet.opener = document.activeElement;
        if (!sheet.dialog.contains(document.activeElement)) sheet.dialog.focus({ preventScroll: true });
      } else if (sheet.dialog.contains(document.activeElement) && sheet.opener?.isConnected) {
        sheet.opener.focus({ preventScroll: true });
      }
    };
    new MutationObserver(update).observe(sheet.overlay, { attributes: true, attributeFilter: ['class'] });
    sheet.overlay.addEventListener('keydown', event => {
      if (event.key !== 'Tab' || !sheet.open) return;
      const controls = focusable(sheet.dialog);
      const first = controls[0], last = controls.at(-1);
      if (!first) { event.preventDefault(); sheet.dialog.focus(); return; }
      if (!sheet.dialog.contains(document.activeElement) || document.activeElement === sheet.dialog ||
          (event.shiftKey && document.activeElement === first) || (!event.shiftKey && document.activeElement === last)) {
        event.preventDefault(); (event.shiftKey ? last : first).focus();
      }
    });
    update();
  }
  document.addEventListener('focusin', event => {
    if (document.querySelector('dialog:modal')) return;
    const top = sheets.filter(sheet => sheet.open).at(-1);
    if (top && !top.dialog.contains(event.target)) top.dialog.focus({ preventScroll: true });
  });
})();
