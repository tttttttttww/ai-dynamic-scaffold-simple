import { getStore } from '@edgeone/pages-blob';
import { randomUUID } from 'node:crypto';

const JSON_HEADERS = {'Content-Type':'application/json; charset=UTF-8', 'Cache-Control':'no-store'};

function json(data, status=200) {
  return new Response(JSON.stringify(data), {status, headers: JSON_HEADERS});
}
function envOf(context, key, fallback='') {
  return context?.env?.[key] || process.env[key] || fallback;
}
function runId(context) {
  return String(envOf(context, 'EXPERIMENT_RUN_ID', 'default')).replace(/[^A-Za-z0-9_-]/g, '_').slice(0,80) || 'default';
}
function basePrefix(context) { return `runs/${runId(context)}`; }
function storeOf(context) {
  const name = envOf(context, 'DATA_STORE_NAME', 'ai-dynamic-scaffold-data');
  return getStore({name, consistency:'strong'});
}
function studentIdOk(id) { return /^S(?:0[0-9]|[12][0-9]|30)$/.test(id); }
function normalizeName(name) { return String(name || '').trim().replace(/\s+/g, ' ').slice(0,20); }
function safeId(x='') { return String(x).replace(/[^A-Za-z0-9_-]/g,''); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function getJson(store, key) {
  return await store.get(key, {type:'json', consistency:'strong'});
}
async function putJson(store, key, data) { await store.setJSON(key, data); }

async function listMessages(store, context, studentId) {
  const prefix = `${basePrefix(context)}/students/${studentId}/messages/`;
  const {blobs=[]} = await store.list({prefix, consistency:'strong'});
  const rows = [];
  for (const b of blobs) {
    if (!b.key.endsWith('.json')) continue;
    const m = await getJson(store, b.key);
    if (m) rows.push(m);
  }
  rows.sort((a,b) => String(a.createdAt).localeCompare(String(b.createdAt)) || String(a.messageId).localeCompare(String(b.messageId)));
  return rows;
}

async function saveMessage(store, context, studentId, message) {
  const ts = Date.now();
  const key = `${basePrefix(context)}/students/${studentId}/messages/${String(ts).padStart(13,'0')}-${message.messageId}.json`;
  await putJson(store, key, message);
}

async function getProfile(store, context, studentId) {
  return await getJson(store, `${basePrefix(context)}/students/${studentId}/profile.json`);
}
async function saveProfile(store, context, profile) {
  await putJson(store, `${basePrefix(context)}/students/${profile.studentId}/profile.json`, profile);
}

async function startStudent(context) {
  const store = storeOf(context);
  const body = await context.request.json().catch(() => ({}));
  const studentId = String(body.studentId || '').trim().toUpperCase();
  const studentName = normalizeName(body.studentName);
  if (!studentIdOk(studentId)) return json({error:'学生编号应为 S00–S30。'}, 400);
  if (!studentName) return json({error:'请输入姓名。'}, 400);

  let profile = await getProfile(store, context, studentId);
  const now = new Date().toISOString();
  if (!profile) {
    profile = {studentId, studentName, isTest: studentId === 'S00', createdAt:now, updatedAt:now, messageCount:0, conversationId:''};
    await saveProfile(store, context, profile);
  } else if (normalizeName(profile.studentName) !== studentName) {
    return json({error:'该编号已经记录了其他姓名，请检查编号或联系老师。'}, 409);
  }
  const messages = (await listMessages(store, context, studentId)).filter(m => m.role === 'user' || m.role === 'assistant');
  return json({studentId, studentName, conversationId:profile.conversationId || '', messages:messages.slice(-100)});
}

async function uploadToCoze(token, image, filename) {
  const buf = await image.arrayBuffer();
  const form = new FormData();
  const type = image.type || 'application/octet-stream';
  form.append('file', new Blob([buf], {type}), filename || 'image.png');
  const res = await fetch('https://api.coze.cn/v1/files/upload', {
    method:'POST', headers:{Authorization:`Bearer ${token}`}, body:form
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.code !== 0 || !data.data?.id) {
    throw new Error(data.msg || `扣子图片上传失败（HTTP ${res.status}）`);
  }
  return {fileId:String(data.data.id), arrayBuffer:buf, contentType:type};
}

async function startCozeChat({token, botId, studentId, message, fileId, conversationId}) {
  let content = message;
  let contentType = 'text';
  if (fileId) {
    const text = message || '请根据这张图片继续帮助我。';
    content = JSON.stringify([{type:'image', file_id:fileId}, {type:'text', text}]);
    contentType = 'object_string';
  }
  const payload = {
    bot_id: botId,
    user_id: studentId,
    stream: false,
    auto_save_history: true,
    additional_messages: [{role:'user', type:'question', content, content_type:contentType}],
    meta_data: {student_id:studentId}
  };
  const suffix = conversationId ? `?conversation_id=${encodeURIComponent(conversationId)}` : '';
  const res = await fetch(`https://api.coze.cn/v3/chat${suffix}`, {
    method:'POST',
    headers:{Authorization:`Bearer ${token}`, 'Content-Type':'application/json'},
    body:JSON.stringify(payload)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.code !== 0 || !data.data?.id || !data.data?.conversation_id) {
    throw new Error(data.msg || `扣子发起对话失败（HTTP ${res.status}）`);
  }
  return {chatId:String(data.data.id), conversationId:String(data.data.conversation_id)};
}

async function waitForCoze(token, conversationId, chatId) {
  for (let i=0; i<45; i++) {
    const res = await fetch(`https://api.coze.cn/v3/chat/retrieve?conversation_id=${encodeURIComponent(conversationId)}&chat_id=${encodeURIComponent(chatId)}`, {
      headers:{Authorization:`Bearer ${token}`, 'Content-Type':'application/json'}
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.code !== 0) throw new Error(data.msg || '查询扣子对话状态失败');
    const status = data.data?.status;
    if (status === 'completed') return;
    if (status === 'failed') throw new Error(data.data?.last_error?.msg || '扣子智能体执行失败');
    if (status === 'requires_action') throw new Error('智能体当前需要额外工具操作，本简化版暂不处理 requires_action。');
    if (status === 'canceled') throw new Error('扣子对话已取消');
    await sleep(1000);
  }
  throw new Error('AI 回复超时，请稍后重试。');
}

async function getCozeAnswer(token, conversationId, chatId) {
  const res = await fetch(`https://api.coze.cn/v3/chat/message/list?conversation_id=${encodeURIComponent(conversationId)}&chat_id=${encodeURIComponent(chatId)}`, {
    headers:{Authorization:`Bearer ${token}`, 'Content-Type':'application/json'}
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.code !== 0 || !Array.isArray(data.data)) throw new Error(data.msg || '读取扣子回复失败');
  const parts = data.data.filter(m => m.role === 'assistant' && m.type === 'answer' && (!m.chat_id || String(m.chat_id) === chatId)).map(m => String(m.content || '')).filter(Boolean);
  if (!parts.length) throw new Error('AI 已完成处理，但没有返回 answer 消息。');
  return parts.join('\n').trim();
}

async function chat(context) {
  const token = envOf(context,'COZE_ACCESS_TOKEN');
  const botId = envOf(context,'COZE_BOT_ID');
  if (!token || !botId) return json({error:'服务器尚未配置 COZE_ACCESS_TOKEN / COZE_BOT_ID。'}, 500);

  const store = storeOf(context);
  const form = await context.request.formData();
  const studentId = String(form.get('studentId') || '').trim().toUpperCase();
  const studentName = normalizeName(form.get('studentName'));
  const message = String(form.get('message') || '').trim().slice(0,8000);
  const requestedConversationId = String(form.get('conversationId') || '').trim();
  const image = form.get('image');

  if (!studentIdOk(studentId) || !studentName) return json({error:'学生信息无效，请重新进入。'}, 400);
  const profile = await getProfile(store, context, studentId);
  if (!profile || normalizeName(profile.studentName) !== studentName) return json({error:'学生编号和姓名不匹配，请重新进入。'}, 403);
  const hasImage = image && typeof image.arrayBuffer === 'function' && Number(image.size || 0) > 0;
  if (!message && !hasImage) return json({error:'请输入文字或上传图片。'}, 400);
  if (hasImage && Number(image.size) > 10*1024*1024) return json({error:'图片不能超过 10 MB。'}, 413);
  if (hasImage && image.type && !String(image.type).startsWith('image/')) return json({error:'仅支持图片文件。'}, 415);

  let imageId = '';
  let cozeFileId = '';
  try {
    if (hasImage) {
      const up = await uploadToCoze(token, image, image.name || 'image.png');
      cozeFileId = up.fileId;
      imageId = randomUUID();
      const imgKey = `${basePrefix(context)}/students/${studentId}/images/${imageId}.bin`;
      const metaKey = `${basePrefix(context)}/students/${studentId}/images/${imageId}.json`;
      await store.set(imgKey, up.arrayBuffer);
      await putJson(store, metaKey, {imageId, fileName:image.name || 'image.png', contentType:up.contentType, bytes:Number(image.size||0), cozeFileId, createdAt:new Date().toISOString()});
    }

    const userMessageId = randomUUID();
    const createdAt = new Date().toISOString();
    const conversationId = requestedConversationId || profile.conversationId || '';
    const chatStart = await startCozeChat({token, botId, studentId, message, fileId:cozeFileId, conversationId});

    await saveMessage(store, context, studentId, {
      messageId:userMessageId, studentId, studentName, role:'user', text:message || '（上传了一张图片）', imageId:imageId || null,
      createdAt, conversationId:chatStart.conversationId, chatId:chatStart.chatId
    });

    await waitForCoze(token, chatStart.conversationId, chatStart.chatId);
    const answer = await getCozeAnswer(token, chatStart.conversationId, chatStart.chatId);
    const answerAt = new Date().toISOString();
    await saveMessage(store, context, studentId, {
      messageId:randomUUID(), studentId, studentName, role:'assistant', text:answer, imageId:null,
      createdAt:answerAt, conversationId:chatStart.conversationId, chatId:chatStart.chatId
    });

    const currentProfile = await getProfile(store, context, studentId) || profile;
    currentProfile.conversationId = chatStart.conversationId;
    currentProfile.updatedAt = answerAt;
    currentProfile.messageCount = Number(currentProfile.messageCount || 0) + 2;
    await saveProfile(store, context, currentProfile);

    return json({answer, conversationId:chatStart.conversationId, chatId:chatStart.chatId, createdAt:answerAt});
  } catch (e) {
    const failedAt = new Date().toISOString();
    await saveMessage(store, context, studentId, {
      messageId:randomUUID(), studentId, studentName, role:'system_error', text:String(e?.message || e), imageId:imageId || null,
      createdAt:failedAt, conversationId:requestedConversationId || profile.conversationId || '', chatId:''
    }).catch(()=>{});
    return json({error:String(e?.message || 'AI 请求失败')}, 502);
  }
}

async function adminLogin(context) {
  const body = await context.request.json().catch(()=>({}));
  const expected = envOf(context,'ADMIN_PASSWORD');
  if (!expected) return json({error:'服务器尚未配置 ADMIN_PASSWORD。'},500);
  if (String(body.password || '') !== expected) return json({error:'密码错误。'},401);
  const token = randomUUID().replaceAll('-','') + randomUUID().replaceAll('-','');
  const store = storeOf(context);
  await putJson(store, `${basePrefix(context)}/admin-sessions/${token}.json`, {createdAt:Date.now(), expiresAt:Date.now()+12*60*60*1000});
  return json({token});
}
async function authAdmin(context) {
  const auth = context.request.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? safeId(auth.slice(7)) : '';
  if (!token) return null;
  const store = storeOf(context);
  const key = `${basePrefix(context)}/admin-sessions/${token}.json`;
  const session = await getJson(store,key);
  if (!session || Number(session.expiresAt||0) < Date.now()) { if(session) await store.delete(key).catch(()=>{}); return null; }
  return {token, store};
}
async function adminLogout(context) {
  const auth = await authAdmin(context);
  if (!auth) return json({ok:true});
  await auth.store.delete(`${basePrefix(context)}/admin-sessions/${auth.token}.json`).catch(()=>{});
  return json({ok:true});
}

async function listProfiles(store, context) {
  const prefix = `${basePrefix(context)}/students/`;
  const {blobs=[]} = await store.list({prefix, consistency:'strong'});
  const keys = blobs.filter(b => b.key.endsWith('/profile.json')).map(b=>b.key);
  const profiles=[];
  for (const key of keys) { const p=await getJson(store,key); if(p) profiles.push(p); }
  profiles.sort((a,b) => a.studentId.localeCompare(b.studentId));
  return profiles;
}

async function adminStudents(context) {
  const auth = await authAdmin(context); if(!auth) return json({error:'未登录。'},401);
  const students = await listProfiles(auth.store, context);
  return json({students});
}
async function adminStudent(context) {
  const auth = await authAdmin(context); if(!auth) return json({error:'未登录。'},401);
  const url=new URL(context.request.url); const id=String(url.searchParams.get('studentId')||'').toUpperCase();
  if(!studentIdOk(id)) return json({error:'学生编号无效。'},400);
  const profile=await getProfile(auth.store, context, id); if(!profile) return json({error:'没有该学生数据。'},404);
  const messages=(await listMessages(auth.store, context, id)).filter(m=>m.role!=='system_error');
  return json({profile,messages});
}
async function adminImage(context) {
  const auth=await authAdmin(context); if(!auth) return json({error:'未登录。'},401);
  const url=new URL(context.request.url); const studentId=String(url.searchParams.get('studentId')||'').toUpperCase(); const imageId=safeId(url.searchParams.get('imageId')||'');
  if(!studentIdOk(studentId)||!imageId) return json({error:'参数无效。'},400);
  const prefix=`${basePrefix(context)}/students/${studentId}/images/${imageId}`;
  const meta=await getJson(auth.store, `${prefix}.json`); const buf=await auth.store.get(`${prefix}.bin`, {type:'arrayBuffer', consistency:'strong'});
  if(!meta||!buf) return json({error:'图片不存在。'},404);
  return new Response(buf,{headers:{'Content-Type':meta.contentType||'application/octet-stream','Cache-Control':'private, max-age=300'}});
}

function csvCell(v) { const s=String(v??''); return /[",\n\r]/.test(s) ? `"${s.replaceAll('"','""')}"` : s; }
async function adminExport(context) {
  const auth=await authAdmin(context); if(!auth) return json({error:'未登录。'},401);
  const url=new URL(context.request.url); const format=(url.searchParams.get('format')||'json').toLowerCase(); const includeTest=url.searchParams.get('includeTest')==='1';
  let profiles=await listProfiles(auth.store,context); if(!includeTest) profiles=profiles.filter(p=>!p.isTest);
  const rows=[];
  for(const p of profiles){ const messages=await listMessages(auth.store,context,p.studentId); rows.push({profile:p,messages}); }
  if(format==='csv'){
    const head=['student_id','student_name','is_test','message_id','role','text','has_image','image_id','created_at','conversation_id','chat_id'];
    const lines=[head.join(',')];
    for(const row of rows){ for(const m of row.messages){ if(m.role==='system_error') continue; lines.push([row.profile.studentId,row.profile.studentName,row.profile.isTest?1:0,m.messageId,m.role,m.text,m.imageId?1:0,m.imageId||'',m.createdAt,m.conversationId||'',m.chatId||''].map(csvCell).join(',')); } }
    return new Response('\uFEFF'+lines.join('\r\n'),{headers:{'Content-Type':'text/csv; charset=UTF-8','Content-Disposition':'attachment; filename="ai-dynamic-scaffold.csv"','Cache-Control':'no-store'}});
  }
  return new Response(JSON.stringify({exportedAt:new Date().toISOString(),experimentRunId:runId(context),includeTest,students:rows},null,2),{headers:{'Content-Type':'application/json; charset=UTF-8','Content-Disposition':'attachment; filename="ai-dynamic-scaffold.json"','Cache-Control':'no-store'}});
}

export default async function onRequest(context) {
  const url = new URL(context.request.url);
  let path = url.pathname;
  if (path.startsWith('/api/')) path = path.slice(5); else if (path === '/api') path='';
  try {
    if (path === 'student/start' && context.request.method === 'POST') return await startStudent(context);
    if (path === 'chat' && context.request.method === 'POST') return await chat(context);
    if (path === 'admin/login' && context.request.method === 'POST') return await adminLogin(context);
    if (path === 'admin/logout' && context.request.method === 'POST') return await adminLogout(context);
    if (path === 'admin/students' && context.request.method === 'GET') return await adminStudents(context);
    if (path === 'admin/student' && context.request.method === 'GET') return await adminStudent(context);
    if (path === 'admin/image' && context.request.method === 'GET') return await adminImage(context);
    if (path === 'admin/export' && context.request.method === 'GET') return await adminExport(context);
    if (path === 'health' && context.request.method === 'GET') return json({ok:true, runId:runId(context), configured:{cozeToken:!!envOf(context,'COZE_ACCESS_TOKEN'), botId:!!envOf(context,'COZE_BOT_ID'), adminPassword:!!envOf(context,'ADMIN_PASSWORD')}});
    return json({error:'API not found'},404);
  } catch (e) {
    console.error(e);
    return json({error:String(e?.message || '服务器错误')},500);
  }
}
