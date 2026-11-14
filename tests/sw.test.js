/* Checks the background notification worker (firebase-messaging-sw.js) with a pretend browser. Run: node tests/sw.test.js */
const fs=require('fs'), vm=require('vm'); const src=fs.readFileSync(process.argv[2]||require('path').join(__dirname,'..','firebase-messaging-sw.js'),'utf8');
let fails=[]; const ok=(c,m)=>{ if(!c) fails.push(m); console.log((c?'PASS ':'FAIL ')+m); };
function run(){ const L={}; const shown=[]; const opened=[]; let closed=0, focused=0, clients=[];
  const self={ addEventListener:(t,f)=>{L[t]=f;}, skipWaiting(){}, clients:{ claim(){return Promise.resolve();}, matchAll:()=>Promise.resolve(clients), openWindow:u=>{opened.push(u);return Promise.resolve();} },
    registration:{ scope:'https://x.github.io/app/', showNotification:(t,o)=>{shown.push([t,o]);return Promise.resolve();} } };
  vm.runInNewContext(src,{self,importScripts:()=>{throw new Error('importScripts must not be used');}});
  const ev=(extra)=>{ let pr; return Object.assign({waitUntil:p=>{pr=p;}, get p(){return pr;}},extra); };
  return {L,shown,opened,ev,setClients:c=>clients=c,get closed(){return closed;},self}; }
(async()=>{
  ok(!/importScripts|gstatic/.test(src),'no importScripts / no outside website');
  let r=run(); ok(['push','notificationclick','install','activate'].every(k=>r.L[k]),'handlers registered');
  const fcm={notification:{title:'Food log',body:'Nothing logged yet today',icon:'https://x.github.io/app/icon-192.png'},fcmOptions:{link:'https://x.github.io/app/?c=wilson-abc'},from:'123'};
  let e=r.ev({data:{json:()=>fcm}}); r.L.push(e); await e.p; ok(r.shown.length===1&&r.shown[0][0]==='Food log'&&r.shown[0][1].body==='Nothing logged yet today'&&r.shown[0][1].icon.endsWith('icon-192.png')&&r.shown[0][1].data.link.endsWith('?c=wilson-abc'),'FCM-shaped push shows title/body/icon/link');
  e=r.ev({data:{json:()=>({data:{title:'T',body:'B'}})}}); r.L.push(e); await e.p; ok(r.shown[1][0]==='T'&&r.shown[1][1].data.link===r.self.registration.scope,'data-only push still shows, link falls back to the app');
  e=r.ev({data:{json:()=>{throw new Error('bad');},text:()=>'plain text'}}); r.L.push(e); await e.p; ok(r.shown[2][1].body==='plain text','non-JSON push shows the text');
  e=r.ev({}); r.L.push(e); await e.p; ok(r.shown[3][0]==='Health & Wealth','empty push still shows a notification (browsers require one)');
  let closed=false; e=r.ev({notification:{close(){closed=true;},data:{link:'https://x.github.io/app/?c=wilson-abc'}}}); r.setClients([]); r.L.notificationclick(e); await e.p; ok(closed&&r.opened[0].endsWith('?c=wilson-abc'),'tap opens the client link');
  let fo=0; e=r.ev({notification:{close(){},data:{link:'L1'}}}); r.setClients([{url:'L1',focus(){fo++;return Promise.resolve();}}]); r.L.notificationclick(e); await e.p; ok(fo===1&&r.opened.length===1,'tap focuses an already-open window');
  console.log(fails.length?'FAILS: '+fails.join(' | '):'ALL PASS'); process.exit(fails.length?1:0); })();
