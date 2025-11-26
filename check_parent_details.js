// 检查父页面详细信息
const https = require('https');

// 从data.json读取配置
const config = require('./data.json');

// 父页面节点Token
const parentNodeToken = 'KjvMwvinuik94PkzxSActonTnFf';

async function checkParentDetails() {
    console.log("🔍 检查父页面详细信息\n");

    const accessToken = config.accessToken;
    const spaceId = await getSpaceIdByNode(parentNodeToken);
    if (!spaceId) {
        console.log("❌ 无法获取知识库空间ID，请确认节点Token有效");
        return;
    }

    // 1. 获取父页面详细信息
    console.log("📄 步骤1: 获取父页面详细信息...");
    const parentUrl = `https://open.feishu.cn/open-apis/wiki/v2/spaces/${spaceId}/nodes/${parentNodeToken}`;

    try {
        const response = await makeApiRequest(parentUrl, accessToken);
        if (response.code === 0 && response.data) {
            const node = response.data.node;
            console.log("✅ 父页面信息:");
            console.log("   标题:", node.title);
            console.log("   节点Token:", node.node_token);
            console.log("   对象Token:", node.obj_token);
            console.log("   节点类型:", node.node_type);
            console.log("   是否有子节点:", node.has_child);
            console.log("   创建时间:", new Date(node.created_time * 1000).toLocaleString());
            console.log("   编辑时间:", new Date(node.edit_time * 1000).toLocaleString());
            console.log("   创建者:", node.creator);
            console.log("   所有者:", node.owner);

            // 检查节点类型是否支持子文档
            console.log("\n🔍 节点类型分析:");
            if (node.node_type === 'origin') {
                console.log("   ℹ️ 节点类型为 'origin' - 这是知识库根节点");
                console.log("   ℹ️ 根节点通常支持子文档");
            } else if (node.node_type === 'doc') {
                console.log("   ℹ️ 节点类型为 'doc' - 这是文档节点");
                console.log("   ℹ️ 文档节点可能不支持子文档");
            } else {
                console.log("   ℹ️ 节点类型为:", node.node_type);
            }

            if (node.has_child) {
                console.log("   ✅ 父页面支持子文档");
            } else {
                console.log("   ⚠️ 父页面当前没有子文档");
            }
        } else {
            console.log("❌ 获取父页面信息失败:", response.msg);
        }
    } catch (error) {
        console.log("❌ 请求失败:", error.message);
    }

    // 2. 检查空间信息
    console.log("\n🏢 步骤2: 检查空间信息...");
    const spaceUrl = `https://open.feishu.cn/open-apis/wiki/v2/spaces/${spaceId}`;

    try {
        const response = await makeApiRequest(spaceUrl, accessToken);
        if (response.code === 0 && response.data) {
            const space = response.data.space;
            console.log("✅ 空间信息:");
            console.log("   空间名称:", space.name);
            console.log("   空间描述:", space.description);
            console.log("   空间类型:", space.space_type);
            console.log("   创建者:", space.creator);
        } else {
            console.log("❌ 获取空间信息失败:", response.msg);
        }
    } catch (error) {
        console.log("❌ 请求失败:", error.message);
    }

    // 3. 检查所有节点
    console.log("\n📋 步骤3: 检查所有节点...");
    const nodesUrl = `https://open.feishu.cn/open-apis/wiki/v2/spaces/${spaceId}/nodes`;

    try {
        const response = await makeApiRequest(nodesUrl, accessToken, { page_size: 50 });
        if (response.code === 0 && response.data?.items) {
            const nodes = response.data.items;
            console.log(`📄 空间中共有 ${nodes.length} 个节点:`);

            // 按父节点分组
            const nodesByParent = {};
            nodes.forEach(node => {
                const parent = node.parent_node_token || 'root';
                if (!nodesByParent[parent]) {
                    nodesByParent[parent] = [];
                }
                nodesByParent[parent].push(node);
            });

            // 显示父页面下的子节点
            if (nodesByParent[parentNodeToken]) {
                console.log(`\n📁 父页面下的子节点 (${nodesByParent[parentNodeToken].length} 个):`);
                nodesByParent[parentNodeToken].forEach(child => {
                    console.log(`   - ${child.title} (${child.obj_token}) - 类型: ${child.node_type}`);
                });
            } else {
                console.log("\n📁 父页面下暂无子节点");
            }

            // 显示根节点
            if (nodesByParent['root']) {
                console.log(`\n🌳 根节点 (${nodesByParent['root'].length} 个):`);
                nodesByParent['root'].forEach(node => {
                    console.log(`   - ${node.title} (${node.obj_token}) - 类型: ${node.node_type}`);
                });
            }
        } else {
            console.log("❌ 获取节点列表失败:", response.msg);
        }
    } catch (error) {
        console.log("❌ 请求失败:", error.message);
    }

    console.log("\n🏁 检查完成！");
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

// 运行检查
checkParentDetails().catch(console.error);
