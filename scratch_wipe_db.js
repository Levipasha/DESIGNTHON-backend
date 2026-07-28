const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '.env') });

const uri = process.env.MONGODB_URI;
console.log('Connecting to:', uri);

async function run() {
  await mongoose.connect(uri);
  console.log('Connected to MongoDB!');
  
  const collections = ['users', 'teams', 'payments', 'invites', 'notifications', 'coupons'];
  
  for (const name of collections) {
    try {
      const collection = mongoose.connection.db.collection(name);
      const countBefore = await collection.countDocuments();
      console.log(`Clearing collection "${name}" (had ${countBefore} documents)...`);
      const result = await collection.deleteMany({});
      console.log(`Cleared! Deleted ${result.deletedCount} documents.`);
    } catch (err) {
      console.error(`Error clearing collection "${name}":`, err.message);
    }
  }
  
  await mongoose.disconnect();
  console.log('Disconnected.');
}

run().catch(console.error);
