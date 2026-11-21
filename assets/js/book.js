/* ==========================================================================
   Notlar — 3B kitap motoru
   Sayfalar gerçek yapraklar gibi çevrilir; her yazı kendi hikâyesidir.
   ========================================================================== */

import {
  formatLong,
  formatShort,
  normalizePosts,
  postTitle,
  escapeHTML,
  safeImageUrl,
  debounce,
  clamp
} from './core.js?v=20261121b';
import { loadPosts, loadSite } from './data.js?v=20261121b';
import { renderMarkdown } from './markdown.js?v=20261121b';
import { storyArt } from './story-art.js?v=20261121b';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const DEFAULT_SITE = {
  title: 'Notlar',
  description: 'Sıkılınca yazarım..',
  author: ''
};

const SIDE_TOLERANCE = 1;
const COLOPHON_START = new Date(2003, 2, 21, 0, 0, 0);
const artPreloads = [];

const state = {
  posts: [],
  site: { ...DEFAULT_SITE },
  pages: [],
  leaves: [],
  spreads: 0,
  currentPage: 0,
  closed: true,
  coverNode: null,
  backCoverNode: null,
  mode: 'spread',
  layout: { pageW: 0, pageH: 0, single: false },
  animating: false,
  pointer: null,
  ignoreClickUntil: 0,
  loaded: false
};

const dom = {};

function cacheDom() {
  dom.scene = $('#kitap');
  dom.loader = $('#book-loader');
  dom.area = $('#book-area');
  dom.book = $('#book');
  dom.single = $('#single-book');
  dom.singleBase = $('#single-base');
  dom.singleFlip = $('#single-flip');
  dom.leaves = $('#book-leaves');
  dom.baseLeft = $('#base-left');
  dom.baseRight = $('#base-right');
  dom.prev = $('#prev-page');
  dom.next = $('#next-page');
  dom.status = $('#book-status');
  dom.progress = $('#book-progress');
  dom.hint = $('#drag-hint');
  dom.error = $('#book-error');
  dom.retry = $('#retry-load');
  dom.tocButton = $('#toc-button');
  dom.flatIndex = $('#flat-index');
  dom.footEdition = $('#foot-edition');
}

/* --------------------------------------------------------------------------
   Başlangıç
   -------------------------------------------------------------------------- */

function init() {
  cacheDom();
  bindEvents();

  if (new URLSearchParams(location.search).has('onizleme') && window.parent !== window) {
    initStudioPreview();
    return;
  }

  preloadStoryArt();
  startColophonTimer();

  const fontsReady = document.fonts?.ready ? document.fonts.ready : Promise.resolve();
  Promise.race([fontsReady, wait(3200)]).then(loadAndRender);
}

// Drafts stay between the editor and its same-origin book frame.
function initStudioPreview() {
  let revision = 0;
  window.addEventListener('message', async (event) => {
    if (event.origin !== location.origin || event.source !== window.parent) return;
    if (event.data?.type !== 'notlar:preview' || !event.data.post) return;
    const current = ++revision;
    await document.fonts.ready;
    while (state.animating) await wait(100);
    if (current !== revision) return;
    state.site = { ...DEFAULT_SITE, ...event.data.site };
    state.posts = normalizePosts([event.data.post]);
    state.pages = [];
    state.coverNode = null;
    state.backCoverNode = null;
    state.closed = false;
    state.currentPage = 0;
    applySite();
    layoutAndRender();
    const first = state.pages.findIndex((page) => page.postId === state.posts[0]?.id);
    if (first >= 0) jumpTo(first);
  });
  window.parent.postMessage({ type: 'notlar:preview-ready' }, location.origin);
}

async function loadAndRender() {
  try {
    await loadData();
  } catch (error) {
    console.error('[Notlar] Kitap yüklenemedi:', error);
    showError();
    return;
  }

  applySite();
  state.currentPage = 0;
  layoutAndRender(true);
}

async function loadData() {
  const [postsPayload, sitePayload] = await Promise.all([
    loadPosts(),
    loadSite().catch(() => null)
  ]);

  const raw = Array.isArray(postsPayload)
    ? postsPayload
    : postsPayload && Array.isArray(postsPayload.posts)
      ? postsPayload.posts
      : [];

  state.posts = normalizePosts(raw).sort((a, b) => a.date.localeCompare(b.date));

  if (sitePayload && typeof sitePayload === 'object') {
    state.site = { ...DEFAULT_SITE, ...sitePayload };
  }

  state.loaded = true;
}

function applySite() {
  const title = state.site.title || DEFAULT_SITE.title;
  const description = state.site.description || DEFAULT_SITE.description;
  const author = state.site.author || '';
  const lower = title.toLocaleLowerCase('tr');
  const year = new Date().getFullYear();

  document.title = `${title} — Bir yazı defteri`;

  const brand = $('.brand-text');
  if (brand) brand.textContent = lower;

  setMeta('name', 'description', description);
  setMeta('name', 'author', author || title);
  setMeta('property', 'og:title', `${title} — Bir yazı defteri`);
  setMeta('property', 'og:description', description);
  setMeta('name', 'twitter:title', `${title} — Bir yazı defteri`);
  setMeta('name', 'twitter:description', description);

  if (dom.footEdition) dom.footEdition.textContent = String(year);

  dom.flatIndex.innerHTML = state.posts
    .map(
      (post) =>
        `<a href="post.html?id=${encodeURIComponent(post.id)}">${escapeHTML(postTitle(post))}</a>`
    )
    .join('');
}

function setMeta(attribute, name, value) {
  const meta = $(`meta[${attribute}="${name}"]`);
  if (meta) meta.setAttribute('content', value);
}

/* --------------------------------------------------------------------------
   Görselleri önceden yükle & son sayfa sayacı
   -------------------------------------------------------------------------- */

// Book illustrations sit on offscreen leaves, so lazy loading makes them
// appear only after the page is already turning. Start their download with
// the page itself and keep a reference so the cache stays warm.
function preloadStoryArt() {
  const seen = new Set();

  for (const list of Object.values(storyArt)) {
    if (!Array.isArray(list)) continue;

    for (const art of list) {
      const src = art?.src;
      if (!src || seen.has(src)) continue;
      seen.add(src);

      const image = new Image();
      image.decoding = 'async';
      image.loading = 'eager';
      image.src = src;
      artPreloads.push(image);
    }
  }
}

// Calendar-aware difference: 21 March 2003 -> today in full years, months,
// days, hours, minutes and seconds.
function elapsedSince(start, now = new Date()) {
  if (now <= start) {
    return { years: 0, months: 0, days: 0, hours: 0, minutes: 0, seconds: 0 };
  }

  let years = now.getFullYear() - start.getFullYear();
  let months = now.getMonth() - start.getMonth();
  let days = now.getDate() - start.getDate();
  let hours = now.getHours() - start.getHours();
  let minutes = now.getMinutes() - start.getMinutes();
  let seconds = now.getSeconds() - start.getSeconds();

  if (seconds < 0) {
    seconds += 60;
    minutes -= 1;
  }

  if (minutes < 0) {
    minutes += 60;
    hours -= 1;
  }

  if (hours < 0) {
    hours += 24;
    days -= 1;
  }

  if (days < 0) {
    days += new Date(now.getFullYear(), now.getMonth(), 0).getDate();
    months -= 1;
  }

  if (months < 0) {
    months += 12;
    years -= 1;
  }

  return { years, months, days, hours, minutes, seconds };
}

