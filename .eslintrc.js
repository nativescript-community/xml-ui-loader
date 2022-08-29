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
    'no-prototype-builtins': 0,
  },
  overrides: [{
    'files': '*',
    'rules': {
      'quotes': [2, 'single']
    }
  },
  {
    'files': ['*.ts', '*.tsx'],
    'parser': '@typescript-eslint/parser',
    'extends': [
      'plugin:@typescript-eslint/eslint-recommended',
      'plugin:@typescript-eslint/recommended'
    ],
    'rules': {
      '@typescript-eslint/interface-name-prefix': 'off',
      '@typescript-eslint/member-delimiter-style': 'error',
      '@typescript-eslint/member-ordering': 'off',
      '@typescript-eslint/no-empty-function': 'off',
      '@typescript-eslint/no-empty-interface': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-floating-promises': 'off',
      '@typescript-eslint/no-inferrable-types': 'off',
      '@typescript-eslint/no-misused-new': 'off',
      '@typescript-eslint/no-namespace': 'off',
      '@typescript-eslint/no-parameter-properties': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-use-before-declare': 'off',
      '@typescript-eslint/no-var-requires': 'off',
      '@typescript-eslint/prefer-for-of': 'off',
      '@typescript-eslint/prefer-function-type': 'error',
      '@typescript-eslint/prefer-namespace-keyword': 'error'
    }
  }],
  'extends': [
    'eslint:recommended'
  ]
};