import 'dotenv/config';
import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  isMainModule,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import express from 'express';
import multer from 'multer';
import { join } from 'node:path';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import Anthropic from '@anthropic-ai/sdk';
import { parse as csvParse } from 'csv-parse/sync';

const browserDistFolder = join(import.meta.dirname, '../browser');

const app = express();
const angularApp = new AngularNodeAppEngine();

const supabase = createClient(
  process.env['SUPABASE_URL']!,
  process.env['SUPABASE_SERVICE_KEY']!
);
const resend = new Resend(process.env['RESEND_API_KEY']);
const NOTIFY_EMAIL = 'dave@bigwaveauto.com';
const FROM_EMAIL = process.env['FROM_EMAIL'] || 'onboarding@resend.dev';
const anthropic = new Anthropic({ apiKey: process.env['ANTHROPIC_API_KEY'] });

// AES-256-GCM encryption for sensitive fields (SSN)
const ENCRYPTION_KEY = process.env['ENCRYPTION_KEY'] || '';
function encrypt(text: string): string {
  if (!text || !ENCRYPTION_KEY) return text;
  const key = Buffer.from(ENCRYPTION_KEY, 'hex');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');
  return iv.toString('hex') + ':' + tag + ':' + encrypted;
}

function decrypt(encrypted: string): string {
  if (!encrypted || !ENCRYPTION_KEY || !encrypted.includes(':')) return encrypted;
  const [ivHex, tagHex, data] = encrypted.split(':');
  const key = Buffer.from(ENCRYPTION_KEY, 'hex');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  let decrypted = decipher.update(data, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

/**
 * Lead form submissions
 */
app.use(express.json());

app.post('/api/leads/financing', async (req, res) => {
  try {
    const data = req.body;
    const lastFour = (data.ssn || '').slice(-4);
    // Encrypt SSN before storing
    if (data.ssn) data.ssn = encrypt(data.ssn);
    const { error } = await supabase.from('financing_leads').insert(data);
    if (error) { console.error(error); res.status(500).json({ error: 'Failed to save' }); return; }

    await resend.emails.send({
      from: FROM_EMAIL,
      to: NOTIFY_EMAIL,
      subject: `New Financing Application — ${data.firstname} ${data.lastname}`,
      html: `
        <h2>New Financing Application</h2>
        <p><b>Name:</b> ${data.firstname} ${data.lastname}</p>
        <p><b>Email:</b> ${data.email}</p>
        <p><b>Phone:</b> ${data.phone}</p>
        <p><b>DOB:</b> ${data.dob}</p>
        <p><b>SSN:</b> ***-**-${lastFour || 'N/A'}</p>
        <p><b>Address:</b> ${data.street}, ${data.city}, ${data.state} ${data.zip}</p>
        <p><b>Housing:</b> ${data.housing_status} (${data.years_at_address})</p>
        <p><b>Employment:</b> ${data.employment_status} at ${data.employer_name}</p>
        <p><b>Monthly Income:</b> ${data.monthly_income}</p>
        <p><b>Co-borrower:</b> ${data.coborrower ? 'Yes' : 'No'}</p>
      `
    });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/leads/trade-in', async (req, res) => {
  try {
    const data = req.body;
    const { error } = await supabase.from('trade_in_leads').insert(data);
    if (error) { console.error(error); res.status(500).json({ error: 'Failed to save' }); return; }

    await resend.emails.send({
      from: FROM_EMAIL,
      to: NOTIFY_EMAIL,
      subject: `New Trade-In Submission — ${data.year} ${data.make} ${data.model}`,
      html: `
        <h2>New Trade-In / Sell Submission</h2>
        <p><b>Vehicle:</b> ${data.year} ${data.make} ${data.model}</p>
        <p><b>Mileage:</b> ${data.mileage}</p>
        <p><b>Condition:</b> ${data.condition}</p>
        <p><b>VIN:</b> ${data.vin || 'Not provided'}</p>
        <p><b>Name:</b> ${data.firstname} ${data.lastname}</p>
        <p><b>Email:</b> ${data.email}</p>
        <p><b>Phone:</b> ${data.phone}</p>
        <p><b>Notes:</b> ${data.notes || 'None'}</p>
      `
    });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/leads/test-drive', async (req, res) => {
  try {
    const data = req.body;
    const { error } = await supabase.from('test_drive_leads').insert(data);
    if (error) { console.error(error); res.status(500).json({ error: 'Failed to save' }); return; }

    await resend.emails.send({
      from: FROM_EMAIL,
      to: NOTIFY_EMAIL,
      subject: `Test Drive Request — ${data.year} ${data.make} ${data.model}`,
      html: `
        <h2>New Test Drive Request</h2>
        <p><b>Vehicle:</b> ${data.year} ${data.make} ${data.model}</p>
        <p><b>VIN:</b> ${data.vin || 'N/A'}</p>
        <p><b>Stock #:</b> ${data.stock || 'N/A'}</p>
        <p><b>Name:</b> ${data.firstname} ${data.lastname}</p>
        <p><b>Email:</b> ${data.email}</p>
        <p><b>Phone:</b> ${data.phone}</p>
        <p><b>Preferred Date:</b> ${data.preferred_date || 'Not specified'}</p>
        <p><b>Preferred Time:</b> ${data.preferred_time || 'Not specified'}</p>
        <p><b>Notes:</b> ${data.notes || 'None'}</p>
      `
    });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/leads/make-offer', async (req, res) => {
  try {
    const data = req.body;
    const { error } = await supabase.from('offer_leads').insert(data);
    if (error) { console.error(error); res.status(500).json({ error: 'Failed to save' }); return; }

    await resend.emails.send({
      from: FROM_EMAIL,
      to: NOTIFY_EMAIL,
      subject: `New Offer — $${data.offer_amount} on ${data.year} ${data.make} ${data.model}`,
      html: `
        <h2>New Offer Received</h2>
        <p><b>Vehicle:</b> ${data.year} ${data.make} ${data.model}</p>
        <p><b>VIN:</b> ${data.vin || 'N/A'}</p>
        <p><b>Listed Price:</b> $${data.listed_price || 'N/A'}</p>
        <p><b>Offer Amount:</b> $${data.offer_amount}</p>
        <p><b>Financing:</b> ${data.financing}</p>
        <p><b>Name:</b> ${data.firstname} ${data.lastname}</p>
        <p><b>Email:</b> ${data.email}</p>
        <p><b>Phone:</b> ${data.phone}</p>
        <p><b>Notes:</b> ${data.notes || 'None'}</p>
      `
    });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/leads/contact', async (req, res) => {
  try {
    const data = req.body;
    const { error } = await supabase.from('contact_leads').insert(data);
    if (error) { console.error(error); res.status(500).json({ error: 'Failed to save' }); return; }

    await resend.emails.send({
      from: FROM_EMAIL,
      to: NOTIFY_EMAIL,
      subject: `New Contact Message — ${data.name}`,
      html: `
        <h2>New Contact Message</h2>
        <p><b>Name:</b> ${data.name}</p>
        <p><b>Email:</b> ${data.email}</p>
        <p><b>Phone:</b> ${data.phone || 'Not provided'}</p>
        <p><b>Message:</b> ${data.message}</p>
      `
    });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * Admin dashboard API
 */
app.get('/api/admin/dashboard', async (_req, res) => {
  try {
    // Fetch inventory from vAuto CSV feed
    const vehicles = await readVautoCsv();

    // Calculate inventory aging
    const now = Date.now();
    const ageBuckets = [
      { label: '0-15 Days', min: 0, max: 15 },
      { label: '16-30 Days', min: 16, max: 30 },
      { label: '31-60 Days', min: 31, max: 60 },
      { label: '61-90 Days', min: 61, max: 90 },
      { label: '91+ Days', min: 91, max: Infinity },
    ];

    const ageRows = ageBuckets.map(bucket => {
      const matching = vehicles.filter((v: any) => {
        const created = new Date(v.created_at || v.dateinstock || now).getTime();
        const days = Math.floor((now - created) / 86400000);
        return days >= bucket.min && days <= bucket.max;
      });
      const totalCost = matching.reduce((s: number, v: any) => s + (v.originalprice || v.price || 0), 0);
      const totalPrice = matching.reduce((s: number, v: any) => s + (v.price || 0), 0);
      return {
        label: bucket.label,
        count: matching.length,
        pct: vehicles.length > 0 ? (matching.length / vehicles.length) * 100 : 0,
        totalCost,
        totalPrice,
      };
    });

    const totalCost = vehicles.reduce((s: number, v: any) => s + (v.originalprice || v.price || 0), 0);
    const totalPrice = vehicles.reduce((s: number, v: any) => s + (v.price || 0), 0);
    const avgMileage = vehicles.length > 0
      ? Math.round(vehicles.reduce((s: number, v: any) => s + (v.mileage || 0), 0) / vehicles.length)
      : 0;

    // Top sellers by make + model
    const modelCounts: Record<string, number> = {};
    vehicles.forEach((v: any) => {
      const key = `${v.make} ${v.model}`.toUpperCase();
      modelCounts[key] = (modelCounts[key] || 0) + 1;
    });
    const topSellers = Object.entries(modelCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([model, count]) => ({ model, count }));

    // Lead counts from Supabase
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const [testDrives, offers, financing, tradeIns] = await Promise.all([
      supabase.from('test_drive_leads').select('id', { count: 'exact', head: true }),
      supabase.from('offer_leads').select('id', { count: 'exact', head: true }),
      supabase.from('financing_leads').select('id', { count: 'exact', head: true }),
      supabase.from('trade_in_leads').select('id', { count: 'exact', head: true }),
    ]);

    const [tdToday, offToday, finToday, tiToday] = await Promise.all([
      supabase.from('test_drive_leads').select('id', { count: 'exact', head: true }).gte('created_at', todayStart.toISOString()),
      supabase.from('offer_leads').select('id', { count: 'exact', head: true }).gte('created_at', todayStart.toISOString()),
      supabase.from('financing_leads').select('id', { count: 'exact', head: true }).gte('created_at', todayStart.toISOString()),
      supabase.from('trade_in_leads').select('id', { count: 'exact', head: true }).gte('created_at', todayStart.toISOString()),
    ]);

    const leadTotal = (testDrives.count || 0) + (offers.count || 0) + (financing.count || 0) + (tradeIns.count || 0);
    const newToday = (tdToday.count || 0) + (offToday.count || 0) + (finToday.count || 0) + (tiToday.count || 0);

    res.json({
      inventory: {
        ageRows,
        totalVehicles: vehicles.length,
        totalCost,
        totalPrice,
        avgMileage,
      },
      leads: {
        total: leadTotal,
        newToday,
        testDrives: testDrives.count || 0,
        offers: offers.count || 0,
        financing: financing.count || 0,
        tradeIns: tradeIns.count || 0,
      },
      topSellers,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Dashboard error' });
  }
});

/**
 * CRM — Unified leads API
 */
app.get('/api/admin/leads', async (req, res) => {
  try {
    const type = req.query['type'] as string | undefined;
    const status = req.query['status'] as string | undefined;

    const fetchTable = async (table: string, leadType: string) => {
      let query = supabase.from(table).select('*').order('created_at', { ascending: false });
      if (status && status !== 'all') {
        query = query.eq('status', status);
      }
      const { data, error } = await query;
      if (error) { console.error(`Error fetching ${table}:`, error); return []; }
      return (data || []).map((row: any) => ({
        ...row,
        _type: leadType,
        // Normalize name fields across lead types
        _name: row.firstname
          ? `${row.firstname} ${row.lastname || ''}`.trim()
          : row.name || 'Unknown',
        _email: row.email || '',
        _phone: row.phone || '',
      }));
    };

    let allLeads: any[] = [];

    if (!type || type === 'all') {
      const [financing, tradeIn, testDrive, offer, contact] = await Promise.all([
        fetchTable('financing_leads', 'financing'),
        fetchTable('trade_in_leads', 'trade-in'),
        fetchTable('test_drive_leads', 'test-drive'),
        fetchTable('offer_leads', 'offer'),
        fetchTable('contact_leads', 'contact'),
      ]);
      allLeads = [...financing, ...tradeIn, ...testDrive, ...offer, ...contact];
    } else {
      const tableMap: Record<string, string> = {
        'financing': 'financing_leads',
        'trade-in': 'trade_in_leads',
        'test-drive': 'test_drive_leads',
        'offer': 'offer_leads',
        'contact': 'contact_leads',
      };
      if (tableMap[type]) {
        allLeads = await fetchTable(tableMap[type], type);
      }
    }

    // Sort all by created_at desc
    allLeads.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    res.json({ total: allLeads.length, leads: allLeads });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch leads' });
  }
});

app.post('/api/admin/leads/:type/:id/status', async (req, res) => {
  try {
    const { type, id } = req.params;
    const { status } = req.body;
    const tableMap: Record<string, string> = {
      'financing': 'financing_leads',
      'trade-in': 'trade_in_leads',
      'test-drive': 'test_drive_leads',
      'offer': 'offer_leads',
      'contact': 'contact_leads',
    };
    const table = tableMap[type];
    if (!table) { res.status(400).json({ error: 'Invalid lead type' }); return; }

    const { error } = await supabase.from(table).update({ status }).eq('id', id);
    if (error) { console.error(error); res.status(500).json({ error: 'Failed to update' }); return; }
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/admin/leads/:type/:id/notes', async (req, res) => {
  try {
    const { type, id } = req.params;
    const { admin_notes } = req.body;
    const tableMap: Record<string, string> = {
      'financing': 'financing_leads',
      'trade-in': 'trade_in_leads',
      'test-drive': 'test_drive_leads',
      'offer': 'offer_leads',
      'contact': 'contact_leads',
    };
    const table = tableMap[type];
    if (!table) { res.status(400).json({ error: 'Invalid lead type' }); return; }

    const { error } = await supabase.from(table).update({ admin_notes }).eq('id', id);
    if (error) { console.error(error); res.status(500).json({ error: 'Failed to update' }); return; }
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

/**
 * AI Document Scanner — Bill of Sale
 * Extracts: VIN, purchase price, seller name/address, auction/source, date, odometer
 */
app.post('/api/admin/scan/bill-of-sale', upload.single('file'), async (req: any, res) => {
  try {
    if (!req.file) { res.status(400).json({ error: 'No file uploaded' }); return; }

    const base64 = req.file.buffer.toString('base64');
    const mediaType = req.file.mimetype as 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf';

    let content: any[];
    if (mediaType === 'application/pdf') {
      content = [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
        { type: 'text', text: `Extract all data from this bill of sale document. Return a JSON object with these fields (use null for missing values):
{
  "vin": "string",
  "purchase_price": number,
  "purchase_date": "YYYY-MM-DD",
  "odometer": number,
  "seller_name": "string",
  "seller_address": "string",
  "seller_city": "string",
  "seller_state": "string",
  "seller_zip": "string",
  "seller_type": "auction|dealer|private",
  "auction_name": "string or null",
  "buyer_fee": number or null,
  "notes": "any other relevant info"
}
Return ONLY the JSON, no other text.` },
      ];
    } else {
      content = [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
        { type: 'text', text: `Extract all data from this bill of sale image. Return a JSON object with these fields (use null for missing values):
{
  "vin": "string",
  "purchase_price": number,
  "purchase_date": "YYYY-MM-DD",
  "odometer": number,
  "seller_name": "string",
  "seller_address": "string",
  "seller_city": "string",
  "seller_state": "string",
  "seller_zip": "string",
  "seller_type": "auction|dealer|private",
  "auction_name": "string or null",
  "buyer_fee": number or null,
  "notes": "any other relevant info"
}
Return ONLY the JSON, no other text.` },
      ];
    }

    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages: [{ role: 'user', content }],
    });

    const text = (msg.content[0] as any).text || '';
    // Extract JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : null;

    res.json({ extracted: parsed, raw: text });
  } catch (err) {
    console.error('Bill of sale scan error:', err);
    res.status(500).json({ error: 'Failed to scan document' });
  }
});

/**
 * AI Document Scanner — Receipt (transport, repair, detail, etc.)
 * Extracts: vendor, amount, description, category, date
 */
app.post('/api/admin/scan/receipt', upload.single('file'), async (req: any, res) => {
  try {
    if (!req.file) { res.status(400).json({ error: 'No file uploaded' }); return; }

    const base64 = req.file.buffer.toString('base64');
    const mediaType = req.file.mimetype as 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf';

    let content: any[];
    const prompt = `Extract data from this receipt/invoice. Return a JSON object:
{
  "vendor_name": "string",
  "vendor_address": "string or null",
  "vendor_phone": "string or null",
  "amount": number,
  "date": "YYYY-MM-DD",
  "description": "brief description of service/item",
  "category": "Transportation|Repair|Detail|Inspection|Registration|Parts|Tow|Other",
  "payment_method": "ACH|Check|Cash|Credit Card|Wire|Other or null",
  "line_items": [{"description": "string", "amount": number}],
  "notes": "any other relevant info"
}
Return ONLY the JSON, no other text.`;

    if (mediaType === 'application/pdf') {
      content = [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
        { type: 'text', text: prompt },
      ];
    } else {
      content = [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
        { type: 'text', text: prompt },
      ];
    }

    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages: [{ role: 'user', content }],
    });

    const text = (msg.content[0] as any).text || '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : null;

    res.json({ extracted: parsed, raw: text });
  } catch (err) {
    console.error('Receipt scan error:', err);
    res.status(500).json({ error: 'Failed to scan receipt' });
  }
});

/**
 * AI Vehicle Description Generator
 */
app.post('/api/admin/generate-description', async (req, res) => {
  try {
    const v = req.body;
    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 512,
      messages: [{ role: 'user', content: `Write a compelling, professional used car listing description for this vehicle. Keep it under 150 words. Be enthusiastic but honest. Do not make up features — only use what's provided.

Vehicle: ${v.year} ${v.make} ${v.model} ${v.trim || ''}
Mileage: ${v.mileage || 'N/A'}
Exterior: ${v.exterior_color || 'N/A'}
Interior: ${v.interior_color || 'N/A'}
Drivetrain: ${v.drivetrain || 'N/A'}
Engine: ${v.engine || 'N/A'}
Transmission: ${v.transmission || 'N/A'}
Fuel: ${v.fuel || 'N/A'}
Features: ${v.features || 'N/A'}

Return only the description text, no headers or labels.` }],
    });

    const text = (msg.content[0] as any).text || '';
    res.json({ description: text.trim() });
  } catch (err) {
    console.error('Description gen error:', err);
    res.status(500).json({ error: 'Failed to generate description' });
  }
});

/**
 * Admin — get single vehicle from Supabase by VIN
 */
app.get('/api/admin/vehicles/:vin', async (req, res) => {
  try {
    const { data } = await supabase
      .from('vehicles')
      .select('*')
      .eq('vin', req.params.vin)
      .maybeSingle();
    res.json(data || null);
  } catch (err) {
    console.error(err);
    res.status(500).json(null);
  }
});

/**
 * Admin — upload vehicle photo to Supabase Storage
 */
app.post('/api/admin/vehicle/photo', upload.single('file'), async (req: any, res) => {
  try {
    if (!req.file) { res.status(400).json({ error: 'No file' }); return; }
    const vin = req.body.vin;
    const sortOrder = req.body.sort_order || '0';
    const ext = req.file.originalname.split('.').pop() || 'jpg';
    const fileName = `${vin}/${Date.now()}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from('vehicle-photos')
      .upload(fileName, req.file.buffer, { contentType: req.file.mimetype });

    if (uploadError) {
      console.error('Upload error:', uploadError);
      res.status(500).json({ error: 'Upload failed' });
      return;
    }

    const { data: urlData } = supabase.storage
      .from('vehicle-photos')
      .getPublicUrl(fileName);

    // Save to vehicle_photos table
    await supabase.from('vehicle_photos').insert({
      vin, url: urlData.publicUrl, sort_order: parseInt(sortOrder),
    });

    res.json({ url: urlData.publicUrl });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Photo upload failed' });
  }
});

/**
 * Admin — list all vehicles from Supabase
 */
app.get('/api/admin/vehicles', async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from('vehicles')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) { console.error(error); res.status(500).json({ error: 'Failed to fetch' }); return; }
    res.json(data || []);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * Admin vehicle intake — create vehicle + seller + optional floor plan
 */
app.post('/api/admin/vehicle/intake', async (req, res) => {
  try {
    const { vehicle, seller, flooring } = req.body;
    if (!vehicle?.vin) { res.status(400).json({ error: 'VIN required' }); return; }

    // Upsert seller if provided
    let sellerId = null;
    if (seller?.name) {
      // Check if seller already exists
      const { data: existing } = await supabase
        .from('sellers')
        .select('id')
        .eq('name', seller.name)
        .maybeSingle();

      if (existing) {
        sellerId = existing.id;
      } else {
        const { data: newSeller } = await supabase
          .from('sellers')
          .insert(seller)
          .select('id')
          .single();
        sellerId = newSeller?.id;
      }
    }

    // Generate stock number
    const prefix = 'BW';
    const suffix = vehicle.vin.slice(-6).toUpperCase();
    const stockNumber = `${prefix}${suffix}`;

    // Insert vehicle
    const { error: vehError } = await supabase.from('vehicles').insert({
      ...vehicle,
      stock_number: stockNumber,
      seller_id: sellerId,
      asking_price: vehicle.purchase_price,
      advertising_price: vehicle.purchase_price,
    });

    if (vehError) {
      console.error('Vehicle insert error:', vehError);
      res.status(500).json({ error: 'Failed to save vehicle', detail: vehError.message });
      return;
    }

    // Create floor plan if requested
    if (flooring) {
      await supabase.from('vehicle_floor_plans').insert({
        vin: vehicle.vin,
        ...flooring,
      });
    }

    res.json({ success: true, stock_number: stockNumber });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Intake failed' });
  }
});

/**
 * Admin vehicle detail — fetch internal data (pricing overrides, cost adds, floor plans)
 */
app.get('/api/admin/vehicle/:vin', async (req, res) => {
  try {
    const { vin } = req.params;

    const [pricing, costAdds, floorPlans, photos] = await Promise.all([
      supabase.from('vehicle_pricing').select('*').eq('vin', vin).maybeSingle(),
      supabase.from('vehicle_cost_adds').select('*').eq('vin', vin).order('date_added', { ascending: true }),
      supabase.from('vehicle_floor_plans').select('*').eq('vin', vin).order('date_floored', { ascending: true }),
      supabase.from('vehicle_photos').select('*').eq('vin', vin).order('sort_order', { ascending: true }),
    ]);

    res.json({
      pricing: pricing.data || null,
      costAdds: costAdds.data || [],
      floorPlans: floorPlans.data || [],
      photos: photos.data || [],
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load vehicle data' });
  }
});

/**
 * Admin vehicle save — upsert pricing, cost adds, floor plans
 */
app.post('/api/admin/vehicle/save', async (req, res) => {
  try {
    const { vin, pricing, costAdds, floorPlans } = req.body;
    if (!vin) { res.status(400).json({ error: 'VIN required' }); return; }

    // Upsert pricing
    if (pricing) {
      await supabase.from('vehicle_pricing').upsert(
        { vin, ...pricing, updated_at: new Date().toISOString() },
        { onConflict: 'vin' }
      );
    }

    // Replace cost adds: delete existing, insert new
    await supabase.from('vehicle_cost_adds').delete().eq('vin', vin);
    if (costAdds?.length) {
      const rows = costAdds.map((c: any) => ({ ...c, vin, id: undefined }));
      await supabase.from('vehicle_cost_adds').insert(rows);
    }

    // Replace floor plans: delete existing, insert new
    await supabase.from('vehicle_floor_plans').delete().eq('vin', vin);
    if (floorPlans?.length) {
      const rows = floorPlans.map((f: any) => ({ ...f, vin, id: undefined }));
      await supabase.from('vehicle_floor_plans').insert(rows);
    }

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to save' });
  }
});

/**
 * vAuto CSV inventory feed
 * vAuto pushes CSV files to /home/vauto/inventory/ via FTP.
 * These endpoints read and parse those files.
 */
const VAUTO_DIR = process.env['VAUTO_DIR'] || '/home/vauto/inventory';

// Cache parsed CSV to avoid re-reading on every request (5 min TTL)
let vautoCache: { vehicles: any[]; ts: number } = { vehicles: [], ts: 0 };
const VAUTO_CACHE_TTL = 5 * 60 * 1000;

async function readVautoCsv(): Promise<any[]> {
  if (vautoCache.vehicles.length > 0 && Date.now() - vautoCache.ts < VAUTO_CACHE_TTL) {
    return vautoCache.vehicles;
  }
  let files: string[];
  try {
    files = await readdir(VAUTO_DIR);
  } catch {
    return [];
  }
  const csvFiles = files.filter(f => f.toLowerCase().endsWith('.csv')).sort();
  if (csvFiles.length === 0) return [];

  // Use the most recent CSV file
  const latest = csvFiles[csvFiles.length - 1];
  const raw = await readFile(join(VAUTO_DIR, latest), 'utf-8');
  const records: Record<string, string>[] = csvParse(raw, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    bom: true,
  });
  const vehicles = records.map(r => mapVautoRow(r));
  vautoCache = { vehicles, ts: Date.now() };
  return vehicles;
}

function mapVautoRow(r: Record<string, string>): any {
  // Match vAuto CSV columns to our Vehicle shape.
  // g() tries exact match first, then case-insensitive with stripped separators.
  const g = (keys: string[]): string => {
    for (const k of keys) {
      if (r[k] !== undefined) return r[k];
      const found = Object.keys(r).find(rk => rk.toLowerCase().replace(/[\s_-]/g, '') === k.toLowerCase().replace(/[\s_-]/g, ''));
      if (found) return r[found];
    }
    return '';
  };

  const vin = g(['VIN', 'vin']);
  const photos = g(['Photos', 'PhotoURLs', 'Photo URLs', 'PhotoUrl', 'ImageURLs', 'Image URLs', 'ImageList']);
  const photoList = photos ? photos.split(/[|,;]/).map((p: string) => p.trim()).filter(Boolean) : [];
  const features = g(['Features']);
  const featureList = features ? features.split('|').map((f: string) => f.trim()).filter(Boolean) : [];
  const series = g(['Series', 'Series Detail']);
  const trim = g(['Trim']) || series;
  const condition = g(['New/Used', 'NewUsed', 'Condition', 'Type']);

  return {
    vin,
    stocknumber: g(['Stock #', 'StockNumber', 'Stock Number', 'Stock']),
    year: parseInt(g(['Year', 'ModelYear', 'Model Year']), 10) || 0,
    make: g(['Make']),
    model: g(['Model']),
    trim,
    series,
    body: g(['Body', 'BodyStyle', 'Body Style', 'BodyType']),
    condition: condition === 'U' ? 'Used' : condition === 'N' ? 'New' : condition,
    mileage: parseInt(g(['Odometer', 'Mileage', 'Miles']), 10) || 0,
    price: parseFloat(g(['Price', 'InternetPrice', 'Internet Price', 'SellingPrice', 'Selling Price', 'AskingPrice'])) || 0,
    originalprice: parseFloat(g(['MSRP', 'ListPrice', 'List Price', 'OriginalPrice'])) || 0,
    msrp: parseFloat(g(['MSRP'])) || null,
    exteriorcolor: g(['Colour', 'ExteriorColor', 'Exterior Color', 'ExtColor']),
    interiorcolor: g(['Interior Color', 'InteriorColor', 'IntColor']),
    exteriorcolorstandard: g(['Colour', 'ExteriorColorGeneric', 'Exterior Color Generic']),
    interiorcolorstandard: g(['Interior Color', 'InteriorColorGeneric', 'Interior Color Generic']),
    fuel: g(['Fuel', 'FuelType', 'Fuel Type']),
    drivetrainstandard: g(['Drivetrain Desc', 'Drivetrain', 'DriveTrain', 'DriveType']),
    engine: g(['Engine', 'EngineDescription', 'Engine Description']),
    transmission: g(['Transmission', 'TransmissionType']),
    doors: parseInt(g(['Door Count', 'Doors']), 10) || 0,
    description: g(['Description', 'Comments', 'VehicleDescription', 'DealerComments']),
    highlights: featureList,
    citympg: parseInt(g(['City MPG']), 10) || null,
    hwympg: parseInt(g(['Highway MPG']), 10) || null,
    photos: photoList,
    featuredphoto: photoList[0] || '',
    photocount: parseInt(g(['Photo Count']), 10) || photoList.length,
    certified: g(['Certified']).toLowerCase() === 'yes' ? 1 : 0,
    dateinstock: g(['Inventory Date', 'DateInStock', 'Date In Stock', 'StockDate']) || new Date().toISOString(),
    created_at: g(['Inventory Date', 'DateInStock', 'Date In Stock', 'StockDate']) || new Date().toISOString(),
    age: parseInt(g(['Age']), 10) || 0,
    dealer: {
      name: g(['Dealer Name']),
      city: g(['Dealer City']),
      state: g(['Dealer Region']),
      address: g(['Dealer Address']),
      zip: g(['Dealer Postal Code']),
    },
    _source: 'vauto',
  };
}

// Check vAuto feed status
app.get('/api/admin/vauto/status', async (_req, res) => {
  try {
    let files: string[] = [];
    let dirExists = false;
    try {
      files = await readdir(VAUTO_DIR);
      dirExists = true;
    } catch { /* dir doesn't exist yet */ }

    const csvFiles = files.filter(f => f.toLowerCase().endsWith('.csv'));
    let latestFile = null;
    let latestModified = null;
    let vehicleCount = 0;

    if (csvFiles.length > 0) {
      const latest = csvFiles.sort().pop()!;
      latestFile = latest;
      const info = await stat(join(VAUTO_DIR, latest));
      latestModified = info.mtime.toISOString();
      try {
        const vehicles = await readVautoCsv();
        vehicleCount = vehicles.length;
      } catch { /* parse error */ }
    }

    res.json({
      dirExists,
      directory: VAUTO_DIR,
      fileCount: csvFiles.length,
      latestFile,
      latestModified,
      vehicleCount,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to check vAuto status' });
  }
});

// Get parsed vAuto inventory
app.get('/api/admin/vauto/inventory', async (_req, res) => {
  try {
    const vehicles = await readVautoCsv();
    res.json({ total: vehicles.length, results: vehicles });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to read vAuto feed' });
  }
});

/**
 * Public inventory endpoints — serves vAuto CSV data in Overfuel-compatible format
 * so the Angular frontend works without changes to component templates.
 */

// Helper: compute finance estimates for a vehicle
function computeFinance(price: number) {
  const rate = 0.069;
  const months = 60;
  const taxRate = 0.0543;
  const docFees = 1200;
  const taxAmt = price * taxRate;
  const loanAmount = price + docFees;
  const monthlyRate = rate / 12;
  const monthlyPayment = monthlyRate === 0
    ? loanAmount / months
    : loanAmount * (monthlyRate * Math.pow(1 + monthlyRate, months)) / (Math.pow(1 + monthlyRate, months) - 1);
  const totalCost = monthlyPayment * months;
  const totalInterest = totalCost - loanAmount;
  return {
    fees: [],
    vehicle_amount: price,
    shipping_amount: 0,
    tradein_amount: 0,
    tradein_remainingbalance: 0,
    down_payment: 0,
    doctitlefees_amount: docFees,
    tax_amount: taxAmt,
    tax_rate: taxRate * 100,
    tax_rate_formatted: taxRate * 100,
    tax_tradeincredit: null,
    loan_amount: loanAmount,
    loan_months: months,
    interest_rate: rate,
    interest_rate_formatted: rate * 100,
    credit_tier: 'excellent',
    total_cost: totalCost,
    total_interest: totalInterest,
    monthly_payment: Math.round(monthlyPayment),
  };
}

// Search inventory with filters (Overfuel-compatible response)
app.get('/api/inventory/search', async (req, res) => {
  try {
    let vehicles = await readVautoCsv();
    const q = req.query;

    // Apply filters
    if (q['make[]']) {
      const makes = Array.isArray(q['make[]']) ? q['make[]'] as string[] : [q['make[]'] as string];
      vehicles = vehicles.filter(v => makes.some(m => v.make.toLowerCase() === m.toLowerCase()));
    }
    if (q['model[]']) {
      const models = Array.isArray(q['model[]']) ? q['model[]'] as string[] : [q['model[]'] as string];
      vehicles = vehicles.filter(v => models.some(m => v.model.toLowerCase() === m.toLowerCase()));
    }
    if (q['body[]']) {
      const bodies = Array.isArray(q['body[]']) ? q['body[]'] as string[] : [q['body[]'] as string];
      vehicles = vehicles.filter(v => bodies.some(b => v.body.toLowerCase().includes(b.toLowerCase())));
    }
    if (q['condition[]']) {
      const conds = Array.isArray(q['condition[]']) ? q['condition[]'] as string[] : [q['condition[]'] as string];
      vehicles = vehicles.filter(v => conds.some(c => v.condition.toLowerCase() === c.toLowerCase()));
    }
    if (q['fuel[]']) {
      const fuels = Array.isArray(q['fuel[]']) ? q['fuel[]'] as string[] : [q['fuel[]'] as string];
      vehicles = vehicles.filter(v => fuels.some(f => v.fuel.toLowerCase().includes(f.toLowerCase())));
    }
    if (q['drivetrainstandard[]']) {
      const dts = Array.isArray(q['drivetrainstandard[]']) ? q['drivetrainstandard[]'] as string[] : [q['drivetrainstandard[]'] as string];
      vehicles = vehicles.filter(v => dts.some(d => v.drivetrainstandard.toLowerCase().includes(d.toLowerCase())));
    }
    if (q['price[gt]']) vehicles = vehicles.filter(v => v.price > Number(q['price[gt]']));
    if (q['price[lt]']) vehicles = vehicles.filter(v => v.price < Number(q['price[lt]']));
    if (q['year[gt]']) vehicles = vehicles.filter(v => v.year > Number(q['year[gt]']));
    if (q['year[lt]']) vehicles = vehicles.filter(v => v.year < Number(q['year[lt]']));
    if (q['mileage[lt]']) vehicles = vehicles.filter(v => v.mileage < Number(q['mileage[lt]']));
    if (q['vin[]']) {
      const vin = (Array.isArray(q['vin[]']) ? q['vin[]'][0] : q['vin[]']) as string;
      vehicles = vehicles.filter(v => v.vin.toLowerCase() === vin.toLowerCase());
    }

    // Add finance data and photos array for list view
    const results = vehicles.map((v, i) => ({
      ...v,
      id: i + 1,
      dealer_id: 1367,
      status: 'Active',
      statusoverride: '',
      featured: i < 6 && v.photocount > 1 ? 1 : 0,
      location: '',
      specialprice: '',
      addonprice: '',
      modelnumber: '',
      seatingcapacity: 0,
      tags: null,
      title: `${v.year} ${v.make} ${v.model} ${v.trim}`.trim(),
      url: `/showroom/${v.vin}`,
      hot: 0,
      new: v.condition === 'New' ? 1 : 0,
      wholesale: 0,
      finance: computeFinance(v.price),
      video: { source: null, url: null, autoplay: null, aspectratio: null },
    }));

    // Sort by price descending
    results.sort((a: any, b: any) => b.price - a.price);

    const allMakes = [...new Set(vehicles.map(v => v.make))].sort();
    const allBodies = [...new Set(vehicles.map(v => v.body))].filter(Boolean).sort();

    res.json({
      meta: {
        limit: results.length,
        offset: 0,
        sortby: 'price',
        sortorder: 'desc',
        total: results.length,
        condition: ['used'],
        body: allBodies,
        make: allMakes,
        finance: { months: 60, tier: null, rate: '6.9', down_pct: null, down_amount: null },
        pagetitle: 'Inventory',
        params: { vin: '' },
      },
      results,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Inventory search failed' });
  }
});

// Filter counts (Overfuel-compatible response)
app.get('/api/inventory/filters', async (req, res) => {
  try {
    const vehicles = await readVautoCsv();

    const countField = (field: string) => {
      const counts: Record<string, number> = {};
      vehicles.forEach(v => {
        const val = v[field];
        if (val) counts[val] = (counts[val] || 0) + 1;
      });
      return { counts };
    };

    const prices = vehicles.map(v => v.price).filter(Boolean);
    const years = vehicles.map(v => v.year).filter(Boolean);
    const miles = vehicles.map(v => v.mileage).filter(Boolean);

    // Build model groups (make → { model: count })
    const modelgroups: Record<string, Record<string, number>> = {};
    vehicles.forEach(v => {
      if (!v.make) return;
      if (!modelgroups[v.make]) modelgroups[v.make] = {};
      modelgroups[v.make][v.model] = (modelgroups[v.make][v.model] || 0) + 1;
    });

    res.json({
      meta: { cache: false },
      results: {
        filters: {
          price: { min: Math.min(...prices, 0), max: Math.max(...prices, 0) },
          year: { min: Math.min(...years, 0), max: Math.max(...years, 0) },
          mileage: { min: Math.min(...miles, 0), max: Math.max(...miles, 0), buckets: {} },
          make: countField('make'),
          model: countField('model'),
          trim: countField('trim'),
          condition: countField('condition'),
          body: countField('body'),
          fuel: countField('fuel'),
          transmissionstandard: countField('transmission'),
          drivetrainstandard: countField('drivetrainstandard'),
          engine: countField('engine'),
          seatingcapacity: { counts: {} },
          exteriorcolorstandard: countField('exteriorcolorstandard'),
          interiorcolorstandard: countField('interiorcolorstandard'),
          highlights: {},
          dealer_id: { counts: {} },
          location: { counts: {} },
          modelgroups,
          trimgroups: {},
        },
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Filter fetch failed' });
  }
});

// Single vehicle detail (Overfuel-compatible response)
app.get('/api/inventory/:vin', async (req, res) => {
  try {
    const vehicles = await readVautoCsv();
    const v = vehicles.find(v => v.vin.toLowerCase() === req.params['vin'].toLowerCase());
    if (!v) { res.status(404).json({ error: 'Vehicle not found' }); return; }

    const photos = v.photos.map((url: string, i: number) => ({
      id: i + 1,
      large: url,
      thumbnail: url,
      sortorder: i,
    }));

    // Categorize features into highlight groups
    const highlightCategories: Record<string, string[]> = {
      Interior: [],
      Exterior: [],
      'Entertainment and Technology': [],
      'Safety and Security': [],
      Performance: [],
    };
    const interiorKeywords = ['seat', 'leather', 'upholster', 'steering', 'mirror', 'armrest', 'vanity', 'reading light', 'illuminat', 'door bin', 'carpet', 'trim'];
    const safetyKeywords = ['airbag', 'abs', 'brake', 'traction', 'stability', 'tire pressure', 'alarm', 'security', 'anti-roll'];
    const techKeywords = ['speaker', 'radio', 'cd', 'audio', 'bluetooth', 'usb', 'navigation', 'display', 'camera', 'data system'];
    const exteriorKeywords = ['wheel', 'bumper', 'spoiler', 'headlight', 'fog light', 'molding', 'wiper', 'roof', 'window'];

    (v.highlights || []).forEach((f: string) => {
      const fl = f.toLowerCase();
      if (safetyKeywords.some(k => fl.includes(k))) highlightCategories['Safety and Security'].push(f);
      else if (techKeywords.some(k => fl.includes(k))) highlightCategories['Entertainment and Technology'].push(f);
      else if (interiorKeywords.some(k => fl.includes(k))) highlightCategories['Interior'].push(f);
      else if (exteriorKeywords.some(k => fl.includes(k))) highlightCategories['Exterior'].push(f);
      else highlightCategories['Performance'].push(f);
    });

    const result = {
      ...v,
      id: 1,
      dealer_id: 1367,
      status: 'Active',
      statusoverride: '',
      featured: 0,
      location: '',
      adjustmentlabel: null,
      specialprice: 0,
      specialpricelabel: null,
      addonprice: 0,
      addonpricelabel: null,
      addonpricedescription: null,
      modelnumber: '',
      style: null,
      commercial: 0,
      transmissionstandard: v.transmission,
      displacement: 0,
      cylinders: 0,
      blocktype: '',
      powercycle: null,
      maxhorsepower: 0,
      maxhorsepowerat: 0,
      maxtorque: 0,
      maxtorqueat: 0,
      aspiration: '',
      mpgcity: v.citympg || 0,
      mpghwy: v.hwympg || 0,
      evrange: null,
      evbatterycapacity: null,
      evchargerrating: null,
      fueltank: 0,
      seatingcapacity: 0,
      towingcapacity: null,
      dimensions: null,
      axle: null,
      axleratio: null,
      reardoorgate: null,
      gvwr: null,
      emptyweight: null,
      loadcapacity: null,
      dimension_width: 0,
      dimension_length: 0,
      dimension_height: 0,
      bedlength: null,
      wheelbase: 0,
      frontwheel: '',
      rearwheel: '',
      fronttire: '',
      reartire: '',
      carfaxurl: '',
      carfaxicon: '',
      carfaxalt: '',
      carfaxoneowner: 0,
      carfaxownerstext: '',
      carfaxownersicon: '',
      carfaxusetext: '',
      carfaxuseicon: '',
      carfaxservicerecords: 0,
      carfaxaccidenttext: '',
      carfaxaccidenticon: '',
      carfaxsnapshotkey: '',
      autocheck: null,
      monroneysticker: null,
      notes: '',
      tags: null,
      highlights: highlightCategories,
      incentives: [],
      metatitle: null,
      metadescription: null,
      vehicledescription: v.description || null,
      additionaldetails: null,
      pricingdisclaimer: null,
      hideestimatedpayments: 0,
      schemabody: v.body,
      title: `${v.year} ${v.make} ${v.model} ${v.trim}`.trim(),
      url: `/showroom/${v.vin}`,
      hot: 0,
      new: v.condition === 'New' ? 1 : 0,
      bodyshippingstandard: '',
      photos,
      video: { source: null, url: null, autoplay: null, aspectratio: null },
      onhold: false,
      tiles: [],
      installedoptions: [],
      finance: computeFinance(v.price),
    };

    res.json({
      meta: { identifier: v.vin },
      results: result,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Vehicle lookup failed' });
  }
});

/**
 * Site settings (admin-configurable website values)
 */
app.get('/api/admin/settings', async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from('site_settings')
      .select('category, settings')
      .order('category');
    if (error) { console.error(error); res.status(500).json({ error: 'Failed to load' }); return; }
    const settings: Record<string, any> = {};
    for (const row of data || []) {
      settings[row.category] = row.settings;
    }
    res.json({ settings });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/admin/settings', async (req, res) => {
  try {
    const { category, settings } = req.body;
    if (!category || !settings) { res.status(400).json({ error: 'category and settings required' }); return; }
    const { error } = await supabase
      .from('site_settings')
      .upsert(
        { category, settings, updated_at: new Date().toISOString() },
        { onConflict: 'category' }
      );
    if (error) { console.error(error); res.status(500).json({ error: 'Failed to save' }); return; }
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * Proxy Overfuel API requests to avoid CORS restrictions.
 * Browser calls /api/dealers/... → this server forwards to api.overfuel.com
 */
app.use('/api/dealers', async (req, res) => {
  const targetUrl = `https://api.overfuel.com/api/1.0/dealers${req.url}`;
  try {
    const response = await fetch(targetUrl);
    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: 'Upstream API error' });
  }
});

/**
 * Serve static files from /browser
 */
app.use(
  express.static(browserDistFolder, {
    maxAge: '1y',
    index: false,
    redirect: false,
  }),
);

/**
 * Handle all other requests by rendering the Angular application.
 */
app.use((req, res, next) => {
  angularApp
    .handle(req)
    .then((response) =>
      response ? writeResponseToNodeResponse(response, res) : next(),
    )
    .catch(next);
});

/**
 * Start the server if this module is the main entry point.
 * The server listens on the port defined by the `PORT` environment variable, or defaults to 4000.
 */
if (isMainModule(import.meta.url)) {
  const port = process.env['PORT'] || 4000;
  app.listen(port, (error) => {
    if (error) {
      throw error;
    }

    console.log(`Node Express server listening on http://localhost:${port}`);
  });
}

/**
 * Request handler used by the Angular CLI (for dev-server and during build) or Firebase Cloud Functions.
 */
export const reqHandler = createNodeRequestHandler(app);
