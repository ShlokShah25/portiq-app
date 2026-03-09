const express = require('express');
const router = express.Router();
const Visitor = require('../models/Visitor');
const { generateQRToken, generateQRCode, generateQRCodeBuffer } = require('../utils/qrGenerator');
const { generateVisitorPass } = require('../utils/visitorPassGenerator');
const { sendQRViaWhatsApp } = require('../utils/whatsapp');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../../uploads/visitors');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'visitor-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'), false);
    }
  }
});

/**
 * Get visitor categories
 */
router.get('/categories', (req, res) => {
  res.json({ categories: Visitor.VISITOR_CATEGORIES });
});

/**
 * Create new visitor entry
 */
router.post('/entry', upload.single('photograph'), async (req, res) => {
  try {
    const { 
      name, 
      phoneNumber, 
      email,
      company,
      employeeToMeet, 
      department,
      purpose, 
      visitorCategory,
      visitorCategoryDetail,
      vehicleNumber, 
      itemCarried,
      meetingRoom
    } = req.body;
    
    if (!name || !phoneNumber || !employeeToMeet || !purpose || !visitorCategory) {
      return res.status(400).json({ error: 'Name, phone, employee to meet, purpose, and category are required' });
    }

    // If category is Others, detail is required
    if (visitorCategory === 'Others' && (!visitorCategoryDetail || !visitorCategoryDetail.trim())) {
      return res.status(400).json({ error: 'Please specify visitor type when selecting Others' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'Photograph is required' });
    }

    // Validate category
    if (!Visitor.VISITOR_CATEGORIES[visitorCategory]) {
      return res.status(400).json({ error: 'Invalid visitor category' });
    }

    // Generate unique QR token
    let qrToken;
    let isUnique = false;
    let attempts = 0;
    
    while (!isUnique && attempts < 10) {
      qrToken = generateQRToken();
      const existing = await Visitor.findOne({ qrToken, status: 'Inside' });
      if (!existing) {
        isUnique = true;
      }
      attempts++;
    }
    
    if (!isUnique) {
      throw new Error('Failed to generate unique QR token');
    }
    
    // Create visitor record
    const visitor = new Visitor({
      name: name.trim(),
      phoneNumber: phoneNumber.trim(),
      email: email?.trim() || '',
      company: company?.trim() || '',
      employeeToMeet: employeeToMeet.trim(),
      department: department?.trim() || '',
      purpose: purpose.trim(),
      visitorCategory,
      visitorCategoryDetail: visitorCategory === 'Others'
        ? (visitorCategoryDetail || '').trim()
        : '',
      vehicleNumber: vehicleNumber?.trim()?.toUpperCase() || '',
      itemCarried: itemCarried?.trim() || '',
      photograph: `/uploads/visitors/${req.file.filename}`,
      qrToken,
      meetingRoom: meetingRoom?.trim() || '',
      status: 'Inside'
    });

    await visitor.save();

    // Generate QR code
    const qrCodeDataURL = await generateQRCode(qrToken);

    // Generate visitor pass
    const passBuffer = await generateVisitorPass(visitor);
    const passPath = path.join(__dirname, '../../uploads/visitor-passes', `pass-${visitor.visitorId}.png`);
    const passDir = path.dirname(passPath);
    if (!fs.existsSync(passDir)) {
      fs.mkdirSync(passDir, { recursive: true });
    }
    fs.writeFileSync(passPath, passBuffer);
    visitor.badgePrinted = true;
    await visitor.save();

    // Send QR code via WhatsApp
    sendQRViaWhatsApp(phoneNumber, qrToken, name, purpose).catch(err => {
      console.error('WhatsApp send error:', err);
    });

    res.status(201).json({
      success: true,
      visitor: {
        id: visitor._id,
        name: visitor.name,
        visitorId: visitor.visitorId,
        qrToken: visitor.qrToken,
        qrCode: qrCodeDataURL,
        visitorPass: `/uploads/visitor-passes/pass-${visitor.visitorId}.png`,
        category: visitor.visitorCategory,
        categoryDetail: visitor.visitorCategoryDetail || '',
        categoryColor: visitor.categoryColor,
        checkInTime: visitor.checkInTime
      }
    });
  } catch (error) {
    console.error('Error creating visitor entry:', error);
    if (req.file && req.file.path) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (unlinkError) {
        console.error('Error deleting uploaded file:', unlinkError);
      }
    }
    res.status(500).json({ 
      error: 'Failed to create visitor entry',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * Checkout visitor
 */
router.post('/checkout', async (req, res) => {
  try {
    let { qrToken, manualCheckout } = req.body;

    if (!qrToken) {
      return res.status(400).json({ error: 'QR token is required' });
    }

    qrToken = qrToken.toUpperCase().trim();

    if (qrToken.length !== 4) {
      return res.status(400).json({ error: 'QR token must be 4 characters' });
    }

    const visitor = await Visitor.findOne({ qrToken, status: 'Inside' });

    if (!visitor) {
      return res.status(404).json({ error: 'Visitor not found or already checked out' });
    }

    visitor.status = 'Exited';
    visitor.checkOutTime = new Date();
    visitor.manualCheckout = manualCheckout === true || manualCheckout === 'true';
    await visitor.save();

    res.json({
      success: true,
      message: 'Visitor checked out successfully',
      visitor: {
        id: visitor._id,
        name: visitor.name,
        checkOutTime: visitor.checkOutTime
      }
    });
  } catch (error) {
    console.error('Error during checkout:', error);
    res.status(500).json({ error: 'Failed to checkout visitor' });
  }
});

/**
 * Get QR code image
 */
router.get('/qr/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const qrBuffer = await generateQRCodeBuffer(token);
    res.set('Content-Type', 'image/png');
    res.send(qrBuffer);
  } catch (error) {
    console.error('Error generating QR code:', error);
    res.status(500).json({ error: 'Failed to generate QR code' });
  }
});

/**
 * Get visitor pass image
 */
router.get('/pass/:visitorId', async (req, res) => {
  try {
    const { visitorId } = req.params;
    const visitor = await Visitor.findOne({ visitorId });
    
    if (!visitor) {
      return res.status(404).json({ error: 'Visitor not found' });
    }

    const passPath = path.join(__dirname, '../../uploads/visitor-passes', `pass-${visitorId}.png`);
    
    if (fs.existsSync(passPath)) {
      res.sendFile(passPath);
    } else {
      // Generate pass on the fly
      const passBuffer = await generateVisitorPass(visitor);
      const passDir = path.dirname(passPath);
      if (!fs.existsSync(passDir)) {
        fs.mkdirSync(passDir, { recursive: true });
      }
      fs.writeFileSync(passPath, passBuffer);
      res.set('Content-Type', 'image/png');
      res.send(passBuffer);
    }
  } catch (error) {
    console.error('Error generating visitor pass:', error);
    res.status(500).json({ error: 'Failed to generate visitor pass' });
  }
});

/**
 * Get all visitors
 */
router.get('/', async (req, res) => {
  try {
    const { status, date, visitorCategory, page = 1, limit = 50 } = req.query;
    const query = {};

    if (status) query.status = status;
    if (visitorCategory) query.visitorCategory = visitorCategory;

    if (date) {
      const startDate = new Date(date);
      startDate.setHours(0, 0, 0, 0);
      const endDate = new Date(date);
      endDate.setHours(23, 59, 59, 999);
      query.checkInTime = { $gte: startDate, $lte: endDate };
    }

    const visitors = await Visitor.find(query)
      .select('name phoneNumber email company employeeToMeet department purpose visitorCategory vehicleNumber itemCarried photograph checkInTime checkOutTime status qrToken visitorId manualCheckout meetingRoom badgePrinted')
      .sort({ checkInTime: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Visitor.countDocuments(query);

    res.json({
      visitors,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      total
    });
  } catch (error) {
    console.error('Error fetching visitors:', error);
    res.status(500).json({ error: 'Failed to fetch visitors' });
  }
});

/**
 * Get visitor statistics
 */
router.get('/stats', async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const totalVisitors = await Visitor.countDocuments();
    const todayVisitors = await Visitor.countDocuments({
      checkInTime: { $gte: today }
    });
    const insideVisitors = await Visitor.countDocuments({ status: 'Inside' });

    // Category breakdown
    const categoryStats = await Visitor.aggregate([
      {
        $group: {
          _id: '$visitorCategory',
          count: { $sum: 1 }
        }
      }
    ]);

    res.json({
      totalVisitors,
      todayVisitors,
      insideVisitors,
      categoryStats
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ error: 'Failed to fetch statistics' });
  }
});

module.exports = router;
