import babel from "https://dev.jspm.io/@babel/standalone@7.12.4";
import uniq from "https://deno.land/x/lodash@4.17.15-es/uniq.js";
import * as fs from "https://deno.land/std@0.69.0/fs/mod.ts";
import { parse } from "https://deno.land/std@0.69.0/flags/mod.ts";

const args = parse(Deno.args);

const input: string = String(args._[0]);
const BUNDLE_PATH: string = String(args._[1] ?? './bundle');

const configPath = args.config ?? './bundle_config.json' ;

interface IConfig {
  node: string; // Node version;
  static?: string; // Static folder path. Bundler will copy all files into #BUNDLE_PATH#;
  deps?: {
    [module: string]: { // replace some module. Module name from import_map.json or URL.
      name?: string; // module name ( in result package.json );
      npm?: string;  // npm version ( in result package.json );
      global?: string; // global variable name;
      path?: string; // global variable path from root module;
      std?: string; // Deno std module stub. Now only `fs` is supported;
    }
  }
}

const DEFAULT_CONFIG: IConfig = {
  node: '12',
};

const config: IConfig = {
  ...DEFAULT_CONFIG,
  ...(fs.existsSync(configPath) ? JSON.parse(Deno.readTextFileSync(configPath)) : {})
};


const importMapPath = args.importmap ?? './import_map.json';

const defaultImportMap = fs.existsSync(importMapPath) ? JSON.parse(Deno.readTextFileSync(importMapPath)) : {};

console.log('Creating temp files...');

const packageJSON: any = {
  name: 'bundle',
  version: '1.0.0',
  dependencies: {
    'node-fetch': '2.6.1',
  }
};

// Create FS Stub (by global.fs)
const tempDirPath = Deno.makeTempDirSync();

const fsStubPath= tempDirPath + '/fsStub.ts';
const fsMethods = Object.keys(fs);
const fsStubContent = `
  const nodeFS: any = (globalThis as any).fs as any;
   ${fsMethods.reduce((acc, method) => acc + `
  export const ${method} = nodeFS.${method};`, '')} 
`;

Deno.writeTextFileSync(fsStubPath, fsStubContent);

// Create empty stub to skip typescript errors and then replace by UMD module in Node.
const emptyStubPath = tempDirPath + '/empty.js';
const emptyStubContent = 'module.exports = require("DELETE_ME");'
Deno.writeTextFileSync(emptyStubPath, emptyStubContent);


const importMap: any = { imports: {} };

const umdModules: Array<any> = [];

const deps = config.deps ?? {};

uniq([...Object.keys(defaultImportMap.imports), ...Object.keys(deps)]).forEach((module: string) => {
  importMap.imports[module] = defaultImportMap.imports[module] ?? emptyStubPath;

  if (deps[module]) {
    if (deps[module].npm) {
      packageJSON.dependencies[module] = deps[module].npm;
      if (defaultImportMap.imports[module]) { // Add to Deno importmap only if needed.
        importMap.imports[module] = emptyStubPath;
      }
      umdModules.push(deps[module]);
    }

    if (deps[module].std === 'fs') {
      importMap.imports[module] = fsStubPath;
    }
  }
})

const bundleImportMapPath = tempDirPath + '/import_map.json';
Deno.writeTextFileSync(bundleImportMapPath, JSON.stringify(importMap));

console.log('Deno bundle...');

const process = Deno.run({
  cmd: ["deno", "bundle", "--unstable", `--importmap=${bundleImportMapPath}`, input],
  stdout: 'piped',
});

const emit = await process.output();
const status = await process.status();

if (!status.success) {
  throw status.code;
}

let code =  new TextDecoder("utf-8").decode(emit);

console.log('Customs:');
console.log('Replace empty stubs...');
// Remove empty stub content
code = code.replaceAll(emptyStubContent, '');


console.log('Transpile to commonjs export...');

// Resolve top level await
let isAsync = false;
if (code.includes('const __exp = await __instantiate')) {
  isAsync = true;

  code = code.replace(
    /const __exp = await __instantiate\("(.+)", true\);/,
    `
      let __exp;
      
      (async () => {
        __exp = await __instantiate("$1", true);
      })();
    `
  )
}

// To commonJS export
code = code.replaceAll(
  /export const (.+) = (__exp\[".+"]);/g,
  isAsync
    ? 'module.exports.$1 = async (...args) => $2(...args);'
    : 'module.exports.$1 = $2;'
);

console.log('Babel Transpile to Node...');

// Transpile code to support Node
const babelConfig = {
  presets: [
    ['env', {
      targets: { node: config.node } ,
    }]],
  plugins: [
    'proposal-class-properties',
  ]
};

const result = babel.transform(code, babelConfig);

code = result.code;

let nodeContent = `
  const fs = require('fs');
  const fsPromises = require('fs').promises;

  const DenoStub = {
    build: {
      os: 'UNDEFINED'
  },
    Buffer: Buffer,
    errors: {
      AlreadyExists: console.error,
      UnexpectedEof: class {},
    }
  };
  
  const DenoFS = Object.assign({}, fs, fsPromises);
  const Deno = Object.assign({}, DenoFS, DenoStub);
  
  global.Deno = Deno;
  global.fs = DenoFS;
  
  const { performance } = require('perf_hooks');
  global.perfomance = performance;
  
  const fetch = require('node-fetch');
  global.fetch = fetch;

  global.window = global;  // Support Deno
  global.globalThis = global; // Support Deno
`;

umdModules.forEach((moduleConfig) => {
  if (!moduleConfig.global) {
    nodeContent += `
      require('${moduleConfig.name}');
    `;
  } else {
    nodeContent += `
      const ${moduleConfig.global}Module = require('${moduleConfig.name}');
      global.${moduleConfig.global} = ${moduleConfig.global}Module${moduleConfig.path ?? ''};
    `;
  }
})

code = nodeContent + code;

// Finally make bundle

// 1. Remove old dir
console.log('Remove old dir...');
try {
  Deno.removeSync(BUNDLE_PATH,{"recursive": true});
} catch (e) {

}

console.log('Create new dir...');
Deno.mkdirSync(BUNDLE_PATH);

// 2. Create package.json:
console.log('Write package.json...');
Deno.writeTextFileSync(BUNDLE_PATH + '/package.json', JSON.stringify(packageJSON));

// 3. Write result code:
console.log('Write bundle...');
Deno.writeTextFileSync(BUNDLE_PATH + '/bundle.js', code);

//4. Remove tmp
console.log('Remove tmp dir...');
Deno.removeSync(tempDirPath,{"recursive": true});

// 5. Copy static files
if (config.static) {
  console.log('Copy static...');
  fs.copySync(config.static!, BUNDLE_PATH, { overwrite: true });
}

console.log('Bundle complete.');

