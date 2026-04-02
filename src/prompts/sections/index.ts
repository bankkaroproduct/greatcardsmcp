/**
 * Prompt Sections — Individually importable chunks of the CardAdvisor prompt.
 *
 * These are the same content as CARD_ADVISOR_PROMPT but split so the
 * get_advisor_context tool can return specific topics on demand.
 *
 * IMPORTANT: If you update content here, the parent cardAdvisor.ts
 * re-exports the concatenated version automatically.
 */

// ─── Section boundaries in the monolithic prompt ──────────────────
// We define section labels and the line ranges they correspond to.
// The actual content stays in cardAdvisor.ts (single source of truth).
// This file just maps topic names → section labels for extraction.

export const SECTION_MAP: Record<string, { label: string; description: string }> = {
  conversation_flow: {
    label: 'SECTION 1: CONVERSATION FLOW',
    description: 'Decision tree for handling every type of user message — greetings, spending data, categories, specific cards, comparisons, eligibility, features, personas, vague queries, off-topic, follow-ups.',
  },
  data_collection: {
    label: 'SECTION 2: DATA COLLECTION STRATEGY',
    description: 'Golden rules for collecting spending data: ask 2-3 categories per turn, correlated pairs, natural questions for all 21 spending keys, minimum data thresholds.',
  },
  brand_mappings: {
    label: 'SECTION 3: BRAND',
    description: '700+ Indian brand-to-spending-key mappings. Covers Amazon, Flipkart, Swiggy, Zomato, airlines, hotels, insurance, groceries, fashion, electronics, D2C, OTT, and more. Includes dual-channel brands (online + offline) and disambiguation rules.',
  },
  correlated_pairs: {
    label: 'SECTION 4: CORRELATED CATEGORY PAIRS',
    description: 'When a user mentions one spending category, which related categories to always ask about. Travel group, shopping group, food group, fuel group, grocery group, insurance group, bills group, rent group, entertainment group.',
  },
  unit_conversion: {
    label: 'SECTION 5: UNIT CONVERSION',
    description: 'Rules for parsing Indian number formats (5k, 1.5L, 10 lakhs, 2 crore) and converting between monthly/annual/quarterly units. Critical: which fields are MONTHLY vs ANNUAL vs QUARTERLY.',
  },
  feature_mapping: {
    label: 'SECTION 6: FEATURE REQUESTS',
    description: 'Maps user feature requests ("no annual fee", "lounge access", "cashback", "fuel card", "RuPay", "premium") to the correct list_cards filters and follow-up questions.',
  },
  personas: {
    label: 'SECTION 7: USER PERSONAS',
    description: 'Targeted question sets for common personas: student, business owner, frequent traveler, homemaker, foodie, retired, high salary, freelancer. What to ask and what to skip for each.',
  },
  vague_queries: {
    label: 'SECTION 8: HANDLING EVERY TYPE OF VAGUE QUERY',
    description: 'Response templates for vague/open-ended queries: "best card", "I spend a lot on shopping", "good offers", "premium lifestyle card", "maximum savings", "best for families", "which bank is best".',
  },
  presentation: {
    label: 'SECTION 9: PRESENTING RECOMMENDATIONS',
    description: 'How to narrate recommend_cards results: lead with net savings, explain WHY #1 ranked, show cost vs savings payback, brief trade-off for #2/#3, always end with next-step offer.',
  },
  guardrails: {
    label: 'SECTION 10: LOOP PREVENTION',
    description: 'Strict rules to prevent stuck conversations: never ask same question twice, max 4-5 questions before recommending, accept "I don\'t know" as 0, escape hatch for impatient users.',
  },
  tool_guide: {
    label: 'SECTION 11: TOOL SELECTION GUIDE',
    description: 'When and how to call each of the 5 tools. Includes card alias construction rules, common aliases, income conversion, employment mapping.',
  },
  domain_knowledge: {
    label: 'SECTION 12: INDIAN CREDIT CARD DOMAIN KNOWLEDGE',
    description: 'Fee structures (18% GST, LTF, fee waivers), reward types (points, cashback, miles), lounge values (domestic=750, international=1250), fuel surcharge, top banks and their strengths, card networks, income requirements by tier.',
  },
};

export const ALL_TOPICS = Object.keys(SECTION_MAP);
