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
  const editor = document.getElementById('department-editor');
  const primary = document.getElementById('editor-primary');
  const nameInput = document.getElementById('editor-name');
  const validName = value => typeof value === 'string' && value.trim().length > 0 && [...value.trim()].length <= 80 && !/[\u0000-\u001f\u007f-\u009f]/u.test(value);
  const collaboratorList = document.getElementById('editor-collaborators');
  const fields = document.getElementById('editor-fields');
  const saveButton = document.getElementById('editor-save');
  const errorBox = document.getElementById('editor-error');
  const deptLabels = new Map(buttons.filter(b => b.dataset.dept !== 'all').map(b => [b.dataset.dept, b.dataset.label]));
  let sharedSettings = null;
  let editingCard = null;
  let draftCollaborators = [];
  let saving = false;
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
    buttons.forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.dept === department));
      const count = cards.filter(card => button.dataset.dept === 'all' || card.dataset.departments.split(' ').includes(button.dataset.dept)).length;
      button.querySelector('.sh-count').textContent = count;
      button.setAttribute('aria-label', `${button.dataset.label}，${count} 支工具`);
    });
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


  function setError(message) {
    errorBox.textContent = message;
    errorBox.hidden = !message;
  }

  async function readResponse(response) {
    const type = response.headers.get('Content-Type') || '';
    if (!type.includes('application/json')) throw new Error('公司登入可能已失效，請重新登入後再試。');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '部門設定暫時無法使用。');
    if (data.runtimeVersion !== APP_VERSION) { stale=true; showWarning('首頁已更新，請重新載入最新版後再調整部門。', data.runtimeVersion); throw new Error('首頁與部門服務版本不同，請重新載入最新版。'); }
    if (!Number.isSafeInteger(data.version) || data.version < 1 || typeof data.canManage !== 'boolean' || !Array.isArray(data.assignments)) throw new Error('部門設定格式不正確，停止套用。');
    const ids = new Set();
    for (const row of data.assignments) {
      if (!row || typeof row.toolId !== 'string' || ids.has(row.toolId) || (Object.hasOwn(row,'displayName') && !validName(row.displayName)) || !deptLabels.has(row.primary) || !Array.isArray(row.collaborators) || row.collaborators.some(id => !deptLabels.has(id) || id === row.primary) || new Set(row.collaborators).size !== row.collaborators.length) throw new Error('部門設定格式不正確，停止套用。');
      ids.add(row.toolId);
    }
    return data;
  }

  function applySettings(data) {
    sharedSettings = data;
    cards.forEach(card => {
      const setting = data.assignments.find(row => row.toolId === card.dataset.tool);
      const name = setting?.displayName || card.dataset.originalName;
      card.querySelector('h3').textContent = name;
      card.querySelector('[data-edit-tool]').setAttribute('aria-label', `設定${name}名稱與部門`);
      card.querySelector('a.sh-open')?.setAttribute('aria-label', `開啟${name}`);
      if (!setting) return; // Newly deployed tools keep their explicitly configured default assignment.
      const groups = [setting.primary, ...setting.collaborators];
      card.dataset.primary = setting.primary;
      card.dataset.collaborators = setting.collaborators.join(' ');
      card.dataset.departments = groups.join(' ');
      card.querySelector('.sh-owner').textContent = groups.map(id => deptLabels.get(id)).join('・') + (setting.collaborators.length ? '協作' : '');
    });
    render();
  }

  async function loadSettings() {
    const response = await fetch(`/api/rules/homepage?check=${Date.now()}`, {cache:'no-store', credentials:'same-origin', redirect:'error'});
    const data = await readResponse(response);
    applySettings(data);
    return data;
  }

  function drawCollaborators() {
    collaboratorList.replaceChildren();
    for (const [id, label] of deptLabels) {
      if (id === primary.value) continue;
      const wrap = document.createElement('label');
      const input = document.createElement('input');
      input.type = 'checkbox'; input.value = id; input.checked = draftCollaborators.includes(id);
      input.addEventListener('change', () => { draftCollaborators = input.checked ? [...new Set([...draftCollaborators,id])] : draftCollaborators.filter(value => value !== id); });
      wrap.append(input,document.createTextNode(label)); collaboratorList.append(wrap);
    }
  }

  for (const [id,label] of deptLabels) {
    const option = document.createElement('option'); option.value=id; option.textContent=label; primary.append(option);
  }
  primary.addEventListener('change', () => { draftCollaborators=draftCollaborators.filter(id=>id!==primary.value); drawCollaborators(); });

  async function openEditor(card) {
    editingCard = card;
    document.getElementById('editor-title').textContent = card.querySelector('h3').textContent;
    document.getElementById('editor-scope').textContent = '管理者儲存後全公司共用；只調整首頁顯示名稱與部門，不改動工具網址、業務資料或操作權限。';
    nameInput.value = card.querySelector('h3').textContent;
    primary.value = card.dataset.primary;
    draftCollaborators = card.dataset.collaborators.split(' ').filter(Boolean);
    drawCollaborators(); setError(''); fields.disabled=true; saveButton.disabled=true;
    const status = document.getElementById('editor-status'); status.textContent='正在核對公司登入與最新工具設定…';
    editor.showModal();
    try {
      if (!await checkRuntimeVersion()) throw new Error('請先重新載入最新版首頁。');
      const data = await loadSettings();
      if (!editor.open || editingCard !== card) return;
      document.getElementById('editor-title').textContent=card.querySelector('h3').textContent; nameInput.value=card.querySelector('h3').textContent; primary.value=card.dataset.primary; draftCollaborators=card.dataset.collaborators.split(' ').filter(Boolean); drawCollaborators();
      fields.disabled=!data.canManage; saveButton.disabled=!data.canManage;
      status.textContent=data.canManage ? '管理者可修改首頁名稱、一個主責部門及多個協作部門。' : '目前帳號可查看工具設定；只有既有公司管理者可以修改。';
    } catch (error) { status.textContent='無法確認最新工具設定，已停止編輯與儲存。'; setError(error.message || '設定無法載入，請稍後再試。'); }
  }

  root.querySelectorAll('[data-edit-tool]').forEach(button => button.addEventListener('click',()=>openEditor(button.closest('[data-tool]'))));
  document.getElementById('editor-cancel').addEventListener('click',()=>{if(!saving)editor.close();});
  editor.addEventListener('cancel',event=>{if(saving)event.preventDefault();});
  editor.addEventListener('close',()=>{fields.disabled=true;saveButton.disabled=true;});
  saveButton.addEventListener('click',async()=>{
    if(saving || !sharedSettings?.canManage || !editingCard || fields.disabled) return;
    if (!validName(nameInput.value)) { setError('工具名稱請填入1至80個字，且不可含換行或控制字元。'); nameInput.focus(); return; }
    saving=true; fields.disabled=true; saveButton.disabled=true; document.getElementById('editor-cancel').disabled=true; setError('');
    try {
      if(!await checkRuntimeVersion()) throw new Error('請先重新載入最新版首頁。');
      const payload={expectedVersion:sharedSettings.version,toolId:editingCard.dataset.tool,displayName:nameInput.value.trim(),primary:primary.value,collaborators:[...draftCollaborators]};
      const response=await fetch('/api/rules/homepage',{method:'PUT',cache:'no-store',credentials:'same-origin',redirect:'error',headers:{'Content-Type':'application/json','X-Homepage-Version':APP_VERSION},body:JSON.stringify(payload)});
      const data=await readResponse(response); applySettings(data);
      document.getElementById('department-result').textContent=`${editingCard.querySelector('h3').textContent}的工具設定已儲存，全公司共用。`;
      editor.close();
      const next=editingCard.hidden ? buttons.find(b=>b.dataset.dept===department) : editingCard.querySelector('[data-edit-tool]'); next?.focus();
    } catch(error) {
      // Keep the unsaved draft visible; conflict and network failures never claim success.
      setError((error.message || '儲存失敗。')+' 請關閉後重新開啟，核對最新工具設定再試。');
      document.getElementById('editor-status').textContent='尚未確認儲存結果，請關閉後重新開啟核對。';
    } finally {
      saving=false;document.getElementById('editor-cancel').disabled=false;
      // Reopening reloads both permission and optimistic-lock version before another save.
      fields.disabled=true;saveButton.disabled=true;
    }
  });

  async function refreshSettings() {
    if(editor.open) return;
    try {await loadSettings();document.getElementById('department-result').textContent='';}
    catch {document.getElementById('department-result').textContent='共用工具設定暫時無法載入，目前顯示最近已載入或首頁預設名稱與分類；無法編輯或儲存。';}
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
  window.addEventListener('focus', () => { checkRuntimeVersion(); refreshSettings(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { checkRuntimeVersion(); refreshSettings(); } });
  setInterval(() => {checkRuntimeVersion();refreshSettings();}, 5 * 60 * 1000);
  render();
  checkRuntimeVersion();
  refreshSettings();
})();
