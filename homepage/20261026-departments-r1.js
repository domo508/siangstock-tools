(() => {
  'use strict';
  const root = document.getElementById('siang-departments');
  if (!root) return;
  const APP_VERSION = root.dataset.version;
  const cards = [...root.querySelectorAll('[data-tool]')];
  const buttons = [...root.querySelectorAll('[data-dept]')];
  const search = root.querySelector('input[type="search"]');
  const warning = document.getElementById('version-warning');
  const reload = document.getElementById('reload-latest');
  let department = 'all';
  let verified = false;
  let stale = false;
  let checking = null;

  function render() {
    let count = 0;
    cards.forEach(card => {
      const matchesDepartment = department === 'all' || card.dataset.departments.split(' ').includes(department);
      const matchesSearch = card.textContent.toLocaleLowerCase().includes(search.value.trim().toLocaleLowerCase());
      card.hidden = !matchesDepartment || !matchesSearch;
      if (!card.hidden) count++;
    });
    buttons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.dept === department)));
    const selected = buttons.find(button => button.dataset.dept === department);
    root.querySelector('.sh-results-title').textContent = selected.dataset.label;
    root.querySelector('.sh-caption').textContent = `${count} 支工具${department === 'all' ? ' · 跨部門工具只計一次' : ' · 含主責與協作工具'}`;
    const empty = root.querySelector('.sh-empty');
    empty.hidden = count !== 0;
    empty.textContent = search.value.trim() ? '沒有符合的工具，請試試其他名稱。' : '此部門目前尚無工具，後續新增工具會顯示於此。';
  }

  function showWarning(message, latest) {
    verified = false;
    warning.hidden = false;
    warning.querySelector('p').textContent = message;
    const target = new URL('/', location.origin);
    target.searchParams.set('deploy', latest || APP_VERSION);
    target.searchParams.set('reload', String(Date.now()));
    reload.href = target.pathname + target.search;
    cards.forEach(card => card.querySelector('a')?.setAttribute('aria-disabled', 'true'));
  }

  async function checkRuntimeVersion() {
    if (stale) return false;
    if (checking) return checking;
    checking = (async () => {
      try {
        const response = await fetch(`/homepage/version.json?check=${Date.now()}`, { cache: 'no-store', credentials: 'same-origin', redirect: 'error' });
        if (!response.ok || !(response.headers.get('Content-Type') || '').includes('application/json')) throw new Error('version unavailable');
        const current = await response.json();
        if (typeof current.version !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(current.version)) throw new Error('invalid version');
        if (current.version !== APP_VERSION) {
          stale = true;
          showWarning('首頁已更新，請重新載入最新版後再開啟工具。', current.version);
          return false;
        }
        verified = true;
        warning.hidden = true;
        cards.forEach(card => card.querySelector('a')?.removeAttribute('aria-disabled'));
        return true;
      } catch {
        showWarning('暫時無法確認首頁版本，請重新載入最新版，或稍後再試。');
        return false;
      } finally {
        checking = null;
      }
    })();
    return checking;
  }

  buttons.forEach(button => button.addEventListener('click', () => { department = button.dataset.dept; render(); }));
  search.addEventListener('input', render);
  root.querySelectorAll('[data-enhancement]').forEach(element => { element.hidden = false; });
  // Every entry checks the deployment again immediately before leaving this page.
  cards.forEach(card => {
    const link = card.querySelector('a');
    if (!link) return;
    link.addEventListener('click', async event => {
      event.preventDefault();
      const href = link.getAttribute('href');
      if (!await checkRuntimeVersion() || !verified || stale) return;
      if (event.ctrlKey || event.metaKey || event.shiftKey) window.open(href, '_blank', 'noopener');
      else location.assign(href);
    });
    link.addEventListener('auxclick', event => {
      if (event.button !== 1) return;
      // Preserve a synchronous user gesture for the new tab, then verify before navigation.
      event.preventDefault();
      if (stale) { showWarning('首頁已更新，請重新載入最新版後再開啟工具。'); return; }
      const tab = window.open('about:blank', '_blank');
      if (tab) tab.opener = null;
      checkRuntimeVersion().then(ok => { if (ok && tab) tab.location.replace(link.href); else tab?.close(); });
    });
  });
  window.addEventListener('focus', checkRuntimeVersion);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkRuntimeVersion(); });
  setInterval(checkRuntimeVersion, 5 * 60 * 1000);
  render();
  checkRuntimeVersion();
})();
