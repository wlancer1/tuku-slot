const LOG_PREFIX = '[图酷通用采集器]';
const STORAGE_KEYS = {
  backendConfig: 'backendConfig',
  authState: 'authState',
  inlineSessions: 'inlineSessionsStore'
};

const DEFAULT_CONFIG = {
  apiBaseUrl: '',
  loginPagePath: '/#/login',
  loginPath: '/auth/login',
  verifyPath: '/auth/verify',
  createTaskPath: '/collector/tasks',
  recentTasksPath: '/collector/tasks?mine=1&limit=5',
  debug: false
};

const CONFIG_CACHE_TTL = 5000;

let cachedConfig = null;
let cachedConfigLoadedAt = 0;
const inlineSessions = new Map();
let inlineSessionsReady = loadPersistedInlineSessions();

chrome.runtime.onStartup.addListener(() => {
  inlineSessionsReady = loadPersistedInlineSessions();
});
chrome.runtime.onInstalled.addListener(() => {
  inlineSessionsReady = loadPersistedInlineSessions();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const { type, payload } = message || {};

  switch (type) {
    case 'collector/getAuthState':
      return handleAsync(sendResponse, async () => {
        const authState = await getAuthState();
        return { ok: true, authState, isAuthenticated: isTokenValid(authState) };
      });

    case 'collector/saveToken':
      return handleAsync(sendResponse, async () => {
        const tokenPayload = Object.keys(payload || {}).length ? payload : message;
        const authState = await saveTokenPayload(tokenPayload || {});
        await broadcastRefresh();
        return { ok: true, authState, isAuthenticated: isTokenValid(authState) };
      });
    case 'saveToken':
      return handleAsync(sendResponse, async () => {
        const tokenPayload = Object.keys(payload || {}).length ? payload : message;
        const authState = await saveTokenPayload(tokenPayload || {});
        await broadcastRefresh();
        return { ok: true, authState, isAuthenticated: isTokenValid(authState) };
      });

    case 'collector/logout':
      return handleAsync(sendResponse, async () => {
        await clearAuthState();
        await broadcastRefresh();
        return { ok: true };
      });

    case 'collector/verifyToken':
      return handleAsync(sendResponse, async () => {
        const result = await verifyToken();
        return { ok: true, ...result };
      });

    case 'collector/createTask':
      return handleAsync(sendResponse, async () => {
        const result = await createCollectorTask(payload || {});
        return { ok: true, result };
      });

    case 'collector/fetchRecentTasks':
      return handleAsync(sendResponse, async () => {
        const result = await fetchRecentTasks(payload || {});
        return { ok: true, result };
      });

    case 'fetchData':
      return handleAsync(sendResponse, async () => {
        const request = Object.keys(payload || {}).length ? payload : message;
        const { method = 'POST', url, data, headers } = request || {};
        if (!url) {
          throw new Error('缺少请求地址。');
        }
        const result = await sendAuthenticatedRequest({
          method,
          path: url,
          body: data,
          headers
        });
        return { ok: true, data: result };
      });

    case 'notify':
      return handleAsync(sendResponse, async () => {
        await createNotification(payload || message || {});
        return { ok: true };
      });

    case 'collector/requestLogin':
      return handleAsync(sendResponse, async () => {
        const result = await requestLoginPopup();
        return { ok: true, ...result };
      });

    case 'collector/getBackendConfig':
      return handleAsync(sendResponse, async () => {
        const config = await getBackendConfig();
        return { ok: true, config };
      });
    case 'collector/collectListDetails':
      return handleAsync(sendResponse, () => collectListDetails(payload || {}, sender));
    case 'collector/inlineStart':
      return handleAsync(sendResponse, () => startInlineSession(payload || {}, sender));
    case 'collector/inlineNext':
      return handleAsync(sendResponse, () => nextInlineItem(payload || {}, sender));
    case 'collector/inlineReportDetail':
      return handleAsync(sendResponse, () => reportInlineDetail(payload || {}, sender));
    case 'collector/inlineAbort':
      return handleAsync(sendResponse, () => abortInlineSession(payload || {}, sender));
    case 'collector/inlineGet':
      return handleAsync(sendResponse, () => getInlineSessionSummary(payload || {}, sender));

    default:
      return false;
  }
});

