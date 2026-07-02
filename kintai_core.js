/* ============================================================
   勤怠管理 共通コア (kintai_core.js)
   - データは各ブラウザの localStorage に保存されます（サーバー無しの静的アプリ）。
   - 複数の労働者（ユーザー）を1つのストレージ内で管理し、管理画面から
     労働者単位でデータを確認できます。
   ============================================================ */
(function(global){
"use strict";

/* ---- storage keys ---- */
const K = {
  DATA:"kintai_v4_data",     // { [username]: {records,schedule,submits,plan,plansub,contract} }
  USERS:"kintai_v4_users",   // { [username]: {name,email} }
  NEWS:"kintai_v4_news",     // [ {id,ts,title,body,pinned} ]
  CFG:"kintai_v4_config",    // { submitDay, payDay, adminEmail, companyName }
  READ:"kintai_v4_read",     // { [scope]: lastReadTs }
  MIG:"kintai_v4_migrated"
};
/* legacy (v3) single-user keys, for one-time migration */
const LEGACY = { REC:"kintai_v3_records", SCH:"kintai_v3_schedule", SUB:"kintai_v3_submit", CON:"kintai_v3_contract" };

const pad = n => String(n).padStart(2,"0");
const WD = ["日","月","火","水","木","金","土"];
const LEAVE_TYPES = {paid:"有給休暇",am:"午前半休",pm:"午後半休",absence:"欠勤",special:"特別休暇"};
const WAGE_TYPES = {hourly:"時給",daily:"日給",monthly:"月給"};

/* ---- low level ---- */
function _get(key,def){ try{ const v=JSON.parse(localStorage.getItem(key)); return (v==null)?(def!==undefined?def:{}):v; }catch(e){ return def!==undefined?def:{}; } }
function _set(key,v){ try{ localStorage.setItem(key,JSON.stringify(v)); }catch(e){} }

/* ---- roster (labor force) ---- */
function getUsers(){ return _get(K.USERS,{}); }
function saveUsers(v){ _set(K.USERS,v); }
function upsertUser(username,name,email){
  if(!username) return;
  const u=getUsers(); const prev=u[username]||{};
  u[username]={ name:(name!==undefined&&name!==null&&name!=="")?name:(prev.name||username),
                email:(email!==undefined&&email!==null)?email:(prev.email||"") };
  saveUsers(u);
}
function removeUser(username){
  const u=getUsers(); delete u[username]; saveUsers(u);
  const d=allData(); delete d[username]; _set(K.DATA,d);
}
function userLabel(username){ const u=getUsers()[username]; return u&&u.name?u.name:(username||"—"); }
function userEmail(username){ const u=getUsers()[username]; return u?(u.email||""):""; }

/* ---- per-user data ---- */
function _blank(){ return {records:{},schedule:{},submits:{},plan:{},plansub:{},contract:{}}; }
function allData(){ return _get(K.DATA,{}); }
function getData(username){ const d=allData(); return Object.assign(_blank(), d[username]||{}); }
function setData(username,ud){ const d=allData(); d[username]=ud; _set(K.DATA,d); }

/* ---- current-user pointer + DB facade (keeps render code user-scoped) ---- */
let CURRENT_USER = null;
function setCurrentUser(u){ CURRENT_USER=u; if(u && !getUsers()[u]) upsertUser(u,u,""); }
function currentUser(){ return CURRENT_USER; }

const DB = {
  _d(){ return getData(CURRENT_USER); },
  _s(ud){ setData(CURRENT_USER, ud); },
  records(){ return this._d().records||{}; },       saveRecords(v){ const d=this._d(); d.records=v; this._s(d); },
  schedule(){ return this._d().schedule||{}; },      saveSchedule(v){ const d=this._d(); d.schedule=v; this._s(d); },
  submits(){ return this._d().submits||{}; },        saveSubmits(v){ const d=this._d(); d.submits=v; this._s(d); },
  plan(){ return this._d().plan||{}; },              savePlan(v){ const d=this._d(); d.plan=v; this._s(d); },
  plansub(){ return this._d().plansub||{}; },        savePlansub(v){ const d=this._d(); d.plansub=v; this._s(d); },
  contract(){ return this._d().contract||{}; },      saveContractData(v){ const d=this._d(); d.contract=v; this._s(d); }
};

/* live sync between tabs of the same browser */
function onExternalChange(cb){
  window.addEventListener("storage", e=>{ if([K.DATA,K.USERS,K.NEWS,K.CFG].includes(e.key)) cb(); });
}

/* ---- date helpers ---- */
function ymd(d){ return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }
function todayKey(){ return ymd(new Date()); }
function monthKey(d){ return `${d.getFullYear()}-${pad(d.getMonth()+1)}`; }
function mkLabel(mk){ const [y,m]=mk.split("-"); return `${y}年${Number(m)}月`; }
function parseKey(k){ const [y,m,d]=k.split("-").map(Number); return new Date(y,m-1,d); }
function daysInMonth(y,m){ return new Date(y,m,0).getDate(); } // m:1-12
function hm(ts){ if(!ts) return "--:--"; const d=new Date(ts); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; }
function hmInput(ts){ if(!ts) return ""; const d=new Date(ts); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; }
function fmtDur(ms){ if(ms<0)ms=0; const m=Math.round(ms/60000); return `${Math.floor(m/60)}:${pad(m%60)}`; }
function fmtH(min){ return (min/60).toFixed(1); }
function tsFrom(dateKey,timeStr){ if(!timeStr) return null; const [h,mi]=timeStr.split(":").map(Number);
  const [y,mo,d]=dateKey.split("-").map(Number); return new Date(y,mo-1,d,h,mi,0,0).getTime(); }
function isPastDay(k){ return k<todayKey(); }

/* ---- calc ---- */
function overlap(a1,a2,b1,b2){ return Math.max(0,Math.min(a2,b2)-Math.max(a1,b1)); }
function breakMs(rec,upto){ let t=0; for(const b of (rec.breaks||[])){ const end=b.end??(b.start?upto:b.start); if(b.start&&end)t+=(end-b.start); } return t; }
function workedMs(rec,now){ now=now||Date.now(); if(!rec.in)return 0; const end=rec.out??now; return (end-rec.in)-breakMs(rec,end); }
function nightMs(rec){
  if(!rec.in||!rec.out) return 0;
  const nightIn=(s,e)=>{
    let total=0; const start=new Date(s); start.setHours(0,0,0,0);
    for(let d=start.getTime(); d<e; d+=86400000){
      const base=new Date(d);
      const w1s=new Date(base); w1s.setHours(22,0,0,0);
      const w1e=new Date(base); w1e.setHours(24,0,0,0);
      const w2s=new Date(base); w2s.setHours(0,0,0,0);
      const w2e=new Date(base); w2e.setHours(5,0,0,0);
      total+=overlap(s,e,w1s.getTime(),w1e.getTime());
      total+=overlap(s,e,w2s.getTime(),w2e.getTime());
    }
    return total;
  };
  let n=nightIn(rec.in,rec.out);
  for(const b of (rec.breaks||[])){ if(b.start&&b.end) n-=nightIn(b.start,b.end); }
  return Math.max(0,n);
}
const LEGAL_DAY_MIN=480;
function overtimeMin(rec){ if(!rec.out)return 0; return Math.max(0,Math.round(workedMs(rec)/60000)-LEGAL_DAY_MIN); }
function requiredBreakMin(workMin){ if(workMin>480)return 60; if(workMin>360)return 45; return 0; }
function state(rec){ if(!rec||!rec.in)return "off"; if(rec.out)return "done";
  const last=(rec.breaks||[])[rec.breaks.length-1]; if(last&&last.start&&!last.end)return "break"; return "working"; }
function dayKind(rec){ if(rec&&rec.leave){return rec.leave.type==="absence"?"absence":"leave";} if(rec&&rec.in)return "work"; return null; }

/* ---- per-day error checks ---- */
function checkDay(k, rec, planned){
  const out=[];
  if(!rec){ if(planned && isPastDay(k)) out.push({level:"warn",msg:"稼働日ですが打刻がありません（打刻漏れの可能性）"}); return out; }
  if(rec.leave) return out;
  if(rec.in && !rec.out){ if(isPastDay(k)) out.push({level:"error",msg:"退勤打刻がありません"}); return out; }
  if(rec.in && rec.out){
    const wMin=Math.round(workedMs(rec)/60000);
    const bMin=Math.round(breakMs(rec,rec.out)/60000);
    const need=requiredBreakMin(wMin);
    if(need>0 && bMin<need) out.push({level:"error",msg:`休憩不足（実働${(wMin/60).toFixed(1)}h：休憩${need}分以上が必要、記録は${bMin}分）`});
    if(wMin>720) out.push({level:"warn",msg:`長時間労働（実働${(wMin/60).toFixed(1)}h）`});
    if(wMin<=0) out.push({level:"warn",msg:"実働時間が0以下です（打刻内容を確認）"});
  }
  return out;
}
function checkMonth(mkey){
  const recs=DB.records(), sch=DB.schedule(), issues=[];
  const [y,m]=mkey.split("-").map(Number);
  for(let d=1; d<=daysInMonth(y,m); d++){ const k=`${y}-${pad(m)}-${pad(d)}`; checkDay(k, recs[k], !!sch[k]).forEach(i=>issues.push({date:k,...i})); }
  const agg=aggregate(mkey);
  if(agg.otMin>45*60) issues.push({date:mkey,level:"warn",msg:`月の時間外労働が45時間を超過（${fmtH(agg.otMin)}h）※36協定の上限目安`});
  return issues;
}

/* ---- monthly aggregate ---- */
function aggregate(mkey){
  const recs=DB.records(); const [y,m]=mkey.split("-").map(Number);
  let workDays=0, workMin=0, otMin=0, niMin=0, brMin=0, holidayDays=0;
  const leave={paid:0,am:0,pm:0,absence:0,special:0};
  const sch=DB.schedule();
  for(let d=1; d<=daysInMonth(y,m); d++){
    const k=`${y}-${pad(m)}-${pad(d)}`; const r=recs[k]; if(!r)continue;
    if(r.leave){ leave[r.leave.type]=(leave[r.leave.type]||0)+1; continue; }
    if(r.in && r.out){
      workDays++; workMin+=Math.round(workedMs(r)/60000); otMin+=overtimeMin(r);
      niMin+=Math.round(nightMs(r)/60000); brMin+=Math.round(breakMs(r,r.out)/60000);
      const dow=parseKey(k).getDay(); if(dow===0 || !sch[k]) holidayDays++;
    } else if(r.in){ workDays++; workMin+=Math.round(workedMs(r)/60000); }
  }
  return {workDays,workMin,otMin,niMin,brMin,holidayDays,leave,
    leaveDays:leave.paid+leave.absence+leave.special+(leave.am+leave.pm)*0.5};
}

/* ---- CSV ---- */
function buildCSV(mkey){
  const recs=DB.records(); const [y,m]=mkey.split("-").map(Number);
  const head=["日付","曜日","区分","出勤","退勤","休憩(分)","実働(h)","時間外(h)","深夜(h)","備考"];
  const lines=[head.join(",")];
  for(let d=1; d<=daysInMonth(y,m); d++){
    const k=`${y}-${pad(m)}-${pad(d)}`; const r=recs[k]; const dow=WD[parseKey(k).getDay()];
    if(!r){ lines.push([k,dow,"","","","","","","",""].join(",")); continue; }
    if(r.leave){ lines.push([k,dow,LEAVE_TYPES[r.leave.type]||"休暇","","","","","","",(r.leave.note||"")].join(",")); continue; }
    const bMin=Math.round(breakMs(r,r.out??Date.now())/60000);
    const wMin=r.out?Math.round(workedMs(r)/60000):"";
    const ot=r.out?(overtimeMin(r)/60).toFixed(2):"";
    const ni=r.out?(Math.round(nightMs(r)/60000)/60).toFixed(2):"";
    lines.push([k,dow,"勤務",hm(r.in),r.out?hm(r.out):"",bMin,wMin===""?"":(wMin/60).toFixed(2),ot,ni,(r.note||"")].join(","));
  }
  return "﻿"+lines.join("\r\n");
}
function downloadCSV(mkey){
  const blob=new Blob([buildCSV(mkey)],{type:"text/csv"});
  const a=document.createElement("a"); a.href=URL.createObjectURL(blob);
  a.download=`勤怠_${userLabel(CURRENT_USER)}_${mkey}.csv`; a.click(); URL.revokeObjectURL(a.href);
}

/* ===== auth (client-side convenience gate — not a real security boundary) ===== */
const AK={ CRED:"kintai_v3_cred", SESS:"kintai_v3_session" };
async function hashPw(s){
  try{ const b=await crypto.subtle.digest("SHA-256",new TextEncoder().encode("kintai$"+s));
    return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,"0")).join(""); }
  catch(e){ let h=5381; for(let i=0;i<s.length;i++)h=((h<<5)+h+s.charCodeAt(i))>>>0; return "f"+h.toString(16); }
}
const AUTH={
  cred(){ try{ return JSON.parse(localStorage.getItem(AK.CRED)); }catch(e){ return null; } },
  setCred(c){ try{ localStorage.setItem(AK.CRED,JSON.stringify(c)); }catch(e){} },
  session(){ try{ return sessionStorage.getItem(AK.SESS)||localStorage.getItem(AK.SESS); }catch(e){ return null; } },
  login(u,remember){ try{ (remember?localStorage:sessionStorage).setItem(AK.SESS,u);
    (remember?sessionStorage:localStorage).removeItem(AK.SESS); }catch(e){} },
  logout(){ try{ localStorage.removeItem(AK.SESS); sessionStorage.removeItem(AK.SESS); }catch(e){} }
};
function authState(){ const c=AUTH.cred(); if(!c) return "setup"; if(AUTH.session()!==c.username) return "login"; return "ready"; }

