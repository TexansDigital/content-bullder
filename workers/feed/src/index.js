// The same feed.html the local studio serves, bundled in as text by the [[rules]] block in
// wrangler.toml. One file, two runtimes; the feed cannot drift between them.
import feedHtml from '../../../app/feed.html';
import { createApp } from './app.js';

export default createApp({ feedHtml });
