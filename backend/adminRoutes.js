const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const { Op } = require('sequelize');

module.exports = function(app, deps) {
    const { JWT_SECRET, WHITELISTED_NUMBERS, adminOtps, upload, GALLERY_PATH, Donor, Feedback, sharedState, syncSheetsToSQL } = deps;

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
        max: 10, // Limit each IP to 10 login requests per windowMs
        message: { success: false, message: 'Too many login attempts from this IP, please try again after 15 minutes' }
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
        const { phoneNumber } = req.body;
        if (!phoneNumber) {
            return res.status(400).json({ success: false, message: 'Phone number is required' });
        }
        const cleanNumber = phoneNumber.replace(/\D/g, '');
        
        if (WHITELISTED_NUMBERS.includes(cleanNumber)) {
            const token = jwt.sign({ username: cleanNumber, role: 'admin' }, JWT_SECRET, { expiresIn: '12h' });
            res.json({ success: true, token });
        } else {
            res.status(403).json({ 
                success: false, 
                message: 'WARNING: Unauthorized access attempt! This number is not registered for admin access.' 
            });
        }
    });

    app.post('/api/v1/admin/upload', verifyAdmin, upload.single('image'), (req, res) => {
        res.json({ success: true, filepath: `assets/${GALLERY_PATH}/${req.file.filename}` });
    });

    app.get('/api/v1/admin/stats', verifyAdmin, async (req, res) => {
        try {
            if (typeof syncSheetsToSQL === 'function') {
                await syncSheetsToSQL().catch(e => console.error('Admin sync error:', e.message));
            }
            const groups = ['A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-'];
            const stats = await Promise.all(groups.map(async (g) => ({ group: g, count: await Donor.count({ where: { bloodGroup: g } }).catch(() => 0) })));
            const total = await Donor.count().catch(() => 0);
            res.json({ success: true, stats, total });
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
            let where = {};
            if (idNumber) {
                let parsedId = parseInt(idNumber, 10);
                if (idNumber.startsWith('9') && idNumber.length > 1) {
                    parsedId = parseInt(idNumber.substring(1), 10);
                }
                if (!isNaN(parsedId)) {
                    where.id = parsedId;
                }
            }
            if (bloodGroup && bloodGroup !== 'All') where.bloodGroup = bloodGroup;
            if (address) {
                where[Op.or] = [
                    { state: { [Op.like]: `%${address}%` } },
                    { district: { [Op.like]: `%${address}%` } },
                    { mandal: { [Op.like]: `%${address}%` } },
                    { village: { [Op.like]: `%${address}%` } }
                ];
            }
            if (pincode) {
                where.pincode = { [Op.like]: `%${pincode}%` };
            }
            const results = await Donor.findAll({ where, order: [['registeredAt', 'DESC']] });
            res.json({ success: true, donors: results });
        } catch (err) {
            console.error('Fetch donors SQL error, falling back:', err.message);
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
