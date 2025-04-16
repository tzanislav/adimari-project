const express = require('express');
const multer = require('multer');
const multerS3 = require('multer-s3');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { RekognitionClient, DetectLabelsCommand } = require('@aws-sdk/client-rekognition');
const axios = require('axios');
const router = express.Router();
require('dotenv').config();


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
      const folder = req.query.folder || 'default'; // Get folder name from query param
      const fileName = `${folder}/${file.originalname}`; // Add folder to the path
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
  const folder = req.query.folder || 'default'; // Extract folder from query param
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
        return validUrl.protocol === "http:" || validUrl.protocol === "https:";
      } catch {
        return false;
      }
    };

    if (!isValidUrl(imageUrl)) {
      return res.status(400).json({ error: "Invalid image URL." });
    }

    // Fetch the image as a buffer
    const imageResponse = await axios.get(imageUrl, { responseType: "arraybuffer" });
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

    if (!key) {
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
