const $ = id => document.getElementById(id);
let token=sessionStorage.getItem('ads_admin_token')||'';
let selectedKey='';
let students=[];
let classes=[];
let pendingRoster=[];
const imageUrls=new Set();

function fmtTime(iso){ if(!iso)return '—'; try{return new Date(iso).toLocaleString('zh-CN',{hour12:false});}catch{return iso;} }
function err(text=''){ $('adminError').textContent=text; $('adminError').classList.toggle('hidden',!text); }
function rosterErr(text=''){ $('rosterError').textContent=text; $('rosterError').classList.toggle('hidden',!text); }
async function api(path,opts={}){
  const headers=new Headers(opts.headers||{}); if(token)headers.set('Authorization',`Bearer ${token}`);
  const res=await fetch(path,{...opts,headers});
  if(res.status===401){ token=''; sessionStorage.removeItem('ads_admin_token'); showLogin(); throw new Error('登录已失效，请重新登录'); }
  return res;
}
function showLogin(){ $('dashboard').classList.add('hidden'); $('adminLogin').classList.remove('hidden'); }
function showDash(){ $('adminLogin').classList.add('hidden'); $('dashboard').classList.remove('hidden'); }

async function login(){
  err(''); const password=$('adminPassword').value; $('adminLoginBtn').disabled=true;
  try{
    const res=await fetch('/api/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password})});
    const data=await res.json().catch(()=>({})); if(!res.ok)throw new Error(data.error||'登录失败');
    token=data.token; sessionStorage.setItem('ads_admin_token',token); showDash(); await loadStudents();
  }catch(e){err(e.message);} finally{$('adminLoginBtn').disabled=false;}
}

function renderClassFilter(){
  const sel=$('classFilter'), current=sel.value; sel.innerHTML='<option value="">全部班级</option>';
  classes.forEach(c=>{ const o=document.createElement('option'); o.value=c; o.textContent=c; sel.appendChild(o); });
  if(classes.includes(current))sel.value=current;
}
function renderStudents(){
  const filter=$('classFilter').value;
  const visible=filter?students.filter(s=>s.className===filter):students;
  const list=$('studentList'); list.innerHTML='';
  $('studentCount').textContent=`${visible.length} 人`;
  if(!visible.length){ list.innerHTML='<div class="empty">当前班级暂无学生。</div>'; return; }
  visible.forEach(s=>{
    const div=document.createElement('div'); div.className='student-item'+(s.studentKey===selectedKey?' active':'');
    const title=document.createElement('div'); title.className='student-title';
    const name=document.createElement('span'); name.textContent=`${s.studentId} · ${s.studentName}`; title.appendChild(name);
    const badge=document.createElement('span'); badge.className=`badge ${s.hasEntered?'entered':'waiting'}`; badge.textContent=s.hasEntered?'已进入':'未进入'; title.appendChild(badge);
    const sub=document.createElement('div'); sub.className='student-sub';
    sub.textContent=s.hasEntered?`${s.className} · ${s.messageCount||0} 条消息 · 最近 ${fmtTime(s.updatedAt)}`:`${s.className} · 尚无学习记录`;
    div.append(title,sub); div.addEventListener('click',()=>loadStudent(s.studentKey)); list.appendChild(div);
  });
}
async function loadStudents(){
  const res=await api('/api/admin/students'); const data=await res.json(); if(!res.ok)throw new Error(data.error||'加载失败');
  students=data.students||[]; classes=data.classes||[];
  renderClassFilter(); renderStudents();
  const updated=data.rosterUpdatedAt?` · 最近上传 ${fmtTime(data.rosterUpdatedAt)}`:'';
  $('rosterSummary').textContent=data.rosterCount?`${data.classCount||classes.length} 个班 · 名单 ${data.rosterCount} 人 · 已进入 ${data.enteredCount} 人${updated}`:'还没有上传学生名单，请先上传名单。';
}
async function fetchProtectedImage(url){ const res=await api(url); if(!res.ok)return null; const blob=await res.blob(); const obj=URL.createObjectURL(blob); imageUrls.add(obj); return obj; }
async function loadStudent(studentKey){
  selectedKey=studentKey; renderStudents();
  const res=await api(`/api/admin/student?studentKey=${encodeURIComponent(studentKey)}`); const data=await res.json(); if(!res.ok)throw new Error(data.error||'加载学生记录失败');
  const p=data.profile; $('detailTitle').textContent=`${p.className} · ${p.studentId} · ${p.studentName}`;
  $('detailSub').textContent=p.createdAt?`首次进入 ${fmtTime(p.createdAt)} · 最近活动 ${fmtTime(p.updatedAt)}`:'该学生尚未进入平台。';
  const box=$('adminMessages'); box.innerHTML='';
  if(!data.messages?.length){box.innerHTML='<div class="empty">暂无聊天记录。</div>';return;}
  for(const m of data.messages){
    const item=document.createElement('div'); item.className='admin-msg';
    const meta=document.createElement('div'); meta.className='meta';
    const role=document.createElement('span'); role.textContent=m.role==='user'?'学生':'AI';
    const time=document.createElement('span'); time.textContent=fmtTime(m.createdAt); meta.append(role,time);
    const content=document.createElement('div'); content.className='content'; content.textContent=m.text||''; item.append(meta,content);
    if(m.imageId){
      const loading=document.createElement('div'); loading.className='muted image-loading'; loading.textContent='正在加载图片…'; item.appendChild(loading);
      fetchProtectedImage(`/api/admin/image?studentKey=${encodeURIComponent(studentKey)}&imageId=${encodeURIComponent(m.imageId)}`).then(src=>{
        if(!src){loading.textContent='图片加载失败';return;} const img=document.createElement('img'); img.src=src; img.alt='学生上传图片'; loading.replaceWith(img);
      });
    }
    box.appendChild(item);
  }
}

function openRosterModal(){ pendingRoster=[]; rosterErr(''); $('rosterFile').value=''; $('rosterFileName').textContent='点击选择 Excel 或 CSV'; $('rosterPreview').classList.add('hidden'); $('confirmRosterBtn').disabled=true; $('rosterModal').classList.remove('hidden'); document.body.classList.add('modal-open'); }
function closeRosterModal(){ $('rosterModal').classList.add('hidden'); document.body.classList.remove('modal-open'); rosterErr(''); }
function headerIndex(headers,names){ const normalized=headers.map(v=>String(v??'').trim().toLowerCase()); for(const n of names){ const i=normalized.indexOf(n.toLowerCase()); if(i>=0)return i; } return -1; }
function parseWorkbook(file){
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onerror=()=>reject(new Error('无法读取文件。'));
    reader.onload=()=>{
      try{
        if(!window.XLSX)throw new Error('Excel 读取组件未加载，请刷新页面后重试。');
        const wb=XLSX.read(reader.result,{type:'array'}); const ws=wb.Sheets[wb.SheetNames[0]];
        const rows=XLSX.utils.sheet_to_json(ws,{header:1,defval:'',raw:false});
        if(rows.length<2)throw new Error('名单至少需要表头和 1 名学生。');
        const headers=rows[0].map(v=>String(v).trim());
        const ci=headerIndex(headers,['班级','class','classname','class_name']);
        const ii=headerIndex(headers,['学生编号','编号','studentid','student_id','id']);
        const ni=headerIndex(headers,['姓名','学生姓名','studentname','student_name','name']);
        if(ci<0||ii<0||ni<0)throw new Error('第一行必须包含“班级、学生编号、姓名”三列。');
        const data=rows.slice(1).map(r=>({className:String(r[ci]??'').trim(),studentId:String(r[ii]??'').trim(),studentName:String(r[ni]??'').trim()})).filter(r=>r.className||r.studentId||r.studentName);
        const incomplete=data.find(r=>!r.className||!r.studentId||!r.studentName); if(incomplete)throw new Error('名单里有空白的班级、学生编号或姓名，请补齐后再上传。');
        const seen=new Set(); for(const r of data){const k=`${r.className}\u0000${r.studentId}`; if(seen.has(k))throw new Error(`重复编号：${r.className} / ${r.studentId}`); seen.add(k);}
        if(!data.length)throw new Error('没有读取到学生数据。'); resolve(data);
      }catch(e){reject(e);}
    };
    reader.readAsArrayBuffer(file);
  });
}
function renderRosterPreview(rows){
  const cs=[...new Set(rows.map(r=>r.className))];
  $('rosterPreview').innerHTML=`<strong>读取成功</strong><span>${cs.length} 个班 · ${rows.length} 名学生</span><small>示例：${rows.slice(0,3).map(r=>`${r.className} / ${r.studentId} / ${r.studentName}`).join('；')}${rows.length>3?'…':''}</small>`;
  $('rosterPreview').classList.remove('hidden');
}
async function handleRosterFile(){
  rosterErr(''); const file=$('rosterFile').files?.[0]; pendingRoster=[]; $('confirmRosterBtn').disabled=true;
  if(!file)return; $('rosterFileName').textContent=file.name;
  try{ pendingRoster=await parseWorkbook(file); renderRosterPreview(pendingRoster); $('confirmRosterBtn').disabled=false; }
  catch(e){rosterErr(e.message); $('rosterPreview').classList.add('hidden');}
}
async function saveRoster(){
  if(!pendingRoster.length)return; rosterErr(''); $('confirmRosterBtn').disabled=true; $('confirmRosterBtn').textContent='正在上传…';
  try{
    const res=await api('/api/admin/roster',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({students:pendingRoster})}); const data=await res.json().catch(()=>({}));
    if(!res.ok)throw new Error(data.error||'名单上传失败');
    closeRosterModal(); await loadStudents(); alert(`名单已更新：${data.classCount} 个班，共 ${data.count} 名学生。原有聊天记录不会删除。`);
  }catch(e){rosterErr(e.message);} finally{$('confirmRosterBtn').disabled=false; $('confirmRosterBtn').textContent='确认上传并替换名单';}
}
function downloadTemplate(){
  if(!window.XLSX){alert('Excel 组件未加载，请刷新页面后重试。');return;}
  const data=[['班级','学生编号','姓名'],['七年级1班','S01','张三'],['七年级1班','S02','李四'],['七年级2班','S01','王五']];
  const ws=XLSX.utils.aoa_to_sheet(data); ws['!cols']=[{wch:18},{wch:14},{wch:14}]; const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,'学生名单'); XLSX.writeFile(wb,'学生名单模板.xlsx');
}
async function download(path,filename){ const res=await api(path); if(!res.ok){const data=await res.json().catch(()=>({}));throw new Error(data.error||'导出失败');} const blob=await res.blob(),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),5000); }

