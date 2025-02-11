const express = require('express');
const mongoose = require('mongoose');
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
const cors = require('cors');
const path = require('path');
const app = express();
const { authenticate, authorizeRole } = require('./auth/authMiddleware');


require('dotenv').config();




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


app.use('/api/users', userRoutes); 
app.use('/api/brands', brandRoutes); 
app.use('/api/upload', uploadRoutes); 
app.use('/api/models3d', modelRoutes); 
app.use('/api/projects', projectRoutes); 
app.use('/api/selections', selectRoutes); 
app.use('/api/items', itemRoutes); 
app.use('/api/openai', openairoute); 
app.use('/clickup', clickUpRoutes);
app.use('/auth', authRoutes);

// Test route for API
app.get('/api/test', (req, res) => {
  res.json({ message: 'API is working!' });
});

// Serve static React files
app.use(express.static(path.join(__dirname, '../front-end/dist')));

// Catch-all route for React app
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../front-end/dist', 'index.html'));
});

// Start the server
const PORT = process.env.PORT || 5001;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
