import { pascalCase } from 'change-case';
import { parse } from 'path';
import { isString } from './helpers/types';

const ELEMENT_PREFIX = 'el';
const MULTI_TEMPLATE_TAG = 'template';
const MULTI_TEMPLATE_KEY_ATTRIBUTE = 'key';

// For example, ListView.itemTemplateSelector
const KNOWN_FUNCTIONS = 'knownFunctions';
const KNOWN_TEMPLATE_SUFFIX = 'Template';
const KNOWN_MULTI_TEMPLATE_SUFFIX = 'Templates';
const knownCollections: string[] = ['items', 'spans', 'actionItems'];
const knownPlatforms: string[] = ['android', 'ios', 'desktop'];

interface ComplexProperty {
  parentIndex: number;
  name: string;
  elementReferences?: Array<string>;
  templateViewIndex?: number;
}

export class ComponentParser {
  private parentIndices = new Array<number>();
  private complexProperties = new Array<ComplexProperty>();

  // Keep counter for the case of platform tags being inside platform tags
  private unsupportedPlatformTagCount: number = 0;

  private moduleRelativePath: string = '';
  private head: string = '';
  private body: string = '';
  private platform: string;
  private treeIndex: number = 0;

  constructor(moduleRelativePath: string, platform: string) {
    const { ext, name } = parse(moduleRelativePath);
    const componentName = pascalCase(name);

    this.moduleRelativePath = moduleRelativePath.substring(0, moduleRelativePath.length - ext.length);

    this.appendImports();

    this.body += `export default class ${componentName} {
      constructor() {`;

    // Generate functions in constructor scope so that they are not accessible from outside
    this.generateHelperFunctions();

    this.platform = platform;
  }

  public handleOpenTag(elementName: string, prefix: string, attributes) {
    // Platform tags
    if (knownPlatforms.includes(elementName)) {
      if (elementName.toLowerCase() !== this.platform) {
        this.unsupportedPlatformTagCount++;
      }
      return;
    }
    if (this.unsupportedPlatformTagCount > 0) {
      return;
    }

    const parentIndex: number = this.parentIndices[this.parentIndices.length - 1] ?? -1;

    if (elementName === MULTI_TEMPLATE_TAG) {
      const complexProperty = this.complexProperties[this.complexProperties.length - 1];
      if (parentIndex >= 0 && complexProperty && complexProperty.parentIndex == parentIndex) {
        if (attributes[MULTI_TEMPLATE_KEY_ATTRIBUTE]) {
          // This is necessary for proper string escape
          const attrValue = attributes[MULTI_TEMPLATE_KEY_ATTRIBUTE].value.replaceAll('\'', '\\\'');
          this.body += `{ key: '${attrValue}', createView: () => {`;
        } else {
          // eslint-disable-next-line no-console
          console.warn('Found template without key inside ${complexProperty.name}');
        }
      }
    } else if (this.isComplexProperty(elementName)) {
      const complexProperty: ComplexProperty = {
        parentIndex,
        name: this.getComplexPropertyName(elementName),
        elementReferences: [],
        templateViewIndex: this.treeIndex
      };

      this.complexProperties.push(complexProperty);

      this.body += `/* ${elementName} - start */`;
      
      if (complexProperty.name.endsWith(KNOWN_TEMPLATE_SUFFIX)) {
        this.body += `${ELEMENT_PREFIX}${parentIndex}.${complexProperty.name} = () => {`;
      } else if (complexProperty.name.endsWith(KNOWN_MULTI_TEMPLATE_SUFFIX)) {
        this.body += `${ELEMENT_PREFIX}${parentIndex}.${complexProperty.name} = [`;
      }
    } else {
      const complexProperty = this.complexProperties[this.complexProperties.length - 1];

      this.checkForNamespaces(attributes);
      this.buildComponent(elementName, prefix, attributes);

      if (parentIndex >= 0) {
        if (complexProperty && complexProperty.parentIndex == parentIndex) {
          // Add component to complex property of parent component
          this.addToComplexProperty(parentIndex, complexProperty);
        } else {
          this.body += `${ELEMENT_PREFIX}${parentIndex}._addChildFromBuilder && ${ELEMENT_PREFIX}${parentIndex}._addChildFromBuilder('${elementName}', ${ELEMENT_PREFIX}${this.treeIndex});`;
        }
      }

      this.parentIndices.push(this.treeIndex);
      this.treeIndex++;
    }
  }

