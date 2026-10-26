"""Build the static homepage from the shared department catalog. No network or company data."""
import base64
import hashlib
import html
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def validate(catalog):
    version = catalog['version']
    if not re.fullmatch(r'[a-zA-Z0-9-]{1,100}', version):
        raise ValueError('Invalid homepage version')
    departments = catalog['departments']
    ids = [d['id'] for d in departments]
    if len(ids) != len(set(ids)) or 'all' in ids or not all(re.fullmatch(r'[a-z][a-z0-9-]*', i) for i in ids):
        raise ValueError('Invalid or duplicate department')
    tool_ids = set()
    for tool in catalog['tools']:
        if tool['id'] in tool_ids:
            raise ValueError('Duplicate tool')
        tool_ids.add(tool['id'])
        groups = [tool['primary'], *tool['collaborators']]
        if len(groups) != len(set(groups)) or any(group not in ids for group in groups):
            raise ValueError('Invalid department assignment: ' + tool['id'])
        href = tool['href']
        if href is not None and (not href.startswith('/') or href.startswith('//') or any(c in href for c in ['\\', '\n', '\r', '#'])):
            raise ValueError('Tool href must stay on this site')


def build():
    catalog = json.loads((ROOT / 'homepage/catalog.json').read_text())
    validate(catalog)
    version = catalog['version']
    labels = {d['id']: d['label'] for d in catalog['departments']}
    e = lambda text: html.escape(str(text), quote=True)
    def groups(t):
        return [t['primary'], *t['collaborators']]
    nav = []
    for department in [{'id': 'all', 'label': '全部工具', 'glyph': '全'}, *catalog['departments']]:
        did = department['id']
        count = sum(did == 'all' or did in groups(t) for t in catalog['tools'])
        nav.append(f'<button class="sh-dept" type="button" data-dept="{e(did)}" data-label="{e(department["label"])}" aria-pressed="{str(did == "all").lower()}" aria-controls="tool-grid" aria-label="{e(department["label"])}，{count} 支工具"><span class="sh-dept-top"><span class="sh-glyph" aria-hidden="true">{e(department["glyph"])}</span><span class="sh-count">{count}</span></span><span class="sh-dept-name">{e(department["label"])}</span></button>')
    cards = []
    for t in catalog['tools']:
        owner = '・'.join(labels[g] for g in groups(t)) + ('協作' if t['collaborators'] else '')
        action = f'<a class="sh-open" href="{e(t["href"])}" aria-label="開啟{e(t["name"])}">開啟工具 →</a>' if t['href'] else '<span class="sh-data">開放後提供入口</span>'
        testing = '' if t['href'] else ' sh-testing'
        cards.append(f'<article class="sh-tool" data-tool="{e(t["id"])}" data-original-name="{e(t["name"])}" data-departments="{e(" ".join(groups(t)))}" data-primary="{e(t["primary"])}" data-collaborators="{e(" ".join(t["collaborators"]))}"><div class="sh-tool-head"><span class="sh-owner">{e(owner)}</span><span class="sh-status{testing}">{e(t["status"])}</span></div><h3>{e(t["name"])}</h3><p class="sh-desc">{e(t["description"])}</p><div class="sh-tool-bottom"><span class="sh-data">{e(t["data"])}</span><div class="sh-card-actions"><button class="sh-edit" type="button" data-edit-tool="{e(t["id"])}" aria-label="設定{e(t["name"])}名稱與部門" data-enhancement hidden>工具設定</button>{action}</div></div></article>')
    app = (ROOT / 'homepage/app.js').read_bytes()
    app_hash = 'sha256-' + base64.b64encode(hashlib.sha256(app).digest()).decode()
    # Immutable, separately named assets keep old tabs tied to the code they opened.
    (ROOT / f'homepage/{version}.js').write_bytes(app)
    (ROOT / f'homepage/{version}.css').write_bytes((ROOT / 'homepage/style.css').read_bytes())
    source = f'''<!doctype html>
<html lang="zh-Hant"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="翔仔居家公司工具與服務，依部門快速查找。">
<meta property="og:type" content="website"><meta property="og:title" content="翔仔居家-公司工具">
<meta property="og:description" content="翔仔居家公司工具與服務"><meta property="og:url" content="https://siangstock.com/">
<meta name="twitter:card" content="summary"><meta name="twitter:title" content="翔仔居家-公司工具">
<meta name="robots" content="noindex,nofollow">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; connect-src 'self'; img-src 'self' data:; style-src 'self'; script-src '{app_hash}'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'; worker-src 'none'">
<title>翔仔居家-公司工具</title>
<link rel="stylesheet" href="/homepage/{e(version)}.css">
<script src="/homepage/{e(version)}.js" integrity="{app_hash}" defer></script>
</head><body>
<main id="siang-departments" data-version="{e(version)}"><div class="sh-page">
<header class="sh-top"><a class="sh-brand" href="/" aria-label="公司工具首頁"><span class="sh-logo" aria-hidden="true">翔</span><span>翔仔居家・工作入口<small>SIANG HOME · WORKSPACE</small></span></a><span class="sh-top-note">公司工具與服務</span></header>
<section id="version-warning" class="sh-version" role="alert" hidden><strong>重新載入最新版</strong><p>正在確認首頁版本。</p><a id="reload-latest" href="/?reload={e(version)}">重新載入最新版</a></section>
<section class="sh-hero" aria-labelledby="page-title"><div><p class="sh-eyebrow">EVERYDAY WORK, CONNECTED.</p><h1 id="page-title">找到工具，把工作做好。</h1><p class="sh-intro">從部門出發，快速找到今天需要的工具與服務。</p></div><aside class="sh-hero-aside"><strong>一起工作，各有所長。</strong>部門分類協助查找，<br>實際操作仍依原有帳號權限。</aside></section>
<nav class="sh-depts" aria-label="部門分類" data-enhancement hidden>{''.join(nav)}</nav>
<section class="sh-workspace" aria-labelledby="tools-title"><div class="sh-section-top"><div><h2 class="sh-results-title" id="tools-title">全部工具</h2><p class="sh-caption" aria-live="polite">{len(cards)} 支工具 · 跨部門工具只計一次</p></div><label class="sh-search" data-enhancement hidden><span aria-hidden="true">⌕</span><input type="search" aria-label="搜尋工具" placeholder="搜尋工具名稱或工作內容"></label></div>
<noscript><p>以下列出全部工具；啟用 JavaScript 可依部門分類及搜尋。</p></noscript>
<div class="sh-grid" id="tool-grid">{''.join(cards)}</div><p class="sh-empty" hidden>沒有符合的工具。</p>
<div class="sh-safe"><b aria-hidden="true">✓</b><span>原始 Excel 在瀏覽器處理、不改原檔。共用批次依公司權限保存；競品 AI 的資料傳送依工具內的同意與安全說明辦理。</span></div></section>
<footer class="sh-footer"><span>翔仔居家 · 公司工具與服務</span><span>遇到問題時，請記下畫面訊息並告知管理同事。</span></footer>
</div><dialog class="sh-detail" id="department-editor" aria-labelledby="editor-title"><p class="sh-eyebrow">工具設定</p><h2 id="editor-title"></h2><p id="editor-status" role="status" aria-live="polite"></p><fieldset class="sh-classification" id="editor-fields" disabled><legend>首頁名稱與部門</legend><label class="sh-primary-label">首頁顯示名稱<input class="sh-name" id="editor-name" type="text" autocomplete="off" aria-describedby="editor-name-help" required></label><p class="sh-name-help" id="editor-name-help">1至80個字；僅調整首頁名稱，搜尋也會同步更新。</p><label class="sh-primary-label">主責部門<select class="sh-primary" id="editor-primary"></select></label><p>協作部門（可複選）</p><div class="sh-collaborators" id="editor-collaborators"></div></fieldset><p id="editor-scope"></p><p class="sh-dialog-error" id="editor-error" role="alert" hidden></p><div class="sh-dialog-actions"><button class="sh-close" id="editor-save" type="button" disabled>儲存工具設定</button><button class="sh-cancel" id="editor-cancel" type="button">關閉</button></div></dialog><p class="sh-change-note" id="department-result" role="status" aria-live="polite"></p></main></body></html>
'''
    (ROOT / 'index.html').write_text(source)
    (ROOT / 'homepage/version.json').write_text(json.dumps({'version': version}, ensure_ascii=False) + '\n')


if __name__ == '__main__':
    build()
