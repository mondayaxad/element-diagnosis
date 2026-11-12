"""Alternative fictional association model; explicitly NOT character trait data.

Do not use its output as reviewed production character profiles.
"""
from pathlib import Path
import json
import numpy as np
from scipy.optimize import minimize
from scipy.special import softmax
# Reuse the documented artificial answer generator without executing calibration again.

ROOT=Path(__file__).resolve().parent
# This generator is duplicated explicitly to avoid importing a module with mutation effects.
def sample(seed,n,stress=0,suppression=0):
    from scipy.special import expit
    rng=np.random.default_rng(seed)
    g=rng.normal(size=n)+stress;a,c,r=rng.normal(size=(3,n))
    latent=np.stack([-.65*g+.6*a,.65*g-.6*a,-.6*g+.65*c,.6*g-.65*c,
                     -.55*g+.7*r,.55*g-.7*r,-.2*g+.8*rng.normal(size=n),
                     .25*g+.85*rng.normal(size=n)+suppression,.65*g+.6*rng.normal(size=n),
                     .65*g+.65*rng.normal(size=n),.55*g+.75*rng.normal(size=n),
                     .7*g+.6*rng.normal(size=n)],axis=1)
    sizes=[4,4,4,4,4,4,5,5,4,4,4,4]
    return np.stack([((np.clip(np.floor(1+4*expit(latent[:,j,None]+.5*rng.normal(size=(n,k)))+.5),1,5).mean(axis=1)-1)/4) for j,k in enumerate(sizes)],axis=1)

