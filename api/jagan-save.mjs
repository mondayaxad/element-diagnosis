// api/jagan-save.mjs — 邪眼診断。処理の本体は lib/jagan-api.mjs（createSaveHandler）。
import { createSaveHandler } from '../lib/jagan-api.mjs';

export default createSaveHandler({ env: process.env });
