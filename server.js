const https = require('https');
const http = require('http');

const SECRET_KEY = process.env.YABETOO_SECRET_KEY;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "pascal2026";
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = process.env.GITHUB_OWNER || "prefingil-ai";
const GITHUB_REPO = process.env.GITHUB_REPO || "pascal-backend";
const GITHUB_FILE_PATH = "books.json";

const YABETOOPAY_HOST = "pay.api.yabetoopay.com";
const GITHUB_HOST = "api.github.com";

// ───────────────────────── Helpers HTTP génériques ─────────────────────────
function httpsRequest(hostname, path, method, headers, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const reqHeaders = Object.assign({}, headers);
    if (data) reqHeaders['Content-Length'] = Buffer.byteLength(data);

    const options = { hostname, path, method, headers: reqHeaders };

    const req = https.request(options, (res) => {
      let responseData = '';
      res.on('data', (chunk) => responseData += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(responseData) });
        } catch (e) {
          resolve({ status: res.statusCode, data: { raw: responseData } });
        }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json'
  };
}

function respond(res, statusCode, data) {
  res.writeHead(statusCode, corsHeaders());
  res.end(JSON.stringify(data));
}

// ───────────────────────── Stockage des livres sur GitHub ─────────────────────────
// On stocke books.json directement dans le repo GitHub via l'API Contents.
// Ça survit aux redéploiements Render car ce n'est pas stocké localement.

let booksCache = null;
let booksSha = null; // nécessaire pour les updates sur GitHub

function getDefaultBooks() {
  return [
    {
      id: 1,
      category: "Formations",
      title: "Marketing Digital Avancé",
      type: "formation",
      description: "Maîtrisez les stratégies de marketing digital pour développer votre business en ligne.",
      importance: "SEO, publicité Facebook/Instagram, email marketing, analytics.",
      price: 15000,
      cover: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
      coverImage: "",
      pdfLink: ""
    },
    {
      id: 3,
      category: "Livres",
      title: "Entrepreneuriat au Congo",
      type: "livre",
      description: "Guide pratique pour créer et développer une entreprise prospère au Congo-Brazzaville.",
      importance: "",
      price: 8000,
      cover: "linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)",
      coverImage: "",
      pdfLink: ""
    }
  ];
}

const ghHeaders = () => ({
  'Authorization': `Bearer ${GITHUB_TOKEN}`,
  'User-Agent': 'pascal-backend',
  'Accept': 'application/vnd.github+json'
});

async function loadBooksFromGitHub() {
  if (!GITHUB_TOKEN) {
    console.log('⚠️ GITHUB_TOKEN manquant, utilisation des livres par défaut (non persistant)');
    return getDefaultBooks();
  }
  try {
    const result = await httpsRequest(
      GITHUB_HOST,
      `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${GITHUB_FILE_PATH}`,
      'GET',
      ghHeaders()
    );

    if (result.status === 404) {
      // Le fichier n'existe pas encore sur GitHub -> on le crée avec les défauts
      const defaults = getDefaultBooks();
      await saveBooksToGitHub(defaults, null);
      return defaults;
    }

    if (result.status !== 200) {
      console.log('Erreur lecture GitHub:', result.status, JSON.stringify(result.data));
      return booksCache || getDefaultBooks();
    }

    booksSha = result.data.sha;
    const content = Buffer.from(result.data.content, 'base64').toString('utf8');
    const books = JSON.parse(content);
    booksCache = books;
    return books;

  } catch (e) {
    console.log('Exception loadBooksFromGitHub:', e.message);
    return booksCache || getDefaultBooks();
  }
}

async function getLatestSha() {
  if (!GITHUB_TOKEN) return null;
  try {
    const result = await httpsRequest(
      GITHUB_HOST,
      `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${GITHUB_FILE_PATH}`,
      'GET',
      ghHeaders()
    );
    if (result.status === 200) {
      return result.data.sha;
    }
    return null; // fichier n'existe pas encore
  } catch (e) {
    return null;
  }
}

