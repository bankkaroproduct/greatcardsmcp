// Quick script to call MCP tools for fuel card content
const BASE = 'https://bk-api.bankkaro.com/mcp';

async function mcpCall(sessionId, method, params, id) {
  const body = { jsonrpc: '2.0', method, params, id };
  const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' };
  if (sessionId) headers['Mcp-Session-Id'] = sessionId;
  
  const res = await fetch(BASE, { method: 'POST', headers, body: JSON.stringify(body) });
  const text = await res.text();
  const sid = res.headers.get('mcp-session-id');
  
  // Parse SSE response
  const lines = text.split('\n');
  for (const line of lines) {
    if (line.startsWith('data: ')) {
      try { return { data: JSON.parse(line.slice(6)), sessionId: sid }; } catch {}
    }
  }
  return { data: text, sessionId: sid };
}

async function callTool(sessionId, toolName, args, id) {
  return mcpCall(sessionId, 'tools/call', { name: toolName, arguments: args }, id);
}

async function main() {
  console.log('=== Initializing MCP session ===');
  const init = await mcpCall(null, 'initialize', {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: 'fuel-content-writer', version: '1.0.0' }
  }, 1);
  const sid = init.sessionId;
  console.log('Session:', sid?.slice(0, 8) + '...');

  // 1. List fuel cards
  console.log('\n=== LIST FUEL CARDS ===');
  const listResult = await callTool(sid, 'list_cards', {
    category: 'best-fuel-credit-card',
    response_format: 'full',
    limit: 15
  }, 2);
  const listText = JSON.parse(listResult.data?.result?.content?.[0]?.text || '{}');
  console.log(JSON.stringify(listText, null, 2));

  // 2. Recommend at ₹5K/month fuel
  console.log('\n=== RECOMMEND @ ₹5K FUEL ===');
  const rec5k = await callTool(sid, 'recommend_cards', {
    fuel: 5000,
    top_n: 5,
    response_format: 'comparison'
  }, 3);
  const rec5kText = JSON.parse(rec5k.data?.result?.content?.[0]?.text || '{}');
  console.log(JSON.stringify(rec5kText, null, 2));

  // 3. Recommend at ₹10K/month fuel  
  console.log('\n=== RECOMMEND @ ₹10K FUEL ===');
  const rec10k = await callTool(sid, 'recommend_cards', {
    fuel: 10000,
    top_n: 5,
    response_format: 'comparison'
  }, 4);
  const rec10kText = JSON.parse(rec10k.data?.result?.content?.[0]?.text || '{}');
  console.log(JSON.stringify(rec10kText, null, 2));

  // 4. Recommend at ₹15K/month fuel
  console.log('\n=== RECOMMEND @ ₹15K FUEL ===');
  const rec15k = await callTool(sid, 'recommend_cards', {
    fuel: 15000,
    top_n: 5,
    response_format: 'comparison'
  }, 5);
  const rec15kText = JSON.parse(rec15k.data?.result?.content?.[0]?.text || '{}');
  console.log(JSON.stringify(rec15kText, null, 2));

  // 5. Recommend at ₹20K/month fuel (heavy spender)
  console.log('\n=== RECOMMEND @ ₹20K FUEL ===');
  const rec20k = await callTool(sid, 'recommend_cards', {
    fuel: 20000,
    top_n: 5,
    response_format: 'comparison'
  }, 6);
  const rec20kText = JSON.parse(rec20k.data?.result?.content?.[0]?.text || '{}');
  console.log(JSON.stringify(rec20kText, null, 2));
}

main().catch(console.error);
