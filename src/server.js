/**
 * NexaMarket Pro v3.0 — Serveur Production Complet
 * Auth JWT · Base de données JSON persistante · Groq IA
 * WhatsApp Stats · CRM · E-commerce · Finance · Ads
 */

'use strict';

const express    = require('express');
const path       = require('path');
const fs         = require('fs');
const bcrypt     = require('bcryptjs');
const jwt        = require('jsonwebtoken');
const { v4: uuid } = require('uuid');
const fetch      = require('node-fetch');
const cron       = require('node-cron');
const compression = require('compression');
const helmet     = require('helmet');
const morgan     = require('morgan');

const app  = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET  = process.env.JWT_SECRET  || 'nexamarket2026secret';
const GROQ_KEY    = process.env.GROQ_API_KEY || '';
const GROQ_URL    = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL  = 'llama3-70b-8192';

// ── DATA PATH — Résolution robuste pour Railway ──────────
function resolveDataDir() {
  const candidates = [
    process.env.RAILWAY_VOLUME_MOUNT_PATH,
    path.join(__dirname, '../data'),
    '/tmp/nexamarket-data',
  ].filter(Boolean);

  for (const dir of candidates) {
    try {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const testFile = path.join(dir, '.write-test');
      fs.writeFileSync(testFile, 'ok');
      fs.unlinkSync(testFile);
      console.log('✅ DATA_DIR:', dir);
      return dir;
    } catch (e) {
      console.warn('⚠️  Non accessible:', dir, e.code);
    }
  }
  // Dernier recours
  return '/tmp/nexamarket-data';
}
const DATA_DIR = resolveDataDir();

const DB_PATH = path.join(DATA_DIR, 'nexamarket.json');

// ── HELPERS DB ──────────────────────────────────────────
function loadDB() {
  if (!fs.existsSync(DB_PATH)) return initDB();
  try { return JSON.parse(fs.readFileSync(DB_PATH, 'utf8')); }
  catch { return initDB(); }
}

function saveDB(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

function initDB() {
  const db = {
    users: [],
    contacts: [],
    products: [],
    orders: [],
    invoices: [],
    campaigns: [],
    waMessages: [],
    calls: [],
    expenses: [],
    alerts: [],
    settings: {},
    createdAt: new Date().toISOString()
  };

  // Créer Super Admin par défaut
  const hash = bcrypt.hashSync('Admin2026@', 10);
  db.users.push({
    id: uuid(),
    name: 'Super Admin',
    email: 'admin@nexamarket.ma',
    password: hash,
    role: 'superadmin',
    company: 'NexaMarket Pro',
    phone: '+212661234567',
    city: 'Casablanca',
    sector: 'Mode & Vêtements',
    plan: 'enterprise',
    active: true,
    createdAt: new Date().toISOString()
  });

  // Données réelles vides (pas de données au pif)
  saveDB(db);
  console.log('✅ Base de données initialisée');
  console.log('👤 Admin: admin@nexamarket.ma / Admin2026@');
  return db;
}

// ── MIDDLEWARE ──────────────────────────────────────────
app.use(compression());
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(morgan('dev'));
app.use(express.json({ limit: '10mb' }));
// Route principale → app.html (login + application complète)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/app.html'));
});

app.use(express.static(path.join(__dirname, '../public')));

// ── AUTH MIDDLEWARE ─────────────────────────────────────
function auth(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: 'Token manquant' });
  const token = header.replace('Bearer ', '');
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Token invalide ou expiré' });
  }
}

function adminOnly(req, res, next) {
  if (!['admin', 'superadmin'].includes(req.user.role))
    return res.status(403).json({ error: 'Accès administrateur requis' });
  next();
}

// ── GROQ AI ─────────────────────────────────────────────
async function callGroq(messages, maxTokens = 800) {
  if (!GROQ_KEY) throw new Error('Clé GROQ_API_KEY non configurée sur Railway');
  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + GROQ_KEY
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages,
      max_tokens: maxTokens,
      temperature: 0.7
    })
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error('Groq error: ' + err);
  }
  const data = await res.json();
  return data.choices[0].message.content;
}

const SYSTEM_NEXAMARKET = `Tu es l'assistant IA de NexaMarket Pro, plateforme SaaS pour PME marocaines.
Tu parles français et darija marocain selon la langue de l'utilisateur.
Tu es expert en: marketing digital Maroc, Meta Ads, Google Ads, TikTok Ads, 
e-commerce Maroc, WhatsApp Business, gestion stock, facturation marocaine (TVA 20%).
Réponds de façon professionnelle, concise, avec des chiffres précis en MAD.
Ne fais jamais de promesses irréalistes. Sois honnête sur les limites.`;

// ════════════════════════════════════════════════════════
//  ROUTES AUTH
// ════════════════════════════════════════════════════════

// Login
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: 'Email et mot de passe requis' });

  const db = loadDB();
  const user = db.users.find(u => u.email.toLowerCase() === email.toLowerCase());
  if (!user) return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
  if (!user.active) return res.status(403).json({ error: 'Compte désactivé' });

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return res.status(401).json({ error: 'Email ou mot de passe incorrect' });

  const token = jwt.sign(
    { id: user.id, email: user.email, role: user.role, name: user.name },
    JWT_SECRET,
    { expiresIn: '7d' }
  );

  res.json({
    token,
    user: { id: user.id, name: user.name, email: user.email, role: user.role,
            company: user.company, city: user.city, sector: user.sector, plan: user.plan }
  });
});

// Register (premier utilisateur ou superadmin)
app.post('/api/auth/register', async (req, res) => {
  const { name, email, password, company, phone, city, sector } = req.body;
  if (!name || !email || !password)
    return res.status(400).json({ error: 'Nom, email et mot de passe requis' });

  const db = loadDB();
  if (db.users.find(u => u.email.toLowerCase() === email.toLowerCase()))
    return res.status(409).json({ error: 'Email déjà utilisé' });

  const hash = await bcrypt.hash(password, 10);
  const user = {
    id: uuid(), name, email: email.toLowerCase(), password: hash,
    role: db.users.length === 0 ? 'superadmin' : 'user',
    company: company || '', phone: phone || '',
    city: city || 'Casablanca', sector: sector || '',
    plan: 'starter', active: true,
    createdAt: new Date().toISOString()
  };
  db.users.push(user);
  saveDB(db);

  const token = jwt.sign(
    { id: user.id, email: user.email, role: user.role, name: user.name },
    JWT_SECRET, { expiresIn: '7d' }
  );
  res.status(201).json({
    token,
    user: { id: user.id, name: user.name, email: user.email, role: user.role, plan: user.plan }
  });
});

// Me
app.get('/api/auth/me', auth, (req, res) => {
  const db = loadDB();
  const user = db.users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' });
  const { password, ...safe } = user;
  res.json(safe);
});

// Change password
app.put('/api/auth/password', auth, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const db = loadDB();
  const user = db.users.find(u => u.id === req.user.id);
  const valid = await bcrypt.compare(currentPassword, user.password);
  if (!valid) return res.status(400).json({ error: 'Mot de passe actuel incorrect' });
  user.password = await bcrypt.hash(newPassword, 10);
  saveDB(db);
  res.json({ ok: true });
});

