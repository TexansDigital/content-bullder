// The same feed.html the local studio serves, bundled in as text by the [[rules]] block in
// wrangler.toml. One file, two runtimes; the feed cannot drift between them.
import feedHtml from '../../../app/feed.html';
// The data-capture form (the club's Eloqua template with the NFL privacy block), served at
// /enter with the fan's pseudonymous id filled in.
import enterHtml from '../../../docs/eloqua-enter.html';
// The masters upload page for Adam and Juan, served at /studio/upload.
import uploadHtml from '../../../app/upload.html';
// The tag review page for Juan, served at /studio/tags.
import tagsHtml from '../../../app/tags.html';
// Brand assets, bundled as bytes (the Data rule in wrangler.toml) and served at /app/assets/*.
import plate from '../../../app/assets/steel-916.jpg';
import star from '../../../app/assets/texans-star.png';
import fontBlack from '../../../app/assets/fonts/HelveticaNeueLTStd-BlkEx.otf';
import fontMedium from '../../../app/assets/fonts/HelveticaNeueLTStd-MdEx.otf';
import { createApp } from './app.js';

export default createApp({ feedHtml, enterHtml, uploadHtml, tagsHtml, assets: {
  'steel-916.jpg': { body: plate, type: 'image/jpeg' },
  'texans-star.png': { body: star, type: 'image/png' },
  'fonts/HelveticaNeueLTStd-BlkEx.otf': { body: fontBlack, type: 'font/otf' },
  'fonts/HelveticaNeueLTStd-MdEx.otf': { body: fontMedium, type: 'font/otf' },
} });
