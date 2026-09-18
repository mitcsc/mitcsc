/* Authorized live rehearsal. No passwords, cookies, voter names, or ratings are logged. */
const fs=require('node:fs');
const {randomUUID}=require('node:crypto');
require('@next/env').loadEnvConfig(process.cwd());
const {GoogleAuth}=require('google-auth-library');
const base='https://csc.mit.edu';
const output='/private/tmp/voting-live-result.json';
const events=[];const timers=[];let stopped=false;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function progress(message,details={}){console.log(JSON.stringify({time:new Date().toISOString(),message,...details}));}
function agent(id){return{id,cookies:new Map(),failures:0};}
async function api(who,path,body,retry=false){
 const payload=body===undefined?undefined:JSON.stringify(body);
 for(let attempt=0;;attempt++){
  const started=Date.now();let status=null;let value;let problem;
  try{
   const r=await fetch(base+'/api/voting/'+path,{method:body===undefined?'GET':'POST',headers:{Origin:base,...(payload?{'Content-Type':'application/json'}:{}),Cookie:[...who.cookies].map(([k,v])=>k+'='+v).join('; ')},body:payload,signal:AbortSignal.timeout(retry?65000:25000)});
   status=r.status;for(const cookie of r.headers.getSetCookie()){const part=cookie.split(';')[0];const split=part.indexOf('=');who.cookies.set(part.slice(0,split),part.slice(split+1));}
   value=await r.json().catch(()=>({}));if(!r.ok)problem=Object.assign(new Error(value.error || 'Voting API request failed'),{status,path});
  }catch(e){problem=e;}
  events.push({startedAt:new Date(started).toISOString(),agent:who.id,path,status,attempt,durationMs:Date.now()-started});
  if(!problem)return value;
  if(!retry||attempt>=4||status!==null&&![429,502,503,504].includes(status))throw problem;
  await sleep(Math.min(30000,5000*2**attempt)+Math.random()*2000);
 }
}
function poll(who,interval){
 async function tick(){if(stopped)return;try{await api(who,'state');who.failures=0;}catch{who.failures++;}if(!stopped)timers.push(setTimeout(tick,who.failures?Math.min(60000,4000*2**who.failures)+Math.random()*2000:interval));}
 timers.push(setTimeout(tick,Math.random()*1500));
}
async function main(){
 const auth=new GoogleAuth({credentials:{client_email:process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,private_key:process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g,'\n')},scopes:['https://www.googleapis.com/auth/spreadsheets']});
 const google=await auth.getClient();const settingsId=process.env.VOTING_SETTINGS_SHEET_ID||'1CRZtuOwF7iouzHrj_n5TCofcNtCtzfBQvsa8Ez9wLXQ';
 const settingsResponse=await google.request({url:`https://sheets.googleapis.com/v4/spreadsheets/${settingsId}/values/Settings!A:B`});
 const config=Object.fromEntries(settingsResponse.data.values);const sheetId=config.voting_sheet_url?.match(/\/d\/([^/]+)/)?.[1];
 if(config.session_id!=='test'||!config.session_password||sheetId!=='1Wk29_K8XiUYuKLhs3gF2aJOo4st6eDvfpxGdUxapuHc')throw Error('Test configuration changed; stopping');
 const owner=agent('admin');await api(owner,'join',{name:'Load Test Admin',password:config.session_password});
 let state=await api(owner,'state');
 if(!state.isAdmin)throw Error('The test admin was not the first join. Existing ownership must be resolved before testing.');
 if(state.initialized)throw Error('Test election is already initialized; refusing to overwrite it.');
 state=await api(owner,'admin',{action:'initialize'});
 const candidates=[1,2].map((n)=>({id:'load-candidate-'+n,name:'Test Candidate '+n,context:'',order:n-1,completed:false}));
 const criteria=[1,2,3].map(n=>({id:'load-criterion-'+n,label:'Test Criteria '+n,description:'',min:1,max:5,required:true}));
 state=await api(owner,'admin',{action:'saveSetup',candidates,criteria});
 poll(owner,8000);
 const voters=Array.from({length:30},(_,i)=>agent('voter-'+String(i+1).padStart(2,'0')));
 progress('Joining 30 test voters');
 await Promise.all(voters.map(async(who,i)=>{await sleep(i*500);await api(who,'join',{name:'Test Voter '+String(i+1).padStart(2,'0'),password:config.session_password},true);const s=await api(who,'state');if(s.isAdmin)throw Error('Unexpected second admin');poll(who,4000);}));
 progress('All 30 voters joined; allowing setup traffic to leave the quota window');
 await sleep(65000);
 const ratings=Object.fromEntries(criteria.map(c=>[c.id,3]));
 const finalRatings=Object.fromEntries(criteria.map(c=>[c.id,4]));
 async function stage(phase,candidateId){state=await api(owner,'admin',{action:'setPhase',phase,...(candidateId?{candidateId}:{})});progress('Stage changed',{phase,candidate:state.currentCandidate?.id});}
 async function initial(spacing){const body={sessionId:state.sessionId,candidateId:state.currentCandidate.id,ballotVersion:state.ballotVersion,ratings};await Promise.all(voters.map(async(v,i)=>{await sleep(i*spacing);await api(v,'initial',body,true);}));progress('All 30 initial submissions acknowledged');}
 await stage('initial',candidates[0].id);await initial(1200);
 await stage('deliberation');progress('Five-minute discussion started');
 for(let i=0;i<5;i++){await sleep(60000);progress('Discussion elapsed',{minutes:i+1});}
 await stage('revision');
 const firstVersion=state.ballotVersion;
 const ballots=voters.map(v=>({sessionId:state.sessionId,candidateId:candidates[0].id,ballotVersion:firstVersion,submissionId:randomUUID(),initialRatings:ratings,finalRatings}));
 await Promise.all(voters.map(async(v,i)=>{await sleep(i*700);await api(v,'submit',ballots[i],true);}));progress('All 30 final submissions acknowledged');
 await stage('locked');await stage('initial',candidates[1].id);await initial(700);
 progress('Back-to-back round completed; allowing retries and counts to settle');await sleep(12000);
 const lastState=await api(owner,'state');
 stopped=true;timers.forEach(clearTimeout);
 const saved=await google.request({url:`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values:batchGet?${new URLSearchParams([["ranges", "'Responses'!A:L"], ["ranges", "'Initial submissions'!A:E"]])}`});
 const responseRows=(saved.data.valueRanges[0].values||[]).slice(1).filter(r=>r[1]===config.session_id);
 const receipts=(saved.data.valueRanges[1].values||[]).slice(1).filter(r=>r[0]===config.session_id);
 const uniqueBallots=new Set(responseRows.map(r=>r[4]+':'+r[2]));
 const valid=responseRows.length===90&&uniqueBallots.size===30&&receipts.length===60&&lastState.participants.filter(v=>v.initialSubmitted).length===30;
 const report={startedAt:events[0].startedAt,finishedAt:new Date().toISOString(),origin:base,revision:'357d249',voters:30,valid,responseRows:responseRows.length,uniqueBallots:uniqueBallots.size,initialReceipts:receipts.length,httpErrors:events.filter(e=>e.status===null||e.status>=400),events};
 fs.writeFileSync(output,JSON.stringify(report,null,2),{mode:0o600});progress('Test finished',{valid,responseRows:responseRows.length,uniqueBallots:uniqueBallots.size,initialReceipts:receipts.length,httpErrors:report.httpErrors.length,report:output});
}
main().catch(e=>{stopped=true;timers.forEach(clearTimeout);fs.writeFileSync(output,JSON.stringify({failed:true,message:e.message,path:e.path,status:e.status,events},null,2),{mode:0o600});progress('Test stopped',{reason:e.message,path:e.path,status:e.status,report:output});process.exitCode=1;});
