(async () => {
'use strict';

// ─── License ──────────────────────────────────────────────────────
const SCRIPT_URL  = 'https://script.google.com/macros/s/AKfycbyJJZOEEo3mLdmIU7VLKqhrDmECwTSupCLLt0JAbwcXtbOIzxwyF9DMX8E_Boqas0Q3tA/exec';
const KEY_LICENSE = 'cip_license_key';

async function checkLicense(key) {
  try {
    const res = await fetch(`${SCRIPT_URL}?key=${encodeURIComponent(key)}`);
    return (await res.text()).trim() === 'active';
  } catch { return false; }
}
   
function showLicensePopup() {
  if (document.getElementById('_license_popup')) return;
  const overlay = document.createElement('div');
  overlay.id = '_license_popup';
  overlay.style.cssText = `position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.95);display:flex;align-items:center;justify-content:center;z-index:99999999;backdrop-filter:blur(10px);font-family:sans-serif;`;
  overlay.innerHTML = `
    <div style="background:#1c1c2e;padding:32px;border-radius:18px;width:320px;color:#fff;border:1px solid #0faf59;text-align:center;">
      <div style="font-size:32px;margin-bottom:10px;">🔐</div>
      <h3 style="color:#0faf59;margin:0 0 6px;">Dubai Live Trade</h3>
      <p style="color:#888;font-size:12px;margin:0 0 20px;">Enter your license key to continue</p>
      <input id="_lic_inp" type="text" placeholder="License Key"
        style="width:100%;padding:12px;background:#25253d;border:1px solid #444;color:#fff;border-radius:8px;box-sizing:border-box;font-size:14px;outline:none;text-align:center;letter-spacing:1px;">
      <div id="_lic_msg" style="height:20px;margin-top:8px;font-size:12px;color:#ff3e3e;"></div>
      <button id="_lic_btn" style="width:100%;padding:13px;background:#0faf59;border:none;color:#fff;font-weight:bold;font-size:14px;cursor:pointer;border-radius:8px;margin-top:8px;">
        VERIFY KEY
      </button>
    </div>`;
  document.body.appendChild(overlay);
  const inp = document.getElementById('_lic_inp');
  const btn = document.getElementById('_lic_btn');
  const msg = document.getElementById('_lic_msg');
  btn.onclick = async () => {
    const key = inp.value.trim();
    if (!key) { msg.textContent = 'Please enter a key!'; return; }
    btn.textContent = 'Checking...'; btn.style.background = '#555'; btn.disabled = true;
    if (await checkLicense(key)) {
      localStorage.setItem(KEY_LICENSE, key);
      overlay.remove(); init();
    } else {
      msg.textContent = '❌ Invalid key! Contact admin.';
      btn.textContent = 'VERIFY KEY'; btn.style.background = '#0faf59'; btn.disabled = false;
      inp.style.borderColor = '#ff3e3e';
    }
  };
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') btn.click(); });
}

// ─── Storage Keys ────────────────────────────────────────────────
const KEY_LB          = 'leaderboard';
const KEY_INIT        = 'initBalance';
const KEY_POSITION    = 'lb_position';
const KEY_PNL         = 'manual_pnl';
const KEY_PNL_MODE    = 'pnl_mode';
const KEY_PROGRESS    = 'lb_progress';
const KEY_FS593       = 'fs593_value';
const KEY_AUTO_PATTI  = 'auto_patti_on';
const KEY_SESSION_PNL = 'session_pnl';

// ─── State ───────────────────────────────────────────────────────
let initialBal    = Number(localStorage.getItem(KEY_INIT) || 0);
let manualPnl     = localStorage.getItem(KEY_PNL) !== null ? Number(localStorage.getItem(KEY_PNL)) : null;
let pnlMode       = localStorage.getItem(KEY_PNL_MODE) || 'auto';
let savedPosition = localStorage.getItem(KEY_POSITION) || null;
let savedProgress = localStorage.getItem(KEY_PROGRESS) !== null ? Number(localStorage.getItem(KEY_PROGRESS)) : null;
let savedFs593    = localStorage.getItem(KEY_FS593) || null;
let autoPatti     = localStorage.getItem(KEY_AUTO_PATTI) === 'true';
let sessionPnl    = Number(sessionStorage.getItem(KEY_SESSION_PNL) || 0);

function saveSessionPnl() {
  sessionStorage.setItem(KEY_SESSION_PNL, sessionPnl);
}

// ─── Helpers ─────────────────────────────────────────────────────
const $       = (s, c = document) => c.querySelector(s);
const $$      = (s, c = document) => Array.from(c.querySelectorAll(s));
const safeNum = v => parseFloat((v || '0').toString().replace(/[^0-9.-]+/g, '')) || 0;
const fmtAmt  = v => '$' + Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ─── Trade Result Detection ───────────────────────────────────────
// Notification element: div.LYJYG
// Profit result:  div.GIbOO._4CKq  → "+282.67 $"
// Loss result:    div.GIbOO.G4OWz  → "0.00 $"
// Logic:
//   - Profit class ._4CKq → amount = positive number from text
//   - Loss class .G4OWz   → amount = negative (we lost the trade investment)
//     Loss amount = 0.00 in text but we track it differently:
//     On loss, the balance dropped by trade amount → we use balance diff for loss amount
//     OR: loss = 0 payout means full investment lost → track via balance change only for loss

let _tradeObserver  = null;
let _processedNodes = new WeakSet();  // duplicate prevent

// Balance polling — sirf loss amount accurately calculate karne ke liye
let _lastBalance     = null;
let _balInterval     = null;
let _pendingLossCalc = false;

function getBalance() {
  const el = document.querySelector('.qKWSR') || document.querySelector('.pVBHU');
  if (!el) return null;
  return safeNum(el.textContent);
}

function startBalanceTracker() {
  if (_balInterval) return;
  _lastBalance = getBalance();
  _balInterval = setInterval(() => {
    if (!_pendingLossCalc) return;
    const bal = getBalance();
    if (bal === null) return;
    if (_lastBalance !== null && bal !== _lastBalance) {
      const diff = bal - _lastBalance;
      // Only count if it's a loss (negative) and significant
      if (diff < -0.01) {
        sessionPnl += diff;
        saveSessionPnl();
        updateUI();
      }
      _lastBalance = bal;
      _pendingLossCalc = false;
    }
  }, 300);
}

function onTradeResult(notifEl) {
  if (_processedNodes.has(notifEl)) return;
  _processedNodes.add(notifEl);

  const profitEl = notifEl.querySelector('.GIbOO._4CKq');
  const lossEl   = notifEl.querySelector('.GIbOO.G4OWz');

  if (profitEl) {
    // WIN — text mein amount hai e.g. "+282.67 $"
    const amount = safeNum(profitEl.textContent);
    if (amount > 0) {
      // Profit = payout - investment
      // Payout jo mila wo balance mein aayega
      // Hum net gain track karte hain: balance se dekhenge
      // Lekin yahan simple approach: balance change track karo profit ke liye bhi
      _lastBalance = getBalance();  // snapshot lo
      // Thodi der baad balance check karo — net gain milega
      setTimeout(() => {
        const newBal = getBalance();
        if (newBal !== null && _lastBalance !== null) {
          const diff = newBal - _lastBalance;
          if (diff > 0.01) {
            sessionPnl += diff;
            saveSessionPnl();
            updateUI();
          }
          _lastBalance = newBal;
        }
      }, 1200);  // 1.2 sec baad balance settle ho jata hai
    }
  } else if (lossEl) {
    // LOSS — "0.00 $" — payout zero, trade amount gaya
    // Balance change se accurate loss calculate karo
    _lastBalance = getBalance();
    _pendingLossCalc = true;
    // 1.5 sec baad balance check karega interval
    setTimeout(() => {
      const newBal = getBalance();
      if (newBal !== null && _lastBalance !== null) {
        const diff = newBal - _lastBalance;
        if (diff < -0.01) {
          sessionPnl += diff;
          saveSessionPnl();
          updateUI();
          _lastBalance = newBal;
          _pendingLossCalc = false;
        }
      }
    }, 1500);
  }
}

function startTradeObserver() {
  if (_tradeObserver) return;
  _tradeObserver = new MutationObserver(mutations => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.nodeType !== 1) continue;
        // Direct match — yeh notification element hai
        if (node.classList && node.classList.contains('LYJYG')) {
          onTradeResult(node);
        }
        // Ya andar koi LYJYG hai
        node.querySelectorAll && node.querySelectorAll('.LYJYG').forEach(el => onTradeResult(el));
      }
    }
  });
  _tradeObserver.observe(document.body, { childList: true, subtree: true });
}

