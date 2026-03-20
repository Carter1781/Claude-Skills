---
name: browser-api
description: |
  通过 Playwright MCP Bridge 连接和控制浏览器，实现网站 API 封装。
  当用户要求"连接浏览器"、"控制网站"、"封装 API"、"浏览器自动化"、"网页操作"时使用此技能。
  也适用于：QA 测试、网页 dogfooding、表单测试、页面截图、元素交互、流式响应处理等场景。
  特别是当需要复用已登录网站的会话状态时（如 AI 对话网站），优先使用此技能。
compatibility: Playwright MCP Bridge, Chrome Debugging Port
---

# Browser API Skill

通过 Playwright MCP Bridge 连接已有 Chrome 浏览器，实现网站 API 封装和自动化控制。

## 架构

```
┌──────────────┐     CDP WebSocket      ┌─────────┐
│ Claude Code  │◄────────────────────►│  Chrome │
│ + Playwright │                      │  :9222  │
│ MCP Bridge   │                      │ (Debug) │
└──────────────┘                      └─────────┘
```

## 开发经验总结

### 经验1：CORS 问题解决方案

**问题**：在 Playwright MCP 浏览器环境中，Web UI 使用 `fetch` 调用 API 会遇到 CORS 限制。

**解决方案**：使用 `XMLHttpRequest` 替代 `fetch`，它可以绕过 CORS 限制：

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

// ❌ 错误方式：fetch 会被 CORS 阻止
const resp = await fetch(url, { method, body, headers });
```

### 经验2：流式响应检测完整流程

**问题**：AI 网站的流式输出，固定延迟不可靠（太短漏内容，太长浪费时间）。

**正确流程**：
1. 发送消息后，轮询检测 `.message-btns` 元素是否出现（功能图标：复制、点赞等）
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
      // ✅ 检测到功能图标后，等待 500ms 确保内容已完全写入
      await new Promise(r => setTimeout(r, 500));

      // ✅ 再读取一次确认内容完整
      const confirmStatus = await page.evaluate(() => {
        const msgs = document.querySelectorAll('.message-container');
        const lastMsg = msgs[msgs.length - 1];
        const content = lastMsg?.querySelector('.message-content');
        return content?.innerText || null;
      });

      if (confirmStatus.success && confirmStatus.result) {
        responseText = confirmStatus.result;
        break;
      }
    }
  }
}
```

### 经验3：API 服务器与 Web UI 同端口部署

**问题**：分开部署会导致 CORS 问题。

**解决方案**：使用 Express 的 `express.static('.')` 在同一端口同时提供 API 和静态文件：

```javascript
import express from 'express';
import { chromium } from 'playwright';

const app = express();
const PORT = 3000;

// API 路由
app.use(express.json());
app.post('/session/:id/evaluate', (req, res) => {
  // 处理请求...
});

// ⚠️ 关键：同时托管静态文件，避免 CORS
app.use(express.static('.'));

app.listen(PORT);
// 访问 http://localhost:3000 即可使用 Web UI
```

## 核心流程

### 1. 启动 Chrome 调试模式

```bash
# macOS
open -a "Google Chrome" --args --remote-debugging-port=9222

# Windows
chrome.exe --remote-debugging-port=9222

# Linux
google-chrome --remote-debugging-port=9222
```

### 2. 获取 WebSocket URL 并连接

```javascript
const resp = await fetch('http://localhost:9222/json/version');
const data = await resp.json();
const browser = await chromium.connectOverCDP(data.webSocketDebuggerUrl);
```

### 3. 创建会话

```javascript
const context = browser.contexts()[0] || await browser.newContext();
const page = context.pages()[0] || await context.newPage();
```

## 常用操作

### 导航
```javascript
await page.goto('https://example.com');
```

### 输入文本
```javascript
await page.fill('textarea', 'Hello World');
```

### 点击元素
```javascript
await page.click('.send-button');
```

### 执行 JavaScript
```javascript
const result = await page.evaluate(() => {
  return document.title;
});
```

### 截图
```javascript
const screenshot = await page.screenshot({ encoding: 'base64' });
```

### 等待元素
```javascript
await page.waitForSelector('.message-btns', { timeout: 60000 });
```

## 完整 Web UI 实现参考

参考 `index.html`，关键要点：

1. **使用 XMLHttpRequest** 而非 fetch：
```javascript
async function api(method, endpoint, body = null) {
  const url = `${API}${endpoint}`;
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

2. **流式响应轮询逻辑**：如上所述，检测 `.message-btns` + 500ms 延迟 + 二次确认

3. **状态指示器**：显示服务器、Chrome、页面的连接状态

## 调试技巧

1. **检查 Chrome 是否支持调试**：
   ```bash
   curl http://localhost:9222/json/version
   ```

2. **查看所有页面**：
   ```bash
   curl http://localhost:9222/json/list
   ```

3. **测试 CDP 连接**：
   ```javascript
   const browser = await chromium.connectOverCDP(wsUrl);
   console.log('Contexts:', browser.contexts().length);
   ```

4. **常见错误**：
   - `net::ERR_CONNECTION_REFUSED` - Chrome 调试端口未启动
   - `Target page closed` - 页面被关闭或导航导致上下文丢失
   - CORS 错误 - 使用 XMLHttpRequest 替代 fetch

## 项目结构

```
browser-api/
├── SKILL.md          # 本文件
├── README.md         # 使用文档
├── server.js         # HTTP API 服务器
├── index.html        # Web UI 测试界面
└── package.json      # 依赖配置
```

## 注意事项

1. **登录状态复用**：使用已有 Chrome 配置文件，避免重复登录
   ```javascript
   const browser = await chromium.connectOverCDP(cdpUrl, {
     transport: 'pipe'
   });
   ```

2. **选择器稳定性**：优先使用 `data-*` 属性或稳定的选择器，避免使用易变化的类名

3. **流式响应检测**：必须检测 UI 元素（`.message-btns`）确认完成，不能依赖文本内容判断

4. **CORS 问题**：Playwright MCP 浏览器环境中必须使用 XMLHttpRequest

5. **同端口部署**：API 服务器和 Web UI 必须部署在同一端口

6. **内容完整性**：检测到响应完成元素后，等待 500ms 再读取，确保内容已完全写入

7. **错误处理**：所有 API 调用都应包含错误处理和超时机制
