// Error handling for unhandled rejections/exceptions
process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
});
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

const express = require('express');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const { google } = require('googleapis');
const jwt = require('jsonwebtoken');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const multer = require('multer');
const { Sequelize, DataTypes, Op } = require('sequelize');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');


let pgDriver = null;

try { pgDriver = require('pg'); } catch (e) {}
try { require('pg-hstore'); } catch (e) {}

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 5000;
const SHEET_NAME = process.env.GOOGLE_SHEET_NAME || 'Sheet1';
const GALLERY_PATH = process.env.GALLERY_FOLDER || 'our work';

// Normalize Vercel Serverless Function rewrites (e.g. /api/index.js/v1/... -> /api/v1/...)
app.use((req, res, next) => {
    const rawUrl = req.url || '/';
    if (rawUrl.startsWith('/api/index.js')) {
        const remainder = rawUrl.substring('/api/index.js'.length);
        const invokePath = req.headers['x-matched-path'] || req.headers['x-invoke-path'] || req.headers['x-original-uri'];
        
        if (remainder && remainder.startsWith('/')) {
            req.url = '/api' + remainder;
        } else if (invokePath && invokePath !== '/api/index.js' && invokePath !== '/api') {
            req.url = invokePath + (remainder || '');
        } else if (!remainder || remainder.startsWith('?')) {
            req.url = '/health' + (remainder || '');
        } else {
            req.url = remainder || '/';
        }
    }
    next();
});

// Middleware
app.use(helmet({ 
    contentSecurityPolicy: false, // Disabled to prevent breaking frontend assets/images
    crossOriginEmbedderPolicy: false 
}));

const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 1000, // Limit each IP to 1000 requests per `window`
    message: { success: false, message: 'Too many requests, please try again later.' }
});
app.use(generalLimiter);

// Dynamic CORS Configuration
const allowedOrigins = process.env.CORS_ORIGIN 
    ? process.env.CORS_ORIGIN.split(',').map(o => o.trim()).filter(Boolean)
    : [];

app.use(cors({ 
    origin: (origin, callback) => {
        // Allow requests with no origin (like mobile apps, curl, or server-to-server)
        if (!origin) return callback(null, true);
        
        // If CORS_ORIGIN is '*' or empty/unspecified, allow all requesting origins dynamically
        if (allowedOrigins.length === 0 || allowedOrigins.includes('*')) {
            return callback(null, origin);
        }
        
        // Check allowed origins, vercel domains, or localhost
        const isAllowed = allowedOrigins.includes(origin) || 
                          /^https:\/\/.*\.vercel\.app$/.test(origin) || 
                          /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin);

        if (isAllowed) {
            return callback(null, origin);
        }
        return callback(null, origin);
    },
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
    credentials: true
}));
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'frontend')));
app.use('/admin-frontend', express.static(path.join(__dirname, '..', 'admin-frontend')));
app.use('/admin.html', (req, res) => res.sendFile(path.join(__dirname, '..', 'admin-frontend', 'admin.html')));
app.use('/admin', (req, res) => res.sendFile(path.join(__dirname, '..', 'admin-frontend', 'admin.html')));

// Serverless (Vercel) Auto-Initialization Middleware
app.use(async (req, res, next) => {
    if (!isInitialized) {
        try {
            await initializeApp();
        } catch (err) {
            console.error('Serverless auto-initialization error:', err);
        }
    }
    next();
});

// SQL Database Initialization (Sequelize + SQLite or Postgres)
let sequelize;

const JSON_DB_FILE = process.env.VERCEL || process.env.NODE_ENV === 'production'
    ? path.join('/tmp', 'donors_persistent.json')
    : path.join(__dirname, 'donors.json');

function loadDonorsFromJSON() {
    try {
        if (fs.existsSync(JSON_DB_FILE)) {
            const raw = fs.readFileSync(JSON_DB_FILE, 'utf-8');
            const data = JSON.parse(raw);
            if (Array.isArray(data)) return data;
        }
    } catch (e) {
        console.error('Error loading JSON DB:', e.message);
    }
    return [];
}

