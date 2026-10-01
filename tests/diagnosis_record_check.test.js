// js/diagnosis-record-check.js の完全一致判定（読み取り専用の「保存済み」判定）のテスト。
//   実行: node --test tests/diagnosis_record_check.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { isSameDiagnosisRecord } = require(path.join(__dirname, '..', 'js', 'diagnosis-record-check.js'));

const V2 = { diagnosisVersion: 'ETI-2.0', itemSetVersion: 'ETI-ITEM-2.0.0', scoringVersion: 'ETI-SCORE-2.0.0', diagnosisCode: 'abc123' };
const row = (o = {}, r = {}) => ({ id: 's1', diagnosis_version: 'ETI-2.0', item_set_version: 'ETI-ITEM-2.0.0', ...o,
  diagnosis_results: [{ diagnosis_code: 'abc123', scoring_version: 'ETI-SCORE-2.0.0', item_set_version: 'ETI-ITEM-2.0.0', ...r }] });

test('同じ測定条件・同じコードなら一致', () => { assert.equal(isSameDiagnosisRecord(row(), V2), true); });
test('コードが1文字でも違えば不一致（回答が違う＝別診断）', () => { assert.equal(isSameDiagnosisRecord(row({}, { diagnosis_code: 'abc124' }), V2), false); });
test('scoring_version が違えば不一致（採点版が違う＝別記録）', () => { assert.equal(isSameDiagnosisRecord(row({}, { scoring_version: 'ETI-SCORE-2.1.0' }), V2), false); });
test('item_set_version が違えば不一致', () => { assert.equal(isSameDiagnosisRecord(row({ item_set_version: 'ETI-ITEM-2.1.0' }, { item_set_version: 'ETI-ITEM-2.1.0' }), V2), false); });
test('v1 と v2 は同じコード文字列でも混同しない', () => {
  const legacyKey = { diagnosisVersion: 'element-v1', itemSetVersion: null, scoringVersion: 'element-score-v1', diagnosisCode: 'abc123' };
  assert.equal(isSameDiagnosisRecord(row(), legacyKey), false);
  assert.equal(isSameDiagnosisRecord(row({ diagnosis_version: 'element-v1', item_set_version: null }, { scoring_version: 'element-score-v1', item_set_version: null }), V2), false);
});
test('legacy：diagnosis_version が空の行も legacy として一致する', () => {
  const legacyKey = { diagnosisVersion: 'element-v1', itemSetVersion: null, scoringVersion: 'element-score-v1', diagnosisCode: '水長柄-E3w4-xyz' };
  const r = { id: 's2', diagnosis_version: null, item_set_version: null, diagnosis_results: [{ diagnosis_code: '水長柄-E3w4-xyz', scoring_version: 'element-score-v1', item_set_version: null }] };
  assert.equal(isSameDiagnosisRecord(r, legacyKey), true);
});
test('scoring_version が空の行は一致させない（安全側＝未保存として扱う）', () => {
  assert.equal(isSameDiagnosisRecord(row({}, { scoring_version: null }), V2), false);
});
test('結果行が無ければ一致しない', () => { assert.equal(isSameDiagnosisRecord({ id: 'x', diagnosis_version: 'ETI-2.0', diagnosis_results: [] }, V2), false); });