async function saveBooksToGitHub(books, currentSha) {
  if (!GITHUB_TOKEN) {
    booksCache = books;
    return { success: false, error: 'GITHUB_TOKEN manquant - sauvegarde non persistante' };
  }

  const content = Buffer.from(JSON.stringify(books, null, 2)).toString('base64');

  // Toujours récupérer le sha le plus frais juste avant d'écrire,
  // pour éviter les erreurs 409 (conflit de version)
  const freshSha = await getLatestSha();

  const body = {
    message: `Update books.json - ${new Date().toISOString()}`,
    content: content
  };
  if (freshSha) body.sha = freshSha;

  let result = await httpsRequest(
    GITHUB_HOST,
    `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${GITHUB_FILE_PATH}`,
    'PUT',
    ghHeaders(),
    body
  );

  // Si malgré tout on a un conflit (course entre 2 requêtes), on retente une fois
  if (result.status === 409) {
    const retrySha = await getLatestSha();
    body.sha = retrySha;
    result = await httpsRequest(
      GITHUB_HOST,
      `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${GITHUB_FILE_PATH}`,
      'PUT',
      ghHeaders(),
      body
    );
  }

  if (result.status === 200 || result.status === 201) {
    booksSha = result.data.content.sha;
    booksCache = books;
    return { success: true };
  }

  console.log('Erreur sauvegarde GitHub:', result.status, JSON.stringify(result.data));
  return { success: false, error: result.data.message || 'Erreur sauvegarde GitHub' };
}

