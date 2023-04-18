import * as t from '@babel/types';
import { Parser } from 'htmlparser2';
import { ComponentBuilder, ComponentBuilderOptions } from './builders/component-builder';
import { BindingBuilder } from './builders/binding-builder';

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

export function convertDocumentToAST(content: string, builderOpts: ComponentBuilderOptions): { output: t.Program; pathsToResolve: Array<string> } {
  const componentBuilder = new ComponentBuilder(builderOpts);
  if (builderOpts.useDataBinding) {
    componentBuilder.setBindingBuilder(new BindingBuilder());
  }
  
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