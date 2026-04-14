import { apiClient } from './dist/api/client.js';
import { getCardDetails } from './dist/tools/cardDetails.js';

// Setup env variables manually
import { readFileSync } from 'fs';
import { resolve } from 'path';
try {
  const envContent = readFileSync('.env', 'utf-8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    process.env[trimmed.slice(0, eqIdx).trim()] = trimmed.slice(eqIdx + 1).trim();
  }
} catch {}

const ALIAS = 'sbi-cashback-credit-card';

async function main() {
    console.log('--- CARD DETAILS ---');
    const details = await getCardDetails({ card_alias: ALIAS });
    console.log(JSON.stringify(details, null, 2));

    console.log('\n--- SPEND SWEEPS ---');
    // Let's test online vs offline heavily
    const scenarios = [
        { name: 'Casual', spends: { other_online_spends: 5000, offline_grocery: 5000 } },
        { name: 'Moderate Online', spends: { amazon_spends: 5000, flipkart_spends: 5000, other_online_spends: 5000, other_offline_spends: 5000 } }, // Total 20k
        { name: 'Heavy Online', spends: { amazon_spends: 10000, flipkart_spends: 10000, online_food_ordering: 10000, other_offline_spends: 10000 } }, // Total 40k
        { name: 'Extreme Online', spends: { amazon_spends: 30000, flipkart_spends: 30000, other_online_spends: 40000 } } // Total 100k
    ];

    for (const sc of scenarios) {
        console.log(`\nScenario: ${sc.name} (Spends: ${JSON.stringify(sc.spends)})`);
        const res = await apiClient.calculateCardGenius(sc.spends);
        const savingsArray = Array.isArray(res?.data?.savings) ? res.data.savings : [];
        const cardSavings = savingsArray.find(c => c.seo_card_alias === ALIAS || c.card_alias === ALIAS);
        
        if (cardSavings) {
             const rewards = cardSavings.total_savings_yearly || 0;
             const milestones = cardSavings.total_extra_benefits || 0;
             const fee = 1179; // SBI cashback fee with GST
             const net = rewards + milestones - fee;
             console.log(`Annual Rewards: ₹${rewards}`);
             console.log(`Net Savings: ₹${net}`);
             console.log('Breakdown:', JSON.stringify(cardSavings.spending_breakdown, null, 2));
        } else {
             console.log('Card not found in response for this scenario.');
        }
    }
}

main().catch(console.error);
