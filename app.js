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
    if (title.includes('手渡し') || title.includes('ポケット')) return 'ティッシュ手渡し';
    if (title.includes('ボックス') || title.includes('BOX')) return 'BOXティッシュ';
    if (title.includes('ポスター')) return 'ポスター';
    if (title.includes('ゲート')) return 'ゲート';
    if (title.includes('ジャック') || title.includes('装飾')) return '店舗ジャック';
    return title.substring(0, 6);
}
 
let stores = [], products = [], map, icons = {}, activeCategories = [], userLat = null, userLng = null, userMarker = null;
let defaultIconObj = null;
const DEFAULT_VIEW = 'map';                 // 最初に表示する画面: 'map' か 'list'
let currentView = DEFAULT_VIEW, listLimit = 50, pendingMapAction = null;
const hiddenAddr = new Set(), hiddenName = new Set(); // 「MAP表示」が OFF の店舗(住所・店舗名)
let hiddenCount = 0;
 
// ==== ピン画像の探索設定 ====
// 画像フォルダ(index.htmlからの相対パス)。GitHub上の images/pin に合わせてあります
const PIN_DIR = './images/pin/';
const RAW_BASE = 'https://raw.githubusercontent.com/pachi-town/donki-AD/main/images/pin/';
const CDN_BASE = 'https://cdn.jsdelivr.net/gh/pachi-town/donki-AD@main/images/pin/';
const missingPins = []; // 見つからなかった画像の記録(画面上のエラーバナーに表示)
 
// 画像が全部見つからなかった時に出す代替ピン(黄色い丸)
function makeFallbackIcon() {
    return L.divIcon({
        className: '',
        html: '<div style="width:28px;height:28px;border-radius:50%;background:#facc15;border:3px solid #111;box-shadow:0 2px 6px rgba(0,0,0,.4)"></div>',
        iconSize: [28, 28], iconAnchor: [14, 28], popupAnchor: [0, -28]
    });
}
 
// 指定URLの画像が実際に読めるか確認する
function canLoadImage(url) {
    return new Promise(resolve => {
        const img = new Image();
        img.onload = () => resolve(true);
        img.onerror = () => resolve(false);
        img.src = url;
    });
}
 
// シートのパスからファイル名だけ取り出し、複数の候補を順に試す
async function resolvePinIcon(rawUrl) {
    // 見えない文字(ゼロ幅スペース等)や前後の空白を除去
    const cleaned = rawUrl.replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
    const fileName = cleaned.split('/').pop();
    const candidates = [
        cleaned,                  // シートに書かれたまま
        PIN_DIR + fileName,       // ./images/pin/pin-mega.png
        './' + fileName,          // index.htmlと同じ階層
        './pin/' + fileName,
        './images/' + fileName,
        // GitHub Pagesで404になる場合の保険(リポジトリのファイルを直接読む)
        RAW_BASE + fileName,
        CDN_BASE + fileName
    ];
    for (const url of candidates) {
        if (await canLoadImage(url)) {
            console.log('✅ ピン画像OK:', url);
            return L.icon({ iconUrl: url, iconSize: [32, 32], iconAnchor: [16, 32], popupAnchor: [0, -32] });
        }
    }
    console.warn('❌ ピン画像が見つかりません:', cleaned, '→ 試した場所:', candidates);
    missingPins.push(fileName);
    return makeFallbackIcon();
}
 