// ───────────────────────── YaBeTooPay ─────────────────────────
function callYabetoo(method, urlPath, body) {
  return httpsRequest(YABETOOPAY_HOST, urlPath, method, {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${SECRET_KEY}`
  }, body);
}

// ───────────────────────── Auth & body parsing ─────────────────────────
function checkAdminAuth(req) {
  const auth = req.headers['authorization'];
  if (!auth) return false;
  const token = auth.replace('Bearer ', '');
  return token === ADMIN_PASSWORD;
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch (e) { resolve({}); }
    });
    req.on('error', () => resolve({}));
  });
}

// ───────────────────────── Serveur HTTP ─────────────────────────
const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(200, corsHeaders());
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  // ─── Health check ───
  if (req.method === 'GET' && pathname === '/') {
    return respond(res, 200, {
      status: 'ok',
      message: 'Boutique Pascal Backend',
      storage: GITHUB_TOKEN ? 'GitHub (persistant)' : 'Mémoire (NON persistant - configure GITHUB_TOKEN)'
    });
  }

  // ─── Servir admin.html ───
  if (req.method === 'GET' && pathname === '/admin.html') {
    const fs = require('fs');
    const path = require('path');
    try {
      const adminFile = fs.readFileSync(path.join(__dirname, 'admin.html'), 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
      res.end(adminFile);
    } catch (e) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('admin.html non trouvé sur le serveur');
    }
    return;
  }

  // ─── GET /books (public) ───
  if (req.method === 'GET' && pathname === '/books') {
    const books = await loadBooksFromGitHub();
    const publicBooks = books.map(b => {
      const { pdfLink, ...rest } = b;
      return rest;
    });
    return respond(res, 200, { books: publicBooks });
  }

  // ─── ADMIN: Login ───
  if (req.method === 'POST' && pathname === '/admin/login') {
    const body = await readBody(req);
    if (body.password === ADMIN_PASSWORD) {
      return respond(res, 200, { success: true, token: ADMIN_PASSWORD });
    }
    return respond(res, 401, { error: 'Mot de passe incorrect' });
  }

  // ─── ADMIN: Liste complète ───
  if (req.method === 'GET' && pathname === '/admin/books') {
    if (!checkAdminAuth(req)) return respond(res, 401, { error: 'Non autorisé' });
    const books = await loadBooksFromGitHub();
    return respond(res, 200, { books, storage: GITHUB_TOKEN ? 'github' : 'memory' });
  }

  // ─── ADMIN: Ajouter un livre ───
  if (req.method === 'POST' && pathname === '/admin/books') {
    if (!checkAdminAuth(req)) return respond(res, 401, { error: 'Non autorisé' });
    const body = await readBody(req);
    const books = await loadBooksFromGitHub();
    const newId = books.length > 0 ? Math.max(...books.map(b => b.id)) + 1 : 1;
    const newBook = {
      id: newId,
      category: body.category || "Livres",
      title: body.title || "Sans titre",
      type: body.type || "livre",
      description: body.description || "",
      importance: body.importance || "",
      price: Number(body.price) || 0,
      cover: body.cover || "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
      coverImage: body.coverImage || "",
      pdfLink: body.pdfLink || ""
    };
    books.push(newBook);
    const saveResult = await saveBooksToGitHub(books, booksSha);
    if (!saveResult.success) {
      return respond(res, 500, { error: saveResult.error });
    }
    return respond(res, 200, { success: true, book: newBook });
  }

  // ─── ADMIN: Modifier un livre ───
  if (req.method === 'PUT' && pathname.startsWith('/admin/books/')) {
    if (!checkAdminAuth(req)) return respond(res, 401, { error: 'Non autorisé' });
    const id = Number(pathname.split('/').pop());
    const body = await readBody(req);
    const books = await loadBooksFromGitHub();
    const idx = books.findIndex(b => b.id === id);
    if (idx === -1) return respond(res, 404, { error: 'Livre non trouvé' });
    books[idx] = { ...books[idx], ...body, id };
    const saveResult = await saveBooksToGitHub(books, booksSha);
    if (!saveResult.success) {
      return respond(res, 500, { error: saveResult.error });
    }
    return respond(res, 200, { success: true, book: books[idx] });
  }

  // ─── ADMIN: Supprimer un livre ───
  if (req.method === 'DELETE' && pathname.startsWith('/admin/books/')) {
    if (!checkAdminAuth(req)) return respond(res, 401, { error: 'Non autorisé' });
    const id = Number(pathname.split('/').pop());
    let books = await loadBooksFromGitHub();
    books = books.filter(b => b.id !== id);
    const saveResult = await saveBooksToGitHub(books, booksSha);
    if (!saveResult.success) {
      return respond(res, 500, { error: saveResult.error });
    }
    return respond(res, 200, { success: true });
  }

  // ─── PAYMENT ───
  if (req.method === 'POST' && pathname === '/payment') {
    if (!SECRET_KEY) {
      return respond(res, 500, { error: 'Clé secrète YaBeTooPay manquante' });
    }
    const payload = await readBody(req);
    const { action } = payload;

    try {
      if (action === 'create') {
        const books = await loadBooksFromGitHub();
        const book = books.find(b => b.id === Number(payload.bookId));
        if (!book) return respond(res, 404, { error: 'Livre non trouvé' });

        const result = await callYabetoo('POST', '/v1/payment-intents', {
          amount: Number(book.price),
          currency: 'xaf',
          description: `Achat: ${book.title}`,
          metadata: { orderId: payload.orderId, bookId: book.id, bookTitle: book.title }
        });

        if (result.status !== 200 && result.status !== 201) {
          return respond(res, result.status, { error: result.data.message || 'Erreur YaBeTooPay' });
        }

        return respond(res, 200, {
          intentId: result.data.id,
          clientSecret: result.data.clientSecret
        });
      }

      if (action === 'confirm') {
        const result = await callYabetoo('POST', `/v1/payment-intents/${payload.intentId}/confirm`, {
          client_secret: payload.clientSecret,
          first_name: payload.firstName,
          last_name: payload.lastName,
          receipt_email: payload.email,
          payment_method_data: {
            type: 'momo',
            momo: {
              country: 'cg',
              msisdn: payload.phone,
              operator_name: payload.operator
            }
          }
        });

        console.log('YaBeTooPay confirm status HTTP:', result.status);
        console.log('YaBeTooPay confirm response:', JSON.stringify(result.data));

        // Si YaBeTooPay renvoie une erreur HTTP (4xx/5xx), on transmet le message exact
        if (result.status >= 400) {
          return respond(res, 200, {
            error: result.data.message || result.data.error || `Erreur YaBeTooPay (${result.status}): ${JSON.stringify(result.data)}`
          });
        }

        if (result.data.status === 'succeeded') {
          const books = await loadBooksFromGitHub();
          const book = books.find(b => b.id === Number(payload.bookId));
          return respond(res, 200, {
            ...result.data,
            pdfLink: book ? book.pdfLink : null
          });
        }

        return respond(res, 200, result.data);
      }

      return respond(res, 400, { error: 'Action inconnue: ' + action });

    } catch (err) {
      return respond(res, 500, { error: err.message });
    }
  }

  return respond(res, 404, { error: 'Route non trouvée' });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Boutique Pascal Backend démarré sur port ${PORT}`);
  console.log(`Stockage: ${GITHUB_TOKEN ? 'GitHub (persistant) ✅' : 'Mémoire uniquement (NON persistant) ⚠️'}`);
});
