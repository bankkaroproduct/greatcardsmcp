import { z } from 'zod';
import { CATEGORIES } from '../content/categories.js';
import { apiClient, type SpendingData } from '../api/client.js';
import { feeCalc } from '../enrichment/feeUtils.js';

// ─── Schema ──────────────────────────────────────────────────────────────────

export const contentBriefSchema = z.object({
  content_type: z.enum([
    'category_best_cards',  // "Best credit cards for fuel/shopping/etc." article
    'card_comparison',      // Side-by-side comparison of 2-4 specific cards
    'persona_guide',        // Best cards for a named spending persona
    'upgrade_path',         // When does upgrading from a free card to a paid card pay off?
    'fee_justification',    // Is card X worth its annual fee at different spend levels?
    'bank_ranking',         // Best cards from a specific bank, ranked
  ]).describe(
    'Content type. ' +
    'category_best_cards: needs `category`. ' +
    'card_comparison: needs `card_aliases` + optional `spend_profile`. ' +
    'persona_guide: needs `persona`. ' +
    'upgrade_path: needs `free_card_alias` + `paid_card_alias` + `category`. ' +
    'fee_justification: needs `card_alias` + `category`. ' +
    'bank_ranking: needs `bank_name` + optional `category`.'
  ),

  // ── category_best_cards ──────────────────────────────────────────────────
  category: z.enum([
    'fuel', 'shopping', 'dining', 'travel', 'grocery', 'food-delivery', 'utility',
  ]).optional().describe('Spending category for category_best_cards, upgrade_path, fee_justification, bank_ranking'),

  composition_label: z.string().optional().describe(
    'Which spend composition to use for sweeps (e.g. "Amazon-heavy"). ' +
    'If omitted, ALL compositions are swept and compared — best for content with persona breakdowns.'
  ),

  spend_tiers: z.array(z.number()).optional().describe(
    'Override spend tier amounts (monthly ₹). Defaults to category preset.'
  ),

  // ── card_comparison ──────────────────────────────────────────────────────
  card_aliases: z.array(z.string()).min(2, { message: 'Min 2 cards' }).max(4, { message: 'Max 4 cards' }).optional().describe(
    'Card SEO aliases for card_comparison (2-4 cards). Get from list_cards or recommend_cards.'
  ),

  spend_profile: z.record(z.string(), z.number()).optional().describe(
    'Full spending map (category → ₹/month) for comparison context. ' +
    'Used in card_comparison and persona_guide.'
  ),

  // ── persona_guide ────────────────────────────────────────────────────────
  persona: z.object({
    name: z.string().describe('Persona name, e.g. "Young professional, Mumbai"'),
    monthly_income: z.number().optional().describe('Monthly take-home in ₹'),
    spends: z.record(z.string(), z.number()).describe('Full spend map across ALL categories'),
    priorities: z.array(z.string()).optional().describe(
      'What they care about: "lounge", "cashback", "no-fee", "rewards", "travel", "fuel"'
    ),
  }).optional(),

  // ── upgrade_path / fee_justification ────────────────────────────────────
  free_card_alias: z.string().optional().describe('Current free/entry card alias'),
  paid_card_alias: z.string().optional().describe('Candidate paid/premium card alias to justify'),
  card_alias: z.string().optional().describe('Card alias for fee_justification analysis'),

  // ── bank_ranking ─────────────────────────────────────────────────────────
  bank_name: z.string().optional().describe('Bank name for bank_ranking (e.g. "HDFC Bank", "Axis Bank")'),

  // ── common ───────────────────────────────────────────────────────────────
  top_n: z.number().optional().default(5),
  include_details: z.boolean().optional().default(true),

  // ── output format & content parameters (absorbed from content layer) ─────
  output_format: z.enum(['blog', 'carousel', 'reels', 'thread', 'linkedin']).optional()
    .describe('Output format. blog=long-form article, carousel=Instagram slide JSON, reels=voiceover script, thread=X/Twitter thread, linkedin=LinkedIn post. Default: blog.'),

  audience: z.enum(['first-timer', 'rewards-seeker', 'traveler', 'young-pro', 'high-spender', 'budget']).optional()
    .describe('Target audience. first-timer=explain jargon, rewards-seeker=maximize tips, traveler=lounge/miles focus, young-pro=aspirational+practical, high-spender=premium deep-dive, budget=value/LTF focus.'),

  goal: z.enum(['awareness', 'consideration', 'conversion']).optional()
    .describe('Content goal. awareness=introduce the card, consideration=evaluate pros/cons honestly, conversion=push to apply now with urgency.'),

  hook: z.enum(['benefits-led', 'savings-math', 'mistakes', 'hidden-gems', 'worth-fee', 'upgrade-story']).optional()
    .describe('Narrative hook. savings-math=lead with ₹ savings calc, worth-fee=ROI framing, hidden-gems=underrated benefits, mistakes=what people get wrong, upgrade-story=journey from free to paid card.'),

  spend_focus: z.enum(['online-shopper', 'flyer', 'foodie', 'fuel-heavy', 'bills', 'all-round']).optional()
    .describe('Spend category to spotlight in examples and ₹ calculations.'),

  tone: z.enum(['conversational', 'punchy', 'educational', 'story-driven', 'expert']).optional()
    .describe('Writing tone. conversational=warm friendly, punchy=short sharp bold, educational=structured clear, story-driven=narrative arc, expert=data-first technical.'),

  language: z.enum(['english', 'hinglish']).optional()
    .describe('Output language. hinglish=mix English with natural Hindi (yaar, matlab, seedha, ek dum) for Indian millennials.'),

  comparison_card: z.string().optional()
    .describe('Optional card alias to weave in as a comparison. Fetch its details and contrast inline.'),

  seo_keyword: z.string().optional()
    .describe('Target SEO keyword for blog format. Use naturally in H1, intro paragraph, and 2-3 subheadings.'),
});