async function initApp() {
    try {
        const [coordsData, statusData, pricesData, iconData, bannerData, deadlineData] = await Promise.all([
            fetchCSV('店舗座標一覧'), fetchCSV('開催状況集計'), fetchCSV('Prices'), fetchCSV('icon'), fetchCSV('ヘッダーバナー'), fetchCSV('申込期日')
        ]);
        if(coordsData.length === 0) showError("⚠️ 店舗データが取得できませんでした。");
 
        // --- ヘッダーバナー ---
        if(bannerData && bannerData.length > 1) {
            const bannerUrl = bannerData[1][0]; const bannerLink = bannerData[1][1];
            if(bannerUrl) { 
                const img = document.getElementById('header-banner'); 
                // スプレッドシートの文字をそのままセット
                if(img){ img.src = bannerUrl.trim(); img.style.display = 'block'; if(bannerLink) img.onclick = () => window.open(bannerLink, '_blank'); } 
            }
        }
        
        // --- Icon(複数の候補パスを試して、読める画像を使う) ---
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
        if (missingPins.length > 0) {
            showError("⚠️ ピン画像が見つかりません: " + [...new Set(missingPins)].join(', ') + "(GitHubの images/pin を確認)");
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
                    currentProd = { 
                        title: row[pTitle], 
                        point: (row[pPoint] || ''), 
                        imageUrl: row[pImg] ? row[pImg].trim() : '', // スプレッドシートの文字をそのままセット
                        options: [] 
                    };
                    products.push(currentProd);
                }
                currentProd.options.push({ label: (row[pOpt] || ''), price: (row[pPrice] || ''), note: (row[pNote] || '') });
            }
        }
 
        if(products.length === 0) {
            products = [{ title: 'データがありません', point: '', imageUrl: '', options: [{label: '-', price: '-', note: '-'}] }];
        }
 
        // --- 開催状況集計 ---
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
            const nmCol = getColIndex(stHead, ['店舗名']);     // 店舗名(住所が一致しなくても非表示にできるように)
            const showCol = getColIndex(stHead, ['MAP表示']);  // MAP表示 ON/OFF(空欄は ON 扱い)
 
            for(let i=1; i<statusData.length; i++) {
                const row = statusData[i];
                const addr = aCol !== -1 ? (row[aCol] || '').trim() : ''; 
                // 「MAP表示」が OFF の店舗は、地図にもリストにも出さない
                if (showCol !== -1 && isOffValue(row[showCol])) {
                    if (addr) hiddenAddr.add(addr);
                    const nm = nmCol !== -1 ? (row[nmCol] || '').trim() : '';
                    if (nm) hiddenName.add(nm);
                }
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
 
        // --- 店舗座標 ---
        if(coordsData && coordsData.length > 0) {
            const coHead = coordsData[0];
            const cNameCol = getColIndex(coHead, ['店舗名']); const cCatCol = getColIndex(coHead, ['カテゴリ']);
            const cAddrCol = getColIndex(coHead, ['住所']); const cLatCol = getColIndex(coHead, ['緯度']); const cLngCol = getColIndex(coHead, ['経度']);
 
            for(let i=1; i<coordsData.length; i++) {
                const row = coordsData[i];
                const addr = cAddrCol !== -1 ? (row[cAddrCol] || '').trim() : '';
                if(!addr || cLatCol === -1 || cLngCol === -1 || !row[cLatCol] || !row[cLngCol]) continue;
                const storeName = cNameCol !== -1 ? String(row[cNameCol] || '').trim() : '';
                if (hiddenAddr.has(addr) || hiddenName.has(storeName)) { hiddenCount++; continue; } // MAP表示 = OFF
                
                const stat = statusMap[addr] || { updatedAt: '', poster: 'ー', register: 'ー', tissue: 'ー', gate: 'ー', jack: 'ー', unavailable: '' };
                const locInfo = extractPrefAndCity(addr);
 
                let catName = cCatCol !== -1 ? (row[cCatCol] || '').trim() : '';
                
                // アイコンリストに未登録のカテゴリは「専門店」に書き換えて集約
                if (catName && !icons[catName]) {
                    catName = '専門店';
                }
 
                stores.push({
                    idx: stores.length, name: cNameCol !== -1 ? row[cNameCol] : '', category: catName,
                    pref: locInfo.pref, city: locInfo.city, lat: parseFloat(row[cLatCol]), lng: parseFloat(row[cLngCol]),
                    updatedAt: stat.updatedAt, unavailable: stat.unavailable,
                    records: { tissue: stat.tissue, poster: stat.poster, gate: stat.gate, register: stat.register, jack: stat.jack }, marker: null
                });
            }
        }
        
        initMap(); 
        initSearchUI();
        initProductZone();                 // ④ 商材ゾーン
        renderDeadlines(deadlineData);     // ③ 申込期日の進捗ゾーン
        filterMap();                       // ⑦ 件数とリストを作る
        setView(DEFAULT_VIEW, false);      // ⑥ リスト/MAP の初期表示
        if (hiddenCount > 0) console.log('MAP表示=OFF のため除外した店舗:', hiddenCount);
 
        getUserLocation(true);
 
    } catch(err) { console.error(err); showError("⚠️ システムエラーが発生しました。"); }
}
 
