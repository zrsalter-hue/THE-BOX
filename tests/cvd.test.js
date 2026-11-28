// CVD bucketing / alignment with the Setup15 increment calc. Run: npm test
const test=require('node:test'),assert=require('node:assert/strict');
const S=require('../setup15.js'),C={...S.DEF};
const near=(a,b,e=1e-6)=>assert.ok(Math.abs(a-b)<=e,`${a} ≉ ${b}`);
// deterministic pseudo-random per-second rows with gaps (seconds with no trades are simply missing)
function rows(t0,t1,seed=7){let x=seed;const rnd=()=>(x=(x*1103515245+12345)%2147483648)/2147483648;const a=[];let px=60000;
  for(let t=t0;t<=t1;t++){if(rnd()<0.15)continue;px+=(rnd()-0.5)*8;const sn=(rnd()-0.5)*40000,pn=(rnd()-0.5)*90000,ix=sn*0.6;a.push({t,px,sn,pn,ix})}return a}

test('cvdBuckets: newest bucket is exactly the increment row for 30s/1m/3m/5m',()=>{
  const now=50000,R=rows(now-8000,now),inc=S.increments(R,now,C);
  for(const x of inc){const b=S.cvdBuckets(R,now,x.len,C.baseN+1),last=b[b.length-1];
    assert.equal(last.b,now);assert.equal(last.a,now-x.len);
    near(last.net,x.net);near(last.sn,x.sn);near(last.pn,x.pn);near(last.ix,x.ix);assert.equal(last.dp,x.dp)}});

test('cvdBuckets: older buckets are the baseline intervals (median |Δprice| = typical)',()=>{
  const now=50000,R=rows(now-8000,now,11);
  for(const len of [30,60,180,300]){const b=S.cvdBuckets(R,now,len,C.baseN+1),prior=b.slice(0,-1).map(x=>Math.abs(x.dp));
    const B=S.baseline(R,now,len,C.baseN,C);assert.equal(B.n,prior.length);near(S.median(prior),B.typ)}});

test('cvdBuckets: contiguous, non-overlapping, right-closed, oldest first, sums to the whole span',()=>{
  const now=50017,R=rows(now-4000,now,3),len=60,n=15,b=S.cvdBuckets(R,now,len,n);
  assert.equal(b.length,n);assert.equal(b[0].a,now-n*len);
  for(let i=1;i<n;i++){assert.equal(b[i].a,b[i-1].b);assert.equal(b[i].b-b[i].a,len)}
  const tot=S.span(R,now-n*len,now);near(b.reduce((s,x)=>s+x.net,0),tot.net);near(b.reduce((s,x)=>s+x.dp,0),tot.dp);
  // a trade stamped exactly on a boundary second belongs to the bucket that ends on it
  const one=[{t:1000,px:1,sn:0,pn:0},{t:1060,px:2,sn:5,pn:7}],bb=S.cvdBuckets(one,1120,60,2);
  assert.equal(bb[0].net,12);assert.equal(bb[1].net,0);assert.equal(bb[0].dp,1)});

test('cvdBuckets: buckets that start before live trade data are flagged partial',()=>{
  const now=10000,R=rows(now-1200,now,5),b=S.cvdBuckets(R,now,60,20,now-300);
  assert.deepEqual(b.map(x=>x.partial),b.map(x=>x.a<now-300));
  assert.equal(b.filter(x=>!x.partial).length,5);
  const none=S.cvdBuckets([],now,30,3);assert.ok(none.every(x=>x.partial&&x.dp===null&&x.net===0))});

test('cvdLine: rebased at `from`, any difference equals span() net, prices carried forward',()=>{
  const now=20000,R=rows(now-2000,now,9),from=now-900,L=S.cvdLine(R,from,now);
  assert.equal(L.length,901);assert.equal(L[0].t,from);assert.equal(L[0].net,0);
  for(const [i,j] of [[0,900],[13,77],[300,600],[450,451],[899,900]]){const w=S.span(R,L[i].t,L[j].t);
    near(L[j].net-L[i].net,w.net);near(L[j].sn-L[i].sn,w.sn);near(L[j].pn-L[i].pn,w.pn);near(L[j].ix-L[i].ix,w.ix);
    assert.equal(L[j].px,S.pxAt(R,L[j].t))}});

