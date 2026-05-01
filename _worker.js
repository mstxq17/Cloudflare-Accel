// 更新日期: 2025-08-25
// 更新内容: 
// 1. 无论是否重定向，只要目标是 AWS S3，就自动补全 x-amz-content-sha256 和 x-amz-date
// 2. 改进Docker镜像路径处理逻辑，支持多种格式: 如 hello-world | library/hello-world | docker.io/library/hello-world
// 3. 解决大陆拉取第三方 Docker 镜像层失败的问题，自动递归处理所有 302/307 跳转，无论跳转到哪个域名，都由 Worker 继续反代，避免客户端直接访问被墙 CDN，从而提升拉取成功率
// 4. 感谢老王，处理了暗黑模式下，输入框的颜色显示问题
// 5. 新增基于 Cloudflare KV 的后台管理页面，支持 GitHub/Docker 开关和 GitHub 前缀限制
// 用户配置区域开始 =================================
// 以下变量用于配置代理服务的白名单和安全设置，可根据需求修改。

// ALLOWED_HOSTS: 定义允许代理的域名列表（默认白名单）。
// - 添加新域名：将域名字符串加入数组，如 'docker.io'。
// - 注意：仅支持精确匹配的域名（如 'github.com'），不支持通配符。
// - 只有列出的域名会被处理，未列出的域名将返回 400 错误。
// 示例：const ALLOWED_HOSTS = ['github.com', 'docker.io'];
const ALLOWED_HOSTS = [
  'quay.io',
  'gcr.io',
  'k8s.gcr.io',
  'registry.k8s.io',
  'ghcr.io',
  'docker.cloudsmith.io',
  'registry-1.docker.io',
  'github.com',
  'api.github.com',
  'raw.githubusercontent.com',
  'gist.github.com',
  'gist.githubusercontent.com'
];

// RESTRICT_PATHS: 控制是否限制 GitHub 和 Docker 请求的路径。
// - 设置为 true：只允许 ALLOWED_PATHS 中定义的路径关键字。
// - 设置为 false：允许 ALLOWED_HOSTS 中的所有路径。
// 示例：const RESTRICT_PATHS = true;
const RESTRICT_PATHS = false;

// ALLOWED_PATHS: 定义 GitHub 和 Docker 的允许路径关键字。
// - 添加新关键字：加入数组，如 'user-id-3' 或 'my-repo'。
// - 用于匹配请求路径（如 'library' 用于 Docker Hub 官方镜像）。
// - 路径检查对大小写不敏感，仅当 RESTRICT_PATHS = true 时生效。
// 示例：const ALLOWED_PATHS = ['library', 'my-user', 'my-repo'];
const ALLOWED_PATHS = [
  'library',   // Docker Hub 官方镜像仓库的命名空间
  'user-id-1',
  'user-id-2',
];

// KV 后台配置：
// 1. 在 Cloudflare Workers/Pages 里绑定一个 KV Namespace，变量名可用 CONFIG_KV / CF_ACCEL_KV / ACCEL_KV / KV。
// 2. 设置环境变量 ADMIN 作为后台密码。
// 3. 访问 /login 登录，/admin 管理开关和 GitHub 允许前缀。
const SETTINGS_KV_KEY = 'cloudflare-accel:settings';
const SESSION_COOKIE_NAME = 'cf_accel_admin';
const SESSION_MAX_AGE = 7 * 24 * 60 * 60;
const DEFAULT_SETTINGS = {
  githubEnabled: true,
  dockerEnabled: true,
  githubPrefixLimitEnabled: true,
  githubAllowedPrefixes: ['https://github.com/mstxq17/']
};

const DOCKER_HOSTS = [
  'quay.io',
  'gcr.io',
  'k8s.gcr.io',
  'registry.k8s.io',
  'ghcr.io',
  'docker.cloudsmith.io',
  'registry-1.docker.io',
  'docker.io'
];

const GITHUB_HOSTS = [
  'github.com',
  'api.github.com',
  'raw.githubusercontent.com',
  'gist.github.com',
  'gist.githubusercontent.com'
];

// 用户配置区域结束 =================================

