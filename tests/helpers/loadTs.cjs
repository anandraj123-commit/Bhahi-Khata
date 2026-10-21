const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
module.exports = function loadTs(file, mocks = {}, globals = {}, cache = new Map()) {
  file = path.resolve(file);
  if (cache.has(file)) return cache.get(file).exports;
  const module = { exports: {} };
  cache.set(file, module);
  const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    fileName: file,
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const resolve = (name) => name in mocks ? mocks[name] : name.startsWith('.')
    ? loadTs(path.resolve(path.dirname(file), name + '.ts'), mocks, globals, cache) : require(name);
  new Function('require', 'module', 'exports', ...Object.keys(globals), compiled)(resolve, module, module.exports, ...Object.values(globals));
  return module.exports;
};