// ─── Banner Hide ─────────────────────────────────────────────────
(function () {
  const s = document.createElement('style');
  s.textContent = `
    .r7UKG,.P86XK,.ylLrz,.lcyZD,.ryS8w,.rGMix,.s3s3P,.LSmI1,
    [class*="deposit-bonus"],[class*="depositBonus"],
    [class*="bonus-notification"],[class*="bonusNotification"],
    [class*="promo-notification"],[class*="promoNotification"],
    [class*="rocket"],[class*="banner"],[class*="50%"]
    {display:none!important;visibility:hidden!important;opacity:0!important;height:0!important;overflow:hidden!important;}
  `;
  (document.head || document.documentElement).appendChild(s);
})();

function hideBonusBanner() {
  // All known banner selectors — desktop + mobile
  document.querySelectorAll('.r7UKG,.P86XK,.ylLrz,.lcyZD,.ryS8w,.rGMix,.s3s3P').forEach(el => {
    el.style.setProperty('display',    'none',   'important');
    el.style.setProperty('visibility', 'hidden', 'important');
    el.style.setProperty('height',     '0',      'important');
    el.style.setProperty('overflow',   'hidden', 'important');
  });
  // Text-based scan — "50%" wala koi bhi element
  document.querySelectorAll('*').forEach(el => {
    if (el.children.length < 8 &&
        el.offsetHeight > 0 && el.offsetHeight < 120 &&
        /50\s*%/i.test(el.innerText || '') &&
        /bonus|deposit|rocket/i.test(el.innerText || '')) {
      const target = el.closest('[class*="banner"],[class*="promo"],[class*="bonus"],[class*="notification"],[class*="rocket"]') || el;
      target.style.setProperty('display', 'none', 'important');
    }
  });
}

function fixUrl() {
  // URL change disabled — demo link as it is
}