// 闪电 SVG 图标（Base64 编码）
const LIGHTNING_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#FBBF24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"></path>
</svg>`;

// 首页 HTML
const HOMEPAGE_HTML = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Cloudflare 加速</title>
  <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,${encodeURIComponent(LIGHTNING_SVG)}">
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    body {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: 'Inter', sans-serif;
      transition: background-color 0.3s, color 0.3s;
      padding: 1rem;
    }
    .light-mode {
      background: linear-gradient(to bottom right, #f1f5f9, #e2e8f0);
      color: #111827;
    }
    .dark-mode {
      background: linear-gradient(to bottom right, #1f2937, #374151);
      color: #e5e7eb;
    }
    .hero {
      text-align: center;
      margin-bottom: 1.5rem;
    }
    .hero-badge {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      padding: 0.25rem 0.75rem;
      border-radius: 999px;
      background: #dbeafe;
      color: #1d4ed8;
      font-size: 0.8rem;
      font-weight: 600;
      margin-bottom: 0.75rem;
    }
    .dark-mode .hero-badge {
      background: rgba(37, 99, 235, 0.25);
      color: #bfdbfe;
    }
    .container {
      width: 100%;
      max-width: 800px;
      padding: 1.5rem;
      border-radius: 0.75rem;
      border: 1px solid #e5e7eb;
      box-shadow: 0 8px 16px rgba(0, 0, 0, 0.1);
    }
    .light-mode .container {
      background: #ffffff;
    }
    .dark-mode .container {
      background: #1f2937;
    }
    .section-box {
      background: linear-gradient(to bottom, #ffffff, #f3f4f6);
      border-radius: 0.5rem;
      padding: 1.5rem;
      margin-bottom: 1.5rem;
      box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
    }
    .dark-mode .section-box {
      background: linear-gradient(to bottom, #374151, #1f2937);
      box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
    }
    .status-pill {
      display: inline-flex;
      align-items: center;
      padding: 0.25rem 0.55rem;
      border-radius: 999px;
      font-size: 0.75rem;
      font-weight: 600;
      margin-bottom: 0.75rem;
    }
    .status-ok {
      background: #dcfce7;
      color: #166534;
    }
    .status-warn {
      background: #fef3c7;
      color: #92400e;
    }
    .status-off {
      background: #fee2e2;
      color: #991b1b;
    }
    .dark-mode .status-ok {
      background: rgba(22, 101, 52, 0.35);
      color: #bbf7d0;
    }
    .dark-mode .status-warn {
      background: rgba(146, 64, 14, 0.35);
      color: #fde68a;
    }
    .dark-mode .status-off {
      background: rgba(153, 27, 27, 0.35);
      color: #fecaca;
    }
    .btn-disabled {
      opacity: 0.55;
      cursor: not-allowed;
    }
    .theme-toggle {
      position: fixed;
      top: 0.5rem;
      right: 0.5rem;
      padding: 0.5rem;
      font-size: 1.2rem;
    }
    .toast {
      position: fixed;
      bottom: 1rem;
      left: 50%;
      transform: translateX(-50%);
      background: #10b981;
      color: white;
      padding: 0.75rem 1.5rem;
      border-radius: 0.5rem;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
      opacity: 0;
      transition: opacity 0.3s;
      font-size: 0.9rem;
      max-width: 90%;
      text-align: center;
    }
    .toast.show {
      opacity: 1;
    }
    .result-text {
      word-break: break-all;
      overflow-wrap: break-word;
      font-size: 0.95rem;
      max-width: 100%;
      padding: 0.5rem;
      border-radius: 0.25rem;
      background: #f3f4f6;
    }
    .dark-mode .result-text {
      background: #2d3748;
    }

    input[type="text"] {
      background-color: white !important;
      color: #111827 !important;
    }
    .dark-mode input[type="text"] {
      background-color: #374151 !important;
      color: #e5e7eb !important;
    }

    @media (max-width: 640px) {
      .container {
        padding: 1rem;
      }
      .section-box {
        padding: 1rem;
        margin-bottom: 1rem;
      }
      h1 {
        font-size: 1.5rem;
        margin-bottom: 1.5rem;
      }
      h2 {
        font-size: 1.25rem;
        margin-bottom: 0.75rem;
      }
      p {
        font-size: 0.875rem;
      }
      input {
        font-size: 0.875rem;
        padding: 0.5rem;
        min-height: 44px;
      }
      button {
        font-size: 0.875rem;
        padding: 0.5rem 1rem;
        min-height: 44px;
      }
      .flex.gap-2 {
        flex-direction: column;
        gap: 0.5rem;
      }
      .github-buttons, .docker-buttons {
        flex-direction: column;
        gap: 0.5rem;
      }
      .result-text {
        font-size: 0.8rem;
        padding: 0.4rem;
      }
      footer {
        font-size: 0.75rem;
      }
    }
  </style>
</head>
<body class="light-mode">
  <button onclick="toggleTheme()" class="theme-toggle bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-full hover:bg-gray-300 dark:hover:bg-gray-600 transition">
    <span class="sun">☀️</span>
    <span class="moon hidden">🌙</span>
  </button>
  <div class="container mx-auto">
    <div class="hero">
      <div class="hero-badge">⚡ Cloudflare Worker Proxy</div>
      <h1 class="text-3xl font-bold mb-2">Cloudflare 加速下载</h1>
      <p class="text-gray-500 dark:text-gray-300">GitHub 文件与 Docker 镜像统一加速，后台 KV 动态控制访问策略。</p>
    </div>

    <!-- GitHub 链接转换 -->
    <div class="section-box">
      <h2 class="text-xl font-semibold mb-2">⚡ GitHub 文件加速</h2>
      <p class="text-gray-600 dark:text-gray-300 mb-4">输入 GitHub 文件链接，自动转换为加速链接。也可以直接在链接前加上本站域名使用。</p>
      <div class="flex gap-2 mb-2">
        <input
          id="github-url"
          type="text"
          placeholder="请输入 GitHub 文件链接，例如：https://github.com/user/repo/releases/..."
          class="flex-grow p-2 border border-gray-400 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500"
        >
        <button
          id="github-convert-button"
          onclick="convertGithubUrl()"
          class="bg-blue-500 text-white px-4 py-2 rounded-lg hover:bg-blue-600 transition"
        >
          获取加速链接
        </button>
      </div>
      <p id="github-result" class="mt-2 text-green-600 dark:text-green-400 result-text hidden"></p>
      <div id="github-buttons" class="flex gap-2 mt-2 github-buttons hidden">
        <button onclick="copyGithubUrl()" class="bg-gray-200 dark:bg-gray-600 text-gray-800 dark:text-gray-200 px-3 py-1 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-500 transition w-full">📋 复制链接</button>
        <button onclick="openGithubUrl()" class="bg-gray-200 dark:bg-gray-600 text-gray-800 dark:text-gray-200 px-3 py-1 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-500 transition w-full">🔗 打开链接</button>
      </div>
    </div>

    <!-- Docker 镜像加速 -->
    <div class="section-box">
      <h2 class="text-xl font-semibold mb-2">🐳 Docker 镜像加速</h2>
      <p class="text-gray-600 dark:text-gray-300 mb-4">输入原镜像地址（如 hello-world 或 ghcr.io/user/repo），获取加速拉取命令。</p>
      <div class="flex gap-2 mb-2">
        <input
          id="docker-image"
          type="text"
          placeholder="请输入镜像地址，例如：hello-world 或 ghcr.io/user/repo"
          class="flex-grow p-2 border border-gray-400 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500"
        >
        <button
          id="docker-convert-button"
          onclick="convertDockerImage()"
          class="bg-blue-500 text-white px-4 py-2 rounded-lg hover:bg-blue-600 transition"
        >
          获取加速命令
        </button>
      </div>
      <p id="docker-result" class="mt-2 text-green-600 dark:text-green-400 result-text hidden"></p>
      <div id="docker-buttons" class="flex gap-2 mt-2 docker-buttons hidden">
        <button onclick="copyDockerCommand()" class="bg-gray-200 dark:bg-gray-600 text-gray-800 dark:text-gray-200 px-3 py-1 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-500 transition w-full">📋 复制命令</button>
      </div>
    </div>

    <footer class="mt-6 text-center text-gray-500 dark:text-gray-400">
      Powered by <a href="https://github.com/mstxq17/Cloudflare-Accel" class="text-blue-500 hover:underline">modify</a> · <a href="/login" class="text-blue-500 hover:underline">后台管理</a>
    </footer>
  </div>

  <div id="toast" class="toast"></div>

  <script>
    // 动态获取当前域名
    const currentHost = window.location.host;
    const currentOrigin = window.location.origin;
    const githubHosts = ['github.com', 'api.github.com', 'raw.githubusercontent.com', 'gist.github.com', 'gist.githubusercontent.com'];
    const accelSettings = { githubEnabled: true, dockerEnabled: true, githubPrefixLimitEnabled: true, githubAllowedPrefixes: ['https://github.com/mstxq17/'] };

    // 主题切换
    function toggleTheme() {
      const body = document.body;
      const sun = document.querySelector('.sun');
      const moon = document.querySelector('.moon');
      if (body.classList.contains('light-mode')) {
        body.classList.remove('light-mode');
        body.classList.add('dark-mode');
        sun.classList.add('hidden');
        moon.classList.remove('hidden');
        localStorage.setItem('theme', 'dark');
      } else {
        body.classList.remove('dark-mode');
        body.classList.add('light-mode');
        moon.classList.add('hidden');
        sun.classList.remove('hidden');
        localStorage.setItem('theme', 'light');
      }
    }

    // 初始化主题
    if (localStorage.getItem('theme') === 'dark') {
      toggleTheme();
    }

    // 显示弹窗提示
    function showToast(message, isError = false) {
      const toast = document.getElementById('toast');
      toast.textContent = message;
      toast.classList.remove(isError ? 'bg-green-500' : 'bg-red-500');
      toast.classList.add(isError ? 'bg-red-500' : 'bg-green-500');
      toast.classList.add('show');
      setTimeout(() => {
        toast.classList.remove('show');
      }, 3000);
    }

    // 复制文本的通用函数
    function copyToClipboard(text) {
      // 尝试使用 navigator.clipboard API
      if (navigator.clipboard && window.isSecureContext) {
        return navigator.clipboard.writeText(text).catch(err => {
          console.error('Clipboard API failed:', err);
          return false;
        });
      }
      // 后备方案：使用 document.execCommand
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      try {
        const successful = document.execCommand('copy');
        document.body.removeChild(textarea);
        return successful ? Promise.resolve() : Promise.reject(new Error('Copy command failed'));
      } catch (err) {
        document.body.removeChild(textarea);
        return Promise.reject(err);
      }
    }

    // GitHub 链接转换
    let githubAcceleratedUrl = '';
    function normalizeGithubPrefix(prefix) {
      try {
        const url = new URL(String(prefix || '').trim());
        if (url.protocol !== 'https:' && url.protocol !== 'http:') {
          return '';
        }
        let pathname = url.pathname || '/';
        if (pathname !== '/' && !pathname.endsWith('/')) {
          pathname += '/';
        }
        return url.protocol + '//' + url.hostname + pathname;
      } catch (error) {
        return '';
      }
    }

    function isGithubInputAllowed(input) {
      if (!accelSettings.githubEnabled) {
        return { allowed: false, message: '后台已关闭 GitHub 加速' };
      }

      const normalizedInput = normalizeGithubPrefix(input);
      if (!normalizedInput) {
        return { allowed: false, message: '请输入有效的 GitHub 链接' };
      }

      const prefixes = accelSettings.githubPrefixLimitEnabled && Array.isArray(accelSettings.githubAllowedPrefixes)
        ? accelSettings.githubAllowedPrefixes.map(normalizeGithubPrefix).filter(Boolean)
        : [];

      if (prefixes.length && !prefixes.some(prefix => normalizedInput.startsWith(prefix))) {
        return {
          allowed: false,
          message: '该 GitHub 链接不在允许前缀内：' + prefixes.join('，')
        };
      }

      return { allowed: true };
    }

    function convertGithubUrl() {
      const input = document.getElementById('github-url').value.trim();
      const result = document.getElementById('github-result');
      const buttons = document.getElementById('github-buttons');
      if (!input) {
        showToast('请输入有效的 GitHub 链接', true);
        result.classList.add('hidden');
        buttons.classList.add('hidden');
        return;
      }
      if (!input.startsWith('https://')) {
        showToast('链接必须以 https:// 开头', true);
        result.classList.add('hidden');
        buttons.classList.add('hidden');
        return;
      }

      const allowResult = isGithubInputAllowed(input);
      if (!allowResult.allowed) {
        showToast(allowResult.message, true);
        result.classList.add('hidden');
        buttons.classList.add('hidden');
        return;
      }

      // 保持现有格式：域名/https://原始链接
      githubAcceleratedUrl = currentOrigin + '/https://' + input.substring(8);
      result.textContent = '加速链接: ' + githubAcceleratedUrl;
      result.classList.remove('hidden');
      buttons.classList.remove('hidden');
      copyToClipboard(githubAcceleratedUrl).then(() => {
        showToast('已复制到剪贴板');
      }).catch(err => {
        showToast('复制失败: ' + err.message, true);
      });
    }

    function copyGithubUrl() {
      copyToClipboard(githubAcceleratedUrl).then(() => {
        showToast('已手动复制到剪贴板');
      }).catch(err => {
        showToast('手动复制失败: ' + err.message, true);
      });
    }

    function openGithubUrl() {
      const input = document.getElementById('github-url').value.trim();
      const allowResult = isGithubInputAllowed(input);
      if (!allowResult.allowed) {
        showToast(allowResult.message, true);
        return;
      }
      window.open(githubAcceleratedUrl, '_blank');
    }

    // Docker 镜像转换
    let dockerCommand = '';
    function convertDockerImage() {
      const input = document.getElementById('docker-image').value.trim();
      const result = document.getElementById('docker-result');
      const buttons = document.getElementById('docker-buttons');
      if (!accelSettings.dockerEnabled) {
        showToast('后台已关闭 Docker 镜像加速', true);
        result.classList.add('hidden');
        buttons.classList.add('hidden');
        return;
      }
      if (!input) {
        showToast('请输入有效的镜像地址', true);
        result.classList.add('hidden');
        buttons.classList.add('hidden');
        return;
      }
      dockerCommand = 'docker pull ' + currentHost + '/' + input;
      result.textContent = '加速命令: ' + dockerCommand;
      result.classList.remove('hidden');
      buttons.classList.remove('hidden');
      copyToClipboard(dockerCommand).then(() => {
        showToast('已复制到剪贴板');
      }).catch(err => {
        showToast('复制失败: ' + err.message, true);
      });
    }

    function copyDockerCommand() {
      copyToClipboard(dockerCommand).then(() => {
        showToast('已手动复制到剪贴板');
      }).catch(err => {
        showToast('手动复制失败: ' + err.message, true);
      });
    }
  </script>
</body>
</html>
`;

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function htmlResponse(html, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set('Content-Type', 'text/html; charset=utf-8');
  return new Response(html, { ...init, headers });
}

