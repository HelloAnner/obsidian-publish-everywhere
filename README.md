# 📝 Obsidian Publish to KMS

> 一键将 Obsidian 笔记发布到 KMS，让知识分享更轻松。

## ✨ 特性

- 🚀 一键发布笔记到 KMS
- 🔧 简单配置，即刻使用
- 🔗 支持通过 frontmatter 关联 KMS 页面
- 📎 自动处理附件引用
- 🎯 实时发布状态反馈

## 🎮 快速开始

### 1. 安装插件

将插件文件复制到：`<vault>/.obsidian/plugins/obsidian-publish-kms/`

### 2. 配置插件

在设置面板中填写：

- KMS 地址
- 用户凭据
- Space 信息
- md2kms 工具路径

### 3. 使用方法

在笔记 frontmatter 中添加 KMS 页面链接：

```yaml
---
kms: https://kms.fineres.com/pages/viewpage.action?pageId=1234567
---
```

按下快捷键（可在设置中自定义）即可发布！

## ⚠️ 注意事项

- 确保 md2kms 工具已正确安装
- 使用相对路径引用附件
- 必须配置 KMS 页面链接

## 🛠️ 技术栈

- TypeScript
- Obsidian Plugin API
- md2kms

## 📄 许可证

[MIT License](LICENSE)
