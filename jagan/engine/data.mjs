// 生成物：scripts/jagan-data.mjs が docs/jagan/spec_v1_0_rc1/data/*.json から作る。手で編集しない。
export const BUNDLE = Object.freeze({
 "items": {
  "diagnosis_key": "jagan",
  "item_set_version": "jagan-items-1.0.0-rc1",
  "scoring_version": "jagan-scores-1.0.0-rc1",
  "interpretation_version": "jagan-interpretation-1.0.0-rc1",
  "status": "implementation_candidate",
  "launch_ready": false,
  "instruction": "最近1か月ほどの自分を振り返り、最も近いものを選んでください。つらいときについての質問は、その期間に経験した場面を思い浮かべてください。",
  "options": [
   {
    "value": 1,
    "label": "まったく当てはまらない"
   },
   {
    "value": 2,
    "label": "あまり当てはまらない"
   },
   {
    "value": 3,
    "label": "どちらともいえない"
   },
   {
    "value": 4,
    "label": "やや当てはまる"
   },
   {
    "value": 5,
    "label": "とても当てはまる"
   }
  ],
  "missing_option": {
   "value": null,
   "label": "判断できない・回答しない"
  },
  "domains": [
   {
    "id": "AUT_S",
    "label": "自律性の充足",
    "block": "need",
    "item_count": 4,
    "minimum_answered": 3
   },
   {
    "id": "AUT_F",
    "label": "自律性の阻害",
    "block": "need",
    "item_count": 4,
    "minimum_answered": 3
   },
   {
    "id": "COM_S",
    "label": "有能感の充足",
    "block": "need",
    "item_count": 4,
    "minimum_answered": 3
   },
   {
    "id": "COM_F",
    "label": "有能感の阻害",
    "block": "need",
    "item_count": 4,
    "minimum_answered": 3
   },
   {
    "id": "REL_S",
    "label": "関係性の充足",
    "block": "need",
    "item_count": 4,
    "minimum_answered": 3
   },
   {
    "id": "REL_F",
    "label": "関係性の阻害",
    "block": "need",
    "item_count": 4,
    "minimum_answered": 3
   },
   {
    "id": "REAPP",
    "label": "捉え直しの使用",
    "block": "strategy",
    "item_count": 5,
    "minimum_answered": 4
   },
   {
    "id": "SUPPR",
    "label": "表出抑制の使用",
    "block": "strategy",
    "item_count": 5,
    "minimum_answered": 4
   },
   {
    "id": "CLAR_D",
    "label": "感情理解の困難",
    "block": "difficulty",
    "item_count": 4,
    "minimum_answered": 3
   },
   {
    "id": "ACC_D",
    "label": "感情受容の困難",
    "block": "difficulty",
    "item_count": 4,
    "minimum_answered": 3
   },
   {
    "id": "IMP_D",
    "label": "衝動調整の困難",
    "block": "difficulty",
    "item_count": 4,
    "minimum_answered": 3
   },
   {
    "id": "GOAL_D",
    "label": "行動維持の困難",
    "block": "difficulty",
    "item_count": 4,
    "minimum_answered": 3
   }
  ],
  "items": [
   {
    "id": "JG001",
    "domain": "AUT_S",
    "block": "need",
    "text": "日々の予定には、自分の希望を反映できている。",
    "direction": 1
   },
   {
    "id": "JG002",
    "domain": "AUT_S",
    "block": "need",
    "text": "大事な選択をするとき、自分が納得できる理由で決めている。",
    "direction": 1
   },
   {
    "id": "JG003",
    "domain": "AUT_S",
    "block": "need",
    "text": "周囲と意見が違っても、自分の考えを選択に活かせる。",
    "direction": 1
   },
   {
    "id": "JG004",
    "domain": "AUT_S",
    "block": "need",
    "text": "引き受けることと断ることを、自分なりに決められる。",
    "direction": 1
   },
   {
    "id": "JG005",
    "domain": "AUT_F",
    "block": "need",
    "text": "断りたい用事でも、引き受ける以外に道がないように感じる。",
    "direction": 1
   },
   {
    "id": "JG006",
    "domain": "AUT_F",
    "block": "need",
    "text": "一日の過ごし方が、周りの都合だけで決まっていくように感じる。",
    "direction": 1
   },
   {
    "id": "JG007",
    "domain": "AUT_F",
    "block": "need",
    "text": "周囲の期待から外れないために、本意ではない選択をしている。",
    "direction": 1
   },
   {
    "id": "JG008",
    "domain": "AUT_F",
    "block": "need",
    "text": "自分に関わることなのに、意見を挟む余地がないと感じる。",
    "direction": 1
   },
   {
    "id": "JG009",
    "domain": "COM_S",
    "block": "need",
    "text": "自分に任されたことを、最後まで形にできる手応えがある。",
    "direction": 1
   },
   {
    "id": "JG010",
    "domain": "COM_S",
    "block": "need",
    "text": "難しい課題にも、取りかかるための足がかりを見つけられる。",
    "direction": 1
   },
   {
    "id": "JG011",
    "domain": "COM_S",
    "block": "need",
    "text": "経験を重ねた分だけ、できることが増えたと感じる。",
    "direction": 1
   },
   {
    "id": "JG012",
    "domain": "COM_S",
    "block": "need",
    "text": "自分の工夫が、取り組んでいることの成果につながっている。",
    "direction": 1
   },
   {
    "id": "JG013",
    "domain": "COM_F",
    "block": "need",
    "text": "求められる水準に、自分の力が届いていないと感じる。",
    "direction": 1
   },
   {
    "id": "JG014",
    "domain": "COM_F",
    "block": "need",
    "text": "取り組んでもうまくいかず、自分には難しすぎると感じる。",
    "direction": 1
   },
   {
    "id": "JG015",
    "domain": "COM_F",
    "block": "need",
    "text": "失敗が続いて、自分の力を頼りにできなくなっている。",
    "direction": 1
   },
   {
    "id": "JG016",
    "domain": "COM_F",
    "block": "need",
    "text": "自分なりに工夫しても、役に立っていないように感じる。",
    "direction": 1
   },
   {
    "id": "JG017",
    "domain": "REL_S",
    "block": "need",
    "text": "近況を伝えたとき、気にかけて聞いてくれる相手がいる。",
    "direction": 1
   },
   {
    "id": "JG018",
    "domain": "REL_S",
    "block": "need",
    "text": "大切な相手と過ごす時間に、気持ちが通じ合う感覚がある。",
    "direction": 1
   },
   {
    "id": "JG019",
    "domain": "REL_S",
    "block": "need",
    "text": "人と接する中で、自分もその輪の一員だと感じる。",
    "direction": 1
   },
   {
    "id": "JG020",
    "domain": "REL_S",
    "block": "need",
    "text": "弱いところを見せても、関係が続くと思える相手がいる。",
    "direction": 1
   },
   {
    "id": "JG021",
    "domain": "REL_F",
    "block": "need",
    "text": "関わりたい相手から、遠ざけられているように感じる。",
    "direction": 1
   },
   {
    "id": "JG022",
    "domain": "REL_F",
    "block": "need",
    "text": "一緒にいる人たちの中で、自分だけが輪の外にいるように感じる。",
    "direction": 1
   },
   {
    "id": "JG023",
    "domain": "REL_F",
    "block": "need",
    "text": "自分の気持ちを伝えても、大切に扱われていないと感じる。",
    "direction": 1
   },
   {
    "id": "JG024",
    "domain": "REL_F",
    "block": "need",
    "text": "身近な人から、いてもいなくても同じだと思われているように感じる。",
    "direction": 1
   },
   {
    "id": "JG025",
    "domain": "REAPP",
    "block": "strategy",
    "text": "嫌なことが起きたとき、別の見方ができないか考えている。",
    "direction": 1
   },
   {
    "id": "JG026",
    "domain": "REAPP",
    "block": "strategy",
    "text": "気が重い予定について、取り組む意味を考え直している。",
    "direction": 1
   },
   {
    "id": "JG027",
    "domain": "REAPP",
    "block": "strategy",
    "text": "相手の言葉に傷ついたとき、自分の受け取り方以外の解釈を探している。",
    "direction": 1
   },
   {
    "id": "JG028",
    "domain": "REAPP",
    "block": "strategy",
    "text": "失敗を振り返るとき、今後に活かせる面から捉えようとしている。",
    "direction": 1
   },
   {
    "id": "JG029",
    "domain": "REAPP",
    "block": "strategy",
    "text": "変えられない出来事について、その意味の捉え方を変えて気持ちを整えようとしている。",
    "direction": 1
   },
   {
    "id": "JG030",
    "domain": "SUPPR",
    "block": "strategy",
    "text": "気持ちが顔に出そうなとき、表情を変えないようにしている。",
    "direction": 1
   },
   {
    "id": "JG031",
    "domain": "SUPPR",
    "block": "strategy",
    "text": "腹が立っていても、声の調子には出さないようにしている。",
    "direction": 1
   },
   {
    "id": "JG032",
    "domain": "SUPPR",
    "block": "strategy",
    "text": "うれしい気持ちも、周りには分からない程度に抑えている。",
    "direction": 1
   },
   {
    "id": "JG033",
    "domain": "SUPPR",
    "block": "strategy",
    "text": "人と話すとき、本当の気持ちが伝わらないように振る舞っている。",
    "direction": 1
   },
   {
    "id": "JG034",
    "domain": "SUPPR",
    "block": "strategy",
    "text": "人前で涙が出そうなとき、気づかれないようにこらえている。",
    "direction": 1
   },
   {
    "id": "JG035",
    "domain": "CLAR_D",
    "block": "difficulty",
    "text": "つらいとき、怒っているのか悲しいのか、自分でも区別しにくい。",
    "direction": 1
   },
   {
    "id": "JG036",
    "domain": "CLAR_D",
    "block": "difficulty",
    "text": "気持ちが乱れても、それがどんな感情なのか言葉にしにくい。",
    "direction": 1
   },
   {
    "id": "JG037",
    "domain": "CLAR_D",
    "block": "difficulty",
    "text": "つらい出来事の後、自分の中にどんな感情が残っているのかつかみにくい。",
    "direction": 1
   },
   {
    "id": "JG038",
    "domain": "CLAR_D",
    "block": "difficulty",
    "text": "いくつもの感情が重なると、一つひとつを整理できなくなる。",
    "direction": 1
   },
   {
    "id": "JG039",
    "domain": "ACC_D",
    "block": "difficulty",
    "text": "つらい気持ちが生じると、そんな気持ちを持つ自分を責めてしまう。",
    "direction": 1
   },
   {
    "id": "JG040",
    "domain": "ACC_D",
    "block": "difficulty",
    "text": "悲しみや不安を感じている自分を、そのまま認めることが難しい。",
    "direction": 1
   },
   {
    "id": "JG041",
    "domain": "ACC_D",
    "block": "difficulty",
    "text": "嫌な感情があると、その感情を持つこと自体を恥ずかしく感じる。",
    "direction": 1
   },
   {
    "id": "JG042",
    "domain": "ACC_D",
    "block": "difficulty",
    "text": "気持ちが落ち込むと、落ち込んでいることを許せないと感じる。",
    "direction": 1
   },
   {
    "id": "JG043",
    "domain": "IMP_D",
    "block": "difficulty",
    "text": "気持ちが高ぶると、送らない方がよいと思うメッセージを送ってしまう。",
    "direction": 1
   },
   {
    "id": "JG044",
    "domain": "IMP_D",
    "block": "difficulty",
    "text": "つらさが強いとき、控えようと決めた行動に手が伸びてしまう。",
    "direction": 1
   },
   {
    "id": "JG045",
    "domain": "IMP_D",
    "block": "difficulty",
    "text": "感情が強くなると、行動する前に一度止まることが難しい。",
    "direction": 1
   },
   {
    "id": "JG046",
    "domain": "IMP_D",
    "block": "difficulty",
    "text": "動揺すると、後で困ると分かっている行動でも、その場でやめられなくなる。",
    "direction": 1
   },
   {
    "id": "JG047",
    "domain": "GOAL_D",
    "block": "difficulty",
    "text": "気持ちが沈むと、必要な用事に取りかかれなくなる。",
    "direction": 1
   },
   {
    "id": "JG048",
    "domain": "GOAL_D",
    "block": "difficulty",
    "text": "不安が強いと、進めていた作業の手が止まってしまう。",
    "direction": 1
   },
   {
    "id": "JG049",
    "domain": "GOAL_D",
    "block": "difficulty",
    "text": "嫌なことが頭から離れないと、やるべきことを順番に進めにくくなる。",
    "direction": 1
   },
   {
    "id": "JG050",
    "domain": "GOAL_D",
    "block": "difficulty",
    "text": "気持ちが乱れた後、途中だった作業へ戻ることが難しい。",
    "direction": 1
   }
  ],
  "display_order": [
   "JG001",
   "JG005",
   "JG009",
   "JG013",
   "JG017",
   "JG021",
   "JG002",
   "JG006",
   "JG010",
   "JG014",
   "JG018",
   "JG022",
   "JG003",
   "JG007",
   "JG011",
   "JG015",
   "JG019",
   "JG023",
   "JG004",
   "JG008",
   "JG012",
   "JG016",
   "JG020",
   "JG024",
   "JG025",
   "JG030",
   "JG026",
   "JG031",
   "JG027",
   "JG032",
   "JG028",
   "JG033",
   "JG029",
   "JG034",
   "JG035",
   "JG039",
   "JG043",
   "JG047",
   "JG036",
   "JG040",
   "JG044",
   "JG048",
   "JG037",
   "JG041",
   "JG045",
   "JG049",
   "JG038",
   "JG042",
   "JG046",
   "JG050"
  ]
 },
 "interpretation": {
  "status": "implementation_candidate",
  "coefficient_origin": "designer_hypothesis_calibrated_on_synthetic_answers_not_validated_scale",
  "version": "jagan-interpretation-1.0.0-rc1",
  "elements": [
   {
    "id": "PY",
    "label": "炎",
    "theme": "内側で高まる感情",
    "weights": {
     "ACC_D": 0.55,
     "IMP_D": 0.24165823190791402,
     "COM_F": 0.05000000000000002,
     "SUPPR": -0.1583417680920859
    }
   },
   {
    "id": "HY",
    "label": "水",
    "theme": "つながりの中の揺れ",
    "weights": {
     "REL_F": 0.40470606398507475,
     "REL_S": -0.16570771418891775,
     "SUPPR": 0.3086132732705834,
     "ACC_D": 0.12097294855542415
    }
   },
   {
    "id": "CR",
    "label": "氷",
    "theme": "内側に留める感情",
    "weights": {
     "SUPPR": 0.6,
     "ACC_D": 0.1,
     "REL_F": 0.05,
     "IMP_D": -0.25
    }
   },
   {
    "id": "EL",
    "label": "雷",
    "theme": "感情と行動の緊張",
    "weights": {
     "IMP_D": 0.6,
     "GOAL_D": 0.1,
     "AUT_F": 0.05000000000000002,
     "SUPPR": -0.25
    }
   },
   {
    "id": "AN",
    "label": "風",
    "theme": "自分の意思と制約との葛藤",
    "weights": {
     "AUT_F": 0.5741737314110146,
     "AUT_S": -0.05000000000000002,
     "REAPP": 0.07582626858898549,
     "SUPPR": -0.3
    }
   },
   {
    "id": "GE",
    "label": "岩",
    "theme": "揺れの中で行動を保つ",
    "weights": {
     "GOAL_D": -0.25,
     "SUPPR": 0.17081251162691874,
     "COM_S": 0.35,
     "AUT_S": 0.2291874883730813
    }
   },
   {
    "id": "DE",
    "label": "草",
    "theme": "感情理解と意味の組み替え",
    "weights": {
     "REAPP": 0.3513105937984236,
     "CLAR_D": -0.2268325972464074,
     "ACC_D": -0.121856808955169,
     "COM_S": 0.3
    }
   }
  ],
  "types": [
   {
    "id": "REFRAME",
    "label": "再解釈型",
    "domain": "REAPP",
    "summary": "出来事の見方を変えて感情を扱おうとする。"
   },
   {
    "id": "CONTAIN",
    "label": "秘匿型",
    "domain": "SUPPR",
    "summary": "感情を外に出さず、内側で扱う。"
   },
   {
    "id": "SURGE",
    "label": "衝動型",
    "domain": "IMP_D",
    "summary": "強い感情の下では、意図したように行動を止めにくい。"
   },
   {
    "id": "STALL",
    "label": "停滞型",
    "domain": "GOAL_D",
    "summary": "強い感情の下では、必要な行動を続けにくい。"
   },
   {
    "id": "CONFUSE",
    "label": "困惑型",
    "domain": "CLAR_D",
    "summary": "自分の感情をつかみ、整理することに難しさがある。"
   },
   {
    "id": "RESIST",
    "label": "自責型",
    "domain": "ACC_D",
    "summary": "生じた感情を、そのまま認めにくい。"
   }
  ],
  "type_minimum_score": 60,
  "close_gap_points": 3,
  "tie_epsilon": 1e-9,
  "element_rule": "sum(abs(w)*score if w>=0 else abs(w)*(100-score)); missing required domains => defer all element rankings",
  "type_rule": "rank six separate domains; label only if top score>=60; gap<=3 => co_dominant; these thresholds are design hypotheses",
  "cross_domain_warning": "同じ数値が同じ心理的強さを意味するとは限らない。元素と型は創作的解釈。",
  "calibration_version": "elements-synthetic-0.5.0"
 },
 "characters": {
  "status": "implementation_candidate",
  "model_type": "authored_story_association",
  "version": "jagan-story-reference-1.0.0-rc1",
  "calibration_version": "story-reference-synthetic-0.5.0",
  "meaning": "人物本人の心理得点ではなく、作者が提案した利用者の回答パターンと物語との連想モデル。未測定の内面を確認したという意味ではない。",
  "axes": [
   "AUT_S",
   "AUT_F",
   "COM_S",
   "COM_F",
   "REL_S",
   "REL_F",
   "REAPP",
   "SUPPR",
   "CLAR_D",
   "ACC_D",
   "IMP_D",
   "GOAL_D"
  ],
  "weights": {
   "AUT_S": 0.05555555555555555,
   "AUT_F": 0.05555555555555555,
   "COM_S": 0.05555555555555555,
   "COM_F": 0.05555555555555555,
   "REL_S": 0.05555555555555555,
   "REL_F": 0.05555555555555555,
   "REAPP": 0.16666666666666666,
   "SUPPR": 0.16666666666666666,
   "CLAR_D": 0.08333333333333333,
   "ACC_D": 0.08333333333333333,
   "IMP_D": 0.08333333333333333,
   "GOAL_D": 0.08333333333333333
  },
  "notice": "公式描写を参考に設計した独自の回答参照パターンとの近さです。人物本人の心理得点や科学的な一致確率ではありません。",
  "characters": [
   {
    "id": "pierro",
    "name": "ピエロ",
    "reference": {
     "AUT_S": 61.54340221963348,
     "AUT_F": 65.76370281721685,
     "COM_S": 61.860766651855236,
     "COM_F": 47.27871235747045,
     "REL_S": 43.08900299450603,
     "REL_F": 65.98449138173298,
     "REAPP": 55.78548092675602,
     "SUPPR": 75.34760850800065,
     "CLAR_D": 34.87879677023973,
     "ACC_D": 57.581681340165915,
     "IMP_D": 30.246231347708818,
     "GOAL_D": 26.439510963602103
    },
    "authorial_seed": {
     "AUT_S": 65,
     "AUT_F": 65,
     "COM_S": 65,
     "COM_F": 45,
     "REL_S": 45,
     "REL_F": 65,
     "REAPP": 60,
     "SUPPR": 80,
     "CLAR_D": 30,
     "ACC_D": 55,
     "IMP_D": 25,
     "GOAL_D": 20
    },
    "association_rationale": "悔恨を抱えながら大義を持続する物語との連想。主観的な充足・困難の各値は作者の仮説。",
    "hypothesis_axes": [
     "AUT_S",
     "AUT_F",
     "COM_S",
     "COM_F",
     "REL_S",
     "REL_F",
     "REAPP",
     "SUPPR",
     "CLAR_D",
     "ACC_D",
     "IMP_D",
     "GOAL_D"
    ],
    "target_share": 0.09090909090909091
   },
   {
    "id": "capitano",
    "name": "カピターノ",
    "reference": {
     "AUT_S": 71.98382318260798,
     "AUT_F": 39.4467170461109,
     "COM_S": 71.42740649272028,
     "COM_F": 28.56916449045122,
     "REL_S": 64.55422106520123,
     "REL_F": 39.39641492175234,
     "REAPP": 56.629281445857124,
     "SUPPR": 50.11398387529854,
     "CLAR_D": 29.346990905232644,
     "ACC_D": 36.61342082055688,
     "IMP_D": 25.846069154587774,
     "GOAL_D": 22.008915364871754
    },
    "authorial_seed": {
     "AUT_S": 75,
     "AUT_F": 40,
     "COM_S": 75,
     "COM_F": 25,
     "REL_S": 65,
     "REL_F": 40,
     "REAPP": 60,
     "SUPPR": 60,
     "CLAR_D": 25,
     "ACC_D": 35,
     "IMP_D": 20,
     "GOAL_D": 15
    },
    "association_rationale": "責任の持続と目的のための協働への連想。利他性の測定を意味しない。",
    "hypothesis_axes": [
     "AUT_S",
     "AUT_F",
     "COM_S",
     "COM_F",
     "REL_S",
     "REL_F",
     "REAPP",
     "SUPPR",
     "CLAR_D",
     "ACC_D",
     "IMP_D",
     "GOAL_D"
    ],
    "target_share": 0.09090909090909091
   },
   {
    "id": "dottore",
    "name": "ドットーレ",
    "reference": {
     "AUT_S": 70.24779150057789,
     "AUT_F": 49.80205232851686,
     "COM_S": 74.67385929247986,
     "COM_F": 29.340174360009723,
     "REL_S": 32.35020533739317,
     "REL_F": 55.57853569303818,
     "REAPP": 65.72534485056251,
     "SUPPR": 46.27401875117146,
     "CLAR_D": 31.357740605882228,
     "ACC_D": 30.545343448897988,
     "IMP_D": 31.931684913032793,
     "GOAL_D": 28.10070694772743
    },
    "authorial_seed": {
     "AUT_S": 75,
     "AUT_F": 50,
     "COM_S": 80,
     "COM_F": 25,
     "REL_S": 30,
     "REL_F": 55,
     "REAPP": 70,
     "SUPPR": 55,
     "CLAR_D": 25,
     "ACC_D": 25,
     "IMP_D": 25,
     "GOAL_D": 20
    },
    "association_rationale": "目的を維持し、手段を組み替える物語への連想。再評価や感情理解が得意と断定しない。",
    "hypothesis_axes": [
     "AUT_S",
     "AUT_F",
     "COM_S",
     "COM_F",
     "REL_S",
     "REL_F",
     "REAPP",
     "SUPPR",
     "CLAR_D",
     "ACC_D",
     "IMP_D",
     "GOAL_D"
    ],
    "target_share": 0.09090909090909091
   },
   {
    "id": "columbina",
    "name": "コロンビーナ",
    "reference": {
     "AUT_S": 38.61068883830932,
     "AUT_F": 74.710131429695,
     "COM_S": 57.341158805520976,
     "COM_F": 36.16318445362923,
     "REL_S": 31.19759565085457,
     "REL_F": 81.69106172447788,
     "REAPP": 36.78514791288034,
     "SUPPR": 20.081986787623855,
     "CLAR_D": 40.5283745859874,
     "ACC_D": 42.67077142044111,
     "IMP_D": 21.71578825605777,
     "GOAL_D": 32.36994178976776
    },
    "authorial_seed": {
     "AUT_S": 40,
     "AUT_F": 70,
     "COM_S": 55,
     "COM_F": 40,
     "REL_S": 35,
     "REL_F": 75,
     "REAPP": 45,
     "SUPPR": 30,
     "CLAR_D": 45,
     "ACC_D": 45,
     "IMP_D": 30,
     "GOAL_D": 40
    },
    "association_rationale": "所属期の選択の余地と、期待に置き去りにされる感覚への連想。神秘性を混迷と同一視しない。",
    "hypothesis_axes": [
     "AUT_S",
     "AUT_F",
     "COM_S",
     "COM_F",
     "REL_S",
     "REL_F",
     "REAPP",
     "SUPPR",
     "CLAR_D",
     "ACC_D",
     "IMP_D",
     "GOAL_D"
    ],
    "target_share": 0.09090909090909091
   },
   {
    "id": "arlecchino",
    "name": "アルレッキーノ",
    "reference": {
     "AUT_S": 69.72195922636176,
     "AUT_F": 45.067969459336524,
     "COM_S": 69.25879800791337,
     "COM_F": 34.50523963927049,
     "REL_S": 67.83054250308123,
     "REL_F": 35.925671326628006,
     "REAPP": 54.34050870774389,
     "SUPPR": 71.46576487458283,
     "CLAR_D": 32.17828093382874,
     "ACC_D": 34.6865845652383,
     "IMP_D": 28.916917879327258,
     "GOAL_D": 29.384978554010278
    },
    "authorial_seed": {
     "AUT_S": 75,
     "AUT_F": 45,
     "COM_S": 75,
     "COM_F": 30,
     "REL_S": 70,
     "REL_F": 35,
     "REAPP": 60,
     "SUPPR": 80,
     "CLAR_D": 25,
     "ACC_D": 30,
     "IMP_D": 20,
     "GOAL_D": 20
    },
    "association_rationale": "感情を扱いながら家を維持する物語への連想。本人の心理検査結果ではない。",
    "hypothesis_axes": [
     "AUT_S",
     "AUT_F",
     "COM_S",
     "COM_F",
     "REL_S",
     "REL_F",
     "REAPP",
     "SUPPR",
     "CLAR_D",
     "ACC_D",
     "IMP_D",
     "GOAL_D"
    ],
    "target_share": 0.09090909090909091
   },
   {
    "id": "pulcinella",
    "name": "プルチネッラ",
    "reference": {
     "AUT_S": 63.29084645506392,
     "AUT_F": 36.5593614965197,
     "COM_S": 67.80999999145529,
     "COM_F": 32.20566867234327,
     "REL_S": 49.0860337186754,
     "REL_F": 41.65083717949546,
     "REAPP": 56.519782926178785,
     "SUPPR": 59.86957087622511,
     "CLAR_D": 33.284186764462454,
     "ACC_D": 37.792582868754806,
     "IMP_D": 28.69885910541467,
     "GOAL_D": 24.007438433405532
    },
    "authorial_seed": {
     "AUT_S": 65,
     "AUT_F": 35,
     "COM_S": 70,
     "COM_F": 30,
     "REL_S": 50,
     "REL_F": 40,
     "REAPP": 60,
     "SUPPR": 65,
     "CLAR_D": 30,
     "ACC_D": 35,
     "IMP_D": 25,
     "GOAL_D": 20
    },
    "association_rationale": "人間関係へ働きかけながら計画を続ける物語への連想。操作欲・善悪は測っていない。",
    "hypothesis_axes": [
     "AUT_S",
     "AUT_F",
     "COM_S",
     "COM_F",
     "REL_S",
     "REL_F",
     "REAPP",
     "SUPPR",
     "CLAR_D",
     "ACC_D",
     "IMP_D",
     "GOAL_D"
    ],
    "target_share": 0.09090909090909091
   },
   {
    "id": "scaramouche",
    "name": "スカラマシュ",
    "reference": {
     "AUT_S": 42.30323208220267,
     "AUT_F": 80.05531731252971,
     "COM_S": 64.2897046188311,
     "COM_F": 65.41510393331332,
     "REL_S": 12.569087162449852,
     "REL_F": 94.78026977361995,
     "REAPP": 25.000904393381013,
     "SUPPR": 67.50825218505507,
     "CLAR_D": 35.00152518648961,
     "ACC_D": 83.00519178614395,
     "IMP_D": 56.71755707652915,
     "GOAL_D": 30.000151316900016
    },
    "authorial_seed": {
     "AUT_S": 40,
     "AUT_F": 75,
     "COM_S": 55,
     "COM_F": 65,
     "REL_S": 20,
     "REL_F": 85,
     "REAPP": 35,
     "SUPPR": 60,
     "CLAR_D": 45,
     "ACC_D": 75,
     "IMP_D": 60,
     "GOAL_D": 40
    },
    "association_rationale": "所属期に受け止めた関係の傷つきと自己を巡る葛藤への連想。愛着・危険性を判定しない。",
    "hypothesis_axes": [
     "AUT_S",
     "AUT_F",
     "COM_S",
     "COM_F",
     "REL_S",
     "REL_F",
     "REAPP",
     "SUPPR",
     "CLAR_D",
     "ACC_D",
     "IMP_D",
     "GOAL_D"
    ],
    "target_share": 0.09090909090909091
   },
   {
    "id": "sandrone",
    "name": "サンドローネ",
    "reference": {
     "AUT_S": 66.80202532964867,
     "AUT_F": 46.46106674498636,
     "COM_S": 74.68179803612131,
     "COM_F": 44.950597524897624,
     "REL_S": 29.235462808058305,
     "REL_F": 57.53185660544955,
     "REAPP": 37.62225234503637,
     "SUPPR": 25.82930574148542,
     "CLAR_D": 30.323543996551344,
     "ACC_D": 45.533745449607125,
     "IMP_D": 50.265209826459845,
     "GOAL_D": 15.801748947935431
    },
    "authorial_seed": {
     "AUT_S": 65,
     "AUT_F": 45,
     "COM_S": 70,
     "COM_F": 45,
     "REL_S": 35,
     "REL_F": 55,
     "REAPP": 45,
     "SUPPR": 35,
     "CLAR_D": 35,
     "ACC_D": 45,
     "IMP_D": 50,
     "GOAL_D": 25
    },
    "association_rationale": "研究への集中と、場面によって異なる感情表現への連想。研究好きそのものを測るわけではない。",
    "hypothesis_axes": [
     "AUT_S",
     "AUT_F",
     "COM_S",
     "COM_F",
     "REL_S",
     "REL_F",
     "REAPP",
     "SUPPR",
     "CLAR_D",
     "ACC_D",
     "IMP_D",
     "GOAL_D"
    ],
    "target_share": 0.09090909090909091
   },
   {
    "id": "signora",
    "name": "シニョーラ",
    "reference": {
     "AUT_S": 54.07232227108172,
     "AUT_F": 67.34795156739202,
     "COM_S": 64.69735926785458,
     "COM_F": 45.966999112050864,
     "REL_S": 22.12431863463202,
     "REL_F": 78.00889108909728,
     "REAPP": 35.14439086609278,
     "SUPPR": 75.26196110906008,
     "CLAR_D": 35.18177069669967,
     "ACC_D": 68.91634963914748,
     "IMP_D": 41.32575091883517,
     "GOAL_D": 29.393161514334267
    },
    "authorial_seed": {
     "AUT_S": 55,
     "AUT_F": 65,
     "COM_S": 65,
     "COM_F": 45,
     "REL_S": 25,
     "REL_F": 75,
     "REAPP": 40,
     "SUPPR": 75,
     "CLAR_D": 35,
     "ACC_D": 65,
     "IMP_D": 40,
     "GOAL_D": 30
    },
    "association_rationale": "喪失後の強い感情と目的遂行の併存への連想。悲嘆や復讐心の得点ではない。",
    "hypothesis_axes": [
     "AUT_S",
     "AUT_F",
     "COM_S",
     "COM_F",
     "REL_S",
     "REL_F",
     "REAPP",
     "SUPPR",
     "CLAR_D",
     "ACC_D",
     "IMP_D",
     "GOAL_D"
    ],
    "target_share": 0.09090909090909091
   },
   {
    "id": "pantalone",
    "name": "パンタローネ",
    "reference": {
     "AUT_S": 63.1994313792394,
     "AUT_F": 71.81078725608756,
     "COM_S": 73.41107092255989,
     "COM_F": 46.552254952245406,
     "REL_S": 32.85405757934745,
     "REL_F": 62.16772977568913,
     "REAPP": 50.08913122185926,
     "SUPPR": 73.232375190545,
     "CLAR_D": 37.15467281746353,
     "ACC_D": 67.69283111694408,
     "IMP_D": 42.39362839709362,
     "GOAL_D": 27.400836202797514
    },
    "authorial_seed": {
     "AUT_S": 65,
     "AUT_F": 70,
     "COM_S": 75,
     "COM_F": 45,
     "REL_S": 35,
     "REL_F": 60,
     "REAPP": 55,
     "SUPPR": 75,
     "CLAR_D": 35,
     "ACC_D": 65,
     "IMP_D": 40,
     "GOAL_D": 25
    },
    "association_rationale": "感情の強さと長期的な計画の併存への連想。貧困を有能感阻害へ置き換えるものではない。",
    "hypothesis_axes": [
     "AUT_S",
     "AUT_F",
     "COM_S",
     "COM_F",
     "REL_S",
     "REL_F",
     "REAPP",
     "SUPPR",
     "CLAR_D",
     "ACC_D",
     "IMP_D",
     "GOAL_D"
    ],
    "target_share": 0.09090909090909091
   },
   {
    "id": "tartaglia",
    "name": "タルタリヤ",
    "reference": {
     "AUT_S": 76.39275364193126,
     "AUT_F": 29.77773928944889,
     "COM_S": 76.8615239682861,
     "COM_F": 23.248579611238423,
     "REL_S": 82.0286135904627,
     "REL_F": 24.125709372801516,
     "REAPP": 50.33822602490445,
     "SUPPR": 22.05760127272905,
     "CLAR_D": 28.862141944813924,
     "ACC_D": 35.813663934290766,
     "IMP_D": 41.47840523779545,
     "GOAL_D": 22.070601026504548
    },
    "authorial_seed": {
     "AUT_S": 75,
     "AUT_F": 30,
     "COM_S": 75,
     "COM_F": 25,
     "REL_S": 80,
     "REL_F": 25,
     "REAPP": 55,
     "SUPPR": 30,
     "CLAR_D": 30,
     "ACC_D": 35,
     "IMP_D": 40,
     "GOAL_D": 25
    },
    "association_rationale": "挑戦への関与と家族とのつながりへの連想。戦闘好きと衝動調整困難は別の概念。",
    "hypothesis_axes": [
     "AUT_S",
     "AUT_F",
     "COM_S",
     "COM_F",
     "REL_S",
     "REL_F",
     "REAPP",
     "SUPPR",
     "CLAR_D",
     "ACC_D",
     "IMP_D",
     "GOAL_D"
    ],
    "target_share": 0.09090909090909091
   }
  ]
 },
 "product": {
  "status": "implementation_candidate",
  "product_key": "jagan_report_v1",
  "currency": "JPY",
  "price": 1000,
  "price_status": "confirmed",
  "sales_open": false,
  "scope": "one_result_report",
  "free_result_enabled": true,
  "external_data_analysis": false,
  "fulfillment": "authenticated_web_report_proposal",
  "existing_eti_entitlement_grants_access": false,
  "billing": "one_time",
  "product_count": 1
 }
});
export const COPY = Object.freeze({
 "character": {
  "status": "implementation_candidate",
  "version": "jagan-character-copy-1.0.0-rc1",
  "global_notice": "共通点は作品解釈による回答参照パターンとの比較です。人物全体や善悪の一致ではありません。",
  "no_aligned_axes": "総合では最上位ですが、個別項目に明確な近さを示せる部分は限られています。",
  "no_different_axes": "この比較条件では、大きな差として示す項目はありません。人物全体が同じという意味ではありません。",
  "close_candidates": "複数の参照パターンが近い結果です。一人だけの人物像で説明し切れるとは限りません。",
  "characters": {
   "pierro": {
    "name": "ピエロ",
    "title": "道化",
    "story_context": "ファデュイの統括官として、失われたものへの思いを大義につなぎ、長期的な活動を続ける姿が描かれます。",
    "association_theme": "長く抱えている思いと、日々続けている行動との関係を振り返るための連想です。",
    "limit": "怒りがあるから感情を受容できない、という判定ではありません。",
    "reflection": "今も続けている行動には、どんな意味を感じていますか。",
    "source_urls": [
     "https://genshin-impact.fandom.com/ja/wiki/嗤笑の面"
    ],
    "source_access": "wiki_transcription_or_summary; see evidence notes",
    "numeric_model_origin": "authored_hypothesis_not_official_character_score"
   },
   "capitano": {
    "name": "カピターノ",
    "title": "隊長",
    "story_context": "ナタでの物語では、救うべきもののために行動を続け、対立した相手との協働も選びます。",
    "association_theme": "気持ちが揺れる中でも必要なことを続けるあり方を振り返る連想です。",
    "limit": "献身や戦闘力を心理得点として測ったものではありません。",
    "reflection": "続けることが助けになった場面と、負担になった場面はありますか。",
    "source_urls": [
     "https://genshin-impact.fandom.com/ja/wiki/「隊長」"
    ],
    "source_access": "wiki_transcription_or_summary; see evidence notes",
    "numeric_model_origin": "authored_hypothesis_not_official_character_score"
   },
   "dottore": {
    "name": "ドットーレ",
    "title": "博士",
    "story_context": "スメールでの物語では、研究目的に向けた活動と、交渉に応じて手段を組み替える姿が描かれます。",
    "association_theme": "目的への関わり方や、出来事の扱い方について考えるための連想です。",
    "limit": "残虐性、知能、共感性、道徳性が似ているという意味ではありません。",
    "reflection": "物事を説明できることと、気持ちを理解できることに違いはありますか。",
    "source_urls": [
     "https://genshin-impact.fandom.com/ja/wiki/「博士」"
    ],
    "source_access": "wiki_transcription_or_summary; see evidence notes",
    "numeric_model_origin": "authored_hypothesis_not_official_character_score"
   },
   "columbina": {
    "name": "コロンビーナ",
    "title": "少女",
    "story_context": "所属期を振り返るプロフィールには、選択の余地への新鮮さと、期待される役割に自分が置き去りになる感覚が語られます。",
    "association_theme": "自分の意思や、人とのつながりをどう感じているかを振り返る連想です。",
    "limit": "神秘的に見えることから感情理解の困難を判定するものではありません。",
    "reflection": "期待される役割と、自分のままでいられる感覚に違いはありますか。",
    "source_urls": [
     "https://genshin-impact.fandom.com/ja/wiki/コロンビーナ/プロフィール"
    ],
    "source_access": "wiki_transcription_or_summary; see evidence notes",
    "numeric_model_origin": "authored_hypothesis_not_official_character_score"
   },
   "arlecchino": {
    "name": "アルレッキーノ",
    "title": "召使",
    "story_context": "壁炉の家を率いる姿には、感情の起源を認識して扱う教えと、厳しさの中にある関わりが描かれます。",
    "association_theme": "感情を理解すること、表に出すこと、行動を続けることを分けて考える連想です。",
    "limit": "冷静であることを感情の欠如や、本人の常に低い困難度と同一視しません。",
    "reflection": "表に出さない気持ちを、自分自身ではどのくらい把握できていますか。",
    "source_urls": [
     "https://genshin-impact.fandom.com/ja/wiki/アルレッキーノ/プロフィール"
    ],
    "source_access": "wiki_transcription_or_summary; see evidence notes",
    "numeric_model_origin": "authored_hypothesis_not_official_character_score"
   },
   "pulcinella": {
    "name": "プルチネッラ",
    "title": "雄鶏",
    "story_context": "市長としての手腕や継続的な働きかけが語られる一方、その世話や関わりへの評価は、語り手によって異なります。",
    "association_theme": "人との関係や、目的に向けた行動をどう保つかを考えるための連想です。",
    "limit": "他人を操作したい気持ちや、善意の有無を測ったものではありません。",
    "reflection": "自分から見た関わり方と、相手から見た関わり方に違いはありそうですか。",
    "source_urls": [
     "https://genshin-impact.fandom.com/ja/wiki/「雄鶏」"
    ],
    "source_access": "wiki_transcription_or_summary; see evidence notes",
    "numeric_model_origin": "authored_hypothesis_not_official_character_score"
   },
   "scaramouche": {
    "name": "スカラマシュ",
    "title": "散兵",
    "story_context": "執行官期の物語には、裏切りと受け止めた経験、心を巡る葛藤、目的へ向かう行動が描かれます。後に、その経験の理解が変わる場面もあります。",
    "association_theme": "つながりの中での傷つきと、その後の感情や行動を考えるための連想です。",
    "limit": "愛着タイプ、危険性、復讐心、加害性が一致するという意味ではありません。",
    "reflection": "当時の受け止め方と、今の見方に違いが生まれた経験はありますか。",
    "source_urls": [
     "https://genshin-impact.fandom.com/ja/wiki/夜を飛ぶ鳥は三段へと落ちる"
    ],
    "source_access": "wiki_transcription_or_summary; see evidence notes",
    "numeric_model_origin": "authored_hypothesis_not_official_character_score"
   },
   "sandrone": {
    "name": "サンドローネ",
    "title": "傀儡",
    "story_context": "研究に没頭する姿と、相手によって異なる関わりが語られます。周囲からの評価だけで一つの内面を決めることはできません。",
    "association_theme": "集中する活動と、対人場面での感情の扱い方を考えるための連想です。",
    "limit": "研究志向や完璧主義を直接測定した結果ではありません。",
    "reflection": "集中しやすい場面と、人との関わりで負担が増す場面には違いがありますか。",
    "source_urls": [
     "https://genshin-impact.fandom.com/ja/wiki/「傀儡」"
    ],
    "source_access": "wiki_transcription_or_summary; see evidence notes",
    "numeric_model_origin": "authored_hypothesis_not_official_character_score"
   },
   "signora": {
    "name": "シニョーラ",
    "title": "淑女",
    "story_context": "喪失を経た強い感情と、執行官としての目的遂行が描かれます。氷の邪眼には、自身の炎を抑える役割がありました。",
    "association_theme": "内に抱えるものと、表に出すもの、行動へ移すものを分けて振り返る連想です。",
    "limit": "悲嘆や復讐心の得点ではなく、氷の邪眼が表出抑制の心理得点を証明するわけでもありません。",
    "reflection": "抱えている気持ちと、日々の行動の間にどんな距離を置いていますか。",
    "source_urls": [
     "https://genshin-impact.fandom.com/ja/wiki/シニョーラ"
    ],
    "source_access": "wiki_transcription_or_summary; see evidence notes",
    "numeric_model_origin": "authored_hypothesis_not_official_character_score"
   },
   "pantalone": {
    "name": "パンタローネ",
    "title": "富者",
    "story_context": "経済を通じた長期的な計画を進める人物として描かれます。アルレッキーノからは、計画能力と、その奥にある感情について異なる評価が語られます。",
    "association_theme": "計画を続けることと、内側にある気持ちとの関係を考えるための連想です。",
    "limit": "貧困経験から現在の有能感阻害を判定したり、憎しみから衝動性を決めたりするものではありません。",
    "reflection": "自分が説明している行動の理由と、感じている気持ちは一致していますか。",
    "source_urls": [
     "https://genshin-impact.fandom.com/ja/wiki/「富者」"
    ],
    "source_access": "wiki_transcription_or_summary; see evidence notes",
    "numeric_model_origin": "authored_hypothesis_not_official_character_score"
   },
   "tartaglia": {
    "name": "タルタリヤ",
    "title": "公子",
    "story_context": "強敵や挑戦への意欲と、家族への手紙や弟との関わりが描かれます。一つの場面だけでは捉えきれない姿があります。",
    "association_theme": "取り組みへの関与と、大切な相手とのつながりを考えるための連想です。",
    "limit": "戦闘好きや危険選好を、感情下で行動を止められないことと同一視しません。",
    "reflection": "挑戦したい気持ちと、守りたい日常はどのように両立していますか。",
    "source_urls": [
     "https://genshin-impact.fandom.com/ja/wiki/タルタリヤ/プロフィール"
    ],
    "source_access": "wiki_transcription_or_summary; see evidence notes",
    "numeric_model_origin": "authored_hypothesis_not_official_character_score"
   }
  }
 },
 "result": {
  "status": "implementation_candidate",
  "element": {
   "PY": {
    "subtitle": "内に灯る熱",
    "paragraph": "炎は、内側で高まる感情を表す、この診断独自の象徴です。",
    "reflection": "感情の強さと、その感情に従って行動するかどうかは、分けて振り返れます。"
   },
   "HY": {
    "subtitle": "つながりに映る波紋",
    "paragraph": "水は、人との関係の中で生まれる揺れを表す、この診断独自の象徴です。",
    "reflection": "距離を感じる場面と、比較的安心できる関係には、どんな違いがあるでしょうか。"
   },
   "CR": {
    "subtitle": "内側に留めるもの",
    "paragraph": "氷は、感情を外へ出さずに留めるあり方を表す、この診断独自の象徴です。",
    "reflection": "表に出さないことが自分を助ける場面と、負担になる場面の両方に目を向けられます。"
   },
   "EL": {
    "subtitle": "感情と行動のあいだ",
    "paragraph": "雷は、感情の高まりと行動の間に生まれる緊張を表す、この診断独自の象徴です。",
    "reflection": "強い気持ちがあるとき、一度止まりやすかった条件を振り返ってみてください。"
   },
   "AN": {
    "subtitle": "自分の意思の行方",
    "paragraph": "風は、自分の意思と外からの制約の葛藤を表す、この診断独自の象徴です。",
    "reflection": "選択を大きく変える前に、小さく選び直せる余地を探す見方もあります。"
   },
   "GE": {
    "subtitle": "揺れの中に置く足場",
    "paragraph": "岩は、気持ちが揺れても行動を保つあり方を表す、この診断独自の象徴です。",
    "reflection": "行動を続けられることと、負担を感じていないことは同じではありません。"
   },
   "DE": {
    "subtitle": "気持ちを編み直す",
    "paragraph": "草は、感情を理解し、出来事の意味を捉え直すあり方を表す、この診断独自の象徴です。",
    "reflection": "見方を変えることが役立つときもあれば、今の気持ちをそのまま認める方がよいときもあります。"
   }
  },
  "type": {
   "REFRAME": {
    "label": "再解釈型",
    "paragraph": "出来事の見方を変えて感情を扱おうとする。",
    "notice": "固定的な人格ではなく、今回の回答に表れた反応の説明です。"
   },
   "CONTAIN": {
    "label": "秘匿型",
    "paragraph": "感情を外に出さず、内側で扱う。",
    "notice": "固定的な人格ではなく、今回の回答に表れた反応の説明です。"
   },
   "SURGE": {
    "label": "衝動型",
    "paragraph": "強い感情の下では、意図したように行動を止めにくい。",
    "notice": "固定的な人格ではなく、今回の回答に表れた反応の説明です。"
   },
   "STALL": {
    "label": "停滞型",
    "paragraph": "強い感情の下では、必要な行動を続けにくい。",
    "notice": "固定的な人格ではなく、今回の回答に表れた反応の説明です。"
   },
   "CONFUSE": {
    "label": "困惑型",
    "paragraph": "自分の感情をつかみ、整理することに難しさがある。",
    "notice": "固定的な人格ではなく、今回の回答に表れた反応の説明です。"
   },
   "RESIST": {
    "label": "自責型",
    "paragraph": "生じた感情を、そのまま認めにくい。",
    "notice": "固定的な人格ではなく、今回の回答に表れた反応の説明です。"
   }
  },
  "no_marked_pattern": "今回の回答では、特定の反応だけが強く表れる形にはなっていません。無理に強い葛藤の型へ当てはめる必要はありません。",
  "co_dominant": "複数の反応が近い得点になっています。場面によって異なる扱い方が表れている可能性があります。",
  "insufficient": "回答が足りない項目があるため、この部分の判定を保留しています。",
  "assembly": "元素の象徴説明、実際の寄与項目と得点、タイプの説明、反省の問いを組み合わせる。各寄与項目が全て高いと断定しない。",
  "character_pending": "人物プロフィールは調整中です。この表示は内部プレビュー用で、公開完成版の仕様ではありません。",
  "version": "jagan-result-copy-1.0.0-rc1"
 },
 "report": {
  "status": "implementation_candidate",
  "score_notice": "0〜100は回答範囲の換算値です。順位、確率、重症度ではありません。",
  "domains": {
   "AUT_S": {
    "label": "自律性の充足",
    "meaning": "自分で納得して選べる感覚",
    "limit": "この得点だけでは、独立心の強さや他人を必要としないことは分かりません。",
    "reflection": "自分で選べたと感じるのは、最近のどんな場面ですか。"
   },
   "AUT_F": {
    "label": "自律性の阻害",
    "meaning": "選択を制約されていると感じる経験",
    "limit": "高くても、他者を支配したいことや協調性の低さは意味しません。",
    "reflection": "選び直せる余地が一つあるなら、どの場面でしょうか。"
   },
   "COM_S": {
    "label": "有能感の充足",
    "meaning": "取り組みを進められる手応え",
    "limit": "客観的な能力や他人との優劣を評価する得点ではありません。",
    "reflection": "手応えを得られたとき、何が助けになりましたか。"
   },
   "COM_F": {
    "label": "有能感の阻害",
    "meaning": "力が届かないと感じる経験",
    "limit": "能力不足や劣等感の原因を証明するものではありません。",
    "reflection": "求められることと、使える時間や支援は釣り合っていますか。"
   },
   "REL_S": {
    "label": "関係性の充足",
    "meaning": "大切な相手とつながっている感覚",
    "limit": "交友人数や外向性の高さを意味するものではありません。",
    "reflection": "気持ちが通じたと感じる相手や時間はありますか。"
   },
   "REL_F": {
    "label": "関係性の阻害",
    "meaning": "人との関係で距離や拒絶を感じる経験",
    "limit": "相手が実際に拒絶していることや、愛着タイプを確定するものではありません。",
    "reflection": "距離を感じた場面と、比較的安心できた場面に違いはありますか。"
   },
   "REAPP": {
    "label": "捉え直しの使用",
    "meaning": "見方を変えて感情を扱おうとする傾向",
    "limit": "その方法が常に成功することや、他の方法より優れていることは意味しません。",
    "reflection": "捉え直すことで楽になったことと、変えなくてよい気持ちは何ですか。"
   },
   "SUPPR": {
    "label": "表出抑制の使用",
    "meaning": "感情を外に出さず扱う傾向",
    "limit": "感情がない、不健康である、冷たい人であるという意味ではありません。",
    "reflection": "感情を表に出さないことが役立つ場面と、負担になる場面はありますか。"
   },
   "CLAR_D": {
    "label": "感情理解の困難",
    "meaning": "つらいときに感情をつかみにくい経験",
    "limit": "無意識の内容や、特定の病気を判定するものではありません。",
    "reflection": "感情の名前が出てこないとき、体の感覚や出来事から振り返れますか。"
   },
   "ACC_D": {
    "label": "感情受容の困難",
    "meaning": "生じた感情を認めにくい経験",
    "limit": "その感情が悪いことや、本人の弱さを示すものではありません。",
    "reflection": "感情を持つことと、その感情のまま行動することを分けて考えられますか。"
   },
   "IMP_D": {
    "label": "衝動調整の困難",
    "meaning": "強い感情の下で行動を止めにくい経験",
    "limit": "危険性、攻撃性、ADHDを判定するものではありません。",
    "reflection": "一度止まりやすかった場面には、どんな条件がありましたか。"
   },
   "GOAL_D": {
    "label": "行動維持の困難",
    "meaning": "強い感情の下で必要な行動を続けにくい経験",
    "limit": "怠けや誠実性の低さを表すものではありません。",
    "reflection": "つらい日にも進められた最小の行動は、どのくらいの大きさでしたか。"
   }
  },
  "price": 1000,
  "sales_open": false,
  "version": "jagan-report-copy-1.0.0-rc1"
 },
 "method": {
  "page_title": "邪眼診断について",
  "short_notice": "心理学理論を参考にした独自の自己理解コンテンツです。医療診断ではありません。",
  "score_notice": "12項目の数値は、独自設問への回答を0〜100へ換算した値です。一般集団での順位や確率ではありません。",
  "element_type_notice": "元素・型は、回答を作品のモチーフで表す独自の解釈です。原作公式の心理分類ではありません。",
  "character_notice": "公式描写を参考に設計した独自の回答参照パターンとの近さです。人物本人の心理得点や科学的な一致確率ではありません。",
  "balance_notice": "出現の偏りを抑えるため、仮回答を使って参照パターンを調整しています。実利用者全体で同じ出現率になる保証はありません。",
  "timeframe_notice": "最近1か月ほどの回答を扱います。結果は固定的な本性や善悪を示すものではありません。",
  "development_notice": "独自50問の信頼性・妥当性を人の回答で検証した尺度ではありません。人工データによる動作確認と心理測定の検証は異なります。"
 }
});
