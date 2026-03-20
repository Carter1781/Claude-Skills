// MyTan API - Playwright Browser Automation API
import express from 'express';
import { chromium } from 'playwright';

const app = express();
const PORT = 3000;

// CORS 支持
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

app.use(express.json());

// 静态文件托管 (同一源避免 CORS)
app.use(express.static('.'));

// 浏览器实例管理
const browsers = new Map();
let browser = null;

// 获取或创建浏览器实例
async function getBrowser() {
  if (!browser || !browser.isConnected()) {
    // 连接到已有的 Chrome 调试端口 (默认 9222)
    const debugPort = process.env.CDP_PORT || '9222';
    try {
      const resp = await fetch(`http://localhost:${debugPort}/json/version`);
      const data = await resp.json();
      browser = await chromium.connectOverCDP(data.webSocketDebuggerUrl);
      console.log(`Connected to existing Chrome on port ${debugPort}`);
    } catch (e) {
      console.log('No existing Chrome found, launching new browser');
      browser = await chromium.launch({ headless: true });
    }
  }
  return browser;
}

// 页面会话管理
const sessions = new Map();

function generateSessionId() {
  return Math.random().toString(36).substring(2, 15);
}

// 网络请求拦截器
const networkLogs = new Map();

// 通用响应格式
function success(data) {
  return { success: true, ...data };
}

function error(message, details = null) {
  return { success: false, error: message, details };
}

// ============================================
// 浏览器管理
// ============================================

// GET /health - 健康检查
app.get('/health', (req, res) => {
  res.json(success({
    status: 'ok',
    browserConnected: browser?.isConnected() || false,
    activeSessions: sessions.size
  }));
});

// ============================================
// 会话管理
// ============================================

// POST /session - 创建新会话
app.post('/session', async (req, res) => {
  try {
    const b = await getBrowser();

    // 尝试找到 MyTan 页面
    let page;
    let context;
    const contexts = b.contexts();

    for (const ctx of contexts) {
      const pages = ctx.pages();
      for (const p of pages) {
        const url = p.url();
        if (url.includes('mytan.maiseed.com.cn')) {
          page = p;
          context = ctx;
          console.log('Found MyTan page:', url);
          break;
        }
      }
      if (page) break;
    }

    // 如果没有找到 MyTan 页面，尝试找第一个可用的已打开页面
    if (!page && contexts.length > 0) {
      const firstCtx = contexts[0];
      const pages = firstCtx.pages();
      if (pages.length > 0) {
        page = pages[0];
        context = firstCtx;
        console.log('Using first available page:', page.url());
      }
    }

    // 如果还是没有可用页面，创建新的
    if (!page) {
      context = await b.newContext({
        viewport: { width: 1280, height: 720 }
      });
      page = await context.newPage();
      console.log('Created new page');
    }

    const sessionId = generateSessionId();

    // 初始化网络日志
    const logs = [];
    networkLogs.set(sessionId, logs);

    // 拦截网络请求
    await page.route('**/*', async route => {
      const request = route.request();
      const url = request.url();
      const method = request.method();
      const postData = request.postData();

      // 记录 API 请求
      if (url.includes('/api/') || url.includes('/auth/') || url.includes('/login')) {
        logs.push({
          timestamp: new Date().toISOString(),
          method,
          url,
          postData: postData ? JSON.parse(postData) : null
        });
        console.log(`[API] ${method} ${url}`);
      }

      await route.continue();
    });

    // 使用 Playwright 的 request 事件监听
    page.on('request', request => {
      const url = request.url();
      const method = request.method();
      const postData = request.postData();

      if (url.includes('/api/') || url.includes('/auth/') || url.includes('/login')) {
        logs.push({
          timestamp: new Date().toISOString(),
          method,
          url,
          postData: postData ? (() => { try { return JSON.parse(postData); } catch { return postData; } })() : null
        });
        console.log(`[Request] ${method} ${url}`);
      }
    });

    sessions.set(sessionId, { context, page, createdAt: new Date(), logs });

    console.log(`Session created: ${sessionId}`);

    res.status(201).json(success({ sessionId }));
  } catch (err) {
    console.error('Create session error:', err);
    res.status(500).json(error('Failed to create session', err.message));
  }
});

