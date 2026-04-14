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
    clientInfo: { name: 'formula-verify', version: '1.0.0' }
  }, 1);
  const sid = init.sessionId;
  console.log('Session:', sid?.slice(0, 8));

  // ============================================================
  // TEST 1: SBI Cashback - 5% on Amazon
  // Manual calc: ₹5,000 Amazon/mo * 5% = ₹250/mo = ₹3,000/yr rewards
  // Annual fee: ₹999 + GST = ₹1,179
  // Expected net (correct formula): 3,000 - 1,179 = ₹1,821
  // ============================================================
  console.log('\n=== TEST 1: SBI Cashback @ ₹5K Amazon ===');
  const t1 = await mcpCall(sid, 'tools/call', {
    name: 'recommend_cards',
    arguments: { amazon_spends: 5000, top_n: 10, response_format: 'comparison' }
  }, 10);
  const t1data = JSON.parse(t1.data?.result?.content?.[0]?.text || '{}');
  const sbiCashback = (t1data.recommendations || []).find(r => r.card_name?.toLowerCase().includes('sbi') && r.card_name?.toLowerCase().includes('cashback'));
  if (sbiCashback) {
    console.log('  Found:', sbiCashback.card_name);
    console.log('  annual_rewards (from API):', sbiCashback.annual_rewards);
    console.log('  milestone_benefits:', sbiCashback.milestone_benefits);
    console.log('  lounge_value:', sbiCashback.lounge_value);
    console.log('  joining_fee:', sbiCashback.joining_fee);
    console.log('  annual_fee:', sbiCashback.annual_fee);
    console.log('  net_annual_savings (MCP - subtracts both fees):', sbiCashback.net_annual_savings);
    console.log('  CORRECT net (rewards + milestones - annual_fee only):', sbiCashback.annual_rewards + sbiCashback.milestone_benefits - sbiCashback.annual_fee);
    console.log('  Manual calc: 5000*0.05*12 = 3000, minus fee ~1179 = ~1821');
  } else {
    console.log('  SBI Cashback not in top 10. Listing all:');
    (t1data.recommendations || []).forEach(r => console.log(`    ${r.card_name}: rewards=${r.annual_rewards} join=${r.joining_fee} annual=${r.annual_fee} net=${r.net_annual_savings}`));
  }

  // ============================================================
  // TEST 2: ICICI Amazon Pay - 5% on Amazon (Prime), 3% on Amazon (non-Prime)
  // Manual calc: ₹5,000 Amazon/mo * 5% = ₹250/mo = ₹3,000/yr 
  // Annual fee: ₹500 + GST = ₹590
  // Expected net: 3,000 - 590 = ₹2,410
  // ============================================================
  console.log('\n=== TEST 2: ICICI Amazon Pay @ ₹5K Amazon ===');
  const iciciAmazon = (t1data.recommendations || []).find(r => r.card_name?.toLowerCase().includes('amazon'));
  if (iciciAmazon) {
    console.log('  Found:', iciciAmazon.card_name);
    console.log('  annual_rewards:', iciciAmazon.annual_rewards);
    console.log('  joining_fee:', iciciAmazon.joining_fee);
    console.log('  annual_fee:', iciciAmazon.annual_fee);
    console.log('  net (MCP):', iciciAmazon.net_annual_savings);
    console.log('  CORRECT net (- annual_fee only):', iciciAmazon.annual_rewards + iciciAmazon.milestone_benefits - iciciAmazon.annual_fee);
  }

  // ============================================================
  // TEST 3: Get FULL response for SBI Cashback to see raw API fields
  // ============================================================
  console.log('\n=== TEST 3: SBI Cashback FULL recommend response ===');
  const t3 = await mcpCall(sid, 'tools/call', {
    name: 'recommend_cards',
    arguments: { amazon_spends: 5000, top_n: 10, response_format: 'full' }
  }, 11);
  const t3data = JSON.parse(t3.data?.result?.content?.[0]?.text || '{}');
  const sbiCashbackFull = (t3data.recommendations || []).find(r => r.card_name?.toLowerCase().includes('sbi') && r.card_name?.toLowerCase().includes('cashback'));
  if (sbiCashbackFull) {
    console.log('  card_name:', sbiCashbackFull.card_name);
    console.log('  net_annual_savings:', sbiCashbackFull.net_annual_savings);
    console.log('  annual_rewards_value:', sbiCashbackFull.annual_rewards_value);
    console.log('  milestone_benefits:', sbiCashbackFull.milestone_benefits);
    console.log('  lounge_value:', sbiCashbackFull.lounge_value);
    console.log('  joining_fee:', sbiCashbackFull.joining_fee);
    console.log('  annual_fee:', sbiCashbackFull.annual_fee);
    console.log('  spending_breakdown:', JSON.stringify(sbiCashbackFull.spending_breakdown, null, 2));
  }

  // ============================================================
  // TEST 4: Card details for SBI Cashback - check for active flag
  // ============================================================
  console.log('\n=== TEST 4: SBI Cashback card details (checking for active/status flag) ===');
  const t4 = await mcpCall(sid, 'tools/call', {
    name: 'get_card_details',
    arguments: { card_alias: 'sbi-cashback-credit-card' }
  }, 12);
  const t4data = JSON.parse(t4.data?.result?.content?.[0]?.text || '{}');
  // Print ALL top-level keys to find any status/active flag
  console.log('  Top-level keys:', Object.keys(t4data));
  console.log('  name:', t4data.name);
  console.log('  fees:', JSON.stringify(t4data.fees));
  console.log('  tags:', t4data.tags);

  // ============================================================
  // TEST 5: Get raw card listing to look for active/status flags in API response
  // ============================================================
  console.log('\n=== TEST 5: list_cards brief - checking all returned fields ===');
  const t5 = await mcpCall(sid, 'tools/call', {
    name: 'list_cards',
    arguments: { category: 'best-shopping-credit-card', limit: 3, response_format: 'full' }
  }, 13);
  const t5data = JSON.parse(t5.data?.result?.content?.[0]?.text || '{}');
  if (t5data.cards?.[0]) {
    console.log('  First card all keys:', Object.keys(t5data.cards[0]));
    console.log('  First card:', JSON.stringify(t5data.cards[0], null, 2));
  }

  // ============================================================
  // TEST 6: Flipkart Axis @ ₹5K Flipkart - 5% cashback, no fee
  // Manual: 5000 * 0.05 * 12 = ₹3,000, fee = 0
  // Expected net: ₹3,000
  // ============================================================
  console.log('\n=== TEST 6: Flipkart spends ₹5K - looking for Axis Flipkart ===');
  const t6 = await mcpCall(sid, 'tools/call', {
    name: 'recommend_cards',
    arguments: { flipkart_spends: 5000, top_n: 10, response_format: 'comparison' }
  }, 14);
  const t6data = JSON.parse(t6.data?.result?.content?.[0]?.text || '{}');
  const flipkartAxis = (t6data.recommendations || []).find(r => r.card_name?.toLowerCase().includes('flipkart'));
  if (flipkartAxis) {
    console.log('  Found:', flipkartAxis.card_name);
    console.log('  annual_rewards:', flipkartAxis.annual_rewards);
    console.log('  joining_fee:', flipkartAxis.joining_fee);
    console.log('  annual_fee:', flipkartAxis.annual_fee);
    console.log('  net (MCP):', flipkartAxis.net_annual_savings);
    console.log('  CORRECT net:', flipkartAxis.annual_rewards + flipkartAxis.milestone_benefits - flipkartAxis.annual_fee);
    console.log('  Manual: 5000*0.05*12=3000, fee=0?, expected=3000');
  } else {
    console.log('  Flipkart card not found. All results:');
    (t6data.recommendations || []).forEach(r => console.log(`    ${r.card_name}: rewards=${r.annual_rewards} join=${r.joining_fee} annual=${r.annual_fee} net=${r.net_annual_savings}`));
  }

  // ============================================================
  // TEST 7: HDFC Swiggy @ ₹5K food delivery - checking partnership benefit
  // ============================================================
  console.log('\n=== TEST 7: Food delivery ₹5K - HDFC Swiggy ===');
  const t7 = await mcpCall(sid, 'tools/call', {
    name: 'recommend_cards',
    arguments: { online_food_ordering: 5000, top_n: 10, response_format: 'comparison' }
  }, 15);
  const t7data = JSON.parse(t7.data?.result?.content?.[0]?.text || '{}');
  (t7data.recommendations || []).slice(0, 5).forEach(r => {
    console.log(`  ${r.card_name}: rewards=${r.annual_rewards} milestones=${r.milestone_benefits} join=${r.joining_fee} annual=${r.annual_fee} net_mcp=${r.net_annual_savings} net_correct=${r.annual_rewards + r.milestone_benefits - r.annual_fee}`);
  });

  // ============================================================
  // TEST 8: Full recommend response to see spending_breakdown with brands
  // ============================================================
  console.log('\n=== TEST 8: Full response with spending_breakdown (brands object) ===');
  const t8 = await mcpCall(sid, 'tools/call', {
    name: 'recommend_cards',
    arguments: { amazon_spends: 5000, flipkart_spends: 3000, online_food_ordering: 3000, top_n: 3, response_format: 'full' }
  }, 16);
  const t8data = JSON.parse(t8.data?.result?.content?.[0]?.text || '{}');
  if (t8data.recommendations?.[0]) {
    const card = t8data.recommendations[0];
    console.log('  #1 Card:', card.card_name);
    console.log('  spending_breakdown:', JSON.stringify(card.spending_breakdown, null, 2));
  }
}

main().catch(console.error);
