import {it,expect,vi,beforeEach,afterEach} from 'vitest';
import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
const auth=vi.hoisted(()=>({payload:{email:'staff@siangapato.com.tw',email_verified:true,hd:'siangapato.com.tw',aud:'bound-client'}}));
vi.mock('jose',()=>({createRemoteJWKSet:()=>({}),jwtVerify:async()=>({payload:auth.payload})}));
import {marketingAiRoute,marketingPayload,MARKETING_AI_VERSION as V} from '../worker/src/marketing-ai';
let db,env,fetchMock;
beforeEach(()=>{db=new DatabaseSync(':memory:');db.exec(fs.readFileSync(new URL('../worker/migrations/0062_marketing_ai_operations.sql',import.meta.url),'utf8'));env={OPENAI_API_KEY:'test-secret',MARKETING_AI_BINDINGS:JSON.stringify({testsheet:'bound-client'}),DB:{prepare(sql){let args=[];return {bind(...a){args=a;return this},first(){return db.prepare(sql).get(...args)||null},run(){return db.prepare(sql).run(...args)}}}}};auth.payload={email:'staff@siangapato.com.tw',email_verified:true,hd:'siangapato.com.tw',aud:'bound-client'};fetchMock=vi.fn(async()=>Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({activities:[{cell:'B2',evidence:'示範活動',variants:[]}],context:[]})}]}],usage:{input_tokens:10,output_tokens:20}}));vi.stubGlobal('fetch',fetchMock);});
afterEach(()=>{db.close();vi.unstubAllGlobals()});
const body=()=>({version:V,spreadsheetId:'testsheet',operationId:crypto.randomUUID(),year:2026,month:12,cells:[{ref:'B2',raw:'示範活動'}]});
const req=b=>new Request('https://siangstock.com/api/procurement/marketing-ai',{method:'POST',headers:{Authorization:'Bearer fake.jwt.token','Content-Type':'application/json'},body:JSON.stringify(b)});
it('only sends selected text using store=false, strict schema and no tools or catalogue',()=>{const p=marketingPayload([{ref:'B2',raw:'示範活動'}],2026,12);expect(p.store).toBe(false);expect(p.text.format.strict).toBe(true);expect(p.tools).toBeUndefined();expect(p.max_output_tokens).toBe(18000);expect(JSON.parse(p.input[1].content).cells).toEqual([{ref:'B2',raw:'示範活動'}]);});
it('keeps existing routes independent; missing auth, configuration, other companies and wrong binding never call AI',async()=>{expect(await marketingAiRoute(new Request('https://siangstock.com/api/procurement/other'),env)).toBeNull();expect((await marketingAiRoute(req(body()),{...env,MARKETING_AI_BINDINGS:undefined})).status).toBe(503);auth.payload.hd='other.example';expect((await marketingAiRoute(req(body()),env)).status).toBe(403);auth.payload.hd='siangapato.com.tw';auth.payload.aud='other-client';expect((await marketingAiRoute(req(body()),env)).status).toBe(409);expect(fetchMock).not.toHaveBeenCalled();});
it('reserves each operation atomically, prevents duplicate paid calls and stores metadata only',async()=>{const b=body();expect((await marketingAiRoute(req(b),env)).status).toBe(200);expect((await marketingAiRoute(req(b),env)).status).toBe(409);expect(fetchMock).toHaveBeenCalledTimes(1);const row=db.prepare('SELECT * FROM marketing_ai_operations').get();expect(row.status).toBe('completed');expect(JSON.stringify(row)).not.toContain('示範活動');expect(JSON.stringify(row)).not.toContain('staff@');expect(JSON.stringify(row)).not.toContain('test-secret');});
it('daily caps and failed responses cannot silently retry or turn into completion',async()=>{fetchMock.mockResolvedValueOnce(Response.json({status:'incomplete',output:[]}));const b=body();expect((await marketingAiRoute(req(b),env)).status).toBe(502);expect((await marketingAiRoute(req(b),env)).status).toBe(409);expect(db.prepare('SELECT status FROM marketing_ai_operations').get().status).toBe('failed');for(let i=0;i<9;i++)expect((await marketingAiRoute(req(body()),env)).status).toBe(200);expect((await marketingAiRoute(req(body()),env)).status).toBe(409);expect(fetchMock).toHaveBeenCalledTimes(10);});

it('rejects oversized request streams before reservations or paid calls',async()=>{const b=body();b.cells[0].raw='測'.repeat(24000);expect((await marketingAiRoute(req(b),env)).status).toBe(413);expect(fetchMock).not.toHaveBeenCalled();expect(db.prepare('SELECT count(*) AS n FROM marketing_ai_operations').get().n).toBe(0);});

it('enforces enumerated scope even when AI narrows to a supplementary example',async()=>{
 const evidence='冬季被胎（羊毛、石墨烯、鴨絨、鵝絨）9折\n商品名稱：示範羊毛冬被';
 const v={type:'折扣／商品優惠',mode:'keywords',queries:[['示範羊毛冬被']],skus:[],series:''};
 fetchMock.mockResolvedValueOnce(Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({activities:[{cell:'B2',evidence,variants:[v]}],context:[]})}]}]}));
 const b=body();b.cells[0].raw=evidence;const result=await (await marketingAiRoute(req(b),env)).json();
 expect(result.parserPolicy).toBe('20261123-marketing-scope-r2');expect(result.extraction.activities[0].variants[0].queries).toEqual([['羊毛'],['石墨烯'],['鴨絨'],['鵝絨']]);
 expect(JSON.parse(fetchMock.mock.calls[0][1].body).input[0].content).toContain('不能取代前方已列全部範圍');
});
it('isolated rollout keeps explicitly pinned operational v1 unchanged and rejects mismatched clients',async()=>{
 env.MARKETING_AI_VERSION_OVERRIDES=JSON.stringify({testsheet:'20261123-marketing-workflow-r1'});
 expect((await marketingAiRoute(req(body()),env)).status).toBe(409);expect(fetchMock).not.toHaveBeenCalled();
 const b=body();b.version='20261123-marketing-workflow-r1';const r=await (await marketingAiRoute(req(b),env)).json();expect(r.version).toBe(b.version);expect(r.parserPolicy).toBe('20261123-marketing-scope-r1');
 expect(JSON.parse(fetchMock.mock.calls[0][1].body).input[0].content).not.toContain('不能取代前方已列全部範圍');
});

it('constrains AI channel output to exactly the downstream canonical choices',()=>{
 const p=marketingPayload([{ref:'B2',raw:'門市與官網優惠'}],2026,12),v=p.text.format.schema.properties.activities.items.properties.variants.items.properties;
 expect(v.channel).toEqual({type:'string',enum:['','門市','官網','門市＋官網']});expect(p.input[0].content).toContain('平台不等於官網');expect(p.input[0].content).toContain('needsConfirmation=true');
});
it('pinned previous r2 keeps its product scope policy during isolated channel rollout',async()=>{
 env.MARKETING_AI_VERSION_OVERRIDES=JSON.stringify({testsheet:'20261123-marketing-workflow-r2'});const b=body();b.version='20261123-marketing-workflow-r2';const r=await(await marketingAiRoute(req(b),env)).json();
 expect(r.version).toBe(b.version);expect(r.parserPolicy).toBe('20261123-marketing-scope-r2');expect(JSON.parse(fetchMock.mock.calls[0][1].body).input[0].content).toContain('不能取代前方已列全部範圍');
});
