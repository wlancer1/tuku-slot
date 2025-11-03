const LOG_PREFIX = '[图酷通用采集器内容]';
// 调试开关：开启后在控制台输出天猫批量流程的关键节点
const DEBUG_TMALL_INLINE = true;
const STYLE_ID = 'gc-collector-style';
const BUTTON_ID = 'gc-collector-button';
const TOAST_ID = 'gc-collector-toast';
const BUTTON_POSITION_KEY_PREFIX = 'collectorFloatingButtonPosition:';

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

const BUTTON_LABELS = {
  disabled: '配置缺失',
  login: '请登录',
  ready: '采集到后台',
  loading: '解析中…',
  submitting: '提交中…',
  success: '已提交',
  error: '重试'
};

const DISABLED_STATES = new Set(['disabled', 'loading', 'submitting']);

const STATE = {
  initialized: false,
  site: null,
  pageType: 'unknown',
  config: { ...DEFAULT_CONFIG },
  authState: null,
  isAuthenticated: false,
  button: null,
  dragging: false,
  dragOffset: { x: 0, y: 0 },
  toastTimer: null,
  loginPopup: null,
  verifyingToken: false,
  isCollecting: false,
  currentUrl: location.href,
  loginUrl: null,
  loginOrigin: null,
  listGuardsInstalled: false,
  listGuardHandler: null,
  awaitingListResume: false,
  inlineResults: []
};

const {
  waitForBody,
  clamp,
  sendRuntimeMessage,
  storageGet,
  storageSet,
  ensureArray,
  absoluteUrl,
  parsePrice,
  detectCurrency,
  collectImageSources,
  collectVideoSources,
  dedupe,
  extractQueryParam,
  getTextContent,
  extractKeyValuePairs,
  normalizeImageUrl,
  pickFields,
  readJsonLdProduct,
  gatherWindowState,
  findProductCandidate,
  extractNumericId,
  parseSellerInfoFromJsonLd,
  createListItem,
  uniqueByUrl,
  copyToClipboard,
  safeUrl,
  trimTrailingSlash
} = window.COLLECTOR_UTILS || {};

if (!window.COLLECTOR_UTILS) {
  console.error(`${LOG_PREFIX} 工具模块未加载，功能可能无法正常工作。`);
}

const WINDOW_STATE_KEYS = [
  '__NUXT__',
  '__NUXT_DATA__',
  '__INITIAL_STATE__',
  '__LOAD_DATA__',
  '__PRELOADED_STATE__',
  '__TEMU_GLOBAL_STATE__',
  '__STORE__',
  '__APP_DATA__',
  'g_config',
  'g_page_config',
  'g_data',
  'g_shelfData',
  'g_sku'
];

const TMALL_LIST_CARD_SELECTORS = [
  '#J_ItemList .product',
  '#J_ItemList .item',
  '#J_ItemList .product-item',
  '.product-list .product',
  '[class*="product_shelf"] [class*="cardContainer"]',
  '[class*="productShelf"] [class*="cardContainer"]',
  '[class*="cardContainer--"]',
  '[data-spm-anchor-id*="product_shelf"] [class*="cardContainer"]'
];

const SITE_DEFINITIONS = [
  {
    id: 'TEMU',
    label: 'Temu',
    matchers: {
      product: [/^https:\/\/((www|m)\.)?temu\.com\/.*(goods|product)/i],
      list: [/^https:\/\/((www|m)\.)?temu\.com\/.*(list|catalog|search)/i],
      shop: [/^https:\/\/((www|m)\.)?temu\.com\/.*(shop|store)/i]
    },
    scrapers: {
      product: scrapeTemuProduct,
      list: scrapeTemuList,
      shop: scrapeTemuList
    }
  },
  {
    id: 'TMALL',
    label: '天猫',
    matchers: {
      product: [/^https:\/\/detail\.tmall\.com\//i],
      list: [/^https:\/\/.*\.tmall\.com\//i]
    },
    scrapers: {
      product: scrapeTmallProduct,
      list: scrapeTmallList
    }
  },
  {
    id: 'TAOBAO',
    label: '淘宝',
    matchers: {
      product: [/^https:\/\/item\.taobao\.com\//i],
      list: [/^https:\/\/.*\.taobao\.com\//i]
    },
    scrapers: {
      product: scrapeTaobaoProduct,
      list: scrapeTaobaoList
    }
  },
  {
    id: 'ALI1688',
    label: '1688',
    matchers: {
      product: [/^https:\/\/detail\.1688\.com\/offer\//i],
      list: [/^https:\/\/.*\.1688\.com\/(page|offer)/i]
    },
    scrapers: {
      product: scrapeAli1688Product,
      list: scrapeAli1688List
    }
  }
];

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== 'object') {
    return;
  }
  if (message.type === 'html') {
    try {
      const html = document.documentElement?.outerHTML || document.body?.outerHTML || '';
      sendResponse(html);
    } catch (error) {
      sendResponse('');
    }
    return;
  }
  if (message.type === 'clipboard') {
    const payload = message.payload || message;
    const text = payload?.text || payload?.value || '';
    copyToClipboard(text)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));
    return true;
  }
  if (message.type === 'notify') {
    const payload = message.payload || message;
    const content = payload?.content || payload?.message || payload?.text;
    const level = payload?.level || payload?.type || 'info';
    if (content) {
      showToast(content, level === 'error' ? 'error' : level === 'success' ? 'success' : 'info');
    }
    sendResponse({ ok: true });
    return;
  }
  if (message.type === 'collector/openLoginPopup' || message.type === 'collector/showLoginModal') {
    const result = openLoginPopup(message.payload || {});
    sendResponse(result);
    return;
  }
  if (message.type === 'getOpen') {
    const result = openLoginPopup(message.payload || {});
    sendResponse(result);
    return;
  }
  if (message.type === 'collector/scrapeProduct') {
    handleScrapeProductRequest(sendResponse);
    return true;
  }
  if (message.type === 'collector/bulkCollectionStatus') {
    handleBulkCollectionStatus(message.payload || message);
    sendResponse({ ok: true });
    return;
  }
  if (message.type === 'collector/bulkItemResult') {
    handleBulkItemResult(message.payload || message);
    sendResponse({ ok: true });
    return;
  }
  if (message.type === 'collector/inlineItemResult') {
    handleInlineItemResult(message.payload || message);
    sendResponse({ ok: true });
    return;
  }
  if (message.type === 'collector/refreshPageContext') {
    refreshPageContext()
      .then(() => sendResponse({ ok: true }))
      .catch((error) => {
        console.warn(LOG_PREFIX, '刷新页面上下文失败', error);
        sendResponse({ ok: false, error: error?.message || String(error) });
      });
    return true;
  }
});

window.addEventListener('message', handleLoginMessage);

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(initialize, 0);
  });
} else {
  initialize();
}

function initialize() {
  if (STATE.initialized) {
    refreshPageContext();
    return;
  }
  STATE.initialized = true;
  injectStyles();
  refreshPageContext();
  observeHistoryChanges();
}

async function refreshPageContext() {
  STATE.currentUrl = location.href;
  const detection = detectSite(location.href);
  if (!detection) {
    STATE.site = null;
    STATE.pageType = 'unknown';
    updateButtonVisibility();
    return;
  }

  const siteChanged = !STATE.site || STATE.site.id !== detection.site.id;
  STATE.site = detection.site;
  STATE.pageType = detection.pageType;

  await ensureButton();
  if (siteChanged) {
    await applyPositionForCurrentSite();
  }

  if (STATE.site?.id === 'TMALL' && STATE.pageType === 'list') {
    installListStateGuards();
  } else {
    removeListStateGuards();
  }

  await loadBackendConfig();
  await refreshAuthState({ skipVerify: false });
  updateButtonVisibility();
  await resumeTmallInlineAutomation();
}

function detectSite(url) {
  for (const site of SITE_DEFINITIONS) {
    const matchers = site.matchers || {};
    for (const [pageType, patterns] of Object.entries(matchers)) {
      if (patterns.some((pattern) => pattern.test(url))) {
        return { site, pageType };
      }
    }
  }
  return null;
}

async function ensureButton() {
  if (STATE.button) {
    return STATE.button;
  }
  await waitForBody();
  const button = document.createElement('button');
  button.id = BUTTON_ID;
  button.className = 'gc-floating-button gc-state-disabled';
  button.type = 'button';
  button.textContent = BUTTON_LABELS.disabled;
  button.dataset.state = 'disabled';
  button.addEventListener('click', handleButtonClick);
  makeButtonDraggable(button);
  document.body.appendChild(button);
  STATE.button = button;
  return button;
}

function setButtonState(state, textOverride) {
  if (!STATE.button) {
    return;
  }
  const classList = STATE.button.classList;
  classList.remove(
    'gc-state-disabled',
    'gc-state-login',
    'gc-state-ready',
    'gc-state-loading',
    'gc-state-submitting',
    'gc-state-success',
    'gc-state-error'
  );
  const className = `gc-state-${state}`;
  classList.add(className);
  STATE.button.dataset.state = state;
  STATE.button.disabled = DISABLED_STATES.has(state);
  const label = textOverride || BUTTON_LABELS[state] || BUTTON_LABELS.ready;
  STATE.button.textContent = label;
}

function updateButtonVisibility() {
  if (!STATE.button) {
    return;
  }
  if (!STATE.site) {
    STATE.button.style.display = 'none';
    return;
  }
  STATE.button.style.display = 'flex';
  if (!STATE.config?.apiBaseUrl) {
    setButtonState('disabled', '请先配置后台');
    STATE.button.title = '请在扩展设置页配置后台 API 基址';
    return;
  }
  if (!STATE.isAuthenticated) {
    setButtonState('login');
    STATE.button.title = '登录后即可采集当前页面';
    return;
  }
  const scraper = getScraper();
  if (!scraper) {
    setButtonState('disabled', '暂不支持');
    STATE.button.title = '当前页面未匹配到采集规则';
    return;
  }
  setButtonState('ready');
  STATE.button.title =
    STATE.pageType === 'product'
      ? '点击采集当前商品的主图、详情图与元数据'
      : '点击采集列表曝光的商品数据';
}