/* ===== contract (per-user) ===== */
const CONTRACT_FIELDS=[
  ["employer","事業者名",1],["employee","労働者名",0],["type","雇用形態",0],["term","契約期間",1],
  ["location","就業場所",1],["job","業務内容",1],["workHours","所定労働時間",0],["breakInfo","休憩",0],
  ["holidays","所定休日",0],["wage","賃金",0],["closing","締め日",0],["payday","支払日",0],
  ["insurance","加入保険",1],["note","備考",1],
];
function getContract(){ return DB.contract(); }
function saveContract(c){ DB.saveContractData(c); }
function contractWage(c){ return c.wageType?`${WAGE_TYPES[c.wageType]||""} ${c.wageAmount||""}円`:(c.wage||""); }
function contractView(canEdit){
  const c=getContract(); const emp=c.employee||userLabel(CURRENT_USER)||"";
  const wage=contractWage(c);
  const vals={employer:c.employer,employee:emp,type:c.type,term:c.term,location:c.location,job:c.job,
    workHours:c.workHours,breakInfo:c.breakInfo,holidays:c.holidays,wage:wage,closing:c.closing,payday:c.payday,
    insurance:c.insurance,note:c.note};
  const any=Object.values(vals).some(v=>v&&String(v).trim());
  if(!any) return `<div class="contract-empty">雇用契約情報は未登録です${canEdit?"（「編集」から登録できます）":"（管理者が登録します）"}</div>`;
  return `<div class="contract-card">`+CONTRACT_FIELDS.map(([k,l,full])=>{
    const v=vals[k]; if(!v||!String(v).trim())return "";
    return `<div class="ci ${full?'full':''}"><div class="l">${l}</div><div class="v">${String(v).replace(/</g,"&lt;").replace(/\n/g,"<br>")}</div></div>`;
  }).join("")+`</div>`;
}

