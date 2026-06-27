-- Vendor rules seeded from Big Wave Auto LLC QuickBooks Transaction List (Jul 2025 – Jun 2026)
-- Categories verified against actual QB chart of accounts
-- auto_approve=TRUE only for vendors that are 100% overhead with zero vehicle variance
-- ON CONFLICT DO NOTHING = safe to re-run

INSERT INTO transaction_vendor_rules (vendor_pattern, match_type, category, auto_approve) VALUES

-- ══ FUEL (overhead, auto-approve — never tied to a specific car) ══════════════
('BP ',               'contains', 'Fuel',                     true),
('BP#',               'contains', 'Fuel',                     true),
('KWIK TRIP',         'contains', 'Fuel',                     true),
('KWIKTRIP',          'contains', 'Fuel',                     true),
('SHELL ',            'contains', 'Fuel',                     true),
('SHELL#',            'contains', 'Fuel',                     true),
('EXXON',             'contains', 'Fuel',                     true),
('MOBIL',             'contains', 'Fuel',                     true),
('SPEEDWAY',          'contains', 'Fuel',                     true),
('MEIJER GAS',        'contains', 'Fuel',                     true),
('CASEY',             'contains', 'Fuel',                     true),
('MARATHON',          'contains', 'Fuel',                     true),

-- ══ INTERNET (overhead, auto-approve) ════════════════════════════════════════
('SPECTRUM',          'contains', 'Internet',                  true),
('COX ',              'contains', 'Internet',                  true),
('COMCAST',           'contains', 'Internet',                  true),
('AT&T',              'contains', 'Internet',                  true),
('VERIZON',           'contains', 'Internet',                  true),

-- ══ TELEPHONE (overhead, auto-approve) ═══════════════════════════════════════
('OOMA',              'contains', 'Telephone',                 true),

-- ══ SOFTWARE & SUBSCRIPTIONS (overhead, auto-approve) ════════════════════════
('WIX',               'contains', 'Software & Subscriptions',  true),
('MICROSOFT',         'contains', 'Software & Subscriptions',  true),
('DOCUSIGN',          'contains', 'Software & Subscriptions',  true),
('QUICKBOOKS',        'contains', 'Software & Subscriptions',  true),
('INTUIT ',           'contains', 'Software & Subscriptions',  true),
('GODADDY',           'contains', 'Software & Subscriptions',  true),
('DROPBOX',           'contains', 'Software & Subscriptions',  true),
('GOOGLE WORKSPACE',  'contains', 'Software & Subscriptions',  true),

-- ══ LISTING FEES (QB calls Facebook/Craigslist this, not Advertising) ════════
('CRAIGSLIST',        'contains', 'Listing Fees',              true),
('FACEBOOK',          'contains', 'Listing Fees',              true),
('META ',             'contains', 'Listing Fees',              true),
('CARGURUS',          'contains', 'Listing Fees',              false),
('CARS.COM',          'contains', 'Listing Fees',              false),
('AUTOTRADER',        'contains', 'Listing Fees',              false),
('CARSFORSALE',       'contains', 'Listing Fees',              false),

-- ══ ADVERTISING (other paid promotion) ═══════════════════════════════════════
('ETSY',              'contains', 'Advertising',               false),
('VISTAPRINT',        'contains', 'Advertising',               false),
('FIVERR',            'contains', 'Advertising',               false),
('INDEED',            'contains', 'Advertising',               true),

-- ══ OFFICE EXPENSES (overhead, auto-approve for obvious ones) ═════════════════
('APPLE.COM/BILL',    'contains', 'Office Expenses',           true),
('COSTCO',            'contains', 'Office Expenses',           true),
('USPS',              'contains', 'Shipping & Postage',        true),
('WALGREENS',         'contains', 'Office Expenses',           true),
('JIMMY JOHN',        'contains', 'Office Expenses',           true),
('ROSS ',             'contains', 'Office Expenses',           true),

-- ══ SMALL TOOLS & EQUIPMENT (overhead, need to verify amount) ════════════════
('HARBOR FREIGHT',    'contains', 'Small Tools & Equipment',   false),
('NORTHERN TOOL',     'contains', 'Small Tools & Equipment',   false),
('M&W INDUSTRIAL',    'contains', 'Small Tools & Equipment',   false),

-- ══ DETAILING (almost always vehicle-specific — needs VIN review) ════════════
('AUTOSUDZ',          'contains', 'Detailing',                 false),
('DBD MOBILE',        'contains', 'Detailing',                 false),
('DENNIS FANNING',    'contains', 'Detailing',                 false),
('METRO CAR WASH',    'contains', 'Detailing',                 false),
('BLAKE OLESON',      'contains', 'Detailing',                 false),

-- ══ RECONDITIONING (always vehicle-specific) ══════════════════════════════════
('FX WINDOW TINTING', 'contains', 'Reconditioning',            false),
('GARAGE MILWAUKEE',  'contains', 'Reconditioning',            false),
('DENT CRAFT',        'contains', 'Reconditioning',            false),

-- ══ REPAIRS & PARTS (usually vehicle-specific) ════════════════════════════════
('AUTOZONE',          'contains', 'Repairs & Parts',           false),
('UNITED PACIFIC',    'contains', 'Repairs & Parts',           false),
('BMW ',              'contains', 'Repairs & Parts',           false),
('NAPA AUTO',         'contains', 'Repairs & Parts',           false),
('OREILLY',           'contains', 'Repairs & Parts',           false),
('O REILLY',          'contains', 'Repairs & Parts',           false),
('ADVANCE AUTO',      'contains', 'Repairs & Parts',           false),
('PEPBOYS',           'contains', 'Repairs & Parts',           false),
('PEP BOYS',          'contains', 'Repairs & Parts',           false),

-- ══ AUCTION FEES ══════════════════════════════════════════════════════════════
('COPART',            'contains', 'Auction Fees',              false),
('MANHEIM',           'contains', 'Auction Fees',              false),
('OPENLANE',          'contains', 'Auction Fees',              false),
('ADESA',             'contains', 'Auction Fees',              false),
('IAAI',              'contains', 'Auction Fees',              false),

-- ══ VEHICLE HISTORY REPORTS ═══════════════════════════════════════════════════
('CARFAX',            'contains', 'Vehicle History Reports',   true),
('AUTOCHECK',         'contains', 'Vehicle History Reports',   true),

-- ══ TRANSPORTATION ════════════════════════════════════════════════════════════
('U-HAUL',            'contains', 'Transportation',            false),
('UHAUL',             'contains', 'Transportation',            false),

-- ══ SUPPLIES (general — may or may not be vehicle-specific) ══════════════════
('HOME DEPOT',        'contains', 'Supplies',                  false),
('MENARDS',           'contains', 'Supplies',                  false),
('MENARD',            'contains', 'Supplies',                  false),
('WALMART',           'contains', 'Supplies',                  false),
('AMAZON',            'contains', 'Supplies',                  false),
('MEIJER',            'contains', 'Supplies',                  false)

ON CONFLICT (vendor_pattern, match_type) DO NOTHING;

-- Show what was seeded
SELECT category, count(*) as rules, string_agg(vendor_pattern, ', ' ORDER BY vendor_pattern) as vendors
FROM transaction_vendor_rules
GROUP BY category
ORDER BY category;
