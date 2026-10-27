import json, os
from src_common import CONTENT
REL = {'alignment': '一致', 'complement': '補完', 'tension': '緊張', 'conditional': '条件付き'}
def build(name, version, layer_a, layer_b, rows, na, nb):
    items = {}
    for (a, b), r in rows.items():
        rel, summary, together, tension, works, friction, s1, s2, q = r
        assert rel in REL, (a, b)
        items[f'{a}×{b}'] = dict(pair_id=f'{layer_a}.{a}×{layer_b}.{b}', a=a, b=b, default_relation=rel, summary=summary, together=together,
                                 tension=tension, works_when=works, friction_when=friction, scene_templates=[s1, s2], observation_question=q,
                                 shared_themes=[summary], tension_themes=[tension], evidence_axes='core_axes(a)[:2] + core_axes(b)[:2]',
                                 review_status='editorial_reviewed_v1')
    assert len(items) == na * nb, (name, len(items))
    json.dump(dict(version=version, review_status='editorial_reviewed_v1', relation_labels=REL,
                   relation_rule='既定関係は辞書の編集判断。表示ラベルは本人の根拠軸がカテゴリの向きと一致する割合で確定する（CORE1-PAIR-RELATION-0.1.0）。',
                   items=items), open(os.path.join(CONTENT, name), 'w', encoding='utf8'), ensure_ascii=False, indent=1)
    print(name, len(items))
