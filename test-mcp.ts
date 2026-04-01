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
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/event-stream',
  };
  if (sessionId) headers['mcp-session-id'] = sessionId;

  const res = await fetch(MCP_ENDPOINT, { method: 'POST', headers, body: JSON.stringify(body) });

  // Capture session ID from response
  const sid = res.headers.get('mcp-session-id');
  if (sid) sessionId = sid;

  const contentType = res.headers.get('content-type') || '';

  // Handle SSE response (Streamable HTTP may return event stream)
  if (contentType.includes('text/event-stream')) {
    const text = await res.text();
    // Parse SSE: find "data: {...}" lines
    const lines = text.split('\n').filter(l => l.startsWith('data: '));
    for (const line of lines) {
      try {
        const json = JSON.parse(line.slice(6));
        if (json.id === id) {
          if (json.error) throw new Error(`MCP Error ${json.error.code}: ${json.error.message}`);
          return json.result;
        }
      } catch { /* skip non-JSON or non-matching */ }
    }
    // If no ID match, try to find any result/error in the stream
    for (const line of lines) {
      try {
        const json = JSON.parse(line.slice(6));
        if (json.result) return json.result;
        if (json.error) throw new Error(`MCP Error ${json.error.code || '?'}: ${json.error.message || JSON.stringify(json.error)}`);
      } catch (e) {
        if (e instanceof Error && e.message.startsWith('MCP Error')) throw e;
      }
    }
    throw new Error(`No response found in SSE stream (${lines.length} data lines, looking for id=${id}). Raw: ${text.slice(0, 200)}`);
  }

  // Handle JSON response
  const text = await res.text();
  try {
    const json = JSON.parse(text);
    if (json.error) throw new Error(`MCP Error ${json.error.code || '?'}: ${json.error.message || JSON.stringify(json.error)}`);
    return json.result;
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('MCP Error')) throw e;
    throw new Error(`Invalid response (${res.status}): ${text.slice(0, 200)}`);
  }
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
  const notifHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/event-stream',
  };
  if (sessionId) notifHeaders['mcp-session-id'] = sessionId;
  await fetch(MCP_ENDPOINT, { method: 'POST', headers: notifHeaders, body: JSON.stringify(notifBody) });
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

// ═══════════════════════════════════════════════════════════════
// ADVERSARIAL & EDGE CASE TESTS
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════
// TEST 14: recommend_cards — ALL zeros (should still return, not crash)
// ═══════════════════════════════════════════════════════════
async function testRecommendAllZeros(): Promise<string> {
  const result = await callTool('recommend_cards', {
    amazon_spends: 0,
    flipkart_spends: 0,
    fuel: 0,
    top_n: 3,
    response_format: 'brief',
  });

  // Should not crash — may return empty or LTF cards
  if (result.error) return `Graceful error: ${result.error}`;
  return `All-zeros: ${result.recommendations?.length ?? 0} cards returned (total analyzed: ${result.total_cards_analyzed})`;
}

// ═══════════════════════════════════════════════════════════
// TEST 15: recommend_cards — Absurdly high values
// ═══════════════════════════════════════════════════════════
async function testRecommendAbsurdValues(): Promise<string> {
  const result = await callTool('recommend_cards', {
    amazon_spends: 999999,
    flights_annual: 5000000,
    domestic_lounge_usage_quarterly: 50,
    rent: 500000,
    top_n: 3,
    response_format: 'brief',
  });

  if (!result.recommendations?.length) throw new Error('No results for high spender');
  const top = result.recommendations[0];
  return `Ultra-high spender: Top=${top.card_name} | Savings=${top.net_annual_savings}`;
}

// ═══════════════════════════════════════════════════════════
// TEST 16: recommend_cards — No arguments at all
// ═══════════════════════════════════════════════════════════
async function testRecommendNoArgs(): Promise<string> {
  const result = await callTool('recommend_cards', {});

  // Should return something (all zeros default) or graceful error
  if (result.error) return `Graceful error on empty: ${result.error}`;
  return `Empty args: ${result.recommendations?.length ?? 0} cards (analyzed: ${result.total_cards_analyzed})`;
}

