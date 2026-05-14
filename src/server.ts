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
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import Anthropic from '@anthropic-ai/sdk';
import { parse as csvParse } from 'csv-parse/sync';
import * as XLSX from 'xlsx';
import { createRequire } from 'node:module';
const _require = createRequire(import.meta.url);
const zipcodes = _require('zipcodes');
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
const DEALERCENTER_EMAIL = '18548085@leadsprod.dealercenter.net';
const DEALERCENTER_API_TOKEN = process.env['DEALERCENTER_API_TOKEN'] || '3b6e8c4f-03fa-478b-9c0b-224e85431aad';
const DEALERCENTER_DEALER_ID = process.env['DEALERCENTER_DEALER_ID'] || 'NOWCOM';
const FROM_EMAIL = process.env['FROM_EMAIL'] || 'onboarding@resend.dev';

// ADF/XML lead format for DealerCenter CRM
function buildAdfXml(opts: {
  source: string;
  firstname?: string; lastname?: string; name?: string;
  email?: string; phone?: string;
  street?: string; city?: string; state?: string; zip?: string;
  comments?: string;
  vehicle?: { year?: string; make?: string; model?: string; vin?: string; stock?: string; price?: string };
}): string {
  const fn = opts.firstname || opts.name?.split(' ')[0] || '';
  const ln = opts.lastname || opts.name?.split(' ').slice(1).join(' ') || '';
  const v = opts.vehicle;
  return `<?xml version="1.0" encoding="UTF-8"?>
<?adf version="1.0"?>
<adf>
  <prospect>
    <requestdate>${new Date().toISOString()}</requestdate>
    <vehicle>
      ${v?.year ? `<year>${v.year}</year>` : ''}
      ${v?.make ? `<make>${v.make}</make>` : ''}
      ${v?.model ? `<model>${v.model}</model>` : ''}
      ${v?.vin ? `<vin>${v.vin}</vin>` : ''}
      ${v?.stock ? `<stock>${v.stock}</stock>` : ''}
      ${v?.price ? `<price>${v.price}</price>` : ''}
    </vehicle>
    <customer>
      <contact>
        <name part="first">${fn}</name>
        <name part="last">${ln}</name>
        ${opts.email ? `<email>${opts.email}</email>` : ''}
        ${opts.phone ? `<phone type="voice">${opts.phone}</phone>` : ''}
        ${(opts.street || opts.city) ? `<address>
          ${opts.street ? `<street line="1">${opts.street}</street>` : ''}
          ${opts.city ? `<city>${opts.city}</city>` : ''}
          ${opts.state ? `<regioncode>${opts.state}</regioncode>` : ''}
          ${opts.zip ? `<postalcode>${opts.zip}</postalcode>` : ''}
        </address>` : ''}
      </contact>
      ${opts.comments ? `<comments>${opts.comments}</comments>` : ''}
    </customer>
    <vendor>
      <vendorname>Big Wave Auto</vendorname>
    </vendor>
    <provider>
      <name part="full">Big Wave Auto Website</name>
      <service>${opts.source}</service>
    </provider>
  </prospect>
</adf>`;
}

async function sendAdfToDealerCenter(adfXml: string, subject: string) {
  try {
    await resend.emails.send({
      from: FROM_EMAIL,
      to: DEALERCENTER_EMAIL,
      subject,
      text: adfXml,
    });
  } catch (err) {
    console.error('DealerCenter ADF send error:', err);
  }
}

function buildCreditAppXml(raw: { [k: string]: any }, id: string): string {
  const x = (v: any) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const splitStreet = (s: string) => {
    const m = (s || '').match(/^(\S+)\s+(.+)$/);
    return m ? { no: m[1], name: m[2] } : { no: '', name: s || '' };
  };

  const addr = splitStreet(raw['street']);
  const prevAddr = splitStreet(raw['prevStreet']);

  const empBlock = (r: { [k: string]: any }, cur = true) => {
    const tag = cur ? 'current_employment_data' : 'previous_employment_data';
    return `<${tag}>
      <employment_status>${x(r['employmentStatus'])}</employment_status>
      <employed_by>${x(r['employerName'] || r['prevEmployerName'])}</employed_by>
      <years_employed>${x(r['employmentYears'] ?? r['prevEmploymentYears'] ?? 0)}</years_employed>
      <months_employed>${x(r['employmentMonths'] ?? r['prevEmploymentMonths'] ?? 0)}</months_employed>
      <job_title>${x(r['jobTitle'] || r['prevJobTitle'])}</job_title>
      <monthly_gross>${x(r['monthlyIncome'] ?? 0)}</monthly_gross>
    </${tag}>`;
  };

  const primaryBlock = `<primary_applicant_data>
    <first_name>${x(raw['firstname'])}</first_name>
    <last_name>${x(raw['lastname'])}</last_name>
    <ssn>${x(raw['ssn'])}</ssn>
    <dob>${x(raw['dob'])}</dob>
    <email_address>${x(raw['email'])}</email_address>
    <home_phone>${x(raw['phone'])}</home_phone>
    <current_address>
      <street_no>${x(addr.no)}</street_no>
      <street_name>${x(addr.name)}</street_name>
      <city>${x(raw['city'])}</city>
      <state>${x(raw['state'])}</state>
      <zip_code>${x(raw['zip'])}</zip_code>
    </current_address>
    <years_at_address>${x(raw['addressYears'] ?? 0)}</years_at_address>
    <months_at_address>${x(raw['addressMonths'] ?? 0)}</months_at_address>
    <residence_owned_by>${x(raw['housingStatus'])}</residence_owned_by>
    <current_residence_monthly_cost>${x(raw['rentMortgageAmount'] ?? 0)}</current_residence_monthly_cost>
    ${raw['prevStreet'] ? `<previous_address>
      <street_no>${x(prevAddr.no)}</street_no>
      <street_name>${x(prevAddr.name)}</street_name>
      <city>${x(raw['prevCity'])}</city>
      <state>${x(raw['prevState'])}</state>
      <zip_code>${x(raw['prevZip'])}</zip_code>
    </previous_address>` : ''}
    ${empBlock(raw)}
    ${raw['prevEmployerName'] ? empBlock({ employerName: raw['prevEmployerName'], jobTitle: raw['prevJobTitle'], employmentYears: raw['prevEmploymentYears'], employmentMonths: raw['prevEmploymentMonths'] }, false) : ''}
    ${raw['otherIncome'] ? `<other_income_amount>${x(raw['otherIncome'])}</other_income_amount>` : ''}
    ${raw['otherIncomeSource'] ? `<other_income_source>${x(raw['otherIncomeSource'])}</other_income_source>` : ''}
  </primary_applicant_data>`;

  let coBlock = '';
  const co: { [k: string]: any } | null = raw['coborrower_data'] || null;
  if (co) {
    const coAddr = splitStreet(co['street']);
    coBlock = `<first_coapplicant_data>
    <first_name>${x(co['firstname'])}</first_name>
    <last_name>${x(co['lastname'])}</last_name>
    <ssn>${x(co['ssn'])}</ssn>
    <dob>${x(co['dob'])}</dob>
    <email_address>${x(co['email'])}</email_address>
    <home_phone>${x(co['phone'])}</home_phone>
    <current_address>
      <street_no>${x(coAddr.no)}</street_no>
      <street_name>${x(coAddr.name)}</street_name>
      <city>${x(co['city'])}</city>
      <state>${x(co['state'])}</state>
      <zip_code>${x(co['zip'])}</zip_code>
    </current_address>
    <years_at_address>${x(co['addressYears'] ?? 0)}</years_at_address>
    <months_at_address>${x(co['addressMonths'] ?? 0)}</months_at_address>
    <residence_owned_by>${x(co['housingStatus'])}</residence_owned_by>
    <current_residence_monthly_cost>${x(co['rentMortgageAmount'] ?? 0)}</current_residence_monthly_cost>
    <current_employment_data>
      <employment_status>${x(co['employmentStatus'])}</employment_status>
      <employed_by>${x(co['employerName'])}</employed_by>
      <years_employed>${x(co['employmentYears'] ?? 0)}</years_employed>
      <months_employed>${x(co['employmentMonths'] ?? 0)}</months_employed>
      <job_title>${x(co['jobTitle'])}</job_title>
      <monthly_gross>${x(co['monthlyIncome'] ?? 0)}</monthly_gross>
    </current_employment_data>
  </first_coapplicant_data>`;
  }

  return `<ac_application>
  <dealer>
    <partner_dealer_id>BWA</partner_dealer_id>
    <dealership_name>Big Wave Auto</dealership_name>
    <dealercenter_dealer_id>${DEALERCENTER_DEALER_ID}</dealercenter_dealer_id>
  </dealer>
  <application_info>
    <id>${id}</id>
    <submit_datetime>${new Date().toISOString()}</submit_datetime>
    ${raw['buyer_id'] ? `<buyer_id>${x(raw['buyer_id'])}</buyer_id>` : ''}
  </application_info>
  <application_data>
    ${primaryBlock}
    ${coBlock}
  </application_data>
</ac_application>`;
}

async function postCreditAppToDealerCenter(xml: string, applicantName: string): Promise<void> {
  try {
    const res = await fetch('https://betaservices.dealercenter.net/LeadXmlService.svc/json/PostXml', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'access_token': DEALERCENTER_API_TOKEN,
      },
      body: JSON.stringify(xml),
    });
    const body = await res.text();
    if (!res.ok) {
      console.error(`DealerCenter credit app API error (${res.status}):`, body);
    } else {
      console.log(`DealerCenter credit app posted for ${applicantName}, prospect ID:`, body);
    }
  } catch (err) {
    console.error('DealerCenter credit app API exception:', err);
  }
}

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
  origin: (origin, callback) => {
    const allowed = [
      'https://bigwaveauto.com',
      'https://www.bigwaveauto.com',
      'http://104.236.238.131',
      'http://localhost:4000',
      'http://localhost:4200',
    ];
    // Allow Chrome extensions and requests with no origin (server-to-server)
    if (!origin || allowed.includes(origin) || origin.startsWith('chrome-extension://')) {
      callback(null, true);
    } else {
      callback(null, true); // permissive for now — API key protects ext endpoints
    }
  },
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
  console.log('[requireAdmin]', req.method, req.path, 'auth:', req.headers.authorization ? 'present' : 'MISSING');
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
 * New account notification — called after signup or first OAuth login
 */
app.post('/api/auth/notify-signup', leadLimiter, async (req, res) => {
  try {
    const { email, name, provider } = req.body;
    if (!email) { res.json({ ok: true }); return; }
    await resend.emails.send({
      from: FROM_EMAIL,
      to: NOTIFY_EMAIL,
      subject: `New Account Created — ${escHtml(name || email)}`,
      html: `
        <h2>New Account Created</h2>
        <p><b>Name:</b> ${escHtml(name || 'N/A')}</p>
        <p><b>Email:</b> ${escHtml(email)}</p>
        <p><b>Method:</b> ${escHtml(provider || 'email')}</p>
        <p><b>Time:</b> ${new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' })}</p>
      `
    });
    res.json({ ok: true });
  } catch {
    res.json({ ok: true }); // Don't fail silently — signup should still succeed
  }
});

/**
 * Lead form submissions
 */

