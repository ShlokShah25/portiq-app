const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');

// Load environment variables
dotenv.config();

const app = express();

// Middleware
// Allow localhost, local network IPs, and production marketing domains for access
const allowedOrigins = [
  'http://localhost:3000',  // school kiosk
  'http://localhost:3001',  // school admin
  'http://localhost:3002',  // workplace kiosk
  'http://localhost:3003',  // workplace admin
  'http://localhost:5173',  // local marketing/dev
  'https://portiqtechnologies.com',
  'https://www.portiqtechnologies.com'
];

// Add local network IPs (192.168.x.x, 10.x.x.x, 172.16-31.x.x)
const os = require('os');
const interfaces = os.networkInterfaces();
for (const name of Object.keys(interfaces)) {
  for (const iface of interfaces[name]) {
    if (iface.family === 'IPv4' && !iface.internal) {
      allowedOrigins.push(`http://${iface.address}:3002`);
      allowedOrigins.push(`http://${iface.address}:3003`);
    }
  }
}

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (mobile apps, Postman, etc.)
    if (!origin) return callback(null, true);
    
    // Check if origin is in allowed list or is a local network IP
    if (allowedOrigins.includes(origin) || 
        origin.match(/^http:\/\/(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.)/)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Serve uploaded files
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));
app.use('/uploads/voice-samples', express.static(path.join(__dirname, '../uploads/voice-samples')));

// API Routes (must come before static file serving)
app.use('/api/visitors', require('./routes/visitors'));
app.use('/api/meetings', require('./routes/meetings'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/config', require('./routes/config'));
app.use('/api', require('./routes/billing'));
app.use('/api', require('./routes/onboarding'));
app.use('/api', require('./routes/saas'));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'Workplace Visitor Management System API',
    version: '1.0.0'
  });
});

// Serve React apps (production builds)
// Admin panel
app.use('/admin', express.static(path.join(__dirname, '../admin/build')));
app.get('/admin/*', (req, res) => {
  res.sendFile(path.join(__dirname, '../admin/build/index.html'));
});

// Kiosk/Tablet interface (main app)
app.use(express.static(path.join(__dirname, '../client/build')));
app.get('*', (req, res) => {
  // Don't serve React app for API routes
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'API endpoint not found' });
  }
  res.sendFile(path.join(__dirname, '../client/build/index.html'));
});

// Connect to MongoDB
const mongoOptions = {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverSelectionTimeoutMS: 60000,
  socketTimeoutMS: 60000,
  connectTimeoutMS: 60000,
  retryWrites: true,
  w: 'majority',
  family: 4,
  directConnection: false
};

const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/workplace_visitor_management';
console.log('🔗 Connecting to MongoDB...');
console.log('   URI:', mongoUri.replace(/\/\/[^:]+:[^@]+@/, '//***:***@'));

mongoose.connect(mongoUri, mongoOptions)
.then(async () => {
  console.log('✅ Connected to MongoDB');
  
  // Initialize admin user if not exists
  const initAdmin = require('./utils/initAdmin');
  await initAdmin();
  
  // Initialize config if not exists
  const Config = require('./models/Config');
  await Config.getConfig();
  console.log('✅ Configuration initialized');
})
.catch((error) => {
  console.error('❌ MongoDB connection error:', error);
});

const PORT = process.env.PORT || 5001;
const HOST = process.env.HOST || '0.0.0.0'; // Listen on all network interfaces for tablet access

app.listen(PORT, HOST, () => {
  console.log(`🚀 Server running on ${HOST}:${PORT}`);
  if (HOST === '0.0.0.0') {
    const os = require('os');
    const interfaces = os.networkInterfaces();
    console.log(`📱 Access from tablet:`);
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        if (iface.family === 'IPv4' && !iface.internal) {
          console.log(`   - http://${iface.address}:${PORT}`);
        }
      }
    }
  }
  console.log(`📱 Workplace Visitor Management System`);
  console.log(`\n📋 Available endpoints:`);
  console.log(`   - GET  /api/health`);
  console.log(`   - GET  /api/visitors/categories`);
  console.log(`   - POST /api/visitors/entry`);
  console.log(`   - POST /api/visitors/checkout`);
  console.log(`   - GET  /api/visitors`);
  console.log(`   - GET  /api/meetings`);
  console.log(`   - POST /api/meetings`);
});

module.exports = app;