// DELETE /session/:id - 关闭会话
app.delete('/session/:id', async (req, res) => {
  const { id } = req.params;
  const session = sessions.get(id);

  if (!session) {
    return res.status(404).json(error('Session not found'));
  }

  try {
    await session.context.close();
    sessions.delete(id);
    networkLogs.delete(id);
    console.log(`Session closed: ${id}`);
    res.json(success({ message: 'Session closed' }));
  } catch (err) {
    console.error('Close session error:', err);
    res.status(500).json(error('Failed to close session', err.message));
  }
});

// GET /session/:id/network - 获取网络请求日志
app.get('/session/:id/network', async (req, res) => {
  const { id } = req.params;
  const session = sessions.get(id);

  if (!session) {
    return res.status(404).json(error('Session not found'));
  }

  res.json(success({ logs: session.logs || [] }));
});

// ============================================
// MyTan 专用 API
// ============================================

// POST /session/:id/mytan/login - MyTan 登录
app.post('/session/:id/mytan/login', async (req, res) => {
  const { id } = req.params;
  const { identity, password, remember = true } = req.body;

  if (!identity || !password) {
    return res.status(400).json(error('identity and password are required'));
  }

  const session = sessions.get(id);
  if (!session) {
    return res.status(404).json(error('Session not found'));
  }

  try {
    // 直接调用登录 API
    const response = await fetch('https://mytan.maiseed.com.cn/api/v1/users/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identity, password, remember })
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json(error('Login failed', data));
    }

    // 提取 cookie
    const cookies = response.headers.getSetCookie?.() || [];
    const cookieStr = cookies.join('; ');

    res.json(success({
      message: 'Login successful',
      user: data.user || data.data,
      cookies: cookieStr
    }));
  } catch (err) {
    res.status(500).json(error('Login error', err.message));
  }
});

// POST /session/:id/mytan/login-browser - 在浏览器中登录 MyTan
app.post('/session/:id/mytan/login-browser', async (req, res) => {
  const { id } = req.params;
  const { identity, password } = req.body;

  if (!identity || !password) {
    return res.status(400).json(error('identity and password are required'));
  }

  const session = sessions.get(id);
  if (!session) {
    return res.status(404).json(error('Session not found'));
  }

  try {
    // 1. 先清除现有 cookies
    await session.context.clearCookies();

    // 2. 导航到登录页
    await session.page.goto('https://mytan.maiseed.com.cn/login', { waitUntil: 'networkidle' });

    // 3. 输入手机号
    await session.page.fill('input[placeholder*="號碼"]', identity);

    // 4. 输入密码
    await session.page.fill('input[type="password"]', password);

    // 5. 点击登录按钮
    await session.page.click('button:has-text("登錄")');

    // 6. 等待登录完成（检查 URL 变化或出现聊天界面）
    try {
      await session.page.waitForURL('**/chat/**', { timeout: 10000 });
    } catch (e) {
      // 可能已经在聊天页面
    }

    // 7. 等待网络空闲
    await session.page.waitForLoadState('networkidle');

    // 8. 获取 cookies
    const cookies = await session.context.cookies('https://mytan.maiseed.com.cn');

    res.json(success({
      message: 'Login successful',
      url: session.page.url(),
      cookies: cookies.reduce((acc, c) => { acc[c.name] = c.value; return acc; }, {})
    }));
  } catch (err) {
    console.error('Browser login error:', err);
    res.status(500).json(error('Browser login failed', err.message));
  }
});

// POST /session/:id/cookies - 设置 Cookies
app.post('/session/:id/cookies', async (req, res) => {
  const { id } = req.params;
  const { cookies, domain = '.mytan.maiseed.com.cn' } = req.body;

  if (!cookies || !Array.isArray(cookies)) {
    return res.status(400).json(error('cookies array is required'));
  }

  const session = sessions.get(id);
  if (!session) {
    return res.status(404).json(error('Session not found'));
  }

  try {
    // 格式化 cookies
    const formattedCookies = cookies.map(c => ({
      name: c.name,
      value: c.value || c,
      domain: c.domain || domain,
      path: c.path || '/',
      secure: c.secure !== false,
      httpOnly: c.httpOnly || false,
      sameSite: c.sameSite || 'Lax'
    }));

    await session.context.addCookies(formattedCookies);

    // 验证 cookies
    const currentCookies = await session.context.cookies('https://mytan.maiseed.com.cn');

    res.json(success({
      message: 'Cookies set successfully',
      cookiesSet: formattedCookies.length,
      verified: currentCookies.length
    }));
  } catch (err) {
    console.error('Set cookies error:', err);
    res.status(500).json(error('Failed to set cookies', err.message));
  }
});