function updateColophonTimers() {
  const timers = document.querySelectorAll('.colophon-timer');
  if (!timers.length) return;

  const elapsed = elapsedSince(COLOPHON_START);

  for (const timer of timers) {
    for (const [unit, value] of Object.entries(elapsed)) {
      const node = timer.querySelector(`[data-unit="${unit}"]`);
      if (node) node.textContent = String(value).padStart(2, '0');
    }
  }
}

function startColophonTimer() {
  updateColophonTimers();
  window.setInterval(updateColophonTimers, 1000);
}

/* --------------------------------------------------------------------------
   Ölçü & sayfa üretimi
   -------------------------------------------------------------------------- */

function computeLayout() {
  const sceneRect = dom.scene.getBoundingClientRect();
  const single = window.innerWidth < 700;

  if (single) {
    const availW = Math.max(260, sceneRect.width - 24);
    const availH = Math.max(340, sceneRect.height - 24);

    let pageW = Math.min(460, availW);
    let pageH = Math.min(availH, pageW * 1.95);

    pageW = Math.min(pageW, pageH / 1.35);
    pageH = Math.min(pageH, pageW * 2);
    pageW = Math.max(230, Math.floor(pageW));
    pageH = Math.max(340, Math.floor(pageH));

    return {
      pageW,
      pageH,
      single: true,
      bookW: pageW
    };
  }

  const availW = Math.max(300, sceneRect.width - 48);
  const availH = Math.max(300, sceneRect.height - 48);

  let pageH = Math.min(availH, 900);
  let pageW = pageH / 1.4;

  if (pageW * 2 > availW) {
    pageW = availW / 2;
    pageH = pageW * 1.4;
  }

  pageW = Math.min(pageW, 640);
  pageH = pageW * 1.4;

  pageW = Math.max(180, Math.floor(pageW));
  pageH = Math.max(250, Math.floor(pageH));

  return {
    pageW,
    pageH,
    single: false,
    bookW: pageW * 2
  };
}

function layoutAndRender(initial = false) {
  const layout = computeLayout();
  const same =
    layout.pageW === state.layout.pageW &&
    layout.pageH === state.layout.pageH &&
    layout.single === state.layout.single &&
    state.pages.length > 0;

  if (same) return;

  const anchor = state.pages.length ? pageAnchor() : null;

  state.layout = layout;
  state.mode = layout.single ? 'single' : 'spread';

  document.body.style.setProperty('--page-w', `${layout.pageW}px`);
  document.body.style.setProperty('--page-h', `${layout.pageH}px`);
  document.body.style.setProperty('--book-w', `${layout.bookW}px`);
  document.body.classList.toggle('is-single', layout.single);

  buildPages();
  state.leaves = [];

  const anchored = findAnchor(anchor);
  let target;

  if (initial) {
    const deep = hasDeepLink();
    state.closed = !deep;
    target = deep ? initialPageIndex() : 0;
  } else {
    target = anchored >= 0 ? anchored : state.currentPage;
  }

  state.currentPage = normalizeTargetPage(target);
  renderBook();
  syncLeaves();
  updateUI();
  updateColophonTimers();

  if (!initial || dom.area.hidden) reveal();
}

function normalizeTargetPage(index) {
  const last = Math.max(0, state.pages.length - 1);
  const value = clamp(Number(index) || 0, 0, last);
  return state.mode === 'spread' ? Math.floor(value / 2) * 2 : value;
}

function initialPageIndex() {
  const params = new URLSearchParams(window.location.search);
  const yazi = params.get('yazi');

  if (yazi) {
    const found = state.pages.findIndex((page) => page.postId === yazi);
    if (found >= 0) return found;
  }

  const sayfa = Number(params.get('sayfa'));
  if (Number.isFinite(sayfa) && sayfa > 0) return sayfa - 1;

  return 0;
}

function hasDeepLink() {
  const params = new URLSearchParams(window.location.search);
  return params.has('sayfa') || params.has('yazi');
}

function pageAnchor() {
  const page = state.pages[state.currentPage];
  if (!page) return null;

  if (state.mode !== 'spread') {
    return { kind: page.kind, postId: page.postId || null, chapter: page.chapter };
  }

  const spread = Math.floor(state.currentPage / 2);
  const left = state.pages[spread * 2];
  const right = state.pages[spread * 2 + 1];
  const preferred = right && right.postId ? right : left;

  if (!preferred) return { kind: page.kind, postId: page.postId || null, chapter: page.chapter };

  return {
    kind: preferred.kind,
    postId: preferred.postId || null,
    chapter: preferred.chapter
  };
}

function findAnchor(anchor) {
  if (!anchor) return -1;

  if (anchor.postId) {
    let index = state.pages.findIndex(
      (page) => page.postId === anchor.postId && page.kind === anchor.kind
    );
    if (index < 0) index = state.pages.findIndex((page) => page.postId === anchor.postId);
    if (index >= 0) return index;
  }

  return state.pages.findIndex((page) => page.kind === anchor.kind);
}

/* --------------------------------------------------------------------------
   Sayfa kurulumu
   -------------------------------------------------------------------------- */

function buildPages() {
  const measure = document.createElement('div');
  measure.className = 'book-measure';
  document.body.appendChild(measure);

  const pages = [makePage('toc', '')];
  const entries = [];

  state.posts.forEach((post, index) => {
    const startIndex = pages.length;
    const storyPages = buildStoryPages(post, index, measure);
    pages.push(...storyPages);
    entries.push({ post, index: startIndex });
  });

  pages[0] = makePage('toc', tocHTML(entries));

  if (pages.length % 2 === 0) {
    pages.push(makePage('blank', '<span class="blank-mark" aria-hidden="true"></span>'));
  }

  pages.push(makePage('colophon', colophonHTML()));

  pages.forEach((page, index) => {
    page.folio = index + 1;
    const folio = page.node.querySelector('.page-folio');
    if (folio) folio.textContent = String(index + 1);
  });

  state.pages = pages.map((page) => ({
    ...page,
    node: page.node
  }));
  state.spreads = Math.ceil(state.pages.length / 2);

  measure.remove();
}

function makePage(kind, innerHTML) {
  const node = document.createElement('div');
  node.className = `book-page page--${kind}`;
  node.dataset.kind = kind;
  node.innerHTML = `<div class="page-inner">${innerHTML}</div>`;
  return { kind, node, postId: null, chapter: null, folio: 0 };
}

function makeCoverPage() {
  const node = document.createElement('div');
  node.className = 'book-page page--cover';
  node.dataset.kind = 'cover';
  node.innerHTML = `<div class="page-inner">${coverHTML()}</div>`;
  return node;
}

function makeBackCover() {
  const node = document.createElement('div');
  node.className = 'book-page page--backcover';
  node.setAttribute('aria-hidden', 'true');
  node.innerHTML = '<div class="page-inner"></div>';
  return node;
}

function titleLines(raw) {
  const title = String(raw || '').trim();
  if (!title) return ['Kanca’nın Ucundakiler'];

  const words = title.split(/\s+/);
  if (title.length > 16 && words.length > 1) {
    const middle = Math.ceil(words.length / 2);
    return [words.slice(0, middle).join(' '), words.slice(middle).join(' ')];
  }

  return [title];
}

