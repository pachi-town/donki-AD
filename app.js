/* ============================================================
 * ドンキAD MAP  app.js (UI v5)
 *   ・店舗の位置      … スプレッドシート「店舗座標一覧」A〜F列(店舗名・都道府県・カテゴリ・住所・緯度・経度)
 *   ・タップ時の情報  … 「開催状況集計」(更新日・広告実績・施設情報・MAP表示) ※住所で結びつけ、一致しなければ店舗名で結びつけ
 *   ・そのほか        … Prices(商材) / icon(ピン画像) / ヘッダーバナー / 申込期日(任意) / 商材リンク
 * ============================================================ */
const SHEET_ID = '1wo0qLk-eYag_tqp-kZwE6CpNdFACwPWTtFCroxHdk1s';
const PREF_ORDER = ["北海道","青森県","岩手県","宮城県","秋田県","山形県","福島県","茨城県","栃木県","群馬県","埼玉県","千葉県","東京都","神奈川県","新潟県","富山県","石川県","福井県","山梨県","長野県","岐阜県","静岡県","愛知県","三重県","滋賀県","京都府","大阪府","兵庫県","奈良県","和歌山県","鳥取県","島根県","岡山県","広島県","山口県","徳島県","香川県","愛媛県","高知県","福岡県","佐賀県","長崎県","熊本県","大分県","宮崎県","鹿児島県","沖縄県"];
const WIDE_QUERY = '(min-width: 960px)';   
const DEFAULT_VIEW = 'map';   
const PAGE_SIZE = 50;         

function isWide() { return window.matchMedia && window.matchMedia(WIDE_QUERY).matches; }

function showError(msg) { const eb = document.getElementById('error-banner'); if(eb){ eb.innerText = msg; eb.style.display = 'block'; } }

