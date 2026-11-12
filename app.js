/* ============================================================
 * ドンキAD MAP  app.js (UI v3 + Dynamic Schedule Accordion)
 * ============================================================ */
const SHEET_ID = '1wo0qLk-eYag_tqp-kZwE6CpNdFACwPWTtFCroxHdk1s';
const PREF_ORDER = ["北海道","青森県","岩手県","宮城県","秋田県","山形県","福島県","茨城県","栃木県","群馬県","埼玉県","千葉県","東京都","神奈川県","新潟県","富山県","石川県","福井県","山梨県","長野県","岐阜県","静岡県","愛知県","三重県","滋賀県","京都府","大阪府","兵庫県","奈良県","和歌山県","鳥取県","島根県","岡山県","広島県","山口県","徳島県","香川県","愛媛県","高知県","福岡県","佐賀県","長崎県","熊本県","大分県","宮崎県","鹿児島県","沖縄県"];
const DEFAULT_VIEW = 'map';   // 最初に表示する画面: 'map' か 'list'
const PAGE_SIZE = 50;         // リストを一度に表示する件数
 
function showError(msg) { const eb = document.getElementById('error-banner'); if(eb){ eb.innerText = msg; eb.style.display = 'block'; } }
 
// 画面下に数秒だけ出すお知らせ(スクロールしていても見える)
let noticeTimer = null;
function showNotice(msg) {
    let t = document.getElementById('toast');
    if(!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
    t.textContent = msg; t.classList.add('show');
    clearTimeout(noticeTimer); noticeTimer = setTimeout(() => t.classList.remove('show'), 3500);
}
 
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
 
function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&', '<': '<', '>': '>', '"': '"', "'": ''' }[c])); }
 
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
    missingPins.push(fileName);
    return makeFallbackIcon();
}
 
/* ============================================================
 * 起動: スプレッドシートの読み込み
 * ============================================================ */
