import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { OWNER, counters, hash } from './usage-session.mjs';

export const statusLabels = {
  pending: '等待主代理回合結束', observing: '正在確認資料完整與穩定',
  'observed-complete': '已觀察回合完成且用量穩定', incomplete: '資料未完整',
  interrupted: '執行回合中止', unsupported: '目前環境不支援自動收集', failed: '用量收集程序失敗',
};
const roleLabel = role => ({ orchestrator: 'Orchestrator', analyzer: 'Analyzer', writer: 'Writer', executor: 'Executor', reviewer: 'Reviewer', cleanup: '前置清理（Executor）' }[role] ?? '未歸屬代理');

export function statusExplanation(status) {
  if (['pending', 'observing'].includes(status)) return '主代理回合結束後，背景程序會更新本頁。已開啟的頁面可重新整理。';
  if (status === 'observed-complete') return '本次已觀察用量收集完成。';
  if (status === 'unsupported') return '未啟動背景收集程序；重新整理不會恢復收集。錯誤原因保留於 report.json。';
  return '背景收集已停止；重新整理不會恢復收集。已保留可取得的資料與診斷。';
}

export function usageRows(snapshot, rootThreadId) {
  const requests = snapshot?.summary?.selectedRequests ?? [];
  const ids = [...new Set([rootThreadId, ...Object.keys(snapshot?.roles ?? {}), ...requests.map(r => r.threadId)])].filter(Boolean);
  const make = (threadId, values) => {
    const totals = Object.fromEntries(counters.map(k => [k, values.length && values.every(r => Number.isSafeInteger(r.usage?.[k])) ? values.reduce((n, r) => n + r.usage[k], 0) : null]));
    const turns = [...new Set(values.map(r => r.turnId))];
    const settings = (snapshot?.settings ?? []).filter(s => (threadId === null || s.threadId === threadId) && turns.includes(s.turnId));
    return { threadId, role: threadId === null ? 'total' : threadId === rootThreadId ? 'orchestrator' : snapshot?.roles?.[threadId] ?? null,
      label: threadId === null ? '總計' : roleLabel(threadId === rootThreadId ? 'orchestrator' : snapshot?.roles?.[threadId]),
      requests: values.length, turns: turns.length, uncached: totals.input_tokens !== null && totals.cached_input_tokens !== null ? totals.input_tokens - totals.cached_input_tokens : null,
      cached: totals.cached_input_tokens, output: totals.output_tokens, total: totals.total_tokens,
      models: [...new Set(settings.map(s => s.model ?? null))], reasoningEfforts: [...new Set(settings.map(s => s.effort ?? null))], serviceTiers: [...new Set(settings.map(s => s.serviceTier ?? null))] };
  };
  return [...ids.map(id => make(id, requests.filter(r => r.threadId === id))), make(null, requests)];
}

function dashboardRows(summary, agentPaths = {}, roles = {}) {
  const groups = new Map();
  for (const id of Object.keys(roles)) groups.set(id, []);
  for (const request of summary.selectedRequests) {
    if (!groups.has(request.threadId)) groups.set(request.threadId, []);
    groups.get(request.threadId).push(request);
  }
  const row = (label, requests, threadId = null) => {
    const sum = field => requests.length && requests.every(r => Number.isSafeInteger(r.usage?.[field]))
      ? requests.reduce((n, r) => n + r.usage[field], 0) : null;
    const input = sum('input_tokens'), cached = sum('cached_input_tokens');
    return { label, threadId, uncached: input !== null && cached !== null && input >= cached ? input - cached : null,
      cached, output: sum('output_tokens'), total: sum('total_tokens'), requests: requests.length };
  };
  return [...[...groups].sort(([a], [b]) => a === summary.rootThreadId ? -1 : b === summary.rootThreadId ? 1 : a.localeCompare(b))
    .map(([id, requests]) => row(id === summary.rootThreadId ? '主代理' : `子代理 ${agentPaths[id] || id}`, requests, id)),
    row('整個 workflow 合計', summary.selectedRequests)];
}

