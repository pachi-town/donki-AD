const SHEET_ID = '1wo0qLk-eYag_tqp-kZwE6CpNdFACwPWTtFCroxHdk1s';

// 日本地図の正しい並び順（JIS X 0401）
const PREF_ORDER = [
    "北海道", "青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県", 
    "茨城県", "栃木県", "群馬県", "埼玉県", "千葉県", "東京都", "神奈川県", 
    "新潟県", "富山県", "石川県", "福井県", "山梨県", "長野県", "岐阜県", 
    "静岡県", "愛知県", "三重県", "滋賀県", "京都府", "大阪府", "兵庫県", 
    "奈良県", "和歌山県", "鳥取県", "島根県", "岡山県", "広島県", "山口県", 
    "徳島県", "香川県", "愛媛県", "高知県", "福岡県", "佐賀県", "長崎県", 
    "熊本県", "大分県", "宮崎県", "鹿児島県", "沖縄県"
];

function showError(msg) { const eb = document.getElementById('error-banner'); eb.innerText = msg; eb.style.display = 'block'; }
async function fetchCSV(sheetName) {
    const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`;
    try { const res = await fetch(url); if (!res.ok) return []; const text = await res.text(); return parseCSV(text); } 
    catch (e) { console.error(e); return []; }
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

let stores = [], products = [], map, icons = {}, activeCategories = [], userLat = null, userLng = null, userMarker = null;
const productTabs = ['BOXティッシュ', 'ポスター', 'ゲート', 'ティッシュ手渡し', '店舗ジャック'];

async function initApp() {
    try {
        const [coordsData, statusData, pricesData, iconData, bannerData] = await Promise.all([
            fetchCSV('店舗座標一覧'), fetchCSV('開催状況集計'), fetchCSV('Prices'), fetchCSV('icon'), fetchCSV('ヘッダーバナー')
        ]);
        if(coordsData.length === 0) showError("⚠️ 店舗データが取得できませんでした。");

        if(bannerData && bannerData.length > 1) {
            const bannerUrl = bannerData[1][0]; const bannerLink = bannerData[1][1];
            if(bannerUrl) { const img = document.getElementById('header-banner'); img.src = bannerUrl; img.style.display = 'block'; if(bannerLink) img.onclick = () => window.open(bannerLink, '_blank'); }
        }
        if(iconData && iconData.length > 1) {
            for(let i=1; i<iconData.length; i++) { if(iconData[i][0] && iconData[i][1]) icons[iconData[i][0]] = L.icon({ iconUrl: iconData[i][1], iconSize: [32, 32], iconAnchor: [16, 32], popupAnchor: [0, -32] }); }
        }

        if(pricesData && pricesData.length > 0) {
            const pHead = pricesData[0];
            const pTitle = getColIndex(pHead, ['商材名']); const pOpt = getColIndex(pHead, ['数量']); const pPrice = getColIndex(pHead, ['料金']);
            const pNote = getColIndex(pHead, ['増減額']); const pPoint = getColIndex(pHead, ['POINT']); const pImg = getColIndex(pHead, ['画像URL']);
            
            let currentProd = null;
            for(let i=1; i<pricesData.length; i++) {
                const row = pricesData[i];
                if(pTitle !== -1 && !row[pTitle]) continue;
                if(!currentProd || (pTitle !== -1 && currentProd.title !== row[pTitle])) {
                    currentProd = { title: row[pTitle], point: (pPoint !== -1 ? row[pPoint] : ''), imageUrl: (pImg !== -1 ? row[pImg] : ''), options: [] };
                    products.push(currentProd);
                }
                currentProd.options.push({ label: (pOpt !== -1 ? row[pOpt] : ''), price: (pPrice !== -1 ? row[pPrice] : ''), note: (pNote !== -1 ? row[pNote] : '') });
            }
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
            const cNameCol = getColIndex(coHead, ['店舗名']);
            const cCatCol = getColIndex(coHead, ['カテゴリ']);
            const cAddrCol = getColIndex(coHead, ['住所']);
            const cLatCol = getColIndex(coHead, ['緯度']);
            const cLngCol = getColIndex(coHead, ['経度']);

            for(let i=1; i<coordsData.length; i++) {
                const row = coordsData[i];
                const addr = cAddrCol !== -1 ? row[cAddrCol].trim() : '';
                if(!addr || cLatCol === -1 || cLngCol === -1 || !row[cLatCol] || !row[cLngCol]) continue;
                
                const stat = statusMap[addr] || { updatedAt: '', poster: 'ー', register: 'ー', tissue: 'ー', gate: 'ー', jack: 'ー', unavailable: '' };
                const locInfo = extractPrefAndCity(addr);

                stores.push({
                    name: cNameCol !== -1 ? row[cNameCol] : '', category: cCatCol !== -1 ? row[cCatCol] : '',
                    pref: locInfo.pref, city: locInfo.city, lat: parseFloat(row[cLatCol]), lng: parseFloat(row[cLngCol]),
                    updatedAt: stat.updatedAt, unavailable: stat.unavailable,
                    records: { tissue: stat.tissue, poster: stat.poster, gate: stat.gate, register: stat.register, jack: stat.jack }, marker: null
                });
            }
        }
        
        initMap(); 
        initModal(); 
        initSearchUI();

        // 【追加】起動時に自動で現在地取得を開始
        getUserLocation(true);

    } catch(err) { console.error(err); showError("⚠️ システムエラーが発生しました。"); }
}

function initMap() {
    // tap:false を設定してスマホでのダブルタップズームや操作のラグを解消
    map = L.map('map', { doubleClickZoom: true, tap: false }).setView([35.6895, 139.6917], 5);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap' }).addTo(map);
    
    // 【追加】地図を触ったら検索パネルを閉じる
    map.on('click', () => { if(searchOpen) toggleSearch(); });
    map.on('dragstart', () => { if(searchOpen) toggleSearch(); });

    const bounds = [];
    stores.forEach(store => {
        if(isNaN(store.lat) || isNaN(store.lng)) return;
        const mOpt = icons[store.category] ? { icon: icons[store.category] } : {};
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

// 引数(isAuto)を追加。自動取得の場合はエラーアラートを出さない。
function getUserLocation(isAuto = false) {
    if (!navigator.geolocation) { 
        if(!isAuto) alert("ブラウザが位置情報に未対応です。"); return; 
    }
    navigator.geolocation.getCurrentPosition(
        (pos) => {
            userLat = pos.coords.latitude; userLng = pos.coords.longitude;
            if(userMarker) map.removeLayer(userMarker);
            
            const userIcon = L.divIcon({ className: 'custom-user-marker', html: '<div class="user-pulse"></div>', iconSize: [20, 20], iconAnchor: [10, 10] });
            userMarker = L.marker([userLat, userLng], {icon: userIcon}).addTo(map).bindPopup("<b style='font-size:12px;'>現在地</b>");
            
            map.setView([userLat, userLng], 12); 
            
            // 成功したら「現在地から」ボタンを消す
            document.getElementById('btn-geolocation').style.display = 'none';

            const radiusSelect = document.getElementById('radius-select');
            if (radiusSelect.value === "") radiusSelect.value = "10"; 
            filterMap();
        }, 
        (err) => { 
            if(!isAuto) alert("位置取得に失敗しました。スマホの設定をご確認ください。"); 
        }
    );
}

function initSearchUI() {
    // 【追加】都道府県をJIS規格順にソート
    const rawPrefs = [...new Set(stores.map(s => s.pref).filter(Boolean))];
    rawPrefs.sort((a, b) => {
        let ia = PREF_ORDER.indexOf(a); let ib = PREF_ORDER.indexOf(b);
        if(ia === -1) ia = 999; if(ib === -1) ib = 999;
        return ia - ib;
    });

    const pSel = document.getElementById('pref-select');
    rawPrefs.forEach(p => { const opt = document.createElement('option'); opt.value = p; opt.textContent = p; pSel.appendChild(opt); });
    
    const catCont = document.getElementById('category-filters');
    const cats = [...new Set(stores.map(s => s.category).filter(Boolean))];
    cats.forEach(cat => {
        const span = document.createElement('span'); span.className = 'bg-gray-200 px-3 py-1 rounded-full text-xs whitespace-nowrap cursor-pointer'; span.textContent = cat;
        span.onclick = () => {
            if(activeCategories.includes(cat)) { activeCategories = activeCategories.filter(c => c !== cat); span.classList.replace('bg-yellow-400', 'bg-gray-200'); span.classList.remove('font-bold'); } 
            else { activeCategories.push(cat); span.classList.replace('bg-gray-200', 'bg-yellow-400'); span.classList.add('font-bold'); }
            filterMap();
        }; catCont.appendChild(span);
    });
}

window.updateCities = function() {
    const sPref = document.getElementById('pref-select').value; const cSel = document.getElementById('city-select'); cSel.innerHTML = '<option value="">市区町村を選択</option>';
    if(sPref) {
        // 【追加】市区町村をあいうえお順にソート
        const cities = [...new Set(stores.filter(s => s.pref === sPref).map(s => s.city).filter(Boolean))];
        cities.sort((a, b) => a.localeCompare(b, 'ja'));
        cities.forEach(c => { const opt = document.createElement('option'); opt.value = c; opt.textContent = c; cSel.appendChild(opt); });
    }
}

window.filterMap = function() {
    const sPref = document.getElementById('pref-select').value, sCity = document.getElementById('city-select').value;
    const sUnav = document.getElementById('show-unavailable').checked, rVal = document.getElementById('radius-select').value;
    stores.forEach(s => {
        if(!s.marker) return; let v = true;
        if(sPref && s.pref !== sPref) v = false; if(sCity && s.city !== sCity) v = false;
        if(activeCategories.length > 0 && !activeCategories.includes(s.category)) v = false;
        if(!sUnav && s.unavailable !== '') v = false;
        if(rVal && userLat && userLng) { if(getDistance(userLat, userLng, s.lat, s.lng) > parseFloat(rVal)) v = false; }
        if(v) { if(!map.hasLayer(s.marker)) s.marker.addTo(map); } else { if(map.hasLayer(s.marker)) map.removeLayer(s.marker); }
    });
}

let searchOpen = false;
function toggleSearch() {
    searchOpen = !searchOpen; const panel = document.getElementById('search-contents'), chev = document.getElementById('search-chevron');
    if(searchOpen) { panel.classList.remove('hidden'); chev.style.transform = 'rotate(180deg)'; } 
    else { panel.classList.add('hidden'); chev.style.transform = 'rotate(0deg)'; }
}

function initModal() {
    const tabs = document.getElementById('modal-tabs'); tabs.innerHTML = '';
    products.forEach((p, i) => {
        const t = document.createElement('div'); t.className = `modal-tab ${i === 0 ? 'active' : ''}`; t.innerText = productTabs[i] || (p.title?p.title.substring(0,6):'詳細');
        t.onclick = () => selectTab(i); tabs.appendChild(t);
    });
    if(products.length > 0) renderModalContent(0);
}

function selectTab(index) { document.querySelectorAll('.modal-tab').forEach((t, i) => { t.className = `modal-tab ${i === index ? 'active' : ''}`; }); renderModalContent(index); }

function renderModalContent(index) {
    const prod = products[index]; if(!prod) return;
    let optsHtml = prod.options.map((opt, i) => `<option value="${i}">${opt.label}</option>`).join('');
    const content = document.getElementById('modal-content');
    
    // 【追加】タイトルが長い場合の折り返し（leading-snug等）を調整
    content.innerHTML = `
        <h2 class="text-base md:text-lg font-bold mb-4 leading-snug">${prod.title || ''}</h2>
        ${prod.imageUrl ? `<img src="${prod.imageUrl}" class="product-image" alt="Product Image">` : ''}
        <div class="bg-yellow-50 p-3 rounded-lg border border-yellow-200 mb-4"><span class="bg-yellow-400 text-xs font-bold px-2 py-1 rounded">POINT</span><p class="text-sm mt-2">${prod.point || ''}</p></div>
        <div class="border border-gray-300 rounded-lg p-4 bg-white shadow-sm">
            <label class="text-xs text-gray-500 font-bold mb-1 block">数量・期間を選択</label>
            <select id="lot-select" class="w-full border border-gray-300 rounded p-2 mb-4 text-base bg-gray-50" onchange="updatePrice(${index}, this.value)">${optsHtml}</select>
            <div class="bg-gray-50 p-4 rounded border border-gray-200">
                <div class="text-xs text-gray-500 font-bold mb-1">料金</div>
                <div class="text-3xl font-bold mb-2">
                    <span id="price-display">${prod.options[0]?.price || ''}</span>
                    <span class="text-sm font-normal text-gray-500">（税別）</span>
                </div>
                <div class="text-xs text-red-500 font-bold" id="note-display">${prod.options[0]?.note || ''}</div>
            </div>
        </div>`;
}

window.updatePrice = function(pIdx, oIdx) { const opt = products[pIdx].options[oIdx]; if(opt){ document.getElementById('price-display').innerText = opt.price; document.getElementById('note-display').innerText = opt.note; } }
function openModal() { document.getElementById('bottom-modal').classList.add('open'); }
function closeModal() { document.getElementById('bottom-modal').classList.remove('open'); }
window.onload = initApp;