async function loadBackendConfig() {
  try {
    const items = await storageGet('sync', ['backendConfig']);
    const stored = items?.backendConfig || {};
    STATE.config = {
      ...DEFAULT_CONFIG,
      ...stored
    };
    STATE.config.collectLimit = Number(STATE.config.collectLimit) || 0;
    STATE.loginUrl = resolveLoginPageUrl(STATE.config);
    STATE.loginOrigin = determineLoginOrigin(STATE.loginUrl, STATE.config.apiBaseUrl);
  } catch (error) {
    console.warn(LOG_PREFIX, '加载后台配置失败', error);
    STATE.config = { ...DEFAULT_CONFIG };
    STATE.loginUrl = resolveLoginPageUrl(STATE.config);
    STATE.loginOrigin = determineLoginOrigin(STATE.loginUrl, STATE.config.apiBaseUrl);
  }
}

async function refreshAuthState(options = {}) {
  try {
    const response = await sendRuntimeMessage('collector/getAuthState');
    if (!response?.ok) {
      STATE.authState = null;
      STATE.isAuthenticated = false;
      updateButtonVisibility();
      return;
    }
    STATE.authState = response.authState || null;
    STATE.isAuthenticated = Boolean(response.isAuthenticated);
    updateButtonVisibility();
    if (
      STATE.isAuthenticated &&
      STATE.authState &&
      !STATE.authState.user &&
      !STATE.verifyingToken &&
      !options.skipVerify
    ) {
      verifyToken();
    }
  } catch (error) {
    console.warn(LOG_PREFIX, '获取登录状态失败', error);
    STATE.authState = null;
    STATE.isAuthenticated = false;
    updateButtonVisibility();
  }
}

async function verifyToken() {
  STATE.verifyingToken = true;
  try {
    const response = await sendRuntimeMessage('collector/verifyToken');
    if (response?.ok && response.authState) {
      STATE.authState = response.authState;
      STATE.isAuthenticated = true;
      updateButtonVisibility();
    }
  } catch (error) {
    console.warn(LOG_PREFIX, 'Token 验证失败', error);
  } finally {
    STATE.verifyingToken = false;
  }
}

function getScraper() {
  if (!STATE.site) {
    return null;
  }
  const scrapers = STATE.site.scrapers || {};
  return scrapers[STATE.pageType] || scrapers.product || null;
}

async function handleButtonClick() {
  if (!STATE.button) {
    return;
  }
  if (!STATE.config?.apiBaseUrl) {
    showToast('后台接口未配置，请在扩展设置中填写。', 'error');
    return;
  }
  if (!STATE.site) {
    showToast('当前页面不在支持站点内。', 'error');
    return;
  }
  if (!STATE.isAuthenticated) {
    const result = openLoginPopup();
    if (!result.ok) {
      if (result.error) {
        showToast(result.error, 'error');
      }
    } else {
      showToast('已打开后台登录窗口，请完成登录后重试。', 'info');
    }
    return;
  }
  const scraper = getScraper();
  if (!scraper) {
    showToast('当前页面暂未适配采集规则。', 'error');
    return;
  }
  if (STATE.isCollecting) {
    return;
  }

  STATE.isCollecting = true;
  setButtonState('loading');
    STATE.button.title = '正在解析页面内容';

  try {
    if (STATE.site.id === 'TMALL' && STATE.pageType === 'list') {
      await collectTmallListWithDetails(scraper);
      return;
    }
    const parsed = await scraper();
    const payload = buildTaskPayload(parsed);
    if (!payload) {
      throw new Error('未能解析出有效的页面内容。');
    }
    setButtonState('submitting');
    STATE.button.title = '正在提交后台任务';
    const response = await sendRuntimeMessage('collector/createTask', payload);
    if (!response?.ok) {
      throw new Error(response?.error || '采集任务提交失败，请稍后重试。');
    }
    setButtonState('success');
    STATE.button.title = '采集任务已提交';
    showToast('已提交后台，稍后可在采集列表查看任务进度。', 'success');
    setTimeout(() => {
      setButtonState('ready');
      STATE.button.title = '点击采集当前页面';
    }, 4000);
  } catch (error) {
    console.error(LOG_PREFIX, '采集失败', error);
    setButtonState('error');
    STATE.button.title = '采集失败，点击重试';
    showToast(error?.message || '采集失败，请稍后重试。', 'error');
  } finally {
    if (!INLINE.sessionId) {
      STATE.isCollecting = false;
    }
  }
}

function assignIfPresent(target, key, value) {
  if (value === undefined || value === null) {
    return;
  }
  target[key] = value;
}

function sanitizeArray(value) {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const cleaned = value.map((item) => {
    if (typeof item === 'string') {
      return item.trim();
    }
    return item;
  });
  const filtered = cleaned.filter((item) => item !== undefined && item !== null && item !== '');
  return filtered.length ? filtered : undefined;
}