app.post('/api/leads/financing', leadLimiter, async (req, res) => {
  try {
    const raw = pickFields(req.body, [
      'firstname', 'lastname', 'email', 'phone', 'dob', 'ssn',
      'street', 'city', 'state', 'zip', 'county',
      'addressYears', 'addressMonths', 'housingStatus', 'rentMortgageAmount',
      'prevStreet', 'prevCity', 'prevState', 'prevZip', 'prevCounty',
      'employerName', 'jobTitle', 'employmentStatus', 'monthlyIncome',
      'employmentYears', 'employmentMonths', 'otherIncome', 'otherIncomeSource',
      'prevEmployerName', 'prevJobTitle', 'prevEmploymentYears', 'prevEmploymentMonths',
      'coborrower', 'coborrower_data', 'buyer_id',
    ]);
    if (!raw.firstname || !raw.email || !validateEmail(raw.email)) {
      res.status(400).json({ error: 'Valid name and email required' }); return;
    }
    const lastFour = (raw.ssn || '').slice(-4);
    const addrTime = `${raw.addressYears || 0} yr ${raw.addressMonths || 0} mo`;
    const empTime = `${raw.employmentYears || 0} yr ${raw.employmentMonths || 0} mo`;
    const co = raw.coborrower_data || null;
    const data: Record<string, any> = {
      firstname: raw.firstname, lastname: raw.lastname, email: raw.email,
      phone: raw.phone, dob: raw.dob, ssn: raw.ssn, ssn_last4: lastFour,
      street: raw.street, city: raw.city, state: raw.state, zip: raw.zip,
      county: raw.county,
      years_at_address: addrTime, housing_status: raw.housingStatus,
      rent_mortgage: raw.rentMortgageAmount,
      employer_name: raw.employerName, employment_status: raw.employmentStatus,
      job_title: raw.jobTitle, monthly_income: raw.monthlyIncome,
      other_income: raw.otherIncome || null, other_income_source: raw.otherIncomeSource || null,
      years_employed: empTime, coborrower: raw.coborrower,
      coborrower_data: co ? JSON.stringify(co) : null,
    };
    const { error } = await supabase.from('financing_leads').insert(data);
    if (error) { console.error('Financing lead save error:', error.message, error.details, error.hint); res.status(500).json({ error: 'Failed to save' }); return; }

    // Build co-borrower HTML block for email
    let coHtml = '';
    if (co) {
      const coAddrTime = `${co.addressYears || 0} yr ${co.addressMonths || 0} mo`;
      const coEmpTime = `${co.employmentYears || 0} yr ${co.employmentMonths || 0} mo`;
      const coLastFour = (co.ssn || '').slice(-4);
      coHtml = `
        <hr/>
        <h3>Co-Borrower</h3>
        <p><b>Name:</b> ${escHtml(co.firstname)} ${escHtml(co.lastname)} (${escHtml(co.relation || '')})</p>
        <p><b>DOB:</b> ${escHtml(co.dob)}</p>
        <p><b>SSN:</b> ***-**-${escHtml(coLastFour) || 'N/A'}</p>
        ${co.email ? `<p><b>Email:</b> ${escHtml(co.email)}</p>` : ''}
        ${co.phone ? `<p><b>Phone:</b> ${escHtml(co.phone)}</p>` : ''}
        <p><b>Address:</b> ${escHtml(co.street)}, ${escHtml(co.city)}, ${escHtml(co.state)} ${escHtml(co.zip)}</p>
        <p><b>Time at Address:</b> ${escHtml(coAddrTime)}</p>
        <p><b>Housing:</b> ${escHtml(co.housingStatus)} — ${escHtml(co.rentMortgageAmount || 'N/A')}/mo</p>
        <p><b>Employment:</b> ${escHtml(co.employmentStatus)} — ${escHtml(co.jobTitle || '')} at ${escHtml(co.employerName)}</p>
        <p><b>Time at Employer:</b> ${escHtml(coEmpTime)}</p>
        <p><b>Monthly Income:</b> ${escHtml(co.monthlyIncome)}</p>
      `;
    }

    // Previous address/employer for primary
    const prevAddrHtml = raw.prevStreet
      ? `<p><b>Previous Address:</b> ${escHtml(raw.prevStreet)}, ${escHtml(raw.prevCity)}, ${escHtml(raw.prevState)} ${escHtml(raw.prevZip)}</p>` : '';
    const prevEmpHtml = raw.prevEmployerName
      ? `<p><b>Previous Employer:</b> ${escHtml(raw.prevEmployerName)} (${escHtml(raw.prevEmploymentYears || '0')} yr ${escHtml(raw.prevEmploymentMonths || '0')} mo)</p>` : '';
    const otherIncomeHtml = raw.otherIncome
      ? `<p><b>Other Income:</b> $${escHtml(raw.otherIncome)} — ${escHtml(raw.otherIncomeSource || 'N/A')}</p>` : '';

    await resend.emails.send({
      from: FROM_EMAIL,
      to: NOTIFY_EMAIL,
      subject: `New Financing Application — ${escHtml(raw.firstname)} ${escHtml(raw.lastname)}`,
      html: `
        <h2>New Financing Application</h2>
        <p><b>Name:</b> ${escHtml(raw.firstname)} ${escHtml(raw.lastname)}</p>
        <p><b>Email:</b> ${escHtml(raw.email)}</p>
        <p><b>Phone:</b> ${escHtml(raw.phone)}</p>
        <p><b>DOB:</b> ${escHtml(raw.dob)}</p>
        <p><b>SSN:</b> ***-**-${escHtml(lastFour) || 'N/A'}</p>
        <p><b>Address:</b> ${escHtml(raw.street)}, ${escHtml(raw.city)}, ${escHtml(raw.state)} ${escHtml(raw.zip)} (${escHtml(raw.county || '')} County)</p>
        <p><b>Time at Address:</b> ${escHtml(addrTime)}</p>
        ${prevAddrHtml}
        <p><b>Housing:</b> ${escHtml(raw.housingStatus)} — ${escHtml(raw.rentMortgageAmount || 'N/A')}/mo</p>
        <p><b>Employment:</b> ${escHtml(raw.employmentStatus)} — ${escHtml(raw.jobTitle || '')} at ${escHtml(raw.employerName)}</p>
        <p><b>Time at Employer:</b> ${escHtml(empTime)}</p>
        ${prevEmpHtml}
        <p><b>Monthly Income:</b> ${escHtml(raw.monthlyIncome)}</p>
        ${otherIncomeHtml}
        <p><b>Co-borrower:</b> ${raw.coborrower ? 'Yes' : 'No'}</p>
        ${coHtml}
      `
    });

    // POST credit app to DealerCenter API
    const creditXml = buildCreditAppXml(raw, randomUUID());
    await postCreditAppToDealerCenter(creditXml, `${raw.firstname} ${raw.lastname}`);
    res.json({ success: true });
  } catch (err) {
    console.error('Financing lead error:', err);
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
    await sendAdfToDealerCenter(buildAdfXml({
      source: 'Trade-In',
      firstname: data.firstname, lastname: data.lastname,
      email: data.email, phone: data.phone,
      vehicle: { year: data.year, make: data.make, model: data.model, vin: data.vin },
      comments: `Trade-In | Mileage: ${data.mileage} | Condition: ${data.condition} | Notes: ${data.notes || 'None'}`,
    }), `Trade-In — ${data.year} ${data.make} ${data.model}`);
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
    await sendAdfToDealerCenter(buildAdfXml({
      source: 'Test Drive',
      firstname: data.firstname, lastname: data.lastname,
      email: data.email, phone: data.phone,
      vehicle: { year: data.year, make: data.make, model: data.model, vin: data.vin, stock: data.stock },
      comments: `Test Drive Request | Preferred: ${data.preferred_date || 'N/A'} ${data.preferred_time || ''} | Notes: ${data.notes || 'None'}`,
    }), `Test Drive — ${data.year} ${data.make} ${data.model}`);
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
    await sendAdfToDealerCenter(buildAdfXml({
      source: 'Reservation',
      firstname: info?.firstName, lastname: info?.lastName,
      email: info?.email, phone: info?.phone,
      street: info?.street, city: info?.city, state: info?.state, zip: info?.zip,
      vehicle: { year: vehicle?.year, make: vehicle?.make, model: vehicle?.model, vin: vehicle?.vin, price: vehicle?.price },
      comments: `Vehicle Reservation | Delivery: ${delivery?.method || 'N/A'} | Coverage: ${coverage?.plan || 'None'}`,
    }), `Reservation — ${vehicle?.year} ${vehicle?.make} ${vehicle?.model}`);
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
    await sendAdfToDealerCenter(buildAdfXml({
      source: 'Make an Offer',
      firstname: data.firstname, lastname: data.lastname,
      email: data.email, phone: data.phone,
      vehicle: { year: data.year, make: data.make, model: data.model, vin: data.vin, stock: data.stock, price: String(data.listed_price || '') },
      comments: `Offer: $${data.offer_amount} | Listed: $${data.listed_price || 'N/A'} | Financing: ${data.financing} | Notes: ${data.notes || 'None'}`,
    }), `Offer — $${data.offer_amount} on ${data.year} ${data.make} ${data.model}`);
    res.json({ success: true });
  } catch (err) {
    console.error('Offer lead error');
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/leads/contact', leadLimiter, async (req, res) => {
  try {
    const data = pickFields(req.body, ['name', 'email', 'phone', 'topic', 'preferred_method', 'message']);
    // Accept camelCase from frontend
    if (!data.preferred_method && req.body.preferredMethod) data.preferred_method = req.body.preferredMethod;
    if (!data.email || !validateEmail(data.email)) {
      res.status(400).json({ error: 'Valid email required' }); return;
    }
    const { error } = await supabase.from('contact_leads').insert({
      name: data.name,
      email: data.email,
      phone: data.phone || null,
      message: [data.topic ? `Topic: ${data.topic}` : '', data.preferred_method ? `Preferred: ${data.preferred_method}` : '', data.message].filter(Boolean).join('\n'),
    });
    if (error) { console.error('Lead save error', error.message); res.status(500).json({ error: 'Failed to save' }); return; }

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
    await sendAdfToDealerCenter(buildAdfXml({
      source: 'Contact Form',
      name: data.name, email: data.email, phone: data.phone,
      comments: `Contact | Topic: ${data.topic || 'General'} | Preferred: ${data.preferred_method || 'N/A'} | Message: ${data.message}`,
    }), `Contact — ${data.name}`);
    res.json({ success: true });
  } catch (err) {
    console.error('Contact lead error');
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * AI Chat — conversational vehicle search with tool use
 */
const CALENDLY_URL = process.env['CALENDLY_URL'] || 'https://calendly.com/dave-rkfy/30min';

// Chat-specific rate limiters
const chatPerMinute = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 5, // 5 messages per minute per IP
  message: { error: 'Slow down! Try again in a minute.' },
  standardHeaders: true, legacyHeaders: false,
});
const chatPerHour = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30, // 30 messages per hour per IP
  message: { error: 'You\'ve reached the hourly limit. Please try again later or call us at (262) 281-1295.' },
  standardHeaders: true, legacyHeaders: false,
});

// Daily token budget tracking
let dailyTokensUsed = 0;
let dailyTokensDate = new Date().toDateString();
const DAILY_TOKEN_BUDGET = 500_000; // ~$1.50/day at Sonnet pricing

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

