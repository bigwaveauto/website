import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  isMainModule,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import express from 'express';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

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

/**
 * Lead form submissions
 */
app.use(express.json());

app.post('/api/leads/financing', async (req, res) => {
  const data = req.body;
  const { error } = await supabase.from('financing_leads').insert(data);
  if (error) { console.error(error); return res.status(500).json({ error: 'Failed to save' }); }

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
      <p><b>Address:</b> ${data.street}, ${data.city}, ${data.state} ${data.zip}</p>
      <p><b>Housing:</b> ${data.housing_status} (${data.years_at_address})</p>
      <p><b>Employment:</b> ${data.employment_status} at ${data.employer_name}</p>
      <p><b>Monthly Income:</b> ${data.monthly_income}</p>
      <p><b>Co-borrower:</b> ${data.coborrower ? 'Yes' : 'No'}</p>
    `
  });
  res.json({ success: true });
});

app.post('/api/leads/trade-in', async (req, res) => {
  const data = req.body;
  const { error } = await supabase.from('trade_in_leads').insert(data);
  if (error) { console.error(error); return res.status(500).json({ error: 'Failed to save' }); }

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
});

app.post('/api/leads/contact', async (req, res) => {
  const data = req.body;
  const { error } = await supabase.from('contact_leads').insert(data);
  if (error) { console.error(error); return res.status(500).json({ error: 'Failed to save' }); }

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
