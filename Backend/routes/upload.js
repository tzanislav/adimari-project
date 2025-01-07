const express = require('express');
const multer = require('multer');
const multerS3 = require('multer-s3');
const s3 = require('../config/awsConfig');

const router = express.Router();

// Configure multer to use S3 for storage
const upload = multer({
  storage: multerS3({
    s3,
    bucket: process.env.S3_BUCKET_NAME, // Replace with your bucket name
    acl: 'public-read', // Set permissions (e.g., public-read for public URLs)
    metadata: (req, file, cb) => {
      cb(null, { fieldName: file.fieldname });
    },
    key: (req, file, cb) => {
      const folder = req.query.folder || 'default'; // Get folder name from query param
      const fileName = `${folder}/${Date.now()}-${file.originalname}`; // Add folder to the path
      cb(null, fileName);
    },
  }),
});

// Define the multiple files upload route
router.post('/upload', upload.array('files', 10), (req, res) => {
  try {
    const fileUrls = req.files.map((file) => file.location); // Extract URLs from uploaded files
    res.status(200).json({ urls: fileUrls });
  } catch (error) {
    console.error('Error uploading files:', error);
    res.status(500).json({ error: 'File upload failed' });
  }
});

module.exports = router;