async function loadPersistedInlineSessions() {
  try {
    const data = await storageGet('local', [STORAGE_KEYS.inlineSessions]);
    const stored = data?.[STORAGE_KEYS.inlineSessions];
    if (!stored || typeof stored !== 'object') {
      return;
    }
    const entries = Object.entries(stored);
    for (const [sessionId, session] of entries) {
      if (!session || typeof session !== 'object') {
        continue;
      }
      inlineSessions.set(sessionId, session);
    }
  } catch (error) {
    console.warn(LOG_PREFIX, '恢复批量会话失败', error);
  }
}

function persistInlineSessions() {
  const plainObject = {};
  for (const [sessionId, session] of inlineSessions.entries()) {
    plainObject[sessionId] = session;
  }
  storageSet('local', { [STORAGE_KEYS.inlineSessions]: plainObject }).catch((error) => {
    console.warn(LOG_PREFIX, '保存批量会话失败', error);
  });
}

function handleAsync(sendResponse, promiseProducer) {
  let result;
  try {
    result = promiseProducer();
  } catch (error) {
    console.error(LOG_PREFIX, '消息处理失败', error);
    sendResponse({ ok: false, error: error?.message || String(error) });
    return true;
  }

  Promise.resolve(result)
    .then((value) => sendResponse(value))
    .catch((error) => {
      console.error(LOG_PREFIX, '消息处理失败', error);
      sendResponse({ ok: false, error: error?.message || String(error) });
    });
  return true;
}

async function getBackendConfig(options = {}) {
  const forceReload = Boolean(options.force);
  const now = Date.now();
  if (!forceReload && cachedConfig && now - cachedConfigLoadedAt < CONFIG_CACHE_TTL) {
    return cachedConfig;
  }

  const items = await storageGet('sync', [STORAGE_KEYS.backendConfig]);
  const stored = items?.[STORAGE_KEYS.backendConfig] || {};
  const config = {
    apiBaseUrl: stored.apiBaseUrl || DEFAULT_CONFIG.apiBaseUrl,
    loginPagePath: stored.loginPagePath || DEFAULT_CONFIG.loginPagePath,
    loginPath: stored.loginPath || DEFAULT_CONFIG.loginPath,
    verifyPath: stored.verifyPath || DEFAULT_CONFIG.verifyPath,
    createTaskPath: stored.createTaskPath || DEFAULT_CONFIG.createTaskPath,
    recentTasksPath: stored.recentTasksPath || DEFAULT_CONFIG.recentTasksPath,
    debug: Boolean(stored.debug)
  };

  cachedConfig = config;
  cachedConfigLoadedAt = now;
  return config;
}

async function ensureConfigured() {
  const config = await getBackendConfig();
  if (!config.apiBaseUrl) {
    throw new Error('请先在扩展设置页配置后台 API 基址。');
  }
  return config;
}

async function getAuthState() {
  const items = await storageGet('local', [STORAGE_KEYS.authState]);
  return items?.[STORAGE_KEYS.authState] || null;
}

async function saveTokenPayload(payload) {
  const token =
    payload?.token ||
    payload?.accessToken ||
    payload?.access_token ||
    payload?.data?.token ||
    payload?.data?.accessToken ||
    payload?.data?.access_token;
  if (!token || typeof token !== 'string') {
    throw new Error('登录返回的 Token 无效。');
  }

  const claims = decodeJwtClaims(token);
  const user = payload?.user || extractUserFromClaims(claims);
  const expiresAt = normalizeExpiry(claims?.exp);
  const authState = {
    accessToken: token,
    user: user || null,
    claims: claims || null,
    expiresAt,
    savedAt: Date.now(),
    lastVerifiedAt: null
  };

  await storageSet('local', { [STORAGE_KEYS.authState]: authState });
  logDebug(await getBackendConfig(), '保存登录 Token', { user: authState.user });
  return authState;
}

