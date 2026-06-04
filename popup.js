'use strict';

const API = 'https://api.coingecko.com/api/v3';
const CHART_CACHE_TTL = 5 * 60 * 1000; // 5 min

const COLORS = {
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
  uniswap: '#FF007A',
};

const FALLBACK_LETTERS = {
  bitcoin: '₿', ethereum: 'Ξ', binancecoin: 'B', solana: '◎',
  ripple: 'X', cardano: '₳', dogecoin: 'Ð',
};

const DEFAULT_WATCHLIST = ['bitcoin', 'ethereum', 'solana', 'binancecoin'];

// ─── STATE ──────────────────────────────────────
let S = {
  primary: 'bitcoin',
  currency: 'usd',
  watchlist: [...DEFAULT_WATCHLIST],
  holdings: {},
  coins: {},
  chartPoints: [],
  chartCache: {},  // key: `${id}_${cur}` → { data, ts }
};

// ─── UTILS ──────────────────────────────────────
function color(id) { return COLORS[id] || '#7C83FD'; }

function applyAccent(id) {
  document.documentElement.style.setProperty('--cc', color(id));
}

function fmtPrice(price, cur) {
  const sym = cur === 'eur' ? '€' : '$';
  if (price >= 1000) return sym + price.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (price >= 1)    return sym + price.toFixed(2);
  if (price >= 0.01) return sym + price.toFixed(4);
  return sym + price.toFixed(6);
}

function fmtChange(c) {
  return (c >= 0 ? '+' : '') + c.toFixed(2) + '%';
}

function fmtDate(ts, days) {
  const d = new Date(ts);
  if (days === '1')
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  if (days === '7' || days === '30')
    return d.toLocaleDateString('en-US', { day: '2-digit', month: 'short' }) + ' ' +
           d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: '2-digit' });
}

// ─── CHART ──────────────────────────────────────
// Renders the price line on #chart. Does NOT touch #chartHover.
function renderChart(rawData, accentColor) {
  const canvas = document.getElementById('chart');
  const hover  = document.getElementById('chartHover');
  const wrap   = canvas.parentElement;
  const dpr    = window.devicePixelRatio || 1;
  const W      = wrap.clientWidth  || 358;
  const H      = wrap.clientHeight || 128;

  // Resize both canvases to match
  for (const cv of [canvas, hover]) {
    cv.width  = W * dpr;
    cv.height = H * dpr;
    cv.style.width  = W + 'px';
    cv.style.height = H + 'px';
  }

  const ctx = canvas.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0); // reset transform
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.scale(dpr, dpr);

  if (!rawData || rawData.length < 2) return;

  // Subsample to max 300 pts
  let data = rawData;
  if (data.length > 300) {
    const step = data.length / 300;
    data = Array.from({ length: 300 }, (_, i) => data[Math.floor(i * step)]);
    data.push(rawData[rawData.length - 1]);
  }

  const prices = data.map(d => d[1]);
  const minP   = Math.min(...prices);
  const maxP   = Math.max(...prices);
  const range  = maxP - minP || 1;

  const PAD = { t: 12, r: 8, b: 6, l: 4 };
  const cw  = W - PAD.l - PAD.r;
  const ch  = H - PAD.t - PAD.b;

  const px = i => PAD.l + (i / (data.length - 1)) * cw;
  const py = p => PAD.t + (1 - (p - minP) / range) * ch;

  const pts = data.map((d, i) => ({ x: px(i), y: py(d[1]), ts: d[0], price: d[1] }));
  S.chartPoints = pts;

  // Gradient fill
  const grad = ctx.createLinearGradient(0, PAD.t, 0, H - PAD.b);
  grad.addColorStop(0,   accentColor + '35');
  grad.addColorStop(0.7, accentColor + '0A');
  grad.addColorStop(1,   accentColor + '00');

  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.lineTo(pts[pts.length - 1].x, H - PAD.b);
  ctx.lineTo(pts[0].x, H - PAD.b);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  // Line
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.strokeStyle = accentColor;
  ctx.lineWidth   = 1.8;
  ctx.lineJoin    = 'round';
  ctx.lineCap     = 'round';
  ctx.stroke();

  // End dot
  const lx = pts[pts.length - 1].x;
  const ly = pts[pts.length - 1].y;
  ctx.beginPath();
  ctx.arc(lx, ly, 4.5, 0, Math.PI * 2);
  ctx.fillStyle = accentColor + '35';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(lx, ly, 2.5, 0, Math.PI * 2);
  ctx.fillStyle = accentColor;
  ctx.fill();
}

