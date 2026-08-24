const http = require('http');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, 'public', 'test-store.html'), 'utf8');

const body = JSON.stringify({
  name: 'DARK STORE - Marche Noir RP',
  description: 'Le marche noir RP. Produits garantis, livraison anonyme.',
  html_content: html,
  css_content: '',
  js_content: ''
});

// Login as DarkStore_Owner first
const loginBody = JSON.stringify({ username: 'DarkStore_Owner', password: 'dark1234' });

const reqLogin = http.request({
  hostname: 'localhost', port: 3000, path: '/api/login', method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Content-Length': loginBody.length }
}, res => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    const { token } = JSON.parse(data);
    console.log('Login OK, token:', token.substring(0, 8) + '...');

    const reqSite = http.request({
      hostname: 'localhost', port: 3000, path: '/api/sites', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'Authorization': 'Bearer ' + token }
    }, res2 => {
      let d = '';
      res2.on('data', chunk => d += chunk);
      res2.on('end', () => {
        const result = JSON.parse(d);
        console.log('Site soumis!');
        console.log('ID:', result.id);
        console.log('Slug:', result.slug);
        console.log('Status:', result.status);
        
        // Auto-approve as admin
        const adminBody = JSON.stringify({ username: 'admin', password: '2022' });
        const reqAdmin = http.request({
          hostname: 'localhost', port: 3000, path: '/api/login', method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': adminBody.length }
        }, res3 => {
          let a = '';
          res3.on('data', chunk => a += chunk);
          res3.on('end', () => {
            const { token: adminToken } = JSON.parse(a);
            const reqApprove = http.request({
              hostname: 'localhost', port: 3000, path: `/api/sites/${result.id}/approve`, method: 'PUT',
              headers: { 'Authorization': 'Bearer ' + adminToken }
            }, res4 => {
              let ap = '';
              res4.on('data', chunk => ap += chunk);
              res4.on('end', () => {
                console.log('Approuve par admin!');
                console.log('URL: http://localhost:3000/site/' + result.slug);
              });
            });
            reqApprove.end();
          });
        });
        reqAdmin.write(adminBody);
        reqAdmin.end();
      });
    });
    reqSite.write(body);
    reqSite.end();
  });
});
reqLogin.write(loginBody);
reqLogin.end();
