# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Kalshi Order Launcher — a single-file browser application (`index.html`) for batch-submitting trading orders to the Kalshi API. No build system, no dependencies, no backend server. Pure HTML/CSS/vanilla JavaScript.

## Running the App

```bash
open index.html          # open directly in browser
# or
python3 -m http.server 8000   # serve at http://localhost:8000
```

There are no build, lint, or test commands. No package.json or config files exist.

## Architecture

Everything lives in `index.html` (~945 lines), organized as:

1. **CSS** (lines ~7–461): Dark theme, teal accents, component styles
2. **HTML** (lines ~464–601): Lock screen, credentials card, order form, bundle display, execution log, confirmation modal
3. **JavaScript** (lines ~603–943):
   - **API layer** (`makeRequest`, `signMessage`, `testAuth`): HTTP requests with HMAC-SHA256 or RSA-PKCS1-v1.5 signing via Web Crypto API. Base URL: `https://trading-api.kalshi.com/trade-api/v2`
   - **Order management** (`addOrder`, `removeOrder`): Bundle stored in localStorage (`kalshi_bundle`)
   - **Rendering** (`renderBundle`, `renderLog`): DOM updates for order list and execution log
   - **Execution** (`fireOrders`): Concurrent batch submission via `Promise.allSettled()`
   - **Session lock** (`unlock`): Password gate using sessionStorage (`kol_auth`); default password is `"changeme"`

## Key Details

- API credentials (Key ID + Private Key) stored in localStorage (`kalshi_creds`)
- Supports both RSA PEM and HMAC secret key authentication
- Orders specify: ticker, side (YES/NO), price (1–99 cents), quantity
- Auth headers: `KALSHI-ACCESS-KEY`, `KALSHI-ACCESS-TIMESTAMP`, `KALSHI-ACCESS-SIGNATURE`