// Draws crosshair on the overlay canvas only (no chart redraw)
function drawCrosshair(pt) {
  const hover = document.getElementById('chartHover');
  const dpr   = window.devicePixelRatio || 1;
  const W     = hover.width  / dpr;
  const H     = hover.height / dpr;

  const ctx = hover.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, hover.width, hover.height);
  if (!pt) return;

  ctx.scale(dpr, dpr);

  // Vertical dashed line
  ctx.setLineDash([3, 4]);
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth   = 1;
  ctx.beginPath();
  ctx.moveTo(pt.x, 0);
  ctx.lineTo(pt.x, H);
  ctx.stroke();
  ctx.setLineDash([]);

  // Dot
  const c = color(S.primary);
  ctx.beginPath();
  ctx.arc(pt.x, pt.y, 4.5, 0, Math.PI * 2);
  ctx.fillStyle = c + '35';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(pt.x, pt.y, 2.5, 0, Math.PI * 2);
  ctx.fillStyle = c;
  ctx.fill();
}

function initChartInteraction() {
  const hover   = document.getElementById('chartHover');
  const tooltip = document.getElementById('chartTooltip');

  hover.addEventListener('mousemove', (e) => {
    if (!S.chartPoints.length) return;
    const rect = hover.getBoundingClientRect();
    const mx   = e.clientX - rect.left;

    let nearest = S.chartPoints[0], minDx = Infinity;
    for (const pt of S.chartPoints) {
      const dx = Math.abs(pt.x - mx);
      if (dx < minDx) { minDx = dx; nearest = pt; }
    }

    drawCrosshair(nearest);

    document.getElementById('tooltipPrice').textContent = fmtPrice(nearest.price, S.currency);
    document.getElementById('tooltipDate').textContent  = fmtDate(nearest.ts, '1');

    const wrapW = hover.clientWidth;
    let left = nearest.x;
    if (left < 58) left = 58;
    if (left > wrapW - 58) left = wrapW - 58;
    tooltip.style.left = left + 'px';
    tooltip.classList.add('show');
  });

  hover.addEventListener('mouseleave', () => {
    drawCrosshair(null);
    tooltip.classList.remove('show');
  });
}

// ─── API ─────────────────────────────────────────
async function fetchMarkets(ids, cur) {
  const r = await fetch(
    `${API}/coins/markets?vs_currency=${cur}&ids=${ids.join(',')}&order=market_cap_desc&per_page=50&sparkline=false&price_change_percentage=24h`
  );
  if (!r.ok) throw new Error('markets ' + r.status);
  return r.json();
}

async function fetchChart(id, cur, days) {
  const r = await fetch(`${API}/coins/${id}/market_chart?vs_currency=${cur}&days=${days}`);
  if (!r.ok) throw new Error('chart ' + r.status);
  const d = await r.json();
  return d.prices;
}

async function searchAPI(q) {
  const r = await fetch(`${API}/search?query=${encodeURIComponent(q)}`);
  if (!r.ok) return [];
  const d = await r.json();
  return (d.coins || []).slice(0, 7);
}

