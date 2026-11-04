// 生成物：scripts/jagan-data.mjs が docs/jagan/spec_v0_3_balanced/*.json から作る。手で編集しない。
export const BUNDLE = Object.freeze({
 "items": {
  "diagnosis_key": "jagan",
  "item_set_version": "jagan-shadow-items-0.4.0-semantic-review",
  "status": "semantic_revision_candidate_not_validated",
  "launch_ready": false,
  "page_size": 5,
  "page_count": 10,
  "question_count": 50,
  "intro_screen": false,
  "allow_skip": false,
  "auxiliary_options": [],
  "required_answers": 50,
  "default_answer": null,
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
  "traits": [
   {
    "id": "ANX",
    "label": "不安",
    "item_count": 4
   },
   {
    "id": "SEP",
    "label": "依存",
    "item_count": 5
   },
   {
    "id": "SUS",
    "label": "猜疑",
    "item_count": 4
   },
   {
    "id": "WDR",
    "label": "撤退",
    "item_count": 4
   },
   {
    "id": "IMP",
    "label": "衝動",
    "item_count": 5
   },
   {
    "id": "PSV",
    "label": "固執",
    "item_count": 4
   },
   {
    "id": "PRF",
    "label": "完璧",
    "item_count": 4
   },
   {
    "id": "HOS",
    "label": "敵意",
    "item_count": 4
   },
   {
    "id": "ATT",
    "label": "顕示",
    "item_count": 4
   },
   {
    "id": "MAN",
    "label": "操作",
    "item_count": 4
   },
   {
    "id": "RSK",
    "label": "危険志向",
    "item_count": 4
   },
   {
    "id": "CAL",
    "label": "冷淡",
    "item_count": 4
   }
  ],
  "display_order": [
   "ANX01",
   "PRF01",
   "SEP01",
   "IMP01",
   "WDR02",
   "ATT01",
   "SUS01",
   "PSV01",
   "HOS01",
   "MAN01",
   "RSK01",
   "CAL01",
   "ANX02",
   "PRF02",
   "SEP02",
   "IMP02",
   "WDR03",
   "ATT02",
   "SUS02",
   "PSV02",
   "HOS03",
   "MAN02",
   "RSK02",
   "CAL02",
   "ANX03",
   "PRF04",
   "SEP03",
   "IMP03",
   "WDR04",
   "ATT03",
   "SUS03",
   "PSV04",
   "HOS04",
   "MAN03",
   "RSK03",
   "CAL03",
   "ANX05",
   "PRF05",
   "SEP04",
   "IMP04",
   "WDR05",
   "ATT05",
   "SUS05",
   "PSV05",
   "HOS05",
   "MAN04",
   "RSK04",
   "CAL04",
   "SEP05",
   "IMP05"
  ],
  "items": [
   {
    "id": "ANX01",
    "trait": "ANX",
    "text": "まだ決まっていないことについて、悪い展開を思い浮かべる。",
    "direction": 1,
    "intended_content": "先行きへの心配",
    "review_note": "現実的な危険への妥当な心配も含み得る"
   },
   {
    "id": "ANX02",
    "trait": "ANX",
    "text": "これからする用事について考えると、緊張して落ち着かなくなる。",
    "direction": 1,
    "intended_content": "緊張",
    "review_note": "特性定義への対応を再点検した独自表現。読解・妥当性は未検証。"
   },
   {
    "id": "ANX03",
    "trait": "ANX",
    "text": "特に問題が起きていないときも、何か悪いことが起こりそうで落ち着かない。",
    "direction": 1,
    "intended_content": "予期する恐れ",
    "review_note": "現在の生活環境の影響を受ける"
   },
   {
    "id": "ANX05",
    "trait": "ANX",
    "text": "一つの心配が落ち着くと、別の気がかりが頭に浮かぶ。",
    "direction": 1,
    "intended_content": "心配の持続",
    "review_note": "固執と区別できるか確認"
   },
   {
    "id": "SEP01",
    "trait": "SEP",
    "text": "親しい相手からの返事が遅いと、自分から離れていくのではないかと不安になる。",
    "direction": 1,
    "intended_content": "関係喪失への不安",
    "review_note": "連絡習慣・実際の関係悪化の影響"
   },
   {
    "id": "SEP02",
    "trait": "SEP",
    "text": "親しい相手との間で意見が食い違うと、距離を置かれることが心配になる。",
    "direction": 1,
    "intended_content": "拒絶される恐れ",
    "review_note": "一般的な不安との区別"
   },
   {
    "id": "SEP03",
    "trait": "SEP",
    "text": "親しい相手と離れて過ごすと、関係が続くか不安になる。",
    "direction": 1,
    "intended_content": "離別への不安",
    "review_note": "相手との関係や生活上の事情の影響"
   },
   {
    "id": "SEP04",
    "trait": "SEP",
    "text": "親しい相手が自分以外の人と過ごしていると、自分の居場所がなくなる気がする。",
    "direction": 1,
    "intended_content": "関係内の居場所を失う恐れ",
    "review_note": "嫉妬との重なり"
   },
   {
    "id": "SEP05",
    "trait": "SEP",
    "text": "頼りにしている相手がいなくなることを考えると、自分一人ではやっていけない気がする。",
    "direction": 1,
    "intended_content": "相手を失った後の自己支援への不安",
    "review_note": "実際に援助が必要な事情の影響"
   },
   {
    "id": "SUS01",
    "trait": "SUS",
    "text": "人から親切にされると、相手に何か狙いがあるのか考える。",
    "direction": 1,
    "intended_content": "他者の意図への疑い",
    "review_note": "正常な警戒も拾う"
   },
   {
    "id": "SUS02",
    "trait": "SUS",
    "text": "その場にいない間に、自分についてよくない話をされている気がする。",
    "direction": 1,
    "intended_content": "陰での悪意を疑う",
    "review_note": "実際の排斥経験が影響"
   },
   {
    "id": "SUS03",
    "trait": "SUS",
    "text": "相手の説明を聞いた後も、隠していることがあるのではと思う。",
    "direction": 1,
    "intended_content": "説明への疑い",
    "review_note": "説明そのものが不十分な場合との区別"
   },
   {
    "id": "SUS05",
    "trait": "SUS",
    "text": "相手と約束をしても、自分を裏切るのではないかという疑いが残る。",
    "direction": 1,
    "intended_content": "信頼・忠実さへの疑い",
    "review_note": "関係ごとの違いがある"
   },
   {
    "id": "WDR02",
    "trait": "WDR",
    "text": "誰かと話せる場でも、自分から会話に入らずに過ごす。",
    "direction": 1,
    "intended_content": "会話への関与の少なさ",
    "review_note": "内向性との重なり"
   },
   {
    "id": "WDR03",
    "trait": "WDR",
    "text": "人と知り合っても、その後に自分から連絡するのを控える。",
    "direction": 1,
    "intended_content": "関係の開始・継続への関与の少なさ",
    "review_note": "連絡方法や相手側の事情が影響"
   },
   {
    "id": "WDR04",
    "trait": "WDR",
    "text": "誰かと一緒に過ごせるときも、一人でいる方を選ぶ。",
    "direction": 1,
    "intended_content": "一人でいる選択",
    "review_note": "望ましい一人時間も含む"
   },
   {
    "id": "WDR05",
    "trait": "WDR",
    "text": "関わりが増えそうになると、人との距離を広げる。",
    "direction": 1,
    "intended_content": "対人距離の拡大",
    "review_note": "親密さの回避との重なり"
   },
   {
    "id": "IMP01",
    "trait": "IMP",
    "text": "思いついたことを、その後どうなるか考える前に始める。",
    "direction": 1,
    "intended_content": "結果を検討する前の着手",
    "review_note": "行動力との区別"
   },
   {
    "id": "IMP02",
    "trait": "IMP",
    "text": "気持ちが高ぶったとき、言葉を選ぶ前に口に出す。",
    "direction": 1,
    "intended_content": "検討する前の発言",
    "review_note": "感情が強い場面への限定"
   },
   {
    "id": "IMP03",
    "trait": "IMP",
    "text": "目の前のことにすぐ反応し、その後どうなるかを考えるのが後になる。",
    "direction": 1,
    "intended_content": "検討する前の承諾",
    "review_note": "特性定義への対応を再点検した独自表現。読解・妥当性は未検証。"
   },
   {
    "id": "IMP04",
    "trait": "IMP",
    "text": "その場でしたいことがあると、後の予定への影響を考えずに行動する。",
    "direction": 1,
    "intended_content": "後の影響を考えない行動",
    "review_note": "単なる予定変更から内容を絞った"
   },
   {
    "id": "IMP05",
    "trait": "IMP",
    "text": "一度立ち止まって考えようと思っても、その前に行動に移してしまう。",
    "direction": 1,
    "intended_content": "行動に先立つ停止の難しさ",
    "review_note": "自覚している人だけが答えやすい可能性"
   },
   {
    "id": "PSV01",
    "trait": "PSV",
    "text": "別のやり方が必要だと分かっても、同じ方法を続ける。",
    "direction": 1,
    "intended_content": "変更が必要でも同じ方法を続ける",
    "review_note": "変更が実行できない事情が影響"
   },
   {
    "id": "PSV02",
    "trait": "PSV",
    "text": "成果につながらなくなった取り組みでも、やめる判断ができずに続ける。",
    "direction": 1,
    "intended_content": "有効でない取り組みの継続",
    "review_note": "責任から継続が必要な状況と区別"
   },
   {
    "id": "PSV04",
    "trait": "PSV",
    "text": "考え続けても解決に近づかないことを、同じように考え続ける。",
    "direction": 1,
    "intended_content": "解決につながらない思考の反復",
    "review_note": "不安・反芻との重なり"
   },
   {
    "id": "PSV05",
    "trait": "PSV",
    "text": "周囲の状況が変わった後も、最初に決めた方針から切り替えにくい。",
    "direction": 1,
    "intended_content": "状況変化への切り替えの難しさ",
    "review_note": "一貫性や約束を守ることとの区別"
   },
   {
    "id": "PRF01",
    "trait": "PRF",
    "text": "用件は満たせていても、細かな部分を直し続ける。",
    "direction": 1,
    "intended_content": "十分な状態でも修正を続ける",
    "review_note": "職業上必要な品質管理との区別"
   },
   {
    "id": "PRF02",
    "trait": "PRF",
    "text": "作業の仕上がりを確かめるうちに、予定していた時間を超える。",
    "direction": 1,
    "intended_content": "確認に時間をかける",
    "review_note": "不安からの確認との重なり"
   },
   {
    "id": "PRF04",
    "trait": "PRF",
    "text": "少しでも不十分なところがあると、そのまま人に見せるのをためらう。",
    "direction": 1,
    "intended_content": "不完全な状態を出しにくい",
    "review_note": "評価への不安との重なり"
   },
   {
    "id": "PRF05",
    "trait": "PRF",
    "text": "急ぐ必要があるときも、細部まで整えることを優先する。",
    "direction": 1,
    "intended_content": "状況より細部を優先",
    "review_note": "実際の品質要件が影響"
   },
   {
    "id": "HOS01",
    "trait": "HOS",
    "text": "相手のちょっとした言い方に、腹が立つ。",
    "direction": 1,
    "intended_content": "小さなきっかけでの怒り",
    "review_note": "実際の侮辱・疲労の影響"
   },
   {
    "id": "HOS03",
    "trait": "HOS",
    "text": "相手への不満が、声の強さや言葉のきつさに出る。",
    "direction": 1,
    "intended_content": "敵対的な感情表出",
    "review_note": "本人の判断基準が影響"
   },
   {
    "id": "HOS04",
    "trait": "HOS",
    "text": "相手に腹を立てると、相手が困るように振る舞いたくなる。",
    "direction": 1,
    "intended_content": "相手に不利益を与えたい反応",
    "review_note": "実際の行動ではなく気持ちを問う"
   },
   {
    "id": "HOS05",
    "trait": "HOS",
    "text": "意見がぶつかったとき、相手を責める言い方になる。",
    "direction": 1,
    "intended_content": "相手を責める反応",
    "review_note": "意見の主張そのものとは分ける"
   },
   {
    "id": "ATT01",
    "trait": "ATT",
    "text": "人が集まる場で、自分に注目が集まるように話題を選ぶ。",
    "direction": 1,
    "intended_content": "話題選びによる注目獲得",
    "review_note": "司会などの役割が影響"
   },
   {
    "id": "ATT02",
    "trait": "ATT",
    "text": "他の人に注目が集まると、自分にも話を向けたくなる。",
    "direction": 1,
    "intended_content": "自分に注目を戻す",
    "review_note": "自然な会話参加との区別"
   },
   {
    "id": "ATT03",
    "trait": "ATT",
    "text": "注目を集めるために、話し方や振る舞いを大げさにする。",
    "direction": 1,
    "intended_content": "大げさな表現で注目を得る",
    "review_note": "表現力一般へ薄めないため改訂"
   },
   {
    "id": "ATT05",
    "trait": "ATT",
    "text": "自分の話に反応が少ないと、さらに注意を引く話を足す。",
    "direction": 1,
    "intended_content": "注意を得るための話の追加",
    "review_note": "会話を続ける配慮との区別"
   },
   {
    "id": "MAN01",
    "trait": "MAN",
    "text": "頼みを通したいとき、相手への好意を実際よりも強く示す。",
    "direction": 1,
    "intended_content": "目的のための好意の演出",
    "review_note": "一般的な愛想との区別"
   },
   {
    "id": "MAN02",
    "trait": "MAN",
    "text": "自分に有利な選択をしてもらうため、相手に知らせる情報を絞る。",
    "direction": 1,
    "intended_content": "選択的な情報提示による誘導",
    "review_note": "要点整理・守秘との区別"
   },
   {
    "id": "MAN03",
    "trait": "MAN",
    "text": "相手をその気にさせるため、自分が本当に思っている以上に褒める。",
    "direction": 1,
    "intended_content": "目的のためのお世辞",
    "review_note": "礼儀や応援との区別"
   },
   {
    "id": "MAN04",
    "trait": "MAN",
    "text": "自分の狙いに気づかれないようにして、相手を望む行動へ導く。",
    "direction": 1,
    "intended_content": "狙いを隠した誘導",
    "review_note": "欺瞞との重なり"
   },
   {
    "id": "RSK01",
    "trait": "RSK",
    "text": "危険があると分かっていても、面白そうなら試してみたくなる。",
    "direction": 1,
    "intended_content": "危険を伴う行動への接近",
    "review_note": "適切な挑戦や訓練された危険管理と区別する"
   },
   {
    "id": "RSK02",
    "trait": "RSK",
    "text": "危険を避けられる場面でも、刺激を求めて危ない方を選ぶ。",
    "direction": 1,
    "intended_content": "必須ではない危険の選択",
    "review_note": "自己申告した危険の認識に依存する"
   },
   {
    "id": "RSK03",
    "trait": "RSK",
    "text": "退屈を感じると、危険を伴うことにも手を出したくなる。",
    "direction": 1,
    "intended_content": "退屈を埋めるための危険への接近",
    "review_note": "衝動との重なりを点検する"
   },
   {
    "id": "RSK04",
    "trait": "RSK",
    "text": "危険を指摘されても、自分なら大丈夫だと考えて進める。",
    "direction": 1,
    "intended_content": "自分への危険の過小評価",
    "review_note": "実際の能力や経験との区別が必要"
   },
   {
    "id": "CAL01",
    "trait": "CAL",
    "text": "相手がつらそうでも、その人の気持ちにはあまり関心が向かない。",
    "direction": 1,
    "intended_content": "他者の苦痛への関心の薄さ",
    "review_note": "他者の状態に気づく力や感情表現の乏しさとは区別する"
   },
   {
    "id": "CAL02",
    "trait": "CAL",
    "text": "自分の行動で相手を傷つけたと分かっても、申し訳なさはあまり感じない。",
    "direction": 1,
    "intended_content": "自分が与えた負担への後悔の乏しさ",
    "review_note": "適切な境界設定と、不必要に傷つけることを区別する"
   },
   {
    "id": "CAL03",
    "trait": "CAL",
    "text": "自分の目的が果たせるなら、相手が困ることは気にならない。",
    "direction": 1,
    "intended_content": "目的達成時の他者の不利益への無関心",
    "review_note": "利害対立に伴う正当な選択との区別が必要"
   },
   {
    "id": "CAL04",
    "trait": "CAL",
    "text": "相手が困っていると理解しても、力になりたいという気持ちはあまり起きない。",
    "direction": 1,
    "intended_content": "他者の困難への配慮の薄さ",
    "review_note": "支援できる余力がないことと、気持ちが起きないことの区別を確認"
   }
  ],
  "result_engine_status": "twelve_trait_core_and_balanced_character_candidate_v0_3",
  "changes_from_v03": {
   "removed_ids": [
    "ANX04",
    "ATT04",
    "HOS02",
    "MAN05",
    "PRF03",
    "PSV03",
    "SUS04",
    "WDR01"
   ],
   "reworded_ids": [
    "ANX02",
    "IMP03"
   ],
   "added_ids": [
    "RSK01",
    "RSK02",
    "RSK03",
    "RSK04",
    "CAL01",
    "CAL02",
    "CAL03",
    "CAL04"
   ]
  },
  "scoring_note": "各特性の回答平均を換算。項目数が異なるため合計値で比較しない。得点は当てはまりの指標であり、異なる特性の臨床的な強さが等しいとは保証しない。"
 },
 "core": {
  "version": "jagan-twelve-trait-core-0.2.0-candidate",
  "status": "design_candidate_not_empirically_validated",
  "launch_ready": false,
  "trait_score": "25*(mean-1)",
  "isou_minimum_candidate": 60,
  "near_gap_candidate": 5,
  "elements": [
   {
    "id": "PY",
    "label": "炎",
    "weights": {
     "HOS": 0.45,
     "IMP": 0.25,
     "RSK": 0.3
    }
   },
   {
    "id": "HY",
    "label": "水",
    "weights": {
     "SEP": 0.5,
     "ANX": 0.3,
     "SUS": 0.2
    }
   },
   {
    "id": "CR",
    "label": "氷",
    "weights": {
     "WDR": 0.45,
     "SUS": 0.3,
     "CAL": 0.25
    }
   },
   {
    "id": "EL",
    "label": "雷",
    "weights": {
     "IMP": 0.4,
     "RSK": 0.4,
     "ATT": 0.2
    }
   },
   {
    "id": "AN",
    "label": "風",
    "weights": {
     "WDR": 0.35,
     "ANX": 0.4,
     "RSK": 0.25
    }
   },
   {
    "id": "GE",
    "label": "岩",
    "weights": {
     "PRF": 0.45,
     "MAN": 0.35,
     "PSV": 0.2
    }
   },
   {
    "id": "DE",
    "label": "草",
    "weights": {
     "PSV": 0.45,
     "SUS": 0.3,
     "PRF": 0.25
    }
   }
  ],
  "character_status": "partial_story_reference_fixed_balance_candidate_v0_3",
  "reference_note": "元素係数・閾値は独自の演出設計。学術的な標準値ではない。"
 },
 "characters": {
  "version": "jagan-character-balance-0.3.0-candidate",
  "status": "synthetic_calibration_candidate",
  "launch_ready": false,
  "axes": [
   "ANX",
   "SEP",
   "SUS",
   "WDR",
   "IMP",
   "PSV",
   "PRF",
   "HOS",
   "ATT",
   "MAN",
   "RSK",
   "CAL"
  ],
  "mapped_axes": [
   "CAL",
   "HOS",
   "IMP",
   "MAN",
   "RSK",
   "SUS",
   "WDR"
  ],
  "anchor_agreement_weight": 0.75,
  "salience_coverage_weight": 0.25,
  "salience_start": 50,
  "minimum_mapped_spread": 10,
  "similarity_display": "raw_association_score_before_balance_offset",
  "selection": "raw_association_score_plus_fixed_balance_offset",
  "unknown_handling": "excluded_not_imputed",
  "characters": [
   {
    "id": "pierro",
    "name": "ピエロ",
    "title": "道化",
    "tags": [
     "喪失",
     "反逆"
    ],
    "anchors": {
     "HOS": 75,
     "SUS": 65
    },
    "unknown_axes": [
     "ANX",
     "SEP",
     "WDR",
     "IMP",
     "PSV",
     "PRF",
     "ATT",
     "MAN",
     "RSK",
     "CAL"
    ],
    "rationale": "喪失を背景にした敵対と不信を物語上の参照にする。固執・依存の座標は推定しない。",
    "region_label": "カーンルイア",
    "source_urls": [
     "https://genshin-impact.fandom.com/ja/wiki/嗤笑の面"
    ],
    "reference_origin": "authored_story_association_not_measured_character_trait",
    "confidence": "interpretive_not_validated",
    "selection_offset": -1.04309072
   },
   {
    "id": "capitano",
    "name": "カピターノ",
    "title": "隊長",
    "tags": [
     "責務",
     "献身"
    ],
    "anchors": {
     "IMP": 25,
     "CAL": 15,
     "HOS": 25
    },
    "unknown_axes": [
     "ANX",
     "SEP",
     "SUS",
     "WDR",
     "PSV",
     "PRF",
     "ATT",
     "MAN",
     "RSK"
    ],
    "rationale": "目的に沿う行動、協働や救命との連想として低めの参照を置く。低い悪癖が献身を測るという意味ではない。",
    "region_label": "カーンルイア",
    "source_urls": [
     "https://genshin-impact.fandom.com/ja/wiki/「隊長」"
    ],
    "reference_origin": "authored_story_association_not_measured_character_trait",
    "confidence": "interpretive_not_validated",
    "selection_offset": -6.5172877
   },
   {
    "id": "dottore",
    "name": "ドットーレ",
    "title": "博士",
    "tags": [
     "探究",
     "操作"
    ],
    "anchors": {
     "MAN": 90,
     "CAL": 90
    },
    "unknown_axes": [
     "ANX",
     "SEP",
     "SUS",
     "WDR",
     "IMP",
     "PSV",
     "PRF",
     "HOS",
     "ATT",
     "RSK"
    ],
    "rationale": "他者を手段にする行動と不利益の扱いを比較。研究好きから固執や完璧を推定しない。",
    "region_label": "スメール",
    "source_urls": [
     "https://genshin-impact.fandom.com/ja/wiki/「博士」"
    ],
    "reference_origin": "authored_story_association_not_measured_character_trait",
    "confidence": "interpretive_not_validated",
    "selection_offset": 1.43494074
   },
   {
    "id": "columbina",
    "name": "コロンビーナ",
    "title": "少女",
    "tags": [
     "孤独",
     "帰属"
    ],
    "anchors": {
     "WDR": 65,
     "HOS": 20,
     "CAL": 20
    },
    "unknown_axes": [
     "ANX",
     "SEP",
     "SUS",
     "IMP",
     "PSV",
     "PRF",
     "ATT",
     "MAN",
     "RSK"
    ],
    "rationale": "ファデュイから距離を取る時期と、人に安らぎを願う描写への連想。帰属から依存を推定しない。時期による違い・対応根拠の弱さが残る。",
    "region_label": "ナドクライ",
    "source_urls": [
     "https://genshin-impact.fandom.com/ja/wiki/コロンビーナ/プロフィール"
    ],
    "reference_origin": "authored_story_association_not_measured_character_trait",
    "confidence": "interpretive_not_validated",
    "selection_offset": -1.52676805
   },
   {
    "id": "arlecchino",
    "name": "アルレッキーノ",
    "title": "召使",
    "tags": [
     "庇護",
     "統制"
    ],
    "anchors": {
     "MAN": 70,
     "IMP": 20,
     "CAL": 30
    },
    "unknown_axes": [
     "ANX",
     "SEP",
     "SUS",
     "WDR",
     "PSV",
     "PRF",
     "HOS",
     "ATT",
     "RSK"
    ],
    "rationale": "対人場面の演出と目的に沿う行動、子どもへの配慮への連想。無表情から冷淡を推定しない。",
    "region_label": "フォンテーヌ",
    "source_urls": [
     "https://genshin-impact.fandom.com/ja/wiki/アルレッキーノ/プロフィール"
    ],
    "reference_origin": "authored_story_association_not_measured_character_trait",
    "confidence": "interpretive_not_validated",
    "selection_offset": 2.29190267
   },
   {
    "id": "pulcinella",
    "name": "プルチネッラ",
    "title": "雄鶏",
    "tags": [
     "庇護",
     "交渉"
    ],
    "anchors": {
     "MAN": 75,
     "IMP": 30
    },
    "unknown_axes": [
     "ANX",
     "SEP",
     "SUS",
     "WDR",
     "PSV",
     "PRF",
     "HOS",
     "ATT",
     "RSK",
     "CAL"
    ],
    "rationale": "政治上の誘導と計画的な関与への連想。他者による人質評を確定した内面とせず、冷淡は未対応とする。",
    "region_label": "スネージナヤ",
    "source_urls": [
     "https://genshin-impact.fandom.com/ja/wiki/「雄鶏」"
    ],
    "reference_origin": "authored_story_association_not_measured_character_trait",
    "confidence": "interpretive_not_validated",
    "selection_offset": 4.50831377
   },
   {
    "id": "scaramouche",
    "name": "スカラマシュ",
    "title": "散兵",
    "tags": [
     "拒絶",
     "反逆"
    ],
    "anchors": {
     "HOS": 90,
     "SUS": 85
    },
    "unknown_axes": [
     "ANX",
     "SEP",
     "WDR",
     "IMP",
     "PSV",
     "PRF",
     "ATT",
     "MAN",
     "RSK",
     "CAL"
    ],
    "rationale": "執行官期の敵意と不信の描写を参照。現在の放浪者と混ぜず、拒絶経験だけで依存を設定しない。",
    "region_label": "稲妻",
    "source_urls": [
     "https://genshin-impact.fandom.com/ja/wiki/「散兵」"
    ],
    "reference_origin": "authored_story_association_not_measured_character_trait",
    "confidence": "interpretive_not_validated",
    "selection_offset": 1.54694846
   },
   {
    "id": "sandrone",
    "name": "サンドローネ",
    "title": "傀儡",
    "tags": [
     "没頭",
     "執着"
    ],
    "anchors": {
     "WDR": 75,
     "HOS": 65
    },
    "unknown_axes": [
     "ANX",
     "SEP",
     "SUS",
     "IMP",
     "PSV",
     "PRF",
     "ATT",
     "MAN",
     "RSK",
     "CAL"
    ],
    "rationale": "対人場面から退く描写と、いら立ちの描写を比較する。研究への集中から固執・完璧・冷淡を推定しない。",
    "region_label": "フォンテーヌ",
    "source_urls": [
     "https://genshin-impact.fandom.com/ja/wiki/「傀儡」"
    ],
    "reference_origin": "authored_story_association_not_measured_character_trait",
    "confidence": "interpretive_not_validated",
    "selection_offset": -2.16520875
   },
   {
    "id": "signora",
    "name": "シニョーラ",
    "title": "淑女",
    "tags": [
     "喪失",
     "憤怒"
    ],
    "anchors": {
     "HOS": 85,
     "MAN": 70,
     "CAL": 65
    },
    "unknown_axes": [
     "ANX",
     "SEP",
     "SUS",
     "WDR",
     "IMP",
     "PSV",
     "PRF",
     "ATT",
     "RSK"
    ],
    "rationale": "敵対的な行動、外交上の演出、他者への不利益の扱いを参照。悲嘆から依存を推定しない。",
    "region_label": "モンド",
    "source_urls": [
     "https://genshin-impact.fandom.com/ja/wiki/シニョーラ"
    ],
    "reference_origin": "authored_story_association_not_measured_character_trait",
    "confidence": "interpretive_not_validated",
    "selection_offset": 0.83189851
   },
   {
    "id": "pantalone",
    "name": "パンタローネ",
    "title": "富者",
    "tags": [
     "掌握",
     "野心"
    ],
    "anchors": {
     "MAN": 85,
     "CAL": 55
    },
    "unknown_axes": [
     "ANX",
     "SEP",
     "SUS",
     "WDR",
     "IMP",
     "PSV",
     "PRF",
     "HOS",
     "ATT",
     "RSK"
    ],
    "rationale": "経済と対人上の誘導、他者の扱いへの連想。富・貧困・計画性から完璧や不安を設定しない。冷淡の対応根拠は特に要確認。",
    "region_label": "璃月",
    "source_urls": [
     "https://genshin-impact.fandom.com/ja/wiki/「富者」"
    ],
    "reference_origin": "authored_story_association_not_measured_character_trait",
    "confidence": "interpretive_not_validated",
    "selection_offset": 2.06066004
   },
   {
    "id": "tartaglia",
    "name": "タルタリヤ",
    "title": "公子",
    "tags": [
     "闘争",
     "挑戦"
    ],
    "anchors": {
     "RSK": 85,
     "IMP": 45
    },
    "unknown_axes": [
     "ANX",
     "SEP",
     "SUS",
     "WDR",
     "PSV",
     "PRF",
     "HOS",
     "ATT",
     "MAN",
     "CAL"
    ],
    "rationale": "危険への接近を中心に、計画的な行動も含む参照。戦闘好きから極端な衝動性を設定しない。数値は仮説。",
    "region_label": "スネージナヤ",
    "source_urls": [
     "https://genshin-impact.fandom.com/ja/wiki/タルタリヤ/プロフィール"
    ],
    "reference_origin": "authored_story_association_not_measured_character_trait",
    "confidence": "interpretive_not_validated",
    "selection_offset": -1.42230898
   }
  ],
  "calibration": {
   "seed": 20261103,
   "baseline": "four_equal_synthetic_cohorts",
   "train_n": 33000,
   "eligible_train_n": 32987,
   "temperature": 0.12,
   "optimizer_success": true,
   "not_live_user_distribution": true,
   "target_share": 0.09090909090909091,
   "offset_mean": -1.2111523905001707e-16,
   "anchor_sha256": "bcc0bbaf62983100fa6e8f3a1754906bb6c66944c27ef6b80b96abcb33f686e4"
  }
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