function titleMarkup(raw, className) {
  const lines = titleLines(raw);
  const long = lines.length > 1;
  const content = lines
    .map(
      (line, index) =>
        `<span class="${className}__line">${escapeHTML(line)}${
          index === lines.length - 1 ? '<span class="title-dot">.</span>' : ''
        }</span>`
    )
    .join('');

  return `<p class="${className}${long ? ` ${className}--long` : ''}">${content}</p>`;
}

function frameMarkup(className) {
  return `
    <div class="${className}" aria-hidden="true">
      <span class="frame-corner frame-corner--tl"></span>
      <span class="frame-corner frame-corner--tr"></span>
      <span class="frame-corner frame-corner--bl"></span>
      <span class="frame-corner frame-corner--br"></span>
    </div>
  `;
}

function tocHTML(entries) {
  const count = entries.length;
  const bookTitle = escapeHTML(state.site.title || DEFAULT_SITE.title);

  const items = entries
    .map(
      (entry, index) => `
        <button class="toc-entry" type="button" data-goto="${entry.index}">
          <span class="toc-index">${String(index + 1).padStart(2, '0')}</span>
          <span class="toc-title">
            <span class="toc-title-text">${escapeHTML(postTitle(entry.post))}</span>
            <span class="toc-date">${escapeHTML(formatShort(entry.post.date))}</span>
          </span>
          <span class="toc-dots" aria-hidden="true"></span>
          <span class="toc-page">${entry.index + 1}</span>
        </button>`
    )
    .join('');

  return `
    <p class="page-eyebrow">${bookTitle}</p>
    <h2 class="page-title">İçindekiler<span>.</span></h2>
    <p class="page-lede">${
      count
        ? 'Düşünceler, gözlemler, bazen de yaşanmış bir an.'
        : 'İlk not için ilk sayfa boş bırakıldı.'
    }</p>
    ${
      count
        ? `<div class="toc-list">${items}</div>`
        : '<p class="toc-empty">Defter henüz sessiz. İlk not, ilk sayfayı açacak.</p>'
    }
  `;
}

function colophonHTML() {
  const title = state.site.title || DEFAULT_SITE.title;

  return `
    <div class="colophon-content">
      <p class="colophon-book">${escapeHTML(title)}</p>
      <p class="colophon-final">Sadece 70 yıl!</p>
      <section class="colophon-timer" role="timer" aria-live="off" aria-label="Yeryüzünde geçen zaman">
        <p class="colophon-timer-title">Yeryüzünde geçen zaman</p>
        <div class="colophon-timer-grid">
          <span class="timer-unit"><strong data-unit="years">00</strong><small>yıl</small></span>
          <span class="timer-unit"><strong data-unit="months">00</strong><small>ay</small></span>
          <span class="timer-unit"><strong data-unit="days">00</strong><small>gün</small></span>
          <span class="timer-unit"><strong data-unit="hours">00</strong><small>saat</small></span>
          <span class="timer-unit"><strong data-unit="minutes">00</strong><small>dakika</small></span>
          <span class="timer-unit"><strong data-unit="seconds">00</strong><small>saniye</small></span>
        </div>
        <p class="colophon-timer-since">21 Mart 2003’ten bu yana</p>
      </section>
    </div>
  `;
}

function coverHTML() {
  const title = state.site.title || DEFAULT_SITE.title;
  const description = escapeHTML(state.site.description || DEFAULT_SITE.description);

  const initials = (state.site.author || state.site.title || 'Notlar')
    .split(/\s+/).filter(Boolean).slice(0, 2).map(word => word[0]).join('').toLocaleUpperCase('tr');

  return `
    ${frameMarkup('cover-frame')}
    <div class="cover-seal" aria-hidden="true">${escapeHTML(initials[0])}<span>${escapeHTML(initials.slice(1))}</span></div>
    ${titleMarkup(title, 'cover-title')}
    <span class="cover-rule" aria-hidden="true"></span>
    <p class="cover-sub">${description}</p>
  `;
}

/* --------------------------------------------------------------------------
   Hikâye sayfaları & pagination
   -------------------------------------------------------------------------- */

function buildStoryPages(post, chapterIndex, measure) {
  const blocks = htmlToBlocks(renderMarkdown(post.content));
  const pages = [];
  let pageIndex = 0;
  let current = createStoryPage(post, chapterIndex, true);
  let prose = current.node.querySelector('.book-prose');
  let hasContent = false;
  let needsDropcap = true;

  measure.replaceChildren(current.node);

  const finish = () => {
    pages.push(current);
    pageIndex += 1;
    current = createStoryPage(post, chapterIndex, false);
    prose = current.node.querySelector('.book-prose');
    measure.replaceChildren(current.node);
    hasContent = false;
  };

  const queue = blocks.slice();

  while (queue.length) {
    const block = queue[0];

    if (needsDropcap && block.tagName === 'P') {
      block.classList.add('dropcap');
    }

    const probe = block.cloneNode(true);
    prose.appendChild(probe);
    const overflow = isOverflow(current.node);
    prose.removeChild(probe);

    if (!overflow) {
      prose.appendChild(block);
      queue.shift();
      hasContent = true;
      if (needsDropcap && block.tagName === 'P') needsDropcap = false;
      continue;
    }

    if (!hasContent) {
      const split = splitBlock(block, current.node, prose);

      if (split && split.head) {
        prose.appendChild(split.head);
        hasContent = true;
        if (needsDropcap && block.tagName === 'P') needsDropcap = false;

        if (split.rest) queue[0] = split.rest;
        else queue.shift();

        finish();
        continue;
      }

      // Tek başına bile sığmayan bölünemez blok: olduğu gibi bırak.
      prose.appendChild(block);
      queue.shift();
      hasContent = true;
      finish();
      continue;
    }

    finish();
  }

  if (hasContent || pages.length === 0) {
    pages.push(current);
  }

  placeStoryArt(post, pages, measure);
  measure.replaceChildren();
  return pages;
}

// Illustrations use remaining space after text pagination, without adding pages.
function placeStoryArt(post, pages, measure) {
  const art = storyArt[post.id];
  if (!art?.length) return;

  const gap = 18;
  const minimum = Math.min(120, state.layout.pageH * 0.18);
  const slots = pages.map((page, index) => {
    measure.replaceChildren(page.node);
    const flow = page.node.querySelector('.page-flow');
    const prose = page.node.querySelector('.book-prose');
    return {
      index,
      page,
      free: flow.clientHeight - prose.offsetHeight,
      width: flow.clientWidth,
      text: prose.textContent.replace(/\s+/g, ' ')
    };
  });
  const used = new Set();
  let lastIndex = -1;

  for (const illustration of art) {
    const anchor = slots.findIndex(slot => slot.text.includes(illustration.anchor));
    if (anchor < 0) continue;

    const candidates = slots.filter(slot =>
      !used.has(slot.index) && slot.index > lastIndex &&
      slot.free >= minimum + gap + 4 && Math.abs(slot.index - anchor) <= 2
    );
    candidates.sort((a, b) =>
      Math.abs(a.index - anchor) - Math.abs(b.index - anchor) ||
      // Prefer the following page when the referenced paragraph fills its page.
      b.index - a.index
    );
    const slot = candidates[0];
    if (!slot) continue;

    measure.replaceChildren(slot.page.node);
    const figure = document.createElement('figure');
    figure.className = `page-illustration page-illustration--${illustration.position}`;
    const height = Math.floor(Math.min(
      state.layout.pageH * 0.35, slot.width * 0.72, slot.free - gap - 4
    ));
    figure.style.setProperty('--art-height', `${height}px`);
    const img = document.createElement('img');
    img.src = illustration.src;
    img.alt = illustration.alt;
    img.width = 1536;
    img.height = 1024;
    img.loading = 'eager';
    img.decoding = 'async';
    img.addEventListener('error', () => figure.remove(), { once: true });
    figure.append(img);

    const flow = slot.page.node.querySelector('.page-flow');
    if (illustration.position === 'top') flow.before(figure);
    else flow.after(figure);

    if (isOverflow(slot.page.node)) {
      figure.remove();
      continue;
    }
    used.add(slot.index);
    lastIndex = slot.index;
  }
}