// ════════════════════════════════════════════════════════
//  ROUTES DASHBOARD
// ════════════════════════════════════════════════════════
app.get('/api/dashboard', auth, (req, res) => {
  const db = loadDB();
  const uid = req.user.id;

  const myOrders    = db.orders.filter(o => o.userId === uid);
  const myContacts  = db.contacts.filter(c => c.userId === uid);
  const myInvoices  = db.invoices.filter(i => i.userId === uid);
  const myCampaigns = db.campaigns.filter(c => c.userId === uid);
  const myMessages  = db.waMessages.filter(m => m.userId === uid);
  const myExpenses  = db.expenses.filter(e => e.userId === uid);

  // Calculs réels
  const revenue    = myOrders.filter(o => o.status !== 'cancelled').reduce((s, o) => s + (o.total || 0), 0);
  const adSpend    = myCampaigns.reduce((s, c) => s + (c.spent || 0), 0);
  const totalROAS  = adSpend > 0 ? (revenue / adSpend).toFixed(2) : 0;
  const paidInv    = myInvoices.filter(i => i.status === 'paid').reduce((s, i) => s + (i.totalTTC || 0), 0);
  const pendingInv = myInvoices.filter(i => i.status === 'pending').reduce((s, i) => s + (i.totalTTC || 0), 0);
  const hotLeads   = myContacts.filter(c => (c.aiScore || 0) >= 75).length;
  const waAuto     = myMessages.filter(m => m.aiResponse).length;
  const waTotal    = myMessages.length;

  res.json({
    revenue,
    orders:      myOrders.length,
    contacts:    myContacts.length,
    hotLeads,
    adSpend,
    roas:        totalROAS,
    conversion:  myOrders.length > 0 && myContacts.length > 0
                   ? ((myOrders.length / myContacts.length) * 100).toFixed(1) + '%' : '0%',
    waMessages:  waTotal,
    waAutoRate:  waTotal > 0 ? Math.round((waAuto / waTotal) * 100) + '%' : '0%',
    invoicePaid:   paidInv,
    invoicePending: pendingInv,
    campaigns:   myCampaigns.length,
    expenses:    myExpenses.reduce((s, e) => s + (e.amount || 0), 0)
  });
});

// ════════════════════════════════════════════════════════
//  ROUTES CRM — CONTACTS
// ════════════════════════════════════════════════════════
app.get('/api/crm/contacts', auth, (req, res) => {
  const db = loadDB();
  const contacts = db.contacts
    .filter(c => c.userId === req.user.id)
    .sort((a, b) => (b.aiScore || 0) - (a.aiScore || 0));
  res.json({ total: contacts.length, contacts });
});

app.post('/api/crm/contacts', auth, async (req, res) => {
  const { name, email, phone, company, city, source, value, notes } = req.body;
  if (!name) return res.status(400).json({ error: 'Nom requis' });

  // Score IA basé sur les données réelles
  let aiScore = 50;
  if (phone)   aiScore += 10;
  if (email)   aiScore += 8;
  if (company) aiScore += 7;
  if (value && value > 1000) aiScore += 15;
  if (source === 'whatsapp') aiScore += 10;
  aiScore = Math.min(99, aiScore);

  const contact = {
    id: uuid(), userId: req.user.id,
    name, email: email || '', phone: phone || '',
    company: company || '', city: city || '',
    source: source || 'manual', value: value || 0,
    notes: notes || '', aiScore, status: 'new',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  const db = loadDB();
  db.contacts.push(contact);
  saveDB(db);
  res.status(201).json(contact);
});

app.put('/api/crm/contacts/:id', auth, (req, res) => {
  const db = loadDB();
  const idx = db.contacts.findIndex(c => c.id === req.params.id && c.userId === req.user.id);
  if (idx === -1) return res.status(404).json({ error: 'Contact introuvable' });
  db.contacts[idx] = { ...db.contacts[idx], ...req.body, updatedAt: new Date().toISOString() };
  saveDB(db);
  res.json(db.contacts[idx]);
});

app.delete('/api/crm/contacts/:id', auth, (req, res) => {
  const db = loadDB();
  db.contacts = db.contacts.filter(c => !(c.id === req.params.id && c.userId === req.user.id));
  saveDB(db);
  res.json({ ok: true });
});

// ════════════════════════════════════════════════════════
//  ROUTES E-COMMERCE — PRODUITS
// ════════════════════════════════════════════════════════
app.get('/api/ecom/products', auth, (req, res) => {
  const db = loadDB();
  const products = db.products.filter(p => p.userId === req.user.id);
  res.json({ total: products.length, products });
});

app.post('/api/ecom/products', auth, (req, res) => {
  const { name, sku, price, stock, stockAlert, category, description, variants } = req.body;
  if (!name || !price) return res.status(400).json({ error: 'Nom et prix requis' });

  const product = {
    id: uuid(), userId: req.user.id,
    name, sku: sku || 'SKU-' + Date.now(),
    price: parseFloat(price), stock: parseInt(stock) || 0,
    stockAlert: parseInt(stockAlert) || 10,
    category: category || 'Général',
    description: description || '',
    variants: variants || [],
    active: true,
    createdAt: new Date().toISOString()
  };

  const db = loadDB();
  db.products.push(product);
  saveDB(db);
  res.status(201).json(product);
});

app.put('/api/ecom/products/:id', auth, (req, res) => {
  const db = loadDB();
  const idx = db.products.findIndex(p => p.id === req.params.id && p.userId === req.user.id);
  if (idx === -1) return res.status(404).json({ error: 'Produit introuvable' });
  db.products[idx] = { ...db.products[idx], ...req.body, updatedAt: new Date().toISOString() };
  saveDB(db);
  res.json(db.products[idx]);
});

app.delete('/api/ecom/products/:id', auth, (req, res) => {
  const db = loadDB();
  db.products = db.products.filter(p => !(p.id === req.params.id && p.userId === req.user.id));
  saveDB(db);
  res.json({ ok: true });
});

// ════════════════════════════════════════════════════════
//  ROUTES COMMANDES
// ════════════════════════════════════════════════════════
app.get('/api/ecom/orders', auth, (req, res) => {
  const db = loadDB();
  const orders = db.orders
    .filter(o => o.userId === req.user.id)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ total: orders.length, orders });
});

app.post('/api/ecom/orders', auth, (req, res) => {
  const { contactId, contactName, items, paymentMethod, address, notes } = req.body;
  if (!items || items.length === 0) return res.status(400).json({ error: 'Articles requis' });

  const db = loadDB();

  // Calculer le total
  let subtotal = 0;
  const orderItems = items.map(item => {
    const product = db.products.find(p => p.id === item.productId);
    const price   = product ? product.price : (item.price || 0);
    const qty     = item.qty || 1;
    subtotal += price * qty;

    // Déduire du stock
    if (product) {
      const pidx = db.products.findIndex(p => p.id === product.id);
      db.products[pidx].stock = Math.max(0, (db.products[pidx].stock || 0) - qty);
      // Alerte stock
      if (db.products[pidx].stock <= db.products[pidx].stockAlert) {
        db.alerts.push({
          id: uuid(), userId: req.user.id, type: 'warning',
          msg: `Stock critique: ${product.name} (${db.products[pidx].stock} restants)`,
          read: false, createdAt: new Date().toISOString()
        });
      }
    }
    return { productId: item.productId, name: item.name || product?.name, price, qty, total: price * qty };
  });

  const tva   = subtotal * 0.20;
  const total = subtotal + tva;
  const orderNumber = 'CMD-' + new Date().getFullYear() + '-' + String(db.orders.length + 1).padStart(4, '0');

  const order = {
    id: uuid(), userId: req.user.id,
    orderNumber, contactId: contactId || null,
    contactName: contactName || 'Client', items: orderItems,
    subtotal: Math.round(subtotal * 100) / 100,
    tva: Math.round(tva * 100) / 100,
    total: Math.round(total * 100) / 100,
    paymentMethod: paymentMethod || 'cash',
    address: address || '', notes: notes || '',
    status: 'pending', source: 'web',
    createdAt: new Date().toISOString()
  };

  db.orders.push(order);
  saveDB(db);
  res.status(201).json(order);
});

