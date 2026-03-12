const axios = require('axios');

async function verifySettings() {
    const keys = ['payroll_cycle_start_day', 'payroll_cycle_end_day'];
    const baseUrl = 'http://localhost:5000/api/settings';

    for (const key of keys) {
        try {
            const response = await axios.get(`${baseUrl}/${key}`);
            console.log(`Setting: ${key}`);
            console.log(`Success: ${response.data.success}`);
            console.log(`Value: ${response.data.data.value}`);
            console.log(`IsDefault: ${response.data.data.isDefault}`);
            console.log('---');
        } catch (error) {
            console.error(`Error fetching ${key}:`, error.message);
            if (error.response) {
                console.error('Status:', error.response.status);
                console.error('Data:', error.response.data);
            }
            console.log('---');
        }
    }
}

verifySettings();
