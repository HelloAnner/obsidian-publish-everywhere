// 测试创建子文档功能
const https = require('https');

// 从data.json读取配置
const config = require('./data.json');

// 父页面URL
const parentUrl = "https://jjspprprpr.feishu.cn/wiki/KjvMwvinuik94PkzxSActonTnFf?fromScene=spaceOverview";

// 测试子文档标题
const testChildTitle = "测试子文档";

// 解析父页面URL
function parseFeishuParentUrl(url) {
    console.log("🔍 解析父页面URL:", url);

    // 匹配知识库页面URL格式
    const wikiMatch = url.match(/https:\/\/([a-zA-Z0-9-]+)\.feishu\.cn\/wiki\/([a-zA-Z0-9]+)/);
    if (wikiMatch) {
        const appId = wikiMatch[1];
        const nodeToken = wikiMatch[2];
        console.log("✅ 知识库页面解析成功:");
        console.log("   App ID:", appId);
        console.log("   节点Token:", nodeToken);
        return {
            parsed: true,
            type: 'wiki',
            nodeToken: nodeToken,
            error: null
        };
    }

    console.log("❌ 无法解析URL格式");
    return {
        parsed: false,
        error: '无法解析URL格式'
    };
}

// 创建子文档
async function createSubDocument(parentNodeToken, spaceId, title, content) {
    console.log("\n🚀 开始创建子文档...");

    const accessToken = config.accessToken;

    // 步骤1: 上传Markdown文件到云空间
    console.log("📤 步骤1: 上传Markdown文件...");
    const uploadResult = await uploadMarkdownFile(title, content, accessToken);

    if (!uploadResult.success) {
        console.log("❌ 文件上传失败:", uploadResult.error);
        return { success: false, error: uploadResult.error };
    }

    console.log("✅ 文件上传成功:", uploadResult.fileToken);

    // 步骤2: 导入为云文档
    console.log("🔄 步骤2: 导入为云文档...");
    const cleanTitle = title.endsWith('.md') ? title.slice(0, -3) : title;
    const importResult = await createImportTask(uploadResult.fileToken, cleanTitle, accessToken);

    if (!importResult.success) {
        console.log("❌ 导入任务创建失败:", importResult.error);
        return { success: false, error: importResult.error };
    }

    console.log("✅ 导入任务创建成功:", importResult.ticket);

    // 步骤3: 等待导入完成
    console.log("⏳ 步骤3: 等待导入完成...");
    const importCompletion = await waitForImportCompletion(importResult.ticket, accessToken);

    if (!importCompletion.success || !importCompletion.documentToken) {
        console.log("❌ 导入失败:", importCompletion.error);
        return { success: false, error: importCompletion.error };
    }

    console.log("✅ 导入完成:", importCompletion.documentToken);

    // 步骤4: 移动到知识库父页面
    console.log("📍 步骤4: 移动到知识库父页面...");
    const moveResult = await moveDocToWiki(spaceId, importCompletion.documentToken, 'docx', parentNodeToken, accessToken);

    if (!moveResult.success) {
        console.log("❌ 移动到知识库失败:", moveResult.error);
        return { success: false, error: moveResult.error };
    }

    console.log("✅ 移动到知识库成功:", moveResult.wikiToken);

    // 步骤5: 验证子文档确实在父页面下
    console.log("🔍 步骤5: 验证子文档...");
    const verification = await verifyChildInParent(spaceId, parentNodeToken, cleanTitle, accessToken);

    if (verification.verified) {
        console.log("✅ 子文档验证成功!");
        const wikiUrl = `https://${config.appId.split('-').shift()}.feishu.cn/wiki/${importCompletion.documentToken}`;
        return {
            success: true,
            url: wikiUrl,
            documentToken: importCompletion.documentToken,
            wikiToken: moveResult.wikiToken
        };
    } else {
        console.log("⚠️ 子文档创建成功但验证失败:", verification.error);
        const wikiUrl = `https://${config.appId.split('-').shift()}.feishu.cn/wiki/${importCompletion.documentToken}`;
        return {
            success: true,
            url: wikiUrl,
            documentToken: importCompletion.documentToken,
            wikiToken: moveResult.wikiToken,
            warning: '创建成功但验证失败'
        };
    }
}

// 上传Markdown文件
async function uploadMarkdownFile(title, content, accessToken) {
    const url = 'https://open.feishu.cn/open-apis/drive/v1/files/upload_all';

    const requestData = {
        file_name: `${title}.md`,
        parent_type: 'explorer',
        parent_node: 'fldcnV3hQJ5q1VQo3K1v9qL9p9b', // 默认文件夹
        size: Buffer.from(content).length,
        file: Buffer.from(content).toString('base64')
    };

    try {
        const response = await makeApiRequest(url, accessToken, requestData, 'POST');

        if (response.code === 0 && response.data) {
            return {
                success: true,
                fileToken: response.data.file_token,
                url: response.data.url
            };
        } else {
            console.log("   ❌ 上传API响应:", JSON.stringify(response, null, 2));
            return {
                success: false,
                error: response.msg || '上传失败'
            };
        }
    } catch (error) {
        return {
            success: false,
            error: error.message
        };
    }
}

// 创建导入任务
async function createImportTask(fileToken, title, accessToken) {
    const url = 'https://open.feishu.cn/open-apis/drive/v1/import_tasks';

    const requestData = {
        file_extension: 'md',
        file_token: fileToken,
        type: 'docx',
        file_name: title
    };

    try {
        const response = await makeApiRequest(url, accessToken, requestData, 'POST');

        if (response.code === 0 && response.data) {
            return {
                success: true,
                ticket: response.data.ticket
            };
        } else {
            return {
                success: false,
                error: response.msg || '导入任务创建失败'
            };
        }
    } catch (error) {
        return {
            success: false,
            error: error.message
        };
    }
}

