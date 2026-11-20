const $ = selector => document.querySelector(selector);
const names = {admin:'系統管理員',coordinator:'團隊協調員',volunteer:'志工'};
const states = {pending:'待審核',approved:'已核准',rejected:'未通過'};
const pages = [['home','總覽','總'],['people','志工名單','人'],['review','報名與審核','審'],['events','活動管理','活'],['shifts','排班管理','班'],['tasks','任務管理','任'],['supplies','物資管理','資'],['reports','統計報表','報'],['audit','稽核紀錄','誌']];
const dialog=$('#editor');
let session, data, current='home', activeAction;
const isManager=()=>session.user.role!=='volunteer';
const isAdmin=()=>session.user.role==='admin';
function el(tag,text='',className='') {
  const node=document.createElement(tag);
  node.textContent=text;
  if(className)node.className=className;
  return node;
}
function button(text,action,className='') {
  const node=el('button',text,className);
  node.type='button';
  node.addEventListener('click',action);
  return node;
}
async function api(path,body) {
  const options=body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json','X-VoteGo-Request':'1'},body:JSON.stringify(body)};
  const response=await fetch('/api/'+path,options);
  const result=await response.json();
  if(!response.ok)throw Error(result.error);
  return result;
}
async function refresh() {data=await api('data');render();}
async function init() {
  session=await api('session');
  $('#demo').hidden=!session.demo;
  $('#login-view').hidden=!!session.user;
  $('#workspace').hidden=!session.user;
  if(!session.user)return;
  $('#user-name').textContent=session.user.name;
  $('#user-role').textContent=names[session.user.role];
  $('.avatar').textContent=session.user.name[0];
  await refresh();
}
const login = $('#login');
async function signIn(username,password) {
  const status=$('#login-status'), submit=login.querySelector('button');
  submit.disabled=true;
  status.textContent='';
  try{await api('login',{username,password});login.reset();current='home';await init();}
  catch(error){status.textContent=error.message;}
  finally{submit.disabled=false;}
}
login.addEventListener('submit',e=>{e.preventDefault();const form=new FormData(login);void signIn(form.get('username'),form.get('password'));});
$('#demo').addEventListener('click',e=>{if(e.target.dataset.demo)void signIn(e.target.dataset.demo,'VoteGo-demo-2026');});
$('#logout').addEventListener('click',async()=>{
  try{await api('logout',{});$('#page').replaceChildren();$('#work-status').textContent='';await init();login.elements.username.focus();}
  catch(error){$('#work-status').textContent=error.message;}
});
function setMenu(open) {
  $('#sidebar').classList.toggle('open',open);
  $('#menu-toggle').setAttribute('aria-expanded',String(open));
}
$('#menu-toggle').addEventListener('click',()=>setMenu(!$('#sidebar').classList.contains('open')));
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&$('#sidebar').classList.contains('open')){setMenu(false);$('#menu-toggle').focus();}});
function show(key) {
  current=key;setMenu(false);render();
  $('#main').focus();window.scrollTo(0,0);
}
const status=(value)=>el('span',states[value]||value,'pill '+value);
const dt=(value)=>value.replace('T',' ');
function panel(name) {
  const node=el('section','','panel');
  node.append(el('h2',name));
  return node;
}
function row(name,secondary,other) {
  const line=el('div','','row'), lead=el('div');
  lead.append(el('strong',name));
  if(secondary)lead.append(el('small',secondary));
  line.append(lead);
  if(other)line.append(other);
  return line;
}
function table(headers,entries) {
  if(!entries.length)return el('p','目前沒有符合條件的資料。','empty');
  const wrap=el('div','','table-scroll'), grid=el('table'), head=el('thead'), body=el('tbody'), labels=el('tr');
  wrap.tabIndex=0;
  wrap.setAttribute('role','region');
  wrap.setAttribute('aria-label','資料表格，可水平捲動');
  for(const h of headers){const cell=el('th',h);cell.scope='col';labels.append(cell);}
  head.append(labels);
  for(const entry of entries){
    const line=el('tr');
    for(const value of entry){
      const cell=el('td');
      if(value instanceof Node)cell.append(value);else cell.textContent=value;
      line.append(cell);
    }
    body.append(line);
  }
  grid.append(head,body);wrap.append(grid);return wrap;
}
function heading(title,description,action) {
  const wrapper=el('div','','page-head'), block=el('div');
  block.append(el('h1',title),el('p',description));wrapper.append(block);
  if(action)wrapper.append(action);
  return wrapper;
}
const eventLabel=id=>data.events.find(x=>x.id===id)?.name||'活動';
const volunteerLabel=id=>data.volunteers.find(x=>x.id===id)?.name||'志工';
const approved=()=>data.volunteers.filter(x=>x.status==='approved');
const pending=()=>data.volunteers.filter(x=>x.status==='pending');
const add=(key,label)=>button(label,()=>edit(key),'primary');
const actions={
  register:['新增志工報名',[['name','姓名','text'],['team','組別',()=>session.teams.map(x=>[x,x])]]],
  event:['新增活動',[['name','活動名稱','text'],['place','地點','text'],['starts','開始時間（臺灣時間）','datetime-local'],['ends','結束時間（臺灣時間）','datetime-local']]],
  shift:['新增排班',[['event','活動',()=>data.events.map(x=>[x.id,x.name+' · '+dt(x.starts)])],['volunteer','已核准志工',()=>approved().map(x=>[x.id,x.name+' · '+x.team])]]],
  task:['新增任務',[['name','任務名稱','text'],['due','截止日期','date']]],
  supply:['調整庫存',[['name','物資名稱','text'],['quantity','調整後數量','number']]]
};
function edit(key) {
  const [title,schema]=actions[key];
  activeAction=key;
  $('#editor-title').textContent=title;
  $('#editor-status').textContent='';
  const fields=$('#fields');fields.replaceChildren();
  let disabled=false;
  for(const [name,label,type] of schema){
    const wrap=el('label',label), field=el(typeof type==='function'?'select':'input');
    field.name=name;field.required=true;
    if(typeof type==='function'){
      const values=type();
      field.append(new Option(values.length?'請選擇':'目前沒有可選資料',''));
      for(const [value,text] of values)field.append(new Option(text,value));
      disabled||=!values.length;
    }else{
      field.type=type;field.maxLength=name==='name'&&key==='register'?40:80;
      if(type==='number'){field.min=0;field.max=100000;field.step=1;}
    }
    wrap.append(field);fields.append(wrap);
  }
  $('#editor-form button[type=submit]').disabled=disabled;
  dialog.showModal();
}
$('#cancel').onclick=()=>dialog.close();
async function perform(payload) {
  $('#work-status').textContent='';
  try{await api('action',payload);await refresh();$('#work-status').textContent='已更新';}
  catch(error){$('#work-status').textContent=error.message;}
}
$('#editor-form').addEventListener('submit',async event=>{
  event.preventDefault();
  const submit=event.currentTarget.querySelector('button[type=submit]');
  const payload=Object.fromEntries(new FormData(event.currentTarget));
  payload.action=activeAction;
  for(const key of ['event','volunteer','quantity'])if(key in payload)payload[key]=Number(payload[key]);
  submit.disabled=true;
  try{await api('action',payload);dialog.close();await refresh();$('#work-status').textContent='已儲存';}
  catch(error){$('#editor-status').textContent=error.message;}
  finally{submit.disabled=false;}
});
function groups() {
  const box=panel('志工組別分布');
  for(const team of session.teams){
    const n=approved().filter(x=>x.team===team).length, line=el('div','','progress-row'), bar=el('progress');
    bar.max=Math.max(1,approved().length);bar.value=n;bar.setAttribute('aria-label',team);
    line.append(el('span',team),bar,el('strong',String(n)));box.append(line);
  }
  return box;
}
function eventList() {
  const box=panel(isManager()?'近期活動':'我的活動');
  for(const item of data.events.slice(0,3))box.append(row(item.name,item.place,el('time',dt(item.starts))));
  if(!data.events.length)box.append(el('p','目前沒有安排。','empty'));
  return box;
}
function taskList() {
  const box=panel('待辦任務');
  for(const item of data.tasks.filter(x=>!x.done).slice(0,4))box.append(row(item.name,item.due,button('完成',()=>perform({action:'toggle',id:item.id,done:true}),'quiet')));
  if(!box.querySelector('.row'))box.append(el('p','目前沒有未完成的任務。','empty'));
  return box;
}
function home(view) {
  view.append(heading(isManager()?'首頁總覽':'我的志工工作區',isManager()?'查看志工、活動與團隊目前的工作進度。':'查看自己的志工狀態與已安排班次。'));
  if(!isManager()){
    const own=panel('我的資料');
    for(const person of data.volunteers)own.append(row(person.name,person.team,status(person.status)));
    view.append(own,eventList());return;
  }
  const metrics=el('div','','metrics');
  for(const [label,value] of [['志工總數',data.volunteers.length],['已核准',approved().length],['已安排班次',data.shifts.length],['未完成任務',data.tasks.filter(x=>!x.done).length]]){
    const box=el('div','','metric');box.append(el('span',label),el('strong',String(value)));metrics.append(box);
  }
  const hero=el('section','','hero');
  hero.append(el('h2','志工報名與排班'),el('p','新增報名、審核資料，再安排活動支援。'),add('register','新增志工報名'));
  const upper=el('div','','dashboard'), lower=el('div','','dashboard');
  upper.append(hero,eventList());lower.append(groups(),taskList());
  const people=panel('最新志工名單');
  people.append(table(['姓名','組別','狀態'],data.volunteers.slice(0,5).map(x=>[x.name,x.team,status(x.status)])));
  view.append(metrics,upper,lower,people);
}
function peoplePage(view,onlyPending) {
  const list=onlyPending?pending():data.volunteers;
  view.append(heading(onlyPending?'報名與審核':'志工名單',onlyPending?'待審核 '+list.length+' 筆':'目前 '+list.length+' 筆紀錄',add('register','新增報名')));
  const box=panel(onlyPending?'待審核申請':'名單');
  const input=el('input');input.type='search';input.placeholder='搜尋姓名或組別';input.setAttribute('aria-label','搜尋姓名或組別');
  const output=el('div');
  function redraw(){
    const q=input.value.trim().toLowerCase();
    output.replaceChildren(table(onlyPending?['姓名','組別','審核操作']:['姓名','組別','狀態'],list.filter(x=>(x.name+' '+x.team).toLowerCase().includes(q)).map(x=>{
      if(!onlyPending)return [x.name,x.team,status(x.status)];
      const ops=el('div','','controls');
      ops.append(button('核准',()=>perform({action:'review',id:x.id,status:'approved'}),'quiet'),button('退回',()=>perform({action:'review',id:x.id,status:'rejected'}),'quiet danger'));
      return [x.name,x.team,ops];
    })));
  }
  input.addEventListener('input',redraw);redraw();box.append(input,output);view.append(box);
}
function render(){
  const available=pages.filter(([key])=>isManager()?key!=='audit'||isAdmin():['home','events','shifts'].includes(key));
  $('#menu').replaceChildren(...available.map(([key,label,icon])=>{
    const link=button(label,()=>show(key)), mark=el('span',icon,'menu-icon');
    mark.setAttribute('aria-hidden','true');link.prepend(mark);
    if(key===current)link.setAttribute('aria-current','page');
    return link;
  }));
  const view=$('#page');view.replaceChildren();
  if(current==='home'){home(view);return;}
  if(current==='people'||current==='review'){peoplePage(view,current==='review');return;}
  const title=pages.find(([key])=>key===current)[1];
  const create={events:['event','新增活動'],shifts:['shift','新增排班'],tasks:['task','新增任務'],supplies:['supply','調整庫存']}[current];
  view.append(heading(!isManager()?(current==='events'?'我的活動':'我的班次'):title,'',create&&isManager()&&(current!=='supplies'||isAdmin())?add(...create):null));
  let grid;
  if(current==='events')grid=table(['活動','地點','開始','結束'],data.events.map(x=>[x.name,x.place,dt(x.starts),dt(x.ends)]));
  if(current==='shifts')grid=table(['活動','志工','開始時間'],data.shifts.map(x=>[eventLabel(x.event_id),volunteerLabel(x.volunteer_id),dt(data.events.find(e=>e.id===x.event_id)?.starts||'')]));
  if(current==='tasks')grid=table(['任務','截止','狀態','操作'],data.tasks.map(x=>[x.name,x.due,x.done?'已完成':'待辦',button(x.done?'重新開啟':'標記完成',()=>perform({action:'toggle',id:x.id,done:!x.done}),'quiet')]));
  if(current==='supplies')grid=table(['物資','現有數量'],data.supplies.map(x=>[x.name,x.quantity]));
  if(current==='audit'){
    const labels={register:'新增報名',review:'審核',event:'新增活動',shift:'排班',task:'新增任務',toggle:'調整任務狀態',supply:'調整庫存'};
    grid=table(['操作者','操作','資料編號','時間（UTC）'],data.audit.map(x=>[x.actor,labels[x.action],x.entity_id,x.created_at]));
  }
  if(current==='reports'){
    const summary=panel('審核與排班');
    summary.append(table(['項目','數量'],[['待審核',pending().length],['已核准',approved().length],['未通過',data.volunteers.filter(x=>x.status==='rejected').length],['已安排班次',data.shifts.length]]));
    const split=el('div','','dashboard');split.append(groups(),summary);view.append(split);return;
  }
  const wrapper=panel(title);wrapper.append(grid);view.append(wrapper);
}
init().catch(error=>{$('#login-status').textContent=error.message;$('#work-status').textContent=error.message;});

