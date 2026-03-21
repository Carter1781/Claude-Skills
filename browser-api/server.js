// Browser API Server - Puppeteer (Chrome DevTools MCP 风格)
// 基于 Chrome DevTools Protocol，通过 Puppeteer 实现浏览器自动化
import express from 'express';
import puppeteer from 'puppeteer';

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
let browser = null;

// 获取或创建浏览器实例 - 支持两种模式
async function getBrowser() {
  if (!browser || !browser.connected) {
    const debugPort = process.env.CDP_PORT || '9222';

    try {
      // 方式1: 连接到已有的 Chrome 调试端口（复用已登录状态）
      const resp = await fetch(`http://localhost:${debugPort}/json/version`);
      if (resp.ok) {
        const data = await resp.json();
        browser = await puppeteer.connect({
          browserWSEndpoint: data.webSocketDebuggerUrl,
          defaultViewport: null
        });
        console.log(`Connected to existing Chrome on port ${debugPort}`);
      }
    } catch (e) {
      console.log('No existing Chrome found, launching new browser');
    }

    // 方式2: 如果没有可用的 Chrome，启动新的
    if (!browser || !browser.connected) {
      browser = await puppeteer.launch({
        headless: false,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });
      console.log('Launched new Chrome browser');
    }
  }
  return browser;
}

// 页面会话管理
const sessions = new Map();

function generateSessionId() {
  return Math.random().toString(36).substring(2, 15);
}

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
app.get('/health', async (req, res) => {
  try {
    const b = await getBrowser();
    const targets = await b.targets();
    res.json(success({
      status: 'ok',
      browserConnected: b.connected,
      activeSessions: sessions.size,
      totalTargets: targets.length
    }));
  } catch (err) {
    res.json(error('Browser error', err.message));
  }
});

// ============================================
// 会话管理
// ============================================

// POST /session - 创建新会话
app.post('/session', async (req, res) => {
  try {
    const b = await getBrowser();

    // 尝试找到已打开的页面
    const targets = await b.targets();
    let page = null;
    let context = null;

    for (const target of targets) {
      const tType = target.type();
      if (tType === 'page' || tType === 'webview') {
        const p = await target.page();
        if (p && !p.isClosed()) {
          page = p;
          context = p.browserContext();
          console.log('Found existing page:', target.url());
          break;
        }
      }
    }

    // 如果没有可用页面，创建新的
    if (!page) {
      const target = await b.createTarget();
      page = await target.page();
      console.log('Created new page');
    }

    const sessionId = generateSessionId();
    sessions.set(sessionId, { page, createdAt: new Date() });

    console.log(`Session created: ${sessionId}, Page: ${page.url()}`);

    res.status(201).json(success({ sessionId, url: page.url() }));
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
    await session.page.close();
    sessions.delete(id);
    console.log(`Session closed: ${id}`);
    res.json(success({ message: 'Session closed' }));
  } catch (err) {
    console.error('Close session error:', err);
    res.status(500).json(error('Failed to close session', err.message));
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
    await session.page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    const title = await session.page.title();
    const finalUrl = session.page.url();

    res.json(success({
      url: finalUrl,
      title,
      loaded: true
    }));
  } catch (err) {
    console.error('Navigate error:', err);
    res.status(500).json(error('Navigation failed', err.message));
  }
});

// ============================================
// 元素交互 (Chrome DevTools MCP 风格)
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
    await session.page.evaluate((sel, txt) => {
      const el = document.querySelector(sel);
      if (el) {
        el.value = txt;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }, selector, text);
    res.json(success({ typed: text, at: selector }));
  } catch (err) {
    res.status(500).json(error('Type failed', err.message));
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

// ============================================
// 内容提取
// ============================================

// GET /session/:id/screenshot - 截图
app.get('/session/:id/screenshot', async (req, res) => {
  const { id } = req.params;
  const { fullPage = false } = req.query;

  const session = sessions.get(id);
  if (!session) {
    return res.status(404).json(error('Session not found'));
  }

  try {
    const buffer = await session.page.screenshot({
      fullPage: fullPage === 'true',
      encoding: 'base64'
    });
    res.json(success({
      screenshot: `data:image/png;base64,${buffer}`,
      type: 'png'
    }));
  } catch (err) {
    res.status(500).json(error('Screenshot failed', err.message));
  }
});

// POST /session/:id/evaluate - 执行 JavaScript
app.post('/session/:id/evaluate', async (req, res) => {
  const { id } = req.params;
  const { script, waitForSelector, timeout = 30000 } = req.body;

  if (!script) {
    return res.status(400).json(error('Script is required'));
  }

  const session = sessions.get(id);
  if (!session) {
    return res.status(404).json(error('Session not found'));
  }

  try {
    // 如果指定了 waitForSelector，先等待
    if (waitForSelector) {
      await session.page.waitForSelector(waitForSelector, { timeout });
    }

    const result = await session.page.evaluate(script);
    res.json(success({ result }));
  } catch (err) {
    res.status(500).json(error('Evaluate failed', err.message));
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
    const element = await session.page.$(selector);
    if (!element) {
      return res.status(404).json(error('Element not found'));
    }

    let value;
    switch (type) {
      case 'text':
        value = await element.evaluate(el => el.textContent);
        break;
      case 'html':
        value = await element.evaluate(el => el.innerHTML);
        break;
      case 'value':
        value = await element.evaluate(el => el.value);
        break;
      default:
        value = await element.evaluate(el => el.textContent);
    }

    res.json(success({ value, type }));
  } catch (err) {
    res.status(500).json(error('Extract failed', err.message));
  }
});

// ============================================
// 等待条件
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
      case 'function':
        await session.page.waitForFunction(value, { timeout });
        break;
      case 'navigation':
        await session.page.waitForNavigation({ waitUntil: value || 'networkidle2', timeout });
        break;
      case 'xpath':
        await session.page.waitForXPath(value, { timeout });
        break;
      default:
        throw new Error(`Unknown wait type: ${type}`);
    }
    res.json(success({ waited: type, value }));
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
    // 设置对话框处理器
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
║       Browser API Server (Puppeteer)         ║
╠══════════════════════════════════════════════╣
║  URL: http://localhost:${PORT}                  ║
║  Health: http://localhost:${PORT}/health        ║
╠══════════════════════════════════════════════╣
║  Chrome DevTools MCP 风格 API                ║
║                                              ║
║  Endpoints:                                  ║
║  POST   /session         - 创建会话         ║
║  DELETE /session/:id     - 关闭会话         ║
║  POST   /session/:id/navigate - 导航         ║
║  POST   /session/:id/click   - 点击         ║
║  POST   /session/:id/type    - 输入         ║
║  POST   /session/:id/evaluate - 执行JS       ║
║  POST   /session/:id/wait    - 等待         ║
║  GET    /session/:id/screenshot - 截图       ║
╚══════════════════════════════════════════════╝
  `);

  // 预热浏览器连接
  getBrowser().catch(console.error);
});

// 优雅关闭
process.on('SIGINT', async () => {
  console.log('\nShutting down...');
  for (const [id, session] of sessions) {
    try {
      await session.page.close();
    } catch (e) {}
  }
  if (browser) {
    await browser.close();
  }
  process.exit(0);
});
