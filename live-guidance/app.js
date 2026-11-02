/* UI guidance only. Providers expose readiness, never order contents or credentials.
 * Navigation opens details and moves focus; it never clicks a business action. */
(function () {
  'use strict';
  const VERSION = '20261102-guidance-context-r5';
  const script = document.currentScript;
  const base = new URL('.', script.src);
  const main = document.querySelector('main');
  if (!main) return;
  const feedbacks = new WeakMap();
  const progressTracker = globalThis.CompanyGuidanceProgress.create();
  let provider, pending, frame, lastAction, latestMessage, latestStatus, nextTarget, guard = 'checking', latestVersion = '', versionFailure = '';
  const box = document.createElement('aside');
  box.id = 'company-live-guide'; box.className = 'company-live-guide';
  box.setAttribute('aria-label', '即時操作指引');
  const caption = document.createElement('span'); caption.textContent = '即時操作指引';
  const title = document.createElement('strong'); title.id = 'company-guide-title';
  title.setAttribute('role', 'status'); title.setAttribute('aria-live', 'polite');
  const hint = document.createElement('p');
  const live = document.createElement('p'); live.className = 'company-guide-message';
  live.setAttribute('role', 'status'); live.setAttribute('aria-live', 'polite');
  const progress = document.createElement('p'); progress.id = 'company-guide-progress'; progress.className = 'company-guide-progress';
  const updated = document.createElement('p'); updated.id = 'company-guide-updated'; updated.className = 'company-guide-updated';
  const waiting = document.createElement('p'); waiting.id = 'company-guide-wait'; waiting.className = 'company-guide-wait'; waiting.setAttribute('role', 'status');
  const meter = document.createElement('progress'); meter.id = 'company-guide-meter'; meter.setAttribute('aria-label', '目前步驟完成進度');
  const go = document.createElement('button'); go.type = 'button';
  const content = document.createElement('div'); content.append(caption, title, hint, live, progress, meter, updated, waiting);
  const help = document.createElement('details'); help.className = 'company-guide-help';
  const summary = document.createElement('summary'); summary.textContent = '指引怎麼用？';
  const explanation = document.createElement('p'); explanation.textContent = '這裡會依目前資料與狀態提示下一步。按「前往」只展開區塊、移動畫面與焦點；分析、儲存、核准及AI仍要由你按原本按鈕。進度與最後更新時間只依實際訊息變化更新；30秒沒有新進度會提示等待，不代表失敗。百分比只在有實際總量時顯示。請以原操作的成功訊息為準，指引不代表已保存或已核准。';
  help.append(summary, explanation); content.append(help);
  box.append(content, go);
  const nav = main.querySelector('nav.breadcrumb,nav.breadcrumbs,nav.page-navigation');
  const header = main.querySelector('header');
  if (nav) nav.after(box); else if (header) header.after(box); else main.prepend(box);
  const home = document.createComment('company live guide home'); box.before(home);
  const put = (el, value) => { if (el.textContent !== value) el.textContent = value; };
  const visible = el => !!el && !el.closest('[hidden], [inert]') && !!el.getClientRects().length;
  function node(selector) { try { return selector instanceof Element ? selector : selector ? document.querySelector(selector) : null; } catch { return null; } }
  function schedule() { if (!frame) frame = requestAnimationFrame(() => { frame = null; render(); }); }
  function freeze() {
    if (guard !== 'blocked') return;
    document.querySelectorAll('main button, main input, main select, main textarea').forEach(el => {
      if (!box.contains(el) && !el.closest('#version-warning') && !el.disabled) el.disabled = true;
    });
  }
  let activeContext = '';
  function enterContext(target) {
    if (box.contains(target)) return;
    const context = provider?.context?.(target);
    if (context != null && context !== activeContext) {
      activeContext=context;latestMessage=null;latestStatus=null;lastAction=null;progressTracker.reset();
    }
  }
  document.addEventListener('focusin', e => { enterContext(e.target); schedule(); }, true);
  function renderProgress() {
    let details;
    try { details = provider?.progress?.(); } catch { /* No fabricated totals. */ }
    const record = progressTracker.view();
    const text = details?.message || '';
    put(progress, text); progress.hidden = !text;
    const current = details?.current, total = details?.total;
    const measured = Number.isFinite(current) && Number.isFinite(total) && total > 0 && current >= 0 && current <= total;
    meter.hidden = !measured;
    if (measured) { meter.max = total; meter.value = current; meter.setAttribute('aria-valuetext', `${current}／${total}`); }
    updated.hidden = !record;
    if (record) put(updated, `最後進度更新：${new Date(record.updatedAt).toLocaleTimeString('zh-TW', {timeZone:'Asia/Taipei',hour12:false})}（台北時間）`);
    waiting.hidden = !record || !['processing', 'authorization', 'error'].includes(record.status);
    if (record?.stalled) put(waiting, `${record.elapsedSeconds} 秒沒有新進度；仍在等待處理結果，尚未判定失敗。請勿重複送出。`);
    else if (record?.status === 'processing') put(waiting, '正在處理；取得新的步驟或完成量時，更新時間才會改變。');
    else if (record?.status === 'authorization') put(waiting, '等待授權，請依原操作區提示完成登入。');
    else if (record?.status === 'error') put(waiting, '此步驟已失敗或停止，請查看原因；不會自動重試。');
  }
  function render() {
    freeze();
    box.dataset.versionState = guard; box.dataset.versionExpected = VERSION; box.dataset.versionObserved = latestVersion;
    const modal = document.querySelector('dialog[open]:not(#version-warning)');
    if (modal && !modal.contains(box)) modal.prepend(box);
    else if (!modal && box.previousSibling !== home) home.after(box);
    if (guard !== 'ready') {
      const unavailable = guard === 'unavailable';
      put(title, guard === 'checking' ? '正在確認工具版本' : unavailable ? '暫時無法確認工具版本' : '請重新載入最新版');
      put(hint, guard === 'checking' ? '確認期間暫停新操作；進行中的本機處理未被取消。' : unavailable ? `${versionFailure} 本頁選檔與輸入保留；新操作暫停，請按「重新確認版本」，不需重整。` : '已偵測到不同版本，新操作已停止；進行中的本機處理未被取消。請先保留未保存內容，再重新載入。');
      // The version probe cannot cancel a running local calculation. Keep its
      // real progress visible instead of claiming all processing has stopped.
      renderProgress();
      live.hidden = !latestMessage; if (latestMessage) put(live, '本機處理訊息：' + latestMessage);
      go.hidden = false; go.disabled = guard === 'checking'; put(go, unavailable ? '重新確認版本' : guard === 'checking' ? '正在確認版本' : '重新載入最新版');
      return;
    }
    let step;
    try { step = provider?.resolve(); } catch { /* During app initialization no readiness is assumed. */ }
    if (!step) step = { title: '等待工具準備完成', hint: '請查看本頁載入訊息；若長時間沒有變化，請重新載入。' };
    if (latestMessage && latestStatus && visible(latestStatus)) {
      const fileLabel = latestStatus.matches('.file-name,[data-file-name]');
      const failed = fileLabel ? !!latestStatus.closest('.error') : latestStatus.matches('.error,.danger,.bad') || /失敗|無法|錯誤|無權|未授權|衝突/.test(latestMessage);
      if (failed && !step.keepState) {
        step = { title: '這一步尚未完成', hint: '請查看下方原因並修正；未確認成功前，不要重複儲存、核准或送出 AI。', target: latestStatus, label: '查看原因' };
      } else if (!step.busy && lastAction?.disabled && /^正在|處理中|分析中|計算中/.test(latestMessage)) {
        step = { title: '處理中', hint: '請保留此頁並等待原操作結果；指引不會重複送出請求。', target: latestStatus, label: '查看進度' };
      }
    }
    if (modal && !modal.contains(node(step.target))) {
      step = {title:'核對此視窗內容', hint:'請先查看此視窗的條件與提示；確認、儲存或取消仍須由你自行操作。', target:modal.querySelector('[role="status"],h2,legend,p') || modal};
    }
    const ownWarning = node('#version-warning');
    if (ownWarning && visible(ownWarning) && (!ownWarning.matches('dialog') || ownWarning.open)) {
      step = { title: '請重新載入最新版', hint: '此工具已停止操作，請依版本提示更新。', target: '#version-warning', label: '前往版本提示' };
    }
    put(title, step.title); put(hint, step.hint); renderProgress();
    live.hidden = !latestMessage; if (latestMessage) put(live, '目前訊息：' + latestMessage);
    const destination = node(step.target);
    // Hidden parent details may be opened, but role-hidden sections are never exposed.
    go.hidden = !destination || !!destination.closest('[hidden], [inert]');
    go.disabled = false; put(go, step.label || '前往這一步');
    nextTarget = destination;
    box.dataset.target = typeof step.target === 'string' ? step.target : '';
  }
  go.addEventListener('click', () => {
    if (guard === 'checking') return;
    if (guard === 'unavailable') { void ensureCurrent(); return; }
    if (guard === 'blocked') {
      const url = new URL(location.href); url.searchParams.set('deploy', latestVersion || VERSION);
      url.searchParams.set('reload', String(Date.now())); location.assign(url.href); return;
    }
    const el = nextTarget;
    if (!el || el.closest('[hidden], [inert]')) return;
    for (let parent = el.parentElement; parent; parent = parent.parentElement) if (parent.matches('details')) parent.open = true;
    if (el.matches('details')) el.open = true;
    // Focus the destination, including disabled-action containers, without invoking it.
    const target = el.disabled ? (el.closest('section,article,.action-row,.action-bar') || el.parentElement) : el;
    if (!target.matches('input,select,textarea,button,a[href],summary')) target.setAttribute('tabindex', '-1');
    const y = target.getBoundingClientRect().top + scrollY - box.getBoundingClientRect().height - 28;
    scrollTo({ top: Math.max(0, y), behavior: 'instant' }); target.focus({ preventScroll: true });
  });
  function versionViaScript(signal) {
    // The reconciliation tool forbids fetch/connect. Keep that CSP unchanged:
    // its existing self-script permission can load this data-free version probe.
    return new Promise((resolve, reject) => {
      const probe = document.createElement('script');
      const clean = () => { signal.removeEventListener('abort', fail); probe.remove(); };
      const fail = () => { clean(); reject(Error('version unavailable')); };
      probe.addEventListener('company-guidance-version', e => { const version = e.detail; clean(); resolve({version}); }, {once:true});
      probe.onerror = fail; signal.addEventListener('abort', fail, {once:true});
      probe.src = new URL('version.js?check=' + Date.now(), base).href;
      document.head.append(probe);
    });
  }
  async function ensureCurrent() {
    if (guard === 'blocked') return false;
    if (pending) return pending;
    guard = 'checking'; schedule();
    pending = (async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      try {
        let manifest;
        if (script.dataset.versionTransport === 'script') manifest = await versionViaScript(controller.signal);
        else {
          const response = await fetch(new URL('version.json?check=' + Date.now(), base), { cache: 'no-store', credentials: 'same-origin', signal: controller.signal });
          if (!response.ok) throw Error(`HTTP ${response.status}`);
          manifest = await response.json();
        }
        if (typeof manifest?.version !== 'string' || !/^[A-Za-z0-9-]{1,100}$/.test(manifest.version)) throw Error('invalid version');
        latestVersion = manifest.version;
        guard = latestVersion === VERSION ? 'ready' : 'blocked'; versionFailure = '';
      } catch (error) {
        guard = 'unavailable';
        versionFailure = controller.signal.aborted ? '版本查詢逾時，尚未確認是否有新版。' : /^HTTP (401|403)$/.test(error.message) ? '版本查詢的登入驗證未通過。' : /^HTTP \d{3}$/.test(error.message) ? `版本服務暫時無法回應（${error.message}）。` : error instanceof SyntaxError || error.message === 'invalid version' ? '版本資訊格式異常，尚未確認是否有新版。' : '版本查詢連線未完成，尚未確認是否有新版。';
      }
      finally { clearTimeout(timeout); pending = null; schedule(); }
      if (guard === 'ready') replayPendingFileChanges();
      else if (guard === 'blocked') pendingFileInputs.clear();
      return guard === 'ready';
    })();
    return pending;
  }
  globalThis.CompanyGuidance = Object.freeze({
    version: VERSION, ensureCurrent, refresh: schedule,
    reportProgress(record) { progressTracker.report(record); schedule(); },
    register(value) { provider = value; schedule(); },
    step(title, hint, target, label) { return { title, hint, target, label }; }
  });
  // Returning from the native file picker can refocus the page before change
  // arrives. Keep the user's selection pending until that version check succeeds.
  const pendingFileChanges = new WeakMap(), pendingFileInputs = new Set();
  function replayPendingFileChanges() {
    if (guard !== 'ready') return;
    for (const input of [...pendingFileInputs]) {
      const selection = pendingFileChanges.get(input);
      pendingFileInputs.delete(input); pendingFileChanges.delete(input);
      if (!input.isConnected || input.disabled || input.files !== selection) continue;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }
  function deferFileChange(event) {
    const input = event.target;
    pendingFileChanges.set(input, input.files); pendingFileInputs.add(input);
    event.stopImmediatePropagation();
    void ensureCurrent();
  }
  for (const event of ['click', 'change', 'submit']) document.addEventListener(event, e => {
    if (box.contains(e.target)) return;
    enterContext(e.target);
    if (event === 'change' && e.target.matches('input[type="file"]')) {
      if (guard === 'checking') { deferFileChange(e); return; }
      pendingFileChanges.delete(e.target); pendingFileInputs.delete(e.target);
    }
    if (guard !== 'ready' && e.target.closest('button,input,select,textarea,form') && !e.target.closest('#version-warning')) {
      e.preventDefault(); e.stopImmediatePropagation(); schedule(); return;
    }
    if (event === 'click' && e.target.closest('button')) { lastAction = e.target.closest('button'); latestMessage = null; latestStatus = null; progressTracker.reset(); }
    if (event === 'change') {
      progressTracker.reset(); latestMessage = null;
      document.querySelectorAll('[data-company-feedback]').forEach(el => { el.hidden = true; });
    }
    schedule();
  }, true);
  document.addEventListener('input', e => { enterContext(e.target); progressTracker.reset(); latestMessage = null; document.querySelectorAll('[data-company-feedback]').forEach(el => { el.hidden = true; }); schedule(); });
  document.addEventListener('toggle', schedule, true);
  const observer = new MutationObserver(records => {
    const external = records.filter(r => !box.contains(r.target) && !r.target.closest?.('[data-company-feedback]'));
    if (!external.length) return;
    for (const r of external) {
      const el = r.target.nodeType === Node.TEXT_NODE ? r.target.parentElement : r.target;
      const status = el.closest?.(provider?.statuses || '[data-no-guidance-status]');
      if (!status || !visible(status) || provider?.acceptStatus?.(status) === false) continue;
      const scope = lastAction?.closest('section');
      if (scope?.querySelector(provider?.statuses || '[data-no-guidance-status]') && !scope.contains(status)) continue;
      const message = status.textContent.trim().replace(/\s+/g, ' ').slice(0, 320);
      if (!message) continue;
      latestMessage = message; latestStatus = status;
      const failed = status.matches('.error,.danger,.bad') || (status.matches('.file-name,[data-file-name]') && !!status.closest('.error'));
      progressTracker.report({id:status.id || '',message,status:globalThis.CompanyGuidanceProgress.classify(message, failed)});
      // Keep feedback near the action even when the original status lives far away.
      if (lastAction?.isConnected && !lastAction.closest('dialog') && !lastAction.parentElement.contains(status)) {
        const row = lastAction.parentElement;
        let local = feedbacks.get(row);
        if (!local?.isConnected) { local = document.createElement('p'); local.dataset.companyFeedback = ''; local.className = 'company-operation-feedback'; local.setAttribute('role', 'status'); row.after(local); feedbacks.set(row, local); }
        local.hidden = false; put(local, message);
      }
    }
    schedule();
  });
  observer.observe(main, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['disabled', 'hidden', 'class', 'open', 'aria-busy'] });
  setInterval(() => { if (progressTracker.view()?.status === 'processing') schedule(); }, 5000);
  window.addEventListener('focus', ensureCurrent);
  setInterval(ensureCurrent, 60000);
  void ensureCurrent(); schedule();
})();
