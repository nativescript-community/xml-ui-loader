var { resolveModuleName } = require('@nativescript/core/module-name-resolver');

global.xmlCompiler = {
  loadCustomModule: function(uri, ext) {
    if (ext) {
      uri = uri.substr(0, uri.length - (ext.length + 1));
    }

    const resolvedModuleName = resolveModuleName(uri, ext);
    if (resolvedModuleName) {
      const componentModule = global.loadModule(resolvedModuleName, true);
      if (componentModule.default) {
        return componentModule.default.name != null ? {[componentModule.default.name]: componentModule.default} : componentModule.default;
      }
      return componentModule;
    }
    return null;
  }
};
