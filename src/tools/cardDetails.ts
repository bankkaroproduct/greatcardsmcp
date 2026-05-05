import { z } from 'zod';
import { apiClient } from '../api/client.js';
import { feeCalc } from '../enrichment/feeUtils.js';

const LLM_CONTEXT = {
  _llm_instructions: {
    output_format: {
      fee_display: 'Show fees in a clear block: "💳 Joining: ₹X | Annual: ₹Y | ⚡ Waiver: [condition or "No waiver"]". Always include GST note.',
      monthly_framing: 'For fees above ₹1K, add monthly: "₹5,900/yr (₹492/mo)". Makes premium cards feel accessible.',
      fee_waiver_flag: 'If fee waiver exists, make it prominent — this is often the deciding factor. "⚡ Annual fee waived on ₹X spend/year".',
      benefits_structure: 'Group benefits: "🎁 Rewards" (cashback/points), "✈️ Travel" (lounges/miles), "🛡️ Insurance/Protection", "🎯 Special" (milestone/welcome). Only show groups relevant to user.',
    },
    how_to_present: [
      'Lead with the card name, bank, and a one-line positioning (e.g. "A premium travel card from HDFC with strong lounge and flight rewards").',
      'List the top 3-5 key_benefits most relevant to the user\'s stated interests — don\'t dump everything.',
      'Mention the rating if available.',
    ],
    next_actions: [
      'Offer comparison: "Want me to compare this with another card?" → use compare_cards.',
      'Offer personalized check: "Want to see if this card is actually the BEST for your spending? Tell me your top 2-3 monthly expenses." → use recommend_cards.',
      'Offer eligibility: "Want to check if you qualify?" → use check_eligibility.',
      'If user came from recommend_cards: reinforce WHY this card was recommended for their spending.',
      'ALWAYS end with a clear CTA — never just dump card details and stop.',
    ],
    eligibility_display: [
      'Show eligibility as: "✅ Age: X–Y | 💰 Min income: ₹X LPA (salaried) / ₹X LPA (self-employed) | 📊 Min CIBIL: XXX".',
      'income_salaried_lpa and income_self_emp_lpa are in Lakhs Per Annum — display as "₹X LPA".',
      'min_income_monthly is in ₹/month — use as fallback if LPA fields are null.',
      'If user shares their income/age/credit score, proactively check against these thresholds and tell them if they likely qualify.',
      'notes field contains internal guidance — do not show verbatim, use only to inform your advice.',
    ],
    anti_hallucination: [
      'NEVER invent reward rates not present in key_benefits or detailed_benefits.',
      'NEVER say "this card has X% cashback" unless the data explicitly says so.',
      'If annual_fee_waiver is null/N/A, say "no published fee waiver" — don\'t guess.',
      'The fees shown include 18% GST. Don\'t add GST again.',
    ],
    context_check: 'If you haven\'t called get_advisor_context yet, do so with topic="domain_knowledge" for fee structures, reward types, and bank positioning context.',
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
    ...LLM_CONTEXT,
  };
}
