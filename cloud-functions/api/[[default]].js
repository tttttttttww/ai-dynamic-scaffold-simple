import { getStore } from '@edgeone/pages-blob';
import { randomUUID, createHash } from 'node:crypto';

const JSON_HEADERS = {'Content-Type':'application/json; charset=UTF-8','Cache-Control':'no-store'};
const TASKS = Object.freeze([
  {id:'task1', label:'任务1'},
  {id:'task2', label:'任务2'},
  {id:'task3', label:'任务3'},
]);
const TEST_ACCOUNT = Object.freeze({studentName:'测试', testCode:'S00', isTest:true});

function json(data,status=200){ return new Response(JSON.stringify(data),{status,headers:JSON_HEADERS}); }
function envOf(context,key,fallback=''){ return context?.env?.[key] || process.env[key] || fallback; }
function runId(context){ return String(envOf(context,'EXPERIMENT_RUN_ID','default')).replace(/[^A-Za-z0-9_-]/g,'_').slice(0,80)||'default'; }
function basePrefix(context){ return `runs/${runId(context)}`; }
function storeOf(context){ return getStore({name:envOf(context,'DATA_STORE_NAME','ai-dynamic-scaffold-data'),consistency:'strong'}); }
function normalizeName(v){ return String(v||'').trim().replace(/\s+/g,' ').slice(0,40); }
function safeId(v=''){ return String(v).replace(/[^A-Za-z0-9_-]/g,''); }
function studentKeyOfName(name){ return createHash('sha256').update(`name\0${normalizeName(name)}`).digest('hex').slice(0,24); }
function isTestName(v){ const n=normalizeName(v).toUpperCase(); return n==='测试' || n==='S00'; }
function testAccount(){ return {...TEST_ACCOUNT,studentKey:studentKeyOfName(TEST_ACCOUNT.studentName)}; }
function taskById(id){ return TASKS.find(t=>t.id===id) || null; }
function taskBase(context,studentKey,taskId){ return `${basePrefix(context)}/students/${studentKey}/tasks/${taskId}`; }
function rosterKey(context){ return `${basePrefix(context)}/roster.json`; }
function taskStateKey(context){ return `${basePrefix(context)}/task-state.json`; }
function profileKey(context,studentKey){ return `${basePrefix(context)}/students/${studentKey}/profile.json`; }
function sessionKey(context,studentKey,taskId){ return `${taskBase(context,studentKey,taskId)}/session.json`; }

async function getJson(store,key){ return await store.get(key,{type:'json',consistency:'strong'}); }
async function putJson(store,key,data){ await store.setJSON(key,data); }

async function getTaskState(store,context){
  const state=await getJson(store,taskStateKey(context));
  const active=taskById(state?.activeTaskId) || TASKS[0];
  return {activeTaskId:active.id,activeTask:active,switchedAt:state?.switchedAt||null,tasks:TASKS};
}
async function setActiveTask(store,context,taskId){
  const task=taskById(taskId); if(!task) throw new Error('任务无效。');
  const data={activeTaskId:task.id,switchedAt:new Date().toISOString()};
  await putJson(store,taskStateKey(context),data);
  return {...data,activeTask:task,tasks:TASKS};
}
async function publicTaskState(context){ const store=storeOf(context); return json(await getTaskState(store,context)); }

