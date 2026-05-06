import { z } from 'zod';
import { apiClient } from '../api/client.js';
import { feeCalc } from '../enrichment/feeUtils.js';


export const listCardsSchema = z.object({
  category: z.enum([
    'best-fuel-credit-card',
    'best-shopping-credit-card',
    'best-dining-credit-card',
    'best-travel-credit-card',
    'best-cards-grocery-shopping',
    'online-food-ordering',
    'best-utility-credit-card',
    '',
  ]).optional().default('').describe('Card category filter. Map user intent: "premium/luxury/lounge" → best-travel-credit-card, "cashback/shopping/online" → best-shopping-credit-card, "petrol/diesel" → best-fuel-credit-card, "restaurants/cafes/bars" → best-dining-credit-card, "BigBasket/Blinkit/Zepto" → best-cards-grocery-shopping, "Swiggy/Zomato food delivery" → online-food-ordering, "bills/recharge/utilities" → best-utility-credit-card. Leave empty for all cards.'),
  annual_fees: z.string().optional().default('').describe('Fee range filter. "free" = lifetime free (LTF) cards. Ranges: "500-1000", "1000-2000", "2000-5000", "5000-10000", "10000+". When user says "no annual fee" or "LTF" or "lifetime free" → use "free". When user says "premium" they usually mean 5000+ fee range.'),
  card_networks: z.array(z.string()).optional().default([]).describe('Filter by card network: "Visa", "Mastercard", "RuPay", "American Express". User hints: "Amex" = "American Express", "works at Costco" = "Visa", "UPI linking" or "government cashback" = "RuPay", "international acceptance" = "Visa" or "Mastercard"'),
  bank_ids: z.array(z.number()).optional().default([]).describe('Filter by bank numeric IDs. Usually not needed unless user names a specific bank.'),
  credit_score: z.string().optional().default('').describe('Credit score filter'),
  sort_by: z.string().optional().default('').describe('Sort option (default: priority/popularity)'),
  free_cards: z.string().optional().default('').describe('Set to "true" for lifetime free cards only. Use when user says "free", "no fee", "LTF", "no annual charge", "zero fee"'),
  limit: z.number().optional().default(10).describe('Max cards to return (default 10)'),
  response_format: z.enum(['full', 'brief']).optional().default('full').describe('"full" = all details, "brief" = name + bank + fee only'),
});

export async function listCards(input: z.infer<typeof listCardsSchema>) {
  const { response_format, limit, ...params } = input;
  const response = await apiClient.getCardListing({
    slug: params.category,
    banks_ids: params.bank_ids,
    card_networks: params.card_networks,
    annualFees: params.annual_fees,
    credit_score: params.credit_score,
    sort_by: params.sort_by,
    free_cards: params.free_cards,
  });

  const cards = Array.isArray(response?.data?.cards) ? response.data.cards : (Array.isArray(response?.data) ? response.data : []);

  if (response_format === 'brief') {
    return {
      total_available: cards.length,
      showing: Math.min(cards.length, limit),
      cards: cards.slice(0, limit).map((card: any) => ({
        name: card.card_name || card.name,
        bank: card.banks?.[0]?.name || card.bank_name || '',
        joining_fee: feeCalc(card.joining_fee_text).inline,
        annual_fee: feeCalc(card.annual_fee_text).inline,
        card_alias: card.seo_card_alias,
      })),
    };
  }

  return {
    total_available: cards.length,
    showing: Math.min(cards.length, limit),
    cards: cards.slice(0, limit).map((card: any) => {
      const joining = feeCalc(card.joining_fee_text);
      const annual = feeCalc(card.annual_fee_text);

      return {
        name: card.card_name || card.name,
        bank: card.banks?.[0]?.name || card.bank_name || '',
        card_type: card.card_type,
        joining_fee: joining.inline,
        annual_fee: annual.inline,
        rating: card.rating,
        tags: (card.tags || []).map((t: any) => t.name),
        key_benefits: (card.product_usps || []).slice(0, 3).map((u: any) => u.header),
        card_alias: card.seo_card_alias,
        image: card.card_bg_image || card.image,
      };
    }),
  };
}
