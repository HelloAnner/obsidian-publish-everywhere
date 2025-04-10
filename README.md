# Obsidian Publish to KMS

这是一个 Obsidian 插件，用于将笔记发布到 KMS 系统。插件使用 md2kms 工具将 Markdown 内容转换并发布到指定的 KMS 页面。

## 功能特点

- 支持一键发布当前笔记到 KMS
- 支持配置 KMS 连接信息（URL、用户名、密码、空间）
- 支持配置 md2kms 工具路径
- 支持通过 frontmatter 指定父页面 ID
- 保持附件相对路径引用

## 安装方法

1. 下载最新版本的插件文件
2. 将文件复制到你的 Obsidian 插件目录：`<vault>/.obsidian/plugins/obsidian-publish-kms/`
3. 在 Obsidian 设置中启用插件
4. 配置插件设置

## 配置说明

在插件设置中配置以下信息：

1. KMS URL：你的 KMS 系统地址
2. 用户名：KMS 登录用户名
3. 密码/Token：KMS 登录密码或 API Token
4. Space：KMS 空间名称
5. md2kms 路径：md2kms 工具的完整路径

## 使用方法

1. 在笔记的 frontmatter 中添加 KMS 页面链接，例如：
   ```yaml
   ---
   kms: https://kms.fineres.com/pages/viewpage.action?pageId=1242404331
   ---
   ```

2. 配置快捷键：
   - 打开设置 > 快捷键
   - 搜索 "Publish to KMS"
   - 设置你喜欢的快捷键

3. 发布笔记：
   - 打开要发布的笔记
   - 按下配置的快捷键
   - 等待发布完成

## 注意事项

1. 确保已正确安装并配置 md2kms 工具
2. 确保笔记中的附件使用相对路径引用
3. 确保已在 frontmatter 中配置正确的 KMS 页面链接
4. 发布时会使用当前笔记的文件名作为页面标题

## 开发相关

- 使用 TypeScript 开发
- 使用 Obsidian Plugin API
- 支持实时日志输出
- 支持错误处理和提示

## 许可证

MIT License