app.post('/api/chat', chatPerMinute, chatPerHour, async (req, res) => {
  try {
    const { messages } = req.body;
    if (!messages?.length) { res.status(400).json({ error: 'Messages required' }); return; }

    // Max conversation length
    if (messages.length > 40) {
      res.status(400).json({ error: 'Conversation too long. Please start a new chat or call us at (262) 281-1295.' }); return;
    }

    // Max input length on latest message
    const lastMsg = messages[messages.length - 1];
    if (lastMsg?.content?.length > 500) {
      res.status(400).json({ error: 'Message too long. Please keep it under 500 characters.' }); return;
    }

    // Daily token budget check
    const today = new Date().toDateString();
    if (today !== dailyTokensDate) { dailyTokensUsed = 0; dailyTokensDate = today; }
    if (dailyTokensUsed > DAILY_TOKEN_BUDGET) {
      res.status(429).json({ error: 'Our AI assistant is resting for the day. Please call us at (262) 281-1295 or try again tomorrow.' }); return;
    }

    const inventory = await readVautoCsv();
    const inventorySummary = inventory.map(v => (
      `${v.year} ${v.make} ${v.model} ${v.trim} — $${v.price.toLocaleString()}, ${v.mileage.toLocaleString()} mi, ${v.fuel}, ${v.exteriorcolor}, VIN: ${v.vin}`
    )).join('\n');

    const systemPrompt = `You are a concierge vehicle search consultant for Big Wave Auto, a licensed pre-owned dealer in Sussex, WI. Big Wave Auto specializes in finding specific vehicles nationwide for customers.

Your job:
1. Understand exactly what the customer wants — year, make, model, trim, color, features, budget
2. Ask at most 2 short follow-up questions to nail down their criteria — keep it conversational, like texting a knowledgeable car friend
3. FIRST check if we have anything matching in our current lot using search_inventory
4. If we have a match, show it. If not, reassure them that Big Wave Auto searches dealer-only auctions, wholesale networks, and nationwide inventory to find exactly what they want
5. Naturally collect their name and phone/email so the team can start the search — use capture_lead when you have it
6. Offer to schedule a consultation call using schedule_appointment

Current lot inventory (what we have in stock right now):
${inventorySummary}

Rules:
- Always refer to the dealership as "Big Wave Auto" or "we/our" — NEVER use individual names like "Dave"
- Only show vehicles from inventory if they CLOSELY match what the customer asked for (same make/model, within budget). Do NOT show a different model as a "close match" — a R1T is not a R1S, a Model Y is not a Model X
- If nothing on the lot is a strong match, do NOT show any vehicles. Instead, explain that our concierge service will search the entire country for their exact spec
- Emphasize: we handle everything — inspection, transport, paperwork, registration, delivery
- Mention there is no obligation to inquire
- Keep responses SHORT — 2-3 sentences max
- Be warm, knowledgeable, and confident — not salesy
- When collecting contact info, frame it as "so our team can start searching for you"
- When you use schedule_appointment, tell them to click the link to book a call with Big Wave Auto`;

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
      // Track token usage
      if (response.usage) {
        dailyTokensUsed += (response.usage.input_tokens || 0) + (response.usage.output_tokens || 0);
      }
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
 * Public VIN decode — year/make/model/trim via MarketCheck NeoVIN
 */
app.get('/api/vin/:vin', async (req, res) => {
  try {
    const vin = req.params['vin']?.toUpperCase();
    if (!vin || vin.length !== 17) { res.status(400).json({ error: 'Invalid VIN' }); return; }

    const mcKey = process.env['MARKETCHECK_API_KEY'];
    if (!mcKey) { res.status(503).json({ error: 'VIN decode unavailable' }); return; }

    const r = await fetch(`https://api.marketcheck.com/v2/decode/car/neovin/${vin}/specs?api_key=${mcKey}&include_generic=true`, { headers: { Accept: 'application/json' } });
    if (!r.ok) { res.status(422).json({ error: 'VIN not found' }); return; }

    const data = await r.json();
    const specs = data?.specs || data;
    const year  = String(specs?.year || specs?.model_year || '');
    const make  = specs?.make || '';
    const model = specs?.model || '';
    const trim  = specs?.trim || specs?.version || '';

    if (!make || !model) { res.status(422).json({ error: 'VIN not found' }); return; }
    res.json({ year, make, model, trim });
  } catch (err) {
    res.status(500).json({ error: 'VIN lookup failed' });
  }
});

/**
 * Admin routes — all protected by auth middleware + rate limiting
 */
app.use('/api/admin', adminLimiter, requireAdmin);

/**
 * Admin — list all registered users
 */
app.get('/api/admin/members', async (_req, res) => {
  try {
    const { data, error } = await supabase.auth.admin.listUsers({ perPage: 1000 });
    if (error) { res.status(500).json({ error: error.message }); return; }

    // Get all leads to count per user
    const [financing, offers, testDrives, tradeIns, contacts, reservations] = await Promise.all([
      supabase.from('financing_leads').select('email').then(r => r.data || []),
      supabase.from('offer_leads').select('email').then(r => r.data || []),
      supabase.from('test_drive_leads').select('email').then(r => r.data || []),
      supabase.from('trade_in_leads').select('email').then(r => r.data || []),
      supabase.from('contact_leads').select('email').then(r => r.data || []),
      supabase.from('chat_leads').select('email').then(r => r.data || []),
    ]);
    const allLeads = [...financing, ...offers, ...testDrives, ...tradeIns, ...contacts, ...reservations];
    const leadCounts: Record<string, number> = {};
    for (const l of allLeads) {
      if (l.email) leadCounts[l.email.toLowerCase()] = (leadCounts[l.email.toLowerCase()] || 0) + 1;
    }

    const members = data.users.map(u => ({
      id: u.id,
      email: u.email || '',
      fullName: u.user_metadata?.['full_name'] || u.user_metadata?.['name'] || '',
      firstName: u.user_metadata?.['first_name'] || '',
      lastName: u.user_metadata?.['last_name'] || '',
      avatarUrl: u.user_metadata?.['avatar_url'] || '',
      provider: u.app_metadata?.provider || 'email',
      createdAt: u.created_at,
      lastSignIn: u.last_sign_in_at,
      leadCount: leadCounts[(u.email || '').toLowerCase()] || 0,
    }));

    members.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    res.json({ total: members.length, members });
  } catch (err: any) {
    console.error('Members list error:', err);
    res.status(500).json({ error: 'Failed to fetch members' });
  }
});

/**
 * Admin — get member detail with all their leads
 */
app.get('/api/admin/members/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { data: userData, error } = await supabase.auth.admin.getUserById(id);
    if (error || !userData?.user) { res.status(404).json({ error: 'User not found' }); return; }
    const u = userData.user;
    const email = (u.email || '').toLowerCase();

    // Fetch all leads for this user by email
    const fetchLeads = async (table: string, type: string) => {
      const { data } = await supabase.from(table).select('*').ilike('email', email).order('created_at', { ascending: false });
      return (data || []).map((l: any) => ({ ...l, _type: type }));
    };

    const [financing, offers, testDrives, tradeIns, contacts] = await Promise.all([
      fetchLeads('financing_leads', 'financing'),
      fetchLeads('offer_leads', 'offer'),
      fetchLeads('test_drive_leads', 'test-drive'),
      fetchLeads('trade_in_leads', 'trade-in'),
      fetchLeads('contact_leads', 'contact'),
    ]);

    const allLeads = [...financing, ...offers, ...testDrives, ...tradeIns, ...contacts];
    allLeads.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    res.json({
      id: u.id,
      email: u.email,
      fullName: u.user_metadata?.['full_name'] || '',
      firstName: u.user_metadata?.['first_name'] || '',
      lastName: u.user_metadata?.['last_name'] || '',
      avatarUrl: u.user_metadata?.['avatar_url'] || '',
      provider: u.app_metadata?.provider || 'email',
      createdAt: u.created_at,
      lastSignIn: u.last_sign_in_at,
      leads: allLeads,
    });
  } catch (err: any) {
    console.error('Member detail error:', err);
    res.status(500).json({ error: 'Failed to fetch member' });
  }
});

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

const REPORT_MIMES = ['text/csv', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/pdf', 'text/plain'];
const reportUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (REPORT_MIMES.includes(file.mimetype) || file.originalname.match(/\.(csv|xls|xlsx|pdf)$/i)) { cb(null, true); }
    else { cb(new Error('File type not allowed. Use CSV, XLS, XLSX, or PDF.')); }
  },
});

/**
 * Sales Tax Filing Tool — parse DMS Sales Tax Report Excel
 */
app.post('/api/admin/tax/process', reportUpload.single('file'), async (req: any, res) => {
  try {
    if (!req.file) { res.status(400).json({ error: 'No file uploaded' }); return; }
    const month = parseInt(req.body.month);
    const year = parseInt(req.body.year);
    if (!month || !year) { res.status(400).json({ error: 'Month and year are required' }); return; }

    const workbook = XLSX.read(req.file.buffer, { type: 'buffer', cellDates: true });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];

    // Read all rows as arrays to find the header row (contains "Deal No." or "Delivery Date")
    const allRows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    let headerRowIdx = -1;
    for (let i = 0; i < Math.min(20, allRows.length); i++) {
      const rowStr = allRows[i].map((c: any) => String(c).toLowerCase()).join('|');
      if (rowStr.includes('delivery date') || rowStr.includes('deal no')) {
        headerRowIdx = i;
        break;
      }
    }

    if (headerRowIdx === -1) {
      res.status(400).json({ error: 'Could not find header row with "Delivery Date" in the spreadsheet.' });
      return;
    }

    // Re-parse using the found header row
    const rows: any[] = XLSX.utils.sheet_to_json(sheet, { defval: '', range: headerRowIdx });

    // Map columns
    const colMap: Record<string, string> = {};
    if (rows.length > 0) {
      const keys = Object.keys(rows[0]);
      for (const k of keys) {
        const kl = k.toLowerCase().trim();
        if (kl.includes('delivery date')) colMap['deliveryDate'] = k;
        else if (kl.includes('purchase price')) colMap['purchasePrice'] = k;
        else if (kl.includes('taxable amount')) colMap['taxableAmount'] = k;
        else if (kl.includes('state') && kl.includes('tax') && kl.includes('amount')) colMap['stateTaxAmount'] = k;
        else if (kl.includes('county') && kl.includes('tax') && kl.includes('amount')) colMap['countyTaxAmount'] = k;
        else if (kl.includes('city') && kl.includes('tax') && kl.includes('amount')) colMap['cityTaxAmount'] = k;
        else if (kl === 'county') colMap['county'] = k;
        else if (kl.includes('signer city')) colMap['signerCity'] = k;
        else if (kl.includes('signer state')) colMap['signerState'] = k;
        else if (kl.includes('trade') && kl.includes('allowance')) colMap['tradeAllowance'] = k;
      }
    }

    if (!colMap['deliveryDate']) {
      res.status(400).json({ error: 'Could not find "Delivery Date" column in the spreadsheet.' });
      return;
    }

    const num = (v: any): number => {
      if (typeof v === 'number') return v;
      if (!v) return 0;
      return parseFloat(String(v).replace(/[^0-9.\-]/g, '')) || 0;
    };

    // Parse date — handles Date objects, Excel serial numbers, and date strings
    const parseDate = (raw: any): Date | null => {
      if (!raw) return null;
      if (raw instanceof Date) return raw;
      // Excel serial number (e.g., 46133)
      if (typeof raw === 'number' && raw > 10000 && raw < 100000) {
        const d = new Date((raw - 25569) * 86400 * 1000);
        return isNaN(d.getTime()) ? null : d;
      }
      const d = new Date(String(raw));
      return isNaN(d.getTime()) ? null : d;
    };

    // Filter to selected month/year
    const filtered = rows.filter(r => {
      const d = parseDate(r[colMap['deliveryDate']]);
      if (!d) return false;
      return (d.getMonth() + 1) === month && d.getFullYear() === year;
    });

    interface TxDetail {
      dealNo: string; vehicle: string; stockNo: string;
      buyer: string; date: string; amount: number;
    }

    let totalSales = 0;
    let exemptCertificates = 0;
    let otherExempt = 0;
    let returnsAllowances = 0;
    let salesSubjectToTax = 0;
    let stateSalesTax = 0;
    const countyMap: Record<string, number> = {};
    const countyTxMap: Record<string, TxDetail[]> = {};
    let milwaukeeCitySales = 0;
    const milwaukeeTx: TxDetail[] = [];

    // Transaction lists per line
    const txTotalSales: TxDetail[] = [];
    const txExempt: TxDetail[] = [];
    const txOutOfState: TxDetail[] = [];
    const txTradeIns: TxDetail[] = [];
    const txTaxable: TxDetail[] = [];
    const txStateTax: TxDetail[] = [];

    for (const r of filtered) {
      const purchasePrice = num(r[colMap['purchasePrice']]);
      const taxableAmount = num(r[colMap['taxableAmount']]);
      const stateTax = num(r[colMap['stateTaxAmount']]);
      const countyTax = num(r[colMap['countyTaxAmount']]);
      const cityTax = num(r[colMap['cityTaxAmount']]);
      const county = String(r[colMap['county']] || '').trim().toUpperCase();
      const signerCity = String(r[colMap['signerCity']] || '').trim().toUpperCase();
      const signerState = String(r[colMap['signerState']] || '').trim().toUpperCase();
      const tradeAllowance = num(r[colMap['tradeAllowance']]);

      const dealNo = String(r[Object.keys(r).find(k => k.toLowerCase().includes('deal no')) || ''] || '');
      const vehicle = String(r[Object.keys(r).find(k => k.toLowerCase().includes('vehicle year')) || ''] || '');
      const stockNo = String(r[colMap['stockNo'] || Object.keys(r).find(k => k.toLowerCase().includes('stock')) || ''] || '');
      const firstName = String(r[Object.keys(r).find(k => k.toLowerCase().includes('signer first')) || ''] || '');
      const lastName = String(r[Object.keys(r).find(k => k.toLowerCase().includes('signer last')) || ''] || '');
      const buyer = [firstName, lastName].filter(Boolean).join(' ') || String(r[Object.keys(r).find(k => k.toLowerCase().includes('business name')) || ''] || '') || 'N/A';
      const dd = parseDate(r[colMap['deliveryDate']]);
      const dateStr = dd ? dd.toLocaleDateString('en-US') : '';

      const makeTx = (amt: number): TxDetail => ({ dealNo, vehicle, stockNo, buyer, date: dateStr, amount: amt });

      const isWholesale = !county && !signerCity && !signerState && stateTax === 0 && countyTax === 0 && cityTax === 0;
      const isOutOfState = signerState !== '' && signerState !== 'WI';

      totalSales += purchasePrice;
      txTotalSales.push(makeTx(purchasePrice));

      if (isWholesale) {
        exemptCertificates += purchasePrice;
        txExempt.push(makeTx(purchasePrice));
      } else if (isOutOfState) {
        otherExempt += purchasePrice;
        txOutOfState.push(makeTx(purchasePrice));
      }

      // Out-of-state: tax was collected and remitted to another state, not WI
      if (!isOutOfState) {
        if (tradeAllowance > 0) {
          returnsAllowances += tradeAllowance;
          txTradeIns.push(makeTx(tradeAllowance));
        }

        if (taxableAmount > 0) {
          salesSubjectToTax += taxableAmount;
          txTaxable.push(makeTx(taxableAmount));
        }

        if (stateTax > 0) {
          stateSalesTax += stateTax;
          txStateTax.push(makeTx(stateTax));
        }
      }

      if (county && countyTax > 0) {
        countyMap[county] = (countyMap[county] || 0) + taxableAmount;
        if (!countyTxMap[county]) countyTxMap[county] = [];
        countyTxMap[county].push(makeTx(taxableAmount));
      }

      if (signerCity === 'MILWAUKEE' && cityTax > 0) {
        milwaukeeCitySales += taxableAmount;
        milwaukeeTx.push(makeTx(taxableAmount));
      }
    }

    const totalSubtractions = exemptCertificates + otherExempt + returnsAllowances;

    const counties = Object.entries(countyMap)
      .map(([name, salesSubjectToTax]) => ({ name, salesSubjectToTax, transactions: countyTxMap[name] || [] }))
      .sort((a, b) => a.name.localeCompare(b.name));

    res.json({
      month,
      year,
      transactionCount: filtered.length,
      state: {
        totalSales,
        exemptCertificates,
        otherExempt,
        returnsAllowances,
        other: 0,
        totalSubtractions,
        salesSubjectToTax,
        stateSalesTax,
      },
      transactions: {
        totalSales: txTotalSales,
        exemptCertificates: txExempt,
        otherExempt: txOutOfState,
        returnsAllowances: txTradeIns,
        salesSubjectToTax: txTaxable,
        stateSalesTax: txStateTax,
        milwaukee: milwaukeeTx,
      },
      counties,
      milwaukee: { salesSubjectToCitySalesTax: milwaukeeCitySales },
    });
  } catch (err: any) {
    console.error('Tax process error:', err);
    res.status(500).json({ error: err.message || 'Failed to process file' });
  }
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
 * Market Data — MMR + KBB lookups
 */
// Vehicle history via Bumper API (NMVTIS + historical sales)
app.get('/api/admin/vehicle/history/:vin', async (req, res) => {
  const { vin } = req.params;
  const bumperKey = process.env['BUMPER_API_KEY'];
  if (!bumperKey) { res.json(null); return; }
  try {
    const r = await fetch(`https://api.bumper.com/v1/vin/${vin}`, {
      headers: { 'Authorization': `Bearer ${bumperKey}`, 'Accept': 'application/json' },
    });
    if (!r.ok) { res.json(null); return; }
    const data = await r.json();
    // Normalize to our shape — update field names once Bumper docs confirmed
    res.json({
      owners: data?.ownership?.ownerCount || data?.owners || null,
      accidents: data?.accidents?.count || data?.accidentCount || null,
      title_issues: data?.titleProblems?.count || null,
      last_sale_price: data?.lastSalePrice || data?.saleHistory?.[0]?.price || null,
      last_sale_date: data?.lastSaleDate || data?.saleHistory?.[0]?.date || null,
      raw: data,
    });
  } catch (e) {
    console.error('Bumper history error:', e);
    res.json(null);
  }
});

// Save appraisal
app.get('/api/admin/appraisals', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('appraisals')
      .select('id, vin, vehicle, disposition, appraised_value, recon, transportation, auction_fee, other_cost, asking_price, mmr, market_avg, target_auction, target_retail, status, created_at')
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    console.error('Get appraisals error:', err);
    res.status(500).json({ error: 'Failed to fetch appraisals' });
  }
});

