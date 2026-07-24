// Explicitly reference pure JS database drivers so Vercel's NFT bundler includes them
try {
    require('pg');
    require('pg-hstore');
} catch (e) {}

const app = require('../backend/index.js');

module.exports = app;



