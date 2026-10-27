import json, os
HERE = os.path.dirname(os.path.abspath(__file__))
CONTENT = os.path.join(HERE, '..', 'src', 'content')
REQUIRED = ['id','key','display_name','short_theme','one_liner','definition','strong','misread','type_mix','cover_line','poem','quote','intro','core_axes',
            'core_axis_meanings','natural_strength','fitting_contexts','outside_view','optimal_use','underuse_signs','overuse_signs','not_explained',
            'observation_questions','scene_templates','as_next','lend','function_short','useful_when','table','scene_step','reframe','experiment','visual','scene_label','review_status']
def dump(name, version, items, extra=None):
    for k, it in items.items():
        miss = [f for f in REQUIRED if f not in it]
        assert not miss, (k, miss)
        assert len(it['scene_templates']) >= 2 and len(it['observation_questions']) >= 2, k
        for c in it['core_axes']:
            assert c['axis'] in it['core_axis_meanings'], (k, c)
    out = dict(version=version, review_status='editorial_reviewed_v1', items=items)
    if extra: out.update(extra)
    json.dump(out, open(os.path.join(CONTENT, name), 'w', encoding='utf8'), ensure_ascii=False, indent=1)
    print(name, len(items))
