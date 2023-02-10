import { Program } from '@babel/types';
import { resolve } from 'path';

export type AttributeValueFormatter = (value: string, attributeName?: string, tagName?: string, attributes?) => string;

export interface LoaderOptions {
  appPath: string;
  platform: string;
  preprocess?: {
    attributeValueFormatter?: AttributeValueFormatter;
    transformAst?: (ast: Program, generateFunc) => string;
  };
}

export const GLOBAL_UI_REF = 'simpleUI';

export function chainLoaderConfiguration(config, options: LoaderOptions) {
  const addonsPath = resolve(__dirname, '../bundle-addons');
  config.entry('bundle').add(addonsPath);

  config.module.rules.delete('xml');

  // Update HMR supported extensions
  config.module.rules.has('hmr-core') && config.module.rules.get('hmr-core').test(/\.(js|ts|xml)$/);

  config.module
    .rule('xml')
    .test(/\.xml$/i)
    .use('@nativescript-community/xml-ui-loader')
    .loader('@nativescript-community/xml-ui-loader')
    .options(options);

  config.plugin('DefinePlugin').tap(args => {
    Object.assign(args[0], {
      '__UI_USE_XML_PARSER__': false,
      '__UI_USE_EXTERNAL_RENDERER__': true
    });
    return args;
  });
}