function saveDonorToJSON(donor) {
    try {
        const existing = loadDonorsFromJSON();
        const foundIndex = existing.findIndex(d => String(d.phoneNumber) === String(donor.phoneNumber) && String(d.fullName) === String(donor.fullName));
        const donorData = {
            id: donor.id || Date.now(),
            fullName: donor.fullName,
            dateOfBirth: donor.dateOfBirth,
            gender: donor.gender,
            weight: donor.weight,
            phoneNumber: donor.phoneNumber,
            bloodGroup: donor.bloodGroup,
            state: donor.state || '',
            district: donor.district || '',
            mandal: donor.mandal || '',
            village: donor.village || '',
            pincode: donor.pincode || '',
            registeredAt: donor.registeredAt || new Date(),
            isVerified: donor.isVerified || false
        };
        if (foundIndex !== -1) {
            existing[foundIndex] = { ...existing[foundIndex], ...donorData };
        } else {
            existing.unshift(donorData);
        }
        fs.writeFileSync(JSON_DB_FILE, JSON.stringify(existing, null, 2));
    } catch (e) {
        console.error('Error saving to JSON DB:', e.message);
    }
}

const fallbackDonorsStore = loadDonorsFromJSON();

function createFallbackSequelize() {
    return {
        authenticate: async () => console.warn('Database connection unavailable (using fallback mode)'),
        sync: async () => console.warn('Database sync unavailable (using fallback mode)'),
        define: (modelName) => ({
            name: modelName,
            findOrCreate: async (options) => {
                const existing = fallbackDonorsStore.find(d => d.phoneNumber === options?.where?.phoneNumber);
                if (existing) return [existing, false];
                const newObj = { ...options?.defaults, id: Date.now() };
                fallbackDonorsStore.unshift(newObj);
                saveDonorToJSON(newObj);
                return [newObj, true];
            },
            create: async (data) => {
                const newObj = { ...data, id: Date.now(), registeredAt: new Date() };
                fallbackDonorsStore.unshift(newObj);
                saveDonorToJSON(newObj);
                return newObj;
            },
            findAll: async () => loadDonorsFromJSON(),
            findOne: async () => loadDonorsFromJSON()[0] || null,
            findByPk: async (id) => loadDonorsFromJSON().find(d => String(d.id) === String(id)) || null,
            count: async () => loadDonorsFromJSON().length,
            destroy: async (options) => {
                if (options?.where?.id) {
                    const idx = fallbackDonorsStore.findIndex(d => String(d.id) === String(options.where.id));
                    if (idx !== -1) fallbackDonorsStore.splice(idx, 1);
                    try { fs.writeFileSync(JSON_DB_FILE, JSON.stringify(fallbackDonorsStore, null, 2)); } catch (e) {}
                }
                return 1;
            },
            save: async () => {}
        })
    };
}

let isDbConnected = false;
let dbDialect = 'sqlite';

function initSequelize() {
    const dbUrl = process.env.DATABASE_URL;
    if (dbUrl) {
        console.log('Attempting PostgreSQL database connection via DATABASE_URL');
        try {
            const options = {
                dialect: 'postgres',
                dialectOptions: {
                    ssl: { require: true, rejectUnauthorized: false }
                },
                logging: false,
                pool: { max: 5, min: 0, acquire: 30000, idle: 10000 }
            };
            if (pgDriver) options.dialectModule = pgDriver;
            dbDialect = 'postgresql';
            return new Sequelize(dbUrl, options);
        } catch (err) {
            console.error('Postgres Sequelize Initialization Error:', err.message);
        }
    }

    console.log('DATABASE_URL not set or invalid. Falling back to SQLite database connection');
    dbDialect = 'sqlite';
    const dbPath = process.env.VERCEL || process.env.NODE_ENV === 'production' 
        ? ':memory:' 
        : path.join(__dirname, 'database.sqlite');

    try {
        let sqliteOptions = {
            dialect: 'sqlite',
            storage: dbPath,
            logging: false
        };
        try {
            sqliteOptions.dialectModule = require('sqlite3');
        } catch (e) {}
        return new Sequelize(sqliteOptions);
    } catch (err) {
        console.error('SQLite Sequelize Initialization Error:', err.message);
        try {
            return new Sequelize({ dialect: 'sqlite', storage: ':memory:', logging: false });
        } catch (e2) {
            console.error('Fallback Sequelize Initialization Error:', e2.message);
            return createFallbackSequelize();
        }
    }
}

