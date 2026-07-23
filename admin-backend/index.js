const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { Sequelize, DataTypes } = require('sequelize');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5001;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Upload Config
const GALLERY_PATH = 'gallery';
const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });

// Database Connection
const sequelize = process.env.DATABASE_URL
    ? new Sequelize(process.env.DATABASE_URL, { dialect: 'postgres', logging: false, dialectOptions: { ssl: { require: true, rejectUnauthorized: false } } })
    : new Sequelize({ dialect: 'sqlite', storage: path.join(__dirname, 'database.sqlite'), logging: false });

// Models
const Donor = sequelize.define('Donor', {
    fullName: { type: DataTypes.STRING, allowNull: false },
    dateOfBirth: { type: DataTypes.STRING, allowNull: false },
    gender: { type: DataTypes.STRING, allowNull: false },
    weight: { type: DataTypes.STRING },
    phoneNumber: { type: DataTypes.STRING, allowNull: false },
    bloodGroup: { type: DataTypes.STRING, allowNull: false },
    state: { type: DataTypes.STRING, defaultValue: '' },
    district: { type: DataTypes.STRING, defaultValue: '' },
    mandal: { type: DataTypes.STRING, defaultValue: '' },
    village: { type: DataTypes.STRING, defaultValue: '' },
    pincode: { type: DataTypes.STRING, defaultValue: '' },
    isVerified: { type: DataTypes.BOOLEAN, defaultValue: false },
    registeredAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
});

const Feedback = sequelize.define('Feedback', {
    name: { type: DataTypes.STRING, allowNull: false },
    rating: { type: DataTypes.INTEGER, allowNull: false },
    comment: { type: DataTypes.TEXT, allowNull: false },
    isApproved: { type: DataTypes.BOOLEAN, defaultValue: false },
    createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW }
});

const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret-for-dev';
const WHITELISTED_NUMBERS = [
    process.env.ADMIN_WHATSAPP_1 || '919876543210',
    process.env.ADMIN_WHATSAPP_2 || '919012345678'
];
let adminOtps = new Map();
const sharedState = { currentAlert: null };

// Load Admin Routes
const adminRoutes = require('./adminRoutes');
adminRoutes(app, {
    JWT_SECRET,
    WHITELISTED_NUMBERS,
    adminOtps,
    upload,
    GALLERY_PATH,
    Donor,
    Feedback,
    sharedState
});

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'admin-backend' }));

async function startServer() {
    try {
        await sequelize.authenticate();
        await sequelize.sync({ alter: false });
        console.log('Admin Backend Database Initialized.');
        if (process.env.NODE_ENV !== 'production' || process.env.RENDER || !process.env.VERCEL) {
            app.listen(PORT, () => console.log(`Admin Backend listening on port ${PORT}`));
        }
    } catch (err) {
        console.error('Failed to initialize Admin Backend database:', err.message);
    }
}

startServer();

module.exports = app;