async function getRoster(store,context){
  const r=await getJson(store,rosterKey(context));
  if(!r || !Array.isArray(r.students)) return {updatedAt:null,students:[]};
  // 兼容旧名单结构：只取姓名，重新按姓名生成 key。
  const seen=new Set(), students=[];
  for(const raw of r.students){
    const studentName=normalizeName(raw.studentName||raw.name);
    if(!studentName || isTestName(studentName) || seen.has(studentName)) continue;
    seen.add(studentName);
    students.push({studentKey:studentKeyOfName(studentName),studentName});
  }
  return {updatedAt:r.updatedAt||null,students};
}
async function saveRoster(store,context,students){
  const data={updatedAt:new Date().toISOString(),students};
  await putJson(store,rosterKey(context),data); return data;
}
function normalizeRosterRows(rows=[]){
  const out=[], seen=new Set();
  for(const raw of rows){
    const studentName=normalizeName(raw.studentName||raw.name||raw['姓名']);
    if(!studentName) continue;
    if(isTestName(studentName)) throw new Error('“测试 / S00”是系统内置测试账号，不需要放进正式名单。');
    if(seen.has(studentName)) throw new Error(`名单中存在重名：${studentName}。姓名登录无法区分，请先给重名学生添加可识别标记。`);
    seen.add(studentName);
    out.push({studentKey:studentKeyOfName(studentName),studentName});
  }
  if(!out.length) throw new Error('名单中没有可用学生，请检查“姓名”列。');
  if(out.length>500) throw new Error('单次名单最多支持 500 名学生。');
  return out;
}
async function findStudent(store,context,{studentKey='',studentName=''}){
  if(isTestName(studentName) || studentKey===testAccount().studentKey) return testAccount();
  const roster=await getRoster(store,context);
  let entry=studentKey ? roster.students.find(s=>s.studentKey===studentKey) : null;
  if(!entry && studentName){ const n=normalizeName(studentName); entry=roster.students.find(s=>s.studentName===n); }
  if(!entry) return null;
  if(studentName && entry.studentName!==normalizeName(studentName)) return null;
  return entry;
}

async function getProfile(store,context,studentKey){ return await getJson(store,profileKey(context,studentKey)); }
async function saveProfile(store,context,profile){ await putJson(store,profileKey(context,profile.studentKey),profile); }
async function getSession(store,context,studentKey,taskId){ return await getJson(store,sessionKey(context,studentKey,taskId)); }
async function saveSession(store,context,studentKey,taskId,session){ await putJson(store,sessionKey(context,studentKey,taskId),session); }
async function listMessages(store,context,studentKey,taskId){
  const prefix=`${taskBase(context,studentKey,taskId)}/messages/`;
  const {blobs=[]}=await store.list({prefix,consistency:'strong'}), rows=[];
  for(const b of blobs){ if(!b.key.endsWith('.json')) continue; const m=await getJson(store,b.key); if(m) rows.push(m); }
  rows.sort((a,b)=>String(a.createdAt).localeCompare(String(b.createdAt))||String(a.messageId).localeCompare(String(b.messageId)));
  return rows;
}
async function saveMessage(store,context,studentKey,taskId,message){
  const ts=Date.now();
  await putJson(store,`${taskBase(context,studentKey,taskId)}/messages/${String(ts).padStart(13,'0')}-${message.messageId}.json`,message);
}
function emptyTaskStats(){ return Object.fromEntries(TASKS.map(t=>[t.id,{messageCount:0,updatedAt:null,conversationId:''}])); }
function normalizeProfileTaskStats(profile){
  const stats=emptyTaskStats();
  for(const t of TASKS){ if(profile?.taskStats?.[t.id]) stats[t.id]={...stats[t.id],...profile.taskStats[t.id]}; }
  return stats;
}
async function ensureProfile(store,context,entry){
  const now=new Date().toISOString(); let p=await getProfile(store,context,entry.studentKey);
  if(!p){ p={studentKey:entry.studentKey,studentName:entry.studentName,isTest:!!entry.isTest,testCode:entry.testCode||'',createdAt:now,updatedAt:now,taskStats:emptyTaskStats()}; }
  p.studentName=entry.studentName; p.isTest=!!entry.isTest; p.testCode=entry.testCode||p.testCode||''; p.taskStats=normalizeProfileTaskStats(p);
  await saveProfile(store,context,p); return p;
}
async function ensureTaskSession(store,context,entry,task){
  const now=new Date().toISOString(); let s=await getSession(store,context,entry.studentKey,task.id);
  if(!s){ s={studentKey:entry.studentKey,studentName:entry.studentName,taskId:task.id,taskLabel:task.label,conversationId:'',createdAt:now,updatedAt:now,messageCount:0}; await saveSession(store,context,entry.studentKey,task.id,s); }
  return s;
}

