const mongoose = require('mongoose');
async function test() {
    try {
        console.log('Connecting...');
        await mongoose.connect('mongodb://localhost:27017/li-hrms');
        console.log('Connected!');
        await mongoose.disconnect();
        console.log('Disconnected!');
    } catch (e) {
        console.error('Error:', e);
    }
}
test();