$('adminLoginBtn').addEventListener('click',login);
$('adminPassword').addEventListener('keydown',e=>{if(e.key==='Enter')login();});
$('classFilter').addEventListener('change',renderStudents);
$('refreshBtn').addEventListener('click',()=>loadStudents().catch(e=>alert(e.message)));
$('uploadRosterBtn').addEventListener('click',openRosterModal);
$('downloadTemplateBtn').addEventListener('click',downloadTemplate);
$('rosterModalClose').addEventListener('click',closeRosterModal);
document.querySelector('[data-close-roster-modal]').addEventListener('click',closeRosterModal);
$('rosterFile').addEventListener('change',handleRosterFile);
$('confirmRosterBtn').addEventListener('click',saveRoster);
$('exportJsonBtn').addEventListener('click',()=>download('/api/admin/export?format=json','ai-dynamic-scaffold.json').catch(e=>alert(e.message)));
$('exportCsvBtn').addEventListener('click',()=>download('/api/admin/export?format=csv','ai-dynamic-scaffold.csv').catch(e=>alert(e.message)));
$('logoutBtn').addEventListener('click',async()=>{try{await api('/api/admin/logout',{method:'POST'});}catch{} token='';sessionStorage.removeItem('ads_admin_token');showLogin();});
window.addEventListener('beforeunload',()=>imageUrls.forEach(u=>URL.revokeObjectURL(u)));

(async function boot(){ if(!token)return showLogin(); try{showDash();await loadStudents();}catch{showLogin();} })();
