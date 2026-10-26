import { describe, expect, it, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import * as access from '../worker/src/access';
import { homepageDepartmentsRoute, validateDepartmentUpdate, HOMEPAGE_RUNTIME_VERSION } from '../worker/src/homepage-departments';

const initial = [{toolId:'inventory',primary:'admin',collaborators:[]},{toolId:'store-transfer',primary:'merch',collaborators:['store']}];
function environment() {
  let row={version:1,payload:JSON.stringify(initial),updated_at:'2026-10-26T00:00:00Z'};
  const writes=[];
  const env={ALLOWED_ORIGINS:'https://siangstock.com',ADMIN_EMAILS:'siang01@siangapato.com.tw',ACCESS_TEAM_DOMAIN:'https://example.cloudflareaccess.com',ACCESS_AUD:'inventory-audience',PROCUREMENT_ACCESS_AUD:'company-audience',DB:{prepare(sql){let values=[];return{bind(...v){values=v;return this;},async first(){if(sql.startsWith('SELECT'))return row;if(sql.startsWith('UPDATE')){if(values[3]!==row.version)return null;writes.push([...values]);row={version:row.version+1,payload:values[0],updated_at:values[1]};return row;}throw new Error('unexpected sql');}};}}};
  return {env,writes,get:()=>row,set:v=>{row=v;}};
}
function request(body={},headers={}) {
  return new Request('https://siangstock.com/api/rules/homepage',{method:'PUT',headers:{Origin:'https://siangstock.com','Content-Type':'application/json','X-Homepage-Version':HOMEPAGE_RUNTIME_VERSION,...headers},body:JSON.stringify({expectedVersion:1,toolId:'inventory',primary:'ops',collaborators:['merch'],...body})});
}
afterEach(()=>vi.restoreAllMocks());
describe('全公司工具部門設定',()=>{
  it('無登入、缺少設定或非管理者皆 fail closed，不碰資料庫',async()=>{
    const e=environment();
    const missing=await homepageDepartmentsRoute(request(),{...e.env,PROCUREMENT_ACCESS_AUD:''});
    expect(missing.status).toBe(503);
    const anonymous=await homepageDepartmentsRoute(new Request('https://siangstock.com/api/rules/homepage'),e.env);
    expect(anonymous.status).toBe(401);
    vi.spyOn(access,'verifyAdmin').mockRejectedValue(new Response('沒有權限',{status:403}));
    expect((await homepageDepartmentsRoute(request(),e.env)).status).toBe(403);
    expect(e.writes).toHaveLength(0);
  });
  it('使用公司網站audience，一般帳號可讀但無管理權，回應不快取',async()=>{
    const spy=vi.spyOn(access,'verifyCompanyUser').mockResolvedValue('store@siangapato.com.tw');
    const e=environment();const response=await homepageDepartmentsRoute(new Request('https://siangstock.com/api/rules/homepage'),e.env);
    expect(spy.mock.calls[0][1].ACCESS_AUD).toBe('company-audience');
    expect(response.headers.get('Cache-Control')).toContain('no-store');
    expect(await response.json()).toMatchObject({version:1,canManage:false,assignments:initial,runtimeVersion:HOMEPAGE_RUNTIME_VERSION});
  });
  it('只更新指定工具，保留其他工具且回傳更新後版本',async()=>{
    vi.spyOn(access,'verifyAdmin').mockResolvedValue('siang01@siangapato.com.tw');
    const e=environment();const response=await homepageDepartmentsRoute(request(),e.env);
    expect(response.status).toBe(200);
    const data=await response.json();
    expect(data).toMatchObject({version:2,canManage:true});
    expect(data.assignments).toEqual([{toolId:'inventory',primary:'ops',collaborators:['merch']},initial[1]]);
    expect(e.writes[0][2]).toBe('siang01@siangapato.com.tw');
  });
  it('同版本先到先存，後到回409，不覆蓋第一位管理者的結果',async()=>{
    vi.spyOn(access,'verifyAdmin').mockResolvedValue('siang01@siangapato.com.tw');
    const e=environment();
    const responses=await Promise.all([homepageDepartmentsRoute(request(),e.env),homepageDepartmentsRoute(request({primary:'design'}),e.env)]);
    expect(responses.map(r=>r.status).sort()).toEqual([200,409]);
    expect(e.writes).toHaveLength(1);
  });
  it('拒絕跨來源、舊前台、無效部門、重複協作與額外業務欄位',async()=>{
    vi.spyOn(access,'verifyAdmin').mockResolvedValue('siang01@siangapato.com.tw');
    const e=environment();
    expect((await homepageDepartmentsRoute(request({}, {Origin:'https://evil.example'}),e.env)).status).toBe(403);
    expect((await homepageDepartmentsRoute(request({}, {'X-Homepage-Version':'old'}),e.env)).status).toBe(409);
    for(const body of [{primary:'unknown'},{collaborators:['ops']},{collaborators:['store','store']},{href:'/unsafe/'},{amount:1},{expectedVersion:0}])expect((await homepageDepartmentsRoute(request(body),e.env)).status).toBe(400);
    expect(e.writes).toHaveLength(0);
  });
  it('資料庫錯誤或尚未初始化時不宣稱成功、不改本機分類',async()=>{
    vi.spyOn(access,'verifyAdmin').mockResolvedValue('siang01@siangapato.com.tw');
    const e=environment();e.set(null);
    expect((await homepageDepartmentsRoute(request(),e.env)).status).toBe(503);
    e.env.DB.prepare=()=>{throw new Error('database failed');};
    const response=await homepageDepartmentsRoute(request(),e.env);
    expect(response.status).toBe(503);expect(await response.text()).toContain('未確認儲存');
    expect(e.writes).toHaveLength(0);
  });
  it('實際SQLite migration可往返，歷史與CAS寫入原子一致，可恢復舊設定',()=>{
    const sql=readFileSync('worker/migrations/0043_homepage_departments.sql','utf8');
    const code=`import sqlite3,json,sys\ndb=sqlite3.connect(':memory:')\ndb.executescript(sys.stdin.read())\nold=db.execute('SELECT payload FROM homepage_departments WHERE id=1').fetchone()[0]\nrows=json.loads(old)\nassert len(rows)==7\nrows[0]['primary']='ops'\nnew=json.dumps(rows)\nr=db.execute('UPDATE homepage_departments SET version=version+1,payload=?,updated_at=?,updated_by=? WHERE id=1 AND version=? RETURNING version',(new,'now','admin',1)).fetchone()\nassert r[0]==2\nassert db.execute('SELECT payload FROM homepage_department_history WHERE version=2').fetchone()[0]==new\nassert db.execute('UPDATE homepage_departments SET version=version+1 WHERE id=1 AND version=1 RETURNING version').fetchone() is None\ndb.execute('UPDATE homepage_departments SET version=3,payload=? WHERE id=1',(old,))\nassert db.execute('SELECT payload FROM homepage_department_history WHERE version=3').fetchone()[0]==old\nassert db.execute('SELECT COUNT(*) FROM homepage_department_history').fetchone()[0]==3\nprint('ok')`;
    expect(execFileSync('python3',['-c',code],{input:sql,encoding:'utf8'}).trim()).toBe('ok');
  });
});
