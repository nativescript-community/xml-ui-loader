import * as parser from '@babel/parser';
import traverse from '@babel/traverse';
import * as t from '@babel/types';

const BINDING_REGEX = /\{{([^)]+)\}}/;
const BINDING_AST_VALIDATORS = [
  t.isArrayExpression,
  t.isBinaryExpression,
  t.isCallExpression,
  t.isConditionalExpression,
  t.isIdentifier,
  t.isLiteral,
  t.isLogicalExpression,
  t.isMemberExpression,
  t.isNewExpression,
  t.isObjectExpression,
  t.isOptionalMemberExpression,
  t.isProperty,
  t.isSpreadElement,
  t.isTemplateElement,
  t.isUnaryExpression
];

export const VIEW_MODEL_REFERENCE_NAME = 'viewModel';

export const VALUE_REFERENCE_NAME = '$value';
export const PARENT_REFERENCE_NAME = '$parent';
export const PARENTS_REFERENCE_NAME = '$parents';

export const SPECIAL_REFERENCES = [
  VALUE_REFERENCE_NAME,
  PARENT_REFERENCE_NAME,
  PARENTS_REFERENCE_NAME
];

export interface BindingOptions {
  viewPropertyName: string;
  properties: Array<string>;
  astExpression: t.Expression;
  isTwoWay: boolean;
  parentKeyAstExpressions: Array<t.Expression>;
}

export class BindingBuilder {
  public isBindingValue(value: string): boolean {
    return BINDING_REGEX.test(value);
  }

  public convertValueToBindingOptions(propertyName: string, bindingValue: string): BindingOptions {
    const code = this.getBindingCode(bindingValue);
    const ast = parser.parse(code);

    if (ast.program.body.length !== 1 || !t.isExpressionStatement(ast.program.body[0])) {
      throw new Error(`Invalid binding expression. Binding must be a single-line expression statement: ${bindingValue}`);
    }

    const expressionStatement = ast.program.body[0];
    const bindingOptions: BindingOptions = {
      viewPropertyName: propertyName,
      properties: [],
      astExpression: null,
      isTwoWay: this.isTwoWayBindingExpression(expressionStatement.expression),
      parentKeyAstExpressions: []
    };

    traverse(expressionStatement, {
      noScope: true,
      // Validate AST
      enter: (path) => {
        this.checkIfBindingExpressionIsValid(path, bindingValue);
      },
      // We apply optional chaining by default in order to get rid of binding errors when binding context is not set early enough
      CallExpression: (path) => {
        const node = path.node;
        path.replaceWith(t.optionalCallExpression(
          node.callee,
          node.arguments,
          true
        ));
      },
      // Traverse through all identifiers and keep track of the ones that should be observed
      Identifier: (path) => {
        const node = path.node;
        let parentNode;
        let isBindingProperty = false;
        
        if (path.parentPath) {
          parentNode = path.parentPath.node;

          if (t.isMemberExpression(parentNode) || t.isOptionalMemberExpression(parentNode)) {
            // Identifiers that are first properties or properties inside a computed property
            if (node === parentNode.object || parentNode.computed) {
              isBindingProperty = true;
            }
          } else if (t.isObjectProperty(parentNode)) {
            // Identifiers that are used as object values or properties inside a computed object key
            if (node === parentNode.value || parentNode.computed) {
              isBindingProperty = true;
            }
          } else {
            isBindingProperty = true;
          }
        } else {
          isBindingProperty = true;
        }

        if (isBindingProperty) {
          // This handles identifiers like $value, $parent, $parents, etc
          if (SPECIAL_REFERENCES.includes(node.name)) {
            if (node.name === PARENTS_REFERENCE_NAME) {
              const parentKeyAst = this.getAstForParentKey(parentNode, bindingValue);
              bindingOptions.parentKeyAstExpressions.push(parentKeyAst);
            }
          } else {
            bindingOptions.properties.push(path.node.name);

            // Append a view model reference for later use
            path.replaceWith(t.memberExpression(
              t.identifier(VIEW_MODEL_REFERENCE_NAME),
              path.node
            ));
            path.skip();
          }
        }
      },
      // We apply optional chaining by default in order to get rid of binding errors when binding context is not set early enough
      MemberExpression: (path) => {
        const node = path.node;
        path.replaceWith(t.optionalMemberExpression(
          node.object,
          node.property,
          node.computed,
          true
        ));
      }
    });

    bindingOptions.astExpression = expressionStatement.expression;
    return bindingOptions;
  }

  private checkIfBindingExpressionIsValid(ast, bindingValue): void {
    for (const validate of BINDING_AST_VALIDATORS) {
      if (validate(ast)) {
        return;
      }
    }
    throw new Error(`Invalid binding expression: ${bindingValue}`);
  }

  private getAstForParentKey(parentNode, bindingValue: string): t.Expression {
    let propertyExpression;

    if (parentNode == null || !t.isMemberExpression(parentNode) && !t.isOptionalMemberExpression(parentNode)) {
      throw new Error(`Invalid '${PARENTS_REFERENCE_NAME}' expression reference. No element name has been given to search for: ${bindingValue}`);
    }
    if (parentNode.computed) {
      propertyExpression = parentNode.property;
    } else {
      if (t.isIdentifier(parentNode.property)) {
        propertyExpression = t.stringLiteral(parentNode.property.name);
      } else {
        throw new Error(`Invalid '${PARENTS_REFERENCE_NAME}' expression reference. Invalid element name: ${bindingValue}`);
      }
    }
    return propertyExpression;
  }

  private getBindingCode(bindingValue: string): string {
    const matchResult = bindingValue.match(BINDING_REGEX);
    if (matchResult == null) {
      throw new Error (`Cannot retrieve code content from non-binding value: ${bindingValue}`);
    }
    return matchResult[1].trim();
  }

  private isTwoWayBindingExpression(ast) {
    return t.isIdentifier(ast) || t.isMemberExpression(ast) || t.isOptionalMemberExpression(ast);
  }
}