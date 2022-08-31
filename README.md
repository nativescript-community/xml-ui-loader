# @nativescript-community/xml-ui-loader

[![npm](https://img.shields.io/npm/v/@nativescript-community/xml-ui-loader.svg)](https://www.npmjs.com/package/@nativescript-community/xml-ui-loader)
[![npm](https://img.shields.io/npm/dt/@nativescript-community/xml-ui-loader.svg?label=npm%20downloads)](https://www.npmjs.com/package/@nativescript-community/xml-ui-loader)
[![GitHub forks](https://img.shields.io/github/forks/nativescript-community/xml-ui-loader.svg)](https://github.com/nativescript-community/xml-ui-loader/network)
[![GitHub stars](https://img.shields.io/github/stars/nativescript-community/xml-ui-loader.svg)](https://github.com/nativescript-community/xml-ui-loader/stargazers)

This is a [webpack](https://webpack.js.org) loader for [NativeScript](https://nativescript.org).  

By default, NativeScript Core uses a builder to compile XML components at runtime and that happens every time there is a need to render views.  
This new approach is meant to work as an ahead-of-time (AOT) compiler that turns XML content into JavaScript during the build phase.  
It's meant to improve performance and allow developers to use XML files as modules.


## Install

```
npm install @nativescript-community/xml-ui-loader --save-dev
```


## Usage

### Import as a module

One can easily import an XML component just like any regular JS module.  
Example:
```javascript
import MyActionBar from "./components/my-action-bar.xml";
```

### Custom components

Regarding custom components, the method to import one inside XML has changed so that it's identical to importing modules in JavaScript.

Correct approaches, supposing caller directory path is `app/views/home` and components directory path is `app/components`
```xml
<!-- Works -->
<Page xmlns:myxml="../../components/my-xml-component.xml" xmlns:myxml="../../components/my-js-component">
</Page>

<!-- Works -->
<Page xmlns:myxml="~/components/my-xml-component.xml" xmlns:myxml="~/components/my-js-component">
</Page>

<!-- Does not work! -->
<Page xmlns:myxml="components/my-xml-component.xml" xmlns:myxml="components/my-js-component">
</Page>
```

## Setup

This loader requires a new webpack configuration:

`webpack.config.js`
```javascript
const webpack = require('@nativescript/webpack');
const { getEntryPath, getEntryDirPath, getPlatformName } = require('@nativescript/webpack/dist/helpers/platform');

module.exports = (env) => {
  webpack.init(env);

  // Learn how to customize:
  // https://docs.nativescript.org/webpack

  webpack.chainWebpack((config) => {
    config.module.rules.delete('hmr-core');
    config.module.rules.delete('xml');

    // Set up core HMR anew to support xml extension (add ts extension for TypeScript apps)
    config.module
      .rule('hmr-core')
      .before('js')
      .test(/\.(js|xml)$/)
      .exclude.add(/node_modules/)
      .add(getEntryPath())
      .end()
      .use('nativescript-hot-loader')
      .loader('nativescript-hot-loader')
      .options({
        appPath: getEntryDirPath(),
      });

    config.module
      .rule('xml')
      .test(/\.xml$/i)
      .use('@nativescript-community/xml-ui-loader')
      .loader('@nativescript-community/xml-ui-loader')
      .options({
        appPath: getEntryDirPath(),
        platform: getPlatformName()
      });


    config.plugin('DefinePlugin').tap(args => {
      Object.assign(args[0], {
        '__UI_USE_XML_PARSER__': false
      });
      return args;
    });
  });

  return webpack.resolveConfig();
};
```


## License

Apache-2.0