function dashboardCreditGroups(snapshot) {
  const groups = new Map();
  for (const request of snapshot.summary.selectedRequests) {
    const context = snapshot.requestSettings?.find(s => s.responseId === request.responseId);
    const settings = { model: context?.model ?? null, effort: context?.effort ?? null, serviceTier: context?.serviceTier ?? null };
    const key = JSON.stringify([request.threadId, settings]);
    if (!groups.has(key)) groups.set(key, { settings, requests: [] });
    groups.get(key).requests.push(request);
  }
  return [...groups.values()].map(group => ({
    ...dashboardRows({ ...snapshot.summary, selectedRequests: group.requests }, snapshot.agentPaths)[0],
    ...group.settings, settingsSource: 'runtime turn_context',
  }));
}

export function dashboardState(report) {
  const complete = report.measurementStatus === 'observed-complete';
  const waiting = ['pending', 'observing'].includes(report.measurementStatus);
  const message = complete
    ? '本次 workflow 回合已完成，連續三次觀測用量一致。這是 runtime 觀測值，非帳戶實際扣抵。'
    : waiting ? `正在等待 workflow 用量收尾…${statusExplanation(report.measurementStatus)}`
      : `用量尚未確認完整，不提供 credit 合計。${statusExplanation(report.measurementStatus)}${report.diagnostics.join('；')}${report.diagnosticDetails?.length ? JSON.stringify(report.diagnosticDetails) : ''}`;
  return { done: !waiting, updatedAt: report.updatedAtUtc, outcome: report.workflowTerminalDecision || null, message,
    usageRows: report.displayRows ?? report.rows.map(row => ({
      label: row.role === 'total' ? '整個 workflow 合計' : row.role === 'orchestrator' ? '主代理' : `子代理 ${row.threadId}`,
      threadId: row.threadId, uncached: row.uncached, cached: row.cached, output: row.output, total: row.total, requests: row.requests,
    })), creditGroups: complete ? report.creditGroups ?? [] : [], measurementStatus: report.measurementStatus };
}

export function makeReport(binding, { status, snapshot = null, diagnostics = [], diagnosticDetails = [], stableSamples = 0, observer = null, now = new Date().toISOString() }) {
  if (!Object.hasOwn(statusLabels, status)) throw new Error('未知的用量報告狀態');
  if (status === 'observed-complete' && (!snapshot?.ready || stableSamples < 3)) throw new Error('完整報告需要完整資料與三次穩定快照');
  return { schemaVersion: 1, workflow: OWNER, runIdentifier: binding.runIdentifier, measurementStatus: status, updatedAtUtc: now,
    label: statusLabels[status], source: 'token_usage_record.usage', scope: snapshot?.scope ?? binding.scope ?? null, stableSamples, observer,
    continuationEvidence: snapshot?.continuationEvidence ?? [], taskErrors: snapshot?.taskErrors ?? [],
    workflowTerminalDecision: snapshot?.terminalDecision ?? null, diagnostics, diagnosticDetails, lookup: snapshot?.lookup ?? null,
    rows: usageRows(snapshot, binding.scope?.rootThreadId),
    displayRows: snapshot ? dashboardRows(snapshot.summary, snapshot.agentPaths, snapshot.roles) : [],
    creditGroups: status === 'observed-complete' ? dashboardCreditGroups(snapshot) : [],
    usage: status === 'observed-complete' ? snapshot.summary.observedTotals : null,
    snapshot: snapshot?.summary ?? null,
    limitations: ['範圍為明確 root turn 與 run-state 記錄的角色；同一 root turn 混入其他工作時無法分離。',
      '總 tokens 包含快取輸入；推理 tokens 已包含於輸出，不重複加總。',
      '資料來自 Codex 內部逐請求紀錄；回合完成與快照穩定不保證未落盤資料已全部到齊。',
      '缺漏用量顯示尚未取得；選用 credit 換算不是帳戶實際扣抵，不取代測試結果或 run-state 計時。'] };
}

