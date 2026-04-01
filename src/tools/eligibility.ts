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
        bank: card.banks?.[0]?.name || card.bank_name || '',
        joining_fee: joining.inline,
        annual_fee: annual.inline,
        tags: (card.tags || []).map((t: any) => t.name),
        card_alias: card.seo_card_alias,
      };
    }),
    _llm_instructions: {
      how_to_present: [
        `Present the count first: "Based on your income of ${input.annual_income} and location, you're eligible for X cards."`,
        'Group by fee tier: "Free/low-fee options: ...", "Mid-range: ...", "Premium: ..."',
        'If count is 0: "Your income/location combination doesn\'t match any cards in our database. Consider: (a) checking again with updated income, (b) looking at secured credit cards."',
        'If count is high (20+): "You qualify for many cards! To find the BEST one, I need your spending details."',
      ],
      next_actions: [
        'ALWAYS follow up with spending collection: "Now that we know which cards you qualify for, let\'s find the one that saves you the most. What do you spend the most on — shopping, dining, travel, fuel, or bills?"',
        'Then use recommend_cards with their spending to rank the eligible cards.',
        'If user asks about a specific eligible card: use get_card_details with the card_alias.',
        'If user wants to compare: use compare_cards with 2-3 card_alias values.',
      ],
      anti_hallucination: [
        'NEVER claim a card is "easy to get" or "guaranteed approval" — eligibility just means the user meets minimum criteria.',
        'NEVER invent income requirements not in the data.',
        'Use card_alias from this response for follow-up calls.',
      ],
      income_context: 'Rough income tiers: ₹3-5L = entry cards, ₹5-10L = mid-range, ₹10-15L = premium, ₹15L+ = super-premium, ₹25L+ = ultra-premium/invite-only.',
    },
  };
}
