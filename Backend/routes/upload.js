const express = require('express');
const multer = require('multer');
const multerS3 = require('multer-s3');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { RekognitionClient, DetectLabelsCommand } = require('@aws-sdk/client-rekognition');
const axios = require('axios');
const net = require('net');
const router = express.Router();
require('dotenv').config();

const MAX_UPLOAD_SIZE = 4 * 1024 * 1024;

const isPrivateIp = (ipAddress) => {
  const parts = ipAddress.split('.').map(Number);

  return parts[0] === 10
    || parts[0] === 127
    || (parts[0] === 169 && parts[1] === 254)
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168);
};

const hasDisallowedHostname = (value) => {
  const hostname = value.toLowerCase();

  if (hostname === 'localhost' || hostname === '::1' || hostname.endsWith('.local')) {
    return true;
  }

  if (net.isIP(hostname) === 4) {
    return isPrivateIp(hostname);
  }

  return false;
};

const sanitizeFolder = (folder) => {
  const normalizedFolder = String(folder || 'default')
    .trim()
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/^\/+|\/+$/g, '');

  if (!normalizedFolder || normalizedFolder.includes('..') || !/^[a-zA-Z0-9/_-]+$/.test(normalizedFolder)) {
    return null;
  }

  return normalizedFolder.slice(0, 120);
};

const sanitizeFilename = (originalName) => {
  return String(originalName || 'upload')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .slice(-180);
};

// AWS Configuration
const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const rekognition = new RekognitionClient({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

router.use(express.json());



// Configure multer to use S3 for storage
const upload = multer({
  limits: {
    fileSize: MAX_UPLOAD_SIZE,
    files: 10,
  },
  storage: multerS3({
    s3,
    bucket: process.env.S3_BUCKET_NAME, // Replace with your bucket name
    metadata: (req, file, cb) => {
      cb(null, { fieldName: file.fieldname });
    },
    contentType: multerS3.AUTO_CONTENT_TYPE, // Automatically set ContentType
    contentDisposition: (req, file, cb) => {
      // Dynamically set ContentDisposition based on file type
      if (file.mimetype.startsWith('image/') || file.mimetype === 'application/pdf') {
        cb(null, 'inline'); // Open images and PDFs in the browser
      } else {
        cb(null, 'attachment'); // Download other file types directly
      }
    },
    key: (req, file, cb) => {
      const folder = sanitizeFolder(req.query.folder);
      if (!folder) {
        return cb(new Error('Invalid folder name.'));
      }

      const fileName = `${folder}/${sanitizeFilename(file.originalname)}`; // Add folder to the path
      console.log('Uploading file:', fileName);
      cb(null, fileName);
    },
  }),
});

//test get route
router.get('/', (req, res) => {
  res.send('Welcome to Upload API');
});

// Define the multiple files upload route
router.post('/', upload.array('files', 10), (req, res) => {
  const folder = sanitizeFolder(req.query.folder);
  if (!folder) {
    return res.status(400).json({ error: 'Invalid folder name.' });
  }

  console.log('Uploading files to folder:', folder);
  try {
    const fileUrls = req.files.map((file) => file.location);
    res.status(200).json({ urls: fileUrls });
  } catch (error) {
    console.error('Error uploading files:', error);
    res.status(500).json({ error: 'File upload failed' });
  }
});


// Analyze image with Rekognition
router.post("/analyze-image", async (req, res) => {
  try {
    const { imageUrl } = req.body;

    if (!imageUrl) {
      return res.status(400).json({ error: "Image URL is required." });
    }

    // Validate URL
    const isValidUrl = (url) => {
      try {
        const validUrl = new URL(url);
        return validUrl.protocol === "https:" && !hasDisallowedHostname(validUrl.hostname);
      } catch {
        return false;
      }
    };

    if (!isValidUrl(imageUrl)) {
      return res.status(400).json({ error: "Invalid image URL." });
    }

    // Fetch the image as a buffer
    const imageResponse = await axios.get(imageUrl, {
      responseType: "arraybuffer",
      timeout: 5000,
      maxContentLength: MAX_UPLOAD_SIZE,
      maxBodyLength: MAX_UPLOAD_SIZE,
    });

    if (!String(imageResponse.headers['content-type'] || '').startsWith('image/')) {
      return res.status(400).json({ error: 'The provided URL did not return an image.' });
    }

    const imageBuffer = Buffer.from(imageResponse.data, "binary");

    // Rekognition call
    const command = new DetectLabelsCommand({
      Image: { Bytes: imageBuffer },
    });

    const response = await rekognition.send(command);
    res.json(response.Labels);
  } catch (error) {
    console.error("Error processing image URL:", error);
    res.status(500).json({ error: "Failed to analyze image." });
  }
});

// Analyze S3 image route (Optional)
router.get("/analyze-s3-image", async (req, res) => {
  try {
    const { key } = req.query;

    if (!key || String(key).includes('..')) {
      return res.status(400).json({ error: "S3 key is required." });
    }

    const s3Params = {
      Bucket: process.env.S3_BUCKET_NAME,
      Key: key,
    };

    // Get the image from S3
    const command = new GetObjectCommand(s3Params);
    const s3Object = await s3.send(command);
    const params = {
      Image: {
        Bytes: s3Object.Body,
      },
    };

    const rekognitionCommand = new DetectLabelsCommand(params);
    const rekognitionData = await rekognition.send(rekognitionCommand);

    res.json(rekognitionData.Labels);
  } catch (error) {
    console.error("Error analyzing S3 image:", error);
    res.status(500).json({ error: "Failed to analyze S3 image." });
  }
});

module.exports = router;
