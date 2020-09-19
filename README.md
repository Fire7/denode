# denode 🐉
Run your Deno code in Node.js!

## Disclaimer ⚠️
Project is only proof of concept, many cases may not works. Pull requests and discussion are welcome!

## How it works: 
1. Bundle with Deno `bundle` absent replacement modules from `deps` section of config.
2. Babel code to support by specified node version.
3. Generate package.json with dependencies.
4. Create global variable `Deno` with wome std features (now only *fs* is supported).
5. Add calls of npm modules (see **Dependencies replacement explanation** section).

## CLI
**denode** is available as cli tool

### Usage
```
 deno run -A --unstable https://deno.land/x/denode/mod.ts function.ts ./bundle
```

### Options

Option | Default | Description
------------ | ------------- | -------------
--config <FILE> | bundle_config.json | denode configuration file (see description below)
--importmap <FILE> | undefined | Load import map file


### Configuration options
JSON file with next structure: 

```json
{
  "node": "12",
  "static": "src/static",
  "deps": {
    "some-npm-module": {
      "name": "some-npm-module",
      "npm": "1.1.1",
      "global": "someNpmModule",
      "path": ".someNpmModule"
    },
    "https://deno.land/std/fs/mod.ts": {
      "std": "fs"
    }
  }
}
```

```typescript
interface IConfig {
  node: string;         // Target Node.js version;
  static?: string;      // Static folder path. Denode will copy all files into #BUNDLE_PATH#;
  deps?: {              // Dependencies, that should be replaced in target bundle (module name from import_map.json or URL);
    [module: string]: {
      name?: string;    // module name ( in result package.json );
      npm?: string;     // npm version ( in result package.json );
      global?: string;  // global variable name;
      path?: string;    // global variable path from root module;
      std?: string;     // Deno std module stub. Now only 'fs' is supported;
    }
  }
}
```
## Dependencies replacement explanation
In some cases, there is a need in replace some module in Deno with Node (npm) similiar one or replace Deno native api with Node native.

### npm modules
⚠️ Import throwugh global variables are only support for now. 
No code of module will delivery to result bundle.

Example: 
Code in Deno: 
```typescript
import 'someLib';

declare global {
  var Lib: any;
}

Lib.doSomeJob();
...
```

To replace it with npm module you should add it to `bundle_config.json` in `deps` section: 

```json
"deps": {
  "someLib": {
     "name": "someLib",
     "npm": "^1.1.1"
  }
}
```

This will add `"someLib": "^1.1.1"` in `package.json` **and** will add in result bundle code (in start of it):

```javascript
  require('someLib'); // just require module
```
---
#### "global" option: 

```json
"deps": {
  "someLib": {
     "name": "someLib",
     "npm": "^1.1.1",
     "global": "globalSomeLib"
  }
}
```

Will become:

```javascript
const someLibModule = require('someLib');
global.globalSomeLib = someLibModule; // add global variable
```
---
#### "path" and "global" option: 
```json
"deps": {
  "someLib": {
     "name": "someLib",
     "npm": "^1.1.1",
     "global": "globalSomeLib",
     "path": ".lib"
  }
}
```

Will become:

```javascript
const someLibModule = require('someLib');
global.globalSomeLib = someLibModule.lib; // path added
```

### std modules
Now only `fs` module is supported

Example:
This code will work in both Deno and Node:

```typescript
import * as fs from "https://deno.land/std@0.69.0/fs/mod.ts";

console.log(fs.existsSync('/some/path'));
```

Config: 
```json
"deps": {
  "https://deno.land/std@0.69.0/fs/mod.ts": {
     "std": "fs"
  }
}
```

















