/* 15-Minute BTC Setup · pure logic (no DOM, no network, never places orders).
   Loaded by index.html as window.Setup15 and by tests/setup15.test.js via require().
   Every numeric cutoff lives in DEF and is a research parameter, not a validated value. */
(function(root){
'use strict';
const DEF={
  baseN:20,          // prior completed intervals in the rolling median baseline
  baseMin:5,         // fewer than this → baseline "building"
  minDelta:150000,   // $ net taker delta for a 30s slice to count as meaningful
  flowCmp:1.5,       // "comparable" flow: newer slice at most this × the older one
  accel:1.25,        // ACCELERATING: newer move ≥ this × older move in setup direction
  stallFlow:1.15,    // STALLING: newer flow ≥ this × older flow (stronger) ...
  stall:0.8,         // ... while newer move ≤ this × older move
  minMove:3,         // $ minimum move to call a slice directional
  watchMove:1.0,     // watch trigger: 30s |move| ≥ this × typical 30s move ...
  watchDelta:150000, // ... with ≥ this $ net taker delta on the same side
  pivot:2,           // swing pivot: bars each side (1m candles)
  tolVol:0.35,       // retest tolerance = this × 1m σ ...
  tolMin:5,          // ... but at least $5
  confirmSec:600,    // watch → confirmed must happen within this many seconds
  spotMinDelta:100000, // $ spot net delta since the break on the setup side
  spotVenues:2,      // fresh spot venues whose net agrees with the setup side
  perpOnlyConfirms:0,// 1 = a perp-only wave may confirm (graded "weak"); 0 = hold at BREAK
  pendingExt:1.0,    // log "retest pending" path once price runs this × tolerance past the leg start
  absSec:60,         // absorption lookback (s)
  absDelta:300000,   // $ same-side net delta over absSec that counts as persistent aggression
  absProgress:0.25,  // price progress over absSec ≤ this × typical 1m move = no progress
  holdSec:45,        // terminal states stay on the card this long
  gapLook:10,        // s lookback for gap opening/closing
  maxGap:3,          // s max hole in settlement-window samples
  staleSec:10,       // s feed age before data counts as stale
  fee:0.07,          // Kalshi taker fee multiplier (0.07 × P × (1−P))
  slip:1,            // ¢ modeled slippage
  gateTrainFrac:0.6, // chronological split for the out-of-sample test
  gateMinTest:100,   // settled out-of-sample setups needed
  gateBrier:0.005,   // required Brier improvement over the baseline
  actionable:0       // master switch for YES/NO alerts; stays 0 until the gate passes AND you turn it on
};

const median=a=>{if(!a.length)return null;const s=[...a].sort((x,y)=>x-y),m=s.length>>1;return s.length%2?s[m]:(s[m-1]+s[m])/2};
const sgn=v=>v>0?1:v<0?-1:0;

/* ---------- 1. increments ----------
   S = per-second rows {t, px, sn, pn}: t = unix second, px = last price that second,
   sn / pn = spot / perp net taker $ (buy − sell) in that second. Sorted by t. */
function pxAt(S,t){ // last price at or before second t
  let lo=0,hi=S.length-1,r=null;while(lo<=hi){const m=(lo+hi)>>1;if(S[m].t<=t){r=S[m];lo=m+1}else hi=m-1}return r?r.px:null}
function span(S,a,b){ // window (a, b]: price change and net deltas
  const p0=pxAt(S,a),p1=pxAt(S,b);let sn=0,pn=0,ix=0,n=0;
  for(const r of S){if(r.t>a&&r.t<=b){sn+=r.sn||0;pn+=r.pn||0;ix+=r.ix||0;n++}}
  return{dp:p0!=null&&p1!=null?p1-p0:null,sn,pn,ix,net:sn+pn,n,p0,p1}}
// baseline: median |Δprice| over prior completed, non-overlapping intervals of the same length,
// ending at now−len, now−2·len, … The current interval (now−len, now] is never included.
// liveFrom: first second of tick-level data; sub-minute baselines never use coarser seeded rows before it
function baseline(S,now,len,N,cfg,liveFrom){N=N||(cfg||DEF).baseN;const v=[],lim=len<60&&liveFrom!=null?liveFrom:-Infinity;
  for(let k=1;k<=N;k++){const b=now-k*len,a=b-len;if(!S.length||a<S[0].t||a<lim)break;const p0=pxAt(S,a),p1=pxAt(S,b);if(p0!=null&&p1!=null)v.push(Math.abs(p1-p0))}
  return{typ:median(v),n:v.length}}
function increments(S,now,cfg,liveFrom){cfg=cfg||DEF;
  return [30,60,180,300].map(len=>{const w=span(S,now-len,now),B=baseline(S,now,len,cfg.baseN,cfg,liveFrom),ok=B.n>=cfg.baseMin&&B.typ>0;
    return{len,dp:w.dp,sn:w.sn,pn:w.pn,ix:w.ix,net:w.net,typ:B.typ,bn:B.n,rel:ok&&w.dp!=null?w.dp/B.typ:null,full:!!S.length&&S[0].t<=now-len}})}
function slices(S,now){return[span(S,now-60,now-30),span(S,now-30,now)]}

/* ---------- 1b. CVD on the increment grid ----------
   Buckets of `len` seconds anchored on `now`, exactly the windows increments() and baseline() use:
   bucket k (k = 1 … n) covers (now − k·len, now − (k−1)·len]. Bucket 1 = the live increment row,
   buckets 2 … baseN+1 = the baseline intervals. Returned oldest first. Each bucket's CVD delta (net)
   and price change (dp) come from span(), the same function as the increment table, so a bar on the
   chart and the matching row in the table are the same number. liveFrom = first second of trade data:
   a bucket that starts before it has incomplete flow and is flagged partial (its delta is a floor). */
function cvdBuckets(S,now,len,n,liveFrom){const out=[];
  for(let k=n;k>=1;k--){const b=now-(k-1)*len,a=b-len,w=span(S,a,b);
    out.push({k,a,b,len,dp:w.dp,sn:w.sn,pn:w.pn,ix:w.ix,net:w.net,n:w.n,p0:w.p0,p1:w.p1,
      partial:liveFrom==null?!(S.length&&S[0].t<=a):a<liveFrom})}
  return out}
// per-second cumulative taker delta rebased to 0 at `from`: row t holds span(S, from, t) (net, sn, pn, ix)
// and the last price at or before t. t runs from … to inclusive.
function cvdLine(S,from,to){const out=[];let i=0,sn=0,pn=0,ix=0,px=null;
  while(i<S.length&&S[i].t<=from){px=S[i].px;i++}
  for(let t=from;t<=to;t++){while(i<S.length&&S[i].t<=t){const r=S[i];sn+=r.sn||0;pn+=r.pn||0;ix+=r.ix||0;if(r.px!=null)px=r.px;i++}
    out.push({t,sn,pn,ix,net:sn+pn,px})}
  return out}
// 15-minute market window marks for a chart (unix s): open, settlement-window start (close − 60), close
function windowMarks(openMs,closeMs){const o=Math.round(openMs/1000),c=Math.round(closeMs/1000);return{open:o,settle:c-60,close:c}}

/* accelerating / stalling. dir = setup direction (+1 up, −1 down) or 0 = use the flow side. */
function classify(s1,s2,dir,cfg){cfg=cfg||DEF;
  const out={label:'NO READ',why:'',d1:s1.dp,d2:s2.dp};
  if(s1.dp==null||s2.dp==null){out.why='missing price';return out}
  const f1=s1.net,f2=s2.net;
  if(Math.abs(f1)<cfg.minDelta||Math.abs(f2)<cfg.minDelta){out.why='net delta too small in one slice';return out}
  if(sgn(f1)!==sgn(f2)){out.why='flow flipped sides';return out}
  const side=dir||sgn(f1);
  if(sgn(f1)!==side){out.why='flow against the setup';return out}
  const m1=s1.dp*side,m2=s2.dp*side,fr=Math.abs(f2)/Math.abs(f1);out.flowRatio=fr;
  if(m2>=cfg.minMove&&m2>=Math.max(m1,0)*cfg.accel&&fr<=cfg.flowCmp&&m2>m1){out.label='ACCELERATING';out.why=`farther move on ${fr<=1?'less':'comparable'} flow (${fr.toFixed(2)}×)`;return out}
  if(fr>=cfg.stallFlow&&m2<=Math.max(m1,0)*cfg.stall&&m1>=cfg.minMove){out.label='STALLING';out.why=`${fr.toFixed(2)}× the flow, ${m1>0?Math.round(m2/m1*100):0}% of the move`;return out}
  out.label='STEADY';out.why=`flow ${fr.toFixed(2)}×, move ${m1?(m2/m1).toFixed(2):'—'}×`;return out}

/* ---------- 2. structure ---------- candles: completed 1m {t,o,h,l,c}, sorted, t = open (unix s) */
// latest confirmed swing low (dir −1) or high (dir +1) that is still unbroken by any completed close,
// using only candles that closed at or before `asOf` (unix s). Confirmation needs `pivot` bars on each side.
function swing(candles,dir,asOf,cfg){cfg=cfg||DEF;const k=cfg.pivot,C=candles.filter(c=>c.t+60<=asOf);
  for(let i=C.length-1-k;i>=k;i--){const v=dir<0?C[i].l:C[i].h;let ok=true;
    // strictly beyond every bar on the left, at least as extreme as every bar on the right
    for(let j=i-k;j<=i+k;j++){if(j===i)continue;const w=dir<0?C[j].l:C[j].h,beat=dir<0?(j<i?w>v:w>=v):(j<i?w<v:w<=v);if(!beat){ok=false;break}}
    if(!ok)continue;
    let broken=false;for(let j=i+1;j<C.length;j++){if(dir<0?C[j].c<v:C[j].c>v){broken=true;break}}
    if(broken)continue;
    return{level:v,t:C[i].t,known:C[i+k].t+60}}
  return null}

/* absorbed: aggression keeps coming on the setup side but price no longer progresses that way */
function absorbed(S,now,dir,typ1m,cfg){cfg=cfg||DEF;const w=span(S,now-cfg.absSec,now);
  if(w.dp==null||!typ1m)return false;return w.net*dir>=cfg.absDelta&&w.dp*dir<=cfg.absProgress*typ1m}

/* ---------- state machine ----------
   One machine per direction. step() is pure: returns {st, events}. Inputs (x):
   now (unix s), px, candles (completed 1m), arrow {side,t}|null, s30 (30s span), typ30, typ1m, sigma1m,
   flow {spot, perp, spotAgree} measured since the break, absorbed (bool), close (contract close, unix s),
   ticker, ok (all required data fresh). */
const NAMES={'-1':'DOWN','1':'UP'};
function fresh(dir){return{dir,state:'IDLE',since:0}}
function label(st){const d=NAMES[st.dir];if(st.state==='BREAK'&&!st.retested)return`BREAK ${d} · retest pending`;
  if(st.state==='BREAK'&&st.retested&&!st.rejected)return`BREAK ${d} · retesting`;if(st.state==='BREAK')return`BREAK ${d} · reclaim failed`;
  return st.state==='IDLE'?'NO SETUP':`${st.state} ${d}`}
function step(st0,x,cfg){cfg=cfg||DEF;const st={...st0},ev=[],d=st.dir,now=x.now;
  const emit=(kind,why)=>{ev.push({kind,state:st.state,dir:d,why,t:now,label:label(st),level:st.level??null,suppressed:!!(x.absorbed&&kind!=='INVALIDATED'&&kind!=='EXPIRED')})};
  const go=(s,why)=>{st.state=s;st.since=now;emit(s,why)};
  const done=c=>c.t+60<=now;
  const newCloses=x.candles.filter(c=>done(c)&&c.t>(st.lastC??-1));
  st.absorbed=!!x.absorbed;
  if(['INVALIDATED','EXPIRED'].includes(st.state)){if(now-st.since>=cfg.holdSec){const n=fresh(d);n.lastArrow=st.lastArrow;n.lastC=st.lastC;return{st:n,events:ev}}if(newCloses.length)st.lastC=newCloses[newCloses.length-1].t;return{st,events:ev}}
  const arrowNew=x.arrow&&x.arrow.side===d&&x.arrow.t>(st.lastArrow??-Infinity);
  if(x.arrow&&x.arrow.side===d)st.lastArrow=Math.max(st.lastArrow??-Infinity,x.arrow.t);
  if(!x.ok){st.stale=true;return{st,events:ev}}st.stale=false; // stale data: freeze, never advance or alert
  // contract close / confirmation window
  if(st.state!=='IDLE'){
    if(st.close&&now>=st.close){go('EXPIRED','Kalshi contract closed');return{st,events:ev}}
    if(st.state!=='CONFIRMED'&&now-st.start>cfg.confirmSec){go('EXPIRED',`no confirmation within ${Math.round(cfg.confirmSec/60)} min`);return{st,events:ev}}}
  if(st.state==='IDLE'){
    if(x.absorbed)return{st,events:ev}; // suppress new watches on the absorbed side
    const flowTrig=x.s30&&x.s30.dp!=null&&x.typ30>0&&x.s30.dp*d>=cfg.watchMove*x.typ30&&x.s30.net*d>=cfg.watchDelta;
    if(arrowNew||flowTrig){const sw=swing(x.candles,d,now,cfg);
      Object.assign(st,{start:now,close:x.close,ticker:x.ticker,trigger:arrowNew?(d<0?'red arrow':'green arrow'):`30s ${d<0?'selling':'buying'} + ${d<0?'decline':'rise'}`,level:sw?sw.level:null,levelT:sw?sw.t:null,
        retested:false,away:false,rejected:false,legX:null,brkT:null,pendingLogged:false,grade:null});
      if(newCloses.length)st.lastC=newCloses[newCloses.length-1].t;
      go('WATCH',`${st.trigger}; ${sw?`saved swing ${d<0?'low':'high'} $${sw.level.toFixed(2)}`:'no confirmed swing yet'}`)}
    else if(newCloses.length)st.lastC=newCloses[newCloses.length-1].t;
    return{st,events:ev}}
  // level is frozen once set; if the watch began before any swing was confirmed, take the first one known
  if(st.level==null&&st.state==='WATCH'){const sw=swing(x.candles.filter(c=>c.t<st.start),d,now,cfg)||swing(x.candles,d,now,cfg);if(sw){st.level=sw.level;st.levelT=sw.t}}
  for(const c of newCloses){st.lastC=c.t;if(st.level==null)continue;
    const beyond=d<0?c.c<st.level:c.c>st.level;
    if(st.state==='WATCH'&&beyond){st.brkT=c.t+60;st.legX=d<0?c.l:c.h;go('BREAK',`1m close $${c.c.toFixed(2)} ${d<0?'below':'above'} $${st.level.toFixed(2)}`);continue}
    if((st.state==='BREAK'||st.state==='CONFIRMED')&&!beyond&&c.c!==st.level){go('INVALIDATED',`1m close back ${d<0?'above':'below'} $${st.level.toFixed(2)}`);return{st,events:ev}}
    if(st.state==='BREAK'&&st.retested&&!st.rejected&&beyond&&c.t+60>=st.retestT)st.rejected=true}
  if(st.state==='BREAK'){const tol=Math.max(cfg.tolMin,cfg.tolVol*(x.sigma1m||0));st.tol=tol;
    if(!st.retested){ // break leg extreme keeps extending until the retest
      st.legX=d<0?Math.min(st.legX,x.px):Math.max(st.legX,x.px);
      if((x.px-st.level)*d>tol)st.away=true; // a retest only counts after price has left the tolerance band
      if(st.away&&(d<0?x.px>=st.level-tol:x.px<=st.level+tol)){st.retested=true;st.retestT=now}
      else if(!st.pendingLogged&&(x.px-st.level)*d>=(1+cfg.pendingExt)*tol){st.pendingLogged=true;emit('RETEST_PENDING',`price ${d<0?'kept falling':'kept rising'} $${Math.abs(x.px-st.level).toFixed(0)} past the level without a retest`)}}
    else if(st.rejected&&(d<0?x.px<st.legX:x.px>st.legX)){
      const f=x.flow||{},spotOk=(f.spot||0)*d>=cfg.spotMinDelta&&(f.spotAgree||0)>=cfg.spotVenues,perpOk=(f.perp||0)*d>0;
      st.grade=spotOk&&perpOk?'strong':spotOk?'spot only':perpOk?'weak · perp only':'none';
      if(x.absorbed){st.wait='absorbed'}
      else if(spotOk||(perpOk&&cfg.perpOnlyConfirms)){st.wait='';go('CONFIRMED',`broke $${st.level.toFixed(2)}, failed the reclaim, and made a fresh ${d<0?'low':'high'} · flow ${st.grade}`)}
      else st.wait=perpOk?'perp-only flow: waiting for spot confirmation':'no spot confirmation yet'}}
  return{st,events:ev}}

/* ---------- 3. settlement window ---------- samples [{t,px}] sorted by unix second */
// time-weighted average of a step series over [a, b); null unless samples cover it with no hole > maxGap
function twAvg(samples,a,b,maxGap){maxGap=maxGap??DEF.maxGap;if(b<=a)return null;let prev=null,sum=0,cov=0,last=a;
  for(const s of samples){if(s.t<=a){prev=s;continue}if(s.t>=b)break;
    if(prev==null&&s.t-a>maxGap)return null;if(prev==null){prev=s;last=s.t;continue}
    if(s.t-last>maxGap)return null;sum+=prev.px*(s.t-last);cov+=s.t-last;prev=s;last=s.t}
  if(prev==null||b-last>maxGap)return null;sum+=prev.px*(b-last);cov+=b-last;
  return cov>0?sum/cov:null}
// required_remaining_average = (strike×60 − observed_average×elapsed) / (60 − elapsed); null once no time remains
function requiredAvg(strike,obs,elapsed){if(!(elapsed>=0)||elapsed>=60||strike==null)return null;if(elapsed===0)return strike;if(obs==null)return null;return(strike*60-obs*elapsed)/(60-elapsed)}
// KXBTC15M rule (strike_type "greater_or_equal"): YES if the 60s BRTI average, rounded to 2 dp, is at least the strike
const round2=v=>Math.round(v*100)/100;
function settleSide(avg,strike){return round2(avg)>=strike?'YES':'NO'}
function gapTrend(dNow,dPrev){if(dNow==null||dPrev==null)return null;const a=Math.abs(dNow),b=Math.abs(dPrev);if(Math.sign(dNow)!==Math.sign(dPrev)&&dPrev!==0)return'crossed';return a>b+0.5?'opening':a<b-0.5?'closing':'flat'}
function direction(d){return d>0?'RISING':d<0?'FALLING':'FLAT'}
function mismatch(btcDir,dist){if(dist==null||!btcDir)return'';const side=dist>=0?'ABOVE':'BELOW';
  if(btcDir<0&&dist>=0)return'BTC FALLING · ESTIMATE STILL ABOVE STRIKE';if(btcDir>0&&dist<0)return'BTC RISING · ESTIMATE STILL BELOW STRIKE';return''}

/* ---------- baseline probability and gate ---------- */
const Phi=x=>{const t=1/(1+0.2316419*Math.abs(x)),d=0.3989423*Math.exp(-x*x/2),p=d*t*(0.3193815+t*(-0.3565638+t*(1.781478+t*(-1.821256+t*1.330274))));return x>0?1-p:p};
// P(YES) from strike distance, 1m σ and time left only — the baseline the setup has to beat
function pBase(dist,sigma1m,left){if(dist==null||!sigma1m||left==null)return null;const sd=sigma1m*Math.sqrt(Math.max(left,1)/60);return Math.min(0.98,Math.max(0.02,Phi(dist/sd)))}
const feeOf=(p,c)=>(c||DEF).fee*p*(1-p);
/* rows: settled setup log rows {t, dir, pBase, result:'yes'|'no', ask (setup side, $)}.
   Chronological split; the setup model = baseline shifted by the mean residual of same-direction setups in training. */
function evaluateGate(rows,cfg){cfg=cfg||DEF;const R=rows.filter(r=>r.result&&r.pBase!=null&&r.dir).sort((a,b)=>a.t-b.t);
  const cut=Math.floor(R.length*cfg.gateTrainFrac),tr=R.slice(0,cut),te=R.slice(cut),y=r=>r.result==='yes'?1:0;
  const shift={};for(const d of [-1,1]){const a=tr.filter(r=>r.dir===d);shift[d]=a.length?a.reduce((s,r)=>s+(y(r)-r.pBase),0)/a.length:0}
  const clamp=p=>Math.min(0.98,Math.max(0.02,p)),pS=r=>clamp(r.pBase+shift[r.dir]);
  const brier=f=>te.length?te.reduce((s,r)=>s+(f(r)-y(r))**2,0)/te.length:null;
  const bB=brier(r=>r.pBase),bS=brier(pS);
  const q=te.filter(r=>r.ask!=null);const edge=q.length?q.reduce((s,r)=>{const p=r.dir>0?pS(r):1-pS(r);return s+p-r.ask-feeOf(r.ask,cfg)-cfg.slip/100},0)/q.length:null;
  const real=q.length?q.reduce((s,r)=>{const win=(r.dir>0)===(r.result==='yes');return s+(win?1:0)-r.ask-feeOf(r.ask,cfg)-cfg.slip/100},0)/q.length:null;
  const reasons=[];if(te.length<cfg.gateMinTest)reasons.push(`${te.length}/${cfg.gateMinTest} out-of-sample setups settled`);
  if(bB!=null&&!(bB-bS>=cfg.gateBrier))reasons.push(`Brier ${bS?.toFixed(4)} vs baseline ${bB?.toFixed(4)}: improvement below ${cfg.gateBrier}`);
  if(edge!=null&&!(edge>0))reasons.push('estimated edge does not cover ask + fee + slippage');
  if(real!=null&&!(real>0))reasons.push('realized out-of-sample P&L after costs is not positive');
  if(edge==null)reasons.push('no executable quotes logged');
  const pass=!reasons.length;
  return{pass,enabled:pass&&!!cfg.actionable,nTrain:tr.length,nTest:te.length,brierBase:bB,brierSetup:bS,edge,real,shift,reasons}}


/* ---------- chart helpers (pure; used by the page charts) ----------
   chartDomain: x-axis for the setup chart. Ends at `now` — never at the future
   window close — so live CVD/price fill the plot instead of sitting in a sliver.
   Includes a short pre-open context and a minimum span so a fresh page (tens of
   seconds of trades) is still readable. */
function chartDomain(open,close,now,cfg){cfg=cfg||{};
  const pre=cfg.pre??180,minSpan=cfg.minSpan??240,maxPre=cfg.maxPre??300;
  const x1=now; let x0=open-pre;
  if(now-x0<minSpan)x0=now-minSpan;
  if(open!=null&&x0<open-maxPre)x0=open-maxPre;
  if(x0>now-60)x0=now-60;
  return{x0,x1}}
// parse a trade timestamp (ms, unix seconds, or ISO string) to ms; 0 if missing/bad
function toMs(v){if(v==null||v==='')return 0;if(typeof v==='string'&&/[T-]/.test(v)&&isNaN(v)){const t=Date.parse(v);return t>0?t:0}
  const n=+v;if(!isFinite(n)||n<=0)return 0;return n<1e12?Math.round(n*1000):n}
// unix second to bucket a trade into. Missing ts → now. Rejects >2s in the future or older than keepS (default 4h).
function tradeSecond(ts,nowMs,keepS){nowMs=nowMs||Date.now();const t=toMs(ts)||nowMs;
  if(t>nowMs+2000)return null;const keep=(keepS==null?4*3600+60:keepS)*1000;if(keep>=0&&nowMs-t>keep)return null;
  return Math.floor(t/1000)}
/* robustRange: axis limits that a single spike cannot dominate.
   include0: expand to include 0 (CVD). spike: a point more than this × the
   5–95% span beyond that span is clipped (flagged), not used as the axis max. */
function robustRange(vals,cfg){cfg=cfg||{};const v=(vals||[]).filter(x=>x!=null&&isFinite(x));
  if(!v.length)return{mn:-1,mx:1,clipped:false,rawLo:null,rawHi:null};
  const s=[...v].sort((a,b)=>a-b),n=s.length,q=p=>s[Math.min(n-1,Math.max(0,Math.round((n-1)*p)))];
  let lo=q(0.05),hi=q(0.95);if(cfg.include0){lo=Math.min(lo,0);hi=Math.max(hi,0)}
  const rawLo=s[0],rawHi=s[n-1],span=Math.max(hi-lo,cfg.minSpan||1),k=cfg.spike||4;let clipped=false;
  if(rawLo>=lo-k*span)lo=Math.min(lo,rawLo);else clipped=true;
  if(rawHi<=hi+k*span)hi=Math.max(hi,rawHi);else clipped=true;
  if(hi-lo<(cfg.minSpan||1)){const m=(hi+lo)/2,h=(cfg.minSpan||1)/2;lo=m-h;hi=m+h}
  const pad=(cfg.pad??0.08)*(hi-lo);return{mn:lo-pad,mx:hi+pad,clipped,rawLo,rawHi}}

const api={DEF,median,pxAt,span,baseline,increments,cvdBuckets,cvdLine,windowMarks,chartDomain,toMs,tradeSecond,robustRange,slices,classify,swing,absorbed,fresh,step,label,twAvg,requiredAvg,settleSide,round2,gapTrend,direction,mismatch,pBase,evaluateGate,Phi};
if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.Setup15=api;
})(typeof window!=='undefined'?window:globalThis);
