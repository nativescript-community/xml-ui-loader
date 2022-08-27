import { pascalCase } from 'change-case';
import { parse } from 'path';
import { getBindingExpressionFromAttribute, isBinding } from './helpers/binding';
import { isString } from './helpers/types';

const ELEMENT_PREFIX = 'el';
const MULTI_TEMPLATE_TAG = 'template';
const MULTI_TEMPLATE_KEY_ATTRIBUTE = 'key';

// For example, ListView.itemTemplateSelector
const KNOWN_FUNCTIONS = 'knownFunctions';
const knownTemplates: string[] = ['itemTemplate'];
const knownMultiTemplates: string[] = ['itemTemplates'];
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

    this.body += `export default class ${componentName} extends `;

    this.platform = platform;
  }

  public handleOpenTag(elementName, attributes) {
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
          const attrValue = attributes[MULTI_TEMPLATE_KEY_ATTRIBUTE].value.replaceAll("'", "\\'");
          this.body += `{ key: '${attrValue}', createView: () {`;
        } else {
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
      
      if (knownTemplates.includes(complexProperty.name)) {
        this.body += `${ELEMENT_PREFIX}${parentIndex}.${complexProperty.name} = () => {`;
      } else if (knownMultiTemplates.includes(complexProperty.name)) {
        this.body += `${ELEMENT_PREFIX}${parentIndex}.${complexProperty.name} = [`;
      }
    } else {
      const complexProperty = this.complexProperties[this.complexProperties.length - 1];
      this.buildComponent(elementName, attributes);

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

  public handleCloseTag(elementName) {
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
        this.body += this.treeIndex > complexProperty.templateViewIndex ? `return ${ELEMENT_PREFIX}${complexProperty.templateViewIndex}; },` : `return null; },`;
        complexProperty.templateViewIndex = this.treeIndex;
      }
    } else if (this.isComplexProperty(elementName)) {
      if (complexProperty) {
        if (knownTemplates.includes(complexProperty.name)) {
          this.body += this.treeIndex > complexProperty.templateViewIndex ? `return ${ELEMENT_PREFIX}${complexProperty.templateViewIndex}; };` : `return null; };`;
        } else if (knownMultiTemplates.includes(complexProperty.name)) {
          this.body += `];`;
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
    this.body += '}}';
  }

  public getOutput(): string {
    return this.head + this.body;
  }

  private appendImports() {
    this.head += `var { Trace } = require('@nativescript/core/trace');`;
    this.head += `var uiModules = require('@nativescript/core/ui');`;
    this.head += `var { isEventOrGesture } = require('@nativescript/core/ui/core/bindable');`;
    this.head += `var { getBindingOptions, bindingConstants } = require('@nativescript/core/ui/builder/binding-builder');`;
  }

  private buildComponent(elementName: string, attributes) {
    if (this.treeIndex == 0) {
      this.body += `uiModules.${elementName} { constructor() { super();`;
      this.body += `var moduleExports; try { moduleExports = global.loadModule('${this.moduleRelativePath}', true); }`;
      this.body += `catch(err) { if (Trace.isEnabled()) { Trace.write('Module ${this.moduleRelativePath} has no script file', Trace.categories.Debug); }}`;
      this.body += `var ${ELEMENT_PREFIX}${this.treeIndex} = this;`;
    } else {
      this.body += `var ${ELEMENT_PREFIX}${this.treeIndex} = new uiModules.${elementName}();`;
    }

    this.applyComponentAttributes(attributes);
  }

  private applyComponentAttributes(attributes) {
    for (let attr in attributes) {
      const attributeInstance = attributes[attr];
      if (attributeInstance) {
        const attrValue = attributeInstance.value.replaceAll("'", "\\'");

        if (attr.indexOf(':') !== -1) {
          const platformName = attr.split(':')[0].trim();

          if (platformName.toLowerCase() === this.platform.toLowerCase()) {
            attr = attr.split(':')[1].trim();
          } else {
            continue;
          }
        }

        this.setPropertyValue(attr, attrValue);
      }
    }
  }

  private setPropertyValue(propertyName: string, propertyValue: any) {
    // Use dot notation as it's a good way to support sub-properties
    if (isBinding(propertyValue)) {
      const expression = getBindingExpressionFromAttribute(propertyValue);

      this.body += `var ${propertyName}BindOptions = getBindingOptions('${propertyName}', '${expression}');`
      this.body += `if (${ELEMENT_PREFIX}${this.treeIndex}.bind) {`;
      this.body += `instance.bind({sourceProperty: ${propertyName}BindOptions[bindingConstants.sourceProperty], targetProperty: ${propertyName}BindOptions[bindingConstants.targetProperty],`;
      this.body += `expression: ${propertyName}BindOptions[bindingConstants.expression], twoWay: ${propertyName}BindOptions[bindingConstants.twoWay]}, ${propertyName}BindOptions[bindingConstants.source]); }`;
      this.body += `else { ${ELEMENT_PREFIX}${this.treeIndex}.${propertyName} = '${propertyValue}'; }`;
    } else {
      // Get the event handler from page module exports
      this.body += `var ${propertyName}Handler = moduleExports && moduleExports['${propertyValue}'];`;
      this.body += `if (isEventOrGesture('${propertyName}', ${ELEMENT_PREFIX}${this.treeIndex})) {`;
      
      // Check if the handler is function and add it to the instance for specified event name
      this.body += `typeof ${propertyName}Handler === 'function' && ${ELEMENT_PREFIX}${this.treeIndex}.on('${propertyName}', ${propertyName}Handler); }`;

      // isKnownFunction()
      this.body += `else if (${ELEMENT_PREFIX}${this.treeIndex}?.constructor?.${KNOWN_FUNCTIONS} `;
      this.body += `&& ${ELEMENT_PREFIX}${this.treeIndex}.constructor.${KNOWN_FUNCTIONS}.indexOf('${propertyName}') !== -1 && typeof ${propertyName}Handler === 'function') {`;

      this.body += `${ELEMENT_PREFIX}${this.treeIndex}.${propertyName} = ${propertyName}Handler; }`;
      this.body += `else { ${ELEMENT_PREFIX}${this.treeIndex}.${propertyName} = '${propertyValue}'; }`;
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

  private addToComplexProperty(parentIndex, complexProperty: ComplexProperty) {
    // If property name is known collection we populate array with elements
    if (knownCollections.includes(complexProperty.name)) {
      complexProperty.elementReferences.push(`${ELEMENT_PREFIX}${this.treeIndex}`);
    } else if (knownTemplates.includes(complexProperty.name) || knownMultiTemplates.includes(complexProperty.name)) {
      // Do nothing
    } else {
      this.body += `if (${ELEMENT_PREFIX}${parentIndex}._addChildFromBuilder) {`;
      this.body += `${ELEMENT_PREFIX}${parentIndex}._addChildFromBuilder('${complexProperty.name}', ${ELEMENT_PREFIX}${this.treeIndex}); }`;
      // Or simply assign the value
      this.body += `else { ${ELEMENT_PREFIX}${parentIndex}['${complexProperty.name}'] = ${ELEMENT_PREFIX}${this.treeIndex}; }`;
    }
  }
}