function createStoryPage(post, chapterIndex, isOpener) {
  const node = document.createElement('div');
  node.className = `book-page page--story${isOpener ? ' page--chapter' : ''}`;
  node.dataset.kind = isOpener ? 'chapter' : 'content';

  const runningTitle = escapeHTML(postTitle(post));
  const runningDate = escapeHTML(formatShort(post.date));
  const opener = isOpener ? storyOpenerHTML(post, chapterIndex) : '';

  node.innerHTML = `
    <div class="page-inner">
      ${opener || `<div class="page-head"><span class="page-head-title">${runningTitle}</span><span class="page-head-date">${runningDate}</span></div>`}
      <div class="page-flow"><div class="book-prose"></div></div>
      <div class="page-folio"></div>
    </div>
  `;

  return {
    kind: isOpener ? 'chapter' : 'content',
    node,
    postId: post.id,
    chapter: chapterIndex,
    folio: 0
  };
}

function storyOpenerHTML(post, chapterIndex) {
  const title = escapeHTML(postTitle(post));
  const date = escapeHTML(formatLong(post.date));
  const cover = safeImageUrl(post.cover);
  const figure = cover
    ? `<figure class="chapter-cover"><img src="${escapeHTML(cover)}" alt="" loading="lazy" decoding="async"></figure>`
    : '';

  return `
    <header class="page-opener">
      ${figure}
      <p class="chapter-no">${date}</p>
      <h2 class="chapter-title">${title}</h2>
      <span class="chapter-rule" aria-hidden="true"></span>
    </header>
  `;
}

function htmlToBlocks(html) {
  const template = document.createElement('template');
  template.innerHTML = html;
  const blocks = [];

  for (const node of template.content.children) {
    if (node.tagName === 'UL' || node.tagName === 'OL') {
      for (const item of node.children) {
        const list = node.cloneNode(false);
        list.classList.add('list-single');
        list.appendChild(item.cloneNode(true));
        blocks.push(list);
      }
    } else {
      blocks.push(node.cloneNode(true));
    }
  }

  return blocks;
}

function isOverflow(page) {
  const flow = page.querySelector('.page-flow');
  if (!flow) return false;
  return flow.scrollHeight > flow.clientHeight + SIDE_TOLERANCE;
}