function redirectResponse(location, headers = {}) {
  return new Response(null, {
    status: 302,
    headers: {
      Location: location,
      ...headers
    }
  });
}

function getConfigKV(env) {
  return env?.CONFIG_KV || env?.CF_ACCEL_KV || env?.ACCEL_KV || env?.KV || null;
}

function normalizeSettings(settings = {}) {
  const prefixes = Array.isArray(settings.githubAllowedPrefixes)
    ? settings.githubAllowedPrefixes
    : [];

  return {
    githubEnabled: settings.githubEnabled !== false,
    dockerEnabled: settings.dockerEnabled !== false,
    githubPrefixLimitEnabled: settings.githubPrefixLimitEnabled !== false,
    githubAllowedPrefixes: prefixes
      .map(prefix => normalizeGithubPrefix(prefix))
      .filter(Boolean)
  };
}

async function getSettings(env) {
  const kv = getConfigKV(env);
  if (!kv) {
    return { ...DEFAULT_SETTINGS };
  }

  try {
    const value = await kv.get(SETTINGS_KV_KEY, 'json');
    return normalizeSettings({ ...DEFAULT_SETTINGS, ...(value || {}) });
  } catch (error) {
    console.log(`Read settings from KV failed: ${error.message}`);
    return { ...DEFAULT_SETTINGS };
  }
}

