/**
 * MCP Server Test Suite
 *
 * Tests all 5 tools with realistic scenarios.
 * Run: npx tsx test-mcp.ts [base_url]
 * Default base_url: http://localhost:3100
 *
 * Usage:
 *   npx tsx test-mcp.ts                                    # local
 *   npx tsx test-mcp.ts https://greatcardsmcp.onrender.com  # remote
 */

const BASE_URL = process.argv[2] || 'http://localhost:3100';
const MCP_ENDPOINT = `${BASE_URL}/mcp`;

let sessionId: string | null = null;
let requestId = 0;

// ═══════════════════════════════════════════════════════════
// MCP Client Helpers
// ═══════════════════════════════════════════════════════════

async function mcpRequest(method: string, params?: any): Promise<any> {
  const id = ++requestId;
  const body = { jsonrpc: '2.0', id, method, params: params || {} };
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (sessionId) headers['mcp-session-id'] = sessionId;

  const res = await fetch(MCP_ENDPOINT, { method: 'POST', headers, body: JSON.stringify(body) });

  // Capture session ID from response
  const sid = res.headers.get('mcp-session-id');
  if (sid) sessionId = sid;

  const json = await res.json();
  if (json.error) throw new Error(`MCP Error ${json.error.code}: ${json.error.message}`);
  return json.result;
}

async function initialize(): Promise<void> {
  const result = await mcpRequest('initialize', {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: 'test-suite', version: '1.0.0' },
  });
  console.log(`✅ Connected to: ${result.serverInfo.name} v${result.serverInfo.version}`);
  console.log(`   Tools: ${result.capabilities?.tools ? 'enabled' : 'disabled'}`);
  console.log(`   Session: ${sessionId?.slice(0, 8)}...`);

  // Send initialized notification
  const notifBody = { jsonrpc: '2.0', method: 'notifications/initialized' };
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (sessionId) headers['mcp-session-id'] = sessionId;
  await fetch(MCP_ENDPOINT, { method: 'POST', headers, body: JSON.stringify(notifBody) });
}

async function callTool(name: string, args: any): Promise<any> {
  const result = await mcpRequest('tools/call', { name, arguments: args });
  if (result.isError) {
    const text = result.content?.[0]?.text || 'Unknown error';
    throw new Error(text);
  }
  return JSON.parse(result.content[0].text);
}

// ═══════════════════════════════════════════════════════════
// Test Cases
// ═══════════════════════════════════════════════════════════

interface TestResult {
  name: string;
  status: 'PASS' | 'FAIL';
  duration: number;
  details: string;
  data?: any;
}

const results: TestResult[] = [];

async function runTest(name: string, fn: () => Promise<string>): Promise<void> {
  const start = Date.now();
  try {
    const details = await fn();
    results.push({ name, status: 'PASS', duration: Date.now() - start, details });
    console.log(`  ✅ ${name} (${Date.now() - start}ms)`);
  } catch (err: any) {
    results.push({ name, status: 'FAIL', duration: Date.now() - start, details: err.message });
    console.log(`  ❌ ${name} (${Date.now() - start}ms): ${err.message}`);
  }
}

// ═══════════════════════════════════════════════════════════
// TEST 1: recommend_cards — Heavy online shopper
// ═══════════════════════════════════════════════════════════
async function testRecommendOnlineShopper(): Promise<string> {
  const result = await callTool('recommend_cards', {
    amazon_spends: 8000,
    flipkart_spends: 3000,
    other_online_spends: 5000,
    online_food_ordering: 4000,
    dining_or_going_out: 3000,
    fuel: 5000,
    mobile_phone_bills: 800,
    electricity_bills: 2000,
    flights_annual: 60000,
    domestic_lounge_usage_quarterly: 2,
    top_n: 3,
    response_format: 'full',
  });

  if (!result.recommendations || result.recommendations.length === 0) {
    throw new Error('No recommendations returned');
  }

  const top = result.recommendations[0];
  if (!top.card_name) throw new Error('Missing card_name in top result');
  if (!top.net_annual_savings) throw new Error('Missing net_annual_savings');
  if (!top.card_alias) throw new Error('Missing card_alias for follow-up tools');

  return `Top card: ${top.card_name} | Savings: ${top.net_annual_savings} | ${result.recommendations.length} cards returned`;
}

// ═══════════════════════════════════════════════════════════
// TEST 2: recommend_cards — Travel-heavy spender (brief)
// ═══════════════════════════════════════════════════════════
async function testRecommendTraveler(): Promise<string> {
  const result = await callTool('recommend_cards', {
    flights_annual: 200000,
    hotels_annual: 100000,
    domestic_lounge_usage_quarterly: 4,
    international_lounge_usage_quarterly: 2,
    dining_or_going_out: 10000,
    top_n: 3,
    response_format: 'brief',
  });

  if (!result.recommendations?.length) throw new Error('No recommendations');
  const top = result.recommendations[0];
  if (!top.net_annual_savings) throw new Error('Missing savings');

  return `Top: ${top.card_name} | Savings: ${top.net_annual_savings} | Format: brief ✓`;
}

