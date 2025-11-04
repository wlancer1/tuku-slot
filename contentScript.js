const LOG_PREFIX = '[图酷通用采集器内容]';
// 调试开关：开启后在控制台输出天猫批量流程的关键节点
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
  recentTasksPath: '/api/collector/items?sort=-collected_at,-id&limit=5',
  collectorItemPath: '/api/collector/items',
  bulkCollectItemsPath: '/api/collector/items:bulk-create',
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
    const itemPayload = buildCollectedItemPayload(parsed, {
      siteId: STATE.site?.id,
      url: location.href,
      collectedAt: new Date().toISOString()
    });
    if (!itemPayload) {
      throw new Error('未能生成采集商品数据，请检查页面内容。');
    }
    setButtonState('submitting');
    STATE.button.title = '正在保存商品数据';
    const idempotencyKey = generateIdempotencyKey('item');
    const savedItem = await postCollectedItem(itemPayload, {
      idempotencyKey,
      path: STATE.config?.collectorItemPath
    });
    const savedProductId = savedItem?.product_id || itemPayload.product_id;
    setButtonState('success');
    STATE.button.title = savedProductId ? `已保存商品 ${savedProductId}` : '商品已保存到后台';
    showToast(savedProductId ? `已保存商品 ${savedProductId}` : '商品已保存到后台。', 'success');
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

function mapSiteIdToSource(siteId) {
  if (!siteId) {
    return 'other';
  }
  const normalized = String(siteId).trim();
  if (!normalized) {
    return 'other';
  }
  switch (normalized.toUpperCase()) {
    case 'TEMU':
      return 'temu';
    case 'TMALL':
      return 'tmall';
    case 'TAOBAO':
      return 'taobao';
    case 'ALI1688':
    case '1688':
      return '1688';
    default:
      return normalized.toLowerCase();
  }
}

function generateIdempotencyKey(prefix = 'collector') {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function buildCollectedItemPayload(detail, options = {}) {
  if (!detail || typeof detail !== 'object') {
    return null;
  }

  const siteId = options.siteId || detail.source_site || detail.site || STATE.site?.id || null;
  const source = mapSiteIdToSource(siteId);

  const url =
    options.url ||
    detail.source_url ||
    detail.url ||
    detail.link ||
    detail.productUrl ||
    detail.pageUrl ||
    location.href;

  const productIdCandidates = [
    options.productId,
    detail.product_id,
    detail.productId,
    detail.itemId,
    detail.item_id,
    detail.goodsId,
    detail.goods_id,
    extractNumericId(url)
  ];
  const productId = productIdCandidates
    .map((value) => (value === undefined || value === null ? null : String(value).trim()))
    .find((value) => value);

  if (!productId) {
    return null;
  }

  const collectedAt = options.collectedAt || new Date().toISOString();
  const title = (options.title || detail.title || '').trim() || '未命名商品';
  const subtitle = (options.subtitle || detail.subtitle || detail.subTitle || '').trim();
  const imageCandidates = [
    ...(ensureArray(detail.images) || []),
    ...(ensureArray(detail.detailImages) || []),
    ...(ensureArray(detail.detail_images) || [])
  ];
  const normalizedImages = sanitizeArray(
    imageCandidates
      .map((img) => normalizeImageUrl(img, siteId))
      .filter((img) => typeof img === 'string' && img.trim())
  );
  const formattedTags = sanitizeArray(options.tags || detail.tags) || [];

  const payload = {
    source,
    status: options.status || 'success',
    collected_at: collectedAt,
    product_id: productId,
    title,
    url,
    tags: formattedTags
  };

  assignIfPresent(payload, 'subtitle', subtitle);
  if (normalizedImages && normalizedImages.length) {
    payload.images = normalizedImages;
  } else {
    payload.images = [];
  }

  return payload;
}

async function postCollectedItem(itemPayload, { idempotencyKey, path } = {}) {
  const response = await sendRuntimeMessage('collector/createCollectedItem', {
    item: itemPayload,
    idempotencyKey,
    path
  });
  if (!response?.ok) {
    throw new Error(response?.error || '采集商品接口调用失败。');
  }
  return response.result || response.item || response.data || null;
}

async function postBulkCollectedItems(itemsPayload, { idempotencyKey, path } = {}) {
  if (!Array.isArray(itemsPayload) || !itemsPayload.length) {
    throw new Error('没有可提交的商品数据。');
  }
  const response = await sendRuntimeMessage('collector/bulkCreateCollectedItems', {
    items: itemsPayload,
    idempotencyKey,
    path
  });
   // 兼容新格式：code 201 表示成功
  if (!(response && (response.ok === true || response.code === 201|| response.code === 200))) {
    throw new Error(response?.error || '批量采集商品接口调用失败。');
  }
  return response.result || response.data || response;
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

// Tmall inline logic moved to sites/tmall.js

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

  return {
    shopName:
      getTextContent('#shop-extra .slogo-shopname, .shop-name, .slogo h1, [class*="shopName"]') ||
      getTextContent('[class*="sellerName"]'),
    items: uniqueByUrl(items).slice(0, 80)
  };
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