/* ===== PDF via print ===== */
function esc(s){ return String(s||"").replace(/</g,"&lt;").replace(/\n/g,"<br>"); }
function printDoc(html){
  let a=document.getElementById("printArea");
  if(!a){ a=document.createElement("div"); a.id="printArea"; document.body.appendChild(a); }
  a.innerHTML=html; window.print();
}
function printContract(){
  const c=getContract(); const emp=c.employee||userLabel(CURRENT_USER)||"";
  const wage=contractWage(c);
  const rows=[["事業者名",c.employer],["労働者名",emp],["雇用形態",c.type],["契約期間",c.term],
    ["就業場所",c.location],["業務内容",c.job],["所定労働時間",c.workHours],["休憩",c.breakInfo],
    ["所定休日",c.holidays],["賃金",wage],["締め日",c.closing],["支払日",c.payday],
    ["加入保険",c.insurance],["備考",c.note]];
  const body=rows.map(([l,v])=>`<tr><th>${l}</th><td>${esc(v)||"—"}</td></tr>`).join("");
  const today=new Date().toLocaleDateString('ja-JP');
  printDoc(`<div class="pdoc"><h1>労働条件通知書</h1>
    <div class="psub">発行日：${today}</div>
    <table>${body}</table>
    <div class="sign">事業者：__________________________　㊞<br>労働者：__________________________　㊞</div>
    <div class="note">※本書は勤怠管理ツールから出力した控えです。正式な労働条件通知書・雇用契約書の記載事項・様式は就業規則および社会保険労務士にご確認ください。</div>
  </div>`);
}
function printTimesheet(mkey){
  const emp=userLabel(CURRENT_USER); const [y,m]=mkey.split("-").map(Number);
  const recs=DB.records(); const agg=aggregate(mkey);
  let rows="";
  for(let d=1;d<=daysInMonth(y,m);d++){
    const k=`${y}-${pad(m)}-${pad(d)}`; const r=recs[k]; const dow=WD[parseKey(k).getDay()];
    let kind="",iT="",oT="",bT="",wT="",oT2="";
    if(r&&r.leave){ kind=LEAVE_TYPES[r.leave.type]||"休暇"; }
    else if(r&&r.in){ kind="勤務"; iT=hm(r.in); oT=r.out?hm(r.out):"";
      bT=r.out?Math.round(breakMs(r,r.out)/60000):""; wT=r.out?fmtDur(workedMs(r)):""; oT2=r.out?fmtDur(overtimeMin(r)*60000):""; }
    rows+=`<tr><td>${m}/${d}</td><td>${dow}</td><td>${kind}</td><td>${iT}</td><td>${oT}</td><td>${bT}</td><td>${wT}</td><td>${oT2}</td></tr>`;
  }
  printDoc(`<div class="pdoc"><h1>勤 怠 表</h1>
    <div class="psub">${y}年${m}月分　氏名：${esc(emp)||"　　　　　"}</div>
    <table class="tsheet"><thead><tr><th>日</th><th>曜</th><th>区分</th><th>出勤</th><th>退勤</th><th>休憩(分)</th><th>実働</th><th>時間外</th></tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr class="tfoot"><td colspan="6">合計</td><td>${fmtH(agg.workMin)}h</td><td>${fmtH(agg.otMin)}h</td></tr></tfoot></table>
    <div class="note">出勤日数 ${agg.workDays}日／休暇 ${agg.leaveDays}日／深夜 ${fmtH(agg.niMin)}h／休日勤務 ${agg.holidayDays}日。時間外は1日8時間超、深夜は22:00〜翌5:00の実働。割増賃金の計算は社会保険労務士にご確認ください。</div>
  </div>`);
}

