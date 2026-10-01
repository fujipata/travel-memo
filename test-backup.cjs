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
 h.env.failKey=null;c.addExpense();assert.equal(h.els.total.textContent,'合計：2,400円');h.els.list.children.at(-1).children[0].onclick();assert.equal(h.els.total.textContent,'合計：2,150円');
 console.log('PASS: CSV quoting/BOM/formula protection; backup round-trip; invalid/oversized input; restore preview/cancel; storage failure; restore/undo across reload; empty restore; stale reads; sharing/cancellation/download; add/delete regression.');
})().catch(e=>{console.error(e);process.exitCode=1});
