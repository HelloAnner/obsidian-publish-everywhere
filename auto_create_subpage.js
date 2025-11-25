// 自动创建并验证知识库子页面（使用飞书开放平台API）
// 目标：在给定父页面下创建子页面，且必须通过API查询确认子页面存在
// 说明：
// - 读取/写入配置文件 data.json（包含 appId/appSecret、accessToken、refreshToken、默认空间等）
// - 自动刷新 access_token（使用 v2 接口）并回写 data.json
// - 创建文档采用“素材上传 + 导入任务”的稳定方案，然后移动到知识库父节点下
// - 以两种方式校验：
//   1) 直接按返回的 wiki_token 查询节点并核对 parent_node_token
//   2) 兜底再按父节点列子节点，查到同名标题

const https = require('https');
const fs = require('fs');

// ======== 配置与常量 ========
const CONFIG_PATH = './data.json';
const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));

const FEISHU = {
  BASE: 'https://open.feishu.cn/open-apis',
  // OAuth v2 刷新
  OAUTH_TOKEN: 'https://open.feishu.cn/open-apis/authen/v2/oauth/token',
  // 用户信息（用于快速验证 token 是否可用）
  USER_INFO: 'https://open.feishu.cn/open-apis/authen/v1/user_info',
  // 素材上传（与插件主流程保持一致）
  UPLOAD_MEDIA: 'https://open.feishu.cn/open-apis/drive/v1/medias/upload_all',
  // 导入任务
  IMPORT_TASKS: 'https://open.feishu.cn/open-apis/drive/v1/import_tasks',
  // 获取导入任务状态
  IMPORT_TASK: (ticket) => `https://open.feishu.cn/open-apis/drive/v1/import_tasks/${ticket}`,
  // 移动到知识库
  MOVE_TO_WIKI: (spaceId) => `https://open.feishu.cn/open-apis/wiki/v2/spaces/${spaceId}/nodes/move_docs_to_wiki`,
  // 获取节点详情
  GET_NODE: (spaceId, nodeToken) => `https://open.feishu.cn/open-apis/wiki/v2/spaces/${spaceId}/nodes/${nodeToken}`,
  // 列出节点（用于兜底按父节点过滤）
  LIST_NODES: (spaceId) => `https://open.feishu.cn/open-apis/wiki/v2/spaces/${spaceId}/nodes`,
};

// ======== 简易工具 ========
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function logStep(msg) { console.log(msg); }

// 统一发起请求并处理 token 过期 → 自动刷新 → 重试一次
async function apiRequest({ url, method = 'GET', headers = {}, body = undefined }) {
  const doRequest = () => new Promise((resolve, reject) => {
    const req = https.request(url, { method, headers }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        // 尝试解析 JSON，否则返回原文
        try {
          const json = JSON.parse(data);
          resolve({ status: res.statusCode, data: json, raw: data, headers: res.headers });
        } catch (e) {
          resolve({ status: res.statusCode, data: null, raw: data, headers: res.headers });
        }
      });
    });
    req.on('error', reject);
    if (body !== undefined) {
      if (Buffer.isBuffer(body)) req.write(body);
      else if (typeof body === 'string') req.write(body);
      else req.write(JSON.stringify(body));
    }
    req.end();
  });

  // 首次请求
  let resp = await doRequest();
  if (resp.data && typeof resp.data.code === 'number') {
    const code = resp.data.code;
    if ([99991663, 99991664, 20005, 1].includes(code)) {
      // access_token 无效或过期，刷新后重试一次
      logStep(`⚠️ Token 失效(code=${code})，尝试刷新...`);
      const refreshed = await refreshAccessToken();
      if (!refreshed) return resp; // 刷新失败，直接返回原响应
      // 替换 Authorization 头并重试
      const newHeaders = { ...headers };
      if (newHeaders.Authorization) newHeaders.Authorization = `Bearer ${config.accessToken}`;
      resp = await new Promise((resolve, reject) => {
        const req = https.request(url, { method, headers: newHeaders }, (res) => {
          let data = '';
          res.on('data', (chunk) => data += chunk);
          res.on('end', () => {
            try {
              const json = JSON.parse(data);
              resolve({ status: res.statusCode, data: json, raw: data, headers: res.headers });
            } catch (e) {
              resolve({ status: res.statusCode, data: null, raw: data, headers: res.headers });
            }
          });
        });
        req.on('error', reject);
        if (body !== undefined) {
          if (Buffer.isBuffer(body)) req.write(body);
          else if (typeof body === 'string') req.write(body);
          else req.write(JSON.stringify(body));
        }
        req.end();
      });
    }
  }
  return resp;
}

