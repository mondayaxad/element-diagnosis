// api/jagan-share.mjs — 邪眼診断。処理の本体は lib/jagan-api.mjs（createShareHandler）。
import { createShareHandler } from '../lib/jagan-api.mjs';

export default createShareHandler({ env: process.env });
