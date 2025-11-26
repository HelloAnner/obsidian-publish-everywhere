// 模拟发布流程
const fs = require('fs');
const path = require('path');

// 从data.json读取配置
const config = require('./data.json');

// 测试文件路径
const testFilePath = './test_subdocument_publish.md';

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

// 读取测试文件
function readTestFile() {
    try {
        const content = fs.readFileSync(testFilePath, 'utf8');

        // 解析frontmatter
        const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n/);
        let frontmatter = {};

        if (frontmatterMatch) {
            const frontmatterContent = frontmatterMatch[1];
            frontmatterContent.split('\n').forEach(line => {
                const match = line.match(/^(\w+):\s*(.+)$/);
                if (match) {
                    frontmatter[match[1]] = match[2].trim();
                }
            });
        }

        // 提取标题
        const titleMatch = content.match(/^#\s+(.+)$/m);
        const title = titleMatch ? titleMatch[1] : '测试子文档';

        return {
            content: content,
            frontmatter: frontmatter,
            title: title,
            filename: path.basename(testFilePath, '.md')
        };
    } catch (error) {
        console.log("❌ 读取测试文件失败:", error.message);
        return null;
    }
}

// 根据节点Token获取空间ID
async function getSpaceIdByNode(nodeToken) {
    const url = `https://open.feishu.cn/open-apis/wiki/v2/spaces/get_node?token=${nodeToken}`;
    try {
        const response = await makeApiRequest(url, config.accessToken);
        if (response.code === 0 && response.data?.node) {
            return response.data.node.space_id || response.data.node.origin_space_id || response.data.space_id;
        }
    } catch (error) {
        console.log("❌ 获取空间ID失败:", error.message);
    }
    return null;
}

// 模拟发布流程
async function simulatePublish() {
    console.log("🚀 开始模拟发布流程\n");

    // 1. 读取测试文件
    console.log("📄 步骤1: 读取测试文件...");
    const fileData = readTestFile();
    if (!fileData) {
        return;
    }

    console.log("✅ 文件信息:");
    console.log("   文件名:", fileData.filename);
    console.log("   标题:", fileData.title);
    console.log("   Frontmatter:", fileData.frontmatter);

    // 2. 解析父页面URL
    console.log("\n🔍 步骤2: 解析父页面URL...");
    if (!fileData.frontmatter.feishu) {
        console.log("❌ 测试文件缺少 feishu frontmatter");
        return;
    }

    const parsed = parseFeishuParentUrl(fileData.frontmatter.feishu);
    if (!parsed.parsed) {
        console.log("❌ 父页面URL解析失败:", parsed.error);
        return;
    }

    console.log("✅ 父页面信息:");
    console.log("   类型:", parsed.type);
    console.log("   节点Token:", parsed.nodeToken);

    const spaceId = await getSpaceIdByNode(parsed.nodeToken);
    if (!spaceId) {
        console.log("❌ 无法根据父页面链接获取空间ID");
        return;
    }
    console.log("   空间ID:", spaceId);

    // 3. 检查父页面信息
    console.log("\n🔍 步骤3: 检查父页面信息...");
    const parentInfo = await getParentInfo(parsed.nodeToken, spaceId);
    if (parentInfo) {
        console.log("✅ 父页面信息:");
        console.log("   标题:", parentInfo.title);
        console.log("   节点类型:", parentInfo.node_type);
        console.log("   是否有子节点:", parentInfo.has_child);
        console.log("   创建时间:", new Date(parentInfo.created_time * 1000).toLocaleString());
    }

    // 4. 检查当前子文档
    console.log("\n🔍 步骤4: 检查当前子文档...");
    const existingChildren = await getChildPages(parsed.nodeToken, spaceId);
    console.log(`📄 当前有 ${existingChildren.length} 个子文档:`);
    existingChildren.forEach(child => {
        console.log(`   - ${child.title} (${child.obj_token})`);
    });

    // 5. 模拟发布流程
    console.log("\n🚀 步骤5: 模拟发布流程...");
    console.log("   发布目标:", fileData.title);
    console.log("   父页面:", parentInfo?.title || parsed.nodeToken);
    console.log("   空间ID:", spaceId);

    // 6. 发布后验证
    console.log("\n🔍 步骤6: 发布后验证...");
    console.log("   请使用插件实际发布文档，然后检查:");
    console.log("   1. 在飞书中打开父页面");
    console.log("   2. 检查是否有新的子文档");
    console.log("   3. 如果看不到子文档，检查父页面设置");

    console.log("\n🏁 模拟完成！请使用插件发布文档进行实际测试");
}

// 获取父页面信息
async function getParentInfo(parentNodeToken, spaceId) {
    const accessToken = config.accessToken;
    const url = `https://open.feishu.cn/open-apis/wiki/v2/spaces/${spaceId}/nodes/${parentNodeToken}`;

    try {
        const response = await makeApiRequest(url, accessToken);
        if (response.code === 0 && response.data) {
            return response.data.node;
        }
    } catch (error) {
        console.log("   ❌ 获取父页面信息失败:", error.message);
    }
    return null;
}

// 获取子页面
async function getChildPages(parentNodeToken, spaceId) {
    const accessToken = config.accessToken;
    const url = `https://open.feishu.cn/open-apis/wiki/v2/spaces/${spaceId}/nodes`;

    try {
        const response = await makeApiRequest(url, accessToken, { page_size: 50 });
        if (response.code === 0 && response.data?.items) {
            // 过滤出父节点下的子页面
            return response.data.items.filter(item =>
                item.parent_node_token === parentNodeToken
            );
        }
    } catch (error) {
        console.log("   ❌ 获取子页面失败:", error.message);
    }
    return [];
}

// 发起API请求
function makeApiRequest(url, accessToken, params = {}) {
    return new Promise((resolve, reject) => {
        const https = require('https');

        const options = {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json; charset=utf-8'
            }
        };

        // 如果有参数，添加到URL
        let fullUrl = url;
        if (Object.keys(params).length > 0) {
            const queryParams = new URLSearchParams(params);
            fullUrl += '?' + queryParams.toString();
        }

        const req = https.request(fullUrl, options, (res) => {
            let data = '';

            res.on('data', (chunk) => {
                data += chunk;
            });

            res.on('end', () => {
                try {
                    const jsonData = JSON.parse(data);
                    resolve(jsonData);
                } catch (error) {
                    reject(new Error(`JSON解析失败: ${error.message}`));
                }
            });
        });

        req.on('error', (error) => {
            reject(error);
        });

        req.end();
    });
}

// 运行模拟
simulatePublish().catch(console.error);
