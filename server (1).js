const https = require('https');
const http = require('http');

// Clé secrète depuis variable d'environnement Render
const SECRET_KEY = process.env.YABETOO_SECRET_KEY;
const YABETOO_API = "pay.api.yabetoopay.com";

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };
}

function callYabetoo(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const options = {
      hostname: YABETOO_API,
      path: path,
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

const server = http.createServer((req, res) => {

  if (req.method === 'OPTIONS') {
    res.writeHead(200, corsHeaders());
    res.end();
    return;
  }

  if (req.method === 'GET' && req.url === '/') {
    res.writeHead(200, corsHeaders());
    res.end(JSON.stringify({ status: 'ok', message: 'Boutique Pascal Backend' }));
    return;
  }

  if (req.method === 'POST' && req.url === '/payment') {

    if (!SECRET_KEY) {
      res.writeHead(500, corsHeaders());
      res.end(JSON.stringify({ error: 'Clé secrète manquante sur le serveur' }));
      return;
    }

    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body);
        const { action } = payload;

        if (action === 'create') {
          const result = await callYabetoo('POST', '/v1/payment-intents', {
            amount: Number(payload.amount),
            currency: payload.currency || 'xaf',
            description: `Achat: ${payload.bookTitle}`,
            metadata: { orderId: payload.orderId, bookTitle: payload.bookTitle }
          });

          if (result.status !== 200 && result.status !== 201) {
            res.writeHead(result.status, corsHeaders());
            res.end(JSON.stringify({ error: result.data.message || 'Erreur YaBeTooPay' }));
            return;
          }

          res.writeHead(200, corsHeaders());
          res.end(JSON.stringify({
            intentId: result.data.id,
            clientSecret: result.data.clientSecret
          }));
          return;
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

          res.writeHead(200, corsHeaders());
          res.end(JSON.stringify(result.data));
          return;
        }

        res.writeHead(400, corsHeaders());
        res.end(JSON.stringify({ error: 'Action inconnue: ' + action }));

      } catch(err) {
        res.writeHead(500, corsHeaders());
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  res.writeHead(404, corsHeaders());
  res.end(JSON.stringify({ error: 'Route non trouvée' }));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Boutique Pascal Backend démarré sur port ${PORT}`);
});