function showToast(message, type = 'info') {
  let toast = document.getElementById(TOAST_ID);
  if (!toast) {
    toast = document.createElement('div');
    toast.id = TOAST_ID;
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.dataset.type = type;
  toast.classList.add('visible');
  if (STATE.toastTimer) {
    clearTimeout(STATE.toastTimer);
  }
  STATE.toastTimer = setTimeout(() => {
    toast.classList.remove('visible');
  }, 3200);
}

function openLoginPopup(options = {}) {
  const providedUrl = options.loginUrl;
  const loginUrl = providedUrl || STATE.loginUrl || resolveLoginPageUrl(STATE.config);
  if (!loginUrl) {
    return { ok: false, error: '未配置登录地址，请联系管理员。' };
  }
  STATE.loginUrl = loginUrl;
  STATE.loginOrigin = determineLoginOrigin(loginUrl, STATE.config?.apiBaseUrl);

  if (STATE.loginPopup && !STATE.loginPopup.closed) {
    STATE.loginPopup.focus();
    return { ok: true, reopened: true };
  }

  const width = options.width || 520;
  const height = options.height || 640;
  const dualScreenLeft = window.screenLeft !== undefined ? window.screenLeft : window.screenX || 0;
  const dualScreenTop = window.screenTop !== undefined ? window.screenTop : window.screenY || 0;
  const left = dualScreenLeft + Math.max(0, (window.innerWidth - width) / 2);
  const top = dualScreenTop + Math.max(0, (window.innerHeight - height) / 2);
  const features = [
    `width=${Math.round(width)}`,
    `height=${Math.round(height)}`,
    `top=${Math.max(0, Math.round(top))}`,
    `left=${Math.max(0, Math.round(left))}`,
    'resizable=yes',
    'scrollbars=yes'
  ].join(',');

  const popup = window.open(loginUrl, 'CollectorLogin', features);
  if (!popup) {
    return { ok: false, error: '浏览器阻止了登录弹窗，请允许弹窗后重试。' };
  }
  STATE.loginPopup = popup;
  const checker = setInterval(() => {
    if (!STATE.loginPopup || STATE.loginPopup.closed) {
      clearInterval(checker);
      STATE.loginPopup = null;
    }
  }, 1000);
  return { ok: true };
}

function handleLoginMessage(event) {

  if (!event) {
    return;
  }
  const expectedOrigin = STATE.loginOrigin;
  if (!expectedOrigin) {
    return;
  }
  if (event.origin !== expectedOrigin) {
    return;
  }
  const data = event.data || {};
  const token = data.token || data.accessToken;
  if (!token) {
    return;
  }
  if (STATE.loginPopup && event.source && event.source !== STATE.loginPopup) {
    return;
  }
  const payload = {
    token,
    user: data.user || data.profile || null
  };
  sendRuntimeMessage('collector/saveToken', payload)
    .then((response) => {
      if (!response?.ok) {
        throw new Error(response?.error || '保存登录状态失败');
      }
      showToast('登录成功，可以开始采集。', 'success');
      refreshAuthState({ skipVerify: true });
    })
    .catch((error) => {
      console.warn(LOG_PREFIX, '保存登录状态失败', error);
      showToast(error?.message || '登录状态写入失败，请重试。', 'error');
    });

  if (STATE.loginPopup && !STATE.loginPopup.closed) {
    STATE.loginPopup.close();
  }
  STATE.loginPopup = null;
}

function handleScrapeProductRequest(sendResponse) {
  (async () => {
    try {
      if (!STATE.site) {
        await refreshPageContext();
      }
      const scraper = getScraper();
      if (!scraper) {
        throw new Error('当前页面未适配采集规则。');
      }
      if (STATE.pageType !== 'product') {
        throw new Error('当前页面不是商品详情页。');
      }
      const data = await scraper();
      sendResponse({ ok: true, data });
    } catch (error) {
      sendResponse({ ok: false, error: error?.message || String(error) });
    }
  })();
}

function handleBulkCollectionStatus(status) {
  if (!status || !STATE.button) {
    return;
  }
  const total = typeof status.total === 'number' ? status.total : null;
  if (status.state === 'started') {
    setButtonState('submitting');
    if (total) {
      STATE.button.title = `正在批量采集 ${total} 个商品`;
    } else {
      STATE.button.title = '正在批量采集商品';
    }
    const message = total
      ? `开始批量采集 ${total} 个商品，详情数据将输出到控制台。`
      : '开始批量采集商品，详情数据将输出到控制台。';
    showToast(message, 'info');
    return;
  }
  if (status.state === 'finished') {
    const successCount =
      typeof status.success === 'number'
        ? status.success
        : total !== null
        ? total
        : 0;
    const message =
      total !== null
        ? `批量采集完成，成功 ${successCount}/${total} 个。`
        : '批量采集完成。';
    const success = successCount > 0;
    setButtonState(success ? 'success' : 'error');
    STATE.button.title = message;
    showToast(message, success ? 'success' : 'error');
    setTimeout(() => {
      if (!STATE.button) {
        return;
      }
      const nextState = STATE.isAuthenticated ? 'ready' : 'login';
      setButtonState(nextState);
      STATE.button.title =
        nextState === 'ready'
          ? '点击采集当前页面'
          : '登录后即可采集当前页面';
    }, 4000);
  }
}

function handleBulkItemResult(payload) {
  if (!payload) {
    return;
  }
  const index =
    typeof payload.index === 'number' ? payload.index + 1 : payload.index;
  const total = payload.total;
  if (payload.detail) {
    const detail = payload.detail;
    const logData = {
      index,
      total,
      url: payload.url || detail.source_url || location.href,
      title: detail.title || '',
      itemId: detail.itemId || detail.item_id || null,
      price: detail.price || null,
      currency: detail.currency || null,
      images: detail.images || [],
      detailImages: detail.detailImages || detail.detail_images || [],
      source: detail.source_site || payload.site || STATE.site?.id || ''
    };
    console.log(
      `${LOG_PREFIX} 批量采集成功 [${index || '?'} / ${total || '?'}]`,
      logData
    );
  } else {
    console.warn(
      `${LOG_PREFIX} 批量采集失败 [${index || '?'} / ${total || '?'}]`,
      {
        url: payload.url,
        error: payload.error || '未知错误'
      }
    );
  }
}

const INLINE = {
  sessionId: null,
  activeIndex: -1,
  requesting: false,
  total: 0
};

const INLINE_CONTEXT_READY = restoreInlineContext();
const LIST_STATE_STORAGE_KEY = 'tmallListState';
const LIST_STATE_SESSION_KEY = 'tmallListStateSession';
const INLINE_RESULTS_STORAGE_PREFIX = 'tmallInlineResults:';

function getInlineResultsStorageKey(sessionId) {
  return `${INLINE_RESULTS_STORAGE_PREFIX}${sessionId}`;
}

async function loadInlineResultsFromStorage(sessionId) {
  if (!sessionId) {
    return [];
  }
  const key = getInlineResultsStorageKey(sessionId);
  try {
    const stored = await storageGet('local', [key]);
    const results = stored?.[key];
    return Array.isArray(results) ? results : [];
  } catch (error) {
    console.warn(`${LOG_PREFIX} 读取批量结果缓存失败`, error);
    return [];
  }
}

function persistInlineResultsToStorage(sessionId, results) {
  if (!sessionId) {
    return;
  }
  const key = getInlineResultsStorageKey(sessionId);
  const payload = Array.isArray(results) ? results : [];
  storageSet('local', { [key]: payload }).catch((error) => {
    console.warn(`${LOG_PREFIX} 保存批量结果缓存失败`, error);
  });
}

async function collectTmallListWithDetails(scraper) {
  await INLINE_CONTEXT_READY;
  try {
    if (INLINE.sessionId) {
      await inlineAbort();
    }

    if (STATE.pageType !== 'list') {
      throw new Error('请在商品列表页启动批量采集。');
    }

    const cards = getTmallListCardElements();
    if (!cards.length) {
      throw new Error('当前列表未找到可自动点击的商品卡片。');
    }

    await new Promise((resolve) => {
      chrome.storage.local.remove([LIST_STATE_STORAGE_KEY], resolve);
    });

    STATE.inlineResults = [];
    const parsed = (await scraper()) || {};
    const parsedItems = Array.isArray(parsed.items) ? parsed.items.filter(Boolean) : [];
    const configuredLimitRaw = Number(STATE.config?.collectLimit);
    const normalizedLimit = Number.isFinite(configuredLimitRaw) ? Math.max(0, Math.floor(configuredLimitRaw)) : 0;
    const total = normalizedLimit > 0 ? Math.min(cards.length, normalizedLimit) : cards.length;
    await waitForTmallCard(total);
    if (DEBUG_TMALL_INLINE) {
      console.debug(`${LOG_PREFIX} 启动批量`, { total, normalizedLimit, cardCount: cards.length });
    }
    const sessionItems = Array.from({ length: total }, (_, index) => {
      const existing = parsedItems[index];
      if (existing && existing.source_url) {
        return existing;
      }

      const card = cards[index];
      if (!card) {
        return existing || {};
      }

      const anchor =
        card.querySelector('a[href*="tmall.com/item.htm"], a[href*="detail.tmall.com"], a[href*="item.htm"]') ||
        card.closest('a[href*="tmall.com/item.htm"], a[href*="detail.tmall.com"], a[href*="item.htm"]');
      const rawHref = anchor?.getAttribute('href') || anchor?.href || null;
      const itemId =
        extractQueryParam(rawHref, 'id') ||
        anchor?.getAttribute('data-itemid') ||
        anchor?.dataset?.itemid ||
        extractNumericId(rawHref);
      const fallbackUrl = itemId
        ? `https://detail.tmall.com/item.htm?id=${String(itemId).trim()}`
        : absoluteUrl(rawHref);

      const imageEl =
        card.querySelector('img[data-src]') ||
        card.querySelector('img[data-lazy-load]') ||
        card.querySelector('img[data-original]') ||
        card.querySelector('img[src]');
      const rawImage =
        imageEl?.getAttribute('data-src') ||
        imageEl?.getAttribute('data-lazy-load') ||
        imageEl?.getAttribute('data-original') ||
        imageEl?.getAttribute('src');

      const title =
        getTextContent('.productTitle, .product-title, .title', card) ||
        getTextContent('[class*="title--"]', card) ||
        getTextContent('[class*="title"]', card) ||
        anchor?.getAttribute('title') ||
        anchor?.textContent?.trim() ||
        '';

      const priceText =
        getTextContent(
          '.productPrice, .product-price, .c-price, .s-price, [class*="price--"], [class*="text-price"], [class*="price"]',
          card
        ) || getTextContent('[class*="price"]', card);

      const fallbackItem = createListItem({
        title,
        url: fallbackUrl,
        image: normalizeImageUrl(rawImage, 'TMALL'),
        priceText,
        currencyFallback: 'CNY'
      });

      if (fallbackItem) {
        return fallbackItem;
      }
      if (fallbackUrl) {
        return { source_url: fallbackUrl };
      }
      return existing || {};
    });

    const startResp = await sendRuntimeMessage('collector/inlineStart', {
      total,
      items: sessionItems,
      site: STATE.site?.id || null,
      listUrl: location.href
    });
    if (!startResp?.ok) {
      throw new Error(startResp?.error || '初始化批量任务失败。');
    }

    INLINE.sessionId = startResp.sessionId;
    INLINE.total = startResp.total || total;
    INLINE.activeIndex = -1;
    INLINE.requesting = false;
    STATE.isCollecting = true;
    persistInlineResultsToStorage(INLINE.sessionId, []);
    await storeInlineContext(INLINE.sessionId, -1);
    await inlineRequestNext();
  } catch (error) {
    console.error(LOG_PREFIX, '批量采集失败', error);
    STATE.inlineResults = [];
    await inlineAbort();
    setButtonState('error');
    if (STATE.button) {
      STATE.button.title = '批量采集失败，点击重试';
    }
    showToast(error?.message || '批量采集失败，请稍后重试。', 'error');
  }
}

async function restoreInlineContext() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['inlineSessionId', 'inlineActiveIndex', 'inlineTotal'], (items) => {
      INLINE.sessionId = items.inlineSessionId || null;
      INLINE.activeIndex =
        typeof items.inlineActiveIndex === 'number' ? items.inlineActiveIndex : -1;
      INLINE.total = typeof items.inlineTotal === 'number' ? items.inlineTotal : 0;
      resolve();
    });
  });
}

function storeInlineContext(sessionId, index, total) {
  return new Promise((resolve) => {
    chrome.storage.local.set(
      {
        inlineSessionId: sessionId || null,
        inlineActiveIndex: typeof index === 'number' ? index : -1,
        inlineTotal: typeof total === 'number' ? total : INLINE.total
      },
      resolve
    );
  });
}

async function captureListState(metadata = {}) {
  if (STATE.site?.id !== 'TMALL' || STATE.pageType !== 'list') {
    return;
  }
  const mergedMeta = {
    ...metadata,
    awaitingResume: STATE.awaitingListResume
  };
  STATE.inlineResults = Array.isArray(STATE.inlineResults) ? STATE.inlineResults : [];
  const scrollTop =
    window.pageYOffset ||
    document.documentElement.scrollTop ||
    document.body.scrollTop ||
    0;
  const filters = extractFilterState();
  const payload = {
    sessionId: INLINE.sessionId || null,
    listUrl: location.href,
    scrollTop,
    filters,
    metadata: mergedMeta,
    timestamp: Date.now()
  };
  try {
    sessionStorage.setItem(LIST_STATE_SESSION_KEY, JSON.stringify(payload));
  } catch (error) {
    // sessionStorage might be unavailable; ignore.
  }
  await new Promise((resolve) => {
    chrome.storage.local.set({ [LIST_STATE_STORAGE_KEY]: payload }, resolve);
  });
}

async function restoreListState() {
  return new Promise((resolve) => {
    let state = null;
    try {
      const fromSession = sessionStorage.getItem(LIST_STATE_SESSION_KEY);
      if (fromSession) {
        state = JSON.parse(fromSession);
      }
    } catch (error) {
      // Ignore JSON parse errors.
    }
    const handleState = () => {
      if (!state || typeof state !== 'object') {
        chrome.storage.local.get([LIST_STATE_STORAGE_KEY], (items) => {
          state = items?.[LIST_STATE_STORAGE_KEY];
          applyState(state, resolve);
        });
      } else {
        applyState(state, resolve);
      }
    };
    const applyState = (found, done) => {
      if (!found || typeof found !== 'object') {
        cleanupStoredListState(() => done(false));
        return;
      }
      const matchesUrl = found.listUrl && sameListUrl(found.listUrl, location.href);
      if (!matchesUrl) {
        cleanupStoredListState(() => done(false));
        return;
      }
      STATE.awaitingListResume = Boolean(found.metadata?.awaitingResume);
      applyFilterState(found.filters || []);
      requestAnimationFrame(() => {
        window.scrollTo(0, Number(found.scrollTop) || 0);
        cleanupStoredListState(() => done(true));
      });
    };

    handleState();
  });
}

function cleanupStoredListState(callback) {
  try {
    sessionStorage.removeItem(LIST_STATE_SESSION_KEY);
  } catch (error) {
    // ignore
  }
  chrome.storage.local.remove([LIST_STATE_STORAGE_KEY], callback);
}