sequelize = initSequelize() || createFallbackSequelize();

// Donor Model
const Donor = sequelize.define('Donor', {
    fullName: { type: DataTypes.STRING, allowNull: false },
    dateOfBirth: DataTypes.DATEONLY,
    gender: DataTypes.STRING,
    weight: DataTypes.STRING,
    phoneNumber: { type: DataTypes.STRING, allowNull: false },
    bloodGroup: { type: DataTypes.STRING, allowNull: false },
    state: DataTypes.STRING,
    district: DataTypes.STRING,
    mandal: DataTypes.STRING,
    village: DataTypes.STRING,
    pincode: DataTypes.STRING,
    registeredAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
    isVerified: { type: DataTypes.BOOLEAN, defaultValue: false }
});

// Feedback Model
const Feedback = sequelize.define('Feedback', {
    name: { type: DataTypes.STRING, allowNull: false },
    rating: { type: DataTypes.INTEGER, allowNull: false, validate: { min: 1, max: 5 } },
    comment: { type: DataTypes.TEXT, allowNull: false },
    isApproved: { type: DataTypes.BOOLEAN, defaultValue: false },
    createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
});

// Admin Config
const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret-for-dev';
const ADMIN_USERS = [
    { username: process.env.ADMIN1_USER, password: process.env.ADMIN1_PASS },
    { username: process.env.ADMIN2_USER, password: process.env.ADMIN2_PASS }
].filter(u => u.username && u.password);

// Whitelisted WhatsApp Numbers for Admin Login
const WHITELISTED_NUMBERS = [
    process.env.ADMIN_WHATSAPP_1 || '919948550301',
    process.env.ADMIN_WHATSAPP_2 || '919491463888'
];
let adminOtps = new Map(); // Temporary OTP storage

// Serve static files (HTML, CSS, JS, Assets)
app.use(express.static(path.join(__dirname, '..', 'frontend')));
app.use(express.static(path.join(__dirname, '..', 'admin-frontend')));

// Root route
app.get('/', (req, res) => {
    if (req.headers.accept && req.headers.accept.includes('text/html')) {
        const frontendPath = path.join(__dirname, '..', 'frontend', 'index.html');
        if (fs.existsSync(frontendPath)) {
            return res.sendFile(frontendPath);
        }
    }
    res.json({
        status: 'ok',
        service: 'Mahesh Babu Bloods Backend API Service',
        health: '/health',
        initialized: isInitialized,
        database: isDbConnected ? dbDialect : (dbDialect === 'postgresql' ? 'postgresql (disconnected)' : 'sqlite'),
        dbConnected: isDbConnected,
        hasSheets: !!sheets
    });
});

// Google Sheets Config
const SERVICE_ACCOUNT_FILE = path.join(__dirname, '..', 'service-account.json');
const SPREADSHEET_ID = process.env.GOOGLE_SPREADSHEET_ID;

let sheets;
let isInitialized = false;

