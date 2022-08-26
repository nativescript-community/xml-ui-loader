module.exports = {
  'parserOptions': {
    'ecmaVersion': 2020,
    'ecmaFeatures': {
      'destructuring': true
    }
  },
  'env': {
    'browser': true,
    'es6': true,
    'mocha': true,
    'node': true
  },
  // Rule levels: 0 - off, 1 - warning, 2 - error
  // Note: Rule level is always the first parameter in an array of parameters
  'rules': {
    'brace-style': [1, '1tbs'],
    'indent': [1, 2,
      {
        'SwitchCase': 1
      }
    ],
    'quotes': [2, 'single'],
    'linebreak-style': [2, 'unix'],
    'require-await': 1,
    'semi': [2, 'always'],
    'no-control-regex': 1,
    'no-console': 1,
    'no-unused-vars': [1,
      {
        'args': 'none'
      }
    ],
    'no-prototype-builtins': 0
  },
  overrides: [{
    files: '*',
    rules: {
      'quotes': [2, 'single']
    }
  }, ],
  'extends': 'eslint:recommended'
};