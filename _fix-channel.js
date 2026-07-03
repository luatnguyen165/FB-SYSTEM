require('dotenv').config();
const mongoose = require('mongoose');
const path = require('path');

async function main() {
    await mongoose.connect(process.env.MONGODB_URI);
    const Channel = require('./models/Channel');
    
    const newSSPath = path.join(__dirname, 'social-sessions/6a0fd44f96ab8884de405bc2/fb_1783012655208-FB/storage-state.json');
    const result = await Channel.updateOne(
        { _id: '6a3399e2c5635daf5a73e5a2' },
        { $set: { storageStatePath: newSSPath } }
    );
    console.log('Updated PANZI channel:', result.modifiedCount, 'modified');
    
    const ch = await Channel.findById('6a3399e2c5635daf5a73e5a2');
    console.log('New path:', ch.storageStatePath);
    
    await mongoose.disconnect();
}
main();
