import { relative } from 'path';
import { parser } from 'sax';
import { ComponentParser } from './component-parser';

export default function loader(content: string, map: any) {
  const callback = this.async();
  const { appPath, platform } = this.getOptions();
  let moduleRelativePath = relative(this.rootContext + `/${appPath}`, this.resourcePath);
  moduleRelativePath = `./${moduleRelativePath}`;

  // Parse content and dependencies async
  try {
    const output = parseXMLTree(moduleRelativePath, content, platform);
    callback(null, output, map);
  } catch(err) {
    console.error(err);
    callback(err);
  }
}

function parseXMLTree(moduleRelativePath: string, content: string, platform: string) {
  const xmlParser = parser(true, { xmlns: true });
  const componentParser = new ComponentParser(moduleRelativePath, platform);

  // Register ios and android prefixes as namespaces to avoid "unbound xml namespace" errors
  xmlParser.ns['ios'] = xmlParser.ns['android'] = xmlParser.ns['desktop'] = xmlParser.ns['web'] = 'http://schemas.nativescript.org/tns.xsd';
 
  xmlParser.onerror = function (e) {
    // an error happened.
  };

  xmlParser.ontext = function (t) {
    // got some text.  t is the string of text.
  };

  xmlParser.onopentag = (node) => {
    componentParser.handleOpenTag(node.name, node.attributes);
  };

  xmlParser.onclosetag = (elementName) => {
    componentParser.handleCloseTag(elementName);
  };

  xmlParser.onattribute = function (attr) {
    // an attribute.  attr has "name" and "value"
  };

  xmlParser.onend = function () {
    // parser stream is done, and ready to have more stuff written to it.
  };
   
  xmlParser.write(content).close();
  componentParser.finish();
  return componentParser.getOutput();
}