// ─── UI RENDERS ──────────────────────────────────
function renderHero() {
  const id   = S.primary;
  const coin = S.coins[id];
  const c    = color(id);

  applyAccent(id);
  const dot = document.getElementById('brandDot');
  dot.style.background = c;
  dot.style.boxShadow  = `0 0 10px ${c}`;

  const iconEl = document.getElementById('heroIcon');
  iconEl.style.background = c + '20';
  if (coin?.image) {
    iconEl.innerHTML = `<img src="${coin.image}" alt="${id}" onerror="this.parentElement.textContent='${FALLBACK_LETTERS[id] || id[0].toUpperCase()}'">`;
  } else {
    iconEl.textContent = FALLBACK_LETTERS[id] || id[0].toUpperCase();
  }

  document.getElementById('heroName').textContent   = coin?.name   || id;
  document.getElementById('heroSymbol').textContent = (coin?.symbol || id.slice(0, 4)).toUpperCase();
  document.getElementById('holdingsUnit').textContent = (coin?.symbol || id.slice(0, 4)).toUpperCase();

  if (coin) {
    const price  = coin[S.currency];
    const change = coin[`${S.currency}_24h_change`];

    document.getElementById('heroPrice').textContent = fmtPrice(price, S.currency);
    document.getElementById('heroPrice').classList.remove('loading');
    document.getElementById('heroChange').textContent = fmtChange(change);

    const badge = document.getElementById('heroBadge');
    badge.className = 'badge-change ' + (change >= 0 ? 'pos' : 'neg');

    const amt = parseFloat(document.getElementById('holdingsAmt').value) || 0;
    document.getElementById('holdingsFiat').textContent = '= ' + fmtPrice(amt * price, S.currency);
  } else {
    document.getElementById('heroPrice').textContent = '—';
    document.getElementById('heroPrice').classList.add('loading');
    document.getElementById('heroChange').textContent = '—';
    document.getElementById('heroBadge').className   = 'badge-change';
  }

  renderPortfolio();
}

function renderWatchlist() {
  const el = document.getElementById('watchlist');
  el.innerHTML = '';

  S.watchlist.forEach(id => {
    const coin  = S.coins[id];
    const c     = color(id);
    const isAct = id === S.primary;
    const price  = coin?.[S.currency];
    const change = coin?.[`${S.currency}_24h_change`];

    const item = document.createElement('div');
    item.className = 'wl-item' + (isAct ? ' active' : '');
    item.style.setProperty('--cc', c);

    const iconHtml = coin?.image
      ? `<img src="${coin.image}" alt="${id}" onerror="this.parentElement.textContent='${FALLBACK_LETTERS[id] || id[0].toUpperCase()}';">`
      : (FALLBACK_LETTERS[id] || id[0].toUpperCase());

    const holdingsAmt = parseFloat(S.holdings[id] || 0);
    const holdingsVal = holdingsAmt > 0 && price ? holdingsAmt * price : null;
    const sym = (coin?.symbol || id.slice(0, 4)).toUpperCase();

    item.innerHTML = `
      <div class="wl-icon"></div>
      <div class="wl-info">
        <div class="wl-name">${coin?.name || id}</div>
        <div class="wl-sym">${sym}</div>
      </div>
      <div class="wl-right">
        <div class="wl-price">${price != null ? fmtPrice(price, S.currency) : '—'}</div>
        <div class="wl-chg ${(change ?? 0) >= 0 ? 'pos' : 'neg'}">${change != null ? fmtChange(change) : '—'}</div>
        ${holdingsVal != null ? `<div class="wl-holding">${fmtPrice(holdingsVal, S.currency)}</div>` : ''}
      </div>
      <div class="wl-actions">
        <button class="wl-remove" title="Remove" data-id="${id}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
        <button class="star-btn${isAct ? ' active' : ''}" data-id="${id}" title="Set as primary crypto">
          <svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"
              fill="${isAct ? 'currentColor' : 'none'}"/>
          </svg>
        </button>
      </div>
    `;

    const wlIcon = item.querySelector('.wl-icon');
    wlIcon.style.background = c + '20';
    if (coin?.image) {
      const img = document.createElement('img');
      img.src = coin.image;
      img.alt = id;
      img.addEventListener('error', () => { wlIcon.textContent = FALLBACK_LETTERS[id] || id[0].toUpperCase(); });
      wlIcon.appendChild(img);
    } else {
      wlIcon.textContent = FALLBACK_LETTERS[id] || id[0].toUpperCase();
    }

    item.addEventListener('click', (e) => {
      if (e.target.closest('.wl-remove')) {
        removeCoin(e.target.closest('.wl-remove').dataset.id);
        return;
      }
      if (e.target.closest('.star-btn')) {
        selectPrimary(e.target.closest('.star-btn').dataset.id);
        return;
      }
    });

    el.appendChild(item);
  });
}

