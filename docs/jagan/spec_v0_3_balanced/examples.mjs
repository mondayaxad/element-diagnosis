import {writeFileSync} from 'node:fs';
import {judge,items} from './runtime.mjs';
const cases=[['敵意が高め',{HOS:4},'pierro'],['衝動・敵意が低め、冷淡はさらに低め',{IMP:2,CAL:1,HOS:2},'capitano'],['操作と冷淡',{MAN:5,CAL:5},'dottore'],['敵意・冷淡が低く、衝動は中程度',{HOS:1,CAL:1,IMP:3},'columbina'],['誘導が中程度、敵意は低い',{MAN:3,HOS:1,WDR:1,RSK:1},'arlecchino'],['誘導が高め',{MAN:4},'pulcinella'],['強い敵意と不信',{HOS:5,SUS:5},'scaramouche'],['対人距離と敵意',{WDR:5,HOS:4},'sandrone'],['敵意・誘導・冷淡',{HOS:5,MAN:4,CAL:4},'signora'],['誘導がさらに強い',{MAN:5},'pantalone'],['危険への接近',{RSK:5},'tartaglia'],['分離不安だけが高い',{SEP:5},null]];
const arr=cases.map(([name,profile,expected])=>{const answers=Object.fromEntries(items.items.map(i=>[i.id,profile[i.trait]??2]));const result=judge(answers);return {name,profile,expected,answers,headline:result.headline,character:result.character,semanticCheck:result.character?.id===expected||(!result.character&&expected===null)};});
writeFileSync(new URL('./examples.json',import.meta.url),JSON.stringify(arr,null,2)+'\n');
let md='# 代表回答による動作確認\n\n全て人工的な例。指定しない特性は全問2。実在の利用者やキャラクターの正解ラベルではない。\n\n| 例 | 邪眼×異相 | 人物参照 | 対応確認 |\n|---|---|---|---|\n';
for(const a of arr)md+=`| ${a.name} | ${a.headline} | ${a.character?`${a.character.name}（${a.character.match}%）`:'判定保留'} | ${a.semanticCheck?'想定どおり':'要再検討'} |\n`;
md+='\nこれらは設計上の想定を確認する回帰用の例であり、当該人物にこの心理特性があると証明するものではない。例えばカピターノの例でも「献身が測れた」とは説明しない。\n';writeFileSync(new URL('./EXAMPLES.md',import.meta.url),md);console.log(md);