// POST /session/:id/attach - 接管已有浏览器
app.post('/session/:id/attach', async (req, res) => {
  const { id } = req.params;
  const { wsEndpoint } = req.body;

  const session = sessions.get(id);
  if (!session) {
    return res.status(404).json(error('Session not found'));
  }

  try {
    // 检查是否有 Chrome 调试端口可用
    const debugPorts = [9222, 9223, 9224, 9333];

    let connected = false;
    let browserUrl = null;

    for (const port of debugPorts) {
      try {
        const resp = await fetch(`http://localhost:${port}/json/version`);
        if (resp.ok) {
          const data = await resp.json();
          if (data.webSocketDebuggerUrl) {
            browserUrl = data.webSocketDebuggerUrl;
            connected = true;
            break;
          }
        }
      } catch (e) {
        // 端口不可用，继续尝试下一个
      }
    }

    if (connected && browserUrl) {
      // 关闭当前 context
      await session.context.close();

      // 连接到已有的 Chrome
      const existingBrowser = await chromium.connect(browserUrl);
      const targets = await existingBrowser.targets();
      const pageTarget = targets.find(t => t.url().includes('mytan.maiseed.com.cn'));
      const page = await pageTarget?.page();

      if (page) {
        // 替换 session 中的 page
        session.page = page;
        session.context = page.context();

        res.json(success({
          message: 'Attached to existing browser',
          url: page.url()
        }));
      } else {
        res.json(error('No MyTan page found in existing browser'));
      }
    } else {
      res.json(error('No Chrome debug port found. Please start Chrome with: chrome --remote-debugging-port=9222'));
    }
  } catch (err) {
    console.error('Attach error:', err);
    res.status(500).json(error('Failed to attach to browser', err.message));
  }
});

// POST /session/:id/mytan/message - 发送消息并获取回复
app.post('/session/:id/mytan/message', async (req, res) => {
  const { id } = req.params;
  const { text, conversationId, waitForResponse = true, timeout = 60000 } = req.body;

  if (!text) {
    return res.status(400).json(error('text is required'));
  }

  const session = sessions.get(id);
  if (!session) {
    return res.status(404).json(error('Session not found'));
  }

  try {
    // 获取当前 URL 中的 conversation_id
    const url = session.page.url();
    const urlConvId = url.match(/\/chat\/([a-f0-9]+)/)?.[1] || conversationId;

    if (!urlConvId) {
      return res.status(400).json(error('conversation_id not found in URL'));
    }

    // 清空之前的响应日志
    session.responseLogs = [];

    // 监听响应
    const responsePromise = new Promise((resolve) => {
      // 设置超时
      const timeoutId = setTimeout(() => {
        resolve({ response: null, error: 'timeout' });
      }, timeout);

      // 监听消息响应
      page.on('response', async response => {
        if (response.url().includes('/api/v2/messages')) {
          try {
            const body = await response.text();
            // SSE 响应处理
            if (body.includes('data:')) {
              session.responseLogs.push(body);
            } else {
              try {
                const json = JSON.parse(body);
                session.responseLogs.push(json);
              } catch (e) {}
            }
          } catch (e) {}
        }
      });

      // 检查响应日志
      const checkInterval = setInterval(() => {
        if (session.responseLogs.length > 0) {
          clearInterval(checkInterval);
          clearTimeout(timeoutId);
          resolve({ response: session.responseLogs });
        }
      }, 1000);
    });

    // 在浏览器中输入消息
    await session.page.fill('textarea', text);

    // 点击发送按钮
    await session.page.evaluate(() => {
      const sendIcon = document.querySelector('.send-icon');
      if (sendIcon) {
        const parent = sendIcon.closest('.pointer');
        if (parent) parent.click();
        else sendIcon.click();
      }
    });

    if (waitForResponse) {
      // 等待回复
      await session.page.waitForTimeout(5000);

      // 提取页面上的消息
      const messages = await session.page.evaluate(() => {
        const msgElements = document.querySelectorAll('[class*="message-content"], [class*="chat-message"]');
        return Array.from(msgElements).slice(-5).map(el => el.innerText);
      });

      res.json(success({
        sent: text,
        conversationId: urlConvId,
        pageMessages: messages,
        rawResponses: session.responseLogs
      }));
    } else {
      res.json(success({
        sent: text,
        conversationId: urlConvId
      }));
    }
  } catch (err) {
    res.status(500).json(error('Send message failed', err.message));
  }
});

