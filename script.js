// ============================================================================
// RSS-ONLY DASHBOARD SCRIPT (EXTRACTED FROM WIKI)
// ============================================================================

const CONFIG = {
    NEXTCLOUD_URL: '*********************',
    NEXTCLOUD_USER: '***',
    NEXTCLOUD_PASS: '*******************************',
    INITIAL_FEED_ITEMS: 50,
    FEED_ITEMS_PER_PAGE: 50,
    SHOW_POST_CONTENT: true,
    POST_CONTENT_LIMIT: 280,
    UPDATE_TIME_INTERVAL: 1000
};

const LOCAL_STORAGE_KEYS = {
    readItems: '******_read_items',
    readSyncQueue: '******_read_sync_queue'
};

const INVIDIOUS_EMBED_HOSTS = ['inv.nadeko.net', 'yewtu.be', 'invidious.f5.si'];
const BLUESKY_POST_CACHE = new Map();

function isInvidiousHost(hostname) {
    if (!hostname) return false;
    const host = hostname.toLowerCase();
    return INVIDIOUS_EMBED_HOSTS.some(allowed => host === allowed || host.endsWith(`.${allowed}`)) || host.includes('invidious');
}

// ============================================================================
// STATE & DOM
// ============================================================================

const STATE = {
    folders: [],
    feeds: [],
    selectedFolder: null,
    showStarredOnly: false,
    feedViewFilter: 'unviewed',
    latestItems: [],
    feedOffset: 0,
    feedHasMore: true,
    feedLoading: false,
    localReadItems: new Set(),
    readSyncQueue: new Set(),
    pendingReadMarks: new Set(),
    pendingStarToggles: new Set(),
    clockIntervalId: null
};

const DOM = {
    pageTitleText: null,
    subtitle: null,
    overview: null
};

function cacheDom() {
    DOM.pageTitleText = document.querySelector('.page-title-display p');
    DOM.subtitle = document.querySelector('subtitle p') || document.querySelector('subtitle');
    DOM.overview = document.querySelector('overview');
}

// ============================================================================
// INITIALIZATION
// ============================================================================

document.addEventListener('DOMContentLoaded', async () => {
    cacheDom();
    initializeLocalReadTracking();
    startClock();
    await loadNextcloudFolders();
    await loadNextcloudFeeds();
    await loadNextcloudFeed();
    window.addEventListener('resize', refreshDesktopVideoEmbeds);
    refreshDesktopVideoEmbeds();
});

// ============================================================================
// CLOCK
// ============================================================================

function startClock() {
    if (STATE.clockIntervalId) {
        clearInterval(STATE.clockIntervalId);
    }
    updateClock();
    STATE.clockIntervalId = setInterval(updateClock, CONFIG.UPDATE_TIME_INTERVAL);
}

function updateClock() {
    const now = new Date();

    const timeString = now.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    });

    const dateString = now.toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });

    if (DOM.pageTitleText) {
        DOM.pageTitleText.textContent = timeString;
    }
    if (DOM.subtitle) {
        DOM.subtitle.textContent = dateString;
    }

    updateTimeBasedBackground(now);
}

function updateTimeBasedBackground(now) {
    const isDarkMode = !window.matchMedia || !window.matchMedia('(prefers-color-scheme: light)').matches;
    if (!isDarkMode) return;

    const hour = now.getHours();
    let backgroundImage = '';

    if (hour >= 20 || hour < 5) {
        backgroundImage = 'backgrounds/dawn.png';
    } else if (hour >= 5 && hour < 8) {
        backgroundImage = 'backgrounds/dawn.png';
    } else if (hour >= 8 && hour < 18) {
        backgroundImage = 'backgrounds/day.jpg';
    } else {
        backgroundImage = 'backgrounds/dawn.png';
    }

    document.body.style.backgroundImage = `url('${backgroundImage}')`;
    document.body.style.backgroundSize = 'cover';
    document.body.style.backgroundPosition = 'center';
    document.body.style.backgroundAttachment = 'fixed';
}

// ============================================================================
// NEXTCLOUD NEWS API
// ============================================================================

async function loadNextcloudFolders() {
    if (!CONFIG.NEXTCLOUD_URL || CONFIG.NEXTCLOUD_USER === 'YOUR_USERNAME') {
        return;
    }

    try {
        const auth = btoa(`${CONFIG.NEXTCLOUD_USER}:${CONFIG.NEXTCLOUD_PASS}`);
        const response = await fetch(
            `${CONFIG.NEXTCLOUD_URL}/index.php/apps/news/api/v1-3/folders`,
            {
                headers: {
                    'Authorization': `Basic ${auth}`,
                    'Accept': 'application/json'
                }
            }
        );

        if (!response.ok) throw new Error('Failed to fetch folders');

        const data = await response.json();
        STATE.folders = data.folders || [];
        console.log(`[RSS] Loaded ${STATE.folders.length} folders`);
    } catch (error) {
        console.error('Folders fetch error:', error);
        STATE.folders = [];
    }
}

async function loadNextcloudFeeds() {
    if (!CONFIG.NEXTCLOUD_URL || CONFIG.NEXTCLOUD_USER === 'YOUR_USERNAME') {
        return;
    }

    try {
        const auth = btoa(`${CONFIG.NEXTCLOUD_USER}:${CONFIG.NEXTCLOUD_PASS}`);
        const response = await fetch(
            `${CONFIG.NEXTCLOUD_URL}/index.php/apps/news/api/v1-3/feeds`,
            {
                headers: {
                    'Authorization': `Basic ${auth}`,
                    'Accept': 'application/json'
                }
            }
        );

        if (!response.ok) throw new Error('Failed to fetch feeds');

        const data = await response.json();
        STATE.feeds = data.feeds || [];
        console.log(`[RSS] Loaded ${STATE.feeds.length} feeds`);
    } catch (error) {
        console.error('Feeds fetch error:', error);
        STATE.feeds = [];
    }
}

