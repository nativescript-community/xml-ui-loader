var { resolveModuleName } = require('@nativescript/core/module-name-resolver');

global.xmlCompiler = {
  newInstance: function(elementName, prefix, uiCoreModules, customModules) {
    let componentModule;
    if (!prefix) {
      componentModule = uiCoreModules[elementName];
    } else {
      if (prefix in customModules) {
        if (elementName in customModules[prefix]) {
          componentModule = customModules[prefix][elementName];
        } else if (elementName === customModules[prefix].name) {
          componentModule = customModules[prefix];
        } else {
          throw new Error('Component ' + elementName + ' cannot be found in ' + prefix + ' module');
        }
        componentModule.prototype.__fallbackModuleRelativePath = '${this.moduleRelativePath}';
      } else {
        throw new Error('Cannot resolve module ' + prefix + ' for component ' + elementName);
      }
    }

    const instance = new componentModule();
    delete componentModule.prototype.__fallbackModuleRelativePath;
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
