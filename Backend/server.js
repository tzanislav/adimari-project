const express = require('express');
const mongoose = require('mongoose');
const userRoutes = require('./routes/userRoutes'); // Import user routes
const brandRoutes = require('./routes/brandRoutes'); // Import brand routes
const uploadRoutes = require('./routes/upload'); // Import upload route
const modelRoutes = require('./routes/modelRoutes'); // Import model routes
const projectRoutes = require('./routes/projectRoutes'); // Import project routes
const selectRoutes = require('./routes/selectionRoute'); // Import select routes
const cors = require('cors');
require('dotenv').config();


const app = express();
app.use(cors());
app.use(express.json()); // Parse JSON requests

// MongoDB connection string
const mongoURI = 'mongodb+srv://tzani:grilleD123@adimaricluster.xo73tnf.mongodb.net/adimari_db?retryWrites=true&w=majority';

mongoose
  .connect(mongoURI)
  .then(() => {
    console.log('Connected to MongoDB');
  })
  .catch((err) => {
    console.error('Failed to connect to MongoDB:', err);
  });

app.get('/', (req, res) => {
  res.send('Welcome to Adimari API');
});

// Use the user routes
app.use('/users', userRoutes); // Routes start with /users
app.use('/brands', brandRoutes); // Routes start with /brands
app.use('/upload', uploadRoutes); // Routes start with /upload
app.use('/models3d', modelRoutes); // Routes start with /models3d
app.use('/projects', projectRoutes); // Routes start with /projects
app.use('/selects', selectRoutes); // Routes start with /selects

// Start the server
const PORT = 5000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