async function ensureValidToken() {
  if (!config.accessToken) return false;
  const resp = await apiRequest({
    url: FEISHU.USER_INFO,
    method: 'GET',
    headers: { Authorization: `Bearer ${config.accessToken}` },
  });
  if (resp.data && resp.data.code === 0) return true;
  // 如果返回 token 失效错误码，尝试刷新
  return await refreshAccessToken();
}

async function refreshAccessToken() {
  if (!config.refreshToken) {
    console.log('❌ 无 refresh_token，无法刷新');
    return false;
  }
  const body = {
    grant_type: 'refresh_token',
    client_id: config.appId,
    client_secret: config.appSecret,
    refresh_token: config.refreshToken,
  };
  const resp = await apiRequest({
    url: FEISHU.OAUTH_TOKEN,
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body,
  });
  if (resp.data && resp.data.code === 0) {
    // v2 和 v1 格式兼容
    const access = resp.data.access_token || resp.data.data?.access_token;
    const refresh = resp.data.refresh_token || resp.data.data?.refresh_token;
    if (access) {
      config.accessToken = access;
      if (refresh) config.refreshToken = refresh;
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
      console.log('✅ 刷新成功，已更新 data.json');
      return true;
    }
  }
  console.log(`❌ 刷新失败: ${resp.data ? (resp.data.msg || resp.data.error_description) : resp.raw?.slice(0, 120)}`);
  return false;
}

// 上传 Markdown 为“素材”
async function uploadMarkdownMedia(fileName, content) {
  const boundary = '---7MA4YWxkTrZu0gW';
  const finalName = fileName.endsWith('.md') ? fileName : `${fileName}.md`;
  const utf8 = Buffer.from(content, 'utf8');

  const parts = [];
  const push = (s) => parts.push(Buffer.from(s, 'utf8'));

  // 1. file_name
  push(`--${boundary}\r\n`);
  push('Content-Disposition: form-data; name="file_name"\r\n\r\n');
  push(`${finalName}\r\n`);

  // 2. parent_type（素材上传固定）
  push(`--${boundary}\r\n`);
  push('Content-Disposition: form-data; name="parent_type"\r\n\r\n');
  push('ccm_import_open\r\n');

  // 3. size
  push(`--${boundary}\r\n`);
  push('Content-Disposition: form-data; name="size"\r\n\r\n');
  push(String(utf8.length) + '\r\n');

  // 4. extra（指定导入为 docx, 源扩展名 md）
  push(`--${boundary}\r\n`);
  push('Content-Disposition: form-data; name="extra"\r\n\r\n');
  push('{"obj_type":"docx","file_extension":"md"}\r\n');

  // 5. file
  push(`--${boundary}\r\n`);
  push(`Content-Disposition: form-data; name="file"; filename="${finalName}"\r\n`);
  push('Content-Type: text/markdown\r\n\r\n');
  parts.push(utf8);
  push(`\r\n--${boundary}--\r\n`);

  const body = Buffer.concat(parts);
  const resp = await apiRequest({
    url: FEISHU.UPLOAD_MEDIA,
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.accessToken}`,
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
    },
    body,
  });

  if (resp.data && resp.data.code === 0) {
    return { success: true, fileToken: resp.data.data.file_token };
  }
  return { success: false, error: resp.data ? resp.data.msg : resp.raw };
}

// 创建导入任务并等待完成
async function importToDocx(fileToken, title) {
  // 与插件一致，指定挂载点（云空间）
  const req = {
    file_extension: 'md',
    file_token: fileToken,
    type: 'docx',
    file_name: title,
    // 省略 point：让系统使用默认挂载位置（我的空间）提高兼容性
  };
  const create = await apiRequest({
    url: FEISHU.IMPORT_TASKS,
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: req,
  });
  if (!(create.data && create.data.code === 0)) {
    return { success: false, error: create.data ? create.data.msg : create.raw };
  }

  const ticket = create.data.data.ticket;
  const started = Date.now();
  while (Date.now() - started < 30000) { // 最多等30秒
    const st = await apiRequest({
      url: FEISHU.IMPORT_TASK(ticket),
      method: 'GET',
      headers: { Authorization: `Bearer ${config.accessToken}` },
    });
    if (st.data && st.data.code === 0) {
      const r = st.data.data.result;
      // 约定：job_status: 1 成功；优先 token 字段
      if (r?.token) return { success: true, documentToken: r.token };
      if (r?.file_token && r.job_status === 1) return { success: true, documentToken: r.file_token };
      if (r?.job_status === 2) return { success: false, error: '导入失败' };
    }
    await sleep(1000);
  }
  return { success: false, error: '导入超时' };
}

// 直接创建空白 Docx 文档（更简单，优先尝试）
async function createDocxDocument(title, folderToken) {
  const body = folderToken ? { title, folder_token: folderToken } : { title };
  const resp = await apiRequest({
    url: `${FEISHU.BASE}/docx/v1/documents`,
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.accessToken}`,
      'Content-Type': 'application/json',
    },
    body,
  });
  if (resp.data && resp.data.code === 0 && resp.data.data?.document?.document_id) {
    return { success: true, documentToken: resp.data.data.document.document_id };
  }
  return { success: false, error: resp.data ? resp.data.msg : resp.raw };
}

