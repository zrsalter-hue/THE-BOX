// Run: node --test tests/   (Node 18+; no dependencies)
const test=require('node:test'),assert=require('node:assert/strict');
const S=require('../setup15.js'),C={...S.DEF};

// per-second rows from a price function; spot/perp net per second from functions
const series=(t0,t1,px,sn=()=>0,pn=()=>0)=>{const a=[];for(let t=t0;t<=t1;t++)a.push({t,px:px(t),sn:sn(t),pn:pn(t)});return a};
const near=(a,b,e=1e-6)=>assert.ok(Math.abs(a-b)<=e,`${a} ≉ ${b}`);

test('increments: signed change, net deltas and baseline that excludes the current interval',()=>{
  // zig-zag ±$10 per 30s for an hour, then a −$50 drop in the final 30s with heavy selling
  const now=10000,t0=now-3600;
  const px=t=>t<=now-30?60000+((Math.floor((t-t0)/30)%2)?10:0):60000+(Math.floor((now-30-t0)/30)%2?10:0)-50*(t-(now-30))/30;
  const S1=series(t0,now,px,t=>t>now-30?-4000:100,t=>t>now-30?-6000:50);
  const inc=S.increments(S1,now,C),i30=inc[0];
  assert.equal(i30.len,30);
  near(i30.dp,-50);
  near(i30.sn,-4000*30);near(i30.pn,-6000*30);near(i30.net,-300000);
  // prior completed 30s intervals all moved exactly $10 → median 10; the −$50 current interval is excluded
  assert.equal(i30.typ,10);assert.equal(i30.bn,C.baseN);near(i30.rel,-5);
  // 1m windows: prior blocks cover two zig-zag halves → net zero move
  const b60=S.baseline(S1,now,60,20,C);assert.equal(b60.typ,0);
  assert.equal(inc[1].rel,null,'zero baseline → no relative value');
});

test('baseline: median of prior intervals, needs history, ignores the live interval',()=>{
  const now=1000;const moves=[5,7,100,6,8];// k=1..5 going back
  const pts=[];let p=60000;const ends=[now];for(let k=1;k<=6;k++)ends.push(now-k*30);
  // build price so interval ending at now-k*30 has |move| moves[k-1]; the live interval moves $500
  const at={};at[now-6*30]=p;for(let k=5;k>=1;k--){p+=moves[k-1];at[now-k*30]=p}at[now]=p+500;
  const S1=Object.keys(at).map(Number).sort((a,b)=>a-b).map(t=>({t,px:at[t],sn:0,pn:0}));
  const b=S.baseline(S1,now,30,20,C);assert.equal(b.n,5);assert.equal(b.typ,7);
  const short=S.baseline(S1.slice(-2),now,30,20,C);assert.equal(short.n,0);assert.equal(short.typ,null);
});

test('classifier: ACCELERATING on comparable flow, STALLING on stronger flow with less move',()=>{
  const sl=(dp,net)=>({dp,net});
  assert.equal(S.classify(sl(-25,-400000),sl(-50,-420000),-1,C).label,'ACCELERATING');
  assert.equal(S.classify(sl(-25,-400000),sl(-50,-300000),-1,C).label,'ACCELERATING','less flow, farther move');
  assert.equal(S.classify(sl(-40,-300000),sl(-10,-600000),-1,C).label,'STALLING');
  assert.equal(S.classify(sl(30,400000),sl(60,410000),1,C).label,'ACCELERATING','bullish mirror');
  assert.equal(S.classify(sl(40,300000),sl(12,500000),1,C).label,'STALLING','bullish mirror');
  // much stronger flow and a farther move is neither (flow not comparable, move not smaller)
  assert.equal(S.classify(sl(-25,-200000),sl(-50,-900000),-1,C).label,'STEADY');
});

test('classifier: only compares price impact when both slices have meaningful same-side delta',()=>{
  const sl=(dp,net)=>({dp,net});
  assert.equal(S.classify(sl(-25,-50000),sl(-50,-400000),-1,C).label,'NO READ');
  assert.equal(S.classify(sl(-25,-400000),sl(-50,300000),-1,C).label,'NO READ');
  assert.equal(S.classify(sl(25,400000),sl(50,420000),-1,C).label,'NO READ','flow against setup');
  assert.equal(S.classify(sl(null,-400000),sl(-50,-420000),-1,C).label,'NO READ');
  // thresholds are configurable
  assert.equal(S.classify(sl(-25,-50000),sl(-50,-52000),-1,{...C,minDelta:40000}).label,'ACCELERATING');
});

