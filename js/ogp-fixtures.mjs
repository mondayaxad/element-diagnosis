// js/ogp-fixtures.mjs
// OGP確認用の7元素fixture（デモ・検証専用。本番のOGP生成では使わない）。
// ETIコード＝元素コード＋武器コード、タイプ名は api/og-image.mjs の TYPE_NAME と同じ組み合わせ。
// 一致度は色分け（getMatchStyle）の4段階が全部見えるよう散らしてある。
export const OGP_FIXTURES = {
  pyro:    { code: 'PYPL', typeName: '殉衛者', element: '炎', weapon: '長柄',   nation: '璃月',   mirrorName: '胡桃',     match: 82 },
  hydro:   { code: 'HYSW', typeName: '同調者', element: '水', weapon: '片手剣', nation: 'スメール', mirrorName: 'ニィロウ', match: 77 },
  electro: { code: 'ELCT', typeName: '電導者', element: '雷', weapon: '法器',   nation: '稲妻',   mirrorName: '八重神子', match: 91 },
  cryo:    { code: 'CRBW', typeName: '凍眼者', element: '氷', weapon: '弓',     nation: '璃月',   mirrorName: '甘雨',     match: 74 },
  anemo:   { code: 'ANCT', typeName: '漂識者', element: '風', weapon: '法器',   nation: 'スメール', mirrorName: '放浪者',   match: 68 },
  dendro:  { code: 'DECT', typeName: '叡結者', element: '草', weapon: '法器',   nation: 'スメール', mirrorName: 'ナヒーダ', match: 85 },
  geo:     { code: 'GEPL', typeName: '護衛者', element: '岩', weapon: '長柄',   nation: '璃月',   mirrorName: '鍾離',     match: 79 },
};
export const OGP_FIXTURE_ORDER = ['pyro', 'hydro', 'electro', 'cryo', 'anemo', 'dendro', 'geo'];
