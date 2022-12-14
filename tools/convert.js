const fs = require('fs');
const { join } = require('path');
const xmlLoader = require('../dist').default;

if (process.argv.length < 3) {
  // eslint-disable-next-line no-console
  console.warn('Please provide XML string as parameter!');
  return;
}

const parameter = process.argv[process.argv.length - 1];
const content = process.argv.includes('--inline') ? parameter : fs.readFileSync(parameter, 'utf8');

const mockContext = {
  async() {
    return (err, output, map) => {
      // beautify-js will also help on checking if output syntax is broken as it will not beautify further
      /* eslint-disable no-console */
      if (err) {
        console.error(err);
      } else {
        console.log(output);
      }
      /* eslint-enable no-console */
    };
  },
  getOptions() {
    return {
      appPath: '/home/test/app',
      platform: 'ios'
    };
  },
  resolve: (context, request, callback) => {
    callback(null, join(context, request));
  },
  resourcePath: '/home/test/app/views/home/home.xml',
  context: '/home/test/app/views/home'
};

xmlLoader.bind(mockContext)(content, null);