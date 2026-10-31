'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),R=require('../lib/research-engine'),P=require('../plugins/research-engine');
test('KERN contains separate cybercrime and all three luxury pillars',()=>{const ids=R.PROFILES.kern.clusters.map(x=>x[0]);assert.ok(ids.some(x=>x.includes('Cybercrime')));assert.ok(ids.some(x=>x.includes('Logistics')));assert.ok(ids.some(x=>x.includes('Industry')));assert.ok(ids.some(x=>x.includes('Wealth')))});
test('MUSHII has African story clusters and separate profile',()=>{assert.equal(R.PROFILES.mushii.clusters.length,5);assert.notEqual(R.PROFILES.kern.clusters.length,R.PROFILES.mushii.clusters.length)});
test('median handles odd and even sets',()=>{assert.equal(R.median([1,2,3]),2);assert.equal(R.median([1,2,3,4]),2.5)});
test('commands are owner-only and private-chat-only',()=>{assert.deepEqual(P.commands,['kern','mushii']);assert.equal(P.permission,'owner');assert.equal(P.group,false);assert.equal(P.private,true)});
test('CSV quotes fields and neutralizes formulas',()=>{const out=R.csv({name:'KERN',top:[{title:'=SUM(1,1)',score:4,url:'https://example.com'}]});assert.match(out,/"'=SUM\(1,1\)"/)});

test('research plugin delivers owner replies through the current private LID-safe sender',async()=>{const sent=[];const ctx={command:'kern',isOwner:true,isGroup:false,jid:'123456789@lid',safeSend:async content=>{sent.push(content)}};await P.run({}, {}, ['help'], ctx);assert.equal(sent.length,1);assert.match(sent[0].text,/\\*KERN\\*/);assert.equal(sent[0].text.includes('.kern scan'),true)});
test('research plugin refuses non-owner and group contexts',async()=>{const ctx={command:'kern',isOwner:false,isGroup:false,jid:'123456789@lid',safeSend:async()=>{throw Error('must not send')}};await assert.rejects(()=>P.run({}, {}, ['help'], ctx),/owner in a private chat/);});