app.patch('/api/ecom/orders/:id/status', auth, (req, res) => {
  const db = loadDB();
  const idx = db.orders.findIndex(o => o.id === req.params.id && o.userId === req.user.id);
  if (idx === -1) return res.status(404).json({ error: 'Commande introuvable' });
  db.orders[idx].status = req.body.status;
  db.orders[idx].updatedAt = new Date().toISOString();
  saveDB(db);
  res.json(db.orders[idx]);
});

// ════════════════════════════════════════════════════════
//  ROUTES FACTURATION
// ════════════════════════════════════════════════════════
app.get('/api/billing/invoices', auth, (req, res) => {
  const db = loadDB();
  const invoices = db.invoices
    .filter(i => i.userId === req.user.id)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ total: invoices.length, invoices });
});

app.post('/api/billing/invoices', auth, (req, res) => {
  const { type, contactId, contactName, contactAddress, items, discount, notes, dueDate } = req.body;
  if (!items || items.length === 0) return res.status(400).json({ error: 'Articles requis' });

  const db = loadDB();
  const prefix = type === 'devis' ? 'DEV' : type === 'avoir' ? 'AVO' : 'FAC';
  const count  = db.invoices.filter(i => i.userId === req.user.id && i.type === (type || 'invoice')).length + 1;
  const invoiceNo = `${prefix}-${new Date().getFullYear()}-${String(count).padStart(4, '0')}`;

  let subtotalHT = 0;
  const invoiceItems = items.map(item => {
    const ht = (item.price || 0) * (item.qty || 1);
    subtotalHT += ht;
    return { ...item, total: ht };
  });

  const discountAmt = discount ? (subtotalHT * discount / 100) : 0;
  const netHT       = subtotalHT - discountAmt;
  const tva         = netHT * 0.20;
  const totalTTC    = netHT + tva;

  const invoice = {
    id: uuid(), userId: req.user.id,
    invoiceNo, type: type || 'invoice',
    contactId: contactId || null,
    contactName: contactName || '', contactAddress: contactAddress || '',
    items: invoiceItems,
    subtotalHT:  Math.round(subtotalHT * 100) / 100,
    discount:    discount || 0,
    discountAmt: Math.round(discountAmt * 100) / 100,
    netHT:       Math.round(netHT * 100) / 100,
    tvaRate:     20,
    tva:         Math.round(tva * 100) / 100,
    totalTTC:    Math.round(totalTTC * 100) / 100,
    notes:       notes || 'Paiement sous 15 jours. Merci pour votre confiance.',
    dueDate:     dueDate || null,
    status: type === 'devis' ? 'sent' : 'pending',
    createdAt: new Date().toISOString()
  };

  db.invoices.push(invoice);
  saveDB(db);
  res.status(201).json(invoice);
});

app.patch('/api/billing/invoices/:id/status', auth, (req, res) => {
  const db = loadDB();
  const idx = db.invoices.findIndex(i => i.id === req.params.id && i.userId === req.user.id);
  if (idx === -1) return res.status(404).json({ error: 'Facture introuvable' });
  db.invoices[idx].status    = req.body.status;
  db.invoices[idx].updatedAt = new Date().toISOString();
  saveDB(db);
  res.json(db.invoices[idx]);
});

// ════════════════════════════════════════════════════════
//  ROUTES CAMPAGNES ADS
// ════════════════════════════════════════════════════════
app.get('/api/ads/campaigns', auth, (req, res) => {
  const db = loadDB();
  const campaigns = db.campaigns.filter(c => c.userId === req.user.id);
  res.json({ total: campaigns.length, campaigns });
});

app.post('/api/ads/campaigns', auth, (req, res) => {
  const { name, platform, objective, budget, startDate, endDate, targeting, description } = req.body;
  if (!name || !platform || !budget) return res.status(400).json({ error: 'Nom, plateforme et budget requis' });

  const campaign = {
    id: uuid(), userId: req.user.id,
    name, platform, objective: objective || 'conversions',
    budget: parseFloat(budget), spent: 0,
    impressions: 0, clicks: 0, conversions: 0,
    roas: 0, ctr: 0, cpa: 0,
    targeting: targeting || {}, description: description || '',
    startDate: startDate || new Date().toISOString().split('T')[0],
    endDate: endDate || null,
    status: 'active',
    createdAt: new Date().toISOString()
  };

  const db = loadDB();
  db.campaigns.push(campaign);
  saveDB(db);
  res.status(201).json(campaign);
});

app.put('/api/ads/campaigns/:id', auth, (req, res) => {
  const db = loadDB();
  const idx = db.campaigns.findIndex(c => c.id === req.params.id && c.userId === req.user.id);
  if (idx === -1) return res.status(404).json({ error: 'Campagne introuvable' });
  db.campaigns[idx] = { ...db.campaigns[idx], ...req.body, updatedAt: new Date().toISOString() };
  saveDB(db);
  res.json(db.campaigns[idx]);
});

// ════════════════════════════════════════════════════════
//  ROUTES WHATSAPP
// ════════════════════════════════════════════════════════
app.get('/api/wa/messages', auth, (req, res) => {
  const db = loadDB();
  const messages = db.waMessages
    .filter(m => m.userId === req.user.id)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 100);
  res.json({ total: db.waMessages.filter(m => m.userId === req.user.id).length, messages });
});

app.post('/api/wa/messages', auth, (req, res) => {
  const { contactName, contactPhone, body, direction } = req.body;
  if (!body) return res.status(400).json({ error: 'Message requis' });

  const message = {
    id: uuid(), userId: req.user.id,
    contactName: contactName || 'Inconnu',
    contactPhone: contactPhone || '',
    body, direction: direction || 'in',
    aiResponse: false, status: 'received',
    createdAt: new Date().toISOString()
  };

  const db = loadDB();
  db.waMessages.push(message);
  saveDB(db);
  res.status(201).json(message);
});

app.get('/api/wa/stats', auth, (req, res) => {
  const db = loadDB();
  const msgs = db.waMessages.filter(m => m.userId === req.user.id);
  const today = new Date().toISOString().split('T')[0];
  const todayMsgs = msgs.filter(m => m.createdAt.startsWith(today));
  const aiResponses = msgs.filter(m => m.aiResponse).length;

  res.json({
    total: msgs.length,
    today: todayMsgs.length,
    aiResponses,
    aiRate: msgs.length > 0 ? Math.round((aiResponses / msgs.length) * 100) + '%' : '0%',
    inbound:  msgs.filter(m => m.direction === 'in').length,
    outbound: msgs.filter(m => m.direction === 'out').length
  });
});