async function loadNextcloudFeed(folderId = null, options = {}) {
    const { append = false, offsetOverride = null } = options;
    if (!CONFIG.NEXTCLOUD_URL || CONFIG.NEXTCLOUD_USER === 'YOUR_USERNAME') {
        STATE.latestItems = [];
        displayFeed();
        return;
    }

    if (STATE.feedLoading) return;
    STATE.feedLoading = true;

    try {
        const auth = btoa(`${CONFIG.NEXTCLOUD_USER}:${CONFIG.NEXTCLOUD_PASS}`);
        const includeRead = STATE.feedViewFilter === 'all';
        const batchSize = includeRead ? (CONFIG.FEED_ITEMS_PER_PAGE || CONFIG.INITIAL_FEED_ITEMS) : CONFIG.INITIAL_FEED_ITEMS;
        const isStarredMode = STATE.showStarredOnly;
        let offset = includeRead ? STATE.feedOffset : 0;
        if (offsetOverride !== null) {
            offset = offsetOverride;
        }

        const params = new URLSearchParams({
            type: isStarredMode ? '2' : (folderId === null ? '3' : '1'),
            getRead: includeRead ? 'true' : 'false',
            batchSize: batchSize.toString(),
            offset: offset.toString()
        });

        if (!isStarredMode && folderId !== null) {
            params.set('id', folderId.toString());
        }

        const url = `${CONFIG.NEXTCLOUD_URL}/index.php/apps/news/api/v1-3/items?${params.toString()}`;

        const response = await fetch(url, {
            headers: {
                'Authorization': `Basic ${auth}`,
                'Accept': 'application/json'
            }
        });

        if (!response.ok) throw new Error('Failed to fetch feed');

        const data = await response.json();
        const newItems = data.items || [];
        const shouldAppend = append && includeRead;

        if (shouldAppend) {
            if (!newItems.length) {
                STATE.feedHasMore = false;
            } else {
                STATE.latestItems = [...STATE.latestItems, ...newItems];
                STATE.feedOffset += newItems.length;
                STATE.feedHasMore = newItems.length === batchSize;
            }
        } else {
            STATE.latestItems = newItems;
            STATE.feedOffset = includeRead ? newItems.length : 0;
            STATE.feedHasMore = includeRead && newItems.length === batchSize;
        }

        applyLocalReadOverrides(STATE.latestItems);
        STATE.feedLoading = false;
        displayFeed();
        processReadSyncQueue();
    } catch (error) {
        console.error('Feed fetch error:', error);
        STATE.feedLoading = false;
        STATE.latestItems = [];
        displayFeed(true);
    }
}

// ============================================================================
// FEED RENDERING
// ============================================================================

function displayViewToggle() {
    const nextView = STATE.feedViewFilter === 'unviewed' ? 'all' : 'unviewed';
    const label = STATE.feedViewFilter === 'unviewed' ? '🔵' : '⚫';
    const activeClass = STATE.feedViewFilter === 'unviewed' ? ' is-active' : '';

    return `
        <button class="view-toggle-chip${activeClass}" data-view="${nextView}">
            ${label}
        </button>
    `;
}

function renderFolderLabel(folderName) {
    const name = (folderName || '').trim();
    const iconMap = [
        { match: '🎹', src: 'icons/music.svg', alt: 'Music' },
        { match: '🎵', src: 'icons/tiktok.svg', alt: 'TikTok' },
        { match: '🎶', src: 'icons/tiktok.svg', alt: 'TikTok' },
        { match: '▶', src: 'icons/play.svg', alt: 'Video' },
        { match: '▶️', src: 'icons/video.svg', alt: 'Video' },
        { match: '📰', src: 'icons/blog.svg', alt: 'Blog' }
    ];

    const mapping = iconMap.find(entry => name.includes(entry.match));
    if (mapping) {
        return {
            html: `<img src="${mapping.src}" alt="${escapeHtml(mapping.alt)}" class="folder-icon">`,
            title: mapping.alt
        };
    }
    return {
        html: escapeHtml(name || 'Folder'),
        title: name || 'Folder'
    };
}

function displayFolderMenu() {
    if (STATE.folders.length === 0) {
        return `
            <div class="feed-folder-menu">
                ${displayViewToggle()}
            </div>
        `;
    }

    const isAllActive = STATE.selectedFolder === null && !STATE.showStarredOnly;
    const starActive = STATE.showStarredOnly;
    const menuHTML = `
        <div class="feed-folder-menu">
            ${displayViewToggle()}
            <button class="folder-btn ${isAllActive ? 'active' : ''}" data-folder-id="null" title="All items">
                All
            </button>
            <button class="folder-btn folder-btn--starred ${starActive ? 'active' : ''}" data-folder-starred="true" title="Starred items">
                <img src="icons/${starActive ? 'starred-folder' : 'starred-folder'}.svg" alt="Starred items" class="folder-icon folder-icon--star">
            </button>
            ${STATE.folders.map(folder => {
                const isActive = STATE.selectedFolder === folder.id;
                const display = renderFolderLabel(folder.name);
                return `
                    <button class="folder-btn ${isActive ? 'active' : ''}" data-folder-id="${folder.id}" title="${escapeHtml(display.title)}">
                        ${display.html}
                    </button>
                `;
            }).join('')}
        </div>
    `;

    return menuHTML;
}

function getFeedControlsHTML() {
    return `
        <div class="feed-controls">
            ${displayFolderMenu()}
        </div>
    `;
}

function getFeedFooterHTML() {
    if (STATE.feedViewFilter !== 'all') {
        return `
            <div class="feed-footer">
                <button class="feed-refresh-btn" ${STATE.feedLoading ? 'disabled' : ''}>
                    ${STATE.feedLoading ? 'Loading…' : 'Refresh'}
                </button>
            </div>
        `;
    }

    if (!STATE.feedHasMore) return '';
    return `
        <div class="feed-footer">
            <button class="feed-load-more" ${STATE.feedLoading ? 'disabled' : ''}>
                ${STATE.feedLoading ? 'Loading…' : 'Load More'}
            </button>
        </div>
    `;
}

function displayFeed(isError = false) {
    if (!DOM.overview) return;
    const controlsHTML = getFeedControlsHTML();
    const items = getFilteredFeedItems();
    const footerHTML = getFeedFooterHTML();

    if (isError) {
        DOM.overview.innerHTML = `<p class="empty-state">Unable to load news feed</p>${footerHTML}${controlsHTML}`;
        attachViewToggleHandlers();
        attachFolderClickHandlers();
        attachRefreshHandler();
        attachLoadMoreHandler();
        return;
    }

    if (!items || items.length === 0) {
        const message = STATE.feedViewFilter === 'all'
            ? '<p class="empty-state">No items to display</p>'
            : '<p class="empty-state">No unread items</p>';
        DOM.overview.innerHTML = message + footerHTML + controlsHTML;
        attachViewToggleHandlers();
        attachFolderClickHandlers();
        attachRefreshHandler();
        attachLoadMoreHandler();
        return;
    }

    const feedHTML = `
        <div class="feed-region">
            <div class="bluesky-feed">
                ${items.map(item => createFeedCard(item)).join('')}
            </div>
        </div>
        ${footerHTML}
    `;

    DOM.overview.innerHTML = feedHTML + controlsHTML;
    attachViewToggleHandlers();
    attachFolderClickHandlers();
    attachFeedItemInteractions();
    attachStarToggleHandlers();
    attachMarkReadHandlers();
    attachRefreshHandler();
    attachLoadMoreHandler();
    refreshDesktopVideoEmbeds();
    hydrateBlueskyEmbeds();
}

function attachRefreshHandler() {
    const refreshBtn = document.querySelector('.feed-refresh-btn');
    if (refreshBtn && !refreshBtn.dataset.bound) {
        refreshBtn.dataset.bound = 'true';
        refreshBtn.addEventListener('click', (event) => {
            event.preventDefault();
            refreshUnreadFeed();
        });
    }
}

function attachLoadMoreHandler() {
    const loadMoreBtn = document.querySelector('.feed-load-more');
    if (loadMoreBtn && !loadMoreBtn.dataset.bound) {
        loadMoreBtn.dataset.bound = 'true';
        loadMoreBtn.addEventListener('click', (event) => {
            event.preventDefault();
            loadMoreFeedItems();
        });
    }
}

