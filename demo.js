const storageKey = 'votego-volunteers:demo:v1';
const teams = ['活動組','後勤組','行政組','機動組'];
const people = {admin:{id:1,name:'林管理員',role:'admin'},coordinator:{id:2,name:'周組長',role:'coordinator'},volunteer:{id:3,name:'許志工',role:'volunteer'}};
let user;
const initial = {
  volunteers:[{id:1,user_id:3,name:'許志工',team:'活動組',status:'approved'},{id:2,name:'陳小可',team:'後勤組',status:'approved'},{id:3,name:'吳小禾',team:'行政組',status:'pending'},{id:4,name:'周小宇',team:'機動組',status:'approved'}],
  events:[{id:1,name:'場地布置與動線確認',place:'社區活動中心',starts:'2026-11-22T09:00',ends:'2026-11-22T12:00'},{id:2,name:'志工行前簡報',place:'團隊會議室',starts:'2026-11-24T18:30',ends:'2026-11-24T20:00'}],
  shifts:[{id:1,event_id:1,volunteer_id:1},{id:2,event_id:1,volunteer_id:2}],
  tasks:[{id:1,name:'確認志工報名名單',due:'2026-11-22',done:0},{id:2,name:'整理物資領用清單',due:'2026-11-24',done:0}],
  supplies:[{id:1,name:'識別背心',quantity:36},{id:2,name:'識別證套',quantity:50}],
  audit:[]
};
function load() {
  const json=sessionStorage.getItem(storageKey);
  return json ? JSON.parse(json) : structuredClone(initial);
}
const nextId=items=>Math.max(0,...items.map(item=>item.id))+1;
function text(value,max=80) {
  if(typeof value!=='string'||!value.trim()||value.length>max)throw Error('請檢查欄位內容');
  return value.trim();
}
function date(value,withTime){
  const pattern=withTime?/^\d{4}-\d\d-\d\dT\d\d:\d\d$/:/^\d{4}-\d\d-\d\d$/;
  if(typeof value!=='string'||!pattern.test(value)) throw Error('日期或時間格式有誤');
  const parsed=new Date(withTime?value+':00Z':value+'T00:00:00Z');
  if(!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,value.length)!==value)throw Error('日期或時間格式有誤');
  return value;
}
export async function demoRequest(path, body) {
  if(path==='session')return {user:user??null,demo:true,teams};
  if(path==='login'){
    if(!Object.hasOwn(people,body.username)||body.password!=='VoteGo-demo-2026')throw Error('帳號或密碼有誤');
    user=people[body.username];return {ok:true};
  }
  if(path==='logout'){user=undefined;return {ok:true};}
  if(!user)throw Error('請先登入');
  const data=load();
  const manager=user.role!=='volunteer';
  if(path==='data'){
    if(manager)return {...data,audit:user.role==='admin'?data.audit.slice(0,30):[]};
    const volunteers=data.volunteers.filter(person=>person.user_id===user.id);
    const shifts=data.shifts.filter(shift=>volunteers.some(person=>person.id===shift.volunteer_id));
    return {volunteers,shifts,events:data.events.filter(event=>shifts.some(shift=>shift.event_id===event.id)),tasks:[],supplies:[],audit:[]};
  }
  if(path!=='action'||!manager)throw Error('此帳號無法執行這項操作');
  let entity;
  switch(body.action){
    case 'register':
      if(!teams.includes(body.team))throw Error('請選擇組別');
      entity=nextId(data.volunteers);
      data.volunteers.unshift({id:entity,name:text(body.name,40),team:body.team,status:'pending'});
      break;
    case 'review': {
      const person=data.volunteers.find(x=>x.id===body.id&&x.status==='pending');
      if(!person||!['approved','rejected'].includes(body.status))throw Error('此申請已審核或不存在');
      person.status=body.status;entity=person.id;break;
    }
    case 'event': {
      const starts=date(body.starts,true),ends=date(body.ends,true);
      if(starts>=ends)throw Error('結束時間必須晚於開始時間');
      entity=nextId(data.events);
      data.events.push({id:entity,name:text(body.name),place:text(body.place),starts,ends});
      data.events.sort((a,b)=>a.starts.localeCompare(b.starts));break;
    }
    case 'shift': {
      const event=data.events.find(x=>x.id===body.event);
      const person=data.volunteers.find(x=>x.id===body.volunteer&&x.status==='approved');
      if(!event||!person)throw Error('請選擇活動及已核准志工');
      const conflict=data.shifts.filter(x=>x.volunteer_id===person.id).some(shift=>{
        const booked=data.events.find(x=>x.id===shift.event_id);
        return booked.starts<event.ends&&booked.ends>event.starts;
      });
      if(conflict)throw Error('此志工已有重疊班次');
      entity=nextId(data.shifts);
      data.shifts.push({id:entity,event_id:event.id,volunteer_id:person.id});break;
    }
    case 'task':
      entity=nextId(data.tasks);
      data.tasks.push({id:entity,name:text(body.name),due:date(body.due,false),done:0});
      data.tasks.sort((a,b)=>a.due.localeCompare(b.due));break;
    case 'toggle':{
      const task=data.tasks.find(x=>x.id===body.id);
      if(!task)throw Error('找不到任務');
      task.done=body.done===true?1:0;entity=task.id;break;
    }
    case 'supply':{
      if(user.role!=='admin')throw Error('只有管理員可調整庫存');
      if(!Number.isSafeInteger(body.quantity)||body.quantity<0||body.quantity>100000)throw Error('請輸入有效庫存數量');
      const name=text(body.name), item=data.supplies.find(x=>x.name===name);
      entity=item?.id??nextId(data.supplies);
      if(item)item.quantity=body.quantity;else data.supplies.push({id:entity,name,quantity:body.quantity});
      break;
    }
    default:throw Error('操作無效');
  }
  data.audit.unshift({actor:user.name,action:body.action,entity_id:entity,created_at:new Date().toISOString()});
  sessionStorage.setItem(storageKey,JSON.stringify(data));
  return {ok:true};
}
