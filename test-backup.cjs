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
  if (records && !storage.has('expenses')) storage.set('expenses',JSON.stringify(records));
  const els = {}, downloads=[], shared=[], alerts=[];
  function el(){return {value:'',maxLength:60,hidden:false,children:[],setAttribute(k,v){this[k]=v},
  get firstChild(){return {textContent:this.textContent}},
  append(...nodes){this.children.push(...nodes)},
  querySelector(selector){return this.children.find(child=>'.'+child.className===selector)},
  cloneNode(){return {...this, firstChild:this.firstChild, querySelector:()=>({remove(){}})}},
  replaceChildren(...nodes){this.children=nodes},appendChild(x){this.children.push(x)},listeners:{},addEventListener(name,listener){this.listeners[name]=listener},set innerHTML(v){this.children=[]},click(){downloads.push(this.download)},remove(){},
  showModal(){this.open=true},close(){this.open=false},focus(){}}}
  const document={getElementById(id){return els[id]??=el()},createElement:el,body:el()};
  const env={document,File:globalThis.File,Date,console,confirm:()=>true,alert:m=>alerts.push(m),
    navigator:{canShare:()=>true,share:async x=>shared.push(x)},URL:{createObjectURL:()=> 'blob:test',revokeObjectURL(){}},setTimeout:f=>f(),clearTimeout(){},
    localStorage:{getItem:k=>storage.get(k)??null,setItem(k,v){if(env.failKey===k)throw Error('quota');storage.set(k,v)},
    removeItem(k){if(env.failRemoveKey===k)throw Error('storage');storage.delete(k)}}};
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
 const expected={'食事':['外食','コンビニ'],'交通':['ガソリン','高速料金','駐車場','公共交通'],'宿泊':['ホテル','日帰り温泉'],'登山':['登山バッジ','入山料'],'観光・参拝':['拝観料','御朱印','お土産'],'その他':[]};
 const groups=h.els['expense-classification'].children;
 for(const [category,choices] of Object.entries(expected)) {
  for(const subcategory of choices) {
   const button=groups.flatMap(group=>group.children).find(button=>button['aria-label']===category+' / '+subcategory);
   assert.equal(button['aria-pressed'],'false');
   button.onclick();
   assert.equal(button['aria-pressed'],'true');
   h.els.amount.value='100';h.els.memo.value='分類確認';c.addExpense();
   assert.equal(button['aria-pressed'],'false');
   const records=JSON.parse(h.storage.get('expenses'));
   assert.equal(records.at(-1).subcategory,subcategory);
   assert.equal(records.at(-1).category,category);
   assert(cards(h).some(item => item.textContent.includes(category+' / '+subcategory)));
   assert.deepEqual(JSON.parse(JSON.stringify(c.parseBackup(c.makeBackup(records)).records)),records);
   assert(c.makeCsv(records).includes('"'+subcategory+'"'));
  }
 }
 assert.equal(h.els.total.textContent,'合計：3,450円');
 assert(h.els['category-totals'].children.some(x=>x.children[0].children[0].children.map(span=>span.textContent).join('')==='食事1,500円'));
 assert.deepEqual(JSON.parse(h.storage.get('expenses')).slice(0,4),fixtures);
 const before=h.storage.get('expenses');
 h.els.amount.value='100';c.addExpense();
 assert.equal(h.storage.get('expenses'),before);
 for(const category of ['その他']) {
  groups.at(-1).children.find(button=>button.textContent===category).onclick();
  h.els.amount.value='100';c.addExpense();
  const record=JSON.parse(h.storage.get('expenses')).at(-1);
  assert.equal(record.category,category);
  assert.equal(record.subcategory,undefined);
 }
 for(const subcategory of [null,42,{},'x'.repeat(101)]) assert.throws(()=>c.parseBackup(c.makeBackup([{...fixtures[0],subcategory}])));
 const selected=[{...fixtures[0],subcategory:'外食'}];
 const reloaded=harness(selected);assert(cards(reloaded)[0].textContent.includes('食事 / 外食'));
 console.log('PASS: all 13 subcategories; selection states; storage/reload/backup/CSV; legacy records; unchanged category totals; invalid subcategory handling.');
}
(async()=>{
 let h=harness(),c=h.ctx;
 const original=h.storage.get('expenses');
 const backup=c.makeBackup(fixtures);
 assert.equal(JSON.stringify(c.parseBackup(backup).records),JSON.stringify(fixtures.map(({category,amount,memo,date,dateTime})=>({category,amount,memo,...(date?{date}:{}),...(dateTime?{dateTime}:{})}))));
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
 h.env.failKey='expenses';h.env.document.getElementById('amount').value='250';h.els['expense-classification'].children[1].children[0].onclick();c.addExpense();assert.equal(h.els.total.textContent,'合計：2,150円');
 h.env.failKey=null;c.addExpense();assert.equal(h.els.total.textContent,'合計：2,400円');cards(h).find(item => item.textContent.includes('250円')).children[0].children[0].onclick();assert.equal(h.els.total.textContent,'合計：2,150円');
 console.log('PASS: CSV quoting/BOM/formula protection; backup round-trip; invalid/oversized input; restore preview/cancel; storage failure; restore/undo across reload; empty restore; stale reads; sharing/cancellation/download; add/delete regression.');

 const named = harness();
 const tripName = named.els['trip-name'];
 tripName.value = '北海道/旅行';
 tripName.listeners.input();
 const reopened = harness(fixtures, named.storage);
 assert.equal(reopened.els['trip-name'].value, '北海道/旅行');
 await reopened.ctx.exportRecords('csv');
 await reopened.ctx.exportRecords('backup');
 assert.match(reopened.shared[0].files[0].name, /^北海道-旅行-.*\.csv$/);
 assert.match(reopened.shared[1].files[0].name, /^北海道-旅行-.*\.json$/);
 assert.deepEqual(JSON.parse(await reopened.shared[1].files[0].text()).expenses, fixtures);

 reopened.els['clear-trip-name'].listeners.click();
 assert.equal(reopened.els['trip-name'].value, '');
 assert.equal(reopened.storage.get('expenses'), JSON.stringify(fixtures));
 const cleared = harness(fixtures, reopened.storage);
 assert.equal(cleared.els['trip-name'].value, '');
 await cleared.ctx.exportRecords('csv');
 assert.match(cleared.shared[0].files[0].name, /^travel-memo-.*\.csv$/);

 // Restore the original name from the JSON, regardless of the selected filename.
 const target = harness();
 target.els['trip-name'].value = '復元前の旅行';
 target.els['trip-name'].listeners.input();
 const namedBackup = await reopened.shared[1].files[0].text();
 const restore = async (app, contents) => app.ctx.previewRestore({
   target:{files:[{name:'renamed.json',size:contents.length,text:async()=>contents}]}
 });
 assert.equal(JSON.parse(namedBackup).tripName, '北海道/旅行');
 await restore(target, namedBackup);
 assert.match(target.els['restore-summary'].textContent, /北海道\/旅行/);
 target.env.failKey = 'expenses';
 target.ctx.applyRestore();
 assert.equal(target.storage.get('travel-memo-trip-name'), '復元前の旅行');
 target.env.failKey = null;
 target.ctx.applyRestore();
 const restored = harness(null, target.storage);
 assert.equal(restored.els['trip-name'].value, '北海道/旅行');
 await restored.ctx.exportRecords('csv');
 assert.match(restored.shared[0].files[0].name, /^北海道-旅行-.*\.csv$/);
 restored.ctx.undoRestore();
 assert.equal(restored.els['trip-name'].value, '復元前の旅行');
 const legacy = {app:'travel-memo',version:1,expenses:[]};
 await restore(restored, JSON.stringify(legacy));
 restored.ctx.applyRestore();
 assert.equal(restored.els['trip-name'].value, '復元前の旅行');
 assert.equal(restored.els.total.textContent, '合計：0円');
 await restore(restored, JSON.stringify({...legacy,tripName:''}));
 restored.ctx.applyRestore();
 assert.equal(restored.els['trip-name'].value, '');
 assert.throws(() => restored.ctx.parseBackup(JSON.stringify({...legacy,tripName:42})));

 // Bulk deletion must erase both records, the trip name, and any pending restore.
 const bulk = harness();
 bulk.els['trip-name'].value = '北海道旅行';
 bulk.els['trip-name'].listeners.input();
 const bulkBackup = bulk.ctx.makeBackup([fixtures[0]]);
 await bulk.ctx.previewRestore({target:{files:[{size:1,text:async()=>bulkBackup}]}});
 bulk.ctx.applyRestore();
 await bulk.ctx.previewRestore({target:{files:[{size:1,text:async()=>bulkBackup}]}});
 bulk.storage.set('unrelated-app', 'keep');

 bulk.ctx.startDeleteAll();
 bulk.ctx.confirmDeleteAll();
 assert(bulk.storage.has('expenses-before-restore'));
 assert.equal(bulk.els['trip-name'].value, '北海道旅行');
 bulk.env.failRemoveKey = 'expenses';
 bulk.ctx.confirmDeleteAll();
 assert(bulk.storage.has('expenses'));
 assert.match(bulk.els['data-status'].textContent, /完了できませんでした/);

 bulk.env.failRemoveKey = null;
 bulk.ctx.startDeleteAll();
 bulk.ctx.confirmDeleteAll();
 bulk.ctx.confirmDeleteAll();
 bulk.ctx.applyRestore();
 assert.deepEqual([...bulk.storage], [['unrelated-app', 'keep']]);
 assert.equal(bulk.els['restore-preview'].hidden, true);
 assert.equal(bulk.els['undo-restore'].hidden, true);
 assert.equal(bulk.els['trip-name'].value, '');
 assert.equal(bulk.els.total.textContent, '合計：0円');
 const afterDelete = harness(null, bulk.storage);
 assert.equal(afterDelete.els.total.textContent, '合計：0円');
 assert.equal(afterDelete.els['undo-restore'].hidden, true);
 assert.equal(afterDelete.els['trip-name'].value, '');
 await afterDelete.ctx.exportRecords('backup');
 assert.match(afterDelete.shared[0].files[0].name, /^travel-memo-.*\.json$/);

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