app.delete('/api/admin/appraisals/:id', async (req, res) => {
  try {
    const { error } = await supabase.from('appraisals').delete().eq('id', req.params['id']);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    console.error('Delete appraisal error:', err);
    res.status(500).json({ error: 'Failed to delete appraisal' });
  }
});

app.post('/api/admin/appraisals', async (req, res) => {
  try {
    const body = req.body;
    const { data, error } = await supabase.from('appraisals').insert({
      vin: body.vin,
      vehicle: body.vehicle,
      disposition: body.disposition || 'retail',
      appraised_value: body.appraised_value || 0,
      recon: body.recon || 0,
      transportation: body.transportation || 0,
      auction_fee: body.auction_fee || 0,
      other_cost: body.other_cost || 0,
      asking_price: body.asking_price || 0,
      mmr: body.mmr || null,
      market_avg: body.market_avg || null,
      target_auction: body.target_auction || null,
      target_retail: body.target_retail || null,
      status: 'open',
    }).select().single();
    if (error) {
      console.error('Save appraisal error:', error);
      res.status(500).json({ error: error.message || 'Failed to save appraisal' });
      return;
    }
    res.json(data);
  } catch (err: any) {
    console.error('Save appraisal error:', err);
    res.status(500).json({ error: err?.message || 'Failed to save appraisal' });
  }
});

// In-memory NeoVIN cache (24hr TTL)
const neovinCache = new Map<string, { data: any; ts: number }>();

app.get('/api/admin/vehicle/neovin/:vin', async (req, res) => {
  try {
    const vin = req.params['vin']?.toUpperCase();
    if (!vin || vin.length !== 17) { res.status(400).json({ error: 'Invalid VIN' }); return; }

    const cached = neovinCache.get(vin);
    if (cached && Date.now() - cached.ts < 86400000) {
      res.json(cached.data); return;
    }

    const mcKey = process.env['MARKETCHECK_API_KEY'];
    if (!mcKey) { res.status(503).json({ error: 'MarketCheck not configured' }); return; }

    const [specsRes, pkgRes] = await Promise.allSettled([
      fetch(`https://api.marketcheck.com/v2/decode/car/neovin/${vin}/specs?api_key=${mcKey}&include_generic=true`, { headers: { Accept: 'application/json' } }),
      fetch(`https://api.marketcheck.com/v2/decode/car/neovin/${vin}/options-packages?api_key=${mcKey}`, { headers: { Accept: 'application/json' } }),
    ]);

    if (specsRes.status === 'rejected' || !specsRes.value.ok) {
      res.status(422).json({ error: 'NeoVIN decode failed' }); return;
    }

    const raw = await specsRes.value.json();
    let available_packages: any[] = [];
    if (pkgRes.status === 'fulfilled' && pkgRes.value.ok) {
      try {
        const pkgData = await pkgRes.value.json();
        available_packages = pkgData?.available_options_packages || [];
      } catch {}
    }

    // Shape the response to only what the appraisal tool needs
    const data = {
      vin: raw.vin,
      year: raw.year,
      make: raw.make,
      model: raw.model,
      trim: raw.trim,
      trim_confidence: raw.trim_confidence,
      engine: raw.engine,
      transmission: raw.transmission,
      drivetrain: raw.drivetrain,
      fuel_type: raw.fuel_type,
      body_type: raw.body_type,
      doors: raw.doors,
      seating_capacity: raw.seating_capacity,
      city_mpg: raw.city_mpg,
      highway_mpg: raw.highway_mpg,
      msrp: raw.msrp,
      combined_msrp: raw.combined_msrp,
      installed_options_msrp: raw.installed_options_msrp,
      original_msrp: raw.original_msrp,
      exterior_color: raw.exterior_color,
      interior_color: raw.interior_color,
      installed_options: (raw.installed_options_details || []).map((o: any) => ({
        code: o.code, name: o.name, msrp: o.msrp, verified: o.verified,
      })),
      available_packages,
      high_value_features: raw.high_value_features || {},
      options_packages: raw.options_packages,
      powertrain_type: raw.powertrain_type,
    };

    neovinCache.set(vin, { data, ts: Date.now() });
    res.json(data);
  } catch (err) {
    console.error('NeoVIN error:', err);
    res.status(500).json({ error: 'NeoVIN decode error' });
  }
});

app.post('/api/admin/vehicle/market-data', async (req, res) => {
  try {
    const { vin, year, make, model, trim, mileage } = req.body;
    if (!vin) { res.status(400).json({ error: 'VIN required' }); return; }

    // Check cached market data first (refresh if older than 7 days)
    const { data: cached } = await supabase
      .from('vehicle_market_data')
      .select('*')
      .eq('vin', vin)
      .single();

    if (cached && cached.fetched_at) {
      const age = Date.now() - new Date(cached.fetched_at).getTime();
      // Use cache only if fresh AND has actual comps (old cache may have empty comps from broken URL)
      // Also skip cache if comps lack the 'photo' field (old schema pre-expansion)
      const hasPhotos = cached.active_comps?.[0]?.photo !== undefined;
      if (age < 7 * 86400000 && (cached.active_comps?.length > 0 || cached.market_avg > 0) && hasPhotos) {
        res.json({
          mmr: cached.mmr, kbb: cached.kbb, market_avg: cached.market_avg,
          market_days_supply: cached.market_days_supply, market_miles_mean: 0,
          stats: cached.stats, vin_history: cached.vin_history,
          active_comps: cached.active_comps, sold_comps: cached.sold_comps,
          available_colors: [],
        });
        return;
      }
    }

    // Fetch from external APIs
    let mmr = 0;
    let kbb = 0;

    // MMR via Manheim API (if configured)
    if (process.env['MANHEIM_API_KEY']) {
      try {
        const mmrRes = await fetch(`https://api.manheim.com/valuation/vin/${vin}?country=US`, {
          headers: {
            'Authorization': `Bearer ${process.env['MANHEIM_API_KEY']}`,
            'Accept': 'application/json',
          },
        });
        if (mmrRes.ok) {
          const mmrData = await mmrRes.json();
          mmr = mmrData?.adjustedPricing?.average?.wholesale || mmrData?.items?.[0]?.adjustedPricing?.average?.wholesale || 0;
        }
      } catch (e) { console.error('MMR fetch error:', e); }
    }

    // KBB via API (if configured)
    if (process.env['KBB_API_KEY']) {
      try {
        const kbbRes = await fetch(`https://api.kbb.com/vehicle/v1/values?vin=${vin}&mileage=${mileage || 0}&condition=good`, {
          headers: {
            'Authorization': `Bearer ${process.env['KBB_API_KEY']}`,
            'Accept': 'application/json',
          },
        });
        if (kbbRes.ok) {
          const kbbData = await kbbRes.json();
          kbb = kbbData?.fairPurchasePrice || kbbData?.values?.fairPurchasePrice || 0;
        }
      } catch (e) { console.error('KBB fetch error:', e); }
    }

    // MarketCheck — use NeoVIN canonical make/model to ensure correct search
    let market_avg = 0;
    let market_days_supply = 0;
    let market_miles_mean = 0;
    let stats: any = null;
    let active_comps: any[] = [];
    let sold_comps: any[] = [];
    let vin_history: any[] = [];
    let available_colors: { color: string; count: number }[] = [];

    const mcKey = process.env['MARKETCHECK_API_KEY'];
    if (mcKey && year && make) {
      const mcBase = 'https://api.marketcheck.com/v2';

      // Use NeoVIN canonical make/model if available (NHTSA model names don't match MC)
      let searchMake = make;
      let searchModel = model || '';
      const nvCached = neovinCache.get(vin?.toUpperCase() || '');
      if (nvCached?.data?.make) searchMake = nvCached.data.make;
      if (nvCached?.data?.model) searchModel = nvCached.data.model;

      // If not cached yet, try fetching NeoVIN now (fast, cached in-memory)
      if (!nvCached && vin) {
        try {
          const nvRes = await fetch(`${mcBase}/decode/car/neovin/${vin}/specs?api_key=${mcKey}`, { headers: { Accept: 'application/json' } });
          if (nvRes.ok) {
            const nv = await nvRes.json();
            if (nv.make) searchMake = nv.make;
            if (nv.model) searchModel = nv.model;
            neovinCache.set(vin.toUpperCase(), { data: nv, ts: Date.now() });
          }
        } catch {}
      }

      const mcCommon: Record<string, string> = { api_key: mcKey, year: String(year), make: searchMake };
      if (searchModel) mcCommon['model'] = searchModel;

      // Parallel: active comps (with inline stats + color facets) + sold comps + VIN history
      const [activeRes, soldRes, histRes] = await Promise.allSettled([
        fetch(`${mcBase}/search/car/active?${new URLSearchParams({
          ...mcCommon, rows: '25', sort_by: 'price', sort_order: 'asc',
          stats: 'price,miles,dom', facets: 'exterior_color',
        })}`),
        fetch(`${mcBase}/search/car/active?${new URLSearchParams({
          ...mcCommon, rows: '25', sort_by: 'dom', sort_order: 'desc',
          inventory_type: 'used',
        })}`),
        vin ? fetch(`${mcBase}/history/car/${vin}?${new URLSearchParams({ api_key: mcKey })}`) : Promise.reject('no vin'),
      ]);

      // Active comps — also extract inline stats and color facets
      if (activeRes.status === 'fulfilled' && activeRes.value.ok) {
        try {
          const d = await activeRes.value.json();
          // Stats come inline
          if (d.stats) {
            stats = d.stats;
            market_avg = Math.round(d.stats?.price?.mean || 0);
            // Use median DOM — mean is skewed by stale outlier listings
            market_days_supply = Math.round(d.stats?.dom?.median || d.stats?.dom?.mean || 0);
            market_miles_mean = Math.round(d.stats?.miles?.mean || 0);
          }
          // Color facets
          available_colors = (d.facets?.exterior_color || []).map((f: any) => ({ color: f.item, count: f.count }));
          // Listings
          active_comps = (d?.listings || []).map((l: any) => ({
            id: l.id,
            vin: l.vin || '',
            heading: l.heading || '',
            price: l.price,
            miles: l.miles,
            days_on_market: l.dom || l.days_on_market,
            dealer: l.dealer?.name || l.seller_name || '',
            dealer_phone: l.dealer?.phone || '',
            dealer_website: l.dealer?.website || '',
            city: l.dealer?.city || l.city || '',
            state: l.dealer?.state || l.state || '',
            zip: l.dealer?.zip || l.zip || '',
            distance: l.distance,
            exterior_color: l.exterior_color || '',
            interior_color: l.interior_color || '',
            trim: l.trim || '',
            engine: l.build?.engine || '',
            transmission: l.build?.transmission || '',
            drivetrain: l.build?.drivetrain || '',
            inventory_type: l.inventory_type || '',
            carfax_1_owner: !!(l.carfax_1_owner),
            carfax_clean_title: !!(l.carfax_clean_title),
            photo: l.media?.photo_links?.[0] || '',
            photos: (l.media?.photo_links || []).slice(0, 8),
            url: l.vdp_url || '',
          }));
        } catch {}
      }

      // Sold comps (high dom = likely to sell soon / recently moved)
      if (soldRes.status === 'fulfilled' && soldRes.value.ok) {
        try {
          const d = await soldRes.value.json();
          sold_comps = (d?.listings || [])
            .filter((l: any) => l.id !== active_comps[0]?.id)
            .slice(0, 20)
            .map((l: any) => ({
              id: l.id,
              vin: l.vin || '',
              heading: l.heading || '',
              price: l.price, miles: l.miles,
              days_on_market: l.dom || l.days_on_market,
              sold_date: l.last_seen_at,
              dealer: l.dealer?.name || l.seller_name || '',
              city: l.dealer?.city || l.city || '',
              state: l.dealer?.state || l.state || '',
              exterior_color: l.exterior_color || '',
              interior_color: l.interior_color || '',
              trim: l.trim || '',
              engine: l.build?.engine || '',
              transmission: l.build?.transmission || '',
              photo: l.media?.photo_links?.[0] || '',
              url: l.vdp_url || '',
            }));
        } catch {}
      }

      // VIN history
      if (histRes.status === 'fulfilled' && (histRes.value as any).ok) {
        try {
          const d = await (histRes.value as any).json();
          vin_history = (d?.listings || d || []).map((l: any) => ({
            price: l.price, miles: l.miles,
            days_on_market: l.dom || l.days_on_market,
            first_seen: l.first_seen_at,
            last_seen: l.last_seen_at,
            dealer: l.dealer?.name || l.seller_name || '',
            city: l.dealer?.city || l.city || '',
            state: l.dealer?.state || l.state || '',
            zip: l.dealer?.zip || l.zip || '',
          }));
        } catch {}
      }
    }

    // Fallback market_avg from MMR/KBB if MarketCheck didn't return
    if (!market_avg) {
      const values = [mmr, kbb].filter(v => v > 0);
      market_avg = values.length > 0 ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : 0;
    }

    // Cache the result
    const row = {
      vin, mmr, kbb, market_avg, market_days_supply,
      stats, active_comps, sold_comps, vin_history,
      year, make, model, trim, mileage,
      fetched_at: new Date().toISOString(),
    };
    // available_colors not cached (cheap to re-fetch, column may not exist)
    if (cached) {
      await supabase.from('vehicle_market_data').update(row).eq('vin', vin);
    } else {
      await supabase.from('vehicle_market_data').insert(row);
    }

    res.json({ mmr, kbb, market_avg, market_days_supply, market_miles_mean, stats, active_comps, sold_comps, vin_history, available_colors });
  } catch (err) {
    console.error('Market data error:', err);
    res.status(500).json({ error: 'Failed to fetch market data' });
  }
});

