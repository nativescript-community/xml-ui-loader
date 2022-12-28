import * as t from '@babel/types';
import { pascalCase } from 'change-case';
import { Parser } from 'htmlparser2';
import { join, parse } from 'path';
import { AttributeValueFormatter } from '../helpers';

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

enum SpecialTags {
  SLOT = 'slot',
  SLOT_CONTENT = 'slotContent',
  TEMPLATE = 'template'
}

interface ComponentBuilderOptions {
  moduleRelativePath: string;
  platform: string;
  attributeValueFormatter: AttributeValueFormatter;
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
  ast: {
    body: Array<t.Expression | t.Statement>;
    spliceIndex: number; // This index is often useful for prepending or appending AST content
  };
  slotChildIndices: Array<number>;
  slotMap?: Map<string, Array<number>>;
  isCustomComponent: boolean;
  isParentForSlots: boolean;
  hasOpenChildTag: boolean;
}

function getAstForRawXML(content: string): t.Program {
  return t.program([
    t.variableDeclaration(
      'const',
      [
        t.variableDeclarator(
          t.identifier('RAW_XML_CONTENT'),
          t.stringLiteral(content)
        )
      ]
    ),
    t.exportDefaultDeclaration(
      t.identifier('RAW_XML_CONTENT')
    )
  ], [], 'module');
}

export function transformIntoAST(content: string, builderOpts: ComponentBuilderOptions): { output: t.Program; pathsToResolve: Array<string> } {
  const componentBuilder = new ComponentBuilder(builderOpts);
  let compilationResult;
  let needsCompilation = true;

  const xmlParser = new Parser({
    onopentag(tagName, attributes) {
      componentBuilder.handleOpenTag(tagName, attributes);
    },
    onprocessinginstruction(name) {
      if (name == '?xml') {
        needsCompilation = false;
        xmlParser.reset();
      }
    },
    onclosetag(tagName) {
      componentBuilder.handleCloseTag(tagName);
    },
    onerror(err) {
      throw err;
    }
  }, {
    xmlMode: true
  });
  xmlParser.write(content);
  xmlParser.end();

  if (needsCompilation) {
    compilationResult = {
      output: componentBuilder.getModuleAst(),
      pathsToResolve: componentBuilder.getPathsToResolve()
    };
  } else {
    compilationResult = {
      output: getAstForRawXML(content),
      pathsToResolve: []
    };
  }

  return compilationResult;
}

export class ComponentBuilder {
  private openTags = new Array<TagInfo>();
  private pathsToResolve = new Array<string>();
  private usedNSTags = new Set<string>();

  private options: ComponentBuilderOptions;
  private componentName: string;
  private moduleDirPath: string;

  // Keep counter for the case of platform tags being inside platform tags
  private unsupportedPlatformTagCount: number = 0;

  private treeIndex: number = -1;

  private isComponentInitialized: boolean = false;
  private isInSlotFallbackScope: boolean = false;

  private moduleAst: t.Program;
  private astConstructorBody: Array<t.Statement> = [];
  private astCustomModuleProperties: Array<t.ObjectProperty> = [];
  private astCustomModulesRegister: Array<t.Statement> = [];