function refreshUnreadFeed() {
    if (STATE.feedViewFilter === 'all' || STATE.feedLoading) return;
    STATE.feedOffset = 0;
    loadNextcloudFeed(STATE.selectedFolder, { offsetOverride: 0 });
}

function loadMoreFeedItems() {
    if (STATE.feedViewFilter !== 'all' || STATE.feedLoading || !STATE.feedHasMore) return;
    loadNextcloudFeed(STATE.selectedFolder, { append: true });
}

function getFilteredFeedItems() {
    let items = (STATE.latestItems || []).filter(Boolean);
    if (STATE.showStarredOnly) {
        items = items.filter(item => item && item.starred);
    }
    if (STATE.feedViewFilter === 'all') {
        return items;
    }
    return items.filter(item => item && isItemUnread(item));
}

function isItemUnread(item) {
    if (!item) return false;
    if (STATE.localReadItems.has(item.id)) return false;
    if (item.unread === undefined || item.unread === null) return true;
    if (typeof item.unread === 'boolean') return item.unread;
    if (typeof item.unread === 'number') return item.unread !== 0;
    return Boolean(item.unread);
}

// ============================================================================
// FEED CARD & CONTENT HELPERS
// ============================================================================

function buildSourceSignature(domain, feedName, url) {
    return `${domain || ''} ${feedName || ''} ${url || ''}`.toLowerCase();
}

function isBlueskySource(domain, feedName, url) {
    const signature = buildSourceSignature(domain, feedName, url);
    return signature.includes('bluesky') || signature.includes('bsky');
}

function isLemmySource(domain, feedName, url) {
    const signature = buildSourceSignature(domain, feedName, url);
    return signature.includes('lemmy');
}

function extractQuoteText(node) {
    if (!node) return '';
    const clone = node.cloneNode(true);
    clone.querySelectorAll('script, style').forEach(el => el.remove());
    clone.querySelectorAll('img, video, source').forEach(el => el.remove());
    clone.innerHTML = clone.innerHTML.replace(/<br\s*\/?>/gi, '\n');
    return stripHtml(clone.innerHTML);
}

function isLikelyBlueskyAvatar(src, img) {
    if (!src) return true;
    if (src.startsWith('data:')) return true;
    const lower = src.toLowerCase();
    if (/avatar|profile|icon|emoji/.test(lower)) return true;
    const classes = (img?.className || '').toLowerCase();
    if (classes && /avatar|emoji|icon/.test(classes)) return true;
    const alt = (img?.getAttribute('alt') || '').toLowerCase();
    if (alt && /avatar|emoji/.test(alt)) return true;
    const width = parseInt(img?.getAttribute('width') || '', 10);
    if (Number.isFinite(width) && width <= 80) return true;
    return false;
}

function isLikelyVideoUrl(url) {
    if (!url) return false;
    const plain = url.split('?')[0].toLowerCase();
    return /\.(mp4|webm|mov|m4v|mkv)$/i.test(plain);
}

function guessVideoMime(url) {
    if (!url) return 'video/mp4';
    const plain = url.split('?')[0].toLowerCase();
    if (plain.endsWith('.webm')) return 'video/webm';
    if (plain.endsWith('.mov')) return 'video/quicktime';
    if (plain.endsWith('.m4v')) return 'video/mp4';
    if (plain.endsWith('.mkv')) return 'video/x-matroska';
    return 'video/mp4';
}

function extractBlueskyEnhancements(item, safeItemUrl, domain, feedName) {
    if (!item?.body) return null;
    if (!isBlueskySource(domain, feedName, item?.url)) return null;

    const parser = document.createElement('div');
    parser.innerHTML = item.body;

    const imageAttachments = [];
    const seenSources = new Set();

    parser.querySelectorAll('img').forEach(img => {
        const src = img.getAttribute('data-src') || img.getAttribute('src');
        if (!src || seenSources.has(src) || isLikelyBlueskyAvatar(src, img)) return;
        seenSources.add(src);
        imageAttachments.push({
            src,
            alt: img.getAttribute('alt') || ''
        });
    });

    const videoSources = [];
    const pushVideo = (src) => {
        if (!src || seenSources.has(src) || !isLikelyVideoUrl(src)) return;
        seenSources.add(src);
        videoSources.push(src);
    };

    parser.querySelectorAll('video, video source, source').forEach(node => {
        pushVideo(node.getAttribute('src'));
    });
    parser.querySelectorAll('a[href]').forEach(link => pushVideo(link.getAttribute('href')));

    let attachmentsHtml = '';
    if (imageAttachments.length) {
        attachmentsHtml = `
            <div class="bluesky-attachments bluesky-attachments--${Math.min(imageAttachments.length, 4)}">
                ${imageAttachments.slice(0, 4).map(img => `
                    <a class="bluesky-attachment" href="${safeItemUrl}">
                        <img src="${escapeHtml(img.src)}" alt="${escapeHtml(img.alt || '')}" loading="lazy">
                    </a>
                `).join('')}
            </div>
        `;
    }

    let videosHtml = '';
    if (videoSources.length) {
        videosHtml = `
            <div class="bluesky-videos">
                ${videoSources.slice(0, 2).map(src => `
                    <video controls preload="metadata">
                        <source src="${escapeHtml(src)}" type="${guessVideoMime(src)}">
                    </video>
                `).join('')}
            </div>
        `;
    }

    let quoteHtml = '';
    const quoteNode = parser.querySelector('blockquote, .quote, .quoted-post, .quote-card');
    if (quoteNode) {
        const quoteText = extractQuoteText(quoteNode);
        const citeLink = quoteNode.querySelector('cite a[href], a[href]');
        let citeMarkup = '';
        if (citeLink) {
            const href = citeLink.getAttribute('href');
            const label = citeLink.textContent.trim() || href;
            if (href) {
                citeMarkup = `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`;
            } else if (label) {
                citeMarkup = `<span>${escapeHtml(label)}</span>`;
            }
        }
        if (quoteText) {
            quoteHtml = `
                <div class="bluesky-quote">
                    ${citeMarkup ? `<div class="bluesky-quote-author">${citeMarkup}</div>` : ''}
                    <p>${escapeHtml(quoteText)}</p>
                </div>
            `;
        }
    }

    if (!attachmentsHtml && !videosHtml && !quoteHtml) return null;
    return {
        attachmentsHtml: attachmentsHtml + videosHtml,
        quoteHtml,
        hasRichMedia: Boolean(imageAttachments.length || videoSources.length)
    };
}

function extractLemmyVideo(temp) {
    if (!temp) return null;
    const directVideo = temp.querySelector('video');
    let src = null;
    if (directVideo) {
        src = directVideo.getAttribute('src') || directVideo.querySelector('source')?.getAttribute('src');
    }
    if (!src) {
        const videoLink = Array.from(temp.querySelectorAll('a[href]')).find(link => isLikelyVideoUrl(link.getAttribute('href')));
        if (videoLink) {
            src = videoLink.getAttribute('href');
        }
    }
    if (!src || !isLikelyVideoUrl(src)) return null;

    const posterImg = temp.querySelector('img');
    const poster = posterImg ? (posterImg.getAttribute('src') || posterImg.getAttribute('data-src')) : null;

    return {
        variant: 'video',
        markup: `
            <div class="lemmy-video-embed">
                <video controls preload="metadata" ${poster ? `poster="${escapeHtml(poster)}"` : ''}>
                    <source src="${escapeHtml(src)}" type="${guessVideoMime(src)}">
                </video>
            </div>
        `
    };
}

