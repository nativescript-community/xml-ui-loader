import { resolve } from 'path';

export function chainLoaderConfiguration(config, options) {
  const virtualEntryPath = resolve(__dirname, '../virtual-entry');
  config.entry('bundle').add(virtualEntryPath);

  config.module.rules.delete('xml');

  // Update HMR supported extensions
  config.module.rules.has('hmr-core') && config.module.rules.get('hmr-core').test(/\.(js|ts|xml)$/);

  config.module
    .rule('xml')
    .test(/\.xml$/i)
    .use('@nativescript-community/xml-ui-loader')
    .loader('@nativescript-community/xml-ui-loader')
    .options({
      appPath: options.appPath,
      platform: options.platform
    });

  config.plugin('DefinePlugin').tap(args => {
    Object.assign(args[0], {
      '__UI_USE_XML_PARSER__': false
    });
    return args;
  });
}