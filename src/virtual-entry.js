var { resolveModuleName } = require('@nativescript/core/module-name-resolver');

global.xmlCompiler = {
  newInstance: function({elementName = null, prefix = '', moduleExports = null, uiCoreModules = {}, customModules = {}} = {}) {
    let componentModule;
    if (!prefix) {
      if (elementName in uiCoreModules) {
        componentModule = uiCoreModules[elementName];
      } else {
        throw new Error('Component ' + elementName + ' cannot be found in ui core modules');
      }
    } else {
      if (prefix in customModules) {
        if (elementName in customModules[prefix]) {
          componentModule = customModules[prefix][elementName];
        } else if (elementName === customModules[prefix].name) {
          componentModule = customModules[prefix];
        } else {
          throw new Error('Component ' + elementName + ' cannot be found in ' + prefix + ' module');
        }
        componentModule.prototype.__fallbackModuleExports = moduleExports;
      } else {
        throw new Error('Cannot resolve module ' + prefix + ' for component ' + elementName);
      }
    }

    const instance = new componentModule();
    delete componentModule.prototype.__fallbackModuleExports;
    return instance;
  },
  loadCustomModule: function(prefix, uri, ext, customModules) {
    if (ext) {
      uri = uri.substr(0, uri.length - (ext.length + 1));
    }

    const resolvedModuleName = resolveModuleName(uri, ext);
    if (resolvedModuleName) {
      const componentModule = global.loadModule(resolvedModuleName, true);
      customModules[prefix] = componentModule.default ?? componentModule;
    }
  }
};
