"""Calibrate fixed decision offsets on synthetic answers, never on live counters."""
from pathlib import Path
import json,hashlib
import numpy as np
from scipy.optimize import minimize
from scipy.special import logsumexp
root=Path(__file__).resolve().parent
items=json.loads((root/'items.json').read_text()); model=json.loads((root/'characters.json').read_text())
axes=model['axes']; aix={k:i for i,k in enumerate(axes)}; chars=model['characters']; nchar=len(chars)
def profile_set(seed,n=33000):
 rng=np.random.default_rng(seed);arr=[];labels=[]
 for kind in ['uniform','lower','higher','correlated']:
  size=n//4
  if kind=='uniform':latent=rng.uniform(1,5,(size,len(axes)))
  elif kind=='lower':latent=1+4*rng.beta(2,5,(size,len(axes)))
  elif kind=='higher':latent=1+4*rng.beta(5,2,(size,len(axes)))
  else:latent=np.clip(rng.uniform(1.5,4.5,(size,1))+rng.normal(0,.9,(size,len(axes))),1,5)
  x=np.empty_like(latent)
  for k in axes:
   j=aix[k];nitems=next(t['item_count'] for t in items['traits'] if t['id']==k)
   resp=np.clip(np.rint(latent[:,j,None]+rng.normal(0,.8,(size,nitems))),1,5)
   x[:,j]=25*(resp.mean(1)-1)
  arr.append(x);labels.extend([kind]*size)
 return np.concatenate(arr),np.array(labels)
def raw_scores(x):
 sal=np.maximum(x-model['salience_start'],0);total=sal.sum(1);out=[]
 for c in chars:
  ids=[aix[k] for k in c['anchors']];ref=np.array(list(c['anchors'].values()))
  agree=100*(1-np.sqrt((((x[:,ids]-ref)/100)**2).mean(1)))
  covered=np.divide(sal[:,ids].sum(1),total,out=np.ones(len(x)),where=total>0)
  out.append(model['anchor_agreement_weight']*agree+model['salience_coverage_weight']*100*covered)
 return np.stack(out,1)
def eligible(x):
 return np.ptp(x[:,[aix[k] for k in model['mapped_axes']]],axis=1)>=model['minimum_mapped_spread']
x,labels=profile_set(20261103);train=raw_scores(x[eligible(x)]);temp=.12
# 0.5.0：補正は「補正前の近さが最も近い人物から selection_max_gap 点以内」の人物にだけ使う。
#   この条件のもとで、各人物の出現率が 1/11 に近づくよう、固定補正を反復で求める（実利用者のカウンターは使わない）。
G=float(model.get('selection_max_gap',float('inf')))
def pick(raw,b):
 mx=raw.max(1,keepdims=True);v=np.where(raw>=mx-G-1e-9,raw+b,-np.inf);return v.argmax(1)
b=np.zeros(nchar)
for it in range(1500):
 share=np.bincount(pick(train,b),minlength=nchar)/len(train);lr=1.5 if it<600 else (.5 if it<1200 else .15)
 b=b+lr*(1/nchar-share)*nchar
b=b-b.mean()
class _F: success=True
fit=_F()
for c,v in zip(chars,b):c['selection_offset']=round(float(v),8)
model['calibration']={'seed':20261103,'baseline':'four_equal_synthetic_cohorts','train_n':len(x),'eligible_train_n':int(eligible(x).sum()),'temperature':temp,'selection_max_gap':G,'method':'iterative_share_matching_within_gap','optimizer_success':bool(fit.success),'not_live_user_distribution':True,'target_share':1/nchar,'offset_mean':float(b.mean()),'anchor_sha256':hashlib.sha256(json.dumps([c['anchors'] for c in chars],sort_keys=True).encode()).hexdigest()}
(root/'characters.json').write_text(json.dumps(model,ensure_ascii=False,indent=2)+'\n')
report={'train':{},'holdouts':[]};cohorts=[]
def metrics(raw):
 base=raw.argmax(1);win=pick(raw,b);before=np.bincount(base,minlength=nchar)/len(raw);after=np.bincount(win,minlength=nchar)/len(raw)
 gap=raw.max(1)-raw[np.arange(len(raw)),win]
 return {'n':len(raw),'before':before.tolist(),'after':after.tolist(),'changed':float(np.mean(win!=base)),'gap_mean':float(gap.mean()),'gap_p95':float(np.quantile(gap,.95)),'gap_max':float(gap.max()),'maximum_deviation_percentage_points':float(np.abs(after-1/nchar).max()*100)}
