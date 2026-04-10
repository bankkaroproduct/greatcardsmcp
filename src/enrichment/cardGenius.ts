import { apiClient } from '../api/client.js';
import { feeCalc } from './feeUtils.js';

export interface CardGeniusResult {
  card_name: string;
  card_bg_image?: string;
  seo_card_alias: string;
  id?: number | string;
  joining_fees: number;
  joining_fee_text?: string;
  annual_fee_text?: string;
  total_savings: number;
  total_savings_yearly: number;
  total_extra_benefits: number;
  milestone_benefits_only?: number;
  airport_lounge_value?: number;
  domestic_lounge_value?: number;
  international_lounge_value?: number;
  net_savings: number;
  voucher_of?: string | number;
  voucher_bonus?: string | number;
  welcome_benefits: unknown[];
  domestic_lounges_unlocked?: number;
  international_lounges_unlocked?: number;
  annual_fees?: number;
  spending_breakdown: Record<string, {
    on: string;
    spend: number;
    points_earned: number;
    savings: number;
    explanation: string[];
    conv_rate: number;
    maxCap?: number;
  }>;
  image?: string;
  banks?: unknown;
  bank_name?: string;
  rating?: number | string;
  minimum_spend?: string | number;
  network_url?: string;
  card_type?: string;
}

const RUPEE_DOMESTIC_LOUNGE = 750;
const RUPEE_INTERNATIONAL_LOUNGE = 1250;

function parseNumber(value: unknown, fallback = 0): number {
  if (value === null || value === undefined) return fallback;
  const num = Number(String(value).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(num) ? num : fallback;
}

function extractDetail(detail: unknown): any {
  if (!detail) return null;
  if (Array.isArray(detail)) return detail[0] ?? null;
  return detail;
}

function mergeBenefits(saving: any, detail: any): unknown[] {
  const list =
    saving?.welcomeBenefits ??
    saving?.welcome_benefits ??
    detail?.welcomeBenefits ??
    detail?.welcome_benefits ??
    [];
  return Array.isArray(list) ? list : [];
}

export interface EnrichOptions {
  savings: any[];
  responses: Record<string, number>;
  fetchDetails?: boolean;
}

export async function enrichCardGeniusResults({
  savings,
  responses,
  fetchDetails = true,
}: EnrichOptions): Promise<CardGeniusResult[]> {
  const userDomesticLoungeVisits = Number(responses['domestic_lounge_usage_quarterly'] || 0) || 0;
  const userInternationalLoungeVisits = Number(responses['international_lounge_usage_quarterly'] || 0) || 0;

  const processed = await Promise.all(
    (savings || []).map(async (saving) => {
      try {
        let cardDetails: any = null;

        // The calculate API uses seo_card_alias (not card_alias)
        const cardAlias = saving?.card_alias || saving?.seo_card_alias;
        if (fetchDetails && cardAlias) {
          try {
            const detailResponse = await apiClient.getCardDetails(cardAlias);
            cardDetails = extractDetail(detailResponse?.data);
          } catch {
            // Card details fetch failed — continue with saving data only
          }
        }

        const travelBenefits = saving?.travel_benefits || cardDetails?.travel_benefits || {};
        const domesticAllowance = parseNumber(
          saving?.domestic_lounges_unlocked ?? travelBenefits?.domestic_lounges_unlocked ?? travelBenefits?.domestic_lounges,
          0
        );
        const internationalAllowance = parseNumber(
          saving?.international_lounges_unlocked ?? travelBenefits?.international_lounges_unlocked ?? travelBenefits?.international_lounges,
          0
        );

        const actualDomesticVisits = Math.min(userDomesticLoungeVisits, domesticAllowance);
        const actualInternationalVisits = Math.min(userInternationalLoungeVisits, internationalAllowance);
        const domesticLoungeValue = actualDomesticVisits * RUPEE_DOMESTIC_LOUNGE;
        const internationalLoungeValue = actualInternationalVisits * RUPEE_INTERNATIONAL_LOUNGE;
        const loungeValue = domesticLoungeValue + internationalLoungeValue;

        // Prefer cardDetails for fees — the calculate API often returns "0" even for paid cards.
        // cardDetails (from /card-detail) is the authoritative fee source.
        const joiningFeeRaw = cardDetails?.joining_fee_text || saving?.joining_fee_text;
        const annualFeeRaw = cardDetails?.annual_fee_text || saving?.annual_fee_text;
        const joiningFees = feeCalc(joiningFeeRaw).withGST;
        const annualFee = feeCalc(annualFeeRaw).withGST;
        const totalSavingsYearly = parseNumber(saving?.total_savings_yearly ?? saving?.total_savings ?? cardDetails?.total_savings_yearly);
        const milestoneOnly = parseNumber(
          saving?.total_extra_benefits ?? saving?.milestone_benefits_only ?? cardDetails?.total_extra_benefits,
          0
        );
        const totalSavings = parseNumber(saving?.total_savings ?? cardDetails?.total_savings, 0);

        // Joining fee is a one-time Year 1 cost — not subtracted from annual savings
        const netSavings = Math.round(totalSavingsYearly + milestoneOnly + loungeValue - annualFee);

        return {
          card_name: cardDetails?.card_name || saving?.card_name || saving?.card_alias || '',
          id: saving?.card_id ?? cardDetails?.id,
          card_bg_image: saving?.card_bg_image || cardDetails?.card_bg_image || cardDetails?.card_image || cardDetails?.image || '',
          seo_card_alias: cardDetails?.seo_card_alias || saving?.seo_card_alias || saving?.card_alias,
          joining_fees: joiningFees,
          joining_fee_text: joiningFeeRaw || '0',
          annual_fee_text: annualFeeRaw || '0',
          total_savings: totalSavings,
          total_savings_yearly: totalSavingsYearly,
          total_extra_benefits: milestoneOnly,
          milestone_benefits_only: milestoneOnly,
          airport_lounge_value: loungeValue,
          domestic_lounge_value: domesticLoungeValue,
          international_lounge_value: internationalLoungeValue,
          net_savings: netSavings,
          voucher_of: saving?.voucher_of ?? cardDetails?.voucher_of ?? 0,
          voucher_bonus: saving?.voucher_bonus ?? cardDetails?.voucher_bonus ?? 0,
          welcome_benefits: mergeBenefits(saving, cardDetails),
          domestic_lounges_unlocked: domesticAllowance,
          international_lounges_unlocked: internationalAllowance,
          annual_fees: annualFee,
          spending_breakdown:
            saving?.spending_breakdown ||
            cardDetails?.spending_breakdown ||
            (Array.isArray(saving?.spending_breakdown_array)
              ? Object.fromEntries(
                  saving.spending_breakdown_array.map((item: any, idx: number) => [`category_${idx}`, item])
                )
              : {}),
          image: cardDetails?.image || saving?.card_bg_image,
          banks: cardDetails?.banks || saving?.banks,
          bank_name: cardDetails?.banks?.[0]?.name || cardDetails?.bank_name || saving?.bank_name || '',
          rating: cardDetails?.rating || saving?.rating || '',
          network_url: cardDetails?.network_url || saving?.network_url,
          card_type: cardDetails?.card_type || saving?.card_type,
        } as CardGeniusResult;
      } catch {
        return null;
      }
    })
  );

  return processed
    .filter((card): card is CardGeniusResult => Boolean(card))
    .filter((card) => card.net_savings > 0)
    .sort((a, b) => b.net_savings - a.net_savings);
}