// 移动到知识库父节点
async function moveDocToWiki(spaceId, documentToken, parentNodeToken) {
  const req = { obj_type: 'docx', obj_token: documentToken, parent_wiki_token: parentNodeToken };
  const resp = await apiRequest({
    url: FEISHU.MOVE_TO_WIKI(spaceId),
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: req,
  });
  if (resp.data && resp.data.code === 0) {
    return { success: true, wikiToken: resp.data.data.wiki_token };
  }
  return { success: false, error: resp.data ? resp.data.msg : resp.raw };
}

// 方式A：直接按 wiki_token 查询并校验 parent
async function verifyByNode(spaceId, wikiToken, parentNodeToken, expectTitle) {
  const r = await apiRequest({
    url: FEISHU.GET_NODE(spaceId, wikiToken),
    method: 'GET',
    headers: { Authorization: `Bearer ${config.accessToken}` },
  });
  if (r.data && r.data.code === 0 && r.data.data?.node) {
    const n = r.data.data.node;
    const okParent = n.parent_node_token === parentNodeToken;
    const okTitle = !expectTitle || n.title === expectTitle;
    return { ok: okParent && okTitle, node: n, raw: r.data };
  }
  return { ok: false, raw: r.data || r.raw };
}

// 方式B：按父节点列子节点再匹配标题
async function verifyByListing(spaceId, parentNodeToken, expectTitle, expectObjToken) {
  let pageToken = '';
  for (let i = 0; i < 5; i++) { // 最多翻5页
    const u = new URL(FEISHU.LIST_NODES(spaceId));
    u.searchParams.set('page_size', '50'); // API 限制：1-50
    u.searchParams.set('parent_node_token', parentNodeToken);
    if (pageToken) u.searchParams.set('page_token', pageToken);
    const r = await apiRequest({ url: u.toString(), method: 'GET', headers: { Authorization: `Bearer ${config.accessToken}`, 'Content-Type': 'application/json; charset=utf-8' } });
    if (!(r.data && r.data.code === 0)) return { ok: false, raw: r.data || r.raw };
    const items = r.data.data?.items || [];
    let hit = items.find(it => it.parent_node_token === parentNodeToken && it.title === expectTitle);
    if (!hit && expectObjToken) {
      hit = items.find(it => it.parent_node_token === parentNodeToken && it.obj_token === expectObjToken);
    }
    if (hit) return { ok: true, node: hit };
    pageToken = r.data.data?.page_token || '';
    if (!pageToken) break;
  }
  return { ok: false };
}