async function initializeApp() {
    if (isInitialized) return;
    
    // Auth with DB
    try {
        if (sequelize && typeof sequelize.authenticate === 'function') {
            await sequelize.authenticate();
            isDbConnected = true;
            await sequelize.sync({ alter: false });
            console.log(`SQL Database (${dbDialect}) initialized successfully.`);
        }
    } catch (err) {
        isDbConnected = false;
        console.error('SQL Database Initialization error:', err.message);
    }

    // Auth with Google Sheets
    try {
        let auth;
        if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
            try {
                let jsonStr = process.env.GOOGLE_SERVICE_ACCOUNT_JSON.trim();
                if (!jsonStr.startsWith('{')) {
                    jsonStr = Buffer.from(jsonStr, 'base64').toString('utf8');
                }
                const credentials = JSON.parse(jsonStr);
                if (credentials.private_key && typeof credentials.private_key === 'string') {
                    credentials.private_key = credentials.private_key.replace(/\\n/g, '\n');
                }
                auth = new google.auth.GoogleAuth({
                    credentials,
                    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
                });
                sheets = google.sheets({ version: 'v4', auth });
                console.log('Google Sheets: Service Account (from env) initialized.');
            } catch (e) {
                console.error('Failed to parse GOOGLE_SERVICE_ACCOUNT_JSON:', e.message);
            }
        } else if (fs.existsSync(SERVICE_ACCOUNT_FILE)) {
            auth = new google.auth.GoogleAuth({
                keyFile: SERVICE_ACCOUNT_FILE,
                scopes: ['https://www.googleapis.com/auth/spreadsheets'],
            });
            sheets = google.sheets({ version: 'v4', auth });
            console.log('Google Sheets: Service Account file initialized.');
        }

        if (sheets && SPREADSHEET_ID) {
            await syncSheetsToSQL();
        }
    } catch (err) {
        console.error('Google Sheets Initialization error:', err.message);
    }

    isInitialized = true;
}


async function syncSheetsToSQL() {
    try {
        if (!sheets || !SPREADSHEET_ID) return;
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SHEET_NAME}!A2:L`, 
        });
        const rows = response.data.values;
        if (rows && rows.length > 0) {
            for (const row of rows) {
                if (!row || !row[0] || !row[3]) continue;
                const phone = String(row[3]).trim();
                const name = String(row[0]).trim();
                if (!phone || !name) continue;

                const donorObj = {
                    fullName: name,
                    dateOfBirth: row[1] || null,
                    gender: row[2] || 'Not specified',
                    weight: row[10] || '',
                    phoneNumber: phone,
                    bloodGroup: row[4] || 'O+',
                    state: row[5] || '',
                    district: row[6] || '',
                    mandal: row[7] || '',
                    village: row[8] || '',
                    pincode: row[11] || '',
                    registeredAt: row[9] ? new Date(row[9]) : new Date(),
                    isVerified: false
                };

                saveDonorToJSON(donorObj);

                await Donor.findOrCreate({
                    where: { phoneNumber: phone, fullName: name },
                    defaults: donorObj
                }).catch(e => console.error('findOrCreate row error:', e.message));
            }
            console.log(`✅ Synced ${rows.length} records.`);
        }
    } catch (error) {
        console.error('Sync Error:', error.message);
    }
}

// Google Sheets Batching System
let donorBatch = [];
let batchTimeout = null;

async function processBatch() {
    if (donorBatch.length === 0) return;
    
    const batchToProcess = [...donorBatch];
    donorBatch = []; // Clear queue

    try {
        if (!sheets || !SPREADSHEET_ID) return;
        
        const values = batchToProcess.map(donor => [
            donor.fullName,
            donor.dateOfBirth,
            donor.gender,
            donor.phoneNumber,
            donor.bloodGroup,
            donor.state || '',
            donor.district || '',
            donor.mandal || '',
            donor.village || '',
            new Date(donor.registeredAt || new Date()).toLocaleString(),
            donor.weight || '',
            donor.pincode || ''
        ]);

        await sheets.spreadsheets.values.append({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SHEET_NAME}!A:L`,
            valueInputOption: 'USER_ENTERED',
            requestBody: { values }
        });
        console.log(`✅ Synced batch of ${values.length} donors to Google Sheets.`);
    } catch (error) {
        console.error('Google Sheets Batch Append Error:', error.message);
        // Put records back in queue if the API failed (e.g., rate limit)
        donorBatch.unshift(...batchToProcess);
    }
}

