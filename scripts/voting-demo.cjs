/* eslint-disable @typescript-eslint/no-require-imports */
// Local-only demo. Uses the real voting service with an in-memory Sheets adapter.
// Start the Next app on port 3114 first, then run node scripts/voting-demo.cjs.
const http = require('node:http');
const fs = require('node:fs');
const ts = require('typescript');
const { GoogleAuth } = require('google-auth-library');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText, filename);
process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL='demo@example.invalid';
process.env.GOOGLE_PRIVATE_KEY='local-demo-only';
process.env.VOTING_SETTINGS_SHEET_ID='demo-settings';
process.env.VOTING_COOKIE_SECRET='local-demo-secret-never-use-for-a-real-election';
GoogleAuth.prototype.getClient=async()=>({getAccessToken:async()=>({token:'demo'})});
const books=new Map([
 ['demo-settings',new Map([['Settings',[
 ['session_id',`local-demo-${Date.now()}`],['session_password','demo'],['voting_sheet_url','https://docs.google.com/spreadsheets/d/demo-election-sheet/edit']
 ]],['Session History',[['session_id','election_sheet_id','claim_id','voter_id','voter_name','claimed_at']]]])],
 ['demo-election-sheet',new Map()]
]);
function split(range){const [tab,a1='A1']=range.split('!');const start=a1.split(':')[0];return{tab:tab.replace(/^'|'$/g,''),row:Number(start.match(/\d+/)?.[0]||1)-1,col:[...start.match(/[A-Z]+/)[0]].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0)-1,end:Number(a1.split(':')[1]?.match(/\d+/)?.[0])||undefined};}
function read(book,range){const {tab,row,col,end}=split(range);return(book.get(tab)||[]).slice(row,end).map(r=>r.slice(col));}
function write(book,range,values){const {tab,row,col}=split(range);const rows=book.get(tab);for(let r=0;r<values.length;r++){rows[row+r]||=[];for(let c=0;c<values[r].length;c++)rows[row+r][col+c]=values[r][c];}}
global.fetch=async(input,opts={})=>{
 const url=new URL(String(input));
 if(url.hostname!=='sheets.googleapis.com')throw Error('Demo blocks outbound requests.');
 const [,id,suffix]=url.pathname.match(/^\/v4\/spreadsheets\/([^/:]+)(.*)$/);const book=books.get(id);if(!book)return new Response('{}',{status:404});
 const data=opts.body?JSON.parse(opts.body):null;const reply=data=>Response.json(data);
 if(!suffix)return reply({sheets:[...book.keys()].map((title,sheetId)=>({properties:{title,sheetId}}))});
 if(suffix==='/values:batchGet')return reply({valueRanges:url.searchParams.getAll('ranges').map(range=>({values:read(book,range)}))});
 if(suffix==='/values:batchUpdate'){for(const entry of data.data)write(book,entry.range,entry.values);return reply({});}
 if(suffix===':batchUpdate'){for(const req of data.requests){if(req.addSheet)book.set(req.addSheet.properties.title,[]);}return reply({replies:[]});}
 if(suffix.endsWith(':append')){const range=decodeURIComponent(suffix.slice(8,-7));const rows=book.get(split(range).tab);rows.push(...data.values);return reply({updates:{updatedRows:data.values.length}});}
 if(suffix.startsWith('/values/'))return reply({values:read(book,decodeURIComponent(suffix.slice(8)))});
 return new Response('{}',{status:400});
};
const service=require('../src/lib/voting/service.ts');
const security=require('../src/lib/voting/security.ts');
const {claimIdentity,canonicalIdentity}=require('../src/lib/voting/admin-identity.ts');
const origin='http://localhost:3115';
function cookies(req){return Object.fromEntries((req.headers.cookie||'').split(';').map(s=>s.trim().split('=')));}
function json(res,value,status=200){res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));}
const landing=`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>CSC voting demo</title><style>body{background:#0c0c0c;color:#f4f4f4;font:17px/1.6 system-ui;max-width:700px;margin:60px auto;padding:24px}h1{font-size:38px;line-height:1.15}a{color:#ad292f}strong{font-weight:650}.button{display:inline-block;background:#b62f36;color:white;text-decoration:none;padding:12px 20px;border-radius:7px;margin:10px 0}li{margin:12px 0}code{background:#292929;padding:2px 6px}</style></head><body><p>MIT CSC · LOCAL DEMO</p><h1>Try the deliberation room.</h1><p>This demo uses sample candidates and keeps final votes in memory. It never connects to Google Sheets.</p><ol><li>Open the admin page, enter your name, and use password <code>demo</code>. The first person who joins becomes admin.</li><li>Select a candidate and open initial ratings.</li><li>Open the voter page in a private browser window to test as a voter. Admins cannot vote.</li><li>Use admin controls to move through discussion, voting, and closing.</li></ol><a class="button" href="/vote/admin">Open admin page →</a><p><a href="/vote" target="_blank">Open voter page in another tab</a></p><p>Restarting this demo clears server data. Your browser drafts remain saved.</p></body></html>`;
(async()=>{
 const config=await service.settings();const initialAdmin={id:'seed',name:'Demo',role:'admin',sessionId:config.sessionId,sheetId:config.sheetId,exp:Date.now()+86400000};
 await service.adminAction(config,initialAdmin,{action:'initialize'});
 await service.adminAction(config,initialAdmin,{action:'saveSetup',candidates:[
 {id:'alex',name:'Alex Chen',context:'Organized the fall social and helped coordinate volunteers.',order:0,completed:false},
 {id:'jordan',name:'Jordan Lee',context:'Proposed new community events and supported outreach.',order:1,completed:false},
 {id:'morgan',name:'Morgan Wu',context:'Managed event logistics and followed up with partners.',order:2,completed:false}],criteria:[
 {id:'reliability',label:'Reliability',description:'Follows through on commitments.',min:1,max:5,required:true},
 {id:'collaboration',label:'Collaboration',description:'Communicates and works well with the team.',min:1,max:5,required:true},
 {id:'initiative',label:'Initiative',description:'Takes ownership and brings useful ideas.',min:1,max:5,required:false}]});
 http.createServer(async(req,res)=>{
  const path=new URL(req.url,origin).pathname;
  if(path==='/'||path==='/demo'){res.writeHead(200,{'Content-Type':'text/html','Cache-Control':'no-store'});res.end(landing);return;}
  if(!path.startsWith('/api/voting/')){const headers={...req.headers,host:'localhost:3114'};const proxy=http.request({hostname:'127.0.0.1',port:3114,path:req.url,method:req.method,headers},up=>{res.writeHead(up.statusCode,up.headers);up.pipe(res);});proxy.on('error',()=>{res.writeHead(502);res.end('Start the Next app on port 3114 first.');});req.pipe(proxy);return;}
  try{
   const jar=cookies(req);const config=await service.settings();let payload={};
   if(req.method==='POST'){if(req.headers.origin!==origin)throw new security.VotingError('Invalid origin',403);let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>100000)throw new security.VotingError('Request too large');}payload=JSON.parse(raw||'{}');}
   if(path.endsWith('/join')){
    if(!security.equal(String(payload.password||''),config.password))throw new security.VotingError('Use password demo for this local demo.',401);
    const name=security.text(payload.name,'name',100);
    const old=security.readIdentity(jar.csc_voting)||security.readIdentity(jar.csc_voting_device,'device');
    const identity=await claimIdentity(config,name,old);
    res.setHeader('Set-Cookie',[
     'csc_voting='+security.signIdentity(identity)+'; HttpOnly; SameSite=Strict; Path=/api/voting',
     'csc_voting_device='+security.signIdentity(identity,{purpose:'device',ttlMs:365*86400000})+'; HttpOnly; SameSite=Strict; Path=/api/voting; Max-Age=31536000']);
    return json(res,{ok:true});
   }
   if(path.endsWith('/logout')){res.setHeader('Set-Cookie','csc_voting=; HttpOnly; SameSite=Strict; Path=/api/voting; Max-Age=0');return json(res,{ok:true});}
   const admitted=service.authorize(security.readIdentity(jar.csc_voting),config);const identity=await canonicalIdentity(config,admitted);
   if(path.endsWith('/state'))return json(res,await service.getState(config,identity));
   if(path.endsWith('/admin')){service.authorize(identity,config,true);return json(res,await service.adminAction(config,identity,payload));}
   if(path.endsWith('/submit'))return json(res,await service.submit(config,identity,payload));
   return json(res,{error:'Not found'},404);
  }catch(error){json(res,{error:error.message},error.status||500);}
 }).listen(3115,'127.0.0.1',()=>console.log('Local demo: http://localhost:3115/demo | password: demo | No Google Sheets access'));
})().catch(error=>{console.error(error.message);process.exitCode=1;});
