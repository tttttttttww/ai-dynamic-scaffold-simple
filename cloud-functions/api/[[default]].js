import { getStore } from '@edgeone/pages-blob';
import { randomUUID, createHash } from 'node:crypto';

const JSON_HEADERS = {'Content-Type':'application/json; charset=UTF-8', 'Cache-Control':'no-store'};

function json(data, status=200) { return new Response(JSON.stringify(data), {status, headers:JSON_HEADERS}); }
function envOf(context, key, fallback='') { return context?.env?.[key] || process.env[key] || fallback; }
function runId(context) { return String(envOf(context,'EXPERIMENT_RUN_ID','default')).replace(/[^A-Za-z0-9_-]/g,'_').slice(0,80) || 'default'; }
function basePrefix(context) { return `runs/${runId(context)}`; }
function storeOf(context) { return getStore({name:envOf(context,'DATA_STORE_NAME','ai-dynamic-scaffold-data'), consistency:'strong'}); }
function normalizeName(v) { return String(v || '').trim().replace(/\s+/g,' ').slice(0,40); }
function normalizeClass(v) { return String(v || '').trim().replace(/\s+/g,' ').slice(0,60); }
function normalizeStudentId(v) { return String(v || '').trim().replace(/\s+/g,'').slice(0,40); }
function safeId(v='') { return String(v).replace(/[^A-Za-z0-9_-]/g,''); }
function sleep(ms) { return new Promise(r=>setTimeout(r,ms)); }
function studentKeyOf(className, studentId) { return createHash('sha256').update(`${normalizeClass(className)}\0${normalizeStudentId(studentId)}`).digest('hex').slice(0,24); }

const TEST_ACCOUNT = Object.freeze({
  className:'测试',
  studentId:'S00',
  studentName:'测试',
});
function testAccount() {
  return {
    ...TEST_ACCOUNT,
    studentKey: studentKeyOf(TEST_ACCOUNT.className, TEST_ACCOUNT.studentId),
    isTest: true
  };
}
function isTestIdentity(className, studentId, studentName='') {
  return normalizeClass(className) === TEST_ACCOUNT.className
    && normalizeStudentId(studentId).toUpperCase() === TEST_ACCOUNT.studentId
    && (!studentName || normalizeName(studentName) === TEST_ACCOUNT.studentName);
}

async function getJson(store,key) { return await store.get(key,{type:'json',consistency:'strong'}); }
async function putJson(store,key,data) { await store.setJSON(key,data); }
function rosterKey(context) { return `${basePrefix(context)}/roster.json`; }

async function getRoster(store, context) {
  const r = await getJson(store, rosterKey(context));
  if (!r || !Array.isArray(r.students)) return {updatedAt:null, students:[]};
  return r;
}
async function saveRoster(store, context, students) {
  const data={updatedAt:new Date().toISOString(), students};
  await putJson(store, rosterKey(context), data);
  return data;
}
function normalizeRosterRows(rows=[]) {
  const out=[]; const seen=new Set();
  for (const raw of rows) {
    const className=normalizeClass(raw.className);
    const studentId=normalizeStudentId(raw.studentId);
    const studentName=normalizeName(raw.studentName);
    if (!className || !studentId || !studentName) continue;
    if (isTestIdentity(className,studentId)) throw new Error('“测试 / S00 / 测试”是系统内置测试账号，不需要放进正式名单。');
    const studentKey=studentKeyOf(className,studentId);
    if (seen.has(studentKey)) throw new Error(`名单中存在重复编号：${className} / ${studentId}`);
    seen.add(studentKey);
    out.push({studentKey,className,studentId,studentName});
  }
  if (!out.length) throw new Error('名单中没有可用学生，请检查“班级、学生编号、姓名”三列。');
  if (out.length > 2000) throw new Error('单次名单最多支持 2000 名学生。');
  return out;
}
async function findRosterEntry(store, context, {studentKey='', className='', studentId='', studentName=''}) {
  const test=testAccount();
  if (
    (studentKey && studentKey===test.studentKey)
    || isTestIdentity(className,studentId,studentName)
  ) {
    if (studentName && normalizeName(studentName)!==test.studentName) return null;
    return test;
  }
  const roster=await getRoster(store,context);
  let entry=null;
  if (studentKey) entry=roster.students.find(s=>s.studentKey===studentKey) || null;
  if (!entry) {
    const c=normalizeClass(className), id=normalizeStudentId(studentId);
    entry=roster.students.find(s=>s.className===c && s.studentId===id) || null;
  }
  if (!entry) return null;
  if (studentName && entry.studentName !== normalizeName(studentName)) return null;
  return entry;
}