async function startStudent(context){
  const store=storeOf(context), body=await context.request.json().catch(()=>({})), studentName=normalizeName(body.studentName);
  if(!studentName) return json({error:'请输入姓名。'},400);
  let entry;
  if(isTestName(studentName)) entry=testAccount();
  else {
    const roster=await getRoster(store,context);
    if(!roster.students.length) return json({error:'老师尚未上传学生名单，请联系老师。'},503);
    entry=roster.students.find(s=>s.studentName===studentName);
    if(!entry) return json({error:'名单中没有找到这个姓名，请检查后重新输入。'},403);
  }
  const taskState=await getTaskState(store,context), task=taskState.activeTask;
  const profile=await ensureProfile(store,context,entry), session=await ensureTaskSession(store,context,entry,task);
  const messages=(await listMessages(store,context,entry.studentKey,task.id)).filter(m=>m.role==='user'||m.role==='assistant');
  const hasInitialImage=messages.some(m=>m.role==='user' && !!m.imageId);
  return json({studentKey:entry.studentKey,studentName:entry.studentName,isTest:!!entry.isTest,testCode:entry.testCode||'',taskId:task.id,taskLabel:task.label,conversationId:session.conversationId||'',requiresInitialImage:!hasInitialImage,messages:messages.slice(-200),profileUpdatedAt:profile.updatedAt});
}

