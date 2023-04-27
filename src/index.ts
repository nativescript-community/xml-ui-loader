import { codeFrameColumns } from '@babel/code-frame';
import generate from '@babel/generator';
import { highlight } from 'cli-highlight';
import { relative } from 'path';
import { promisify } from 'util';
import { LoaderOptions } from './helpers';
import { AbnormalState, setAbnormalStateReceiveListener } from './compiler-abnormal-state';
import { convertDocumentToAST } from './xml-parser';
import { Position } from './location-tracker';

export default function loader(content: string, map: any) {
  const callback = this.async();
  const options: LoaderOptions = this.getOptions();

  // Error and warning handling
  setAbnormalStateReceiveListener((type: AbnormalState, msg: string, range: Position[]) => {
    const error = new Error(getCodeFrame(content, msg, range));
    if (type === AbnormalState.ERROR) {
      if (options.compileWithMarkupErrors) {
        this.emitError(error);
      } else {
        throw error;
      }
    } else if (type === AbnormalState.WARNING) {
      this.emitWarning(error);
    } else {
      throw error;
    }
  });

  loadContent(this, content, options).then((output) => {
    callback(null, output, map);
  }).catch((err) => {
    callback(err);
  });
}

function getCodeFrame(content: string, msg: string, range: Position[]) {
  const location = {
    start: range[0],
    end: range[1]
  };
  const codeFrame = codeFrameColumns(content, location, {
    message: msg
  });

  return '\n' + highlight(codeFrame, {
    language: 'xml'
  });
}

async function loadContent(loader, content, options: LoaderOptions): Promise<string> {
  const moduleRelativePath = relative(options.appPath, loader.resourcePath);

  const { output, pathsToResolve } = convertDocumentToAST(content, moduleRelativePath, options.platform, options.useDataBinding, options.preprocess?.attributeValueFormatter);

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