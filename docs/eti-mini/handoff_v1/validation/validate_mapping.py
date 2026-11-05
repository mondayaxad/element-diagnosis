#!/usr/bin/env python3
"""Validate a 7x5x8 fixed-result mapping, candidate inclusion and balance."""
import json
from collections import Counter
from itertools import product
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
mapping = json.loads((ROOT / 'data/eti_mini_758_5star_280_mapping.json').read_text(encoding='utf-8'))
candidates = json.loads((ROOT / 'data/eti_mini_auto_candidates_v1.json').read_text(encoding='utf-8'))
chars = json.loads((ROOT / 'step0/characters_full.json').read_text(encoding='utf-8'))
rows = mapping['rows']
elements = ['炎','水','氷','雷','風','岩','草']
weapons = ['片手剣','両手剣','長柄','法器','弓']
nations = ['モンド','璃月','稲妻','スメール','フォンテーヌ','ナタ','スネージナヤ','ナドクライ']
expected = {'|'.join(x) for x in product(elements, weapons, nations)}
keys = [r['key'] for r in rows]
cnames = set(candidates['candidate_names'])
char_names = {c['name'] for c in chars['characters']}
counts = Counter(r['mirror_character'] for r in rows)
assert len(rows) == 280 and len(set(keys)) == 280 and set(keys) == expected
assert all(r['key'] == '|'.join((r['answers']['element'],r['answers']['weapon'],r['answers']['nation'])) for r in rows)
assert len(cnames) == 66 and cnames <= char_names
assert set(counts) == cnames and Counter(counts.values()) == {4:50, 5:16}
assert not (cnames & {'主人公','ドール','アーロイ'})
assert max(r['internal_rank'] for r in rows) == 27
print('PASS: 280 unique patterns; 66 candidates all represented; 50x4 + 16x5; no exclusions or unknowns')
print('NOTE: balanced across possible answers, not necessarily real-world user frequencies.')