function extractFilterState() {
  const filters = [];
  const containerSelectors = [
    '#J_Nav',
    '#J_Filter',
    '#J_SearchForm',
    '.tm-facet',
    '.tm-nav'
  ];
  const seen = new Set();
  for (const selector of containerSelectors) {
    const container = document.querySelector(selector);
    if (!container) {
      continue;
    }
    const elements = container.querySelectorAll('input[name], select[name], textarea[name]');
    elements.forEach((element) => {
      const snapshot = snapshotControl(element);
      if (!snapshot) {
        return;
      }
      const key = `${snapshot.tagName}:${snapshot.name || snapshot.id}`;
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      filters.push(snapshot);
    });
  }
  return filters;
}

function installListStateGuards() {
  if (STATE.listGuardsInstalled) {
    return;
  }
  const handler = (event) => {
    if (!INLINE.sessionId) {
      return;
    }
    captureListState({ reason: event.type }).catch(() => {});
  };
  window.addEventListener('pagehide', handler);
  window.addEventListener('beforeunload', handler);
  STATE.listGuardsInstalled = true;
  STATE.listGuardHandler = handler;
}

function removeListStateGuards() {
  if (!STATE.listGuardsInstalled || !STATE.listGuardHandler) {
    return;
  }
  window.removeEventListener('pagehide', STATE.listGuardHandler);
  window.removeEventListener('beforeunload', STATE.listGuardHandler);
  STATE.listGuardsInstalled = false;
  STATE.listGuardHandler = null;
}

function snapshotControl(element) {
  if (!(element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement)) {
    return null;
  }
  const tagName = element.tagName;
  const type = element.type;
  if (!element.name && !element.id) {
    return null;
  }
  if (type === 'password' || type === 'file') {
    return null;
  }
  const snapshot = {
    tagName,
    type,
    name: element.name || null,
    id: element.id || null
  };
  if (element instanceof HTMLInputElement) {
    if (type === 'checkbox' || type === 'radio') {
      snapshot.checked = element.checked;
    } else {
      snapshot.value = element.value;
    }
  } else if (element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement) {
    snapshot.value = element.value;
  }
  return snapshot;
}

function applyFilterState(filters) {
  if (!Array.isArray(filters) || !filters.length) {
    return;
  }
  for (const snapshot of filters) {
    const element = findControlBySnapshot(snapshot);
    if (!element) {
      continue;
    }
    try {
      if (snapshot.type === 'checkbox' || snapshot.type === 'radio') {
        if (typeof snapshot.checked === 'boolean' && element.checked !== snapshot.checked) {
          element.checked = snapshot.checked;
          dispatchInputEvents(element);
        }
      } else if ('value' in snapshot && element.value !== snapshot.value) {
        element.value = snapshot.value;
        dispatchInputEvents(element);
      }
    } catch (error) {
      // Ignore mismatches.
    }
  }
}

function findControlBySnapshot(snapshot) {
  if (!snapshot) {
    return null;
  }
  const { id, name } = snapshot;
  if (id) {
    const byId = document.getElementById(id);
    if (byId) {
      return byId;
    }
  }
  if (name) {
    const selector = `[name="${cssEscape(name)}"]`;
    return document.querySelector(selector);
  }
  return null;
}

function dispatchInputEvents(element) {
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
}

function waitForTmallCard(index, timeout = 9000) {
  // 等待列表渲染出指定数量的商品卡片（最多等待 timeout 毫秒）
  return new Promise((resolve) => {
    const start = Date.now();
    const check = () => {
      const cards = getTmallListCardElements();
      if (!Number.isFinite(index) || index <= 0 || cards.length >= index) {
        resolve();
        return;
      }
      if (Date.now() - start >= timeout) {
        resolve();
        return;
      }
      requestAnimationFrame(check);
    };
    check();
  });
}

function sameListUrl(savedUrl, currentUrl) {
  try {
    const saved = new URL(savedUrl, location.origin);
    const current = new URL(currentUrl, location.origin);
    return saved.origin === current.origin && saved.pathname === current.pathname;
  } catch (error) {
    return savedUrl.split('#')[0] === currentUrl.split('#')[0];
  }
}