function splitBlock(block, page, prose) {
  if (!['P', 'BLOCKQUOTE'].includes(block.tagName)) return null;

  const text = block.textContent || '';
  if (text.trim().length < 12) return null;

  let low = 1;
  let high = text.length;
  let best = 0;

  while (low <= high) {
    const middle = (low + high) >> 1;
    const split = makeSplit(block, boundaryAt(text, middle));
    if (!split) {
      low = middle + 1;
      continue;
    }

    prose.appendChild(split.head);
    const fits = !isOverflow(page);
    prose.removeChild(split.head);

    if (fits) {
      best = split.textLength;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  if (!best) return null;

  const split = makeSplit(block, best);
  if (!split || !split.head || !split.head.textContent.trim()) return null;

  return {
    head: split.head,
    rest: split.rest && split.rest.textContent.trim() ? split.rest : null
  };
}

function boundaryAt(text, index) {
  if (index >= text.length) return text.length;
  const cut = text.lastIndexOf(' ', index);
  return cut > 0 ? cut : index;
}

function makeSplit(block, length) {
  if (!length || length >= (block.textContent || '').length) return null;

  const clone = block.cloneNode(true);
  const point = textPointAt(clone, length);
  if (!point) return null;

  const head = clone.cloneNode(false);
  const range = document.createRange();
  range.setStart(clone, 0);
  range.setEnd(point.node, point.offset);
  head.appendChild(range.extractContents());

  trimStart(clone);
  trimEnd(head);
  head.classList.remove('leaf-face', 'leaf-front', 'leaf-back');
  head.classList.remove('page-inner');

  if (block.classList.contains('dropcap')) clone.classList.remove('dropcap');

  if (!head.textContent.trim()) return null;

  return {
    head,
    rest: clone.textContent.trim() ? clone : null,
    textLength: length
  };
}

function textPointAt(root, offset) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let remaining = offset;
  let node;

  while ((node = walker.nextNode())) {
    const length = node.nodeValue.length;
    if (remaining <= length) return { node, offset: remaining };
    remaining -= length;
  }

  return null;
}

function trimStart(element) {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const first = walker.nextNode();
  if (first) first.nodeValue = first.nodeValue.replace(/^\s+/, '');
}

function trimEnd(element) {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let node;
  let last = null;
  while ((node = walker.nextNode())) last = node;
  if (last) last.nodeValue = last.nodeValue.replace(/\s+$/, '');
}

/* --------------------------------------------------------------------------
   Kitabı DOM'a yerleştir
   -------------------------------------------------------------------------- */

function renderBook() {
  dom.leaves.replaceChildren();
  dom.baseLeft.replaceChildren();
  dom.baseRight.replaceChildren();
  state.leaves = [];

  if (!state.pages.length) return;

  state.coverNode = state.coverNode || makeCoverPage();
  state.backCoverNode = state.backCoverNode || makeBackCover();

  if (state.mode === 'single') {
    dom.book.hidden = true;
    dom.single.hidden = false;
    dom.single.classList.remove('is-dragging');
    dom.singleFlip.replaceChildren();
    dom.singleBase.replaceChildren();
    dom.single.style.setProperty('--turn', '0');
    renderSingleBase();
    return;
  }

  dom.book.hidden = false;
  dom.single.hidden = true;
  dom.singleFlip.replaceChildren();
  dom.singleBase.replaceChildren();

  preparePage(state.backCoverNode, 'left');
  state.backCoverNode.setAttribute('aria-hidden', 'true');
  dom.baseLeft.replaceChildren(state.backCoverNode);

  const firstPage = state.pages[0];
  preparePage(firstPage.node, 'left');
  firstPage.node.classList.add('leaf-face', 'leaf-back');

  preparePage(state.coverNode, 'right');
  state.coverNode.classList.add('leaf-face', 'leaf-front');

  const coverLeaf = document.createElement('div');
  coverLeaf.className = 'leaf leaf--cover';
  coverLeaf.dataset.leaf = '0';
  coverLeaf.append(state.coverNode, firstPage.node);
  coverLeaf.style.zIndex = '500';
  dom.leaves.appendChild(coverLeaf);
  state.leaves.push(coverLeaf);

  const spreads = Math.ceil(state.pages.length / 2);

  for (let index = 1; index < spreads; index += 1) {
    const front = state.pages[index * 2 - 1];
    const back = state.pages[index * 2];
    if (!front || !back) continue;

    const leaf = document.createElement('div');
    leaf.className = 'leaf';
    leaf.dataset.leaf = String(index);

    preparePage(front.node, 'right');
    front.node.classList.add('leaf-face', 'leaf-front');

    preparePage(back.node, 'left');
    back.node.classList.add('leaf-face', 'leaf-back');

    leaf.append(front.node, back.node);
    leaf.style.zIndex = String(500 - index);
    dom.leaves.appendChild(leaf);
    state.leaves.push(leaf);
  }

  const last = state.pages[state.pages.length - 1];
  preparePage(last.node, 'right');
  dom.baseRight.replaceChildren(last.node);
}

function preparePage(node, side) {
  node.classList.remove(
    'leaf-face',
    'leaf-front',
    'leaf-back',
    'book-page--left',
    'book-page--right'
  );
  node.classList.add(`book-page--${side}`);
  node.style.zIndex = '';
  node.style.opacity = '';
  node.style.removeProperty('--rot');
  node.removeAttribute('aria-hidden');
  node.inert = false;
}

function renderSingleBase() {
  dom.singleBase.replaceChildren();
  dom.singleFlip.replaceChildren();
  dom.singleFlip.classList.remove('is-flipping');
  dom.single.style.setProperty('--turn', '0');
  dom.single.style.setProperty('--single-rot', '0deg');

  if (state.closed) {
    preparePage(state.coverNode, 'right');
    dom.singleBase.append(state.coverNode);
    dom.single.classList.add('is-closed');
  } else {
    const page = state.pages[state.currentPage];
    if (page) {
      preparePage(page.node, 'right');
      dom.singleBase.append(page.node);
    }
    dom.single.classList.remove('is-closed');
  }

  updateActivePages();
  updateColophonTimers();
}

function showSingleBase(node) {
  if (!node) return;
  preparePage(node, 'right');
  dom.singleBase.replaceChildren(node);
  updateColophonTimers();
}

function showSingleFlip(node, progress) {
  if (!node) return;
  preparePage(node, 'right');
  dom.singleFlip.replaceChildren(node);
  dom.singleFlip.classList.add('is-flipping');
  paintSingleFlip(progress);
}

function paintSingleFlip(progress) {
  const value = clamp(progress, 0, 1);
  const shade = Math.sin(Math.PI * value);

  dom.singleFlip.style.setProperty('--single-rot', `${-180 * value}deg`);
  dom.singleFlip.style.setProperty('--flip-shade', shade.toFixed(3));
  dom.single.style.setProperty('--turn', (shade * 0.55).toFixed(3));
}

function animateSingleFlip(from, to) {
  return new Promise((resolve) => {
    state.animating = true;

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const duration = reduce ? 60 : Math.max(260, 620 * Math.abs(to - from));
    const started = performance.now();

    const tick = (now) => {
      const progress = Math.min(1, (now - started) / duration);
      const eased =
        progress < 0.5
          ? 4 * progress * progress * progress
          : 1 - Math.pow(-2 * progress + 2, 3) / 2;
      const value = from + (to - from) * eased;

      paintSingleFlip(value);

      if (progress < 1) {
        requestAnimationFrame(tick);
        return;
      }

      paintSingleFlip(to);
      dom.singleFlip.classList.remove('is-flipping');
      state.animating = false;
      resolve(true);
    };

    requestAnimationFrame(tick);
  });
}

async function singleForward() {
  if (state.animating || state.closed) return false;
  if (state.currentPage >= state.pages.length - 1) return false;

  const current = state.pages[state.currentPage].node;
  const next = state.pages[state.currentPage + 1].node;

  showSingleBase(next);
  showSingleFlip(current, 0);
  await animateSingleFlip(0, 1);
  dom.singleFlip.replaceChildren();

  state.currentPage += 1;
  syncLeaves();
  updateUI();
  updateUrl();
  return true;
}

async function singleBack() {
  if (state.animating || state.closed) return false;
  if (state.currentPage <= 0) return singleCloseCover();

  const current = state.pages[state.currentPage].node;
  const previous = state.pages[state.currentPage - 1].node;

  showSingleBase(current);
  showSingleFlip(previous, 1);
  await animateSingleFlip(1, 0);
  dom.singleFlip.replaceChildren();

  state.currentPage -= 1;
  syncLeaves();
  updateUI();
  updateUrl();
  return true;
}

async function singleOpenCover() {
  if (state.animating || !state.closed) return false;

  const first = state.pages[0]?.node;
  if (!first) return false;

  showSingleBase(first);
  showSingleFlip(state.coverNode, 0);
  await animateSingleFlip(0, 1);
  dom.singleFlip.replaceChildren();

  state.closed = false;
  state.currentPage = 0;
  syncLeaves();
  updateUI();
  updateUrl();
  return true;
}

async function singleCloseCover() {
  if (state.animating || state.closed) return false;
  if (state.currentPage !== 0) return false;

  const first = state.pages[0]?.node;
  if (!first) return false;

  showSingleBase(first);
  showSingleFlip(state.coverNode, 1);
  await animateSingleFlip(1, 0);
  dom.singleFlip.replaceChildren();

  state.closed = true;
  state.currentPage = 0;
  syncLeaves();
  updateUI();
  updateUrl();
  return true;
}

function syncLeaves() {
  const closed = state.closed;

  if (state.mode === 'single') {
    dom.area.classList.toggle('is-closed', closed);
    dom.area.classList.remove('is-cover-moving');
    dom.area.classList.remove('is-first-spread');
    dom.area.style.setProperty('--cover-open', closed ? '0' : '1');
    dom.book.hidden = true;
    dom.single.hidden = false;
    dom.single.classList.remove('is-dragging');
    dom.singleFlip.replaceChildren();
    dom.singleFlip.classList.remove('is-flipping');
    dom.single.style.setProperty('--turn', '0');
    renderSingleBase();
    return;
  }

  const currentSpread = Math.floor(state.currentPage / 2);

  dom.area.classList.toggle('is-closed', closed);
  dom.area.classList.remove('is-cover-moving');
  dom.area.classList.toggle(
    'is-first-spread',
    !closed && Math.floor(state.currentPage / 2) === 0
  );
  dom.area.style.setProperty('--cover-open', closed ? '0' : '1');
  paintBookPosition(closed ? -state.layout.pageW / 2 : 0);

  state.leaves.forEach((leaf, index) => {
    const flipped = closed
      ? false
      : index === 0
        ? true
        : index <= currentSpread;

    leaf.classList.toggle('is-flipped', flipped);
    leaf.classList.remove('is-flipping');
    leaf.style.setProperty('--rot', flipped ? '-180deg' : '0deg');
    leaf.style.opacity = '';
    leaf.style.zIndex = flipped ? String(10 + index) : String(500 - index);
    leaf.style.removeProperty('--flip-shade');
  });

  dom.book.style.setProperty('--turn', '0');
  updateActivePages();
}

function updateActivePages() {
  const coverActive = state.closed;

  if (state.coverNode) {
    if (coverActive) state.coverNode.removeAttribute('aria-hidden');
    else state.coverNode.setAttribute('aria-hidden', 'true');

    if ('inert' in state.coverNode) state.coverNode.inert = !coverActive;
    else state.coverNode.toggleAttribute('inert', !coverActive);
  }

  if (state.mode === 'single') {
    const activeIndex = state.closed ? -1 : state.currentPage;

    state.pages.forEach((page, index) => {
      const isActive = index === activeIndex;
      if (isActive) page.node.removeAttribute('aria-hidden');
      else page.node.setAttribute('aria-hidden', 'true');

      if ('inert' in page.node) page.node.inert = !isActive;
      else page.node.toggleAttribute('inert', !isActive);
    });
    return;
  }

  if (state.closed) {
    state.pages.forEach((page) => {
      page.node.setAttribute('aria-hidden', 'true');
      if ('inert' in page.node) page.node.inert = true;
      else page.node.setAttribute('inert', '');
    });
    return;
  }

  const active = new Set();
  const start = Math.floor(state.currentPage / 2) * 2;
  active.add(start);
  active.add(start + 1);

  state.pages.forEach((page, index) => {
    const isActive = active.has(index);
    if (isActive) page.node.removeAttribute('aria-hidden');
    else page.node.setAttribute('aria-hidden', 'true');

    if ('inert' in page.node) page.node.inert = !isActive;
    else page.node.toggleAttribute('inert', !isActive);
  });
}

/* --------------------------------------------------------------------------
   Çevirme
   -------------------------------------------------------------------------- */

function canForward() {
  if (state.mode === 'single') {
    if (state.closed) return true;
    return state.currentPage < state.pages.length - 1;
  }
  if (state.closed) return true;
  return Math.floor(state.currentPage / 2) < state.spreads - 1;
}

function canBack() {
  return !state.closed;
}

async function turnForward() {
  if (state.animating) return false;

  if (state.mode === 'single') {
    if (state.closed) {
      markInteracted();
      return singleOpenCover();
    }
    if (!canForward()) return false;
    markInteracted();
    return singleForward();
  }

  if (state.closed) {
    markInteracted();
    return openBook();
  }

  if (!canForward()) return false;

  markInteracted();

  const spread = Math.floor(state.currentPage / 2);
  const leaf = state.leaves[spread + 1];
  if (!leaf) return false;

  await animateLeaf(leaf, 0, 1);
  state.currentPage = (spread + 1) * 2;
  syncLeaves();
  updateUI();
  updateUrl();
  return true;
}

async function turnBack() {
  if (state.animating || state.closed) return false;

  if (state.mode === 'single') {
    markInteracted();
    if (state.currentPage === 0) return singleCloseCover();
    return singleBack();
  }

  const spread = Math.floor(state.currentPage / 2);

  if (spread === 0) {
    markInteracted();
    return closeBook();
  }

  const leaf = state.leaves[spread];
  if (!leaf) return false;

  markInteracted();

  await animateLeaf(leaf, 1, 0);
  state.currentPage = (spread - 1) * 2;
  syncLeaves();
  updateUI();
  updateUrl();
  return true;
}

function openBook() {
  if (state.mode === 'single') {
    if (state.animating || !state.closed) return Promise.resolve(false);
    return singleOpenCover();
  }
  if (state.animating || !state.closed) return Promise.resolve(false);
  return animateOpening(0, 1);
}

function closeBook() {
  if (state.mode === 'single') {
    if (state.animating || state.closed || state.currentPage !== 0) {
      return Promise.resolve(false);
    }
    return singleCloseCover();
  }
  if (state.animating || state.closed) return Promise.resolve(false);
  if (Math.floor(state.currentPage / 2) !== 0) return Promise.resolve(false);
  return animateOpening(1, 0);
}

function animateOpening(from, to) {
  return new Promise((resolve) => {
    const leaf = state.leaves[0];
    if (!leaf) {
      resolve(false);
      return;
    }

    state.animating = true;

    dom.area.classList.add('is-cover-moving');

    if (to === 1) {
      state.closed = false;
      dom.area.classList.remove('is-closed');
    }

    leaf.classList.add('is-flipping');
    leaf.style.zIndex = '1000';

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const duration = reduce ? 80 : Math.max(320, 940 * Math.abs(to - from));
    const started = performance.now();

    const tick = (now) => {
      const progress = Math.min(1, (now - started) / duration);
      const eased =
        progress < 0.5
          ? 4 * progress * progress * progress
          : 1 - Math.pow(-2 * progress + 2, 3) / 2;
      const value = from + (to - from) * eased;

      paintOpening(leaf, value);

      if (progress < 1) {
        requestAnimationFrame(tick);
        return;
      }

      leaf.classList.remove('is-flipping');
      state.animating = false;
      state.closed = to === 0;
      state.currentPage = 0;
      syncLeaves();
      dom.area.classList.remove('is-cover-moving');
      updateUI();
      updateUrl();
      resolve(true);
    };

    requestAnimationFrame(tick);
  });
}

function paintBookPosition(shift) {
  dom.book.style.transform = `translate3d(-50%, -50%, 0) translate3d(${shift}px, 0, 0)`;
}

function paintOpening(leaf, value) {
  paintFlip(leaf, value);
  const progress = clamp(value, 0, 1);
  const shift = -(state.layout.pageW / 2) * (1 - progress);
  paintBookPosition(shift);
  dom.area.style.setProperty('--cover-open', progress.toFixed(3));
}

function animateLeaf(leaf, from, to) {
  return new Promise((resolve) => {
    if (!leaf) {
      resolve(false);
      return;
    }

    state.animating = true;
    leaf.classList.add('is-flipping');
    leaf.style.zIndex = '1000';

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const distance = Math.abs(to - from);
    const duration = reduce ? 60 : Math.max(300, 760 * distance);
    const started = performance.now();

    const tick = (now) => {
      const progress = Math.min(1, (now - started) / duration);
      const eased =
        progress < 0.5
          ? 4 * progress * progress * progress
          : 1 - Math.pow(-2 * progress + 2, 3) / 2;
      const value = from + (to - from) * eased;

      paintFlip(leaf, value);

      if (progress < 1) {
        requestAnimationFrame(tick);
        return;
      }

      paintFlip(leaf, to);
      leaf.classList.remove('is-flipping');
      state.animating = false;
      resolve(true);
    };

    requestAnimationFrame(tick);
  });
}

function paintFlip(leaf, value) {
  const progress = clamp(value, 0, 1);
  const shade = Math.sin(Math.PI * progress);

  leaf.style.setProperty('--rot', `${-180 * progress}deg`);
  leaf.style.setProperty('--flip-shade', shade.toFixed(3));
  dom.book.style.setProperty('--turn', (shade * 0.62).toFixed(3));

  if (state.mode === 'single') {
    const opacity = progress > 0.56 ? Math.max(0, 1 - (progress - 0.56) / 0.44) : 1;
    leaf.style.opacity = opacity.toFixed(3);
  } else {
    leaf.style.opacity = '';
  }
}

async function goToPage(index) {
  if (!state.pages.length || state.animating) return;

  const target = normalizeTargetPage(index);

  if (state.mode === 'single') {
    state.closed = false;
    state.currentPage = target;
    syncLeaves();
    updateUI();
    updateUrl();
    markInteracted();
    return;
  }

  if (state.mode === 'spread') {
    const current = Math.floor(state.currentPage / 2);
    const wanted = Math.floor(target / 2);
    const distance = Math.abs(wanted - current);

    if (distance > 3) {
      jumpTo(target);
      return;
    }

    let safety = 6;
    while (Math.floor(state.currentPage / 2) !== wanted && safety > 0) {
      safety -= 1;
      const moved =
        Math.floor(state.currentPage / 2) < wanted ? await turnForward() : await turnBack();
      if (!moved) break;
    }
    return;
  }

  const distance = Math.abs(target - state.currentPage);
  if (distance > 3) {
    jumpTo(target);
    return;
  }

  let safety = 6;
  while (state.currentPage !== target && safety > 0) {
    safety -= 1;
    const moved = state.currentPage < target ? await turnForward() : await turnBack();
    if (!moved) break;
  }
}

function jumpTo(index) {
  if (state.closed) {
    state.closed = false;
    dom.area.classList.remove('is-closed');
  }
  state.currentPage = normalizeTargetPage(index);

  if (state.mode === 'single') {
    dom.single.classList.add('is-jumping');
    syncLeaves();
    updateUI();
    updateUrl();
    markInteracted();
    window.setTimeout(() => dom.single.classList.remove('is-jumping'), 260);
    return;
  }

  dom.book.classList.add('is-jumping');
  syncLeaves();
  updateUI();
  updateUrl();
  markInteracted();
  window.setTimeout(() => dom.book.classList.remove('is-jumping'), 260);
}

/* --------------------------------------------------------------------------
   Sürükleme
   -------------------------------------------------------------------------- */

function onPointerDown(event) {
  if (event.button !== 0 || state.animating || state.pages.length < 2) return;

  const surface = state.mode === 'single' ? dom.single : dom.book;
  const rect = surface.getBoundingClientRect();
  const width = rect.width;
  const x = event.clientX - rect.left;

  let direction = 0;
  let leaf = null;
  let opening = false;
  let closing = false;
  let coverOpen = false;

  if (state.mode === 'single') {
    if (state.closed) {
      direction = 1;
      coverOpen = true;
    }
  } else if (state.closed) {
    if (x < width / 2) return;
    direction = 1;
    opening = true;
    leaf = state.leaves[0];
  } else {
    const spread = Math.floor(state.currentPage / 2);
    direction = x >= width / 2 ? 1 : -1;

    if (direction === 1) {
      if (!canForward()) return;
      leaf = state.leaves[spread + 1];
    } else if (spread === 0) {
      closing = true;
      leaf = state.leaves[0];
    } else {
      leaf = state.leaves[spread];
    }
  }

  if (state.mode !== 'single' && !leaf) return;

  state.pointer = {
    id: event.pointerId,
    surface,
    single: state.mode === 'single',
    startX: event.clientX,
    startY: event.clientY,
    direction,
    leaf,
    opening,
    closing,
    coverOpen,
    closeCover: false,
    moved: false,
    progress: direction === 1 ? 0 : 1,
    lastX: event.clientX,
    lastTime: performance.now(),
    velocity: 0
  };

  surface.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerUp);
}

