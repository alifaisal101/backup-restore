const { MongoClient, ObjectId } = require('mongodb');
const fs = require('fs');
const inquirer = require('inquirer');
const path = require('path');

// Path to the config file
const CONFIG_FILE = path.join(__dirname, 'config.json');

// Function to load the configuration from the file
function loadConfig() {
  if (fs.existsSync(CONFIG_FILE)) {
    const configData = fs.readFileSync(CONFIG_FILE);
    return JSON.parse(configData);
  }
  return null;
}

// Function to save the configuration to the file
function saveConfig(config) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

// Function to prompt user input with default values from the config file
async function getUserInput(defaults = {}) {
  const questions = [
    {
      type: 'input',
      name: 'backupFilePath',
      message: 'Enter the path to the backup JSON file:',
      default: defaults.backupFilePath || '', // Use default if available
      validate: (input) =>
        input.trim() ? true : 'Backup file path cannot be empty.',
    },
    {
      type: 'input',
      name: 'dbUri',
      message:
        'Enter your MongoDB connection URI (e.g., mongodb://localhost:27017):',
      default: defaults.dbUri || '', // Use default if available
      validate: (input) =>
        input.trim() ? true : 'MongoDB connection URI cannot be empty.',
    },
    {
      type: 'input',
      name: 'dbName',
      message: 'Enter the database name to restore the backup to:',
      default: defaults.dbName || '', // Use default if available
      validate: (input) =>
        input.trim() ? true : 'Database name cannot be empty.',
    },
  ];

  const prompt = inquirer.createPromptModule();
  return prompt(questions);
}

// Helper function to convert dates and _id fields
function convertTypes(data) {
  if (Array.isArray(data)) {
    return data.map(convertTypes); // Recursively handle arrays
  }

  if (typeof data === 'object' && data !== null) {
    const convertedData = {};
    for (let key in data) {
      if (data.hasOwnProperty(key)) {
        let value = data[key];

        if (key === 'name') {
          convertedData[key] = value; // Keep name as it is
          continue;
        }
        // Convert string dates to Date objects
        if (
          typeof value === 'string' &&
          !isNaN(Date.parse(value)) &&
          key !== 'name'
        ) {
          convertedData[key] = new Date(value); // Convert ISO date string to Date
        } else if (key === '_id' && typeof value === 'string') {
          // Convert _id string to ObjectId
          convertedData[key] = new ObjectId(value);
        } else if (key === 'payments') {
          // Special handling for the "payments" array in purchases
          convertedData[key] = value.map((payment) => {
            // Convert each payment object
            if (payment._id && typeof payment._id === 'string') {
              payment._id = new ObjectId(payment._id); // Convert _id to ObjectId
            }
            if (payment.date && typeof payment.date === 'string') {
              payment.date = new Date(payment.date); // Convert date to Date object
            }
            return payment;
          });
        } else if (key === 'purchasedProducts') {
          convertedData[key] = value.map((purchasedProduct) => {
            if (
              purchasedProduct._id &&
              typeof purchasedProduct._id === 'string'
            ) {
              purchasedProduct._id = new ObjectId(purchasedProduct._id); // Convert _id to ObjectId
            }
            if (
              purchasedProduct.productId &&
              typeof purchasedProduct.productId === 'string'
            ) {
              purchasedProduct.productId = new ObjectId(
                purchasedProduct.productId
              ); // Convert _id to ObjectId
            }
            return purchasedProduct;
          });
        } else if (Array.isArray(value)) {
          // Check if the array contains ObjectId-like strings and convert them
          convertedData[key] = value.map((item) =>
            typeof item === 'string' && ObjectId.isValid(item)
              ? new ObjectId(item)
              : item
          );
        } else {
          // Recursively handle nested objects
          convertedData[key] = convertTypes(value);
        }
      }
    }
    return convertedData;
  }

  return data;
}

async function restoreBackup(backupFilePath, dbUri, dbName) {
  const client = new MongoClient(dbUri, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });

  try {
    console.log(`[INFO] Connecting to MongoDB at ${dbUri}`);
    await client.connect();
    console.log(`[INFO] Connected to MongoDB`);

    const db = client.db(dbName);

    console.log(`[INFO] Reading backup file: ${backupFilePath}`);
    const backupData = require(backupFilePath); // Assuming backup is a JSON file

    // Iterate over the collections in the backup and insert data into MongoDB
    for (const collectionName in backupData) {
      const collectionData = backupData[collectionName];
      if (collectionData.length === 0) {
        console.log(
          `[WARN] No data to restore for collection: ${collectionName}`
        );
        continue;
      }

      console.log(
        `[INFO] Restoring collection: ${collectionName} with ${collectionData.length} documents`
      );
      const collection = db.collection(collectionName);

      // Convert dates and _id values to correct types before inserting
      const convertedData = collectionData.map((item) => convertTypes(item));

      // Insert data into the collection
      await collection.insertMany(convertedData);
      console.log(
        `[SUCCESS] Successfully restored ${convertedData.length} documents into ${collectionName}`
      );
    }

    console.log('[SUCCESS] Backup restoration completed successfully!');
  } catch (error) {
    console.error(`[ERROR] Error during backup restoration: ${error.message}`);
  } finally {
    await client.close();
    console.log('[INFO] MongoDB connection closed');
  }
}

async function main() {
  try {
    // Load configuration file if it exists
    const config = loadConfig();

    // Get user input with or without defaults
    const { backupFilePath, dbUri, dbName } = await getUserInput(config || {});

    // If the config file doesn't exist, save the user input to it
    if (!config) {
      saveConfig({ backupFilePath, dbUri, dbName });
      console.log('[INFO] Configuration saved to config.json');
    }

    // Check if the backup file exists
    if (!fs.existsSync(backupFilePath)) {
      console.error(`[ERROR] Backup file not found: ${backupFilePath}`);
      return;
    }

    // Start the restoration process
    await restoreBackup(backupFilePath, dbUri, dbName);
  } catch (error) {
    console.error(`[ERROR] Something went wrong: ${error.message}`);
  }
}

main();