function cssEscape(value) {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value);
  }
  return String(value)
    .replace(/[\0-\x1F\x7F]|^-?\d|^-/g, '\\$&')
    .replace(/[\s!"#$%&'()*+,./:;<=>?@[\]^`{|}~]/g, '\\$&');
}

async function inlineAbort() {
  const sessionId = INLINE.sessionId;
  if (sessionId) {
    try {
      await sendRuntimeMessage('collector/inlineAbort', { sessionId });
    } catch (error) {
      console.warn(LOG_PREFIX, '清理批量会话失败', error);
    }
  }
  const inlineResultsKey = sessionId ? getInlineResultsStorageKey(sessionId) : null;
  INLINE.sessionId = null;
  INLINE.activeIndex = -1;
  INLINE.requesting = false;
  INLINE.total = 0;
  STATE.isCollecting = false;
  STATE.inlineResults = [];
  await new Promise((resolve) => {
    const keys = ['inlineSessionId', 'inlineActiveIndex', 'inlineTotal', LIST_STATE_STORAGE_KEY];
    if (inlineResultsKey) {
      keys.push(inlineResultsKey);
    }
    chrome.storage.local.remove(keys, () => {
      cleanupStoredListState(() => {
        STATE.awaitingListResume = false;
        resolve();
      });
    });
  });
}

async function inlineGetSummary() {
  if (!INLINE.sessionId) {
    return null;
  }
  const response = await sendRuntimeMessage('collector/inlineGet', {
    sessionId: INLINE.sessionId
  });
  if (!response?.ok) {
    throw new Error(response?.error || '读取批量状态失败。');
  }
  return response.session || null;
}

async function inlineRequestNext() {
  await INLINE_CONTEXT_READY;
  
  // 防重复调用: 无会话、正在请求、或等待恢复时跳过
  if (!INLINE.sessionId || INLINE.requesting || STATE.awaitingListResume) {
    if (DEBUG_TMALL_INLINE) {
      console.debug(`${LOG_PREFIX} inlineRequestNext 跳过`, {
        hasSession: !!INLINE.sessionId,
        requesting: INLINE.requesting,
        awaitingResume: STATE.awaitingListResume
      });
    }
    return;
  }
  
  INLINE.requesting = true;
  
  try {
    const response = await sendRuntimeMessage('collector/inlineNext', {
      sessionId: INLINE.sessionId
    });
    
    if (!response?.ok) {
      throw new Error(response?.error || '推进批量任务失败');
    }
    
    if (response.done) {
      await finalizeInlineSession(response.summary || (await inlineGetSummary()));
      return;
    }

    if (DEBUG_TMALL_INLINE) {
      console.debug(`${LOG_PREFIX} inlineNext response`, {
        index: response.index,
        total: response.total,
        hasItem: !!response.item
      });
    }
    
    INLINE.activeIndex = response.index;
    INLINE.total = response.total || INLINE.total;
    await storeInlineContext(INLINE.sessionId, INLINE.activeIndex, INLINE.total);

    if (STATE.button) {
      STATE.button.title = `正在采集第 ${response.index + 1}/${INLINE.total} 个商品`;
    }

    const onTmallListPage = STATE.site?.id === 'TMALL' && STATE.pageType === 'list';
    
    // 不在列表页时设置等待标记并返回
    if (!onTmallListPage) {
      if (DEBUG_TMALL_INLINE) {
        console.debug(`${LOG_PREFIX} 等待返回列表`, {
          index: response.index,
          pageType: STATE.pageType,
          url: location.href
        });
      }
      STATE.awaitingListResume = true;
      return;
    }

    // 在列表页执行点击前设置等待标记
    STATE.awaitingListResume = true;
    await captureListState({ 
      index: response.index, 
      total: INLINE.total, 
      awaitingResume: true 
    });

    // 等待卡片渲染
    await waitForTmallCard(response.index + 1, 6000);
    
    const targetItem = response.item || {};
    
    if (DEBUG_TMALL_INLINE) {
      const cards = getTmallListCardElements();
      console.debug(`${LOG_PREFIX} 尝试点击列表卡片`, {
        index: response.index,
        totalCards: cards.length,
        targetUrl: targetItem?.source_url || targetItem?.url
      });
    }

    // 尝试点击卡片
    if (simulateCardClick(response.index)) {
      if (DEBUG_TMALL_INLINE) {
        console.debug(`${LOG_PREFIX} 成功点击卡片`, { index: response.index });
      }
      return;
    }

    // 点击失败,尝试备用 URL
    const targetUrl = targetItem.source_url || targetItem.url || targetItem.link;
    if (targetUrl) {
      if (DEBUG_TMALL_INLINE) {
        console.debug(`${LOG_PREFIX} fallback 使用链接`, { index: response.index, targetUrl });
      }
      location.assign(targetUrl);
      return;
    }
    
    // 无备用 URL,报告失败并继续下一个
    if (DEBUG_TMALL_INLINE) {
      console.debug(`${LOG_PREFIX} 卡片缺失,跳过`, { index: response.index });
    }
    
    STATE.awaitingListResume = false;
    await captureListState({ 
      reason: 'card-missing', 
      index: response.index, 
      awaitingResume: false 
    });
    
    await sendRuntimeMessage('collector/inlineReportDetail', {
      sessionId: INLINE.sessionId,
      index: response.index,
      failure: {
        reason: 'card-missing',
        message: '未匹配到商品卡片'
      }
    });
    
    INLINE.activeIndex = -1;
    await storeInlineContext(INLINE.sessionId, -1, INLINE.total);
    
    // 延迟后继续下一个
    setTimeout(() => {
      inlineRequestNext();
    }, 500);
    
  } catch (error) {
    console.error(LOG_PREFIX, '批量采集推进失败', error);
    await inlineAbort();
    showToast(error?.message || '批量采集失败,请稍后重试', 'error');
  } finally {
    INLINE.requesting = false;
  }
}

function handleInlineItemResult(payload) {
  if (!payload || payload.sessionId !== INLINE.sessionId) {
    if (DEBUG_TMALL_INLINE) {
      console.warn(`${LOG_PREFIX} 收到无效结果`, {
        hasPayload: !!payload,
        sessionMatch: payload?.sessionId === INLINE.sessionId
      });
    }
    return;
  }
  
  if (DEBUG_TMALL_INLINE) {
    console.debug(`${LOG_PREFIX} handleInlineItemResult`, {
      index: payload.index,
      hasDetail: !!payload.detail,
      hasFailure: !!payload.failure,
      done: payload.done,
      currentPageType: STATE.pageType,
      awaitingResume: STATE.awaitingListResume
    });
  }
  
  STATE.inlineResults = Array.isArray(STATE.inlineResults) ? STATE.inlineResults : [];
  
  INLINE.activeIndex = -1;
  storeInlineContext(INLINE.sessionId, -1, INLINE.total);

  if (payload.detail) {
    STATE.inlineResults.push({
      index: payload.index,
      total: INLINE.total,
      detail: payload.detail
    });
    persistInlineResultsToStorage(INLINE.sessionId, STATE.inlineResults);
    console.log(
      `${LOG_PREFIX} 批量采集成功 [${payload.index + 1}/${INLINE.total}]`,
      payload.detail
    );
  }
  
  if (payload.failure) {
    console.warn(
      `${LOG_PREFIX} 批量采集失败 [${payload.index + 1}/${INLINE.total}]`,
      payload.failure
    );
  }
  if (payload.done) {
    if (STATE.pageType === 'list') {
      finalizeInlineSession(payload.summary || null);
    } else {
      if (DEBUG_TMALL_INLINE) {
        console.debug(`${LOG_PREFIX} 详情页收到最终结果,等待返回列表再收尾`, {
          pageType: STATE.pageType
        });
      }
      // 等待 resumeTmallInlineAutomation 在列表页完成收尾
      STATE.awaitingListResume = true;
    }
    return;
  }
  
  // 关键修复: 仅在列表页推进,详情页不做任何操作(等待 runTmallInlineDetailScrape 返回列表)
  if (STATE.pageType === 'list') {
    if (DEBUG_TMALL_INLINE) {
      console.debug(`${LOG_PREFIX} 列表页收到结果,延迟推进`);
    }
    
    // 不检查 awaitingResume,让 inlineRequestNext 内部检查
    setTimeout(() => {
      inlineRequestNext();
    }, 800);
  } else {
    if (DEBUG_TMALL_INLINE) {
      console.debug(`${LOG_PREFIX} 详情页收到结果,等待返回列表`, {
        pageType: STATE.pageType
      });
    }
    // 详情页什么都不做,等待 runTmallInlineDetailScrape 自动返回
  }
}

async function resumeTmallInlineAutomation() {
  await INLINE_CONTEXT_READY;
  
  if (!INLINE.sessionId) {
    return;
  }
  
  if (DEBUG_TMALL_INLINE) {
    console.debug(`${LOG_PREFIX} resumeTmallInlineAutomation`, {
      sessionId: INLINE.sessionId,
      activeIndex: INLINE.activeIndex,
      pageType: STATE.pageType,
      awaitingResume: STATE.awaitingListResume
    });
  }

  const summary = await inlineGetSummary().catch(() => null);
  if (!summary) {
    await inlineAbort();
    return;
  }
  
  INLINE.total = summary.total || INLINE.total;
  INLINE.activeIndex = summary.currentIndex ?? INLINE.activeIndex;
  await storeInlineContext(INLINE.sessionId, INLINE.activeIndex, INLINE.total);
  if (INLINE.sessionId) {
    const storedInlineResults = await loadInlineResultsFromStorage(INLINE.sessionId);
    if (storedInlineResults.length) {
      STATE.inlineResults = storedInlineResults;
    }
  }

  if (STATE.site?.id !== 'TMALL') {
    return;
  }

  if (STATE.pageType === 'product') {
    await runTmallInlineDetailScrape();
    return;
  }

  if (STATE.pageType === 'list') {
    await restoreListState();
    INLINE.requesting = false;
    
    // 关键修复:无论 awaitingListResume 状态如何,都尝试推进
    if (STATE.awaitingListResume) {
      if (DEBUG_TMALL_INLINE) {
        console.debug(`${LOG_PREFIX} 检测到等待恢复标记,清除并推进`);
      }
      STATE.awaitingListResume = false;
    }
    
    if (summary.status === 'completed') {
      await finalizeInlineSession(summary);
      return;
    }
    
    await waitForTmallCard(Math.max(1, INLINE.activeIndex + 2));
    
    // 延迟后推进,确保页面稳定
    setTimeout(() => {
      if (DEBUG_TMALL_INLINE) {
        console.debug(`${LOG_PREFIX} 列表页恢复完成,推进下一个`, {
          activeIndex: INLINE.activeIndex,
          total: INLINE.total
        });
      }
      inlineRequestNext();
    }, 1000);
  }
}

async function runTmallInlineDetailScrape() {
  await INLINE_CONTEXT_READY;
  
  if (!INLINE.sessionId) {
    if (DEBUG_TMALL_INLINE) {
      console.debug(`${LOG_PREFIX} 无会话ID,跳过详情采集`);
    }
    return;
  }

  let index = INLINE.activeIndex;
  if (index < 0) {
    const summary = await inlineGetSummary().catch(() => null);
    if (summary && typeof summary.currentIndex === 'number') {
      index = summary.currentIndex;
      INLINE.activeIndex = index;
      await storeInlineContext(INLINE.sessionId, INLINE.activeIndex, INLINE.total);
    }
  }
  
  if (index < 0) {
    if (DEBUG_TMALL_INLINE) {
      console.debug(`${LOG_PREFIX} 无效索引,跳过详情采集`);
    }
    return;
  }

  if (DEBUG_TMALL_INLINE) {
    console.debug(`${LOG_PREFIX} 开始详情页采集`, { index, url: location.href });
  }

  let detail = null;
  let failure = null;
  
  try {
    await waitForTmallDetailReady();
    detail = await scrapeTmallProduct();
    
    if (DEBUG_TMALL_INLINE) {
      console.debug(`${LOG_PREFIX} 详情采集成功`, {
        index,
        title: detail?.title,
        images: detail?.images?.length || 0,
        detailImages: detail?.detailImages?.length || 0
      });
    }
  } catch (error) {
    failure = {
      reason: error?.message || '采集失败',
      stack: error?.stack || null
    };
    
    if (DEBUG_TMALL_INLINE) {
      console.debug(`${LOG_PREFIX} 详情采集失败`, { index, error: failure.reason });
    }
  }

  // 关键修复:先上报结果
  const response = await sendRuntimeMessage('collector/inlineReportDetail', {
    sessionId: INLINE.sessionId,
    index,
    detail,
    failure
  });

  if (DEBUG_TMALL_INLINE) {
    console.debug(`${LOG_PREFIX} 详情采集结果已上报`, {
      index,
      hasDetail: !!detail,
      hasFailure: !!failure,
      action: response?.action,
      hasHistory: history.length > 1,
      listUrl: response?.listUrl
    });
  }

  // 关键修复:无论后台返回什么action,都强制返回列表页
  if (history.length > 1) {
    if (DEBUG_TMALL_INLINE) {
      console.debug(`${LOG_PREFIX} 使用 history.back() 返回`);
    }
    history.back();
    return;
  }
  
  // 备用方案1: 使用后台返回的 listUrl
  if (response?.listUrl) {
    if (DEBUG_TMALL_INLINE) {
      console.debug(`${LOG_PREFIX} 使用后台 listUrl 返回`, { url: response.listUrl });
    }
    location.assign(response.listUrl);
    return;
  }
  
  // 备用方案2: 使用存储的 listUrl
  const stored = await new Promise((resolve) => {
    chrome.storage.local.get([LIST_STATE_STORAGE_KEY], (items) => {
      resolve(items?.[LIST_STATE_STORAGE_KEY]);
    });
  });
  
  if (stored?.listUrl) {
    if (DEBUG_TMALL_INLINE) {
      console.debug(`${LOG_PREFIX} 使用存储的 listUrl 返回`, { url: stored.listUrl });
    }
    location.assign(stored.listUrl);
    return;
  }
  
  // 备用方案3: 使用 sessionStorage
  try {
    const fromSession = sessionStorage.getItem(LIST_STATE_SESSION_KEY);
    if (fromSession) {
      const sessionData = JSON.parse(fromSession);
      if (sessionData?.listUrl) {
        if (DEBUG_TMALL_INLINE) {
          console.debug(`${LOG_PREFIX} 使用 sessionStorage listUrl 返回`, { url: sessionData.listUrl });
        }
        location.assign(sessionData.listUrl);
        return;
      }
    }
  } catch (error) {
    // ignore
  }
  
  // 最后兜底:尝试从referrer推断
  if (document.referrer && document.referrer.includes('tmall.com')) {
    if (DEBUG_TMALL_INLINE) {
      console.debug(`${LOG_PREFIX} 使用 referrer 返回`, { url: document.referrer });
    }
    location.assign(document.referrer);
    return;
  }
  
  // 完全失败,中止会话
  if (DEBUG_TMALL_INLINE) {
    console.warn(`${LOG_PREFIX} 无法返回列表页,中止批量采集`);
  }
  await inlineAbort();
  showToast('无法返回列表页,批量采集已终止', 'error');
}

async function waitForTmallDetailReady(timeout = 5000) {
  // 详情页需要等主图与标题加载完成再提取数据
  if (STATE.site?.id !== 'TMALL' || STATE.pageType !== 'product') {
    return;
  }
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const imageEl = document.querySelector('#mainPicImageEl[src], .mainPicWrap--Ns5WQiHr img[src]');
    const titleEl = document.querySelector('#J_DetailMeta .tb-detail-hd h1, #J_Title h3');
    if (imageEl && imageEl.getAttribute('src') && titleEl && titleEl.textContent?.trim()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
}

// ...existing code...
async function finalizeInlineSession(summary) {
  STATE.awaitingListResume = false;
  const sessionId = INLINE.sessionId;
  if (sessionId && STATE.inlineResults.length === 0) {
    const storedInlineResults = await loadInlineResultsFromStorage(sessionId);
    if (storedInlineResults.length) {
      STATE.inlineResults = storedInlineResults;
    }
  }
  
  // 确保获取到最终的摘要信息
  const finalSummary = summary || (await inlineGetSummary()) || {};
  
  if (DEBUG_TMALL_INLINE) {
    console.debug(`${LOG_PREFIX} finalizeInlineSession`, {
      hasSummary: !!summary,
      finalSummary,
      cachedResultsCount: STATE.inlineResults.length
    });
  }

  // 清理会话状态
  await inlineAbort();

  // 从摘要中提取成功和失败的列表
  const successesFromSummary = Array.isArray(finalSummary.results) ? finalSummary.results : [];
  const failures = Array.isArray(finalSummary.failures) ? finalSummary.failures : [];
  
  // 优先使用 content script 中缓存的结果
  const finalResults = STATE.inlineResults.length > 0 ? STATE.inlineResults : successesFromSummary.map((detail, idx) => ({
    index: detail.index ?? idx,
    total: finalSummary.total,
    detail
  }));

  console.log(finalResults);
  const successCount = finalResults.length;
  const total = finalSummary.total || successCount + failures.length;

  const message = `批量采集完成，成功 ${successCount}/${total} 个。`;
  setButtonState(successCount > 0 ? 'success' : 'error');
  if (STATE.button) {
    STATE.button.title = message;
  }
  showToast(
    failures.length ? `${message} 失败 ${failures.length} 个，请查看控制台。` : message,
    successCount > 0 ? 'success' : 'error'
  );

  // 关键修复: 统一打印最终结果
  if (finalResults.length > 0) {
    console.group(`${LOG_PREFIX} 批量采集明细 (共 ${finalResults.length} 条)`);
    try {
      console.table(
        finalResults.map((entry) => ({
          '序号': (entry.index ?? 0) + 1,
          '标题': entry.detail?.title || '',
          '商品ID': entry.detail?.itemId || entry.detail?.item_id || '',
          '价格': entry.detail?.price || null,
          '链接': entry.detail?.source_url || ''
        }))
      );
    } catch (error) {
      // 如果 console.table 失败,回退到普通打印
      console.log(finalResults);
    }
    console.log(`${LOG_PREFIX} 批量采集明细原始数据:`, finalResults.map((entry) => entry.detail));
    console.groupEnd();
  }

  if (failures.length > 0) {
    console.warn(`${LOG_PREFIX} 采集失败条目:`, failures);
  }

  // 清空缓存
  STATE.inlineResults = [];

  // 4秒后重置按钮状态
  setTimeout(() => {
    if (!STATE.button) {
      return;
    }
    const nextState = STATE.isAuthenticated ? 'ready' : 'login';
    setButtonState(nextState);
    STATE.button.title =
      nextState === 'ready'
        ? '点击采集当前页面'
        : '登录后即可采集当前页面';
  }, 4000);
}





function getTmallListCardElements() {
  const elements = [];
  const seen = new Set();
  for (const selector of TMALL_LIST_CARD_SELECTORS) {
    const nodeList = document.querySelectorAll(selector);
    nodeList.forEach((node) => {
      if (!(node instanceof HTMLElement)) {
        return;
      }
      if (seen.has(node)) {
        return;
      }
      seen.add(node);
      elements.push(node);
    });
  }
  return elements;
}

function simulateCardClick(index) {
  const cards = getTmallListCardElements();
  const card = cards[index] || null;
  if (!card) {
    return false;
  }
  try {
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } catch (error) {
    card.scrollIntoView();
  }

  const anchor = card.querySelector('a[href]');
  const target = anchor || card;
  let dispatched = false;
  if (anchor) {
    anchor.setAttribute('target', '_self');
  }
  try {
    dispatched = target.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true, view: window })
    );
  } catch (error) {
    dispatched = false;
  }
  if (!dispatched) {
    if (anchor && typeof anchor.click === 'function') {
      anchor.setAttribute('target', '_self');
      anchor.click();
    } else if (typeof target.click === 'function') {
      target.click();
    }
  }
  return true;
}