function onPointerMove(event) {
  const pointer = state.pointer;
  if (!pointer || event.pointerId !== pointer.id) return;

  const dx = event.clientX - pointer.startX;
  const dy = event.clientY - pointer.startY;

  if (pointer.single) {
    if (!pointer.moved) {
      if (Math.abs(dx) < 7 || Math.abs(dx) <= Math.abs(dy)) return;

      if (state.closed) {
        pointer.direction = 1;
        pointer.coverOpen = true;
      } else {
        pointer.direction = dx < 0 ? 1 : -1;

        if (pointer.direction === 1) {
          if (state.currentPage >= state.pages.length - 1) return;
        } else if (state.currentPage === 0) {
          pointer.closeCover = true;
        }
      }

      pointer.moved = true;
      state.animating = true;

      try {
        pointer.surface.setPointerCapture?.(pointer.id);
      } catch {
        /* sentetik olaylarda yakalama gerekmez */
      }

      if (pointer.coverOpen) {
        showSingleBase(state.pages[0].node);
        showSingleFlip(state.coverNode, 0);
      } else if (pointer.direction === 1) {
        showSingleBase(state.pages[state.currentPage + 1].node);
        showSingleFlip(state.pages[state.currentPage].node, 0);
      } else if (pointer.closeCover) {
        showSingleBase(state.pages[0].node);
        showSingleFlip(state.coverNode, 1);
      } else {
        showSingleBase(state.pages[state.currentPage].node);
        showSingleFlip(state.pages[state.currentPage - 1].node, 1);
      }

      dom.single.classList.add('is-dragging');
      markInteracted();
    }

    const pageW = state.layout.pageW;
    const progress =
      pointer.direction === 1
        ? clamp(-dx / pageW, 0, 1)
        : clamp(1 - dx / pageW, 0, 1);

    pointer.progress = progress;
    paintSingleFlip(progress);

    const now = performance.now();
    const elapsed = now - pointer.lastTime;
    if (elapsed > 0) {
      pointer.velocity = (event.clientX - pointer.lastX) / elapsed;
    }
    pointer.lastX = event.clientX;
    pointer.lastTime = now;
    return;
  }

  if (!pointer.moved) {
    if (Math.abs(dx) < 7 || Math.abs(dx) <= Math.abs(dy)) return;

    pointer.moved = true;
    state.animating = true;
    try {
      pointer.surface.setPointerCapture?.(pointer.id);
    } catch {
      /* sentetik olaylarda yakalama gerekmez */
    }
    pointer.leaf.classList.add('is-flipping');
    pointer.leaf.style.zIndex = '1000';
    dom.book.classList.add('is-dragging');

    if (pointer.opening) {
      state.closed = false;
      dom.area.classList.remove('is-closed');
    }

    if (pointer.opening || pointer.closing) {
      dom.area.classList.add('is-cover-moving');
    }

    markInteracted();
  }

  const pageW = state.layout.pageW;
  const progress =
    pointer.direction === 1
      ? clamp(-dx / pageW, 0, 1)
      : clamp(1 - dx / pageW, 0, 1);

  pointer.progress = progress;

  if (pointer.opening || pointer.closing) paintOpening(pointer.leaf, progress);
  else paintFlip(pointer.leaf, progress);

  const now = performance.now();
  const elapsed = now - pointer.lastTime;
  if (elapsed > 0) {
    pointer.velocity = (event.clientX - pointer.lastX) / elapsed;
  }
  pointer.lastX = event.clientX;
  pointer.lastTime = now;
}

