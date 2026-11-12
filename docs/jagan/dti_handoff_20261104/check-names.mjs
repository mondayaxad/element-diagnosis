import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const read=n=>JSON.parse(readFileSync(new URL(n,import.meta.url),'utf8'));
const d=read('./dti-types.json'),a=read('./NAME_COLLISION_AUDIT.json');
const names=d.patterns.map(x=>x.name),codes=d.patterns.map(x=>x.code);
assert.equal(names.length,84);assert.equal(new Set(names).size,84);assert.equal(new Set(codes).size,84);
assert(names.every(x=>/^[\p{Script=Han}]{3}$/u.test(x)));
assert(codes.every(x=>/^[A-Z]{4}$/.test(x)));
assert(!names.some(x=>a.eti_names.includes(x)));assert(!codes.some(x=>a.eti_codes.includes(x)));
for(const p of d.patterns){assert.equal(p.code,p.element_id+p.aspect_code);assert(d.aspects.some(x=>x.trait_id===p.trait_id&&x.code===p.aspect_code));assert(d.elements.some(x=>x.id===p.element_id));}
console.log('PASS: 84 unique three-kanji names / four-letter codes; no collisions with provided ETI baseline. Recheck current repository at integration.');