async function initApp() {
    try {
        // 【追加】「説明文」シートの読み込みを追加
        const [coordsData, statusData, pricesData, iconData, bannerData, deadlineData, guideData] = await Promise.all([
            fetchCSV('店舗座標一覧'), fetchCSV('開催状況集計'), fetchCSV('Prices'), fetchCSV('icon'), fetchCSV('ヘッダーバナー'), fetchCSV('申込期日'), fetchCSV('説明文')
        ]);
        if(coordsData.length === 0) showError("⚠️ 店舗データが取得できませんでした。");
 
        if(bannerData && bannerData.length > 1) {
            const bannerUrl = bannerData[1][0]; const bannerLink = bannerData[1][1];
            if(bannerUrl) {
                const img = document.getElementById('header-banner');
                if(img){ img.src = bannerUrl.trim(); img.style.display = 'block'; if(bannerLink) img.onclick = () => window.open(bannerLink, '_blank'); }
            }
        }
 
        if(iconData && iconData.length > 1) {
            for(let i=1; i<iconData.length; i++) {
                if(iconData[i][0] && iconData[i][1]) {
                    const catName = iconData[i][0].trim();
                    const iconObj = await resolvePinIcon(iconData[i][1]);
                    icons[catName] = iconObj;
                    if (catName === '専門店') { defaultIconObj = iconObj; }
                }
            }
        }
        if (missingPins.length > 0) { showError("⚠ ピン画像が見つかりません: " + [...new Set(missingPins)].join(', ')); }
        if (!defaultIconObj && Object.keys(icons).length > 0) { defaultIconObj = icons[Object.keys(icons)[0]]; }
 
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

        // 【追加】「説明文」シートのデータパース
        let parsedGuides = { common: { warning: [], flow: [], rule: [] }, items: {} };
        if(guideData && guideData.length > 1) {
            for(let i=1; i<guideData.length; i++) {
                const [target, type, text] = guideData[i];
                if(!target || !text) continue;
                const t = target.trim(), ty = type.trim(), val = text.trim();
                if(t === '共通') {
                    if(ty === '警告') parsedGuides.common.warning.push(val);
                    else if(ty === '流れ') parsedGuides.common.flow.push(val);
                    else if(ty === '基本ルール') parsedGuides.common.rule.push(val);
                } else {
                    if(!parsedGuides.items[t]) parsedGuides.items[t] = { spec: [], note: [] };
                    if(ty === '仕様') parsedGuides.items[t].spec.push(val);
                    else if(ty === '注意') parsedGuides.items[t].note.push(val);
                }
            }
        }
        window.__GUIDES = parsedGuides;
 
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
 
        initMap();
        initSearchUI();
        initProductZone();                 // 商材ゾーン
        renderDeadlines(deadlineData);     // 期日ゾーン
        filterMap();
        setView(DEFAULT_VIEW, false);
        getUserLocation(true);
 
    } catch(err) { console.error(err); showError("⚠️ システムエラーが発生しました。"); }
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
 
/* ============================================================
 * 地図描画
 * ============================================================ */
function initMap() {
    map = L.map('map', { doubleClickZoom: true, tap: false }).setView([35.6895, 139.6917], 5);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(map);
 
    map.on('click', () => { if(searchOpen) toggleSearch(); });
    map.on('dragstart', () => { if(searchOpen) toggleSearch(); });
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
            if(searchState.mode === 'radius' && searchState.center && searchState.center.type === 'current') {
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
 
/* ============================================================
 * 検索・ソート
 * ============================================================ */
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
    if(centerType === 'current') { el.textContent = (userLat !== null) ? '基準: 現在地' : '基準: 現在地(位置情報を取得できていません)'; } 
    else { el.textContent = pickedPoint ? `基準: ${pickedPoint.label}` : '基準: 住所などを検索して、地点を選んでください'; }
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
    } catch(e) {}
    if(list.length === 0) {
        try {
            const r = await fetch('https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&countrycodes=jp&accept-language=ja&q=' + encodeURIComponent(q));
            if(r.ok) {
                const j = await r.json();
                list = (j || []).map(f => ({ lat: parseFloat(f.lat), lng: parseFloat(f.lon), label: (f.display_name || q).split(',').slice(0, 3).reverse().join(' ').trim() }));
            }
        } catch(e) {}
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
    if(searchOpen) toggleSearch();
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

window.applySearch = function() {
    const rVal = document.getElementById('radius-input')?.value;
    const prefVal = document.getElementById('pref-select')?.value;
    
    // UI v3 の統合された「決定」ボタン対応: 何が入力されているかでルーティング
    if (rVal) applyRadius();
    else if (prefVal) applyRegion();
    else {
        // 条件なしで決定を押した場合のリセット挙動
        window.resetFilters();
        if(searchOpen) toggleSearch();
    }
};
 
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
    if(panel) panel.classList.toggle('hidden', !searchOpen);
    if(chev) chev.style.transform = searchOpen ? 'rotate(180deg)' : 'rotate(0deg)';
}
 
/* ============================================================
 * 商材・スケジュール アコーディオン (動的生成)
 * ============================================================ */
// スケジュール自動計算（土日スキップ + 最短掲載日1日/16日算出）
function calcDynamicSchedule(prodTitle) {
    let offsetDays = null;
    if(prodTitle.includes('ポスター')) offsetDays = 21;
    else if(prodTitle.includes('手渡し') || prodTitle.includes('ポケット')) offsetDays = 30;
    else if(prodTitle.includes('ゲート')) offsetDays = 45;
    else if(prodTitle.includes('ボックス') || prodTitle.includes('BOX')) offsetDays = 75;

    const today = new Date();
    
    // 回答日: +5営業日 (土日スキップ)
    let responseDate = new Date(today);
    let added = 0;
    while(added < 5) {
        responseDate.setDate(responseDate.getDate() + 1);
        if(responseDate.getDay() !== 0 && responseDate.getDay() !== 6) added++;
    }

    // 入稿期限: 回答日から +6日固定
    let materialDate = new Date(responseDate);
    materialDate.setDate(materialDate.getDate() + 6);

    let publishStr = '案件により都度確認';
    if(offsetDays !== null) {
        let minPub = new Date(materialDate);
        minPub.setDate(minPub.getDate() + offsetDays);
        
        // 1日 or 16日に補正
        if(minPub.getDate() !== 1 && minPub.getDate() !== 16) {
            if(minPub.getDate() < 16) minPub.setDate(16);
            else { minPub.setMonth(minPub.getMonth() + 1); minPub.setDate(1); }
        }
        publishStr = `${minPub.getMonth()+1}月${minPub.getDate()}日〜`;
    }

    const fmt = d => `${d.getMonth()+1}/${d.getDate()}(${['日','月','火','水','木','金','土'][d.getDay()]})`;
    return { today: fmt(today), response: fmt(responseDate), material: fmt(materialDate), publish: publishStr };
}

function renderGuideDynamic(prod) {
    const guides = window.__GUIDES;
    if(!guides || !prod) return '';

    const sched = calcDynamicSchedule(prod.title);
    
    // この商材に合致する説明文を探す
    let pGuide = { spec: [], note: [] };
    for(const k in guides.items) {
        if(prod.title.includes(k)) { pGuide = guides.items[k]; break; }
    }

    const formatList = (arr) => arr.map(t => `<li class="g-li">${esc(t).replace(/\n/g, '<br>')}</li>`).join('');
    const warnHtml = guides.common.warning.map(w => `<div class="g-warn-box">${esc(w).replace(/\n/g, '<br>')}</div>`).join('');
    
    const timelineHtml = `
        <div class="g-timeline">
            <div class="gt-item"><div class="gt-dot"></div><div class="gt-date">${sched.today}</div><div class="gt-text">相談・依頼</div></div>
            <div class="gt-line"></div>
            <div class="gt-item"><div class="gt-dot"></div><div class="gt-date">${sched.response}<br><small>目安</small></div><div class="gt-text">開催可否の回答<br><small>(5営業日)</small></div></div>
            <div class="gt-line"></div>
            <div class="gt-item"><div class="gt-dot"></div><div class="gt-date">${sched.material}<br><small>目安</small></div><div class="gt-text">素材(デザイン)入稿</div></div>
            <div class="gt-line"></div>
            <div class="gt-item hl"><div class="gt-dot"></div><div class="gt-date">${sched.publish}</div><div class="gt-text">最短掲載開始</div></div>
        </div>
    `;

    const specHtml = pGuide.spec.length ? `<div class="g-sec-h">仕様・期限</div><ul class="g-ul">${formatList(pGuide.spec)}</ul>` : '';
    const noteHtml = pGuide.note.length ? `<div class="g-sec-h">注意事項</div><ul class="g-ul">${formatList(pGuide.note)}</ul>` : '';
    const commonHtml = `<div class="g-sec-h">全体の流れ・ルール</div><ul class="g-ul">${formatList([...guides.common.flow, ...guides.common.rule])}</ul>`;

    // PC幅(768px以上)なら最初から開いておくレスポンシブ制御
    const isOpen = window.innerWidth >= 768 ? 'open' : '';

    return `
        <div class="g-dynamic-wrap">
            <div class="g-fast-ans">最短掲載開始目安：<span class="text-red-600 font-bold">${sched.publish}</span></div>
            <details class="g-accordion" ${isOpen}>
                <summary>▼ 掲載までのスケジュール・注意事項</summary>
                <div class="g-acc-content">
                    ${warnHtml}
                    ${timelineHtml}
                    ${specHtml}
                    ${noteHtml}
                    ${commonHtml}
                </div>
            </details>
        </div>
    `;
}

function initProductZone() {
    const tabs = document.getElementById('product-tabs'); if(!tabs) return;
    tabs.innerHTML = '';
    const n = products.length;
    tabs.style.gridTemplateColumns = `repeat(${n <= 3 ? Math.max(n, 1) : (n === 4 ? 2 : 3)}, 1fr)`;
    products.forEach((p, i) => {
        const t = document.createElement('div'); t.className = `prod-tab ${i === 0 ? 'active' : ''}`;
        t.innerText = getShortTabName(p.title);
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
    let optsHtml = prod.options.map((opt, i) => `<option value="${i}">${esc(opt.label)}</option>`).join('');
    const content = document.getElementById('product-content'); if(!content) return;
 
    content.innerHTML = `
        <h2 class="text-[17px] font-bold mb-4 leading-snug text-gray-800">${esc(prod.title || '')}</h2>
        ${prod.imageUrl ? `<img src="${esc(prod.imageUrl)}" class="product-image" alt="画像" onerror="this.style.display='none'">` : ''}
        <div class="bg-yellow-50 p-3.5 rounded-lg border border-yellow-200 mb-5"><span class="bg-yellow-400 text-xs font-bold px-2.5 py-1 rounded">POINT</span><p class="text-sm mt-2 text-gray-700">${esc(prod.point || '')}</p></div>
        <div class="border border-gray-200 rounded-xl p-4 bg-white shadow-sm">
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
        </div>
        ${renderGuideDynamic(prod)}`;
}
 
window.updatePrice = function(pIdx, oIdx) {
    const opt = products[pIdx].options[oIdx];
    if(opt){
        const pDisp = document.getElementById('price-display'); const nDisp = document.getElementById('note-display');
        if(pDisp) pDisp.innerText = opt.price; if(nDisp) nDisp.innerText = opt.note;
    }
}
 
/* ============================================================
 * ③ 申込までの期日進捗ゾーン
 * ============================================================ */
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
 
/* ============================================================
 * ⑥ リスト／MAP の切り替え  ⑦ 店舗リスト
 * ============================================================ */
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
 
window.__APP_VERSION = 'ui3_dynamic_accordion';
window.onload = initApp;