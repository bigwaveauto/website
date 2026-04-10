import 'dotenv/config';
import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  isMainModule,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import express, { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { join } from 'node:path';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import Anthropic from '@anthropic-ai/sdk';
import { parse as csvParse } from 'csv-parse/sync';
import * as XLSX from 'xlsx';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import cors from 'cors';

const browserDistFolder = join(import.meta.dirname, '../browser');

const app = express();
app.set('trust proxy', 1);
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
 * Security middleware
 */
app.use(helmet({
  contentSecurityPolicy: false, // Angular handles its own CSP
  crossOriginEmbedderPolicy: false, // Allow loading external images
}));

app.use(cors({
  origin: [
    'https://bigwaveauto.com',
    'https://www.bigwaveauto.com',
    'http://104.236.238.131',
    'http://localhost:4000',
    'http://localhost:4200',
  ],
  credentials: true,
}));

app.use(express.json());

// Rate limiters
const leadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 submissions per 15 min per IP
  message: { error: 'Too many submissions. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const adminLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 60, // 60 requests per minute
  message: { error: 'Too many requests.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const aiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 10, // 10 AI requests per minute
  message: { error: 'Too many AI requests. Please wait.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// HTML escape helper to prevent injection in emails
function escHtml(str: string): string {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Whitelist of admin emails
const ADMIN_EMAILS = ['dave@bigwaveauto.com', 'dlucas589@gmail.com'];

// Server-side admin auth middleware — validates Supabase JWT and checks email whitelist
async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  const token = authHeader.slice(7);
  try {
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user?.email) {
      res.status(401).json({ error: 'Invalid or expired token' });
      return;
    }
    if (!ADMIN_EMAILS.includes(user.email.toLowerCase())) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }
    (req as any).adminUser = user;
    next();
  } catch {
    res.status(401).json({ error: 'Authentication failed' });
  }
}

// Input validation helpers
function validateEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || '');
}

function pickFields(data: any, allowed: string[]): any {
  const result: any = {};
  for (const key of allowed) {
    if (data[key] !== undefined) result[key] = data[key];
  }
  return result;
}

/**
 * Lead form submissions
 */