async function listMessages(store, context, studentKey) {
  const prefix=`${basePrefix(context)}/students/${studentKey}/messages/`;
  const {blobs=[]}=await store.list({prefix,consistency:'strong'});
  const rows=[];
  for(const b of blobs){ if(!b.key.endsWith('.json')) continue; const m=await getJson(store,b.key); if(m) rows.push(m); }
  rows.sort((a,b)=>String(a.createdAt).localeCompare(String(b.createdAt)) || String(a.messageId).localeCompare(String(b.messageId)));
  return rows;
}
async function saveMessage(store, context, studentKey, message) {
  const ts=Date.now();
  await putJson(store, `${basePrefix(context)}/students/${studentKey}/messages/${String(ts).padStart(13,'0')}-${message.messageId}.json`, message);
}
async function getProfile(store, context, studentKey) { return await getJson(store,`${basePrefix(context)}/students/${studentKey}/profile.json`); }
async function saveProfile(store, context, profile) { await putJson(store,`${basePrefix(context)}/students/${profile.studentKey}/profile.json`,profile); }

async function publicClasses(context) {
  const store=storeOf(context); const roster=await getRoster(store,context);
  const formal=[...new Set(roster.students.map(s=>s.className).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'zh-CN'));
  const classes=[TEST_ACCOUNT.className, ...formal.filter(c=>c!==TEST_ACCOUNT.className)];
  return json({classes, rosterCount:roster.students.length, testAccount:{className:TEST_ACCOUNT.className,studentId:TEST_ACCOUNT.studentId,studentName:TEST_ACCOUNT.studentName}});
}

async function startStudent(context) {
  const store=storeOf(context);
  const body=await context.request.json().catch(()=>({}));
  const className=normalizeClass(body.className), studentId=normalizeStudentId(body.studentId), studentName=normalizeName(body.studentName);
  if (!className) return json({error:'请选择班级。'},400);
  if (!studentId) return json({error:'请输入学生编号。'},400);
  if (!studentName) return json({error:'请输入姓名。'},400);
  const roster=await getRoster(store,context);
  let entry=null;
  if (isTestIdentity(className,studentId,studentName)) {
    entry=testAccount();
  } else {
    if (!roster.students.length) return json({error:'教师尚未上传学生名单，请联系老师。'},503);
    entry=roster.students.find(s=>s.className===className && s.studentId===studentId);
    if (!entry || entry.studentName!==studentName) return json({error:'班级、编号或姓名不匹配，请检查后重新输入。'},403);
  }

  const now=new Date().toISOString();
  let profile=await getProfile(store,context,entry.studentKey);
  if(!profile){
    profile={studentKey:entry.studentKey,className:entry.className,studentId:entry.studentId,studentName:entry.studentName,isTest:!!entry.isTest,createdAt:now,updatedAt:now,messageCount:0,conversationId:''};
    await saveProfile(store,context,profile);
  } else {
    profile.className=entry.className; profile.studentId=entry.studentId; profile.studentName=entry.studentName; profile.isTest=!!entry.isTest;
    await saveProfile(store,context,profile);
  }
  const messages=(await listMessages(store,context,entry.studentKey)).filter(m=>m.role==='user'||m.role==='assistant');
  return json({studentKey:entry.studentKey,className:entry.className,studentId:entry.studentId,studentName:entry.studentName,isTest:!!entry.isTest,conversationId:profile.conversationId||'',messages:messages.slice(-100)});
}