function updateFs593() {
  if (!savedFs593) return;
  document.querySelectorAll('.XWEvH').forEach(el => {
    if (el.textContent !== savedFs593) el.textContent = savedFs593;
  });
}

// ─── Progress Bar ─────────────────────────────────────────────────
function updateProgressBar(pct, isLoss) {
  const p     = Math.min(100, Math.max(0, pct));
  const color = isLoss ? '#ff432e' : '#0faf59';
  const ml    = isLoss ? (100 - p) + '%' : '0%';
  // New selector
  document.querySelectorAll('.uQuVa').forEach(el => {
    el.style.setProperty('width',       p + '%', 'important');
    el.style.setProperty('background',  color,   'important');
    el.style.setProperty('margin-left', ml,      'important');
    el.style.setProperty('transition',  'width 0.6s ease, margin-left 0.6s ease, background 0.4s', 'important');
  });
  // Old fallback
  document.querySelectorAll('.KBHoM').forEach(el => {
    el.style.setProperty('width',       p + '%', 'important');
    el.style.setProperty('background',  color,   'important');
    el.style.setProperty('margin-left', ml,      'important');
  });
}

// ─── Current P&L ─────────────────────────────────────────────────
function getCurrentPnl() {
  if (pnlMode === 'manual' && manualPnl !== null) return manualPnl;
  return sessionPnl;
}

// ─── Main UI Update ───────────────────────────────────────────────
let _uiRunning = false;
let _uiPending = false;

function updateUI() {
  if (_uiRunning) { _uiPending = true; return; }
  _uiRunning = true;
  _runUpdateUI();
  requestAnimationFrame(() => {
    _uiRunning = false;
    if (_uiPending) { _uiPending = false; updateUI(); }
  });
}

function _runUpdateUI() {
  fixUrl();
  hideBonusBanner();
  updateFs593();

  const diff   = getCurrentPnl();
  const isLoss = diff < 0;
  const color  = isLoss ? '#ff432e' : '#0faf59';
  const shown  = fmtAmt(Math.abs(diff));

  // ── LB Money ──
  const seen1 = new WeakSet();
  document.querySelectorAll('.ord28.o8xRM, .ord28, .BwWCZ').forEach(el => {
    if (seen1.has(el)) return; seen1.add(el);
    el.textContent = shown;
    el.style.color = color;
  });

  // ── LB Name/ID ──
  const lbData = JSON.parse(localStorage.getItem(KEY_LB) || '{"name":"Live"}');
  const seen2  = new WeakSet();
  document.querySelectorAll('.d6ijp p, .xN5cX p').forEach(el => {
    if (seen2.has(el)) return; seen2.add(el);
    if (el.textContent !== lbData.name) el.textContent = lbData.name;
  });

  // ── Demo balance → Zt1hG ──
  let curBal = 0;
  // Popup khula ho to b.YnoT0 se lo
  document.querySelectorAll('b.YnoT0').forEach(b => {
    const v = safeNum(b.textContent);
    if (v > curBal) curBal = v;
  });
  // Fallback: window.settings.demoBalance
  if (curBal <= 0 && window.settings?.demoBalance) {
    curBal = safeNum(window.settings.demoBalance);
  }
  if (curBal <= 0 && initialBal > 0) curBal = initialBal;

  // _forcedBal globally store karo — observer use karega
  if (curBal > 0) window._forcedBal = fmtAmt(curBal);

  // ── Level Icon — Auto (balance se real-time) ──
  // Demo ya live — jo bhi balance .qKWSR mein hai, usi se level decide karo
  // Standard (Plane) : 0 - 4,999
  // Pro (Cup)        : 5,000 - 9,999
  // VIP (Diamond)    : 10,000+
  const manualLevel = localStorage.getItem('manual_level');
  let level;
  if (manualLevel) {
    level = manualLevel;
  } else {
    // Sirf current balance se decide karo — demo ho ya live
    level = curBal >= 10000 ? 'vip' : (curBal >= 5000 ? 'pro' : 'standart');
  }
  const iconHref = `/profile/images/spritemap.svg#icon-profile-level-${level}`;
  document.querySelectorAll('.h5aTJ svg use, .ePf8T svg use, .lmj_k svg use').forEach(icon => {
    if (icon.getAttribute('xlink:href') !== iconHref) {
      icon.setAttribute('xlink:href', iconHref);
      icon.setAttribute('href', iconHref);
    }
  });

  // ── Demo → Live account display fix ──
  // Demo select karo lekin live wala UI dikhao
  // Switcher dropdown mein jo "Live" option hai usko active (selected) dikhao
  // Demo balance ($10,000) ko chhupa ke live balance dikhao
  document.querySelectorAll('.UsFyP').forEach(switcher => {
    // Agar demo active lag raha hai to live wala highlight karo
    const txt = switcher.textContent || '';
    if (/demo/i.test(txt)) {
      switcher.style.setProperty('opacity', '0.5', 'important');
    }
  });

  // ── Account text — screen size ke hisaab se ──
  // Laptop (>768px): "Live Account" | Mobile/Tab (<=768px): "Live"
  // .p0Ijl / .Qx5RW = switcher popup — iske andar text mat badlo
  const isDesktop = window.innerWidth > 768;
  document.querySelectorAll('.v2KPX.lTzTl, .v2KPX').forEach(el => {
    if (el.closest('.p0Ijl, .Qx5RW')) return; // switcher popup — haath mat lagao
    if (/demo|live/i.test(el.textContent)) {
      el.textContent = isDesktop ? 'Live Account' : 'Live';
      el.style.setProperty('color', '#0faf59', 'important');
    }
  });

  // ── Trade history count ──
  if (savedFs593) {
    document.querySelectorAll('.XWEvH').forEach(el => {
      if (el.textContent !== savedFs593) el.textContent = savedFs593;
    });
  }

  // ── Position display ──
  if (savedPosition) updatePositionDisplay(savedPosition);

  // ── Progress bar ──
  if (savedProgress !== null) updateProgressBar(savedProgress, isLoss);

  // ── Auto patti ──
  if (autoPatti) applyStaticPatti(isLoss);

  // ── Old position header fallback ──
  const profitEl = document.querySelector('.position__header-money.--green, .position__header-money.--red');
  if (profitEl) { profitEl.innerText = shown; profitEl.style.color = color; }
}

