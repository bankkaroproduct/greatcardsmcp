import { authManager } from './auth.js';
import { cache } from '../cache/cache.js';

const BASE_URL = (process.env.PARTNER_BASE_URL || 'https://uat-platform.bankkaro.com/partner').replace(/\/$/, '');

export interface SpendingData {
  amazon_spends?: number;
  flipkart_spends?: number;
  other_online_spends?: number;
  other_offline_spends?: number;
  grocery_spends_online?: number;
  online_food_ordering?: number;
  fuel?: number;
  dining_or_going_out?: number;
  flights_annual?: number;
  hotels_annual?: number;
  domestic_lounge_usage_quarterly?: number;
  international_lounge_usage_quarterly?: number;
  mobile_phone_bills?: number;
  electricity_bills?: number;
  water_bills?: number;
  insurance_health_annual?: number;
  insurance_car_or_bike_annual?: number;
  rent?: number;
  school_fees?: number;
  offline_grocery?: number;
  life_insurance?: number;
}

export interface CardListingParams {
  slug?: string;
  banks_ids?: number[];
  card_networks?: string[];
  annualFees?: string;
  credit_score?: string;
  sort_by?: string;
  free_cards?: string;
  eligiblityPayload?: {
    pincode?: string;
    inhandIncome?: string;
    empStatus?: string;
  };
  cardGeniusPayload?: unknown[];
}

async function apiGet<T>(path: string, cacheKey?: string): Promise<T> {
  if (cacheKey) {
    const cached = cache.get<T>(cacheKey);
    if (cached) return cached;
  }

  const response = await authManager.authenticatedFetch(`${BASE_URL}${path}`);
  if (!response.ok) {
    throw new Error(`API error ${response.status}: ${await response.text()}`);
  }
  const data = await response.json();

  if (cacheKey) {
    cache.set(cacheKey, data);
  }
  return data;
}

async function apiPost<T>(path: string, body: unknown, cacheKey?: string): Promise<T> {
  if (cacheKey) {
    const cached = cache.get<T>(cacheKey);
    if (cached) return cached;
  }

  const response = await authManager.authenticatedFetch(`${BASE_URL}${path}`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`API error ${response.status}: ${await response.text()}`);
  }
  const data = await response.json();

  if (cacheKey) {
    cache.set(cacheKey, data);
  }
  return data;
}

export const apiClient = {
  getInitBundle() {
    return apiGet<any>('/cardgenius/init-bundle', 'init-bundle');
  },

  getCardDetails(alias: string) {
    return apiGet<any>(`/cardgenius/cards/${alias}`, `card:${alias}`);
  },

  async calculateCardGenius(spendingData: SpendingData) {
    // Build full 21-key payload (production API accepts all keys)
    const fullPayload: SpendingData = {
      amazon_spends: 0,
      flipkart_spends: 0,
      other_online_spends: 0,
      other_offline_spends: 0,
      grocery_spends_online: 0,
      offline_grocery: 0,
      online_food_ordering: 0,
      fuel: 0,
      dining_or_going_out: 0,
      flights_annual: 0,
      hotels_annual: 0,
      domestic_lounge_usage_quarterly: 0,
      international_lounge_usage_quarterly: 0,
      mobile_phone_bills: 0,
      electricity_bills: 0,
      water_bills: 0,
      insurance_health_annual: 0,
      insurance_car_or_bike_annual: 0,
      life_insurance: 0,
      rent: 0,
      school_fees: 0,
      ...spendingData,
    };
    const key = `calc:${JSON.stringify(fullPayload)}`;

    try {
      return await apiPost<any>('/cardgenius/calculate', fullPayload, key);
    } catch (err: any) {
      // UAT rejects offline_grocery & life_insurance — fall back to merging them
      if (err.message?.includes('not allowed')) {
        const { offline_grocery, life_insurance, ...coreSpending } = fullPayload;
        if (offline_grocery) {
          coreSpending.other_offline_spends = (coreSpending.other_offline_spends || 0) + offline_grocery;
        }
        if (life_insurance) {
          coreSpending.insurance_health_annual = (coreSpending.insurance_health_annual || 0) + life_insurance;
        }
        const fallbackKey = `calc-fb:${JSON.stringify(coreSpending)}`;
        return await apiPost<any>('/cardgenius/calculate', coreSpending, fallbackKey);
      }
      throw err;
    }
  },

  getCardListing(params: CardListingParams) {
    const fullParams = {
      slug: params.slug || '',
      banks_ids: params.banks_ids || [],
      card_networks: params.card_networks || [],
      annualFees: params.annualFees || '',
      credit_score: params.credit_score || '',
      sort_by: params.sort_by || '',
      free_cards: params.free_cards || '',
      eligiblityPayload: params.eligiblityPayload || {},
      cardGeniusPayload: params.cardGeniusPayload || [],
    };
    const key = `listing:${JSON.stringify(fullParams)}`;
    return apiPost<any>('/cardgenius/cards', fullParams, key);
  },

  // Eligibility is user-specific — short cache (5 min)
  checkEligibility(params: {
    pincode: string;
    inhandIncome: string;
    empStatus: 'salaried' | 'self_employed';
  }) {
    const body = {
      slug: '',
      banks_ids: [],
      card_networks: [],
      annualFees: '',
      credit_score: '',
      sort_by: '',
      free_cards: '',
      eligiblityPayload: {
        pincode: params.pincode,
        inhandIncome: params.inhandIncome,
        empStatus: params.empStatus,
      },
      cardGeniusPayload: [],
    };
    const key = `elig:${params.pincode}:${params.inhandIncome}:${params.empStatus}`;
    return apiPost<any>('/cardgenius/cards', body, key);
  },
};
