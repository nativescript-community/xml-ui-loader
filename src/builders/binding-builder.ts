import * as parser from '@babel/parser';
import traverse from '@babel/traverse';
import * as t from '@babel/types';
import { GLOBAL_UI_REF } from '../helpers';
import { AttributeItem } from './base-builder';

const BINDING_REGEX = /\{{(.+?)\}}/;
const CONVERTER_EXPRESSION_SEPARATOR = '|';
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
  t.isOptionalCallExpression,
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
  viewPropertyDetails: AttributeItem;
  properties: Array<string>;
  astExpression: t.Expression;
  isTwoWay: boolean;
  converterToModelAstExpression?: t.SequenceExpression;
  specialReferenceCount: number;
  parentKeyAstExpressions: Array<t.Expression>;
  [Symbol.toStringTag]: string;
}

export class BindingBuilder {
  public isBindingValue(value: string): boolean {
    return BINDING_REGEX.test(value);
  }

  public convertValueToBindingOptions(propertyDetails: AttributeItem): BindingOptions {
    const code = this.getBindingCode(propertyDetails.value);
    if (!code?.length) {
      throw new Error('Invalid binding expression. Curly brackets are empty');
    }

    const ast = parser.parse(code);

    if (ast.program.body.length !== 1 || !t.isExpressionStatement(ast.program.body[0])) {
      throw new Error(`Invalid binding expression. Binding must be a single-line expression statement: ${propertyDetails.value}`);
    }

    const expressionStatement = ast.program.body[0];
    const bindingOptions: BindingOptions = {
      viewPropertyDetails: propertyDetails,
      properties: [],
      astExpression: null,
      isTwoWay: !propertyDetails.isEventListener && !propertyDetails.isSubProperty && (this.isTwoWayBindingExpression(expressionStatement.expression)
        || this.isConverterExpression(expressionStatement.expression) 
        && this.isTwoWayBindingExpression(expressionStatement.expression.left)),
      specialReferenceCount: 0,
      parentKeyAstExpressions: [],
      get [Symbol.toStringTag]() {
        return propertyDetails.value;
      }
    };

    traverse(expressionStatement, {
      noScope: true,
      // Validate AST
      enter: (path) => {
        this.checkIfBindingExpressionIsValid(path, bindingOptions);
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
        this.handleIdentifier(path, bindingOptions);
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
      },
      exit: (path) => {
        /**
         * Always handle converters after they get fully traversed.
         * It helps with the order of bindable properties and builder does not append 'viewModel' caller to them.
         */
        if (this.isConverterExpression(path.node)) {
          this.handleConverter(path, bindingOptions);
        }
      }
    });

    // If property is an event listener, make sure that listener function will use view model as context
    if (bindingOptions.viewPropertyDetails.isEventListener) {
      bindingOptions.astExpression = this.getEventExpressionWithContext(expressionStatement.expression);
    } else {
      bindingOptions.astExpression = expressionStatement.expression;
    }

    // Ensure there are properties as first one is always needed for setting two-way binding value
    if (!bindingOptions.properties.length && bindingOptions.isTwoWay) {
      bindingOptions.isTwoWay = false;
      delete bindingOptions.converterToModelAstExpression;
    }
    return bindingOptions;
  }

  private getEventExpressionWithContext(astExpression: t.Expression): t.OptionalCallExpression {
    return t.optionalCallExpression(
      t.optionalMemberExpression(
        astExpression,
        t.identifier('bind'),
        false,
        true
      ), [
        t.identifier(VIEW_MODEL_REFERENCE_NAME)
      ],
      true
    );
  }

  private checkIfBindingExpressionIsValid(ast, bindingOptions: BindingOptions): void {
    for (const validate of BINDING_AST_VALIDATORS) {
      if (validate(ast)) {
        return;
      }
    }
    throw new Error(`Invalid binding expression: ${bindingOptions.toString()}`);
  }

