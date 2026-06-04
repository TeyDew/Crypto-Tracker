const API = 'https://api.coingecko.com/api/v3';

async function fetchAndCachePrices() {
  const { watchlist = ['bitcoin'] } = await chrome.storage.local.get('watchlist');
  if (!watchlist.length) return;

  const [usdMarkets, eurMarkets] = await Promise.all([
    fetch(`${API}/coins/markets?vs_currency=usd&ids=${watchlist.join(',')}&order=market_cap_desc&per_page=50&sparkline=false&price_change_percentage=24h`).then(r => r.ok ? r.json() : []),
    fetch(`${API}/coins/markets?vs_currency=eur&ids=${watchlist.join(',')}&order=market_cap_desc&per_page=50&sparkline=false&price_change_percentage=24h`).then(r => r.ok ? r.json() : []),
  ]);

  const { cachedCoins = {} } = await chrome.storage.local.get('cachedCoins');

  const merge = (markets, cur) => {
    markets.forEach(m => {
      if (!cachedCoins[m.id]) cachedCoins[m.id] = {};
      Object.assign(cachedCoins[m.id], {
        name:  m.name,
        symbol: m.symbol,
        image:  m.image,
        [cur]:                  m.current_price,
        [`${cur}_24h_change`]:  m.price_change_percentage_24h,
      });
    });
  };

  merge(usdMarkets, 'usd');
  merge(eurMarkets, 'eur');

  await chrome.storage.local.set({ cachedCoins });
}

const CRYPTO_COLORS = {
  bitcoin: '#F7931A',
  ethereum: '#8A9FF0',
  binancecoin: '#F3BA2F',
  solana: '#9945FF',
  ripple: '#00AAE4',
  cardano: '#4DA1F5',
  dogecoin: '#C2A633',
  'shiba-inu': '#FF5722',
  avalanche: '#E84142',
  polkadot: '#E6007A',
  chainlink: '#2A5ADA',
  litecoin: '#BFBBBB',
  'matic-network': '#8247E5',
  'the-open-network': '#0098EA',
};

const CRYPTO_LETTERS = {
  bitcoin: 'B',
  ethereum: 'E',
  binancecoin: 'N',
  solana: 'S',
  ripple: 'X',
  cardano: 'A',
  dogecoin: 'D',
  avalanche: 'A',
  polkadot: 'P',
  chainlink: 'L',
  litecoin: 'L',
};

let _blinkInterval = null;

function stopAlertBlink() {
  if (_blinkInterval !== null) {
    clearInterval(_blinkInterval);
    _blinkInterval = null;
  }
}

function startAlertBlink() {
  if (_blinkInterval !== null) return; // already blinking
  let orange = true;
  chrome.action.setBadgeBackgroundColor({ color: '#F7931A' });
  _blinkInterval = setInterval(() => {
    orange = !orange;
    chrome.action.setBadgeBackgroundColor({ color: orange ? '#F7931A' : '#0d0d14' });
  }, 700);
}

function getColor(id) {
  return CRYPTO_COLORS[id] || '#7C83FD';
}

function getLetter(id) {
  return CRYPTO_LETTERS[id] || id.charAt(0).toUpperCase();
}

function formatBadge(price) {
  if (price >= 1000000) return (price / 1000000).toFixed(1) + 'M';
  if (price >= 1000) return (price / 1000).toFixed(1) + 'k';
  if (price >= 1) return price.toFixed(0);
  return price.toFixed(3);
}

async function setIcon(cryptoId) {
  try {
    const color = getColor(cryptoId);
    const letter = getLetter(cryptoId);
    const sizes = [16, 32, 48];
    const imageData = {};

    for (const size of sizes) {
      const canvas = new OffscreenCanvas(size, size);
      const ctx = canvas.getContext('2d');

      // Dark circle background
      ctx.fillStyle = '#13131f';
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
      ctx.fill();

      // Colored ring
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, size / 2 - 1.5, 0, Math.PI * 2);
      ctx.strokeStyle = color;
      ctx.lineWidth = size <= 16 ? 1.8 : 2.5;
      ctx.stroke();

      // Letter
      const fs = size <= 16 ? 8 : size <= 32 ? 15 : 22;
      ctx.fillStyle = color;
      ctx.font = `700 ${fs}px Arial`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(letter, size / 2, size / 2 + 0.5);

      imageData[size] = ctx.getImageData(0, 0, size, size);
    }

    await chrome.action.setIcon({ imageData });
  } catch (err) {
    console.error('setIcon error:', err);
  }
}

// Called on alarm tick (reads from storage)
async function updateBadge() {
  const { primaryCrypto = 'bitcoin', currency = 'usd' } =
    await chrome.storage.local.get(['primaryCrypto', 'currency']);
  await updateBadgeFor(primaryCrypto, currency);
}

