// api/jagan-share-page.mjs — 邪眼診断。処理の本体は lib/jagan-api.mjs（createSharePageHandler）。
import { createSharePageHandler } from '../lib/jagan-api.mjs';

export default createSharePageHandler({ env: process.env });
