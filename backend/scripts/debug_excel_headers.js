const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

const excelPath = path.join(__dirname, '..', '..', 'Pay_Register_Summary_2026-02.xlsx');
if (!fs.existsSync(excelPath)) {
    console.error('Excel file not found at:', excelPath);
    process.exit(1);
}

const workbook = XLSX.readFile(excelPath);
const sheet = workbook.Sheets[workbook.SheetNames[0]];
const data = XLSX.utils.sheet_to_json(sheet);

if (data.length > 0) {
    console.log('HEADERS:', Object.keys(data[0]));
    console.log('SAMPLE ROW:', JSON.stringify(data[0], null, 2));
} else {
    console.log('No data found in sheet.');
}
