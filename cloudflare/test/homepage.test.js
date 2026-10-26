import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const catalog = JSON.parse(readFileSync('../homepage/catalog.json', 'utf8'));
const html = readFileSync('../index.html', 'utf8');
const get = id => catalog.tools.find(t => t.id === id);

describe('首頁部門工作台發布保護', () => {
  it('保留已確認的主責與協作分類，且不把門市作業誤列營運', () => {
    expect(get('inventory')).toMatchObject({primary:'admin', collaborators:[]});
    expect(get('store-transfer')).toMatchObject({primary:'merch', collaborators:['store']});
    expect(get('store-orders')).toMatchObject({primary:'store', collaborators:['merch']});
    expect(catalog.tools.filter(t => [t.primary, ...t.collaborators].includes('ops'))).toHaveLength(0);
    expect(new Set(catalog.tools.map(t => t.id)).size).toBe(catalog.tools.length);
  });
  it('入口只連到已部署工具，版本沿用各工具正式資訊，不發布開發中訂單', () => {
    expect(get('store-orders').href).toBeNull();
    expect(html).not.toContain('href="/store-orders/');
    for (const tool of catalog.tools.filter(t => t.href)) {
      const url = new URL(tool.href, 'https://siangstock.com');
      expect(existsSync(`..${url.pathname}index.html`)).toBe(true);
      if (url.searchParams.has('deploy')) {
        const version = JSON.parse(readFileSync(`..${url.pathname}version.json`, 'utf8'));
        expect(url.searchParams.get('deploy')).toBe(version.version);
      }
    }
  });
  it('版本、不可變資產與精確CSP雜湊同步，首頁及版本資訊不快取', () => {
    const version=JSON.parse(readFileSync('../homepage/version.json','utf8')).version;
    expect(version).toBe(catalog.version);
    const script=readFileSync(`../homepage/${version}.js`);
    const hash='sha256-'+createHash('sha256').update(script).digest('base64');
    expect(html).toContain(`script-src '${hash}'`);
    expect(html).toContain(`integrity="${hash}"`);
    expect(html).toContain(`/homepage/${version}.css`);
    expect(readFileSync(`../homepage/${version}.css`, 'utf8')).toBe(readFileSync('../homepage/style.css', 'utf8'));
    expect(script.toString()).toBe(readFileSync('../homepage/app.js','utf8'));
    const headers=readFileSync('../_headers','utf8');
    for(const path of ['/', '/index.html', '/homepage/version.json']) expect(headers).toContain(`${path}\n  Cache-Control: no-store, max-age=0, must-revalidate`);
  });
  it('改部門只更新入口分類，未知部門、重複工具及外部網址會明確拒絕建置', () => {
    const code=`import sys,json,copy\nsys.path.insert(0,'../homepage')\nfrom build import validate\nc=json.load(open('../homepage/catalog.json'))\nfor kind in ['department','duplicate','external']:\n d=copy.deepcopy(c)\n if kind=='department': d['tools'][0]['primary']='unknown'\n if kind=='duplicate': d['tools'].append(copy.deepcopy(d['tools'][0]))\n if kind=='external': d['tools'][0]['href']='https://example.com'\n try: validate(d)\n except ValueError: continue\n raise RuntimeError(kind)\nd=copy.deepcopy(c)\nd['tools'][0]['primary']='ops'\nvalidate(d)\nassert d['tools'][0]['href']==c['tools'][0]['href']\nprint('ok')`;
    expect(execFileSync('python3',['-c',code],{encoding:'utf8'}).trim()).toBe('ok');
  });
});