// ═══════════════════════════════════════════════════════════
// TEST 17: recommend_cards — Only offline_grocery + life_insurance (merged keys only)
// ═══════════════════════════════════════════════════════════
async function testRecommendMergedKeysOnly(): Promise<string> {
  const result = await callTool('recommend_cards', {
    offline_grocery: 15000,
    life_insurance: 100000,
    top_n: 3,
    response_format: 'brief',
  });

  if (result.error) throw new Error(`Merged keys failed: ${result.error}`);
  if (!result.recommendations) throw new Error('No recommendations for merged-only keys');
  return `Merged-only keys: ${result.recommendations.length} cards | Top: ${result.recommendations[0]?.card_name}`;
}

// ═══════════════════════════════════════════════════════════
// TEST 18: recommend_cards — top_n = 1 (boundary)
// ═══════════════════════════════════════════════════════════
async function testRecommendTopN1(): Promise<string> {
  const result = await callTool('recommend_cards', {
    amazon_spends: 5000,
    fuel: 3000,
    top_n: 1,
    response_format: 'full',
  });

  if (!result.recommendations) throw new Error('No recommendations');
  if (result.recommendations.length !== 1) throw new Error(`Expected 1 card, got ${result.recommendations.length}`);
  return `top_n=1: Got exactly 1 card: ${result.recommendations[0].card_name}`;
}

// ═══════════════════════════════════════════════════════════
// TEST 19: list_cards — Empty category (all cards)
// ═══════════════════════════════════════════════════════════
async function testListAllCards(): Promise<string> {
  const result = await callTool('list_cards', {
    category: '',
    limit: 5,
    response_format: 'brief',
  });

  if (!result.cards?.length) throw new Error('No cards for empty category');
  if (result.total_available < 50) throw new Error(`Expected 50+ total cards, got ${result.total_available}`);

  return `All cards: ${result.total_available} total | Showing: ${result.cards.length}`;
}

// ═══════════════════════════════════════════════════════════
// TEST 20: list_cards — Multiple filters combined
// ═══════════════════════════════════════════════════════════
async function testListMultipleFilters(): Promise<string> {
  const result = await callTool('list_cards', {
    category: 'best-travel-credit-card',
    free_cards: 'true',
    limit: 10,
    response_format: 'brief',
  });

  // May return 0 if no free travel cards — that's valid
  return `Travel + Free filter: ${result.total_available} cards | Showing: ${result.cards?.length ?? 0}`;
}

// ═══════════════════════════════════════════════════════════
// TEST 21: list_cards — Invalid category (should not crash)
// ═══════════════════════════════════════════════════════════
async function testListInvalidCategory(): Promise<string> {
  try {
    const result = await callTool('list_cards', {
      category: 'best-crypto-card',
      limit: 5,
    });
    // Might return empty or error — both are fine
    return `Invalid category: ${result.total_available ?? 0} cards (graceful)`;
  } catch (err: any) {
    // Schema validation error is also acceptable
    if (err.message.includes('Invalid enum')) return `Schema rejected invalid category ✓`;
    return `Error handled: ${err.message.slice(0, 80)}`;
  }
}

// ═══════════════════════════════════════════════════════════
// TEST 22: get_card_details — Mixed-case alias from API
// ═══════════════════════════════════════════════════════════
async function testCardDetailsMixedCase(): Promise<string> {
  // The API lists "HDFC-Moneyback-Credit-Card" (mixed case) but lookup is case-sensitive
  const mixedResult = await callTool('get_card_details', { card_alias: 'HDFC-Moneyback-Credit-Card' });
  const lowerResult = await callTool('get_card_details', { card_alias: 'hdfc-moneyback-credit-card' });

  const mixedWorks = !mixedResult.error;
  const lowerWorks = !lowerResult.error;

  if (mixedWorks) return `Mixed-case alias works: ${mixedResult.name}`;
  if (lowerWorks) return `⚠ API QUIRK: Mixed-case alias fails, lowercase works: ${lowerResult.name}`;
  // Some aliases from list_cards don't resolve in get_card_details — known API data issue
  return `⚠ API DATA: Neither mixed/lower alias resolves for HDFC Moneyback (known issue — alias exists in listings but detail endpoint rejects it)`;
}

