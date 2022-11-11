import { pascalCase } from 'change-case';
import { join, parse } from 'path';

const ELEMENT_PREFIX = 'el';
const CODE_FILE = 'codeFile';
const CSS_FILE = 'cssFile';
const MULTI_TEMPLATE_TAG = 'template';
const MULTI_TEMPLATE_KEY_ATTRIBUTE = 'key';
const KNOWN_TEMPLATE_SUFFIX = 'Template';
const KNOWN_MULTI_TEMPLATE_SUFFIX = 'Templates';
const KNOWN_PLATFORMS: string[] = ['android', 'ios', 'desktop'];
const KNOWN_VIEW_COLLECTIONS: string[] = ['items', 'spans', 'actionItems'];

enum ElementType {
  VIEW,
  COMMON_PROPERTY,
  TEMPLATE,
  TEMPLATE_ARRAY
}

// Use hasOpenChildTag to check if parent tag is closing
interface TagInfo {
  index: number;
  tagName: string;
  propertyName?: string;
  attributes: any;
  type: ElementType;
  childIndices: Array<number>;
  keys: Array<string>;
  hasOpenChildTag: boolean;
}

export class ComponentParser {
  private openTags = new Array<TagInfo>();
  private resolvedRequests = new Array<string>();

  // Keep counter for the case of platform tags being inside platform tags
  private unsupportedPlatformTagCount: number = 0;

  private moduleDirPath: string = '';
  private moduleRelativePath: string = '';
  private head: string = '';
  private body: string = '';
  private platform: string;
  private treeIndex: number = -1;