  constructor(options: ComponentBuilderOptions) {
    const { dir, ext, name } = parse(options.moduleRelativePath);
    const componentName = pascalCase(name);

    this.options = options;
    this.componentName = componentName;
    this.moduleDirPath = dir;
    
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
      ast: {
        body: null,
        spliceIndex: -1
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
        newTagInfo.ast = {
          body: [],
          spliceIndex: 0
        };

        if (tagPropertyName.endsWith(KNOWN_TEMPLATE_SUFFIX)) {
          newTagInfo.type = ElementType.TEMPLATE;

          openTagInfo.ast.body.push(
            t.expressionStatement(
              t.assignmentExpression(
                '=',
                t.memberExpression(
                  t.identifier(ELEMENT_PREFIX + openTagInfo.index),
                  t.identifier(newTagInfo.propertyName)
                ),
                t.arrowFunctionExpression(
                  [],
                  t.blockStatement(<t.Statement[]>newTagInfo.ast.body)
                )
              )
            )
          );
        } else if (tagPropertyName.endsWith(KNOWN_MULTI_TEMPLATE_SUFFIX)) {
          newTagInfo.type = ElementType.TEMPLATE_ARRAY;
          
          openTagInfo.ast.body.push(
            t.expressionStatement(
              t.assignmentExpression(
                '=',
                t.memberExpression(
                  t.identifier(ELEMENT_PREFIX + openTagInfo.index),
                  t.identifier(newTagInfo.propertyName)
                ),
                t.arrayExpression(<t.Expression[]>newTagInfo.ast.body)
              )
            )
          );
        } else {
          newTagInfo.type = ElementType.COMMON_PROPERTY;
        }
      } else {
        throw new Error(`Property '${tagName}' is not suitable for parent '${openTagInfo.tagName}'`);
      }
    } else if (tagName === SpecialTags.SLOT_CONTENT) {
      if (openTagInfo != null) {
        newTagInfo.index = openTagInfo.index;
        newTagInfo.slotMap = new Map();
        newTagInfo.ast = {
          body: [],
          spliceIndex: 0
        };

        openTagInfo.isParentForSlots = true;
      } else {
        throw new Error(`Invalid tag '${tagName}'. Tag has no parent`);
      }
    } else if (tagName === SpecialTags.TEMPLATE) {
      if (openTagInfo != null) {
        if (openTagInfo.type === ElementType.TEMPLATE_ARRAY) {
          // This is necessary for proper string escape
          const attrValue = MULTI_TEMPLATE_KEY_ATTRIBUTE in attributes ? attributes[MULTI_TEMPLATE_KEY_ATTRIBUTE] : '';

          newTagInfo.index = openTagInfo.index;
          newTagInfo.type = ElementType.TEMPLATE;
          newTagInfo.ast = {
            body: [],
            spliceIndex: 0
          };

          openTagInfo.ast.body.push(
            t.objectExpression([
              t.objectProperty(
                t.identifier(MULTI_TEMPLATE_KEY_ATTRIBUTE),
                t.stringLiteral(attrValue)
              ),
              t.objectProperty(
                t.identifier('createView'),
                t.arrowFunctionExpression(
                  [],
                  t.blockStatement(<t.Statement[]>newTagInfo.ast.body)
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

      let astBody;
      if (openTagInfo != null) {
        astBody = openTagInfo.ast.body;

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
        astBody = this.astConstructorBody;

        // Resolve js and css based on first element
        this.astConstructorBody.push(...this.generateScriptAndStyleBindingAst(attributes));
      }

      newTagInfo.index = this.treeIndex;
      newTagInfo.type = ElementType.VIEW;
      newTagInfo.ast = {
        body: astBody,
        spliceIndex: astBody.length
      };

      if (tagName === SpecialTags.SLOT) {
        const name = attributes.name || 'default';
        const slotViewsIdentifier = t.memberExpression(
          t.memberExpression(
            t.thisExpression(),
            t.identifier('$slotViews')
          ),
          t.identifier(name)
        );

        // Consume slot views if any
        newTagInfo.ast.body.push(
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
            ])
          )
        );
        newTagInfo.ast.spliceIndex = newTagInfo.ast.body.length;

        this.isInSlotFallbackScope = true;
      } else {
        const [elementName, prefix] = this.getLocalAndPrefixByName(tagName);
        const propertyStatements = [];

        if (prefix != null) {
          newTagInfo.isCustomComponent = true;

          newTagInfo.ast.body.push(
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
          newTagInfo.ast.spliceIndex = newTagInfo.ast.body.length;
        } else {
          // Store tags that are actually nativescript core components
          this.usedNSTags.add(tagName);
        }

        this.traverseAttributes(attributes, (propertyName: string, prefix: string, value: string) => {
          if (this.options.attributeValueFormatter) {
            value = this.options.attributeValueFormatter(value, propertyName, tagName, attributes) ?? '';
          }
    
          if (prefix === 'xmlns') {
            this.registerNamespace(propertyName, value);
          } else {
            propertyStatements.push(this.getAstForProperty(this.treeIndex, propertyName, value));
          }
        });

        newTagInfo.ast.body.push(...this.buildComponentAst(this.treeIndex, elementName, prefix, parentTagName).concat(propertyStatements));
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
                openTagInfo.ast.body.push(
                  t.expressionStatement(
                    t.callExpression(
                      t.memberExpression(
                        t.memberExpression(
                          t.identifier('global'),
                          t.identifier('xmlCompiler')
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
              openTagInfo.ast.body.push(t.returnStatement(childIndex != null ? t.identifier(ELEMENT_PREFIX + childIndex) : t.nullLiteral()));
              break;
            }
            default:
              break;
          }
        } else if (tagName === SpecialTags.SLOT_CONTENT) {
          const parentTagInfo = this.openTags[this.openTags.length - 2];

          for (const [slotName, childIndices] of openTagInfo.slotMap) {
            openTagInfo.ast.body.push(
              t.expressionStatement(
                t.assignmentExpression(
                  '=',
                  t.memberExpression(
                    t.identifier(`slotViews${openTagInfo.index}`),
                    t.identifier(slotName)
                  ),
                  t.arrayExpression([])
                )
              )
            );

            for (const childIndex of childIndices) {
              const instanceIdentifier = t.identifier(ELEMENT_PREFIX + childIndex);

              // Child is a slot element so we expect instance to be null or array
              if (openTagInfo.slotChildIndices.includes(childIndex)) {
                openTagInfo.ast.body.push(
                  t.expressionStatement(
                    t.logicalExpression(
                      '&&',
                      instanceIdentifier,
                      t.callExpression(
                        t.memberExpression(
                          t.memberExpression(
                            t.identifier(`slotViews${openTagInfo.index}`),
                            t.identifier(slotName)
                          ),
                          t.identifier('push')
                        ), [
                          t.spreadElement(instanceIdentifier)
                        ]
                      )
                    )
                  )
                );
              } else {
                openTagInfo.ast.body.push(
                  t.expressionStatement(
                    t.callExpression(
                      t.memberExpression(
                        t.memberExpression(
                          t.identifier(`slotViews${openTagInfo.index}`),
                          t.identifier(slotName)
                        ),
                        t.identifier('push')
                      ), [
                        instanceIdentifier
                      ]
                    )
                  )
                );
              }
            }
          }

          // Put slot ast content into parent body
          parentTagInfo.ast.body.splice(parentTagInfo.ast.spliceIndex, 0, ...openTagInfo.ast.body);
        } else if (tagName === SpecialTags.TEMPLATE) {
          const childIndex = openTagInfo.childIndices[openTagInfo.childIndices.length - 1];
          openTagInfo.ast.body.push(t.returnStatement(childIndex != null ? t.identifier(ELEMENT_PREFIX + childIndex) : t.nullLiteral()));
        } else {
          if (openTagInfo.isParentForSlots && openTagInfo.nestedTagCount > 1) {
            throw new Error(`Cannot mix common views or properties with slot content inside tag '${tagName}'`);
          }

          if (tagName === SpecialTags.SLOT) {
            if (openTagInfo.ast.body.length > openTagInfo.ast.spliceIndex) {
              const slotIfStatement = openTagInfo.ast.body[openTagInfo.ast.spliceIndex - 1];
              if (t.isIfStatement(slotIfStatement)) {
                const slotFallbackAstBody = openTagInfo.ast.body.splice(openTagInfo.ast.spliceIndex);

                slotFallbackAstBody.unshift(
                  t.variableDeclaration(
                    'let',
                    [
                      t.variableDeclarator(
                        t.identifier('fallbackViews'),
                        t.arrayExpression()
                      )
                    ]
                  )
                );
                slotFallbackAstBody.push(
                  t.expressionStatement(
                    t.assignmentExpression(
                      '=',
                      t.identifier(ELEMENT_PREFIX + openTagInfo.index),
                      t.identifier('fallbackViews')
                    )
                  )
                );

                slotIfStatement.alternate = t.blockStatement(<t.Statement[]>slotFallbackAstBody);
              } else {
                throw new Error('Invalid slot syntax for slot fallback views');
              }
            }

            this.isInSlotFallbackScope = false;
          } else {
            if (openTagInfo.childIndices.length) {
              const childrenAstElements = openTagInfo.childIndices.map(treeIndex => t.identifier(ELEMENT_PREFIX + treeIndex));
              openTagInfo.ast.body.push(
                t.expressionStatement(
                  t.callExpression(
                    t.memberExpression(
                      t.memberExpression(
                        t.identifier('global'),
                        t.identifier('xmlCompiler')
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
          this.isComponentInitialized = true;
          openTagInfo = null;

          // Assemble the module ast
          this.finalize();
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

  private finalize(): void {
    const astBody = [];

    // Core modules barrel
    const usedTagNames = Array.from(this.usedNSTags).sort();

    this.astConstructorBody.unshift(
      t.variableDeclaration('let', [
        t.variableDeclarator(
          t.identifier('customModules'),
          t.objectExpression(this.astCustomModuleProperties)
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

    usedTagNames.length && astBody.push(
      t.variableDeclaration('let', [
        t.variableDeclarator(
          t.objectPattern(
            usedTagNames.map(tagName => t.objectProperty(
              t.identifier(tagName),
              t.identifier(tagName),
              false,
              true
            ))
          ),
          t.callExpression(
            t.identifier('require'), [
              t.stringLiteral('@nativescript/core/ui')
            ]
          )
        )
      ])
    );

    astBody.push(
      t.variableDeclaration('let', [
        t.variableDeclarator(
          t.objectPattern([
            t.objectProperty(
              t.identifier('setPropertyValue'),
              t.identifier('setPropertyValue'),
              false,
              true
            )
          ]),
          t.callExpression(
            t.identifier('require'), [
              t.stringLiteral('@nativescript/core/ui/builder/component-builder')
            ]
          )
        )
      ]),
      ...this.astCustomModulesRegister,
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

  private traverseAttributes(attributes, callback?: (propertyName: string, prefix: string, propertyValue: string) => void) {
    // Ignore unused attributes
    if ('xmlns' in attributes) {
      delete attributes['xmlns'];
    }

    const entries = Object.entries(attributes) as any;
    for (const [name, value] of entries) {
      if (name === 'slot') {
        continue;
      }

      const [propertyName, prefix] = this.getLocalAndPrefixByName(name);
      if (prefix != null) {
        // Platform-based attributes
        if (KNOWN_PLATFORMS.includes(prefix.toLowerCase()) && prefix.toLowerCase() !== this.options.platform.toLowerCase()) {
          continue;
        }
      }

      callback && callback(propertyName, prefix, value);
    }
  }

  private getAstForProperty(index: number, propertyName: string, propertyValue: string): t.ExpressionStatement {
    // This is necessary for proper string escape
    const attrValue = propertyValue.replaceAll('\'', '\\\'');

    let propertyAst: t.Expression = t.identifier(ELEMENT_PREFIX + index);
    if (propertyName.indexOf('.') !== -1) {
      const properties = propertyName.split('.');

      for (let i = 0, length = properties.length - 1; i < length; i++) {
        propertyAst = t.optionalMemberExpression(
          propertyAst,
          t.identifier(properties[i]),
          false,
          true
        );
      }
      propertyName = properties[properties.length - 1];
    }

    return t.expressionStatement(
      t.logicalExpression(
        '&&',
        propertyAst,
        t.callExpression(
          t.identifier('setPropertyValue'),
          [
            propertyAst,
            t.nullLiteral(),
            t.identifier('moduleExports'),
            t.stringLiteral(propertyName),
            t.stringLiteral(attrValue)
          ]
        )
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
            )
          )
        ]
      )
    ];
  }

  private registerNamespace(propertyName, propertyValue): void {
    /**
     * By default, virtual-entry-javascript registers all application js, xml, and css files as modules.
     * Registering namespaces will ensure node modules are also included in module register.
     * However, we have to ensure that the resolved path of files is used as module key so that module-name-resolver works properly.
     */
    this.pathsToResolve.push(propertyValue);
    const resolvedPath = this.getResolvedPath(propertyValue);
    const ext = resolvedPath.endsWith('.xml') ? 'xml' : '';

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
                  t.stringLiteral(propertyValue)
                ]
              )
            )
          ]
        )
      )
    );

    this.astCustomModuleProperties.push(
      t.objectProperty(
        t.identifier(propertyName),
        t.callExpression(
          t.memberExpression(
            t.memberExpression(
              t.identifier('global'),
              t.identifier('xmlCompiler')
            ),
            t.identifier('loadCustomModule')
          ),
          [
            t.stringLiteral(resolvedPath),
            t.stringLiteral(ext)
          ]
        )
      )
    );
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