async function uploadToCoze(token,image,filename){
  const buf=await image.arrayBuffer(), form=new FormData(), type=image.type||'application/octet-stream';
  form.append('file',new Blob([buf],{type}),filename||'image.png');
  const res=await fetch('https://api.coze.cn/v1/files/upload',{method:'POST',headers:{Authorization:`Bearer ${token}`},body:form});
  const data=await res.json().catch(()=>({}));
  if(!res.ok||data.code!==0||!data.data?.id) throw new Error(data.msg||`扣子图片上传失败（HTTP ${res.status}）`);
  return {fileId:String(data.data.id),arrayBuffer:buf,contentType:type};
}
async function startCozeChat({token,botId,userId,message,fileId,conversationId,meta}){
  let content=message, contentType='text';
  if(fileId){ const parts=[{type:'image',file_id:fileId}]; if(message) parts.push({type:'text',text:message}); content=JSON.stringify(parts); contentType='object_string'; }
  const payload={bot_id:botId,user_id:userId,stream:false,auto_save_history:true,additional_messages:[{role:'user',type:'question',content,content_type:contentType}],meta_data:meta};
  const suffix=conversationId?`?conversation_id=${encodeURIComponent(conversationId)}`:'';
  const res=await fetch(`https://api.coze.cn/v3/chat${suffix}`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(payload)});
  const data=await res.json().catch(()=>({}));
  if(!res.ok||data.code!==0||!data.data?.id||!data.data?.conversation_id) throw new Error(data.msg||`扣子发起对话失败（HTTP ${res.status}）`);
  return {chatId:String(data.data.id),conversationId:String(data.data.conversation_id)};
}
async function getCozeStatus(token,conversationId,chatId){
  const res=await fetch(`https://api.coze.cn/v3/chat/retrieve?conversation_id=${encodeURIComponent(conversationId)}&chat_id=${encodeURIComponent(chatId)}`,{headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'}});
  const data=await res.json().catch(()=>({}));
  if(!res.ok||data.code!==0) throw new Error(data.msg||`查询扣子对话状态失败（HTTP ${res.status}）`);
  const status=String(data.data?.status||'');
  if(status==='failed') throw new Error(data.data?.last_error?.msg||'扣子智能体执行失败');
  if(status==='requires_action') throw new Error('智能体当前需要额外工具操作。');
  if(status==='canceled') throw new Error('扣子对话已取消');
  return status||'in_progress';
}
async function getCozeAnswer(token,conversationId,chatId){
  const res=await fetch(`https://api.coze.cn/v3/chat/message/list?conversation_id=${encodeURIComponent(conversationId)}&chat_id=${encodeURIComponent(chatId)}`,{headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'}});
  const data=await res.json().catch(()=>({}));
  if(!res.ok||data.code!==0||!Array.isArray(data.data)) throw new Error(data.msg||'读取扣子回复失败');
  const parts=data.data.filter(m=>m.role==='assistant'&&m.type==='answer'&&(!m.chat_id||String(m.chat_id)===chatId)).map(m=>String(m.content||'')).filter(Boolean);
  if(!parts.length) throw new Error('AI 已完成处理，但没有返回 answer 消息。');
  return parts.join('\n').trim();
}

async function updateActivity(store,context,entry,taskId,conversationId,at,delta=1){
  const profile=await ensureProfile(store,context,entry), stats=normalizeProfileTaskStats(profile);
  stats[taskId]={...stats[taskId],messageCount:Number(stats[taskId]?.messageCount||0)+delta,updatedAt:at,conversationId:conversationId||stats[taskId]?.conversationId||''};
  profile.taskStats=stats; profile.updatedAt=at; await saveProfile(store,context,profile);
  let session=await getSession(store,context,entry.studentKey,taskId) || {studentKey:entry.studentKey,studentName:entry.studentName,taskId,taskLabel:taskById(taskId)?.label||taskId,createdAt:at,messageCount:0,conversationId:''};
  session.studentName=entry.studentName; session.updatedAt=at; session.messageCount=Number(session.messageCount||0)+delta; if(conversationId) session.conversationId=conversationId;
  await saveSession(store,context,entry.studentKey,taskId,session);
}

async function chat(context){
  const token=envOf(context,'COZE_ACCESS_TOKEN'), botId=envOf(context,'COZE_BOT_ID');
  if(!token||!botId) return json({error:'服务器尚未配置 COZE_ACCESS_TOKEN / COZE_BOT_ID。'},500);
  const store=storeOf(context), form=await context.request.formData();
  const studentKey=safeId(form.get('studentKey')||''), studentName=normalizeName(form.get('studentName')), taskId=safeId(form.get('taskId')||'');
  const message=String(form.get('message')||'').trim().slice(0,8000), requestedConversationId=String(form.get('conversationId')||'').trim(), image=form.get('image');
  if(!studentKey||!studentName||!taskById(taskId)) return json({error:'学生或任务信息无效，请重新进入。'},400);
  const entry=await findStudent(store,context,{studentKey,studentName}); if(!entry||entry.studentKey!==studentKey) return json({error:'当前学生不在名单中，请重新进入。'},403);
  const current=await getTaskState(store,context);
  if(current.activeTaskId!==taskId) return json({error:`老师已切换到${current.activeTask.label}，页面即将更新。`,activeTask:current.activeTask},409);
  const session=await ensureTaskSession(store,context,entry,current.activeTask);
  const hasImage=image&&typeof image.arrayBuffer==='function'&&Number(image.size||0)>0;
  const existingMessages=await listMessages(store,context,studentKey,taskId);
  const hasInitialImage=existingMessages.some(m=>m.role==='user' && !!m.imageId);
  if(!hasInitialImage && !hasImage) return json({error:'本任务第一次提交请先上传作品图片。',requiresInitialImage:true},400);
  if(!message&&!hasImage) return json({error:'请输入文字或上传图片。'},400);
  if(hasImage&&Number(image.size)>10*1024*1024) return json({error:'图片不能超过 10 MB。'},413);
  if(hasImage&&image.type&&!String(image.type).startsWith('image/')) return json({error:'仅支持图片文件。'},415);

  let imageId='',cozeFileId='';
  try{
    if(hasImage){
      const up=await uploadToCoze(token,image,image.name||'image.png'); cozeFileId=up.fileId; imageId=randomUUID();
      const prefix=`${taskBase(context,studentKey,taskId)}/images/${imageId}`;
      await store.set(`${prefix}.bin`,up.arrayBuffer); await putJson(store,`${prefix}.json`,{imageId,fileName:image.name||'image.png',contentType:up.contentType,bytes:Number(image.size||0),cozeFileId,createdAt:new Date().toISOString()});
    }
    const createdAt=new Date().toISOString(), conversationId=requestedConversationId||session.conversationId||'';
    const chatStart=await startCozeChat({token,botId,userId:`u_${studentKey}_${taskId}`,message,fileId:cozeFileId,conversationId,meta:{student_key:studentKey,student_name:entry.studentName,task_id:taskId,task_label:current.activeTask.label}});
    await saveMessage(store,context,studentKey,taskId,{messageId:randomUUID(),studentKey,studentName:entry.studentName,taskId,taskLabel:current.activeTask.label,role:'user',text:message||'（上传了一张图片）',imageId:imageId||null,createdAt,conversationId:chatStart.conversationId,chatId:chatStart.chatId});
    await updateActivity(store,context,entry,taskId,chatStart.conversationId,createdAt,1);
    return json({status:'pending',taskId,taskLabel:current.activeTask.label,conversationId:chatStart.conversationId,chatId:chatStart.chatId,createdAt});
  }catch(e){
    await saveMessage(store,context,studentKey,taskId,{messageId:randomUUID(),studentKey,studentName:entry.studentName,taskId,taskLabel:taskById(taskId)?.label||taskId,role:'system_error',text:String(e?.message||e),imageId:imageId||null,createdAt:new Date().toISOString(),conversationId:requestedConversationId||session.conversationId||'',chatId:''}).catch(()=>{});
    return json({error:String(e?.message||'AI 请求失败')},502);
  }
}

async function chatStatus(context){
  const token=envOf(context,'COZE_ACCESS_TOKEN'); if(!token) return json({error:'服务器尚未配置 COZE_ACCESS_TOKEN。'},500);
  const store=storeOf(context), url=new URL(context.request.url);
  const studentKey=safeId(url.searchParams.get('studentKey')||''), studentName=normalizeName(url.searchParams.get('studentName')), taskId=safeId(url.searchParams.get('taskId')||'');
  const conversationId=String(url.searchParams.get('conversationId')||'').trim(), chatId=String(url.searchParams.get('chatId')||'').trim();
  if(!studentKey||!studentName||!taskById(taskId)||!conversationId||!chatId) return json({error:'查询参数不完整。'},400);
  const entry=await findStudent(store,context,{studentKey,studentName}); if(!entry||entry.studentKey!==studentKey) return json({error:'当前学生信息无效，请重新进入。'},403);
  try{
    const status=await getCozeStatus(token,conversationId,chatId); if(status!=='completed') return json({status});
    const messages=await listMessages(store,context,studentKey,taskId), existing=messages.find(m=>m.role==='assistant'&&String(m.chatId||'')===chatId);
    if(existing) return json({status:'completed',answer:existing.text,taskId,conversationId,chatId,createdAt:existing.createdAt});
    const answer=await getCozeAnswer(token,conversationId,chatId), answerAt=new Date().toISOString(), task=taskById(taskId);
    await saveMessage(store,context,studentKey,taskId,{messageId:randomUUID(),studentKey,studentName:entry.studentName,taskId,taskLabel:task.label,role:'assistant',text:answer,imageId:null,createdAt:answerAt,conversationId,chatId});
    await updateActivity(store,context,entry,taskId,conversationId,answerAt,1);
    return json({status:'completed',answer,taskId,conversationId,chatId,createdAt:answerAt});
  }catch(e){
    await saveMessage(store,context,studentKey,taskId,{messageId:randomUUID(),studentKey,studentName:entry.studentName,taskId,taskLabel:taskById(taskId)?.label||taskId,role:'system_error',text:String(e?.message||e),imageId:null,createdAt:new Date().toISOString(),conversationId,chatId}).catch(()=>{});
    return json({status:'failed',error:String(e?.message||'AI 请求失败')},502);
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
  const auth=context.request.headers.get('Authorization')||'', token=auth.startsWith('Bearer ')?safeId(auth.slice(7)):''; if(!token) return null;
  const store=storeOf(context), key=`${basePrefix(context)}/admin-sessions/${token}.json`, session=await getJson(store,key);
  if(!session||Number(session.expiresAt||0)<Date.now()){ if(session) await store.delete(key).catch(()=>{}); return null; }
  return {token,store};
}
async function adminLogout(context){ const auth=await authAdmin(context); if(!auth) return json({ok:true}); await auth.store.delete(`${basePrefix(context)}/admin-sessions/${auth.token}.json`).catch(()=>{}); return json({ok:true}); }

async function adminTaskGet(context){ const auth=await authAdmin(context); if(!auth) return json({error:'未登录。'},401); return json(await getTaskState(auth.store,context)); }
async function adminTaskSet(context){
  const auth=await authAdmin(context); if(!auth) return json({error:'未登录。'},401);
  const body=await context.request.json().catch(()=>({})), taskId=safeId(body.taskId||'');
  try{ return json(await setActiveTask(auth.store,context,taskId)); }catch(e){ return json({error:e.message},400); }
}
async function listProfiles(store,context){
  const prefix=`${basePrefix(context)}/students/`, {blobs=[]}=await store.list({prefix,consistency:'strong'}), profiles=[];
  for(const b of blobs){ if(!b.key.endsWith('/profile.json')) continue; const p=await getJson(store,b.key); if(p) profiles.push(p); }
  return profiles;
}
async function combinedStudents(store,context){
  const roster=await getRoster(store,context), profiles=await listProfiles(store,context), pmap=new Map(profiles.map(p=>[p.studentKey,p]));
  const rows=roster.students.map(r=>{
    const p=pmap.get(r.studentKey); pmap.delete(r.studentKey);
    return {...r,isTest:false,createdAt:p?.createdAt||null,updatedAt:p?.updatedAt||null,taskStats:normalizeProfileTaskStats(p),hasEntered:!!p,inRoster:true};
  });
  const test=testAccount(), tp=pmap.get(test.studentKey); if(tp) pmap.delete(test.studentKey);
  rows.unshift({...test,createdAt:tp?.createdAt||null,updatedAt:tp?.updatedAt||null,taskStats:normalizeProfileTaskStats(tp),hasEntered:!!tp,inRoster:false});
  for(const p of pmap.values()) rows.push({...p,studentName:p.studentName||'历史数据',taskStats:normalizeProfileTaskStats(p),hasEntered:true,inRoster:false,isTest:!!p.isTest});
  rows.sort((a,b)=>{ if(!!a.isTest!==!!b.isTest) return a.isTest?-1:1; return String(a.studentName).localeCompare(String(b.studentName),'zh-CN'); });
  return {rows,roster};
}
async function adminStudents(context){
  const auth=await authAdmin(context); if(!auth) return json({error:'未登录。'},401);
  const {rows,roster}=await combinedStudents(auth.store,context), taskState=await getTaskState(auth.store,context);
  return json({students:rows,rosterCount:roster.students.length,enteredCount:rows.filter(s=>!s.isTest&&s.inRoster&&s.hasEntered).length,rosterUpdatedAt:roster.updatedAt,...taskState});
}
async function adminRosterGet(context){ const auth=await authAdmin(context); if(!auth) return json({error:'未登录。'},401); return json(await getRoster(auth.store,context)); }
async function adminRosterSave(context){
  const auth=await authAdmin(context); if(!auth) return json({error:'未登录。'},401);
  const body=await context.request.json().catch(()=>({})); if(!Array.isArray(body.students)) return json({error:'名单格式无效。'},400);
  let students; try{ students=normalizeRosterRows(body.students); }catch(e){ return json({error:e.message},400); }
  const saved=await saveRoster(auth.store,context,students); return json({ok:true,count:students.length,updatedAt:saved.updatedAt});
}
async function adminStudent(context){
  const auth=await authAdmin(context); if(!auth) return json({error:'未登录。'},401);
  const url=new URL(context.request.url), studentKey=safeId(url.searchParams.get('studentKey')||''), requestedTask=safeId(url.searchParams.get('taskId')||'');
  if(!studentKey) return json({error:'学生参数无效。'},400);
  const {rows}=await combinedStudents(auth.store,context), row=rows.find(s=>s.studentKey===studentKey); if(!row) return json({error:'没有该学生。'},404);
  const taskState=await getTaskState(auth.store,context), selectedTask=taskById(requestedTask)||taskState.activeTask;
  const messages=(await listMessages(auth.store,context,studentKey,selectedTask.id)).filter(m=>m.role!=='system_error');
  const taskSummaries=[];
  for(const t of TASKS){
    const session=await getSession(auth.store,context,studentKey,t.id);
    taskSummaries.push({id:t.id,label:t.label,messageCount:Number(session?.messageCount||row.taskStats?.[t.id]?.messageCount||0),updatedAt:session?.updatedAt||row.taskStats?.[t.id]?.updatedAt||null,conversationId:session?.conversationId||row.taskStats?.[t.id]?.conversationId||'',hasStarted:!!session||Number(row.taskStats?.[t.id]?.messageCount||0)>0});
  }
  return json({profile:row,selectedTask,activeTask:taskState.activeTask,tasks:taskSummaries,messages});
}
async function adminImage(context){
  const auth=await authAdmin(context); if(!auth) return json({error:'未登录。'},401);
  const url=new URL(context.request.url), studentKey=safeId(url.searchParams.get('studentKey')||''), taskId=safeId(url.searchParams.get('taskId')||''), imageId=safeId(url.searchParams.get('imageId')||'');
  if(!studentKey||!taskById(taskId)||!imageId) return json({error:'参数无效。'},400);
  const prefix=`${taskBase(context,studentKey,taskId)}/images/${imageId}`, meta=await getJson(auth.store,`${prefix}.json`), buf=await auth.store.get(`${prefix}.bin`,{type:'arrayBuffer',consistency:'strong'});
  if(!meta||!buf) return json({error:'图片不存在。'},404);
  return new Response(buf,{headers:{'Content-Type':meta.contentType||'application/octet-stream','Cache-Control':'private, max-age=300'}});
}
function csvCell(v){ const s=String(v??''); return /[",\n\r]/.test(s)?`"${s.replaceAll('"','""')}"`:s; }
async function adminExport(context){
  const auth=await authAdmin(context); if(!auth) return json({error:'未登录。'},401);
  const url=new URL(context.request.url), format=(url.searchParams.get('format')||'json').toLowerCase(), includeTest=url.searchParams.get('includeTest')==='1';
  const {rows}=await combinedStudents(auth.store,context), out=[];
  for(const p of rows){
    if(p.isTest&&!includeTest) continue;
    const taskData=[];
    for(const t of TASKS){ taskData.push({task:t,messages:(await listMessages(auth.store,context,p.studentKey,t.id)).filter(m=>m.role!=='system_error')}); }
    out.push({profile:p,tasks:taskData});
  }
  if(format==='csv'){
    const head=['student_name','is_test','task_id','task_label','message_id','role','text','has_image','image_id','created_at','conversation_id','chat_id'], lines=[head.join(',')];
    for(const row of out){ for(const td of row.tasks){ for(const m of td.messages){ lines.push([row.profile.studentName,row.profile.isTest?1:0,td.task.id,td.task.label,m.messageId,m.role,m.text,m.imageId?1:0,m.imageId||'',m.createdAt,m.conversationId||'',m.chatId||''].map(csvCell).join(',')); } } }
    return new Response('\uFEFF'+lines.join('\r\n'),{headers:{'Content-Type':'text/csv; charset=UTF-8','Content-Disposition':'attachment; filename="ai-dynamic-scaffold.csv"','Cache-Control':'no-store'}});
  }
  return new Response(JSON.stringify({exportedAt:new Date().toISOString(),experimentRunId:runId(context),tasks:TASKS,students:out},null,2),{headers:{'Content-Type':'application/json; charset=UTF-8','Content-Disposition':'attachment; filename="ai-dynamic-scaffold.json"','Cache-Control':'no-store'}});
}

export default async function onRequest(context){
  const url=new URL(context.request.url); let path=url.pathname; if(path.startsWith('/api/')) path=path.slice(5); else if(path==='/api') path='';
  try{
    if(path==='task/current'&&context.request.method==='GET') return await publicTaskState(context);
    if(path==='student/start'&&context.request.method==='POST') return await startStudent(context);
    if(path==='chat'&&context.request.method==='POST') return await chat(context);
    if(path==='chat/status'&&context.request.method==='GET') return await chatStatus(context);
    if(path==='admin/login'&&context.request.method==='POST') return await adminLogin(context);
    if(path==='admin/logout'&&context.request.method==='POST') return await adminLogout(context);
    if(path==='admin/task'&&context.request.method==='GET') return await adminTaskGet(context);
    if(path==='admin/task'&&context.request.method==='POST') return await adminTaskSet(context);
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
