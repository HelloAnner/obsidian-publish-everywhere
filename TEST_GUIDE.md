# 🔧 飞书子页面创建测试指南

## 📋 修改总结

✅ **已完成的代码修改**:

1. **shareToWiki 方法**: 添加了 `parentInfo` 参数，支持在创建文档时直接指定父页面
2. **moveDocToWiki 方法**: 添加了详细的日志输出，可追踪 API 调用全过程
3. **shareWithParent 方法**: 优化了逻辑，将 parentInfo 传递给 shareToWiki，避免重复移动
4. **错误处理**: 修复了返回值缺失的问题

---

## 🎯 父页面下创建子页面的完整流程

```
1. 读取文档 → 2. 解析 feishu 属性 → 3. 提取空间ID和父节点Token
4. 上传Markdown → 5. 创建导入任务 → 6. 等待导入完成（docx_token）
7. 移动到知识库（指定parent_wiki_token）→ 8. 生成wiki URL
9. 更新frontmatter → 10. 显示成功通知
```

---

## 🔍 关键API调用

### 1. 上传Markdown文件
```http
POST https://open.feishu.cn/open-apis/drive/v1/files/upload_all
Authorization: Bearer {access_token}
FormData:
  - file_name: "测试飞书发布.md"
  - parent_type: ccm_import_open
  - file: (markdown content)
Response: { file_token: "xxx" }
```

### 2. 创建导入任务
```http
POST https://open.feishu.cn/open-apis/drive/v1/import_tasks
Authorization: Bearer {access_token}
Body:
{
  "file_token": "xxx",
  "type": "docx",
  "title": "测试飞书发布"
}
Response: { ticket: "yyy" }
```

### 3. 查询导入结果
```http
GET https://open.feishu.cn/open-apis/drive/v1/import_tasks/:ticket?timeout_seconds=15
Authorization: Bearer {access_token}
Response: { data: { docs: [{ docs_token: "docx_token_zzz" }] } }
```

### 4. 移动到知识库（最关键的一步）
```http
POST https://open.feishu.cn/open-apis/wiki/v2/spaces/{space_id}/nodes/move_docs_to_wiki
Authorization: Bearer {access_token}
Body:
{
  "obj_type": "docx",
  "obj_token": "docx_token_zzz",
  "parent_wiki_token": "KjvMwvinuik94PkzxSActonTnFf"  // ← 父页面Token
}
Response: { code: 0, data: { wiki_token: "new_wiki_token" } }
```

---

## 🚀 在 Obsidian 中手动测试

### 步骤 1: 开启调试模式
1. 按 `Ctrl+P` 打开命令面板
2. 输入"🔧 切换飞书调试日志"
3. 运行命令，确保显示"🔧 飞书调试日志已开启"

### 步骤 2: 打开开发者工具
1. 按 `Ctrl+Shift+I` (Mac: `Cmd+Option+I`)
2. 切换到 **Console** 标签
3. 清空 Console（方便查看新日志）

### 步骤 3: 准备测试文档
**文档路径**: `/Users/anner/notes/Work/测试飞书发布.md`

```markdown
---
feishu: https://jjspprprpr.feishu.cn/wiki/KjvMwvinuik94PkzxSActonTnFf?fromScene=spaceOverview
tags: [测试, 飞书发布]
---

# 测试飞书发布功能

这是一个测试文档，用于验证飞书发布功能是否正常工作。

## 功能测试

- [x] 父页面解析
- [x] 文档创建
- [ ] 子页面创建
- [ ] 图片上传
```

### 步骤 4: 执行发布
1. **重启 Obsidian**（重要！加载最新代码）
2. 打开测试文档
3. 按 `Ctrl+Shift+F`（发布到飞书）
4. **观察状态提示**:
   - ⏳ "正在检查授权状态..."
   - ⏳ "正在上传文件到飞书云空间..."
   - ⏳ "正在转换为飞书文档..."
   - ⏳ "正在移动到指定父页面..."
   - ✅ "成功发布到 1 个平台"

### 步骤 5: 查看 Console 日志
在 Console 中应该看到类似日志：

