const generate = require('@babel/generator').default;
const fs = require('fs');
const { highlight } = require('cli-highlight');
const { transformIntoAST } = require('../dist/builders/component-builder');

if (process.argv.length < 3) {
  // eslint-disable-next-line no-console
  console.info(highlight(`
# Usage:
  npm run convert <value>
  npm run convert -- --param1 --param2 <value>

# Parameters
  --inline: Allows parsing inline XML string
  --ast: Returns AST output instead of generated code`, {
    language: 'markdown'
  }));
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
  console.log(process.argv.includes('--ast') ? highlight(JSON.stringify(output), {
    language: 'json'
  }) : highlight(generate(output).code, {
    language: 'js'
  }));
}