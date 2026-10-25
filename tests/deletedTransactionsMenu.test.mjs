import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

test('Activity History restore menu changes only its label and foreground colors', () => {
  const app = readFileSync('App.tsx', 'utf8');
  const activity = app.match(/case "audit":[\s\S]*?header: <View style=\{\{ gap: 8 \}\}>([\s\S]*?)<\/View>/)?.[1] || '';
  assert.match(activity, /icon="trash-outline"/);
  assert.match(activity, /title="Restore Deleted Transactions"/);
  assert.match(activity, /secondary textColor="#DC2626" iconColor="#DC2626"/);
  assert.match(activity, /go\("deletedTransactions"\)/);
  assert.doesNotMatch(activity, /numberOfLines=\{1\}|ellipsizeMode/);
});

test('shared Button supports per-action text and icon colors while retaining shrinkable labels', () => {
  const ui = readFileSync('src/ui.tsx', 'utf8');
  assert.match(ui, /textColor\?: string/);
  assert.match(ui, /iconColor\?: string/);
  assert.match(ui, /s\.buttonLabel/);
  assert.match(ui, /flexShrink: 1, textAlign: "center"/);
});
