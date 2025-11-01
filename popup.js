const DEFAULT_CONFIG = {
  apiBaseUrl: '',
  loginPath: '/auth/login',
  verifyPath: '/auth/verify',
  createTaskPath: '/collector/tasks',
  recentTasksPath: '/collector/tasks?mine=1&limit=5',
  debug: false
};

const authStatusEl = document.getElementById('authStatus');
const authMetaEl = document.getElementById('authMeta');
const bannerEl = document.getElementById('globalStatus');
const apiBaseDisplayEl = document.getElementById('apiBaseDisplay');
const taskPathDisplayEl = document.getElementById('taskPathDisplay');
const tasksListEl = document.getElementById('tasksList');
const tasksEmptyEl = document.getElementById('tasksEmpty');

const openOptionsButton = document.getElementById('openOptions');
const openBackendButton = document.getElementById('openBackendButton');
const loginTriggerButton = document.getElementById('loginTrigger');
const verifyButton = document.getElementById('verifyButton');
const logoutButton = document.getElementById('logoutButton');
const refreshTasksButton = document.getElementById('refreshTasksButton');

let backendConfig = { ...DEFAULT_CONFIG };
let authState = null;
let isAuthenticated = false;

initPopup();

async function initPopup() {
  await loadBackendConfig();
  bindEvents();
  await refreshAuthState();
  await loadRecentTasks();
}

function bindEvents() {
  openOptionsButton.addEventListener('click', () => {
    if (chrome.runtime.openOptionsPage) {
      chrome.runtime.openOptionsPage();
    } else {
      window.open(chrome.runtime.getURL('options.html'));
    }
  });

  openBackendButton.addEventListener('click', () => {
    if (!backendConfig.apiBaseUrl) {
      showBanner('请先在设置中配置后台 API 基址。', 'error');
      return;
    }
    const targetUrl = backendConfig.apiBaseUrl;
    chrome.tabs.create({ url: targetUrl });
  });

  loginTriggerButton.addEventListener('click', async () => {
    try {
      const response = await sendRuntimeMessage('collector/requestLogin');
      if (!response?.ok) {
        throw new Error(response?.error || '无法打开登录窗。');
      }
      const delivered = response.delivered;
      if (!delivered) {
        throw new Error('当前页面未响应登录指令，请确认已在目标站点。');
      }
      showBanner('已在当前页面打开登录窗，请在弹窗中完成登录。', 'info');
    } catch (error) {
      showBanner(error?.message || '无法打开登录窗。', 'error');
    }
  });

  verifyButton.addEventListener('click', async () => {
    setAuthLoading(true);
    try {
      const response = await sendRuntimeMessage('collector/verifyToken');
      if (!response?.ok) {
        throw new Error(response?.error || '校验失败。');
      }
      authState = response.authState || null;
      isAuthenticated = true;
      renderAuthState();
      showBanner('Token 校验成功。', 'success');
      await loadRecentTasks();
    } catch (error) {
      showBanner(error?.message || 'Token 校验失败。', 'error');
    } finally {
      setAuthLoading(false);
    }
  });

  logoutButton.addEventListener('click', async () => {
    setAuthLoading(true);
    try {
      await sendRuntimeMessage('collector/logout');
      authState = null;
      isAuthenticated = false;
      renderAuthState();
      showBanner('已退出登录。', 'info');
      await loadRecentTasks();
    } catch (error) {
      showBanner(error?.message || '退出登录失败。', 'error');
    } finally {
      setAuthLoading(false);
    }
  });

  refreshTasksButton.addEventListener('click', () => loadRecentTasks());
}

async function loadBackendConfig() {
  try {
    const items = await storageGet('sync', ['backendConfig']);
    backendConfig = {
      ...DEFAULT_CONFIG,
      ...(items?.backendConfig || {})
    };
  } catch (error) {
    backendConfig = { ...DEFAULT_CONFIG };
    showBanner('读取后台配置失败。', 'error');
  }
  renderConfig();
}

async function refreshAuthState() {
  setAuthLoading(true);
  try {
    const response = await sendRuntimeMessage('collector/getAuthState');
    if (!response?.ok) {
      authState = null;
      isAuthenticated = false;
      renderAuthState();
      return;
    }
    authState = response.authState || null;
    isAuthenticated = Boolean(response.isAuthenticated);
    renderAuthState();
  } catch (error) {
    authState = null;
    isAuthenticated = false;
    renderAuthState();
    showBanner(error?.message || '读取登录状态失败。', 'error');
  } finally {
    setAuthLoading(false);
  }
}

async function loadRecentTasks() {
  if (!backendConfig.apiBaseUrl) {
    tasksListEl.hidden = true;
    tasksEmptyEl.hidden = false;
    tasksEmptyEl.textContent = '请先配置后台 API 基址。';
    return;
  }
  tasksEmptyEl.textContent = '加载中…';
  tasksListEl.hidden = true;
  tasksEmptyEl.hidden = false;
  try {
    const response = await sendRuntimeMessage('collector/fetchRecentTasks');
    if (!response?.ok) {
      throw new Error(response?.error || '获取任务列表失败。');
    }
    const tasks = normalizeTasks(response.result);
    renderTasks(tasks);
  } catch (error) {
    tasksEmptyEl.textContent = error?.message || '无法获取任务列表。';
    tasksListEl.hidden = true;
    tasksEmptyEl.hidden = false;
  }
}