function renderPortfolio() {
  let total = 0;
  const items = [];

  S.watchlist.forEach(id => {
    const amt = parseFloat(S.holdings[id] || 0);
    if (amt <= 0) return;
    const price = S.coins[id]?.[S.currency] || 0;
    if (!price) return;
    const val = amt * price;
    total += val;
    items.push({ id, amt, val });
  });

  document.getElementById('portfolioTotal').textContent = fmtPrice(total, S.currency);

  const bd = document.getElementById('portfolioBreakdown');
  if (items.length === 0) {
    bd.innerHTML = '<div class="pf-empty">Enter your holdings per asset to see the total here</div>';
    return;
  }

  bd.innerHTML = '';
  items.forEach(({ id, amt, val }) => {
    const coin = S.coins[id];
    const c    = color(id);
    const sym  = (coin?.symbol || id.slice(0, 4)).toUpperCase();
    const fmtAmt = amt >= 1 ? amt.toLocaleString('en-US', { maximumFractionDigits: 4 })
                 : amt < 0.0001 ? amt.toFixed(8)
                 : amt.toFixed(6);

    const itemEl = document.createElement('div');
    itemEl.className = 'pf-item';

    const iconEl = document.createElement('div');
    iconEl.className = 'pf-icon';
    iconEl.style.background = c + '18';
    if (coin?.image) {
      const img = document.createElement('img');
      img.src = coin.image;
      img.alt = id;
      img.addEventListener('error', () => { iconEl.textContent = FALLBACK_LETTERS[id] || id[0].toUpperCase(); });
      iconEl.appendChild(img);
    } else {
      iconEl.textContent = FALLBACK_LETTERS[id] || id[0].toUpperCase();
    }

    const infoEl = document.createElement('div');
    infoEl.className = 'pf-info';
    const nameEl = document.createElement('span');
    nameEl.className = 'pf-name';
    nameEl.textContent = coin?.name || id;
    const amtEl = document.createElement('span');
    amtEl.className = 'pf-amt';
    amtEl.textContent = `${fmtAmt} ${sym}`;
    infoEl.appendChild(nameEl);
    infoEl.appendChild(amtEl);

    const valEl = document.createElement('div');
    valEl.className = 'pf-val';
    valEl.textContent = fmtPrice(val, S.currency);

    itemEl.appendChild(iconEl);
    itemEl.appendChild(infoEl);
    itemEl.appendChild(valEl);
    bd.appendChild(itemEl);
  });
}

function showChartLoading(show, msg = '') {
  const loader  = document.getElementById('chartLoader');
  const spinner = document.getElementById('chartSpinner');
  const msgEl   = document.getElementById('chartMsg');
  const retry   = document.getElementById('chartRetry');
  loader.classList.toggle('hidden', !show);
  spinner.style.display = msg ? 'none' : '';
  msgEl.textContent = msg;
  retry.style.display = msg ? 'block' : 'none';
}

function clearChartCanvas() {
  const c = document.getElementById('chart');
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, c.width, c.height);
  const h = document.getElementById('chartHover');
  const hctx = h.getContext('2d');
  hctx.clearRect(0, 0, h.width, h.height);
}

