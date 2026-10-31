'use strict';
const { CreatorEngine } = require('../lib/creator/engine');
let engine;
function getEngine() { if (!engine) engine = new CreatorEngine(); return engine; }
function fmtNumber(value) { return Number(value || 0).toLocaleString('en-US'); }
function fmtScore(value) { return Number.isFinite(Number(value)) ? Number(value).toFixed(1) : 'N/A'; }
function formatOpportunity(item, index) {
 const outlier = item.outlierMultiple === null ? 'baseline unavailable' : item.outlierMultiple + 'x channel median';
 return [(index + 1) + '. *' + item.title + '*','Channel: ' + (item.channelTitle || 'Unknown'),
 'Views: ' + fmtNumber(item.viewCount) + ' | Score: *' + fmtScore(item.score) + '/100*',
 'Performance: ' + outlier + (item.channelMedian ? ' (' + fmtNumber(item.channelMedian) + ' median)' : ''),
 'Pillar: ' + (item.pillar || 'Unclassified'),item.url].join('\n');
}
function formatIdeas(result) {
 if (!result.opportunities.length) return result.status === 'not-scanned' ? 'No KERN scan yet. Run `.kern scan` first.' : 'No opportunities saved in the latest scan. Try `.kern scan` again.';
 return ['*KERN — TOP OPPORTUNITIES*',result.createdAt ? 'Last scan: ' + result.createdAt : '','',...result.opportunities.map(formatOpportunity)].filter(Boolean).join('\n\n');
}
async function run(sock,message,args,ctx) {
 if (!ctx.isOwner) return ctx.reply('⛔ KERN research commands are owner-only.');
 if (ctx.isGroup) return ctx.reply('🔒 Please use KERN in a private chat with the bot.');
 const action=(args.shift()||'help').toLowerCase(); const topic=args.join(' ').trim();
 if(action==='help') return ctx.reply(['*KERN CREATOR INTELLIGENCE*','`.kern scan` — discover documentary opportunities across KERN pillars','`.kern scan <topic>` — scan one focused topic','`.kern ideas` — show the latest ranked opportunities','`.kern analyze <YouTube URL>` — analyze a specific video','`.kern report` — export latest report as CSV','`.kern quota` — show remaining free API allowance','','KERN does research and opportunity analysis only; it does not write scripts.'].join('\n'));
 const creator=getEngine();
 if(action==='quota') return ctx.reply('*CREATOR STUDIO FREE QUOTA*\n'+JSON.stringify(creator.getQuotaStatus(),null,2));
 if(action==='ideas') return ctx.reply(formatIdeas(await creator.getIdeas('kern',8)));
 if(action==='scan') {
  await ctx.reply('🔎 KERN yatangiye gushakisha kuri YouTube, kugereranya channels no kugenzura inkuru. Ndagusubiza nirangira.');
  creator.scan('kern',{topic}).then(result=>ctx.reply(['*KERN SCAN COMPLETE*','Search calls: '+result.searchCalls,'Videos discovered: '+result.discoveredCount,'Long-form videos analyzed: '+result.analyzedCount,'Channels baselined: '+result.baselineChannels,'',formatIdeas({opportunities:result.opportunities.slice(0,6),status:'completed'})].join('\n'))).catch(error=>ctx.reply('⚠️ KERN scan failed: '+error.message));
  return;
 }
 if(action==='analyze') {
  if(!topic) return ctx.reply('Usage: `.kern analyze <YouTube URL>`');
  await ctx.reply('🔬 Analyzing the video and comparing it with the channel’s recent uploads...');
  creator.analyzeVideo(topic).then(item=>ctx.reply(['*KERN VIDEO ANALYSIS*','*'+item.title+'*','Channel: '+item.channelTitle,'Views: '+fmtNumber(item.viewCount),'Opportunity score: *'+fmtScore(item.score)+'/100*','Outlier multiple: '+(item.outlierMultiple===null?'Not available':item.outlierMultiple+'x'),'Channel median: '+(item.channelMedian===null?'Not enough comparable uploads':fmtNumber(item.channelMedian)),'Story signals: '+item.storyStrengthScore+'/20','','Video: '+item.url,'','Evidence links:',...(item.evidence||[]).slice(0,5).map(source=>'• '+source.title+' — '+source.url)].join('\n'))).catch(error=>ctx.reply('⚠️ KERN analysis failed: '+error.message));
  return;
 }
 if(action==='report') {
  const ideas=await creator.getIdeas('kern',40);
  if(!ideas.opportunities.length) return ctx.reply('No KERN report yet. Run `.kern scan` first.');
  return ctx.safeSend({document:creator.exportKernCsv(),mimetype:'text/csv',fileName:'kern-opportunities.csv',caption:'KERN opportunity report — '+ideas.opportunities.length+' videos'});
 }
 return ctx.reply('Unknown KERN action. Send `.kern help` to see commands.');
}
module.exports={commands:['kern'],description:'KERN documentary research and opportunity intelligence',usage:'.kern scan | ideas | analyze <url> | report | quota',permission:'owner',group:false,private:true,run,__test:{formatIdeas,formatOpportunity,getEngine}};