function injectStyles() {
  if (document.getElementById(STYLE_ID)) {
    return;
  }
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    #${BUTTON_ID} {
      position: fixed;
      right: 24px;
      bottom: 24px;
      z-index: 2147483646;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 12px 22px;
      border-radius: 999px;
      border: none;
      font-size: 14px;
      font-weight: 600;
      letter-spacing: 0.02em;
      color: #ffffff;
      cursor: pointer;
      background: linear-gradient(135deg, #2563eb, #4f46e5);
      box-shadow: 0 12px 30px rgba(37, 99, 235, 0.25);
      transition: transform 0.2s ease, box-shadow 0.2s ease, background 0.2s ease;
    }
    #${BUTTON_ID}:hover {
      transform: translateY(-3px);
      box-shadow: 0 18px 36px rgba(37, 99, 235, 0.28);
    }
    #${BUTTON_ID}.gc-state-disabled,
    #${BUTTON_ID}.gc-state-disabled:hover {
      background: #94a3b8;
      box-shadow: none;
      cursor: not-allowed;
      transform: none;
    }
    #${BUTTON_ID}.gc-state-login {
      background: linear-gradient(135deg, #f97316, #f59e0b);
    }
    #${BUTTON_ID}.gc-state-loading,
    #${BUTTON_ID}.gc-state-submitting {
      background: linear-gradient(135deg, #2563eb, #1d4ed8);
    }
    #${BUTTON_ID}.gc-state-success {
      background: linear-gradient(135deg, #16a34a, #22c55e);
    }
    #${BUTTON_ID}.gc-state-error {
      background: linear-gradient(135deg, #dc2626, #ef4444);
    }
    #${BUTTON_ID}.gc-dragging {
      cursor: grabbing;
      opacity: 0.8;
    }
    #${TOAST_ID} {
      position: fixed;
      left: 50%;
      bottom: 32px;
      transform: translateX(-50%) translateY(120%);
      background: rgba(17, 24, 39, 0.9);
      color: #fff;
      padding: 10px 18px;
      border-radius: 999px;
      font-size: 13px;
      z-index: 2147483645;
      opacity: 0;
      pointer-events: none;
      transition: transform 0.28s ease, opacity 0.28s ease;
    }
    #${TOAST_ID}.visible {
      transform: translateX(-50%) translateY(0);
      opacity: 1;
    }
    #${TOAST_ID}[data-type="error"] {
      background: rgba(220, 38, 38, 0.92);
    }
    #${TOAST_ID}[data-type="success"] {
      background: rgba(16, 185, 129, 0.92);
    }
  `;
  document.head.appendChild(style);
}

function makeButtonDraggable(button) {
  button.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) {
      return;
    }
    STATE.dragging = true;
    button.classList.add('gc-dragging');
    button.setPointerCapture(event.pointerId);
    const rect = button.getBoundingClientRect();
    STATE.dragOffset = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };
  });

  button.addEventListener('pointermove', (event) => {
    if (!STATE.dragging) {
      return;
    }
    event.preventDefault();
    const position = {
      left: event.clientX - STATE.dragOffset.x,
      top: event.clientY - STATE.dragOffset.y
    };
    applyButtonPosition(button, position);
  });

  const endDrag = async (event) => {
    if (!STATE.dragging) {
      return;
    }
    STATE.dragging = false;
    button.classList.remove('gc-dragging');
    button.releasePointerCapture(event.pointerId);
    const rect = button.getBoundingClientRect();
    await saveButtonPosition({
      left: rect.left,
      top: rect.top
    });
  };

  button.addEventListener('pointerup', endDrag);
  button.addEventListener('pointercancel', endDrag);
}

function applyButtonPosition(button, position) {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const rect = button.getBoundingClientRect();
  const width = rect.width || 120;
  const height = rect.height || 44;

  const left = clamp(position.left, 8, viewportWidth - width - 8);
  const top = clamp(position.top, 8, viewportHeight - height - 8);

  button.style.left = `${left}px`;
  button.style.top = `${top}px`;
  button.style.right = 'auto';
  button.style.bottom = 'auto';
}

async function applyPositionForCurrentSite() {
  if (!STATE.button || !STATE.site) {
    return;
  }
  try {
    const key = BUTTON_POSITION_KEY_PREFIX + STATE.site.id;
    const stored = await storageGet('local', [key]);
    const position = stored?.[key];
    if (position) {
      applyButtonPosition(STATE.button, position);
    } else {
      STATE.button.style.left = 'auto';
      STATE.button.style.top = 'auto';
      STATE.button.style.right = '24px';
      STATE.button.style.bottom = '24px';
    }
  } catch (error) {
    console.warn(LOG_PREFIX, '读取按钮位置失败', error);
  }
}

async function saveButtonPosition(position) {
  if (!STATE.site) {
    return;
  }
  const key = BUTTON_POSITION_KEY_PREFIX + STATE.site.id;
  try {
    await storageSet('local', { [key]: position });
  } catch (error) {
    console.warn(LOG_PREFIX, '保存按钮位置失败', error);
  }
}

function observeHistoryChanges() {
  const wrap = (method) => {
    const original = history[method];
    history[method] = function wrappedHistoryMethod(...args) {
      const result = original.apply(this, args);
      setTimeout(() => handleUrlChange(), 0);
      return result;
    };
  };
  wrap('pushState');
  wrap('replaceState');
  window.addEventListener('popstate', () => handleUrlChange());
}

function handleUrlChange() {
  if (STATE.currentUrl === location.href) {
    return;
  }
  refreshPageContext();
}


function scrapeTemuProduct() {
  const jsonLd = readJsonLdProduct();
  const windowState = gatherWindowState();
  const productCandidate = findProductCandidate(windowState);
  const priceText =
    jsonLd?.offers?.price ||
    getTextContent('[data-testid="product-price"]') ||
    productCandidate?.price ||
    productCandidate?.priceText;

  const images = dedupe([
    ...ensureArray(jsonLd?.image),
    ...collectImageSources('[data-testid="product-gallery"] img'),
    ...collectImageSources('[data-testid="product-main-image"] img'),
    ...collectImageSources('.product-gallery img')
  ]).map((url) => normalizeImageUrl(url, 'TEMU')).filter(Boolean);

  const detailImages = dedupe([
    ...collectImageSources('[data-testid="product-detail"] img'),
    ...collectImageSources('[data-testid="detail-media"] img'),
    ...collectImageSources('.product-detail img')
  ]).map((url) => normalizeImageUrl(url, 'TEMU')).filter(Boolean);

  const attrs = extractKeyValuePairs(
    document.querySelectorAll('[data-testid="sku-attributes"] li, [data-testid="product-attributes"] li')
  );

  const seller = productCandidate?.seller || productCandidate?.shopInfo || productCandidate?.storeInfo || null;
  const sellerInfo = seller ? pickFields(seller, ['shopName', 'shopId', 'storeId', 'score', 'starLevel']) : null;

  return {
    itemId:
      productCandidate?.goodsId ||
      productCandidate?.productId ||
      extractQueryParam(location.href, 'goods_id') ||
      extractNumericId(productCandidate?.id, productCandidate?.idStr),
    title: jsonLd?.name || getTextContent('[data-testid="product-title"]') || productCandidate?.title || '',
    subtitle: jsonLd?.description || productCandidate?.subTitle || '',
    price: parsePrice(priceText || ''),
    currency: detectCurrency(priceText || '', jsonLd?.offers?.priceCurrency || 'USD'),
    images,
    detailImages,
    videoUrls: dedupe([
      ...collectVideoSources('[data-testid="detail-media"] video'),
      ...collectVideoSources('video')
    ]),
    attrs,
    shopName:
      productCandidate?.shopName ||
      productCandidate?.storeName ||
      getTextContent('[data-testid*="store"], [data-testid*="shop-name"], [class*="store-name"]'),
    shopId: productCandidate?.shopId || productCandidate?.storeId || null,
    sellerInfo: sellerInfo || parseSellerInfoFromJsonLd(jsonLd),
    meta: {
      hasJsonLd: Boolean(jsonLd),
      pageType: STATE.pageType
    },
    raw: pickFields(productCandidate, ['goodsId', 'goodsName', 'skuInfo', 'skuAttr', 'price', 'shopId'])
  };
}

function scrapeTemuList() {
  const cards = Array.from(
    document.querySelectorAll(
      '[data-testid*="product-card"], [data-track-value*="goods_id"], [data-sku], a[href*="/goods.html"]'
    )
  );
  const items = [];
  for (const card of cards) {
    const link =
      card.tagName === 'A'
        ? card
        : card.querySelector('a[href*="/goods.html"], a[href*="/goods/"], a[href*="/product"]');
    if (!link) {
      continue;
    }
    const url = absoluteUrl(link.href);
    const title =
      link.getAttribute('title') ||
      getTextContent('[data-testid*="product-title"], [class*="title"]', card) ||
      link.textContent?.trim() ||
      '';
    const priceText =
      getTextContent('[data-type="price"], [data-testid*="price"], .price, .product-price', card) || '';
    const image =
      card.querySelector('img[data-src]')?.getAttribute('data-src') ||
      card.querySelector('img')?.getAttribute('src');
    const item = createListItem({
      title,
      url,
      image: normalizeImageUrl(image, 'TEMU'),
      priceText,
      currencyFallback: 'USD'
    });
    if (item) {
      item.cover = item.image;
      items.push(item);
    }
  }
  return {
    shopName: getTextContent('[data-testid*="store-name"], [class*="store-name"]') || '',
    items: uniqueByUrl(items).slice(0, 50),
    meta: {
      totalNodes: cards.length
    }
  };
}

function scrapeTmallProduct() {
  const jsonLd = readJsonLdProduct();
  const title =
    jsonLd?.name ||
    getTextContent('#J_DetailMeta .tb-detail-hd h1') ||
    getTextContent('#J_Title h3') ||
    document.title.replace(/-tmall\.com$/i, '').trim();
  const priceText =
    jsonLd?.offers?.price ||
    getTextContent('#J_PromoPrice .tm-price') ||
    getTextContent('#J_StrPriceModBox .tm-price') ||
    '';
  const images = dedupe([
    // SKU 规格图块
    ...collectImageSources('[class^="valueItemImgWrap--"] img'),
    ...collectImageSources('[class*="valueItemImgWrap"] img'),
    ...collectImageSources('#J_TSaleProp li img')
  ]).map((url) => normalizeImageUrl(url, 'TMALL')).filter(Boolean);
  const detailImages = [];
  const attrs = extractKeyValuePairs(document.querySelectorAll('#J_AttrUL li, .attributes-list li'));
  const sellerInfo = {
    name: getTextContent('#J_ShopInfo .tb-shop-name a'),
    url: document.querySelector('#J_ShopInfo .tb-shop-name a')?.href || '',
    credit: getTextContent('#J_ShopInfo .tb-shop-rank'),
    score: getTextContent('#shop-info .shopdsr-score')
  };

  return {
    itemId: extractQueryParam(location.href, 'id') || extractNumericId(location.href),
    title,
    subtitle: jsonLd?.description || getTextContent('.tb-detail-hd p'),
    price: parsePrice(priceText),
    currency: detectCurrency(priceText, jsonLd?.offers?.priceCurrency || 'CNY'),
    images,
    detailImages,
    attrs,
    videoUrls: collectVideoSources('#description video, #desc-lazyload-container video'),
    shopName: sellerInfo.name,
    shopId: extractNumericId(document.querySelector('#J_ShopInfo .tb-shop-name a')?.href),
    sellerInfo,
    meta: {
      hasJsonLd: Boolean(jsonLd)
    }
  };
}

function scrapeTmallList() {
  const items = [];
  const legacySelectors =
    '#J_ItemList .product, #J_ItemList .item, #J_ItemList .product-item, .product-list .product';
  const modernSelectors =
    '[class*="product_shelf"] [class*="cardContainer"], [class*="productShelf"] [class*="cardContainer"], [class*="cardContainer--"]';

  const candidateSet = new Set();
  const addCandidates = (nodes) => {
    if (!nodes) {
      return;
    }
    nodes.forEach((node) => {
      if (node instanceof Element) {
        candidateSet.add(node);
      }
    });
  };

  addCandidates(document.querySelectorAll(legacySelectors));
  addCandidates(document.querySelectorAll(modernSelectors));
  console.log('Tmall list candidates found:', candidateSet.size);
  for (const candidate of candidateSet) {
    const link =
      candidate.querySelector('a[href*="tmall.com/item.htm"], a[href*="detail.tmall.com"], a[href*="item.htm"]') ||
      candidate.closest('a[href*="tmall.com/item.htm"], a[href*="detail.tmall.com"], a[href*="item.htm"]');
    if (!link || !link.href) {
      continue;
    }

    const imageEl =
      candidate.querySelector('img[data-src]') ||
      candidate.querySelector('img[data-lazy-load]') ||
      candidate.querySelector('img[data-original]') ||
      candidate.querySelector('img[src]');
    const image =
      imageEl?.getAttribute('data-src') ||
      imageEl?.getAttribute('data-lazy-load') ||
      imageEl?.getAttribute('data-original') ||
      imageEl?.getAttribute('src');

    const priceText =
      getTextContent(
        '.productPrice, .product-price, .c-price, .s-price, [class*="price--"], [class*="text-price"], [class*="price"]',
        candidate
      ) || getTextContent('[class*="price"]', candidate);

    const title =
      getTextContent('.productTitle, .product-title, .title', candidate) ||
      getTextContent('[class*="title--"]', candidate) ||
      getTextContent('[class*="title"]', candidate);

    const itemId =
      extractQueryParam(link.href, 'id') ||
      link.getAttribute('data-itemid') ||
      link.getAttribute('data-item-id') ||
      link.dataset?.itemid ||
      link.dataset?.itemId ||
      candidate.getAttribute('data-itemid') ||
      candidate.getAttribute('data-item-id') ||
      candidate.dataset?.itemid ||
      candidate.dataset?.itemId ||
      extractNumericId(link.href);

    const finalUrl =
      itemId && /^[\d]+$/.test(String(itemId).trim())
        ? `https://detail.tmall.com/item.htm?id=${String(itemId).trim()}`
        : absoluteUrl(link.href);

    const item = createListItem({
      title,
      url: finalUrl,
      image: normalizeImageUrl(image, 'TMALL'),
      priceText,
      currencyFallback: 'CNY'
    });
    if (item) {
      items.push(item);
    } else {
      console.debug(
        `${LOG_PREFIX} 忽略无效列表项`,
        JSON.stringify(
          {
            title,
            url: link.href,
            image,
            priceText
          },
          null,
          2
        )
      );
    }
  }

  console.debug(`${LOG_PREFIX} Tmall 列表解析结果`, { count: items.length });

  if (items.length < 10) {
    const fallbackStateItems = extractTmallListFromState();
    console.debug(`${LOG_PREFIX} Tmall 列表备用数据`, { count: fallbackStateItems.length });
    for (const fallback of fallbackStateItems) {
      if (!fallback?.source_url) {
        continue;
      }
      const exists = items.some((item) => item.source_url === fallback.source_url);
      if (!exists) {
        items.push(fallback);
      }
    }
  }

  return {
    shopName:
      getTextContent('#shop-extra .slogo-shopname, .shop-name, .slogo h1, [class*="shopName"]') ||
      getTextContent('[class*="sellerName"]'),
    items: uniqueByUrl(items).slice(0, 80)
  };
}