function onPointerUp(event) {
  const pointer = state.pointer;
  if (!pointer || event.pointerId !== pointer.id) return;

  const surface = pointer.surface || dom.book;

  surface.removeEventListener('pointermove', onPointerMove);
  window.removeEventListener('pointerup', onPointerUp);
  window.removeEventListener('pointercancel', onPointerUp);
  dom.book.classList.remove('is-dragging');
  dom.single.classList.remove('is-dragging');

  if (surface.hasPointerCapture?.(pointer.id)) {
    try {
      surface.releasePointerCapture(pointer.id);
    } catch {
      /* yoksay */
    }
  }

  if (!pointer.moved) {
    state.pointer = null;
    return;
  }

  if (!pointer.single && !pointer.leaf) {
    state.pointer = null;
    return;
  }

  state.ignoreClickUntil = performance.now() + 350;

  const progress = pointer.progress;
  const velocity = pointer.velocity;

  if (pointer.single) {
    const direction = pointer.direction;
    const coverOpen = pointer.coverOpen;
    const closeCover = pointer.closeCover;
    const target =
      direction === 1
        ? progress > 0.4 || velocity < -0.3
          ? 1
          : 0
        : progress < 0.6 || velocity > 0.3
          ? 0
          : 1;

    state.pointer = null;

    animateSingleFlip(progress, target).then(() => {
      if (coverOpen) {
        state.closed = target !== 1;
        if (target === 1) state.currentPage = 0;
      } else if (closeCover) {
        state.closed = target === 0;
      } else if (direction === 1 && target === 1) {
        state.currentPage += 1;
      } else if (direction === -1 && target === 0) {
        state.currentPage -= 1;
      }

      syncLeaves();
      updateUI();
      updateUrl();
    });
    return;
  }

  const leaf = pointer.leaf;
  const opening = pointer.opening;
  const closing = pointer.closing;

  let target;

  if (opening) {
    target = progress > 0.35 || velocity < -0.3 ? 1 : 0;
  } else if (closing) {
    target = progress < 0.65 || velocity > 0.3 ? 0 : 1;
  } else if (pointer.direction === 1) {
    target = progress > 0.42 || velocity < -0.32 ? 1 : 0;
  } else {
    target = progress < 0.58 || velocity > 0.32 ? 0 : 1;
  }

  const completedForward = !opening && !closing && pointer.direction === 1 && target === 1;
  const completedBack = !opening && !closing && pointer.direction === -1 && target === 0;

  state.pointer = null;

  if (opening || closing) {
    animateOpening(progress, target);
    return;
  }

  animateLeaf(leaf, progress, target).then(() => {
    if (completedForward) {
      state.currentPage += 2;
      updateUrl();
    } else if (completedBack) {
      state.currentPage -= 2;
      updateUrl();
    }

    syncLeaves();
    updateUI();
  });
}

