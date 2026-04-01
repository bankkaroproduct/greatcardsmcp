/**
 * Quick test bot — calls each MCP tool directly to verify the server works end-to-end.
 * Run: npx tsx test-bot.ts
 */

// Load .env
import { readFileSync } from 'fs';
import { resolve } from 'path';
try {
  const envContent = readFileSync(resolve(import.meta.dirname, '.env'), 'utf-8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
} catch { /* no .env */ }

import { recommendCards, recommendCardsSchema } from './src/tools/recommend.js';
import { getCardDetails, cardDetailsSchema } from './src/tools/cardDetails.js';
import { listCards, listCardsSchema } from './src/tools/listCards.js';
import { compareCards, compareCardsSchema } from './src/tools/compare.js';
import { checkEligibility, checkEligibilitySchema } from './src/tools/eligibility.js';

const PASS = '\x1b[32m✓\x1b[0m';
const FAIL = '\x1b[31m✗\x1b[0m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

async function test(name: string, fn: () => Promise<any>) {
  process.stdout.write(`  Testing ${name}... `);
  const start = Date.now();
  try {
    const result = await fn();
    const ms = Date.now() - start;
    console.log(`${PASS} (${ms}ms)`);
    return result;
  } catch (err: any) {
    const ms = Date.now() - start;
    console.log(`${FAIL} (${ms}ms)`);
    console.log(`    Error: ${err.message}`);
    return null;
  }
}

async function main() {
  console.log(`\n${BOLD}═══ Great.Cards MCP Server — Test Bot ═══${RESET}\n`);
  console.log(`  API: ${process.env.PARTNER_BASE_URL}`);
  console.log(`  Key: ${process.env.PARTNER_API_KEY?.slice(0, 8)}...${process.env.PARTNER_API_KEY?.slice(-4)}\n`);

  // ── 1. List cards (simplest — just a browse) ──
  const listing = await test('list_cards (top 3 travel cards)', () =>
    listCards({
      category: 'best-travel-credit-card',
      limit: 3,
      annual_fees: '',
      card_networks: [],
      bank_ids: [],
      credit_score: '',
      sort_by: '',
      free_cards: '',
    })
  );
  if (listing && !listing.error) {
    console.log(`    → Found ${listing.total_available} cards, showing ${listing.showing}`);
    listing.cards?.forEach((c: any) => console.log(`      • ${c.name} (${c.bank}) — ${c.joining_fee}`));
  }

  // ── 2. Get card details ──
  const alias = listing?.cards?.[0]?.card_alias;
  let details: any = null;
  if (alias) {
    details = await test(`get_card_details ("${alias}")`, () =>
      getCardDetails({ card_alias: alias })
    );
    if (details && !details.error) {
      console.log(`    → ${details.name} | Rating: ${details.rating} | Joining: ${details.fees?.joining}`);
      console.log(`    → ${details.key_benefits?.length || 0} benefits, ${details.tags?.length || 0} tags`);
    }
  }

  // ── 3. Recommend cards based on spending ──
  const recs = await test('recommend_cards (sample spending profile)', () =>
    recommendCards({
      amazon_spends: 5000,
      flipkart_spends: 3000,
      other_online_spends: 4000,
      fuel: 5000,
      dining_or_going_out: 3000,
      grocery_spends_online: 4000,
      flights_annual: 30000,
      domestic_lounge_usage_quarterly: 2,
      mobile_phone_bills: 1000,
      electricity_bills: 2000,
      top_n: 3,
    })
  );
  if (recs && !recs.error) {
    console.log(`    → Analyzed ${recs.total_cards_analyzed} cards`);
    recs.recommendations?.forEach((r: any) =>
      console.log(`      #${r.rank} ${r.card_name} — Net Savings: ${r.net_annual_savings}`)
    );
  }

  // ── 4. Compare top 2 recommended cards ──
  const aliases = recs?.recommendations?.slice(0, 2).map((r: any) => r.card_alias).filter(Boolean);
  if (aliases?.length >= 2) {
    const comparison = await test(`compare_cards (${aliases.join(' vs ')})`, () =>
      compareCards({ card_aliases: aliases })
    );
    if (comparison && !comparison.error) {
      comparison.comparison?.forEach((c: any) =>
        console.log(`      • ${c.name}: Joining ${c.fees?.joining}, Annual ${c.fees?.annual}`)
      );
    }
  }

  // ── 5. Check eligibility ──
  const elig = await test('check_eligibility (Delhi, 12L, salaried)', () =>
    checkEligibility({
      pincode: '110001',
      annual_income: '1200000',
      employment_status: 'salaried',
    })
  );
  if (elig && !elig.error) {
    console.log(`    → ${elig.eligible_cards_count} eligible cards`);
    elig.eligible_cards?.slice(0, 3).forEach((c: any) =>
      console.log(`      • ${c.name} (${c.bank}) — ${c.joining_fee}`)
    );
  }

  // ── Summary ──
  console.log(`\n${BOLD}═══ Done ═══${RESET}\n`);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
