const { MongoClient } = require('mongodb');
require('dotenv').config();

/**
 * Script to copy a production MongoDB database to a local instance safely.
 * Requirements:
 * 1. MONGODB_ATLAS_URI in .env (Source - Production)
 * 2. MONGODB_URI in .env (Destination - Local)
 */

async function copyDatabase() {
    const prodUri = process.env.MONGODB_URI;
    const localUri = "mongodb://127.0.0.1:27017/hrms";

    if (!prodUri) {
        console.error("Error: MONGODB_ATLAS_URI is not defined in .env file.");
        process.exit(1);
    }

    console.log("--------------------------------------------------");
    console.log(`Source (PROD): ${prodUri.replace(/:[^:@]+@/, ':****@')}`);
    console.log(`Destination (LOCAL): ${localUri.replace(/:[^:@]+@/, ':****@')}`);
    console.log("--------------------------------------------------");

    console.log("Connecting to Source (Production)...");
    const prodClient = new MongoClient(prodUri, { readPreference: 'secondaryPreferred' });

    console.log("Connecting to Destination (Local)...");
    const localClient = new MongoClient(localUri);

    try {
        await prodClient.connect();
        await localClient.connect();

        const prodDb = prodClient.db();
        const localDb = localClient.db();

        // Get all collections from production
        const collections = await prodDb.listCollections().toArray();
        console.log(`Found ${collections.length} collections in production.`);

        for (const collectionInfo of collections) {
            const collectionName = collectionInfo.name;

            // Skip system collections if any
            if (collectionName.startsWith('system.')) continue;

            console.log(`\n--- Copying collection: ${collectionName} ---`);

            // 1. Clear local collection
            await localDb.collection(collectionName).deleteMany({});
            console.log(`Cleared local collection: ${collectionName}`);

            // 2. Fetch documents from production
            const prodCollection = prodDb.collection(collectionName);
            const count = await prodCollection.countDocuments();
            console.log(`Total documents to copy: ${count}`);

            if (count === 0) {
                console.log(`Skipping empty collection: ${collectionName}`);
                continue;
            }

            // 3. Batch copy to local
            const batchSize = 1000;
            const cursor = prodCollection.find({});

            let batch = [];
            let processed = 0;

            while (await cursor.hasNext()) {
                const doc = await cursor.next();
                batch.push(doc);

                if (batch.length === batchSize) {
                    await localDb.collection(collectionName).insertMany(batch);
                    processed += batch.length;
                    console.log(`  Processed ${processed}/${count}...`);
                    batch = [];
                }
            }

            // Insert remaining documents
            if (batch.length > 0) {
                await localDb.collection(collectionName).insertMany(batch);
                processed += batch.length;
                console.log(`  Finished copying ${processed} documents.`);
            }
        }

        console.log("\nDatabase copy completed successfully!");

    } catch (error) {
        console.error("An error occurred during the copy process:", error);
    } finally {
        await prodClient.close();
        await localClient.close();
    }
}

copyDatabase();
