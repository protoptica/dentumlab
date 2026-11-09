import test from 'node:test';
import assert from 'node:assert/strict';
import {matchingMaterials} from '../src/material-matching';
import type {Material} from '../src/domain';
test('material suggestions follow the line name and preserve existing selection',()=>{
const materials=[{id:'disc',name:'Диск Bloomden PMMA 98 mm 16 A3'},{id:'tea',name:'Чай Greenfield 100 шт'},{id:'implant',name:'Абатмент Osstem'}] as Material[];
assert.deepEqual(matchingMaterials(materials,'Диск Bloomden PMMA 98 mm 16 A2',null).map(m=>m.id),['disc']);
assert.deepEqual(matchingMaterials(materials,'',null),[]);
assert.deepEqual(matchingMaterials(materials,'','tea').map(m=>m.id),['tea']);
});
