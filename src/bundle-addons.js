let { Application, addWeakEventListener, Observable, removeWeakEventListener, Utils, unsetValue, ViewBase } = require('@nativescript/core');
let { resolveModuleName } = require('@nativescript/core/module-name-resolver');

let _dataBindingHandler = {
  addChangeListener(source, target, propertyNames, changeCallback) {
    addWeakEventListener(source, Observable.propertyChangeEvent, changeCallback, target);
  },
  removeChangeListener(source, target, propertyNames, changeCallback) {
    removeWeakEventListener(source, Observable.propertyChangeEvent, changeCallback, target);
  },
  isCompatible(source, target) {
    return source instanceof Observable;
  },
  setValue(source, target, propertyName, propertyValue) {
    source.set(propertyName, propertyValue);
  }
};

global.simpleUI = {
  get dataBindingHandler() {
    return _dataBindingHandler;
  },
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
  loadCustomModule(uri, ext) {
    if (ext) {
      uri = uri.substr(0, uri.length - (ext.length + 1));
    }

    const resolvedModuleName = resolveModuleName(uri, ext);
    return resolvedModuleName ? global.loadModule(resolvedModuleName, true) : null;
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

    global.simpleUI.startViewModelToViewUpdate(view, view.bindingContext, viewModel => {
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
  runConverterCallback(context, converter, args, toModelDirection = false) {
    let callback;
    if (!Utils.isNullOrUndefined(converter) && Utils.isObject(converter)) {
      callback = (toModelDirection ? converter.toModel : converter.toView);
    } else {
      callback = converter;
    }
    return Utils.isFunction(callback) ? callback.apply(context, args) : undefined;
  },
  setDataBindingHandler(handler) {
    _dataBindingHandler = handler;
  },
  setViewPropertyValue(view, propertyName, propertyValue, isEvent, notifyForChanges = true) {
    let propertyOwner = view;

    if (propertyName.indexOf('.') !== -1) {
      const properties = propertyName.split('.');

      for (let i = 0, length = properties.length - 1; i < length; i++) {
        if (propertyOwner != null) {
          propertyOwner = propertyOwner[properties[i]];
        }
      }
      propertyName = properties[properties.length - 1];
    }

    // Use unset value as default if expression result is undefined
    if (Utils.isUndefined(propertyValue)) {
      propertyValue = unsetValue;
    }
    
    if (propertyOwner != null) {
      if (isEvent) {
        const handlerPropertyName = `_${propertyName}_handler`;

        // Check if old handler is a function and remove it from listeners
        if (Utils.isFunction(propertyOwner[handlerPropertyName])) {
          propertyOwner.off(propertyName, propertyOwner[handlerPropertyName]);
          delete propertyOwner[handlerPropertyName];
        }
        // Check if new handler is a function and add it to listeners
        if (Utils.isFunction(propertyValue)) {
          propertyOwner.on(propertyName, propertyValue);
          propertyOwner[handlerPropertyName] = propertyValue;
        }
      } else if (!notifyForChanges && propertyOwner instanceof Observable) {
        propertyOwner.set(propertyName, propertyValue);
      } else {
        propertyOwner[propertyName] = propertyValue;
      }
    }
  },
  startViewToViewModelUpdate(view, bindingContext, callback) {
    callback(bindingContext);
  },
  startViewModelToViewUpdate(view, bindingContext, callback) {
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
  }
};