async function clearAuthState() {
  await storageRemove('local', [STORAGE_KEYS.authState]);
}

function isTokenValid(authState) {
  if (!authState || !authState.accessToken) {
    return false;
  }
  if (!authState.expiresAt) {
    return true;
  }
  return authState.expiresAt > Date.now() + 5000;
}

async function verifyToken() {
  const config = await ensureConfigured();
  if (!config.verifyPath) {
    return { skipped: true };
  }
  const authState = await getAuthState();
  if (!authState?.accessToken) {
    throw new Error('当前尚未登录。');
  }
  const data = await sendAuthenticatedRequest({
    method: 'GET',
    path: config.verifyPath
  });
  const updatedState = {
    ...authState,
    user: extractUserInfo(data) || authState.user,
    lastVerifiedAt: Date.now()
  };
  await storageSet('local', { [STORAGE_KEYS.authState]: updatedState });
  return { authState: updatedState, raw: data };
}

async function createCollectorTask(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('采集数据无效。');
  }
  const config = await ensureConfigured();
  const result = await sendAuthenticatedRequest({
    method: 'POST',
    path: config.createTaskPath,
    body: payload
  });
  return result;
}

async function fetchRecentTasks(options) {
  const config = await ensureConfigured();
  const pathOverride = options?.pathOverride;
  const result = await sendAuthenticatedRequest({
    method: 'GET',
    path: pathOverride || config.recentTasksPath
  });
  return result;
}

function requireTabId(sender) {
  const tabId = sender?.tab?.id;
  if (typeof tabId !== 'number') {
    throw new Error('无法识别标签页。');
  }
  return tabId;
}