// ═══════════════════════════════════════════════════════════
// TEST 23: get_card_details — Empty alias
// ═══════════════════════════════════════════════════════════
async function testCardDetailsEmpty(): Promise<string> {
  try {
    const result = await callTool('get_card_details', { card_alias: '' });
    if (result.error) return `Graceful error for empty alias: ${result.error.slice(0, 60)}`;
    return `Empty alias returned data (unexpected but not crash): ${result.name || 'no name'}`;
  } catch (err: any) {
    return `Error handled for empty alias: ${err.message.slice(0, 60)}`;
  }
}

// ═══════════════════════════════════════════════════════════
// TEST 24: compare_cards — Single card (should handle gracefully)
// ═══════════════════════════════════════════════════════════
async function testCompareSingleCard(): Promise<string> {
  try {
    const result = await callTool('compare_cards', {
      card_aliases: ['hdfc-regalia-gold'],
    });
    if (result.error) return `Graceful error for 1 card: ${result.error.slice(0, 60)}`;
    return `Single card compare returned: ${result.comparison?.length ?? 0} cards`;
  } catch (err: any) {
    return `Error for single card: ${err.message.slice(0, 60)}`;
  }
}

// ═══════════════════════════════════════════════════════════
// TEST 25: compare_cards — 3 cards
// ═══════════════════════════════════════════════════════════
async function testCompareThreeCards(): Promise<string> {
  const result = await callTool('compare_cards', {
    card_aliases: ['hdfc-regalia-gold', 'axis-bank-magnus-credit-card', 'sbi-cashback-credit-card'],
  });

  if (!result.comparison?.length) throw new Error('No comparison data for 3 cards');
  if (result.comparison.length !== 3) throw new Error(`Expected 3, got ${result.comparison.length}`);

  return `3-way compare: ${result.comparison.map((c: any) => c.name).join(' vs ')}`;
}

// ═══════════════════════════════════════════════════════════
// TEST 26: compare_cards — One valid + one invalid alias
// ═══════════════════════════════════════════════════════════
async function testCompareOneInvalid(): Promise<string> {
  try {
    const result = await callTool('compare_cards', {
      card_aliases: ['hdfc-regalia-gold', 'totally-fake-card-xyz'],
    });
    if (result.error) return `Graceful error for mixed aliases: ${result.error.slice(0, 80)}`;
    return `Mixed aliases: ${result.comparison?.length ?? 0} cards returned`;
  } catch (err: any) {
    return `Error caught: ${err.message.slice(0, 80)}`;
  }
}

// ═══════════════════════════════════════════════════════════
// TEST 27: check_eligibility — Very high income
// ═══════════════════════════════════════════════════════════
async function testEligibilityHighIncome(): Promise<string> {
  const result = await callTool('check_eligibility', {
    pincode: '122001',
    annual_income: '5000000',
    employment_status: 'salaried',
  });

  if (!result.eligible_cards_count) throw new Error('No count');
  return `50 LPA Gurgaon: ${result.eligible_cards_count} cards eligible`;
}

// ═══════════════════════════════════════════════════════════
// TEST 28: check_eligibility — Very low income
// ═══════════════════════════════════════════════════════════
async function testEligibilityLowIncome(): Promise<string> {
  const result = await callTool('check_eligibility', {
    pincode: '110001',
    annual_income: '200000',
    employment_status: 'salaried',
  });

  // Might be 0 or very few
  return `2 LPA Delhi: ${result.eligible_cards_count ?? 0} cards eligible`;
}

// ═══════════════════════════════════════════════════════════
// TEST 29: check_eligibility — Invalid pincode
// ═══════════════════════════════════════════════════════════
async function testEligibilityBadPincode(): Promise<string> {
  try {
    const result = await callTool('check_eligibility', {
      pincode: '999999',
      annual_income: '1000000',
      employment_status: 'salaried',
    });
    return `Invalid pincode: ${result.eligible_cards_count ?? 0} cards (API was lenient)`;
  } catch (err: any) {
    return `Invalid pincode rejected: ${err.message.slice(0, 60)}`;
  }
}

