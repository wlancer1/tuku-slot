const form = document.getElementById('configForm');
const apiBaseInput = document.getElementById('apiBaseInput');
const loginPagePathInput = document.getElementById('loginPagePathInput');
const loginPathInput = document.getElementById('loginPathInput');
const verifyPathInput = document.getElementById('verifyPathInput');
const createTaskPathInput = document.getElementById('createTaskPathInput');
const recentTasksPathInput = document.getElementById('recentTasksPathInput');
const collectLimitInput = document.getElementById('collectLimitInput');
const debugModeInput = document.getElementById('debugModeInput');
const statusEl = document.getElementById('status');

const DEFAULT_CONFIG = {
  apiBaseUrl: '',
  loginPagePath: '/#/login?opener=true',
  loginPath: '/auth/login',
  verifyPath: '/auth/verify',
  createTaskPath: '/collector/tasks',
  recentTasksPath: '/collector/tasks?mine=1&limit=5',
  collectLimit: 0,
  debug: false
};

init();

function init() {
  chrome.storage.sync.get(['backendConfig'], (items) => {
    if (chrome.runtime.lastError) {
      console.error('加载配置失败', chrome.runtime.lastError);
      statusEl.textContent = chrome.runtime.lastError.message;
      return;
    }
    const config = { ...DEFAULT_CONFIG, ...(items.backendConfig || {}) };
    apiBaseInput.value = config.apiBaseUrl;
    loginPagePathInput.value = config.loginPagePath;
    loginPathInput.value = config.loginPath;
    verifyPathInput.value = config.verifyPath;
    createTaskPathInput.value = config.createTaskPath;
    recentTasksPathInput.value = config.recentTasksPath;
    collectLimitInput.value = config.collectLimit || 0;
    debugModeInput.checked = Boolean(config.debug);
  });
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  statusEl.textContent = '';

  const apiBaseUrl = apiBaseInput.value.trim();
  if (!apiBaseUrl) {
    statusEl.textContent = '后台 API 基址不能为空。';
    return;
  }

  try {
    const url = new URL(apiBaseUrl);
    if (!url.protocol.startsWith('http')) {
      throw new Error('协议必须为 http 或 https');
    }
  } catch (error) {
    statusEl.textContent = '后台 API 基址格式不正确。';
    return;
  }

  const collectLimitRaw = collectLimitInput.value.trim();
  const collectLimit = collectLimitRaw === '' ? 0 : Math.max(0, Math.floor(Number(collectLimitRaw)));

  const configToSave = {
    apiBaseUrl: trimTrailingSlash(apiBaseUrl),
    loginPagePath: normalizeLoginPagePath(loginPagePathInput.value, DEFAULT_CONFIG.loginPagePath),
    loginPath: normalizePath(loginPathInput.value, DEFAULT_CONFIG.loginPath),
    verifyPath: normalizePath(verifyPathInput.value, DEFAULT_CONFIG.verifyPath),
    createTaskPath: normalizePath(createTaskPathInput.value, DEFAULT_CONFIG.createTaskPath),
    recentTasksPath: normalizePath(recentTasksPathInput.value, DEFAULT_CONFIG.recentTasksPath),
    collectLimit,
    debug: debugModeInput.checked
  };

  chrome.storage.sync.set(
    {
      backendConfig: configToSave
    },
    () => {
      if (chrome.runtime.lastError) {
        statusEl.textContent = chrome.runtime.lastError.message;
        return;
      }
      statusEl.textContent = '已保存！';
      setTimeout(() => {
        statusEl.textContent = '';
      }, 2000);
    }
  );
});

function normalizePath(input, fallback) {
  const trimmed = (input || '').trim();
  if (!trimmed) {
    return fallback;
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return trimTrailingSlash(trimmed);
  }
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

function trimTrailingSlash(text) {
  return text.replace(/\/+$/, '');
}

function normalizeLoginPagePath(input, fallback) {
  const trimmed = (input || '').trim();
  if (!trimmed) {
    return fallback;
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return trimTrailingSlash(trimmed);
  }
  if (trimmed.startsWith('#')) {
    return trimmed;
  }
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}
