const $ = (id) => document.getElementById(id);
const state = {
  className: '',
  studentKey: '',
  studentId: '',
  studentName: '',
  conversationId: '',
  selectedFile: null,
  sending: false,
};

function fmtTime(iso) {
  try { return new Date(iso).toLocaleString('zh-CN', {hour12:false}); } catch { return ''; }
}
function showError(text) {
  $('loginError').textContent = text;
  $('loginError').classList.toggle('hidden', !text);
}
function showAdminError(text='') {
  $('coverAdminError').textContent = text;
  $('coverAdminError').classList.toggle('hidden', !text);
}
function openAdminModal() {
  showAdminError('');
  $('coverAdminPassword').value = '';
  $('adminModal').classList.remove('hidden');
  document.body.classList.add('modal-open');
  setTimeout(() => $('coverAdminPassword').focus(), 0);
}
function closeAdminModal() {
  $('adminModal').classList.add('hidden');
  document.body.classList.remove('modal-open');
  showAdminError('');
}
async function coverAdminLogin() {
  showAdminError('');
  const password = $('coverAdminPassword').value;
  if (!password) {
    showAdminError('请输入管理员密码。');
    $('coverAdminPassword').focus();
    return;
  }
  $('coverAdminLoginBtn').disabled = true;
  $('coverAdminLoginBtn').textContent = '正在验证…';
  try {
    const res = await fetch('/api/admin/login', {
      method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({password})
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || '登录失败');
    sessionStorage.setItem('ads_admin_token', data.token);
    window.location.href = '/admin.html';
  } catch (e) { showAdminError(e.message); }
  finally {
    $('coverAdminLoginBtn').disabled = false;
    $('coverAdminLoginBtn').textContent = '进入后台';
  }
}

async function loadClasses() {
  const select = $('className');
  try {
    const res = await fetch('/api/roster/classes', {cache:'no-store'});
    const data = await res.json().catch(() => ({}));
    const classes = Array.isArray(data.classes) ? data.classes : [];
    select.innerHTML = '';
    if (!classes.length) {
      const opt=document.createElement('option');
      opt.value=''; opt.textContent='请等待老师导入学生名单';
      select.appendChild(opt);
      $('enterBtn').disabled = true;
      return [];
    }
    const first=document.createElement('option'); first.value=''; first.textContent='请选择班级';
    select.appendChild(first);
    classes.forEach(c => {
      const opt=document.createElement('option'); opt.value=c; opt.textContent=c; select.appendChild(opt);
    });
    if (state.className && classes.includes(state.className)) select.value=state.className;
    else if (classes.length === 1) select.value=classes[0];
    $('enterBtn').disabled = false;
    return classes;
  } catch {
    select.innerHTML='<option value="">班级读取失败，请刷新页面</option>';
    $('enterBtn').disabled = true;
    return [];
  }
}

function scrollBottom() { const el = $('messages'); el.scrollTop = el.scrollHeight; }
function renderMessage(msg) {
  const empty=$('chatEmpty');
  if(empty) empty.remove();
  const wrap = document.createElement('div');
  wrap.className = `msg ${msg.role === 'user' ? 'user' : 'assistant'}`;
  const bubble = document.createElement('div'); bubble.className = 'bubble';
  if (msg.localImageUrl) {
    const img = document.createElement('img'); img.className='msg-image'; img.src=msg.localImageUrl; img.alt='上传图片'; bubble.appendChild(img);
  }
  if (msg.text) { const text=document.createElement('div'); text.textContent=msg.text; bubble.appendChild(text); }
  const t=document.createElement('span'); t.className='msg-time'; t.textContent=fmtTime(msg.createdAt || new Date().toISOString()); bubble.appendChild(t);
  wrap.appendChild(bubble); $('messages').appendChild(wrap); scrollBottom();
}

async function startStudent(className, studentId, studentName) {
  const res = await fetch('/api/student/start', {
    method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({className, studentId, studentName})
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '进入失败');
  return data;
}

async function enter() {
  showError('');
  const className = $('className').value.trim();
  const studentId = $('studentId').value.trim();
  const studentName = $('studentName').value.trim();
  if (!className) return showError('请选择班级。');
  $('enterBtn').disabled = true; $('enterBtn').innerHTML = '正在进入…';
  try {
    const data = await startStudent(className, studentId, studentName);
    state.className=data.className; state.studentKey=data.studentKey; state.studentId=data.studentId; state.studentName=data.studentName; state.conversationId=data.conversationId || '';
    showChat(data.messages || []);
  } catch (e) { showError(e.message); }
  finally { $('enterBtn').disabled = false; $('enterBtn').innerHTML = '进入学习平台 <span aria-hidden="true">→</span>'; }
}

function showChat(history=[]) {
  $('loginView').classList.add('hidden'); $('chatView').classList.remove('hidden');
  $('studentMeta').textContent = `${state.className} · ${state.studentId} · ${state.studentName}`;
  $('messages').innerHTML='';
  if (!history.length) {
    const empty=document.createElement('div');
    empty.id='chatEmpty';
    empty.className='chat-empty';
    empty.innerHTML='<div class="chat-empty-icon">▧</div><strong>先上传你的作品图片</strong><span>点击下方“图片”选择作品后直接发送。后续对话中也可以继续上传新的图片。</span>';
    $('messages').appendChild(empty);
  } else history.forEach(m => renderMessage({role:m.role, text:m.text, createdAt:m.createdAt}));
}
function clearImage() {
  state.selectedFile=null;
  $('imageInput').value='';
  $('previewRow').classList.add('hidden');
  $('previewImage').src='';
}
async function responseError(res, fallback='请求失败') {
  const contentType=res.headers.get('content-type') || '';
  if(contentType.includes('application/json')) {
    const data=await res.json().catch(()=>({}));
    return data.error || data.message || `${fallback}（HTTP ${res.status}）`;
  }
  const text=(await res.text().catch(()=>'' )).trim();
  if(res.status===504 || res.status===524) return `服务器等待超时（HTTP ${res.status}），请重试。`;
  return text && text.length < 300 ? `${fallback}：${text}` : `${fallback}（HTTP ${res.status}）`;
}

async function pollChatStatus({conversationId, chatId}) {
  for(let i=0;i<120;i++) {
    const qs=new URLSearchParams({
      studentKey:state.studentKey,
      className:state.className,
      studentId:state.studentId,
      studentName:state.studentName,
      conversationId,
      chatId,
    });
    const res=await fetch(`/api/chat/status?${qs.toString()}`, {cache:'no-store'});
    if(!res.ok) throw new Error(await responseError(res,'读取 AI 回复失败'));
    const data=await res.json().catch(()=>({}));
    if(data.status==='completed') return data;
    if(data.status==='failed') throw new Error(data.error || 'AI 执行失败');
    $('sendStatus').textContent='AI 正在处理，请稍候…';
    await new Promise(r=>setTimeout(r,1200));
  }
  throw new Error('AI 回复时间较长，请稍后重试。');
}

async function sendMessage() {
  if (state.sending) return;
  const text=$('messageInput').value.trim();
  const file=state.selectedFile;
  if (!text && !file) return;
  if (file && file.size > 10*1024*1024) { alert('图片请控制在 10 MB 以内。'); return; }

  state.sending=true;
  $('sendBtn').disabled=true;
  $('imageInput').disabled=true;
  $('sendStatus').textContent=file ? '正在上传图片…' : '正在发送…';

  const localImageUrl=file ? URL.createObjectURL(file) : null;
  renderMessage({role:'user', text:text || '（上传了一张图片）', localImageUrl, createdAt:new Date().toISOString()});
  $('messageInput').value='';
  clearImage();

  const form=new FormData();
  form.append('studentKey', state.studentKey);
  form.append('className', state.className);
  form.append('studentId', state.studentId);
  form.append('studentName', state.studentName);
  form.append('message', text);
  if (state.conversationId) form.append('conversationId', state.conversationId);
  if (file) form.append('image', file, file.name);

  try {
    const res=await fetch('/api/chat',{method:'POST',body:form});
    if(!res.ok) throw new Error(await responseError(res,'发送失败'));
    const data=await res.json().catch(()=>({}));
    if(!data.conversationId || !data.chatId) throw new Error(data.error || '服务器没有返回有效的会话信息。');
    state.conversationId=data.conversationId;
    $('sendStatus').textContent='AI 正在处理，请稍候…';
    const done=await pollChatStatus({conversationId:data.conversationId,chatId:data.chatId});
    renderMessage({role:'assistant', text:done.answer || 'AI 没有返回文字回复。', createdAt:done.createdAt});
  } catch(e) {
    renderMessage({role:'assistant', text:`本次请求失败：${e.message}`, createdAt:new Date().toISOString()});
  } finally {
    state.sending=false;
    $('sendBtn').disabled=false;
    $('imageInput').disabled=false;
    $('sendStatus').textContent='';
  }
}

$('adminEntryBtn').addEventListener('click', openAdminModal);
$('adminModalClose').addEventListener('click', closeAdminModal);
document.querySelector('[data-close-admin-modal]').addEventListener('click', closeAdminModal);
$('coverAdminLoginBtn').addEventListener('click', coverAdminLogin);
$('coverAdminPassword').addEventListener('keydown', e => { if(e.key==='Enter') coverAdminLogin(); if(e.key==='Escape') closeAdminModal(); });
document.addEventListener('keydown', e => { if(e.key==='Escape' && !$('adminModal').classList.contains('hidden')) closeAdminModal(); });
$('enterBtn').addEventListener('click', enter);
$('studentName').addEventListener('keydown', e => { if(e.key==='Enter') enter(); });
$('studentId').addEventListener('keydown', e => { if(e.key==='Enter') enter(); });
$('sendBtn').addEventListener('click', sendMessage);
$('messageInput').addEventListener('keydown', e => { if(e.key==='Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } });
$('imageInput').addEventListener('change', () => {
  const file=$('imageInput').files?.[0]; if(!file) return clearImage();
  if(!file.type.startsWith('image/')) { alert('请选择图片文件。'); return clearImage(); }
  state.selectedFile=file;
  $('previewImage').src=URL.createObjectURL(file);
  $('previewName').textContent=file.name;
  $('previewRow').classList.remove('hidden');
});
$('removeImageBtn').addEventListener('click', clearImage);
$('switchBtn').addEventListener('click', async () => {
  state.className=state.studentKey=state.studentId=state.studentName=state.conversationId='';
  clearImage();
  $('chatView').classList.add('hidden');
  $('loginView').classList.remove('hidden');
  $('studentId').value='';
  $('studentName').value='';
  $('messageInput').value='';
  await loadClasses();
});

(async function boot(){
  // 公共/课堂设备每次打开都停留在登录页，不自动恢复上一名学生。
  ['ads_class_name','ads_student_key','ads_student_id','ads_student_name','ads_conversation_id'].forEach(k=>localStorage.removeItem(k));
  $('chatView').classList.add('hidden');
  $('loginView').classList.remove('hidden');
  await loadClasses();
})();