function shouldUseDesktopVideoEmbeds() {
    return true;
}

let pendingVideoEmbedRefresh = null;
function refreshDesktopVideoEmbeds() {
    if (pendingVideoEmbedRefresh) return;
    pendingVideoEmbedRefresh = requestAnimationFrame(() => {
        pendingVideoEmbedRefresh = null;
        const preferEmbed = shouldUseDesktopVideoEmbeds();
        if (document.body) {
            document.body.classList.toggle('desktop-video-embeds', preferEmbed);
        }
        document.querySelectorAll('.feed-video-embed[data-embed-src]').forEach(container => {
            const iframe = container.querySelector('iframe');
            if (preferEmbed) {
                if (!iframe) {
                    const src = container.dataset.embedSrc;
                    if (!src) return;
                    const frame = document.createElement('iframe');
                    frame.src = src;
                    frame.loading = 'lazy';
                    frame.allowFullscreen = true;
                    frame.setAttribute('allowfullscreen', 'true');
                    frame.setAttribute('allow', 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share');
                    frame.referrerPolicy = 'no-referrer';
                    frame.setAttribute('sandbox', 'allow-same-origin allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms');
                    container.appendChild(frame);
                }
            } else if (iframe) {
                iframe.remove();
            }
        });
    });
}

async function hydrateBlueskyEmbeds() {
    if (typeof document === 'undefined') return;
    const cards = Array.from(document.querySelectorAll('.feed-item[data-bsky-uri]'))
        .filter(card => card.dataset.bskyUri && card.dataset.bskyHydrated !== 'true');
    if (!cards.length) return;

    const cardsByUri = new Map();
    cards.forEach(card => {
        const uri = card.dataset.bskyUri;
        if (!uri) return;
        if (!cardsByUri.has(uri)) {
            cardsByUri.set(uri, []);
        }
        cardsByUri.get(uri).push(card);
    });

    const uniqueUris = Array.from(cardsByUri.keys());
    const chunkSize = 20;
    for (let index = 0; index < uniqueUris.length; index += chunkSize) {
        const chunk = uniqueUris.slice(index, index + chunkSize);
        const postsMap = await fetchBlueskyPosts(chunk);
        chunk.forEach(uri => {
            const post = postsMap.get(uri);
            const relatedCards = cardsByUri.get(uri) || [];
            relatedCards.forEach(card => {
                card.dataset.bskyHydrated = 'true';
                const target = card.querySelector('[data-bsky-embed]');
                if (!target) return;
                const html = renderBlueskyEmbedHtml(post);
                if (html) {
                    target.innerHTML = html;
                    target.classList.add('bluesky-rich-embed--visible');
                } else {
                    target.remove();
                }
            });
        });
    }
}

async function fetchBlueskyPosts(uris = []) {
    const result = new Map();
    if (!uris.length) return result;

    const missing = uris.filter(uri => !BLUESKY_POST_CACHE.has(uri));
    if (missing.length) {
        const params = missing.map(uri => `uris=${encodeURIComponent(uri)}`).join('&');
        try {
            const response = await fetch(`https://public.api.bsky.app/xrpc/app.bsky.feed.getPosts?${params}`);
            if (!response.ok) {
                throw new Error(`Bluesky API error: ${response.status}`);
            }
            const data = await response.json();
            (data?.posts || []).forEach(post => {
                if (post?.uri) {
                    BLUESKY_POST_CACHE.set(post.uri, post);
                }
            });
            missing.forEach(uri => {
                if (!BLUESKY_POST_CACHE.has(uri)) {
                    BLUESKY_POST_CACHE.set(uri, null);
                }
            });
        } catch (error) {
            console.warn('Unable to load Bluesky embeds', error);
            missing.forEach(uri => {
                if (!BLUESKY_POST_CACHE.has(uri)) {
                    BLUESKY_POST_CACHE.set(uri, null);
                }
            });
        }
    }

    uris.forEach(uri => {
        result.set(uri, BLUESKY_POST_CACHE.get(uri) || null);
    });
    return result;
}

function renderBlueskyEmbedHtml(post) {
    if (!post || !post.embed) return '';
    return renderBlueskyEmbedView(post.embed);
}

function renderBlueskyEmbedView(embed) {
    if (!embed || typeof embed !== 'object') return '';
    switch (embed.$type) {
        case 'app.bsky.embed.external#view':
            return renderBlueskyExternalCard(embed.external);
        case 'app.bsky.embed.images#view':
            return renderBlueskyImages(embed.images);
        case 'app.bsky.embed.record#view':
            return renderBlueskyRecord(embed.record);
        case 'app.bsky.embed.recordWithMedia#view':
            return `${renderBlueskyEmbedView(embed.media)}${renderBlueskyRecord(embed.record)}`;
        case 'app.bsky.embed.video#view':
            return renderBlueskyVideo(embed);
        default:
            return '';
    }
}

function renderBlueskyExternalCard(external) {
    if (!external) return '';
    const host = safeHostname(external.uri || external.url || '');
    return `
        <a class="bluesky-link-card" href="${escapeHtml(external.uri || external.url || '')}" target="_blank" rel="noopener noreferrer">
            ${external.thumb ? `<img src="${escapeHtml(external.thumb)}" alt="" class="bluesky-link-thumb">` : ''}
            <div class="bluesky-link-details">
                ${external.title ? `<div class="bluesky-link-title">${escapeHtml(external.title)}</div>` : ''}
                ${external.description ? `<p class="bluesky-link-description">${escapeHtml(external.description)}</p>` : ''}
                ${host ? `<span class="bluesky-link-host">${escapeHtml(host)}</span>` : ''}
            </div>
        </a>
    `;
}

function renderBlueskyImages(images) {
    if (!Array.isArray(images) || !images.length) return '';
    return `
        <div class="bluesky-image-grid bluesky-image-grid--${Math.min(images.length, 4)}">
            ${images.map(image => `
                <a href="${escapeHtml(image.fullsize || image.thumb || '')}" target="_blank" rel="noopener noreferrer" class="bluesky-image">
                    <img src="${escapeHtml(image.thumb || image.fullsize || '')}" alt="${escapeHtml(image.alt || '')}" loading="lazy">
                </a>
            `).join('')}
        </div>
    `;
}

function renderBlueskyRecord(record) {
    if (!record) return '';
    const authorName = record.author?.displayName || record.author?.handle || 'Bluesky user';
    const handle = record.author?.handle ? `@${record.author.handle}` : '';
    const href = buildBskyPermalink(record.uri, record.author?.handle);
    const textHtml = renderBlueskyRichText(record.value);
    const nestedEmbeds = Array.isArray(record.embeds)
        ? record.embeds.map(renderBlueskyEmbedView).join('')
        : '';

    return `
        <a class="bluesky-quote-card" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">
            <div class="bluesky-quote-header">
                ${record.author?.avatar ? `<img src="${escapeHtml(record.author.avatar)}" alt="" class="bluesky-quote-avatar">` : ''}
                <div>
                    <div class="bluesky-quote-name">${escapeHtml(authorName)}</div>
                    ${handle ? `<div class="bluesky-quote-handle">${escapeHtml(handle)}</div>` : ''}
                </div>
            </div>
            ${textHtml ? `<p class="bluesky-quote-text">${textHtml}</p>` : ''}
            ${nestedEmbeds}
        </a>
    `;
}

function renderBlueskyVideo(embed) {
    const url = embed?.playlist;
    if (!url) return '';
    return `
        <div class="bluesky-video">
            <video controls preload="metadata" ${embed.thumbnail ? `poster="${escapeHtml(embed.thumbnail)}"` : ''}>
                <source src="${escapeHtml(url)}" type="application/x-mpegURL">
            </video>
        </div>
    `;
}

function renderBlueskyRichText(value) {
    if (!value || !value.text) return '';
    const escaped = escapeHtml(value.text);
    return escaped.replace(/\n/g, '<br>');
}

function buildBskyPermalink(uri, handle) {
    if (!uri) return '';
    const segments = uri.split('/');
    const postId = segments[segments.length - 1];
    if (handle) {
        return `https://bsky.app/profile/${handle}/post/${postId}`;
    }
    const did = segments[2];
    return `https://bsky.app/profile/${did}/post/${postId}`;
}

function createFeedCard(item) {
    let domain = '';
    try {
        const url = new URL(item.url);
        domain = url.hostname;
    } catch (e) {
        domain = '';
    }

    const folder = STATE.folders.find(f => f.id === item.folderId);
    const feed = STATE.feeds.find(f => f.id === item.feedId);
    const feedName = feed ? feed.title : (item.feedTitle || 'Unknown Feed');
    const sourceStrings = [
        item?.url,
        item?.enclosureLink,
        item?.feedLink,
        feed?.url,
        feed?.link
    ]
        .filter(Boolean)
        .map(value => String(value).toLowerCase());
    const matchesSource = (needle) => sourceStrings.some(src => src.includes(needle));
    const forcedAvatarIcon = (() => {
        if (matchesSource('rss-timestamp-adder')) {
            return { src: 'icons/tiktok.svg', alt: 'TikTok feed' };
        }
        if (matchesSource('youtube-rss')) {
            return { src: 'icons/video.svg', alt: 'Video feed' };
        }
        return null;
    })();
    const rawItemUrl = item?.url || '';
    const safeItemUrl = escapeHtml(rawItemUrl);
    const normalizedTitle = (item.title || '').trim();
    const showTitle = shouldDisplayFeedTitle(normalizedTitle);
    const rawExcerpt = CONFIG.SHOW_POST_CONTENT ? getFeedExcerpt(item.body) : '';
    const excerpt = shouldDisplayFeedExcerpt(rawExcerpt, normalizedTitle, domain, feedName) ? rawExcerpt : '';
    const isBluesky = isBlueskySource(domain, feedName, item.url);
    const bskyUri = isBluesky && item.guid && item.guid.startsWith('at://') ? item.guid : null;
    const useApiBlueskyEnhancements = Boolean(bskyUri);
    const media = extractFeedMedia(item);
    const timestamp = formatPublishDate(item.pubDate);
    const metrics = extractEngagementMetrics(item);
    const blueskyExtras = useApiBlueskyEnhancements ? null : extractBlueskyEnhancements(item, safeItemUrl, domain, feedName);
    const blueskyEmbedPlaceholder = useApiBlueskyEnhancements
        ? '<div class="bluesky-rich-embed" data-bsky-embed></div>'
        : '';
    const isUnread = isItemUnread(item);
    const titleMarkup = showTitle ? `
            <a href="${safeItemUrl}"
               class="feed-item-link">
                <h3 class="feed-title">${escapeHtml(normalizedTitle)}</h3>
            </a>
        ` : '';

    const avatarMarkup = (() => {
        if (forcedAvatarIcon) {
            return `<img src="${forcedAvatarIcon.src}" alt="${escapeHtml(forcedAvatarIcon.alt)}" class="feed-avatar feed-avatar--custom">`;
        }
        if (item.feedTitle && item.feedTitle.toLowerCase().includes('tiktok') && item.body) {
            const temp = document.createElement('div');
            temp.innerHTML = item.body;
            const profileImg = temp.querySelector('img');
            if (profileImg && profileImg.getAttribute('src')) {
                return `<img src="${escapeHtml(profileImg.getAttribute('src'))}" alt="" class="feed-avatar">`;
            }
        }
        return domain
            ? `<img src="https://www.google.com/s2/favicons?domain=${domain}&sz=64" alt="" class="feed-avatar">`
            : `<div class="feed-avatar feed-avatar--fallback">${escapeHtml(feedName.charAt(0) || '?')}</div>`;
    })();
    const feedSourceMarkup = `
        <div class="feed-source">
            <span class="feed-source-name">${escapeHtml(feedName)}</span>
            <div class="feed-meta-line">
                ${folder ? `<span class="feed-folder-pill">${escapeHtml(folder.name)}</span>` : ''}
                ${timestamp ? `<span class="feed-date">${escapeHtml(timestamp)}</span>` : ''}
            </div>
        </div>
    `;
    const isStarred = Boolean(item.starred);
    const markReadButton = isUnread ? `
        <button class="feed-mark-btn"
                type="button"
                data-item-id="${item.id}"
                aria-label="Mark item as viewed"
                title="Mark as viewed">
            <img src="icons/X.webp" alt="Mark as viewed">
        </button>
    ` : '';
    const starButton = `
        <button class="feed-star-btn ${isStarred ? 'is-starred' : ''}"
                type="button"
                data-item-id="${item.id}"
                aria-pressed="${isStarred}"
                title="${isStarred ? 'Unstar item' : 'Star item'}">
            <img src="icons/${isStarred ? 'starred' : 'unstarred'}.png" alt="toggle star">
        </button>
    `;

    return `
        <article class="feed-item ${isUnread ? '' : 'feed-item--read'}"
                 ${bskyUri ? `data-bsky-uri="${escapeHtml(bskyUri)}"` : ''}
                 data-link="${safeItemUrl}"
                 data-item-id="${item.id}"
                 data-unread="${isUnread}">
            <div class="feed-item-top">
                <div class="feed-top-left">
                    <a href="${safeItemUrl}" class="feed-top-link">
                        ${avatarMarkup}
                        ${feedSourceMarkup}
                    </a>
                </div>
                <div class="feed-actions">
                    ${markReadButton}
                    ${starButton}
                </div>
            </div>
            ${titleMarkup}
            ${excerpt ? `<p class="feed-excerpt"><a href="${safeItemUrl}" class="feed-excerpt-link">${escapeHtml(excerpt)}</a></p>` : ''}
            ${blueskyEmbedPlaceholder}
            ${(!useApiBlueskyEnhancements && (!blueskyExtras || !blueskyExtras.hasRichMedia) && media)
                ? `<div class="${buildMediaClassList(media)}">${media.markup}</div>` : ''}
            ${!useApiBlueskyEnhancements && blueskyExtras ? `${blueskyExtras.attachmentsHtml || ''}${blueskyExtras.quoteHtml || ''}` : ''}
            ${metrics ? `
                <div class="feed-metrics">
                    ${metrics.map(metric => `
                        <span class="feed-metric" title="${escapeHtml(metric.label)}">
                            <span class="metric-icon">${escapeHtml(metric.icon)}</span>
                            <span class="metric-value">${escapeHtml(formatMetricValue(metric.value))}</span>
                        </span>
                    `).join('')}
                </div>
            ` : ''}
        </article>
    `;
}

function getFeedExcerpt(body) {
    if (!body) return '';
    const text = stripHtml(body).replace(/\s+/g, ' ').trim();
    if (!text) return '';
    const limit = CONFIG.POST_CONTENT_LIMIT || 280;
    return text.length > limit ? `${text.slice(0, limit - 1).trim()}…` : text;
}

function extractFeedMedia(item) {
    if (!item) return null;
    let domain = '';
    try {
        domain = new URL(item.url).hostname.toLowerCase();
    } catch (error) {
        domain = '';
    }

    const temp = item.body ? document.createElement('div') : null;
    if (temp) {
        temp.innerHTML = item.body;
    }

    const lemmyVideo = isLemmySource(domain, item.feedTitle, item.url) ? extractLemmyVideo(temp) : null;
    if (lemmyVideo) {
        return lemmyVideo;
    }

    const videoResult = findEmbeddableVideoUrl(item, temp);
    if (videoResult && videoResult.embedUrl && !/tiktok\.com/.test(videoResult.embedUrl)) {
        const baseWatchUrl = videoResult.originalUrl || videoResult.embedUrl.replace('/embed/', '/watch?v=');
        const watchUrl = addInvidiousPlaybackSpeed(baseWatchUrl);

        let thumbnailSrc = null;
        const videoIdMatch = videoResult.embedUrl.match(/\/embed\/([^?]+)/);
        if (videoIdMatch && videoIdMatch[1]) {
            thumbnailSrc = `https://img.youtube.com/vi/${videoIdMatch[1]}/hqdefault.jpg`;
        }

        if (!thumbnailSrc) {
            const image = temp?.querySelector('img');
            thumbnailSrc = image ? (image.getAttribute('src') || image.getAttribute('data-src')) : null;
        }

        const backgroundStyle = thumbnailSrc
            ? `background: linear-gradient(rgba(0, 0, 0, 0.4), rgba(0, 0, 0, 0.6)), url('${escapeHtml(thumbnailSrc)}') center/cover;`
            : `background: rgba(74, 158, 255, 0.1);`;

        return {
            variant: 'link',
            markup: `
                <div class="feed-video-responsive">
                    <a href="${escapeHtml(watchUrl)}" class="feed-video-link feed-video-link--mobile" style="display: flex; align-items: center; justify-content: center; text-align: center; min-height: 200px; padding: 2rem; ${backgroundStyle} border-radius: 12px; text-decoration: none; transition: all 0.2s ease; position: relative; overflow: hidden;">
                        <img src="icons/play.svg" alt="Play" class="feed-video-play-icon">
                    </a>
                    <div class="feed-video-embed" data-embed-src="${escapeHtml(videoResult.embedUrl)}"></div>
                </div>
            `
        };
    }

    const image = temp?.querySelector('img');
    const tiktokThumbnail = extractTikTokThumbnail(image);

    if (tiktokThumbnail) {
        const src = tiktokThumbnail.getAttribute('src') || tiktokThumbnail.getAttribute('data-src');
        if (src) {
            return {
                variant: 'link',
                markup: `<a href="${escapeHtml(item.url || '')}" class="feed-image-link">
                            <img src="${escapeHtml(src)}" alt="${escapeHtml(tiktokThumbnail.getAttribute('alt') || '')}" loading="lazy">
                         </a>`
            };
        }
    }

    if (item.enclosureLink && item.enclosureMime && item.enclosureMime.startsWith('image/')) {
        return {
            variant: 'image',
            markup: `<a href="${escapeHtml(item.url || '')}" class="feed-image-link">
                        <img src="${escapeHtml(item.enclosureLink)}" alt="" loading="lazy">
                     </a>`
        };
    }

    if (image) {
        const src = image.getAttribute('src') || image.getAttribute('data-src');
        if (src && !isTikTokCdn(src)) {
            return {
                variant: 'image',
                markup: `<a href="${escapeHtml(item.url || '')}" class="feed-image-link">
                            <img src="${escapeHtml(src)}" alt="${escapeHtml(image.getAttribute('alt') || '')}" loading="lazy">
                         </a>`
            };
        }
    }

    const video = temp?.querySelector('video, iframe');
    if (video) {
        const src = video.getAttribute('src');
        if (src && !/tiktok\.com/.test(src)) {
            return {
                variant: 'link',
                markup: `<a href="${escapeHtml(src)}" class="feed-media-link">View media</a>`
            };
        }
    }

    return null;
}

function findEmbeddableVideoUrl(item, tempNode) {
    const candidates = [];
    const pushCandidate = (value) => {
        if (!value) return;
        candidates.push(value);
    };

    pushCandidate(item?.url);
    pushCandidate(item?.enclosureLink);

    if (tempNode) {
        tempNode.querySelectorAll('iframe, video').forEach(el => {
            pushCandidate(el.getAttribute('src'));
        });
        tempNode.querySelectorAll('a[href]').forEach(el => {
            pushCandidate(el.getAttribute('href'));
        });
    }

    for (const raw of candidates) {
        const embedUrl = convertUrlToEmbed(raw);
        if (embedUrl) {
            return {
                originalUrl: raw,
                embedUrl: embedUrl
            };
        }
    }
    return null;
}

function convertUrlToEmbed(rawUrl) {
    if (!rawUrl) return null;
    const decoded = decodeHtmlEntities(String(rawUrl).trim());
    if (!decoded) return null;

    let parsed;
    try {
        parsed = new URL(decoded);
    } catch (error) {
        return null;
    }

    const host = parsed.hostname.toLowerCase();
    const origin = parsed.origin;
    const pathname = parsed.pathname;

    if (host === 'youtu.be') {
        const id = pathname.split('/').filter(Boolean)[0];
        return id ? `https://www.youtube.com/embed/${id}` : null;
    }

    if (host.endsWith('youtube.com')) {
        if (pathname.startsWith('/embed/')) {
            return `${origin}${pathname}${parsed.search}`;
        }
        const shortsMatch = pathname.startsWith('/shorts/') ? pathname.split('/').filter(Boolean)[1] : null;
        const videoId = parsed.searchParams.get('v') || shortsMatch;
        return videoId ? `https://www.youtube.com/embed/${videoId}` : null;
    }

    if (isInvidiousHost(host)) {
        if (pathname.startsWith('/embed/')) {
            return addInvidiousPlaybackSpeed(`${origin}${pathname}${parsed.search}`);
        }
        const videoId = parsed.searchParams.get('v');
        return videoId ? addInvidiousPlaybackSpeed(`${origin}/embed/${videoId}`) : null;
    }

    if (host.endsWith('tiktok.com')) {
        const videoId = extractTikTokVideoId(pathname);
        if (videoId) {
            const params = new URLSearchParams(parsed.search);
            if (!params.has('loop')) params.set('loop', '1');
            if (!params.has('controls')) params.set('controls', '1');
            params.set('speed', '1.75');
            return `https://www.tiktok.com/embed/${videoId}?${params.toString()}`;
        }
    }

    return null;
}

function addInvidiousPlaybackSpeed(urlString) {
    try {
        const url = new URL(urlString);
        if (!isInvidiousHost(url.hostname)) {
            return urlString;
        }
        url.searchParams.set('speed', '1.75');
        return url.toString();
    } catch (error) {
        console.warn('Unable to set Invidious playback speed for', urlString, error);
        return urlString;
    }
}

function extractTikTokVideoId(pathname) {
    const parts = pathname.split('/').filter(Boolean);
    const videoIndex = parts.findIndex((segment) => segment === 'video');
    if (videoIndex !== -1 && parts[videoIndex + 1]) {
        return parts[videoIndex + 1];
    }
    const lastSegment = parts[parts.length - 1];
    if (lastSegment && /^[0-9A-Za-z_-]+$/.test(lastSegment)) {
        return lastSegment;
    }
    return null;
}

function extractTikTokThumbnail(imageNode) {
    if (!imageNode) return null;
    const src = imageNode.getAttribute('src') || imageNode.getAttribute('data-src');
    if (!src) return null;
    return isTikTokCdn(src) ? imageNode : null;
}

function isTikTokCdn(url) {
    return /tiktokcdn\.com|p\d+-sign/.test(url);
}

function buildMediaClassList(media) {
    const classes = ['feed-media'];
    if (media.variant) classes.push(`feed-media--${media.variant}`);
    if (media.extraClass) classes.push(media.extraClass);
    return classes.join(' ');
}

function formatPublishDate(pubDate) {
    if (!pubDate) return '';

    let timestamp = pubDate;
    if (typeof pubDate === 'number') {
        timestamp = pubDate > 1e12 ? pubDate : pubDate * 1000;
    } else if (typeof pubDate === 'string') {
        const parsed = Date.parse(pubDate);
        if (!Number.isNaN(parsed)) {
            timestamp = parsed;
        }
    }

    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return '';

    const now = new Date();
    const sameDay = date.toDateString() === now.toDateString();

    if (sameDay) {
        return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    }

    return date.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
    });
}

