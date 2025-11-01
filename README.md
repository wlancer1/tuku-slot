# Temu Product Collector Chrome Extension

This extension scrapes product information from Temu pages and sends the data to a backend endpoint that you control. It supports Manifest V3 with a service worker background script.

## Folder structure

```
manifest.json
background.js
contentScript.js
popup.html
popup.js
popup.css
options.html
options.js
options.css
README.md
```

## How it works

1. The content script (`contentScript.js`) scans the current Temu tab and tries to extract product data from global variables, inline scripts, and the DOM.
2. The popup (`popup.html`) lets you trigger a scrape and pushes the collected products to the backend endpoint that you configure in the options page.
3. The background service worker (`background.js`) receives the payload and executes the POST request to your backend with optional authentication headers.

## Installation and usage

1. Open **chrome://extensions** in Chrome, enable **Developer mode**, and click **Load unpacked**.
2. Select this folder (`temu-collector-extension`).
3. Click **Details** → **Extension options** and fill in:
   - Backend endpoint URL (e.g. `https://backend.example.com/api/temu`)
   - Optional API key (added as a `Bearer` token)
   - Optional additional headers (`Header-Name: value` per line)
4. Navigate to a Temu listing or product detail page.
5. Open the extension popup and click **Collect and send**.
6. The extension uploads the products as JSON like the example below:

```json
{
  "source": "temu",
  "collectedAt": "2024-03-20T10:00:00.000Z",
  "tabUrl": "https://www.temu.com/",
  "products": [
    {
      "id": "1234567890",
      "title": "Sample product",
      "price": 9.99,
      "currency": "USD",
      "url": "https://www.temu.com/goods.html?goods_id=1234567890",
      "image": "https://image.temu.com/sample.jpg",
      "rating": 4.8,
      "sold": 1200,
      "store": "Demo Store",
      "raw": { /* original data snapshot */ }
    }
  ]
}
```

## Notes

- Update `manifest.json` → `host_permissions` to include your own backend domain.
- The scraper uses heuristics and may need adjustments if Temu changes its markup or data structures.
- Set the "Include raw payload snapshot" toggle in the popup if you do not want to send the raw JSON fragments.
