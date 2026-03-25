const XLSX = require('xlsx');
const { PassThrough } = require('stream');

/**
 * Streaming Export Service
 * Provides utilities to stream large datasets from MongoDB to Excel/CSV
 */

/**
 * Stream MongoDB cursor to Excel (XLSX)
 * @param {Object} cursor - Mongoose cursor
 * @param {Function} rowTransformer - Function to transform DB doc to Excel row
 * @param {String} sheetName - Name of the worksheet
 * @returns {Stream} PassThrough stream
 */
exports.streamToExcel = (cursor, rowTransformer, sheetName = 'Data') => {
    const stream = new PassThrough();

    // Note: True streaming for XLSX is complex because the format is a zipped collection of XMLs.
    // However, we can use 'exceljs' or similar for true streaming.
    // For now, if we use 'xlsx' package, we still have to build the sheet in memory.
    // TO TRULY STREAM 1M ROWS TO EXCEL, 'exceljs' is required.
    // Let's check package.json for exceljs.
    return stream;
};

/**
 * Stream MongoDB cursor to CSV (Memory efficient for 1M rows)
 * @param {Object} cursor - Mongoose cursor
 * @param {Array} fields - CSV column headers
 * @returns {Stream} Stream
 */
exports.streamToCSV = (cursor, fields) => {
    const { AsyncParser } = require('json2csv');
    const opts = { fields };
    const transformOpts = { objectMode: true };

    const asyncParser = new AsyncParser(opts, transformOpts);

    return asyncParser.parse(cursor);
};
