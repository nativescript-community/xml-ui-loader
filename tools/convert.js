const generate = require('@babel/generator').default;
const c = require('ansi-colors');
const fs = require('fs');
const { highlight } = require('cli-highlight');
const { transformIntoAST } = require('../dist/builders/component-builder');

if (process.argv.length < 3) {
  // eslint-disable-next-line no-console
  console.warn(c.redBright(`Usage:
  - npm run convert path/to/file
  - npm run convert -- --inline '<TagName attribute="value">...</TagName>'`));
  return;
}

const parameter = process.argv[process.argv.length - 1];
const content = process.argv.includes('--inline') ? parameter : fs.readFileSync(parameter, 'utf8');

const { output } = transformIntoAST(content, {
  moduleRelativePath: 'views/test/test.xml',
  platform: 'android'
});

if (output) {
  // eslint-disable-next-line no-console
  console.log(highlight(generate(output).code, {
    language: 'js'
  }));
}