// ─── Line Animation ───────────────────────────────────────────────
let _laf = null, _llt = 0;
function tickLine(ts) {
  if (ts - _llt >= 800) {
    _llt = ts;
    document.querySelectorAll('path[stroke],polyline,line[x1]').forEach(el => {
      el.style.transform = el.style.transform.includes('translateZ') ? '' : 'translateZ(0)';
    });
  }
  _laf = requestAnimationFrame(tickLine);
}
function startLineAnimation() { if (!_laf) _laf = requestAnimationFrame(tickLine); }

// ─── Position Text ────────────────────────────────────────────────
function updatePositionDisplay(v) {
  let updated = false;

  // NEW selector: div.C_yBr > div.YkAuV + text node sibling
  document.querySelectorAll('.C_yBr').forEach(w => {
    const lbl = w.querySelector('.YkAuV');
    if (!lbl || !/your\s+position/i.test(lbl.textContent)) return;
    let found = false;
    w.childNodes.forEach(n => {
      if (n.nodeType === Node.TEXT_NODE && n.textContent.trim() !== '') {
        n.textContent = v; found = true; updated = true;
      }
    });
    if (!found) {
      // Text node nahi mila — inject karo
      w.appendChild(document.createTextNode(v));
      updated = true;
    }
  });

  // OLD selector fallback
  if (!updated) {
    document.querySelectorAll('.iKtL6').forEach(w => {
      const lbl = w.querySelector('.ocuJC');
      if (!lbl || !/your\s+position/i.test(lbl.textContent)) return;
      w.childNodes.forEach(n => { if (n.nodeType === Node.TEXT_NODE) n.textContent = v; });
    });
  }
}

// ─── Zt1hG Force Observer ────────────────────────────────────────
// Quotex har render pe Zt1hG mein $0.00 likh deta hai (Live balance = $0)
// Yeh observer Quotex ke likhne ke foran baad hamaari value wapas likh deta hai
function _attachZt1hGObserver() {
  document.querySelectorAll('.Zt1hG').forEach(el => {
    if (el._zt1hgObserved) return;
    el._zt1hgObserved = true;
    new MutationObserver(() => {
      const forced = window._forcedBal;
      if (!forced) return;
      if (el.textContent !== forced) {
        el.textContent = forced;
      }
    }).observe(el, { childList: true, characterData: true, subtree: true });
  });
}

// Zt1hG element DOM mein aane par observer lagao
new MutationObserver(mutations => {
  for (const m of mutations) {
    for (const node of m.addedNodes) {
      if (node.nodeType !== 1) continue;
      if (node.classList?.contains('Zt1hG')) _attachZt1hGObserver();
      node.querySelectorAll?.('.Zt1hG').forEach(() => _attachZt1hGObserver());
    }
  }
}).observe(document.body, { childList: true, subtree: true });

// Abhi jo elements hain unpe bhi lagao
_attachZt1hGObserver();

// ─── MutationObserver for UI ──────────────────────────────────────
let _uiT;
new MutationObserver(() => {
  clearTimeout(_uiT);
  _uiT = setTimeout(updateUI, 120);
}).observe(document.body, { childList: true, subtree: true, characterData: true });

// ─── Auto Patti ───────────────────────────────────────────────────
function applyStaticPatti(isLoss) {
  const color = isLoss ? '#ff432e' : '#0faf59';
  document.querySelectorAll('.uQuVa,.KBHoM').forEach(el => {
    el.style.setProperty('background',       color,  'important');
    el.style.setProperty('background-color', color,  'important');
    el.style.setProperty('height',           '4px',  'important');
  });
}
function startAutoPatti() {
  autoPatti = true;
  localStorage.setItem(KEY_AUTO_PATTI, 'true');
  applyStaticPatti(sessionPnl < 0);
}
function stopAutoPatti() {
  autoPatti = false;
  localStorage.setItem(KEY_AUTO_PATTI, 'false');
}

