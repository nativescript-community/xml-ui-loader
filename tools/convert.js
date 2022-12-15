const fs = require('fs');
const generate = require('@babel/generator').default;
const chalk = require('chalk');
const { transformIntoAST } = require('../dist/component-builder');

if (process.argv.length < 3) {
  // eslint-disable-next-line no-console
  console.warn(chalk.redBright(`Usage:
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

// eslint-disable-next-line no-console
console.log(chalk.greenBright(generate(output).code));