function renderConfig() {
  apiBaseDisplayEl.textContent = backendConfig.apiBaseUrl || '未配置';
  taskPathDisplayEl.textContent = backendConfig.createTaskPath || DEFAULT_CONFIG.createTaskPath;
}

function renderAuthState() {
  if (!isAuthenticated || !authState) {
    authStatusEl.textContent = '未登录';
    authMetaEl.textContent = '请切换到目标站点页面后点击“去登录”完成后台登录。';
    verifyButton.disabled = true;
    logoutButton.disabled = true;
    loginTriggerButton.hidden = false;
    return;
  }
  const userName =
    authState.user?.username ||
    authState.user?.name ||
    authState.user?.nick ||
    authState.user?.email ||
    '已登录';
  authStatusEl.textContent = userName;
  const expiresAt = authState.expiresAt ? new Date(authState.expiresAt) : null;
  const expireText = expiresAt ? `Token 将于 ${formatDateTime(expiresAt)} 过期。` : 'Token 未提供过期时间。';
  authMetaEl.textContent = expireText;
  verifyButton.disabled = false;
  logoutButton.disabled = false;
  loginTriggerButton.hidden = true;
}

function renderTasks(tasks) {
  if (!tasks || tasks.length === 0) {
    tasksListEl.hidden = true;
    tasksEmptyEl.hidden = false;
    tasksEmptyEl.textContent = '暂无记录。';
    return;
  }
  tasksListEl.innerHTML = '';
  for (const task of tasks.slice(0, 6)) {
    const li = document.createElement('li');
    li.className = 'task-row';
    const title = task.title || task.source_url || '未命名任务';
    const statusText = formatStatus(task.status || task.state);
    const siteText = formatSite(task.source_site || task.site || '');
    const created = formatDateTime(task.created_at || task.createdAt || task.create_time);
    const imageCount = Array.isArray(task.images) ? task.images.length : task.image_count || task.assets_count;
    li.innerHTML = `
      <span class="task-title">${title}</span>
      <span class="task-meta">${siteText} · ${statusText}${imageCount ? ` · ${imageCount} 图` : ''}</span>
      <span class="task-meta">${created}</span>
    `;
    tasksListEl.appendChild(li);
  }
  tasksListEl.hidden = false;
  tasksEmptyEl.hidden = true;
}

function formatStatus(status) {
  if (!status) {
    return '未知状态';
  }
  const map = {
    pending: '排队中',
    queued: '排队中',
    downloading: '下载中',
    processing: '处理中',
    success: '成功',
    done: '成功',
    failed: '失败',
    error: '失败'
  };
  const key = status.toString().toLowerCase();
  return map[key] || status;
}

function formatSite(site) {
  if (!site) {
    return '未知站点';
  }
  const map = {
    TEMU: 'Temu',
    TMALL: '天猫',
    TAOBAO: '淘宝',
    ALI1688: '1688'
  };
  const upper = site.toString().toUpperCase();
  return map[upper] || site;
}

function formatDateTime(value) {
  if (!value) {
    return '';
  }
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return `${date.getMonth() + 1}/${date.getDate()} ${padZero(date.getHours())}:${padZero(date.getMinutes())}`;
}

function padZero(value) {
  return value.toString().padStart(2, '0');
}

function normalizeTasks(result) {
  if (!result) {
    return [];
  }
  if (Array.isArray(result)) {
    return result;
  }
  if (Array.isArray(result.results)) {
    return result.results;
  }
  if (Array.isArray(result.data)) {
    return result.data;
  }
  if (Array.isArray(result.items)) {
    return result.items;
  }
  return [];
}

function showBanner(message, type) {
  if (!bannerEl) {
    return;
  }
  bannerEl.textContent = message;
  bannerEl.hidden = false;
  bannerEl.dataset.type = type || 'info';
  bannerEl.classList.toggle('error', type === 'error');
  bannerEl.classList.toggle('success', type === 'success');
  if (type !== 'error') {
    setTimeout(() => {
      bannerEl.hidden = true;
    }, 3800);
  }
}

function setAuthLoading(isLoading) {
  verifyButton.disabled = isLoading || !isAuthenticated;
  logoutButton.disabled = isLoading || !isAuthenticated;
  loginTriggerButton.disabled = isLoading;
}

async function sendRuntimeMessage(type, payload, options = {}) {
  const maxRetries =
    typeof options.retries === 'number' && options.retries >= 0 ? Math.floor(options.retries) : 1;
  const retryDelay =
    typeof options.retryDelay === 'number' && options.retryDelay >= 0
      ? options.retryDelay
      : 120;
  let attempt = 0;

  while (true) {
    try {
      return await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({ type, payload }, (response) => {
          const lastError = chrome.runtime.lastError;
          if (lastError) {
            reject(new Error(lastError.message));
            return;
          }
          resolve(response);
        });
      });
    } catch (error) {
      const message = error?.message || '';
      const retryable =
        attempt < maxRetries &&
        typeof message === 'string' &&
        message.includes('The message port closed before a response was received');
      if (!retryable) {
        throw error;
      }
      attempt += 1;
      await new Promise((resolve) => setTimeout(resolve, retryDelay));
    }
  }
}

function storageGet(area, keys) {
  return new Promise((resolve, reject) => {
    chrome.storage[area].get(keys, (items) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(items);
    });
  });
}
