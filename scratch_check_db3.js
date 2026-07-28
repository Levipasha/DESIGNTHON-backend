const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '.env') });

const uri = process.env.MONGODB_URI;
console.log('Connecting to:', uri);

async function run() {
  await mongoose.connect(uri);
  console.log('Connected!');
  
  const collections = await mongoose.connection.db.listCollections().toArray();
  for (const col of collections) {
    const count = await mongoose.connection.db.collection(col.name).countDocuments();
    console.log(` - ${col.name}: ${count} documents`);
    if (count > 0 && (col.name === 'teams' || col.name === 'users')) {
      const sample = await mongoose.connection.db.collection(col.name).find().toArray();
      console.log(`   ${col.name} data:`, JSON.stringify(sample.map(d => ({ name: d.name, college: d.college, createdAt: d.createdAt })), null, 2));
    }
  }
  await mongoose.disconnect();
}

run().catch(console.error);
