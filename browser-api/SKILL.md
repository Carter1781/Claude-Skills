---
name: browser-api
description: |
  通过 Chrome DevTools MCP 风格实现浏览器自动化和网站 API 封装。
  当用户要求"连接浏览器"、"控制网站"、"封装 API"、"浏览器自动化"、"网页操作"时使用此技能。
  也适用于：QA 测试、网页 dogfooding、表单测试、页面截图、元素交互、流式响应处理等场景。
  特别是当需要复用已登录网站的会话状态时（如 AI 对话网站），优先使用此技能。
compatibility: Chrome DevTools MCP, Puppeteer, Chrome Debugging Port
---

# Browser API Skill

基于 Chrome DevTools Protocol，通过 Puppeteer 实现浏览器自动化（兼容 Chrome DevTools MCP 风格）。

## 架构

```
┌──────────────┐     CDP WebSocket      ┌─────────┐
│  HTTP API    │◄────────────────────►│ Chrome  │
│  (Express)   │                       │ :9222   │
│  + Puppeteer │                       │ (Debug) │
└──────────────┘                       └─────────┘
```

## 核心优势

### 1. 复用已登录状态
通过 Chrome 调试端口连接已有 Chrome 浏览器，无需重新登录。

### 2. Chrome DevTools MCP 风格 API
与 Chrome DevTools MCP 工具风格一致的 API 设计，易于理解和迁移。

### 3. 完整浏览器自动化
支持导航、点击、输入、执行 JS、截图等所有常用操作。

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

### 4. 创建会话

```bash
curl -X POST http://localhost:3000/session
# 返回: { "success": true, "sessionId": "xxx", "url": "..." }
```

## API 参考

### 会话管理

| 方法 | 端点 | 说明 |
|------|------|------|
| POST | /session | 创建新会话 |
| DELETE | /session/:id | 关闭会话 |
| GET | /health | 健康检查 |

### 页面操作

| 方法 | 端点 | 说明 |
|------|------|------|
| POST | /session/:id/navigate | 导航到 URL |
| POST | /session/:id/click | 点击元素 |
| POST | /session/:id/type | 输入文本 |
| POST | /session/:id/hover | 悬停 |
| POST | /session/:id/press | 按键 |

### 内容提取

| 方法 | 端点 | 说明 |
|------|------|------|
| POST | /session/:id/evaluate | 执行 JavaScript |
| POST | /session/:id/extract | 提取元素内容 |
| GET | /session/:id/screenshot | 截图 |

### 等待条件

| 方法 | 端点 | 说明 |
|------|------|------|
| POST | /session/:id/wait | 等待元素/函数/导航 |

## 开发经验总结

### 经验1：CORS 问题解决方案

**问题**：在浏览器环境中，Web UI 使用 `fetch` 调用 API 会遇到 CORS 限制。

**解决方案**：使用 `XMLHttpRequest` 替代 `fetch`：

```javascript
// ✅ 正确方式：XMLHttpRequest 可绕过 CORS
async function api(method, url, body) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, url, true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.onload = () => resolve(JSON.parse(xhr.responseText));
    xhr.onerror = () => reject(new Error('Network error'));
    xhr.send(body ? JSON.stringify(body) : null);
  });
}
```

### 经验2：流式响应检测完整流程

**问题**：AI 网站的流式输出，固定延迟不可靠。

**正确流程**：
1. 发送消息后，轮询检测 `.message-btns` 元素是否出现
2. 检测到后，等待 500ms 确保内容完全写入
3. 再次读取内容确认完整性
4. 只有当 `hasBtns && text && text.length > 10` 时才认为响应完成

```javascript
// 轮询等待流式输出完成
let attempts = 0;
const maxAttempts = 60;
let responseText = '';

while (attempts < maxAttempts) {
  await new Promise(r => setTimeout(r, 1000));
  attempts++;

  const status = await page.evaluate(() => {
    const msgs = document.querySelectorAll('.message-container');
    const lastMsg = msgs[msgs.length - 1];
    if (!lastMsg) return { hasBtns: false, text: null };
    const btns = lastMsg.querySelector('.message-btns');
    const content = lastMsg.querySelector('.message-content');
    return { hasBtns: !!btns, text: content?.innerText || null };
  });

  if (status.success && status.result) {
    const { hasBtns, text } = status.result;
    if (hasBtns && text && text.length > 10) {
      // 检测到功能图标后，等待 500ms 确保内容已完全写入
      await new Promise(r => setTimeout(r, 500));
      responseText = text;
      break;
    }
  }
}
```

### 经验3：Puppeteer 连接已有 Chrome

```javascript
import puppeteer from 'puppeteer';

const resp = await fetch('http://localhost:9222/json/version');
const data = await resp.json();
const browser = await puppeteer.connect({
  browserWSEndpoint: data.webSocketDebuggerUrl,
  defaultViewport: null
});
```

### 经验4：同端口部署

使用 Express 的 `express.static('.')` 在同一端口同时提供 API 和静态文件：

```javascript
app.use(express.json());
app.post('/session/:id/evaluate', (req, res) => { /* ... */ });
app.use(express.static('.')); // 避免 CORS
```

## Web UI 实现

参考 `index.html`，关键要点：

1. **使用 XMLHttpRequest** 而非 fetch
2. **流式响应轮询逻辑**：检测 `.message-btns` + 500ms 延迟 + 二次确认
3. **状态指示器**：显示服务器、Chrome、页面的连接状态

## 调试技巧

1. **检查 Chrome 调试端口**：
   ```bash
   curl http://localhost:9222/json/version
   curl http://localhost:9222/json/list
   ```

2. **查看所有页面**：
   ```bash
   curl http://localhost:9222/json/list | jq '.[] | {url, type}'
   ```

3. **常见错误**：
   - `net::ERR_CONNECTION_REFUSED` - Chrome 调试端口未启动
   - `Target closed` - 页面被关闭或导航导致上下文丢失
   - CORS 错误 - 使用 XMLHttpRequest 替代 fetch

## 项目结构

```
browser-api/
├── SKILL.md          # 本文件
├── README.md         # 使用文档
├── server.js         # Puppeteer HTTP API 服务器
├── index.html        # Web UI 测试界面
└── package.json      # 依赖配置 (puppeteer)
```

## 与 Chrome DevTools MCP 的关系

本技能使用与 Chrome DevTools MCP 相同的底层协议（Chrome DevTools Protocol）和类似的 API 风格，但提供的是 HTTP REST API，便于：

1. **远程调用**：通过 HTTP 调用封装任意网站为 API
2. **多语言集成**：任何支持 HTTP 的语言都可以调用
3. **流水线集成**：易于集成到 CI/CD 或自动化流程

Chrome DevTools MCP 使用 Puppeteer 内部实现，本技能也基于 Puppeteer，两者 API 风格兼容。

## 注意事项

1. **登录状态复用**：使用 Chrome 调试端口连接已有浏览器
2. **选择器稳定性**：优先使用 `data-*` 属性或稳定的选择器
3. **流式响应检测**：必须检测 UI 元素确认完成，不能依赖固定延迟
4. **CORS 问题**：Playwright/Puppeteer 浏览器环境中必须使用 XMLHttpRequest
5. **内容完整性**：检测到响应完成元素后，等待 500ms 再读取
6. **错误处理**：所有 API 调用都应包含错误处理和超时机制