async function appendDonorToGoogleSheet(donor) {
    donorBatch.push(donor);
    
    // On Vercel or serverless production, process immediately because background timeouts are unreliable
    if (process.env.VERCEL || process.env.NODE_ENV === 'production') {
        await processBatch();
        return;
    }
    
    // Auto-process batch every 5 minutes
    if (!batchTimeout) {
        batchTimeout = setTimeout(() => {
            processBatch();
            batchTimeout = null;
        }, 5 * 60 * 1000);
    }
    
    // Process immediately if batch reaches 50 to avoid request body size limits
    if (donorBatch.length >= 50) {
        clearTimeout(batchTimeout);
        batchTimeout = null;
        processBatch();
    }
}



// Storage for "Our Work" Gallery
const isProdOrVercel = !!(process.env.VERCEL || process.env.NODE_ENV === 'production');
const UPLOAD_DIR = path.join(isProdOrVercel ? '/tmp' : path.join(__dirname, '..', 'frontend'), 'assets', GALLERY_PATH);
if (!fs.existsSync(UPLOAD_DIR)) {
    try {
        fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    } catch (e) {
        console.error('Failed to create upload dir:', e.message);
    }
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});
const upload = multer({ 
    storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB limit
    fileFilter: (req, file, cb) => {
        const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
        if (allowedMimeTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type. Only JPG, PNG, GIF, and WEBP are allowed.'));
        }
    }
});

// Verification Middleware
const verifyAdmin = (req, res, next) => {
    const authHeader = req.headers.authorization;
    const token = (authHeader && authHeader.split(' ')[1]) || req.query.token;
    if (!token) return res.status(403).json({ success: false, message: 'No token' });
    try {
        const verified = jwt.verify(token, JWT_SECRET);
        if (verified.role === 'admin') {
            req.user = verified;
            next();
        } else {
            res.status(403).json({ success: false, message: 'Not admin' });
        }
    } catch (err) {
        res.status(401).json({ success: false, message: 'Invalid token' });
    }
};

const sharedState = { currentAlert: null };

// API Endpoints
app.get(['/health', '/api/health'], (req, res) => res.json({
    status: 'ok',
    initialized: isInitialized,
    database: isDbConnected ? dbDialect : (dbDialect === 'postgresql' ? 'postgresql (disconnected)' : 'sqlite'),
    dbConnected: isDbConnected,
    hasSheets: !!sheets
}));

const donorLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 500, // Limit each IP to 500 donor registrations per windowMs
    message: { success: false, message: 'Too many registrations from this IP, please try again later.' }
});

