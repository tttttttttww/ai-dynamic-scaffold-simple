const $ = (id) => document.getElementById(id);
const state = {
  studentId: localStorage.getItem('ads_student_id') || '',
  studentName: localStorage.getItem('ads_student_name') || '',
  conversationId: localStorage.getItem('ads_conversation_id') || '',
  selectedFile: null,
  sending: false,
};

function escapeHtml(s='') {
  return s.replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
}
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
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({password})
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || '登录失败');
    sessionStorage.setItem('ads_admin_token', data.token);
    window.location.href = '/admin.html';
  } catch (e) {
    showAdminError(e.message);
  } finally {
    $('coverAdminLoginBtn').disabled = false;
    $('coverAdminLoginBtn').textContent = '进入后台';
  }
}

function scrollBottom() {
  const el = $('messages');
  el.scrollTop = el.scrollHeight;
}
function renderMessage(msg) {
  const wrap = document.createElement('div');
  wrap.className = `msg ${msg.role === 'user' ? 'user' : 'assistant'}`;
  const bubble = document.createElement('div');
  bubble.className = 'bubble';

  if (msg.localImageUrl) {
    const img = document.createElement('img');
    img.className = 'msg-image';
    img.src = msg.localImageUrl;
    img.alt = '上传图片';
    bubble.appendChild(img);
  }
  if (msg.text) {
    const text = document.createElement('div');
    text.textContent = msg.text;
    bubble.appendChild(text);
  }
  const t = document.createElement('span');
  t.className = 'msg-time';
  t.textContent = fmtTime(msg.createdAt || new Date().toISOString());
  bubble.appendChild(t);
  wrap.appendChild(bubble);
  $('messages').appendChild(wrap);
  scrollBottom();
}

async function startStudent(studentId, studentName) {
  const res = await fetch('/api/student/start', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({studentId, studentName})
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '进入失败');
  return data;
}

async function enter() {
  showError('');
  const studentId = $('studentId').value.trim().toUpperCase();
  const studentName = $('studentName').value.trim();
  $('enterBtn').disabled = true;
  $('enterBtn').textContent = '正在进入…';
  try {
    const data = await startStudent(studentId, studentName);
    state.studentId = data.studentId;
    state.studentName = data.studentName;
    state.conversationId = data.conversationId || '';
    localStorage.setItem('ads_student_id', state.studentId);
    localStorage.setItem('ads_student_name', state.studentName);
    if (state.conversationId) localStorage.setItem('ads_conversation_id', state.conversationId);
    else localStorage.removeItem('ads_conversation_id');
    showChat(data.messages || []);
  } catch (e) {
    showError(e.message);
  } finally {
    $('enterBtn').disabled = false;
    $('enterBtn').textContent = '进入学习平台';
  }
}

function showChat(history=[]) {
  $('loginView').classList.add('hidden');
  $('chatView').classList.remove('hidden');
  $('studentMeta').textContent = `${state.studentId} · ${state.studentName}${state.studentId === 'S00' ? '（教师测试）' : ''}`;
  $('messages').innerHTML = '';
  if (!history.length) {
    renderMessage({role:'assistant', text:'你好！你可以直接提问，也可以上传一张图片后让我一起看。', createdAt:new Date().toISOString()});
  } else {
    history.forEach(m => renderMessage({role:m.role, text:m.text, createdAt:m.createdAt}));
  }
}

function clearImage() {
  state.selectedFile = null;
  $('imageInput').value = '';
  $('previewRow').classList.add('hidden');
  $('previewImage').src = '';
}

async function sendMessage() {
  if (state.sending) return;
  const text = $('messageInput').value.trim();
  const file = state.selectedFile;
  if (!text && !file) return;
  if (file && file.size > 10 * 1024 * 1024) {
    alert('图片请控制在 10 MB 以内。');
    return;
  }

  state.sending = true;
  $('sendBtn').disabled = true;
  $('imageInput').disabled = true;
  $('sendStatus').textContent = 'AI 正在回复…';

  const localImageUrl = file ? URL.createObjectURL(file) : null;
  renderMessage({role:'user', text: text || '（上传了一张图片）', localImageUrl, createdAt:new Date().toISOString()});
  $('messageInput').value = '';
  clearImage();

  const form = new FormData();
  form.append('studentId', state.studentId);
  form.append('studentName', state.studentName);
  form.append('message', text);
  if (state.conversationId) form.append('conversationId', state.conversationId);
  if (file) form.append('image', file, file.name);

  try {
    const res = await fetch('/api/chat', {method:'POST', body:form});
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || '发送失败');
    if (data.conversationId) {
      state.conversationId = data.conversationId;
      localStorage.setItem('ads_conversation_id', data.conversationId);
    }
    renderMessage({role:'assistant', text:data.answer || 'AI 没有返回文字回复。', createdAt:data.createdAt});
  } catch (e) {
    renderMessage({role:'assistant', text:`本次请求失败：${e.message}`, createdAt:new Date().toISOString()});
  } finally {
    state.sending = false;
    $('sendBtn').disabled = false;
    $('imageInput').disabled = false;
    $('sendStatus').textContent = '';
  }
}

$('adminEntryBtn').addEventListener('click', openAdminModal);
$('adminModalClose').addEventListener('click', closeAdminModal);
document.querySelector('[data-close-admin-modal]').addEventListener('click', closeAdminModal);
$('coverAdminLoginBtn').addEventListener('click', coverAdminLogin);
$('coverAdminPassword').addEventListener('keydown', e => {
  if (e.key === 'Enter') coverAdminLogin();
  if (e.key === 'Escape') closeAdminModal();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !$('adminModal').classList.contains('hidden')) closeAdminModal();
});

$('enterBtn').addEventListener('click', enter);
$('studentName').addEventListener('keydown', e => { if (e.key === 'Enter') enter(); });
$('studentId').addEventListener('keydown', e => { if (e.key === 'Enter') enter(); });
$('sendBtn').addEventListener('click', sendMessage);
$('messageInput').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});
$('imageInput').addEventListener('change', () => {
  const file = $('imageInput').files?.[0];
  if (!file) return clearImage();
  if (!file.type.startsWith('image/')) { alert('请选择图片文件。'); return clearImage(); }
  state.selectedFile = file;
  $('previewImage').src = URL.createObjectURL(file);
  $('previewName').textContent = file.name;
  $('previewRow').classList.remove('hidden');
});
$('removeImageBtn').addEventListener('click', clearImage);
$('switchBtn').addEventListener('click', () => {
  localStorage.removeItem('ads_student_id');
  localStorage.removeItem('ads_student_name');
  localStorage.removeItem('ads_conversation_id');
  state.studentId = state.studentName = state.conversationId = '';
  $('chatView').classList.add('hidden');
  $('loginView').classList.remove('hidden');
  $('studentId').value = '';
  $('studentName').value = '';
});

(async function boot() {
  if (state.studentId && state.studentName) {
    $('studentId').value = state.studentId;
    $('studentName').value = state.studentName;
    try {
      const data = await startStudent(state.studentId, state.studentName);
      state.conversationId = data.conversationId || state.conversationId;
      if (state.conversationId) localStorage.setItem('ads_conversation_id', state.conversationId);
      showChat(data.messages || []);
    } catch {
      localStorage.removeItem('ads_student_id');
      localStorage.removeItem('ads_student_name');
      localStorage.removeItem('ads_conversation_id');
    }
  }
})();