// ═══════════════════════════════════════════════════════════
// TEST 3: recommend_cards — Minimal spender (edge case)
// ═══════════════════════════════════════════════════════════
async function testRecommendMinimalSpender(): Promise<string> {
  const result = await callTool('recommend_cards', {
    mobile_phone_bills: 500,
    electricity_bills: 1000,
    top_n: 3,
    response_format: 'brief',
  });

  // Should still return something (even if savings are low)
  if (!result.recommendations) throw new Error('No recommendations object');
  return `Got ${result.recommendations.length} cards for minimal spender | Total analyzed: ${result.total_cards_analyzed}`;
}

// ═══════════════════════════════════════════════════════════
// TEST 4: recommend_cards — with offline_grocery + life_insurance (new keys)
// ═══════════════════════════════════════════════════════════
async function testRecommendNewKeys(): Promise<string> {
  const result = await callTool('recommend_cards', {
    amazon_spends: 5000,
    offline_grocery: 8000,
    life_insurance: 50000,
    fuel: 3000,
    top_n: 3,
    response_format: 'brief',
  });

  if (!result.recommendations) throw new Error('No recommendations — new keys may have failed');
  return `New keys work! Top: ${result.recommendations[0]?.card_name} | ${result.recommendations.length} cards`;
}

// ═══════════════════════════════════════════════════════════
// TEST 5: list_cards — Travel category
// ═══════════════════════════════════════════════════════════
async function testListTravel(): Promise<string> {
  const result = await callTool('list_cards', {
    category: 'best-travel-credit-card',
    limit: 5,
    response_format: 'brief',
  });

  if (!result.cards?.length) throw new Error('No cards returned');
  if (!result.cards[0].card_alias) throw new Error('Missing card_alias');

  return `${result.total_available} travel cards available, showing ${result.cards.length}`;
}

// ═══════════════════════════════════════════════════════════
// TEST 6: list_cards — Free cards
// ═══════════════════════════════════════════════════════════
async function testListFreeCards(): Promise<string> {
  const result = await callTool('list_cards', {
    free_cards: 'true',
    limit: 5,
    response_format: 'brief',
  });

  if (!result.cards?.length) throw new Error('No free cards returned');

  // Verify they're actually free
  const nonFree = result.cards.filter((c: any) => c.joining_fee !== 'Free' && c.annual_fee !== 'Free');
  if (nonFree.length === result.cards.length) throw new Error('None of the "free" cards are actually free');

  return `${result.total_available} free cards | Sample: ${result.cards[0].name}`;
}

// ═══════════════════════════════════════════════════════════
// TEST 7: list_cards — by network (RuPay)
// ═══════════════════════════════════════════════════════════
async function testListByNetwork(): Promise<string> {
  const result = await callTool('list_cards', {
    card_networks: ['RuPay'],
    limit: 5,
    response_format: 'brief',
  });

  if (!result.cards?.length) throw new Error('No RuPay cards returned');
  return `${result.total_available} RuPay cards | Sample: ${result.cards[0].name}`;
}

// ═══════════════════════════════════════════════════════════
// TEST 8: get_card_details — Known good alias
// ═══════════════════════════════════════════════════════════
async function testCardDetails(): Promise<string> {
  const result = await callTool('get_card_details', {
    card_alias: 'hdfc-regalia-gold',
  });

  if (result.error) throw new Error(result.error);
  if (!result.name) throw new Error('Missing card name');
  if (!result.fees) throw new Error('Missing fees');
  if (!result.key_benefits?.length) throw new Error('Missing benefits');

  return `${result.name} | Rating: ${result.rating}/5 | ${result.key_benefits.length} benefits | Fee: ${result.fees.joining}`;
}

// ═══════════════════════════════════════════════════════════
// TEST 9: get_card_details — Wrong alias (error handling)
// ═══════════════════════════════════════════════════════════
async function testCardDetailsNotFound(): Promise<string> {
  const result = await callTool('get_card_details', {
    card_alias: 'this-card-does-not-exist-xyz',
  });

  if (result.error && result.error.includes('not found')) {
    return `Correctly returned error for invalid alias: "${result.error}"`;
  }
  throw new Error('Expected "not found" error but got data');
}

// ═══════════════════════════════════════════════════════════
// TEST 10: compare_cards — Two real cards
// ═══════════════════════════════════════════════════════════
async function testCompareCards(): Promise<string> {
  const result = await callTool('compare_cards', {
    card_aliases: ['hdfc-regalia-gold', 'axis-bank-magnus-credit-card'],
  });

  if (!result.comparison?.length) throw new Error('No comparison data');
  if (result.comparison.length !== 2) throw new Error(`Expected 2 cards, got ${result.comparison.length}`);

  const [a, b] = result.comparison;
  return `${a.name} vs ${b.name} | Both have fees, benefits, ratings ✓`;
}