```javascript
🔍 SHARING TO WIKI: title=测试飞书发布, spaceId=7569802567195394049, parentNodeToken=KjvMwvinuik94PkzxSActonTnFf
🔍 DOCUMENT CREATED: docx_token=doxcnaBCDEfGh, title=测试飞书发布
🔍 MOVING TO PARENT: spaceId=7569802567195394049, docx_token=doxcnaBCDEfGh, parent_token=KjvMwvinuik94PkzxSActonTnFf
🔍 REQUEST: POST https://open.feishu.cn/open-apis/wiki/v2/spaces/7569802567195394049/nodes/move_docs_to_wiki
🔍 REQUEST BODY: {"obj_type":"docx","obj_token":"doxcnaBCDEfGh","parent_wiki_token":"KjvMwvinuik94PkzxSActonTnFf"}
🔍 RESPONSE: {"code":0,"data":{"wiki_token":"wikcnXYZABC","task_id":""}}
✅ MOVE SUCCESS: wikiToken=wikcnXYZABC, taskId=
🔍 FINAL URL: https://jjspprprpr.feishu.cn/wiki/doxcnaBCDEfGh
✅ Document created successfully: https://jjspprprpr.feishu.cn/wiki/doxcnaBCDEfGh
```

### 步骤 6: 验证结果
1. **查看文档变化**:
   - 测试文档应该自动添加了 `feishu_url` 字段
   ```yaml
   ---
   feishu: https://jjspprprpr.feishu.cn/wiki/KjvMwvinuik94PkzxSActonTnFf
   feishu_url: https://jjspprprpr.feishu.cn/wiki/doxcnaBCDEfGh  // ← 新添加
   feishu_shared_at: "2024-11-24 20:30"
   ---
   ```

2. **在飞书中查看**:
   - 访问: https://jjspprprpr.feishu.cn/wiki/KjvMwvinuik94PkzxSActonTnFf
   - 检查是否出现子页面"测试飞书发布"
   - 子页面 URL 应该是: https://jjspprprpr.feishu.cn/wiki/doxcnaBCDEfGh

---

## ✅ 成功标志

如果一切正常，你将看到：

1. **Obsidian 状态栏**: "✅ 成功发布到 1 个平台"
2. **Console 日志**: 包含 "✅ MOVE SUCCESS" 和 "✅ Document created successfully"
3. **文档 frontmatter**: 自动添加了 `feishu_url` 字段
4. **飞书知识库**: 父页面下出现子文档

---

## ❌ 常见问题排查

### 问题 1: Token 过期
**Console 日志**: "Token无效，请重新授权"
**解决方案**: 在设置中重新授权

### 问题 2: 移动失败
**Console 日志**: "❌ MOVE FAILED: code=xxx, msg=xxx"
**可能原因**:
- 父页面不存在或无权限
- obj_token 无效
- API 权限不足（缺少 wiki:wiki）

### 问题 3: 父页面参数错误
**Console 日志**: "param err: xxx"
**检查**: 确保 parentNodeToken 格式正确（20+位字母数字）

### 问题 4: 上传失败
**Console 日志**: "Request failed, status 401/403/400"
**解决方案**: 检查 AccessToken 和网络连接

---

## 🔧 验证 API 权限

在 Obsidian 命令面板运行：

### 测试 1: API 连接测试
```
🧪 测试飞书API连接
```

期望输出: "API测试结果: 成功"

### 测试 2: 获取用户信息
```
🧪 测试飞书API连接
```

期望输出: 显示你的用户名和邮箱

### 测试 3: 切换调试日志
```
🔧 切换飞书调试日志
```

确保显示: "🔧 飞书调试日志已开启"（不是"已关闭"）

---

## 📊 成功发布的数据示例

### 请求数据
```json
{
  "obj_type": "docx",
  "obj_token": "doxcnABC123456789",
  "parent_wiki_token": "KjvMwvinuik94PkzxSActonTnFf"
}
```

### 响应数据
```json
{
  "code": 0,
  "msg": "success",
  "data": {
    "wiki_token": "wikcnXYZ987654321",
    "task_id": ""
  }
}
```

---

## 📝 如何在其他文档使用

1. **复制测试文档结构**
2. **修改 feishu 属性** 为你的父页面 URL
3. **确保父页面 Token 有效**

示例:
```yaml
---
feishu: https://jjspprprpr.feishu.cn/wiki/YOUR_PARENT_NODE_TOKEN
---
```

然后按 `Ctrl+Shift+F` 即可发布该文档到指定父页面下！

---

## 🎉 功能验证清单

发布成功后，请确认：

- [ ] Console 中看到 "🔍 MOVE DOC TO WIKI" 日志
- [ ] Console 中看到 "🔍 REQUEST BODY" 包含 parent_wiki_token
- [ ] Console 中看到 "✅ MOVE SUCCESS"
- [ ] Console 中看到 "✅ Document created successfully"
- [ ] 文档自动添加了 feishu_url 字段
- [ ] 飞书知识库父页面下出现子文档
- [ ] 子文档标题与测试文档文件名一致

---

**祝测试顺利！如有问题，请查看 Console 详细日志并反馈。** 🚀
