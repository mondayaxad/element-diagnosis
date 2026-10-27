// ETI v2.0 FINAL — 100 questions
// Generated from ETI_v2_scale_design_FINAL.md
// DO NOT reorder by relying on array position for scoring.
// Always score by item.id / item.axis / item.direction.
// diagnosis_version: ETI-2.0
// item_set_version: ETI-ITEM-2.0.0

const ETI_V2_META = {
  diagnosisVersion: "ETI-2.0",
  itemSetVersion: "ETI-ITEM-2.0.0",
  scoringVersion: "ETI-SCORE-2.0.0",
  translationModelVersion: "ETI-TRANS-2.0.0",
  mirrorModelVersion: "ETI-MIRROR-2.0.0",
  personalityAxes: ["O","C","E","A","N"],
  styleAxes: ["AGY","REL","ROL","REF","AUT"],
  valueAxes: ["SD","ST","HE","AC","PO","SE","CO","TR","BE","UN"],
  responseScales: {
    self: [
      { value: -2, label: "全くあてはまらない" },
      { value: -1, label: "あまりあてはまらない" },
      { value:  0, label: "どちらともいえない" },
      { value:  1, label: "ややあてはまる" },
      { value:  2, label: "とてもあてはまる" }
    ],
    portrait: [
      { value: -2, label: "全く自分に近くない" },
      { value: -1, label: "あまり自分に近くない" },
      { value:  0, label: "どちらともいえない" },
      { value:  1, label: "やや自分に近い" },
      { value:  2, label: "とても自分に近い" }
    ]
  }
};

