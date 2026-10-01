// node test-offline.cjs — service-worker/cache and UI state tests without dependencies
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const swSource = fs.readFileSync(path.join(__dirname,'sw.js'),'utf8');
const uiSource = fs.readFileSync(path.join(__dirname,'offline.js'),'utf8');
const base = 'https://example.test/travel-memo/';
function worker() {
 const handlers={}, stores=new Map(), calls=[];
 const env={URL,Request,fetch:async req=>{calls.push(req.url);if(env.offline)throw Error('offline');return new Response('fresh:'+req.url)},self:{location:{href:base+'sw.js'},clients:{claim:async()=>env.claimed=true},skipWaiting:async()=>env.skipped=true,addEventListener:(n,f)=>handlers[n]=f}};
 env.caches={keys:async()=>[...stores.keys()],delete:async k=>stores.delete(k),open:async k=>{
  if(!stores.has(k))stores.set(k,new Map()); const store=stores.get(k);
  return {match:async u=>store.get(u),put:async(u,r)=>store.set(u,r),addAll:async requests=>{
   const responses=[];for(const req of requests){assert.equal(req.cache,'reload');responses.push(await env.fetch(req))}requests.forEach((r,i)=>store.set(r.url,responses[i]));
  }};
 }};
 vm.runInNewContext(swSource,env);
 const event=async(type,extra={})=>{let promise;handlers[type]({...extra,waitUntil:p=>promise=p});await promise};
 const fetchEvent=async(url,mode='navigate',method='GET')=>{let result;handlers.fetch({request:{url,mode,method},respondWith:p=>result=p});return result};
 return {env,handlers,stores,event,fetchEvent,calls};
}
function ui({controller=true,ready=true,waiting=false,unsupported=false}={}) {
 const els={},events={},docEvents={},timers=new Map();let timerId=0;
 const el=id=>els[id]??={value:'',hidden:id==='apply-update',listeners:{},addEventListener(n,f){this.listeners[n]=f}};
 const registration={waiting:waiting?{postMessage:m=>env.activated=m.type}:null,installing:null,addEventListener(n,f){events[n]=f},update:async()=>{if(env.failUpdate)throw Error('offline')}};
 const navigator={onLine:true,serviceWorker:{controller:controller?{postMessage(m,ports){ports[0].reply({ready})}}:null,register:async(url,options)=>{assert.equal(url,'./sw.js');assert.equal(options.scope,'./');if(env.failRegister)throw Error();return registration},addEventListener:(n,f)=>events[n]=f}};
 if(unsupported)delete navigator.serviceWorker;
 const env={navigator,document:{getElementById:el,visibilityState:'visible',addEventListener:(n,f)=>docEvents[n]=f},window:{isSecureContext:true,location:{reload:()=>env.reloaded=true},addEventListener:(n,f)=>events[n]=f},confirm:()=>true,setTimeout:f=>{timers.set(++timerId,f);return timerId},clearTimeout:id=>timers.delete(id),MessageChannel:class{constructor(){this.port1={onmessage:null,close(){}};this.port2={reply:data=>this.port1.onmessage({data})}}}};
 vm.runInNewContext(uiSource,env);
 return {els,events,docEvents,env,registration,timers,el};
}
(async()=>{
 let w=worker();w.stores.set('unrelated-cache',new Map());w.stores.set('travel-memo:/other/:v0',new Map());w.stores.set('travel-memo:/travel-memo/:v0',new Map());
 await w.event('install');assert(!w.env.skipped);await w.event('activate');assert(w.env.claimed);assert(w.stores.has('unrelated-cache'));assert(w.stores.has('travel-memo:/other/:v0'));assert(!w.stores.has('travel-memo:/travel-memo/:v0'));
 w.env.offline=true;for(const url of [base,base+'?from=home',base+'index.html',base+'index.html?q=1',base+'offline.js'])assert((await w.fetchEvent(url)).ok);
 assert.equal(await w.fetchEvent('https://example.test/another/'),undefined);assert.equal(await w.fetchEvent(base+'backup.json'),undefined);assert.equal(await w.fetchEvent(base,'navigate','POST'),undefined);assert.equal(await w.fetchEvent('https://elsewhere.test/travel-memo/'),undefined);
 let message;await w.event('message',{data:{type:'CHECK_OFFLINE'},ports:[{postMessage:m=>message=m}]});assert(message.ready);
 w.stores.get('travel-memo:/travel-memo/:v4').delete(base+'offline.js');await w.event('message',{data:{type:'CHECK_OFFLINE'},ports:[{postMessage:m=>message=m}]});assert.equal(message.ready,false);
 w.env.offline=false;assert((await w.fetchEvent(base+'offline.js','cors')).ok);await w.event('message',{data:{type:'ACTIVATE_UPDATE'},ports:[]});assert(w.env.skipped);
 w=worker();w.stores.set('travel-memo:/travel-memo/:v0',new Map([['old','preserved']]));w.env.offline=true;await assert.rejects(w.event('install'));assert(w.stores.has('travel-memo:/travel-memo/:v0'));assert.equal(w.stores.get('travel-memo:/travel-memo/:v4').size,0);
 const tick=()=>new Promise(r=>setImmediate(r));
 let u=ui();await tick();assert(u.els['offline-status'].textContent.includes('準備ができました'));assert(!u.env.reloaded);
 u.env.navigator.onLine=false;u.events.offline();assert(u.els['connection-status'].textContent.includes('オフライン'));assert(u.els['offline-status'].textContent.includes('準備ができました'));
 u=ui({ready:false});await tick();assert(u.els['offline-status'].textContent.includes('未完了'));
 u=ui({controller:false});await tick();assert(u.els['offline-status'].textContent.includes('準備中'));
 u=ui({unsupported:true});assert(u.els['check-update'].hidden);
 u=ui({waiting:true});await tick();assert.equal(u.els['apply-update'].hidden,false);u.el('memo').value='入力中';u.els['apply-update'].listeners.click();assert(!u.env.activated);u.el('memo').value='';u.env.confirm=()=>false;u.els['apply-update'].listeners.click();assert(!u.env.activated);u.env.confirm=()=>true;u.els['apply-update'].listeners.click();assert.equal(u.env.activated,'ACTIVATE_UPDATE');u.events.controllerchange();assert(u.env.reloaded);
 u=ui();await tick();u.events.controllerchange();assert(!u.env.reloaded);u.env.failUpdate=true;await u.els['check-update'].listeners.click();assert(u.els['update-status'].textContent.includes('確認できません'));assert.equal(u.els['check-update'].disabled,false);
 console.log('PASS: precache; offline root/index/query/JS; scoped cleanup; excluded requests; missing-cache readiness/repair; failed install preserves old cache; explicit activation; readiness UI; unsupported mode; update/cancel/input guard; no forced reload; offline update failure.');
})().catch(e=>{console.error(e);process.exitCode=1});

