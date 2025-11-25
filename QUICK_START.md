# 发布到飞书和 KMS - 快速开始

## 📦 安装和配置

### 1. 插件已就绪
✅ 插件已构建完成（main.js 427KB）
✅ 所有功能已实现
✅ 配置已验证（Token有效）

### 2. 核心功能

| 功能 | 命令 | 快捷键 | 说明 |
|------|------|--------|------|
| 发布到 KMS | `发布到KMS` | `Ctrl+Shift+K` / `Cmd+Shift+K` | 根据 `kms` 属性发布 |
| 发布到飞书 | `发布到飞书` | `Ctrl+Shift+F` / `Cmd+Shift+F` | 根据 `feishu` 属性发布 |
| 一键发布全部 | `一键发布到所有平台` | `Ctrl+Shift+P` / `Cmd+Shift+P` | 自动检测并发布到所有平台 |

### 3. 使用方法

#### 方式一：快捷键（推荐）
- **KMS**: `Ctrl+Shift+K` (Mac: `Cmd+Shift+K`)
- **飞书**: `Ctrl+Shift+F` (Mac: `Cmd+Shift+F`)
- **全部**: `Ctrl+Shift+P` (Mac: `Cmd+Shift+P`)

#### 方式二：命令面板
1. 按 `Ctrl+P` 打开命令面板
2. 输入"发布到"或"publish"
3. 选择对应的命令

#### 方式三：右键菜单
1. 在文档中右键
2. 选择"分享当前笔记到飞书"（保留原有分享功能）

## 📝 文档配置

### 发布到 KMS
在文档 frontmatter 中添加：
```yaml
---
kms: https://kms.fineres.com/pages/viewpage.action?pageId=12345
---
```

### 发布到飞书
在文档 frontmatter 中添加：
```yaml
---
# 方式1：发布到知识库父页面
feishu: https://jjspprprpr.feishu.cn/wiki/KjvMwvinuik94PkzxSActonTnFf

# 方式2：发布到云空间文件夹
feishu: https://jjspprprpr.feishu.cn/drive/folder/AbCdEfGh
---
```

### 同时发布到多个平台
```yaml
---
kms: https://kms.fineres.com/pages/viewpage.action?pageId=12345
feishu: https://jjspprprpr.feishu.cn/wiki/KjvMwvinuik94PkzxSActonTnFf
---
```
然后按 `Ctrl+Shift+P` 一键发布到两个平台！

## ✅ 测试文档

已创建测试文档：`/Users/anner/notes/Work/测试飞书发布.md`

**操作步骤**：
1. 在 Obsidian 中打开"测试飞书发布.md"
2. 按 `Ctrl+Shift+F` 发布到飞书
3. 或按 `Ctrl+Shift+P` 发布到所有平台
4. 等待状态提示
5. 文档将出现在指定父页面下

## 🔍 故障排除

### Token 过期
如果出现"Token无效或已过期":
1. 在 Obsidian 设置中找到"Publish Everywhere"
2. 点击"重新授权"或"测试飞书API连接"
3. 在浏览器中完成授权流程
4. 返回 Obsidian 重试

### URL 格式错误
确保 URL 格式正确：
- ✅ 正确: `https://xxx.feishu.cn/wiki/TOKEN`
- ✅ 正确: `https://xxx.feishu.cn/drive/folder/TOKEN`
- ❌ 错误: `https://xxx.feishu.cn/docx/TOKEN`

### 权限问题
确保飞书应用有权限访问 Wiki API。

## 📊 功能对比

| 功能 | KMS | 飞书 |
|------|-----|------|
| 父页面 | ✅ | ✅ |
| 更新已有文档 | ✅ | ✅ |
| 图片上传 | ❌ | ✅ |
| 附件上传 | ❌ | ✅ |
| 预览 | ❌ | ✅ |
| 协作编辑 | ✅ | ✅ |

## 🎉 特色功能

1. **智能检测**: 自动检测父页面下是否已存在同名文档
2. **自动更新**: 存在则更新，不存在则创建
3. **保留所有功能**: 飞书支持图片、附件、Callout 等所有特性
4. **独立执行**: KMS 和飞书互不影响，一个失败另一个仍可成功
5. **状态通知**: 清晰的发布状态提示

## 📞 技术支持

如遇到问题：
1. 打开命令面板，运行"切换飞书调试日志"
2. 按 `Ctrl+Shift+I` 打开开发者工具
3. 查看 Console 标签中的日志
4. 将错误信息反馈
