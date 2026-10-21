// Read-only: no model initialization, index creation, or compatibility migration.
import 'dotenv/config';
import loadTs from '../../tests/helpers/loadTs.cjs';
import { getBootstrap } from '../src/services/bootstrapService.js';
import { listActivity } from '../src/services/activityService.js';
import { User } from '../src/models.js';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import { env } from '../src/config/env.js';
import { databaseErrorContext } from '../src/config/database.js';
try {
  await mongoose.connect(env.MONGODB_URI, { dbName: env.MONGODB_DB_NAME, autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 5000 });
  const customers = mongoose.connection.db.collection('customers');
  let legacy = 0, invalid = 0, valid = 0;
  for await (const row of customers.find({ deletedAt: { $exists: false } }, { projection: { _id: 0, status: 1, disabled: 1, removed: 1 } })) {
    const flags = [row.status, row.disabled, row.removed];
    if (flags.every(v => v === undefined)) legacy++;
    else if (flags.some(v => typeof v !== 'boolean') || flags.filter(Boolean).length !== 1) invalid++;
    else valid++;
  }
  const lifecycleAudits = await mongoose.connection.db.collection('audits').countDocuments({ action: { $in: ['CUSTOMER_DISABLED', 'CUSTOMER_ENABLED', 'CUSTOMER_REMOVED', 'CUSTOMER_RESTORED'] } });
  const { validBackup } = loadTs(fileURLToPath(new URL('../../src/model.ts', import.meta.url)), { 'expo-crypto': {} });
  const { normalizeData } = loadTs(fileURLToPath(new URL('../../src/api.ts', import.meta.url)), { 'expo-secure-store': {}, './offlineStore': {} }, { __DEV__: false });
  const accountValidation = { checked: 0, invalidBootstrap: 0, invalidActivity: 0, exceptions: [] };
  for (const user of await User.find({ shopId: { $exists: true } }).lean()) {
    accountValidation.checked++;
    try {
      const base = await getBootstrap(user, user.shopId);
      if (!validBackup(normalizeData(base))) accountValidation.invalidBootstrap++;
      const activity = await listActivity({ shopId: user.shopId, limit: 500, token: '' });
      if (!validBackup(normalizeData({ ...base, audit: activity.items }))) accountValidation.invalidActivity++;
    } catch (error) { accountValidation.exceptions.push({ name: error.name, code: error.code || 'UNEXPECTED' }); }
  }
  console.log(JSON.stringify({ accountValidation }));
  console.log(JSON.stringify({ phase: 'readonly-startup-validation', connected: true, lifecycle: { legacy, invalid, valid }, lifecycleAudits }));
} catch (error) {
  const { validBackup } = loadTs(fileURLToPath(new URL('../../src/model.ts', import.meta.url)), { 'expo-crypto': {} });
  const { normalizeData } = loadTs(fileURLToPath(new URL('../../src/api.ts', import.meta.url)), { 'expo-secure-store': {}, './offlineStore': {} }, { __DEV__: false });
  const accountValidation = { checked: 0, invalidBootstrap: 0, invalidActivity: 0, exceptions: [] };
  for (const user of await User.find({ shopId: { $exists: true } }).lean()) {
    accountValidation.checked++;
    try {
      const base = await getBootstrap(user, user.shopId);
      if (!validBackup(normalizeData(base))) accountValidation.invalidBootstrap++;
      const activity = await listActivity({ shopId: user.shopId, limit: 500, token: '' });
      if (!validBackup(normalizeData({ ...base, audit: activity.items }))) accountValidation.invalidActivity++;
    } catch (error) { accountValidation.exceptions.push({ name: error.name, code: error.code || 'UNEXPECTED' }); }
  }
  console.log(JSON.stringify({ accountValidation }));
  console.log(JSON.stringify({ phase: 'readonly-startup-validation', connected: false, ...databaseErrorContext(error) }));
  process.exitCode = 1;
} finally { await mongoose.disconnect(); }