// Called directly from popup message (cryptoId/currency already known → no race condition)
async function updateBadgeFor(cryptoId, currency) {
  await setIcon(cryptoId);

  try {
    const { cachedCoins = {}, triggeredAlerts = [] } =
      await chrome.storage.local.get(['cachedCoins', 'triggeredAlerts']);

    const coin = cachedCoins[cryptoId];
    const price = coin?.[currency];
    if (price == null) return;

    // Always show the price — blink the background if alerts are pending
    chrome.action.setBadgeText({ text: formatBadge(price) });
    chrome.action.setBadgeTextColor({ color: '#ffffff' });

    const sym = currency === 'eur' ? '€' : '$';
    const precisePrice = price >= 1000 ? sym + price.toLocaleString('en-US', { maximumFractionDigits: 2 })
                       : price >= 1    ? sym + price.toFixed(2)
                       : price >= 0.01 ? sym + price.toFixed(4)
                       :                 sym + price.toFixed(6);
    const name = coin.name || cryptoId;
    chrome.action.setTitle({ title: `${name}: ${precisePrice}` });

    if (triggeredAlerts.length > 0) {
      startAlertBlink();
    } else {
      stopAlertBlink();
      chrome.action.setBadgeBackgroundColor({ color: '#0d0d14' });
    }
  } catch (err) {
    console.error('updateBadge error:', err);
  }
}

async function buildNotifIcon(cryptoId) {
  const c = getColor(cryptoId);
  const l = getLetter(cryptoId);
  const size = 48;
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#13131f';
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  ctx.fill();

  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - 2.5, 0, Math.PI * 2);
  ctx.strokeStyle = c;
  ctx.lineWidth = 3;
  ctx.stroke();

  ctx.fillStyle = c;
  ctx.font = '700 22px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(l, size / 2, size / 2 + 0.5);

  const blob = await canvas.convertToBlob({ type: 'image/png' });
  return URL.createObjectURL(blob);
}

function fmtNotifPrice(price, currency) {
  const sym = currency === 'eur' ? '€' : '$';
  if (price >= 1000) return sym + price.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (price >= 1)    return sym + price.toFixed(2);
  if (price >= 0.01) return sym + price.toFixed(4);
  return sym + price.toFixed(6);
}

async function checkAlerts() {
  const { alerts = [], cachedCoins = {} } =
    await chrome.storage.local.get(['alerts', 'cachedCoins']);

  if (!alerts.length) return;

  const triggered = [];
  const remaining = [];

  for (const alert of alerts) {
    const price = cachedCoins[alert.cryptoId]?.[alert.currency];
    if (price == null) { remaining.push(alert); continue; }
    const hit = alert.condition === 'above' ? price >= alert.targetPrice
                                            : price <= alert.targetPrice;
    (hit ? triggered : remaining).push(alert);
  }

  if (!triggered.length) return;

  // Enrich with triggered price and timestamp, append to history
  const { triggeredAlerts = [] } = await chrome.storage.local.get('triggeredAlerts');
  const enriched = triggered.map(alert => ({
    ...alert,
    triggeredPrice: cachedCoins[alert.cryptoId]?.[alert.currency],
    triggeredAt: Date.now(),
  }));

  await chrome.storage.local.set({
    alerts: remaining,
    triggeredAlerts: [...triggeredAlerts, ...enriched],
  });
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('tick', { periodInMinutes: 1 });
  updateBadge();
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'tick') {
    try {
      await fetchAndCachePrices();
    } catch (err) {
      console.error('background fetch error:', err);
    }
    await checkAlerts();
    updateBadge();
  }
});

chrome.storage.onChanged.addListener((changes) => {
  if (changes.primaryCrypto || changes.currency) updateBadge();
  if (changes.cachedCoins) {
    checkAlerts();
    updateBadge();
  }
});

// On service worker (re)start: restore blink if triggered alerts are pending
chrome.storage.local.get('triggeredAlerts').then(({ triggeredAlerts = [] }) => {
  if (triggeredAlerts.length > 0) updateBadge();
});

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg.type === 'REFRESH') {
    const id  = msg.cryptoId || null;
    const cur = msg.currency || null;
    const fn  = id && cur ? updateBadgeFor(id, cur) : updateBadge();
    fn.then(() => reply({ ok: true })).catch(() => reply({ ok: false }));
    return true;
  }
  if (msg.type === 'CLEAR_ALERTS') {
    stopAlertBlink();
    updateBadge().then(() => reply({ ok: true })).catch(() => reply({ ok: false }));
    return true;
  }
});
