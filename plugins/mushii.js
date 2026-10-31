'use strict';
const { CreatorEngine } = require('../lib/creator/engine');
let engine;
function getEngine(){if(!engine)engine=new CreatorEngine();return engine;}
function formatIdeas(result){
 if(!result.opportunities.length)return result.status==='not-scanned'?'Nta bushakashatsi bwa MUSHII burakorwa. Banza wohereze `.mushii scan`.':'Nta mahirwe yabonetse muri scan iheruka. Ongera ugerageze `.mushii scan`.';
 return ['*MUSHII — INGINGO ZISHOBORA GUKORWAHO VIDEO*',result.createdAt?'Scan iheruka: '+result.createdAt:'','',...result.opportunities.map((item,index)=>[(index+1)+'. *'+item.title+'*','Channel: '+(item.channelTitle||'Ntizwi'),'Views: '+Number(item.viewCount||0).toLocaleString('en-US')+' | Score: '+Number(item.score||0).toFixed(1)+'/100',item.url].join('\n'))].filter(Boolean).join('\n\n');
}
async function sendLongText(ctx,text,limit=3500){
 const chunks=[];let remaining=String(text||'');
 while(remaining.length>limit){let splitAt=remaining.lastIndexOf('\n',limit);if(splitAt<limit*0.5)splitAt=limit;chunks.push(remaining.slice(0,splitAt));remaining=remaining.slice(splitAt).replace(/^\n+/,'');}
 if(remaining)chunks.push(remaining);for(const chunk of chunks)await ctx.reply(chunk);
}
async function run(sock,message,args,ctx){
 if(!ctx.isOwner)return ctx.reply('⛔ MUSHII Creator Studio ni iya nyiri bot.');
 if(ctx.isGroup)return ctx.reply('🔒 Koresha MUSHII Creator Studio muri private chat na bot.');
 const action=(args.shift()||'help').toLowerCase();const topic=args.join(' ').trim();
 if(action==='help')return ctx.reply(['*MUSHII CREATOR STUDIO*','`.mushii scan` — shakisha inkuru n’amahirwe kuri YouTube','`.mushii scan <topic>` — shakisha ingingo runaka','`.mushii ideas` — reba amahirwe yabonetse muri scan iheruka','`.mushii script <topic>` — kora narration yuzuye mu Kinyarwanda (iminota 7–9, ntirenze 10)','`.mushii quota` — reba quota zisigaye','','MUSHII itanga amagambo yo kuvuga gusa. Ntiyandika Flow prompts cyangwa production instructions.'].join('\n'));
 const creator=getEngine();
 if(action==='quota')return ctx.reply('*CREATOR STUDIO FREE QUOTA*\n'+JSON.stringify(creator.getQuotaStatus(),null,2));
 if(action==='ideas')return ctx.reply(formatIdeas(await creator.getIdeas('mushii',8)));
 if(action==='scan'){
  await ctx.reply('🔎 MUSHII irimo gushakisha ingingo kuri YouTube no kugereranya uko video zarebwe. Ndagusubiza nirangira...');
  creator.scan('mushii',{topic}).then(result=>ctx.reply(['*MUSHII SCAN IRARANGIYE*','Search calls: '+result.searchCalls,'Video zabonetse: '+result.discoveredCount,'Long-form videos zasuzumwe: '+result.analyzedCount,'',formatIdeas({opportunities:result.opportunities.slice(0,6),status:'completed'})].join('\n'))).catch(error=>ctx.reply('⚠️ MUSHII scan ntiyagenze neza: '+error.message));
  return;
 }
 if(action==='script'){
  if(topic.length<8)return ctx.reply('Andika ingingo isobanutse. Urugero: `.mushii script amateka y’Ubwami bwa Bunyoro`');
  await ctx.reply('✍️ MUSHII iri kugenzura amakuru no kwandika narration mu Kinyarwanda. Ndagusubiza nirangira...');
  creator.generateMushiiScript(topic).then(async result=>{await sendLongText(ctx,result.script);await ctx.reply('✅ Narration irarangiye. Amagambo: '+result.wordCount+'.\n\n*Inkomoko zakoreshejwe (ntizisomwa muri narration):*\n'+result.sources.slice(0,8).map(source=>'• '+source.title+'\n'+source.url).join('\n'));}).catch(error=>ctx.reply('⚠️ MUSHII script ntiyagenze neza: '+error.message));
  return;
 }
 return ctx.reply('Icyo usabye ntikizwi. Ohereza `.mushii help` urebe commands.');
}
module.exports={commands:['mushii'],description:'MUSHII Kinyarwanda documentary research and narration',usage:'.mushii scan | ideas | script <topic> | quota',permission:'owner',group:false,private:true,run,__test:{formatIdeas,sendLongText,getEngine}};
