from pathlib import Path
import json
import numpy as np
from association_experiment import sample

root=Path(__file__).resolve().parent
model=json.loads((root/'association.reference.proposed.json').read_text())
axes=model['axes'];weights=np.array([model['weights'][a] for a in axes])
profiles=np.array([[c['candidate_reference'][a]/100 for a in axes] for c in model['characters']])
result={'kind':'synthetic_shift_sensitivity','real_user_data':False,'production_ready':False,'scenarios':[]}
for name,seed,stress,suppression in [('lower_distress',2026110221,-.9,0),('higher_distress',2026110222,.9,0),('more_suppression',2026110223,0,.9)]:
    u=sample(seed,5500,stress,suppression)
    delta=u[:,None,:]-profiles[None,:,:]
    dist=np.sqrt(np.einsum('nkj,j,nkj->nk',delta,weights,delta))
    tie=np.isclose(dist,dist.min(axis=1,keepdims=True),atol=1e-11,rtol=0)
    share=(tie/tie.sum(axis=1,keepdims=True)).mean(axis=0)*100
    result['scenarios'].append({'scenario':name,'n':5500,'share_percent':{c['id']:float(s) for c,s in zip(model['characters'],share)}})
(root/'association.shift.results.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
lines=['# 連想モデル：回答傾向を変えた仮回答での確認','',
'混合条件で均等に近づけた人物連想モデルを、学習に使っていない異なる条件の仮回答へ適用した。人工データのみで、実利用者の出現率ではない。',
'','| 人物 | 低困難条件 | 高困難条件 | 表出抑制多め条件 |','|---|---:|---:|---:|']
for c in model['characters']:
    vals=[s['share_percent'][c['id']] for s in result['scenarios']]
    lines.append('| '+c['name']+' | '+' | '.join(f'{v:.2f}%' for v in vals)+' |')
lines+=['','これらの集団を各9.09%に合わせ直してはいない。回答の傾向が変われば人物の割合も変わる。混合条件での均等化は、全ての集団での均等な出現を保証しない。',
'','次の評価では、こうした分布の変化を含めて、各回答と人物の連想に無理がないかを人が確認する。数値上の均等さを原作との整合の証明としない。']
(root/'ASSOCIATION_SHIFT.md').write_text('\n'.join(lines)+'\n')
print(json.dumps({'scenarios':3,'answers':16500,'file':'ASSOCIATION_SHIFT.md'}))
