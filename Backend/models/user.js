const mongoose = require('mongoose');

// Define the schema for the 'users' collection
const userSchema = new mongoose.Schema({
  name: String,
  email: String,
  password: String,
  role: String,
});

// Export the model
module.exports = mongoose.model('User', userSchema, 'users'); // 'users' is the collection name
