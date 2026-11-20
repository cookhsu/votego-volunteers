import http from 'node:http';
import {readFileSync} from 'node:fs';
import {randomBytes, scryptSync, timingSafeEqual} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {fileURLToPath} from 'node:url';

const db = new DatabaseSync(process.env.VOTEGO_DB || fileURLToPath(new URL('./volunteers.sqlite', import.meta.url)));
db.exec(readFileSync(new URL('./schema.sql',import.meta.url),'utf8'));
const query = (sql,...args) => db.prepare(sql).all(...args);
const get = (sql,...args) => db.prepare(sql).get(...args);
const write = (sql,...args) => db.prepare(sql).run(...args);
const teams = ['活動組','後勤組','行政組','機動組'];
const sessions = new Map();
const failures = new Map();
const roles = ['admin','coordinator','volunteer'];
const demo = process.env.VOTEGO_DEMO !== '0';
function addUser(username,name,role,password) {
  const salt = randomBytes(16).toString('hex');
  return write('INSERT INTO users(username,name,role,salt,password_hash) VALUES(?,?,?,?,?)',username,name,role,salt,scryptSync(password,salt,64).toString('hex')).lastInsertRowid;
}
function transaction(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {const result=fn();db.exec('COMMIT');return result;}
  catch(err){db.exec('ROLLBACK');throw err;}
}
if (!get('SELECT id FROM users LIMIT 1')) {
  if (!demo) throw Error('此版本僅提供本機示範帳號');
  transaction(() => {
    for (const [i,role] of roles.entries()) addUser(role,['林管理員','周組長','許志工'][i],role,'VoteGo-demo-2026');
    for (const person of [['許志工','活動組','approved',3],['陳小可','後勤組','approved',null],['吳小禾','活動組','pending',null],['李小言','行政組','approved',null],['趙小晴','機動組','pending',null],['周小宇','後勤組','approved',null]])
      write('INSERT INTO volunteers(name,team,status,user_id) VALUES(?,?,?,?)',...person);
    for(const event of [['場地布置與動線確認','社區活動中心','2026-11-22T09:00','2026-11-22T12:00'],['志工行前簡報','團隊會議室','2026-11-24T18:30','2026-11-24T20:00'],['器材清點與交接','物資集合點','2026-11-27T14:00','2026-11-27T16:30']])
      write('INSERT INTO events(name,place,starts,ends) VALUES(?,?,?,?)',...event);
    write('INSERT INTO shifts(event_id,volunteer_id) VALUES(1,1),(1,2),(2,4)');
    write('INSERT INTO tasks(name,due,done) VALUES(?,?,0),(?,?,0),(?,?,1)','確認志工報名名單','2026-11-22','整理物資領用清單','2026-11-24','確認集合地點','2026-11-21');
    write('INSERT INTO supplies(name,quantity) VALUES(?,?),(?,?),(?,?)','識別背心',36,'識別證套',50,'指示立牌',8);
  });
}
function problem(status,message){throw Object.assign(Error(message),{status});}
function field(body,key,max=80,required=true) {
  const value = body[key];
  if(typeof value!=='string'||value.length>max||required&&!value.trim())problem(400,'請檢查欄位內容');
  return value.trim();
}
function id(value){if(!Number.isSafeInteger(value)||value<1)problem(400,'資料編號無效');return value;}
function date(value,withTime){
  const pattern = withTime ? /^\d{4}-\d\d-\d\dT\d\d:\d\d$/ : /^\d{4}-\d\d-\d\d$/;
  const iso=withTime?value+':00Z':value+'T00:00:00Z';
  const parsed=new Date(iso);
  if(!pattern.test(value)||!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,value.length)!==value)problem(400,'日期或時間格式有誤');
  return value;
}
async function bodyOf(req) {
  let data='', size=0;
  for await(const chunk of req){size+=chunk.length;if(size>12000)problem(413,'資料過長');data+=chunk;}
  let result;
  try{result=JSON.parse(data);}catch{problem(400,'資料格式有誤');}
  if(!result||Array.isArray(result)||typeof result!=='object')problem(400,'資料格式有誤');
  return result;
}
const publicFiles=new Map([['/',['index.html','text/html']],['/style.css',['style.css','text/css']],['/app.js',['app.js','text/javascript']]]);
const server=http.createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Content-Security-Policy',"default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  const send=(status,body)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(body));};
  try{
    const path=new URL(req.url,'http://localhost').pathname;
    const file=publicFiles.get(path);
    if(req.method==='GET'&&file){res.writeHead(200,{'Content-Type':file[1]+'; charset=utf-8','Cache-Control':'no-store'});res.end(readFileSync(new URL('./'+file[0],import.meta.url)));return;}
    if(!path.startsWith('/api/'))problem(404,'找不到頁面');
    const key=(req.headers.cookie||'').match(/(?:^|; *)votego_session=([a-f0-9]{64})(?:;|$)/)?.[1];
    const session=sessions.get(key);
    const user=session?.until>Date.now()?session.user:null;
    if(session&&!user)sessions.delete(key);
    if(req.method==='GET'&&path==='/api/session')return send(200,{user,demo,teams});
    let data;
    if(req.method==='POST'){
      if(req.headers['x-votego-request']!=='1'||!req.headers['content-type']?.startsWith('application/json'))problem(403,'無法驗證這次操作');
      data=await bodyOf(req);
      if(path==='/api/login'){
        const now=Date.now(), addr=req.socket.remoteAddress;
        const failed=(failures.get(addr)||[]).filter(time=>now-time<60000);
        if(failed.length>=12)problem(429,'登入嘗試過多，請稍候重試');
        const row=get('SELECT * FROM users WHERE username=?',field(data,'username',32));
        const candidate=scryptSync(field(data,'password',128),row?.salt||'votego',64);
        if(!row||!timingSafeEqual(candidate,Buffer.from(row.password_hash,'hex'))){failures.set(addr,[...failed,now]);problem(401,'帳號或密碼有誤');}
        failures.delete(addr);
        if(key)sessions.delete(key);
        const token=randomBytes(32).toString('hex');
        sessions.set(token,{user:{id:row.id,name:row.name,role:row.role},until:now+8*3600000});
        res.setHeader('Set-Cookie','votego_session='+token+'; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800');
        return send(200,{ok:true});
      }
      if(path==='/api/logout'){sessions.delete(key);res.setHeader('Set-Cookie','votego_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');return send(200,{ok:true});}
    }
    if(!user)problem(401,'請先登入');
    const manager=user.role!=='volunteer';
    if(req.method==='GET'&&path==='/api/data'){
      const volunteers=manager?query('SELECT id,name,team,status FROM volunteers ORDER BY id DESC'):query('SELECT id,name,team,status FROM volunteers WHERE user_id=?',user.id);
      const events=manager?query('SELECT * FROM events ORDER BY starts'):query('SELECT DISTINCT e.* FROM events e JOIN shifts s ON s.event_id=e.id JOIN volunteers v ON v.id=s.volunteer_id WHERE v.user_id=? ORDER BY e.starts',user.id);
      const shifts=manager?query('SELECT * FROM shifts'):query('SELECT s.* FROM shifts s JOIN volunteers v ON v.id=s.volunteer_id WHERE v.user_id=?',user.id);
      const tasks=manager?query('SELECT * FROM tasks ORDER BY due'):[],supplies=manager?query('SELECT * FROM supplies ORDER BY name'):[];
      const audit=user.role==='admin'?query('SELECT a.action,a.entity_id,a.created_at,u.name AS actor FROM audit a JOIN users u ON u.id=a.actor_id ORDER BY a.id DESC LIMIT 30'):[];
      return send(200,{volunteers,events,shifts,tasks,supplies,audit});
    }
    if(req.method!=='POST'||path!=='/api/action')problem(404,'找不到頁面');
    if(!manager)problem(403,'此帳號無法執行這項操作');
    transaction(()=>{
      let entity;
      switch(data.action){
        case 'register': {
          const team=field(data,'team',12);
          if(!teams.includes(team))problem(400,'請選擇組別');
          entity=write('INSERT INTO volunteers(name,team) VALUES(?,?)',field(data,'name',40),team).lastInsertRowid;break;
        }
        case 'review': {
          entity=id(data.id);
          if(!['approved','rejected'].includes(data.status))problem(400,'審核結果有誤');
          if(!write("UPDATE volunteers SET status=? WHERE id=? AND status='pending'",data.status,entity).changes)problem(409,'此申請已審核或不存在');
          break;
        }
        case 'event': {
          const starts=date(field(data,'starts',16),true), ends=date(field(data,'ends',16),true);
          if(starts>=ends)problem(400,'結束時間必須晚於開始時間');
          entity=write('INSERT INTO events(name,place,starts,ends) VALUES(?,?,?,?)',field(data,'name'),field(data,'place'),starts,ends).lastInsertRowid;break;
        }
        case 'shift': {
          const event=get('SELECT * FROM events WHERE id=?',id(data.event));
          const volunteer=get('SELECT * FROM volunteers WHERE id=?',id(data.volunteer));
          if(!event||volunteer?.status!=='approved')problem(400,'請選擇活動及已核准志工');
          const clash=get('SELECT s.id FROM shifts s JOIN events e ON e.id=s.event_id WHERE s.volunteer_id=? AND e.starts<? AND e.ends>?',volunteer.id,event.ends,event.starts);
          if(clash)problem(409,'此志工已有重疊班次');
          entity=write('INSERT INTO shifts(event_id,volunteer_id) VALUES(?,?)',event.id,volunteer.id).lastInsertRowid;break;
        }
        case 'task':entity=write('INSERT INTO tasks(name,due) VALUES(?,?)',field(data,'name'),date(field(data,'due',10),false)).lastInsertRowid;break;
        case 'toggle':entity=id(data.id);if(!write('UPDATE tasks SET done=? WHERE id=?',data.done===true?1:0,entity).changes)problem(404,'找不到任務');break;
        case 'supply': {
          if(user.role!=='admin')problem(403,'只有管理員可調整庫存');
          if(!Number.isSafeInteger(data.quantity)||data.quantity<0||data.quantity>100000)problem(400,'請輸入有效庫存數量');
          entity=get('INSERT INTO supplies(name,quantity) VALUES(?,?) ON CONFLICT(name) DO UPDATE SET quantity=excluded.quantity RETURNING id',field(data,'name'),data.quantity).id;break;
        }
        default:problem(400,'操作無效');
      }
      write('INSERT INTO audit(actor_id,action,entity_id) VALUES(?,?,?)',user.id,data.action,entity);
    });
    send(200,{ok:true});
  }catch(err){if(!err.status)console.error(err);send(err.status||500,{error:err.status?err.message:'系統暫時無法處理'});}
});
server.listen(Number(process.env.PORT||4175),'127.0.0.1',()=>console.log('http://127.0.0.1:'+server.address().port));

