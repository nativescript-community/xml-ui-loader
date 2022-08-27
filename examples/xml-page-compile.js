const beautify = require('js-beautify').js;
const xmlLoader = require('../dist').default;

const mockContext = {
  async() {
    return (err, output, map) => {
      // beautify-js will also help on checking if output syntax is broken as it will not beautify further
      // eslint-disable-next-line no-console
      console.log(err ? err : beautify(output, { indent_size: 2, space_in_empty_paren: true, unescape_strings: true }));
    };
  },
  getOptions() {
    return {
      appPath: 'app',
      platform: 'ios'
    };
  },
  resourcePath: '/home/test/app/views/home/home.xml',
  rootContext: '/home/test'
};

xmlLoader.bind(mockContext)(`
  <Page navigatingTo="onNavigatingTo" xmlns="http://schemas.nativescript.org/tns.xsd">

    <ActionBar>
        <Label text="Home" />
    </ActionBar>

    <ListView items="{{ items }}" itemTap="onItemTap" itemTemplateSelector="selectItemTemplate">
        <ListView.itemTemplates>
            <template key="even">
                <StackLayout orientation="horizontal">
                    <Label text="{{ name }}" textWrap="true" />
                </StackLayout>
            </template>
            <template key="odd">
                <StackLayout orientation="horizontal">
                    <Label text="{{ name && name }}" textWrap="true" />
                </StackLayout>
            </template>
        </ListView.itemTemplates>
    </ListView>
  </Page>
`, null);