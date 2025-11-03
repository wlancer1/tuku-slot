// Tmall-specific automation helpers extracted from contentScript.js
const DEBUG_TMALL_INLINE = true;

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
    const inputs = container.querySelectorAll('input, select, textarea');
    inputs.forEach((input) => {
      if (!(input instanceof HTMLInputElement || input instanceof HTMLSelectElement || input instanceof HTMLTextAreaElement)) {
        return;
      }
      if (seen.has(input)) {
        return;
      }
      seen.add(input);
      filters.push(snapshotControlState(input));
    });
  }
  return filters;
}

function snapshotControlState(element) {
  const tagName = element.tagName || '';
  const type = element instanceof HTMLInputElement ? element.type || '' : '';
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
      if (STATE.pageType === 'list') {
        await finalizeInlineSession(response.summary || (await inlineGetSummary()));
      } else {
        if (DEBUG_TMALL_INLINE) {
          console.debug(`${LOG_PREFIX} 详情页收到最终结果,等待返回列表再收尾`, {
            pageType: STATE.pageType
          });
        }
        STATE.awaitingListResume = true;
      }
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
