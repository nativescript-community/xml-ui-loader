import * as t from '@babel/types';
import { pascalCase } from 'change-case';
import { join, parse } from 'path';
import { BindingBuilder, BindingOptions, PARENTS_REFERENCE_NAME, PARENT_REFERENCE_NAME, VALUE_REFERENCE_NAME, VIEW_MODEL_REFERENCE_NAME } from './binding-builder';
import { AttributeValueFormatter, GLOBAL_UI_REF } from '../helpers';
import { AttributeItem } from './base-builder';

const ELEMENT_PREFIX = 'el';
const EVENT_PREFIX = 'on';
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

enum SpecialTags {
  SLOT = 'slot',
  SLOT_CONTENT = 'slotContent',
  TEMPLATE = 'template'
}

interface TagAstInfo {
  body: Array<t.Expression | t.Statement>;
  /**
   * This index is useful for things like prepending slot views.
   */
  indexBeforeNewViewInstance: number;
}

interface TagInfo {
  index: number;
  tagName: string;
  propertyName?: string;
  attributes: any;
  type: ElementType;
  nestedTagCount: number;
  childIndices: Array<number>;
  astInfo: TagAstInfo;
  slotChildIndices: Array<number>;
  slotMap?: Map<string, Array<number>>;
  isCustomComponent: boolean;
  isParentForSlots: boolean;
  /**
   * Use this flag to check if parent tag is closing.
   */
  hasOpenChildTag: boolean;
}

export interface ComponentBuilderOptions {
  moduleRelativePath: string;
  platform: string;
  attributeValueFormatter: AttributeValueFormatter;
}

export class ComponentBuilder {
  private openTags = new Array<TagInfo>();
  private pathsToResolve = new Array<string>();
  private usedNSTags = new Set<string>();

  private options: ComponentBuilderOptions;
  private componentName: string;
  private moduleDirPath: string;
  private bindingBuilder: BindingBuilder;

  /**
   * Keep counter for the case of platform tags being inside platform tags.
   */
  private unsupportedPlatformTagCount: number = 0;

  private treeIndex: number = -1;

  private isComponentInitialized: boolean = false;
  private isInSlotFallbackScope: boolean = false;

  private moduleAst: t.Program;
  private astBindingCallbacksBody: Array<t.Declaration> = [];
  private astConstructorBody: Array<t.Statement> = [];
  private astCustomModulesRegister: Array<t.Statement> = [];

  constructor(options: ComponentBuilderOptions) {
    const { dir, ext, name } = parse(options.moduleRelativePath);
    const componentName = pascalCase(name);

    this.options = options;
    this.componentName = componentName;
    this.moduleDirPath = dir;
    this.bindingBuilder = new BindingBuilder();
    
    options.moduleRelativePath = options.moduleRelativePath.substring(0, options.moduleRelativePath.length - ext.length);
  }

