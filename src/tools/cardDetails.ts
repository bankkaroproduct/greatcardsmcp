import { z } from 'zod';
import { apiClient } from '../api/client.js';
import { feeCalc } from '../enrichment/feeUtils.js';

export const cardDetailsSchema = z.object({
  card_alias: z.string().describe('The SEO alias/slug of the card (e.g. "hdfc-regalia-gold-credit-card")'),
});

function stripHtml(html: string): string {
  return (html || '')
    .replace(/<li>/gi, '\n• ')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function naToNull(val: any): string | null {
  if (!val || val === 'N/A' || val === 'NA' || val === '') return null;
  return String(val).trim();
}

export async function getCardDetails(input: z.infer<typeof cardDetailsSchema>) {
  const response = await apiClient.getCardDetails(input.card_alias);
  const raw = response?.data;
  const card = Array.isArray(raw) ? raw[0] : raw;

  if (!card) {
    return { error: `Card not found: ${input.card_alias}` };
  }

  const joining = feeCalc(card.joining_fee_text);
  const annual = feeCalc(card.annual_fee_text);
  const bfs = card.bank_fee_structure || {};

  // Parse late payment slabs into structured array
  const lateSlabs: { outstanding: string; fee: string }[] = [];
  if (bfs.late_payment_annual && bfs.late_payment_fine) {
    const slabRanges = bfs.late_payment_annual.split('|').map((s: string) => s.trim());
    const slabFees = bfs.late_payment_fine.split('|').map((s: string) => s.trim());
    slabRanges.forEach((range: string, i: number) => {
      if (range && slabFees[i]) {
        lateSlabs.push({ outstanding: range, fee: slabFees[i] });
      }
    });
  }

  return {
    name: card.card_name || card.name,
    bank: card.banks?.name || card.banks?.[0]?.name || card.bank_name || '',
    bank_id: card.bank_id || null,
    card_type: card.card_type,
    rating: card.rating,
    user_ratings: card.user_rating_count,
    image: card.card_bg_image || card.image,

    fees: {
      joining: joining.inline,
      annual: annual.inline,
      annual_fee_waiver: naToNull(card.annual_fee_waiver),
      gst_note: 'All fees include 18% GST.',
    },

    fee_schedule: {
      apr_monthly: naToNull(bfs.apr_fees),
      apr_annual: bfs.apr_fees
        ? (() => {
            const m = parseFloat(bfs.apr_fees);
            return isNaN(m) ? null : `${(m * 12).toFixed(2)}%`;
          })()
        : null,
      forex_markup: naToNull(bfs.forex_markup),
      forex_markup_note: stripHtml(bfs.forex_markup_comment) || null,
      atm_withdrawal_fee: naToNull(bfs.atm_withdrawal),
      atm_withdrawal_note: stripHtml(bfs.atm_withdrawal_comment) || null,
      railway_surcharge: naToNull(bfs.railway_surcharge),
      railway_surcharge_note: stripHtml(bfs.railway_surcharge_comment) || null,
      rent_payment_fee: naToNull(bfs.rent_payment_fees),
      cash_payment_fee: naToNull(bfs.cash_payment_fees),
      cheque_payment_fee: naToNull(bfs.check_payment_fees),
      reward_redemption_fee: naToNull(bfs.reward_redemption_fees),
      late_payment_slabs: lateSlabs.length ? lateSlabs : null,
      late_payment_note: stripHtml(bfs.late_payment_comment) || null,
      tnc_url: naToNull(bfs.link),
    },

    rewards: {
      point_value: naToNull(card.reward_conversion_rate),
      redemption_options: stripHtml(card.redemption_options) || null,
      redemption_catalogue: naToNull(card.redemption_catalogue),
      exclusions: naToNull(card.exclusion_earnings),
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

    detailed_benefits: (card.product_benefits || []).map((b: any) => ({
      type: (b.benefit_type || '').trim(),
      sub_type: (b.sub_type || '').trim(),
      details: stripHtml(b.html_text),
    })),

    eligibility: {
      min_age: card.min_age ?? null,
      max_age: card.max_age ?? null,
      income_salaried_lpa: card.income_salaried ? parseFloat(card.income_salaried) : null,
      income_self_emp_lpa: card.income_self_emp ? parseFloat(card.income_self_emp) : null,
      min_income_monthly: card.income ? parseInt(card.income) : null,
      crif_salaried: card.crif ? parseInt(card.crif) : null,
      crif_self_emp: card.crif_self_emp ? parseInt(card.crif_self_emp) : null,
    },

    card_alias: card.seo_card_alias || input.card_alias,
  };
}
