# @nativescript-community/xml-ui-loader

[![npm](https://img.shields.io/npm/v/@nativescript-community/xml-ui-loader.svg)](https://www.npmjs.com/package/@nativescript-community/xml-ui-loader)
[![npm](https://img.shields.io/npm/dt/@nativescript-community/xml-ui-loader.svg?label=npm%20downloads)](https://www.npmjs.com/package/@nativescript-community/xml-ui-loader)
[![GitHub forks](https://img.shields.io/github/forks/nativescript-community/xml-ui-loader.svg)](https://github.com/nativescript-community/xml-ui-loader/network)
[![GitHub stars](https://img.shields.io/github/stars/nativescript-community/xml-ui-loader.svg)](https://github.com/nativescript-community/xml-ui-loader/stargazers)

This is a [webpack](https://webpack.js.org) loader for [NativeScript](https://nativescript.org).  

By default, NativeScript Core uses a builder to compile XML components at runtime and that happens every time there is a need to render views.  
This new approach is meant to work as an ahead-of-time (AOT) compiler that turns XML content into JavaScript during the build phase.  
It's meant to improve performance and allow developers to use XML files as modules.

## Table of Contents

- [Install](#install)
- [Usage](#usage)
  - [Import as a module](#import-as-a-module)
  - [Import as plain XML](#import-as-plain-xml)
- [Features](#features)
  - [Custom components](#custom-components)
  - [Script and Style](#script-and-style)
  - [Slots](#slots)
    - [Declaration](#declaration)
    - [Targeting slots](#targeting-slots)
    - [Slot fallback](#slot-fallback)
    - [Using slots in JS/TS components](#using-slots-in-jsts-components)
- [Setup](#setup)
- [License](#license)


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

### Import as plain XML

To import the raw content of an XML file, append an XML declaration to it.  
Example:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<list>
  ...
</list>
```
This will make sure import will resolve to plain XML string content.


## Features

### Custom components

Regarding custom components, the method to import one inside XML has changed so that it's identical to importing modules in JavaScript.

Correct approaches, supposing caller directory path is `app/views/home` and components directory path is `app/components`
```xml
<!-- Works -->
<Page xmlns:myxml="../../components/my-xml-component.xml" xmlns:myjs="../../components/my-js-component">
</Page>

<!-- Works -->
<Page xmlns:myxml="~/components/my-xml-component.xml" xmlns:myjs="~/components/my-js-component">
</Page>

<!-- Does not work! -->
<Page xmlns:myxml="components/my-xml-component.xml" xmlns:myjs="components/my-js-component">
</Page>
```

### Script and Style

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

### Slots

Custom components can make one's code reusable but there is always the need to have total control over view nesting as they can be quite complex at times.  
Here comes the concept of `slots`. Inspired from the web component [slot](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/slot) element, slots ensure that custom components can be extremely flexible on reusing at different cases that demand different view content.  
For more information, see: https://developer.mozilla.org/en-US/docs/Web/HTML/Element/slot  

#### Declaration

A plain slot that behaves as default
```xml
<!-- my-custom-view.xml -->
<StackLayout>
  <slot/>
</StackLayout>
```

A named slot
```xml
<!-- my-custom-view.xml -->
<StackLayout>
  <slot name="page-content"/>
</StackLayout>
```

#### Targeting slots

In order to target slots and keep NativeScript existing nesting behaviour intact at the same time, one must declare slot views inside a `slotContent` element.
```xml
<!-- my-page.xml -->
<Page xmlns:mcv="../my-custom-view.xml">
  <mcv:MyCustomView>
    <slotContent>
      <Label text="Hello"/>
    </slotContent>
  </mcv:MyCustomView>
</Page>
```

Named slots can be targeted using the `slot` attribute.
```xml
<!-- my-page.xml -->
<Page xmlns:mcv="../my-custom-view.xml">
  <mcv:MyCustomView>
    <slotContent>
      <Label slot="page-content" text="Hello"/>
    </slotContent>
  </mcv:MyCustomView>
</Page>
```

There is also the option of targeting a slot using multiple views.
```xml
<!-- my-page.xml -->
<Page xmlns:mcv="../my-custom-view.xml">
  <mcv:MyCustomView>
    <slotContent>
      <Label text="Hello"/>
      <Label text="there"/>
    </slotContent>
  </mcv:MyCustomView>
</Page>
```
or
```xml
<!-- my-page.xml -->
<Page xmlns:mcv="../my-custom-view.xml">
  <mcv:MyCustomView>
    <slotContent>
      <Label slot="page-content" text="Hello"/>
      <Label slot="page-content" text="there"/>
    </slotContent>
  </mcv:MyCustomView>
</Page>
```

Apart from views, slots can also target other slots.
```xml
<!-- my-page.xml -->
<Page xmlns:mcv="../my-custom-view.xml">
  <mcv:MyCustomView>
    <slotContent>
      <slot name="the-other-slot" slot="page-content"/>
    </slotContent>
  </mcv:MyCustomView>
</Page>
```

#### Slot fallback

Fallback refers to a view that is rendered when no view(s) target the slot.
```xml
<!-- my-custom-view.xml -->
<StackLayout>
  <slot>
    <Label text="not found!"/>
  </slot>
</StackLayout>
```

#### Using slots in JS/TS components

There is also the possibility of making use of slot functionality into script components.
```js
import { StackLayout } from '@nativescript/core';

class MyCustomView extends StackLayout {
  // Constructor has sole access to slot views
  constructor() {
    // $slotViews is an array of views
    if (this.$slotViews['default']) {
      for (const view of this.$slotViews['default']) {
        this.addChild(view);
      }
    }
  }
}

export {
  MyCustomView
}
```

```xml
<!-- my-page.xml -->
<Page xmlns:mcv="../my-custom-view">
  <mcv:MyCustomView>
    <slotContent>
      <Label text="Hello"/>
    </slotContent>
  </mcv:MyCustomView>
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