// 広告実績の値(○ × ー など)を、太さの揃った記号(SVG)のHTMLに変換する(size: 記号の大きさ)
function recordBadge(v, size = 28) {
    const t = (v || '').toString().trim();
    // ○ = OK(緑の太い輪)
    if(['○', '◯', '〇', 'o', 'O'].includes(t)) {
        return `<span class="rec-badge" aria-label="OK"><svg viewBox="0 0 24 24" width="${size}" height="${size}"><circle cx="12" cy="12" r="8.5" fill="none" stroke="#16a34a" stroke-width="3.2"/></svg></span>`;
    }
    // × = NG(赤の太いバツ)
    if(['×', '✕', '✖', 'x', 'X'].includes(t)) {
        return `<span class="rec-badge" aria-label="NG"><svg viewBox="0 0 24 24" width="${size}" height="${size}"><path d="M5.5 5.5 L18.5 18.5 M18.5 5.5 L5.5 18.5" stroke="#dc2626" stroke-width="3.4" stroke-linecap="round" fill="none"/></svg></span>`;
    }
    // ー = 実績なし(薄いグレー)
    if(t === '' || ['ー', '-', '―', '—', '－'].includes(t)) return '<span class="rec-badge rec-none">ー</span>';
    return `<span class="rec-badge rec-other">${t}</span>`; // それ以外の値(△・数字など)はそのまま表示
}
 
