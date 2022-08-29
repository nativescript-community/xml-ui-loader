const beautify = require('js-beautify').js;
const xmlLoader = require('../dist').default;

if (process.argv.length < 3) {
  // eslint-disable-next-line no-console
  console.warn('Please provide XML string as parameter!');
  return;
}

const mockContext = {
  async() {
    return (err, output, map) => {
      // beautify-js will also help on checking if output syntax is broken as it will not beautify further
      /* eslint-disable no-console */
      if (err) {
        console.error(err);
      } else {
        console.log(beautify(output, { indent_size: 2, space_in_empty_paren: true, unescape_strings: true }));
      }
      /* eslint-enable no-console */
    };
  },
  getOptions() {
    return {
      appPath: 'app',
      platform: 'ios'
    };
  },
  resourcePath: '/home/test/app/views/home/home.xml',
  rootContext: '/home/test'
};

xmlLoader.bind(mockContext)(process.argv[2], null);