/**
 * AI Vehicle Description Generator
 */
app.post('/api/admin/generate-description', aiLimiter, async (req, res) => {
  try {
    const v = req.body;

    // Build history section from Carfax-style inputs
    const historyParts: string[] = [];
    if (v.owners) historyParts.push(v.owners);
    if (v.accidents) historyParts.push(v.accidents);
    if (v.service_history) historyParts.push(v.service_history);
    if (v.use_type) historyParts.push(`${v.use_type} use`);

    const prompt = `You write car listings for Big Wave Auto. Short and punchy. No fluff.

STYLE:
- 80-120 words max. Every sentence earns its spot.
- Short sentences. Hit hard. Move on.
- Lead with the headline detail — the thing that makes a buyer stop scrolling
- Work in the history (owners, accidents, clean title) as proof points, not filler
- Specs woven in naturally, not a bullet dump
- Features/highlights called out directly
- Close with one line mentioning Big Wave Auto — casual, not salesy
- Zero exclamation marks. Zero "won't last long" or "must see" clichés.
- Confident tone. You know this is a good car. Let the facts do the talking.
- Return ONLY the description text, no titles or labels

VEHICLE:
${v.year} ${v.make} ${v.model} ${v.trim || ''}
Mileage: ${v.mileage ? Number(v.mileage).toLocaleString() + ' miles' : 'N/A'}
Exterior: ${v.exterior_color || 'N/A'}
Interior: ${v.interior_color || 'N/A'}
Body: ${v.body || 'N/A'}
Engine: ${v.engine || 'N/A'}
Transmission: ${v.transmission || 'N/A'}
Drivetrain: ${v.drivetrain || 'N/A'}
Fuel: ${v.fuel || 'N/A'}
Condition: ${v.condition || 'N/A'}
${historyParts.length ? `\nHISTORY: ${historyParts.join(', ')}` : ''}
${v.highlights ? `\nHIGHLIGHTS: ${v.highlights}` : ''}
${v.asking_price ? `\nPrice: $${Number(v.asking_price).toLocaleString()}` : ''}`;

    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }],
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
 * Manheim Photo Grabber — receive extracted photo URLs from Chrome extension
 * Uses a simple API key since the extension can't carry a Supabase JWT session.
 * This endpoint is OUTSIDE the /api/admin auth middleware.
 */
app.post('/api/ext/manheim-photos', async (req, res) => {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey || apiKey !== process.env['BWA_EXT_API_KEY']) {
    res.status(401).json({ error: 'Invalid API key' });
    return;
  }
  try {
    const { vin, photos } = req.body;
    if (!vin || !photos?.length) { res.status(400).json({ error: 'VIN and photos required' }); return; }

    const uploaded: string[] = [];
    const existing = await supabase.from('vehicle_photos').select('url').eq('vin', vin);
    const existingUrls = new Set((existing.data || []).map((p: any) => p.url));
    let sortOrder = existingUrls.size;

    for (const photoUrl of photos) {
      try {
        // Download the image from Manheim
        const imgRes = await fetch(photoUrl);
        if (!imgRes.ok) continue;

        const buffer = Buffer.from(await imgRes.arrayBuffer());
        const contentType = imgRes.headers.get('content-type') || 'image/jpeg';
        const ext = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpg';
        const fileName = `${vin}/manheim_${Date.now()}_${sortOrder}.${ext}`;

        // Upload to Supabase storage
        const { error: uploadError } = await supabase.storage
          .from('vehicle-photos')
          .upload(fileName, buffer, { contentType });

        if (uploadError) { console.error('Upload error:', uploadError); continue; }

        const { data: urlData } = supabase.storage
          .from('vehicle-photos')
          .getPublicUrl(fileName);

        // Save to vehicle_photos table
        await supabase.from('vehicle_photos').insert({
          vin, url: urlData.publicUrl, sort_order: sortOrder,
        });

        uploaded.push(urlData.publicUrl);
        sortOrder++;
      } catch (e) {
        console.error(`Failed to process ${photoUrl}:`, e);
      }
    }

    res.json({ success: true, count: uploaded.length, photos: uploaded });
  } catch (err) {
    console.error('Manheim photos error:', err);
    res.status(500).json({ error: 'Failed to process photos' });
  }
});

/**
 * Proposals — create from extension CR data
 */
app.post('/api/ext/proposal', async (req, res) => {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey || apiKey !== process.env['BWA_EXT_API_KEY']) {
    res.status(401).json({ error: 'Invalid API key' });
    return;
  }
  try {
    const { vin, vehicle, condition, auction, photos, page_type, source_url, extracted_at, customer_name, customer_id } = req.body;
    if (!vin) { res.status(400).json({ error: 'VIN required' }); return; }

    // Decode VIN via NHTSA for reliable year/make/model/trim
    let vinData: any = vehicle || {};
    try {
      const nhtsaRes = await fetch(`https://vpic.nhtsa.dot.gov/api/vehicles/decodevinvalues/${vin}?format=json`);
      if (nhtsaRes.ok) {
        const nhtsaJson = await nhtsaRes.json();
        const r = nhtsaJson?.Results?.[0];
        if (r && r.ModelYear) {
          vinData = {
            ...vinData,
            year: r.ModelYear || vinData.year,
            make: r.Make || vinData.make,
            model: r.Model || vinData.model,
            trim: r.Trim || vinData.trim,
            engine: r.DisplacementL ? `${r.DisplacementL}L ${r.FuelTypePrimary || ''}`.trim() : (vinData.engine || ''),
            transmission: r.TransmissionStyle || vinData.transmission,
            drivetrain: r.DriveType || vinData.drivetrain,
            fuel: r.FuelTypePrimary || vinData.fuel,
            body: r.BodyClass || vinData.body,
            // Keep scrape-sourced fields that NHTSA won't have
            mileage: vinData.mileage,
            exterior_color: vinData.exterior_color,
            interior_color: vinData.interior_color,
            grade: vinData.grade,
            seller: vinData.seller,
            cylinders: vinData.cylinders,
            doors: vinData.doors,
          };
        }
      }
    } catch (e) {
      console.error('NHTSA decode error:', e);
    }

    // Check if a proposal already exists for this VIN — if so, merge vehicle data only
    const { data: existing } = await supabase
      .from('vehicle_proposals')
      .select('id')
      .eq('vin', vin)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existing) {
      // Merge: update vehicle/photo/auction data but leave all price & deal fields untouched
      const { error: mergeError } = await supabase.from('vehicle_proposals').update({
        vehicle: vinData,
        condition: condition || {},
        auction: auction || null,
        mmr: auction?.mmr || null,
        photos: photos || [],
        page_type: page_type || 'unknown',
        source_url: source_url || '',
        extracted_at: extracted_at || new Date().toISOString(),
        updated_at: new Date().toISOString(),
        // Only set customer if not already set (don't overwrite existing assignment)
        ...(customer_name ? { customer_name } : {}),
        ...(customer_id ? { customer_id } : {}),
      }).eq('id', existing.id);

      if (mergeError) { console.error('Proposal merge error:', mergeError); res.status(500).json({ error: mergeError.message }); return; }
      res.json({ success: true, id: existing.id, merged: true });
      return;
    }

    const id = randomBytes(6).toString('hex');
    const { error } = await supabase.from('vehicle_proposals').insert({
      id,
      vin,
      vehicle: vinData,
      condition: condition || {},
      auction: auction || null,
      mmr: auction?.mmr || null,
      photos: photos || [],
      page_type: page_type || 'unknown',
      source_url: source_url || '',
      extracted_at: extracted_at || new Date().toISOString(),
      status: 'draft',
      ...(customer_name ? { customer_name } : {}),
      ...(customer_id ? { customer_id } : {}),
    });

    if (error) { console.error('Proposal insert error:', error); res.status(500).json({ error: error.message }); return; }
    res.json({ success: true, id });
  } catch (err) {
    console.error('Proposal create error:', err);
    res.status(500).json({ error: 'Failed to create proposal' });
  }
});

/**
 * Public proposal page — no auth required
 */
app.get('/api/proposal/:id', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('vehicle_proposals')
      .select('*')
      .eq('id', req.params['id'])
      .maybeSingle();

    if (error || !data) { res.status(404).json({ error: 'Proposal not found' }); return; }
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load proposal' });
  }
});

/**
 * Public — proposal feedback (interest / pass)
 */
app.post('/api/proposal/:id/feedback', async (req, res) => {
  try {
    const { interest, reason } = req.body;
    const { data: proposal } = await supabase
      .from('vehicle_proposals')
      .select('id, feedback')
      .eq('id', req.params['id'])
      .maybeSingle();
    if (!proposal) { res.status(404).json({ error: 'Not found' }); return; }

    const existing = Array.isArray(proposal.feedback) ? proposal.feedback : (proposal.feedback ? [proposal.feedback] : []);
    const newEntry = {
      interest,
      reason: reason || null,
      submitted_at: new Date().toISOString(),
    };
    const feedback = [...existing, newEntry];
    await supabase.from('vehicle_proposals').update({ feedback }).eq('id', req.params['id']);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save feedback' });
  }
});

/**
 * Admin — backfill existing proposals with NHTSA VIN data
 */
app.post('/api/admin/proposals/backfill-vin', async (_req, res) => {
  try {
    const { data: proposals, error } = await supabase
      .from('vehicle_proposals')
      .select('id, vin, vehicle')
      .order('created_at', { ascending: false });
    if (error) { res.status(500).json({ error: error.message }); return; }

    let updated = 0;
    for (const p of (proposals || [])) {
      if (p.vehicle?.year && p.vehicle?.make) continue; // already has good data
      try {
        const nhtsaRes = await fetch(`https://vpic.nhtsa.dot.gov/api/vehicles/decodevinvalues/${p.vin}?format=json`);
        if (!nhtsaRes.ok) continue;
        const nhtsaJson = await nhtsaRes.json();
        const r = nhtsaJson?.Results?.[0];
        if (!r?.ModelYear) continue;
        const vehicle = {
          ...(p.vehicle || {}),
          year: r.ModelYear,
          make: r.Make,
          model: r.Model,
          trim: r.Trim || (p.vehicle?.trim),
          engine: r.DisplacementL ? `${r.DisplacementL}L ${r.FuelTypePrimary || ''}`.trim() : undefined,
          transmission: r.TransmissionStyle || undefined,
          drivetrain: r.DriveType || undefined,
          fuel: r.FuelTypePrimary || undefined,
          body: r.BodyClass || undefined,
        };
        // Remove junk fields
        for (const key of ['engine', 'transmission', 'drivetrain', 'fuel', 'body', 'exterior_color', 'interior_color', 'seller']) {
          if (vehicle[key] && (vehicle[key].length > 60 || /manage|run list|international|vehicle\b/i.test(vehicle[key]))) {
            delete vehicle[key];
          }
        }
        await supabase.from('vehicle_proposals').update({ vehicle }).eq('id', p.id);
        updated++;
      } catch (e) { /* skip */ }
    }
    res.json({ success: true, updated, total: proposals?.length });
  } catch (err) {
    res.status(500).json({ error: 'Backfill failed' });
  }
});