  constructor(moduleRelativePath: string, platform: string) {
    const { dir, ext, name } = parse(moduleRelativePath);
    const componentName = pascalCase(name);

    this.moduleDirPath = dir;
    this.moduleRelativePath = moduleRelativePath.substring(0, moduleRelativePath.length - ext.length);

    this.appendImports();

    this.body += `export default class ${componentName} {
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
    
    const openTagInfo: TagInfo = this.openTags[this.openTags.length - 1];

    // Handle view property nesting
    const isViewProperty: boolean = this.isViewProperty(tagName);
    if (isViewProperty && openTagInfo?.type !== ElementType.VIEW) {
      throw new Error(`Property '${tagName}' can only be nested inside a view tag. Parent tag: ${openTagInfo != null ? openTagInfo.tagName : 'None'}`);
    }

    if (openTagInfo != null) {
      switch (openTagInfo.type) {
        case ElementType.TEMPLATE:
          if (openTagInfo.childIndices.length) {
            throw new Error(`Property '${openTagInfo.tagName}' does not accept more than a single child`);
          }
          break;
        case ElementType.TEMPLATE_ARRAY:
          if (tagName !== MULTI_TEMPLATE_TAG) {
            throw new Error(`Property '${openTagInfo.tagName}' must be an array of templates`);
          }
          break;
        default:
          if (tagName === MULTI_TEMPLATE_TAG) {
            const fullTagName = openTagInfo.propertyName != null ? `${openTagInfo.tagName}.${openTagInfo.propertyName}` : openTagInfo.tagName;
            throw new Error(`Template tags can only be nested inside template properties. Parent tag: ${fullTagName}`);
          }
          break;
      }

      openTagInfo.hasOpenChildTag = true;
    }

    let newTagInfo: TagInfo = {
      index: -1,
      tagName,
      attributes,
      type: null,
      childIndices: [],
      keys: [],
      hasOpenChildTag: false
    };

    if (isViewProperty) {
      const [ parentTagName, tagPropertyName ] = tagName.split('.');

      if (openTagInfo != null && openTagInfo.tagName === parentTagName) {
        newTagInfo.index = openTagInfo.index;
        newTagInfo.tagName = parentTagName;
        newTagInfo.propertyName = tagPropertyName;

        if (tagPropertyName.endsWith(KNOWN_TEMPLATE_SUFFIX)) {
          newTagInfo.type = ElementType.TEMPLATE;
          this.body += `var ${newTagInfo.propertyName}${openTagInfo.index} = () => {`;
        } else if (tagPropertyName.endsWith(KNOWN_MULTI_TEMPLATE_SUFFIX)) {
          newTagInfo.type = ElementType.TEMPLATE_ARRAY;
        } else {
          newTagInfo.type = ElementType.COMMON_PROPERTY;
        }
      } else {
        throw new Error(`Property '${tagName}' is not suitable for parent '${openTagInfo.tagName}'`);
      }
    } else if (tagName === MULTI_TEMPLATE_TAG) {
      if (openTagInfo != null) {
        if (openTagInfo.type === ElementType.TEMPLATE_ARRAY) {
          newTagInfo.index = openTagInfo.index;
          newTagInfo.type = ElementType.TEMPLATE;

          const templateIndex = openTagInfo.childIndices.length;
          // This is necessary for proper string escape
          const attrValue = MULTI_TEMPLATE_KEY_ATTRIBUTE in attributes ? attributes[MULTI_TEMPLATE_KEY_ATTRIBUTE].replaceAll('\'', '\\\'') : '';

          this.body += `var ${openTagInfo.propertyName}${openTagInfo.index}_${templateIndex} = () => {`;
          openTagInfo.keys.push(attrValue);
          openTagInfo.childIndices.push(templateIndex);
        } else {
          // Ignore tag if it's nested inside a single-template property
          newTagInfo = null;
        }
      } else {
        throw new Error('Failed to parse template. No parent found');
      }
    } else {
      const [ elementName, prefix ] = this.getLocalAndPrefixByName(tagName);

      this.treeIndex++;
      
      this.buildComponent(elementName, prefix, attributes);

      newTagInfo.index = this.treeIndex;
      newTagInfo.type = ElementType.VIEW;

      openTagInfo != null && openTagInfo.childIndices.push(this.treeIndex);
    }

    newTagInfo != null && this.openTags.push(newTagInfo);
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

    let openTagInfo: TagInfo = this.openTags[this.openTags.length - 1];
    if (openTagInfo != null) {
      // Current tag is a closing tag
      if (this.isClosingTag(tagName, openTagInfo)) {
        if (openTagInfo.propertyName != null) {
          switch (openTagInfo.type) {
            case ElementType.COMMON_PROPERTY: {
              if (openTagInfo.childIndices.length) {
                if (KNOWN_VIEW_COLLECTIONS.includes(openTagInfo.propertyName)) {
                  const viewReferences = openTagInfo.childIndices.map(treeIndex => `${ELEMENT_PREFIX}${treeIndex}`);
                  this.body += `if (${ELEMENT_PREFIX}${openTagInfo.index}._addArrayFromBuilder) {
                    ${ELEMENT_PREFIX}${openTagInfo.index}._addArrayFromBuilder('${openTagInfo.propertyName}', [${viewReferences.join(', ')}]);
                  } else if (${ELEMENT_PREFIX}${openTagInfo.index}._addChildFromBuilder) {`;

                  for (const viewRef of viewReferences) {
                    this.body += `${ELEMENT_PREFIX}${openTagInfo.index}._addChildFromBuilder(${viewRef}.constructor.name, ${viewRef});`;
                  }

                  this.body += `} else {
                    throw new Error('Component ${tagName} has no support for nesting views');
                  }`;
                } else {
                  const childIndex = openTagInfo.childIndices[openTagInfo.childIndices.length - 1];
                  this.body += `${ELEMENT_PREFIX}${openTagInfo.index}.${openTagInfo.propertyName} = ${childIndex != null ? ELEMENT_PREFIX + childIndex : 'null'};`;
                }
              }
              break;
            }
            case ElementType.TEMPLATE: {
              const childIndex = openTagInfo.childIndices[openTagInfo.childIndices.length - 1];
              this.body += `return ${childIndex != null ? ELEMENT_PREFIX + childIndex : 'null'}; };`;
              this.body += `${ELEMENT_PREFIX}${openTagInfo.index}.${openTagInfo.propertyName} = ${openTagInfo.propertyName}${openTagInfo.index};`;
              break;
            }
            case ElementType.TEMPLATE_ARRAY: {
              const keyedTemplates = openTagInfo.childIndices.map((templateIndex: number, index: number) => `{
                ${MULTI_TEMPLATE_KEY_ATTRIBUTE}: '${openTagInfo.keys[index]}',
                createView: ${openTagInfo.propertyName}${openTagInfo.index}_${templateIndex}
              }`);
              this.body += `${ELEMENT_PREFIX}${openTagInfo.index}.${openTagInfo.propertyName} = [${keyedTemplates.join(', ')}];`;
              break;
            }
            default:
              throw new Error(`Invalid closing property tag '${openTagInfo.tagName}'`);
          }
        } else if (tagName === MULTI_TEMPLATE_TAG) {
          const childIndex = openTagInfo.childIndices[openTagInfo.childIndices.length - 1];
          this.body += `return ${childIndex != null ? ELEMENT_PREFIX + childIndex : 'null'}; };`;
        } else {
          if (openTagInfo.childIndices.length) {
            this.body += `if (${ELEMENT_PREFIX}${openTagInfo.index}._addChildFromBuilder) {`;
            for (const childIndex of openTagInfo.childIndices) {
              this.body += `${ELEMENT_PREFIX}${openTagInfo.index}._addChildFromBuilder(${ELEMENT_PREFIX}${childIndex}.constructor.name, ${ELEMENT_PREFIX}${childIndex});`;
            }
            this.body += '}';
          }
        }

        // Remove tag from the openTags collection
        this.openTags.pop();
        openTagInfo = this.openTags[this.openTags.length - 1];
      }

      // Update open child tag flag for current open tag
      if (openTagInfo != null) {
        openTagInfo.hasOpenChildTag = false;
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

  private isClosingTag(closingTagName: string, openTagInfo: TagInfo): boolean {
    const fullTagName = openTagInfo.propertyName != null ? `${openTagInfo.tagName}.${openTagInfo.propertyName}` : openTagInfo.tagName;
    return fullTagName === closingTagName && !openTagInfo.hasOpenChildTag;
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
    }

    this.body += `var ${ELEMENT_PREFIX}${this.treeIndex} = global.xmlCompiler.newInstance({elementName: '${elementName}', prefix: '${prefix}', moduleExports, uiCoreModules, customModules});`;
    if (this.treeIndex == 0) {
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

  private isViewProperty(tagName: string): boolean {
    return tagName.indexOf('.') !== -1;
  }
}