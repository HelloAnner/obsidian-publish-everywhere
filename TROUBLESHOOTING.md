# 🚨 飞书发布问题诊断与解决方案

## ❌ 问题描述

**症状**: 发布了文档，但在父页面下看不到子文档

**原因分析**: 通过API检查发现以下问题：

1. **父页面类型问题**:
   - 节点 `KjvMwvinuik94PkzxSActonTnFf` 存在，但它是 `origin` 类型
   - 这是一个**文档节点**，不是**容器节点**
   - `has_child: false` 表示目前没有子节点

2. **空间ID匹配问题**:
   - 父节点属于空间 `7569802567195394049` (项目空间)
   - 当前配置可能未正确识别该空间

3. **发布流程可能失败**:
   - Token 有效期剩余 ~1.5 小时（可能已经失效）
   - API 调用可能在创建或移动文档时失败

---

## 🔍 验证步骤

### 步骤 1: 测试 API 连接

在 Obsidian 中：
1. 按 `Ctrl+P` 打开命令面板
2. 输入"🧪 测试飞书API连接"
3. 运行命令
4. 查看结果是否成功

如果失败：
- Token 可能已过期
- 需要重新授权

### 步骤 2: 开启调试日志

在 Obsidian 中：
1. 按 `Ctrl+P` 打开命令面板
2. 输入"🔧 切换飞书调试日志"
3. 运行命令（应显示"🔧 飞书调试日志已开启"）
4. 按 `Ctrl+Shift+I` 打开开发者工具
5. 切换到 Console 标签
6. 重新发布文档
7. 查看详细日志输出

---

## 💡 解决方案

### 方案1: 重新授权（推荐）

**适用情况**: Token 已过期或权限不足

操作步骤：
1. 在 Obsidian 设置中找到 "Publish Everywhere"
2. 点击"授权"按钮
3. 在浏览器中完成授权流程
4. 返回 Obsidian
5. 重新发布测试文档

### 方案2: 更换父页面（推荐）

**适用情况**: 当前父页面无法添加子文档

操作步骤：

**选项A - 使用云空间文件夹**:
```yaml
---
feishu: https://jjspprprpr.feishu.cn/drive/folder/YourFolderToken
---
```

**选项B - 创建新的知识库容器**:
1. 在飞书知识库中创建一个**空白页面**或**文件夹**
2. 命名为"Obsidian发布"或其他名称
3. 获取该页面的知识库节点 Token
4. 更新测试文档的 feishu 属性

### 方案3: 检查飞书应用权限

**适用情况**: 应用缺少必要权限

确保飞书应用具有以下权限：
- `wiki:wiki` - 知识库操作
- `docx:document` - 文档操作
- `drive:drive` - 云空间操作（如使用）

---

## 📝 更新测试配置

### 已创建的测试文档

**文件**: `/Users/anner/notes/Work/测试飞书发布.md`

```markdown
---
feishu: https://jjspprprpr.feishu.cn/wiki/KjvMwvinuik94PkzxSActonTnFf?fromScene=spaceOverview
tags: [测试, 飞书发布]
---

# 测试飞书发布功能
...
```

**父页面信息**:
- 标题: "20251107  招聘数据预分类项目"
- 节点Token: `KjvMwvinuik94PkzxSActonTnFf`
- 文档Token: `GsVpdeMBJoM8Evxx8fCcQdMjn2f`
- 当前状态: `has_child: false`

### 新创建的父容器测试文档

**文件**: `/Users/anner/notes/Work/__feishu_parent_test.md`

```markdown
---
title: Feishu 测试父
---

# Feishu 测试父

这是一个专门用于测试飞书发布的父页面。
```

**建议操作流程**：
1. 先将此文档发布到飞书（使用原有的分享功能）
2. 获取发布后的知识库节点 Token
3. 更新测试文档的 feishu 属性指向该 Token
4. 重新发布测试文档

---

## 🔧 推荐的父页面配置

### 使用知识库文件夹作为父页面

```yaml
---
feishu: https://jjspprprpr.feishu.cn/wiki/KjvMwvinuik94PkzxSActonTnFf
---
```

**注意**:
- 确保父页面是**可以包含子页面的容器**类型
- origin 类型的页面可能无法添加子页面

### 使用云空间文件夹作为父页面

```yaml
---
feishu: https://jjspprprpr.feishu.cn/drive/folder/YourFolderToken
---
```

**优点**: 文件夹结构更清晰，易于管理

---

## 📊 诊断流程

如果仍然无法看到子文档，请按以下步骤排查：

1. **检查 Token 状态**:
   ```bash
   # 在终端运行
   cd /Users/anner/notes/Work/.obsidian/plugins/obsidian-publish-everywhere
   python3 -c "
   import json, base64
   with open('data.json') as f:
       t = json.load(f)['accessToken'].split('.')[1]
       d = json.loads(base64.b64decode(t + '=='))
   print('Token 过期时间:', d.get('exp'))
   print('剩余时间(小时):', (d.get('exp') - 1763983178) / 3600)
   "
   ```

2. **检查 API 权限**: 在浏览器访问
   [https://open.feishu.cn/open-apis/wiki/v2/spaces/get_node?token=KjvMwvinuik94PkzxSActonTnFf](https://open.feeshu.cn/open-apis/wiki/v2/spaces/get_node?token=KjvMwvinuik94PkzxSActonTnFf)

3. **查看详细日志**: 开启调试模式后，在 Console 查看日志
   寻找关键字: `✅`, `❌`, `📤`, `正在`, `失败`

---

## ✅ 成功发布的标志

如果发布成功，你应该看到：

1. **在 Obsidian 中**: 状态提示显示 "✅ 成功发布到 1 个平台"
2. **在测试文档中**: frontmatter 自动添加了 `feishu_url` 字段
3. **在飞书中**: 访问父页面 URL，看到 `测试飞书发布` 作为子页面

示例成功后的 frontmatter:
```yaml
---
feishu: https://jjspprprpr.feishu.cn/wiki/KjvMwvinuik94PkzxSActonTnFf?fromScene=spaceOverview
feishu_url: https://jjspprprpr.feishu.cn/wiki/ChildTokenHere
feishu_shared_at: "2024-11-24 20:05"
---
```

---

**如问题仍未解决，请提供以下信息以便进一步诊断**：
1. 开发者工具 Console 中的完整日志
2. 测试文档的完整 frontmatter
3. 发布时的状态提示截图
4. 飞书应用权限配置截图
