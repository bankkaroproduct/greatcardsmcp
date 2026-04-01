import { z } from 'zod';
import { apiClient } from '../api/client.js';
import { feeCalc } from '../enrichment/feeUtils.js';

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
  };
}
