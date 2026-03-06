const express = require('express');
const mongoose = require('mongoose');
require('dotenv').config();
const userRoutes = require('./routes/userRoutes'); // Import user routes
const brandRoutes = require('./routes/brandRoutes'); // Import brand routes
const uploadRoutes = require('./routes/upload'); // Import upload route
const modelRoutes = require('./routes/modelRoutes'); // Import model routes
const projectRoutes = require('./routes/projectRoutes'); // Import project routes
const selectRoutes = require('./routes/selectionRoute'); // Import select routes
const itemRoutes = require('./routes/itemRoutes'); // Import item routes
const openairoute = require('./routes/openairoute'); // Import openairoute routes
const authRoutes = require('./routes/authRoutes'); // Import auth routes
const clickUpRoutes = require('./routes/clickupRoutes'); // Import clickup routes
const licenseEntryRoutes = require('./routes/licenseEntryRoutes'); // Import license routes
const activityRoutes = require('./routes/activityRoute'); // Import activity routes
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const app = express();
const { authenticate, authorizeRole } = require('./auth/authMiddleware');

const defaultAllowedOrigins = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
];

const allowedOrigins = (process.env.CORS_ALLOWED_ORIGINS || defaultAllowedOrigins.join(','))
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const corsOptions = {
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    return callback(new Error('Origin not allowed by CORS'));
  },
  credentials: true,
  optionsSuccessStatus: 204,
};

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

const automationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
});

const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
});

app.disable('x-powered-by');
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(cors(corsOptions));
app.use(express.json({ limit: '1mb' })); // Parse JSON requests

// MongoDB connection string
const mongoURI = process.env.MONGODB_URI;

if (!mongoURI) {
  console.error('Missing required environment variable: MONGODB_URI');
  process.exit(1);
}

mongoose
  .connect(mongoURI)
  .then(() => {
    console.log('Connected to MongoDB');
  })
  .catch((err) => {
    console.error('Failed to connect to MongoDB:', err);
  });


app.use('/api/users', userRoutes); 
app.use('/api/brands', brandRoutes); 
app.use('/api/upload', authenticate, uploadLimiter, uploadRoutes); 
app.use('/api/models3d', modelRoutes); 
app.use('/api/projects', projectRoutes); 
app.use('/api/selections', selectRoutes); 
app.use('/api/items', itemRoutes); 
app.use('/api/openai', authenticate, automationLimiter, openairoute); 
app.use('/clickup', authenticate, authorizeRole(['admin', 'moderator']), automationLimiter, clickUpRoutes);
app.use('/auth', authLimiter, authRoutes);
app.use('/api/licenses', authenticate, licenseEntryRoutes);
app.use('/api/activity', activityRoutes); // Add activity routes

// Test route for API
app.get('/api/test', (req, res) => {
  res.json({ message: 'API is working!' });
});

// Serve static React files
app.use(express.static(path.join(__dirname, '../front-end/dist')));

app.use((err, req, res, next) => {
  if (err.message === 'Origin not allowed by CORS') {
    return res.status(403).json({ error: 'Origin not allowed.' });
  }

  return next(err);
});

// Catch-all route for React app
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../front-end/dist', 'index.html'));
});

// Start the server
const PORT = process.env.PORT || 5001;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