// ─── Floating 🎯 Button ───────────────────────────────────────────
let _hideT = null;
function showFloatingBtn() {
  let btn = document.getElementById('_lb_float_btn');
  if (!btn) {
    btn = document.createElement('div');
    btn.id = '_lb_float_btn';
    btn.textContent = '🎯';
    btn.style.cssText = `position:fixed;bottom:130px;right:16px;width:42px;height:42px;background:#1c1c2e;border:2px solid #0faf59;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:20px;cursor:pointer;z-index:99999;box-shadow:0 2px 14px rgba(15,175,89,0.4);transition:opacity 0.4s ease;opacity:1;-webkit-tap-highlight-color:transparent;touch-action:manipulation;`;
    btn.addEventListener('click', openSettingsPopup);
    document.body.appendChild(btn);
  }
  btn.style.opacity       = '1';
  btn.style.display       = 'flex';
  btn.style.pointerEvents = 'auto';
  clearTimeout(_hideT);
  _hideT = setTimeout(() => {
    btn.style.opacity = '0';
    setTimeout(() => { btn.style.display = 'none'; btn.style.pointerEvents = 'none'; }, 400);
  }, 10000);
}
window.addEventListener('_ext_showBtn', showFloatingBtn);

// ─── Settings Popup ───────────────────────────────────────────────
function openSettingsPopup() {
  if (document.getElementById('_pos_popup')) return;

  const lbData     = JSON.parse(localStorage.getItem(KEY_LB) || '{"name":"Live"}');
  const isManual   = pnlMode === 'manual';
  const curPnl     = (isManual && manualPnl !== null) ? Math.abs(manualPnl) : '';
  const isLoss     = isManual && manualPnl !== null && manualPnl < 0;
  const fs593Val   = savedFs593 || '';
  const prog       = savedProgress !== null ? savedProgress : 0;
  const sessIsLoss = sessionPnl < 0;
  const sessColor  = sessIsLoss ? '#ff432e' : '#0faf59';

  const overlay = document.createElement('div');
  overlay.id = '_pos_popup';
  overlay.style.cssText = `position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.88);display:flex;align-items:center;justify-content:center;z-index:9999999;backdrop-filter:blur(7px);overflow-y:auto;-webkit-overflow-scrolling:touch;`;

  overlay.innerHTML = `
    <div style="background:#1c1c2e;padding:14px 16px;border-radius:14px;width:310px;max-width:95vw;color:#fff;border:1px solid #0faf59;font-family:sans-serif;margin:10px auto;">

      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
        <span style="color:#0faf59;font-size:13px;font-weight:bold;">⚙️ Leaderboard Settings</span>
        <span id="_pos_close" style="cursor:pointer;font-size:18px;color:#aaa;padding:2px 7px;border-radius:4px;background:#333;">✕</span>
      </div>

      <!-- Session P&L -->
      <div style="background:#0d0d1a;border:1px solid ${sessColor}55;border-radius:8px;padding:8px 12px;margin-bottom:6px;display:flex;justify-content:space-between;align-items:center;">
        <span style="font-size:11px;color:#888;">📈 Session P&L (auto)</span>
        <span style="font-size:15px;font-weight:bold;color:${sessColor}">${sessIsLoss ? '-' : '+'} ${fmtAmt(Math.abs(sessionPnl))}</span>
      </div>
      <button id="_btn_reset_session" style="width:100%;padding:6px;background:transparent;border:1px solid #555;color:#888;font-size:11px;cursor:pointer;border-radius:6px;margin-bottom:10px;">
        🔄 Reset Session P&L to $0.00
      </button>

      <!-- Name + Position -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:6px;">
        <div>
          <label style="font-size:10px;color:#888;display:block;margin-bottom:2px;">Trader Name / ID</label>
          <input id="_inp_name" value="${lbData.name}" style="width:100%;padding:7px 8px;background:#25253d;border:1px solid #444;color:#fff;border-radius:6px;box-sizing:border-box;font-size:12px;outline:none;">
        </div>
        <div>
          <label style="font-size:10px;color:#888;display:block;margin-bottom:2px;">Position #</label>
          <input id="_inp_pos" value="${savedPosition || ''}" placeholder="+3" style="width:100%;padding:7px 8px;background:#25253d;border:1px solid #444;color:#fff;border-radius:6px;box-sizing:border-box;font-size:12px;outline:none;">
        </div>
      </div>

      <!-- Trade History + Starting Balance -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:8px;">
        <div>
          <label style="font-size:10px;color:#888;display:block;margin-bottom:2px;">Trade History Count</label>
          <input id="_inp_fs593" value="${fs593Val}" placeholder="e.g. 47" style="width:100%;padding:7px 8px;background:#25253d;border:1px solid #444;color:#fff;border-radius:6px;box-sizing:border-box;font-size:12px;outline:none;">
        </div>
        <div>
          <label style="font-size:10px;color:#888;display:block;margin-bottom:2px;">Starting Balance $</label>
          <input id="_inp_init" type="number" value="${initialBal || ''}" placeholder="e.g. 1000" style="width:100%;padding:7px 8px;background:#25253d;border:1px solid #0faf59;color:#fff;border-radius:6px;box-sizing:border-box;font-size:12px;outline:none;">
        </div>
      </div>

      <!-- Level / Badge selector -->
      <label style="font-size:10px;color:#888;display:block;margin-bottom:4px;">🏅 Account Badge</label>
      <div style="display:flex;gap:5px;margin-bottom:10px;">
        <button id="_lvl_auto" style="flex:1;padding:6px 4px;border-radius:6px;font-size:11px;cursor:pointer;border:2px solid #444;background:transparent;color:#fff;pointer-events:auto;">⚡ Auto</button>
        <button id="_lvl_std"  style="flex:1;padding:6px 4px;border-radius:6px;font-size:11px;cursor:pointer;border:2px solid #444;background:transparent;color:#fff;pointer-events:auto;">✈️ Plane</button>
        <button id="_lvl_pro"  style="flex:1;padding:6px 4px;border-radius:6px;font-size:11px;cursor:pointer;border:2px solid #444;background:transparent;color:#fff;pointer-events:auto;">🏆 Cup</button>
        <button id="_lvl_vip"  style="flex:1;padding:6px 4px;border-radius:6px;font-size:11px;cursor:pointer;border:2px solid #444;background:transparent;color:#fff;pointer-events:auto;">💎 Diamond</button>
      </div>

      <!-- P/L Mode -->
      <label style="font-size:10px;color:#888;display:block;margin-bottom:4px;">Profit / Loss Mode</label>
      <div style="display:flex;gap:6px;margin-bottom:8px;">
        <button id="_btn_mode_auto"
          style="flex:1;padding:7px;border-radius:6px;font-size:11px;font-weight:bold;cursor:pointer;
                 border:2px solid ${!isManual ? '#0faf59' : '#444'};
                 background:${!isManual ? '#0faf59' : 'transparent'};color:#fff;">
          ⚡ Auto (Trades)
        </button>
        <button id="_btn_mode_manual"
          style="flex:1;padding:7px;border-radius:6px;font-size:11px;font-weight:bold;cursor:pointer;
                 border:2px solid ${isManual ? '#0faf59' : '#444'};
                 background:${isManual ? '#0faf59' : 'transparent'};color:#fff;">
          ✏️ Manual
        </button>
      </div>

      <!-- Manual section -->
      <div id="_manual_section" style="display:${isManual ? 'block' : 'none'};margin-bottom:8px;padding:8px;background:#0d0d1a;border-radius:8px;border:1px solid #333;">
        <label style="font-size:10px;color:#888;display:block;margin-bottom:4px;">Amount</label>
        <div style="display:flex;gap:6px;margin-bottom:6px;">
          <button id="_btn_profit" style="flex:1;padding:7px;border:2px solid ${!isLoss ? '#0faf59' : '#444'};background:${!isLoss ? '#0faf59' : 'transparent'};color:#fff;border-radius:6px;cursor:pointer;font-size:12px;font-weight:bold;">✅ Profit</button>
          <button id="_btn_loss"   style="flex:1;padding:7px;border:2px solid ${isLoss ? '#ff432e' : '#444'};background:${isLoss ? '#ff432e' : 'transparent'};color:#fff;border-radius:6px;cursor:pointer;font-size:12px;font-weight:bold;">❌ Loss</button>
        </div>
        <div style="display:flex;gap:6px;align-items:center;">
          <input id="_inp_pnl" type="number" min="0" value="${curPnl}" placeholder="e.g. 250"
            style="flex:1;padding:7px 8px;background:#25253d;border:1px solid ${isLoss ? '#ff432e' : '#0faf59'};color:#fff;border-radius:6px;box-sizing:border-box;font-size:12px;outline:none;">
          <div id="_pnl_preview" style="min-width:70px;text-align:center;font-size:13px;font-weight:bold;padding:7px 4px;background:#25253d;border-radius:6px;color:${isLoss ? '#ff432e' : '#0faf59'}">
            ${curPnl !== '' ? fmtAmt(Number(curPnl)) : '—'}
          </div>
        </div>
      </div>

      <!-- Auto info -->
      <div id="_auto_section" style="display:${!isManual ? 'flex' : 'none'};align-items:flex-start;gap:8px;margin-bottom:8px;padding:8px 10px;background:#0a2010;border:1px solid #0faf5944;border-radius:8px;">
        <span style="font-size:16px;margin-top:1px;">⚡</span>
        <span style="font-size:11px;color:#0faf59;line-height:1.5;">Har trade complete hone par notification se amount auto detect hoga — zero se start</span>
      </div>

      <!-- Progress Bar -->
      <label style="font-size:10px;color:#888;display:block;margin-bottom:2px;">Progress Bar %</label>
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
        <input id="_inp_progress" type="range" min="0" max="100" value="${prog}" style="flex:1;accent-color:#0faf59;cursor:pointer;">
        <span id="_progress_val" style="min-width:34px;text-align:right;font-size:12px;color:#0faf59;font-weight:bold;">${prog}%</span>
      </div>
      <div style="width:100%;height:5px;background:#333;border-radius:3px;margin-bottom:10px;overflow:hidden;">
        <div id="_prog_preview" style="height:5px;border-radius:3px;background:${isLoss ? '#ff432e' : '#0faf59'};width:${prog}%;margin-left:${isLoss ? (100 - prog) + '%' : '0%'};transition:all 0.2s;"></div>
      </div>

      <!-- Auto Patti -->
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;padding:7px 10px;background:#25253d;border-radius:7px;">
        <span style="font-size:11px;color:#ccc;">📊 Auto Patti (profit=green / loss=red)</span>
        <div id="_patti_bg" style="width:36px;height:20px;border-radius:20px;background:${autoPatti ? '#0faf59' : '#444'};position:relative;cursor:pointer;transition:background .3s;flex-shrink:0;">
          <div id="_patti_dot" style="width:14px;height:14px;background:#fff;border-radius:50%;position:absolute;top:3px;left:${autoPatti ? '19px' : '3px'};transition:left .3s;"></div>
        </div>
      </div>

      <button id="_btn_apply" style="width:100%;padding:10px;background:#0faf59;border:none;color:#fff;font-weight:bold;font-size:13px;cursor:pointer;border-radius:8px;">
        ✅ Apply & Save
      </button>
    </div>`;

  document.body.appendChild(overlay);
  document.getElementById('_pos_close').onclick = () => overlay.remove();

  document.getElementById('_btn_reset_session').onclick = () => {
    sessionPnl = 0; saveSessionPnl(); overlay.remove(); updateUI();
  };

  let mode = pnlMode;
  const btnAuto   = document.getElementById('_btn_mode_auto');
  const btnManual = document.getElementById('_btn_mode_manual');
  const manSec    = document.getElementById('_manual_section');
  const autoSec   = document.getElementById('_auto_section');

  function setMode(m) {
    mode = m;
    btnAuto.style.background    = m === 'auto'   ? '#0faf59' : 'transparent';
    btnAuto.style.borderColor   = m === 'auto'   ? '#0faf59' : '#444';
    btnManual.style.background  = m === 'manual' ? '#0faf59' : 'transparent';
    btnManual.style.borderColor = m === 'manual' ? '#0faf59' : '#444';
    manSec.style.display  = m === 'manual' ? 'block' : 'none';
    autoSec.style.display = m === 'auto'   ? 'flex'  : 'none';
  }
  btnAuto.onclick   = () => setMode('auto');
  btnManual.onclick = () => setMode('manual');

  // ── Level / Badge buttons ──
  const KEY_LEVEL   = 'manual_level';
  let selectedLevel = localStorage.getItem(KEY_LEVEL) || 'auto';

  const lvlAuto = document.getElementById('_lvl_auto');
  const lvlStd  = document.getElementById('_lvl_std');
  const lvlPro  = document.getElementById('_lvl_pro');
  const lvlVip  = document.getElementById('_lvl_vip');

  function setLevel(l) {
    selectedLevel = l;
    [lvlAuto, lvlStd, lvlPro, lvlVip].forEach(b => {
      if (b) { b.style.background = 'transparent'; b.style.borderColor = '#444'; }
    });
    const active = l === 'auto' ? lvlAuto : l === 'standart' ? lvlStd : l === 'pro' ? lvlPro : lvlVip;
    if (active) { active.style.background = '#0faf59'; active.style.borderColor = '#0faf59'; }
  }

  setLevel(selectedLevel);

  lvlAuto.addEventListener('click', e => { e.stopPropagation(); setLevel('auto'); });
  lvlStd.addEventListener('click',  e => { e.stopPropagation(); setLevel('standart'); });
  lvlPro.addEventListener('click',  e => { e.stopPropagation(); setLevel('pro'); });
  lvlVip.addEventListener('click',  e => { e.stopPropagation(); setLevel('vip'); });

  let lossMode  = isLoss;
  const pnlInp  = document.getElementById('_inp_pnl');
  const pnlPrev = document.getElementById('_pnl_preview');
  const bProfit = document.getElementById('_btn_profit');
  const bLoss   = document.getElementById('_btn_loss');
  const progPrev = document.getElementById('_prog_preview');

  function setLoss(l) {
    lossMode = l;
    bProfit.style.background  = l ? 'transparent' : '#0faf59';
    bProfit.style.borderColor = l ? '#444'        : '#0faf59';
    bLoss.style.background    = l ? '#ff432e'     : 'transparent';
    bLoss.style.borderColor   = l ? '#ff432e'     : '#444';
    pnlInp.style.borderColor  = l ? '#ff432e'     : '#0faf59';
    pnlPrev.style.color       = l ? '#ff432e'     : '#0faf59';
    const pct = Number(document.getElementById('_inp_progress').value);
    progPrev.style.background = l ? '#ff432e' : '#0faf59';
    progPrev.style.marginLeft = l ? (100 - pct) + '%' : '0%';
  }
  bProfit.onclick = () => setLoss(false);
  bLoss.onclick   = () => setLoss(true);
  pnlInp.addEventListener('input', () => {
    pnlPrev.textContent = fmtAmt(Math.abs(Number(pnlInp.value) || 0));
  });

  const progInp = document.getElementById('_inp_progress');
  const progVal = document.getElementById('_progress_val');
  progInp.addEventListener('input', () => {
    const pct = Number(progInp.value);
    progVal.textContent       = pct + '%';
    progPrev.style.width      = pct + '%';
    progPrev.style.background = lossMode ? '#ff432e' : '#0faf59';
    progPrev.style.marginLeft = lossMode ? (100 - pct) + '%' : '0%';
  });

  let pattiOn    = autoPatti;
  const pattiBg  = document.getElementById('_patti_bg');
  const pattiDot = document.getElementById('_patti_dot');
  pattiBg.onclick = () => {
    pattiOn = !pattiOn;
    pattiBg.style.background = pattiOn ? '#0faf59' : '#444';
    pattiDot.style.left      = pattiOn ? '19px'    : '3px';
  };

  document.getElementById('_btn_apply').onclick = () => {
    const nameVal    = document.getElementById('_inp_name').value.trim() || 'Live';
    const posVal     = document.getElementById('_inp_pos').value.trim();
    const fs593Input = document.getElementById('_inp_fs593').value.trim();
    const initInput  = Number(document.getElementById('_inp_init').value);
    const progPct    = Number(progInp.value);

    if (initInput > 0) { initialBal = initInput; localStorage.setItem(KEY_INIT, initialBal); }
    localStorage.setItem(KEY_LB, JSON.stringify({ name: nameVal }));
    if (posVal) { savedPosition = posVal; localStorage.setItem(KEY_POSITION, posVal); }
    savedProgress = progPct; localStorage.setItem(KEY_PROGRESS, progPct);
    pnlMode = mode; localStorage.setItem(KEY_PNL_MODE, mode);

    // Level save + icon apply
    if (selectedLevel === 'auto') {
      localStorage.removeItem('manual_level');
    } else {
      localStorage.setItem('manual_level', selectedLevel);
      const lvlHref = `/profile/images/spritemap.svg#icon-profile-level-${selectedLevel}`;
      document.querySelectorAll('.h5aTJ svg use, .ePf8T svg use, .lmj_k svg use').forEach(icon => {
        icon.setAttribute('xlink:href', lvlHref);
        icon.setAttribute('href', lvlHref);
      });
    }

    if (mode === 'manual') {
      const absVal = Math.abs(Number(pnlInp.value) || 0);
      manualPnl = lossMode ? -absVal : absVal;
      localStorage.setItem(KEY_PNL, manualPnl);
    }
    if (fs593Input) { savedFs593 = fs593Input; localStorage.setItem(KEY_FS593, fs593Input); }
    if (pattiOn && !autoPatti)      startAutoPatti();
    else if (!pattiOn && autoPatti) stopAutoPatti();

    overlay.remove();
    updateUI();
  };
}

