// 测试子文档创建功能
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

    // 匹配云文档URL格式
    const docMatch = url.match(/https:\/\/([a-zA-Z0-9-]+)\.feishu\.cn\/docx\/([a-zA-Z0-9]+)/);
    if (docMatch) {
        const appId = docMatch[1];
        const docToken = docMatch[2];
        console.log("✅ 云文档解析成功:");
        console.log("   App ID:", appId);
        console.log("   文档Token:", docToken);
        return {
            parsed: true,
            type: 'drive',
            docToken: docToken,
            error: null
        };
    }

    console.log("❌ 无法解析URL格式");
    return {
        parsed: false,
        error: '无法解析URL格式'
    };
}

// 测试API调用获取子页面列表
async function testGetChildPages(parentNodeToken) {
    console.log("\n🔍 测试获取子页面列表...");

    const spaceId = config.defaultWikiSpaceId;
    const accessToken = config.accessToken;

    const endpoints = [
        {
            name: 'nodes_tree',
            url: `https://open.feishu.cn/open-apis/wiki/v2/spaces/${spaceId}/nodes/tree`,
            params: {}
        },
        {
            name: 'nodes_tree_with_parent',
            url: `https://open.feishu.cn/open-apis/wiki/v2/spaces/${spaceId}/nodes/tree`,
            params: { parent_node_token: parentNodeToken }
        },
        {
            name: 'nodes_list',
            url: `https://open.feishu.cn/open-apis/wiki/v2/spaces/${spaceId}/nodes`,
            params: { page_size: 50 }
        },
        {
            name: 'nodes_list_with_parent',
            url: `https://open.feishu.cn/open-apis/wiki/v2/spaces/${spaceId}/nodes`,
            params: { page_size: 50, parent_node_token: parentNodeToken }
        },
        {
            name: 'docs_list',
            url: `https://open.feishu.cn/open-apis/wiki/v2/spaces/${spaceId}/docs`,
            params: { page_size: 50 }
        },
        {
            name: 'space_nodes',
            url: `https://open.feishu.cn/open-apis/wiki/v2/spaces/${spaceId}`,
            params: {}
        }
    ];

    for (const endpoint of endpoints) {
        console.log(`\n📡 测试端点: ${endpoint.name}`);
        console.log(`   URL: ${endpoint.url}`);

        try {
            const response = await makeApiRequest(endpoint.url, accessToken, endpoint.params);
            if (response.code === 0) {
                console.log("   ✅ API调用成功");

                // 分析响应结构
                analyzeResponseStructure(endpoint.name, response.data);

                // 查找子页面
                const children = findChildrenInResponse(response.data, parentNodeToken);
                console.log(`   📄 找到 ${children.length} 个子页面`);

                if (children.length > 0) {
                    console.log("   子页面列表:");
                    children.forEach(child => {
                        console.log(`      - ${child.title} (${child.obj_token})`);
                    });
                }

                // 显示所有节点及其父节点信息
                const allItems = getAllItemsFromResponse(response.data);
                if (allItems.length > 0) {
                    console.log(`   📋 所有节点 (${allItems.length} 个):`);
                    allItems.forEach(item => {
                        const title = item.title || item.node_title || item.doc_title || '无标题';
                        const parent = item.parent_node_token || item.parent_wiki_token || item.parent_id || '无父节点';
                        const token = item.obj_token || item.node_token || item.doc_token || '无token';
                        console.log(`      - ${title} (${token}) -> 父节点: ${parent}`);
                    });
                }
            } else {
                console.log(`   ❌ API错误: ${response.msg} (code: ${response.code})`);
            }
        } catch (error) {
            console.log(`   ❌ 请求失败: ${error.message}`);
        }
    }
}

// 分析响应数据结构
function analyzeResponseStructure(endpointName, data) {
    console.log("   🔍 分析数据结构:");

    if (Array.isArray(data)) {
        console.log("     结构: 数组");
        console.log(`     项目数: ${data.length}`);
    } else if (data && typeof data === 'object') {
        if (Array.isArray(data.items)) {
            console.log("     结构: data.items");
            console.log(`     项目数: ${data.items.length}`);
        } else if (Array.isArray(data.nodes)) {
            console.log("     结构: data.nodes");
            console.log(`     项目数: ${data.nodes.length}`);
        } else if (Array.isArray(data.children)) {
            console.log("     结构: data.children");
            console.log(`     项目数: ${data.children.length}`);
        } else if (data.node) {
            console.log("     结构: data.node (树形)");
        } else {
            console.log("     结构: 未知", Object.keys(data));
        }
    }
}

// 在响应中查找子页面
function findChildrenInResponse(data, parentNodeToken) {
    let items = [];

    if (Array.isArray(data)) {
        items = data;
    } else if (data && typeof data === 'object') {
        if (Array.isArray(data.items)) {
            items = data.items;
        } else if (Array.isArray(data.nodes)) {
            items = data.nodes;
        } else if (Array.isArray(data.children)) {
            items = data.children;
        }
    }

    // 过滤出父节点下的子页面
    return items.filter(item =>
        item.parent_node_token === parentNodeToken
    );
}

// 从响应中获取所有项目
function getAllItemsFromResponse(data) {
    let items = [];

    if (Array.isArray(data)) {
        items = data;
    } else if (data && typeof data === 'object') {
        if (Array.isArray(data.items)) {
            items = data.items;
        } else if (Array.isArray(data.nodes)) {
            items = data.nodes;
        } else if (Array.isArray(data.children)) {
            items = data.children;
        }
    }

    return items;
}

// 发起API请求
function makeApiRequest(url, accessToken, params = {}) {
    return new Promise((resolve, reject) => {
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
    console.log("   空间ID:", config.defaultWikiSpaceId);

    // 2. 测试获取子页面列表
    await testGetChildPages(parsed.nodeToken);

    console.log("\n🏁 测试完成！");
}

// 运行测试
main().catch(console.error);