// ─── Main handler ────────────────────────────────────────────────────────────

export async function generateContentBrief(input: z.infer<typeof contentBriefSchema>) {
  switch (input.content_type) {
    case 'category_best_cards':  return handleCategoryBestCards(input);
    case 'card_comparison':      return handleCardComparison(input);
    case 'persona_guide':        return handlePersonaGuide(input);
    case 'upgrade_path':         return handleUpgradePath(input);
    case 'fee_justification':    return handleFeeJustification(input);
    case 'bank_ranking':         return handleBankRanking(input);
    default:
      return { error: `Unknown content_type: ${(input as any).content_type}` };
  }
}

// ─── Handler: category_best_cards ───────────────────────────────────────────

async function handleCategoryBestCards(input: z.infer<typeof contentBriefSchema>) {
  const { category, composition_label, top_n = 5, include_details } = input;
  if (!category) return { error: 'category is required for category_best_cards' };

  const config = CATEGORIES[category];
  if (!config) return { error: `No config for category: ${category}` };

  // Select compositions to sweep
  const compositionsToSweep = composition_label
    ? config.spend_compositions.filter(c => c.label === composition_label)
    : config.spend_compositions;

  if (!compositionsToSweep.length) {
    return { error: `Composition "${composition_label}" not found. Available: ${config.spend_compositions.map(c => c.label).join(', ')}` };
  }

  const spend_tiers = input.spend_tiers || config.spend_tiers;

  // Get card universe
  const listResponse = await apiClient.getCardListing({ slug: config.mcp_category });
  const cards = Array.isArray(listResponse?.data?.cards)
    ? listResponse.data.cards
    : (Array.isArray(listResponse?.data) ? listResponse.data : []);

  const unique_top_aliases = new Set<string>();
  const sweeps_by_composition: any[] = [];

  // For each composition, sweep all spend tiers
  for (const composition of compositionsToSweep) {
    const tier_results: any[] = [];

    for (const tier of spend_tiers) {
      const spendMap: Record<string, number> = {};
      for (const [key, ratio] of Object.entries(composition.keys)) {
        spendMap[key] = Math.round(tier * ratio);
      }

      const recResponse = await apiClient.calculateCardGenius(spendMap as SpendingData);
      const savingsArray = Array.isArray(recResponse?.data?.savings) ? recResponse.data.savings : [];

      const rankedCards = savingsArray
        .map((s: any) => {
          const annualFee = feeCalc(s.annual_fee_text || '0').withGST;
          const rewards = s.total_savings_yearly || 0;
          const milestones = s.total_extra_benefits || 0;
          const netSavings = Math.round(rewards + milestones - annualFee);
          return {
            card_alias: s.seo_card_alias || s.card_alias,
            card_name: s.card_name,
            annual_rewards: rewards,
            milestone_benefits: milestones,
            annual_fee: annualFee,
            net_savings: netSavings,
            spending_breakdown: s.spending_breakdown,
          };
        })
        .filter((c: any) => c.card_alias && c.net_savings > -50000)
        .sort((a: any, b: any) => b.net_savings - a.net_savings)
        .slice(0, top_n);

      rankedCards.forEach((c: any) => unique_top_aliases.add(c.card_alias));

      tier_results.push({
        spend_level: tier,
        spend_label: config.tier_labels[tier] || `₹${tier.toLocaleString('en-IN')}/mo`,
        params_used: spendMap,
        top_cards: rankedCards,
      });
    }

    // Find crossover points within this composition
    const crossovers: any[] = [];
    for (let i = 1; i < tier_results.length; i++) {
      const prev = tier_results[i - 1].top_cards[0];
      const curr = tier_results[i].top_cards[0];
      if (prev && curr && prev.card_alias !== curr.card_alias) {
        crossovers.push({
          at_spend_level: tier_results[i].spend_level,
          spend_label: tier_results[i].spend_label,
          switches_from: prev.card_name,
          switches_to: curr.card_name,
          note: `At ₹${tier_results[i].spend_level.toLocaleString('en-IN')}/mo, ${curr.card_name} overtakes ${prev.card_name}`,
        });
      }
    }

    sweeps_by_composition.push({
      composition: composition.label,
      description: composition.description,
      tier_results,
      crossovers,
    });
  }

  // Fetch card details for unique top aliases
  const card_profiles: Record<string, any> = {};
  if (include_details) {
    await fetchCardProfiles(Array.from(unique_top_aliases), card_profiles, config.detail_fields);
  }

  return {
    content_type: 'category_best_cards',
    category,
    generated_at: new Date().toISOString(),
    card_universe: { total: cards.length },
    category_context: config.context,
    compositions_swept: compositionsToSweep.map(c => ({ label: c.label, description: c.description })),
    sweeps_by_composition,
    card_profiles,
    _llm_instructions: buildArticleInstructions('category_best_cards', category, input),
  };
}

