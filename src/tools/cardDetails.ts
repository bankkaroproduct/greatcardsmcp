import { z } from 'zod';
import { apiClient } from '../api/client.js';
import { feeCalc } from '../enrichment/feeUtils.js';

const LLM_CONTEXT = {
  _llm_instructions: {
    how_to_present: [
      'Lead with the card name, bank, and a one-line positioning (e.g. "A premium travel card from HDFC with strong lounge and flight rewards").',
      'Show fees clearly: joining fee, annual fee, AND the fee waiver condition if available.',
      'List the top 3-5 key_benefits that are most relevant to the user\'s stated interests.',
      'Mention the rating if available.',
      'For detailed_benefits: only mention the ones relevant to the user\'s context — don\'t dump everything.',
    ],
    next_actions: [
      'Offer comparison: "Want me to compare this with another card?" → use compare_cards.',
      'Offer personalized check: "Want to see if this card is actually the BEST for your spending? Tell me your top 2-3 monthly expenses." → use recommend_cards.',
      'Offer eligibility: "Want to check if you qualify?" → use check_eligibility.',
      'If user came from recommend_cards: reinforce WHY this card was recommended for their spending.',
    ],
    anti_hallucination: [
      'NEVER invent reward rates not present in key_benefits or detailed_benefits.',
      'NEVER say "this card has X% cashback" unless the data explicitly says so.',
      'If annual_fee_waiver is null/N/A, say "no published fee waiver" — don\'t guess.',
      'The fees shown include 18% GST. Don\'t add GST again.',
    ],
  },
};

export const cardDetailsSchema = z.object({
  card_alias: z.string().describe('The SEO alias/slug of the card (e.g. "hdfc-regalia-gold-credit-card")'),
});

export async function getCardDetails(input: z.infer<typeof cardDetailsSchema>) {
  const response = await apiClient.getCardDetails(input.card_alias);
  const raw = response?.data;
  const card = Array.isArray(raw) ? raw[0] : raw;

  if (!card) {
    return { error: `Card not found: ${input.card_alias}` };
  }

  const joining = feeCalc(card.joining_fee_text);
  const annual = feeCalc(card.annual_fee_text);

  return {
    name: card.card_name || card.name,
    bank: card.banks?.[0]?.name || card.bank_name || '',
    card_type: card.card_type,
    rating: card.rating,
    user_ratings: card.user_rating_count,
    image: card.card_bg_image || card.image,
    fees: {
      joining: joining.inline,
      annual: annual.inline,
      annual_fee_waiver: card.annual_fee_waiver || null,
    },
    key_benefits: (card.product_usps || [])
      .sort((a: any, b: any) => (a.priority || 99) - (b.priority || 99))
      .map((usp: any) => ({
        title: usp.header,
        description: usp.description,
      })),
    tags: (card.tags || []).map((t: any) => t.name),
    minimum_spend: card.minimum_spend,
    reward_conversion_rate: card.reward_conversion_rate,
    detailed_benefits: (card.product_benefits || []).map((b: any) => ({
      type: b.benefit_type,
      sub_type: b.sub_type,
      details: b.html_text,
    })),
    card_alias: card.seo_card_alias || input.card_alias,
    ...LLM_CONTEXT,
  };
}
