// eti_mini_choices_provisional.js — 元素診断 Mini の3問の選択肢（【仮の文言】）。
//
// ・文言は Claude Code による仮案（Phase A の画面確認用）。最終文は ChatGPT が本家の定義に合わせて確定し、この表を差し替える
//   （docs/eti-mini/handoff_v1/README_Claude_実装指示書.md §5-2）。
// ・意味の拠り所は index.html の ELEMENT_DESC / WEAPON_DESC / NATION_DESC（本家の説明）。新しい定義は作らない。
// ・value は内部キー（元素・武器・国家の名前）。表示順は位置ではなく value で保存する。
// ・元素・武器種・国家の名前を文中に出さない（tests/eti_mini.test.js で確認）。表示順は意図的に本家の並びと変えた固定順。
(function (root) {
  'use strict';
  var CHOICES = {
    version: 'ETI-MINI-CHOICES-0.1.0-provisional',
    provisional: true,
    questions: [
      {
        id: 'q1', axis: 'element',
        title: 'あなたの気質にいちばん近いのは？',
        options: [
          { value: '岩', title: 'どっしりと支える', text: '派手さより確実さを選び、引き受けたことは最後までやり遂げる。' },
          { value: '雷', title: '自分のルールを貫く', text: '強い信念があり、停滞するくらいなら型を壊してでも前へ進む。' },
          { value: '水', title: '場に合わせて形を変える', text: '誰といても浮かずにいられるが、本心はあまり見せない。' },
          { value: '草', title: '知って、分かち合う', text: '物事を理解すること自体が喜びで、それを誰かの役に立てたくなる。' },
          { value: '炎', title: '先に体が動く', text: 'やるべきだと思ったら考えるより先に動き出し、周りも巻き込んでいく。' },
          { value: '氷', title: '内側で深く感じ取る', text: '一歩引いて観察し、選んだ少数の相手とだけ深くつながる。' },
          { value: '風', title: 'ひとつに縛られない', text: '新しい見方や可能性を探し続け、同じ場所に長くは留まらない。' },
        ],
      },
      {
        id: 'q2', axis: 'weapon',
        title: '人や物事との関わり方は？',
        options: [
          { value: '長柄', title: '持ち場を守り抜く', text: '前に出て目立つより、自分の役目を果たして全体を円滑に回す。' },
          { value: '法器', title: '一歩引いて本質を読む', text: '直接ぶつかるより、考えや仕組みを通して物事に働きかける。' },
          { value: '片手剣', title: '相手に合わせて力を出す', text: '一人で完結するより、誰かと支え合う中で本領を発揮する。' },
          { value: '弓', title: '距離を保って狙いすます', text: '選択肢を広く持ちながら、ここぞという一点に集中を注ぐ。' },
          { value: '両手剣', title: '自分の力で道をひらく', text: '人に頼るより自分で結果を出したい。困難なほど力が湧く。' },
        ],
      },
      {
        id: 'q3', axis: 'nation',
        title: 'いちばん大切にしたいものは？',
        options: [
          { value: 'スメール', title: '本当のことを知る', text: '物事の真実を突き詰め、得た知識を独り占めせずに分かち合う。' },
          { value: 'ナタ', title: '正面からぶつかる熱さ', text: '困難から逃げず、仲間と壁を越えるときに生きている実感がある。' },
          { value: '璃月', title: '交わした約束と成果', text: '約束を守り、目に見える成果を一つずつ積み上げていきたい。' },
          { value: 'ナドクライ', title: '静かな場所で、自分のままに', text: '表舞台から離れ、人に知られずとも自分の価値観を保ち続ける。' },
          { value: 'フォンテーヌ', title: '誰にとっても公平であること', text: 'ひいきを嫌い、誰から見ても筋の通った判断を選びたい。' },
          { value: 'モンド', title: '自分で選ぶ自由', text: '誰にも縛られず、自分の意志で選び取ることを何より大切にする。' },
          { value: 'スネージナヤ', title: '痛みを引き受けてでも守る', text: '大切なもののためなら、厳しい決断も自分が背負う。' },
          { value: '稲妻', title: '変わらずに続くもの', text: '受け継がれてきたものや秩序を守り、簡単には揺らがない。' },
        ],
      },
    ],
  };
  root.ETI_MINI_CHOICES = CHOICES;
  if (typeof module !== 'undefined' && module.exports) module.exports = CHOICES;
})(typeof window !== 'undefined' ? window : globalThis);
