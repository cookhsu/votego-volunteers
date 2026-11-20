import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';

const server=spawn(process.execPath,['server.mjs'],{cwd:new URL('.',import.meta.url),env:{...process.env,PORT:'0',VOTEGO_DB:':memory:',VOTEGO_DEMO:'1'},stdio:['ignore','pipe','inherit']});
try {
  const base=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('Server startup timed out')),5000);
    server.stdout.once('data',chunk=>{clearTimeout(timer);resolve(String(chunk).trim());});
    server.once('error',reject);
    server.once('exit',()=>reject(Error('Server exited')));
  });
  async function call(path,payload,cookie,expected=200){
    const headers=cookie?{Cookie:cookie}:{};
    if(payload){headers['Content-Type']='application/json';headers['X-VoteGo-Request']='1';}
    const res=await fetch(base+'/api/'+path,{headers,...(payload?{method:'POST',body:JSON.stringify(payload)}:{})});
    assert.equal(res.status,expected,path+' '+JSON.stringify(payload));
    return {body:await res.json(),cookie:res.headers.get('set-cookie')?.split(';')[0]};
  }
  const password='VoteGo-demo-2026';
  await call('data',null,null,401);
  await call('login',{username:'admin',password:'invalid'},null,401);
  const admin=(await call('login',{username:'admin',password})).cookie;
  const coordinator=(await call('login',{username:'coordinator',password})).cookie;
  const user=(await call('login',{username:'volunteer',password})).cookie;
  const own=(await call('data',null,user)).body;
  assert.equal(own.volunteers.length,1);
  assert.equal(own.shifts.length,1);
  assert.equal(own.supplies.length,0);
  await call('action',{action:'register',name:'不允許',team:'活動組'},user,403);
  await call('action',{action:'register',name:'假資料測試',team:'活動組'},coordinator);
  let data=(await call('data',null,admin)).body;
  const person=data.volunteers.find(v=>v.name==='假資料測試');
  assert.equal(person.status,'pending');
  await call('action',{action:'shift',event:1,volunteer:person.id},coordinator,400);
  await call('action',{action:'review',id:person.id,status:'approved'},coordinator);
  await call('action',{action:'review',id:person.id,status:'rejected'},coordinator,409);
  await call('action',{action:'shift',event:1,volunteer:person.id},coordinator);
  await call('action',{action:'event',name:'重疊測試',place:'測試場地',starts:'2026-11-22T10:00',ends:'2026-11-22T11:00'},coordinator);
  data=(await call('data',null,admin)).body;
  const overlap=data.events.find(e=>e.name==='重疊測試');
  await call('action',{action:'shift',event:overlap.id,volunteer:person.id},coordinator,409);
  await call('action',{action:'task',name:'測試截止',due:'2026-02-30'},coordinator,400);
  await call('action',{action:'task',name:'測試任務',due:'2026-11-28'},coordinator);
  data=(await call('data',null,admin)).body;
  await call('action',{action:'toggle',id:data.tasks.find(t=>t.name==='測試任務').id,done:true},coordinator);
  await call('action',{action:'supply',name:'識別背心',quantity:0},coordinator,403);
  await call('action',{action:'supply',name:'識別背心',quantity:-1},admin,400);
  await call('action',{action:'supply',name:'識別背心',quantity:32},admin);
  data=(await call('data',null,admin)).body;
  assert.equal(data.supplies.find(x=>x.name==='識別背心').quantity,32);
  assert.ok(data.audit.some(x=>x.action==='supply'));
  assert.equal((await call('data',null,coordinator)).body.audit.length,0);
  await call('logout',{},user);
  await call('data',null,user,401);
  console.log('PASS: 身份驗證、志工隔離、報名、審核、排班與衝突、資料驗證、任務、庫存、稽核及登出');
} finally {server.kill();}