// ─── ACTIONS ─────────────────────────────────────
function selectPrimary(id) {
  S.primary = id;
  S.chartPoints = [];

  document.getElementById('holdingsAmt').value = S.holdings[id] || '';
  applyAccent(id);
  renderHero();
  renderWatchlist();
  loadChart();

  // Write storage first, then notify background (avoids race condition)
  chrome.storage.local.set({ primaryCrypto: id }, () => {
    chrome.runtime.sendMessage({ type: 'REFRESH', cryptoId: id, currency: S.currency })
      .catch(() => {});
  });
}

function removeCoin(id) {
  if (S.watchlist.length <= 1) return;
  S.watchlist = S.watchlist.filter(w => w !== id);
  if (S.primary === id) selectPrimary(S.watchlist[0]);
  else renderWatchlist();
  chrome.storage.local.set({ watchlist: S.watchlist });
}

async function addCoin(id, name, symbol, image) {
  if (S.watchlist.includes(id)) { toggleSearch(false); return; }
  S.watchlist.push(id);
  S.coins[id] = { name, symbol, image };
  toggleSearch(false);
  chrome.storage.local.set({ watchlist: S.watchlist });
  await loadPrices();
  renderWatchlist();
}

// ─── DATA LOADING ─────────────────────────────────

// Fetches USD + EUR in parallel → currency switching is instant (no re-fetch)
async function loadPrices() {
  try {
    const [usdMarkets, eurMarkets] = await Promise.all([
      fetchMarkets(S.watchlist, 'usd'),
      fetchMarkets(S.watchlist, 'eur'),
    ]);

    const merge = (markets, cur) => {
      markets.forEach(m => {
        if (!S.coins[m.id]) S.coins[m.id] = {};
        Object.assign(S.coins[m.id], {
          name:   m.name,
          symbol: m.symbol,
          image:  m.image,
          [cur]:                  m.current_price,
          [`${cur}_24h_change`]:  m.price_change_percentage_24h,
        });
      });
    };

    merge(usdMarkets, 'usd');
    merge(eurMarkets, 'eur');

    await chrome.storage.local.set({ cachedCoins: S.coins });
    renderHero();
    renderWatchlist();
  } catch (err) {
    console.error('err');
  }
}

async function loadChart() {
  const cacheKey = `${S.primary}_${S.currency}`;
  const cached   = S.chartCache[cacheKey];

  // Cache hit → instant render
  if (cached && Date.now() - cached.ts < CHART_CACHE_TTL) {
    S.chartPoints = [];
    showChartLoading(false);
    requestAnimationFrame(() => renderChart(cached.data, color(S.primary)));
    return;
  }

  // Cache miss → clear canvas, show spinner
  clearChartCanvas();
  showChartLoading(true);

  try {
    const data = await fetchChart(S.primary, S.currency, '1');

    if (!data || data.length < 2) {
      showChartLoading(true, 'Data unavailable');
      return;
    }

    S.chartCache[cacheKey] = { data, ts: Date.now() };
    S.chartPoints = [];
    showChartLoading(false);
    requestAnimationFrame(() => renderChart(data, color(S.primary)));
  } catch (err) {
    const msg = err.message?.includes('429') ? 'API limit – retry in 30s' : 'Loading error';
    showChartLoading(true, msg);
  }
}

// ─── SEARCH ──────────────────────────────────────
let _searchTimer;

function toggleSearch(show) {
  const box = document.getElementById('searchBox');
  box.style.display = show ? 'block' : 'none';
  if (show) {
    document.getElementById('searchInput').focus();
  } else {
    document.getElementById('searchInput').value = '';
    document.getElementById('searchResults').innerHTML = '';
  }
}

