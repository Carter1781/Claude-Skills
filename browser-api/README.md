# Browser API - 网站 API 封装工具

通过 Playwright MCP Bridge 连接 Chrome，实现网站 API 封装和自动化控制。

## 功能特点

- 复用已登录网站的会话状态
- 支持流式 AI 响应的完整检测
- 提供 HTTP API 服务器
- Web UI 测试界面
- 解决 Playwright MCP 浏览器环境下的 CORS 问题

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
node server.js
# 服务器运行在 http://localhost:3000
```

### 4. 打开 Web UI

访问 http://localhost:3000 使用可视化界面测试。

## 重要经验

### CORS 问题

**问题**：在 Playwright MCP 浏览器中使用 `fetch` 调用 API 会被 CORS 阻止。

**解决**：Web UI 必须使用 `XMLHttpRequest` 替代 `fetch`：

```javascript
// ✅ 正确
const xhr = new XMLHttpRequest();
xhr.open('POST', url, true);
xhr.setRequestHeader('Content-Type', 'application/json');
xhr.onload = () => resolve(JSON.parse(xhr.responseText));
xhr.send(data);

// ❌ 错误 - 会被 CORS 阻止
fetch(url, { method: 'POST', body: data, headers });
```

### 流式响应检测

**问题**：AI 网站流式输出，固定延迟不可靠。

**解决**：检测 `.message-btns` 元素出现，等待 500ms，再二次确认：

```javascript
// 1. 发送消息
await page.fill('textarea', '你好');
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
    // 4. 二次确认内容完整
    const finalText = await page.evaluate(() => {
      const msgs = document.querySelectorAll('.message-container');
      return msgs[msgs.length - 1]?.querySelector('.message-content')?.innerText;
    });
    break;
  }
  attempts++;
}
```

## API 文档

### 健康检查
```bash
curl http://localhost:3000/health
```

### 创建会话
```bash
curl -X POST http://localhost:3000/session
# 返回: { "success": true, "sessionId": "xxx" }
```

### 导航
```bash
curl -X POST http://localhost:3000/session/:id/navigate \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com"}'
```

### 输入文本
```bash
curl -X POST http://localhost:3000/session/:id/type \
  -H "Content-Type: application/json" \
  -d '{"selector": "textarea", "text": "Hello"}'
```

### 点击元素
```bash
curl -X POST http://localhost:3000/session/:id/click \
  -H "Content-Type: application/json" \
  -d '{"selector": ".send-button"}'
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

## 使用示例

### 与 AI 对话（MyTan）

```bash
# 1. 创建会话
SID=$(curl -s -X POST http://localhost:3000/session | jq -r '.sessionId')

# 2. 输入消息
curl -X POST "http://localhost:3000/session/$SID/type" \
  -H "Content-Type: application/json" \
  -d '{"selector": "textarea", "text": "你好"}'

# 3. 点击发送
curl -X POST "http://localhost:3000/session/$SID/evaluate" \
  -H "Content-Type: application/json" \
  -d '{"script": "document.querySelector(\".send-icon\").closest(\".pointer\").click()"}'

# 4. 等待回复完成（检测 .message-btns 出现）
# 参考上面的流式响应检测逻辑

# 5. 提取回复
curl -X POST "http://localhost:3000/session/$SID/evaluate" \
  -H "Content-Type: application/json" \
  -d '{"script": "(function(){ var msgs = document.querySelectorAll(\"div.message-container\"); var last = msgs[msgs.length-1]; return last ? last.querySelector(\".message-content\").innerText : null; })()"}'
```

## 项目结构

```
browser-api/
├── SKILL.md          # 技能定义
├── README.md         # 本文档
├── server.js         # HTTP API 服务器
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
# 检查 Chrome 是否支持调试
curl http://localhost:9222/json/version
```

### 2. CORS 错误

如果 Web UI 调用 API 时出现 CORS 错误，确保：
1. 使用 `XMLHttpRequest` 而非 `fetch`
2. API 服务器和 Web UI 在同一端口

### 3. 流式响应检测失败

必须使用 `.message-btns` 等 UI 元素判断响应完成，不能依赖：
- 固定延迟（太短漏内容，太长浪费时间）
- 文本内容判断（内容可能未完全写入）

### 4. 页面上下文丢失

如果页面导航或关闭导致上下文丢失，需要重新创建会话。

## License

MIT