function extractEngagementMetrics(item) {
    if (!item) return null;

    const metrics = [];
    const candidates = [
        { key: 'replies', label: 'Replies', icon: '💬' },
        { key: 'comments', label: 'Comments', icon: '💬' },
        { key: 'reposts', label: 'Reposts', icon: '↻' },
        { key: 'shares', label: 'Shares', icon: '↻' },
        { key: 'likes', label: 'Likes', icon: '❤' }
    ];

    candidates.forEach(({ key, label, icon }) => {
        const directValue = item[key] ?? (item.metrics ? item.metrics[key] : undefined);
        if (typeof directValue === 'number') {
            if (!metrics.some(m => m.label === label)) {
                metrics.push({ label, icon, value: directValue });
            }
        }
    });

    if (!metrics.length && item.body) {
        const text = stripHtml(item.body);
        const regexes = [
            { label: 'Replies', icon: '💬', regex: /Replies?:\s*([\d,]+)/i },
            { label: 'Reposts', icon: '↻', regex: /Reposts?:\s*([\d,]+)/i },
            { label: 'Likes', icon: '❤', regex: /Likes?:\s*([\d,]+)/i }
        ];

        regexes.forEach(({ label, icon, regex }) => {
            const match = text.match(regex);
            if (match && !metrics.some(m => m.label === label)) {
                const value = parseInt(match[1].replace(/,/g, ''), 10);
                metrics.push({ label, icon, value: Number.isNaN(value) ? match[1] : value });
            }
        });
    }

    return metrics.length ? metrics : null;
}

