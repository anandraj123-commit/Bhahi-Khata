import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import loadTs from './helpers/loadTs.cjs';

const pdfBase64 = Buffer.from('%PDF-1.7\n%%EOF\n').toString('base64');
const receipt = { entry: { id: 'txn-1' } };

function load({ uri = 'file:///cache/receipt.pdf', base64 = pdfBase64, printError, exists = true, size = 100, writeError } = {}) {
  const created = [];
  class MockFile {
    constructor(...uris) {
      this.uri = uris.length > 1 ? `${String(uris[0]).replace(/\/$/, '')}/${uris[1]}` : uris[0];
      created.push(this.uri);
    }
    get exists() { return exists && this.uri.startsWith('file:///'); }
    get size() { return size; }
    write(content, options) { if (writeError) throw writeError; this.written = { content, options }; }
    delete() {}
    async bytes() { throw new Error('The separate FileSystem byte reader is deliberately unavailable in this test.'); }
  }
  const printCalls = [];
  const module = loadTs('src/transactionReceiptFile.ts', {
    'expo-print': { printToFileAsync: async (options) => {
      printCalls.push(options);
      if (printError) throw printError;
      return uri ? { uri, base64, numberOfPages: 1 } : {};
    } },
    'expo-file-system': { File: MockFile, Paths: { cache: 'file:///cache' }, EncodingType: { Base64: 'base64' } },
    './transactionReceiptPdf': { transactionReceiptHtml: () => '<html>receipt</html>' },
  }, { __DEV__: false });
  return { ...module, created, printCalls };
}

test('generates and validates PDF bytes returned by expo-print for an Android file URI', async () => {
  const api = load();
  const file = await api.generateTransactionReceiptPdf(receipt);
  assert.equal(file.file.uri, 'file:///cache/receipt.pdf');
  assert.deepEqual(api.created, ['file:///cache/receipt.pdf']);
  assert.match(api.printCalls[0].html, /<html>/);
  assert.equal(api.printCalls[0].base64, true);
});

test('does not require a second FileSystem read when expo-print returned valid PDF bytes', async () => {
  const file = await load({ exists: false, size: 0 }).generateTransactionReceiptPdf(receipt);
  assert.equal(file.file.uri, 'file:///cache/receipt.pdf');
});

test('creates a fresh shareable cache PDF from already validated base64 bytes', () => {
  const api = load();
  const file = api.createShareableReceiptPdf(pdfBase64, 'DigitalKhata_Receipt_txn-1.pdf');
  assert.match(file.uri, /^file:\/\/\/cache\/DigitalKhata_Receipt_txn-1_/);
  assert.deepEqual(file.written, { content: pdfBase64, options: { encoding: 'base64' } });
  const second = api.createShareableReceiptPdf(pdfBase64, 'DigitalKhata_Receipt_txn-1.pdf');
  assert.notEqual(file.uri, second.uri);
});

test('reports a cache-file write failure without exposing its path or content', () => {
  const api = load({ writeError: Object.assign(new Error('permission denied at file:///private/cache/receipt.pdf'), { code: 'EACCES' }) });
  assert.throws(() => api.createShareableReceiptPdf(pdfBase64, 'receipt.pdf'), /Unable to prepare PDF for sharing/);
});

test('rejects a share file that was not created in the cache', () => {
  const api = load({ exists: false, size: 0 });
  assert.throws(() => api.createShareableReceiptPdf(pdfBase64, 'receipt.pdf'), /Unable to prepare PDF for sharing/);
});

test('rejects invalid signature, missing encoded bytes, and malformed base64', async () => {
  const invalidPdf = Buffer.from('not a PDF document').toString('base64');
  await assert.rejects(load({ base64: invalidPdf }).generateTransactionReceiptPdf(receipt), /Generated PDF could not be read/);
  await assert.rejects(load({ base64: null }).generateTransactionReceiptPdf(receipt), /Generated PDF could not be read/);
  await assert.rejects(load({ base64: 'JVBERi0-this-is-not-base64' }).generateTransactionReceiptPdf(receipt), /Generated PDF could not be read/);
});

test('distinguishes print failures and missing generated URIs from file-read failures', async () => {
  await assert.rejects(load({ printError: new Error('native print error') }).generateTransactionReceiptPdf(receipt), /PDF generation failed/);
  await assert.rejects(load({ uri: '' }).generateTransactionReceiptPdf(receipt), /PDF generation failed/);
  await assert.rejects(load({ uri: '/cache/not-a-file-uri' }).generateTransactionReceiptPdf(receipt), /PDF generation failed/);
});

