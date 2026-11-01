// The same feed.html the local studio serves, bundled in as text by the [[rules]] block in
// wrangler.toml. One file, two runtimes; the feed cannot drift between them.
import feedHtml from '../../../app/feed.html';
// The data-capture form (the club's Eloqua template with the NFL privacy block), served at
// /enter with the fan's pseudonymous id filled in.
import enterHtml from '../../../docs/eloqua-enter.html';
import { createApp } from './app.js';

export default createApp({ feedHtml, enterHtml });
