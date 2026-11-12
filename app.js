const SHEET_ID = '1wo0qLk-eYag_tqp-kZwE6CpNdFACwPWTtFCroxHdk1s';
const PREF_ORDER = ["北海道","青森県","岩手県","宮城県","秋田県","山形県","福島県","茨城県","栃木県","群馬県","埼玉県","千葉県","東京都","神奈川県","新潟県","富山県","石川県","福井県","山梨県","長野県","岐阜県","静岡県","愛知県","三重県","滋賀県","京都府","大阪府","兵庫県","奈良県","和歌山県","鳥取県","島根県","岡山県","広島県","山口県","徳島県","香川県","愛媛県","高知県","福岡県","佐賀県","長崎県","熊本県","大分県","宮崎県","鹿児島県","沖縄県"];
const DEFAULT_VIEW = 'map';
const PAGE_SIZE = 50;

function showError(msg) { 
    const eb = document.getElementById('error-banner'); 
    if(eb){ eb.innerText = msg; eb.style.display = 'block'; } 
}

async function fetchCSV(sheetName) {
    const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}&_t=${new Date().getTime()}`;
    try {
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) { console.warn(`Sheet not found: ${sheetName}`); return []; }
        const text = await res.text();
        if(text.trim().startsWith('<')) { console.warn(`Invalid HTML response for: ${sheetName}`); return []; }
        return parseCSV(text);
    } catch (e) {
        console.warn(`Fetch error for ${sheetName}:`, e);
        return [];
    }
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
    if (title.indexOf('手渡し') !== -1 || title.indexOf('ポケット') !== -1) return 'ティッシュ手渡し';
    if (title.indexOf('ボックス') !== -1 || title.indexOf('BOX') !== -1) return 'BOXティッシュ';
    if (title.indexOf('ポスター') !== -1) return 'ポスター';
    if (title.indexOf('ゲート') !== -1) return 'ゲート';
    if (title.indexOf('ジャック') !== -1 || title.indexOf('装飾') !== -1) return '店舗ジャック';
    return title.substring(0, 6);
}

// エラーの原因だった特殊処理を排除し、安全に文字をエスケープする
function esc(v) { 
    return String(v == null ? '' : v).replace(/[&<>"']/g, function(c) {
        return { '&': '&', '<': '<', '>': '>', '"': '"', "'": ''' }[c];
    });
}

function normAddr(s) {
    let t = String(s || '').normalize('NFKC').replace(/\s/g, '');
    // 複雑な漢数字変換を廃止し、ハイフン化のみ実施
    t = t.replace(/ー/g, '-').replace(/−/g, '-');
    t = t.replace(/丁目/g, '-').replace(/番地/g, '-').replace(/番/g, '-').replace(/号/g, '');
    return t.replace(/-+/g, '-').replace(/-$/, '');
}

function normText(s) {
    return String(s || '').normalize('NFKC').toLowerCase().replace(/\s/g, '');
}

function getRawUrl(url) {
    return url ? url.trim() : '';
}

let stores = [], products = [], map, icons = {}, activeCategories = [], userLat = null, userLng = null, userMarker = null;
let defaultIconObj = null;
let currentView = DEFAULT_VIEW, listLimit = PAGE_SIZE, pendingMapAction = null, searchOpen = false;
const hiddenAddr = new Set(), hiddenName = new Set();
let searchState = { mode: 'none', pref: '', city: '', radius: 0, center: null, keyword: '' };

async function initApp() {
    try {
        const [coordsData, statusData, pricesData, iconData, bannerData, deadlineData, guideData] = await Promise.all([
            fetchCSV('店舗座標一覧'), fetchCSV('開催状況集計'), fetchCSV('Prices'), fetchCSV('icon'), fetchCSV('ヘッダーバナー'), fetchCSV('申込期日'), fetchCSV('説明文')
        ]);
        if(coordsData.length === 0) showError("⚠️ 店舗データが取得できませんでした。");

        if(bannerData && bannerData.length > 1) {
            const bannerUrl = bannerData[1][0]; const bannerLink = bannerData[1][1];
            if(bannerUrl) {
                const img = document.getElementById('header-banner');
                if(img){ img.src = getRawUrl(bannerUrl); img.style.display = 'block'; if(bannerLink) img.onclick = () => window.open(bannerLink, '_blank'); }
            }
        }

        if(iconData && iconData.length > 1) {
            for(let i=1; i<iconData.length; i++) {
                if(iconData[i][0] && iconData[i][1]) {
                    const catName = iconData[i][0].trim();
                    const iconObj = L.icon({ 
                        iconUrl: getRawUrl(iconData[i][1]), 
                        iconSize: [32, 32], 
                        iconAnchor: [16, 32], 
                        popupAnchor: [0, -32] 
                    });
                    icons[catName] = iconObj;
                    if (catName === '専門店') { defaultIconObj = iconObj; }
                }
            }
        }
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
                    currentProd = { title: row[pTitle], point: (row[pPoint] || ''), imageUrl: getRawUrl(row[pImg]), options: [] };
                    products.push(currentProd);
                }
                currentProd.options.push({ label: (row[pOpt] || ''), price: (row[pPrice] || ''), note: (row[pNote] || '') });
            }
        }
        if(products.length === 0) {
            products = [{ title: 'データがありません', point: '', imageUrl: '', options: [{label: '-', price: '-', note: '-'}] }];
        }

        let parsedGuides = { common: { warning: [], flow: [], rule: [] }, items: {} };
        if (guideData && guideData.length > 1) {
            for(let i=1; i<guideData.length; i++) {
                const row = guideData[i];
                if (!row || row.length < 3) continue;
                const t = String(row[0] || '').trim();
                const ty = String(row[1] || '').trim();
                const val = String(row[2] || '').trim();
                if(!t || !val) continue;
                
                if (t === '共通') {
                    if (ty === '警告') parsedGuides.common.warning.push(val);
                    else if (ty === '流れ') parsedGuides.common.flow.push(val);
                    else if (ty === '基本ルール') parsedGuides.common.rule.push(val);
                } else {
                    if (!parsedGuides.items[t]) parsedGuides.items[t] = { spec: [], note: [] };
                    if (ty === '仕様') parsedGuides.items[t].spec.push(val);
                    else if (ty === '注意') parsedGuides.items[t].note.push(val);
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
                if (showCol !== -1 && ['OFF', '非表示'].includes(String(row[showCol] || '').trim().toUpperCase())) {
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
                if (hiddenAddr.has(normAddr(addr)) || hiddenName.has(storeName)) continue;

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
        initProductZone();
        renderDeadlines(deadlineData);
        filterMap();
        setView(DEFAULT_VIEW, false);
        getUserLocation(true);

    } catch(err) { console.error(err); showError("⚠️ システムエラーが発生しました。"); }
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
            filterMap();
        },
        (err) => { console.warn("位置取得に失敗しました"); }
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
            const rInp = document.getElementById('radius-input'); if(rInp) rInp.value = '';
            const pSel2 = document.getElementById('pref-select'); if(pSel2) pSel2.value = '';
            updateCities();
            const unav = document.getElementById('show-unavailable'); if(unav) unav.checked = true;
            searchState = { mode: 'none', pref: '', city: '', radius: 0, center: null, keyword: '' };
            activeCategories = [...cats];
            renderCategoryButtons();
            catCont.scrollLeft = 0;
            filterMap();
            runOnMap(() => { if(userLat && userLng) { map.setView([userLat, userLng], 10); } else { fitStores(stores); } });
        };
    }
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

function fitStores(list) {
    const pts = list.filter(s => !isNaN(s.lat) && !isNaN(s.lng)).map(s => [s.lat, s.lng]);
    if(pts.length > 0) map.fitBounds(pts, { padding: [50, 50], maxZoom: 15 });
}

window.applySearch = function() {
    const km = parseFloat(document.getElementById('radius-input')?.value || '');
    const pref = document.getElementById('pref-select')?.value || '';
    const city = document.getElementById('city-select')?.value || '';

    if (km > 0) {
        if(userLat === null) { showNotice('現在地を取得できていません'); return; }
        const center = { lat: userLat, lng: userLng, label: '現在地', type: 'current' };
        searchState = { mode: 'radius', pref: '', city: '', radius: km, center: center, keyword: '' };
    } else if (pref || city) {
        searchState = { mode: 'region', pref: pref, city: city, radius: 0, center: null, keyword: '' };
    } else {
        window.resetFilters();
        if(searchOpen) toggleSearch();
        return;
    }
    
    filterMap();
    const visible = stores.filter(isStoreVisible);
    if(visible.length === 0) showNotice('条件に合う店舗がありません');
    runOnMap(() => fitStores(visible));
    if(searchOpen) toggleSearch();
    scrollToToggle();
};

function isStoreVisible(s) {
    const st = searchState;
    if(!activeCategories.includes(s.category)) return false;
    const elUnav = document.getElementById('show-unavailable');
    if(elUnav && !elUnav.checked && s.unavailable !== '') return false;
    
    if(st.mode === 'region') {