/* ===== config ===== */
function getCfg(){ return Object.assign({submitDay:25, payDay:25, adminEmail:"", companyName:""}, _get(K.CFG,{})); }
function saveCfg(patch){ _set(K.CFG, Object.assign(getCfg(), patch)); }

/* ===== announcements (お知らせ) ===== */
function getNews(){ const n=_get(K.NEWS,[]); return Array.isArray(n)?n:[]; }
function saveNews(v){ _set(K.NEWS,v); }
function addNews(title,body,pinned){
  const n=getNews();
  n.unshift({ id:"n"+Date.now()+"_"+Math.floor(Math.random()*10000), ts:Date.now(), title:title||"（無題）", body:body||"", pinned:!!pinned });
  saveNews(n); return n;
}
function deleteNews(id){ saveNews(getNews().filter(x=>x.id!==id)); }
function newsSorted(){ return getNews().slice().sort((a,b)=>(b.pinned-a.pinned)|| (b.ts-a.ts)); }

/* ===== read tracking ===== */
function getRead(){ return _get(K.READ,{}); }
function markRead(scope){ const r=getRead(); r[scope]=Date.now(); _set(K.READ,r); }
function lastRead(scope){ return getRead()[scope]||0; }
function unreadNews(scope){ const lr=lastRead(scope); return getNews().filter(n=>n.ts>lr).length; }