/**
 * Admin — search customers by name (from existing proposals)
 */
app.get('/api/admin/customers/search', async (req, res) => {
  const q = (req.query['q'] as string || '').toLowerCase().trim();
  if (!q) { res.json([]); return; }
  try {
    const { data } = await supabase
      .from('vehicle_proposals')
      .select('customer_name, customer_phone')
      .not('customer_name', 'is', null)
      .ilike('customer_name', `%${q}%`)
      .order('created_at', { ascending: false });

    // Deduplicate by name
    const seen = new Set<string>();
    const results = (data || []).filter((r: any) => {
      if (!r.customer_name || seen.has(r.customer_name)) return false;
      seen.add(r.customer_name);
      return true;
    }).map((r: any) => ({ name: r.customer_name, phone: r.customer_phone }));

    res.json(results);
  } catch { res.json([]); }
});

/**
 * Admin — list proposals
 */
app.get('/api/admin/proposals', async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from('vehicle_proposals')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load proposals' });
  }
});

// ── Deal Groups ──

app.get('/api/admin/deal-groups', async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from('deal_groups')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load deal groups' });
  }
});

app.post('/api/admin/deal-groups', async (req, res) => {
  try {
    const { label, customer_name, customer_phone, customer_email, customer_address, customer_zip, tax_rate, trade_in } = req.body;
    const { data, error } = await supabase
      .from('deal_groups')
      .insert({
        label: label || 'New Deal',
        customer_name: customer_name || '',
        customer_phone: customer_phone || '',
        customer_email: customer_email || '',
        customer_address: customer_address || '',
        customer_zip: customer_zip || '',
        tax_rate: tax_rate ?? 5.5,
        trade_in: trade_in || null,
      })
      .select()
      .single();
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create deal group' });
  }
});

app.post('/api/admin/deal-groups/:id', async (req, res) => {
  try {
    const updates: Record<string, any> = { updated_at: new Date().toISOString() };
    const fields = ['label', 'customer_name', 'customer_phone', 'customer_email', 'customer_address', 'customer_zip', 'tax_rate', 'trade_in'];
    for (const f of fields) {
      if (req.body[f] !== undefined) updates[f] = req.body[f];
    }
    const { error } = await supabase.from('deal_groups').update(updates).eq('id', req.params['id']);
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update deal group' });
  }
});

app.delete('/api/admin/deal-groups/:id', async (req, res) => {
  try {
    await supabase.from('vehicle_proposals').update({ deal_group_id: null }).eq('deal_group_id', req.params['id']);
    const { error } = await supabase.from('deal_groups').delete().eq('id', req.params['id']);
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete deal group' });
  }
});

/**
 * Admin — upload Carfax PDF for a proposal (must be before /:id route)
 */
app.post('/api/admin/proposal/carfax', upload.single('file'), async (req: any, res) => {
  try {
    console.log('[carfax upload] file:', req.file ? `${req.file.originalname} ${req.file.size}b` : 'MISSING', 'proposal_id:', req.body?.proposal_id, 'vin:', req.body?.vin);
    if (!req.file) { res.status(400).json({ error: 'No file' }); return; }
    const proposalId = req.body.proposal_id;
    const vin = req.body.vin;
    const fileName = `carfax/${vin}_${Date.now()}.pdf`;

    const { error: uploadError } = await supabase.storage
      .from('vehicle-photos')
      .upload(fileName, req.file.buffer, { contentType: 'application/pdf' });

    if (uploadError) { console.error('Carfax upload error:', uploadError); res.status(500).json({ error: 'Upload failed' }); return; }

    const { data: urlData } = supabase.storage
      .from('vehicle-photos')
      .getPublicUrl(fileName);

    await supabase.from('vehicle_proposals').update({ carfax_url: urlData.publicUrl }).eq('id', proposalId);

    res.json({ url: urlData.publicUrl });
  } catch (err) {
    console.error('Carfax upload error:', err);
    res.status(500).json({ error: 'Upload failed' });
  }
});

/**
 * Admin — upload Window Sticker for a proposal
 */
