#### Warning
This is almost entirely AI generated, so the code is a mess and is really only meant for my personal use as it has dependencies on cloudflare workers and rss-bridge, it works, but probably only for me. 

#### Purpose
This is a frontend for nextcloud news, allows for quickly swiping through content and work arounds for youtube and tiktok RSS feeds.
#### Supports:
- blogs (I'd say they're in a "working" state, but different formatting from sites can mess with it, worst comes to worst click the title to open the link)
- bluesky (light mode iframes only)
- tiktok (uses rss-bridge links, iframes appear in the site, works very well)
- invidious (displays thumbnails, selecting it opens it in a fullscreen embedded link, with fallback buttons for a second invidious instance and youtube, no public instances of invidious support iframes anymore that I can get working at least, I suggest hosting your own instance if you want them)