function formatMetricValue(value) {
    if (typeof value === 'number') {
        return value.toLocaleString();
    }

    return `${value}`;
}

function shouldDisplayFeedTitle(title) {
    if (!title) return false;
    return title.toLowerCase() !== 'untitled';
}

function shouldDisplayFeedExcerpt(excerpt, title, domain, feedName) {
    if (!excerpt) return false;
    if (isTikTokSource(domain, feedName)) return false;
    if (title && excerpt && excerpt.toLowerCase() === title.toLowerCase()) return false;
    return true;
}

function isTikTokSource(domain, feedName) {
    const domainText = (domain || '').toLowerCase();
    const feedText = (feedName || '').toLowerCase();
    return domainText.includes('tiktok') || feedText.includes('tiktok');
}

function attachFeedItemInteractions() {
    document.querySelectorAll('.feed-item').forEach(item => {
        item.addEventListener('click', (e) => {
            const targetAnchor = e.target.closest('a');
            if (!targetAnchor) {
                const link = item.querySelector('.feed-item-link');
                if (link) link.click();
            }

            const itemId = parseInt(item.dataset.itemId, 10);
            if (!Number.isNaN(itemId)) {
                markFeedItemAsRead(itemId);
            }
        });
    });
}

function attachStarToggleHandlers() {
    document.querySelectorAll('.feed-star-btn').forEach(btn => {
        if (btn.dataset.bound) return;
        btn.dataset.bound = 'true';
        btn.addEventListener('click', async (event) => {
            event.stopPropagation();
            const itemId = parseInt(btn.dataset.itemId, 10);
            if (Number.isNaN(itemId)) return;
            const shouldStar = !btn.classList.contains('is-starred');
            try {
                await updateItemStar(itemId, shouldStar, btn);
            } catch (error) {
                console.error('Star toggle error:', error);
            }
        });
    });
}

