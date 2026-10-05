// Run: node test-backup.cjs (no external dependencies)
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = readFileSync(join(__dirname, 'index.html'), 'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
const fixtures = [
  {category:'食事',amount:1200,memo:'昼食,"定食"\nお茶',date:'2026-10-01',dateTime:'10/1 12:00'},
  {category:'交通',amount:800,memo:'=1+1',date:'2026-10-01'},
  {category:'その他',amount:50,memo:'旧記録',dateTime:'9/30 09:00'},
  {category:'食事',amount:100,memo:'日付なし'}
];
function harness(records=fixtures, storage=new Map()) {
  if (!storage.has('expenses')) storage.set('expenses',JSON.stringify(records));
  const els = {}, downloads=[], shared=[], alerts=[];
  function el(){return {value:'',hidden:false,children:[],appendChild(x){this.children.push(x)},addEventListener(){},set innerHTML(v){this.children=[]},click(){downloads.push(this.download)},remove(){}}}
  const document={getElementById(id){return els[id]??=el()},createElement:el,body:el()};
  const env={document,File:globalThis.File,Date,console,confirm:()=>true,alert:m=>alerts.push(m),
    navigator:{canShare:()=>true,share:async x=>shared.push(x)},URL:{createObjectURL:()=> 'blob:test',revokeObjectURL(){}},setTimeout:f=>f(),
    localStorage:{getItem:k=>storage.get(k)??null,setItem(k,v){if(env.failKey===k)throw Error('quota');storage.set(k,v)}}};
  const ctx=vm.createContext(env); vm.runInContext(source,ctx);
  return {ctx,els,storage,env,downloads,shared,alerts};
}
function cards(h) {
 return h.els.list.children.flatMap(group => group.children[0].children[1].children);
}
// Subcategories must survive storage/export/restore without changing legacy records or totals.
{
 const h=harness(), c=h.ctx;
 h.env.document.getElementById('amount');h.env.document.getElementById('memo');
 const expected={'食事':['外食','コンビニ'],'交通':['ガソリン','高速料金','駐車場','公共交通'],'宿泊':['ホテル','日帰り温泉'],'登山':['登山バッジ','入山料'],'観光・参拝':['拝観料','御朱印','その他'],'お土産':[],'その他':[]};
 for(const [category,choices] of Object.entries(expected)) {
  h.els.category.value=category;c.updateSubcategories();
  assert.deepEqual(h.els.subcategory.children.map(x=>x.value),['',...choices]);
  assert.equal(h.els.subcategory.value,'');
  assert.equal(h.els.subcategory.disabled,choices.length===0);
  for(const subcategory of choices) {
   h.els.subcategory.value=subcategory;h.els.amount.value='100';h.els.memo.value='分類確認';c.addExpense();
   const records=JSON.parse(h.storage.get('expenses'));
   assert.equal(records.at(-1).subcategory,subcategory);
   assert.equal(records.at(-1).category,category);
   assert(cards(h).some(item => item.textContent.includes(category+' / '+subcategory)));
   assert.deepEqual(JSON.parse(JSON.stringify(c.parseBackup(c.makeBackup(records)))),records);
   assert(c.makeCsv(records).includes('"'+subcategory+'"'));
  }
 }
 assert.equal(h.els.total.textContent,'合計：3,450円');
 assert(h.els['category-totals'].children.some(x=>x.textContent==='食事：1,500円'));
 assert.deepEqual(JSON.parse(h.storage.get('expenses')).slice(0,4),fixtures);
 h.els.category.value='食事';c.updateSubcategories();h.els.subcategory.value='ホテル';h.els.amount.value='100';c.addExpense();
 assert.equal(JSON.parse(h.storage.get('expenses')).at(-1).subcategory,undefined);
 for(const subcategory of [null,42,{},'x'.repeat(101)]) assert.throws(()=>c.parseBackup(c.makeBackup([{...fixtures[0],subcategory}])));
 const selected=[{...fixtures[0],subcategory:'外食'}];
 const reloaded=harness(selected);assert(cards(reloaded)[0].textContent.includes('食事 / 外食'));
 console.log('PASS: all 13 subcategories; reset/disabled states; storage/reload/backup/CSV; legacy records; unchanged category totals; invalid subcategory handling.');
}
(async()=>{
 let h=harness(),c=h.ctx;
 const original=h.storage.get('expenses');
 const backup=c.makeBackup(fixtures);
 assert.equal(JSON.stringify(c.parseBackup(backup)),JSON.stringify(fixtures.map(({category,amount,memo,date,dateTime})=>({category,amount,memo,...(date?{date}:{}),...(dateTime?{dateTime}:{})}))));
 const csv=c.makeCsv(fixtures);
 assert(csv.startsWith('\uFEFF"日付"'));assert(csv.includes('"昼食,""定食""\nお茶"'));assert(csv.includes('"\'=1+1"'));assert(csv.includes('"金額（円）"'));assert(csv.includes('"年不明：09/30"'));assert(csv.includes('"日付不明"'));
 for(const s of ['+1','-1','@SUM(A1)','\t=1',' \n=1']) assert(c.csvCell(s).startsWith('"\''));
 for(const data of [{}, {app:'other',version:1,expenses:[]},{app:'travel-memo',version:2,expenses:[]},...[-1,NaN,'100'].map(amount=>({app:'travel-memo',version:1,expenses:[{category:'食事',amount,memo:''}]})),{app:'travel-memo',version:1,expenses:[{...fixtures[0],date:'2026-02-30'}]}])assert.throws(()=>c.parseBackup(JSON.stringify(data)));
 const preview=text=>c.previewRestore({target:{files:[{size:text.length,text:async()=>text}]}});
 await preview('{bad');assert.equal(h.storage.get('expenses'),original);assert(h.els['restore-preview'].hidden);
 await c.previewRestore({target:{files:[{size:6*1024*1024,text:async()=>backup}]}});assert.equal(h.storage.get('expenses'),original);
 const one=c.makeBackup([fixtures[0]]);await preview(one);assert.equal(h.storage.get('expenses'),original);assert(h.els['restore-summary'].textContent.includes('1件・合計1,200円'));
 h.env.confirm=()=>false;c.applyRestore();assert.equal(h.storage.get('expenses'),original);
 h.env.confirm=()=>true;h.env.failKey='expenses-before-restore';c.applyRestore();assert.equal(h.storage.get('expenses'),original);
 h.env.failKey='expenses';c.applyRestore();assert.equal(h.storage.get('expenses'),original);assert.equal(h.els.total.textContent,'合計：2,150円');
 h.env.failKey=null;c.applyRestore();assert.equal(JSON.parse(h.storage.get('expenses')).length,1);assert.equal(h.els.total.textContent,'合計：1,200円');
 h=harness([],h.storage);c=h.ctx;assert.equal(h.els['undo-restore'].hidden,false);c.undoRestore();assert.equal(JSON.parse(h.storage.get('expenses')).length,4);assert.equal(h.els.total.textContent,'合計：2,150円');
 await c.previewRestore({target:{files:[{size:1,text:async()=>c.makeBackup([])}]}});c.applyRestore();assert.equal(h.els.total.textContent,'合計：0円');c.undoRestore();
 let release;const delayed=c.previewRestore({target:{files:[{size:1,text:()=>new Promise(r=>release=r)}]}});c.cancelRestore();release(one);await delayed;assert(h.els['restore-preview'].hidden);
 await c.exportRecords('backup');assert.equal(h.shared.length,1);assert.equal(JSON.parse(await h.shared[0].files[0].text()).expenses.length,4);
 h.env.navigator.share=async()=>{const e=Error();e.name='AbortError';throw e};await c.exportRecords('csv');assert(h.els['data-status'].textContent.includes('キャンセル'));
 h.env.navigator.canShare=()=>false;await c.exportRecords('csv');assert(h.downloads[0].endsWith('.csv'));
 h.env.failKey='expenses';h.env.document.getElementById('amount').value='250';h.env.document.getElementById('category').value='食事';c.addExpense();assert.equal(h.els.total.textContent,'合計：2,150円');
 h.env.failKey=null;c.addExpense();assert.equal(h.els.total.textContent,'合計：2,400円');cards(h).find(item => item.textContent.includes('250円')).children[0].children[0].onclick();assert.equal(h.els.total.textContent,'合計：2,150円');
 console.log('PASS: CSV quoting/BOM/formula protection; backup round-trip; invalid/oversized input; restore preview/cancel; storage failure; restore/undo across reload; empty restore; stale reads; sharing/cancellation/download; add/delete regression.');

 // Mac backup routing must not change mobile sharing, CSV, or stored records.
 for (const [platform,maxTouchPoints] of [['iPhone',5],['iPad',5],['MacIntel',5],['Win32',0],['Linux armv8l',5]]) {
  const mobile=harness();
  Object.assign(mobile.env.navigator,{platform,maxTouchPoints});
  mobile.env.showSaveFilePicker=()=>assert.fail('Existing sharing flow must remain');
  await mobile.ctx.exportRecords('backup');
  assert.equal(mobile.shared.length,1);
  assert.equal(mobile.downloads.length,0);
  assert.deepEqual(JSON.parse(await mobile.shared[0].files[0].text()).expenses,fixtures);
 }
 for (const picker of [undefined,null]) {
  const mac=harness();
  Object.assign(mac.env.navigator,{platform:'MacIntel',maxTouchPoints:0});
  mac.env.showSaveFilePicker=picker;
  let downloaded,revoked;
  mac.env.URL.createObjectURL=file=>{downloaded=file;return 'blob:backup'};
  mac.env.URL.revokeObjectURL=url=>{revoked=url};
  mac.env.navigator.canShare=()=>assert.fail('Mac backup must bypass sharing');
  await mac.ctx.exportRecords('backup');
  assert.equal(mac.shared.length,0);
  assert.match(mac.downloads[0],/^travel-memo-.*\.json$/);
  assert.equal(downloaded.type,'application/json');
  assert.deepEqual(JSON.parse(await downloaded.text()).expenses,fixtures);
  assert.equal(revoked,'blob:backup');
  assert.equal(mac.storage.get('expenses'),original);
 }
 const mac=harness();
 Object.assign(mac.env.navigator,{platform:'MacIntel',maxTouchPoints:0});
 const calls=[];
 mac.env.showSaveFilePicker=async options=>{
  calls.push('picker');
  assert.match(options.suggestedName,/\.json$/);
  assert.equal(options.types[0].accept['application/json'][0],'.json');
  return {createWritable:async()=>({write:async file=>{
   calls.push('write');assert.deepEqual(JSON.parse(await file.text()).expenses,fixtures);
  },close:async()=>calls.push('close')})};
 };
 const saving=mac.ctx.exportRecords('backup');
 assert.deepEqual(calls,['picker']); // Invoke while the button's user activation is live.
 await saving;
 assert.deepEqual(calls,['picker','write','close']);
 assert(mac.els['data-status'].textContent.includes('保存しました'));
 for(const stage of ['picker','createWritable','write','close']) {
  for(const name of ['AbortError','NotAllowedError']) {
   const fail=()=>{throw Object.assign(Error('test'),{name})};
   mac.env.showSaveFilePicker=async()=>{
    if(stage==='picker')fail();
    return {createWritable:async()=>{
     if(stage==='createWritable')fail();
     return {write:async()=>{if(stage==='write')fail()},close:async()=>{if(stage==='close')fail()}};
    }};
   };
   await mac.ctx.exportRecords('backup');
   assert(mac.els['data-status'].textContent.includes(name==='AbortError'?'キャンセル':'できませんでした'));
   assert.equal(mac.downloads.length,0);
   assert.equal(mac.shared.length,0);
   assert.equal(mac.storage.get('expenses'),original);
  }
 }
 mac.env.showSaveFilePicker=()=>assert.fail('CSV flow must remain unchanged');
 await mac.ctx.exportRecords('csv');
 assert.equal(mac.shared.length,1);
 assert.match(mac.shared[0].files[0].name,/\.csv$/);
 console.log('PASS: Mac picker/write/close; Mac download without picker; cancellation and failures; unchanged iPhone/iPad/other-platform sharing, CSV, backup contents and stored records.');
})().catch(e=>{console.error(e);process.exitCode=1});
