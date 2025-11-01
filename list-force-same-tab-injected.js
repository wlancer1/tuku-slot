(() => {
  if (window.__collectorForceSameTab) {
    return;
  }
  try {
    Object.defineProperty(window, '__collectorForceSameTab', {
      configurable: false,
      enumerable: false,
      writable: false,
      value: true
    });
  } catch (error) {
    window.__collectorForceSameTab = true;
  }

  const DETAIL_HOST_PATTERN_TMALL = /(^|\.)detail\.tmall\./i;
  const DETAIL_HOST_PATTERN_TAOBAO = /(^|\.)item\.taobao\.com$/i;

  const nativeOpen = window.open;
  if (typeof nativeOpen === 'function') {
    const patchedOpen = function patchedOpen(url, name, specs) {
      try {
        if (typeof url === 'string' && url) {
          const targetUrl = new URL(url, location.href);
          if (isDetailHost(targetUrl.hostname)) {
            location.assign(targetUrl.href);
            return window;
          }
        }
      } catch (error) {
        // Ignore parsing errors.
      }
      return nativeOpen.apply(this, arguments);
    };
    try {
      Object.defineProperty(window, 'open', {
        configurable: true,
        writable: true,
        enumerable: false,
        value: patchedOpen
      });
    } catch (error) {
      window.open = patchedOpen;
    }
  }

  document.addEventListener('click', forceSameTab, true);
  document.addEventListener('auxclick', forceSameTab, true);

  function isDetailHost(hostname) {
    if (!hostname) {
      return false;
    }
    const lower = String(hostname).toLowerCase();
    return (
      DETAIL_HOST_PATTERN_TMALL.test(lower) ||
      DETAIL_HOST_PATTERN_TAOBAO.test(lower)
    );
  }

  function findAnchor(node) {
    let current = node;
    while (current && current !== document) {
      if (current.nodeType === Node.ELEMENT_NODE && current.tagName === 'A' && current.href) {
        return current;
      }
      current = current.parentNode;
    }
    return null;
  }

  function isDetailHref(href) {
    try {
      const target = new URL(href, location.href);
      return isDetailHost(target.hostname);
    } catch (error) {
      return false;
    }
  }

  function forceSameTab(event) {
    const anchor = findAnchor(event.target);
    if (!anchor) {
      return;
    }
    if (!isDetailHref(anchor.href)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    anchor.removeAttribute('target');
    location.assign(anchor.href);
  }
})();
