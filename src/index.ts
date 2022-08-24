import { pascalCase } from 'change-case';
import { parse } from 'path';
import { parser } from 'sax';

const DEBUG = true;

loader.bind({resourcePath: "views/smartThings/diesel-tanks"})("<Page></Page>", null);

export default function loader(content: string, map: any) {
  //const callback = this.async();
  const callback = Function.prototype;
  const resourceName = parse(this.resourcePath).name;

  // parse content and dependencies async
  try {
    const output = parseXML(resourceName, content);
    DEBUG && console.log(output);
    callback(null, output, map);
  } catch(err) {
    DEBUG && console.log(err);
    callback(err);
  }
}

function parseXML(name: string, content: string) {
  const xmlParser = parser(true, { xmlns: true });
  const className = pascalCase(name);

  let output = `export default class ${className} extends `;
  let isFirstTag = true;

  // Register ios and android prefixes as namespaces to avoid "unbound xml namespace" errors
  xmlParser.ns['ios'] = xmlParser.ns['android'] = xmlParser.ns['desktop'] = xmlParser.ns['web'] = 'http://schemas.nativescript.org/tns.xsd';
 
  xmlParser.onerror = function (e) {
    // an error happened.
  };
  xmlParser.ontext = function (t) {
    // got some text.  t is the string of text.
  };
  xmlParser.onopentag = function (node) {
    if (isFirstTag) {
      isFirstTag = false;
      output += `${node.name} {\n\tconstructor() {\n\t\tsuper();`;
    }
    // opened a tag.  node has "name" and "attributes"
    console.log(node);
  };
  xmlParser.onattribute = function (attr) {
    // an attribute.  attr has "name" and "value"
  };
  xmlParser.onend = function () {
    // parser stream is done, and ready to have more stuff written to it.
  };
   
  xmlParser.write(content).close();
  output += `\n\t}\n}`;
  return output;
}