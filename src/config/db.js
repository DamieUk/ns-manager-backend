const mongoose = require('mongoose');

async function connectDB(uri) {
  mongoose.connection.on('connected', () => {
    console.log('[mongo] connected');
  });
  mongoose.connection.on('error', (err) => {
    console.error('[mongo] connection error:', err.message);
  });

  await mongoose.connect(uri);
}

module.exports = connectDB;