  public handleCloseTag(elementName: string) {
    // Platform tags
    if (knownPlatforms.includes(elementName)) {
      if (elementName.toLowerCase() !== this.platform) {
        this.unsupportedPlatformTagCount--;
      }
      return;
    }
    if (this.unsupportedPlatformTagCount > 0) {
      return;
    }

    const parentIndex: number = this.parentIndices[this.parentIndices.length - 1] ?? -1;
    const complexProperty = this.complexProperties[this.complexProperties.length - 1];

    if (elementName === MULTI_TEMPLATE_TAG) {
      if (parentIndex >= 0 && complexProperty && complexProperty.parentIndex == parentIndex) {
        this.body += this.treeIndex > complexProperty.templateViewIndex ? `return ${ELEMENT_PREFIX}${complexProperty.templateViewIndex}; }},` : 'return null; }},';
        complexProperty.templateViewIndex = this.treeIndex;
      }
    } else if (this.isComplexProperty(elementName)) {
      if (complexProperty) {
        if (complexProperty.name.endsWith(KNOWN_TEMPLATE_SUFFIX)) {
          this.body += this.treeIndex > complexProperty.templateViewIndex ? `return ${ELEMENT_PREFIX}${complexProperty.templateViewIndex}; };` : 'return null; };';
        } else if (complexProperty.name.endsWith(KNOWN_MULTI_TEMPLATE_SUFFIX)) {
          this.body += '];';
        } else if (parentIndex >= 0) {
          // If parent is AddArrayFromBuilder call the interface method to populate the array property
          this.body += `${ELEMENT_PREFIX}${parentIndex}._addArrayFromBuilder && ${ELEMENT_PREFIX}${parentIndex}._addArrayFromBuilder('${complexProperty.name}', [${complexProperty.elementReferences.join(', ')}]);`;
          complexProperty.elementReferences = [];
        }
      }
      this.body += `/* ${elementName} - end */`;
      // Remove the last complexProperty from the complexProperties collection (move to the previous complexProperty scope)
      this.complexProperties.pop();
    } else {
      // Remove the last parent from the parents collection (move to the previous parent scope)
      this.parentIndices.pop();
    }
  }

  public finish() {
    this.body += `return ${ELEMENT_PREFIX}0;
      }
    }`;
  }

  public getOutput(): string {
    return this.head + this.body;
  }

  private appendImports() {
    this.head += `var { resolveModuleName } = require('@nativescript/core/module-name-resolver');
    var { Trace } = require('@nativescript/core/trace');
    var uiCoreModules = require('@nativescript/core/ui');
    var { isEventOrGesture } = require('@nativescript/core/ui/core/bindable');
    var { getBindingOptions, bindingConstants } = require('@nativescript/core/ui/builder/binding-builder');
    var customModules = {};
    `;
  }

  private applyComponentAttributes(attributes) {
    const attributeData: any[] = Object.values(attributes);
    for (const { local, prefix, value } of attributeData) {
      // Namespaces are not regarded as properties
      if (prefix === 'xmlns') {
        continue;
      }

      // Platform-based attributes
      if (knownPlatforms.includes(prefix.toLowerCase()) && prefix.toLowerCase() !== this.platform.toLowerCase()) {
        continue;
      }

      // This is necessary for proper string escape
      const attrValue = value.replaceAll('\'', '\\\'');

      this.body += `setPropertyValue(${ELEMENT_PREFIX}${this.treeIndex}, '${local}', '${attrValue}');`;
    }
  }

  private buildComponent(elementName: string, prefix: string, attributes) {
    this.body += `var ${ELEMENT_PREFIX}${this.treeIndex} = newInstance('${elementName}', '${prefix}');`;

    if (this.treeIndex == 0) {
      // Script
      this.body += `var moduleExports;
      var resolvedCodeModuleName = resolveModuleName('${this.moduleRelativePath}', '');
      if (!resolvedCodeModuleName && this.__fallbackModuleRelativePath) {
        resolvedCodeModuleName = resolveModuleName(this.__fallbackModuleRelativePath, '');
      }

      if (resolvedCodeModuleName) {
        try {
          moduleExports = global.loadModule(resolvedCodeModuleName, true);
        } catch(err) {
          if (Trace.isEnabled()) {
            Trace.write('Failed to load script file for module ${this.moduleRelativePath}', Trace.categories.Error);
          }
        }
      } else {
        if (Trace.isEnabled()) {
          Trace.write('Module ${this.moduleRelativePath} has no script file', Trace.categories.Debug);
        }
      }`;

      // Style
      this.body += `var resolvedCssModuleName = resolveModuleName('${this.moduleRelativePath}', 'css');
      if (resolvedCssModuleName) {
        ${ELEMENT_PREFIX}${this.treeIndex}.addCssFile(resolvedCssModuleName);
      } else {
        if (Trace.isEnabled()) {
          Trace.write('Module ${this.moduleRelativePath} has no style file', Trace.categories.Debug);
        }
      }`;
    }
    this.applyComponentAttributes(attributes);
  }