app.post('/api/admin/proposal/window-sticker', requireAdmin, upload.single('file'), async (req: any, res) => {
  try {
    if (!req.file) { res.status(400).json({ error: 'No file' }); return; }
    const proposalId = req.body.proposal_id;
    const vin = req.body.vin;
    const ext = req.file.mimetype === 'application/pdf' ? 'pdf' : req.file.mimetype.split('/')[1] || 'jpg';
    const fileName = `window-sticker/${vin}_${Date.now()}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from('vehicle-photos')
      .upload(fileName, req.file.buffer, { contentType: req.file.mimetype });

    if (uploadError) { res.status(500).json({ error: 'Upload failed' }); return; }

    const { data: urlData } = supabase.storage.from('vehicle-photos').getPublicUrl(fileName);
    await supabase.from('vehicle_proposals').update({ window_sticker_url: urlData.publicUrl }).eq('id', proposalId);
    res.json({ url: urlData.publicUrl });
  } catch (err) {
    res.status(500).json({ error: 'Upload failed' });
  }
});

/**
 * Admin — update proposal (edit fields, exclude items, change status)
 */
app.post('/api/admin/proposal/:id', async (req, res) => {
  try {
    const { vehicle, condition, photos, status, excluded_fields, custom_notes, asking_price, line_items, trade_in, tax_rate, down_payment } = req.body;
    const updates: Record<string, any> = {};
    if (vehicle !== undefined) updates['vehicle'] = vehicle;
    if (condition !== undefined) updates['condition'] = condition;
    if (photos !== undefined) updates['photos'] = photos;
    if (status !== undefined) updates['status'] = status;
    if (excluded_fields !== undefined) updates['excluded_fields'] = excluded_fields;
    if (custom_notes !== undefined) updates['custom_notes'] = custom_notes;
    if (asking_price !== undefined) updates['asking_price'] = asking_price;
    if (line_items !== undefined) updates['line_items'] = line_items;
    if (trade_in !== undefined) updates['trade_in'] = trade_in;
    if (tax_rate !== undefined) updates['tax_rate'] = tax_rate;
    if (down_payment !== undefined) updates['down_payment'] = down_payment;
    if (req.body.carfax_url !== undefined) updates['carfax_url'] = req.body.carfax_url;
    if (req.body.purchase_price !== undefined) updates['purchase_price'] = req.body.purchase_price;
    if (req.body.transport_cost !== undefined) updates['transport_cost'] = req.body.transport_cost;
    if (req.body.auction_fees !== undefined) updates['auction_fees'] = req.body.auction_fees;
    if (req.body.recon_mechanical !== undefined) updates['recon_mechanical'] = req.body.recon_mechanical;
    if (req.body.recon_body !== undefined) updates['recon_body'] = req.body.recon_body;
    if (req.body.recon_tires !== undefined) updates['recon_tires'] = req.body.recon_tires;
    if (req.body.recon_other !== undefined) updates['recon_other'] = req.body.recon_other;
    if (req.body.est_days_to_sell !== undefined) updates['est_days_to_sell'] = req.body.est_days_to_sell;
    if (req.body.min_price !== undefined) updates['min_price'] = req.body.min_price;
    if (req.body.mmr !== undefined) updates['mmr'] = req.body.mmr;
    if (req.body.marine_cu !== undefined) updates['marine_cu'] = req.body.marine_cu;
    if (req.body.proposal_mode !== undefined) updates['proposal_mode'] = req.body.proposal_mode;
    if (req.body.customer_name !== undefined) updates['customer_name'] = req.body.customer_name;
    if (req.body.customer_phone !== undefined) updates['customer_phone'] = req.body.customer_phone;
    if (req.body.customer_address !== undefined) updates['customer_address'] = req.body.customer_address;
    if (req.body.customer_zip !== undefined) updates['customer_zip'] = req.body.customer_zip;
    if (req.body.lien_payoff !== undefined) updates['lien_payoff'] = req.body.lien_payoff;
    if (req.body.apr !== undefined) updates['apr'] = req.body.apr;
    if (req.body.term_months !== undefined) updates['term_months'] = req.body.term_months;
    if (req.body.window_sticker_url !== undefined) updates['window_sticker_url'] = req.body.window_sticker_url;
    if (req.body.deal_group_id !== undefined) updates['deal_group_id'] = req.body.deal_group_id;
    if (req.body.profit_target !== undefined) updates['profit_target'] = req.body.profit_target;
    if (req.body.security_deposit !== undefined) updates['security_deposit'] = req.body.security_deposit;
    if (req.body.rivian_specs !== undefined && Object.keys(req.body.rivian_specs || {}).length > 0) updates['rivian_specs'] = req.body.rivian_specs;
    updates['updated_at'] = new Date().toISOString();

    console.log('[proposal save] id:', req.params['id'], 'photos count:', photos?.length ?? 'not sent');

    const { error } = await supabase
      .from('vehicle_proposals')
      .update(updates)
      .eq('id', req.params['id']);

    if (error) { console.error('Proposal save error:', JSON.stringify(error)); res.status(500).json({ error: error.message }); return; }
    res.json({ success: true });
  } catch (err) {
    console.error('Proposal save exception:', err);
    res.status(500).json({ error: 'Failed to update proposal' });
  }
});

/**
 * Admin — delete a proposal
 */
app.delete('/api/admin/proposal/:id', async (req, res) => {
  try {
    const { error } = await supabase
      .from('vehicle_proposals')
      .delete()
      .eq('id', req.params['id']);
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete proposal' });
  }
});

/**
 * Admin — send proposal link via email
 */
app.post('/api/admin/proposal/:id/send', async (req, res) => {
  try {
    const { email, phone, message } = req.body;
    const proposalId = req.params['id'];

    const { data: proposal } = await supabase
      .from('vehicle_proposals')
      .select('*')
      .eq('id', proposalId)
      .single();

    if (!proposal) { res.status(404).json({ error: 'Proposal not found' }); return; }

    const v = proposal.vehicle || {};
    const vehicleName = `${v.year || ''} ${v.make || ''} ${v.model || ''} ${v.trim || ''}`.trim();
    const link = `https://bigwaveauto.com/proposal/${proposalId}`;

    if (email) {
      await resend.emails.send({
        from: FROM_EMAIL,
        to: email,
        subject: `Your Vehicle Report — ${vehicleName || proposal.vin}`,
        html: `
          <div style="font-family:-apple-system,sans-serif;max-width:600px;margin:0 auto">
            <div style="background:#1e293b;padding:24px;border-radius:12px 12px 0 0">
              <h1 style="color:white;font-size:20px;margin:0">Big Wave Auto</h1>
              <p style="color:rgba(255,255,255,0.6);margin:4px 0 0;font-size:14px">Vehicle Report</p>
            </div>
            <div style="padding:24px;background:white;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 12px 12px">
              <h2 style="margin:0 0 8px;font-size:22px">${escHtml(vehicleName)}</h2>
              <p style="color:#666;font-size:14px">VIN: ${escHtml(proposal.vin)}</p>
              ${message ? `<p style="margin:16px 0;font-size:14px;color:#333">${escHtml(message)}</p>` : ''}
              <a href="${link}" style="display:inline-block;padding:14px 32px;background:#2563eb;color:white;text-decoration:none;border-radius:8px;font-weight:700;font-size:15px;margin:16px 0">View Full Report</a>
              <p style="font-size:12px;color:#999;margin-top:24px">Big Wave Auto — Sussex, WI</p>
            </div>
          </div>
        `,
      });
    }

    // Update proposal status
    await supabase.from('vehicle_proposals').update({
      status: 'sent',
      sent_to: email || phone || null,
      sent_at: new Date().toISOString(),
    }).eq('id', proposalId);

    res.json({ success: true });
  } catch (err) {
    console.error('Send proposal error:', err);
    res.status(500).json({ error: 'Failed to send' });
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

    const [pricing, costAdds, floorPlans, photos, windowSticker, marketData] = await Promise.all([
      supabase.from('vehicle_pricing').select('*').eq('vin', vin).maybeSingle(),
      supabase.from('vehicle_cost_adds').select('*').eq('vin', vin).order('date_added', { ascending: true }),
      supabase.from('vehicle_floor_plans').select('*').eq('vin', vin).order('date_floored', { ascending: true }),
      supabase.from('vehicle_photos').select('*').eq('vin', vin).order('sort_order', { ascending: true }),
      Promise.resolve(supabase.from('vehicle_documents').select('url').eq('vin', vin).eq('type', 'window_sticker').maybeSingle()).then(r => r.data).catch(() => null),
      supabase.from('vehicle_market_data').select('mmr,kbb,market_avg').eq('vin', vin).maybeSingle(),
    ]);

    res.json({
      pricing: pricing.data || null,
      costAdds: costAdds.data || [],
      floorPlans: floorPlans.data || [],
      photos: photos.data || [],
      windowSticker: (windowSticker as any)?.url || null,
      marketData: marketData.data || null,
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
 * Vehicle Pipeline Stages
 */

// Get stage thresholds (configurable)
app.get('/api/admin/stages/thresholds', async (_req, res) => {
  try {
    const { data, error } = await supabase.from('stage_thresholds').select('*').order('sort_order');
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load thresholds' });
  }
});

// Update stage thresholds
app.post('/api/admin/stages/thresholds', async (req, res) => {
  try {
    const { thresholds } = req.body;
    if (!thresholds?.length) { res.status(400).json({ error: 'Thresholds required' }); return; }
    for (const t of thresholds) {
      await supabase.from('stage_thresholds').update({ yellow_days: t.yellow_days, red_days: t.red_days }).eq('stage', t.stage);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update thresholds' });
  }
});

// Get current stage + history for a vehicle
app.get('/api/admin/vehicle/:vin/stages', async (req, res) => {
  try {
    const { vin } = req.params;
    const { data, error } = await supabase.from('vehicle_stages')
      .select('*').eq('vin', vin).order('entered_at', { ascending: false });
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.json({
      current: data?.[0] || null,
      history: data || [],
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load stages' });
  }
});

// Get current stages for ALL vehicles (for inventory list badges)
app.get('/api/admin/stages/current', async (_req, res) => {
  try {
    // Get all stage records, then pick the latest per VIN
    const { data, error } = await supabase.from('vehicle_stages')
      .select('*').order('entered_at', { ascending: false });
    if (error) { res.status(500).json({ error: error.message }); return; }

    const byVin: Record<string, any> = {};
    for (const row of (data || [])) {
      if (!byVin[row.vin]) byVin[row.vin] = row;
    }
    res.json(byVin);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load current stages' });
  }
});

// Move a vehicle to a new stage
app.post('/api/admin/vehicle/:vin/stage', async (req, res) => {
  try {
    const { vin } = req.params;
    const { stage, notes } = req.body;
    const adminUser = (req as any).adminUser;
    const createdBy = adminUser?.email || 'unknown';

    if (!stage) { res.status(400).json({ error: 'Stage required' }); return; }

    // Close the previous stage (set exited_at)
    const { data: current } = await supabase.from('vehicle_stages')
      .select('id').eq('vin', vin).is('exited_at', null).order('entered_at', { ascending: false }).limit(1);

    if (current?.length) {
      await supabase.from('vehicle_stages').update({ exited_at: new Date().toISOString() }).eq('id', current[0].id);
    }

    // Insert new stage
    const { data: newStage, error } = await supabase.from('vehicle_stages').insert({
      vin, stage, notes: notes || null, created_by: createdBy,
    }).select().single();

    if (error) { res.status(500).json({ error: error.message }); return; }
    res.json(newStage);
  } catch (err) {
    console.error('Stage update error:', err);
    res.status(500).json({ error: 'Failed to update stage' });
  }
});

// Bulk set stages for multiple vehicles at once (initial backfill)
app.post('/api/admin/stages/bulk', async (req, res) => {
  try {
    const { assignments } = req.body; // Array of { vin, stage, notes? }
    const adminUser = (req as any).adminUser;
    const createdBy = adminUser?.email || 'unknown';

    if (!assignments?.length) { res.status(400).json({ error: 'Assignments required' }); return; }

    for (const a of assignments) {
      if (!a.vin || !a.stage) continue;

      // Close any existing open stage
      const { data: current } = await supabase.from('vehicle_stages')
        .select('id').eq('vin', a.vin).is('exited_at', null).order('entered_at', { ascending: false }).limit(1);

      if (current?.length) {
        await supabase.from('vehicle_stages').update({ exited_at: new Date().toISOString() }).eq('id', current[0].id);
      }

      await supabase.from('vehicle_stages').insert({
        vin: a.vin, stage: a.stage, notes: a.notes || 'Initial backfill', created_by: createdBy,
      });
    }

    res.json({ success: true, count: assignments.length });
  } catch (err) {
    console.error('Bulk stage error:', err);
    res.status(500).json({ error: 'Failed to bulk update stages' });
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

// DealerCenter CSV export — Nowcom format, filename: 18548085_YYYYMMDD.csv
app.get('/api/admin/dealercenter-export', async (_req, res) => {
  try {
    const vehicles = await readVautoCsv();
    const DCID = '18548085';
    const today = new Date();
    const dateStr = today.getFullYear().toString()
      + String(today.getMonth() + 1).padStart(2, '0')
      + String(today.getDate()).padStart(2, '0');
    const filename = `${DCID}_${dateStr}.csv`;

    const headers = [
      'Dealer ID','Type','Stock','VIN','Year','Make','Model','Body','Trim',
      'ModelNumber','Doors','ExteriorColor','InteriorColor','EngineCylinders',
      'EngineDisplacement','Transmission','Miles','SellingPrice','MSRP',
      'BookValue','Cost','Invoice','Certified','DateInStock','Description',
      'Options','Categorized Options','Dealer Name','Dealer Address',
      'Dealer City','Dealer State','Dealer Zip','Dealer Phone','Dealer Fax',
      'Dealer Email','Comment 1','Comment 2','Comment 3','Comment 4','Comment 5',
      'Style_Description','Ext_Color_Generic','Ext_Color_Code',
      'Engine_Aspiration_Type','Engine_Description','Transmission_Speed',
      'Transmission_Description','Drivetrain','Fuel_Type','CityMPG','HighwayMPG',
      'EPAClassification','Internet_Price','Misc_Price1','Misc_Price2','Misc_Price3',
      'Factory_Codes','MarketClass','PassengerCapacity','ImageList',
    ];

    const escCsv = (val: any): string => {
      const s = String(val ?? '');
      if (s.includes(',') || s.includes('"') || s.includes('\n')) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    };

    const rows: string[] = [headers.join(',')];

    for (const v of vehicles) {
      const type = v.condition === 'New' ? 'New' : 'H_Used';
      const dateInStock = v.dateinstock ? new Date(v.dateinstock).toLocaleDateString('en-US') : '';
      const images = (v.photos || []).join(',');
      const options = (v.highlights || []).join(',');

      const row = [
        DCID,
        type,
        v.stocknumber || '',
        v.vin || '',
        v.year || '',
        v.make || '',
        v.model || '',
        v.body || '',
        v.trim || '',
        '', // ModelNumber
        v.doors || '',
        v.exteriorcolor || '',
        v.interiorcolor || '',
        '', // EngineCylinders
        '', // EngineDisplacement
        v.transmission || '',
        v.mileage || 0,
        v.price || 0,
        v.msrp || v.originalprice || 0,
        '', // BookValue
        '', // Cost
        '', // Invoice
        v.certified ? 'TRUE' : 'FALSE',
        dateInStock,
        v.description || '',
        options,
        '', // Categorized Options
        'Big Wave Auto',
        'N69W25055 Indian Grass Lane, Unit H',
        'Sussex',
        'WI',
        '53089',
        '(262) 281-1295',
        '', // Fax
        '', // Email
        '', '', '', '', '', // Comments 1-5
        v.trim || '', // Style_Description
        v.exteriorcolorstandard || v.exteriorcolor || '',
        '', // Ext_Color_Code
        '', // Engine_Aspiration_Type
        v.engine || '',
        '', // Transmission_Speed
        v.transmission || '',
        v.drivetrainstandard || '',
        v.fuel || '',
        v.citympg || '',
        v.hwympg || '',
        '', // EPAClassification
        v.price || 0,
        '', '', '', // Misc prices
        '', // Factory_Codes
        '', // MarketClass
        '', // PassengerCapacity
        images,
      ].map(escCsv).join(',');

      rows.push(row);
    }

    const csv = rows.join('\r\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to generate DealerCenter export' });
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
  const taxRate = 0.05;
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

/**
 * Brand logo mapping (server-side mirror of settings.component.ts brandLogos)
 */
const BRAND_LOGOS: Record<string, string> = {
  'Acura': '/brands/acura.png', 'Alfa Romeo': '/brands/alfa-romeo.png',
  'Aston Martin': '/brands/aston-martin.png', 'Audi': '/brands/audi.png',
  'Bentley': '/brands/bentley.png', 'BMW': '/brands/bmw.png',
  'Buick': '/brands/buick.png', 'Cadillac': '/brands/cadillac.png',
  'Chevrolet': '/brands/chevrolet.png', 'Chrysler': '/brands/chrysler.png',
  'Dodge': '/brands/dodge.png', 'Ferrari': '/brands/ferrari.png',
  'Ford': '/brands/ford.png', 'Genesis': '/brands/genesis.png',
  'GMC': '/brands/gmc.png', 'Honda': '/brands/honda.png',
  'Hyundai': '/brands/hyundai.png', 'Infiniti': '/brands/infiniti.png',
  'Jaguar': '/brands/jaguar.png', 'Jeep': '/brands/jeep.png',
  'Kia': '/brands/kia.png', 'Lamborghini': '/brands/lamborghini.png',
  'Land Rover': '/brands/land-rover.png', 'Lexus': '/brands/lexus.png',
  'Lincoln': '/brands/lincoln.png', 'Lucid': '/brands/lucid.png',
  'Maserati': '/brands/maserati.png', 'Mazda': '/brands/mazda.png',
  'Mercedes-Benz': '/brands/mercedes-benz.png', 'Mini': '/brands/mini.png',
  'Mitsubishi': '/brands/mitsubishi.png', 'Nissan': '/brands/nissan.png',
  'Polestar': '/brands/polestar.png', 'Porsche': '/brands/porsche.png',
  'Ram': '/brands/ram.png', 'Rivian': '/brands/rivian.png',
  'Rolls-Royce': '/brands/rolls-royce.png', 'Subaru': '/brands/subaru.png',
  'Tesla': '/brands/tesla.png', 'Toyota': '/brands/toyota.png',
  'Volkswagen': '/brands/volkswagen.png', 'Volvo': '/brands/volvo.png',
};

/**
 * Capitalize first letter of each word in a brand name
 */
function normalizeBrand(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;
  // Check for known brands (case-insensitive)
  for (const known of Object.keys(BRAND_LOGOS)) {
    if (known.toLowerCase() === trimmed.toLowerCase()) return known;
  }
  // Fallback: title case
  return trimmed.replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * Parse CSV rows into structured sales data
 */
function parseSalesReportRows(rows: Record<string, string>[]): {
  totalSales: number;
  salesByState: Record<string, { count: number; zips: Record<string, number>; topVehicles: { name: string; count: number }[] }>;
  topBrands: { name: string; count: number; logo: string }[];
} {
  const stateData: Record<string, { count: number; zips: Record<string, number>; vehicles: Record<string, number> }> = {};
  const overallBrands: Record<string, number> = {};
  let totalSales = 0;

  for (const row of rows) {
    // Find column values (flexible header matching)
    // Flexible column matching — find by key substring
    const findCol = (keys: string[]): string => {
      for (const k of keys) {
        if (row[k] !== undefined) return row[k];
      }
      // Try case-insensitive partial match
      for (const k of keys) {
        const found = Object.keys(row).find(rk => rk.toLowerCase().includes(k.toLowerCase()));
        if (found && row[found]) return row[found];
      }
      return '';
    };
    let signerState = findCol(['Signer State', 'signer state', 'Buyer State', 'buyer state', 'State', 'state', 'ST']).trim().toUpperCase();
    const signerZip = findCol(['Signer Zip', 'signer zip', 'Buyer Zip', 'buyer zip', 'Zip', 'zip']).trim().replace(/[^0-9]/g, '').slice(0, 5);

    // Derive state from zip if state column missing or empty
    if (!signerState && signerZip.length === 5) {
      const info = (zipcodes as any).lookup(signerZip);
      if (info?.state) signerState = info.state.toUpperCase();
    }
    let vehicleMake = findCol(['Vehicle Make', 'vehicle make', 'Make', 'make']).trim();
    const model = findCol(['Model', 'model']).trim();
    const dealNo = findCol(['Deal No.', 'deal no.', 'Deal No', 'deal no', 'Deal Number', 'deal number']).trim();

    // Handle combined "Vehicle Year Make" column (e.g., "2023 RIVIAN")
    if (!vehicleMake) {
      const combined = findCol(['Vehicle Year Make', 'vehicle year make']).trim();
      if (combined) {
        const parts = combined.split(/\s+/);
        if (parts.length >= 2 && /^\d{4}$/.test(parts[0])) {
          vehicleMake = parts.slice(1).join(' ');
        } else {
          vehicleMake = combined;
        }
      }
    }

    // Handle "Vehicle Info" column (e.g., "2024 GMC SIERRA 2500 HD CREW CAB AT4...")
    // Format: YEAR MAKE MODEL TRIM... — grab just the make (second word)
    if (!vehicleMake) {
      const info = findCol(['Vehicle Info', 'vehicle info']).trim();
      if (info) {
        const parts = info.split(/\s+/);
        if (parts.length >= 2 && /^\d{4}$/.test(parts[0])) {
          vehicleMake = parts[1]; // just the make word (TESLA, BMW, RIVIAN, GMC, etc.)
        } else {
          vehicleMake = parts[0];
        }
      }
    }

    // Count every row as a sale
    totalSales++;

    // Track brands for ALL deals (including wholesale with no state)
    if (vehicleMake) {
      const brand = normalizeBrand(vehicleMake);
      overallBrands[brand] = (overallBrands[brand] || 0) + 1;
    }

    // Skip state-level tracking for rows without a valid state
    if (!signerState || !VALID_STATES.has(signerState)) continue;

    // Initialize state entry
    if (!stateData[signerState]) {
      stateData[signerState] = { count: 0, zips: {}, vehicles: {} };
    }

    stateData[signerState].count++;

    // Track zip codes
    if (signerZip && signerZip.length === 5) {
      stateData[signerState].zips[signerZip] = (stateData[signerState].zips[signerZip] || 0) + 1;
    }

    // Track vehicles per state (make + model)
    if (vehicleMake) {
      const brand = normalizeBrand(vehicleMake);
      const vehicleName = model ? `${brand} ${model}` : brand;
      stateData[signerState].vehicles[vehicleName] = (stateData[signerState].vehicles[vehicleName] || 0) + 1;
    }
  }

  // Build salesByState with topVehicles and enriched zip data
  const salesByState: Record<string, { count: number; zips: Record<string, number>; zipGeo: { zip: string; count: number; city: string; lat: number; lng: number }[]; topVehicles: { name: string; count: number }[] }> = {};
  for (const [state, data] of Object.entries(stateData)) {
    const topVehicles = Object.entries(data.vehicles)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
    // Enrich zip codes with lat/lng and city names
    const zipGeo = Object.entries(data.zips)
      .map(([zip, count]) => {
        const info = (zipcodes as any).lookup(zip);
        return {
          zip, count,
          city: info?.city || '',
          lat: info?.latitude || 0,
          lng: info?.longitude || 0,
        };
      })
      .filter(z => z.lat !== 0)
      .sort((a, b) => b.count - a.count);
    salesByState[state] = { count: data.count, zips: data.zips, zipGeo, topVehicles };
  }

  // Build top brands
  const topBrands = Object.entries(overallBrands)
    .map(([name, count]) => ({ name, count, logo: BRAND_LOGOS[name] || '' }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  return { totalSales, salesByState, topBrands };
}

/**
 * Admin — upload CSV or PDF sales report and parse into structured data
 * CSV parsed directly; PDF extracted via Claude
 */
app.post('/api/admin/sales-stats/upload-report', aiLimiter, reportUpload.single('file'), async (req: any, res) => {
  try {
    if (!req.file) { res.status(400).json({ error: 'No file uploaded' }); return; }

    const mime = req.file.mimetype;
    const ext = (req.file.originalname || '').split('.').pop()?.toLowerCase();
    const isCSV = mime === 'text/csv' || mime === 'text/plain' || ext === 'csv';
    const isPDF = mime === 'application/pdf' || ext === 'pdf';
    const isXLS = ext === 'xls' || ext === 'xlsx' || mime.includes('spreadsheet') || mime.includes('ms-excel');

    if (isCSV) {
      // Parse CSV directly
      const raw = req.file.buffer.toString('utf-8');
      const rows = csvParse(raw, { columns: true, skip_empty_lines: true, trim: true, bom: true }) as Record<string, string>[];
      const result = parseSalesReportRows(rows);
      res.json(result);
    } else if (isPDF) {
      // Use Claude to extract structured data from PDF
      const base64 = req.file.buffer.toString('base64');
      const msg = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        messages: [{
          role: 'user',
          content: [
            { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
            { type: 'text', text: `This is a car dealership sales report. Extract every deal/sale row from this document.
Return a JSON array of objects. Each object should have these fields (use empty string if not found):
- "Deal No.": the deal number
- "Signer State": the 2-letter US state code of the buyer
- "Signer Zip": the buyer's zip code
- "Vehicle Make": the vehicle manufacturer/brand (e.g. "Tesla", "BMW", "Toyota")
- "Model": the vehicle model (e.g. "Model Y", "X5", "Camry")
- "Year": the vehicle year

Return ONLY the JSON array, no other text.` }
          ]
        }]
      });

      const text = msg.content[0].type === 'text' ? msg.content[0].text : '';
      // Extract JSON array from response
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        res.status(422).json({ error: 'Could not extract structured data from PDF' });
        return;
      }
      const rows: Record<string, string>[] = JSON.parse(jsonMatch[0]);
      const result = parseSalesReportRows(rows);
      res.json(result);
    } else if (isXLS) {
      // Parse XLS/XLSX — scan for header row containing known columns
      const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
      const allRows: Record<string, string>[] = [];
      for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        const rawRows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
        let headerIdx = 0;
        for (let i = 0; i < Math.min(20, rawRows.length); i++) {
          const rowStr = rawRows[i].map((c: any) => String(c).toLowerCase()).join('|');
          if (rowStr.includes('deal no') || rowStr.includes('signer state') || rowStr.includes('vehicle') || rowStr.includes('delivery date')) {
            headerIdx = i;
            break;
          }
        }
        const rows: Record<string, string>[] = XLSX.utils.sheet_to_json(sheet, { defval: '', range: headerIdx });
        allRows.push(...rows);
      }
      const result = parseSalesReportRows(allRows);
      res.json(result);
    } else {
      res.status(400).json({ error: 'Unsupported file type. Use CSV, PDF, or XLS/XLSX.' });
    }
  } catch (err) {
    console.error('Report upload error:', err);
    res.status(500).json({ error: 'Failed to parse sales report' });
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

// ── Proposal Chat ──────────────────────────────────────────────────────────

/** GET /api/proposal/:id/chat — fetch messages (public, by proposal ID) */
app.get('/api/proposal/:id/chat', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('proposal_messages')
      .select('id, sender, sender_name, message, created_at')
      .eq('proposal_id', req.params['id'])
      .order('created_at', { ascending: true });
    if (error) throw error;
    res.json(data || []);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/proposal/:id/chat — customer sends a message */
app.post('/api/proposal/:id/chat', async (req, res) => {
  try {
    const { message, sender_name } = req.body;
    if (!message?.trim()) { res.status(400).json({ error: 'Message required' }); return; }

    const { data: proposal } = await supabase
      .from('vehicle_proposals')
      .select('id')
      .eq('id', req.params['id'])
      .maybeSingle();
    if (!proposal) { res.status(404).json({ error: 'Proposal not found' }); return; }

    const { data, error } = await supabase.from('proposal_messages').insert({
      proposal_id: req.params['id'],
      sender: 'customer',
      sender_name: sender_name?.trim() || 'Customer',
      message: message.trim(),
    }).select('id, sender, sender_name, message, created_at').single();

    if (error) throw error;
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/admin/proposal/:id/chat — admin sends a reply */
app.post('/api/admin/proposal/:id/chat', requireAdmin, async (req, res) => {
  try {
    const { message } = req.body;
    if (!message?.trim()) { res.status(400).json({ error: 'Message required' }); return; }

    const { data, error } = await supabase.from('proposal_messages').insert({
      proposal_id: req.params['id'],
      sender: 'admin',
      sender_name: 'Big Wave Auto',
      message: message.trim(),
    }).select('id, sender, sender_name, message, created_at').single();

    if (error) throw error;
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/admin/chat/unread — count of proposals with unread customer messages */
app.get('/api/admin/chat/unread', requireAdmin, async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from('proposal_messages')
      .select('proposal_id')
      .eq('sender', 'customer')
      .is('read_at', null);
    if (error) throw error;
    const unique = [...new Set((data || []).map(r => r.proposal_id))];
    res.json({ count: unique.length, proposals: unique });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/admin/proposal/:id/chat/read — mark customer messages as read */
app.post('/api/admin/proposal/:id/chat/read', requireAdmin, async (req, res) => {
  try {
    await supabase
      .from('proposal_messages')
      .update({ read_at: new Date().toISOString() })
      .eq('proposal_id', req.params['id'])
      .eq('sender', 'customer')
      .is('read_at', null);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────
// RIVIAN REPORT
// ─────────────────────────────────────────────

// Public: list active listings
app.get('/api/rivian-report', async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from('rivian_listings')
      .select('id,year,model,trim,mileage,exterior_color,interior_color,mmr,asking_price,buy_now,photos,location,auction_channel,sale_date,condition_grade,source,created_at')
      .eq('status', 'active')
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json(data || []);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// Public: unlock a listing
app.post('/api/rivian-report/unlock', async (req, res) => {
  try {
    const { listing_id, name, email, phone, mindset } = req.body;
    if (!name || (!email && !phone)) {
      res.status(400).json({ error: 'Name and email or phone required' }); return;
    }

    // Fetch listing for email context
    const { data: listing } = await supabase
      .from('rivian_listings')
      .select('year,model,trim,mileage,asking_price,mmr,photos')
      .eq('id', listing_id)
      .single();

    // Store unlock
    await supabase.from('rivian_unlocks').insert({ listing_id, name, email, phone, mindset });

    const vehicle = listing ? `${listing.year || ''} Rivian ${listing.model || ''} ${listing.trim || ''}`.trim() : 'Rivian';
    const price = listing?.asking_price ? `$${Number(listing.asking_price).toLocaleString()}` : '';
    const miles = listing?.mileage ? `${Number(listing.mileage).toLocaleString()} mi` : '';

    // Email to admin
    await resend.emails.send({
      from: FROM_EMAIL,
      to: ['dave@bigwaveauto.com'],
      subject: `🌊 Rivian Report Unlock — ${vehicle}`,
      html: `
        <h2 style="margin:0 0 12px">New Rivian Report Unlock</h2>
        <table style="border-collapse:collapse;font-size:15px">
          <tr><td style="padding:4px 12px 4px 0;color:#64748b">Name</td><td><b>${escHtml(name)}</b></td></tr>
          <tr><td style="padding:4px 12px 4px 0;color:#64748b">Email</td><td>${escHtml(email || '—')}</td></tr>
          <tr><td style="padding:4px 12px 4px 0;color:#64748b">Phone</td><td>${escHtml(phone || '—')}</td></tr>
          <tr><td style="padding:4px 12px 4px 0;color:#64748b">Mindset</td><td>${escHtml(mindset || '—')}</td></tr>
          <tr><td style="padding:4px 12px 4px 0;color:#64748b">Vehicle</td><td><b>${escHtml(vehicle)}</b>${miles ? ' · ' + escHtml(miles) : ''}${price ? ' · ' + escHtml(price) : ''}</td></tr>
        </table>
        <p style="margin:20px 0 0;color:#64748b;font-size:13px">They're waiting for your strategy + all-in price plan.</p>
      `,
    });

    res.json({ ok: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// Admin: bulk ingest from Chrome extension
app.post('/api/admin/rivian/ingest', requireAdmin, async (req, res) => {
  try {
    const listings: any[] = req.body.listings || [];
    if (!listings.length) { res.status(400).json({ error: 'No listings provided' }); return; }

    const rows = listings.map((l: any) => ({
      vin: l.vin || null,
      source: l.source || 'manheim',
      year: l.year ? parseInt(l.year) : null,
      model: l.model || null,
      trim: l.trim || null,
      mileage: l.mileage ? parseInt(String(l.mileage).replace(/\D/g, '')) : null,
      exterior_color: l.exterior_color || l.exteriorColor || null,
      interior_color: l.interior_color || l.interiorColor || null,
      mmr: l.mmr ? parseFloat(String(l.mmr).replace(/[^0-9.]/g, '')) : null,
      asking_price: l.asking_price || l.buy_now || null,
      buy_now: l.buy_now || null,
      photos: Array.isArray(l.photos) ? l.photos.slice(0, 20) : [],
      location: l.location || null,
      auction_channel: l.auction_channel || l.channel || null,
      sale_date: l.sale_date || null,
      condition_grade: l.condition_grade || l.grade || null,
      status: 'active',
    }));

    // Upsert by VIN when available, else insert
    const withVin = rows.filter(r => r.vin);
    const withoutVin = rows.filter(r => !r.vin);

    if (withVin.length) {
      await supabase.from('rivian_listings').upsert(withVin, { onConflict: 'vin', ignoreDuplicates: false });
    }
    if (withoutVin.length) {
      await supabase.from('rivian_listings').insert(withoutVin);
    }

    res.json({ ok: true, ingested: rows.length });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// Admin: list all rivian listings
app.get('/api/admin/rivian', requireAdmin, async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from('rivian_listings')
      .select('*, rivian_unlocks(id,name,email,phone,mindset,created_at)')
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json(data || []);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// Admin: update listing (status, price, notes)
app.patch('/api/admin/rivian/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, asking_price, notes } = req.body;
    const updates: any = {};
    if (status !== undefined) updates.status = status;
    if (asking_price !== undefined) updates.asking_price = asking_price;
    if (notes !== undefined) updates.notes = notes;
    const { error } = await supabase.from('rivian_listings').update(updates).eq('id', id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// Admin: delete listing
app.delete('/api/admin/rivian/:id', requireAdmin, async (req, res) => {
  try {
    const { error } = await supabase.from('rivian_listings').delete().eq('id', req.params['id']);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

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
