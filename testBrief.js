import { generateContentBrief } from './dist/tools/contentBrief.js';
import { readFileSync } from 'fs';
import { resolve } from 'path';

try {
  const envPath = resolve(process.cwd(), '.env');
  const envContent = readFileSync(envPath, 'utf-8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
} catch {
  // Ignore
}

async function main() {
  console.log('Testing generateContentBrief for Fuel category...\n');
  const result = await generateContentBrief({ category: 'fuel', top_n: 3, include_details: true });
  console.log('Crossover Points:', JSON.stringify(result.crossover_points, null, 2));
  console.log('\nTop cards at ₹6000:', JSON.stringify(result.spend_sweep.find(s => s.spend_level === 6000)?.top_cards.map(c => c.card_name), null, 2));
  console.log('\nTop cards at ₹15000:', JSON.stringify(result.spend_sweep.find(s => s.spend_level === 15000)?.top_cards.map(c => c.card_name), null, 2));

  console.log('\nTesting for Shopping category...\n');
  const shopResult = await generateContentBrief({ category: 'shopping', top_n: 3, include_details: true });
  console.log('Crossover Points:', JSON.stringify(shopResult.crossover_points, null, 2));
  console.log('\nTop cards at ₹10000:', JSON.stringify(shopResult.spend_sweep.find(s => s.spend_level === 10000)?.top_cards.map(c => c.card_name), null, 2));
  
  console.log('\nDone.');
}

main().catch(console.error);