function initMap() {
    map = L.map('map', { doubleClickZoom: true, tap: false }).setView([35.6895, 139.6917], 5);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap' }).addTo(map);
    
    map.on('click', () => { if(searchOpen) toggleSearch(); });
    map.on('dragstart', () => { if(searchOpen) toggleSearch(); });
    // ポップアップが地図の上端からはみ出したら、見える位置まで地図を動かす(上の切り替えバーの下に隠れないように)
    map.on('popupopen', () => setTimeout(() => {
        const pop = document.querySelector('.leaflet-popup'); if(!pop) return;
        const pr = pop.getBoundingClientRect(), mr = map.getContainer().getBoundingClientRect();
        const over = mr.top + 10 - pr.top;
        if(over > 0) map.panBy([0, -over]);
    }, 500)); // Leaflet自身の自動移動(約0.25秒)が終わってから補正する
 
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
            <div class="popup-header">${iconSrc ? `<img class="popup-icon" src="${iconSrc}" alt="">` : ''}<span>${store.name}</span></div>
            <div class="popup-body">
                <div class="status-row"><span class="text-gray-500">更新日</span><span class="font-bold bg-gray-100 px-2 rounded">${dateText}</span></div>
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
            renderStoreList(true); // 「現在地から近い順」「距離」を更新
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
 
        // 検索条件を初期状態に戻す(距離・都道府県・市区町村・カテゴリ・掲載不可表示・地図位置)
        window.resetFilters = function() {
            const rad = document.getElementById('radius-input'); if(rad) rad.value = '';
            const pSel = document.getElementById('pref-select'); if(pSel) pSel.value = '';
            updateCities(); // 市区町村の選択肢も空に戻す
            const unav = document.getElementById('show-unavailable'); if(unav) unav.checked = true;
            appliedFilter = { radius: '', pref: '', city: '' };
            activeCategories = [...cats];
            renderCategoryButtons();
            catCont.scrollLeft = 0;
            filterMap();
            // 地図を初期表示に戻す(現在地があれば現在地、なければ全店舗が入る範囲)
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
 
// 「決定」ボタンで確定した検索条件(距離・都道府県・市区町村)
let appliedFilter = { radius: '', pref: '', city: '' };
let noticeTimer = null;
 
// 一時的なお知らせを上部に3.5秒だけ表示
function showNotice(msg) {
    const eb = document.getElementById('error-banner'); if(!eb) return;
    eb.innerText = msg; eb.style.display = 'block';
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => { eb.style.display = 'none'; }, 3500);
}
 
// 指定した店舗がすべて入る範囲に地図を動かす
function fitStores(list, extraPoint) {
    const pts = list.filter(s => !isNaN(s.lat) && !isNaN(s.lng)).map(s => [s.lat, s.lng]);
    if(extraPoint) pts.push(extraPoint);
    if(pts.length > 0) map.fitBounds(pts, { padding: [50, 50], maxZoom: 15 });
}
 
// 決定ボタン: 入力された条件を確定して、ピンの絞り込みと地図の移動を行う
window.applySearch = function() {
    const rad = (document.getElementById('radius-input')?.value || '').trim();
    const pref = document.getElementById('pref-select')?.value || '';
    const city = document.getElementById('city-select')?.value || '';
 
    if(rad && !(userLat && userLng)) {
        showNotice('現在地を取得できていないため、距離では絞り込めません');
        return;
    }
    appliedFilter = { radius: rad, pref: pref, city: city };
    filterMap();
 
    // 絞り込み後に表示されている店舗へ地図を移動
    const visible = stores.filter(isStoreVisible);
    if(visible.length === 0) { showNotice('条件に合う店舗がありません'); return; }
    runOnMap(() => fitStores(visible, rad ? [userLat, userLng] : null));
 
    if(searchOpen) toggleSearch(); // 検索パネルを閉じて、結果(リスト/MAP)の位置までスクロールする
    scrollToToggle();
};
 
// 「MAP表示」列の値が OFF 相当か(空欄・ON は表示)
function isOffValue(v) {
    const t = String(v == null ? '' : v).trim().toUpperCase();
    return ['OFF', 'FALSE', '非表示', 'NO', '0'].includes(t);
}
 
// 検索条件(距離・都道府県・市区町村・カテゴリ・掲載不可)に合う店舗か。地図とリストで共通
function isStoreVisible(s) {
    const f = appliedFilter;
    if (f.pref && s.pref !== f.pref) return false;
    if (f.city && s.city !== f.city) return false;
    if (!activeCategories.includes(s.category)) return false;
    const elUnav = document.getElementById('show-unavailable');
    if (elUnav && !elUnav.checked && s.unavailable !== '') return false;
    if (f.radius && userLat && userLng && getDistance(userLat, userLng, s.lat, s.lng) > parseFloat(f.radius)) return false;
    return true;
}
 
window.filterMap = function() {
    stores.forEach(s => {
        if(!s.marker) return;
        const v = isStoreVisible(s);
        if(v) { if(!map.hasLayer(s.marker)) s.marker.addTo(map); } else { if(map.hasLayer(s.marker)) map.removeLayer(s.marker); }
    });
    renderStoreList(true);
}
 
let searchOpen = false;
function toggleSearch() {
    searchOpen = !searchOpen; const panel = document.getElementById('search-contents'), chev = document.getElementById('search-chevron');
    if(searchOpen) { if(panel) panel.classList.remove('hidden'); if(chev) chev.style.transform = 'rotate(180deg)'; } 
    else { if(panel) panel.classList.add('hidden'); if(chev) chev.style.transform = 'rotate(0deg)'; }
}
 
/* ============================================================
 * ④ 商材ゾーン(ページ内に常時表示)
 * ============================================================ */
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
    let optsHtml = prod.options.map((opt, i) => `<option value="${i}">${opt.label}</option>`).join('');
    const content = document.getElementById('product-content'); if(!content) return;
 
    content.innerHTML = `
        <h2 class="text-[17px] font-bold mb-4 leading-snug text-gray-800">${prod.title || ''}</h2>
        ${prod.imageUrl ? `<img src="${prod.imageUrl}" class="product-image" alt="画像" onerror="this.style.display='none'">` : ''}
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
 
/* ============================================================
 * ③ 申込までの期日進捗ゾーン
 *   スプレッドシートの「申込期日」タブ: 項目名 / 開始日 / 締切日 / 備考
 *   (タブがない・データがない・締切が過ぎたものは表示しません)
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
        if(left < 0) continue; // 締切を過ぎたものは出さない
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
function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
 
// 地図が見えているときは今すぐ実行、リスト表示中は「MAPに切り替えたとき」に実行
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
 
// 並び替えの更新日用: 日付文字列 → 数値(新しいほど大きい。日付なしは0)
function dateKey(str) { const d = parseDateLoose(str); return d ? d.getTime() : 0; }
 
function getVisibleSorted() {
    const list = stores.filter(isStoreVisible);
    const sel = document.getElementById('sort-select');
    let mode = sel ? sel.value : 'distance';
    const hasLoc = userLat !== null && userLng !== null;
    if(mode === 'distance' && !hasLoc) mode = 'pref'; // 現在地がないときは都道府県順
    const dist = s => getDistance(userLat, userLng, s.lat, s.lng);
    const prefIdx = s => { const i = PREF_ORDER.indexOf(s.pref); return i === -1 ? 999 : i; };
    list.sort((a, b) => {
        if(mode === 'distance') return dist(a) - dist(b);
        if(mode === 'updated') return dateKey(b.updatedAt) - dateKey(a.updatedAt);
        if(mode === 'name') return String(a.name).localeCompare(String(b.name), 'ja');
        return (prefIdx(a) - prefIdx(b)) || String(a.city).localeCompare(String(b.city), 'ja') || String(a.name).localeCompare(String(b.name), 'ja');
    });
    return list;
}
 
function storeCardHtml(s) {
    const ic = icons[s.category] || defaultIconObj;
    const src = (ic && ic.options && ic.options.iconUrl) ? ic.options.iconUrl : '';
    const dist = (userLat !== null && userLng !== null) ? getDistance(userLat, userLng, s.lat, s.lng).toFixed(1) + 'km' : '';
    const meta = [esc(s.pref) + ' ' + esc(s.city), s.category ? esc(s.category) : '', dist ? '現在地から ' + dist : ''].filter(Boolean).join(' ・ ');
    const r = s.records;
    const body = s.unavailable !== ''
        ? '<div class="store-unav">掲載不可(施設都合上)</div>'
        : '<div class="store-rec">' + [['ボックス', r.tissue], ['ポスター', r.poster], ['ゲート', r.gate], ['手渡し', r.register], ['ジャック', r.jack]]
            .map(([label, v]) => `<div class="rec-chip"><span>${label}</span>${recordBadge(v, 18)}</div>`).join('') + '</div>';
    return `<div class="store-card">
        <div class="store-head">${src ? `<img class="store-icon" src="${src}" alt="">` : ''}<div class="store-name">${esc(s.name)}</div>
            <button type="button" class="store-mapbtn" onclick="focusStore(${s.idx})">地図で見る</button></div>
        <div class="store-meta">${meta}</div>
        <div class="store-date">更新日 <b>${esc(s.updatedAt || '未実施')}</b></div>
        ${body}
    </div>`;
}
 
window.renderStoreList = function(reset) {
    if(reset !== false) listLimit = 50;
    const box = document.getElementById('store-list'); if(!box) return;
    const list = getVisibleSorted();
    const cnt = document.getElementById('result-count'); if(cnt) cnt.textContent = `${list.length}件`;
    box.innerHTML = list.length ? list.slice(0, listLimit).map(storeCardHtml).join('') : '<div class="list-empty">条件に合う店舗がありません</div>';
    const more = document.getElementById('list-more');
    if(more) { more.style.display = list.length > listLimit ? 'block' : 'none'; more.textContent = `さらに表示(残り ${list.length - listLimit} 件)`; }
}
 
window.showMoreStores = function() { listLimit += 50; renderStoreList(false); }
 
// リストの「地図で見る」: MAPに切り替えて、その店舗にズームしてポップアップを開く
window.focusStore = function(idx) {
    const s = stores[idx]; if(!s) return;
    pendingMapAction = null; // 検索で予約していた「範囲への移動」は取り消して、この店舗へ移動する
    setView('map');
    setTimeout(() => {
        map.stop(); map.invalidateSize(); map.setView([s.lat, s.lng], 16, { animate: false });
        if(s.marker) { if(!map.hasLayer(s.marker)) s.marker.addTo(map); setTimeout(() => s.marker.openPopup(), 150); }
    }, 300);
}
 
window.onload = initApp;
Claude が応答を完了しました