// ============================================
// 页面导航
// ============================================

// POST /session/:id/navigate - 导航到 URL
app.post('/session/:id/navigate', async (req, res) => {
  const { id } = req.params;
  const { url } = req.body;

  if (!url) {
    return res.status(400).json(error('URL is required'));
  }

  const session = sessions.get(id);
  if (!session) {
    return res.status(404).json(error('Session not found'));
  }

  try {
    const response = await session.page.goto(url, { waitUntil: 'networkidle' });
    const title = await session.page.title();

    res.json(success({
      url: session.page.url(),
      title,
      status: response?.status(),
      loaded: true
    }));
  } catch (err) {
    console.error('Navigate error:', err);
    res.status(500).json(error('Navigation failed', err.message));
  }
});

// POST /session/:id/back - 返回上一页
app.post('/session/:id/back', async (req, res) => {
  const { id } = req.params;
  const session = sessions.get(id);

  if (!session) {
    return res.status(404).json(error('Session not found'));
  }

  try {
    await session.page.goBack({ waitUntil: 'networkidle' });
    res.json(success({ url: session.page.url() }));
  } catch (err) {
    res.status(500).json(error('Go back failed', err.message));
  }
});

// ============================================
// 元素交互
// ============================================

// POST /session/:id/click - 点击元素
app.post('/session/:id/click', async (req, res) => {
  const { id } = req.params;
  const { selector } = req.body;

  if (!selector) {
    return res.status(400).json(error('Selector is required'));
  }

  const session = sessions.get(id);
  if (!session) {
    return res.status(404).json(error('Session not found'));
  }

  try {
    await session.page.click(selector);
    res.json(success({ clicked: selector }));
  } catch (err) {
    res.status(500).json(error('Click failed', err.message));
  }
});

// POST /session/:id/type - 输入文本
app.post('/session/:id/type', async (req, res) => {
  const { id } = req.params;
  const { selector, text } = req.body;

  if (!selector || text === undefined) {
    return res.status(400).json(error('Selector and text are required'));
  }

  const session = sessions.get(id);
  if (!session) {
    return res.status(404).json(error('Session not found'));
  }

  try {
    await session.page.fill(selector, text);
    res.json(success({ typed: text, at: selector }));
  } catch (err) {
    res.status(500).json(error('Type failed', err.message));
  }
});

// POST /session/:id/press - 按键
app.post('/session/:id/press', async (req, res) => {
  const { id } = req.params;
  const { key } = req.body;

  if (!key) {
    return res.status(400).json(error('Key is required'));
  }

  const session = sessions.get(id);
  if (!session) {
    return res.status(404).json(error('Session not found'));
  }

  try {
    await session.page.keyboard.press(key);
    res.json(success({ pressed: key }));
  } catch (err) {
    res.status(500).json(error('Press failed', err.message));
  }
});

// POST /session/:id/hover - 悬停
app.post('/session/:id/hover', async (req, res) => {
  const { id } = req.params;
  const { selector } = req.body;

  if (!selector) {
    return res.status(400).json(error('Selector is required'));
  }

  const session = sessions.get(id);
  if (!session) {
    return res.status(404).json(error('Session not found'));
  }

  try {
    await session.page.hover(selector);
    res.json(success({ hovered: selector }));
  } catch (err) {
    res.status(500).json(error('Hover failed', err.message));
  }
});

// ============================================
// 内容提取
// ============================================

// GET /session/:id/snapshot - 获取页面快照
app.get('/session/:id/snapshot', async (req, res) => {
  const { id } = req.params;
  const session = sessions.get(id);

  if (!session) {
    return res.status(404).json(error('Session not found'));
  }

  try {
    const snapshot = await session.page.accessibility.snapshot();
    res.json(success({ snapshot }));
  } catch (err) {
    res.status(500).json(error('Snapshot failed', err.message));
  }
});

// POST /session/:id/extract - 提取元素内容
app.post('/session/:id/extract', async (req, res) => {
  const { id } = req.params;
  const { selector, type = 'text' } = req.body;

  if (!selector) {
    return res.status(400).json(error('Selector is required'));
  }

  const session = sessions.get(id);
  if (!session) {
    return res.status(404).json(error('Session not found'));
  }

  try {
    const element = await session.page.locator(selector).first();
    let value;

    switch (type) {
      case 'text':
        value = await element.innerText();
        break;
      case 'html':
        value = await element.innerHTML();
        break;
      case 'attribute':
        value = await element.getAttribute(req.body.attribute);
        break;
      default:
        value = await element.innerText();
    }

    res.json(success({ value, type }));
  } catch (err) {
    res.status(500).json(error('Extract failed', err.message));
  }
});

