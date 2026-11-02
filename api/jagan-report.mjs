// api/jagan-report.mjs — 邪眼診断。処理の本体は lib/jagan-api.mjs（createReportHandler）。
import { createReportHandler } from '../lib/jagan-api.mjs';

export default createReportHandler({ env: process.env });
