// Vercel Serverless Function：展開 Google Map 連結 → 座標 + 名稱 + 城市/區/國家
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const HOST = /(^|\.)(google\.[a-z.]+|goo\.gl|g\.co|share\.google)$/i;
const NOMI = { 'User-Agent': 'my-places-app/1.0 (personal use)' };

function fromUrl(s) {
  let d = s;
  try { d = decodeURIComponent(s); } catch (e) {}
  const m = d.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/) ||
            d.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/) ||
            d.match(/[?&](?:q|ll|query|center|destination)=(-?\d+\.\d+),\s*(-?\d+\.\d+)/);
  return m ? { lat: +m[1], lng: +m[2] } : null;
}

// 依可靠程度排序；APP_INITIALIZATION_STATE 是畫面預設位置，最不可靠，放最後
function candidatesFromHtml(h) {
  const out = [];
  let m = h.match(/center=(-?\d+\.\d+)(?:%2C|,)(-?\d+\.\d+)/);
  if (m) out.push({ lat: +m[1], lng: +m[2] });
  m = h.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
  if (m) out.push({ lat: +m[1], lng: +m[2] });
  m = h.match(/\[null,null,(-?\d+\.\d+),(-?\d+\.\d+)\]/);
  if (m) out.push({ lat: +m[1], lng: +m[2] });
  m = h.match(/APP_INITIALIZATION_STATE=\[\[\[(?:-?[\d.e+]+),(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (m) out.push({ lat: +m[2], lng: +m[1] });
  return out;
}

// Vercel 伺服器在美國維吉尼亞州 Ashburn。Google 抓不到地點時，會回傳以伺服器位置為中心的預設畫面，要排除。
function suspicious(c) {
  return c.lat > 38.84 && c.lat < 39.24 && c.lng > -77.69 && c.lng < -77.29;
}

function unent(s) {
  return s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

function nameFrom(finalUrl, html) {
  const m = finalUrl.match(/\/place\/([^\/@?]+)/);
  if (m) {
    let n = m[1].replace(/\+/g, ' ');
    try { n = decodeURIComponent(n); } catch (e) {}
    if (!/^-?\d+\.\d+,/.test(n)) return n;
  }
  const t = html.match(/property="og:title"[^>]*content="([^"]*)"/) || html.match(/content="([^"]*)"[^>]*property="og:title"/);
  if (t) return unent(t[1]).split(' · ')[0].replace(/\s*-\s*Google.*$/, '').trim();
  return '';
}

// 「104臺北市中山區新生里錦州街123號曾家豆漿」→ 地址 + 店名
function splitName(n) {
  const s = n.replace(/^\d{3,6}\s*/, '').trim();
  const m = s.match(/^(.{2,40}?\d+(?:之\d+)?號)\s*(.*)$/);
  if (m) return { addr: m[1], name: m[2].trim() || m[1] };
  if (/[路街巷]/.test(s) && /\d/.test(s)) return { addr: s, name: n };
  return { addr: '', name: n };
}

// 名稱明顯是台灣地址或地名（排除東京台東區這類日本地名）
function nameSaysTW(n) {
  return /[臺台][北中南東]|新北|桃園|新竹|基隆|宜蘭|苗栗|彰化|南投|雲林|嘉義|高雄|屏東|花蓮|澎湖|金門|連江/.test(n) &&
         !/東京|大阪|京都|日本|福岡|沖繩/.test(n);
}

// OSM 的名稱常是「簡體;繁體」或「甲 / 乙」多個寫法，只留一個中文寫法
function clean(s) {
  if (!s) return '';
  const parts = String(s).split(/\s*[;\/／]\s*/).map(x => x.trim()).filter(Boolean);
  const zh = parts.filter(x => /[\u4e00-\u9fff]/.test(x));
  return zh.length ? zh[zh.length - 1] : (parts[0] || '');
}

async function area(lat, lng) {
  const r = await fetch(
    `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=12&addressdetails=1&accept-language=zh-TW,en&lat=${lat}&lon=${lng}`,
    { headers: NOMI }
  );
  const a = (await r.json()).address || {};
  let city = a.city || a.state || a.county || a.province || '';
  const ward = Object.values(a).find(v => typeof v === 'string' && /[區区]$/.test(v));
  let district = ward || a.suburb || a.city_district || a.district || a.borough || a.town || a.village || a.neighbourhood || '';
  if (a.state && a.city && /[区區]$/.test(a.city) && a.state !== a.city) { district = a.city; city = a.state; }
  if (!district && a.county && a.county !== city) district = a.county;
  if (district === city) district = '';
  return { city: clean(city) || '未分類', district: clean(district) || '未分類', country: clean(a.country || '') };
}

// 用地址查座標（Google 網頁抓不到座標時的備案）。找不到門牌時退而求其次用街道，並標示為約略位置
async function geocodeAddr(addr, cc) {
  const noLi = addr.replace(/(?<=[區鄉鎮市])[\u4e00-\u9fff]{1,3}[里村]/, '');
  const street = noLi.replace(/\d+(?:之\d+)?號.*$/, '').replace(/[,，\s]+$/, '');
  const tries = [[addr, false]];
  if (noLi !== addr) tries.push([noLi, false]);
  if (street && street !== noLi) tries.push([street, true]);
  for (const [q, approx] of tries) {
    if (!q) continue;
    try {
      const r = await fetch(
        `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&accept-language=zh-TW,en&q=${encodeURIComponent(q)}${cc ? '&countrycodes=' + cc : ''}`,
        { headers: NOMI }
      );
      const j = await r.json();
      if (j && j[0]) return { lat: +j[0].lat, lng: +j[0].lon, approx };
    } catch (e) {}
  }
  return null;
}

// Google 官方 Places API (New) 文字搜尋：用「店名 + 地址」找出準確座標。金鑰放在 Vercel 環境變數 GOOGLE_PLACES_KEY
async function googleFind(name, addr, tw) {
  const key = process.env.GOOGLE_PLACES_KEY;
  if (!key) return { err: '尚未設定 GOOGLE_PLACES_KEY' };
  const q = addr && name && name !== addr ? name + ' ' + addr : (addr || name);
  if (!q) return { err: '沒有可查詢的名稱' };
  try {
    const r = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': key,
        'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location'
      },
      body: JSON.stringify(Object.assign({ textQuery: q, languageCode: 'zh-TW', pageSize: 1 }, tw ? { regionCode: 'TW' } : {})),
      signal: AbortSignal.timeout(8000)
    });
    const j = await r.json();
    if (!r.ok) return { err: 'Google 查詢失敗：' + ((j.error && j.error.message) || r.status) };
    const p = j.places && j.places[0];
    if (!p || !p.location) return { err: 'Google 沒有找到這個地點' };
    if (tw && !/[臺台]灣|taiwan/i.test(p.formattedAddress || '')) return { err: 'Google 找到的地點不在台灣' };
    return { lat: p.location.latitude, lng: p.location.longitude, approx: !addr };
  } catch (e) {
    return { err: 'Google 查詢失敗：' + e.message };
  }
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  // 只查國家與區域（不經過 Google）：/api/resolve?lat=..&lng=..
  if (req.query && req.query.lat && req.query.lng) {
    const la = Number(req.query.lat), ln = Number(req.query.lng);
    if (!isFinite(la) || !isFinite(ln)) return res.status(400).json({ error: '座標格式不正確' });
    try { const ar = await area(la, ln); return res.status(200).json({ lat: la, lng: ln, ...ar }); }
    catch (e) { return res.status(500).json({ error: '查詢失敗：' + e.message }); }
  }
  const raw = String((req.query && req.query.url) || '');
  const u = raw.match(/https?:\/\/[^\s]+/);
  if (!u) return res.status(400).json({ error: '找不到連結，請貼上 Google Map 的分享連結' });
  let host;
  try { host = new URL(u[0]).hostname; } catch (e) { return res.status(400).json({ error: '連結格式不正確' }); }
  if (!HOST.test(host)) return res.status(400).json({ error: '只支援 Google Map 連結' });

  try {
    const r = await fetch(u[0], {
      redirect: 'follow',
      headers: { 'User-Agent': UA, 'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8', Cookie: 'CONSENT=YES+1; SOCS=CAI' }
    });
    const finalUrl = r.url;
    const html = await r.text();
    const rawName = nameFrom(finalUrl, html);
    const sp = splitName(rawName);
    const name = sp.name || rawName;
    const tw = nameSaysTW(rawName);

    const cands = [];
    const fu = fromUrl(finalUrl);
    if (fu) cands.push(fu);
    cands.push(...candidatesFromHtml(html));
    let c = cands.find(x => !suspicious(x)) || null;
    let ar = c ? await area(c.lat, c.lng).catch(() => null) : null;
    let approx = false, via = 'link', dbg = '';

    // 沒有可靠座標，或名稱是台灣地址但座標卻落在海外：先問 Google，再退回免費地址查詢
    const wrongPlace = c && tw && ar && !/[臺台]灣|taiwan/i.test(ar.country);
    if (!c || wrongPlace) {
      let g = null;
      const gr = await googleFind(name, sp.addr, tw);
      if (gr.lat !== undefined) { g = gr; via = 'google'; } else dbg = gr.err;
      if (!g && sp.addr) { g = await geocodeAddr(sp.addr, tw ? 'tw' : ''); if (g) via = 'osm'; }
      if (g) { c = g; approx = !!g.approx; ar = await area(g.lat, g.lng).catch(() => null); }
      else c = null;
    }
    // 還是沒有：把名稱和連結交還給網頁，讓使用者在地圖上點選位置
    if (!c) return res.status(422).json({ error: '找不到這個地點的座標', name: name || '未命名地點', url: finalUrl, debug: dbg });
    if (!ar) ar = { city: '未分類', district: '未分類', country: '' };
    res.status(200).json({ name: name || '未命名地點', lat: c.lat, lng: c.lng, city: ar.city, district: ar.district, country: ar.country || '', approx, via, url: finalUrl });
  } catch (e) {
    res.status(500).json({ error: '解析失敗：' + e.message });
  }
};
module.exports._t = { googleFind, fromUrl, candidatesFromHtml, suspicious, nameFrom, nameSaysTW, clean, splitName };