function onBookClick(event) {
  if (performance.now() < state.ignoreClickUntil) {
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  if (event.target.closest('a, button, input, textarea, select, [contenteditable="true"]')) return;

  if (state.closed) {
    openBook();
    return;
  }

  if (state.mode === 'single') {
    const rect = dom.single.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const width = rect.width;

    if (x > width * 0.8) turnForward();
    else if (x < width * 0.2) turnBack();
    return;
  }

  const rect = dom.book.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const width = rect.width;

  if (x > width * 0.8) turnForward();
  else if (x < width * 0.2) turnBack();
}

/* --------------------------------------------------------------------------
   Arayüz
   -------------------------------------------------------------------------- */

function updateUI() {
  const total = state.pages.length;
  if (!total) return;

  if (state.closed) {
    const label = `${state.site.author || 'Notlar'} kitabı, kapalı. Açmak için kapağı çevir.`;
    dom.book.setAttribute('aria-label', label);
    dom.single.setAttribute('aria-label', label);
    return;
  }

  if (state.mode === 'single') {
    const label = `${state.site.author || 'Notlar'} kitabı, ${
      state.currentPage + 1
    }. sayfa, ${total} sayfa`;
    dom.single.setAttribute('aria-label', label);
    dom.book.setAttribute('aria-label', label);
    return;
  }

  const spread = Math.floor(state.currentPage / 2);
  const first = spread * 2;
  const second = Math.min(first + 1, total - 1);
  const label =
    second > first
      ? `${state.site.author || 'Notlar'} kitabı, ${first + 1}–${second + 1}. sayfalar, ${total} sayfa`
      : `${state.site.author || 'Notlar'} kitabı, ${first + 1}. sayfa, ${total} sayfa`;

  dom.book.setAttribute('aria-label', label);

  if (dom.prev) dom.prev.disabled = spread <= 0;
  if (dom.next) dom.next.disabled = spread >= state.spreads - 1;
  if (dom.status) dom.status.textContent = String(first + 1);
  if (dom.progress) {
    dom.progress.style.transform = `scaleX(${clamp((spread + 1) / Math.max(1, state.spreads), 0, 1)})`;
  }
}

function updateUrl() {
  const url = new URL(window.location.href);
  url.searchParams.delete('yazi');

  if (state.closed || !state.pages.length) {
    url.searchParams.delete('sayfa');
  } else {
    const page = state.pages[state.currentPage];
    if (page) url.searchParams.set('sayfa', String(page.folio));
  }

  window.history.replaceState(null, '', url);
}

function markInteracted() {
  dom.hint?.classList.add('is-hidden');
}

function reveal() {
  if (!dom.area.hidden) return;
  dom.loader.hidden = true;
  dom.area.hidden = false;
  document.body.classList.add('is-ready');
}

function showError() {
  dom.loader.hidden = true;
  dom.area.hidden = true;
  dom.error.hidden = false;
}

/* --------------------------------------------------------------------------
   Olaylar
   -------------------------------------------------------------------------- */

function bindEvents() {
  dom.prev?.addEventListener('click', () => turnBack());
  dom.next?.addEventListener('click', () => turnForward());
  dom.retry?.addEventListener('click', () => {
    dom.error.hidden = true;
    dom.loader.hidden = false;
    state.pages = [];
    loadAndRender();
  });

  dom.tocButton?.addEventListener('click', () => {
    const index = state.pages.findIndex((page) => page.kind === 'toc');
    if (index >= 0) goToPage(index);
  });

  dom.book?.addEventListener('pointerdown', onPointerDown);
  dom.book?.addEventListener('click', onBookClick);
  dom.single?.addEventListener('pointerdown', onPointerDown);
  dom.single?.addEventListener('click', onBookClick);

  document.addEventListener(
    'error',
    (event) => {
      const image = event.target;
      if (image instanceof HTMLImageElement && image.closest('.chapter-cover')) {
        image.closest('.chapter-cover').classList.add('is-missing');
      }
    },
    true
  );

  document.addEventListener('click', (event) => {
    const target = event.target.closest('[data-goto]');
    if (!target) return;
    if (performance.now() < state.ignoreClickUntil) return;
    event.preventDefault();
    goToPage(Number(target.dataset.goto));
  });

  document.addEventListener('keydown', (event) => {
    if (event.defaultPrevented) return;
    if (event.target.closest('input, textarea, select, [contenteditable="true"]')) return;

    if (state.closed && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      openBook();
      return;
    }

    switch (event.key) {
      case 'ArrowRight':
      case 'PageDown':
        event.preventDefault();
        turnForward();
        break;
      case 'ArrowLeft':
      case 'PageUp':
        event.preventDefault();
        turnBack();
        break;
      case 'Home':
        event.preventDefault();
        jumpTo(0);
        break;
      case 'End':
        event.preventDefault();
        jumpTo(state.pages.length - 1);
        break;
      default:
        break;
    }
  });

  const relayout = debounce(() => {
    if (state.animating || state.pointer) return;
    layoutAndRender();
  }, 240);

  window.addEventListener('resize', relayout);
  window.addEventListener('orientationchange', () => window.setTimeout(relayout, 320));
}

function wait(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

/* --------------------------------------------------------------------------
   Başlat
   -------------------------------------------------------------------------- */

init();