function createInlineSessionId() {
  return `inline_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}

function getInlineSessionById(sessionId) {
  const session = inlineSessions.get(sessionId);
  if (!session) {
    throw new Error('批量采集会话不存在或已结束。');
  }
  return session;
}

function summarizeInlineSession(session) {
  return {
    id: session.id,
    total: session.total,
    currentIndex: session.currentIndex,
    status: session.status,
    results: session.results,
    failures: session.failures,
    listUrl: session.listUrl,
    site: session.site
  };
}

async function startInlineSession(payload, sender) {
  await inlineSessionsReady;
  const tabId = requireTabId(sender);
  const total = Number(payload.total) || 0;
  if (!total) {
    throw new Error('待处理的商品列表为空。');
  }
  const items = Array.isArray(payload.items) ? payload.items : [];
  for (const [id, session] of inlineSessions.entries()) {
    if (session.listTabId === tabId) {
      inlineSessions.delete(id);
    }
  }
  const sessionId = createInlineSessionId();
  const session = {
    id: sessionId,
    listTabId: tabId,
    site: payload.site || null,
    listUrl: payload.listUrl || sender?.tab?.url || '',
    total,
    items,
    currentIndex: -1,
    status: 'pending-list',
    results: [],
    failures: [],
    startedAt: Date.now(),
    lastActivity: Date.now()
  };
  inlineSessions.set(sessionId, session);
  persistInlineSessions();
  logDebug(null, '初始化批量采集会话', { sessionId, tabId, total });
  return { ok: true, sessionId, total };
}

async function nextInlineItem(payload, sender) {
  await inlineSessionsReady;
  const tabId = requireTabId(sender);
  const sessionId = payload?.sessionId;
  if (!sessionId) {
    throw new Error('缺少批量采集会话标识。');
  }
  const session = getInlineSessionById(sessionId);
  if (session.listTabId !== tabId) {
    throw new Error('仅批量采集列表页才可请求下一项。');
  }

  if (session.status === 'completed') {
    return { ok: true, done: true, summary: summarizeInlineSession(session) };
  }

  const nextIndex = session.currentIndex + 1;
  if (nextIndex >= session.total) {
    session.status = 'completed';
    session.lastActivity = Date.now();
    inlineSessions.set(sessionId, session);
    persistInlineSessions();
    return { ok: true, done: true, summary: summarizeInlineSession(session) };
  }

  session.currentIndex = nextIndex;
  session.status = 'navigating-detail';
  session.lastActivity = Date.now();
  inlineSessions.set(sessionId, session);
  persistInlineSessions();

  const item = session.items[nextIndex] || null;
  return {
    ok: true,
    sessionId,
    index: nextIndex,
    total: session.total,
    item
  };
}

async function reportInlineDetail(payload, sender) {
  await inlineSessionsReady;
  const sessionId = payload?.sessionId;
  if (!sessionId) {
    throw new Error('缺少批量采集会话标识。');
  }
  const session = getInlineSessionById(sessionId);
  const index = Number(payload?.index);
  if (!Number.isInteger(index) || index < 0 || index >= session.total) {
    throw new Error('详情上报索引无效。');
  }

  session.currentIndex = index;

  const detail = payload?.detail || null;
  const failure = payload?.failure || null;
  if (!detail && !failure) {
    throw new Error('详情上报缺少数据。');
  }

  if (detail) {
    session.results.push({ index, ...detail });
  }
  if (failure) {
    session.failures.push({ index, ...failure });
  }

  session.status = 'pending-list';
  session.lastActivity = Date.now();
  inlineSessions.set(sessionId, session);
  persistInlineSessions();

  persistInlineSessions();
  const processed = session.results.length + session.failures.length;
  const done = processed >= session.total;
  if (done) {
    session.status = 'completed';
    inlineSessions.set(sessionId, session);
  }

  try {
    chrome.tabs.sendMessage(session.listTabId, {
      type: 'collector/inlineItemResult',
      payload: {
        sessionId,
        index,
        detail,
        failure,
        done,
        total: session.total,
        summary: done ? summarizeInlineSession(session) : null
      }
    });
  } catch (error) {
    console.warn(LOG_PREFIX, '通知列表页批量结果失败', error);
  }

  return {
    ok: true,
    done,
    action: 'return',
    summary: done ? summarizeInlineSession(session) : null,
    listUrl: session.listUrl || null
  };
}

async function abortInlineSession(payload, sender) {
  await inlineSessionsReady;
  await inlineSessionsReady;
  const sessionId = payload?.sessionId;
  let targetId = sessionId;

  if (!targetId) {
    const tabId = sender?.tab?.id;
    if (typeof tabId === 'number') {
      for (const [id, session] of inlineSessions.entries()) {
        if (session.listTabId === tabId) {
          targetId = id;
          break;
        }
      }
    }
  }

  if (!targetId) {
    return { ok: true };
  }

  inlineSessions.delete(targetId);
  persistInlineSessions();
  logDebug(null, '结束批量采集会话', {
    sessionId: targetId,
    requester: sender?.tab?.id
  });
  return { ok: true };
}

async function getInlineSessionSummary(payload, sender) {
    await inlineSessionsReady;
  await inlineSessionsReady;
  const sessionId = payload?.sessionId;
  if (!sessionId) {
    throw new Error('缺少批量采集会话标识。');
  }
  const session = getInlineSessionById(sessionId);
  return { ok: true, session: summarizeInlineSession(session) };
}

async function collectListDetails(request, sender) {
  const urls = Array.isArray(request.urls) ? request.urls.filter(Boolean) : [];
  if (urls.length === 0) {
    throw new Error('未找到商品链接。');
  }
  const site = request.site || null;
  const requesterTabId = sender?.tab?.id || null;
  const windowId = sender?.tab?.windowId;
  await notifyBulkStatus(requesterTabId, {
    state: 'started',
    total: urls.length,
    site
  });
  let successCount = 0;

  for (let index = 0; index < urls.length; index += 1) {
    const url = urls[index];
    let detail = null;
    let error = null;
    try {
      detail = await openAndScrapeProduct(url, { site, windowId });
      if (detail) {
        successCount += 1;
        console.log(LOG_PREFIX, '批量采集成功', {
          site: detail.source_site || site,
          url,
          itemId: detail.itemId || detail.item_id || null,
          price: detail.price || null,
          images: Array.isArray(detail.images) ? detail.images.length : 0,
          detailImages: Array.isArray(detail.detailImages)
            ? detail.detailImages.length
            : Array.isArray(detail.detail_images)
            ? detail.detail_images.length
            : 0
        });
      }
    } catch (err) {
      error = err;
      console.warn(LOG_PREFIX, '批量采集失败', { url, error: err?.message || String(err) });
    }
    await notifyBulkItemResult(requesterTabId, {
      state: 'progress',
      index,
      total: urls.length,
      url,
      site,
      detail,
      error: error?.message || null
    });
  }

  await notifyBulkStatus(requesterTabId, {
    state: 'finished',
    total: urls.length,
    success: successCount,
    site
  });
  return { collected: successCount, total: urls.length };
}

async function requestLoginPopup() {
  const config = await getBackendConfig();
  const loginUrl = resolveLoginPageUrl(config);
  if (!loginUrl) {
    throw new Error('未配置登录页路径。');
  }

  const tabs = await queryActiveTabs();
  let lastError = null;
  for (const tab of tabs) {
    try {
      const response = await sendMessageToTab(tab.id, {
        type: 'collector/openLoginPopup',
        payload: { loginUrl }
      });
      if (response?.ok) {
        return { loginUrl, delivered: true };
      }
      if (response?.error) {
        lastError = new Error(response.error);
      }
    } catch (error) {
      lastError = error;
      continue;
    }
  }

  const reason =
    tabs.length === 0
      ? '当前没有可用页面，请先打开目标站点后再试。'
      : '当前页面未注入采集脚本，请切换到目标站点页面后再点击“去登录”。';
  const detail = lastError?.message ? `（${lastError.message}）` : '';
  throw new Error(`${reason}${detail}`);
}

async function sendAuthenticatedRequest({ method = 'GET', path, body, headers }) {
  const config = await ensureConfigured();
  const authState = await getAuthState();
  if (!authState?.accessToken) {
    throw new Error('请先登录后再执行该操作。');
  }

  const url = buildUrl(config.apiBaseUrl, path);
  const requestHeaders = new Headers(headers || {});
  requestHeaders.set('Authorization', `Bearer ${authState.accessToken}`);
  if (body !== undefined && body !== null && method.toUpperCase() !== 'GET' && !requestHeaders.has('Content-Type')) {
    requestHeaders.set('Content-Type', 'application/json');
  }

  const requestInit = {
    method,
    headers: requestHeaders
  };

  if (body !== undefined && body !== null && method.toUpperCase() !== 'GET') {
    requestInit.body = typeof body === 'string' ? body : JSON.stringify(body);
  }

  const response = await fetch(url, requestInit);
  const data = await parseResponse(response);

  logDebug(config, '调用后台接口', { url, method, status: response.status });

  if (response.status === 401) {
    await clearAuthState();
    throw new Error(data?.message || '登录状态已失效，请重新登录。');
  }

  if (!response.ok) {
    throw new Error(data?.message || `请求失败：HTTP ${response.status}`);
  }

  return data;
}

function resolveLoginPageUrl(config) {
  if (!config) {
    return null;
  }
  const loginPagePath = config.loginPagePath || DEFAULT_CONFIG.loginPagePath;
  if (/^https?:\/\//i.test(loginPagePath)) {
    return trimTrailingSlash(loginPagePath);
  }
  const baseUrl = config.apiBaseUrl;
  if (!baseUrl) {
    return null;
  }
  const base = safeUrl(baseUrl);
  if (!base) {
    return null;
  }
  if (loginPagePath.startsWith('#')) {
    return `${base.origin}/${loginPagePath}`;
  }
  if (loginPagePath.startsWith('/')) {
    return `${base.origin}${loginPagePath}`;
  }
  return `${base.origin}/${loginPagePath}`;
}

function normalizeExpiry(exp) {
  if (typeof exp !== 'number' || !Number.isFinite(exp)) {
    return null;
  }
  return exp > 1e12 ? exp : exp * 1000;
}

function decodeJwtClaims(token) {
  if (!token || typeof token !== 'string') {
    return null;
  }
  const segments = token.split('.');
  if (segments.length < 2) {
    return null;
  }
  try {
    const base64 = segments[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(base64.length + (4 - (base64.length % 4)) % 4, '=');
    const decoded = atob(padded);
    return JSON.parse(decoded);
  } catch (error) {
    console.warn(LOG_PREFIX, '解析 JWT 载荷失败', error);
    return null;
  }
}

function extractUserFromClaims(claims) {
  if (!claims || typeof claims !== 'object') {
    return null;
  }
  if (claims.user && typeof claims.user === 'object') {
    return claims.user;
  }
  const username = claims.username || claims.user_name || claims.account || claims.email || claims.phone;
  const name = claims.name || claims.nickname || claims.nick;
  if (!username && !name) {
    return null;
  }
  return {
    id: claims.user_id || claims.uid || claims.sub || null,
    username: username || null,
    name: name || null,
    email: claims.email || null,
    roles: claims.roles || claims.role || null
  };
}

function extractUserInfo(payload) {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  if (payload.user && typeof payload.user === 'object') {
    return payload.user;
  }
  if (payload.data?.user && typeof payload.data.user === 'object') {
    return payload.data.user;
  }
  if (payload.profile && typeof payload.profile === 'object') {
    return payload.profile;
  }
  return null;
}

function safeUrl(value) {
  if (!value) {
    return null;
  }
  try {
    return new URL(value);
  } catch (error) {
    return null;
  }
}

function buildUrl(base, path) {
  if (path && /^https?:\/\//i.test(path)) {
    return path;
  }
  if (!base) {
    throw new Error('请先配置后台 API 基址。');
  }
  const baseWithSlash = base.endsWith('/') ? base : `${base}/`;
  if (!path) {
    return trimTrailingSlash(baseWithSlash);
  }
  if (path.startsWith('?')) {
    return `${trimTrailingSlash(baseWithSlash)}${path}`;
  }
  const normalizedPath = path.startsWith('/') ? path.slice(1) : path;
  return new URL(normalizedPath, baseWithSlash).href;
}

async function queryActiveTabs() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => resolve(tabs || []));
  });
}

function sendMessageToTab(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(response);
    });
  });
}

async function openAndScrapeProduct(url, options = {}) {
  if (!url) {
    throw new Error('缺少商品链接。');
  }
  const createOptions = {
    url,
    active: false
  };
  if (options.windowId !== undefined) {
    createOptions.windowId = options.windowId;
  }

  const tab = await createTab(createOptions);
  let detail = null;
  try {
    await waitForTabComplete(tab.id);
    await delay(300);
    let response = null;
    let lastError = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        response = await sendMessageToTab(tab.id, {
          type: 'collector/scrapeProduct',
          payload: { site: options.site || null }
        });
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
        await delay(300);
      }
    }
    if (!response) {
      throw lastError || new Error('详情页采集失败。');
    }
    if (!response?.ok) {
      throw new Error(response?.error || '详情页采集失败。');
    }
    detail = response.data || {};
    if (!detail.source_url) {
      detail.source_url = url;
    }
    if (!detail.source_site && options.site) {
      detail.source_site = options.site;
    }
    return detail;
  } finally {
    await closeTabSafe(tab.id);
  }
}

function createTab(createProperties) {
  return new Promise((resolve, reject) => {
    chrome.tabs.create(createProperties, (tab) => {
      if (chrome.runtime.lastError || !tab) {
        reject(new Error(chrome.runtime.lastError?.message || '创建标签页失败。'));
        return;
      }
      resolve(tab);
    });
  });
}

function waitForTabComplete(tabId, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        cleanup();
        reject(new Error('加载详情页超时。'));
      }
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(handleUpdated);
      chrome.tabs.onRemoved.removeListener(handleRemoved);
    };

    const handleUpdated = (updatedTabId, changeInfo) => {
      if (updatedTabId !== tabId) {
        return;
      }
      if (changeInfo.status === 'complete') {
        if (!settled) {
          settled = true;
          cleanup();
          resolve();
        }
      }
    };

    const handleRemoved = (removedTabId) => {
      if (removedTabId !== tabId) {
        return;
      }
      if (!settled) {
        settled = true;
        cleanup();
        reject(new Error('详情标签页已被关闭。'));
      }
    };

    chrome.tabs.onUpdated.addListener(handleUpdated);
    chrome.tabs.onRemoved.addListener(handleRemoved);
  });
}

function closeTabSafe(tabId) {
  return new Promise((resolve) => {
    if (typeof tabId !== 'number') {
      resolve();
      return;
    }
    chrome.tabs.remove(tabId, () => resolve());
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function notifyBulkStatus(tabId, payload) {
  if (!tabId) {
    return;
  }
  try {
    await sendMessageToTab(tabId, {
      type: 'collector/bulkCollectionStatus',
      payload
    });
  } catch (error) {
    console.warn(LOG_PREFIX, '批量采集状态通知失败', error);
  }
}

async function notifyBulkItemResult(tabId, payload) {
  if (!tabId) {
    return;
  }
  try {
    await sendMessageToTab(tabId, {
      type: 'collector/bulkItemResult',
      payload
    });
  } catch (error) {
    console.warn(LOG_PREFIX, '批量采集结果通知失败', error);
  }
}

async function parseResponse(response) {
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    try {
      return await response.json();
    } catch (error) {
      console.warn(LOG_PREFIX, '解析 JSON 响应失败', error);
      return null;
    }
  }
  const text = await response.text();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    return { raw: text };
  }
}

function trimTrailingSlash(text) {
  return text.replace(/\/+$/, '');
}

function logDebug(config, message, meta) {
  if (!config?.debug) {
    return;
  }
  console.info(LOG_PREFIX, message, meta || {});
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

function storageSet(area, items) {
  return new Promise((resolve, reject) => {
    chrome.storage[area].set(items, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve();
    });
  });
}

function storageRemove(area, keys) {
  return new Promise((resolve, reject) => {
    chrome.storage[area].remove(keys, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve();
    });
  });
}

async function broadcastRefresh() {
  await broadcastToTabs({ type: 'collector/refreshPageContext' });
}

async function broadcastToTabs(message) {
  const tabs = await queryAllTabs();
  await Promise.all(
    tabs.map(
      (tab) =>
        new Promise((resolve) => {
          if (!tab.id) {
            resolve();
            return;
          }
          chrome.tabs.sendMessage(tab.id, message, () => {
            if (chrome.runtime.lastError) {
              resolve();
              return;
            }
            resolve();
          });
        })
    )
  );
}

function queryAllTabs() {
  return new Promise((resolve) => {
    chrome.tabs.query({}, (tabs) => resolve(tabs || []));
  });
}

function createNotification(options) {
  const title = options.title || '图酷通用采集器';
  const message = options.content || options.message || options.text || '';
  if (!message) {
    return Promise.resolve(false);
  }
  const iconUrl = options.iconUrl || chrome.runtime.getURL('icons/icon128.png');
  return new Promise((resolve) => {
    chrome.notifications.create(
      {
        type: 'basic',
        iconUrl,
        title,
        message
      },
      () => {
        resolve(true);
      }
    );
  });
}
