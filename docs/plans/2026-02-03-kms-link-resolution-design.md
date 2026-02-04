# KMS 发布链接标题解析设计

## 背景
发布到 KMS 时，笔记中可能包含裸露的 KMS 链接以及 Obsidian Wiki 链接。需要在发布时自动解析并替换为带标题的 Markdown 链接，且仅对裸 KMS 链接写回原文。

## 目标
- 裸 KMS 链接：自动查询标题，替换为 `[标题](链接)`，并更新 Obsidian 原文。
- Wiki 链接：若目标笔记存在 `kms_url`，发布内容替换为 `[显示文本](kms_url)`，不修改原文。

## 方案
- 在 KMS 发布流程内新增预处理步骤，生成两份内容：
  - `updatedContent`：仅替换裸 KMS 链接，用于写回原文。
  - `publishContent`：基于 `updatedContent` 再替换 Wiki 链接，用于发布。
- 通过 Confluence REST API 按 `pageId` 获取标题；同次发布使用内存缓存。
- 替换时跳过已存在的 Markdown 链接。

## 关键流程
1. 读取原文 → 替换裸 KMS 链接 → 写回（如有变化）。
2. 继续替换 Wiki 链接 → 发布到 KMS。
3. 发布后更新 `kms_url` frontmatter。

## 异常处理
- KMS 标题解析失败：保留原链接。
- Wiki 链接找不到文件或缺少 `kms_url`：保持原样。

## 验证
- 运行 `make package`。
