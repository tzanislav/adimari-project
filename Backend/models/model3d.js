const mongoose = require('mongoose');

const Model3dSchema = new mongoose.Schema({
    name : { type: String, required: true },
    description : { type: String, default: null },
    images : { type: [String], default: null },
    category : { type: String, required: true },
    class : { type: String, required: true },
    tags : { type: [String], default: null },
    brand : { type: String, default: null },
    price : { type: Number, default: null },
    location : { type: String, default: null },
});

module.exports = mongoose.model('Model3d', Model3dSchema, 'models3d'); // 'models3d' is the collection name