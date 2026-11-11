// Vercel Serverless Function：展開 Google Map 連結 → 座標 + 名稱 + 城市/區
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const HOST = /(^|\.)(google\.[a-z.]+|goo\.gl|g\.co)$/i;

function fromUrl(s) {
  let d = s;
  try { d = decodeURIComponent(s); } catch (e) {}
  const m = d.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/) ||
            d.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/) ||
            d.match(/[?&](?:q|ll|query|center|destination)=(-?\d+\.\d+),\s*(-?\d+\.\d+)/);
  return m ? { lat: +m[1], lng: +m[2] } : null;
}

function fromHtml(h) {
  let m = h.match(/APP_INITIALIZATION_STATE=\[\[\[(?:-?[\d.e+]+),(-?\d+\.\d+),(-?\d+\.\d+)/); // 順序：lng, lat
  if (m) return { lat: +m[2], lng: +m[1] };
  m = h.match(/center=(-?\d+\.\d+)(?:%2C|,)(-?\d+\.\d+)/);
  if (m) return { lat: +m[1], lng: +m[2] };
  m = h.match(/\[null,null,(-?\d+\.\d+),(-?\d+\.\d+)\]/);
  if (m) return { lat: +m[1], lng: +m[2] };
  return null;
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

async function area(lat, lng) {
  const r = await fetch(
    `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=14&addressdetails=1&accept-language=zh-TW,en&lat=${lat}&lon=${lng}`,
    { headers: { 'User-Agent': 'my-places-app/1.0 (personal use)' } }
  );
  const a = (await r.json()).address || {};
  let city = a.city || a.state || a.county || a.province || '';
  let district = a.suburb || a.city_district || a.district || a.borough || a.town || a.village || a.neighbourhood || '';
  // 日本：city 其實是「區」(港区)，上一層才是都道府縣
  if (a.state && a.city && /[区區]$/.test(a.city) && a.state !== a.city) { district = a.city; city = a.state; }
  if (!district && a.county && a.county !== city) district = a.county;
  if (district === city) district = '';
  return { city: city || '未分類', district: district || '未分類' };
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
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
    const c = fromUrl(finalUrl) || fromHtml(html);
    if (!c) return res.status(422).json({ error: '這個連結解析不出座標，請換用「分享」→「複製連結」再試一次' });
    const [name, ar] = await Promise.all([Promise.resolve(nameFrom(finalUrl, html)), area(c.lat, c.lng).catch(() => ({ city: '未分類', district: '未分類' }))]);
    res.status(200).json({ name: name || '未命名地點', lat: c.lat, lng: c.lng, city: ar.city, district: ar.district, url: finalUrl });
  } catch (e) {
    res.status(500).json({ error: '解析失敗：' + e.message });
  }
};
module.exports._t = { fromUrl, fromHtml, nameFrom };