test('required remaining average: formula and the $60,000 / $60,030 example',()=>{
  near(S.requiredAvg(60000,60030,30),59970);
  near(S.requiredAvg(60000,60000,45),60000);
  near(S.requiredAvg(60000,60010,50),(60000*60-60010*50)/10);
  assert.equal(S.requiredAvg(60000,60030,0),60000);
  assert.equal(S.requiredAvg(60000,60030,60),null,'no time left');
  assert.equal(S.requiredAvg(60000,null,20),null,'no coverage');
});

test('settlement equality rule: at least the strike (greater_or_equal) → YES, after rounding to 2 dp',()=>{
  assert.equal(S.settleSide(60000,60000),'YES');
  assert.equal(S.settleSide(59999.996,60000),'YES','rounds to 60000.00');
  assert.equal(S.settleSide(59999.994,60000),'NO');
  assert.equal(S.settleSide(60000.01,60000),'YES');
});

test('time-weighted observed average and coverage check',()=>{
  // 30s at 60030 inside a window starting at 100
  const smp=[];for(let t=100;t<130;t++)smp.push({t,px:60030});
  near(S.twAvg(smp,100,130,3),60030);
  // step series weights by time: 10s at 100, 20s at 130 → 120
  near(S.twAvg([{t:0,px:100},{t:10,px:130}],0,30,30),120);
  assert.equal(S.twAvg([{t:0,px:1},{t:10,px:2}],0,30,3),null,'hole > maxGap');
  assert.equal(S.twAvg([{t:20,px:1}],0,30,3),null,'starts late');
  // end-to-end: example window
  const obs=S.twAvg(smp,100,130,3);near(S.requiredAvg(60000,obs,30),59970);
});

// ---------- state machine helpers ----------
const mk=(t,o,h,l,c)=>({t,o,h,l,c});
// swing low at 100 (minute 2), confirmed by two higher bars on each side; price above it afterwards
const bearCandles=()=>[mk(0,110,112,105,108),mk(60,108,109,104,106),mk(120,106,107,100,103),mk(180,103,108,102,107),mk(240,107,110,104,109),mk(300,109,110,105,106)];
const bullCandles=()=>bearCandles().map(c=>({t:c.t,o:200-c.o,h:200-c.l,l:200-c.h,c:200-c.c}));
const base=(over)=>({now:360,px:105,candles:bearCandles(),arrow:null,s30:{dp:0,net:0},typ30:5,typ1m:8,sigma1m:10,flow:{spot:-500000,perp:-500000,spotAgree:3},absorbed:false,close:2000,ticker:'T',ok:true,...over});
const run=(st,x,cfg=C)=>S.step(st,x,cfg);

test('swing: latest confirmed swing low/high from completed candles only',()=>{
  const sw=S.swing(bearCandles(),-1,360,C);assert.equal(sw.level,100);assert.equal(sw.known,300);
  assert.equal(S.swing(bearCandles(),-1,290,C),null,'not yet confirmed (right bars incomplete)');
  assert.equal(S.swing(bullCandles(),1,360,C).level,100);
});

test('bearish path: red arrow → WATCH → BREAK (retest pending) → retest → reclaim fails → fresh low → CONFIRMED',()=>{
  let st=S.fresh(-1),r;const kinds=[];const rec=r=>{st=r.st;kinds.push(...r.events.map(e=>e.kind))};
  rec(run(st,base({arrow:{side:-1,t:355}})));
  assert.equal(st.state,'WATCH');assert.equal(st.level,100,'frozen swing low');
  rec(run(st,base({now:361,arrow:{side:-1,t:355}})));assert.equal(kinds.length,1,'same arrow does not re-fire');
  // minute 360 closes at 98 < 100 → BREAK
  const C2=[...bearCandles(),mk(360,105,106,97,98)];
  rec(run(st,base({now:421,px:97,candles:C2})));assert.equal(st.state,'BREAK');assert.equal(S.label(st),'BREAK DOWN · retest pending');
  rec(run(st,base({now:425,px:88,candles:C2})));assert.ok(kinds.includes('RETEST_PENDING'),'falls away without retest → logged path');
  assert.equal(st.legX,88);assert.ok(st.away);
  rec(run(st,base({now:440,px:96.5,candles:C2})));assert.ok(st.retested,'within tolerance of 100');
  assert.equal(S.label(st),'BREAK DOWN · retesting');
  const C3=[...C2,mk(420,97,99.5,88,97)];// closes back below the level
  rec(run(st,base({now:481,px:95,candles:C3})));assert.ok(st.rejected);assert.equal(st.state,'BREAK');
  rec(run(st,base({now:490,px:87.5,candles:C3})));assert.equal(st.state,'CONFIRMED');assert.equal(st.grade,'strong');
  assert.deepEqual(kinds,['WATCH','BREAK','RETEST_PENDING','CONFIRMED']);
});

