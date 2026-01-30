# 🚀 Publish Everywhere (Obsidian)

> 一键将 Obsidian 笔记发布到 飞书文档 / Confluence（KMS）/ Notion。

## 支持功能（简述）

- 飞书文档：front matter 写 `feishu: <父位置链接>`，自动创建/更新文档，成功后写回 `feishu_url`。
- Confluence（KMS）：front matter 写 `kms: <页面链接或含 pageId>`，插件内直接调用 Confluence REST API 创建/更新页面，成功后写回 `kms_url`。
  - 发布过程中遇到 `![[...excalidraw]]` 附件时，会通过已安装的 Excalidraw 插件接口模拟导出为高清 PNG，并以图片形式发布到 KMS（默认展示宽度 800）。
- Notion：front matter 可写 `notion: <父页面或数据库>` 或 `notion_url: <已存在页面>`；
  - 父页面不修改本身内容；同名子页面存在则更新，不存在则新建；
  - 指向数据库时按“标题列（Name/首列）= 文档标题”匹配，存在则更新，否则新建；
  - 新建页面自动添加随机图标与固定封面（gradients_8.png）。

## 一键发布

- 命令：`🚀 一键发布到所有平台`（默认快捷键：`Mod+Shift+P`）。
- 任一平台失败不影响其他平台，最终给出汇总结果。

## 最小配置

- 飞书：App ID、App Secret、OAuth 回调；设置页完成授权。
- Notion：API Token（Internal Integration）。
- KMS：Confluence URL、用户名/Token、Space。

## 示例 front matter

```yaml
---
# KMS（可选）
kms: https://your-confluence/pages/viewpage.action?pageId=123456

# 飞书（可选）
feishu: https://your.feishu.cn/wiki/xxxx

# Notion（可选）
notion: https://www.notion.so/your-parent-or-database
# 或使用已存在页面直链更新
# notion_url: https://www.notion.so/xxxxx
---
```

## 许可证

[MIT License](LICENSE)