async function handleSearch(q) {
  clearTimeout(_searchTimer);
  const el = document.getElementById('searchResults');
  if (!q.trim()) { el.innerHTML = ''; return; }

  _searchTimer = setTimeout(async () => {
    try {
      const results = await searchAPI(q);
      el.innerHTML = results.map(c => `
        <div class="sr-item"
          data-id="${c.id}"
          data-name="${c.name.replace(/"/g, '&quot;')}"
          data-symbol="${c.symbol}"
          data-image="${c.large || c.thumb || ''}">
          <div class="sr-icon">
            ${c.large
              ? `<img src="${c.large}" alt="${c.name}" onerror="this.style.display='none'">`
              : c.symbol.charAt(0).toUpperCase()}
          </div>
          <span class="sr-name">${c.name}</span>
          <span class="sr-symbol">${c.symbol.toUpperCase()}</span>
        </div>
      `).join('');

      el.querySelectorAll('.sr-item').forEach(item => {
        item.addEventListener('click', () =>
          addCoin(item.dataset.id, item.dataset.name, item.dataset.symbol, item.dataset.image)
        );
      });
    } catch (e) { console.error('search:', e); }
  }, 380);
}

// ─── TRIGGERED ALERTS BANNER ─────────────────────

function fmtRelTime(ts) {
  const diff = Date.now() - ts;
  if (diff < 60000)  return 'just now';
  if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
  if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
  return Math.floor(diff / 86400000) + 'd ago';
}

function renderTriggeredAlerts(alerts) {
  const banner = document.getElementById('trigBanner');
  const list   = document.getElementById('trigList');
  const title  = document.getElementById('trigBannerTitle');

  if (!alerts.length) {
    banner.classList.remove('show');
    return;
  }

  title.textContent = alerts.length === 1 ? 'Alert triggered' : `${alerts.length} alerts triggered`;
  banner.classList.add('show');
  list.innerHTML = '';

  alerts.forEach(alert => {
    const coin = S.coins[alert.cryptoId];
    const c    = color(alert.cryptoId);
    const sym  = (coin?.symbol || alert.cryptoId).toUpperCase();

    const item = document.createElement('div');
    item.className = 'trig-item';

    const iconEl = document.createElement('div');
    iconEl.className = 'trig-icon';
    iconEl.style.background = c + '25';
    if (coin?.image) {
      const img = document.createElement('img');
      img.src = coin.image;
      img.alt = alert.cryptoId;
      img.addEventListener('error', () => { iconEl.textContent = FALLBACK_LETTERS[alert.cryptoId] || alert.cryptoId[0].toUpperCase(); });
      iconEl.appendChild(img);
    } else {
      iconEl.textContent = FALLBACK_LETTERS[alert.cryptoId] || alert.cryptoId[0].toUpperCase();
    }

    const infoEl  = document.createElement('div');
    infoEl.className = 'trig-info';

    const msgEl  = document.createElement('div');
    msgEl.className = 'trig-msg';
    const condSign = alert.condition === 'above' ? '≥' : '≤';
    msgEl.textContent = `${sym} hit ${condSign} ${fmtPrice(alert.targetPrice, alert.currency)} → ${fmtPrice(alert.triggeredPrice, alert.currency)}`;

    const timeEl = document.createElement('div');
    timeEl.className = 'trig-time';
    timeEl.textContent = fmtRelTime(alert.triggeredAt);

    infoEl.appendChild(msgEl);
    infoEl.appendChild(timeEl);

    const dismissBtn = document.createElement('button');
    dismissBtn.className = 'trig-dismiss';
    dismissBtn.title = 'Dismiss';
    dismissBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
    dismissBtn.addEventListener('click', () => dismissTriggeredAlert(alert.id));

    item.appendChild(iconEl);
    item.appendChild(infoEl);
    item.appendChild(dismissBtn);
    list.appendChild(item);
  });
}

async function loadTriggeredAlerts() {
  const { triggeredAlerts = [] } = await chrome.storage.local.get('triggeredAlerts');
  renderTriggeredAlerts(triggeredAlerts);
}

async function dismissTriggeredAlert(id) {
  const { triggeredAlerts = [] } = await chrome.storage.local.get('triggeredAlerts');
  const updated = triggeredAlerts.filter(a => a.id !== id);
  await chrome.storage.local.set({ triggeredAlerts: updated });
  renderTriggeredAlerts(updated);
  if (updated.length === 0) {
    chrome.runtime.sendMessage({ type: 'CLEAR_ALERTS' }).catch(() => {});
  }
}

