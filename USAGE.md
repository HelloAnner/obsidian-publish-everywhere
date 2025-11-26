# 统一发布到 KMS 和飞书 - 快速开始指南

✨ **版本**: 2.0.0 (2024-11-24)  
⚡ **状态**: 已构建完成，可直接使用  
📦 **构建大小**: 427KB

---

## 🎯 核心功能

### 发布的三个快捷键
1. **Ctrl+Shift+K** - 发布到 KMS
2. **Ctrl+Shift+F** - 发布到飞书  
3. **Ctrl+Shift+P** - 一键发布到所有平台

---

## 🔧 使用前配置

### 1. KMS 发布配置（已在 data.json 中）
```json
"confluenceUrl": "https://kms.fineres.com"
"username": "Anner"
"password": "***"
"space": "DR"
"md2kmsPath": "/usr/local/bin/md2kms"
```

### 2. 飞书发布配置（已在 data.json 中）
```json
"appId": "cli_a9ae82657c395bdb"
"appSecret": "***"
"accessToken": "eyJ..." (有效期约 24 小时)
"refreshToken": "eyJ..."
```

**Token 状态**: ✅ 有效（剩余约 1.5 小时）

---

## 📝 文档标记示例

### 仅发布到 KMS
```markdown
---
kms: https://kms.fineres.com/pages/viewpage.action?pageId=12345
---

# 我的文档
内容...
```

> 发布成功后，插件会自动在 Front Matter 中补充 / 更新 `kms_url` 字段，方便你直接跳转到最新页面。

### 仅发布到飞书
```markdown
---
feishu: https://jjspprprpr.feishu.cn/wiki/KjvMwvinuik94PkzxSActonTnFf
---

# 我的文档
内容...
```

### 同时发布到两个平台
```markdown
---
kms: https://kms.fineres.com/pages/viewpage.action?pageId=12345
feishu: https://jjspprprpr.feishu.cn/wiki/KjvMwvinuik94PkzxSActonTnFf
---

# 我的文档
内容...
```

**标题**: 自动使用文件名（如 "我的文档"）  
**位置**: 自动创建为父页面的子页面

---

## 🚀 立即开始测试

### 测试文档已创建
**位置**: `/Users/anner/notes/Work/测试飞书发布.md`

**内容包含**:
- ✅ feishu 属性已配置
- ✅ 标题: "测试飞书发布"
- ✅ 包含图片、代码块、表格等测试内容

### 测试步骤

1. **重启 Obsidian**（加载最新插件）
2. **打开测试文档**
3. **按 Ctrl+Shift+F**
4. **观察状态提示**:
   - "⏳ 正在发布到飞书..."
   - "✅ 成功发布到 1 个平台"
5. **检查飞书知识库**
   - 访问: https://jjspprprpr.feishu.cn/wiki/KjvMwvinuik94PkzxSActonTnFf
   - 查看是否出现子页面"测试飞书发布"

---

## 💡 关键逻辑

### 飞书发布流程
```
1. 读取文档的 feishu 属性
2. 解析父页面 URL
3. 检查父页面下是否已存在同名文档
   ├─ 存在 → 更新现有文档
   └─ 不存在 → 创建新文档并移动到父页面下
4. 更新 frontmatter 的 feishu_url 字段
5. 显示成功通知
```

### 一键发布全部
```
1. 检测文档中有哪些发布属性（kms/feishu）
2. 并行执行所有配置的发布任务
3. 汇总结果并显示
```

---

## ⚠️ 重要提示

### Token 过期处理
飞书 AccessToken 有效期 24 小时，过期后需要重新授权：

**手动重新授权**:
1. 在 Obsidian 设置中找到 "Publish Everywhere"
2. 点击"授权"按钮
3. 在浏览器中确认授权
4. 返回 Obsidian

### 查看详细日志
如需调试：
1. 按 `Ctrl+Shift+I` 打开开发者工具
2. 查看 Console 标签
3. 查看以 "🪶" 开头的日志

---

## 🎯 发布逻辑对比

| 特性 | KMS | 飞书 |
|------|-----|------|
| 父页面 | ✅ pageId | ✅ wiki/drive |
| 检测同名 | 不支持 | ✅ 自动检测 |
| 智能更新 | ❌ 总是新建 | ✅ 存在则更新 |
| 图片上传 | ❌ | ✅ |
| 附件上传 | ❌ | ✅ |
| 调用方式 | 外部二进制 | API 调用 |

---

## 🔑 快捷键总结

| 快捷键 | 功能 |
|--------|------|
| `Ctrl+Shift+K` / `Cmd+Shift+K` | 发布到 KMS |
| `Ctrl+Shift+F` / `Cmd+Shift+F` | 发布到飞书 |
| `Ctrl+Shift+P` / `Cmd+Shift+P` | 一键发布到所有平台 |

---

## ✅ 验证清单

在 Obsidian 中测试前，请确认：

- [ ] 插件已加载 (main.js 427KB)
- [ ] Feishu AccessToken 有效（剩余 >0 小时）
- [ ] 测试文档存在 (`测试飞书发布.md`)
- [ ] 测试文档包含 `feishu:` 属性
- [ ] 已重启 Obsidian

---

## 📞 故障排查

### 如果发布失败

**错误**: "Token无效或已过期"
**解决**: 重新授权（见上文）

**错误**: "无法识别的URL格式"
**检查**: 确保 URL 格式为 `https://xxx.feishu.cn/wiki/TOKEN`

**错误**: "缺少必要的知识库信息"
**检查**: 确认 AppID 有访问 Wiki API 的权限

**错误**: "网络请求失败"
**检查**: 确保网络可以访问飞书 API

---

## 🎉 特性亮点

1. ✅ **统一属性**: `kms` 和 `feishu` 属性格式统一
2. ✅ **智能判断**: 自动检测是否需要更新
3. ✅ **一键发布**: 多平台同时发布
4. ✅ **独立执行**: 一个失败不影响另一个
5. ✅ **快捷键**: 三个快捷键搞定所有发布

---

**现在就开始测试吧！**

打开测试文档，按 `Ctrl+Shift+F` 🚀