  public handleOpenTag(tagName: string, attributes): void {
    // Component root view and its children have already been parsed
    if (this.isComponentInitialized) {
      throw new Error(`Invalid element ${tagName}. Components can only have a single root view`);
    }

    // Platform tags
    if (KNOWN_PLATFORMS.includes(tagName)) {
      if (tagName.toLowerCase() !== this.options.platform) {
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
      slotChildIndices: [],
      astInfo: {
        body: null,
        indexBeforeNewViewInstance: -1
      },
      isCustomComponent: false,
      isParentForSlots: false,
      hasOpenChildTag: false
    };

    if (isViewProperty) {
      const [parentTagName, tagPropertyName] = tagName.split('.');

      if (openTagInfo != null && openTagInfo.tagName === parentTagName) {
        newTagInfo.index = openTagInfo.index;
        newTagInfo.tagName = parentTagName;
        newTagInfo.propertyName = tagPropertyName;

        if (tagPropertyName.endsWith(KNOWN_TEMPLATE_SUFFIX)) {
          newTagInfo.type = ElementType.TEMPLATE;
          newTagInfo.astInfo.body = [];

          openTagInfo.astInfo.body.push(
            t.expressionStatement(
              t.assignmentExpression(
                '=',
                t.memberExpression(
                  t.identifier(ELEMENT_PREFIX + openTagInfo.index),
                  t.identifier(newTagInfo.propertyName)
                ),
                t.arrowFunctionExpression(
                  [],
                  t.blockStatement(<t.Statement[]>newTagInfo.astInfo.body)
                )
              )
            )
          );
        } else if (tagPropertyName.endsWith(KNOWN_MULTI_TEMPLATE_SUFFIX)) {
          newTagInfo.type = ElementType.TEMPLATE_ARRAY;
          newTagInfo.astInfo.body = [];
          
          openTagInfo.astInfo.body.push(
            t.expressionStatement(
              t.assignmentExpression(
                '=',
                t.memberExpression(
                  t.identifier(ELEMENT_PREFIX + openTagInfo.index),
                  t.identifier(newTagInfo.propertyName)
                ),
                t.arrayExpression(<t.Expression[]>newTagInfo.astInfo.body)
              )
            )
          );
        } else {
          newTagInfo.type = ElementType.COMMON_PROPERTY;
          newTagInfo.astInfo.body = openTagInfo.astInfo.body;
        }
      } else {
        throw new Error(`Property '${tagName}' is not suitable for parent '${openTagInfo.tagName}'`);
      }
    } else if (tagName === SpecialTags.SLOT_CONTENT) {
      if (openTagInfo != null) {
        newTagInfo.index = openTagInfo.index;
        newTagInfo.slotMap = new Map();
        newTagInfo.astInfo.body = [];

        openTagInfo.isParentForSlots = true;
      } else {
        throw new Error(`Invalid tag '${tagName}'. Tag has no parent`);
      }
    } else if (tagName === SpecialTags.TEMPLATE) {
      if (openTagInfo != null) {
        if (openTagInfo.type === ElementType.TEMPLATE_ARRAY) {
          const attrValue = MULTI_TEMPLATE_KEY_ATTRIBUTE in attributes ? attributes[MULTI_TEMPLATE_KEY_ATTRIBUTE] : '';

          newTagInfo.index = openTagInfo.index;
          newTagInfo.type = ElementType.TEMPLATE;
          newTagInfo.astInfo.body = [];

          openTagInfo.astInfo.body.push(
            t.objectExpression([
              t.objectProperty(
                t.identifier(MULTI_TEMPLATE_KEY_ATTRIBUTE),
                t.stringLiteral(attrValue)
              ),
              t.objectProperty(
                t.identifier('createView'),
                t.arrowFunctionExpression(
                  [],
                  t.blockStatement(<t.Statement[]>newTagInfo.astInfo.body)
                )
              )
            ])
          );
        } else {
          // Ignore tag if it's nested inside a single-template property
          newTagInfo = null;
        }
      } else {
        throw new Error('Failed to parse template. No parent found');
      }
    } else {
      const parentTagName: string = openTagInfo?.tagName;
      const isSlotFallback = parentTagName === SpecialTags.SLOT;

      !isSlotFallback && this.treeIndex++;

      let parentAstBody;
      if (openTagInfo != null) {
        parentAstBody = openTagInfo.astInfo.body;

        // We have to keep a list of child indices that are actually slots
        if (tagName === SpecialTags.SLOT) {
          openTagInfo.slotChildIndices.push(this.treeIndex);
        }

        if (openTagInfo.tagName === SpecialTags.SLOT_CONTENT) {
          const slotName = attributes.slot || 'default';

          if (!openTagInfo.slotMap.has(slotName)) {
            openTagInfo.slotMap.set(slotName, [this.treeIndex]);
          } else {
            openTagInfo.slotMap.get(slotName).push(this.treeIndex);
          }
        } else {
          openTagInfo.childIndices.push(this.treeIndex);
        }
      } else {
        parentAstBody = this.astConstructorBody;

        // Resolve js and css based on first element
        this.astConstructorBody.push(...this.generateScriptAndStyleBindingAst(attributes));
      }

      newTagInfo.index = this.treeIndex;
      newTagInfo.type = ElementType.VIEW;
      newTagInfo.astInfo = {
        body: parentAstBody,
        indexBeforeNewViewInstance: parentAstBody.length
      };

      if (tagName === SpecialTags.SLOT) {
        const name = attributes.name || 'default';
        const slotViewsIdentifier = t.memberExpression(
          t.memberExpression(
            t.thisExpression(),
            t.identifier('$slotViews')
          ),
          t.stringLiteral(name),
          true
        );

        newTagInfo.astInfo.body = [
          t.variableDeclaration(
            'let',
            [
              t.variableDeclarator(
                t.identifier('fallbackViews'),
                t.arrayExpression()
              )
            ]
          )];

        // Consume slot views if any
        parentAstBody.push(
          t.variableDeclaration(
            'let',
            [
              t.variableDeclarator(
                t.identifier(ELEMENT_PREFIX + this.treeIndex)
              )
            ]
          ),
          t.ifStatement(
            slotViewsIdentifier,
            t.blockStatement([
              t.expressionStatement(
                t.assignmentExpression(
                  '=',
                  t.identifier(ELEMENT_PREFIX + this.treeIndex),
                  slotViewsIdentifier
                )
              ),
              t.expressionStatement(
                t.unaryExpression(
                  'delete',
                  slotViewsIdentifier,
                  true
                )
              )
            ]),
            t.blockStatement(<t.Statement[]>newTagInfo.astInfo.body)
          )
        );

        this.isInSlotFallbackScope = true;
      } else {
        const [elementName, prefix] = this.getLocalAndPrefixByName(tagName);

        if (prefix != null) {
          newTagInfo.isCustomComponent = true;

          newTagInfo.astInfo.body.push(
            t.variableDeclaration(
              'let',
              [
                t.variableDeclarator(
                  t.identifier(`slotViews${this.treeIndex}`),
                  t.objectExpression([])
                )
              ]
            )
          );
          newTagInfo.astInfo.indexBeforeNewViewInstance = newTagInfo.astInfo.body.length;
        } else {
          // Store tags that are actually nativescript core components
          this.usedNSTags.add(tagName);
        }

        // View imports and properties
        const { namespaces, properties } = this.traverseAttributes(tagName, attributes);

        // Register modules to module name resolver
        this.registerNamespaces(namespaces, newTagInfo.astInfo.body);

        // Create view instance
        newTagInfo.astInfo.body.push(
          ...this.buildComponentAst(this.treeIndex, elementName, prefix, parentTagName)
        );

        // View properties and bindings
        this.handleViewProperties(this.treeIndex, tagName, properties, newTagInfo.astInfo.body);
      }
    }

    newTagInfo != null && this.openTags.push(newTagInfo);
  }

  public handleCloseTag(tagName: string): void {
    // Platform tags
    if (KNOWN_PLATFORMS.includes(tagName)) {
      if (tagName.toLowerCase() !== this.options.platform) {
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
                const childrenAstElements = openTagInfo.childIndices.map(treeIndex => t.identifier(ELEMENT_PREFIX + treeIndex));
                openTagInfo.astInfo.body.push(
                  t.expressionStatement(
                    t.callExpression(
                      t.memberExpression(
                        t.memberExpression(
                          t.identifier('global'),
                          t.identifier(GLOBAL_UI_REF)
                        ),
                        t.identifier('addViewsFromBuilder')
                      ), [
                        t.identifier(ELEMENT_PREFIX + openTagInfo.index),
                        t.arrayExpression(childrenAstElements),
                        t.stringLiteral(openTagInfo.propertyName)
                      ]
                    )
                  )
                );
              }
              break;
            }
            case ElementType.TEMPLATE: {
              const childIndex = openTagInfo.childIndices[openTagInfo.childIndices.length - 1];
              openTagInfo.astInfo.body.push(t.returnStatement(childIndex != null ? t.identifier(ELEMENT_PREFIX + childIndex) : t.nullLiteral()));
              break;
            }
            default:
              break;
          }
        } else if (tagName === SpecialTags.SLOT_CONTENT) {
          const parentTagInfo = this.openTags[this.openTags.length - 2];

          for (const [slotName, childIndices] of openTagInfo.slotMap) {
            const arrayAstBody = [];
            for (const childIndex of childIndices) {
              const instanceIdentifier = t.identifier(ELEMENT_PREFIX + childIndex);
              arrayAstBody.push(
                // Slots accept an array of elements so we spread instance
                openTagInfo.slotChildIndices.includes(childIndex) ? t.spreadElement(instanceIdentifier) : instanceIdentifier
              );
            }

            openTagInfo.astInfo.body.push(
              t.expressionStatement(
                t.assignmentExpression(
                  '=',
                  t.memberExpression(
                    t.identifier(`slotViews${openTagInfo.index}`),
                    t.stringLiteral(slotName),
                    true
                  ),
                  t.arrayExpression(arrayAstBody)
                )
              )
            );
          }

          // Put slot ast content into parent body
          parentTagInfo.astInfo.body.splice(parentTagInfo.astInfo.indexBeforeNewViewInstance, 0, ...openTagInfo.astInfo.body);
        } else if (tagName === SpecialTags.TEMPLATE) {
          const childIndex = openTagInfo.childIndices[openTagInfo.childIndices.length - 1];
          openTagInfo.astInfo.body.push(t.returnStatement(childIndex != null ? t.identifier(ELEMENT_PREFIX + childIndex) : t.nullLiteral()));
        } else {
          if (openTagInfo.isParentForSlots && openTagInfo.nestedTagCount > 1) {
            throw new Error(`Cannot mix common views or properties with slot content inside tag '${tagName}'`);
          }

          if (tagName === SpecialTags.SLOT) {
            openTagInfo.astInfo.body.push(
              t.expressionStatement(
                t.assignmentExpression(
                  '=',
                  t.identifier(ELEMENT_PREFIX + openTagInfo.index),
                  t.identifier('fallbackViews')
                )
              )
            );
            this.isInSlotFallbackScope = false;
          } else {
            if (openTagInfo.childIndices.length) {
              // Slots accept an array of elements so we spread instance
              const childrenAstElements = openTagInfo.childIndices.map(treeIndex => openTagInfo.slotChildIndices.includes(treeIndex) ? 
                t.spreadElement(t.identifier(ELEMENT_PREFIX + treeIndex)) : t.identifier(ELEMENT_PREFIX + treeIndex));
              openTagInfo.astInfo.body.push(
                t.expressionStatement(
                  t.callExpression(
                    t.memberExpression(
                      t.memberExpression(
                        t.identifier('global'),
                        t.identifier(GLOBAL_UI_REF)
                      ),
                      t.identifier('addViewsFromBuilder')
                    ), [
                      t.identifier(ELEMENT_PREFIX + openTagInfo.index),
                      t.arrayExpression(childrenAstElements)
                    ]
                  )
                )
              );
            }
          }
        }