// ════════════════════════════════════════════════════════
//  ROUTES FINANCE
// ════════════════════════════════════════════════════════
app.get('/api/finance/dashboard', auth, (req, res) => {
  const db = loadDB();
  const uid = req.user.id;

  const orders   = db.orders.filter(o => o.userId === uid && o.status !== 'cancelled');
  const expenses = db.expenses.filter(e => e.userId === uid);
  const invoices = db.invoices.filter(i => i.userId === uid);

  const revenue      = orders.reduce((s, o) => s + (o.total || 0), 0);
  const totalExpenses = expenses.reduce((s, e) => s + (e.amount || 0), 0);
  const profit       = revenue - totalExpenses;
  const margin       = revenue > 0 ? ((profit / revenue) * 100).toFixed(1) : 0;

  const paid    = invoices.filter(i => i.status === 'paid').reduce((s, i) => s + (i.totalTTC || 0), 0);
  const pending = invoices.filter(i => i.status === 'pending').reduce((s, i) => s + (i.totalTTC || 0), 0);
  const overdue = invoices.filter(i => i.status === 'overdue').reduce((s, i) => s + (i.totalTTC || 0), 0);

  // Regrouper par mois
  const monthly = {};
  orders.forEach(o => {
    const month = o.createdAt.substring(0, 7);
    monthly[month] = (monthly[month] || 0) + (o.total || 0);
  });

  res.json({
    revenue:        Math.round(revenue * 100) / 100,
    expenses:       Math.round(totalExpenses * 100) / 100,
    profit:         Math.round(profit * 100) / 100,
    margin:         parseFloat(margin),
    invoicePaid:    Math.round(paid * 100) / 100,
    invoicePending: Math.round(pending * 100) / 100,
    invoiceOverdue: Math.round(overdue * 100) / 100,
    monthlyRevenue: monthly
  });
});

app.get('/api/finance/expenses', auth, (req, res) => {
  const db = loadDB();
  const expenses = db.expenses
    .filter(e => e.userId === req.user.id)
    .sort((a, b) => new Date(b.date) - new Date(a.date));
  res.json({ total: expenses.length, expenses });
});

app.post('/api/finance/expenses', auth, (req, res) => {
  const { category, description, amount, date } = req.body;
  if (!amount || !category) return res.status(400).json({ error: 'Catégorie et montant requis' });

  const expense = {
    id: uuid(), userId: req.user.id,
    category, description: description || '',
    amount: parseFloat(amount),
    date: date || new Date().toISOString().split('T')[0],
    createdAt: new Date().toISOString()
  };

  const db = loadDB();
  db.expenses.push(expense);
  saveDB(db);
  res.status(201).json(expense);
});

// ════════════════════════════════════════════════════════
//  ROUTES IA GROQ — VRAIE IA
// ════════════════════════════════════════════════════════

