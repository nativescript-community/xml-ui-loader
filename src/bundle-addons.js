var { resolveModuleName } = require('@nativescript/core/module-name-resolver');

global.xmlCompiler = {
  addViewsFromBuilder: function(parent, children, propertyName = null) {
    if (parent._addChildFromBuilder) {
      for (const child of children) {
        if (child) {
          parent._addChildFromBuilder(child.constructor.name, child);
        }
      }
    } else if (propertyName != null) {
      // Note: NativeScript UI plugins make use of Property valueChanged event to manipulate views
      if (children.length) {
        parent[propertyName] = children[children.length - 1];
      }
    } else {
      throw new Error(`Component ${parent.constructor.name} has no support for nesting views`);
    }
  },
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
