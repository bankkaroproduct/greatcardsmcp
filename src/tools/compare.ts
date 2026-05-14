import { z } from 'zod';
import { apiClient } from '../api/client.js';
import { feeCalc } from '../enrichment/feeUtils.js';

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
      const bfs = card.bank_fee_structure || {};

      const lateSlabs: { outstanding: string; fee: string }[] = [];
      if (bfs.late_payment_annual && bfs.late_payment_fine) {
        const slabRanges = bfs.late_payment_annual.split('|').map((s: string) => s.trim());
        const slabFees = bfs.late_payment_fine.split('|').map((s: string) => s.trim());
        slabRanges.forEach((range: string, i: number) => {
          if (range && slabFees[i]) lateSlabs.push({ outstanding: range, fee: slabFees[i] });
        });
      }

      return {
        name: card.card_name || card.name,
        bank: card.banks?.name || card.banks?.[0]?.name || card.bank_name || '',
        card_type: card.card_type,
        card_network: card.card_network || card.network || null,
        rating: card.rating,
        invite_only: card.invite_only ?? false,
        employment_type: card.employment_type || 'both',

        fees: {
          joining: joining.inline,
          joining_note: naToNull(card.joining_fee_comment),
          annual: annual.inline,
          annual_note: naToNull(card.annual_fee_comment),
          annual_fee_waiver: naToNull(card.annual_fee_waiver),
          gst_note: 'All fees include 18% GST.',
        },

        fee_schedule: {
          apr_monthly: naToNull(bfs.apr_fees),
          apr_annual: bfs.apr_fees ? (() => { const m = parseFloat(bfs.apr_fees); return isNaN(m) ? null : `${(m * 12).toFixed(2)}%`; })() : null,
          forex_markup: naToNull(bfs.forex_markup),
          atm_withdrawal_fee: naToNull(bfs.atm_withdrawal),
          late_payment_slabs: lateSlabs.length ? lateSlabs : null,
          tnc_url: naToNull(bfs.link),
        },

        rewards: {
          point_value: naToNull(card.reward_conversion_rate),
          redemption_options: stripHtml(card.redemption_options) || null,
          exclusions: naToNull(card.exclusion_earnings),
          exclusion_spends: naToNull(card.exclusion_spends),
        },

        key_benefits: (card.product_usps || [])
          .sort((a: any, b: any) => (a.priority || 99) - (b.priority || 99))
          .map((u: any) => ({ title: u.header, description: u.description })),

        eligibility: {
          min_age: card.min_age ?? null,
          max_age: card.max_age ?? null,
          income_salaried_lpa: card.income_salaried ? parseFloat(card.income_salaried) : null,
          income_self_emp_lpa: card.income_self_emp ? parseFloat(card.income_self_emp) : null,
          crif_salaried: card.crif ? parseInt(card.crif) : null,
          crif_self_emp: card.crif_self_emp ? parseInt(card.crif_self_emp) : null,
        },

        tags: (card.tags || []).map((t: any) => t.name),
        card_alias: card.seo_card_alias,
        image: card.card_bg_image || card.image,
      };
    }),
  };
}
