/**
 * Quick test script to verify routes are working
 * Run: node test-route.js
 */

const express = require('express');
const app = express();

// Simulate the route structure
const draftRoutes = express.Router();
const googleDocsRoutes = express.Router();

// Add test routes
draftRoutes.post('/initiate', (req, res) => {
  console.log('✅ /initiate route matched');
  res.json({ success: true, message: 'Initiate route works!' });
});

draftRoutes.get('/:draftId', (req, res) => {
  console.log('✅ /:draftId route matched');
  res.json({ success: true, message: 'Get draft route works!' });
});

googleDocsRoutes.post('/create', (req, res) => {
  console.log('✅ /create route matched');
  res.json({ success: true, message: 'Create route works!' });
});

googleDocsRoutes.get('/:draftId/editor-url', (req, res) => {
  console.log('✅ /:draftId/editor-url route matched');
  res.json({ success: true, message: 'Editor URL route works!' });
});

// Mount routes (same order as index.js)
app.use('/api/drafts', draftRoutes);
app.use('/api/drafts', googleDocsRoutes);

// Test route matching
const testRoutes = [
  { method: 'POST', path: '/api/drafts/initiate' },
  { method: 'POST', path: '/api/drafts/create' },
  { method: 'GET', path: '/api/drafts/123' },
  { method: 'GET', path: '/api/drafts/123/editor-url' },
];

console.log('Testing route matching...\n');

testRoutes.forEach(({ method, path }) => {
  const req = { method, url: path, path };
  const res = {
    json: (data) => console.log(`  ${method} ${path} →`, data.message),
    status: () => res,
    send: () => {}
  };
  
  app._router.handle(req, res, () => {
    console.log(`  ${method} ${path} → 404 (not matched)`);
  });
});

console.log('\n✅ Route test complete');

