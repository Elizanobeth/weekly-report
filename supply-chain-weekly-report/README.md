# 供应链信息化团队周报

当前仅实施“阶段零：WPS能力验证”。在真实读写验证通过前，不创建正式周报应用。

## 已完成

- WPS多维表格只读记录检查；
- 可选 KSO-1 请求签名；
- 需要双重确认的测试记录创建和更新；
- 敏感字段不输出；
- 官方签名示例自动测试。

## 准备测试配置

请使用非生产 WPS 多维表格。测试数据表至少准备一个可写的单行文本字段。

必须提供：

- `WPS_ACCESS_TOKEN`：具备目标测试文件权限的访问令牌；
- `WPS_FILE_ID`：测试多维表格文件 ID；
- `WPS_SHEET_ID`：测试数据表 ID，必须是正整数。

如果应用启用了接口签名，还需提供：

- `WPS_SIGNING_ENABLED=true`；
- `WPS_APP_ID`；
- `WPS_APP_SECRET`。

请在本机终端临时设置环境变量，不要把真实值写入 `.env.example`，也不要在聊天中发送访问密钥。

## 只读验证

```bash
npm run check:wps
```

只读结果只输出记录数量、少量记录 ID 和字段名称，不输出单元格内容。

## 创建并更新测试记录

仅确认目标是非生产测试表后执行：

```bash
WPS_ALLOW_WRITE=YES WPS_TEST_TEXT_FIELD=探针字段 npm run check:wps -- --write
```

写入模式需要同时满足三个条件：命令带 `--write`、`WPS_ALLOW_WRITE` 精确等于 `YES`、提供 `WPS_TEST_TEXT_FIELD`。验证器不会自动删除测试记录；请在 WPS 中人工核对创建和更新结果后删除。

## 自动测试

```bash
npm test
```

测试不连接 WPS，也不需要任何真实密钥。