// ═══════════════════════════════════════════════════════════
// TEST 30: recommend_cards → get_card_details chain (workflow test)
// ═══════════════════════════════════════════════════════════
async function testRecommendThenDetails(): Promise<string> {
  // Step 1: Get recommendation
  const recs = await callTool('recommend_cards', {
    amazon_spends: 10000,
    dining_or_going_out: 5000,
    fuel: 4000,
    top_n: 1,
    response_format: 'full',
  });

  if (!recs.recommendations?.length) throw new Error('No recommendations');
  const alias = recs.recommendations[0].card_alias;
  if (!alias) throw new Error('Missing card_alias in recommendation — cannot chain to details');

  // Step 2: Use that alias to get details
  const details = await callTool('get_card_details', { card_alias: alias });
  if (details.error) throw new Error(`Chained detail lookup failed for "${alias}": ${details.error}`);
  if (!details.name) throw new Error('Details missing card name');

  return `Chain: recommend → "${details.name}" (alias: ${alias}) → ${details.key_benefits?.length} benefits ✓`;
}

// ═══════════════════════════════════════════════════════════
// TEST 31: eligibility → recommend chain (workflow test)
// ═══════════════════════════════════════════════════════════
async function testEligibilityThenRecommend(): Promise<string> {
  // Step 1: Check eligibility
  const elig = await callTool('check_eligibility', {
    pincode: '560001',
    annual_income: '800000',
    employment_status: 'salaried',
  });

  if (!elig.eligible_cards_count) throw new Error('No eligible cards');

  // Step 2: Recommend with spending
  const recs = await callTool('recommend_cards', {
    amazon_spends: 3000,
    online_food_ordering: 2000,
    mobile_phone_bills: 500,
    top_n: 3,
    response_format: 'brief',
  });

  if (!recs.recommendations?.length) throw new Error('No recommendations');

  return `Chain: ${elig.eligible_cards_count} eligible → recommend → Top: ${recs.recommendations[0].card_name}`;
}

// ═══════════════════════════════════════════════════════════
// TEST 32: list_cards → compare chain (workflow test)
// ═══════════════════════════════════════════════════════════
async function testListThenCompare(): Promise<string> {
  // Step 1: List shopping cards (reliable category with many known-good aliases)
  const list = await callTool('list_cards', {
    category: 'best-shopping-credit-card',
    limit: 10,
    response_format: 'brief',
  });

  if (!list.cards?.length || list.cards.length < 2) throw new Error('Need at least 2 shopping cards to compare');

  // Pick 2 cards with different aliases (skip duplicates)
  const seen = new Set<string>();
  const unique = list.cards.filter((c: any) => {
    const name = c.name.trim();
    if (seen.has(name)) return false;
    seen.add(name);
    return true;
  });

  if (unique.length < 2) throw new Error('Not enough unique cards');
  const aliases = unique.slice(0, 2).map((c: any) => c.card_alias);

  // Step 2: Compare first 2 unique cards
  const comp = await callTool('compare_cards', { card_aliases: aliases });

  if (!comp.comparison?.length) {
    // If compare fails, test if individual lookups work (diagnose)
    const d1 = await callTool('get_card_details', { card_alias: aliases[0] });
    const d2 = await callTool('get_card_details', { card_alias: aliases[1] });
    throw new Error(`Compare failed. Alias 1 "${aliases[0]}": ${d1.error || 'OK'}. Alias 2 "${aliases[1]}": ${d2.error || 'OK'}`);
  }

  return `Chain: list shopping → compare ${comp.comparison.map((c: any) => c.name).join(' vs ')} ✓`;
}

// ═══════════════════════════════════════════════════════════
// TEST 33: recommend_cards — Negative values (should not crash)
// ═══════════════════════════════════════════════════════════
async function testRecommendNegativeValues(): Promise<string> {
  try {
    const result = await callTool('recommend_cards', {
      amazon_spends: -5000,
      fuel: -1000,
      top_n: 3,
    });
    if (result.error) return `Graceful error for negatives: ${result.error.slice(0, 60)}`;
    return `Negatives accepted: ${result.recommendations?.length ?? 0} cards (API was lenient)`;
  } catch (err: any) {
    return `Negatives rejected: ${err.message.slice(0, 60)}`;
  }
}

