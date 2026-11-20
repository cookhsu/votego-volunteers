import {mkdir,copyFile,readFile,writeFile} from 'node:fs/promises';

const here = name => new URL(name,import.meta.url);
await mkdir(here('./public/'),{recursive:true});
await copyFile(here('style.css'),here('public/style.css'));
const html=await readFile(here('index.html'),'utf8');
const app=await readFile(here('app.js'),'utf8');
if(process.env.VERCEL_ENV==='production'||process.env.VOTEGO_HOSTED_AUTH==='1'){
  await writeFile(here('public/index.html'),html);
  await writeFile(here('public/app.js'),app.replace("fetch('/api/'+path,options)","fetch('/api/workspace?op='+encodeURIComponent(path),options)"));
}else{
await copyFile(here('demo.js'),here('public/demo.js'));
const announcement='<p class="notice">線上示範版。請使用假資料，修改只會留在此瀏覽器分頁。</p>';
await writeFile(here('public/index.html'),html.replace('<form id="login">',announcement+'<form id="login">').replace('<main id="main" tabindex="-1">','<main id="main" tabindex="-1">'+announcement));
const start=app.indexOf('async function api(');
const end=app.indexOf('async function refresh(',start);
if(start<0||end<0)throw Error('找不到查詢介面的連接點');
await writeFile(here('public/app.js'),"import { demoRequest as api } from './demo.js';\n"+app.slice(0,start)+app.slice(end));
}