// Pinned complete dashboard template; exact reference SHA-256:
// 80ebd13e326c72e5c927298a3db56e46acdde410e5c7b1fa64a62e64fdbe382c
const dashboardTemplate = [
  "<!doctype html>",
  "<html lang=\"zh-Hant\"><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">",
  "<title>Codex workflow token 用量</title>",
  "<style>body{font:17px/1.7 system-ui,sans-serif;max-width:850px;margin:48px auto;padding:0 24px;color:#172b40;background:#f5f7fa}main{padding:28px;background:white;border-radius:14px}h1{font-size:26px}td,th{text-align:left;padding:8px 20px 8px 0;border-bottom:1px solid #ddd}#message{font-weight:bold;color:#174c77}small{color:#526274}code{background:#eee;padding:2px 5px}li{margin:8px 0}</style>",
  "<main><h1>Codex：本次 workflow 用量</h1>",
  "<p id=\"message\">正在等待 workflow 用量收尾…</p>",
  "<ol id=\"instructions\" hidden></ol>",
  "<p>測試流程結果：<strong id=\"outcome\">尚未完成</strong></p>",
  "<p>統計範圍：本次 workflow 的主代理與子代理。總量包含快取。</p><div style=\"overflow-x:auto\"><table><tr><th>代理範圍</th><th>未快取輸入</th><th>快取輸入</th><th>輸出</th><th>總量（含快取）</th><th>請求數</th></tr><tbody id=\"values\"></tbody></table></div>",
  "<p><small>總量 = 未快取輸入 + 快取輸入 + 輸出。推理用量已包含在輸出，不重複加總。這是 runtime 觀測快照，不是帳單。CLI 的退出摘要只列主代理，且 total 不含另外列出的 cached；不可直接與整個 workflow 總量比較。</small></p>",
  "<details id=\"credit-panel\"><summary>選用：依 Standard 官方費率換算 credit</summary>",
  "<p>適用於 ChatGPT token-based credits；API key 與舊制企業方案不適用。結果為公開費率換算，不代表帳戶實際扣抵。</p>",
  "<p>官方費率查核日期：2026-10-07。<a href=\"https://learn.chatgpt.com/docs/pricing\">官方費率</a>。本頁保留此版本費率。GPT-5.6 Sol 促銷費率官方註明至少適用至 2026-11-21。</p>",
  "<p>公式：credits =（未快取輸入 × 輸入費率 + 快取輸入 × 快取費率 + 輸出 × 輸出費率）÷ 1,000,000。推理強度不另乘倍率。</p>",
  "<div id=\"credit-settings\"></div><button id=\"credit-standard\">按 Standard 模式換算</button>",
  "<p>服務模式缺漏時，結果會明確標示為 Standard 前提試算，不把缺值改寫成已記錄的 Standard。</p>",
  "<div id=\"credit-details\"></div><p id=\"credit-result\" role=\"status\">尚未換算。</p>",
  "<small>計算在前端完成，不呼叫模型。設定來源為當次 runtime 紀錄；未知模型不套用其他模型費率。</small></details>",
  "<p id=\"updated\"></p></main>",
  "<script>",
  "let timer, latestGroups=[], creditActive=false;",
  "const officialRates={'gpt-6-astra':[250,25,1250],'gpt-6.1-sol':[50,2.5,250],'gpt-6-sol':[50,5,250],'gpt-6-luna':[2.5,0.25,12.5],'gpt-5.6-sol':[100,10,500],'gpt-5.6-terra':[50,5,300],'gpt-5.6-luna':[5,0.5,30],'gpt-5.5':[125,12.5,750],'gpt-5.4':[62.5,6.25,375],'gpt-5.4-mini':[18.75,1.875,113]};",
  "const el=id=>document.getElementById('credit-'+id);",
  "const ratesFor=model=>Object.hasOwn(officialRates,model)?officialRates[model]:null;",
  "function quoteCredit(row){",
  " const rates=ratesFor(row.model);if(!rates)throw Error('沒有已查核的模型費率：'+(row.model||'未知'));",
  " if(row.serviceTier&&!['standard','default'].includes(row.serviceTier))throw Error('當次記錄不是 Standard 模式：'+row.serviceTier);",
  " if(['uncached','cached','output'].some(k=>!Number.isSafeInteger(row[k])||row[k]<0))throw Error('用量資料缺漏');",
  " const value=(row.uncached*rates[0]+row.cached*rates[1]+row.output*rates[2])/1000000;",
  " if(!Number.isFinite(value)||value>Number.MAX_SAFE_INTEGER)throw Error('換算超出支援範圍');",
  " return {value,conditional:!row.serviceTier,formula:`(${row.uncached} × ${rates[0]} + ${row.cached} × ${rates[1]} + ${row.output} × ${rates[2]}) ÷ 1,000,000`};",
  "}",
  "function updateCredit(){",
  " el('settings').replaceChildren();",
  " for(const r of latestGroups){const p=document.createElement('p');p.textContent=`${r.label}：${r.model||'模型未知'}／推理強度 ${r.effort||'未記錄'}／服務模式 ${r.serviceTier||'未記錄'}。來源：runtime turn_context。每百萬 tokens 官方費率（輸入／快取／輸出）：${ratesFor(r.model)?.join('／')||'未收錄'} credits。`;el('settings').append(p);}",
  " if(!creditActive)return;",
  " let total=0,missing=0,conditional=false;el('details').replaceChildren();",
  " for(const r of latestGroups){const p=document.createElement('p');try{const q=quoteCredit(r);total+=q.value;conditional ||= q.conditional;p.textContent=`${r.label}：${q.formula} = ${q.value.toLocaleString(undefined,{maximumSignificantDigits:12})} credits${q.conditional?'（服務模式缺漏，按 Standard 前提試算）':''}`;}catch(e){missing++;p.textContent=r.label+'：無法換算，'+e.message;}el('details').append(p);}",
  " el('result').textContent=missing||!latestGroups.length?'無法提供 workflow Standard credits 合計：設定、費率或用量有缺漏。':`${conditional?'Standard 前提試算合計':'Standard 模式換算合計'}：${total.toLocaleString(undefined,{maximumSignificantDigits:12})} credits（顯示值經四捨五入，非帳戶實際扣抵）。`;",
  "}",
  "el('standard').onclick=()=>{creditActive=true;updateCredit();};",
  "function render(s){",
  "latestGroups=s.creditGroups||[];updateCredit();",
  "document.getElementById('message').textContent=s.message;",
  "document.getElementById('outcome').textContent=s.outcome||'尚未完成';",
  "const body=document.getElementById('values');body.replaceChildren();",
  "for(const row of s.usageRows||[]){const tr=document.createElement('tr');for(const value of [row.label,row.uncached,row.cached,row.output,row.total,row.requests]){const td=document.createElement('td');td.textContent=typeof value==='string'?value:Number.isSafeInteger(value)?value.toLocaleString():'尚未取得';tr.append(td)}body.append(tr)}",
  "document.getElementById('instructions').hidden=Boolean(s.done);",
  "document.getElementById('updated').textContent='更新時間：'+(s.updatedAt||'');if(s.done)clearInterval(timer);}",
  "async function refresh(){try{const r=await fetch('/status',{cache:'no-store'});if(!r.ok)throw Error();render(await r.json());}",
  "catch{document.getElementById('updated').textContent='無法即時更新；若這是本機檔案，請在 workflow 最後回覆完成後稍候並重新整理。'}}",
  "if(window.acceptanceSnapshot){render(window.acceptanceSnapshot);}else{timer=setInterval(refresh,1500);refresh();}",
  "</script></html>",
  ""
].join('\r\n');

