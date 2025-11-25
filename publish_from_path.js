// 从本地 Markdown 路径发布到飞书知识库父页面（读取 Front Matter 的 feishu/feishu_parent）
// 用途：辅助验证 Obsidian 发布失败时，排除内容与API流程问题

const fs = require('fs');
const path = require('path');
const https = require('https');

const CONFIG_PATH = './data.json';
const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));

const FEISHU = {
  BASE: 'https://open.feishu.cn/open-apis',
  OAUTH_TOKEN: 'https://open.feishu.cn/open-apis/authen/v2/oauth/token',
  USER_INFO: 'https://open.feishu.cn/open-apis/authen/v1/user_info',
  UPLOAD_MEDIA: 'https://open.feishu.cn/open-apis/drive/v1/medias/upload_all',
  IMPORT_TASKS: 'https://open.feishu.cn/open-apis/drive/v1/import_tasks',
  IMPORT_TASK: (ticket) => `https://open.feishu.cn/open-apis/drive/v1/import_tasks/${ticket}`,
  MOVE_TO_WIKI: (spaceId) => `https://open.feishu.cn/open-apis/wiki/v2/spaces/${spaceId}/nodes/move_docs_to_wiki`,
  LIST_NODES: (spaceId) => `https://open.feishu.cn/open-apis/wiki/v2/spaces/${spaceId}/nodes`,
  GET_NODE: (spaceId, nodeToken) => `https://open.feishu.cn/open-apis/wiki/v2/spaces/${spaceId}/nodes/${nodeToken}`,
  GET_NODE_SPACE: (nodeToken) => `https://open.feishu.cn/open-apis/wiki/v2/spaces/get_node?token=${nodeToken}`,
};

function sleep(ms){return new Promise(r=>setTimeout(r,ms));}

