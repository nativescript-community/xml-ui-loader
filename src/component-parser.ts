import { pascalCase } from 'change-case';
import { join, parse } from 'path';

const ELEMENT_PREFIX = 'el';
const CODE_FILE = 'codeFile';
const CSS_FILE = 'cssFile';
const MULTI_TEMPLATE_TAG = 'template';
const MULTI_TEMPLATE_KEY_ATTRIBUTE = 'key';

const KNOWN_TEMPLATE_SUFFIX = 'Template';
const KNOWN_MULTI_TEMPLATE_SUFFIX = 'Templates';
const KNOWN_COLLECTIONS: string[] = ['items', 'spans', 'actionItems'];
const KNOWN_PLATFORMS: string[] = ['android', 'ios', 'desktop'];

interface ComplexProperty {
  parentIndex: number;
  name: string;
  elementReferences?: Array<string>;
  templateViewIndex?: number;
}

// Use hasOpenChildTag to check if parent tag is closing
interface ParentInfo {
  index: number;
  tagName: string;
  hasOpenChildTag: boolean;
  children: Array<ElementInfo>;
}

interface ElementInfo {
  index: number;
  elementName: string;
  prefix: string;
}

export class ComponentParser {
  private parents = new Array<ParentInfo>();
  private complexProperties = new Array<ComplexProperty>();
  private resolvedRequests = new Array<string>();

  // Keep counter for the case of platform tags being inside platform tags
  private unsupportedPlatformTagCount: number = 0;

  private className: string;
  private moduleDirPath: string = '';
  private moduleRelativePath: string = '';
  private head: string = '';
  private body: string = '';
  private platform: string;
  private treeIndex: number = 0;

  constructor(moduleRelativePath: string, platform: string) {
    const { dir, ext, name } = parse(moduleRelativePath);

    this.className = pascalCase(name);
    this.moduleDirPath = dir;
    this.moduleRelativePath = moduleRelativePath.substring(0, moduleRelativePath.length - ext.length);

    this.appendImports();

    this.body += `export default class ${this.className} {
      constructor() {
        var moduleExports;`;

    this.platform = platform;
  }

  public handleOpenTag(tagName: string, attributes) {
    // Platform tags
    if (KNOWN_PLATFORMS.includes(tagName)) {
      if (tagName.toLowerCase() !== this.platform) {
        this.unsupportedPlatformTagCount++;
      }
      return;
    }
    if (this.unsupportedPlatformTagCount > 0) {
      return;
    }

    const parent: ParentInfo = this.parents[this.parents.length - 1];

    if (tagName === MULTI_TEMPLATE_TAG) {
      if (parent != null) {
        const complexProperty = this.complexProperties[this.complexProperties.length - 1];
        if (complexProperty && complexProperty.parentIndex == parent.index) {
          if (MULTI_TEMPLATE_KEY_ATTRIBUTE in attributes) {
            // This is necessary for proper string escape
            const attrValue = attributes[MULTI_TEMPLATE_KEY_ATTRIBUTE].replaceAll('\'', '\\\'');
            this.body += `{ key: '${attrValue}', createView: () => {`;
          } else {
            throw new Error(`Found template without key inside '${parent.tagName}.${complexProperty.name}'`);
          }
        }
      } else {
        throw new Error(`No parent found for keyed '${tagName}'`);
      }
    } else if (this.isComplexProperty(tagName)) {
      if (parent != null) {
        const [ parentTagName, propertyName ] = tagName.split('.');
        if (parent.tagName == parentTagName) {
          const complexProperty: ComplexProperty = {
            parentIndex: parent.index,
            name: propertyName,
            elementReferences: [],
            templateViewIndex: this.treeIndex
          };

          this.complexProperties.push(complexProperty);

          this.body += `/* ${tagName} - start */`;
          
          if (complexProperty.name.endsWith(KNOWN_TEMPLATE_SUFFIX)) {
            this.body += `${ELEMENT_PREFIX}${parent.index}.${complexProperty.name} = () => {`;
          } else if (complexProperty.name.endsWith(KNOWN_MULTI_TEMPLATE_SUFFIX)) {
            this.body += `${ELEMENT_PREFIX}${parent.index}.${complexProperty.name} = [`;
          }
        } else {
          throw new Error(`Property '${tagName}' is not suitable for parent '${parent.tagName}'`);
        }
      } else {
        throw new Error(`No parent found for complex property '${tagName}'`);
      }
    } else {
      const [ elementName, prefix ] = this.getLocalAndPrefixByName(tagName);

      this.buildComponent(elementName, prefix, attributes);

      if (parent != null) {
        parent.hasOpenChildTag = true;

        const complexProperty = this.complexProperties[this.complexProperties.length - 1];
        if (complexProperty && complexProperty.parentIndex == parent.index) {
          // If property name is a known collection, we populate array with elements
          if (KNOWN_COLLECTIONS.includes(complexProperty.name)) {
            complexProperty.elementReferences.push(`${ELEMENT_PREFIX}${this.treeIndex}`);
          }
        } else {
          parent.children.push({
            index: this.treeIndex,
            elementName,
            prefix
          });
        }
      }

      this.parents.push({
        index: this.treeIndex,
        tagName,
        hasOpenChildTag: false,
        children: []
      });
      this.treeIndex++;
    }
  }