// ─── Deposit button intercept ─────────────────────────────────────
function openInitPopup() {
  if (document.getElementById('live-settings-popup')) return;
  const ub    = safeNum(document.querySelector('.qKWSR, .pVBHU')?.textContent) || 0;
  const modal = document.createElement('div');
  modal.id = 'live-settings-popup';
  modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.9);display:flex;align-items:center;justify-content:center;z-index:999999;backdrop-filter:blur(8px);';
  modal.innerHTML = `
    <div style="background:#1c1c2e;padding:30px;border-radius:15px;width:320px;max-width:90vw;color:#fff;border:1px solid #0faf59;text-align:center;font-family:sans-serif;">
      <h3 style="color:#0faf59;margin-bottom:20px;">Dubai Live Trade</h3>
      <input id="inp-name" placeholder="Display Name" value="Live"
        style="width:100%;padding:12px;margin-bottom:10px;background:#25253d;border:1px solid #444;color:#fff;border-radius:8px;box-sizing:border-box;">
      <input id="inp-init" type="number" placeholder="Starting Balance (e.g. 1000)"
        style="width:100%;padding:12px;margin-bottom:20px;background:#25253d;border:1px solid #0faf59;color:#fff;border-radius:8px;box-sizing:border-box;">
      <button id="btn-save" style="width:100%;padding:14px;background:#0faf59;border:none;color:#fff;font-weight:bold;cursor:pointer;border-radius:8px;">ACTIVATE NOW</button>
    </div>`;
  document.body.appendChild(modal);
  document.getElementById('btn-save').onclick = () => {
    const entered = Number(document.getElementById('inp-init').value);
    initialBal = entered > 0 ? entered : ub;
    localStorage.setItem(KEY_INIT, initialBal);
    localStorage.setItem(KEY_LB, JSON.stringify({ name: document.getElementById('inp-name').value || 'Live' }));
    modal.remove();
    updateUI();
  };
}
document.addEventListener('click', e => {
  if (e.target.closest('a,button') && /deposit/i.test(e.target.textContent)) {
    e.preventDefault(); openInitPopup();
  }
}, true);

// ─── Init ─────────────────────────────────────────────────────────
function init() {
  hideBonusBanner();
  startLineAnimation();
  startTradeObserver();   // notification se trade result detect
  startBalanceTracker();  // loss amount ke liye balance backup
  setTimeout(() => {
    fixUrl();
    hideBonusBanner();
    showFloatingBtn();
    updateUI();
    if (autoPatti) startAutoPatti();
    let n = 0;
    const t = setInterval(() => { hideBonusBanner(); if (++n > 20) clearInterval(t); }, 500);
  }, 1200);
}

// ─── License Check ────────────────────────────────────────────────
(async () => {
  const key = localStorage.getItem(KEY_LICENSE);
  if (!key) { showLicensePopup(); return; }
  try {
    const ctrl = new AbortController();
    const t    = setTimeout(() => ctrl.abort(), 8000);
    const res  = await fetch(`${SCRIPT_URL}?key=${encodeURIComponent(key)}`, { signal: ctrl.signal });
    clearTimeout(t);
    if ((await res.text()).trim() === 'active') { init(); }
    else { localStorage.removeItem(KEY_LICENSE); showLicensePopup(); }
  } catch {
    localStorage.removeItem(KEY_LICENSE); showLicensePopup();
  }
})();

})();