/* ===== notifications ===== */
/* 打刻漏れ: 過去の稼働予定日(plan/schedule)で打刻も休暇も無い日 */
function missingPunchDays(username, monthsBack){
  monthsBack = monthsBack==null?1:monthsBack;
  const ud=getData(username); const plan=ud.plan||{}, sch=ud.schedule||{}, recs=ud.records||{};
  const wanted=new Set();
  Object.keys(plan).forEach(k=>{ if(plan[k]) wanted.add(k); });
  Object.keys(sch).forEach(k=>{ if(sch[k]) wanted.add(k); });
  const limit=new Date(); limit.setMonth(limit.getMonth()-monthsBack); limit.setDate(1);
  const limitKey=ymd(limit);
  const miss=[];
  wanted.forEach(k=>{ if(isPastDay(k) && k>=limitKey){ const r=recs[k]; if(!r || (!r.in && !r.leave)) miss.push(k); } });
  miss.sort();
  return miss;
}
/* 提出リマインド: 固定日(submitDay)以降で当月未提出/差し戻し */
function submissionReminder(username){
  const cfg=getCfg(); const today=new Date(); const day=today.getDate();
  const mk=monthKey(today);
  const subs=getData(username).submits||{};
  const st=subs[mk]?subs[mk].status:"none";
  if(day>=cfg.submitDay && (st==="none"||st==="rejected")){
    return { mk, day:cfg.submitDay, status:st, msg:`毎月${cfg.submitDay}日は勤怠表の提出日です。${mkLabel(mk)}分の勤怠表を提出してください。` };
  }
  return null;
}
/* 管理者向け通知: 提出(確認待ち) / 承認済み未払い(給与支給) */
function adminNotifications(){
  const users=getUsers(); const out=[];
  Object.keys(users).forEach(u=>{
    const subs=getData(u).submits||{};
    Object.keys(subs).forEach(mk=>{
      const s=subs[mk];
      if(s.status==="submitted") out.push({type:"submit",user:u,mk,ts:s.submittedAt||0,
        msg:`${userLabel(u)} さんが ${mkLabel(mk)} の勤怠表を提出しました（確認待ち）`});
      else if(s.status==="approved" && !s.paidAt) out.push({type:"pay",user:u,mk,ts:s.reviewedAt||0,
        msg:`${userLabel(u)} さんの ${mkLabel(mk)} は承認済みです。給与支給を行ってください`});
    });
  });
  out.sort((a,b)=>b.ts-a.ts);
  return out;
}