  private checkForNamespaces(attributes) {
    const attributeData: any[] = Object.values(attributes);

    /**
     * There are 3 component scenarios
     * 1. XML
     * 2. XML + Script with event logic
     * 3. Script
     * In order to load the right file in case 2, we always check for XML first
     * If no XML is found, proceed to loading script file
     */
    for (const { local, prefix, value } of attributeData) {
      if (local && prefix === 'xmlns') {
        this.body += `loadCustomModule('${local}', '${value}');`;
      }
    }
  }

  private generateHelperFunctions() {
    // Declare functions here until core package has support for them
    this.body += `function newInstance(elementName, prefix) {
      var componentModule;
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

      var instance = new componentModule();
      delete componentModule.prototype.__fallbackModuleRelativePath;
      return instance;
    }

    function loadCustomModule(prefix, uri) {
      var componentModule;
      var resolvedModuleName = resolveModuleName(uri, 'xml');
      try {
        componentModule = resolvedModuleName ? global.loadModule(resolvedModuleName, true) : null;
      } catch(err) {
        if (Trace.isEnabled()) {
          Trace.write('Module ' + uri + ' is not an xml file', Trace.categories.Debug);
        }
      }

      resolvedModuleName = resolveModuleName(uri, '');
      if (componentModule == null) {
        componentModule = resolvedModuleName ? global.loadModule(resolvedModuleName, true) : null;
      }

      if (componentModule != null) {
        customModules[prefix] = componentModule.default ?? componentModule;
      }
    }

    function isBinding(value) {
      var isBinding;

      if (typeof value === 'string') {
        const str = value.trim();
        isBinding = str.indexOf('{{') === 0 && str.lastIndexOf('}}') === str.length - 2;
      }

      return isBinding;
    }

    function getBindingExpressionFromAttribute(value) {
      return value.replace('{{', '').replace('}}', '').trim();
    }

    function isKnownFunction(name, instance) {
      return instance.constructor && '${KNOWN_FUNCTIONS}' in instance.constructor && instance.constructor['${KNOWN_FUNCTIONS}'].indexOf(name) !== -1;
    }

    function setPropertyValue(instance, propertyName, propertyValue) {
      if (propertyName.indexOf('.') !== -1) {
        let subObj = instance;
        const properties = propertyName.split('.');
        const subPropName = properties[properties.length - 1];

        for (let i = 0, length = properties.length - 1; i < length; i++) {
          if (subObj != null) {
            subObj = subObj[properties[i]];
          }
        }

        if (subObj == null) {
          return;
        }

        instance = subObj;
      }

      if (isBinding(propertyValue) && instance.bind) {
        let bindOptions = getBindingOptions(propertyName, getBindingExpressionFromAttribute(propertyValue));
        instance.bind({
          sourceProperty: bindOptions[bindingConstants.sourceProperty],
          targetProperty: bindOptions[bindingConstants.targetProperty],
          expression: bindOptions[bindingConstants.expression],
          twoWay: bindOptions[bindingConstants.twoWay],
        },
        bindOptions[bindingConstants.source]
        );
      } else {
        let handler = moduleExports && moduleExports[propertyValue];
        if (isEventOrGesture(propertyName, instance)) {
          typeof handler === 'function' && instance.on(propertyName, handler);
        } else if (isKnownFunction(propertyName, instance) && typeof handler === 'function') {
          instance[propertyName] = handler;
        } else {
          instance[propertyName] = propertyValue;
        }
      }
    }`;
  }

  private addToComplexProperty(parentIndex, complexProperty: ComplexProperty) {
    // If property name is known collection we populate array with elements
    if (knownCollections.includes(complexProperty.name)) {
      complexProperty.elementReferences.push(`${ELEMENT_PREFIX}${this.treeIndex}`);
    } else if (complexProperty.name.endsWith(KNOWN_TEMPLATE_SUFFIX) || complexProperty.name.endsWith(KNOWN_MULTI_TEMPLATE_SUFFIX)) {
      // Do nothing
    } else {
      // Add child parent else simply assign it as a value
      this.body += `if (${ELEMENT_PREFIX}${parentIndex}._addChildFromBuilder) {
        ${ELEMENT_PREFIX}${parentIndex}._addChildFromBuilder('${complexProperty.name}', ${ELEMENT_PREFIX}${this.treeIndex});
      } else {
        ${ELEMENT_PREFIX}${parentIndex}['${complexProperty.name}'] = ${ELEMENT_PREFIX}${this.treeIndex};
      }`;
    }
  }

  private getComplexPropertyName(fullName: string): string {
    let name: string;

    if (isString(fullName)) {
      const names = fullName.split('.');
      name = names[names.length - 1];
    }

    return name;
  }

  private isComplexProperty(name: string): boolean {
    return isString(name) && name.indexOf('.') !== -1;
  }
}