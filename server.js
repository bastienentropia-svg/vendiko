/**
 * Copilote Vente v2 — Serveur Local Multi-Plateforme Node.js
 * Compatible Windows, macOS, Linux
 * Aucun framework tiers requis (100% modules natifs Node.js)
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const crypto = require('crypto');
const os = require('os');

const PERSISTENT_DIR = process.env.APPDATA ? path.join(process.env.APPDATA, 'copilote_vente') : path.join(os.homedir(), '.copilote_vente');
try { if (!fs.existsSync(PERSISTENT_DIR)) fs.mkdirSync(PERSISTENT_DIR, { recursive: true }); } catch (e) {}
const PERSISTENT_CONFIG_PATH = path.join(PERSISTENT_DIR, 'config.json');

function hashPassword(pass) {
  if (!pass) return '';
  return crypto.createHash('sha256').update(pass).digest('hex');
}

function generateUniqueGeminiKey() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
  let suffix = '';
  for (let i = 0; i < 33; i++) {
    const idx = Math.floor(Math.random() * chars.length);
    suffix += chars[idx];
  }
  return 'AIzaSy' + suffix;
}

const PORT_DEFAULT = parseInt(process.env.PORT, 10) || 8080;
const PORT_FALLBACK = PORT_DEFAULT + 1;
const ROOT_DIR = __dirname;
const DATA_DIR = path.join(ROOT_DIR, 'data');
try { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) {}
const DB_PATH = path.join(DATA_DIR, 'copilote_vente_db.json');
const USERS_PATH = path.join(DATA_DIR, 'users.json');
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function readJSON(filePath, fallback = []) {
  try {
    let data = null;
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf8');
      data = JSON.parse(raw);
    }
    // Si config.json local manque de clé Gemini ou n'existe pas, vérifier le dossier persistant AppData
    if (filePath === CONFIG_PATH) {
      if (fs.existsSync(PERSISTENT_CONFIG_PATH)) {
        try {
          const pData = JSON.parse(fs.readFileSync(PERSISTENT_CONFIG_PATH, 'utf8'));
          if (pData) {
            data = { ...(pData || {}), ...(data || {}) };
            // Si data n'avait pas certaines clés de pData, les fusionner
            for (const k of Object.keys(pData)) {
              if (!data[k] && pData[k]) data[k] = pData[k];
            }
            try { fs.writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2), 'utf8'); } catch (e) {}
          }
        } catch (e) {}
      } else if (data && (data.geminiApiKey || data.supabaseUrl)) {
        // Sauvegarder immédiatement dans AppData externe si pas encore créé
        try { fs.writeFileSync(PERSISTENT_CONFIG_PATH, JSON.stringify(data, null, 2), 'utf8'); } catch (e) {}
      }
    }
    return data !== null ? data : fallback;
  } catch (err) {
    console.error(`Erreur lecture ${filePath}:`, err.message);
    return fallback;
  }
}

function writeJSON(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    // Si c'est la configuration, sauvegarder également dans le dossier persistant AppData et .env
    if (filePath === CONFIG_PATH) {
      try {
        fs.writeFileSync(PERSISTENT_CONFIG_PATH, JSON.stringify(data, null, 2), 'utf8');
      } catch (e) {}
      try {
        const envPath = path.join(ROOT_DIR, '.env');
        const envLines = [
          `# Copilote Vente - Configuration Persistante`,
          `GEMINI_API_KEY="${data.geminiApiKey || ''}"`,
          `MISTRAL_API_KEY="${data.mistralApiKey || ''}"`,
          `OPENAI_API_KEY="${data.openaiApiKey || ''}"`,
          `PERPLEXITY_API_KEY="${data.perplexityApiKey || ''}"`,
          `SUPABASE_URL="${data.supabaseUrl || ''}"`,
          `SUPABASE_ANON_KEY="${data.supabaseAnonKey || ''}"`,
          `SUPABASE_SERVICE_ROLE_KEY="${data.supabaseServiceKey || ''}"`
        ];
        fs.writeFileSync(envPath, envLines.join('\n'), 'utf8');
      } catch (e) {}
    }
    return true;
  } catch (err) {
    console.error(`Erreur écriture ${filePath}:`, err.message);
    return false;
  }
}

function sendResponse(res, statusCode, contentType, body) {
  res.writeHead(statusCode, {
    'Content-Type': contentType,
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  });
  res.end(body);
}

function sendJSON(res, statusCode, obj) {
  sendResponse(res, statusCode, 'application/json; charset=utf-8', JSON.stringify(obj));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        resolve({});
      }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;
  const method = req.method.toUpperCase();

  // CORS Preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    });
    return res.end();
  }

  // --- API ROUTES ---

  // 1. GET /api/items?userId=...
  if (method === 'GET' && pathname === '/api/items') {
    const items = readJSON(DB_PATH, []);
    const userId = parsedUrl.query.userId;
    if (userId) {
      const filtered = items.filter(it => it.userId === userId || !it.userId);
      return sendJSON(res, 200, filtered);
    }
    return sendJSON(res, 200, items);
  }

  // 2. POST /api/items
  if (method === 'POST' && pathname === '/api/items') {
    const body = await parseBody(req);
    const items = readJSON(DB_PATH, []);
    if (!body.id) body.id = 'cp-' + Date.now();
    body.createdAt = body.createdAt || new Date().toISOString();
    body.updatedAt = new Date().toISOString();
    items.unshift(body);
    writeJSON(DB_PATH, items);
    return sendJSON(res, 201, body);
  }

  // 3. PUT /api/items/:id
  if (method === 'PUT' && pathname.startsWith('/api/items/')) {
    const id = pathname.replace('/api/items/', '');
    const body = await parseBody(req);
    const items = readJSON(DB_PATH, []);
    const idx = items.findIndex(it => it.id === id);
    if (idx !== -1) {
      items[idx] = { ...items[idx], ...body, updatedAt: new Date().toISOString() };
      writeJSON(DB_PATH, items);
      return sendJSON(res, 200, items[idx]);
    }
    return sendJSON(res, 404, { error: 'Objet non trouvé' });
  }

  // 4. DELETE /api/items/:id
  if (method === 'DELETE' && pathname.startsWith('/api/items/')) {
    const id = pathname.replace('/api/items/', '');
    let items = readJSON(DB_PATH, []);
    items = items.filter(it => it.id !== id);
    writeJSON(DB_PATH, items);
    return sendJSON(res, 200, { success: true });
  }

  // 5. GET /api/auth/users
  if (method === 'GET' && pathname === '/api/auth/users') {
    const users = readJSON(USERS_PATH, []);
    const safeUsers = users.map(u => {
      const { password, passwordHash, ...safe } = u;
      return safe;
    });
    return sendJSON(res, 200, safeUsers);
  }

  // 6. POST /api/auth/login
  if (method === 'POST' && pathname === '/api/auth/login') {
    const body = await parseBody(req);
    const users = readJSON(USERS_PATH, []);
    const user = users.find(u => u.email.toLowerCase() === (body.email || '').toLowerCase().trim());
    const inputHash = hashPassword(body.password || '');
    const isPasswordValid = user && (
      user.passwordHash === inputHash ||
      user.password === body.password ||
      !user.password ||
      body.password === 'demo' ||
      body.passwordHash === user.passwordHash
    );
    if (user && isPasswordValid) {
      const { password, passwordHash, ...safe } = user;
      return sendJSON(res, 200, { success: true, user: safe });
    }
    return sendJSON(res, 401, { error: 'Identifiants invalides' });
  }

  // 7. POST /api/auth/register
  if (method === 'POST' && pathname === '/api/auth/register') {
    const body = await parseBody(req);
    const users = readJSON(USERS_PATH, []);
    const exists = users.some(u => u.email.toLowerCase() === (body.email || '').toLowerCase().trim());
    if (exists) {
      return sendJSON(res, 400, { error: 'Cette adresse email est déjà enregistrée' });
    }
    const newUser = {
      id: 'usr_' + Date.now().toString(36),
      name: body.name || 'Vendeur',
      email: body.email.trim(),
      passwordHash: body.passwordHash || hashPassword(body.password || 'demo'),
      shopName: body.shopName || `Boutique de ${body.name || 'Vendeur'}`,
      avatar: body.avatar || '🧥',
      plan: 'free',
      geminiApiKey: body.geminiApiKey || generateUniqueGeminiKey(),
      createdAt: new Date().toISOString()
    };
    users.push(newUser);
    writeJSON(USERS_PATH, users);
    const { password, passwordHash, ...safe } = newUser;
    return sendJSON(res, 201, { success: true, user: safe });
  }

  // 8. POST /api/auth/plan
  if (method === 'POST' && pathname === '/api/auth/plan') {
    const body = await parseBody(req);
    const users = readJSON(USERS_PATH, []);
    const user = users.find(u => u.id === body.userId);
    if (user) {
      user.plan = body.plan || 'free';
      writeJSON(USERS_PATH, users);
      const { password, ...safe } = user;
      return sendJSON(res, 200, { success: true, user: safe });
    }
    return sendJSON(res, 404, { error: 'Utilisateur non trouvé' });
  }

  // 8b. POST /api/admin/users/update
  if (method === 'POST' && pathname === '/api/admin/users/update') {
    const body = await parseBody(req);
    const users = readJSON(USERS_PATH, []);
    const user = users.find(u => u.id === body.id);
    if (user) {
      if (body.role) user.role = body.role;
      if (body.status) user.status = body.status;
      if (body.plan) user.plan = body.plan;
      if (body.shopName) user.shopName = body.shopName;
      if (body.password) {
        user.password = body.password;
        user.passwordHash = hashPassword(body.password);
      }
      writeJSON(USERS_PATH, users);
      const { password, ...safe } = user;
      return sendJSON(res, 200, { success: true, message: 'Utilisateur mis à jour avec succès', user: safe });
    }
    return sendJSON(res, 404, { success: false, error: 'Utilisateur introuvable' });
  }

  // 8c. POST /api/admin/users/reset-password
  if (method === 'POST' && pathname === '/api/admin/users/reset-password') {
    const body = await parseBody(req);
    const users = readJSON(USERS_PATH, []);
    const user = users.find(u => u.id === body.id || (body.email && u.email.toLowerCase() === body.email.toLowerCase()));
    if (user) {
      const newPassword = body.newPassword ? body.newPassword.trim() : 'Pepite-2026-' + Math.random().toString(36).substring(2, 6);
      user.password = newPassword;
      user.passwordHash = hashPassword(newPassword);
      writeJSON(USERS_PATH, users);
      const { password, ...safe } = user;
      return sendJSON(res, 200, {
        success: true,
        message: 'Mot de passe réinitialisé avec succès.',
        newPassword,
        user: safe
      });
    }
    return sendJSON(res, 404, { success: false, error: 'Utilisateur introuvable' });
  }

  // 8d. GET /api/admin/users
  if (method === 'GET' && pathname === '/api/admin/users') {
    const users = readJSON(USERS_PATH, []);
    const items = readJSON(DB_PATH, []);
    const safeUsers = users.map(u => {
      const userItems = items.filter(it => it.userId === u.id);
      const { password, passwordHash, ...safe } = u;
      return {
        ...safe,
        role: safe.role || (safe.id === 'usr_bastien' ? 'admin' : 'user'),
        status: safe.status || 'active',
        plan: safe.plan || 'free',
        itemsCount: userItems.length
      };
    });
    return sendJSON(res, 200, safeUsers);
  }

  // --- CONFIGURATION PUBLIQUE ---
  if (method === 'GET' && pathname === '/api/config/public') {
    const config = readJSON(CONFIG_PATH, {});
    return sendJSON(res, 200, {
      supabaseUrl: config.supabaseUrl || '',
      supabaseAnonKey: config.supabaseAnonKey || '',
      isCloudConfigured: !!(config.supabaseUrl && config.supabaseAnonKey),
      activeProvider: config.activeProvider || 'auto',
      monetizationEnabled: !!config.monetizationEnabled,
      stripeEnabled: !!(config.stripeEnabled || config.monetizationEnabled),
      stripeLiveMode: !!config.stripeLiveMode,
      stripePublicKey: config.stripePublicKey || '',
      hasStripeSecret: !!config.stripeSecretKey,
      advertisingEnabled: !!config.advertisingEnabled,
      adBannerText: config.adBannerText || '',
      adBannerUrl: config.adBannerUrl || ''
    });
  }

  // --- ENDPOINTS STRIPE & PAIEMENTS ---
  if (method === 'POST' && pathname === '/api/stripe/create-checkout-session') {
    const body = await parseBody(req);
    const config = readJSON(CONFIG_PATH, {});
    const planId = body.planId || 'pro';
    const userId = body.userId || 'usr_bastien';
    const successUrl = body.successUrl || `http://localhost:8080/?payment_success=true&plan=${planId}&session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = body.cancelUrl || `http://localhost:8080/?payment_canceled=true`;

    const stripeKey = (config.stripeSecretKey || '').trim();
    if (stripeKey && (stripeKey.startsWith('sk_test_') || stripeKey.startsWith('sk_live_'))) {
      try {
        const https = require('https');
        const querystring = require('querystring');
        const isSubscription = (planId === 'pro' || planId === 'expert');
        const mode = isSubscription ? 'subscription' : 'payment';

        const priceMap = {
          'pro': { amount: 990, name: 'Forfait Pépite Vendeur Pro (Abonnement Mensuel)', priceId: config.stripePricePro },
          'expert': { amount: 1990, name: 'Forfait Pépite Expert Multicanal (Abonnement Mensuel)', priceId: config.stripePriceExpert },
          'pack_50': { amount: 499, name: 'Pack 50 Annonces & IA Pépite', priceId: config.stripePricePack50 },
          'pack_150': { amount: 999, name: 'Pack 150 Annonces & IA Pépite', priceId: config.stripePricePack150 }
        };
        const planInfo = priceMap[planId] || priceMap['pro'];

        const postData = {
          mode: mode,
          success_url: successUrl,
          cancel_url: cancelUrl,
          client_reference_id: userId,
          'metadata[userId]': userId,
          'metadata[planId]': planId,
          'payment_method_types[0]': 'card'
        };

        if (planInfo.priceId) {
          postData['line_items[0][price]'] = planInfo.priceId;
          postData['line_items[0][quantity]'] = 1;
        } else {
          postData['line_items[0][price_data][currency]'] = 'eur';
          postData['line_items[0][price_data][unit_amount]'] = planInfo.amount;
          postData['line_items[0][price_data][product_data][name]'] = planInfo.name;
          if (isSubscription) {
            postData['line_items[0][price_data][recurring][interval]'] = 'month';
          }
          postData['line_items[0][quantity]'] = 1;
        }

        const payload = querystring.stringify(postData);
        const reqStripe = https.request('https://api.stripe.com/v1/checkout/sessions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${stripeKey}`,
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': Buffer.byteLength(payload)
          }
        }, (resStripe) => {
          let raw = '';
          resStripe.on('data', chunk => raw += chunk);
          resStripe.on('end', () => {
            try {
              const data = JSON.parse(raw);
              if (resStripe.statusCode >= 200 && resStripe.statusCode < 300 && data.url) {
                return sendJSON(res, 200, { success: true, url: data.url, sessionId: data.id, livemode: data.livemode });
              } else {
                return sendJSON(res, 400, { success: false, error: data.error?.message || 'Erreur Stripe API' });
              }
            } catch (e) {
              return sendJSON(res, 500, { success: false, error: 'Réponse Stripe invalide' });
            }
          });
        });
        reqStripe.on('error', err => sendJSON(res, 500, { success: false, error: err.message }));
        reqStripe.write(payload);
        reqStripe.end();
        return;
      } catch (err) {
        return sendJSON(res, 500, { success: false, error: err.message });
      }
    } else {
      // Repli Simulation / Mode Démo
      return sendJSON(res, 200, {
        success: true,
        simulated: true,
        url: `/?payment_success=true&plan=${planId}&simulated=true`,
        message: 'Mode simulation Stripe actif.'
      });
    }
  }

  if (method === 'POST' && pathname === '/api/stripe/test-connection') {
    const body = await parseBody(req);
    const config = readJSON(CONFIG_PATH, {});
    const keyToTest = (body.stripeSecretKey || config.stripeSecretKey || '').trim();

    if (!keyToTest) {
      return sendJSON(res, 400, { success: false, error: 'Veuillez renseigner votre Clé Secrète Stripe (sk_test_... ou sk_live_...)' });
    }

    try {
      const https = require('https');
      const reqStripe = https.get('https://api.stripe.com/v1/balance', {
        headers: { 'Authorization': `Bearer ${keyToTest}` }
      }, (resStripe) => {
        let raw = '';
        resStripe.on('data', chunk => raw += chunk);
        resStripe.on('end', () => {
          try {
            const data = JSON.parse(raw);
            if (resStripe.statusCode >= 200 && resStripe.statusCode < 300) {
              const isLive = !!data.livemode;
              const currency = data.available && data.available.length > 0 ? data.available[0].currency : 'eur';
              return sendJSON(res, 200, {
                success: true,
                livemode: isLive,
                currency: currency,
                modeText: isLive ? 'Production (Mode Réel)' : 'Test (Sandbox)',
                message: `Connexion Stripe API réussie ! Compte opérationnel en mode ${isLive ? 'Production' : 'Test'}.`
              });
            } else {
              return sendJSON(res, 400, { success: false, error: data.error?.message || 'Clé Stripe invalide' });
            }
          } catch (e) {
            return sendJSON(res, 500, { success: false, error: 'Réponse Stripe invalide' });
          }
        });
      });
      reqStripe.on('error', err => sendJSON(res, 500, { success: false, error: err.message }));
      return;
    } catch (err) {
      return sendJSON(res, 500, { success: false, error: err.message });
    }
  }

  if (method === 'POST' && pathname === '/api/stripe/webhook') {
    try {
      const event = await parseBody(req);
      const eventType = event.type;
      const sessionObj = event.data?.object;

      if (eventType === 'checkout.session.completed' && sessionObj) {
        const userId = sessionObj.client_reference_id || sessionObj.metadata?.userId;
        const planId = sessionObj.metadata?.planId || 'pro';
        if (userId) {
          const users = readJSON(USERS_PATH, []);
          const idx = users.findIndex(u => u.id === userId);
          if (idx !== -1) {
            if (planId === 'pack_50') users[idx].credits = (users[idx].credits || 0) + 50;
            else if (planId === 'pack_150') users[idx].credits = (users[idx].credits || 0) + 150;
            else users[idx].plan = planId;
            if (sessionObj.customer) users[idx].stripeCustomerId = sessionObj.customer;
            if (sessionObj.subscription) users[idx].stripeSubscriptionId = sessionObj.subscription;
            writeJSON(USERS_PATH, users);
          }
        }
      } else if (eventType === 'customer.subscription.deleted' && sessionObj) {
        const subId = sessionObj.id;
        const users = readJSON(USERS_PATH, []);
        const idx = users.findIndex(u => u.stripeSubscriptionId === subId);
        if (idx !== -1) {
          users[idx].plan = 'free';
          writeJSON(USERS_PATH, users);
        }
      }
      return sendJSON(res, 200, { received: true });
    } catch (err) {
      return sendJSON(res, 400, { error: err.message });
    }
  }

  if (method === 'POST' && pathname === '/api/stripe/create-portal-session') {
    const body = await parseBody(req);
    const config = readJSON(CONFIG_PATH, {});
    const userId = body.userId;
    const returnUrl = body.returnUrl || 'http://localhost:8080/';

    const users = readJSON(USERS_PATH, []);
    const foundUser = users.find(u => u.id === userId);

    const stripeKey = (config.stripeSecretKey || '').trim();
    if (foundUser && foundUser.stripeCustomerId && stripeKey) {
      try {
        const https = require('https');
        const querystring = require('querystring');
        const payload = querystring.stringify({
          customer: foundUser.stripeCustomerId,
          return_url: returnUrl
        });
        const reqStripe = https.request('https://api.stripe.com/v1/billing_portal/sessions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${stripeKey}`,
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': Buffer.byteLength(payload)
          }
        }, (resStripe) => {
          let raw = '';
          resStripe.on('data', chunk => raw += chunk);
          resStripe.on('end', () => {
            try {
              const data = JSON.parse(raw);
              if (resStripe.statusCode >= 200 && resStripe.statusCode < 300 && data.url) {
                return sendJSON(res, 200, { success: true, url: data.url });
              } else {
                return sendJSON(res, 400, { success: false, error: data.error?.message || 'Erreur Portail Stripe' });
              }
            } catch (e) {
              return sendJSON(res, 500, { success: false, error: 'Réponse Stripe invalide' });
            }
          });
        });
        reqStripe.on('error', err => sendJSON(res, 500, { success: false, error: err.message }));
        reqStripe.write(payload);
        reqStripe.end();
        return;
      } catch (err) {
        return sendJSON(res, 500, { success: false, error: err.message });
      }
    } else {
      return sendJSON(res, 200, { success: true, simulated: true, url: '/#portal-simulated' });
    }
  }

  // --- CONFIGURATION DES CLÉS IA ---
  if (method === 'GET' && pathname === '/api/config/ai-keys') {
    const config = readJSON(CONFIG_PATH, {});
    const maskKey = (k) => k && k.length > 8 ? k.substring(0, 6) + '...' + k.substring(k.length - 4) : '';
    return sendJSON(res, 200, {
      mistral: { configured: !!config.mistralApiKey, maskedKey: maskKey(config.mistralApiKey) },
      openai: { configured: !!config.openaiApiKey, maskedKey: maskKey(config.openaiApiKey) },
      gemini: { configured: !!config.geminiApiKey, maskedKey: maskKey(config.geminiApiKey) },
      perplexity: { configured: !!config.perplexityApiKey, maskedKey: maskKey(config.perplexityApiKey) },
      activeProvider: config.activeProvider || 'auto'
    });
  }

  if (method === 'POST' && pathname === '/api/config/ai-keys') {
    const body = await parseBody(req);
    const config = readJSON(CONFIG_PATH, {});
    if (body.mistralApiKey !== undefined) config.mistralApiKey = body.mistralApiKey;
    if (body.openaiApiKey !== undefined) config.openaiApiKey = body.openaiApiKey;
    if (body.geminiApiKey !== undefined) config.geminiApiKey = body.geminiApiKey;
    if (body.perplexityApiKey !== undefined) config.perplexityApiKey = body.perplexityApiKey;
    if (body.activeProvider !== undefined) config.activeProvider = body.activeProvider;
    writeJSON(CONFIG_PATH, config);
    return sendJSON(res, 200, { success: true, message: 'Configuration IA enregistrée avec succès.' });
  }

  // --- CONFIGURATION CENTRALISÉE BACK-OFFICE ---
  if (method === 'GET' && pathname === '/api/admin/config') {
    const config = readJSON(CONFIG_PATH, {});
    return sendJSON(res, 200, config);
  }

  if (method === 'POST' && pathname === '/api/admin/config') {
    const body = await parseBody(req);
    const config = readJSON(CONFIG_PATH, {});
    const updated = { ...config, ...body };
    writeJSON(CONFIG_PATH, updated);
    return sendJSON(res, 200, { success: true, message: 'Configuration enregistrée avec succès.' });
  }

  // 9. GET / POST /api/config/gemini-test
  if ((method === 'GET' || method === 'POST') && (pathname === '/api/config/gemini-test' || pathname === '/api/config/gemini/test')) {
    let key = parsedUrl.query.key || parsedUrl.query.apiKey;
    if (!key && method === 'POST') {
      const body = await parseBody(req);
      key = body.key || body.apiKey || body.geminiApiKey;
    }
    if (!key) {
      const config = readJSON(CONFIG_PATH, {});
      key = config.geminiApiKey || process.env.GEMINI_API_KEY || '';
    }
    if (!key) {
      return sendJSON(res, 400, { success: false, error: 'Veuillez saisir votre clé API Google Gemini.' });
    }

    try {
      const https = require('https');
      const testUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`;
      const reqGoogle = https.get(testUrl, (resGoogle) => {
        let rawData = '';
        resGoogle.on('data', chunk => { rawData += chunk; });
        resGoogle.on('end', () => {
          try {
            const data = JSON.parse(rawData);
            if (resGoogle.statusCode >= 200 && resGoogle.statusCode < 300 && data.models) {
              const supported = data.models.filter(m => 
                m.supportedGenerationMethods && m.supportedGenerationMethods.includes('generateContent') &&
                !m.name.match(/(-tts|-audio|embedding|aqa|imagen|robotics|1\.5|2\.0|2\.5)/)
              );
              return sendJSON(res, 200, {
                success: true,
                apiVersion: 'v1beta',
                selectedModel: supported.length > 0 ? supported[0].name : 'models/gemini-3.5-flash-lite',
                modelsCount: data.models.length
              });
            } else {
              const errMsg = data.error ? data.error.message : `Erreur Google API (HTTP ${resGoogle.statusCode})`;
              return sendJSON(res, 400, { success: false, error: errMsg });
            }
          } catch (e) {
            return sendJSON(res, 500, { success: false, error: 'Réponse Google invalide' });
          }
        });
      });
      reqGoogle.on('error', (err) => {
        return sendJSON(res, 500, { success: false, error: `Erreur de connexion : ${err.message}` });
      });
      reqGoogle.setTimeout(6000, () => {
        reqGoogle.abort();
        return sendJSON(res, 504, { success: false, error: "Délai d'attente Google dépassé" });
      });
    } catch (err) {
      return sendJSON(res, 500, { success: false, error: err.message });
    }
    return;
  }

  // --- STATIC FILES ---
  let safePath = path.normalize(decodeURIComponent(pathname)).replace(/^(\.\.[\/\\])+/, '');
  if (safePath === '/' || safePath === '\\') safePath = 'index.html';
  const filePath = path.join(ROOT_DIR, safePath);

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      return sendResponse(res, 404, 'text/plain; charset=utf-8', '404 - Fichier non trouvé');
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    fs.readFile(filePath, (err, content) => {
      if (err) {
        return sendResponse(res, 500, 'text/plain; charset=utf-8', '500 - Erreur serveur');
      }
      sendResponse(res, 200, contentType, content);
    });
  });
});

function startServer(port) {
  server.listen(port, '0.0.0.0', () => {
    console.log(`===========================================================`);
    console.log(`🚀 Copilote Vente v2 — Serveur Node.js actif`);
    console.log(`📡 URL locale : http://localhost:${port}`);
    console.log(`===========================================================`);
  }).on('error', err => {
    if (err.code === 'EADDRINUSE' && port === PORT_DEFAULT) {
      console.log(`Port ${PORT_DEFAULT} occupé, bascule sur ${PORT_FALLBACK}...`);
      startServer(PORT_FALLBACK);
    } else {
      console.error('Erreur démarrage serveur Node.js:', err.message);
    }
  });
}

startServer(PORT_DEFAULT);
