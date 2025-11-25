# 飞书发布功能测试清单

## 📋 前置检查

### 1. 插件状态
- [ ] 插件已正确加载（在 Obsidian 设置中能看到"Publish Everywhere"）
- [ ] main.js 文件大小约为 428KB (构建成功)
- [ ] 已重启 Obsidian 加载最新代码

### 2. 配置验证
- [ ] Feishu AppID 已配置: `cli_a9ae82657c395bdb`
- [ ] Feishu AppSecret 已配置
- [ ] Callback URL 已配置: `https://md2feishu.xinqi.life/oauth-callback`
- [ ] AccessToken 已存在且未过期
- [ ] RefreshToken 已存在

### 3. 测试文档
**文档路径**: `/Users/anner/notes/Work/测试飞书发布.md`

```markdown
---
feishu: https://jjspprprpr.feishu.cn/wiki/KjvMwvinuik94PkzxSActonTnFf?fromScene=spaceOverview
tags: [测试, 飞书发布]
---

# 测试飞书发布功能

这是一个测试文档，用于验证飞书发布功能是否正常工作。
```

## 🚀 在 Obsidian 中测试

### 方法 1: 快捷键
1. 打开测试文档
2. 按 `Ctrl+Shift+P` (Mac 上是 `Cmd+Shift+P`)
3. 观察结果

### 方法 2: 命令面板
1. 打开测试文档
2. 按 `Ctrl+P` 打开命令面板
3. 输入"一键发布到所有平台"
4. 选择命令并执行

### 方法 3: 编辑器菜单
1. 在测试文档中右键
2. 选择"分享当前笔记到飞书"
3. 观察结果

## ✅ 预期结果

### 成功情况
- [ ] 状态提示"⏳ 正在发布到飞书..."
- [ ] 成功提示"✅ 成功发布到 1 个平台"
- [ ] 文档出现在 https://jjspprprpr.feishu.cn/wiki/KjvMwvinuik94PkzxSActonTnFf 下
- [ ] Frontmatter 中添加 feishu_url 字段

### 可能的错误及修复

#### ❌ 错误: "Token无效或已过期"
**原因**: AccessToken 过期
**修复**:
1. 在 Obsidian 设置中打开 Feishu 设置
2. 点击"授权"按钮重新授权
3. 在浏览器中完成授权流程
4. 返回 Obsidian 重试发布

#### ❌ 错误: "缺少必要的知识库信息"
**原因**: 无法获取知识库空间ID
**检查**:
1. 确认父页面URL是否正确
2. 确认是否有访问该知识库的权限
3. 检查 AppID 是否有访问 Wiki API 的权限

#### ❌ 错误: "无法识别的URL格式"
**原因**: URL格式不符合预期
**检查**:
1. URL 必须是 `https://xxx.feishu.cn/wiki/TOKEN` 格式
2. URL 中不能有多余的空格或特殊字符

#### ❌ 错误: "授权未完成"
**原因**: 没有有效的AccessToken
**修复**:
1. 在插件设置中点击"授权"按钮
2. 在打开的浏览器窗口中允许授权
3. 授权成功后会自动跳转回 Obsidian

## 🔍 调试方法

### 开启调试日志
1. 按 `Ctrl+P` 打开命令面板
2. 输入"切换飞书调试日志"
3. 选择命令，确保显示"🔧 飞书调试日志已开启"

### 查看日志
执行发布后，查看开发者工具控制台:
1. 按 `Ctrl+Shift+I` 打开开发者工具
2. 切换到 Console 标签
3. 查看 Feishu API 相关的日志信息

### 关键日志信息
- `✅ Parsed wiki node token: ...` - URL 解析成功
- `✅ Found existing document: ...` - 找到现有文档
- `📄 Creating new document...` - 正在创建新文档
- `📍 正在移动到指定父页面...` - 正在移动文档
- `✅ Document created/moved successfully` - 成功

## 📝 测试记录

| 测试时间 | 测试结果 | 错误信息 | 备注 |
|----------|----------|----------|------|
|          |          |          |      |
|          |          |          |      |

## 📞 需要帮助

如果发布失败，请提供以下信息：
1. Obsidian 控制台中的错误日志
2. 测试文档的完整 frontmatter
3. 执行的命令/操作