  public handleCloseTag(tagName: string) {
    // Platform tags
    if (KNOWN_PLATFORMS.includes(tagName)) {
      if (tagName.toLowerCase() !== this.platform) {
        this.unsupportedPlatformTagCount--;
      }
      return;
    }
    if (this.unsupportedPlatformTagCount > 0) {
      return;
    }

    let parent: ParentInfo = this.parents[this.parents.length - 1];
    if (parent != null) {
      const complexProperty = this.complexProperties[this.complexProperties.length - 1];

      if (tagName === MULTI_TEMPLATE_TAG) {
        if (complexProperty && complexProperty.parentIndex == parent.index) {
          this.body += this.treeIndex > complexProperty.templateViewIndex ? `return ${ELEMENT_PREFIX}${complexProperty.templateViewIndex}; }},` : 'return null; }},';
          complexProperty.templateViewIndex = this.treeIndex;
        }
      } else if (this.isComplexProperty(tagName)) {
        if (complexProperty) {
          this.addToComplexProperty(parent, complexProperty);

          this.body += `/* ${tagName} - end */`;
          // Remove the last complexProperty from the complexProperties collection (move to the previous complexProperty scope)
          this.complexProperties.pop();
        }
      } else {
        // This tag is the parent so we proceed to handling its closing
        if (this.isClosingParent(tagName, parent)) {
          const element = parent;
          if (element.children.length) {
            this.body += `if (${ELEMENT_PREFIX}${element.index}._addChildFromBuilder) {`;
            for (const child of element.children) {
              this.body += `${ELEMENT_PREFIX}${element.index}._addChildFromBuilder('${child.elementName}', ${ELEMENT_PREFIX}${child.index});`;
            }
            this.body += '}';
          }

          // Remove node from the parents collection (move to the previous parent scope)
          this.parents.pop();
          parent = this.parents[this.parents.length - 1];
        }

        // If another parent exists, update open child tag flag
        if (parent != null) {
          parent.hasOpenChildTag = false;
        }
      }
    }
  }

  public getResolvedRequests(): string[] {
    return this.resolvedRequests;
  }

  public finish() {
    this.body += `return ${ELEMENT_PREFIX}0;
      }
    }`;
  }

  public getOutput(): string {
    return this.head + this.body;
  }

  private isClosingParent(tagName, parent: ParentInfo): boolean {
    return parent.tagName === tagName && !parent.hasOpenChildTag;
  }

  private appendImports() {
    this.head += `var { resolveModuleName } = require('@nativescript/core/module-name-resolver');
    var uiCoreModules = require('@nativescript/core/ui');
    var { setPropertyValue } = require('@nativescript/core/ui/builder/component-builder');
    var customModules = {};
    `;
  }

  private getPropertyCode(propertyName, propertyValue) {
    let instanceReference = `${ELEMENT_PREFIX}${this.treeIndex}`;
    // This is necessary for proper string escape
    const attrValue = propertyValue.replaceAll('\'', '\\\'');

    if (propertyName.indexOf('.') !== -1) {
      const properties = propertyName.split('.');

      for (let i = 0, length = properties.length - 1; i < length; i++) {
        instanceReference += `?.${properties[i]}`;
      }
      propertyName = properties[properties.length - 1];
    }

    return `${instanceReference} && setPropertyValue(${instanceReference}, null, moduleExports, '${propertyName}', '${attrValue}');`;
  }

