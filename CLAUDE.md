obsidian 标准插件源码仓库。功能：将 obsidian 笔记发布到 confluence（KMS）、飞书等第三方平台。

详细业务规则见 [AGENTS.md](AGENTS.md)。

## 飞书发布架构（2026-07 起）

插件通过 PersonalAgent + OAuth Device Flow 获取用户身份，直接调用飞书 REST API；不执行 lark-cli、不经过 MCP，也不需要自建 OAuth 回调服务。

- 配置：[src/feishu/feishu-auth.ts](src/feishu/feishu-auth.ts) 一键打开浏览器完成个人授权
- 凭据：[src/feishu/feishu-credential-store.ts](src/feishu/feishu-credential-store.ts) 使用 Electron safeStorage 加密 App Secret 和 Token
- 发布：[src/feishu/feishu-rest-publisher.ts](src/feishu/feishu-rest-publisher.ts) → [src/feishu/feishu-docs-api.ts](src/feishu/feishu-docs-api.ts)
- 接口：`docs_ai/v1` Markdown 创建/覆盖更新，`wiki/v2` 父节点解析和同名子页面查找
- 定位规则与 KMS 一致：`feishu_url` 优先；否则在 `feishu` 父页面下按文件名匹配；仍不存在才新建
- 成功后始终回填 `feishu_url` 与 `feishu_shared_at`，文件改名后同步更新飞书标题
- 已知降级：本地图片/附件替换为占位，无块级高亮色和子文档递归

## 开发收尾流程（每次任务结束自动执行）

完成一个可自洽的改动后，**主动**按顺序执行，不需要等用户提醒：

1. **类型检查 + 构建 + 安装**：`make package && make install`
   - `make package` 内部已经包含 `tsc -noEmit` 类型检查 + esbuild 产物 + 打包 zip
   - `make install` 把 `dist/main.js` 和 `dist/manifest.json` 拷到 `/Users/anner/notes/Work/.obsidian/plugins/obsidian-publish-everywhere/`
2. **commit**：按全局 CLAUDE.md 的 Conventional Commits 规范，自行拟定 type/scope/message，立即提交
3. **不推远端**：`git push`、合并、tag 推送等远端动作一律由我手动执行

如果 `make package` 失败（类型错误、esbuild 报错），先修，修好再走完整流程；不要把构建失败的产物 commit。

## 常用命令

| 命令 | 作用 |
|---|---|
| `make package` | 类型检查 + 打包 main.js / manifest.json 到 dist/ |
| `make install` | 部署到 obsidian vault（默认 `/Users/anner/notes/Work`） |
| `make upload` | 上传 zip 到云端（需要 python oss2） |
| `npm run dev` | esbuild watch 模式，开发时实时编译 |

## 仓库结构关键点

- [main.ts](main.ts)：插件入口、命令注册、各平台发布调度
- [src/feishu/](src/feishu/)：飞书 PersonalAgent/OAuth 与 REST 发布
- [src/confluence/](src/confluence/)：Confluence/KMS 发布
- [src/notion/](src/notion/)：Notion 发布
- [src/github/](src/github/)：GitHub README 发布
- [src/xiaohongshu/](src/xiaohongshu/)：小红书素材生成
- [src/markdown-processor.ts](src/markdown-processor.ts)：所有平台共享的 markdown 解析（front-matter、wiki links、callout、图片占位）
- [src/settings.ts](src/settings.ts)：统一设置 UI

## 笔记位置

obsidian 笔记库：`/Users/anner/notes/Work/`（可用 obsidian skill 读写）
