"""Feasibility audit only. Never use capacity allocation to choose live results.

Input: {"ids":["a",...],"scores":[[0..100,...],...],"margins":[0,1,3,5]}.
scores must use a common reviewed metric. No dependency beyond Python stdlib.
"""
import json, math, sys
from collections import deque

def maxflow(rows, capacities):
    n, k = len(rows), len(capacities)
    target, source = n+k+1, n+k
    g = [[] for _ in range(n+k+2)]
    def edge(a,b,c):
        g[a].append([b,c,len(g[b])]); g[b].append([a,0,len(g[a])-1])
    for i, choices in enumerate(rows):
        edge(source,i,1)
        for c in choices: edge(i,n+c,1)
    for c,cap in enumerate(capacities): edge(n+c,target,cap)
    total=0
    while True:
        level=[-1]*len(g);level[source]=0;q=deque([source])
        while q:
            a=q.popleft()
            for b,cap,_ in g[a]:
                if cap and level[b]<0:level[b]=level[a]+1;q.append(b)
        if level[target]<0: break
        pos=[0]*len(g)
        def dfs(a,f):
            if a==target:return f
            while pos[a]<len(g[a]):
                e=g[a][pos[a]];b,cap,rev=e
                if cap and level[b]==level[a]+1:
                    sent=dfs(b,min(f,cap))
                    if sent:e[1]-=sent;g[b][rev][1]+=sent;return sent
                pos[a]+=1
            return 0
        while True:
            sent=dfs(source,n)
            if not sent:break
            total+=sent
    return total

def audit(data):
    ids,scores=data['ids'],data['scores']
    if not ids or len(set(ids))!=len(ids) or not scores:raise ValueError('empty/duplicate IDs or empty scores')
    k,n=len(ids),len(scores)
    for r in scores:
        if len(r)!=k or any(type(x) not in (int,float) or not math.isfinite(x) or not 0<=x<=100 for x in r):raise ValueError('invalid score matrix')
    # Equal target, allowing +/-1. Extra slots are selectable for any character.
    # For non-divisible N, add dummy rows which fill the unused ceil(N/K) slots.
    capacity=math.ceil(n/k)
    padding=capacity*k-n
    results=[]
    margins=data.get('margins',[0,1,3,5])
    if any(type(m) not in (int,float) or not math.isfinite(m) or m<0 or m>100 for m in margins):raise ValueError('invalid margins')
    for m in margins:
        rows=[[c for c,s in enumerate(r) if max(r)-s<=m+1e-9] for r in scores]
        # To keep every real count >= floor(N/K), permit at most one dummy per char.
        # Audit non-divisible groups through a constrained flow with dummy choices.
        if padding:
            # A lower-bound circulation is required to enforce floor/ceil exactly.
            # Refuse to overclaim feasibility; use divisible reference batches.
            results.append({'margin':m,'feasible':None,'reason':'use N divisible by K for exact audit'})
            continue
        assigned=maxflow(rows,[capacity]*k)
        results.append({'margin':m,'assigned':assigned,'total':n,'feasible':assigned==n})
    return {'kind':'offline_feasibility_only','ids':ids,'samples':n,'results':results}

if __name__=='__main__':
    if len(sys.argv)==2 and sys.argv[1]=='--self-test':
        a=audit({'ids':['a','b'],'scores':[[100,100]]*10})
        assert a['results'][0]['feasible']
        b=audit({'ids':['a','b'],'scores':[[100,0]]*10,'margins':[0,5,100]})
        assert not b['results'][0]['feasible'] and not b['results'][1]['feasible'] and b['results'][2]['feasible']
        c=audit({'ids':['a','b'],'scores':[[100,0],[0,100],[100,99],[100,99]],'margins':[0,1]})
        assert not c['results'][0]['feasible'] and c['results'][1]['feasible']
        d=audit({'ids':['a','b'],'scores':[[90,80]]})
        assert d['results'][0]['feasible'] is None
        print('PASS: exact ties, impossible nearby matching, minimal replacement width, non-divisible guard')
    else:
        print(json.dumps(audit(json.load(sys.stdin)),ensure_ascii=False,indent=2))
