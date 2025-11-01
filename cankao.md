// 监听
let loginPopup
chrome.runtime.onMessage.addListener(async (msg, sender, sendResponse) => {
  if (msg.type === 'html') {
    const node = document.querySelector('html')
    console.log(node)
    sendResponse(node.innerHTML)
  } else if (msg.type === 'clipboard') {
    // 复制到剪切板
    await clipboard(msg.text)
    sendResponse()
  }

})
window.addEventListener('message', function(event) {
  if (event.origin !== BASE_URL) {
    return;
  }
  const token = event.data.token;
  if (token) {
    chrome.runtime.sendMessage({
      type:'saveToken',
      token: token
    });
    if(loginPopup){
      loginPopup.close();
    }
  }
});
chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
  if (message.type === 'getOpen') {
    const width = 500;
    const height = 600;
    const left = (window.screen.width / 2) - (width / 2);
    const top = (window.screen.height / 2) - (height / 2);
     loginPopup = window.open(
      `${BASE_URL}/#/login`,
      'Login',
      `width=${width},height=${height},top=${top},left=${left}`
    );
    return true;  // 保持消息通道打开
  }
 
});
function mercariCatch(){
  const currentURL = window.location.href; 
  let isShop=currentURL.includes('shops/product') 

    const priceElement = isShop?document.querySelector('[data-testid="product-price"]'):document.querySelector('[data-testid="price"]');
    const price = priceElement ? priceElement.textContent.trim() : "价格未找到";
    let productCondition = document.querySelector('[data-testid="商品の状態"]').textContent.trim();
    console.log("商品の状態:", productCondition);
    
    // 获取 "配送の方法"
    let shippingMethodElement = document.querySelector('[data-testid="配送の方法"]');
    let shippingMethodText = shippingMethodElement.childNodes[0].textContent.trim();
    console.log("配送の方法:", shippingMethodText);
    
    // 获取 "発送までの日数"
    let shippingDays = document.querySelector('[data-testid="発送までの日数"]').textContent.trim();
    console.log("発送までの日数:", shippingDays);
    // 采集カテゴリー
  
    const categoryElement = isShop
        ? document.querySelector('[data-testid="product-detail-category"]') 
        : document.querySelector('[data-testid="item-detail-category"]');
    // const category = categoryElement ? categoryElement.textContent.trim() : "カテゴリー未找到";
    let breadcrumbContainer = categoryElement.querySelector('.merBreadcrumbList');
    // 获取所有的面包屑项
    let breadcrumbItems = breadcrumbContainer.querySelectorAll('.merBreadcrumbItem');
    // 提取每个项的文本内容并用 '>' 连接
    let breadcrumbText = Array.from(breadcrumbItems).map(item => item.textContent.trim()).join(' > ');
    // 采集商品の説明
    const descriptionElement = document.querySelector('[data-testid="description"]');
    const description = descriptionElement ? descriptionElement.textContent.trim() : "商品の説明未找到";

    const nameElement = isShop?document.querySelector('[data-testid="display-name"] h1'):document.querySelector('[data-testid="name"] h1');
    const name = nameElement ? nameElement.textContent.trim() : "名称未找到";
    // 采集图片链接
    const imageElements = document.querySelectorAll('div[aria-label="商品画像カルーセル"] .slick-list')[0].querySelectorAll('img');
    const imageUrls = Array.from(imageElements).map(img => img.src);
    const images = [];
    imageElements.forEach(img => {
        images.push(img.src);
    })
    let numericPrice = parseInt(price.replace(/[^0-9]/g, '')); 
    let obj={
      name:name,
      price:numericPrice,
      category:breadcrumbText,
      description:description||'-',
      shippingDay:shippingDays,
      shippingMethod:shippingMethodText,
      photos:imageUrls,
      status:productCondition,
      source:'煤炉',
    }
    return obj
}
function rakutenCatch(){
  const product = {
      name: document.querySelector('meta[itemprop="name"]').content,
      price: parseFloat(document.querySelector('meta[itemprop="price"]').content),
      category:'',
      description: document.querySelector('span.item_desc').textContent.trim()||'-',
      shippingDay: 3,
      shippingMethod: 3,
      photos: Array.from(document.querySelectorAll('meta[itemprop="image"]')).map(img => img.content),
      status: '新品、未使用', // Assuming the product is new
      source: '乐天',
  };
  return product
}
// function catchAlibaba(){
//   const product = {
//       name: document.querySelector('.title-content').innerText,
//       price: parseFloat(document.querySelector('.price-box .price-text strong').textContent),
//       category: '',
//       description: Array.from(document.querySelectorAll('.offer-attr-item')).map(attr=>{let attrName = attr.querySelector('.offer-attr-item-name').innerText; // 获取属性名
//       let attrValue = attr.querySelector('.offer-attr-item-value').innerText; // 获取属性值
//       return `${attrName}: ${attrValue}\n`; }).toString().trim(),
//       shippingDay: 3,
//       shippingMethod: 3,
//       photos: Array.from(document.querySelectorAll('.detail-gallery-img')).map(img => img.src),
//       status: '新品、未使用', // Assuming the product is new
//       source: '1688',
//   };
//   return product
// }
function catchAlibaba() {
  // 商品名称
  const name = document.querySelector('.module-od-title .title-content h1')?.innerText || '名称未找到';

  // 价格（取第一个价格区间的价格）
  let price = 0;
  const priceInfo = document.querySelector('.module-od-main-price .price-comp .price-info');
  if (priceInfo) {
    price = parseFloat(priceInfo.textContent.replace(/[^\d.]/g, ''));
  }

  // 分类（取店铺名）
  let category = '';
  const shopName = document.querySelector('.shop-company-name h1');
  if (shopName) {
    category = shopName.innerText;
  }

  // 商品属性（表格形式）
  let description = '';
  const attrTable = document.querySelectorAll('#productAttributes table tr');
  if (attrTable.length > 0) {
    description = Array.from(attrTable).map(tr => {
      const ths = tr.querySelectorAll('th');
      const tds = tr.querySelectorAll('td');
      let line = '';
      for (let i = 0; i < ths.length; i++) {
        const key = ths[i]?.innerText?.trim();
        const value = tds[i]?.innerText?.trim();
        if (key && value) {
          line += `${key}: ${value} `;
        }
      }
      return line.trim();
    }).filter(Boolean).join('\n');
  }

  // 发货天数
  let shippingDay = 3;
  const delivery = document.querySelector('.delivery-limit .wbr');
  if (delivery && delivery.innerText.includes('48小时')) {
    shippingDay = 2;
  }

  // 发货方式
  let shippingMethod = '';
  const location = document.querySelector('.module-od-shipping-services .location');
  if (location) {
    shippingMethod = location.innerText;
  }

  // 图片
  let photos = [];
  const imgList = document.querySelectorAll('.od-gallery-img');
  if (imgList.length > 0) {
    photos = Array.from(imgList).map(img => img.src);
  }

  // 状态
  let status = '新品、未使用';

  // 返回对象
  return {
    name,
    price,
    category,
    description: description || '-',
    shippingDay,
    shippingMethod: shippingMethod || '快递',
    photos,
    status,
    source: '1688',
  };
}
window.onload = function() {
  const button = document.createElement('button');
  button.innerText = '采集';
  button.style.position = 'fixed';
  button.style.bottom = '10px';  // 从上到下调整为从底部开始
  button.style.right = '10px';
  button.style.zIndex = '1000';
  button.style.padding = '10px 20px';
  button.style.backgroundColor = '#ff6f61';
  button.style.color = '#fff';
  button.style.border = 'none';
  button.style.borderRadius = '5px';
  button.style.cursor = 'pointer';

  // 将按钮插入到页面中
  // 将按钮插入到页面中
  document.body.appendChild(button);

  // 添加点击事件监听器
  button.addEventListener('click',async function() {
 
    const currentURL = window.location.href;
    let obj;
    if (currentURL.includes('rakuten.co.jp')) {
        // Rakuten 页面处理逻辑
        obj=rakutenCatch();
    } else if (currentURL.includes('mercari.com')) {
        // Mercari 页面处理逻辑
        obj=mercariCatch();
    } else if(currentURL.includes('1688.com')){
        obj=catchAlibaba();
    }else{
        console.log('未知的URL，无法处理');
    }
    chrome.runtime.sendMessage({
      type: 'fetchData',
      url: '/api/mercari/shopProducts/',
      data: obj
  }, function(fetchResponse) {
    
  });})
 
};
importScripts('../plugins/axios-0.21.1.js');
importScripts('config.js');
function openLoginPopup() {
  chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
    chrome.tabs.sendMessage(tabs[0].id, { type: 'getOpen' }, function(response) {
    });
  });
 
}
function sendAuthenticatedRequest(method, url, data = {}, customHeaders = {}) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get('accessToken', async function(result) {
      const accessToken = result.accessToken;

      if (accessToken) {
        try {
          const response = await fetch(`${BASE_URL}${url}`, {
            method: method,  // 请求方法，如 'GET', 'POST'
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
              ...customHeaders  // 其他自定义请求头
            },
            body: method !== 'GET' ? JSON.stringify(data) : null,  // 请求体数据，GET 请求不需要 body
          });

          if (!response.ok) {
            if (response.status === 401) {
              openLoginPopup();
              reject(new Error('你还没有登录，请登录'));
            } else {
              reject(new Error(`请求失败，状态码: ${response.status}`));
            }
            return;
          }

          const responseData = await response.json();
          console.log('请求成功:', responseData);
          resolve(responseData);  // 成功时返回数据
        } catch (error) {
          reject(new Error('请求失败:', error));
        }
      } else {
        openLoginPopup();
        console.error('Access token 不存在，无法发送请求');
        reject(new Error('Access token 不存在，无法发送请求'));
      }
    });
  });
}