async function saveSettings(env, settings) {
  const kv = getConfigKV(env);
  if (!kv) {
    throw new Error('未绑定 KV Namespace，请绑定 CONFIG_KV / CF_ACCEL_KV / ACCEL_KV / KV 之一');
  }
  await kv.put(SETTINGS_KV_KEY, JSON.stringify(normalizeSettings(settings), null, 2));
}

function normalizeGithubPrefix(prefix) {
  const raw = String(prefix || '').trim();
  if (!raw) {
    return '';
  }

  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol)) {
      return '';
    }
    if (!GITHUB_HOSTS.includes(url.hostname)) {
      return '';
    }

    let pathname = url.pathname || '/';
    if (pathname !== '/' && !pathname.endsWith('/')) {
      pathname += '/';
    }

    return `${url.protocol}//${url.hostname}${pathname}`;
  } catch {
    return '';
  }
}

function parseGithubPrefixes(value) {
  return String(value || '')
    .split(/[\n,]+/)
    .map(prefix => normalizeGithubPrefix(prefix))
    .filter(Boolean)
    .filter((prefix, index, all) => all.indexOf(prefix) === index);
}

function isGithubRequest(targetDomain, isDockerRequest) {
  return !isDockerRequest && GITHUB_HOSTS.includes(targetDomain);
}

function rewriteGithubBlobToRaw(targetUrl) {
  try {
    const url = new URL(targetUrl);
    if (url.hostname !== 'github.com') {
      return targetUrl;
    }

    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length < 5 || !['blob', 'raw'].includes(parts[2])) {
      return targetUrl;
    }

    const [owner, repo, , branch, ...fileParts] = parts;
    if (!owner || !repo || !branch || fileParts.length === 0) {
      return targetUrl;
    }

    const rawPath = [owner, repo, branch, ...fileParts].map(encodeURIComponent).join('/');
    return `https://raw.githubusercontent.com/${rawPath}${url.search}`;
  } catch {
    return targetUrl;
  }
}

function isAllowedGithubPrefix(targetUrl, prefixes) {
  if (!prefixes.length) {
    return true;
  }

  const normalizedTarget = normalizeGithubPrefix(targetUrl);
  return prefixes.some(prefix => normalizedTarget.startsWith(prefix));
}

