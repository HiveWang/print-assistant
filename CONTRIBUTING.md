# 参与贡献

感谢你愿意改进打印助手。

## 开始之前

- 先搜索现有 Issue，避免重复反馈。
- Bug 报告请包含操作系统、Docker 版本、CUPS 版本、文件类型和可复现步骤。
- 请勿上传真实办公文件、内网地址、打印机凭据或其他敏感信息。
- 涉及打印参数时，请说明打印机型号和 CUPS/PPD 中对应的选项名称。

## 本地开发

```bash
npm install
npm run dev
```

提交代码前请运行：

```bash
npm run lint
npm test
```

## Pull Request

- 一个 Pull Request 尽量只解决一个问题。
- 清楚说明改动动机、实现方式和验证结果。
- UI 变更请附截图；打印流程变更请说明使用的测试队列。
- 新功能应补充测试和 README 文档。

提交贡献即表示你同意所提交内容按项目的 MIT License 发布。