/* mailto helper (静的アプリのため実送信は不可 → メーラーを開く) */
function mailtoLink(to,subject,body){
  const p=[]; if(subject)p.push("subject="+encodeURIComponent(subject)); if(body)p.push("body="+encodeURIComponent(body));
  return "mailto:"+encodeURIComponent(to||"")+(p.length?("?"+p.join("&")):"");
}
function openMail(to,subject,body){ try{ window.location.href=mailtoLink(to,subject,body); }catch(e){} }

/* ===== auth DOM handlers (shared; both pages use identical ids) ===== */
function setHeaderName(){
  const c=AUTH.cred(); const el=document.getElementById("who");
  if(el&&c) el.innerHTML=`${esc(c.name||c.username)}<small>${esc(c.email||"")}</small>`;
}
function showAuth(mode){
  const w=document.getElementById("authWrap");
  const su=document.getElementById("authSetup"), li=document.getElementById("authLogin");
  if(su) su.hidden = mode!=="setup";
  if(li) li.hidden = mode!=="login";
  if(w) w.hidden = (mode==="ready");
}
async function doSetup(){
  const g=id=>document.getElementById(id);
  const name=g("suName").value.trim(), user=g("suUser").value.trim(), email=g("suEmail").value.trim();
  const pw=g("suPw").value, pw2=g("suPw2").value, err=g("suErr");
  if(!name){err.textContent="お名前を入力してください";return;}
  if(!/^[A-Za-z0-9_.-]{3,}$/.test(user)){err.textContent="ユーザー名は英数字3文字以上で入力してください";return;}
  if(pw.length<8){err.textContent="パスワードは8文字以上にしてください";return;}
  if(pw!==pw2){err.textContent="パスワードが一致しません";return;}
  AUTH.setCred({username:user,name,email,hash:await hashPw(pw)});
  AUTH.login(user,true);
  if(window.onAuthReady) window.onAuthReady();
}
async function doLogin(){
  const c=AUTH.cred(); const err=document.getElementById("liErr");
  const user=document.getElementById("liUser").value.trim();
  const pw=document.getElementById("liPw").value;
  const remember=document.getElementById("liRemember").checked;
  if(!c||user!==c.username||(await hashPw(pw))!==c.hash){err.textContent="ユーザー名またはパスワードが違います";return;}
  AUTH.login(user,remember);
  if(window.onAuthReady) window.onAuthReady();
}
function logout(){ AUTH.logout(); location.reload(); }
function openSettings(){
  const c=AUTH.cred(); if(!c)return; const g=id=>document.getElementById(id);
  g("setName").value=c.name||""; g("setUser").value=c.username||""; g("setEmail").value=c.email||"";
  g("setCur").value=""; g("setNew").value=""; g("setErr").textContent="";
  g("settingsModal").hidden=false;
}
async function saveSettings(){
  const c=AUTH.cred(); const g=id=>document.getElementById(id); const err=g("setErr");
  const name=g("setName").value.trim(), user=g("setUser").value.trim(), email=g("setEmail").value.trim();
  const cur=g("setCur").value, nw=g("setNew").value;
  if(!name){err.textContent="お名前を入力してください";return;}
  if(!/^[A-Za-z0-9_.-]{3,}$/.test(user)){err.textContent="ユーザー名は英数字3文字以上です";return;}
  let hash=c.hash;
  if(nw){ if((await hashPw(cur))!==c.hash){err.textContent="現在のパスワードが違います";return;}
    if(nw.length<8){err.textContent="新しいパスワードは8文字以上です";return;} hash=await hashPw(nw); }
  const prevUser=c.username;
  AUTH.setCred({username:user,name,email,hash});
  // keep roster + data in sync if the username changed
  if(user!==prevUser){
    const d=allData(); if(d[prevUser]){ d[user]=d[prevUser]; delete d[prevUser]; _set(K.DATA,d); }
    removeUser(prevUser);
    if(CURRENT_USER===prevUser) CURRENT_USER=user;
    AUTH.login(user, !!localStorage.getItem(AK.SESS));
  }
  upsertUser(user,name,email);
  g("settingsModal").hidden=true;
  setHeaderName(); if(window.afterSettings) window.afterSettings();
}