test('bearish: perp-only wave gets weaker confirmation (held unless configured)',()=>{
  let st=S.fresh(-1);
  const C2=[...bearCandles(),mk(360,105,106,97,98)],C3=[...C2,mk(420,97,99.5,90,97)];
  const pOnly={spot:20000,perp:-900000,spotAgree:0};
  st=run(st,base({arrow:{side:-1,t:355}})).st;st=run(st,base({now:421,px:97,candles:C2})).st;st=run(st,base({now:430,px:90,candles:C2})).st;
  st=run(st,base({now:440,px:99,candles:C2})).st;st=run(st,base({now:481,px:95,candles:C3})).st;
  const r=run(st,base({now:490,px:89,candles:C3,flow:pOnly}));assert.equal(r.st.state,'BREAK');assert.equal(r.st.grade,'weak · perp only');assert.match(r.st.wait,/perp-only/);
  const r2=run(st,base({now:490,px:89,candles:C3,flow:pOnly}),{...C,perpOnlyConfirms:1});assert.equal(r2.st.state,'CONFIRMED');assert.equal(r2.st.grade,'weak · perp only');
  const r3=run(st,base({now:490,px:89,candles:C3,flow:{spot:-400000,perp:0,spotAgree:2}}));assert.equal(r3.st.grade,'spot only');assert.equal(r3.st.state,'CONFIRMED');
});

test('an arrow alone can start a watch but never confirm',()=>{
  let st=S.fresh(-1);
  for(let t=355;t<700;t+=5){st=run(st,base({now:t+5,arrow:{side:-1,t},px:104})).st}
  assert.equal(st.state,'WATCH');
});

test('flow trigger: 30s net selling + meaningful decline starts a watch; small move does not',()=>{
  assert.equal(run(S.fresh(-1),base({s30:{dp:-8,net:-400000}})).st.state,'WATCH');
  assert.equal(run(S.fresh(-1),base({s30:{dp:-2,net:-400000}})).st.state,'IDLE');
  assert.equal(run(S.fresh(-1),base({s30:{dp:-8,net:-10000}})).st.state,'IDLE');
});

test('invalidation: completed 1m close back above the frozen level',()=>{
  let st=S.fresh(-1);const C2=[...bearCandles(),mk(360,105,106,97,98)];
  st=run(st,base({arrow:{side:-1,t:355}})).st;st=run(st,base({now:421,px:97,candles:C2})).st;
  const r=run(st,base({now:481,px:102,candles:[...C2,mk(420,98,103,97,101)]}));
  assert.equal(r.st.state,'INVALIDATED');assert.equal(r.events[0].kind,'INVALIDATED');
  // after the hold time the side resets to IDLE
  assert.equal(run(r.st,base({now:481+C.holdSec,candles:[...C2,mk(420,98,103,97,101)]})).st.state,'IDLE');
});

test('SELLING ABSORBED blocks new bearish watches and confirmation, and flags alerts suppressed',()=>{
  assert.equal(run(S.fresh(-1),base({arrow:{side:-1,t:355},absorbed:true})).st.state,'IDLE');
  let st=S.fresh(-1);const C2=[...bearCandles(),mk(360,105,106,97,98)],C3=[...C2,mk(420,97,99.5,90,97)];
  st=run(st,base({arrow:{side:-1,t:355}})).st;st=run(st,base({now:421,px:97,candles:C2})).st;st=run(st,base({now:430,px:90,candles:C2})).st;st=run(st,base({now:440,px:99,candles:C2})).st;st=run(st,base({now:481,px:95,candles:C3})).st;
  assert.ok(st.rejected);const r=run(st,base({now:490,px:89,candles:C3,absorbed:true}));assert.equal(r.st.state,'BREAK');assert.equal(r.st.wait,'absorbed');
  // absorbed() itself: heavy selling, price flat
  const now=1000,S1=series(now-120,now,()=>60000,()=>-5000,()=>-5000);
  assert.equal(S.absorbed(S1,now,-1,20,C),true);
  const S2=series(now-120,now,t=>60000-(t-(now-120)),()=>-5000,()=>-5000);
  assert.equal(S.absorbed(S2,now,-1,20,C),false,'price still progressing');
});

test('expiry: confirmation window and contract close',()=>{
  let st=run(S.fresh(-1),base({arrow:{side:-1,t:355}})).st;
  assert.equal(run(st,base({now:360+C.confirmSec+1})).st.state,'EXPIRED');
  st=run(S.fresh(-1),base({arrow:{side:-1,t:355},close:400})).st;
  const r=run(st,base({now:400,close:400}));assert.equal(r.st.state,'EXPIRED');assert.match(r.events[0].why,/contract closed/);
});

test('stale data freezes the machine: no transitions, no alerts',()=>{
  const r=run(S.fresh(-1),base({arrow:{side:-1,t:355},ok:false}));assert.equal(r.st.state,'IDLE');assert.equal(r.events.length,0);assert.ok(r.st.stale);
});