let noticeTimer = null;
function showNotice(msg) {
    let t = document.getElementById('toast');
    if(!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
    t.textContent = msg; t.classList.add('show');
    clearTimeout(noticeTimer); noticeTimer = setTimeout(() => t.classList.remove('show'), 3500);
}

window.onEnterKey = function(e, fn) {
    if(e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return;
    e.preventDefault(); fn();
    if(e.target && e.target.blur) e.target.blur();
};

async function fetchCSV(sheetName) {
    const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}&_t=${new Date().getTime()}`;
    try {
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) return [];
        const text = await res.text();
        if(text.trim().startsWith('<')) return [];
        return parseCSV(text);
    }
    catch (e) { return []; }
}

function parseCSV(str) {
    if(!str) return []; const arr = []; let quote = false; let row = 0, col = 0;
    for (let c = 0; c < str.length; c++) {
        let cc = str[c], nc = str[c+1]; arr[row] = arr[row] || []; arr[row][col] = arr[row][col] || '';
        if (cc == '"' && quote && nc == '"') { arr[row][col] += cc; ++c; continue; }
        if (cc == '"') { quote = !quote; continue; }
        if (cc == ',' && !quote) { ++col; continue; }
        if (cc == '\r' && nc == '\n' && !quote) { ++row; col = 0; ++c; continue; }
        if (cc == '\n' && !quote) { ++row; col = 0; continue; }
        if (cc == '\r' && !quote) { ++row; col = 0; continue; }
        arr[row][col] += cc;
    }
    return arr;
}

function getColIndex(headers, keywords) {
    if(!headers) return -1;
    for (let i = 0; i < headers.length; i++) { if (!headers[i]) continue; for (let kw of keywords) { if (headers[i].includes(kw)) return i; } }
    return -1;
}

function extractPrefAndCity(address) {
    if(!address) return { pref: '', city: '' };
    const regex = /^(東京都|北海道|(?:京都|大阪)府|.{2,3}県)([^市郡]+[市郡]|.*?区|.*?町|.*?村)/;
    const match = address.match(regex);
    if(match) return { pref: match[1], city: match[2] }; return { pref: '', city: '' };
}

function getDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; const dLat = (lat2 - lat1) * Math.PI / 180; const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)); return R * c;
}

function getShortTabName(title) {
    if (!title) return '詳細';
    if (title.includes('手渡し') || title.includes('ポケット')) return 'ティッシュ手渡し';
    if (title.includes('ボックス') || title.includes('BOX')) return 'BOXティッシュ';
    if (title.includes('ポスター')) return 'ポスター';
    if (title.includes('ゲート')) return 'ゲート';
    if (title.includes('ジャック') || title.includes('装飾')) return '店舗ジャック';
    return title.substring(0, 6);
}

const AMP = String.fromCharCode(38);
const ESC_MAP = { '&': AMP + 'amp;', '<': AMP + 'lt;', '>': AMP + 'gt;', '"': AMP + 'quot;', "'": AMP + '#39;' };
function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, c => ESC_MAP[c]); }
function escHtml(v) { return esc(v).replace(/<br\s*\/?[>>]/gi, '<br>').replace(/\n/g, '<br>'); }

function kanjiToNum(s) {
    const map = { '〇': 0, '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9 };
    return String(s).replace(/([〇一二三四五六七八九十]+)(?=条|丁目|番|号)/g, m => {
        if(m.indexOf('十') >= 0) { const [a, b] = m.split('十'); return String((a ? map[a] : 1) * 10 + (b ? map[b] : 0)); }
        return m.split('').map(c => map[c]).join('');
    });
}

function normAddr(s) {
    let t = kanjiToNum(String(s || '').normalize('NFKC').replace(/\s/g, ''));
    t = t.replace(/(\d)[ー‐‑‒–—―−](\d)/g, '$1-$2');
    t = t.replace(/丁目|番地|番/g, '-').replace(/号/g, '');
    return t.replace(/-+/g, '-').replace(/-$/, '');
}

function normText(s) {
    return String(s || '').normalize('NFKC').toLowerCase()
        .replace(/[\u3041-\u3096]/g, c => String.fromCharCode(c.charCodeAt(0) + 0x60))
        .replace(/[\s・･\-]/g, '');
}

let stores = [], products = [], map, icons = {}, activeCategories = [], userLat = null, userLng = null, userMarker = null;
let defaultIconObj = null;
let currentView = DEFAULT_VIEW, listLimit = PAGE_SIZE, pendingMapAction = null, searchOpen = false;
const hiddenAddr = new Set(), hiddenName = new Set(); 
let hiddenCount = 0;
let searchState = { mode: 'none', pref: '', city: '', radius: 0, center: null, keyword: '' };
let centerType = 'current', pickedPoint = null, radiusCircle = null, centerMarker = null, addrCandidates = [];

const PIN_DIR = './images/pin/';
const RAW_BASE = 'https://raw.githubusercontent.com/pachi-town/donki-AD/main/images/pin/';
const CDN_BASE = 'https://cdn.jsdelivr.net/gh/pachi-town/donki-AD@main/images/pin/';
const missingPins = []; 

function makeFallbackIcon() {
    return L.divIcon({
        className: '',
        html: '<div style="width:28px;height:28px;border-radius:50%;background:#facc15;border:3px solid #111;box-shadow:0 2px 6px rgba(0,0,0,.4)"></div>',
        iconSize: [28, 28], iconAnchor: [14, 28], popupAnchor: [0, -28]
    });
}

function canLoadImage(url) {
    return new Promise(resolve => {
        const img = new Image();
        img.onload = () => resolve(true);
        img.onerror = () => resolve(false);
        img.src = url;
    });
}

async function resolvePinIcon(rawUrl) {
    const cleaned = rawUrl.replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
    const fileName = cleaned.split('/').pop();
    const candidates = [cleaned, PIN_DIR + fileName, './' + fileName, './pin/' + fileName, './images/' + fileName, RAW_BASE + fileName, CDN_BASE + fileName];
    for (const url of candidates) {
        if (await canLoadImage(url)) {
            return L.icon({ iconUrl: url, iconSize: [32, 32], iconAnchor: [16, 32], popupAnchor: [0, -32] });
        }
    }
    console.warn('❌ ピン画像が見つかりません:', cleaned, '→ 試した場所:', candidates);
    missingPins.push(fileName);
    return makeFallbackIcon();
}

async function initApp() {
    try {
        const [coordsData, statusData, pricesData, iconData, bannerData, deadlineData, guideData, linkData] = await Promise.all([
            fetchCSV('店舗座標一覧'), fetchCSV('開催状況集計'), fetchCSV('Prices'), fetchCSV('icon'), fetchCSV('ヘッダーバナー'), fetchCSV('申込期日'), fetchCSV('説明文'), fetchCSV('商材リンク')
        ]);
        window.__GUIDES = parseGuideSheet(guideData); 
        if(coordsData.length === 0) showError("⚠️ 店舗データが取得できませんでした。");

        // --- ヘッダーバナー ---
        if(bannerData && bannerData.length > 1) {
            const bannerUrl = bannerData[1][0]; const bannerLink = bannerData[1][1];
            if(bannerUrl) {
                const img = document.getElementById('header-banner');
                if(img){ img.src = bannerUrl.trim(); img.style.display = 'block'; if(bannerLink) img.onclick = () => window.open(bannerLink, '_blank'); }
            }
        }

        // --- 商材リンク (ハンバーガーメニュー用) ---
        window.toggleMenu = function() {
            const menu = document.getElementById('dropdown-menu');
            const overlay = document.getElementById('menu-overlay');
            if(menu && overlay) {
                const isShowing = menu.classList.contains('show');
                menu.classList.toggle('show', !isShowing);
                overlay.classList.toggle('show', !isShowing);
            }
        };
        if(linkData && linkData.length > 1) {
            const menu = document.getElementById('dropdown-menu');
            if(menu) {
                let html = '';
                for(let i=1; i<linkData.length; i++) {
                    const img = (linkData[i][0] || '').trim();
                    const url = (linkData[i][1] || '').trim();
                    const name = (linkData[i][2] || '他ツール').trim(); // C列を名称として読み込む
                    if(url) {
                        html += `<a href="${url}" target="_blank" class="dropdown-item">
                            ${img ? `<img src="${img}" class="dropdown-icon" alt="">` : ''}
                            <span>${esc(name)}</span>
                        </a>`;
                    }
                }
                menu.innerHTML = html;
            }
        }

        // --- Icon ---
        if(iconData && iconData.length > 1) {
            await Promise.all(iconData.slice(1).map(async row => {
                if(!(row[0] && row[1])) return;
                const catName = row[0].trim();
                const iconObj = await resolvePinIcon(row[1]);
                icons[catName] = iconObj;
                if (catName === '専門店') { defaultIconObj = iconObj; }
            }));
        }
        if (missingPins.length > 0) {
            showError("⚠ ピン画像が見つかりません: " + [...new Set(missingPins)].join(', ') + "(GitHubの images/pin を確認)");
        }
        if (!defaultIconObj && Object.keys(icons).length > 0) { defaultIconObj = icons[Object.keys(icons)[0]]; }

        // --- Prices ---
        if(pricesData && pricesData.length > 0) {
            let pHead = pricesData[0];
            let startIdx = 1;
            for(let i=0; i<Math.min(5, pricesData.length); i++) {
                if(pricesData[i].join('').includes('商材名')) { pHead = pricesData[i]; startIdx = i + 1; break; }
            }
            const pTitle = getColIndex(pHead, ['商材名']) !== -1 ? getColIndex(pHead, ['商材名']) : 0;
            const pOpt = getColIndex(pHead, ['数量']) !== -1 ? getColIndex(pHead, ['数量']) : 1;
            const pPrice = getColIndex(pHead, ['料金']) !== -1 ? getColIndex(pHead, ['料金']) : 2;
            const pNote = getColIndex(pHead, ['増減額', 'デザイン']) !== -1 ? getColIndex(pHead, ['増減額', 'デザイン']) : 3;
            const pPoint = getColIndex(pHead, ['POINT']) !== -1 ? getColIndex(pHead, ['POINT']) : 4;
            const pImg = getColIndex(pHead, ['画像URL', '画像']) !== -1 ? getColIndex(pHead, ['画像URL', '画像']) : 5;

            let currentProd = null;
            for(let i=startIdx; i<pricesData.length; i++) {
                const row = pricesData[i];
                if(!row || !row[pTitle]) continue;
                if(!currentProd || currentProd.title !== row[pTitle]) {
                    currentProd = { title: row[pTitle], point: (row[pPoint] || ''), imageUrl: row[pImg] ? row[pImg].trim() : '', options: [] };
                    products.push(currentProd);
                }
                currentProd.options.push({ label: (row[pOpt] || ''), price: (row[pPrice] || ''), note: (row[pNote] || '') });
            }
        }
        if(products.length === 0) {
            products = [{ title: 'データがありません', point: '', imageUrl: '', options: [{label: '-', price: '-', note: '-'}] }];
        }

        // --- 開催状況集計 ---
        const statusByAddr = {}, statusByName = {};
        if(statusData && statusData.length > 0) {
            const stHead = statusData[0];
            const aCol = getColIndex(stHead, ['住所']);
            const uCol = getColIndex(stHead, ['更新日']);
            const pCol = getColIndex(stHead, ['ポスター']);
            const rCol = getColIndex(stHead, ['ポケットティッシュ']);
            const tCol = getColIndex(stHead, ['ボックスティッシュ']);
            const gCol1 = getColIndex(stHead, ['防犯ゲート']);
            const gCol2 = getColIndex(stHead, ['インパクトゲート']);
            const jCol = getColIndex(stHead, ['店舗内装飾ジャック']);
            const unCol = getColIndex(stHead, ['施設情報']);
            const nmCol = getColIndex(stHead, ['店舗名']);
            const showCol = getColIndex(stHead, ['MAP表示']);   

            for(let i=1; i<statusData.length; i++) {
                const row = statusData[i];
                const addr = aCol !== -1 ? (row[aCol] || '').trim() : '';
                const nm = nmCol !== -1 ? (row[nmCol] || '').trim() : '';
                if (showCol !== -1 && isOffValue(row[showCol])) {
                    if (addr) hiddenAddr.add(normAddr(addr));
                    if (nm) hiddenName.add(nm);
                }
                const stat = {
                    updatedAt: uCol !== -1 ? (row[uCol] || '') : '',
                    poster: pCol !== -1 ? (row[pCol] || 'ー') : 'ー',
                    register: rCol !== -1 ? (row[rCol] || 'ー') : 'ー',
                    tissue: tCol !== -1 ? (row[tCol] || 'ー') : 'ー',
                    gate: (gCol2 !== -1 && row[gCol2]) ? row[gCol2] : ((gCol1 !== -1 && row[gCol1]) ? row[gCol1] : 'ー'),
                    jack: jCol !== -1 ? (row[jCol] || 'ー') : 'ー',
                    unavailable: unCol !== -1 ? (row[unCol] || '') : ''
                };
                if(addr) statusByAddr[normAddr(addr)] = stat;
                if(nm) statusByName[nm] = stat;
            }
        }
        const emptyStat = { updatedAt: '', poster: 'ー', register: 'ー', tissue: 'ー', gate: 'ー', jack: 'ー', unavailable: '' };

        // --- 店舗座標一覧 ---
        if(coordsData && coordsData.length > 0) {
            const coHead = coordsData[0];
            const cNameCol = getColIndex(coHead, ['店舗名']); const cCatCol = getColIndex(coHead, ['カテゴリ']);
            const cAddrCol = getColIndex(coHead, ['住所']); const cLatCol = getColIndex(coHead, ['緯度']); const cLngCol = getColIndex(coHead, ['経度']);

            for(let i=1; i<coordsData.length; i++) {
                const row = coordsData[i];
                const addr = cAddrCol !== -1 ? (row[cAddrCol] || '').trim() : '';
                if(!addr || cLatCol === -1 || cLngCol === -1 || !row[cLatCol] || !row[cLngCol]) continue;
                const storeName = cNameCol !== -1 ? String(row[cNameCol] || '').trim() : '';
                if (hiddenAddr.has(normAddr(addr)) || hiddenName.has(storeName)) { hiddenCount++; continue; } 

                const stat = statusByAddr[normAddr(addr)] || statusByName[storeName] || emptyStat;
                const locInfo = extractPrefAndCity(addr);

                let catName = cCatCol !== -1 ? (row[cCatCol] || '').trim() : '';
                if (catName && !icons[catName]) { catName = '専門店'; }

                stores.push({
                    idx: stores.length, name: storeName, category: catName, address: addr,
                    pref: locInfo.pref, city: locInfo.city, lat: parseFloat(row[cLatCol]), lng: parseFloat(row[cLngCol]),
                    updatedAt: stat.updatedAt, unavailable: stat.unavailable,
                    records: { tissue: stat.tissue, poster: stat.poster, gate: stat.gate, register: stat.register, jack: stat.jack },
                    searchText: normText(storeName + ' ' + addr + ' ' + catName), marker: null
                });
            }
        }
        if(stores.length === 0) {
            showError(`⚠ 表示できる店舗が0件です(座標シート:${coordsData.length}行 / 開催状況:${statusData.length}行 / MAP表示OFFで除外:${hiddenCount}件)`);
        }

        initMap();
        initSearchUI();
        initProductZone();                 
        renderWarn();                      
        applyResponsiveDefaults();         
        if(window.matchMedia) { const mq = window.matchMedia(WIDE_QUERY); if(mq.addEventListener) mq.addEventListener('change', applyResponsiveDefaults); else if(mq.addListener) mq.addListener(applyResponsiveDefaults); }
        renderDeadlines(deadlineData);     
        filterMap();                       
        setView(DEFAULT_VIEW, false);      
        getUserLocation(true);

    } catch(err) { console.error(err); showError("⚠️ システムエラーが発生しました。"); }
    finally { if(window.hideLoading) window.hideLoading(); }
}

function isOffValue(v) {
    const t = String(v == null ? '' : v).trim().toUpperCase();
    return ['OFF', '非表示'].includes(t);
}

function recordBadge(v, size = 28) {
    const t = (v || '').toString().trim();
    if(['○', '◯', '〇', 'o', 'O'].includes(t)) {
        return `<span class="rec-badge" aria-label="OK"><svg viewBox="0 0 24 24" width="${size}" height="${size}"><circle cx="12" cy="12" r="8.5" fill="none" stroke="#16a34a" stroke-width="3.2"/></svg></span>`;
    }
    if(['×', '✕', '✖', 'x', 'X'].includes(t)) {
        return `<span class="rec-badge" aria-label="NG"><svg viewBox="0 0 24 24" width="${size}" height="${size}"><path d="M5.5 5.5 L18.5 18.5 M18.5 5.5 L5.5 18.5" stroke="#dc2626" stroke-width="3.4" stroke-linecap="round" fill="none"/></svg></span>`;
    }
    if(t === '' || ['ー', '-', '―', '—', '－'].includes(t)) return '<span class="rec-badge rec-none">ー</span>';
    return `<span class="rec-badge rec-other">${esc(t)}</span>`;
}

function initMap() {
    map = L.map('map', { doubleClickZoom: true, tap: false }).setView([35.6895, 139.6917], 5);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(map);

    map.on('click', () => { if(searchOpen && !isWide()) toggleSearch(); });
    map.on('dragstart', () => { if(searchOpen && !isWide()) toggleSearch(); });
    if(window.ResizeObserver) { new ResizeObserver(() => { if(map) map.invalidateSize(); }).observe(document.getElementById('map-container')); }
    map.on('popupopen', () => setTimeout(() => {
        const pop = document.querySelector('.leaflet-popup'); if(!pop) return;
        const pr = pop.getBoundingClientRect(), mr = map.getContainer().getBoundingClientRect();
        const over = mr.top + 10 - pr.top;
        if(over > 0) map.panBy([0, -over]);
    }, 500));

    const bounds = [];
    stores.forEach(store => {
        if(isNaN(store.lat) || isNaN(store.lng)) return;
        let targetIcon = icons[store.category];
        if (!targetIcon && defaultIconObj) { targetIcon = defaultIconObj; }
        const mOpt = targetIcon ? { icon: targetIcon } : {};
        const iconSrc = (targetIcon && targetIcon.options && targetIcon.options.iconUrl) ? targetIcon.options.iconUrl : '';
        const marker = L.marker([store.lat, store.lng], mOpt).addTo(map);
        store.marker = marker; bounds.push([store.lat, store.lng]);

        const isUnav = store.unavailable !== ''; const dateText = store.updatedAt ? store.updatedAt : '未実施';
        marker.bindPopup(`
            <div class="popup-header">${iconSrc ? `<img class="popup-icon" src="${iconSrc}" alt="">` : ''}<span>${esc(store.name)}</span></div>
            <div class="popup-body">
                <div class="popup-addr">${esc(store.address)}</div>
                <div class="status-row"><span class="text-gray-500">更新日</span><span class="font-bold bg-gray-100 px-2 rounded">${esc(dateText)}</span></div>
                ${isUnav ? `<div class="unavailable-block"><div class="unavailable-stamp">掲載不可<br>(施設都合上)</div></div>` : `
                <div class="mt-3 mb-1 text-xs font-bold text-gray-400">過去の広告実績</div>
                <div class="status-grid">
                    <div class="status-item"><span>BOXティッシュ</span> ${recordBadge(store.records.tissue)}</div>
                    <div class="status-item"><span>A1ポスター</span> ${recordBadge(store.records.poster)}</div>
                    <div class="status-item"><span>ゲート</span> ${recordBadge(store.records.gate)}</div>
                    <div class="status-item"><span>手渡し配布</span> ${recordBadge(store.records.register)}</div>
                    <div class="status-item"><span>装飾ジャック</span> ${recordBadge(store.records.jack)}</div>
                </div>
                `}
            </div>`);
    });
    if(bounds.length > 0) map.fitBounds(bounds, { padding: [50, 50] });
}

function getUserLocation(isInit = false) {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
        (pos) => {
            userLat = pos.coords.latitude; userLng = pos.coords.longitude;
            if(userMarker) map.removeLayer(userMarker);

            const userIcon = L.divIcon({ className: 'custom-user-marker', html: '<div class="user-pulse"></div>', iconSize: [20, 20], iconAnchor: [10, 10] });
            userMarker = L.marker([userLat, userLng], {icon: userIcon}).addTo(map).bindPopup("<b style='font-size:12px;'>現在地</b>");

            const z = isInit ? 10 : 12; runOnMap(() => map.setView([userLat, userLng], z));

            // 初回GPS取得時（かつ検索をしていない場合）、現在地の都道府県・市区町村で自動絞り込み
            if (isInit && searchState.mode === 'none') {
                let closest = null, minDist = Infinity;
                stores.forEach(s => {
                    if (s.unavailable !== '') return;
                    let d = getDistance(userLat, userLng, s.lat, s.lng);
                    if (d < minDist) { minDist = d; closest = s; }
                });
                if (closest) {
                    const pSel = document.getElementById('pref-select');
                    const cSel = document.getElementById('city-select');
                    if (pSel) pSel.value = closest.pref;
                    updateCities(); 
                    if (cSel && closest.city) {
                        const opts = Array.from(cSel.options).map(o => o.value);
                        if(opts.includes(closest.city)) cSel.value = closest.city;
                    }
                    
                    searchState = { mode: 'region', pref: closest.pref, city: cSel ? cSel.value : '', radius: 0, center: null, keyword: '' };
                    setSearchMode('region'); // 検索タブも連動させる
                    showNotice(`現在地を元に「${closest.pref} ${cSel ? cSel.value : ''}」の店舗を表示しています`);
                }
            } else if (searchState.mode === 'radius' && searchState.center && searchState.center.type === 'current') {
                searchState.center = { lat: userLat, lng: userLng, label: '現在地', type: 'current' }; drawRadiusOverlay();
            }

            filterMap();
            updateCenterLabel();
        },
        (err) => { console.warn("位置取得に失敗しました"); updateCenterLabel(); }
    );
}

window.recenterMap = function() {
    if(userLat && userLng) { map.setView([userLat, userLng], 12); } else { getUserLocation(false); }
}

function initSearchUI() {
    const rawPrefs = [...new Set(stores.map(s => s.pref).filter(Boolean))];
    rawPrefs.sort((a, b) => { let ia = PREF_ORDER.indexOf(a); let ib = PREF_ORDER.indexOf(b); if(ia === -1) ia = 999; if(ib === -1) ib = 999; return ia - ib; });
    const pSel = document.getElementById('pref-select');
    if(pSel) { rawPrefs.forEach(p => { const opt = document.createElement('option'); opt.value = p; opt.textContent = p; pSel.appendChild(opt); }); }

    const chips = document.getElementById('radius-chips');
    if(chips) { chips.innerHTML = [1, 3, 5, 10, 20, 50].map(km => `<span class="cat-chip" onclick="setRadiusValue(${km})">${km}km</span>`).join(''); }

    const catCont = document.getElementById('category-filters');
    const cats = [...new Set(stores.map(s => s.category).filter(Boolean))];
    activeCategories = [...cats];
    if(catCont) {
        catCont.innerHTML = '';
        const allBtn = document.createElement('span');
        allBtn.className = 'cat-all';
        allBtn.textContent = 'すべて選択';
        allBtn.onclick = () => { activeCategories = [...cats]; renderCategoryButtons(); filterMap(); };
        catCont.appendChild(allBtn);

        function renderCategoryButtons() {
            while (catCont.childNodes.length > 1) { catCont.removeChild(catCont.lastChild); }
            cats.forEach(cat => {
                const span = document.createElement('span');
                const isActive = activeCategories.includes(cat);
                span.className = isActive ? 'cat-chip active' : 'cat-chip';
                span.textContent = cat;
                span.onclick = () => {
                    if(isActive) { activeCategories = activeCategories.filter(c => c !== cat); }
                    else { activeCategories.push(cat); }
                    renderCategoryButtons(); filterMap();
                };
                catCont.appendChild(span);
            });
        }
        renderCategoryButtons();

        window.resetFilters = function() {
            ['radius-input', 'keyword-input', 'addr-input'].forEach(id => { const el = document.getElementById(id); if(el) el.value = ''; });
            const pSel2 = document.getElementById('pref-select'); if(pSel2) pSel2.value = '';
            updateCities();
            const unav = document.getElementById('show-unavailable'); if(unav) unav.checked = true;
            pickedPoint = null; addrCandidates = []; renderAddrResults(); setCenterType('current');
            searchState = { mode: 'none', pref: '', city: '', radius: 0, center: null, keyword: '' };
            clearRadiusOverlay();
            activeCategories = [...cats];
            renderCategoryButtons();
            catCont.scrollLeft = 0;
            filterMap();
            runOnMap(() => { if(userLat && userLng) { map.setView([userLat, userLng], 10); } else { fitStores(stores); } });
        };
    }
    updateCenterLabel(); updateSummary();
}

window.updateCities = function() {
    const pSel = document.getElementById('pref-select'); const cSel = document.getElementById('city-select');
    if(!pSel || !cSel) return;
    const sPref = pSel.value; cSel.innerHTML = '<option value="">市区町村を選択</option>';
    if(sPref) {
        const cities = [...new Set(stores.filter(s => s.pref === sPref).map(s => s.city).filter(Boolean))];
        cities.sort((a, b) => a.localeCompare(b, 'ja'));
        cities.forEach(c => { const opt = document.createElement('option'); opt.value = c; opt.textContent = c; cSel.appendChild(opt); });
    }
}

window.setSearchMode = function(mode) {
    ['region', 'radius', 'keyword'].forEach(m => {
        const b = document.getElementById('mode-' + m), p = document.getElementById('pane-' + m);
        if(b) b.classList.toggle('active', m === mode); if(p) p.classList.toggle('view-hidden', m !== mode);
    });
}

window.setCenterType = function(type) {
    centerType = type;
    const bc = document.getElementById('center-current'), bp = document.getElementById('center-point-btn'), box = document.getElementById('center-point');
    if(bc) bc.classList.toggle('active', type === 'current'); if(bp) bp.classList.toggle('active', type === 'point');
    if(box) box.classList.toggle('view-hidden', type !== 'point');
    updateCenterLabel();
}

function updateCenterLabel() {
    const el = document.getElementById('center-label'); if(!el) return;
    if(centerType === 'current') {
        el.textContent = (userLat !== null) ? '基準: 現在地' : '基準: 現在地(位置情報を取得できていません)';
    } else {
        el.textContent = pickedPoint ? `基準: ${pickedPoint.label}` : '基準: 住所などを検索して、地点を選んでください';
    }
}

window.setRadiusValue = function(km) { const el = document.getElementById('radius-input'); if(el) el.value = km; }

window.searchAddress = async function() {
    const q = (document.getElementById('addr-input')?.value || '').trim();
    if(!q) { showNotice('住所や駅名などを入力してください'); return; }
    const box = document.getElementById('addr-results');
    if(box) box.innerHTML = '<div class="addr-msg">検索中…</div>';
    let list = [];
    try {
        const r = await fetch('https://msearch.gsi.go.jp/address-search/AddressSearch?q=' + encodeURIComponent(q));
        if(r.ok) {
            const j = await r.json();
            list = (j || []).slice(0, 6).map(f => ({ lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0], label: (f.properties && f.properties.title) || q }));
        }
    } catch(e) { }
    if(list.length === 0) {
        try {
            const r = await fetch('https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&countrycodes=jp&accept-language=ja&q=' + encodeURIComponent(q));
            if(r.ok) {
                const j = await r.json();
                list = (j || []).map(f => ({ lat: parseFloat(f.lat), lng: parseFloat(f.lon), label: (f.display_name || q).split(',').slice(0, 3).reverse().join(' ').trim() }));
            }
        } catch(e) { }
    }
    addrCandidates = list; renderAddrResults(list.length === 0 ? '見つかりませんでした。別の書き方(市区町村名から等)をお試しください' : '');
}

function renderAddrResults(msg) {
    const box = document.getElementById('addr-results'); if(!box) return;
    if(msg) { box.innerHTML = `<div class="addr-msg">${esc(msg)}</div>`; return; }
    box.innerHTML = addrCandidates.map((c, i) => `<button type="button" class="addr-item" onclick="pickAddress(${i})">📍 ${esc(c.label)}</button>`).join('');
}

window.pickAddress = function(i) {
    const c = addrCandidates[i]; if(!c) return;
    pickedPoint = { lat: c.lat, lng: c.lng, label: c.label, type: 'point' };
    addrCandidates = []; renderAddrResults(); updateCenterLabel();
    setCenterMarker(pickedPoint);
    runOnMap(() => map.setView([c.lat, c.lng], 13));
    showNotice('地点を選びました。半径を入力して「検索」を押してください');
}

function setCenterMarker(c) {
    if(centerMarker) { map.removeLayer(centerMarker); centerMarker = null; }
    if(!c || c.type !== 'point') return;
    const icon = L.divIcon({ className: '', html: '<div class="center-pin"></div>', iconSize: [22, 22], iconAnchor: [11, 11] });
    centerMarker = L.marker([c.lat, c.lng], { icon, interactive: false }).addTo(map);
}

function drawRadiusOverlay() {
    if(radiusCircle) { map.removeLayer(radiusCircle); radiusCircle = null; }
    const st = searchState; if(st.mode !== 'radius' || !st.center) return;
    radiusCircle = L.circle([st.center.lat, st.center.lng], { radius: st.radius * 1000, color: '#eab308', weight: 2, fillColor: '#facc15', fillOpacity: 0.12, interactive: false }).addTo(map);
    setCenterMarker(st.center);
}

function clearRadiusOverlay() {
    if(radiusCircle) { map.removeLayer(radiusCircle); radiusCircle = null; }
    if(centerMarker) { map.removeLayer(centerMarker); centerMarker = null; }
}

function fitStores(list, extraPoint) {
    const pts = list.filter(s => !isNaN(s.lat) && !isNaN(s.lng)).map(s => [s.lat, s.lng]);
    if(extraPoint) pts.push(extraPoint);
    if(pts.length > 0) map.fitBounds(pts, { padding: [50, 50], maxZoom: 15 });
}

function finishSearch(fitFn, emptyMsg) {
    filterMap();
    const visible = stores.filter(isStoreVisible);
    if(visible.length === 0 && emptyMsg) showNotice(emptyMsg);
    if(fitFn) runOnMap(fitFn);
    if(searchOpen && !isWide()) toggleSearch();
    scrollToToggle();
}

window.applyRegion = function() {
    const pref = document.getElementById('pref-select')?.value || '', city = document.getElementById('city-select')?.value || '';
    ['radius-input', 'keyword-input', 'addr-input'].forEach(id => { const el = document.getElementById(id); if(el) el.value = ''; });
    pickedPoint = null; addrCandidates = []; renderAddrResults(); setCenterType('current');
    clearRadiusOverlay();
    searchState = { mode: (pref || city) ? 'region' : 'none', pref, city, radius: 0, center: null, keyword: '' };
    finishSearch(() => fitStores(stores.filter(isStoreVisible)), '条件に合う店舗がありません');
}

window.applyRadius = function() {
    const km = parseFloat(document.getElementById('radius-input')?.value || '');
    if(!(km > 0)) { showNotice('半径(km)を入力してください'); return; }
    let center = null;
    if(centerType === 'current') {
        if(userLat === null) { showNotice('現在地を取得できていません。「地点を指定」をお使いください'); getUserLocation(false); return; }
        center = { lat: userLat, lng: userLng, label: '現在地', type: 'current' };
    } else {
        if(!pickedPoint) { showNotice('先に住所などを検索して、地点を選んでください'); return; }
        center = pickedPoint;
    }
    const pSel = document.getElementById('pref-select'); if(pSel) pSel.value = ''; updateCities();
    const kw = document.getElementById('keyword-input'); if(kw) kw.value = '';
    searchState = { mode: 'radius', pref: '', city: '', radius: km, center, keyword: '' };
    drawRadiusOverlay();
    finishSearch(() => { if(radiusCircle) map.fitBounds(radiusCircle.getBounds(), { padding: [30, 30] }); }, `半径${km}km以内に店舗がありません`);
}

window.applyKeyword = function() {
    const kw = (document.getElementById('keyword-input')?.value || '').trim();
    const pSel = document.getElementById('pref-select'); if(pSel) pSel.value = ''; updateCities();
    ['radius-input', 'addr-input'].forEach(id => { const el = document.getElementById(id); if(el) el.value = ''; });
    pickedPoint = null; addrCandidates = []; renderAddrResults(); setCenterType('current');
    clearRadiusOverlay();
    searchState = { mode: kw ? 'keyword' : 'none', pref: '', city: '', radius: 0, center: null, keyword: kw };
    finishSearch(() => fitStores(stores.filter(isStoreVisible)), '条件に合う店舗がありません');
}

function updateSummary() {
    const el = document.getElementById('search-summary'); if(!el) return;
    const st = searchState;
    let t = '全国の店舗';
    if(st.mode === 'region') t = [st.pref, st.city].filter(Boolean).join(' ');
    if(st.mode === 'radius') t = `${st.center.label} から ${st.radius}km以内`;
    if(st.mode === 'keyword') t = `「${st.keyword}」`;
    el.textContent = t;
}

function isStoreVisible(s) {
    const st = searchState;
    if(!activeCategories.includes(s.category)) return false;
    const elUnav = document.getElementById('show-unavailable');
    if(elUnav && !elUnav.checked && s.unavailable !== '') return false;
    if(st.mode === 'region') {
        if(st.pref && s.pref !== st.pref) return false;
        if(st.city && s.city !== st.city) return false;
    } else if(st.mode === 'radius' && st.center) {
        if(getDistance(st.center.lat, st.center.lng, s.lat, s.lng) > st.radius) return false;
    } else if(st.mode === 'keyword') {
        const tokens = st.keyword.split(/[\s\u3000]+/).map(normText).filter(Boolean);
        if(!tokens.every(t => s.searchText.includes(t))) return false;
    }
    return true;
}

window.filterMap = function() {
    stores.forEach(s => {
        if(!s.marker) return;
        const v = isStoreVisible(s);
        if(v) { if(!map.hasLayer(s.marker)) s.marker.addTo(map); } else { if(map.hasLayer(s.marker)) map.removeLayer(s.marker); }
    });
    updateSummary();
    renderStoreList(true);
}

function toggleSearch() {
    searchOpen = !searchOpen; const panel = document.getElementById('search-contents'), chev = document.getElementById('search-chevron');
    if(panel) panel.classList.toggle('view-hidden', !searchOpen);
    if(chev) chev.style.transform = searchOpen ? 'rotate(180deg)' : 'rotate(0deg)';
}

function applyResponsiveDefaults() {
    const wide = isWide();
    ['start-acc', 'price-acc'].forEach(id => { const d = document.getElementById(id); if(d) d.open = wide; });
    document.querySelectorAll('#product-content details, #start-content details').forEach(d => { d.open = wide; });
    if(searchOpen !== wide) toggleSearch();
}

function renderWarn() {
    const box = document.getElementById('warn-content'); if(!box) return;
    const G = window.__GUIDES || { common: { warning: [] } };
    const lines = G.common.warning.length ? G.common.warning : [GUIDE_NOTICE];
    box.innerHTML = lines.map(w => `<div class="g-warn-line">${guideText(w)}</div>`).join('');
}

const PROD_ICONS = {
    box: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 11h16v8.2a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z"/><path d="M9 11c-.6-2.6.8-4.6 3-6 2.2 1.4 3.6 3.4 3 6"/><path d="M8.5 15h7"/></svg>',
    poster: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="3" width="12" height="18" rx="1.5"/><path d="M9 7.5h6M9 11h6M9 14.5h3.5"/></svg>',
    gate: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M5 21V4M19 21V4M5 4h14"/><rect x="8" y="8.5" width="8" height="6" rx="1"/><path d="M8 18h8"/></svg>',
    pocket: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="7" y="4" width="10" height="16" rx="2"/><path d="M7 8.5h10"/><path d="M10.5 13h3"/></svg>',
    jack: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 9.5 6 4h12l1.5 5.5"/><path d="M5 9.5V20h14V9.5"/><path d="M4.5 9.5a2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 5 0"/><path d="M10 20v-5h4v5"/></svg>',
    other: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h8l8 8-8 8-8-8z"/><circle cx="8.5" cy="8.5" r="1.2"/></svg>'
};
const PROD_LABELS = { box: 'BOX<br>ティッシュ', pocket: 'ティッシュ<br>手渡し', jack: '店舗<br>ジャック', poster: 'ポスター', gate: 'ゲート' };

function prodTabHtml(p) {
    const kind = productKind(p.title), item = guideItemFor(p);
    const ico = (item && item.icon) ? `<img src="${esc(item.icon)}" alt="">` : (PROD_ICONS[kind] || PROD_ICONS.other);
    const label = PROD_LABELS[kind] || esc(getShortTabName(p.title));
    return `<span class="pt-ico">${ico}</span><span class="pt-lb">${label}</span>`;
}

function initProductZone() {
    const tabs = document.getElementById('product-tabs'); if(!tabs) return;
    tabs.innerHTML = '';
    tabs.classList.toggle('many', products.length > 5); 
    products.forEach((p, i) => {
        const t = document.createElement('div'); t.className = `prod-tab ${i === 0 ? 'active' : ''}`;
        t.innerHTML = prodTabHtml(p);
        t.onclick = () => selectTab(i); tabs.appendChild(t);
    });
    if(products.length > 0) renderProductContent(0);
}

function selectTab(index) {
    document.querySelectorAll('.prod-tab').forEach((t, i) => { t.className = `prod-tab ${i === index ? 'active' : ''}`; });
    renderProductContent(index);
}

function renderProductContent(index) {
    const prod = products[index]; if(!prod) return;
    const P = buildGuideParts(prod);
    const wide = isWide();

    const sum = document.getElementById('start-summary');
    if(sum) sum.innerHTML = `<div class="start-sum">
        <div class="start-sum-title">申請スケジュール<small>(本日:${fmtJP(P.sc.today)})</small></div>
        <div class="start-sum-line">最短掲載開始日:<b>${fmtJPFull(P.sc.start)}</b>以降</div></div>`;
    const startBox = document.getElementById('start-content');
    if(startBox) startBox.innerHTML = `<div class="start-grid${P.ruleHtml ? '' : ' single'}">
        <div class="sg-col">${P.timeline}
            <div class="hs-note">※日程は目安です。実際の日程は、店舗と相談して決定します</div>
            <details class="g-accordion g-supp"${wide ? ' open' : ''}><summary>補足・注意点</summary><div class="g-acc-content">${P.suppHtml}</div></details></div>
        ${P.ruleHtml ? `<div class="sg-col"><div class="sg-h">期日などの基本ルール</div>${P.ruleHtml}</div>` : ''}</div>`;

    const sub = document.getElementById('price-summary'); if(sub) sub.textContent = prod.title || '';
    const content = document.getElementById('product-content');
    if(content) {
        const optsHtml = prod.options.map((opt, i) => `<option value="${i}">${esc(opt.label)}</option>`).join('');
        content.innerHTML = `<div class="price-grid">
            <div class="pg-main">
                <h2 class="text-[17px] font-bold mb-4 leading-snug text-gray-800">${esc(prod.title || '')}</h2>
                ${prod.imageUrl ? `<img src="${esc(prod.imageUrl)}" class="product-image" alt="画像" onerror="this.style.display='none'">` : ''}
                <div class="bg-yellow-50 p-3.5 rounded-lg border border-yellow-200 mb-5"><span class="bg-yellow-400 text-xs font-bold px-2.5 py-1 rounded">POINT</span><p class="text-sm mt-2 text-gray-700">${escHtml(prod.point || '')}</p></div>
            </div>
            <div class="pg-price border border-gray-200 rounded-xl p-4 bg-white shadow-sm">
                <label class="text-xs text-gray-500 font-bold mb-2 block">数量・期間を選択</label>
                <select id="lot-select" class="stylish-select w-full mb-4 bg-gray-50" onchange="updatePrice(${index}, this.value)">${optsHtml}</select>
                <div class="bg-gray-50 p-4 rounded-lg border border-gray-100">
                    <div class="text-xs text-gray-500 font-bold mb-1">料金</div>
                    <div class="text-3xl font-bold mb-2 text-gray-900">
                        <span id="price-display">${esc(prod.options[0]?.price || '')}</span>
                        <span class="text-sm font-normal text-gray-500">（税別）</span>
                    </div>
                    <div class="text-xs text-red-500 font-bold" id="note-display">${esc(prod.options[0]?.note || '')}</div>
                </div>
            </div></div>
            <details class="g-accordion g-spec"${wide ? ' open' : ''}><summary>${esc(P.name)} の仕様・注意事項</summary><div class="g-acc-content">${P.specHtml}</div></details>`;
    }
}

window.updatePrice = function(pIdx, oIdx) {
    const opt = products[pIdx].options[oIdx];
    if(opt){
        const pDisp = document.getElementById('price-display'); const nDisp = document.getElementById('note-display');
        if(pDisp) pDisp.innerText = opt.price; if(nDisp) nDisp.innerText = opt.note;
    }
}

const GUIDE_NOTICE = '店舗単位での都度確認になりますので「掲載可能店舗一覧」等のご用意はありません。希望実施ドンキ店舗を必ず選択してご依頼下さい。';
const CONFIRM_BDAYS = 5; 

const GUIDE_DEFAULTS = {
    poster: { name: 'A1ポスター', matDays: 21, lead: '約3週間', matText: '開催日の3週間前', matShort: '開催日の3週間前', startDays: [1, 16],
        sections: [
            { h: '掲示について', items: [
                '基本的に掲載開始日は毎月1日、16日でお願いします',
                '掲示場所の指定はできません。お客様の導線ではない場所や、他のポスターと同じ場所に掲載される場合があります。希望があれば、事前に掲示予定場所のお写真をお送りします(お時間をいただきます)',
                '掲示タイミングは、開始日の夕方以降になる場合があります',
                '1か月以内の差し替えは1回につき10,000円で承ります(店舗様にて作成・持ち込みをしていただければ無料)',
                '店舗の壁に掲示します。※什器を使う場合は、事前に可能かドンキ側に相談する必要があります。また、什器はパチンコ店様で購入していただきます'] },
            { h: 'サイズ', items: ['A1(594mm×841mm) 縦', '他サイズ希望の際はご相談ください(可能か確認します)。なお、ポスターサイズが小さくなっても価格は変わりません'] },
            { h: '素材(デザイン)受付期限', items: ['開催日の3週間前'] }
        ] },
    box: { name: 'ボックスティッシュ', matDays: 75, lead: '約2か月', matShort: '開催日の2か月半前', matText: '開催日目安の2か月半前(個数が多い場合は前倒しになる可能性があります)',
        sections: [
            { h: 'テンプレート', items: ['専用テンプレート有(店舗様でデザインいただける場合は、受注後にお渡しします)'] },
            { h: '素材(デザイン)受付期限', items: ['開催日目安の2か月半前(個数が多い場合は前倒しになる可能性があります)'] },
            { h: '注意事項', items: ['販売場所の指定はできません', '販売開始タイミングは、開始希望日から数日ずれる場合があります'] },
            { h: '特記事項', items: [
                'A1ポスターと床シールを一緒に掲示いたします。テンプレートはございませんが、サイズの指定がございます。こちらもaiファイルで作成をお願いいたします',
                'A1サイズポスター: 縦向き、A1サイズ(※847×600mm)',
                '床面広告(シール): 横向き、A1サイズ(※600×847mm)',
                '※料金に含まれていますので、別途金額はかかりません'] }
        ] },
    pocket: { name: 'ポケットティッシュ', matDays: 30, lead: '約1か月', matShort: '開催日の1か月前', matText: '開催日目安の1か月前(個数が多い場合は前倒しになる可能性があります)',
        sections: [
            { h: '素材について', items: [
                'サイズとデザイン: 既定のテンプレートに沿って作成をお願いします。テンプレートは[こちら](https://dmm-amu.cybozu.com/k/808/show#record=325&tab=comments&mode=show&s.keyword=%25E3%2583%2589%25E3%2583%25B3%25E3%2582%25AD&s.app=808)からダウンロードしてください',
                '必ず「18歳未満は入店禁止です」という文言を入れてください',
                'ファイル形式: イラレデータ(aiファイル)。データ作成時には「CMYKカラー」でお願いします。「RGB」でデータをいただいても、印刷時には「CMYK」に変換されます。この場合は色味が少し変わってしまいますので、ご了承ください'] },
            { h: '素材(デザイン)受付期限', items: ['開催日目安の1か月前(個数が多い場合は前倒しになる可能性があります)'] },
            { h: '注意事項', items: [
                '配布開始タイミングは、開始希望日から数日ずれる場合があります',
                '配布対象者は、成人済みの方のみになります',
                '基本的に、客数の少ない深夜には配布せず、日中の配布になりますが、店舗によります。指示がなければ配布時間は店舗任せになるため、配布時間に要望がある場合は事前にお知らせください',
                '配布するレジについては店舗都合に任せておりますので、全レジで配布することをお約束するものではございません。ただし、ご契約する数量を配り終えるまでは必ず配布いたします。ピークタイムやレジ研修など、配布できないタイミングがございます',
                'セミセルフレジの場合は、手渡しではなく、お客様のカゴにドンキスタッフが入れます。8割以上の店舗がセミセルフ・フルセルフレジに切り替わっておりますので、ポケットティッシュ配布案件は、基本かご入れになります'] }
        ] },
    gate: { name: 'インパクトゲート', matDays: 45, lead: '約1か月半', matShort: '開催日の1か月半前', matText: '開催日目安の1か月半前(前倒しになる可能性があります)',
        sections: [
            { h: 'サイズ・テンプレート', items: ['専用テンプレート有(店舗様でデザインいただける場合は、受注後にお渡しします。店舗により防犯ゲートの形が異なるため、都度ご案内します)'] },
            { h: 'データ形式', items: ['イラレデータ(aiファイル)'] },
            { h: '素材(デザイン)受付期限', items: ['開催日目安の1か月半前(前倒しになる可能性があります)'] },
            { h: '注意事項', items: ['掲示タイミングは、開始日の夕方以降になる場合があります', '店舗様での印刷と持ち込みはNGです。※防犯機能等の問題からトラブル回避のため'] }
        ] },
    jack: { name: '店舗内装飾ジャック', matDays: null, lead: '', matText: '', sections: [] }
};

function productKind(title) {
    const t = String(title || '');
    if(t.includes('ポケット') || t.includes('手渡し')) return 'pocket';
    if(t.includes('ボックス') || t.includes('BOX') || t.includes('ＢＯＸ')) return 'box';
    if(t.includes('ポスター')) return 'poster';
    if(t.includes('ゲート')) return 'gate';
    if(t.includes('ジャック') || t.includes('装飾')) return 'jack';
    return '';
}

function parseGuideSheet(data) {
    const g = { common: { warning: [], flow: [], rule: [] }, items: {} };
    if(!data || data.length < 2) return g;
    for(let i = 1; i < data.length; i++) {
        const row = data[i] || [];
        const t = String(row[0] || '').trim(), ty = String(row[1] || '').trim(), val = String(row[2] || '').trim();
        if(!t || !ty || !val) continue;
        if(t === '共通') {
            if(ty === '警告') g.common.warning.push(val);
            else if(ty === '流れ') g.common.flow.push(val);
            else if(ty === '基本ルール') g.common.rule.push(val);
        } else {
            const it = g.items[t] = g.items[t] || { spec: [], note: [], matDays: null, applyDays: null, lead: '', icon: '' };
            if(ty === '仕様') it.spec.push(val);
            else if(ty === '注意') it.note.push(val);
            else if(ty === '素材入稿日数') { const n = parseInt(val, 10); if(n > 0) it.matDays = n; }
            else if(ty === '申込日数') { const n = parseInt(val, 10); if(n > 0) it.applyDays = n; }
            else if(ty === '制作の目安') it.lead = val;
            else if(ty === 'アイコン') it.icon = val; 
        }
    }
    return g;
}

function guideItemFor(prod) {
    const G = window.__GUIDES; if(!G) return null;
    const title = String(prod.title || ''), keys = Object.keys(G.items);
    if(G.items[title]) return G.items[title];
    let k = keys.find(x => title.includes(x) || x.includes(title));
    if(!k && productKind(title)) k = keys.find(x => productKind(x) === productKind(title));
    return k ? G.items[k] : null;
}

function guideText(s) {
    return escHtml(s)
        .replace(/\[\[(.+?)\|(https?:\/\/[^\]\s]+?)\]\]/g, (m, label, url) => `<a href="${url}" target="_blank" rel="noopener" class="g-link">${label}</a>`)
        .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (m, label, url) => `<a href="${url}" target="_blank" rel="noopener" class="g-link">${label}</a>`);
}

const WEEK_JA = ['日', '月', '火', '水', '木', '金', '土'];
function addDays(d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); }
function addMonthsClamped(d, n) {
    const x = new Date(d.getFullYear(), d.getMonth() + n, 1);
    const last = new Date(x.getFullYear(), x.getMonth() + 1, 0).getDate();
    x.setDate(Math.min(d.getDate(), last)); return x;
}
function addBusinessDays(d, n) {
    let x = new Date(d.getFullYear(), d.getMonth(), d.getDate()), c = 0;
    while(c < n) { x = addDays(x, 1); const w = x.getDay(); if(w !== 0 && w !== 6) c++; }
    return x;
}
function fmtJP(d) { return `${d.getMonth() + 1}月${d.getDate()}日`; }
function fmtJPFull(d) { return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日(${WEEK_JA[d.getDay()]})`; }
function fmtMD(d) { return `${d.getMonth() + 1}/${d.getDate()}(${WEEK_JA[d.getDay()]})`; }
function fmtYMD(d) { return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}(${WEEK_JA[d.getDay()]})`; }

const APPLY_STD_DAYS = 30;   
const APPLY_LAG_BDAYS = 1;   
const MAT_LAG_DAYS = 7;      

function buildSchedule(kind, matDays, lead, matShort, applyOverride) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const answer = addBusinessDays(today, CONFIRM_BDAYS);             
    const firstApply = addBusinessDays(answer, APPLY_LAG_BDAYS);      
    const applyDays = applyOverride || Math.max(APPLY_STD_DAYS, matDays ? matDays + MAT_LAG_DAYS : 0);
    const standard = (applyDays === APPLY_STD_DAYS);                   

    let start = standard ? addMonthsClamped(firstApply, 1) : addDays(firstApply, applyDays);
    if(kind === 'poster') {                                            
        const day = start.getDate();
        if(day !== 1 && day !== 16) start = (day < 16) ? new Date(start.getFullYear(), start.getMonth(), 16) : new Date(start.getFullYear(), start.getMonth() + 1, 1);
    }
    const apply = standard ? addMonthsClamped(start, -1) : addDays(start, -applyDays);
    const mat = matDays ? addDays(start, -matDays) : null;

    const items = [
        { d: today, t: '相談・案件を決定', subs: [{ t: lead ? `制作の目安 ${lead}` : 'お早めにご相談ください' }] },
        { d: answer, t: '開催確認の回答', subs: [{ t: `平均${CONFIRM_BDAYS}営業日` }] }
    ];
    if(mat && mat.getTime() === apply.getTime()) items.push({ d: apply, t: '申込・素材入稿', subs: [{ t: '以降キャンセル不可', red: true }] });
    else {
        items.push({ d: apply, t: '申込(獲得報告メール)', subs: [{ t: '以降キャンセル不可', red: true }] });
        if(mat) items.push({ d: mat, t: '素材(デザイン)入稿', subs: matShort ? [{ t: matShort }] : [] });
    }
    items.push({ d: start, t: '最短の掲載開始日', subs: (kind === 'poster' ? [{ t: '毎月1日・16日開始' }] : []).concat([{ t: '上記の日付以降で、日程の調整をお願いします', red: true }]), hl: true });
    return { today, start, answer, apply, mat, applyDays, standard, items };
}

function buildGuideParts(prod) {
    const G = window.__GUIDES || { common: { warning: [], flow: [], rule: [] }, items: {} };
    const kind = productKind(prod.title), def = GUIDE_DEFAULTS[kind] || null, item = guideItemFor(prod);
    const matDays = (item && item.matDays) || (def && def.matDays) || null;
    const lead = (item && item.lead) || (def && def.lead) || '';
    const name = def ? def.name : String(prod.title || '');

    const applyOverride = (item && item.applyDays) || null;
    const sc = buildSchedule(kind, matDays, lead, def ? def.matShort : '', applyOverride);
    const timeline = `<div class="hs" style="--n:${sc.items.length}">` + sc.items.map(it => `
        <div class="hs-item${it.hl ? ' last' : ''}"><span class="hs-dot"></span>
            <div class="hs-body"><div class="hs-dt"><b class="hs-date">${fmtJP(it.d)}<span class="hs-w">(${WEEK_JA[it.d.getDay()]})</span></b><span class="hs-t">${esc(it.t)}</span></div>
            ${(it.subs || []).map(x => `<div class="hs-sub${x.red ? ' red' : ''}">${esc(x.t)}</div>`).join('')}</div></div>`).join('') + '</div>';
    const notes = [
        '商材・数量は、相談の時点では未確定でもOKです。制作に日数がかかるので、お早めにご相談ください',
        `開催確認は店舗ごとの判断のため、${CONFIRM_BDAYS}営業日よりかかる場合や、お断りする場合があります`,
        '申込(獲得報告メール)で内容が確定となり、以降、店舗都合のキャンセルは承れません。申込は、事前に店舗と相談して実施可否を決定してから行います',
        '素材(デザイン)は店舗から回収して、メールで送ります。テンプレートや注意事項は商材ごとに異なります(「仕様・注意事項」をご確認ください)'
    ];
    if(!sc.standard) notes.push(`この商材は素材入稿期限が早いため、申込は、原則(開催開始日の1か月前)より早い、開催開始日の約${sc.applyDays}日前までに必要です`);
    notes.push(`日程の計算: 土日のみ除外(祝日・年末年始は含みません)。申込は回答の翌営業日以降、素材入稿は申込の${MAT_LAG_DAYS}日後以降として計算しています`);
    const suppHtml = '<ul class="g-ul">' + notes.map(n => `<li class="g-li">${esc(n)}</li>`).join('') + '</ul>';

    const ruleHtml = G.common.rule.length ? '<ul class="g-ul">' + G.common.rule.map(r => `<li class="g-li">${guideText(r)}</li>`).join('') + '</ul>' : '';

    let secs = [];
    if(item && (item.spec.length || item.note.length)) {
        if(item.spec.length) secs.push({ h: '仕様・素材について', items: item.spec });
        if(item.note.length) secs.push({ h: '注意事項', items: item.note });
    } else if(def) { secs = def.sections; }
    const specHtml = secs.length
        ? secs.map(sec => `<div class="g-sec-h">${esc(sec.h)}</div><ul class="g-ul">${sec.items.map(i => `<li class="g-li">${guideText(i)}</li>`).join('')}</ul>`).join('')
        : '<div class="g-li">この商材の詳細は、お問い合わせください。</div>';

    return { name, sc, timeline, suppHtml, ruleHtml, specHtml };
}

function parseDateLoose(str) {
    const m = String(str || '').match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
}

function renderDeadlines(data) {
    const zone = document.getElementById('deadline-zone'), box = document.getElementById('deadline-list');
    if(!zone || !box || !data || data.length < 2) return;
    const head = data[0];
    const find = (kws, def) => { const i = getColIndex(head, kws); return i !== -1 ? i : def; };
    const tCol = find(['項目', 'タイトル', '名称'], 0), sCol = find(['開始'], 1), dCol = find(['締切', '期日', '期限'], 2), nCol = find(['備考', 'メモ', '説明'], 3);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const week = ['日', '月', '火', '水', '木', '金', '土'];

    const items = [];
    for(let i = 1; i < data.length; i++) {
        const row = data[i] || [];
        const title = String(row[tCol] || '').trim(); const dl = parseDateLoose(row[dCol]);
        if(!title || !dl) continue;
        const left = Math.round((dl - today) / 86400000);
        if(left < 0) continue; 
        items.push({ title, dl, st: parseDateLoose(row[sCol]), left, note: String(row[nCol] || '').trim() });
    }
    if(items.length === 0) return;
    items.sort((a, b) => a.dl - b.dl);

    box.innerHTML = items.map(it => {
        const pct = (it.st && it.st < it.dl) ? Math.round(Math.min(1, Math.max(0, (today - it.st) / (it.dl - it.st))) * 100) : null;
        const cls = it.left === 0 ? 'today' : it.left <= 3 ? 'danger' : it.left <= 7 ? 'warn' : '';
        const label = it.left === 0 ? '本日締切' : `あと${it.left}日`;
        const d = `${it.dl.getFullYear()}/${it.dl.getMonth() + 1}/${it.dl.getDate()}(${week[it.dl.getDay()]})`;
        return `<div class="dl-item ${cls}">
            <div class="dl-top"><div class="dl-title">${esc(it.title)}</div><div class="dl-badge">${label}</div></div>
            ${pct !== null ? `<div class="dl-track"><div class="dl-fill" style="width:${it.left === 0 ? 100 : pct}%"></div></div>` : ''}
            <div class="dl-sub"><span>締切 ${d}</span><span>${esc(it.note)}</span></div>
        </div>`;
    }).join('');
    zone.classList.remove('view-hidden');
}

function runOnMap(fn) { if(currentView === 'map') fn(); else pendingMapAction = fn; }

function scrollToToggle() {
    const el = document.getElementById('view-toggle'); if(!el) return;
    window.scrollTo({ top: el.getBoundingClientRect().top + window.pageYOffset, behavior: 'smooth' });
}

window.setView = function(mode, doScroll = true) {
    currentView = mode;
    const isMap = mode === 'map';
    const mc = document.getElementById('map-container'), lv = document.getElementById('list-view'), sr = document.getElementById('sort-row');
    if(mc) mc.classList.toggle('view-hidden', !isMap);
    if(lv) lv.classList.toggle('view-hidden', isMap);
    if(sr) sr.classList.toggle('view-hidden', isMap);
    const bMap = document.getElementById('seg-map'), bList = document.getElementById('seg-list');
    if(bMap) bMap.classList.toggle('active', isMap); if(bList) bList.classList.toggle('active', !isMap);
    if(isMap && map) {
        setTimeout(() => { map.invalidateSize(); if(pendingMapAction) { const f = pendingMapAction; pendingMapAction = null; f(); } }, 60);
    }
    if(doScroll) scrollToToggle();
}

function dateKey(str) { const d = parseDateLoose(str); return d ? d.getTime() : 0; }

function sortCenter() {
    if(searchState.mode === 'radius' && searchState.center) return searchState.center;
    if(userLat !== null && userLng !== null) return { lat: userLat, lng: userLng, label: '現在地', type: 'current' };
    return null;
}

function getVisibleSorted() {
    const list = stores.filter(isStoreVisible);
    const sel = document.getElementById('sort-select');
    let mode = sel ? sel.value : 'distance';
    const c = sortCenter();
    if(mode === 'distance' && !c) mode = 'pref'; 
    const dist = s => getDistance(c.lat, c.lng, s.lat, s.lng);
    const prefIdx = s => { const i = PREF_ORDER.indexOf(s.pref); return i === -1 ? 999 : i; };
    list.sort((a, b) => {
        if(mode === 'distance') return dist(a) - dist(b);
        if(mode === 'updated') return dateKey(b.updatedAt) - dateKey(a.updatedAt);
        if(mode === 'name') return String(a.name).localeCompare(String(b.name), 'ja');
        return (prefIdx(a) - prefIdx(b)) || String(a.city).localeCompare(String(b.city), 'ja') || String(a.name).localeCompare(String(b.name), 'ja');
    });
    return list;
}

function storeCardHtml(s, c) {
    const ic = icons[s.category] || defaultIconObj;
    const src = (ic && ic.options && ic.options.iconUrl) ? ic.options.iconUrl : '';
    const dist = c ? `${c.type === 'point' ? '指定地点' : '現在地'}から ${getDistance(c.lat, c.lng, s.lat, s.lng).toFixed(1)}km` : '';
    const meta = [s.category ? esc(s.category) : '', dist].filter(Boolean).join(' ・ ');
    const r = s.records;
    const body = s.unavailable !== ''
        ? '<div class="store-unav">掲載不可(施設都合上)</div>'
        : '<div class="store-rec">' + [['ボックス', r.tissue], ['ポスター', r.poster], ['ゲート', r.gate], ['手渡し', r.register], ['ジャック', r.jack]]
            .map(([label, v]) => `<div class="rec-chip"><span>${label}</span>${recordBadge(v, 18)}</div>`).join('') + '</div>';
    return `<div class="store-card">
        <div class="store-head">${src ? `<img class="store-icon" src="${src}" alt="">` : ''}<div class="store-name">${esc(s.name)}</div>
            <button type="button" class="store-mapbtn" onclick="focusStore(${s.idx})">地図で見る</button></div>
        <div class="store-addr">${esc(s.address)}</div>
        ${meta ? `<div class="store-meta">${meta}</div>` : ''}
        <div class="store-date">更新日 <b>${esc(s.updatedAt || '未実施')}</b></div>
        ${body}
    </div>`;
}

window.renderStoreList = function(reset) {
    if(reset !== false) listLimit = PAGE_SIZE;
    const box = document.getElementById('store-list'); if(!box) return;
    const list = getVisibleSorted(), c = sortCenter();
    const cnt = document.getElementById('result-count'); if(cnt) cnt.textContent = `${list.length}件`;
    box.innerHTML = list.length ? list.slice(0, listLimit).map(s => storeCardHtml(s, c)).join('') : '<div class="list-empty">条件に合う店舗がありません</div>';
    const more = document.getElementById('list-more');
    if(more) { more.style.display = list.length > listLimit ? 'block' : 'none'; more.textContent = `さらに表示(残り ${list.length - listLimit} 件)`; }
}

window.showMoreStores = function() { listLimit += PAGE_SIZE; renderStoreList(false); }

window.focusStore = function(idx) {
    const s = stores[idx]; if(!s) return;
    pendingMapAction = null; 
    setView('map');
    setTimeout(() => {
        map.stop(); map.invalidateSize(); map.setView([s.lat, s.lng], 16, { animate: false });
        if(s.marker) { if(!map.hasLayer(s.marker)) s.marker.addTo(map); setTimeout(() => s.marker.openPopup(), 150); }
    }, 300);
}

window.__APP_VERSION = 'ui12';
if(document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', initApp); } else { initApp(); }