/* ===== one-time migration from v3 single-user layout ===== */
function migrate(){
  try{
    if(localStorage.getItem(K.MIG)) return;
    const legacyRec=_get(LEGACY.REC,null);
    let owner=null; const c=AUTH.cred(); if(c&&c.username) owner=c.username;
    if(legacyRec && Object.keys(legacyRec).length){
      owner=owner||"default";
      const ud=_blank();
      ud.records=_get(LEGACY.REC,{}); ud.schedule=_get(LEGACY.SCH,{});
      ud.submits=_get(LEGACY.SUB,{}); ud.contract=_get(LEGACY.CON,{});
      setData(owner,ud);
      upsertUser(owner,(ud.contract&&ud.contract.employee)||(c&&c.name)||owner,(c&&c.email)||"");
    } else if(owner){ upsertUser(owner,(c&&c.name)||owner,(c&&c.email)||""); }
    localStorage.setItem(K.MIG,"1");
  }catch(e){}
}
migrate();

/* ===== export ===== */
global.Kintai = {
  K, LEGACY, pad, WD, LEAVE_TYPES, WAGE_TYPES,
  getUsers, saveUsers, upsertUser, removeUser, userLabel, userEmail,
  allData, getData, setData, setCurrentUser, currentUser, DB, onExternalChange,
  ymd, todayKey, monthKey, mkLabel, parseKey, daysInMonth, hm, hmInput, fmtDur, fmtH, tsFrom, isPastDay,
  overlap, breakMs, workedMs, nightMs, overtimeMin, requiredBreakMin, state, dayKind,
  checkDay, checkMonth, aggregate, buildCSV, downloadCSV,
  AK, hashPw, AUTH, authState,
  setHeaderName, showAuth, doSetup, doLogin, logout, openSettings, saveSettings,
  CONTRACT_FIELDS, getContract, saveContract, contractWage, contractView, esc, printDoc, printContract, printTimesheet,
  getCfg, saveCfg,
  getNews, saveNews, addNews, deleteNews, newsSorted,
  getRead, markRead, lastRead, unreadNews,
  missingPunchDays, submissionReminder, adminNotifications, mailtoLink, openMail
};
})(window);