function extractTmallListFromState() {
  const state = gatherWindowState();
  if (!state || typeof state !== 'object') {
    return [];
  }
  const queue = [];
  const visited = new Set();
  const results = [];
  const seen = new Set();

  for (const value of Object.values(state)) {
    if (value && typeof value === 'object') {
      queue.push(value);
    }
  }

  while (queue.length && results.length < 200) {
    const current = queue.shift();
    if (!current || typeof current !== 'object') {
      continue;
    }
    if (visited.has(current)) {
      continue;
    }
    visited.add(current);

    if (Array.isArray(current)) {
      for (const entry of current) {
        if (entry && typeof entry === 'object') {
          queue.push(entry);
        }
      }
      continue;
    }

    const itemId = extractNumericId(
      current.itemId,
      current.itemID,
      current.item_id,
      current.itemNumId,
      current.itemNumID,
      current.auctionId,
      current.auction_id,
      current.goodsId,
      current.goods_id,
      current.productId,
      current.product_id,
      current.id,
      current.num_iid
    );

    let rawUrl =
      current.detailUrl ||
      current.detailURL ||
      current.detail_url ||
      current.detailHref ||
      current.itemUrl ||
      current.itemURL ||
      current.item_url ||
      current.auctionUrl ||
      current.auctionURL ||
      current.url ||
      current.jumpUrl ||
      current.jumpURL ||
      current.link ||
      current.href ||
      null;

    if (!rawUrl && current.detail) {
      if (typeof current.detail === 'string') {
        rawUrl = current.detail;
      } else if (current.detail.detailUrl) {
        rawUrl = current.detail.detailUrl;
      }
    }

    if (typeof rawUrl === 'string') {
      rawUrl = rawUrl.trim();
    }

    let detailUrl = null;
    if (rawUrl) {
      if (/item\.htm/i.test(rawUrl)) {
        const extractedId = extractNumericId(rawUrl);
        if (extractedId) {
          detailUrl = `https://detail.tmall.com/item.htm?id=${extractedId}`;
        }
      }
      if (!detailUrl) {
        let normalized = rawUrl.replace(/^\/\//, `${location.protocol}//`);
        if (!/^https?:\/\//i.test(normalized) && normalized.startsWith('/')) {
          normalized = `https://detail.tmall.com${normalized}`;
        } else if (!/^https?:\/\//i.test(normalized)) {
          normalized = `https://${normalized}`;
        }
        detailUrl = absoluteUrl(normalized);
      }
    }
    if (!detailUrl && itemId) {
      detailUrl = `https://detail.tmall.com/item.htm?id=${itemId}`;
    }

    if (detailUrl && !seen.has(detailUrl)) {
      const imageCandidate =
        (Array.isArray(current.picList) && current.picList.find((img) => typeof img === 'string')) ||
        (Array.isArray(current.pics) && current.pics.find((img) => typeof img === 'string')) ||
        (Array.isArray(current.images) && current.images.find((img) => typeof img === 'string')) ||
        current.picUrl ||
        current.image ||
        current.imageUrl ||
        current.pic;

      const titleCandidate =
        current.title ||
        current.itemTitle ||
        current.itemName ||
        current.productTitle ||
        current.name ||
        current.nick ||
        current.mainTitle ||
        current.shortTitle;

      const priceCandidate =
        current.price ||
        current.promotionPrice ||
        current.priceText ||
        current.displayPrice ||
        current.originPrice ||
        current.finalPrice ||
        current.activityPrice ||
        current.reservePrice;

      const listItem = createListItem({
        title: titleCandidate,
        url: detailUrl,
        image: normalizeImageUrl(imageCandidate, 'TMALL'),
        priceText: typeof priceCandidate === 'number' ? priceCandidate.toString() : priceCandidate,
        currencyFallback: 'CNY'
      });

      if (listItem) {
        results.push(listItem);
        seen.add(detailUrl);
      }
    }

    for (const value of Object.values(current)) {
      if (value && typeof value === 'object') {
        queue.push(value);
      }
    }
  }

  return results;
}

function scrapeTaobaoProduct() {
  const jsonLd = readJsonLdProduct();
  const title =
    jsonLd?.name ||
    getTextContent('#J_Title h3') ||
    getTextContent('#J_DetailMeta h3') ||
    document.title.replace(/-淘宝网$/i, '').trim();
  const priceText =
    jsonLd?.offers?.price ||
    getTextContent('#J_StrPrice .tb-rmb-num') ||
    getTextContent('#J_PromoPrice .tb-rmb-num');
  const images = dedupe([
    ...ensureArray(jsonLd?.image),
    ...collectImageSources('#J_UlThumb img'),
    ...collectImageSources('#J_ImgBooth img')
  ]).map((url) => normalizeImageUrl(url, 'TAOBAO')).filter(Boolean);
  const detailImages = dedupe([
    ...collectImageSources('#desc-lazyload-container img'),
    ...collectImageSources('#J_DivItemDesc img'),
    ...collectImageSources('#description img')
  ]).map((url) => normalizeImageUrl(url, 'TAOBAO')).filter(Boolean);
  const attrs = extractKeyValuePairs(document.querySelectorAll('#J_AttrUL li, .attributes-list li'));

  const sellerInfo = {
    name: getTextContent('#J_ShopInfo .tb-shop-name'),
    url: document.querySelector('#J_ShopInfo .tb-shop-name a')?.href || '',
    score: getTextContent('#J_ShopInfo .tb-shop-ww')
  };

  return {
    itemId: extractQueryParam(location.href, 'id') || extractNumericId(location.href),
    title,
    subtitle: jsonLd?.description || getTextContent('#J_Title p'),
    price: parsePrice(priceText),
    currency: detectCurrency(priceText, jsonLd?.offers?.priceCurrency || 'CNY'),
    images,
    detailImages,
    attrs,
    videoUrls: collectVideoSources('#J_DivItemDesc video, #description video'),
    shopName: sellerInfo.name,
    sellerInfo,
    meta: {
      hasJsonLd: Boolean(jsonLd)
    }
  };
}

function scrapeTaobaoList() {
  const items = [];
  const cards = document.querySelectorAll('.item.J_MouserOnverReq, .item-card, .product');
  for (const card of cards) {
    const link = card.querySelector('a[href*="item.taobao.com/item.htm"]');
    if (!link) {
      continue;
    }
    const image =
      card.querySelector('img[data-src]')?.getAttribute('data-src') ||
      card.querySelector('img')?.getAttribute('src');
    const priceText =
      getTextContent('.price strong', card) ||
      getTextContent('.c-price', card) ||
      getTextContent('.J_ItemPrice', card);
    const item = createListItem({
      title:
        link.getAttribute('title') ||
        getTextContent('.title', card) ||
        getTextContent('.product-title', card),
      url: absoluteUrl(link.href),
      image: normalizeImageUrl(image, 'TAOBAO'),
      priceText,
      currencyFallback: 'CNY'
    });
    if (item) {
      items.push(item);
    }
  }
  return {
    shopName: getTextContent('.shop-title, .tb-shop-name, #ShopHeader .shop-name'),
    items: uniqueByUrl(items).slice(0, 60)
  };
}

function scrapeAli1688Product() {
  const jsonLd = readJsonLdProduct();
  const title =
    jsonLd?.name ||
    getTextContent('.module-od-title h1') ||
    getTextContent('.title-text');
  const priceText =
    jsonLd?.offers?.price ||
    getTextContent('.module-od-main-price .value') ||
    getTextContent('.od-pc-offer-price');
  const images = dedupe([
    ...ensureArray(jsonLd?.image),
    ...collectImageSources('.od-gallery .od-gallery-img'),
    ...collectImageSources('.od-gallery-carousel img')
  ]).map((url) => normalizeImageUrl(url, 'ALI1688')).filter(Boolean);
  const detailImages = dedupe([
    ...collectImageSources('#desc-lazyload-container img'),
    ...collectImageSources('.richtext-content img'),
    ...collectImageSources('.offer-detail-description img')
  ]).map((url) => normalizeImageUrl(url, 'ALI1688')).filter(Boolean);
  const attrs = {};
  const attrRows = document.querySelectorAll('#mod-detail-attributes tr, #productAttributes tr');
  for (const row of attrRows) {
    const ths = row.querySelectorAll('th');
    const tds = row.querySelectorAll('td');
    for (let index = 0; index < ths.length; index += 1) {
      const key = ths[index]?.textContent?.trim();
      const value = tds[index]?.textContent?.trim();
      if (key && value) {
        attrs[key] = value;
      }
    }
  }
  const sellerInfo = {
    name: getTextContent('.company-name, .shop-company-name h1'),
    location: getTextContent('.company-address, .location'),
    phone: getTextContent('.contact-info .phone')
  };

  return {
    itemId: extractNumericId(location.href),
    title,
    subtitle: jsonLd?.description || getTextContent('.od-pc-offer-title span'),
    price: parsePrice(priceText),
    currency: detectCurrency(priceText, jsonLd?.offers?.priceCurrency || 'CNY'),
    images,
    detailImages,
    attrs,
    videoUrls: collectVideoSources('.video-container video'),
    shopName: sellerInfo.name,
    sellerInfo,
    meta: {
      hasJsonLd: Boolean(jsonLd)
    }
  };
}

function scrapeAli1688List() {
  const items = [];
  const cards = document.querySelectorAll('.component-product-card, .offer-card-wrapper, .sm-offer-wrapper');
  for (const card of cards) {
    const link = card.querySelector('a[href*="detail.1688.com"]');
    if (!link) {
      continue;
    }
    const image =
      card.querySelector('img[data-lazyload]')?.getAttribute('data-lazyload') ||
      card.querySelector('img')?.getAttribute('src');
    const priceText =
      getTextContent('.price, .price-text, .price-number', card) ||
      getTextContent('.J_Price, .component-product-price', card);
    const item = createListItem({
      title: getTextContent('.title, .offer-title, .product-title', card) || link.getAttribute('title'),
      url: absoluteUrl(link.href),
      image: normalizeImageUrl(image, 'ALI1688'),
      priceText,
      currencyFallback: 'CNY'
    });
    if (item) {
      items.push(item);
    }
  }
  return {
    shopName: getTextContent('.company-name, .shop-title'),
    items: uniqueByUrl(items).slice(0, 80)
  };
}

function resolveLoginPageUrl(config = {}) {
  const loginPagePath = config.loginPagePath || DEFAULT_CONFIG.loginPagePath;
  if (/^https?:\/\//i.test(loginPagePath)) {
    return trimTrailingSlash(loginPagePath);
  }
  const base = safeUrl(config.apiBaseUrl);
  if (!base) {
    return null;
  }
  const baseOrigin = trimTrailingSlash(base.origin);
  if (!loginPagePath || loginPagePath === '#') {
    return baseOrigin;
  }
  if (loginPagePath.startsWith('#')) {
    return `${baseOrigin}/${loginPagePath}`;
  }
  if (loginPagePath.startsWith('/')) {
    return `${baseOrigin}${loginPagePath}`;
  }
  return `${baseOrigin}/${loginPagePath}`;
}

function determineLoginOrigin(loginUrl, apiBaseUrl) {
  const resolved = safeUrl(loginUrl);
  if (resolved) {
    return resolved.origin;
  }
  const fallback = safeUrl(apiBaseUrl);
  return fallback ? fallback.origin : null;
}
