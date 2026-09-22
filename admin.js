const $=id=>document.getElementById(id);
const hashParams=new URLSearchParams(location.hash.startsWith('#')?location.hash.slice(1):'');
const handoffToken=hashParams.get('auth')||'';
if(handoffToken){localStorage.setItem('ads_admin_token',handoffToken);sessionStorage.setItem('ads_admin_token',handoffToken);history.replaceState(null,'',location.pathname+location.search);}
let token=handoffToken||localStorage.getItem('ads_admin_token')||sessionStorage.getItem('ads_admin_token')||'';
let selectedKey='',selectedTaskId='',activeTaskId='task1',students=[],tasks=[];
let lastMessageSignature='';
const imageUrls=new Set();
function fmtTime(iso){if(!iso)return'—';try{return new Date(iso).toLocaleString('zh-CN',{hour12:false});}catch{return iso;}}
function err(text=''){$('adminError').textContent=text;$('adminError').classList.toggle('hidden',!text);}
async function api(path,opts={}){const headers=new Headers(opts.headers||{});if(token)headers.set('Authorization',`Bearer ${token}`);const res=await fetch(path,{...opts,headers});if(res.status===401){token='';sessionStorage.removeItem('ads_admin_token');localStorage.removeItem('ads_admin_token');showLogin();throw new Error('登录已失效，请重新登录');}return res;}
function showLogin(){$('dashboard').classList.add('hidden');$('adminLogin').classList.remove('hidden');}
function showDash(){$('adminLogin').classList.add('hidden');$('dashboard').classList.remove('hidden');}
async function login(){err('');$('adminLoginBtn').disabled=true;try{const res=await fetch('/api/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:$('adminPassword').value})});const d=await res.json().catch(()=>({}));if(!res.ok)throw new Error(d.error||'登录失败');token=d.token;sessionStorage.setItem('ads_admin_token',token);localStorage.setItem('ads_admin_token',token);showDash();await loadStudents();}catch(e){err(e.message);}finally{$('adminLoginBtn').disabled=false;}}
function taskLabel(id){return tasks.find(t=>t.id===id)?.label||id;}
function statusInfo(status,messageCount=0){
  const s=status||(Number(messageCount||0)>0?'ready':'not_started');
  if(s==='processing') return {key:'processing',label:'AI处理中'};
  if(s==='failed') return {key:'failed',label:'异常'};
  if(s==='ready') return {key:'ready',label:'已回复'};
  return {key:'not_started',label:'未开始'};
}
function currentStat(student){return student?.taskStats?.[activeTaskId]||{};}
function fmtShortTime(iso){if(!iso)return'—';try{return new Date(iso).toLocaleTimeString('zh-CN',{hour12:false,hour:'2-digit',minute:'2-digit',second:'2-digit'});}catch{return'—';}}
function renderTaskControls(){const box=$('taskControlButtons');box.innerHTML='';for(const t of tasks){const b=document.createElement('button');b.className='task-control-btn'+(t.id===activeTaskId?' active':'');b.innerHTML=`<span>${t.label}</span>${t.id===activeTaskId?'<small>当前任务</small>':''}`;b.addEventListener('click',()=>switchTask(t.id));box.appendChild(b);}$('activeTaskTitle').textContent=`学生当前进入：${taskLabel(activeTaskId)}`;}
async function switchTask(taskId){if(taskId===activeTaskId)return;const label=taskLabel(taskId);if(!confirm(`确定把当前课堂任务切换为“${label}”吗？\n学生端会自动进入这个任务；原任务对话不会删除。`))return;const res=await api('/api/admin/task',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({taskId})});const d=await res.json().catch(()=>({}));if(!res.ok)throw new Error(d.error||'切换任务失败');activeTaskId=d.activeTaskId;tasks=d.tasks||tasks;selectedTaskId=activeTaskId;renderTaskControls();await loadStudents({silent:true});if(selectedKey)await loadStudent(selectedKey,selectedTaskId,{force:true});}
function totalMessages(s){return Object.values(s.taskStats||{}).reduce((n,x)=>n+Number(x?.messageCount||0),0);}
function renderStudents(){
  const list=$('studentList'); list.innerHTML='';
  const formalCount=students.filter(x=>!x.isTest).length;
  $('studentCount').textContent=`${formalCount} 人`;
  if(!students.length){list.innerHTML='<div class="empty">还没有学生进入平台。</div>';return;}
  const ordered=[...students].sort((a,b)=>{
    if(!!a.isTest!==!!b.isTest) return a.isTest?1:-1;
    const sa=statusInfo(currentStat(a).status,currentStat(a).messageCount).key;
    const sb=statusInfo(currentStat(b).status,currentStat(b).messageCount).key;
    const rank={processing:0,failed:1,ready:2,not_started:3};
    if(rank[sa]!==rank[sb]) return rank[sa]-rank[sb];
    return String(b.updatedAt||'').localeCompare(String(a.updatedAt||''));
  });
  for(const s of ordered){
    const stat=currentStat(s), st=statusInfo(stat.status,stat.messageCount);
    const div=document.createElement('div'); div.className='student-item'+(s.studentKey===selectedKey?' active':'');
    const top=document.createElement('div'); top.className='student-monitor-top';
    const nameWrap=document.createElement('div'); nameWrap.className='student-name-wrap';
    const name=document.createElement('span'); name.className='student-monitor-name'; name.textContent=s.studentName; nameWrap.appendChild(name);
    if(s.isTest){const test=document.createElement('span');test.className='mini-test-tag';test.textContent='测试';nameWrap.appendChild(test);}
    const badge=document.createElement('span');badge.className=`status-pill ${st.key}`;badge.textContent=st.label;
    top.append(nameWrap,badge);
    const sub=document.createElement('div'); sub.className='student-monitor-sub';
    const count=Number(stat.messageCount||0);
    sub.innerHTML=`<span>${taskLabel(activeTaskId)} · ${count} 条</span><span>最近 ${fmtTime(stat.updatedAt||s.updatedAt)}</span>`;
    const mini=document.createElement('div'); mini.className='task-mini-stats monitor-mini';
    mini.innerHTML=tasks.map(t=>{const x=s.taskStats?.[t.id]||{},si=statusInfo(x.status,x.messageCount);return `<span class="${t.id===activeTaskId?'current':''}"><i class="mini-status-dot ${si.key}"></i>${t.label} ${Number(x.messageCount||0)}</span>`;}).join('');
    div.append(top,sub,mini);
    div.addEventListener('click',()=>loadStudent(s.studentKey,selectedTaskId||activeTaskId,{force:true}));
    list.appendChild(div);
  }
}
async function loadStudent(studentKey,taskId,{force=false}={}){
  selectedKey=studentKey; selectedTaskId=taskId||activeTaskId; renderStudents();
  const res=await api(`/api/admin/student?studentKey=${encodeURIComponent(studentKey)}&taskId=${encodeURIComponent(selectedTaskId)}`); const d=await res.json(); if(!res.ok)throw new Error(d.error||'加载学生记录失败');
  const p=d.profile; $('detailTitle').textContent=p.studentName+(p.isTest?'（测试账号 S00）':'');
  $('detailSub').textContent=p.createdAt?`首次进入 ${fmtTime(p.createdAt)} · 最近活动 ${fmtTime(p.updatedAt)}`:'该学生尚未进入平台。';
  selectedTaskId=d.selectedTask.id; renderStudentTaskTabs(d);
  const taskSummary=(d.tasks||[]).find(t=>t.id===selectedTaskId)||{}; const si=statusInfo(taskSummary.status,taskSummary.messageCount);
  const statusPill=$('taskStatusPill'); statusPill.textContent=si.label; statusPill.className=`status-pill ${si.key}`; statusPill.classList.remove('hidden');
  const count=d.messages?.filter(m=>m.role!=='system_error').length||0; $('messageCountPill').textContent=`${d.selectedTask.label} · ${count} 条`; $('messageCountPill').classList.remove('hidden');
  const signature=`${studentKey}|${selectedTaskId}|${taskSummary.status||''}|${d.messages?.map(m=>`${m.messageId}:${m.createdAt}`).join(',')}`; if(!force&&signature===lastMessageSignature)return; lastMessageSignature=signature;
  const box=$('adminMessages'); box.innerHTML='';
  if(!d.messages?.length && si.key!=='processing'){box.innerHTML=`<div class="empty empty-chat"><strong>${d.selectedTask.label}暂无对话</strong><span>该学生还没有在这个任务中提交内容。</span></div>`;return;}
  let userTurn=0;
  for(const m of d.messages||[]){
    if(m.role==='system_error'){
      const row=document.createElement('div');row.className='admin-system-row';row.innerHTML=`<div class="admin-error-card"><strong>本轮发送异常</strong><span>${m.text||'未知错误'}</span><small>${fmtTime(m.createdAt)}</small></div>`;box.appendChild(row);continue;
    }
    const row=document.createElement('div'); row.className=`admin-chat-row ${m.role==='user'?'student':'ai'}`;
    const item=document.createElement('div'); item.className='admin-msg'; const meta=document.createElement('div'); meta.className='meta';
    const role=document.createElement('span'); role.className='role-label';
    if(m.role==='user'){userTurn+=1;role.textContent=`学生 · 第 ${userTurn} 轮`;}else role.textContent='AI';
    const time=document.createElement('span');time.textContent=fmtTime(m.createdAt)+(m.role==='assistant'&&m.responseSeconds!=null?` · ${m.responseSeconds}s`:'');meta.append(role,time);
    const content=document.createElement('div');content.className='content';content.textContent=m.text||'';item.append(meta,content);
    if(m.imageId){const loading=document.createElement('div');loading.className='muted image-loading';loading.textContent='正在加载图片…';item.appendChild(loading);fetchProtectedImage(`/api/admin/image?studentKey=${encodeURIComponent(m.sourceStudentKey||studentKey)}&taskId=${encodeURIComponent(selectedTaskId)}&imageId=${encodeURIComponent(m.imageId)}`).then(src=>{if(!src){loading.textContent='图片加载失败';return;}const img=document.createElement('img');img.src=src;img.alt='学生上传图片';loading.replaceWith(img);});}
    row.appendChild(item);box.appendChild(row);
  }
  if(si.key==='processing'){
    const row=document.createElement('div');row.className='admin-chat-row ai pending-row';row.innerHTML='<div class="admin-msg pending-msg"><div class="meta"><span class="role-label">AI</span><span>处理中</span></div><div class="admin-pending-line"><i class="pending-spinner"></i><span>AI 正在处理这名学生的最新提交…</span></div></div>';box.appendChild(row);
  }
  box.scrollTop=box.scrollHeight;
}
async function download(path,filename){const res=await api(path);if(!res.ok){const d=await res.json().catch(()=>({}));throw new Error(d.error||'导出失败');}const blob=await res.blob(),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),5000);}
$('adminLoginBtn').addEventListener('click',login);$('adminPassword').addEventListener('keydown',e=>{if(e.key==='Enter')login();});$('refreshBtn').addEventListener('click',()=>loadStudents().catch(e=>alert(e.message)));$('exportJsonBtn').addEventListener('click',()=>download('/api/admin/export?format=json','ai-dynamic-scaffold.json').catch(e=>alert(e.message)));$('exportCsvBtn').addEventListener('click',()=>download('/api/admin/export?format=csv','ai-dynamic-scaffold.csv').catch(e=>alert(e.message)));$('logoutBtn').addEventListener('click',async()=>{try{await api('/api/admin/logout',{method:'POST'});}catch{}token='';sessionStorage.removeItem('ads_admin_token');localStorage.removeItem('ads_admin_token');showLogin();});window.addEventListener('beforeunload',()=>imageUrls.forEach(u=>URL.revokeObjectURL(u)));
setInterval(async()=>{if(!token||$('dashboard').classList.contains('hidden'))return;try{await loadStudents({silent:true});if(selectedKey)await loadStudent(selectedKey,selectedTaskId||activeTaskId,{force:false});}catch{}},3000);
(async function boot(){if(!token)return showLogin();try{showDash();await loadStudents();}catch{showLogin();}})();