// ─── ALERTS ──────────────────────────────────────

function renderAlerts(alerts) {
  const list = document.getElementById('alertsList');
  list.innerHTML = '';
  alerts.forEach(alert => {
    const coin = S.coins[alert.cryptoId];
    const c    = color(alert.cryptoId);

    const item = document.createElement('div');
    item.className = 'al-item';

    const iconEl = document.createElement('div');
    iconEl.className = 'al-icon';
    iconEl.style.background = c + '20';
    if (coin?.image) {
      const img = document.createElement('img');
      img.src = coin.image;
      img.alt = alert.cryptoId;
      img.addEventListener('error', () => { iconEl.textContent = FALLBACK_LETTERS[alert.cryptoId] || alert.cryptoId[0].toUpperCase(); });
      iconEl.appendChild(img);
    } else {
      iconEl.textContent = FALLBACK_LETTERS[alert.cryptoId] || alert.cryptoId[0].toUpperCase();
    }

    const infoEl = document.createElement('div');
    infoEl.className = 'al-info';

    const nameEl = document.createElement('div');
    nameEl.className = 'al-name';
    nameEl.textContent = coin?.name || alert.cryptoId;

    const condEl  = document.createElement('div');
    condEl.className = 'al-cond';
    const condSpan = document.createElement('span');
    condSpan.className = alert.condition === 'above' ? 'al-above' : 'al-below';
    condSpan.textContent = (alert.condition === 'above' ? '≥ ' : '≤ ') + fmtPrice(alert.targetPrice, alert.currency);
    condEl.appendChild(condSpan);

    infoEl.appendChild(nameEl);
    infoEl.appendChild(condEl);

    const removeBtn = document.createElement('button');
    removeBtn.className = 'al-remove';
    removeBtn.title = 'Remove';
    removeBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
    removeBtn.addEventListener('click', () => removeAlert(alert.id));

    item.appendChild(iconEl);
    item.appendChild(infoEl);
    item.appendChild(removeBtn);
    list.appendChild(item);
  });
}

async function loadAlerts() {
  const { alerts = [] } = await chrome.storage.local.get('alerts');
  renderAlerts(alerts);
}

async function removeAlert(id) {
  const { alerts = [] } = await chrome.storage.local.get('alerts');
  const updated = alerts.filter(a => a.id !== id);
  await chrome.storage.local.set({ alerts: updated });
  renderAlerts(updated);
}

async function saveAlert(cryptoId, condition, targetPrice) {
  const { alerts = [] } = await chrome.storage.local.get('alerts');
  alerts.push({ id: Date.now(), cryptoId, condition, targetPrice, currency: S.currency });
  await chrome.storage.local.set({ alerts });
  renderAlerts(alerts);
}

function initAlerts() {
  const addBtn  = document.getElementById('addAlertBtn');
  const form    = document.getElementById('alertForm');
  const submit  = document.getElementById('alertSubmit');
  const condBtns = document.querySelectorAll('.alert-cond-btn');
  let condition = 'above';

  function refreshCoinSelect() {
    const sel = document.getElementById('alertCoin');
    sel.innerHTML = '';
    S.watchlist.forEach(id => {
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = S.coins[id]?.name || id;
      sel.appendChild(opt);
    });
    sel.value = S.primary;
  }

  addBtn.addEventListener('click', () => {
    const opening = !form.classList.contains('open');
    form.classList.toggle('open', opening);
    if (opening) { refreshCoinSelect(); document.getElementById('alertPrice').focus(); }
  });

  condBtns.forEach(btn => btn.addEventListener('click', () => {
    condition = btn.dataset.cond;
    condBtns.forEach(b => b.classList.toggle('active', b.dataset.cond === condition));
  }));

  submit.addEventListener('click', async () => {
    const cryptoId = document.getElementById('alertCoin').value;
    const price    = parseFloat(document.getElementById('alertPrice').value);
    if (!cryptoId || !price || price <= 0) return;
    await saveAlert(cryptoId, condition, price);
    document.getElementById('alertPrice').value = '';
    form.classList.remove('open');
  });

  document.getElementById('alertPrice').addEventListener('keydown', e => {
    if (e.key === 'Enter') submit.click();
  });

  loadAlerts();
}

