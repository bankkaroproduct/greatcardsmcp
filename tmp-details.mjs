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
  const init = await mcpCall(null, 'initialize', {
    protocolVersion: '2025-03-26', capabilities: {},
    clientInfo: { name: 'detail-check', version: '1.0.0' }
  }, 1);
  const sid = init.sessionId;

  // Get details for top 3 fuel cards
  const cards = [
    'kotak-indianoil-platinum-credit-card',
    'indian-oil-rbl-bank-xtra-credit-card',
    'idfc-power-plus-credit-card',
    'sbi-bpcl-credit-card'
  ];

  for (let i = 0; i < cards.length; i++) {
    const result = await mcpCall(sid, 'tools/call', {
      name: 'get_card_details',
      arguments: { card_alias: cards[i] }
    }, i + 10);
    
    const parsed = JSON.parse(result.data?.result?.content?.[0]?.text || '{}');
    console.log(`\n${'='.repeat(60)}`);
    console.log(`CARD: ${parsed.name}`);
    console.log(`BANK: ${parsed.bank}`);
    console.log(`FEES: joining=${parsed.fees?.joining}  annual=${parsed.fees?.annual}`);
    console.log(`WAIVER: ${parsed.fees?.annual_fee_waiver || 'none'}`);
    console.log(`\nKEY BENEFITS:`);
    (parsed.key_benefits || []).forEach(b => console.log(`  - ${b.title}: ${b.description}`));
    console.log(`\nDETAILED BENEFITS:`);
    (parsed.detailed_benefits || []).forEach(b => console.log(`  [${b.type}/${b.sub_type}] ${(b.details || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200)}`));
    console.log(`\nTAGS: ${(parsed.tags || []).join(', ')}`);
  }
}

main().catch(console.error);
