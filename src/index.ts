import { js as beautify } from 'js-beautify';
import { relative } from 'path';
import { parser } from 'sax';
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

  const xmlParser = parser(true, { xmlns: true });
  const componentParser = new ComponentParser(moduleRelativePath, platform);

  // Register ios and android prefixes as namespaces to avoid "unbound xml namespace" errors
  xmlParser.ns['ios'] = xmlParser.ns['android'] = xmlParser.ns['desktop'] = xmlParser.ns['web'] = 'http://schemas.nativescript.org/tns.xsd';

  xmlParser.onopentag = (node) => {
    componentParser.handleOpenTag(node.local, node.prefix, node.attributes);
  };
  xmlParser.onclosetag = (elementName) => {
    componentParser.handleCloseTag(elementName);
  };
  xmlParser.onerror = (err) => {
    // Allow using ampersand
    if (err.message.includes('Invalid character') && err.message.includes('Char: &')) {
      xmlParser.error = null;
    }
  };
   
  xmlParser.write(content).close();
  componentParser.finish();

  // XML parser does not work asynchronously, so we wait to resolve requested modules in the end
  await Promise.all(componentParser.getResolvedRequests().map(request => resolveAsync(this.context, request)));

  return beautify(componentParser.getOutput(), {
    indent_size: 2
  });
}