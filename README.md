# Crypto Tracker

Chrome extension to track your crypto prices right from the toolbar.

<p align="center">
  <img src="screenshot.png" alt="Crypto Tracker preview" width="390"/>
</p>

---

## Features

- Live price in the extension icon badge, updated automatically
- Custom watchlist — search and add any coin via CoinGecko
- 24h chart with hover to inspect price at any point
- Portfolio tracking with real-time total value
- Price alerts (above / below a threshold) with system notifications
- Instant USD / EUR toggle
- Fear & Greed Index with 7-day history (via [Alternative.me](https://alternative.me/crypto/fear-and-greed-index/))

## Installation

> Until a potential Chrome Web Store release.

1. Clone or download this repo
2. Go to `chrome://extensions`
3. Enable **Developer mode** (top right)
4. Click **Load unpacked** and select the project folder

## Stack

- Manifest V3 (background service worker)
- [CoinGecko API](https://www.coingecko.com/en/api) — free, no API key needed
- [Alternative.me API](https://alternative.me/crypto/fear-and-greed-index/) — Fear & Greed Index, cached 4h
- Vanilla JS / Canvas 2D — zero dependencies
