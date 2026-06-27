-- Seed vendor rules from Big Wave Auto LLC vendor list
-- Categories match QuickBooks Trial Balance chart of accounts
-- match_type='contains' so partial bank description matches work
-- Idempotent: ON CONFLICT DO NOTHING

INSERT INTO transaction_vendor_rules (vendor_pattern, match_type, category, auto_approve)
VALUES

-- ── Detailing ────────────────────────────────────────────────────────────────
('AUTOSUDZ',              'contains', 'Detailing',        false),
('DBD MOBILE',            'contains', 'Detailing',        false),
('DENNIS FANNING',        'contains', 'Detailing',        false),
('METRO CAR WASH',        'contains', 'Detailing',        false),

-- ── Reconditioning (bodywork, paint, dents, tint) ───────────────────────────
('FX WINDOW TINTING',     'contains', 'Reconditioning',   false),
('GARAGE MILWAUKEE',      'contains', 'Reconditioning',   false),
('DENT CRAFT',            'contains', 'Reconditioning',   false),
('GERALD P. OLSON',       'contains', 'Reconditioning',   false),

-- ── Repairs & Parts ──────────────────────────────────────────────────────────
('AUTOZONE',              'contains', 'Repairs & Parts',  false),
('BMW',                   'contains', 'Repairs & Parts',  false),
('EBAY',                  'contains', 'Repairs & Parts',  false),
('UNITED PACIFIC',        'contains', 'Repairs & Parts',  false),

-- ── Tires ────────────────────────────────────────────────────────────────────
-- (add tire vendors here as you encounter them)

-- ── Transportation ────────────────────────────────────────────────────────────
('U-HAUL',                'contains', 'Transportation',   false),
('UHAUL',                 'contains', 'Transportation',   false),
('UBER',                  'contains', 'Transportation',   false),

-- ── Listing Fees ─────────────────────────────────────────────────────────────
-- (CarGurus, Cars.com, AutoTrader typically show up here)
('CARGURUS',              'contains', 'Listing Fees',     false),
('CARS.COM',              'contains', 'Listing Fees',     false),
('AUTOTRADER',            'contains', 'Listing Fees',     false),

-- ── Auction Fees ─────────────────────────────────────────────────────────────
('COPART',                'contains', 'Auction Fees',     false),
('MANHEIM',               'contains', 'Auction Fees',     false),
('OPENLANE',              'contains', 'Auction Fees',     false),
('ADESA',                 'contains', 'Auction Fees',     false),

-- ── Vehicle History Reports ───────────────────────────────────────────────────
('CARFAX',                'contains', 'Vehicle History Reports', true),
('AUTOCHECK',             'contains', 'Vehicle History Reports', true),

-- ── Supplies (shop/detail supplies, not parts) ───────────────────────────────
('HOME DEPOT',            'contains', 'Supplies',         false),
('MENARDS',               'contains', 'Supplies',         false),
('MENARD',                'contains', 'Supplies',         false),
('WALMART',               'contains', 'Supplies',         false),
('COSTCO',                'contains', 'Supplies',         false),
('MEIJER',                'contains', 'Supplies',         false),

-- ── Small Tools & Equipment ───────────────────────────────────────────────────
('HARBOR FREIGHT',        'contains', 'Small Tools & Equipment', false),
('NORTHERN TOOL',         'contains', 'Small Tools & Equipment', false),
('M&W INDUSTRIAL',        'contains', 'Small Tools & Equipment', false),

-- ── Advertising ───────────────────────────────────────────────────────────────
('FACEBOOK',              'contains', 'Advertising',      true),
('META ',                 'contains', 'Advertising',      true),
('CRAIGSLIST',            'contains', 'Advertising',      true),
('INDEED',                'contains', 'Advertising',      false),
('VISTAPRINT',            'contains', 'Advertising',      false),
('FIVERR',                'contains', 'Advertising',      false),

-- ── Software & Subscriptions ──────────────────────────────────────────────────
('APPLE.COM/BILL',        'contains', 'Software & Subscriptions', true),
('APPLE ',                'contains', 'Software & Subscriptions', false),
('MICROSOFT',             'contains', 'Software & Subscriptions', true),
('DOCUSIGN',              'contains', 'Software & Subscriptions', true),
('GODADDY',               'contains', 'Software & Subscriptions', true),
('WIX',                   'contains', 'Software & Subscriptions', true),
('QUICKBOOKS',            'contains', 'Software & Subscriptions', true),
('INTUIT',                'contains', 'Software & Subscriptions', true),

-- ── Website ───────────────────────────────────────────────────────────────────
-- (GoDaddy domain renewals specifically vs software above)

-- ── Utilities ─────────────────────────────────────────────────────────────────
('SHELL',                 'contains', 'Utilities',        true),
('BP ',                   'contains', 'Utilities',        true),
('EXXON',                 'contains', 'Utilities',        true),
('MOBIL',                 'contains', 'Utilities',        true),
('SPEEDWAY',              'contains', 'Utilities',        true),
('KWIK TRIP',             'contains', 'Utilities',        true),
('KWIKTRIP',              'contains', 'Utilities',        true),
('WE ENERGIES',           'contains', 'Utilities',        true),
('SPECTRUM',              'contains', 'Utilities',        true),
('COX ',                  'contains', 'Utilities',        true),
('OOMA',                  'contains', 'Utilities',        true),

-- ── Office Expenses ───────────────────────────────────────────────────────────
('AMAZON',                'contains', 'Office Expenses',  false),
('USPS',                  'contains', 'Office Expenses',  true),
('WALGREENS',             'contains', 'Office Expenses',  true),
('JIMMY JOHN',            'contains', 'Office Expenses',  true),
('ROSS ',                 'contains', 'Office Expenses',  true),
('ETSY',                  'contains', 'Office Expenses',  false),
('WAYFAIR',               'contains', 'Office Expenses',  false),

-- ── Insurance ─────────────────────────────────────────────────────────────────
('PROGRESSIVE',           'contains', 'Insurance',        true),
('STATE FARM',            'contains', 'Insurance',        true),
('GEICO',                 'contains', 'Insurance',        true),
('NATIONWIDE',            'contains', 'Insurance',        true),

-- ── Rent ──────────────────────────────────────────────────────────────────────
-- (add your landlord's name here)

-- ── Miscellaneous ─────────────────────────────────────────────────────────────
('IRS',                   'contains', 'Miscellaneous',    false),
('DICK''S SPORTING',      'contains', 'Miscellaneous',    false)

ON CONFLICT (vendor_pattern, match_type) DO NOTHING;

-- Verify count
SELECT count(*) AS rules_seeded FROM transaction_vendor_rules;
