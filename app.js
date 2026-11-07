const SHEET_ID = '1wo0qLk-eYag_tqp-kZwE6CpNdFACwPWTtFCroxHdk1s';
const PREF_ORDER = ["北海道","青森県","岩手県","宮城県","秋田県","山形県","福島県","茨城県","栃木県","群馬県","埼玉県","千葉県","東京都","神奈川県","新潟県","富山県","石川県","福井県","山梨県","長野県","岐阜県","静岡県","愛知県","三重県","滋賀県","京都府","大阪府","兵庫県","奈良県","和歌山県","鳥取県","島根県","岡山県","広島県","山口県","徳島県","香川県","愛媛県","高知県","福岡県","佐賀県","長崎県","熊本県","大分県","宮崎県","鹿児島県","沖縄県"];

function showError(msg) { const eb = document.getElementById('error-banner'); if(eb){ eb.innerText = msg; eb.style.display = 'block'; } }

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
    if (title.includes('ティッシュ手渡し') || title.includes('ポケットティッシュ')) return 'ティッシュ手渡し';
    if (title.includes('ボックスティッシュ') || title.includes('BOX')) return 'BOXティッシュ';
    if (title.includes('ポスター')) return 'ポスター';
    if (title.includes('ゲート')) return 'ゲート';
    if (title.includes('ジャック') || title.includes('装飾')) return '店舗ジャック';
    return title.substring(0, 6);
}

// 【究極の修正】スプレッドシートの書き方に関わらず、確実にお客様のGitHub Pagesの画像URLを組み立てる
function getSafeImageUrl(url) {
    if (!url) return '';
    let cleanUrl = url.trim();
    if (cleanUrl.startsWith('http')) return cleanUrl;
    
    // スプシに「images/pin.png」と書いてあっても「pin.png」でも、ファイル名だけを強制抽出
    const fileName = cleanUrl.split('/').pop();
    
    // お客様のリポジトリ（donki-AD）の絶対URLに直接つなぐ（リンク切れを物理的に防ぐ）
    return `https://pachi-town.github.io/donki-AD/images/${fileName}`;
}

let stores = [], products = [], map, icons = {}, activeCategories = [], userLat = null, userLng = null, userMarker = null;
let defaultIconObj = null;

