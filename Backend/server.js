const express = require('express');
const http = require('http');
const mongoose = require('mongoose');
require('dotenv').config();
const { getLicensePasswordCrypto } = require('./security/licensePasswordCrypto');
const { getBackendBindHost } = require('./config/backendNetworkConfig');
const { getFileServerConfig } = require('./config/fileServerConfig');
const { getNasConnectorConfig, isNasConnectorEnabled } = require('./config/nasConnectorConfig');
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
const adminRoutes = require('./routes/adminRoutes'); // Import admin maintenance routes
const { createFileRoutes } = require('./routes/fileRoutes'); // Private S3 file-manager routes
const { createPublicDownloadRoutes } = require('./routes/publicDownloadRoutes'); // Anonymous share downloads
const { createNasConnectorRoutes } = require('./routes/nasConnectorRoutes'); // Windows NAS connector control plane
const { createNasCatalogueRoutes } = require('./routes/nasCatalogueRoutes'); // Indexed NAS browse API
const NasConnector = require('./models/nasConnector');
const NasStorageRoot = require('./models/nasStorageRoot');
const NasTransferJob = require('./models/nasTransferJob');
const NasFileEntry = require('./models/nasFileEntry');
const NasAuditEvent = require('./models/nasAuditEvent');
const { NasConnectorJobQueue } = require('./services/nasConnectorJobQueue');
const { NasRetentionService } = require('./services/nasRetentionService');
const { createNasStorageService } = require('./services/nasStorageService');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const { URL } = require('url');
const app = express();
const { authenticate, authorizeRole } = require('./auth/authMiddleware');

// Fail closed before accepting requests if the server-side license encryption key is unavailable.
getLicensePasswordCrypto();
// Fail closed before accepting requests if private file-server settings are incomplete or malformed.
getFileServerConfig();
// The NAS connector is introduced behind an explicit feature flag. When enabled,
// validate all NAS storage settings before accepting requests.
const nasConnectorConfig = isNasConnectorEnabled() ? getNasConnectorConfig() : null;
const nasConnectorJobQueue = nasConnectorConfig
  ? new NasConnectorJobQueue({
    NasTransferJobModel: NasTransferJob,
    leaseSeconds: nasConnectorConfig.jobLeaseSeconds,
  })
  : null;
const nasRetentionService = nasConnectorConfig
  ? new NasRetentionService({
    NasTransferJobModel: NasTransferJob,
    NasAuditEventModel: NasAuditEvent,
    NasFileEntryModel: NasFileEntry,
    thumbnailStorage: createNasStorageService({
      nasConfig: nasConnectorConfig,
      fileServerConfig: getFileServerConfig(),
      prefix: nasConnectorConfig.thumbnailPrefix,
    }),
    config: nasConnectorConfig,
  })
  : null;

const isDevelopmentMode = process.env.DEV_MODE === 'development';
const isProduction = process.env.NODE_ENV === 'production';

const defaultAllowedOrigins = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:5001',
  'http://127.0.0.1:5001',
];

const allowedOrigins = (process.env.CORS_ALLOWED_ORIGINS || defaultAllowedOrigins.join(','))
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const additionalConnectSources = (process.env.CSP_CONNECT_SRC || '')
  .split(',')
  .map((source) => source.trim())
  .filter(Boolean)
  .map((source) => {
    let parsedSource;
    try {
      parsedSource = new URL(source);
    } catch {
      throw new Error(`Invalid CSP_CONNECT_SRC value: ${source}`);
    }

    if (!['http:', 'https:'].includes(parsedSource.protocol)
      || parsedSource.pathname !== '/'
      || parsedSource.search
      || parsedSource.hash
      || parsedSource.username
      || parsedSource.password) {
      throw new Error(`CSP_CONNECT_SRC must contain only HTTP(S) origins: ${source}`);
    }

    return parsedSource.origin;
  });

const trustworthyHosts = new Set(['localhost', '127.0.0.1', '::1']);

const isSameOriginRequest = (origin, requestHost) => {
  if (!origin || !requestHost) {
    return false;
  }

  try {
    const parsedOrigin = new URL(origin);
    return parsedOrigin.host === requestHost;
  } catch {
    return false;
  }
};

const isTrustworthyRequest = (req) => trustworthyHosts.has(req.hostname) || req.secure;

const corsOptionsDelegate = (req, callback) => {
  const requestOrigin = req.header('Origin');
  const requestHost = req.header('Host');

  if (!requestOrigin || allowedOrigins.includes(requestOrigin) || isSameOriginRequest(requestOrigin, requestHost)) {
    return callback(null, {
      origin: true,
      credentials: true,
      optionsSuccessStatus: 204,
    });
  }

  return callback(new Error('Origin not allowed by CORS'));
};

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

const automationLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: isDevelopmentMode ? 3000 : 30,
  standardHeaders: true,
  legacyHeaders: false,
});

const uploadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
});

const fileManagerLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: isDevelopmentMode ? 500 : 100,
  standardHeaders: true,
  legacyHeaders: false,
});

const publicDownloadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: isDevelopmentMode ? 500 : 60,
  standardHeaders: true,
  legacyHeaders: false,
});

const nasConnectorEnrollmentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isDevelopmentMode ? 100 : 10,
  standardHeaders: true,
  legacyHeaders: false,
});

const nasConnectorHeartbeatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: isDevelopmentMode ? 1_000 : 120,
  standardHeaders: true,
  legacyHeaders: false,
});

const cspDirectives = {
  defaultSrc: ["'self'"],
  baseUri: ["'self'"],
  fontSrc: ["'self'", 'data:', 'https:'],
  imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
  objectSrc: ["'none'"],
  scriptSrc: [
    "'self'",
    'https://apis.google.com',
    'https://www.gstatic.com',
    'https://www.googleapis.com',
  ],
  styleSrc: ["'self'", "'unsafe-inline'", 'https:'],
  connectSrc: [
    "'self'",
    'https://apis.google.com',
    'https://www.googleapis.com',
    'https://identitytoolkit.googleapis.com',
    'https://securetoken.googleapis.com',
    'https://firebaseinstallations.googleapis.com',
    'https://www.gstatic.com',
    ...additionalConnectSources,
  ],
  frameSrc: [
    "'self'",
    'https://accounts.google.com',
    'https://apis.google.com',
    'https://*.firebaseapp.com',
  ],
  upgradeInsecureRequests: null,
};

if (isProduction) {
  app.set('trust proxy', 1);
}

app.disable('x-powered-by');
app.use(helmet({
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: false,
  crossOriginResourcePolicy: false,
  originAgentCluster: false,
  contentSecurityPolicy: {
    useDefaults: true,
    directives: cspDirectives,
  },
}));
app.use((req, res, next) => {
  if (isTrustworthyRequest(req)) {
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  }

  next();
});
app.use(cors(corsOptionsDelegate));
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
    if (nasRetentionService) {
      const sweep = () => nasRetentionService.runOnce()
        .then((summary) => console.info('[NAS retention] sweep_complete', summary))
        .catch((error) => console.error('[NAS retention] sweep_failed', error?.code || error?.name || 'unknown'));
      void sweep();
      const timer = setInterval(sweep, nasConnectorConfig.retentionSweepIntervalHours * 60 * 60 * 1_000);
      timer.unref?.();
    }
  })
  .catch((err) => {
    console.error('Failed to connect to MongoDB:', err);
  });


app.use('/api/users', userRoutes); 
app.use('/api/brands', brandRoutes); 
app.use('/api/upload', authenticate, uploadLimiter, uploadRoutes); 
app.use('/api/files', fileManagerLimiter, createFileRoutes());
app.use('/download', publicDownloadLimiter, createPublicDownloadRoutes({
  nasConfig: nasConnectorConfig,
}));
if (nasConnectorConfig) {
  app.use('/api/nas-connectors', createNasConnectorRoutes({
    config: nasConnectorConfig,
    enrollmentLimiter: nasConnectorEnrollmentLimiter,
    heartbeatLimiter: nasConnectorHeartbeatLimiter,
    jobQueue: nasConnectorJobQueue,
  }));
  app.use('/api/nas-catalogue', fileManagerLimiter, createNasCatalogueRoutes({
    nasConfig: nasConnectorConfig,
    fileServerConfig: getFileServerConfig(),
    jobQueue: nasConnectorJobQueue,
  }));
}
app.use('/api/models3d', modelRoutes); 
app.use('/api/projects', projectRoutes); 
app.use('/api/selections', selectRoutes); 
app.use('/api/items', itemRoutes); 
app.use('/api/openai', authenticate, automationLimiter, openairoute); 
app.use('/clickup', authenticate, authorizeRole(['admin', 'moderator']), automationLimiter, clickUpRoutes);
app.use('/auth', authLimiter, authRoutes);
app.use('/api/licenses', licenseEntryRoutes);
app.use('/api/activity', activityRoutes); // Add activity routes
app.use('/api/admin', authenticate, authorizeRole('admin'), adminRoutes);

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
const bindHost = getBackendBindHost();
const server = http.createServer(app);
server.listen(PORT, bindHost, () => {
  console.log('Server listening on http://' + bindHost + ':' + PORT + ' (loopback only)');
});