test('Transaction Details uses supported SAF save/copy and PDF attachment sharing APIs', () => {
  const source = readFileSync('src/TransactionDetails.tsx', 'utf8');
  const exportSource = readFileSync('src/transactionReceiptExport.ts', 'utf8');
  const helper = readFileSync('src/transactionReceiptFile.ts', 'utf8');
  assert.match(exportSource, /StorageAccessFramework\.requestDirectoryPermissionsAsync/);
  assert.match(exportSource, /if \(!permission\.granted\)/);
  assert.match(exportSource, /StorageAccessFramework\.writeAsStringAsync\(target, base64, \{ encoding: FileSystem\.EncodingType\.Base64 \}\)/);
  assert.match(exportSource, /StorageAccessFramework\.readAsStringAsync\(target/);
  assert.match(exportSource, /from "expo-file-system\/legacy"/);
  assert.match(exportSource, /shareAsync\(file\.uri, \{ mimeType: "application\/pdf"/);
  assert.match(helper, /from "expo-file-system"/);
  assert.match(helper, /base64: true/);
  assert.doesNotMatch(helper, /await file\.bytes\(\)/);
  assert.doesNotMatch(exportSource, /StorageAccessFramework\.copyAsync/);
  assert.match(source, /saveReceiptPdfToAndroid\(generated\.base64/);
  assert.match(source, /shareReceiptPdf\(shareFile/);
  assert.match(source, /Unable to save PDF/);
  assert.match(source, /Unable to open sharing options/);
});

function loadExport({ canceled = false, writeError, readError, shareAvailable = true, shareError, existing = [] } = {}) {
  const files = new Map();
  const operations = [];
  const saf = {
    async requestDirectoryPermissionsAsync() { operations.push(['permission']); return canceled ? { granted: false } : { granted: true, directoryUri: 'content://tree/selected' }; },
    async readDirectoryAsync() { operations.push(['list']); return existing; },
    async createFileAsync(directory, name, mime) {
      operations.push(['create', directory, name, mime]);
      const uri = `content://document/receipt-${operations.filter(([op]) => op === 'create').length}`; files.set(uri, '');
      existing.push(`${name}.pdf`);
      return uri;
    },
    async writeAsStringAsync(uri, content, options) {
      operations.push(['write', uri, options]);
      if (writeError) throw writeError;
      files.set(uri, content);
    },
    async readAsStringAsync(uri, options) {
      operations.push(['read', uri, options]);
      if (readError) throw readError;
      return files.get(uri);
    },
  };
  const legacy = { StorageAccessFramework: saf, EncodingType: { Base64: 'base64' }, deleteAsync: async (uri) => { operations.push(['delete', uri]); files.delete(uri); } };
  const saverModule = load();
  const module = loadTs('src/transactionReceiptExport.ts', {
    'expo-file-system/legacy': legacy,
    'expo-sharing': {
      isAvailableAsync: async () => shareAvailable,
      shareAsync: async (uri, options) => { operations.push(['share', uri, options]); if (shareError) throw shareError; },
    },
    './transactionReceiptFile': {
      isValidGeneratedPdfBase64: saverModule.isValidGeneratedPdfBase64,
      logReceiptPdfFailure: () => {},
    },
  }, { __DEV__: false });
  return { ...module, files, operations };
}

test('SAF download writes the exact PDF bytes to the selected content URI and verifies them', async () => {
  const api = loadExport();
  assert.equal(await api.saveReceiptPdfToAndroid(pdfBase64, 'receipt.pdf'), true);
  assert.equal(api.files.get('content://document/receipt-1'), pdfBase64);
  assert.deepEqual(api.operations.find(([op]) => op === 'write'), ['write', 'content://document/receipt-1', { encoding: 'base64' }]);
  assert.equal(api.operations.some(([op]) => op === 'read'), true);
});

test('SAF permission cancellation returns false without creating or writing a document', async () => {
  const api = loadExport({ canceled: true });
  assert.equal(await api.saveReceiptPdfToAndroid(pdfBase64, 'receipt.pdf'), false);
  assert.equal(api.operations.some(([op]) => op === 'create' || op === 'write'), false);
});

test('repeated downloads use distinct names rather than overwriting the earlier receipt', async () => {
  const api = loadExport();
  assert.equal(await api.saveReceiptPdfToAndroid(pdfBase64, 'receipt.pdf'), true);
  assert.equal(await api.saveReceiptPdfToAndroid(pdfBase64, 'receipt.pdf'), true);
  assert.deepEqual(api.operations.filter(([op]) => op === 'create').map(([, , name]) => name), ['receipt', 'receipt_2']);
});

test('SAF write and verification failures reject and clean up the partial content document', async () => {
  const writeApi = loadExport({ writeError: new Error('provider write failed') });
  await assert.rejects(writeApi.saveReceiptPdfToAndroid(pdfBase64, 'receipt.pdf'), /Unable to save PDF/);
  assert.equal(writeApi.operations.some(([op]) => op === 'delete'), true);
  const readApi = loadExport({ readError: new Error('provider read failed') });
  await assert.rejects(readApi.saveReceiptPdfToAndroid(pdfBase64, 'receipt.pdf'), /Unable to save PDF/);
});

test('share action passes a cache file URI and PDF MIME type, and reports native failure', async () => {
  const file = { uri: 'file:///cache/receipt.pdf' };
  const api = loadExport();
  await api.shareReceiptPdf(file, 'Share receipt');
  assert.deepEqual(api.operations.find(([op]) => op === 'share'), ['share', file.uri, { mimeType: 'application/pdf', dialogTitle: 'Share receipt', UTI: 'com.adobe.pdf' }]);
  const failed = loadExport({ shareError: Object.assign(new Error('provider refused file:///private/cache/receipt.pdf'), { code: 'EIO' }) });
  await assert.rejects(failed.shareReceiptPdf(file, 'Share receipt'), /Unable to open sharing options/);
});