// ─── Handler: card_comparison ────────────────────────────────────────────────

async function handleCardComparison(input: z.infer<typeof contentBriefSchema>) {
  const { card_aliases, spend_profile, include_details, top_n = 5 } = input;
  if (!card_aliases || card_aliases.length < 2) {
    return { error: 'card_aliases requires at least 2 card aliases' };
  }

  // Fetch details for each card in parallel
  const card_profiles: Record<string, any> = {};
  await fetchCardProfiles(card_aliases, card_profiles, []);

  // If spend_profile provided, calculate net savings for each card
  let savings_at_spend: Record<string, any> | null = null;
  if (spend_profile && Object.keys(spend_profile).length > 0) {
    const recResponse = await apiClient.calculateCardGenius(spend_profile as SpendingData);
    const savingsArray = Array.isArray(recResponse?.data?.savings) ? recResponse.data.savings : [];

    savings_at_spend = {};
    for (const alias of card_aliases) {
      const match = savingsArray.find((s: any) =>
        (s.seo_card_alias || s.card_alias) === alias
      );
      if (match) {
        const annualFee = feeCalc(match.annual_fee_text || '0').withGST;
        const rewards = match.total_savings_yearly || 0;
        const milestones = match.total_extra_benefits || 0;
        savings_at_spend[alias] = {
          card_name: match.card_name,
          annual_rewards: rewards,
          milestone_benefits: milestones,
          annual_fee: annualFee,
          net_savings: Math.round(rewards + milestones - annualFee),
          spending_breakdown: match.spending_breakdown,
          rank_among_compared: 0, // filled below
        };
      } else {
        savings_at_spend[alias] = { note: 'Card not returned by recommendation engine for this spend profile' };
      }
    }

    // Rank among compared cards
    const ranked = Object.entries(savings_at_spend)
      .filter(([, v]: any) => typeof v.net_savings === 'number')
      .sort(([, a]: any, [, b]: any) => b.net_savings - a.net_savings);
    ranked.forEach(([alias], idx) => {
      (savings_at_spend as any)[alias].rank_among_compared = idx + 1;
    });
  }

  return {
    content_type: 'card_comparison',
    generated_at: new Date().toISOString(),
    cards_compared: card_aliases,
    spend_profile_used: spend_profile || null,
    savings_at_spend,
    card_profiles,
    _llm_instructions: buildArticleInstructions('card_comparison', undefined, input),
  };
}

// ─── Handler: persona_guide ──────────────────────────────────────────────────

async function handlePersonaGuide(input: z.infer<typeof contentBriefSchema>) {
  const { persona, top_n = 5, include_details } = input;
  if (!persona) return { error: 'persona is required for persona_guide' };

  const recResponse = await apiClient.calculateCardGenius(persona.spends as SpendingData);
  const savingsArray = Array.isArray(recResponse?.data?.savings) ? recResponse.data.savings : [];

  const ranked = savingsArray
    .map((s: any) => {
      const annualFee = feeCalc(s.annual_fee_text || '0').withGST;
      const rewards = s.total_savings_yearly || 0;
      const milestones = s.total_extra_benefits || 0;
      return {
        rank: 0,
        card_alias: s.seo_card_alias || s.card_alias,
        card_name: s.card_name,
        annual_rewards: rewards,
        milestone_benefits: milestones,
        annual_fee: annualFee,
        joining_fee: feeCalc(s.joining_fee_text || '0').withGST,
        net_savings: Math.round(rewards + milestones - annualFee),
        spending_breakdown: s.spending_breakdown,
      };
    })
    .filter((c: any) => c.card_alias)
    .sort((a: any, b: any) => b.net_savings - a.net_savings)
    .slice(0, top_n)
    .map((c: any, i: number) => ({ ...c, rank: i + 1 }));

  const card_profiles: Record<string, any> = {};
  if (include_details) {
    await fetchCardProfiles(ranked.map((c: any) => c.card_alias), card_profiles, []);
  }

  return {
    content_type: 'persona_guide',
    generated_at: new Date().toISOString(),
    persona: {
      name: persona.name,
      monthly_income: persona.monthly_income,
      priorities: persona.priorities || [],
      spend_breakdown: persona.spends,
      total_monthly_spend: Object.values(persona.spends).reduce((a, b) => (a as number) + (b as number), 0 as number),
    },
    top_cards: ranked,
    card_profiles,
    _llm_instructions: buildArticleInstructions('persona_guide', persona.name, input),
  };
}

// ─── Handler: upgrade_path ───────────────────────────────────────────────────