        // Remove tag from the openTags collection
        this.openTags.pop();
        if (this.openTags.length) {
          openTagInfo = this.openTags[this.openTags.length - 1];
        } else {
          openTagInfo = null;
          this.isComponentInitialized = true;
          this.assembleAst();
        }
      }

      // Update open child tag flag for current open tag
      if (openTagInfo != null) {
        openTagInfo.hasOpenChildTag = false;
      }
    }
  }

  public getModuleAst(): t.Program {
    return this.isComponentInitialized ? this.moduleAst : null;
  }

  public getPathsToResolve(): string[] {
    return this.pathsToResolve;
  }

  private assembleAst(): void {
    const astBody = [];

    // Core modules barrel
    const usedTagNames = Array.from(this.usedNSTags).sort();

    this.astConstructorBody.unshift(
      t.variableDeclaration('let', [
        t.variableDeclarator(
          t.identifier('customModules'),
          t.objectExpression([])
        )
      ])
    );

    this.astConstructorBody.push(
      t.expressionStatement(
        t.logicalExpression(
          '&&',
          t.identifier('resolvedCssModuleName'),
          t.callExpression(
            t.memberExpression(
              t.identifier(ELEMENT_PREFIX + 0),
              t.identifier('addCssFile'),
            ),
            [
              t.identifier('resolvedCssModuleName')
            ]
          )
        )
      ),
      t.returnStatement(
        t.identifier(ELEMENT_PREFIX + 0)
      )
    );

    // Imports
    astBody.push(
      t.variableDeclaration('let', [
        t.variableDeclarator(
          t.objectPattern(usedTagNames.map(tagName => t.objectProperty(
            t.identifier(tagName),
            t.identifier(tagName),
            false,
            true
          )).concat([
            t.objectProperty(
              t.identifier('addWeakEventListener'),
              t.identifier('addWeakEventListener'),
              false,
              true
            ),
            t.objectProperty(
              t.identifier('Observable'),
              t.identifier('Observable'),
              false,
              true
            ),
            t.objectProperty(
              t.identifier('removeWeakEventListener'),
              t.identifier('removeWeakEventListener'),
              false,
              true
            ),
            t.objectProperty(
              t.identifier('unsetValue'),
              t.identifier('unsetValue'),
              false,
              true
            )
          ])),
          t.callExpression(
            t.identifier('require'), [
              t.stringLiteral('@nativescript/core')
            ]
          )
        )
      ]),
      t.variableDeclaration('let', [
        t.variableDeclarator(
          t.objectPattern([
            t.objectProperty(
              t.identifier('resolveModuleName'),
              t.identifier('resolveModuleName'),
              false,
              true
            )
          ]),
          t.callExpression(
            t.identifier('require'), [
              t.stringLiteral('@nativescript/core/module-name-resolver')
            ]
          )
        )
      ])
    );

    astBody.push(
      ...this.astCustomModulesRegister,
      ...this.astBindingCallbacksBody,
      // Class
      t.exportDefaultDeclaration(
        t.classDeclaration(
          t.identifier(this.componentName),
          null,
          t.classBody([
            t.classMethod('constructor',
              t.identifier('constructor'), [
                t.assignmentPattern(
                  t.identifier('moduleExportsFallback'),
                  t.nullLiteral()
                )
              ],
              t.blockStatement(this.astConstructorBody)
            )
          ])
        )
      ),
      t.expressionStatement(
        t.assignmentExpression(
          '=',
          t.memberExpression(
            t.identifier(this.componentName),
            t.identifier('isXMLComponent')
          ),
          t.booleanLiteral(true)
        )
      )
    );
    
    this.moduleAst = t.program(astBody, [], 'module');
  }

  private isClosingTag(closingTagName: string, openTagInfo: TagInfo): boolean {
    const fullTagName = openTagInfo.propertyName != null ? `${openTagInfo.tagName}.${openTagInfo.propertyName}` : openTagInfo.tagName;
    return fullTagName === closingTagName && !openTagInfo.hasOpenChildTag;
  }

  private checkOpenTagNestingConditions(openTagInfo: TagInfo, newTagName: string, attributes): void {
    if (newTagName === SpecialTags.SLOT) {
      if (this.isInSlotFallbackScope) {
        throw new Error(`Cannot declare slot '${attributes.slot || 'default'}' inside slot fallback scope`);
      }
    }

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
        if (newTagName === SpecialTags.TEMPLATE) {
          const fullTagName = openTagInfo.propertyName != null ? `${openTagInfo.tagName}.${openTagInfo.propertyName}` : openTagInfo.tagName;
          throw new Error(`Template tags can only be nested inside template properties. Parent tag: ${fullTagName}`);
        }
        break;
    }
  }

  private handleViewProperties(treeIndex: number, tagName, properties: Array<AttributeItem>, astBody: Array<t.Expression | t.Statement>) {
    const bindingOptionData: Array<BindingOptions> = [];

    for (const propertyDetails of properties) {
      // If property value is enclosed in curly brackets, then it's a binding expression
      if (this.bindingBuilder.isBindingValue(propertyDetails.value)) {
        bindingOptionData.push(this.bindingBuilder.convertValueToBindingOptions(propertyDetails));
      } else {
        astBody.push(this.getPropertySetterAst(propertyDetails.name, propertyDetails.isEventListener ? t.memberExpression(
          t.identifier('moduleExports'),
          t.stringLiteral(propertyDetails.value),
          true
        ) : t.stringLiteral(propertyDetails.value), t.identifier(ELEMENT_PREFIX + this.treeIndex), propertyDetails.isEventListener));
      }
    }

    // Check if view has property bindings
    if (bindingOptionData.length) {
      // Add listener for tracking binding context changes
      astBody.push(
        t.expressionStatement(
          t.callExpression(
            t.memberExpression(
              t.identifier(ELEMENT_PREFIX + this.treeIndex),
              t.identifier('on')
            ), [
              t.stringLiteral('bindingContextChange'),
              t.identifier(`_on_${ELEMENT_PREFIX + this.treeIndex}BindingContextChange`)
            ]
          )
        )
      );

      // Generate functions for listening to binding changes
      this.generateBindingCallbackDeclarations(this.treeIndex, bindingOptionData);
    }
  }

  private traverseAttributes(tagName: string, attributes): { namespaces: Array<AttributeItem>; properties: Array<AttributeItem> } {
    const namespaces: Array<AttributeItem> = new Array<AttributeItem>();
    const properties: Array<AttributeItem> = new Array<AttributeItem>();

    const entries = Object.entries(attributes) as any;
    for (const [ name, value ] of entries) {
      // Ignore special attributes
      if (name === 'slot' || name === 'xmlns') {
        continue;
      }

      const [propertyName, prefix] = this.getLocalAndPrefixByName(name);
      if (prefix != null) {
        // Platform-based attributes
        if (KNOWN_PLATFORMS.includes(prefix.toLowerCase()) && prefix.toLowerCase() !== this.options.platform.toLowerCase()) {
          continue;
        }
      }

      let propertyValue;

      // Custom attribute value formatting
      if (this.options.attributeValueFormatter) {
        propertyValue = this.options.attributeValueFormatter(value, propertyName, tagName, attributes) ?? '';
      } else {
        propertyValue = value;
      }

      // Namespaces work as module imports
      if (prefix === 'xmlns') {
        namespaces.push({
          name: propertyName,
          value: propertyValue,
          isEventListener: false,
          isSubProperty: false
        });
      } else {
        properties.push({
          prefix,
          name: propertyName,
          value: propertyValue,
          isEventListener: prefix === EVENT_PREFIX,
          isSubProperty: propertyName.includes('.')
        });
      }
    }

    return {
      namespaces,
      properties
    };
  }

  private getPropertySetterAst(propertyName: string, valueExpression: t.Expression, identifier: t.Identifier, isEventListener: boolean): t.ExpressionStatement {
    return t.expressionStatement(
      t.callExpression(
        t.memberExpression(
          t.memberExpression(
            t.identifier('global'),
            t.identifier(GLOBAL_UI_REF)
          ),
          t.identifier('setPropertyValue')
        ), [
          identifier,
          t.stringLiteral(propertyName),
          valueExpression,
          t.booleanLiteral(isEventListener)
        ]
      )
    );
  }

  private buildComponentAst(index: number, elementName: string, prefix: string, parentTagName: string): Array<t.Expression | t.Statement> {
    const astBody = [];
    const elementIdentifier = t.identifier(ELEMENT_PREFIX + index);
    const isSlotFallback = parentTagName === SpecialTags.SLOT;

    if (prefix != null) {
      const classAstRef = t.memberExpression(
        t.memberExpression(
          t.identifier('customModules'),
          t.stringLiteral(prefix),
          true
        ),
        t.identifier(elementName)
      );

      const astNewExpression = t.conditionalExpression(
        t.memberExpression(classAstRef, t.identifier('isXMLComponent')),
        t.newExpression(classAstRef, [
          t.identifier('moduleExports')
        ]),
        t.newExpression(classAstRef, [])
      );

      astBody.push(
        t.expressionStatement(
          t.assignmentExpression(
            '=', 
            t.memberExpression(
              t.memberExpression(
                classAstRef, 
                t.identifier('prototype')
              ), 
              t.identifier('$slotViews')
            ),
            t.identifier(`slotViews${index}`)
          )
        )
      );

      astBody.push(...this.generateComponentInitializationAstBody(elementIdentifier, astNewExpression, isSlotFallback));

      astBody.push(
        t.expressionStatement(
          t.unaryExpression(
            'delete',
            t.memberExpression(
              t.memberExpression(
                classAstRef,
                t.identifier('prototype')
              ),
              t.identifier('$slotViews')
            )
          )
        )
      );
    } else {
      astBody.push(...this.generateComponentInitializationAstBody(elementIdentifier, t.newExpression(t.identifier(elementName), []), isSlotFallback));
    }

    return astBody;
  }

  private generateComponentInitializationAstBody(elementIdentifier: t.Identifier, astNewStatement: t.Expression, isSlotFallback: boolean): Array<t.Expression | t.Statement> {
    const astBody = [];

    if (isSlotFallback) {
      astBody.push(
        t.expressionStatement(
          t.assignmentExpression(
            '=',
            elementIdentifier,
            astNewStatement
          )
        ),
        t.expressionStatement(
          t.callExpression(
            t.memberExpression(
              t.identifier('fallbackViews'),
              t.identifier('push')
            ),
            [
              elementIdentifier
            ]
          )
        )
      );
    } else {
      astBody.push(t.variableDeclaration(
        'let',
        [
          t.variableDeclarator(
            elementIdentifier,
            astNewStatement
          )
        ]
      ));
    }
    return astBody;
  }

  private generateScriptAndStyleBindingAst(attributes): Array<t.Statement> {
    let codeResolvedPath, styleResolvedPath;

    // Script
    if (CODE_FILE in attributes) {
      const attrValue = attributes[CODE_FILE];
      codeResolvedPath = this.getResolvedPath(attrValue);

      this.pathsToResolve.push(attrValue);
    } else {
      codeResolvedPath = this.options.moduleRelativePath;
    }

    // Style
    if (CSS_FILE in attributes) {
      const attrValue = attributes[CSS_FILE];
      styleResolvedPath = this.getResolvedPath(attrValue);

      this.pathsToResolve.push(attrValue);
    } else {
      styleResolvedPath = this.options.moduleRelativePath;
    }

    return [
      t.variableDeclaration(
        'let',
        [
          t.variableDeclarator(
            t.identifier('resolvedCodeModuleName'),
            t.callExpression(
              t.identifier('resolveModuleName'),
              [
                t.stringLiteral(codeResolvedPath),
                t.stringLiteral('')
              ]
            )
          )
        ]
      ), t.variableDeclaration(
        'let',
        [
          t.variableDeclarator(
            t.identifier('resolvedCssModuleName'),
            t.callExpression(
              t.identifier('resolveModuleName'),
              [
                t.stringLiteral(styleResolvedPath),
                t.stringLiteral('css')
              ]
            )
          )
        ]
      ), t.variableDeclaration(
        'let',
        [
          t.variableDeclarator(
            t.identifier('moduleExports'),
            t.logicalExpression(
              '??',
              t.conditionalExpression(
                t.identifier('resolvedCodeModuleName'),
                t.callExpression(
                  t.memberExpression(
                    t.identifier('global'),
                    t.identifier('loadModule')
                  ),
                  [
                    t.identifier('resolvedCodeModuleName'),
                    t.booleanLiteral(true)
                  ]
                ),
                t.identifier('moduleExportsFallback')
              ),
              t.objectExpression([])
            )
          )
        ]
      )
    ];
  }

  private generateBindingSourceAstCallback(propertyName: string, parentKeyAstExpressions: Array<t.Expression>, expressionStatements: t.ExpressionStatement[]): t.ObjectProperty {
    return t.objectProperty(
      t.stringLiteral(propertyName),
      t.functionExpression(
        null,
        [
          t.identifier('view'),
          t.identifier(VIEW_MODEL_REFERENCE_NAME),
          t.identifier('bindingScopes')
        ],
        t.blockStatement([
          t.variableDeclaration(
            'let',
            [
              t.variableDeclarator(
                t.objectPattern([
                  t.objectProperty(
                    t.identifier(VALUE_REFERENCE_NAME),
                    t.identifier(VALUE_REFERENCE_NAME),
                    false,
                    true
                  ),
                  t.objectProperty(
                    t.identifier(PARENT_REFERENCE_NAME),
                    t.identifier(PARENT_REFERENCE_NAME),
                    false,
                    true
                  )
                ]),
                t.identifier('bindingScopes')
              )
            ]
          ),
          t.variableDeclaration(
            'let', [
              t.variableDeclarator(
                t.identifier(PARENTS_REFERENCE_NAME),
                parentKeyAstExpressions.length ? t.callExpression(
                  t.memberExpression(
                    t.memberExpression(
                      t.identifier('global'),
                      t.identifier(GLOBAL_UI_REF)
                    ),
                    t.identifier('createParentsBindingInstance')
                  ), [
                    t.identifier('view'),
                    t.arrayExpression(parentKeyAstExpressions)
                  ]
                ) : t.nullLiteral()
              )
            ]
          ),
          ...expressionStatements
        ])
      )
    );
  }

  private generateBindingCallbackDeclarations(treeIndex: number, bindingOptionData: Array<BindingOptions>): void {
    const elementRef: string = ELEMENT_PREFIX + treeIndex;
    const bindingSourceCallbackPairName = `_${elementRef}BindingSourceCallbackPairs`;
    const bindingSourcePropertyAstCallbacks: t.ObjectProperty[] = [];
    const bindingTargetPropertyAstListenerArgs: Array<t.Expression[]> = [];
    const bindingTargetAstSettersForContextChange: Array<t.ExpressionStatement> = [];
    const bindingTargetAstUnsetsForContextChange: Array<t.ExpressionStatement> = [];
    const bindingTargetAstSettersPerPropertyMap: Map<string, t.ExpressionStatement[]> = new Map();
    const totalParentKeyAstExpressions: Array<t.Expression> = [];

    // Generate functions for listening to binding property changes
    for (let i = 0, length = bindingOptionData.length; i < length; i++) {
      const bindingOptions = bindingOptionData[i];
      const viewPropertyDetails = bindingOptions.viewPropertyDetails;
      const bindingTargetPropertyCallbackName = `_on_${elementRef}BindingTargetProperty${i}Change`;

      // Populate expressions used by $parents references
      if (bindingOptions.parentKeyAstExpressions.length) {
        totalParentKeyAstExpressions.push(...bindingOptions.parentKeyAstExpressions);
      }

      // These statements serve for setting and unsetting expression values to target properties inside binding context change callback
      bindingTargetAstSettersForContextChange.push(this.getPropertySetterAst(viewPropertyDetails.name, bindingOptions.astExpression, t.identifier('view'), viewPropertyDetails.isEventListener));
      bindingTargetAstUnsetsForContextChange.push(this.getPropertySetterAst(viewPropertyDetails.name, t.identifier('unsetValue'), t.identifier('view'), viewPropertyDetails.isEventListener));

      // These mapped target property setters will serve for generating binding source callbacks that will be used from binding property change callback
      for (const propertyName of bindingOptions.properties) {
        const bindingTargetPropertyAstSetter = this.getPropertySetterAst(viewPropertyDetails.name, bindingOptions.astExpression, t.identifier('view'), viewPropertyDetails.isEventListener);

        if (bindingTargetAstSettersPerPropertyMap.has(propertyName)) {
          bindingTargetAstSettersPerPropertyMap.get(propertyName).push(bindingTargetPropertyAstSetter);
        } else {
          bindingTargetAstSettersPerPropertyMap.set(propertyName, [bindingTargetPropertyAstSetter]);
        }
      }

      // View -> view model callback (two-way) function
      if (bindingOptions.isTwoWay) {
        this.astBindingCallbacksBody.push(
          this.generateBindingTargetAstCallback(bindingTargetPropertyCallbackName, bindingOptions)
        );

        // These arguments are used for adding/removing event listeners for binding target properties
        bindingTargetPropertyAstListenerArgs.push([
          t.stringLiteral(`${viewPropertyDetails.name}Change`),
          t.identifier(bindingTargetPropertyCallbackName)
        ]);
      }
    }

    // View model -> view callback functions
    for (const [ propertyName, expressionStatements ] of bindingTargetAstSettersPerPropertyMap) {
      bindingSourcePropertyAstCallbacks.push(this.generateBindingSourceAstCallback(propertyName, totalParentKeyAstExpressions, expressionStatements));
    }

    const bindingSourcePropertyAstCallbackPairs = t.variableDeclaration(
      'let', [
        t.variableDeclarator(
          t.identifier(bindingSourceCallbackPairName),
          t.objectExpression(bindingSourcePropertyAstCallbacks)
        )
      ]
    );

    // Binding context change callback function
    const bindingContextCallbackAst = t.functionDeclaration(
      t.identifier(`_on_${elementRef}BindingContextChange`), [
        t.identifier('args')
      ],
      t.blockStatement([
        t.variableDeclaration(
          'let', [
            t.variableDeclarator(
              t.identifier('view'),
              t.memberExpression(
                t.identifier('args'),
                t.identifier('object')
              )
            )
          ]
        ),
        t.variableDeclaration(
          'let', [
            t.variableDeclarator(
              t.identifier('oldBindingContext'),
              t.memberExpression(
                t.identifier('args'),
                t.identifier('oldValue')
              )
            )
          ]
        ),
        t.variableDeclaration(
          'let', [
            t.variableDeclarator(
              t.identifier('bindingContext'),
              t.memberExpression(
                t.identifier('args'),
                t.identifier('value')
              )
            )
          ]
        ),
        t.variableDeclaration(
          'let', [
            t.variableDeclarator(
              t.identifier('isBindingContextChanged'),
              t.binaryExpression(
                '!==',
                t.identifier('oldBindingContext'),
                t.identifier('bindingContext')
              )
            )
          ]
        ),
        t.ifStatement(
          t.binaryExpression(
            '!=',
            t.identifier('oldBindingContext'),
            t.nullLiteral()
          ),
          t.blockStatement([
            t.ifStatement(
              t.binaryExpression(
                '==',
                t.identifier('bindingContext'),
                t.nullLiteral()
              ),
              t.blockStatement(
                bindingTargetPropertyAstListenerArgs.map(args => t.expressionStatement(
                  t.callExpression(
                    t.memberExpression(
                      t.identifier('view'),
                      t.identifier('off')
                    ),
                    args
                  )
                )).concat(bindingTargetAstUnsetsForContextChange)
              )
            ),
            t.ifStatement(
              t.logicalExpression(
                '&&',
                t.identifier('isBindingContextChanged'),
                t.binaryExpression(
                  'instanceof',
                  t.identifier('oldBindingContext'),
                  t.identifier('Observable')
                )
              ),
              t.blockStatement([
                t.expressionStatement(
                  t.unaryExpression(
                    'delete',
                    t.memberExpression(
                      t.identifier('view'),
                      t.identifier('_bindingSourceCallbackPairs')
                    )
                  )
                ),
                t.expressionStatement(
                  t.callExpression(
                    t.identifier('removeWeakEventListener'), [
                      t.identifier('oldBindingContext'),
                      t.memberExpression(
                        t.identifier('Observable'),
                        t.identifier('propertyChangeEvent')
                      ),
                      t.memberExpression(
                        t.memberExpression(
                          t.identifier('global'),
                          t.identifier(GLOBAL_UI_REF)
                        ),
                        t.identifier('onBindingSourcePropertyChange')
                      ),
                      t.identifier('view')
                    ]
                  )
                )
              ])
            )
          ])
        ),
        t.ifStatement(
          t.binaryExpression(
            '!=',
            t.identifier('bindingContext'),
            t.nullLiteral()
          ),
          t.blockStatement([
            t.expressionStatement(
              t.callExpression(
                t.memberExpression(
                  t.memberExpression(
                    t.identifier('global'),
                    t.identifier(GLOBAL_UI_REF)
                  ),
                  t.identifier('startViewModelToViewUpdate')
                ), [
                  t.identifier('view'),
                  t.identifier('bindingContext'),
                  t.arrowFunctionExpression(
                    [
                      t.identifier(VIEW_MODEL_REFERENCE_NAME)
                    ],
                    t.blockStatement([
                      t.variableDeclaration(
                        'let', [
                          t.variableDeclarator(
                            t.identifier(VALUE_REFERENCE_NAME),
                            t.identifier(VIEW_MODEL_REFERENCE_NAME)
                          )
                        ]
                      ),
                      t.variableDeclaration(
                        'let', [
                          t.variableDeclarator(
                            t.identifier(PARENT_REFERENCE_NAME),
                            t.conditionalExpression(
                              t.memberExpression(
                                t.identifier('view'),
                                t.identifier('parent')
                              ),
                              t.memberExpression(
                                t.memberExpression(
                                  t.identifier('view'),
                                  t.identifier('parent')
                                ),
                                t.identifier('bindingContext')
                              ),
                              t.nullLiteral()
                            )
                          )
                        ]
                      ),
                      t.variableDeclaration(
                        'let', [
                          t.variableDeclarator(
                            t.identifier(PARENTS_REFERENCE_NAME),
                            totalParentKeyAstExpressions.length ? t.callExpression(
                              t.memberExpression(
                                t.memberExpression(
                                  t.identifier('global'),
                                  t.identifier(GLOBAL_UI_REF)
                                ),
                                t.identifier('createParentsBindingInstance')
                              ), [
                                t.identifier('view'),
                                t.arrayExpression(totalParentKeyAstExpressions)
                              ]
                            ) : t.nullLiteral()
                          )
                        ]
                      ),
                      ...bindingTargetAstSettersForContextChange
                    ])
                  )
                ]
              )
            ),
            t.ifStatement(
              t.binaryExpression(
                '==',
                t.identifier('oldBindingContext'),
                t.nullLiteral()
              ),
              t.blockStatement(
                bindingTargetPropertyAstListenerArgs.map(args => t.expressionStatement(
                  t.callExpression(
                    t.memberExpression(
                      t.identifier('view'),
                      t.identifier('on')
                    ),
                    args
                  )
                ))
              )
            ),
            t.ifStatement(
              t.logicalExpression(
                '&&',
                t.identifier('isBindingContextChanged'),
                t.binaryExpression(
                  'instanceof',
                  t.identifier('bindingContext'),
                  t.identifier('Observable')
                )
              ),
              t.blockStatement([
                t.expressionStatement(
                  t.assignmentExpression(
                    '=',
                    t.memberExpression(
                      t.identifier('view'),
                      t.identifier('_bindingSourceCallbackPairs')
                    ),
                    t.identifier(bindingSourceCallbackPairName)
                  )
                ),
                t.expressionStatement(
                  t.callExpression(
                    t.identifier('addWeakEventListener'), [
                      t.identifier('bindingContext'),
                      t.memberExpression(
                        t.identifier('Observable'),
                        t.identifier('propertyChangeEvent')
                      ),
                      t.memberExpression(
                        t.memberExpression(
                          t.identifier('global'),
                          t.identifier(GLOBAL_UI_REF)
                        ),
                        t.identifier('onBindingSourcePropertyChange')
                      ),
                      t.identifier('view')
                    ]
                  )
                )
              ])
            )
          ])
        )
      ]),
      false
    );
    this.astBindingCallbacksBody.push(bindingSourcePropertyAstCallbackPairs, bindingContextCallbackAst);
  }

  private generateBindingTargetAstCallback(callbackName: string, bindingOptions: BindingOptions): t.FunctionDeclaration {
    let bindingExpression;
    if (bindingOptions.converterToModelAstExpression != null) {
      if (!bindingOptions.converterToModelAstExpression.expressions.length) {
        throw new Error(`Invalid converter expression for property '${bindingOptions.viewPropertyDetails.name}': ${bindingOptions.toString()}`);
      }
      bindingExpression = bindingOptions.converterToModelAstExpression.expressions[0];
    } else {
      bindingExpression = bindingOptions.astExpression;
    }

    // Separate last member property from rest of member expression as we'll need it for value assignment
    const memberObjectAst = bindingExpression.object;
    const memberPropertyAst = t.isIdentifier(bindingExpression.property) && !bindingExpression.computed ? t.stringLiteral(bindingExpression.property.name) : bindingExpression.property;
    const valueExpression = bindingOptions.converterToModelAstExpression != null ? bindingOptions.converterToModelAstExpression.expressions[1] : t.memberExpression(
      t.identifier('args'),
      t.identifier('value')
    );

    return t.functionDeclaration(
      t.identifier(callbackName),
      [
        t.identifier('args')
      ],
      t.blockStatement([
        t.variableDeclaration(
          'let', [
            t.variableDeclarator(
              t.identifier('view'),
              t.memberExpression(
                t.identifier('args'),
                t.identifier('object')
              )
            )
          ]
        ),
        t.expressionStatement(
          t.callExpression(
            t.memberExpression(
              t.memberExpression(
                t.identifier('global'),
                t.identifier(GLOBAL_UI_REF)
              ),
              t.identifier('startViewToViewModelUpdate')
            ), [
              t.identifier('view'),
              t.memberExpression(
                t.identifier('view'),
                t.identifier('bindingContext')
              ),
              t.arrowFunctionExpression(
                [
                  t.identifier(VIEW_MODEL_REFERENCE_NAME)
                ],
                t.blockStatement([
                  t.variableDeclaration(
                    'let', [
                      t.variableDeclarator(
                        t.identifier(VALUE_REFERENCE_NAME),
                        t.identifier(VIEW_MODEL_REFERENCE_NAME)
                      )
                    ]
                  ),
                  t.variableDeclaration(
                    'let', [
                      t.variableDeclarator(
                        t.identifier(PARENT_REFERENCE_NAME),
                        t.conditionalExpression(
                          t.memberExpression(
                            t.identifier('view'),
                            t.identifier('parent')
                          ),
                          t.memberExpression(
                            t.memberExpression(
                              t.identifier('view'),
                              t.identifier('parent')
                            ),
                            t.identifier('bindingContext')
                          ),
                          t.nullLiteral()
                        )
                      )
                    ]
                  ),
                  t.variableDeclaration(
                    'let', [
                      t.variableDeclarator(
                        t.identifier(PARENTS_REFERENCE_NAME),
                        bindingOptions.parentKeyAstExpressions.length ? t.callExpression(
                          t.memberExpression(
                            t.memberExpression(
                              t.identifier('global'),
                              t.identifier(GLOBAL_UI_REF)
                            ),
                            t.identifier('createParentsBindingInstance')
                          ), [
                            t.identifier('view'),
                            t.arrayExpression(bindingOptions.parentKeyAstExpressions)
                          ]
                        ) : t.nullLiteral()
                      )
                    ]
                  ),
                  // Since we can't have optional chaining as left-hand side assignment, let's store and use it as a variable
                  t.variableDeclaration(
                    'let', [
                      t.variableDeclarator(
                        t.identifier('propertyOwner'),
                        memberObjectAst
                      )
                    ]
                  ),
                  // Ensure accessed instance is not null or undefined and apply new value
                  t.ifStatement(
                    t.binaryExpression(
                      '!=',
                      t.identifier('propertyOwner'),
                      t.nullLiteral()
                    ),
                    t.blockStatement([
                      t.ifStatement(
                        t.binaryExpression(
                          'instanceof',
                          t.identifier('propertyOwner'),
                          t.identifier('Observable')
                        ),
                        t.blockStatement([
                          t.expressionStatement(
                            t.callExpression(
                              t.memberExpression(
                                t.identifier('propertyOwner'),
                                t.identifier('set')
                              ),
                              [
                                memberPropertyAst,
                                valueExpression
                              ]
                            )
                          )
                        ]),
                        t.blockStatement([
                          t.expressionStatement(
                            t.assignmentExpression(
                              '=',
                              t.memberExpression(
                                t.identifier('propertyOwner'),
                                memberPropertyAst,
                                true
                              ),
                              valueExpression
                            )
                          )
                        ])
                      )
                    ])
                  )
                ])
              )
            ]
          )
        )
      ])
    );
  }

  private registerNamespaces(namespaces: Array<AttributeItem>, astBody: Array<t.Expression | t.Statement>): void {
    for (const { name, value } of namespaces) {
      const resolvedPath = this.getResolvedPath(value);
      const ext = resolvedPath.endsWith('.xml') ? 'xml' : '';

      /**
       * By default, virtual-entry-javascript registers all application js, xml, and css files as modules.
       * Registering namespaces will ensure node modules are also included in module register.
       * However, we have to ensure that the resolved path of files is used as module key so that module-name-resolver works properly.
       */
      this.pathsToResolve.push(value);

      // Register module using resolve path as key and overwrite old registration if any
      this.astCustomModulesRegister.push(
        t.expressionStatement(
          t.callExpression(
            t.memberExpression(
              t.identifier('global'),
              t.identifier('registerModule')
            ),
            [
              t.stringLiteral(resolvedPath),
              t.arrowFunctionExpression(
                [],
                t.callExpression(
                  t.identifier('require'),
                  [
                    t.stringLiteral(value)
                  ]
                )
              )
            ]
          )
        )
      );

      astBody.push(
        t.expressionStatement(
          t.assignmentExpression(
            '=',
            t.memberExpression(
              t.identifier('customModules'),
              t.stringLiteral(name),
              true
            ),
            t.callExpression(
              t.memberExpression(
                t.memberExpression(
                  t.identifier('global'),
                  t.identifier(GLOBAL_UI_REF)
                ),
                t.identifier('loadCustomModule')
              ),
              [
                t.stringLiteral(resolvedPath),
                t.stringLiteral(ext)
              ]
            )
          )
        )
      );
    }
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