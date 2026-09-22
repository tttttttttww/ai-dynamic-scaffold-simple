const $ = (id) => document.getElementById(id);
let token = sessionStorage.getItem('ads_admin_token') || '';
let selectedId = '';
let students = [];
const imageUrls = new Set();

function fmtTime(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString('zh-CN', {hour12:false}); } catch { return iso; }
}
function err(text='') {
  $('adminError').textContent = text;
  $('adminError').classList.toggle('hidden', !text);
}
async function api(path, opts={}) {
  const headers = new Headers(opts.headers || {});
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const res = await fetch(path, {...opts, headers});
  if (res.status === 401) {
    token=''; sessionStorage.removeItem('ads_admin_token'); showLogin();
    throw new Error('登录已失效，请重新登录');
  }
  return res;
}
function showLogin() {
  $('dashboard').classList.add('hidden');
  $('adminLogin').classList.remove('hidden');
}
function showDash() {
  $('adminLogin').classList.add('hidden');
  $('dashboard').classList.remove('hidden');
}

async function login() {
  err('');
  const password = $('adminPassword').value;
  $('adminLoginBtn').disabled = true;
  try {
    const res = await fetch('/api/admin/login', {
      method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({password})
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || '登录失败');
    token = data.token;
    sessionStorage.setItem('ads_admin_token', token);
    showDash();
    await loadStudents();
  } catch (e) { err(e.message); }
  finally { $('adminLoginBtn').disabled = false; }
}

async function loadStudents() {
  const res = await api('/api/admin/students');
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || '加载失败');
  students = data.students || [];
  $('studentCount').textContent = `${students.length} 人`;
  const list = $('studentList');
  list.innerHTML = '';
  if (!students.length) {
    list.innerHTML = '<div class="empty">还没有学生数据。</div>';
    return;
  }
  students.forEach(s => {
    const div = document.createElement('div');
    div.className = 'student-item' + (s.studentId === selectedId ? ' active' : '');
    div.dataset.id = s.studentId;
    const title = document.createElement('div'); title.className='student-title';
    const name = document.createElement('span'); name.textContent=`${s.studentId} · ${s.studentName}`;
    title.appendChild(name);
    if (s.isTest) { const b=document.createElement('span'); b.className='badge test'; b.textContent='测试'; title.appendChild(b); }
    const sub = document.createElement('div'); sub.className='student-sub';
    sub.textContent=`${s.messageCount || 0} 条消息 · 最近 ${fmtTime(s.updatedAt)}`;
    div.append(title, sub);
    div.addEventListener('click', () => loadStudent(s.studentId));
    list.appendChild(div);
  });
}

async function fetchProtectedImage(url) {
  const res = await api(url);
  if (!res.ok) return null;
  const blob = await res.blob();
  const obj = URL.createObjectURL(blob);
  imageUrls.add(obj);
  return obj;
}

async function loadStudent(id) {
  selectedId = id;
  await loadStudents();
  const res = await api(`/api/admin/student?studentId=${encodeURIComponent(id)}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || '加载学生记录失败');
  const p = data.profile;
  $('detailTitle').textContent = `${p.studentId} · ${p.studentName}${p.isTest ? '（教师测试）' : ''}`;
  $('detailSub').textContent = `首次进入 ${fmtTime(p.createdAt)} · 最近活动 ${fmtTime(p.updatedAt)}`;
  const box = $('adminMessages');
  box.innerHTML='';
  if (!data.messages?.length) { box.innerHTML='<div class="empty">暂无聊天记录。</div>'; return; }
  for (const m of data.messages) {
    const item=document.createElement('div'); item.className='admin-msg';
    const meta=document.createElement('div'); meta.className='meta';
    const role=document.createElement('span'); role.textContent = m.role === 'user' ? '学生' : 'AI';
    const time=document.createElement('span'); time.textContent=fmtTime(m.createdAt);
    meta.append(role,time);
    const content=document.createElement('div'); content.className='content'; content.textContent=m.text || '';
    item.append(meta,content);
    if (m.imageId) {
      const loading=document.createElement('div'); loading.className='muted'; loading.style.fontSize='12px'; loading.style.marginTop='8px'; loading.textContent='正在加载图片…';
      item.appendChild(loading);
      fetchProtectedImage(`/api/admin/image?studentId=${encodeURIComponent(id)}&imageId=${encodeURIComponent(m.imageId)}`).then(src => {
        if (!src) { loading.textContent='图片加载失败'; return; }
        const img=document.createElement('img'); img.src=src; img.alt='学生上传图片';
        loading.replaceWith(img);
      });
    }
    box.appendChild(item);
  }
}

async function download(path, filename) {
  const res = await api(path);
  if (!res.ok) {
    const data=await res.json().catch(()=>({}));
    throw new Error(data.error || '导出失败');
  }
  const blob=await res.blob();
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a'); a.href=url; a.download=filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 5000);
}

$('adminLoginBtn').addEventListener('click', login);
$('adminPassword').addEventListener('keydown', e => { if (e.key==='Enter') login(); });
$('refreshBtn').addEventListener('click', () => loadStudents().catch(e=>alert(e.message)));
$('exportJsonBtn').addEventListener('click', () => download('/api/admin/export?format=json&includeTest=0', 'ai-dynamic-scaffold-formal.json').catch(e=>alert(e.message)));
$('exportCsvBtn').addEventListener('click', () => download('/api/admin/export?format=csv&includeTest=0', 'ai-dynamic-scaffold-formal.csv').catch(e=>alert(e.message)));
$('exportAllBtn').addEventListener('click', () => download('/api/admin/export?format=json&includeTest=1', 'ai-dynamic-scaffold-all.json').catch(e=>alert(e.message)));
$('logoutBtn').addEventListener('click', async () => {
  try { await api('/api/admin/logout', {method:'POST'}); } catch {}
  token=''; sessionStorage.removeItem('ads_admin_token'); showLogin();
});
window.addEventListener('beforeunload', () => imageUrls.forEach(u=>URL.revokeObjectURL(u)));

(async function boot() {
  if (!token) return showLogin();
  try { showDash(); await loadStudents(); }
  catch { showLogin(); }
})();
