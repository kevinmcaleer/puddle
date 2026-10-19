// Small word lists sample rows are made from: names, places, email domains, streets and filler words. Kept short and
// made up here, so nothing is fetched and the rows are clearly samples.

export const FIRST_NAMES = [
  'Ada', 'Alan', 'Amara', 'Ben', 'Chloe', 'Daniel', 'Elena', 'Farah', 'George', 'Grace', 'Hiro', 'Isla', 'Jack', 'Jonas', 'Kofi', 'Lena',
  'Leo', 'Maya', 'Mohammed', 'Nina', 'Oliver', 'Priya', 'Quinn', 'Rosa', 'Sam', 'Sofia', 'Tom', 'Uma', 'Victor', 'Wei', 'Yara', 'Zoe',
] as const;

export const LAST_NAMES = [
  'Adams', 'Baker', 'Byrne', 'Chen', 'Clarke', 'Davies', 'Evans', 'Fischer', 'Garcia', 'Hughes', 'Ito', 'Jones', 'Kaur', 'Khan', 'Lopez', 'Martin',
  'Murphy', 'Nguyen', 'Novak', 'Okafor', 'Patel', 'Rossi', 'Santos', 'Schmidt', 'Silva', 'Smith', 'Taylor', 'Walsh', 'Williams', 'Wright', 'Yilmaz', 'Zhang',
] as const;

export const CITIES = [
  'Amsterdam', 'Athens', 'Auckland', 'Barcelona', 'Berlin', 'Bristol', 'Cape Town', 'Chicago', 'Dublin', 'Edinburgh', 'Glasgow', 'Helsinki', 'Lagos', 'Leeds',
  'Lisbon', 'London', 'Lyon', 'Madrid', 'Manchester', 'Melbourne', 'Montreal', 'Mumbai', 'Nairobi', 'Oslo', 'Paris', 'Prague', 'Seoul', 'Toronto', 'Vienna', 'Zurich',
] as const;

/** Countries with their two- and three-letter codes. */
export const COUNTRIES: readonly { name: string; code2: string; code3: string }[] = [
  { name: 'Australia', code2: 'AU', code3: 'AUS' }, { name: 'Austria', code2: 'AT', code3: 'AUT' }, { name: 'Belgium', code2: 'BE', code3: 'BEL' },
  { name: 'Brazil', code2: 'BR', code3: 'BRA' }, { name: 'Canada', code2: 'CA', code3: 'CAN' }, { name: 'Denmark', code2: 'DK', code3: 'DNK' },
  { name: 'Finland', code2: 'FI', code3: 'FIN' }, { name: 'France', code2: 'FR', code3: 'FRA' }, { name: 'Germany', code2: 'DE', code3: 'DEU' },
  { name: 'Greece', code2: 'GR', code3: 'GRC' }, { name: 'India', code2: 'IN', code3: 'IND' }, { name: 'Ireland', code2: 'IE', code3: 'IRL' },
  { name: 'Italy', code2: 'IT', code3: 'ITA' }, { name: 'Japan', code2: 'JP', code3: 'JPN' }, { name: 'Kenya', code2: 'KE', code3: 'KEN' },
  { name: 'Mexico', code2: 'MX', code3: 'MEX' }, { name: 'Netherlands', code2: 'NL', code3: 'NLD' }, { name: 'New Zealand', code2: 'NZ', code3: 'NZL' },
  { name: 'Nigeria', code2: 'NG', code3: 'NGA' }, { name: 'Norway', code2: 'NO', code3: 'NOR' }, { name: 'Portugal', code2: 'PT', code3: 'PRT' },
  { name: 'South Africa', code2: 'ZA', code3: 'ZAF' }, { name: 'South Korea', code2: 'KR', code3: 'KOR' }, { name: 'Spain', code2: 'ES', code3: 'ESP' },
  { name: 'Sweden', code2: 'SE', code3: 'SWE' }, { name: 'Switzerland', code2: 'CH', code3: 'CHE' }, { name: 'United Kingdom', code2: 'GB', code3: 'GBR' },
  { name: 'United States', code2: 'US', code3: 'USA' },
];

/** Domains reserved for examples, so a sample address can never reach anyone. */
export const EMAIL_DOMAINS = ['example.com', 'example.org', 'example.net', 'mail.example.com', 'post.example.org', 'test.example.net'] as const;

export const STREET_WORDS = [
  'Acacia', 'Ash', 'Bridge', 'Castle', 'Cedar', 'Church', 'Elm', 'Garden', 'Harbour', 'High', 'Hill', 'King', 'Lake', 'Maple', 'Market', 'Mill',
  'Oak', 'Orchard', 'Park', 'Queen', 'River', 'Station', 'Victoria', 'Willow',
] as const;

export const STREET_TYPES = ['Street', 'Road', 'Lane', 'Avenue', 'Close', 'Way', 'Drive', 'Place'] as const;

/** Adjectives and nouns for product names, titles and descriptions. */
export const ADJECTIVES = [
  'bright', 'classic', 'compact', 'cosy', 'durable', 'easy', 'fresh', 'gentle', 'handy', 'light', 'modern', 'neat', 'quiet', 'rapid', 'simple', 'smart',
  'smooth', 'solid', 'sturdy', 'tidy', 'useful', 'warm', 'wild', 'clever',
] as const;

export const NOUNS = [
  'backpack', 'basket', 'blanket', 'bottle', 'candle', 'chair', 'clock', 'cup', 'desk', 'jacket', 'kettle', 'lamp', 'mug', 'notebook', 'pen', 'pillow',
  'plant', 'scarf', 'shelf', 'speaker', 'table', 'teapot', 'towel', 'umbrella', 'wallet', 'watch',
] as const;

export const VERBS = ['arrives', 'brings', 'fits', 'helps', 'keeps', 'lasts', 'makes', 'suits', 'works', 'looks'] as const;

/** Endings for a short sentence. */
export const PHRASES = [
  'every day', 'in any weather', 'for years', 'at home', 'on the go', 'in the office', 'with little fuss', 'as promised', 'out of the box', 'for the whole family',
] as const;

/** Words for a status column that isn't an enum. */
export const STATUSES = ['active', 'pending', 'on hold', 'closed', 'in review', 'done'] as const;