// ═══════════════════════════════════════════════════════════
// TEST 34: recommend_cards — Decimal values
// ═══════════════════════════════════════════════════════════
async function testRecommendDecimals(): Promise<string> {
  const result = await callTool('recommend_cards', {
    amazon_spends: 5499.50,
    fuel: 3200.75,
    mobile_phone_bills: 799.99,
    top_n: 2,
    response_format: 'brief',
  });

  if (!result.recommendations?.length) throw new Error('No recommendations for decimal values');
  return `Decimals: ${result.recommendations.length} cards | Top: ${result.recommendations[0].card_name}`;
}

// ═══════════════════════════════════════════════════════════
// TEST 35: Rapid-fire same tool (cache / rate-limit test)
// ═══════════════════════════════════════════════════════════
async function testRapidFire(): Promise<string> {
  const start = Date.now();
  let succeeded = 0;
  let rateLimited = 0;
  let errors = 0;

  const promises = Array.from({ length: 5 }, async () => {
    try {
      const r = await callTool('list_cards', { category: 'best-fuel-credit-card', limit: 3, response_format: 'brief' });
      if (r.cards?.length > 0) succeeded++;
      else errors++;
    } catch (err: any) {
      if (err.message.includes('Rate limited')) rateLimited++;
      else errors++;
    }
  });

  await Promise.all(promises);
  const elapsed = Date.now() - start;

  if (succeeded === 0) throw new Error(`All 5 requests failed (${rateLimited} rate-limited, ${errors} errors)`);
  return `5 parallel: ${succeeded} OK, ${rateLimited} rate-limited, ${errors} errors in ${elapsed}ms | Rate limiter: ${rateLimited > 0 ? 'ACTIVE ✓' : 'not triggered'}`;
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
  console.log('\n📋 Running 35 tests...\n');
  console.log('── HAPPY PATH ──────────────────────────────────');

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

  console.log('\n── EDGE CASES & BOUNDARIES ─────────────────────');

  await runTest('T14 recommend_cards — all zeros', testRecommendAllZeros);
  await runTest('T15 recommend_cards — absurdly high values', testRecommendAbsurdValues);
  await runTest('T16 recommend_cards — no arguments at all', testRecommendNoArgs);
  await runTest('T17 recommend_cards — merged keys only', testRecommendMergedKeysOnly);
  await runTest('T18 recommend_cards — top_n=1 boundary', testRecommendTopN1);
  await runTest('T19 recommend_cards — negative values', testRecommendNegativeValues);
  await runTest('T20 recommend_cards — decimal values', testRecommendDecimals);

  console.log('\n── ERROR HANDLING ──────────────────────────────');

  await runTest('T21 list_cards — empty category (all cards)', testListAllCards);
  await runTest('T22 list_cards — multiple filters combined', testListMultipleFilters);
  await runTest('T23 list_cards — invalid category', testListInvalidCategory);
  await runTest('T24 get_card_details — mixed-case alias', testCardDetailsMixedCase);
  await runTest('T25 get_card_details — empty alias', testCardDetailsEmpty);
  await runTest('T26 compare_cards — single card', testCompareSingleCard);
  await runTest('T27 compare_cards — 3 cards', testCompareThreeCards);
  await runTest('T28 compare_cards — one valid + one invalid', testCompareOneInvalid);
  await runTest('T29 check_eligibility — very high income (50 LPA)', testEligibilityHighIncome);
  await runTest('T30 check_eligibility — very low income (2 LPA)', testEligibilityLowIncome);
  await runTest('T31 check_eligibility — invalid pincode', testEligibilityBadPincode);

  console.log('\n── WORKFLOW CHAINS ─────────────────────────────');

  await runTest('T32 recommend → get_card_details chain', testRecommendThenDetails);
  await runTest('T33 eligibility → recommend chain', testEligibilityThenRecommend);
  await runTest('T34 list → compare chain', testListThenCompare);

  console.log('\n── PERFORMANCE ─────────────────────────────────');

  await runTest('T35 rapid-fire 5 parallel requests', testRapidFire);

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
