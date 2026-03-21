# Browser API - Chrome DevTools MCP 风格封装工具

基于 Puppeteer + Chrome DevTools Protocol 实现浏览器自动化和网站 API 封装。

## 功能特点

- 复用已登录网站的会话状态
- 支持流式 AI 响应的完整检测
- Chrome DevTools MCP 风格 API
- HTTP API 服务器 + Web UI 测试界面
- 解决浏览器环境下的 CORS 问题

## 快速开始

### 1. 启动 Chrome 调试模式

```bash
# macOS
open -a "Google Chrome" --args --remote-debugging-port=9222

# Windows
chrome.exe --remote-debugging-port=9222

# Linux
google-chrome --remote-debugging-port=9222
```

### 2. 安装依赖

```bash
npm install
```

### 3. 启动服务器

```bash
npm start
# 服务器运行在 http://localhost:3000
```

### 4. 打开 Web UI

访问 http://localhost:3000 使用可视化界面测试。

## API 文档

### 健康检查
```bash
curl http://localhost:3000/health
```

### 创建会话
```bash
curl -X POST http://localhost:3000/session
# 返回: { "success": true, "sessionId": "xxx", "url": "..." }
```

### 导航
```bash
curl -X POST http://localhost:3000/session/:id/navigate \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com"}'
```

### 点击元素
```bash
curl -X POST http://localhost:3000/session/:id/click \
  -H "Content-Type: application/json" \
  -d '{"selector": ".send-button"}'
```

### 输入文本
```bash
curl -X POST http://localhost:3000/session/:id/type \
  -H "Content-Type: application/json" \
  -d '{"selector": "textarea", "text": "Hello"}'
```

### 执行 JavaScript
```bash
curl -X POST http://localhost:3000/session/:id/evaluate \
  -H "Content-Type: application/json" \
  -d '{"script": "document.title"}'
```

### 截图
```bash
curl "http://localhost:3000/session/:id/screenshot" | jq -r '.screenshot' | base64 -d > screenshot.png
```

### 关闭会话
```bash
curl -X DELETE http://localhost:3000/session/:id
```

## 重要经验

### CORS 问题

**问题**：在浏览器中使用 `fetch` 调用 API 会被 CORS 阻止。

**解决**：Web UI 必须使用 `XMLHttpRequest`：

```javascript
// ✅ 正确
const xhr = new XMLHttpRequest();
xhr.open('POST', url, true);
xhr.setRequestHeader('Content-Type', 'application/json');
xhr.onload = () => resolve(JSON.parse(xhr.responseText));
xhr.send(data);
```

### 流式响应检测

**问题**：AI 网站流式输出，固定延迟不可靠。

**解决**：检测 `.message-btns` 元素出现，等待 500ms，再确认：

```javascript
// 1. 发送消息
await page.click('.send-button');

// 2. 轮询检测 .message-btns 出现
let attempts = 0;
while (attempts < 60) {
  await new Promise(r => setTimeout(r, 1000));
  const { hasBtns, text } = await page.evaluate(() => {
    const msgs = document.querySelectorAll('.message-container');
    const last = msgs[msgs.length - 1];
    return {
      hasBtns: !!last?.querySelector('.message-btns'),
      text: last?.querySelector('.message-content')?.innerText
    };
  });
  if (hasBtns && text?.length > 10) {
    // 3. 等待 500ms 确保内容完全写入
    await new Promise(r => setTimeout(r, 500));
    break;
  }
  attempts++;
}
```

## 项目结构

```
browser-api/
├── SKILL.md          # 技能定义
├── README.md         # 本文档
├── server.js         # Puppeteer HTTP API 服务器
├── index.html        # Web UI 测试界面
└── package.json      # 依赖配置
```

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| PORT | 3000 | 服务器端口 |
| CDP_PORT | 9222 | Chrome 调试端口 |

## 常见问题

### 1. Chrome 调试端口无法连接

确保 Chrome 已使用 `--remote-debugging-port=9222` 启动：

```bash
# 检查
curl http://localhost:9222/json/version
```

### 2. CORS 错误

确保：
1. 使用 `XMLHttpRequest` 而非 `fetch`
2. API 服务器和 Web UI 在同一端口

### 3. 流式响应检测失败

必须使用 `.message-btns` 等 UI 元素判断响应完成，不能依赖：
- 固定延迟（太短漏内容，太长浪费时间）
- 文本内容判断（内容可能未完全写入）

## 与 Chrome DevTools MCP 的关系

| 特性 | Chrome DevTools MCP | Browser API |
|------|---------------------|-------------|
| 接口风格 | MCP Tools | HTTP REST API |
| 调用方式 | IDE 集成 | 任意 HTTP 客户端 |
| 适用场景 | 调试/分析 | 远程封装/集成 |
| 底层协议 | CDP + Puppeteer | CDP + Puppeteer |

两者使用相同的底层技术，API 风格兼容。

## License

MIT