function attachViewToggleHandlers() {
    document.querySelectorAll('.view-toggle-chip').forEach(btn => {
        btn.addEventListener('click', () => {
            const view = btn.dataset.view;
            if (!view || view === STATE.feedViewFilter) return;
            STATE.feedViewFilter = view;
            STATE.feedOffset = 0;
            STATE.feedHasMore = true;
            loadNextcloudFeed(STATE.selectedFolder);
        });
    });
}

function attachMarkReadHandlers() {
    document.querySelectorAll('.feed-mark-btn').forEach(btn => {
        if (btn.dataset.bound) return;
        btn.dataset.bound = 'true';
        btn.addEventListener('click', (event) => {
            event.stopPropagation();
            const itemId = parseInt(btn.dataset.itemId, 10);
            if (Number.isNaN(itemId)) return;
            markFeedItemAsRead(itemId);
        });
    });
}

function attachFolderClickHandlers() {
    document.querySelectorAll('.folder-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const isStarred = btn.dataset.folderStarred === 'true';
            if (isStarred) {
                if (STATE.showStarredOnly) return;
                STATE.showStarredOnly = true;
                STATE.selectedFolder = null;
                STATE.feedViewFilter = 'all';
            } else {
                const folderId = btn.dataset.folderId;
                STATE.showStarredOnly = false;
                STATE.selectedFolder = folderId === 'null' ? null : parseInt(folderId);
            }
            STATE.feedOffset = 0;
            STATE.feedHasMore = true;
            loadNextcloudFeed(STATE.selectedFolder);
        });
    });
}