// ─── REFRESH BUTTON ──────────────────────────────
async function doRefresh() {
  const btn = document.getElementById('refreshBtn');
  btn.classList.add('spinning');

  // Invalidate chart cache for both currencies
  delete S.chartCache[`${S.primary}_usd`];
  delete S.chartCache[`${S.primary}_eur`];

  await Promise.all([loadPrices(), loadChart()]);

  btn.classList.remove('spinning');

  chrome.storage.local.set({ primaryCrypto: S.primary }, () => {
    chrome.runtime.sendMessage({ type: 'REFRESH', cryptoId: S.primary, currency: S.currency })
      .catch(() => {});
  });
}

// ─── INIT ─────────────────────────────────────────
async function init() {
  const saved = await chrome.storage.local.get([
    'primaryCrypto', 'currency', 'watchlist', 'holdings', 'cachedCoins'
  ]);

  if (saved.primaryCrypto) S.primary  = saved.primaryCrypto;
  if (saved.currency)      S.currency = saved.currency;
  if (saved.watchlist)     S.watchlist = saved.watchlist;
  if (saved.holdings)      S.holdings  = saved.holdings;
  if (saved.cachedCoins)   S.coins     = saved.cachedCoins;

  if (!S.watchlist.includes(S.primary)) S.watchlist.unshift(S.primary);

  // Apply initial state from cache
  applyAccent(S.primary);
  document.getElementById('holdingsAmt').value = S.holdings[S.primary] || '';
  document.querySelectorAll('.cur-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.cur === S.currency)
  );

  renderHero();
  renderWatchlist();
  initChartInteraction();
  initAlerts();
  loadTriggeredAlerts();

  // Fetch fresh data
  loadPrices();
  loadChart();

  // React to triggered alerts fired by the background while popup is open
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.triggeredAlerts) {
      renderTriggeredAlerts(changes.triggeredAlerts.newValue || []);
    }
    if (changes.alerts) {
      chrome.storage.local.get('alerts').then(({ alerts = [] }) => renderAlerts(alerts));
    }
  });

  // ── EVENTS ────────────────────────────────────
  document.getElementById('refreshBtn').addEventListener('click', doRefresh);
  document.getElementById('chartRetry').addEventListener('click', loadChart);

  document.querySelectorAll('.cur-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.cur === S.currency) return;
      S.currency = btn.dataset.cur;
      document.querySelectorAll('.cur-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      // Re-render immediately from cache (prices already loaded for both currencies)
      renderHero();
      renderWatchlist();
      loadChart(); // uses chart cache if available, otherwise fetches

      // Persist + update badge with new currency
      chrome.storage.local.set({ currency: S.currency }, () => {
        chrome.runtime.sendMessage({ type: 'REFRESH', cryptoId: S.primary, currency: S.currency })
          .catch(() => {});
      });
    });
  });

  document.getElementById('holdingsAmt').addEventListener('input', (e) => {
    const amt   = parseFloat(e.target.value) || 0;
    const price = S.coins[S.primary]?.[S.currency] || 0;
    document.getElementById('holdingsFiat').textContent = '= ' + fmtPrice(amt * price, S.currency);
    S.holdings[S.primary] = e.target.value;
    chrome.storage.local.set({ holdings: S.holdings });
    renderPortfolio();
    renderWatchlist();
  });

  document.getElementById('addBtn').addEventListener('click', () => {
    const isOpen = document.getElementById('searchBox').style.display === 'block';
    toggleSearch(!isOpen);
  });

  document.getElementById('searchInput').addEventListener('input', (e) => {
    handleSearch(e.target.value);
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('#searchBox') && !e.target.closest('#addBtn')) {
      toggleSearch(false);
    }
  });
}

document.addEventListener('DOMContentLoaded', init);