  private buildComponent(elementName: string, prefix: string, attributes) {
    let propertyContent: string = '';

    // Ignore this one
    if ('xmlns' in attributes) {
      delete attributes['xmlns'];
    }

    const entries = Object.entries(attributes) as any;
    for (const [name, value] of entries) {
      const [ propertyName, prefix ] = this.getLocalAndPrefixByName(name);
      if (prefix === 'xmlns') {
        this.registerNamespace(propertyName, value);
        continue;
      }

      // Platform-based attributes
      if (KNOWN_PLATFORMS.includes(prefix.toLowerCase()) && prefix.toLowerCase() !== this.platform.toLowerCase()) {
        continue;
      }

      propertyContent += this.getPropertyCode(propertyName, value);
    }

    this.body += `var ${ELEMENT_PREFIX}${this.treeIndex} = global.xmlCompiler.newInstance({elementName: '${elementName}', prefix: '${prefix}', moduleExports, uiCoreModules, customModules});`;

    if (this.treeIndex == 0) {
      // Script (variable moduleExports is defined at the beginning of constructor)
      if (CODE_FILE in attributes) {
        const attrValue = attributes[CODE_FILE];
        this.resolvedRequests.push(attrValue);

        const resolvedPath = this.getResolvedPath(attrValue);
        this.body += `var resolvedCodeModuleName = resolveModuleName('${resolvedPath}', '');`;
        this.body += 'moduleExports = resolvedCodeModuleName ? global.loadModule(resolvedCodeModuleName, true) : null;';
      } else {
        this.body += `var resolvedCodeModuleName = resolveModuleName('${this.moduleRelativePath}', '');
        moduleExports = resolvedCodeModuleName ? global.loadModule(resolvedCodeModuleName, true) : this.__fallbackModuleExports;`;
      }

      // Style
      if (CSS_FILE in attributes) {
        const attrValue = attributes[CSS_FILE];
        this.resolvedRequests.push(attrValue);

        const resolvedPath = this.getResolvedPath(attrValue);
        this.body += `var resolvedCssModuleName = resolveModuleName('${resolvedPath}', 'css');`;
      } else {
        this.body += `var resolvedCssModuleName = resolveModuleName('${this.moduleRelativePath}', 'css');`;
      }
      this.body += `resolvedCssModuleName && ${ELEMENT_PREFIX}${this.treeIndex}.addCssFile(resolvedCssModuleName);`;
    }

    // Apply properties to instance
    this.body += propertyContent;
  }

  private registerNamespace(propertyName, propertyValue) {
    /**
     * By default, virtual-entry-javascript registers all application js, xml, and css files as modules.
     * Registering namespaces will ensure node modules are also included in module register.
     * However, we have to ensure that the resolved path of files is used as module key so that module-name-resolver works properly.
     */
    this.resolvedRequests.push(propertyValue);
    const resolvedPath = this.getResolvedPath(propertyValue);
    const ext = resolvedPath.endsWith('.xml') ? 'xml' : '';

    // Register module using resolve path as key and overwrite old registration if any
    this.head += `global.registerModule('${resolvedPath}', () => require('${propertyValue}'));`;
    this.body += `global.xmlCompiler.loadCustomModule('${propertyName}', '${resolvedPath}', '${ext}', customModules);`;
  }

  private getLocalAndPrefixByName(name: string): string[] {
    const splitName = name.split(':');

    let prefix;
    let local;
    if (splitName.length > 1) {
      prefix = splitName[0];
      local = splitName[1];
    } else {
      prefix = '';
      local = splitName[0];
    }

    return [
      local,
      prefix
    ];
  }

  private getResolvedPath(uri: string): string {
    return uri.startsWith('~/') ? uri.substring(2) : join(this.moduleDirPath, uri);
  }

  private addToComplexProperty(parent: ParentInfo, complexProperty: ComplexProperty) {
    if (complexProperty.name.endsWith(KNOWN_TEMPLATE_SUFFIX)) {
      this.body += this.treeIndex > complexProperty.templateViewIndex ? `return ${ELEMENT_PREFIX}${complexProperty.templateViewIndex}; };` : 'return null; };';
    } else if (complexProperty.name.endsWith(KNOWN_MULTI_TEMPLATE_SUFFIX)) {
      this.body += '];';
    } else if (KNOWN_COLLECTIONS.includes(complexProperty.name)) {
      // If parent implements _addArrayFromBuilder, call the method to populate the array property
      if (complexProperty.elementReferences.length) {
        this.body += `${ELEMENT_PREFIX}${parent.index}._addArrayFromBuilder && ${ELEMENT_PREFIX}${parent.index}._addArrayFromBuilder('${complexProperty.name}', [${complexProperty.elementReferences.join(', ')}]);`;
        complexProperty.elementReferences = [];
      }
    } else {
      // Add child to parent else simply assign it as a value
      this.body += `if (${ELEMENT_PREFIX}${parent.index}._addChildFromBuilder) {
        ${ELEMENT_PREFIX}${parent.index}._addChildFromBuilder('${complexProperty.name}', ${ELEMENT_PREFIX}${this.treeIndex});
      } else {
        ${ELEMENT_PREFIX}${parent.index}['${complexProperty.name}'] = ${ELEMENT_PREFIX}${this.treeIndex};
      }`;
    }
  }

  private isComplexProperty(name: string): boolean {
    return name.indexOf('.') !== -1;
  }
}