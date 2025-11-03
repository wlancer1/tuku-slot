(function () {
  async function waitForBody() {
    if (document.body) {
      return;
    }
    await new Promise((resolve) => {
      const observer = new MutationObserver(() => {
        if (document.body) {
          observer.disconnect();
          resolve();
        }
      });
      observer.observe(document.documentElement, { childList: true });
    });
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  async function sendRuntimeMessage(type, payload, options = {}) {
    const maxRetries =
      typeof options.retries === 'number' && options.retries >= 0 ? Math.floor(options.retries) : 1;
    const retryDelay =
      typeof options.retryDelay === 'number' && options.retryDelay >= 0 ? options.retryDelay : 120;
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

  function ensureArray(value) {
    if (Array.isArray(value)) {
      return value;
    }
    if (value === null || value === undefined) {
      return [];
    }
    return [value];
  }

  function absoluteUrl(url) {
    if (!url || typeof url !== 'string') {
      return null;
    }
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return url;
    }
    if (url.startsWith('//')) {
      return `${location.protocol}${url}`;
    }
    try {
      return new URL(url, location.href).href;
    } catch (error) {
      return null;
    }
  }

  function parsePrice(text) {
    if (!text || typeof text !== 'string') {
      return null;
    }
    const numeric = text.replace(/[^\d.,]/g, '').replace(/,/g, '');
    if (!numeric) {
      return null;
    }
    const value = parseFloat(numeric);
    return Number.isFinite(value) ? value : null;
  }

  function detectCurrency(text, fallback) {
    if (!text || typeof text !== 'string') {
      return fallback || null;
    }
    if (/[¥￥]/.test(text)) {
      return 'CNY';
    }
    if (/\$/.test(text)) {
      return 'USD';
    }
    if (/NT\$/.test(text)) {
      return 'TWD';
    }
    if (/HK\$/.test(text)) {
      return 'HKD';
    }
    if (fallback) {
      return fallback;
    }
    return null;
  }

  function collectImageSources(selector) {
    return Array.from(document.querySelectorAll(selector))
      .map((img) =>
        img.getAttribute('src') ||
        img.getAttribute('data-src') ||
        img.getAttribute('data-original') ||
        img.getAttribute('data-ks-lazyload') ||
        img.getAttribute('data-lazyload') ||
        (img.dataset ? img.dataset.src : null)
      )
      .filter(Boolean);
  }

  function collectVideoSources(selector) {
    return Array.from(document.querySelectorAll(selector))
      .map((video) =>
        video.getAttribute('src') ||
        video.dataset?.src ||
        video.querySelector('source')?.getAttribute('src') ||
        video.querySelector('source')?.dataset?.src ||
        null
      )
      .filter(Boolean);
  }

  function dedupe(array) {
    if (!Array.isArray(array) || array.length === 0) {
      return [];
    }
    const seen = new Set();
    const result = [];
    for (const item of array) {
      if (!item || seen.has(item)) {
        continue;
      }
      seen.add(item);
      result.push(item);
    }
    return result;
  }

  function extractQueryParam(url, key) {
    if (!url || !key) {
      return null;
    }
    try {
      const parsed = new URL(url, location.href);
      return parsed.searchParams.get(key);
    } catch (error) {
      return null;
    }
  }

  function getTextContent(selector, root = document) {
    const element = root.querySelector(selector);
    if (!element) {
      return '';
    }
    return element.textContent?.trim() || '';
  }

  function extractKeyValuePairs(elements) {
    const result = {};
    elements.forEach((element) => {
      const text = element.textContent?.trim();
      if (!text) {
        return;
      }
      const [key, value] = text.split(/[:：]/);
      if (!key || !value) {
        return;
      }
      result[key.trim()] = value.trim();
    });
    return result;
  }

  function normalizeImageUrl(url, siteId) {
    if (!url) {
      return null;
    }
    let normalized = absoluteUrl(url);
    if (!normalized) {
      return null;
    }
    if (siteId === 'TMALL' || siteId === 'TAOBAO') {
      normalized = normalized.replace(/_(\\d+x\\d+q\\d+|\\d+x\\d+|sum)\\.(jpg|png|jpeg)$/i, '.$2');
      normalized = normalized.replace(/\\.jpg_!!.*$/i, '.jpg');
    }
    if (siteId === 'ALI1688') {
      normalized = normalized.replace(/_(\\d+x\\d+|400x400)\\.(jpg|png|jpeg)$/i, '.$2');
    }
    return normalized;
  }

  function pickFields(source, keys) {
    const result = {};
    if (!source || typeof source !== 'object') {
      return result;
    }
    keys.forEach((key) => {
      if (source[key] !== undefined) {
        result[key] = source[key];
      }
    });
    return result;
  }

  function readJsonLdProduct() {
    const scripts = document.querySelectorAll('script[type=\"application/ld+json\"]');
    for (const script of scripts) {
      const text = script.textContent?.trim();
      if (!text) {
        continue;
      }
      try {
        const parsed = JSON.parse(text);
        const candidates = ensureArray(parsed);
        for (const candidate of candidates) {
          if (!candidate || typeof candidate !== 'object') {
            continue;
          }
          const type = ensureArray(candidate['@type']).join(',').toLowerCase();
          if (type.includes('product')) {
            return candidate;
          }
        }
      } catch (error) {
        continue;
      }
    }
    return null;
  }

  function gatherWindowState() {
    try {
      return window.__NUXT__ || window.__NUXT_DATA__ || window.__INITIAL_STATE__ || window.__PRELOADED_STATE__ || window.__LOAD_DATA__ || window.g_config || window.g_page_config || window.g_data || window.g_shelfData || window.g_sku || null;
    } catch (error) {
      return null;
    }
  }

  function findProductCandidate(root) {
    if (!root || typeof root !== 'object') {
      return null;
    }
    const queue = [root];
    const visited = new Set();
    while (queue.length) {
      const current = queue.shift();
      if (!current || typeof current !== 'object') {
        continue;
      }
      if (visited.has(current)) {
        continue;
      }
      visited.add(current);

      const keys = Object.keys(current);
      const hasTitle = keys.some((key) => /title|name/i.test(key));
      const hasImage = keys.some((key) => /image|img|pic/i.test(key));
      const hasPrice = keys.some((key) => /price/i.test(key));
      const looksLikeProduct =
        (hasTitle && hasImage) ||
        (hasTitle && hasPrice) ||
        keys.some((key) => /goodsId|itemId|productId/i.test(key));
      if (looksLikeProduct) {
        return current;
      }
      Object.values(current).forEach((value) => {
        if (value && typeof value === 'object') {
          queue.push(value);
        }
      });
    }
    return null;
  }

  function extractNumericId(...sources) {
    for (const source of sources) {
      if (!source) {
        continue;
      }
      if (typeof source === 'number') {
        return source.toString();
      }
      if (typeof source === 'string') {
        const match = source.match(/([0-9]{6,})/);
        if (match) {
          return match[1];
        }
      }
    }
    return null;
  }

  function parseSellerInfoFromJsonLd(jsonLd) {
    if (!jsonLd || typeof jsonLd !== 'object') {
      return null;
    }
    const seller = jsonLd.seller || jsonLd.brand || null;
    if (!seller) {
      return null;
    }
    if (typeof seller === 'string') {
      return { name: seller };
    }
    return pickFields(seller, ['name', 'url', 'telephone']);
  }

  function createListItem({ title, url, image, priceText, currencyFallback }) {
    if (!url) {
      return null;
    }
    return {
      title: title || '',
      source_url: url,
      image: image || null,
      price: parsePrice(priceText || ''),
      currency: detectCurrency(priceText || '', currencyFallback || 'CNY')
    };
  }

  function uniqueByUrl(items) {
    const seen = new Set();
    const result = [];
    for (const item of items) {
      if (!item || !item.source_url) {
        continue;
      }
      if (seen.has(item.source_url)) {
        continue;
      }
      seen.add(item.source_url);
      result.push(item);
    }
    return result;
  }

  function copyToClipboard(text) {
    if (typeof text !== 'string') {
      text = text === undefined || text === null ? '' : String(text);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise((resolve, reject) => {
      try {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        const succeeded = document.execCommand('copy');
        document.body.removeChild(textarea);
        if (!succeeded) {
          reject(new Error('无法复制到剪贴板'));
          return;
        }
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  }

  function safeUrl(value) {
    if (!value || typeof value !== 'string') {
      return null;
    }
    try {
      return new URL(value, location.href);
    } catch (error) {
      return null;
    }
  }

  function trimTrailingSlash(text) {
    if (!text) {
      return '';
    }
    return text.replace(/\/+$/, '');
  }

  window.COLLECTOR_UTILS = {
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
  };
})();
