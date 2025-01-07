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

module.exports = router;