test('bullish mirror: green arrow → WATCH UP → BREAK UP → pullback holds → fresh high → CONFIRMED UP; and invalidation',()=>{
  const bb=o=>base({candles:bullCandles(),px:95,flow:{spot:500000,perp:400000,spotAgree:2},...o});
  let st=S.fresh(1);const kinds=[];const rec=r=>{st=r.st;kinds.push(...r.events.map(e=>e.kind))};
  rec(run(st,bb({arrow:{side:1,t:355}})));assert.equal(st.state,'WATCH');assert.equal(st.level,100);
  rec(run(st,bb({arrow:{side:-1,t:356}})));assert.equal(kinds.length,1,'red arrow does not touch the bullish side');
  const C2=[...bullCandles(),mk(360,95,103,94,102)];
  rec(run(st,bb({now:421,px:103,candles:C2})));assert.equal(S.label(st),'BREAK UP · retest pending');
  rec(run(st,bb({now:425,px:112,candles:C2})));assert.ok(kinds.includes('RETEST_PENDING'));
  rec(run(st,bb({now:440,px:103,candles:C2})));assert.ok(st.retested);
  const C3=[...C2,mk(420,103,112,100.5,103)];
  rec(run(st,bb({now:481,px:105,candles:C3})));assert.ok(st.rejected);
  rec(run(st,bb({now:490,px:112.5,candles:C3})));assert.equal(st.state,'CONFIRMED');assert.equal(S.label(st),'CONFIRMED UP');
  // close back below → invalidated
  const r=run(st,bb({now:541,px:98,candles:[...C3,mk(480,105,106,97,99)]}));assert.equal(r.st.state,'INVALIDATED');
});

test('bullish: BUYING absorbed suppresses new bullish watches',()=>{
  assert.equal(run(S.fresh(1),base({candles:bullCandles(),arrow:{side:1,t:355},absorbed:true})).st.state,'IDLE');
});

test('gap trend, direction mismatch text',()=>{
  assert.equal(S.gapTrend(-42,-30),'opening');assert.equal(S.gapTrend(-20,-30),'closing');assert.equal(S.gapTrend(5,-5),'crossed');
  assert.equal(S.mismatch(-1,12),'BTC FALLING · ESTIMATE STILL ABOVE STRIKE');
  assert.equal(S.mismatch(1,-12),'BTC RISING · ESTIMATE STILL BELOW STRIKE');
  assert.equal(S.mismatch(-1,-12),'');
});

test('gate: off with too little data; needs out-of-sample improvement and edge after costs; master switch off by default',()=>{
  assert.equal(S.evaluateGate([],C).pass,false);
  // synthetic: down setups win far more than baseline implies, cheap asks
  const rows=[];for(let i=0;i<400;i++)rows.push({t:i,dir:-1,pBase:0.5,result:i%10<8?'no':'yes',ask:0.5});
  const g=S.evaluateGate(rows,C);assert.equal(g.nTest,160);assert.ok(g.brierSetup<g.brierBase);assert.equal(g.pass,true);
  assert.equal(g.enabled,false,'actionable stays off until the switch is set');
  assert.equal(S.evaluateGate(rows,{...C,actionable:1}).enabled,true);
  // same data but expensive asks → edge does not cover the quote
  const g2=S.evaluateGate(rows.map(r=>({...r,ask:0.85})),C);assert.equal(g2.pass,false);
  // chronological: training period informative, test period reversed → fails
  const rev=rows.map((r,i)=>({...r,result:i<240?(i%10<8?'no':'yes'):(i%10<8?'yes':'no')}));assert.equal(S.evaluateGate(rev,C).pass,false);
});

test('baseline probability uses only distance, volatility and time',()=>{
  near(S.pBase(0,10,300),0.5,1e-6);assert.ok(S.pBase(30,10,60)>0.97);assert.ok(S.pBase(-30,10,60)<0.03);assert.equal(S.pBase(null,10,60),null);
});

test('sub-minute baseline ignores coarse seeded rows before live data',()=>{
  // seeded minute closes (flat within each minute) then live per-second data moving $1/s
  const rows=[];for(let m=0;m<30;m++)rows.push({t:m*60+59,px:60000+m,sn:0,pn:0});
  const live=1800;for(let t=live;t<=live+400;t++)rows.push({t,px:60000+(t-live)*0.2,sn:0,pn:0});
  const now=live+400,withSeed=S.baseline(rows,now,30,20,C),liveOnly=S.baseline(rows,now,30,20,C,live);
  assert.equal(liveOnly.n,12);near(liveOnly.typ,6);
  assert.equal(withSeed.n,20);
  // 1m+ baselines may still use the seed
  assert.equal(S.baseline(rows,now,60,20,C,live).n,20);
});