// GET /session/:id/screenshot - 截图
app.get('/session/:id/screenshot', async (req, res) => {
  const { id } = req.params;
  const { fullPage = false } = req.query;

  const session = sessions.get(id);
  if (!session) {
    return res.status(404).json(error('Session not found'));
  }

  try {
    const buffer = await session.page.screenshot({ fullPage: fullPage === 'true' });
    const base64 = buffer.toString('base64');
    res.json(success({
      screenshot: `data:image/png;base64,${base64}`,
      size: buffer.length
    }));
  } catch (err) {
    res.status(500).json(error('Screenshot failed', err.message));
  }
});

// ============================================
// JavaScript 执行
// ============================================

// POST /session/:id/evaluate - 执行 JavaScript
app.post('/session/:id/evaluate', async (req, res) => {
  const { id } = req.params;
  const { script } = req.body;

  if (!script) {
    return res.status(400).json(error('Script is required'));
  }

  const session = sessions.get(id);
  if (!session) {
    return res.status(404).json(error('Session not found'));
  }

  try {
    const result = await session.page.evaluate(script);
    res.json(success({ result }));
  } catch (err) {
    res.status(500).json(error('Evaluate failed', err.message));
  }
});

// ============================================
// 等待
// ============================================

// POST /session/:id/wait - 等待条件
app.post('/session/:id/wait', async (req, res) => {
  const { id } = req.params;
  const { type, value, timeout = 30000 } = req.body;

  const session = sessions.get(id);
  if (!session) {
    return res.status(404).json(error('Session not found'));
  }

  try {
    switch (type) {
      case 'selector':
        await session.page.waitForSelector(value, { timeout });
        break;
      case 'text':
        await session.page.waitForTextContent(value, { timeout });
        break;
      case 'function':
        await session.page.waitForFunction(value, { timeout });
        break;
      case 'navigation':
        await session.page.waitForNavigation({ waitUntil: value || 'networkidle', timeout });
        break;
      default:
        throw new Error(`Unknown wait type: ${type}`);
    }
    res.json(success({ waited: type }));
  } catch (err) {
    res.status(500).json(error('Wait failed', err.message));
  }
});

// ============================================
// 对话框处理
// ============================================

// POST /session/:id/dialog - 处理对话框
app.post('/session/:id/dialog', async (req, res) => {
  const { id } = req.params;
  const { accept = true, promptText } = req.body;

  const session = sessions.get(id);
  if (!session) {
    return res.status(404).json(error('Session not found'));
  }

  try {
    session.page.once('dialog', async dialog => {
      if (promptText !== undefined) {
        await dialog.accept(promptText);
      } else if (accept) {
        await dialog.accept();
      } else {
        await dialog.dismiss();
      }
    });
    res.json(success({ handled: true }));
  } catch (err) {
    res.status(500).json(error('Dialog handling failed', err.message));
  }
});

// ============================================
// 启动服务器
// ============================================

app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════╗
║          MyTan API Server Started           ║
╠══════════════════════════════════════════════╣
║  URL: http://localhost:${PORT}                  ║
║  Health: http://localhost:${PORT}/health        ║
╠══════════════════════════════════════════════╣
║  Endpoints:                                 ║
║  POST   /session        - 创建会话           ║
║  DELETE /session/:id    - 关闭会话           ║
║  POST   /session/:id/navigate - 导航         ║
║  POST   /session/:id/click   - 点击         ║
║  POST   /session/:id/type    - 输入         ║
║  POST   /session/:id/extract - 提取内容     ║
║  GET    /session/:id/screenshot - 截图      ║
║  GET    /session/:id/snapshot - 页面快照    ║
║  POST   /session/:id/evaluate - 执行JS      ║
╚══════════════════════════════════════════════╝
  `);

  getBrowser().catch(console.error);
});

// 优雅关闭
process.on('SIGINT', async () => {
  console.log('\nShutting down...');
  for (const [id, session] of sessions) {
    await session.context.close().catch(console.error);
  }
  await browser?.close();
  process.exit(0);
});