const ETI_V2_QUESTIONS = [
  {
    "id": "Q001",
    "code": "O01",
    "domain": "PERSONALITY",
    "axis": "O",
    "direction": 1,
    "responseMode": "self",
    "text": "新しい考え方や未知の分野に触れると、もっと知りたくなる"
  },
  {
    "id": "Q002",
    "code": "O02",
    "domain": "PERSONALITY",
    "axis": "O",
    "direction": 1,
    "responseMode": "self",
    "text": "抽象的なテーマや、答えが一つに決まらない問いを考えるのが好きだ"
  },
  {
    "id": "Q003",
    "code": "O03",
    "domain": "PERSONALITY",
    "axis": "O",
    "direction": 1,
    "responseMode": "self",
    "text": "現実にない場面や可能性を、頭の中で思い描くことが多い"
  },
  {
    "id": "Q004",
    "code": "O04",
    "domain": "PERSONALITY",
    "axis": "O",
    "direction": 1,
    "responseMode": "self",
    "text": "慣れた方法があっても、より面白い方法を試してみたくなる"
  },
  {
    "id": "Q005",
    "code": "O05",
    "domain": "PERSONALITY",
    "axis": "O",
    "direction": -1,
    "responseMode": "self",
    "text": "未知のものより、慣れ親しんだものを選ぶ方が落ち着く"
  },
  {
    "id": "Q006",
    "code": "O06",
    "domain": "PERSONALITY",
    "axis": "O",
    "direction": -1,
    "responseMode": "self",
    "text": "複雑な考えや理屈について、深く考えることにはあまり興味がない"
  },
  {
    "id": "Q007",
    "code": "O07",
    "domain": "PERSONALITY",
    "axis": "O",
    "direction": 1,
    "responseMode": "self",
    "text": "作品や景色、言葉などの細かな表現の違いに心が動くことがある"
  },
  {
    "id": "Q008",
    "code": "O08",
    "domain": "PERSONALITY",
    "axis": "O",
    "direction": -1,
    "responseMode": "self",
    "text": "物事について、別の見方や可能性を考えることはあまりない"
  },
  {
    "id": "Q009",
    "code": "C01",
    "domain": "PERSONALITY",
    "axis": "C",
    "direction": 1,
    "responseMode": "self",
    "text": "やるべきことは、順序を考えてから取りかかることが多い"
  },
  {
    "id": "Q010",
    "code": "C02",
    "domain": "PERSONALITY",
    "axis": "C",
    "direction": 1,
    "responseMode": "self",
    "text": "始めたことは、できるだけ最後まで終わらせようとする"
  },
  {
    "id": "Q011",
    "code": "C03",
    "domain": "PERSONALITY",
    "axis": "C",
    "direction": 1,
    "responseMode": "self",
    "text": "約束した期限には間に合うよう、前もって動く方だ"
  },
  {
    "id": "Q012",
    "code": "C04",
    "domain": "PERSONALITY",
    "axis": "C",
    "direction": 1,
    "responseMode": "self",
    "text": "必要な物や情報は、あとで困らないよう整理しておく"
  },
  {
    "id": "Q013",
    "code": "C05",
    "domain": "PERSONALITY",
    "axis": "C",
    "direction": -1,
    "responseMode": "self",
    "text": "やる必要があることでも、ぎりぎりまで先延ばしすることが多い"
  },
  {
    "id": "Q014",
    "code": "C06",
    "domain": "PERSONALITY",
    "axis": "C",
    "direction": -1,
    "responseMode": "self",
    "text": "引き受けたことを、うっかり忘れてしまうことがよくある"
  },
  {
    "id": "Q015",
    "code": "C07",
    "domain": "PERSONALITY",
    "axis": "C",
    "direction": -1,
    "responseMode": "self",
    "text": "準備をあまりせず、その場の勢いで始めることが多い"
  },
  {
    "id": "Q016",
    "code": "C08",
    "domain": "PERSONALITY",
    "axis": "C",
    "direction": -1,
    "responseMode": "self",
    "text": "細かい仕上げが残っていても、途中で十分だと思ってしまうことがある"
  },
  {
    "id": "Q017",
    "code": "E01",
    "domain": "PERSONALITY",
    "axis": "E",
    "direction": 1,
    "responseMode": "self",
    "text": "人と交流していると、気持ちやエネルギーが高まることが多い"
  },
  {
    "id": "Q018",
    "code": "E02",
    "domain": "PERSONALITY",
    "axis": "E",
    "direction": 1,
    "responseMode": "self",
    "text": "初対面の相手にも、自分から話しかけることができる"
  },
  {
    "id": "Q019",
    "code": "E03",
    "domain": "PERSONALITY",
    "axis": "E",
    "direction": 1,
    "responseMode": "self",
    "text": "人が集まる活気のある場を、楽しめる方だ"
  },
  {
    "id": "Q020",
    "code": "E04",
    "domain": "PERSONALITY",
    "axis": "E",
    "direction": 1,
    "responseMode": "self",
    "text": "楽しいと感じたとき、その気持ちを外に表す方だ"
  },
  {
    "id": "Q021",
    "code": "E05",
    "domain": "PERSONALITY",
    "axis": "E",
    "direction": -1,
    "responseMode": "self",
    "text": "人が集まる場では、できるだけ目立たない位置にいたい"
  },
  {
    "id": "Q022",
    "code": "E06",
    "domain": "PERSONALITY",
    "axis": "E",
    "direction": -1,
    "responseMode": "self",
    "text": "多くの人と長く関わると、かなり疲れやすい"
  },
  {
    "id": "Q023",
    "code": "E07",
    "domain": "PERSONALITY",
    "axis": "E",
    "direction": -1,
    "responseMode": "self",
    "text": "会話では、自分から話題を始めるより相手が話すのを待つことが多い"
  },
  {
    "id": "Q024",
    "code": "E08",
    "domain": "PERSONALITY",
    "axis": "E",
    "direction": -1,
    "responseMode": "self",
    "text": "にぎやかな集まりより、一人か少人数で静かに過ごす方を選びやすい"
  },
  {
    "id": "Q025",
    "code": "A01",
    "domain": "PERSONALITY",
    "axis": "A",
    "direction": 1,
    "responseMode": "self",
    "text": "意見が違う相手でも、まずその人の立場を理解しようとする"
  },
  {
    "id": "Q026",
    "code": "A02",
    "domain": "PERSONALITY",
    "axis": "A",
    "direction": 1,
    "responseMode": "self",
    "text": "身近な人が困っていると、できる範囲で力になりたいと思う"
  },
  {
    "id": "Q027",
    "code": "A03",
    "domain": "PERSONALITY",
    "axis": "A",
    "direction": 1,
    "responseMode": "self",
    "text": "対立したときは、双方が納得できる着地点を探そうとする"
  },
  {
    "id": "Q028",
    "code": "A04",
    "domain": "PERSONALITY",
    "axis": "A",
    "direction": 1,
    "responseMode": "self",
    "text": "誰かが傷ついている様子を見ると、その人の気持ちが気になる"
  },
  {
    "id": "Q029",
    "code": "A05",
    "domain": "PERSONALITY",
    "axis": "A",
    "direction": -1,
    "responseMode": "self",
    "text": "腹が立つと、相手がどう感じるかより自分の言いたいことを優先しやすい"
  },
  {
    "id": "Q030",
    "code": "A06",
    "domain": "PERSONALITY",
    "axis": "A",
    "direction": -1,
    "responseMode": "self",
    "text": "他人の悩みは、自分に関係がなければあまり気にならない"
  },
  {
    "id": "Q031",
    "code": "A07",
    "domain": "PERSONALITY",
    "axis": "A",
    "direction": -1,
    "responseMode": "self",
    "text": "人の失敗や欠点を、なかなか許せないことがある"
  },
  {
    "id": "Q032",
    "code": "A08",
    "domain": "PERSONALITY",
    "axis": "A",
    "direction": -1,
    "responseMode": "self",
    "text": "相手との関係が悪くなっても、自分の主張を通す方を優先することがある"
  },
  {
    "id": "Q033",
    "code": "N01",
    "domain": "PERSONALITY",
    "axis": "N",
    "direction": 1,
    "responseMode": "self",
    "text": "一度気になったことを、あとまで何度も考えてしまう"
  },
  {
    "id": "Q034",
    "code": "N02",
    "domain": "PERSONALITY",
    "axis": "N",
    "direction": 1,
    "responseMode": "self",
    "text": "予想していなかったことが起こると、不安が強くなりやすい"
  },
  {
    "id": "Q035",
    "code": "N03",
    "domain": "PERSONALITY",
    "axis": "N",
    "direction": 1,
    "responseMode": "self",
    "text": "人から批判されたことを、長く引きずることがある"
  },
  {
    "id": "Q036",
    "code": "N04",
    "domain": "PERSONALITY",
    "axis": "N",
    "direction": 1,
    "responseMode": "self",
    "text": "小さな出来事でも、気分が大きく揺れることがある"
  },
  {
    "id": "Q037",
    "code": "N05",
    "domain": "PERSONALITY",
    "axis": "N",
    "direction": -1,
    "responseMode": "self",
    "text": "プレッシャーがかかっても、比較的落ち着いて対応できる"
  },
  {
    "id": "Q038",
    "code": "N06",
    "domain": "PERSONALITY",
    "axis": "N",
    "direction": -1,
    "responseMode": "self",
    "text": "嫌なことがあっても、気持ちを切り替えるのは比較的早い"
  },
  {
    "id": "Q039",
    "code": "N07",
    "domain": "PERSONALITY",
    "axis": "N",
    "direction": -1,
    "responseMode": "self",
    "text": "急な変化があっても、必要以上に動揺しない方だ"
  },
  {
    "id": "Q040",
    "code": "N08",
    "domain": "PERSONALITY",
    "axis": "N",
    "direction": -1,
    "responseMode": "self",
    "text": "先が読めない状況でも、気持ちは比較的安定している"
  },
  {
    "id": "Q041",
    "code": "S01",
    "domain": "STYLE",
    "axis": "AGY",
    "direction": 1,
    "responseMode": "self",
    "text": "方向が決まっていないとき、自分から方針を提案することが多い"
  },
  {
    "id": "Q042",
    "code": "S02",
    "domain": "STYLE",
    "axis": "AGY",
    "direction": 1,
    "responseMode": "self",
    "text": "誰かが決める必要がある場面では、自分が判断役を引き受けられる"
  },
  {
    "id": "Q043",
    "code": "S03",
    "domain": "STYLE",
    "axis": "AGY",
    "direction": 1,
    "responseMode": "self",
    "text": "周囲と意見が違っても、必要なら自分の考えをはっきり示す"
  },
  {
    "id": "Q044",
    "code": "S04",
    "domain": "STYLE",
    "axis": "AGY",
    "direction": 1,
    "responseMode": "self",
    "text": "状況をより良くするために、自分から働きかける方だ"
  },
  {
    "id": "Q045",
    "code": "S05",
    "domain": "STYLE",
    "axis": "AGY",
    "direction": -1,
    "responseMode": "self",
    "text": "重要なことでも、できれば他の人に決めてもらいたい"
  },
  {
    "id": "Q046",
    "code": "S06",
    "domain": "STYLE",
    "axis": "AGY",
    "direction": -1,
    "responseMode": "self",
    "text": "主導する立場になると、できるだけ誰かに任せたくなる"
  },
  {
    "id": "Q047",
    "code": "S07",
    "domain": "STYLE",
    "axis": "REL",
    "direction": 1,
    "responseMode": "self",
    "text": "一緒に動く相手に合わせて、進め方やタイミングを調整できる"
  },
  {
    "id": "Q048",
    "code": "S08",
    "domain": "STYLE",
    "axis": "REL",
    "direction": 1,
    "responseMode": "self",
    "text": "複数人で取り組むときは、認識がずれていないか確かめながら進める"
  },
  {
    "id": "Q049",
    "code": "S09",
    "domain": "STYLE",
    "axis": "REL",
    "direction": 1,
    "responseMode": "self",
    "text": "役割の境目が曖昧なときは、互いに動きやすい形を話し合おうとする"
  },
  {
    "id": "Q050",
    "code": "S10",
    "domain": "STYLE",
    "axis": "REL",
    "direction": 1,
    "responseMode": "self",
    "text": "自分のやり方だけでなく、相手が動きやすい方法も考える"
  },
  {
    "id": "Q051",
    "code": "S11",
    "domain": "STYLE",
    "axis": "REL",
    "direction": -1,
    "responseMode": "self",
    "text": "周囲と調整が必要でも、自分のやり方を変えずに進めることが多い"
  },
  {
    "id": "Q052",
    "code": "S12",
    "domain": "STYLE",
    "axis": "REL",
    "direction": -1,
    "responseMode": "self",
    "text": "人と歩調を合わせながら進めることを、面倒に感じることが多い"
  },
  {
    "id": "Q053",
    "code": "S13",
    "domain": "STYLE",
    "axis": "ROL",
    "direction": 1,
    "responseMode": "self",
    "text": "自分が担っている役割を誰かが必要としているなら、目立たなくても支え続けようとする"
  },
  {
    "id": "Q054",
    "code": "S14",
    "domain": "STYLE",
    "axis": "ROL",
    "direction": 1,
    "responseMode": "self",
    "text": "自分が抜けると周囲に影響が出る役割なら、多少大変でも簡単には離れない"
  },
  {
    "id": "Q055",
    "code": "S15",
    "domain": "STYLE",
    "axis": "ROL",
    "direction": 1,
    "responseMode": "self",
    "text": "誰かと分担している役割では、自分の都合だけで一方的に途中離脱しない"
  },
  {
    "id": "Q056",
    "code": "S16",
    "domain": "STYLE",
    "axis": "ROL",
    "direction": 1,
    "responseMode": "self",
    "text": "表に出ない役割でも、集団を支える役目を続けることに意味を感じられる"
  },
  {
    "id": "Q057",
    "code": "S17",
    "domain": "STYLE",
    "axis": "ROL",
    "direction": -1,
    "responseMode": "self",
    "text": "興味が薄れると、周囲から必要とされている役割でも続ける意欲が下がりやすい"
  },
  {
    "id": "Q058",
    "code": "S18",
    "domain": "STYLE",
    "axis": "ROL",
    "direction": -1,
    "responseMode": "self",
    "text": "役割の負担が大きくなると、周囲への影響よりも自分がその役割を離れることを優先したくなる"
  },
  {
    "id": "Q059",
    "code": "S19",
    "domain": "STYLE",
    "axis": "REF",
    "direction": 1,
    "responseMode": "self",
    "text": "行動に移る前に、一度状況を整理して考えたい"
  },
  {
    "id": "Q060",
    "code": "S20",
    "domain": "STYLE",
    "axis": "REF",
    "direction": 1,
    "responseMode": "self",
    "text": "複雑なことは、言葉や図、仕組みに置き換えると理解しやすい"
  },
  {
    "id": "Q061",
    "code": "S21",
    "domain": "STYLE",
    "axis": "REF",
    "direction": 1,
    "responseMode": "self",
    "text": "問題が起きたとき、まず全体像や原因のつながりを考える"
  },
  {
    "id": "Q062",
    "code": "S22",
    "domain": "STYLE",
    "axis": "REF",
    "direction": 1,
    "responseMode": "self",
    "text": "問題に対応するときは、方法や仕組みを工夫して解決しようとすることが多い"
  },
  {
    "id": "Q063",
    "code": "S23",
    "domain": "STYLE",
    "axis": "REF",
    "direction": -1,
    "responseMode": "self",
    "text": "考えるより先に動き、走りながら考える方が自分に合っている"
  },
  {
    "id": "Q064",
    "code": "S24",
    "domain": "STYLE",
    "axis": "REF",
    "direction": -1,
    "responseMode": "self",
    "text": "自分の考えを整理して形にする作業は、できれば省きたい"
  },
  {
    "id": "Q065",
    "code": "S25",
    "domain": "STYLE",
    "axis": "AUT",
    "direction": 1,
    "responseMode": "self",
    "text": "周囲の期待があっても、最終的には自分の判断で選びたい"
  },
  {
    "id": "Q066",
    "code": "S26",
    "domain": "STYLE",
    "axis": "AUT",
    "direction": 1,
    "responseMode": "self",
    "text": "自分で決められる余地がある方が、力を発揮しやすい"
  },
  {
    "id": "Q067",
    "code": "S27",
    "domain": "STYLE",
    "axis": "AUT",
    "direction": 1,
    "responseMode": "self",
    "text": "周囲の意見が強くても、それだけに流されず自分の判断を保ちやすい"
  },
  {
    "id": "Q068",
    "code": "S28",
    "domain": "STYLE",
    "axis": "AUT",
    "direction": 1,
    "responseMode": "self",
    "text": "親しい相手との間でも、自分のための境界や時間を保ちたい"
  },
  {
    "id": "Q069",
    "code": "S29",
    "domain": "STYLE",
    "axis": "AUT",
    "direction": -1,
    "responseMode": "self",
    "text": "大事な判断では、周囲から賛成されないと決めにくい"
  },
  {
    "id": "Q070",
    "code": "S30",
    "domain": "STYLE",
    "axis": "AUT",
    "direction": -1,
    "responseMode": "self",
    "text": "集団の期待と自分の考えを切り分けるのが難しいことが多い"
  },
  {
    "id": "Q071",
    "code": "V01",
    "domain": "VALUES",
    "axis": "SD",
    "direction": 1,
    "responseMode": "portrait",
    "text": "この人は、自分の生き方や進み方を自分で選べることを大切にしている"
  },
  {
    "id": "Q072",
    "code": "V02",
    "domain": "VALUES",
    "axis": "SD",
    "direction": 1,
    "responseMode": "portrait",
    "text": "この人は、周囲と違っていても自分の考えを持つことを大切にしている"
  },
  {
    "id": "Q073",
    "code": "V03",
    "domain": "VALUES",
    "axis": "SD",
    "direction": 1,
    "responseMode": "portrait",
    "text": "この人は、決められたやり方に従うだけでなく、自分なりの方法を考えることを大切にしている"
  },
  {
    "id": "Q074",
    "code": "V04",
    "domain": "VALUES",
    "axis": "ST",
    "direction": 1,
    "responseMode": "portrait",
    "text": "この人は、新しい経験や変化のある毎日に価値を感じている"
  },
  {
    "id": "Q075",
    "code": "V05",
    "domain": "VALUES",
    "axis": "ST",
    "direction": 1,
    "responseMode": "portrait",
    "text": "この人は、少し難しくても未知のことに挑戦できる方が魅力的だと感じている"
  },
  {
    "id": "Q076",
    "code": "V06",
    "domain": "VALUES",
    "axis": "ST",
    "direction": 1,
    "responseMode": "portrait",
    "text": "この人は、同じことの繰り返しより刺激や変化のある生活を大切にしている"
  },
  {
    "id": "Q077",
    "code": "V07",
    "domain": "VALUES",
    "axis": "HE",
    "direction": 1,
    "responseMode": "portrait",
    "text": "この人は、人生の中で楽しさや心地よさを十分に味わうことを大切にしている"
  },
  {
    "id": "Q078",
    "code": "V08",
    "domain": "VALUES",
    "axis": "HE",
    "direction": 1,
    "responseMode": "portrait",
    "text": "この人は、自分が楽しいと感じられる時間をきちんと確保することを大切にしている"
  },
  {
    "id": "Q079",
    "code": "V09",
    "domain": "VALUES",
    "axis": "HE",
    "direction": 1,
    "responseMode": "portrait",
    "text": "この人は、我慢ばかりするより今の生活を楽しむことに価値を置いている"
  },
  {
    "id": "Q080",
    "code": "V10",
    "domain": "VALUES",
    "axis": "AC",
    "direction": 1,
    "responseMode": "portrait",
    "text": "この人は、自分の能力を発揮し、成果を形にすることを大切にしている"
  },
  {
    "id": "Q081",
    "code": "V11",
    "domain": "VALUES",
    "axis": "AC",
    "direction": 1,
    "responseMode": "portrait",
    "text": "この人は、努力したことが達成や成功として表れることを大切にしている"
  },
  {
    "id": "Q082",
    "code": "V12",
    "domain": "VALUES",
    "axis": "AC",
    "direction": 1,
    "responseMode": "portrait",
    "text": "この人は、自分の能力が周囲から認められることに価値を感じている"
  },
  {
    "id": "Q083",
    "code": "V13",
    "domain": "VALUES",
    "axis": "PO",
    "direction": 1,
    "responseMode": "portrait",
    "text": "この人は、重要な意思決定に影響を与えられる立場を持つことを大切にしている"
  },
  {
    "id": "Q084",
    "code": "V14",
    "domain": "VALUES",
    "axis": "PO",
    "direction": 1,
    "responseMode": "portrait",
    "text": "この人は、必要な資源を動かせる権限を持つことに価値を感じている"
  },
  {
    "id": "Q085",
    "code": "V15",
    "domain": "VALUES",
    "axis": "PO",
    "direction": 1,
    "responseMode": "portrait",
    "text": "この人は、社会的に影響力のある立場を得ることを大切にしている"
  },
  {
    "id": "Q086",
    "code": "V16",
    "domain": "VALUES",
    "axis": "SE",
    "direction": 1,
    "responseMode": "portrait",
    "text": "この人は、安心して暮らせる安定した環境を大切にしている"
  },
  {
    "id": "Q087",
    "code": "V17",
    "domain": "VALUES",
    "axis": "SE",
    "direction": 1,
    "responseMode": "portrait",
    "text": "この人は、先の見通しが立ち、大きな危険が少ない状態に価値を感じている"
  },
  {
    "id": "Q088",
    "code": "V18",
    "domain": "VALUES",
    "axis": "SE",
    "direction": 1,
    "responseMode": "portrait",
    "text": "この人は、自分や身近な人の安全が守られることを優先している"
  },
  {
    "id": "Q089",
    "code": "V19",
    "domain": "VALUES",
    "axis": "CO",
    "direction": 1,
    "responseMode": "portrait",
    "text": "この人は、周囲に大きな迷惑をかけないよう、自分の行動を抑えることを大切にしている"
  },
  {
    "id": "Q090",
    "code": "V20",
    "domain": "VALUES",
    "axis": "CO",
    "direction": 1,
    "responseMode": "portrait",
    "text": "この人は、社会で共有されている基本的なルールに従うことを大切にしている"
  },
  {
    "id": "Q091",
    "code": "V21",
    "domain": "VALUES",
    "axis": "CO",
    "direction": 1,
    "responseMode": "portrait",
    "text": "この人は、自分のしたいことでも周囲を傷つけるなら控えることを大切にしている"
  },
  {
    "id": "Q092",
    "code": "V22",
    "domain": "VALUES",
    "axis": "TR",
    "direction": 1,
    "responseMode": "portrait",
    "text": "この人は、長く受け継がれてきた習慣や文化を尊重することを大切にしている"
  },
  {
    "id": "Q093",
    "code": "V23",
    "domain": "VALUES",
    "axis": "TR",
    "direction": 1,
    "responseMode": "portrait",
    "text": "この人は、自分が属する社会や集団の伝統を簡単には手放したくないと考えている"
  },
  {
    "id": "Q094",
    "code": "V24",
    "domain": "VALUES",
    "axis": "TR",
    "direction": 1,
    "responseMode": "portrait",
    "text": "この人は、過去から受け継がれてきたものを次につなぐことに意味を感じている"
  },
  {
    "id": "Q095",
    "code": "V25",
    "domain": "VALUES",
    "axis": "BE",
    "direction": 1,
    "responseMode": "portrait",
    "text": "この人は、身近な人が幸せに暮らせることを大切にしている"
  },
  {
    "id": "Q096",
    "code": "V26",
    "domain": "VALUES",
    "axis": "BE",
    "direction": 1,
    "responseMode": "portrait",
    "text": "この人は、信頼している人が困っているとき、できるだけ力になることを大切にしている"
  },
  {
    "id": "Q097",
    "code": "V27",
    "domain": "VALUES",
    "axis": "BE",
    "direction": 1,
    "responseMode": "portrait",
    "text": "この人は、近しい人との信頼関係を守り続けることを大切にしている"
  },
  {
    "id": "Q098",
    "code": "V28",
    "domain": "VALUES",
    "axis": "UN",
    "direction": 1,
    "responseMode": "portrait",
    "text": "この人は、立場や背景にかかわらず人が公平に扱われることを大切にしている"
  },
  {
    "id": "Q099",
    "code": "V29",
    "domain": "VALUES",
    "axis": "UN",
    "direction": 1,
    "responseMode": "portrait",
    "text": "この人は、自分と異なる生き方や考え方の人もできるだけ理解することを大切にしている"
  },
  {
    "id": "Q100",
    "code": "V30",
    "domain": "VALUES",
    "axis": "UN",
    "direction": 1,
    "responseMode": "portrait",
    "text": "この人は、自然環境が守られることを大切にしている"
  }
];

if (typeof module !== "undefined" && module.exports) {
  module.exports = { ETI_V2_META, ETI_V2_QUESTIONS };
}
