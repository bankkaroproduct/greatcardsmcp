import { z } from 'zod';
import { apiClient } from '../api/client.js';
import { feeCalc } from '../enrichment/feeUtils.js';

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
  };
}
