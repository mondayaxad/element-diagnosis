"""Constrained adjustment of designer weights, using synthetic data only.

No character profile or human psychological score is changed by this script.
"""
from pathlib import Path
import json
import numpy as np
from scipy.optimize import minimize
from scipy.special import expit, softmax

ROOT=Path(__file__).resolve().parent
base=json.loads((ROOT/'interpretation.json').read_text())
itemset=json.loads((ROOT/'items.json').read_text())
axes=[d['id'] for d in itemset['domains']]
sizes=np.array([d['item_count'] for d in itemset['domains']])

def sample(seed,n,stress=0,suppression=0):
    rng=np.random.default_rng(seed)
    g=rng.normal(size=n)+stress
    a,c,r=rng.normal(size=(3,n))
    latent=np.stack([-.65*g+.6*a,.65*g-.6*a,-.6*g+.65*c,.6*g-.65*c,
                     -.55*g+.7*r,.55*g-.7*r,-.2*g+.8*rng.normal(size=n),
                     .25*g+.85*rng.normal(size=n)+suppression,
                     .65*g+.6*rng.normal(size=n),.65*g+.65*rng.normal(size=n),
                     .55*g+.75*rng.normal(size=n),.7*g+.6*rng.normal(size=n)],axis=1)
    result=[]
    for j,k in enumerate(sizes):
        responses=np.clip(np.floor(1+4*expit(latent[:,j,None]+.5*rng.normal(size=(n,k)))+.5),1,5)
        result.append((responses.mean(axis=1)-1)/4)
    return np.stack(result,axis=1)

def features(data):
    result=[]
    for e in base['elements']:
        result.append(np.stack([data[:,axes.index(a)] if w>0 else 1-data[:,axes.index(a)] for a,w in e['weights'].items()],axis=1))
    return np.stack(result,axis=1)

origin=np.array([[abs(w) for w in e['weights'].values()] for e in base['elements']])
assert origin.shape==(7,4)
train=features(sample(2026110205,5500))
ridge=.0002
def objective(flat,temp):
    w=flat.reshape(7,4)
    scores=np.einsum('nkj,kj->nk',train,w)
    prob=softmax(scores/temp,axis=1)
    error=prob.mean(axis=0)-1/7
    loss=float(error@error+ridge*np.sum((w-origin)**2))
    # Jacobian of mean class probabilities; one row of weights affects its own logit.
    influence=2*(prob*(error-(prob*error).sum(axis=1,keepdims=True)))/temp
    grad=np.einsum('nk,nkj->kj',influence,train)/len(train)+2*ridge*(w-origin)
    return loss,grad.ravel()

bounds=[(max(.05,float(w)-.15),min(.75,float(w)+.15)) for w in origin.ravel()]
constraints={'type':'eq','fun':lambda x:x.reshape(7,4).sum(axis=1)-1,
             'jac':lambda x:np.kron(np.eye(7),np.ones((1,4)))}
w=origin.copy();runs=[]
for temp in [.05,.02,.008]:
    r=minimize(lambda x:objective(x,temp),w.ravel(),jac=True,bounds=bounds,constraints=constraints,
               method='SLSQP',options={'maxiter':250,'ftol':1e-12})
    if not r.success:raise RuntimeError(r.message)
    w=r.x.reshape(7,4)
    runs.append({'temperature':temp,'iterations':int(r.nit),'loss':float(r.fun)})
assert np.allclose(w.sum(axis=1),1)
assert np.max(abs(w-origin))<=.150001

def counts(x,coeff):
    scores=np.einsum('nkj,kj->nk',x,coeff)
    # Expected shares distribute genuine numerical ties equally, without array-order bias.
    ties=np.isclose(scores,scores.max(axis=1,keepdims=True),rtol=0,atol=1e-11)
    shares=(ties/ties.sum(axis=1,keepdims=True)).mean(axis=0)
    return shares

summary={'kind':'synthetic_weight_calibration','real_user_data':False,
 'training_n':5500,'holdout_n':5500,'seed_training':2026110205,'seed_holdout':2026110206,
 'constraint':'feature set and signs fixed; each absolute coefficient moves <=0.15; each element total weight=1',
 'runs':runs,'baseline':origin.tolist(),'candidate':w.tolist(),'scenarios':[]}
for name,seed,n,st,sp in [('training',2026110205,5500,0,0),('holdout_mixed',2026110206,5500,0,0),
                         ('holdout_lower_distress',2026110207,2750,-.9,0),('holdout_higher_distress',2026110208,2750,.9,0),
                         ('holdout_more_suppression',2026110209,2750,0,.9)]:
    x=features(sample(seed,n,st,sp))
    before=counts(x,origin);after=counts(x,w)
    summary['scenarios'].append({'name':name,'n':n,'before_percent':(before*100).tolist(),'after_percent':(after*100).tolist(),
                                'before_max_deviation_pp':float(max(abs(before-1/7))*100),'after_max_deviation_pp':float(max(abs(after-1/7))*100)})

candidate=json.loads(json.dumps(base))
candidate['version']='jagan-interpretation-0.5.0-synthetic-calibrated'
candidate['status']='review_candidate_not_production'
candidate['calibration_version']='elements-synthetic-0.5.0'
for k,e in enumerate(candidate['elements']):
    e['weights']={a:float(w[k,j])*(1 if value>0 else -1) for j,(a,value) in enumerate(e['weights'].items())}
(ROOT/'interpretation.candidate.json').write_text(json.dumps(candidate,ensure_ascii=False,indent=2)+'\n')
(ROOT/'element.calibration.results.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n')
lines=['# 元素係数の制約付き校正 v0.5','',
'人工回答のみ。人物の数値化、実利用者の分布、心理測定上の妥当性を検証したものではない。',
'','仮説上の相関を持つ50問回答を生成。校正5,500件、独立した混合条件の保留5,500件、傾向を変えた保留3条件各2,750件。前版Nodeシミュレーションとは乱数生成器・データが異なる。',
'','元の採点先・符号を維持し、係数変化を各±0.15以内、総和1に制約。人工データへの調整であり、研究が示した係数ではない。',
'','| 条件 | 炎 | 水 | 氷 | 雷 | 風 | 岩 | 草 |','|---|---:|---:|---:|---:|---:|---:|---:|']
for s in summary['scenarios']:
    for stage,key in [('前','before_percent'),('後','after_percent')]:
        lines.append('| '+s['name']+'・'+stage+' | '+' | '.join(f'{v:.2f}%' for v in s[key])+' |')
lines+=['','数字は真の同率を等分した期待出現率。結果IDによる代表選択の実測人数ではない。',
'','## 判断','校正候補と元係数を両方残す。混合条件で均等へ近づけても、特定の回答傾向の集団まで均等になるとはしない。各項目の心理的意味のレビューと、人の回答による理解確認は別途必要。',
'','低困難時に岩・草が多いことは、元の象徴設計とも関係する。割合だけの理由で困難のある元素へ回さない。今回の変更は係数の候補に限定し、心理スコアそのものを変えない。']
(ROOT/'ELEMENT_CALIBRATION.md').write_text('\n'.join(lines)+'\n')
print(json.dumps({'runs':runs,'mixed':summary['scenarios'][1],'max_coefficient_change':float(np.max(abs(w-origin)))},ensure_ascii=False))
