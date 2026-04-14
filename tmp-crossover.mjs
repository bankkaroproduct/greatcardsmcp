const BASE = 'https://bk-api.bankkaro.com/mcp';

async function mcpCall(sessionId, method, params, id) {
  const body = { jsonrpc: '2.0', method, params, id };
  const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' };
  if (sessionId) headers['Mcp-Session-Id'] = sessionId;
  const res = await fetch(BASE, { method: 'POST', headers, body: JSON.stringify(body) });
  const text = await res.text();
  const sid = res.headers.get('mcp-session-id');
  for (const line of text.split('\n')) {
    if (line.startsWith('data: ')) {
      try { return { data: JSON.parse(line.slice(6)), sessionId: sid }; } catch {}
    }
  }
  return { data: text, sessionId: sid };
}

async function main() {
  // Init session
  const init = await mcpCall(null, 'initialize', {
    protocolVersion: '2025-03-26', capabilities: {},
    clientInfo: { name: 'crossover-check', version: '1.0.0' }
  }, 1);
  const sid = init.sessionId;
  console.log('Session:', sid?.slice(0, 8));

  const spendLevels = [3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000, 12000, 15000];
  
  for (let i = 0; i < spendLevels.length; i++) {
    const fuel = spendLevels[i];
    const result = await mcpCall(sid, 'tools/call', {
      name: 'recommend_cards',
      arguments: { fuel, top_n: 5, response_format: 'comparison' }
    }, i + 10);
    
    const parsed = JSON.parse(result.data?.result?.content?.[0]?.text || '{}');
    const recs = parsed.recommendations || [];
    
    console.log(`\n=== FUEL: ${fuel}/mo ===`);
    recs.forEach(r => {
      console.log(`  #${r.rank} ${r.card_name.padEnd(42)} net=${r.net_annual_savings}  rewards=${r.annual_rewards}  fee=${r.joining_fee + r.annual_fee}`);
    });
  }
}

main().catch(console.error);
