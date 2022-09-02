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

### Script & Style

In general, one is able to create script and style files for an XML component provided that they use the same filename.  
The first contains useful entities like events used by XML and the latter applies all CSS to it.  

There is also a forgotten method to bind scripts or styles to XML.  
It's `codeFile` and `cssFile` properties. These properties are assigned to top element inside an XML file and are especially useful when one wishes to bind a single script or style file with multiple components.  

```xml
<!-- Script -->
<Page codeFile="~/views/common/myscript">
</Page>

<!-- CSS -->
<Page cssFile="~/views/common/mystyle">
</Page>
```

## Setup

This loader requires a new webpack configuration:

`webpack.config.js`
```javascript
const webpack = require('@nativescript/webpack');
const { getEntryDirPath, getPlatformName } = require('@nativescript/webpack/dist/helpers/platform');
const { chainLoaderConfiguration } = require("@nativescript-community/xml-ui-loader/dist/helpers/webpack");

module.exports = (env) => {
  webpack.init(env);

  // Learn how to customize:
  // https://docs.nativescript.org/webpack

  webpack.chainWebpack((config) => {
    chainLoaderConfiguration(config, {
      appPath: getEntryDirPath(),
      platform: getPlatformName()
    });
  });

  return webpack.resolveConfig();
};
```


## License

Apache-2.0