import { authManager } from './auth.js';

const BASE_URL = (process.env.PARTNER_BASE_URL || 'https://platform.bankkaro.com/partner').replace(/\/$/, '');

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

async function apiGet<T>(path: string): Promise<T> {
  const response = await authManager.authenticatedFetch(`${BASE_URL}${path}`);
  if (!response.ok) {
    throw new Error(`API error ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const response = await authManager.authenticatedFetch(`${BASE_URL}${path}`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`API error ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

export const apiClient = {
  getInitBundle() {
    return apiGet<any>('/cardgenius/init-bundle');
  },

  getCardDetails(alias: string) {
    return apiGet<any>(`/cardgenius/cards/${alias}`);
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
    const raw = await apiPost<any>('/cardgenius/v2/calculate', fullPayload);

    // Normalise response envelope so all callers can always use raw.data.savings
    // v1 shape: { data: { savings: [...] } }
    // v2 shape may be: { data: [...] }  or  { data: { savings: [...] } }  or  { savings: [...] }
    if (raw) {
      if (Array.isArray(raw.data)) {
        raw.data = { savings: raw.data };
      } else if (Array.isArray(raw.savings)) {
        raw.data = { savings: raw.savings };
      } else if (raw.data && !Array.isArray(raw.data.savings)) {
        raw.data.savings = [];
      }
    }

    return raw;
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
    return apiPost<any>('/cardgenius/cards', fullParams);
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
    return apiPost<any>('/cardgenius/cards', body);
  },
};