// ============================================================================
// READ/STAR STATE
// ============================================================================

function markFeedItemAsRead(itemId) {
    const numericId = Number(itemId);
    if (!Number.isInteger(numericId)) return;

    const item = (STATE.latestItems || []).find(entry => entry && entry.id === numericId);
    if (item) {
        item.unread = false;
    }

    STATE.localReadItems.add(numericId);
    trimSetToLimit(STATE.localReadItems, 1000);
    persistLocalReadItems();

    displayFeed();

    if (CONFIG.NEXTCLOUD_URL && CONFIG.NEXTCLOUD_USER !== 'YOUR_USERNAME') {
        STATE.readSyncQueue.add(numericId);
        trimSetToLimit(STATE.readSyncQueue, 1000);
        persistReadSyncQueue();
        syncItemReadStatus(numericId);
    }
}

function applyLocalReadOverrides(items) {
    if (!items || !Array.isArray(items)) return;
    items.forEach(item => {
        if (!item) return;
        if (STATE.localReadItems.has(item.id)) {
            item.unread = false;
        }
    });
}

function initializeLocalReadTracking() {
    STATE.localReadItems = loadSetFromStorage(LOCAL_STORAGE_KEYS.readItems);
    STATE.readSyncQueue = loadSetFromStorage(LOCAL_STORAGE_KEYS.readSyncQueue);
    trimSetToLimit(STATE.localReadItems, 1000);
    trimSetToLimit(STATE.readSyncQueue, 1000);
}

function persistLocalReadItems() {
    saveSetToStorage(LOCAL_STORAGE_KEYS.readItems, STATE.localReadItems);
}

function persistReadSyncQueue() {
    saveSetToStorage(LOCAL_STORAGE_KEYS.readSyncQueue, STATE.readSyncQueue);
}

function loadSetFromStorage(key) {
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return new Set();
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
            const numbers = parsed
                .map(value => Number(value))
                .filter(value => Number.isInteger(value));
            return new Set(numbers);
        }
    } catch (error) {
        console.warn('Storage load failed:', error);
    }
    return new Set();
}

function saveSetToStorage(key, set) {
    try {
        const values = Array.from(set);
        localStorage.setItem(key, JSON.stringify(values));
    } catch (error) {
        console.warn('Storage save failed:', error);
    }
}

function trimSetToLimit(set, limit) {
    if (!set || typeof set.values !== 'function') return;
    while (set.size > limit) {
        const first = set.values().next().value;
        set.delete(first);
    }
}

function processReadSyncQueue() {
    if (!CONFIG.NEXTCLOUD_URL || CONFIG.NEXTCLOUD_USER === 'YOUR_USERNAME') {
        return;
    }
    if (!STATE.readSyncQueue || STATE.readSyncQueue.size === 0) {
        return;
    }
    STATE.readSyncQueue.forEach(id => {
        syncItemReadStatus(id);
    });
}

async function syncItemReadStatus(itemId) {
    if (!CONFIG.NEXTCLOUD_URL || CONFIG.NEXTCLOUD_USER === 'YOUR_USERNAME') {
        return;
    }
    if (!Number.isInteger(itemId)) return;
    if (STATE.pendingReadMarks.has(itemId)) return;

    STATE.pendingReadMarks.add(itemId);

    try {
        const auth = btoa(`${CONFIG.NEXTCLOUD_USER}:${CONFIG.NEXTCLOUD_PASS}`);
        const response = await fetch(`${CONFIG.NEXTCLOUD_URL}/index.php/apps/news/api/v1-3/items/${itemId}/read`, {
            method: 'PUT',
            headers: {
                'Authorization': `Basic ${auth}`,
                'Accept': 'application/json'
            }
        });

        if (!response.ok) throw new Error('Failed to update read status');

        STATE.readSyncQueue.delete(itemId);
        persistReadSyncQueue();
    } catch (error) {
        console.error('Read sync error:', error);
    } finally {
        STATE.pendingReadMarks.delete(itemId);
    }
}

async function updateItemStar(itemId, shouldStar, button) {
    if (!CONFIG.NEXTCLOUD_URL || CONFIG.NEXTCLOUD_USER === 'YOUR_USERNAME') return;
    if (!Number.isInteger(itemId)) return;
    if (STATE.pendingStarToggles.has(itemId)) return;

    STATE.pendingStarToggles.add(itemId);
    setStarButtonState(button, shouldStar);
    updateLocalItemStar(itemId, shouldStar);
    if (button) button.disabled = true;

    try {
        const auth = btoa(`${CONFIG.NEXTCLOUD_USER}:${CONFIG.NEXTCLOUD_PASS}`);
        const endpoint = shouldStar ? 'star' : 'unstar';
        const response = await fetch(`${CONFIG.NEXTCLOUD_URL}/index.php/apps/news/api/v1-3/items/${itemId}/${endpoint}`, {
            method: 'POST',
            headers: {
                'Authorization': `Basic ${auth}`,
                'Accept': 'application/json'
            }
        });
        if (!response.ok) throw new Error('Failed to update star status');

        if (STATE.showStarredOnly && !shouldStar) {
            STATE.latestItems = STATE.latestItems.filter(item => item.id !== itemId);
            displayFeed();
        }
    } catch (error) {
        console.error('Star update error:', error);
        setStarButtonState(button, !shouldStar);
        updateLocalItemStar(itemId, !shouldStar);
    } finally {
        if (button) button.disabled = false;
        STATE.pendingStarToggles.delete(itemId);
    }
}

function setStarButtonState(button, shouldStar) {
    if (!button) return;
    button.classList.toggle('is-starred', shouldStar);
    button.setAttribute('aria-pressed', shouldStar);
    button.title = shouldStar ? 'Unstar item' : 'Star item';
    const img = button.querySelector('img');
    if (img) {
        img.src = `icons/${shouldStar ? 'starred' : 'unstarred'}.png`;
        img.alt = shouldStar ? 'starred' : 'unstarred';
    }
}

function updateLocalItemStar(itemId, shouldStar) {
    const targetItem = STATE.latestItems.find(item => item.id === itemId);
    if (targetItem) {
        targetItem.starred = shouldStar;
    }
}

// ============================================================================
// UTILS
// ============================================================================

const HTML_ENTITY_PARSER = typeof document !== 'undefined' ? document.createElement('textarea') : null;

function decodeHtmlEntities(text) {
    if (!text || !HTML_ENTITY_PARSER) return text || '';
    HTML_ENTITY_PARSER.innerHTML = text;
    return HTML_ENTITY_PARSER.value;
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function stripHtml(html) {
    if (!html) return '';
    const div = document.createElement('div');
    div.innerHTML = html;
    return (div.textContent || div.innerText || '').trim();
}

function safeHostname(url) {
    if (!url) return '';
    try {
        const parsed = new URL(url);
        return parsed.hostname.replace(/^www\./, '');
    } catch (error) {
        return '';
    }
}
