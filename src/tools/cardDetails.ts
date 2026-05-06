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
        title: (usp.header || '').trim(),
        description: (usp.description || '').trim(),
      }))
      .filter((usp: any, idx: number, arr: any[]) =>
        arr.findIndex((u: any) => u.title === usp.title) === idx
      ),
    tags: (card.tags || []).map((t: any) => t.name),
    minimum_spend: card.minimum_spend,
    reward_conversion_rate: card.reward_conversion_rate,
    detailed_benefits: (card.product_benefits || []).map((b: any) => ({
      type: (b.benefit_type || '').trim(),
      sub_type: (b.sub_type || '').trim(),
      details: (b.html_text || '')
        .replace(/<li>/gi, '\n• ')
        .replace(/<[^>]+>/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim(),
    })),
    eligibility: {
      min_age: card.min_age ?? null,
      max_age: card.max_age ?? null,
      income_salaried_lpa: card.income_salaried ? parseFloat(card.income_salaried) : null,
      income_self_emp_lpa: card.income_self_emp ? parseFloat(card.income_self_emp) : null,
      min_income_monthly: card.income ? parseInt(card.income) : null,
      crif_salaried: card.crif ? parseInt(card.crif) : null,
      crif_self_emp: card.crif_self_emp ? parseInt(card.crif_self_emp) : null,
      notes: [card.crif_comment, card.income_comment].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i)[0] || null,
    },
    card_alias: card.seo_card_alias || input.card_alias,
  };
}