export function renderHtml(report) {
  const state = dashboardState(report);
  return dashboardTemplate.replace('<script>', `<script>window.acceptanceSnapshot=${JSON.stringify(state).replaceAll('<', '\\u003c')};</script><script>`);
}

export function atomicWrite(file, value) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  fs.writeFileSync(temporary, typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
  fs.renameSync(temporary, file);
}

export function writeReport(directory, binding, options) {
  const report = makeReport(binding, options);
  const html = renderHtml(report);
  atomicWrite(path.join(directory, 'report.json'), report);
  atomicWrite(path.join(directory, 'report.html'), html);
  atomicWrite(path.join(directory, 'status.json'), { measurementStatus: report.measurementStatus, label: report.label,
    updatedAtUtc: report.updatedAtUtc, stableSamples: report.stableSamples, diagnostics: report.diagnostics,
    observer: report.observer, diagnosticDetails: report.diagnosticDetails, lookup: report.lookup,
    htmlSha256: hash(html), reportSha256: hash(JSON.stringify(report, null, 2) + '\n') });
  return report;
}

export function reportLink(directory, status) {
  const htmlPath = path.resolve(directory, 'report.html');
  if (!fs.statSync(htmlPath).isFile()) throw new Error('HTML 報告不存在');
  return { htmlPath, fileUrl: pathToFileURL(htmlPath).href, status: status.measurementStatus, label: status.label,
    markdown: [
      `[HTML token-usage report](<${htmlPath.replaceAll('\\', '/')}>)`,
      '', '絕對路徑：', '', '```text', htmlPath, '```',
    ].join('\n'),
    note: statusExplanation(status.measurementStatus) };
}