async function main() {
  // 1) 解析父页面URL
  const parentUrl = process.env.PARENT_URL || 'https://jjspprprpr.feishu.cn/wiki/KjvMwvinuik94PkzxSActonTnFf?fromScene=spaceOverview';
  const m = parentUrl.match(/https:\/\/([\w-]+)\.feishu\.cn\/wiki\/([A-Za-z0-9]+)/);
  if (!m) { console.log('❌ 父页面URL无法解析'); process.exit(1); }
  const parentNodeToken = m[2];
  const spaceId = config.defaultWikiSpaceId;

  // 2) 确保 token 可用（必要时自动刷新）
  logStep('🔑 检查/刷新令牌...');
  const ok = await ensureValidToken();
  if (!ok) { console.log('❌ 授权失败，请在 data.json 中配置有效的 accessToken/refreshToken'); process.exit(1); }

  // 3) 创建唯一标题并构造内容
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const title = `测试子文档-${ts}`;
  const content = `# ${title}\n\n这是自动化创建的测试子页面。\n\n- 时间: ${new Date().toLocaleString()}\n- 目的: 验证子页面创建并可通过API查询`;

  // 4) 直接创建空白 Docx（首选）
  logStep('📄 创建空白文档...');
  let imp = await createDocxDocument(title);
  if (!imp.success) {
    console.log('⚠️ 直接创建失败，尝试走上传+导入流程:', imp.error);
    // 回退：上传素材 → 导入
    logStep('📤 上传Markdown素材...');
    const up = await uploadMarkdownMedia(title, content);
    if (!up.success) { console.log('❌ 上传失败:', up.error); process.exit(1); }
    logStep(`✅ 上传成功 file_token=${up.fileToken}`);
    logStep('🔄 创建导入任务并等待完成...');
    imp = await importToDocx(up.fileToken, title);
    if (!imp.success) { console.log('❌ 导入失败:', imp.error); process.exit(1); }
    logStep(`✅ 导入成功，document_token=${imp.documentToken}`);
  } else {
    logStep(`✅ 文档已创建，document_token=${imp.documentToken}`);
  }

  // 6) 移动到知识库父节点
  logStep('📍 移动到知识库父页面...');
  const mv = await moveDocToWiki(spaceId, imp.documentToken, parentNodeToken);
  if (!mv.success) { console.log('❌ 移动失败:', mv.error); process.exit(1); }
  logStep(`✅ 移动成功，wiki_token=${mv.wikiToken}`);

  // 7) 轮询验证（先按 wiki_token 精确校验，失败则按列表兜底）
  logStep('🔍 验证子页面是否在父页面下（API查询）...');
  let verified = false; let nodeInfo = null;
  const start = Date.now();
  while (Date.now() - start < 120000) { // 最多120秒，等待搬运与索引刷新
    const byNode = mv.wikiToken ? await verifyByNode(spaceId, mv.wikiToken, parentNodeToken, title) : { ok: false };
    if (byNode.ok) { verified = true; nodeInfo = byNode.node; break; }
    const byList = await verifyByListing(spaceId, parentNodeToken, title, imp.documentToken);
    if (byList.ok) { verified = true; nodeInfo = byList.node; break; }
    await sleep(1000);
  }

  if (!verified) {
    console.log('⚠️ 创建成功但暂未在列表中查到，请稍后在知识库中刷新查看');
    console.log(`URL: https://feishu.cn/docx/${imp.documentToken}`);
    console.log(`父节点: ${parentNodeToken}  空间: ${spaceId}`);
    process.exit(2);
  }

  // 8) 成功结果
  console.log('🎉 子页面创建并验证成功!');
  console.log(`- 标题: ${title}`);
  console.log(`- 文档URL: https://feishu.cn/docx/${imp.documentToken}`);
  console.log(`- wiki_token: ${nodeInfo.node_token || mv.wikiToken}`);
  console.log(`- 父节点: ${nodeInfo.parent_node_token}`);
}

main().catch((e) => {
  console.error('❌ 运行失败:', e.message);
  process.exit(1);
});
