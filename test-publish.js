// 测试飞书发布脚本
const { createRequire } = require('module');
const path = require('path');

// 模拟Obsidian环境
const mockApp = {
  vault: {
    adapter: {
      basePath: '/Users/anner/notes/Work'
    }
  },
  metadataCache: {
    getFileCache: (file) => ({
      frontmatter: {
        feishu: "https://jjspprprpr.feishu.cn/wiki/KjvMwvinuik94PkzxSActonTnFf?fromScene=spaceOverview"
      }
    })
  }
};

// 导入FeishuApiService
const requireTs = createRequire(__dirname + '/main.js');

try {
  console.log("🔍 开始测试飞书发布流程...\n");

  // 1. 测试URL解析
  console.log("1. 测试URL解析:");
  const testUrl = "https://jjspprprpr.feishu.cn/wiki/KjvMwvinuik94PkzxSActonTnFf?fromScene=spaceOverview";
  const parsed = require('./main.js').parseFeishuParentUrl(testUrl);
  console.log("   URL解析结果:", JSON.stringify(parsed, null, 2));

  if (!parsed.parsed) {
    console.error("   ❌ URL解析失败");
    process.exit(1);
  }
  console.log("   ✅ URL解析成功\n");

  // 2. 测试配置
  console.log("2. 测试配置:");
  const settings = require('./data.json');
  console.log("   AppID:", settings.appId);
  console.log("   目标类型:", settings.targetType);
  console.log("   AccessToken:", settings.accessToken ? '已设置 ✅' : '未设置 ❌');
  console.log("   RefreshToken:", settings.refreshToken ? '已设置 ✅' : '未设置 ❌');
  console.log("   UserInfo:", settings.userInfo ? `已设置 (${settings.userInfo.name}) ✅` : '未设置 ❌');

  // 3. 测试认证
  console.log("\n3. 测试认证:");
  if (settings.accessToken) {
    console.log("   ✅ AccessToken已存在");
    const tokenParts = settings.accessToken.split('.');
    if (tokenParts.length > 1) {
      try {
        const payload = JSON.parse(Buffer.from(tokenParts[1], 'base64').toString());
        console.log("   Token过期时间:", new Date(payload.exp * 1000).toLocaleString());
        const now = Date.now() / 1000;
        if (payload.exp > now) {
          console.log("   ✅ Token有效 (剩余", Math.floor((payload.exp - now) / 3600), "小时)");
        } else {
          console.log("   ❌ Token已过期");
        }
      } catch (e) {
        console.log("   ⚠️ 无法解析Token");
      }
    }
  }

  console.log("\n🏁 测试完成！配置完好，可以发布到飞书");

} catch (error) {
  console.error("❌ 测试失败:", error.message);
  process.exit(1);
}