async function handleUpgradePath(input: z.infer<typeof contentBriefSchema>) {
  const { free_card_alias, paid_card_alias, category, top_n = 5 } = input;
  if (!free_card_alias || !paid_card_alias) {
    return { error: 'free_card_alias and paid_card_alias are both required for upgrade_path' };
  }

  const config = category ? CATEGORIES[category] : null;
  const spend_tiers = input.spend_tiers || config?.spend_tiers || [5000, 10000, 20000, 30000, 50000, 75000, 100000];
  const composition = config?.spend_compositions.find(c => c.label === (input.composition_label || config.default_composition))
    || config?.spend_compositions[0];

  const tier_results: any[] = [];

  for (const tier of spend_tiers) {
    const spendMap: Record<string, number> = {};
    if (composition) {
      for (const [key, ratio] of Object.entries(composition.keys)) {
        spendMap[key] = Math.round(tier * ratio);
      }
    }

    const recResponse = await apiClient.calculateCardGenius(spendMap as SpendingData);
    const savingsArray = Array.isArray(recResponse?.data?.savings) ? recResponse.data.savings : [];

    const findCard = (alias: string) => {
      const match = savingsArray.find((s: any) => (s.seo_card_alias || s.card_alias) === alias);
      if (!match) return null;
      const annualFee = feeCalc(match.annual_fee_text || '0').withGST;
      const rewards = match.total_savings_yearly || 0;
      const milestones = match.total_extra_benefits || 0;
      return {
        card_name: match.card_name,
        net_savings: Math.round(rewards + milestones - annualFee),
        annual_fee: annualFee,
        rewards,
        milestones,
      };
    };

    const free_card_data = findCard(free_card_alias);
    const paid_card_data = findCard(paid_card_alias);

    tier_results.push({
      spend_level: tier,
      spend_label: config?.tier_labels[tier] || `₹${tier.toLocaleString('en-IN')}/mo`,
      free_card: free_card_data ? { alias: free_card_alias, ...free_card_data } : { alias: free_card_alias, note: 'Not in results at this spend level' },
      paid_card: paid_card_data ? { alias: paid_card_alias, ...paid_card_data } : { alias: paid_card_alias, note: 'Not in results at this spend level' },
      paid_card_advantage: (free_card_data && paid_card_data)
        ? Math.round(paid_card_data.net_savings - free_card_data.net_savings)
        : null,
      verdict: (free_card_data && paid_card_data)
        ? (paid_card_data.net_savings > free_card_data.net_savings
          ? `Upgrade pays off: ${paid_card_data.card_name} earns ₹${Math.abs(Math.round(paid_card_data.net_savings - free_card_data.net_savings)).toLocaleString('en-IN')} more/yr`
          : `Stick with free card: ${free_card_data.card_name} is ₹${Math.abs(Math.round(free_card_data.net_savings - paid_card_data.net_savings)).toLocaleString('en-IN')} better/yr`)
        : 'Data unavailable',
    });
  }

  // Find crossover spend level
  const crossover = tier_results.find(t => t.paid_card_advantage !== null && t.paid_card_advantage > 0);

  const card_profiles: Record<string, any> = {};
  if (input.include_details) {
    await fetchCardProfiles([free_card_alias, paid_card_alias], card_profiles, config?.detail_fields || []);
  }

  return {
    content_type: 'upgrade_path',
    generated_at: new Date().toISOString(),
    category: category || null,
    composition_used: composition?.label || null,
    free_card: free_card_alias,
    paid_card: paid_card_alias,
    crossover_spend_level: crossover?.spend_level || null,
    crossover_spend_label: crossover?.spend_label || null,
    crossover_note: crossover
      ? `At ₹${crossover.spend_level.toLocaleString('en-IN')}/mo, upgrading to the paid card starts paying off`
      : 'Paid card does not pay off at any tested spend level — may need higher tiers',
    tier_results,
    card_profiles,
    _llm_instructions: buildArticleInstructions('upgrade_path', undefined, input),
  };
}

// ─── Handler: fee_justification ──────────────────────────────────────────────

