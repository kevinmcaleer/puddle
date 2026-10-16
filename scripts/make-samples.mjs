// Writes public/samples/*.csv, the onboarding sample datasets (src/samples/catalog.ts): small, deliberately messy
// files with the problems each sample's note describes. A seeded generator, so the files come out the same each run.
// Run with `node scripts/make-samples.mjs` after changing it, and commit the files.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = fileURLToPath(new URL('../public/samples', import.meta.url));
mkdirSync(out, { recursive: true });
let seed = 84;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const csvCell = (v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const write = (name, header, rows) => writeFileSync(join(out, name), [header, ...rows].map((r) => r.map((c) => csvCell(String(c))).join(',')).join('\n') + '\n');

const first = ['Alice', 'Bob', 'Chloe', 'Dev', 'Ewan', 'Fatima', 'George', 'Hana', 'Isaac', 'Jade', 'Kofi', 'Leila', 'Mateo', 'Nora', 'Omar', 'Priya', 'Quinn', 'Rosa', 'Sam', 'Tariq', 'Uma', 'Vik', 'Wren', 'Yusuf', 'Zoe'];
const last = ['Smith', 'Jones', 'Patel', 'Okafor', 'Nguyen', 'Garcia', 'Brown', 'Kowalski', 'Murphy', 'Ali', 'Evans', 'Chen', 'Taylor', 'Hughes', 'Rossi'];
const cities = ['London', 'Manchester', 'Leeds', 'Bristol', 'Glasgow', 'Cardiff', 'Belfast', 'York'];

// Contacts: stray spaces, mixed capitalisation, doubled inner spaces, blank emails, and duplicates.
const caseOf = (s) => pick([s, s, s, s.toUpperCase(), s.toLowerCase()]);
const pad = (s) => pick(['', '', '', ' ', '  ']) + s + pick(['', '', '', ' ', '   ']);
const contacts = [];
for (let i = 0; i < 48; i++) {
  const f = first[i % first.length], l = pick(last);
  const name = pad(caseOf(`${f}${rnd() < 0.1 ? '  ' : ' '}${l}`));
  const email = rnd() < 0.12 ? '' : `${f}.${l}@example.com`.toLowerCase().replace(/^/, rnd() < 0.15 ? ' ' : '');
  const phone = pick(['07700 900', '+44 7700 900', '07700900']) + String(100 + Math.floor(rnd() * 900));
  const city = pad(caseOf(pick(cities)));
  const day = 1 + Math.floor(rnd() * 28), month = 1 + Math.floor(rnd() * 12);
  contacts.push([name, email, phone, city, `2024-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`]);
}
// Exact duplicates (the same row pasted twice), scattered through the list.
for (const i of [3, 11, 20, 31, 40]) contacts.splice(i + 7, 0, [...contacts[i]]);
write('contacts.csv', ['name', 'email', 'phone', 'city', 'signed_up'], contacts);

// Sales: dates in four formats, amounts as text with symbols and thousands separators, currencies in mixed case.
const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const longMonths = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const sales = [];
for (let i = 0; i < 72; i++) {
  const d = 1 + Math.floor(rnd() * 28), m = Math.floor(rnd() * 12);
  const p2 = (n) => String(n).padStart(2, '0');
  const date = pick([`2024-${p2(m + 1)}-${p2(d)}`, `2024-${p2(m + 1)}-${p2(d)}`, `${p2(d)}/${p2(m + 1)}/2024`, `${d} ${months[m]} 2024`, `${longMonths[m]} ${d}, 2024`]);
  const cur = pick(['GBP', 'GBP', 'USD', 'EUR']);
  const value = Math.round((20 + rnd() * 2400) * 100) / 100;
  const fixed = value.toFixed(2), thousands = value.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const sym = { GBP: '£', USD: '$', EUR: '€' }[cur];
  const amount = pick([fixed, fixed, `${sym}${thousands}`, `${sym}${fixed}`, thousands, `${fixed} ${cur}`]);
  const region = pick(['North', 'South', 'East', 'West', 'north', 'SOUTH', ' East', 'n/a', '']);
  sales.push([`SO-${1001 + i}`, date, `${pick(first)} ${pick(last)}`, amount, pick([cur, cur, cur.toLowerCase(), ` ${cur}`]), region]);
}
write('sales.csv', ['order_id', 'order_date', 'customer', 'amount', 'currency', 'region'], sales);

// Two tables to join: customer ids in orders have stray spaces and lower case; two orders name customers who don't exist.
const countries = ['United Kingdom', 'Ireland', 'France', 'Germany', 'Spain'];
const customers = [];
for (let i = 1; i <= 20; i++) customers.push([`C${String(i).padStart(3, '0')}`, `${first[i % first.length]} ${pick(last)}`, pick(countries)]);
write('customers.csv', ['customer_id', 'name', 'country'], customers);
const products = ['Kettle', 'Toaster', 'Teapot', 'Mug', 'Coffee grinder', 'Cafetiere'];
const orders = [];
for (let i = 0; i < 60; i++) {
  const id = `C${String(1 + Math.floor(rnd() * 20)).padStart(3, '0')}`;
  const messy = pick([id, id, id, id.toLowerCase(), ` ${id}`, `${id} `]);
  orders.push([`O-${2001 + i}`, messy, pick(products), 1 + Math.floor(rnd() * 4)]);
}
orders[17][1] = 'C099';
orders[42][1] = 'C120';
write('orders.csv', ['order_id', 'customer_id', 'product', 'quantity'], orders);

// A wide table: one column per month, with gaps written three ways and numbers with thousands separators.
const stores = [['Leeds Briggate', 'North'], ['York Coney St', 'North'], ['Bristol Broadmead', 'South'], ['Cardiff Queen St', 'Wales'], ['Glasgow Buchanan St', 'Scotland'], ['London Oxford St', 'South'], ['Manchester Arndale', 'North'], ['Belfast Donegall Pl', 'Northern Ireland']];
const wide = stores.map(([s, region]) => [s, region, ...months.map(() => {
  if (rnd() < 0.08) return pick(['n/a', '-', '']);
  const v = Math.round(8000 + rnd() * 40000);
  return rnd() < 0.3 ? v.toLocaleString('en-GB') : String(v);
})]);
// Every way of writing a gap appears at least once.
wide[1][6] = 'n/a';
wide[3][4] = '-';
wide[5][9] = '';
write('monthly-sales.csv', ['store', 'region', ...months.map((m) => `${m.toLowerCase()}_2024`)], wide);