  private handleIdentifier(path, bindingOptions: BindingOptions): void {
    const node = path.node;
    let parentNode;
    let isBindingProperty = false;
    
    if (path.parentPath != null) {
      parentNode = path.parentPath.node;

      if (this.isMemberExpression(parentNode)) {
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
          const parentKeyAst = this.getAstForParentKey(parentNode, bindingOptions.toString());
          bindingOptions.parentKeyAstExpressions.push(parentKeyAst);
        }
        bindingOptions.specialReferenceCount++;
      } else {
        // Avoid keeping track of the same identifier twice
        if (!bindingOptions.properties.includes(path.node.name)) {
          bindingOptions.properties.push(path.node.name);
        }

        // Append a view model reference for later use
        path.replaceWith(t.memberExpression(
          t.identifier(VIEW_MODEL_REFERENCE_NAME),
          path.node
        ));
        path.skip();
      }
    }
  }

  private handleConverter(path, bindingOptions: BindingOptions): void {
    const node: t.BinaryExpression = path.node;
    const isRightSideCallExpression = this.isCallExpression(node.right);
    const isRightSideExpressionValid = t.isIdentifier(node.right) || this.isMemberExpression(node.right) || isRightSideCallExpression;
    // Right-side has to be a property or function call
    if (!isRightSideExpressionValid) {
      throw new Error(`Invalid right-side reference for converter. Expression: ${bindingOptions.toString()}`);
    }

    // Keep callee and arguments from converter expression
    let callee: t.Expression;
    const args: Array<any> = [];
    if (isRightSideCallExpression) {
      const callExpression: t.CallExpression | t.OptionalCallExpression = node.right as any;

      callee = <t.Expression>callExpression.callee;

      if (callExpression.arguments.length) {
        args.push(...callExpression.arguments);
      } else {
        // For HMR to be able to tell the difference between myConverter() and myConverter, we append an undefined parameter in the case of call expression
        args.push(t.identifier('undefined'));
      }
    } else {
      callee = node.right;
    }

    // This is an expression for using converter to set value from view to view model in case converter is the binding expression itself
    if (path.parentPath == null && bindingOptions.isTwoWay) {
      bindingOptions.converterToModelAstExpression = t.sequenceExpression([
        <t.Expression>node.left,
        t.callExpression(
          t.memberExpression(
            t.memberExpression(
              t.identifier('global'),
              t.identifier(GLOBAL_UI_REF)
            ),
            t.identifier('runConverterCallback')
          ), [
            callee,
            t.arrayExpression([
              t.memberExpression(
                t.identifier('args'),
                t.identifier('value')
              ),
              ...args
            ]),
            t.booleanLiteral(true)
          ]
        )
      ]);
    }

    // Generate a function call that executes converter in runtime
    path.replaceWith(
      t.callExpression(
        t.memberExpression(
          t.memberExpression(
            t.identifier('global'),
            t.identifier(GLOBAL_UI_REF)
          ),
          t.identifier('runConverterCallback')
        ), [
          callee,
          t.arrayExpression([
            node.left,
            ...args
          ])
        ]
      )
    );
    path.skip();
  }

  private getAstForParentKey(parentNode, expressionDesc: string): t.Expression {
    let propertyExpression;

    if (parentNode == null || !this.isMemberExpression(parentNode)) {
      throw new Error(`Invalid '${PARENTS_REFERENCE_NAME}' expression reference. No element name has been given to search for: ${expressionDesc}`);
    }
    if (parentNode.computed) {
      propertyExpression = parentNode.property;
    } else {
      if (t.isIdentifier(parentNode.property)) {
        propertyExpression = t.stringLiteral(parentNode.property.name);
      } else {
        throw new Error(`Invalid '${PARENTS_REFERENCE_NAME}' expression reference. Invalid element name: ${expressionDesc}`);
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

  private isCallExpression(ast): ast is t.CallExpression | t.OptionalCallExpression {
    return t.isCallExpression(ast) || t.isOptionalCallExpression(ast);
  }

  private isConverterExpression(ast): ast is t.BinaryExpression {
    return t.isBinaryExpression(ast, {
      operator: CONVERTER_EXPRESSION_SEPARATOR
    });
  }

  private isMemberExpression(ast): ast is t.MemberExpression | t.OptionalMemberExpression {
    return t.isMemberExpression(ast) || t.isOptionalMemberExpression(ast);
  }

  private isTwoWayBindingExpression(ast): boolean {
    return t.isIdentifier(ast) || this.isMemberExpression(ast);
  }
}