def main():
    axes=['AUT_S','AUT_F','COM_S','COM_F','REL_S','REL_F','REAPP','SUPPR','CLAR_D','ACC_D','IMP_D','GOAL_D']
    data=[
     ('pierro',[65,65,65,45,45,65,60,80,30,55,25,20],'悔恨を抱えながら大義を持続する物語との連想。主観的な充足・困難の各値は作者の仮説。'),
     ('capitano',[75,40,75,25,65,40,60,60,25,35,20,15],'責任の持続と目的のための協働への連想。利他性の測定を意味しない。'),
     ('dottore',[75,50,80,25,30,55,70,55,25,25,25,20],'目的を維持し、手段を組み替える物語への連想。再評価や感情理解が得意と断定しない。'),
     ('columbina',[40,70,55,40,35,75,45,30,45,45,30,40],'所属期の選択の余地と、期待に置き去りにされる感覚への連想。神秘性を混迷と同一視しない。'),
     ('arlecchino',[75,45,75,30,70,35,60,80,25,30,20,20],'感情を扱いながら家を維持する物語への連想。本人の心理検査結果ではない。'),
     ('pulcinella',[65,35,70,30,50,40,60,65,30,35,25,20],'人間関係へ働きかけながら計画を続ける物語への連想。操作欲・善悪は測っていない。'),
     ('scaramouche',[40,75,55,65,20,85,35,60,45,75,60,40],'所属期に受け止めた関係の傷つきと自己を巡る葛藤への連想。愛着・危険性を判定しない。'),
     ('sandrone',[65,45,70,45,35,55,45,35,35,45,50,25],'研究への集中と、場面によって異なる感情表現への連想。研究好きそのものを測るわけではない。'),
     ('signora',[55,65,65,45,25,75,40,75,35,65,40,30],'喪失後の強い感情と目的遂行の併存への連想。悲嘆や復讐心の得点ではない。'),
     ('pantalone',[65,70,75,45,35,60,55,75,35,65,40,25],'感情の強さと長期的な計画の併存への連想。貧困を有能感阻害へ置き換えるものではない。'),
     ('tartaglia',[75,30,75,25,80,25,55,30,30,35,40,25],'挑戦への関与と家族とのつながりへの連想。戦闘好きと衝動調整困難は別の概念。')]
    roster=json.loads((ROOT/'characters.evidence_pending.json').read_text())
    names={c['id']:c['name'] for c in roster['characters']}
    origin=np.array([r[1] for r in data],float)/100
    assert len(data)==11 and set(r[0] for r in data)==set(names)
    weights=np.array([1/18]*6+[1/6]*2+[1/12]*4)
    train=sample(2026110211,5500)
    ridge=.00005
    def distances(users,profiles):
        delta=profiles[None,:,:]-users[:,None,:]
        return np.sqrt(np.einsum('nkj,j,nkj->nk',delta,weights,delta)),delta
    def objective(flat,temp):
        p=flat.reshape(11,12)
        d,delta=distances(train,p)
        probability=softmax(-d/temp,axis=1)
        error=probability.mean(axis=0)-1/11
        value=float(error@error+ridge*np.sum((p-origin)**2))
        signal=-2*probability*(error-(probability*error).sum(axis=1,keepdims=True))/temp
        dd=delta*weights[None,None,:]/np.maximum(d[:,:,None],1e-12)
        grad=np.einsum('nk,nkj->kj',signal,dd)/len(train)+2*ridge*(p-origin)
        return value,grad.ravel()
    
    # The box bounds are an engineering sensitivity limit, NOT evidence-derived trait ranges.
    bounds=[(max(0,v-.10),min(1,v+.10)) for v in origin.ravel()]
    p=origin.copy();runs=[]
    for t in [.08,.035,.015,.005]:
        res=minimize(lambda x:objective(x,t),p.ravel(),jac=True,bounds=bounds,method='L-BFGS-B',
                     options={'maxiter':250,'ftol':1e-12,'gtol':1e-8})
        runs.append({'temperature':t,'success':bool(res.success),'message':str(res.message),'iterations':int(res.nit)})
        p=res.x.reshape(11,12)
    assert np.max(abs(p-origin))<=.100001
    
    def share(users,profiles):
        d,_=distances(users,profiles)
        tie=np.isclose(d,d.min(axis=1,keepdims=True),atol=1e-11,rtol=0)
        return (tie/tie.sum(axis=1,keepdims=True)).mean(axis=0)
    hold=sample(2026110212,5500)
    before=share(hold,origin);after=share(hold,p)
    db={'status':'alternative_association_hypothesis','production_eligible':False,
     'model_version':'jagan-association-experiment-0.5.0','axes':axes,'weights':dict(zip(axes,weights.tolist())),
     'meaning':'人物本人の心理得点ではなく、作者が提案した利用者の回答パターンと物語との連想モデル。未測定の内面を確認したという意味ではない。',
     'evidence_note':'値の全てに設計上の仮説を含む。出典に直接75点等が記載されているわけではない。',
     'characters':[{'id':i,'name':names[i],'authorial_seed':dict(zip(axes,vals)),
                    'candidate_reference':{a:float(v*100) for a,v in zip(axes,p[k])},
                    'association_rationale':note,'hypothesis_axes':axes,
                    'target_share':1/11} for k,(i,vals,note) in enumerate(data)]}
    (ROOT/'association.reference.proposed.json').write_text(json.dumps(db,ensure_ascii=False,indent=2)+'\n')
    report={'kind':'alternative_association_experiment','real_user_data':False,'production_ready':False,
     'training_n':5500,'holdout_n':5500,'runs':runs,'target_percent':100/11,
     'max_reference_change_points':float(np.max(abs(p-origin))*100),
     'rows':[{'id':i,'name':names[i],'before_percent':float(before[k]*100),'after_percent':float(after[k]*100)} for k,(i,_,_) in enumerate(data)],
     'max_deviation_before_pp':float(max(abs(before-1/11))*100),
     'max_deviation_after_pp':float(max(abs(after-1/11))*100)}
    (ROOT/'association.experiment.results.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    lines=['# 人物連想モデルの別案と実験 v0.5','',
    'これは、人物の内面が測定できたという報告ではない。根拠付きの人物心理スコアを完成させる方式とは別に、作者が提案する「回答パターンと物語の連想」を数値化した実験である。',
    '','## 前案との変更点','- 前案：人物にも利用者と同じ心理得点を設定して距離を測る。未知の項目はnullのまま。',
    '- 別案：人物の物語を連想させる利用者側の参照パターンを作者が設定する。人物がその回答をするという主張ではない。',
    '- 参照値の全軸は仮説であり、物語から直接測った値ではない。前案のnullを確定値で上書きしない。',
    '- 全11名・同じ12座標・同じ重みで比較する。各値の根拠の強さを装わない。',
    '','## 数値実験','相関のある人工回答5,500件で調整し、別の人工回答5,500件で確認。目標は各9.09%。作者の初期参照値からの変化を各軸±10点に制限した。この幅は設定から実証された許容範囲ではなく、感度分析のための技術上の制限。',
    '','| 人物 | 調整前 | 調整後 |','|---|---:|---:|']
    for r in report['rows']:lines.append(f'| {r["name"]} | {r["before_percent"]:.2f}% | {r["after_percent"]:.2f}% |')
    lines += ['',f'9.09%からの最大偏差：{report["max_deviation_before_pp"]:.2f} → {report["max_deviation_after_pp"]:.2f}ポイント。',
    '','## 採用判断に必要なこと','この別案なら11名への結果を計算できるが、元の「根拠付き人物得点による一致率」と同一ではない。研究的な妥当性や原作上の心理分類として説明しない。採用する場合は、作品解釈としての参照パターンをレビューし、表示・方法説明もこの意味へ合わせる。',
    '','均等化だけで採用しない。調整前と後の各参照値、全軸が仮説であることをデータに残す。別案は本番採点に組み込んでおらず、既存のcharacters.evidence_pending.jsonの保留は維持する。',
    '','この実験が均等になっても、実回答で均等になる保証はない。調整後にも極端な偏りが残る場合、それを成功とは扱わない。',
    '','## 一致率を使う場合の意味','「今回の回答が、この人物を連想させる独自の参照パターンにどれだけ近いか」を意味する。人物全体との心理的同一性や、科学的な一致確率ではない。',
    '','各人物の初期値と対応理由はassociation.reference.proposed.jsonを参照。これは確認用の提案であり、採用済みの人物設定ではない。']
    (ROOT/'ASSOCIATION_MODEL_PROPOSAL.md').write_text('\n'.join(lines)+'\n')
    print(json.dumps(report,ensure_ascii=False))

if __name__=='__main__':
    main()