async function handleFeeJustification(input: z.infer<typeof contentBriefSchema>) {
  const { card_alias, category } = input;
  if (!card_alias) return { error: 'card_alias is required for fee_justification' };

  const config = category ? CATEGORIES[category] : null;
  const spend_tiers = input.spend_tiers || config?.spend_tiers || [5000, 10000, 20000, 30000, 50000];
  const composition = config?.spend_compositions.find(c => c.label === (input.composition_label || config.default_composition))
    || config?.spend_compositions[0];

  // Fetch card details first to know the annual fee
  const detailResponse = await apiClient.getCardDetails(card_alias);
  const raw = detailResponse?.data;
  const cardDetail = Array.isArray(raw) ? raw[0] : raw;
  const cardName = cardDetail?.card_name || card_alias;
  const annualFeeData = feeCalc(cardDetail?.annual_fee_text || '0');

  const tier_results: any[] = [];

  for (const tier of spend_tiers) {
    const spendMap: Record<string, number> = {};
    if (composition) {
      for (const [key, ratio] of Object.entries(composition.keys)) {
        spendMap[key] = Math.round(tier * ratio);
      }
    }

    const recResponse = await apiClient.calculateCardGenius(spendMap as SpendingData);
    const savingsArray = Array.isArray(recResponse?.data?.savings) ? recResponse.data.savings : [];
    const match = savingsArray.find((s: any) => (s.seo_card_alias || s.card_alias) === card_alias);

    if (match) {
      const annualFee = feeCalc(match.annual_fee_text || '0').withGST;
      const rewards = match.total_savings_yearly || 0;
      const milestones = match.total_extra_benefits || 0;
      const netSavings = Math.round(rewards + milestones - annualFee);
      const monthsToPayback = annualFee > 0 ? Math.round((annualFee / Math.max(rewards + milestones, 1)) * 12) : 0;

      tier_results.push({
        spend_level: tier,
        spend_label: config?.tier_labels[tier] || `₹${tier.toLocaleString('en-IN')}/mo`,
        annual_rewards: rewards,
        milestone_benefits: milestones,
        annual_fee: annualFee,
        net_savings: netSavings,
        fee_payback_months: monthsToPayback,
        verdict: netSavings > 0
          ? `Worth it: card pays for itself in ${monthsToPayback} month${monthsToPayback !== 1 ? 's' : ''}, net ₹${netSavings.toLocaleString('en-IN')} ahead`
          : `Not worth it at this spend level: ₹${Math.abs(netSavings).toLocaleString('en-IN')} net loss after fee`,
      });
    } else {
      tier_results.push({
        spend_level: tier,
        spend_label: config?.tier_labels[tier] || `₹${tier.toLocaleString('en-IN')}/mo`,
        note: 'Card not in recommendation results at this spend level',
      });
    }
  }

  const breakEvenTier = tier_results.find(t => typeof t.net_savings === 'number' && t.net_savings > 0);

  return {
    content_type: 'fee_justification',
    generated_at: new Date().toISOString(),
    card: { alias: card_alias, name: cardName, annual_fee: annualFeeData.inline, fee_waiver: cardDetail?.annual_fee_waiver || 'None' },
    category: category || null,
    composition_used: composition?.label || null,
    break_even_spend: breakEvenTier?.spend_level || null,
    break_even_label: breakEvenTier?.spend_label || 'Does not break even at tested tiers',
    tier_results,
    _llm_instructions: buildArticleInstructions('fee_justification', cardName, input),
  };
}

// ─── Handler: bank_ranking ───────────────────────────────────────────────────

