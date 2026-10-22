const $=id=>document.getElementById(id);
const state={studentKey:'',studentName:'',taskId:'',taskLabel:'',conversationId:'',requiresInitialImage:false,selectedFile:null,sending:false,taskPoll:null,activeChoices:[]};
const FALLBACK_CHOICES=[
  {key:'A',text:'继续给我一点提示'},
  {key:'B',text:'我还不太明白，请换一种简单说法'},
  {key:'C',text:'我想先自己试一试'}
];
function fmtTime(iso){try{return new Date(iso).toLocaleString('zh-CN',{hour12:false});}catch{return'';}}
function showError(text){$('loginError').textContent=text;$('loginError').classList.toggle('hidden',!text);}
function showAdminError(text=''){$('coverAdminError').textContent=text;$('coverAdminError').classList.toggle('hidden',!text);}
function openAdminModal(){showAdminError('');$('coverAdminPassword').value='';$('adminModal').classList.remove('hidden');document.body.classList.add('modal-open');setTimeout(()=>$('coverAdminPassword').focus(),0);}
function closeAdminModal(){$('adminModal').classList.add('hidden');document.body.classList.remove('modal-open');showAdminError('');}
async function coverAdminLogin(){showAdminError('');const password=$('coverAdminPassword').value;if(!password)return showAdminError('请输入管理员密码。');$('coverAdminLoginBtn').disabled=true;try{const res=await fetch('/api/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password})});const data=await res.json().catch(()=>({}));if(!res.ok)throw new Error(data.error||'登录失败');sessionStorage.setItem('ads_admin_token',data.token);localStorage.setItem('ads_admin_token',data.token);location.href='/admin.html#auth='+encodeURIComponent(data.token);}catch(e){showAdminError(e.message);}finally{$('coverAdminLoginBtn').disabled=false;}}
function scrollBottom(){const el=$('messages');el.scrollTop=el.scrollHeight;}
function normalizeChoiceKey(key){return String(key||'').trim().toUpperCase().replace('Ａ','A').replace('Ｂ','B').replace('Ｃ','C');}
function normalizeOption(option,index){if(typeof option==='string')return {key:['A','B','C'][index]||'',text:option.trim()};if(option&&typeof option==='object')return {key:normalizeChoiceKey(option.key||option.id||option.label||['A','B','C'][index]),text:String(option.text||option.value||option.content||option.title||'').trim()};return null;}
function parseChoiceResponse(raw=''){
  const original=String(raw||'').trim();
  if(!original)return {displayText:'AI 已回复，请选择下面一个选项。',options:FALLBACK_CHOICES,fallback:true};
  const unwrapped=original.replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'').trim();
  try{
    const obj=JSON.parse(unwrapped);
    let opts=[];
    if(Array.isArray(obj.options))opts=obj.options.map(normalizeOption).filter(Boolean);
    else if(obj.options&&typeof obj.options==='object')opts=['A','B','C'].map(k=>({key:k,text:String(obj.options[k]||obj.options[k.toLowerCase()]||'').trim()}));
    else opts=['A','B','C'].map(k=>({key:k,text:String(obj[k]||obj[k.toLowerCase()]||'').trim()}));
    const map=new Map(opts.filter(x=>x&&['A','B','C'].includes(normalizeChoiceKey(x.key))&&x.text).map(x=>[normalizeChoiceKey(x.key),{key:normalizeChoiceKey(x.key),text:x.text}]));
    if(['A','B','C'].every(k=>map.has(k))){
      const displayText=[obj.reply||obj.feedback||obj.message||obj.text||'',obj.question||obj.prompt||''].map(x=>String(x||'').trim()).filter(Boolean).join('\n\n')||'请选择下面一个选项。';
      return {displayText,options:['A','B','C'].map(k=>map.get(k)),fallback:false};
    }
  }catch{}
  const lines=original.split(/\r?\n/);const found=new Map(),kept=[];
  const re=/^\s*[（(]?\s*([ABCＡＢＣ])\s*[）)\.．、:：]\s*(.+?)\s*$/i;
  for(const line of lines){const m=line.match(re);if(m){const key=normalizeChoiceKey(m[1]);if(!found.has(key)&&m[2].trim())found.set(key,{key,text:m[2].trim()});}else kept.push(line);}
  if(['A','B','C'].every(k=>found.has(k))){
    let displayText=kept.join('\n').replace(/^\s*(QUESTION|问题|请选择)\s*[:：]\s*/im,'').trim();
    if(!displayText)displayText='请选择下面一个选项。';
    return {displayText,options:['A','B','C'].map(k=>found.get(k)),fallback:false};
  }
  return {displayText:original,options:FALLBACK_CHOICES,fallback:true};
}
function studentImageUrl(imageId){if(!imageId||!state.studentKey||!state.studentName||!state.taskId)return '';const qs=new URLSearchParams({studentKey:state.studentKey,studentName:state.studentName,taskId:state.taskId,imageId});return `/api/student/image?${qs.toString()}`;}
function deactivateInlineChoices(selectedKey=''){
  document.querySelectorAll('.inline-choice-list[data-current="true"]').forEach(group=>{
    group.dataset.current='false';
    group.querySelectorAll('.inline-choice-button').forEach(btn=>{
      btn.dataset.active='false';btn.disabled=true;
      if(selectedKey&&btn.dataset.choiceKey===selectedKey)btn.classList.add('selected');
    });
  });
}
function reactivateLatestInlineChoices(){
  const groups=[...document.querySelectorAll('.inline-choice-list')];const group=groups.at(-1);if(!group)return;
  group.dataset.current='true';
  group.querySelectorAll('.inline-choice-button').forEach(btn=>{btn.dataset.active='true';btn.classList.remove('selected');btn.disabled=state.sending||state.requiresInitialImage;});
}
function appendInlineChoices(bubble,options=[],fallback=false){
  deactivateInlineChoices();
  state.activeChoices=Array.isArray(options)?options:[];
  if(!state.activeChoices.length)return;
  const group=document.createElement('div');group.className='inline-choice-list';group.dataset.current='true';
  const hint=document.createElement('div');hint.className='inline-choice-hint';hint.textContent=fallback?'点一个选项继续':'直接点一个选项回答';group.appendChild(hint);
  for(const option of state.activeChoices){
    const btn=document.createElement('button');btn.type='button';btn.className='inline-choice-button';btn.dataset.choiceKey=option.key;btn.dataset.active='true';btn.disabled=state.sending||state.requiresInitialImage;
    const badge=document.createElement('span');badge.className='inline-choice-key';badge.textContent=option.key;
    const text=document.createElement('span');text.className='inline-choice-text';text.textContent=option.text;
    btn.append(badge,text);btn.addEventListener('click',()=>sendChoice(option));group.appendChild(btn);
  }
  bubble.appendChild(group);
}
function renderMessage(msg,{parseAssistant=false}={}){
  $('chatEmpty')?.remove();
  const wrap=document.createElement('div');wrap.className=`msg ${msg.role==='user'?'user':'assistant'}`;
  const bubble=document.createElement('div');bubble.className='bubble';
  if(msg.localImageUrl){const img=document.createElement('img');img.className='msg-image';img.src=msg.localImageUrl;img.alt='上传图片';img.title='点击查看原图';img.addEventListener('click',()=>window.open(img.src,'_blank','noopener,noreferrer'));bubble.appendChild(img);}
  let parsed=null;
  if(msg.text){
    const t=document.createElement('div');
    if(msg.role==='assistant'&&parseAssistant){parsed=parseChoiceResponse(msg.text);t.textContent=parsed.displayText;}
    else t.textContent=msg.text;
    bubble.appendChild(t);
  }
  if(msg.role==='assistant'&&parseAssistant&&parsed)appendInlineChoices(bubble,parsed.options,parsed.fallback);
  const tm=document.createElement('span');tm.className='msg-time';tm.textContent=fmtTime(msg.createdAt||new Date().toISOString());bubble.appendChild(tm);
  wrap.appendChild(bubble);$('messages').appendChild(wrap);scrollBottom();return parsed;
}
function setTaskUi(){$('currentTaskBadge').textContent=state.taskLabel||'';$('studentMeta').textContent=state.studentName;}
function showTaskNotice(text){const el=$('taskNotice');el.textContent=text;el.classList.remove('hidden');setTimeout(()=>el.classList.add('hidden'),4500);}
function setChoiceState(options=[]){state.activeChoices=Array.isArray(options)?options:[];}
function setChoicesFromAnswer(answer){const parsed=parseChoiceResponse(answer);state.activeChoices=parsed.options;return parsed;}
function updateInteractionUi(){
  const on=state.sending;$('processingOverlay').classList.toggle('hidden',!on);$('imageInput').disabled=on;$('removeImageBtn').disabled=on;$('switchBtn').disabled=on;$('sendImageBtn').disabled=on||!state.selectedFile;
  document.querySelectorAll('.inline-choice-button[data-active="true"]').forEach(btn=>btn.disabled=on||state.requiresInitialImage);
  $('sendImageBtn').textContent=on?'AI 处理中…':(state.requiresInitialImage?'发送作品图片':'发送新作品');
  $('imagePickerLabel').textContent=state.selectedFile?'更换图片':'选择图片';
  $('imageActionTitle').textContent=state.requiresInitialImage?'先上传本任务作品':'上传修改后的作品';
  $('imageActionHint').textContent=state.requiresInitialImage?'这是开始本任务的第一步。':'如果你修改了程序，可以上传新截图让 AI 继续看。';
  if(on){$('sendStatus').textContent='AI 正在处理，请稍候…';scrollBottom();}else $('sendStatus').textContent='';
  if(state.requiresInitialImage){state.activeChoices=[];deactivateInlineChoices();}
}
function setProcessingUI(on){state.sending=!!on;updateInteractionUi();}
async function startStudent(studentName){const res=await fetch('/api/student/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({studentName})});const data=await res.json().catch(()=>({}));if(!res.ok)throw new Error(data.error||'进入失败');return data;}
function applyStudentData(data,{notice=false}={}){const oldTask=state.taskId;state.studentKey=data.studentKey;state.studentName=data.studentName;state.taskId=data.taskId;state.taskLabel=data.taskLabel;state.conversationId=data.conversationId||'';state.requiresInitialImage=!!data.requiresInitialImage;state.activeChoices=[];setTaskUi();showChat(data.messages||[]);updateInteractionUi();if(notice&&oldTask&&oldTask!==state.taskId)showTaskNotice(`老师已切换到${state.taskLabel}，请先上传本任务的作品图片。`);}
async function enter(){showError('');const name=$('studentName').value.trim();if(!name)return showError('请输入姓名。');$('enterBtn').disabled=true;$('enterBtn').innerHTML='正在进入…';try{applyStudentData(await startStudent(name));startTaskWatcher();}catch(e){showError(e.message);}finally{$('enterBtn').disabled=false;$('enterBtn').innerHTML='进入学习平台 <span aria-hidden="true">→</span>';}}
function showChat(history=[]){
  $('loginView').classList.add('hidden');$('chatView').classList.remove('hidden');setTaskUi();$('messages').innerHTML='';state.activeChoices=[];
  if(!history.length){const empty=document.createElement('div');empty.id='chatEmpty';empty.className='chat-empty';empty.innerHTML=`<div class="chat-empty-icon">▧</div><strong>${state.taskLabel}：先上传作品图片</strong><span>每个新任务都从作品图片开始。AI 给出 A / B / C 后，直接在对话里点选，不需要打字。</span>`;$('messages').appendChild(empty);return;}
  const lastIndex=history.length-1;
  history.forEach((m,i)=>{const isActiveAssistant=!state.requiresInitialImage&&i===lastIndex&&m.role==='assistant';const parsed=renderMessage({role:m.role,text:m.text,createdAt:m.createdAt,localImageUrl:m.imageId?studentImageUrl(m.imageId):''},{parseAssistant:isActiveAssistant});if(parsed)state.activeChoices=parsed.options;});
}
function clearImage(){state.selectedFile=null;$('imageInput').value='';$('previewRow').classList.add('hidden');$('previewImage').src='';$('previewName').textContent='';updateInteractionUi();}
async function responseError(res,fallback='请求失败'){const type=res.headers.get('content-type')||'';if(type.includes('application/json')){const d=await res.json().catch(()=>({}));const e=new Error(d.error||d.message||`${fallback}（HTTP ${res.status}）`);e.data=d;e.status=res.status;return e;}const txt=(await res.text().catch(()=>'' )).trim();return new Error(txt&&txt.length<300?`${fallback}：${txt}`:`${fallback}（HTTP ${res.status}）`);}
async function pollChatStatus({conversationId,chatId,taskId}){let cid=conversationId,chid=chatId,retryAttempt=0;for(let i=0;i<120;i++){const qs=new URLSearchParams({studentKey:state.studentKey,studentName:state.studentName,taskId,conversationId:cid,chatId:chid,retryAttempt:String(retryAttempt)});const res=await fetch(`/api/chat/status?${qs}`,{cache:'no-store'});const data=await res.json().catch(()=>({}));if(data.status==='retrying'&&data.conversationId&&data.chatId){cid=data.conversationId;chid=data.chatId;retryAttempt=1;state.conversationId=cid;$('sendStatus').textContent='AI 正在重新连接，请稍候…';await new Promise(r=>setTimeout(r,900));continue;}if(!res.ok)throw new Error(data.error||'AI助手暂时没有成功回复，请稍后再试。');if(data.status==='completed'){state.conversationId=data.conversationId||cid;return data;}if(data.status==='failed')throw new Error(data.error||'AI助手暂时没有成功回复，请稍后再试。');$('sendStatus').textContent='AI 正在处理，请稍候…';await new Promise(r=>setTimeout(r,1200));}throw new Error('AI 回复时间较长，请稍后再试。');}
async function refreshToCurrentTask({notice=true}={}){if(!state.studentName||state.sending)return;const data=await startStudent(state.studentName);if(data.taskId!==state.taskId)applyStudentData(data,{notice});}
function startTaskWatcher(){clearInterval(state.taskPoll);state.taskPoll=setInterval(async()=>{try{const res=await fetch('/api/task/current',{cache:'no-store'});const data=await res.json().catch(()=>({}));if(res.ok&&data.activeTask?.id&&data.activeTask.id!==state.taskId&&!state.sending)await refreshToCurrentTask({notice:true});}catch{}},5000);}
async function sendTurn({text='',file=null,choiceKey='',choiceText='',recoveryChoices=[]}={}){
  if(state.sending)return;if(state.requiresInitialImage&&!file){alert('本任务第一次提交请先上传作品图片。');return;}if(!text&&!file)return;if(file&&file.size>10*1024*1024)return alert('图片请控制在 10 MB 以内。');
  setProcessingUI(true);const taskAtSend=state.taskId;const localImageUrl=file?URL.createObjectURL(file):null;renderMessage({role:'user',text:text||(file?'（上传了一张作品图片）':''),localImageUrl,createdAt:new Date().toISOString()});state.activeChoices=[];
  const form=new FormData();form.append('studentKey',state.studentKey);form.append('studentName',state.studentName);form.append('taskId',taskAtSend);form.append('message',text);if(state.conversationId)form.append('conversationId',state.conversationId);if(choiceKey)form.append('choiceKey',choiceKey);if(choiceText)form.append('choiceText',choiceText);if(file)form.append('image',file,file.name);
  try{
    const res=await fetch('/api/chat',{method:'POST',body:form});if(!res.ok){const e=await responseError(res,'发送失败');if(e.status===409&&e.data?.activeTask){await refreshToCurrentTask({notice:true});return;}throw e;}
    const data=await res.json().catch(()=>({}));state.conversationId=data.conversationId||state.conversationId;if(file){state.requiresInitialImage=false;clearImage();}
    const done=await pollChatStatus({conversationId:data.conversationId,chatId:data.chatId,taskId:taskAtSend});if(state.taskId===taskAtSend){const parsed=renderMessage({role:'assistant',text:done.answer||'AI 没有返回文字回复。',createdAt:done.createdAt},{parseAssistant:true});if(parsed)state.activeChoices=parsed.options;}
  }catch(e){if(state.taskId===taskAtSend){renderMessage({role:'assistant',text:e.message||'AI助手暂时没有成功回复，请稍后再试。',createdAt:new Date().toISOString()});if(recoveryChoices.length){state.activeChoices=recoveryChoices;reactivateLatestInlineChoices();}}}
  finally{setProcessingUI(false);try{await refreshToCurrentTask({notice:true});}catch{}}
}
async function sendChoice(option){if(state.sending||state.requiresInitialImage)return;const choices=[...state.activeChoices];const key=normalizeChoiceKey(option.key),text=String(option.text||'').trim();if(!['A','B','C'].includes(key)||!text)return;deactivateInlineChoices(key);await sendTurn({text:`${key}. ${text}`,choiceKey:key,choiceText:text,recoveryChoices:choices});}
async function sendImage(){const file=state.selectedFile;if(!file)return alert('请先选择一张作品图片。');await sendTurn({file});}
$('adminEntryBtn').addEventListener('click',openAdminModal);$('adminModalClose').addEventListener('click',closeAdminModal);document.querySelector('[data-close-admin-modal]').addEventListener('click',closeAdminModal);$('coverAdminLoginBtn').addEventListener('click',coverAdminLogin);$('coverAdminPassword').addEventListener('keydown',e=>{if(e.key==='Enter')coverAdminLogin();});$('enterBtn').addEventListener('click',enter);$('studentName').addEventListener('keydown',e=>{if(e.key==='Enter')enter();});$('sendImageBtn').addEventListener('click',sendImage);$('imageInput').addEventListener('change',()=>{const file=$('imageInput').files?.[0];if(!file){clearImage();return;}if(!file.type.startsWith('image/')){alert('请选择图片文件。');clearImage();return;}state.selectedFile=file;$('previewImage').src=URL.createObjectURL(file);$('previewName').textContent=file.name;$('previewRow').classList.remove('hidden');updateInteractionUi();});$('removeImageBtn').addEventListener('click',clearImage);$('switchBtn').addEventListener('click',()=>{clearInterval(state.taskPoll);Object.assign(state,{studentKey:'',studentName:'',taskId:'',taskLabel:'',conversationId:'',requiresInitialImage:false,selectedFile:null,sending:false,taskPoll:null,activeChoices:[]});$('imageInput').value='';$('previewRow').classList.add('hidden');$('chatView').classList.add('hidden');$('loginView').classList.remove('hidden');$('studentName').value='';});
(function boot(){clearInterval(state.taskPoll);$('chatView').classList.add('hidden');$('loginView').classList.remove('hidden');$('processingOverlay')?.classList.add('hidden');updateInteractionUi();})();