async function uploadToCoze(token,image,filename){
  const buf=await image.arrayBuffer(); const form=new FormData(); const type=image.type||'application/octet-stream';
  form.append('file',new Blob([buf],{type}),filename||'image.png');
  const res=await fetch('https://api.coze.cn/v1/files/upload',{method:'POST',headers:{Authorization:`Bearer ${token}`},body:form});
  const data=await res.json().catch(()=>({}));
  if(!res.ok||data.code!==0||!data.data?.id) throw new Error(data.msg||`扣子图片上传失败（HTTP ${res.status}）`);
  return {fileId:String(data.data.id),arrayBuffer:buf,contentType:type};
}
async function startCozeChat({token,botId,userId,message,fileId,conversationId,meta}){
  let content=message, contentType='text';
  if(fileId){
    const parts=[{type:'image',file_id:fileId}];
    if(message) parts.push({type:'text',text:message});
    content=JSON.stringify(parts);
    contentType='object_string';
  }
  const payload={bot_id:botId,user_id:userId,stream:false,auto_save_history:true,additional_messages:[{role:'user',type:'question',content,content_type:contentType}],meta_data:meta};
  const suffix=conversationId?`?conversation_id=${encodeURIComponent(conversationId)}`:'';
  const res=await fetch(`https://api.coze.cn/v3/chat${suffix}`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(payload)});
  const data=await res.json().catch(()=>({}));
  if(!res.ok||data.code!==0||!data.data?.id||!data.data?.conversation_id) throw new Error(data.msg||`扣子发起对话失败（HTTP ${res.status}）`);
  return {chatId:String(data.data.id),conversationId:String(data.data.conversation_id)};
}
async function waitForCoze(token,conversationId,chatId){
  for(let i=0;i<45;i++){
    const res=await fetch(`https://api.coze.cn/v3/chat/retrieve?conversation_id=${encodeURIComponent(conversationId)}&chat_id=${encodeURIComponent(chatId)}`,{headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'}});
    const data=await res.json().catch(()=>({}));
    if(!res.ok||data.code!==0) throw new Error(data.msg||'查询扣子对话状态失败');
    const status=data.data?.status;
    if(status==='completed') return;
    if(status==='failed') throw new Error(data.data?.last_error?.msg||'扣子智能体执行失败');
    if(status==='requires_action') throw new Error('智能体当前需要额外工具操作，本简化版暂不处理 requires_action。');
    if(status==='canceled') throw new Error('扣子对话已取消');
    await sleep(1000);
  }
  throw new Error('AI 回复超时，请稍后重试。');
}
async function getCozeAnswer(token,conversationId,chatId){
  const res=await fetch(`https://api.coze.cn/v3/chat/message/list?conversation_id=${encodeURIComponent(conversationId)}&chat_id=${encodeURIComponent(chatId)}`,{headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'}});
  const data=await res.json().catch(()=>({}));
  if(!res.ok||data.code!==0||!Array.isArray(data.data)) throw new Error(data.msg||'读取扣子回复失败');
  const parts=data.data.filter(m=>m.role==='assistant'&&m.type==='answer'&&(!m.chat_id||String(m.chat_id)===chatId)).map(m=>String(m.content||'')).filter(Boolean);
  if(!parts.length) throw new Error('AI 已完成处理，但没有返回 answer 消息。');
  return parts.join('\n').trim();
}

async function chat(context){
  const token=envOf(context,'COZE_ACCESS_TOKEN'), botId=envOf(context,'COZE_BOT_ID');
  if(!token||!botId) return json({error:'服务器尚未配置 COZE_ACCESS_TOKEN / COZE_BOT_ID。'},500);
  const store=storeOf(context); const form=await context.request.formData();
  const studentKey=safeId(form.get('studentKey')||''), className=normalizeClass(form.get('className')), studentId=normalizeStudentId(form.get('studentId')), studentName=normalizeName(form.get('studentName'));
  const message=String(form.get('message')||'').trim().slice(0,8000), requestedConversationId=String(form.get('conversationId')||'').trim(), image=form.get('image');
  if(!studentKey||!className||!studentId||!studentName) return json({error:'学生信息无效，请重新进入。'},400);
  const entry=await findRosterEntry(store,context,{studentKey,className,studentId,studentName});
  if(!entry || entry.studentKey!==studentKey) return json({error:'当前学生信息不在名单中，请重新进入。'},403);
  const profile=await getProfile(store,context,studentKey);
  if(!profile) return json({error:'学生会话不存在，请重新进入。'},403);
  const hasImage=image&&typeof image.arrayBuffer==='function'&&Number(image.size||0)>0;
  if(!message&&!hasImage) return json({error:'请输入文字或上传图片。'},400);
  if(hasImage&&Number(image.size)>10*1024*1024) return json({error:'图片不能超过 10 MB。'},413);
  if(hasImage&&image.type&&!String(image.type).startsWith('image/')) return json({error:'仅支持图片文件。'},415);

  let imageId='',cozeFileId='';
  try{
    if(hasImage){
      const up=await uploadToCoze(token,image,image.name||'image.png'); cozeFileId=up.fileId; imageId=randomUUID();
      const imgKey=`${basePrefix(context)}/students/${studentKey}/images/${imageId}.bin`, metaKey=`${basePrefix(context)}/students/${studentKey}/images/${imageId}.json`;
      await store.set(imgKey,up.arrayBuffer); await putJson(store,metaKey,{imageId,fileName:image.name||'image.png',contentType:up.contentType,bytes:Number(image.size||0),cozeFileId,createdAt:new Date().toISOString()});
    }
    const createdAt=new Date().toISOString(), conversationId=requestedConversationId||profile.conversationId||'';
    const chatStart=await startCozeChat({token,botId,userId:`u_${studentKey}`,message,fileId:cozeFileId,conversationId,meta:{student_key:studentKey,class_name:className,student_id:studentId}});
    await saveMessage(store,context,studentKey,{messageId:randomUUID(),studentKey,className,studentId,studentName,role:'user',text:message||'（上传了一张图片）',imageId:imageId||null,createdAt,conversationId:chatStart.conversationId,chatId:chatStart.chatId});
    await waitForCoze(token,chatStart.conversationId,chatStart.chatId);
    const answer=await getCozeAnswer(token,chatStart.conversationId,chatStart.chatId), answerAt=new Date().toISOString();
    await saveMessage(store,context,studentKey,{messageId:randomUUID(),studentKey,className,studentId,studentName,role:'assistant',text:answer,imageId:null,createdAt:answerAt,conversationId:chatStart.conversationId,chatId:chatStart.chatId});
    const current=await getProfile(store,context,studentKey)||profile;
    Object.assign(current,{className,studentId,studentName,conversationId:chatStart.conversationId,updatedAt:answerAt,messageCount:Number(current.messageCount||0)+2});
    await saveProfile(store,context,current);
    return json({answer,conversationId:chatStart.conversationId,chatId:chatStart.chatId,createdAt:answerAt});
  }catch(e){
    await saveMessage(store,context,studentKey,{messageId:randomUUID(),studentKey,className,studentId,studentName,role:'system_error',text:String(e?.message||e),imageId:imageId||null,createdAt:new Date().toISOString(),conversationId:requestedConversationId||profile.conversationId||'',chatId:''}).catch(()=>{});
    return json({error:String(e?.message||'AI 请求失败')},502);
  }
}

async function adminLogin(context){
  const body=await context.request.json().catch(()=>({})), expected=envOf(context,'ADMIN_PASSWORD');
  if(!expected) return json({error:'服务器尚未配置 ADMIN_PASSWORD。'},500);
  if(String(body.password||'')!==expected) return json({error:'密码错误。'},401);
  const token=randomUUID().replaceAll('-','')+randomUUID().replaceAll('-',''), store=storeOf(context);
  await putJson(store,`${basePrefix(context)}/admin-sessions/${token}.json`,{createdAt:Date.now(),expiresAt:Date.now()+12*60*60*1000});
  return json({token});
}
async function authAdmin(context){
  const auth=context.request.headers.get('Authorization')||'', token=auth.startsWith('Bearer ')?safeId(auth.slice(7)):'';
  if(!token) return null;
  const store=storeOf(context), key=`${basePrefix(context)}/admin-sessions/${token}.json`, session=await getJson(store,key);
  if(!session||Number(session.expiresAt||0)<Date.now()){ if(session) await store.delete(key).catch(()=>{}); return null; }
  return {token,store};
}
async function adminLogout(context){ const auth=await authAdmin(context); if(!auth) return json({ok:true}); await auth.store.delete(`${basePrefix(context)}/admin-sessions/${auth.token}.json`).catch(()=>{}); return json({ok:true}); }

async function listProfiles(store,context){
  const prefix=`${basePrefix(context)}/students/`, {blobs=[]}=await store.list({prefix,consistency:'strong'}), keys=blobs.filter(b=>b.key.endsWith('/profile.json')).map(b=>b.key), profiles=[];
  for(const key of keys){ const p=await getJson(store,key); if(p) profiles.push(p); }
  return profiles;
}
async function combinedStudents(store,context){
  const roster=await getRoster(store,context), profiles=await listProfiles(store,context), pmap=new Map(profiles.map(p=>[p.studentKey,p]));
  const rows=roster.students.map(r=>{
    const p=pmap.get(r.studentKey); pmap.delete(r.studentKey);
    return {...r,isTest:false,createdAt:p?.createdAt||null,updatedAt:p?.updatedAt||null,messageCount:Number(p?.messageCount||0),conversationId:p?.conversationId||'',hasEntered:!!p,inRoster:true};
  });

  const test=testAccount(), tp=pmap.get(test.studentKey);
  if (tp) pmap.delete(test.studentKey);
  rows.unshift({...test,createdAt:tp?.createdAt||null,updatedAt:tp?.updatedAt||null,messageCount:Number(tp?.messageCount||0),conversationId:tp?.conversationId||'',hasEntered:!!tp,inRoster:false});

  for(const p of pmap.values()) rows.push({...p,className:p.className||'历史数据',studentId:p.studentId||p.studentKey,studentName:p.studentName||'—',hasEntered:true,inRoster:false,isTest:!!p.isTest});
  rows.sort((a,b)=>{
    if (!!a.isTest !== !!b.isTest) return a.isTest ? -1 : 1;
    return String(a.className).localeCompare(String(b.className),'zh-CN')||String(a.studentId).localeCompare(String(b.studentId),'zh-CN',{numeric:true});
  });
  return {rows,roster};
}
async function adminStudents(context){
  const auth=await authAdmin(context); if(!auth) return json({error:'未登录。'},401);
  const {rows,roster}=await combinedStudents(auth.store,context);
  const formal=[...new Set(roster.students.map(s=>s.className))].sort((a,b)=>a.localeCompare(b,'zh-CN'));
  const classes=[TEST_ACCOUNT.className,...formal.filter(c=>c!==TEST_ACCOUNT.className)];
  return json({students:rows,classes,rosterCount:roster.students.length,classCount:formal.length,enteredCount:rows.filter(s=>!s.isTest&&s.inRoster&&s.hasEntered).length,rosterUpdatedAt:roster.updatedAt});
}
async function adminRosterGet(context){
  const auth=await authAdmin(context); if(!auth) return json({error:'未登录。'},401);
  const roster=await getRoster(auth.store,context); return json(roster);
}
async function adminRosterSave(context){
  const auth=await authAdmin(context); if(!auth) return json({error:'未登录。'},401);
  const body=await context.request.json().catch(()=>({}));
  if(!Array.isArray(body.students)) return json({error:'名单格式无效。'},400);
  let students; try{ students=normalizeRosterRows(body.students); }catch(e){ return json({error:e.message},400); }
  const saved=await saveRoster(auth.store,context,students);
  const classes=[...new Set(students.map(s=>s.className))];
  return json({ok:true,count:students.length,classCount:classes.length,updatedAt:saved.updatedAt});
}
async function adminStudent(context){
  const auth=await authAdmin(context); if(!auth) return json({error:'未登录。'},401);
  const url=new URL(context.request.url), studentKey=safeId(url.searchParams.get('studentKey')||'');
  if(!studentKey) return json({error:'学生参数无效。'},400);
  let profile=await getProfile(auth.store,context,studentKey);
  if(!profile){
    const test=testAccount();
    if(studentKey===test.studentKey) profile={...test,createdAt:null,updatedAt:null,messageCount:0,conversationId:'',hasEntered:false};
    else {
      const roster=await getRoster(auth.store,context), entry=roster.students.find(s=>s.studentKey===studentKey);
      if(!entry) return json({error:'没有该学生数据。'},404);
      profile={...entry,isTest:false,createdAt:null,updatedAt:null,messageCount:0,conversationId:'',hasEntered:false};
    }
  }
  const messages=(await listMessages(auth.store,context,studentKey)).filter(m=>m.role!=='system_error');
  return json({profile,messages});
}
async function adminImage(context){
  const auth=await authAdmin(context); if(!auth) return json({error:'未登录。'},401);
  const url=new URL(context.request.url), studentKey=safeId(url.searchParams.get('studentKey')||''), imageId=safeId(url.searchParams.get('imageId')||'');
  if(!studentKey||!imageId) return json({error:'参数无效。'},400);
  const prefix=`${basePrefix(context)}/students/${studentKey}/images/${imageId}`, meta=await getJson(auth.store,`${prefix}.json`), buf=await auth.store.get(`${prefix}.bin`,{type:'arrayBuffer',consistency:'strong'});
  if(!meta||!buf) return json({error:'图片不存在。'},404);
  return new Response(buf,{headers:{'Content-Type':meta.contentType||'application/octet-stream','Cache-Control':'private, max-age=300'}});
}
function csvCell(v){ const s=String(v??''); return /[",\n\r]/.test(s)?`"${s.replaceAll('"','""')}"`:s; }
async function adminExport(context){
  const auth=await authAdmin(context); if(!auth) return json({error:'未登录。'},401);
  const url=new URL(context.request.url), format=(url.searchParams.get('format')||'json').toLowerCase(), includeTest=url.searchParams.get('includeTest')==='1';
  const {rows}=await combinedStudents(auth.store,context), out=[];
  for(const p of rows){
    if(p.isTest && !includeTest) continue;
    const messages=await listMessages(auth.store,context,p.studentKey); out.push({profile:p,messages});
  }
  if(format==='csv'){
    const head=['class_name','student_id','student_name','in_roster','has_entered','message_id','role','text','has_image','image_id','created_at','conversation_id','chat_id'], lines=[head.join(',')];
    for(const row of out){ for(const m of row.messages){ if(m.role==='system_error') continue; lines.push([row.profile.className,row.profile.studentId,row.profile.studentName,row.profile.inRoster?1:0,row.profile.hasEntered?1:0,m.messageId,m.role,m.text,m.imageId?1:0,m.imageId||'',m.createdAt,m.conversationId||'',m.chatId||''].map(csvCell).join(',')); } }
    return new Response('\uFEFF'+lines.join('\r\n'),{headers:{'Content-Type':'text/csv; charset=UTF-8','Content-Disposition':'attachment; filename="ai-dynamic-scaffold.csv"','Cache-Control':'no-store'}});
  }
  return new Response(JSON.stringify({exportedAt:new Date().toISOString(),experimentRunId:runId(context),students:out},null,2),{headers:{'Content-Type':'application/json; charset=UTF-8','Content-Disposition':'attachment; filename="ai-dynamic-scaffold.json"','Cache-Control':'no-store'}});
}

export default async function onRequest(context){
  const url=new URL(context.request.url); let path=url.pathname; if(path.startsWith('/api/')) path=path.slice(5); else if(path==='/api') path='';
  try{
    if(path==='roster/classes'&&context.request.method==='GET') return await publicClasses(context);
    if(path==='student/start'&&context.request.method==='POST') return await startStudent(context);
    if(path==='chat'&&context.request.method==='POST') return await chat(context);
    if(path==='admin/login'&&context.request.method==='POST') return await adminLogin(context);
    if(path==='admin/logout'&&context.request.method==='POST') return await adminLogout(context);
    if(path==='admin/students'&&context.request.method==='GET') return await adminStudents(context);
    if(path==='admin/roster'&&context.request.method==='GET') return await adminRosterGet(context);
    if(path==='admin/roster'&&context.request.method==='POST') return await adminRosterSave(context);
    if(path==='admin/student'&&context.request.method==='GET') return await adminStudent(context);
    if(path==='admin/image'&&context.request.method==='GET') return await adminImage(context);
    if(path==='admin/export'&&context.request.method==='GET') return await adminExport(context);
    if(path==='health'&&context.request.method==='GET') return json({ok:true,runId:runId(context),configured:{cozeToken:!!envOf(context,'COZE_ACCESS_TOKEN'),botId:!!envOf(context,'COZE_BOT_ID'),adminPassword:!!envOf(context,'ADMIN_PASSWORD')}});
    return json({error:'API not found'},404);
  }catch(e){ console.error(e); return json({error:String(e?.message||'服务器错误')},500); }
}