// Chat IA général
app.post('/api/ai/chat', auth, async (req, res) => {
  const { message, context } = req.body;
  if (!message) return res.status(400).json({ error: 'Message requis' });

  try {
    const db = loadDB();
    const uid = req.user.id;

    // Contexte réel de l'utilisateur
    const myRevenue  = db.orders.filter(o => o.userId === uid).reduce((s, o) => s + (o.total || 0), 0);
    const myContacts = db.contacts.filter(c => c.userId === uid).length;
    const myProducts = db.products.filter(p => p.userId === uid).length;

    const systemWithContext = SYSTEM_NEXAMARKET + `\n\nContexte réel de l'utilisateur:
- Nom: ${req.user.name}
- Entreprise: ${req.user.company || 'Non renseigné'}
- Secteur: ${req.user.sector || 'Non renseigné'}
- CA total: ${myRevenue} MAD
- Contacts CRM: ${myContacts}
- Produits: ${myProducts}
${context ? '- Contexte additionnel: ' + context : ''}`;

    const reply = await callGroq([
      { role: 'system', content: systemWithContext },
      { role: 'user', content: message }
    ], 1000);

    res.json({ reply, model: GROQ_MODEL });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Analyse financière IA
app.get('/api/ai/finance', auth, async (req, res) => {
  try {
    const db  = loadDB();
    const uid = req.user.id;

    const orders   = db.orders.filter(o => o.userId === uid);
    const expenses = db.expenses.filter(e => e.userId === uid);
    const campaigns = db.campaigns.filter(c => c.userId === uid);

    const revenue   = orders.reduce((s, o) => s + (o.total || 0), 0);
    const totalExp  = expenses.reduce((s, e) => s + (e.amount || 0), 0);
    const adSpend   = campaigns.reduce((s, c) => s + (c.spent || 0), 0);

    const prompt = `Analyse financière pour ${req.user.name} (${req.user.sector || 'PME Maroc'}):
- Chiffre d'affaires total: ${revenue.toFixed(2)} MAD
- Dépenses totales: ${totalExp.toFixed(2)} MAD  
- Dépenses publicitaires: ${adSpend.toFixed(2)} MAD
- Nombre de commandes: ${orders.length}
- Nombre de campagnes: ${campaigns.length}

Donne une analyse professionnelle avec:
1. Évaluation de la rentabilité
2. Points forts et points faibles
3. 3 recommandations concrètes pour améliorer le CA
4. Prévision réaliste pour le prochain mois`;

    const analysis = await callGroq([
      { role: 'system', content: SYSTEM_NEXAMARKET },
      { role: 'user', content: prompt }
    ], 1200);

    res.json({ analysis, model: GROQ_MODEL, dataPoints: { revenue, expenses: totalExp, adSpend } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Génération contenu IA
app.post('/api/ai/content', auth, async (req, res) => {
  const { type, product, platform, language, tone, extras } = req.body;
  if (!product || !type) return res.status(400).json({ error: 'Type et produit requis' });

  try {
    const lang = language === 'dar' ? 'darija marocain' : language === 'ar' ? 'arabe classique' : 'français';

    const prompts = {
      social: `Crée une publication ${platform || 'Facebook'} en ${lang} pour: "${product}".
Ton: ${tone || 'promotionnel'}. Extras: ${extras || ''}.
Format: texte accrocheur + emojis + hashtags pertinents Maroc.`,

      email: `Crée un email marketing professionnel en ${lang} pour: "${product}".
Inclure: objet percutant, corps persuasif, CTA clair.`,

      sms: `Crée un SMS marketing en ${lang} pour: "${product}". Max 160 caractères.
Direct, promotionnel, avec CTA.`,

      product: `Crée une fiche produit complète en ${lang} pour: "${product}".
Inclure: description, caractéristiques, avantages, prix suggéré, mots-clés SEO.`,

      video: `Crée un script vidéo de 30 secondes en ${lang} pour: "${product}".
Format: [Intro 0-5s] [Problème 5-15s] [Solution 15-25s] [CTA 25-30s]`
    };

    const content = await callGroq([
      { role: 'system', content: SYSTEM_NEXAMARKET },
      { role: 'user', content: prompts[type] || prompts.social }
    ], 800);

    res.json({ content, type, language, model: GROQ_MODEL });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Score lead IA
app.post('/api/ai/score-lead', auth, async (req, res) => {
  const { contactId } = req.body;
  try {
    const db = loadDB();
    const contact = db.contacts.find(c => c.id === contactId && c.userId === req.user.id);
    if (!contact) return res.status(404).json({ error: 'Contact introuvable' });

    const orders = db.orders.filter(o => o.contactId === contactId);
    const messages = db.waMessages.filter(m => m.contactPhone === contact.phone);

    const prompt = `Score ce prospect pour une PME marocaine (secteur: ${req.user.sector || 'commerce'}):
- Nom: ${contact.name}
- Source: ${contact.source}
- Valeur estimée: ${contact.value || 0} MAD
- Commandes passées: ${orders.length}
- Messages WhatsApp: ${messages.length}
- Ville: ${contact.city || 'Non précisée'}
- Notes: ${contact.notes || 'Aucune'}

Réponds en JSON uniquement:
{"score": 0-100, "label": "Chaud/Tiède/Froid", "probability": 0-100, "action": "action recommandée", "reason": "explication courte"}`;

    const raw = await callGroq([
      { role: 'system', content: 'Tu es un expert CRM. Réponds uniquement en JSON valide, sans markdown.' },
      { role: 'user', content: prompt }
    ], 300);

    let result;
    try { result = JSON.parse(raw.replace(/```json|```/g, '').trim()); }
    catch { result = { score: contact.aiScore || 50, label: 'Tiède', probability: 50, action: 'Relancer', reason: 'Données insuffisantes' }; }

    // Mettre à jour le score dans la DB
    const idx = db.contacts.findIndex(c => c.id === contactId);
    db.contacts[idx].aiScore = result.score;
    db.contacts[idx].aiLabel = result.label;
    saveDB(db);

    res.json({ ...result, model: GROQ_MODEL });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Réponse WhatsApp IA
app.post('/api/ai/wa-reply', auth, async (req, res) => {
  const { message, contactName, language } = req.body;
  if (!message) return res.status(400).json({ error: 'Message requis' });

  try {
    const db = loadDB();
    const products = db.products.filter(p => p.userId === req.user.id).slice(0, 10);
    const user     = db.users.find(u => u.id === req.user.id);

    const lang = language === 'dar' ? 'darija marocain' : language === 'ar' ? 'arabe' : 'français';

    const prompt = `Tu es l'assistant WhatsApp de "${user?.company || 'notre boutique'}".
Réponds en ${lang} à ce message client de "${contactName || 'le client'}":

"${message}"

Produits disponibles: ${products.map(p => `${p.name} (${p.price} MAD, stock: ${p.stock})`).join(', ') || 'Consultez notre catalogue'}

Règles:
- Réponse naturelle et chaleureuse
- Maximum 3 phrases
- Si commande: confirmer et demander l'adresse
- Si question prix: donner le prix exact
- Finir avec une invitation à agir`;

    const reply = await callGroq([
      { role: 'system', content: SYSTEM_NEXAMARKET },
      { role: 'user', content: prompt }
    ], 300);

    res.json({ reply, model: GROQ_MODEL });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Test IA
app.get('/api/ai/test', auth, async (req, res) => {
  try {
    const reply = await callGroq([
      { role: 'user', content: 'Réponds uniquement: "NexaMarket IA OK - Groq connecté"' }
    ], 30);
    res.json({ ok: true, reply, model: GROQ_MODEL });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ════════════════════════════════════════════════════════
//  ROUTES ALERTES
// ════════════════════════════════════════════════════════
app.get('/api/alerts', auth, (req, res) => {
  const db = loadDB();
  const alerts = db.alerts
    .filter(a => a.userId === req.user.id)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 50);
  const unread = alerts.filter(a => !a.read).length;
  res.json({ unread, alerts });
});

app.patch('/api/alerts/:id/read', auth, (req, res) => {
  const db = loadDB();
  const idx = db.alerts.findIndex(a => a.id === req.params.id && a.userId === req.user.id);
  if (idx !== -1) { db.alerts[idx].read = true; saveDB(db); }
  res.json({ ok: true });
});

app.patch('/api/alerts/read-all', auth, (req, res) => {
  const db = loadDB();
  db.alerts.forEach(a => { if (a.userId === req.user.id) a.read = true; });
  saveDB(db);
  res.json({ ok: true });
});

// ════════════════════════════════════════════════════════
//  ROUTES SETTINGS
// ════════════════════════════════════════════════════════
app.put('/api/settings/profile', auth, async (req, res) => {
  const { name, company, phone, city, sector } = req.body;
  const db = loadDB();
  const idx = db.users.findIndex(u => u.id === req.user.id);
  if (idx === -1) return res.status(404).json({ error: 'Utilisateur introuvable' });
  db.users[idx] = { ...db.users[idx], name, company, phone, city, sector, updatedAt: new Date().toISOString() };
  saveDB(db);
  res.json({ ok: true, user: db.users[idx] });
});

// ════════════════════════════════════════════════════════
//  ADMIN ROUTES
// ════════════════════════════════════════════════════════
app.get('/api/admin/users', auth, adminOnly, (req, res) => {
  const db = loadDB();
  const users = db.users.map(({ password, ...u }) => u);
  res.json({ total: users.length, users });
});

app.post('/api/admin/users', auth, adminOnly, async (req, res) => {
  const { name, email, password, role, plan, company } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'Nom, email, mot de passe requis' });

  const db = loadDB();
  if (db.users.find(u => u.email.toLowerCase() === email.toLowerCase()))
    return res.status(409).json({ error: 'Email déjà utilisé' });

  const hash = await bcrypt.hash(password, 10);

  // Calculer la date d'expiration selon le plan
  const planDays = { demo: 1, '30j': 30, '1an': 365, avie: null };
  const chosenPlan = plan || '30j';
  let planExpiry = null;
  if (planDays[chosenPlan] !== null && planDays[chosenPlan] !== undefined) {
    const exp = new Date();
    exp.setDate(exp.getDate() + (planDays[chosenPlan] || 30));
    planExpiry = exp.toISOString();
  }

  const user = {
    id: uuid(), name, email: email.toLowerCase(), password: hash,
    role: role || 'user', plan: chosenPlan, planExpiry,
    company: company || '', phone: phone || '',
    city: city || 'Casablanca', sector: sector || '',
    active: true,
    createdAt: new Date().toISOString()
  };
  db.users.push(user);
  saveDB(db);
  const { password: _, ...safe } = user;
  res.status(201).json(safe);
});

app.patch('/api/admin/users/:id/toggle', auth, adminOnly, (req, res) => {
  const db = loadDB();
  const idx = db.users.findIndex(u => u.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Utilisateur introuvable' });
  db.users[idx].active = !db.users[idx].active;
  saveDB(db);
  res.json({ ok: true, active: db.users[idx].active });
});


// ── RESET PASSWORD (super admin) ──────────────────────────
app.patch('/api/admin/users/:id/reset-password', auth, adminOnly, async (req, res) => {
  const { newPassword } = req.body;
  if (!newPassword || newPassword.length < 6)
    return res.status(400).json({ error: 'Mot de passe trop court (min 6 caracteres)' });
  const db = loadDB();
  const idx = db.users.findIndex(u => u.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Utilisateur introuvable' });
  db.users[idx].password = await bcrypt.hash(newPassword, 10);
  db.users[idx].updatedAt = new Date().toISOString();
  saveDB(db);
  res.json({ ok: true });
});

// ── UPDATE PLAN ────────────────────────────────────────────
app.patch('/api/admin/users/:id/plan', auth, adminOnly, (req, res) => {
  const { plan } = req.body;
  const planDays = { demo: 1, '30j': 30, '1an': 365, avie: null };
  if (!(plan in planDays)) return res.status(400).json({ error: 'Plan invalide' });
  const db  = loadDB();
  const idx = db.users.findIndex(u => u.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Utilisateur introuvable' });
  db.users[idx].plan = plan;
  if (planDays[plan] !== null) {
    const exp = new Date();
    exp.setDate(exp.getDate() + planDays[plan]);
    db.users[idx].planExpiry = exp.toISOString();
  } else {
    db.users[idx].planExpiry = null;
  }
  db.users[idx].updatedAt = new Date().toISOString();
  saveDB(db);
  res.json({ ok: true, plan: db.users[idx].plan, planExpiry: db.users[idx].planExpiry });
});


// ════════════════════════════════════════════════════════
//  HEALTH CHECK & STATIC
// ════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════
//  YOUCAN INTEGRATION — Module optionnel
//  Si YOUCAN_API_KEY configuré → actif
//  Sinon → l'app fonctionne normalement
// ════════════════════════════════════════════════════════

const YOUCAN_KEY       = process.env.YOUCAN_API_KEY       || '';
const YOUCAN_SECRET    = process.env.YOUCAN_WEBHOOK_SECRET || '';
const YOUCAN_STORE     = process.env.YOUCAN_STORE_URL     || process.env.YOUCAN_STORE_NAME || '';
const YOUCAN_SELLER_ID = process.env.YOUCAN_SELLER_ID     || '';
const YOUCAN_CLIENT_SECRET = process.env.YOUCAN_CLIENT_SECRET || '';
const YOUCAN_BASE      = 'https://api.youcan.shop/store/v1';
const YOUCAN_BASE2     = 'https://seller-area.youcan.shop/api';

// ── Vérifier si YouCan est configuré ──────────────────
app.get('/api/youcan/status', auth, (req, res) => {
  const connected = !!(YOUCAN_SELLER_ID || (YOUCAN_KEY && YOUCAN_STORE));
  res.json({
    connected,
    store:     YOUCAN_STORE || null,
    sellerId:  YOUCAN_SELLER_ID || null,
    features:  connected ? ['orders','products','customers','webhooks'] : [],
    message:   connected
      ? 'YouCan connecté ✅ — Boutique: ' + (YOUCAN_STORE || 'usmarket1')
      : 'YouCan non configuré — Ajoutez YOUCAN_SELLER_ID sur Railway pour activer'
  });
});

// ── Récupérer les commandes YouCan ────────────────────
app.get('/api/youcan/orders', auth, async (req, res) => {
  const ycConnected = !!(YOUCAN_SELLER_ID || YOUCAN_KEY);
  if (!ycConnected) return res.json({ connected: false, orders: [], message: 'YouCan non configuré' });
  try {
    const authHeader = YOUCAN_CLIENT_SECRET
      ? 'Bearer ' + YOUCAN_CLIENT_SECRET
      : 'Bearer ' + YOUCAN_KEY;
    const apiUrl = YOUCAN_SELLER_ID
      ? `${YOUCAN_BASE2}/orders?limit=50`
      : `${YOUCAN_BASE}/orders?limit=50`;
    const r = await fetch(apiUrl, {
      headers: { Authorization: authHeader, Accept: 'application/json', 'X-Seller-Id': YOUCAN_SELLER_ID }
    });
    if (!r.ok) throw new Error('YouCan API error: ' + r.status);
    const data = await r.json();
    res.json({ connected: true, orders: data.data || data.orders || [] });
  } catch (e) {
    res.status(500).json({ connected: false, error: e.message });
  }
});

// ── Récupérer les produits YouCan ─────────────────────
app.get('/api/youcan/products', auth, async (req, res) => {
  if (!YOUCAN_KEY) return res.json({ connected: false, products: [], message: 'YouCan non configuré' });
  try {
    const r = await fetch(`${YOUCAN_BASE}/products?limit=100`, {
      headers: { Authorization: 'Bearer ' + YOUCAN_KEY, Accept: 'application/json' }
    });
    if (!r.ok) throw new Error('YouCan API error: ' + r.status);
    const data = await r.json();
    res.json({ connected: true, products: data.data || data.products || [] });
  } catch (e) {
    res.status(500).json({ connected: false, error: e.message });
  }
});

// ── Récupérer les clients YouCan ──────────────────────
app.get('/api/youcan/customers', auth, async (req, res) => {
  if (!YOUCAN_KEY) return res.json({ connected: false, customers: [], message: 'YouCan non configuré' });
  try {
    const r = await fetch(`${YOUCAN_BASE}/customers?limit=100`, {
      headers: { Authorization: 'Bearer ' + YOUCAN_KEY, Accept: 'application/json' }
    });
    if (!r.ok) throw new Error('YouCan API error: ' + r.status);
    const data = await r.json();
    res.json({ connected: true, customers: data.data || data.customers || [] });
  } catch (e) {
    res.status(500).json({ connected: false, error: e.message });
  }
});

// ── Synchroniser commandes YouCan → NexaMarket ────────
app.post('/api/youcan/sync-orders', auth, async (req, res) => {
  if (!YOUCAN_KEY) return res.json({ connected: false, synced: 0, message: 'YouCan non configuré' });
  try {
    const r = await fetch(`${YOUCAN_BASE}/orders?limit=50&status=confirmed`, {
      headers: { Authorization: 'Bearer ' + YOUCAN_KEY, Accept: 'application/json' }
    });
    if (!r.ok) throw new Error('YouCan API error: ' + r.status);
    const data  = await r.json();
    const ycOrders = data.data || data.orders || [];
    const db    = loadDB();
    let synced  = 0;
    let contacts = 0;

    for (const yco of ycOrders) {
      // Éviter les doublons
      const exists = db.orders.find(o => o.youcanId === yco.id);
      if (exists) continue;

      // Créer le contact client si nouveau
      const customerPhone = yco.customer?.phone || yco.billing?.phone || '';
      const customerName  = yco.customer?.first_name
        ? yco.customer.first_name + ' ' + (yco.customer.last_name || '')
        : yco.billing?.first_name + ' ' + (yco.billing?.last_name || '') || 'Client YouCan';
      const customerEmail = yco.customer?.email || yco.billing?.email || '';

      let contactId = null;
      const existContact = db.contacts.find(c => c.userId === req.user.id && (c.email === customerEmail || c.phone === customerPhone));
      if (!existContact && customerName.trim()) {
        const newContact = {
          id: uuid(), userId: req.user.id,
          name: customerName.trim(), email: customerEmail,
          phone: customerPhone, company: '', city: yco.shipping?.city || '',
          source: 'youcan', value: parseFloat(yco.total || 0),
          notes: 'Client YouCan — importé automatiquement',
          aiScore: 70, status: 'customer',
          createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
        };
        db.contacts.push(newContact);
        contactId = newContact.id;
        contacts++;
      } else if (existContact) {
        contactId = existContact.id;
      }

      // Créer la commande
      const items = (yco.items || yco.line_items || []).map(item => ({
        name:  item.name || item.title || 'Produit',
        price: parseFloat(item.price || 0),
        qty:   parseInt(item.quantity || 1),
        total: parseFloat(item.price || 0) * parseInt(item.quantity || 1)
      }));

      const total    = parseFloat(yco.total || 0);
      const subtotal = total / 1.20;
      const tva      = total - subtotal;

      const order = {
        id:          uuid(),
        userId:      req.user.id,
        youcanId:    yco.id,
        orderNumber: 'YC-' + (yco.number || yco.id?.slice(-6) || Date.now()),
        contactId,
        contactName: customerName.trim(),
        items,
        subtotal:    Math.round(subtotal * 100) / 100,
        tva:         Math.round(tva * 100) / 100,
        total:       Math.round(total * 100) / 100,
        paymentMethod: yco.payment_method || 'youcan',
        address:     [yco.shipping?.address1, yco.shipping?.city, yco.shipping?.country].filter(Boolean).join(', '),
        status:      yco.status === 'confirmed' ? 'confirmed' : yco.status || 'pending',
        source:      'youcan',
        createdAt:   yco.created_at || new Date().toISOString()
      };
      db.orders.push(order);

      // Déduire du stock si produit trouvé
      for (const item of items) {
        const pidx = db.products.findIndex(p => p.userId === req.user.id && p.name.toLowerCase() === item.name.toLowerCase());
        if (pidx !== -1) {
          db.products[pidx].stock = Math.max(0, (db.products[pidx].stock || 0) - item.qty);
        }
      }
      synced++;
    }

    if (synced > 0 || contacts > 0) {
      saveDB(db);
      // Alerte de synchro
      db.alerts.push({
        id: uuid(), userId: req.user.id, type: 'info',
        msg: `YouCan sync: ${synced} commandes + ${contacts} nouveaux contacts importés`,
        read: false, createdAt: new Date().toISOString()
      });
      saveDB(db);
    }

    res.json({ connected: true, synced, contacts, message: `${synced} commandes et ${contacts} contacts synchronisés depuis YouCan` });
  } catch (e) {
    res.status(500).json({ connected: false, error: e.message });
  }
});

// ── Synchroniser produits YouCan → NexaMarket ─────────
app.post('/api/youcan/sync-products', auth, async (req, res) => {
  if (!YOUCAN_KEY) return res.json({ connected: false, synced: 0, message: 'YouCan non configuré' });
  try {
    const r = await fetch(`${YOUCAN_BASE}/products?limit=200`, {
      headers: { Authorization: 'Bearer ' + YOUCAN_KEY, Accept: 'application/json' }
    });
    if (!r.ok) throw new Error('YouCan API error: ' + r.status);
    const data    = await r.json();
    const ycProds = data.data || data.products || [];
    const db      = loadDB();
    let synced    = 0;

    for (const ycp of ycProds) {
      const exists = db.products.find(p => p.userId === req.user.id && p.youcanId === ycp.id);
      if (exists) {
        // Mettre à jour le stock
        const idx = db.products.findIndex(p => p.youcanId === ycp.id);
        db.products[idx].stock = ycp.quantity || ycp.stock || 0;
        db.products[idx].price = parseFloat(ycp.price || 0);
        synced++;
        continue;
      }
      const product = {
        id:        uuid(),
        userId:    req.user.id,
        youcanId:  ycp.id,
        name:      ycp.name || ycp.title || 'Produit YouCan',
        sku:       ycp.sku || 'YC-' + ycp.id?.slice(-6),
        price:     parseFloat(ycp.price || 0),
        stock:     parseInt(ycp.quantity || ycp.stock || 0),
        stockAlert: 10,
        category:  ycp.category?.name || 'YouCan',
        description: ycp.description || '',
        images:    ycp.images || [],
        active:    true,
        source:    'youcan',
        createdAt: new Date().toISOString()
      };
      db.products.push(product);
      synced++;
    }

    saveDB(db);
    res.json({ connected: true, synced, message: synced + ' produits synchronisés depuis YouCan' });
  } catch (e) {
    res.status(500).json({ connected: false, error: e.message });
  }
});

// ── WEBHOOK YouCan — reçoit les événements en temps réel
app.post('/api/webhooks/youcan', async (req, res) => {
  // Vérification optionnelle de la signature
  if (YOUCAN_SECRET) {
    const sig = req.headers['x-youcan-signature'] || req.headers['x-hub-signature-256'] || '';
    const crypto = require('crypto');
    const expected = 'sha256=' + crypto.createHmac('sha256', YOUCAN_SECRET).update(JSON.stringify(req.body)).digest('hex');
    if (sig && sig !== expected) return res.status(401).json({ error: 'Signature invalide' });
  }

  const event = req.headers['x-youcan-event'] || req.body.event || 'unknown';
  const data  = req.body.data || req.body;

  console.log('[YouCan Webhook]', event, JSON.stringify(data).slice(0, 100));

  try {
    const db = loadDB();

    // ── Nouvelle commande ──
    if (event === 'order.created' || event === 'order.confirmed') {
      const yco   = data.order || data;
      const exists = db.orders.find(o => o.youcanId === yco.id);
      if (!exists) {
        const customerName = (yco.customer?.first_name || yco.billing?.first_name || 'Client') + ' ' + (yco.customer?.last_name || yco.billing?.last_name || '');
        const items = (yco.items || yco.line_items || []).map(i => ({
          name: i.name || i.title || 'Produit', price: parseFloat(i.price || 0),
          qty: parseInt(i.quantity || 1), total: parseFloat(i.price || 0) * parseInt(i.quantity || 1)
        }));
        const total = parseFloat(yco.total || 0);

        // Trouver l'utilisateur propriétaire du store
        const storeOwner = db.users.find(u => u.youcanStore === YOUCAN_STORE || u.role === 'superadmin');
        const userId = storeOwner?.id || db.users[0]?.id;
        if (!userId) { res.json({ ok: true }); return; }

        db.orders.push({
          id: uuid(), userId, youcanId: yco.id,
          orderNumber: 'YC-' + (yco.number || yco.id?.slice(-6)),
          contactName: customerName.trim(), items,
          subtotal: Math.round(total/1.20*100)/100,
          tva:      Math.round((total - total/1.20)*100)/100,
          total:    Math.round(total*100)/100,
          paymentMethod: yco.payment_method || 'youcan',
          address:  [yco.shipping?.address1, yco.shipping?.city].filter(Boolean).join(', '),
          status:   'confirmed', source: 'youcan',
          createdAt: yco.created_at || new Date().toISOString()
        });

        db.alerts.push({
          id: uuid(), userId, type: 'success',
          msg: `🛍 Nouvelle commande YouCan: ${customerName.trim()} — ${total} MAD`,
          read: false, createdAt: new Date().toISOString()
        });
        saveDB(db);
        console.log('[YouCan] Commande créée:', yco.id);
      }
    }

    // ── Commande annulée ──
    if (event === 'order.cancelled') {
      const yco = data.order || data;
      const idx = db.orders.findIndex(o => o.youcanId === yco.id);
      if (idx !== -1) { db.orders[idx].status = 'cancelled'; saveDB(db); }
    }

    // ── Produit mis à jour (stock) ──
    if (event === 'product.updated' || event === 'product.stock_changed') {
      const ycp = data.product || data;
      const idx = db.products.findIndex(p => p.youcanId === ycp.id);
      if (idx !== -1) {
        db.products[idx].stock = parseInt(ycp.quantity || ycp.stock || 0);
        db.products[idx].price = parseFloat(ycp.price || db.products[idx].price);
        saveDB(db);
      }
    }

    res.json({ ok: true, event });
  } catch (e) {
    console.error('[YouCan Webhook Error]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Sauvegarder config YouCan (par utilisateur) ───────
app.post('/api/youcan/config', auth, adminOnly, (req, res) => {
  const { apiKey, storeUrl, webhookSecret } = req.body;
  const db  = loadDB();
  const idx = db.users.findIndex(u => u.id === req.user.id);
  if (idx !== -1) {
    db.users[idx].youcanStore  = storeUrl  || '';
    db.users[idx].youcanKey    = apiKey    || '';
    db.users[idx].youcanSecret = webhookSecret || '';
    saveDB(db);
  }
  res.json({ ok: true, message: 'Configuration YouCan sauvegardée. Redémarrez Railway pour appliquer.' });
});


// ── Analyse image produit avec Groq Vision ────────────
app.post('/api/ai/analyze-image', auth, async (req, res) => {
  const { imageBase64 } = req.body;
  if (!imageBase64) return res.status(400).json({ error: 'Image requise' });

  try {
    // Extract base64 data
    const base64Data = imageBase64.includes(',') ? imageBase64.split(',')[1] : imageBase64;
    const mediaType  = imageBase64.includes('png') ? 'image/png' : 'image/jpeg';

    // Use Groq with vision (llama-3.2-11b-vision)
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + GROQ_KEY
      },
      body: JSON.stringify({
        model: 'meta-llama/llama-4-scout-17b-16e-instruct',
        max_tokens: 500,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: { url: `data:${mediaType};base64,${base64Data}` }
            },
            {
              type: 'text',
              text: `You are a professional product photographer AI. Analyze this product image in extreme detail.
Reply ONLY with valid JSON, no markdown, no explanation:
{
  "productName": "exact product name in French",
  "description": "EXTREMELY DETAILED visual description for AI image generation: exact colors, materials, textures, shape, size, brand elements, patterns, style. Be very specific. Example: black leather Karl Lagerfeld handbag with silver chain strap, quilted texture, gold logo, luxury fashion accessory",
  "category": "product category",
  "suggestedColors": "exact color palette for ad background (example: black and gold on white)",
  "suggestedStyle": "photography style (studio white background, lifestyle, flat lay, etc)"
}`
            }
          ]
        }]
      })
    });

    if (!response.ok) {
      const err = await response.text();
      // Fallback: use basic Groq text model
      const fallback = await callGroq([{
        role: 'user',
        content: 'Je vais uploader une photo produit pour générer une pub. Réponds en JSON: {"productName":"Produit","description":"produit de qualité premium","category":"général","suggestedColors":"blanc et or","suggestedStyle":"studio professionnel"}'
      }], 200);
      try {
        const parsed = JSON.parse(fallback.replace(/```json|```/g,'').trim());
        return res.json(parsed);
      } catch {
        return res.json({ productName: 'Produit', description: 'produit premium photographié', category: 'général', suggestedColors: 'blanc et or', suggestedStyle: 'studio professionnel' });
      }
    }

    const data   = await response.json();
    const text   = data.choices?.[0]?.message?.content || '{}';
    const clean  = text.replace(/```json|```/g, '').trim();

    let parsed;
    try { parsed = JSON.parse(clean); }
    catch { parsed = { productName: 'Produit', description: clean.slice(0, 200), category: 'général', suggestedColors: 'naturel', suggestedStyle: 'studio' }; }

    res.json(parsed);
  } catch (e) {
    // Fallback gracieux
    res.json({
      productName: 'Produit',
      description: 'produit premium marocain, photo professionnelle',
      category: 'général',
      suggestedColors: 'blanc et or',
      suggestedStyle: 'studio professionnel fond blanc'
    });
  }
});

app.get('/health', (req, res) => {
  const db = loadDB();
  res.json({
    status: 'ok',
    service: 'nexamarket-live',
    version: '3.0.0',
    groqConnected: !!GROQ_KEY,
    dbUsers: db.users.length,
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString()
  });
});

app.get('/api', (req, res) => {
  res.json({
    name: 'NexaMarket Pro Live API v3.0',
    groq: GROQ_KEY ? 'Connecté ✅' : 'Non configuré ❌',
    endpoints: [
      'POST /api/auth/login',
      'POST /api/auth/register',
      'GET  /api/auth/me',
      'GET  /api/dashboard',
      'GET  /api/crm/contacts',
      'POST /api/crm/contacts',
      'GET  /api/ecom/products',
      'POST /api/ecom/products',
      'GET  /api/ecom/orders',
      'POST /api/ecom/orders',
      'GET  /api/billing/invoices',
      'POST /api/billing/invoices',
      'GET  /api/ads/campaigns',
      'POST /api/ads/campaigns',
      'GET  /api/wa/messages',
      'GET  /api/wa/stats',
      'GET  /api/finance/dashboard',
      'POST /api/ai/chat',
      'GET  /api/ai/finance',
      'POST /api/ai/content',
      'POST /api/ai/wa-reply',
      'POST /api/ai/score-lead',
      'GET  /api/alerts',
    ]
  });
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/app.html'));
});

// Error handler
app.use((err, req, res, next) => {
  console.error('[Erreur]', err.message);
  res.status(500).json({ error: 'Erreur serveur' });
});

// ════════════════════════════════════════════════════════
//  CRON — Vérification alertes toutes les heures
// ════════════════════════════════════════════════════════
cron.schedule('0 * * * *', () => {
  try {
    const db = loadDB();
    let changed = false;

    db.users.forEach(user => {
      // Vérifier factures impayées > 30 jours
      db.invoices.filter(i => i.userId === user.id && i.status === 'pending').forEach(inv => {
        if (inv.dueDate && new Date() > new Date(inv.dueDate)) {
          const existing = db.alerts.find(a => a.invoiceId === inv.id && a.type === 'overdue');
          if (!existing) {
            db.alerts.push({
              id: uuid(), userId: user.id, type: 'overdue',
              invoiceId: inv.id,
              msg: `Facture ${inv.invoiceNo} de ${inv.totalTTC} MAD est impayée (échue)`,
              read: false, createdAt: new Date().toISOString()
            });
            inv.status = 'overdue';
            changed = true;
          }
        }
      });

      // Vérifier stock critique
      db.products.filter(p => p.userId === user.id).forEach(prod => {
        if ((prod.stock || 0) <= (prod.stockAlert || 10)) {
          const key = `stock_${prod.id}_${new Date().toISOString().split('T')[0]}`;
          if (!db.alerts.find(a => a.id === key)) {
            db.alerts.push({
              id: key, userId: user.id, type: 'stock',
              msg: `Stock critique: ${prod.name} — ${prod.stock} unités restantes`,
              read: false, createdAt: new Date().toISOString()
            });
            changed = true;
          }
        }
      });
    });

    if (changed) saveDB(db);
  } catch (e) {
    console.error('[Cron Error]', e.message);
  }
});

// ── START ────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`
╔══════════════════════════════════════════════╗
║    🚀  NexaMarket Pro LIVE  v3.0.0           ║
║──────────────────────────────────────────────║
║  PORT:  ${String(PORT).padEnd(36)}║
║  GROQ:  ${(GROQ_KEY ? '✅ Connecté' : '❌ Non configuré').padEnd(36)}║
║  DB:    ${DB_PATH.substring(0, 36).padEnd(36)}║
╚══════════════════════════════════════════════╝

👤 Admin par défaut:
   Email    : admin@nexamarket.ma
   Password : Admin2026@
   Panel    : /api/admin/users
  `);
  initDB(); // S'assure que la DB existe
});

module.exports = app;
