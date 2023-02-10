let { Application, Utils, ViewBase } = require('@nativescript/core');
let { isEventOrGesture } = require('@nativescript/core/ui/core/bindable');
let { resolveModuleName } = require('@nativescript/core/module-name-resolver');

global.simpleUI = {
  addViewsFromBuilder(parent, children, propertyName = null) {
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
  createParentsBindingInstance(view, cssTypes) {
    const instance = {};
    
    let parent = view.parent;
    while (parent && cssTypes.length) {
      const index = cssTypes.findIndex(cssType => cssType.toLowerCase() === parent.cssType);
      if (index >= 0) {
        const cssType = cssTypes.splice(index, 1);
        instance[cssType[0]] = parent.bindingContext;
      }
      parent = parent.parent;
    }

    // Some parents are not available soon enough, so a retry is done when view gets loaded
    if (cssTypes.length && !view.isLoaded) {
      view.off(ViewBase.loadedEvent, global.simpleUI.notifyViewBindingContextChange);
      view.once(ViewBase.loadedEvent, global.simpleUI.notifyViewBindingContextChange);
    }
    return instance;
  },
  getCompleteBindingSource(bindingContext, callback) {
    const bindingResources = Application.getResources();
    const addedBindingContextProperties = [];
    let source;

    // Ensure source is an object
    if (bindingContext == null) {
      source = {};
    } else {
      const type = typeof bindingContext;
      if (type === 'number') {
        source = new Number(bindingContext);
      } else if (type === 'boolean') {
        source = new Boolean(bindingContext);
      } else if (type === 'string') {
        source = new String(bindingContext);
      } else {
        source = bindingContext;
      }
    }

    // Addition of application resources
    for (let propertyName in bindingResources) {
      if (!(propertyName in source)) {
        source[propertyName] = bindingResources[propertyName];
        addedBindingContextProperties.push(propertyName);
      }
    }

    callback(source);

    // Finally, perform a cleanup for view model
    for (let propertyName of addedBindingContextProperties) {
      delete source[propertyName];
    }
  },
  loadCustomModule(uri, ext) {
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
  },
  notifyViewBindingContextChange(args) {
    const view = args.object;
    view.notify({
      object: view,
      eventName: 'bindingContextChange',
      propertyName: 'bindingContext',
      value: view.bindingContext,
      oldValue: view.bindingContext,
    });
  },
  onBindingSourcePropertyChange(args) {
    let view = this;
    let bindingContext = args.object;

    global.simpleUI.getCompleteBindingSource(bindingContext, viewModel => {
      let $value = viewModel;
      let $parent = view.parent ? view.parent.bindingContext : null;

      if (args.propertyName in view._bindingSourceCallbackPairs) {
        view._bindingSourceCallbackPairs[args.propertyName](view, viewModel, {
          $value,
          $parent
        });
      }
    });
  },
  runConverterCallback(converter, args, toModelDirection = false) {
    let callback;
    if (!Utils.isNullOrUndefined(converter) && Utils.isObject(converter)) {
      callback = (toModelDirection ? converter.toModel : converter.toView);
    } else {
      callback = converter;
    }
    return Utils.isFunction(callback) ? callback.apply(null, args) : undefined;
  },
  setPropertyValue(owner, propertyName, propertyValue, moduleExports) {
    let instance = owner;
    if (propertyName.indexOf('.') !== -1) {
      const properties = propertyName.split('.');

      for (let i = 0, length = properties.length - 1; i < length; i++) {
        if (instance != null) {
          instance = instance[properties[i]];
        }
      }
      propertyName = properties[properties.length - 1];
    }
    
    if (instance != null) {
      if (isEventOrGesture(propertyName, instance)) {
        // Get the event handler from component module exports
        const handler = moduleExports?.[propertyValue];
    
        // Check if the handler is function and add it to the instance for specified event name
        if (typeof handler === 'function') {
          instance.on(propertyName, handler);
        }
      } else {
        instance[propertyName] = propertyValue;
      }
    }
  }
};