test('cvdLine and cvdBuckets agree bar-for-bar',()=>{
  const now=30000,R=rows(now-1800,now,13),len=30,n=30,L=S.cvdLine(R,now-n*len,now),b=S.cvdBuckets(R,now,len,n);
  b.forEach((x,i)=>near(L[(i+1)*len].net-L[i*len].net,x.net))});

test('windowMarks: open, settlement-window start 60s before close, close',()=>{
  const o=Date.UTC(2026,10,27,21,45),m=S.windowMarks(o,o+900000);
  assert.equal(m.open,o/1000);assert.equal(m.close,o/1000+900);assert.equal(m.settle,m.close-60)});

test('chartDomain: axis ends at now, never at the future close, and keeps a readable span',()=>{
  const open=10000,close=10900,now=10040,d=S.chartDomain(open,close,now);
  assert.equal(d.x1,now);
  assert.ok(d.x1<close,'must not plot the empty future to close');
  assert.ok(now-d.x0>=240,'minimum span so a fresh page is not a sliver');
  assert.ok(d.x0<open,'includes pre-open context');
});

test('chartDomain: later in the window the axis starts a short way before open',()=>{
  const open=10000,close=10900,now=10800,d=S.chartDomain(open,close,now);
  assert.equal(d.x1,now);
  assert.ok(d.x0<=open&&d.x0>=open-300);
  assert.ok(now-d.x0>800);
});

test('chartDomain: at least one minute of axis even if called at the open',()=>{
  const d=S.chartDomain(5000,5900,5000);assert.equal(d.x1,5000);assert.ok(d.x1-d.x0>=60)});

test('toMs: ms, unix seconds, numeric strings, ISO; 0 for missing/bad',()=>{
  assert.equal(S.toMs(1_700_000_000_000),1_700_000_000_000);
  assert.equal(S.toMs(1_700_000_000),1_700_000_000_000);
  assert.equal(S.toMs('1700000000.25'),1_700_000_000_250);
  assert.equal(S.toMs('2026-11-27T21:00:00.000Z'),Date.parse('2026-11-27T21:00:00.000Z'));
  assert.equal(S.toMs(null),0);assert.equal(S.toMs(''),0);assert.equal(S.toMs('nope'),0);
});

test('tradeSecond: buckets by trade time, not wall clock; rejects future and too-old',()=>{
  const now=1_700_000_050_000,ts=now-2500;
  assert.equal(S.tradeSecond(ts,now),Math.floor(ts/1000));
  assert.equal(S.tradeSecond(ts/1000,now),Math.floor(ts/1000),'unix seconds accepted');
  assert.equal(S.tradeSecond(0,now),Math.floor(now/1000),'missing ts → now');
  assert.equal(S.tradeSecond(now+5000,now),null);
  assert.equal(S.tradeSecond(now-10_000_000,now,3600),null);
  // a 30s-old poll trade still lands in its own second, not "now"
  assert.equal(S.tradeSecond(now-30_000,now),Math.floor((now-30_000)/1000));
  assert.notEqual(S.tradeSecond(now-30_000,now),Math.floor(now/1000));
});

test('robustRange: a single spike is clipped so the rest of the series stays readable',()=>{
  const v=[0,10,12,8,9,11,-5,7,10,9];
  const calm=S.robustRange(v,{include0:1});
  assert.equal(calm.clipped,false);assert.ok(calm.mx>12&&calm.mn< -5);
  const spiked=S.robustRange(v.concat([-3_500_000]),{include0:1,spike:4});
  assert.equal(spiked.clipped,true);
  assert.ok(spiked.mx<1000,'spike must not set the axis');
  assert.ok(spiked.mn>-1000);
  assert.equal(spiked.rawLo,-3_500_000);
});