async function initApp() {
    try {
        const [coordsData, statusData, pricesData, iconData, bannerData] = await Promise.all([
            fetchCSV('店舗座標一覧'), fetchCSV('開催状況集計'), fetchCSV('Prices'), fetchCSV('icon'), fetchCSV('ヘッダーバナー')
        ]);
        if(coordsData.length === 0) showError("⚠️ 店舗データが取得できませんでした。");

        if(bannerData && bannerData.length > 1) {
            const bannerUrl = bannerData[1][0]; const bannerLink = bannerData[1][1];
            if(bannerUrl) { const img = document.getElementById('header-banner'); if(img){ img.src = getSafeImageUrl(bannerUrl); img.style.display = 'block'; if(bannerLink) img.onclick = () => window.open(bannerLink, '_blank'); } }
        }
        
        // --- Icon ---
        if(iconData && iconData.length > 1) {
            for(let i=1; i<iconData.length; i++) { 
                if(iconData[i][0] && iconData[i][1]) {
                    const catName = iconData[i][0].trim();
                    const fixedUrl = getSafeImageUrl(iconData[i][1]);
                    
                    const iconObj = L.icon({ 
                        iconUrl: fixedUrl, 
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
                    currentProd = { title: row[pTitle], point: (row[pPoint] || ''), imageUrl: getSafeImageUrl(row[pImg]), options: [] };
                    products.push(currentProd);
                }
                currentProd.options.push({ label: (row[pOpt] || ''), price: (row[pPrice] || ''), note: (row[pNote] || '') });
            }
        }

        if(products.length === 0) {
            products = [
                { title: 'CMボックスティッシュ販売', point: 'ドン・キホーテ店内にて販売可能です！', imageUrl: '', options: [{label: '1,008個', price: '934,270円', note: '自社デザインの場合 -30,000円'}] },
                { title: 'ポスター掲示（A1サイズ）', point: '店舗内にてポスターを掲示致します。', imageUrl: '', options: [{label: '1ヶ月間', price: '40,000円', note: 'DMMにて作成の場合 +30,000円'}] }
            ];
        }

        const statusMap = {};
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

            for(let i=1; i<statusData.length; i++) {
                const row = statusData[i];
                const addr = aCol !== -1 ? row[aCol].trim() : ''; 
                if(addr) {
                    statusMap[addr] = {
                        updatedAt: uCol !== -1 ? (row[uCol] || '') : '',
                        poster: pCol !== -1 ? (row[pCol] || 'ー') : 'ー',
                        register: rCol !== -1 ? (row[rCol] || 'ー') : 'ー',
                        tissue: tCol !== -1 ? (row[tCol] || 'ー') : 'ー',
                        gate: (gCol2 !== -1 && row[gCol2]) ? row[gCol2] : ((gCol1 !== -1 && row[gCol1]) ? row[gCol1] : 'ー'),
                        jack: jCol !== -1 ? (row[jCol] || 'ー') : 'ー',
                        unavailable: unCol !== -1 ? (row[unCol] || '') : ''
                    };
                }
            }
        }

        if(coordsData && coordsData.length > 0) {
            const coHead = coordsData[0];
            const cNameCol = getColIndex(coHead, ['店舗名']); const cCatCol = getColIndex(coHead, ['カテゴリ']);
            const cAddrCol = getColIndex(coHead, ['住所']); const cLatCol = getColIndex(coHead, ['緯度']); const cLngCol = getColIndex(coHead, ['経度']);

            for(let i=1; i<coordsData.length; i++) {
                const row = coordsData[i];
                const addr = cAddrCol !== -1 ? row[cAddrCol].trim() : '';
                if(!addr || cLatCol === -1 || cLngCol === -1 || !row[cLatCol] || !row[cLngCol]) continue;
                
                const stat = statusMap[addr] || { updatedAt: '', poster: 'ー', register: 'ー', tissue: 'ー', gate: 'ー', jack: 'ー', unavailable: '' };
                const locInfo = extractPrefAndCity(addr);

                let cat = cCatCol !== -1 ? row[cCatCol] : '';
                
                // 【追加】iconシートに存在しないカテゴリ（キラキラドンキ等）は、表示上も内部的にも強制的に「専門店」に集約させる
                if (cat && !icons[cat]) {
                    cat = '専門店';
                }

                stores.push({
                    name: cNameCol !== -1 ? row[cNameCol] : '', category: cat,
                    pref: locInfo.pref, city: locInfo.city, lat: parseFloat(row[cLatCol]), lng: parseFloat(row[cLngCol]),
                    updatedAt: stat.updatedAt, unavailable: stat.unavailable,
                    records: { tissue: stat.tissue, poster: stat.poster, gate: stat.gate, register: stat.register, jack: stat.jack }, marker: null
                });
            }
        }
        
        initMap(); 
        initSearchUI();
        initModal();

        getUserLocation(true);

    } catch(err) { console.error(err); showError("⚠️ システムエラーが発生しました。"); }
}

function initMap() {
    map = L.map('map', { doubleClickZoom: true, tap: false }).setView([35.6895, 139.6917], 5);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap' }).addTo(map);
    
    map.on('click', () => { if(searchOpen) toggleSearch(); });
    map.on('dragstart', () => { if(searchOpen) toggleSearch(); });

    const bounds = [];
    stores.forEach(store => {
        if(isNaN(store.lat) || isNaN(store.lng)) return;
        
        let mOpt = {};
        if (icons[store.category]) {
            mOpt = { icon: icons[store.category] };
        } else if (defaultIconObj) {
            mOpt = { icon: defaultIconObj };
        }

        const marker = L.marker([store.lat, store.lng], mOpt).addTo(map);
        store.marker = marker; bounds.push([store.lat, store.lng]);
        
        const isUnav = store.unavailable !== ''; const dateText = store.updatedAt ? store.updatedAt : '未実施';
        marker.bindPopup(`
            <div class="popup-header">${store.name}</div>
            <div class="popup-body">
                ${isUnav ? `<div class="unavailable-overlay"><div class="unavailable-stamp">掲載不可<br>(施設都合上)</div></div>` : ''}
                <div class="status-row"><span class="text-gray-500">更新日</span><span class="font-bold bg-gray-100 px-2 rounded">${dateText}</span></div>
                <div class="mt-3 mb-1 text-xs font-bold text-gray-400">過去の広告実績</div>
                <div class="status-grid">
                    <div class="status-item"><span>BOXティッシュ</span> <span>${store.records.tissue}</span></div>
                    <div class="status-item"><span>A1ポスター</span> <span>${store.records.poster}</span></div>
                    <div class="status-item"><span>ゲート</span> <span>${store.records.gate}</span></div>
                    <div class="status-item"><span>ティッシュ配布</span> <span>${store.records.register}</span></div>
                    <div class="status-item"><span>装飾ジャック</span> <span>${store.records.jack}</span></div>
                </div>
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
            
            if(isInit) { map.setView([userLat, userLng], 10); } else { map.setView([userLat, userLng], 12); }
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
        allBtn.className = 'bg-blue-100 border border-blue-300 text-blue-700 px-4 py-1.5 rounded-full text-xs whitespace-nowrap cursor-pointer font-bold flex-shrink-0'; 
        allBtn.textContent = 'すべて選択';
        allBtn.onclick = () => { activeCategories = [...cats]; renderCategoryButtons(); filterMap(); };
        catCont.appendChild(allBtn);

        function renderCategoryButtons() {
            while (catCont.childNodes.length > 1) { catCont.removeChild(catCont.lastChild); }
            cats.forEach(cat => {
                const span = document.createElement('span'); 
                const isActive = activeCategories.includes(cat);
                if(isActive) {
                    span.className = 'bg-yellow-400 border border-yellow-400 px-4 py-1.5 rounded-full text-xs whitespace-nowrap cursor-pointer text-gray-800 font-bold flex-shrink-0';
                } else {
                    span.className = 'bg-gray-100 border border-gray-200 px-4 py-1.5 rounded-full text-xs whitespace-nowrap cursor-pointer text-gray-400 flex-shrink-0';
                }
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

window.filterMap = function() {
    const elPref = document.getElementById('pref-select'); const sPref = elPref ? elPref.value : '';
    const elCity = document.getElementById('city-select'); const sCity = elCity ? elCity.value : '';
    const elUnav = document.getElementById('show-unavailable'); const sUnav = elUnav ? elUnav.checked : true;
    const elRad = document.getElementById('radius-input'); const rVal = elRad ? elRad.value : '';
    
    stores.forEach(s => {
        if(!s.marker) return; let v = true;
        if(sPref && s.pref !== sPref) v = false; if(sCity && s.city !== sCity) v = false;
        if(!activeCategories.includes(s.category)) v = false;
        if(!sUnav && s.unavailable !== '') v = false;
        if(rVal && userLat && userLng) { if(getDistance(userLat, userLng, s.lat, s.lng) > parseFloat(rVal)) v = false; }
        
        if(v) { if(!map.hasLayer(s.marker)) s.marker.addTo(map); } else { if(map.hasLayer(s.marker)) map.removeLayer(s.marker); }
    });
}

let searchOpen = false;
function toggleSearch() {
    searchOpen = !searchOpen; const panel = document.getElementById('search-contents'), chev = document.getElementById('search-chevron');
    if(searchOpen) { if(panel) panel.classList.remove('hidden'); if(chev) chev.style.transform = 'rotate(180deg)'; } 
    else { if(panel) panel.classList.add('hidden'); if(chev) chev.style.transform = 'rotate(0deg)'; }
}

function initModal() {
    const tabs = document.getElementById('modal-tabs'); if(!tabs) return;
    tabs.innerHTML = '';
    products.forEach((p, i) => {
        const t = document.createElement('div'); t.className = `modal-tab ${i === 0 ? 'active' : ''}`; 
        t.innerText = getShortTabName(p.title);
        t.onclick = () => selectTab(i); tabs.appendChild(t);
    });
    if(products.length > 0) renderModalContent(0);
}

function selectTab(index) { 
    document.querySelectorAll('.modal-tab').forEach((t, i) => { t.className = `modal-tab ${i === index ? 'active' : ''}`; }); 
    renderModalContent(index); 
}

function renderModalContent(index) {
    const prod = products[index]; if(!prod) return;
    let optsHtml = prod.options.map((opt, i) => `<option value="${i}">${opt.label}</option>`).join('');
    const content = document.getElementById('modal-content'); if(!content) return;
    
    content.innerHTML = `
        <h2 class="text-[17px] font-bold mb-4 leading-snug text-gray-800">${prod.title || ''}</h2>
        ${prod.imageUrl ? `<img src="${prod.imageUrl}" class="product-image" alt="Product Image" onerror="this.style.display='none'">` : ''}
        <div class="bg-yellow-50 p-3.5 rounded-lg border border-yellow-200 mb-5"><span class="bg-yellow-400 text-xs font-bold px-2.5 py-1 rounded">POINT</span><p class="text-sm mt-2 text-gray-700">${prod.point || ''}</p></div>
        <div class="border border-gray-200 rounded-xl p-4 bg-white shadow-sm">
            <label class="text-xs text-gray-500 font-bold mb-2 block">数量・期間を選択</label>
            <select id="lot-select" class="stylish-select w-full mb-4 bg-gray-50" onchange="updatePrice(${index}, this.value)">${optsHtml}</select>
            <div class="bg-gray-50 p-4 rounded-lg border border-gray-100">
                <div class="text-xs text-gray-500 font-bold mb-1">料金</div>
                <div class="text-3xl font-bold mb-2 text-gray-900">
                    <span id="price-display">${prod.options[0]?.price || ''}</span>
                    <span class="text-sm font-normal text-gray-500">（税別）</span>
                </div>
                <div class="text-xs text-red-500 font-bold" id="note-display">${prod.options[0]?.note || ''}</div>
            </div>
        </div>`;
}

window.updatePrice = function(pIdx, oIdx) { 
    const opt = products[pIdx].options[oIdx]; 
    if(opt){ 
        const pDisp = document.getElementById('price-display'); const nDisp = document.getElementById('note-display'); 
        if(pDisp) pDisp.innerText = opt.price; if(nDisp) nDisp.innerText = opt.note; 
    } 
}

function openModal() { 
    const bm = document.getElementById('bottom-modal'); const mo = document.getElementById('modal-overlay');
    if(bm) bm.classList.add('open'); if(mo) mo.classList.add('show');
}
function closeModal() { 
    const bm = document.getElementById('bottom-modal'); const mo = document.getElementById('modal-overlay');
    if(bm) bm.classList.remove('open'); if(mo) mo.classList.remove('show');
}

window.onload = initApp;
