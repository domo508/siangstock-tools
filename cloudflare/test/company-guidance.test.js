import {readFileSync, existsSync} from 'node:fs';
import {describe, it, expect} from 'vitest';
const read = p => readFileSync('../'+p, 'utf8');
const version=JSON.parse(read('live-guidance/version.json')).version;
describe('公司工具即時指引整合契約',()=>{
  it('七支可用工具都有即時指引，公開訪客保留自包含原生指引',()=>{
    const catalog=JSON.parse(read('homepage/catalog.json'));
    expect(catalog.tools.filter(t=>t.href)).toHaveLength(7);
    for(const tool of catalog.tools.filter(t=>t.href)){
      const html=read(tool.id+'/index.html');
      expect(html.includes('/live-guidance/app.js?v=') || html.includes('cloud-next-step'),tool.id).toBe(true);
    }
    const guest=read('store-orders/guest/index.html');
    expect(guest).toContain('cloud-next-step');
    expect(guest).not.toContain('/live-guidance/');
  });
  it('所有互動規則管理及設定頁有指引，必須先載入指引再載入app',()=>{
    for(const [page,app] of [['inventory/index.html','app.js'],['cost-analysis/index.html','app.js'],['supplier-reconciliation/index.html','app.js'],['competitive-analysis/index.html','app.js'],['procurement-planning/index.html','app.js'],['store-transfer/index.html','app.js'],['inventory/rules-admin/index.html','admin.js'],['procurement-planning/rules-admin/index.html','admin.js'],['store-transfer/rules/index.html','app.js'],['store-orders/settings.html','settings.js']]){
      const html=read(page), guide=html.indexOf(`/live-guidance/app.js?v=${version}`);
      expect(guide,page).toBeGreaterThan(0);
      expect(guide,page).toBeLessThan(html.indexOf(`src="${app}?`));
      expect(html).toContain(`/live-guidance/style.css?v=${version}`);
    }
  });
  it('版本資訊與同源載入／列印保護完整，不把工具資料送入指引',()=>{
    const code=read('live-guidance/app.js'), headers=read('_headers');
    expect(code).toContain(`const VERSION = '${version}'`);
    expect(code).toContain("credentials: 'same-origin'");
    expect(code).toContain("cache: 'no-store'");
    expect(code).toContain("guard = 'blocked'");
    expect(code).not.toMatch(/localStorage|sessionStorage|sendBeacon|XMLHttpRequest|\.innerHTML\s*=/);
    for(const path of ['live-guidance/version.json','inventory/version.json','cost-analysis/version.json','supplier-reconciliation/version.json','inventory/rules-admin/version.json']){
      expect(existsSync('../'+path)).toBe(true);
      expect(headers).toContain('/'+path.split('/version.json')[0]);
    }
    expect(read('live-guidance/style.css')).toMatch(/@media print/);
    expect(read('live-guidance/version.js')).toContain(version);
    expect(read('supplier-reconciliation/index.html')).toContain("connect-src 'none'");
    expect(read('supplier-reconciliation/index.html')).toContain('data-version-transport="script"');
  });
});
