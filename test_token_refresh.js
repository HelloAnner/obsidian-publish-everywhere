// 测试令牌刷新功能
const https = require('https');

// 从data.json读取配置
const config = require('./data.json');

// 飞书API配置
const FEISHU_CONFIG = {
    REFRESH_TOKEN_URL: 'https://open.feishu.cn/open-apis/authen/v1/refresh_access_token'
};

async function testTokenRefresh() {
    console.log("🔄 测试令牌刷新功能\n");

    if (!config.refreshToken) {
        console.log("❌ 没有可用的refresh_token");
        return;
    }

    console.log("📋 当前配置:");
    console.log("   App ID:", config.appId);
    console.log("   Refresh Token:", config.refreshToken.substring(0, 20) + "...");

    const requestBody = {
        grant_type: 'refresh_token',
        client_id: config.appId,
        client_secret: config.appSecret,
        refresh_token: config.refreshToken
    };

    console.log("\n📤 发送刷新请求...");

    try {
        const response = await makeApiRequest(FEISHU_CONFIG.REFRESH_TOKEN_URL, requestBody, 'POST');

        console.log("📋 刷新响应:");
        console.log("   状态码:", response.code);
        console.log("   消息:", response.msg);

        if (response.code === 0) {
            // 支持v1和v2 API格式
            const accessToken = response.access_token || response.data?.access_token;
            const refreshToken = response.refresh_token || response.data?.refresh_token;

            if (accessToken) {
                console.log("\n✅ 令牌刷新成功!");
                console.log("   Access Token:", accessToken.substring(0, 20) + "...");
                console.log("   Refresh Token:", refreshToken ? refreshToken.substring(0, 20) + "..." : "未返回");

                // 更新配置文件
                config.accessToken = accessToken;
                config.refreshToken = refreshToken || config.refreshToken;

                console.log("\n💾 更新配置文件...");
                const fs = require('fs');
                fs.writeFileSync('./data.json', JSON.stringify(config, null, 2));
                console.log("✅ 配置文件已更新");
            } else {
                console.log("❌ 刷新响应中没有access_token");
            }
        } else {
            console.log("❌ 令牌刷新失败:", response.msg);
            console.log("   错误代码:", response.code);

            if (response.code === 99991665 || response.code === 99991666) {
                console.log("💡 refresh_token已过期或无效，需要重新授权");
            }
        }
    } catch (error) {
        console.log("❌ 请求失败:", error.message);
    }
}

// 发起API请求
function makeApiRequest(url, body = {}, method = 'GET') {
    return new Promise((resolve, reject) => {
        const options = {
            method: method,
            headers: {
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
                    console.log("❌ 原始响应数据:", data.substring(0, 500));
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

// 运行测试
testTokenRefresh().catch(console.error);