app.post('/api/leads/financing', leadLimiter, async (req, res) => {
  try {
    const data = pickFields(req.body, [
      'firstname', 'lastname', 'email', 'phone', 'dob', 'ssn',
      'street', 'city', 'state', 'zip', 'yearsAtAddress', 'housingStatus',
      'employerName', 'employmentStatus', 'monthlyIncome', 'yearsEmployed', 'coborrower',
    ]);
    if (!data.firstname || !data.email || !validateEmail(data.email)) {
      res.status(400).json({ error: 'Valid name and email required' }); return;
    }
    const lastFour = (data.ssn || '').slice(-4);
    if (data.ssn) data.ssn = encrypt(data.ssn);
    const { error } = await supabase.from('financing_leads').insert(data);
    if (error) { console.error('Lead save error'); res.status(500).json({ error: 'Failed to save' }); return; }

    await resend.emails.send({
      from: FROM_EMAIL,
      to: NOTIFY_EMAIL,
      subject: `New Financing Application — ${escHtml(data.firstname)} ${escHtml(data.lastname)}`,
      html: `
        <h2>New Financing Application</h2>
        <p><b>Name:</b> ${escHtml(data.firstname)} ${escHtml(data.lastname)}</p>
        <p><b>Email:</b> ${escHtml(data.email)}</p>
        <p><b>Phone:</b> ${escHtml(data.phone)}</p>
        <p><b>DOB:</b> ${escHtml(data.dob)}</p>
        <p><b>SSN:</b> ***-**-${escHtml(lastFour) || 'N/A'}</p>
        <p><b>Address:</b> ${escHtml(data.street)}, ${escHtml(data.city)}, ${escHtml(data.state)} ${escHtml(data.zip)}</p>
        <p><b>Employment:</b> ${escHtml(data.employmentStatus)} at ${escHtml(data.employerName)}</p>
        <p><b>Monthly Income:</b> ${escHtml(data.monthlyIncome)}</p>
        <p><b>Co-borrower:</b> ${data.coborrower ? 'Yes' : 'No'}</p>
      `
    });
    res.json({ success: true });
  } catch (err) {
    console.error('Financing lead error');
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/leads/trade-in', leadLimiter, async (req, res) => {
  try {
    const data = pickFields(req.body, [
      'firstname', 'lastname', 'email', 'phone', 'year', 'make', 'model',
      'mileage', 'condition', 'vin', 'notes',
    ]);
    if (!data.email || !validateEmail(data.email)) {
      res.status(400).json({ error: 'Valid email required' }); return;
    }
    const { error } = await supabase.from('trade_in_leads').insert(data);
    if (error) { console.error('Lead save error'); res.status(500).json({ error: 'Failed to save' }); return; }

    await resend.emails.send({
      from: FROM_EMAIL,
      to: NOTIFY_EMAIL,
      subject: `New Trade-In Submission — ${escHtml(data.year)} ${escHtml(data.make)} ${escHtml(data.model)}`,
      html: `
        <h2>New Trade-In / Sell Submission</h2>
        <p><b>Vehicle:</b> ${escHtml(data.year)} ${escHtml(data.make)} ${escHtml(data.model)}</p>
        <p><b>Mileage:</b> ${escHtml(data.mileage)}</p>
        <p><b>Condition:</b> ${escHtml(data.condition)}</p>
        <p><b>VIN:</b> ${escHtml(data.vin) || 'Not provided'}</p>
        <p><b>Name:</b> ${escHtml(data.firstname)} ${escHtml(data.lastname)}</p>
        <p><b>Email:</b> ${escHtml(data.email)}</p>
        <p><b>Phone:</b> ${escHtml(data.phone)}</p>
        <p><b>Notes:</b> ${escHtml(data.notes) || 'None'}</p>
      `
    });
    res.json({ success: true });
  } catch (err) {
    console.error('Trade-in lead error');
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/leads/test-drive', leadLimiter, async (req, res) => {
  try {
    const data = pickFields(req.body, [
      'firstname', 'lastname', 'email', 'phone', 'year', 'make', 'model',
      'vin', 'stock', 'preferred_date', 'preferred_time', 'notes',
    ]);
    if (!data.email || !validateEmail(data.email)) {
      res.status(400).json({ error: 'Valid email required' }); return;
    }
    const { error } = await supabase.from('test_drive_leads').insert(data);
    if (error) { console.error('Lead save error'); res.status(500).json({ error: 'Failed to save' }); return; }

    await resend.emails.send({
      from: FROM_EMAIL,
      to: NOTIFY_EMAIL,
      subject: `Test Drive Request — ${escHtml(data.year)} ${escHtml(data.make)} ${escHtml(data.model)}`,
      html: `
        <h2>New Test Drive Request</h2>
        <p><b>Vehicle:</b> ${escHtml(data.year)} ${escHtml(data.make)} ${escHtml(data.model)}</p>
        <p><b>VIN:</b> ${escHtml(data.vin) || 'N/A'}</p>
        <p><b>Stock #:</b> ${escHtml(data.stock) || 'N/A'}</p>
        <p><b>Name:</b> ${escHtml(data.firstname)} ${escHtml(data.lastname)}</p>
        <p><b>Email:</b> ${escHtml(data.email)}</p>
        <p><b>Phone:</b> ${escHtml(data.phone)}</p>
        <p><b>Preferred Date:</b> ${escHtml(data.preferred_date) || 'Not specified'}</p>
        <p><b>Preferred Time:</b> ${escHtml(data.preferred_time) || 'Not specified'}</p>
        <p><b>Notes:</b> ${escHtml(data.notes) || 'None'}</p>
      `
    });
    res.json({ success: true });
  } catch (err) {
    console.error('Test drive lead error');
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/leads/reservation', leadLimiter, async (req, res) => {
  try {
    const { vehicle, info, coverage, delivery, verifyId } = req.body || {};
    if (!info?.email || !validateEmail(info.email)) {
      res.status(400).json({ error: 'Valid email required' }); return;
    }
    // Save to Supabase (best effort — table may not exist yet)
    try {
      await supabase.from('reservation_leads').insert({
        vin: vehicle?.vin,
        year: vehicle?.year,
        make: vehicle?.make,
        model: vehicle?.model,
        price: vehicle?.price,
        info, coverage, delivery,
        verify_id: verifyId,
      });
    } catch {}

    await resend.emails.send({
      from: FROM_EMAIL,
      to: NOTIFY_EMAIL,
      subject: `🎉 New Reservation — ${escHtml(vehicle?.year)} ${escHtml(vehicle?.make)} ${escHtml(vehicle?.model)}`,
      html: `
        <h2>New Vehicle Reservation</h2>
        <p><b>Vehicle:</b> ${escHtml(vehicle?.year)} ${escHtml(vehicle?.make)} ${escHtml(vehicle?.model)}</p>
        <p><b>VIN:</b> ${escHtml(vehicle?.vin)}</p>
        <p><b>Price:</b> $${escHtml(vehicle?.price)}</p>
        <hr>
        <h3>Customer</h3>
        <p><b>Name:</b> ${escHtml(info?.firstName)} ${escHtml(info?.lastName)}</p>
        <p><b>Email:</b> ${escHtml(info?.email)}</p>
        <p><b>Phone:</b> ${escHtml(info?.phone)}</p>
        <p><b>Address:</b> ${escHtml(info?.street)}, ${escHtml(info?.city)}, ${escHtml(info?.state)} ${escHtml(info?.zip)}</p>
        <hr>
        <h3>Coverage</h3>
        <p>${escHtml(coverage?.plan) || 'None'}</p>
        <hr>
        <h3>Delivery</h3>
        <p><b>Method:</b> ${escHtml(delivery?.method)}</p>
        ${delivery?.address ? `<p><b>Address:</b> ${escHtml(delivery.address.street)}, ${escHtml(delivery.address.city)}, ${escHtml(delivery.address.state)} ${escHtml(delivery.address.zip)}</p>` : ''}
        <hr>
        <p><b>Identity Verification:</b> ${escHtml(verifyId) || 'Manual verification required'}</p>
      `
    });
    res.json({ success: true });
  } catch (err) {
    console.error('Reservation lead error');
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/leads/make-offer', leadLimiter, async (req, res) => {
  try {
    const data = pickFields(req.body, [
      'firstname', 'lastname', 'email', 'phone', 'year', 'make', 'model',
      'vin', 'stock', 'offer_amount', 'listed_price', 'financing', 'notes',
    ]);
    if (!data.email || !validateEmail(data.email)) {
      res.status(400).json({ error: 'Valid email required' }); return;
    }
    const { error } = await supabase.from('offer_leads').insert(data);
    if (error) { console.error('Lead save error'); res.status(500).json({ error: 'Failed to save' }); return; }

    await resend.emails.send({
      from: FROM_EMAIL,
      to: NOTIFY_EMAIL,
      subject: `New Offer — $${escHtml(String(data.offer_amount))} on ${escHtml(data.year)} ${escHtml(data.make)} ${escHtml(data.model)}`,
      html: `
        <h2>New Offer Received</h2>
        <p><b>Vehicle:</b> ${escHtml(data.year)} ${escHtml(data.make)} ${escHtml(data.model)}</p>
        <p><b>VIN:</b> ${escHtml(data.vin) || 'N/A'}</p>
        <p><b>Listed Price:</b> $${escHtml(String(data.listed_price || 'N/A'))}</p>
        <p><b>Offer Amount:</b> $${escHtml(String(data.offer_amount))}</p>
        <p><b>Financing:</b> ${escHtml(data.financing)}</p>
        <p><b>Name:</b> ${escHtml(data.firstname)} ${escHtml(data.lastname)}</p>
        <p><b>Email:</b> ${escHtml(data.email)}</p>
        <p><b>Phone:</b> ${escHtml(data.phone)}</p>
        <p><b>Notes:</b> ${escHtml(data.notes) || 'None'}</p>
      `
    });
    res.json({ success: true });
  } catch (err) {
    console.error('Offer lead error');
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/leads/contact', leadLimiter, async (req, res) => {
  try {
    const data = pickFields(req.body, ['name', 'email', 'phone', 'topic', 'preferred_method', 'message']);
    if (!data.email || !validateEmail(data.email)) {
      res.status(400).json({ error: 'Valid email required' }); return;
    }
    const { error } = await supabase.from('contact_leads').insert(data);
    if (error) { console.error('Lead save error'); res.status(500).json({ error: 'Failed to save' }); return; }

    await resend.emails.send({
      from: FROM_EMAIL,
      to: NOTIFY_EMAIL,
      subject: `New Contact Message — ${escHtml(data.name)}`,
      html: `
        <h2>New Contact Message</h2>
        <p><b>Name:</b> ${escHtml(data.name)}</p>
        <p><b>Email:</b> ${escHtml(data.email)}</p>
        <p><b>Phone:</b> ${escHtml(data.phone) || 'Not provided'}</p>
        <p><b>Message:</b> ${escHtml(data.message)}</p>
      `
    });
    res.json({ success: true });
  } catch (err) {
    console.error('Contact lead error');
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * AI Chat — conversational vehicle search with tool use
 */
const CALENDLY_URL = process.env['CALENDLY_URL'] || 'https://calendly.com/bigwaveauto/visit';

const chatTools: any[] = [
  {
    name: 'search_inventory',
    description: 'Search current vehicle inventory by criteria. Returns matching vehicles.',
    input_schema: {
      type: 'object',
      properties: {
        price_max: { type: 'number', description: 'Maximum price' },
        price_min: { type: 'number', description: 'Minimum price' },
        make: { type: 'string', description: 'Vehicle make (e.g. Tesla, BMW)' },
        body_type: { type: 'string', description: 'Body type (e.g. SUV, Sedan)' },
        fuel_type: { type: 'string', description: 'Fuel type (e.g. Electric, Gasoline)' },
        max_mileage: { type: 'number', description: 'Maximum mileage' },
      },
    },
  },
  {
    name: 'capture_lead',
    description: 'Save customer contact info when they share their name, email, or phone. Call this as soon as you have at least a name and one contact method.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        email: { type: 'string' },
        phone: { type: 'string' },
        vehicle_interest: { type: 'string', description: 'What vehicle(s) they are interested in' },
        notes: { type: 'string' },
      },
      required: ['name'],
    },
  },
  {
    name: 'schedule_appointment',
    description: 'Generate a scheduling link for the customer to book a visit or test drive.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        email: { type: 'string' },
      },
    },
  },
];

async function executeToolCall(toolName: string, toolInput: any, inventory: any[]): Promise<string> {
  if (toolName === 'search_inventory') {
    let results = [...inventory];
    if (toolInput.price_max) results = results.filter(v => v.price <= toolInput.price_max);
    if (toolInput.price_min) results = results.filter(v => v.price >= toolInput.price_min);
    if (toolInput.make) results = results.filter(v => v.make.toLowerCase().includes(toolInput.make.toLowerCase()));
    if (toolInput.body_type) results = results.filter(v => v.body.toLowerCase().includes(toolInput.body_type.toLowerCase()));
    if (toolInput.fuel_type) results = results.filter(v => v.fuel.toLowerCase().includes(toolInput.fuel_type.toLowerCase()));
    if (toolInput.max_mileage) results = results.filter(v => v.mileage <= toolInput.max_mileage);
    const mapped = results.map(v => ({
      vin: v.vin, year: v.year, make: v.make, model: v.model, trim: v.trim,
      price: v.price, mileage: v.mileage, fuel: v.fuel, body: v.body,
      color: v.exteriorcolor, drivetrain: v.drivetrainstandard,
      photo: v.featuredphoto, url: `/showroom/${v.vin}`,
    }));
    return JSON.stringify({ count: mapped.length, vehicles: mapped });
  }

  if (toolName === 'capture_lead') {
    try {
      await supabase.from('chat_leads').insert({
        name: toolInput.name, email: toolInput.email, phone: toolInput.phone,
        vehicle_interest: toolInput.vehicle_interest, notes: toolInput.notes,
      });
      if (toolInput.email) {
        await resend.emails.send({
          from: FROM_EMAIL, to: NOTIFY_EMAIL,
          subject: `🤖 AI Chat Lead — ${escHtml(toolInput.name)}`,
          html: `<h2>New Chat Lead</h2>
            <p><b>Name:</b> ${escHtml(toolInput.name)}</p>
            <p><b>Email:</b> ${escHtml(toolInput.email)}</p>
            <p><b>Phone:</b> ${escHtml(toolInput.phone)}</p>
            <p><b>Interest:</b> ${escHtml(toolInput.vehicle_interest)}</p>
            <p><b>Notes:</b> ${escHtml(toolInput.notes)}</p>`,
        });
      }
    } catch {}
    return JSON.stringify({ success: true });
  }

  if (toolName === 'schedule_appointment') {
    const params = new URLSearchParams();
    if (toolInput.name) params.set('name', toolInput.name);
    if (toolInput.email) params.set('email', toolInput.email);
    const url = `${CALENDLY_URL}?${params.toString()}`;
    return JSON.stringify({ scheduling_url: url });
  }

  return JSON.stringify({ error: 'Unknown tool' });
}

app.post('/api/chat', aiLimiter, async (req, res) => {
  try {
    const { messages } = req.body;
    if (!messages?.length) { res.status(400).json({ error: 'Messages required' }); return; }

    const inventory = await readVautoCsv();
    const inventorySummary = inventory.map(v => (
      `${v.year} ${v.make} ${v.model} ${v.trim} — $${v.price.toLocaleString()}, ${v.mileage.toLocaleString()} mi, ${v.fuel}, ${v.exteriorcolor}, VIN: ${v.vin}`
    )).join('\n');

    const systemPrompt = `You are a friendly, knowledgeable sales assistant for Big Wave Auto, a pre-owned vehicle dealer in Sussex, WI.

Your job:
1. Understand what the customer is looking for
2. Ask at most 2 short follow-up questions — keep it conversational like texting a car salesperson
3. Search inventory and recommend matching vehicles using the search_inventory tool
4. When the customer shows interest, naturally ask for their name and phone/email so Dave (the owner) can follow up
5. Once you have contact info, use capture_lead to save it
6. Offer to schedule a visit or test drive using schedule_appointment

Current inventory:
${inventorySummary}

Rules:
- NEVER make up vehicles not in the inventory above
- If nothing matches, say so honestly and offer to notify them when something comes in
- Keep responses SHORT — 2-3 sentences max
- Be warm and casual, not salesy
- When showing vehicles, mention year, make, model, price, and one standout feature
- When you use schedule_appointment, tell the user to click the link to pick a time`;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    let apiMessages = messages.map((m: any) => ({ role: m.role, content: m.content }));
    let continueLoop = true;

    while (continueLoop) {
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        system: systemPrompt,
        tools: chatTools,
        messages: apiMessages,
      });

      for (const block of response.content) {
        if (block.type === 'text') {
          res.write(`event: text\ndata: ${JSON.stringify({ text: block.text })}\n\n`);
        }
        if (block.type === 'tool_use') {
          const result = await executeToolCall(block.name, block.input, inventory);
          // Send vehicle results or scheduling URL to the client
          if (block.name === 'search_inventory') {
            const parsed = JSON.parse(result);
            if (parsed.vehicles?.length) {
              res.write(`event: vehicles\ndata: ${JSON.stringify(parsed.vehicles)}\n\n`);
            }
          }
          if (block.name === 'schedule_appointment') {
            const parsed = JSON.parse(result);
            res.write(`event: schedule\ndata: ${JSON.stringify(parsed)}\n\n`);
          }
          // Append assistant message + tool result for continuation
          apiMessages.push({ role: 'assistant', content: response.content });
          apiMessages.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: block.id, content: result }] });
        }
      }

      // If the response ended with tool_use, loop to get the follow-up text
      continueLoop = response.stop_reason === 'tool_use';
    }

    res.write(`event: done\ndata: {}\n\n`);
    res.end();
  } catch (err) {
    console.error('Chat error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Chat failed' });
    } else {
      res.write(`event: error\ndata: {"error":"Something went wrong"}\n\n`);
      res.end();
    }
  }
});