chrome.runtime.onMessage.addListener(async (msg, sender, sendResponse) => {
  console.log('%c [ msg ]-16', 'font-size:13px; background:pink; color:#bf2c9f;', msg);
  if (msg.type === 'notify') {
    chrome.notifications.create(null, {
      type: 'basic',
      title: msg.title,
      iconUrl: '../imgs/logo.png',
      message: msg.content
    }, (notificationId) => {
      console.log('通知创建成功，ID:', notificationId);
    });
    sendResponse({ status: '通知已创建' });
  } else if (msg.type === 'fetchData') {
    try {
      const data = await sendAuthenticatedRequest('POST', msg.url, msg.data);
      if (data.code === 401) {
        chrome.runtime.sendMessage({
          type: 'notify',
          title: '提示',
          content: '请先登录'
        });
        chrome.notifications.create(null, {
          type: 'basic',
          title: '提示',
          iconUrl: '../imgs/logo.png',
          message: '请先登录'
        }, (notificationId) => {
          console.log('通知创建成功，ID:', notificationId);
        });
      } else {
        chrome.notifications.create(null, {
          type: 'basic',
          title: '提示',
          iconUrl: '../imgs/logo.png',
          message: '数据收集成功'
        }, (notificationId) => {
          console.log('通知创建成功，ID:', notificationId);
        });
        sendResponse({ status: 'success', data: data });
      }
    } catch (error) {
      chrome.notifications.create(null, {
        type: 'basic',
        title: '提示',
        iconUrl: '../imgs/logo.png',
        message: error.message
      }, (notificationId) => {
        console.log('通知创建成功，ID:', notificationId);
      });
      sendResponse({ status: 'failed', error: error.message });
    }
     
      return true;
  } else if (msg.type === 'login') {
    openLoginPopup();
    sendResponse({ status: '登录请求已发送' });
  } else if (msg.type === 'saveToken') {
    const token = msg.token;
    console.log('%c [ token ]-187', 'font-size:13px; background:pink; color:#bf2c9f;', token)

    // 存储 token 到 chrome.storage.local
    chrome.storage.local.set({ accessToken: token }, function() {
      console.log('Token saved in chrome.storage:', token);

      // 可选：返回保存成功的响应
      sendResponse({ status: 'success', message: 'Token saved' });

      // 创建通知
      chrome.notifications.create(null, {
        type: 'basic',
        title: '提示',
        iconUrl: '../imgs/logo.png',
        message: '登录成功'
      }, function(notificationId) {
        console.log('通知创建成功，ID:', notificationId);
      });
    });

    return true;
  }
});