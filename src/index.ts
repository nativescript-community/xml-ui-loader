import { Parser } from 'htmlparser2';
import { js as beautify } from 'js-beautify';
import { relative } from 'path';
import { promisify } from 'util';
import { ComponentParser } from './component-parser';

export default function loader(content: string, map: any) {
  const callback = this.async();

  parseXMLTree.bind(this)(content).then((output) => {
    callback(null, output, map);
  }).catch((err) => {
    callback(err);
  });
}

async function parseXMLTree(content: string) {
  const { appPath, platform } = this.getOptions();
  const moduleRelativePath = relative(appPath, this.resourcePath);
  const resolveAsync = promisify(this.resolve);

  const componentParser = new ComponentParser(moduleRelativePath, platform);

  let needsCompilation = true;

  const xmlParser = new Parser({
    onopentag(tagName, attributes) {
      componentParser.handleOpenTag(tagName, attributes);
    },
    onprocessinginstruction(name) {
      if (name == '?xml') {
        needsCompilation = false;
        xmlParser.reset();
      }
    },
    onclosetag(tagName) {
      componentParser.handleCloseTag(tagName);
    },
    onerror(err) {
      throw err;
    }
  }, {
    xmlMode: true
  });
  xmlParser.write(content);
  xmlParser.end();

  if (!needsCompilation) {
    // escape special whitespace characters
    // see: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/JSON/stringify#Issue_with_plain_JSON.stringify_for_use_as_JavaScript
    const xml = JSON.stringify(content).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
    return `const RAW_XML_CONTENT = ${xml};
    export default RAW_XML_CONTENT;`;
  }

  componentParser.finish();

  // XML parser does not work asynchronously, so we resolve requested modules once everything is done
  await Promise.all(componentParser.getResolvedRequests().map(request => resolveAsync(this.context, request)));

  return beautify(componentParser.getOutput(), {
    indent_size: 2
  });
}