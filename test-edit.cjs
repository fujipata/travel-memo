const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync(require('node:path').join(__dirname, 'index.html'), 'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
const records = [
  {category:'食事',subcategory:'外食',amount:1200,memo:'昼食',date:'2026-10-01',dateTime:'10/1 12:00'},
  {category:'その他',amount:50,memo:'旧記録',dateTime:'9/30 09:00'}
];
const els = {}, storage = new Map([['expenses', JSON.stringify(records)]]), alerts = [];
let fail = false;
function el() { return {value:'',children:[],appendChild(x){this.children.push(x)},addEventListener(){},
  set innerHTML(v){this.children=[]},showModal(){this.open=true},close(){this.open=false}}; }
const document = {getElementById:id=>els[id]??=el(),createElement:el};
const ctx = vm.createContext({document,Date,alert:x=>alerts.push(x),localStorage:{
  getItem:k=>storage.get(k)||null,setItem(k,v){if(fail)throw Error('quota');storage.set(k,v)}
}});
vm.runInContext(source,ctx);
const read = ()=>JSON.parse(storage.get('expenses'));
const cards = ()=>els.list.children.flatMap(g=>g.children[0].children[1].children);
const card = index => cards().find(c => c.textContent.startsWith(read()[index].dateTime + "　"));
const open = index => card(index).children[1].onclick();
const set = (field,value)=>els['edit-'+field].value=value;
open(0);
assert.equal(els['edit-amount'].value,1200);
assert.equal(els['edit-subcategory'].value,'外食');
set('amount','2500');set('memo','修正');set('category','交通');ctx.updateEditSubcategories();set('subcategory','駐車場');
set('date','2026-10-02');set('time','08:30');ctx.updateExpense();
assert.equal(read().length,2);
assert.deepEqual(read()[0],{category:'交通',subcategory:'駐車場',amount:2500,memo:'修正',date:'2026-10-02',dateTime:'10/2 08:30'});
assert.equal(els.total.textContent,'合計：2,550円');
assert(els['category-totals'].children.some(e=>e.textContent==='交通：2,500円'));
assert.equal(els['edit-dialog'].open,false);
const saved = storage.get('expenses');
open(0);set('amount','9999');els['edit-dialog'].close();assert.equal(storage.get('expenses'),saved);
open(0);set('amount','-1');ctx.updateExpense();assert.equal(storage.get('expenses'),saved);assert(els['edit-dialog'].open);
set('amount','3000');set('date','2026-02-30');ctx.updateExpense();assert.equal(storage.get('expenses'),saved);
set('date','2026-10-02');fail=true;ctx.updateExpense();assert.equal(storage.get('expenses'),saved);assert(els['edit-dialog'].open);
fail=false;ctx.updateExpense();assert.equal(read()[0].amount,3000);
open(1);set('memo','旧記録の修正');ctx.updateExpense();
assert.equal(read()[1].date,undefined);assert.equal(read()[1].dateTime,'9/30 09:00');
assert.equal(read()[1].memo,'旧記録の修正');
open(0);card(1).children[0].onclick();set('amount','3500');ctx.updateExpense();assert.equal(read()[0].amount,3500);
open(0);card(0).children[0].onclick();ctx.updateExpense();assert.deepEqual(read(),[]);assert.match(alerts.at(-1),/削除または置き換え/);
console.log('PASS: edit prefill; update without duplication; all fields/totals; cancel; invalid amount/date; save failure/retry; legacy dates; deletion during edit.');
