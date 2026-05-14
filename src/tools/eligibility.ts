import { z } from 'zod';
import { apiClient } from '../api/client.js';
import { feeCalc } from '../enrichment/feeUtils.js';

export const checkEligibilitySchema = z.object({
  pincode: z.string().length(6).describe('6-digit Indian pincode. Common city codes: Delhi 110001, Mumbai 400001, Bangalore 560001, Hyderabad 500001, Chennai 600001, Kolkata 700001, Pune 411001, Ahmedabad 380001, Gurgaon 122001, Noida 201301. Ask the user if not provided.'),
  annual_income: z.string().describe('Annual in-hand income in ₹ as a string (e.g. "1200000" for 12 LPA). Convert from monthly: multiply by 12. Convert from LPA: "10 LPA" = "1000000". Convert from "per month": "1L/month" = "1200000"'),
  employment_status: z.enum(['salaried', 'self_employed']).describe('"salaried" = full-time employee, part-time, contract. "self_employed" = freelancer, business owner, consultant, gig worker, professional (doctor/lawyer/CA with own practice)'),
});

export async function checkEligibility(input: z.infer<typeof checkEligibilitySchema>) {
  const response = await apiClient.checkEligibility({
    pincode: input.pincode,
    inhandIncome: input.annual_income,
    empStatus: input.employment_status,
  });

  const cards = Array.isArray(response?.data?.cards) ? response.data.cards : (Array.isArray(response?.data) ? response.data : []);

  return {
    eligible_cards_count: cards.length,
    profile: {
      pincode: input.pincode,
      annual_income: `₹${Number(input.annual_income).toLocaleString('en-IN')}`,
      employment: input.employment_status,
    },
    eligible_cards: cards.slice(0, 15).map((card: any) => {
      const joining = feeCalc(card.joining_fee_text);
      const annual = feeCalc(card.annual_fee_text);

      return {
        name: card.card_name || card.name,
        bank: card.banks?.name || card.banks?.[0]?.name || card.bank_name || '',
        joining_fee: joining.inline,
        annual_fee: annual.inline,
        rating: card.rating ?? null,
        invite_only: card.invite_only ?? false,
        employment_type: card.employment_type || 'both',
        new_to_credit: card.new_to_credit ?? false,
        key_benefits: (card.product_usps || [])
          .sort((a: any, b: any) => (a.priority || 99) - (b.priority || 99))
          .slice(0, 3)
          .map((u: any) => (u.header || '').trim()),
        tags: (card.tags || []).map((t: any) => t.name),
        card_alias: card.seo_card_alias,
        image: card.card_bg_image || card.image || null,
      };
    }),
  };
}