/**
 * Admin routes — all protected by auth middleware + rate limiting
 */
app.use('/api/admin', adminLimiter, requireAdmin);

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

const ALLOWED_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'];
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIMES.includes(file.mimetype)) { cb(null, true); }
    else { cb(new Error('File type not allowed. Use JPEG, PNG, WebP, GIF, or PDF.')); }
  },
});

/**
 * AI Document Scanner — Bill of Sale
 * Extracts: VIN, purchase price, seller name/address, auction/source, date, odometer
 */
app.post('/api/admin/scan/bill-of-sale', aiLimiter, upload.single('file'), async (req: any, res) => {
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
app.post('/api/admin/scan/receipt', aiLimiter, upload.single('file'), async (req: any, res) => {
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
app.post('/api/admin/generate-description', aiLimiter, async (req, res) => {
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
 * Admin — upload window sticker / Monroney label
 */
app.post('/api/admin/vehicle/window-sticker', upload.single('file'), async (req: any, res) => {
  try {
    if (!req.file) { res.status(400).json({ error: 'No file' }); return; }
    const vin = req.body.vin;
    if (!vin) { res.status(400).json({ error: 'VIN required' }); return; }
    const ext = req.file.originalname.split('.').pop() || 'pdf';
    const fileName = `${vin}/window-sticker.${ext}`;

    // Remove old file if exists
    await supabase.storage.from('vehicle-documents').remove([fileName]);

    const { error: uploadError } = await supabase.storage
      .from('vehicle-documents')
      .upload(fileName, req.file.buffer, { contentType: req.file.mimetype, upsert: true });

    if (uploadError) {
      console.error('Upload error:', uploadError);
      res.status(500).json({ error: 'Upload failed' });
      return;
    }

    const { data: urlData } = supabase.storage
      .from('vehicle-documents')
      .getPublicUrl(fileName);

    // Upsert into vehicle_documents table
    await supabase.from('vehicle_documents').upsert(
      { vin, type: 'window_sticker', url: urlData.publicUrl, updated_at: new Date().toISOString() },
      { onConflict: 'vin,type' }
    );

    res.json({ url: urlData.publicUrl });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Window sticker upload failed' });
  }
});

/**
 * Admin — delete window sticker
 */
app.delete('/api/admin/vehicle/window-sticker/:vin', async (req, res) => {
  try {
    const { vin } = req.params;
    await supabase.from('vehicle_documents').delete().eq('vin', vin).eq('type', 'window_sticker');
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Delete failed' });
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

    const [pricing, costAdds, floorPlans, photos, windowSticker] = await Promise.all([
      supabase.from('vehicle_pricing').select('*').eq('vin', vin).maybeSingle(),
      supabase.from('vehicle_cost_adds').select('*').eq('vin', vin).order('date_added', { ascending: true }),
      supabase.from('vehicle_floor_plans').select('*').eq('vin', vin).order('date_floored', { ascending: true }),
      supabase.from('vehicle_photos').select('*').eq('vin', vin).order('sort_order', { ascending: true }),
      Promise.resolve(supabase.from('vehicle_documents').select('url').eq('vin', vin).eq('type', 'window_sticker').maybeSingle()).then(r => r.data).catch(() => null),
    ]);

    res.json({
      pricing: pricing.data || null,
      costAdds: costAdds.data || [],
      floorPlans: floorPlans.data || [],
      photos: photos.data || [],
      windowSticker: (windowSticker as any)?.url || null,
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
 * Photo categories — save/load per-vehicle photo categorization
 */
app.post('/api/admin/vehicle/photos/categories', async (req, res) => {
  try {
    const { vin, photos } = req.body;
    if (!vin || !photos) { res.status(400).json({ error: 'vin and photos required' }); return; }

    // Delete existing categories for this VIN, then insert new ones
    await supabase.from('vehicle_photo_categories').delete().eq('vin', vin);
    if (photos.length > 0) {
      const rows = photos.map((p: any, i: number) => ({
        vin,
        url: p.url,
        sort_order: p.sort_order ?? i,
        category: p.category || 'Exterior',
      }));
      const { error } = await supabase.from('vehicle_photo_categories').insert(rows);
      if (error) { console.error(error); res.status(500).json({ error: 'Failed to save' }); return; }
    }
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/admin/vehicle/photos/categories/:vin', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('vehicle_photo_categories')
      .select('*')
      .eq('vin', req.params['vin'])
      .order('sort_order');
    if (error) { console.error(error); res.status(500).json({ error: 'Failed to load' }); return; }
    res.json({ photos: data || [] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
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
      directoryConfigured: dirExists,
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

/**
 * Public — sales stats for about page
 */
app.get('/api/sales-stats', async (_req, res) => {
  try {
    const { data } = await supabase.from('sales_stats').select('*').order('updated_at', { ascending: false }).limit(1).maybeSingle();
    if (data) {
      res.json(data);
    } else {
      res.json(null);
    }
  } catch {
    res.json(null);
  }
});

/**
 * Admin — update sales stats from monthly report
 * Body: { salesByState: { WI: 81, IL: 12, ... }, topBrands: [...], totalSales: 174 }
 */
app.post('/api/admin/sales-stats', async (req, res) => {
  try {
    const { salesByState, topBrands, totalSales } = req.body;
    if (!salesByState) { res.status(400).json({ error: 'salesByState required' }); return; }
    await supabase.from('sales_stats').upsert(
      { id: 'current', sales_by_state: salesByState, top_brands: topBrands || [], total_sales: totalSales || 0, updated_at: new Date().toISOString() },
      { onConflict: 'id' }
    );
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to save sales stats' });
  }
});

const VALID_STATES = new Set([
  'AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN','IA',
  'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM',
  'NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA',
  'WV','WI','WY',
]);

const STATE_NAME_TO_CODE: Record<string, string> = {
  'alabama':'AL','alaska':'AK','arizona':'AZ','arkansas':'AR','california':'CA','colorado':'CO',
  'connecticut':'CT','delaware':'DE','district of columbia':'DC','florida':'FL','georgia':'GA',
  'hawaii':'HI','idaho':'ID','illinois':'IL','indiana':'IN','iowa':'IA','kansas':'KS',
  'kentucky':'KY','louisiana':'LA','maine':'ME','maryland':'MD','massachusetts':'MA',
  'michigan':'MI','minnesota':'MN','mississippi':'MS','missouri':'MO','montana':'MT',
  'nebraska':'NE','nevada':'NV','new hampshire':'NH','new jersey':'NJ','new mexico':'NM',
  'new york':'NY','north carolina':'NC','north dakota':'ND','ohio':'OH','oklahoma':'OK',
  'oregon':'OR','pennsylvania':'PA','rhode island':'RI','south carolina':'SC','south dakota':'SD',
  'tennessee':'TN','texas':'TX','utah':'UT','vermont':'VT','virginia':'VA','washington':'WA',
  'west virginia':'WV','wisconsin':'WI','wyoming':'WY',
};

/**
 * Admin — upload XLS/XLSX sales report and parse state data
 */
app.post('/api/admin/sales-stats/upload', upload.single('file'), async (req: any, res) => {
  try {
    if (!req.file) { res.status(400).json({ error: 'No file' }); return; }

    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const stateCount: Record<string, number> = {};
    const brandCount: Record<string, number> = {};

    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });

      // Find which columns contain state and count data
      // Look through all cells for state codes/names
      for (const row of rows) {
        if (!row || !row.length) continue;
        for (let c = 0; c < row.length; c++) {
          const cell = String(row[c] || '').trim();
          if (!cell) continue;

          // Check if cell is a state code
          const upper = cell.toUpperCase();
          if (VALID_STATES.has(upper) && upper.length === 2) {
            // Look for a count in adjacent cells
            for (let adj = 0; adj < row.length; adj++) {
              if (adj === c) continue;
              const val = Number(row[adj]);
              if (!isNaN(val) && val > 0 && Number.isInteger(val)) {
                stateCount[upper] = (stateCount[upper] || 0) + val;
                break;
              }
            }
            // If no adjacent number, just count as 1
            if (!stateCount[upper]) stateCount[upper] = (stateCount[upper] || 0) + 1;
            continue;
          }

          // Check if cell is a full state name
          const lower = cell.toLowerCase();
          const code = STATE_NAME_TO_CODE[lower];
          if (code) {
            for (let adj = 0; adj < row.length; adj++) {
              if (adj === c) continue;
              const val = Number(row[adj]);
              if (!isNaN(val) && val > 0 && Number.isInteger(val)) {
                stateCount[code] = (stateCount[code] || 0) + val;
                break;
              }
            }
            if (!stateCount[code]) stateCount[code] = (stateCount[code] || 0) + 1;
            continue;
          }

          // Check if cell could be a brand name (non-numeric, non-state, > 2 chars)
          if (cell.length > 2 && isNaN(Number(cell)) && !VALID_STATES.has(upper)) {
            for (let adj = 0; adj < row.length; adj++) {
              if (adj === c) continue;
              const val = Number(row[adj]);
              if (!isNaN(val) && val > 0 && Number.isInteger(val)) {
                brandCount[cell] = (brandCount[cell] || 0) + val;
                break;
              }
            }
          }
        }
      }
    }

    const totalSales = Object.values(stateCount).reduce((s, n) => s + n, 0);
    const topBrands = Object.entries(brandCount)
      .map(([name, count]) => ({ name, count, logo: '' }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);

    res.json({ salesByState: stateCount, totalSales, topBrands });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to parse spreadsheet' });
  }
});

// Single vehicle detail (Overfuel-compatible response)
app.get('/api/inventory/:vin', async (req, res) => {
  try {
    const vehicles = await readVautoCsv();
    const v = vehicles.find(v => v.vin.toLowerCase() === req.params['vin'].toLowerCase());
    if (!v) { res.status(404).json({ error: 'Vehicle not found' }); return; }

    // Load window sticker + saved photo categories
    const [wsResult, catsResult] = await Promise.all([
      Promise.resolve(supabase.from('vehicle_documents').select('url').eq('vin', v.vin).eq('type', 'window_sticker').maybeSingle()).then(r => r.data).catch(() => null),
      supabase.from('vehicle_photo_categories')
      .select('url, category, sort_order')
      .eq('vin', v.vin)
      .order('sort_order'),
    ]);
    const wsDoc = wsResult;
    const savedCats = catsResult?.data;
    const catMap = new Map((savedCats || []).map((c: any) => [c.url, c.category]));

    const photos = v.photos.map((url: string, i: number) => ({
      id: i + 1,
      large: url,
      thumbnail: url,
      sortorder: i,
      category: catMap.get(url) || undefined,
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
      monroneysticker: wsDoc?.url || null,
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
 * Public site settings — read-only, no auth required
 */
app.get('/api/settings/:category', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('site_settings')
      .select('settings')
      .eq('category', req.params['category'])
      .maybeSingle();
    if (error) { res.status(500).json({ error: 'Failed to load' }); return; }
    res.json(data?.settings || {});
  } catch (err) {
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