// 等待导入完成
async function waitForImportCompletion(ticket, accessToken) {
    const url = `https://open.feishu.cn/open-apis/drive/v1/import_tasks/${ticket}`;

    // 最多等待30秒
    const maxAttempts = 30;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            const response = await makeApiRequest(url, accessToken, {}, 'GET');

            if (response.code === 0 && response.data) {
                const result = response.data.result;

                if (result.job_status === 1) { // 导入成功
                    return {
                        success: true,
                        documentToken: result.file_token
                    };
                } else if (result.job_status === 2) { // 导入失败
                    return {
                        success: false,
                        error: '导入失败'
                    };
                }
                // 状态为0表示仍在处理中
            }

            // 等待1秒后重试
            await new Promise(resolve => setTimeout(resolve, 1000));

        } catch (error) {
            return {
                success: false,
                error: error.message
            };
        }
    }

    return {
        success: false,
        error: '导入超时'
    };
}

// 移动到知识库
async function moveDocToWiki(spaceId, objToken, objType, parentNodeToken, accessToken) {
    const url = `https://open.feishu.cn/open-apis/wiki/v2/spaces/${spaceId}/nodes/move_docs_to_wiki`;

    const requestData = {
        obj_type: objType,
        obj_token: objToken
    };

    if (parentNodeToken) {
        requestData.parent_wiki_token = parentNodeToken;
    }

    try {
        const response = await makeApiRequest(url, accessToken, requestData, 'POST');

        if (response.code === 0 && response.data) {
            return {
                success: true,
                wikiToken: response.data.wiki_token,
                taskId: response.data.task_id
            };
        } else {
            return {
                success: false,
                error: response.msg || '移动到知识库失败'
            };
        }
    } catch (error) {
        return {
            success: false,
            error: error.message
        };
    }
}

// 验证子文档
async function verifyChildInParent(spaceId, parentNodeToken, childTitle, accessToken) {
    const url = `https://open.feishu.cn/open-apis/wiki/v2/spaces/${spaceId}/nodes`;

    try {
        const response = await makeApiRequest(url, accessToken, { page_size: 50 }, 'GET');

        if (response.code === 0 && response.data?.items) {
            // 查找父节点下的子节点
            const children = response.data.items.filter(item =>
                item.parent_node_token === parentNodeToken
            );

            // 查找匹配的子页面
            const matchingChild = children.find(item => item.title === childTitle);

            if (matchingChild) {
                return {
                    verified: true,
                    child: matchingChild
                };
            } else {
                return {
                    verified: false,
                    error: '未找到匹配的子文档'
                };
            }
        } else {
            return {
                verified: false,
                error: response.msg || 'API调用失败'
            };
        }
    } catch (error) {
        return {
            verified: false,
            error: error.message
        };
    }
}

// 发起API请求
function makeApiRequest(url, accessToken, body = {}, method = 'GET') {
    return new Promise((resolve, reject) => {
        const options = {
            method: method,
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json; charset=utf-8'
            }
        };

        const req = https.request(url, options, (res) => {
            let data = '';

            res.on('data', (chunk) => {
                data += chunk;
            });

            res.on('end', () => {
                try {
                    const jsonData = JSON.parse(data);
                    resolve(jsonData);
                } catch (error) {
                    console.log("   ❌ 原始响应数据:", data.substring(0, 500));
                    reject(new Error(`JSON解析失败: ${error.message}`));
                }
            });
        });

        req.on('error', (error) => {
            reject(error);
        });

        if (method === 'POST' && Object.keys(body).length > 0) {
            req.write(JSON.stringify(body));
        }

        req.end();
    });
}

async function getSpaceIdByNode(nodeToken, accessToken) {
    const url = `https://open.feishu.cn/open-apis/wiki/v2/spaces/get_node?token=${nodeToken}`;
    try {
        const response = await makeApiRequest(url, accessToken, {}, 'GET');
        if (response.code === 0 && response.data?.node) {
            return response.data.node.space_id || response.data.node.origin_space_id || response.data.space_id || null;
        }
    } catch (error) {
        console.log("❌ 获取空间ID失败:", error.message);
    }
    return null;
}

// 主测试函数
async function main() {
    console.log("🚀 开始测试子文档创建功能\n");

    // 1. 解析父页面URL
    const parsed = parseFeishuParentUrl(parentUrl);
    if (!parsed.parsed) {
        console.log("❌ 父页面URL解析失败:", parsed.error);
        return;
    }

    console.log("✅ 父页面信息:");
    console.log("   类型:", parsed.type);
    console.log("   节点Token:", parsed.nodeToken);
    const spaceId = await getSpaceIdByNode(parsed.nodeToken, config.accessToken);
    if (!spaceId) {
        console.log("❌ 无法获取知识库空间ID");
        return;
    }
    console.log("   空间ID:", spaceId);

    // 2. 创建测试子文档
    const testContent = `# ${testChildTitle}

这是一个测试子文档，用于验证子文档创建功能。

## 测试内容

- 列表项1
- 列表项2
- 列表项3

**加粗文本** 和 *斜体文本*`;

    const result = await createSubDocument(parsed.nodeToken, spaceId, testChildTitle, testContent);

    if (result.success) {
        console.log("\n🎉 子文档创建成功!");
        console.log("   文档URL:", result.url);
        console.log("   文档Token:", result.documentToken);
        if (result.wikiToken) {
            console.log("   知识库Token:", result.wikiToken);
        }
        if (result.warning) {
            console.log("   警告:", result.warning);
        }
    } else {
        console.log("\n❌ 子文档创建失败:", result.error);
    }
}

// 运行测试
main().catch(console.error);
