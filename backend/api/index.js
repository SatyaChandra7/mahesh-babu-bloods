// This file is the Vercel Serverless Function entry point.
// It re-exports the Express app from backend/index.js so that
// Vercel can detect and run it automatically.
//
// Vercel ONLY recognizes files inside the "api/" folder as serverless functions.
// Our actual backend logic lives in "backend/index.js".

const app = require('../index.js');

module.exports = app;
