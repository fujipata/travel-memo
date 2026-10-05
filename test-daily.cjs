// Run: node test-daily.cjs (no external dependencies)
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync(require('node:path').join(__dirname,'index.html'),'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
let clock = new Date(2026,9,1,12,34);
class Clock extends Date { constructor(...args) {super(...(args.length?args:[clock.getTime()]));} }
function harness(records=[]) {
 const storage=new Map([['expenses',JSON.stringify(records)]]), els={}, alerts=[];
 function el(){return {value:'',children:[],listeners:{},appendChild(x){this.children.push(x)},addEventListener(n,f){this.listeners[n]=f},set innerHTML(v){this.children=[]}};}
 const ctx=vm.createContext({Date:Clock,document:{getElementById:id=>els[id]??=el(),createElement:el},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},alert:m=>alerts.push(m)});
 vm.runInContext(source,ctx);
 return {ctx,els,alerts,read:()=>JSON.parse(storage.get('expenses')),groups:()=>els.list.children.map(g=>g.children[0])};
}
const h=harness();
const add=(amount,memo)=>{h.els.amount??=h.ctx.document.getElementById('amount');h.els.memo??=h.ctx.document.getElementById('memo');h.els.amount.value=amount;h.els.memo.value=memo;h.els.category.value='交通';h.els.subcategory.value='駐車場';h.ctx.addExpense();};
const choose=(date,time)=>{h.els['expense-date'].value=date;h.els['expense-time'].value=time;h.els['expense-date'].listeners.input();};
assert.equal(h.els['expense-date'].value,'2026-10-01');assert.equal(h.els['expense-time'].value,'12:34');
clock=new Date(2026,9,1,13,15);add(1200,'当日');
assert.equal(h.read()[0].dateTime,'10/1 13:15');assert.equal(h.groups()[0].open,true);
choose('2025-09-29','08:35');add(500,'過去');choose('2025-09-29','09:40');add(700,'追加');
assert.equal(h.read()[1].date,'2025-09-29');assert.equal(h.read()[1].dateTime,'9/29 08:35');
assert.equal(h.els['expense-date'].value,'2026-10-01');assert.equal(h.groups().length,2);
let past=h.groups()[1];assert.equal(past.open,false);assert.equal(past.children[0].children[1].textContent,'合計 1,200円');
assert.match(past.children[0].children[0].textContent,/月/);
past.open=true;past.listeners.toggle();past.children[1].children[0].children[0].children[0].onclick();
past=h.groups()[1];assert.equal(past.open,true);assert.equal(past.children[0].children[1].textContent,'合計 700円');assert.equal(h.els.total.textContent,'合計：1,900円');
assert.match(past.children[1].children[0].textContent,/9\/29 09:40.*交通 \/ 駐車場.*700円.*追加/);
const reloaded=harness(h.read());assert.equal(reloaded.groups()[0].open,true);assert.equal(reloaded.groups()[1].open,false);
const before=JSON.stringify(h.read());choose('','09:00');add(100,'invalid');assert.equal(JSON.stringify(h.read()),before);assert.equal(h.alerts.length,1);
choose('2025-02-30','09:00');add(100,'invalid');assert.equal(JSON.stringify(h.read()),before);
past.children[1].children[0].children[0].children[0].onclick();assert.equal(h.groups().length,1);
const old=[{category:'その他',amount:50,memo:'legacy',dateTime:'9/29 10:00'},{category:'その他',amount:20,memo:'unknown'}];
const legacy=harness(old);assert.deepEqual(legacy.read(),old);assert(legacy.groups().every(g=>!g.open));
console.log('PASS: fresh current time; backdated date/time and grouping; weekday/totals; full cards; open-state retention; deletion; reload defaults; invalid dates; last-item deletion; legacy records unchanged.');
