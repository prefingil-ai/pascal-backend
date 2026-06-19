const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SECRET_KEY = process.env.YABETOO_SECRET_KEY;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "pascal2026";
const YABETOO_API = "pay.api.yabetoopay.com";
const DB_FILE = path.join(__dirname, 'books.json');

// ─── Base de données simple (fichier JSON) ───
function loadBooks() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      const defaultBooks = getDefaultBooks();
      fs.writeFileSync(DB_FILE, JSON.stringify(defaultBooks, null, 2));
      return defaultBooks;
    }
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch (e) {
    return getDefaultBooks();
  }
}

function saveBooks(books) {
  fs.writeFileSync(DB_FILE, JSON.stringify(books, null, 2));
}

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

function callYabetoo(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const options = {
      hostname: YABETOO_API,
      path: urlPath,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SECRET_KEY}`,
        'Content-Length': Buffer.byteLength(data)
      }
    };
    const req = https.request(options, (res) => {
      let responseData = '';
      res.on('data', (chunk) => responseData += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(responseData) });
        } catch(e) {
          resolve({ status: res.statusCode, data: { error: responseData } });
        }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function checkAdminAuth(req) {
  const auth = req.headers['authorization'];
  if (!auth) return false;
  const token = auth.replace('Bearer ', '');
  return token === ADMIN_PASSWORD;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch(e) {
        resolve({});
      }
    });
    req.on('error', reject);
  });
}

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
    return respond(res, 200, { status: 'ok', message: 'Boutique Pascal Backend' });
  }

  // ─── GET /books (public - liste des livres) ───
  if (req.method === 'GET' && pathname === '/books') {
    const books = loadBooks();
    // Ne pas exposer le pdfLink publiquement (sécurité)
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

  // ─── ADMIN: Liste complète (avec pdfLink) ───
  if (req.method === 'GET' && pathname === '/admin/books') {
    if (!checkAdminAuth(req)) return respond(res, 401, { error: 'Non autorisé' });
    const books = loadBooks();
    return respond(res, 200, { books });
  }

  // ─── ADMIN: Ajouter un livre ───
  if (req.method === 'POST' && pathname === '/admin/books') {
    if (!checkAdminAuth(req)) return respond(res, 401, { error: 'Non autorisé' });
    const body = await readBody(req);
    const books = loadBooks();
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
    saveBooks(books);
    return respond(res, 200, { success: true, book: newBook });
  }

  // ─── ADMIN: Modifier un livre ───
  if (req.method === 'PUT' && pathname.startsWith('/admin/books/')) {
    if (!checkAdminAuth(req)) return respond(res, 401, { error: 'Non autorisé' });
    const id = Number(pathname.split('/').pop());
    const body = await readBody(req);
    const books = loadBooks();
    const idx = books.findIndex(b => b.id === id);
    if (idx === -1) return respond(res, 404, { error: 'Livre non trouvé' });
    books[idx] = { ...books[idx], ...body, id };
    saveBooks(books);
    return respond(res, 200, { success: true, book: books[idx] });
  }

  // ─── ADMIN: Supprimer un livre ───
  if (req.method === 'DELETE' && pathname.startsWith('/admin/books/')) {
    if (!checkAdminAuth(req)) return respond(res, 401, { error: 'Non autorisé' });
    const id = Number(pathname.split('/').pop());
    let books = loadBooks();
    books = books.filter(b => b.id !== id);
    saveBooks(books);
    return respond(res, 200, { success: true });
  }

  // ─── PAYMENT: Créer un payment intent ───
  if (req.method === 'POST' && pathname === '/payment') {
    if (!SECRET_KEY) {
      return respond(res, 500, { error: 'Clé secrète manquante' });
    }
    const payload = await readBody(req);
    const { action } = payload;

    try {
      if (action === 'create') {
        const books = loadBooks();
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

        // Si paiement réussi, on renvoie le lien PDF
        if (result.data.status === 'succeeded') {
          const books = loadBooks();
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

  // ─── Servir admin.html (page statique) ───
  if (req.method === 'GET' && pathname === '/admin.html') {
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

  return respond(res, 404, { error: 'Route non trouvée' });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Boutique Pascal Backend démarré sur port ${PORT}`);
});
