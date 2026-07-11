const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const hubspot = require('@hubspot/api-client');

const accessToken = process.env.HUBSPOT_ACCESS_TOKEN;
if (!accessToken) {
  console.error('Missing HUBSPOT_ACCESS_TOKEN in .env');
  process.exit(1);
}

const client = new hubspot.Client({ accessToken });

const properties = [
  {
    name: 'integration_health_score',
    label: 'Integration Health Score',
    type: 'number',
    fieldType: 'number',
    groupName: 'dealinformation',
  },
  {
    name: 'integration_sync_status',
    label: 'Integration Sync Status',
    type: 'enumeration',
    fieldType: 'select',
    groupName: 'dealinformation',
    options: [
      { label: 'Pending', value: 'pending' },
      { label: 'Processing', value: 'processing' },
      { label: 'Completed', value: 'completed' },
      { label: 'Failed', value: 'failed' },
    ],
  },
  {
    name: 'integration_last_synced_at',
    label: 'Integration Last Synced At',
    type: 'datetime',
    fieldType: 'date',
    groupName: 'dealinformation',
  },
  {
    name: 'integration_error_message',
    label: 'Integration Error Message',
    type: 'string',
    fieldType: 'textarea',
    groupName: 'dealinformation',
  },
];

async function createCustomProperties() {
  for (const prop of properties) {
    try {
      await client.crm.properties.coreApi.create('deals', prop);
      console.log(`Created property: ${prop.name}`);
    } catch (error) {
      const code = error.code || error.statusCode || (error.response && error.response.statusCode);
      if (code === 409) {
        console.log(`Property already exists: ${prop.name}`);
      } else {
        console.error(`Failed to create ${prop.name}:`, error.message);
      }
    }
  }
}

createCustomProperties().catch((error) => {
  console.error('Script failed:', error.message);
  process.exit(1);
});
