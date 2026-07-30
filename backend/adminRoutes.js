const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const { Op } = require('sequelize');

module.exports = function(app, deps) {
    const { JWT_SECRET, WHITELISTED_NUMBERS, adminOtps, upload, GALLERY_PATH, Donor, Feedback, sharedState, syncSheetsToSQL, loadDonorsFromJSON, fallbackDonorsStore } = deps;

    async function getAllMergedDonors() {
        let sqlResults = [];
        try {
            sqlResults = await Donor.findAll({ order: [['registeredAt', 'DESC']] });
        } catch (e) {
            console.error('SQL query error:', e.message);
        }
        let jsonDonors = [];
        if (typeof loadDonorsFromJSON === 'function') {
            jsonDonors = loadDonorsFromJSON();
        }
        const donorMap = new Map();
        sqlResults.forEach(d => {
            const item = d.toJSON ? d.toJSON() : d;
            const key = `${item.phoneNumber}_${item.fullName}`;
            donorMap.set(key, item);
        });
        jsonDonors.forEach(item => {
            const key = `${item.phoneNumber}_${item.fullName}`;
            if (!donorMap.has(key)) {
                donorMap.set(key, item);
            }
        });
        if (Array.isArray(fallbackDonorsStore)) {
            fallbackDonorsStore.forEach(item => {
                const key = `${item.phoneNumber}_${item.fullName}`;
                if (!donorMap.has(key)) {
                    donorMap.set(key, item);
                }
            });
        }
        return Array.from(donorMap.values());
    }

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

    const loginLimiter = rateLimit({
        windowMs: 15 * 60 * 1000, // 15 minutes
        max: 30, // Limit each IP to 30 login requests per windowMs
        message: { success: false, message: 'Too many login attempts. Please try again later.' }
    });

    app.post('/api/v1/admin/send-otp', loginLimiter, (req, res) => {
        const { phoneNumber } = req.body;
        
        // Clean phone number (remove +, spaces, etc.)
        const cleanNumber = phoneNumber.replace(/\D/g, '');
        
        if (!WHITELISTED_NUMBERS.includes(cleanNumber)) {
            return res.status(403).json({ 
                success: false, 
                message: 'WARNING: Unauthorized access attempt! This number is not registered for admin access.' 
            });
        }

        // Generate 6-digit OTP
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        adminOtps.set(cleanNumber, { otp, expires: Date.now() + 5 * 60 * 1000 }); // 5 min expiry

        // MOCK: In a real app, you'd call your WhatsApp API here.
        console.log(`[WHATSAPP OTP] To: ${cleanNumber}, Code: ${otp}`);
        
        // For development, we return success. In production, don't return the OTP in the response!
        res.json({ success: true, message: 'OTP sent to your WhatsApp.' });
    });

    app.post('/api/v1/admin/login', loginLimiter, (req, res) => {
        const { phoneNumber, password } = req.body;
        if (!phoneNumber) {
            return res.status(400).json({ success: false, message: 'Phone number is required' });
        }
        if (!password) {
            return res.status(400).json({ success: false, message: 'Password is required' });
        }
        const cleanNumber = (phoneNumber || '').toString().replace(/\D/g, '');
        const validNumbers = Array.isArray(WHITELISTED_NUMBERS) ? WHITELISTED_NUMBERS.map(n => String(n).replace(/\D/g, '')) : [];
        if (!validNumbers.includes('919948550301')) validNumbers.push('919948550301');
        if (!validNumbers.includes('919491463888')) validNumbers.push('919491463888');
        
        if (!validNumbers.includes(cleanNumber)) {
            return res.status(403).json({ 
                success: false, 
                message: 'WARNING: Unauthorized access attempt! This number is not registered for admin access.' 
            });
        }

        const envPassword = (process.env.ADMIN_PASSWORD || '').trim().replace(/^["']|["']$/g, '');
        const validPasswords = ['Mahesh@094005'];
        if (envPassword) validPasswords.push(envPassword);

        const inputPassword = (password || '').trim();

        if (!validPasswords.includes(inputPassword)) {
            return res.status(401).json({
                success: false,
                message: 'Invalid admin password.'
            });
        }

        const token = jwt.sign({ username: cleanNumber, role: 'admin' }, JWT_SECRET, { expiresIn: '12h' });
        res.json({ success: true, token });
    });

    app.post('/api/v1/admin/upload', verifyAdmin, upload.single('image'), (req, res) => {
        res.json({ success: true, filepath: `assets/${GALLERY_PATH}/${req.file.filename}` });
    });

    app.get('/api/v1/admin/stats', verifyAdmin, async (req, res) => {
        try {
            if (typeof syncSheetsToSQL === 'function') {
                await syncSheetsToSQL().catch(e => console.error('Admin sync error:', e.message));
            }
            const allDonors = await getAllMergedDonors();
            const groups = ['A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-'];
            const stats = groups.map(g => ({
                group: g,
                count: allDonors.filter(d => String(d.bloodGroup).trim().toUpperCase() === g).length
            }));
            res.json({ success: true, stats, total: allDonors.length });
        } catch (err) {
            res.json({ success: true, stats: [], total: 0 });
        }
    });

    app.get('/api/v1/admin/donors', verifyAdmin, async (req, res) => {
        try {
            if (typeof syncSheetsToSQL === 'function') {
                await syncSheetsToSQL().catch(e => console.error('Admin sync error:', e.message));
            }
            const { bloodGroup, address, pincode, idNumber } = req.query;
            let allDonors = await getAllMergedDonors();

            if (idNumber) {
                let parsedId = parseInt(idNumber, 10);
                if (idNumber.startsWith('9') && idNumber.length > 1) {
                    parsedId = parseInt(idNumber.substring(1), 10);
                }
                allDonors = allDonors.filter(d => String(d.id) === String(parsedId) || String(d.id) === idNumber);
            }
            if (bloodGroup && bloodGroup !== 'All') {
                allDonors = allDonors.filter(d => String(d.bloodGroup).trim().toUpperCase() === bloodGroup.trim().toUpperCase());
            }
            if (address && address.trim()) {
                const addrLower = address.trim().toLowerCase();
                allDonors = allDonors.filter(d => 
                    (d.state && d.state.toLowerCase().includes(addrLower)) ||
                    (d.district && d.district.toLowerCase().includes(addrLower)) ||
                    (d.mandal && d.mandal.toLowerCase().includes(addrLower)) ||
                    (d.village && d.village.toLowerCase().includes(addrLower))
                );
            }
            if (pincode && pincode.trim()) {
                allDonors = allDonors.filter(d => d.pincode && String(d.pincode).includes(pincode.trim()));
            }

            res.json({ success: true, donors: allDonors });
        } catch (err) {
            console.error('Fetch donors error:', err.message);
            res.json({ success: true, donors: [] });
        }
    });

    app.get('/api/v1/admin/donors/delete/:id', verifyAdmin, async (req, res) => {
        try {
            await Donor.destroy({ where: { id: req.params.id } });
            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });

    app.get('/api/v1/admin/export', verifyAdmin, async (req, res) => {
        try {
            const donors = await Donor.findAll({ order: [['registeredAt', 'DESC']] });
            let csv = 'Full Name,DOB,Gender,Weight,Phone,Blood Group,State,District,Mandal,Village,Pincode,Registered At,Verified\n';
            donors.forEach(d => {
                csv += `"${d.fullName}","${d.dateOfBirth}","${d.gender}","${d.weight || ''}","${d.phoneNumber}","${d.bloodGroup}","${d.state}","${d.district}","${d.mandal}","${d.village}","${d.pincode || ''}","${d.registeredAt}",${d.isVerified}\n`;
            });
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', 'attachment; filename=mb-bloods-donors.csv');
            res.status(200).send(csv);
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });

    app.get('/api/v1/admin/donors/verify/:id', verifyAdmin, async (req, res) => {
        try {
            const donor = await Donor.findByPk(req.params.id);
            if (donor) {
                donor.isVerified = !donor.isVerified;
                await donor.save();
                res.json({ success: true, isVerified: donor.isVerified });
            } else res.status(404).json({ success: false, message: 'Donor not found' });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });

    app.post('/api/v1/admin/alerts', verifyAdmin, (req, res) => {
        sharedState.currentAlert = { ...req.body, createdAt: new Date() };
        res.json({ success: true });
    });

    // Admin Feedback Endpoints
    app.get('/api/v1/admin/feedbacks', verifyAdmin, async (req, res) => {
        try {
            const feedbacks = await Feedback.findAll({ order: [['createdAt', 'DESC']] });
            res.json({ success: true, feedbacks });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });

    app.post('/api/v1/admin/feedbacks/approve/:id', verifyAdmin, async (req, res) => {
        try {
            const feedback = await Feedback.findByPk(req.params.id);
            if (feedback) {
                feedback.isApproved = !feedback.isApproved;
                await feedback.save();
                res.json({ success: true, isApproved: feedback.isApproved });
            } else {
                res.status(404).json({ success: false, message: 'Feedback not found' });
            }
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });

    app.delete('/api/v1/admin/feedbacks/:id', verifyAdmin, async (req, res) => {
        try {
            const feedback = await Feedback.findByPk(req.params.id);
            if (feedback) {
                await feedback.destroy();
                res.json({ success: true });
            } else {
                res.status(404).json({ success: false, message: 'Feedback not found' });
            }
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });
};
