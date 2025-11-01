// Force detail links to open in the current tab for Tmall/Taobao list pages.
(function injectForceSameTabGuard() {
  const injectedFlag = '__collectorForceSameTabInjected';
  if (window[injectedFlag]) {
    return;
  }
  window[injectedFlag] = true;

  const inject = () => {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('list-force-same-tab-injected.js');
    script.type = 'text/javascript';
    script.async = false;
    script.onload = () => {
      script.remove();
    };
    (document.head || document.documentElement).appendChild(script);
  };

  if (document.documentElement) {
    inject();
  } else {
    document.addEventListener('DOMContentLoaded', inject, { once: true });
  }
})();
