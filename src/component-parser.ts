import { getBindingExpressionFromAttribute, isBinding } from './helpers/binding';
import { isString } from './helpers/types';

const ELEMENT_PREFIX = 'el';

// For example, ListView.itemTemplateSelector
const KNOWN_FUNCTIONS = 'knownFunctions';
const knownTemplates: Set<string> = new Set(['itemTemplate']);
const knownMultiTemplates: Set<string> = new Set(['itemTemplates']);
const knownCollections: Set<string> = new Set(['items', 'spans', 'actionItems']);

interface ComplexProperty {
  parentIndex: number;
  name: string;
  elementReferences?: Array<string>;
  parser?: { value: any };
}

export class ComponentParser {
  private parentIndices = new Array<number>();
  private complexProperties = new Array<ComplexProperty>();

  private head: string = '';
  private body: string = '';
  private platform: string;
  private treeIndex: number = 0;

  constructor(componentName: string, platform: string) {
    this.head += `var uiModules = require('@nativescript/core/ui');`;
    this.head += `var { isEventOrGesture } = require('@nativescript/core/ui/core/bindable');`;
    this.head += `var { getBindingOptions, bindingConstants } = require('@nativescript/core/ui/builder/binding-builder');`;

    this.body += `export default class ${componentName} extends `;

    this.platform = platform;
  }

  public handleOpenTag(elementName, attributes) {
    const parentIndex = this.parentIndices[this.parentIndices.length - 1];

    if (this.isComplexProperty(elementName)) {
      const name = this.getComplexPropertyName(elementName);
      const complexProperty: ComplexProperty = {
        parentIndex,
        name: name,
        elementReferences: [],
      };

      this.complexProperties.push(complexProperty);

      // TODO: Implement template parsers
      // if (ComponentParser.isKnownTemplate(name, parent.exports)) {
      //   return new TemplateParser(this, {
      //     context: (parent ? getExports(parent.component) : null) || this.context,
      //     parent: parent,
      //     name: name,
      //     elementName: args.elementName,
      //     templateItems: [],
      //     errorFormat: this.error,
      //     sourceTracker: this.sourceTracker,
      //   });
      // }

      // if (ComponentParser.isKnownMultiTemplate(name, parent.exports)) {
      //   const parser = new MultiTemplateParser(this, {
      //     context: (parent ? getExports(parent.component) : null) || this.context,
      //     parent: parent,
      //     name: name,
      //     elementName: args.elementName,
      //     templateItems: [],
      //     errorFormat: this.error,
      //     sourceTracker: this.sourceTracker,
      //   });
      //   complexProperty.parser = parser;

      //   return parser;
      // }

      this.body += `/* ${elementName} - start */`;
    } else {
      const complexProperty = this.complexProperties[this.complexProperties.length - 1];
      this.buildComponent(elementName, attributes);

      if (parentIndex != null) {
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
    const parentIndex = this.parentIndices[this.parentIndices.length - 1];
    const complexProperty = this.complexProperties[this.complexProperties.length - 1];
    if (this.isComplexProperty(elementName)) {
      if (complexProperty) {
        if (complexProperty.parser) {
          // TODO: Implement template parsers
          //parent.component[complexProperty.name] = complexProperty.parser.value;
        } else if (parentIndex != null) {
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

  private buildComponent(elementName: string, attributes) {
    if (this.treeIndex == 0) {
      this.body += `uiModules.${elementName} { constructor() { super();`;
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
    if (isBinding(propertyValue)) {
      const expression = getBindingExpressionFromAttribute(propertyValue);

      this.body += `const bindOptions = getBindingOptions('${propertyName}', '${expression}');`
      this.body += `if (${ELEMENT_PREFIX}${this.treeIndex}.bind) {`;
      this.body += `instance.bind({sourceProperty: bindOptions[bindingConstants.sourceProperty], targetProperty: bindOptions[bindingConstants.targetProperty],`;
      this.body += `expression: bindOptions[bindingConstants.expression], twoWay: bindOptions[bindingConstants.twoWay]}, bindOptions[bindingConstants.source]); }`;
      this.body += `else { ${ELEMENT_PREFIX}${this.treeIndex}.${propertyName} = '${propertyValue}'; }`;
    } else {
      // Get the event handler from page module exports
      this.body += `const handler = moduleExports && moduleExports['${propertyValue}'];`;
      this.body += `if (isEventOrGesture('${propertyName}', ${ELEMENT_PREFIX}${this.treeIndex})) {`;
      
      // Check if the handler is function and add it to the instance for specified event name
      this.body += `typeof handler === 'function' && ${ELEMENT_PREFIX}${this.treeIndex}.on('${propertyName}', handler); }`;

      // isKnownFunction()
      this.body += `else if (${ELEMENT_PREFIX}${this.treeIndex}?.constructor?.${KNOWN_FUNCTIONS} `;
      this.body += `&& ${ELEMENT_PREFIX}${this.treeIndex}.constructor.${KNOWN_FUNCTIONS}.indexOf('${propertyName}') !== -1 && typeof handler === 'function') {`;

      this.body += `${ELEMENT_PREFIX}${this.treeIndex}.${propertyName} = handler; }`;
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
    if (knownCollections.has(complexProperty.name)) {
      complexProperty.elementReferences.push(`${ELEMENT_PREFIX}${this.treeIndex}`);
    } else {
      this.body += `if (${ELEMENT_PREFIX}${parentIndex}._addChildFromBuilder) {`;
      this.body += `${ELEMENT_PREFIX}${parentIndex}._addChildFromBuilder('${complexProperty.name}', ${ELEMENT_PREFIX}${this.treeIndex}); }`;
      // Or simply assign the value
      this.body += `else { ${ELEMENT_PREFIX}${parentIndex}['${complexProperty.name}'] = ${ELEMENT_PREFIX}${this.treeIndex}; }`;
    }
  }
}