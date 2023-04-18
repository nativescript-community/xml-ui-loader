import generate from '@babel/generator';
import { relative } from 'path';
import { promisify } from 'util';
import { LoaderOptions } from './helpers';
import { convertDocumentToAST } from './xml-parser';

export default function loader(content: string, map: any) {
  const callback = this.async();

  loadContent(this, content).then((output) => {
    callback(null, output, map);
  }).catch((err) => {
    callback(err);
  });
}

async function loadContent(loader, content): Promise<string> {
  const options: LoaderOptions = loader.getOptions();
  const moduleRelativePath = relative(options.appPath, loader.resourcePath);

  const { output, pathsToResolve } = convertDocumentToAST(content, {
    moduleRelativePath,
    platform: options.platform,
    attributeValueFormatter: options.preprocess?.attributeValueFormatter,
    useDataBinding: options.useDataBinding
  });

  if (output == null) {
    return '';
  }

  // XML parser does not work asynchronously, so we resolve requested modules once everything is done
  if (pathsToResolve?.length) {
    const resolveAsync = promisify(loader.resolve);
    await Promise.all(pathsToResolve.map(request => resolveAsync(loader.context, request)));
  }

  // Convert AST to JS
  return options.preprocess?.transformAst ? options.preprocess?.transformAst(output, generate) : generate(output).code;
}