app.post('/api/v1/donors', donorLimiter, async (req, res) => {
    try {
        const { fullName, dateOfBirth, gender, weight, phoneNumber, bloodGroup, address } = req.body;
        let newDonor;
        try {
            newDonor = await Donor.create({
                fullName, dateOfBirth, gender, weight, phoneNumber, bloodGroup,
                state: address?.state || '',
                district: address?.district || '',
                mandal: address?.mandal || '',
                village: address?.village || '',
                pincode: address?.pincode || ''
            });
        } catch (dbErr) {
            console.error('Primary DB save error, using fallback memory store:', dbErr.message);
            newDonor = {
                id: Date.now(),
                fullName, dateOfBirth, gender, weight, phoneNumber, bloodGroup,
                state: address?.state || '',
                district: address?.district || '',
                mandal: address?.mandal || '',
                village: address?.village || '',
                pincode: address?.pincode || '',
                registeredAt: new Date()
            };
            fallbackDonorsStore.unshift(newDonor);
        }
        saveDonorToJSON(newDonor);
        await appendDonorToGoogleSheet(newDonor).catch(e => console.error('Sheet append error:', e.message));
        res.status(201).json({ success: true, donor: newDonor });
    } catch (err) {
        console.error('Registration handler catch:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

app.get('/api/v1/donations/count', async (req, res) => {
    try {
        const count = await Donor.count();
        res.json({ count });
    } catch (err) {
        res.json({ count: 0 });
    }
});

app.get('/api/v1/public/gallery', (req, res) => {
    try {
        let repoDir = path.join(__dirname, '..', 'frontend', 'assets', GALLERY_PATH);
        let tmpDir = UPLOAD_DIR;
        let filesSet = new Set();
        if (fs.existsSync(repoDir)) {
            try {
                fs.readdirSync(repoDir).filter(f => /\.(jpg|jpeg|png|gif|webp)$/i.test(f)).forEach(f => filesSet.add(f));
            } catch (e) {}
        }
        if (fs.existsSync(tmpDir) && tmpDir !== repoDir) {
            try {
                fs.readdirSync(tmpDir).filter(f => /\.(jpg|jpeg|png|gif|webp)$/i.test(f)).forEach(f => filesSet.add(f));
            } catch (e) {}
        }
        let files = Array.from(filesSet);
        
        // Separate admin uploads (timestamp prefix) from manual files
        const isAdminUpload = (f) => /^\d{13,}-/.test(f);
        const adminFiles = files.filter(isAdminUpload);
        const manualFiles = files.filter(f => !isAdminUpload(f));
        
        // Sort admin files newest first (descending)
        adminFiles.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
        // Sort manual files naturally (1.jpg < 2.jpg)
        manualFiles.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
        
        files = [...adminFiles, ...manualFiles];
        res.json({ success: true, images: files.map(img => `assets/${GALLERY_PATH}/${img}`) });
    } catch (err) {
        res.json({ success: false, images: [] });
    }
});

// Load Admin Backend Routes
require('./adminRoutes')(app, {
    JWT_SECRET,
    WHITELISTED_NUMBERS,
    adminOtps,
    upload,
    GALLERY_PATH,
    Donor,
    Feedback,
    sharedState,
    syncSheetsToSQL,
    loadDonorsFromJSON,
    fallbackDonorsStore
});

const feedbackLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 50, // Limit each IP to 50 feedback submissions per window
    message: { success: false, message: 'Too many feedback submissions, please try again later.' }
});

app.post('/api/v1/feedbacks', feedbackLimiter, async (req, res) => {
    try {
        const { name, rating, comment } = req.body;
        if (!name || rating === undefined || !comment) {
            return res.status(400).json({ success: false, message: 'Name, rating, and comment are required.' });
        }
        const parsedRating = parseInt(rating, 10);
        if (isNaN(parsedRating) || parsedRating < 1 || parsedRating > 5) {
            return res.status(400).json({ success: false, message: 'Rating must be an integer between 1 and 5.' });
        }
        const newFeedback = await Feedback.create({ name, rating: parsedRating, comment });
        res.status(201).json({ success: true, feedback: newFeedback });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.get('/api/v1/public/feedbacks', async (req, res) => {
    try {
        const feedbacks = await Feedback.findAll({
            where: { isApproved: true },
            order: [['createdAt', 'DESC']],
            limit: 20
        });
        res.json({ success: true, feedbacks });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.get('/api/v1/public/alert', (req, res) => res.json({ success: true, alert: sharedState.currentAlert?.isActive ? sharedState.currentAlert : null }));


// Start server if not running in a serverless environment (like Vercel)
const isServerlessEnv = !!(process.env.VERCEL || process.env.VERCEL_ENV || process.env.NOW_REGION || process.env.AWS_LAMBDA_FUNCTION_NAME);
if (!isServerlessEnv) {
    initializeApp().then(() => {
        console.log(`Server running on http://localhost:${PORT}`);
        app.listen(PORT, () => console.log(`Server on ${PORT}`));
    });
}

module.exports = app;