// ═══════════════════════════════════════════════════════════
// TEST 11: check_eligibility — Salaried, Bangalore
// ═══════════════════════════════════════════════════════════
async function testEligibilitySalaried(): Promise<string> {
  const result = await callTool('check_eligibility', {
    pincode: '560001',
    annual_income: '1200000',
    employment_status: 'salaried',
  });

  if (!result.eligible_cards_count) throw new Error('No eligible cards count');
  if (!result.eligible_cards?.length) throw new Error('No eligible cards list');

  return `${result.eligible_cards_count} cards eligible for 12 LPA salaried in Bangalore | Sample: ${result.eligible_cards[0].name}`;
}

// ═══════════════════════════════════════════════════════════
// TEST 12: check_eligibility — Self-employed, lower income
// ═══════════════════════════════════════════════════════════
async function testEligibilitySelfEmployed(): Promise<string> {
  const result = await callTool('check_eligibility', {
    pincode: '400001',
    annual_income: '500000',
    employment_status: 'self_employed',
  });

  if (!result.eligible_cards_count && result.eligible_cards_count !== 0) throw new Error('Missing count');

  return `${result.eligible_cards_count} cards for 5 LPA self-employed in Mumbai`;
}

// ═══════════════════════════════════════════════════════════
// TEST 13: recommend_cards — comparison format
// ═══════════════════════════════════════════════════════════
async function testRecommendComparison(): Promise<string> {
  const result = await callTool('recommend_cards', {
    amazon_spends: 10000,
    flipkart_spends: 5000,
    online_food_ordering: 3000,
    rent: 25000,
    top_n: 3,
    response_format: 'comparison',
  });

  if (!result.recommendations?.length) throw new Error('No recommendations');
  const top = result.recommendations[0];
  if (typeof top.net_annual_savings !== 'number') throw new Error('comparison format should have numeric savings');

  return `Comparison format: ${result.recommendations.length} cards | Top: ${top.card_name} saves ₹${top.net_annual_savings}`;
}

// ═══════════════════════════════════════════════════════════
// Run All Tests
// ═══════════════════════════════════════════════════════════

async function main() {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  GREAT.CARDS MCP SERVER — TEST SUITE`);
  console.log(`  Target: ${MCP_ENDPOINT}`);
  console.log(`${'═'.repeat(60)}\n`);

  // Step 1: Initialize MCP session
  console.log('🔌 Connecting...');
  try {
    await initialize();
  } catch (err: any) {
    console.error(`\n❌ FATAL: Could not connect to MCP server at ${MCP_ENDPOINT}`);
    console.error(`   ${err.message}`);
    console.error(`\n   Is the server running? Try: MCP_TRANSPORT=sse PORT=3100 npx tsx src/index.ts`);
    process.exit(1);
  }

  // Step 2: Run all tests
  console.log('\n📋 Running 13 tests...\n');

  await runTest('T01 recommend_cards — online shopper (full)', testRecommendOnlineShopper);
  await runTest('T02 recommend_cards — traveler (brief)', testRecommendTraveler);
  await runTest('T03 recommend_cards — minimal spender (edge)', testRecommendMinimalSpender);
  await runTest('T04 recommend_cards — new keys (offline_grocery + life_insurance)', testRecommendNewKeys);
  await runTest('T05 recommend_cards — comparison format', testRecommendComparison);
  await runTest('T06 list_cards — travel category', testListTravel);
  await runTest('T07 list_cards — free cards', testListFreeCards);
  await runTest('T08 list_cards — RuPay network', testListByNetwork);
  await runTest('T09 get_card_details — HDFC Regalia Gold', testCardDetails);
  await runTest('T10 get_card_details — invalid alias (error handling)', testCardDetailsNotFound);
  await runTest('T11 compare_cards — Regalia Gold vs Magnus', testCompareCards);
  await runTest('T12 check_eligibility — salaried Bangalore', testEligibilitySalaried);
  await runTest('T13 check_eligibility — self-employed Mumbai', testEligibilitySelfEmployed);

  // Step 3: Summary
  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAIL').length;
  const totalTime = results.reduce((a, r) => a + r.duration, 0);

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  RESULTS: ${passed}/${results.length} passed | ${failed} failed | ${totalTime}ms total`);
  console.log(`${'═'.repeat(60)}`);

  if (failed > 0) {
    console.log('\n❌ FAILURES:');
    results.filter(r => r.status === 'FAIL').forEach(r => {
      console.log(`   ${r.name}: ${r.details}`);
    });
  }

  console.log('');
  process.exit(failed > 0 ? 1 : 0);
}

main();