async function handleBankRanking(input: z.infer<typeof contentBriefSchema>) {
  const { bank_name, category, top_n = 8, include_details, spend_profile } = input;
  if (!bank_name) return { error: 'bank_name is required for bank_ranking' };

  const config = category ? CATEGORIES[category] : null;
  const listResponse = await apiClient.getCardListing({
    slug: config?.mcp_category || '',
  });
  const allCards = Array.isArray(listResponse?.data?.cards)
    ? listResponse.data.cards
    : (Array.isArray(listResponse?.data) ? listResponse.data : []);

  // Filter to bank
  const bankCards = allCards.filter((c: any) => {
    const bankMatch = c.banks?.[0]?.name || c.bank_name || '';
    return bankMatch.toLowerCase().includes(bank_name.toLowerCase());
  });

  if (!bankCards.length) {
    return { error: `No cards found for bank: ${bank_name}. Check spelling or try a broader name.` };
  }

  // If spend_profile provided, rank by net savings; otherwise rank by fee tier + rating
  let rankedCards: any[] = [];

  if (spend_profile && Object.keys(spend_profile).length > 0) {
    const recResponse = await apiClient.calculateCardGenius(spend_profile as SpendingData);
    const savingsArray = Array.isArray(recResponse?.data?.savings) ? recResponse.data.savings : [];

    const bankAliases = new Set(bankCards.map((c: any) => c.seo_card_alias));
    rankedCards = savingsArray
      .filter((s: any) => bankAliases.has(s.seo_card_alias || s.card_alias))
      .map((s: any) => {
        const annualFee = feeCalc(s.annual_fee_text || '0').withGST;
        const rewards = s.total_savings_yearly || 0;
        const milestones = s.total_extra_benefits || 0;
        return {
          card_alias: s.seo_card_alias || s.card_alias,
          card_name: s.card_name,
          annual_fee: annualFee,
          net_savings: Math.round(rewards + milestones - annualFee),
          spending_breakdown: s.spending_breakdown,
        };
      })
      .sort((a: any, b: any) => b.net_savings - a.net_savings)
      .slice(0, top_n)
      .map((c: any, i: number) => ({ rank: i + 1, ...c }));
  } else {
    // No spend profile — rank by fee tier (free first) then rating
    rankedCards = bankCards
      .slice(0, top_n)
      .map((c: any, i: number) => ({
        rank: i + 1,
        card_alias: c.seo_card_alias,
        card_name: c.card_name || c.name,
        joining_fee: feeCalc(c.joining_fee_text).inline,
        annual_fee: feeCalc(c.annual_fee_text).inline,
        rating: c.rating,
        key_benefits: (c.product_usps || []).slice(0, 2).map((u: any) => u.header),
        note: 'Net savings not calculated — provide spend_profile for personalized ranking',
      }));
  }

  const card_profiles: Record<string, any> = {};
  if (include_details) {
    await fetchCardProfiles(rankedCards.map((c: any) => c.card_alias).filter(Boolean), card_profiles, config?.detail_fields || []);
  }

  return {
    content_type: 'bank_ranking',
    generated_at: new Date().toISOString(),
    bank: bank_name,
    category: category || 'all',
    total_cards_from_bank: bankCards.length,
    ranked_cards: rankedCards,
    card_profiles,
    _llm_instructions: buildArticleInstructions('bank_ranking', bank_name, input),
  };
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

async function fetchCardProfiles(aliases: string[], profiles: Record<string, any>, detailFields: string[]) {
  await Promise.all(aliases.map(async (alias) => {
    try {
      const res = await apiClient.getCardDetails(alias);
      const raw = res?.data;
      const card = Array.isArray(raw) ? raw[0] : raw;
      if (card) {
        profiles[alias] = {
          name: card.card_name || card.name,
          joining_fee: feeCalc(card.joining_fee_text).inline,
          annual_fee: feeCalc(card.annual_fee_text).inline,
          fee_waiver: card.annual_fee_waiver || 'None',
          rating: card.rating,
          key_benefits: (card.product_usps || []).slice(0, 5).map((u: any) => u.description || u.header),
          reward_caps: extractRewardCaps(card.product_benefits || []),
          category_specifics: detailFields.length ? extractCategorySpecifics(card.product_benefits || [], detailFields) : undefined,
        };
      } else {
        profiles[alias] = { error: 'Not found in card details API' };
      }
    } catch {
      profiles[alias] = { error: 'Failed to fetch details' };
    }
  }));
}

function extractRewardCaps(benefits: any[]): string[] {
  const caps: string[] = [];
  const regex = /capped at|max.*per month|maximum|up to/i;
  for (const b of benefits) {
    if (b.html_text && regex.test(b.html_text)) {
      const clean = b.html_text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
      caps.push(`[${b.benefit_type}] ${clean.slice(0, 200)}`);
    }
  }
  return caps.slice(0, 5);
}

function extractCategorySpecifics(benefits: any[], detailFields: string[]): Record<string, string[]> {
  const specifics: Record<string, string[]> = {};
  for (const field of detailFields) {
    specifics[field] = [];
    const searchTerms = field.split('_').filter(w => w.length > 2);
    for (const b of benefits) {
      const target = `${b.benefit_type} ${b.html_text || ''}`.toLowerCase();
      if (searchTerms.some(term => target.includes(term))) {
        const clean = b.html_text?.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() || '';
        if (clean) specifics[field].push(clean.slice(0, 300));
      }
    }
    specifics[field] = specifics[field].slice(0, 3);
  }
  return specifics;
}

// ─── LLM instructions per content type ───────────────────────────────────────

function buildArticleInstructions(contentType: string, subject?: string, opts?: {
  output_format?: string;
  audience?: string;
  goal?: string;
  hook?: string;
  spend_focus?: string;
  tone?: string;
  language?: string;
  comparison_card?: string;
  seo_keyword?: string;
}): any {
  const o = opts || {};
  const fmt = o.output_format || 'blog';

  const AUDIENCE_DESC: Record<string, string> = {
    'first-timer':    'Someone looking for their first credit card. Use simple language, explain jargon, avoid assuming knowledge.',
    'rewards-seeker': 'Experienced user who maximises rewards and cashback. Be specific about earn rates, redemption values, and optimisation tips.',
    'traveler':       'Frequent traveller who prioritises lounge access, air miles, and travel perks. Focus on travel benefits and international usability.',
    'young-pro':      'Young professional (25-32) building their lifestyle and credit profile. Balance aspirational tone with practical value.',
    'high-spender':   'High-income individual spending ₹1L+/month who wants maximum value. Go deep on premium benefits, milestone rewards, and net annual savings.',
    'budget':         'Budget-conscious person who wants good value with low or no annual fee. Lead with cost-effectiveness and fee waivers.',
  };
  const GOAL_DESC: Record<string, string> = {
    'awareness':     'Make them aware this card exists and what it generally offers. Informational, no hard sell. Mention 2-3 top features.',
    'consideration': 'Help them evaluate if this card is right for their situation. Compare pros/cons, be honest about who it suits and who it does not.',
    'conversion':    'Push them to apply now. Lead with the strongest benefit, create urgency, end with a clear CTA. Minimise downsides.',
  };
  const HOOK_DESC: Record<string, string> = {
    'benefits-led':  'Lead with the card\'s strongest features and benefits.',
    'savings-math':  'Lead with a specific ₹ annual savings calculation (e.g. "Save ₹24,000/year if you…"). Make the math crystal clear.',
    'mistakes':      'Frame around common mistakes people make without this card, or mistakes to avoid when using it.',
    'hidden-gems':   'Focus on lesser-known, underrated benefits most people do not know about.',
    'worth-fee':     'Frame around the central question: is the annual fee worth it? Build the case with ROI logic.',
    'upgrade-story': 'Tell the story of upgrading from a basic/free card to this one, and why it is worth it.',
  };
  const SPEND_DESC: Record<string, string> = {
    'online-shopper': 'Spotlight: Amazon, Flipkart, Myntra rewards. Use online shopping ₹ examples.',
    'flyer':          'Spotlight: lounge access, air miles, travel rewards, forex savings. Use travel spend examples.',
    'foodie':         'Spotlight: Swiggy, Zomato, dining out rewards. Use food spend examples.',
    'fuel-heavy':     'Spotlight: fuel surcharge waiver, fuel cashback. Use fuel spend examples.',
    'bills':          'Spotlight: utility bill rewards, mobile recharge benefits. Use bills/utilities examples.',
    'all-round':      'Use a balanced mix of spend categories. Cover everyday spending broadly.',
  };
  const TONE_DESC: Record<string, string> = {
    'conversational': 'Warm, friendly, like a knowledgeable friend explaining. Use "you" a lot. Short sentences.',
    'punchy':         'Short, sharp, bold. No filler words. Every sentence earns its place. Bold claims, numbers upfront.',
    'educational':    'Clear, structured, thorough. Explain how things work. Good for first-timers.',
    'story-driven':   'Use a narrative arc. Start with a relatable situation, build to the card as the solution.',
    'expert':         'Data-first, precise, assumes knowledge. Use technical terms. Ideal for rewards maximisers.',
  };

  const audienceNote = o.audience ? AUDIENCE_DESC[o.audience] : null;
  const goalNote = o.goal ? GOAL_DESC[o.goal] : null;
  const hookNote = o.hook ? HOOK_DESC[o.hook] : null;
  const spendNote = o.spend_focus ? SPEND_DESC[o.spend_focus] : null;
  const toneNote = o.tone ? TONE_DESC[o.tone] : null;
  const langNote = o.language === 'hinglish'
    ? 'Write in Hinglish — mix English with natural Hindi words/phrases (yaar, matlab, seedha, ek dum, etc). Keep it relatable for Indian millennials.'
    : null;

  const writingParams = {
    ...(audienceNote && { audience: audienceNote }),
    ...(goalNote     && { goal: goalNote }),
    ...(hookNote     && { narrative_hook: hookNote }),
    ...(spendNote    && { spend_focus: spendNote }),
    ...(toneNote     && { tone: toneNote }),
    ...(langNote     && { language: langNote }),
    ...(o.comparison_card && { compare_with: `Fetch details for "${o.comparison_card}" and weave in comparisons throughout.` }),
    ...(o.seo_keyword && fmt === 'blog' && { seo_keyword: `Use "${o.seo_keyword}" naturally in H1, intro paragraph, and 2-3 subheadings.` }),
  };

  // ── Format-specific output instructions ────────────────────────────────────
  const FORMAT_INSTRUCTIONS: Record<string, any> = {
    blog: {
      output: 'Write a long-form blog post (800-1200 words) in clean markdown.',
      structure: [
        'H1 title (include SEO keyword if provided)',
        'Compelling intro — lead with the hook angle above',
        'H2 sections for each key benefit with real ₹ numbers from card data',
        'Reward Rates section with earn rates and redemption value',
        'Fees & Charges (annual fee incl 18% GST, joining fee, waiver conditions)',
        'Who Should Get This Card',
        'Who Should Skip It',
        'Verdict (1 paragraph)',
        'CTA: Apply via Great.Cards',
      ],
    },
    carousel: {
      output: 'Return ONLY valid JSON (no markdown, no backticks, no preamble). Schema:',
      schema: {
        card_name: 'Full official card name',
        cover: {
          count: 'number of content slides as string e.g. "5"',
          title_blue: 'short blue part of headline',
          title_dark: 'dark part of headline',
          subtitle: 'italic gray subtitle line',
        },
        slides: [
          {
            number: 1,
            label: 'Short italic context label',
            headline: 'Bold headline — wrap key stat/phrase in **double asterisks** to render blue',
            body1: 'First bold paragraph — key fact with real ₹ number from card data',
            body2: 'Second paragraph — context or implication',
            callout: 'One-line callout with a specific ₹ example',
          },
          '...5 slides total',
        ],
        cta: {
          setup_italic: 'Most people pick a card',
          setup_bold: 'for the joining bonus. That\'s the wrong move.',
          card_label: 'The smarter question is',
          question: 'Which card actually fits your spending?',
          cta_line: 'Come to Great.Cards to find out exactly that!',
        },
        caption: 'Full Instagram caption 150-200 words. Emojis. Ends with CTA to link in bio.',
        hashtags: '20 hashtags space separated',
      },
      rules: [
        'Use ONLY real data from this tool response. Never invent reward rates.',
        'Annual fees include 18% GST. All amounts in ₹.',
        'Return ONLY the JSON object — no explanation before or after.',
      ],
    },
    reels: {
      output: 'Write a 45-60 second Instagram Reels voiceover script.',
      structure: [
        '🎬 HOOK (0-3 sec): Scroll-stopping opening line with a specific number or bold claim — use the hook angle above',
        '📝 SCRIPT (3-50 sec): 6-8 punchy lines. One sentence each. Use specific ₹ numbers from card data.',
        '🎯 CTA (50-60 sec): Final call to action — visit Great.Cards',
        '---',
        '📱 CAPTION: 100-150 words matching tone/audience above',
        '#️⃣ HASHTAGS: 20 hashtags',
        '🎭 DIRECTION NOTE: 2 sentences on energy/pacing for this script',
      ],
    },
    thread: {
      output: 'Write a Twitter/X thread. 10-12 tweets. Format: "1/" "2/" etc. Max 280 chars each.',
      structure: [
        'Tweet 1: Hook — surprising stat or bold claim based on the hook angle above',
        'Tweets 2-5: Top 2-3 benefits with exact ₹ numbers from card data',
        'Tweet 6: Real-world value example (Spend ₹X/month → earn ₹Y/year)',
        'Tweet 7: Fees + waiver conditions',
        'Tweet 8: Who it is ideal for (matching audience above)',
        'Tweet 9: One honest limitation — builds trust',
        'Tweet 10: Verdict + CTA to Great.Cards',
      ],
    },
    linkedin: {
      output: 'Write a LinkedIn post for Great.Cards.',
      structure: [
        'Hook line — bold statement matching the hook angle above. No emoji on first line.',
        '[blank line]',
        'Body 200-280 words, short paragraphs matching tone/audience above. Specific ₹ numbers.',
        '3-5 hashtags',
      ],
    },
  };

  const common = {
    formula_note: 'net_savings = annual_rewards + milestone_benefits - annual_fee. Joining fee is excluded (one-time Year 1 cost, not recurring).',
    anti_hallucination: [
      'NEVER invent reward rates not present in the card data returned by this tool.',
      'NEVER claim a card is "free" unless annual_fee shows "Free".',
      'Use ONLY real ₹ numbers from the data in this tool response.',
    ],
  };

  const mustUseToolReminder = {
    critical: 'NEVER answer follow-up questions about card categories from training knowledge. If the user asks about another category, call generate_content_brief again for that category.',
    format_rule: fmt === 'carousel'
      ? 'Return ONLY the JSON object. No preamble, no markdown fences.'
      : 'Write the content directly. Do NOT show raw JSON from this tool response.',
  };

  const baseStructures: Record<string, string[]> = {
    category_best_cards: [
      `1. Intro: Who should read this (${subject || 'category'} spenders) and what they'll learn.`,
      '2. Quick comparison table: top 3-4 cards with fee, top reward rate, and net savings/yr at mid-tier spend.',
      '3. Per-composition section: if multiple compositions, show "If you shop mostly on Amazon vs Flipkart" with the winner for each.',
      '4. Spend-tier table: net savings at each tier for the top 2 cards. Explain WHY one card overtakes another at the crossover point.',
      '5. Card deep-dives: for each top card — fee, fee waiver, reward caps, best use case, 1-line verdict.',
      '6. Summary table + recommendation by persona.',
      '7. CTA: Apply via Great.Cards.',
    ],
    card_comparison: [
      '1. Intro: these two cards are often compared — here\'s who each is for.',
      '2. Side-by-side table: fee, joining fee, key benefits, reward rate, net savings (if spend_profile provided).',
      '3. Winner per spending category from spending_breakdown.',
      '4. Fee waiver: does one waive the fee at a reachable spend level?',
      '5. Verdict: Card A wins if X, Card B wins if Y.',
      '6. CTA.',
    ],
    persona_guide: [
      `1. Intro: Meet ${subject || 'the persona'} — describe their spend profile in plain English.`,
      '2. Top card recommendation with WHY it fits this persona\'s spending pattern.',
      '3. Ranked table of top 3-4 cards with net savings at persona\'s spend level.',
      '4. For each card: which spend categories it rewards most (from spending_breakdown).',
      '5. Fee payback for any paid cards.',
      '6. CTA.',
    ],
    upgrade_path: [
      '1. Intro: You\'ve had your free card a while. Here\'s when it\'s time to upgrade.',
      '2. Side-by-side at the crossover spend level — show the exact point where upgrade pays off.',
      '3. Spend-tier table: free card vs paid card net savings across all tiers.',
      '4. Fee waiver check: if the paid card waives its fee, upgrading becomes even easier.',
      '5. Non-monetary benefits of the paid card (lounge, insurance, concierge).',
      '6. Final verdict: "Upgrade if you spend ₹X/month or more on [category]."',
      '7. CTA.',
    ],
    fee_justification: [
      `1. Intro: ${subject || 'This card'} charges ₹X/yr. Is it worth it?`,
      '2. Break-even analysis: at what monthly spend does the card pay for itself.',
      '3. Spend-tier table: net savings (rewards minus fee) at each level.',
      '4. Fee payback months at mid-tier spend.',
      '5. Fee waiver: if applicable, show the spend threshold.',
      '6. Verdict: "Worth it for spenders above ₹X/month. Below that, look at [free alternative]."',
      '7. CTA.',
    ],
    bank_ranking: [
      `1. Intro: ${subject || 'This bank'} has X cards. Here\'s how they rank.`,
      '2. Quick overview table: all cards ranked by fee tier, with top benefit.',
      '3. Category-by-category winner (if spend_profile used): which card wins for fuel, travel, shopping etc.',
      '4. Deep-dive on top 3: fee, fee waiver, key benefits, net savings estimate.',
      '5. Summary: pick card X if [profile], card Y if [profile].',
      '6. CTA.',
    ],
  };

  const formatInstructions = FORMAT_INSTRUCTIONS[fmt] || FORMAT_INSTRUCTIONS['blog'];

  return {
    ...common,
    ...mustUseToolReminder,
    ...(Object.keys(writingParams).length > 0 && { writing_parameters: writingParams }),
    output_format: fmt,
    format_instructions: formatInstructions,
    // For blog: use the content-type-specific structure; for other formats the format_instructions structure takes precedence
    ...(fmt === 'blog' && baseStructures[contentType] && { article_structure: baseStructures[contentType] }),
  };
}
