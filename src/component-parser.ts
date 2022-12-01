import { pascalCase } from 'change-case';
import { join, parse } from 'path';
const ELEMENT_PREFIX = 'el';
const CODE_FILE = 'codeFile';
const CSS_FILE = 'cssFile';
const MULTI_TEMPLATE_KEY_ATTRIBUTE = 'key';
const KNOWN_TEMPLATE_SUFFIX = 'Template';
const KNOWN_MULTI_TEMPLATE_SUFFIX = 'Templates';
const KNOWN_PLATFORMS: string[] = ['android', 'ios', 'desktop'];

enum ElementType {
  VIEW,
  COMMON_PROPERTY,
  TEMPLATE,
  TEMPLATE_ARRAY
}

// Enums are put in specific order as they are concatenated in the end
enum ScopeType {
  CORE_IMPORTS,
  CUSTOM_IMPORTS,
  CLASS_START,
  SLOT_VIEW_TREE,
  VIEW_TREE,
  CLASS_END,
  // Used for getting enum types count
  SCOPE_COUNT
}

enum SpecialTags {
  SLOT = 'slot',
  SLOT_CONTENT = 'slotContent',
  TEMPLATE = 'template'
}

// Use hasOpenChildTag to check if parent tag is closing
interface TagInfo {
  index: number;
  tagName: string;
  propertyName?: string;
  attributes: any;
  type: ElementType;
  nestedTagCount: number;
  childIndices: Array<number>;
  templateKeys?: Array<string>;
  slotNames?: Array<string>;
  isCustomComponent: boolean;
  isParentForSlots: boolean;
  hasOpenChildTag: boolean;
}

export class ComponentParser {
  private openTags = new Array<TagInfo>();
  private resolvedRequests = new Array<string>();
  private codeScopes = new Array<string>(ScopeType.SCOPE_COUNT);
  private usedNSTags = new Set<string>();

  // Keep counter for the case of platform tags being inside platform tags
  private unsupportedPlatformTagCount: number = 0;

  private moduleDirPath: string = '';
  private moduleRelativePath: string = '';
  private platform: string;

  private currentViewScope: ScopeType;
  private treeIndex: number = -1;

  private isComponentInitialized: boolean = false;

  constructor(moduleRelativePath: string, platform: string) {
    const { dir, ext, name } = parse(moduleRelativePath);
    const componentName = pascalCase(name);

    this.moduleDirPath = dir;
    this.moduleRelativePath = moduleRelativePath.substring(0, moduleRelativePath.length - ext.length);
    this.platform = platform;
    this.currentViewScope = ScopeType.VIEW_TREE;
    this.codeScopes.fill('');

    this.initialize(componentName);
  }