async function api({url, method='GET', headers={}, body}){
  return new Promise((resolve,reject)=>{
    const req = https.request(url,{method,headers},res=>{
      let data='';
      res.on('data',c=>data+=c);
      res.on('end',()=>{
        try{resolve({status:res.statusCode, data: JSON.parse(data), raw:data, headers: res.headers});}
        catch(e){resolve({status:res.statusCode, data:null, raw:data, headers: res.headers});}
      });
    });
    req.on('error',reject);
    if(body!==undefined){
      if(Buffer.isBuffer(body) || typeof body==='string') req.write(body);
      else req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function refreshTokenIfNeeded() {
  const test = await api({url: FEISHU.USER_INFO, headers: {Authorization:`Bearer ${config.accessToken}`}});
  if (test.data && test.data.code === 0) return true;
  if (!config.refreshToken) return false;
  const r = await api({url: FEISHU.OAUTH_TOKEN, method:'POST', headers:{'Content-Type':'application/json'}, body:{grant_type:'refresh_token', client_id:config.appId, client_secret:config.appSecret, refresh_token:config.refreshToken}});
  if (r.data && r.data.code===0) {
    const at = r.data.access_token || r.data.data?.access_token;
    const rt = r.data.refresh_token || r.data.data?.refresh_token;
    if (at) { config.accessToken = at; if (rt) config.refreshToken = rt; fs.writeFileSync(CONFIG_PATH, JSON.stringify(config,null,2)); return true; }
  }
  return false;
}

function parseFM(md){
  const m = md.match(/^---\s*\n([\s\S]*?)\n---\s*\n/);
  const obj={};
  if(!m) return obj;
  const lines = m[1].split('\n');
  for(const line of lines){
    const i=line.indexOf(':'); if(i<0) continue; const k=line.slice(0,i).trim(); let v=line.slice(i+1).trim();
    if ((v.startsWith('"')&&v.endsWith('"'))||(v.startsWith("'")&&v.endsWith("'"))) v=v.slice(1,-1);
    obj[k]=v;
  }
  return obj;
}

async function getSpaceIdByNode(nodeToken){
  const r = await api({url: FEISHU.GET_NODE_SPACE(nodeToken), headers:{Authorization:`Bearer ${config.accessToken}`}});
  if (r.data && r.data.code===0){
    const node = r.data.data?.node;
    return node?.space_id || node?.origin_space_id || '';
  }
  return '';
}

async function uploadAndImport(title, content){
  const boundary='---7MA4YWxkTrZu0gW';
  const utf8=Buffer.from(content,'utf8');
  const parts=[]; const push=s=>parts.push(Buffer.from(s,'utf8'));
  push(`--${boundary}\r\n`); push('Content-Disposition: form-data; name="file_name"\r\n\r\n'); push(`${title}.md\r\n`);
  push(`--${boundary}\r\n`); push('Content-Disposition: form-data; name="parent_type"\r\n\r\n'); push('ccm_import_open\r\n');
  push(`--${boundary}\r\n`); push('Content-Disposition: form-data; name="size"\r\n\r\n'); push(String(utf8.length)+'\r\n');
  push(`--${boundary}\r\n`); push('Content-Disposition: form-data; name="extra"\r\n\r\n'); push('{"obj_type":"docx","file_extension":"md"}\r\n');
  push(`--${boundary}\r\n`); push(`Content-Disposition: form-data; name="file"; filename="${title}.md"\r\n`); push('Content-Type: text/markdown\r\n\r\n');
  parts.push(utf8); push(`\r\n--${boundary}--\r\n`);
  const body=Buffer.concat(parts);
  const up = await api({url: FEISHU.UPLOAD_MEDIA, method:'POST', headers:{Authorization:`Bearer ${config.accessToken}`,'Content-Type':`multipart/form-data; boundary=${boundary}`}, body});
  if (!(up.data && up.data.code===0)) return {success:false, error: up.data? up.data.msg : up.raw};
  const token=up.data.data.file_token;
  const impBody = {file_extension:'md', file_token: token, type:'docx', file_name: title, point:{ mount_type:1, mount_key: config.defaultFolderId || 'nodcn2EG5YG1i5Rsh5uZs0FsUje' }};
  const imp = await api({url: FEISHU.IMPORT_TASKS, method:'POST', headers:{Authorization:`Bearer ${config.accessToken}`,'Content-Type':'application/json'}, body: impBody});
  if (!(imp.data && imp.data.code===0)) return {success:false, error: imp.data? imp.data.msg : imp.raw};
  const ticket=imp.data.data.ticket; const start=Date.now();
  while(Date.now()-start<30000){
    const st = await api({url: FEISHU.IMPORT_TASK(ticket), headers:{Authorization:`Bearer ${config.accessToken}`}});
    if (st.data && st.data.code===0){ const r=st.data.data.result; if (r?.token) return {success:true, documentToken:r.token}; if (r?.file_token && r.job_status===1) return {success:true, documentToken:r.file_token}; if (r?.job_status===2) return {success:false, error:'导入失败'}; }
    await sleep(1000);
  }
  return {success:false, error:'导入超时'};
}

async function createEmptyDoc(title){
  const r = await api({url: `${FEISHU.BASE}/docx/v1/documents`, method:'POST', headers:{Authorization:`Bearer ${config.accessToken}`,'Content-Type':'application/json'}, body:{title}});
  if (r.data && r.data.code===0 && r.data.data?.document?.document_id) return {success:true, documentId:r.data.data.document.document_id};
  return {success:false, error: r.data? r.data.msg : r.raw};
}

async function getAllBlocks(documentId){
  const r = await api({url: `${FEISHU.BASE}/docx/v1/documents/${documentId}/blocks?page_size=500`, headers:{Authorization:`Bearer ${config.accessToken}`}});
  if (r.data && r.data.code===0) return r.data.data?.items || [];
  return [];
}

async function clearDoc(documentId){
  const items = await getAllBlocks(documentId);
  const root = items.find(b=>b.block_type===1);
  if (!root) return false;
  const children = root.children || [];
  if (children.length===0) return true;
  const del = await api({url: `${FEISHU.BASE}/docx/v1/documents/${documentId}/blocks/${root.block_id}/children/batch_delete`, method:'DELETE', headers:{Authorization:`Bearer ${config.accessToken}`,'Content-Type':'application/json'}, body:{start_index:0,end_index:children.length}});
  return del.data && del.data.code===0;
}

async function insertCode(documentId, text){
  const items = await getAllBlocks(documentId);
  const root = items.find(b=>b.block_type===1);
  if (!root) return false;
  const req={ index:0, children:[{ block_type:14, code:{ language:'markdown', elements:[{ text_run:{ content:text, text_element_style:{} } }] } }] };
  const r = await api({url: `${FEISHU.BASE}/docx/v1/documents/${documentId}/blocks/${root.block_id}/children`, method:'POST', headers:{Authorization:`Bearer ${config.accessToken}`,'Content-Type':'application/json'}, body:req});
  return r.data && r.data.code===0;
}

function renderMdToBlocks(markdown){
  const lines = markdown.replace(/\r\n/g,"\n").split("\n");
  const blocks=[]; let i=0; let inCode=false; let codeLang='markdown'; let code=[]; let para=[];
  const flushPara=()=>{ if(para.length){ const txt=para.join(' ').trim(); if(txt){ blocks.push({block_type:2, text:{elements: parseInline(txt)}}); } para=[]; } };
  const headingField=(lvl)=>{const type=Math.min(11,Math.max(3,2+lvl)); const map={3:'heading1',4:'heading2',5:'heading3',6:'heading4',7:'heading5',8:'heading6',9:'heading7',10:'heading8',11:'heading9'}; return {type,field:map[type]};};
  while(i<lines.length){ const line=lines[i]; const fence=line.match(/^```(.*)$/);
    if(fence){ if(!inCode){ flushPara(); inCode=true; codeLang=fence[1].trim()||'markdown'; code=[]; } else { blocks.push({block_type:14, code:{language:codeLang, elements:[{text_run:{content:code.join('\n')}}]}}); inCode=false; } i++; continue; }
    if(inCode){ code.push(line); i++; continue; }
    if(/^\s*$/.test(line)){ flushPara(); i++; continue; }
    const h=line.match(/^(#{1,6})\s+(.*)$/); if(h){ flushPara(); const {type,field}=headingField(h[1].length); const b={block_type:type}; b[field]={elements:[{text_run:{content:h[2]}}]}; blocks.push(b); i++; continue; }
    const q=line.match(/^>\s?(.*)$/); if(q){ flushPara(); blocks.push({block_type:15, quote:{elements:[{text_run:{content:q[1]}}]}}); i++; continue; }
    const todo=line.match(/^[-*]\s+\[( |x|X)\]\s+(.*)$/); if(todo){ flushPara(); blocks.push({block_type:17, todo:{elements:[{text_run:{content:todo[2]}}]}}); i++; continue; }
    const ul=line.match(/^[-*]\s+(.*)$/); if(ul){ flushPara(); blocks.push({block_type:12, bullet:{elements:[{text_run:{content:ul[1]}}]}}); i++; continue; }
    const ol=line.match(/^\d+[.)]\s+(.*)$/); if(ol){ flushPara(); blocks.push({block_type:13, ordered:{elements:[{text_run:{content:ol[1]}}]}}); i++; continue; }
    para.push(line.trim()); i++;
  }
  flushPara(); return blocks;
}

async function insertBlocks(documentId, blocks){
  const items=await getAllBlocks(documentId); const root=items.find(b=>b.block_type===1); if(!root) return false; await clearDoc(documentId);
  for(let start=0; start<blocks.length; start+=40){ const slice=blocks.slice(start,start+40);
    const r=await api({url:`${FEISHU.BASE}/docx/v1/documents/${documentId}/blocks/${root.block_id}/children`, method:'POST', headers:{Authorization:`Bearer ${config.accessToken}`,'Content-Type':'application/json'}, body:{index:start, children:slice}});
    if(!(r.data && r.data.code===0)) return false;
  }
  return true;
}

async function moveToParent(spaceId, docToken, parentNode){
  const r = await api({url: FEISHU.MOVE_TO_WIKI(spaceId), method:'POST', headers:{Authorization:`Bearer ${config.accessToken}`,'Content-Type':'application/json'}, body:{obj_type:'docx', obj_token: docToken, parent_wiki_token: parentNode}});
  if (r.data && r.data.code===0) return {success:true, wikiToken:r.data.data.wiki_token};
  return {success:false, error:r.data? r.data.msg : r.raw};
}

async function verifyUnderParent(spaceId, parentNode, expectTitle, expectToken){
  const start=Date.now();
  while(Date.now()-start<60000){
    const url = new URL(FEISHU.LIST_NODES(spaceId));
    url.searchParams.set('page_size','50');
    url.searchParams.set('parent_node_token', parentNode);
    const r = await api({url: url.toString(), headers:{Authorization:`Bearer ${config.accessToken}`}});
    if (r.data && r.data.code===0){
      const items=r.data.data?.items||[];
      let hit = items.find(i=>i.title===expectTitle);
      if (!hit && expectToken) hit = items.find(i=>i.obj_token===expectToken);
      if (hit) return {ok:true, node: hit};
    }
    await sleep(1000);
  }
  return {ok:false};
}

async function main(){
  const filePath = process.argv[2];
  if (!filePath) { console.log('用法: node publish_from_path.js "/abs/path/to/file.md"'); process.exit(1); }
  if (!fs.existsSync(filePath)) { console.log('❌ 文件不存在:', filePath); process.exit(1); }

  if (!(await refreshTokenIfNeeded())) { console.log('❌ 授权无效或刷新失败'); process.exit(1); }

  const raw = fs.readFileSync(filePath,'utf8');
  const fm = parseFM(raw);
  const parentUrl = fm.feishu || fm.feishu_parent || fm['feishu.parent'] || fm.feishu_parent_url || fm.parent_feishu_url || '';
  if (!parentUrl) { console.log('❌ Front Matter 中未找到父页面链接（feishu 或 feishu_parent）'); process.exit(1); }
  const m = parentUrl.match(/https:\/\/([\w-]+)\.feishu\.cn\/wiki\/([A-Za-z0-9]+)/);
  if (!m) { console.log('❌ 无法解析父页面URL:', parentUrl); process.exit(1); }
  const parentNode = m[2];
  const spaceId = await getSpaceIdByNode(parentNode);
  if (!spaceId) { console.log('❌ 无法获取空间ID，请检查父页面权限'); process.exit(1); }

  const title = path.basename(filePath, path.extname(filePath));
  // 去掉 Front Matter
  const content = raw.replace(/^---[\s\S]*?---\s*\n/, '');

  console.log('📤 上传并导入...', title);
  let imp = await uploadAndImport(title, content);
  if (!imp.success){
    console.log('⚠️ 导入失败，走兜底：创建空白doc并写入代码块');
    const c = await createEmptyDoc(title);
    if (!c.success) { console.log('❌ 创建空白文档失败:', c.error); process.exit(1); }
    const blocks = renderMdToBlocks(content);
    const wrote = await insertBlocks(c.documentId, blocks);
    if (!wrote) { console.log('❌ 写入内容失败'); process.exit(1); }
    imp = { success:true, documentToken: c.documentId };
  } else {
    console.log('✅ 文档创建成功:', imp.documentToken);
  }

  console.log('📍 移动到父页面...');
  const mv = await moveToParent(spaceId, imp.documentToken, parentNode);
  if (!mv.success){ console.log('❌ 移动失败:', mv.error); process.exit(1); }

  console.log('🔍 校验父页面下是否存在...');
  const ver = await verifyUnderParent(spaceId, parentNode, title, imp.documentToken);
  if (!ver.ok){ console.log('⚠️ 创建成功但暂未在父页面列表中查到，请稍后刷新'); process.exit(2); }

  console.log('🎉 成功发布');
  console.log('- 标题:', title);
  console.log('- 文档URL:', `https://feishu.cn/docx/${imp.documentToken}`);
  console.log('- 父节点:', parentNode);
}

main().catch(e=>{ console.error('❌ 运行失败:', e.message); process.exit(1); });