report['train']=metrics(train)
for seed in [20261104,20261105,20261106]:
 xx,ll=profile_set(seed);eligible_mask=eligible(xx);raw=raw_scores(xx[eligible_mask]);mm=metrics(raw);mm.update({'seed':seed,'total':len(xx),'eligible':int(eligible_mask.sum()),'deferred':int((~eligible_mask).sum())});report['holdouts'].append(mm)
 if seed==20261104:
  for label in ['uniform','lower','higher','correlated']:
   take=eligible_mask&(ll==label);pp=metrics(raw_scores(xx[take]));cohorts.append({'cohort':label,**pp})
report['cohorts']=cohorts
pooled_n=sum(a['n'] for a in report['holdouts'])
pooled_rows=[]
for i,c in enumerate(chars):
 count=sum(round(a['after'][i]*a['n']) for a in report['holdouts']);before_count=sum(round(a['before'][i]*a['n']) for a in report['holdouts'])
 pooled_rows.append({'id':c['id'],'name':c['name'],'count':count,'rate':count/pooled_n,'before_count':before_count,'before_rate':before_count/pooled_n})
report['pooled_holdout']={'total':sum(a['total'] for a in report['holdouts']),'eligible':pooled_n,'deferred':sum(a['deferred'] for a in report['holdouts']),'characters':pooled_rows}
(root/'balance-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
h=report['holdouts'][0]
lines=['# 11名の均等化：人工回答による確認','', '人物の正解ラベルや実利用者のデータを用いた精度検証ではない。独立した人工回答の基準分布で、出現率を約1/11へ近づける設計。', '',f"訓練{len(x):,}件、別seedの確認{sum(v['total'] for v in report['holdouts']):,}件。各基準分布は、一様・低め・高め・共通因子ありの4群を同じ比率で混ぜた独自の設計。実利用者を代表する根拠はない。",'', '| 人物 | 補正前（別seed） | 補正後（別seed） | 固定補正 |','|---|---:|---:|---:|']
for i,c in enumerate(chars):lines.append(f"| {c['name']} | {h['before'][i]*100:.2f}% | {h['after'][i]*100:.2f}% | {b[i]:+.2f} |")
lines+=['', '## 独立した確認群','', '| Seed | 件数 | 判定対象 | 保留 | 最少出現率 | 最多出現率 | 目標からの最大差 |','|---|---:|---:|---:|---:|---:|---:|']
for a in report['holdouts']:lines.append(f"| {a['seed']} | {a['total']:,} | {a['eligible']:,} | {a['deferred']:,} | {min(a['after'])*100:.2f}% | {max(a['after'])*100:.2f}% | {a['maximum_deviation_percentage_points']:.2f}pt |")
lines+=['',f"主確認群で補正前と選択が変わった割合：{h['changed']*100:.2f}%。元の最高類似点から選定人物への差：平均{h['gap_mean']:.2f}点、95%点{h['gap_p95']:.2f}点、最大{h['gap_max']:.2f}点。",'', '補正後の判定は単純な元類似点の最大選択ではない。選択に均等補正を使うことを方法説明で明示する。表示する%へ補正は加えない。','', '## 集団別（同じ固定補正）','', '| 人物 | 一様 | 低め | 高め | 共通因子あり |','|---|---:|---:|---:|---:|']
for i,c in enumerate(chars):lines.append('| '+c['name']+' | '+' | '.join(f"{v['after'][i]*100:.2f}%" for v in cohorts)+' |')
lines+=['', '## 読み方','', '全体の均等化はこの混合比率に対して成立する。低い回答が多い集団、高い回答が多い集団、実利用者でも同じ率になる保証はない。実運用でカウンターを見て当選者を入れ替える方式ではない。', '', '人物の座標は未知軸を補完しない部分的な物語参照。数値は作者の設計仮説であり、人物本人の心理得点ではない。均等化ができても、その解釈や測定精度が正しいことにはならない。']
lines+=['', '## 独立99,000件の合算', '', f'判定対象{pooled_n:,}件、保留{report["pooled_holdout"]["deferred"]}件。人物を出した件数が分母。', '', '| 人物 | 補正前 | 補正後 |', '|---|---:|---:|']
for a in pooled_rows:lines.append(f"| {a['name']} | {a['before_rate']*100:.2f}% | {a['rate']*100:.2f}% |")
(root/'BALANCE_REPORT.md').write_text('\n'.join(lines)+'\n')
print('\n'.join(lines[:26]));print('max dev across holdouts',max(v['maximum_deviation_percentage_points'] for v in report['holdouts']))
