/* ==========================================================================
   Notlar — yayınlanan veriyi canlı GitHub dosyasından okur.
   GitHub Pages build'ini beklemeden içerik değişikliklerini gösterir.
   ========================================================================== */

const OWNER = 'mesutkuzu';
const REPO = 'notlar';
const BRANCH = 'main';
const IS_LOCAL = ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);
const RAW_BASE = `https://raw.githubusercontent.com/${OWNER}/${REPO}/${BRANCH}`;

function withVersion(url) {
  const target = new URL(url, document.baseURI);
  target.searchParams.set('t', Date.now().toString(36));
  return target.href;
}

async function requestJSON(url) {
  const response = await fetch(withVersion(url), { cache: 'no-store' });
  if (!response.ok) throw new Error(`İstek başarısız (${response.status})`);
  return response.json();
}

export async function loadPosts() {
  if (IS_LOCAL) return requestJSON('data/posts.json');
  try {
    return await requestJSON(`${RAW_BASE}/data/posts.json`);
  } catch {
    return requestJSON('data/posts.json');
  }
}

export async function loadSite() {
  if (IS_LOCAL) return requestJSON('data/site.json');
  try {
    return await requestJSON(`${RAW_BASE}/data/site.json`);
  } catch {
    return requestJSON('data/site.json');
  }
}
