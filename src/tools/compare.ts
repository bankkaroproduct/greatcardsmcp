import { z } from 'zod';
import { apiClient } from '../api/client.js';
import { feeCalc } from '../enrichment/feeUtils.js';

const LLM_CONTEXT = {
  _llm_instructions: {
    output_format: {
      table_rule: 'ALWAYS use a markdown comparison table. Columns: Feature | Card A | Card B (| Card C if 3). Rows: Fee, Fee Waiver, Top Reward, Lounge Access, Key Benefit, Verdict.',
      fee_waiver_flag: 'If a card has a fee waiver condition, flag it: "⚡ Fee waived on ₹X annual spend". A waivable ₹10K card is fundamentally different from a non-waivable one.',
      monthly_framing: 'When showing fee or savings numbers, add monthly equivalent: "₹11,800/yr (₹983/mo)".',
      bold_winner: 'In each row, bold the winning card\'s value so the user can scan vertically.',
    },
    how_to_present: [
      'Present as a clear head-to-head comparison, NOT raw data.',
      'Structure: for each dimension (fees, rewards, lounge access, etc.), state which card wins and by how much.',
      'End with a verdict: "If you prioritize X, go with Card A. If you care more about Y, Card B is better."',
      'Mention what NEITHER card does well, if relevant to the user\'s needs.',
    ],
    next_actions: [
      'Help the user decide: "Based on your spending, I\'d lean toward [Card X] because..."',
      'Offer personalized ranking: "Want me to calculate exactly how much you\'d save with each card?" → use recommend_cards.',
      'Offer eligibility: "Want to check if you qualify for both?" → use check_eligibility.',
      'ALWAYS end with a clear CTA — never just dump data and stop.',
    ],
    anti_hallucination: [
      'ONLY compare attributes present in the response data — don\'t invent missing features.',
      'If a card has no tags or key_benefits, say "limited data available" — don\'t fill in from memory.',
      'If annual_fee_waiver shows "N/A", don\'t claim the fee can be waived.',
    ],
    context_check: 'If you haven\'t called get_advisor_context yet, do so with topic="domain_knowledge" for card positioning and bank strength context to enrich the comparison.',
  },
};

export const compareCardsSchema = z.object({
  card_aliases: z.array(z.string()).min(2).max(3).describe('2-3 card aliases to compare (e.g. ["hdfc-regalia-gold-credit-card", "axis-magnus-credit-card"])'),
});

export async function compareCards(input: z.infer<typeof compareCardsSchema>) {
  const details = await Promise.all(
    input.card_aliases.map(async (alias) => {
      try {
        const response = await apiClient.getCardDetails(alias);
        const raw = response?.data;
        return Array.isArray(raw) ? raw[0] : raw;
      } catch {
        return null;
      }
    })
  );

  const cards = details.filter(Boolean);

  if (cards.length < 2) {
    return { error: 'Could not fetch enough cards for comparison. Check the aliases provided.' };
  }

  return {
    comparison: cards.map((card: any) => {
      const joining = feeCalc(card.joining_fee_text);
      const annual = feeCalc(card.annual_fee_text);

      return {
        name: card.card_name || card.name,
        bank: card.banks?.[0]?.name || card.bank_name || '',
        card_type: card.card_type,
        rating: card.rating,
        fees: {
          joining: joining.inline,
          annual: annual.inline,
          annual_fee_waiver: card.annual_fee_waiver || 'N/A',
        },
        key_benefits: (card.product_usps || [])
          .sort((a: any, b: any) => (a.priority || 99) - (b.priority || 99))
          .map((u: any) => ({ title: u.header, description: u.description })),
        tags: (card.tags || []).map((t: any) => t.name),
        minimum_spend: card.minimum_spend || 'N/A',
        reward_conversion_rate: card.reward_conversion_rate || 'N/A',
        card_alias: card.seo_card_alias,
        image: card.card_bg_image || card.image,
      };
    }),
    ...LLM_CONTEXT,
  };
}
