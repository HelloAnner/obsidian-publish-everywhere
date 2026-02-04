# KMS 发布权限控制设计

## 背景
KMS 页面需要支持 `kms_open` 属性：默认公开；当设置为 `false` 时，仅当前配置的 KMS 账号可见。

## 目标
- 支持 `kms_open: false` 自动加“读取限制”。
- 默认不设置限制（公开）。

## 方案
- 发布完成后调用 Confluence Server/DC REST API：
  - `PUT /rest/api/content/{id}/restriction`
  - payload 只设置 `read`，并清空 `group`，仅保留当前用户名。
- KMS 账号来源：插件配置的 `username`。

## 行为
- `kms_open` 缺省或为真：不设置限制。
- `kms_open: false`：页面只对当前账号可见。
- API 失败：仅记录日志，不影响发布流程。

## 验证
- 运行 `make package`。