function parseCookies(request) {
  const cookie = request.headers.get('Cookie') || '';
  return Object.fromEntries(
    cookie
      .split(';')
      .map(part => part.trim())
      .filter(Boolean)
      .map(part => {
        const index = part.indexOf('=');
        if (index === -1) {
          return [part, ''];
        }
        return [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
      })
  );
}

function base64UrlEncode(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = '';
  bytes.forEach(byte => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function constantTimeEqual(a, b) {
  if (a.length !== b.length) {
    return false;
  }
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

async function signSession(timestamp, adminPassword) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(adminPassword),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(String(timestamp)));
  return base64UrlEncode(signature);
}

async function createSessionToken(adminPassword) {
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = await signSession(timestamp, adminPassword);
  return `${timestamp}.${signature}`;
}

async function verifySession(request, env) {
  if (!env?.ADMIN) {
    return false;
  }

  const token = parseCookies(request)[SESSION_COOKIE_NAME];
  if (!token) {
    return false;
  }

  const [timestampRaw, signature] = token.split('.');
  const timestamp = Number(timestampRaw);
  if (!timestamp || !signature) {
    return false;
  }

  const now = Math.floor(Date.now() / 1000);
  if (timestamp > now + 60 || now - timestamp > SESSION_MAX_AGE) {
    return false;
  }

  const expected = await signSession(timestamp, env.ADMIN);
  return constantTimeEqual(signature, expected);
}

function renderLoginPage(message = '') {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>登录 - Cloudflare Accel</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="min-h-screen bg-slate-100 flex items-center justify-center p-4">
  <form method="POST" action="/login" class="w-full max-w-sm bg-white rounded-xl shadow p-6 space-y-4">
    <h1 class="text-2xl font-bold text-center">后台登录</h1>
    ${message ? `<div class="rounded bg-red-50 text-red-700 px-3 py-2 text-sm">${escapeHtml(message)}</div>` : ''}
    <label class="block">
      <span class="text-sm text-gray-700">后台密码（环境变量 ADMIN）</span>
      <input name="password" type="password" autofocus required class="mt-1 w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500">
    </label>
    <button class="w-full bg-blue-600 text-white rounded-lg py-2 hover:bg-blue-700">登录</button>
    <a href="/" class="block text-center text-sm text-gray-500 hover:underline">返回首页</a>
  </form>
</body>
</html>`;
}

function renderAdminPage(settings, options = {}) {
  const savedTip = options.saved ? '配置已保存' : '';
  const errorTip = options.error || '';
  const prefixes = settings.githubAllowedPrefixes.join('\n');
  const kvBound = options.kvBound;

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>后台管理 - Cloudflare Accel</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="min-h-screen bg-slate-100 p-4">
  <main class="max-w-3xl mx-auto bg-white rounded-xl shadow p-6 space-y-6">
    <div class="flex items-center justify-between gap-4">
      <h1 class="text-2xl font-bold">Cloudflare Accel 后台</h1>
      <div class="flex gap-3 text-sm">
        <a href="/" class="text-blue-600 hover:underline">首页</a>
        <a href="/logout" class="text-gray-600 hover:underline">退出</a>
      </div>
    </div>

    ${savedTip ? `<div class="rounded bg-green-50 text-green-700 px-3 py-2">${escapeHtml(savedTip)}</div>` : ''}
    ${errorTip ? `<div class="rounded bg-red-50 text-red-700 px-3 py-2">${escapeHtml(errorTip)}</div>` : ''}
    ${kvBound ? '' : '<div class="rounded bg-yellow-50 text-yellow-800 px-3 py-2">当前未检测到 KV 绑定，页面可查看默认配置，但保存会失败。请绑定 CONFIG_KV / CF_ACCEL_KV / ACCEL_KV / KV。</div>'}

    <form method="POST" action="/admin" class="space-y-6">
      <section class="border rounded-lg p-4 space-y-3">
        <h2 class="font-semibold text-lg">功能开关</h2>
        <label class="flex items-center gap-3">
          <input type="checkbox" name="githubEnabled" class="h-5 w-5" ${settings.githubEnabled ? 'checked' : ''}>
          <span>开启 GitHub 加速</span>
        </label>
        <label class="flex items-center gap-3">
          <input type="checkbox" name="dockerEnabled" class="h-5 w-5" ${settings.dockerEnabled ? 'checked' : ''}>
          <span>开启 Docker 镜像加速</span>
        </label>
        <label class="flex items-center gap-3">
          <input type="checkbox" name="githubPrefixLimitEnabled" class="h-5 w-5" ${settings.githubPrefixLimitEnabled ? 'checked' : ''}>
          <span>启用 GitHub 前缀限制</span>
        </label>
      </section>

      <section class="border rounded-lg p-4 space-y-3">
        <h2 class="font-semibold text-lg">GitHub 允许前缀</h2>
        <p class="text-sm text-gray-600">
          每行一个前缀；仅在“启用 GitHub 前缀限制”开启时生效。
          示例：<code class="bg-gray-100 px-1 rounded">https://github.com/mstxq17/</code>
        </p>
        <textarea
          name="githubAllowedPrefixes"
          rows="8"
          class="w-full border rounded-lg px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="https://github.com/mstxq17/">${escapeHtml(prefixes)}</textarea>
      </section>

      <button class="bg-blue-600 text-white rounded-lg px-5 py-2 hover:bg-blue-700">保存配置</button>
    </form>
  </main>
</body>
</html>`;
}

function renderHomePage(settings) {
  const githubStatus = !settings.githubEnabled
    ? '<div class="status-pill status-off">GitHub 已关闭</div>'
    : settings.githubPrefixLimitEnabled && settings.githubAllowedPrefixes.length
      ? `<div class="status-pill status-warn">仅允许：${settings.githubAllowedPrefixes.map(escapeHtml).join('，')}</div>`
      : '<div class="status-pill status-ok">GitHub 已开启</div>';
  const dockerStatus = !settings.dockerEnabled
    ? '<div class="status-pill status-off">Docker 已关闭</div>'
    : '<div class="status-pill status-ok">Docker 已开启</div>';

  return HOMEPAGE_HTML
    .replace(
      `const accelSettings = { githubEnabled: true, dockerEnabled: true, githubPrefixLimitEnabled: true, githubAllowedPrefixes: ['https://github.com/mstxq17/'] };`,
      `const accelSettings = ${JSON.stringify(settings)};`
    )
    .replace(
      '<p class="text-gray-600 dark:text-gray-300 mb-4">输入 GitHub 文件链接，自动转换为加速链接。也可以直接在链接前加上本站域名使用。</p>',
      `<p class="text-gray-600 dark:text-gray-300 mb-4">输入 GitHub 文件链接，自动转换为加速链接。也可以直接在链接前加上本站域名使用。</p>${githubStatus}`
    )
    .replace(
      '<p class="text-gray-600 dark:text-gray-300 mb-4">输入原镜像地址（如 hello-world 或 ghcr.io/user/repo），获取加速拉取命令。</p>',
      `<p class="text-gray-600 dark:text-gray-300 mb-4">输入原镜像地址（如 hello-world 或 ghcr.io/user/repo），获取加速拉取命令。</p>${dockerStatus}`
    );
}

async function handleAdminRoutes(request, env, path) {
  const url = new URL(request.url);
  const kvBound = Boolean(getConfigKV(env));

  if (path === '/login') {
    if (!env?.ADMIN) {
      return htmlResponse(renderLoginPage('未设置环境变量 ADMIN，后台登录不可用。'), { status: 500 });
    }

    if (request.method === 'GET') {
      if (await verifySession(request, env)) {
        return redirectResponse('/admin');
      }
      return htmlResponse(renderLoginPage());
    }

    if (request.method === 'POST') {
      const form = await request.formData();
      const password = String(form.get('password') || '');
      if (password !== env.ADMIN) {
        return htmlResponse(renderLoginPage('密码错误'), { status: 401 });
      }

      const token = await createSessionToken(env.ADMIN);
      return redirectResponse('/admin', {
        'Set-Cookie': `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_MAX_AGE}`
      });
    }

    return new Response('Method Not Allowed\n', { status: 405 });
  }

  if (path === '/logout') {
    return redirectResponse('/login', {
      'Set-Cookie': `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`
    });
  }

  if (path === '/admin') {
    if (!(await verifySession(request, env))) {
      return redirectResponse('/login');
    }

    const settings = await getSettings(env);

    if (request.method === 'GET') {
      return htmlResponse(renderAdminPage(settings, {
        saved: url.searchParams.get('saved') === '1',
        kvBound
      }));
    }

    if (request.method === 'POST') {
      const form = await request.formData();
      const nextSettings = normalizeSettings({
        githubEnabled: form.get('githubEnabled') === 'on',
        dockerEnabled: form.get('dockerEnabled') === 'on',
        githubPrefixLimitEnabled: form.get('githubPrefixLimitEnabled') === 'on',
        githubAllowedPrefixes: parseGithubPrefixes(form.get('githubAllowedPrefixes'))
      });

      try {
        await saveSettings(env, nextSettings);
        return redirectResponse('/admin?saved=1');
      } catch (error) {
        return htmlResponse(renderAdminPage(nextSettings, {
          error: error.message,
          kvBound
        }), { status: 500 });
      }
    }

    return new Response('Method Not Allowed\n', { status: 405 });
  }

  return null;
}

async function handleToken(realm, service, scope) {
  const tokenUrl = `${realm}?service=${service}&scope=${scope}`;
  console.log(`Fetching token from: ${tokenUrl}`);
  try {
    const tokenResponse = await fetch(tokenUrl, {
      method: 'GET',
      headers: { 'Accept': 'application/json' }
    });
    if (!tokenResponse.ok) {
      console.log(`Token request failed: ${tokenResponse.status} ${tokenResponse.statusText}`);
      return null;
    }
    const tokenData = await tokenResponse.json();
    const token = tokenData.token || tokenData.access_token;
    if (!token) {
      console.log('No token found in response');
      return null;
    }
    console.log('Token acquired successfully');
    return token;
  } catch (error) {
    console.log(`Error fetching token: ${error.message}`);
    return null;
  }
}

function isAmazonS3(url) {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return hostname === 'amazonaws.com' ||
      hostname.endsWith('.amazonaws.com') ||
      hostname.endsWith('.amazonaws.com.cn');
  } catch {
    return false;
  }
}

// 计算请求体的 SHA256 哈希值
async function calculateSHA256(message) {
  const encoder = new TextEncoder();
  const data = encoder.encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// 获取空请求体的 SHA256 哈希值
function getEmptyBodySHA256() {
  return 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
}

function getAmzDate() {
  return new Date().toISOString().replace(/[-:T]/g, '').slice(0, -5) + 'Z';
}

function methodCanHaveBody(method) {
  return !['GET', 'HEAD'].includes(method.toUpperCase());
}

async function getReusableRequestBody(request) {
  if (!methodCanHaveBody(request.method) || request.body === null) {
    return undefined;
  }
  return await request.clone().arrayBuffer();
}

function isRedirectStatus(status) {
  return [301, 302, 303, 307, 308].includes(status);
}

function sanitizeProxyHeaders(headers, targetUrl) {
  const nextHeaders = new Headers(headers);
  const targetHost = new URL(targetUrl).host;

  nextHeaders.set('Host', targetHost);

  // 这些头属于上一跳，转发到下一跳会干扰 S3/Registry 的签名或连接处理。
  [
    'Connection',
    'Keep-Alive',
    'Proxy-Authenticate',
    'Proxy-Authorization',
    'TE',
    'Trailer',
    'Transfer-Encoding',
    'Upgrade',
    'x-amz-content-sha256',
    'x-amz-date',
    'x-amz-security-token',
    'x-amz-user-agent'
  ].forEach(header => nextHeaders.delete(header));

  if (isAmazonS3(targetUrl)) {
    nextHeaders.set('x-amz-content-sha256', getEmptyBodySHA256());
    nextHeaders.set('x-amz-date', getAmzDate());
  }

  return nextHeaders;
}

async function fetchWithManualRedirects(initialUrl, init, maxRedirects) {
  let currentUrl = initialUrl;
  let currentMethod = init.method || 'GET';
  let currentBody = init.body;
  let currentHeaders = sanitizeProxyHeaders(init.headers || new Headers(), currentUrl);
  let currentHost = new URL(currentUrl).host;

  for (let redirectIndex = 0; redirectIndex <= maxRedirects; redirectIndex++) {
    const response = await fetch(currentUrl, {
      method: currentMethod,
      headers: currentHeaders,
      body: methodCanHaveBody(currentMethod) ? currentBody : undefined,
      redirect: 'manual'
    });
    console.log(`Fetch response: ${response.status} ${response.statusText} <- ${currentUrl}`);

    if (!isRedirectStatus(response.status)) {
      return response;
    }

    const location = response.headers.get('Location');
    if (!location) {
      console.log(`Redirect response ${response.status} without Location header`);
      return response;
    }

    if (redirectIndex === maxRedirects) {
      console.log(`Max redirects (${maxRedirects}) reached at: ${currentUrl}`);
      return new Response(`Error: Too many redirects while fetching ${initialUrl}\n`, { status: 508 });
    }

    const nextUrl = new URL(location, currentUrl).toString();
    const nextHost = new URL(nextUrl).host;
    const nextHeaders = sanitizeProxyHeaders(currentHeaders, nextUrl);

    // Registry 的 Bearer token 不应泄露给 S3/CDN；同域重定向则保留认证。
    if (nextHost !== currentHost) {
      nextHeaders.delete('Authorization');
    }

    // 与 fetch 自动重定向一致：303，以及 POST 的 301/302，切换为 GET。
    if (
      response.status === 303 ||
      ((response.status === 301 || response.status === 302) && !['GET', 'HEAD'].includes(currentMethod.toUpperCase()))
    ) {
      currentMethod = 'GET';
      currentBody = undefined;
      nextHeaders.delete('Content-Length');
      nextHeaders.delete('Content-Type');
    }

    console.log(`Following redirect: ${currentUrl} -> ${nextUrl}`);
    currentUrl = nextUrl;
    currentHost = nextHost;
    currentHeaders = nextHeaders;
  }
}

async function handleRequest(request, env) {
  const MAX_REDIRECTS = 8; // 最大重定向次数
  const url = new URL(request.url);
  let path = url.pathname;
  const settings = await getSettings(env);

  // 记录请求信息
  console.log(`Request: ${request.method} ${path}`);

  const adminResponse = await handleAdminRoutes(request, env, path);
  if (adminResponse) {
    return adminResponse;
  }

  // 首页路由
  if (path === '/' || path === '') {
    return new Response(renderHomePage(settings), {
      status: 200,
      headers: { 'Content-Type': 'text/html' }
    });
  }

  if (path === '/favicon.ico') {
    return new Response(LIGHTNING_SVG, {
      status: 200,
      headers: { 'Content-Type': 'image/svg+xml; charset=utf-8' }
    });
  }

  // Docker 客户端会先请求 /v2/ 探测 Registry API，必须返回 200，
  // 否则后续 manifest/blob 请求不会继续发起。
  if (path === '/v2' || path === '/v2/') {
    if (!settings.dockerEnabled) {
      return new Response('Error: Docker acceleration is disabled.\n', { status: 403 });
    }

    return new Response('{}', {
      status: 200,
      headers: { 'Docker-Distribution-API-Version': 'registry/2.0' }
    });
  }

  // 处理 Docker V2 API 或 GitHub 代理请求
  let isV2Request = false;
  let v2RequestType = null; // 'manifests' or 'blobs'
  let v2RequestTag = null;  // tag or digest
  if (path.startsWith('/v2/')) {
    isV2Request = true;
    path = path.replace('/v2/', '');

    // 解析 V2 API 请求类型和标签/摘要
    const pathSegments = path.split('/').filter(part => part);
    if (pathSegments.length >= 3) {
      // 格式如: nginx/manifests/latest 或 nginx/blobs/sha256:xxx
      v2RequestType = pathSegments[pathSegments.length - 2];
      v2RequestTag = pathSegments[pathSegments.length - 1];
      // 提取镜像名称部分（去掉 manifests/tag 或 blobs/digest 部分）
      path = pathSegments.slice(0, pathSegments.length - 2).join('/');
    }
  }

  // 提取目标域名和路径
  const pathParts = path.split('/').filter(part => part);
  if (pathParts.length < 1) {
    return new Response('Invalid request: target domain or path required\n', { status: 400 });
  }

  let targetDomain, targetPath, isDockerRequest = false;

  // 检查路径是否以 https:// 或 http:// 开头
  const fullPath = path.startsWith('/') ? path.substring(1) : path;

  if (fullPath.startsWith('https://') || fullPath.startsWith('http://')) {
    // 处理 /https://domain.com/... 或 /http://domain.com/... 格式
    const urlObj = new URL(fullPath);
    targetDomain = urlObj.hostname;
    targetPath = urlObj.pathname.substring(1) + urlObj.search; // 移除开头的斜杠

    // 检查是否为 Docker 请求
    isDockerRequest = DOCKER_HOSTS.includes(targetDomain);

    // 处理 docker.io 域名，转换为 registry-1.docker.io
    if (targetDomain === 'docker.io') {
      targetDomain = 'registry-1.docker.io';
    }
  } else {
    // 处理 Docker 镜像路径的多种格式
    if (pathParts[0] === 'docker.io') {
      // 处理 docker.io/library/nginx 或 docker.io/amilys/embyserver 格式
      isDockerRequest = true;
      targetDomain = 'registry-1.docker.io';

      if (pathParts.length === 2) {
        // 处理 docker.io/nginx 格式，添加 library 命名空间
        targetPath = `library/${pathParts[1]}`;
      } else {
        // 处理 docker.io/amilys/embyserver 或 docker.io/library/nginx 格式
        targetPath = pathParts.slice(1).join('/');
      }
    } else if (ALLOWED_HOSTS.includes(pathParts[0])) {
      // Docker 镜像仓库（如 ghcr.io）或 GitHub 域名（如 github.com）
      targetDomain = pathParts[0];
      targetPath = pathParts.slice(1).join('/') + url.search;
      isDockerRequest = DOCKER_HOSTS.includes(targetDomain);
    } else if (pathParts.length >= 1 && pathParts[0] === 'library') {
      // 处理 library/nginx 格式
      isDockerRequest = true;
      targetDomain = 'registry-1.docker.io';
      targetPath = pathParts.join('/');
    } else if (pathParts.length >= 2) {
      // 处理 amilys/embyserver 格式（带命名空间但不是 library）
      isDockerRequest = true;
      targetDomain = 'registry-1.docker.io';
      targetPath = pathParts.join('/');
    } else {
      // 处理单个镜像名称，如 nginx
      isDockerRequest = true;
      targetDomain = 'registry-1.docker.io';
      targetPath = `library/${pathParts.join('/')}`;
    }
  }

  // 默认白名单检查：只允许 ALLOWED_HOSTS 中的域名
  if (!ALLOWED_HOSTS.includes(targetDomain)) {
    console.log(`Blocked: Domain ${targetDomain} not in allowed list`);
    return new Response(`Error: Invalid target domain.\n`, { status: 400 });
  }

  if (isDockerRequest && !settings.dockerEnabled) {
    console.log('Blocked: Docker acceleration is disabled');
    return new Response('Error: Docker acceleration is disabled.\n', { status: 403 });
  }

  if (isGithubRequest(targetDomain, isDockerRequest) && !settings.githubEnabled) {
    console.log('Blocked: GitHub acceleration is disabled');
    return new Response('Error: GitHub acceleration is disabled.\n', { status: 403 });
  }

  // 路径白名单检查（仅当 RESTRICT_PATHS = true 时）
  if (RESTRICT_PATHS) {
    const checkPath = isDockerRequest ? targetPath : path;
    console.log(`Checking whitelist against path: ${checkPath}`);
    const isPathAllowed = ALLOWED_PATHS.some(pathString =>
      checkPath.toLowerCase().includes(pathString.toLowerCase())
    );
    if (!isPathAllowed) {
      console.log(`Blocked: Path ${checkPath} not in allowed paths`);
      return new Response(`Error: The path is not in the allowed paths.\n`, { status: 403 });
    }
  }

  // 构建目标 URL
  let targetUrl;
  if (isDockerRequest) {
    if (isV2Request && v2RequestType && v2RequestTag) {
      // 重构 V2 API URL
      targetUrl = `https://${targetDomain}/v2/${targetPath}/${v2RequestType}/${v2RequestTag}`;
    } else {
      targetUrl = `https://${targetDomain}/${isV2Request ? 'v2/' : ''}${targetPath}`;
    }
  } else {
    targetUrl = `https://${targetDomain}/${targetPath}`;
  }

  if (
    isGithubRequest(targetDomain, isDockerRequest) &&
    settings.githubPrefixLimitEnabled &&
    !isAllowedGithubPrefix(targetUrl, settings.githubAllowedPrefixes)
  ) {
    console.log(`Blocked: GitHub target ${targetUrl} does not match allowed prefixes`);
    return new Response('Error: GitHub target is not in the allowed prefixes.\n', { status: 403 });
  }

  if (isGithubRequest(targetDomain, isDockerRequest)) {
    const rewrittenTargetUrl = rewriteGithubBlobToRaw(targetUrl);
    if (rewrittenTargetUrl !== targetUrl) {
      console.log(`GitHub blob/raw URL rewritten: ${targetUrl} -> ${rewrittenTargetUrl}`);
      targetUrl = rewrittenTargetUrl;
    }
  }

  const requestBody = await getReusableRequestBody(request);
  const newRequestHeaders = sanitizeProxyHeaders(request.headers, targetUrl);

  try {
    // 尝试直接请求（使用 manual 重定向，并由 Worker 递归代为请求 S3/CDN）
    let response = await fetchWithManualRedirects(targetUrl, {
      method: request.method,
      headers: newRequestHeaders,
      body: requestBody
    }, MAX_REDIRECTS);
    console.log(`Initial response: ${response.status} ${response.statusText}`);

    // 处理 Docker 认证挑战
    if (isDockerRequest && response.status === 401) {
      const wwwAuth = response.headers.get('WWW-Authenticate');
      if (wwwAuth) {
        const authMatch = wwwAuth.match(/Bearer realm="([^"]+)",service="([^"]*)",scope="([^"]*)"/);
        if (authMatch) {
          const [, realm, service, scope] = authMatch;
          console.log(`Auth challenge: realm=${realm}, service=${service || targetDomain}, scope=${scope}`);

          const token = await handleToken(realm, service || targetDomain, scope);
          if (token) {
            const authHeaders = sanitizeProxyHeaders(request.headers, targetUrl);
            authHeaders.set('Authorization', `Bearer ${token}`);

            console.log('Retrying with token');
            response = await fetchWithManualRedirects(targetUrl, {
              method: request.method,
              headers: authHeaders,
              body: requestBody
            }, MAX_REDIRECTS);
            console.log(`Token response: ${response.status} ${response.statusText}`);
          } else {
            console.log('No token acquired, falling back to anonymous request');
            const anonHeaders = sanitizeProxyHeaders(request.headers, targetUrl);
            anonHeaders.delete('Authorization');

            response = await fetchWithManualRedirects(targetUrl, {
              method: request.method,
              headers: anonHeaders,
              body: requestBody
            }, MAX_REDIRECTS);
            console.log(`Anonymous response: ${response.status} ${response.statusText}`);
          }
        } else {
          console.log('Invalid WWW-Authenticate header');
        }
      } else {
        console.log('No WWW-Authenticate header in 401 response');
      }
    }

    // 复制响应并添加 CORS 头
    const newResponse = new Response(response.body, response);
    newResponse.headers.set('Access-Control-Allow-Origin', '*');
    newResponse.headers.set('Access-Control-Allow-Methods', 'GET, HEAD, POST, OPTIONS');
    if (isDockerRequest) {
      newResponse.headers.set('Docker-Distribution-API-Version', 'registry/2.0');
      // 删除可能存在的重定向头，确保所有请求都通过Worker处理
      newResponse.headers.delete('Location');
    }
    return newResponse;
  } catch (error) {
    console.log(`Fetch error: ${error.message}`);
    return new Response(`Error fetching from ${targetDomain}: ${error.message}\n`, { status: 500 });
  }
}

export default {
  async fetch(request, env, ctx) {
    return handleRequest(request, env);
  }
};