  public handleOpenTag(tagName: string, attributes) {
    // Component root view and its children have already been parsed
    if (this.isComponentInitialized) {
      throw new Error(`Invalid element ${tagName}. Components can only have a single root view`);
    }

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
    const isViewProperty: boolean = this.isViewProperty(tagName);

    // Handle view property nesting
    if (isViewProperty && openTagInfo?.type !== ElementType.VIEW) {
      throw new Error(`Property '${tagName}' can only be nested inside a view tag. Parent tag: ${openTagInfo?.tagName ?? 'None'}`);
    }

    if (openTagInfo != null) {
      this.checkOpenTagNestingConditions(openTagInfo, tagName, attributes);

      openTagInfo.hasOpenChildTag = true;
      openTagInfo.nestedTagCount++;
    }

    let newTagInfo: TagInfo = {
      index: -1,
      tagName,
      attributes,
      type: null,
      nestedTagCount: 0,
      childIndices: [],
      isCustomComponent: false,
      isParentForSlots: false,
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
          this.codeScopes[this.currentViewScope] += `let ${newTagInfo.propertyName}${openTagInfo.index} = () => {`;
        } else if (tagPropertyName.endsWith(KNOWN_MULTI_TEMPLATE_SUFFIX)) {
          newTagInfo.type = ElementType.TEMPLATE_ARRAY;
          newTagInfo.templateKeys = [];
        } else {
          newTagInfo.type = ElementType.COMMON_PROPERTY;
        }
      } else {
        throw new Error(`Property '${tagName}' is not suitable for parent '${openTagInfo.tagName}'`);
      }
    } else if (tagName === SpecialTags.SLOT_CONTENT) {
      if (openTagInfo != null) {
        newTagInfo.index = openTagInfo.index;
        newTagInfo.slotNames = [];
        
        // Switch scope back to view tree once tag is closed
        this.currentViewScope = ScopeType.SLOT_VIEW_TREE;

        openTagInfo.isParentForSlots = true;
      } else {
        throw new Error(`Invalid tag '${tagName}'. Tag has no parent`);
      }
    } else if (tagName === SpecialTags.TEMPLATE) {
      if (openTagInfo != null) {
        if (openTagInfo.type === ElementType.TEMPLATE_ARRAY) {
          newTagInfo.index = openTagInfo.index;
          newTagInfo.type = ElementType.TEMPLATE;

          const templateIndex = openTagInfo.childIndices.length;
          // This is necessary for proper string escape
          const attrValue = MULTI_TEMPLATE_KEY_ATTRIBUTE in attributes ? attributes[MULTI_TEMPLATE_KEY_ATTRIBUTE] : '';

          this.codeScopes[this.currentViewScope] += `let ${openTagInfo.propertyName}${openTagInfo.index}_${templateIndex} = () => {`;
          openTagInfo.templateKeys.push(attrValue);
          openTagInfo.childIndices.push(templateIndex);
        } else {
          // Ignore tag if it's nested inside a single-template property
          newTagInfo = null;
        }
      } else {
        throw new Error('Failed to parse template. No parent found');
      }
    } else {
      const parentTagName: string = openTagInfo?.tagName;
      if (parentTagName === SpecialTags.SLOT) {
        this.codeScopes[this.currentViewScope] += '} else {';
      } else {
        this.treeIndex++;
      }

      newTagInfo.index = this.treeIndex;
      newTagInfo.type = ElementType.VIEW;

      if (openTagInfo != null) {
        if (openTagInfo.tagName === SpecialTags.SLOT_CONTENT) {
          const slotName = attributes.slot || 'default';

          if (!openTagInfo.slotNames.includes(slotName)) {
            this.codeScopes[this.currentViewScope] += `slotViews${openTagInfo.index}['${slotName}'] = [];`;
            openTagInfo.slotNames.push(slotName);
          }
        } else {
          openTagInfo.childIndices.push(this.treeIndex);
        }
      } else {
        // Resolve js and css based on first element
        this.bindCodeAndStyleModules(attributes);
      }

      if (tagName === SpecialTags.SLOT) {
        const name = attributes.name || 'default';

        this.codeScopes[this.currentViewScope] += `let ${ELEMENT_PREFIX}${this.treeIndex};
        if (this.$slotViews['${name}']) {
          ${ELEMENT_PREFIX}${this.treeIndex} = this.$slotViews['${name}'];`;
      } else {
        const [ elementName, prefix ] = this.getLocalAndPrefixByName(tagName);
        this.buildComponent(elementName, prefix, parentTagName, attributes);

        if (prefix != null) {
          newTagInfo.isCustomComponent = true;

          // Initialize slot views instance
          this.codeScopes[ScopeType.SLOT_VIEW_TREE] += `let slotViews${this.treeIndex} = {};`;
        } else {
          // Store tags that are actually nativescript core components
          this.usedNSTags.add(tagName);
        }
      }

      if (openTagInfo != null && openTagInfo.tagName === SpecialTags.SLOT_CONTENT) {
        const slotName = attributes.slot || 'default';
        this.codeScopes[this.currentViewScope] += `slotViews${openTagInfo.index}['${slotName}'].push(${ELEMENT_PREFIX}${this.treeIndex});`;
      }
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
                const viewReferences = openTagInfo.childIndices.map(treeIndex => `${ELEMENT_PREFIX}${treeIndex}`);
                this.codeScopes[this.currentViewScope] += `global.xmlCompiler.addViewsFromBuilder(${ELEMENT_PREFIX}${openTagInfo.index}, [${viewReferences.join(', ')}], '${openTagInfo.propertyName}');`;
              }
              break;
            }
            case ElementType.TEMPLATE: {
              const childIndex = openTagInfo.childIndices[openTagInfo.childIndices.length - 1];
              this.codeScopes[this.currentViewScope] += `return ${childIndex != null ? ELEMENT_PREFIX + childIndex : 'null'}; };`;
              this.codeScopes[this.currentViewScope] += `${ELEMENT_PREFIX}${openTagInfo.index}.${openTagInfo.propertyName} = ${openTagInfo.propertyName}${openTagInfo.index};`;
              break;
            }
            case ElementType.TEMPLATE_ARRAY: {
              const keyedTemplates = openTagInfo.childIndices.map((templateIndex: number, index: number) => `{
                ${MULTI_TEMPLATE_KEY_ATTRIBUTE}: '${openTagInfo.templateKeys[index]}',
                createView: ${openTagInfo.propertyName}${openTagInfo.index}_${templateIndex}
              }`);
              this.codeScopes[this.currentViewScope] += `${ELEMENT_PREFIX}${openTagInfo.index}.${openTagInfo.propertyName} = [${keyedTemplates.join(', ')}];`;
              break;
            }
            default:
              throw new Error(`Invalid closing property tag '${openTagInfo.tagName}'`);
          }
        } else if (tagName === SpecialTags.SLOT) {
          this.codeScopes[this.currentViewScope] += '}';
        } else if (tagName === SpecialTags.SLOT_CONTENT) {
          // Get out of slot view tree scope
          this.currentViewScope = ScopeType.VIEW_TREE;
        } else if (tagName === SpecialTags.TEMPLATE) {
          const childIndex = openTagInfo.childIndices[openTagInfo.childIndices.length - 1];
          this.codeScopes[this.currentViewScope] += `return ${childIndex != null ? ELEMENT_PREFIX + childIndex : 'null'}; };`;
        } else {
          if (openTagInfo.isParentForSlots && openTagInfo.nestedTagCount > 1) {
            throw new Error(`Cannot mix common views or properties with slot content inside tag '${tagName}'`);
          }

          if (openTagInfo.childIndices.length) {
            const viewReferences = openTagInfo.childIndices.map(treeIndex => `${ELEMENT_PREFIX}${treeIndex}`);
            this.codeScopes[this.currentViewScope] += `global.xmlCompiler.addViewsFromBuilder(${ELEMENT_PREFIX}${openTagInfo.index}, [${viewReferences.join(', ')}]);`;
          }
        }

        // Remove tag from the openTags collection
        this.openTags.pop();
        if (this.openTags.length) {
          openTagInfo = this.openTags[this.openTags.length - 1];
        } else {
          this.isComponentInitialized = true;
          openTagInfo = null;
        }
      }

      // Update open child tag flag for current open tag
      if (openTagInfo != null) {
        openTagInfo.hasOpenChildTag = false;
      }
    }
  }

  public getResolvedRequests(): string[] {
    if (!this.isComponentInitialized) {
      throw new Error('Cannot retrieve required module paths as component parsing has not yet been completed');
    }
    return this.resolvedRequests;
  }

  public getResult(): string {
    if (!this.isComponentInitialized) {
      throw new Error('Cannot retrieve code output as component parsing has not yet been completed');
    }

    let result: string;

    // Check if component has actual view content
    if (this.treeIndex >= 0) {
      this.appendImportsForUI();
      this.codeScopes[this.currentViewScope] += `resolvedCssModuleName && ${ELEMENT_PREFIX}0.addCssFile(resolvedCssModuleName);
      return ${ELEMENT_PREFIX}0;`;

      result = this.codeScopes.join('');
    } else {
      result = '';
    }
    return result;
  }

  private initialize(componentName: string) {
    this.codeScopes[ScopeType.CORE_IMPORTS] += `let { resolveModuleName } = require('@nativescript/core/module-name-resolver');
    let { setPropertyValue } = require('@nativescript/core/ui/builder/component-builder');
    `;

    this.codeScopes[ScopeType.CUSTOM_IMPORTS] += 'let customModules = {};';
    this.codeScopes[ScopeType.CLASS_START] += `export default class ${componentName} {
      constructor(moduleExportsFallback = null) {`;
    this.codeScopes[ScopeType.CLASS_END] += `}
    }
    ${componentName}.isXMLComponent = true;`;
  }

  private isClosingTag(closingTagName: string, openTagInfo: TagInfo): boolean {
    const fullTagName = openTagInfo.propertyName != null ? `${openTagInfo.tagName}.${openTagInfo.propertyName}` : openTagInfo.tagName;
    return fullTagName === closingTagName && !openTagInfo.hasOpenChildTag;
  }

  private checkOpenTagNestingConditions(openTagInfo: TagInfo, newTagName: string, attributes) {
    if (newTagName === SpecialTags.SLOT_CONTENT) {
      if (!openTagInfo.isCustomComponent) {
        throw new Error(`Invalid tag '${newTagName}'. Can only nest slot content inside custom component tags`);
      }

      if (openTagInfo.isParentForSlots) {
        throw new Error(`Invalid tag '${newTagName}'. View already contains a slot content tag`);
      }

      if (openTagInfo.tagName === SpecialTags.SLOT) {
        throw new Error('Cannot nest slot content inside a slot');
      }
    }

    switch (openTagInfo.type) {
      case ElementType.TEMPLATE:
        if (openTagInfo.nestedTagCount) {
          throw new Error(`Tag '${openTagInfo.tagName}' does not accept more than a single nested element`);
        }
        break;
      case ElementType.TEMPLATE_ARRAY:
        if (newTagName !== SpecialTags.TEMPLATE) {
          throw new Error(`Property '${openTagInfo.tagName}' must be an array of templates`);
        }
        break;
      default:
        if (openTagInfo.tagName === SpecialTags.SLOT) {
          if (newTagName === SpecialTags.SLOT) {
            throw new Error(`Cannot nest slot '${attributes.slot || 'default'}' inside another slot`);
          }

          if (openTagInfo.nestedTagCount) {
            throw new Error(`Tag '${openTagInfo.tagName}' does not accept more than a single nested element`);
          }
        }

        if (newTagName === SpecialTags.TEMPLATE) {
          const fullTagName = openTagInfo.propertyName != null ? `${openTagInfo.tagName}.${openTagInfo.propertyName}` : openTagInfo.tagName;
          throw new Error(`Template tags can only be nested inside template properties. Parent tag: ${fullTagName}`);
        }
        break;
    }
  }

  private appendImportsForUI() {
    if (!this.usedNSTags.size) {
      return;
    }

    const usedTagNames = Array.from(this.usedNSTags).sort();
    this.codeScopes[ScopeType.CORE_IMPORTS] += `let { ${usedTagNames.join(', ')} } = require('@nativescript/core/ui');`;
    this.usedNSTags.clear();
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

  private buildComponent(elementName: string, prefix: string, parentTagName: string, attributes) {
    let propertyContent: string = '';

    // Ignore unused attributes
    if ('xmlns' in attributes) {
      delete attributes['xmlns'];
    }

    const entries = Object.entries(attributes) as any;
    for (const [name, value] of entries) {
      if (name === 'slot') {
        continue;
      }
      
      const [ propertyName, prefix ] = this.getLocalAndPrefixByName(name);
      if (prefix != null) {
        if (prefix === 'xmlns') {
          this.registerNamespace(propertyName, value);
          continue;
        }

        // Platform-based attributes
        if (KNOWN_PLATFORMS.includes(prefix.toLowerCase()) && prefix.toLowerCase() !== this.platform.toLowerCase()) {
          continue;
        }
      }
      propertyContent += this.getPropertyCode(propertyName, value);
    }

    const letStatement = parentTagName === SpecialTags.SLOT ? '' : 'let ';
    if (prefix != null) {
      const classRef = `customModules['${prefix}'].${elementName}`;
      this.codeScopes[this.currentViewScope] += `${classRef}.prototype.$slotViews = slotViews${this.treeIndex};`;
      this.codeScopes[this.currentViewScope] += `${letStatement}${ELEMENT_PREFIX}${this.treeIndex} = ${classRef}.isXMLComponent ? new ${classRef}(moduleExports) : new ${classRef}();`;
      this.codeScopes[this.currentViewScope] += `delete ${classRef}.prototype.$slotViews;`;
    } else {
      this.codeScopes[this.currentViewScope] += `${letStatement}${ELEMENT_PREFIX}${this.treeIndex} = new ${elementName}();`;
    }

    // Apply properties to instance
    this.codeScopes[this.currentViewScope] += propertyContent;
  }

  private bindCodeAndStyleModules(attributes) {
    // Script
    if (CODE_FILE in attributes) {
      const attrValue = attributes[CODE_FILE];
      this.resolvedRequests.push(attrValue);

      const resolvedPath = this.getResolvedPath(attrValue);
      this.codeScopes[ScopeType.CLASS_START] += `let resolvedCodeModuleName = resolveModuleName('${resolvedPath}', '');`;
    } else {
      this.codeScopes[ScopeType.CLASS_START] += `let resolvedCodeModuleName = resolveModuleName('${this.moduleRelativePath}', '');`;
    }

    // Style
    if (CSS_FILE in attributes) {
      const attrValue = attributes[CSS_FILE];
      this.resolvedRequests.push(attrValue);

      const resolvedPath = this.getResolvedPath(attrValue);
      this.codeScopes[ScopeType.CLASS_START] += `let resolvedCssModuleName = resolveModuleName('${resolvedPath}', 'css');`;
    } else {
      this.codeScopes[ScopeType.CLASS_START] += `let resolvedCssModuleName = resolveModuleName('${this.moduleRelativePath}', 'css');`;
    }

    this.codeScopes[ScopeType.CLASS_START] += 'let moduleExports = resolvedCodeModuleName ? global.loadModule(resolvedCodeModuleName, true) : moduleExportsFallback;';
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
    this.codeScopes[ScopeType.CUSTOM_IMPORTS] += `global.registerModule('${resolvedPath}', () => require('${propertyValue}'));`;
    this.codeScopes[this.currentViewScope] += `customModules['${propertyName}'] = global.xmlCompiler.loadCustomModule('${resolvedPath}', '${ext}');`;
  }

  private getLocalAndPrefixByName(name: string): string[] {
    const splitName = name.split(':');

    let prefix;
    let local;
    if (splitName.length > 1) {
      prefix = splitName[0];
      local = splitName[1];
    } else {
      prefix = null;
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