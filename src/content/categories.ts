export type SpendComposition = {
  label: string;          // e.g. "Amazon-heavy", "Balanced"
  description: string;    // shown in article context
  keys: Record<string, number>; // ratio weights (sum should be ≤ 1.0)
};

export type CategoryConfig = {
  spend_compositions: SpendComposition[];
  default_composition: string;  // label of the composition to use when no preference given
  mcp_category: string;
  spend_tiers: number[];
  tier_labels: Record<number, string>;
  detail_fields: string[];
  context: any;
};

export const CATEGORIES: Record<string, CategoryConfig> = {
  fuel: {
    spend_compositions: [
      {
        label: 'Single pump',
        description: 'All fuel at one pump chain (loyalty card optimized)',
        keys: { fuel: 1.0 },
      },
    ],
    default_composition: 'Single pump',
    mcp_category: 'best-fuel-credit-card',
    spend_tiers: [3000, 5000, 7000, 10000, 15000],
    tier_labels: {
      3000: 'Two-wheeler / light commuter',
      5000: 'Small car / city commute',
      7000: 'Sedan + weekend drives',
      10000: 'Long commute / highway regular',
      15000: 'Heavy spender / multiple vehicles',
    },
    detail_fields: ['fuel_surcharge_waiver'],
    context: {
      oil_companies: ['IndianOil (IOCL)', 'HPCL', 'BPCL'],
      note: 'Fuel surcharge waiver (1%) is the primary benefit — reward rate on top is secondary. Match the card to your preferred pump chain.',
    },
  },

  dining: {
    spend_compositions: [
      {
        label: 'Restaurants only',
        description: 'In-person dining at restaurants, cafes, bars',
        keys: { dining_or_going_out: 1.0 },
      },
    ],
    default_composition: 'Restaurants only',
    mcp_category: 'best-dining-credit-card',
    spend_tiers: [2000, 4000, 6000, 10000, 15000],
    tier_labels: {
      2000: 'Occasional weekend treat',
      4000: 'Regular weekend dining',
      6000: 'Frequent dine-outs / couples',
      10000: 'Family dining / entertainment',
      15000: 'Heavy dining / group organizer',
    },
    detail_fields: ['dining_benefits', 'dining_discounts'],
    context: {
      platforms: ['Swiggy Dineout', 'EazyDiner', 'Zomato Gold'],
      note: 'Dining cards cover physical restaurants. For Swiggy/Zomato food delivery use the food-delivery category.',
    },
  },

  shopping: {
    spend_compositions: [
      {
        label: 'Balanced',
        description: '40% Amazon, 30% Flipkart, 30% other online — average Indian online shopper',
        keys: { amazon_spends: 0.4, flipkart_spends: 0.3, other_online_spends: 0.3 },
      },
      {
        label: 'Amazon-heavy',
        description: '80% Amazon, 20% other — Prime subscriber, buys almost exclusively on Amazon',
        keys: { amazon_spends: 0.8, other_online_spends: 0.2 },
      },
      {
        label: 'Flipkart-heavy',
        description: '70% Flipkart, 30% other — prefers Flipkart / Big Billion Days shopper',
        keys: { flipkart_spends: 0.7, other_online_spends: 0.3 },
      },
      {
        label: 'Other platforms',
        description: '100% on Myntra, Nykaa, Ajio, Meesho — fashion/beauty focused',
        keys: { other_online_spends: 1.0 },
      },
    ],
    default_composition: 'Balanced',
    mcp_category: 'best-shopping-credit-card',
    spend_tiers: [5000, 10000, 25000, 50000, 100000],
    tier_labels: {
      5000: 'Casual / essentials only',
      10000: 'Regular shopper',
      25000: 'Frequent + apparel',
      50000: 'Family shopping / electronics',
      100000: 'Premium / heavy buyer',
    },
    detail_fields: ['amazon_benefits', 'flipkart_benefits', 'sale_offers'],
    context: {
      platforms: ['Amazon', 'Flipkart', 'Myntra', 'Nykaa', 'Ajio'],
      note: 'Co-branded cards (Amazon Pay ICICI, Flipkart Axis) win decisively if you concentrate spend on one platform. Generic cashback cards win for mixed/other-platform shoppers.',
    },
  },

  grocery: {
    spend_compositions: [
      {
        label: 'Online-heavy',
        description: '80% quick-commerce (Blinkit/Zepto/Instamart), 20% offline',
        keys: { grocery_spends_online: 0.8, offline_grocery: 0.2 },
      },
      {
        label: 'Balanced',
        description: '60% online, 40% offline (DMart/Reliance Smart)',
        keys: { grocery_spends_online: 0.6, offline_grocery: 0.4 },
      },
      {
        label: 'Offline-heavy',
        description: '80% in-store (DMart/supermarkets), 20% online',
        keys: { grocery_spends_online: 0.2, offline_grocery: 0.8 },
      },
    ],
    default_composition: 'Balanced',
    mcp_category: 'best-cards-grocery-shopping',
    spend_tiers: [3000, 5000, 8000, 12000, 20000],
    tier_labels: {
      3000: 'Bachelor / light needs',
      5000: 'Couple / monthly staples',
      8000: 'Small family',
      12000: 'Large family / premium items',
      20000: 'Bulk buying / joint family',
    },
    detail_fields: ['grocery_benefits'],
    context: {
      online_platforms: ['Swiggy Instamart', 'Blinkit', 'Zepto', 'BigBasket'],
      offline_retailers: ['DMart', 'Reliance Smart', 'More', 'Spar'],
      note: 'Online grocery (quick-commerce) and offline grocery reward differently. Cards optimized for one may give 1x on the other.',
    },
  },

  'food-delivery': {
    spend_compositions: [
      {
        label: 'Swiggy + Zomato',
        description: 'Mixed across both platforms',
        keys: { online_food_ordering: 1.0 },
      },
    ],
    default_composition: 'Swiggy + Zomato',
    mcp_category: 'online-food-ordering',
    spend_tiers: [2000, 4000, 6000, 10000],
    tier_labels: {
      2000: 'Occasional ordering',
      4000: 'Weekend orders / couples',
      6000: 'Frequent lunch + dinner',
      10000: 'Daily ordering / heavy reliance',
    },
    detail_fields: ['food_delivery_benefits'],
    context: {
      platforms: ['Swiggy', 'Zomato'],
      note: 'Includes food delivery only. For restaurant dining, use the dining category.',
    },
  },

  travel: {
    spend_compositions: [
      {
        label: 'Flights-heavy',
        description: '80% flights, 20% hotels — frequent flyer, budget or business hotels',
        keys: { flights_annual: 0.8, hotels_annual: 0.2 },
      },
      {
        label: 'Balanced',
        description: '60% flights, 40% hotels — standard holiday traveler',
        keys: { flights_annual: 0.6, hotels_annual: 0.4 },
      },
      {
        label: 'Hotels-heavy',
        description: '30% flights, 70% hotels — domestic road tripper or luxury hotel loyalist',
        keys: { flights_annual: 0.3, hotels_annual: 0.7 },
      },
    ],
    default_composition: 'Balanced',
    mcp_category: 'best-travel-credit-card',
    spend_tiers: [50000, 100000, 200000, 400000, 800000],
    tier_labels: {
      50000: '1-2 domestic round trips/yr',
      100000: 'Regular domestic / budget international',
      200000: 'Frequent flyer / annual international holiday',
      400000: 'Premium travel / family international',
      800000: 'Luxury globe-trotter',
    },
    detail_fields: ['lounge_access', 'forex_markup', 'milestone_tickets', 'points_transfer'],
    context: {
      lounge_value_assumption: 'Domestic lounge ₹750/visit, international ₹1,250/visit',
      note: 'Milestone benefits (free flight vouchers, companion tickets) heavily swing math for premium cards at high spends. Lounge access is a key differentiator.',
    },
  },

  utility: {
    spend_compositions: [
      {
        label: 'Standard household',
        description: '50% electricity, 30% mobile, 20% water/others',
        keys: { electricity_bills: 0.5, mobile_phone_bills: 0.3, water_bills: 0.2 },
      },
      {
        label: 'Mobile-heavy',
        description: '60% mobile bills (family plans / postpaid), 40% electricity',
        keys: { mobile_phone_bills: 0.6, electricity_bills: 0.4 },
      },
    ],
    default_composition: 'Standard household',
    mcp_category: 'best-utility-credit-card',
    spend_tiers: [2000, 4000, 7000, 12000],
    tier_labels: {
      2000: 'Basic mobile & power',
      4000: 'Standard household bills',
      7000: 'Large house / high AC usage',
      12000: 'Joint family / premium utilities',
    },
    detail_fields: ['utility_benefits'],
    context: {
      platforms: ['Amazon Pay', 'Tata Neu', 'Airtel Thanks', 'Freecharge'],
      note: 'Utility payments often earn lower reward rates (some cards explicitly exclude them). Co-branded and cashback cards give the best returns here.',
    },
  },
};
